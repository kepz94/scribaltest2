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
//
// COMPARE-AND-SET (SCR-120). A set() is a blind overwrite, and the dirty check
// above decides WHAT to write from `cloudVals` — which the offline cache feeds
// too. On Sep 30 2026 a phone opened at home, took its hours-old cache for the
// cloud, pushed inside the 1.2 s debounce before the server snapshot landed,
// and replaced the work PC's day of study with its own copy; the next snapshot
// was its own write, so the union merge never ran, and the work only came back
// when the work PC reopened and re-pushed. Every write now goes through a
// transaction against one small doc, users/{uid}/sync/_versions, holding a
// sequence number per key. A key is written only if the server's number is
// still the one this device last merged; otherwise the write is held, the
// listener delivers the newer doc, the ordinary merge makes the union, and the
// union is pushed. The versions doc has no `v` field, so older builds' listeners
// skip it (they drop any doc without a string `v`). Costs one tiny read and one
// extra write per push — chosen over reading the data docs, which would
// download a whole book shard before every push (free-tier transfer budget).

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
  runTransaction,
  enableIndexedDbPersistence,
} from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import LZString from "lz-string";
import {
  CORE_KEYS,
  applyRemoteLive,
  contentCountsFromBackup,
  contentCountsFromLocal,
  totalContent,
} from "./sync";
import type { ContentCounts } from "./sync";
import {
  booksSaveFailed,
  readStoredValue,
  STORAGE_FULL_MESSAGE,
} from "./booksStore";

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

// ---- compare-and-set state (SCR-120) ----------------------------------------
// The doc holding one sequence number per key. Not a backup key (those all
// start "scribal_"), never routed to a merge, and carries no `v` field.
export const VERSIONS_KEY = "_versions";
// Per key, the sequence of the data doc this device last merged or wrote.
// A number is a compare-and-set doc; LEGACY is a doc written without one (a
// pre-SCR-120 write, or an older build) — its place in history is unknown, so
// it is trusted only once the server has confirmed this listen's view.
// Absent = this device has never seen the key at all.
const LEGACY = "legacy";
let seenSeq: Record<string, number | typeof LEGACY> = {};
// Per key, the exact value this device last wrote successfully. On a
// compare-and-set chain every later doc was written by a device that had
// merged ours, so while local still equals this, the cloud already holds
// everything we have — re-pushing different bytes of the same content was the
// write ping-pong between two open devices (mark order differs per device).
let lastWritten: Record<string, string> = {};
// One push in flight at a time: overlapping transactions would only contend
// on the versions doc and hold each other back. A push stuck longer than
// PUSH_STALL_MS (a proxy holding a request open) stops blocking the next one —
// compare-and-set keeps two concurrent pushes correct, the guard only saves
// work — and the generation stops the stale one's finish from touching flags.
const PUSH_STALL_MS = 30000;
let pushing = false;
let pushAgain = false;
let pushStartedAt = 0;
let pushGen = 0;
// Held keys (the server moved) and offline failures retry on a backoff; the
// listener delivering the newer doc usually gets there first.
const RETRY_MIN_MS = 5000;
const RETRY_MAX_MS = 60000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = RETRY_MIN_MS;

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    schedulePush(true);
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
}

