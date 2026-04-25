import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState, useEffect, useRef } from 'react';
import {
  Send, Bot, Mic, Volume2, VolumeX, Keyboard,
  ChevronDown, ChevronUp,
  Settings, X, Sliders, Maximize, Minimize,
  Check, Loader2 // 新增图标
} from 'lucide-react';
import { useMemo } from 'react'; // 确保引入了 useMemo
import DigitalHuman from './components/DigitalHuman';
import type { AvatarState } from './components/DigitalHuman';
// 🟢 [插入] 皮肤配置列表
const SKIN_CONFIG = [
  {
    id: 'default',
    name: '经典常服 (Default)',
    bgFile: 'bg.jpg' // 这里的背景是 jpg
  },
  {
    id: 'opera_v2',
    name: '戏曲盛装 (Opera V2)',
    bgFile: 'bg.png' // 这里的背景是 png，文件名可以随意定
  },
];

// 🟢 [新增] LLM 服务商配置
const LLM_PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek (官方)', url: 'https://api.deepseek.com' },
  { id: 'siliconflow', name: '硅基流动 (SiliconFlow)', url: 'https://api.siliconflow.cn' },
  { id: 'gemini', name: 'Google Gemini (OpenAI兼容)', url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'custom', name: '自定义 (Custom)', url: '' },
];

interface ModelItem {
  id: string;
  owned_by?: string;
}


// 🟢 [新增] 队列项接口
interface QueueItem {
  audio: string | null;
  text: string;
  action?: 'sing' | null; // 支持 sing 动作
}


