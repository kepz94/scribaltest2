import { useState, useRef, useEffect, CSSProperties } from "react";
import scriptures from "./data/scriptures.json";
import { Mark, MarkColor, MarkStyle, Tool, COLOR_MAP } from "./types";

// The first-run walkthrough. It runs on the REAL reading screen — not a mockup —
// inside its own throwaway "ephemeral" study book (see useMarks). On finish it
// restores the book + chapter you were on and deletes that book whole, so the
// demo's marks never persist, never sync, and never touch anything of yours.

interface Palette {
  bg: string;
  panel: string;
  soft: string;
  text: string;
  muted: string;
  border: string;
}

type Loc = { v: number; b: number; c: number };

interface Props {
  C: Palette;
  onClose: () => void;
  // marks store (from useMarks)
  createSession: (name: string, ephemeral?: boolean) => string;
  deleteBook: (id: string) => void;
  setActiveBook: (id: string) => void;
  addMark: (
    reference: string,
    verseText: string,
    markedText: string,
    startIndex: number,
    endIndex: number,
    style: MarkStyle,
    color: MarkColor
  ) => void;
  seedScopeLabels: (scope: string, labels: Record<number, string>) => void;
  marks: Mark[];
  activeBookId: string;
  // navigation + view (from MobileApp)
  loc: Loc;
  setLoc: (l: Loc) => void;
  setHomeOpen: (v: boolean) => void;
  setCompileOpen: (v: boolean) => void;
  compileOpen: boolean;
  // armed pen (to detect taps that advance the tour)
  pen: { color: MarkColor; tool: Tool };
}

const ACCENT = "#8b5cf6";

// ── Resolve the demo chapter (1 Nephi 1) once, from the same scripture data the
// reading screen indexes, so the {v,b,c} we navigate to lines up exactly.
const DEMO = (() => {
  const vols = (scriptures as any).volumes as any[];
  for (let v = 0; v < vols.length; v++) {
    const books = vols[v].books || [];
    for (let b = 0; b < books.length; b++) {
      const chapters = books[b].chapters || [];
      for (let c = 0; c < chapters.length; c++) {
        const verses = chapters[c].verses || [];
        const first = verses[0];
        if (first && /^1 Nephi 1:/.test(String(first.reference))) {
          return {
            loc: { v, b, c } as Loc,
            scope: "1 Nephi 1",
            verses: verses as { reference: string; verse: number; text: string }[],
          };
        }
      }
    }
  }
  return null;
})();

// A word-bounded character range inside a verse, so a seeded highlight always
// lands on whole words (never mid-word), whatever the verse text happens to be.
function wordRange(
  text: string,
  startWord: number,
  wordCount: number
): { start: number; end: number } | null {
  const words: { start: number; end: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) words.push({ start: m.index, end: m.index + m[0].length });
  if (!words.length) return null;
  const s = Math.min(Math.max(0, startWord), words.length - 1);
  const e = Math.min(s + Math.max(1, wordCount) - 1, words.length - 1);
  return { start: words[s].start, end: words[e].end };
}

// A few pre-marks so Compile has something real to gather. Verse 0 is left
// clean — that's the one the reader marks themselves in the Slide step.
type Seed = { verseIdx: number; startWord: number; wordCount: number; color: MarkColor; style: MarkStyle };
const SEED_FAITH: MarkColor = 2;
const SEED_LORD: MarkColor = 5;
const SEEDS: Seed[] = [
  { verseIdx: 1, startWord: 0, wordCount: 5, color: SEED_FAITH, style: "highlight" },
  { verseIdx: 2, startWord: 2, wordCount: 4, color: SEED_LORD, style: "underline" },
  { verseIdx: 3, startWord: 0, wordCount: 4, color: SEED_FAITH, style: "highlight" },
];

