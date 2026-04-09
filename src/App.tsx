import React, { useState, useEffect, useRef } from 'react';
import { auth, db, storage } from './firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  signInAnonymously,
  updateProfile,
  User as FirebaseUser
} from 'firebase/auth';
import { collection, onSnapshot, query, orderBy, limit, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { 
  Palette, 
  Users, 
  Play, 
  LogIn, 
  Trophy,
  ArrowRight,
  Loader2,
  Info,
  LogOut,
  Sparkles,
  MessageSquare,
  Camera,
  PenTool,
  Copy,
  CheckCircle2,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { firestoreService } from './lib/firestoreService';
import { generateImageFromDescription, getAIFeedback } from './lib/gemini';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './components/ui/card';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import { Separator } from './components/ui/separator';
import { Label } from './components/ui/label';
import { ErrorBoundary } from './components/ErrorBoundary';

// --- Types ---
type Role = 'teacher' | 'student';
type GameStatus = 'lobby' | 'describing' | 'voting' | 'results' | 'finished';

interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: Role;
}

interface Game {
  id: string;
  code: string;
  teacherId: string;
  status: GameStatus;
  currentRound: number;
  maxRounds: number;
  artworkUrl: string;
  artworkTitle: string;
}

interface Submission {
  id: string;
  userId: string;
  userName: string;
  description: string;
  voteCount: number;
}

interface RoundResult {
  roundNumber: number;
  winningDescription: string;
  winningUserName: string;
  generatedImageUrl: string;
  aiFeedback?: string;
}

// --- Constants ---
const DEFAULT_ARTWORKS = [
  { title: '별이 빛나는 밤', artist: '빈센트 반 고흐', url: 'https://images.unsplash.com/photo-1578301978693-85fa9c0320b9?q=80&w=1000&auto=format&fit=crop' },
  { title: '진주 귀걸이를 한 소녀', artist: '요하네스 베르메르', url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?q=80&w=1000&auto=format&fit=crop' },
  { title: '절규', artist: '에드바르트 뭉크', url: 'https://images.unsplash.com/photo-1577083552431-6e5fd01aa342?q=80&w=1000&auto=format&fit=crop' },
  { title: '모나리자', artist: '레오나르도 다 빈치', url: 'https://images.unsplash.com/photo-1582555172866-f73bb12a2ab3?q=80&w=1000&auto=format&fit=crop' },
  { title: '기억의 지속', artist: '살바도르 달리', url: 'https://images.unsplash.com/photo-1549490349-8643362247b5?q=80&w=1000&auto=format&fit=crop' },
  { title: '키스', artist: '구스타프 클림트', url: 'https://images.unsplash.com/photo-1576448447660-39c20832ecb6?q=80&w=1000&auto=format&fit=crop' }
];

// --- Main App Component ---
export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentGameId, setCurrentGameId] = useState<string | null>(null);
  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [view, setView] = useState<'main' | 'hallOfFame' | 'description'>('main');

  const handleGoogleLogin = async (role: Role = 'teacher') => {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      
      const result = await signInWithPopup(auth, provider);
      const u = result.user;
      
      const existingProfile = await firestoreService.getUser(u.uid);
      if (!existingProfile) {
        const newProfile: UserProfile = {
          uid: u.uid,
          name: u.displayName || (role === 'teacher' ? '선생님' : '학생'),
          email: u.email || '',
          role: role
        };
        await firestoreService.createUser(u.uid, newProfile);
        setProfile(newProfile);
      } else {
        setProfile(existingProfile as UserProfile);
      }
      setView('main');
    } catch (error: any) {
      console.error("Google Login Error:", error);
      if (error.code === 'auth/unauthorized-domain') {
        alert("오류: 현재 도메인이 Firebase에 등록되지 않았습니다. Firebase 콘솔에서 도메인을 추가해 주세요.");
      } else if (error.code === 'auth/popup-blocked') {
        alert("팝업이 차단되었습니다. 브라우저 설정에서 팝업을 허용해 주세요.");
      } else if (error.code !== 'auth/cancelled-popup-request') {
        alert("로그인 중 오류가 발생했습니다: " + error.message);
      }
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const p = await firestoreService.getUser(u.uid);
        if (p) {
          setProfile(p as UserProfile);
        } else if (u.isAnonymous) {
          setProfile({
            uid: u.uid,
            name: u.displayName || '익명 학생',
            email: '',
            role: 'student'
          });
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
    setProfile(null);
    setCurrentGameId(null);
    setIsCreatingGame(false);
    setView('main');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <motion.div 
          animate={{ rotate: 360 }} 
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        >
          <Palette className="w-12 h-12 text-blue-500" />
        </motion.div>
      </div>
    );
  }

  if (currentGameId && profile) {
    return (
      <ErrorBoundary>
        <GameRoom 
          gameId={currentGameId} 
          profile={profile} 
          onExit={() => {
            setCurrentGameId(null);
            setIsCreatingGame(false);
          }} 
        />
      </ErrorBoundary>
    );
  }

  if (isCreatingGame && profile?.role === 'teacher') {
    return (
      <ErrorBoundary>
        <TeacherDashboard 
          profile={profile} 
          onJoinGame={(id) => {
            setCurrentGameId(id);
            setIsCreatingGame(false);
          }} 
          onBack={() => setIsCreatingGame(false)}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-900 selection:bg-blue-100">
        {view === 'main' && (
          <MainScreen 
            user={user} 
            profile={profile} 
            onViewHallOfFame={() => setView('hallOfFame')}
            onViewDescription={() => setView('description')}
            onJoinGame={setCurrentGameId}
            onCreateGame={() => setIsCreatingGame(true)}
            onLogout={handleLogout}
            onGoogleLogin={handleGoogleLogin}
          />
        )}
        {view === 'hallOfFame' && (
          <HallOfFame onBack={() => setView('main')} />
        )}
        {view === 'description' && (
          <DescriptionPage onBack={() => setView('main')} />
        )}
      </div>
    </ErrorBoundary>
  );
}

// --- Sub-components ---

function MainScreen({ 
  user, 
  profile, 
  onViewHallOfFame, 
  onViewDescription, 
  onJoinGame,
  onCreateGame,
  onLogout,
  onGoogleLogin
}: any) {
  const [nickname, setNickname] = useState('');
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');

  const handleStudentJoin = async () => {
    if (!nickname.trim()) return alert("닉네임을 입력해주세요.");
    if (code.length !== 6) return alert("6자리 코드를 입력해주세요.");
    
    setJoining(true);
    try {
      const game = await firestoreService.getGameByCode(code);
      if (game) {
        const cred = await signInAnonymously(auth);
        await updateProfile(cred.user, { displayName: nickname });
        onJoinGame(game.id);
      } else {
        alert("유효하지 않은 코드입니다. 코드를 다시 확인해 주세요.");
      }
    } catch (error: any) {
      alert("입장 중 오류가 발생했습니다: " + error.message);
    }
    setJoining(false);
  };

  return (
    <div className="relative min-h-screen flex flex-col overflow-hidden">
      {/* Background Accents */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-400/10 blur-[120px] rounded-full" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-orange-400/10 blur-[120px] rounded-full" />

      <div className="max-w-7xl mx-auto w-full px-6 py-12 md:py-20 flex-1 flex flex-col">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-8 mb-16">
          <motion.div 
            initial={{ opacity: 0, x: -20 }} 
            animate={{ opacity: 1, x: 0 }}
            className="text-center md:text-left"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-full text-sm font-bold mb-6">
              <Sparkles className="w-4 h-4" />
              AI와 함께하는 미술 감상
            </div>
            <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-slate-900 mb-6">
              ACE <span className="text-blue-600">CANVAS</span>
            </h1>
            <p className="text-xl text-slate-500 max-w-lg font-medium leading-relaxed">
              그림을 묘사하고, AI가 그리는 새로운 걸작을 만나보세요. 
              친구들과 함께하는 실시간 미술 퀴즈 게임!
            </p>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }} 
            animate={{ opacity: 1, scale: 1 }}
            className="relative w-full max-w-md aspect-square"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-purple-600 rounded-[3rem] rotate-3 opacity-10" />
            <img 
              src="https://picsum.photos/seed/art-main/800/800" 
              alt="Art" 
              className="w-full h-full object-cover rounded-[3rem] shadow-2xl relative z-10"
              referrerPolicy="no-referrer"
            />
          </motion.div>
        </div>

        {/* Action Cards */}
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Student Card */}
          <Card className="rounded-[2.5rem] border-none shadow-xl bg-white p-2">
            <div className="bg-blue-50 rounded-[2rem] p-8 h-full flex flex-col">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
                  <Play className="w-6 h-6 text-white fill-white" />
                </div>
                <h2 className="text-3xl font-black tracking-tighter">학생 입장</h2>
              </div>
              
              <div className="space-y-4 flex-1">
                <div className="space-y-2">
                  <Label className="text-slate-500 font-bold ml-1">닉네임</Label>
                  <Input 
                    placeholder="멋진 이름을 입력하세요" 
                    value={nickname} 
                    onChange={(e) => setNickname(e.target.value)} 
                    className="h-14 rounded-2xl border-none bg-white shadow-sm text-lg font-medium" 
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-500 font-bold ml-1">입장 코드</Label>
                  <Input 
                    placeholder="6자리 코드" 
                    value={code} 
                    onChange={(e) => setCode(e.target.value)} 
                    maxLength={6} 
                    className="h-14 rounded-2xl border-none bg-white shadow-sm text-center font-black text-2xl tracking-[0.5em] text-blue-600" 
                  />
                </div>
              </div>

              <Button 
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-8 rounded-2xl text-xl font-black shadow-xl shadow-blue-100 mt-8 transition-all hover:scale-[1.02] active:scale-95" 
                onClick={handleStudentJoin} 
                disabled={joining}
              >
                {joining ? <Loader2 className="animate-spin" /> : "입장하기"}
              </Button>
            </div>
          </Card>

          {/* Teacher Card */}
          <Card className="rounded-[2.5rem] border-none shadow-xl bg-white p-2">
            <div className="bg-slate-900 rounded-[2rem] p-8 h-full flex flex-col text-white">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-lg">
                  <Users className="w-6 h-6 text-slate-900" />
                </div>
                <h2 className="text-3xl font-black tracking-tighter">선생님 메뉴</h2>
              </div>
              
              <p className="text-slate-400 font-medium mb-8 leading-relaxed">
                수업용 게임 세션을 생성하고 학생들의 활동을 관리할 수 있습니다.
              </p>

              <div className="mt-auto space-y-4">
                {user && profile?.role === 'teacher' ? (
                  <>
                    <Button 
                      className="w-full bg-orange-500 hover:bg-orange-600 text-white py-8 rounded-2xl text-xl font-black shadow-xl shadow-orange-900/20 transition-all hover:scale-[1.02]" 
                      onClick={onCreateGame}
                    >
                      <Sparkles className="w-6 h-6 mr-2" />
                      수업 시작하기
                    </Button>
                    <Button variant="ghost" className="w-full text-slate-500 hover:text-white" onClick={onLogout}>
                      <LogOut className="w-4 h-4 mr-2" /> 로그아웃
                    </Button>
                  </>
                ) : (
                  <Button 
                    className="w-full bg-white text-slate-900 hover:bg-slate-100 py-8 rounded-2xl text-xl font-black shadow-xl transition-all hover:scale-[1.02]" 
                    onClick={() => onGoogleLogin('teacher')}
                  >
                    <LogIn className="w-6 h-6 mr-2" /> 구글 로그인
                  </Button>
                )}
              </div>
            </div>
          </Card>

          {/* Info & Hall of Fame Bento */}
          <div className="grid grid-rows-2 gap-8">
            <Card 
              className="rounded-[2.5rem] border-none shadow-xl bg-orange-500 p-8 text-white cursor-pointer group transition-all hover:scale-[1.02]" 
              onClick={onViewHallOfFame}
            >
              <div className="flex flex-col h-full">
                <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mb-4">
                  <Trophy className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-3xl font-black tracking-tighter mb-2">명예의 전당</h3>
                <p className="text-orange-100 font-medium">최고의 묘사들을 감상하세요.</p>
                <div className="mt-auto flex justify-end">
                  <ArrowRight className="w-8 h-8 opacity-50 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            </Card>

            <Card 
              className="rounded-[2.5rem] border-none shadow-xl bg-white p-8 cursor-pointer group transition-all hover:scale-[1.02]" 
              onClick={onViewDescription}
            >
              <div className="flex flex-col h-full">
                <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
                  <Info className="w-6 h-6 text-slate-900" />
                </div>
                <h3 className="text-3xl font-black tracking-tighter mb-2 text-slate-900">게임 방법</h3>
                <p className="text-slate-500 font-medium">어떻게 플레이하나요?</p>
                <div className="mt-auto flex justify-end">
                  <ArrowRight className="w-8 h-8 text-slate-300 group-hover:text-slate-900 transition-colors" />
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function TeacherDashboard({ profile, onJoinGame, onBack }: any) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCreate = async (selectedArt?: typeof DEFAULT_ARTWORKS[0]) => {
    const finalTitle = selectedArt?.title || title;
    const finalUrl = selectedArt?.url || url;

    if (!finalTitle || !finalUrl) return alert("작품을 선택하거나 이미지를 업로드해 주세요.");
    
    setCreating(true);
    try {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const id = await firestoreService.createGame({
        code,
        teacherId: profile.uid,
        status: 'lobby',
        currentRound: 1,
        maxRounds: 3,
        artworkUrl: finalUrl,
        artworkTitle: finalTitle
      });
      if (id) onJoinGame(id);
    } finally {
      setCreating(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const storageRef = ref(storage, `artworks/${profile.uid}/${Date.now()}_${file.name}`);
      const snapshot = await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(snapshot.ref);
      setUrl(downloadUrl);
      setTitle(file.name.split('.')[0]);
    } catch (error) {
      console.error("Upload error:", error);
      alert("이미지 업로드에 실패했습니다.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] py-12 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={onBack} className="rounded-full w-12 h-12 p-0">
              <ArrowRight className="rotate-180 w-6 h-6" />
            </Button>
            <h2 className="text-4xl font-black tracking-tighter">수업 준비하기</h2>
          </div>
          <Badge className="bg-slate-900 text-white px-6 py-2 rounded-full text-sm font-bold">선생님 모드</Badge>
        </div>

        <div className="grid lg:grid-cols-5 gap-12">
          {/* Left: Default Artworks (3/5) */}
          <div className="lg:col-span-3 space-y-6">
            <div className="flex items-center gap-2 mb-6">
              <Sparkles className="text-blue-600 w-6 h-6" />
              <h3 className="text-2xl font-black tracking-tight">추천 미술 작품으로 시작</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              {DEFAULT_ARTWORKS.map((art, i) => (
                <motion.div 
                  key={i} 
                  whileHover={{ y: -5 }}
                  className="group cursor-pointer"
                  onClick={() => handleCreate(art)}
                >
                  <Card className="overflow-hidden rounded-[2rem] border-none shadow-lg group-hover:shadow-2xl transition-all">
                    <div className="aspect-[3/4] relative">
                      <img 
                        src={art.url} 
                        alt={art.title} 
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" 
                        referrerPolicy="no-referrer" 
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60 group-hover:opacity-90 transition-opacity" />
                      <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
                        <p className="text-xs font-bold text-blue-400 mb-1 uppercase tracking-widest">{art.artist}</p>
                        <p className="text-lg font-black leading-tight">{art.title}</p>
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center shadow-xl">
                          <Play className="text-blue-600 w-6 h-6 fill-blue-600" />
                        </div>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Right: Custom Upload (2/5) */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center gap-2 mb-6">
              <Camera className="text-slate-900 w-6 h-6" />
              <h3 className="text-2xl font-black tracking-tight">새로운 작품 등록</h3>
            </div>
            <Card className="p-8 rounded-[2.5rem] shadow-xl border-none bg-white">
              <div className="space-y-8">
                <div 
                  className="aspect-video rounded-3xl border-4 border-dashed border-slate-100 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 transition-all overflow-hidden relative group"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {url ? (
                    <>
                      <img src={url} alt="Preview" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <p className="text-white font-bold">이미지 변경하기</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                        <Camera className="w-8 h-8 text-slate-400" />
                      </div>
                      <p className="text-slate-500 font-bold">이미지 파일 불러오기</p>
                      <p className="text-slate-300 text-sm mt-1">JPG, PNG 파일 가능</p>
                    </>
                  )}
                  {uploading && (
                    <div className="absolute inset-0 bg-white/90 flex items-center justify-center">
                      <Loader2 className="animate-spin text-blue-600 w-10 h-10" />
                    </div>
                  )}
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="image/*" 
                  onChange={handleFileUpload} 
                />

                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label className="font-black text-slate-700 ml-1">작품 제목</Label>
                    <Input 
                      placeholder="작품의 이름을 입력하세요" 
                      value={title} 
                      onChange={e => setTitle(e.target.value)} 
                      className="h-14 rounded-2xl bg-slate-50 border-none text-lg font-medium" 
                    />
                  </div>
                  <Button 
                    className="w-full py-8 text-xl rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-black shadow-xl shadow-slate-200 transition-all hover:scale-[1.02]" 
                    onClick={() => handleCreate()} 
                    disabled={creating || uploading || !url}
                  >
                    {creating ? <Loader2 className="animate-spin" /> : "이 작품으로 수업 시작"}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function GameRoom({ gameId, profile, onExit }: any) {
  const isTeacher = profile.role === 'teacher';
  const [game, setGame] = useState<Game | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [mySubmission, setMySubmission] = useState('');
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!gameId) return;
    const unsubGame = firestoreService.subscribeToGame(gameId, setGame);
    const unsubResults = firestoreService.subscribeToResults(gameId, setResults);
    return () => { unsubGame(); unsubResults(); };
  }, [gameId]);

  useEffect(() => {
    if (game?.status !== 'lobby' && game?.status !== 'finished') {
      return firestoreService.subscribeToSubmissions(gameId, game!.currentRound, setSubmissions);
    }
  }, [gameId, game?.status, game?.currentRound]);

  const handleNextPhase = async () => {
    if (!game || processing) return;
    setProcessing(true);
    try {
      let nextStatus = game.status;
      let nextRound = game.currentRound;

      if (game.status === 'lobby') nextStatus = 'describing';
      else if (game.status === 'describing') nextStatus = 'voting';
      else if (game.status === 'voting') nextStatus = 'results';
      else if (game.status === 'results') {
        if (game.currentRound < game.maxRounds) {
          nextStatus = 'describing';
          nextRound++;
        } else {
          nextStatus = 'finished';
        }
      }
      await firestoreService.updateGame(gameId, { status: nextStatus, currentRound: nextRound });
      setHasSubmitted(false);
      setHasVoted(false);
      setMySubmission('');
    } finally {
      setProcessing(false);
    }
  };

  const handleSubmit = async () => {
    if (!mySubmission.trim() || hasSubmitted) return;
    await firestoreService.submitDescription(gameId, {
      roundNumber: game?.currentRound,
      userId: profile.uid,
      userName: profile.name,
      description: mySubmission
    });
    setHasSubmitted(true);
  };

  const handleVote = async (subId: string) => {
    if (hasVoted) return;
    await firestoreService.voteForSubmission(gameId, subId);
    setHasVoted(true);
  };

  const handleGenerateAI = async () => {
    if (!game || processing) return;
    setProcessing(true);
    try {
      const winner = [...submissions].sort((a, b) => b.voteCount - a.voteCount)[0];
      if (winner) {
        const imgUrl = await generateImageFromDescription(winner.description, game.artworkUrl);
        const feedback = await getAIFeedback(winner.description, game.artworkUrl);
        await firestoreService.saveResult(gameId, {
          roundNumber: game.currentRound,
          winningDescription: winner.description,
          winningUserName: winner.userName,
          generatedImageUrl: imgUrl || game.artworkUrl,
          aiFeedback: feedback
        });
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
      }
    } finally {
      setProcessing(false);
    }
  };

  const copyCode = () => {
    if (!game) return;
    navigator.clipboard.writeText(game.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!game) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-blue-600" /></div>;

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Game Header */}
      <header className="border-b px-8 py-4 flex justify-between items-center sticky top-0 bg-white/80 backdrop-blur-md z-50">
        <div className="flex items-center gap-6">
          <Button variant="ghost" size="icon" onClick={onExit} className="rounded-full">
            <ArrowRight className="rotate-180 w-6 h-6" />
          </Button>
          <div className="flex flex-col">
            <h1 className="font-black text-xl tracking-tight">{game.artworkTitle}</h1>
            <div className="flex items-center gap-2">
              <Badge className="bg-blue-600 text-[10px] font-black uppercase tracking-widest px-2">ROUND {game.currentRound}</Badge>
              <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">{game.status}</span>
            </div>
          </div>
        </div>

        {isTeacher && (
          <div className="flex items-center gap-6">
            <div 
              className="flex items-center gap-3 bg-blue-50 px-4 py-2 rounded-2xl cursor-pointer hover:bg-blue-100 transition-colors"
              onClick={copyCode}
            >
              <span className="text-xs font-black text-blue-400 uppercase tracking-widest">JOIN CODE</span>
              <span className="text-2xl font-black text-blue-600 tracking-widest">{game.code}</span>
              {copied ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-blue-300" />}
            </div>
            <Button 
              onClick={handleNextPhase} 
              disabled={processing}
              className="bg-slate-900 text-white px-8 py-6 rounded-2xl font-black text-lg shadow-xl shadow-slate-200"
            >
              {processing ? <Loader2 className="animate-spin" /> : "다음 단계로"}
              <ChevronRight className="ml-2 w-5 h-5" />
            </Button>
          </div>
        )}
      </header>

      <main className="flex-1 p-8 max-w-7xl mx-auto w-full">
        <AnimatePresence mode="wait">
          {game.status === 'lobby' && (
            <motion.div 
              key="lobby"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center py-20 space-y-12"
            >
              <div className="space-y-4">
                <h2 className="text-5xl md:text-7xl font-black tracking-tighter text-slate-900">학생들을 기다리고 있어요</h2>
                <p className="text-xl text-slate-400 font-medium">아래 코드를 학생들에게 공유해 주세요!</p>
              </div>

              <div className="relative inline-block group">
                <div className="absolute inset-0 bg-blue-600 blur-[80px] opacity-20 group-hover:opacity-30 transition-opacity" />
                <div 
                  className="relative bg-white border-4 border-blue-600 text-blue-600 p-16 rounded-[4rem] shadow-2xl cursor-pointer transform transition-transform hover:scale-105 active:scale-95"
                  onClick={copyCode}
                >
                  <p className="text-sm uppercase tracking-[0.5em] font-black mb-4 opacity-50">입장 코드</p>
                  <p className="text-9xl font-black tracking-[0.2em] ml-[0.2em]">{game.code}</p>
                </div>
              </div>

              {isTeacher && (
                <div className="pt-12">
                  <Button 
                    size="lg" 
                    onClick={handleNextPhase} 
                    className="px-16 py-10 text-3xl font-black rounded-3xl bg-blue-600 hover:bg-blue-700 shadow-2xl shadow-blue-200"
                  >
                    게임 시작하기
                  </Button>
                </div>
              )}
            </motion.div>
          )}

          {game.status === 'describing' && (
            <motion.div 
              key="describing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid lg:grid-cols-2 gap-16 items-start"
            >
              <div className="space-y-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-black">1</div>
                  <h2 className="text-3xl font-black tracking-tight">그림을 관찰하고 묘사해 보세요</h2>
                </div>
                <Card className="overflow-hidden rounded-[3rem] shadow-2xl border-none">
                  <img src={game.artworkUrl} alt="Art" className="w-full aspect-[4/5] object-cover" referrerPolicy="no-referrer" />
                </Card>
              </div>

              <div className="space-y-8 lg:pt-16">
                {!hasSubmitted ? (
                  <div className="space-y-6">
                    <div className="bg-slate-50 p-8 rounded-[2.5rem] border-2 border-slate-100 focus-within:border-blue-500 transition-colors">
                      <textarea 
                        className="w-full h-64 bg-transparent border-none text-xl font-medium focus:ring-0 resize-none"
                        placeholder="그림을 보지 못하는 친구에게 설명하듯 자세히 적어보세요. 색깔, 형태, 분위기 등을 담아주세요!"
                        value={mySubmission}
                        onChange={(e) => setMySubmission(e.target.value)}
                      />
                    </div>
                    <Button 
                      className="w-full py-10 text-2xl font-black rounded-[2rem] bg-blue-600 hover:bg-blue-700 shadow-xl shadow-blue-100" 
                      onClick={handleSubmit}
                    >
                      묘사 제출하기
                    </Button>
                  </div>
                ) : (
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="bg-green-50 text-green-600 p-16 rounded-[3rem] text-center space-y-4"
                  >
                    <CheckCircle2 className="w-16 h-16 mx-auto mb-4" />
                    <h3 className="text-3xl font-black">제출 완료!</h3>
                    <p className="text-lg font-bold opacity-70">다른 친구들이 제출할 때까지 잠시만 기다려 주세요.</p>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}

          {game.status === 'voting' && (
            <motion.div 
              key="voting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-12"
            >
              <div className="text-center space-y-4">
                <h2 className="text-5xl font-black tracking-tighter">가장 생생한 묘사를 골라주세요</h2>
                <p className="text-xl text-slate-400 font-medium">가장 그림이 잘 떠오르는 설명에 투표하세요!</p>
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                {submissions.map((sub, i) => (
                  <motion.div
                    key={sub.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                  >
                    <Card 
                      className={`h-full p-8 rounded-[2.5rem] border-4 transition-all cursor-pointer relative overflow-hidden group ${
                        hasVoted ? 'opacity-50 border-transparent' : 'hover:border-blue-500 border-transparent hover:scale-[1.02]'
                      }`}
                      onClick={() => handleVote(sub.id)}
                    >
                      <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <CheckCircle2 className="w-8 h-8 text-blue-500" />
                      </div>
                      <p className="text-xl font-bold leading-relaxed mb-8">"{sub.description}"</p>
                      <div className="flex justify-between items-center mt-auto">
                        <span className="text-slate-400 font-black uppercase tracking-widest text-xs">{sub.userName}</span>
                        {hasVoted && (
                          <Badge className="bg-blue-600 text-white px-3 py-1 rounded-full font-black">{sub.voteCount}표</Badge>
                        )}
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {game.status === 'results' && (
            <motion.div 
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-12"
            >
              {results.find(r => r.roundNumber === game.currentRound) ? (
                <div className="grid lg:grid-cols-2 gap-16 items-center">
                  <div className="space-y-8">
                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-orange-50 text-orange-600 rounded-full text-sm font-black">
                      <Sparkles className="w-4 h-4" />
                      AI가 그린 새로운 작품
                    </div>
                    <Card className="overflow-hidden rounded-[4rem] shadow-2xl border-[12px] border-white ring-1 ring-slate-100">
                      <img 
                        src={results.find(r => r.roundNumber === game.currentRound)?.generatedImageUrl} 
                        alt="AI Generated" 
                        className="w-full aspect-square object-cover" 
                      />
                    </Card>
                  </div>
                  
                  <div className="space-y-8">
                    <div className="space-y-4">
                      <h2 className="text-4xl font-black tracking-tighter">AI의 예술적 평가</h2>
                      <div className="bg-slate-900 text-white p-10 rounded-[3rem] shadow-2xl relative">
                        <MessageSquare className="absolute top-[-20px] left-10 w-12 h-12 text-blue-500 fill-blue-500" />
                        <p className="text-xl font-medium leading-relaxed italic">
                          "{results.find(r => r.roundNumber === game.currentRound)?.aiFeedback}"
                        </p>
                      </div>
                    </div>

                    <div className="p-8 bg-blue-50 rounded-[2.5rem] border-2 border-blue-100">
                      <p className="text-xs font-black text-blue-400 uppercase tracking-widest mb-2">WINNING DESCRIPTION</p>
                      <p className="text-xl font-bold text-blue-900">
                        "{results.find(r => r.roundNumber === game.currentRound)?.winningDescription}"
                      </p>
                      <p className="mt-4 text-sm font-black text-blue-600">— {results.find(r => r.roundNumber === game.currentRound)?.winningUserName}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-32 space-y-8">
                  <div className="relative inline-block">
                    <div className="absolute inset-0 bg-blue-600 blur-[60px] opacity-20 animate-pulse" />
                    <Loader2 className="w-24 h-24 animate-spin mx-auto text-blue-600 relative z-10" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-4xl font-black tracking-tighter">AI가 걸작을 창조하고 있습니다</h2>
                    <p className="text-slate-400 font-bold">잠시만 기다려 주세요...</p>
                  </div>
                  {isTeacher && (
                    <Button 
                      onClick={handleGenerateAI} 
                      className="bg-orange-500 hover:bg-orange-600 text-white px-10 py-6 rounded-2xl font-black text-xl shadow-xl shadow-orange-100"
                    >
                      AI 생성 시작하기
                    </Button>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {game.status === 'finished' && (
            <motion.div 
              key="finished"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-32 space-y-12"
            >
              <div className="relative inline-block">
                <div className="absolute inset-0 bg-yellow-400 blur-[100px] opacity-30" />
                <Trophy className="w-40 h-40 mx-auto text-yellow-500 relative z-10 drop-shadow-2xl" />
              </div>
              <div className="space-y-4">
                <h2 className="text-7xl font-black tracking-tighter">축하합니다!</h2>
                <p className="text-2xl text-slate-400 font-bold">모든 라운드가 성공적으로 끝났습니다.</p>
              </div>
              <Button 
                size="lg" 
                onClick={onExit} 
                className="px-16 py-10 text-3xl font-black rounded-[2.5rem] bg-slate-900 hover:bg-slate-800 text-white shadow-2xl"
              >
                메인으로 돌아가기
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function HallOfFame({ onBack }: any) {
  return (
    <div className="min-h-screen bg-[#F8FAFC] py-20 px-6">
      <div className="max-w-7xl mx-auto">
        <Button onClick={onBack} variant="ghost" className="mb-12 rounded-full">
          <ArrowRight className="rotate-180 mr-2" /> 돌아가기
        </Button>
        <h2 className="text-7xl font-black tracking-tighter mb-16">명예의 <span className="text-orange-500">전당</span></h2>
        <div className="grid md:grid-cols-3 gap-12">
          <div className="col-span-full py-32 text-center bg-white rounded-[4rem] shadow-sm border-2 border-dashed border-slate-100">
            <Trophy className="w-20 h-20 mx-auto text-slate-200 mb-6" />
            <p className="text-2xl font-bold text-slate-300">아직 등록된 걸작이 없습니다.</p>
            <p className="text-slate-200 mt-2">첫 번째 주인공이 되어보세요!</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DescriptionPage({ onBack }: any) {
  const steps = [
    { title: "작품 선정", desc: "선생님이 감상할 미술 작품을 고르고 코드를 공유합니다.", icon: Palette, color: "bg-blue-500" },
    { title: "생생한 묘사", desc: "학생들은 그림을 보고 아주 자세하게 글로 설명합니다.", icon: PenTool, color: "bg-orange-500" },
    { title: "최고의 투표", desc: "친구들의 설명 중 가장 그림이 잘 그려지는 글을 뽑습니다.", icon: Trophy, color: "bg-purple-500" },
    { title: "AI의 재탄생", desc: "선정된 글로 AI가 그림을 그리고 평가를 해줍니다.", icon: Sparkles, color: "bg-green-500" }
  ];

  return (
    <div className="min-h-screen bg-[#F8FAFC] py-20 px-6">
      <div className="max-w-4xl mx-auto">
        <Button onClick={onBack} variant="ghost" className="mb-12 rounded-full">
          <ArrowRight className="rotate-180 mr-2" /> 돌아가기
        </Button>
        <h2 className="text-7xl font-black tracking-tighter mb-16">게임 <span className="text-blue-600">방법</span></h2>
        
        <div className="grid gap-8">
          {steps.map((step, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              className="flex items-center gap-8 bg-white p-8 rounded-[3rem] shadow-sm border border-slate-50"
            >
              <div className={`w-20 h-20 ${step.color} rounded-[2rem] flex items-center justify-center shrink-0 shadow-lg`}>
                <step.icon className="w-10 h-10 text-white" />
              </div>
              <div>
                <h3 className="text-2xl font-black mb-2">{step.title}</h3>
                <p className="text-lg text-slate-500 font-medium leading-relaxed">{step.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="mt-20 p-12 bg-slate-900 rounded-[4rem] text-center text-white">
          <h3 className="text-3xl font-black mb-6">준비되셨나요?</h3>
          <Button 
            size="lg" 
            onClick={onBack} 
            className="bg-white text-slate-900 hover:bg-slate-100 px-12 py-8 text-2xl font-black rounded-3xl"
          >
            지금 바로 시작하기
          </Button>
        </div>
      </div>
    </div>
  );
}
