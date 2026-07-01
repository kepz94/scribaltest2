// presentRoom.ts
// Live "present rooms" for Study Tables: the presenter shares a QR code, and
// anyone who scans it follows the presentation on their own device in real
// time. A room is one Firestore document under rooms/{code} carrying the
// table, the marks + theme names its verses need (serialized as JSON strings,
// so viewers need none of the presenter's local data), and the live beat
// position. The presenter writes; viewers just listen.
//
// Firestore security rules needed (add alongside the existing users rules):
//   match /rooms/{code} {
//     allow read: if true;                      // anyone with the code can follow
//     allow create, update, delete: if request.auth != null;  // presenters sign in
//   }

import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
} from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";

// Same project as cloudSync; guarded so whichever module loads first wins.
const firebaseConfig = {
  apiKey: "AIzaSyDz_Xhisj5POlSc0VFTDQ936Dm3p_j4stM",
  authDomain: "scribal-f8710.firebaseapp.com",
  projectId: "scribal-f8710",
  storageBucket: "scribal-f8710.firebasestorage.app",
  messagingSenderId: "575140590101",
  appId: "1:575140590101:web:5bf91929a54b9c2378941c",
  measurementId: "G-C5ZBWXQJ28",
};
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);

// What lives in a room document. Everything a viewer needs is self-contained:
// no account, no local marks.
export interface RoomDoc {
  tableJson: string; // the StudyTable (cards drive the beats)
  marksJson: string; // Mark[] for the table's verses (rendering the marking)
  themesJson: string; // { [refsKey]: {color,label}[] } — named themes per card
  i: number; // the presenter's current beat
  revealed: number[]; // beat indexes whose veil the presenter lifted
  ended: boolean;
  updatedAt: number;
  // The presenter. Security rules only let this uid update or end the room —
  // everyone else can only read (watch).
  ownerUid: string;
}

// The lookup key a card's themes are stored under (mirrored by the viewer).
export const themesKey = (refs: string[], bookId?: string) =>
  refs.join(",") + "|" + (bookId || "");

// Six unambiguous characters (no 0/O or 1/I).
export function newRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let k = 0; k < 6; k++)
    out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function joinUrl(code: string): string {
  return (
    window.location.origin + window.location.pathname + "?room=" + code
  );
}

export async function createRoom(
  code: string,
  payload: Omit<RoomDoc, "i" | "revealed" | "ended" | "updatedAt" | "ownerUid">
): Promise<void> {
  const uid = getAuth(app).currentUser?.uid;
  if (!uid) throw new Error("not-signed-in");
  await setDoc(doc(db, "rooms", code), {
    ...payload,
    ownerUid: uid,
    i: 0,
    revealed: [],
    ended: false,
    updatedAt: Date.now(),
  });
}

export function pushBeat(code: string, i: number, revealed: number[]): void {
  updateDoc(doc(db, "rooms", code), {
    i,
    revealed,
    updatedAt: Date.now(),
  }).catch(() => {
    /* transient network errors — the next beat change retries naturally */
  });
}

export function endRoom(code: string): void {
  updateDoc(doc(db, "rooms", code), {
    ended: true,
    updatedAt: Date.now(),
  }).catch(() => {});
}

// Follow a room. cb(null) = the room doesn't exist (bad/expired code).
export function watchRoom(
  code: string,
  cb: (room: RoomDoc | null) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, "rooms", code),
    (snap) => cb(snap.exists() ? (snap.data() as RoomDoc) : null),
    () => cb(null)
  );
}