function App() {

  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // 新增：控制是否开启语音朗读 (默认开启)
  // 🟢 新增：音量状态 (0.0 到 1.0，默认 1.0)
  const [volume, setVolume] = useState(1.0);
  // 🟢 新增：静音状态 (方便一键静音)
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false); // 新增：控制是否正在打字

  const [isRecording, setIsRecording] = useState(false); // 新增：控制是否正在录音

  // 🟢 [新增] 录音相关状态
  const [isSettingsOpen, setIsSettingsOpen] = useState(false); // 控制弹窗显示
  const [apiKey, setApiKey] = useState(""); // 存储 API Key
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [ttsConfig, setTtsConfig] = useState({
    // 定义每个情感的默认强度 (建议范围 0.3 - 1.2，默认 0.6)
    emotionAlphas: {
      "开心": 0.6,
      "悲伤": 0.6,
      "激动": 0.6,
      "愤怒": 0.9,
      "温柔": 0.6,
      "平静": 0.5
    } as Record<string, number>
  });
  const [bgOpacity, setBgOpacity] = useState(0.4); // 背景遮罩透明度 (默认 0.4)  
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [currentSkin, setCurrentSkin] = useState("default");//存ID
  // 🟢 [新增]根据 ID 查找当前的完整配置对象（为了获取 bgFile）
  const currentSkinConfig = SKIN_CONFIG.find(s => s.id === currentSkin) || SKIN_CONFIG[0];
  // 🟢 [新增] 音量 Ref (用于解决闭包导致的音量重置 Bug)
  const volumeRef = useRef(1.0);
  const isMutedRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // === 🟢 [新增] 高级 LLM 设置状态 ===
  const [selectedProvider, setSelectedProvider] = useState(LLM_PROVIDERS[0].id);
  const [customUrl, setCustomUrl] = useState(""); // 自定义 URL
  const [currentModel, setCurrentModel] = useState(""); // 当前选中的模型ID
  const [availableModels, setAvailableModels] = useState<ModelItem[]>([]); // 模型列表
  const [modelSearch, setModelSearch] = useState(""); // 模型搜索关键词
  const [isFetchingModels, setIsFetchingModels] = useState(false); // 是否正在获取模型

  // 计算最终使用的 Base URL
  const currentBaseUrl = useMemo(() => {
    if (selectedProvider === 'custom') return customUrl;
    const provider = LLM_PROVIDERS.find(p => p.id === selectedProvider);
    return provider ? provider.url : '';
  }, [selectedProvider, customUrl]);

  // 过滤模型列表
  const filteredModels = useMemo(() => {
    if (!modelSearch) return availableModels;
    return availableModels.filter(m => m.id.toLowerCase().includes(modelSearch.toLowerCase()));
  }, [availableModels, modelSearch]);

  // 获取模型列表的函数
  const fetchModels = async () => {
    if (!apiKey) {
      alert("请先填写 API Key");
      return;
    }
    setIsFetchingModels(true);
    try {
      const res = await fetch('http://127.0.0.1:8000/list-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          base_url: currentBaseUrl
        })
      });
      const data = await res.json();
      if (data.data && Array.isArray(data.data)) {
        setAvailableModels(data.data);
        // 如果当前没有选中模型，默认选中第一个
        if (!currentModel && data.data.length > 0) {
          setCurrentModel(data.data[0].id);
        }
      } else {
        console.error("获取模型失败:", data);
        alert("获取模型列表失败，请检查 Key 或 URL 是否正确。\n(有些厂商可能不支持列表查询，您可以直接手动填写模型名)");
      }
    } catch (err) {
      console.error(err);
      alert("网络请求错误");
    } finally {
      setIsFetchingModels(false);
    }
  };

  // 🟢 [修改] 处理模型选择 (直接接收字符串 ID)
  const handleModelSelect = (modelId: string) => {
    setCurrentModel(modelId); // 更新选中的 ID
    setModelSearch(modelId);  // 同步填入搜索框
  };

  // === ⚙️ 新增：系统模式设置 ===
  const [ttsMode, setTtsMode] = useState<"cloud" | "local">("cloud"); // 默认云端TTS(快)
  const [llmMode, setLlmMode] = useState<"cloud" | "local">("cloud"); // 默认本地LLM(免费)

  // TTS 加载状态: 'idle'(空闲) | 'loading'(加载中) | 'success'(加载成功)
  const [ttsLoadingState, setTtsLoadingState] = useState<'idle' | 'loading' | 'success'>('idle');

  // 处理 TTS 切换的异步函数
  const handleTtsSwitch = async (mode: "cloud" | "local") => {
    if (mode === ttsMode) return; // 如果没变就不处理

    if (mode === 'cloud') {
      // 切换回云端：不需要等待，直接切
      setTtsMode('cloud');
      setTtsLoadingState('idle');
      // 后台静默卸载本地模型 (不阻塞UI)
      fetch('http://127.0.0.1:8000/system/set-tts-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'cloud' })
      }).catch(console.error);
    } else {
      // 切换到本地：需要等待加载
      setTtsLoadingState('loading'); // 开始显示加载条
      try {
        const res = await fetch('http://127.0.0.1:8000/system/set-tts-mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'local' })
        });
        const data = await res.json();

        if (data.status === 'success') {
          setTtsMode('local');
          setTtsLoadingState('success'); // 显示“加载完成”

          // 2秒后清除成功提示，恢复正常界面
          setTimeout(() => {
            setTtsLoadingState('idle');
          }, 2000);
        } else {
          alert("本地模型加载失败: " + data.message);
          setTtsLoadingState('idle');
          setTtsMode('cloud'); // 回退
        }
      } catch (e) {
        console.error(e);
        alert("请求失败，无法连接服务器");
        setTtsLoadingState('idle');
        setTtsMode('cloud'); // 回退
      }
    }
  };

  // === 🎵 智能音频队列系统 ===
  const audioQueueRef = useRef<QueueItem[]>([]);
  // 🟢 [新增] 状态：是否正在演唱、是否正在播放TTS
  const [isPlayingTTS, setIsPlayingTTS] = useState(false);
  const [isSinging, setIsSinging] = useState(false);
  const isPlayingRef = useRef(false);
  const hasStartedPlayingRef = useRef(false);

  // === 🛑 用于中断控制的 Refs ===
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // App.tsx
  const nextPlayIndexRef = useRef(0); // 记录现在该播放第几句
  const pendingAudioMapRef = useRef<Map<number, QueueItem>>(new Map()); // 暂存区，存放还没轮到播放的音频

  // 🟢【替换为这一行】(修复报错：浏览器里定时器ID是 number 类型)
  const typeWriterIntervalRef = useRef<number | null>(null);

  // 🟢【插入这一行】(这是新加的，用来判断文字是否已经开始打印了)
  const hasStartedPrintingRef = useRef(false);

  // === 📝 文本缓冲池 ===
  const fullTextRef = useRef("");

  // 🟢 [新增] 模式切换状态 ('text' | 'voice')
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text');
  const [audioLevel, setAudioLevel] = useState(0); // 麦克风音量 (Input)
  // 🟢 [新增] 音频可视化与设备管理状态
  const [ttsAudioLevel, setTtsAudioLevel] = useState(0);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");

  const [isChatExpanded, setIsChatExpanded] = useState(true);

  // 🟢 [新增] 可视化 Ref
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // 🟢 [新增] 语音容器的引用，用于自动聚焦
  const voiceContainerRef = useRef<HTMLDivElement>(null);



  // 🟢 [修改] 状态优先级：演唱 > 说话 > 思考 > 待机
  const avatarState: AvatarState = useMemo(() => {
    if (isSinging) return 'singing';
    if (isPlayingTTS) return 'speaking';
    if (isLoading) return 'thinking';
    return 'idle';
  }, [isSinging, isPlayingTTS, isLoading]);

  // 🟢 [新增] 切换到语音模式时，自动让容器获得焦点，这样按空格立马生效
  useEffect(() => {
    if (inputMode === 'voice' && voiceContainerRef.current) {
      voiceContainerRef.current.focus();
    }
  }, [inputMode]);

  // 🟢 [新增] 初始化获取设备列表
  useEffect(() => {
    const getDevices = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true }); // 请求权限
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        setAudioDevices(audioInputs);
        if (audioInputs.length > 0) setSelectedDeviceId(audioInputs[0].deviceId);
      } catch (err) {
        console.error("无法获取音频设备:", err);
      }
    };
    getDevices();
  }, []);

  // 🟢 [修改] 监听音量变化 (同步到 Ref，并实时调整当前音频)
  useEffect(() => {
    // 1. 同步到 Ref，让 playNextAudio 能读取到最新值
    volumeRef.current = volume;
    isMutedRef.current = isMuted;

    // 2. 实时调整正在播放的音频
    if (currentAudioRef.current) {
      currentAudioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // 🟢 [新增] 全屏切换函数
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  };

  // 🟢 [新增] 监听全屏变化 (防止用户按 Esc 退出后状态不一致)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // 🟢 [新] 开始录音 + 启动可视化
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined }
      });

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        handleASRUpload(audioBlob);
        stopVisualization();
        stream.getTracks().forEach(track => track.stop()); // 释放麦克风
      };

      mediaRecorder.start();
      setIsRecording(true);

      // 启动波形可视化
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;
      drawVisualizer();

    } catch (err) {
      console.error("启动录音失败:", err);
    }
  };

  // 🟢 [新] 停止录音
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // 🟢 [新] 音频可视化动画循环
  const drawVisualizer = () => {
    if (!analyserRef.current) return;
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    // 计算平均音量
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    const average = sum / dataArray.length;
    setAudioLevel(average / 128); // 归一化

    animationFrameRef.current = requestAnimationFrame(drawVisualizer);
  };

  const stopVisualization = () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    setAudioLevel(0);
  };

  // 🟢 [新] 上传录音逻辑
  const handleASRUpload = async (audioBlob: Blob) => {
    setIsLoading(true); // 1. 开始录音上传，显示“正在思考”
    const formData = new FormData();
    formData.append("file", audioBlob, "recording.webm");

    try {
      const response = await fetch("http://127.0.0.1:8000/asr", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      // 2. 识别成功
      if (data.text && data.text.trim()) {
        // ⚠️ 关键修改：添加 await
        // 这会让 handleASRUpload 等待 sendMessage 执行完毕（包括 AI 回复和 TTS 播放）
        // 这样 isLoading 状态就会一直保持 true，直到 sendMessage 内部将其设为 false
        await sendMessage(data.text);
      } else {
        // 3. 识别结果为空（没听清），需要手动关闭 loading
        console.warn("ASR 识别结果为空");
        setIsLoading(false);
      }
    } catch (error) {
      // 4. 发生错误，手动关闭 loading
      console.error("ASR Error:", error);
      setIsLoading(false);
    }
    // 注意：这里不再需要 finally 块，避免提前关闭 loading 导致闪烁
  };

  // 🟢 [新] 键盘事件 (仅在 voice 模式下生效)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 只有在语音模式 + 按下空格 + 当前没在录音 时触发
    if (inputMode === 'voice' && e.code === 'Space' && !isRecording) {
      e.preventDefault(); // 防止页面滚动

      // 🟢 [新增] 核心打断逻辑：
      // 如果 AI 正在加载(isLoading) 或 正在播放音频(isPlayingRef) 或 队列里还有音频
      if (isLoading || isPlayingRef.current || audioQueueRef.current.length > 0) {
        console.log("⚡ 用户按键插话，强制打断当前输出...");
        stopGeneration(); // 立即停止播放和生成
      }

      // 开始录音
      startRecording();
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (inputMode === 'voice' && e.code === 'Space' && isRecording) {
      e.preventDefault();
      stopRecording();
    }
  };

  // 🟢 [修改] 停止生成/打断逻辑
  const stopGeneration = () => {
    // 1. 中断 Fetch 请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // 2. 停止当前播放的音频
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }

    // 3. 清除打字机定时器
    if (typeWriterIntervalRef.current !== null) {
      window.clearInterval(typeWriterIntervalRef.current);
      typeWriterIntervalRef.current = null;
    }

    // 4. 🔴 核心修复：彻底清空所有音频队列和状态
    audioQueueRef.current = [];
    pendingAudioMapRef.current.clear(); // 清空暂存区 Map
    nextPlayIndexRef.current = 0;       // 重置索引计数器 (关键!)

    // 5. 重置标志位
    isPlayingRef.current = false;
    hasStartedPlayingRef.current = false;
    hasStartedPrintingRef.current = false;

    // 6. 重置 UI 状态
    setIsLoading(false);
    setIsSpeaking(false);
    setIsPlayingTTS(false); // 确保头像停止说话动画
    setIsSinging(false);    // 确保停止演唱动作

    console.log("🚫 已完全中断输出，状态已重置");
  };

  const playNextAudio = (forceStart = false) => {
    if (isPlayingRef.current) return;
    if (audioQueueRef.current.length === 0) {
      setIsPlayingTTS(false);
      hasStartedPlayingRef.current = false;
      return;
    }

    // 🟢 核心修改：动态设置阈值。本地模型缓冲3句，云端(Edge-TTS)模型缓冲1句
    const currentMinBuffer = ttsMode === 'local' ? 3 : 1;

    if (!hasStartedPlayingRef.current && !forceStart) {
      if (audioQueueRef.current.length < currentMinBuffer) return;
    }
    const item = audioQueueRef.current.shift();
    if (!item) return;

    isPlayingRef.current = true;

    // 🔥【修复核心】：优先检查是否是演唱指令
    // 后端发送的演唱指令通常是 { audio: null, action: 'sing' }
    if (item.action === 'sing') {
      console.log("🎭 触发演唱模式！");
      // 1. 设置状态，DigitalHuman 组件会监听到并切换视频
      setIsSinging(true);
      // 2. 这里的 isPlayingRef 保持为 true，防止下一句 TTS 插嘴
      // 3. 等待 singing.webm 播放完毕触发 onEnded -> handleSingingEnded -> 继续播放下一句
      return;
    }

    // 常规 TTS 语音播放逻辑
    if (item.audio) {
      const audio = new Audio(`data:audio/mp3;base64,${item.audio}`);
      audio.volume = isMutedRef.current ? 0 : volumeRef.current;
      currentAudioRef.current = audio;

      // ================== 🟢 新增：TTS 音频分析逻辑 Start ==================
      // 创建分析器来监听 TTS 的音量
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;

      // 连接音频源 -> 分析器 -> 扬声器
      const source = audioCtx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(audioCtx.destination);

      const updateMouth = () => {
        if (audio.paused || audio.ended) {
          setTtsAudioLevel(0); // 停止播放时强制闭嘴
          return;
        }
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);

        // 计算平均音量
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;

        // 归一化 (0 ~ 1.0)
        setTtsAudioLevel(avg / 100);

        requestAnimationFrame(updateMouth);
      };
      // ================== 🟢 新增：TTS 音频分析逻辑 End ==================

      audio.onended = () => {
        setTtsAudioLevel(0); // 播完归零
        isPlayingRef.current = false;
        playNextAudio(true);
      };

      // 播放并启动分析
      audio.play().then(() => {
        setIsPlayingTTS(true);
        updateMouth(); // 启动循环
        if (!hasStartedPrintingRef.current) startTypewriter();
      }).catch(err => {
        console.error("播放失败", err);
        isPlayingRef.current = false;
        playNextAudio(true);
      });
    } else {
      // 既没音频也没动作的空包（防御性编程），直接跳过
      isPlayingRef.current = false;
      playNextAudio(true);
    }
  };

  // 🟢 [新增] 演唱结束回调
  const handleSingingEnded = () => {
    console.log("🎤 演唱结束");
    setIsSinging(false);          // 切回待机
    isPlayingRef.current = false; // 解锁队列
    playNextAudio(true);          // 继续播放后续内容
  };

  const startTypewriter = () => {
    if (typeWriterIntervalRef.current !== null) return;
    hasStartedPrintingRef.current = true;

    typeWriterIntervalRef.current = window.setInterval(() => {
      // 🟢 增加保护：如果组件卸载或 user 突然中断，fullTextRef 可能会有问题，加个可选链
      const currentFullText = fullTextRef.current || "";

      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        // 确保最后一条消息是 assistant 的，否则不更新
        if (!lastMsg || lastMsg.role !== 'assistant') return prev;

        const currentLength = lastMsg.content.length;
        if (currentLength < currentFullText.length) {
          // 🟢 优化：每次打 2 个字，让长文本显示更流畅，不至于因为音频太短而没打完
          const step = 2;
          const nextChunk = currentFullText.slice(0, currentLength + step);
          return [
            ...prev.slice(0, -1),
            { ...lastMsg, content: nextChunk }
          ];
        }
        return prev;
      });
    }, 50);
  };

  // 🟢 [修改] 入队函数：增加 action 参数，并将 audio 类型改为 string | null
  const addToAudioQueue = (base64Audio: string | null, text: string, index: number, action?: 'sing' | null) => {
    // 1. 将收到的音频放入暂存 Map
    pendingAudioMapRef.current.set(index, { audio: base64Audio, text: text, action: action });

    // 2. 尝试将暂存区中“连续”的音频提取到正式播放队列
    while (pendingAudioMapRef.current.has(nextPlayIndexRef.current)) {
      const nextItem = pendingAudioMapRef.current.get(nextPlayIndexRef.current);
      if (nextItem) {
        audioQueueRef.current.push(nextItem);
        pendingAudioMapRef.current.delete(nextPlayIndexRef.current);
        nextPlayIndexRef.current++; // 期待下一句
      }
    }

    // 3. 触发播放逻辑
    playNextAudio(false);
  };
  // 新增：流结束时的处理
  const onStreamFinished = () => {
    console.log("✅ 流结束，强制播放剩余音频");
    playNextAudio(true); // 强制开启播放
  };

  const sendMessage = async (overrideText?: string) => {
    const textToSend = overrideText || input;

    if (!textToSend.trim()) return;

    // 🟢 1. 强制打断上一轮 (即使没在播放，也要确保索引归零)
    stopGeneration();

    const newMsgs = [...messages, { role: 'user', content: textToSend }];
    setMessages(newMsgs);
    setInput("");
    setIsLoading(true);
    hasStartedPlayingRef.current = false;
    hasStartedPrintingRef.current = false;
    setIsSpeaking(true);

    fullTextRef.current = "";
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setMessages(prev => [...prev, { role: 'assistant', content: "" }]);

      const response = await fetch('http://127.0.0.1:8000/chat-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          tts_type: ttsMode,
          llm_type: llmMode,
          api_key: apiKey,
          // 🟢 [新增] 传入 URL 和 模型
          base_url: currentBaseUrl,
          model: currentModel || "deepseek-chat",// 兜底
          tts_params: ttsConfig
        }),
        signal: controller.signal
      });

      if (!response.body) throw new Error("无响应体");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          onStreamFinished(); // 🟢 使用了之前未使用的函数
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line);

            if (chunk.text) {

              // 🟢 [修改] 先拼接到临时变量，然后清洗掉标签，再更新
              let newText = chunk.text;
              fullTextRef.current += newText;

              // 使用正则将累积文本中的所有情感标签替换为空字符串
              // 注意：我们在 fullTextRef 上操作，确保即使标签被拆成两个 chunk 发送也能被删掉
              fullTextRef.current = fullTextRef.current
                .replace(/\[(开心|悲伤|激动|愤怒|温柔|平静)\]/g, "")
                .replace(/\((开心|悲伤|激动|愤怒|温柔|平静)\)/g, "")

                // 2. 移除完整的演唱标签
                .replace(/\[\s*ACTION\s*:\s*SING\s*\]/gi, "")

                // 3. 🔥【新增】移除“残肢”（缺少右括号的标签）
                // 只要看到 [ACTION:SING 就删掉，不管后面有没有 ]
                .replace(/\[ACTION:SING/gi, "")

                // 4. 防止因为分段传输导致的诡异残留
                .replace(/ACTION:SING\]/gi, "");

            }

            // 🟢【修复 2】处理音频/动作 (去掉了你代码中重复的那一段)
            if (chunk.audio || chunk.action) {
              // 将 text 也传进去，方便以后扩展（虽然目前 addToAudioQueue 传的是空串）
              // 注意：如果你的后端 chunk.text 是分段的，这里传 chunk.text 即可
              addToAudioQueue(chunk.audio, chunk.text || "", chunk.index, chunk.action);
            }

          } catch (e) {
            console.error("JSON解析错误", e);
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.log("用户主动中断");
        fullTextRef.current += " (回复已被打断)"; // 这行很好

        // 强制刷新一下 UI，确保"(回复已被打断)"能立即显示出来
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, content: fullTextRef.current }];
          }
          return prev;
        });

      } else {
        console.error(error);
        setMessages(prev => [...prev, { role: 'assistant', content: "\n[你已让系统停止这条回答]" }]);
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      if (typeWriterIntervalRef.current !== null) {
        window.clearInterval(typeWriterIntervalRef.current);
        typeWriterIntervalRef.current = null;
      }
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant') {
          return [...prev.slice(0, -1), { ...last, content: fullTextRef.current }];
        }
        return prev;
      });
    }
  };

  // 自动滚动到底部
  useEffect(() => {
    const chatContainer = document.getElementById('chat-container');
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }, [messages, isSpeaking]);

  // 🟢 [新增] 动态计算当前主题下的 Tailwind 样式变量
  const isDark = theme === 'dark';
  const modalBg = isDark ? 'bg-[#1a1a1a]' : 'bg-gray-50';
  const modalHeaderBg = isDark ? 'bg-[#252525]' : 'bg-white';
  const modalBorder = isDark ? 'border-white/10' : 'border-gray-200';
  const sectionBorder = isDark ? 'border-white/5' : 'border-gray-200';
  const textMain = isDark ? 'text-white' : 'text-gray-800';
  const textSub = isDark ? 'text-gray-400' : 'text-gray-500';
  const inputBg = isDark ? 'bg-[#151515]' : 'bg-white';
  const inputFocus = isDark ? 'focus:border-emerald-500 text-white' : 'focus:border-emerald-500 text-gray-900';
  const cardBg = isDark ? 'bg-black/20' : 'bg-white shadow-sm';
  const toggleBg = isDark ? 'bg-black/30' : 'bg-gray-100/80';
  const hoverBg = isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100';

  return (
    <div
      // 🟢 外层容器
      className="relative w-screen h-screen bg-[#1a1a1a] overflow-hidden font-sans text-gray-100"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      {/* ================= Layer 0: 背景层 (已修改为图片) ================= */}
      <div className="absolute inset-0 z-0">
        {/* 🟢 [修改] 动态背景路径：/skins/{currentSkin}/bg.jpg */}
        <img
          // 🟢 [修改] 路径变为：/skins/ID/配置的文件名
          src={`/skins/${currentSkinConfig.id}/${currentSkinConfig.bgFile}`}
          alt="Background"
          className="w-full h-full object-cover transition-opacity duration-700"
        />

        <div
          className="absolute inset-0 transition-colors duration-300"
          style={{ backgroundColor: `rgba(0, 0, 0, ${bgOpacity})` }}
        />
      </div>

      {/* ================= Layer 1: 数字人层 (居中) ================= */}
      {/* 🟢 修改：数字人渲染区域 - 同时渲染所有皮肤，实现无缝切换 */}
      <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
        {SKIN_CONFIG.map((skin) => (
          <div
            key={skin.id}
            className={`absolute inset-0 transition-opacity duration-500 ${
              // 只有当前选中的皮肤才显示，其他的 opacity 设为 0（但在后台依然是活的）
              currentSkinConfig.id === skin.id ? 'opacity-100 z-10' : 'opacity-0 z-0'
              }`}
          >
            <DigitalHuman
              state={avatarState}
              skinId={skin.id}
              mouthOpening={ttsAudioLevel}
              // 没选中的皮肤静音，选中的皮肤给音量
              volume={currentSkinConfig.id === skin.id ? (isMuted ? 0 : volume) : 0}
              // 只有选中的皮肤触发“演唱结束”事件，防止后台的皮肤重复触发
              onSingingEnded={currentSkinConfig.id === skin.id ? handleSingingEnded : undefined}
            />
          </div>
        ))}
      </div>

      {/* ================= Layer 2: UI 交互层 (最上层) ================= */}
      <div className="absolute inset-0 z-20 flex flex-col justify-between pointer-events-none">

        {/* --- 顶部 Header --- */}
        <header className="pointer-events-auto h-16 flex items-center justify-between px-6 bg-gradient-to-b from-black/80 to-transparent">
          <div className="flex items-center gap-3">
            <div className="text-white font-bold text-lg shadow-black drop-shadow-md flex items-center gap-2">
              <Bot size={24} className="text-emerald-400" />
              <span>AI 数字人助理</span>
            </div>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="ml-2 p-1.5 rounded-full hover:bg-white/10 text-gray-300 hover:text-emerald-400 transition-colors"
              title="系统设置"
            >
              <Settings size={20} />
            </button>
            <div className="flex gap-2">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-black/40 border border-white/10 backdrop-blur-md text-emerald-400">
                {llmMode === 'local' ? 'Local LLM' : 'Cloud LLM'}
              </span>
            </div>
          </div>

          {/* 右上角：音量控制 */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 bg-black/40 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/10 group">
              <button
                onClick={() => setIsMuted(!isMuted)}
                className="text-gray-300 hover:text-white transition-colors"
              >
                {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setVolume(val);
                  if (val > 0) setIsMuted(false);
                }}
                className="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
            </div>
          </div>
        </header>

        {/* --- 中间留空 --- */}
        <div className="flex-1"></div>

        {/* --- 底部：对话区域 (带展开/收起功能) --- */}
        <div className="pointer-events-auto w-full max-w-3xl mx-auto mb-6 px-4 flex flex-col gap-0">

          {/* 1. 聊天记录窗口 (可折叠) */}
          <div
            id="chat-container"
            className={`
                bg-black/60 backdrop-blur-xl border border-white/10 
                rounded-t-2xl 
                scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent
                transition-all duration-300 ease-in-out relative
                ${isChatExpanded ? 'max-h-[35vh] opacity-100' : 'max-h-0 opacity-0 overflow-hidden border-none'}
              `}
          >
            <div className="p-4 overflow-y-auto max-h-[35vh]">
              {messages.length === 0 && (
                <div className="text-center text-gray-300 py-4 text-sm">
                  👋 你好，我是小梅。关于黄梅戏，你可以问我任何问题。
                </div>
              )}

              {messages.map((msg, idx) => (
                <div key={idx} className={`flex gap-3 mb-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`px-4 py-2.5 rounded-2xl max-w-[90%] text-[14px] leading-relaxed shadow-lg ${msg.role === 'user'
                    ? 'bg-emerald-600/90 text-white backdrop-blur-md'
                    : 'bg-white/15 text-gray-100 backdrop-blur-md border border-white/5'
                    }`}>
                    {/* 👇 这里改用最安全的逻辑：先判断是否存在，再做字符串替换，绝对不会删掉前面的字 */}
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content ? msg.content.replace('[ACTION:SING]', '') : ''}
                    </ReactMarkdown>
                  </div>
                </div>
              ))}

              {isLoading && <div className="text-emerald-400 text-xs animate-pulse ml-2 mb-2">⚡ 正在思考中...</div>}
            </div>
          </div>

          {/* 2. 输入框区域 */}
          <div className="bg-[#1e1e1e]/90 backdrop-blur-2xl border-t-0 border border-white/10 rounded-b-2xl p-3 shadow-2xl relative">

            {/* 🟢 折叠/展开 悬浮按钮 */}
            <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 z-30">
              <button
                onClick={() => setIsChatExpanded(!isChatExpanded)}
                className="bg-[#2f2f2f] hover:bg-emerald-600 border border-white/10 text-gray-300 hover:text-white rounded-full p-1 shadow-lg transition-all"
                title={isChatExpanded ? "收起对话" : "展开对话"}
              >
                {isChatExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
            </div>

            <div className={`relative flex items-end gap-2 bg-black/20 border border-white/5 rounded-xl px-2 py-1 ${inputMode === 'voice' ? 'ring-1 ring-emerald-500/50' : ''}`}>

              {/* 模式切换 */}
              <button
                onClick={() => setInputMode(inputMode === 'text' ? 'voice' : 'text')}
                className={`p-3 rounded-lg transition-colors ${inputMode === 'voice' ? 'text-emerald-400' : 'text-gray-400 hover:text-white'}`}
              >
                {inputMode === 'text' ? <Mic size={20} /> : <Keyboard size={20} />}
              </button>

              {/* 输入框核心 */}
              <div className="flex-1 min-h-[44px] flex items-center">
                {inputMode === 'text' ? (
                  <textarea
                    rows={1}
                    className="w-full bg-transparent text-gray-100 placeholder-gray-500 py-3 focus:outline-none resize-none max-h-24 text-sm"
                    placeholder="发送消息..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                  />
                ) : (
                  <div
                    ref={voiceContainerRef}
                    className="w-full h-full flex items-center justify-center text-sm text-gray-400 select-none outline-none"
                    tabIndex={0}
                    onKeyDown={handleKeyDown}
                    onKeyUp={handleKeyUp}
                  >
                    {isRecording ? (
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-red-500 rounded-full animate-ping"></span>
                        <span className="text-emerald-400 font-bold">正在聆听... (松开结束)</span>
                      </div>
                    ) : (
                      <span>按住 <span className="font-bold text-gray-300 mx-1 border border-white/20 px-1 rounded">空格键</span> 说话</span>
                    )}


                  </div>
                )}
              </div>

              {/* 发送按钮 */}
              <button
                onClick={() => input.trim() ? sendMessage() : (isLoading ? stopGeneration() : sendMessage())}
                className={`p-3 rounded-lg transition-all ${input.trim() ? 'text-emerald-400 hover:bg-white/5' : 'text-gray-600'}`}
              >
                {isLoading && !input.trim() ? <div className="w-4 h-4 bg-red-500 rounded-sm animate-spin" /> : <Send size={20} />}
              </button>
            </div>
          </div>

        </div>
      </div>


      {/* 🟢 [重构] 宽屏设置弹窗 Modal (已完全适配动态主题变量) */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 p-4">
          <div className={`w-full max-w-4xl rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] border ${modalBg} ${modalBorder}`}>

            {/* 1. 弹窗标题栏 */}
            <div className={`h-16 px-8 flex items-center justify-between border-b ${modalHeaderBg} ${sectionBorder}`}>
              <div className={`flex items-center gap-3 font-semibold text-lg ${textMain}`}>
                <Settings size={20} className="text-emerald-500" />
                <span>系统控制台</span>
              </div>
              <button onClick={() => setIsSettingsOpen(false)} className={`p-2 rounded-full transition-colors ${isDark ? 'hover:bg-white/10 text-gray-400 hover:text-white' : 'hover:bg-gray-200 text-gray-500 hover:text-gray-900'}`}>
                <X size={24} />
              </button>
            </div>

            {/* 2. 弹窗内容区 (双栏布局) */}
            <div className="flex-1 overflow-y-auto p-8">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">

                {/* === 左栏：核心智能 === */}
                <div className="space-y-8">

                  {/* A. 模型配置 */}
                  <div className="space-y-4">
                    <h3 className={`text-sm font-bold text-emerald-500 uppercase tracking-wider flex items-center gap-2 border-b pb-2 ${sectionBorder}`}>
                      <Bot size={16} /> 核心智能 (Brain)
                    </h3>

                    <div className="space-y-2">
                      <label className={`text-xs ${textSub}`}>运行引擎</label>
                      <div className={`flex rounded-lg p-1.5 border ${toggleBg} ${sectionBorder}`}>
                        <button onClick={() => setLlmMode('local')} className={`flex-1 py-2 text-sm rounded-md transition-all font-medium ${llmMode === 'local' ? 'bg-emerald-600 text-white shadow-lg' : `${textSub} hover:text-emerald-500`}`}>Local (Ollama)</button>
                        <button onClick={() => setLlmMode('cloud')} className={`flex-1 py-2 text-sm rounded-md transition-all font-medium ${llmMode === 'cloud' ? 'bg-emerald-600 text-white shadow-lg' : `${textSub} hover:text-emerald-500`}`}>Cloud API</button>
                      </div>
                    </div>

                    {llmMode === 'cloud' && (
                      <div className={`space-y-4 p-5 rounded-xl border ${cardBg} ${sectionBorder}`}>
                        <div>
                          <label className={`text-xs mb-1.5 block ${textSub}`}>服务商 (Provider)</label>
                          <select value={selectedProvider} onChange={(e) => setSelectedProvider(e.target.value)} className={`w-full border rounded-lg px-3 py-2.5 text-sm outline-none appearance-none ${inputBg} ${modalBorder} ${inputFocus}`}>
                            {LLM_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>

                        {selectedProvider === 'custom' && (
                          <div>
                            <label className={`text-xs mb-1.5 block ${textSub}`}>API Base URL</label>
                            <input type="text" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="https://api.openai.com/v1" className={`w-full border rounded-lg px-3 py-2.5 text-sm outline-none ${inputBg} ${modalBorder} ${inputFocus}`} />
                          </div>
                        )}

                        <div>
                          <label className={`text-xs mb-1.5 block ${textSub}`}>API Key</label>
                          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." className={`w-full border rounded-lg px-3 py-2.5 text-sm outline-none font-mono ${inputBg} ${modalBorder} ${inputFocus}`} />
                        </div>

                        <div className="pt-2">
                          <div className="flex justify-between items-center mb-2">
                            <label className={`text-xs ${textSub}`}>选择模型</label>
                            <button onClick={fetchModels} disabled={isFetchingModels || !apiKey} className="text-xs text-emerald-500 hover:text-emerald-600 disabled:text-gray-400 flex items-center gap-1 transition-colors">
                              {isFetchingModels ? '正在获取...' : '⚡ 刷新列表'}
                            </button>
                          </div>

                          {availableModels.length > 0 ? (
                            <div className="relative group">
                              <input type="text" placeholder="🔍 搜索或输入模型名称..." value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} className={`w-full border rounded-t-lg px-3 py-2.5 text-sm outline-none border-b-0 ${inputBg} ${modalBorder} ${inputFocus}`} />
                              <div className={`w-full border rounded-b-lg max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-400 ${inputBg} ${modalBorder}`}>
                                {filteredModels.length > 0 ? (
                                  filteredModels.map(m => (
                                    <div key={m.id} onClick={() => handleModelSelect(m.id)} className={`px-3 py-2 text-sm cursor-pointer transition-colors flex justify-between items-center border-b last:border-0 ${sectionBorder} ${currentModel === m.id ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : `${textMain} ${hoverBg}`}`}>
                                      <span className="truncate pr-2" title={m.id}>{m.id}</span>
                                      {currentModel === m.id && <Check size={14} className="text-emerald-500 shrink-0" />}
                                    </div>
                                  ))
                                ) : (
                                  <div className={`px-3 py-4 text-xs text-center ${textSub}`}>没有找到相关模型</div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <input type="text" value={currentModel} onChange={(e) => setCurrentModel(e.target.value)} placeholder="输入模型名 (如 deepseek-chat)" className={`w-full border rounded-lg px-3 py-2.5 text-sm outline-none ${inputBg} ${modalBorder} ${inputFocus}`} />
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* TTS 配置区域 */}
                  <div className="space-y-4 relative">
                    <h3 className={`text-sm font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2 border-b pb-2 ${sectionBorder}`}>
                      <Volume2 size={16} /> 语音合成 (TTS)
                    </h3>

                    <div className="relative">
                      {ttsLoadingState !== 'idle' && (
                        <div className={`absolute inset-0 z-10 backdrop-blur-sm rounded-lg flex flex-col items-center justify-center border border-emerald-500/30 animate-in fade-in duration-200 ${isDark ? 'bg-[#1a1a1a]/90' : 'bg-white/90'}`}>
                          {ttsLoadingState === 'loading' && (
                            <>
                              <div className="flex items-center gap-2 text-emerald-500 font-medium text-sm mb-2">
                                <Loader2 size={18} className="animate-spin" />
                                <span>正在预加载本地模型...</span>
                              </div>
                              <div className="w-1/2 h-1 bg-gray-300 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full animate-[loading_2s_ease-in-out_infinite] w-full origin-left transform -translate-x-full"></div>
                              </div>
                              <p className={`text-[10px] mt-2 ${textSub}`}>RTX 4090 约需 3-5 秒</p>
                            </>
                          )}
                          {ttsLoadingState === 'success' && (
                            <div className="flex items-center gap-2 text-emerald-500 font-bold animate-in zoom-in duration-300">
                              <Check size={24} />
                              <span>本地 TTS 模型加载完成！</span>
                            </div>
                          )}
                        </div>
                      )}

                      <div className={`flex rounded-lg p-1.5 border ${toggleBg} ${sectionBorder}`}>
                        <button onClick={() => handleTtsSwitch('local')} disabled={ttsLoadingState !== 'idle'} className={`flex-1 py-2 text-sm rounded-md transition-all font-medium disabled:opacity-50 ${ttsMode === 'local' ? 'bg-emerald-600 text-white' : `${textSub} hover:text-emerald-500`}`}>Local Edge-TTS</button>
                        <button onClick={() => handleTtsSwitch('cloud')} disabled={ttsLoadingState !== 'idle'} className={`flex-1 py-2 text-sm rounded-md transition-all font-medium disabled:opacity-50 ${ttsMode === 'cloud' ? 'bg-emerald-600 text-white' : `${textSub} hover:text-emerald-500`}`}>Cloud Edge-TTS</button>
                      </div>
                    </div>
                  </div>

                  {ttsMode === 'local' && (
                    <div className={`mt-4 rounded-lg p-3 border ${cardBg} ${sectionBorder}`}>
                      <div className={`flex items-center gap-2 mb-3 border-b pb-2 ${sectionBorder}`}>
                        <span className={`text-xs font-bold ${textMain}`}>🎭 情感强度调节 (IndexTTS2)</span>
                      </div>
                      <p className={`text-[10px] mb-3 ${textSub}`}>提示：数值越大情感越夸张，过大(&gt;1.0)可能导致吞字或破音。</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                        {Object.keys(ttsConfig.emotionAlphas).map((emo) => (
                          <div key={emo}>
                            <div className={`flex justify-between text-xs mb-1 ${textSub}`}>
                              <span>{emo}</span>
                              <span className="font-mono text-emerald-500">{ttsConfig.emotionAlphas[emo].toFixed(1)}</span>
                            </div>
                            <input type="range" min="0.1" max="1.5" step="0.1" value={ttsConfig.emotionAlphas[emo]} onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setTtsConfig(prev => ({ ...prev, emotionAlphas: { ...prev.emotionAlphas, [emo]: val } }));
                            }} className="w-full h-1.5 bg-gray-300 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* === 右栏：交互与视觉 === */}
                <div className={`space-y-8 lg:border-l lg:pl-10 ${sectionBorder}`}>

                  {/* B. 麦克风设置 */}
                  <div className="space-y-4">
                    <h3 className={`text-sm font-bold text-emerald-500 uppercase tracking-wider flex items-center gap-2 border-b pb-2 ${sectionBorder}`}>
                      <Mic size={16} /> 交互输入 (Input)
                    </h3>
                    <div className="space-y-2">
                      <label className={`text-xs ${textSub}`}>麦克风设备</label>
                      <div className="relative">
                        <select value={selectedDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)} className={`w-full border rounded-lg px-4 py-3 text-sm outline-none appearance-none ${inputBg} ${modalBorder} ${inputFocus}`}>
                          {audioDevices.map(device => (
                            <option key={device.deviceId} value={device.deviceId} className={isDark ? "bg-[#1a1a1a]" : "bg-white"}>
                              {device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
                            </option>
                          ))}
                        </select>
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                          <ChevronDown size={16} />
                        </div>
                      </div>
                      <p className={`text-[10px] pt-1 ${textSub}`}>* 提示：若无法识别，请检查浏览器麦克风权限或尝试切换设备。</p>
                    </div>
                  </div>

                  {/* C. 外观设置 */}
                  <div className="space-y-6">
                    <h3 className={`text-sm font-bold text-emerald-500 uppercase tracking-wider flex items-center gap-2 border-b pb-2 ${sectionBorder}`}>
                      <Sliders size={16} /> 视觉表现 (Visuals)
                    </h3>

                    <div className="space-y-3">
                      <label className={`text-xs ${textSub}`}>系统主题</label>
                      <div className={`flex rounded-lg p-1.5 border ${toggleBg} ${sectionBorder}`}>
                        <button onClick={() => setTheme('light')} className={`flex-1 py-2 text-sm rounded-md transition-all font-medium flex items-center justify-center gap-2 ${theme === 'light' ? 'bg-white text-emerald-600 shadow-md border border-gray-200' : `${textSub} hover:text-emerald-600`}`}>
                          ☀️ 明亮 (Light)
                        </button>
                        <button onClick={() => setTheme('dark')} className={`flex-1 py-2 text-sm rounded-md transition-all font-medium flex items-center justify-center gap-2 ${theme === 'dark' ? 'bg-[#1a1a1a] text-emerald-500 shadow-md border border-white/10' : `${textSub} hover:text-emerald-500`}`}>
                          🌙 暗黑 (Dark)
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className={`text-xs ${textSub}`}>数字人形象</label>
                      <div className="grid grid-cols-2 gap-4">
                        {SKIN_CONFIG.map((skin) => (
                          <button key={skin.id} onClick={() => setCurrentSkin(skin.id)} className={`relative group overflow-hidden rounded-xl border-2 transition-all duration-300 h-24 flex flex-col items-center justify-center gap-2 ${currentSkin === skin.id ? 'bg-emerald-500/10 border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.15)]' : `${isDark ? 'bg-black/40 border-white/5 hover:border-white/20' : 'bg-gray-50 border-gray-200 hover:border-gray-400'}`}`}>
                            <span className={`font-medium text-sm transition-colors ${currentSkin === skin.id ? 'text-emerald-500' : `${isDark ? 'text-gray-400 group-hover:text-white' : 'text-gray-600 group-hover:text-gray-900'}`}`}>{skin.name}</span>
                            {currentSkin === skin.id && <div className="absolute top-2 right-2 w-2 h-2 bg-emerald-500 rounded-full shadow-[0_0_5px_#10b981]"></div>}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3 pt-2">
                      <div className={`flex justify-between text-xs ${textSub}`}>
                        <span>背景遮罩浓度</span>
                        <span className="font-mono text-emerald-500">{Math.round(bgOpacity * 100)}%</span>
                      </div>
                      <input type="range" min="0" max="0.9" step="0.05" value={bgOpacity} onChange={(e) => setBgOpacity(parseFloat(e.target.value))} className="w-full h-2 bg-gray-300 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                    </div>

                    <div className={`flex items-center justify-between p-4 rounded-xl border ${cardBg} ${sectionBorder}`}>
                      <div className="flex items-center gap-3">
                        {isFullscreen ? <Minimize size={20} className="text-gray-400" /> : <Maximize size={20} className="text-gray-400" />}
                        <div className="flex flex-col">
                          <span className={`text-sm ${textMain}`}>全屏沉浸模式</span>
                          <span className={`text-[10px] ${textSub}`}>隐藏浏览器界面元素</span>
                        </div>
                      </div>
                      <button onClick={toggleFullscreen} className={`w-14 h-7 rounded-full transition-colors relative ${isFullscreen ? 'bg-emerald-500' : 'bg-gray-400 dark:bg-gray-600'}`}>
                        <div className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-300 ${isFullscreen ? 'translate-x-7' : 'translate-x-0'}`} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. 底部按钮 */}
            <div className={`p-6 border-t flex justify-end gap-4 ${modalBg} ${sectionBorder}`}>
              <button onClick={() => setIsSettingsOpen(false)} className="px-8 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-lg shadow-lg hover:shadow-emerald-500/20 transition-all transform hover:-translate-y-0.5">
                完成设置
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 录音全屏提示 */}
      {isRecording && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-none">
          <div className="flex flex-col items-center justify-center p-8 bg-black/70 backdrop-blur-md rounded-3xl animate-in fade-in zoom-in duration-200">
            <div className="w-20 h-20 bg-red-500/80 rounded-full animate-ping absolute"></div>
            <Mic size={40} className="text-white relative z-10" />
            <div className="mt-4 text-white font-bold tracking-widest">LISTENING</div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes loading {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }
      `}</style>

    </div>
  );
}

export default App;