import { useState } from "react";
import { ACCENT } from "../theme";
import { Mark } from "../types";
import {
  useStudyTables,
  StudyTable,
  TablePurpose,
  TableCard,
  newCardId,
} from "../hooks/useStudyTables";
import StudyTableColumn from "./StudyTableColumn";
import MarkedVerse from "./MarkedVerse";
import VersePicker from "./VersePicker";
import type { ThemeMark } from "./SearchPanel";
import { getVerse } from "../data/verseIndex";

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
  //  - getBook: a specific book's full marks, to render the chosen book's marking.
  //  - books: the book list, for the "Marks from" selector.
  allMarks: ThemeMark[];
  getBook: (id: string) => { marks: Mark[] };
  books: { id: string; name: string; isMaster: boolean; markCount: number }[];
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
}: Props) {
  const { tables, createTable, updateTable, renameTable, deleteTable } =
    useStudyTables();
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // Where the verse panel will drop cards: the chooser gap that opened it.
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);

  const softAccent = hexToRgba(accent, 0.1);
  const softAccentBorder = hexToRgba(accent, 0.28);

  const open = openId ? tables.find((t) => t.id === openId) || null : null;

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

  // Insert the picked verses as scripture cards at the spot the panel was opened
  // from (falling back to the end). Each card remembers which book its marks come
  // from (bookId), so it keeps rendering that book's marking. Consecutive adds in
  // one panel session stack in order at the insertion point.
  const addVerses = (refs: string[], asPassage: boolean, bookId?: string) => {
    if (!open || refs.length === 0) return;
    const newCards: TableCard[] = asPassage
      ? [{ id: newCardId(), kind: "scripture", refs, passage: true, bookId }]
      : refs.map((r) => ({ id: newCardId(), kind: "scripture", refs: [r], bookId }));
    const idx = Math.max(0, Math.min(pendingIndex ?? open.cards.length, open.cards.length));
    updateTable(open.id, {
      cards: [...open.cards.slice(0, idx), ...newCards, ...open.cards.slice(idx)],
    });
    setPendingIndex(idx + newCards.length);
  };

  // Open the verse panel to add a scripture card at a given gap.
  const openPanelAt = (index: number) => {
    setPendingIndex(index);
    setPanelOpen(true);
  };
  const closePanel = () => {
    setPanelOpen(false);
    setPendingIndex(null);
  };

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
          <button onClick={() => setOpenId(null)} style={iconBtn} title="Back to your tables">
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
          <button
            disabled
            title="Present mode arrives in a later step"
            style={{
              fontFamily: SANS,
              fontSize: 13,
              fontWeight: 650,
              color: "#fff",
              background: accent,
              border: 0,
              borderRadius: 999,
              padding: "9px 16px",
              opacity: 0.4,
              cursor: "not-allowed",
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
            />
          </div>
          {panelOpen && (
            <VersePicker
              onAdd={addVerses}
              renderVerse={renderVerse}
              allMarks={allMarks}
              books={books}
              onClose={closePanel}
              accent={accent}
              headerOffset={headerOffset}
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
          onClick={() => {
            const id = createTable();
            setOpenId(id);
          }}
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
