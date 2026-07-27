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
  contentCountsFromBackup,
  contentCountsFromLocal,
  totalContent,
} from "./sync";
import type { ContentCounts } from "./sync";

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
// Live-merges the non-book/vault study keys (recorded + keyword studies and the
// chapter-link groups). Supplied by the shell so a study/link made on one device
// shows up on the other. Without this, the listener only merged books + vault
// and studies/links silently never synced for signed-in users.
type MergeOther = (data: Record<string, string | null>) => void;

export interface CloudState {
  ready: boolean; // auth state has resolved at least once
  signedIn: boolean;
  email: string | null;
  syncing: boolean; // a write is in flight
  lastSync: number | null;
  // Whether the browser granted persistent storage (navigator.storage.persist).
  // false = the browser may EVICT local data under storage pressure — the
  // condition that armed the SCR-68 wipe race. null = unknown / unsupported.
  persisted: boolean | null;
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
let mergeOther: MergeOther = () => {};
let onApplied: (() => void) | null = null;
// What the cloud doc held in the last payload snapshot we saw — any writer,
// our own past write included. null until a payload has been seen. Arms the
// emptiness guards in doPush.
let remoteCounts: ContentCounts | null = null;
// True once THIS listen has received a server-confirmed snapshot (i.e. not
// the offline cache). doPush is gated on it: before the server has told us
// what the cloud actually holds, an empty device could overwrite a full doc
// it has simply never seen — the SCR-68 data-loss race.
let serverSnapSeen = false;
// A push that arrived while the gate was closed; released on the first server
// snapshot so no local change is lost.
let pushHeld = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let suppressEcho = false;
// The `data` portion of the last payload this device successfully wrote (or
// saw echoed back from its own past write). buildBackupString stamps a fresh
// exportedAt into every payload, so comparing whole payloads always says
// "changed" — this holds just the data, letting doPush skip writes when
// nothing real changed. That guard is what stops the idle write loop:
// push → syncing state emit → re-render → effect → push → … (SCR-10).
let lastPushedData: string | null = null;

// Extract the comparable `data` object from a backup payload string.
function dataPortion(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload).data ?? null);
  } catch {
    return payload;
  }
}

