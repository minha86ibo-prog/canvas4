import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfigJson from '../firebase-applet-config.json';

// @ts-ignore
const metaEnv = import.meta.env;

// Support both JSON config and environment variables (for Vercel)
const config = {
  apiKey: metaEnv.VITE_FIREBASE_API_KEY || firebaseConfigJson.apiKey,
  authDomain: metaEnv.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfigJson.authDomain,
  projectId: metaEnv.VITE_FIREBASE_PROJECT_ID || firebaseConfigJson.projectId,
  storageBucket: metaEnv.VITE_FIREBASE_STORAGE_BUCKET || `${(metaEnv.VITE_FIREBASE_PROJECT_ID || firebaseConfigJson.projectId)}.appspot.com`,
  messagingSenderId: metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfigJson.messagingSenderId,
  appId: metaEnv.VITE_FIREBASE_APP_ID || firebaseConfigJson.appId,
};

const firestoreDatabaseId = metaEnv.VITE_FIREBASE_FIRESTORE_DATABASE_ID || firebaseConfigJson.firestoreDatabaseId;

const app = initializeApp(config);
export const db = getFirestore(app, firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);

export default app;
