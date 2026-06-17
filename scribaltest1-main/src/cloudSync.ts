// cloudSync.ts
// Firestore-backed cloud sync for Scribal — the seamless replacement for the
// Google Drive layer. Firebase Authentication keeps the user signed in across
// sessions and devices (it refreshes the login token silently, so there are no
// reconnect prompts), and Firestore's real-time listeners + offline cache sync
// changes between devices on their own. We reuse the proven merge logic from
// sync.ts: a remote snapshot is merged into live state with applyRemoteLive
// (union marks/vault by id, fill-blank notes/themes), and a local change is
// serialized with buildBackupString and written to the user's own document.

import { initializeApp } from "firebase/app";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  onSnapshot,
  setDoc,
  enableIndexedDbPersistence,
} from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import {
  CORE_KEYS,
  buildBackupString,
  applyRemoteLive,
  countBookMarksFromJson,
  booksFromBackup,
} from "./sync";

const firebaseConfig = {
  apiKey: "AIzaSyDz_Xhisj5POlSc0VFTDQ936Dm3p_j4stM",
  authDomain: "scribal-f8710.firebaseapp.com",
  projectId: "scribal-f8710",
  storageBucket: "scribal-f8710.firebasestorage.app",
  messagingSenderId: "575140590101",
  appId: "1:575140590101:web:5bf91929a54b9c2378941c",
  measurementId: "G-C5ZBWXQJ28",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Stay signed in across visits + devices. This is what removes the constant
// reconnect prompts — the SDK refreshes the login token silently in the
// background instead of expiring every hour the way the raw Drive token did.
setPersistence(auth, browserLocalPersistence).catch(() => {});
const db = getFirestore(app);
// Offline cache: the app keeps working with no connection and the SDK syncs
// queued changes once it's back online. Throws harmlessly if more than one tab
// is open (only one tab holds the lock); we ignore that.
try {
  enableIndexedDbPersistence(db).catch(() => {});
} catch {}

type MergeBooks = (json: string) => void;
type MergeVault = (json: string | null | undefined) => void;

export interface CloudState {
  ready: boolean; // auth state has resolved at least once
  signedIn: boolean;
  email: string | null;
  syncing: boolean; // a write is in flight
  lastSync: number | null;
}

// A stable id for this device/browser so a device never re-applies its OWN
// writes — that would risk an endless echo between two synced devices.
function getDeviceId(): string {
  try {
    let id = localStorage.getItem("scribal_device_id");
    if (!id) {
      id =
        Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
      localStorage.setItem("scribal_device_id", id);
    }
    return id;
  } catch {
    return "dev_" + Math.random().toString(36).slice(2, 9);
  }
}
const deviceId = getDeviceId();

let unsub: Unsubscribe | null = null;
let stateCb: ((s: CloudState) => void) | null = null;
let backupKeys: string[] = CORE_KEYS.slice();
let mergeBooks: MergeBooks = () => {};
let mergeVault: MergeVault = () => {};
let onApplied: (() => void) | null = null;
let lastRemoteMarks = -1;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let suppressEcho = false;

const state: CloudState = {
  ready: false,
  signedIn: false,
  email: null,
  syncing: false,
  lastSync:
    Date.parse(
      (typeof localStorage !== "undefined" &&
        localStorage.getItem("scribal_sync_seen")) ||
        ""
    ) || null,
};

function emit() {
  if (stateCb) stateCb({ ...state });
}

// Call once on app start (both shells). Attaches the auth listener; when a user
// is signed in it begins the live two-way sync and stops it on sign-out.
export function initCloud() {
  onAuthStateChanged(auth, (user) => {
    state.ready = true;
    state.signedIn = !!user;
    state.email = user ? user.email : null;
    if (user) startListening(user.uid);
    else stopListening();
    emit();
  });
}

// Subscribe to sync state for the UI (signed-in, email, syncing, lastSync).
export function onCloudState(cb: (s: CloudState) => void) {
  stateCb = cb;
  emit();
}

// Supply the shell's merge hooks + the exact keys to back up (each shell adds
// its own device-local keys to CORE_KEYS). Call before sign-in.
export function configureSync(opts: {
  backupKeys: string[];
  mergeRemoteBooks: MergeBooks;
  vaultMergeRemote: MergeVault;
  onApplied?: () => void;
}) {
  backupKeys = opts.backupKeys.slice();
  mergeBooks = opts.mergeRemoteBooks;
  mergeVault = opts.vaultMergeRemote;
  onApplied = opts.onApplied || null;
}

export async function signIn(): Promise<void> {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}

export async function signOutCloud(): Promise<void> {
  await signOut(auth);
}

export function isSignedIn(): boolean {
  return !!auth.currentUser;
}

function startListening(uid: string) {
  stopListening();
  const ref = doc(db, "users", uid);
  unsub = onSnapshot(
    ref,
    (snap) => {
      // Skip our own write — both the optimistic local echo and the
      // server-confirmed one (tagged with this device id) — so two devices
      // never ping-pong writes back and forth.
      if (snap.metadata.hasPendingWrites) return;
      const data = snap.data() as
        | { payload?: string; writer?: string }
        | undefined;
      if (!data || !data.payload) {
        // No cloud copy yet — seed it from what's on this device.
        schedulePush(true);
        return;
      }
      if (data.writer === deviceId) return;
      const payload = data.payload;
      try {
        lastRemoteMarks = countBookMarksFromJson(booksFromBackup(payload));
      } catch {
        lastRemoteMarks = -1;
      }
      // Merge the other device's snapshot into live state, and suppress the one
      // local-change push this merge will trigger (otherwise it echoes back).
      suppressEcho = true;
      applyRemoteLive(payload, mergeBooks, mergeVault);
      state.lastSync = Date.now();
      emit();
      if (onApplied) onApplied();
    },
    () => {
      /* listener error — Firestore retries on its own */
    }
  );
}

function stopListening() {
  if (unsub) {
    unsub();
    unsub = null;
  }
}

// Call whenever local data changes (the shell watches its data state). Debounced.
export function noteLocalChange() {
  schedulePush(false);
}

function schedulePush(immediate: boolean) {
  if (!state.signedIn) return;
  if (suppressEcho && !immediate) {
    suppressEcho = false;
    return;
  }
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(doPush, immediate ? 0 : 1200);
}

async function doPush() {
  const user = auth.currentUser;
  if (!user) return;
  let localMarks = 0;
  try {
    localMarks = countBookMarksFromJson(
      localStorage.getItem("scribal_books_v1")
    );
  } catch {
    localMarks = 0;
  }
  // Emptiness guard: never overwrite a cloud copy that has marks with an empty
  // one (mirrors the Drive safeguard so a blank device can't wipe the cloud).
  if (localMarks === 0 && lastRemoteMarks > 0) return;
  const payload = buildBackupString(backupKeys);
  state.syncing = true;
  emit();
  try {
    await setDoc(doc(db, "users", user.uid), {
      payload,
      updatedAt: Date.now(),
      writer: deviceId,
    });
    try {
      const p = JSON.parse(payload);
      if (p.exportedAt) localStorage.setItem("scribal_sync_seen", p.exportedAt);
    } catch {}
    state.lastSync = Date.now();
  } catch {
    /* offline or transient — Firestore retries queued writes automatically */
  } finally {
    state.syncing = false;
    emit();
  }
}
