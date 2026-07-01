import { useCallback, useState } from "react";
import { StudyTable, TableCard, newCardId } from "../hooks/useStudyTables";
import StudyTableColumn from "./StudyTableColumn";
import VersePicker from "./VersePicker";
import type { StudyMeta, StudyTheme } from "./VersePicker";
import type { ThemeMark } from "./SearchPanel";
import MarkedVerse from "./MarkedVerse";
import { Mark, MarkColor } from "../types";
import { getVerse, sortRefs } from "../data/verseIndex";

// The mobile study-table editor: a full-screen sheet with the same column the
// desktop uses (same cards, same behaviors), plus the verse panel rendered as
// a full-screen overlay. Marking still happens in the reader (the mobile mark
// screen is a later step) — cards show whatever marks their book carries.

// Structural prop types (mobile keeps its own Study/SearchStudy interfaces, so
// the editor asks only for the fields it actually uses).
interface RecStudyLike {
  id: string;
  name: string;
  bookId: string;
  type: "chapter" | "linked";
  scopeRef: string;
  extraRefs?: string[];
}
interface KwStudyLike {
  id: string;
  name: string;
  bookId: string;
  refs: string[];
}

interface Props {
  table: StudyTable;
  onClose: () => void;
  onPresent: () => void;
  updateTable: (
    id: string,
    changes: Partial<Pick<StudyTable, "name" | "cards" | "purpose" | "shelf">>
  ) => void;
  renameTable: (id: string, name: string) => void;
  onDelete: () => void;
  allMarks: ThemeMark[];
  getBook: (id: string) => {
    marks: Mark[];
    colorLabels?: Record<number, string>;
    scopedLabels?: Record<string, Record<number, string>>;
  };
  books: { id: string; name: string; isMaster: boolean; markCount: number }[];
  recordedStudies: RecStudyLike[];
  searchStudies: KwStudyLike[];
  chapterGroups: Record<string, string>;
  accent?: string;
}

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF =
  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif';

