import { useState, useRef, useEffect, CSSProperties } from "react";
import scriptures from "./data/scriptures.json";
import { Mark, MarkColor, MarkStyle, Tool, COLOR_MAP } from "./types";

// ────────────────────────────────────────────────────────────────────────────
// The first-run walkthrough. It runs on the REAL screens — the reading page and
// the real compile/notes screen — inside its own throwaway "ephemeral" study
// book (see useMarks). The reading half is hands-on and spotlighted: every beat
// waits for the actual action (a word marked, a phrase slid, a pen chosen, a
// word looked up, a mark erased, a study compiled). The notes half is coached,
// not spotlighted: the real compiled study stays fully visible and live while a
// floating card walks you through it — so the tour never rings a scrollable
// board element (which is what made earlier builds jump). On exit it restores
// the book, chapter, and pen you had, deletes the throwaway book whole, and
// reverts any note the tour had you write — so nothing here persists or syncs.
// ────────────────────────────────────────────────────────────────────────────

interface Palette {
  bg: string;
  panel: string;
  soft: string;
  text: string;
  muted: string;
  border: string;
}

type Loc = { v: number; b: number; c: number };
type Pen = { color: MarkColor; tool: Tool };

interface Props {
  C: Palette;
  onClose: () => void;
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
  // The proven label-write path (the same one theme-rename uses); seeds the demo
  // theme names so the compiled study reads "Faith" / "The Lord", not "Color 2".
  setScopedLabel: (scope: string, color: MarkColor, label: string) => void;
  marks: Mark[];
  activeBookId: string;
  loc: Loc;
  setLoc: (l: Loc) => void;
  setHomeOpen: (v: boolean) => void;
  setCompileOpen: (v: boolean) => void;
  compileOpen: boolean;
  pen: Pen;
  setPen: (updater: Pen | ((p: Pen) => Pen)) => void;
  // True while a dictionary definition is on screen (defn != null in MobileApp).
  defineOpen: boolean;
  // The per-verse / per-theme notes store + setter, watched to advance the
  // meaning beat and used to revert anything the tour writes on exit.
  notes: Record<string, string>;
  setNote: (key: string, text: string) => void;
}

const ACCENT = "#8b5cf6";

// A marking style is any tool that actually marks — not the eraser, dictionary,
// or internal pointer. Keeps "make it yours" from being satisfied by arming the
// eraser/dictionary (which share the tool row).
const isMarkStyle = (t: Tool) =>
  t !== "eraser" && t !== "define" && t !== "pointer";

// ── Resolve the demo chapter (1 Nephi 1) once from the same scripture data the
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
            verses: verses as { reference: string; verse: number; text: string }[],
          };
        }
      }
    }
  }
  return null;
})();

// chapterScopeKey(1 Nephi 1) resolves to its first verse's scope, i.e. exactly
// this string — confirmed against the reading screen's own scope logic — so the
// labels we seed here and the keys we revert on exit match what the compile
// reads.
const DEMO_SCOPE = "1 Nephi 1";
// Note keys the tour might create, so they can be reverted on exit.
const VNOTE_PREFIX = "versenote:" + DEMO_SCOPE + ":";
const SYNTH_PREFIX = "synthesis:" + DEMO_SCOPE + ":";
const isDemoNoteKey = (k: string) =>
  k.indexOf(VNOTE_PREFIX) === 0 || k.indexOf(SYNTH_PREFIX) === 0;
// A stable snapshot string of just the demo-scope notes (either kind), so the
// meaning beat advances on any real note and exit can revert precisely.
const pickDemoNotes = (notesObj: Record<string, string>) => {
  const o: Record<string, string> = {};
  Object.keys(notesObj || {}).forEach((k) => {
    if (isDemoNoteKey(k)) o[k] = notesObj[k];
  });
  return JSON.stringify(o);
};

// A word-bounded character range inside a verse, so a seeded mark always lands
// on whole words, whatever the verse text happens to be.
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

