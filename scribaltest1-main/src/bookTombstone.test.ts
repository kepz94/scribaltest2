import { reducer, MarksState, StudyBook } from "./hooks/useMarks";

// Books were the one entity in Scribal with no deletion record. deleteBook did a
// hard delete, and mergeRemoteBooks rebuilt any book that was remote-but-not-
// local — so every book deletion was undone by the next inbound snapshot, on
// both sync channels, permanently and with nothing reported. These pin the rule
// that replaced it.

const book = (id: string, name: string): StudyBook => ({
  id,
  name,
  locked: false, // the reducer refuses to delete a locked book (SCR-93)
  marks: [],
  colorLabels: {},
  notes: {},
  createdAt: 1000,
  lastStudiedAt: 1000,
});

const stateWith = (...ids: string[]): MarksState => {
  const books: Record<string, StudyBook> = { master: book("master", "Master") };
  ids.forEach((id) => (books[id] = book(id, "Session " + id)));
  return {
    books,
    order: ["master", ...ids],
    activeId: "master",
    deletedBooks: {},
    past: [],
    future: [],
  };
};

// What another device (or a stale cloud copy) sends back.
const snapshot = (s: {
  books: string[];
  deletedBooks?: Record<string, number>;
}) =>
  JSON.stringify({
    books: s.books.reduce((acc: any, id) => {
      acc[id] = { name: "Session " + id, marks: [], colorLabels: {} };
      return acc;
    }, {}),
    deletedBooks: s.deletedBooks || {},
  });

test("deleting a book records a tombstone", () => {
  const next = reducer(stateWith("s1"), { type: "deleteBook", id: "s1" });
  expect(next.books.s1).toBeUndefined();
  expect(next.order).not.toContain("s1");
  expect(typeof next.deletedBooks.s1).toBe("number");
});

test("a deleted book is NOT resurrected by a remote copy that still has it", () => {
  // The exact regression: delete here, then sync with a device that hasn't heard.
  const deleted = reducer(stateWith("s1"), { type: "deleteBook", id: "s1" });
  const merged = reducer(deleted, {
    type: "mergeRemoteBooks",
    json: snapshot({ books: ["master", "s1"] }),
  });
  expect(merged.books.s1).toBeUndefined();
  expect(merged.order).not.toContain("s1");
});

test("a deletion made on another device removes the book here", () => {
  const merged = reducer(stateWith("s1"), {
    type: "mergeRemoteBooks",
    json: snapshot({ books: ["master"], deletedBooks: { s1: Date.now() } }),
  });
  expect(merged.books.s1).toBeUndefined();
  expect(merged.order).not.toContain("s1");
  expect(merged.deletedBooks.s1).toBeDefined();
});

test("deleting the active book on another device moves the reader to master", () => {
  const s = stateWith("s1");
  const merged = reducer(
    { ...s, activeId: "s1" },
    {
      type: "mergeRemoteBooks",
      json: snapshot({ books: ["master"], deletedBooks: { s1: Date.now() } }),
    }
  );
  expect(merged.activeId).toBe("master");
});

test("master can never be tombstoned, however a remote blob is shaped", () => {
  const merged = reducer(stateWith("s1"), {
    type: "mergeRemoteBooks",
    json: snapshot({ books: ["s1"], deletedBooks: { master: Date.now() } }),
  });
  expect(merged.books.master).toBeDefined();
  expect(merged.deletedBooks.master).toBeUndefined();
});

test("a genuinely new book from another device still arrives", () => {
  // The guard must not cost normal sync — this is what the merge is FOR.
  const merged = reducer(stateWith(), {
    type: "mergeRemoteBooks",
    json: snapshot({ books: ["master", "s2"] }),
  });
  expect(merged.books.s2).toBeDefined();
  expect(merged.order).toContain("s2");
});

test("an expired tombstone stops holding a book out", () => {
  // 90-day TTL, same as mark tombstones: past it the record is dropped, and a
  // remote copy is free to reinstate. Session ids are unique per creation, so in
  // practice nothing is left holding that id by then.
  const old = Date.now() - 1000 * 60 * 60 * 24 * 91;
  const merged = reducer(stateWith(), {
    type: "mergeRemoteBooks",
    json: snapshot({ books: ["master", "s1"], deletedBooks: { s1: old } }),
  });
  expect(merged.deletedBooks.s1).toBeUndefined();
  expect(merged.books.s1).toBeDefined();
});

test("merging the same snapshot twice is a no-op (no sync ping-pong)", () => {
  const deleted = reducer(stateWith("s1"), { type: "deleteBook", id: "s1" });
  const json = snapshot({ books: ["master", "s1"] });
  const once = reducer(deleted, { type: "mergeRemoteBooks", json });
  const twice = reducer(once, { type: "mergeRemoteBooks", json });
  expect(twice).toBe(once); // same object identity — no re-render, no push
});
