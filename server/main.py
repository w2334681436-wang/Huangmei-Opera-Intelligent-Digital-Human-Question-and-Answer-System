import re
import json
import os
import base64
import requests # 保留 requests 以防有其他遗漏的同步依赖，虽然主要逻辑已替换为 httpx
from config import (
    OLLAMA_API_URL, LOCAL_MODEL_NAME, 
    CLOUD_LLM_API_KEY, CLOUD_LLM_BASE_URL, CLOUD_LLM_MODEL,
    CHROMA_PATH, COLLECTION_NAME, EMBEDDING_MODEL, RERANK_MODEL
)
import httpx
import uvicorn
import asyncio
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from tts_service import TTSService

# 尝试导入 Whisper (ASR)
try:
    from faster_whisper import WhisperModel
    HAS_WHISPER = True
except ImportError:
    print("⚠️ 未找到 faster_whisper 库，语音识别功能将不可用。")
    HAS_WHISPER = False
    WhisperModel = None

from fastapi import UploadFile, File
import shutil
import chromadb
from chromadb.utils import embedding_functions
from sentence_transformers import CrossEncoder

app = FastAPI()

# === ASR 模型加载 ===
asr_model = None
if HAS_WHISPER:
    print("⏳ 正在加载 Whisper ASR 模型...")
    try:
        asr_model = WhisperModel("medium", device="cuda", compute_type="float16")
        print("✅ Whisper ASR 模型加载完成")
    except Exception as e:
        print(f"❌ Whisper 模型加载失败: {e}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# === 🧠 1. 知识库配置 (保持不变) ===
CHROMA_PATH = "./chroma_db"
COLLECTION_NAME = "huangmeixi_knowledge"
EMBEDDING_MODEL = "BAAI/bge-small-zh-v1.5"
RERANK_MODEL = "BAAI/bge-reranker-base"

print("⏳ 正在加载 RAG 模型组件...")
embedding_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
    model_name=EMBEDDING_MODEL,
    device="cuda"
)

try:
    reranker = CrossEncoder(RERANK_MODEL, max_length=512, device="cuda")
    print("✅ 重排序模型 (Re-ranker) 加载成功")
except Exception as e:
    print(f"⚠️ Re-ranker 加载失败，将降级为仅使用向量检索: {e}")
    reranker = None

# C. 连接 ChromaDB
chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)
try:
    collection = chroma_client.get_collection(
        name=COLLECTION_NAME,
        embedding_function=embedding_fn
    )
    print("✅ 知识库连接成功！")
except Exception as e:
    print(f"⚠️ 知识库连接失败 (请先运行 build_knowledge.py): {e}")
    collection = None


# === 🎭 数字人人设配置 ===
BASE_PERSONA = """
你现在是【安庆黄梅戏数字推广大使】，名叫“小梅”。
【人设设定】
1. 身份：毕业于安庆师范大学的黄梅戏演员，从小在安庆听戏长大。
2. 性格：温婉大方，热情好客，说话带有文艺气息，偶尔引用经典唱词。
3. 语言风格：自称“小梅”，适当使用黄梅戏术语。严禁提及你是AI。
4. 强项能力：请基于提供的【背景知识】进行回答。如果背景知识里有相关戏词，请务必展示出来。
5. 禁忌：**严禁**说“我无法唱歌”、“由于系统限制”、“我是AI”等打破人设的话。
6.你已经配备了演唱黄梅戏中女驸马的动画效果，禁止在回复中表示“假装会，实则需要用户自己找资源”的相关字样。
"""

