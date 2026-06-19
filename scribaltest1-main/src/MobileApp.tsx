import { useEffect, useMemo, useRef, useState } from "react";
import scriptures from "./data/scriptures.json";
import {
  Mark,
  MarkColor,
  MarkStyle,
  Tool,
  COLORS,
  COLOR_MAP,
  HIGHLIGHT_MAP,
} from "./types";
import MobileVerse from "./MobileVerse";
import MobileCompile from "./MobileCompile";
import ScribalMark from "./components/ScribalMark";
import CompileAnimation from "./components/CompileAnimation";
import MobileSearch from "./MobileSearch";
import SharePreview from "./SharePreview";
import MobileFeatureGuide from "./MobileFeatureGuide";
import SpotlightTour, { TourStep } from "./components/SpotlightTour";
import { useMarks } from "./hooks/useMarks";
import { useVault } from "./hooks/useVault";
import * as drive from "./googleDrive";
import {
  CORE_KEYS,
  DRIVE_CONFIGURED,
  GOOGLE_CLIENT_ID,
  countBookMarksFromJson,
  booksFromBackup,
  withFreshToken,
  buildBackupString as syncBuildBackupString,
  applyBackupString as syncApplyBackupString,
  pushToDrive as syncPushToDrive,
  pullIfNewer as syncPullIfNewer,
  mergeLinkGroups,
} from "./sync";
import {
  initCloud,
  onCloudState,
  configureSync,
  signIn as cloudSignIn,
  signOutCloud,
  noteLocalChange,
} from "./cloudSync";

// Everything this (mobile) shell backs up: the shared study data (CORE_KEYS)
// plus this device's reading position.
const BACKUP_KEYS = [...CORE_KEYS, "scribal_mobile_loc"];

// Reading position / scroll are device-local: a pulled backup must never move
// you off your current chapter, and scroll never travels between devices.
const MOBILE_APPLY_OPTS = {
  alwaysLocal: ["scribal_mobile_scroll"],
  keepLocalIfPresent: ["scribal_mobile_loc"],
};

// A fresh id for a new link group.
const newGroupId = () =>
  "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

// Distinct colors so different link groups are visually distinguishable.
const LINK_COLORS = [
  "#8b5cf6",
  "#0ea5e9",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#ec4899",
];

// A chapter's scope key = its verse-reference prefix (e.g. "D&C 93", "John 1").
// Marks store this prefix, so deriving scope from references — instead of book
// name + chapter number — keeps D&C (whose refs say "D&C" while the book is
// "Doctrine and Covenants") matching its own marks, links, and theme names.
const refScope = (reference: string) => {
  const i = reference.indexOf(":");
  return i < 0 ? reference : reference.slice(0, i);
};
const chapterScopeKey = (bk: any, ch: any): string =>
  ch && ch.verses && ch.verses[0]
    ? refScope(ch.verses[0].reference)
    : bk.book + " " + ch.chapter;
// D&C is divided into sections, not chapters.
const chapterWord = (bookName: string) =>
  /covenants/i.test(bookName) ? "Section" : "Chapter";

// Backup / sync helpers — implementations live in ./sync (shared with desktop);
// these thin wrappers pass in this shell's key list and device-local rules.
function buildBackupString() {
  return syncBuildBackupString(BACKUP_KEYS);
}

// Live spotlight tour over the real mobile home screen (reuses the desktop
// engine). It runs on the home screen, so it points at the home tiles.
const M_TOUR: TourStep[] = [
  {
    title: "Welcome to Scribal",
    body:
      "Read scripture, mark what stands out, and gather your marks into notes. Here's a quick tour of your home screen.",
  },
  {
    target: '[data-tour="m-continue"]',
    title: "Pick up where you left off",
    body:
      "This card always reopens your last chapter — one tap and you're reading.",
  },
  {
    target: '[data-tour="m-browse"]',
    title: "Browse books",
    body:
      "Open any book or chapter. Tap a word to mark it, or swipe sideways across words to mark a whole phrase.",
  },
  {
    target: '[data-tour="m-studies"]',
    title: "Your studies",
    body:
      "Compile your marks into four views — Outline, Charting, Distilled, and Relational — and every study you save lands here.",
  },
  {
    target: '[data-tour="m-search"]',
    title: "Search",
    body: "Search all of scripture, or just your own marks.",
  },
  {
    target: '[data-tour="m-gestures"]',
    title: "Gestures & marking",
    body:
      "New to marking? This walks you through every tap and swipe for marking and getting around.",
  },
  {
    target: '[data-tour="m-settings"]',
    title: "Settings",
    body:
      "Sign in to sync across your phone and desktop, and set your theme and reading comfort here.",
  },
  {
    title: "That's the tour",
    body:
      "You can reopen this anytime from the menu — Show the tour again. Happy studying.",
  },
];

function applyBackupString(text: string) {
  // Mobile historically never threw on a malformed backup — preserve that.
  try {
    syncApplyBackupString(text, MOBILE_APPLY_OPTS);
  } catch {}
}

const vols = scriptures.volumes;

const PALETTE = {
  light: {
    bg: "#f6f4ee",
    panel: "#ffffff",
    soft: "#efece4",
    text: "#1d1c18",
    muted: "#8d8a80",
    border: "#e2dfd6",
  },
  dark: {
    bg: "#131210",
    panel: "#1d1c19",
    soft: "#232220",
    text: "#eae7de",
    muted: "#8d8a82",
    border: "#343229",
  },
};

// The mark colors live as CSS variables (COLOR_MAP/HIGHLIGHT_MAP resolve to
// var(--penN)/var(--hlN)). The desktop App sets these on its theme root; the
// mobile shell must set them too or every mark renders black.
const MARK_VARS_LIGHT = {
  "--pen1": "#d11a2a",
  "--pen2": "#e07b1a",
  "--pen3": "#c9a200",
  "--pen4": "#2f8f3e",
  "--pen5": "#2f6fb0",
  "--pen6": "#7b4fbf",
  "--pen7": "#1a1a1a",
  "--hl1": "#ffd6d6",
  "--hl2": "#ffe2c2",
  "--hl3": "#fbedb0",
  "--hl4": "#d3f0d6",
  "--hl5": "#cfe2f7",
  "--hl6": "#e6d9f7",
  "--hl7": "#e0e0e0",
};

const MARK_VARS_DARK = {
  "--pen1": "#ff7b72",
  "--pen2": "#f0a24b",
  "--pen3": "#e3c341",
  "--pen4": "#5fcf6b",
  "--pen5": "#7cb0e8",
  "--pen6": "#b794f6",
  "--pen7": "#f2efe8",
  "--hl1": "#5c2b2e",
  "--hl2": "#5c3f1f",
  "--hl3": "#5a4a1c",
  "--hl4": "#1f4d2a",
  "--hl5": "#243d56",
  "--hl6": "#3d2b5c",
  "--hl7": "#3f3e3a",
};

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

const hexToHsl = (hex: string): [number, number, number] => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
};

const hslToHex = (h: number, s: number, l: number): string => {
  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = l;
    g = l;
    b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const to255 = (x: number): string => {
    const v = Math.round(Math.max(0, Math.min(255, x * 255)));
    const str = v.toString(16);
    return str.length < 2 ? "0" + str : str;
  };
  return "#" + to255(r) + to255(g) + to255(b);
};

// Make a color "pop" more (or softer) by intensity. Higher intensity boosts
// saturation and pulls lightness toward the vivid midpoint, so marks deepen
// and stand out; lower intensity mutes them. Works in both light and dark
// themes, for pen colors and highlights alike.
const adjustColor = (
  hex: string,
  intensity: number,
  isHighlight: boolean
): string => {
  const hsl = hexToHsl(hex);
  const h = hsl[0];
  const s0 = hsl[1];
  const l0 = hsl[2];
  const t = intensity - 1; // -0.4 (soft) .. +0.5 (bold)
  let s = s0;
  let l = l0;
  if (t >= 0) {
    // Pop: more saturated, lightness eased toward the vivid midpoint (0.5).
    s = clamp01(s0 * (1 + t * 0.9));
    const k = Math.min(1, t * 1.1);
    l = l0 + (0.5 - l0) * k;
  } else {
    // Soft: less saturated, lightness eased toward its nearer extreme.
    s = clamp01(s0 * (1 + t * 0.6));
    const extreme = l0 >= 0.5 ? 1 : 0;
    const k = Math.min(1, -t * 0.8);
    l = l0 + (extreme - l0) * k;
  }
  // Keep highlights legible — never so dark or so pale that text vanishes.
  if (isHighlight) l = Math.max(0.35, Math.min(0.95, l));
  return hslToHex(h, clamp01(s), clamp01(l));
};

const scaleMarkVars = (
  vars: Record<string, string>,
  intensity: number
): Record<string, string> => {
  const out: Record<string, string> = {};
  Object.keys(vars).forEach((key) => {
    if (key.indexOf("--hl") === 0) out[key] = adjustColor(vars[key], intensity, true);
    else if (key.indexOf("--pen") === 0)
      out[key] = adjustColor(vars[key], intensity, false);
    else out[key] = vars[key];
  });
  return out;
};

const STYLE_LABELS: { tool: Tool; label: string }[] = [
  { tool: "highlight", label: "Highlight" },
  { tool: "underline", label: "Underline" },
  { tool: "bold", label: "Bold" },
  { tool: "italic", label: "Italic" },
  { tool: "circle", label: "Circle" },
  { tool: "eraser", label: "Eraser" },
];

interface Loc {
  v: number;
  b: number;
  c: number;
}

// A search study: a named, hand-picked set of verses pulled from search results.
// Its marks live in the chosen book (master or a session); this is the saved
// "lens" over them, persisted so it can be reopened and worked on later.
interface SearchStudy {
  id: string;
  name: string;
  bookId: string; // "master" or a session book id — which book holds the marks
  refs: string[]; // verse references, kept in scripture order
  createdAt: number;
  // Last time the user changed this study (rename or verse-set edit). Drives
  // two-way sync: on merge the most-recently-edited side's name + refs win.
  updatedAt?: number;
  // Delete tombstone — counts as deleted only while newest (>= updatedAt); a
  // later edit revives it. Carried in the record so the delete syncs.
  deletedAt?: number;
}

// A recorded study (chapter or linked). Live: its marks are always the book's
// current marks within its scope. Created when you Compile (compile-gated).
// Search studies aren't recorded here — they come from the SearchStudy list,
// which already holds their verses and is reachable as a workspace.
interface Study {
  id: string;
  type: "chapter" | "linked";
  bookId: string;
  name: string;
  scopeRef: string; // chapter title (chapter) or link-group id (linked)
  compiledAt: number;
  // When the name was last set by the user (create or rename). Drives rename
  // sync; treated as compiledAt when absent (older records).
  nameAt?: number;
  // Delete tombstone — deleted only while newest (>= nameAt and compiledAt); a
  // later re-compile or rename revives it. Carried in the record so it syncs.
  deletedAt?: number;
}

// A recorded study is hidden iff its delete is its newest action.
const isStudyDeleted = (s: Study): boolean =>
  !!s.deletedAt &&
  s.deletedAt >= (s.nameAt || 0) &&
  s.deletedAt >= (s.compiledAt || 0);
// A keyword study is hidden iff its delete is its newest action.
const isSearchDeleted = (s: SearchStudy): boolean =>
  !!s.deletedAt && s.deletedAt >= (s.updatedAt || s.createdAt || 0);

