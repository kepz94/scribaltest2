import { CSSProperties, useEffect, useRef, useState } from "react";
import scriptures from "../data/scriptures.json";
import {
  Mark,
  MarkColor,
  MarkStyle,
  COLORS,
  COLOR_MAP,
  markStyleCSS,
} from "../types";
import { Tab } from "../types";
import {
  renderCovenantCard,
  canvasURL,
  shareCanvas,
  CovenantPairData,
} from "../shareCard";

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

type Frag = {
  text: string;
  style: MarkStyle;
  color: MarkColor;
  gapBefore: boolean;
};

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

  // ----- share-card state -----
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [pendingPairs, setPendingPairs] = useState<CovenantPairData[] | null>(
    null
  );
  const [previewUrl, setPreviewUrl] = useState("");
  const [cardDark, setCardDark] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [shareMsg, setShareMsg] = useState("");
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

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

  // Ordered marked fragments of one role-color within a verse, each keeping the
  // exact style/color it was marked with so the ledger shows the real marks.
  const fragmentsForRole = (
    reference: string,
    text: string,
    color: MarkColor
  ): Frag[] => {
    const ms = marks
      .filter((m) => m.reference === reference && m.color === color)
      .slice()
      .sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex);
    const frags: Frag[] = [];
    let covered = 0;
    ms.forEach((m) => {
      const start = Math.max(0, Math.min(m.startIndex, text.length));
      const end = Math.max(start, Math.min(m.endIndex, text.length));
      const from = Math.max(start, covered);
      if (end <= from) return;
      const piece = text.slice(from, end).replace(/\s+/g, " ").trim();
      const gapBefore = frags.length > 0 && start > covered;
      covered = end;
      if (!piece) return;
      frags.push({ text: piece, style: m.style, color: m.color, gapBefore });
    });
    return frags;
  };

  const sameColor = conditionColor === promiseColor;

  type Row = { reference: string; condition: Frag[]; promise: Frag[] };
  type Half = {
    reference: string;
    role: "condition" | "promise";
    frags: Frag[];
  };
  const rows: Row[] = [];
  const half: Half[] = [];
  if (!sameColor) {
    entries.forEach((e) => {
      const cond = fragmentsForRole(e.reference, e.text, conditionColor);
      const prom = fragmentsForRole(e.reference, e.text, promiseColor);
      if (cond.length && prom.length)
        rows.push({ reference: e.reference, condition: cond, promise: prom });
      else if (cond.length)
        half.push({ reference: e.reference, role: "condition", frags: cond });
      else if (prom.length)
        half.push({ reference: e.reference, role: "promise", frags: prom });
    });
  }

  const renderFrags = (frags: Frag[]) =>
    frags.map((f, i) => (
      <span key={i}>
        {f.gapBefore && (
          <span
            style={{
              color: "var(--muted)",
              margin: "0 5px",
              fontFamily: "system-ui, sans-serif",
              fontSize: "0.8em",
            }}
          >
            …
          </span>
        )}
        {i > 0 && !f.gapBefore && " "}
        <span style={markStyleCSS(f.style, f.color)}>{f.text}</span>
      </span>
    ));

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

  const card = (frags: Frag[], color: MarkColor) => (
    <div
      style={{
        flex: "1 1 240px",
        background: "var(--soft)",
        borderLeft: "3px solid " + COLOR_MAP[color],
        borderRadius: "8px",
        padding: "12px 14px",
        fontFamily: '"Times New Roman", Times, serif',
        fontSize: "16px",
        lineHeight: 1.7,
        color: "var(--text)",
      }}
    >
      {renderFrags(frags)}
    </div>
  );

  // ----- share helpers -----
  const rowKey = (r: Row, i: number) => r.reference + "_" + i;

  const togglePick = (key: string) => {
    setPicked((cur) => {
      if (cur.includes(key)) return cur.filter((k) => k !== key);
      if (cur.length >= 3) return cur;
      return [...cur, key];
    });
  };

  const joinFrags = (frags: Frag[]) => {
    let s = "";
    frags.forEach((f, i) => {
      if (i > 0) s += f.gapBefore ? " … " : " ";
      s += f.text;
    });
    return s.replace(/\s+/g, " ").trim();
  };

  const buildPreview = (pairs: CovenantPairData[], dark: boolean) => {
    const canvas = renderCovenantCard({
      pairs,
      conditionColor,
      promiseColor,
      dark,
    });
    previewCanvasRef.current = canvas;
    setPreviewUrl(canvasURL(canvas));
    setCardDark(dark);
  };

  const openPreview = () => {
    const chosen: CovenantPairData[] = [];
    rows.forEach((r, i) => {
      if (picked.includes(rowKey(r, i))) {
        chosen.push({
          reference: r.reference,
          ifText: joinFrags(r.condition),
          ifStyle: r.condition[0] ? r.condition[0].style : "highlight",
          thenText: joinFrags(r.promise),
          thenStyle: r.promise[0] ? r.promise[0].style : "highlight",
        });
      }
    });
    if (chosen.length === 0) return;
    setPendingPairs(chosen);
    setShareMsg("");
    buildPreview(chosen, cardDark);
  };

  const doShare = async () => {
    const canvas = previewCanvasRef.current;
    if (!canvas || sharing) return;
    setSharing(true);
    setShareMsg("Preparing…");
    const res = await shareCanvas(
      canvas,
      "scribal-covenant.png",
      "Covenant ledger · Scribal"
    );
    setSharing(false);
    setShareMsg(
      res === "shared"
        ? "Shared."
        : res === "downloaded"
        ? "Saved to your device."
        : res === "cancelled"
        ? ""
        : "Couldn't share — try again."
    );
  };

  const closePreview = () => {
    setPendingPairs(null);
    setPreviewUrl("");
    previewCanvasRef.current = null;
    setShareMsg("");
  };

  const exitPicking = () => {
    setPicking(false);
    setPicked([]);
    closePreview();
  };

  const shareBtnStyle: CSSProperties = {
    border: "1px solid var(--border)",
    background: "var(--soft)",
    color: "var(--text)",
    fontSize: "12.5px",
    fontWeight: 600,
    padding: "8px 14px",
    borderRadius: "9px",
    cursor: "pointer",
    fontFamily: "inherit",
  };
  const pickBarStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
    padding: "10px 12px",
    background: "var(--soft)",
    borderRadius: "10px",
    marginBottom: "12px",
  };
  const pickGhostBtn: CSSProperties = {
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--muted)",
    fontSize: "12.5px",
    fontWeight: 600,
    padding: "8px 14px",
    borderRadius: "9px",
    cursor: "pointer",
    fontFamily: "inherit",
  };
  const overlaySolidBtn: CSSProperties = {
    border: "none",
    background: "#ffffff",
    color: "#111111",
    fontSize: "13px",
    fontWeight: 700,
    padding: "11px 18px",
    borderRadius: "10px",
    cursor: "pointer",
    fontFamily: "inherit",
  };
  const overlayGhostBtn: CSSProperties = {
    border: "1px solid rgba(255,255,255,0.5)",
    background: "transparent",
    color: "#ffffff",
    fontSize: "13px",
    fontWeight: 600,
    padding: "11px 18px",
    borderRadius: "10px",
    cursor: "pointer",
    fontFamily: "inherit",
  };

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
          marginBottom: "12px",
          lineHeight: 1.55,
        }}
      >
        This format tracks the conditional, covenantal relationships in
        scripture — the <em>If → Then</em> promises. Mark a condition and the
        promise it unlocks, and the pair appears here.
      </p>
      <p
        style={{
          fontSize: "11.5px",
          fontStyle: "italic",
          color: "var(--muted)",
          marginBottom: "20px",
          lineHeight: 1.5,
          opacity: 0.85,
        }}
      >
        It isn't meant for every study — only passages with covenant language
        will have anything to pair, so this view stays empty for the rest.
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
          <div style={{ marginBottom: "8px" }}>No covenants here yet.</div>
          <div style={{ fontSize: "13.5px" }}>
            This format only surfaces conditional, covenantal passages. If this
            study has them, mark a condition {dot(conditionColor)} and its
            promise {dot(promiseColor)} in the same verse and the pair appears
            here — otherwise there may simply be none to track.
          </div>
        </div>
      )}

      {rows.length > 0 && !picking && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: "10px",
          }}
        >
          <button
            onClick={() => {
              setPicking(true);
              setPicked([]);
            }}
            style={shareBtnStyle}
          >
            Share image
          </button>
        </div>
      )}

      {rows.length > 0 && picking && (
        <div style={pickBarStyle}>
          <span
            style={{
              fontSize: "12.5px",
              color: "var(--text)",
              fontWeight: 600,
            }}
          >
            Tap up to 3 pairs to share · {picked.length}/3
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={exitPicking} style={pickGhostBtn}>
              Cancel
            </button>
            <button
              onClick={openPreview}
              disabled={picked.length === 0}
              style={{
                ...shareBtnStyle,
                opacity: picked.length === 0 ? 0.5 : 1,
              }}
            >
              Preview ({picked.length})
            </button>
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
          {rows.map((r, i) => {
            const key = rowKey(r, i);
            const sel = picked.includes(key);
            const idx = picked.indexOf(key);
            return (
              <div
                key={key}
                onClick={picking ? () => togglePick(key) : undefined}
                style={{
                  display: "flex",
                  gap: "12px",
                  alignItems: "stretch",
                  marginBottom: "10px",
                  flexWrap: "wrap",
                  cursor: picking ? "pointer" : "default",
                  borderRadius: "10px",
                  padding: picking ? "6px" : "0",
                  boxShadow: sel ? "0 0 0 2px var(--text)" : "none",
                  background: sel ? "var(--soft)" : "transparent",
                }}
              >
                {card(r.condition, conditionColor)}
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
                {card(r.promise, promiseColor)}
                {picking ? (
                  <div
                    style={{
                      width: "64px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <span
                      style={{
                        width: "26px",
                        height: "26px",
                        borderRadius: "50%",
                        border:
                          "2px solid " +
                          (sel ? "var(--text)" : "var(--border)"),
                        background: sel ? "var(--text)" : "transparent",
                        color: sel ? "var(--panel)" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "13px",
                        fontWeight: 700,
                      }}
                    >
                      {sel ? idx + 1 : ""}
                    </span>
                  </div>
                ) : (
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
                )}
              </div>
            );
          })}
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
                {renderFrags(h.frags)}{" "}
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

      {pendingPairs && (
        <div
          onClick={closePreview}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            background: "rgba(0,0,0,0.78)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "min(94vw, 470px)",
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              alignItems: "center",
            }}
          >
            <div
              style={{
                maxHeight: "70vh",
                overflow: "auto",
                borderRadius: "14px",
                width: "100%",
              }}
            >
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Covenant share card"
                  style={{ width: "100%", display: "block", borderRadius: "14px" }}
                />
              ) : null}
            </div>
            <div
              style={{
                display: "flex",
                gap: "10px",
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <button
                onClick={() => buildPreview(pendingPairs, !cardDark)}
                style={overlayGhostBtn}
              >
                {cardDark ? "Light card" : "Dark card"}
              </button>
              <button
                onClick={doShare}
                disabled={sharing}
                style={{ ...overlaySolidBtn, opacity: sharing ? 0.6 : 1 }}
              >
                {sharing ? "Preparing…" : "Share / Save"}
              </button>
              <button onClick={closePreview} style={overlayGhostBtn}>
                Close
              </button>
            </div>
            {shareMsg ? (
              <div style={{ color: "#ffffff", fontSize: "12.5px", opacity: 0.9 }}>
                {shareMsg}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
