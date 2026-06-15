import { Mark, MarkStyle, MarkColor, COLORS, STYLE_POINTS, Tab } from "../types";
import scriptures from "../data/scriptures.json";

const vols = scriptures.volumes;
const PADDING = 90;

const PRINT_PEN: Record<number, string> = {
  1: "#d11a2a",
  2: "#e07b1a",
  3: "#b58900",
  4: "#2f8f3e",
  5: "#2f6fb0",
  6: "#7b4fbf",
  7: "#1a1a1a",
};
const ALL_STYLES: MarkStyle[] = [
  "bold",
  "circle",
  "underline",
  "italic",
  "highlight",
];

interface MapPrintProps {
  title: string;
  compileTabs: Tab[];
  marks: Mark[];
  colorLabels: Record<number, string>;
  onClose: () => void;
}

const safeParse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const truncate = (s: string, n: number) =>
  s.length > n ? s.slice(0, n - 1) + "…" : s;

export default function MapPrint(props: MapPrintProps) {
  const { title, compileTabs, marks, colorLabels, onClose } = props;

  // Saved arrangement (matches what's on screen)
  const layout =
    (localStorage.getItem("scribal_map_layout") as "radial" | "columns") ||
    "radial";
  const manual = safeParse<Record<string, { x: number; y: number }>>(
    localStorage.getItem("scribal_map_pos"),
    {}
  );
  const links = safeParse<
    { id: string; from: string; to: string; label: string }[]
  >(localStorage.getItem("scribal_map_links"), []);
  const colorFilter = safeParse<MarkColor[]>(
    localStorage.getItem("scribal_map_colorfilter"),
    [...COLORS]
  );
  const styleFilter = safeParse<MarkStyle[]>(
    localStorage.getItem("scribal_map_stylefilter"),
    [...ALL_STYLES]
  );

  const themeId = (c: MarkColor) => "t:" + c;
  const verseId = (c: MarkColor, ref: string) => "v:" + c + ":" + ref;

  // Build themes (same filtering as the live map)
  const refMeta: Record<string, { verse: number; text: string }> = {};
  const selectedRefs = new Set<string>();
  compileTabs.forEach((t) => {
    const chapter = vols[t.volume].books[t.book].chapters[t.chapter];
    chapter.verses.forEach((v) => {
      selectedRefs.add(v.reference);
      refMeta[v.reference] = { verse: v.verse, text: v.text };
    });
  });

  const relevant = marks.filter(
    (m) => selectedRefs.has(m.reference) && styleFilter.includes(m.style)
  );

  const themes = COLORS.map((color) => {
    if (!colorFilter.includes(color)) return null;
    const cMarks = relevant.filter((m) => m.color === color);
    if (cMarks.length === 0) return null;
    const refs = Array.from(new Set(cMarks.map((m) => m.reference)));
    const verses = refs.map((ref) => ({
      reference: ref,
      points: cMarks
        .filter((m) => m.reference === ref)
        .reduce((s, m) => s + STYLE_POINTS[m.style], 0),
    }));
    return {
      color,
      label: colorLabels[color]?.trim() || "Unnamed theme",
      verses,
      total: verses.reduce((s, v) => s + v.points, 0),
    };
  }).filter(Boolean) as {
    color: MarkColor;
    label: string;
    verses: { reference: string; points: number }[];
    total: number;
  }[];

  // Auto layout (mirrors ConceptMap so manual drags align)
  const autoPos: Record<string, { x: number; y: number }> = {};
  if (layout === "columns") {
    const colW = 300;
    const topY = 90;
    const vStartY = 215;
    const vGap = 96;
    themes.forEach((th, i) => {
      const cx = i * colW + colW / 2 + PADDING;
      autoPos[themeId(th.color)] = { x: cx, y: topY };
      th.verses.forEach((v, j) => {
        autoPos[verseId(th.color, v.reference)] = {
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
      autoPos[themeId(th.color)] = { x: tx, y: ty };
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
        autoPos[verseId(th.color, v.reference)] = {
          x: tx + Math.cos(a) * RV,
          y: ty + Math.sin(a) * RV,
        };
      });
    });
  }
  const axs = Object.values(autoPos).map((p) => p.x);
  const ays = Object.values(autoPos).map((p) => p.y);
  if (axs.length) {
    const minX = Math.min(...axs);
    const minY = Math.min(...ays);
    Object.keys(autoPos).forEach((k) => {
      autoPos[k] = {
        x: autoPos[k].x - minX + PADDING,
        y: autoPos[k].y - minY + PADDING,
      };
    });
  }
  const posOf = (id: string) =>
    manual[id] || autoPos[id] || { x: PADDING, y: PADDING };

  const allIds: string[] = [];
  themes.forEach((th) => {
    allIds.push(themeId(th.color));
    th.verses.forEach((v) => allIds.push(verseId(th.color, v.reference)));
  });
  const idSet = new Set(allIds);

  // viewBox bounds
  const xs = allIds.map((id) => posOf(id).x);
  const ys = allIds.map((id) => posOf(id).y);
  const minX = (xs.length ? Math.min(...xs) : 0) - 170;
  const maxX = (xs.length ? Math.max(...xs) : 600) + 170;
  const minY = (ys.length ? Math.min(...ys) : 0) - 110;
  const maxY = (ys.length ? Math.max(...ys) : 400) + 110;
  const vbW = Math.max(400, maxX - minX);
  const vbH = Math.max(300, maxY - minY);

  const verseW = (points: number) => 116 + points * 5;
  const themeW = (label: string) => Math.max(120, label.length * 8 + 52);

  const docDate = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const subtitle =
    "Concept Map  ·  " +
    compileTabs
      .map(
        (t) =>
          vols[t.volume].books[t.book].book +
          " " +
          vols[t.volume].books[t.book].chapters[t.chapter].chapter
      )
      .join(", ") +
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
          @page { margin: 12mm; size: A4 landscape; }
          @media print {
            body * { visibility: hidden !important; }
            #scribal-print, #scribal-print * { visibility: visible !important; }
            #scribal-print { position: absolute !important; left: 0; top: 0; width: 100%; overflow: visible !important; }
            [data-noprint] { display: none !important; }
          }
        `}</style>

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
        <span style={{ fontSize: "12px", color: "#777" }}>
          Tip: in the print dialog, set Destination to “Save as PDF”
          (landscape).
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

      <div style={{ padding: "30px 30px 50px", fontFamily: "Georgia, serif" }}>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700 }}>
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

        {/* Legend */}
        {themes.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "16px",
              margin: "14px 0 18px",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            {themes.map((th) => (
              <span
                key={th.color}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "7px",
                  fontSize: "12.5px",
                }}
              >
                <span
                  style={{
                    width: "12px",
                    height: "12px",
                    borderRadius: "50%",
                    backgroundColor: PRINT_PEN[th.color],
                    display: "inline-block",
                  }}
                />
                <strong>{th.label}</strong>
                <span style={{ color: "#888" }}>
                  ({th.verses.length} · {th.total} pts)
                </span>
              </span>
            ))}
          </div>
        )}
        <hr
          style={{
            border: "none",
            borderTop: "2px solid #1a1a1a",
            margin: "0 0 20px",
          }}
        />

        {themes.length === 0 ? (
          <p style={{ color: "#777" }}>No marks to map in this selection.</p>
        ) : (
          <svg
            viewBox={`${minX} ${minY} ${vbW} ${vbH}`}
            style={{ width: "100%", height: "auto", maxHeight: "70vh" }}
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect x={minX} y={minY} width={vbW} height={vbH} fill="#ffffff" />

            {/* Structural lines */}
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
                    stroke="#dddddd"
                    strokeWidth={1.5}
                  />
                );
              })
            )}

            {/* User links */}
            {links
              .filter((l) => idSet.has(l.from) && idSet.has(l.to))
              .map((l) => {
                const a = posOf(l.from);
                const b = posOf(l.to);
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                const lw = Math.max(20, (l.label || "").length * 6.4 + 8);
                return (
                  <g key={l.id}>
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="#555555"
                      strokeWidth={1.5}
                      strokeDasharray="2 6"
                    />
                    {l.label && (
                      <>
                        <rect
                          x={mx - lw / 2}
                          y={my - 9}
                          width={lw}
                          height={18}
                          rx={9}
                          fill="#ffffff"
                          stroke="#ccc"
                        />
                        <text
                          x={mx}
                          y={my + 4}
                          textAnchor="middle"
                          fontSize={11}
                          fontFamily="system-ui, sans-serif"
                          fill="#333"
                        >
                          {l.label}
                        </text>
                      </>
                    )}
                  </g>
                );
              })}

            {/* Verse nodes */}
            {themes.map((th) =>
              th.verses.map((v) => {
                const p = posOf(verseId(th.color, v.reference));
                const w = verseW(v.points);
                return (
                  <g key={"v" + th.color + v.reference}>
                    <rect
                      x={p.x - w / 2}
                      y={p.y - 17}
                      width={w}
                      height={34}
                      rx={9}
                      fill="#ffffff"
                      stroke="#cccccc"
                    />
                    <rect
                      x={p.x - w / 2}
                      y={p.y - 17}
                      width={4}
                      height={34}
                      fill={PRINT_PEN[th.color]}
                    />
                    <text
                      x={p.x - w / 2 + 12}
                      y={p.y + 1}
                      fontSize={11}
                      fontWeight={600}
                      fontFamily="system-ui, sans-serif"
                      fill="#1a1a1a"
                    >
                      {truncate(v.reference, 16)}
                    </text>
                    <text
                      x={p.x + w / 2 - 8}
                      y={p.y + 1}
                      textAnchor="end"
                      fontSize={9}
                      fontWeight={700}
                      fontFamily="system-ui, sans-serif"
                      fill={PRINT_PEN[th.color]}
                    >
                      +{v.points}
                    </text>
                  </g>
                );
              })
            )}

            {/* Theme nodes */}
            {themes.map((th) => {
              const p = posOf(themeId(th.color));
              const w = themeW(th.label);
              return (
                <g key={"t" + th.color}>
                  <rect
                    x={p.x - w / 2}
                    y={p.y - 16}
                    width={w}
                    height={32}
                    rx={16}
                    fill="#ffffff"
                    stroke={PRINT_PEN[th.color]}
                    strokeWidth={2}
                  />
                  <circle
                    cx={p.x - w / 2 + 17}
                    cy={p.y}
                    r={6}
                    fill={PRINT_PEN[th.color]}
                  />
                  <text
                    x={p.x - w / 2 + 30}
                    y={p.y + 4}
                    fontSize={13}
                    fontWeight={700}
                    fontFamily="system-ui, sans-serif"
                    fill="#1a1a1a"
                  >
                    {truncate(th.label, 22)}
                  </text>
                  <text
                    x={p.x + w / 2 - 10}
                    y={p.y + 4}
                    textAnchor="end"
                    fontSize={10}
                    fontFamily="system-ui, sans-serif"
                    fill="#888"
                  >
                    {th.verses.length}
                  </text>
                </g>
              );
            })}
          </svg>
        )}

        <div
          style={{
            marginTop: "30px",
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
