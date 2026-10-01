// Regression tests for the cloud sync layer, covering three incidents:
// - SCR-68 (Jul 25): an emptied, signed-in device could overwrite (wipe) the
//   user's cloud data before the first Firestore snapshot arrived.
// - SCR-83 (Jul 28): gating EVERY push on a server snapshot silently discarded
//   short-session pushes from a data-holding device.
// - SCR-84 (Jul 29): the single-doc payload outgrew Firestore's 1 MiB doc
//   ceiling; every write 400'd silently while the UI said "Synced". The store
//   is now one doc per key — these tests drive that model end to end.

// jest.mock factories are hoisted, so everything they capture must be
// `mock`-prefixed module-scope state.
let mockAuthCb: ((user: unknown) => void) | null = null;
let mockSnapCb: ((snap: unknown) => void) | null = null;
const mockAuth: { currentUser: { uid: string; email: string } | null } = {
  currentUser: null,
};
// Every batch.set() lands here as {path, body}; commit() resolves by default.
let mockBatchWrites: Array<{ path: string; body: any }> = [];
let mockCommitImpl: () => Promise<void> = () => Promise.resolve();
let mockCommitCount = 0;
// getDoc(users/{uid}) — the legacy single-doc read for migration.
let mockLegacyDoc: { payload?: string } | undefined = undefined;
// SCR-120: pushes are compare-and-set transactions. Data-doc sets still land
// in mockBatchWrites (so every assertion above about WHICH DATA KEYS were
// written keeps its meaning); the versions-doc write lands here instead.
// mockVersionsDoc is the server's users/{uid}/sync/_versions body, read by
// tx.get and replaced on each successful commit.
let mockVersionWrites: Array<{ path: string; body: any }> = [];
let mockVersionsDoc: { seq: Record<string, number> } | undefined = undefined;
// Replaces the transaction's read — reject it to model an offline client.
let mockTxGetImpl: (() => Promise<void>) | null = null;

jest.mock("firebase/app", () => ({ initializeApp: () => ({}) }));
jest.mock("firebase/auth", () => ({
  getAuth: () => mockAuth,
  setPersistence: () => Promise.resolve(),
  browserLocalPersistence: {},
  GoogleAuthProvider: function GoogleAuthProvider() {},
  signInWithPopup: () => Promise.resolve(),
  signOut: () => Promise.resolve(),
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    mockAuthCb = cb;
  },
}));
jest.mock("firebase/firestore", () => ({
  getFirestore: () => ({}),
  doc: (_db: unknown, ...path: string[]) => ({ __path: path.join("/") }),
  collection: (_db: unknown, ...path: string[]) => ({
    __path: path.join("/"),
  }),
  onSnapshot: (
    _ref: unknown,
    _opts: unknown,
    cb: (snap: unknown) => void
  ) => {
    mockSnapCb = cb;
    return () => {};
  },
  getDoc: () =>
    Promise.resolve({
      data: () => mockLegacyDoc,
    }),
  writeBatch: () => ({
    set: (ref: { __path: string }, body: unknown) => {
      mockBatchWrites.push({ path: ref.__path, body });
    },
    commit: () => {
      mockCommitCount++;
      return mockCommitImpl();
    },
  }),
  enableIndexedDbPersistence: () => Promise.resolve(),
  runTransaction: (
    _db: unknown,
    fn: (tx: unknown) => Promise<unknown>
  ) => {
    const dataSets: Array<{ path: string; body: any }> = [];
    const versionSets: Array<{ path: string; body: any }> = [];
    const tx = {
      get: (ref: { __path: string }) =>
        (mockTxGetImpl ? mockTxGetImpl() : Promise.resolve()).then(() => ({
          exists: () =>
            /\/_versions$/.test(ref.__path) && mockVersionsDoc !== undefined,
          data: () => mockVersionsDoc,
        })),
      set: (ref: { __path: string }, body: any) => {
        (/\/_versions$/.test(ref.__path) ? versionSets : dataSets).push({
          path: ref.__path,
          body,
        });
        return tx;
      },
    };
    return fn(tx).then((res) => {
      // A transaction that wrote nothing commits nothing.
      if (!dataSets.length && !versionSets.length) return res;
      dataSets.forEach((s) => mockBatchWrites.push(s));
      versionSets.forEach((s) => mockVersionWrites.push(s));
      mockCommitCount++;
      return mockCommitImpl().then(() => {
        if (versionSets.length)
          mockVersionsDoc = versionSets[versionSets.length - 1].body;
        return res;
      });
    });
  },
}));

// ---- helpers ---------------------------------------------------------------

const PUSH_DEBOUNCE_MS = 1200;

const BOOKS_WITH_MARK = JSON.stringify({
  books: { master: { marks: [{ id: "m1" }] } },
});
const BOOKS_EMPTY = JSON.stringify({ books: { master: { marks: [] } } });
const ONE_STUDY = JSON.stringify([{ id: "s1", name: "Faith" }]);

// A per-key collection snapshot as cloudSync sees it. `docs` maps key → value
// (all attributed to another device unless writer says otherwise).
function collSnap(opts: {
  fromCache?: boolean;
  docs?: Record<string, string>;
  writer?: string;
  pending?: boolean;
  // SCR-120: the compare-and-set sequence stamped on each doc (absent = a
  // doc written without one, i.e. pre-SCR-120 or an older build).
  seq?: Record<string, number>;
}) {
  const entries = Object.keys(opts.docs || {}).map((key) => ({
    type: "added",
    doc: {
      id: key,
      metadata: { hasPendingWrites: !!opts.pending },
      data: () => ({
        v: (opts.docs as Record<string, string>)[key],
        writer: opts.writer || "other_device",
        seq: opts.seq ? opts.seq[key] : undefined,
      }),
    },
  }));
  return {
    metadata: { fromCache: !!opts.fromCache },
    empty: entries.length === 0,
    docChanges: () => entries,
  };
}

