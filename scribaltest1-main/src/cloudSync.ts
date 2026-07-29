// cloudSync.ts
// Firestore-backed cloud sync for Scribal — the seamless replacement for the
// Google Drive layer. Firebase Authentication keeps the user signed in across
// sessions and devices (it refreshes the login token silently, so there are no
// reconnect prompts), and Firestore's real-time listeners + offline cache sync
// changes between devices on their own. We reuse the proven merge logic from
// sync.ts: a remote value is merged into live state (union marks/vault by id,
// fill-blank notes/themes), and local changes are written to the user's own
// documents.
//
// STORAGE MODEL (SCR-84). The original design serialized EVERY backup key into
// one JSON string stored in a single doc (users/{uid}.payload). Firestore
// rejects any document over 1,048,487 bytes, and on Jul 24 2026 the payload
// quietly outgrew that ceiling — every write 400'd, the bare catch swallowed
// it, and the sync UI kept saying "Synced" while devices diverged. The store
// is now one document PER BACKUP KEY under users/{uid}/sync/{key}, each doc
// { v, updatedAt, writer }. Pushes write only the keys whose value actually
// changed, so a mark edit no longer re-uploads the whole dataset, and each
// doc stays far below the ceiling. The legacy users/{uid} doc is read once
// per device (to migrate its content forward) and never written again.

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
  collection,
  onSnapshot,
  getDoc,
  writeBatch,
  enableIndexedDbPersistence,
} from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import {
  CORE_KEYS,
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
  // The last push failure, or null when pushes are healthy. The single-doc era
  // swallowed write rejections in a bare catch — devices diverged for DAYS
  // while every surface said "Synced". Never hide a failed write again.
  lastError: string | null;
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
// The cloud's confirmed per-key values as this session knows them — from
// received snapshots AND our own successful writes. This is both the merge
// baseline and the per-key dirty check: doPush only writes keys whose local
// value differs from what the cloud already holds, which (a) keeps writes
// small, (b) makes echo pushes no-ops naturally, and (c) subsumes the SCR-68
// repair path — after merging a lacking cloud doc, the local union differs
// from the cloud value, so the union is pushed back up.
let cloudVals: Record<string, string> = {};
// True once THIS listen has received a server-confirmed snapshot (i.e. not
// the offline cache). doPush's empty-device gate is armed on it: before the
// server has told us what the cloud actually holds, an empty device could
// overwrite a full doc it has simply never seen — the SCR-68 data-loss race.
let serverSnapSeen = false;
// A push that arrived while the gate was closed; released on the first server
// snapshot so no local change is lost.
let pushHeld = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

const state: CloudState = {
  ready: false,
  signedIn: false,
  email: null,
  syncing: false,
  lastError: null,
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

// Route one received key/value into the right merge hook. Books and vault have
// dedicated hooks; everything else accumulates into one record for mergeOther
// (matching what applyRemoteLive fed it in the single-doc era).
function routeValue(
  key: string,
  v: string,
  otherAcc: Record<string, string | null>
) {
  if (key === "scribal_books_v1") mergeBooks(v);
  else if (key === "scribal_vault_v1") mergeVault(v);
  else otherAcc[key] = v;
}

// One-time forward migration: read the legacy single-doc payload and merge its
// content into live state, exactly as an inbound snapshot would have. The doc
// is never written again; a flag stops the (frozen) payload from re-merging on
// every launch — after tombstones GC, a perpetual re-merge would resurrect
// long-deleted marks.
function migrateLegacyDoc(uid: string) {
  const flagKey = "scribal_split_migrated_" + uid;
  try {
    if (localStorage.getItem(flagKey)) return;
  } catch {}
  getDoc(doc(db, "users", uid))
    .then((snap) => {
      try {
        const data = snap.data() as { payload?: string } | undefined;
        if (data && data.payload) {
          applyRemoteLive(data.payload, mergeBooks, mergeVault, mergeOther);
          state.lastSync = Date.now();
          emit();
          if (onApplied) onApplied();
        }
        try {
          localStorage.setItem(flagKey, "1");
        } catch {}
        // Whatever the legacy merge added to local state is data the split
        // store may not hold yet — let the per-key dirty check decide.
        schedulePush(false);
      } catch {}
    })
    .catch(() => {
      /* offline — retry on the next launch (flag not set) */
    });
}

function startListening(uid: string) {
  stopListening();
  // Fresh listen, fresh gate: an empty-looking device may push nothing for
  // this user until the server has shown us their cloud data at least once
  // (SCR-68, narrowed by SCR-83 to empty devices only).
  serverSnapSeen = false;
  cloudVals = {};
  pushHeld = false;
  migrateLegacyDoc(uid);
  const ref = collection(db, "users", uid, "sync");
  unsub = onSnapshot(
    ref,
    { includeMetadataChanges: false },
    (snap: any) => {
      const fromServer = !snap.metadata.fromCache;
      if (fromServer) serverSnapSeen = true;
      const otherAcc: Record<string, string | null> = {};
      let applied = false;
      const changes =
        typeof snap.docChanges === "function" ? snap.docChanges() : [];
      changes.forEach((change: any) => {
        if (change.type === "removed") return;
        const d = change.doc;
        // Skip the optimistic local echo of our own in-flight write; the
        // server-confirmed copy still lands below and updates cloudVals.
        if (d.metadata && d.metadata.hasPendingWrites) return;
        const body = d.data() as { v?: string; writer?: string } | undefined;
        if (!body || typeof body.v !== "string") return;
        const key = d.id;
        // Any confirmed doc — our own past write included — teaches us what
        // the cloud holds, arming the emptiness guards and the dirty check.
        cloudVals[key] = body.v;
        if (body.writer === deviceId) return; // our own write echoing back
        routeValue(key, body.v, otherAcc);
        applied = true;
      });
      if (applied) {
        if (Object.keys(otherAcc).length) mergeOther(otherAcc);
        state.lastSync = Date.now();
        emit();
        if (onApplied) onApplied();
        // The merge may have produced a union richer than what the cloud
        // holds (a device coming back after divergence). The per-key dirty
        // check pushes exactly those keys back up — the repair path.
        schedulePush(false);
      } else if (fromServer && pushHeld) {
        // Gate open (server has spoken) and a push was held — release it.
        pushHeld = false;
        schedulePush(false);
      } else if (
        fromServer &&
        snap.empty &&
        Object.keys(cloudVals).length === 0
      ) {
        // Server-confirmed empty store: a genuinely new account (or one doc
        // short of migration). Seed it from this device — the emptiness
        // guards in doPush still apply.
        pushHeld = false;
        schedulePush(true);
      }
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
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(doPush, immediate ? 0 : 1200);
}

// Census of what the cloud holds, from the per-key values we know.
function cloudCounts(): ContentCounts {
  return contentCountsFromBackup(JSON.stringify({ data: cloudVals }));
}

async function doPush() {
  const user = auth.currentUser;
  if (!user) return;
  const local = contentCountsFromLocal();
  // SCR-68 gate, narrowed for SCR-83: only a device that LOOKS EMPTY waits
  // for a server-confirmed snapshot — the wipe incident was an empty device
  // overwriting a full store it had never seen, and only that side needs the
  // gate. A data-holding device writes immediately, so its change reaches
  // Firestore's persisted offline queue and survives short sessions.
  if (!serverSnapSeen && totalContent(local) === 0) {
    pushHeld = true;
    return;
  }
  const remote = cloudCounts();
  // Emptiness guards: (a) the original marks rule — never overwrite a cloud
  // copy that has marks with a payload that has none; (b) widened for SCR-68
  // — a device with NO content of any kind never overwrites a cloud store
  // that still holds any.
  if (local.marks === 0 && remote.marks > 0) return;
  if (totalContent(local) === 0 && totalContent(remote) > 0) return;
  // Per-key dirty check: write ONLY keys whose local value differs from what
  // the cloud already holds. This is what keeps pushes small (a mark edit
  // uploads one book-store key, not the whole dataset) and what stops echo
  // loops — after applying a remote change, local equals cloud and nothing
  // is written (SCR-10's concern, solved structurally).
  const changed: Array<{ key: string; v: string }> = [];
  backupKeys.forEach((key) => {
    let v: string | null = null;
    try {
      v = localStorage.getItem(key);
    } catch {}
    if (v === null) return; // never sync deletions of whole keys
    if (cloudVals[key] !== v) changed.push({ key, v });
  });
  if (!changed.length) return;
  state.syncing = true;
  emit();
  try {
    const batch = writeBatch(db);
    const now = Date.now();
    changed.forEach((c) => {
      batch.set(doc(db, "users", user.uid, "sync", c.key), {
        v: c.v,
        updatedAt: now,
        writer: deviceId,
      });
    });
    await batch.commit();
    // The cloud now holds these values — keep the dirty check and emptiness
    // guards tracking reality even before our writes echo back.
    changed.forEach((c) => {
      cloudVals[c.key] = c.v;
    });
    try {
      localStorage.setItem("scribal_sync_seen", new Date().toISOString());
    } catch {}
    state.lastSync = now;
    state.lastError = null;
  } catch (e: any) {
    // A rejected write is a fact the user must be able to see — the
    // single-doc era swallowed these and the sync UI lied for days.
    state.lastError = (e && (e.message || e.code)) || "write failed";
    try {
      // eslint-disable-next-line no-console
      console.error("Scribal cloud push failed:", e);
    } catch {}
  } finally {
    state.syncing = false;
    emit();
  }
}
