// NOTES ARE PER-BOOK — Kepu's ruling, Aug 7 2026, pinned so it cannot be
// "unified" again by accident. A global notes store shipped for about an hour
// that day and joined every session book's notes into one map; session books
// exist to keep sessions SEPARATE. These drive the real reducer and pin both
// halves of the contract: separation between books, and stamped convergence
// for the SAME book across devices.
import { reducer, MarksState, StudyBook } from "./hooks/useMarks";

const book = (
  id: string,
  name: string,
  extra: Partial<StudyBook> = {}
): StudyBook => ({
  id,
  name,
  locked: false,
  marks: [],
  colorLabels: {},
  notes: {},
  tombstones: {},
  createdAt: 1,
  lastStudiedAt: 1,
  ...extra,
});

const base = (activeId = "master", extra: Partial<MarksState> = {}): MarksState => ({
  books: {
    master: book("master", "Master"),
    sessionA: book("sessionA", "Session A"),
  },
  order: ["master", "sessionA"],
  activeId,
  deletedBooks: {},
  past: [],
  future: [],
  ...extra,
});

const KEY = "synthesis|scope:Genesis 1";

describe("separation: session books keep their own notes", () => {
  test("a note lands in the ACTIVE book and only there", () => {
    const s = reducer(base("sessionA"), {
      type: "setNote",
      key: KEY,
      text: "<p>session thought</p>",
    });
    expect(s.books.sessionA.notes[KEY]).toBe("<p>session thought</p>");
    expect(s.books.master.notes[KEY]).toBeUndefined();
  });

  test("two books studying the same chapter hold two different notes", () => {
    let s = reducer(base("master"), {
      type: "setNote",
      key: KEY,
      text: "<p>master's take</p>",
    });
    s = reducer({ ...s, activeId: "sessionA" }, {
      type: "setNote",
      key: KEY,
      text: "<p>the session's own take</p>",
    });
    expect(s.books.master.notes[KEY]).toBe("<p>master's take</p>");
    expect(s.books.sessionA.notes[KEY]).toBe("<p>the session's own take</p>");
  });
});

describe("convergence: the same book agrees across devices", () => {
  test("a stamped remote edit to the same book wins when newer", () => {
    let s = reducer(base("sessionA"), {
      type: "setNote",
      key: KEY,
      text: "<p>older local</p>",
    });
    const localAt = s.books.sessionA.noteAt![KEY];
    const remote = JSON.stringify({
      books: {
        sessionA: {
          name: "Session A",
          marks: [],
          colorLabels: {},
          notes: { [KEY]: "<p>newer remote</p>" },
          noteAt: { [KEY]: localAt + 10_000 },
        },
      },
    });
    const merged = reducer(s, { type: "mergeRemoteBooks", json: remote });
    expect(merged.books.sessionA.notes[KEY]).toBe("<p>newer remote</p>");
    // ...and it stayed OUT of the other book.
    expect(merged.books.master.notes[KEY]).toBeUndefined();
  });

  test("a remote edit to book A never bleeds into book B's same-named key", () => {
    const s = base("master");
    const remote = JSON.stringify({
      books: {
        sessionA: {
          name: "Session A",
          marks: [],
          colorLabels: {},
          notes: { [KEY]: "<p>A's note</p>" },
          noteAt: { [KEY]: 900 },
        },
      },
    });
    const merged = reducer(s, { type: "mergeRemoteBooks", json: remote });
    expect(merged.books.sessionA.notes[KEY]).toBe("<p>A's note</p>");
    expect(merged.books.master.notes[KEY]).toBeUndefined();
  });
});

describe("recovery from the one-hour global-store build", () => {
  test("root notes in a remote blob fold into the active book, not everywhere", () => {
    const s = base("sessionA");
    const remote = JSON.stringify({
      books: {},
      notes: { [KEY]: "<p>typed on the global build</p>" },
      noteAt: { [KEY]: 900 },
    });
    const merged = reducer(s, { type: "mergeRemoteBooks", json: remote });
    expect(merged.books.sessionA.notes[KEY]).toBe(
      "<p>typed on the global build</p>"
    );
    expect(merged.books.master.notes[KEY]).toBeUndefined();
  });

  test("an ordinary blob with no root notes changes nothing", () => {
    let s = reducer(base("sessionA"), {
      type: "setNote",
      key: KEY,
      text: "<p>steady</p>",
    });
    const remote = JSON.stringify({
      books: {
        sessionA: {
          name: "Session A",
          locked: false, // omitted = locked, and the flip would read as a change (SCR-93)
          marks: [],
          colorLabels: {},
          notes: { ...s.books.sessionA.notes },
          noteAt: { ...s.books.sessionA.noteAt },
        },
      },
    });
    // Identical remote → identical state object (no echo loops).
    expect(reducer(s, { type: "mergeRemoteBooks", json: remote })).toBe(s);
  });
});
