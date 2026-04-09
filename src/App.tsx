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
  ChevronRight,
  UserCircle,
  QrCode,
  Share2,
  Heart,
  Star,
  Eye
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { QRCodeCanvas } from 'qrcode.react';
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
        // Students can also use Google Login for "Real" version
        if (!user) {
          const cred = await signInAnonymously(auth);
          await updateProfile(cred.user, { displayName: nickname });
        }
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
    <div className="relative min-h-screen flex flex-col overflow-hidden bg-white">
      {/* Hero Section */}
      <div className="relative h-[60vh] md:h-[70vh] flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img 
            src="https://images.unsplash.com/photo-1547826039-bfc35e0f1ea8?q=80&w=2000&auto=format&fit=crop" 
            alt="Art Gallery" 
            className="w-full h-full object-cover opacity-20"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-white/0 via-white/50 to-white" />
        </div>

        <div className="relative z-10 max-w-5xl mx-auto px-6 text-center space-y-8">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <div className="inline-flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-full text-sm font-black mb-8 shadow-xl shadow-blue-200">
              <Sparkles className="w-4 h-4" />
              실시간 미술 교육 플랫폼
            </div>
            <h1 className="text-7xl md:text-9xl font-black tracking-tighter text-slate-900 mb-8 leading-[0.9]">
              ACE <span className="text-blue-600">CANVAS</span>
            </h1>
            <p className="text-2xl md:text-3xl text-slate-500 max-w-3xl mx-auto font-bold leading-tight">
              학생들의 작품을 감상하고, 깊이 있는 <span className="text-slate-900 underline decoration-blue-500 decoration-4">작품평</span>을 남겨보세요.
            </p>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="flex flex-wrap justify-center gap-4"
          >
            <Button 
              size="lg" 
              className="px-10 py-8 text-xl font-black rounded-3xl bg-slate-900 hover:bg-slate-800 text-white shadow-2xl transition-all hover:scale-105"
              onClick={onViewDescription}
            >
              <Info className="mr-2 w-6 h-6" /> 게임 방법
            </Button>
            <Button 
              size="lg" 
              className="px-10 py-8 text-xl font-black rounded-3xl bg-blue-600 hover:bg-blue-700 text-white shadow-2xl transition-all hover:scale-105"
              onClick={onViewHallOfFame}
            >
              <Trophy className="mr-2 w-6 h-6" /> 명예의 전당
            </Button>
          </motion.div>
        </div>
      </div>

      {/* Login/Join Section */}
      <div className="max-w-7xl mx-auto w-full px-6 -mt-20 relative z-20 pb-24">
        <div className="grid md:grid-cols-2 gap-8">
          {/* Student Card */}
          <Card className="rounded-[3rem] border-none shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] bg-white overflow-hidden">
            <div className="p-10 md:p-14 space-y-10">
              <div className="space-y-2">
                <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mb-6">
                  <Play className="w-8 h-8 text-blue-600 fill-blue-600" />
                </div>
                <h2 className="text-4xl font-black tracking-tighter">학생으로 입장</h2>
                <p className="text-slate-400 font-bold">코드를 입력하고 작품 감상을 시작하세요.</p>
              </div>

              <div className="space-y-6">
                <div className="space-y-3">
                  <Label className="text-slate-900 font-black ml-1">닉네임</Label>
                  <Input 
                    placeholder="이름을 입력하세요" 
                    value={nickname} 
                    onChange={(e) => setNickname(e.target.value)} 
                    className="h-16 rounded-2xl border-2 border-slate-100 bg-slate-50 focus:bg-white transition-all text-xl font-bold" 
                  />
                </div>
                <div className="space-y-3">
                  <Label className="text-slate-900 font-black ml-1">입장 코드</Label>
                  <Input 
                    placeholder="6자리 숫자" 
                    value={code} 
                    onChange={(e) => setCode(e.target.value)} 
                    maxLength={6} 
                    className="h-20 rounded-2xl border-2 border-slate-100 bg-slate-50 focus:bg-white transition-all text-center font-black text-4xl tracking-[0.3em] text-blue-600" 
                  />
                </div>
                
                <div className="pt-4 space-y-4">
                  <Button 
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-10 rounded-3xl text-2xl font-black shadow-xl shadow-blue-100 transition-all hover:scale-[1.02]" 
                    onClick={handleStudentJoin} 
                    disabled={joining}
                  >
                    {joining ? <Loader2 className="animate-spin" /> : "게임 입장하기"}
                  </Button>
                  
                  <div className="relative py-4">
                    <div className="absolute inset-0 flex items-center"><Separator /></div>
                    <span className="relative bg-white px-4 text-sm font-black text-slate-300 uppercase mx-auto block w-fit">또는</span>
                  </div>

                  <Button 
                    variant="outline" 
                    className="w-full border-2 border-slate-100 py-10 rounded-3xl text-xl font-black flex items-center justify-center gap-3 hover:bg-slate-50 transition-all" 
                    onClick={() => onGoogleLogin('student')}
                  >
                    <LogIn className="w-6 h-6" /> 구글로 입장하기
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          {/* Teacher Card */}
          <Card className="rounded-[3rem] border-none shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] bg-slate-900 text-white overflow-hidden">
            <div className="p-10 md:p-14 h-full flex flex-col">
              <div className="space-y-2 mb-12">
                <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mb-6">
                  <Users className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-4xl font-black tracking-tighter">선생님 메뉴</h2>
                <p className="text-slate-400 font-bold">수업 세션을 만들고 작품을 등록하세요.</p>
              </div>

              <div className="flex-1 flex flex-col justify-center space-y-8">
                <div className="p-8 bg-white/5 rounded-[2rem] border border-white/10">
                  <ul className="space-y-4">
                    <li className="flex items-center gap-3 text-lg font-bold">
                      <CheckCircle2 className="w-6 h-6 text-blue-400" /> 실시간 작품 감상 및 토론
                    </li>
                    <li className="flex items-center gap-3 text-lg font-bold">
                      <CheckCircle2 className="w-6 h-6 text-blue-400" /> AI 기반 맞춤형 피드백
                    </li>
                    <li className="flex items-center gap-3 text-lg font-bold">
                      <CheckCircle2 className="w-6 h-6 text-blue-400" /> 학생 작품 업로드 및 전시
                    </li>
                  </ul>
                </div>
              </div>

              <div className="mt-12 space-y-4">
                {user && profile?.role === 'teacher' ? (
                  <>
                    <div className="flex items-center gap-4 p-4 bg-white/5 rounded-2xl mb-4">
                      <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center font-black text-xl">
                        {profile.name[0]}
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-black text-slate-500 uppercase tracking-widest">LOGGED IN AS</p>
                        <p className="text-lg font-black">{profile.name} 선생님</p>
                      </div>
                    </div>
                    
                    <Button 
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white py-10 rounded-3xl text-2xl font-black shadow-2xl shadow-blue-900/20 transition-all hover:scale-[1.02]" 
                      onClick={onCreateGame}
                    >
                      <Sparkles className="w-6 h-6 mr-3" />
                      새 수업 시작하기
                    </Button>

                    <Button variant="ghost" className="w-full text-slate-500 hover:text-white font-bold" onClick={onLogout}>
                      <LogOut className="w-4 h-4 mr-2" /> 로그아웃
                    </Button>
                  </>
                ) : (
                  <Button 
                    className="w-full bg-white text-slate-900 hover:bg-slate-100 py-10 rounded-3xl text-2xl font-black shadow-2xl transition-all hover:scale-[1.02]" 
                    onClick={() => onGoogleLogin('teacher')}
                  >
                    <LogIn className="w-7 h-7 mr-3" /> 구글 로그인
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-12 border-t border-slate-100 bg-slate-50/50">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-3">
            <Palette className="w-8 h-8 text-blue-600" />
            <span className="text-2xl font-black tracking-tighter">ACE CANVAS</span>
          </div>
          <p className="text-slate-400 font-bold">© 2026 ACE CANVAS. 즐겁게 미술감상!!</p>
        </div>
      </footer>
    </div>
  );
}