// ---- Shared inline icons (line style, matches the rest of the app) ----
const IconTrash = ({ color, size = 17 }: { color: string; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
);

// Same chain glyph the reading screen uses for linking.
const IconLink = ({ color, size = 16 }: { color: string; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
    <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
  </svg>
);

const IconBook = ({ color, size = 17 }: { color: string; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

const IconInfo = ({ color, size = 17 }: { color: string; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </svg>
);

// Look up a verse's text + number by reference, built once lazily — used to
// render a search study's hand-picked verses (which span many chapters).
let _verseIdx: Map<string, { text: string; verse: number }> | null = null;
function verseByRef(): Map<string, { text: string; verse: number }> {
  if (_verseIdx) return _verseIdx;
  const m = new Map<string, { text: string; verse: number }>();
  (vols as any[]).forEach((vol) =>
    vol.books.forEach((bk: any) =>
      bk.chapters.forEach((ch: any) =>
        ch.verses.forEach((v: any) =>
          m.set(v.reference, { text: v.text, verse: v.verse })
        )
      )
    )
  );
  _verseIdx = m;
  return m;
}

const readLoc = (): Loc => {
  try {
    const raw = localStorage.getItem("scribal_mobile_loc");
    if (raw) {
      const p = JSON.parse(raw);
      if (vols[p.v] && vols[p.v].books[p.b] && vols[p.v].books[p.b].chapters[p.c])
        return { v: p.v, b: p.b, c: p.c };
    }
  } catch {}
  return { v: 0, b: 0, c: 0 };
};

const SCROLL_KEY = "scribal_mobile_scroll";
const locKey = (l: Loc) => l.v + "." + l.b + "." + l.c;
const readScrollMap = (): Record<string, number> => {
  try {
    const r = localStorage.getItem(SCROLL_KEY);
    if (r) return JSON.parse(r) || {};
  } catch {}
  return {};
};

const relTime = (ms: number | null): string => {
  if (!ms) return "not yet";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
};


const readPen = (): { color: MarkColor; tool: Tool } => {
  try {
    const raw = localStorage.getItem("scribal_mobile_pen");
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.color && p.tool) return { color: p.color, tool: p.tool };
    }
  } catch {}
  return { color: 1, tool: "highlight" };
};

export default function MobileApp() {
  const {
    marks,
    colorLabels,
    books,
    allMarks,
    activeBookId,
    setActiveBook,
    createSession,
    deleteBook,
    addMark,
    deleteMark,
    updateMarkRange,
    mergeRemoteBooks,
    undo,
    canUndo,
    setScopedLabel,
    seedScopeLabels,
    scopedLabels,
    getBook,
    notes,
    setNote,
  } = useMarks();

  const {
    entries: vaultEntries,
    mergeRemote: vaultMergeRemote,
  } = useVault();

  const [dark, setDark] = useState<boolean>(() => {
    const saved = localStorage.getItem("scribal_theme");
    if (saved) return saved === "dark";
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  });
  const C = dark ? PALETTE.dark : PALETTE.light;

  // Per-chapter conditional lens (the "if" identifier) for the reading screen —
  // each chapter remembers its own on/off, not a global switch.
  const [condByChapter, setCondByChapter] = useState<Record<string, boolean>>(
    {}
  );

  // Mark color intensity (device-local; shared key with desktop). 1.0 = normal.
  const [colorIntensity, setColorIntensity] = useState<number>(() => {
    const saved = localStorage.getItem("scribal_color_intensity");
    return saved ? parseFloat(saved) : 1.0;
  });
  useEffect(() => {
    localStorage.setItem("scribal_color_intensity", colorIntensity.toFixed(2));
  }, [colorIntensity]);
  const markVars = scaleMarkVars(
    dark ? MARK_VARS_DARK : MARK_VARS_LIGHT,
    colorIntensity
  );

  // Reading comfort: font scale, line spacing, warm (sepia) tone.
  const [reading, setReading] = useState<{
    fontScale: number;
    lineScale: number;
    warm: boolean;
  }>(() => {
    try {
      const s = localStorage.getItem("scribal_mobile_reading");
      if (s) {
        const p = JSON.parse(s);
        return {
          fontScale: typeof p.fontScale === "number" ? p.fontScale : 1,
          lineScale: typeof p.lineScale === "number" ? p.lineScale : 1.85,
          warm: !!p.warm,
        };
      }
    } catch {}
    return { fontScale: 1, lineScale: 1.85, warm: false };
  });
  useEffect(() => {
    try {
      localStorage.setItem("scribal_mobile_reading", JSON.stringify(reading));
    } catch {}
  }, [reading]);

  const readBg = reading.warm ? (dark ? "#1a1410" : "#f4ecd6") : C.bg;
  const readText = reading.warm ? (dark ? "#e9ddc2" : "#53442c") : C.text;
  const titleSize = (20 * reading.fontScale).toFixed(1) + "px";
  const verseSize = (19 * reading.fontScale).toFixed(1) + "px";

  const [loc, setLoc] = useState<Loc>(readLoc);
  const [pen, setPen] = useState(readPen);
  const [penOpen, setPenOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [pickV, setPickV] = useState(-1);
  const [pickB, setPickB] = useState(-1);
  const [pickC, setPickC] = useState(-1);
  // Chapters in the same group are one study — they share theme names and
  // compile together. Different groups stay independent. Same storage key as
  // desktop, so a link made on one device's shell shows in the other.
  const [chapterGroups, setChapterGroups] = useState<Record<string, string>>(
    () => {
      try {
        const raw = JSON.parse(
          localStorage.getItem("scribal_linked_chapters") || "{}"
        );
        return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      } catch {
        return {};
      }
    }
  );
  useEffect(() => {
    localStorage.setItem(
      "scribal_linked_chapters",
      JSON.stringify(chapterGroups)
    );
  }, [chapterGroups]);
  // Per-scope timestamp of the last link/unlink action — carried alongside
  // chapterGroups so unlinking (not just linking) converges across devices.
  const [chapterGroupsAt, setChapterGroupsAt] = useState<
    Record<string, number>
  >(() => {
    try {
      const raw = JSON.parse(
        localStorage.getItem("scribal_linked_chapters_at") || "{}"
      );
      return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    localStorage.setItem(
      "scribal_linked_chapters_at",
      JSON.stringify(chapterGroupsAt)
    );
  }, [chapterGroupsAt]);
  // Live mirrors so the long-lived sync merge reads CURRENT values, not a stale
  // mount-time closure.
  const chapterGroupsRef = useRef(chapterGroups);
  const chapterGroupsAtRef = useRef(chapterGroupsAt);
  useEffect(() => {
    chapterGroupsRef.current = chapterGroups;
    chapterGroupsAtRef.current = chapterGroupsAt;
  }, [chapterGroups, chapterGroupsAt]);
  // Stamp "changed now" for every scope whose membership differs between prev and
  // next — makes a link OR an unlink propagate.
  const stampGroupChanges = (
    prevG: Record<string, string>,
    nextG: Record<string, string>
  ) => {
    const now = Date.now();
    setChapterGroupsAt((prevAt) => {
      const nextAt = { ...prevAt };
      const seen = new Set([...Object.keys(prevG), ...Object.keys(nextG)]);
      seen.forEach((s) => {
        if (prevG[s] !== nextG[s]) nextAt[s] = now;
      });
      return nextAt;
    });
  };
  // Search studies: named, hand-picked verse collections built from search.
  const [searchStudies, setSearchStudies] = useState<SearchStudy[]>(() => {
    try {
      const raw = JSON.parse(
        localStorage.getItem("scribal_search_studies") || "[]"
      );
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        "scribal_search_studies",
        JSON.stringify(searchStudies)
      );
    } catch {}
  }, [searchStudies]);
  // Recorded chapter/linked studies (created when you Compile). Search studies
  // come from searchStudies above, so they're not duplicated here.
  const [studies, setStudies] = useState<Study[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("scribal_studies_v1") || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("scribal_studies_v1", JSON.stringify(studies));
    } catch {}
  }, [studies]);

  // Live-merge the study lists from a pulled cloud backup.
  //  - Recorded studies: add unseen ones; for a study both devices have, take the
  //    NAME from whichever set it most recently (nameAt) and advance compiledAt.
  //    A plain re-compile never moves nameAt, so it can't overwrite a rename.
  //  - Keyword studies: additive (add unseen ones only).
  const mergeRemoteStudies = (data: Record<string, string | null>) => {
    try {
      const r = JSON.parse(data["scribal_studies_v1"] || "[]");
      const remote: Study[] = Array.isArray(r) ? r : [];
      if (remote.length)
        setStudies((prev) => {
          const byId = new Map<string, Study>(prev.map((s) => [s.id, s]));
          let changed = false;
          remote.forEach((rs) => {
            if (!rs || !rs.id) return;
            const local = byId.get(rs.id);
            if (!local) {
              byId.set(rs.id, rs);
              changed = true;
              return;
            }
            const lNameAt = local.nameAt || local.compiledAt || 0;
            const rNameAt = rs.nameAt || rs.compiledAt || 0;
            const name = rNameAt > lNameAt ? rs.name : local.name;
            const nameAt = Math.max(lNameAt, rNameAt);
            const compiledAt = Math.max(
              local.compiledAt || 0,
              rs.compiledAt || 0
            );
            const deletedAt = Math.max(local.deletedAt || 0, rs.deletedAt || 0);
            if (
              name !== local.name ||
              nameAt !== (local.nameAt || 0) ||
              compiledAt !== (local.compiledAt || 0) ||
              deletedAt !== (local.deletedAt || 0)
            ) {
              const merged: Study = { ...local, name, nameAt, compiledAt };
              if (deletedAt) merged.deletedAt = deletedAt;
              byId.set(rs.id, merged);
              changed = true;
            }
          });
          if (!changed) return prev;
          return Array.from(byId.values()).sort(
            (a, b) => (b.compiledAt || 0) - (a.compiledAt || 0)
          );
        });
    } catch {}
    try {
      const r = JSON.parse(data["scribal_search_studies"] || "[]");
      const remote: SearchStudy[] = Array.isArray(r) ? r : [];
      if (remote.length)
        setSearchStudies((prev) => {
          const byId = new Map<string, SearchStudy>(prev.map((s) => [s.id, s]));
          let changed = false;
          remote.forEach((rs) => {
            if (!rs || !rs.id) return;
            const local = byId.get(rs.id);
            if (!local) {
              byId.set(rs.id, rs);
              changed = true;
              return;
            }
            const lAt = local.updatedAt || local.createdAt || 0;
            const rAt = rs.updatedAt || rs.createdAt || 0;
            const deletedAt = Math.max(local.deletedAt || 0, rs.deletedAt || 0);
            const contentChanged = rAt > lAt;
            if (contentChanged || deletedAt !== (local.deletedAt || 0)) {
              const merged: SearchStudy = contentChanged
                ? { ...local, name: rs.name, refs: rs.refs, updatedAt: rAt }
                : { ...local };
              if (deletedAt) merged.deletedAt = deletedAt;
              byId.set(rs.id, merged);
              changed = true;
            }
          });
          if (!changed) return prev;
          return Array.from(byId.values()).sort(
            (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
          );
        });
    } catch {}
    // Chapter-link groups + their per-scope timestamps. Converges links AND
    // unlinks; reads current state via refs so the long-lived merge isn't stale.
    try {
      const merged = mergeLinkGroups(
        chapterGroupsRef.current,
        chapterGroupsAtRef.current,
        data["scribal_linked_chapters"],
        data["scribal_linked_chapters_at"]
      );
      setChapterGroups(merged.groups);
      setChapterGroupsAt(merged.at);
    } catch {}
    // Mark colour intensity — a shared display setting, adopt the incoming value.
    const ci = data["scribal_color_intensity"];
    if (ci != null) {
      const v = parseFloat(ci);
      if (!Number.isNaN(v)) setColorIntensity((cur) => (cur === v ? cur : v));
    }
  };
  // The Studies screen (lists every study done, by type).
  const [studiesOpen, setStudiesOpen] = useState(false);
  // Which study row (if any) is expanded to show its scope + themes peek.
  const [infoStudyId, setInfoStudyId] = useState<string | null>(null);
  // Verses just picked in search, waiting for the source + name step.
  const [linkDraftRefs, setLinkDraftRefs] = useState<string[] | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftSource, setDraftSource] = useState<"master" | "session">(
    "master"
  );
  const [draftSessionId, setDraftSessionId] = useState<string>(""); // "" = new book
  const [draftNewName, setDraftNewName] = useState("");
  // The search study whose screen is open (full-screen). prevBookForStudy holds
  // the book to restore on close, since the screen switches the active book.
  const [openStudyId, setOpenStudyId] = useState<string | null>(null);
  const prevBookForStudy = useRef<string | null>(null);
  // When set, the search screen is open to ADD verses to this keyword study
  // (its current verses are pre-selected); confirming merges the selection back.
  const [addToStudyId, setAddToStudyId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [gesturesOpen, setGesturesOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [compileOpen, setCompileOpen] = useState(false);
  // When set, Compile + Save are scoped to this search study, not the chapter.
  const [compileStudy, setCompileStudy] = useState<SearchStudy | null>(null);
  // When set, Compile is scoped to this recorded chapter/linked study (so the
  // Studies list can jump straight to its compiled notes).
  const [compileRec, setCompileRec] = useState<Study | null>(null);
  const [compileAnim, setCompileAnim] = useState<{
    show: boolean;
    duration: number;
  }>({ show: false, duration: 1000 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  // Which book is opened inside the Vault (null = the book list).
  const [vaultBookId, setVaultBookId] = useState<string | null>(null);
  // Home launcher. Opens to Home on launch; flip the initial value to
  // `false` to open straight into reading instead.
  const [homeOpen, setHomeOpen] = useState(true);
  const [editMark, setEditMark] = useState<{ id: string; reference: string } | null>(null);
  const [versePreview, setVersePreview] = useState<{
    phrase: string;
    reference: string;
    theme: string;
    style: string;
    color: number;
  } | null>(null);
  const [signInOpen, setSignInOpen] = useState(
    () => !localStorage.getItem("scribal_mobile_onboarded")
  );
  const [mtourOpen, setMtourOpen] = useState(false);
  const [chooseRef, setChooseRef] = useState<string | null>(null);

  // Replay the first-run tour (which then opens the gestures sheet).
  const resetIntro = () => {
    setSettingsOpen(false);
    setHomeOpen(true);
    setMtourOpen(true);
  };

  // After the sign-in reload, finish opening the gestures sheet.
  useEffect(() => {
    try {
      if (localStorage.getItem("scribal_mobile_show_gestures") === "1") {
        localStorage.removeItem("scribal_mobile_show_gestures");
        setGesturesOpen(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const [connected, setConnected] = useState(
    () => !!localStorage.getItem("scribal_drive_enabled")
  );
  const [syncMsg, setSyncMsg] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  // When the phone couldn't renew the Google sign-in quietly, show a tap cue.
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [diag, setDiag] = useState("");
  const [barHidden, setBarHidden] = useState(false);

  // Firebase cloud sync state (the seamless replacement for Drive). When signed
  // in, sync is automatic + cross-device and the old Drive path stays dormant.
  const [cloudSignedIn, setCloudSignedIn] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudEmail, setCloudEmail] = useState<string | null>(null);
  // Hide the legacy Google Drive sign-in UI while we run on Firebase. The Drive
  // code stays in place (so nothing breaks) but can't be triggered from the UI.
  const SHOW_LEGACY_DRIVE = false;

  // Track which marks were created during this app session, so Compile can
  // surface "what you just worked on." Re-seeds when the active book changes,
  // so switching books never falsely flags everything as new.
  const knownIds = useRef<Set<string>>(new Set());
  const seededBook = useRef<string | null>(null);
  const [sessionNew, setSessionNew] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (seededBook.current !== activeBookId) {
      knownIds.current = new Set(marks.map((m) => m.id));
      seededBook.current = activeBookId;
      setSessionNew(new Set());
      return;
    }
    const fresh: string[] = [];
    marks.forEach((m) => {
      if (!knownIds.current.has(m.id)) {
        knownIds.current.add(m.id);
        fresh.push(m.id);
      }
    });
    if (fresh.length) {
      setSessionNew((prev) => {
        const n = new Set(prev);
        fresh.forEach((id) => n.add(id));
        return n;
      });
    }
  }, [marks, activeBookId]);

  // Warm up Google sign-in early so the consent popup opens within the tap.
  useEffect(() => {
    if (DRIVE_CONFIGURED) drive.preloadGis();
  }, []);

  // Give cloud sync this shell's merge hooks + the keys it backs up. Re-runs if
  // the hooks change identity (cheap — it only stores references).
  useEffect(() => {
    configureSync({
      backupKeys: BACKUP_KEYS,
      mergeRemoteBooks,
      vaultMergeRemote,
      mergeRemoteStudies,
    });
  }, [mergeRemoteBooks, vaultMergeRemote]);

  // Start Firebase and mirror its sync state into the UI. Once a user is signed
  // in, Firestore's live listener + debounced push handle sync automatically;
  // there's no "sync now" and no reconnect cue (the login refreshes silently).
  useEffect(() => {
    onCloudState((s) => {
      setCloudSignedIn(s.signedIn);
      setCloudSyncing(s.syncing);
      setCloudEmail(s.email);
      if (s.lastSync) setLastSync(s.lastSync);
    });
    initCloud();
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastScroll = useRef(0);
  const scrollPos = useRef<Record<string, number>>(readScrollMap());
  const scrollSaveTimer = useRef<number | null>(null);
  const jumpVerse = useRef<string | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);

  // two-finger tap = undo last mark
  const tfActive = useRef(false);
  const tfStart = useRef(0);
  const tfMoved = useRef(false);
  const tfDist = useRef(0);
  const tfPts = useRef<{ x: number; y: number }[]>([]);

  const [lastSync, setLastSync] = useState<number | null>(
    () => Date.parse(localStorage.getItem("scribal_sync_seen") || "") || null
  );
  // re-render every 30s so the "Synced 2m ago" label stays current
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    localStorage.setItem("scribal_mobile_loc", JSON.stringify(loc));
    const el = scrollRef.current;

    const place = (clear: boolean) => {
      if (!el) return;
      const want = jumpVerse.current;
      if (want) {
        const safe = want.replace(/["\\]/g, "\\$&");
        const target = el.querySelector(
          '[data-vref="' + safe + '"]'
        ) as HTMLElement | null;
        if (target) {
          const cTop = el.getBoundingClientRect().top;
          const tTop = target.getBoundingClientRect().top;
          // sit the verse just below the top bar
          el.scrollTop = Math.max(0, el.scrollTop + (tTop - cTop) - 90);
        }
        if (clear) jumpVerse.current = null;
        return;
      }
      // no jump target — restore where we left off in this chapter
      el.scrollTop = scrollPos.current[locKey(loc)] || 0;
    };

    place(false);
    requestAnimationFrame(() => {
      place(true);
      if (scrollRef.current) updateProgress(scrollRef.current);
    });
    lastScroll.current = el ? el.scrollTop : 0;
    try {
      localStorage.setItem(SCROLL_KEY, JSON.stringify(scrollPos.current));
    } catch {}
    setBarHidden(false);
  }, [loc]);

  // Persist scroll positions when the app is backgrounded or closed.
  useEffect(() => {
    const flush = () => {
      try {
        localStorage.setItem(SCROLL_KEY, JSON.stringify(scrollPos.current));
      } catch {}
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("scribal_mobile_pen", JSON.stringify(pen));
  }, [pen]);

  // Flat chapter list for prev/next across the whole canon
  const flat = useMemo(() => {
    const list: Loc[] = [];
    vols.forEach((vol, v) =>
      vol.books.forEach((bk, b) =>
        bk.chapters.forEach((_ch, c) => list.push({ v, b, c }))
      )
    );
    return list;
  }, []);

  const curIndex = flat.findIndex(
    (x) => x.v === loc.v && x.b === loc.b && x.c === loc.c
  );
  const go = (delta: number) => {
    const next = flat[curIndex + delta];
    if (next) setLoc(next);
  };

  // chapter reference ("Mosiah 18") -> location + canonical order, for jumping
  // from the Outline / Search back to a verse.
  const chapterLoc = useMemo(() => {
    const map = new Map<string, { v: number; b: number; c: number; order: number }>();
    let order = 0;
    vols.forEach((vol, v) =>
      vol.books.forEach((bk, b) =>
        bk.chapters.forEach((ch, c) => {
          map.set(chapterScopeKey(bk, ch), { v, b, c, order });
          order++;
        })
      )
    );
    return map;
  }, []);

  // One-time cleanup: drop link-group entries whose scope no longer maps to a
  // real chapter — orphans left by the old book-name vs reference mismatch (e.g.
  // a stale "Doctrine and Covenants 93" sitting next to the correct "D&C 93") —
  // then drop any group left with fewer than two chapters.
  useEffect(() => {
    setChapterGroups((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      Object.keys(prev).forEach((k) => {
        if (chapterLoc.has(k)) next[k] = prev[k];
        else changed = true;
      });
      const counts: Record<string, number> = {};
      Object.values(next).forEach((g) => (counts[g] = (counts[g] || 0) + 1));
      Object.keys(next).forEach((s) => {
        if (counts[next[s]] < 2) {
          delete next[s];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [chapterLoc]);

  // Flat list of canon book names for free-text reference parsing.
  const bookList = useMemo(() => {
    const out: { name: string; norm: string; firstChap: string }[] = [];
    vols.forEach((vol) =>
      vol.books.forEach((bk) =>
        out.push({
          name: bk.book,
          norm: bk.book.toLowerCase().replace(/[^a-z0-9]/g, ""),
          firstChap: bk.chapters.length ? String(bk.chapters[0].chapter) : "1",
        })
      )
    );
    return out;
  }, []);

  const parseRef = (raw: string): string | null => {
    const t = raw.trim();
    if (!t) return null;
    // Try "Book Chapter[:Verse]" — but only when there's a book name *before*
    // the trailing number (so "1 Nephi" alone isn't read as chapter 1).
    const m = t.match(/^(.*?)(\d+)(?::(\d+))?\s*$/);
    let bookPart: string;
    let chapter: string | null;
    let verse: string | undefined;
    if (m && m[1].trim() !== "") {
      bookPart = m[1];
      chapter = m[2];
      verse = m[3];
    } else {
      // book name only → default to its first chapter
      bookPart = t;
      chapter = null;
      verse = undefined;
    }
    const norm = bookPart.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!norm) return null;
    let hit = bookList.find((b) => b.norm === norm);
    if (!hit) {
      const starts = bookList
        .filter((b) => b.norm.startsWith(norm))
        .sort((a, b) => a.norm.length - b.norm.length);
      hit = starts[0];
    }
    if (!hit) hit = bookList.find((b) => b.norm.includes(norm));
    if (!hit) return null;
    const chap = hit.name + " " + (chapter || hit.firstChap);
    if (!chapterLoc.has(chap)) return null;
    return verse ? chap + ":" + verse : chap;
  };

  const [gotoText, setGotoText] = useState("");
  const [gotoErr, setGotoErr] = useState(false);

  const submitGoto = () => {
    const ref = parseRef(gotoText);
    if (!ref) {
      setGotoErr(true);
      return;
    }
    setGotoErr(false);
    setGotoText("");
    setJumpOpen(false);
    jumpToRef(ref);
  };

  const orderOf = (ref: string) => {
    const chap = ref.replace(/:\d+$/, "");
    const cl = chapterLoc.get(chap);
    const vmatch = ref.match(/:(\d+)/);
    const vnum = vmatch ? parseInt(vmatch[1], 10) : 0;
    return (cl ? cl.order : 99999) * 1000 + vnum;
  };

  const jumpToRef = (ref: string) => {
    const chap = ref.replace(/:\d+$/, "");
    const cl = chapterLoc.get(chap);
    jumpVerse.current = ref;
    if (cl) setLoc({ v: cl.v, b: cl.b, c: cl.c });
    setCompileOpen(false);
    setSearchOpen(false);
    setChooseRef(null);
    setJumpOpen(false);
    setMenuOpen(false);
  };

  const chapter = vols[loc.v].books[loc.b].chapters[loc.c];
  const bookName = vols[loc.v].books[loc.b].book;
  const displayTitle = bookName + " " + chapter.chapter;
  const title = chapterScopeKey(vols[loc.v].books[loc.b], chapter);
  const showConditionals = !!condByChapter[title];
  const toggleConditionals = () =>
    setCondByChapter((m) => ({ ...m, [title]: !m[title] }));

  // Theme names are per chapter (study scope). Each chapter keeps its own
  // palette, so naming or clearing one chapter never touches another.
  const scopeOf = (ref: string) => {
    const i = ref.indexOf(":");
    return i < 0 ? ref : ref.slice(0, i);
  };
  // A chapter's label scope: its group's shared scope if linked, else its own.
  const resolveScope = (cs: string) =>
    chapterGroups[cs] ? "group:" + chapterGroups[cs] : cs;
  // Stable distinct color for each link group.
  const groupColor = (gid: string) => {
    const ids = Array.from(new Set(Object.values(chapterGroups))).sort();
    const i = ids.indexOf(gid);
    return LINK_COLORS[(i < 0 ? 0 : i) % LINK_COLORS.length];
  };
  const chapterColorName = (scope: string, color: MarkColor): string => {
    const sl = scopedLabels[resolveScope(scope)];
    if (sl && color in sl) return (sl[color] || "").trim();
    // fall back to a frozen per-mark label (saved/older studies)
    const fm = marks.find(
      (m) =>
        scopeOf(m.reference) === scope &&
        m.color === color &&
        m.label &&
        m.label.trim()
    );
    return fm ? (fm.label as string).trim() : "";
  };
  const effLabel = (m: Mark) => chapterColorName(scopeOf(m.reference), m.color);
  // The current chapter's palette as a color→name map (for compile / verse views).
  const scopeLabels = (() => {
    const out: Record<number, string> = {};
    COLORS.forEach((c) => {
      const n = chapterColorName(title, c);
      if (n) out[c] = n;
    });
    return out;
  })();
  const chapterMarks = marks.filter((m) =>
    m.reference.startsWith(title + ":")
  );
  const chapterThemes = (() => {
    const map = new Map<
      string,
      { color: MarkColor; name: string; count: number }
    >();
    chapterMarks.forEach((m) => {
      const nm = effLabel(m);
      const key = nm ? "n:" + nm : "c:" + m.color;
      const e = map.get(key);
      if (e) e.count += 1;
      else
        map.set(key, {
          color: m.color,
          name: nm || "Color " + m.color,
          count: 1,
        });
    });
    return Array.from(map.values());
  })();
  // ---- Link groups: combine chapters into one study (shared themes + compile) ----
  const groupMembers = (cs: string): string[] =>
    chapterGroups[cs]
      ? Object.keys(chapterGroups)
          .filter((s) => chapterGroups[s] === chapterGroups[cs])
          .sort()
      : [];
  // Friendly name for a scope key (e.g. "D&C 93" -> "Doctrine and Covenants 93").
  const displayOf = (scope: string): string => {
    const cl = chapterLoc.get(scope);
    return cl
      ? vols[cl.v].books[cl.b].book +
          " " +
          vols[cl.v].books[cl.b].chapters[cl.c].chapter
      : scope;
  };
  // Navigate to a chapter by its scope key (the linked-chapter jump buttons).
  const jumpToScope = (scope: string) => {
    const cl = chapterLoc.get(scope);
    if (cl) setLoc({ v: cl.v, b: cl.b, c: cl.c });
  };

  // ---- Search studies: open/close switches the active book to the study's
  // own (so marking, compile and save target it), restoring it on close. ----
  const openStudy = (study: SearchStudy, bookId?: string) => {
    const bid = bookId || study.bookId;
    prevBookForStudy.current = activeBookId;
    if (bid !== activeBookId) setActiveBook(bid);
    setOpenStudyId(study.id);
    setHomeOpen(false);
    setSearchOpen(false);
    setMenuOpen(false);
    setStudiesOpen(false);
  };
  const closeStudy = () => {
    setOpenStudyId(null);
    const prev = prevBookForStudy.current;
    if (prev && prev !== activeBookId) setActiveBook(prev);
    prevBookForStudy.current = null;
  };
  const deleteSearchStudy = (id: string) => {
    setSearchStudies((prev) =>
      prev.map((s) => (s.id === id ? { ...s, deletedAt: Date.now() } : s))
    );
    if (openStudyId === id) closeStudy();
  };
  // Search → "Next": stash the picked verses and open the source + name step.
  const onLinkConfirm = (refs: string[]) => {
    if (!refs.length) return;
    const ordered = refs.slice().sort((a, b) => orderOf(a) - orderOf(b));
    // Adding to an existing keyword study: merge the selection in (the study's
    // verses were pre-selected, so `ordered` is the full, updated set), keep the
    // name + theme colors, then reopen the study.
    if (addToStudyId) {
      const id = addToStudyId;
      setSearchStudies((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, refs: ordered, updatedAt: Date.now() } : s
        )
      );
      const studyScope = "searchstudy:" + id;
      Array.from(new Set(ordered.map((r) => scopeOf(r)))).forEach((ch) =>
        seedScopeLabels(studyScope, scopedLabels[ch] || {})
      );
      setAddToStudyId(null);
      setSearchOpen(false);
      setOpenStudyId(id);
      flash("Verses updated");
      return;
    }
    setLinkDraftRefs(ordered);
    setDraftName("");
    setDraftSource("master");
    setDraftSessionId("");
    setDraftNewName("");
    setSearchOpen(false);
  };
  const cancelDraft = () => setLinkDraftRefs(null);
  const createStudyFromDraft = () => {
    const refs = linkDraftRefs;
    if (!refs || !refs.length) return;
    const name = draftName.trim() || "Untitled study";
    let bookId = "master";
    if (draftSource === "session") {
      if (draftSessionId) bookId = draftSessionId;
      else bookId = createSession(draftNewName.trim() || name);
    }
    const study: SearchStudy = {
      id: "ss_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      name,
      bookId,
      refs,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setSearchStudies((prev) => [study, ...prev]);
    // Give the study its own theme palette, seeded from the chapters it spans
    // so any names you already gave those chapters carry into the study.
    const studyScope = "searchstudy:" + study.id;
    Array.from(new Set(refs.map((r) => scopeOf(r)))).forEach((ch) =>
      seedScopeLabels(studyScope, scopedLabels[ch] || {})
    );
    setLinkDraftRefs(null);
    openStudy(study, study.bookId);
  };
  // Link chapter a (current) with chapter b. Never drops a study's theme names:
  // seeding only fills blanks, so existing names survive a join or a merge.
  const linkChapters = (a: string, b: string) => {
    if (a === b) return;
    const ga = chapterGroups[a];
    const gb = chapterGroups[b];
    if (ga && gb && ga === gb) return;
    const next = { ...chapterGroups };
    if (ga && gb) {
      // merge b's study into a's
      seedScopeLabels("group:" + ga, scopedLabels["group:" + gb] || {});
      Object.keys(next).forEach((s) => {
        if (next[s] === gb) next[s] = ga;
      });
    } else if (ga && !gb) {
      seedScopeLabels("group:" + ga, scopedLabels[b] || {});
      next[b] = ga;
    } else if (!ga && gb) {
      seedScopeLabels("group:" + gb, scopedLabels[a] || {});
      next[a] = gb;
    } else {
      const gid = newGroupId();
      seedScopeLabels("group:" + gid, scopedLabels[a] || {});
      seedScopeLabels("group:" + gid, scopedLabels[b] || {});
      next[a] = gid;
      next[b] = gid;
    }
    stampGroupChanges(chapterGroups, next); // record the link so it syncs
    setChapterGroups(next);
  };
  const unlink = (a: string) => {
    const next = { ...chapterGroups };
    delete next[a];
    const counts: Record<string, number> = {};
    Object.values(next).forEach((g) => (counts[g] = (counts[g] || 0) + 1));
    Object.keys(next).forEach((s) => {
      if (counts[next[s]] < 2) delete next[s];
    });
    stampGroupChanges(chapterGroups, next); // record the unlink so it syncs
    setChapterGroups(next);
  };
  const openLinkPrompt = () => {
    setPickV(-1);
    setPickB(-1);
    setPickC(-1);
    setLinkOpen(true);
  };
  // Next chapter in canonical order (the one-tap "link with next").
  const nextLoc = curIndex >= 0 ? flat[curIndex + 1] : undefined;
  const nextTitle = nextLoc
    ? chapterScopeKey(
        vols[nextLoc.v].books[nextLoc.b],
        vols[nextLoc.v].books[nextLoc.b].chapters[nextLoc.c]
      )
    : null;
  const linkWithNext = () => {
    if (!nextLoc || !nextTitle) return;
    linkChapters(title, nextTitle);
    setLinkOpen(false);
    setLoc(nextLoc);
    flash("Linked with " + nextTitle);
  };
  // The chapter chosen in the book/chapter picker (the link target).
  const pickVol = pickV >= 0 ? vols[pickV] : null;
  const pickBookObj = pickVol && pickB >= 0 ? pickVol.books[pickB] : null;
  const pickChapters = pickBookObj ? pickBookObj.chapters : [];
  const targetScope =
    pickBookObj && pickC >= 0 && pickChapters[pickC]
      ? chapterScopeKey(pickBookObj, pickChapters[pickC])
      : null;
  const previewLabels = targetScope
    ? scopedLabels[resolveScope(targetScope)] || {}
    : {};
  const previewThemes = Object.keys(previewLabels)
    .map((k) => ({
      color: Number(k) as MarkColor,
      name: previewLabels[Number(k)],
    }))
    .filter((t) => t.name && t.name.trim());
  const confirmPick = () => {
    if (!targetScope || targetScope === title) return;
    linkChapters(title, targetScope);
    setLinkOpen(false);
    // Take the user to the chapter they just picked (they expected to land
    // there) — mirrors "link with next", which also jumps.
    if (pickV >= 0 && pickB >= 0 && pickC >= 0) {
      setLoc({ v: pickV, b: pickB, c: pickC });
    }
    flash("Linked with " + targetScope);
  };

  const updateProgress = (el: HTMLDivElement) => {
    const max = el.scrollHeight - el.clientHeight;
    const pct = max > 8 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0;
    if (progressRef.current)
      progressRef.current.style.width = (pct * 100).toFixed(2) + "%";
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const y = el.scrollTop;
    updateProgress(el);
    if (y > lastScroll.current + 6 && y > 40) setBarHidden(true);
    else if (y < lastScroll.current - 6) setBarHidden(false);
    lastScroll.current = y;
    // remember where we are in this chapter
    scrollPos.current[locKey(loc)] = y;
    if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current);
    scrollSaveTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(SCROLL_KEY, JSON.stringify(scrollPos.current));
      } catch {}
    }, 500);
  };

  const tfDist2 = (
    a: { clientX: number; clientY: number },
    b: { clientX: number; clientY: number }
  ) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  const onReadTouchStart = (e: {
    touches: { length: number; [i: number]: { clientX: number; clientY: number } };
  }) => {
    if (e.touches.length === 2) {
      tfActive.current = true;
      tfMoved.current = false;
      tfStart.current = Date.now();
      tfPts.current = [
        { x: e.touches[0].clientX, y: e.touches[0].clientY },
        { x: e.touches[1].clientX, y: e.touches[1].clientY },
      ];
      tfDist.current = tfDist2(e.touches[0], e.touches[1]);
    } else {
      tfActive.current = false;
    }
  };

  const onReadTouchMove = (e: {
    touches: { length: number; [i: number]: { clientX: number; clientY: number } };
  }) => {
    if (!tfActive.current || e.touches.length < 2) return;
    const d = tfDist2(e.touches[0], e.touches[1]);
    if (Math.abs(d - tfDist.current) > 12) {
      tfMoved.current = true;
      return;
    }
    const m0 = Math.hypot(
      e.touches[0].clientX - tfPts.current[0].x,
      e.touches[0].clientY - tfPts.current[0].y
    );
    const m1 = Math.hypot(
      e.touches[1].clientX - tfPts.current[1].x,
      e.touches[1].clientY - tfPts.current[1].y
    );
    if (m0 > 14 || m1 > 14) tfMoved.current = true;
  };

  const onReadTouchEnd = () => {
    if (tfActive.current && !tfMoved.current && Date.now() - tfStart.current < 300) {
      tfActive.current = false;
      if (canUndo) {
        undo();
        flash("Undid last mark");
      } else {
        flash("Nothing to undo");
      }
      return;
    }
    tfActive.current = false;
  };

  const armedName = chapterColorName(title, pen.color);
  const isEraser = pen.tool === "eraser";
  const isSession = activeBookId !== "master";
  const activeBookName =
    books.find((b) => b.id === activeBookId)?.name || "Master Book";

  const [toast, setToast] = useState("");
  const [toastTone, setToastTone] = useState<"default" | "success">("default");
  const toastTimer = useRef<number | null>(null);
  const flash = (msg: string, tone: "default" | "success" = "default") => {
    setToast(msg);
    setToastTone(tone);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(
      () => setToast(""),
      tone === "success" ? 2200 : 1500
    );
  };

  const [manage, setManage] = useState<{
    ref: string;
    text: string;
    s: number;
    e: number;
  } | null>(null);

  const selBg = dark ? "rgba(234,231,222,0.20)" : "rgba(29,28,24,0.12)";

  const chapterRefSet = useMemo(
    () => new Set(chapter.verses.map((v: any) => v.reference)),
    [chapter]
  );

  const eraseRange = (ref: string, s: number, e: number) => {
    const hits = marks.filter(
      (m) => m.reference === ref && m.startIndex < e && m.endIndex > s
    );
    hits.forEach((m) => deleteMark(m.id));
    if (hits.length) flash("Removed");
  };

  const addRange = (ref: string, text: string, s: number, e: number) => {
    if (e <= s) return;
    addMark(ref, text, text.slice(s, e), s, e, pen.tool as MarkStyle, pen.color);
    try {
      const chap = ref.replace(/:\d+$/, "");
      const cl = chapterLoc.get(chap);
      if (cl)
        localStorage.setItem(
          "scribal_mobile_last_marked",
          JSON.stringify({ v: cl.v, b: cl.b, c: cl.c })
        );
    } catch {}
    const count =
      marks.filter((m) => m.color === pen.color && chapterRefSet.has(m.reference))
        .length + 1;
    flash((armedName || "Color " + pen.color) + " · " + count);
  };

  const onTap = (ref: string, text: string, s: number, e: number) => {
    if (isEraser) {
      eraseRange(ref, s, e);
      return;
    }
    const same = marks.find(
      (m) =>
        m.reference === ref &&
        m.color === pen.color &&
        m.style === pen.tool &&
        m.startIndex < e &&
        m.endIndex > s
    );
    if (same) {
      deleteMark(same.id);
      flash("Removed");
    } else {
      addRange(ref, text, s, e);
    }
  };

  const onRange = (ref: string, text: string, s: number, e: number) => {
    if (isEraser) eraseRange(ref, s, e);
    else addRange(ref, text, s, e);
  };

  const onManage = (ref: string, text: string, s: number, e: number) => {
    setManage({ ref, text, s, e });
  };

  // ---- Refine a mark's edges (double-tap to enter, tap words to adjust) ----
  const onEnterEdit = (id: string, ref: string) => {
    setManage(null);
    setEditMark({ id, reference: ref });
    flash("Tap words to set the edges · tap Done to finish");
  };
  const onAdjust = (
    id: string,
    startIndex: number,
    endIndex: number,
    markedText: string,
    commit: boolean
  ) => {
    updateMarkRange(id, startIndex, endIndex, markedText, commit);
  };

  const recolor = (m: Mark, color: MarkColor) => {
    deleteMark(m.id);
    addMark(
      m.reference,
      m.verseText,
      m.markedText,
      m.startIndex,
      m.endIndex,
      m.style,
      color
    );
  };

  // The chapters Compile gathers: the current chapter's whole study if it's
  // linked, otherwise just this chapter (sorted in canonical order).
  const studyScopes = (chapterGroups[title] ? groupMembers(title) : [title])
    .slice()
    .sort(
      (a, b) => (chapterLoc.get(a)?.order ?? 0) - (chapterLoc.get(b)?.order ?? 0)
    );
  const studyMarks = marks.filter((m) =>
    studyScopes.includes(scopeOf(m.reference))
  );

  // ---- Compile (gathering animation, then full-screen view) ----
  const startCompile = () => {
    const lastCount = Number(
      localStorage.getItem("scribal_mobile_compile_count") || "0"
    );
    const delta = Math.max(0, marks.length - lastCount);
    const duration = delta > 8 ? 2500 : 1000;
    localStorage.setItem("scribal_mobile_compile_count", String(marks.length));
    setCompileAnim({ show: true, duration });
  };

  // Record the current chapter (or its linked group) as a study, then compile.
  // Compile is the save — the single intentional action that lists a study.
  const recordStudy = (
    type: "chapter" | "linked",
    scopeRef: string,
    name: string,
    rename: boolean = true
  ) => {
    const bookId = activeBookId;
    setStudies((prev) => {
      const now = Date.now();
      const i = prev.findIndex(
        (s) => s.type === type && s.bookId === bookId && s.scopeRef === scopeRef
      );
      if (i >= 0) {
        const next = prev.slice();
        const cur = next[i];
        const nameChanged = rename && name !== cur.name;
        next[i] = {
          ...cur,
          name: rename ? name : cur.name,
          // Move nameAt only on a genuine rename, so re-compiling never lets a
          // stale name win a rename sync from another device.
          nameAt: nameChanged ? now : cur.nameAt || cur.compiledAt || now,
          compiledAt: now,
        };
        return next;
      }
      return [
        {
          id: "study_" + now + "_" + Math.random().toString(36).slice(2, 7),
          type,
          bookId,
          name,
          scopeRef,
          compiledAt: now,
          nameAt: now,
        },
        ...prev,
      ];
    });
  };
  const compileCurrentStudy = () => {
    if (studyMarks.length === 0) {
      flash("Mark something first, then compile");
      return;
    }
    const gid = chapterGroups[title];
    const type: "chapter" | "linked" = gid ? "linked" : "chapter";
    const scopeRef = gid || title;
    const defName = gid
      ? groupMembers(title).map(displayOf).join("  +  ")
      : displayTitle;
    // Compiling lists the study, but must NOT rename one you've already named.
    // rename = false → the default name is only used when first creating it;
    // an existing study keeps whatever you called it.
    recordStudy(type, scopeRef, defName, false);
    startCompile();
  };
  // Open a recorded study from the Studies screen — jump straight to its
  // compiled notes (the book is positioned underneath for when you close it).
  const openRecordedStudy = (s: Study) => {
    // Pin the compile to THIS study FIRST. The notes read their scope from
    // compileRec, so they can never fall back to whatever chapter is open
    // underneath — even when the study lives in an uploaded book whose chapters
    // aren't in the standard navigation map (where the jump below is a no-op).
    setCompileStudy(null);
    setCompileRec(s);
    if (s.bookId !== activeBookId) setActiveBook(s.bookId);
    const chapter =
      s.type === "linked"
        ? Object.keys(chapterGroups)
            .filter((c) => chapterGroups[c] === s.scopeRef)
            .sort(
              (a, b) =>
                (chapterLoc.get(a)?.order ?? 0) -
                (chapterLoc.get(b)?.order ?? 0)
            )[0] || s.scopeRef
        : s.scopeRef;
    jumpToScope(chapter);
    setStudiesOpen(false);
    setHomeOpen(false);
    setCompileOpen(true);
  };
  const deleteStudy = (id: string) => {
    setStudies((prev) =>
      prev.map((s) => (s.id === id ? { ...s, deletedAt: Date.now() } : s))
    );
  };

  // ---- Migrate old Vault snapshots into the new live Studies list (once) ----
  useEffect(() => {
    if (localStorage.getItem("scribal_vault_migrated_v1")) return;
    const recs: Study[] = [];
    vaultEntries.forEach((e) => {
      if (!e || !e.scopeKey || e.deleted) return;
      if (e.scopeKey.indexOf("searchstudy:") === 0) return; // already a search study
      const type: "chapter" | "linked" =
        e.scopeKey.indexOf("group:") === 0 ? "linked" : "chapter";
      const scopeRef =
        type === "linked" ? e.scopeKey.slice("group:".length) : e.scopeKey;
      let bookId = "master";
      if (e.bookName && e.bookName !== "Master Book") {
        const bk = books.find((b) => b.name === e.bookName);
        if (!bk) return; // book is gone — skip
        bookId = bk.id;
      }
      recs.push({
        id: "study_mig_" + e.id,
        type,
        bookId,
        name: e.name || scopeRef,
        scopeRef,
        compiledAt: e.updatedAt || e.createdAt || Date.now(),
      });
    });
    if (recs.length) {
      setStudies((prev) => {
        const have = new Set(
          prev.map((s) => s.type + "|" + s.bookId + "|" + s.scopeRef)
        );
        const add = recs.filter(
          (r) => !have.has(r.type + "|" + r.bookId + "|" + r.scopeRef)
        );
        return add.length ? [...add, ...prev] : prev;
      });
    }
    try {
      localStorage.setItem("scribal_vault_migrated_v1", "1");
    } catch {}
  }, [books, vaultEntries]);

  // ---- Drop studies whose book no longer exists (any delete path) ----
  useEffect(() => {
    const ids = new Set(books.map((b) => b.id));
    setStudies((prev) => {
      const keep = prev.filter((s) => ids.has(s.bookId));
      return keep.length === prev.length ? prev : keep;
    });
    setSearchStudies((prev) => {
      const keep = prev.filter((ss) => ids.has(ss.bookId));
      return keep.length === prev.length ? prev : keep;
    });
  }, [books]);

  // ---- Close (delete) a session study book ----
  const closeSession = (id: string, name: string, markCount: number) => {
    const warn =
      markCount > 0
        ? "Close “" +
          name +
          "”? Its " +
          markCount +
          (markCount === 1 ? " mark" : " marks") +
          " will be removed from your open books. Anything you've saved to the Vault stays safe."
        : "Close “" + name + "”?";
    if (window.confirm(warn)) {
      deleteBook(id);
      flash("Session closed");
    }
  };

  // ---- Google Drive sync ----
  // While an initial sign-in pull is in flight, block auto-save so a fresh
  // install can't push its empty book over your good Drive backup before the
  // pull lands.
  const pullPending = useRef(false);

  // The single safe path for writing to Drive (same rules as desktop):
  //   1. Staleness — if the cloud is newer than the version this device last
  //      synced from, adopt the cloud copy instead of overwriting it.
  //   2. Emptiness — never replace a cloud copy that has marks with an empty one.
  const pushToDrive = () =>
    syncPushToDrive(
      BACKUP_KEYS,
      mergeRemoteBooks,
      vaultMergeRemote,
      mergeRemoteStudies
    );

  const driveConnect = async () => {
    if (!DRIVE_CONFIGURED) {
      setSyncMsg("Google sync isn't set up yet.");
      return;
    }
    setSyncBusy(true);
    setSyncMsg("Connecting…");
    pullPending.current = true;
    try {
      const token = await drive.connect(GOOGLE_CLIENT_ID);
      localStorage.setItem("scribal_drive_enabled", "1");
      setConnected(true);
      setNeedsReconnect(false);
      setSyncMsg("Loading your study…");
      const text = await drive.loadData(token);
      if (text) {
        applyBackupString(text);
        window.location.reload();
        return;
      }
      await drive.saveData(token, buildBackupString());
      pullPending.current = false;
      setSyncMsg("Connected ✓");
      setLastSync(Date.now());
    } catch (e: any) {
      setSyncMsg("Sign-in failed: " + (e && e.message ? e.message : "unknown"));
    } finally {
      setSyncBusy(false);
    }
  };

  const syncNow = async () => {
    setSyncBusy(true);
    setSyncMsg("Saving…");
    try {
      const res = await pushToDrive();
      // Any non-"fail" result means the token worked — clear the reconnect cue.
      if (res !== "fail") setNeedsReconnect(false);
      if (res === "adopted") return; // reloading with the newer cloud copy
      if (res === "blocked") {
        setSyncMsg(
          "Kept your saved copy — the cloud has more than this device. Reopen to pull it first."
        );
        return;
      }
      setSyncMsg(
        res === "pushed"
          ? "Saved ✓ " + new Date().toLocaleTimeString()
          : "Save failed — try again."
      );
      if (res === "pushed") setLastSync(Date.now());
    } catch (e: any) {
      setSyncMsg("Save failed: " + (e && e.message ? e.message : "unknown"));
    } finally {
      setSyncBusy(false);
    }
  };

  // One-look diagnostic: compares what THIS device has vs what's in the cloud.
  const runDiag = async () => {
    const localMarks = countBookMarksFromJson(
      localStorage.getItem("scribal_books_v1")
    );
    const seen = localStorage.getItem("scribal_sync_seen") || "(never)";
    setDiag("Phone: " + localMarks + " marks. Checking cloud…");
    try {
      const text = await withFreshToken((tok) => drive.loadData(tok));
      if (!text) {
        setDiag(
          "Phone has " +
            localMarks +
            " marks.\nCloud: NO file found for this account."
        );
        return;
      }
      const p = JSON.parse(text);
      const cloudMarks = countBookMarksFromJson(booksFromBackup(text));
      setDiag(
        "Phone: " +
          localMarks +
          " marks\nCloud: " +
          cloudMarks +
          " marks\nCloud saved: " +
          (p.exportedAt || "?") +
          "\nLast synced here: " +
          seen
      );
    } catch (e: any) {
      setDiag("Cloud check failed: " + (e && e.message ? e.message : "unknown"));
    }
  };

  const signOutDrive = () => {
    drive.disconnect();
    localStorage.removeItem("scribal_drive_enabled");
    setConnected(false);
    setSyncMsg("Signed out. Your study stays on this device.");
  };

  // (No on-open silent token refresh: on iOS Safari a silent GIS request can
  // surface a sign-in popup, so token refresh is now user-initiated via the
  // reconnect cue. The stored token is used directly while it is still valid.)

  // One list of the local data whose change should trigger a sync push — used by
  // BOTH the Firebase push (below) and the Drive auto-save, so they can't drift
  // apart again. Add a new synced field here once and both pick it up.
  const syncData = [
    marks,
    colorLabels,
    scopedLabels,
    notes,
    chapterGroups,
    chapterGroupsAt,
    studies,
    searchStudies,
    colorIntensity,
  ];

  // Push local changes to Firebase (debounced inside cloudSync; only acts when
  // signed in). This is the live counterpart to the Drive auto-save below.
  useEffect(() => {
    noteLocalChange();
  }, syncData);

  // Auto-save to Drive on changes, refreshing the token as needed (no popup).
  const autoSaveReady = useRef(false);
  useEffect(() => {
    if (!autoSaveReady.current) {
      autoSaveReady.current = true;
      return;
    }
    if (cloudSignedIn) return; // Firebase is handling sync — stay out of its way
    if (!connected) return;
    if (pullPending.current) return;
    const t = setTimeout(() => {
      if (pullPending.current) return;
      // No live token — don't push. A push would trigger a silent token refresh
      // that can pop a sign-in window on iOS. The change is already saved on this
      // device and will sync after the next reconnect; show the cue meanwhile.
      if (!drive.tokenValid()) {
        setNeedsReconnect(true);
        return;
      }
      setSyncBusy(true);
      pushToDrive()
        .then((res) => {
          // "adopted" = cloud was newer and we merged it in; that's a sync too.
          if (res === "pushed" || res === "adopted") {
            setLastSync(Date.now());
            setNeedsReconnect(false);
          } else if (res === "blocked")
            setSyncMsg("Safeguard on — kept your saved copy.");
        })
        .finally(() => setSyncBusy(false));
    }, 1500);
    return () => clearTimeout(t);
  }, [...syncData, connected, cloudSignedIn]);

  // Auto-pull the other device's changes when the app opens or regains focus.
  // Guarded by the saved timestamp so it only pulls when Drive is genuinely
  // newer than what's here — it never clobbers newer local edits.
  useEffect(() => {
    if (cloudSignedIn) return; // Firebase's live listener handles incoming changes
    if (!connected || !DRIVE_CONFIGURED) return;
    const checkRemote = async () => {
      // Use the stored token while it's valid. Do NOT trigger a silent refresh
      // here: on iOS Safari a silent GIS request can pop a sign-in window, and
      // this runs on focus, on visibility change, AND a 15s poll — which is what
      // produced the repeating sign-in prompts. When there's no live token, show
      // the one-tap reconnect cue instead and wait for the user.
      if (!drive.tokenValid()) {
        setNeedsReconnect(true);
        return;
      }
      setNeedsReconnect(false);
      const pulled = await syncPullIfNewer(
        mergeRemoteBooks,
        vaultMergeRemote,
        mergeRemoteStudies
      );
      if (pulled) setLastSync(Date.now());
    };
    const onVisible = () => {
      if (!document.hidden) checkRemote();
    };
    window.addEventListener("focus", checkRemote);
    document.addEventListener("visibilitychange", onVisible);
    checkRemote();
    // Poll every 15s while visible so the other device's changes/deletes show
    // up on their own. Silent path — no popup — and skipped while backgrounded.
    const pollId = window.setInterval(() => {
      if (!document.hidden) checkRemote();
    }, 15000);
    return () => {
      window.removeEventListener("focus", checkRemote);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(pollId);
    };
  }, [connected, cloudSignedIn]);

  // ---- shared sheet backdrop ----
  const sheet = (onClose: () => void, children: React.ReactNode) => (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.4)",
        zIndex: 200,
        display: "flex",
        alignItems: "flex-end",
        animation: "mob-fadein 0.18s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          backgroundColor: C.panel,
          color: C.text,
          borderRadius: "18px 18px 0 0",
          padding: "18px 18px calc(18px + env(safe-area-inset-bottom))",
          maxHeight: "80vh",
          overflowY: "auto",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
          boxShadow: "0 -10px 40px rgba(0,0,0,0.3)",
          animation: "mob-slideup 0.28s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {children}
      </div>
    </div>
  );

  // ---- Home launcher ----
  const homeTile = (
    label: string,
    sub: string,
    icon: React.ReactNode,
    onClick: () => void
  ) => (
    <button
      data-tour={
        label === "Browse books"
          ? "m-browse"
          : label === "Studies"
          ? "m-studies"
          : label === "Search"
          ? "m-search"
          : label === "Gestures & marking"
          ? "m-gestures"
          : undefined
      }
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        textAlign: "left",
        background: C.panel,
        border: "1px solid " + C.border,
        borderRadius: "14px",
        padding: "16px 14px",
        minHeight: "112px",
        color: C.text,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <span style={{ color: "#8b5cf6", display: "inline-flex" }}>{icon}</span>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: "15px", fontWeight: 700, marginBottom: "3px" }}>
        {label}
      </span>
      <span style={{ fontSize: "11.5px", color: C.muted, lineHeight: 1.3 }}>
        {sub}
      </span>
    </button>
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: C.bg,
        color: C.text,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "system-ui, -apple-system, sans-serif",
        ...(markVars as React.CSSProperties),
        ...({
          "--bg": C.bg,
          "--panel": C.panel,
          "--soft": C.soft,
          "--text": C.text,
          "--muted": C.muted,
          "--border": C.border,
        } as React.CSSProperties),
      }}
    >
      <style>{`
        @keyframes mob-fadein { from { opacity: 0; } to { opacity: 1; } }
        @keyframes mob-slideup { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes mob-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes mob-toast-in { 0% { opacity: 0; transform: translateX(-50%) translateY(16px) scale(0.9); } 55% { opacity: 1; } 100% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } }
        /* Native-feel tap polish: no default grey flash on any tap, and every
           button gets a quick pressed state + smooth state transitions. */
        * { -webkit-tap-highlight-color: transparent; }
        button { transition: opacity .12s ease, transform .08s ease, background-color .15s ease, border-color .15s ease; touch-action: manipulation; }
        button:active:not(:disabled) { opacity: .55; }
        /* iOS auto-zooms (and stays zoomed) when a focused field is under 16px.
           Baseline every form control at 16px so a tap never zooms the page. */
        input, textarea, select { font-size: 16px; }
      `}</style>

      {/* Chapter progress line (always visible) */}
      <div
        style={{
          position: "absolute",
          top: "env(safe-area-inset-top)",
          left: 0,
          right: 0,
          height: "2.5px",
          zIndex: 60,
          pointerEvents: "none",
          backgroundColor: "transparent",
        }}
      >
        <div
          ref={progressRef}
          style={{
            height: "100%",
            width: "0%",
            backgroundColor: "#8b5cf6",
            transition: "width 0.08s linear",
          }}
        />
      </div>

      {/* Top bar (hides on scroll) */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          backgroundColor: C.bg,
          borderBottom: "1px solid " + C.border,
          paddingTop: "env(safe-area-inset-top)",
          transform: barHidden
            ? "translateY(-110%)"
            : "translateY(0)",
          transition: "transform 0.25s ease",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: "52px",
            padding: "0 6px",
          }}
        >
          <button
            onClick={() => setHomeOpen(true)}
            style={{
              ...navBtn(C, false),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label="Home"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke={C.text}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 11.5 12 4l9 7.5" />
              <path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />
            </svg>
          </button>

          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <button
              onClick={() => go(-1)}
              disabled={curIndex <= 0}
              style={navBtn(C, curIndex <= 0)}
              aria-label="Previous chapter"
            >
              ‹
            </button>
            <button
              data-tour="m-chapter"
              onClick={() => setJumpOpen(true)}
              style={{
                minWidth: 0,
                flex: "0 1 auto",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                background: "transparent",
                border: "none",
                color: C.text,
                fontSize: "16px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                padding: "0 4px",
              }}
            >
              {displayTitle}
              {activeBookId !== "master" && (
                <span style={{ color: C.muted, fontSize: "12px", fontWeight: 400 }}>
                  {"  · session"}
                </span>
              )}
            </button>
            <button
              onClick={() => go(1)}
              disabled={curIndex >= flat.length - 1}
              style={navBtn(C, curIndex >= flat.length - 1)}
              aria-label="Next chapter"
            >
              ›
            </button>
          </div>

          <button
            data-tour="m-compile"
            onClick={compileCurrentStudy}
            style={{
              flexShrink: 0,
              background: C.text,
              color: C.bg,
              border: "none",
              borderRadius: "999px",
              padding: "8px 16px",
              fontSize: "12.5px",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
            aria-label="Compile this study"
          >
            Compile
          </button>
        </div>

        {/* Sync status (tap for details) + link this chapter */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "0 10px 7px",
          }}
        >
          <button
            data-tour="m-menu"
            onClick={() => setSettingsOpen(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "7px",
              flex: 1,
              minWidth: 0,
              padding: "0 4px",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
            aria-label="Sync status"
          >
            <span
              style={{
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                backgroundColor: !cloudSignedIn
                  ? C.muted
                  : cloudSyncing
                  ? "#e0a32e"
                  : "#3a9d4e",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: "11px",
                color: C.muted,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {!cloudSignedIn
                ? "Saved on this phone"
                : cloudSyncing
                ? "Saving…"
                : "Synced " + relTime(lastSync)}
            </span>
          </button>
          <button
            onClick={openLinkPrompt}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              flexShrink: 0,
              background: "transparent",
              border: "1px solid " + C.border,
              borderRadius: "999px",
              padding: "5px 12px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
            aria-label="Link this chapter into a study"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#8b5cf6"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
              <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
            </svg>
            <span
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: chapterGroups[title] ? "#8b5cf6" : C.text,
              }}
            >
              {chapterGroups[title] ? "Linked" : "Link"}
            </span>
          </button>
        </div>
        {!cloudSignedIn && DRIVE_CONFIGURED && connected && needsReconnect && (
          <button
            onClick={syncNow}
            disabled={syncBusy}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              width: "calc(100% - 28px)",
              margin: "0 14px 8px",
              padding: "9px 11px",
              background: "#fbf1da",
              border: "1px solid #e0a32e",
              borderRadius: "9px",
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "left",
            }}
            aria-label="Sign-in expired — tap to reconnect and sync"
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: "#e0a32e",
                flexShrink: 0,
              }}
            />
            <span
              style={{ fontSize: "12px", color: "#8a6112", lineHeight: 1.35 }}
            >
              Sign-in expired — tap to reconnect and sync
            </span>
          </button>
        )}
      </div>

      {/* Reading area */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onTouchStart={onReadTouchStart}
        onTouchMove={onReadTouchMove}
        onTouchEnd={onReadTouchEnd}
        style={{
          flex: 1,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          overscrollBehavior: "contain",
          touchAction: "pan-y",
          backgroundColor: readBg,
          color: readText,
          transition: "background-color 0.2s ease, color 0.2s ease",
          padding: "calc(74px + env(safe-area-inset-top) + 14px) 22px calc(150px + env(safe-area-inset-bottom))",
          ["--verse-lh" as any]: String(reading.lineScale),
        }}
      >
        <h2
          style={{
            fontFamily: '"Times New Roman", Times, serif',
            fontSize: titleSize,
            fontWeight: 600,
            margin: "0 0 14px",
          }}
        >
          {chapterGroups[title] && (
            <span
              style={{
                display: "inline-block",
                width: "0.55em",
                height: "0.55em",
                borderRadius: "50%",
                background: groupColor(chapterGroups[title]),
                marginRight: "0.4em",
                verticalAlign: "middle",
              }}
            />
          )}
          {displayTitle}
        </h2>
        <button
          onClick={toggleConditionals}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "7px",
            padding: "6px 12px",
            borderRadius: "999px",
            border:
              "1px solid " +
              (showConditionals ? (dark ? "#a5b4fc" : "#4f46e5") : C.border),
            background: showConditionals
              ? dark
                ? "rgba(165,180,252,0.16)"
                : "rgba(79,70,229,0.10)"
              : C.panel,
            color: showConditionals
              ? dark
                ? "#a5b4fc"
                : "#4f46e5"
              : C.muted,
            fontSize: "12.5px",
            fontWeight: 600,
            fontFamily: "system-ui, sans-serif",
            cursor: "pointer",
            marginBottom: "16px",
          }}
        >
          <span
            style={{
              fontStyle: "italic",
              fontFamily: '"Times New Roman", Times, serif',
              fontWeight: 700,
              borderBottom: "2px dashed currentColor",
              lineHeight: 1,
              paddingBottom: "1px",
            }}
          >
            if
          </span>
          {showConditionals ? "Conditionals shown" : "Find conditionals"}
        </button>
        <div
          data-tour="m-read"
          style={{
            fontFamily: '"Times New Roman", Times, serif',
            fontSize: verseSize,
            lineHeight: reading.lineScale,
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        >
          {chapter.verses.map((vs: any) => (
            <MobileVerse
              key={vs.reference}
              reference={vs.reference}
              verseNumber={vs.verse}
              text={vs.text}
              marks={marks}
              selBg={selBg}
              onTap={onTap}
              onRange={onRange}
              onManage={onManage}
              editMarkId={
                editMark && editMark.reference === vs.reference ? editMark.id : null
              }
              editingActive={!!editMark}
              onEnterEdit={onEnterEdit}
              onAdjust={onAdjust}
              showConditionals={showConditionals}
              dark={dark}
            />
          ))}
        </div>
      </div>

      {/* Pen tray (collapsible, locked to bottom) */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 60,
          padding: "0 14px calc(14px + env(safe-area-inset-bottom))",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            pointerEvents: "auto",
            backgroundColor: C.panel,
            border: "1px solid " + C.border,
            borderRadius: "16px",
            boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
            overflow: "hidden",
          }}
        >
          {/* Colors — always visible */}
          <div style={{ padding: "12px 14px 0", display: "flex", gap: "8px" }}>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setPen((p) => ({ ...p, color: c }))}
                aria-label={"Color " + c}
                style={{
                  flex: 1,
                  height: "30px",
                  borderRadius: "8px",
                  background:
                    pen.tool === "highlight" ? HIGHLIGHT_MAP[c] : COLOR_MAP[c],
                  border:
                    pen.color === c
                      ? "2px solid " + C.text
                      : "1px solid " + C.border,
                  cursor: "pointer",
                }}
              />
            ))}
          </div>

          {/* Styles — always visible (single letters keep the bar short) */}
          <div
            style={{
              padding: "8px 14px 0",
              display: "flex",
              gap: "8px",
            }}
          >
            {STYLE_LABELS.map((s) => {
              const active = pen.tool === s.tool;
              return (
                <button
                  key={s.tool}
                  onClick={() => setPen((p) => ({ ...p, tool: s.tool }))}
                  aria-label={s.label}
                  title={s.label}
                  style={{
                    flex: 1,
                    height: "30px",
                    borderRadius: "8px",
                    border: "1px solid " + (active ? C.text : C.border),
                    background: active ? C.text : "transparent",
                    color: active ? C.bg : C.text,
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {s.label.charAt(0)}
                </button>
              );
            })}
          </div>

          {/* Name-theme toggle — colors + styles stay open; the arrow reveals
              the theme-name field for the armed color. */}
          <button
            onClick={() => setPenOpen((o) => !o)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              width: "100%",
              background: "transparent",
              border: "none",
              padding: "10px 14px",
              cursor: "pointer",
              color: C.text,
              fontFamily: "inherit",
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
              {isEraser
                ? "Eraser · tap a mark to remove it"
                : armedName
                ? "Theme: " + armedName
                : "Name this theme"}
            </span>
            {isSession && !isEraser && (
              <span
                style={{
                  fontSize: "11px",
                  color: C.muted,
                  backgroundColor: C.soft,
                  borderRadius: "999px",
                  padding: "4px 10px",
                  maxWidth: "120px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {activeBookName}
              </span>
            )}
            {!isEraser && (
              <span style={{ color: C.muted, fontSize: "13px" }}>
                {penOpen ? "▾" : "▴"}
              </span>
            )}
          </button>

          {penOpen && !isEraser && (
            <div style={{ padding: "0 14px 14px" }}>
              <input
                value={
                  scopedLabels[resolveScope(title)] &&
                  pen.color in scopedLabels[resolveScope(title)]
                    ? scopedLabels[resolveScope(title)][pen.color]
                    : chapterColorName(title, pen.color)
                }
                onChange={(e) =>
                  setScopedLabel(resolveScope(title), pen.color, e.target.value)
                }
                placeholder={"Name color " + pen.color + " (e.g. Covenant)"}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "10px 12px",
                  fontSize: "16px",
                  borderRadius: "10px",
                  border: "1px solid " + C.border,
                  backgroundColor: C.bg,
                  color: C.text,
                  fontFamily: "inherit",
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Chapter study + link panel */}
      {linkOpen &&
        sheet(
          () => setLinkOpen(false),
          <div>
            <div
              style={{
                fontSize: "18px",
                fontWeight: 700,
                marginBottom: "2px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {chapterGroups[title] && (
                <span
                  style={{
                    width: "12px",
                    height: "12px",
                    borderRadius: "50%",
                    background: groupColor(chapterGroups[title]),
                    flexShrink: 0,
                  }}
                />
              )}
              {displayTitle}
            </div>
            <div
              style={{
                fontSize: "12.5px",
                color: C.muted,
                marginBottom: "16px",
              }}
            >
              {chapterMarks.length}{" "}
              {chapterMarks.length === 1 ? "marking" : "markings"} in this chapter
            </div>

            {chapterThemes.length > 0 && (
              <>
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: C.muted,
                    marginBottom: "8px",
                  }}
                >
                  Themes here
                </div>
                <div style={{ marginBottom: "18px" }}>
                  {chapterThemes.map((t, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "7px 0",
                      }}
                    >
                      <span
                        style={{
                          width: "14px",
                          height: "14px",
                          borderRadius: "50%",
                          backgroundColor: COLOR_MAP[t.color],
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ flex: 1, fontSize: "14px", fontWeight: 600 }}>
                        {t.name}
                      </span>
                      <span style={{ fontSize: "11.5px", color: C.muted }}>
                        {t.count} {t.count === 1 ? "mark" : "marks"}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Combine this chapter into a study */}
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: C.muted,
                marginBottom: "6px",
              }}
            >
              Combine into a study
            </div>
            <div
              style={{
                fontSize: "11.5px",
                color: C.muted,
                lineHeight: 1.5,
                marginBottom: "12px",
              }}
            >
              Linked chapters share one set of theme names and compile together.
            </div>

            {chapterGroups[title] && (
              <div
                style={{
                  background: C.soft,
                  border: "1px solid " + C.border,
                  borderRadius: "10px",
                  padding: "10px 12px",
                  marginBottom: "12px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "8px",
                  }}
                >
                  <span
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "50%",
                      background: groupColor(chapterGroups[title]),
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontWeight: 700, fontSize: "13px" }}>
                    Linked study
                  </span>
                  <span style={{ fontSize: "11px", opacity: 0.6 }}>
                    {groupMembers(title).length} chapters
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  {groupMembers(title).map((mScope) => {
                    const isCurrent = mScope === title;
                    return (
                      <div
                        key={mScope}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          padding: "3px 0",
                        }}
                      >
                        <span
                          style={{
                            flex: 1,
                            fontSize: "13px",
                            fontWeight: isCurrent ? 600 : 500,
                            opacity: isCurrent ? 0.7 : 1,
                          }}
                        >
                          {displayOf(mScope)}
                          {isCurrent && (
                            <span style={{ fontSize: "11px", fontWeight: 400 }}>
                              {" "}
                              · this chapter
                            </span>
                          )}
                        </span>
                        {!isCurrent && (
                          <button
                            onClick={() => {
                              jumpToScope(mScope);
                              setLinkOpen(false);
                            }}
                            style={{
                              background: "#8b5cf6",
                              color: "#fff",
                              border: "none",
                              borderRadius: "8px",
                              padding: "7px 14px",
                              fontSize: "12px",
                              fontWeight: 700,
                              cursor: "pointer",
                              fontFamily: "inherit",
                              flexShrink: 0,
                            }}
                          >
                            Go to →
                          </button>
                        )}
                        <button
                          onClick={() => {
                            unlink(mScope);
                            if (isCurrent) setLinkOpen(false);
                            flash("Unlinked " + displayOf(mScope));
                          }}
                          style={{
                            background: "transparent",
                            border: "1px solid " + C.border,
                            borderRadius: "8px",
                            padding: "6px 10px",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: "pointer",
                            fontFamily: "inherit",
                            color: C.muted,
                            flexShrink: 0,
                          }}
                        >
                          Unlink
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {nextTitle && (
              <button
                onClick={linkWithNext}
                style={{
                  width: "100%",
                  background: "#8b5cf6",
                  color: "#fff",
                  border: "none",
                  borderRadius: "10px",
                  padding: "13px",
                  fontSize: "14px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  marginBottom: "14px",
                }}
              >
                Link with next chapter ({nextTitle}) →
              </button>
            )}

            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: C.muted,
                marginBottom: "8px",
              }}
            >
              Or link with another chapter
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                marginBottom: "12px",
              }}
            >
              <select
                value={pickV}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setPickV(v);
                  // D&C (any single-book volume) has no book to pick — auto-pick
                  // its one book, leaving just volume + section.
                  const single = v >= 0 && vols[v].books.length === 1;
                  setPickB(single ? 0 : -1);
                  setPickC(-1);
                }}
                style={{
                  boxSizing: "border-box",
                  width: "100%",
                  padding: "11px 10px",
                  borderRadius: "10px",
                  border: "1px solid " + C.border,
                  background: C.soft,
                  color: C.text,
                  fontSize: "16px",
                  fontFamily: "inherit",
                }}
              >
                <option value={-1}>Choose a volume…</option>
                {vols.map((vol, v) => (
                  <option key={v} value={v}>
                    {vol.volume}
                  </option>
                ))}
              </select>
              {pickVol && pickVol.books.length > 1 && (
                <select
                  value={pickB}
                  onChange={(e) => {
                    setPickB(Number(e.target.value));
                    setPickC(-1);
                  }}
                  style={{
                    boxSizing: "border-box",
                    width: "100%",
                    padding: "11px 10px",
                    borderRadius: "10px",
                    border: "1px solid " + C.border,
                    background: C.soft,
                    color: C.text,
                    fontSize: "16px",
                    fontFamily: "inherit",
                  }}
                >
                  <option value={-1}>Choose a book…</option>
                  {pickVol.books.map((bk, b) => (
                    <option key={b} value={b}>
                      {bk.book}
                    </option>
                  ))}
                </select>
              )}
              <select
                value={pickC}
                disabled={pickB < 0}
                onChange={(e) => setPickC(Number(e.target.value))}
                style={{
                  boxSizing: "border-box",
                  width: "100%",
                  padding: "11px 10px",
                  borderRadius: "10px",
                  border: "1px solid " + C.border,
                  background: C.soft,
                  color: C.text,
                  fontSize: "16px",
                  fontFamily: "inherit",
                  opacity: pickB < 0 ? 0.5 : 1,
                }}
              >
                <option value={-1}>
                  {pickVol && pickVol.books.length === 1
                    ? "Choose a section…"
                    : "Choose a chapter…"}
                </option>
                {pickChapters.map((ch, c) => (
                  <option key={c} value={c}>
                    {ch.chapter}
                  </option>
                ))}
              </select>
            </div>

            {targetScope && targetScope === title && (
              <div
                style={{ fontSize: "13px", color: C.muted, marginBottom: "8px" }}
              >
                That's the chapter you're on — pick a different one.
              </div>
            )}

            {targetScope && targetScope !== title && (
              <div
                style={{
                  border: "1px solid " + C.border,
                  borderRadius: "10px",
                  padding: "12px",
                  marginBottom: "10px",
                }}
              >
                {chapterGroups[targetScope] ? (
                  <div
                    style={{
                      fontSize: "13px",
                      lineHeight: 1.5,
                      marginBottom: previewThemes.length ? "10px" : "0",
                    }}
                  >
                    <strong>{displayOf(targetScope)}</strong> is already linked
                    with{" "}
                    {groupMembers(targetScope)
                      .filter((s) => s !== targetScope)
                      .map((s) => displayOf(s))
                      .join(", ")}
                    .
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: "13px",
                      lineHeight: 1.5,
                      marginBottom: previewThemes.length ? "10px" : "0",
                    }}
                  >
                    Link <strong>{title}</strong> with{" "}
                    <strong>{targetScope}</strong>.
                  </div>
                )}
                {previewThemes.length > 0 && (
                  <>
                    <div
                      style={{
                        fontSize: "11px",
                        color: C.muted,
                        marginBottom: "6px",
                      }}
                    >
                      Themes you'll share:
                    </div>
                    <div
                      style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}
                    >
                      {previewThemes.map((t, i) => (
                        <span
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            fontSize: "13px",
                          }}
                        >
                          <span
                            style={{
                              width: "12px",
                              height: "12px",
                              borderRadius: "50%",
                              backgroundColor: COLOR_MAP[t.color],
                              flexShrink: 0,
                            }}
                          />
                          {t.name}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            <button
              onClick={confirmPick}
              disabled={!targetScope || targetScope === title}
              style={{
                width: "100%",
                background: "#8b5cf6",
                color: "#fff",
                border: "none",
                borderRadius: "10px",
                padding: "13px",
                fontSize: "14px",
                fontWeight: 700,
                cursor:
                  !targetScope || targetScope === title ? "default" : "pointer",
                opacity: !targetScope || targetScope === title ? 0.5 : 1,
                fontFamily: "inherit",
              }}
            >
              {targetScope && chapterGroups[targetScope]
                ? "Add " + title + " to this study"
                : "Link"}
            </button>
          </div>
        )}

      {/* Jump panel */}
      {jumpOpen &&
        sheet(
          () => setJumpOpen(false),
          <div>
            <div style={{ marginBottom: "16px" }}>
              <div
                style={{
                  fontSize: "11px",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: C.muted,
                  marginBottom: "8px",
                }}
              >
                Go to reference
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  value={gotoText}
                  onChange={(e) => {
                    setGotoText(e.target.value);
                    if (gotoErr) setGotoErr(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitGoto();
                  }}
                  placeholder="e.g. Alma 32 or 1 Nephi 3:7"
                  autoCapitalize="words"
                  autoCorrect="off"
                  style={{
                    flex: 1,
                    padding: "12px 14px",
                    borderRadius: "10px",
                    border: "1px solid " + (gotoErr ? "#d9534f" : C.border),
                    backgroundColor: C.bg,
                    color: C.text,
                    fontSize: "16px",
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
                <button
                  onClick={submitGoto}
                  style={{
                    padding: "0 18px",
                    borderRadius: "10px",
                    border: "none",
                    backgroundColor: C.text,
                    color: C.bg,
                    fontSize: "14px",
                    fontWeight: 700,
                    fontFamily: "inherit",
                    flexShrink: 0,
                  }}
                >
                  Go
                </button>
              </div>
              {gotoErr && (
                <div
                  style={{ fontSize: "12px", color: "#d9534f", marginTop: "7px" }}
                >
                  Couldn't find that — try a book and chapter, like "Alma 32".
                </div>
              )}
            </div>
            <JumpPanel
              C={C}
              loc={loc}
              onGo={(nl) => {
                setLoc(nl);
                setJumpOpen(false);
              }}
            />
          </div>
        )}

      {/* Home (full-screen launcher) */}
      {homeOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            backgroundColor: C.bg,
            color: C.text,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            padding:
              "calc(env(safe-area-inset-top) + 30px) 20px calc(env(safe-area-inset-bottom) + 30px)",
            animation: "mob-fadein 0.2s ease",
          }}
        >
          {/* Masthead */}
          <div style={{ textAlign: "center", marginBottom: "24px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: "14px",
              }}
            >
              <ScribalMark size={68} />
            </div>
            <div
              style={{
                fontFamily: '"Times New Roman", Times, serif',
                fontSize: "30px",
                fontWeight: 700,
                letterSpacing: "0.16em",
                color: C.text,
              }}
            >
              SCRIBAL
            </div>
            <div
              style={{
                fontSize: "11px",
                letterSpacing: "0.2em",
                color: C.muted,
                marginTop: "5px",
                textTransform: "uppercase",
              }}
            >
              A place to study scripture
            </div>
          </div>

          {/* Continue reading — hero */}
          <button
            data-tour="m-continue"
            onClick={() => setHomeOpen(false)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              background: C.panel,
              border: "1px solid " + C.border,
              borderLeft: "4px solid #8b5cf6",
              borderRadius: "16px",
              padding: "18px",
              marginBottom: "14px",
              color: C.text,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: C.muted,
                marginBottom: "7px",
              }}
            >
              Continue reading
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  fontFamily: '"Times New Roman", Times, serif',
                  fontSize: "23px",
                  fontWeight: 700,
                }}
              >
                {displayTitle}
              </span>
              <span
                style={{ marginLeft: "auto", color: "#8b5cf6", fontSize: "22px" }}
              >
                →
              </span>
            </div>
          </button>

          {/* Grid: Browse / Compile / Vault / Search */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "12px",
              marginBottom: "14px",
            }}
          >
            {homeTile(
              "Browse books",
              "Pick a book or chapter",
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4H11v15H4.5A1.5 1.5 0 0 1 3 17.5z" />
                <path d="M21 5.5A1.5 1.5 0 0 0 19.5 4H13v15h6.5a1.5 1.5 0 0 0 1.5-1.5z" />
              </svg>,
              () => {
                setHomeOpen(false);
                setJumpOpen(true);
              }
            )}
            {homeTile(
              "Studies",
              "Every study you've done",
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3 3 8l9 5 9-5z" />
                <path d="M3 13l9 5 9-5" />
              </svg>,
              () => {
                setHomeOpen(false);
                setStudiesOpen(true);
              }
            )}
            {homeTile(
              "Vault",
              (() => {
                const n = books.filter((b) => !b.isMaster).length;
                return n === 1 ? "1 session book" : n + " session books";
              })(),
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="4" y="10" width="16" height="10" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>,
              () => {
                setHomeOpen(false);
                setVaultOpen(true);
              }
            )}
            {homeTile(
              "Search",
              "Scripture & your marks",
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.35-4.35" />
              </svg>,
              () => {
                setHomeOpen(false);
                setSearchOpen(true);
              }
            )}
            {homeTile(
              "Gestures & marking",
              "How to mark & navigate",
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8 10V5.5a2 2 0 1 1 4 0V10" />
                <path d="M12 10V8a2 2 0 1 1 4 0v6a6 6 0 0 1-6 6h-1a6 6 0 0 1-5.2-3L3 14.5a1.8 1.8 0 0 1 3.1-1.8L8 15" />
              </svg>,
              () => {
                setHomeOpen(false);
                setGesturesOpen(true);
              }
            )}
            {homeTile(
              "Features guide",
              "Learn each feature in depth",
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M15.5 8.5l-2.2 4.8-4.8 2.2 2.2-4.8z" />
              </svg>,
              () => {
                setHomeOpen(false);
                setGuideOpen(true);
              }
            )}
          </div>

          {/* Study books — slim row (the study-book switcher) */}
          <button
            onClick={() => {
              setHomeOpen(false);
              setMenuOpen(true);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              width: "100%",
              textAlign: "left",
              background: "transparent",
              border: "1px solid " + C.border,
              borderRadius: "12px",
              padding: "13px 14px",
              marginBottom: "12px",
              color: C.text,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "14px",
              fontWeight: 600,
            }}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="4" y="4" width="16" height="6" rx="1.5" />
              <rect x="4" y="14" width="16" height="6" rx="1.5" />
            </svg>
            Study books
            <span style={{ flex: 1 }} />
            <span style={{ color: C.muted, fontSize: "12px", fontWeight: 400 }}>
              {books.find((b) => b.id === activeBookId)?.name || "Master Book"}
            </span>
          </button>

          {/* Settings — slim row */}
          <button
            data-tour="m-settings"
            onClick={() => {
              setHomeOpen(false);
              setSettingsOpen(true);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              width: "100%",
              textAlign: "left",
              background: "transparent",
              border: "1px solid " + C.border,
              borderRadius: "12px",
              padding: "13px 14px",
              color: C.text,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "14px",
              fontWeight: 600,
            }}
          >
            <span style={{ fontSize: "16px" }}>⚙</span>
            Settings
            <span style={{ flex: 1 }} />
            <span style={{ color: C.muted, fontSize: "12px", fontWeight: 400 }}>
              {connected ? "synced" : "sync & theme"}
            </span>
          </button>
        </div>
      )}

      {/* Menu (book switch) */}
      {menuOpen &&
        sheet(
          () => setMenuOpen(false),
          <div>

            <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "4px" }}>
              Study books
            </div>
            <div style={{ fontSize: "12px", color: C.muted, marginBottom: "14px" }}>
              One book open at a time on mobile.
            </div>
            {books.map((b) => {
              const active = b.id === activeBookId;
              return (
                <div
                  key={b.id}
                  style={{
                    display: "flex",
                    alignItems: "stretch",
                    gap: "6px",
                    marginBottom: "8px",
                  }}
                >
                  <button
                    onClick={() => {
                      setActiveBook(b.id);
                      setMenuOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      flex: 1,
                      minWidth: 0,
                      textAlign: "left",
                      background: active ? C.soft : "transparent",
                      border: "1px solid " + C.border,
                      borderRadius: "10px",
                      padding: "12px 14px",
                      color: C.text,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    <span style={{ color: active ? C.text : C.muted }}>
                      {active ? "●" : "○"}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: "14px",
                        fontWeight: active ? 600 : 400,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {b.name}
                      {b.isMaster && (
                        <span style={{ color: C.muted, fontSize: "11px" }}>
                          {" "}
                          · default
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: "11px", color: C.muted }}>
                      {b.markCount}
                    </span>
                  </button>
                  {!b.isMaster && (
                    <button
                      onClick={() => closeSession(b.id, b.name, b.markCount)}
                      aria-label={"Close " + b.name}
                      style={{
                        width: "44px",
                        flexShrink: 0,
                        background: "transparent",
                        border: "1px solid " + C.border,
                        borderRadius: "10px",
                        color: C.muted,
                        fontSize: "20px",
                        lineHeight: 1,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
            <button
              onClick={() => {
                const id = createSession(
                  "Session · " +
                    new Date().toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })
                );
                setActiveBook(id);
                setMenuOpen(false);
              }}
              style={{
                width: "100%",
                background: "transparent",
                border: "1px dashed " + C.border,
                borderRadius: "10px",
                padding: "12px",
                color: C.muted,
                cursor: "pointer",
                fontSize: "13px",
                fontFamily: "inherit",
                marginBottom: "12px",
              }}
            >
              + New session
            </button>
          </div>
        )}

      {/* Gestures cheat sheet */}
      {gesturesOpen &&
        sheet(
          () => setGesturesOpen(false),
          (() => {
            const row = (icon: string, name: string, desc: string) => (
              <div
                key={name}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "14px",
                  padding: "13px 0",
                  borderBottom: "1px solid " + C.border,
                }}
              >
                <span
                  style={{
                    fontSize: "20px",
                    width: "30px",
                    textAlign: "center",
                    flexShrink: 0,
                    lineHeight: 1.3,
                  }}
                >
                  {icon}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "14px", fontWeight: 600 }}>{name}</div>
                  <div
                    style={{
                      fontSize: "12.5px",
                      color: C.muted,
                      marginTop: "2px",
                      lineHeight: 1.5,
                    }}
                  >
                    {desc}
                  </div>
                </div>
              </div>
            );
            return (
              <div>
                <div
                  style={{ fontSize: "18px", fontWeight: 700, marginBottom: "4px" }}
                >
                  Gestures
                </div>
                <div
                  style={{
                    fontSize: "12px",
                    color: C.muted,
                    marginBottom: "8px",
                  }}
                >
                  Everything you can do while reading.
                </div>
                {row("👆", "Tap a word", "Marks it in your armed pen. Tap it again to remove it.")}
                {row("↔", "Swipe sideways across words", "Marks the whole phrase you drag over.")}
                {row("↕", "Swipe up or down", "Scrolls — your marks stay put.")}
                {row("✌", "Two-finger tap", "Undoes your last mark.")}
                {row("⊙", "Double-tap a mark", "Edit its edges — tap words to extend or trim, then Done.")}
                {row("⏱", "Long-press a mark", "Opens manage — recolor, copy, or erase it.")}
                {row("✎", "Long-press plain text", "Starts a deliberate phrase selection.")}
                <div
                  style={{
                    fontSize: "12px",
                    color: C.muted,
                    marginTop: "14px",
                    lineHeight: 1.55,
                  }}
                >
                  Tip: the pen pill at the bottom always shows your armed color,
                  theme, and which study book you're marking into.
                </div>
                <div
                  style={{
                    fontSize: "12px",
                    color: C.muted,
                    marginTop: "10px",
                    lineHeight: 1.55,
                    fontWeight: 600,
                  }}
                >
                  You can reopen this anytime from Settings.
                </div>
              </div>
            );
          })()
        )}

      {/* Settings */}
      {settingsOpen &&
        sheet(
          () => setSettingsOpen(false),
          (() => {
            const label = (t: string) => (
              <div
                style={{
                  fontSize: "11px",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: C.muted,
                  margin: "18px 0 10px",
                }}
              >
                {t}
              </div>
            );
            const actionBtn = (
              text: string,
              onClick: () => void,
              opts?: { primary?: boolean; disabled?: boolean }
            ) => (
              <button
                onClick={onClick}
                disabled={opts?.disabled}
                style={{
                  width: "100%",
                  padding: "13px",
                  borderRadius: "10px",
                  border: opts?.primary ? "none" : "1px solid " + C.border,
                  backgroundColor: opts?.primary ? C.text : "transparent",
                  color: opts?.primary ? C.bg : C.text,
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: opts?.disabled ? "default" : "pointer",
                  opacity: opts?.disabled ? 0.5 : 1,
                  fontFamily: "inherit",
                  marginBottom: "8px",
                }}
              >
                {text}
              </button>
            );
            return (
              <div>
                <div style={{ fontSize: "16px", fontWeight: 700 }}>Settings</div>

                {label("Sync")}
                {cloudSignedIn ? (
                  <>
                    <div
                      style={{
                        fontSize: "14px",
                        marginBottom: "10px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <span style={{ color: COLOR_MAP[4] }}>●</span>
                      {cloudSyncing
                        ? "Syncing…"
                        : "Synced" + (cloudEmail ? " · " + cloudEmail : "")}
                    </div>
                    {actionBtn("Sign out", () => {
                      signOutCloud().catch(() => {});
                    })}
                  </>
                ) : (
                  <>
                    {actionBtn(
                      "Sign in with Google",
                      () => {
                        cloudSignIn().catch(() => {});
                      },
                      { primary: true }
                    )}
                    <div
                      style={{
                        fontSize: "12px",
                        color: C.muted,
                        lineHeight: 1.5,
                        marginTop: "6px",
                      }}
                    >
                      Sign in once and your study stays in sync across every
                      device automatically — no “sync now” to remember, and it
                      keeps working offline.
                    </div>
                  </>
                )}
                {SHOW_LEGACY_DRIVE && (connected ? (
                  <>
                    <div
                      style={{
                        fontSize: "14px",
                        marginBottom: "10px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <span style={{ color: COLOR_MAP[4] }}>●</span>
                      Connected to Google Drive
                    </div>
                    {actionBtn(syncBusy ? "Saving…" : "Sync now", syncNow, {
                      primary: true,
                      disabled: syncBusy,
                    })}
                    {actionBtn("Check sync", runDiag)}
                    {diag && (
                      <div
                        style={{
                          fontSize: "12px",
                          color: C.text,
                          marginTop: "8px",
                          whiteSpace: "pre-line",
                          fontFamily: "monospace",
                          background: C.soft,
                          borderRadius: "8px",
                          padding: "10px 12px",
                        }}
                      >
                        {diag}
                      </div>
                    )}
                    {actionBtn("Sign out", signOutDrive)}
                  </>
                ) : (
                  <>
                    {actionBtn(
                      syncBusy ? "Connecting…" : "Sync with Google",
                      driveConnect,
                      { primary: true, disabled: syncBusy || !DRIVE_CONFIGURED }
                    )}
                    <div
                      style={{
                        fontSize: "12px",
                        color: C.muted,
                        lineHeight: 1.5,
                      }}
                    >
                      Or keep studying on this device — your marks are always
                      saved here, and you can connect later.
                    </div>
                    {!DRIVE_CONFIGURED && (
                      <div
                        style={{
                          fontSize: "12px",
                          color: C.muted,
                          marginTop: "8px",
                        }}
                      >
                        Google sync isn't configured for this build yet.
                      </div>
                    )}
                  </>
                ))}
                {syncMsg && (
                  <div
                    style={{
                      fontSize: "12px",
                      color: C.muted,
                      marginTop: "10px",
                    }}
                  >
                    {syncMsg}
                  </div>
                )}

                {label("Appearance")}
                {actionBtn(dark ? "Switch to light" : "Switch to dark", () => {
                  const next = !dark;
                  setDark(next);
                  localStorage.setItem("scribal_theme", next ? "dark" : "light");
                })}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 0",
                  }}
                >
                  <span style={{ fontSize: "14px", fontWeight: 600 }}>
                    Mark color
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <button
                      disabled={colorIntensity <= 0.6}
                      onClick={() =>
                        setColorIntensity((v) => Math.max(0.6, +(v - 0.1).toFixed(2)))
                      }
                      style={{
                        width: "38px",
                        height: "38px",
                        borderRadius: "9px",
                        border: "1px solid " + C.border,
                        background: "transparent",
                        color: C.text,
                        fontSize: "17px",
                        fontWeight: 700,
                        fontFamily: "inherit",
                        opacity: colorIntensity <= 0.6 ? 0.4 : 1,
                      }}
                    >
                      −
                    </button>
                    <span
                      style={{
                        minWidth: "62px",
                        textAlign: "center",
                        fontSize: "13px",
                        color: C.muted,
                      }}
                    >
                      {colorIntensity <= 0.65
                        ? "Soft"
                        : colorIntensity >= 1.45
                        ? "Bold"
                        : Math.round(colorIntensity * 100) + "%"}
                    </span>
                    <button
                      disabled={colorIntensity >= 1.5}
                      onClick={() =>
                        setColorIntensity((v) => Math.min(1.5, +(v + 0.1).toFixed(2)))
                      }
                      style={{
                        width: "38px",
                        height: "38px",
                        borderRadius: "9px",
                        border: "1px solid " + C.border,
                        background: "transparent",
                        color: C.text,
                        fontSize: "17px",
                        fontWeight: 700,
                        fontFamily: "inherit",
                        opacity: colorIntensity >= 1.5 ? 0.4 : 1,
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "6px", padding: "0 0 4px 0" }}>
                  {[1, 2, 3, 4, 5, 6, 7].map((c) => (
                    <div
                      key={c}
                      style={{
                        flex: 1,
                        height: "18px",
                        borderRadius: "4px",
                        backgroundColor: markVars["--hl" + c],
                        border: "1px solid " + C.border,
                      }}
                    />
                  ))}
                </div>

                {label("Reading")}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 0",
                  }}
                >
                  <span style={{ fontSize: "14px", fontWeight: 600 }}>Text size</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <button
                      disabled={reading.fontScale <= 0.8}
                      onClick={() =>
                        setReading((r) => ({
                          ...r,
                          fontScale: Math.max(0.8, +(r.fontScale - 0.1).toFixed(2)),
                        }))
                      }
                      style={{
                        width: "38px",
                        height: "38px",
                        borderRadius: "9px",
                        border: "1px solid " + C.border,
                        background: "transparent",
                        color: C.text,
                        fontSize: "15px",
                        fontWeight: 700,
                        fontFamily: "inherit",
                        opacity: reading.fontScale <= 0.8 ? 0.4 : 1,
                      }}
                    >
                      A−
                    </button>
                    <span
                      style={{
                        minWidth: "46px",
                        textAlign: "center",
                        fontSize: "13px",
                        color: C.muted,
                      }}
                    >
                      {Math.round(reading.fontScale * 100)}%
                    </span>
                    <button
                      disabled={reading.fontScale >= 1.7}
                      onClick={() =>
                        setReading((r) => ({
                          ...r,
                          fontScale: Math.min(1.7, +(r.fontScale + 0.1).toFixed(2)),
                        }))
                      }
                      style={{
                        width: "38px",
                        height: "38px",
                        borderRadius: "9px",
                        border: "1px solid " + C.border,
                        background: "transparent",
                        color: C.text,
                        fontSize: "17px",
                        fontWeight: 700,
                        fontFamily: "inherit",
                        opacity: reading.fontScale >= 1.7 ? 0.4 : 1,
                      }}
                    >
                      A+
                    </button>
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 0",
                  }}
                >
                  <span style={{ fontSize: "14px", fontWeight: 600 }}>
                    Line spacing
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <button
                      disabled={reading.lineScale <= 1.5}
                      onClick={() =>
                        setReading((r) => ({
                          ...r,
                          lineScale: Math.max(1.5, +(r.lineScale - 0.15).toFixed(2)),
                        }))
                      }
                      style={{
                        width: "38px",
                        height: "38px",
                        borderRadius: "9px",
                        border: "1px solid " + C.border,
                        background: "transparent",
                        color: C.text,
                        fontSize: "17px",
                        fontWeight: 700,
                        fontFamily: "inherit",
                        opacity: reading.lineScale <= 1.5 ? 0.4 : 1,
                      }}
                    >
                      −
                    </button>
                    <span
                      style={{
                        minWidth: "58px",
                        textAlign: "center",
                        fontSize: "13px",
                        color: C.muted,
                      }}
                    >
                      {reading.lineScale <= 1.6
                        ? "Tight"
                        : reading.lineScale <= 1.95
                        ? "Normal"
                        : reading.lineScale <= 2.15
                        ? "Relaxed"
                        : "Airy"}
                    </span>
                    <button
                      disabled={reading.lineScale >= 2.3}
                      onClick={() =>
                        setReading((r) => ({
                          ...r,
                          lineScale: Math.min(2.3, +(r.lineScale + 0.15).toFixed(2)),
                        }))
                      }
                      style={{
                        width: "38px",
                        height: "38px",
                        borderRadius: "9px",
                        border: "1px solid " + C.border,
                        background: "transparent",
                        color: C.text,
                        fontSize: "17px",
                        fontWeight: 700,
                        fontFamily: "inherit",
                        opacity: reading.lineScale >= 2.3 ? 0.4 : 1,
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
                {actionBtn(
                  reading.warm ? "Warm tone: on" : "Warm tone: off",
                  () => setReading((r) => ({ ...r, warm: !r.warm }))
                )}

                {label("Help")}
                {actionBtn("Gestures & marking guide", () => {
                  setSettingsOpen(false);
                  setGesturesOpen(true);
                })}
                {actionBtn("Replay the welcome tour", resetIntro)}

                {label("About")}
                <div
                  style={{ fontSize: "12px", color: C.muted, lineHeight: 1.6 }}
                >
                  On desktop, Scribal opens up into the full workbench:
                  side-by-side study, every compile view, and the Vault. Your
                  marks stay in step across desktop and phone whenever you're
                  signed in.
                </div>
                <button
                  onClick={() => {
                    setSettingsOpen(false);
                    setHomeOpen(true);
                    setMtourOpen(true);
                  }}
                  style={{
                    width: "100%",
                    marginTop: "14px",
                    padding: "12px",
                    borderRadius: "10px",
                    border: "1px solid " + C.border,
                    background: "transparent",
                    color: C.text,
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Show the tour again
                </button>
              </div>
            );
          })()
        )}

      {/* Search (full-height so the input stays above the keyboard) */}
      {searchOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 200,
            backgroundColor: C.bg,
            color: C.text,
            display: "flex",
            flexDirection: "column",
            animation: "mob-fadein 0.18s ease",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: addToStudyId ? "space-between" : "flex-end",
              alignItems: "center",
              gap: "8px",
              padding: "calc(env(safe-area-inset-top) + 8px) 12px 6px",
            }}
          >
            {addToStudyId && (
              <div
                style={{
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#0d9488"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
                  <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
                </svg>
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    color: C.text,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  Add to “
                  {searchStudies.find((s) => s.id === addToStudyId)?.name ||
                    "study"}
                  ”
                </span>
              </div>
            )}
            <button
              onClick={() => {
                setSearchOpen(false);
                if (addToStudyId) {
                  const id = addToStudyId;
                  setAddToStudyId(null);
                  setOpenStudyId(id);
                }
              }}
              aria-label="Close search"
              style={{
                background: "transparent",
                border: "none",
                color: C.muted,
                fontSize: "22px",
                lineHeight: 1,
                cursor: "pointer",
                fontFamily: "inherit",
                padding: "4px 8px",
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
              padding: "0 18px calc(env(safe-area-inset-bottom) + 18px)",
            }}
          >
            <MobileSearch
              C={C}
              marks={marks}
              markLabel={effLabel}
              orderOf={orderOf}
              onJump={jumpToRef}
              onPickScripture={(ref) => setChooseRef(ref)}
              onLinkConfirm={onLinkConfirm}
              initialPicked={
                addToStudyId
                  ? searchStudies.find((s) => s.id === addToStudyId)?.refs || []
                  : undefined
              }
              startLinking={!!addToStudyId}
              confirmLabel={addToStudyId ? "Add to study" : undefined}
            />
          </div>
        </div>
      )}

      {/* New search study — choose where marks live + name it */}
      {linkDraftRefs && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 240,
            backgroundColor: C.bg,
            color: C.text,
            display: "flex",
            flexDirection: "column",
            animation: "mob-fadein 0.18s ease",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "calc(env(safe-area-inset-top) + 10px) 12px 10px",
              borderBottom: "1px solid " + C.border,
            }}
          >
            <button
              onClick={cancelDraft}
              aria-label="Cancel"
              style={{
                width: "38px",
                height: "38px",
                background: "transparent",
                border: "none",
                color: C.text,
                fontSize: "22px",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              ‹
            </button>
            <div style={{ fontSize: "17px", fontWeight: 700 }}>New study</div>
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
              padding: "16px 18px",
            }}
          >
            <div
              style={{ fontSize: "13px", color: C.muted, marginBottom: "18px" }}
            >
              {linkDraftRefs.length} verse
              {linkDraftRefs.length === 1 ? "" : "s"} selected
            </div>

            <div
              style={{ fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}
            >
              Study name
            </div>
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="e.g. If–Then promises"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "12px",
                fontSize: "16px",
                borderRadius: "10px",
                border: "1px solid " + C.border,
                backgroundColor: C.bg,
                color: C.text,
                fontFamily: "inherit",
                marginBottom: "22px",
              }}
            />

            <div
              style={{ fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}
            >
              Where should the marks live?
            </div>
            <div style={{ display: "flex", gap: "8px", marginBottom: "6px" }}>
              {(["master", "session"] as const).map((src) => {
                const on = draftSource === src;
                return (
                  <button
                    key={src}
                    onClick={() => setDraftSource(src)}
                    style={{
                      flex: 1,
                      padding: "12px",
                      borderRadius: "10px",
                      border: "1px solid " + (on ? C.text : C.border),
                      background: on ? C.text : "transparent",
                      color: on ? C.bg : C.text,
                      fontFamily: "inherit",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {src === "master" ? "Master book" : "Session book"}
                  </button>
                );
              })}
            </div>
            <div
              style={{ fontSize: "11px", color: C.muted, marginBottom: "16px" }}
            >
              {draftSource === "master"
                ? "Marks join your main study and show when you read these chapters."
                : "Marks stay in a separate book, apart from your main study."}
            </div>

            {draftSource === "session" && (
              <div style={{ marginBottom: "8px" }}>
                {books
                  .filter((b) => b.id !== "master")
                  .map((b) => {
                    const on = draftSessionId === b.id;
                    return (
                      <button
                        key={b.id}
                        onClick={() => setDraftSessionId(b.id)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "11px 13px",
                          marginBottom: "8px",
                          borderRadius: "10px",
                          border: "1px solid " + (on ? C.text : C.border),
                          background: on ? C.soft : "transparent",
                          color: C.text,
                          fontFamily: "inherit",
                          fontSize: "14px",
                          cursor: "pointer",
                        }}
                      >
                        {b.name}
                      </button>
                    );
                  })}
                <button
                  onClick={() => setDraftSessionId("")}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "11px 13px",
                    marginBottom: "8px",
                    borderRadius: "10px",
                    border:
                      "1px solid " + (draftSessionId === "" ? C.text : C.border),
                    background: draftSessionId === "" ? C.soft : "transparent",
                    color: C.text,
                    fontFamily: "inherit",
                    fontSize: "14px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  + New book…
                </button>
                {draftSessionId === "" && (
                  <input
                    value={draftNewName}
                    onChange={(e) => setDraftNewName(e.target.value)}
                    placeholder="New book name (optional)"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "11px",
                      fontSize: "16px",
                      borderRadius: "10px",
                      border: "1px solid " + C.border,
                      backgroundColor: C.bg,
                      color: C.text,
                      fontFamily: "inherit",
                    }}
                  />
                )}
              </div>
            )}
          </div>

          <div
            style={{
              padding: "12px 18px calc(14px + env(safe-area-inset-bottom))",
              borderTop: "1px solid " + C.border,
            }}
          >
            <button
              onClick={createStudyFromDraft}
              disabled={!draftName.trim()}
              style={{
                width: "100%",
                padding: "14px",
                borderRadius: "12px",
                border: "none",
                background: draftName.trim() ? C.text : C.soft,
                color: draftName.trim() ? C.bg : C.muted,
                fontFamily: "inherit",
                fontSize: "15px",
                fontWeight: 700,
                cursor: draftName.trim() ? "pointer" : "default",
              }}
            >
              Create study
            </button>
          </div>
        </div>
      )}

      {/* Search-study screen — list the picked verses and mark them */}
      {openStudyId &&
        (() => {
          const study = searchStudies.find((s) => s.id === openStudyId);
          if (!study) return null;
          const VI = verseByRef();
          const bookName =
            books.find((b) => b.id === study.bookId)?.name || "Master Book";
          return (
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 250,
                backgroundColor: C.bg,
                color: C.text,
                display: "flex",
                flexDirection: "column",
                animation: "mob-fadein 0.18s ease",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "calc(env(safe-area-inset-top) + 10px) 12px 10px",
                  borderBottom: "1px solid " + C.border,
                }}
              >
                <button
                  onClick={closeStudy}
                  aria-label="Back"
                  style={{
                    width: "38px",
                    height: "38px",
                    background: "transparent",
                    border: "none",
                    color: C.text,
                    fontSize: "22px",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  ‹
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                      fontSize: "10.5px",
                      fontWeight: 700,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      color: "#0d9488",
                      marginBottom: "2px",
                    }}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#0d9488"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
                      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
                    </svg>
                    Keyword study
                  </div>
                  <div
                    style={{
                      fontSize: "16px",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {study.name}
                  </div>
                  <div style={{ fontSize: "11px", color: C.muted }}>
                    {study.refs.length} verses · {bookName}
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        "Delete this study? Your marks stay in the book."
                      )
                    )
                      deleteSearchStudy(study.id);
                  }}
                  aria-label="Delete study"
                  style={{
                    width: "38px",
                    height: "38px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  <IconTrash color={C.muted} />
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  padding: "10px 14px",
                  borderBottom: "1px solid " + C.border,
                }}
              >
                <button
                  onClick={() => {
                    setAddToStudyId(study.id);
                    setOpenStudyId(null);
                    setSearchOpen(true);
                  }}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "7px",
                    padding: "10px",
                    borderRadius: "999px",
                    border: "1px solid " + C.border,
                    background: "transparent",
                    color: C.text,
                    fontFamily: "inherit",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#0d9488"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
                    <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
                  </svg>
                  Add verses
                </button>
                <button
                  onClick={() => {
                    setCompileStudy(study);
                    setCompileOpen(true);
                  }}
                  style={{
                    flex: 1,
                    padding: "10px",
                    borderRadius: "999px",
                    border: "none",
                    background: C.text,
                    color: C.bg,
                    fontFamily: "inherit",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Compile
                </button>
              </div>

              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  WebkitOverflowScrolling: "touch",
                  padding: "16px 18px 0",
                }}
              >
                <div
                  style={{
                    fontFamily: '"Times New Roman", Times, serif',
                    fontSize: verseSize,
                    lineHeight: reading.lineScale,
                    userSelect: "none",
                    WebkitUserSelect: "none",
                  }}
                >
                  {study.refs.map((ref) => {
                    const vi = VI.get(ref);
                    if (!vi) return null;
                    return (
                      <div key={ref} style={{ marginBottom: "16px" }}>
                        <div
                          style={{
                            fontFamily:
                              "system-ui, -apple-system, sans-serif",
                            fontSize: "11px",
                            color: C.muted,
                            marginBottom: "3px",
                          }}
                        >
                          {ref}
                        </div>
                        <MobileVerse
                          reference={ref}
                          verseNumber={vi.verse}
                          text={vi.text}
                          marks={marks}
                          selBg={selBg}
                          onTap={onTap}
                          onRange={onRange}
                          onManage={onManage}
                          editMarkId={
                            editMark && editMark.reference === ref
                              ? editMark.id
                              : null
                          }
                          editingActive={!!editMark}
                          onEnterEdit={onEnterEdit}
                          onAdjust={onAdjust}
                        />
                      </div>
                    );
                  })}
                </div>
                <div style={{ height: "24px" }} />
              </div>

              {/* Compact pen bar */}
              <div
                style={{
                  padding: "10px 14px calc(10px + env(safe-area-inset-bottom))",
                  borderTop: "1px solid " + C.border,
                  background: C.panel,
                }}
              >
                <div
                  style={{ display: "flex", gap: "8px", marginBottom: "8px" }}
                >
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setPen((p) => ({ ...p, color: c }))}
                      aria-label={"Color " + c}
                      style={{
                        flex: 1,
                        height: "30px",
                        borderRadius: "8px",
                        background:
                          pen.tool === "highlight"
                            ? HIGHLIGHT_MAP[c]
                            : COLOR_MAP[c],
                        border:
                          pen.color === c
                            ? "2px solid " + C.text
                            : "1px solid " + C.border,
                        cursor: "pointer",
                      }}
                    />
                  ))}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                  }}
                >
                  {STYLE_LABELS.map((s) => {
                    const on = pen.tool === s.tool;
                    return (
                      <button
                        key={s.tool}
                        onClick={() => setPen((p) => ({ ...p, tool: s.tool }))}
                        aria-label={s.label}
                        title={s.label}
                        style={{
                          flex: 1,
                          height: "30px",
                          borderRadius: "8px",
                          border: "1px solid " + (on ? C.text : C.border),
                          background: on ? C.text : "transparent",
                          color: on ? C.bg : C.text,
                          fontSize: "13px",
                          fontWeight: 700,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {s.label.charAt(0)}
                      </button>
                    );
                  })}
                </div>

                {/* Name the armed color's theme — for this study's palette */}
                {!isEraser && (
                  <>
                    <button
                      onClick={() => setPenOpen((o) => !o)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        width: "100%",
                        background: "transparent",
                        border: "none",
                        padding: "10px 0 0",
                        cursor: "pointer",
                        color: C.text,
                        fontFamily: "inherit",
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
                        {(
                          scopedLabels["searchstudy:" + study.id]?.[
                            pen.color
                          ] || ""
                        ).trim()
                          ? "Theme: " +
                            (
                              scopedLabels["searchstudy:" + study.id]?.[
                                pen.color
                              ] || ""
                            ).trim()
                          : "Name this theme"}
                      </span>
                      <span style={{ color: C.muted, fontSize: "13px" }}>
                        {penOpen ? "▾" : "▴"}
                      </span>
                    </button>
                    {penOpen && (
                      <input
                        value={
                          scopedLabels["searchstudy:" + study.id]?.[
                            pen.color
                          ] || ""
                        }
                        onChange={(e) =>
                          setScopedLabel(
                            "searchstudy:" + study.id,
                            pen.color,
                            e.target.value
                          )
                        }
                        placeholder={
                          "Name color " + pen.color + " (e.g. Covenant)"
                        }
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          marginTop: "8px",
                          padding: "10px 12px",
                          fontSize: "16px",
                          borderRadius: "10px",
                          border: "1px solid " + C.border,
                          backgroundColor: C.bg,
                          color: C.text,
                          fontFamily: "inherit",
                        }}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })()}

      {/* Studies screen — every study done, grouped by type (live) */}
      {studiesOpen &&
        (() => {
          const bookMarksOf = (bid: string) =>
            allMarks.filter((m) => m.bookId === bid);
          const bookLabel = (bid: string) =>
            bid === "master"
              ? ""
              : books.find((b) => b.id === bid)?.name || "Session";
          const liveStudies = studies.filter((s) => !isStudyDeleted(s));
          const liveSearch = searchStudies.filter((s) => !isSearchDeleted(s));
          const chapterRecs = liveStudies.filter((s) => s.type === "chapter");
          const linkedRecs = liveStudies.filter((s) => s.type === "linked");
          const countChapter = (s: Study) =>
            bookMarksOf(s.bookId).filter(
              (m) => scopeOf(m.reference) === s.scopeRef
            ).length;
          const countLinked = (s: Study) => {
            const chs = Object.keys(chapterGroups).filter(
              (c) => chapterGroups[c] === s.scopeRef
            );
            return bookMarksOf(s.bookId).filter((m) =>
              chs.includes(scopeOf(m.reference))
            ).length;
          };
          const countSearch = (ss: SearchStudy) =>
            bookMarksOf(ss.bookId).filter((m) => ss.refs.includes(m.reference))
              .length;
          // Distinct theme colors used in a study, each with its name — read
          // from the study's OWN book so names are right even when a different
          // book is active (per-chapter name first, then the book-wide name).
          const themesFor = (
            bid: string,
            repScope: string,
            refOk: (ref: string) => boolean
          ) => {
            const bk = getBook(bid);
            const scoped = bk.scopedLabels[resolveScope(repScope)];
            const nameFor = (c: MarkColor) => {
              if (scoped && c in scoped) return (scoped[c] || "").trim();
              return (bk.colorLabels[c] || "").trim();
            };
            const cols: number[] = [];
            allMarks.forEach((m) => {
              if (
                m.bookId === bid &&
                refOk(m.reference) &&
                cols.indexOf(m.color) < 0
              )
                cols.push(m.color);
            });
            return cols
              .sort((a, b) => a - b)
              .map((c) => ({ color: c, name: nameFor(c as MarkColor) }));
          };
          // The expandable "more info" panel: what the study covers + its themes.
          const detail = (
            onWhat: string,
            themes: { color: number; name: string }[]
          ) => (
            <div
              style={{
                padding: "0 8px 12px 21px",
                fontSize: "12px",
                color: C.muted,
                lineHeight: 1.5,
              }}
            >
              <div>
                <span style={{ fontWeight: 700, color: C.text }}>On </span>
                {onWhat}
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "8px",
                  marginTop: "7px",
                  alignItems: "center",
                }}
              >
                <span style={{ fontWeight: 700, color: C.text }}>Themes</span>
                {themes.length === 0 ? (
                  <span>nothing marked yet</span>
                ) : (
                  themes.map((t) => (
                    <span
                      key={t.color}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                      }}
                    >
                      <span
                        style={{
                          width: "10px",
                          height: "10px",
                          borderRadius: "50%",
                          background: COLOR_MAP[t.color as MarkColor],
                          flexShrink: 0,
                        }}
                      />
                      {t.name || "Unnamed"}
                    </span>
                  ))
                )}
              </div>
            </div>
          );
          const total =
            chapterRecs.length + linkedRecs.length + liveSearch.length;

          const row = (
            key: string,
            name: string,
            meta: string,
            accent: string,
            onOpen: () => void,
            onDelete: () => void,
            icon?: React.ReactNode,
            info?: React.ReactNode,
            expanded?: boolean,
            onInfo?: () => void
          ) => (
            <div key={key} style={{ borderTop: "1px solid " + C.border }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <button
                  onClick={onOpen}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    padding: "12px 2px",
                    color: C.text,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {icon ? (
                    <span style={{ display: "inline-flex", flexShrink: 0 }}>
                      {icon}
                    </span>
                  ) : (
                    <span
                      style={{
                        width: "9px",
                        height: "9px",
                        borderRadius: "50%",
                        background: accent,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: "13.5px",
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {name}
                    </span>
                    <span style={{ fontSize: "11.5px", color: C.muted }}>
                      {meta}
                    </span>
                  </span>
                </button>
                {onInfo && (
                  <button
                    onClick={onInfo}
                    aria-label="Study details"
                    style={{
                      width: "36px",
                      height: "40px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    <IconInfo color={expanded ? accent : C.muted} />
                  </button>
                )}
                <button
                  onClick={onDelete}
                  aria-label="Delete study"
                  style={{
                    width: "40px",
                    height: "40px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  <IconTrash color={C.muted} />
                </button>
              </div>
              {expanded && info}
            </div>
          );

          const section = (
            title: string,
            accent: string,
            rows: React.ReactNode
          ) => (
            <div style={{ marginBottom: "20px" }}>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  color: C.muted,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: "2px",
                }}
              >
                {title}
              </div>
              {rows}
            </div>
          );

          return (
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 250,
                backgroundColor: C.bg,
                color: C.text,
                display: "flex",
                flexDirection: "column",
                animation: "mob-fadein 0.18s ease",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "calc(env(safe-area-inset-top) + 10px) 12px 10px",
                  borderBottom: "1px solid " + C.border,
                }}
              >
                <button
                  onClick={() => setStudiesOpen(false)}
                  aria-label="Back"
                  style={{
                    width: "38px",
                    height: "38px",
                    background: "transparent",
                    border: "none",
                    color: C.text,
                    fontSize: "22px",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  ‹
                </button>
                <div style={{ fontSize: "17px", fontWeight: 700 }}>Studies</div>
              </div>

              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  WebkitOverflowScrolling: "touch",
                  padding: "16px 18px calc(20px + env(safe-area-inset-bottom))",
                }}
              >
                {total === 0 ? (
                  <div
                    style={{
                      fontSize: "13px",
                      color: C.muted,
                      lineHeight: 1.5,
                    }}
                  >
                    No studies yet. Mark a chapter and tap{" "}
                    <b style={{ color: C.text }}>Compile</b> to record it here, or
                    build one from Search.
                  </div>
                ) : (
                  <>
                    {chapterRecs.length > 0 &&
                      section(
                        "Chapter studies",
                        "#8b5cf6",
                        chapterRecs.map((s) =>
                          row(
                            s.id,
                            s.name,
                            countChapter(s) +
                              " mark" +
                              (countChapter(s) === 1 ? "" : "s") +
                              (bookLabel(s.bookId)
                                ? " · " + bookLabel(s.bookId)
                                : ""),
                            "#8b5cf6",
                            () => openRecordedStudy(s),
                            () => {
                              if (
                                window.confirm(
                                  "Remove this study from the list? Your marks stay in the book."
                                )
                              )
                                deleteStudy(s.id);
                            },
                            undefined,
                            detail(
                              displayOf(s.scopeRef),
                              themesFor(
                                s.bookId,
                                s.scopeRef,
                                (r) => scopeOf(r) === s.scopeRef
                              )
                            ),
                            infoStudyId === s.id,
                            () =>
                              setInfoStudyId(
                                infoStudyId === s.id ? null : s.id
                              )
                          )
                        )
                      )}
                    {linkedRecs.length > 0 &&
                      section(
                        "Linked studies",
                        "#8b5cf6",
                        linkedRecs.map((s) =>
                          row(
                            s.id,
                            s.name,
                            countLinked(s) +
                              " mark" +
                              (countLinked(s) === 1 ? "" : "s") +
                              (bookLabel(s.bookId)
                                ? " · " + bookLabel(s.bookId)
                                : ""),
                            "#8b5cf6",
                            () => openRecordedStudy(s),
                            () => {
                              if (
                                window.confirm(
                                  "Remove this study from the list? Your marks stay in the book."
                                )
                              )
                                deleteStudy(s.id);
                            },
                            <IconLink color="#8b5cf6" />,
                            detail(
                              Object.keys(chapterGroups)
                                .filter((c) => chapterGroups[c] === s.scopeRef)
                                .sort(
                                  (a, b) =>
                                    (chapterLoc.get(a)?.order ?? 0) -
                                    (chapterLoc.get(b)?.order ?? 0)
                                )
                                .map(displayOf)
                                .join("  +  "),
                              themesFor(
                                s.bookId,
                                Object.keys(chapterGroups).filter(
                                  (c) => chapterGroups[c] === s.scopeRef
                                )[0] || s.scopeRef,
                                (r) => chapterGroups[scopeOf(r)] === s.scopeRef
                              )
                            ),
                            infoStudyId === s.id,
                            () =>
                              setInfoStudyId(
                                infoStudyId === s.id ? null : s.id
                              )
                          )
                        )
                      )}
                    {liveSearch.length > 0 &&
                      section(
                        "Keyword studies",
                        "#0d9488",
                        liveSearch.map((ss) =>
                          row(
                            ss.id,
                            ss.name,
                            countSearch(ss) +
                              " mark" +
                              (countSearch(ss) === 1 ? "" : "s") +
                              " · " +
                              ss.refs.length +
                              " verse" +
                              (ss.refs.length === 1 ? "" : "s") +
                              (bookLabel(ss.bookId)
                                ? " · " + bookLabel(ss.bookId)
                                : ""),
                            "#0d9488",
                            () => openStudy(ss),
                            () => {
                              if (
                                window.confirm(
                                  "Delete this study? Your marks stay in the book."
                                )
                              )
                                deleteSearchStudy(ss.id);
                            },
                            <IconLink color="#0d9488" />,
                            detail(
                              Array.from(
                                new Set(ss.refs.map((r) => scopeOf(r)))
                              ).join(", "),
                              themesFor(
                                ss.bookId,
                                "searchstudy:" + ss.id,
                                (r) => ss.refs.includes(r)
                              )
                            ),
                            infoStudyId === ss.id,
                            () =>
                              setInfoStudyId(
                                infoStudyId === ss.id ? null : ss.id
                              )
                          )
                        )
                      )}
                  </>
                )}
              </div>
            </div>
          );
        })()}

      {/* Destination chooser (scripture search result) */}
      {chooseRef &&
        (() => {
          const ref = chooseRef;
          const activeBook = books.find((b) => b.id === activeBookId);
          const isMaster = activeBookId === "master";
          const dateStr = new Date().toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          });
          const choice = (label: string, sub: string, onClick: () => void) => (
            <button
              onClick={onClick}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: C.soft,
                border: "1px solid " + C.border,
                borderRadius: "10px",
                padding: "13px 14px",
                marginBottom: "8px",
                color: C.text,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <div style={{ fontSize: "14px", fontWeight: 600 }}>{label}</div>
              <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>
                {sub}
              </div>
            </button>
          );
          return sheet(
            () => setChooseRef(null),
            <div>
              <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "2px" }}>
                Open {ref}
              </div>
              <div style={{ fontSize: "12px", color: C.muted, marginBottom: "16px" }}>
                Where would you like to study this verse?
              </div>

              {!isMaster &&
                activeBook &&
                choice("Open in " + activeBook.name, "current session", () => {
                  jumpToRef(ref);
                })}

              {choice(
                "Open in Master Book",
                isMaster ? "your default book" : "your default book",
                () => {
                  setActiveBook("master");
                  jumpToRef(ref);
                }
              )}

              {choice("Open in a new session", "start a fresh study layer", () => {
                const id = createSession("Session · " + dateStr);
                setActiveBook(id);
                jumpToRef(ref);
              })}
            </div>
          );
        })()}

      {/* Compile: gathering animation, then the full-screen view */}
      {compileAnim.show && (
        <CompileAnimation
          duration={compileAnim.duration}
          onDone={() => {
            setCompileAnim((a) => ({ ...a, show: false }));
            setCompileOpen(true);
          }}
        />
      )}
      {compileOpen &&
        (() => {
          const byOrder = (a: string, b: string) =>
            (chapterLoc.get(a)?.order ?? 0) - (chapterLoc.get(b)?.order ?? 0);
          const cs = compileStudy;
          const cr = compileRec;
          let cMarks: Mark[];
          let cScopes: string[];
          let cScope: string;
          let cTitle: string;
          let cLabels: Record<number, string>;
          if (cs) {
            cScopes = Array.from(new Set(cs.refs.map((r) => scopeOf(r)))).sort(
              byOrder
            );
            cMarks = marks.filter((m) => cs.refs.includes(m.reference));
            cScope = "searchstudy:" + cs.id;
            cTitle = cs.name;
            const o: Record<number, string> = {};
            COLORS.forEach((c) => {
              const n = (scopedLabels[cScope]?.[c] || "").trim();
              if (n) o[c] = n;
            });
            cLabels = o;
          } else if (cr) {
            cScopes = (
              cr.type === "linked"
                ? Object.keys(chapterGroups).filter(
                    (c) => chapterGroups[c] === cr.scopeRef
                  )
                : [cr.scopeRef]
            )
              .slice()
              .sort(byOrder);
            cMarks = marks.filter((m) => cScopes.includes(scopeOf(m.reference)));
            cScope =
              cr.type === "linked"
                ? "group:" + cr.scopeRef
                : resolveScope(cr.scopeRef);
            cTitle = cr.name;
            const o: Record<number, string> = {};
            COLORS.forEach((c) => {
              const n = chapterColorName(cScopes[0] || cr.scopeRef, c);
              if (n) o[c] = n;
            });
            cLabels = o;
          } else {
            cMarks = studyMarks;
            cScopes = studyScopes;
            cScope = resolveScope(title);
            // If a study for this chapter (or its linked group) was already
            // saved, show that saved name instead of the bare chapter label —
            // otherwise the name you gave reverts and re-saving overwrites it.
            const gid = chapterGroups[title];
            const existing = studies.find((s) =>
              gid
                ? s.type === "linked" &&
                  s.bookId === activeBookId &&
                  s.scopeRef === gid
                : s.type === "chapter" &&
                  s.bookId === activeBookId &&
                  s.scopeRef === title
            );
            cTitle = existing ? existing.name : displayTitle;
            cLabels = scopeLabels;
          }
          return (
            <MobileCompile
              marks={cMarks}
              studyScopes={cScopes}
              colorLabels={cLabels}
              C={C}
              orderOf={orderOf}
              sessionNew={sessionNew}
              onJump={jumpToRef}
              notes={notes}
              setNote={setNote}
              defaultName={cTitle}
              onSave={(nm) => {
                const name = nm.trim();
                if (cs) {
                  setSearchStudies((prev) =>
                    prev.map((s) =>
                      s.id === cs.id
                        ? { ...s, name: name || s.name, updatedAt: Date.now() }
                        : s
                    )
                  );
                } else if (cr) {
                  recordStudy(cr.type, cr.scopeRef, name || cr.name);
                } else if (chapterGroups[title]) {
                  recordStudy(
                    "linked",
                    chapterGroups[title],
                    name || groupMembers(title).map(displayOf).join("  +  ")
                  );
                } else {
                  recordStudy("chapter", title, name || displayTitle);
                }
                flash("Saved to Studies", "success");
                setCompileOpen(false);
                setCompileStudy(null);
                setCompileRec(null);
              }}
              onClose={() => {
                setCompileOpen(false);
                setCompileStudy(null);
                setCompileRec(null);
              }}
              dark={dark}
              title={cTitle}
              scope={cScope}
              onFlash={flash}
              onRenameTheme={(color, name) =>
                setScopedLabel(cScope, color as MarkColor, name)
              }
            />
          );
        })()}

      {/* Manage a mark (long-press) */}
      {manage &&
        (() => {
          const cover: Mark[] = marks.filter(
            (m) =>
              m.reference === manage.ref &&
              m.startIndex < manage.e &&
              m.endIndex > manage.s
          );
          const word = manage.text.slice(manage.s, manage.e);
          return sheet(
            () => setManage(null),
            <div>
              <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px" }}>
                {"“" + word + "”"}
              </div>
              {cover.length === 0 && (
                <div style={{ fontSize: "13px", color: C.muted, marginBottom: "14px" }}>
                  No marks on this word.
                </div>
              )}
              {cover.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "10px 0",
                    borderBottom: "1px solid " + C.border,
                  }}
                >
                  <span
                    style={{
                      width: "16px",
                      height: "16px",
                      borderRadius: "50%",
                      backgroundColor: COLOR_MAP[m.color],
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1, fontSize: "14px" }}>
                    {chapterColorName(scopeOf(m.reference), m.color) ||
                      "Color " + m.color}
                  </span>
                  <button
                    onClick={() => {
                      deleteMark(m.id);
                      setManage(null);
                      flash("Removed");
                    }}
                    style={{
                      background: "transparent",
                      border: "1px solid " + C.border,
                      borderRadius: "8px",
                      padding: "6px 12px",
                      fontSize: "13px",
                      color: C.text,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Erase
                  </button>
                </div>
              ))}

              {cover.length > 0 && (
                <div style={{ marginTop: "14px" }}>
                  <div style={{ fontSize: "11px", color: C.muted, marginBottom: "8px" }}>
                    Recolor
                  </div>
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => {
                          recolor(cover[0], c);
                          setManage(null);
                        }}
                        style={{
                          width: "28px",
                          height: "28px",
                          borderRadius: "50%",
                          backgroundColor: COLOR_MAP[c],
                          border: "none",
                          cursor: "pointer",
                          boxShadow: "0 0 0 1px " + C.border,
                        }}
                        aria-label={"Recolor " + c}
                      />
                    ))}
                  </div>
                </div>
              )}

              {cover.length > 0 && (
                <button
                  onClick={() => {
                    const m = cover[0];
                    setManage(null);
                    setVersePreview({
                      phrase: m.markedText,
                      reference: m.reference,
                      theme: chapterColorName(scopeOf(m.reference), m.color),
                      style: m.style,
                      color: m.color,
                    });
                  }}
                  style={{
                    width: "100%",
                    marginTop: "18px",
                    background: C.text,
                    color: C.bg,
                    border: "none",
                    borderRadius: "10px",
                    padding: "13px",
                    fontSize: "14px",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Share as image
                </button>
              )}

              <button
                onClick={() => {
                  if (navigator.clipboard) navigator.clipboard.writeText(manage.text);
                  setManage(null);
                  flash("Verse copied");
                }}
                style={{
                  width: "100%",
                  marginTop: "10px",
                  background: "transparent",
                  border: "1px solid " + C.border,
                  borderRadius: "10px",
                  padding: "12px",
                  fontSize: "13px",
                  color: C.text,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Copy verse
              </button>
            </div>
          );
        })()}


      {/* Share preview (verse) */}
      {versePreview && (
        <SharePreview
          C={C}
          appDark={dark}
          kind="verse"
          verse={versePreview}
          onClose={() => setVersePreview(null)}
          onFlash={flash}
        />
      )}

      {/* Vault (full-screen) */}
      {vaultOpen &&
        (() => {
          const bookMarksOf = (bid: string) =>
            allMarks.filter((m) => m.bookId === bid);
          const studiesInBook = (bid: string) =>
            studies.filter((s) => s.bookId === bid);
          const searchesInBook = (bid: string) =>
            searchStudies.filter((ss) => ss.bookId === bid);
          const countInBook = (bid: string) =>
            studiesInBook(bid).length + searchesInBook(bid).length;
          const countChapter = (s: Study) =>
            bookMarksOf(s.bookId).filter(
              (m) => scopeOf(m.reference) === s.scopeRef
            ).length;
          const countLinked = (s: Study) => {
            const chs = Object.keys(chapterGroups).filter(
              (c) => chapterGroups[c] === s.scopeRef
            );
            return bookMarksOf(s.bookId).filter((m) =>
              chs.includes(scopeOf(m.reference))
            ).length;
          };
          const countSearch = (ss: SearchStudy) =>
            bookMarksOf(ss.bookId).filter((m) => ss.refs.includes(m.reference))
              .length;

          const selBook = vaultBookId
            ? books.find((b) => b.id === vaultBookId) || null
            : null;

          const openFromVault = (fn: () => void) => {
            setVaultOpen(false);
            setVaultBookId(null);
            fn();
          };

          // one tappable study row (reference only — opens the study)
          const studyRow = (
            key: string,
            name: string,
            meta: string,
            accent: string,
            onOpen: () => void,
            icon?: React.ReactNode
          ) => (
            <button
              key={key}
              onClick={onOpen}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                textAlign: "left",
                background: "transparent",
                border: "none",
                borderTop: "1px solid " + C.border,
                padding: "12px 2px",
                color: C.text,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {icon ? (
                <span style={{ display: "inline-flex", flexShrink: 0 }}>
                  {icon}
                </span>
              ) : (
                <span
                  style={{
                    width: "9px",
                    height: "9px",
                    borderRadius: "50%",
                    background: accent,
                    flexShrink: 0,
                  }}
                />
              )}
              <span style={{ minWidth: 0, flex: 1 }}>
                <span
                  style={{
                    display: "block",
                    fontSize: "13.5px",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {name}
                </span>
                <span style={{ fontSize: "11.5px", color: C.muted }}>
                  {meta}
                </span>
              </span>
              <span
                style={{ color: C.muted, fontSize: "18px", flexShrink: 0 }}
              >
                ›
              </span>
            </button>
          );

          const section = (
            title: string,
            rows: React.ReactNode
          ) => (
            <div style={{ marginBottom: "20px" }}>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  color: C.muted,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: "2px",
                }}
              >
                {title}
              </div>
              {rows}
            </div>
          );

          return (
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 250,
                backgroundColor: C.bg,
                color: C.text,
                display: "flex",
                flexDirection: "column",
                animation: "mob-fadein 0.18s ease",
              }}
            >
              {/* header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "calc(env(safe-area-inset-top) + 10px) 12px 10px",
                  borderBottom: "1px solid " + C.border,
                }}
              >
                <button
                  onClick={() =>
                    vaultBookId ? setVaultBookId(null) : setVaultOpen(false)
                  }
                  aria-label="Back"
                  style={{
                    width: "38px",
                    height: "38px",
                    background: "transparent",
                    border: "none",
                    color: C.text,
                    fontSize: "22px",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  ‹
                </button>
                <div
                  style={{
                    fontSize: "17px",
                    fontWeight: 700,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {selBook ? selBook.name : "Books"}
                </div>
              </div>

              {/* body */}
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  WebkitOverflowScrolling: "touch",
                  padding: "16px 18px calc(20px + env(safe-area-inset-bottom))",
                }}
              >
                {!selBook ? (
                  // ---------------- BOOK LIST ----------------
                  <>
                    <div
                      style={{
                        fontSize: "12.5px",
                        color: C.muted,
                        lineHeight: 1.5,
                        marginBottom: "14px",
                      }}
                    >
                      Your books. Master is permanent. Deleting a session book
                      also deletes its marks and its studies.
                    </div>
                    {books.map((b) => {
                      const sc = countInBook(b.id);
                      return (
                        <div
                          key={b.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            borderTop: "1px solid " + C.border,
                          }}
                        >
                          <button
                            onClick={() => setVaultBookId(b.id)}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                              textAlign: "left",
                              background: "transparent",
                              border: "none",
                              padding: "13px 2px",
                              color: C.text,
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            <span
                              style={{ display: "inline-flex", flexShrink: 0 }}
                            >
                              <IconBook
                                color={b.isMaster ? C.text : C.muted}
                              />
                            </span>
                            <span style={{ minWidth: 0, flex: 1 }}>
                              <span
                                style={{
                                  display: "block",
                                  fontSize: "14px",
                                  fontWeight: 600,
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {b.name}
                                {b.isMaster ? "  ·  permanent" : ""}
                              </span>
                              <span
                                style={{
                                  fontSize: "11.5px",
                                  color: C.muted,
                                }}
                              >
                                {sc + " stud" + (sc === 1 ? "y" : "ies")} ·{" "}
                                {b.markCount +
                                  " mark" +
                                  (b.markCount === 1 ? "" : "s")}
                              </span>
                            </span>
                            <span
                              style={{
                                color: C.muted,
                                fontSize: "18px",
                                flexShrink: 0,
                              }}
                            >
                              ›
                            </span>
                          </button>
                          {!b.isMaster && (
                            <button
                              onClick={() => {
                                if (
                                  window.confirm(
                                    'Delete "' +
                                      b.name +
                                      '" and everything in it? This removes the book, its marks, and its studies. This cannot be undone.'
                                  )
                                ) {
                                  deleteBook(b.id);
                                  if (vaultBookId === b.id)
                                    setVaultBookId(null);
                                }
                              }}
                              aria-label={"Delete " + b.name}
                              style={{
                                width: "40px",
                                height: "46px",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                                flexShrink: 0,
                              }}
                            >
                              <IconTrash color={C.muted} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </>
                ) : (
                  // ------------- ONE BOOK'S STUDIES -------------
                  (() => {
                    const chap = studiesInBook(selBook.id).filter(
                      (s) => s.type === "chapter"
                    );
                    const linked = studiesInBook(selBook.id).filter(
                      (s) => s.type === "linked"
                    );
                    const searches = searchesInBook(selBook.id);
                    const tot =
                      chap.length + linked.length + searches.length;
                    if (tot === 0)
                      return (
                        <div
                          style={{
                            fontSize: "13px",
                            color: C.muted,
                            lineHeight: 1.5,
                          }}
                        >
                          No studies in this book yet. Open a chapter, mark it,
                          and tap <b style={{ color: C.text }}>Compile</b> to
                          record one here.
                        </div>
                      );
                    return (
                      <>
                        {chap.length > 0 &&
                          section(
                            "Chapter studies",
                            chap.map((s) =>
                              studyRow(
                                s.id,
                                s.name,
                                countChapter(s) +
                                  " mark" +
                                  (countChapter(s) === 1 ? "" : "s"),
                                "#8b5cf6",
                                () =>
                                  openFromVault(() => openRecordedStudy(s))
                              )
                            )
                          )}
                        {linked.length > 0 &&
                          section(
                            "Linked studies",
                            linked.map((s) =>
                              studyRow(
                                s.id,
                                s.name,
                                countLinked(s) +
                                  " mark" +
                                  (countLinked(s) === 1 ? "" : "s"),
                                "#8b5cf6",
                                () =>
                                  openFromVault(() => openRecordedStudy(s)),
                                <IconLink color="#8b5cf6" />
                              )
                            )
                          )}
                        {searches.length > 0 &&
                          section(
                            "Keyword studies",
                            searches.map((ss) =>
                              studyRow(
                                ss.id,
                                ss.name,
                                countSearch(ss) +
                                  " mark" +
                                  (countSearch(ss) === 1 ? "" : "s") +
                                  " · " +
                                  ss.refs.length +
                                  " verse" +
                                  (ss.refs.length === 1 ? "" : "s"),
                                "#0d9488",
                                () => openFromVault(() => openStudy(ss)),
                                <IconLink color="#0d9488" />
                              )
                            )
                          )}
                      </>
                    );
                  })()
                )}
              </div>
            </div>
          );
        })()}

      {/* First-run: sign-in choice, then the live guided tour */}
      {signInOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 5000,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "360px",
              background: C.panel,
              color: C.text,
              border: "1px solid " + C.border,
              borderRadius: "18px",
              padding: "24px",
              boxShadow: "0 18px 50px rgba(0,0,0,0.4)",
            }}
          >
            <div
              style={{ fontSize: "19px", fontWeight: 700, marginBottom: "8px" }}
            >
              Welcome to Scribal
            </div>
            <div
              style={{
                fontSize: "13.5px",
                color: C.muted,
                lineHeight: 1.6,
                marginBottom: "18px",
              }}
            >
              Sign in with Google to keep your study in sync across your phone
              and desktop, or just use this device for now. You can change this
              anytime in the menu.
            </div>
            <button
              onClick={async () => {
                localStorage.setItem("scribal_mobile_onboarded", "1");
                setSignInOpen(false);
                try {
                  await cloudSignIn();
                } catch {
                  /* popup dismissed — they can sign in later from the menu */
                }
                setMtourOpen(true);
              }}
              style={{
                width: "100%",
                padding: "13px",
                borderRadius: "11px",
                border: "none",
                background: C.text,
                color: C.bg,
                fontSize: "14px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                marginBottom: "10px",
              }}
            >
              Sync across my devices
            </button>
            <button
              onClick={() => {
                localStorage.setItem("scribal_mobile_onboarded", "1");
                setSignInOpen(false);
                setMtourOpen(true);
              }}
              style={{
                width: "100%",
                padding: "13px",
                borderRadius: "11px",
                border: "1px solid " + C.border,
                background: "transparent",
                color: C.text,
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Just on this device
            </button>
          </div>
        </div>
      )}
      {mtourOpen && (
        <SpotlightTour
          steps={M_TOUR}
          label="Guided tour"
          colors={{
            panel: C.panel,
            text: C.text,
            border: C.border,
            muted: C.muted,
          }}
          onClose={() => setMtourOpen(false)}
        />
      )}

      {guideOpen && (
        <MobileFeatureGuide C={C} onClose={() => setGuideOpen(false)} />
      )}

      {/* Edit-mark mode bar */}
      {editMark && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: "calc(env(safe-area-inset-bottom) + 84px)",
            display: "flex",
            justifyContent: "center",
            zIndex: 250,
            pointerEvents: "none",
            padding: "0 16px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              backgroundColor: C.text,
              color: C.bg,
              borderRadius: "999px",
              padding: "9px 9px 9px 18px",
              boxShadow: "0 6px 24px rgba(0,0,0,0.3)",
              pointerEvents: "auto",
              maxWidth: "100%",
            }}
          >
            <span style={{ fontSize: "12.5px", fontWeight: 600 }}>
              Tap words to set the edges
            </span>
            <button
              onClick={() => setEditMark(null)}
              style={{
                background: C.bg,
                color: C.text,
                border: "none",
                borderRadius: "999px",
                padding: "7px 16px",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                flexShrink: 0,
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Quiet feedback toast */}
      {toast && (
        <div
          key={toast + toastTone}
          style={{
            position: "fixed",
            left: "50%",
            bottom: "calc(96px + env(safe-area-inset-bottom))",
            transform: "translateX(-50%)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            gap: "9px",
            backgroundColor: C.text,
            color: C.bg,
            borderRadius: "999px",
            padding: toastTone === "success" ? "11px 20px 11px 13px" : "9px 16px",
            fontSize: toastTone === "success" ? "14.5px" : "13px",
            fontWeight: 600,
            boxShadow: "0 8px 26px rgba(0,0,0,0.30)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            maxWidth: "calc(100vw - 32px)",
            animation: "mob-toast-in 0.34s cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          {toastTone === "success" && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "20px",
                height: "20px",
                borderRadius: "999px",
                backgroundColor: "#22c55e",
                color: "#fff",
                fontSize: "12px",
                fontWeight: 800,
                flex: "0 0 auto",
              }}
            >
              ✓
            </span>
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {toast}
          </span>
        </div>
      )}
    </div>
  );
}

