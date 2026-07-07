import { useMemo, useState } from "react";
import { Mark, MarkColor, COLOR_MAP } from "../types";
import { volumesProxy } from "../data/scripturesStore";

// ── Semantic view ────────────────────────────────────────────────────────────
// One surface, four altitudes: the study as a color shape → named theme
// masses → a theme's fragments (entered through the user's own synthesis, the
// "doorway") → ground level, the verse itself with marks lit. Tap to descend,
// breadcrumbs to climb. v1 ships the approved cut: altitudes, the gap chip
// (unmarked verses — the only feature in the app about what you HAVEN'T done),
// convergence/note glints, and the doorway. Compare mode and the time scrub
// are deliberate fast-follows.

const vols = volumesProxy;

interface Tab {
  volume: number;
  book: number;
  chapter: number;
  [k: string]: any;
}

interface Props {
  compileTabs: Tab[];
  marks: Mark[];
  colorLabels: Record<number, string>;
  onJumpToReference: (reference: string) => void;
  // Shell-specific note plumbing, abstracted: mobile keys "versenote:<ref>",
  // desktop keys differ — each shell hands us readers.
  noteFor: (ref: string) => string;
  synthesisFor: (color: number) => string;
  // Palette hooks (mobile passes its C; desktop CSS vars via defaults)
  panel?: string;
  border?: string;
  text?: string;
  muted?: string;
}

interface Row {
  ref: string;
  verse: number;
  text: string;
  chapterTitle: string;
  firstOfChapter: boolean;
  colors: MarkColor[];
  weight: number;
  hasNote: boolean;
}

const STYLE_PTS: Record<string, number> = {
  bold: 3,
  circle: 3,
  underline: 2,
  italic: 2,
  highlight: 1,
  box: 3,
  dashed: 2,
  squiggly: 2,
};

