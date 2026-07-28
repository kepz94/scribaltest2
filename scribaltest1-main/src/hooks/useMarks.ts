import { useReducer, useEffect, useCallback } from "react";
import { Mark, MarkStyle, MarkColor } from "../types";

// Two-canvas model (SCR-45): every book is a chapter canvas or a topic canvas.
// Master is implicitly chapter-typed. Books created before the model exists
// carry no type and behave exactly as before until the migration pass types
// them.
export type BookType = "chapter" | "topic";
const asBookType = (v: unknown): BookType | undefined =>
  v === "chapter" || v === "topic" ? v : undefined;

// The two default canvases: the Master Book (chapter) and the Master Topic
// Book (topic). Both exist from first run, and neither can be deleted.
export const MASTER_TOPIC_ID = "mastertopic";
export const isBuiltinBook = (id: string) =>
  id === "master" || id === MASTER_TOPIC_ID;

// Stable fallback for books without scopedLabels. An inline `|| {}` mints a
// new object identity every render, which the shells' syncData effects read
// as "data changed" — one ingredient of the SCR-10 idle write loop.
const EMPTY_SCOPED_LABELS: Record<string, Record<number, string>> = {};

interface StudyBook {
  id: string;
  name: string;
  // Two-canvas book type (SCR-45): "chapter" or "topic". Absent on master
  // (implicitly chapter) and on pre-migration books (which behave as today
  // until the migration pass runs). Persisted + synced with the book.
  type?: BookType;
  // SCR-71 book lock: a locked book cannot be deleted by ANY caller — the
  // reducer refuses. ABSENCE MEANS LOCKED (locked is the default for new
  // books and for every pre-update book), and only an explicit false is
  // unlocked. Unlock lives in the Vault and auto-re-locks, so false is
  // always short-lived.
  locked?: boolean;
  marks: Mark[];
  colorLabels: Record<number, string>;
  notes: Record<string, string>;
  // Deleted mark ids → when they were deleted, so deletions propagate across
  // devices instead of an old copy resurrecting them on the next sync.
  tombstones?: Record<string, number>;
  // Theme names per study scope (chapter title, e.g. "1 Nephi 2"). Each chapter
  // keeps its own palette so naming one chapter never touches another.
  scopedLabels?: Record<string, Record<number, string>>;
  // One-time flag: have we seeded scopedLabels from the old book-level palette?
  scopedMigrated?: boolean;
  // Relational (covenant) condition/promise role colors, per study scope —
  // e.g. { "Alma 5": { at: 1700000000000, roles: { covenant: { a: 1, b: 2 } } } }.
  // Kept on the book (not localStorage) so each study's pair syncs across
  // devices, last-write-wins per scope via `at`. Same per-scope keying as
  // scopedLabels.
  scopedRoles?: Record<
    string,
    {
      at: number;
      roles: Record<string, { a: number; b: number }>;
      lens?: string;
      // Outline lead verses: per color, the refs the user pinned to the top of
      // that theme (in pin order). Rides the same per-scope LWW sync.
      pins?: Record<string, string[]>;
      // Relational threads: per lens, the verse pairs the USER connected —
      // "this condition ties to that promise" across any distance. The system
      // never invents these; it only renders them.
      threads?: Record<string, { a: string | string[]; b: string | string[] }[]>;
    }
  >;
  createdAt: number;
  lastStudiedAt: number;
  // Walkthrough-only book: kept out of localStorage and cloud sync entirely (see
  // the persist effect), so the first-run tour's demo marks can never persist
  // locally or travel to another device. Deleting the book removes them whole.
  ephemeral?: boolean;
}

type State = {
  books: Record<string, StudyBook>;
  order: string[];
  activeId: string;
  past: Mark[][];
  future: Mark[][];
};

type Action =
  | {
      type: "add";
      reference: string;
      verseText: string;
      markedText: string;
      startIndex: number;
      endIndex: number;
      style: MarkStyle;
      color: MarkColor;
    }
  | { type: "deleteMark"; id: string }
  | {
      type: "addMany";
      items: {
        reference: string;
        verseText: string;
        markedText: string;
        startIndex: number;
        endIndex: number;
        style: MarkStyle;
        color: MarkColor;
      }[];
    }
  | { type: "deleteMany"; ids: string[] }
  | {
      // Book-targeted marking (used by the Study Table marking panel, which
      // marks verses in whichever book each card belongs to — not the active
      // book). Mirrors addMany but writes to books[bookId] and never touches
      // the active book's undo history.
      type: "addManyTo";
      bookId: string;
      items: {
        reference: string;
        verseText: string;
        markedText: string;
        startIndex: number;
        endIndex: number;
        style: MarkStyle;
        color: MarkColor;
      }[];
    }
  | { type: "deleteMarkIn"; bookId: string; id: string }
  | { type: "recolorMark"; id: string; color: MarkColor }
  | {
      type: "updateMarkRange";
      id: string;
      startIndex: number;
      endIndex: number;
      markedText: string;
      history: boolean;
    }
  | { type: "deleteGroup"; reference: string; color: MarkColor }
  | { type: "clearMarks"; refs: string[] }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "setActive"; id: string }
  | {
      type: "createSession";
      id: string;
      name: string;
      ephemeral?: boolean;
      bookType?: BookType;
    }
  | { type: "rename"; id: string; name: string }
  | { type: "setBookType"; id: string; bookType: BookType }
  | { type: "deleteBook"; id: string }
  | { type: "setBookLocked"; id: string; locked: boolean }
  | { type: "setLabel"; color: MarkColor; label: string }
  | { type: "setScopedLabel"; scope: string; color: MarkColor; label: string }
  | {
      // Book-targeted theme naming (the Study Table marking panel names themes
      // in whichever book each verse's marks live in, not the active book).
      type: "setScopedLabelIn";
      bookId: string;
      scope: string;
      color: MarkColor;
      label: string;
    }
  | {
      type: "seedScopeLabels";
      scope: string;
      labels: Record<number, string>;
    }
  | {
      type: "setScopedRoles";
      scope: string;
      roles: Record<string, { a: number; b: number }>;
    }
  | { type: "setScopedLens"; scope: string; lens: string }
  | { type: "setScopedPins"; scope: string; pins: Record<string, string[]> }
  | {
      type: "setScopedThreads";
      scope: string;
      threads: Record<string, { a: string | string[]; b: string | string[] }[]>;
    }
  | { type: "setNote"; key: string; text: string }
  | { type: "ensureBook"; id: string; name: string; bookType?: BookType }
  | { type: "absorb"; targetId: string; sourceId: string; refs: string[] }
  | {
      // SCR-70 copy phase: marks + per-verse notes + the scope entries
      // (scopedLabels/scopedRoles) for whole chapters, non-destructively.
      type: "copyChapters";
      sourceId: string;
      targetId: string;
      refs: string[];
      scopes: string[];
    }
  | {
      // SCR-70 clear phase — dispatched only after the copy is VERIFIED in
      // the target (the SCR-53 bar: copy → verify → clear, never one
      // destructive move). keepScopeEntries leaves theme names in place.
      type: "clearChapters";
      bookId: string;
      refs: string[];
      scopes: string[];
      keepScopeEntries: boolean;
    }
  | {
      type: "moveStudyMarks";
      sourceId: string;
      targetId: string;
      refs: string[];
      scope: string;
    }
  | {
      type: "importStudy";
      marks: Mark[];
      colorLabels: Record<number, string>;
      notes: Record<string, string>;
    }
  | { type: "freezeChapter"; prefix: string }
  | {
      // Two-canvas migration (SCR-53), books-store half. Atomic: retypes
      // session books in place, and per verified move ensures the
      // deterministic topic book, copies marks/palette/notes/relational data,
      // VERIFIES the copy on the new state, and clears the source marks with
      // tombstones only when verification passes. A move that fails
      // verification is skipped whole — nothing removed. The study records'
      // re-point happens outside (LAST), after the caller re-verifies.
      type: "twoCanvasMigrate";
      retypes: string[];
      moves: {
        sourceId: string;
        targetId: string; // deterministic: "topic_" + study id
        targetName: string;
        refs: string[];
        scope: string; // "searchstudy:" + study id
      }[];
    }
  | { type: "mergeRemoteBooks"; json: string };