// Fresh cloudSync module, configured and signed in — the listener is live and
// mockSnapCb captured, but NO snapshot has been delivered yet.
function bootSignedIn(hooks?: {
  mergeRemoteBooks?: (json: string) => void;
  mergeRemoteStudies?: (data: Record<string, string | null>) => void;
  legacy?: { payload?: string };
}) {
  jest.resetModules();
  mockBatchWrites = [];
  mockCommitCount = 0;
  mockCommitImpl = () => Promise.resolve();
  mockVersionWrites = [];
  mockVersionsDoc = undefined;
  mockTxGetImpl = null;
  mockLegacyDoc = hooks && hooks.legacy;
  mockAuthCb = null;
  mockSnapCb = null;
  const cloud = require("./cloudSync");
  cloud.configureSync({
    backupKeys: [
      "scribal_books_v1",
      "scribal_vault_v1",
      "scribal_studies_v1",
      "scribal_search_studies",
      "scribal_notes",
      "scribal_tables_v1",
    ],
    mergeRemoteBooks: (hooks && hooks.mergeRemoteBooks) || jest.fn(),
    vaultMergeRemote: jest.fn(),
    mergeRemoteStudies: (hooks && hooks.mergeRemoteStudies) || jest.fn(),
  });
  cloud.initCloud();
  mockAuth.currentUser = { uid: "u1", email: "kepu@example.com" };
  mockAuthCb!({ uid: "u1", email: "kepu@example.com" });
  return cloud;
}

function writtenKeys(): string[] {
  return mockBatchWrites.map((w) => w.path.split("/").pop() as string);
}

function writtenValue(key: string): string | undefined {
  const hit = mockBatchWrites.filter(
    (w) => w.path === "users/u1/sync/" + key
  );
  return hit.length ? hit[hit.length - 1].body.v : undefined;
}

// Let the microtask queue drain (getDoc/commit promises) under fake timers.
// SCR-120: a push is now a transaction (read → body → commit → bookkeeping,
// inside the one-push-at-a-time wrapper), several more promise hops than the
// old batch.commit — so drain deeper.
async function flush() {
  for (let i = 0; i < 25; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  jest.useRealTimers();
});

// ---- SCR-68: the wipe race --------------------------------------------------

test("THE RACE: an empty device's early push never fires before the first server snapshot, and never overwrites a full cloud store after it", async () => {
  const cloud = bootSignedIn();
  await flush();
  // Freshly-evicted device: localStorage is empty. A local change is noted and
  // the debounce elapses while the network is still slow — no snapshot yet.
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS * 3);
  await flush();
  expect(mockCommitCount).toBe(0); // gate held it
  // The first server snapshot finally lands: the cloud store is FULL.
  mockSnapCb!(
    collSnap({ docs: { scribal_books_v1: BOOKS_WITH_MARK } })
  );
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS * 3);
  await flush();
  // Released, but the emptiness guard must block it.
  expect(mockCommitCount).toBe(0);
});

test("a cache-only empty snapshot never seeds the cloud (second arm of the race)", async () => {
  bootSignedIn();
  await flush();
  // Firestore's offline cache answers first on a fresh profile: nothing there.
  mockSnapCb!(collSnap({ fromCache: true }));
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS * 3);
  await flush();
  expect(mockCommitCount).toBe(0);
});

test("widened guard: a device with no content never overwrites a store holding only studies", async () => {
  const cloud = bootSignedIn();
  await flush();
  mockSnapCb!(
    collSnap({
      docs: {
        scribal_books_v1: BOOKS_EMPTY,
        scribal_studies_v1: ONE_STUDY,
      },
    })
  );
  cloud.noteLocalChange(); // a real local change on the still-empty device
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS * 3);
  await flush();
  expect(mockCommitCount).toBe(0);
});

test("a genuinely new account still seeds the cloud from the device", async () => {
  bootSignedIn();
  await flush();
  localStorage.setItem("scribal_books_v1", BOOKS_WITH_MARK);
  // SERVER-confirmed empty store: there really is nothing in the cloud.
  mockSnapCb!(collSnap({ fromCache: false }));
  jest.advanceTimersByTime(10);
  await flush();
  expect(mockCommitCount).toBe(1);
  expect(writtenValue("scribal_books_v1")).toBe(BOOKS_WITH_MARK);
});

test("repair: a data-holding device pushes its data back over a wiped store", async () => {
  bootSignedIn();
  await flush();
  localStorage.setItem("scribal_books_v1", BOOKS_WITH_MARK);
  localStorage.setItem("scribal_studies_v1", ONE_STUDY);
  // The cloud holds the factory-fresh wipe payload another device wrote.
  mockSnapCb!(collSnap({ docs: { scribal_books_v1: BOOKS_EMPTY } }));
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(mockCommitCount).toBe(1);
  expect(writtenValue("scribal_books_v1")).toBe(BOOKS_WITH_MARK);
  expect(writtenValue("scribal_studies_v1")).toBe(ONE_STUDY);
});

// ---- SCR-83: the silent-discard wedge ---------------------------------------

test("SCR-83: a data-holding device pushes before the first server snapshot (short-session delivery)", async () => {
  const cloud = bootSignedIn();
  await flush();
  localStorage.setItem("scribal_books_v1", BOOKS_WITH_MARK);
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(mockCommitCount).toBe(1);
  expect(writtenValue("scribal_books_v1")).toBe(BOOKS_WITH_MARK);
});

