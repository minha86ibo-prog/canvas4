import React, { useState, useEffect, useRef } from 'react';
import { auth, db, storage } from './firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInAnonymously,
  updateProfile,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  limit,
  Timestamp,
  increment
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './components/ui/card';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { ScrollArea } from './components/ui/scroll-area';
import { Separator } from './components/ui/separator';
import { Label } from './components/ui/label';
import { Slider } from './components/ui/slider';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './components/ui/dialog';
import { 
  Palette, 
  Users, 
  Play, 
  Plus, 
  LogIn, 
  LogOut, 
  Image as ImageIcon, 
  MessageSquare, 
  ThumbsUp, 
  Trophy,
  ArrowRight,
  Loader2,
  QrCode,
  Sparkles,
  Search,
  Mic,
  PenTool,
  Clock,
  UserPlus,
  History,
  Info,
  Camera,
  CheckCircle2,
  ChevronRight,
  Download,
  Share2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import confetti from 'canvas-confetti';
import { firestoreService, testFirestoreConnection } from './lib/firestoreService';
import { generateImageFromDescription, getAIFeedback, performOCR } from './lib/gemini';

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
  timerSeconds: number;
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

// --- Main App Component ---
export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentGameId, setCurrentGameId] = useState<string | null>(null);
  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [view, setView] = useState<'main' | 'hallOfFame' | 'description' | 'signup'>('main');

  const handleGoogleLogin = async (role: Role = 'teacher') => {
    try {
      const provider = new GoogleAuthProvider();
      // Force account selection to avoid some silent failures
      provider.setCustomParameters({ prompt: 'select_account' });
      
      const result = await signInWithPopup(auth, provider);
      const u = result.user;
      
      // Check if profile exists, if not create one
      const p = await firestoreService.getUser(u.uid);
      if (!p) {
        const newProfile = {
          uid: u.uid,
          name: u.displayName || (role === 'teacher' ? 'Teacher' : 'Student'),
          email: u.email || '',
          role: role
        };
        await firestoreService.createUser(u.uid, newProfile);
        setProfile(newProfile);
      } else {
        setProfile(p as UserProfile);
      }
      setView('main');
    } catch (error: any) {
      console.error("Google Login Error:", error);
      if (error.code === 'auth/popup-blocked') {
        alert("팝업이 차단되었습니다. 브라우저 설정에서 팝업을 허용하거나, 앱을 새 탭에서 열어주세요.");
      } else if (error.code === 'auth/cancelled-popup-request') {
        // User closed the popup, no need to alert
      } else {
        alert("로그인 중 오류가 발생했습니다: " + error.message + "\n(참고: AI Studio 미리보기 환경에서는 '새 탭에서 열기'를 권장합니다.)");
      }
    }
  };

  useEffect(() => {
    testFirestoreConnection();
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const p = await firestoreService.getUser(u.uid);
        if (p) {
          setProfile(p as UserProfile);
        } else if (u.isAnonymous) {
          // Student with nickname
          setProfile({
            uid: u.uid,
            name: u.displayName || 'Anonymous Student',
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
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-12 h-12 text-slate-400 animate-spin" />
      </div>
    );
  }

  if (currentGameId) {
    return (
      <ErrorBoundary>
        <GameRoom 
          gameId={currentGameId} 
          profile={profile!} 
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
      <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
        {view === 'main' && (
          <MainScreen 
            user={user} 
            profile={profile} 
            onViewHallOfFame={() => setView('hallOfFame')}
            onViewDescription={() => setView('description')}
            onViewSignup={() => setView('signup')}
            onJoinGame={setCurrentGameId}
            onCreateGame={() => setIsCreatingGame(true)}
            onLogout={handleLogout}
            onGoogleLogin={handleGoogleLogin}
          />
        )}
        {view === 'signup' && (
          <SignupPage 
            onBack={() => setView('main')} 
            onSuccess={() => setView('main')}
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
  onViewSignup,
  onJoinGame,
  onCreateGame,
  onLogout,
  onGoogleLogin
}: { 
  user: FirebaseUser | null, 
  profile: UserProfile | null,
  onViewHallOfFame: () => void,
  onViewDescription: () => void,
  onViewSignup: () => void,
  onJoinGame: (id: string) => void,
  onCreateGame: () => void,
  onLogout: () => void,
  onGoogleLogin: (role?: Role) => void
}) {
  const [nickname, setNickname] = useState('');
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');

  const handleStudentJoin = async () => {
    if (!nickname.trim()) {
      alert("닉네임을 입력해주세요.");
      return;
    }
    if (code.length !== 6) {
      alert("6자리 입장 코드를 입력해주세요.");
      return;
    }
    
    setJoining(true);
    try {
      const game = await firestoreService.getGameByCode(code);
      if (game) {
        const cred = await signInAnonymously(auth);
        await updateProfile(cred.user, { displayName: nickname });
        onJoinGame(game.id);
      } else {
        alert("유효하지 않은 코드입니다.");
      }
    } catch (error: any) {
      if (error.code === 'auth/operation-not-allowed') {
        alert("Firebase 설정에서 '익명(Anonymous)' 로그인이 활성화되지 않았습니다. Firebase 콘솔의 Authentication > Sign-in method 탭에서 '익명'을 활성화해 주세요.");
      } else {
        alert("입장 중 오류가 발생했습니다: " + error.message);
      }
    }
    setJoining(false);
  };

  return (
    <div className="relative min-h-screen flex flex-col">
      {/* Hero Section */}
      <div className="relative h-[60vh] overflow-hidden bg-slate-900">
        <img 
          src="https://picsum.photos/seed/masterpiece/1920/1080" 
          alt="Hero" 
          className="w-full h-full object-cover opacity-60"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-slate-900/90" />
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <div className="flex items-center justify-center gap-4 mb-8">
              <div className="w-14 h-14 bg-white rounded-3xl flex items-center justify-center shadow-xl">
                <Palette className="text-slate-900 w-8 h-8" />
              </div>
              <h1 className="text-6xl font-black text-white tracking-tighter font-heading">ACE CANVAS</h1>
            </div>
            <p className="text-2xl text-slate-300 max-w-2xl mx-auto leading-relaxed mb-14 font-sans font-medium">
              AI와 함께하는 실시간 미술 감상 게임. <br />
              작품을 관찰하고, 묘사하고, 새로운 걸작을 탄생시키세요.
            </p>
          </motion.div>
        </div>
      </div>

      {/* Main Actions */}
      <div className="max-w-7xl mx-auto w-full px-6 -mt-32 relative z-10 pb-24">
        <div className="grid lg:grid-cols-3 gap-10">
          {/* Student Join Card */}
          <Card className="rounded-[3rem] border-none shadow-2xl overflow-hidden bg-white group hover:shadow-orange-500/10 transition-all duration-500">
            <CardHeader className="p-12 pb-0">
              <div className="flex items-center gap-4 mb-6">
                <Play className="w-8 h-8 text-slate-900" />
                <CardTitle className="text-4xl font-black tracking-tighter font-heading">학생으로 입장하기</CardTitle>
              </div>
              <CardDescription className="text-lg font-sans font-medium text-slate-500">닉네임과 코드를 입력하고 게임에 참여하세요.</CardDescription>
            </CardHeader>
            <CardContent className="p-12 space-y-10">
              <div className="space-y-8">
                <div className="space-y-4">
                  <Label htmlFor="nickname" className="text-lg font-black text-slate-900">닉네임</Label>
                  <Input 
                    id="nickname" 
                    placeholder="이름을 입력하세요" 
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    className="rounded-2xl h-16 text-lg border-slate-200 bg-white px-6 focus:ring-2 focus:ring-slate-900 transition-all"
                  />
                </div>
                <div className="space-y-4">
                  <Label htmlFor="gameCode" className="text-lg font-black text-slate-900">입장 코드</Label>
                  <Input 
                    id="gameCode" 
                    placeholder="6자리 코드 입력" 
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="rounded-2xl h-16 font-heading text-center text-2xl tracking-[0.2em] border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-slate-900 transition-all"
                    maxLength={6}
                  />
                </div>
              </div>
              <Button 
                className="w-full bg-slate-900 hover:bg-slate-800 text-white py-12 rounded-3xl text-3xl font-black shadow-2xl group"
                onClick={handleStudentJoin}
                disabled={joining}
              >
                {joining ? <Loader2 className="animate-spin" /> : "게임하기"}
              </Button>
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><Separator /></div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-slate-400">Or</span>
                </div>
              </div>
              <Button 
                variant="outline"
                className="w-full border-2 border-slate-200 py-8 rounded-2xl text-lg font-bold flex items-center justify-center gap-3 hover:bg-slate-50"
                onClick={() => onGoogleLogin('student')}
              >
                <LogIn className="w-5 h-5" />
                구글로 입장하기
              </Button>
            </CardContent>
          </Card>

          {/* Teacher Actions */}
          <Card className="rounded-[3rem] border-none shadow-2xl overflow-hidden bg-white group hover:shadow-slate-500/10 transition-all duration-500">
            <CardHeader className="p-12 pb-0">
              <div className="flex items-center gap-4 mb-6">
                <Users className="w-8 h-8 text-slate-900" />
                <CardTitle className="text-4xl font-black tracking-tighter font-heading">교사로 입장하기</CardTitle>
              </div>
              <CardDescription className="text-lg font-sans font-medium text-slate-500">구글 계정으로 로그인하여 게임을 관리하세요.</CardDescription>
            </CardHeader>
            <CardContent className="p-12 flex flex-col justify-between h-[calc(100%-160px)]">
              <div className="space-y-12">
                <p className="text-slate-500 leading-relaxed text-xl font-medium">
                  교사가 되어 게임을 생성하고 학생들의 참여를 관리할 수 있습니다.
                </p>
                {user && profile?.role === 'teacher' ? (
                  <Button 
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white py-12 rounded-3xl text-2xl font-black shadow-2xl group"
                    onClick={onCreateGame}
                  >
                    대시보드로 이동
                  </Button>
                ) : (
                  <Button 
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white py-12 rounded-3xl text-2xl font-black shadow-2xl group flex items-center justify-center gap-4"
                    onClick={onGoogleLogin}
                  >
                    <LogIn className="w-8 h-8" />
                    구글로 시작하기
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Experience Now Card */}
          <Card 
            className="rounded-[3rem] border-none shadow-2xl bg-white cursor-pointer hover:shadow-orange-500/20 transition-all duration-500 group overflow-hidden relative"
            onClick={onViewDescription}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <CardContent className="p-12 flex flex-col justify-center h-full relative z-10">
              <div className="w-20 h-20 bg-orange-500 rounded-[2rem] flex items-center justify-center mb-10 shadow-xl shadow-orange-200 group-hover:scale-110 transition-transform duration-500">
                <Info className="text-white w-10 h-10" />
              </div>
              <h3 className="text-5xl font-black mb-6 font-heading tracking-tighter leading-tight">게임 방법<br /><span className="text-orange-500">알아보기</span></h3>
              <p className="text-slate-500 text-xl font-medium leading-relaxed mb-12">ACE CANVAS가 무엇인지<br />자세히 알아보세요.</p>
              <div className="flex items-center gap-4 text-orange-600 font-black text-2xl">
                <span>자세히 보기</span>
                <ArrowRight className="w-8 h-8 group-hover:translate-x-3 transition-transform" />
              </div>
            </CardContent>
          </Card>

          {/* Info & Hall of Fame Row */}
          <Card 
            className="rounded-[3rem] border-none shadow-2xl bg-orange-500 text-white cursor-pointer hover:scale-[1.01] transition-all duration-500 group lg:col-span-2"
            onClick={onViewHallOfFame}
          >
            <CardContent className="p-12 flex items-center gap-12 h-full">
              <div className="w-24 h-24 bg-white/20 rounded-[2.5rem] flex items-center justify-center shrink-0 group-hover:rotate-12 transition-transform">
                <Trophy className="w-12 h-12 text-white" />
              </div>
              <div>
                <h3 className="text-5xl font-black mb-4 font-heading tracking-tighter">명예의 전당</h3>
                <p className="text-orange-100 text-2xl font-medium leading-relaxed">지금까지 탄생한 최고의 묘사와 AI 걸작들을 감상하세요.</p>
              </div>
            </CardContent>
          </Card>

          <Card 
            className="rounded-[3rem] border-none shadow-2xl bg-slate-900 text-white cursor-pointer hover:scale-[1.01] transition-all duration-500 group"
            onClick={onViewDescription}
          >
            <CardContent className="p-12 flex flex-col justify-center h-full">
              <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 transition-transform">
                <Info className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-3xl font-black mb-3 font-heading tracking-tighter">게임 설명</h3>
              <p className="text-slate-400 text-lg font-medium">ACE CANVAS가 무엇인지 알아보세요.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SignupPage({ onBack, onSuccess, onGoogleLogin }: { onBack: () => void, onSuccess: () => void, onGoogleLogin: (role?: Role) => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: name });
        await firestoreService.createUser(cred.user.uid, {
          uid: cred.user.uid,
          name,
          email,
          role: 'teacher'
        });
      }
      onSuccess();
    } catch (error: any) {
      alert(error.message);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-[50vw] h-[50vw] bg-orange-100 rounded-full blur-[120px] -mr-[25vw] -mt-[25vw] opacity-50" />
      <div className="absolute bottom-0 left-0 w-[40vw] h-[40vw] bg-slate-200 rounded-full blur-[100px] -ml-[20vw] -mb-[20vw] opacity-50" />
      
      <Card className="max-w-md w-full rounded-[3.5rem] border-none shadow-2xl p-12 bg-white relative z-10">
        <Button variant="ghost" size="icon" onClick={onBack} className="mb-8 rounded-full hover:bg-slate-50">
          <ArrowRight className="rotate-180 w-6 h-6" />
        </Button>
        <div className="text-center mb-12">
          <div className="w-16 h-16 bg-slate-900 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl">
            <Palette className="text-white w-8 h-8" />
          </div>
          <h2 className="text-4xl font-black tracking-tighter font-heading">{isLogin ? 'Welcome Back' : 'Create Account'}</h2>
          <p className="text-slate-500 font-sans font-medium mt-2">{isLogin ? '선생님 계정으로 로그인하세요.' : '새로운 교사 계정을 만드세요.'}</p>
        </div>
        
        <div className="space-y-6">
          <Button 
            onClick={() => onGoogleLogin()}
            className="w-full bg-white border-2 border-slate-200 text-slate-900 py-8 rounded-2xl text-lg font-bold flex items-center justify-center gap-4 hover:bg-slate-50"
          >
            <LogIn className="w-6 h-6" />
            구글로 계속하기
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><Separator /></div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-slate-400">Or with email</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="name">이름</Label>
                <Input id="name" placeholder="선생님 성함" value={name} onChange={(e) => setName(e.target.value)} required className="rounded-xl h-12" />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">이메일</Label>
              <Input id="email" type="email" placeholder="teacher@school.com" value={email} onChange={(e) => setEmail(e.target.value)} required className="rounded-xl h-12" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">비밀번호</Label>
              <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required className="rounded-xl h-12" />
            </div>
            <Button type="submit" className="w-full bg-slate-900 text-white py-8 rounded-2xl text-lg font-bold" disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : (isLogin ? "로그인" : "가입하기")}
            </Button>
          </form>
        </div>

        <div className="mt-8 text-center">
          <Button variant="link" onClick={() => setIsLogin(!isLogin)} className="text-slate-500">
            {isLogin ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function HallOfFame({ onBack }: { onBack: () => void }) {
  const [excellentWorks, setExcellentWorks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'hallOfFame'), orderBy('createdAt', 'desc'), limit(20));
    const unsubscribe = onSnapshot(q, (snap) => {
      setExcellentWorks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-8 py-24">
      <header className="flex justify-between items-end mb-20">
        <div>
          <Badge className="mb-6 bg-orange-100 text-orange-600 hover:bg-orange-100 border-none px-6 py-2 rounded-full font-bold tracking-widest uppercase text-xs">Exhibition</Badge>
          <h2 className="text-7xl font-black tracking-tighter font-heading">명예의 전당</h2>
          <p className="text-2xl text-slate-500 font-sans font-medium mt-4">지금까지 탄생한 최고의 묘사와 AI 걸작들</p>
        </div>
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-full px-10 h-16 text-lg font-bold border-2 hover:bg-slate-900 hover:text-white transition-all duration-300">
          <ArrowRight className="rotate-180 mr-3 w-6 h-6" /> 돌아가기
        </Button>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-40">
          <Loader2 className="w-16 h-16 text-slate-200 animate-spin" />
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-12">
          {excellentWorks.length > 0 ? excellentWorks.map((work, i) => (
            <motion.div
              key={work.id}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <Card className="rounded-[3rem] border-none shadow-2xl overflow-hidden bg-white group hover:scale-[1.02] transition-transform duration-500">
                <div className="aspect-square relative overflow-hidden">
                  <img src={work.generatedImageUrl} alt="Masterpiece" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" referrerPolicy="no-referrer" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex flex-col justify-end p-10">
                    <p className="text-white font-sans font-bold text-xl leading-relaxed mb-4">"{work.winningDescription}"</p>
                    <p className="text-orange-400 font-bold uppercase tracking-widest text-xs">Artist: {work.winningUserName}</p>
                  </div>
                </div>
                <CardContent className="p-10">
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <h3 className="text-xl font-black tracking-tight mb-1 font-heading">{work.artworkTitle}</h3>
                      <p className="text-slate-400 text-sm font-sans font-medium">Original Inspiration</p>
                    </div>
                    <Badge className="bg-slate-50 text-slate-400 border-none px-3 py-1 rounded-full text-[10px] font-bold">
                      {work.createdAt?.toDate().toLocaleDateString()}
                    </Badge>
                  </div>
                  <Separator className="mb-6 opacity-50" />
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-slate-900 text-white rounded-full flex items-center justify-center text-xs font-bold">
                      {work.winningUserName[0]}
                    </div>
                    <span className="font-bold text-slate-700">{work.winningUserName}</span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )) : (
            <div className="col-span-full text-center py-32">
              <p className="text-slate-400 text-xl font-sans font-medium">아직 등록된 명예의 전당 작품이 없습니다.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DescriptionPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="max-w-4xl mx-auto px-8 py-24">
      <header className="flex justify-between items-center mb-20">
        <div className="flex items-center gap-6">
          <Button variant="ghost" size="icon" onClick={onBack} className="rounded-full w-12 h-12 hover:bg-slate-100">
            <ArrowRight className="rotate-180 w-6 h-6" />
          </Button>
          <h2 className="text-5xl font-black tracking-tighter font-heading">ACE CANVAS란?</h2>
        </div>
        <div className="w-16 h-16 bg-slate-900 rounded-3xl flex items-center justify-center shadow-xl">
          <Info className="text-white w-8 h-8" />
        </div>
      </header>

      <div className="space-y-20">
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <Badge className="bg-orange-100 text-orange-600 border-none px-4 py-1 rounded-full font-bold text-xs uppercase tracking-widest">Concept</Badge>
            <Separator className="flex-1" />
          </div>
          <p className="text-3xl font-heading font-bold leading-relaxed text-slate-700">
            "예술을 보는 새로운 시선, <span className="text-orange-500 font-bold not-italic">AI와 함께하는</span> 감상 여정"
          </p>
          <p className="text-xl text-slate-500 leading-relaxed font-sans">
            ACE CANVAS는 학생들이 수동적으로 작품을 보는 것에서 벗어나, 자신의 언어로 작품을 묘사하고 
            AI를 통해 그 묘사를 시각화하는 능동적인 미술 감상 교육 플랫폼입니다.
          </p>
        </section>

        <section className="grid md:grid-cols-3 gap-8">
          {[
            { title: '관찰과 묘사', desc: '작품의 세부 요소를 꼼꼼히 관찰하고 구체적인 언어로 표현합니다.', icon: <Camera className="w-6 h-6" /> },
            { title: 'AI 시각화', desc: '학생의 묘사글을 바탕으로 AI가 이미지를 생성하여 감상의 정확도를 확인합니다.', icon: <Sparkles className="w-6 h-6" /> },
            { title: '교육적 피드백', desc: 'Gemini AI가 학생의 감상 내용을 분석하여 더 깊이 있는 관찰을 위한 가이드를 제공합니다.', icon: <MessageSquare className="w-6 h-6" /> }
          ].map((step, i) => (
            <Card key={i} className="rounded-[2.5rem] border-none shadow-xl bg-white p-10 group hover:scale-105 transition-transform duration-500">
              <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-orange-50 transition-colors">
                <div className="text-slate-400 group-hover:text-orange-500 transition-colors">{step.icon}</div>
              </div>
              <h3 className="text-xl font-black mb-3 font-heading">{step.title}</h3>
              <p className="text-slate-500 font-sans font-medium">{step.desc}</p>
            </Card>
          ))}
        </section>

        <section className="bg-slate-900 text-white p-16 rounded-[4rem] shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/10 rounded-full blur-[100px] -mr-32 -mt-32" />
          <h3 className="text-3xl font-black mb-8 font-heading">교육적 효과</h3>
          <ul className="space-y-6">
            {[
              '시각적 문해력(Visual Literacy) 향상',
              '어휘력 및 표현력 증진',
              '비판적 사고 및 관찰력 강화',
              'AI 기술에 대한 이해와 창의적 활용'
            ].map((effect, i) => (
              <li key={i} className="flex items-center gap-4 text-xl font-sans font-medium text-slate-300">
                <div className="w-2 h-2 bg-orange-500 rounded-full" />
                {effect}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function GameRoom({ gameId, profile, onExit }: { gameId: string, profile: UserProfile, onExit: () => void }) {
  const isTeacher = profile.role === 'teacher';
  const [game, setGame] = useState<Game | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [mySubmission, setMySubmission] = useState<string>('');
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!gameId) return;
    const unsubGame = firestoreService.subscribeToGame(gameId, (data) => {
      setGame(data);
    });
    const unsubResults = firestoreService.subscribeToResults(gameId, setResults);
    return () => {
      unsubGame();
      unsubResults();
    };
  }, [gameId]);

  useEffect(() => {
    if (game?.status === 'describing' || game?.status === 'voting' || game?.status === 'results') {
      const unsubSubs = firestoreService.subscribeToSubmissions(gameId, game.currentRound, setSubmissions);
      return unsubSubs;
    }
  }, [gameId, game?.status, game?.currentRound]);

  // Auto-trigger AI generation for results
  useEffect(() => {
    if (game?.status === 'results' && isTeacher && !processing) {
      const currentResult = results.find(r => r.roundNumber === game.currentRound);
      if (!currentResult && submissions.length > 0) {
        handleGenerateAIImage();
      }
    }
  }, [game?.status, game?.currentRound, results.length, submissions.length, isTeacher, processing]);

  // Timer logic
  useEffect(() => {
    if (game?.status === 'describing' && timeLeft > 0) {
      const timer = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
      return () => clearInterval(timer);
    } else if (game?.status === 'describing' && timeLeft === 0 && game.teacherId === profile.uid) {
      // Auto move to voting if teacher
      // handleNextPhase();
    }
  }, [game?.status, timeLeft]);

  useEffect(() => {
    if (game?.status === 'describing') setTimeLeft(120); // 2 minutes
    setHasSubmitted(false);
    setHasVoted(false);
    setMySubmission('');
  }, [game?.currentRound, game?.status]);

  const handleStartGame = async () => {
    await firestoreService.updateGame(gameId, { status: 'describing' });
  };

  const handleSubmit = async () => {
    if (!mySubmission.trim()) return;
    await firestoreService.submitDescription(gameId, {
      gameId,
      roundNumber: game?.currentRound,
      userId: profile.uid,
      userName: profile.name,
      description: mySubmission
    });
    setHasSubmitted(true);
  };

  const handleVote = async (submissionId: string) => {
    if (hasVoted) return;
    await firestoreService.voteForSubmission(gameId, submissionId);
    setHasVoted(true);
  };

  const handleNextPhase = async () => {
    if (!game) return;
    setProcessing(true);
    
    let nextStatus: GameStatus = game.status;
    let nextRound = game.currentRound;

    if (game.status === 'describing') {
      nextStatus = 'voting';
    } else if (game.status === 'voting') {
      nextStatus = 'results';
    } else if (game.status === 'results') {
      if (game.currentRound < game.maxRounds) {
        nextStatus = 'describing';
        nextRound = game.currentRound + 1;
      } else {
        nextStatus = 'finished';
      }
    }

    await firestoreService.updateGame(gameId, { status: nextStatus, currentRound: nextRound });
    setProcessing(false);
  };

  const handlePrevPhase = async () => {
    if (!game) return;
    setProcessing(true);
    
    let prevStatus: GameStatus = game.status;
    let prevRound = game.currentRound;

    if (game.status === 'describing') {
      prevStatus = 'lobby';
    } else if (game.status === 'voting') {
      prevStatus = 'describing';
    } else if (game.status === 'results') {
      prevStatus = 'voting';
    } else if (game.status === 'finished') {
      prevStatus = 'results';
    }

    await firestoreService.updateGame(gameId, { status: prevStatus, currentRound: prevRound });
    setProcessing(false);
  };

  const handleGenerateAIImage = async () => {
    if (!game || processing) return;
    setProcessing(true);
    
    try {
      const winner = [...submissions].sort((a, b) => b.voteCount - a.voteCount)[0];
      if (winner) {
        const generatedImageUrl = await generateImageFromDescription(winner.description, game.artworkUrl);
        let feedback = "";
        // Always get feedback for the winner
        feedback = await getAIFeedback(winner.description, game.artworkUrl) || "";

        await firestoreService.saveResult(gameId, {
          gameId,
          roundNumber: game.currentRound,
          winningDescription: winner.description,
          winningUserName: winner.userName,
          generatedImageUrl: generatedImageUrl || "",
          aiFeedback: feedback
        });

        // Add to Hall of Fame if it's the final round or high vote count
        if (winner.voteCount >= 1) {
          await addDoc(collection(db, 'hallOfFame'), {
            winningDescription: winner.description,
            winningUserName: winner.userName,
            generatedImageUrl: generatedImageUrl || "",
            artworkTitle: game.artworkTitle,
            createdAt: Timestamp.now()
          });
        }
        
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 }
        });
      } else {
        // No submissions case - save a dummy result to prevent infinite spinning
        await firestoreService.saveResult(gameId, {
          gameId,
          roundNumber: game.currentRound,
          winningDescription: "제출된 묘사가 없습니다.",
          winningUserName: "시스템",
          generatedImageUrl: game.artworkUrl,
          aiFeedback: "이번 라운드에는 제출된 묘사가 없어 AI 피드백을 생성할 수 없습니다."
        });
      }
    } catch (error) {
      console.error("Error in AI generation flow:", error);
    } finally {
      setProcessing(false);
    }
  };

  // Voice Recognition
  const startVoiceRecognition = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("이 브라우저는 음성 인식을 지원하지 않습니다.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.onstart = () => setIsRecording(true);
    recognition.onend = () => setIsRecording(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setMySubmission(prev => prev + " " + transcript);
    };
    recognition.start();
  };

  // OCR (Handwriting)
  const handleOCR = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcrLoading(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = (reader.result as string).split(',')[1];
      const text = await performOCR(base64);
      if (text) setMySubmission(prev => prev + " " + text);
      setOcrLoading(false);
    };
    reader.readAsDataURL(file);
  };

  if (!game) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-100 px-8 py-6 flex justify-between items-center sticky top-0 bg-white/90 backdrop-blur-xl z-50">
        <div className="flex items-center gap-6">
          <Button variant="ghost" size="icon" onClick={onExit} className="rounded-full w-10 h-10">
            <ArrowRight className="rotate-180 w-5 h-5" />
          </Button>
          <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center">
            <Palette className="text-white w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-black text-2xl tracking-tight font-heading">{game.artworkTitle}</h1>
            </div>
            <div className="flex items-center gap-3">
              <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100 border-none text-[10px] uppercase tracking-widest px-3 py-1 rounded-full">
                {game.status}
              </Badge>
              <span className="text-xs font-bold text-slate-400 tracking-widest uppercase">ROUND {game.currentRound} / {game.maxRounds}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-8">
          {game.status === 'describing' && (
            <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 rounded-xl border border-slate-100">
              <Clock className={`w-5 h-5 ${timeLeft < 30 ? 'text-red-500 animate-pulse' : 'text-slate-400'}`} />
              <span className={`font-mono font-bold text-lg ${timeLeft < 30 ? 'text-red-500' : 'text-slate-600'}`}>
                {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
              </span>
            </div>
          )}
          
          {isTeacher ? (
            <div className="flex items-center gap-4">
              <div className="text-right mr-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Join Code</p>
                <p className="text-2xl font-black tracking-tighter leading-none">{game.code}</p>
              </div>
              
              <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl">
                <Button 
                  variant="ghost"
                  size="icon"
                  onClick={handlePrevPhase}
                  disabled={processing || game.status === 'lobby'}
                  className="rounded-xl hover:bg-white hover:shadow-sm"
                >
                  <ArrowRight className="rotate-180 w-5 h-5" />
                </Button>
                
                <div className="px-4 py-1">
                  <span className="text-sm font-bold text-slate-600">
                    {game.status === 'lobby' && '대기실'}
                    {game.status === 'describing' && '묘사하기'}
                    {game.status === 'voting' && '투표하기'}
                    {game.status === 'results' && '결과확인'}
                    {game.status === 'finished' && '종료'}
                  </span>
                </div>

                <Button 
                  variant="ghost"
                  size="icon"
                  onClick={handleNextPhase}
                  disabled={processing || game.status === 'finished'}
                  className="rounded-xl hover:bg-white hover:shadow-sm"
                >
                  <ArrowRight className="w-5 h-5" />
                </Button>
              </div>

              <Button 
                onClick={handleNextPhase} 
                disabled={processing || game.status === 'finished'}
                className="bg-slate-900 text-white rounded-2xl px-8 h-14 font-bold shadow-lg shadow-slate-200 ml-2"
              >
                {processing ? <Loader2 className="animate-spin" /> : (
                  <div className="flex items-center gap-2">
                    <span>다음 단계</span>
                    <ChevronRight className="w-5 h-5" />
                  </div>
                )}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center">
                <Users className="w-5 h-5 text-slate-400" />
              </div>
              <span className="font-bold">{profile.name}</span>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-8">
        <AnimatePresence mode="wait">
          {game.status === 'lobby' && (
            <motion.div 
              key="lobby"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="h-full flex flex-col items-center justify-center py-12"
            >
              <div className="grid lg:grid-cols-2 gap-20 items-center w-full">
                <div className="text-center lg:text-left">
                  <Badge className="mb-8 bg-orange-100 text-orange-600 hover:bg-orange-100 border-none px-6 py-2 rounded-full font-bold tracking-widest uppercase text-xs">학생 대기 중</Badge>
                  <h2 className="text-8xl font-black tracking-tighter mb-12 leading-[0.9] font-heading">
                    함께 감상을 <br /> <span className="text-orange-500 font-heading">시작해볼까요?</span>
                  </h2>
                  <div className="flex flex-col lg:flex-row items-stretch gap-10 mb-16">
                    <div className="bg-white p-10 rounded-[4rem] shadow-2xl border border-slate-50 flex flex-col items-center justify-center group hover:scale-105 transition-transform duration-500">
                      <p className="text-slate-400 font-bold uppercase tracking-widest mb-6 text-[10px] text-center">Scan to Join</p>
                      <QRCodeSVG value={`${window.location.origin}?code=${game.code}`} size={220} />
                    </div>
                    <div className="flex-1 bg-slate-900 text-white p-12 rounded-[4rem] shadow-2xl flex flex-col items-center justify-center relative overflow-hidden group hover:scale-105 transition-transform duration-500">
                      <div className="absolute top-0 right-0 w-48 h-48 bg-orange-500/20 rounded-full blur-[80px] -mr-24 -mt-24 animate-pulse" />
                      <p className="text-slate-400 font-bold uppercase tracking-widest mb-4 text-[10px]">Join Code</p>
                      <p className="text-9xl font-black tracking-tighter text-orange-400 mb-8 font-heading">{game.code}</p>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-slate-400 hover:text-white hover:bg-white/10 rounded-full px-10 h-12 border border-white/10"
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}?code=${game.code}`);
                          alert('링크가 복사되었습니다!');
                        }}
                      >
                        <Share2 className="mr-3 w-5 h-5" /> 링크 복사하기
                      </Button>
                    </div>
                  </div>
                  {isTeacher && (
                    <Button 
                      onClick={handleStartGame}
                      className="bg-slate-900 hover:bg-slate-800 text-white px-16 py-10 rounded-[2rem] text-2xl font-bold shadow-2xl shadow-slate-300 group"
                    >
                      게임 시작하기
                      <Play className="ml-3 w-8 h-8 group-hover:scale-110 transition-transform" />
                    </Button>
                  )}
                </div>

                <Card className="rounded-[3rem] border-none shadow-2xl overflow-hidden bg-slate-50 p-10">
                  <div className="flex justify-between items-center mb-8">
                    <h3 className="text-2xl font-bold flex items-center gap-3">
                      <Users className="w-6 h-6" /> 참여 학생 목록
                    </h3>
                    <Badge variant="secondary" className="px-4 py-1 rounded-full">{submissions.length}명 접속</Badge>
                  </div>
                  <ScrollArea className="h-[400px] pr-4">
                    <div className="grid grid-cols-2 gap-4">
                      {submissions.map((s, i) => (
                        <motion.div 
                          key={s.id || i}
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: i * 0.1 }}
                          className="flex items-center gap-3 p-4 bg-white rounded-2xl shadow-sm border border-slate-100"
                        >
                          <div className="w-10 h-10 bg-slate-900 text-white rounded-full flex items-center justify-center text-xs font-bold">
                            {s.userName[0]}
                          </div>
                          <span className="font-bold text-slate-700">{s.userName}</span>
                        </motion.div>
                      ))}
                    </div>
                  </ScrollArea>
                </Card>
              </div>
            </motion.div>
          )}

          {game.status === 'describing' && (
            <motion.div 
              key="describing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid lg:grid-cols-2 gap-16 h-full"
            >
              <div className="space-y-8 flex flex-col">
                <Card className="rounded-[3rem] overflow-hidden border-none shadow-2xl flex-1 relative group">
                  <img src={game.artworkUrl} alt="Artwork" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Button variant="outline" className="bg-white/20 backdrop-blur-md border-white/40 text-white rounded-full px-8">
                      <Search className="mr-2 w-5 h-5" /> 크게 보기
                    </Button>
                  </div>
                </Card>
                <div className="p-10 bg-slate-900 text-white rounded-[3rem] shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/20 rounded-full blur-3xl -mr-16 -mt-16" />
                  <h3 className="font-bold text-xl mb-6 flex items-center gap-3 font-heading">
                    <Sparkles className="w-6 h-6 text-orange-400" /> 감상 가이드
                  </h3>
                  <p className="text-slate-300 leading-relaxed font-sans font-medium text-lg">
                    작품의 색채, 붓터치, 인물의 표정이나 사물의 배치를 자세히 살펴보세요. 
                    마치 눈이 보이지 않는 사람에게 이 그림을 설명해준다고 생각하고 구체적으로 적어보세요.
                  </p>
                </div>
              </div>

              <div className="flex flex-col space-y-8">
                <div className="flex justify-between items-end">
                  <div>
                    <h2 className="text-5xl font-black tracking-tighter mb-3 font-heading">작품 묘사하기</h2>
                    <p className="text-slate-500 font-sans font-medium">당신만의 언어로 걸작을 설명해주세요.</p>
                  </div>
                  <div className="flex gap-3">
                    <Button 
                      variant="outline" 
                      size="icon" 
                      className={`rounded-2xl w-14 h-14 ${isRecording ? 'bg-red-50 border-red-200 text-red-500 animate-pulse' : ''}`}
                      onClick={startVoiceRecognition}
                    >
                      <Mic className="w-6 h-6" />
                    </Button>
                    <Button 
                      variant="outline" 
                      size="icon" 
                      className="rounded-2xl w-14 h-14"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {ocrLoading ? <Loader2 className="animate-spin" /> : <PenTool className="w-6 h-6" />}
                    </Button>
                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleOCR} />
                  </div>
                </div>

                {!hasSubmitted ? (
                  <div className="flex-1 flex flex-col space-y-6">
                    <textarea 
                      className="flex-1 w-full p-10 rounded-[3rem] bg-slate-50 border-none focus:ring-4 ring-slate-100 transition-all resize-none text-xl leading-relaxed placeholder:text-slate-300"
                      placeholder="여기에 묘사를 입력하세요..."
                      value={mySubmission}
                      onChange={(e) => setMySubmission(e.target.value)}
                    />
                    <Button 
                      className="w-full bg-slate-900 text-white py-10 rounded-[2rem] text-2xl font-bold shadow-2xl shadow-slate-200"
                      onClick={handleSubmit}
                      disabled={!mySubmission.trim()}
                    >
                      묘사 제출하기
                    </Button>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    <Card className="bg-slate-900 text-white rounded-[3rem] p-16 text-center w-full shadow-2xl">
                      <div className="w-24 h-24 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-8">
                        <CheckCircle2 className="w-12 h-12 text-green-400" />
                      </div>
                      <h3 className="text-3xl font-bold mb-6">제출이 완료되었습니다!</h3>
                      <p className="text-slate-400 text-lg">다른 친구들의 묘사가 모두 모일 때까지 <br /> 잠시만 기다려주세요.</p>
                    </Card>
                  </div>
                )}

                {isTeacher && (
                  <div className="flex flex-col items-center gap-6 pt-4">
                    <div className="flex justify-center gap-6">
                      <Button 
                        variant="outline"
                        onClick={handlePrevPhase} 
                        disabled={processing}
                        className="px-8 py-6 rounded-2xl font-bold border-2"
                      >
                        <ChevronRight className="mr-2 w-5 h-5 rotate-180" />
                        대기실로 돌아가기
                      </Button>
                      <Button 
                        onClick={handleNextPhase} 
                        disabled={processing}
                        className="bg-slate-900 text-white px-10 py-6 rounded-2xl font-bold shadow-xl hover:scale-105 transition-transform"
                      >
                        투표 단계로 넘어가기
                        <ChevronRight className="ml-2 w-5 h-5" />
                      </Button>
                    </div>
                  </div>
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
              <div className="text-center max-w-3xl mx-auto">
                <Badge className="mb-6 bg-orange-100 text-orange-600 hover:bg-orange-100 border-none px-6 py-2 rounded-full font-bold tracking-widest uppercase text-xs">투표 진행 중</Badge>
                <h2 className="text-6xl font-black tracking-tighter mb-8 font-heading">최고의 묘사를 <span className="text-orange-500 font-heading">선택하세요</span></h2>
                <p className="text-slate-500 text-xl font-sans font-medium">그림을 보지 않고도 머릿속에 가장 생생하게 그려지는 글은 무엇인가요?</p>
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                {submissions.map((sub) => (
                  <motion.div
                    key={sub.id}
                    whileHover={{ y: -10 }}
                    transition={{ type: 'spring', stiffness: 300 }}
                  >
                    <Card 
                      className={`h-full rounded-[2.5rem] border-2 transition-all cursor-pointer overflow-hidden flex flex-col ${
                        hasVoted ? (profile.uid === sub.userId ? 'border-slate-200 opacity-60' : 'border-slate-100 opacity-80') : 'hover:border-slate-900 hover:shadow-2xl'
                      }`}
                      onClick={() => handleVote(sub.id)}
                    >
                      <CardContent className="p-10 flex flex-col h-full">
                        <div className="flex-1">
                          <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center mb-6">
                            <MessageSquare className="w-5 h-5 text-slate-400" />
                          </div>
                          <p className="text-2xl leading-relaxed mb-10 font-sans text-slate-800 font-bold">"{sub.description}"</p>
                        </div>
                        <Separator className="my-10 opacity-50" />
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-slate-900 text-white rounded-full flex items-center justify-center text-sm font-bold shadow-lg">
                              {sub.userName[0]}
                            </div>
                            <span className="font-black text-slate-600 tracking-tight">{sub.userName}</span>
                          </div>
                          <div className={`flex items-center gap-3 px-8 py-4 rounded-full transition-all duration-300 ${hasVoted ? 'bg-orange-500 text-white shadow-xl scale-105' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>
                            <ThumbsUp className={`w-6 h-6 ${!hasVoted && 'group-hover:scale-125 transition-transform'}`} />
                            <span className="font-black text-2xl font-heading">{sub.voteCount}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>

              {isTeacher && (
                <div className="flex justify-center gap-6 pt-12">
                  <Button 
                    variant="outline"
                    onClick={handlePrevPhase} 
                    disabled={processing}
                    className="px-12 py-8 rounded-[2rem] text-xl font-bold border-2"
                  >
                    <ChevronRight className="mr-2 w-6 h-6 rotate-180" />
                    묘사 단계로 돌아가기
                  </Button>
                  <Button 
                    onClick={handleNextPhase} 
                    disabled={processing}
                    className="bg-slate-900 text-white px-16 py-8 rounded-[2rem] text-xl font-bold shadow-2xl hover:scale-105 transition-transform"
                  >
                    투표 종료 및 결과 확인
                    <ChevronRight className="ml-2 w-6 h-6" />
                  </Button>
                </div>
              )}
            </motion.div>
          )}

          {game.status === 'results' && (
            <motion.div 
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-16"
            >
              {results.find(r => r.roundNumber === game.currentRound) ? (
                <>
                  <div className="text-center max-w-4xl mx-auto">
                    <div className="flex justify-center mb-8">
                      <div className="w-20 h-20 bg-yellow-100 rounded-[2rem] flex items-center justify-center">
                        <Trophy className="w-10 h-10 text-yellow-600" />
                      </div>
                    </div>
                    <h2 className="text-6xl font-black tracking-tighter mb-8 leading-tight font-heading">
                      "{results.find(r => r.roundNumber === game.currentRound)?.winningDescription}"
                    </h2>
                    <p className="text-2xl text-slate-500 font-sans font-medium">
                      이번 라운드 우승자: <span className="font-black text-slate-900 underline decoration-orange-500 decoration-8 underline-offset-[12px]">{results.find(r => r.roundNumber === game.currentRound)?.winningUserName}</span>
                    </p>
                  </div>

                  <div className="grid lg:grid-cols-2 gap-12">
                    <div className="space-y-6">
                      <p className="text-center font-bold text-slate-400 uppercase tracking-widest text-xs">Original Masterpiece</p>
                      <Card className="rounded-[3rem] overflow-hidden border-none shadow-2xl aspect-square">
                        <img src={game.artworkUrl} alt="Original" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      </Card>
                    </div>
                    <div className="space-y-6">
                      <p className="text-center font-bold text-orange-500 uppercase tracking-widest text-xs">AI Re-imagined (Imagen)</p>
                      <Card className="rounded-[3rem] overflow-hidden border-none shadow-2xl aspect-square ring-8 ring-orange-50">
                        <img 
                          src={results.find(r => r.roundNumber === game.currentRound)?.generatedImageUrl} 
                          alt="AI Generated" 
                          className="w-full h-full object-cover" 
                          referrerPolicy="no-referrer" 
                        />
                      </Card>
                    </div>
                  </div>

                  {results.find(r => r.roundNumber === game.currentRound)?.aiFeedback && (
                    <div className="space-y-12">
                      <Card className="bg-slate-900 text-white rounded-[3rem] border-none p-12 shadow-2xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/10 rounded-full blur-3xl -mr-32 -mt-32" />
                        <div className="relative flex items-start gap-10">
                          <div className="w-20 h-20 bg-white/10 rounded-3xl flex items-center justify-center shrink-0">
                            <Sparkles className="w-10 h-10 text-orange-400" />
                          </div>
                          <div>
                            <h3 className="text-2xl font-bold mb-6 flex items-center gap-3">
                              AI 감상 분석 피드백
                            </h3>
                            <p className="text-xl text-slate-300 leading-relaxed whitespace-pre-wrap italic">
                              {results.find(r => r.roundNumber === game.currentRound)?.aiFeedback}
                            </p>
                          </div>
                        </div>
                      </Card>

                      <div className="space-y-8">
                        <div className="flex items-center gap-4">
                          <h3 className="text-2xl font-bold">전체 투표 결과</h3>
                          <Separator className="flex-1" />
                        </div>
                        <div className="grid gap-4">
                          {[...submissions].sort((a, b) => b.voteCount - a.voteCount).map((sub, i) => (
                            <motion.div 
                              key={sub.id}
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: i * 0.1 }}
                              className={`flex items-center justify-between p-6 rounded-2xl border ${i === 0 ? 'bg-orange-50 border-orange-200' : 'bg-white border-slate-100'}`}
                            >
                              <div className="flex items-center gap-6">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${i === 0 ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                  {i + 1}
                                </div>
                                <div>
                                  <p className="font-bold text-lg">{sub.userName}</p>
                                  <p className="text-slate-500 italic text-sm">"{sub.description}"</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-sm border border-slate-50">
                                <ThumbsUp className="w-4 h-4 text-orange-500" />
                                <span className="font-bold">{sub.voteCount}표</span>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {isTeacher && (
                    <div className="flex justify-center pt-12">
                      <Button 
                        onClick={handleNextPhase} 
                        disabled={processing}
                        className="bg-slate-900 text-white px-16 py-8 rounded-[2rem] text-xl font-bold shadow-2xl hover:scale-105 transition-transform"
                      >
                        {game.currentRound < game.maxRounds ? "다음 라운드로" : "최종 결과 확인하기"}
                        <ChevronRight className="ml-2 w-6 h-6" />
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-32 space-y-12">
                  <div className="relative inline-block">
                    <Loader2 className="w-24 h-24 animate-spin text-slate-100" />
                    <Sparkles className="absolute inset-0 m-auto w-8 h-8 text-orange-400 animate-pulse" />
                  </div>
                  <div className="space-y-4">
                    <h2 className="text-3xl font-bold text-slate-900">AI가 걸작을 재창조하고 있습니다...</h2>
                    <p className="text-slate-400 text-lg">Imagen API를 통해 묘사글을 이미지로 변환하는 중입니다.</p>
                  </div>
                  {isTeacher && (
                    <Button 
                      onClick={handleGenerateAIImage} 
                      disabled={processing}
                      className="bg-slate-900 text-white px-12 py-8 rounded-2xl text-xl font-bold"
                    >
                      {processing ? <Loader2 className="animate-spin mr-2" /> : <ImageIcon className="mr-2" />}
                      AI 이미지 생성 시작
                    </Button>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {game.status === 'finished' && (
            <motion.div 
              key="finished"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-20 pb-32"
            >
              <div className="text-center py-20">
                <div className="w-32 h-32 bg-yellow-100 rounded-[3rem] flex items-center justify-center mx-auto mb-10">
                  <Trophy className="w-16 h-16 text-yellow-600" />
                </div>
                <h2 className="text-7xl font-black tracking-tighter mb-6">감상 여정 완료</h2>
                <p className="text-2xl text-slate-500">오늘 탄생한 새로운 걸작들을 확인해보세요.</p>
              </div>

              <div className="space-y-32">
                {results.map((res) => (
                  <div key={res.roundNumber} className="grid lg:grid-cols-2 gap-20 items-center">
                    <div className="space-y-8">
                      <div className="flex items-center gap-4">
                        <Badge className="bg-slate-900 text-white px-4 py-1 rounded-full">ROUND {res.roundNumber}</Badge>
                        <Separator className="flex-1" />
                      </div>
                      <h3 className="text-4xl font-bold italic leading-tight">"{res.winningDescription}"</h3>
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center font-bold">
                          {res.winningUserName[0]}
                        </div>
                        <div>
                          <p className="font-bold text-lg">{res.winningUserName}</p>
                          <p className="text-slate-400 text-sm">Best Describer</p>
                        </div>
                      </div>
                    </div>
                    <div className="relative">
                      <div className="absolute -inset-4 bg-orange-100 rounded-[4rem] -rotate-2" />
                      <Card className="relative rounded-[3.5rem] overflow-hidden border-none shadow-2xl aspect-square group">
                        <img src={res.generatedImageUrl} alt={`Round ${res.roundNumber}`} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Button 
                            variant="outline" 
                            className="bg-white text-slate-900 rounded-full px-6"
                            onClick={() => {
                              const link = document.createElement('a');
                              link.href = res.generatedImageUrl;
                              link.download = `masterpiece-round-${res.roundNumber}.jpg`;
                              link.click();
                            }}
                          >
                            <Download className="mr-2 w-4 h-4" /> 이미지 저장
                          </Button>
                        </div>
                      </Card>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-center gap-6 pt-20">
                {isTeacher && (
                  <Button 
                    variant="outline"
                    onClick={handlePrevPhase} 
                    disabled={processing}
                    className="rounded-[2rem] px-12 py-8 text-xl font-bold border-2"
                  >
                    <ChevronRight className="mr-2 w-6 h-6 rotate-180" />
                    결과 화면으로 돌아가기
                  </Button>
                )}
                <Button onClick={onExit} variant="outline" className="rounded-[2rem] px-16 py-8 text-xl font-bold border-2 hover:bg-slate-900 hover:text-white transition-all">
                  메인 화면으로 돌아가기
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function TeacherDashboard({ profile, onJoinGame, onBack }: { profile: UserProfile, onJoinGame: (id: string) => void, onBack: () => void }) {
  const [artworkUrl, setArtworkUrl] = useState('');
  const [artworkTitle, setArtworkTitle] = useState('');
  const [rounds, setRounds] = useState(3);
  const [creating, setCreating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setArtworkUrl(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCreateGame = async () => {
    if (!artworkUrl || !artworkTitle) {
      alert('작품 제목과 이미지를 설정해주세요.');
      return;
    }
    setCreating(true);
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    const gameId = await firestoreService.createGame({
      code,
      teacherId: profile.uid,
      status: 'lobby',
      currentRound: 1,
      maxRounds: rounds,
      artworkUrl,
      artworkTitle,
      timerSeconds: 120
    });
    if (gameId) onJoinGame(gameId);
    setCreating(false);
  };

  return (
    <div className="max-w-4xl mx-auto px-8 py-20">
      <header className="flex justify-between items-center mb-16">
        <div className="flex items-center gap-6">
          <Button variant="ghost" size="icon" onClick={onBack} className="rounded-full w-12 h-12">
            <ArrowRight className="rotate-180 w-6 h-6" />
          </Button>
          <h2 className="text-5xl font-black tracking-tighter font-heading">수업 세션 만들기</h2>
        </div>
        <Badge className="bg-orange-100 text-orange-600 hover:bg-orange-100 border-none px-6 py-2 rounded-full font-bold tracking-widest uppercase text-xs">
          {profile.name} 선생님
        </Badge>
      </header>

      <div className="space-y-16">
        <Card className="rounded-[4rem] border-none shadow-2xl overflow-hidden bg-white p-16">
          <div className="grid lg:grid-cols-2 gap-16">
            <div className="space-y-10">
              <div className="space-y-6">
                <Label className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">1. 작품 설정</Label>
                <Input 
                  placeholder="작품 제목을 입력하세요 (예: 별이 빛나는 밤)" 
                  value={artworkTitle}
                  onChange={(e) => setArtworkTitle(e.target.value)}
                  className="rounded-2xl h-16 text-xl border-slate-100 bg-slate-50 px-6 font-sans font-bold"
                />
                <div className="flex gap-4">
                  <Button 
                    variant="outline" 
                    className="flex-1 rounded-2xl h-16 font-bold border-2 border-dashed border-slate-200 hover:border-slate-900 hover:bg-slate-50 transition-all duration-300"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImageIcon className="mr-3 w-6 h-6" /> 이미지 불러오기
                  </Button>
                  <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                  <Button 
                    variant="ghost" 
                    className="rounded-2xl h-16 px-8 font-bold text-slate-400 hover:text-slate-900 hover:bg-slate-50"
                    onClick={() => {
                      const randomId = Math.floor(Math.random() * 1000);
                      setArtworkUrl(`https://picsum.photos/seed/${randomId}/1200/900`);
                      setArtworkTitle(`랜덤 명화 #${randomId}`);
                    }}
                  >
                    랜덤 선택
                  </Button>
                </div>
              </div>

              <div className="space-y-6">
                <Label className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">2. 게임 규칙</Label>
                <div className="bg-slate-50 p-8 rounded-[2.5rem] space-y-8">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-lg">진행 라운드</span>
                    <Badge className="bg-slate-900 text-white px-4 py-1 rounded-full">{rounds} 라운드</Badge>
                  </div>
                  <Slider 
                    value={[rounds]} 
                    onValueChange={(v) => setRounds(v[0])} 
                    max={5} 
                    min={1} 
                    step={1} 
                    className="py-4"
                  />
                </div>
              </div>

              <Button 
                className="w-full bg-slate-900 hover:bg-slate-800 text-white py-12 rounded-[2.5rem] text-2xl font-bold shadow-2xl transition-all active:scale-[0.98] group"
                onClick={handleCreateGame}
                disabled={creating}
              >
                {creating ? <Loader2 className="animate-spin mr-3" /> : <Play className="mr-4 w-8 h-8 group-hover:scale-110 transition-transform" />}
                게임 시작하기
              </Button>
            </div>

            <div className="flex flex-col justify-center">
              {artworkUrl ? (
                <div className="space-y-6">
                  <Label className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] text-center block">미리보기</Label>
                  <Card className="rounded-[3.5rem] overflow-hidden border-none shadow-2xl aspect-[4/3] relative group ring-1 ring-slate-100">
                    <img src={artworkUrl} alt="Preview" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" referrerPolicy="no-referrer" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex items-end p-10">
                      <p className="text-white font-bold text-2xl font-heading">{artworkTitle}</p>
                    </div>
                  </Card>
                </div>
              ) : (
                <div className="aspect-[4/3] bg-slate-50 rounded-[3.5rem] border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-300 group hover:border-slate-400 transition-colors">
                  <ImageIcon className="w-20 h-20 mb-6 opacity-20 group-hover:scale-110 transition-transform" />
                  <p className="font-bold text-lg">이미지를 선택해주세요</p>
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