const HISTORY_CAP = 50;
const TOMBSTONE_TTL = 1000 * 60 * 60 * 24 * 90; // keep deletions 90 days

// Given the marks before and after a change, update the tombstone map: any mark
// that disappeared is tombstoned (so the deletion syncs); any mark present has
// its tombstone cleared (so an undo/re-add brings it back to life). Applying
// this identically to deletes, undo, and redo keeps everything consistent.
function diffTombstones(
  oldMarks: Mark[],
  newMarks: Mark[],
  prev: Record<string, number> | undefined
): Record<string, number> {
  const newIds = new Set(newMarks.map((m) => m.id));
  const next: Record<string, number> = { ...(prev || {}) };
  newMarks.forEach((m) => {
    if (next[m.id] != null) delete next[m.id];
  });
  const now = Date.now();
  oldMarks.forEach((m) => {
    if (!newIds.has(m.id) && next[m.id] == null) next[m.id] = now;
  });
  return next;
}

function gcTombstones(
  t: Record<string, number> | undefined
): Record<string, number> {
  if (!t) return {};
  const cutoff = Date.now() - TOMBSTONE_TTL;
  const out: Record<string, number> = {};
  Object.keys(t).forEach((id) => {
    if (t[id] >= cutoff) out[id] = t[id];
  });
  return out;
}

// "1 Nephi 2:5" -> "1 Nephi 2". Book names have no colon, so split on the first.
function scopeOfRef(ref: string): string {
  const i = ref.indexOf(":");
  return i < 0 ? ref : ref.slice(0, i);
}

// One-time migration: theme names used to live at the book level (one shared
// palette). Seed per-chapter names from a chapter's frozen mark labels, falling
// back to the old book-level palette, so every existing study keeps the names
// it already shows. New chapters get nothing here, so they start blank.
function migrateScopedLabels(
  marks: Mark[],
  colorLabels: Record<number, string>,
  existing: Record<string, Record<number, string>> | undefined
): Record<string, Record<number, string>> {
  const out: Record<string, Record<number, string>> = {};
  if (existing && typeof existing === "object") {
    Object.keys(existing).forEach((s) => {
      if (existing[s] && typeof existing[s] === "object")
        out[s] = { ...existing[s] };
    });
  }
  marks.forEach((m) => {
    const scope = scopeOfRef(m.reference);
    if (!out[scope]) out[scope] = {};
    if ((out[scope][m.color] || "").trim()) return; // already named in scope
    const name =
      (m.label || "").trim() || (colorLabels[m.color] || "").trim();
    if (name) out[scope][m.color] = name;
  });
  return out;
}


const defaultLabels = (): Record<number, string> => ({
  1: "",
  2: "",
  3: "",
  4: "",
  5: "",
  6: "",
  7: "",
});

const safeGet = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const safeSet = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};
const safeParse = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const rand = () => Math.random().toString(36).slice(2, 7);

// Build Master from legacy single-collection storage (or empty)
function migrateMaster(): StudyBook {
  const marks = safeParse<Mark[]>(safeGet("scribal_marks"), []);
  const labels = safeParse<Record<number, string>>(
    safeGet("scribal_labels"),
    {}
  );
  const notes = safeParse<Record<string, string>>(safeGet("scribal_notes"), {});
  return {
    id: "master",
    name: "Master Chapter Book",
    marks: Array.isArray(marks) ? marks : [],
    colorLabels: { ...defaultLabels(), ...labels },
    notes: notes && typeof notes === "object" ? notes : {},
    createdAt: Date.now(),
    lastStudiedAt: Date.now(),
  };
}

// The built-in Master Topic Book: the default topic canvas, present from
// first run (and healed into older saves). Deterministic id, so two devices
// creating it independently merge cleanly.
function makeMasterTopic(): StudyBook {
  return {
    id: MASTER_TOPIC_ID,
    name: "Master Topic Book",
    type: "topic",
    marks: [],
    colorLabels: defaultLabels(),
    notes: {},
    tombstones: {},
    scopedLabels: {},
    scopedMigrated: true,
    scopedRoles: {},
    createdAt: Date.now(),
    lastStudiedAt: Date.now(),
  };
}

function initState(): State {
  const saved = safeParse<any>(safeGet("scribal_books_v1"), null);
  if (saved && saved.books && saved.books.master) {
    const books: Record<string, StudyBook> = saved.books;
    // ensure each book is well-formed
    Object.keys(books).forEach((id) => {
      const b = books[id];
      const marksArr = Array.isArray(b.marks) ? b.marks : [];
      const colorLabels = { ...defaultLabels(), ...(b.colorLabels || {}) };
      const rawScoped =
        b.scopedLabels && typeof b.scopedLabels === "object"
          ? b.scopedLabels
          : undefined;
      const scopedLabels = b.scopedMigrated
        ? rawScoped || {}
        : migrateScopedLabels(marksArr, colorLabels, rawScoped);
      books[id] = {
        id,
        // Heal the old default master name to the two-canvas one (master is
        // never user-renameable, so the old default is the only value here).
        name:
          id === "master"
            ? b.name === "Master Book" || !b.name
              ? "Master Chapter Book"
              : b.name
            : b.name || "Session",
        type: asBookType(b.type),
        marks: marksArr,
        colorLabels,
        notes: b.notes && typeof b.notes === "object" ? b.notes : {},
        tombstones: gcTombstones(
          b.tombstones && typeof b.tombstones === "object" ? b.tombstones : {}
        ),
          scopedLabels,
        scopedMigrated: true,
        scopedRoles:
          b.scopedRoles && typeof b.scopedRoles === "object"
            ? b.scopedRoles
            : {},
        createdAt: typeof b.createdAt === "number" ? b.createdAt : Date.now(),
        lastStudiedAt:
          typeof b.lastStudiedAt === "number"
            ? b.lastStudiedAt
            : typeof b.createdAt === "number"
            ? b.createdAt
            : Date.now(),
      };
    });
    // Heal the built-in Master Topic Book into older saves; its type is
    // always topic even if a stale copy lost it.
    if (!books[MASTER_TOPIC_ID]) books[MASTER_TOPIC_ID] = makeMasterTopic();
    else if (books[MASTER_TOPIC_ID].type !== "topic")
      books[MASTER_TOPIC_ID] = { ...books[MASTER_TOPIC_ID], type: "topic" };
    let order: string[] = Array.isArray(saved.order)
      ? saved.order.filter((id: string) => books[id])
      : [];
    Object.keys(books).forEach((id) => {
      if (!order.includes(id)) order.push(id);
    });
    order = [
      "master",
      MASTER_TOPIC_ID,
      ...order.filter((id) => !isBuiltinBook(id)),
    ];
    const activeId = books[saved.activeId] ? saved.activeId : "master";
    return { books, order, activeId, past: [], future: [] };
  }
  const master = migrateMaster();
  return {
    books: { master, [MASTER_TOPIC_ID]: makeMasterTopic() },
    order: ["master", MASTER_TOPIC_ID],
    activeId: "master",
    past: [],
    future: [],
  };
}