test("SCR-83: an empty device is held before the server snapshot, and released by the first one", async () => {
  const cloud = bootSignedIn({
    // Merge hook behaves like the real shells: applying a remote snapshot
    // lands its books in localStorage.
    mergeRemoteBooks: (json: string) => {
      localStorage.setItem("scribal_books_v1", json);
    },
  });
  await flush();
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS * 3);
  await flush();
  expect(mockCommitCount).toBe(0); // held — device looks empty
  // First server snapshot: the merge lands the cloud's books locally; local
  // now equals cloud for that key, so nothing needs writing — and nothing is.
  mockSnapCb!(
    collSnap({ docs: { scribal_books_v1: BOOKS_WITH_MARK } })
  );
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(mockCommitCount).toBe(0);
  // A real local change after the merge pushes normally.
  localStorage.setItem("scribal_studies_v1", ONE_STUDY);
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(mockCommitCount).toBe(1);
  expect(writtenKeys()).toEqual(["scribal_studies_v1"]);
});

// ---- SCR-84: the per-key store ----------------------------------------------

test("SCR-84: only changed keys are written — an edit does not re-upload the dataset", async () => {
  const cloud = bootSignedIn();
  await flush();
  localStorage.setItem("scribal_books_v1", BOOKS_WITH_MARK);
  localStorage.setItem("scribal_studies_v1", ONE_STUDY);
  // Cloud already holds the identical books value.
  mockSnapCb!(
    collSnap({ docs: { scribal_books_v1: BOOKS_WITH_MARK } })
  );
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  // Only the studies key (cloud lacks it) goes up — books is clean.
  expect(mockCommitCount).toBe(1);
  expect(writtenKeys()).toEqual(["scribal_studies_v1"]);
});

test("SCR-84: an inbound apply produces no echo write when nothing else differs", async () => {
  bootSignedIn({
    mergeRemoteBooks: (json: string) => {
      localStorage.setItem("scribal_books_v1", json);
    },
  });
  await flush();
  mockSnapCb!(
    collSnap({ docs: { scribal_books_v1: BOOKS_WITH_MARK } })
  );
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS * 3);
  await flush();
  expect(mockCommitCount).toBe(0);
});

test("SCR-84: our own write echoing back is never re-applied", async () => {
  const applied: string[] = [];
  bootSignedIn({
    mergeRemoteBooks: (json: string) => {
      applied.push(json);
    },
  });
  await flush();
  const myId = localStorage.getItem("scribal_device_id") as string;
  mockSnapCb!(
    collSnap({
      docs: { scribal_books_v1: BOOKS_WITH_MARK },
      writer: myId,
    })
  );
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS * 3);
  await flush();
  expect(applied).toEqual([]);
});

test("SCR-84: a failed write surfaces in CloudState.lastError instead of being swallowed", async () => {
  const cloud = bootSignedIn();
  await flush();
  const states: any[] = [];
  cloud.onCloudState((s: any) => states.push(s));
  mockCommitImpl = () =>
    Promise.reject(new Error("document too large"));
  localStorage.setItem("scribal_books_v1", BOOKS_WITH_MARK);
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  const last = states[states.length - 1];
  expect(last.lastError).toBe("document too large");
  expect(last.syncing).toBe(false);
});

// ---- SCR-85: value compression ------------------------------------------------

const LZ = require("lz-string");

// A big, repetitive books payload — the shape that hit 97% of the doc ceiling.
const BIG_BOOKS = JSON.stringify({
  books: {
    master: {
      marks: Array.from({ length: 200 }, (_, i) => ({
        id: "mark_" + i,
        style: "underline",
        color: "pen3",
        ref: "1 Nephi 3:" + ((i % 30) + 1),
        start: i,
        end: i + 12,
      })),
    },
  },
});

test("SCR-85: large values are written compressed (z1: base64) and much smaller", async () => {
  const cloud = bootSignedIn();
  await flush();
  localStorage.setItem("scribal_books_v1", BIG_BOOKS);
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(mockCommitCount).toBe(1);
  const stored = writtenValue("scribal_books_v1") as string;
  expect(stored.indexOf("z1:")).toBe(0);
  expect(stored.length).toBeLessThan(BIG_BOOKS.length / 2);
  expect(LZ.decompressFromBase64(stored.slice(3))).toBe(BIG_BOOKS);
});

test("SCR-85: an inbound compressed doc merges as raw JSON and produces no echo write", async () => {
  const applied: string[] = [];
  bootSignedIn({
    mergeRemoteBooks: (json: string) => {
      applied.push(json);
      localStorage.setItem("scribal_books_v1", json);
    },
  });
  await flush();
  mockSnapCb!(
    collSnap({
      docs: { scribal_books_v1: "z1:" + LZ.compressToBase64(BIG_BOOKS) },
    })
  );
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS * 3);
  await flush();
  expect(applied).toEqual([BIG_BOOKS]); // merge saw RAW json
  expect(mockCommitCount).toBe(0); // local == cloud → no echo
});

test("SCR-85: small values stay uncompressed and pre-compression docs read back as-is", async () => {
  const applied: string[] = [];
  const cloud = bootSignedIn({
    mergeRemoteBooks: (json: string) => {
      applied.push(json);
      localStorage.setItem("scribal_books_v1", json);
    },
  });
  await flush();
  // Pre-SCR-85 doc: raw value, no prefix — must merge unchanged.
  mockSnapCb!(collSnap({ docs: { scribal_books_v1: BOOKS_WITH_MARK } }));
  jest.advanceTimersByTime(10);
  await flush();
  expect(applied).toEqual([BOOKS_WITH_MARK]);
  // Small local value pushes raw (no z1: prefix).
  localStorage.setItem("scribal_studies_v1", ONE_STUDY);
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(writtenValue("scribal_studies_v1")).toBe(ONE_STUDY);
});