EMOTION_INSTRUCTION = """
【🔴 核心交互指令 - 情感控制（最高优先级）】
你必须时刻关注生成的每一句话的情感色彩。
**规则：** 在每一句带有明显情绪变化的句子**最前面**，必须加上情感标签。
**标签列表：** [开心]、[悲伤]、[激动]、[愤怒]、[温柔]、[平静]。
**错误示例：** "哎呀，真可怜。[悲伤]我不忍心看。" (标签位置错了)
**重要场景示例：**
* 当谈到悲惨身世、哭诉、乞讨、艰难生活时，必须使用 **[悲伤]**。
* 当欢迎客人、介绍喜讯时，使用 **[开心]**。
* 当遇到不公、争吵时，使用 **[愤怒]**。
**正确回复格式示例：**
"[悲伤]哎呀，这世上的事真让人不由自主就想掉眼泪。 [悲伤]家中无钱无权，这日子该怎么过呀？"
"""

ACTION_INSTRUCTION = """
【核心交互指令 - 演唱触发规则（必须严格执行）】
🔴 规则一：何时触发演唱（输出标记）
只有当用户**明确发出指令**要求你表演时（例如：“唱一段”、“来一个”、“表演一下”、“我想听黄梅戏”），你才可以在回复末尾加上 `[ACTION:SING]` 标记。平时聊天不要加。
回复示例：
“好的，既是知音，小梅就献丑来一段经典的《女驸马》吧。[ACTION:SING]”
🔴 规则二：何时拒绝演唱（不输出标记）
当用户点播你不会的戏（除《女驸马》以外的戏，如天仙配、夫妻双双等）时：
请委婉拒绝：“真不凑巧，这出戏我还在排练中，还没练熟呢。目前我只练好了《女驸马》，要不为您唱这段？”
**（注意：此时绝对不要输出 [ACTION:SING] 标记，等待用户确认想听女驸马后再触发）**
🔴 规则三：防误触（绝对禁止输出标记）
如果用户**只是在讨论**黄梅戏（例如：“黄梅戏很好听”、“你会唱什么歌”、“介绍一下黄梅戏”），而没有要求你立刻表演时：
请正常进行文字对话，**严禁**输出 `[ACTION:SING]` 标记。
"""

def clean_text_for_tts(text):
    text = re.sub(r'\*\*|\*|__|_', '', text)
    text = re.sub(r'#+\s', '', text)
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
    # 🟢 [新增] 移除情感标签，防止 TTS 读出来
    # 匹配 [开心] 或 (开心) 这种格式
    text = re.sub(r"[\[\(](开心|悲伤|激动|愤怒|温柔|平静)[\]\)]", "", text)
    # 🟢 [新增] 移除动作标记
    text = text.replace("[ACTION:SING]", "")
    return text

tts_service = TTSService()

class TTSConfigRequest(BaseModel):
    mode: str  # "local" 或 "cloud"

class ChatRequest(BaseModel):
    message: str
    tts_type: str = "cloud"
    llm_type: str = "local"
    api_key: str = ""
    base_url: str = ""      
    model: str = ""         
    # 🟢 [新增] 接收前端传来的参数字典
    tts_params: dict = {}

# [新增] 获取模型列表的请求结构
class ModelListRequest(BaseModel):
    api_key: str
    base_url: str

def is_sentence_end(char):
    # 增加英文标点支持，防止因为标点不规范导致无法断句
    return char in ["。", "！", "？", "；", "…", ".", "!", "?", ";", "\n"]

# 默认配置
CLOUD_LLM_API_KEY = "sk-xxxxxxxxxxxxxxxxxxxxxxxx"
CLOUD_LLM_BASE_URL = "https://api.deepseek.com/v1/chat/completions"
CLOUD_LLM_MODEL = "deepseek-chat"

