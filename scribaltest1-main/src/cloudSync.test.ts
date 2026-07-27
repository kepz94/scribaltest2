// Regression tests for the SCR-68 data-loss incident: an emptied, signed-in
// device could overwrite (wipe) the user's cloud doc before the first
// Firestore snapshot arrived. These tests drive cloudSync.ts against mocked
// Firebase modules and re-create the exact race.

// jest.mock factories are hoisted, so everything they capture must be
// `mock`-prefixed module-scope state.
let mockAuthCb: ((user: unknown) => void) | null = null;
let mockSnapCb: ((snap: unknown) => void) | null = null;
const mockAuth: { currentUser: { uid: string; email: string } | null } = {
  currentUser: null,
};
const mockSetDoc = jest.fn(() => Promise.resolve());

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
  doc: () => ({}),
  onSnapshot: (_ref: unknown, cb: (snap: unknown) => void) => {
    mockSnapCb = cb;
    return () => {};
  },
  setDoc: (...args: unknown[]) => mockSetDoc(...(args as [])),
  enableIndexedDbPersistence: () => Promise.resolve(),
}));

// ---- helpers ---------------------------------------------------------------

const PUSH_DEBOUNCE_MS = 1200;

// A cloud payload string in the real backup shape.
function payloadOf(data: Record<string, string>): string {
  return JSON.stringify({
    app: "scribal",
    version: 2,
    exportedAt: "2026-07-25T00:00:00.000Z",
    data,
  });
}

const BOOKS_WITH_MARK = JSON.stringify({
  books: { master: { marks: [{ id: "m1" }] } },
});
const BOOKS_EMPTY = JSON.stringify({ books: { master: { marks: [] } } });
const ONE_STUDY = JSON.stringify([{ id: "s1", name: "Faith" }]);

// A Firestore snapshot as cloudSync sees it.
function snap(opts: {
  fromCache?: boolean;
  pending?: boolean;
  payload?: string;
  writer?: string;
}) {
  return {
    metadata: {
      hasPendingWrites: !!opts.pending,
      fromCache: !!opts.fromCache,
    },
    data: () =>
      opts.payload === undefined
        ? undefined
        : { payload: opts.payload, writer: opts.writer || "other_device" },
  };
}

// Fresh cloudSync module, configured and signed in — the listener is live and
// mockSnapCb captured, but NO snapshot has been delivered yet.
function bootSignedIn() {
  jest.resetModules();
  mockSetDoc.mockClear();
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
    mergeRemoteBooks: jest.fn(),
    vaultMergeRemote: jest.fn(),
    mergeRemoteStudies: jest.fn(),
  });
  cloud.initCloud();
  mockAuth.currentUser = { uid: "u1", email: "kepu@example.com" };
  mockAuthCb!({ uid: "u1", email: "kepu@example.com" });
  return cloud;
}

// The payload data written by the last setDoc call.
function lastWrittenData(): Record<string, string> {
  const call = mockSetDoc.mock.calls[mockSetDoc.mock.calls.length - 1] as
    | unknown[]
    | undefined;
  const body = (call ? call[1] : null) as { payload: string } | null;
  return JSON.parse(body!.payload).data;
}

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  jest.useRealTimers();
});

// ---- the tests -------------------------------------------------------------

test("THE RACE: an empty device's early push never fires before the first server snapshot, and never overwrites a full cloud doc after it", () => {
  const cloud = bootSignedIn();

  // Freshly-evicted device: localStorage is empty. A local change is noted
  // right away (pre-fix, the shells did this on mount) and the debounce
  // elapses while the network is still slow — no snapshot yet.
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS * 3);
  expect(mockSetDoc).not.toHaveBeenCalled(); // gate held it

  // The first server snapshot finally lands: the cloud doc is FULL.
  mockSnapCb!(
    snap({ payload: payloadOf({ scribal_books_v1: BOOKS_WITH_MARK }) })
  );
  // The held push is released, but the emptiness guard must block it.
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS * 3);
  expect(mockSetDoc).not.toHaveBeenCalled();
});

test("a cache-only 'doc missing' snapshot never seeds the cloud (second arm of the race)", () => {
  bootSignedIn();
  // Firestore's offline cache answers first on a fresh profile: no doc.
  mockSnapCb!(snap({ fromCache: true }));
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS * 3);
  expect(mockSetDoc).not.toHaveBeenCalled();
});

test("widened guard: zero marks AND zero studies/tables/notes never overwrites a doc holding only studies", () => {
  const cloud = bootSignedIn();
  // Cloud doc has no marks but DOES have a study — the old marks-only guard
  // (localMarks===0 && lastRemoteMarks>0) would have let this through.
  mockSnapCb!(
    snap({
      payload: payloadOf({
        scribal_books_v1: BOOKS_EMPTY,
        scribal_studies_v1: ONE_STUDY,
      }),
    })
  );
  cloud.noteLocalChange(); // the merge's own echo — consumed by suppressEcho
  cloud.noteLocalChange(); // a real local change on the still-empty device
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS * 3);
  expect(mockSetDoc).not.toHaveBeenCalled();
});

test("a genuinely new account still seeds the cloud from the device", () => {
  bootSignedIn();
  localStorage.setItem("scribal_books_v1", BOOKS_WITH_MARK);
  // SERVER-confirmed miss: there really is no cloud doc.
  mockSnapCb!(snap({ fromCache: false }));
  jest.advanceTimersByTime(10);
  expect(mockSetDoc).toHaveBeenCalledTimes(1);
  expect(lastWrittenData()["scribal_books_v1"]).toBe(BOOKS_WITH_MARK);
});

test("repair: a data-holding device pushes its data back over a wiped cloud doc on sign-in", () => {
  bootSignedIn();
  localStorage.setItem("scribal_books_v1", BOOKS_WITH_MARK);
  localStorage.setItem("scribal_studies_v1", ONE_STUDY);
  // The cloud doc is the factory-fresh wipe payload another device wrote.
  mockSnapCb!(
    snap({ payload: payloadOf({ scribal_books_v1: BOOKS_EMPTY }) })
  );
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  expect(mockSetDoc).toHaveBeenCalledTimes(1);
  const written = lastWrittenData();
  expect(written["scribal_books_v1"]).toBe(BOOKS_WITH_MARK);
  expect(written["scribal_studies_v1"]).toBe(ONE_STUDY);
});

test("normal editing still syncs: local changes push after the server snapshot arrives", () => {
  const cloud = bootSignedIn();
  // Cloud has the user's data; this device has the same PLUS a new study.
  mockSnapCb!(
    snap({ payload: payloadOf({ scribal_books_v1: BOOKS_WITH_MARK }) })
  );
  localStorage.setItem("scribal_books_v1", BOOKS_WITH_MARK);
  cloud.noteLocalChange(); // the merge's own echo — consumed by suppressEcho
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS * 3);
  mockSetDoc.mockClear(); // ignore any merge-echo push before the edit
  localStorage.setItem("scribal_studies_v1", ONE_STUDY);
  cloud.noteLocalChange();
  jest.advanceTimersByTime(PUSH_DEBOUNCE_MS + 10);
  expect(mockSetDoc).toHaveBeenCalledTimes(1);
  expect(lastWrittenData()["scribal_studies_v1"]).toBe(ONE_STUDY);
});