test("SCR-84: the legacy single-doc payload is merged forward exactly once", async () => {
  const applied: string[] = [];
  const legacyPayload = JSON.stringify({
    app: "scribal",
    version: 2,
    exportedAt: "2026-07-20T00:00:00.000Z",
    data: { scribal_books_v1: BOOKS_WITH_MARK },
  });
  bootSignedIn({
    legacy: { payload: legacyPayload },
    mergeRemoteBooks: (json: string) => {
      applied.push(json);
    },
  });
  await flush();
  expect(applied).toEqual([BOOKS_WITH_MARK]);
  expect(localStorage.getItem("scribal_split_migrated_u1")).toBe("1");
  // A second listen (relaunch) must NOT re-merge the frozen payload.
  mockAuthCb!({ uid: "u1", email: "kepu@example.com" });
  await flush();
  expect(applied).toEqual([BOOKS_WITH_MARK]);
});

// ---- Aug 7 2026: the book store shards per book ------------------------------
// scribal_books_v1 was still ONE doc inside the split store. Past Firestore's
// 1 MiB ceiling its writes 400 — silently sinking ALL note/mark sync while
// every other key kept working, which reads as "sync is broken for just this
// edit". Now each book is its own doc; one big book can never block the rest.

const TWO_BOOKS = JSON.stringify({
  books: {
    master: { marks: [{ id: "m1" }], notes: { k: "<p>master note</p>" } },
    sessionA: { marks: [], notes: { k: "<p>session note</p>" } },
  },
  deletedBooks: { ghost: 123 },
});

test("a push writes one shard per book, a meta doc with the tombstones, and the monolith for old builds", async () => {
  const cloud = bootSignedIn();
  await flush();
  localStorage.setItem("scribal_books_v1", TWO_BOOKS);
  // Server snapshot first (empty store, new account) so the gate is open.
  mockSnapCb!(collSnap({ fromCache: false, docs: {} }));
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS * 2);
  await flush();
  const keys = writtenKeys();
  expect(keys).toContain("scribal_books_v1.b.master");
  expect(keys).toContain("scribal_books_v1.b.sessionA");
  expect(keys).toContain("scribal_books_v1.meta");
  expect(keys).toContain("scribal_books_v1");
  // Each shard is a books-blob the ordinary merge accepts, holding ONLY its book.
  const shard = JSON.parse(writtenValue("scribal_books_v1.b.sessionA")!);
  expect(Object.keys(shard.books)).toEqual(["sessionA"]);
  expect(shard.books.sessionA.notes.k).toBe("<p>session note</p>");
  const meta = JSON.parse(writtenValue("scribal_books_v1.meta")!);
  expect(meta.deletedBooks.ghost).toBe(123);
});

test("editing one book re-uploads THAT shard, not every book", async () => {
  const cloud = bootSignedIn();
  await flush();
  localStorage.setItem("scribal_books_v1", TWO_BOOKS);
  mockSnapCb!(collSnap({ fromCache: false, docs: {} }));
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS * 2);
  await flush();
  mockBatchWrites = [];
  // A note edit in sessionA only.
  const next = JSON.parse(TWO_BOOKS);
  next.books.sessionA.notes.k = "<p>edited</p>";
  localStorage.setItem("scribal_books_v1", JSON.stringify(next));
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS * 2);
  await flush();
  const keys = writtenKeys();
  expect(keys).toContain("scribal_books_v1.b.sessionA");
  expect(keys).not.toContain("scribal_books_v1.b.master");
  expect(keys).not.toContain("scribal_books_v1.meta");
});

test("an inbound shard routes into the SAME books merge as the monolith", async () => {
  const mergeRemoteBooks = jest.fn();
  bootSignedIn({ mergeRemoteBooks });
  await flush();
  mockSnapCb!(
    collSnap({
      fromCache: false,
      docs: {
        "scribal_books_v1.b.sessionA": JSON.stringify({
          books: { sessionA: { notes: { k: "<p>from desktop</p>" } } },
        }),
        "scribal_books_v1.meta": JSON.stringify({
          books: {},
          deletedBooks: { ghost: 123 },
        }),
      },
    })
  );
  await flush();
  const blobs = mergeRemoteBooks.mock.calls.map((c) => c[0]);
  expect(blobs.some((b: string) => b.indexOf("from desktop") >= 0)).toBe(true);
  expect(blobs.some((b: string) => b.indexOf("ghost") >= 0)).toBe(true);
});

test("THE FAILURE ITSELF: an oversized doc is skipped BY NAME, the rest of the batch ships, and the error is loud", async () => {
  const cloud = bootSignedIn();
  await flush();
  const seen: any[] = [];
  cloud.onCloudState((s: any) => seen.push(s));
  // A study payload of incompressible noise well past the ceiling, plus one
  // healthy key. (Math.random is fine here — this is jest, not a workflow.)
  let noise = "";
  while (noise.length < 1_100_000)
    noise += Math.random().toString(36).slice(2);
  localStorage.setItem("scribal_studies_v1", JSON.stringify([{ id: "s1", name: noise }]));
  localStorage.setItem("scribal_search_studies", ONE_STUDY);
  mockSnapCb!(collSnap({ fromCache: false, docs: {} }));
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS * 2);
  await flush();
  const keys = writtenKeys();
  expect(keys).toContain("scribal_search_studies"); // healthy key still shipped
  expect(keys).not.toContain("scribal_studies_v1"); // oversized one held back
  const last = seen[seen.length - 1];
  expect(last.lastError).toContain("scribal_studies_v1");
  expect(last.lastError).toContain("KB");
});