function TeacherDashboard({ profile, onJoinGame, onBack }: any) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [myGames, setMyGames] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchGames = async () => {
      const games = await firestoreService.getTeacherGames(profile.uid);
      if (games) setMyGames(games);
    };
    fetchGames();
  }, [profile.uid]);

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
        maxRounds: 1, // Simplified for "Real" version
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
        <div className="flex items-center justify-between mb-16">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={onBack} className="rounded-full w-14 h-14 p-0 hover:bg-white shadow-sm">
              <ArrowRight className="rotate-180 w-7 h-7" />
            </Button>
            <h2 className="text-5xl font-black tracking-tighter">수업 준비</h2>
          </div>
          <Badge className="bg-slate-900 text-white px-8 py-3 rounded-full text-base font-black shadow-lg">선생님 모드</Badge>
        </div>

        <div className="grid lg:grid-cols-5 gap-12">
          {/* Left: Default Artworks (3/5) */}
          <div className="lg:col-span-3 space-y-8">
            <div className="flex items-center gap-3 mb-8">
              <Sparkles className="text-blue-600 w-8 h-8" />
              <h3 className="text-3xl font-black tracking-tight">추천 작품 선택</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              {DEFAULT_ARTWORKS.map((art, i) => (
                <motion.div 
                  key={i} 
                  whileHover={{ y: -8, scale: 1.02 }}
                  className="group cursor-pointer"
                  onClick={() => handleCreate(art)}
                >
                  <Card className="overflow-hidden rounded-[2.5rem] border-none shadow-xl group-hover:shadow-[0_32px_64px_-16px_rgba(0,0,0,0.15)] transition-all">
                    <div className="aspect-[3/4] relative">
                      <img 
                        src={art.url} 
                        alt={art.title} 
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" 
                        referrerPolicy="no-referrer" 
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-60 group-hover:opacity-80 transition-opacity" />
                      <div className="absolute bottom-0 left-0 right-0 p-8 text-white">
                        <p className="text-xs font-black text-blue-400 mb-2 uppercase tracking-[0.2em]">{art.artist}</p>
                        <p className="text-xl font-black leading-tight">{art.title}</p>
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-2xl">
                          <Play className="text-blue-600 w-8 h-8 fill-blue-600 ml-1" />
                        </div>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Right: Custom Upload (2/5) */}
          <div className="lg:col-span-2 space-y-8">
            <div className="flex items-center gap-3 mb-8">
              <Camera className="text-slate-900 w-8 h-8" />
              <h3 className="text-3xl font-black tracking-tight">학생 작품 등록</h3>
            </div>
            <Card className="p-10 rounded-[3rem] shadow-2xl border-none bg-white">
              <div className="space-y-10">
                <div 
                  className="aspect-square rounded-[2.5rem] border-4 border-dashed border-slate-100 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 transition-all overflow-hidden relative group"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {url ? (
                    <>
                      <img src={url} alt="Preview" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="bg-white text-slate-900 px-6 py-3 rounded-full font-black shadow-xl">이미지 변경</div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform shadow-sm">
                        <Camera className="w-10 h-10 text-slate-400" />
                      </div>
                      <p className="text-slate-900 font-black text-xl">작품 불러오기</p>
                      <p className="text-slate-400 font-bold mt-2">학생의 작품을 직접 올려보세요!</p>
                    </>
                  )}
                  {uploading && (
                    <div className="absolute inset-0 bg-white/95 flex items-center justify-center">
                      <div className="flex flex-col items-center gap-4">
                        <Loader2 className="animate-spin text-blue-600 w-12 h-12" />
                        <p className="font-black text-slate-900">업로드 중...</p>
                      </div>
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

                <div className="space-y-8">
                  <div className="space-y-3">
                    <Label className="font-black text-slate-900 text-lg ml-1">작품 제목</Label>
                    <Input 
                      placeholder="작품의 이름을 입력하세요" 
                      value={title} 
                      onChange={e => setTitle(e.target.value)} 
                      className="h-16 rounded-2xl bg-slate-50 border-none text-xl font-bold px-6" 
                    />
                  </div>
                  <Button 
                    className="w-full py-10 text-2xl rounded-3xl bg-slate-900 hover:bg-slate-800 text-white font-black shadow-2xl transition-all hover:scale-[1.02]" 
                    onClick={() => handleCreate()} 
                    disabled={creating || uploading || !url}
                  >
                    {creating ? <Loader2 className="animate-spin" /> : "이 작품으로 수업 시작"}
                  </Button>
                </div>
              </div>
            </Card>

            {myGames.length > 0 && (
              <div className="pt-8 space-y-6">
                <div className="flex items-center gap-2">
                  <Play className="w-6 h-6 text-slate-400" />
                  <h4 className="text-xl font-black text-slate-900">최근 진행한 수업</h4>
                </div>
                <div className="space-y-3">
                  {myGames.map((g) => (
                    <Card 
                      key={g.id} 
                      className="p-4 rounded-2xl border-none shadow-md bg-white flex items-center justify-between group cursor-pointer hover:bg-slate-50 transition-all"
                      onClick={() => onJoinGame(g.id)}
                    >
                      <div className="flex items-center gap-4">
                        <img src={g.artworkUrl} className="w-12 h-12 rounded-lg object-cover" />
                        <div>
                          <p className="font-black text-slate-900">{g.artworkTitle}</p>
                          <p className="text-xs font-bold text-slate-400">코드: {g.code}</p>
                        </div>
                      </div>
                      <ArrowRight className="w-5 h-5 text-slate-200 group-hover:text-blue-600 transition-colors" />
                    </Card>
                  ))}
                </div>
              </div>
            )}
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
  const [showQR, setShowQR] = useState(false);

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

  const joinUrl = `${window.location.origin}?code=${game.code}`;

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Game Header */}
      <header className="border-b px-8 py-6 flex justify-between items-center sticky top-0 bg-white/90 backdrop-blur-xl z-50">
        <div className="flex items-center gap-8">
          <Button variant="ghost" size="icon" onClick={onExit} className="rounded-full w-12 h-12 hover:bg-slate-50">
            <ArrowRight className="rotate-180 w-6 h-6" />
          </Button>
          <div className="flex flex-col">
            <h1 className="font-black text-2xl tracking-tight text-slate-900">{game.artworkTitle}</h1>
            <div className="flex items-center gap-3">
              <Badge className="bg-blue-600 text-[10px] font-black uppercase tracking-widest px-3 py-1">ROUND {game.currentRound}</Badge>
              <span className="text-xs text-slate-400 font-black uppercase tracking-widest">{game.status}</span>
            </div>
          </div>
        </div>

        {isTeacher && (
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                className="rounded-2xl border-2 border-slate-100 font-black"
                onClick={() => setShowQR(!showQR)}
              >
                <QrCode className="w-5 h-5 mr-2" /> QR 코드
              </Button>
              <div 
                className="flex items-center gap-4 bg-slate-50 px-6 py-3 rounded-2xl cursor-pointer hover:bg-slate-100 transition-all border border-slate-100"
                onClick={copyCode}
              >
                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">JOIN CODE</span>
                <span className="text-3xl font-black text-blue-600 tracking-[0.2em]">{game.code}</span>
                {copied ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5 text-slate-300" />}
              </div>
            </div>
            <Button 
              onClick={handleNextPhase} 
              disabled={processing}
              className="bg-slate-900 text-white px-10 py-7 rounded-2xl font-black text-xl shadow-2xl shadow-slate-200 transition-all hover:scale-105"
            >
              {processing ? <Loader2 className="animate-spin" /> : "다음 단계로"}
              <ChevronRight className="ml-2 w-6 h-6" />
            </Button>
          </div>
        )}
      </header>

      <main className="flex-1 p-8 max-w-7xl mx-auto w-full">
        <AnimatePresence mode="wait">
          {game.status === 'lobby' && (
            <motion.div 
              key="lobby"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="text-center py-20 space-y-16"
            >
              <div className="space-y-6">
                <h2 className="text-6xl md:text-8xl font-black tracking-tighter text-slate-900">학생들을 기다리고 있어요</h2>
                <p className="text-2xl text-slate-400 font-bold">아래 코드를 입력하거나 QR 코드를 스캔하세요!</p>
              </div>

              <div className="flex flex-col md:flex-row items-center justify-center gap-12">
                <div className="relative group">
                  <div className="absolute inset-0 bg-blue-600 blur-[100px] opacity-10 group-hover:opacity-20 transition-opacity" />
                  <div 
                    className="relative bg-white border-4 border-slate-100 p-16 rounded-[4rem] shadow-[0_64px_128px_-32px_rgba(0,0,0,0.1)] cursor-pointer transform transition-all hover:scale-105 active:scale-95"
                    onClick={copyCode}
                  >
                    <p className="text-sm uppercase tracking-[0.5em] font-black mb-6 text-slate-400">입장 코드</p>
                    <p className="text-[10rem] font-black tracking-[0.1em] text-blue-600 leading-none">{game.code}</p>
                  </div>
                </div>

                <div className="bg-white p-12 rounded-[4rem] shadow-[0_64px_128px_-32px_rgba(0,0,0,0.1)] border-4 border-slate-100 flex flex-col items-center gap-6">
                  <QRCodeCanvas value={joinUrl} size={240} level="H" includeMargin={true} />
                  <div className="text-center">
                    <p className="font-black text-xl text-slate-900">QR 코드로 입장</p>
                    <p className="text-slate-400 font-bold text-sm">스마트폰 카메라로 스캔하세요!</p>
                  </div>
                </div>
              </div>

              {isTeacher && (
                <div className="pt-12">
                  <Button 
                    size="lg" 
                    onClick={handleNextPhase} 
                    className="px-20 py-12 text-4xl font-black rounded-[3rem] bg-blue-600 hover:bg-blue-700 shadow-2xl shadow-blue-200 transition-all hover:scale-105"
                  >
                    수업 시작하기
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
              className="grid lg:grid-cols-2 gap-20 items-start py-10"
            >
              <div className="space-y-8">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white text-2xl font-black shadow-lg">1</div>
                  <h2 className="text-4xl font-black tracking-tight text-slate-900">작품을 감상하고 평을 남겨주세요</h2>
                </div>
                <Card className="overflow-hidden rounded-[4rem] shadow-[0_48px_96px_-24px_rgba(0,0,0,0.15)] border-none relative group">
                  <img src={game.artworkUrl} alt="Art" className="w-full aspect-[4/5] object-cover" referrerPolicy="no-referrer" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
                  <div className="absolute bottom-8 left-8 right-8 flex justify-between items-center">
                    <Badge className="bg-white/90 text-slate-900 backdrop-blur-md px-4 py-2 rounded-full font-black shadow-xl">
                      <Eye className="w-4 h-4 mr-2" /> 자세히 보기
                    </Badge>
                  </div>
                </Card>
              </div>

              <div className="space-y-10 lg:pt-20">
                {!hasSubmitted ? (
                  <div className="space-y-8">
                    <div className="bg-slate-50 p-10 rounded-[3rem] border-4 border-slate-100 focus-within:border-blue-500 focus-within:bg-white transition-all shadow-inner">
                      <textarea 
                        className="w-full h-80 bg-transparent border-none text-2xl font-bold focus:ring-0 resize-none placeholder:text-slate-300 leading-relaxed"
                        placeholder="이 작품을 보고 느껴지는 감정, 색채의 특징, 작가의 의도 등을 자유롭게 서술해 보세요. 친구들이 그림을 상상할 수 있게 생생하게 적어주세요!"
                        value={mySubmission}
                        onChange={(e) => setMySubmission(e.target.value)}
                      />
                    </div>
                    <Button 
                      className="w-full py-12 text-3xl font-black rounded-[2.5rem] bg-blue-600 hover:bg-blue-700 shadow-2xl shadow-blue-100 transition-all hover:scale-[1.02]" 
                      onClick={handleSubmit}
                    >
                      작품평 제출하기
                    </Button>
                  </div>
                ) : (
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="bg-green-50 text-green-600 p-20 rounded-[4rem] text-center space-y-6 border-4 border-green-100"
                  >
                    <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                      <CheckCircle2 className="w-14 h-14" />
                    </div>
                    <h3 className="text-4xl font-black tracking-tight">제출 완료!</h3>
                    <p className="text-xl font-bold opacity-80">선생님이 다음 단계로 넘어갈 때까지<br/>잠시만 기다려 주세요.</p>
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
              className="space-y-16 py-10"
            >
              <div className="text-center space-y-6">
                <h2 className="text-6xl font-black tracking-tighter text-slate-900">최고의 작품평을 뽑아주세요</h2>
                <p className="text-2xl text-slate-400 font-bold">가장 공감이 가고 생생한 설명에 투표하세요!</p>
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-10">
                {submissions.map((sub, i) => (
                  <motion.div
                    key={sub.id}
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                  >
                    <Card 
                      className={`h-full p-10 rounded-[3rem] border-4 transition-all cursor-pointer relative overflow-hidden group shadow-xl ${
                        hasVoted ? 'opacity-60 border-transparent bg-slate-50' : 'hover:border-blue-500 border-transparent hover:scale-[1.03] bg-white hover:shadow-2xl'
                      }`}
                      onClick={() => handleVote(sub.id)}
                    >
                      <div className="absolute top-0 right-0 p-6 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Heart className="w-10 h-10 text-blue-500 fill-blue-500" />
                      </div>
                      <p className="text-2xl font-bold leading-relaxed mb-12 text-slate-800">"{sub.description}"</p>
                      <div className="flex justify-between items-center mt-auto pt-6 border-t border-slate-100">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center font-black text-slate-400">
                            {sub.userName[0]}
                          </div>
                          <span className="text-slate-900 font-black text-lg">{sub.userName}</span>
                        </div>
                        {hasVoted && (
                          <div className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-full font-black shadow-lg">
                            <Star className="w-4 h-4 fill-white" />
                            {sub.voteCount}
                          </div>
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
              className="space-y-16 py-10"
            >
              {results.find(r => r.roundNumber === game.currentRound) ? (
                <div className="grid lg:grid-cols-2 gap-20 items-center">
                  <div className="space-y-10">
                    <div className="inline-flex items-center gap-3 px-6 py-3 bg-orange-100 text-orange-600 rounded-full text-lg font-black shadow-sm">
                      <Sparkles className="w-6 h-6" />
                      AI가 재해석한 작품
                    </div>
                    <Card className="overflow-hidden rounded-[5rem] shadow-[0_64px_128px_-32px_rgba(0,0,0,0.2)] border-[16px] border-white ring-2 ring-slate-100 relative group">
                      <img 
                        src={results.find(r => r.roundNumber === game.currentRound)?.generatedImageUrl} 
                        alt="AI Generated" 
                        className="w-full aspect-square object-cover" 
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Card>
                  </div>
                  
                  <div className="space-y-12">
                    <div className="space-y-6">
                      <h2 className="text-5xl font-black tracking-tighter text-slate-900">AI 도슨트의 평가</h2>
                      <div className="bg-slate-900 text-white p-12 rounded-[4rem] shadow-2xl relative border-l-[12px] border-blue-600">
                        <MessageSquare className="absolute top-[-30px] left-12 w-16 h-16 text-blue-600 fill-blue-600" />
                        <p className="text-2xl font-medium leading-relaxed italic text-slate-200">
                          "{results.find(r => r.roundNumber === game.currentRound)?.aiFeedback}"
                        </p>
                      </div>
                    </div>

                    <div className="p-10 bg-blue-50 rounded-[3rem] border-4 border-blue-100 shadow-xl relative overflow-hidden">
                      <div className="absolute top-[-20px] right-[-20px] w-40 h-40 bg-blue-200/20 rounded-full blur-3xl" />
                      <p className="text-xs font-black text-blue-400 uppercase tracking-[0.3em] mb-4">WINNING CRITIQUE</p>
                      <p className="text-3xl font-black text-blue-900 leading-tight">
                        "{results.find(r => r.roundNumber === game.currentRound)?.winningDescription}"
                      </p>
                      <div className="mt-8 flex items-center gap-4">
                        <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center text-white font-black text-xl">
                          {results.find(r => r.roundNumber === game.currentRound)?.winningUserName[0]}
                        </div>
                        <p className="text-xl font-black text-blue-600">— {results.find(r => r.roundNumber === game.currentRound)?.winningUserName}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-40 space-y-10">
                  <div className="relative inline-block">
                    <div className="absolute inset-0 bg-blue-600 blur-[100px] opacity-20 animate-pulse" />
                    <Loader2 className="w-32 h-32 animate-spin mx-auto text-blue-600 relative z-10" />
                  </div>
                  <div className="space-y-4">
                    <h2 className="text-5xl font-black tracking-tighter text-slate-900">AI가 걸작을 분석하고 있습니다</h2>
                    <p className="text-2xl text-slate-400 font-bold">잠시만 기다려 주세요...</p>
                  </div>
                  {isTeacher && (
                    <Button 
                      onClick={handleGenerateAI} 
                      className="bg-orange-500 hover:bg-orange-600 text-white px-14 py-8 rounded-[2rem] font-black text-2xl shadow-2xl shadow-orange-100 transition-all hover:scale-105"
                    >
                      AI 분석 시작하기
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
              className="text-center py-40 space-y-16"
            >
              <div className="relative inline-block">
                <div className="absolute inset-0 bg-yellow-400 blur-[120px] opacity-40" />
                <Trophy className="w-56 h-56 mx-auto text-yellow-500 relative z-10 drop-shadow-[0_20px_40px_rgba(234,179,8,0.4)]" />
              </div>
              <div className="space-y-6">
                <h2 className="text-8xl font-black tracking-tighter text-slate-900">수업 종료!</h2>
                <p className="text-3xl text-slate-400 font-bold">오늘의 감상 활동이 모두 끝났습니다. 수고하셨습니다!</p>
              </div>
              <Button 
                size="lg" 
                onClick={onExit} 
                className="px-20 py-12 text-4xl font-black rounded-[3rem] bg-slate-900 hover:bg-slate-800 text-white shadow-[0_32px_64px_-16px_rgba(0,0,0,0.3)] transition-all hover:scale-105"
              >
                메인으로 돌아가기
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* QR Modal for Teacher */}
      {showQR && isTeacher && (
        <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-xl z-[100] flex items-center justify-center p-6" onClick={() => setShowQR(false)}>
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white p-16 rounded-[4rem] max-w-xl w-full text-center space-y-10 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="space-y-4">
              <h3 className="text-4xl font-black tracking-tighter">학생 입장 QR 코드</h3>
              <p className="text-slate-400 font-bold text-lg">카메라로 스캔하여 바로 접속하세요!</p>
            </div>
            <div className="bg-slate-50 p-10 rounded-[3rem] inline-block border-4 border-slate-100 shadow-inner">
              <QRCodeCanvas value={joinUrl} size={320} level="H" includeMargin={true} />
            </div>
            <div className="space-y-4">
              <div className="bg-blue-50 p-6 rounded-3xl border-2 border-blue-100">
                <p className="text-xs font-black text-blue-400 uppercase tracking-widest mb-2">JOIN CODE</p>
                <p className="text-6xl font-black text-blue-600 tracking-[0.2em]">{game.code}</p>
              </div>
              <Button className="w-full py-8 text-xl font-black rounded-3xl bg-slate-900" onClick={() => setShowQR(false)}>닫기</Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function HallOfFame({ onBack }: any) {
  return (
    <div className="min-h-screen bg-[#F8FAFC] py-24 px-6">
      <div className="max-w-7xl mx-auto">
        <Button onClick={onBack} variant="ghost" className="mb-16 rounded-full w-16 h-16 p-0 hover:bg-white shadow-sm">
          <ArrowRight className="rotate-180 w-8 h-8" />
        </Button>
        <div className="flex flex-col md:flex-row items-end justify-between gap-8 mb-20">
          <div className="space-y-4">
            <h2 className="text-8xl font-black tracking-tighter leading-none">명예의 <span className="text-blue-600">전당</span></h2>
            <p className="text-2xl text-slate-400 font-bold">지금까지 탄생한 최고의 작품평과 AI 걸작들</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex -space-x-4">
              {[1,2,3,4].map(i => (
                <div key={i} className="w-14 h-14 rounded-full border-4 border-white bg-slate-200 overflow-hidden shadow-lg">
                  <img src={`https://picsum.photos/seed/${i}/100/100`} alt="User" />
                </div>
              ))}
            </div>
            <p className="font-black text-slate-900">+128명이 참여 중</p>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-12">
          <div className="col-span-full py-48 text-center bg-white rounded-[5rem] shadow-xl border-4 border-dashed border-slate-100 flex flex-col items-center justify-center gap-8">
            <div className="w-32 h-32 bg-slate-50 rounded-[2.5rem] flex items-center justify-center">
              <Star className="w-16 h-16 text-slate-200" />
            </div>
            <div className="space-y-2">
              <p className="text-3xl font-black text-slate-300 tracking-tight">아직 등록된 걸작이 없습니다.</p>
              <p className="text-xl text-slate-200 font-bold">여러분의 멋진 작품평으로 이곳을 채워주세요!</p>
            </div>
            <Button size="lg" className="rounded-full px-10 py-8 bg-blue-600 font-black text-xl" onClick={onBack}>첫 수업 시작하기</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DescriptionPage({ onBack }: any) {
  const steps = [
    { title: "작품 선정", desc: "선생님이 감상할 미술 작품(학생 작품 또는 명화)을 등록하고 코드를 공유합니다.", icon: Palette, color: "bg-blue-600" },
    { title: "작품 감상 및 평", desc: "학생들은 작품을 깊이 있게 관찰하고 자신만의 작품평을 정성껏 작성합니다.", icon: PenTool, color: "bg-orange-500" },
    { title: "최고의 평 투표", desc: "친구들의 작품평 중 가장 공감이 가고 훌륭한 글을 골라 투표합니다.", icon: Heart, color: "bg-pink-500" },
    { title: "AI 도슨트 피드백", desc: "선정된 평을 바탕으로 AI가 새로운 이미지를 생성하고 전문적인 피드백을 줍니다.", icon: Sparkles, color: "bg-purple-600" }
  ];

  return (
    <div className="min-h-screen bg-[#F8FAFC] py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <Button onClick={onBack} variant="ghost" className="mb-16 rounded-full w-16 h-16 p-0 hover:bg-white shadow-sm">
          <ArrowRight className="rotate-180 w-8 h-8" />
        </Button>
        
        <div className="text-center space-y-6 mb-24">
          <h2 className="text-7xl md:text-9xl font-black tracking-tighter leading-none text-slate-900">게임 <span className="text-blue-600">방법</span></h2>
          <p className="text-2xl text-slate-400 font-bold max-w-2xl mx-auto">ACE CANVAS는 누구나 쉽고 재미있게 미술을 즐길 수 있도록 설계되었습니다.</p>
        </div>
        
        <div className="grid gap-10">
          {steps.map((step, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="flex flex-col md:flex-row items-center gap-10 bg-white p-12 rounded-[4rem] shadow-xl border border-slate-50 group hover:scale-[1.02] transition-all"
            >
              <div className={`w-28 h-28 ${step.color} rounded-[2.5rem] flex items-center justify-center shrink-0 shadow-2xl shadow-slate-200 group-hover:rotate-6 transition-transform`}>
                <step.icon className="w-14 h-14 text-white" />
              </div>
              <div className="text-center md:text-left space-y-3">
                <div className="flex items-center justify-center md:justify-start gap-3">
                  <span className="text-blue-600 font-black text-2xl">0{i+1}</span>
                  <h3 className="text-3xl font-black tracking-tight">{step.title}</h3>
                </div>
                <p className="text-xl text-slate-500 font-bold leading-relaxed">{step.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="mt-24 p-16 bg-slate-900 rounded-[5rem] text-center text-white relative overflow-hidden shadow-2xl">
          <div className="absolute top-[-50px] left-[-50px] w-64 h-64 bg-blue-600/20 rounded-full blur-[100px]" />
          <div className="absolute bottom-[-50px] right-[-50px] w-64 h-64 bg-orange-600/20 rounded-full blur-[100px]" />
          
          <div className="relative z-10 space-y-10">
            <h3 className="text-5xl font-black tracking-tighter">지금 바로 수업을 시작해 보세요!</h3>
            <p className="text-xl text-slate-400 font-bold max-w-2xl mx-auto">학생들과 함께 미술의 즐거움을 나누는 가장 스마트한 방법, ACE CANVAS입니다.</p>
            <Button 
              size="lg" 
              onClick={onBack} 
              className="bg-white text-slate-900 hover:bg-slate-100 px-16 py-10 text-3xl font-black rounded-[2.5rem] shadow-2xl transition-all hover:scale-105"
            >
              메인으로 돌아가기
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