// Pre-marks so the compiled study has real content in two themes. Verse 0 is
// left clean — that's the one the reader marks themselves in Mark/Slide.
type Seed = { verseIdx: number; startWord: number; wordCount: number; color: MarkColor; style: MarkStyle };
const SEED_FAITH: MarkColor = 2;
const SEED_LORD: MarkColor = 5;
const SEEDS: Seed[] = [
  { verseIdx: 1, startWord: 0, wordCount: 5, color: SEED_FAITH, style: "highlight" },
  { verseIdx: 2, startWord: 2, wordCount: 4, color: SEED_LORD, style: "underline" },
  { verseIdx: 3, startWord: 0, wordCount: 4, color: SEED_FAITH, style: "highlight" },
];

type Mode = "welcome" | "spotlight" | "free";
type CoachPos = "near" | "top" | "bottom";
type Ghost = "tap" | "swipe";
interface Step {
  id: string;
  mode: Mode;
  target: string | null;
  coachPos: CoachPos;
  title: string;
  body: string;
  cta?: string;
  ghost?: Ghost;
}

// ── The 10 beats (index 0 is the welcome). Reading screen 1–6 are "spotlight"
// (dim + block around one control) or "free" (screen live, just a ring + coach,
// so a tool can be armed AND used). Notes screen 7–10 are "free" with no ring
// on board internals — the real study stays visible and the coach guides it.
const STEPS: Step[] = [
  { id: "welcome", mode: "welcome", target: null, coachPos: "bottom", title: "", body: "" },
  {
    id: "mark",
    mode: "spotlight",
    target: '[data-wt="wt-verse"]',
    coachPos: "near",
    ghost: "tap",
    title: "Mark a word",
    body: "Your pen's already loaded. Tap any word in this verse — it marks in your color.",
  },
  {
    id: "slide",
    mode: "spotlight",
    target: '[data-wt="wt-verse"]',
    coachPos: "near",
    ghost: "swipe",
    title: "Slide to mark a phrase",
    body: "Now drag your finger across several words to mark the whole phrase at once.",
  },
  {
    id: "pen",
    mode: "spotlight",
    target: '[data-wt="wt-tray"]',
    coachPos: "near",
    title: "Make it yours",
    body: "Each color is a theme; each style is a way to mark. Pick a different color, then a different style.",
  },
  {
    id: "dict",
    mode: "free",
    target: '[data-wt="wt-define"]',
    coachPos: "top",
    title: "Look a word up",
    body: "Tap the dictionary to arm it, then tap any word to see its meaning. Close it when you're done.",
  },
  {
    id: "erase",
    mode: "free",
    target: '[data-wt="wt-eraser"]',
    coachPos: "top",
    title: "Erase a mark",
    body: "Tap the eraser to arm it, then tap any mark to remove it.",
  },
  {
    id: "compile",
    mode: "spotlight",
    target: '[data-wt="wt-compile"]',
    coachPos: "near",
    title: "Compile",
    body: "Now gather every mark into a study. Tap Compile.",
  },
  {
    id: "study",
    mode: "free",
    target: null,
    coachPos: "bottom",
    cta: "Next",
    title: "This is your study",
    body: "Every mark you made, gathered into themes — most-marked first. Nothing was interpreted for you; it was only organized.",
  },
  {
    id: "meaning",
    mode: "free",
    target: null,
    coachPos: "bottom",
    title: "Add your meaning",
    body: "At the top of a theme, answer what its verses say together — the one line Scribal will never write for you. (Or tap any verse to flip it and note what it means to you.)",
  },
  {
    id: "distilled",
    mode: "free",
    target: '[data-tour="ex-formats"]',
    coachPos: "bottom",
    title: "See it as prose",
    body: "Tap Distilled — your marked phrases reflow into flowing text. Your words, rearranged, never rewritten.",
  },
  {
    id: "keep",
    mode: "free",
    target: null,
    coachPos: "bottom",
    cta: "Start studying",
    title: "Keep it",
    body: "Save to Studies keeps the whole thing — reopen it anytime. Share builds a card to send. That's the loop: mark by hand, compile, shape and keep. Relational and chapter-linking are waiting when you're ready.",
  },
];
const LAST = STEPS.length - 1; // 10 — the Keep beat
const TEACH = LAST; // numbered beats 1..10
const NOTES_FROM = 7; // beats >= this are on the compile/notes screen