export default function SemanticView({
  compileTabs,
  marks,
  colorLabels,
  onJumpToReference,
  noteFor,
  synthesisFor,
  panel = "var(--panel)",
  border = "var(--border)",
  text = "var(--text)",
  muted = "var(--muted)",
}: Props) {
  const [alt, setAlt] = useState<1 | 2 | 3 | 4>(1);
  const [selColor, setSelColor] = useState<MarkColor | null>(null);
  const [selRef, setSelRef] = useState<string | null>(null);
  const [gapsOpen, setGapsOpen] = useState(false);
  // Altitude-1 layout: one continuous strip, or one row per chapter stacked
  // on a SHARED weight scale so chapters compare honestly.
  const [stacked, setStacked] = useState(false);

  const byRef = useMemo(() => {
    const m = new Map<string, Mark[]>();
    marks.forEach((mk) => {
      const a = m.get(mk.reference) || [];
      a.push(mk);
      m.set(mk.reference, a);
    });
    return m;
  }, [marks]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    compileTabs.forEach((t) => {
      const ch = vols[t.volume]?.books?.[t.book]?.chapters?.[t.chapter];
      if (!ch) return;
      const title =
        (vols[t.volume]?.books?.[t.book]?.book || "") + " " + ch.chapter;
      (ch.verses || []).forEach((v: any, i: number) => {
        const ms = byRef.get(v.reference) || [];
        const colors = Array.from(new Set(ms.map((m) => m.color)));
        out.push({
          ref: v.reference,
          verse: v.verse,
          text: v.text || "",
          chapterTitle: title,
          firstOfChapter: i === 0,
          colors,
          weight: ms.reduce((s, m) => s + (STYLE_PTS[m.style] || 1), 0),
          hasNote: !!noteFor(v.reference).trim(),
        });
      });
    });
    return out;
    // eslint-disable-next-line
  }, [compileTabs, byRef]);

  const marked = rows.filter((r) => r.colors.length > 0);
  const gaps = rows.filter((r) => r.colors.length === 0);
  const maxW = Math.max(1, ...marked.map((r) => r.weight));

  const themeColors: MarkColor[] = useMemo(() => {
    const cnt = new Map<MarkColor, number>();
    marked.forEach((r) =>
      r.colors.forEach((c) => cnt.set(c, (cnt.get(c) || 0) + 1))
    );
    return Array.from(cnt.keys()).sort(
      (a, b) => (cnt.get(b) || 0) - (cnt.get(a) || 0)
    );
  }, [marked]);

  const nameOf = (c: MarkColor) =>
    (colorLabels[c] || "").trim() || "Color " + c;
  const versesOf = (c: MarkColor) => marked.filter((r) => r.colors.includes(c));

  const dominant = (r: Row): MarkColor => {
    let best = r.colors[0];
    let bw = -1;
    r.colors.forEach((c) => {
      const w = (byRef.get(r.ref) || [])
        .filter((m) => m.color === c)
        .reduce((s, m) => s + (STYLE_PTS[m.style] || 1), 0);
      if (w > bw) {
        bw = w;
        best = c;
      }
    });
    return best;
  };

  const goVerse = (ref: string) => {
    setSelRef(ref);
    setAlt(4);
  };
  const goTheme = (c: MarkColor) => {
    setSelColor(c);
    setAlt(3);
  };
  const up = () => {
    if (gapsOpen) return setGapsOpen(false);
    if (alt === 4) setAlt(selColor ? 3 : 1);
    else if (alt === 3) setAlt(2);
    else if (alt === 2) setAlt(1);
  };

  // ── ground-level verse renderer: segments by mark boundaries ─────────────
  const renderVerse = (r: Row) => {
    const ms = (byRef.get(r.ref) || [])
      .slice()
      .sort((a, b) => a.startIndex - b.startIndex);
    const bounds = new Set<number>([0, r.text.length]);
    ms.forEach((m) => {
      bounds.add(Math.max(0, m.startIndex));
      bounds.add(Math.min(r.text.length, m.endIndex));
    });
    const pts = Array.from(bounds).sort((a, b) => a - b);
    const segs: React.ReactNode[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const s = pts[i];
      const e = pts[i + 1];
      const active = ms.filter((m) => m.startIndex <= s && m.endIndex >= e);
      const piece = r.text.slice(s, e);
      if (!active.length) {
        segs.push(<span key={i}>{piece}</span>);
        continue;
      }
      const st: React.CSSProperties = {};
      active.forEach((m) => {
        const col = COLOR_MAP[m.color];
        if (m.style === "highlight") {
          st.backgroundColor = col + "45";
          st.borderRadius = "2px";
        } else if (m.style === "bold") st.fontWeight = 800;
        else if (m.style === "italic") st.fontStyle = "italic";
        else if (m.style === "circle" || m.style === "box") {
          st.border = "1.5px solid " + col;
          st.borderRadius = m.style === "circle" ? "8px" : "3px";
          st.padding = "0 2px";
        } else {
          st.textDecoration = "underline";
          st.textDecorationColor = col;
          st.textDecorationThickness = "2px";
          if (m.style === "dashed") st.textDecorationStyle = "dashed";
          if (m.style === "squiggly") st.textDecorationStyle = "wavy";
        }
      });
      segs.push(
        <span key={i} style={st}>
          {piece}
        </span>
      );
    }
    return segs;
  };

  // ── shared chrome ─────────────────────────────────────────────────────────
  const dots = (
    <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          style={{
            width: n === alt ? "14px" : "6px",
            height: "6px",
            borderRadius: "3px",
            background: n === alt ? "#8b5cf6" : border,
            transition: "width .2s",
          }}
        />
      ))}
    </div>
  );

  const card: React.CSSProperties = {
    background: panel,
    border: "1px solid " + border,
    borderRadius: "13px",
    padding: "13px",
  };
  const chipStyle: React.CSSProperties = {
    fontSize: "11px",
    fontWeight: 700,
    border: "1px solid " + border,
    borderRadius: "999px",
    padding: "6px 12px",
    background: "transparent",
    color: muted,
    cursor: "pointer",
    fontFamily: "inherit",
    minHeight: "36px",
  };

  const header = (label: string) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        marginBottom: "10px",
      }}
    >
      {alt > 1 || gapsOpen ? (
        <button onClick={up} style={chipStyle} aria-label="Zoom out">
          ‹ up
        </button>
      ) : null}
      <span
        style={{
          fontSize: "10px",
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          color: muted,
          fontWeight: 800,
          flex: 1,
        }}
      >
        {label}
      </span>
      {dots}
    </div>
  );

  // ── altitudes ─────────────────────────────────────────────────────────────
  if (gapsOpen) {
    return (
      <div style={card}>
        {header(gaps.length + " verses you haven't marked")}
        <div style={{ maxHeight: "340px", overflowY: "auto" }}>
          {gaps.map((r) => (
            <button
              key={r.ref}
              onClick={() => onJumpToReference(r.ref)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                borderBottom: "1px solid " + border,
                padding: "9px 2px",
                cursor: "pointer",
                fontFamily: "inherit",
                color: text,
              }}
            >
              <span style={{ fontSize: "10px", fontWeight: 800, color: muted }}>
                {r.ref}
              </span>
              <span
                style={{
                  display: "block",
                  fontFamily: '"Times New Roman", Times, serif',
                  fontSize: "12.5px",
                  color: muted,
                  lineHeight: 1.5,
                }}
              >
                {r.text.slice(0, 90)}
                {r.text.length > 90 ? "…" : ""}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const bar = (r: Row) => {
    const h = r.colors.length
      ? Math.max(14, Math.round((r.weight / maxW) * 100))
      : 6;
    const col = r.colors.length ? COLOR_MAP[dominant(r)] : border;
    return (
      <button
        key={r.ref}
        onClick={() => (r.colors.length ? goVerse(r.ref) : undefined)}
        aria-label={r.ref}
        title={r.ref}
        style={{
          flex: 1,
          height: h + "%",
          minWidth: "3px",
          background: col,
          opacity: r.colors.length ? 1 : 0.5,
          border: "none",
          borderRadius: "2px 2px 0 0",
          padding: 0,
          cursor: r.colors.length ? "pointer" : "default",
          position: "relative",
        }}
      >
        {r.colors.length > 1 && (
          <span style={{ position: "absolute", top: "-13px", left: "50%", transform: "translateX(-50%)", fontSize: "9px", color: "#ffd76a" }}>✦</span>
        )}
        {r.colors.length === 1 && r.hasNote && (
          <span style={{ position: "absolute", top: "-12px", left: "50%", transform: "translateX(-50%)", fontSize: "8px", color: muted }}>▤</span>
        )}
      </button>
    );
  };

  if (alt === 1 && stacked) {
    const chapters = Array.from(new Set(rows.map((r) => r.chapterTitle)));
    return (
      <div style={card}>
        {header("Chapters against each other — bars sit where the marks fall")}
        <div style={{ display: "flex", gap: "7px", marginBottom: "12px" }}>
          <button onClick={() => setStacked(false)} style={chipStyle}>
            Flow
          </button>
          <button onClick={() => setStacked(true)} style={{ ...chipStyle, borderColor: "#8b5cf6", color: "#b79df5" }}>
            Stacked ✓
          </button>
        </div>
        {/* one legend for all rows — the themes are the same themes in every
            chapter, so their full names live up here once */}
        {(() => {
          const totals = new Map<MarkColor, number>();
          marked.forEach((r) =>
            r.colors.forEach((c) => totals.set(c, (totals.get(c) || 0) + 1))
          );
          return (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginBottom: "14px" }}>
              {Array.from(totals.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([c, n]) => (
                  <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: 700, color: text }}>
                    <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: COLOR_MAP[c], display: "inline-block" }} />
                    {nameOf(c)}
                    <span style={{ color: muted, fontWeight: 500 }}>{n}</span>
                  </span>
                ))}
            </div>
          );
        })()}
        {chapters.map((ct) => {
          const chRows = rows.filter((r) => r.chapterTitle === ct);
          const tally = new Map<MarkColor, number>();
          chRows.forEach((r) =>
            r.colors.forEach((c) => tally.set(c, (tally.get(c) || 0) + 1))
          );
          return (
            <div key={ct} style={{ marginBottom: "10px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "5px" }}>
                <span style={{ fontSize: "11px", fontWeight: 800, color: text }}>
                  {ct}
                </span>
                <span style={{ display: "flex", gap: "8px", fontSize: "10px", color: muted }}>
                  {Array.from(tally.entries())
                    .sort((a, b) => b[1] - a[1])
                    .map(([c, n]) => (
                      <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                        <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: COLOR_MAP[c], display: "inline-block" }} />
                        {n}
                      </span>
                    ))}
                </span>
              </div>
              {(() => {
                const n = chRows.length;
                const lastV = chRows[n - 1] ? chRows[n - 1].verse : n;
                return (
                  <div>
                    {/* the chapter as a track: start → end, marks at their true
                        verse positions; faint quarter-guides line up across
                        every chapter so the same x = the same relative spot */}
                    <div
                      style={{
                        position: "relative",
                        height: "44px",
                        background: "rgba(127,127,127,0.07)",
                        borderRadius: "6px",
                        borderBottom: "2px solid " + border,
                        overflow: "visible",
                      }}
                    >
                      {[25, 50, 75].map((pct) => (
                        <span key={pct} style={{ position: "absolute", left: pct + "%", top: "6px", bottom: "0", width: "1px", background: border, opacity: 0.5 }} />
                      ))}
                      {chRows.map((r, i) =>
                        r.colors.length ? (
                          <button
                            key={r.ref}
                            onClick={() => goVerse(r.ref)}
                            aria-label={r.ref}
                            title={r.ref + " · v" + r.verse}
                            style={{
                              position: "absolute",
                              left: (n > 1 ? (i / (n - 1)) * 100 : 50) + "%",
                              transform: "translateX(-50%)",
                              bottom: 0,
                              width: "clamp(4px, " + 100 / n + "%, 9px)",
                              height: Math.max(18, Math.round((r.weight / maxW) * 88)) + "%",
                              borderRadius: "3px 3px 0 0",
                              background: COLOR_MAP[dominant(r)],
                              border: "none",
                              padding: 0,
                              cursor: "pointer",
                            }}
                          >
                            {r.colors.length > 1 && (
                              <span style={{ position: "absolute", top: "-13px", left: "50%", transform: "translateX(-50%)", fontSize: "9px", color: "#ffd76a" }}>✦</span>
                            )}
                            {r.colors.length === 1 && r.hasNote && (
                              <span style={{ position: "absolute", top: "-12px", left: "50%", transform: "translateX(-50%)", fontSize: "8px", color: muted }}>▤</span>
                            )}
                          </button>
                        ) : null
                      )}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: muted, marginTop: "2px" }}>
                      <span>v1</span>
                      <span>v{lastV}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}
        <div style={{ fontSize: "10px", color: muted, fontStyle: "italic", lineHeight: 1.5 }}>
          Every row runs the chapter start → end; bars stand where their verses
          fall, so the same position lines up across chapters. Heights share one
          scale — a tall bar means the same weight everywhere. Dots tally themes.
        </div>
      </div>
    );
  }

  if (alt === 1) {
    return (
      <div style={card}>
        {header("The study's shape — tap a bar to land on its verse")}
        <div style={{ display: "flex", gap: "7px", marginBottom: "12px" }}>
          <button onClick={() => setStacked(false)} style={{ ...chipStyle, borderColor: "#8b5cf6", color: "#b79df5" }}>
            Flow ✓
          </button>
          <button onClick={() => setStacked(true)} style={chipStyle}>
            Stacked
          </button>
        </div>
        <div
          style={{
            display: "flex",
            gap: "2px",
            alignItems: "flex-end",
            height: "70px",
          }}
        >
          {rows.map((r) => {
            const h = r.colors.length
              ? Math.max(14, Math.round((r.weight / maxW) * 100))
              : 6;
            const col = r.colors.length ? COLOR_MAP[dominant(r)] : border;
            return (
              <button
                key={r.ref}
                onClick={() => (r.colors.length ? goVerse(r.ref) : undefined)}
                aria-label={r.ref}
                title={r.ref}
                style={{
                  flex: 1,
                  height: h + "%",
                  minWidth: "3px",
                  background: col,
                  opacity: r.colors.length ? 1 : 0.5,
                  border: "none",
                  borderRadius: "2px 2px 0 0",
                  padding: 0,
                  cursor: r.colors.length ? "pointer" : "default",
                  position: "relative",
                }}
              >
                {r.colors.length > 1 && (
                  <span
                    style={{
                      position: "absolute",
                      top: "-13px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      fontSize: "9px",
                      color: "#ffd76a",
                    }}
                  >
                    ✦
                  </span>
                )}
                {r.colors.length === 1 && r.hasNote && (
                  <span
                    style={{
                      position: "absolute",
                      top: "-12px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      fontSize: "8px",
                      color: muted,
                    }}
                  >
                    ▤
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "9.5px",
            color: muted,
            marginTop: "5px",
          }}
        >
          {compileTabs.map((t, i) => (
            <span key={i}>
              {vols[t.volume]?.books?.[t.book]?.book}{" "}
              {vols[t.volume]?.books?.[t.book]?.chapters?.[t.chapter]?.chapter}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
          <button onClick={() => setAlt(2)} style={{ ...chipStyle, borderColor: "#8b5cf6", color: "#b79df5" }}>
            Zoom into the themes ↘
          </button>
          {gaps.length > 0 && (
            <button
              onClick={() => setGapsOpen(true)}
              style={{ ...chipStyle, borderStyle: "dashed" }}
            >
              ◌ {gaps.length} unmarked — what you've skipped
            </button>
          )}
        </div>
        <div style={{ fontSize: "10px", color: muted, fontStyle: "italic", marginTop: "8px", lineHeight: 1.5 }}>
          ✦ themes collide there · ▤ a note lives there
        </div>
      </div>
    );
  }

  if (alt === 2) {
    return (
      <div style={card}>
        {header("Your themes — tap one to enter it")}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {themeColors.map((c) => {
            const n = versesOf(c).length;
            return (
              <button
                key={c}
                onClick={() => goTheme(c)}
                style={{
                  border: "none",
                  borderRadius: "12px",
                  padding: "12px 14px",
                  background: COLOR_MAP[c],
                  color: "#131210",
                  fontWeight: 800,
                  fontSize: 12 + Math.min(5, n / 4) + "px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  flexGrow: n,
                }}
              >
                {nameOf(c)} · {n}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (alt === 3 && selColor != null) {
    const synth = synthesisFor(selColor).trim();
    return (
      <div style={card}>
        {header(nameOf(selColor) + " — tap a fragment for its verse")}
        <div
          style={{
            borderLeft: "3px solid " + COLOR_MAP[selColor],
            padding: "6px 0 6px 11px",
            marginBottom: "12px",
          }}
        >
          <div style={{ fontSize: "8.5px", letterSpacing: "1.5px", color: muted, fontWeight: 800, marginBottom: "3px" }}>
            {synth ? "YOUR SYNTHESIS — THE DOORWAY" : "THE DOORWAY IS EMPTY"}
          </div>
          <div style={{ fontSize: "12.5px", fontStyle: "italic", color: synth ? text : muted, lineHeight: 1.55 }}>
            {synth ||
              "You haven't written what this theme means yet — its verses are below, waiting to be concluded."}
          </div>
        </div>
        <div style={{ fontFamily: '"Times New Roman", Times, serif', fontSize: "13.5px", lineHeight: 2.1 }}>
          {versesOf(selColor).map((r) => {
            const frs = (byRef.get(r.ref) || []).filter(
              (m) => m.color === selColor
            );
            return frs.map((m) => (
              <button
                key={m.id}
                onClick={() => goVerse(r.ref)}
                style={{
                  background: COLOR_MAP[selColor] + "38",
                  border: "none",
                  borderRadius: "3px",
                  padding: "1px 4px",
                  margin: "0 5px 4px 0",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: "inherit",
                  color: text,
                }}
              >
                {m.markedText}
              </button>
            ));
          })}
        </div>
      </div>
    );
  }

  if (alt === 4 && selRef) {
    const r = rows.find((x) => x.ref === selRef);
    if (!r) return null;
    const note = noteFor(r.ref).trim();
    return (
      <div style={card}>
        {header(r.ref)}
        <div
          style={{
            fontFamily: '"Times New Roman", Times, serif',
            fontSize: "15.5px",
            lineHeight: 1.95,
            color: text,
          }}
        >
          <span style={{ fontSize: "9px", color: muted, verticalAlign: "super", marginRight: "4px" }}>
            {r.verse}
          </span>
          {renderVerse(r)}
        </div>
        {note && (
          <div
            style={{
              marginTop: "10px",
              borderLeft: "2px solid " + (r.colors.length ? COLOR_MAP[dominant(r)] : border),
              paddingLeft: "10px",
              fontSize: "12px",
              fontStyle: "italic",
              color: muted,
              lineHeight: 1.6,
            }}
          >
            {note}
          </div>
        )}
        <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
          <button
            onClick={() => onJumpToReference(r.ref)}
            style={{ ...chipStyle, borderColor: "#8b5cf6", color: "#b79df5" }}
          >
            Jump to reader ↗
          </button>
        </div>
      </div>
    );
  }

  return null;
}