// Step plan. 0 = welcome (centered card). 1–4 spotlight a real element and
// advance when you actually do the thing. 5 = a centered card over Compile.
type StepDef = {
  target: string | null; // data-wt selector, or null for a centered card
  title: string;
  body: string;
};
const STEPS: StepDef[] = [
  { target: null, title: "", body: "" }, // 0 welcome
  {
    target: '[data-wt="wt-colors"]',
    title: "Load a color",
    body: "Colors are your themes. Tap one to arm your pen.",
  },
  {
    target: '[data-wt="wt-styles"]',
    title: "Pick a style",
    body: "Highlight, underline, circle… Tap a style to set how you'll mark.",
  },
  {
    target: '[data-wt="wt-verse"]',
    title: "Mark a verse",
    body: "Slide your finger across the words — don't press and hold, just slide.",
  },
  {
    target: '[data-wt="wt-compile"]',
    title: "Compile",
    body: "Tap Compile to gather every mark into a study, grouped by theme.",
  },
  {
    target: null,
    title: "Make it yours",
    body: "Here's your study. Tap any verse card to flip it over and write what it means to you. Scribal keeps it organized — the meaning stays yours.",
  },
];
const LAST = STEPS.length - 1;

export default function MobileWalkthrough({
  C,
  onClose,
  createSession,
  deleteBook,
  setActiveBook,
  addMark,
  seedScopeLabels,
  marks,
  activeBookId,
  loc,
  setLoc,
  setHomeOpen,
  setCompileOpen,
  compileOpen,
  pen,
}: Props) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // What to restore on exit, captured before we touch anything.
  const prevBook = useRef(activeBookId);
  const prevLoc = useRef(loc);
  const tempId = useRef<string | null>(null);
  const cleaned = useRef(false);

  // Per-step baselines so "did the value change" reads true only on a real tap.
  const baseColor = useRef<MarkColor>(pen.color);
  const baseTool = useRef<Tool>(pen.tool);
  const baseMarks = useRef<number>(0);

  // ── Setup: runs once, hidden behind the welcome card. Create the throwaway
  // book, drop in the demo marks + theme names, and open the demo chapter — so
  // the moment you tap Begin, the real reading screen is already waiting.
  useEffect(() => {
    if (!DEMO) {
      onClose();
      return;
    }
    prevBook.current = activeBookId;
    prevLoc.current = loc;
    setHomeOpen(false);
    setCompileOpen(false);
    const id = createSession("Walkthrough", true);
    tempId.current = id;
    setLoc(DEMO.loc);
    SEEDS.forEach((sd) => {
      const verse = DEMO.verses[sd.verseIdx];
      if (!verse) return;
      const r = wordRange(verse.text, sd.startWord, sd.wordCount);
      if (!r) return;
      addMark(
        verse.reference,
        verse.text,
        verse.text.slice(r.start, r.end),
        r.start,
        r.end,
        sd.style,
        sd.color
      );
    });
    seedScopeLabels(DEMO.scope, { [SEED_FAITH]: "Faith", [SEED_LORD]: "The Lord" });
  }, []);

  // Restore everything and remove the throwaway book. Guarded so it runs once.
  const finish = () => {
    if (cleaned.current) {
      onClose();
      return;
    }
    cleaned.current = true;
    setCompileOpen(false);
    setActiveBook(prevBook.current);
    if (tempId.current) deleteBook(tempId.current);
    setLoc(prevLoc.current);
    onClose();
  };

  // Set each step's baseline the instant the step opens.
  useEffect(() => {
    if (step === 1) baseColor.current = pen.color;
    if (step === 2) baseTool.current = pen.tool;
    if (step === 3) baseMarks.current = marks.length;
  }, [step]);

  // Advance when the reader actually does each step's action.
  useEffect(() => {
    if (step === 1 && pen.color !== baseColor.current) setStep(2);
  }, [pen.color, step]);
  useEffect(() => {
    if (step === 2 && pen.tool !== baseTool.current) setStep(3);
  }, [pen.tool, step]);
  useEffect(() => {
    if (step === 3 && marks.length > baseMarks.current) setStep(4);
  }, [marks.length, step]);
  useEffect(() => {
    if (step === 4 && compileOpen) setStep(5);
  }, [compileOpen, step]);

  // Measure the spotlight target. Re-measures on step change, on scroll (capture,
  // so inner scrolls count), and on resize; a few rAF passes cover mount timing.
  useEffect(() => {
    const sdef = STEPS[step];
    if (!sdef || !sdef.target) {
      setRect(null);
      return;
    }
    let raf = 0;
    let tries = 0;
    const measure = () => {
      const el = document.querySelector(sdef.target as string) as HTMLElement | null;
      if (el) {
        setRect(el.getBoundingClientRect());
        if (tries < 3) {
          tries++;
          raf = requestAnimationFrame(measure);
        }
      } else if (tries < 30) {
        tries++;
        raf = requestAnimationFrame(measure);
      }
    };
    measure();
    const onMove = () => {
      const el = document.querySelector(sdef.target as string) as HTMLElement | null;
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [step]);

  const dim = "rgba(18,16,12,0.66)";
  const Z = 600;

  // ── Welcome (step 0) and the closing card (step 5) are centered panels over a
  // full dim. The reading screen / compile screen sit live underneath.
  const centered = step === 0 || step === LAST;

  const dots = (
    <div style={{ display: "flex", gap: "6px", justifyContent: "center", marginTop: "14px" }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          style={{
            width: n === step ? "18px" : "6px",
            height: "6px",
            borderRadius: "999px",
            backgroundColor: n === step ? ACCENT : C.border,
            transition: "width 0.2s, background-color 0.2s",
          }}
        />
      ))}
    </div>
  );

  if (step === 0) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: Z,
          backgroundColor: C.bg,
          color: C.text,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 26px calc(32px + env(safe-area-inset-bottom))",
          fontFamily: "system-ui, -apple-system, sans-serif",
          textAlign: "center",
          animation: "wt-fade 0.35s ease",
        }}
      >
        <style>{`@keyframes wt-fade{from{opacity:0}to{opacity:1}}
          @keyframes wt-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>

        {/* mark motif — the four marking styles, in theme colors */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "30px", flexWrap: "wrap", justifyContent: "center", fontFamily: '"Times New Roman", Times, serif', fontSize: "17px" }}>
          <span style={{ backgroundColor: COLOR_MAP[2], padding: "1px 4px", borderRadius: "2px" }}>grace</span>
          <span style={{ textDecoration: "underline", textDecorationColor: COLOR_MAP[5], textDecorationThickness: "2px" }}>truth</span>
          <span style={{ fontWeight: 800, color: COLOR_MAP[7] }}>light</span>
          <span style={{ border: "1.5px solid " + COLOR_MAP[4], borderRadius: "999px", padding: "1px 10px" }}>faith</span>
        </div>

        <div style={{ fontSize: "15px", letterSpacing: "0.32em", textTransform: "uppercase", color: C.muted, marginBottom: "18px", fontWeight: 600 }}>
          Scribal
        </div>
        <div style={{ fontSize: "34px", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: "16px" }}>
          Study by hand.
        </div>
        <div style={{ fontSize: "16px", lineHeight: 1.6, color: C.muted, maxWidth: "320px", marginBottom: "8px" }}>
          Scribal keeps your study organized, but never interprets it. The meaning stays yours.
        </div>

        <div style={{ flexShrink: 0, marginTop: "34px", width: "100%", maxWidth: "320px" }}>
          <button
            onClick={() => setStep(1)}
            style={{
              width: "100%",
              padding: "15px",
              border: "none",
              borderRadius: "999px",
              backgroundColor: C.text,
              color: C.bg,
              fontSize: "16px",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Begin
          </button>
          <div style={{ fontSize: "12.5px", color: C.muted, marginTop: "14px" }}>
            A one-minute walkthrough
          </div>
          <button
            onClick={finish}
            style={{
              marginTop: "10px",
              background: "transparent",
              border: "none",
              color: C.muted,
              fontSize: "13.5px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              padding: "6px 10px",
            }}
          >
            Maybe later
          </button>
        </div>
      </div>
    );
  }

  // Caption card content (shared by spotlight steps and the closing card).
  const def = STEPS[step];
  const caption = (
    <div
      style={{
        pointerEvents: "auto",
        backgroundColor: C.panel,
        border: "1px solid " + C.border,
        borderRadius: "16px",
        boxShadow: "0 10px 40px rgba(0,0,0,0.34)",
        padding: "16px 18px",
        maxWidth: "360px",
        margin: "0 auto",
        animation: "wt-rise 0.28s ease",
      }}
    >
      <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: ACCENT, marginBottom: "6px" }}>
        Step {step} of 5
      </div>
      <div style={{ fontSize: "18px", fontWeight: 800, marginBottom: "6px", color: C.text }}>
        {def.title}
      </div>
      <div style={{ fontSize: "14.5px", lineHeight: 1.55, color: C.muted }}>
        {def.body}
      </div>
      {step === LAST && (
        <button
          onClick={finish}
          style={{
            marginTop: "16px",
            width: "100%",
            padding: "13px",
            border: "none",
            borderRadius: "999px",
            backgroundColor: C.text,
            color: C.bg,
            fontSize: "15px",
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Got it
        </button>
      )}
      {dots}
    </div>
  );

  if (centered) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: Z,
          backgroundColor: dim,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          animation: "wt-fade 0.25s ease",
        }}
      >
        <style>{`@keyframes wt-fade{from{opacity:0}to{opacity:1}}
          @keyframes wt-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
        {caption}
      </div>
    );
  }

  // ── Spotlight steps (1–4). Four dim panels frame a clear hole over the target
  // so the real control beneath stays tappable; the caption sits clear of it.
  const pad = 8;
  const vw = typeof window !== "undefined" ? window.innerWidth : 0;
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;
  if (!rect) {
    // Target not measured yet — hold a plain dim so nothing flashes.
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: Z, backgroundColor: dim }} />
    );
  }
  const hTop = Math.max(0, rect.top - pad);
  const hLeft = Math.max(0, rect.left - pad);
  const hRight = Math.min(vw, rect.right + pad);
  const hBottom = Math.min(vh, rect.bottom + pad);
  const hW = Math.max(0, hRight - hLeft);
  const hH = Math.max(0, hBottom - hTop);
  const captionAbove = hTop > vh / 2;

  const panel = (s: CSSProperties): CSSProperties => ({
    position: "fixed",
    backgroundColor: dim,
    pointerEvents: "auto",
    ...s,
  });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: Z, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <style>{`@keyframes wt-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
      {/* four dim panels around the hole */}
      <div style={panel({ top: 0, left: 0, width: vw, height: hTop })} />
      <div style={panel({ top: hTop + hH, left: 0, width: vw, height: Math.max(0, vh - (hTop + hH)) })} />
      <div style={panel({ top: hTop, left: 0, width: hLeft, height: hH })} />
      <div style={panel({ top: hTop, left: hLeft + hW, width: Math.max(0, vw - (hLeft + hW)), height: hH })} />
      {/* ring around the spotlit control (non-blocking) */}
      <div
        style={{
          position: "fixed",
          top: hTop,
          left: hLeft,
          width: hW,
          height: hH,
          borderRadius: "12px",
          boxShadow: "0 0 0 2px " + ACCENT + ", 0 0 0 6px rgba(139,92,246,0.25)",
          pointerEvents: "none",
        }}
      />
      {/* caption, clear of the hole */}
      <div
        style={{
          position: "fixed",
          left: 16,
          right: 16,
          ...(captionAbove
            ? { bottom: Math.max(16, vh - hTop + 12) }
            : { top: Math.min(vh - 160, hTop + hH + 12) }),
          pointerEvents: "none",
        }}
      >
        {caption}
      </div>
    </div>
  );
}
