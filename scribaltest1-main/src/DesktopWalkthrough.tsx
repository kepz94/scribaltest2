import { useState, useRef, useEffect, CSSProperties } from "react";
import { getScriptures, volumesProxy } from "./data/scripturesStore";
import { Mark, MarkColor, MarkStyle, Tool, COLOR_MAP } from "./types";

// ────────────────────────────────────────────────────────────────────────────
// The desktop first-run walkthrough — a faithful port of the mobile engine.
//
// Same thesis: nobody understands Scribal until they've watched their OWN
// marking become notes. So every beat waits for the real action — mark a word,
// drag a phrase, start a second color, compile, NAME the theme Scribal left
// unnamed — detected against live app state, inside a throwaway ephemeral book
// that is deleted on exit (book, notes, pen, tabs all restored).
// ────────────────────────────────────────────────────────────────────────────

type Pen = { color: MarkColor; tool: Tool };

interface Props {
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
  setScopedLabel: (scope: string, color: MarkColor, label: string) => void;
  resolveScope: (cs: string) => string;
  scopedLabels: Record<string, Record<number, string>>;
  marks: Mark[];
  activeBookId: string;
  // Navigation: open the demo chapter (jumpToReference under the hood) and the
  // tab machinery so any tab the tour opens can be closed on exit.
  openDemoChapter: () => void;
  tabIds: string[];
  activeTabId: string;
  setActiveTab: (id: string) => void;
  closeTab: (id: string) => void;
  // Compile state (desktop: mode === "compile").
  compileOpen: boolean;
  setCompileOpen: (v: boolean) => void;
  pen: Pen;
  setPen: (p: Pen) => void;
  notes: Record<string, string>;
  setNote: (key: string, text: string) => void;
}

const ACCENT = "#8b5cf6";

const DEMO = (() => {
  const vols = getScriptures().volumes as any[];
  for (let v = 0; v < vols.length; v++) {
    const books = vols[v].books || [];
    for (let b = 0; b < books.length; b++) {
      const chapters = books[b].chapters || [];
      for (let c = 0; c < chapters.length; c++) {
        const verses = chapters[c].verses || [];
        const first = verses[0];
        if (first && /^1 Nephi 1:/.test(String(first.reference))) {
          return {
            verses: verses as {
              reference: string;
              verse: number;
              text: string;
            }[],
          };
        }
      }
    }
  }
  return null;
})();

const DEMO_SCOPE = "1 Nephi 1";

function wordRange(
  text: string,
  startWord: number,
  wordCount: number
): { start: number; end: number } | null {
  const words: { start: number; end: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)))
    words.push({ start: m.index, end: m.index + m[0].length });
  if (!words.length) return null;
  const s = Math.min(Math.max(0, startWord), words.length - 1);
  const e = Math.min(s + Math.max(1, wordCount) - 1, words.length - 1);
  return { start: words[s].start, end: words[e].end };
}

type Seed = {
  verseIdx: number;
  startWord: number;
  wordCount: number;
  color: MarkColor;
  style: MarkStyle;
};
const FAITH: MarkColor = 2;
const LORD: MarkColor = 5;
const SEEDS: Seed[] = [
  { verseIdx: 1, startWord: 0, wordCount: 5, color: FAITH, style: "highlight" },
  { verseIdx: 2, startWord: 2, wordCount: 4, color: LORD, style: "underline" },
];

type Mode = "welcome" | "spotlight" | "free";
type CoachPos = "near" | "top" | "bottom";
interface Step {
  id: string;
  mode: Mode;
  target: string | null;
  coachPos: CoachPos;
  title: string;
  body: string;
  cta?: string;
}