function resetRetry() {
  retryDelay = RETRY_MIN_MS;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

// May this device write `key`, given the server's current sequence for it?
// Pure over its inputs; exported for tests.
export function casAllows(
  seen: number | typeof LEGACY | undefined,
  current: number | undefined,
  serverConfirmed: boolean
): boolean {
  // We merged a compare-and-set doc: write only if nobody has written since.
  // (A missing entry means the versions doc itself was reset — e.g. deleted
  // in the console — so fall back to the confirmed-view rule rather than
  // holding this key forever.)
  if (typeof seen === "number")
    return current === seen || (current === undefined && serverConfirmed);
  // We merged a doc of unknown age: only once the server has spoken this
  // listen, so the listener has delivered whatever is newest.
  if (seen === LEGACY) return serverConfirmed;
  // Never seen the key: fine while nobody has ever versioned it; if somebody
  // has, wait for the listener to deliver that doc first.
  return current === undefined;
}

// Offline / transport failures are not failed writes — the change is safe in
// localStorage and ships on retry. Everything else is surfaced (Jul 24).
// "aborted" and "failed-precondition" are how Firestore reports a transaction
// that lost to concurrent writes on every one of its 5 attempts (the SDK's own
// TransactionRunner retries exactly these); "unavailable" is offline.
function isTransient(e: any): boolean {
  const code = e && e.code;
  return (
    code === "unavailable" ||
    code === "deadline-exceeded" ||
    code === "aborted" ||
    code === "failed-precondition"
  );
}

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

// ---- value compression (SCR-85) --------------------------------------------
// Firestore's ~1 MiB doc ceiling applies PER KEY in the split store, and the
// books key (all marks) reached 97% of it within Scribal's first month. Values
// are LZ-compressed to base64 before writing (JSON this repetitive shrinks
// 4-8x; base64 keeps Firestore's UTF-8 byte accounting honest) and transparently
// decompressed on receipt. The prefix marks compressed values — raw JSON can
// never start with it, and docs written before compression read back as-is.
const COMPRESS_PREFIX = "z1:";
// Values below this size aren't worth the prefix + CPU.
const COMPRESS_MIN = 512;

function packValue(raw: string): string {
  if (raw.length < COMPRESS_MIN) return raw;
  try {
    const z = LZString.compressToBase64(raw);
    // Guard against pathological input where compression doesn't help.
    if (z && z.length + COMPRESS_PREFIX.length < raw.length)
      return COMPRESS_PREFIX + z;
  } catch {}
  return raw;
}

function unpackValue(stored: string): string | null {
  if (stored.indexOf(COMPRESS_PREFIX) !== 0) return stored;
  try {
    const raw = LZString.decompressFromBase64(
      stored.slice(COMPRESS_PREFIX.length)
    );
    return typeof raw === "string" && raw.length ? raw : null;
  } catch {
    return null; // corrupt blob — never merge garbage
  }
}

// ═══ per-book sharding of the book store (Aug 7 2026) ═══
// scribal_books_v1 — every book, every mark, every note — was still ONE
// Firestore document inside the split store. Firestore rejects any doc over
// 1,048,487 bytes, and this app has already lived the failure once (Jul 24:
// writes 400'd for days while the UI said "Synced" and devices quietly
// diverged). One growing book was again a single point of failure for ALL
// note/mark sync — a desktop edit that never left the machine while studies
// and tables kept syncing looks exactly like "sync is broken for just this".
// Now each book is its own doc, so the ceiling applies per book and one big
// book can never block the others. Each shard's value is itself a books-blob
// ({books:{id:...}}), so the receiving side feeds it straight into the same
// stamped mergeRemoteBooks — no second merge path to drift. The monolithic
// key is still written when it fits, so a device on an older build keeps
// receiving; when it no longer fits, the shards are the store of record.
export const BOOKS_KEY = "scribal_books_v1";
export const BOOK_SHARD_PREFIX = BOOKS_KEY + ".b.";
export const BOOKS_META_KEY = BOOKS_KEY + ".meta";
// Firestore's hard ceiling is 1,048,487 bytes for the whole doc; leave head-
// room for the field names, timestamp and writer id.
export const DOC_VALUE_CEILING = 1_000_000;

// Split a local books blob into per-book shard values plus a meta doc carrying
// the deletion tombstones (order/activeId are per-device and never synced as
// authority — the merge derives order and keeps its own activeId). Pure, and
// exported for tests. Returns null on an unparseable blob.
export function shardBooksValue(
  raw: string
): Array<{ key: string; v: string }> | null {
  try {
    const s = JSON.parse(raw);
    if (!s || typeof s !== "object" || !s.books || typeof s.books !== "object")
      return null;
    const out: Array<{ key: string; v: string }> = [];
    Object.keys(s.books).forEach((id) => {
      out.push({
        key: BOOK_SHARD_PREFIX + id,
        v: JSON.stringify({ books: { [id]: s.books[id] } }),
      });
    });
    out.push({
      key: BOOKS_META_KEY,
      v: JSON.stringify({
        books: {},
        deletedBooks:
          s.deletedBooks && typeof s.deletedBooks === "object"
            ? s.deletedBooks
            : {},
      }),
    });
    return out;
  } catch {
    return null;
  }
}

// Route one received key/value into the right merge hook. Books and vault have
// dedicated hooks; everything else accumulates into one record for mergeOther
// (matching what applyRemoteLive fed it in the single-doc era). A book shard
// or the meta doc is already a books-blob, so it takes the same door as the
// monolith — deletions in the meta doc and books in the shards both land in
// the one stamped merge.
function routeValue(
  key: string,
  v: string,
  otherAcc: Record<string, string | null>
) {
  if (
    key === BOOKS_KEY ||
    key === BOOKS_META_KEY ||
    key.indexOf(BOOK_SHARD_PREFIX) === 0
  )
    mergeBooks(v);
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
  seenSeq = {};
  lastWritten = {};
  resetRetry();
  migrateLegacyDoc(uid);
  const ref = collection(db, "users", uid, "sync");
  unsub = onSnapshot(
    ref,
    // Metadata changes ON (SCR-120): when the server confirms a cached view
    // with nothing new, the only event is fromCache flipping to false — a
    // metadata-only change, dropped without this. That flip is what tells a
    // device its view is current. docChanges() below still excludes
    // metadata-only changes, so the doc loop sees exactly what it did before.
    { includeMetadataChanges: true },
    (snap: any) => {
      const fromServer = !snap.metadata.fromCache;
      const firstServer = fromServer && !serverSnapSeen;
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
        // The versions doc is bookkeeping for the transaction, never data.
        if (d.id === VERSIONS_KEY) return;
        const body = d.data() as
          | { v?: string; writer?: string; seq?: number }
          | undefined;
        if (!body || typeof body.v !== "string") return;
        const raw = unpackValue(body.v);
        if (raw === null) return; // undecodable blob — ignore, never merge
        const key = d.id;
        // Any confirmed doc — our own past write included — teaches us what
        // the cloud holds, arming the emptiness guards and the dirty check.
        // cloudVals always holds RAW values; compression is a wire format.
        cloudVals[key] = raw;
        seenSeq[key] = typeof body.seq === "number" ? body.seq : LEGACY;
        if (body.writer === deviceId) return; // our own write echoing back
        routeValue(key, raw, otherAcc);
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
      } else if (firstServer) {
        // The server has confirmed this listen's view. A change from an
        // earlier short session (iOS suspended the app before its push got
        // through — SCR-83's case) lives in localStorage; the dirty check
        // finds it and ships it now, safely, against the confirmed view.
        schedulePush(false);
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

// One push at a time; a push asked for mid-flight runs once afterwards.
async function doPush() {
  if (pushing && Date.now() - pushStartedAt < PUSH_STALL_MS) {
    pushAgain = true;
    // If the push in flight is stuck and never finishes, this retry is what
    // gets past it once the stall window closes (cleared on the next success).
    scheduleRetry();
    return;
  }
  const gen = ++pushGen;
  pushing = true;
  pushStartedAt = Date.now();
  try {
    await pushOnce();
  } finally {
    if (gen === pushGen) {
      pushing = false;
      if (pushAgain) {
        pushAgain = false;
        schedulePush(false);
      }
    }
  }
}

async function pushOnce() {
  const user = auth.currentUser;
  if (!user) return;
  // SCR-121: while the last save of the book store failed (storage full),
  // what is stored is older than what this device shows — so no book key is
  // uploaded at all (a stale upload over the cloud was the Oct 1 data loss),
  // and the status line says so. Every other key still syncs. This keeps the
  // invariant the own-writer skip relies on: a device's uploads are always
  // in its own storage.
  const booksHeld = booksSaveFailed();
  if (booksHeld) {
    if (state.lastError !== STORAGE_FULL_MESSAGE) {
      state.lastError = STORAGE_FULL_MESSAGE;
      emit();
    }
  } else if (state.lastError === STORAGE_FULL_MESSAGE) {
    state.lastError = null;
    emit();
  }
  const local = contentCountsFromLocal();
  // SCR-68 gate, narrowed for SCR-83: only a device that LOOKS EMPTY waits
  // for a server-confirmed snapshot — the wipe incident was an empty device
  // overwriting a full store it had never seen, and only that side needs the
  // gate. A data-holding device writes immediately, so its change reaches
  // Firestore's persisted offline queue and survives short sessions.
  // (SCR-120: writes are compare-and-set transactions now, which do not queue
  // offline. A short session's change waits in localStorage instead and ships
  // on the next session's first server snapshot — see the listener.)
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
    // readStoredValue: the book store is compressed at rest (SCR-121); the
    // cloud carries its raw JSON, exactly as before.
    if (key === BOOKS_KEY && booksHeld) return;
    const v: string | null = readStoredValue(key);
    if (v === null) return; // never sync deletions of whole keys
    if (key === BOOKS_KEY) {
      // The book store syncs as per-book shards + a tombstone meta doc, each
      // dirty-checked on its own, so editing a note in one book uploads that
      // one book. The monolith is also kept up to date for devices on older
      // builds — but only while it fits; past the ceiling it is skipped and
      // the shards alone carry the store (that unwritable monolith IS the
      // failure this sharding exists to end).
      //
      // A CLEAN monolith short-circuits everything: the cloud already holds
      // exactly this blob, so there is nothing to shard — merely RECEIVING a
      // monolith from an old-build device must not trigger a shard backfill,
      // or every inbound apply would echo a write (the SCR-84 invariant).
      if (cloudVals[key] === v) return;
      const shards = shardBooksValue(v);
      if (shards)
        shards.forEach((s) => {
          if (cloudVals[s.key] !== s.v) changed.push(s);
        });
      if (!shards || v.length <= DOC_VALUE_CEILING) changed.push({ key, v });
      return;
    }
    if (cloudVals[key] !== v) changed.push({ key, v });
  });
  // Loop breaker (SCR-120): a key whose local value is exactly what this
  // device last wrote, while the cloud's doc is a compare-and-set doc, has
  // nothing to add — that doc was written by a device that merged ours. Only
  // the bytes differ (per-device mark order, device-local fields), and pushing
  // them made two open devices rewrite each other forever.
  const fresh = changed.filter(
    (c) => !(lastWritten[c.key] === c.v && typeof seenSeq[c.key] === "number")
  );
  // Any doc whose packed value would breach Firestore's ceiling is reported by
  // NAME and size, and the rest of the batch still ships — one oversized value
  // must never silently sink every other key's sync, and it must never be
  // silent (Jul 24's lesson, now enforced before the wire instead of diagnosed
  // after it).
  const oversized: string[] = [];
  const writable = fresh.filter((c) => {
    const packedLen = packValue(c.v).length;
    if (packedLen <= DOC_VALUE_CEILING) return true;
    if (c.key !== BOOKS_KEY)
      oversized.push(c.key + " (" + Math.round(packedLen / 1024) + " KB)");
    return false;
  });
  if (oversized.length)
    state.lastError = "too large to sync: " + oversized.join(", ");
  // Storage full outranks it: that one means this device is losing changes.
  if (booksHeld) state.lastError = STORAGE_FULL_MESSAGE;
  if (!writable.length) {
    // Nothing left to send means nothing is held: stand the retry down.
    resetRetry();
    if (oversized.length) emit();
    return;
  }
  state.syncing = true;
  emit();
  try {
    const now = Date.now();
    // Compressed once, outside the transaction body (which may re-run).
    const packed: Record<string, string> = {};
    writable.forEach((c) => {
      packed[c.key] = packValue(c.v);
    });
    const serverConfirmed = serverSnapSeen;
    const versionsRef = doc(db, "users", user.uid, "sync", VERSIONS_KEY);
    // Compare-and-set (SCR-120): read the server's sequence per key, write
    // only the keys it still agrees this device has merged, and bump their
    // sequence in the same atomic commit. The body is pure over its reads —
    // Firestore re-runs it if the versions doc moves underneath it.
    const result = await runTransaction(db, async (tx) => {
      const vsnap: any = await tx.get(versionsRef);
      const vdata = vsnap && vsnap.exists() ? vsnap.data() : null;
      const cur: Record<string, number> =
        vdata && vdata.seq && typeof vdata.seq === "object" ? vdata.seq : {};
      const next: Record<string, number> = { ...cur };
      const ok: Array<{ key: string; v: string; seq: number }> = [];
      const held: string[] = [];
      const allowed = writable.filter((c) => {
        const current =
          typeof cur[c.key] === "number" ? cur[c.key] : undefined;
        if (casAllows(seenSeq[c.key], current, serverConfirmed)) return true;
        held.push(c.key);
        return false;
      });
      // The clean-monolith short-circuit above reads "monolith written ⇒ its
      // shards written" — true while a push was all-or-nothing. With per-key
      // holds, a written monolith beside a held shard would hide that shard
      // from every later dirty check. So a held shard (or meta) holds the
      // monolith with it.
      const bookHeld = held.some(
        (k) => k === BOOKS_META_KEY || k.indexOf(BOOK_SHARD_PREFIX) === 0
      );
      allowed.forEach((c) => {
        if (bookHeld && c.key === BOOKS_KEY) {
          held.push(c.key);
          return;
        }
        const current =
          typeof cur[c.key] === "number" ? cur[c.key] : undefined;
        const seq = (current || 0) + 1;
        next[c.key] = seq;
        ok.push({ key: c.key, v: c.v, seq });
      });
      if (ok.length) {
        ok.forEach((c) => {
          tx.set(doc(db, "users", user.uid, "sync", c.key), {
            v: packed[c.key],
            updatedAt: now,
            writer: deviceId,
            seq: c.seq,
          });
        });
        // No `v` field: older builds' listeners skip this doc outright.
        tx.set(versionsRef, { seq: next, updatedAt: now, writer: deviceId });
      }
      return { ok, held };
    });
    // The cloud now holds these values — keep the dirty check and emptiness
    // guards tracking reality even before our writes echo back.
    result.ok.forEach((c) => {
      cloudVals[c.key] = c.v;
      seenSeq[c.key] = c.seq;
      lastWritten[c.key] = c.v;
    });
    if (result.ok.length) {
      try {
        localStorage.setItem("scribal_sync_seen", new Date().toISOString());
      } catch {}
      state.lastSync = now;
      // An oversized-key report from this same pass survives the batch
      // success — the other keys shipping is not the oversized one syncing.
      // Only a real write clears an error; a pass that held everything
      // wrote nothing and proves nothing. Nor does a write of other keys
      // clear storage-full while the book store still is not saving.
      if (!oversized.length && !booksHeld) state.lastError = null;
    }
    // Held keys are not errors: another device wrote since this one last
    // merged. The listener brings that doc, the merge makes the union, and
    // the union is pushed; the retry is the safety net if it is slow.
    if (result.held.length) {
      pushHeld = true;
      scheduleRetry();
    } else resetRetry();
  } catch (e: any) {
    if (isTransient(e)) {
      // Offline or the connection dropped: nothing was written and nothing
      // is lost (the change is in localStorage). Try again shortly.
      pushHeld = true;
      scheduleRetry();
    } else {
      // A rejected write is a fact the user must be able to see — the
      // single-doc era swallowed these and the sync UI lied for days.
      state.lastError = (e && (e.message || e.code)) || "write failed";
      try {
        // eslint-disable-next-line no-console
        console.error("Scribal cloud push failed:", e);
      } catch {}
    }
  } finally {
    state.syncing = false;
    emit();
  }
}