export default function MobileWalkthrough({
  C,
  onClose,
  createSession,
  deleteBook,
  setActiveBook,
  addMark,
  setScopedLabel,
  marks,
  activeBookId,
  loc,
  setLoc,
  setHomeOpen,
  setCompileOpen,
  compileOpen,
  pen,
  setPen,
  defineOpen,
  notes,
  setNote,
}: Props) {
  const [beat, setBeat] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Restore targets, captured before anything is touched.
  const prevBook = useRef(activeBookId);
  const prevLoc = useRef(loc);
  const prevPen = useRef(pen);
  const tempId = useRef<string | null>(null);
  const cleaned = useRef(false);
  const noteSnapshot = useRef<Record<string, string>>({});
  const notesRef = useRef(notes);
  notesRef.current = notes;

  // Per-beat baselines so "did it happen" reads true only on a real action.
  const baseIds = useRef<Set<string>>(new Set());
  const baseColor = useRef<MarkColor>(pen.color);
  const baseTool = useRef<Tool>(pen.tool);
  const baseMarkCount = useRef<number>(marks.length);
  const baseNotes = useRef<string>("");
  const defWasOpen = useRef(false);

  // ── Setup: once, behind the welcome card. Arm a sensible pen, create the
  // throwaway book, drop in demo marks + theme names, open the demo chapter —
  // so the moment you tap Begin the reading screen is already marked and ready.
  useEffect(() => {
    if (!DEMO) {
      onClose();
      return;
    }
    prevBook.current = activeBookId;
    prevLoc.current = loc;
    prevPen.current = pen;
    noteSnapshot.current = {};
    Object.keys(notes || {}).forEach((k) => {
      if (isDemoNoteKey(k)) noteSnapshot.current[k] = notes[k];
    });
    setHomeOpen(false);
    setCompileOpen(false);
    setPen({ color: SEED_FAITH, tool: "highlight" });
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
    setScopedLabel(DEMO_SCOPE, SEED_FAITH, "Faith");
    setScopedLabel(DEMO_SCOPE, SEED_LORD, "The Lord");
    // eslint-disable-next-line
  }, []);

  // Restore everything, delete the throwaway book, and revert any note the tour
  // wrote. Guarded so it runs once.
  const finish = () => {
    if (cleaned.current) {
      onClose();
      return;
    }
    cleaned.current = true;
    // revert demo notes to their pre-tour values (delete ones the tour added)
    const snap = noteSnapshot.current;
    const cur = notesRef.current || {};
    Object.keys(cur).forEach((k) => {
      if (!isDemoNoteKey(k)) return;
      const want = Object.prototype.hasOwnProperty.call(snap, k) ? snap[k] : "";
      if ((cur[k] || "") !== (want || "")) setNote(k, want);
    });
    setCompileOpen(false);
    setActiveBook(prevBook.current);
    if (tempId.current) deleteBook(tempId.current);
    setLoc(prevLoc.current);
    setPen(prevPen.current);
    onClose();
  };

  const advance = () => setBeat((b) => (b < LAST ? b + 1 : b));

  // Set each beat's baseline the instant it opens.
  useEffect(() => {
    const id = STEPS[beat]?.id;
    if (id === "mark" || id === "slide")
      baseIds.current = new Set(marks.map((m) => m.id));
    else if (id === "pen") {
      baseColor.current = pen.color;
      baseTool.current = pen.tool;
    } else if (id === "erase") baseMarkCount.current = marks.length;
    else if (id === "dict") defWasOpen.current = false;
    else if (id === "meaning") baseNotes.current = pickDemoNotes(notes);
    // eslint-disable-next-line
  }, [beat]);

  // Advance on marks: a new mark (mark), a new multi-word mark (slide), or a
  // mark removed (erase).
  useEffect(() => {
    const id = STEPS[beat]?.id;
    if (id === "mark" && marks.some((m) => !baseIds.current.has(m.id))) advance();
    else if (
      id === "slide" &&
      marks.some(
        (m) => !baseIds.current.has(m.id) && m.markedText.trim().includes(" ")
      )
    )
      advance();
    else if (id === "erase" && marks.length < baseMarkCount.current) advance();
  }, [marks, beat]);

  // Advance the pen beat when a new color AND a new marking style are armed.
  useEffect(() => {
    if (
      STEPS[beat]?.id === "pen" &&
      pen.color !== baseColor.current &&
      pen.tool !== baseTool.current &&
      isMarkStyle(pen.tool)
    )
      advance();
  }, [pen, beat]);

  // Dictionary: advance once a definition has been shown AND dismissed.
  useEffect(() => {
    if (STEPS[beat]?.id !== "dict") return;
    if (defineOpen) defWasOpen.current = true;
    else if (defWasOpen.current) advance();
  }, [defineOpen, beat]);

  // Compile opening (compile beat); the notes screen closing wraps up the tour.
  useEffect(() => {
    const id = STEPS[beat]?.id;
    if (id === "compile" && compileOpen) advance();
    else if (beat >= NOTES_FROM && !compileOpen) finish();
    // eslint-disable-next-line
  }, [compileOpen, beat]);

  // Meaning beat: advance when any demo-scope note (a theme conclusion OR a
  // verse note) is written.
  useEffect(() => {
    if (
      STEPS[beat]?.id === "meaning" &&
      pickDemoNotes(notes) !== baseNotes.current
    )
      advance();
  }, [notes, beat]);

  // The one notes-screen switch we can't read through props — the format tabs —
  // caught by watching the actual tap on the Distilled control inside the
  // compile's stable, compile-only [data-tour="ex-formats"] selector.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      const btn = el && el.closest ? el.closest("button") : null;
      if (!btn) return;
      const txt = (btn.textContent || "").trim();
      if (
        STEPS[beat]?.id === "distilled" &&
        txt === "Distilled" &&
        btn.closest('[data-tour="ex-formats"]')
      )
        advance();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [beat]);

  // Measure the spotlight / ring target. Re-measures on beat change, on scroll
  // (capture, so inner scrolls count) and resize; rAF passes cover mount timing.
  useEffect(() => {
    const sel = STEPS[beat]?.target;
    if (!sel) {
      setRect(null);
      return;
    }
    let raf = 0;
    let tries = 0;
    const measure = () => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) {
        setRect(el.getBoundingClientRect());
        if (tries < 3) {
          tries++;
          raf = requestAnimationFrame(measure);
        }
      } else if (tries < 40) {
        tries++;
        raf = requestAnimationFrame(measure);
      }
    };
    measure();
    const onMove = () => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [beat]);

  const Z = 600;
  const dim = "rgba(18,16,12,0.64)";
  const vw = typeof window !== "undefined" ? window.innerWidth : 0;
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;
  const step = STEPS[beat];

  // ── Welcome ────────────────────────────────────────────────────────────────
  if (step.id === "welcome") {
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
          @keyframes wt-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
          @keyframes wt-tap{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(.78)}}
          @keyframes wt-swipe{0%{opacity:0;transform:translateX(0) scale(.8)}15%{opacity:1}55%{opacity:1;transform:translateX(96px) scale(.9)}85%{opacity:1}100%{opacity:0;transform:translateX(116px) scale(.8)}}`}</style>
        <div style={{ display: "flex", gap: "10px", marginBottom: "30px", flexWrap: "wrap", justifyContent: "center", fontFamily: '"Times New Roman", Times, serif', fontSize: "17px" }}>
          <span style={{ backgroundColor: COLOR_MAP[2], padding: "1px 4px", borderRadius: "2px" }}>grace</span>
          <span style={{ textDecoration: "underline", textDecorationColor: COLOR_MAP[5], textDecorationThickness: "2px" }}>truth</span>
          <span style={{ fontWeight: 800, color: COLOR_MAP[7] }}>light</span>
          <span style={{ border: "1.5px solid " + COLOR_MAP[4], borderRadius: "999px", padding: "1px 10px" }}>faith</span>
        </div>
        <div style={{ fontSize: "15px", letterSpacing: "0.32em", textTransform: "uppercase", color: C.muted, marginBottom: "18px", fontWeight: 600 }}>Scribal</div>
        <div style={{ fontSize: "34px", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: "16px" }}>Study by hand.</div>
        <div style={{ fontSize: "16px", lineHeight: 1.6, color: C.muted, maxWidth: "320px" }}>
          Scribal keeps your study organized, but never interprets it. The meaning stays yours.
        </div>
        <div style={{ flexShrink: 0, marginTop: "34px", width: "100%", maxWidth: "320px" }}>
          <button
            onClick={() => setBeat(1)}
            style={{ width: "100%", padding: "15px", border: "none", borderRadius: "999px", backgroundColor: C.text, color: C.bg, fontSize: "16px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            Begin
          </button>
          <div style={{ fontSize: "12.5px", color: C.muted, marginTop: "14px" }}>A two-minute walkthrough</div>
          <button
            onClick={finish}
            style={{ marginTop: "10px", background: "transparent", border: "none", color: C.muted, fontSize: "13.5px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", padding: "6px 10px" }}
          >
            Maybe later
          </button>
        </div>
      </div>
    );
  }

  // ── Coach card (shared) ──────────────────────────────────────────────────────
  const dots = (
    <div style={{ display: "flex", gap: "4px", justifyContent: "center", marginTop: "12px", flexWrap: "wrap" }}>
      {Array.from({ length: TEACH }, (_, i) => i + 1).map((n) => (
        <span
          key={n}
          style={{
            width: n === beat ? "15px" : "6px",
            height: "6px",
            borderRadius: "999px",
            backgroundColor: n === beat ? ACCENT : C.border,
            transition: "width 0.2s, background-color 0.2s",
          }}
        />
      ))}
    </div>
  );
  const coachInner = (
    <div
      style={{
        pointerEvents: "auto",
        backgroundColor: C.panel,
        border: "1px solid " + C.border,
        borderRadius: "16px",
        boxShadow: "0 12px 40px rgba(0,0,0,0.34)",
        padding: "15px 17px",
        maxWidth: "380px",
        margin: "0 auto",
        animation: "wt-rise 0.26s ease",
      }}
    >
      <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: ACCENT, marginBottom: "5px" }}>
        Step {beat} of {TEACH}
      </div>
      <div style={{ fontSize: "17.5px", fontWeight: 800, marginBottom: "5px", color: C.text }}>{step.title}</div>
      <div style={{ fontSize: "14.5px", lineHeight: 1.5, color: C.muted }}>{step.body}</div>
      {step.cta && (
        <button
          onClick={step.id === "keep" ? finish : advance}
          style={{ marginTop: "13px", width: "100%", padding: "12px", border: "none", borderRadius: "999px", backgroundColor: C.text, color: C.bg, fontSize: "14.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
        >
          {step.cta}
        </button>
      )}
      <button
        onClick={finish}
        style={{ display: "block", margin: "9px auto 0", background: "transparent", border: "none", color: C.muted, fontSize: "12.5px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
      >
        Skip the tour
      </button>
      {dots}
    </div>
  );

  const baseFont: CSSProperties = { fontFamily: "system-ui, -apple-system, sans-serif" };
  const styleTag = (
    <style>{`@keyframes wt-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
      @keyframes wt-tap{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(.78)}}
      @keyframes wt-swipe{0%{opacity:0;transform:translateX(0) scale(.8)}15%{opacity:1}55%{opacity:1;transform:translateX(96px) scale(.9)}85%{opacity:1}100%{opacity:0;transform:translateX(116px) scale(.8)}}`}</style>
  );

  // coach wrapper positioned per the beat
  const coachWrap = (pos: CoachPos, r: DOMRect | null) => {
    const s: CSSProperties = { position: "fixed", left: 16, right: 16, zIndex: Z + 2, pointerEvents: "none" };
    if (pos === "top") {
      s.top = "calc(14px + env(safe-area-inset-top))";
    } else if (pos === "bottom") {
      s.bottom = "calc(18px + env(safe-area-inset-bottom))";
    } else {
      // near the target: above if it sits low, below if high
      if (r && r.top > vh / 2) s.bottom = Math.max(16, vh - r.top + 12);
      else if (r) s.top = Math.min(vh - 170, r.bottom + 12);
      else s.bottom = "calc(18px + env(safe-area-inset-bottom))";
    }
    return <div style={s}>{coachInner}</div>;
  };

  // ring around a measured target (used by spotlight + free)
  const ring = (r: DOMRect) => (
    <div
      style={{
        position: "fixed",
        top: Math.max(0, r.top - 6),
        left: Math.max(0, r.left - 6),
        width: r.width + 12,
        height: r.height + 12,
        borderRadius: "12px",
        boxShadow: "0 0 0 2px " + ACCENT + ", 0 0 0 6px rgba(139,92,246,0.25)",
        pointerEvents: "none",
      }}
    />
  );
  const ghostEl = (r: DOMRect, kind: Ghost) => (
    <div
      style={{
        position: "fixed",
        left: r.left + 6,
        top: r.top + 4,
        width: "32px",
        height: "32px",
        borderRadius: "50%",
        background: "rgba(139,92,246,0.35)",
        border: "2px solid " + ACCENT,
        pointerEvents: "none",
        animation: (kind === "swipe" ? "wt-swipe" : "wt-tap") + " 1.5s ease-in-out infinite",
      }}
    />
  );

  // ── "free" beats — the screen stays live (so a tool can be armed AND used on
  // the reading side, and the real study stays interactive on the notes side);
  // just a ring (if we have a clean target) + the coach. No dim.
  if (step.mode === "free") {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: Z, pointerEvents: "none", ...baseFont }}>
        {styleTag}
        {rect && ring(rect)}
        {coachWrap(step.coachPos, rect)}
      </div>
    );
  }

  // ── "spotlight" beats — dim panels that BLOCK around a clear, tappable hole,
  // so the one control beneath is the only thing in play. Root passes clicks so
  // the hole works; the four panels block everything else.
  if (!rect) {
    return <div style={{ position: "fixed", inset: 0, zIndex: Z, backgroundColor: dim }} />;
  }
  const pad = 8;
  const hTop = Math.max(0, rect.top - pad);
  const hLeft = Math.max(0, rect.left - pad);
  const hRight = Math.min(vw, rect.right + pad);
  const hBottom = Math.min(vh, rect.bottom + pad);
  const hW = Math.max(0, hRight - hLeft);
  const hH = Math.max(0, hBottom - hTop);
  const panel = (s: CSSProperties): CSSProperties => ({
    position: "fixed",
    backgroundColor: dim,
    pointerEvents: "auto",
    ...s,
  });
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: Z, pointerEvents: "none", ...baseFont }}>
      {styleTag}
      <div style={panel({ top: 0, left: 0, width: vw, height: hTop })} />
      <div style={panel({ top: hTop + hH, left: 0, width: vw, height: Math.max(0, vh - (hTop + hH)) })} />
      <div style={panel({ top: hTop, left: 0, width: hLeft, height: hH })} />
      <div style={panel({ top: hTop, left: hLeft + hW, width: Math.max(0, vw - (hLeft + hW)), height: hH })} />
      {ring(rect)}
      {step.ghost && ghostEl(rect, step.ghost)}
      {coachWrap(step.coachPos, rect)}
    </div>
  );
}
