import { useEffect, useState } from "react";
import scriptures from "../data/scriptures.json";
import { Mark, MarkColor, COLORS, COLOR_MAP, HIGHLIGHT_MAP } from "../types";
import { Tab } from "../types";

interface CovenantsProps {
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

const vols = scriptures.volumes;
const ROLES_KEY = "scribal_covenant_roles";

function readRoles(): { condition: MarkColor; promise: MarkColor } {
  try {
    const raw = localStorage.getItem(ROLES_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      const c = COLORS.indexOf(p.condition) >= 0 ? (p.condition as MarkColor) : 1;
      const pr = COLORS.indexOf(p.promise) >= 0 ? (p.promise as MarkColor) : 2;
      return { condition: c, promise: pr };
    }
  } catch {
    // ignore malformed storage
  }
  return { condition: 1, promise: 2 };
}

export default function Covenants(props: CovenantsProps) {
  const { compileTabs, marks, colorLabels, onJumpToReference } = props;

  const init = readRoles();
  const [conditionColor, setConditionColor] = useState<MarkColor>(
    init.condition
  );
  const [promiseColor, setPromiseColor] = useState<MarkColor>(init.promise);

  useEffect(() => {
    try {
      localStorage.setItem(
        ROLES_KEY,
        JSON.stringify({ condition: conditionColor, promise: promiseColor })
      );
    } catch {
      // ignore storage failure
    }
  }, [conditionColor, promiseColor]);

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

  // Joined marked text for one role-color within a verse (gaps shown as "…").
  const textForRole = (
    reference: string,
    text: string,
    color: MarkColor
  ): string => {
    const ms = marks
      .filter((m) => m.reference === reference && m.color === color)
      .slice()
      .sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex);
    const parts: string[] = [];
    let covered = 0;
    ms.forEach((m) => {
      const start = Math.max(0, Math.min(m.startIndex, text.length));
      const end = Math.max(start, Math.min(m.endIndex, text.length));
      const from = Math.max(start, covered);
      if (end <= from) return;
      const piece = text.slice(from, end).replace(/\s+/g, " ").trim();
      const gap = parts.length > 0 && start > covered;
      covered = end;
      if (!piece) return;
      if (gap) parts.push("…");
      parts.push(piece);
    });
    return parts.join(" ");
  };

  const sameColor = conditionColor === promiseColor;

  type Row = { reference: string; condition: string; promise: string };
  type Half = { reference: string; role: "condition" | "promise"; text: string };
  const rows: Row[] = [];
  const half: Half[] = [];
  if (!sameColor) {
    entries.forEach((e) => {
      const cond = textForRole(e.reference, e.text, conditionColor);
      const prom = textForRole(e.reference, e.text, promiseColor);
      if (cond && prom)
        rows.push({ reference: e.reference, condition: cond, promise: prom });
      else if (cond)
        half.push({ reference: e.reference, role: "condition", text: cond });
      else if (prom)
        half.push({ reference: e.reference, role: "promise", text: prom });
    });
  }

  const swatch = (color: MarkColor, selected: boolean, onClick: () => void) => (
    <button
      key={color}
      onClick={onClick}
      title={colorLabels[color] || "Color " + color}
      style={{
        width: "26px",
        height: "26px",
        borderRadius: "7px",
        background: COLOR_MAP[color],
        border: selected ? "3px solid var(--text)" : "3px solid transparent",
        boxShadow: selected ? "0 0 0 1px var(--border)" : "none",
        cursor: "pointer",
        padding: 0,
      }}
    />
  );

  const dot = (color: MarkColor) => (
    <span
      style={{
        display: "inline-block",
        width: "14px",
        height: "14px",
        borderRadius: "4px",
        background: COLOR_MAP[color],
        verticalAlign: "middle",
        margin: "0 2px",
      }}
    />
  );

