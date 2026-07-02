import { useState } from "react";
import { getScriptures, volumesProxy } from "../data/scripturesStore";
import { Mark, MarkColor, MarkStyle, markStyleCSS } from "../types";
import { Tab } from "../types";

interface DistilledProps {
  tabs: Tab[];
  compileTabs: Tab[];
  compileSelection: string[];
  onToggleCompileTab: (id: string) => void;
  hideTabPicker?: boolean;
  marks: Mark[];
  colorLabels: Record<number, string>;
  setColorLabel: (color: MarkColor, label: string) => void;
  onJumpToReference: (reference: string) => void;
}

const vols = volumesProxy;

export default function Distilled(props: DistilledProps) {
  const { compileTabs, marks, onJumpToReference } = props;
  // Collapse the chapter list by default for multi-chapter studies.
  const [showChapters, setShowChapters] = useState(false);

  const tabLabel = (t: Tab) =>
    vols[t.volume].books[t.book].book +
    " " +
    vols[t.volume].books[t.book].chapters[t.chapter].chapter;

  type Entry = {
    reference: string;
    verse: number;
    text: string;
    v: number;
    b: number;
    c: number;
  };

  // Every verse in the selected chapters, ordered canonically.
  const entries: Entry[] = [];
  compileTabs.forEach((t) => {
    const book = vols[t.volume].books[t.book];
    const chapter = book.chapters[t.chapter];
    chapter.verses.forEach((vv) => {
      entries.push({
        reference: vv.reference,
        verse: vv.verse,
        text: vv.text,
        v: t.volume,
        b: t.book,
        c: t.chapter,
      });
    });
  });
  entries.sort(
    (a, b) => a.v - b.v || a.b - b.b || a.c - b.c || a.verse - b.verse
  );

  const selectedRefs = new Set(entries.map((e) => e.reference));
  const relevantMarks = marks.filter((m) => selectedRefs.has(m.reference));
  const noMarks = relevantMarks.length === 0;

  type Frag = {
    text: string;
    style: MarkStyle;
    color: MarkColor;
    gapBefore: boolean;
  };

  // Ordered, non-overlapping marked fragments for one verse — each keeps the
  // color/style it was marked with; a gap means unmarked words were skipped.
  const fragmentsFor = (reference: string, text: string): Frag[] => {
    const ms = relevantMarks
      .filter((m) => m.reference === reference)
      .slice()
      .sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex);
    const frags: Frag[] = [];
    let covered = 0;
    ms.forEach((m) => {
      const start = Math.max(0, Math.min(m.startIndex, text.length));
      const end = Math.max(start, Math.min(m.endIndex, text.length));
      const from = Math.max(start, covered);
      if (end <= from) return;
      const piece = text.slice(from, end).replace(/\s+/g, " ").trim();
      const gapBefore = frags.length > 0 && start > covered;
      covered = end;
      if (!piece) return;
      frags.push({ text: piece, style: m.style, color: m.color, gapBefore });
    });
    return frags;
  };

  const distilled = entries
    .map((e) => ({ e, frags: fragmentsFor(e.reference, e.text) }))
    .filter((x) => x.frags.length > 0);

  return (
    <div
      style={{ padding: "20px 20px 90px", maxWidth: "760px", margin: "0 auto" }}
    >
      <div
        style={{
          fontSize: "11px",
          letterSpacing: "2px",
          textTransform: "uppercase",
          color: "var(--muted)",
          fontWeight: 700,
          marginBottom: "6px",
        }}
      >
        Distilled
      </div>
      {compileTabs.length === 0 ? (
        <h2 style={{ margin: "0 0 6px 0", fontWeight: 500 }}>Nothing selected</h2>
      ) : compileTabs.length <= 1 ? (
        <h2 style={{ margin: "0 0 6px 0", fontWeight: 500 }}>
          {compileTabs.map(tabLabel).join("  ·  ")}
        </h2>
      ) : (
        <div style={{ margin: "0 0 6px 0" }}>
          <button
            onClick={() => setShowChapters((s) => !s)}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontFamily: "inherit",
              color: "inherit",
              fontSize: "18px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            {compileTabs.length + " chapters"}
            <span style={{ fontSize: "11px", color: "var(--muted)" }}>
              {showChapters ? "▲" : "▾"}
            </span>
          </button>
          {showChapters && (
            <div
              style={{
                marginTop: "8px",
                fontSize: "13px",
                lineHeight: 1.5,
                color: "var(--muted)",
              }}
            >
              {compileTabs.map(tabLabel).join("  ·  ")}
            </div>
          )}
        </div>
      )}
      <p
        style={{
          fontSize: "12.5px",
          color: "var(--muted)",
          marginBottom: "26px",
          lineHeight: 1.5,
        }}
      >
        Your highlights, read as one — scripture pared down to the words you
        marked.
      </p>

      {compileTabs.length === 0 && (
        <p style={{ color: "var(--muted)", textAlign: "center", padding: "40px" }}>
          Select at least one chapter to distill.
        </p>
      )}
      {compileTabs.length > 0 && noMarks && (
        <p style={{ color: "var(--muted)", textAlign: "center", padding: "40px" }}>
          Highlight verses and they'll be distilled here.
        </p>
      )}

      {distilled.length > 0 && (
        <div
          style={{
            fontFamily: '"Times New Roman", Times, serif',
            fontSize: "20px",
            lineHeight: 2,
          }}
        >
          {distilled.map(({ e, frags }, vi) => (
            <span key={e.reference} data-vref={e.reference}>
              {frags.map((f, i) => (
                <span key={i}>
                  {f.gapBefore && (
                    <span
                      style={{
                        color: "var(--muted)",
                        margin: "0 7px",
                        fontFamily: "system-ui, sans-serif",
                        fontSize: "14px",
                      }}
                    >
                      …
                    </span>
                  )}
                  {i > 0 && !f.gapBefore && " "}
                  <span style={markStyleCSS(f.style, f.color)}>{f.text}</span>
                </span>
              ))}
              <span
                onClick={() => onJumpToReference(e.reference)}
                title="Open in reading view"
                style={{
                  fontFamily: "system-ui, sans-serif",
                  fontSize: "11px",
                  color: "var(--muted)",
                  cursor: "pointer",
                  verticalAlign: "super",
                  marginLeft: "5px",
                  marginRight: vi < distilled.length - 1 ? "10px" : 0,
                  textDecoration: "underline",
                  textDecorationStyle: "dotted",
                  whiteSpace: "nowrap",
                }}
              >
                {e.reference}
              </span>{" "}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