test("an oversized MONOLITH is not an error — the shards are the store of record", async () => {
  const cloud = bootSignedIn();
  await flush();
  const seen: any[] = [];
  cloud.onCloudState((s: any) => seen.push(s));
  // One giant book of incompressible marks pushes the whole blob past the
  // ceiling as a monolith; per-book it still exceeds — so we build TWO books
  // that are individually small but jointly large: monolith skipped, both
  // shards ship, no error.
  let noise = "";
  while (noise.length < 700_000) noise += Math.random().toString(36).slice(2);
  const big = JSON.stringify({
    books: {
      master: { marks: [{ id: "m1", verseText: noise }] },
      sessionA: { marks: [{ id: "m2", verseText: noise }] },
    },
  });
  localStorage.setItem("scribal_books_v1", big);
  mockSnapCb!(collSnap({ fromCache: false, docs: {} }));
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS * 2);
  await flush();
  const keys = writtenKeys();
  expect(keys).toContain("scribal_books_v1.b.master");
  expect(keys).toContain("scribal_books_v1.b.sessionA");
  expect(keys).not.toContain("scribal_books_v1");
  const last = seen[seen.length - 1];
  expect(last.lastError).toBeNull();
});

// ---- SCR-120: compare-and-set --------------------------------------------------
// Sep 30 2026: study done on the work PC vanished on the phone at home and came
// back only when the work PC reopened. The phone took its hours-old offline
// cache for the cloud, pushed before the server snapshot landed, and a blind
// set() replaced the work PC's newer doc; the next snapshot was the phone's own
// write, so the union merge never ran. Pushes are now transactions that write a
// key only while the server's sequence for it is the one this device merged.
// These drive the REAL useMarks reducer as the books merge, so "union" below is
// the app's union, not a stand-in.

const { reducer: marksReducer } = require("./hooks/useMarks");

const SHARD = "scribal_books_v1.b.master";

const bookWith = (ids: string[]) => ({
  id: "master",
  name: "Master Book",
  locked: true,
  marks: ids.map((id) => ({ id, reference: "Genesis 1:1" })),
  colorLabels: {},
  notes: {},
  createdAt: 1000,
  lastStudiedAt: 1000,
});

const shardWith = (ids: string[]) =>
  JSON.stringify({ books: { master: bookWith(ids) } });

// A device whose books live in the real reducer and persist to localStorage
// exactly as useMarks' persist effect writes them.
function booksDevice(ids: string[]) {
  let S: any = {
    books: { master: bookWith(ids) },
    order: ["master"],
    activeId: "master",
    deletedBooks: {},
    past: [],
    future: [],
  };
  const persist = () =>
    localStorage.setItem(
      "scribal_books_v1",
      JSON.stringify({
        books: S.books,
        order: S.order,
        activeId: S.activeId,
        deletedBooks: S.deletedBooks,
      })
    );
  persist();
  return {
    merge: (json: string) => {
      S = marksReducer(S, { type: "mergeRemoteBooks", json });
      persist();
    },
    mark: (id: string) => {
      const b = S.books.master;
      S = {
        ...S,
        books: {
          ...S.books,
          master: { ...b, marks: b.marks.concat([{ id, reference: "Genesis 1:2" }]) },
        },
      };
      persist();
    },
  };
}

const idsOf = (stored: string | undefined) => {
  if (!stored) return [];
  const raw =
    stored.indexOf("z1:") === 0 ? LZ.decompressFromBase64(stored.slice(3)) : stored;
  return JSON.parse(raw).books.master.marks.map((m: any) => m.id).sort();
};

// The server confirming a cached view with nothing new: a metadata-only event.
const serverConfirms = () => ({
  metadata: { fromCache: false },
  empty: false,
  docChanges: () => [],
});

test("SCR-120 THE BUG: a stale cache + an edit before the server snapshot never overwrites the work PC's newer doc", async () => {
  // Phone's last-synced state: m1, its own write at seq 1, still in its cache.
  const phone = booksDevice(["m1"]);
  const cloud = bootSignedIn({ mergeRemoteBooks: phone.merge });
  await flush();
  const me = localStorage.getItem("scribal_device_id") as string;
  // During the day the work PC wrote w1, w2: the server is at seq 2.
  mockVersionsDoc = { seq: { [SHARD]: 2 } };
  mockSnapCb!(
    collSnap({ fromCache: true, docs: { [SHARD]: shardWith(["m1"]) }, writer: me, seq: { [SHARD]: 1 } })
  );
  // Kepu marks a verse at once, while the listener is still reconnecting.
  phone.mark("p1");
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  // Held: the server moved past what this phone merged. Nothing overwritten.
  expect(writtenKeys()).not.toContain(SHARD);
  expect(mockVersionsDoc!.seq[SHARD]).toBe(2);
  // The listener delivers the work PC's doc; the real merge makes the union.
  mockSnapCb!(
    collSnap({ docs: { [SHARD]: shardWith(["m1", "w1", "w2"]) }, writer: "work_pc", seq: { [SHARD]: 2 } })
  );
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  // The union ships on top of the work PC's doc — both days of study survive.
  expect(idsOf(writtenValue(SHARD))).toEqual(["m1", "p1", "w1", "w2"]);
  expect(mockVersionsDoc!.seq[SHARD]).toBe(3);
});

test("SCR-120 trigger B: just OPENING the phone never overwrites the work PC's newer doc", async () => {
  // Phone merged the work PC's morning doc (seq 1) earlier; its cache still
  // holds that doc. The work PC has since written seq 2.
  const phone = booksDevice(["m1", "p0", "w0"]);
  bootSignedIn({ mergeRemoteBooks: phone.merge });
  await flush();
  mockVersionsDoc = { seq: { [SHARD]: 2 } };
  mockSnapCb!(
    collSnap({ fromCache: true, docs: { [SHARD]: shardWith(["m1", "w0"]) }, writer: "work_pc", seq: { [SHARD]: 1 } })
  );
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(writtenKeys()).not.toContain(SHARD);
  mockSnapCb!(
    collSnap({ docs: { [SHARD]: shardWith(["m1", "w0", "w1", "w2"]) }, writer: "work_pc", seq: { [SHARD]: 2 } })
  );
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(idsOf(writtenValue(SHARD))).toEqual(["m1", "p0", "w0", "w1", "w2"]);
});