export default function StudyTablesMobile({
  table,
  onClose,
  onPresent,
  updateTable,
  renameTable,
  onDelete,
  allMarks,
  getBook,
  books,
  recordedStudies,
  searchStudies,
  chapterGroups,
  accent = "#8b5cf6",
}: Props) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);

  const scopeOfRef = (ref: string) => {
    const ix = ref.indexOf(":");
    return ix < 0 ? ref : ref.slice(0, ix);
  };
  const resolve = (cs: string) =>
    chapterGroups[cs] ? "group:" + chapterGroups[cs] : cs;

  const renderVerse = (reference: string, bookId?: string) => {
    const rec = getVerse(reference);
    if (!rec)
      return (
        <span style={{ color: "var(--muted)", fontStyle: "italic" }}>
          {reference} — not found
        </span>
      );
    return (
      <MarkedVerse
        reference={reference}
        verseNumber={rec.verse}
        text={rec.text}
        marks={bookId ? getBook(bookId).marks : []}
      />
    );
  };

  // Theme chips for a scripture card — scoped labels only, same as desktop.
  const cardThemes = (
    refs: string[],
    bookId?: string
  ): { color: number; label: string }[] => {
    if (!refs.length) return [];
    const bk = getBook(bookId || table.bookId || "master");
    const refset = new Set(refs);
    const seen = new Map<number, string>();
    bk.marks.forEach((m) => {
      if (!refset.has(m.reference) || seen.has(m.color)) return;
      const scoped =
        bk.scopedLabels?.[resolve(scopeOfRef(m.reference))]?.[m.color];
      seen.set(m.color, ((scoped || "") as string).trim());
    });
    return Array.from(seen.entries())
      .filter(([, label]) => !!label)
      .sort((a, b) => a[0] - b[0])
      .map(([color, label]) => ({ color, label }));
  };

  // The verse panel's study list + per-study theme grouping (desktop's logic).
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
  const studyThemes = useCallback(
    (studyId: string): StudyTheme[] => {
      const rec = recordedStudies.find((s) => s.id === studyId);
      const kw = searchStudies.find((s) => s.id === studyId);
      const study = rec || kw;
      if (!study) return [];
      const bookId = study.bookId;
      let inScope: (ref: string) => boolean;
      if (kw) {
        const set = new Set(kw.refs);
        inScope = (r) => set.has(r);
      } else if (rec && rec.type === "linked") {
        const chapters = new Set(
          Object.keys(chapterGroups).filter(
            (cs) => chapterGroups[cs] === rec.scopeRef
          )
        );
        const extra = new Set(rec.extraRefs || []);
        inScope = (r) => chapters.has(scopeOfRef(r)) || extra.has(r);
      } else {
        const extra = new Set((rec && rec.extraRefs) || []);
        inScope = (r) =>
          scopeOfRef(r) === (rec ? rec.scopeRef : "") || extra.has(r);
      }
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
        const scoped = bk.scopedLabels?.[resolve(scopeOfRef(ref))]?.[color];
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
    // eslint may not track these helpers; the arrays are the real inputs.
    [recordedStudies, searchStudies, chapterGroups, allMarks, getBook]
  );

  const makeScriptureCards = (
    refs: string[],
    asPassage: boolean,
    bookId?: string
  ): TableCard[] => {
    const bid = bookId || table.bookId || undefined;
    return asPassage
      ? [{ id: newCardId(), kind: "scripture", refs, passage: true, bookId: bid }]
      : refs.map((r) => ({
          id: newCardId(),
          kind: "scripture",
          refs: [r],
          bookId: bid,
        }));
  };
  const addVerses = (refs: string[], asPassage: boolean, bookId?: string) => {
    if (refs.length === 0) return;
    const newCards = makeScriptureCards(refs, asPassage, bookId);
    const idx = Math.max(
      0,
      Math.min(pendingIndex ?? table.cards.length, table.cards.length)
    );
    updateTable(table.id, {
      cards: [...table.cards.slice(0, idx), ...newCards, ...table.cards.slice(idx)],
    });
    setPendingIndex(idx + newCards.length);
  };
  const shelve = (refs: string[], asPassage: boolean, bookId?: string) => {
    if (refs.length === 0) return;
    updateTable(table.id, {
      shelf: [...(table.shelf || []), ...makeScriptureCards(refs, asPassage, bookId)],
    });
  };
  const unshelve = (cardId: string) =>
    updateTable(table.id, {
      shelf: (table.shelf || []).filter((c) => c.id !== cardId),
    });
  const shelfToColumn = (cardId: string) => {
    const shelf = table.shelf || [];
    const card = shelf.find((c) => c.id === cardId);
    if (!card) return;
    const idx = Math.max(
      0,
      Math.min(pendingIndex ?? table.cards.length, table.cards.length)
    );
    updateTable(table.id, {
      cards: [...table.cards.slice(0, idx), card, ...table.cards.slice(idx)],
      shelf: shelf.filter((c) => c.id !== cardId),
    });
    setPendingIndex(idx + 1);
  };
  const shelfAllToColumn = () => {
    const shelf = table.shelf || [];
    if (shelf.length === 0) return;
    const idx = Math.max(
      0,
      Math.min(pendingIndex ?? table.cards.length, table.cards.length)
    );
    updateTable(table.id, {
      cards: [...table.cards.slice(0, idx), ...shelf, ...table.cards.slice(idx)],
      shelf: [],
    });
    setPendingIndex(idx + shelf.length);
  };
  const openPanelAt = (index: number) => {
    setPendingIndex(index);
    setPanelOpen(true);
  };

  const iconBtn: React.CSSProperties = {
    width: 34,
    height: 34,
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--panel)",
    color: "var(--muted)",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    lineHeight: 0,
    flex: "0 0 auto",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 260,
        background: "var(--bg)",
        color: "var(--text)",
        display: "flex",
        flexDirection: "column",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      {/* header: back · name · present · delete */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          borderBottom: "1px solid var(--border)",
          flex: "0 0 auto",
        }}
      >
        <button onClick={onClose} aria-label="Back" style={iconBtn}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <input
          value={table.name}
          placeholder="Untitled"
          onChange={(e) => renameTable(table.id, e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            height: 36,
            padding: "0 10px",
            borderRadius: 9,
            border: "1px solid var(--border)",
            background: "var(--panel)",
            color: "var(--text)",
            fontFamily: SERIF,
            fontSize: 16,
            fontWeight: 600,
            outline: "none",
          }}
        />
        <button
          onClick={onPresent}
          disabled={table.cards.length === 0}
          aria-label="Present"
          style={{
            ...iconBtn,
            border: 0,
            background: accent,
            color: "#fff",
            opacity: table.cards.length === 0 ? 0.4 : 1,
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="currentColor"
            stroke="none"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
        <button onClick={onDelete} aria-label="Delete table" style={iconBtn}>
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6" />
          </svg>
        </button>
      </div>

      {/* the column */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          padding: "14px 12px calc(90px + env(safe-area-inset-bottom))",
        }}
      >
        <StudyTableColumn
          cards={table.cards}
          onChange={(cards) => updateTable(table.id, { cards })}
          accent={accent}
          renderVerse={renderVerse}
          onPickScripture={openPanelAt}
          themesFor={cardThemes}
        />
      </div>

      {panelOpen && (
        <VersePicker
          onAdd={addVerses}
          renderVerse={renderVerse}
          allMarks={allMarks}
          books={books}
          studies={studyMetas}
          studyThemes={studyThemes}
          shelf={table.shelf || []}
          onShelve={shelve}
          onUnshelve={unshelve}
          onShelfToColumn={shelfToColumn}
          onShelfAllToColumn={shelfAllToColumn}
          onClose={() => {
            setPanelOpen(false);
            setPendingIndex(null);
          }}
          accent={accent}
          defaultBookId={table.bookId}
          fullScreen
        />
      )}
    </div>
  );
}
