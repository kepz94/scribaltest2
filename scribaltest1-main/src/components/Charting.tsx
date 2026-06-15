import { useState } from "react";
import scriptures from "../data/scriptures.json";
import {
  Mark,
  MarkStyle,
  MarkColor,
  COLORS,
  COLOR_MAP,
  STYLE_POINTS,
  markStyleCSS,
} from "../types";
import { Tab } from "../types";

interface ChartingProps {
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

type ColMode = "themes" | "styles";
type RowSort = "book" | "points";
const vols = scriptures.volumes;

const STYLE_LIST: { style: MarkStyle; label: string }[] = [
  { style: "bold", label: "Bold" },
  { style: "circle", label: "Circle" },
  { style: "underline", label: "Underline" },
  { style: "italic", label: "Italic" },
  { style: "highlight", label: "Highlight" },
];

export default function Charting(props: ChartingProps) {
  const {
    tabs,
    compileTabs,
    compileSelection,
    onToggleCompileTab,
    hideTabPicker,
    marks,
    colorLabels,
    setColorLabel,
    onJumpToReference,
  } = props;

  const [colMode, setColMode] = useState<ColMode>("themes");
  const [rowSort, setRowSort] = useState<RowSort>("book");

  const tabLabel = (t: Tab) =>
    vols[t.volume].books[t.book].book +
    " " +
    vols[t.volume].books[t.book].chapters[t.chapter].chapter;

  type Row = {
    reference: string;
    verse: number;
    chapterRef: string;
    order: number;
  };

  const refMeta: Record<string, Row> = {};
  compileTabs.forEach((t, ti) => {
    const book = vols[t.volume].books[t.book];
    const chapter = book.chapters[t.chapter];
    const chapterRef = book.book + " " + chapter.chapter;
    chapter.verses.forEach((v, i) => {
      refMeta[v.reference] = {
        reference: v.reference,
        verse: v.verse,
        chapterRef,
        order: ti * 100000 + i,
      };
    });
  });

  const selectedRefs = new Set(Object.keys(refMeta));
  const relevantMarks = marks.filter((m) => selectedRefs.has(m.reference));
  const noMarks = relevantMarks.length === 0;

  const rowRefs = Array.from(new Set(relevantMarks.map((m) => m.reference)));
  let rows: Row[] = rowRefs.map((r) => refMeta[r]);
  const totalPointsFor = (ref: string) =>
    relevantMarks
      .filter((m) => m.reference === ref)
      .reduce((s, m) => s + STYLE_POINTS[m.style], 0);
  if (rowSort === "points") {
    rows = [...rows].sort(
      (a, b) => totalPointsFor(b.reference) - totalPointsFor(a.reference)
    );
  } else {
    rows = [...rows].sort((a, b) =>
      a.chapterRef !== b.chapterRef
        ? a.chapterRef.localeCompare(b.chapterRef)
        : a.order - b.order
    );
  }

  // Columns
  const usedColors = COLORS.filter((c) =>
    relevantMarks.some((m) => m.color === c)
  );
  const usedStyles = STYLE_LIST.filter((s) =>
    relevantMarks.some((m) => m.style === s.style)
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

  const cellMarks = (ref: string, key: MarkColor | MarkStyle) =>
    relevantMarks
      .filter((m) => (colMode === "themes" ? m.color === key : m.style === key))
      .filter((m) => m.reference === ref)
      .sort((a, b) => a.startIndex - b.startIndex);

  const th: React.CSSProperties = {
    padding: "10px 12px",
    borderBottom: "2px solid var(--border)",
    textAlign: "left",
    verticalAlign: "bottom",
    position: "sticky",
    top: 0,
    backgroundColor: "var(--panel)",
    zIndex: 2,
  };
  const td: React.CSSProperties = {
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
    verticalAlign: "top",
    minWidth: "150px",
  };

  const colKeys: (MarkColor | MarkStyle)[] =
    colMode === "themes" ? usedColors : usedStyles.map((s) => s.style);

  const colTotal = (key: MarkColor | MarkStyle) =>
    relevantMarks
      .filter((m) => (colMode === "themes" ? m.color === key : m.style === key))
      .reduce((s, m) => s + STYLE_POINTS[m.style], 0);

  return (
    <div
      style={{
        padding: "20px 20px 80px",
        maxWidth: "1100px",
        margin: "0 auto",
      }}
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
          Choose what to chart
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
          marginBottom: "18px",
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
            Chart
          </div>
          <h2 style={{ margin: "2px 0 0 0", fontWeight: 500 }}>
            {compileTabs.length === 0
              ? "Nothing selected"
              : compileTabs.map(tabLabel).join("  ·  ")}
          </h2>
        </div>

        <span style={{ fontSize: "12px", color: "var(--muted)" }}>Columns</span>
        <div
          style={{
            display: "flex",
            border: "1px solid var(--border)",
            borderRadius: "999px",
            overflow: "hidden",
          }}
        >
          {segButton(colMode === "themes", "Themes", () =>
            setColMode("themes")
          )}
          {segButton(colMode === "styles", "Styles", () =>
            setColMode("styles")
          )}
        </div>

        <span style={{ fontSize: "12px", color: "var(--muted)" }}>Rows</span>
        <div
          style={{
            display: "flex",
            border: "1px solid var(--border)",
            borderRadius: "999px",
            overflow: "hidden",
          }}
        >
          {segButton(rowSort === "book", "By book", () => setRowSort("book"))}
          {segButton(rowSort === "points", "By points", () =>
            setRowSort("points")
          )}
        </div>
      </div>

      {compileTabs.length === 0 && (
        <p
          style={{
            color: "var(--muted)",
            textAlign: "center",
            padding: "40px",
          }}
        >
          Select at least one tab above to chart.
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
            overflowX: "auto",
            border: "1px solid var(--border)",
            borderRadius: "14px",
            backgroundColor: "var(--panel)",
          }}
        >
          <table
            style={{
              borderCollapse: "collapse",
              width: "100%",
              fontSize: "14px",
            }}
          >
            <thead>
              <tr>
                <th style={{ ...th, minWidth: "120px" }}>
                  <span
                    style={{
                      fontSize: "11px",
                      letterSpacing: "1px",
                      textTransform: "uppercase",
                      color: "var(--muted)",
                    }}
                  >
                    Verse
                  </span>
                </th>
                {colMode === "themes"
                  ? usedColors.map((c) => (
                      <th key={c} style={th}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "7px",
                          }}
                        >
                          <span
                            style={{
                              width: "11px",
                              height: "11px",
                              borderRadius: "50%",
                              backgroundColor: COLOR_MAP[c],
                              flexShrink: 0,
                            }}
                          />
                          <input
                            value={colorLabels[c] || ""}
                            onChange={(e) => setColorLabel(c, e.target.value)}
                            placeholder={"Theme " + c}
                            style={{
                              border: "none",
                              outline: "none",
                              background: "transparent",
                              fontSize: "13px",
                              fontWeight: 600,
                              color: "var(--text)",
                              width: "110px",
                            }}
                          />
                        </div>
                        <div
                          style={{
                            fontSize: "10px",
                            color: "var(--muted)",
                            marginTop: "3px",
                            fontFamily: "system-ui, sans-serif",
                          }}
                        >
                          {colTotal(c)} pts
                        </div>
                      </th>
                    ))
                  : usedStyles.map((s) => (
                      <th key={s.style} style={th}>
                        <div style={{ fontWeight: 600, fontSize: "13px" }}>
                          {s.label}
                        </div>
                        <div
                          style={{
                            fontSize: "10px",
                            color: "var(--muted)",
                            marginTop: "3px",
                            fontFamily: "system-ui, sans-serif",
                          }}
                        >
                          +{STYLE_POINTS[s.style]} each · {colTotal(s.style)}{" "}
                          pts
                        </div>
                      </th>
                    ))}
                <th style={{ ...th, minWidth: "60px", textAlign: "right" }}>
                  <span
                    style={{
                      fontSize: "11px",
                      letterSpacing: "1px",
                      textTransform: "uppercase",
                      color: "var(--muted)",
                    }}
                  >
                    Total
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.reference}>
                  <td style={{ ...td, minWidth: "120px" }}>
                    <span
                      onClick={() => onJumpToReference(row.reference)}
                      style={{
                        fontSize: "13px",
                        fontWeight: 600,
                        color: "var(--text)",
                        cursor: "pointer",
                        textDecoration: "underline",
                        textDecorationStyle: "dotted",
                        fontFamily: "system-ui, sans-serif",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {row.reference} ↗
                    </span>
                  </td>
                  {colKeys.map((key) => {
                    const cm = cellMarks(row.reference, key);
                    const cellPts = cm.reduce(
                      (s, m) => s + STYLE_POINTS[m.style],
                      0
                    );
                    return (
                      <td
                        key={String(key)}
                        style={{
                          ...td,
                          backgroundColor:
                            cm.length > 0 ? "var(--soft)" : "transparent",
                        }}
                      >
                        {cm.length === 0 ? (
                          <span style={{ color: "var(--border)" }}>·</span>
                        ) : (
                          <div>
                            <div
                              style={{
                                fontFamily: '"Times New Roman", Times, serif',
                                fontSize: "14px",
                                lineHeight: 1.6,
                              }}
                            >
                              {cm.map((m, i) => (
                                <span key={m.id}>
                                  <span style={markStyleCSS(m.style, m.color)}>
                                    {m.markedText}
                                  </span>
                                  {i < cm.length - 1 && (
                                    <span
                                      style={{
                                        color: "var(--muted)",
                                        margin: "0 5px",
                                      }}
                                    >
                                      ·
                                    </span>
                                  )}
                                </span>
                              ))}
                            </div>
                            <div
                              style={{
                                fontSize: "10px",
                                fontWeight: 700,
                                color: "var(--muted)",
                                marginTop: "4px",
                                fontFamily: "system-ui, sans-serif",
                              }}
                            >
                              +{cellPts}
                            </div>
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td
                    style={{
                      ...td,
                      textAlign: "right",
                      fontWeight: 700,
                      fontFamily: "system-ui, sans-serif",
                      fontSize: "13px",
                    }}
                  >
                    {totalPointsFor(row.reference)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {compileTabs.length > 0 && !noMarks && (
        <p
          style={{
            fontSize: "11.5px",
            color: "var(--muted)",
            marginTop: "12px",
            textAlign: "center",
          }}
        >
          Each row is a verse · filled cells show what you marked · a row
          spanning several columns is a cross-theme verse.
        </p>
      )}
    </div>
  );
}
