import chromadb
from chromadb.utils import embedding_functions
import os
import glob
import re
import json
import requests
from langchain_text_splitters import RecursiveCharacterTextSplitter
import chromadb.errors

# === 配置 ===
DATA_DIR = "./data"
PERSIST_DIRECTORY = "./chroma_db"
COLLECTION_NAME = "huangmeixi_knowledge"
EMBEDDING_MODEL_NAME = "BAAI/bge-small-zh-v1.5"
KNOWN_OPERAS = ["天仙配", "女驸马", "牛郎织女", "小辞店", "夫妻观灯", "打猪草", "纺棉纱"]

# 🟢 [新增] 调用本地 LLM 提取元数据
def ask_llm_for_metadata(text_chunk):
    # 这里假设你本地跑着 Ollama，如果不开 Ollama 跑脚本，会回退到默认值
    url = "http://127.0.0.1:11434/api/chat"
    prompt = f"""
    任务：分析文本，提取黄梅戏元数据。
    文本：{text_chunk[:300]}...
    
    请返回纯 JSON，包含字段：
    - opera: 剧目名（如天仙配，若无明确剧目填"通用"）
    - topic: 话题（如历史、唱词、人物）
    - tags: [关键词1, 关键词2]
    
    JSON示例：{{"opera": "天仙配", "topic": "剧情", "tags": ["董永", "七仙女"]}}
    """
    
    payload = {
        "model": "qwen2.5:14b", # 请确保你本地有这个模型，或者换成你有的
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "format": "json" # 强制 JSON 模式
    }
    
    try:
        resp = requests.post(url, json=payload, timeout=20)
        if resp.status_code == 200:
            content = resp.json().get('message', {}).get('content', '{}')
            return json.loads(content)
    except Exception:
        pass # 失败了就静默失败，使用默认值
    return {"opera": "通用", "topic": "通用", "tags": []}

def parse_opera_script(file_path):
    """
    🟢 [新增] 剧本专用解析器
    功能：按“角色：台词”结构切分，提取 Metadata
    """
    filename = os.path.basename(file_path)
    opera_name = os.path.splitext(filename)[0] # 假设文件名就是剧目名，如 "天仙配.txt"
    
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    documents = []
    metadatas = []
    ids = []
    
    current_role = "旁白/介绍"
    current_content = []
    
    # 匹配 "角色：内容" 或 "角色: 内容" 的正则
    role_pattern = re.compile(r'^^\s*([^：:]{1,10})\s*[：:]\s*(.*)')

    for i, line in enumerate(lines):
        line = line.strip()
        if not line: continue

        match = role_pattern.match(line)
        if match:
            # 1. 如果之前有积攒的内容，先保存上一段
            if current_content:
                text = "\n".join(current_content)
                documents.append(text)
                metadatas.append({
                    "source": filename,
                    "opera": opera_name,
                    "role": current_role,
                    "type": "script"
                })
                ids.append(f"{opera_name}_{len(ids)}")
            
            # 2. 更新当前角色和内容
            current_role = match.group(1)
            content = match.group(2)
            current_content = [content] if content else []
        else:
            # 如果没有冒号，认为是上一句的延续（或者是纯介绍文本）
            current_content.append(line)

    # 处理文件末尾最后一段
    if current_content:
        text = "\n".join(current_content)
        documents.append(text)
        metadatas.append({
            "source": filename,
            "opera": opera_name,
            "role": current_role,
            "type": "script" if len(metadatas) > 0 else "general" # 如果全文都没找到冒号，标记为普通文本
        })
        ids.append(f"{opera_name}_{len(ids)}")

    # 如果这个文件虽然叫剧本，但一行带冒号的都没找到，说明可能是纯介绍文章
    # 这时候回退到通用切分器
    if len(documents) <= 1 and len(lines) > 10:
        return None, None, None
        
    return documents, metadatas, ids

# 修改 server/build_knowledge.py 中的 load_documents_smart 函数

