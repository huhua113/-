import React, { useState, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import { 
  Search, 
  Video, 
  Image as ImageIcon, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink,
  ChevronRight,
  Play,
  RotateCcw,
  Key,
  LogIn,
  LogOut,
  User as UserIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  generateMedicalScript, 
  Storyboard, 
  GenerationResult 
} from './services/gemini';
import { generateDoubaoImage } from './services/doubaoService';
import { auth, db, googleProvider, signInWithPopup, onAuthStateChanged, User } from './firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

// Error Boundary Component
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4">
          <div className="bg-white/5 border border-white/10 p-8 rounded-2xl max-w-md w-full text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">出错了</h2>
            <p className="text-white/60 mb-6 text-sm">
              {this.state.error?.message || "应用程序遇到了一个意外错误。"}
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-white text-black rounded-full font-medium hover:bg-white/90 transition-colors"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

function App() {
  const [topic, setTopic] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [step, setStep] = useState<'input' | 'result'>('input');
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    checkApiKey();
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error("登录失败:", err);
      setError("登录失败，请重试。");
    }
  };

  const handleLogout = () => auth.signOut();

  const checkApiKey = async () => {
    if (window.aistudio) {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      setHasApiKey(hasKey);
    }
  };

  const handleOpenKeySelector = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true); // Assume success per guidelines
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;

    console.log(">>> 开始生成流程，主题:", topic);
    
    // 如果没有 API Key，先引导选择 (仅在本地或没有环境变量时)
    if (!hasApiKey && !process.env.GEMINI_API_KEY && !import.meta.env.VITE_GEMINI_API_KEY) {
      await handleOpenKeySelector();
      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (!hasKey) return;
    }

    setIsLoading(true);
    setError(null);
    setLoadingStatus('初始化医学科普工作流...');
    
    try {
      // 1. 生成文案
      const data = await generateMedicalScript(topic, (status) => {
        setLoadingStatus(status);
      });
      console.log(">>> 生成成功:", data);

      // 2. 尝试保存到 Firestore (可选，不影响主流程)
      if (user) {
        try {
          const path = 'scripts';
          await addDoc(collection(db, path), {
            topic,
            script: data.script,
            storyboards: data.storyboards,
            sources: data.sources || [],
            uid: user.uid,
            createdAt: serverTimestamp()
          });
        } catch (fsErr) {
          console.warn("保存到 Firestore 失败 (静默失败):", fsErr);
        }
      }

      setResult(data);
      setStep('result');
    } catch (err: any) {
      console.error("生成过程出错:", err);
      let errorMessage = "生成失败，请稍后重试。";
      
      if (err.message?.includes("API_KEY_INVALID")) {
        errorMessage = "API Key 无效，请检查配置。";
      } else if (err.message?.includes("SAFETY")) {
        errorMessage = "生成内容触发了安全过滤，请尝试更换主题。";
      } else if (err.message?.includes("quota")) {
        errorMessage = "API 配额已耗尽，请稍后再试。";
      } else {
        errorMessage = `生成出错: ${err.message || '未知错误'}`;
      }
      
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateImage = async (storyboardId: number) => {
    if (!hasApiKey) {
      await handleOpenKeySelector();
      return;
    }

    if (!result) return;

    const newStoryboards = [...result.storyboards];
    const index = newStoryboards.findIndex(s => s.id === storyboardId);
    if (index === -1) return;

    newStoryboards[index].isGenerating = true;
    setResult({ ...result, storyboards: newStoryboards });

    try {
      const imageUrl = await generateDoubaoImage(newStoryboards[index].prompt);
      newStoryboards[index].imageUrl = imageUrl;
    } catch (err: any) {
      console.error(err);
      if (err.message?.includes("Requested entity was not found")) {
        setHasApiKey(false);
        setError("API Key 验证失败，请重新选择。");
      } else {
        setError(`生成分镜 ${storyboardId} 图片失败。`);
      }
    } finally {
      newStoryboards[index].isGenerating = false;
      setResult({ ...result, storyboards: newStoryboards });
    }
  };

  const handleGenerateAllImages = async () => {
    console.log(">>> [App] handleGenerateAllImages clicked");
    if (!hasApiKey) {
      await handleOpenKeySelector();
      return;
    }
    if (!result) return;

    for (const sb of result.storyboards) {
      if (!sb.imageUrl) {
        await handleGenerateImage(sb.id);
      }
    }
  };

  return (
    <div className="min-h-screen bg-[url('https://i.imgur.com/h07BKFv.jpeg')] bg-cover bg-center bg-fixed text-zinc-800 font-sans selection:bg-pink-200">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur-md border-b-2 border-amber-200 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-amber-400 rounded-full flex items-center justify-center text-white shadow-md border-2 border-white">
              <span className="text-xl">🐶</span>
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-amber-900">无穷科普</h1>
              <p className="text-[10px] text-amber-700 font-medium uppercase tracking-wider opacity-70">Doodle Science</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {user && (
              <div className="flex items-center gap-2 pl-3 border-l-2 border-amber-200">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="Avatar" className="w-8 h-8 rounded-full border-2 border-amber-200" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-pink-100 flex items-center justify-center text-pink-500 border-2 border-pink-200">
                    <UserIcon size={16} />
                  </div>
                )}
                <button 
                  onClick={handleLogout}
                  className="p-2 text-zinc-400 hover:text-red-500 transition-colors"
                  title="退出登录"
                >
                  <LogOut size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          {step === 'input' ? (
            <motion.div 
              key="input"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-xl mx-auto text-center space-y-6"
            >
              <div className="space-y-2">
                <h2 className="text-3xl font-bold tracking-tight sm:text-4xl text-amber-900">
                  让科普像 <span className="text-pink-500 font-black">毛蛋</span> 一样可爱
                </h2>
                <p className="text-base text-zinc-600 max-w-sm mx-auto font-medium">
                  输入主题，我将为您检索文献，生成科普文案及视觉分镜。
                </p>
              </div>

              <form onSubmit={handleGenerate} className="relative group">
                <div className="relative flex items-center bg-white rounded-full shadow-lg border-4 border-amber-200 overflow-hidden focus-within:ring-4 focus-within:ring-pink-200 transition-all">
                  <div className="pl-4 text-amber-400">
                    <Search size={20} />
                  </div>
                  <input 
                    type="text" 
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="例如：小狗为什么喜欢摇尾巴..."
                    className="flex-1 px-3 py-5 text-base outline-none placeholder:text-zinc-400"
                    disabled={isLoading}
                  />
                  <button 
                    type="submit"
                    disabled={isLoading || !topic.trim()}
                    className="mr-1 px-6 py-3 bg-amber-400 text-white rounded-full font-bold hover:bg-amber-500 disabled:opacity-50 transition-all flex items-center gap-2 min-h-[44px] shadow-md"
                  >
                    {isLoading ? <Loader2 className="animate-spin" size={18} /> : <ChevronRight size={18} />}
                    <span className="hidden sm:inline">{isLoading ? '生成中...' : '生成'}</span>
                  </button>
                </div>
              </form>

              <div className="flex flex-wrap justify-center gap-2">
                {['高血压防治', '流感季防护', '近视手术', '备孕指南'].map((tag) => (
                  <button 
                    key={tag}
                    onClick={() => setTopic(tag)}
                    className="px-4 py-2 bg-white border-2 border-amber-200 rounded-full text-xs text-amber-800 font-bold hover:border-pink-300 hover:text-pink-600 transition-all shadow-sm"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="result"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-6"
            >
              {/* Left Column: Script */}
              <div className="lg:col-span-1 space-y-4">
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-zinc-200 lg:sticky lg:top-20">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <Video className="text-indigo-600" size={18} />
                      科普文案
                    </h3>
                    <button 
                      onClick={() => setStep('input')}
                      className="p-2 hover:bg-zinc-100 rounded-full transition-colors text-zinc-500"
                    >
                      <RotateCcw size={16} />
                    </button>
                  </div>
                  
                  <div className="prose prose-indigo max-w-none text-zinc-600 leading-relaxed text-sm">
                    <ReactMarkdown>{result?.script || ''}</ReactMarkdown>
                  </div>
                </div>
              </div>

              {/* Right Column: Storyboards */}
              <div className="lg:col-span-2 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <ImageIcon className="text-indigo-600" size={18} />
                    视觉分镜 (9)
                  </h3>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        const allPrompts = result?.storyboards.map(s => s.prompt).join('\n\n');
                        if (allPrompts) {
                          navigator.clipboard.writeText(allPrompts);
                          alert('提示词已复制到剪贴板');
                        }
                      }}
                      className="px-3 py-1.5 bg-amber-100 text-amber-800 rounded-full text-[10px] font-bold hover:bg-amber-200 transition-colors"
                    >
                      复制全部提示词
                    </button>
                    <button 
                      onClick={() => {
                        console.log(">>> [App] Button clicked directly");
                        handleGenerateAllImages();
                      }}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-full text-xs font-medium hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-sm min-h-[40px]"
                    >
                      <Play size={14} />
                      <span>一键生成</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {result?.storyboards.map((sb) => (
                    <motion.div 
                      key={sb.id}
                      layout
                      className="bg-white rounded-2xl overflow-hidden border border-zinc-200 shadow-sm group hover:shadow-md transition-all"
                    >
                      <div className="aspect-video bg-zinc-100 relative overflow-hidden">
                        {sb.imageUrl ? (
                          <img 
                            src={sb.imageUrl} 
                            alt={sb.description} 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
                            {sb.isGenerating ? (
                              <div className="flex flex-col items-center gap-2">
                                <Loader2 className="animate-spin text-indigo-600" size={24} />
                                <p className="text-xs text-zinc-500 font-medium">AI 绘制中...</p>
                              </div>
                            ) : (
                              <button 
                                onClick={() => handleGenerateImage(sb.id)}
                                className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center text-indigo-600 hover:scale-105 transition-transform z-20 relative"
                              >
                                <ImageIcon size={18} />
                              </button>
                            )}
                          </div>
                        )}
                        <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-black/40 backdrop-blur-sm text-white flex items-center justify-center text-[10px] font-bold">
                          {sb.id}
                        </div>
                      </div>
                      <div className="p-4 space-y-2">
                        <textarea 
                          value={sb.description}
                          onChange={(e) => {
                            const newResult = { ...result! };
                            newResult.storyboards[newResult.storyboards.findIndex(s => s.id === sb.id)].description = e.target.value;
                            setResult(newResult);
                          }}
                          className="w-full text-xs font-medium leading-relaxed bg-transparent border-none focus:ring-0 resize-none text-zinc-800"
                          rows={2}
                        />
                        <textarea 
                          value={sb.prompt}
                          onChange={(e) => {
                            const newResult = { ...result! };
                            newResult.storyboards[newResult.storyboards.findIndex(s => s.id === sb.id)].prompt = e.target.value;
                            setResult(newResult);
                          }}
                          className="w-full text-[10px] text-zinc-500 italic opacity-70 hover:opacity-100 transition-opacity bg-transparent border-none focus:ring-0 resize-none"
                          rows={2}
                        />
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 px-6 py-4 bg-red-50 border border-red-200 rounded-2xl shadow-2xl flex items-center gap-3 text-red-700"
          >
            <AlertCircle size={20} />
            <span className="font-medium">{error}</span>
            <button onClick={() => setError(null)} className="ml-4 text-xs font-bold uppercase tracking-widest opacity-60 hover:opacity-100">关闭</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
    </div>
  );
}
