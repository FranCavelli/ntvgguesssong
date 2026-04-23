import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';

// Pegá acá la config que te da Firebase Console → Project Settings → Tus apps (web).
// Es seguro que esto sea público: la protección real vive en las Firestore Rules.
const firebaseConfig = {
  apiKey:            'AIzaSyCRwycwt0xTUgygmDKtIOtA34L8agl_64E',
  authDomain:        'ntvgguesssong.firebaseapp.com',
  projectId:         'ntvgguesssong',
  storageBucket:     'ntvgguesssong.firebasestorage.app',
  messagingSenderId: '321979742293',
  appId:             '1:321979742293:web:81eea410a860cad85cfcdc',
};

let app: FirebaseApp | null = null;
let db:  Firestore   | null = null;

function getDb(): Firestore {
  if (!app) app = initializeApp(firebaseConfig);
  if (!db)  db  = getFirestore(app);
  return db;
}

export interface ScoreEntry {
  id: string;
  name: string;
  score: number;
}

export async function getTopScores(count = 5): Promise<ScoreEntry[]> {
  const d = getDb();
  const q = query(
    collection(d, 'leaderboard'),
    orderBy('score', 'desc'),
    limit(count),
  );
  const snap = await getDocs(q);
  return snap.docs.map(doc => {
    const data = doc.data();
    return {
      id:    doc.id,
      name:  String(data.name ?? '').slice(0, 20),
      score: Number(data.score ?? 0),
    };
  });
}

export async function submitScore(name: string, score: number): Promise<void> {
  const d = getDb();
  const cleanName = name.trim().slice(0, 20);
  if (!cleanName) throw new Error('Nombre vacío');
  await addDoc(collection(d, 'leaderboard'), {
    name:      cleanName,
    score:     Math.max(0, Math.floor(score)),
    createdAt: serverTimestamp(),
  });
}
