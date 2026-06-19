import { useState } from "react";
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

interface CornellNotesProps {
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
}

type SortMode = "points" | "order";
type Recall = "all" | "hideVerses" | "hideNotes";
const vols = scriptures.volumes;

export default function CornellNotes(props: CornellNotesProps) {
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

  const [view, setView] = useState<"full" | "focused">("full");
  const [sortMode, setSortMode] = useState<SortMode>("points");
  const [recall, setRecall] = useState<Recall>("all");

  const tabLabel = (t: Tab) =>
    vols[t.volume].books[t.book].book +
    " " +
    vols[t.volume].books[t.book].chapters[t.chapter].chapter;

  type VEntry = {
    tabId: string;
    chapterRef: string;
    reference: string;
    verse: number;
    text: string;
    order: number;
  };

  const allEntries: VEntry[] = [];
  compileTabs.forEach((t) => {
    const book = vols[t.volume].books[t.book];
    const chapter = book.chapters[t.chapter];
    const chapterRef = book.book + " " + chapter.chapter;
    chapter.verses.forEach((v, i) => {
      allEntries.push({
        tabId: t.id,
        chapterRef,
        reference: v.reference,
        verse: v.verse,
        text: v.text,
        order: i,
      });
    });
  });

  const selectedRefs = new Set(allEntries.map((e) => e.reference));
  const relevantMarks = marks.filter((m) => selectedRefs.has(m.reference));

  const pointsFor = (reference: string, colorMarks: Mark[]) =>
    colorMarks
      .filter((m) => m.reference === reference)
      .reduce((sum, m) => sum + STYLE_POINTS[m.style], 0);

  const renderFocused = (entry: VEntry, colorMarks: Mark[]) => {
    const verseMarks = colorMarks
      .filter((m) => m.reference === entry.reference)
      .sort((a, b) => a.startIndex - b.startIndex);
    return (
      <p style={{ margin: 0, lineHeight: "2.1" }}>
        {verseMarks.map((mark, idx) => (
          <span key={mark.id}>
            <span style={markStyleCSS(mark.style, mark.color)}>
              {mark.markedText}
            </span>
            {idx < verseMarks.length - 1 && (
              <span style={{ color: "var(--muted)", margin: "0 8px" }}>·</span>
            )}
          </span>
        ))}
      </p>
    );
  };

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

  const noMarks = relevantMarks.length === 0;

  return (
    <div
      style={{ padding: "20px 20px 80px", maxWidth: "920px", margin: "0 auto" }}
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
          marginBottom: "20px",
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
            Compilation
          </div>
          <h2 style={{ margin: "2px 0 0 0", fontWeight: 500 }}>
            {compileTabs.length === 0
              ? "Nothing selected"
              : compileTabs.map(tabLabel).join("  ·  ")}
          </h2>
        </div>

        <div
          style={{
            display: "flex",
            border: "1px solid var(--border)",
            borderRadius: "999px",
            overflow: "hidden",
          }}
        >
          {segButton(view === "full", "Full verse", () => setView("full"))}
          {segButton(view === "focused", "Focused", () => setView("focused"))}
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

        {/* Recall mode */}
        <div
          style={{
            display: "flex",
            border: "1px solid var(--border)",
            borderRadius: "999px",
            overflow: "hidden",
          }}
        >
          {segButton(recall === "all", "Show all", () => setRecall("all"))}
          {segButton(recall === "hideVerses", "Hide verses", () =>
            setRecall("hideVerses")
          )}
          {segButton(recall === "hideNotes", "Hide notes", () =>
            setRecall("hideNotes")
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
          Select at least one tab above to compile.
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
            display: "flex",
            gap: 0,
            marginBottom: "8px",
            padding: "0 4px",
          }}
        >
          <div
            style={{
              width: "30%",
              minWidth: "150px",
              maxWidth: "250px",
              fontSize: "10px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              color: "var(--muted)",
              fontWeight: 700,
            }}
          >
            Cues
          </div>
          <div
            style={{
              flex: 1,
              paddingLeft: "18px",
              fontSize: "10px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              color: "var(--muted)",
              fontWeight: 700,
            }}
          >
            Notes
          </div>
        </div>
      )}

      {compileTabs.length > 0 &&
        !noMarks &&
        COLORS.map((color) => {
          const colorMarks = relevantMarks.filter((m) => m.color === color);
          if (colorMarks.length === 0) return null;

          const refsWithThisColor = new Set(colorMarks.map((m) => m.reference));
          let entries = allEntries.filter((e) =>
            refsWithThisColor.has(e.reference)
          );

          if (sortMode === "points") {
            entries = [...entries].sort(
              (a, b) =>
                pointsFor(b.reference, colorMarks) -
                pointsFor(a.reference, colorMarks)
            );
          } else {
            entries = [...entries].sort((a, b) => {
              if (a.tabId !== b.tabId) {
                return (
                  compileTabs.findIndex((t) => t.id === a.tabId) -
                  compileTabs.findIndex((t) => t.id === b.tabId)
                );
              }
              return a.order - b.order;
            });
          }

          const totalPts = colorMarks.reduce(
            (s, m) => s + STYLE_POINTS[m.style],
            0
          );

          return (
            <div
              key={color}
              style={{
                display: "flex",
                gap: 0,
                border: "1px solid var(--border)",
                borderRadius: "14px",
                overflow: "hidden",
                marginBottom: "18px",
                backgroundColor: "var(--panel)",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}
            >
              {/* Cue column */}
              <div
                style={{
                  width: "30%",
                  minWidth: "150px",
                  maxWidth: "250px",
                  flexShrink: 0,
                  borderRight: "1px solid var(--border)",
                  borderLeft: "4px solid " + COLOR_MAP[color],
                  backgroundColor: "var(--soft)",
                  padding: "16px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <div
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "50%",
                      backgroundColor: COLOR_MAP[color],
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: "10px",
                      letterSpacing: "1.5px",
                      textTransform: "uppercase",
                      color: "var(--muted)",
                      fontWeight: 600,
                    }}
                  >
                    Cue
                  </span>
                </div>
                <input
                  value={(colorLabels && colorLabels[color]) || ""}
                  onChange={(e) => setColorLabel(color, e.target.value)}
                  placeholder="Key idea or question…"
                  style={{
                    border: "none",
                    outline: "none",
                    fontSize: "17px",
                    fontWeight: 600,
                    backgroundColor: "transparent",
                    color: "var(--text)",
                    width: "100%",
                  }}
                />
                <span
                  style={{
                    color: "var(--muted)",
                    fontSize: "12px",
                    fontFamily: "system-ui, sans-serif",
                    marginTop: "auto",
                  }}
                >
                  {entries.length} verse{entries.length === 1 ? "" : "s"} ·{" "}
                  {totalPts} pts
                </span>
              </div>

              {/* Notes column */}
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: "16px 18px",
                }}
              >
                {entries.map((entry, j) => {
                  const noteKey =
                    "note|" +
                    entry.chapterRef +
                    "|c" +
                    color +
                    "|" +
                    entry.reference;
                  const pts = pointsFor(entry.reference, colorMarks);
                  const last = j === entries.length - 1;
                  return (
                    <div
                      key={entry.tabId + "|" + entry.reference}
                      style={{
                        borderBottom: last ? "none" : "1px solid var(--border)",
                        paddingBottom: last ? 0 : "14px",
                        marginBottom: last ? 0 : "14px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          marginBottom: "8px",
                        }}
                      >
                        <span
                          onClick={() => onJumpToReference(entry.reference)}
                          title="Open in reading view"
                          style={{
                            fontFamily: "system-ui, sans-serif",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "var(--muted)",
                            letterSpacing: "0.5px",
                            cursor: "pointer",
                            textDecoration: "underline",
                            textDecorationStyle: "dotted",
                          }}
                        >
                          {entry.reference} ↗
                        </span>
                        <div style={{ flex: 1 }} />
                        <span
                          style={{
                            fontFamily: "system-ui, sans-serif",
                            fontSize: "11px",
                            fontWeight: 700,
                            color: COLOR_MAP[color],
                            backgroundColor: "var(--soft)",
                            borderRadius: "999px",
                            padding: "2px 10px",
                          }}
                        >
                          +{pts}
                        </span>
                      </div>

                      {recall !== "hideVerses" && (
                        <div
                          style={{
                            fontFamily: '"Times New Roman", Times, serif',
                            fontSize: "17px",
                            lineHeight: "1.95",
                            marginBottom: "12px",
                          }}
                        >
                          {view === "full" ? (
                            <MarkedVerse
                              reference={entry.reference}
                              verseNumber={entry.verse}
                              text={entry.text}
                              marks={colorMarks}
                            />
                          ) : (
                            renderFocused(entry, colorMarks)
                          )}
                        </div>
                      )}

                      {recall === "hideVerses" && (
                        <div
                          style={{
                            fontSize: "13px",
                            color: "var(--muted)",
                            fontStyle: "italic",
                            marginBottom: "12px",
                            fontFamily: "system-ui, sans-serif",
                          }}
                        >
                          Verse hidden — recall it from the cue.
                        </div>
                      )}

                      {recall !== "hideNotes" && (
                        <NoteField
                          value={(notes && notes[noteKey]) || ""}
                          onChange={(t) => setNote(noteKey, t)}
                          accent={COLOR_MAP[color]}
                          placeholder="Write a note…"
                          addLabel="Add a note about this verse"
                        />
                      )}

                      {recall === "hideNotes" && (
                        <div
                          style={{
                            fontSize: "13px",
                            color: "var(--muted)",
                            fontStyle: "italic",
                            fontFamily: "system-ui, sans-serif",
                          }}
                        >
                          Note hidden — recall what you wrote.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

      {compileTabs.length > 0 && !noMarks && (
        <div
          style={{
            marginTop: "8px",
            border: "1px solid var(--border)",
            borderRadius: "14px",
            overflow: "hidden",
            backgroundColor: "var(--panel)",
          }}
        >
          <div
            style={{
              padding: "10px 18px",
              borderBottom: "1px solid var(--border)",
              backgroundColor: "var(--soft)",
              fontSize: "10px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              color: "var(--muted)",
              fontWeight: 700,
            }}
          >
            Summary
          </div>
          <div style={{ padding: "16px 18px" }}>
            {(() => {
              const synthKey =
                "synthesis|" + compileTabs.map(tabLabel).join("+");
              return (
                <NoteField
                  value={(notes && notes[synthKey]) || ""}
                  onChange={(t) => setNote(synthKey, t)}
                  accent="var(--text)"
                  placeholder="Summarize the main idea across these verses…"
                  addLabel="Write your summary"
                />
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
