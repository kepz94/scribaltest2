import { useState, useRef, useEffect, CSSProperties } from "react";
import { getScriptures, volumesProxy } from "./data/scripturesStore";
import { Mark, MarkColor, MarkStyle, Tool, COLOR_MAP } from "./types";

// ────────────────────────────────────────────────────────────────────────────
// The first-run walkthrough — the smallest tour that teaches what Scribal IS.
//
// Scribal's whole idea is one loop: you MARK scripture by hand → Scribal
// ORGANIZES your marks into the themes (colors) you chose → you write what it
// MEANS. The system arranges; it never interprets. So this tour teaches exactly
// that loop and nothing else — mark a word, mark a phrase, see that a color is a
// theme, compile into a study, and write the one line Scribal won't write for
// you. The dictionary, eraser, sharing, view toggles, Distilled — all real, all
// left for the user to discover, because none of them is the point on day one.
//
// It runs on the REAL screens inside a throwaway "ephemeral" study book, so
// every action is the genuine app. Reading beats are spotlighted and wait for
// the real action; notes beats are coached (no rings on the scrollable study).
// On exit it restores the book/chapter/pen you had, deletes the throwaway book,
// and reverts any note the tour wrote. Theme names + the conclusion note are
// keyed off resolveScope so they render correctly and can never leak into a
// real linked group (see MobileApp's tour-aware resolveScope/studyScopes).
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
  // The proven label-write path; with resolveScope it seeds the demo theme names
  // under the exact key the compile reads, so they render as Faith / The Lord.
  setScopedLabel: (scope: string, color: MarkColor, label: string) => void;
  // Maps a chapter to the key the compile uses (identity when standalone). The
  // tour is standalone (MobileApp forces it during mtour), so this is identity —
  // but keying off it keeps names rendering and the conclusion note leak-proof.
  resolveScope: (cs: string) => string;
  // Live scoped theme labels of the active (demo) book — watched so the NAME
  // beat advances the moment the user actually names their theme.
  scopedLabels: Record<string, Record<number, string>>;
  // Live app state the power journey watches (every beat is a real action):
  linkOpen: boolean;
  searchOpen: boolean;
  chapterGroups: Record<string, string>;
  searchStudyIds: string[];
  tabIds: string[];
  demoCombined: boolean;
  // Cleanup hooks so the journey leaves no trace:
  unlinkChapter: (cs: string) => void;
  deleteSearchStudy: (id: string) => void;
  closeTab: (id: string) => void;
  marks: Mark[];
  activeBookId: string;
  loc: Loc;
  setLoc: (l: Loc) => void;
  setHomeOpen: (v: boolean) => void;
  setCompileOpen: (v: boolean) => void;
  compileOpen: boolean;
  pen: Pen;
  setPen: (updater: Pen | ((p: Pen) => Pen)) => void;
  // The notes store + setter, watched to advance the meaning beat and used to
  // revert anything the tour writes on exit.
  notes: Record<string, string>;
  setNote: (key: string, text: string) => void;
}

const ACCENT = "#8b5cf6";

// ── Resolve the demo chapter (1 Nephi 1) once from the same scripture data the
// reading screen indexes, so the {v,b,c} we navigate to lines up exactly.
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
            loc: { v, b, c } as Loc,
            verses: verses as { reference: string; verse: number; text: string }[],
          };
        }
      }
    }
  }
  return null;
})();

const DEMO_SCOPE = "1 Nephi 1";

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

