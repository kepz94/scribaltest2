import { useState, useCallback, useEffect } from "react";
import { ACCENT } from "../theme";
import { Mark, MarkColor } from "../types";
import {
  StudyTable,
  TablePurpose,
  TableCard,
  newCardId,
} from "../hooks/useStudyTables";
import type { Study } from "../hooks/useStudies";
import type { SearchStudy } from "../hooks/useSearchStudies";
import StudyTableColumn from "./StudyTableColumn";
import StudyTablePresent from "./StudyTablePresent";
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
import { getVerse, sortRefs } from "../data/verseIndex";

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
    changes: Partial<Pick<StudyTable, "name" | "cards" | "purpose" | "shelf">>
  ) => void;
  renameTable: (id: string, name: string) => void;
  deleteTable: (id: string) => void;
  // Create a new session book (for "start from scratch" → new session): the
  // shell owns useMarks, so book creation happens there. Returns the book id.
  createSession: (name: string) => string;
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
  openTableId,
  onConsumeOpenTable,
  onMarkVerses,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  // Deep-link: when the shell asks for a specific table (e.g. tapped in the
  // Studies hub), open it and clear the request.
  useEffect(() => {
    if (openTableId) {
      setOpenId(openTableId);
      onConsumeOpenTable?.();
    }
  }, [openTableId]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // Save indicator: every edit persists instantly; this makes that visible.
  // Flashes "Saving…" → "Saved" whenever the open table's updatedAt moves.
  const [saveFlash, setSaveFlash] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  // "+ Verse" on a card: while set, picked verses APPEND to this card instead
  // of becoming new cards — several verses on one card, presented together.
  const [panelCardId, setPanelCardId] = useState<string | null>(null);
  // Where the verse panel will drop cards: the chooser gap that opened it.
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  // Which tab the verse panel opens on. Import lands on the shelf ("Selected").
  const [panelTab, setPanelTab] =
    useState<"study" | "search" | "shelf">("search");
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


  // Smooth-scroll a card into view (used by the outline rail).
  const scrollToCard = (id: string) => {
    const el = document.querySelector('[data-card-id="' + id + '"]');
    if (el)
      (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // Render one verse's text + the marks from a specific book (undefined = an
  // empty, unmarked verse). Same MarkedVerse the reader uses + that book's real
  // marks, so a card shows exactly the marking that book has on the verse.
  const renderVerse = (reference: string, bookId?: string): React.ReactNode => {
    const rec = getVerse(reference);
    if (!rec)
      return (
        <span style={{ color: "var(--muted)", fontStyle: "italic" }}>
          {reference} — not found
        </span>
      );
    const bookMarks = bookId ? getBook(bookId).marks : [];
    return (
      <MarkedVerse
        reference={reference}
        verseNumber={rec.verse}
        text={rec.text}
        marks={bookMarks}
      />
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
  const addVerses = (refs: string[], asPassage: boolean, bookId?: string) => {
    if (!open || refs.length === 0) return;
    if (panelCardId) {
      const card = open.cards.find((c) => c.id === panelCardId);
      if (card && card.kind === "scripture") {
        const merged = [
          ...(card.refs || []),
          ...refs.filter((r) => !(card.refs || []).includes(r)),
        ];
        updateTable(open.id, {
          cards: open.cards.map((c) =>
            c.id === panelCardId ? { ...c, refs: merged } : c
          ),
        });
        return;
      }
    }
    const newCards = makeScriptureCards(refs, asPassage, bookId);
    const idx = Math.max(0, Math.min(pendingIndex ?? open.cards.length, open.cards.length));
    updateTable(open.id, {
      cards: [...open.cards.slice(0, idx), ...newCards, ...open.cards.slice(idx)],
    });
    setPendingIndex(idx + newCards.length);
  };

  // ---- staging shelf: set verses aside, then place them later ----
  const shelve = (refs: string[], asPassage: boolean, bookId?: string) => {
    if (!open || refs.length === 0) return;
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
    const idx = Math.max(0, Math.min(pendingIndex ?? open.cards.length, open.cards.length));
    updateTable(open.id, {
      cards: [...open.cards.slice(0, idx), card, ...open.cards.slice(idx)],
      shelf: shelf.filter((c) => c.id !== cardId),
    });
    setPendingIndex(idx + 1);
  };
  const shelfAllToColumn = () => {
    if (!open) return;
    const shelf = open.shelf || [];
    if (shelf.length === 0) return;
    const idx = Math.max(0, Math.min(pendingIndex ?? open.cards.length, open.cards.length));
    updateTable(open.id, {
      cards: [...open.cards.slice(0, idx), ...shelf, ...open.cards.slice(idx)],
      shelf: [],
    });
    setPendingIndex(idx + shelf.length);
  };

  // Open the verse panel to add a scripture card at a given gap.
  const openPanelAt = (index: number) => {
    setPanelCardId(null);
    setPendingIndex(index);
    setPanelTab("search");
    setPanelOpen(true);
  };
  // "+ Verse" on a card: the panel appends picked verses to that card.
  const openPanelForCard = (cardId: string) => {
    setPendingIndex(null);
    setPanelCardId(cardId);
    setPanelTab("search");
    setPanelOpen(true);
  };
  const closePanel = () => {
    setPanelOpen(false);
    setPendingIndex(null);
    setPanelCardId(null);
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
      ...open.cards,
      ...(open.shelf || []),
    ]);
    onMarkVerses(refs, refBook, "Mark verses · " + (open.name || "table"));
  };
  const markCardVerses = (card: TableCard) => {
    if (!onMarkVerses || card.kind !== "scripture" || !(card.refs || []).length)
      return;
    const { refs, refBook } = collectMarkTargets([card]);
    onMarkVerses(refs, refBook, "Mark verse");
  };
  const markTargetCount = open
    ? collectMarkTargets([...open.cards, ...(open.shelf || [])]).refs.length
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
    const refs = sortRefs(
      Array.from(new Set(studyThemes(meta.id).flatMap((t) => t.refs)))
    );
    const id = createTable(
      meta.name?.trim() || "Untitled",
      undefined,
      meta.bookId
    );
    if (refs.length) {
      const cards: TableCard[] = refs.map((r) => ({
        id: newCardId(),
        kind: "scripture" as const,
        refs: [r],
        bookId: meta.bookId,
      }));
      updateTable(id, { shelf: cards });
    }
    setOpenId(id);
    setPendingIndex(0);
    setPanelTab("shelf");
    setPanelOpen(true);
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
    const sections = open.cards.filter((c) => c.kind === "heading");
    const hasRail = sections.length > 0;
    const editorMax = 780 + (hasRail ? 200 : 0) + (panelOpen ? 386 : 0);
    return (
      <div style={{ maxWidth: editorMax, margin: "0 auto", padding: "16px 16px 120px" }}>
        {/* editor top bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
          <button
            onClick={() => {
              setExample(null);
              setOpenId(null);
            }}
            style={iconBtn}
            title="Back to your tables"
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
            onClick={() => open.cards.length > 0 && setPresenting(true)}
            disabled={open.cards.length === 0}
            title={
              open.cards.length === 0
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
              opacity: open.cards.length === 0 ? 0.4 : 1,
              cursor: open.cards.length === 0 ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            <Ico d="M8 5v14l11-7z" size={13} /> Present
          </button>
          <button
            onClick={() => setConfirmId(open.id)}
            style={iconBtn}
            title="Delete this table"
          >
            <Ico d="M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6" />
          </button>
        </div>

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

        {/* three-zone body: outline rail (appears once you add sections) + column */}
        <div style={{ display: "flex", gap: 26, alignItems: "flex-start" }}>
          {hasRail && (
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
              cards={open.cards}
              onChange={(cards) => updateTable(open.id, { cards })}
              accent={accent}
              renderVerse={renderVerse}
              onPickScripture={openPanelAt}
              onAddToCard={openPanelForCard}
              onMarkCard={onMarkVerses ? markCardVerses : undefined}
              themesFor={cardThemes}
            />
          </div>
          {panelOpen && (
            <VersePicker
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
              initialTab={panelTab}
              defaultBookId={open.bookId}
            />
          )}
        </div>

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
            table={open}
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
                [...open.cards, ...(open.shelf || [])].forEach((c) => {
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
                  tableJson: JSON.stringify(redactTableForRoom(open)),
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
                        {b.isMaster ? "Master Book" : b.name || "Session"}
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
          const label = (s.text || "").trim() || "Untitled section";
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
                display: "block",
                width: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
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
              {label}
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
