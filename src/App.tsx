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
  PenTool
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
  { title: '별이 빛나는 밤 (고흐)', url: 'https://images.unsplash.com/photo-1578301978693-85fa9c0320b9?q=80&w=1000&auto=format&fit=crop' },
  { title: '진주 귀걸이를 한 소녀 (베르메르)', url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?q=80&w=1000&auto=format&fit=crop' },
  { title: '절규 (뭉크)', url: 'https://images.unsplash.com/photo-1577083552431-6e5fd01aa342?q=80&w=1000&auto=format&fit=crop' },
  { title: '모나리자 (다빈치)', url: 'https://images.unsplash.com/photo-1582555172866-f73bb12a2ab3?q=80&w=1000&auto=format&fit=crop' }
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
        alert("오류: 현재 도메인이 Firebase에 등록되지 않았습니다.\n\n해결방법:\n1. Firebase 콘솔 > Authentication > Settings > Authorized domains 로 이동\n2. 현재 Vercel 도메인을 추가해 주세요.");
      } else if (error.code === 'auth/popup-blocked') {
        alert("팝업이 차단되었습니다. 브라우저 설정에서 팝업을 허용하거나, 앱을 새 탭에서 열어주세요.");
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
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-12 h-12 text-slate-400 animate-spin" />
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
      <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
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
        alert("유효하지 않은 코드입니다.");
      }
    } catch (error: any) {
      alert("입장 중 오류가 발생했습니다: " + error.message);
    }
    setJoining(false);
  };

  return (
    <div className="relative min-h-screen flex flex-col">
      <div className="relative h-[40vh] overflow-hidden bg-slate-900">
        <img 
          src="https://picsum.photos/seed/art/1920/1080" 
          alt="Hero" 
          className="w-full h-full object-cover opacity-50"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-slate-900" />
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center justify-center gap-4 mb-4">
              <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-xl">
                <Palette className="text-slate-900 w-6 h-6" />
              </div>
              <h1 className="text-6xl font-black text-white tracking-tighter">ACE CANVAS</h1>
            </div>
            <p className="text-xl text-slate-300 max-w-2xl mx-auto font-medium">
              AI와 함께하는 실시간 미술 감상 게임
            </p>
          </motion.div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto w-full px-6 -mt-16 relative z-10 pb-24">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Student Card */}
          <Card className="rounded-[2.5rem] border-none shadow-2xl overflow-hidden bg-white">
            <CardHeader className="p-10 pb-0">
              <div className="flex items-center gap-3 mb-4">
                <Play className="w-6 h-6 text-slate-900" />
                <CardTitle className="text-3xl font-black tracking-tighter">학생으로 입장하기</CardTitle>
              </div>
              <CardDescription className="font-medium">코드를 입력하고 게임에 참여하세요.</CardDescription>
            </CardHeader>
            <CardContent className="p-10 space-y-6">
              <div className="space-y-4">
                <Input placeholder="닉네임 입력" value={nickname} onChange={(e) => setNickname(e.target.value)} className="rounded-xl h-14" />
                <Input placeholder="6자리 코드" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} className="rounded-xl h-14 text-center font-bold text-xl tracking-widest" />
              </div>
              <Button className="w-full bg-slate-900 text-white py-8 rounded-2xl text-xl font-bold" onClick={handleStudentJoin} disabled={joining}>
                {joining ? <Loader2 className="animate-spin" /> : "게임 시작하기"}
              </Button>
              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center"><Separator /></div>
                <span className="relative bg-white px-2 text-xs text-slate-400 uppercase mx-auto block w-fit">또는</span>
              </div>
              <Button variant="outline" className="w-full border-2 py-8 rounded-2xl text-lg font-bold flex items-center justify-center gap-3" onClick={() => onGoogleLogin('student')}>
                <LogIn className="w-5 h-5" /> 구글로 입장하기
              </Button>
            </CardContent>
          </Card>

          {/* Teacher Card */}
          <Card className="rounded-[2.5rem] border-none shadow-2xl overflow-hidden bg-white">
            <CardHeader className="p-10 pb-0">
              <div className="flex items-center gap-3 mb-4">
                <Users className="w-6 h-6 text-slate-900" />
                <CardTitle className="text-3xl font-black tracking-tighter">교사로 입장하기</CardTitle>
              </div>
              <CardDescription className="font-medium">수업 세션을 생성하고 관리하세요.</CardDescription>
            </CardHeader>
            <CardContent className="p-10 flex flex-col justify-between h-[calc(100%-140px)]">
              <p className="text-slate-500 font-medium mb-8">교사 계정으로 로그인하면 작품 선정 및 AI 피드백 관리가 가능합니다.</p>
              {user && profile?.role === 'teacher' ? (
                <div className="space-y-4">
                  <Button 
                    className="w-full bg-orange-500 hover:bg-orange-600 text-white py-12 rounded-3xl text-2xl font-black shadow-2xl group flex items-center justify-center gap-3"
                    onClick={onCreateGame}
                  >
                    <Sparkles className="w-8 h-8" />
                    수업 시작하기
                  </Button>
                  <Button variant="ghost" className="w-full text-slate-400 flex items-center justify-center gap-2" onClick={onLogout}>
                    <LogOut className="w-4 h-4" /> 로그아웃
                  </Button>
                </div>
              ) : (
                <Button className="w-full bg-slate-900 text-white py-8 rounded-2xl text-xl font-bold flex items-center justify-center gap-3" onClick={() => onGoogleLogin('teacher')}>
                  <LogIn className="w-6 h-6" /> 구글로 로그인
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Info Card */}
          <Card className="rounded-[2.5rem] border-none shadow-2xl bg-white cursor-pointer hover:bg-slate-50 transition-colors" onClick={onViewDescription}>
            <CardContent className="p-10 flex flex-col justify-center h-full">
              <div className="w-16 h-16 bg-orange-500 rounded-2xl flex items-center justify-center mb-8 shadow-lg shadow-orange-200">
                <Info className="text-white w-8 h-8" />
              </div>
              <h3 className="text-4xl font-black mb-4 tracking-tighter">게임 방법</h3>
              <p className="text-slate-500 text-lg font-medium">ACE CANVAS의 상세한 가이드를 확인하세요.</p>
            </CardContent>
          </Card>

          {/* Hall of Fame Row */}
          <Card className="rounded-[2.5rem] border-none shadow-2xl bg-orange-500 text-white cursor-pointer lg:col-span-3" onClick={onViewHallOfFame}>
            <CardContent className="p-10 flex items-center gap-8">
              <div className="w-20 h-20 bg-white/20 rounded-3xl flex items-center justify-center shrink-0">
                <Trophy className="w-10 h-10 text-white" />
              </div>
              <div>
                <h3 className="text-4xl font-black tracking-tighter">명예의 전당</h3>
                <p className="text-orange-100 text-xl font-medium">지금까지 탄생한 최고의 묘사와 AI 걸작들을 감상하세요.</p>
              </div>
              <ArrowRight className="ml-auto w-10 h-10 opacity-50" />
            </CardContent>
          </Card>
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

  if (!game) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="border-b px-8 py-4 flex justify-between items-center sticky top-0 bg-white z-50">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onExit}><ArrowRight className="rotate-180" /></Button>
          <h1 className="font-black text-xl">{game.artworkTitle}</h1>
          <Badge variant="outline">ROUND {game.currentRound}/{game.maxRounds}</Badge>
        </div>
        {isTeacher && (
          <div className="flex items-center gap-4">
            <span className="font-bold text-orange-500">코드: {game.code}</span>
            <Button onClick={handleNextPhase} disabled={processing}>
              {processing ? <Loader2 className="animate-spin" /> : "다음 단계로"}
            </Button>
          </div>
        )}
      </header>

      <main className="flex-1 p-8 max-w-6xl mx-auto w-full">
        {game.status === 'lobby' && (
          <div className="text-center py-20 space-y-8">
            <h2 className="text-6xl font-black">학생들을 기다리는 중...</h2>
            <div className="bg-slate-900 text-white p-10 rounded-[3rem] inline-block">
              <p className="text-sm uppercase tracking-widest opacity-50 mb-2">입장 코드</p>
              <p className="text-8xl font-black text-orange-400">{game.code}</p>
            </div>
            {isTeacher && <Button size="lg" onClick={handleNextPhase} className="block mx-auto px-10 py-8 text-2xl rounded-2xl">게임 시작하기</Button>}
          </div>
        )}

        {game.status === 'describing' && (
          <div className="grid md:grid-cols-2 gap-12">
            <Card className="overflow-hidden rounded-[2rem] shadow-xl">
              <img src={game.artworkUrl} alt="Art" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            </Card>
            <div className="space-y-6">
              <h2 className="text-4xl font-black">작품을 묘사해 주세요</h2>
              {!hasSubmitted ? (
                <>
                  <textarea 
                    className="w-full h-64 p-6 bg-slate-50 rounded-2xl border-none text-lg"
                    placeholder="그림을 보지 못하는 친구에게 설명하듯 자세히 적어보세요..."
                    value={mySubmission}
                    onChange={(e) => setMySubmission(e.target.value)}
                  />
                  <Button className="w-full py-8 text-xl rounded-2xl" onClick={handleSubmit}>제출하기</Button>
                </>
              ) : (
                <div className="bg-green-50 text-green-600 p-10 rounded-2xl text-center font-bold">제출이 완료되었습니다!</div>
              )}
            </div>
          </div>
        )}

        {game.status === 'voting' && (
          <div className="space-y-8">
            <h2 className="text-4xl font-black text-center">가장 생생한 묘사를 선택하세요</h2>
            <div className="grid md:grid-cols-2 gap-6">
              {submissions.map(sub => (
                <Card key={sub.id} className={`p-8 rounded-2xl cursor-pointer transition-all ${hasVoted ? 'opacity-50' : 'hover:scale-105'}`} onClick={() => handleVote(sub.id)}>
                  <p className="text-xl font-medium mb-4">"{sub.description}"</p>
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-slate-400">{sub.userName}</span>
                    <Badge className="bg-orange-500">{sub.voteCount}표</Badge>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {game.status === 'results' && (
          <div className="space-y-10">
            {results.find(r => r.roundNumber === game.currentRound) ? (
              <div className="grid md:grid-cols-2 gap-12">
                <div className="space-y-6">
                  <h2 className="text-3xl font-bold">AI가 재해석한 이미지</h2>
                  <Card className="overflow-hidden rounded-[2rem] shadow-2xl border-4 border-orange-400">
                    <img src={results.find(r => r.roundNumber === game.currentRound)?.generatedImageUrl} alt="AI" className="w-full aspect-square object-cover" />
                  </Card>
                </div>
                <div className="space-y-6">
                  <h2 className="text-3xl font-bold">AI 피드백</h2>
                  <Card className="p-8 bg-slate-900 text-white rounded-[2rem]">
                    <p className="text-lg leading-relaxed italic">"{results.find(r => r.roundNumber === game.currentRound)?.aiFeedback}"</p>
                  </Card>
                </div>
              </div>
            ) : (
              <div className="text-center py-20 space-y-6">
                <Loader2 className="w-16 h-16 animate-spin mx-auto text-orange-500" />
                <h2 className="text-2xl font-bold">AI가 이미지를 생성하고 있습니다...</h2>
                {isTeacher && <Button onClick={handleGenerateAI}>이미지 생성 시작</Button>}
              </div>
            )}
          </div>
        )}

        {game.status === 'finished' && (
          <div className="text-center py-20 space-y-10">
            <Trophy className="w-24 h-24 mx-auto text-yellow-500" />
            <h2 className="text-6xl font-black">모든 라운드 종료!</h2>
            <Button size="lg" onClick={onExit}>메인으로 돌아가기</Button>
          </div>
        )}
      </main>
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
      alert("이미지가 업로드되었습니다!");
    } catch (error) {
      console.error("Upload error:", error);
      alert("이미지 업로드에 실패했습니다.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-20 px-6 space-y-12">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={onBack} className="rounded-full">
            <ArrowRight className="rotate-180" />
          </Button>
          <h2 className="text-4xl font-black tracking-tighter">수업 시작하기</h2>
        </div>
        <Badge className="bg-slate-900 text-white px-4 py-1 rounded-full">교사 모드</Badge>
      </div>

      <div className="grid lg:grid-cols-2 gap-12">
        {/* Left: Default Artworks */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="text-orange-500 w-5 h-5" />
            <h3 className="text-xl font-bold">추천 미술 작품</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {DEFAULT_ARTWORKS.map((art, i) => (
              <Card 
                key={i} 
                className="overflow-hidden rounded-2xl cursor-pointer hover:ring-4 hover:ring-orange-500 transition-all group relative"
                onClick={() => handleCreate(art)}
              >
                <div className="aspect-[4/3] relative">
                  <img src={art.url} alt={art.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" referrerPolicy="no-referrer" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Play className="text-white w-8 h-8" />
                  </div>
                </div>
                <div className="p-3 bg-white">
                  <p className="text-sm font-bold truncate">{art.title}</p>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* Right: Custom Upload */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 mb-4">
            <PenTool className="text-slate-900 w-5 h-5" />
            <h3 className="text-xl font-bold">새로운 작품 등록</h3>
          </div>
          <Card className="p-8 rounded-[2.5rem] shadow-xl border-dashed border-2 border-slate-200 bg-slate-50/50">
            <div className="space-y-8">
              <div 
                className="aspect-video rounded-2xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center cursor-pointer hover:bg-white transition-colors overflow-hidden relative"
                onClick={() => fileInputRef.current?.click()}
              >
                {url ? (
                  <img src={url} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <>
                    <Camera className="w-12 h-12 text-slate-300 mb-2" />
                    <p className="text-slate-400 font-medium">이미지 파일 불러오기</p>
                  </>
                )}
                {uploading && (
                  <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                    <Loader2 className="animate-spin text-slate-900" />
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

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="font-bold">작품 제목</Label>
                  <Input 
                    placeholder="작품의 이름을 입력하세요" 
                    value={title} 
                    onChange={e => setTitle(e.target.value)} 
                    className="h-14 rounded-xl bg-white" 
                  />
                </div>
                <Button 
                  className="w-full py-8 text-xl rounded-2xl bg-slate-900" 
                  onClick={() => handleCreate()} 
                  disabled={creating || uploading || !url}
                >
                  {creating ? <Loader2 className="animate-spin" /> : "이 작품으로 시작하기"}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function HallOfFame({ onBack }: any) {
  return (
    <div className="p-10 max-w-7xl mx-auto">
      <Button onClick={onBack} className="mb-10"><ArrowRight className="rotate-180 mr-2" /> 돌아가기</Button>
      <h2 className="text-5xl font-black mb-10">명예의 전당</h2>
      <div className="grid md:grid-cols-3 gap-8">
        <p className="text-slate-400">아직 등록된 작품이 없습니다.</p>
      </div>
    </div>
  );
}

function DescriptionPage({ onBack }: any) {
  return (
    <div className="p-10 max-w-4xl mx-auto space-y-10">
      <Button onClick={onBack}><ArrowRight className="rotate-180 mr-2" /> 돌아가기</Button>
      <h2 className="text-5xl font-black">게임 방법</h2>
      <div className="space-y-6 text-xl leading-relaxed text-slate-600">
        <div className="flex gap-4">
          <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center shrink-0">1</div>
          <p>교사가 작품을 선정하고 6자리 입장 코드를 생성합니다.</p>
        </div>
        <div className="flex gap-4">
          <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center shrink-0">2</div>
          <p>학생들은 코드를 입력해 입장하고, 작품을 상세히 묘사합니다.</p>
        </div>
        <div className="flex gap-4">
          <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center shrink-0">3</div>
          <p>가장 훌륭한 묘사를 투표하여 선정합니다.</p>
        </div>
        <div className="flex gap-4">
          <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center shrink-0">4</div>
          <p>선정된 묘사를 바탕으로 AI가 새로운 이미지를 생성하고 피드백을 줍니다.</p>
        </div>
      </div>
    </div>
  );
}