test("SCR-120 resume: a device whose listener slept cannot overwrite a doc written since", async () => {
  const phone = booksDevice(["m1"]);
  const cloud = bootSignedIn({ mergeRemoteBooks: phone.merge });
  await flush();
  const me = localStorage.getItem("scribal_device_id") as string;
  mockVersionsDoc = { seq: { [SHARD]: 1 } };
  // A live, server-confirmed view earlier in the session...
  mockSnapCb!(collSnap({ docs: { [SHARD]: shardWith(["m1"]) }, writer: me, seq: { [SHARD]: 1 } }));
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  // ...then the app sat in the background while another device wrote seq 2.
  mockVersionsDoc = { seq: { [SHARD]: 2 } };
  phone.mark("p1");
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(writtenKeys()).not.toContain(SHARD);
  expect(mockVersionsDoc!.seq[SHARD]).toBe(2);
});

test("SCR-120 keeps SCR-83: a change from a short session ships on the NEXT session's first server confirmation", async () => {
  const phone = booksDevice(["m1"]);
  let cloud = bootSignedIn({ mergeRemoteBooks: phone.merge });
  await flush();
  const me = localStorage.getItem("scribal_device_id") as string;
  const seen: any[] = [];
  cloud.onCloudState((s: any) => seen.push(s));
  mockVersionsDoc = { seq: { [SHARD]: 1 } };
  mockSnapCb!(collSnap({ docs: { [SHARD]: shardWith(["m1"]) }, writer: me, seq: { [SHARD]: 1 } }));
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  // Session 1: mark, but the phone is offline and iOS suspends it.
  mockTxGetImpl = () =>
    Promise.reject(Object.assign(new Error("client is offline"), { code: "unavailable" }));
  phone.mark("p1");
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(writtenKeys()).not.toContain(SHARD);
  // Offline is not a failed write — nothing alarming on the status line.
  expect(seen[seen.length - 1].lastError).toBeNull();
  // The process dies (timers with it). Session 2 on the same device.
  jest.clearAllTimers();
  cloud = bootSignedIn({ mergeRemoteBooks: phone.merge });
  await flush();
  mockVersionsDoc = { seq: { [SHARD]: 1 } };
  // Cache answers first (own doc — nothing to apply), then the server
  // confirms that view with no changes. That confirmation ships p1.
  mockSnapCb!(
    collSnap({ fromCache: true, docs: { [SHARD]: shardWith(["m1"]) }, writer: me, seq: { [SHARD]: 1 } })
  );
  mockSnapCb!(serverConfirms());
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(idsOf(writtenValue(SHARD))).toEqual(["m1", "p1"]);
  expect(mockVersionsDoc!.seq[SHARD]).toBe(2);
});

test("SCR-120 covers every key, not just books: a stale study list is held against a newer server copy", async () => {
  const cloud = bootSignedIn();
  await flush();
  localStorage.setItem("scribal_books_v1", BOOKS_WITH_MARK);
  const me = localStorage.getItem("scribal_device_id") as string;
  mockVersionsDoc = { seq: { scribal_studies_v1: 2, scribal_books_v1: 1 } };
  mockSnapCb!(
    collSnap({
      fromCache: true,
      docs: { scribal_studies_v1: ONE_STUDY, scribal_books_v1: BOOKS_WITH_MARK },
      writer: me,
      seq: { scribal_studies_v1: 1, scribal_books_v1: 1 },
    })
  );
  localStorage.setItem(
    "scribal_studies_v1",
    JSON.stringify([{ id: "s1", name: "Faith" }, { id: "s2", name: "Hope" }])
  );
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(writtenKeys()).not.toContain("scribal_studies_v1");
  // Once the newer server copy has been merged, the push goes through.
  mockSnapCb!(
    collSnap({ docs: { scribal_studies_v1: ONE_STUDY }, writer: "work_pc", seq: { scribal_studies_v1: 2 } })
  );
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(writtenKeys()).toContain("scribal_studies_v1");
  expect(mockVersionsDoc!.seq.scribal_studies_v1).toBe(3);
});

test("SCR-120 loop breaker: the same content in different bytes from another device is never written back", async () => {
  const phone = booksDevice(["a1", "a2"]);
  bootSignedIn({ mergeRemoteBooks: phone.merge });
  await flush();
  // New account: this device seeds the cloud (seq 1 for each key).
  mockSnapCb!(collSnap({ fromCache: false, docs: {} }));
  jest.advanceTimersByTime(10);
  await flush();
  expect(mockVersionsDoc!.seq[SHARD]).toBe(1);
  const commitsAfterSeed = mockCommitCount;
  // Another device merged ours and wrote the SAME marks in its own order.
  // The server's versions doc moves with each of its writes, so the
  // compare-and-set check WOULD allow a write-back — only the loop breaker
  // stands in the way.
  for (let round = 0; round < 3; round++) {
    mockVersionsDoc = { seq: { ...mockVersionsDoc!.seq, [SHARD]: 2 + round } };
    mockSnapCb!(
      collSnap({ docs: { [SHARD]: shardWith(["a2", "a1"]) }, writer: "other", seq: { [SHARD]: 2 + round } })
    );
    jest.advanceTimersByTime(PUSH_DEBOUNCE_MS * 3);
    await flush();
  }
  // Before SCR-120 every one of these rounds wrote the shard back.
  expect(mockCommitCount).toBe(commitsAfterSeed);
});