const STEPS: Step[] = [
  { id: "welcome", mode: "welcome", target: null, coachPos: "bottom", title: "", body: "" },
  {
    id: "mark",
    mode: "spotlight",
    target: "[data-verse-ref]",
    coachPos: "near",
    title: "Your cursor is the pen",
    body: "Click any word in the lit verse — it marks instantly in your color. No selection menus, no right-clicks.",
  },
  {
    id: "phrase",
    mode: "spotlight",
    target: "[data-verse-ref]",
    coachPos: "near",
    title: "Drag to mark a phrase",
    body: "Press down and drag straight across a few words in one sweep. That drag is how all marking works in Scribal.",
  },
  {
    id: "theme",
    mode: "free",
    target: '[data-tour="toolbar"]',
    coachPos: "top",
    title: "Each color is a theme",
    body: "A color is a thread you're tracking through the text. Pick a DIFFERENT color on the toolbar and mark another word — that begins a second theme.",
  },
  {
    id: "compile",
    mode: "spotlight",
    target: '[data-tour="compile"]',
    coachPos: "near",
    title: "Now watch marking become notes",
    body: "Click Compile. This is the whole point of the app — everything you just marked is about to organize itself.",
  },
  {
    id: "study",
    mode: "free",
    target: null,
    coachPos: "bottom",
    cta: "Next",
    title: "Your study — grouped by your colors",
    body: "Every mark, sorted under its theme. One group is already named — Faith. But look at the other one: it has no name yet. It's waiting, and that's on purpose.",
  },
  {
    id: "name",
    mode: "free",
    target: '[data-wt="wt-themename"]',
    coachPos: "bottom",
    title: "Name what you see",
    body: 'See the ringed line that says "Name this theme…"? Click it and call the theme what YOU see in its verses — "The Lord", "Warnings", anything. Scribal will never name a theme for you, and named themes are what turn marks into real notes.',
  },
  {
    id: "meaning",
    mode: "free",
    target: null,
    coachPos: "bottom",
    cta: "Next",
    title: "Your name just became structure",
    body: "The heading is yours now. Two more places belong to your pen: each theme's synthesis line — where you write what its verses mean together — and every verse's note, right beneath it. Structure comes from your colors; meaning comes from your keyboard.",
  },
  {
    id: "system",
    mode: "free",
    target: null,
    coachPos: "bottom",
    cta: "Next",
    title: "The same loop scales",
    body: "Everything else in Scribal feeds this one loop you just ran:",
  },
  {
    id: "done",
    mode: "free",
    target: null,
    coachPos: "bottom",
    cta: "Start studying",
    title: "That's the whole rhythm",
    body: 'Mark by dragging. Name what you see. Compile. Write the meaning. When you\'re ready for links, keyword search, and Screens, open "How Scribal works" in the More menu — every power feature, shown on the real screens.',
  },
];

const LAST = STEPS.length - 1;
const TEACH = LAST;
const NOTES_FROM = 5;

