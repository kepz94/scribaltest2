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
  query,
  collection,
  where,
  getDocs,
  deleteDoc,
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
  // { [reference]: {word,n,text}[] } — the definitions the presenter chose,
  // already resolved. Followers have no dictionary, and the room is meant to be
  // self-contained, so the words travel rather than a key. Optional: a room
  // written before this existed simply has none.
  glossesJson?: string;
  i: number; // the presenter's current beat
  revealed: number[]; // beat indexes whose veil the presenter lifted
  ended: boolean;
  updatedAt: number;
  createdAt: number;
  // The presenter. Security rules only let this uid update or end the room —
  // everyone else can only read (watch).
  ownerUid: string;
}

// The lookup key a card's themes are stored under (mirrored by the viewer).
export const themesKey = (refs: string[], bookId?: string) =>
  refs.join(",") + "|" + (bookId || "");

// Private "note to self" cards must never leave the presenter's device: their
// text is blanked before the table is serialized into the room document (the
// doc is readable by anyone with the code). The cards themselves stay, so the
// follower's beat indexes line up with the presenter's — followers render a
// neutral placeholder for them.
export function redactTableForRoom<
  T extends { cards: any[]; shelf?: any[] }
>(table: T): T {
  const blank = (c: any) => (c.kind === "note" ? { ...c, text: "" } : c);
  return {
    ...table,
    cards: table.cards.map(blank),
    ...(table.shelf ? { shelf: table.shelf.map(blank) } : {}),
  };
}

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
  payload: Omit<
    RoomDoc,
    "i" | "revealed" | "ended" | "updatedAt" | "ownerUid" | "createdAt"
  >
): Promise<void> {
  const uid = getAuth(app).currentUser?.uid;
  if (!uid) throw new Error("not-signed-in");
  // Sweep this presenter's stale rooms before making a new one (best-effort,
  // never blocks the new room).
  void cleanupMyRooms();
  await setDoc(doc(db, "rooms", code), {
    ...payload,
    ownerUid: uid,
    i: 0,
    revealed: [],
    ended: false,
    updatedAt: Date.now(),
    createdAt: Date.now(),
  });
}

// Beat updates are coalesced per room, latest-wins: an idle tap writes
// immediately, but while a write is in flight further taps only update the
// pending state, and ONE follow-up write lands the newest position. Firestore
// soft-limits sustained writes to ~1/sec per document, so pushing every tap of
// a fast next-next-next burst is what made rooms lag and appear to drop beats.
const pending = new Map<string, { i: number; revealed: number[] }>();
const inFlight = new Set<string>();

async function flushBeat(code: string): Promise<void> {
  const p = pending.get(code);
  if (!p || inFlight.has(code)) return;
  pending.delete(code);
  inFlight.add(code);
  try {
    await updateDoc(doc(db, "rooms", code), {
      i: p.i,
      revealed: p.revealed,
      updatedAt: Date.now(),
    });
  } catch {
    /* transient network errors — the next beat change retries naturally */
  }
  inFlight.delete(code);
  // Something newer arrived while we were writing — send it too.
  if (pending.has(code)) flushBeat(code);
}

export function pushBeat(code: string, i: number, revealed: number[]): void {
  pending.set(code, { i, revealed });
  flushBeat(code);
}

export function endRoom(code: string): void {
  updateDoc(doc(db, "rooms", code), {
    ended: true,
    updatedAt: Date.now(),
  }).catch(() => {});
}

// Follow a room. cb(null) = the room doesn't exist (bad/expired code).
// A room lives one day. Followers treat older rooms as expired; presenters
// sweep their own old rooms away every time they start a new one (no server
// job needed — the owner is the only account the rules let delete them).
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
export function roomExpired(doc: RoomDoc): boolean {
  const born = doc.createdAt || doc.updatedAt || 0;
  return Date.now() - born > ROOM_TTL_MS;
}

// Best-effort cleanup of the signed-in user's stale rooms. Fire-and-forget:
// failures are logged (never silent) but don't block presenting.
export async function cleanupMyRooms(): Promise<void> {
  const uid = getAuth(app).currentUser?.uid;
  if (!uid) return;
  try {
    const q = query(collection(db, "rooms"), where("ownerUid", "==", uid));
    const snap = await getDocs(q);
    const now = Date.now();
    await Promise.all(
      snap.docs
        .filter((d) => {
          const v = d.data() as RoomDoc;
          const born = v.createdAt || v.updatedAt || 0;
          return v.ended || now - born > ROOM_TTL_MS;
        })
        .map((d) => deleteDoc(d.ref))
    );
  } catch (err) {
    console.warn("room cleanup failed", err);
  }
}

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