const state: CloudState = {
  ready: false,
  signedIn: false,
  email: null,
  syncing: false,
  persisted: null,
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

// Ask the browser to protect this origin's storage from eviction. Without it
// Chrome (around updates/cleanup) and Safari (~7 days unvisited) may silently
// clear localStorage/IndexedDB — the emptied-device state that arms the
// SCR-68 wipe race. Denial is surfaced in the sync/status UI via CloudState.
function requestPersistentStorage() {
  try {
    const storage: StorageManager | undefined =
      typeof navigator !== "undefined" ? navigator.storage : undefined;
    if (!storage || typeof storage.persist !== "function") return; // unsupported — stays null
    Promise.resolve(
      typeof storage.persisted === "function" ? storage.persisted() : false
    )
      .then((already) => (already ? true : storage.persist()))
      .then((granted) => {
        state.persisted = !!granted;
        emit();
      })
      .catch(() => {});
  } catch {}
}

// Call once on app start (both shells). Attaches the auth listener; when a user
// is signed in it begins the live two-way sync and stops it on sign-out.
export function initCloud() {
  requestPersistentStorage();
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
  mergeRemoteStudies?: MergeOther;
  onApplied?: () => void;
}) {
  backupKeys = opts.backupKeys.slice();
  mergeBooks = opts.mergeRemoteBooks;
  mergeVault = opts.vaultMergeRemote;
  mergeOther = opts.mergeRemoteStudies || (() => {});
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
  // Fresh listen, fresh gate: nothing may be pushed for this user until the
  // server has shown us their cloud doc at least once (SCR-68).
  serverSnapSeen = false;
  remoteCounts = null;
  pushHeld = false;
  const ref = doc(db, "users", uid);
  unsub = onSnapshot(
    ref,
    (snap) => {
      // Skip our own write — both the optimistic local echo and the
      // server-confirmed one (tagged with this device id) — so two devices
      // never ping-pong writes back and forth.
      if (snap.metadata.hasPendingWrites) return;
      const fromServer = !snap.metadata.fromCache;
      const data = snap.data() as
        | { payload?: string; writer?: string }
        | undefined;
      if (!data || !data.payload) {
        // Doc missing. Only a SERVER-confirmed miss means "no cloud copy yet"
        // — a cache miss on a freshly-emptied device says nothing about the
        // cloud, and seeding from it was one arm of the SCR-68 wipe.
        if (fromServer) {
          serverSnapSeen = true;
          remoteCounts = null; // genuinely nothing in the cloud to protect
          pushHeld = false; // the seed push below covers any held change
          schedulePush(true);
        }
        return;
      }
      // Any payload snapshot — our own past write included — teaches us what
      // the cloud holds, so the emptiness guards are armed before the first
      // push can possibly fire.
      remoteCounts = contentCountsFromBackup(data.payload);
      if (fromServer) serverSnapSeen = true;
      if (data.writer === deviceId) {
        // Our own past write echoing back (e.g. from the offline cache on a
        // fresh page load). Seed the dirty-check baseline from it so boot
        // doesn't immediately re-write identical data to the cloud.
        if (lastPushedData === null) lastPushedData = dataPortion(data.payload);
        releaseHeldPush();
        return;
      }
      const payload = data.payload;
      // Repair check (SCR-68): if the cloud doc lacks a whole category of
      // content this device still holds — e.g. it was overwritten by the
      // pre-fix race — the union we're about to merge must be pushed back up,
      // not swallowed as an echo. That is how a data-holding device repairs a
      // wiped cloud doc on its next sign-in.
      const local = contentCountsFromLocal();
      const repairNeeded =
        (remoteCounts.marks === 0 && local.marks > 0) ||
        (remoteCounts.vault === 0 && local.vault > 0) ||
        (remoteCounts.studies === 0 && local.studies > 0) ||
        (remoteCounts.search === 0 && local.search > 0) ||
        (remoteCounts.tables === 0 && local.tables > 0) ||
        (remoteCounts.notes === 0 && local.notes > 0);
      const hadHeld = pushHeld;
      pushHeld = false;
      // Merge the other device's snapshot into live state, and suppress the one
      // local-change push this merge will trigger (otherwise it echoes back) —
      // unless a repair or a held local change means that push must go out.
      suppressEcho = !repairNeeded && !hadHeld;
      applyRemoteLive(payload, mergeBooks, mergeVault, mergeOther);
      if (repairNeeded || hadHeld) schedulePush(false);
      state.lastSync = Date.now();
      emit();
      if (onApplied) onApplied();
    },
    () => {
      /* listener error — Firestore retries on its own */
    }
  );
}

// Release a push that was held behind the server-snapshot gate.
function releaseHeldPush() {
  if (!pushHeld) return;
  pushHeld = false;
  schedulePush(false);
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
  // SCR-68 gate: never write before a server-confirmed snapshot has shown us
  // what the cloud actually holds. Before that, "the cloud looks empty" is a
  // guess — and acting on it is exactly how an emptied device wiped a full
  // doc. The held push is released by the first server snapshot.
  if (!serverSnapSeen) {
    pushHeld = true;
    return;
  }
  const local = contentCountsFromLocal();
  if (remoteCounts) {
    // Emptiness guards: (a) the original marks rule — never overwrite a cloud
    // copy that has marks with a payload that has none; (b) widened for
    // SCR-68 — a payload with NO content of any kind (no marks, studies,
    // keyword studies, tables, notes, or vault entries) never overwrites a
    // cloud doc that still holds any of them.
    if (local.marks === 0 && remoteCounts.marks > 0) return;
    if (totalContent(local) === 0 && totalContent(remoteCounts) > 0) return;
  }
  const payload = buildBackupString(backupKeys);
  // Dirty check: only the data matters, not the exportedAt stamp. Skipping
  // clean pushes (before the syncing emit) is what keeps the header indicator
  // steady and the write count bounded.
  const dataNow = dataPortion(payload);
  if (dataNow === lastPushedData) return;
  state.syncing = true;
  emit();
  try {
    await setDoc(doc(db, "users", user.uid), {
      payload,
      updatedAt: Date.now(),
      writer: deviceId,
    });
    lastPushedData = dataNow;
    // The cloud now holds this payload — keep the emptiness guards tracking
    // reality even before our own write echoes back through the listener.
    remoteCounts = contentCountsFromBackup(payload);
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