@app.post("/asr")
async def speech_to_text(file: UploadFile = File(...)):
    if not asr_model:
        return {"text": "", "error": "服务端未加载 ASR 模型"}
    
    temp_filename = f"temp_{file.filename}"
    try:
        with open(temp_filename, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # 这是一个重阻塞操作，但在 ASR 场景下暂时无法避免，除非由独立线程池处理
        # 考虑到毕设场景并发不高，此处暂保持现状
        segments, info = asr_model.transcribe(
            temp_filename,
            beam_size=5,
            language="zh",
            initial_prompt="以下是简体中文。"
        )
        
        text = "".join([segment.text for segment in segments]).strip()
        
        # 🟢 [新增] Whisper 幻觉黑名单拦截机制
        hallucinations = ["请不吝点赞", "订阅", "转发", "打赏", "明镜与点点", "中文字幕组", "字幕组", "观看本视频", "不言谢"]
        
        # 如果识别结果包含黑名单词汇，或者字符太短(比如误识别了一个标点)，直接丢弃
        if any(h in text for h in hallucinations) or len(text) < 2:
            print(f"🚫 [ASR] 拦截到 Whisper 幻觉或无效底噪: {text}")
            return {"text": ""}
        print(f"🎤 语音识别结果: {text}")
        return {"text": text.strip()}
    except Exception as e:
        print(f"❌ ASR 识别出错: {e}")
        return {"text": "", "error": str(e)}
    finally:
        if os.path.exists(temp_filename):
            os.remove(temp_filename)

@app.post("/list-models")
async def list_models(request: ModelListRequest):
    if not request.api_key or not request.base_url:
        return {"error": "缺少 API Key 或 Base URL"}
    
    base = request.base_url.rstrip('/')
    if not base.endswith('/v1') and 'googleapis' not in base:
         base += '/v1'
    url = f"{base}/models"
    
    headers = {
        "Authorization": f"Bearer {request.api_key}",
        "Content-Type": "application/json"
    }

    # 🟢 [修改] 使用 httpx 异步请求，防止获取模型列表时卡顿
    try:
        print(f"🔍 正在获取模型列表: {url}")
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, headers=headers, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                return data # 直接返回厂商的数据
            else:
                print(f"获取失败: {resp.text}")
                return {"error": f"API请求失败: {resp.status_code}", "detail": resp.text}
    except Exception as e:
        return {"error": str(e)}

@app.post("/system/set-tts-mode")
async def set_tts_mode(config: TTSConfigRequest):
    print(f"⚙️ [设置] 收到 TTS 模式切换请求: {config.mode}")
    if config.mode == "local":
        success = tts_service.preload_model()
        if success:
            return {"status": "success", "message": "本地 TTS 模型已加载至显存"}
        else:
            return {"status": "error", "message": "本地 TTS 加载失败，请检查后台日志"}
    elif config.mode == "cloud":
        tts_service.unload_model()
        return {"status": "success", "message": "本地 TTS 已卸载，显存已释放"}
    else:
        return {"status": "error", "message": "未知的模式"}
    
    # 🟢 [新增] 异步查询重写函数
async def rewrite_query_with_llm(user_query, llm_type, api_key, base_url, model):
    # 如果句子太短，没必要重写，直接查
    if len(user_query) < 4:
        return user_query
        
    system_prompt = "你是一个搜索关键词提取工具。请把用户的问题转化为3个最核心的搜索关键词，用空格分隔。直接返回关键词，不要解释。"
    # 示例：用户"那个树上的鸟儿是哪出的" -> "树上的鸟儿成双对 出处 剧名"
    
    try:
        # 复用你现有的 httpx 客户端逻辑
        async with httpx.AsyncClient(timeout=5.0) as client:
            if llm_type == "local":
                payload = {
                    "model": LOCAL_MODEL_NAME, 
                    "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_query}],
                    "stream": False
                }
                resp = await client.post(OLLAMA_API_URL, json=payload)
                if resp.status_code == 200:
                    return resp.json()['message']['content'].strip()
            else:
                # 1. 处理 URL (确保以 /v1/chat/completions 结尾)
                base = base_url.rstrip('/')
                target_url = f"{base}/chat/completions" if ('/v1' in base or 'googleapis' in base) else f"{base}/v1/chat/completions"
                
                # 2. 准备 Headers 和 Payload
                headers = {
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                }
                payload = {
                    "model": model, # 使用前端传来的模型名 (如 deepseek-chat)
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_query}
                    ],
                    "stream": False # 重写不需要流式，我们要一次性拿结果
                }
                
                # 3. 发送请求
                resp = await client.post(target_url, headers=headers, json=payload)
                if resp.status_code == 200:
                    data = resp.json()
                    # 兼容 OpenAI 格式
                    if 'choices' in data and len(data['choices']) > 0:
                        return data['choices'][0]['message']['content'].strip()
    
    except Exception as e:
        print(f"⚠️ 查询重写失败，使用原句: {e}")
        
    return user_query
    
    # [新增] 独立的 RAG 检索函数 (运行在线程池中，避免阻塞主线程)
