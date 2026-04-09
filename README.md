# ACE CANVAS - AI 실시간 미술 감상 게임

AI와 함께하는 실시간 미술 감상 교육 플랫폼입니다.

## 🚀 배포 가이드 (GitHub + Vercel)

이 프로젝트를 GitHub에 업로드하고 Vercel을 통해 배포하는 단계별 가이드입니다.

### 1단계: GitHub 저장소 생성 및 코드 업로드
1. [GitHub](https://github.com/)에 로그인합니다.
2. 우측 상단의 **[+]** 아이콘을 클릭하고 **[New repository]**를 선택합니다.
3. 저장소 이름(예: `ace-canvas`)을 입력하고 **[Create repository]**를 클릭합니다.
4. **[uploading an existing file]** 링크를 클릭합니다.
5. AI Studio에서 다운로드하여 압축을 푼 모든 파일(node_modules 제외)을 드래그 앤 드롭으로 업로드합니다.
6. 하단의 **[Commit changes]**를 클릭하여 업로드를 완료합니다.

### 2단계: Vercel 프로젝트 생성 및 연결
1. [Vercel](https://vercel.com/)에 접속하여 GitHub 계정으로 로그인합니다.
2. **[+ New Project]** 버튼을 클릭합니다.
3. 방금 생성한 GitHub 저장소를 찾아 **[Import]**를 클릭합니다.

### 3단계: 환경 변수(Environment Variables) 설정
Vercel 배포 화면의 **Environment Variables** 섹션에서 다음 변수들을 추가해야 합니다.

1. `GEMINI_API_KEY`: Google AI Studio에서 발급받은 API 키
2. `VITE_FIREBASE_API_KEY`: `firebase-applet-config.json`의 `apiKey`
3. `VITE_FIREBASE_AUTH_DOMAIN`: `firebase-applet-config.json`의 `authDomain`
4. `VITE_FIREBASE_PROJECT_ID`: `firebase-applet-config.json`의 `projectId`
5. `VITE_FIREBASE_APP_ID`: `firebase-applet-config.json`의 `appId`
6. `VITE_FIREBASE_FIRESTORE_DATABASE_ID`: `firebase-applet-config.json`의 `firestoreDatabaseId`

> **중요:** 클라이언트 측(Vite)에서 접근하는 변수는 반드시 `VITE_` 접두사를 붙여야 합니다.

### 4단계: 빌드 설정 (Build Settings)
만약 빌드 에러가 발생한다면 다음 설정을 확인하세요.
- **Framework Preset:** Vite
- **Build Command:** `npm run build`
- **Output Directory:** `dist`

### ❌ 빌드 에러 발생 시 해결 방법
Vercel에서 `Build Failed`가 뜬다면 다음을 시도해 보세요:
1. Vercel 프로젝트 설정의 **Build & Development Settings**에서 `Build Command`를 `OVERRIDE` 한 뒤 `vite build`로 입력합니다.
2. 환경 변수가 정확히 입력되었는지 다시 확인합니다.

### 5단계: Firebase 서비스 활성화 (필수)
배포된 사이트가 정상 작동하려면 Firebase 콘솔에서 다음 설정을 반드시 완료해야 합니다.

1. **Authentication 활성화:**
   - [Firebase Console](https://console.firebase.google.com/) 접속 -> 프로젝트 선택
   - **Build > Authentication > Sign-in method** 클릭
   - **Google** 로그인 활성화 (교사용)
   - **익명(Anonymous)** 로그인 활성화 (학생용)
   - **Authorized domains**에 Vercel 배포 URL 추가 (예: `ace-canvas.vercel.app`)

2. **Firestore Database 생성:**
   - **Build > Firestore Database** 클릭
   - **Create database** 클릭 -> 위치 선택 -> **Production mode**로 시작
   - AI Studio에서 다운로드한 `firestore.rules` 내용을 복사하여 **Rules** 탭에 붙여넣고 **Publish** 클릭

3. **Storage 활성화:**
   - **Build > Storage** 클릭 -> **Get started** 클릭 -> 기본 설정으로 완료

---

## 🛠 주요 기능
- **학생 체험:** 실시간 작품 묘사 및 투표 참여 (익명 로그인)
- **교사 체험:** 게임 세션 생성 및 실시간 대시보드 관리 (구글 로그인)
- **AI 이미지 생성:** 우승작 묘사를 바탕으로 한 AI의 재해석 (Imagen 4.0)
- **AI 피드백:** 작품 관찰력 향상을 위한 맞춤형 교육 피드백 (Gemini 1.5 Flash)
- **명예의 전당:** 역대 우승작 및 AI 생성 이미지 갤러리

## 📦 기술 스택
- **Frontend:** React, TypeScript, Tailwind CSS, Shadcn UI, Framer Motion
- **Backend:** Firebase (Firestore, Auth)
- **AI:** Google Gemini API (Generative AI SDK)
