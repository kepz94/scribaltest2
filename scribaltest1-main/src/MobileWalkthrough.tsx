import React, { useState, useRef, useEffect, useLayoutEffect } from "react";

// Self-contained first-load walkthrough. Renders its own demo reading screen
// (already marked up) and runs a guided, interactive tour of the core loop:
// load a color, pick a style, SLIDE to mark, compile, flip a card, find notes.
// It drives a sandbox — never the real store — so it can't touch real studies.

type Tool =
  | "highlight"
  | "underline"
  | "bold"
  | "italic"
  | "circle"
  | "box"
  | "dashed"
  | "squiggly"
  | "eraser"
  | "define";

interface Theme {
  bg: string;
  panel: string;
  soft: string;
  text: string;
  muted: string;
  border: string;
}

const ACCENT = "#8b5cf6";
const RED = "#ef4444";
const COLOR_MAP: Record<number, string> = {
  1: "#eab308",
  2: "#2563eb",
  3: "#dc2626",
  4: "#16a34a",
  5: "#9333ea",
  6: "#ea580c",
};
const HL_MAP: Record<number, string> = {
  1: "#ffe58a",
  2: "#bfdbfe",
  3: "#fecaca",
  4: "#bbf7d0",
  5: "#e9d5ff",
  6: "#fed7aa",
};
const COLORS = [1, 2, 3, 4, 5, 6];
const STYLE_SET: Tool[] = [
  "highlight",
  "underline",
  "bold",
  "italic",
  "circle",
  "box",
  "dashed",
  "squiggly",
  "eraser",
  "define",
];
// The phrase the user marks themselves (v5, second clause). "understanding"
// carries a descender so the underline visibly draws through it.
const UW = ["lean", "not", "unto", "thine", "own", "understanding"];

// ---- fixed mark styles for the pre-marked demo verses ----
const hl = (c: string): React.CSSProperties => ({
  background: c,
  borderRadius: "3px",
});
const ul = (c: string): React.CSSProperties => {
  const o: any = {
    textDecoration: "underline",
    textDecorationColor: c,
    textDecorationThickness: "2.5px",
    textUnderlineOffset: "3px",
  };
  o.textDecorationSkipInk = "none";
  return o;
};
const bold = (c: string): React.CSSProperties => ({ fontWeight: 700, color: c });
const circ = (c: string): React.CSSProperties => ({
  border: "2px solid " + c,
  borderRadius: "40%",
  padding: "1px 7px",
});
const squig = (c: string): React.CSSProperties => {
  const o: any = {
    textDecoration: "underline wavy",
    textDecorationColor: c,
    textDecorationThickness: "1.5px",
    textUnderlineOffset: "3px",
  };
  return o;
};

// toolbar style-glyph preview, mirrors toolGlyph in MobileApp
function glyph(tool: Tool): React.ReactNode {
  const box: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
  if (tool === "highlight")
    return (
      <span style={{ background: "#ffe58a", borderRadius: "2px", padding: "0 2px" }}>
        A
      </span>
    );
  if (tool === "underline")
    return (
      <span
        style={{
          textDecoration: "underline",
          textDecorationThickness: "2px",
          textUnderlineOffset: "2px",
        }}
      >
        A
      </span>
    );
  if (tool === "bold") return <b>A</b>;
  if (tool === "italic") return <i>A</i>;
  if (tool === "circle")
    return (
      <span
        style={{
          ...box,
          border: "1.4px solid currentColor",
          borderRadius: "50%",
          width: "17px",
          height: "17px",
          fontSize: "11px",
        }}
      >
        A
      </span>
    );
  if (tool === "box")
    return (
      <span
        style={{
          ...box,
          border: "1.4px solid currentColor",
          borderRadius: "3px",
          width: "17px",
          height: "15px",
          fontSize: "11px",
        }}
      >
        A
      </span>
    );
  if (tool === "dashed")
    return (
      <span style={{ borderBottom: "2px dashed currentColor", lineHeight: 1 }}>A</span>
    );
  if (tool === "squiggly")
    return (
      <span
        style={{
          textDecoration: "underline wavy",
          textDecorationThickness: "1px",
          textUnderlineOffset: "2px",
        }}
      >
        A
      </span>
    );
  if (tool === "eraser")
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
        <path d="M22 21H7" />
        <path d="m5 11 9 9" />
      </svg>
    );
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