function reducer(state: State, action: Action): State {
  const active = state.books[state.activeId];

  const withActiveMarks = (nextMarks: Mark[], history: boolean): State => {
    const books = {
      ...state.books,
      [state.activeId]: {
        ...active,
        marks: nextMarks,
        tombstones: diffTombstones(active.marks, nextMarks, active.tombstones),
        lastStudiedAt: Date.now(),
      },
    };
    if (history) {
      return {
        ...state,
        books,
        past: [...state.past, active.marks].slice(-HISTORY_CAP),
        future: [],
      };
    }
    return { ...state, books };
  };

  switch (action.type) {
    case "add": {
      const { reference, verseText, startIndex, endIndex, style, color } =
        action;
      const GAP = 1;
      let ms = startIndex;
      let me = endIndex;
      const survivors = active.marks.filter((m) => {
        if (m.reference !== reference || m.color !== color || m.style !== style)
          return true;
        const touches = m.startIndex <= me + GAP && m.endIndex >= ms - GAP;
        if (touches) {
          ms = Math.min(ms, m.startIndex);
          me = Math.max(me, m.endIndex);
          return false;
        }
        return true;
      });
      const newMark: Mark = {
        id: "mark_" + Date.now() + "_" + rand(),
        reference,
        verseText,
        markedText: verseText.slice(ms, me),
        startIndex: ms,
        endIndex: me,
        style,
        color,
        timestamp: Date.now(),
      };
      return withActiveMarks([...survivors, newMark], true);
    }

    case "addMany": {
      const GAP = 1;
      let nextMarks = active.marks;
      action.items.forEach((it) => {
        let ms = it.startIndex;
        let me = it.endIndex;
        const survivors = nextMarks.filter((m) => {
          if (
            m.reference !== it.reference ||
            m.color !== it.color ||
            m.style !== it.style
          )
            return true;
          const touches = m.startIndex <= me + GAP && m.endIndex >= ms - GAP;
          if (touches) {
            ms = Math.min(ms, m.startIndex);
            me = Math.max(me, m.endIndex);
            return false;
          }
          return true;
        });
        const newMark: Mark = {
          id: "mark_" + Date.now() + "_" + rand(),
          reference: it.reference,
          verseText: it.verseText,
          markedText: it.verseText.slice(ms, me),
          startIndex: ms,
          endIndex: me,
          style: it.style,
          color: it.color,
          timestamp: Date.now(),
        };
        nextMarks = [...survivors, newMark];
      });
      return withActiveMarks(nextMarks, true);
    }

    case "addManyTo": {
      // Same coalescing logic as addMany, but on a specific book and without an
      // undo entry (the active book's history is left alone).
      const bk = state.books[action.bookId];
      if (!bk) return state;
      const GAP = 1;
      let nextMarks = bk.marks;
      action.items.forEach((it) => {
        let ms = it.startIndex;
        let me = it.endIndex;
        const survivors = nextMarks.filter((m) => {
          if (
            m.reference !== it.reference ||
            m.color !== it.color ||
            m.style !== it.style
          )
            return true;
          const touches = m.startIndex <= me + GAP && m.endIndex >= ms - GAP;
          if (touches) {
            ms = Math.min(ms, m.startIndex);
            me = Math.max(me, m.endIndex);
            return false;
          }
          return true;
        });
        const newMark: Mark = {
          id: "mark_" + Date.now() + "_" + rand(),
          reference: it.reference,
          verseText: it.verseText,
          markedText: it.verseText.slice(ms, me),
          startIndex: ms,
          endIndex: me,
          style: it.style,
          color: it.color,
          timestamp: Date.now(),
        };
        nextMarks = [...survivors, newMark];
      });
      return {
        ...state,
        books: {
          ...state.books,
          [action.bookId]: {
            ...bk,
            marks: nextMarks,
            tombstones: diffTombstones(bk.marks, nextMarks, bk.tombstones),
            lastStudiedAt: Date.now(),
          },
        },
      };
    }

    case "deleteMarkIn": {
      const bk = state.books[action.bookId];
      if (!bk) return state;
      const nextMarks = bk.marks.filter((m) => m.id !== action.id);
      return {
        ...state,
        books: {
          ...state.books,
          [action.bookId]: {
            ...bk,
            marks: nextMarks,
            tombstones: diffTombstones(bk.marks, nextMarks, bk.tombstones),
            lastStudiedAt: Date.now(),
          },
        },
      };
    }

    case "deleteMany": {
      const idset = new Set(action.ids);
      return withActiveMarks(
        active.marks.filter((m) => !idset.has(m.id)),
        true
      );
    }

    case "recolorMark": {
      const target = active.marks.find((m) => m.id === action.id);
      if (!target) return state;
      const GAP = 1;
      let ms = target.startIndex;
      let me = target.endIndex;
      const survivors = active.marks.filter((m) => {
        if (m.id === action.id) return false;
        if (
          m.reference !== target.reference ||
          m.color !== action.color ||
          m.style !== target.style
        )
          return true;
        const touches = m.startIndex <= me + GAP && m.endIndex >= ms - GAP;
        if (touches) {
          ms = Math.min(ms, m.startIndex);
          me = Math.max(me, m.endIndex);
          return false;
        }
        return true;
      });
      const recolored: Mark = {
        ...target,
        id: "mark_" + Date.now() + "_" + rand(),
        color: action.color,
        startIndex: ms,
        endIndex: me,
        markedText: target.verseText.slice(ms, me),
        timestamp: Date.now(),
      };
      return withActiveMarks([...survivors, recolored], true);
    }

    case "deleteMark":
      return withActiveMarks(
        active.marks.filter((m) => m.id !== action.id),
        true
      );

    case "updateMarkRange":
      return withActiveMarks(
        active.marks.map((m) =>
          m.id === action.id
            ? {
                ...m,
                startIndex: action.startIndex,
                endIndex: action.endIndex,
                markedText: action.markedText,
              }
            : m
        ),
        action.history
      );

    case "deleteGroup":
      return withActiveMarks(
        active.marks.filter(
          (m) => !(m.reference === action.reference && m.color === action.color)
        ),
        true
      );

    case "clearMarks": {
      const refSet = new Set(action.refs);
      return withActiveMarks(
        active.marks.filter((m) => !refSet.has(m.reference)),
        true
      );
    }

    case "undo": {
      if (!state.past.length) return state;
      const prev = state.past[state.past.length - 1];
      const books = {
        ...state.books,
        [state.activeId]: {
          ...active,
          marks: prev,
          tombstones: diffTombstones(active.marks, prev, active.tombstones),
        },
      };
      return {
        ...state,
        books,
        past: state.past.slice(0, -1),
        future: [active.marks, ...state.future].slice(0, HISTORY_CAP),
      };
    }

    case "redo": {
      if (!state.future.length) return state;
      const next = state.future[0];
      const books = {
        ...state.books,
        [state.activeId]: {
          ...active,
          marks: next,
          tombstones: diffTombstones(active.marks, next, active.tombstones),
        },
      };
      return {
        ...state,
        books,
        past: [...state.past, active.marks].slice(-HISTORY_CAP),
        future: state.future.slice(1),
      };
    }

    case "setActive":
      if (!state.books[action.id]) return state;
      return { ...state, activeId: action.id, past: [], future: [] };

    case "createSession": {
      const id = action.id;
      const book: StudyBook = {
        id,
        name: action.name,
        type: action.bookType,
        marks: [],
        colorLabels: defaultLabels(), // sessions start with their own blank theme names
        notes: {},
        createdAt: Date.now(),
        lastStudiedAt: Date.now(),
        ephemeral: action.ephemeral,
      };
      return {
        ...state,
        books: { ...state.books, [id]: book },
        order: [...state.order, id],
        activeId: id,
        past: [],
        future: [],
      };
    }

    case "ensureBook": {
      const existing = state.books[action.id];
      if (existing) {
        // Already exists — but a typed ensure may still stamp the type onto an
        // untyped book (the migration's deterministic-id path relies on this).
        if (action.bookType && !existing.type) {
          return {
            ...state,
            books: {
              ...state.books,
              [action.id]: { ...existing, type: action.bookType },
            },
          };
        }
        return state;
      }
      const book: StudyBook = {
        id: action.id,
        name: action.name,
        type: action.bookType,
        marks: [],
        colorLabels: { ...defaultLabels() },
        notes: {},
        createdAt: Date.now(),
        lastStudiedAt: Date.now(),
      };
      return {
        ...state,
        books: { ...state.books, [action.id]: book },
        order: [...state.order, action.id],
      };
    }

    case "absorb": {
      const target = state.books[action.targetId];
      const source = state.books[action.sourceId];
      if (!target || !source) return state;
      const refSet = new Set(action.refs);
      // copy source marks for the given refs that target doesn't already have (by id)
      const haveIds = new Set(target.marks.map((m) => m.id));
      const addMarks = source.marks.filter(
        (m) => refSet.has(m.reference) && !haveIds.has(m.id)
      );
      // merge color meanings: keep target's named labels, fill blanks from source
      const mergedLabels: Record<number, string> = { ...source.colorLabels };
      Object.keys(target.colorLabels).forEach((k) => {
        const kn = Number(k);
        if ((target.colorLabels[kn] || "").trim() !== "") {
          mergedLabels[kn] = target.colorLabels[kn];
        }
      });
      // merge notes for the given refs: keep target's, fill missing from source
      const mergedNotes: Record<string, string> = { ...target.notes };
      Object.keys(source.notes).forEach((k) => {
        const ref = k.split("|").pop();
        if (ref && refSet.has(ref) && !(k in mergedNotes)) {
          mergedNotes[k] = source.notes[k];
        }
      });
      return {
        ...state,
        books: {
          ...state.books,
          [action.targetId]: {
            ...target,
            marks: [...target.marks, ...addMarks],
            colorLabels: mergedLabels,
            notes: mergedNotes,
          },
        },
      };
    }

    case "copyChapters": {
      const source = state.books[action.sourceId];
      const target = state.books[action.targetId];
      if (!source || !target || action.sourceId === action.targetId)
        return state;
      const refSet = new Set(action.refs);
      const haveIds = new Set(target.marks.map((m) => m.id));
      const addMarks = source.marks.filter(
        (m) => refSet.has(m.reference) && !haveIds.has(m.id)
      );
      // Color meanings: keep the target's named labels, fill blanks from the
      // source (same rule as absorb/moveStudyMarks).
      const mergedLabels: Record<number, string> = { ...source.colorLabels };
      Object.keys(target.colorLabels).forEach((k) => {
        const kn = Number(k);
        if ((target.colorLabels[kn] || "").trim() !== "")
          mergedLabels[kn] = target.colorLabels[kn];
      });
      // Per-verse notes for the chapters' refs: keep target's, fill missing.
      const mergedNotes: Record<string, string> = { ...target.notes };
      Object.keys(source.notes).forEach((k) => {
        const ref = k.split("|").pop();
        if (ref && refSet.has(ref) && !(k in mergedNotes))
          mergedNotes[k] = source.notes[k];
      });
      // Scope entries (theme names + relational roles): the target adopts the
      // source's entry for each transferred scope it doesn't already have.
      const tgtSL = { ...(target.scopedLabels || {}) };
      const tgtSR = { ...(target.scopedRoles || {}) };
      const srcSL = source.scopedLabels || {};
      const srcSR = source.scopedRoles || {};
      action.scopes.forEach((s) => {
        if (s in srcSL && !(s in tgtSL)) tgtSL[s] = srcSL[s];
        if (s in srcSR && !(s in tgtSR)) tgtSR[s] = srcSR[s];
      });
      return {
        ...state,
        books: {
          ...state.books,
          [action.targetId]: {
            ...target,
            marks: [...target.marks, ...addMarks],
            colorLabels: mergedLabels,
            notes: mergedNotes,
            scopedLabels: tgtSL,
            scopedRoles: tgtSR,
          },
        },
      };
    }

    case "clearChapters": {
      const bk = state.books[action.bookId];
      if (!bk) return state;
      const refSet = new Set(action.refs);
      const newMarks = bk.marks.filter((m) => !refSet.has(m.reference));
      const newNotes: Record<string, string> = {};
      Object.keys(bk.notes).forEach((k) => {
        const ref = k.split("|").pop();
        if (!(ref && refSet.has(ref))) newNotes[k] = bk.notes[k];
      });
      let sl = bk.scopedLabels || {};
      let sr = bk.scopedRoles || {};
      if (!action.keepScopeEntries) {
        sl = { ...sl };
        sr = { ...sr };
        action.scopes.forEach((s) => {
          delete sl[s];
          delete sr[s];
        });
      }
      return {
        ...state,
        books: {
          ...state.books,
          [action.bookId]: {
            ...bk,
            marks: newMarks,
            // Tombstone the cleared marks so the removal syncs instead of an
            // old copy resurrecting them on the next pull.
            tombstones: diffTombstones(bk.marks, newMarks, bk.tombstones),
            notes: newNotes,
            scopedLabels: sl,
            scopedRoles: sr,
          },
        },
        // Undo history is per active book; a cross-book transfer invalidates it.
        past: [],
        future: [],
      };
    }

    case "moveStudyMarks": {
      const source = state.books[action.sourceId];
      const target = state.books[action.targetId];
      if (!source || !target || action.sourceId === action.targetId)
        return state;
      const refSet = new Set(action.refs);

      // Marks on the study's verses, lifted out of the source book.
      const moving = source.marks.filter((m) => refSet.has(m.reference));
      const newSourceMarks = source.marks.filter(
        (m) => !refSet.has(m.reference)
      );
      const haveIds = new Set(target.marks.map((m) => m.id));
      const newTargetMarks = [
        ...target.marks,
        ...moving.filter((m) => !haveIds.has(m.id)),
      ];

      // Notes for those verses move too: target gains them (without clobbering
      // any it already has), source loses them.
      const sourceNotes: Record<string, string> = {};
      const targetNotes: Record<string, string> = { ...target.notes };
      Object.keys(source.notes).forEach((k) => {
        const ref = k.split("|").pop();
        if (ref && refSet.has(ref)) {
          if (!(k in targetNotes)) targetNotes[k] = source.notes[k];
        } else {
          sourceNotes[k] = source.notes[k];
        }
      });

      // Color meanings: keep the target's named labels, fill its blanks from the
      // source so the moved marks still read correctly.
      const mergedLabels: Record<number, string> = { ...source.colorLabels };
      Object.keys(target.colorLabels).forEach((k) => {
        const kn = Number(k);
        if ((target.colorLabels[kn] || "").trim() !== "")
          mergedLabels[kn] = target.colorLabels[kn];
      });

      // The study's per-scope theme names and relational pair travel with it.
      const srcSL = { ...(source.scopedLabels || {}) };
      const tgtSL = { ...(target.scopedLabels || {}) };
      if (action.scope in srcSL) {
        tgtSL[action.scope] = srcSL[action.scope];
        delete srcSL[action.scope];
      }
      const srcSR = { ...(source.scopedRoles || {}) };
      const tgtSR = { ...(target.scopedRoles || {}) };
      if (action.scope in srcSR) {
        tgtSR[action.scope] = srcSR[action.scope];
        delete srcSR[action.scope];
      }

      return {
        ...state,
        books: {
          ...state.books,
          [action.sourceId]: {
            ...source,
            marks: newSourceMarks,
            // Tombstone the lifted marks so the removal syncs instead of an old
            // copy resurrecting them on the next pull.
            tombstones: diffTombstones(
              source.marks,
              newSourceMarks,
              source.tombstones
            ),
            notes: sourceNotes,
            scopedLabels: srcSL,
            scopedRoles: srcSR,
          },
          [action.targetId]: {
            ...target,
            marks: newTargetMarks,
            tombstones: diffTombstones(
              target.marks,
              newTargetMarks,
              target.tombstones
            ),
            colorLabels: mergedLabels,
            notes: targetNotes,
            scopedLabels: tgtSL,
            scopedRoles: tgtSR,
          },
        },
        // Undo history is per active book; a cross-book move invalidates it.
        past: [],
        future: [],
      };
    }

    case "rename": {
      if (!state.books[action.id]) return state;
      return {
        ...state,
        books: {
          ...state.books,
          [action.id]: { ...state.books[action.id], name: action.name },
        },
      };
    }

    case "setBookType": {
      const bk = state.books[action.id];
      // The built-in canvases can never be retyped (master is chapter, the
      // Master Topic Book is topic).
      if (!bk || isBuiltinBook(action.id) || bk.type === action.bookType)
        return state;
      return {
        ...state,
        books: {
          ...state.books,
          [action.id]: { ...bk, type: action.bookType },
        },
      };
    }

    case "setBookLocked": {
      const bk = state.books[action.id];
      // Built-ins are permanently locked — the Vault control renders
      // disabled for them, and the reducer refuses just in case.
      if (!bk || isBuiltinBook(action.id)) return state;
      if ((bk.locked === false) === (action.locked === false)) return state;
      return {
        ...state,
        books: {
          ...state.books,
          [action.id]: { ...bk, locked: action.locked !== false },
        },
      };
    }

    case "deleteBook": {
      const bkDel = state.books[action.id];
      // SCR-71: a locked book (locked !== false — absence means locked) can
      // never be deleted, no matter which surface asks. The only path is
      // Vault → unlock → delete.
      if (isBuiltinBook(action.id) || !bkDel || bkDel.locked !== false)
        return state;
      const books = { ...state.books };
      delete books[action.id];
      const order = state.order.filter((x) => x !== action.id);
      const activeId = state.activeId === action.id ? "master" : state.activeId;
      return { ...state, books, order, activeId, past: [], future: [] };
    }

    case "importStudy": {
      const books = {
        ...state.books,
        [state.activeId]: {
          ...active,
          marks: action.marks.slice(),
          colorLabels: { ...action.colorLabels },
          notes: { ...action.notes },
          lastStudiedAt: Date.now(),
        },
      };
      return {
        ...state,
        books,
        past: [...state.past, active.marks].slice(-HISTORY_CAP),
        future: [],
      };
    }

    case "freezeChapter": {
      const prefix = action.prefix + ":";
      let changed = false;
      const nextMarks = active.marks.map((m) => {
        if (m.label !== undefined) return m;
        if (!m.reference.startsWith(prefix)) return m;
        const lbl = (active.colorLabels[m.color] || "").trim();
        if (!lbl) return m;
        changed = true;
        return { ...m, label: lbl };
      });
      if (!changed) return state;
      const books = {
        ...state.books,
        [state.activeId]: {
          ...active,
          marks: nextMarks,
          lastStudiedAt: Date.now(),
        },
      };
      return {
        ...state,
        books,
        past: [...state.past, active.marks].slice(-HISTORY_CAP),
        future: [],
      };
    }

    case "twoCanvasMigrate": {
      const books = { ...state.books };
      const order = [...state.order];
      let changed = false;

      // Retype keyword-hosting session books in place — no data movement.
      action.retypes.forEach((id) => {
        const bk = books[id];
        if (!bk || id === "master" || bk.type === "topic") return;
        books[id] = { ...bk, type: "topic" };
        changed = true;
      });

      // Verified move per study: ensure topic book → copy → verify → clear
      // source marks with tombstones. Interruption-safe: a re-run copies
      // nothing new (union by id), re-verifies, and re-completes harmlessly.
      action.moves.forEach((mv) => {
        if (mv.sourceId === mv.targetId) return;
        const source = books[mv.sourceId];
        const refSet = new Set(mv.refs);

        // Ensure the deterministic topic book (id derived from the study id,
        // so two devices running independently produce identical books).
        let target: StudyBook = books[mv.targetId] || {
          id: mv.targetId,
          name: mv.targetName,
          type: "topic" as BookType,
          marks: [],
          colorLabels: defaultLabels(),
          notes: {},
          scopedLabels: {},
          scopedMigrated: true,
          scopedRoles: {},
          createdAt: Date.now(),
          lastStudiedAt: Date.now(),
        };
        if (!target.type) target = { ...target, type: "topic" };

        const moving = source
          ? source.marks.filter((m) => refSet.has(m.reference))
          : [];
        const haveIds = new Set(target.marks.map((m) => m.id));
        const newTargetMarks = [
          ...target.marks,
          ...moving.filter((m) => !haveIds.has(m.id)),
        ];

        // Palette: the study's per-scope theme names travel (fill target
        // blanks only), and the source's book-level labels fill the target's
        // blanks so moved marks still read correctly through the fallback.
        const srcScoped = source?.scopedLabels?.[mv.scope];
        const tgtScopedAll = { ...(target.scopedLabels || {}) };
        if (srcScoped && !tgtScopedAll[mv.scope])
          tgtScopedAll[mv.scope] = { ...srcScoped };
        const mergedLabels: Record<number, string> = {
          ...(source ? source.colorLabels : {}),
        };
        Object.keys(target.colorLabels || {}).forEach((k) => {
          const kn = Number(k);
          if ((target.colorLabels[kn] || "").trim() !== "")
            mergedLabels[kn] = target.colorLabels[kn];
        });

        // Notes on the study's verses: copy without clobbering.
        const tgtNotes = { ...target.notes };
        if (source) {
          Object.keys(source.notes || {}).forEach((k) => {
            const ref = k.split("|").pop();
            if (ref && refSet.has(ref) && !(k in tgtNotes))
              tgtNotes[k] = source.notes[k];
          });
        }

        // Relational data (roles incl. lens/pins/threads) for the scope.
        const srcRoles = source?.scopedRoles?.[mv.scope];
        const tgtRolesAll = { ...(target.scopedRoles || {}) };
        if (srcRoles && !tgtRolesAll[mv.scope])
          tgtRolesAll[mv.scope] = srcRoles;

        // VERIFY on the computed next state: every moving mark landed (by
        // id), and the palette made it across. Failure = skip the whole move
        // with nothing removed; a later run re-completes it.
        const landedIds = new Set(newTargetMarks.map((m) => m.id));
        const marksOk = moving.every((m) => landedIds.has(m.id));
        const paletteOk = !srcScoped || !!tgtScopedAll[mv.scope];
        if (!marksOk || !paletteOk) return;

        books[mv.targetId] = {
          ...target,
          marks: newTargetMarks,
          tombstones: diffTombstones(
            target.marks,
            newTargetMarks,
            target.tombstones
          ),
          colorLabels: mergedLabels,
          notes: tgtNotes,
          scopedLabels: tgtScopedAll,
          scopedRoles: tgtRolesAll,
        };
        if (!order.includes(mv.targetId)) order.push(mv.targetId);

        // Clear the source marks WITH tombstones — unconditionally safe via
        // the "one set of marks per verse per book" invariant.
        if (source && moving.length) {
          const newSourceMarks = source.marks.filter(
            (m) => !refSet.has(m.reference)
          );
          books[mv.sourceId] = {
            ...source,
            marks: newSourceMarks,
            tombstones: diffTombstones(
              source.marks,
              newSourceMarks,
              source.tombstones
            ),
          };
        }
        changed = true;
      });

      if (!changed) return state;
      // A cross-book bulk move invalidates the active book's undo history.
      return { ...state, books, order, past: [], future: [] };
    }

    case "mergeRemoteBooks": {
      // Live merge of a remote books snapshot — no reload. Union marks by id so
      // marks in progress on THIS device are never lost, and remote-only marks
      // (from another device) get added. Theme names + notes fill blanks only.
      // Idempotent: if nothing actually changed, the SAME state is returned so
      // two open devices don't ping-pong endless syncs.
      let remote: any;
      try {
        remote = JSON.parse(action.json);
      } catch {
        return state;
      }
      const rbooks = remote && remote.books ? remote.books : null;
      if (!rbooks || typeof rbooks !== "object") return state;
      const books = { ...state.books };
      const order = [...state.order];
      let changed = false;
      Object.keys(rbooks).forEach((id) => {
        const rb = rbooks[id];
        if (!rb) return;
        const rmarks: Mark[] = Array.isArray(rb.marks) ? rb.marks : [];
        const rTomb =
          rb.tombstones && typeof rb.tombstones === "object"
            ? (rb.tombstones as Record<string, number>)
            : {};
        const local = books[id];
        if (!local) {
          const cleanTomb = gcTombstones(rTomb);
          const cleanMarks = rmarks.filter((m) => m && cleanTomb[m.id] == null);
          const rColorLabels = { ...defaultLabels(), ...(rb.colorLabels || {}) };
          books[id] = {
            id,
            name:
              rb.name || (id === "master" ? "Master Chapter Book" : "Session"),
            type: asBookType(rb.type),
            // SCR-71: adopt the remote lock state; anything but an explicit
            // false lands locked (the default).
            locked: rb.locked === false ? false : true,
            marks: cleanMarks,
            colorLabels: rColorLabels,
            notes: rb.notes && typeof rb.notes === "object" ? rb.notes : {},
            tombstones: cleanTomb,
            scopedLabels:
              rb.scopedLabels && typeof rb.scopedLabels === "object"
                ? rb.scopedLabels
                : migrateScopedLabels(cleanMarks, rColorLabels, undefined),
            scopedMigrated: true,
            scopedRoles:
              rb.scopedRoles && typeof rb.scopedRoles === "object"
                ? rb.scopedRoles
                : {},
            createdAt:
              typeof rb.createdAt === "number" ? rb.createdAt : Date.now(),
            lastStudiedAt:
              typeof rb.lastStudiedAt === "number"
                ? rb.lastStudiedAt
                : Date.now(),
          };
          if (!order.includes(id)) order.push(id);
          changed = true;
          return;
        }
        // Merge tombstones (newest deletion per id wins), then drop expired ones.
        const localTomb = local.tombstones || {};
        const mergedTombRaw: Record<string, number> = { ...localTomb };
        Object.keys(rTomb).forEach((tid) => {
          const rt = rTomb[tid];
          if (
            typeof rt === "number" &&
            (mergedTombRaw[tid] == null || rt > mergedTombRaw[tid])
          )
            mergedTombRaw[tid] = rt;
        });
        const mergedTomb = gcTombstones(mergedTombRaw);
        const tombChanged =
          Object.keys(mergedTomb).length !== Object.keys(localTomb).length ||
          Object.keys(mergedTomb).some((tid) => mergedTomb[tid] !== localTomb[tid]);
        // Union marks by id, then remove any that are tombstoned (deletions win).
        const haveIds = new Set(local.marks.map((m) => m.id));
        const added = rmarks.filter((m) => m && !haveIds.has(m.id));
        const finalMarks = (
          added.length ? local.marks.concat(added) : local.marks
        ).filter((m) => mergedTomb[m.id] == null);
        const localIds = new Set(local.marks.map((m) => m.id));
        const marksChanged =
          finalMarks.length !== localIds.size ||
          finalMarks.some((m) => !localIds.has(m.id));
        let labels = local.colorLabels;
        let labelsChanged = false;
        Object.keys(rb.colorLabels || {}).forEach((k) => {
          const cur = (local.colorLabels[k as any] || "").trim();
          if (!cur && rb.colorLabels[k]) {
            if (!labelsChanged) {
              labels = { ...local.colorLabels };
              labelsChanged = true;
            }
            labels[k as any] = rb.colorLabels[k];
          }
        });
        let notes = local.notes;
        let notesChanged = false;
        Object.keys(rb.notes || {}).forEach((k) => {
          // Adopt a remote note only for a key we've never had, and only when
          // it's non-empty. A note the user cleared stays "" locally and is not
          // resurrected from the cloud copy.
          if (!(k in local.notes) && String(rb.notes[k] || "").trim()) {
            if (!notesChanged) {
              notes = { ...local.notes };
              notesChanged = true;
            }
            notes[k] = rb.notes[k];
          }
        });
        // Merge per-chapter theme names — fill blanks only, per scope+color.
        let scoped = local.scopedLabels || {};
        let scopedChanged = false;
        const rScoped =
          rb.scopedLabels && typeof rb.scopedLabels === "object"
            ? rb.scopedLabels
            : {};
        Object.keys(rScoped).forEach((s) => {
          const rMap = rScoped[s] || {};
          Object.keys(rMap).forEach((k) => {
            const rName = (rMap[k] || "").trim();
            if (!rName) return;
            const cur = ((scoped[s] || {})[k as any] || "").trim();
            if (!cur) {
              if (!scopedChanged) {
                scoped = { ...scoped };
                scopedChanged = true;
              }
              scoped[s] = { ...(scoped[s] || {}), [k as any]: rMap[k] };
            }
          });
        });
        // Merge relational roles — newest write per scope wins, so a change on
        // either device propagates (names use fill-blanks; roles get replaced).
        let scopedRoles = local.scopedRoles || {};
        let rolesChanged = false;
        const rRoles =
          rb.scopedRoles && typeof rb.scopedRoles === "object"
            ? rb.scopedRoles
            : {};
        Object.keys(rRoles).forEach((s) => {
          const r = rRoles[s];
          if (!r || typeof r.at !== "number") return;
          const cur = scopedRoles[s];
          if (!cur || r.at > (cur.at || 0)) {
            if (!rolesChanged) {
              scopedRoles = { ...scopedRoles };
              rolesChanged = true;
            }
            scopedRoles[s] = r;
          }
        });
        // Book type: fill-blank only — an untyped local book adopts the type
        // the other device stamped (migration/retype), but a type set locally
        // is never overwritten. The migration is deterministic, so two typed
        // copies always agree.
        const remoteType = asBookType(rb.type);
        const typeChanged = !local.type && !!remoteType;
        // SCR-71: locked wins on merge — the book stays unlocked only when
        // BOTH copies are explicitly unlocked. Unlock is ephemeral (Vault
        // auto-re-locks), so a remote copy re-locking mid-unlock is safe.
        const lockChanged = local.locked === false && rb.locked !== false;
        if (
          marksChanged ||
          labelsChanged ||
          notesChanged ||
          tombChanged ||
          scopedChanged ||
          rolesChanged ||
          typeChanged ||
          lockChanged
        ) {
          books[id] = {
            ...local,
            type: typeChanged ? remoteType : local.type,
            locked: lockChanged ? true : local.locked,
            marks: finalMarks,
            colorLabels: labels,
            notes,
            tombstones: mergedTomb,
            scopedLabels: scoped,
            scopedRoles,
          };
          changed = true;
        }
      });
      if (!changed) return state; // unchanged — no re-render / persist / push
      return { ...state, books, order };
    }

    case "setLabel":
      return {
        ...state,
        books: {
          ...state.books,
          [state.activeId]: {
            ...active,
            colorLabels: {
              ...active.colorLabels,
              [action.color]: action.label,
            },
          },
        },
      };

    case "setNote":
      return {
        ...state,
        books: {
          ...state.books,
          [state.activeId]: {
            ...active,
            notes: { ...active.notes, [action.key]: action.text },
          },
        },
      };

    case "setScopedLabel": {
      const cur = active.scopedLabels || {};
      const curScope = cur[action.scope] || {};
      if ((curScope[action.color] || "") === action.label) return state;
      return {
        ...state,
        books: {
          ...state.books,
          [state.activeId]: {
            ...active,
            scopedLabels: {
              ...cur,
              [action.scope]: { ...curScope, [action.color]: action.label },
            },
          },
        },
      };
    }

    case "setScopedLabelIn": {
      const bk = state.books[action.bookId];
      if (!bk) return state;
      const cur = bk.scopedLabels || {};
      const curScope = cur[action.scope] || {};
      if ((curScope[action.color] || "") === action.label) return state;
      return {
        ...state,
        books: {
          ...state.books,
          [action.bookId]: {
            ...bk,
            scopedLabels: {
              ...cur,
              [action.scope]: { ...curScope, [action.color]: action.label },
            },
          },
        },
      };
    }

    case "seedScopeLabels": {
      const cur = active.scopedLabels || {};
      const curScope = cur[action.scope] || {};
      const nextScope = { ...curScope };
      let changed = false;
      Object.keys(action.labels).forEach((k) => {
        const c = Number(k);
        const name = (action.labels[c] || "").trim();
        // fill blanks only — never clobber a name this scope already has
        if (name && !(curScope[c] || "").trim()) {
          nextScope[c] = name;
          changed = true;
        }
      });
      if (!changed) return state;
      return {
        ...state,
        books: {
          ...state.books,
          [state.activeId]: {
            ...active,
            scopedLabels: { ...cur, [action.scope]: nextScope },
          },
        },
      };
    }

    case "setScopedRoles": {
      const cur = active.scopedRoles || {};
      return {
        ...state,
        books: {
          ...state.books,
          [state.activeId]: {
            ...active,
            scopedRoles: {
              ...cur,
              [action.scope]: {
                at: Date.now(),
                roles: action.roles,
                lens: cur[action.scope]?.lens,
                pins: cur[action.scope]?.pins,
                threads: cur[action.scope]?.threads,
              },
            },
          },
        },
      };
    }
    case "setScopedLens": {
      const cur = active.scopedRoles || {};
      return {
        ...state,
        books: {
          ...state.books,
          [state.activeId]: {
            ...active,
            scopedRoles: {
              ...cur,
              [action.scope]: {
                at: Date.now(),
                roles: cur[action.scope]?.roles || {},
                lens: action.lens,
                pins: cur[action.scope]?.pins,
                threads: cur[action.scope]?.threads,
              },
            },
          },
        },
      };
    }
    case "setScopedThreads": {
      const cur = active.scopedRoles || {};
      return {
        ...state,
        books: {
          ...state.books,
          [state.activeId]: {
            ...active,
            scopedRoles: {
              ...cur,
              [action.scope]: {
                at: Date.now(),
                roles: cur[action.scope]?.roles || {},
                lens: cur[action.scope]?.lens,
                pins: cur[action.scope]?.pins,
                threads: action.threads,
              },
            },
          },
        },
      };
    }
    case "setScopedPins": {
      const cur = active.scopedRoles || {};
      return {
        ...state,
        books: {
          ...state.books,
          [state.activeId]: {
            ...active,
            scopedRoles: {
              ...cur,
              [action.scope]: {
                at: Date.now(),
                roles: cur[action.scope]?.roles || {},
                lens: cur[action.scope]?.lens,
                pins: action.pins,
                threads: cur[action.scope]?.threads,
              },
            },
          },
        },
      };
    }

    default:
      return state;
  }
}

