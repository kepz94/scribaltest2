import { useReducer, useEffect, useCallback } from "react";
import { Mark, MarkStyle, MarkColor } from "../types";

interface StudyBook {
  id: string;
  name: string;
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
  | { type: "createSession"; id: string; name: string; ephemeral?: boolean }
  | { type: "rename"; id: string; name: string }
  | { type: "deleteBook"; id: string }
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
  | { type: "setNote"; key: string; text: string }
  | { type: "ensureBook"; id: string; name: string }
  | { type: "absorb"; targetId: string; sourceId: string; refs: string[] }
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
    name: "Master Book",
    marks: Array.isArray(marks) ? marks : [],
    colorLabels: { ...defaultLabels(), ...labels },
    notes: notes && typeof notes === "object" ? notes : {},
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
        name: b.name || (id === "master" ? "Master Book" : "Session"),
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
    let order: string[] = Array.isArray(saved.order)
      ? saved.order.filter((id: string) => books[id])
      : [];
    Object.keys(books).forEach((id) => {
      if (!order.includes(id)) order.push(id);
    });
    order = ["master", ...order.filter((id) => id !== "master")];
    const activeId = books[saved.activeId] ? saved.activeId : "master";
    return { books, order, activeId, past: [], future: [] };
  }
  const master = migrateMaster();
  return {
    books: { master },
    order: ["master"],
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
      if (state.books[action.id]) return state; // already exists
      const book: StudyBook = {
        id: action.id,
        name: action.name,
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

    case "deleteBook": {
      if (action.id === "master" || !state.books[action.id]) return state;
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
            name: rb.name || (id === "master" ? "Master Book" : "Session"),
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
        if (
          marksChanged ||
          labelsChanged ||
          notesChanged ||
          tombChanged ||
          scopedChanged ||
          rolesChanged
        ) {
          books[id] = {
            ...local,
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
  const createSession = useCallback((name: string, ephemeral = false) => {
    const id = "session_" + Date.now() + "_" + rand();
    dispatch({ type: "createSession", id, name, ephemeral });
    return id;
  }, []);

  const ensureBook = useCallback(
    (id: string, name: string) => dispatch({ type: "ensureBook", id, name }),
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
  const renameBook = useCallback(
    (id: string, name: string) => dispatch({ type: "rename", id, name }),
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
    scopedLabels: active.scopedLabels || {},
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
    setNote,
    books: state.order.map((id) => ({
      id,
      name: state.books[id].name,
      isMaster: id === "master",
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
    setActiveBook,
    createSession,
    renameBook,
    deleteBook,
    getBook,
    ensureBook,
    absorb,
    moveStudyMarks,
    importStudy,
    freezeChapter,
    mergeRemoteBooks,
  };
}
