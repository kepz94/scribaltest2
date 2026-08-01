import { useEffect, useState } from "react";
import { StudyTable, TableCard, newCardId } from "../hooks/useStudyTables";
import StudyTableColumn from "./StudyTableColumn";
import VersePicker from "./VersePicker";
import type { ThemeMark } from "./SearchPanel";
import MarkedVerse from "./MarkedVerse";
import { Mark, WordTag } from "../types";
import { getVerse } from "../data/verseIndex";

// The mobile study-table editor: a full-screen sheet with the same column the
// desktop uses (same cards, same behaviors), plus the verse panel rendered as
// a full-screen overlay. Marking still happens in the reader (the mobile mark
// screen is a later step) — cards show whatever marks their book carries.


interface Props {
  table: StudyTable;
  onClose: () => void;
  onPresent: () => void;
  // "Send a copy" — hands this table to someone else as a code. The shell owns
  // the sheet (it owns the share transport); this is just the button.
  onSendCopy?: () => void;
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
  chapterGroups: Record<string, string>;
  // Dictionary word-tags for card verses; tapping opens the definition sheet.
  wordTags?: WordTag[];
  onTagTap?: (tag: WordTag) => void;
  // Open with the verse panel on Selected (used right after an import, so the
  // imported themes are waiting on screen).
  initialShelfOpen?: boolean;
  // Per-card "Mark": jump the mobile reader to this card's verse (in its book)
  // so its marking can be edited with the full toolbar.
  onMarkCard?: (card: TableCard) => void;
  accent?: string;
}

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF =
  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif';

export default function StudyTablesMobile({
  table,
  onClose,
  onPresent,
  onSendCopy,
  updateTable,
  renameTable,
  onDelete,
  allMarks,
  getBook,
  books,
  chapterGroups,
  wordTags,
  onTagTap,
  initialShelfOpen,
  onMarkCard,
  accent = "#8b5cf6",
}: Props) {
  // Save indicator: edits persist instantly; flash "Saved" when they do.
  const [saveFlash, setSaveFlash] = useState(false);
  useEffect(() => {
    if (!table.updatedAt) return;
    setSaveFlash(true);
    const t = window.setTimeout(() => setSaveFlash(false), 1200);
    return () => window.clearTimeout(t);
  }, [table.updatedAt]);
  const [panelOpen, setPanelOpen] = useState(!!initialShelfOpen);
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
        tags={wordTags}
        onTagTap={onTagTap}
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
  // The column's own tray (the "N waiting" pill) places a card either at an
  // exact drop index or, with none, at the end of the column. It shares the
  // shelf with the picker's Selected drawer — same cards, two ways in.
  const placeFromShelf = (cardId: string, index?: number) => {
    const shelf = table.shelf || [];
    const card = shelf.find((c) => c.id === cardId);
    if (!card) return;
    const at =
      index !== undefined
        ? Math.max(0, Math.min(index, table.cards.length))
        : table.cards.length;
    // Placement is what turns an arrival into an authored card — the
    // tray-only fields go with it.
    const placed = { ...card };
    delete placed.shelfSource;
    delete placed.arrivedAt;
    updateTable(table.id, {
      cards: [
        ...table.cards.slice(0, at),
        placed,
        ...table.cards.slice(at),
      ],
      shelf: shelf.filter((c) => c.id !== cardId),
    });
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
      className="st-mobile"
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
      {/* iOS auto-zooms (and a standalone PWA can't zoom back out) whenever a
          focused input's font-size is under 16px. Force every field in this
          editor — including the verse panel rendered inside it — to 16px so
          the trigger can't exist. Stylesheet !important outranks the inline
          sizes the shared components carry. */}
      <style>{`.st-mobile input, .st-mobile textarea { font-size: 16px !important; }`}</style>
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
        <span
          title="Every change saves automatically"
          style={{
            fontFamily: SANS,
            fontSize: 10.5,
            fontWeight: 700,
            color: saveFlash ? accent : "var(--muted)",
            flex: "0 0 auto",
            transition: "color .2s ease",
          }}
        >
          ✓{saveFlash ? " Saved" : ""}
        </span>
        {onSendCopy && (
          <button
            onClick={onSendCopy}
            disabled={table.cards.length === 0}
            aria-label="Send a copy"
            title="Send someone their own copy"
            style={{
              ...iconBtn,
              borderColor: accent,
              color: accent,
              opacity: table.cards.length === 0 ? 0.4 : 1,
            }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
              <path d="M12 15V3" />
              <path d="M8 7l4-4 4 4" />
            </svg>
          </button>
        )}
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
          onMarkCard={onMarkCard}
          themesFor={cardThemes}
          shelf={table.shelf || []}
          onPlaceFromShelf={placeFromShelf}
          verseTextFor={(reference) => getVerse(reference)?.text || ""}
        />
      </div>

      {panelOpen && (
        <VersePicker
          onAdd={addVerses}
          renderVerse={renderVerse}
          allMarks={allMarks}
          books={books}
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
          themeLabelFor={(ref, color, bookId) => {
            const bk = getBook(bookId || table.bookId || "master");
            const scoped =
              bk.scopedLabels?.[resolve(scopeOfRef(ref))]?.[color];
            return ((scoped || "") as string).trim();
          }}
          initialTab={initialShelfOpen ? "shelf" : undefined}
          fullScreen
        />
      )}
    </div>
  );
}
