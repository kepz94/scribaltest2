import { useState, useCallback, useEffect, useRef } from "react";
import { ACCENT } from "../theme";
import {
  Mark,
  MarkColor,
  MarkStyle,
  Tool,
  WordTag,
  STYLE_POINTS,
  COLOR_MAP,
  markStyleCSS,
} from "../types";
import { mergedRunsFor } from "../outlineAssembly";
import {
  StudyTable,
  TablePurpose,
  TableCard,
  newCardId,
  isTablePromoted,
} from "../hooks/useStudyTables";
import { compiledCards } from "../outlineAssembly";
import type { Study } from "../hooks/useStudies";
import type { SearchStudy } from "../hooks/useSearchStudies";
import StudyTableColumn from "./StudyTableColumn";
import StudyTablePresent from "./StudyTablePresent";
import { richToPlain } from "./RichNoteField";
import {
  newRoomCode,
  createRoom,
  pushBeat,
  endRoom,
  joinUrl,
  themesKey,
  redactTableForRoom,
} from "../presentRoom";
import MarkedVerse from "./MarkedVerse";
import VersePicker from "./VersePicker";
import type { StudyMeta, StudyTheme } from "./VersePicker";
import type { ThemeMark } from "./SearchPanel";
import {
  getVerse,
  sortRefs,
  verseList,
  chapterLocFor,
  firstVerseRefOfScope,
} from "../data/verseIndex";
import VerseViewer from "./VerseViewer";

// The desktop home for Study Tables: a list of your tables, and the editor for
// one open table (its name, purpose, and the column surface). This owns the
// persistence hook and hands the open table's cards down to StudyTableColumn.
//
// The roomy three-zone chrome (outline rail + docked verse panel) layers on in
// the next steps; this is the working core — create, open, build, reorder,
// delete, persist.

interface Props {
  // Return to the reading view (the shell owns the actual mode switch).
  onClose: () => void;
  accent?: string;
  // Height of the app's sticky header, so the outline rail sticks just below it.
  headerOffset?: number;
  // Multi-book marks, passed from the shell (single source of truth):
  //  - allMarks: every mark across every book (theme preview + "My marks").
  //  - getBook: a specific book's full marks + theme labels, to render the chosen
  //    book's marking and resolve a study's theme names.
  //  - books: the book list, for the "Marks from" selector.
  allMarks: ThemeMark[];
  getBook: (id: string) => {
    marks: Mark[];
    colorLabels?: Record<number, string>;
    scopedLabels?: Record<string, Record<number, string>>;
  };
  books: { id: string; name: string; isMaster: boolean; markCount: number }[];
  // The user's studies (recorded chapter/linked + keyword) and the chapter-link
  // groups, so the verse panel can group a study's verses under its themes.
  recordedStudies: Study[];
  searchStudies: SearchStudy[];
  chapterGroups: Record<string, string>;
  // Tables + their persistence ops live in the shell now (single source of
  // truth), so the shell can also drop verses onto a table's shelf from the
  // reading panels and list tables in the Studies hub.
  tables: StudyTable[];
  createTable: (
    name?: string,
    purpose?: TablePurpose,
    bookId?: string
  ) => string;
  updateTable: (
    id: string,
    changes: Partial<
      Pick<
        StudyTable,
        "name" | "cards" | "purpose" | "shelf" | "studyId" | "promotedAt"
      >
    >
  ) => void;
  renameTable: (id: string, name: string) => void;
  deleteTable: (id: string) => void;
  // Create a new session book (for "start from scratch" → new session): the
  // shell owns useMarks, so book creation happens there. Returns the book id.
  createSession: (name: string) => string;
  // The Scripture dock's Read tab is a full reading surface — marking state
  // and mutations stay owned by App and arrive here as props (Kepu, Jul 23).
  selectedTool?: Tool;
  selectedColor?: MarkColor;
  onChangeTool?: (t: Tool) => void;
  onChangeColor?: (c: MarkColor) => void;
  addMarksToBook?: (
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
  ) => void;
  deleteMarkInBook?: (bookId: string, id: string) => void;
  onDefine?: (
    reference: string,
    verseText: string,
    start: number,
    end: number,
    word: string
  ) => void;
  // Tells App whether the dock's Read tab is up, so the global MarkingToolbar
  // shows/hides with it.
  onReadMarkingChange?: (active: boolean) => void;
  // Dictionary word-tags: rendered on scripture cards (and in Present via the
  // shared renderVerse); tapping one opens its definition.
  wordTags?: WordTag[];
  onTagTap?: (tag: WordTag) => void;
  // When set, open straight into this table (deep-link from the Studies hub);
  // the callback clears it once consumed.
  openTableId?: string | null;
  onConsumeOpenTable?: () => void;
  // Open the shell's marking panel for a set of verses (each carried with the
  // book it should be marked in). Used by "Mark verses" and per-card marking.
  onMarkVerses?: (
    refs: string[],
    refBook: Record<string, string>,
    title?: string
  ) => void;
  // Deliver mark arrivals to a table's tray (useStudyTables.addShelfArrivals);
  // the reconciliation effect calls it whenever scope verses are missing.
  addShelfArrivals?: (
    id: string,
    refs: string[],
    extras?: Partial<
      Pick<TableCard, "bookId" | "shelfGroup" | "shelfGroupColor">
    >
  ) => void;
  // Remove verses from a topic study (the tray's confirmed delete).
  onRemoveVersesFromStudy?: (studyId: string, refs: string[]) => void;
  // SCR-61: verses gathered through the dock join the topic study itself.
  onAddVersesToStudy?: (studyId: string, refs: string[]) => void;
  // Rename a theme where the compile reads it: useMarks.setScopedLabelInBook.
  // Renaming a compiled heading while live edits the theme, never the cards.
  setThemeLabel?: (
    bookId: string,
    scope: string,
    color: MarkColor,
    label: string
  ) => void;
}

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF =
  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif';

const PURPOSES: { p: TablePurpose; label: string }[] = [
  { p: "lesson", label: "Lesson" },
  { p: "talk", label: "Talk" },
  { p: "study", label: "Study" },
  { p: "open", label: "Open" },
];

function hexToRgba(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
}

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  return d + "d ago";
}

