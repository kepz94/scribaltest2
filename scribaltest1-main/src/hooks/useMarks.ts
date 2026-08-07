import { useReducer, useEffect, useCallback } from "react";
import { Mark, MarkStyle, MarkColor } from "../types";

// Stable fallback for books without scopedLabels. An inline `|| {}` mints a
// new object identity every render, which the shells' syncData effects read
// as "data changed" — one ingredient of the SCR-10 idle write loop.
const EMPTY_SCOPED_LABELS: Record<string, Record<number, string>> = {};

export interface StudyBook {
  id: string;
  name: string;
  // SCR-93 book lock: a locked book cannot be deleted by ANY caller — the
  // reducer refuses. ABSENCE MEANS LOCKED (locked is the default for new
  // books and for every pre-update book), and only an explicit false is
  // unlocked. Unlock lives in the Vault and auto-re-locks, so false is
  // always short-lived.
  locked?: boolean;
  marks: Mark[];
  colorLabels: Record<number, string>;
  notes: Record<string, string>;
  // When each note was last written. Notes used to merge "fill blanks only":
  // a key that already existed locally could never be replaced by the cloud
  // copy, so a synthesis started on the phone and finished on the desktop
  // stayed a first paragraph on the phone forever. A stamp makes the merge
  // last-write-wins, and lets a cleared note stay cleared without needing the
  // old rule that caused it.
  noteAt?: Record<string, number>;
  // When each note was deliberately CLEARED. A stamp alone cannot be trusted to
  // carry a deletion: last-write-wins on `noteAt` means any empty write — a
  // stale editor saving blank, a clock running ahead — erases real text on every
  // device at once. Only a key recorded here is allowed to beat a non-empty
  // note, so an accidental blank stays local and losable, never global and
  // permanent.
  noteDel?: Record<string, number>;
  // Deleted mark ids → when they were deleted, so deletions propagate across
  // devices instead of an old copy resurrecting them on the next sync.
  tombstones?: Record<string, number>;
  // Theme names per study scope (chapter title, e.g. "1 Nephi 2"). Each chapter
  // keeps its own palette so naming one chapter never touches another.
  scopedLabels?: Record<string, Record<number, string>>;
  // One-time flag: have we seeded scopedLabels from the old book-level palette?
  scopedMigrated?: boolean;
  // Per-study-scope entries, last-write-wins via `at`. Kept on the book (not
  // localStorage) so they sync across devices, same per-scope keying as
  // scopedLabels. The name is historical: this held the Relational view's
  // condition/promise roles, lens and threads, all removed with that view.
  // Outline's pinned lead verses live here and are the only remaining field.
  scopedRoles?: Record<
    string,
    {
      at: number;
      // Outline lead verses: per color, the refs the user pinned to the top of
      // that theme (in pin order).
      pins?: Record<string, string[]>;
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
  // Deleted books, by id, stamped when the delete happened. Books are the one
  // thing that used to be hard-deleted with no record, so the merge below —
  // which rebuilds any book that is remote-but-not-local — resurrected every
  // deletion the moment another device (or a stale cloud copy) synced back.
  // Same 90-day TTL as mark tombstones. Session ids are minted unique per
  // creation, so a tombstoned id is gone for good and no "was it re-created
  // after the delete?" comparison is needed.
  deletedBooks: Record<string, number>;
  // ═══ THE GLOBAL NOTES STORE ═══
  // Notes used to live inside whichever book was ACTIVE when they were written
  // (books[activeId].notes). That made a note's storage location depend on a
  // per-device pointer that deliberately does not sync — so two devices with
  // different active books each wrote to and read from a different book's map,
  // every byte synced perfectly, and the screens still disagreed forever
  // (Aug 7 2026: desktop showed an edit its phone could never see). It was the
  // fourth divergence bug in this area in a week, and every one traced to notes
  // being addressed by mutable context. This store is the structural fix:
  // ONE map for the whole account, keyed by content identity (scope / chapter /
  // verse), independent of books, with per-key stamps and deletion markers so
  // last-write-wins actually converges. Books' embedded notes survive on disk
  // as a legacy substrate — never written again, harvested on load AND on merge
  // (a device on an older build still writes there, and a strip that runs in
  // only one place does not hold — see stripRetiredScopeFields above).
  notes: Record<string, string>;
  noteAt: Record<string, number>;
  noteDel: Record<string, number>;
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
  | {
      type: "installSharedBook";
      id: string;
      name: string;
      marks: Mark[];
      colorLabels: Record<number, string>;
      scopedLabels: Record<string, Record<number, string>>;
    }
  | { type: "rename"; id: string; name: string }
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
  | { type: "setScopedPins"; scope: string; pins: Record<string, string[]> }
  | { type: "setNote"; key: string; text: string }
  | { type: "ensureBook"; id: string; name: string }
  | { type: "absorb"; targetId: string; sourceId: string; refs: string[] }
  | {
      // SCR-94 copy phase: marks + per-verse notes + the scope entries
      // (scopedLabels/scopedRoles) for whole chapters, non-destructively.
      type: "copyChapters";
      sourceId: string;
      targetId: string;
      refs: string[];
      scopes: string[];
    }
  | {
      // SCR-94 clear phase — dispatched only after the copy is VERIFIED in
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
// Merge one book's notes with a remote copy — LAST-WRITE-WINS on the stamp.
//
// The old rule adopted a remote note only for a key the device had never seen.
// That cannot converge: once both devices had written the same key, neither
// could ever learn the other's newer text. A synthesis begun on the phone and
// finished on the desktop stayed a first paragraph on the phone permanently,
// and no amount of syncing would fix it.
//
// Pure, so the rule can be tested without a React tree.
export function mergeNotes(
  localNotes: Record<string, string>,
  localAt: Record<string, number>,
  remoteNotes: Record<string, string>,
  remoteAt: Record<string, number>,
  localDel: Record<string, number> = {},
  remoteDel: Record<string, number> = {}
): {
  notes: Record<string, string>;
  noteAt: Record<string, number>;
  noteDel: Record<string, number>;
  changed: boolean;
} {
  let notes = localNotes;
  let noteAt = localAt;
  let changed = false;
  const take = (k: string, at: number) => {
    if (!changed) {
      notes = { ...localNotes };
      noteAt = { ...localAt };
      changed = true;
    }
    notes[k] = remoteNotes[k];
    noteAt[k] = at;
  };
  // Deletion markers always merge forward (newest per key) so a clear keeps
  // defending itself on later syncs, exactly like a mark tombstone.
  let noteDel = localDel;
  let delChanged = false;
  Object.keys(remoteDel || {}).forEach((k) => {
    const rd = remoteDel[k];
    if (typeof rd !== "number") return;
    if (noteDel[k] == null || rd > noteDel[k]) {
      if (!delChanged) {
        noteDel = { ...localDel };
        delChanged = true;
      }
      noteDel[k] = rd;
    }
  });
  Object.keys(remoteNotes || {}).forEach((k) => {
    const rAt = remoteAt[k] || 0;
    const lAt = localAt[k] || 0;
    const rText = String(remoteNotes[k] || "");
    const lText = String(localNotes[k] || "");
    // Never seen it: take anything with content.
    if (!(k in localNotes)) {
      if (rText.trim()) take(k, rAt);
      return;
    }
    if (rText === lText) return;
    // An empty remote is only allowed to erase real text when the other device
    // RECORDED a deletion, and recorded it after our own last write. A newer
    // stamp is not enough — that rule let one stale blank editor erase a
    // synthesis everywhere, and clock skew between a phone and a desktop can
    // manufacture "newer" on its own.
    if (!rText.trim() && lText.trim()) {
      const rDel = remoteDel[k] || 0;
      if (rDel && rDel >= lAt) take(k, Math.max(rAt, rDel));
      return;
    }
    // Stamped on either side: newest wins.
    if (rAt > lAt) return take(k, rAt);
    if (rAt < lAt) return;
    // Neither side is stamped — both predate this build, so there is no honest
    // way to say which is newer. One-time reconciliation: take the longer text.
    // Between a first paragraph and the whole note, the whole note is what the
    // reader is missing, and nothing is destroyed to get it — the shorter copy
    // existed only on this device.
    if (rAt === 0 && lAt === 0 && rText.length > lText.length) take(k, 0);
  });
  return { notes, noteAt, noteDel, changed: changed || delChanged };
}

// Sweep every book's embedded notes into a global accumulator, under the same
// stamped merge rules as a device-to-device sync. Books are visited in sorted
// order so the result is deterministic. Pure and exported for tests.
export function harvestNotes(
  books: Record<string, { notes?: Record<string, string>; noteAt?: Record<string, number>; noteDel?: Record<string, number> }>,
  seedNotes: Record<string, string>,
  seedAt: Record<string, number>,
  seedDel: Record<string, number>
): {
  notes: Record<string, string>;
  noteAt: Record<string, number>;
  noteDel: Record<string, number>;
  changed: boolean;
} {
  let acc = { notes: seedNotes, noteAt: seedAt, noteDel: seedDel, changed: false };
  Object.keys(books)
    .sort()
    .forEach((id) => {
      const b = books[id];
      if (!b || !b.notes || typeof b.notes !== "object") return;
      const m = mergeNotes(
        acc.notes,
        acc.noteAt,
        b.notes,
        b.noteAt || {},
        acc.noteDel,
        b.noteDel || {}
      );
      acc = {
        notes: m.notes,
        noteAt: m.noteAt,
        noteDel: m.noteDel,
        changed: acc.changed || m.changed,
      };
    });
  return acc;
}

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

// Relational's condition/promise roles, lens and threads were removed with the
// view. Scope entries still carry them in stored and remote copies, so every
// entry is narrowed to { at, pins } on the way in — on load AND on merge.
// Stripping in only one place would not hold: the merge takes a remote entry
// whenever its `at` is newer, so a device on an older build would keep handing
// the dead fields back and they would never actually go away.
function stripRetiredScopeFields(
  sr: any
): Record<string, { at: number; pins?: Record<string, string[]> }> {
  const out: Record<string, { at: number; pins?: Record<string, string[]> }> = {};
  if (!sr || typeof sr !== "object") return out;
  Object.keys(sr).forEach((k) => {
    const e = sr[k];
    if (!e || typeof e !== "object") return;
    const kept: { at: number; pins?: Record<string, string[]> } = {
      at: typeof e.at === "number" ? e.at : 0,
    };
    if (e.pins && typeof e.pins === "object") kept.pins = e.pins;
    out[k] = kept;
  });
  return out;
}

function initState(): State {
  const saved = safeParse<any>(safeGet("scribal_books_v1"), null);
  if (saved && saved.books && saved.books.master) {
    const books: Record<string, StudyBook> = saved.books;
    // Deletions this device already knows about. Applied on load as well as on
    // merge, so a Vault restore of an older backup can't quietly reinstate a
    // book that was deleted after that backup was taken. "master" can never be
    // deleted, so it is never allowed to carry a tombstone.
    const deletedBooks = gcTombstones(
      saved.deletedBooks && typeof saved.deletedBooks === "object"
        ? saved.deletedBooks
        : {}
    );
    delete deletedBooks.master;
    Object.keys(deletedBooks).forEach((id) => {
      if (books[id]) delete books[id];
    });
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
        // Absent on anything written before note stamps existed; an unstamped
        // note reads as 0, which the merge treats as "predates this build".
        noteAt: b.noteAt && typeof b.noteAt === "object" ? b.noteAt : {},
        noteDel: b.noteDel && typeof b.noteDel === "object" ? b.noteDel : {},
        tombstones: gcTombstones(
          b.tombstones && typeof b.tombstones === "object" ? b.tombstones : {}
        ),
          scopedLabels,
        scopedMigrated: true,
        scopedRoles: stripRetiredScopeFields(b.scopedRoles),
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
    // Global notes: what was persisted at the root, plus a harvest of anything
    // still embedded in books — an older build's writes, or the first launch
    // after this store existed at all.
    const g = harvestNotes(
      books,
      saved.notes && typeof saved.notes === "object" ? saved.notes : {},
      saved.noteAt && typeof saved.noteAt === "object" ? saved.noteAt : {},
      saved.noteDel && typeof saved.noteDel === "object" ? saved.noteDel : {}
    );
    return {
      books,
      order,
      activeId,
      deletedBooks,
      notes: g.notes,
      noteAt: g.noteAt,
      noteDel: g.noteDel,
      past: [],
      future: [],
    };
  }
  const master = migrateMaster();
  const g = harvestNotes({ master }, {}, {}, {});
  return {
    books: { master },
    order: ["master"],
    activeId: "master",
    deletedBooks: {},
    notes: g.notes,
    noteAt: g.noteAt,
    noteDel: g.noteDel,
    past: [],
    future: [],
  };
}

// Exported for tests only. The book-deletion rules below have no pure module of
// their own and are exactly the kind of merge that looks right and silently
// loses data, so they get direct coverage (bookTombstone.test.ts).
export type MarksState = State;
export type MarksAction = Action;
export function reducer(state: State, action: Action): State {
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

    // A study table someone SENT (shareTable.ts) arrives whole, in a book of
    // its own. Deliberately not a merge into any existing book and deliberately
    // not `absorb`: the recipient's own marking must be unreachable from here,
    // which is the promise the share sheet makes. The new book does NOT become
    // active — the table's cards name it explicitly, and stealing the active
    // book would move the reader out from under someone mid-study.
    case "installSharedBook": {
      if (state.books[action.id]) return state;
      const book: StudyBook = {
        id: action.id,
        name: action.name,
        marks: action.marks,
        colorLabels: { ...defaultLabels(), ...action.colorLabels },
        notes: {},
        scopedLabels: action.scopedLabels,
        // The palette arrived already per-chapter, so there is nothing for the
        // book-level migration to seed.
        scopedMigrated: true,
        createdAt: Date.now(),
        lastStudiedAt: Date.now(),
      };
      return {
        ...state,
        books: { ...state.books, [action.id]: book },
        order: [...state.order, action.id],
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

    case "setBookLocked": {
      const bk = state.books[action.id];
      // Master is permanently locked — the Vault control renders disabled
      // for it, and the reducer refuses just in case.
      if (!bk || action.id === "master") return state;
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
      // SCR-93: a locked book (locked !== false — absence means locked) can
      // never be deleted, no matter which surface asks. The only path is
      // Vault → unlock → delete. Ephemeral walkthrough books are exempt:
      // they never persist or sync, never appear in the Vault, and the tour
      // must be able to clean its demo book up.
      if (action.id === "master" || !bkDel) return state;
      if (bkDel.locked !== false && !bkDel.ephemeral) return state;
      const books = { ...state.books };
      delete books[action.id];
      const order = state.order.filter((x) => x !== action.id);
      const activeId = state.activeId === action.id ? "master" : state.activeId;
      // Record the deletion so the merge can tell "deleted here" apart from
      // "not synced here yet" — without this the next inbound snapshot rebuilds
      // the book and the delete is lost silently. Ephemeral books never reach
      // storage or sync, so tombstoning one would be dead weight in the blob.
      const deletedBooks = bkDel.ephemeral
        ? state.deletedBooks
        : gcTombstones({ ...state.deletedBooks, [action.id]: Date.now() });
      return {
        ...state,
        books,
        order,
        activeId,
        deletedBooks,
        past: [],
        future: [],
      };
    }

    case "importStudy": {
      const books = {
        ...state.books,
        [state.activeId]: {
          ...active,
          marks: action.marks.slice(),
          colorLabels: { ...action.colorLabels },
          lastStudiedAt: Date.now(),
        },
      };
      // Imported notes land in the global store, stamped now — same door every
      // other note comes through.
      const impNotes = { ...state.notes };
      const impAt = { ...state.noteAt };
      const impDel = { ...state.noteDel };
      const now = Date.now();
      Object.keys(action.notes || {}).forEach((k) => {
        const t = action.notes[k];
        if (typeof t !== "string" || !t.trim()) return;
        impNotes[k] = t;
        impAt[k] = now;
        delete impDel[k];
      });
      return {
        ...state,
        books,
        notes: impNotes,
        noteAt: impAt,
        noteDel: impDel,
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
      let order = [...state.order];
      let changed = false;
      // Book deletions, both directions. Newest stamp per id wins, then expire
      // at the same 90 days as mark tombstones. A device that deleted a book
      // teaches every other device to drop it; a device that hasn't heard yet
      // keeps pushing the book up, and this is what stops that copy from
      // reinstating it here. "master" is undeletable, so it can never be
      // tombstoned no matter what a remote blob claims.
      const rDeleted =
        remote.deletedBooks && typeof remote.deletedBooks === "object"
          ? (remote.deletedBooks as Record<string, number>)
          : {};
      const mergedDelRaw: Record<string, number> = { ...state.deletedBooks };
      Object.keys(rDeleted).forEach((bid) => {
        const rt = rDeleted[bid];
        if (
          typeof rt === "number" &&
          (mergedDelRaw[bid] == null || rt > mergedDelRaw[bid])
        )
          mergedDelRaw[bid] = rt;
      });
      const deletedBooks = gcTombstones(mergedDelRaw);
      delete deletedBooks.master;
      const delChanged =
        Object.keys(deletedBooks).length !==
          Object.keys(state.deletedBooks).length ||
        Object.keys(deletedBooks).some(
          (bid) => deletedBooks[bid] !== state.deletedBooks[bid]
        );
      if (delChanged) changed = true;
      // Deletions learned from another device: drop those books here too.
      Object.keys(deletedBooks).forEach((bid) => {
        if (books[bid]) {
          delete books[bid];
          changed = true;
        }
      });
      Object.keys(rbooks).forEach((id) => {
        const rb = rbooks[id];
        if (!rb) return;
        // Deleted — and a session id is never reused, so this is permanent.
        if (deletedBooks[id] != null) return;
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
            // SCR-93: adopt the remote lock state; anything but an explicit
            // false lands locked (the default).
            locked: rb.locked === false ? false : true,
            marks: cleanMarks,
            colorLabels: rColorLabels,
            notes: rb.notes && typeof rb.notes === "object" ? rb.notes : {},
            noteAt:
              rb.noteAt && typeof rb.noteAt === "object" ? rb.noteAt : {},
            noteDel:
              rb.noteDel && typeof rb.noteDel === "object" ? rb.noteDel : {},
            tombstones: cleanTomb,
            scopedLabels:
              rb.scopedLabels && typeof rb.scopedLabels === "object"
                ? rb.scopedLabels
                : migrateScopedLabels(cleanMarks, rColorLabels, undefined),
            scopedMigrated: true,
            scopedRoles: stripRetiredScopeFields(rb.scopedRoles),
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
        const nm = mergeNotes(
          local.notes,
          local.noteAt || {},
          rb.notes || {},
          rb.noteAt || {},
          local.noteDel || {},
          rb.noteDel || {}
        );
        const notes = nm.notes;
        const noteAt = nm.noteAt;
        const noteDel = nm.noteDel;
        const notesChanged = nm.changed;
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
        let scopedRoles = stripRetiredScopeFields(local.scopedRoles);
        let rolesChanged = false;
        const rRoles =
          stripRetiredScopeFields(rb.scopedRoles);
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
        // SCR-93: locked wins on merge — the book stays unlocked only when
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
          lockChanged
        ) {
          books[id] = {
            ...local,
            locked: lockChanged ? true : local.locked,
            marks: finalMarks,
            colorLabels: labels,
            notes,
            noteAt,
            noteDel,
            tombstones: mergedTomb,
            scopedLabels: scoped,
            scopedRoles,
          };
          changed = true;
        }
      });
      // Global notes, two sources: the remote's own global store, then a
      // harvest of notes still embedded in its books — a device on an older
      // build writes only there, and skipping the harvest would silently drop
      // its edits. Tombstoned books are excluded so a deleted book's notes do
      // not ride back in through the harvest.
      let g = {
        notes: state.notes,
        noteAt: state.noteAt,
        noteDel: state.noteDel,
        changed: false,
      };
      const gm = mergeNotes(
        g.notes,
        g.noteAt,
        remote.notes && typeof remote.notes === "object" ? remote.notes : {},
        remote.noteAt && typeof remote.noteAt === "object" ? remote.noteAt : {},
        g.noteDel,
        remote.noteDel && typeof remote.noteDel === "object"
          ? remote.noteDel
          : {}
      );
      g = { notes: gm.notes, noteAt: gm.noteAt, noteDel: gm.noteDel, changed: gm.changed };
      const rbLive: Record<string, StudyBook> = {};
      Object.keys(rbooks).forEach((id) => {
        if (rbooks[id] && deletedBooks[id] == null) rbLive[id] = rbooks[id];
      });
      const gh = harvestNotes(rbLive, g.notes, g.noteAt, g.noteDel);
      const gChanged = g.changed || gh.changed;
      if (gChanged) changed = true;

      if (!changed) return state; // unchanged — no re-render / persist / push
      // A book dropped by a remote deletion has to leave `order` too, and can't
      // be left as the active book — that would strand the reader on a book
      // that no longer exists.
      order = order.filter((id) => books[id]);
      const activeId = books[state.activeId] ? state.activeId : "master";
      return {
        ...state,
        books,
        order,
        activeId,
        deletedBooks,
        notes: gh.notes,
        noteAt: gh.noteAt,
        noteDel: gh.noteDel,
      };
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

    case "setNote": {
      // Writes go to the GLOBAL store only — never into a book. The book maps
      // are a frozen legacy substrate from before the store existed; writing
      // them again would re-open the split this store was built to close.
      //
      // A save that changes nothing must not move the clock. The stamp decides
      // merges, so re-saving identical text used to hand this device a "newer"
      // copy of a note it had not actually edited — enough to win against a
      // real edit made elsewhere.
      const prevText = state.notes[action.key] || "";
      if (prevText === action.text) return state;
      const wasCleared = !!prevText.trim() && !action.text.trim();
      const noteDel = { ...state.noteDel };
      // Clearing text the user could actually see is a deliberate deletion and
      // earns the marker that lets it propagate. Writing blank over blank does
      // not, and neither does writing content — that revokes any old marker.
      if (wasCleared) noteDel[action.key] = Date.now();
      else if (action.text.trim()) delete noteDel[action.key];
      return {
        ...state,
        notes: { ...state.notes, [action.key]: action.text },
        noteAt: { ...state.noteAt, [action.key]: Date.now() },
        noteDel,
      };
    }

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
              [action.scope]: { at: Date.now(), pins: action.pins },
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
        // Rides the same blob the cloud push serializes, so a deletion travels
        // to the other devices instead of dying on the one that made it.
        deletedBooks: state.deletedBooks,
        // The global notes store rides the same blob too — one document, one
        // merge path, and a device on an older build simply ignores the extra
        // root fields.
        notes: state.notes,
        noteAt: state.noteAt,
        noteDel: state.noteDel,
      })
    );
  }, [
    state.books,
    state.order,
    state.activeId,
    state.deletedBooks,
    state.notes,
    state.noteAt,
    state.noteDel,
  ]);

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
  const setScopedPins = useCallback(
    (scope: string, pins: Record<string, string[]>) =>
      dispatch({ type: "setScopedPins", scope, pins }),
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

  // Mint a session-book id without creating anything. Same shape as
  // createSession's, so a shared book is indistinguishable from any other
  // session once it lands.
  const newSessionBookId = useCallback(
    () => "session_" + Date.now() + "_" + rand(),
    []
  );

  // Land a sent study table's marking in a book of its own.
  //
  // The caller mints the id (newSessionBookId) because the table's cards must
  // already name this book before the table is added — the id has to exist
  // before either write, so it cannot be minted in here.
  const installSharedBook = useCallback(
    (
      id: string,
      name: string,
      marks: Mark[],
      colorLabels: Record<number, string>,
      scopedLabels: Record<string, Record<number, string>>
    ) => {
      dispatch({
        type: "installSharedBook",
        id,
        name,
        marks,
        colorLabels,
        scopedLabels,
      });
    },
    []
  );

  // SCR-94: the two halves of a verified chapter transfer.
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
  const renameBook = useCallback(
    (id: string, name: string) => dispatch({ type: "rename", id, name }),
    []
  );
  // SCR-93: flip a book's lock. Only the Vault surfaces this; the reducer
  // refuses it for master either way.
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
        };
      return {
        marks: b.marks,
        colorLabels: b.colorLabels,
        scopedLabels: (b.scopedLabels || {}) as Record<
          string,
          Record<number, string>
        >,
        // Notes are global now — the same map whichever book is asked for, so
        // shares and Present rooms carry the notes the author actually sees.
        notes: state.notes,
        name: b.name,
      };
    },
    [state.books, state.notes]
  );

  return {
    marks: active.marks,
    colorLabels: active.colorLabels,
    // The global store: identical on every screen, every book, every device.
    notes: state.notes,
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
    setScopedPins,
    scopedLabels: active.scopedLabels || EMPTY_SCOPED_LABELS,
    scopedPins: (() => {
      const src = active.scopedRoles || {};
      const out: Record<string, Record<string, string[]>> = {};
      Object.keys(src).forEach((k) => {
        if (src[k].pins) out[k] = src[k].pins as Record<string, string[]>;
      });
      return out;
    })(),
    setNote,
    books: state.order.map((id) => ({
      id,
      name: state.books[id].name,
      isMaster: id === "master",
      // SCR-93: resolved lock state (absence means locked).
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
    setBookLocked,
    deleteBook,
    getBook,
    ensureBook,
    installSharedBook,
    newSessionBookId,
    absorb,
    copyChapters,
    clearChapters,
    moveStudyMarks,
    importStudy,
    freezeChapter,
    mergeRemoteBooks,
  };
}
