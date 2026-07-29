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
}) {
  const entries = Object.keys(opts.docs || {}).map((key) => ({
    type: "added",
    doc: {
      id: key,
      metadata: { hasPendingWrites: !!opts.pending },
      data: () => ({
        v: (opts.docs as Record<string, string>)[key],
        writer: opts.writer || "other_device",
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
  legacy?: { payload?: string };
}) {
  jest.resetModules();
  mockBatchWrites = [];
  mockCommitCount = 0;
  mockCommitImpl = () => Promise.resolve();
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
    mergeRemoteStudies: jest.fn(),
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
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
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
