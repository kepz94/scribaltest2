import { useState } from "react";
import { Mark, MarkStyle, MarkColor, WordTag, COLORS, STYLE_POINTS, Tab } from "../types";
import { getScriptures, volumesProxy } from "../data/scripturesStore";
import WordStudies from "./WordStudies";

const vols = volumesProxy;

interface PrintViewProps {
  view: "cornell" | "outline" | "charting";
  title: string;
  compileTabs: Tab[];
  marks: Mark[];
  colorLabels: Record<number, string>;
  notes: Record<string, string>;
  tags?: WordTag[];
  onClose: () => void;
}

const VIEW_NAMES: Record<string, string> = {
  cornell: "Cornell Notes",
  outline: "Outline",
  charting: "Charting",
};

// Fixed print colors (independent of light/dark theme)
const PRINT_PEN: Record<number, string> = {
  1: "#d11a2a",
  2: "#e07b1a",
  3: "#b58900",
  4: "#2f8f3e",
  5: "#2f6fb0",
  6: "#7b4fbf",
  7: "#1a1a1a",
};

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

const phraseStyle = (style: MarkStyle): React.CSSProperties => {
  switch (style) {
    case "bold":
      return { fontWeight: 700 };
    case "italic":
      return { fontStyle: "italic" };
    case "underline":
      return { textDecoration: "underline" };
    case "highlight":
      return { backgroundColor: "#f3ead0", padding: "0 2px" };
    case "circle":
      return {
        border: "1px solid #888",
        borderRadius: "8px",
        padding: "0 5px",
      };
    default:
      return {};
  }
};