interface Step {
  center?: boolean;
  sel?: string; // [data-wt] target
  spotSel?: string; // union target (the uw words)
  title: string;
  adv?: "tap" | "slide";
  advKey?: "color" | "style" | "compile" | "flip";
  cta?: string;
  view?: "compile";
  slide?: boolean;
}

const STEPS: Step[] = [
  { center: true, title: "Let's add a mark together", cta: "Start" },
  { sel: '[data-wt="colors"]', title: "1 · Load a color", adv: "tap", advKey: "color" },
  {
    sel: '[data-wt="style-underline"]',
    title: "2 · Pick a style",
    adv: "tap",
    advKey: "style",
  },
  {
    sel: '[data-wt="read-body"]',
    spotSel: "[data-uw]",
    title: "3 · Slide to mark",
    adv: "slide",
    slide: true,
  },
  { sel: '[data-wt="compile"]', title: "4 · Compile", adv: "tap", advKey: "compile" },
  {
    sel: '[data-wt="card1"]',
    title: "5 · Flip a card",
    adv: "tap",
    advKey: "flip",
    view: "compile",
  },
  { sel: '[data-wt="notes1"]', title: "6 · Your notes live here", cta: "Done", view: "compile" },
];

export default function MobileWalkthrough({
  C,
  onClose,
}: {
  C: Theme;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [pen, setPen] = useState<{ color: number; tool: Tool }>({
    color: 1,
    tool: "highlight",
  });
  const [view, setView] = useState<"read" | "compile">("read");
  const [flipped, setFlipped] = useState(false);
  const [finished, setFinished] = useState(false);

  const [demoIdx, setDemoIdx] = useState(-1); // demo fill progress
  const [demoDone, setDemoDone] = useState(false);
  const [preview, setPreview] = useState<{ a: number; b: number } | null>(null);
  const [committed, setCommitted] = useState(false);

  const [spot, setSpot] = useState({ top: 0, left: 0, w: 0, h: 0, show: false });
  const [tip, setTip] = useState({ top: 0, left: 0, below: true, centered: true });
  const [ghost, setGhost] = useState({ left: 0, top: 0, show: false });

  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ on: boolean; start: number }>({ on: false, start: 0 });
  const demoTimer = useRef<number | null>(null);

  const s = STEPS[step];
  const armed = COLOR_MAP[pen.color];

  const advance = () => {
    if (step >= STEPS.length - 1) {
      setFinished(true);
      return;
    }
    const nx = STEPS[step + 1];
    if (nx.view === "compile") setView("compile");
    setStep(step + 1);
  };

  // ---- measure spotlight + tooltip anchor on every relevant change ----
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (s.center) {
      setSpot((p) => ({ ...p, show: false }));
      setTip({ top: 0, left: 0, below: true, centered: true });
      return;
    }
    const rr = root.getBoundingClientRect();
    let top = 0,
      left = 0,
      w = 0,
      h = 0;
    if (s.spotSel) {
      const els = root.querySelectorAll(s.spotSel);
      if (!els.length) return;
      let t = 1e9,
        l = 1e9,
        b = -1e9,
        r = -1e9;
      els.forEach((e) => {
        const x = (e as HTMLElement).getBoundingClientRect();
        t = Math.min(t, x.top);
        l = Math.min(l, x.left);
        b = Math.max(b, x.bottom);
        r = Math.max(r, x.right);
      });
      top = t - rr.top;
      left = l - rr.left;
      w = r - l;
      h = b - t;
    } else if (s.sel) {
      const el = root.querySelector(s.sel) as HTMLElement | null;
      if (!el) return;
      const x = el.getBoundingClientRect();
      top = x.top - rr.top;
      left = x.left - rr.left;
      w = x.width;
      h = x.height;
    }
    setSpot({ top, left, w, h, show: true });
    const below = top < rr.height * 0.45;
    const tipW = 312;
    const tl = Math.max(12, Math.min(left + w / 2 - tipW / 2, rr.width - tipW - 12));
    setTip({
      top: below ? top + h + 14 : top - 14,
      left: tl,
      below,
      centered: false,
    });
  }, [step, view, flipped, demoDone, preview, committed]);

  // ---- slide step: scroll the phrase into view, then run the demo ----
  useEffect(() => {
    if (!s.slide) return;
    setDemoDone(false);
    setCommitted(false);
    setPreview(null);
    setDemoIdx(-1);
    const body = bodyRef.current;
    if (body) {
      const first = body.querySelector('[data-uw="0"]') as HTMLElement | null;
      if (first)
        body.scrollTop = Math.max(0, first.offsetTop - body.clientHeight * 0.45);
    }
    const start = window.setTimeout(runDemo, 550);
    return () => {
      window.clearTimeout(start);
      if (demoTimer.current) window.clearInterval(demoTimer.current);
    };
  }, [step]);

  function runDemo() {
    const root = rootRef.current;
    if (!root) return;
    const rr = root.getBoundingClientRect();
    let k = 0;
    setGhost((g) => ({ ...g, show: true }));
    demoTimer.current = window.setInterval(() => {
      if (k < UW.length) {
        setDemoIdx(k);
        const w = root.querySelector('[data-uw="' + k + '"]') as HTMLElement | null;
        if (w) {
          const x = w.getBoundingClientRect();
          setGhost({
            left: x.left - rr.left + x.width * 0.5 - 8,
            top: x.top - rr.top + 6,
            show: true,
          });
        }
        k++;
      } else {
        if (demoTimer.current) window.clearInterval(demoTimer.current);
        window.setTimeout(() => {
          setDemoIdx(-1);
          setGhost((g) => ({ ...g, show: false }));
          setDemoDone(true);
        }, 700);
      }
    }, 150);
  }

  // ---- slide drag ----
  const onDown = (e: React.PointerEvent) => {
    if (!s.slide || !demoDone || committed) return;
    const w = (e.target as HTMLElement).closest("[data-uw]") as HTMLElement | null;
    if (!w) return;
    const i = Number(w.getAttribute("data-uw"));
    dragRef.current = { on: true, start: i };
    setPreview({ a: i, b: i });
    e.preventDefault();
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragRef.current.on) return;
    const t = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const w = t && t.closest ? (t.closest("[data-uw]") as HTMLElement | null) : null;
    if (w) {
      const i = Number(w.getAttribute("data-uw"));
      setPreview({ a: dragRef.current.start, b: i });
    }
  };
  const onUp = () => {
    if (!dragRef.current.on) return;
    dragRef.current.on = false;
    const covered =
      preview &&
      Math.min(preview.a, preview.b) <= 0 &&
      Math.max(preview.a, preview.b) >= UW.length - 1;
    if (covered) {
      setCommitted(true);
      setPreview(null);
      window.setTimeout(advance, 350);
    } else {
      setPreview(null);
    }
  };

  // per-word style during the slide step
  const uwStyle = (i: number): React.CSSProperties => {
    const inPrev =
      preview && i >= Math.min(preview.a, preview.b) && i <= Math.max(preview.a, preview.b);
    const inDemo = demoIdx >= 0 && i <= demoIdx;
    if (committed || inPrev) {
      const o: any = {
        textDecoration: "underline",
        textDecorationColor: armed,
        textDecorationThickness: "2.5px",
        textUnderlineOffset: "3px",
      };
      o.textDecorationSkipInk = "none";
      if (inPrev && !committed) {
        o.background = armed + "24";
        o.borderRadius = "2px";
      }
      return o;
    }
    if (inDemo) {
      const o: any = {
        textDecoration: "underline",
        textDecorationColor: armed,
        textDecorationThickness: "2.5px",
        textUnderlineOffset: "3px",
        opacity: 0.55,
      };
      o.textDecorationSkipInk = "none";
      return o;
    }
    return {};
  };

  const tapColor = (c: number) => {
    if (s.advKey !== "color") return;
    setPen((p) => ({ ...p, color: c }));
    window.setTimeout(advance, 240);
  };
  const tapStyle = (t: Tool) => {
    if (s.advKey === "style") {
      if (t !== "underline") return;
      setPen((p) => ({ ...p, tool: t }));
      window.setTimeout(advance, 240);
    }
  };
  const tapCompile = () => {
    if (s.advKey !== "compile") return;
    window.setTimeout(advance, 200);
  };
  const tapCard = () => {
    if (s.advKey !== "flip") return;
    setFlipped(true);
    window.setTimeout(advance, 320);
  };

  // ---- tooltip body (varies for the slide step before/after the demo) ----
  const tipBody = (): React.ReactNode => {
    if (step === 0)
      return (
        <p style={pP}>
          This is a practice page — already marked up, so you can see what a studied
          chapter looks like. Add one mark of your own and we'll turn the page into
          notes.
        </p>
      );
    if (s.advKey === "color")
      return (
        <p style={pP}>
          Your pen carries a color. Tap a color to load it — we'll use blue. (Each color
          becomes a theme you name later: Faith, Promises…)
        </p>
      );
    if (s.advKey === "style")
      return (
        <p style={pP}>
          Now choose how the mark looks. Tap <b>Underline</b>. Watch the color bars
          switch from highlighter tints to solid ink.
        </p>
      );
    if (s.slide)
      return demoDone ? (
        <p style={pP}>
          Your turn — <b>slide across the lit phrase</b> (drag from “lean” to
          “understanding”).
        </p>
      ) : (
        <>
          <p style={pP}>Here's the one gesture that's different from every other app:</p>
          <div
            style={{
              background: "#efe9fb",
              borderRadius: "10px",
              padding: "9px 11px",
              fontSize: "12.5px",
              color: "#4c3f7a",
              lineHeight: 1.45,
              marginBottom: "12px",
            }}
          >
            Don't press-and-hold to select.{" "}
            <b style={{ color: "#3a2f63" }}>Slide your finger across the words</b> — like
            a highlighter. Watch, then try it on the lit phrase.
          </div>
        </>
      );
    if (s.advKey === "compile")
      return (
        <p style={pP}>
          Your mark is in. Compile gathers every mark on the page — the demo ones and
          yours — into study notes.
        </p>
      );
    if (s.advKey === "flip")
      return (
        <p style={pP}>
          Each mark becomes a card. The front is the verse — tap to flip it over.
        </p>
      );
    return (
      <p style={pP}>
        The back of every card is your space. Write what the verse means to you — it saves
        with the study.
      </p>
    );
  };

  const pP: React.CSSProperties = {
    margin: "0 0 12px",
    fontSize: "13px",
    lineHeight: 1.5,
    color: C.muted,
  };

  const cbar = (c: number): React.CSSProperties => ({
    flex: 1,
    height: "30px",
    borderRadius: "8px",
    cursor: "pointer",
    background: pen.tool === "highlight" ? HL_MAP[c] : COLOR_MAP[c],
    border: pen.color === c ? "2px solid " + C.text : "1px solid " + C.border,
    padding: 0,
  });
  const sbtn = (t: Tool): React.CSSProperties => {
    const on = pen.tool === t;
    return {
      flex: 1,
      minWidth: 0,
      height: "30px",
      borderRadius: "8px",
      border: "1px solid " + (on ? C.text : C.border),
      background: on ? C.text : "transparent",
      color: on ? C.bg : C.text,
      fontSize: "13px",
      fontWeight: 700,
      cursor: "pointer",
      fontFamily: "inherit",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    };
  };

  return (
    <div
      ref={rootRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: C.bg,
        color: C.text,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      }}
    >
      {view === "read" ? (
        <>
          <div
            style={{
              padding: "calc(12px + env(safe-area-inset-top)) 16px 6px",
              borderBottom: "1px solid " + C.border,
            }}
          >
            <div
              style={{
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: RED,
                display: "flex",
                alignItems: "center",
                gap: "5px",
                marginBottom: "3px",
              }}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.4}
              >
                <path d="M3 11.5 12 4l9 7.5" />
                <path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />
              </svg>
              Chapter study
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ flex: 1, fontSize: "17px", fontWeight: 700 }}>Proverbs 3</div>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  color: ACCENT,
                  background: "#efe9fb",
                  borderRadius: "999px",
                  padding: "3px 9px",
                }}
              >
                Practice
              </span>
              <button
                data-wt="compile"
                onClick={tapCompile}
                style={{
                  background: C.text,
                  color: C.bg,
                  border: "none",
                  borderRadius: "999px",
                  padding: "8px 16px",
                  fontSize: "12.5px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  flexShrink: 0,
                }}
              >
                Compile
              </button>
            </div>
          </div>

          <div
            ref={bodyRef}
            data-wt="read-body"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "16px 20px 230px",
              fontFamily: "Times New Roman, Times, serif",
              fontSize: "19.5px",
              lineHeight: 1.95,
            }}
          >
            <Verse n={1}>
              My son, forget not my law; but let thine heart{" "}
              <span style={hl("#ffe58a")}>keep my commandments</span>:
            </Verse>
            <Verse n={2}>
              For length of days, and long life, and peace, shall they add to thee.
            </Verse>
            <Verse n={3}>
              Let not <span style={bold("#dc2626")}>mercy and truth</span> forsake thee:
              bind them about thy neck; write them upon{" "}
              <span style={ul("#2563eb")}>the table of thine heart</span>:
            </Verse>
            <Verse n={4}>
              So shalt thou find{" "}
              <span style={hl("#bbf7d0")}>favour and good understanding</span> in the
              sight of God and man.
            </Verse>
            <Verse n={5}>
              <span style={hl("#ffe58a")}>Trust in the Lord</span> with all thine heart;
              and{" "}
              {UW.map((w, i) => (
                <React.Fragment key={i}>
                  <span data-uw={i} style={uwStyle(i)}>
                    {w}
                  </span>
                  {i < UW.length - 1 ? " " : ""}
                </React.Fragment>
              ))}
              .
            </Verse>
            <Verse n={6}>
              In all thy ways <span style={bold("#dc2626")}>acknowledge him</span>, and he
              shall direct thy paths.
            </Verse>
            <Verse n={7}>
              Be not wise in thine own eyes:{" "}
              <span style={circ("#9333ea")}>fear the Lord</span>, and depart from evil.
            </Verse>
            <Verse n={8}>
              It shall be health to thy navel, and{" "}
              <span style={squig("#ea580c")}>marrow to thy bones</span>.
            </Verse>
          </div>

          {/* real toolbar */}
          <div
            style={{
              padding: "0 14px calc(14px + env(safe-area-inset-bottom))",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                pointerEvents: "auto",
                background: C.panel,
                border: "1px solid " + C.border,
                borderRadius: "16px",
                boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
                overflow: "hidden",
              }}
            >
              <div
                data-wt="colors"
                style={{ padding: "12px 14px 0", display: "flex", gap: "7px" }}
              >
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => tapColor(c)}
                    aria-label={"Color " + c}
                    style={cbar(c)}
                  />
                ))}
              </div>
              <div style={{ padding: "8px 14px 0", display: "flex", gap: "6px" }}>
                {STYLE_SET.map((t) => (
                  <button
                    key={t}
                    data-wt={"style-" + t}
                    onClick={() => tapStyle(t)}
                    aria-label={t}
                    title={t}
                    style={sbtn(t)}
                  >
                    {glyph(t)}
                  </button>
                ))}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  width: "100%",
                  padding: "10px 14px",
                  color: C.text,
                }}
              >
                <span
                  style={{
                    flex: 1,
                    textAlign: "left",
                    fontSize: "12px",
                    color: C.muted,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  Name this theme
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    color: C.muted,
                    background: C.soft,
                    borderRadius: "999px",
                    padding: "4px 10px",
                  }}
                >
                  Proverbs
                </span>
                <span style={{ color: C.muted, fontSize: "13px" }}>▴</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              padding: "calc(12px + env(safe-area-inset-top)) 16px 10px",
              borderBottom: "1px solid " + C.border,
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <button
              onClick={() => setView("read")}
              style={{
                border: "1px solid " + C.border,
                background: C.bg,
                borderRadius: "999px",
                padding: "7px 14px",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              ‹ Back
            </button>
            <div style={{ fontSize: "17px", fontWeight: 800 }}>Proverbs 3 · notes</div>
          </div>
          <div style={{ display: "flex", gap: "6px", padding: "10px 14px 2px" }}>
            {["Outline", "Distilled", "Relational"].map((t, k) => (
              <span
                key={t}
                style={{
                  padding: "6px 12px",
                  borderRadius: "999px",
                  fontSize: "12.5px",
                  fontWeight: 700,
                  border: "1px solid " + (k === 0 ? C.text : C.border),
                  background: k === 0 ? C.text : "transparent",
                  color: k === 0 ? C.bg : C.muted,
                }}
              >
                {t}
              </span>
            ))}
          </div>
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "14px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <Card
              C={C}
              dataWt="card1"
              flipped={flipped}
              onTap={tapCard}
              notesWt="notes1"
              front={
                <>
                  …and{" "}
                  <span style={ul("#2563eb")}>lean not unto thine own understanding</span>.
                </>
              }
            />
            <Card
              C={C}
              flipped={false}
              onTap={() => {}}
              front={<span style={hl("#ffe58a")}>keep my commandments</span>}
            />
            <Card
              C={C}
              flipped={false}
              onTap={() => {}}
              front={
                <>
                  <span style={bold("#dc2626")}>mercy and truth</span> ·{" "}
                  <span style={ul("#2563eb")}>the table of thine heart</span>
                </>
              }
            />
          </div>
        </>
      )}

      {/* tour overlay */}
      {!finished && (
        <>
          {s.center ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(28,24,18,0.6)",
                pointerEvents: "none",
                zIndex: 50,
              }}
            />
          ) : (
            spot.show && (
              <div
                style={{
                  position: "absolute",
                  top: spot.top - 8,
                  left: spot.left - 8,
                  width: spot.w + 16,
                  height: spot.h + 16,
                  borderRadius: "12px",
                  boxShadow:
                    "0 0 0 9999px rgba(28,24,18,0.6), 0 0 0 3px " +
                    (s.adv === "slide" ? "rgba(139,92,246,0.55)" : "rgba(139,92,246,0.4)"),
                  pointerEvents: "none",
                  transition: "all .35s cubic-bezier(.4,.1,.2,1)",
                  zIndex: 50,
                }}
              />
            )
          )}

          <div
            style={{
              position: "absolute",
              zIndex: 52,
              maxWidth: "312px",
              width: "calc(100% - 24px)",
              background: C.panel,
              borderRadius: "16px",
              padding: "15px 16px",
              boxShadow: "0 12px 36px rgba(0,0,0,0.3)",
              border: "1px solid " + C.border,
              ...(tip.centered
                ? {
                    left: "50%",
                    top: "40%",
                    transform: "translate(-50%,-50%)",
                  }
                : {
                    left: tip.left,
                    top: tip.top,
                    transform: tip.below ? "none" : "translateY(-100%)",
                  }),
            }}
          >
            <h4 style={{ margin: "0 0 6px", fontSize: "15px" }}>{s.title}</h4>
            {tipBody()}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
              }}
            >
              <div style={{ display: "flex", gap: "5px" }}>
                {STEPS.map((_, k) => (
                  <span
                    key={k}
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: k === step ? ACCENT : C.border,
                    }}
                  />
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {step < STEPS.length - 1 && (
                  <button
                    onClick={onClose}
                    style={{
                      background: "none",
                      border: "none",
                      color: C.muted,
                      fontSize: "12px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Skip
                  </button>
                )}
                {!s.adv && (
                  <button
                    onClick={advance}
                    style={{
                      background: ACCENT,
                      color: "#fff",
                      border: "none",
                      borderRadius: "999px",
                      padding: "8px 16px",
                      fontSize: "13px",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {s.cta || "Next"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {ghost.show && (
        <div
          style={{
            position: "absolute",
            left: ghost.left,
            top: ghost.top,
            zIndex: 53,
            fontSize: "26px",
            pointerEvents: "none",
            filter: "drop-shadow(0 2px 3px rgba(0,0,0,.3))",
            transition: "left .12s linear, top .12s linear",
          }}
        >
          👆
        </div>
      )}

      {finished && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 60,
            background: "rgba(28,24,18,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            style={{
              background: C.panel,
              borderRadius: "20px",
              padding: "24px",
              textAlign: "center",
              maxWidth: "300px",
            }}
          >
            <h3 style={{ margin: "0 0 8px", fontSize: "19px" }}>
              That's the whole loop 🎉
            </h3>
            <p
              style={{
                margin: "0 0 16px",
                fontSize: "13.5px",
                color: C.muted,
                lineHeight: 1.55,
              }}
            >
              Read, slide to mark, compile, reflect. You've done every step — your real
              chapters work exactly the same.
            </p>
            <button
              onClick={onClose}
              style={{
                background: ACCENT,
                color: "#fff",
                border: "none",
                borderRadius: "999px",
                padding: "10px 20px",
                fontSize: "14px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Start studying
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Verse({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "13px" }}>
      <span
        style={{
          fontFamily: "system-ui, sans-serif",
          fontSize: "0.6em",
          fontWeight: 700,
          color: "#9a9082",
          marginRight: "8px",
          verticalAlign: "top",
        }}
      >
        {n}
      </span>
      {children}
    </div>
  );
}

function Card({
  C,
  front,
  flipped,
  onTap,
  dataWt,
  notesWt,
}: {
  C: Theme;
  front: React.ReactNode;
  flipped: boolean;
  onTap: () => void;
  dataWt?: string;
  notesWt?: string;
}) {
  const face: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    backfaceVisibility: "hidden",
    borderRadius: "14px",
    border: "1px solid " + C.border,
    padding: "13px 14px",
    background: C.panel,
    display: "flex",
    flexDirection: "column",
  };
  return (
    <div
      data-wt={dataWt}
      onClick={onTap}
      style={{ perspective: "1200px", height: "138px", cursor: "pointer", flexShrink: 0 }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          transition: "transform .55s cubic-bezier(.4,.1,.2,1)",
          transformStyle: "preserve-3d",
          transform: flipped ? "rotateY(180deg)" : "none",
        }}
      >
        <div style={face}>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: C.muted,
              fontFamily: "system-ui, sans-serif",
              marginBottom: "5px",
            }}
          >
            Proverbs 3
          </div>
          <div
            style={{
              fontFamily: "Times New Roman, Times, serif",
              fontSize: "15.5px",
              lineHeight: 1.55,
              flex: 1,
              overflow: "hidden",
            }}
          >
            {front}
          </div>
          <div
            style={{
              fontSize: "11px",
              color: C.muted,
              fontFamily: "system-ui, sans-serif",
              marginTop: "5px",
            }}
          >
            ↻ Tap to flip for notes
          </div>
        </div>
        <div style={{ ...face, background: "#fffdf6", transform: "rotateY(180deg)" }}>
          <div
            style={{
              fontSize: "10px",
              fontWeight: 700,
              color: ACCENT,
              fontFamily: "system-ui, sans-serif",
              marginBottom: "5px",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Your notes
          </div>
          <div
            data-wt={notesWt}
            style={{
              flex: 1,
              border: "1px dashed " + C.border,
              borderRadius: "10px",
              padding: "9px",
              fontSize: "14px",
              fontFamily: "Times New Roman, serif",
              color: C.muted,
              background: "#fff",
              lineHeight: 1.5,
            }}
          >
            Write what this verse means to you…
          </div>
        </div>
      </div>
    </div>
  );
}
