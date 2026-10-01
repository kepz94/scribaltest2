// SCR-121 (Oct 1 2026): the phone's localStorage filled, every save of the
// book store failed inside a bare try/catch for ten days, and sync uploaded
// the stale stored copy over the cloud. These pin the storage rules that
// replaced it: compressed at rest, legacy raw JSON still readable, raw JSON to
// everyone else, and a failed save that other code can see.

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import {
  BOOKS_STORE_KEY,
  STORE_PREFIX,
  booksSaveFailed,
  decodeBooks,
  encodeBooks,
  readBooksJson,
  readStoredValue,
  writeBooksJson,
} from "./booksStore";
import { useMarks } from "./hooks/useMarks";

const util = require("util");

// Text a note can really hold: accents, curly quotes, an em dash, an emoji
// (a 4-byte UTF-8 sequence — fflate's own fallback codec mangled exactly this).
const TRICKY = "héllo “faith” — covenant 😀 ✝ 日本";

const booksJson = (n: number) =>
  JSON.stringify({
    books: {
      master: {
        id: "master",
        name: "Master Book",
        marks: Array.from({ length: n }, (_, i) => ({
          id: "m" + i,
          reference: "1 Nephi 3:" + ((i % 30) + 1),
          verseText:
            "And it came to pass that I, Nephi, said unto my father: I will go and do the things which the Lord hath commanded",
          markedText: "go and do",
          startIndex: 50,
          endIndex: 59,
          style: "underline",
          color: (i % 10) + 1,
          timestamp: 1720000000000 + i,
        })),
        notes: { "note|1 Nephi 3": "<p>" + TRICKY + "</p>" },
      },
    },
    order: ["master"],
    activeId: "master",
    deletedBooks: {},
  });

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

test("a legacy raw-JSON book store reads exactly as stored", () => {
  const legacy = booksJson(3);
  localStorage.setItem(BOOKS_STORE_KEY, legacy);
  expect(readBooksJson()).toBe(legacy);
  expect(decodeBooks(legacy)).toBe(legacy);
});

test("compressed round trip is exact for non-Latin-1 text — fallback codec (no TextEncoder)", () => {
  const saveTE = (global as any).TextEncoder;
  const saveTD = (global as any).TextDecoder;
  delete (global as any).TextEncoder;
  delete (global as any).TextDecoder;
  try {
    const json = booksJson(20);
    const stored = encodeBooks(json);
    expect(stored.indexOf(STORE_PREFIX)).toBe(0);
    expect(decodeBooks(stored)).toBe(json);
  } finally {
    (global as any).TextEncoder = saveTE;
    (global as any).TextDecoder = saveTD;
  }
});

test("compressed round trip is exact for non-Latin-1 text — TextEncoder path (what browsers use)", () => {
  const saveTE = (global as any).TextEncoder;
  const saveTD = (global as any).TextDecoder;
  (global as any).TextEncoder = util.TextEncoder;
  (global as any).TextDecoder = util.TextDecoder;
  try {
    const json = booksJson(20);
    expect(decodeBooks(encodeBooks(json))).toBe(json);
  } finally {
    (global as any).TextEncoder = saveTE;
    (global as any).TextDecoder = saveTD;
  }
});

test("a corrupt compressed value decodes to null — never handed to a merge", () => {
  expect(decodeBooks(STORE_PREFIX + "!!not base64!!")).toBeNull();
  expect(decodeBooks(STORE_PREFIX + btoa("not deflate at all"))).toBeNull();
  expect(decodeBooks(null)).toBeNull();
});

test("the at-rest form is several times smaller than the raw JSON", () => {
  const json = booksJson(2000);
  const stored = encodeBooks(json);
  expect(stored.length * 3).toBeLessThan(json.length);
});

test("a save lands compressed, reads back as raw JSON, and clears the failure flag", () => {
  const json = booksJson(5);
  expect(writeBooksJson(json)).toBe(true);
  expect(booksSaveFailed()).toBe(false);
  expect((localStorage.getItem(BOOKS_STORE_KEY) as string).indexOf(STORE_PREFIX)).toBe(0);
  expect(readBooksJson()).toBe(json);
  expect(readStoredValue(BOOKS_STORE_KEY)).toBe(json);
});

test("THE FAILURE ITSELF: a save that throws (storage full) is remembered, and the stored copy is untouched", () => {
  const first = booksJson(5);
  writeBooksJson(first);
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError");
  });
  expect(writeBooksJson(booksJson(6))).toBe(false);
  expect(booksSaveFailed()).toBe(true);
  // What storage holds is still the older copy — exactly why sync must not
  // upload it as if it were current.
  expect(readBooksJson()).toBe(first);
  jest.restoreAllMocks();
  // Room again: the next save lands and the flag clears.
  const later = booksJson(7);
  expect(writeBooksJson(later)).toBe(true);
  expect(booksSaveFailed()).toBe(false);
  expect(readBooksJson()).toBe(later);
});

test("readStoredValue returns every other key exactly as stored", () => {
  localStorage.setItem("scribal_studies_v1", '[{"id":"s1"}]');
  expect(readStoredValue("scribal_studies_v1")).toBe('[{"id":"s1"}]');
  expect(readStoredValue("nope")).toBeNull();
});

// ---- the real hook: load + save go through booksStore ------------------------

function mountMarks(): { state: () => any; unmount: () => void } {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  let latest: any = null;
  const Probe = () => {
    latest = useMarks();
    return null;
  };
  const el = document.createElement("div");
  const root = createRoot(el);
  act(() => {
    root.render(React.createElement(Probe));
  });
  return {
    state: () => latest,
    unmount: () => act(() => root.unmount()),
  };
}

test("useMarks loads a legacy raw-JSON store, then saves it back compressed", () => {
  localStorage.setItem(BOOKS_STORE_KEY, booksJson(4));
  const h = mountMarks();
  expect(h.state().marks.map((m: any) => m.id)).toEqual(["m0", "m1", "m2", "m3"]);
  const stored = localStorage.getItem(BOOKS_STORE_KEY) as string;
  expect(stored.indexOf(STORE_PREFIX)).toBe(0);
  expect(JSON.parse(decodeBooks(stored) as string).books.master.marks).toHaveLength(4);
  h.unmount();
});

test("useMarks reports a mark that could not be saved instead of swallowing it", () => {
  localStorage.setItem(BOOKS_STORE_KEY, booksJson(2));
  const h = mountMarks();
  expect(booksSaveFailed()).toBe(false);
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError");
  });
  act(() => {
    h.state().addMark("1 Nephi 3:7", "I will go and do", "go and do", 7, 16, "bold", 3);
  });
  expect(h.state().marks).toHaveLength(3); // on screen
  expect(booksSaveFailed()).toBe(true); // and known not to be saved
  jest.restoreAllMocks();
  h.unmount();
});