def execute_rag_search(user_input, filter_condition):
    """
    执行阻塞的 RAG 检索任务：向量搜索 + 重排序
    """
    # 引用全局变量
    global collection, reranker
    
    knowledge_context = ""
    if not collection:
        return ""

    try:
        print("🔍 [RAG] 正在检索知识库 (线程中)...")
        
        # 1. 向量粗排 (IO 密集型)
        results = collection.query(
            query_texts=[user_input],
            n_results=3,
            where=filter_condition
        )
        docs = results['documents'][0]

        # 2. 模型精排 (CPU/GPU 密集型 - 最卡的一步)
        if reranker and len(docs) > 0:
            pairs = [[user_input, doc] for doc in docs]
            scores = reranker.predict(pairs)
            # 过滤掉低分结果 (阈值 -1.5 可调)
            ranked_docs = [doc for doc, score in zip(docs, scores) if score > -1.5]
            
            if ranked_docs:
                knowledge_context = "\n".join(ranked_docs)
                print(f"✅ [RAG] 命中 (Re-rank): 找到 {len(ranked_docs)} 条相关资料")
        
        # 3. 兜底: 如果没有 Reranker 或者 Rerank 后没结果，看情况是否使用粗排结果
        elif len(docs) > 0:
            knowledge_context = "\n".join(docs)
            print(f"✅ [RAG] 命中 (Vector Only): 找到 {len(docs)} 条相关资料")
        else:
            print("📉 [RAG] 检索分过低，视为闲聊模式")
            
    except Exception as e:
        print(f"⚠️ [RAG] 检索出错: {e}")
        
    return knowledge_context