export default function StudyTablesDesktop({
  onClose,
  accent = ACCENT,
  headerOffset = 76,
  allMarks,
  getBook,
  books,
  recordedStudies,
  searchStudies,
  chapterGroups,
  tables,
  createTable,
  updateTable: updateTableReal,
  renameTable: renameTableReal,
  deleteTable: deleteTableReal,
  createSession,
  selectedTool,
  selectedColor,
  onChangeTool,
  onChangeColor,
  addMarksToBook,
  deleteMarkInBook,
  onDefine,
  onReadMarkingChange,
  wordTags,
  onTagTap,
  openTableId,
  onConsumeOpenTable,
  onMarkVerses,
  addShelfArrivals,
  onRemoveVersesFromStudy,
  onAddVersesToStudy,
  setThemeLabel,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  // Deep-link: when the shell asks for a specific table (a study opened via
  // Studies/Compile, or a send-sheet drop), open it and clear the request.
  // Entered this way, the back arrow returns to the READING screen (SCR-59) —
  // the tables list is only home when the user came from it.
  const [cameFromShell, setCameFromShell] = useState(false);
  useEffect(() => {
    if (openTableId) {
      setOpenId(openTableId);
      setCameFromShell(true);
      onConsumeOpenTable?.();
    }
  }, [openTableId]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // Save indicator: every edit persists instantly; this makes that visible.
  // Flashes "Saving…" → "Saved" whenever the open table's updatedAt moves.
  const [saveFlash, setSaveFlash] = useState(false);
  // The Scripture dock (Kepu, Jul 23): ONE fixed-left surface with Read and
  // Search tabs — the Reader dock and the verse-picker drawer consolidated.
  // Chapter tables are sealed to Read (ADR-007 §8).
  const [dock, setDock] = useState<null | { tab: "read" | "search" }>(null);
  // Read tab: the reading location, a one-shot verse to scroll to, and the
  // "Marks go to" book (was App's tableReader state).
  const [readLoc, setReadLoc] = useState<{ v: number; b: number; c: number }>({
    v: 0,
    b: 0,
    c: 0,
  });
  const [readJump, setReadJump] = useState<string | null>(null);
  const [readBookId, setReadBookId] = useState<string>("master");
  // Where the verse panel will drop cards: the chooser gap that opened it.
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  // New-table flow: choose blank vs. import; "book" picks the marks home for a
  // from-scratch table (master / a session / a brand-new named session).
  const [creating, setCreating] = useState<
    null | "choose" | "import" | "book"
  >(null);
  const [newSessionName, setNewSessionName] = useState("");
  // The "how it works" intro on the home — shown until dismissed.
  const [showIntro, setShowIntro] = useState(
    () => localStorage.getItem("scribal_tables_intro_seen") !== "1"
  );
  const dismissIntro = () => {
    setShowIntro(false);
    try {
      localStorage.setItem("scribal_tables_intro_seen", "1");
    } catch {}
  };
  // The example table is EPHEMERAL: it lives only in this state, is never
  // persisted or synced, never appears in any list, and vanishes on close.
  // These shadows route edits to it in-memory and everything else to the real
  // store — so every existing call site works unchanged for both.
  const [example, setExample] = useState<StudyTable | null>(null);
  const updateTable: typeof updateTableReal = (id, changes) => {
    if (example && id === example.id) {
      setExample((p) => (p ? { ...p, ...changes, updatedAt: Date.now() } : p));
      return;
    }
    updateTableReal(id, changes);
  };
  const renameTable: typeof renameTableReal = (id, name) => {
    if (example && id === example.id) {
      setExample((p) => (p ? { ...p, name } : p));
      return;
    }
    renameTableReal(id, name);
  };
  const deleteTable: typeof deleteTableReal = (id) => {
    if (example && id === example.id) {
      setExample(null);
      return;
    }
    deleteTableReal(id);
  };
  // Present mode: the open table performed full-screen, beat by beat.
  const [presenting, setPresenting] = useState(false);

  const softAccent = hexToRgba(accent, 0.1);
  const softAccentBorder = hexToRgba(accent, 0.28);

  const open =
    example || (openId ? tables.find((t) => t.id === openId) || null : null);
  const openUpdatedAt = open ? open.updatedAt : 0;
  useEffect(() => {
    if (!openUpdatedAt) return;
    setSaveFlash(true);
    const t = window.setTimeout(() => setSaveFlash(false), 1400);
    return () => window.clearTimeout(t);
  }, [openUpdatedAt]);

  // ---- Table-as-notes lifecycle (SCR-56, ADR-007 §3) ----
  // A study-attached table that hasn't been promoted is Compiled · live: its
  // column is GENERATED from the study's marks (the Outline arrangement —
  // themes as headings, verses in canon order) and re-sorts as marks change.
  // The first authoring act persists what's on screen and stamps promotedAt;
  // from then on the system never rearranges.
  const [promoToast, setPromoToast] = useState(false);
  const promoToastTimer = useRef<number | null>(null);
  // Coverage panel and the two table-action confirms (SCR-57 / SCR-56 v2;
  // Kepu Jul 22: both actions are visible header buttons, each behind a
  // confirm that says what it will do).
  const [covOpen, setCovOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [organizeConfirm, setOrganizeConfirm] = useState(false);
  // Focused | Full verse rendering (Kepu, Jul 20: Focused IS the spec's
  // Compact — tables open in it; Full is the flip). Display-only, remembered
  // per table, never synced.
  const [verseView, setVerseView] = useState<"full" | "focused">("focused");
  useEffect(() => {
    if (!open) return;
    try {
      const v = localStorage.getItem("scribal_table_view_" + open.id);
      setVerseView(v === "full" ? "full" : "focused");
    } catch {
      setVerseView("focused");
    }
  }, [open ? open.id : null]);
  const flipVerseView = (v: "full" | "focused") => {
    setVerseView(v);
    if (!open) return;
    try {
      localStorage.setItem("scribal_table_view_" + open.id, v);
    } catch {}
  };
  const recStudy =
    open && open.studyId
      ? recordedStudies.find((s) => s.id === open.studyId)
      : undefined;
  const topicStudy =
    open && open.studyId
      ? searchStudies.find((s) => s.id === open.studyId)
      : undefined;
  const liveCompiled =
    !!open && !isTablePromoted(open) && !!(recStudy || topicStudy);
  // The compiled outline arrangement for the open table's study — the live
  // column's source, and what "Organize as outline" rebuilds a promoted
  // column into.
  const buildCompiledColumn = (): TableCard[] => {
    if (!open || !(recStudy || topicStudy)) return [];
    const bid =
      open.bookId ||
      (topicStudy ? topicStudy.bookId : recStudy && recStudy.bookId) ||
      "master";
    const bk = getBook(bid);
    // Compile scope: a topic study's gathered refs in their saved order; a
    // chapter study's member chapters' verses in canon order.
    const entries = topicStudy
      ? topicStudy.refs.map((r, i) => ({ reference: r, order: i }))
      : (() => {
          const scopes = new Set(
            recStudy!.memberScopes && recStudy!.memberScopes.length
              ? recStudy!.memberScopes
              : [recStudy!.scopeRef]
          );
          return verseList
            .filter((v) => scopes.has(v.chapterRef))
            .map((v) => ({ reference: v.reference, order: v.order }));
        })();
    // A heading's name resolves like the card theme chips do: the scoped label
    // (chapter/group) of THIS study's marked verses. The scan must stay inside
    // the study's own scope — unscoped it took the first labeled mark of that
    // color anywhere in the book, so every study inherited one chapter study's
    // theme names (Kepu, Jul 20).
    const scopeOf = (ref: string) => {
      const ix = ref.indexOf(":");
      return ix < 0 ? ref : ref.slice(0, ix);
    };
    const resolveScope = (cs: string) =>
      chapterGroups[cs] ? "group:" + chapterGroups[cs] : cs;
    const inScopeRefs = new Set(entries.map((e) => e.reference));
    const themeName = (color: MarkColor): string => {
      for (const m of bk.marks) {
        if (m.color !== color || !inScopeRefs.has(m.reference)) continue;
        const scoped = bk.scopedLabels?.[resolveScope(scopeOf(m.reference))]?.[
          color
        ];
        const label = ((scoped || "") as string).trim();
        if (label) return label;
      }
      // Book-level fallback — the reader's precedence. Without it, themes
      // named only at book level compiled into BLANK headings (Kepu hit this
      // on real data Jul 19).
      return ((bk.colorLabels?.[color] || "") as string).trim();
    };
    return compiledCards(entries, bk.marks, themeName).map((c) =>
      c.kind === "scripture" ? { ...c, bookId: bid } : c
    );
  };
  const columnCards: TableCard[] = !open
    ? []
    : liveCompiled
    ? buildCompiledColumn()
    : open.cards;
  // ---- Study scope + coverage plumbing (SCR-57) ----
  // The verses this table answers for: a topic study's gathered refs, or a
  // chapter/linked study's MARKED verses across its member chapters.
  const scopeInfo = (() => {
    if (!open || !(recStudy || topicStudy)) return null;
    const bid =
      open.bookId ||
      (topicStudy ? topicStudy.bookId : recStudy && recStudy.bookId) ||
      "master";
    const bk = getBook(bid);
    let refs: string[];
    if (topicStudy) {
      refs = topicStudy.refs;
    } else {
      const scopes = new Set(
        recStudy!.memberScopes && recStudy!.memberScopes.length
          ? recStudy!.memberScopes
          : [recStudy!.scopeRef]
      );
      const seen = new Set<string>();
      refs = [];
      bk.marks.forEach((m) => {
        const ix = m.reference.indexOf(":");
        const cs = ix < 0 ? m.reference : m.reference.slice(0, ix);
        if (scopes.has(cs) && !seen.has(m.reference)) {
          seen.add(m.reference);
          refs.push(m.reference);
        }
      });
      refs = sortRefs(refs);
    }
    return { bid, bk, refs };
  })();
  // A verse's theme, resolved like the card chips: dominant color by merged
  // points, named by its scoped label (no book-level fallback).
  const refTheme = (
    ref: string
  ): { color: MarkColor; label: string } | null => {
    if (!scopeInfo || !ref) return null;
    const ms = scopeInfo.bk.marks.filter((m) => m.reference === ref);
    if (!ms.length) return null;
    const w = new Map<MarkColor, number>();
    ms.forEach((m) =>
      w.set(m.color, (w.get(m.color) || 0) + STYLE_POINTS[m.style])
    );
    let color: MarkColor | null = null;
    let best = -1;
    w.forEach((v, c) => {
      if (v > best) {
        best = v;
        color = c;
      }
    });
    if (color == null) return null;
    const ix = ref.indexOf(":");
    const cs = ix < 0 ? ref : ref.slice(0, ix);
    const scope = chapterGroups[cs] ? "group:" + chapterGroups[cs] : cs;
    const scoped = scopeInfo.bk.scopedLabels?.[scope]?.[color];
    const label =
      ((scoped || "") as string).trim() ||
      ((scopeInfo.bk.colorLabels?.[color] || "") as string).trim();
    return { color, label };
  };
  // Rename a theme from its compiled heading while Compiled · live: writes
  // the scoped label everywhere the study's compile reads it (never promotes;
  // the regenerated heading picks the new name up on the next render).
  const renameTheme = (color: MarkColor, name: string) => {
    if (!scopeInfo || !setThemeLabel) return;
    const scopes = new Set<string>();
    if (recStudy) {
      (recStudy.memberScopes && recStudy.memberScopes.length
        ? recStudy.memberScopes
        : [recStudy.scopeRef]
      ).forEach((cs) =>
        scopes.add(chapterGroups[cs] ? "group:" + chapterGroups[cs] : cs)
      );
    } else if (topicStudy) {
      topicStudy.refs.forEach((r) => {
        const ix = r.indexOf(":");
        const cs = ix < 0 ? r : r.slice(0, ix);
        scopes.add(chapterGroups[cs] ? "group:" + chapterGroups[cs] : cs);
      });
    }
    scopes.forEach((scope) =>
      setThemeLabel(scopeInfo.bid, scope, color, name)
    );
  };

  const placedRefs = new Set<string>();
  columnCards.forEach((c) => {
    if (c.kind === "scripture") (c.refs || []).forEach((r) => placedRefs.add(r));
  });
  const shelfRefSet = new Set<string>();
  (open ? open.shelf || [] : []).forEach((c) => {
    if (c.kind === "scripture")
      (c.refs || []).forEach((r) => shelfRefSet.add(r));
  });
  // SCR-61: where a verse already lives, for the dock's row labels and the
  // no-double-adding guard.
  const refStatusFor = (ref: string): "in-table" | "in-tray" | null =>
    placedRefs.has(ref) ? "in-table" : shelfRefSet.has(ref) ? "in-tray" : null;
  const freshRefsOnly = (refs: string[]) =>
    refs.filter((r) => !refStatusFor(r));
  // ---- Chapter seal tombstoning (SCR-62) ----
  // When a chapter is unlinked from the group, its scripture cards stay in
  // the table's data — holding their authored position — but stop rendering.
  // Re-linking the chapter makes them reappear exactly where they were.
  // Nothing written is ever destroyed. Topic tables never have dormant cards.
  const memberScopeSet = recStudy
    ? new Set(
        recStudy.memberScopes && recStudy.memberScopes.length
          ? recStudy.memberScopes
          : [recStudy.scopeRef]
      )
    : null;
  const cardDormant = (c: TableCard): boolean => {
    if (!memberScopeSet || c.kind !== "scripture" || !(c.refs || []).length)
      return false;
    return (c.refs || []).every((r) => {
      const ix = r.lastIndexOf(":");
      return !memberScopeSet.has(ix < 0 ? r : r.slice(0, ix));
    });
  };
  const visibleColumnCards = columnCards.filter((c) => !cardDormant(c));
  const visibleShelf = open
    ? (open.shelf || []).filter((c) => !cardDormant(c))
    : [];
  // Card operations run in VISIBLE space (that's what the column renders and
  // what drop indices mean); dormant cards are woven back beside their
  // nearest surviving neighbor before anything persists.
  const weaveDormant = (visible: TableCard[]): TableCard[] => {
    const dorm = columnCards.filter(cardDormant);
    if (!dorm.length) return visible;
    const inInput = new Set(visible.map((c) => c.id));
    const runs = new Map<string | null, TableCard[]>();
    let anchor: string | null = null;
    columnCards.forEach((c) => {
      if (cardDormant(c) && !inInput.has(c.id)) {
        const arr = runs.get(anchor) || [];
        arr.push(c);
        runs.set(anchor, arr);
      } else if (!cardDormant(c)) anchor = c.id;
    });
    const out: TableCard[] = [...(runs.get(null) || [])];
    visible.forEach((c) => {
      out.push(c);
      (runs.get(c.id) || []).forEach((d) => out.push(d));
    });
    const placed = new Set(out.map((c) => c.id));
    dorm.forEach((d) => {
      if (!placed.has(d.id)) out.push(d);
    });
    return out;
  };
  // Verses gathered into a TOPIC table join the study itself (SCR-61), so
  // scope and coverage stay true. Chapter tables never grow this way.
  const joinTopicStudy = (refs: string[]) => {
    if (topicStudy && onAddVersesToStudy && refs.length)
      onAddVersesToStudy(topicStudy.id, refs);
  };
  // The meter only matters once the table is yours — while Compiled · live,
  // everything in scope is on screen by construction.
  const coverage =
    open && scopeInfo && isTablePromoted(open) && scopeInfo.refs.length
      ? {
          total: scopeInfo.refs.length,
          placed: scopeInfo.refs.filter((r) => placedRefs.has(r)).length,
        }
      : null;
  const unplacedRefs = coverage
    ? scopeInfo!.refs.filter((r) => !placedRefs.has(r))
    : [];

  // Every column mutation funnels through here: while Compiled · live, the
  // first change writes the on-screen arrangement AND the promotion stamp in
  // one edit, and announces the deal once (no dialog). A verse card deleted
  // from the column RETURNS TO THE TRAY (Kepu's rule) — its refs were present
  // before, are absent after, and still belong to the study's scope. Merges
  // and reorders keep their refs in the column, so only real deletes return.
  const commitCards = (
    visibleCards: TableCard[],
    extra?: Partial<Pick<StudyTable, "shelf">>
  ) => {
    if (!open) return;
    const cards = weaveDormant(visibleCards);
    let shelfPatch = extra ? extra.shelf : undefined;
    if (scopeInfo) {
      const nextRefs = new Set<string>();
      cards.forEach((c) => {
        if (c.kind === "scripture")
          (c.refs || []).forEach((r) => nextRefs.add(r));
      });
      const scopeSet = new Set(scopeInfo.refs);
      const returned: string[] = [];
      columnCards.forEach((c) => {
        if (c.kind !== "scripture") return;
        (c.refs || []).forEach((r) => {
          if (!nextRefs.has(r) && scopeSet.has(r)) returned.push(r);
        });
      });
      if (returned.length) {
        const baseShelf =
          shelfPatch !== undefined ? shelfPatch : open.shelf || [];
        const have = new Set<string>();
        baseShelf.forEach((c) => (c.refs || []).forEach((r) => have.add(r)));
        const now = Date.now();
        const additions: TableCard[] = returned
          .filter((r) => !have.has(r))
          .map((r) => {
            const t = refTheme(r);
            const card: TableCard = {
              id: newCardId(),
              kind: "scripture",
              refs: [r],
              bookId: scopeInfo.bid,
              shelfSource: "mark",
              arrivedAt: now,
            };
            if (t && t.label) {
              card.shelfGroup = t.label;
              card.shelfGroupColor = t.color;
            }
            return card;
          });
        if (additions.length) shelfPatch = [...baseShelf, ...additions];
      }
    }
    const withShelf =
      shelfPatch !== undefined ? { shelf: shelfPatch } : {};
    if (liveCompiled) {
      updateTable(open.id, {
        cards,
        promotedAt: Date.now(),
        ...withShelf,
      });
      setPromoToast(true);
      if (promoToastTimer.current)
        window.clearTimeout(promoToastTimer.current);
      promoToastTimer.current = window.setTimeout(
        () => setPromoToast(false),
        5000
      );
    } else {
      updateTable(open.id, { cards, ...withShelf });
    }
  };

  // Place a waiting card: at an exact index (grab-drag), else at the end of
  // its theme's section, else the end of the column. Placement is the act
  // that turns an arrival into an authored card — the tray-only fields drop.
  const placeFromShelf = (cardId: string, index?: number) => {
    if (!open) return;
    const shelfList = open.shelf || [];
    const card = shelfList.find((c) => c.id === cardId);
    if (!card) return;
    const base = visibleColumnCards;
    let idx: number;
    if (index !== undefined) {
      idx = Math.max(0, Math.min(index, base.length));
    } else if (card.kind === "scripture" && card.shelfGroup) {
      const h = base.findIndex(
        (c) =>
          // Compare heading text in plain form: a heading edited rich would
          // otherwise never match its theme's shelfGroup string.
          c.kind === "heading" && richToPlain(c.text || "") === card.shelfGroup
      );
      if (h === -1) {
        idx = base.length;
      } else {
        let j = h + 1;
        while (j < base.length && base[j].kind !== "heading") j++;
        idx = j;
      }
    } else {
      idx = base.length;
    }
    const placed: TableCard = { ...card };
    delete placed.shelfSource;
    delete placed.arrivedAt;
    delete placed.shelfGroup;
    delete placed.shelfGroupColor;
    commitCards([...base.slice(0, idx), placed, ...base.slice(idx)], {
      shelf: shelfList.filter((c) => c.id !== cardId),
    });
  };

  // Tray delete — topic tables only (Kepu's ruling): the confirmed delete
  // removes the verse from the STUDY itself; its marks stay in the book.
  const deleteFromShelf = (cardId: string) => {
    if (!open || !topicStudy || !onRemoveVersesFromStudy) return;
    const shelfList = open.shelf || [];
    const card = shelfList.find((c) => c.id === cardId);
    if (!card) return;
    updateTable(open.id, {
      shelf: shelfList.filter((c) => c.id !== cardId),
    });
    if ((card.refs || []).length)
      onRemoveVersesFromStudy(topicStudy.id, card.refs || []);
  };

  // Clear to tray (SCR-56 v2, approved): every card moves to the tray —
  // verses AND authored cards; only GENERATED theme headings are removed
  // (their compiled_h ids mark them). A heading the user typed is authored
  // content and moves to the tray like everything else — nothing written is
  // ever destroyed. On a live table this is also the promotion.
  const clearToTray = () => {
    if (!open) return;
    const now = Date.now();
    const moved: TableCard[] = visibleColumnCards
      .filter(
        (c) => !(c.kind === "heading" && c.id.indexOf("compiled_h") === 0)
      )
      .map((c) => {
        const m: TableCard = { ...c, arrivedAt: now };
        if (c.kind === "scripture") {
          if (!m.shelfSource) m.shelfSource = "mark";
          if (!m.bookId && scopeInfo) m.bookId = scopeInfo.bid;
          if (!m.shelfGroup) {
            const t = refTheme((c.refs || [])[0] || "");
            if (t && t.label) {
              m.shelfGroup = t.label;
              m.shelfGroupColor = t.color;
            }
          }
        }
        return m;
      });
    commitCards([], { shelf: [...(open.shelf || []), ...moved] });
    setClearConfirm(false);
  };

  // Organize as outline (Kepu, Jul 22): recompile the study into the column —
  // theme headings with their verses in scripture order, exactly the compiled
  // starting state. Authored cards can't be auto-placed (the system never
  // interprets), so they move to the tray; tray verses the fresh outline
  // covers come out (they're placed now); a placed verse the compile no
  // longer covers drops to the tray instead of vanishing. Nothing written is
  // ever destroyed. Only meaningful on a promoted table — a live one already
  // is the outline.
  const canOrganize = !!open && !liveCompiled && !!(recStudy || topicStudy);
  const organizeAsOutline = () => {
    if (!canOrganize || !open) return;
    const fresh = buildCompiledColumn();
    const freshRefs = new Set<string>();
    fresh.forEach((c) => (c.refs || []).forEach((r) => freshRefs.add(r)));
    const now = Date.now();
    const toTray: TableCard[] = visibleColumnCards
      .filter(
        (c) => !(c.kind === "heading" && c.id.indexOf("compiled_h") === 0)
      )
      .filter(
        (c) =>
          c.kind !== "scripture" ||
          (c.refs || []).some((r) => !freshRefs.has(r))
      )
      .map((c) => {
        const m: TableCard = { ...c, arrivedAt: now };
        if (c.kind === "scripture") {
          if (!m.shelfSource) m.shelfSource = "mark";
          if (!m.bookId && scopeInfo) m.bookId = scopeInfo.bid;
          if (!m.shelfGroup) {
            const t = refTheme((c.refs || [])[0] || "");
            if (t && t.label) {
              m.shelfGroup = t.label;
              m.shelfGroupColor = t.color;
            }
          }
        }
        return m;
      });
    const keptShelf = (open.shelf || []).filter(
      (c) =>
        !(
          c.kind === "scripture" &&
          (c.refs || []).length &&
          (c.refs || []).every((r) => freshRefs.has(r))
        )
    );
    commitCards(fresh, { shelf: [...keptShelf, ...toTray] });
    setOrganizeConfirm(false);
  };

  // Mark arrivals (SCR-57): once the table is yours, anything in scope that
  // is neither placed nor already waiting gets DELIVERED to the tray, grouped
  // by theme. Runs on open and whenever marks or the table change; the hook
  // no-ops (identity-stable) when nothing is missing.
  useEffect(() => {
    if (!open || !addShelfArrivals || !scopeInfo) return;
    if (!isTablePromoted(open)) return;
    const missing = scopeInfo.refs.filter(
      (r) => !placedRefs.has(r) && !shelfRefSet.has(r)
    );
    if (!missing.length) return;
    const byTheme = new Map<
      string,
      { refs: string[]; color?: MarkColor; label?: string }
    >();
    missing.forEach((r) => {
      const t = refTheme(r);
      const key = t && t.label ? t.label + "|" + t.color : "";
      if (!byTheme.has(key))
        byTheme.set(key, {
          refs: [],
          color: t ? t.color : undefined,
          label: t && t.label ? t.label : undefined,
        });
      byTheme.get(key)!.refs.push(r);
    });
    byTheme.forEach((g) =>
      addShelfArrivals(
        open.id,
        g.refs,
        g.label
          ? {
              bookId: scopeInfo.bid,
              shelfGroup: g.label,
              shelfGroupColor: g.color,
            }
          : { bookId: scopeInfo.bid }
      )
    );
  }, [open ? open.id : null, open ? open.updatedAt : 0, allMarks]);


  // Smooth-scroll a card into view (used by the outline rail).
  const scrollToCard = (id: string) => {
    const el = document.querySelector('[data-card-id="' + id + '"]');
    if (el)
      (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // Render one verse's text + the marks from a specific book (undefined = an
  // empty, unmarked verse). Same MarkedVerse the reader uses + that book's real
  // marks, so a card shows exactly the marking that book has on the verse.
  // themeColor (Kepu, Jul 20): inside a compiled theme section only that pen's
  // marks render — other colors' words show as plain text; the verse repeats
  // under each theme it's marked in, wearing only that theme's color.
  const renderVerse = (
    reference: string,
    bookId?: string,
    themeColor?: MarkColor
  ): React.ReactNode => {
    const rec = getVerse(reference);
    if (!rec)
      return (
        <span style={{ color: "var(--muted)", fontStyle: "italic" }}>
          {reference} — not found
        </span>
      );
    const bookMarks = (bookId ? getBook(bookId).marks : []).filter(
      (m) => themeColor == null || m.color === themeColor
    );
    return (
      <MarkedVerse
        reference={reference}
        verseNumber={rec.verse}
        text={rec.text}
        marks={bookMarks}
        tags={wordTags}
        onTagTap={onTagTap}
      />
    );
  };

  // Focused rendering: only the marked fragments, each in its mark's own
  // style + color (merged runs per color, SCR-12 semantics), joined inline.
  const renderVerseFocused = (
    reference: string,
    bookId?: string,
    themeColor?: MarkColor
  ): React.ReactNode => {
    const rec = getVerse(reference);
    if (!rec)
      return (
        <span style={{ color: "var(--muted)", fontStyle: "italic" }}>
          {reference} — not found
        </span>
      );
    const ms = (bookId ? getBook(bookId).marks : []).filter(
      (m) =>
        m.reference === reference &&
        (themeColor == null || m.color === themeColor)
    );
    const colors = Array.from(new Set(ms.map((m) => m.color)));
    const frags = colors
      .flatMap((c) =>
        mergedRunsFor(ms.filter((m) => m.color === c)).map((f) => ({
          ...f,
          color: c,
        }))
      )
      .sort((a, b) => a.start - b.start);
    if (!frags.length)
      return (
        <span
          style={{ color: "var(--muted)", fontStyle: "italic", fontSize: 13 }}
        >
          no marks yet — Full shows the whole verse
        </span>
      );
    return (
      <span>
        {frags.map((f, k) => (
          <span key={f.color + ":" + f.style + ":" + f.start}>
            {k > 0 && <span style={{ color: "var(--muted)" }}> · </span>}
            <span style={markStyleCSS(f.style, f.color)}>
              {rec.text.slice(f.start, f.end)}
            </span>
          </span>
        ))}
      </span>
    );
  };

  // Build scripture cards from picked references (one passage card, or one card
  // per verse). Shared by "add to column" and "set aside".
  const makeScriptureCards = (
    refs: string[],
    asPassage: boolean,
    bookId?: string
  ): TableCard[] => {
    const bid = bookId || (open && open.bookId) || undefined;
    return asPassage
      ? [{ id: newCardId(), kind: "scripture", refs, passage: true, bookId: bid }]
      : refs.map((r) => ({
          id: newCardId(),
          kind: "scripture",
          refs: [r],
          bookId: bid,
        }));
  };

  // Insert the picked verses as scripture cards at the spot the panel was opened
  // from (falling back to the end). Consecutive adds in one panel session stack
  // in order at the insertion point.
  // A verse drag from either dock tab (Kepu, Jul 22-23): the refs in hand +
  // the book their marks come from. The column reports where the drop line
  // landed and the cards are inserted right there.
  const [externalDrag, setExternalDrag] = useState<{
    refs: string[];
    bookId?: string;
  } | null>(null);
  const externalInsert = externalDrag;
  const dropFromPicker = (index: number) => {
    if (!open || !externalInsert) return;
    // No double-adding (SCR-61): a verse already placed or waiting stays put.
    const refs = freshRefsOnly(externalInsert.refs);
    if (!refs.length) {
      setExternalDrag(null);
      return;
    }
    joinTopicStudy(refs);
    const base = visibleColumnCards;
    const idx = Math.max(0, Math.min(index, base.length));
    commitCards([
      ...base.slice(0, idx),
      ...makeScriptureCards(refs, false, externalInsert.bookId),
      ...base.slice(idx),
    ]);
    setExternalDrag(null);
  };
  // Send → Selected from the Read tab: the verses stage into the tray (was
  // App's sendReaderVersesToTable — shadowed updateTable keeps the example
  // table working).
  const sendVersesToShelf = (rawRefs: string[]) => {
    const refs = freshRefsOnly(rawRefs);
    if (!open || refs.length === 0) return;
    joinTopicStudy(refs);
    const cards: TableCard[] = refs.map((r) => ({
      id: newCardId(),
      kind: "scripture" as const,
      refs: [r],
      bookId: readBookId,
      shelfGroup: "Sent from reading",
    }));
    updateTable(open.id, { shelf: [...(open.shelf || []), ...cards] });
  };

  const addVerses = (rawRefs: string[], asPassage: boolean, bookId?: string) => {
    const refs = freshRefsOnly(rawRefs);
    if (!open || refs.length === 0) return;
    joinTopicStudy(refs);
    const newCards = makeScriptureCards(refs, asPassage, bookId);
    const base = visibleColumnCards;
    const idx = Math.max(0, Math.min(pendingIndex ?? base.length, base.length));
    commitCards([...base.slice(0, idx), ...newCards, ...base.slice(idx)]);
    setPendingIndex(idx + newCards.length);
  };

  // ---- staging shelf: set verses aside, then place them later ----
  const shelve = (rawRefs: string[], asPassage: boolean, bookId?: string) => {
    const refs = freshRefsOnly(rawRefs);
    if (!open || refs.length === 0) return;
    joinTopicStudy(refs);
    updateTable(open.id, {
      shelf: [...(open.shelf || []), ...makeScriptureCards(refs, asPassage, bookId)],
    });
  };
  const unshelve = (cardId: string) => {
    if (!open) return;
    updateTable(open.id, {
      shelf: (open.shelf || []).filter((c) => c.id !== cardId),
    });
  };
  const shelfToColumn = (cardId: string) => {
    if (!open) return;
    const shelf = open.shelf || [];
    const card = shelf.find((c) => c.id === cardId);
    if (!card) return;
    const base = visibleColumnCards;
    const idx = Math.max(0, Math.min(pendingIndex ?? base.length, base.length));
    commitCards([...base.slice(0, idx), card, ...base.slice(idx)], {
      shelf: shelf.filter((c) => c.id !== cardId),
    });
    setPendingIndex(idx + 1);
  };
  const shelfAllToColumn = () => {
    if (!open) return;
    const shelf = visibleShelf;
    if (shelf.length === 0) return;
    const base = visibleColumnCards;
    const idx = Math.max(0, Math.min(pendingIndex ?? base.length, base.length));
    const movedIds = new Set(shelf.map((c) => c.id));
    commitCards([...base.slice(0, idx), ...shelf, ...base.slice(idx)], {
      shelf: (open.shelf || []).filter((c) => !movedIds.has(c.id)),
    });
    setPendingIndex(idx + shelf.length);
  };

  // Navigate the Read tab to a verse: resolve its chapter to reader indices
  // and set the one-shot jump target.
  const navigateReadTo = (atRef: string) => {
    const cut = atRef.lastIndexOf(":");
    const scope = cut > 0 ? atRef.slice(0, cut) : atRef;
    const loc = chapterLocFor(scope);
    if (loc) setReadLoc({ v: loc.volume, b: loc.book, c: loc.chapter });
    setReadJump(atRef);
  };
  // Chapter tables are sealed to Read (ADR-007 §8) — Search never opens.
  const isChapterTable = !!recStudy;
  const dockTab: "read" | "search" | null = dock
    ? isChapterTable
      ? "read"
      : dock.tab
    : null;
  // Chapter seal (SCR-62): the Read tab is locked to the linked group's own
  // chapters — reader navigation collapses to this list, and an out-of-scope
  // location (e.g. a legacy card's chapter) snaps back to the first member.
  const sealedReadLocs = (() => {
    if (!recStudy) return undefined;
    const scopes =
      recStudy.memberScopes && recStudy.memberScopes.length
        ? recStudy.memberScopes
        : [recStudy.scopeRef];
    const locs: { v: number; b: number; c: number; label: string }[] = [];
    scopes.forEach((s) => {
      const loc = chapterLocFor(s);
      if (loc)
        locs.push({ v: loc.volume, b: loc.book, c: loc.chapter, label: s });
    });
    return locs.length ? locs : undefined;
  })();
  useEffect(() => {
    if (!dock || dockTab !== "read" || !sealedReadLocs) return;
    const inScope = sealedReadLocs.some(
      (l) => l.v === readLoc.v && l.b === readLoc.b && l.c === readLoc.c
    );
    if (!inScope) {
      const f = sealedReadLocs[0];
      setReadLoc({ v: f.v, b: f.b, c: f.c });
    }
  }, [dock, dockTab, open ? open.id : null]);
  // Table switch closes the dock and re-seeds the "Marks go to" book.
  useEffect(() => {
    setDock(null);
    setPendingIndex(null);
    setReadBookId(open ? open.bookId || "master" : "master");
  }, [open ? open.id : null]);
  // The global MarkingToolbar follows the Read tab.
  useEffect(() => {
    if (onReadMarkingChange) onReadMarkingChange(!!open && dockTab === "read");
    return () => {
      if (onReadMarkingChange) onReadMarkingChange(false);
    };
  }, [dockTab, open ? open.id : null]);
  // Open the dock to add a scripture card at a given gap. Topic/blank tables
  // land on Search; a sealed chapter table opens Read at its own chapter —
  // its verses arrive by marking, dragging, or Send.
  const openPanelAt = (index: number) => {
    setPendingIndex(index);
    if (isChapterTable && recStudy) {
      const scope =
        (recStudy.memberScopes && recStudy.memberScopes[0]) ||
        recStudy.scopeRef;
      const first = firstVerseRefOfScope(scope);
      if (first) navigateReadTo(first);
      setDock({ tab: "read" });
    } else {
      setDock({ tab: "search" });
    }
  };
  const closePanel = () => {
    setDock(null);
    setPendingIndex(null);
  };

  // Gather every scripture verse in this table (placed + shelved) with the book
  // each belongs to, so they can all be marked together in one panel.
  const collectMarkTargets = (
    cardsList: TableCard[]
  ): { refs: string[]; refBook: Record<string, string> } => {
    const refBook: Record<string, string> = {};
    const refs: string[] = [];
    cardsList.forEach((c) => {
      if (c.kind === "scripture" && c.refs) {
        c.refs.forEach((r) => {
          if (!(r in refBook)) {
            refBook[r] = c.bookId || (open && open.bookId) || "master";
            refs.push(r);
          }
        });
      }
    });
    return { refs: sortRefs(refs), refBook };
  };
  const markAllVerses = () => {
    if (!open || !onMarkVerses) return;
    const { refs, refBook } = collectMarkTargets([
      ...visibleColumnCards,
      ...visibleShelf,
    ]);
    onMarkVerses(refs, refBook, "Mark verses · " + (open.name || "table"));
  };
  const markCardVerses = (card: TableCard) => {
    if (card.kind !== "scripture" || !(card.refs || []).length) return;
    // Prefer the dock's Read tab: it opens at this verse's chapter with the
    // full toolbar (and dictionary). Falls back to the mark screen.
    if (addMarksToBook && open) {
      setReadBookId(card.bookId || open.bookId || "master");
      navigateReadTo((card.refs || [])[0]);
      setDock({ tab: "read" });
      return;
    }
    if (!onMarkVerses) return;
    const { refs, refBook } = collectMarkTargets([card]);
    onMarkVerses(refs, refBook, "Mark verse");
  };
  const markTargetCount = open
    ? collectMarkTargets([...visibleColumnCards, ...visibleShelf]).refs.length
    : 0;

  // Theme chips for one scripture card: the colors marked on its verses, each
  // resolved to its name exactly the way the reader does (scoped label for the
  // verse's chapter/group, falling back to the book-level color name). Only
  // named themes surface — unnamed colors stay silent on cards and in Present.
  const cardThemes = (
    refs: string[],
    bookId?: string
  ): { color: number; label: string }[] => {
    if (!refs.length) return [];
    const bid = bookId || "master";
    const bk = getBook(bid);
    const refset = new Set(refs);
    const scopeOfRef = (ref: string) => {
      const ix = ref.indexOf(":");
      return ix < 0 ? ref : ref.slice(0, ix);
    };
    const resolve = (cs: string) =>
      chapterGroups[cs] ? "group:" + chapterGroups[cs] : cs;
    const seen = new Map<number, string>();
    bk.marks.forEach((m) => {
      if (!refset.has(m.reference)) return;
      if (seen.has(m.color)) return;
      const scoped = bk.scopedLabels?.[resolve(scopeOfRef(m.reference))]?.[
        m.color
      ];
      // Scoped labels only (the reader's precedence) — the book-level fallback
      // leaked unrelated old names onto fresh tables.
      const label = ((scoped || "") as string).trim();
      seen.set(m.color, label);
    });
    return Array.from(seen.entries())
      .filter(([, label]) => !!label)
      .sort((a, b) => a[0] - b[0])
      .map(([color, label]) => ({ color, label }));
  };

  // ---- New table: blank, or seeded from a study ----
  const startScratch = () => {
    setNewSessionName("");
    setCreating("book");
  };
  // From-scratch step 2: the chosen marks home. All this table's marking pulls
  // from (and writes to) this book unless a card says otherwise.
  const pickBook = (bookId: string) => {
    setCreating(null);
    const id = createTable("Untitled", undefined, bookId);
    setOpenId(id);
  };
  const createSessionAndPick = () => {
    const name = newSessionName.trim() || "Session";
    pickBook(createSession(name));
  };
  // The example: a finished table that uses every card kind, so a new user can
  // see what a built lesson looks like — and Present it immediately. It's a
  // real table (homed to master, so their own marks show if they have any):
  // explore it, change it, delete it.
  const makeExample = () => {
    setCreating(null);
    const now = Date.now();
    const cards: TableCard[] = [
      { id: newCardId(), kind: "heading", text: "An experiment on the word" },
      {
        id: newCardId(),
        kind: "text",
        role: "thought",
        text:
          "Alma is talking to people who feel like outsiders — thrown out of their own synagogues. He doesn't start with an argument. He starts with an invitation to try something small.",
      },
      {
        id: newCardId(),
        kind: "scripture",
        refs: ["Alma 32:21"],
        bookId: "master",
      },
      {
        id: newCardId(),
        kind: "question",
        qtype: "analysis",
        text: "Why would Alma define faith by what it is NOT?",
      },
      {
        id: newCardId(),
        kind: "note",
        text:
          "Pause here. Let two or three people answer before moving on — the silence is doing work.",
      },
      { id: newCardId(), kind: "heading", text: "Plant the seed" },
      {
        id: newCardId(),
        kind: "scripture",
        refs: ["Alma 32:27", "Alma 32:28"],
        passage: true,
        bookId: "master",
      },
      {
        id: newCardId(),
        kind: "quote",
        text:
          "Faith is a principle of action and of power.",
        attribution: "True to the Faith",
      },
      {
        id: newCardId(),
        kind: "clip",
        url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        startSec: 0,
        endSec: 12,
        clipSaved: true,
      },
      {
        id: newCardId(),
        kind: "question",
        qtype: "application",
        text: "What is one place in your life where you could give the word a place to be planted this week?",
      },
    ];
    setExample({
      id: "example",
      name: "Example · Faith as a Seed",
      purpose: "lesson",
      bookId: "master",
      cards,
      createdAt: now,
      updatedAt: now,
    });
    setOpenId(null);
  };
  // Import a study: gather every marked verse in the study (across its themes)
  // and set them aside on the new table's shelf, then open it on the shelf tab
  // so they're waiting in "Selected". The study's own book becomes the table's
  // marks home.
  const importStudy = (meta: StudyMeta) => {
    setCreating(null);
    const id = createTable(
      meta.name?.trim() || "Untitled",
      undefined,
      meta.bookId
    );
    // Build the shelf theme-by-theme, in the study's own order, tagging every
    // card with its theme so Selected mirrors the study's structure exactly.
    const cards: TableCard[] = [];
    const covered = new Set<string>();
    studyThemes(meta.id).forEach((t) => {
      const label = (t.label || "").trim() || "Theme " + t.color;
      sortRefs(t.refs).forEach((r) => {
        if (covered.has(r)) return;
        covered.add(r);
        cards.push({
          id: newCardId(),
          kind: "scripture" as const,
          refs: [r],
          bookId: meta.bookId,
          shelfGroup: label,
          shelfGroupColor: t.color,
        });
      });
    });
    // Extra verses added to the study (keyword additions) that carry no marks
    // never appear in a theme — without this they'd silently not import.
    const rec = recordedStudies.find((s) => s.id === meta.id);
    const kw = searchStudies.find((s) => s.id === meta.id);
    const extras = sortRefs(
      Array.from(
        new Set([...(rec?.extraRefs || []), ...(kw ? kw.refs : [])])
      ).filter((r) => !covered.has(r))
    );
    extras.forEach((r) => {
      covered.add(r);
      cards.push({
        id: newCardId(),
        kind: "scripture" as const,
        refs: [r],
        bookId: meta.bookId,
        shelfGroup: "Added verses",
      });
    });
    if (cards.length) updateTable(id, { shelf: cards });
    setOpenId(id);
    // The imported groups land in the always-docked right tray — no drawer
    // needed (Kepu, Jul 23: the dock's Selected tab is gone on desktop).
    setPendingIndex(0);
  };

  // ---- "From a study": the study list + per-study theme grouping ----

  // The flat study list the panel shows (recorded chapter/linked + keyword).
  const studyMetas: StudyMeta[] = [
    ...recordedStudies.map((s) => ({
      id: s.id,
      name: s.name,
      bookId: s.bookId,
      kind: s.type,
    })),
    ...searchStudies.map((s) => ({
      id: s.id,
      name: s.name,
      bookId: s.bookId,
      kind: "keyword" as const,
    })),
  ];

  // Group a study's marked verses under its theme names. Scope + label
  // resolution mirror the reader exactly:
  //   scope:  chapter → its chapter; linked → the group's chapters; keyword → its
  //           refs. Loose extraRefs fold in for recorded studies.
  //   name:   scopedLabels[resolveScope(scopeOfRef(ref))][color], falling back to
  //           the book-level color name (same precedence the reader uses).
  const studyThemes = useCallback(
    (studyId: string): StudyTheme[] => {
      const rec = recordedStudies.find((s) => s.id === studyId);
      const kw = searchStudies.find((s) => s.id === studyId);
      const study = rec || kw;
      if (!study) return [];
      const bookId = study.bookId;

      const scopeOfRef = (ref: string) => {
        const i = ref.indexOf(":");
        return i < 0 ? ref : ref.slice(0, i);
      };
      const resolveScope = (cs: string) =>
        chapterGroups[cs] ? "group:" + chapterGroups[cs] : cs;

      // Which references belong to this study.
      let inScope: (ref: string) => boolean;
      if (kw) {
        const set = new Set(kw.refs);
        inScope = (r) => set.has(r);
      } else if (rec && rec.type === "linked") {
        // Resolve the study's link-group id tolerantly: records have stored it
        // raw ("abc123"), prefixed ("group:abc123"), or as the anchor chapter
        // ("Alma 32") depending on where the study was created. All linked
        // chapters must import, whichever convention this record carries.
        const raw = rec.scopeRef || "";
        const gid = raw.startsWith("group:")
          ? raw.slice(6)
          : chapterGroups[raw] || raw;
        const chapters = new Set(
          Object.keys(chapterGroups).filter((cs) => chapterGroups[cs] === gid)
        );
        // The anchor itself belongs too, even if the group map lost it.
        if (chapterGroups[raw] || !raw.startsWith("group:")) chapters.add(raw);
        const extra = new Set(rec.extraRefs || []);
        inScope = (r) => chapters.has(scopeOfRef(r)) || extra.has(r);
      } else {
        const extra = new Set((rec && rec.extraRefs) || []);
        inScope = (r) => scopeOfRef(r) === (rec ? rec.scopeRef : "") || extra.has(r);
      }

      // Marked references in scope, grouped by color.
      const byColor = new Map<number, Set<string>>();
      for (const m of allMarks) {
        if (m.bookId !== bookId) continue;
        if (!inScope(m.reference)) continue;
        let s = byColor.get(m.color);
        if (!s) {
          s = new Set();
          byColor.set(m.color, s);
        }
        s.add(m.reference);
      }

      const bk = getBook(bookId);
      const nameFor = (ref: string, color: number): string => {
        const scoped = bk.scopedLabels?.[resolveScope(scopeOfRef(ref))]?.[color];
        const book = bk.colorLabels?.[color];
        return ((scoped || book || "") as string).trim();
      };

      return Array.from(byColor.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([color, refset]) => {
          const refs = sortRefs(Array.from(refset));
          return {
            color: color as MarkColor,
            label: refs.length ? nameFor(refs[0], color) : "",
            refs,
          };
        });
    },
    [recordedStudies, searchStudies, chapterGroups, allMarks, getBook]
  );

  const iconBtn: React.CSSProperties = {
    width: 32,
    height: 32,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--panel)",
    color: "var(--muted)",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    lineHeight: 0,
    flex: "0 0 auto",
  };

  function Ico({ d, size = 15 }: { d: string; size?: number }) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ display: "block" }}
      >
        {d.split(" M").map((seg, i) => (
          <path key={i} d={i === 0 ? seg : "M" + seg} />
        ))}
      </svg>
    );
  }

  // ---------------- EDITOR ----------------
  if (open) {
    const sections = columnCards.filter((c) => c.kind === "heading");
    const hasRail = sections.length > 0;
    // The side tray is a fixed overlay at the viewport's right edge — the
    // header and body must clear its footprint or buttons hide beneath it.
    const trayDocked = visibleShelf.length > 0;
    // The Scripture dock is a fixed left panel — while it's open the editor
    // shifts right of it instead of centering underneath.
    const dockInset = dock ? 452 : 0;
    const editorMax =
      780 + (hasRail && !dock ? 200 : 0) + (trayDocked ? 288 : 0);
    return (
      <div
        style={{
          maxWidth: editorMax,
          margin: dockInset
            ? "0 16px 0 " + (dockInset + 16) + "px"
            : "0 auto",
          padding: "16px 16px 120px",
        }}
      >
        {/* editor top bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            marginBottom: 6,
            paddingRight: trayDocked ? 288 : 0,
          }}
        >
          <button
            onClick={() => {
              setExample(null);
              setOpenId(null);
              if (cameFromShell) {
                setCameFromShell(false);
                onClose();
              }
            }}
            style={iconBtn}
            title={cameFromShell ? "Back to reading" : "Back to your tables"}
          >
            <Ico d="M15 6l-6 6 6 6" />
          </button>
          <input
            value={open.name}
            placeholder="Untitled"
            onChange={(e) => renameTable(open.id, e.target.value)}
            style={{
              flex: 1,
              minWidth: 180,
              height: 40,
              padding: "0 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--panel)",
              color: "var(--text)",
              fontFamily: SERIF,
              fontSize: 18,
              fontWeight: 600,
              outline: "none",
            }}
          />
          <span
            title="Every change saves automatically"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontFamily: SANS,
              fontSize: 11.5,
              fontWeight: 600,
              color: saveFlash ? accent : "var(--muted)",
              flex: "0 0 auto",
              transition: "color .2s ease",
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            {saveFlash ? "Saved" : "Autosaves"}
          </span>
          {coverage && (
            <button
              onClick={() => setCovOpen((o) => !o)}
              title="Verses in this study not yet placed in the column"
              style={{
                fontFamily: SANS,
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 999,
                padding: "5px 11px",
                cursor: "pointer",
                flex: "0 0 auto",
                color:
                  coverage.placed >= coverage.total ? "#3d7a26" : "#b06a2f",
                background:
                  coverage.placed >= coverage.total ? "#edf7e6" : "#faf0e4",
                border:
                  "1px solid " +
                  (coverage.placed >= coverage.total ? "#c4e0b2" : "#ecd7bd"),
              }}
            >
              {coverage.placed} of {coverage.total} placed
            </button>
          )}
          {example && open.id === example.id && (
            <span
              style={{
                fontFamily: SANS,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "var(--muted)",
                border: "1.5px dashed var(--border)",
                borderRadius: 999,
                padding: "5px 12px",
                flex: "0 0 auto",
              }}
            >
              Example · not saved
            </span>
          )}
          {addMarksToBook && (
            <button
              onClick={() => {
                // Open at the table's own scripture — the first scripture
                // card (column, then shelf) — instead of the reader's
                // Genesis 1 default (SCR-16). A chapter table with no cards
                // yet opens at its study's chapter.
                const sc = [...visibleColumnCards, ...visibleShelf].find(
                  (cd) => cd.kind === "scripture" && (cd.refs || []).length
                );
                let at = sc ? (sc.refs || [])[0] : undefined;
                if (!at && recStudy) {
                  const scope =
                    (recStudy.memberScopes && recStudy.memberScopes[0]) ||
                    recStudy.scopeRef;
                  at = firstVerseRefOfScope(scope);
                }
                setReadBookId(open.bookId || "master");
                if (at) navigateReadTo(at);
                setDock({ tab: "read" });
              }}
              title="Read, mark, search, and pull scripture into this table"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontFamily: SANS,
                fontSize: 12.5,
                fontWeight: 650,
                color: "#fff",
                background: accent,
                border: 0,
                borderRadius: 999,
                padding: "7px 14px",
                cursor: "pointer",
                flex: "0 0 auto",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4H11v15H4.5A1.5 1.5 0 0 1 3 17.5z" />
                <path d="M21 5.5A1.5 1.5 0 0 0 19.5 4H13v15h6.5a1.5 1.5 0 0 0 1.5-1.5z" />
              </svg>
              Reading panel
            </button>
          )}
          {onMarkVerses && (
            <button
              onClick={markAllVerses}
              disabled={markTargetCount === 0}
              title={
                markTargetCount === 0
                  ? "Add scripture cards first"
                  : "Mark all this table’s verses in one panel"
              }
              style={{
                fontFamily: SANS,
                fontSize: 13,
                fontWeight: 650,
                color: markTargetCount === 0 ? "var(--muted)" : accent,
                background: "transparent",
                border:
                  "1px solid " +
                  (markTargetCount === 0 ? "var(--border)" : accent),
                borderRadius: 999,
                padding: "9px 15px",
                opacity: markTargetCount === 0 ? 0.5 : 1,
                cursor: markTargetCount === 0 ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
              }}
            >
              <Ico
                d="M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"
                size={13}
              />{" "}
              Mark verses
            </button>
          )}
          <button
            onClick={() => visibleColumnCards.length > 0 && setPresenting(true)}
            disabled={visibleColumnCards.length === 0}
            title={
              visibleColumnCards.length === 0
                ? "Add cards first — the column becomes the lesson"
                : "Present this table, beat by beat"
            }
            style={{
              fontFamily: SANS,
              fontSize: 13,
              fontWeight: 650,
              color: "#fff",
              background: accent,
              border: 0,
              borderRadius: 999,
              padding: "9px 16px",
              opacity: visibleColumnCards.length === 0 ? 0.4 : 1,
              cursor: visibleColumnCards.length === 0 ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            <Ico d="M8 5v14l11-7z" size={13} /> Present
          </button>
          <div
            style={{
              display: "inline-flex",
              border: "1px solid var(--border)",
              borderRadius: 999,
              overflow: "hidden",
              flex: "0 0 auto",
            }}
          >
            {(["focused", "full"] as const).map((v) => (
              <button
                key={v}
                onClick={() => flipVerseView(v)}
                title={
                  v === "focused"
                    ? "Only the marked fragments of each verse"
                    : "The whole verse, marks inline"
                }
                style={{
                  fontFamily: SANS,
                  fontSize: 12,
                  fontWeight: verseView === v ? 700 : 400,
                  padding: "6px 13px",
                  border: 0,
                  cursor: "pointer",
                  background:
                    verseView === v ? "var(--text)" : "transparent",
                  color: verseView === v ? "var(--bg)" : "var(--muted)",
                }}
              >
                {v === "focused" ? "Focused" : "Full"}
              </button>
            ))}
          </div>
          <button
            onClick={() => canOrganize && setOrganizeConfirm(true)}
            title={
              canOrganize
                ? "Rebuild the column as the compiled outline"
                : "A live table already is the outline"
            }
            style={{
              fontFamily: SANS,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text)",
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 999,
              padding: "6px 13px",
              flex: "0 0 auto",
              opacity: canOrganize ? 1 : 0.4,
              cursor: canOrganize ? "pointer" : "not-allowed",
            }}
          >
            Organize as outline
          </button>
          <button
            onClick={() =>
              visibleColumnCards.length > 0 && setClearConfirm(true)
            }
            title="Move every card to the tray"
            style={{
              fontFamily: SANS,
              fontSize: 12,
              fontWeight: 600,
              color: "#b3452f",
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 999,
              padding: "6px 13px",
              flex: "0 0 auto",
              opacity: visibleColumnCards.length > 0 ? 1 : 0.4,
              cursor: visibleColumnCards.length > 0 ? "pointer" : "not-allowed",
            }}
          >
            Clear to tray
          </button>
          <button
            onClick={() => setConfirmId(open.id)}
            style={iconBtn}
            title="Delete this table"
          >
            <Ico d="M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6" />
          </button>
        </div>

        {/* Coverage panel: the unplaced verses, grouped by theme, each marked
            whether it's waiting in the tray. */}
        {covOpen && coverage && (
          <div
            style={{
              margin: "8px 0 0 42px",
              maxWidth: 560,
              background: "var(--panel)",
              border: "1px solid #ecd7bd",
              borderRadius: 12,
              padding: "10px 14px",
              fontFamily: SANS,
              fontSize: 12,
            }}
          >
            <div
              style={{
                fontWeight: 700,
                color: unplacedRefs.length ? "#b06a2f" : "#3d7a26",
                marginBottom: unplacedRefs.length ? 6 : 0,
              }}
            >
              {unplacedRefs.length
                ? "Not yet placed — " +
                  unplacedRefs.length +
                  (unplacedRefs.length === 1 ? " verse" : " verses")
                : "Everything is placed"}
            </div>
            {unplacedRefs.map((r) => {
              const t = refTheme(r);
              return (
                <div
                  key={r}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "3px 0",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 3,
                      flex: "0 0 auto",
                      background: t ? COLOR_MAP[t.color] : "var(--border)",
                    }}
                  />
                  <span style={{ fontWeight: 700, color: accent }}>{r}</span>
                  <span style={{ color: "var(--muted)", fontSize: 11 }}>
                    {shelfRefSet.has(r) ? "in tray" : "not in tray"}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Clear-to-tray confirm (SCR-56 v2, approved): nothing is deleted. */}
        {clearConfirm && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,.35)",
              zIndex: 90,
              display: "grid",
              placeItems: "center",
            }}
            onClick={() => setClearConfirm(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--panel)",
                borderRadius: 14,
                padding: "18px 20px",
                maxWidth: 420,
                margin: 16,
                fontFamily: SANS,
                boxShadow: "0 18px 50px rgba(0,0,0,.3)",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
                Clear this table to the tray?
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--muted)",
                  lineHeight: 1.55,
                  marginBottom: 14,
                }}
              >
                Every card moves to the tray — verses and anything you've
                written. Theme headings are removed. You'll rebuild the column
                in exactly the order you want; nothing is deleted.
              </div>
              <div
                style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
              >
                <button
                  onClick={() => setClearConfirm(false)}
                  style={{
                    fontFamily: SANS,
                    fontSize: 12.5,
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                    color: "var(--text)",
                    borderRadius: 8,
                    padding: "7px 14px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={clearToTray}
                  style={{
                    fontFamily: SANS,
                    fontSize: 12.5,
                    fontWeight: 700,
                    border: 0,
                    background: "#b3452f",
                    color: "#fff",
                    borderRadius: 8,
                    padding: "7px 14px",
                    cursor: "pointer",
                  }}
                >
                  Clear to tray
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Organize-as-outline confirm (Kepu, Jul 22): nothing is deleted. */}
        {organizeConfirm && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,.35)",
              zIndex: 90,
              display: "grid",
              placeItems: "center",
            }}
            onClick={() => setOrganizeConfirm(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--panel)",
                borderRadius: 14,
                padding: "18px 20px",
                maxWidth: 420,
                margin: 16,
                fontFamily: SANS,
                boxShadow: "0 18px 50px rgba(0,0,0,.3)",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
                Organize this table as the outline?
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--muted)",
                  lineHeight: 1.55,
                  marginBottom: 14,
                }}
              >
                The column is rebuilt as the study compiles today — theme
                headings with their verses in scripture order. Everything
                you've written moves to the tray to be re-placed where you
                want; verses waiting in the tray are placed into the outline.
                Nothing is deleted.
              </div>
              <div
                style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
              >
                <button
                  onClick={() => setOrganizeConfirm(false)}
                  style={{
                    fontFamily: SANS,
                    fontSize: 12.5,
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                    color: "var(--text)",
                    borderRadius: 8,
                    padding: "7px 14px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={organizeAsOutline}
                  style={{
                    fontFamily: SANS,
                    fontSize: 12.5,
                    fontWeight: 700,
                    border: 0,
                    background: accent,
                    color: "#fff",
                    borderRadius: 8,
                    padding: "7px 14px",
                    cursor: "pointer",
                  }}
                >
                  Organize as outline
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Compiled · live: the quiet caption is the only state signal (no
            chip — Kepu's ruling). It disappears the moment the table is yours. */}
        {liveCompiled && (
          <div
            style={{
              fontFamily: SANS,
              fontSize: 11.5,
              fontStyle: "italic",
              color: "var(--muted)",
              padding: "4px 0 0 42px",
            }}
          >
            Arranged from your marks — it re-sorts until you make it yours.
          </div>
        )}

        {/* purpose */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "10px 0 22px", paddingLeft: 42 }}>
          <span
            style={{
              fontFamily: SANS,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".13em",
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            Purpose
          </span>
          {PURPOSES.map(({ p, label }) => {
            const on = open.purpose === p;
            return (
              <button
                key={p}
                onClick={() => updateTable(open.id, { purpose: on ? undefined : p })}
                style={{
                  fontFamily: SANS,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  color: on ? accent : "var(--muted)",
                  background: on ? softAccent : "transparent",
                  border: "1px solid " + (on ? accent : "var(--border)"),
                  borderRadius: 999,
                  padding: "5px 13px",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* The Scripture dock (Kepu, Jul 23): ONE fixed-left surface — Read
            (the reader: browse, mark, define, grab) | Search (the picker).
            Chapter tables are sealed to Read (ADR-007 §8). */}
        {dock && (
          <div
            style={{
              position: "fixed",
              top: headerOffset,
              left: 0,
              bottom: 0,
              width: "min(440px, 94vw)",
              zIndex: 60,
              display: "flex",
              flexDirection: "column",
              background: "var(--panel)",
              borderRight: "1px solid var(--border)",
              boxShadow: "18px 0 40px -28px rgba(0,0,0,.35)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 14px",
                borderBottom: "1px solid var(--border)",
                flex: "0 0 auto",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13.5,
                      fontWeight: 700,
                      color: "var(--text)",
                      fontFamily: SANS,
                    }}
                  >
                    Reading panel
                  </span>
                  {!isChapterTable && (
                    <span
                      style={{
                        display: "inline-flex",
                        gap: 3,
                        padding: 2,
                        background: "var(--soft)",
                        border: "1px solid var(--border)",
                        borderRadius: 999,
                      }}
                    >
                      {(["read", "search"] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => setDock({ tab: t })}
                          style={{
                            fontFamily: SANS,
                            fontSize: 11,
                            fontWeight: 600,
                            border: 0,
                            borderRadius: 999,
                            padding: "3px 11px",
                            cursor: "pointer",
                            background:
                              dockTab === t ? accent : "transparent",
                            color: dockTab === t ? "#fff" : "var(--muted)",
                          }}
                        >
                          {t === "read" ? "Read" : "Search"}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={closePanel}
                aria-label="Close the reading panel"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--panel)",
                  color: "var(--muted)",
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                  lineHeight: 0,
                  flex: "0 0 auto",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            {dockTab === "read" &&
              addMarksToBook &&
              deleteMarkInBook &&
              onChangeTool &&
              onChangeColor &&
              selectedTool &&
              selectedColor && (
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                  <VerseViewer
                    selectedVolume={readLoc.v}
                    selectedBook={readLoc.b}
                    selectedChapter={readLoc.c}
                    onChange={(v, b, c) => setReadLoc({ v, b, c })}
                    selectedTool={selectedTool}
                    selectedColor={selectedColor}
                    onChangeTool={onChangeTool}
                    onChangeColor={onChangeColor}
                    onMark={(reference, verseText, markedText, startIndex, endIndex, style, color) =>
                      addMarksToBook(readBookId, [
                        { reference, verseText, markedText, startIndex, endIndex, style, color },
                      ])
                    }
                    onMarkMany={(items) => addMarksToBook(readBookId, items)}
                    onEraseMark={(id) => deleteMarkInBook(readBookId, id)}
                    onDefine={onDefine}
                    tags={wordTags}
                    onTagTap={onTagTap}
                    marks={getBook(readBookId).marks}
                    panelMode
                    fontScale={0.86}
                    chromeBg="var(--panel)"
                    compactChrome
                    dragVerses
                    onGrabDragState={(refs) =>
                      setExternalDrag(
                        refs ? { refs, bookId: readBookId } : null
                      )
                    }
                    jumpTarget={readJump}
                    onJumpHandled={() => setReadJump(null)}
                    onSendVerses={sendVersesToShelf}
                    allowedLocs={sealedReadLocs}
                    refStatusFor={refStatusFor}
                    onStageVerse={(r) => sendVersesToShelf([r])}
                    chromeExtra={
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          minWidth: 0,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--muted)",
                            flex: "0 0 auto",
                            fontFamily: SANS,
                          }}
                        >
                          Marks go to
                        </span>
                        <select
                          value={readBookId}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "__new") {
                              const name = window.prompt(
                                "Name the new session:"
                              );
                              if (name && name.trim() && createSession)
                                setReadBookId(createSession(name.trim()));
                              return;
                            }
                            setReadBookId(v);
                          }}
                          style={{
                            fontFamily: "inherit",
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--text)",
                            background: "var(--soft)",
                            border: "1px solid var(--border)",
                            borderRadius: 7,
                            padding: "3px 5px",
                            maxWidth: 150,
                            minWidth: 0,
                          }}
                        >
                          {books.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.isMaster
                                ? "Master Chapter Book"
                                : b.name || "Session"}
                            </option>
                          ))}
                          <option value="__new">＋ New session…</option>
                        </select>
                      </span>
                    }
                  />
                </div>
              )}
            {dockTab === "search" && (
              <VersePicker
                embedded
                onAdd={addVerses}
                renderVerse={renderVerse}
                allMarks={allMarks}
                books={books}
                shelf={open.shelf || []}
                onShelve={shelve}
                onUnshelve={unshelve}
                onShelfToColumn={shelfToColumn}
                onShelfAllToColumn={shelfAllToColumn}
                onClose={closePanel}
                accent={accent}
                headerOffset={headerOffset}
                defaultBookId={open.bookId}
                compact
                verseTextFor={(r) => {
                  const rec = getVerse(r);
                  return rec ? rec.text : "";
                }}
                onVerseDragStart={(ref, bookId) =>
                  setExternalDrag({ refs: [ref], bookId })
                }
                onVerseDragEnd={() => setExternalDrag(null)}
                refStatusFor={refStatusFor}
                themeLabelFor={(ref, color, bookId) => {
                  const bk = getBook(bookId || open.bookId || "master");
                  const ix = ref.indexOf(":");
                  const cs = ix < 0 ? ref : ref.slice(0, ix);
                  const scope = chapterGroups[cs]
                    ? "group:" + chapterGroups[cs]
                    : cs;
                  const scoped = bk.scopedLabels?.[scope]?.[color];
                  return ((scoped || "") as string).trim();
                }}
              />
            )}
          </div>
        )}

        {/* three-zone body: outline rail (hidden while the dock is open) +
            column + the tray's reserved right column. */}
        <div style={{ display: "flex", gap: 26, alignItems: "flex-start" }}>
          {hasRail && !dock && (
            <div
              style={{
                width: 210,
                flex: "0 0 auto",
                position: "sticky",
                top: headerOffset + 14,
                alignSelf: "flex-start",
              }}
            >
              <OutlineRail
                sections={sections}
                onJump={scrollToCard}
                accent={accent}
              />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <StudyTableColumn
              cards={visibleColumnCards}
              onChange={commitCards}
              accent={accent}
              renderVerse={renderVerse}
              onPickScripture={openPanelAt}
              onMarkCard={onMarkVerses ? markCardVerses : undefined}
              themesFor={cardThemes}
              chooserFootnote={
                liveCompiled
                  ? "This makes the table yours — from here it keeps your order, and new marks wait in the tray instead of moving things."
                  : undefined
              }
              shelf={visibleShelf}
              onPlaceFromShelf={placeFromShelf}
              onDeleteFromShelf={
                topicStudy && onRemoveVersesFromStudy
                  ? deleteFromShelf
                  : undefined
              }
              verseTextFor={(r) => {
                const rec = getVerse(r);
                return rec ? rec.text : "";
              }}
              outlineMode={verseView === "focused"}
              live={liveCompiled}
              verseView={verseView}
              renderVerseFocused={renderVerseFocused}
              onRenameTheme={setThemeLabel ? renameTheme : undefined}
              externalDragRef={externalInsert ? externalInsert.refs[0] : null}
              onExternalDrop={dropFromPicker}
              traySide
              trayTop={headerOffset + 14}
            />
          </div>
          {/* Reserve the right column for the fixed tray panel so it never
              overlaps the cards it places (Kepu, Jul 22). With the reader on
              the left, the tray keeps this slot even while picking. */}
          {visibleShelf.length > 0 && (
            <div style={{ width: 288, flex: "0 0 auto" }} />
          )}
        </div>

        {/* One-time promotion announcement — the same deal line, as a toast,
            so drag/delete promotions (no insert sheet there) still hear it. */}
        {promoToast && (
          <div
            style={{
              position: "fixed",
              bottom: 26,
              left: "50%",
              transform: "translateX(-50%)",
              background: "var(--text)",
              color: "var(--bg)",
              fontFamily: SANS,
              fontSize: 12.5,
              fontWeight: 600,
              borderRadius: 999,
              padding: "10px 20px",
              boxShadow: "0 10px 28px rgba(0,0,0,.28)",
              zIndex: 80,
              whiteSpace: "nowrap",
            }}
          >
            This table is yours now — new marks will wait in the tray.
          </div>
        )}

        {confirmId === open.id && (
          <ConfirmDelete
            name={open.name}
            onCancel={() => setConfirmId(null)}
            onConfirm={() => {
              deleteTable(open.id);
              setConfirmId(null);
              setOpenId(null);
            }}
            accent={accent}
          />
        )}

        {presenting && (
          <StudyTablePresent
            table={{ ...open, cards: visibleColumnCards }}
            renderVerse={renderVerse}
            themesFor={cardThemes}
            accent={accent}
            onClose={() => setPresenting(false)}
            room={{
              // Serialize everything a follower needs: the table, the marks on
              // its verses (from each card's book), and its named themes.
              start: async () => {
                const marks: Mark[] = [];
                const seenMark = new Set<string>();
                const themes: Record<
                  string,
                  { color: number; label: string }[]
                > = {};
                [...visibleColumnCards, ...visibleShelf].forEach((c) => {
                  if (c.kind !== "scripture" || !c.refs || !c.refs.length)
                    return;
                  const bid = c.bookId || open.bookId || "master";
                  const refset = new Set(c.refs);
                  getBook(bid).marks.forEach((m) => {
                    if (refset.has(m.reference) && !seenMark.has(m.id)) {
                      seenMark.add(m.id);
                      marks.push(m);
                    }
                  });
                  themes[themesKey(c.refs, c.bookId)] = cardThemes(
                    c.refs,
                    c.bookId || open.bookId
                  );
                });
                const code = newRoomCode();
                await createRoom(code, {
                  tableJson: JSON.stringify(
                    // Presenting a Compiled · live table performs what's on
                    // screen — the generated arrangement — without promoting.
                    redactTableForRoom({ ...open, cards: visibleColumnCards })
                  ),
                  marksJson: JSON.stringify(marks),
                  themesJson: JSON.stringify(themes),
                });
                return code;
              },
              push: pushBeat,
              end: endRoom,
              joinUrl,
            }}
          />
        )}
      </div>
    );
  }

  // ---------------- LIST ----------------
  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "18px 16px 80px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
        <button onClick={onClose} style={iconBtn} title="Back to reading">
          <Ico d="M15 6l-6 6 6 6" />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 10.5,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            Study tables
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 600, color: "var(--text)" }}>
            Build a lesson
          </div>
        </div>
        <button
          onClick={() => setCreating("choose")}
          style={{
            fontFamily: SANS,
            fontSize: 13.5,
            fontWeight: 650,
            color: "#fff",
            cursor: "pointer",
            background: accent,
            border: 0,
            borderRadius: 10,
            padding: "10px 16px",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Ico d="M12 5v14 M5 12h14" size={15} /> New table
        </button>
      </div>

      {showIntro && (
        <div
          style={{
            border: "1px solid " + softAccentBorder,
            background: softAccent,
            borderRadius: 14,
            padding: "16px 18px",
            marginBottom: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                flex: 1,
                fontFamily: SERIF,
                fontSize: 17,
                fontWeight: 600,
                color: "var(--text)",
              }}
            >
              How a study table works
            </div>
            <button
              onClick={dismissIntro}
              aria-label="Dismiss"
              style={{
                border: 0,
                background: "transparent",
                color: "var(--muted)",
                cursor: "pointer",
                fontFamily: SANS,
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              Dismiss
            </button>
          </div>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 13,
              color: "var(--text)",
              lineHeight: 1.7,
            }}
          >
            <b>1 · Gather</b> — pull verses in from your studies or search (or
            send them here from any reading panel).{" "}
            <b>2 · Arrange</b> — stack cards in order: scripture, your words,
            questions, quotes, a clip; the column becomes the lesson.{" "}
            <b>3 · Mark</b> — open Mark verses, mark everything in one screen,
            and name your themes; they appear on the cards.{" "}
            <b>4 · Present</b> — perform it beat by beat, and share a QR so
            others follow along live.
          </div>
          <button
            onClick={makeExample}
            style={{
              marginTop: 12,
              fontFamily: SANS,
              fontSize: 13,
              fontWeight: 650,
              color: accent,
              background: "transparent",
              border: "1px solid " + accent,
              borderRadius: 999,
              padding: "8px 16px",
              cursor: "pointer",
            }}
          >
            Open the example table →
          </button>
        </div>
      )}

      {tables.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "60px 22px",
            color: "var(--muted)",
            fontFamily: SANS,
            fontSize: 14,
            border: "1px dashed var(--border)",
            borderRadius: 14,
          }}
        >
          No tables yet. Start one and gather your parts — verses, your words, questions, a clip.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {tables.map((t) => (
            <TableRow
              key={t.id}
              table={t}
              accent={accent}
              softAccent={softAccent}
              softAccentBorder={softAccentBorder}
              onOpen={() => setOpenId(t.id)}
              onDelete={() => setConfirmId(t.id)}
            />
          ))}
        </div>
      )}

      {confirmId && (
        <ConfirmDelete
          name={tables.find((t) => t.id === confirmId)?.name || "this table"}
          onCancel={() => setConfirmId(null)}
          onConfirm={() => {
            deleteTable(confirmId);
            setConfirmId(null);
          }}
          accent={accent}
        />
      )}

      {creating && (
        <div
          onClick={() => setCreating(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 500,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 460,
              maxHeight: "84vh",
              display: "flex",
              flexDirection: "column",
              background: "var(--bg)",
              color: "var(--text)",
              borderRadius: 16,
              border: "1px solid var(--border)",
              padding: 22,
              boxShadow: "0 24px 70px rgba(0,0,0,0.4)",
            }}
          >
            {creating === "book" ? (
              <>
                <div style={{ fontFamily: SERIF, fontSize: 21, fontWeight: 600 }}>
                  Where should marking live?
                </div>
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 13,
                    color: "var(--muted)",
                    marginTop: 4,
                    marginBottom: 16,
                  }}
                >
                  This table pulls its verse marking from the book you pick —
                  and marks you make from the table go there too.
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    overflowY: "auto",
                    marginBottom: 12,
                  }}
                >
                  {books.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => pickBook(b.id)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "11px 13px",
                        borderRadius: 10,
                        border:
                          "1px solid " +
                          (b.isMaster ? softAccentBorder : "var(--border)"),
                        background: b.isMaster ? softAccent : "var(--panel)",
                        color: "var(--text)",
                        cursor: "pointer",
                        fontFamily: SANS,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {b.isMaster ? "Master Chapter Book" : b.name || "Session"}
                      </div>
                      <div
                        style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}
                      >
                        {b.markCount === 1
                          ? "1 mark"
                          : b.markCount + " marks"}
                      </div>
                    </button>
                  ))}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    borderTop: "1px solid var(--border)",
                    paddingTop: 12,
                  }}
                >
                  <input
                    value={newSessionName}
                    placeholder="Or name a new session…"
                    onChange={(e) => setNewSessionName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newSessionName.trim()) {
                        e.preventDefault();
                        createSessionAndPick();
                      }
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      outline: 0,
                      background: "var(--soft)",
                      fontFamily: SANS,
                      fontSize: 13.5,
                      color: "var(--text)",
                      padding: "10px 12px",
                    }}
                  />
                  <button
                    onClick={createSessionAndPick}
                    disabled={!newSessionName.trim()}
                    style={{
                      fontFamily: SANS,
                      fontSize: 13,
                      fontWeight: 650,
                      color: "#fff",
                      background: accent,
                      border: 0,
                      borderRadius: 10,
                      padding: "10px 16px",
                      opacity: newSessionName.trim() ? 1 : 0.45,
                      cursor: newSessionName.trim() ? "pointer" : "not-allowed",
                      flex: "0 0 auto",
                    }}
                  >
                    Create
                  </button>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-start",
                    marginTop: 12,
                  }}
                >
                  <button
                    onClick={() => setCreating("choose")}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--muted)",
                      fontSize: 13.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: SANS,
                      padding: "6px 4px",
                    }}
                  >
                    Back
                  </button>
                </div>
              </>
            ) : creating === "choose" ? (
              <>
                <div style={{ fontFamily: SERIF, fontSize: 21, fontWeight: 600 }}>
                  New study table
                </div>
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 13,
                    color: "var(--muted)",
                    marginTop: 4,
                    marginBottom: 18,
                  }}
                >
                  Begin from a study you’ve already gathered, or from a blank
                  table.
                </div>
                {[
                  {
                    on: () => setCreating("import"),
                    d: "M12 3v12 M7 10l5 5 5-5 M5 20h14",
                    title: "Import a study",
                    sub: "Its marked verses arrive in Selected, ready to place",
                    strong: true,
                  },
                  {
                    on: startScratch,
                    d: "M12 5v14 M5 12h14",
                    title: "Start from scratch",
                    sub: "A blank table — you pick where its marking lives",
                    strong: false,
                  },
                  {
                    on: makeExample,
                    d: "M12 2l2.4 4.9L20 8l-4 3.9.9 5.6-4.9-2.6L7.1 17.5 8 11.9 4 8l5.6-1.1z",
                    title: "See the example",
                    sub: "A finished lesson using every card — open it, present it",
                    strong: false,
                  },
                ].map((o) => (
                  <button
                    key={o.title}
                    onClick={o.on}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 13,
                      width: "100%",
                      textAlign: "left",
                      marginBottom: 10,
                      padding: "14px 15px",
                      borderRadius: 12,
                      cursor: "pointer",
                      fontFamily: SANS,
                      background: o.strong ? softAccent : "var(--panel)",
                      border:
                        "1px solid " +
                        (o.strong ? softAccentBorder : "var(--border)"),
                      color: "var(--text)",
                    }}
                  >
                    <span
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 10,
                        flex: "0 0 auto",
                        display: "grid",
                        placeItems: "center",
                        background: o.strong ? accent : "var(--soft)",
                        color: o.strong ? "#fff" : accent,
                      }}
                    >
                      <Ico d={o.d} size={18} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: 14.5,
                          fontWeight: 650,
                        }}
                      >
                        {o.title}
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: 12,
                          color: "var(--muted)",
                          marginTop: 2,
                        }}
                      >
                        {o.sub}
                      </span>
                    </span>
                  </button>
                ))}
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                  <button
                    onClick={() => setCreating(null)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--muted)",
                      fontSize: 13.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: SANS,
                      padding: "6px 4px",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontFamily: SERIF, fontSize: 21, fontWeight: 600 }}>
                  Import a study
                </div>
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 13,
                    color: "var(--muted)",
                    marginTop: 4,
                    marginBottom: 16,
                  }}
                >
                  Its marked verses will be set aside in the new table’s Selected
                  tab.
                </div>
                {studyMetas.length === 0 ? (
                  <div
                    style={{
                      fontFamily: SANS,
                      fontSize: 13.5,
                      color: "var(--muted)",
                      lineHeight: 1.5,
                      padding: "8px 2px 16px",
                    }}
                  >
                    You don’t have any studies yet. Start from scratch instead.
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      overflowY: "auto",
                      marginBottom: 4,
                    }}
                  >
                    {studyMetas.map((m) => {
                      const count = new Set(
                        studyThemes(m.id).flatMap((t) => t.refs)
                      ).size;
                      const kindLabel =
                        m.kind === "linked"
                          ? "Linked study"
                          : m.kind === "keyword"
                          ? "Keyword study"
                          : "Chapter study";
                      return (
                        <button
                          key={m.id}
                          onClick={() => importStudy(m)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "11px 13px",
                            borderRadius: 10,
                            border: "1px solid var(--border)",
                            background: "var(--panel)",
                            color: "var(--text)",
                            cursor: "pointer",
                            fontFamily: SANS,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {m.name || "Untitled study"}
                          </div>
                          <div
                            style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}
                          >
                            {kindLabel} ·{" "}
                            {count === 1 ? "1 verse" : count + " verses"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "flex-start", marginTop: 12 }}>
                  <button
                    onClick={() => setCreating("choose")}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--muted)",
                      fontSize: 13.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: SANS,
                      padding: "6px 4px",
                    }}
                  >
                    Back
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- the outline rail: a sticky list of the table's section headings ----
function OutlineRail({
  sections,
  onJump,
  accent,
}: {
  sections: TableCard[];
  onJump: (id: string) => void;
  accent: string;
}) {
  const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  return (
    <nav
      style={{
        borderLeft: "2px solid var(--border)",
        paddingLeft: 14,
        maxHeight: "calc(100vh - 160px)",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: "var(--muted)",
          marginBottom: 12,
        }}
      >
        Outline
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {sections.map((s) => {
          const label = richToPlain(s.text || "") || "Untitled section";
          // A compiled theme heading carries its pen in the id — the rail
          // shows the same color dot the section header wears (Kepu, Jul 20).
          const n =
            s.id.indexOf("compiled_h") === 0
              ? Number(s.id.slice("compiled_h".length))
              : NaN;
          const dot = n >= 1 && n <= 10 ? COLOR_MAP[n as MarkColor] : null;
          return (
            <button
              key={s.id}
              onClick={() => onJump(s.id)}
              title={label}
              style={{
                textAlign: "left",
                background: "transparent",
                border: 0,
                cursor: "pointer",
                padding: "7px 8px",
                borderRadius: 8,
                fontFamily: SANS,
                fontSize: 13,
                lineHeight: 1.35,
                color: "var(--text)",
                display: "flex",
                alignItems: "center",
                gap: 7,
                width: "100%",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = hexToRgba(accent, 0.09);
                e.currentTarget.style.color = accent;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--text)";
              }}
            >
              {dot && (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: dot,
                    flex: "0 0 auto",
                  }}
                />
              )}
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ---- one row in the list ----
function TableRow({
  table,
  accent,
  softAccent,
  softAccentBorder,
  onOpen,
  onDelete,
}: {
  table: StudyTable;
  accent: string;
  softAccent: string;
  softAccentBorder: string;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const count = table.cards.length;
  const purpose = table.purpose
    ? table.purpose.charAt(0).toUpperCase() + table.purpose.slice(1)
    : null;
  return (
    <div
      onClick={onOpen}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 16px",
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--panel)",
        cursor: "pointer",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 16.5,
            fontWeight: 600,
            color: "var(--text)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {table.name || "Untitled"}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 3,
            fontFamily: SANS,
            fontSize: 12,
            color: "var(--muted)",
            flexWrap: "wrap",
          }}
        >
          {purpose && (
            <span
              style={{
                color: accent,
                background: softAccent,
                border: "1px solid " + softAccentBorder,
                borderRadius: 999,
                padding: "1px 9px",
                fontWeight: 600,
                fontSize: 11,
              }}
            >
              {purpose}
            </span>
          )}
          <span>
            {count} {count === 1 ? "card" : "cards"}
          </span>
          <span>· edited {relTime(table.updatedAt)}</span>
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete"
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "transparent",
          color: "var(--muted)",
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
          lineHeight: 0,
          flex: "0 0 auto",
        }}
      >
        <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M19 6l-1 14H6L5 6" />
        </svg>
      </button>
    </div>
  );
}

// ---- delete confirmation ----
function ConfirmDelete({
  name,
  onCancel,
  onConfirm,
  accent,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
  accent: string;
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(30,25,15,.4)",
        display: "grid",
        placeItems: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: 22,
          maxWidth: 380,
          width: "100%",
          boxShadow: "0 24px 60px -20px rgba(30,25,10,.5)",
        }}
      >
        <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
          Delete this table?
        </div>
        <div style={{ fontFamily: SANS, fontSize: 13.5, color: "var(--muted)", marginBottom: 20, lineHeight: 1.5 }}>
          “{name || "Untitled"}” and its cards will be removed. This can’t be undone.
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              fontFamily: SANS,
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
              color: "var(--text)",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 9,
              padding: "9px 16px",
            }}
          >
            Keep it
          </button>
          <button
            onClick={onConfirm}
            style={{
              fontFamily: SANS,
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
              color: "#fff",
              background: "var(--pen1)",
              border: 0,
              borderRadius: 9,
              padding: "9px 16px",
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