export default function PrintView(props: PrintViewProps) {
  const { view, title, compileTabs, marks, colorLabels, notes, tags, onClose } =
    props;
  const [full, setFull] = useState(false);

  // Build structural data
  type VEntry = {
    reference: string;
    verse: number;
    text: string;
    chapterRef: string;
    order: number;
  };
  const allEntries: VEntry[] = [];
  compileTabs.forEach((t, ti) => {
    const book = vols[t.volume].books[t.book];
    const chapter = book.chapters[t.chapter];
    const chapterRef = book.book + " " + chapter.chapter;
    chapter.verses.forEach((v, i) => {
      allEntries.push({
        reference: v.reference,
        verse: v.verse,
        text: v.text,
        chapterRef,
        order: ti * 100000 + i,
      });
    });
  });
  const refMeta: Record<string, VEntry> = {};
  allEntries.forEach((e) => (refMeta[e.reference] = e));
  const selectedRefs = new Set(allEntries.map((e) => e.reference));
  const relevantMarks = marks.filter((m) => selectedRefs.has(m.reference));

  const pointsFor = (reference: string, cMarks: Mark[]) =>
    cMarks
      .filter((m) => m.reference === reference)
      .reduce((s, m) => s + STYLE_POINTS[m.style], 0);

  const themes = COLORS.map((color) => {
    const cMarks = relevantMarks.filter((m) => m.color === color);
    if (cMarks.length === 0) return null;
    const refs = Array.from(new Set(cMarks.map((m) => m.reference)));
    const verses = refs
      .map((ref) => ({
        ...refMeta[ref],
        vmarks: cMarks
          .filter((m) => m.reference === ref)
          .sort((a, b) => a.startIndex - b.startIndex),
        points: pointsFor(ref, cMarks),
      }))
      .sort((a, b) => b.points - a.points);
    return {
      color,
      label: colorLabels[color]?.trim() || "Unnamed theme",
      verses,
      total: cMarks.reduce((s, m) => s + STYLE_POINTS[m.style], 0),
    };
  }).filter(Boolean) as {
    color: MarkColor;
    label: string;
    verses: (VEntry & { vmarks: Mark[]; points: number })[];
    total: number;
  }[];

  const reflectionKeys = Object.keys(notes).filter((k) =>
    /synth|summary|reflect/i.test(k)
  );

  const renderFullVerse = (text: string, vmarks: Mark[]) => {
    const out: React.ReactNode[] = [];
    let cursor = 0;
    vmarks.forEach((m, i) => {
      const start = Math.max(m.startIndex, cursor);
      const end = Math.max(m.endIndex, start);
      if (start > cursor)
        out.push(<span key={"p" + i}>{text.slice(cursor, start)}</span>);
      if (end > start)
        out.push(
          <span key={"m" + i} style={phraseStyle(m.style)}>
            {text.slice(start, end)}
          </span>
        );
      cursor = Math.max(cursor, end);
    });
    if (cursor < text.length)
      out.push(<span key="end">{text.slice(cursor)}</span>);
    return out;
  };

  const renderPhrases = (vmarks: Mark[]) =>
    vmarks.map((m, i) => (
      <span key={m.id}>
        <span style={phraseStyle(m.style)}>{m.markedText}</span>
        {i < vmarks.length - 1 && (
          <span style={{ color: "#999", margin: "0 5px" }}>·</span>
        )}
      </span>
    ));

  const isRichHtml = (v: string) => /<[a-z][\s\S]*>/i.test(v);
  const RichNote = ({ html, style }: { html: string; style: React.CSSProperties }) =>
    isRichHtml(html) ? (
      <div className="print-richnote" style={style} dangerouslySetInnerHTML={{ __html: html }} />
    ) : (
      <div style={style}>{html}</div>
    );

  const noteFor = (chapterRef: string, color: number, reference: string) =>
    notes["note|" + chapterRef + "|c" + color + "|" + reference] || "";

  const docDate = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const subtitle =
    VIEW_NAMES[view] +
    "  ·  " +
    Array.from(new Set(allEntries.map((e) => e.chapterRef))).join(", ") +
    "  ·  " +
    docDate;

  return (
    <div
      id="scribal-print"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        backgroundColor: "#ffffff",
        color: "#1a1a1a",
        overflowY: "auto",
      }}
    >
      <style>{`
        @page { margin: 16mm; ${
          view === "charting" ? "size: A4 landscape;" : ""
        } }
        .print-richnote p { margin: 0 0 6px; }
        .print-richnote h1 { font-size: 17px; font-weight: 800; margin: 4px 0; }
        .print-richnote h2 { font-size: 14.5px; font-weight: 800; margin: 4px 0; }
        .print-richnote blockquote { border-left: 2px solid #bbb; padding-left: 10px; margin: 4px 0; color: #555; font-style: italic; }
        .print-richnote ol { margin: 0 0 6px 22px; list-style: decimal; }
        .print-richnote ul { margin: 0 0 6px 20px; list-style: disc; }
        .print-richnote hr { border: none; border-top: 1px solid #ccc; margin: 8px 0; }
        .print-richnote .scribal-vchip { color: #7c4fd8; font-weight: 600; }
        @media print {
          body * { visibility: hidden !important; }
          #scribal-print, #scribal-print * { visibility: visible !important; }
          #scribal-print { position: absolute !important; left: 0; top: 0; width: 100%; overflow: visible !important; }
          [data-noprint] { display: none !important; }
          .print-theme { break-inside: avoid; }
          .print-verse { break-inside: avoid; }
        }
      `}</style>

      {/* Toolbar (not printed) */}
      <div
        data-noprint
        style={{
          position: "sticky",
          top: 0,
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "12px 20px",
          backgroundColor: "#f3f1ea",
          borderBottom: "1px solid #ddd",
        }}
      >
        <button
          onClick={onClose}
          style={{
            padding: "8px 16px",
            borderRadius: "999px",
            border: "1px solid #ccc",
            background: "#fff",
            cursor: "pointer",
            fontSize: "13px",
          }}
        >
          ← Close
        </button>

        {view !== "charting" && (
          <div
            style={{
              display: "flex",
              border: "1px solid #ccc",
              borderRadius: "999px",
              overflow: "hidden",
            }}
          >
            <button
              onClick={() => setFull(false)}
              style={{
                padding: "7px 14px",
                border: "none",
                cursor: "pointer",
                fontSize: "12.5px",
                background: !full ? "#1a1a1a" : "transparent",
                color: !full ? "#fff" : "#555",
              }}
            >
              Focused
            </button>
            <button
              onClick={() => setFull(true)}
              style={{
                padding: "7px 14px",
                border: "none",
                cursor: "pointer",
                fontSize: "12.5px",
                background: full ? "#1a1a1a" : "transparent",
                color: full ? "#fff" : "#555",
              }}
            >
              Full verses
            </button>
          </div>
        )}

        <span style={{ fontSize: "12px", color: "#777" }}>
          Tip: in the print dialog, set Destination to “Save as PDF”.
        </span>

        <button
          onClick={() => window.print()}
          style={{
            marginLeft: "auto",
            padding: "9px 20px",
            borderRadius: "999px",
            border: "none",
            background: "#1a1a1a",
            color: "#fff",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: 500,
          }}
        >
          ⎙ Print / Save as PDF
        </button>
      </div>

      {/* Document */}
      <div
        style={{
          maxWidth: view === "charting" ? "100%" : "760px",
          margin: "0 auto",
          padding: "34px 30px 60px",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "27px", fontWeight: 700 }}>
          {title}
        </h1>
        <div
          style={{
            fontSize: "12.5px",
            color: "#666",
            marginTop: "6px",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {subtitle}
        </div>
        <hr
          style={{
            border: "none",
            borderTop: "2px solid #1a1a1a",
            margin: "16px 0 26px",
          }}
        />

        {themes.length === 0 && (
          <p style={{ color: "#777" }}>No marks to print in this selection.</p>
        )}

        {/* CORNELL */}
        {view === "cornell" &&
          themes.map((th) => (
            <section
              key={th.color}
              className="print-theme"
              style={{ marginBottom: "26px" }}
            >
              <h2
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "9px",
                  fontSize: "18px",
                  borderBottom: "1px solid #ccc",
                  paddingBottom: "6px",
                }}
              >
                <span
                  style={{
                    width: "13px",
                    height: "13px",
                    borderRadius: "50%",
                    backgroundColor: PRINT_PEN[th.color],
                    display: "inline-block",
                  }}
                />
                {th.label}
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: "12px",
                    color: "#777",
                    fontFamily: "system-ui, sans-serif",
                    fontWeight: 400,
                  }}
                >
                  {th.verses.length} verses · {th.total} pts
                </span>
              </h2>
              {th.verses.map((v) => {
                const note = noteFor(v.chapterRef, th.color, v.reference);
                return (
                  <div
                    key={v.reference}
                    className="print-verse"
                    style={{ margin: "12px 0" }}
                  >
                    <div
                      style={{
                        fontFamily: "system-ui, sans-serif",
                        fontSize: "12.5px",
                        fontWeight: 700,
                        marginBottom: "2px",
                      }}
                    >
                      {v.reference}{" "}
                      <span style={{ color: "#999", fontWeight: 400 }}>
                        +{v.points}
                      </span>
                    </div>
                    <div style={{ fontSize: "16px", lineHeight: 1.7 }}>
                      {full
                        ? renderFullVerse(v.text, v.vmarks)
                        : renderPhrases(v.vmarks)}
                    </div>
                    {note.trim() && (
                      <div
                        style={{
                          fontStyle: "italic",
                          color: "#444",
                          fontSize: "14px",
                          marginTop: "4px",
                          paddingLeft: "12px",
                          borderLeft: "2px solid #ddd",
                        }}
                      >
                        <RichNote html={note} style={{}} />
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))}

        {/* OUTLINE */}
        {view === "outline" &&
          themes.map((th, ti) => (
            <section
              key={th.color}
              className="print-theme"
              style={{ marginBottom: "22px" }}
            >
              <h2
                style={{
                  fontSize: "18px",
                  display: "flex",
                  alignItems: "center",
                  gap: "9px",
                }}
              >
                <span
                  style={{ color: "#777", fontFamily: "system-ui, sans-serif" }}
                >
                  {toRoman(ti + 1)}.
                </span>
                <span
                  style={{
                    width: "12px",
                    height: "12px",
                    borderRadius: "50%",
                    backgroundColor: PRINT_PEN[th.color],
                    display: "inline-block",
                  }}
                />
                {th.label}
              </h2>
              {th.verses.map((v, vi) => {
                const note = noteFor(v.chapterRef, th.color, v.reference);
                return (
                  <div
                    key={v.reference}
                    className="print-verse"
                    style={{ marginLeft: "26px", marginTop: "8px" }}
                  >
                    <div style={{ fontSize: "15px", fontWeight: 600 }}>
                      <span
                        style={{
                          color: "#777",
                          fontFamily: "system-ui, sans-serif",
                          marginRight: "6px",
                        }}
                      >
                        {toAlpha(vi)}.
                      </span>
                      {v.reference}
                      <span
                        style={{
                          color: "#999",
                          fontWeight: 400,
                          marginLeft: "6px",
                        }}
                      >
                        +{v.points}
                      </span>
                    </div>
                    {full ? (
                      <div
                        style={{
                          marginLeft: "26px",
                          fontSize: "16px",
                          lineHeight: 1.7,
                        }}
                      >
                        {renderFullVerse(v.text, v.vmarks)}
                      </div>
                    ) : (
                      v.vmarks.map((m, k) => (
                        <div
                          key={m.id}
                          style={{
                            marginLeft: "26px",
                            fontSize: "16px",
                            lineHeight: 1.6,
                          }}
                        >
                          <span
                            style={{
                              color: "#777",
                              fontFamily: "system-ui, sans-serif",
                              marginRight: "6px",
                            }}
                          >
                            {k + 1}.
                          </span>
                          <span style={phraseStyle(m.style)}>
                            {m.markedText}
                          </span>
                        </div>
                      ))
                    )}
                    {note.trim() && (
                      <div
                        style={{
                          marginLeft: "26px",
                          fontStyle: "italic",
                          color: "#444",
                          fontSize: "14px",
                          marginTop: "3px",
                        }}
                      >
                        {isRichHtml(note) ? <RichNote html={note} style={{}} /> : <>— {note}</>}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))}

        {/* CHARTING */}
        {view === "charting" && themes.length > 0 && (
          <table
            style={{
              borderCollapse: "collapse",
              width: "100%",
              fontSize: "13px",
            }}
          >
            <thead>
              <tr>
                <th style={chTh}>Verse</th>
                {themes.map((th) => (
                  <th key={th.color} style={chTh}>
                    <span
                      style={{
                        display: "inline-block",
                        width: "10px",
                        height: "10px",
                        borderRadius: "50%",
                        backgroundColor: PRINT_PEN[th.color],
                        marginRight: "6px",
                        verticalAlign: "middle",
                      }}
                    />
                    {th.label}
                  </th>
                ))}
                <th style={{ ...chTh, textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(new Set(relevantMarks.map((m) => m.reference)))
                .map((r) => refMeta[r])
                .sort((a, b) => a.order - b.order)
                .map((row) => {
                  const rowTotal = relevantMarks
                    .filter((m) => m.reference === row.reference)
                    .reduce((s, m) => s + STYLE_POINTS[m.style], 0);
                  return (
                    <tr key={row.reference}>
                      <td
                        style={{
                          ...chTd,
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {row.reference}
                      </td>
                      {themes.map((th) => {
                        const cm = th.verses.find(
                          (v) => v.reference === row.reference
                        );
                        return (
                          <td key={th.color} style={chTd}>
                            {cm ? (
                              <>
                                <div>{renderPhrases(cm.vmarks)}</div>
                                <div
                                  style={{
                                    fontSize: "10px",
                                    color: "#999",
                                    fontFamily: "system-ui, sans-serif",
                                    marginTop: "3px",
                                  }}
                                >
                                  +{cm.points}
                                </div>
                              </>
                            ) : (
                              <span style={{ color: "#ccc" }}>·</span>
                            )}
                          </td>
                        );
                      })}
                      <td
                        style={{ ...chTd, textAlign: "right", fontWeight: 700 }}
                      >
                        {rowTotal}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}

        {/* Reflections / synthesis */}
        {reflectionKeys.some((k) => (notes[k] || "").trim()) && (
          <section style={{ marginTop: "30px" }}>
            <h2
              style={{
                fontSize: "17px",
                borderTop: "1px solid #ccc",
                paddingTop: "14px",
              }}
            >
              Reflections
            </h2>
            {reflectionKeys.map((k) =>
              (notes[k] || "").trim() ? (
                <RichNote
                  key={k}
                  html={notes[k]}
                  style={{ fontSize: "15px", lineHeight: 1.7, color: "#222" }}
                />
              ) : null
            )}
          </section>
        )}

        {tags && tags.length > 0 && (
          <div style={{ marginTop: "32px" }}>
            <WordStudies
              tags={tags}
              colors={{
                text: "#1a1a1a",
                muted: "#666",
                border: "#ccc",
                soft: "#f5f5f5",
              }}
            />
          </div>
        )}

        <div
          style={{
            marginTop: "40px",
            paddingTop: "12px",
            borderTop: "1px solid #ddd",
            fontSize: "11px",
            color: "#aaa",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          Compiled with Scribal
        </div>
      </div>
    </div>
  );
}

const chTh: React.CSSProperties = {
  border: "1px solid #ccc",
  padding: "7px 9px",
  textAlign: "left",
  fontFamily: "system-ui, sans-serif",
  fontSize: "12px",
  backgroundColor: "#f3f1ea",
};
const chTd: React.CSSProperties = {
  border: "1px solid #ddd",
  padding: "7px 9px",
  verticalAlign: "top",
  lineHeight: 1.5,
};