test("SCR-120 loop breaker: a merge that ADDS content is pushed once, and its echo is not", async () => {
  const phone = booksDevice(["a1"]);
  bootSignedIn({ mergeRemoteBooks: phone.merge });
  await flush();
  mockSnapCb!(collSnap({ fromCache: false, docs: {} }));
  jest.advanceTimersByTime(10);
  await flush();
  const base = mockCommitCount;
  // The other device adds b1 on top of our a1.
  mockVersionsDoc = { seq: { ...mockVersionsDoc!.seq, [SHARD]: 2 } };
  mockSnapCb!(
    collSnap({ docs: { [SHARD]: shardWith(["b1", "a1"]) }, writer: "other", seq: { [SHARD]: 2 } })
  );
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(mockCommitCount).toBe(base + 1); // our union, in our order
  expect(idsOf(writtenValue(SHARD))).toEqual(["a1", "b1"]);
  // It answers with the same union in its order: silence from here on.
  mockVersionsDoc = { seq: { ...mockVersionsDoc!.seq, [SHARD]: 4 } };
  mockSnapCb!(
    collSnap({ docs: { [SHARD]: shardWith(["b1", "a1"]) }, writer: "other", seq: { [SHARD]: 4 } })
  );
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS * 3);
  await flush();
  expect(mockCommitCount).toBe(base + 1);
});

test("SCR-120 offline: a failed transaction is retried on its own once the connection is back", async () => {
  const phone = booksDevice(["m1"]);
  const cloud = bootSignedIn({ mergeRemoteBooks: phone.merge });
  await flush();
  const me = localStorage.getItem("scribal_device_id") as string;
  mockVersionsDoc = { seq: { [SHARD]: 1 } };
  mockSnapCb!(collSnap({ docs: { [SHARD]: shardWith(["m1"]) }, writer: me, seq: { [SHARD]: 1 } }));
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  mockTxGetImpl = () =>
    Promise.reject(Object.assign(new Error("client is offline"), { code: "unavailable" }));
  phone.mark("p1");
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(writtenKeys()).not.toContain(SHARD);
  mockTxGetImpl = null; // back online
  jest.advanceTimersByTime(5000 + 10); // first backoff step
  await flush();
  expect(idsOf(writtenValue(SHARD))).toEqual(["m1", "p1"]);
});

test("SCR-120 a doc of unknown age (no seq) from the cache waits for the server's confirmation", async () => {
  const phone = booksDevice(["m1", "p1"]);
  bootSignedIn({ mergeRemoteBooks: phone.merge });
  await flush();
  // Pre-SCR-120 doc in the cache; the versions doc does not exist yet.
  mockSnapCb!(
    collSnap({ fromCache: true, docs: { [SHARD]: shardWith(["m1"]) }, writer: "work_pc" })
  );
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(writtenKeys()).not.toContain(SHARD);
  // The monolith is held WITH its shard: written alone, the clean-monolith
  // short-circuit would hide the held shard from every later dirty check.
  expect(writtenKeys()).not.toContain("scribal_books_v1");
  mockSnapCb!(serverConfirms());
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(idsOf(writtenValue(SHARD))).toEqual(["m1", "p1"]);
  expect(writtenKeys()).toContain("scribal_books_v1");
  expect(mockVersionsDoc!.seq[SHARD]).toBe(1);
});

test("SCR-120 the versions doc carries no `v` (older builds skip it) and is never routed to a merge", async () => {
  const mergeRemoteBooks = jest.fn();
  const mergeRemoteStudies = jest.fn();
  const cloud = bootSignedIn({ mergeRemoteBooks, mergeRemoteStudies });
  await flush();
  localStorage.setItem("scribal_books_v1", BOOKS_WITH_MARK);
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  const body = mockVersionWrites[mockVersionWrites.length - 1].body;
  expect(body.v).toBeUndefined();
  expect(typeof body.seq.scribal_books_v1).toBe("number");
  // The same doc arriving through the listener changes nothing.
  mockSnapCb!({
    metadata: { fromCache: false },
    empty: false,
    docChanges: () => [
      {
        type: "added",
        doc: { id: "_versions", metadata: { hasPendingWrites: false }, data: () => body },
      },
    ],
  });
  await flush();
  expect(mergeRemoteBooks).not.toHaveBeenCalled();
  expect(mergeRemoteStudies).not.toHaveBeenCalled();
});

test("SCR-120 casAllows maps every branch", () => {
  const { casAllows } = require("./cloudSync");
  // Merged a compare-and-set doc.
  expect(casAllows(3, 3, false)).toBe(true); // nobody wrote since
  expect(casAllows(3, 4, true)).toBe(false); // somebody did
  expect(casAllows(3, undefined, true)).toBe(true); // versions doc was reset
  expect(casAllows(3, undefined, false)).toBe(false);
  // Merged a doc of unknown age.
  expect(casAllows("legacy", undefined, true)).toBe(true);
  expect(casAllows("legacy", 5, true)).toBe(true);
  expect(casAllows("legacy", undefined, false)).toBe(false);
  expect(casAllows("legacy", 5, false)).toBe(false);
  // Never seen the key.
  expect(casAllows(undefined, undefined, false)).toBe(true);
  expect(casAllows(undefined, 1, true)).toBe(false);
});

test("SCR-120 a transaction stuck behind a proxy does not block sync: the next push goes through after the stall window", async () => {
  const cloud = bootSignedIn();
  await flush();
  localStorage.setItem("scribal_books_v1", BOOKS_WITH_MARK);
  mockSnapCb!(collSnap({ fromCache: false, docs: {} }));
  // The first transaction's read never answers.
  mockTxGetImpl = () => new Promise<void>(() => {});
  jest.advanceTimersByTime(10);
  await flush();
  expect(mockCommitCount).toBe(0);
  mockTxGetImpl = null;
  localStorage.setItem("scribal_studies_v1", ONE_STUDY);
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(mockCommitCount).toBe(0); // still inside the stall window — deferred
  // No further edits: the deferral's own retry gets past the stuck push.
  for (let i = 0; i < 8; i++) {
    jest.advanceTimersByTime(10000);
    await flush();
  }
  expect(writtenKeys()).toContain("scribal_studies_v1");
});