function navBtn(
  C: { text: string; muted: string },
  disabled: boolean
): React.CSSProperties {
  return {
    width: "44px",
    height: "44px",
    background: "transparent",
    border: "none",
    color: disabled ? C.muted : C.text,
    fontSize: "24px",
    lineHeight: 1,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
    flexShrink: 0,
  };
}

function JumpPanel({
  C,
  loc,
  onGo,
}: {
  C: { text: string; muted: string; border: string; bg: string; panel: string };
  loc: Loc;
  onGo: (l: Loc) => void;
}) {
  // Drill-down: Standard works -> books -> chapters (sections for D&C) -> jump.
  const [vi, setVi] = useState<number | null>(null);
  const [bi, setBi] = useState<number | null>(null);
  const accent = "#8b5cf6";

  const rowBtn: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    textAlign: "left",
    background: C.bg,
    border: "1px solid " + C.border,
    borderRadius: "10px",
    padding: "14px",
    marginBottom: "8px",
    color: C.text,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "15px",
    fontWeight: 600,
  };

  const backBar = (label: string, onBack: () => void) => (
    <button
      onClick={onBack}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: "transparent",
        border: "none",
        color: C.muted,
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: "13px",
        fontWeight: 600,
        padding: "2px 0",
        marginBottom: "12px",
      }}
    >
      <span style={{ fontSize: "18px", lineHeight: 1 }}>‹</span>
      {label}
    </button>
  );

  const heading = (txt: string) => (
    <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "14px" }}>
      {txt}
    </div>
  );

  // ---- Chapters / sections of the selected book ----
  if (vi !== null && bi !== null) {
    const bk = vols[vi].books[bi];
    const word = chapterWord(bk.book); // "Section" for D&C, else "Chapter"
    const single = vols[vi].books.length === 1;
    return (
      <div>
        {backBar(single ? "Standard works" : vols[vi].volume, () => {
          if (single) {
            setVi(null);
            setBi(null);
          } else {
            setBi(null);
          }
        })}
        {heading(bk.book)}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: "8px",
          }}
        >
          {bk.chapters.map((ch, ci) => {
            const here = loc.v === vi && loc.b === bi && loc.c === ci;
            return (
              <button
                key={ci}
                onClick={() => onGo({ v: vi, b: bi, c: ci })}
                aria-label={word + " " + ch.chapter}
                style={{
                  padding: "13px 0",
                  borderRadius: "10px",
                  border: "1px solid " + (here ? accent : C.border),
                  background: here ? accent : C.bg,
                  color: here ? "#ffffff" : C.text,
                  fontSize: "15px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {ch.chapter}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: "11px", color: C.muted, marginTop: "14px" }}>
          Tap a {word.toLowerCase()} to jump there.
        </div>
      </div>
    );
  }

  // ---- Books in the selected volume ----
  if (vi !== null) {
    return (
      <div>
        {backBar("Standard works", () => setVi(null))}
        {heading(vols[vi].volume)}
        {vols[vi].books.map((bk, k) => {
          const here = loc.v === vi && loc.b === k;
          return (
            <button
              key={k}
              onClick={() => setBi(k)}
              style={{ ...rowBtn, borderColor: here ? accent : C.border }}
            >
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {bk.book}
              </span>
              <span style={{ color: C.muted, fontSize: "16px" }}>›</span>
            </button>
          );
        })}
      </div>
    );
  }

  // ---- Standard works (top level) ----
  return (
    <div>
      {heading("Standard works")}
      {vols.map((vol, k) => {
        const here = loc.v === k;
        return (
          <button
            key={k}
            onClick={() => {
              // Single-book volumes (Doctrine and Covenants) skip straight in.
              if (vol.books.length === 1) {
                setVi(k);
                setBi(0);
              } else {
                setVi(k);
              }
            }}
            style={{ ...rowBtn, borderColor: here ? accent : C.border }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>{vol.volume}</span>
            <span style={{ color: C.muted, fontSize: "16px" }}>›</span>
          </button>
        );
      })}
    </div>
  );
}
