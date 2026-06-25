import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import scriptures from "../data/scriptures.json";
import MarkedVerse from "./MarkedVerse";
import NoteField from "./NoteField";
import {
  Mark,
  MarkColor,
  COLORS,
  COLOR_MAP,
  STYLE_POINTS,
  markStyleCSS,
} from "../types";
import { Tab } from "../types";

interface OutlineProps {
  tabs: Tab[];
  compileTabs: Tab[];
  compileSelection: string[];
  onToggleCompileTab: (id: string) => void;
  hideTabPicker?: boolean;
  marks: Mark[];
  colorLabels: Record<number, string>;
  setColorLabel: (color: MarkColor, label: string) => void;
  notes: Record<string, string>;
  setNote: (key: string, text: string) => void;
  onJumpToReference: (reference: string) => void;
  // Optional controlled collapse state — the colors whose theme sections are
  // collapsed. When supplied, the parent owns it, so a quick-find result can
  // open a collapsed section before scrolling to that verse's card. Falls back
  // to local state when omitted, so the view still works on its own.
  collapsed?: number[];
  onCollapsedChange?: Dispatch<SetStateAction<number[]>>;
}

type SortMode = "points" | "order";
const vols = scriptures.volumes;

const toRoman = (num: number) => {
  const map: [number, string][] = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let n = num;
  let out = "";
  for (const [v, s] of map) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
};
const toAlpha = (i: number) => {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

export default function Outline(props: OutlineProps) {
  const {
    tabs,
    compileTabs,
    compileSelection,
    onToggleCompileTab,
    hideTabPicker,
    marks,
    colorLabels,
    setColorLabel,
    notes,
    setNote,
    onJumpToReference,
  } = props;

  const [sortMode, setSortMode] = useState<SortMode>("points");
  const [view, setView] = useState<"full" | "focused">("focused");
  const [showChapters, setShowChapters] = useState(false);
  const [collapsedInternal, setCollapsedInternal] = useState<number[]>([]);
  const collapsed = props.collapsed ?? collapsedInternal;
  const setCollapsed = props.onCollapsedChange ?? setCollapsedInternal;

  const tabLabel = (t: Tab) =>
    vols[t.volume].books[t.book].book +
    " " +
    vols[t.volume].books[t.book].chapters[t.chapter].chapter;

  type VEntry = {
    chapterRef: string;
    reference: string;
    verse: number;
    text: string;
    order: number;
  };

  const allEntries: VEntry[] = [];
  compileTabs.forEach((t, ti) => {
    const book = vols[t.volume].books[t.book];
    const chapter = book.chapters[t.chapter];
    const chapterRef = book.book + " " + chapter.chapter;
    chapter.verses.forEach((v, i) => {
      allEntries.push({
        chapterRef,
        reference: v.reference,
        verse: v.verse,
        text: v.text,
        order: ti * 100000 + i,
      });
    });
  });

  const selectedRefs = new Set(allEntries.map((e) => e.reference));
  const relevantMarks = marks.filter((m) => selectedRefs.has(m.reference));
  const noMarks = relevantMarks.length === 0;

  const pointsFor = (reference: string, colorMarks: Mark[]) =>
    colorMarks
      .filter((m) => m.reference === reference)
      .reduce((s, m) => s + STYLE_POINTS[m.style], 0);

  const toggleCollapsed = (c: number) =>
    setCollapsed((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );

  const segButton = (active: boolean, label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px",
        border: "none",
        cursor: "pointer",
        fontSize: "12.5px",
        fontWeight: active ? 600 : 400,
        backgroundColor: active ? "var(--text)" : "transparent",
        color: active ? "var(--bg)" : "var(--muted)",
        transition: "all 0.15s",
      }}
    >
      {label}
    </button>
  );

  const numStyle: React.CSSProperties = {
    color: "var(--muted)",
    fontFamily: "system-ui, sans-serif",
    fontWeight: 600,
    flexShrink: 0,
  };

  return (
    <div
      style={{ padding: "20px 20px 80px", maxWidth: "860px", margin: "0 auto" }}
    >
      {/* Tab picker */}
      <div
        style={{
          backgroundColor: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "14px",
          padding: "14px 16px",
          marginBottom: "20px",
          display: hideTabPicker ? "none" : undefined,
        }}
      >
        <div
          style={{
            fontSize: "11px",
            letterSpacing: "2px",
            textTransform: "uppercase",
            color: "var(--muted)",
            marginBottom: "10px",
          }}
        >
          Choose what to compile
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {tabs.map((t) => {
            const on = compileSelection.includes(t.id);
            return (
              <button
                key={t.id}
                onClick={() => onToggleCompileTab(t.id)}
                style={{
                  padding: "8px 14px",
                  borderRadius: "999px",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: on ? 600 : 400,
                  border: "1px solid var(--border)",
                  backgroundColor: on ? "var(--text)" : "var(--soft)",
                  color: on ? "var(--bg)" : "var(--muted)",
                  display: "flex",
                  alignItems: "center",
                  gap: "7px",
                }}
              >
                <span
                  style={{
                    width: "14px",
                    height: "14px",
                    borderRadius: "4px",
                    border: "1px solid currentColor",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "10px",
                  }}
                >
                  {on ? "✓" : ""}
                </span>
                {tabLabel(t)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginBottom: "22px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: "150px" }}>
          <div
            style={{
              fontSize: "11px",
              letterSpacing: "2px",
              color: "var(--muted)",
              textTransform: "uppercase",
            }}
          >
            Outline
          </div>
          {compileTabs.length === 0 ? (
            <h2 style={{ margin: "2px 0 0 0", fontWeight: 500 }}>
              Nothing selected
            </h2>
          ) : compileTabs.length <= 1 ? (
            <h2 style={{ margin: "2px 0 0 0", fontWeight: 500 }}>
              {compileTabs.map(tabLabel).join("  ·  ")}
            </h2>
          ) : (
            <div style={{ margin: "2px 0 0 0" }}>
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
        </div>

        <div
          style={{
            display: "flex",
            border: "1px solid var(--border)",
            borderRadius: "999px",
            overflow: "hidden",
          }}
        >
          {segButton(view === "focused", "Focused", () => setView("focused"))}
          {segButton(view === "full", "Full verse", () => setView("full"))}
        </div>

        <div
          style={{
            display: "flex",
            border: "1px solid var(--border)",
            borderRadius: "999px",
            overflow: "hidden",
          }}
        >
          {segButton(sortMode === "points", "By points", () =>
            setSortMode("points")
          )}
          {segButton(sortMode === "order", "In order", () =>
            setSortMode("order")
          )}
        </div>

        <button onClick={() => setCollapsed([])} style={collapseBtn}>
          Expand all
        </button>
        <button
          onClick={() =>
            setCollapsed(
              COLORS.filter((c) => relevantMarks.some((m) => m.color === c))
            )
          }
          style={collapseBtn}
        >
          Collapse all
        </button>
      </div>

      {compileTabs.length === 0 && (
        <p
          style={{
            color: "var(--muted)",
            textAlign: "center",
            padding: "40px",
          }}
        >
          Select at least one tab above to outline.
        </p>
      )}
      {compileTabs.length > 0 && noMarks && (
        <p
          style={{
            color: "var(--muted)",
            textAlign: "center",
            padding: "40px",
          }}
        >
          No marks in the selected chapters yet.
        </p>
      )}

      {compileTabs.length > 0 && !noMarks && (
        <div
          style={{
            marginBottom: "24px",
            backgroundColor: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: "14px",
            padding: "20px 22px",
          }}
        >
          <h3 style={{ margin: "0 0 10px 0", fontWeight: 600 }}>Synthesis</h3>
          {(() => {
            const synthKey =
              "synthesis|" + compileTabs.map(tabLabel).join("+");
            return (
              <NoteField
                value={(notes && notes[synthKey]) || ""}
                onChange={(t) => setNote(synthKey, t)}
                accent="var(--text)"
                placeholder="State the main idea these verses support…"
                addLabel="Add your synthesis"
              />
            );
          })()}
        </div>
      )}

      {compileTabs.length > 0 &&
        !noMarks &&
        (() => {
          let themeIndex = 0;
          return COLORS.map((color) => {
            const colorMarks = relevantMarks.filter((m) => m.color === color);
            if (colorMarks.length === 0) return null;
            themeIndex++;

            const refs = Array.from(
              new Set(colorMarks.map((m) => m.reference))
            );
            let entries = allEntries.filter((e) => refs.includes(e.reference));
            if (sortMode === "points") {
              entries = [...entries].sort(
                (a, b) =>
                  pointsFor(b.reference, colorMarks) -
                  pointsFor(a.reference, colorMarks)
              );
            } else {
              entries = [...entries].sort((a, b) => a.order - b.order);
            }

            const totalPts = colorMarks.reduce(
              (s, m) => s + STYLE_POINTS[m.style],
              0
            );
            const isCollapsed = collapsed.includes(color);

            return (
              <section key={color} style={{ marginBottom: "24px" }}>
                {/* Level 1 — Theme */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    paddingBottom: "8px",
                    borderBottom: "2px solid " + COLOR_MAP[color],
                  }}
                >
                  <span
                    onClick={() => toggleCollapsed(color)}
                    style={{
                      cursor: "pointer",
                      color: "var(--muted)",
                      fontSize: "12px",
                      width: "14px",
                      transform: isCollapsed ? "rotate(-90deg)" : "none",
                      transition: "transform 0.15s",
                    }}
                  >
                    ▼
                  </span>
                  <span
                    style={{ ...numStyle, fontSize: "16px", minWidth: "28px" }}
                  >
                    {toRoman(themeIndex)}.
                  </span>
                  <span
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "50%",
                      backgroundColor: COLOR_MAP[color],
                      flexShrink: 0,
                    }}
                  />
                  <input
                    value={colorLabels[color] || ""}
                    onChange={(e) => setColorLabel(color, e.target.value)}
                    placeholder="Name this theme…"
                    style={{
                      border: "none",
                      outline: "none",
                      fontSize: "18px",
                      fontWeight: 600,
                      backgroundColor: "transparent",
                      flex: 1,
                      color: "var(--text)",
                    }}
                  />
                  <span
                    style={{
                      color: "var(--muted)",
                      fontSize: "12px",
                      fontFamily: "system-ui, sans-serif",
                    }}
                  >
                    {entries.length} · {totalPts} pts
                  </span>
                </div>

                {!isCollapsed &&
                  entries.map((entry, j) => {
                    const verseMarks = colorMarks
                      .filter((m) => m.reference === entry.reference)
                      .sort((a, b) => a.startIndex - b.startIndex);
                    const noteKey =
                      "note|" +
                      entry.chapterRef +
                      "|c" +
                      color +
                      "|" +
                      entry.reference;
                    const pts = pointsFor(entry.reference, colorMarks);

                    return (
                      <div
                        key={entry.reference}
                        data-vref={entry.reference}
                        style={{ marginLeft: "36px", marginTop: "14px" }}
                      >
                        {/* Level 2 — Verse */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "baseline",
                            gap: "8px",
                          }}
                        >
                          <span style={{ ...numStyle, minWidth: "22px" }}>
                            {toAlpha(j)}.
                          </span>
                          <span
                            onClick={() => onJumpToReference(entry.reference)}
                            style={{
                              fontSize: "14px",
                              fontWeight: 600,
                              color: "var(--text)",
                              cursor: "pointer",
                              textDecoration: "underline",
                              textDecorationStyle: "dotted",
                              fontFamily: "system-ui, sans-serif",
                            }}
                          >
                            {entry.reference} ↗
                          </span>
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 700,
                              color: COLOR_MAP[color],
                              backgroundColor: "var(--soft)",
                              borderRadius: "999px",
                              padding: "1px 8px",
                              fontFamily: "system-ui, sans-serif",
                            }}
                          >
                            +{pts}
                          </span>
                        </div>

                        {/* Level 3 — marked phrases / full verse */}
                        {view === "full" ? (
                          <div
                            style={{
                              marginLeft: "30px",
                              marginTop: "6px",
                              fontFamily: '"Times New Roman", Times, serif',
                              fontSize: "16px",
                              lineHeight: 1.85,
                            }}
                          >
                            <MarkedVerse
                              reference={entry.reference}
                              verseNumber={entry.verse}
                              text={entry.text}
                              marks={colorMarks}
                            />
                          </div>
                        ) : (
                          <div style={{ marginTop: "4px" }}>
                            {verseMarks.map((m, k) => (
                              <div
                                key={m.id}
                                style={{
                                  display: "flex",
                                  alignItems: "baseline",
                                  gap: "8px",
                                  marginLeft: "30px",
                                  marginTop: "3px",
                                }}
                              >
                                <span
                                  style={{
                                    ...numStyle,
                                    fontSize: "12px",
                                    minWidth: "18px",
                                  }}
                                >
                                  {k + 1}.
                                </span>
                                <span
                                  style={{
                                    fontFamily:
                                      '"Times New Roman", Times, serif',
                                    fontSize: "16px",
                                    lineHeight: 1.7,
                                    ...markStyleCSS(m.style, m.color),
                                  }}
                                >
                                  {m.markedText}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        <div style={{ marginLeft: "30px", marginTop: "8px" }}>
                          <NoteField
                            value={(notes && notes[noteKey]) || ""}
                            onChange={(t) => setNote(noteKey, t)}
                            accent={COLOR_MAP[color]}
                            placeholder="Write a note…"
                            addLabel="Add a note about this verse"
                          />
                        </div>
                      </div>
                    );
                  })}
              </section>
            );
          });
        })()}
    </div>
  );
}

const collapseBtn: React.CSSProperties = {
  padding: "7px 12px",
  borderRadius: "999px",
  border: "1px solid var(--border)",
  backgroundColor: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: "12px",
};