test("SCR-120 a transaction that loses to concurrent writes is retried, not reported as a failure", async () => {
  for (const code of ["aborted", "failed-precondition", "deadline-exceeded"]) {
    const cloud = bootSignedIn();
    await flush();
    const seen: any[] = [];
    cloud.onCloudState((s: any) => seen.push(s));
    localStorage.clear();
    localStorage.setItem("scribal_books_v1", BOOKS_WITH_MARK);
    mockTxGetImpl = () => Promise.reject(Object.assign(new Error(code), { code }));
    cloud.noteLocalChange();
    jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
    await flush();
    expect(seen[seen.length - 1].lastError).toBeNull();
    mockTxGetImpl = null;
    jest.advanceTimersByTime(5000 + 10);
    await flush();
    expect(writtenKeys()).toContain("scribal_books_v1");
    jest.clearAllTimers();
  }
});

test("SCR-120 only a real write clears an error — a pass that held every key leaves it showing", async () => {
  const phone = booksDevice(["m1"]);
  const cloud = bootSignedIn({ mergeRemoteBooks: phone.merge });
  await flush();
  const seen: any[] = [];
  cloud.onCloudState((s: any) => seen.push(s));
  const me = localStorage.getItem("scribal_device_id") as string;
  mockVersionsDoc = { seq: { [SHARD]: 1, scribal_books_v1: 1, "scribal_books_v1.meta": 1 } };
  mockSnapCb!(
    collSnap({
      docs: { [SHARD]: shardWith(["m1"]) },
      writer: me,
      seq: { [SHARD]: 1 },
    })
  );
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  // A genuine rejected write puts an error on the status line.
  mockCommitImpl = () => Promise.reject(new Error("PERMISSION_DENIED"));
  phone.mark("p1");
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(seen[seen.length - 1].lastError).toBe("PERMISSION_DENIED");
  // Next pass: another device has moved every book key, so all are held.
  mockCommitImpl = () => Promise.resolve();
  mockVersionsDoc = { seq: { [SHARD]: 2, scribal_books_v1: 2, "scribal_books_v1.meta": 2 } };
  phone.mark("p2");
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(seen[seen.length - 1].lastError).toBe("PERMISSION_DENIED");
  // The newer doc arrives, the union is written — THAT clears it.
  mockSnapCb!(
    collSnap({
      docs: { [SHARD]: shardWith(["m1", "w1"]) },
      writer: "work_pc",
      seq: { [SHARD]: 2 },
    })
  );
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(idsOf(writtenValue(SHARD))).toEqual(["m1", "p1", "p2", "w1"]);
  expect(seen[seen.length - 1].lastError).toBeNull();
});

// ---- SCR-121: the book store is compressed at rest, and a failed save is never uploaded
// Oct 1 2026: the phone's localStorage filled; every save of the book store
// failed silently for ten days, and the push — which uploads what it READS
// from storage — sent the ten-day-old copy over the cloud. Compare-and-set
// (above) allowed it: the phone HAD merged the latest version, in memory.

test("SCR-121 a compressed book store is uploaded as raw JSON — the cloud never sees the at-rest form", async () => {
  const cloud = bootSignedIn();
  await flush();
  const store = require("./booksStore");
  localStorage.setItem("scribal_books_v1", store.encodeBooks(TWO_BOOKS));
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(writtenValue("scribal_books_v1")).toBe(TWO_BOOKS);
  const shard = JSON.parse(writtenValue("scribal_books_v1.b.sessionA") as string);
  expect(shard.books.sessionA.notes.k).toBe("<p>session note</p>");
  writtenKeys().forEach((k) =>
    expect(String(writtenValue(k)).indexOf("zf1:")).not.toBe(0)
  );
});

test("SCR-121 THE FAILURE ITSELF: while the book store is not saving, no book key is uploaded, other keys still are, and the status line says so", async () => {
  const cloud = bootSignedIn();
  await flush();
  const store = require("./booksStore");
  const seen: any[] = [];
  cloud.onCloudState((s: any) => seen.push(s));
  // What storage holds: the older copy.
  store.writeBooksJson(BOOKS_WITH_MARK);
  // Storage fills; the next save of the book store fails.
  const realSet = Storage.prototype.setItem;
  const spy = jest
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === "scribal_books_v1") throw new DOMException("quota", "QuotaExceededError");
      return realSet.call(this, k, v);
    });
  expect(store.writeBooksJson(TWO_BOOKS)).toBe(false);
  localStorage.setItem("scribal_studies_v1", ONE_STUDY);
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  const keys = writtenKeys();
  expect(keys).toContain("scribal_studies_v1"); // everything else still syncs
  expect(keys.filter((k) => k.indexOf("scribal_books_v1") === 0)).toEqual([]);
  expect(seen[seen.length - 1].lastError).toBe(store.STORAGE_FULL_MESSAGE);
  spy.mockRestore();
});

test("SCR-121 when saving works again, the book store uploads and the warning clears", async () => {
  const cloud = bootSignedIn();
  await flush();
  const store = require("./booksStore");
  const seen: any[] = [];
  cloud.onCloudState((s: any) => seen.push(s));
  const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError");
  });
  store.writeBooksJson(TWO_BOOKS);
  spy.mockRestore();
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(seen[seen.length - 1].lastError).toBe(store.STORAGE_FULL_MESSAGE);
  expect(store.writeBooksJson(TWO_BOOKS)).toBe(true);
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  await flush();
  expect(writtenKeys()).toContain("scribal_books_v1.b.master");
  expect(writtenValue("scribal_books_v1")).toBe(TWO_BOOKS);
  expect(seen[seen.length - 1].lastError).toBeNull();
});
