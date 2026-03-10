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
  generateStoryboardImage, 
  Storyboard, 
  GenerationResult 
} from './services/gemini';
import { auth, db, googleProvider, signInWithPopup, onAuthStateChanged, User, handleFirestoreError, OperationType } from './firebase';
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
    
    // 如果没有 API Key，先引导选择
    if (!hasApiKey && !process.env.GEMINI_API_KEY) {
      await handleOpenKeySelector();
      // 检查是否成功选择了 Key
      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (!hasKey) return;
    }

    setIsLoading(true);
    setError(null);
    setLoadingStatus('初始化医学科普工作流...');
    
    try {
      const data = await generateMedicalScript(topic, (status) => {
        setLoadingStatus(status);
      });
      console.log(">>> 生成成功:", data);

      // 保存到 Firestore
      if (user) {
        setLoadingStatus('正在保存到云端...');
        const path = 'scripts';
        try {
          await addDoc(collection(db, path), {
            topic,
            script: data.script,
            storyboards: data.storyboards,
            sources: data.sources || [],
            uid: user.uid,
            createdAt: serverTimestamp()
          });
        } catch (fsErr) {
          handleFirestoreError(fsErr, OperationType.CREATE, path);
        }
      }

      setResult(data);
      setStep('result');
    } catch (err: any) {
      console.error("前端捕获错误:", err);
      setError(`生成失败: ${err.message || '未知错误'}。请检查控制台或 API Key 配置。`);
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
      const imageUrl = await generateStoryboardImage(newStoryboards[index].prompt);
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
    <div className="min-h-screen bg-[#f5f5f5] text-[#1a1a1a] font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-black/5 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-emerald-200">
              <Video size={24} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">医影科普助手</h1>
              <p className="text-xs text-muted font-medium uppercase tracking-wider opacity-60">Medical Science Workflow</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {!hasApiKey && (
              <button 
                onClick={handleOpenKeySelector}
                className="hidden sm:flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-full text-sm font-medium border border-amber-200 hover:bg-amber-100 transition-colors"
              >
                <Key size={16} />
                <span>配置绘图 Key</span>
              </button>
            )}

            {user ? (
              <div className="flex items-center gap-3 pl-4 border-l border-black/5">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-medium leading-none">{user.displayName || '用户'}</p>
                  <p className="text-[10px] text-muted mt-1">{user.email}</p>
                </div>
                {user.photoURL ? (
                  <img src={user.photoURL} alt="Avatar" className="w-9 h-9 rounded-full border border-black/5" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                    <UserIcon size={18} />
                  </div>
                )}
                <button 
                  onClick={handleLogout}
                  className="p-2 text-muted hover:text-red-500 transition-colors"
                  title="退出登录"
                >
                  <LogOut size={18} />
                </button>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="flex items-center gap-2 px-6 py-2 bg-black text-white rounded-full text-sm font-medium hover:bg-black/80 transition-all"
              >
                <LogIn size={16} />
                <span>登录</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {step === 'input' ? (
            <motion.div 
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-2xl mx-auto text-center space-y-8"
            >
              <div className="space-y-4">
                <h2 className="text-4xl font-light tracking-tight sm:text-5xl">
                  让医学科普更具 <span className="text-emerald-600 font-medium">生命力</span>
                </h2>
                <p className="text-lg text-muted max-w-lg mx-auto">
                  输入医学主题，我们将为您检索权威文献，生成专业的科普文案与视觉分镜。
                </p>
              </div>

              <form onSubmit={handleGenerate} className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl blur opacity-20 group-hover:opacity-30 transition duration-1000 group-hover:duration-200"></div>
                <div className="relative flex items-center bg-white rounded-2xl shadow-xl overflow-hidden border border-black/5">
                  <div className="pl-6 text-muted">
                    <Search size={24} />
                  </div>
                  <input 
                    type="text" 
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="例如：糖尿病患者的饮食误区、如何预防颈椎病..."
                    className="flex-1 px-4 py-6 text-lg outline-none placeholder:text-muted/50"
                    disabled={isLoading}
                  />
                  <button 
                    type="submit"
                    disabled={isLoading || !topic.trim()}
                    className="mr-2 px-8 py-4 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:hover:bg-emerald-600 transition-all flex items-center gap-2"
                  >
                    {isLoading ? <Loader2 className="animate-spin" size={20} /> : <ChevronRight size={20} />}
                    <div className="flex flex-col items-start leading-none">
                      <span>{isLoading ? '生成中...' : '开始生成'}</span>
                      {isLoading && loadingStatus && (
                        <span className="text-[10px] opacity-70 mt-1 font-normal">{loadingStatus}</span>
                      )}
                    </div>
                  </button>
                </div>
              </form>

              <div className="flex flex-wrap justify-center gap-3">
                {['高血压防治', '流感季防护', '近视手术科普', '备孕指南'].map((tag) => (
                  <button 
                    key={tag}
                    onClick={() => setTopic(tag)}
                    className="px-4 py-2 bg-white border border-black/5 rounded-full text-sm text-muted hover:border-emerald-200 hover:text-emerald-600 transition-all"
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
              className="grid grid-cols-1 lg:grid-cols-3 gap-8"
            >
              {/* Left Column: Script */}
              <div className="lg:col-span-1 space-y-6">
                <div className="bg-white rounded-3xl p-8 shadow-sm border border-black/5 sticky top-28">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-semibold flex items-center gap-2">
                      <Video className="text-emerald-600" size={20} />
                      科普文案
                    </h3>
                    <button 
                      onClick={() => setStep('input')}
                      className="p-2 hover:bg-gray-100 rounded-full transition-colors text-muted"
                    >
                      <RotateCcw size={18} />
                    </button>
                  </div>
                  
                  <div className="prose prose-emerald max-w-none text-muted leading-relaxed">
                    <ReactMarkdown>{result?.script || ''}</ReactMarkdown>
                  </div>

                  {result?.sources && result.sources.length > 0 && (
                    <div className="mt-8 pt-6 border-t border-black/5">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-muted mb-4 opacity-60">参考来源</h4>
                      <ul className="space-y-2">
                        {result.sources.map((source, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm group">
                            <ExternalLink size={14} className="mt-1 text-emerald-600 shrink-0" />
                            <a 
                              href={source.uri} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="hover:text-emerald-600 transition-colors line-clamp-1"
                            >
                              {source.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Storyboards */}
              <div className="lg:col-span-2 space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-semibold flex items-center gap-2">
                    <ImageIcon className="text-emerald-600" size={20} />
                    视觉分镜 (9)
                  </h3>
                  <button 
                    onClick={handleGenerateAllImages}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-full text-sm font-medium hover:bg-emerald-700 transition-all flex items-center gap-2 shadow-lg shadow-emerald-100"
                  >
                    <Play size={14} />
                    <span>一键生成所有图片</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {result?.storyboards.map((sb) => (
                    <motion.div 
                      key={sb.id}
                      layout
                      className="bg-white rounded-3xl overflow-hidden border border-black/5 shadow-sm group hover:shadow-md transition-all"
                    >
                      <div className="aspect-video bg-muted relative overflow-hidden">
                        {sb.imageUrl ? (
                          <img 
                            src={sb.imageUrl} 
                            alt={sb.description} 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                            {sb.isGenerating ? (
                              <div className="flex flex-col items-center gap-3">
                                <Loader2 className="animate-spin text-emerald-600" size={32} />
                                <p className="text-sm text-muted font-medium">AI 正在绘制中...</p>
                              </div>
                            ) : (
                              <button 
                                onClick={() => handleGenerateImage(sb.id)}
                                className="w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center text-emerald-600 hover:scale-110 transition-transform"
                              >
                                <ImageIcon size={24} />
                              </button>
                            )}
                          </div>
                        )}
                        <div className="absolute top-4 left-4 w-8 h-8 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center text-xs font-bold">
                          {sb.id}
                        </div>
                      </div>
                      <div className="p-6 space-y-3">
                        <p className="text-sm font-medium leading-relaxed">{sb.description}</p>
                        <p className="text-xs text-muted italic line-clamp-2 opacity-60 group-hover:opacity-100 transition-opacity">
                          Prompt: {sb.prompt}
                        </p>
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
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-black/5 text-center">
        <p className="text-sm text-muted">
          &copy; {new Date().getFullYear()} 医影科普助手 &middot; 基于 Google Gemini 驱动
        </p>
      </footer>
    </div>
  );
}