  return (
    <div
      style={{ padding: "20px 20px 90px", maxWidth: "820px", margin: "0 auto" }}
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
        Covenant Ledger
      </div>
      <h2 style={{ margin: "0 0 6px 0", fontWeight: 500 }}>
        {compileTabs.length === 0
          ? "Nothing selected"
          : compileTabs.map(tabLabel).join("  ·  ")}
      </h2>
      <p
        style={{
          fontSize: "12.5px",
          color: "var(--muted)",
          marginBottom: "20px",
          lineHeight: 1.5,
        }}
      >
        Mark each condition and the promise it unlocks — they pair here as If →
        Then.
      </p>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          padding: "14px 16px",
          background: "var(--soft)",
          borderRadius: "12px",
          marginBottom: "24px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: "12.5px",
              fontWeight: 600,
              width: "112px",
              color: "var(--text)",
            }}
          >
            Mark conditions
          </span>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {COLORS.map((c) =>
              swatch(c, c === conditionColor, () => setConditionColor(c))
            )}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: "12.5px",
              fontWeight: 600,
              width: "112px",
              color: "var(--text)",
            }}
          >
            Mark promises
          </span>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {COLORS.map((c) =>
              swatch(c, c === promiseColor, () => setPromiseColor(c))
            )}
          </div>
        </div>
      </div>

      {compileTabs.length === 0 && (
        <p style={{ color: "var(--muted)", textAlign: "center", padding: "40px" }}>
          Select at least one chapter.
        </p>
      )}

      {compileTabs.length > 0 && sameColor && (
        <p
          style={{
            color: "var(--muted)",
            textAlign: "center",
            padding: "30px 20px",
          }}
        >
          Choose two <em>different</em> colors for conditions and promises.
        </p>
      )}

      {compileTabs.length > 0 && !sameColor && rows.length === 0 && half.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "36px 20px",
            color: "var(--muted)",
            lineHeight: 1.8,
          }}
        >
          <div style={{ marginBottom: "8px" }}>No covenants yet.</div>
          <div style={{ fontSize: "13.5px" }}>
            In the reading view, mark a condition {dot(conditionColor)} and its
            promise {dot(promiseColor)} within the same verse — the pair appears
            here.
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div>
          <div
            style={{
              display: "flex",
              gap: "12px",
              alignItems: "center",
              padding: "0 4px 8px",
              fontSize: "11px",
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              color: "var(--muted)",
              fontWeight: 700,
            }}
          >
            <div style={{ flex: 1 }}>If</div>
            <div style={{ width: "22px" }} />
            <div style={{ flex: 1 }}>Then</div>
            <div style={{ width: "64px" }} />
          </div>
          {rows.map((r, i) => (
            <div
              key={r.reference + "_" + i}
              style={{
                display: "flex",
                gap: "12px",
                alignItems: "stretch",
                marginBottom: "10px",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  flex: "1 1 240px",
                  background: HIGHLIGHT_MAP[conditionColor],
                  borderLeft: "3px solid " + COLOR_MAP[conditionColor],
                  borderRadius: "8px",
                  padding: "12px 14px",
                  fontFamily: '"Times New Roman", Times, serif',
                  fontSize: "16px",
                  lineHeight: 1.55,
                }}
              >
                {r.condition}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "22px",
                  color: "var(--muted)",
                  fontSize: "18px",
                }}
              >
                →
              </div>
              <div
                style={{
                  flex: "1 1 240px",
                  background: HIGHLIGHT_MAP[promiseColor],
                  borderLeft: "3px solid " + COLOR_MAP[promiseColor],
                  borderRadius: "8px",
                  padding: "12px 14px",
                  fontFamily: '"Times New Roman", Times, serif',
                  fontSize: "16px",
                  lineHeight: 1.55,
                }}
              >
                {r.promise}
              </div>
              <button
                onClick={() => onJumpToReference(r.reference)}
                title="Open in reading view"
                style={{
                  width: "64px",
                  border: "none",
                  background: "transparent",
                  color: "var(--muted)",
                  fontSize: "11px",
                  cursor: "pointer",
                  textDecoration: "underline",
                  textDecorationStyle: "dotted",
                  padding: 0,
                  alignSelf: "center",
                  fontFamily: "inherit",
                }}
              >
                {r.reference}
              </button>
            </div>
          ))}
        </div>
      )}

      {half.length > 0 && (
        <div style={{ marginTop: "26px" }}>
          <div
            style={{
              fontSize: "11px",
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              color: "var(--muted)",
              fontWeight: 700,
              marginBottom: "10px",
            }}
          >
            Half-marked — add the other side
          </div>
          {half.map((h, i) => (
            <div
              key={h.reference + "_" + i}
              style={{
                display: "flex",
                gap: "10px",
                alignItems: "baseline",
                marginBottom: "7px",
                fontSize: "13.5px",
              }}
            >
              <button
                onClick={() => onJumpToReference(h.reference)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--muted)",
                  cursor: "pointer",
                  textDecoration: "underline",
                  textDecorationStyle: "dotted",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  padding: 0,
                  fontSize: "13.5px",
                  fontFamily: "inherit",
                }}
              >
                {h.reference}
              </button>
              <span
                style={{
                  fontFamily: '"Times New Roman", Times, serif',
                  color: "var(--text)",
                }}
              >
                {"“" + h.text + "”"}{" "}
                <span
                  style={{
                    fontFamily: "system-ui, sans-serif",
                    color: "var(--muted)",
                    fontSize: "12px",
                  }}
                >
                  — needs the{" "}
                  {h.role === "condition" ? "promise" : "condition"}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
