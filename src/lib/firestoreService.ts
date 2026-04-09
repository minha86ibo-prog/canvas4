import { auth, db } from '../firebase';
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  addDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy,
  Timestamp,
  increment,
  limit
} from 'firebase/firestore';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // Surface a user-friendly error that also contains the technical details for debugging
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('permission-denied') || message.includes('Missing or insufficient permissions')) {
    alert(`권한 오류가 발생했습니다. (Firestore Security Rules 확인 필요)\n\n상세 정보: ${message}\n작업: ${operationType}\n경로: ${path}`);
  }
  throw new Error(JSON.stringify(errInfo));
}

export const firestoreService = {
  async getUser(uid: string) {
    const path = `users/${uid}`;
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      return snap.exists() ? snap.data() : null;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    }
  },

  async createUser(uid: string, data: any) {
    const path = `users/${uid}`;
    try {
      await setDoc(doc(db, 'users', uid), {
        ...data,
        createdAt: Timestamp.now()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  async createGame(data: any) {
    const path = 'games';
    try {
      const docRef = await addDoc(collection(db, 'games'), {
        ...data,
        createdAt: Timestamp.now()
      });
      return docRef.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  async updateGame(gameId: string, data: any) {
    const path = `games/${gameId}`;
    try {
      await updateDoc(doc(db, 'games', gameId), data);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async getGameByCode(code: string) {
    const path = 'games';
    try {
      const q = query(collection(db, 'games'), where('code', '==', code), where('status', '!=', 'finished'), orderBy('status'), limit(1));
      const snap = await getDocs(q);
      if (snap.empty) return null;
      return { id: snap.docs[0].id, ...snap.docs[0].data() };
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  },

  async getTeacherGames(teacherId: string) {
    const path = 'games';
    try {
      const q = query(
        collection(db, 'games'), 
        where('teacherId', '==', teacherId), 
        orderBy('createdAt', 'desc'),
        limit(10)
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  },

  async getStudentSubmissions(userId: string) {
    const path = 'submissions_history'; // We'd need a way to query across subcollections or a flat collection
    // For now, let's just provide a placeholder or skip if too complex for this structure
    return [];
  },

  subscribeToGame(gameId: string, callback: (data: any) => void) {
    const path = `games/${gameId}`;
    return onSnapshot(doc(db, 'games', gameId), (snap) => {
      if (snap.exists()) callback({ id: snap.id, ...snap.data() });
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });
  },

  async submitDescription(gameId: string, data: any) {
    const path = `games/${gameId}/submissions`;
    try {
      await addDoc(collection(db, 'games', gameId, 'submissions'), {
        ...data,
        voteCount: 0,
        createdAt: Timestamp.now()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  subscribeToSubmissions(gameId: string, roundNumber: number, callback: (data: any[]) => void) {
    const path = `games/${gameId}/submissions`;
    const q = query(
      collection(db, 'games', gameId, 'submissions'), 
      where('roundNumber', '==', roundNumber),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, (snap) => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
  },

  async voteForSubmission(gameId: string, submissionId: string) {
    const path = `games/${gameId}/submissions/${submissionId}`;
    try {
      const docRef = doc(db, 'games', gameId, 'submissions', submissionId);
      await updateDoc(docRef, {
        voteCount: increment(1)
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async saveResult(gameId: string, data: any) {
    const path = `games/${gameId}/results`;
    try {
      await addDoc(collection(db, 'games', gameId, 'results'), {
        ...data,
        createdAt: Timestamp.now()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  subscribeToResults(gameId: string, callback: (data: any[]) => void) {
    const path = `games/${gameId}/results`;
    const q = query(collection(db, 'games', gameId, 'results'), orderBy('roundNumber', 'asc'));
    return onSnapshot(q, (snap) => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
  }
};