export default function DesktopWalkthrough({
  onClose,
  createSession,
  deleteBook,
  setActiveBook,
  addMark,
  setScopedLabel,
  resolveScope,
  scopedLabels,
  marks,
  activeBookId,
  openDemoChapter,
  tabIds,
  activeTabId,
  setActiveTab,
  closeTab,
  compileOpen,
  setCompileOpen,
  pen,
  setPen,
  notes,
  setNote,
}: Props) {
  const [beat, setBeat] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const demoScopeKey = resolveScope(DEMO_SCOPE);
  const vnotePrefix = "versenote:" + DEMO_SCOPE + ":";
  const synthPrefix = "synthesis:" + demoScopeKey + ":";
  const isDemoNoteKey = (k: string) =>
    k.indexOf(vnotePrefix) === 0 || k.indexOf(synthPrefix) === 0;

  const prevBook = useRef(activeBookId);
  const prevTab = useRef(activeTabId);
  const prevTabs = useRef<string[]>(tabIds);
  const prevPen = useRef(pen);
  const tempId = useRef<string | null>(null);
  const cleaned = useRef(false);
  const noteSnapshot = useRef<Record<string, string>>({});
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const baseIds = useRef<Set<string>>(new Set());
  const baseLabels = useRef<Record<number, string>>({});

  // Setup once, behind the welcome card.
  useEffect(() => {
    if (!DEMO) {
      onClose();
      return;
    }
    prevBook.current = activeBookId;
    prevTab.current = activeTabId;
    prevTabs.current = [...tabIds];
    prevPen.current = pen;
    noteSnapshot.current = {};
    Object.keys(notes || {}).forEach((k) => {
      if (isDemoNoteKey(k)) noteSnapshot.current[k] = notes[k];
    });
    setCompileOpen(false);
    setPen({ color: FAITH, tool: "highlight" });
    // Phase 1: create + activate the throwaway book. Opening the demo chapter
    // must WAIT until the activation has actually landed — desktop tabs carry
    // a bookId, and jumpToReference reads the live active book, so calling it
    // in this same tick would open the tab against the PREVIOUS book.
    tempId.current = createSession("Walkthrough", true);
    // eslint-disable-next-line
  }, []);

  // Phase 2: the demo book is active — now open its chapter tab and seed it.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    if (!DEMO || !tempId.current || activeBookId !== tempId.current) return;
    seeded.current = true;
    openDemoChapter();
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
    setScopedLabel(demoScopeKey, FAITH, "Faith");
    // eslint-disable-next-line
  }, [activeBookId]);

  const finish = () => {
    if (cleaned.current) {
      onClose();
      return;
    }
    cleaned.current = true;
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
    // Close any tab the tour opened, then return to where the user was.
    tabIds
      .filter((x) => !prevTabs.current.includes(x))
      .forEach((x) => closeTab(x));
    if (prevTabs.current.includes(prevTab.current))
      setActiveTab(prevTab.current);
    setPen(prevPen.current);
    onClose();
  };

  const advance = () => setBeat((b) => (b < LAST ? b + 1 : b));

  useEffect(() => {
    const id = STEPS[beat]?.id;
    if (id === "mark" || id === "phrase" || id === "theme")
      baseIds.current = new Set(marks.map((m) => m.id));
    if (id === "name")
      baseLabels.current = { ...(scopedLabels[demoScopeKey] || {}) };
    // eslint-disable-next-line
  }, [beat]);

  useEffect(() => {
    if (STEPS[beat]?.id !== "name") return;
    const cur = scopedLabels[demoScopeKey] || {};
    const grew = Object.keys(cur).some((k) => {
      const v = (cur[Number(k)] || "").trim();
      const was = (baseLabels.current[Number(k)] || "").trim();
      return v !== "" && v !== was;
    });
    if (grew) advance();
    // eslint-disable-next-line
  }, [scopedLabels, beat]);

  useEffect(() => {
    const id = STEPS[beat]?.id;
    const fresh = marks.filter((m) => !baseIds.current.has(m.id));
    if (id === "mark" && fresh.length) advance();
    else if (
      id === "phrase" &&
      fresh.some((m) => m.markedText.trim().includes(" "))
    )
      advance();
    else if (id === "theme" && fresh.some((m) => m.color !== FAITH)) advance();
  }, [marks, beat]);

  useEffect(() => {
    const id = STEPS[beat]?.id;
    if (id === "compile" && compileOpen) advance();
    else if (beat >= NOTES_FROM && !compileOpen) finish();
    // eslint-disable-next-line
  }, [compileOpen, beat]);

  // Target measurement: ring the element, scroll it into view if hidden, and
  // bow out while the user is typing in it (focus).
  useEffect(() => {
    const sel = STEPS[beat]?.target;
    setRect(null);
    if (!sel) return;
    let raf = 0;
    let tries = 0;
    let scrolled = false;
    const measure = () => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) {
        if (!scrolled) {
          scrolled = true;
          const r0 = el.getBoundingClientRect();
          if (r0.top < 70 || r0.bottom > window.innerHeight - 190) {
            try {
              el.scrollIntoView({ block: "center", behavior: "smooth" });
            } catch {
              el.scrollIntoView();
            }
          }
        }
        setRect(el.getBoundingClientRect());
        if (tries < 12) {
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
      if (el && document.activeElement === el) setRect(null);
      else if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    document.addEventListener("focusin", onMove);
    document.addEventListener("focusout", onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      document.removeEventListener("focusin", onMove);
      document.removeEventListener("focusout", onMove);
    };
  }, [beat]);

  const Z = 600;
  const step = STEPS[beat];
  const baseFont: CSSProperties = {
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "var(--text)",
  };

  const dots = (
    <div style={{ display: "flex", gap: "5px", marginBottom: "10px" }}>
      {Array.from({ length: TEACH }, (_, i) => i + 1).map((n) => (
        <span
          key={n}
          style={{
            width: n === beat ? "16px" : "6px",
            height: "6px",
            borderRadius: "3px",
            background: n <= beat ? ACCENT : "var(--border)",
            transition: "width .2s ease",
          }}
        />
      ))}
    </div>
  );

  const btn = (label: string, onClick: () => void, primary?: boolean) => (
    <button
      onClick={onClick}
      style={{
        border: primary ? "none" : "1px solid var(--border)",
        borderRadius: "999px",
        background: primary ? ACCENT : "transparent",
        color: primary ? "#fff" : "var(--muted)",
        fontSize: "13px",
        fontWeight: 700,
        padding: "9px 18px",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );

  // ── Welcome card ──────────────────────────────────────────────────────────
  if (step.mode === "welcome") {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: Z,
          background: "rgba(0,0,0,0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
        }}
      >
        <div
          style={{
            ...baseFont,
            width: "100%",
            maxWidth: "440px",
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: "18px",
            padding: "26px 28px",
            boxShadow: "0 30px 80px -20px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: ACCENT, marginBottom: "8px" }}>
            Welcome to Scribal
          </div>
          <div style={{ fontSize: "21px", fontWeight: 800, lineHeight: 1.3, marginBottom: "8px" }}>
            Learn it by doing it — 90 seconds.
          </div>
          <div style={{ fontSize: "14px", lineHeight: 1.6, color: "var(--muted)", marginBottom: "20px" }}>
            Scribal doesn't take notes for you — it turns YOUR marking into
            notes. This walkthrough has you run the whole loop once, on the real
            screens, in a throwaway study book. Nothing touches your own books.
          </div>
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            {btn("Skip", finish)}
            {btn("Begin", advance, true)}
          </div>
        </div>
      </div>
    );
  }

  // ── Spotlight hole (scrim with a cut-out) + pulsing ring ─────────────────
  const hole =
    step.mode === "spotlight" && rect ? (
      <>
        <div
          style={{
            position: "fixed",
            zIndex: Z,
            top: rect.top - 8,
            left: rect.left - 8,
            width: rect.width + 16,
            height: rect.height + 16,
            borderRadius: "14px",
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "fixed",
            zIndex: Z + 1,
            top: rect.top - 8,
            left: rect.left - 8,
            width: rect.width + 16,
            height: rect.height + 16,
            borderRadius: "14px",
            border: "2.5px solid " + ACCENT,
            pointerEvents: "none",
            animation: "dwt-pulse 1.6s ease-in-out infinite",
          }}
        />
      </>
    ) : rect ? (
      <div
        style={{
          position: "fixed",
          zIndex: Z + 1,
          top: rect.top - 6,
          left: rect.left - 6,
          width: rect.width + 12,
          height: rect.height + 12,
          borderRadius: "12px",
          border: "2.5px solid " + ACCENT,
          pointerEvents: "none",
          animation: "dwt-pulse 1.6s ease-in-out infinite",
        }}
      />
    ) : null;

  // Coach placement: near the ring when possible, else pinned top/bottom.
  const coachStyle: CSSProperties = (() => {
    const base: CSSProperties = {
      position: "fixed",
      zIndex: Z + 2,
      width: "min(400px, calc(100vw - 32px))",
      background: "var(--panel)",
      border: "1px solid var(--border)",
      borderRadius: "16px",
      boxShadow: "0 18px 50px -14px rgba(0,0,0,0.45)",
      padding: "16px 18px",
      ...baseFont,
    };
    if (step.coachPos === "near" && rect) {
      const below = rect.bottom + 14;
      const fitsBelow = below + 210 < window.innerHeight;
      return {
        ...base,
        top: fitsBelow ? below : undefined,
        bottom: fitsBelow ? undefined : window.innerHeight - rect.top + 14,
        left: Math.min(Math.max(16, rect.left), window.innerWidth - 416),
      };
    }
    if (step.coachPos === "top")
      return { ...base, top: "18px", left: "50%", transform: "translateX(-50%)" };
    return { ...base, bottom: "22px", left: "50%", transform: "translateX(-50%)" };
  })();

  return (
    <>
      <style>{`
        @keyframes dwt-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(139,92,246,0.45); }
          50% { box-shadow: 0 0 0 9px rgba(139,92,246,0); }
        }
      `}</style>
      {hole}
      <div style={coachStyle}>
        {dots}
        <div style={{ fontSize: "15.5px", fontWeight: 800, marginBottom: "4px" }}>
          {step.title}
        </div>
        <div style={{ fontSize: "13.5px", lineHeight: 1.55, color: "var(--muted)" }}>
          {step.body}
        </div>
        {step.id === "system" && (
          <div style={{ marginTop: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap", marginBottom: "10px" }}>
              {["Mark", "Themes", "Study", "Lesson"].map((n, i) => (
                <span key={n} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  {i > 0 && <span style={{ color: "var(--muted)", fontSize: "12px" }}>→</span>}
                  <span style={{ fontSize: "12px", fontWeight: 700, border: "1px solid var(--border)", borderRadius: "999px", padding: "3px 10px" }}>
                    {n}
                  </span>
                </span>
              ))}
            </div>
            {[
              ["Link chapters", "a story spanning chapters compiles as ONE study"],
              ["Keyword search", "gather a word's verses from anywhere into a study"],
              ["Study tables", "arrange verses into a lesson, then present it"],
            ].map(([t, d]) => (
              <div key={t} style={{ display: "flex", gap: "7px", marginBottom: "5px" }}>
                <span style={{ color: ACCENT, fontSize: "12.5px", lineHeight: 1.45 }}>•</span>
                <span style={{ fontSize: "12.5px", lineHeight: 1.45, color: "var(--muted)" }}>
                  <b style={{ color: "var(--text)" }}>{t}</b> — {d}
                </span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "13px" }}>
          {!step.cta && (
            <span style={{ fontSize: "11.5px", color: "var(--muted)", fontStyle: "italic", flex: 1, minWidth: 0 }}>
              Waiting for you — do it for real…
            </span>
          )}
          {step.cta && <span style={{ flex: 1 }} />}
          {btn("Skip", finish)}
          {step.cta &&
            btn(step.cta, step.id === "done" ? finish : advance, true)}
        </div>
      </div>
    </>
  );
}
