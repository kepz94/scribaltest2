import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { getScriptures, volumesProxy } from "../data/scripturesStore";
import MarkedVerse from "./MarkedVerse";
import RichNoteField, { LinkableVerse, LinkableDefinition } from "./RichNoteField";
import { definitionForKey, sensesFor } from "../webster";
import {
  Mark,
  MarkColor,
  COLORS,
  COLOR_MAP,
  STYLE_POINTS,
  markStyleCSS,
  WordTag,
} from "../types";
import { Tab } from "../types";

interface OutlineProps {
  // Outline lead verses: per color, the refs the user pinned to a theme's top,
  // in pin order — their call outranks either automatic sort. (Mobile parity.)
  savedPins?: Record<string, string[]>;
  onPins?: (pins: Record<string, string[]>) => void;
  tabs: Tab[];
  compileTabs: Tab[];
  compileSelection: string[];
  onToggleCompileTab: (id: string) => void;
  hideTabPicker?: boolean;
  marks: Mark[];
  // The study's word tags — a verse shows the definitions its reader chose.
  tags?: WordTag[];
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
const vols = volumesProxy;

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
    tags,
    colorLabels,
    setColorLabel,
    notes,
    setNote,
    onJumpToReference,
  } = props;

  const [sortMode, setSortMode] = useState<SortMode>("points");
  const pins = props.savedPins || {};
  const pinsFor = (color: number): string[] => pins[String(color)] || [];
  const togglePin = (color: number, ref: string) => {
    if (!props.onPins) return;
    const key = String(color);
    const cur = pins[key] || [];
    props.onPins({
      ...pins,
      [key]: cur.includes(ref)
        ? cur.filter((r) => r !== ref)
        : [...cur, ref],
    });
  };
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

  // Verses available to link from a note: this study's verses, grouped by the
  // theme (color) they're most heavily marked in. Feeds RichNoteField's picker.
  // Definitions this study has tagged, one row per chosen sense. Built from the
  // same tags the verses use, so the picker can only ever offer what the reader
  // actually chose — nothing from outside this study, and no unpicked senses.
  const linkableDefinitions: LinkableDefinition[] = (tags || [])
    .filter((t) => t.senses && t.senses.length > 0)
    .map((t) => {
      const def = definitionForKey(t.dictKey) || "";
      return {
        dictKey: t.dictKey,
        word: t.word || t.dictKey,
        reference: t.reference,
        senses: sensesFor(def, t.senses),
      };
    })
    .filter((d) => d.senses.length > 0);

  const linkableVerses: LinkableVerse[] = allEntries.map((e) => {
    const vMarks = relevantMarks.filter((m) => m.reference === e.reference);
    let color: MarkColor | null = null;
    let best = -1;
    COLORS.forEach((c) => {
      const w = vMarks
        .filter((m) => m.color === c)
        .reduce((sum, m) => sum + STYLE_POINTS[m.style], 0);
      if (w > best && w > 0) {
        best = w;
        color = c;
      }
    });
    const themeName =
      color != null
        ? (colorLabels[color] || "").trim() || "Color " + color
        : "Unmarked";
    return { reference: e.reference, text: e.text, color, themeName };
  });

  // Merge overlapping/adjacent ranges of the SAME style into clean runs
  // (SCR-12). Stacked near-duplicate marks (the triple-click double-fire,
  // off-by-one legacy boundaries) rendered as separate near-identical outline
  // entries and double-counted points. Different styles stay separate runs so
  // intentional layering (a bold word inside a highlighted phrase) keeps its
  // own entry and its own points.
  const mergedRunsFor = (
    ms: Mark[]
  ): { start: number; end: number; style: Mark["style"] }[] => {
    const styles = Array.from(new Set(ms.map((m) => m.style)));
    const out: { start: number; end: number; style: Mark["style"] }[] = [];
    styles.forEach((style) => {
      const runs: { start: number; end: number; style: Mark["style"] }[] = [];
      ms.filter((m) => m.style === style)
        .map((m) => ({ start: m.startIndex, end: m.endIndex, style }))
        .filter((f) => f.end > f.start)
        .sort((a, b) => a.start - b.start)
        .forEach((f) => {
          const last = runs[runs.length - 1];
          if (last && f.start <= last.end) last.end = Math.max(last.end, f.end);
          else runs.push(f);
        });
      out.push(...runs);
    });
    return out.sort((a, b) => a.start - b.start);
  };

  // The marked fragments of a verse, joined — the chip's "Focused" preview.
  const focusedFor = (reference: string): string => {
    const entry = allEntries.find((e) => e.reference === reference);
    if (!entry) return "";
    const runs = mergedRunsFor(
      relevantMarks.filter((m) => m.reference === reference)
    );
    const seen = new Set<string>();
    const frags: string[] = [];
    runs.forEach((f) => {
      const t = entry.text.slice(f.start, f.end).trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        frags.push(t);
      }
    });
    return frags.join(" · ");
  };
  const fullTextFor = (reference: string): string =>
    allEntries.find((e) => e.reference === reference)?.text || reference;

  const pointsFor = (reference: string, colorMarks: Mark[]) =>
    mergedRunsFor(
      colorMarks.filter((m) => m.reference === reference)
    ).reduce((s, f) => s + STYLE_POINTS[f.style], 0);

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
              <RichNoteField
                value={(notes && notes[synthKey]) || ""}
                onChange={(t) => setNote(synthKey, t)}
                accent="var(--text)"
                placeholder="State the main idea these verses support…"
                linkableVerses={linkableVerses}
                linkableDefinitions={linkableDefinitions}
                focusedFor={focusedFor}
                fullTextFor={fullTextFor}
                onJumpToReference={onJumpToReference}
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
            const pinned = pinsFor(color);
            const pinRank = (r: string) => {
              const i = pinned.indexOf(r);
              return i === -1 ? Number.MAX_SAFE_INTEGER : i;
            };
            if (sortMode === "points") {
              entries = [...entries].sort(
                (a, b) =>
                  pinRank(a.reference) - pinRank(b.reference) ||
                  pointsFor(b.reference, colorMarks) -
                    pointsFor(a.reference, colorMarks)
              );
            } else {
              entries = [...entries].sort(
                (a, b) =>
                  pinRank(a.reference) - pinRank(b.reference) ||
                  a.order - b.order
              );
            }

            // Sum per verse over merged runs so stacked duplicate marks don't
            // inflate the theme total (SCR-12).
            const totalPts = entries.reduce(
              (s, e) => s + pointsFor(e.reference, colorMarks),
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
                    data-wt={
                      !(colorLabels[color] || "").trim()
                        ? "wt-themename"
                        : undefined
                    }
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
                          <button
                            onClick={() => togglePin(color, entry.reference)}
                            aria-label={
                              pinsFor(color).includes(entry.reference)
                                ? "Unpin from top"
                                : "Pin to top of theme"
                            }
                            title={
                              pinsFor(color).includes(entry.reference)
                                ? "Unpin — return to the sorted list"
                                : "Pin to top — this verse leads the theme"
                            }
                            style={{
                              background: "transparent",
                              border: "none",
                              padding: "2px 4px",
                              cursor: "pointer",
                              color: pinsFor(color).includes(entry.reference)
                                ? COLOR_MAP[color]
                                : "var(--muted)",
                              lineHeight: 0,
                              alignSelf: "center",
                            }}
                          >
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill={
                                pinsFor(color).includes(entry.reference)
                                  ? "currentColor"
                                  : "none"
                              }
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M12 17v5 M9 3h6l-1 7 3 2v2H7v-2l3-2z" />
                            </svg>
                          </button>
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
                              tags={tags}
                            />
                          </div>
                        ) : (
                          <div style={{ marginTop: "4px" }}>
                            {mergedRunsFor(verseMarks).map((f, k) => (
                              <div
                                key={entry.reference + ":" + f.style + ":" + f.start}
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
                                    ...markStyleCSS(f.style, color),
                                  }}
                                >
                                  {entry.text.slice(f.start, f.end)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        <div style={{ marginLeft: "30px", marginTop: "8px" }}>
                          <RichNoteField
                            value={(notes && notes[noteKey]) || ""}
                            onChange={(t) => setNote(noteKey, t)}
                            accent={COLOR_MAP[color]}
                            placeholder="Write a note…"
                            addLabel="Add a note about this verse"
                            linkableVerses={linkableVerses}
                            linkableDefinitions={linkableDefinitions}
                            focusedFor={focusedFor}
                            fullTextFor={fullTextFor}
                            onJumpToReference={onJumpToReference}
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
