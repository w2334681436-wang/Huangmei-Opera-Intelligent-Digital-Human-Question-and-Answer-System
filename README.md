# 🎭 黄梅戏虚拟数字人“小梅” (Huangmei Opera Digital Human)

本项目为基于大语言模型与 RAG 检索技术的黄梅戏交互数字人系统。通过整合 FastAPI 后端、React 前端、ChromaDB 向量数据库以及本地语音合成技术，打造了一个温婉大方、了解黄梅戏知识的虚拟推广大使“小梅”。

> **⚠️ 特别说明：**
> 由于本项目包含了大量的 AI 模型权重、音频克隆素材、数字人动作视频以及预编译的虚拟环境（完整体积约 10GB），超出了 GitHub 的存储限制。因此，本仓库仅作为**核心源代码展示**。
> 
> **如果你想在本地直接运行本项目，请务必下载打包好的完整离线运行包！**

---

## 📦 完整资源包下载 (开箱即用)

🔗 **完整离线运行包 (百度网盘)**：https://pan.baidu.com/s/1XLheBOqBnIRo0bMXqOvlfQ?pwd=3368
🔑 **提取码**：3368

*下载后请解压到本地硬盘，**注意文件夹路径中绝对不能包含中文或空格**（例如 `D:\AI-Smart-Dialog`）。*

---

## 🛠️ 本地部署指南

如果你已经下载并解压了完整的离线资源包，请严格按照以下步骤进行环境配置。

### 零、基础环境准备（必做）
如果你的电脑是第一次运行代码，请先安装以下基础软件：
1. **Python 3.11.x**：后端运行环境。安装界面的第一步，**务必勾选底部【Add Python 3.xx to PATH】**！*(推荐 3.11.14，请勿使用 3.12/3.13 等过高版本，以免底层 AI 库编译报错)*
2. **Node.js** (LTS版本)：前端运行环境。默认安装即可。
3. **Ollama**：本地 AI 大模型引擎。

*(💡 安装完成后，强烈建议重启一次电脑，让环境变量生效。)*

### 一、下载本地大模型
按下 `Win + R` 键，输入 `cmd` 打开命令行终端，输入以下命令拉取模型（文件较大，请耐心等待）：
```bash
ollama run qwen2.5:14b
```

### 二、项目依赖配置
打开 **VSCode**，将解压后的项目文件夹拖入其中。点击菜单栏【终端】->【新建终端】。

**1. 配置后端引擎 (Python)**
在终端中依次运行以下命令：
```bash
cd server
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt -i [https://pypi.tuna.tsinghua.edu.cn/simple](https://pypi.tuna.tsinghua.edu.cn/simple)
```

**2. 配置前端页面 (React)**
新建一个终端标签页，依次运行：
```bash
cd client
npm install --registry=[https://registry.npmmirror.com](https://registry.npmmirror.com)
```

### 三、一键启动！
完成以上步骤后，关闭 VSCode。
进入项目文件夹，双击运行 **`一键启动.bat`**。系统会弹出控制台窗口，随后将自动在浏览器中打开数字人交互界面。

---

## 👑 进阶：启用 GPU 本地语音加速（限 NVIDIA 显卡用户）
若你拥有 N 卡并希望体验个性化自定义的本地语音合成：
1. 确保基础版本已成功运行过。
2. 双击运行根目录下的 **`安装本地TTS引擎(进阶).bat`**。
3. 脚本会自动配置 CUDA 加速库，完成后即可在网页控制台中切换至 "Local Edge-TTS" 享受本地语音交互。