// Two pre-marks in two themes, so the moment the reader compiles there's already
// a real, named, two-theme study to land in — with their own marks added on top.
// The reader's own verse (index 0) is left clean for the Mark/Phrase beats.
type Seed = { verseIdx: number; startWord: number; wordCount: number; color: MarkColor; style: MarkStyle };
const FAITH: MarkColor = 2;
const LORD: MarkColor = 5;
const SEEDS: Seed[] = [
  { verseIdx: 1, startWord: 0, wordCount: 5, color: FAITH, style: "highlight" },
  { verseIdx: 2, startWord: 2, wordCount: 4, color: LORD, style: "underline" },
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

// ── 7 beats + welcome. Mark → Phrase → Colors-are-themes → Compile → the study
// → the meaning → done. The first three are spotlighted on the reading screen;
// the last three are coached over the real study.
const STEPS: Step[] = [
  { id: "welcome", mode: "welcome", target: null, coachPos: "bottom", title: "", body: "" },
  {
    id: "mark",
    mode: "spotlight",
    target: '[data-wt="wt-verse"]',
    coachPos: "near",
    ghost: "tap",
    title: "Your finger is the pen",
    body: "Tap any word in the lit verse — it marks instantly in your color. No press-and-hold, no menus.",
  },
  {
    id: "phrase",
    mode: "spotlight",
    target: '[data-wt="wt-verse"]',
    coachPos: "near",
    ghost: "swipe",
    title: "Swipe to mark a phrase",
    body: "Drag straight across a few words in one sweep. That swipe is how all marking works in Scribal.",
  },
  {
    id: "theme",
    mode: "free",
    target: '[data-wt="wt-tray"]',
    coachPos: "top",
    title: "Each color is a theme",
    body: "A color is a thread you're tracking through the text. Pick a DIFFERENT color from the tray and mark another word — that begins a second theme.",
  },
  {
    id: "compile",
    mode: "spotlight",
    target: '[data-wt="wt-compile"]',
    coachPos: "near",
    title: "Now watch marking become notes",
    body: "Tap Compile. This is the whole point of the app — everything you just marked is about to organize itself.",
  },
  {
    id: "study",
    mode: "free",
    target: null,
    coachPos: "bottom",
    cta: "Next",
    title: "Your study — grouped by your colors",
    body: "Every mark, sorted under its theme. One group is already named — Faith. But scroll down: the other group has no name yet. It's waiting, and that's on purpose.",
  },
  {
    id: "name",
    mode: "free",
    target: '[data-wt="wt-themename"]',
    coachPos: "bottom",
    title: "Name what you see",
    body: "See the ringed line that says \"Name this theme…\"? Tap it and call the theme what YOU see in its verses — \"The Lord\", \"Warnings\", anything. Scribal will never name a theme for you, and named themes are what turn marks into real notes.",
  },
  {
    id: "meaning",
    mode: "free",
    target: '[aria-label^="Add a thought"]',
    coachPos: "bottom",
    cta: "Next",
    title: "Your name just became structure",
    body: "See it? The heading is yours now. Two more places belong to your pen: the dotted + atop each theme — the line for what its verses mean together — and every verse card FLIPS — tap one and write that verse's own note on its back.",
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
    body: "Mark by swiping. Name what you see. Compile. Write the meaning. When you're ready for links, keyword search, and Screens, open \"How Scribal works\" in the menu — every power feature, shown on the real screens.",
  },
];
// ── The power journey: links, colors, jump, keyword, combined, Screens.
// Rings the REAL controls; the Link beat waits for the real sheet.
const JSTEPS: Step[] = [
  {
    id: "j-colors",
    mode: "free",
    target: '[data-wt="wt-link"]',
    coachPos: "bottom",
    cta: "Next",
    title: "The link glyph speaks in color",
    body: "See the ringed chain in the header? Its color tells you what a chapter is part of at a glance:",
  },
  {
    id: "j-link",
    mode: "spotlight",
    target: '[data-wt="wt-link"]',
    coachPos: "near",
    title: "Open the Link sheet",
    body: "Tap Link.",
  },
  {
    id: "j-pick",
    mode: "free",
    target: null,
    coachPos: "top",
    title: "Link a chapter to this one",
    body: "Pick 1 Nephi 2 from the sheet. Linked chapters compile as ONE study — themes carry across.",
  },
  {
    id: "j-jump",
    mode: "free",
    target: '[data-wt="wt-link"]',
    coachPos: "top",
    title: "Now jump through the link",
    body: "It's linked — the title wears the group's colored dot now. Open Link again: every member chapter is listed there. Tap 1 Nephi 2 to JUMP straight to it.",
  },
  {
    id: "j-mark2",
    mode: "free",
    target: null,
    coachPos: "bottom",
    title: "Mark something HERE",
    body: "You're in the second chapter of the same study. Swipe a phrase that stands out — any color.",
  },
  {
    id: "j-compile2",
    mode: "spotlight",
    target: '[data-wt="wt-compile"]',
    coachPos: "near",
    title: "Compile the linked pair",
    body: "Tap Compile — and watch what linking bought you.",
  },
  {
    id: "j-payoff",
    mode: "free",
    target: null,
    coachPos: "bottom",
    cta: "Next",
    title: "One study. Two chapters.",
    body: "Look at the references under your themes: 1 Nephi 1 AND 1 Nephi 2, together. That's what a link is — chapters studied as one. Close the study (back arrow) to continue.",
  },
  {
    id: "j-keyword",
    mode: "free",
    target: '[data-wt="wt-search"]',
    coachPos: "bottom",
    title: "Build a study from a WORD",
    body: "Tap the ringed magnifier and search a word — try \"faith\". Add a few of the verses it finds, then Save as a study. No chapter required. It waits here until you've saved one.",
  },
  {
    id: "j-combined",
    mode: "free",
    target: '[data-wt="wt-link"]',
    coachPos: "top",
    title: "Merge red with blue",
    body: "Your keyword study is the BLUE kind. Open Link on this chapter and link your new keyword study into it — chapter verses + gathered verses become one COMBINED study, and the chain turns PURPLE.",
  },
  {
    id: "j-screens",
    mode: "free",
    target: null,
    coachPos: "top",
    title: "One more: open a second Screen",
    body: "The tab row above the title holds your Screens — each keeps its own book, chapter, and scroll. Tap the + there to open a fresh one (up to 8).",
  },
  {
    id: "j-done",
    mode: "free",
    target: null,
    coachPos: "bottom",
    cta: "Start studying",
    title: "You just used the full toolkit",
    body: "Linked chapters into one study, jumped through the link, compiled across both, gathered a word into a blue study, merged it purple, and opened a Screen. Red = chapter · blue = keyword · purple = both. Everything cleans up now — your real books are untouched.",
  },
];

const LAST = STEPS.length - 1; // the Done beat
const TEACH = LAST; // numbered beats 1..LAST
const NOTES_FROM = 5; // beats >= this are on the compile/notes screen

export default function MobileWalkthrough({
  C,
  onClose,
  createSession,
  deleteBook,
  setActiveBook,
  addMark,
  setScopedLabel,
  resolveScope,
  scopedLabels,
  linkOpen,
  searchOpen,
  chapterGroups,
  searchStudyIds,
  tabIds,
  demoCombined,
  unlinkChapter,
  deleteSearchStudy,
  closeTab,
  marks,
  activeBookId,
  loc,
  setLoc,
  setHomeOpen,
  setCompileOpen,
  compileOpen,
  pen,
  setPen,
  notes,
  setNote,
}: Props) {
  const [beat, setBeat] = useState(0);
  // The interactive power journey is retired (its overlay choreography fought
  // the real sheets); links/keyword/Screens live in the "How Scribal works"
  // slides off the main menu. `journey` stays as a dormant constant so the
  // engine compiles unchanged.
  const journey = false;
  const [rect, setRect] = useState<DOMRect | null>(null);

  // The scope key the compile uses for this chapter (identity while the tour
  // holds it standalone). Theme names + the conclusion note both key off it.
  const demoScopeKey = resolveScope(DEMO_SCOPE);
  const vnotePrefix = "versenote:" + DEMO_SCOPE + ":"; // verse notes are ref-keyed
  const synthPrefix = "synthesis:" + demoScopeKey + ":"; // conclusions are scope-keyed
  const isDemoNoteKey = (k: string) =>
    k.indexOf(vnotePrefix) === 0 || k.indexOf(synthPrefix) === 0;

  // Restore targets, captured before anything is touched.
  const prevBook = useRef(activeBookId);
  const prevLoc = useRef(loc);
  const prevPen = useRef(pen);
  const tempId = useRef<string | null>(null);
  const cleaned = useRef(false);
  const noteSnapshot = useRef<Record<string, string>>({});
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const isDemoNoteKeyRef = useRef(isDemoNoteKey);
  isDemoNoteKeyRef.current = isDemoNoteKey;

  // Per-beat baselines so "did it happen" reads true only on a real action.
  const baseIds = useRef<Set<string>>(new Set());
  const baseLabels = useRef<Record<number, string>>({});

  // ── Setup: once, behind the welcome card. Arm a sensible pen, create the
  // throwaway book, drop in two demo marks + their theme names, open the demo
  // chapter — so the moment you tap Begin the reading screen is ready.
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
    setPen({ color: FAITH, tool: "highlight" });
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
    // One theme arrives named, one deliberately does NOT — the tour's core
    // lesson is that the user names themes, so it leaves one for them.
    setScopedLabel(demoScopeKey, FAITH, "Faith");
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
    const isKey = isDemoNoteKeyRef.current;
    const snap = noteSnapshot.current;
    const cur = notesRef.current || {};
    Object.keys(cur).forEach((k) => {
      if (!isKey(k)) return;
      const want = Object.prototype.hasOwnProperty.call(snap, k) ? snap[k] : "";
      if ((cur[k] || "") !== (want || "")) setNote(k, want);
    });
    setCompileOpen(false);
    // Journey artifacts: dissolve the demo link, delete any keyword study the
    // journey created, close any Screen it opened.
    if (journey) {
      if (chapterGroups[DEMO_SCOPE]) unlinkChapter(DEMO_SCOPE);
      searchStudyIds
        .filter((x) => !jBase.current.search.includes(x))
        .forEach((x) => deleteSearchStudy(x));
      tabIds
        .filter((x) => !jBase.current.tabs.includes(x))
        .forEach((x) => closeTab(x));
    }
    setActiveBook(prevBook.current);
    if (tempId.current) deleteBook(tempId.current);
    setLoc(prevLoc.current);
    setPen(prevPen.current);
    onClose();
  };

  const steps = journey ? JSTEPS : STEPS;
  const last = journey ? JSTEPS.length - 1 : LAST;
  const advance = () => setBeat((b) => (b < last ? b + 1 : b));


  // Set each beat's baseline the instant it opens. Mark/Phrase/Theme each snap
  // the current mark ids, so only a brand-new mark counts.
  useEffect(() => {
    const id = steps[beat]?.id;
    if (id === "mark" || id === "phrase" || id === "theme")
      baseIds.current = new Set(marks.map((m) => m.id));
    if (id === "name")
      baseLabels.current = { ...(scopedLabels[demoScopeKey] || {}) };
    // eslint-disable-next-line
  }, [beat]);

  // The naming act: any theme in the demo study gaining a fresh, nonempty name
  // (rename of Faith counts too — the lesson is that names are theirs to give).
  useEffect(() => {
    if (steps[beat]?.id !== "name") return;
    const cur = scopedLabels[demoScopeKey] || {};
    const grew = Object.keys(cur).some((k) => {
      const v = (cur[Number(k)] || "").trim();
      const was = (baseLabels.current[Number(k)] || "").trim();
      return v !== "" && v !== was;
    });
    if (grew) advance();
    // eslint-disable-next-line
  }, [scopedLabels, beat]);

  // Advance on marks: a new mark (mark), a new multi-word mark (phrase), or a
  // new mark in a different color than the starting theme (theme).
  useEffect(() => {
    const id = steps[beat]?.id;
    const fresh = marks.filter((m) => !baseIds.current.has(m.id));
    if (id === "mark" && fresh.length) advance();
    else if (id === "phrase" && fresh.some((m) => m.markedText.trim().includes(" ")))
      advance();
    else if (id === "theme" && fresh.some((m) => m.color !== FAITH)) advance();
  }, [marks, beat]);

  // Compile opening (compile beat); the notes screen closing wraps up the tour.
  useEffect(() => {
    const id = steps[beat]?.id;
    if (id === "compile" && compileOpen) advance();
    // Closing the notes screen ends the CORE tour — but not the journey,
    // which runs on the reading screen with the compile closed.
    else if (!journey && beat >= NOTES_FROM && !compileOpen) finish();
    else if (journey && steps[beat]?.id === "j-payoff" && !compileOpen)
      advance();
    // eslint-disable-next-line
  }, [compileOpen, beat]);

  // ── Journey detections: every beat waits for the REAL action. Baselines are
  // snapped when the journey starts so pre-existing state never satisfies a beat.
  const jBase = useRef({ search: [] as string[], tabs: [] as string[] });
  const jLoc = useRef<Loc | null>(null);
  useEffect(() => {
    if (!journey) return;
    const id = steps[beat]?.id;
    if (id === "j-link" && linkOpen) advance();
    else if (id === "j-pick" && chapterGroups[DEMO_SCOPE]) advance();
    else if (id === "j-jump") {
      if (!jLoc.current) jLoc.current = loc;
      else if (
        loc.v !== jLoc.current.v ||
        loc.b !== jLoc.current.b ||
        loc.c !== jLoc.current.c
      ) {
        jLoc.current = null;
        baseIds.current = new Set(marks.map((m) => m.id));
        advance();
      }
    } else if (
      id === "j-mark2" &&
      marks.some((m) => !baseIds.current.has(m.id))
    )
      advance();
    else if (id === "j-compile2" && compileOpen) advance();
    else if (
      id === "j-keyword" &&
      searchStudyIds.some((x) => !jBase.current.search.includes(x))
    )
      advance();
    else if (id === "j-combined" && demoCombined) advance();
    else if (
      id === "j-screens" &&
      tabIds.some((x) => !jBase.current.tabs.includes(x))
    )
      advance();
    // eslint-disable-next-line
  }, [
    journey,
    beat,
    linkOpen,
    chapterGroups,
    loc,
    marks,
    compileOpen,
    searchStudyIds,
    demoCombined,
    tabIds,
  ]);

  // Measure the spotlight / ring target. Re-measures on beat change, on scroll
  // (capture, so inner scrolls count) and resize; rAF passes cover mount timing.
  useEffect(() => {
    const sel = steps[beat]?.target;
    if (!sel) {
      setRect(null);
      return;
    }
    let raf = 0;
    let tries = 0;
    let scrolled = false;
    const measure = () => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) {
        // If the ringed control sits off-screen (e.g. the unnamed theme below
        // an expanded Faith group), bring it into view once before ringing.
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
      // Once the user has tapped the ringed control (it's focused and the
      // keyboard is up), the ring's pointing job is done — hide it instead of
      // chasing the keyboard-shifted layout around the screen.
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
  }, [beat, journey]);

  // The user is mid-action inside an overlay (Link sheet / search): get out of
  // the way — no card, no ring, just a slim status pill at the very top.
  const busyInOverlay = journey && (linkOpen || searchOpen);
  const Z = 600;
  const dim = "rgba(18,16,12,0.64)";
  const vw = typeof window !== "undefined" ? window.innerWidth : 0;
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;
  const step = steps[beat];

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
        <div style={{ fontSize: "16px", lineHeight: 1.6, color: C.muted, maxWidth: "330px" }}>
          Mark the words that move you. Scribal gathers them into your own themes — but what they mean is yours to write.
        </div>
        <div style={{ flexShrink: 0, marginTop: "34px", width: "100%", maxWidth: "320px" }}>
          <button
            onClick={() => setBeat(1)}
            style={{ width: "100%", padding: "15px", border: "none", borderRadius: "999px", backgroundColor: C.text, color: C.bg, fontSize: "16px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            Begin
          </button>
          <div style={{ fontSize: "12.5px", color: C.muted, marginTop: "14px" }}>Takes about a minute</div>
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
    <div style={{ display: "flex", gap: "5px", justifyContent: "center", marginTop: "12px", flexWrap: "wrap" }}>
      {Array.from({ length: journey ? JSTEPS.length : TEACH }, (_, i) =>
        journey ? i : i + 1
      ).map((n) => (
        <span
          key={n}
          style={{
            width: n === beat ? "16px" : "6px",
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
        {journey ? "Power tour · " + (beat + 1) + " of " + JSTEPS.length : "Step " + beat + " of " + TEACH}
      </div>
      <div style={{ fontSize: "17.5px", fontWeight: 800, marginBottom: "5px", color: C.text }}>{step.title}</div>
      <div style={{ fontSize: "14.5px", lineHeight: 1.5, color: C.muted }}>{step.body}</div>
      {step.id === "j-colors" && (
        <div style={{ marginTop: "10px" }}>
          {[
            ["#ef4444", "Red", "a chapter study"],
            ["#3b82f6", "Blue", "a keyword study"],
            ["#8b5cf6", "Purple", "combined — chapter + keyword"],
          ].map(([col, name, what]) => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M10 13a5 5 0 0 0 7.07 0l2-2a5 5 0 0 0-7.07-7.07l-1 1" />
                <path d="M14 11a5 5 0 0 0-7.07 0l-2 2a5 5 0 0 0 7.07 7.07l1-1" />
              </svg>
              <span style={{ fontSize: "12.5px", lineHeight: 1.45, color: C.muted }}>
                <b style={{ color: col }}>{name}</b> — {what}
              </span>
            </div>
          ))}
        </div>
      )}
      {step.id === "system" && (
        <div style={{ marginTop: "10px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              flexWrap: "wrap",
              marginBottom: "10px",
            }}
          >
            {["Mark", "Themes", "Study", "Lesson"].map((n, i) => (
              <span key={n} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                {i > 0 && <span style={{ color: C.muted, fontSize: "12px" }}>→</span>}
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    border: "1px solid " + C.border,
                    borderRadius: "999px",
                    padding: "3px 10px",
                    color: C.text,
                  }}
                >
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
              <span style={{ fontSize: "12.5px", lineHeight: 1.45, color: C.muted }}>
                <b style={{ color: C.text }}>{t}</b> — {d}
              </span>
            </div>
          ))}
        </div>
      )}

      {step.cta && (
        <button
          onClick={step.id === "done" || step.id === "j-done" ? finish : advance}
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

  // A soft base under a bottom coach so the live study behind it fades into the
  // page instead of peeking through as clutter.
  const bottomScrim = (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: "30vh",
        background: "linear-gradient(to top, " + C.bg + " 60%, rgba(0,0,0,0))",
        pointerEvents: "none",
      }}
    />
  );

  // coach wrapper positioned per the beat
  const coachWrap = (pos: CoachPos, r: DOMRect | null) => {
    const s: CSSProperties = { position: "fixed", left: 16, right: 16, zIndex: Z + 2, pointerEvents: "none" };
    if (pos === "top") {
      s.top = "calc(14px + env(safe-area-inset-top))";
    } else if (pos === "bottom") {
      s.bottom = "calc(18px + env(safe-area-inset-bottom))";
    } else {
      // near the target: above it if it sits low on screen, below it if high
      if (r && r.top > vh / 2) s.bottom = Math.max(16, vh - r.top + 12);
      else if (r) s.top = Math.min(vh - 180, r.bottom + 12);
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

  if (busyInOverlay) {
    return (
      <div
        style={{
          position: "fixed",
          top: "calc(8px + env(safe-area-inset-top))",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: Z + 2,
          pointerEvents: "none",
          background: C.panel,
          border: "1px solid " + C.border,
          borderRadius: "999px",
          boxShadow: "0 8px 26px rgba(0,0,0,0.28)",
          padding: "7px 14px",
          maxWidth: "88vw",
          ...baseFont,
        }}
      >
        <span
          style={{
            fontSize: "12.5px",
            fontWeight: 700,
            color: C.text,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "block",
          }}
        >
          {step.title}
        </span>
      </div>
    );
  }

  // ── "free" beats — screen stays live (so a tool can be armed AND used on the
  // reading side, and the real study stays interactive on the notes side); just
  // a ring (if we have a clean target) + the coach. A soft scrim sits under the
  // bottom coach on the notes screen to keep it clean.
  if (step.mode === "free") {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: Z, pointerEvents: "none", ...baseFont }}>
        {styleTag}
        {step.coachPos === "bottom" && bottomScrim}
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
