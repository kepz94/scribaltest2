// shareRoom.ts
// The wire for "Send a copy". Everything that decides WHAT travels and what a
// received table becomes lives in shareTable.ts, which is pure and tested; this
// file only carries a payload to Firestore and back.
//
// Sent tables ride rooms/{code} with kind:"copy" alongside live present rooms.
// The collection's existing rules — anyone with the code may read, only a
// signed-in owner may write — are already exactly what sharing needs, so this
// feature adds no Firestore rules. The cost of sharing the collection is that
// presentRoom's sweep must know not to destroy copies; see `sweepable` there.

import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import { RoomDoc, cleanupMyRooms, newRoomCode } from "./presentRoom";
import {
  MAX_SHARE_BYTES,
  SHARE_VERSION,
  ShareDoc,
  ShareFailure,
  SharePayload,
  shareBytes,
  shareExpired,
} from "./shareTable";

// Same project as cloudSync / presentRoom; guarded so whichever loads first wins.
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

// Publish a payload; returns the six characters the recipient types.
export async function createShare(payload: SharePayload): Promise<string> {
  const uid = getAuth(app).currentUser?.uid;
  if (!uid) throw new ShareFailure("not-signed-in");
  // Refuse a little under Firestore's 1 MiB document cap. Marks carry their
  // verse text because the renderer reads it, so a table spanning many
  // chapters is the realistic way to get here. Failing at share time with a
  // sentence beats failing opaquely when the recipient tries to open it.
  if (shareBytes(payload) > MAX_SHARE_BYTES) throw new ShareFailure("too-big");
  // Best-effort sweep of this account's expired rooms and copies; never blocks.
  void cleanupMyRooms();
  const code = newRoomCode();
  const body: ShareDoc = {
    ...payload,
    kind: "copy",
    createdAt: Date.now(),
    ownerUid: uid,
  };
  try {
    await setDoc(doc(db, "rooms", code), body);
  } catch {
    throw new ShareFailure("offline");
  }
  return code;
}

// Fetch a payload by code. Throws ShareFailure with a reason the UI turns into
// one plain sentence (shareErrorText).
export async function readShare(code: string): Promise<ShareDoc> {
  let snap;
  try {
    snap = await getDoc(doc(db, "rooms", (code || "").trim().toUpperCase()));
  } catch {
    throw new ShareFailure("offline");
  }
  if (!snap.exists()) throw new ShareFailure("not-found");
  const data = snap.data() as RoomDoc & Partial<ShareDoc>;
  // A present-room code is not a table to keep. Same collection, so answer
  // not-found rather than half-importing somebody's presentation.
  if (data.kind !== "copy") throw new ShareFailure("not-found");
  const share = data as ShareDoc;
  // Written by a newer Scribal than this one: refuse whole rather than import
  // a table with pieces missing.
  if ((share.v || 0) > SHARE_VERSION) throw new ShareFailure("needs-update");
  if (shareExpired(share, Date.now())) throw new ShareFailure("expired");
  return share;
}
