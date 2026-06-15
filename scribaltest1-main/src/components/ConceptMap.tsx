import { useState, useRef, useEffect, useMemo } from "react";
import scriptures from "../data/scriptures.json";
import MarkedVerse from "./MarkedVerse";
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

interface ConceptMapProps {
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

type Layout = "radial" | "columns";
const vols = scriptures.volumes;
const PADDING = 90;

const STYLES: { style: MarkStyle; label: string }[] = [
  { style: "bold", label: "Bold" },
  { style: "circle", label: "Circle" },
  { style: "underline", label: "Underline" },
  { style: "italic", label: "Italic" },
  { style: "highlight", label: "Highlight" },
];
const ALL_STYLES: MarkStyle[] = STYLES.map((s) => s.style);

interface UserLink {
  id: string;
  from: string;
  to: string;
  label: string;
}

interface VNode {
  reference: string;
  verse: number;
  text: string;
  points: number;
  marks: Mark[];
}
interface ThemeNode {
  color: MarkColor;
  verses: VNode[];
  totalPoints: number;
}

export default function ConceptMap(props: ConceptMapProps) {
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

  const tabLabel = (t: Tab) =>
    vols[t.volume].books[t.book].book +
    " " +
    vols[t.volume].books[t.book].chapters[t.chapter].chapter;

  // ---- Filters ----
  const [colorFilter, setColorFilter] = useState<MarkColor[]>(() => {
    try {
      const s = localStorage.getItem("scribal_map_colorfilter");
      if (s) {
        const a = JSON.parse(s);
        if (Array.isArray(a) && a.length) return a;
      }
    } catch {}
    return [...COLORS];
  });
  const [styleFilter, setStyleFilter] = useState<MarkStyle[]>(() => {
    try {
      const s = localStorage.getItem("scribal_map_stylefilter");
      if (s) {
        const a = JSON.parse(s);
        if (Array.isArray(a) && a.length) return a;
      }
    } catch {}
    return [...ALL_STYLES];
  });
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(
      "scribal_map_colorfilter",
      JSON.stringify(colorFilter)
    );
  }, [colorFilter]);
  useEffect(() => {
    localStorage.setItem(
      "scribal_map_stylefilter",
      JSON.stringify(styleFilter)
    );
  }, [styleFilter]);

  const toggleColor = (c: MarkColor) =>
    setColorFilter((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  const toggleStyle = (s: MarkStyle) =>
    setStyleFilter((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );

  const filtering =
    colorFilter.length < COLORS.length ||
    styleFilter.length < ALL_STYLES.length;

  // ---- Build structural data from compiled + filtered marks ----
  const { themes, refText } = useMemo(() => {
    const refText: Record<string, { verse: number; text: string }> = {};
    const selectedRefs = new Set<string>();
    compileTabs.forEach((t) => {
      const chapter = vols[t.volume].books[t.book].chapters[t.chapter];
      chapter.verses.forEach((v) => {
        selectedRefs.add(v.reference);
        refText[v.reference] = { verse: v.verse, text: v.text };
      });
    });

    const relevant = marks.filter(
      (m) => selectedRefs.has(m.reference) && styleFilter.includes(m.style)
    );

    const themes: ThemeNode[] = [];
    COLORS.forEach((color) => {
      if (!colorFilter.includes(color)) return;
      const cMarks = relevant.filter((m) => m.color === color);
      if (cMarks.length === 0) return;
      const refs = Array.from(new Set(cMarks.map((m) => m.reference)));
      const verses: VNode[] = refs.map((ref) => {
        const vMarks = cMarks
          .filter((m) => m.reference === ref)
          .sort((a, b) => a.startIndex - b.startIndex);
        const points = vMarks.reduce((s, m) => s + STYLE_POINTS[m.style], 0);
        return {
          reference: ref,
          verse: refText[ref]?.verse ?? 0,
          text: refText[ref]?.text ?? "",
          points,
          marks: vMarks,
        };
      });
      const totalPoints = verses.reduce((s, v) => s + v.points, 0);
      themes.push({ color, verses, totalPoints });
    });

    return { themes, refText };
  }, [compileTabs, marks, colorFilter, styleFilter]);

  const themeId = (c: MarkColor) => "t:" + c;
  const verseId = (c: MarkColor, ref: string) => "v:" + c + ":" + ref;

  // ---- Layout ----
  const [layout, setLayout] = useState<Layout>(
    () => (localStorage.getItem("scribal_map_layout") as Layout) || "radial"
  );

  const autoPositions = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {};

    if (layout === "columns") {
      const colW = 300;
      const topY = 90;
      const vStartY = 215;
      const vGap = 96;
      themes.forEach((th, i) => {
        const cx = i * colW + colW / 2 + PADDING;
        pos[themeId(th.color)] = { x: cx, y: topY };
        th.verses.forEach((v, j) => {
          pos[verseId(th.color, v.reference)] = {
            x: cx,
            y: vStartY + j * vGap,
          };
        });
      });
    } else {
      const T = themes.length;
      const RT = T > 1 ? 280 : 0;
      themes.forEach((th, i) => {
        const ang = -Math.PI / 2 + (i / T) * 2 * Math.PI;
        const tx = Math.cos(ang) * RT;
        const ty = Math.sin(ang) * RT;
        pos[themeId(th.color)] = { x: tx, y: ty };
        const n = th.verses.length;
        const RV = 135 + n * 9;
        th.verses.forEach((v, j) => {
          let a: number;
          if (T > 1) {
            const A = Math.min(Math.PI * 1.25, 0.6 + n * 0.22);
            a = ang + (n > 1 ? (j / (n - 1) - 0.5) * A : 0);
          } else {
            a = (j / Math.max(1, n)) * 2 * Math.PI;
          }
          pos[verseId(th.color, v.reference)] = {
            x: tx + Math.cos(a) * RV,
            y: ty + Math.sin(a) * RV,
          };
        });
      });
    }

    const xs = Object.values(pos).map((p) => p.x);
    const ys = Object.values(pos).map((p) => p.y);
    if (xs.length) {
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      Object.keys(pos).forEach((k) => {
        pos[k] = { x: pos[k].x - minX + PADDING, y: pos[k].y - minY + PADDING };
      });
    }
    return pos;
  }, [layout, themes]);

  const [manual, setManual] = useState<
    Record<string, { x: number; y: number }>
  >(() => {
    try {
      const s = localStorage.getItem("scribal_map_pos");
      return s ? JSON.parse(s) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    localStorage.setItem("scribal_map_pos", JSON.stringify(manual));
  }, [manual]);

  const posOf = (id: string) =>
    manual[id] || autoPositions[id] || { x: PADDING, y: PADDING };

  const [links, setLinks] = useState<UserLink[]>(() => {
    try {
      const s = localStorage.getItem("scribal_map_links");
      return s ? JSON.parse(s) : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    localStorage.setItem("scribal_map_links", JSON.stringify(links));
  }, [links]);

  const [connectMode, setConnectMode] = useState(false);
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null); // theme nodes only
  const [verseFocus, setVerseFocus] = useState<{
    id: string;
    stage: 1 | 2;
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: string;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    moved: boolean;
  } | null>(null);

  const allNodeIds = useMemo(() => {
    const ids: string[] = [];
    themes.forEach((th) => {
      ids.push(themeId(th.color));
      th.verses.forEach((v) => ids.push(verseId(th.color, v.reference)));
    });
    return new Set(ids);
  }, [themes]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) d.moved = true;
      setManual((prev) => ({
        ...prev,
        [d.id]: { x: d.ox + dx, y: d.oy + dy },
      }));
    };
    const onUp = () => {
      const d = dragRef.current;
      if (d && !d.moved) {
        const id = d.id;
        if (id.startsWith("t:")) {
          // Theme node: toggle bottom detail panel
          setSelected((prev) => (prev === id ? null : id));
          setVerseFocus(null);
        } else {
          // Verse node: cycle reference → marked → bubble
          setSelected(null);
          setVerseFocus((prev) =>
            !prev || prev.id !== id
              ? { id, stage: 1 }
              : prev.stage === 1
              ? { id, stage: 2 }
              : { id, stage: 1 }
          );
        }
      }
      dragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const onNodeMouseDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (connectMode) {
      if (!linkSource) {
        setLinkSource(id);
      } else if (linkSource === id) {
        setLinkSource(null);
      } else {
        const exists = links.some(
          (l) =>
            (l.from === linkSource && l.to === id) ||
            (l.from === id && l.to === linkSource)
        );
        if (!exists) {
          setLinks((prev) => [
            ...prev,
            {
              id: "link_" + Date.now(),
              from: linkSource as string,
              to: id,
              label: "",
            },
          ]);
        }
        setLinkSource(null);
      }
      return;
    }
    const p = posOf(id);
    dragRef.current = {
      id,
      sx: e.clientX,
      sy: e.clientY,
      ox: p.x,
      oy: p.y,
      moved: false,
    };
  };

  const onCanvasMouseDown = () => {
    setSelected(null);
    setLinkSource(null);
    setFilterOpen(false);
    setVerseFocus(null);
  };

  const changeLayout = (l: Layout) => {
    setLayout(l);
    localStorage.setItem("scribal_map_layout", l);
    setManual({});
    setSelected(null);
    setLinkSource(null);
    setVerseFocus(null);
  };

  const resetArrangement = () => {
    setManual({});
    setSelected(null);
    setLinkSource(null);
    setVerseFocus(null);
  };

  const deleteLink = (id: string) =>
    setLinks((prev) => prev.filter((l) => l.id !== id));
  const setLinkLabel = (id: string, label: string) =>
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, label } : l)));

  const effIds = Array.from(allNodeIds);
  const exs = effIds.map((id) => posOf(id).x);
  const eys = effIds.map((id) => posOf(id).y);
  const canvasW = Math.max(900, (exs.length ? Math.max(...exs) : 0) + 260);
  const canvasH = Math.max(620, (eys.length ? Math.max(...eys) : 0) + 260);

  const themeDetail =
    selected && selected.startsWith("t:")
      ? (() => {
          const color = Number(selected.slice(2)) as MarkColor;
          const th = themes.find((t) => t.color === color);
          if (!th) return null;
          return {
            color,
            label: colorLabels[color]?.trim() || "Unnamed theme",
            count: th.verses.length,
            points: th.totalPoints,
          };
        })()
      : null;

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

  const renderSnippets = (v: VNode) => {
    if (v.marks.length === 0)
      return (
        <span style={{ color: "var(--muted)", fontStyle: "italic" }}>
          (no snippet)
        </span>
      );
    return v.marks.map((m, i) => (
      <span key={m.id}>
        <span style={markStyleCSS(m.style, m.color)}>{m.markedText}</span>
        {i < v.marks.length - 1 && (
          <span style={{ color: "var(--muted)", margin: "0 6px" }}>·</span>
        )}
      </span>
    ));
  };

  const noData = themes.length === 0;

  return (
    <div
      style={{
        padding: "20px 20px 40px",
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
          marginBottom: "16px",
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
          Choose what to map
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
          marginBottom: "14px",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            border: "1px solid var(--border)",
            borderRadius: "999px",
            overflow: "hidden",
          }}
        >
          {segButton(layout === "radial", "Radial", () =>
            changeLayout("radial")
          )}
          {segButton(layout === "columns", "Columns", () =>
            changeLayout("columns")
          )}
        </div>

        {/* Filter dropdown */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setFilterOpen((o) => !o)}
            style={{
              padding: "8px 16px",
              borderRadius: "999px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: filtering ? 600 : 400,
              border: "1px solid var(--border)",
              backgroundColor: filtering ? "var(--soft)" : "transparent",
              color: "var(--text)",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            Filter
            {filtering && (
              <span
                style={{
                  width: "7px",
                  height: "7px",
                  borderRadius: "50%",
                  backgroundColor: "var(--text)",
                }}
              />
            )}
            <span style={{ color: "var(--muted)", fontSize: "10px" }}>▼</span>
          </button>

          {filterOpen && (
            <>
              <div
                onClick={() => setFilterOpen(false)}
                style={{ position: "fixed", inset: 0, zIndex: 60 }}
              />
              <div
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  top: "44px",
                  left: 0,
                  width: "260px",
                  backgroundColor: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: "14px",
                  boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
                  padding: "14px",
                  zIndex: 61,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "8px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      letterSpacing: "1.5px",
                      textTransform: "uppercase",
                      color: "var(--muted)",
                    }}
                  >
                    Colors
                  </span>
                  <span style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => setColorFilter([...COLORS])}
                      style={miniBtn}
                    >
                      All
                    </button>
                    <button onClick={() => setColorFilter([])} style={miniBtn}>
                      None
                    </button>
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "8px",
                    marginBottom: "14px",
                  }}
                >
                  {COLORS.map((c) => {
                    const on = colorFilter.includes(c);
                    return (
                      <button
                        key={c}
                        onClick={() => toggleColor(c)}
                        title={"Color " + c}
                        style={{
                          width: "26px",
                          height: "26px",
                          borderRadius: "50%",
                          backgroundColor: COLOR_MAP[c],
                          cursor: "pointer",
                          border: "none",
                          opacity: on ? 1 : 0.28,
                          boxShadow: on
                            ? "0 0 0 2px var(--panel), 0 0 0 4px var(--text)"
                            : "0 0 0 1px var(--border)",
                          transition: "all 0.12s",
                        }}
                      />
                    );
                  })}
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "8px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      letterSpacing: "1.5px",
                      textTransform: "uppercase",
                      color: "var(--muted)",
                    }}
                  >
                    Styles
                  </span>
                  <span style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => setStyleFilter([...ALL_STYLES])}
                      style={miniBtn}
                    >
                      All
                    </button>
                    <button onClick={() => setStyleFilter([])} style={miniBtn}>
                      None
                    </button>
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  {STYLES.map(({ style, label }) => {
                    const on = styleFilter.includes(style);
                    return (
                      <button
                        key={style}
                        onClick={() => toggleStyle(style)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "7px 9px",
                          borderRadius: "8px",
                          border: "1px solid var(--border)",
                          backgroundColor: on ? "var(--soft)" : "transparent",
                          color: on ? "var(--text)" : "var(--muted)",
                          cursor: "pointer",
                          fontSize: "13px",
                          textAlign: "left",
                        }}
                      >
                        <span
                          style={{
                            width: "16px",
                            height: "16px",
                            borderRadius: "4px",
                            border: "1px solid currentColor",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "11px",
                            flexShrink: 0,
                          }}
                        >
                          {on ? "✓" : ""}
                        </span>
                        {label}
                        <span
                          style={{
                            marginLeft: "auto",
                            fontSize: "11px",
                            color: "var(--muted)",
                          }}
                        >
                          +{STYLE_POINTS[style]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <button
          onClick={() => {
            setConnectMode((c) => !c);
            setLinkSource(null);
          }}
          style={{
            padding: "8px 16px",
            borderRadius: "999px",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: connectMode ? 600 : 400,
            border: "1px solid var(--border)",
            backgroundColor: connectMode ? "var(--text)" : "transparent",
            color: connectMode ? "var(--bg)" : "var(--text)",
          }}
        >
          {connectMode ? "Connecting — click two nodes" : "+ Connect nodes"}
        </button>

        <button
          onClick={resetArrangement}
          style={{
            padding: "8px 16px",
            borderRadius: "999px",
            cursor: "pointer",
            fontSize: "13px",
            border: "1px solid var(--border)",
            backgroundColor: "transparent",
            color: "var(--muted)",
          }}
        >
          Reset arrangement
        </button>

        <span
          style={{
            fontSize: "11.5px",
            color: "var(--muted)",
            marginLeft: "auto",
          }}
        >
          Click a verse to reveal its marks · click again for the full verse
        </span>
      </div>

      {noData ? (
        <p
          style={{
            color: "var(--muted)",
            textAlign: "center",
            padding: "60px",
          }}
        >
          {compileTabs.length === 0
            ? "Select at least one tab above to map."
            : filtering
            ? "No marks match the current filter."
            : "No marks in the selected chapters yet."}
        </p>
      ) : (
        <div
          ref={canvasRef}
          onMouseDown={onCanvasMouseDown}
          style={{
            position: "relative",
            width: "100%",
            height: "72vh",
            overflow: "auto",
            border: "1px solid var(--border)",
            borderRadius: "16px",
            backgroundColor: "var(--bg)",
            backgroundImage:
              "radial-gradient(var(--border) 1px, transparent 1px)",
            backgroundSize: "26px 26px",
          }}
        >
          <div
            style={{
              position: "relative",
              width: canvasW + "px",
              height: canvasH + "px",
            }}
          >
            <svg
              width={canvasW}
              height={canvasH}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                pointerEvents: "none",
              }}
            >
              {themes.map((th) =>
                th.verses.map((v) => {
                  const a = posOf(themeId(th.color));
                  const b = posOf(verseId(th.color, v.reference));
                  return (
                    <line
                      key={"s" + th.color + v.reference}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="var(--border)"
                      strokeWidth={1.5}
                    />
                  );
                })
              )}
              {links
                .filter((l) => allNodeIds.has(l.from) && allNodeIds.has(l.to))
                .map((l) => {
                  const a = posOf(l.from);
                  const b = posOf(l.to);
                  return (
                    <line
                      key={l.id}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="var(--text)"
                      strokeWidth={2}
                      strokeDasharray="2 6"
                      strokeLinecap="round"
                    />
                  );
                })}
            </svg>

            {links
              .filter((l) => allNodeIds.has(l.from) && allNodeIds.has(l.to))
              .map((l) => {
                const a = posOf(l.from);
                const b = posOf(l.to);
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                return (
                  <div
                    key={"lbl" + l.id}
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{
                      position: "absolute",
                      left: mx,
                      top: my,
                      transform: "translate(-50%, -50%)",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      backgroundColor: "var(--panel)",
                      border: "1px solid var(--border)",
                      borderRadius: "999px",
                      padding: "2px 6px",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
                    }}
                  >
                    <input
                      value={l.label}
                      onChange={(e) => setLinkLabel(l.id, e.target.value)}
                      placeholder="link…"
                      style={{
                        border: "none",
                        outline: "none",
                        background: "transparent",
                        fontSize: "11.5px",
                        color: "var(--text)",
                        width: Math.max(40, l.label.length * 7 + 28) + "px",
                        fontFamily: "system-ui, sans-serif",
                      }}
                    />
                    <span
                      onClick={() => deleteLink(l.id)}
                      style={{
                        cursor: "pointer",
                        color: "var(--muted)",
                        fontSize: "11px",
                      }}
                    >
                      ✕
                    </span>
                  </div>
                );
              })}

            {/* Theme nodes */}
            {themes.map((th) => {
              const p = posOf(themeId(th.color));
              const id = themeId(th.color);
              const isSel = selected === id;
              const isSrc = linkSource === id;
              return (
                <div
                  key={id}
                  onMouseDown={(e) => onNodeMouseDown(e, id)}
                  style={{
                    position: "absolute",
                    left: p.x,
                    top: p.y,
                    transform: "translate(-50%, -50%)",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "9px 14px",
                    borderRadius: "999px",
                    backgroundColor: "var(--panel)",
                    border: "2px solid " + COLOR_MAP[th.color],
                    cursor: connectMode ? "crosshair" : "grab",
                    boxShadow: isSrc
                      ? "0 0 0 3px var(--text)"
                      : isSel
                      ? "0 0 0 3px var(--border)"
                      : "0 4px 14px rgba(0,0,0,0.12)",
                    userSelect: "none",
                    whiteSpace: "nowrap",
                    zIndex: 2,
                  }}
                >
                  <span
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "50%",
                      backgroundColor: COLOR_MAP[th.color],
                      flexShrink: 0,
                    }}
                  />
                  <input
                    value={colorLabels[th.color] || ""}
                    onChange={(e) => setColorLabel(th.color, e.target.value)}
                    onMouseDown={(e) => e.stopPropagation()}
                    placeholder="Name theme…"
                    style={{
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "var(--text)",
                      width:
                        Math.max(70, (colorLabels[th.color]?.length || 9) * 8) +
                        "px",
                    }}
                  />
                  <span
                    style={{
                      fontSize: "11px",
                      color: "var(--muted)",
                      fontFamily: "system-ui, sans-serif",
                    }}
                  >
                    {th.verses.length}
                  </span>
                </div>
              );
            })}

            {/* Verse nodes */}
            {themes.map((th) =>
              th.verses.map((v) => {
                const id = verseId(th.color, v.reference);
                const p = posOf(id);
                const isSrc = linkSource === id;
                const focused = verseFocus?.id === id;
                const showBubble = focused && verseFocus?.stage === 2;
                const baseW = 116 + v.points * 5;
                const w = focused ? 230 : baseW;
                return (
                  <div
                    key={id}
                    onMouseDown={(e) => onNodeMouseDown(e, id)}
                    style={{
                      position: "absolute",
                      left: p.x,
                      top: p.y,
                      transform: "translate(-50%, -50%)",
                      width: w + "px",
                      padding: "9px 11px",
                      borderRadius: "11px",
                      backgroundColor: "var(--panel)",
                      border: "1px solid var(--border)",
                      borderLeft: "4px solid " + COLOR_MAP[th.color],
                      cursor: connectMode ? "crosshair" : "grab",
                      boxShadow: isSrc
                        ? "0 0 0 3px var(--text)"
                        : focused
                        ? "0 0 0 3px var(--border)"
                        : "0 2px 8px rgba(0,0,0,0.08)",
                      userSelect: "none",
                      zIndex: focused ? 6 : 1,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          color: "var(--text)",
                          fontFamily: "system-ui, sans-serif",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {v.reference}
                      </span>
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: "10px",
                          fontWeight: 700,
                          color: COLOR_MAP[th.color],
                          backgroundColor: "var(--soft)",
                          borderRadius: "999px",
                          padding: "1px 7px",
                          flexShrink: 0,
                        }}
                      >
                        +{v.points}
                      </span>
                    </div>

                    {/* Stage 1+: marked snippets */}
                    {focused && (
                      <div
                        style={{
                          marginTop: "8px",
                          fontFamily: '"Times New Roman", Times, serif',
                          fontSize: "13.5px",
                          lineHeight: 1.7,
                          color: "var(--text)",
                        }}
                      >
                        {renderSnippets(v)}
                      </div>
                    )}

                    {/* Stage 2: full-verse bubble */}
                    {showBubble && (
                      <div
                        onMouseDown={(e) => e.stopPropagation()}
                        style={{
                          position: "absolute",
                          top: "calc(100% + 10px)",
                          left: "50%",
                          transform: "translateX(-50%)",
                          width: "300px",
                          backgroundColor: "var(--panel)",
                          border: "1px solid var(--border)",
                          borderRadius: "12px",
                          boxShadow: "0 16px 40px rgba(0,0,0,0.28)",
                          padding: "14px 16px",
                          zIndex: 20,
                          textAlign: "left",
                          maxHeight: "240px",
                          overflowY: "auto",
                        }}
                      >
                        <div style={{ marginBottom: "8px" }}>
                          <span
                            onClick={() => onJumpToReference(v.reference)}
                            style={{
                              fontSize: "12px",
                              fontWeight: 600,
                              color: "var(--text)",
                              cursor: "pointer",
                              textDecoration: "underline",
                              textDecorationStyle: "dotted",
                              fontFamily: "system-ui, sans-serif",
                            }}
                          >
                            {v.reference} ↗
                          </span>
                        </div>
                        <div
                          style={{
                            fontFamily: '"Times New Roman", Times, serif',
                            fontSize: "15px",
                            lineHeight: 1.8,
                          }}
                        >
                          <MarkedVerse
                            reference={v.reference}
                            verseNumber={v.verse}
                            text={v.text}
                            marks={v.marks}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Theme detail (verses use the in-node bubble instead) */}
      {themeDetail && (
        <div
          style={{
            marginTop: "16px",
            backgroundColor: "var(--panel)",
            border: "1px solid var(--border)",
            borderLeft: "4px solid " + COLOR_MAP[themeDetail.color],
            borderRadius: "12px",
            padding: "16px 18px",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              color: "var(--muted)",
              marginBottom: "4px",
            }}
          >
            Theme
          </div>
          <div style={{ fontSize: "17px", fontWeight: 600 }}>
            {themeDetail.label}
          </div>
          <div
            style={{
              fontSize: "12.5px",
              color: "var(--muted)",
              marginTop: "4px",
            }}
          >
            {themeDetail.count} verses · {themeDetail.points} points
          </div>
        </div>
      )}
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: "11px",
  padding: 0,
  textDecoration: "underline",
};