export function useMarks() {
  const [state, dispatch] = useReducer(reducer, undefined, initState);

  useEffect(() => {
    // Ephemeral books (the first-run walkthrough's throwaway demo) are never
    // written to storage — and because the cloud push serializes this same blob,
    // that also keeps them out of sync. So the tour's demo marks can't persist
    // locally or reach another device. Everything else saves exactly as before.
    const persistBooks: Record<string, StudyBook> = {};
    Object.keys(state.books).forEach((id) => {
      if (!state.books[id].ephemeral) persistBooks[id] = state.books[id];
    });
    const persistOrder = state.order.filter((id) => persistBooks[id]);
    const persistActive = persistBooks[state.activeId]
      ? state.activeId
      : "master";
    safeSet(
      "scribal_books_v1",
      JSON.stringify({
        books: persistBooks,
        order: persistOrder,
        activeId: persistActive,
      })
    );
  }, [state.books, state.order, state.activeId]);

  const active = state.books[state.activeId] || state.books["master"];

  const addMark = useCallback(
    (
      reference: string,
      verseText: string,
      markedText: string,
      startIndex: number,
      endIndex: number,
      style: MarkStyle,
      color: MarkColor
    ) =>
      dispatch({
        type: "add",
        reference,
        verseText,
        markedText,
        startIndex,
        endIndex,
        style,
        color,
      }),
    []
  );
  const deleteMark = useCallback(
    (id: string) => dispatch({ type: "deleteMark", id }),
    []
  );
  const addMarks = useCallback(
    (
      items: {
        reference: string;
        verseText: string;
        markedText: string;
        startIndex: number;
        endIndex: number;
        style: MarkStyle;
        color: MarkColor;
      }[]
    ) => dispatch({ type: "addMany", items }),
    []
  );
  const deleteMarks = useCallback(
    (ids: string[]) => dispatch({ type: "deleteMany", ids }),
    []
  );
  // Book-targeted marking for the Study Table panel: add marks to a specific
  // book (each verse marked in the book its card belongs to), and erase one.
  const addMarksToBook = useCallback(
    (
      bookId: string,
      items: {
        reference: string;
        verseText: string;
        markedText: string;
        startIndex: number;
        endIndex: number;
        style: MarkStyle;
        color: MarkColor;
      }[]
    ) => dispatch({ type: "addManyTo", bookId, items }),
    []
  );
  const deleteMarkInBook = useCallback(
    (bookId: string, id: string) =>
      dispatch({ type: "deleteMarkIn", bookId, id }),
    []
  );
  const setScopedLabelInBook = useCallback(
    (bookId: string, scope: string, color: MarkColor, label: string) =>
      dispatch({ type: "setScopedLabelIn", bookId, scope, color, label }),
    []
  );
  const recolorMark = useCallback(
    (id: string, color: MarkColor) =>
      dispatch({ type: "recolorMark", id, color }),
    []
  );

  const updateMarkRange = useCallback(
    (
      id: string,
      startIndex: number,
      endIndex: number,
      markedText: string,
      history = true
    ) =>
      dispatch({
        type: "updateMarkRange",
        id,
        startIndex,
        endIndex,
        markedText,
        history,
      }),
    []
  );
  const deleteMarkGroup = useCallback(
    (reference: string, color: MarkColor) =>
      dispatch({ type: "deleteGroup", reference, color }),
    []
  );
  const clearMarks = useCallback(
    (refs: string[]) => dispatch({ type: "clearMarks", refs }),
    []
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const setColorLabel = useCallback(
    (color: MarkColor, label: string) =>
      dispatch({ type: "setLabel", color, label }),
    []
  );
  const setScopedLabel = useCallback(
    (scope: string, color: MarkColor, label: string) =>
      dispatch({ type: "setScopedLabel", scope, color, label }),
    []
  );
  const seedScopeLabels = useCallback(
    (scope: string, labels: Record<number, string>) =>
      dispatch({ type: "seedScopeLabels", scope, labels }),
    []
  );
  const setScopedRoles = useCallback(
    (scope: string, roles: Record<string, { a: number; b: number }>) =>
      dispatch({ type: "setScopedRoles", scope, roles }),
    []
  );
  const setScopedThreads = useCallback(
    (scope: string, threads: Record<string, { a: string | string[]; b: string | string[] }[]>) =>
      dispatch({ type: "setScopedThreads", scope, threads }),
    []
  );
  const setScopedPins = useCallback(
    (scope: string, pins: Record<string, string[]>) =>
      dispatch({ type: "setScopedPins", scope, pins }),
    []
  );
  const setScopedLens = useCallback(
    (scope: string, lens: string) =>
      dispatch({ type: "setScopedLens", scope, lens }),
    []
  );
  const setNote = useCallback(
    (key: string, text: string) => dispatch({ type: "setNote", key, text }),
    []
  );
  const setActiveBook = useCallback(
    (id: string) => dispatch({ type: "setActive", id }),
    []
  );
  const createSession = useCallback(
    (name: string, ephemeral = false, bookType?: BookType) => {
      const id = "session_" + Date.now() + "_" + rand();
      dispatch({ type: "createSession", id, name, ephemeral, bookType });
      return id;
    },
    []
  );

  const ensureBook = useCallback(
    (id: string, name: string, bookType?: BookType) =>
      dispatch({ type: "ensureBook", id, name, bookType }),
    []
  );

  const setBookType = useCallback(
    (id: string, bookType: BookType) =>
      dispatch({ type: "setBookType", id, bookType }),
    []
  );

  // SCR-70: the two halves of a verified chapter transfer.
  const copyChapters = useCallback(
    (sourceId: string, targetId: string, refs: string[], scopes: string[]) =>
      dispatch({ type: "copyChapters", sourceId, targetId, refs, scopes }),
    []
  );
  const clearChapters = useCallback(
    (
      bookId: string,
      refs: string[],
      scopes: string[],
      keepScopeEntries: boolean
    ) =>
      dispatch({
        type: "clearChapters",
        bookId,
        refs,
        scopes,
        keepScopeEntries,
      }),
    []
  );
  const absorb = useCallback(
    (targetId: string, sourceId: string, refs: string[]) =>
      dispatch({ type: "absorb", targetId, sourceId, refs }),
    []
  );
  const moveStudyMarks = useCallback(
    (sourceId: string, targetId: string, refs: string[], scope: string) =>
      dispatch({ type: "moveStudyMarks", sourceId, targetId, refs, scope }),
    []
  );

  const importStudy = useCallback(
    (
      m: Mark[],
      labels: Record<number, string>,
      ns: Record<string, string>
    ) => dispatch({ type: "importStudy", marks: m, colorLabels: labels, notes: ns }),
    []
  );

  const freezeChapter = useCallback(
    (prefix: string) => dispatch({ type: "freezeChapter", prefix }),
    []
  );

  const mergeRemoteBooks = useCallback(
    (json: string) => dispatch({ type: "mergeRemoteBooks", json }),
    []
  );
  const twoCanvasMigrate = useCallback(
    (
      retypes: string[],
      moves: {
        sourceId: string;
        targetId: string;
        targetName: string;
        refs: string[];
        scope: string;
      }[]
    ) => dispatch({ type: "twoCanvasMigrate", retypes, moves }),
    []
  );
  const renameBook = useCallback(
    (id: string, name: string) => dispatch({ type: "rename", id, name }),
    []
  );
  // SCR-71: flip a book's lock. Only the Vault surfaces this; the reducer
  // refuses it for built-ins either way.
  const setBookLocked = useCallback(
    (id: string, locked: boolean) =>
      dispatch({ type: "setBookLocked", id, locked }),
    []
  );
  const deleteBook = useCallback(
    (id: string) => dispatch({ type: "deleteBook", id }),
    []
  );

  const getBook = useCallback(
    (id: string) => {
      const b = state.books[id];
      if (!b)
        return {
          marks: [] as Mark[],
          colorLabels: defaultLabels(),
          scopedLabels: {} as Record<string, Record<number, string>>,
          notes: {} as Record<string, string>,
          name: "",
          type: undefined as BookType | undefined,
        };
      return {
        marks: b.marks,
        colorLabels: b.colorLabels,
        scopedLabels: (b.scopedLabels || {}) as Record<
          string,
          Record<number, string>
        >,
        notes: b.notes,
        name: b.name,
        type: id === "master" ? ("chapter" as BookType) : b.type,
      };
    },
    [state.books]
  );

  return {
    marks: active.marks,
    colorLabels: active.colorLabels,
    notes: active.notes,
    addMark,
    deleteMark,
    addMarks,
    deleteMarks,
    addMarksToBook,
    deleteMarkInBook,
    setScopedLabelInBook,
    recolorMark,
    updateMarkRange,
    deleteMarkGroup,
    clearMarks,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    setColorLabel,
    setScopedLabel,
    seedScopeLabels,
    setScopedRoles,
    setScopedLens,
    setScopedPins,
    setScopedThreads,
    scopedLabels: active.scopedLabels || EMPTY_SCOPED_LABELS,
    scopedRoles: (() => {
      const src = active.scopedRoles || {};
      const out: Record<string, Record<string, { a: number; b: number }>> = {};
      Object.keys(src).forEach((k) => {
        out[k] = src[k].roles;
      });
      return out;
    })(),
    scopedLens: (() => {
      const src = active.scopedRoles || {};
      const out: Record<string, string> = {};
      Object.keys(src).forEach((k) => {
        if (src[k].lens) out[k] = src[k].lens as string;
      });
      return out;
    })(),
    scopedPins: (() => {
      const src = active.scopedRoles || {};
      const out: Record<string, Record<string, string[]>> = {};
      Object.keys(src).forEach((k) => {
        if (src[k].pins) out[k] = src[k].pins as Record<string, string[]>;
      });
      return out;
    })(),
    scopedThreads: (() => {
      const src = active.scopedRoles || {};
      const out: Record<
        string,
        Record<string, { a: string | string[]; b: string | string[] }[]>
      > = {};
      Object.keys(src).forEach((k) => {
        if (src[k].threads) out[k] = src[k].threads!;
      });
      return out;
    })(),
    setNote,
    books: state.order.map((id) => ({
      id,
      name: state.books[id].name,
      isMaster: id === "master",
      // Master is treated as chapter-typed everywhere the type is consulted;
      // untyped pre-migration session books surface undefined (behave as today).
      type: id === "master" ? ("chapter" as BookType) : state.books[id].type,
      // SCR-71: resolved lock state (absence means locked).
      locked: state.books[id].locked !== false,
      markCount: state.books[id].marks.length,
      createdAt: state.books[id].createdAt,
      lastStudiedAt: state.books[id].lastStudiedAt,
    })),
    allMarks: (() => {
      const out: {
        bookId: string;
        bookName: string;
        isMaster: boolean;
        reference: string;
        color: MarkColor;
        markedText: string;
        label: string;
      }[] = [];
      state.order.forEach((id) => {
        const bk = state.books[id];
        bk.marks.forEach((m) => {
          out.push({
            bookId: id,
            bookName: bk.name,
            isMaster: id === "master",
            reference: m.reference,
            color: m.color,
            markedText: m.markedText,
            label: bk.colorLabels[m.color] || "",
          });
        });
      });
      return out;
    })(),
    activeBookId: state.activeId,
    activeBookName: active.name,
    isMasterActive: state.activeId === "master",
    // Ephemeral books (the guided tour's throwaway book) are fully isolated:
    // never persisted, never synced — and shells use this flag to keep the
    // user's real structures (like chapter-link groups) out of them (SCR-19).
    isEphemeralActive: !!active.ephemeral,
    setActiveBook,
    createSession,
    renameBook,
    setBookType,
    setBookLocked,
    deleteBook,
    getBook,
    ensureBook,
    absorb,
    copyChapters,
    clearChapters,
    moveStudyMarks,
    importStudy,
    freezeChapter,
    mergeRemoteBooks,
    twoCanvasMigrate,
  };
}