def load_documents_smart(folder_path):
    all_docs = []
    all_metas = []
    all_ids = []
    
    general_splitter = RecursiveCharacterTextSplitter(
        chunk_size=300, chunk_overlap=50, separators=["\n\n", "\n", "。", "！", "？"]
    )
    
    files = glob.glob(os.path.join(folder_path, "*.txt"))
    for file_path in files:
        filename = os.path.basename(file_path)
        print(f"📄 正在解析: {filename} ...")
        
        # 🟢 1. 尝试作为剧本解析
        docs, metas, ids = parse_opera_script(file_path)
        
        if docs:
            print(f"   -> 识别为剧本，提取到 {len(docs)} 个对话片段")
            all_docs.extend(docs)
            all_metas.extend(metas)
            all_ids.extend(ids)
        else:
            # 🟢 2. 识别为普通文章 (引入状态继承机制！)
            print(f"   -> 识别为普通文章，启用上下文状态继承打标...")
            with open(file_path, 'r', encoding='utf-8') as f:
                text = f.read()
            chunks = general_splitter.split_text(text)
            
            doc_id_base = os.path.splitext(filename)[0]
            
            # 🔥 核心变量：上下文状态
            # 初始状态：默认为文件名（假设文件主要讲这个，除非文中提到了别的）
            # 如果文件名就是“杂乱资料”，那就先定为 Unknown，等待文中关键词唤醒
            current_context_opera = doc_id_base 
            for opera in KNOWN_OPERAS:
                if opera in doc_id_base:
                    current_context_opera = opera
                    break
            
            print(f"   -> 识别为普通文章，正在进行 AI 智能打标...")
            for idx, chunk in enumerate(chunks):
                # 🟢 1. 调用 LLM 提取元数据 (这一步会比以前慢，但在后台跑无所谓)
                print(f"      🤖 分析第 {idx+1}/{len(chunks)} 段...")
                meta = ask_llm_for_metadata(chunk)
                
                # 🟢 2. 优先使用 LLM 提取的剧名，如果没有则尝试原来的文件名匹配
                detected_opera = meta.get("opera", "通用")
                if detected_opera == "通用":
                    # 兜底：如果 LLM 没识别出来，再用文件名里的剧名
                    for opera in KNOWN_OPERAS:
                        if opera in filename:
                            detected_opera = opera
                            break

                all_docs.append(chunk)
                all_metas.append({
                    "source": filename,
                    "opera": detected_opera, # 使用智能提取的剧名
                    "topic": meta.get("topic", "通用"),
                    "role": "System", 
                    "type": "general_knowledge"
                })
                all_ids.append(f"{os.path.splitext(filename)[0]}_chunk_{idx}")
                
    return all_docs, all_metas, all_ids

def main():
    print("⏳ 正在加载 Embedding 模型...")
    ef = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name=EMBEDDING_MODEL_NAME
    )

    client = chromadb.PersistentClient(path=PERSIST_DIRECTORY)
    
    # 重建集合
    try:
        client.delete_collection(name=COLLECTION_NAME)
        print(f"🗑️ 已清理旧集合")
    except chromadb.errors.NotFoundError:
        pass

    collection = client.create_collection(
        name=COLLECTION_NAME,
        embedding_function=ef
    )

    # 加载并处理数据
    print("📖 开始智能解析文档...")
    docs, metas, ids = load_documents_smart(DATA_DIR)

    if not docs:
        print("⚠️ data 目录下没有 txt 文件，生成一条默认数据防止报错")
        docs = ["黄梅戏是中国五大戏曲剧种之一。"]
        metas = [{"source": "default", "type": "default"}]
        ids = ["default_1"]

    print(f"🚀 正在写入 {len(docs)} 条结构化数据到向量库...")
    
    batch_size = 100
    for i in range(0, len(docs), batch_size):
        end = min(i + batch_size, len(docs))
        collection.add(
            documents=docs[i:end],
            metadatas=metas[i:end],
            ids=ids[i:end]
        )
        print(f"   已写入 batch {i}-{end}")

    print("✅ 知识库构建完成！请确保你的剧本文件（如天仙配.txt）里包含 '董永：xxx' 这样的格式。")

if __name__ == "__main__":
    main()