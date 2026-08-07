// The global notes store — the structural fix for a week of divergence bugs
// that all traced to notes being addressed by mutable context (the active
// book, chapter lists, link groups). These drive the REAL reducer and pin the
// foundation: one map, independent of books, stamped, tombstoned, harvested
// from every legacy location on load and on merge.
import { reducer, harvestNotes, MarksState, StudyBook } from "./hooks/useMarks";

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

const base = (extra: Partial<MarksState> = {}): MarksState => ({
  books: {
    master: book("master", "Master"),
    sessionA: book("sessionA", "Session A"),
  },
  order: ["master", "sessionA"],
  activeId: "master",
  deletedBooks: {},
  notes: {},
  noteAt: {},
  noteDel: {},
  past: [],
  future: [],
  ...extra,
});

const KEY = "synthesis|scope:Genesis 1";

describe("the bug that forced this: two devices, two active books", () => {
  test("a note is readable whatever the active book is", () => {
    // Device 1 writes with master active.
    let s = base();
    s = reducer(s, { type: "setNote", key: KEY, text: "<p>the edit</p>" });
    expect(s.notes[KEY]).toBe("<p>the edit</p>");
    // The same state with a DIFFERENT active book reads the same note — under
    // the old per-book storage this exact switch made the note vanish.
    const other = { ...s, activeId: "sessionA" };
    expect(other.notes[KEY]).toBe("<p>the edit</p>");
    // And the write never landed inside any book.
    expect(s.books.master.notes[KEY]).toBeUndefined();
    expect(s.books.sessionA.notes[KEY]).toBeUndefined();
  });

  test("a remote device's edit lands globally even though IT stored per-book", () => {
    // The other device runs an older build: its note sits inside sessionA's
    // map, stamped. The merge must surface it globally here.
    const s = base();
    const remote = JSON.stringify({
      books: {
        sessionA: {
          name: "Session A",
          marks: [],
          colorLabels: {},
          notes: { [KEY]: "<p>edited on the other device</p>" },
          noteAt: { [KEY]: 500 },
        },
      },
    });
    const merged = reducer(s, { type: "mergeRemoteBooks", json: remote });
    expect(merged.notes[KEY]).toBe("<p>edited on the other device</p>");
  });

  test("remote GLOBAL notes merge by stamp, newest wins", () => {
    let s = base();
    s = reducer(s, { type: "setNote", key: KEY, text: "<p>older local</p>" });
    const localAt = s.noteAt[KEY];
    const remote = JSON.stringify({
      books: {},
      notes: { [KEY]: "<p>newer remote</p>" },
      noteAt: { [KEY]: localAt + 10_000 },
    });
    const merged = reducer(s, { type: "mergeRemoteBooks", json: remote });
    expect(merged.notes[KEY]).toBe("<p>newer remote</p>");
    // And the older direction loses.
    const stale = JSON.stringify({
      books: {},
      notes: { [KEY]: "<p>stale</p>" },
      noteAt: { [KEY]: localAt - 10_000 },
    });
    expect(reducer(merged, { type: "mergeRemoteBooks", json: stale }).notes[KEY]).toBe(
      "<p>newer remote</p>"
    );
  });
});

describe("deletion still defends itself", () => {
  test("a cleared note carries a tombstone and a legacy book copy cannot resurrect it", () => {
    let s = base();
    s = reducer(s, { type: "setNote", key: KEY, text: "<p>doomed</p>" });
    s = reducer(s, { type: "setNote", key: KEY, text: "" });
    expect(s.noteDel[KEY]).toBeGreaterThan(0);
    // An old device still holds the text in a book, unstamped. Harvest must
    // not bring it back over a stamped deletion.
    const remote = JSON.stringify({
      books: {
        sessionA: {
          name: "Session A",
          marks: [],
          colorLabels: {},
          notes: { [KEY]: "<p>doomed</p>" },
        },
      },
    });
    const merged = reducer(s, { type: "mergeRemoteBooks", json: remote });
    expect((merged.notes[KEY] || "").trim()).toBe("");
  });

  test("a deleted BOOK's embedded notes are not harvested from the remote", () => {
    const s = base({ deletedBooks: { ghost: Date.now() } });
    const remote = JSON.stringify({
      books: {
        ghost: {
          name: "Ghost",
          marks: [],
          colorLabels: {},
          notes: { [KEY]: "<p>from beyond</p>" },
        },
      },
    });
    const merged = reducer(s, { type: "mergeRemoteBooks", json: remote });
    expect(merged.notes[KEY]).toBeUndefined();
  });
});

describe("harvest", () => {
  test("sweeps every book, stamped copies beating unstamped", () => {
    const g = harvestNotes(
      {
        a: { notes: { [KEY]: "<p>short</p>" } },
        b: { notes: { [KEY]: "<p>the longer, later copy</p>" }, noteAt: { [KEY]: 900 } },
      },
      {},
      {},
      {}
    );
    expect(g.notes[KEY]).toBe("<p>the longer, later copy</p>");
    expect(g.noteAt[KEY]).toBe(900);
  });

  test("two unstamped copies: the longer text survives (nothing is destroyed)", () => {
    const g = harvestNotes(
      {
        a: { notes: { [KEY]: "<p>first paragraph</p>" } },
        b: { notes: { [KEY]: "<p>first paragraph</p><p>and the rest of it</p>" } },
      },
      {},
      {},
      {}
    );
    expect(g.notes[KEY]).toBe("<p>first paragraph</p><p>and the rest of it</p>");
  });

  test("the seed (already-global notes) outranks unstamped book copies", () => {
    const g = harvestNotes(
      { a: { notes: { [KEY]: "<p>ancient book copy that is much longer</p>" } } },
      { [KEY]: "<p>global</p>" },
      { [KEY]: 1000 },
      {}
    );
    expect(g.notes[KEY]).toBe("<p>global</p>");
  });
});

describe("no echo loops", () => {
  test("an identical remote produces the SAME state object", () => {
    let s = base();
    s = reducer(s, { type: "setNote", key: KEY, text: "<p>steady</p>" });
    const remote = JSON.stringify({
      books: {},
      notes: { ...s.notes },
      noteAt: { ...s.noteAt },
      noteDel: { ...s.noteDel },
    });
    expect(reducer(s, { type: "mergeRemoteBooks", json: remote })).toBe(s);
  });
});
