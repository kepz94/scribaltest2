import { useMemo, useState } from "react";
import { volumesProxy } from "../data/scripturesStore";
import { Mark, MarkColor, COLOR_MAP, Tab } from "../types";

const vols = volumesProxy;

// ── Charting: the co-occurrence matrix ──────────────────────────────────────
// Each cell counts the verses that carry BOTH themes; the diagonal is each
// theme alone. Tap a cell and the shared verses list beneath it. This answers
// the one question no other view can: where do my themes meet?

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

export default function Charting(props: ChartingProps) {
  const { compileTabs, marks, colorLabels, onJumpToReference } = props;
  const [sel, setSel] = useState<{ a: MarkColor; b: MarkColor } | null>(null);

  const { activeColors, solo, pair, versesFor, nameOf } = useMemo(() => {
    type Meta = { reference: string; text: string; order: number };
    const refMeta: Record<string, Meta> = {};
    compileTabs.forEach((t, ti) => {
      const book = vols[t.volume].books[t.book];
      const chapter = book.chapters[t.chapter];
      chapter.verses.forEach((v, i) => {
        refMeta[v.reference] = {
          reference: v.reference,
          text: v.text,
          order: ti * 100000 + i,
        };
      });
    });
    const inScope = marks.filter((m) => refMeta[m.reference]);
    const colorsByRef = new Map<string, Set<MarkColor>>();
    inScope.forEach((m) => {
      const s = colorsByRef.get(m.reference) || new Set<MarkColor>();
      s.add(m.color);
      colorsByRef.set(m.reference, s);
    });
    const soloMap = new Map<MarkColor, number>();
    colorsByRef.forEach((set) =>
      set.forEach((c) => soloMap.set(c, (soloMap.get(c) || 0) + 1))
    );
    const activeColors = Array.from(soloMap.keys()).sort(
      (a, b) => (soloMap.get(b) || 0) - (soloMap.get(a) || 0)
    );
    const pair = (a: MarkColor, b: MarkColor) => {
      let n = 0;
      colorsByRef.forEach((set) => {
        if (set.has(a) && set.has(b)) n++;
      });
      return n;
    };
    const versesFor = (a: MarkColor, b: MarkColor): Meta[] => {
      const out: Meta[] = [];
      colorsByRef.forEach((set, ref) => {
        if (set.has(a) && set.has(b)) out.push(refMeta[ref]);
      });
      return out.sort((x, y) => x.order - y.order);
    };
    const nameOf = (c: MarkColor) =>
      (colorLabels[c] || "").trim() || "Color " + c;
    return {
      activeColors,
      solo: (c: MarkColor) => soloMap.get(c) || 0,
      pair,
      versesFor,
      nameOf,
    };
  }, [compileTabs, marks, colorLabels]);

  const caps: React.CSSProperties = {
    fontFamily: "system-ui, sans-serif",
    fontSize: "10px",
    fontWeight: 800,
    letterSpacing: ".18em",
    textTransform: "uppercase",
    color: "var(--muted)",
  };
  const dot = (c: MarkColor): React.CSSProperties => ({
    display: "inline-block",
    width: "9px",
    height: "9px",
    borderRadius: "50%",
    background: COLOR_MAP[c],
    marginRight: "6px",
    verticalAlign: "baseline",
  });

  if (!activeColors.length) {
    return (
      <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "14px", padding: "40px 28px", textAlign: "center", color: "var(--muted)", fontStyle: "italic", fontSize: "14px" }}>
        No marks in these chapters yet — mark a few verses and their themes will
        chart here.
      </div>
    );
  }

  const isSel = (a: MarkColor, b: MarkColor) =>
    !!sel && ((sel.a === a && sel.b === b) || (sel.a === b && sel.b === a));

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "14px", padding: "24px 26px 28px" }}>
      <div style={caps}>Where themes meet</div>
      <div style={{ fontSize: "12.5px", color: "var(--muted)", fontStyle: "italic", margin: "5px 0 18px" }}>
        Each cell counts the verses carrying both themes; the diagonal is each
        theme alone. Tap a cell to list its verses.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontFamily: "system-ui, sans-serif", fontSize: "12px" }}>
          <thead>
            <tr>
              <th />
              {activeColors.map((c) => (
                <th key={c} style={{ fontWeight: 700, fontSize: "10.5px", padding: "6px 8px", color: "var(--muted)", maxWidth: "86px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={dot(c)} />
                  {nameOf(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeColors.map((a) => (
              <tr key={a}>
                <th style={{ fontWeight: 700, fontSize: "11px", textAlign: "right", padding: "0 12px 0 0", whiteSpace: "nowrap", color: "var(--text)" }}>
                  <span style={dot(a)} />
                  {nameOf(a)}
                </th>
                {activeColors.map((b) => {
                  const n = a === b ? solo(a) : pair(a, b);
                  const self = a === b;
                  return (
                    <td
                      key={b}
                      onClick={() => (n ? setSel({ a, b }) : undefined)}
                      style={{
                        width: "58px",
                        height: "44px",
                        textAlign: "center",
                        border: "1px solid var(--border)",
                        fontWeight: self ? 600 : 700,
                        background: self ? "var(--soft)" : "transparent",
                        color: n ? (self ? "var(--muted)" : "var(--text)") : "var(--border)",
                        cursor: n ? "pointer" : "default",
                        outline: isSel(a, b) ? "2.5px solid #8b5cf6" : "none",
                        outlineOffset: "-2.5px",
                      }}
                    >
                      {n || "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sel && (
        <div style={{ marginTop: "18px", border: "1px solid #8b5cf6", borderRadius: "10px", padding: "14px 16px" }}>
          <div style={{ ...caps, display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px", letterSpacing: ".14em" }}>
            <span style={dot(sel.a)} />
            {nameOf(sel.a)}
            {sel.a !== sel.b && (
              <>
                <span style={{ color: "var(--muted)" }}>∩</span>
                <span style={dot(sel.b)} />
                {nameOf(sel.b)}
              </>
            )}
            <span style={{ marginLeft: "4px", color: "var(--muted)", fontWeight: 600 }}>
              — {versesFor(sel.a, sel.b).length} verse
              {versesFor(sel.a, sel.b).length === 1 ? "" : "s"}
            </span>
            <button onClick={() => setSel(null)} style={{ marginLeft: "auto", background: "transparent", border: "none", color: "var(--muted)", fontSize: "14px", cursor: "pointer" }}>
              ✕
            </button>
          </div>
          {versesFor(sel.a, sel.b).map((v) => (
            <div
              key={v.reference}
              onClick={() => onJumpToReference(v.reference)}
              style={{ display: "flex", gap: "12px", padding: "7px 0", borderBottom: "1px dashed var(--border)", cursor: "pointer" }}
            >
              <span style={{ fontFamily: "system-ui, sans-serif", fontSize: "10.5px", fontWeight: 800, flex: "0 0 92px", paddingTop: "3px", color: "#8b5cf6" }}>
                {v.reference}
              </span>
              <span style={{ fontFamily: '"Times New Roman", Times, serif', fontSize: "14px", lineHeight: 1.55, color: "var(--text)" }}>
                {v.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