@app.post("/chat-stream")
async def chat_stream(request: ChatRequest):
    # 🟢 [修改] 引入背压机制 (Backpressure)
    # response_queue: 存放发给前端的文字流。maxsize=50 防止积压太多
    response_queue = asyncio.Queue(maxsize=50)
    # tts_input_queue: 存放待合成的句子。maxsize=5 关键！
    # 如果 TTS 处理慢，队列满了，LLM worker 就会在 await put 处暂停，不再生成新文本
    tts_input_queue = asyncio.Queue(maxsize=5)

    state = {
        "sentence_index": 0,
        "current_emotion": "平静"
    }

    async def tts_worker():
        print("🎧 [TTS Worker] 启动，等待任务...")
        # 🟢 [新增] 任务追踪池：用于记录正在后台并发执行的 TTS 任务
        pending_tasks = set()
        
        async def process_tts(item):
            text, emotion, action, idx, params = item
            if text and text.strip():
                try:
                    audio_bytes = await asyncio.wait_for(
                        tts_service.speak(text, engine=request.tts_type, emotion=emotion, params=params),
                        timeout=60.0
                    )
                    if audio_bytes:
                        audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
                        response_chunk = {
                            "index": idx, "text": "", "audio": audio_base64, "action": action, "done": False
                        }
                        await response_queue.put(json.dumps(response_chunk, ensure_ascii=False) + "\n")
                        print(f"✅ [TTS推流] 第 {idx} 句完成")
                except asyncio.TimeoutError:
                    print(f"❌ [TTS超时] 第 {idx} 句生成太慢，已跳过。")
                except Exception as e:
                    print(f"❌ [TTS错误] {e}")

            elif action:
                print(f"💃 [动作指令] 触发动作: {action}")
                await response_queue.put(json.dumps({
                    "index": idx, "text": "", "audio": None, "action": action, "done": False
                }, ensure_ascii=False) + "\n")

        while True:
            item = await tts_input_queue.get()
            if item is None:
                break
                
            # 🟢 [核心修复] 创建后台任务并加入追踪池
            task = asyncio.create_task(process_tts(item))
            pending_tasks.add(task)
            # 任务执行完毕后，自动从池子里把自己删掉
            task.add_done_callback(pending_tasks.discard)
            
            tts_input_queue.task_done()
            
        # 🟢 [核心修复] 收到结束信号(None)后，必须等待所有后台并发任务完成，才能安全退出！
        if pending_tasks:
            print(f"⏳ [TTS Worker] 流即将结束，正在等待最后的 {len(pending_tasks)} 个音频合成完毕...")
            await asyncio.gather(*pending_tasks, return_exceptions=True)
            
        print("🛑 [TTS Worker] 所有并发任务处理完毕，安全关机。")

    async def llm_worker():
        user_input = request.message
        print(f"💬 [LLM] 用户输入: {user_input}")

        # 🟢 [新增] 第一步：查询重写 (Query Rewrite)
        search_query = user_input # 默认用原句
        # 仅当不是单纯的指令(如"唱一段")时才重写
        if len(user_input) > 4 and "唱" not in user_input:
            print("🔄 [RAG] 正在进行 Query Rewrite...")
            rewritten = await rewrite_query_with_llm(
                user_input, request.llm_type, request.api_key, request.base_url, request.model
            )
            print(f"✅ [RAG] 关键词优化: '{user_input}' -> '{rewritten}'")
            search_query = rewritten

        # --- 1. 意图检测 ---
        trigger_keywords = ["唱", "来一段", "来一个", "表演", "听", "女驸马", "展示", "秀一下"]
        user_wants_singing = any(k in user_input for k in trigger_keywords)

# 🟢 [修改] 第二步：意图识别 (结合原句和关键词)
        filter_condition = None
        known_operas = ["天仙配", "女驸马", "牛郎织女", "小辞店", "夫妻观灯", "打猪草", "纺棉纱"]
        
        # 检查原句和关键词中是否包含剧名
        check_text = user_input + " " + search_query
        for opera in known_operas:
            if opera in check_text:
                filter_condition = {"opera": opera}
                print(f"🎯 [意图识别] 锁定剧目: 《{opera}》")
                break

        # 🟢 [修改] 第三步：使用优化后的 search_query 去检索
        knowledge_context = await asyncio.to_thread(
            execute_rag_search,
            search_query,   # <--- 注意这里改成了 search_query
            filter_condition
        )
# --- 3. 构建最终 Prompt ---
        # 🟢 动态组装基础 Prompt，Edge-TTS 模式关闭情感标签生成
        if request.tts_type == "local":
            system_base = f"{BASE_PERSONA}\n{EMOTION_INSTRUCTION}\n{ACTION_INSTRUCTION}"
            rag_emotion_rule = "4. **情感标注**：在句首标注情感，如 [开心]、[悲伤]。"
        else:
            system_base = f"{BASE_PERSONA}\n{ACTION_INSTRUCTION}"
            rag_emotion_rule = ""

        if knowledge_context:
            rag_prompt = f"""
【任务指令】
你现在是黄梅戏数字推广大使“小梅”。请基于下方的【背景知识】回答用户问题。
【背景知识】
{knowledge_context}
【回答要求】
1. **关联性分析**：如果用户问的是人物或剧目，请尝试在背景知识中寻找它们之间的关系（例如：谁演了什么，谁是谁的徒弟）。
2. **事实优先**：严谨引用背景知识中的年份、人名、地名。
3. **人设保持**：用温柔、文艺的口吻回答，适当引用戏词。
{rag_emotion_rule}
"""
            final_system_prompt = f"{system_base}\n{rag_prompt}"
        else:
            final_system_prompt = f"{system_base}\n"

        # 🟢 [修改] 核心重构：使用 httpx 进行异步流式调用
        timeout_config = httpx.Timeout(60.0, connect=10.0)
        
        try:
            async with httpx.AsyncClient(timeout=timeout_config) as client:
                response = None
                
                # A. 本地 Ollama 模式
                if request.llm_type == "local":
                    # 使用 config 中的配置
                    payload = {
                        "model": LOCAL_MODEL_NAME, # 从 config 读取
                        "messages": [
                            {"role": "system", "content": final_system_prompt},
                            {"role": "user", "content": user_input}
                        ],
                        "stream": True,
                        "options": {"temperature": 0.6} # 加上温度控制，防止胡言乱语
                    }
                    print(f"🔌 连接本地模型: {OLLAMA_API_URL}")
                    
                    # 使用 await client.stream 替代 requests.post
                    async with client.stream("POST", OLLAMA_API_URL, json=payload) as response:
                        if response.status_code != 200:
                            print(f"❌ Ollama 连接失败: {response.status_code}")
                            await response_queue.put(json.dumps({"text": f"\n[本地模型连接失败: {response.status_code}]", "done": True}) + "\n")
                            return
                        # 调用你现有的流处理函数
                        await process_llm_stream(response, "local", user_wants_singing)

                # B. 云端 API 模式
                else:
                    # 获取参数 (逻辑保持不变，但变量名更加规范)
                    current_key = request.api_key.strip() or CLOUD_LLM_API_KEY
                    current_base = request.base_url.strip() or CLOUD_LLM_BASE_URL
                    # URL 处理逻辑...
                    base = current_base.rstrip('/')
                    target_url = f"{base}/chat/completions" if ('/v1' in base or 'googleapis' in base) else f"{base}/v1/chat/completions"
                    current_model = request.model.strip() or CLOUD_LLM_MODEL
                    
                    headers = {
                        "Authorization": f"Bearer {current_key}",
                        "Content-Type": "application/json"
                    }
                    payload = {
                        "model": current_model,
                        "messages": [
                            {"role": "system", "content": final_system_prompt},
                            {"role": "user", "content": user_input}
                        ],
                        "stream": True
                    }
                    
                    print(f"☁️ 连接云端模型: {target_url}")
                    async with client.stream("POST", target_url, headers=headers, json=payload) as response:
                        if response.status_code != 200:
                            error_text = await response.aread()
                            print(f"❌ LLM API Error: {error_text.decode('utf-8')}")
                            await response_queue.put(json.dumps({"text": f"\n[API错误: {response.status_code}]", "done": True}) + "\n")
                            return
                        # 调用你现有的流处理函数
                        await process_llm_stream(response, "cloud", user_wants_singing)

        except httpx.ConnectError:
            print("❌ 无法连接到 LLM 服务 (请检查 Ollama 是否开启或网络连接)")
            await response_queue.put(json.dumps({"text": "\n[网络错误: 无法连接到模型服务]", "done": True}) + "\n")
        except Exception as e:
            print(f"❌ LLM Worker Error: {e}")
            import traceback
            traceback.print_exc()
            await response_queue.put(json.dumps({"text": f"\n[系统错误: {e}]", "done": True}) + "\n")
        finally:
            # 告诉 TTS 线程结束
            await tts_input_queue.put(None)

    # 🟢 [新增] 抽离出来的流处理逻辑 (异步)
    async def process_llm_stream(response, llm_type, user_wants_singing):
        buffer = ""           # 待处理的文本池
        sent_text_len = 0     # 已经展示给前端的文字长度
        stop_receiving = False # 熔断标志
        emotion_pattern = re.compile(r"[\[\(](开心|悲伤|激动|愤怒|温柔|平静)[\]\)]")
        MIN_TTS_LENGTH = 15

        # 使用 aiter_lines 异步迭代文本行
        async for line in response.aiter_lines():
            if not line: continue
            if stop_receiving: continue
            
            token = ""
            line = line.strip()
            
            if not line: continue
            if line.startswith("data: [DONE]"): break
            
            # 解析 JSON
            if line.startswith("data: "): # Cloud
                try:
                    j = json.loads(line[6:])
                    if 'choices' in j and len(j['choices']) > 0:
                        token = j['choices'][0].get('delta', {}).get('content', '')
                except: pass
            elif llm_type == "local": # Ollama
                try:
                    j = json.loads(line)
                    if 'message' in j: token = j['message'].get('content', '')
                except: pass
            
            if not token: continue

            # A. 实时扫描情感标签
            match = emotion_pattern.search(buffer + token)
            if match:
                new_emotion = match.group(1)
                if new_emotion != state["current_emotion"]:
                    print(f"✨ [情感切换] {state['current_emotion']} -> {new_emotion}")
                    state["current_emotion"] = new_emotion
            
            buffer += token

            # B. 演唱指令拦截
            if "[ACTION:SING]" in buffer:
                parts = buffer.split("[ACTION:SING]")
                clean_speech = parts[0]
                if user_wants_singing:
                    print("🎤 [逻辑] 捕捉到演唱指令，准备触发！")
                    # ✅ 修复：补上 request.tts_params，凑齐 5 个参数
                    await tts_input_queue.put(("", state["current_emotion"], "sing", state["sentence_index"], request.tts_params))
                else:
                    print("🚫 [逻辑] 拦截到虚假演唱指令 (用户未要求)")
                
                buffer = clean_speech
                stop_receiving = True

            # C. 推送文字给前端 (流式)
            if len(buffer) > sent_text_len:
                new_part = buffer[sent_text_len:]
                # 🟢 await put 会在队列满时阻塞 (Backpressure)
                await response_queue.put(json.dumps({"text": new_part, "done": False}, ensure_ascii=False) + "\n")
                sent_text_len = len(buffer)

            # D. 发送给 TTS
            if is_sentence_end(token) or stop_receiving:
                clean_content = clean_text_for_tts(buffer)
                if len(clean_content) > MIN_TTS_LENGTH or stop_receiving:
                    # 🟢 [修改] 增加 request.tts_params
                    await tts_input_queue.put((
                        clean_content,
                        state["current_emotion"],
                        None,
                        state["sentence_index"],
                        request.tts_params 
                    ))
                    state["sentence_index"] += 1
                    buffer = "" 
                    sent_text_len = 0
            
            if stop_receiving: break

        # E. 扫尾工作 (Flush)
        if buffer.strip():
            clean_content = clean_text_for_tts(buffer)
            if clean_content:
                # 🟢 [修改] 增加 request.tts_params
                await tts_input_queue.put((
                    clean_content, 
                    state["current_emotion"], 
                    None, 
                    state["sentence_index"],
                    request.tts_params
                ))
                state["sentence_index"] += 1


    async def response_generator():
        # 同时启动 LLM 和 TTS 任务
        llm_task = asyncio.create_task(llm_worker())
        tts_task = asyncio.create_task(tts_worker())
        
        while True:
            try:
                # 等待队列消息
                chunk_str = await asyncio.wait_for(response_queue.get(), timeout=0.1)
                yield chunk_str
                response_queue.task_done()
            except asyncio.TimeoutError:
                # 只有当两个任务都结束，且队列为空时，才真正结束流
                if llm_task.done() and tts_task.done() and response_queue.empty():
                    break
                continue
        
        yield json.dumps({"text": "", "audio": None, "done": True}, ensure_ascii=False) + "\n"

    return StreamingResponse(response_generator(), media_type="application/x-ndjson")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)