import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getScriptures, volumesProxy } from "./data/scripturesStore";
import {
  Mark,
  MarkColor,
  MarkStyle,
  Tool,
  WordTag,
  COLORS,
  COLOR_MAP,
  HIGHLIGHT_MAP,
} from "./types";
import MobileVerse from "./MobileVerse";
import { isSermonsVolume, sermonLabel } from "./sermons";
import DefinitionView from "./components/DefinitionView";
import { lookup as websterLookup, loadWebster, definitionForKey, WebsterResult } from "./webster";
import MobileCompile from "./MobileCompile";
import { NEUTRAL, WARM, ACCENT } from "./theme";
import ScribalWordmark from "./components/ScribalWordmark";
import SplashScreen from "./components/SplashScreen";
import StyleGlyph from "./components/StyleGlyph";
import CompileBook, {
  CompileFlyer,
} from "./components/CompileBook";
import ExampleStudy from "./components/ExampleStudy";
import MobileSearch from "./MobileSearch";
import SharePreview from "./SharePreview";
import MobileWalkthrough from "./MobileWalkthrough";
import FeatureSlides from "./FeatureSlides";
import { useMarks } from "./hooks/useMarks";
import { useVault } from "./hooks/useVault";
import { useWordTags } from "./hooks/useWordTags";
import { useStudyTables, StudyTable, TableCard, newCardId } from "./hooks/useStudyTables";
import StudyTablePresent from "./components/StudyTablePresent";
import StudyTablesMobile from "./components/StudyTablesMobile";
import MarkedVerse from "./components/MarkedVerse";
import { getVerse } from "./data/verseIndex";
import {
  newRoomCode,
  createRoom,
  pushBeat,
  endRoom,
  joinUrl as roomJoinUrl,
  themesKey,
  redactTableForRoom,
} from "./presentRoom";
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
const BACKUP_KEYS = [
  ...CORE_KEYS,
  "scribal_mobile_loc",
  "scribal_mobile_tabs",
  "scribal_mobile_active",
];

// Reading position / scroll are device-local: a pulled backup must never move
// you off your current chapter, and scroll never travels between devices.
const MOBILE_APPLY_OPTS = {
  alwaysLocal: ["scribal_mobile_scroll"],
  keepLocalIfPresent: [
    "scribal_mobile_loc",
    "scribal_mobile_tabs",
    "scribal_mobile_active",
  ],
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

// How many reading tabs ("Screens") can be open at once. One panel shows at a
// time; the "+" hides at this cap.
const MAX_TABS = 8;

// A fresh id for a new reading tab.
const newTabId = () =>
  "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

// Stable hash of a scope string → a deterministic index into LINK_COLORS, so a
// single chapter that anchors a study (no chapter-group) still gets a color.
const hashScope = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

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

function applyBackupString(text: string) {
  // Mobile historically never threw on a malformed backup — preserve that.
  try {
    syncApplyBackupString(text, MOBILE_APPLY_OPTS);
  } catch {}
}

const vols = volumesProxy;

const PALETTE = NEUTRAL;

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
  "--pen8": "#d6448c",
  "--pen9": "#5fa515",
  "--pen10": "#0e9aab",
  "--hl1": "#ffd6d6",
  "--hl2": "#ffe2c2",
  "--hl3": "#fbedb0",
  "--hl4": "#d3f0d6",
  "--hl5": "#cfe2f7",
  "--hl6": "#e6d9f7",
  "--hl7": "#e0e0e0",
  "--hl8": "#fcd9ea",
  "--hl9": "#e8f5c4",
  "--hl10": "#c9f0f5",
};

const MARK_VARS_DARK = {
  "--pen1": "#ff7b72",
  "--pen2": "#f0a24b",
  "--pen3": "#e3c341",
  "--pen4": "#5fcf6b",
  "--pen5": "#7cb0e8",
  "--pen6": "#b794f6",
  "--pen7": "#f2efe8",
  "--pen8": "#f48fb1",
  "--pen9": "#b4e052",
  "--pen10": "#4dd0e1",
  "--hl1": "#5c2b2e",
  "--hl2": "#5c3f1f",
  "--hl3": "#5a4a1c",
  "--hl4": "#1f4d2a",
  "--hl5": "#243d56",
  "--hl6": "#3d2b5c",
  "--hl7": "#3f3e3a",
  "--hl8": "#5a2742",
  "--hl9": "#3a4a12",
  "--hl10": "#134048",
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
  { tool: "box", label: "Box" },
  { tool: "dashed", label: "Dashed" },
  { tool: "squiggly", label: "Squiggly" },
  { tool: "eraser", label: "Eraser" },
  { tool: "define", label: "Define" },
];

// Toolbar glyph for a tool button. Marking styles preview themselves via
// StyleGlyph; Eraser and Define are tools, not styles, so they keep their own
// line-icons. One source of truth for all three toolbar instances.
const toolGlyph = (tool: Tool) => {
  if (tool === "eraser")
    return (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ verticalAlign: "middle" }}
      >
        <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
        <path d="M22 21H7" />
        <path d="m5 11 9 9" />
      </svg>
    );
  if (tool === "define")
    return (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ verticalAlign: "middle" }}
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
    );
  return <StyleGlyph style={tool as MarkStyle} size={13} />;
};

interface Loc {
  v: number;
  b: number;
  c: number;
}

// A reading tab is a location plus a stable id, OR a keyword-study tab carrying
// its studyId (the location fields are placeholders for study tabs).
type MTab = Loc & { id: string; studyId?: string };

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
  // Optional free-text overview shown atop the study on desktop (carried in by
  // the ScriptureNotes importer). Mobile doesn't show or edit it, but stores and
  // syncs it so it round-trips between devices without being lost or reverted.
  note?: string;
  // The compile view this keyword study was last saved in (Outline / Distilled /
  // Relational), so reopening lands on the same tab. Absent → Outline.
  view?: "outline" | "distilled" | "covenants" | "semantic";
  // When set, this keyword search is linked into a chapter study (that chapter's
  // scope). It then shares the chapter's book/themes and folds into its compile.
  linkedScope?: string;
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
  // Loose verses added to this study by keyword search, beyond its chapter(s).
  // Their marks are folded into the compile alongside the chapter's marks.
  extraRefs?: string[];
  // When extraRefs was last edited. Drives last-write sync of the added-verse
  // set (add AND remove), exactly like a keyword study's refs/updatedAt.
extraRefsAt?: number;
  // Snapshot of a linked study's chapter scopes at save time — see useStudies.
  memberScopes?: string[];
  // The compile view this study was last saved in (Outline / Distilled /
  // Relational), so reopening lands on the same tab. Absent → Outline.
  view?: "outline" | "charting" | "distilled" | "covenants" | "semantic";
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
// Link-icon colors by study type — one glance tells the kind:
//   red = chapter study · blue = keyword study · purple = combined (both).
const TYPE_RED = "#ef4444";
const TYPE_BLUE = "#3b82f6";
const TYPE_PURPLE = ACCENT;

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

// A static link glyph in the given type color. The merge animation lives in
// the center-screen MergeMoment overlay, not here, so this stays a plain icon.
const LinkGlyph = ({
  color,
  size = 15,
}: {
  color: string;
  size?: number;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
    <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
  </svg>
);

// The center-screen "Combined study" moment. Mounted briefly when a link turns
// a study combined; the CSS plays once and then it unmounts.
const MergeMoment = () => {
  const path = (
    <>
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </>
  );
  const lk = (cls: string, stroke: string) => (
    <svg
      className={"mo-lk " + cls}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {path}
    </svg>
  );
  return (
    <div className="mo-wrap">
      <div className="mo-stage">
        <span className="mo-glow" />
        <span className="mo-ripple" />
        {lk("mo-red", TYPE_RED)}
        {lk("mo-blue", TYPE_BLUE)}
        {lk("mo-purple", TYPE_PURPLE)}
      </div>
      <div className="mo-label">
        <div className="mo-big">Combined study</div>
        <div className="mo-small">Chapter + keyword linked</div>
      </div>
    </div>
  );
};

// The center-screen "Chapters linked" moment — the same motion as the combined
// splash but in the red chapter-study color (two reds fusing into one), shown
// when two chapters are linked into one study. Reuses the mo-* animation
// classes; only the colors are overridden inline.
const ChapterLinkMoment = () => {
  const lk = (cls: string) => (
    <svg
      className={"mo-lk " + cls}
      viewBox="0 0 24 24"
      fill="none"
      stroke={TYPE_RED}
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </svg>
  );
  return (
    <div className="mo-wrap">
      <div className="mo-stage">
        <span
          className="mo-glow"
          style={{
            background:
              "radial-gradient(circle, " +
              TYPE_RED +
              "73, " +
              TYPE_RED +
              "00 70%)",
          }}
        />
        <span className="mo-ripple" style={{ borderColor: TYPE_RED }} />
        {lk("mo-red")}
        {lk("mo-blue")}
        {lk("mo-purple")}
      </div>
      <div className="mo-label">
        <div className="mo-big">Chapters linked</div>
        <div className="mo-small">Linked into one study</div>
      </div>
    </div>
  );
};

// Copied from the desktop shell: the lighter "Keywords added" pulse that plays
// when a study you already have gains verses (distinct from a link). On a phone
// there is one panel, so it always renders fixed / viewport-centered.
const GrowLink = ({ cls, w = 30 }: { cls: string; w?: number }) => (
  <svg
    className={cls}
    viewBox="0 0 24 24"
    fill="none"
    stroke={TYPE_BLUE}
    strokeWidth={2.4}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{
      position: "absolute",
      top: "50%",
      left: "50%",
      width: w,
      height: w,
    }}
  >
    <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
    <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
  </svg>
);

const GrowPulse = ({ fixed }: { fixed?: boolean }) => (
  <div
    style={{
      position: fixed ? "fixed" : "absolute",
      inset: 0,
      pointerEvents: "none",
      zIndex: 30,
      overflow: "hidden",
    }}
  >
    <style>{`
      @keyframes scribal-grow-dim {
        0% { opacity: 0; }
        18% { opacity: 1; }
        72% { opacity: 1; }
        100% { opacity: 0; }
      }
      @keyframes scribal-grow-left {
        0% { opacity: 0; transform: translate(-50%,-50%) translateX(-70px) scale(.85); }
        22% { opacity: 1; transform: translate(-50%,-50%) translateX(-30px) scale(1); }
        46% { opacity: 1; transform: translate(-50%,-50%) translateX(0) scale(1); }
        58% { opacity: 0; transform: translate(-50%,-50%) translateX(0) scale(.9); }
        100% { opacity: 0; }
      }
      @keyframes scribal-grow-right {
        0% { opacity: 0; transform: translate(-50%,-50%) translateX(70px) scale(.85); }
        22% { opacity: 1; transform: translate(-50%,-50%) translateX(30px) scale(1); }
        46% { opacity: 1; transform: translate(-50%,-50%) translateX(0) scale(1); }
        58% { opacity: 0; transform: translate(-50%,-50%) translateX(0) scale(.9); }
        100% { opacity: 0; }
      }
      @keyframes scribal-grow-pop {
        0%, 42% { opacity: 0; transform: translate(-50%,-50%) scale(.4); }
        54% { opacity: 1; transform: translate(-50%,-50%) scale(1.25); }
        66% { transform: translate(-50%,-50%) scale(.95); }
        74% { transform: translate(-50%,-50%) scale(1.05); }
        84% { opacity: 1; transform: translate(-50%,-50%) scale(1); }
        100% { opacity: 0; transform: translate(-50%,-50%) scale(1); }
      }
      @keyframes scribal-grow-glow {
        0%, 42% { opacity: 0; transform: translate(-50%,-50%) scale(.4); }
        56% { opacity: .5; transform: translate(-50%,-50%) scale(1.5); }
        100% { opacity: 0; transform: translate(-50%,-50%) scale(2.4); }
      }
      @keyframes scribal-grow-ripple {
        0%, 48% { opacity: 0; transform: translate(-50%,-50%) scale(.3); }
        56% { opacity: .7; }
        100% { opacity: 0; transform: translate(-50%,-50%) scale(1); }
      }
      @keyframes scribal-grow-label {
        0%, 52% { opacity: 0; transform: translate(-50%,-50%) translateY(64px); }
        66% { opacity: 1; transform: translate(-50%,-50%) translateY(56px); }
        86% { opacity: 1; transform: translate(-50%,-50%) translateY(56px); }
        100% { opacity: 0; transform: translate(-50%,-50%) translateY(56px); }
      }
      .scribal-grow-dim { animation: scribal-grow-dim 1.6s ease both; }
      .scribal-grow-ripple { animation: scribal-grow-ripple 1.6s ease both; }
      .scribal-grow-glow { animation: scribal-grow-glow 1.6s ease both; }
      .scribal-grow-left { animation: scribal-grow-left 1.6s cubic-bezier(.4,0,.2,1) both; }
      .scribal-grow-right { animation: scribal-grow-right 1.6s cubic-bezier(.4,0,.2,1) both; }
      .scribal-grow-pop { animation: scribal-grow-pop 1.6s cubic-bezier(.34,1.4,.5,1) both; }
      .scribal-grow-label { animation: scribal-grow-label 1.6s ease both; }
    `}</style>
    <div
      className="scribal-grow-dim"
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        width: 420,
        height: 420,
        transform: "translate(-50%,-50%)",
        background:
          "radial-gradient(circle, rgba(20,16,12,0.12), transparent 62%)",
      }}
    />
    <div
      className="scribal-grow-ripple"
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        width: 120,
        height: 120,
        borderRadius: "50%",
        border: "2.5px solid " + TYPE_BLUE,
      }}
    />
    <div
      className="scribal-grow-glow"
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        width: 92,
        height: 92,
        borderRadius: "50%",
        background:
          "radial-gradient(circle, " + TYPE_BLUE + "b3, transparent 65%)",
      }}
    />
    <GrowLink cls="scribal-grow-left" />
    <GrowLink cls="scribal-grow-right" />
    <GrowLink cls="scribal-grow-pop" w={34} />
    <div
      className="scribal-grow-label"
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        whiteSpace: "nowrap",
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        fontWeight: 800,
        color: TYPE_BLUE,
        letterSpacing: "0.02em",
        textShadow: "0 1px 8px rgba(251,249,244,0.9)",
      }}
    >
      Keywords added
    </div>
  </div>
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
  // Brand-new installs open on the first chapter; returning readers keep their
  // saved place.
  return { v: 0, b: 0, c: 0 };
};

// Reading tabs (mobile "Screens"). Prefer the saved tabs array; else migrate the
// single saved location into one tab; else a fresh first-chapter tab. Always
// returns at least one valid tab, dropping any whose location no longer exists.
const readTabs = (): MTab[] => {
  let liveStudyIds = new Set<string>();
  try {
    const ss = JSON.parse(
      localStorage.getItem("scribal_search_studies") || "[]"
    );
    if (Array.isArray(ss))
      liveStudyIds = new Set(ss.map((s: any) => s && s.id).filter(Boolean));
  } catch {}
  try {
    const raw = localStorage.getItem("scribal_mobile_tabs");
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const valid = arr
          .filter((t: any) => {
            if (!t || typeof t.id !== "string") return false;
            if (t.studyId) return liveStudyIds.has(t.studyId);
            return (
              vols[t.v] &&
              vols[t.v].books[t.b] &&
              vols[t.v].books[t.b].chapters[t.c]
            );
          })
          .map((t: any) =>
            t.studyId
              ? {
                  id: t.id,
                  v: t.v || 0,
                  b: t.b || 0,
                  c: t.c || 0,
                  studyId: t.studyId,
                }
              : { id: t.id, v: t.v, b: t.b, c: t.c }
          );
        if (valid.length) return valid.slice(0, MAX_TABS);
      }
    }
  } catch {}
  const l = readLoc();
  return [{ id: newTabId(), v: l.v, b: l.b, c: l.c }];
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

// Standard LDS abbreviations for the reading header ONLY — the header has
// ~120px for the title, and long names otherwise swallow the chapter number
// ("JST Revela…"). Full names show everywhere else. JST books abbreviate the
// base book behind the JST prefix.
const BOOK_ABBREV: Record<string, string> = {
  "Doctrine and Covenants": "D&C", // matches the app's ref convention
  "Joseph Smith—History": "JS—Hist.",
  "Joseph Smith—Matthew": "JS—Matt.",
  "Articles of Faith": "A of F",
  "Words of Mormon": "W of M",
  "Solomon's Song": "Song",
  "1 Chronicles": "1 Chr.",
  "2 Chronicles": "2 Chr.",
  "1 Corinthians": "1 Cor.",
  "2 Corinthians": "2 Cor.",
  "1 Thessalonians": "1 Thes.",
  "2 Thessalonians": "2 Thes.",
  "1 Samuel": "1 Sam.",
  "2 Samuel": "2 Sam.",
  "1 Kings": "1 Kgs.",
  "2 Kings": "2 Kgs.",
  "1 Peter": "1 Pet.",
  "2 Peter": "2 Pet.",
  "1 Timothy": "1 Tim.",
  "2 Timothy": "2 Tim.",
  Deuteronomy: "Deut.",
  Ecclesiastes: "Eccl.",
  Lamentations: "Lam.",
  Philippians: "Philip.",
  Colossians: "Col.",
  Ephesians: "Eph.",
  Galatians: "Gal.",
  Hebrews: "Heb.",
  Revelation: "Rev.",
  Genesis: "Gen.",
  Leviticus: "Lev.",
  Numbers: "Num.",
  Nehemiah: "Neh.",
  Proverbs: "Prov.",
  Jeremiah: "Jer.",
  Ezekiel: "Ezek.",
  Habakkuk: "Hab.",
  Zephaniah: "Zeph.",
  Zechariah: "Zech.",
  Malachi: "Mal.",
  Matthew: "Matt.",
  Philemon: "Philem.",
  Obadiah: "Obad.",
  Romans: "Rom.",
  Joshua: "Josh.",
  Judges: "Judg.",
  Exodus: "Ex.",
  Esther: "Esth.",
  Isaiah: "Isa.",
  Daniel: "Dan.",
  Hosea: "Hos.",
  Haggai: "Hag.",
  Psalms: "Ps.",
  "1 John": "1 Jn.",
  "2 John": "2 Jn.",
  "3 John": "3 Jn.",
};
// The abbreviated form of a title (bare or behind the JST prefix). Whether it
// is USED is decided by measurement, not prediction: FitTitle renders the full
// name and swaps to this only when the browser reports actual pixel overflow.
const abbrevTitle = (name: string, ch: string | number): string => {
  const base = name.startsWith("JST ") ? name.slice(4) : name;
  const ab = BOOK_ABBREV[base];
  if (!ab) return name + " " + ch;
  return (name === base ? ab : "JST " + ab) + " " + ch;
};

// Shows the widest form of a title that actually fits its box — measured in
// the DOM, so it adapts to any device width, font, or text-size setting.
// Tiers: full name → abbreviated → abbreviated at 0.85em → (if a suffix tag
// like "· session" is present) drop the tag. The chapter name always wins over
// the tag; ellipsis CSS is the last resort for titles with no compact form
// (e.g. sermon date labels). Measurement runs pre-paint, so a clipped wider
// tier is never visible.
function FitTitle({
  full,
  compact,
  suffix,
  suffixStyle,
  style,
}: {
  full: string;
  compact: string;
  suffix?: string;
  suffixStyle?: React.CSSProperties;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [tier, setTier] = useState(0);
  // Ladder: full → compact → compact @0.85em → (drop the suffix tag) →
  // compact @0.72em. The last step only triggers in the rarest squeeze
  // (e.g. doubled JST names on the smallest phones).
  const last = suffix ? 4 : 3;
  // New title (or a resize) → start from the full name and re-measure.
  useLayoutEffect(() => {
    setTier(0);
  }, [full, compact, suffix]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (tier < last && el && el.scrollWidth > el.clientWidth + 1)
      setTier(tier + 1);
  });
  useEffect(() => {
    const onResize = () => setTier(0);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return (
    <span
      ref={ref}
      data-fittitle=""
      style={{
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <span
        style={{
          fontSize:
            tier >= last ? "0.72em" : tier >= 2 ? "0.85em" : undefined,
        }}
      >
        {tier === 0 ? full : compact}
      </span>
      {suffix && tier < 3 ? <span style={suffixStyle}>{suffix}</span> : null}
    </span>
  );
}

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
    scopedRoles,
    setScopedRoles,
    scopedPins,
    setScopedPins,
    scopedThreads,
    setScopedThreads,
    scopedLens,
    setScopedLens,
    getBook,
    moveStudyMarks,
    notes,
    setNote,
  } = useMarks();

  // Study tables: built on desktop, synced here, performable from the phone.
  // Mobile v1 is present-only (the editor stays desktop for now).
  const {
    tables: studyTables,
    createTable: createStudyTable,
    updateTable: updateStudyTable,
    renameTable: renameStudyTable,
    deleteTable: deleteStudyTable,
    mergeRemote: tablesMergeRemote,
  } = useStudyTables();
  const [presentTableId, setPresentTableId] = useState<string | null>(null);
  // The mobile table editor: which table is open for editing.
  const [editTableId, setEditTableId] = useState<string | null>(null);
  // The Study tables home screen (menu entry), with the how-it-works intro.
  const [tablesHomeOpen, setTablesHomeOpen] = useState(false);
  const [tablesIntroSeen, setTablesIntroSeen] = useState(
    () => localStorage.getItem("scribal_tables_intro_seen") === "1"
  );
  // The example table is EPHEMERAL: in-memory only, never persisted or synced,
  // gone on close. Edits route here instead of the real store.
  const [exampleTable, setExampleTable] = useState<StudyTable | null>(null);
  const tableUpdate: typeof updateStudyTable = (id, changes) => {
    if (exampleTable && id === exampleTable.id) {
      setExampleTable((p) =>
        p ? { ...p, ...changes, updatedAt: Date.now() } : p
      );
      return;
    }
    updateStudyTable(id, changes);
  };
  const tableRename: typeof renameStudyTable = (id, name) => {
    if (exampleTable && id === exampleTable.id) {
      setExampleTable((p) => (p ? { ...p, name } : p));
      return;
    }
    renameStudyTable(id, name);
  };
  const openExampleTable = () => {
    const now = Date.now();
    setExampleTable({
      id: "example",
      name: "Example · Faith as a Seed",
      purpose: "lesson",
      bookId: "master",
      createdAt: now,
      updatedAt: now,
      cards: [
        { id: newCardId(), kind: "heading", text: "An experiment on the word" },
        {
          id: newCardId(),
          kind: "text",
          role: "thought",
          text: "Alma is talking to people who feel like outsiders — thrown out of their own synagogues. He doesn't start with an argument. He starts with an invitation to try something small.",
        },
        { id: newCardId(), kind: "scripture", refs: ["Alma 32:21"], bookId: "master" },
        {
          id: newCardId(),
          kind: "question",
          qtype: "analysis",
          text: "Why would Alma define faith by what it is NOT?",
        },
        {
          id: newCardId(),
          kind: "note",
          text: "Pause here. Let two or three people answer before moving on — the silence is doing work.",
        },
        { id: newCardId(), kind: "heading", text: "Plant the seed" },
        {
          id: newCardId(),
          kind: "scripture",
          refs: ["Alma 32:27", "Alma 32:28"],
          passage: true,
          bookId: "master",
        },
        {
          id: newCardId(),
          kind: "quote",
          text: "Faith is a principle of action and of power.",
          attribution: "True to the Faith",
        },
        {
          id: newCardId(),
          kind: "clip",
          url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
          startSec: 0,
          endSec: 12,
          clipSaved: true,
        },
        {
          id: newCardId(),
          kind: "question",
          qtype: "application",
          text: "What is one place in your life where you could give the word a place to be planted this week?",
        },
      ],
    });
    setEditTableId("example");
  };
  // New-table flow: choose blank vs import; "book" picks the marks home for a
  // from-scratch table; "import" lists studies. Mirrors desktop.
  const [newTableFlow, setNewTableFlow] = useState<
    null | "choose" | "book" | "import"
  >(null);
  const [ntSessionName, setNtSessionName] = useState("");
  // After an import, the editor opens with the verse panel on Selected.
  const [editOpenShelf, setEditOpenShelf] = useState(false);
  // A "marking trip": the reader was opened from a table card to mark it;
  // a floating pill offers the way back to that table.
  const [markTripTableId, setMarkTripTableId] = useState<string | null>(null);
  const byOrder = (a: string, b: string) => orderOf(a) - orderOf(b);
  // A study's marked verses grouped by theme — the desktop resolution, with
  // the tolerant link-group fix (raw gid, "group:" prefix, or anchor chapter).
  const mobileStudyThemes = (
    studyId: string
  ): { color: number; label: string; refs: string[] }[] => {
    const rec = studies.find((x) => x.id === studyId);
    const kw = searchStudies.find((x) => x.id === studyId);
    const study = rec || kw;
    if (!study) return [];
    const bookId = study.bookId;
    let inScope: (ref: string) => boolean;
    if (kw) {
      const set = new Set(kw.refs);
      inScope = (r) => set.has(r);
    } else if (rec && rec.type === "linked") {
      const raw = rec.scopeRef || "";
      const gid = raw.startsWith("group:")
        ? raw.slice(6)
        : chapterGroups[raw] || raw;
      // Prefer the snapshot saved with the study; live chapterGroups is only a
      // fallback for old studies (incomplete on unsynced devices — the bug).
      const chapters = new Set(
        rec.memberScopes && rec.memberScopes.length
          ? rec.memberScopes
          : Object.keys(chapterGroups).filter((cs) => chapterGroups[cs] === gid)
      );
      if (chapterGroups[raw] || !raw.startsWith("group:")) chapters.add(raw);
      const extra = new Set(rec.extraRefs || []);
      inScope = (r) => chapters.has(scopeOf(r)) || extra.has(r);
      // Auto-heal: old linked studies (saved before memberScopes existed) get
      // their chapter snapshot stamped the first time they're opened while the
      // group is still intact — so they keep opening correctly after group
      // drift and on other devices, without a manual recompile+save.
      // compiledAt bumps so the heal wins the sync merge and propagates.
      if (
        rec &&
        (!rec.memberScopes || !rec.memberScopes.length) &&
        chapters.size
      ) {
        const heal = Array.from(chapters);
        setStudies((prev) =>
          prev.map((x) =>
            x.id === rec.id
              ? { ...x, memberScopes: heal, compiledAt: Date.now() }
              : x
          )
        );
      }
    } else {
      const extra = new Set((rec && rec.extraRefs) || []);
      inScope = (r) =>
        scopeOf(r) === (rec ? rec.scopeRef : "") || extra.has(r);
    }
    const byColor = new Map<number, Set<string>>();
    for (const m of allMarks) {
      if (m.bookId !== bookId || !inScope(m.reference)) continue;
      let st = byColor.get(m.color);
      if (!st) {
        st = new Set();
        byColor.set(m.color, st);
      }
      st.add(m.reference);
    }
    const bk = getBook(bookId);
    const nameFor = (ref: string, color: number): string => {
      const scoped = bk.scopedLabels?.[resolveScope(scopeOf(ref))]?.[color];
      const book = bk.colorLabels?.[color];
      return ((scoped || book || "") as string).trim();
    };
    return Array.from(byColor.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([color, refset]) => {
        const refs = Array.from(refset).sort(byOrder);
        return {
          color,
          label: refs.length ? nameFor(refs[0], color) : "",
          refs,
        };
      });
  };
  const importStudyToTable = (meta: {
    id: string;
    name: string;
    bookId: string;
  }) => {
    setNewTableFlow(null);
    setTablesHomeOpen(false);
    setStudiesOpen(false);
    const id = createStudyTable(
      meta.name.trim() || "Untitled",
      undefined,
      meta.bookId
    );
    const cards: TableCard[] = [];
    const covered = new Set<string>();
    mobileStudyThemes(meta.id).forEach((t) => {
      const label = (t.label || "").trim() || "Theme " + t.color;
      t.refs.forEach((r) => {
        if (covered.has(r)) return;
        covered.add(r);
        cards.push({
          id: newCardId(),
          kind: "scripture" as const,
          refs: [r],
          bookId: meta.bookId,
          shelfGroup: label,
          shelfGroupColor: t.color,
        });
      });
    });
    const rec = studies.find((x) => x.id === meta.id);
    const kw = searchStudies.find((x) => x.id === meta.id);
    Array.from(
      new Set([...(rec?.extraRefs || []), ...(kw ? kw.refs : [])])
    )
      .filter((r) => !covered.has(r))
      .sort(byOrder)
      .forEach((r) => {
        cards.push({
          id: newCardId(),
          kind: "scripture" as const,
          refs: [r],
          bookId: meta.bookId,
          shelfGroup: "Added verses",
        });
      });
    if (cards.length) updateStudyTable(id, { shelf: cards });
    setEditOpenShelf(true);
    setEditTableId(id);
  };
  const pickTableBook = (bookId: string) => {
    setNewTableFlow(null);
    setTablesHomeOpen(false);
    setStudiesOpen(false);
    const id = createStudyTable("Untitled", undefined, bookId);
    setEditOpenShelf(false);
    setEditTableId(id);
  };

  const {
    entries: vaultEntries,
    mergeRemote: vaultMergeRemote,
  } = useVault();

  const { wordTags, hasTag, addTag, removeTag, mergeRemote: wordTagsMergeRemote } =
    useWordTags();

  const [dark, setDark] = useState<boolean>(() => {
    const saved = localStorage.getItem("scribal_theme");
    if (saved) return saved === "dark";
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  });

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

  // Warm tone is a full palette swap, mirroring dark mode: when it's on we
  // hand the whole shell the WARM (paper/beige) palette instead of the neutral
  // one, so every white surface — header, toolbars, cards, sheets — turns beige
  // together, not just the reading pane.
  const C = reading.warm
    ? dark
      ? WARM.dark
      : WARM.light
    : dark
    ? PALETTE.dark
    : PALETTE.light;

  const readBg = reading.warm ? (dark ? "#1a1410" : "#f4ecd6") : C.bg;

  // Keep the iOS status-bar tint (the <meta name="theme-color"> the browser
  // paints behind the notch/clock during scroll) matched to the live theme.
  // Hardcoded in index.html, it otherwise shows a stale/white strip when the
  // user is in dark mode or warm tone.
  useEffect(() => {
    const meta = document.querySelector(
      'meta[name="theme-color"]'
    ) as HTMLMetaElement | null;
    if (meta) meta.setAttribute("content", C.bg);
    // Keep the page background in sync with the live theme. The body fills the
    // area behind the safe-area insets (the strip under the iOS home
    // indicator); if it's left a different color a stray bar shows there.
    document.documentElement.style.backgroundColor = C.bg;
    document.body.style.backgroundColor = C.bg;
    // Cache the effective background so the next launch's splash (and the
    // pre-React paint in index.html) opens in this same theme color.
    try {
      localStorage.setItem("scribal_bg", C.bg);
    } catch {}
  }, [C.bg]);

  // Lock the document while the mobile shell is mounted: it's a fixed
  // full-screen app that scrolls inside its own containers, so the page itself
  // must never scroll or rubber-band. Without this, dragging on a non-scrolling
  // spot (like the bottom tool tray) bounces the whole page and the tray looks
  // like it's being pulled/stretched. Scoped here and restored on unmount so it
  // can never affect the desktop shell, which does use page scrolling.
  useEffect(() => {
    const de = document.documentElement;
    const bd = document.body;
    const prev = {
      htmlOverflow: de.style.overflow,
      bodyOverflow: bd.style.overflow,
      htmlHeight: de.style.height,
      bodyHeight: bd.style.height,
      overscroll: bd.style.overscrollBehavior,
    };
    de.style.overflow = "hidden";
    bd.style.overflow = "hidden";
    de.style.height = "100%";
    bd.style.height = "100%";
    bd.style.overscrollBehavior = "none";
    return () => {
      de.style.overflow = prev.htmlOverflow;
      bd.style.overflow = prev.bodyOverflow;
      de.style.height = prev.htmlHeight;
      bd.style.height = prev.bodyHeight;
      bd.style.overscrollBehavior = prev.overscroll;
    };
  }, []);

  const readText = reading.warm ? (dark ? "#e9ddc2" : "#53442c") : C.text;
  const titleSize = (20 * reading.fontScale).toFixed(1) + "px";
  const verseSize = (19 * reading.fontScale).toFixed(1) + "px";

  // Reading tabs back the single `loc`: the active tab feeds `loc`, and writing
  // `loc` writes the active tab. Everything downstream still reads `loc` exactly
  // as before — no other reading/marking/scroll code changes.
  const [tabs, setTabs] = useState<MTab[]>(readTabs);
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    try {
      return localStorage.getItem("scribal_mobile_active") || "";
    } catch {
      return "";
    }
  });
  const [screensOpen, setScreensOpen] = useState(false);
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const loc = useMemo<Loc>(
    () => ({ v: activeTab.v, b: activeTab.b, c: activeTab.c }),
    [activeTab.v, activeTab.b, activeTab.c]
  );
  const setLoc = (nl: Loc) =>
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId ? { ...t, v: nl.v, b: nl.b, c: nl.c } : t
      )
    );
  const [pen, setPen] = useState(readPen);
  const [penOpen, setPenOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  // When set, the "add a chapter to this study" sheet is open for this recorded
  // (chapter or linked) study — it links the chosen chapter into the study.
  const [addChapterStudy, setAddChapterStudy] = useState<Study | null>(null);
  // The add sheet opens on a choice (add a chapter vs search & add verses).
  const [addSheetMode, setAddSheetMode] = useState<"choice" | "chapter">(
    "choice"
  );
  // When set, the search panel is adding loose verses to this recorded study.
  const [addVersesRecId, setAddVersesRecId] = useState<string | null>(null);
  // After adding verses to a recorded study, land on a markable reading list of
  // its verses (the added ones first) so they can be marked, then compiled.
  const [markRec, setMarkRec] = useState<Study | null>(null);
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
    wordTagsMergeRemote(
      data["scribal_wordtags"],
      data["scribal_wordtags_tomb"]
    );
    // Study tables (built on desktop): the hook does a field-level
    // last-write-wins merge with tombstones, same rules as the desktop shell.
    tablesMergeRemote(data["scribal_tables_v1"]);
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
            // A study's shape can change: adding a chapter promotes a chapter
            // study into a linked study (new type + scopeRef), stamped with a
            // newer compiledAt. Adopt the remote's type + scope when it's newer,
            // otherwise that promotion would silently never reach this device.
            const remoteNewer = (rs.compiledAt || 0) > (local.compiledAt || 0);
            const type = remoteNewer && rs.type ? rs.type : local.type;
            const scopeRef =
              remoteNewer && rs.scopeRef ? rs.scopeRef : local.scopeRef;
            // Loose added verses now sync like keyword refs: the side that
            // edited its set most recently wins (so add AND remove both
            // propagate). Legacy records without a timestamp fall back to a
            // union, so an older add is never lost until the set is re-edited.
            const lExtraAt = local.extraRefsAt || 0;
            const rExtraAt = rs.extraRefsAt || 0;
            const extraRefsAt = Math.max(lExtraAt, rExtraAt);
            let extraRefs: string[] | undefined = local.extraRefs;
            if (rExtraAt > lExtraAt) extraRefs = rs.extraRefs;
            else if (lExtraAt > rExtraAt) extraRefs = local.extraRefs;
            else if (lExtraAt === 0 && rExtraAt === 0) {
              const u = Array.from(
                new Set([...(local.extraRefs || []), ...(rs.extraRefs || [])])
              );
              extraRefs = u.length ? u : undefined;
            }
            const extraChanged =
              (extraRefs || []).join("|") !==
                (local.extraRefs || []).join("|") ||
              extraRefsAt !== (local.extraRefsAt || 0);
            if (
              name !== local.name ||
              nameAt !== (local.nameAt || 0) ||
              compiledAt !== (local.compiledAt || 0) ||
              deletedAt !== (local.deletedAt || 0) ||
              type !== local.type ||
              scopeRef !== local.scopeRef ||
              extraChanged
            ) {
              const merged: Study = {
                ...local,
                type,
                scopeRef,
                name,
                nameAt,
                compiledAt,
                // Adopt the view from whichever device saved most recently
                // (matching type/scope), so the tab choice stays in sync too.
                view: remoteNewer && rs.view ? rs.view : local.view,
              };
              if (extraRefs && extraRefs.length) merged.extraRefs = extraRefs;
              else delete merged.extraRefs;
              if (extraRefsAt) merged.extraRefsAt = extraRefsAt;
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
                ? {
                    ...local,
                    name: rs.name,
                    refs: rs.refs,
                    note: rs.note ?? local.note,
                    view: rs.view ?? local.view,
                    linkedScope: rs.linkedScope,
                    updatedAt: rAt,
                  }
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
  // The built-in, read-only "See how it works" example (marked John 1 + a live
  // compile). Opens over everything; writes nothing.
  const [exampleOpen, setExampleOpen] = useState(false);
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
  // After gathering a keyword search into a chapter's existing linked search, the
  // just-added verses show on top (so they can be marked). Clears when you leave
  // that study, so reopening shows everything back in book order.
  const [gatheredTop, setGatheredTop] = useState<{
    id: string;
    refs: string[];
  } | null>(null);
  useEffect(() => {
    if (gatheredTop && openStudyId !== gatheredTop.id) setGatheredTop(null);
  }, [openStudyId, gatheredTop]);
  // Remove-verses mode on the keyword study screen: tap verses to check them,
  // then remove from the study. Resets whenever the open study changes.
  const [removeMode, setRemoveMode] = useState(false);
  const [removeSel, setRemoveSel] = useState<Set<string>>(new Set());
  useEffect(() => {
    setRemoveMode(false);
    setRemoveSel(new Set());
  }, [openStudyId]);
  // Send-verses mode on the chapter reading screen: tap verses to check them,
  // then send to a new or existing study (mirrors desktop's "Send verses").
  // Resets when the reading location or active tab changes.
  const [sendMode, setSendMode] = useState(false);
  const [sendSel, setSendSel] = useState<Set<string>>(new Set());
  const [sendRefs, setSendRefs] = useState<string[] | null>(null);
  // Send → "Set aside in a study table": the table picker step.
  const [sendTablePicking, setSendTablePicking] = useState(false);
  const [sendPicking, setSendPicking] = useState(false);
  useEffect(() => {
    setSendMode(false);
    setSendSel(new Set());
  }, [activeTabId, loc.v, loc.b, loc.c]);
  const prevBookForStudy = useRef<string | null>(null);
  // When set, the search screen is open to ADD verses to this keyword study
  // (its current verses are pre-selected); confirming merges the selection back.
  const [addToStudyId, setAddToStudyId] = useState<string | null>(null);
  // When set, the search overlay is in "link results to this chapter" mode: on
  // confirm, the picked verses become a keyword study linked to this scope.
  const [linkToChapterScope, setLinkToChapterScope] = useState<string | null>(
    null
  );
  // The keyword study whose link sheet is open (null = closed), plus the sheet's
  // sub-view: "menu" = standalone two-options OR linked members+actions;
  // "chapter" = the chapter picker for "Add a chapter to this study".
  const [kwLinkStudy, setKwLinkStudy] = useState<SearchStudy | null>(null);
  const [kwLinkMode, setKwLinkMode] = useState<"menu" | "chapter">("menu");
  const [menuOpen, setMenuOpen] = useState(false);
  const [compileOpen, setCompileOpen] = useState(false);
  // When set, Compile + Save are scoped to this search study, not the chapter.
  const [compileStudy, setCompileStudy] = useState<SearchStudy | null>(null);
  // When set, Compile is scoped to this recorded chapter/linked study (so the
  // Studies list can jump straight to its compiled notes).
  const [compileRec, setCompileRec] = useState<Study | null>(null);
  const [compileAnim, setCompileAnim] = useState<{
    show: boolean;
    duration: number;
    flyers: CompileFlyer[];
    colors: number[];
  }>({ show: false, duration: 1000, flyers: [], colors: [] });
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
  const [slidesOpen, setSlidesOpen] = useState(false);
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
      // legacy flag from the retired gestures sheet — clear it if present
      localStorage.removeItem("scribal_mobile_show_gestures");
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
  // A brief, tappable escape hatch after each fresh mark — undo on mobile is
  // otherwise a hidden gesture (two-finger tap), which fat-fingered marks need.
  const [undoFlash, setUndoFlash] = useState(false);
  const undoFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevMarkCount = useRef(marks.length);
  useEffect(() => {
    if (marks.length > prevMarkCount.current) {
      setUndoFlash(true);
      if (undoFlashTimer.current) clearTimeout(undoFlashTimer.current);
      undoFlashTimer.current = setTimeout(() => setUndoFlash(false), 4000);
    }
    prevMarkCount.current = marks.length;
  }, [marks.length]);
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

  // Persist the tabs array + which one is active (device-local reading session).
  useEffect(() => {
    try {
      localStorage.setItem("scribal_mobile_tabs", JSON.stringify(tabs));
    } catch {}
  }, [tabs]);
  useEffect(() => {
    try {
      localStorage.setItem("scribal_mobile_active", activeTabId);
    } catch {}
  }, [activeTabId]);
  // If the active id ever points nowhere (first run, migration, bad restore),
  // fall back to the first tab.
  useEffect(() => {
    if (tabs.length && !tabs.some((t) => t.id === activeTabId))
      setActiveTabId(tabs[0].id);
  }, [tabs, activeTabId]);

  // A study tab drives the existing loose-verse screen + the study's book; a
  // chapter tab clears it and restores the book. Keyed on the active tab's
  // studyId so it fires on tab switches, not on the add-verses sub-flow's
  // manual openStudyId toggles.
  useEffect(() => {
    const sid = activeTab.studyId || null;
    if (sid) {
      const st = searchStudies.find((s) => s.id === sid);
      if (st) {
        if (prevBookForStudy.current == null)
          prevBookForStudy.current = activeBookId;
        if (st.bookId !== activeBookId) setActiveBook(st.bookId);
        setOpenStudyId(sid);
      }
    } else {
      if (prevBookForStudy.current != null) {
        if (prevBookForStudy.current !== activeBookId)
          setActiveBook(prevBookForStudy.current);
        prevBookForStudy.current = null;
      }
      setOpenStudyId(null);
    }
  }, [activeTab.studyId]);

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
    if (!next) return;
    // Stepping prev/next means reading on — land at the top of the chapter,
    // not wherever it was last scrolled to. (Jumping back in via browse or
    // search still restores the saved position.)
    delete scrollPos.current[locKey(next)];
    setLoc(next);
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
  // The Joseph Smith sermons volume titles each entry by the date it was given
  // rather than a sequence number; every other volume keeps "<Book> <chapter>".
  const displayTitle = isSermonsVolume(vols[loc.v].volume)
    ? sermonLabel((chapter as { title?: string }).title, chapter.chapter)
    : bookName + " " + chapter.chapter;
  // Header shows the full title when it fits; FitTitle swaps to this compact
  // form only on measured overflow. displayTitle stays full everywhere else.
  const headerCompact = isSermonsVolume(vols[loc.v].volume)
    ? displayTitle
    : abbrevTitle(bookName, chapter.chapter);

  // Gentle progress: a quiet reflection of the study so far — distinct chapters
  // and books marked, plus total marks across every book. No streaks, no goals.
  const progress = useMemo(() => {
    const chapters = new Set<string>();
    const books = new Set<string>();
    allMarks.forEach((m) => {
      const ref = m.reference || "";
      const ci = ref.indexOf(":");
      const scope = (ci < 0 ? ref : ref.slice(0, ci)).trim();
      if (!scope) return;
      chapters.add(scope);
      const book = scope.replace(/\s+\d+\s*$/, "").trim();
      if (book) books.add(book);
    });
    return { chapters: chapters.size, books: books.size, total: allMarks.length };
  }, [allMarks]);

  const title = chapterScopeKey(vols[loc.v].books[loc.b], chapter);

  // Theme names are per chapter (study scope). Each chapter keeps its own
  // palette, so naming or clearing one chapter never touches another.
  const scopeOf = (ref: string) => {
    const i = ref.indexOf(":");
    return i < 0 ? ref : ref.slice(0, i);
  };
  // A chapter's label scope: its group's shared scope if linked, else its own.
  const resolveScope = (cs: string) =>
    // During the first-run walkthrough the open chapter IS the demo chapter, so
    // keep it standalone — otherwise the throwaway study inherits whatever real
    // link group this chapter belongs to, which would collapse its themes and
    // mis-key (hide) their names.
    mtourOpen && cs === title
      ? cs
      : chapterGroups[cs]
      ? "group:" + chapterGroups[cs]
      : cs;
  // A chapter reads as "combined" when a live keyword search is linked into it
  // (or its group). Derived live — no stored flag to drift out of sync.
  const chapterIsCombined = (cs: string) => {
    const r = resolveScope(cs);
    return searchStudies.some(
      (s) =>
        !isSearchDeleted(s) &&
        !!s.linkedScope &&
        resolveScope(s.linkedScope) === r
    );
  };
  // Plays the red+blue→purple merge splash on the visible link button the moment
  // a study turns combined. Bumped by the link actions; auto-clears.
  const [mergeFlash, setMergeFlash] = useState(0);
  const [linkFlash, setLinkFlash] = useState(false);
  useEffect(() => {
    if (!mergeFlash) return;
    setLinkFlash(true);
    const t = setTimeout(() => setLinkFlash(false), 1500);
    return () => clearTimeout(t);
  }, [mergeFlash]);
  const triggerMergeFlash = () => setMergeFlash((n) => n + 1);

  // Chapter-link moment + grow pulse, mirroring the desktop link-watcher. A
  // render-to-render diff of the chapter groups and each study's verse count
  // fires the right animation no matter which action made the change; the
  // combined splash above keeps its own trigger. A short ready-gate keeps
  // loading saved data or a sync from playing anything on startup.
  const [chapterLinkFlash, setChapterLinkFlash] = useState(0);
  const [chapterLinkOn, setChapterLinkOn] = useState(false);
  useEffect(() => {
    if (!chapterLinkFlash) return;
    setChapterLinkOn(true);
    const t = setTimeout(() => setChapterLinkOn(false), 1650);
    return () => clearTimeout(t);
  }, [chapterLinkFlash]);
  const [growFlash, setGrowFlash] = useState(0);
  const [growOn, setGrowOn] = useState(false);
  useEffect(() => {
    if (!growFlash) return;
    setGrowOn(true);
    const t = setTimeout(() => setGrowOn(false), 1700);
    return () => clearTimeout(t);
  }, [growFlash]);
  const linkWatchReady = useRef(false);
  const prevChapGroups = useRef<Record<string, string>>({});
  const prevStudyRefs = useRef<Record<string, number>>({});
  useEffect(() => {
    const id = window.setTimeout(() => {
      linkWatchReady.current = true;
    }, 1200);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    const curGroups = chapterGroups;
    const curStudyRefs: Record<string, number> = {};
    searchStudies.forEach((s) => {
      if (!isSearchDeleted(s)) curStudyRefs[s.id] = s.refs.length;
    });
    if (!linkWatchReady.current) {
      prevChapGroups.current = curGroups;
      prevStudyRefs.current = curStudyRefs;
      return;
    }
    // A chapter newly joined (or changed) a group -> chapter-link moment.
    for (const scope of Object.keys(curGroups)) {
      if (prevChapGroups.current[scope] === curGroups[scope]) continue;
      const gid = curGroups[scope];
      const other = Object.keys(curGroups).find(
        (s) => s !== scope && curGroups[s] === gid
      );
      if (other) setChapterLinkFlash((n) => n + 1);
      break;
    }
    // An existing study that gained verses -> grow pulse (new studies and
    // removals don't pulse).
    for (const sid of Object.keys(curStudyRefs)) {
      const before = prevStudyRefs.current[sid];
      if (before === undefined) continue;
      if (curStudyRefs[sid] <= before) continue;
      setGrowFlash((n) => n + 1);
      break;
    }
    prevChapGroups.current = curGroups;
    prevStudyRefs.current = curStudyRefs;
  }, [chapterGroups, searchStudies]);
  // Stable distinct color for each link group.
  const groupColor = (gid: string) => {
    const ids = Array.from(new Set(Object.values(chapterGroups))).sort();
    const i = ids.indexOf(gid);
    return LINK_COLORS[(i < 0 ? 0 : i) % LINK_COLORS.length];
  };
  // The color of the study a chapter scope anchors: its group color if linked to
  // other chapters, else a stable color derived from the scope (so a lone
  // chapter that has a linked keyword search still reads as one colored study).
  const anchorColor = (scope: string): string => {
    const gid = chapterGroups[scope];
    if (gid) return groupColor(gid);
    return LINK_COLORS[hashScope(scope) % LINK_COLORS.length];
  };

  // ---- Reading tabs ("Screens") -------------------------------------------
  // Open a new tab. Optional target location; defaults to the current chapter.
  // Phase 2 (link rework) will call openTab(targetLoc) for "open in new tab".
  const openTab = (target?: Loc) => {
    if (tabs.length >= MAX_TABS) return;
    const l = target || loc;
    const id = newTabId();
    setTabs([...tabs, { id, v: l.v, b: l.b, c: l.c }]);
    setActiveTabId(id);
  };
  const switchTab = (id: string) => {
    setActiveTabId(id);
    setScreensOpen(false);
  };
  const closeTab = (id: string) => {
    if (tabs.length <= 1) return; // always keep one panel open
    const idx = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (id === activeTabId) {
      const fb = next[Math.min(idx, next.length - 1)];
      if (fb) setActiveTabId(fb.id);
    }
  };
  const closeAllTabs = () => {
    setTabs([{ id: activeTab.id, v: loc.v, b: loc.b, c: loc.c }]);
    setActiveTabId(activeTab.id);
  };
  // Open a keyword study as a tab (switch to it if already open). Sets
  // openStudyId explicitly so re-showing an already-active study works; the
  // active-tab effect handles the book swap.
  const openStudyTab = (study: SearchStudy) => {
    const existing = tabs.find((t) => t.studyId === study.id);
    if (existing) {
      setActiveTabId(existing.id);
      setOpenStudyId(study.id);
      setScreensOpen(false);
      return;
    }
    if (tabs.length >= MAX_TABS) {
      flash("Close a tab to open another");
      return;
    }
    const first = study.refs[0];
    const cl = first ? chapterLoc.get(refScope(first)) : undefined;
    const id = newTabId();
    setTabs([
      ...tabs,
      {
        id,
        v: cl ? cl.v : loc.v,
        b: cl ? cl.b : loc.b,
        c: cl ? cl.c : loc.c,
        studyId: study.id,
      },
    ]);
    setActiveTabId(id);
    setOpenStudyId(study.id);
    setScreensOpen(false);
  };
  // Leaving the study screen inside a tab turns it back into a plain reading
  // tab, so switching back later lands on the last screen used there — not a
  // forced reopen of the study. The active-tab effect handles the book restore.
  const leaveStudyTab = () => {
    setOpenStudyId(null);
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId && t.studyId ? { ...t, studyId: undefined } : t
      )
    );
  };
  const openStudyTabById = (id: string) => {
    const st = searchStudies.find((s) => s.id === id);
    if (st) openStudyTab(st);
  };
  // Per-card display: title, sub-line, plain-text preview, link-group color.
  const tabInfo = (t: MTab) => {
    if (t.studyId) {
      const st = searchStudies.find((s) => s.id === t.studyId);
      const bn = st
        ? books.find((b) => b.id === st.bookId)?.name || "Master Book"
        : "";
      const idx = verseByRef();
      const preview = st
        ? st.refs
            .slice(0, 3)
            .map((r) => (idx.get(r) ? idx.get(r)!.text : ""))
            .join(" ")
        : "";
      return {
        study: true,
        title: st ? st.name : "Study",
        titleCompact: st ? st.name : "Study",
        sub: st
          ? st.refs.length +
            (st.refs.length === 1 ? " verse · " : " verses · ") +
            bn
          : "",
        preview:
          preview.length > 170 ? preview.slice(0, 170) + "\u2026" : preview,
        linked: !!(st && st.linkedScope),
        color: (st && st.linkedScope
          ? anchorColor(st.linkedScope)
          : null) as string | null,
      };
    }
    const bk = vols[t.v].books[t.b];
    const ch = bk.chapters[t.c];
    const scope = chapterScopeKey(bk, ch);
    const gid = chapterGroups[scope];
    const preview = ch.verses
      .slice(0, 2)
      .map((vv: any) => vv.text)
      .join(" ");
    return {
      study: false,
      title: bk.book + " " + ch.chapter,
      titleCompact: abbrevTitle(bk.book, ch.chapter),
      sub: vols[t.v].volume,
      preview: preview.length > 170 ? preview.slice(0, 170) + "\u2026" : preview,
      linked:
        !!gid ||
        searchStudies.some(
          (s) => !isSearchDeleted(s) && s.linkedScope === scope
        ),
      color: gid
        ? groupColor(gid)
        : searchStudies.some(
            (s) => !isSearchDeleted(s) && s.linkedScope === scope
          )
        ? anchorColor(scope)
        : null,
    };
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

  // Keyword searches gathered into the current chapter's study — any search whose
  // linkedScope points at this chapter or anywhere in its group. Each opens in its
  // own tab and can be unlinked here, exactly like a linked chapter (mirrors the
  // desktop chapter panel's "Linked searches" section).
  const chapterLinkScopes = new Set<string>([title, ...groupMembers(title)]);
  const chapterLinkedSearches = searchStudies.filter((s) => {
    if (isSearchDeleted(s) || !s.linkedScope) return false;
    return chapterLinkScopes.has(s.linkedScope);
  });
  const unlinkSearch = (id: string) => {
    setSearchStudies((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, linkedScope: undefined, updatedAt: Date.now() } : s
      )
    );
  };
  // Remove the checked verses from a study (marks stay in the book). The study
  // itself is only deleted from the Studies screen.
  const removeSelectedVerses = (id: string) => {
    if (!removeSel.size) return;
    const n = removeSel.size;
    setSearchStudies((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              refs: s.refs.filter((r) => !removeSel.has(r)),
              updatedAt: Date.now(),
            }
          : s
      )
    );
    setRemoveMode(false);
    setRemoveSel(new Set());
    flash(n === 1 ? "Verse removed" : n + " verses removed");
  };

  // ---- Search studies open as reading tabs. Opening routes to a study tab; the
  // active-tab effect drives the loose-verse screen + the study's book. ----
  const openStudy = (study: SearchStudy, _bookId?: string) => {
    setHomeOpen(false);
    setSearchOpen(false);
    setMenuOpen(false);
    setStudiesOpen(false);
    openStudyTab(study);
  };
  const deleteSearchStudy = (id: string) => {
    setSearchStudies((prev) =>
      prev.map((s) => (s.id === id ? { ...s, deletedAt: Date.now() } : s))
    );
    setTabs((prev) => {
      const next = prev.filter((t) => t.studyId !== id);
      return next.length
        ? next
        : [{ id: newTabId(), v: loc.v, b: loc.b, c: loc.c }];
    });
  };

  // Move a study (with its marks, notes, theme names and relational pair) into a
  // different book, clearing them from the old one — for giving a study its own
  // dedicated book. Works for chapter, linked, and keyword studies.
  type MoveTarget = {
    id: string;
    kind: "chapter" | "linked" | "keyword";
    bookId: string;
    name: string;
    refs: string[];
    scope: string;
  };
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  // Every reference a study owns in its book — marked verses in scope, verses it
  // carries notes on, plus loose added verses.
  const studyRefsFor = (
    bid: string,
    refOk: (ref: string) => boolean,
    extra?: string[]
  ) => {
    const set = new Set<string>(extra || []);
    allMarks.forEach((m) => {
      if (m.bookId === bid && refOk(m.reference)) set.add(m.reference);
    });
    const bk = getBook(bid);
    Object.keys(bk.notes || {}).forEach((k) => {
      const ref = k.split("|").pop();
      if (ref && refOk(ref)) set.add(ref);
    });
    return Array.from(set);
  };
  const performMove = (target: MoveTarget, targetBookId: string) => {
    if (targetBookId !== target.bookId) {
      moveStudyMarks(target.bookId, targetBookId, target.refs, target.scope);
      if (target.kind === "keyword") {
        setSearchStudies((prev) =>
          prev.map((s) =>
            s.id === target.id
              ? { ...s, bookId: targetBookId, updatedAt: Date.now() }
              : s
          )
        );
      } else {
        setStudies((prev) =>
          prev.map((s) =>
            s.id === target.id
              ? { ...s, bookId: targetBookId, compiledAt: Date.now() }
              : s
          )
        );
      }
    }
    setMoveTarget(null);
  };
  const tryMove = (
    target: MoveTarget,
    targetBookId: string,
    targetName: string
  ) => {
    if (targetBookId === target.bookId) {
      setMoveTarget(null);
      return;
    }
    // Warn if the destination is already in use, and name what's there.
    const tMarks = allMarks.filter((m) => m.bookId === targetBookId);
    const markedRefs = new Set(tMarks.map((m) => m.reference));
    if (markedRefs.size > 0) {
      const owners: string[] = [];
      searchStudies.forEach((s) => {
        if (
          s.bookId === targetBookId &&
          !(target.kind === "keyword" && s.id === target.id) &&
          s.refs.some((r) => markedRefs.has(r))
        )
          owners.push(s.name);
      });
      studies.forEach((s) => {
        if (s.bookId !== targetBookId || s.id === target.id) return;
        const chs =
          s.type === "linked"
            ? Object.keys(chapterGroups).filter(
                (c) => chapterGroups[c] === s.scopeRef
              )
            : [s.scopeRef];
        if (tMarks.some((m) => chs.includes(scopeOf(m.reference))))
          owners.push(s.name);
      });
      const belongs = owners.length
        ? " They belong to: " + owners.join(", ") + "."
        : "";
      const ok = window.confirm(
        targetName +
          " already has " +
          markedRefs.size +
          " marked verse" +
          (markedRefs.size === 1 ? "" : "s") +
          "." +
          belongs +
          '\n\nMoving "' +
          target.name +
          '" here keeps both sets of marks together. Continue?'
      );
      if (!ok) return;
    }
    performMove(target, targetBookId);
  };
  // Search → "Next": stash the picked verses and open the source + name step.
  const onLinkConfirm = (refs: string[], label?: string) => {
    if (!refs.length) return;
    if (linkToChapterScope) {
      const scope = linkToChapterScope;
      setLinkToChapterScope(null);
      setSearchOpen(false);
      linkSearchToChapter(refs, scope, label);
      return;
    }
    const ordered = refs.slice().sort((a, b) => orderOf(a) - orderOf(b));
    setLinkDraftRefs(ordered);
    setDraftName("");
    setDraftSource("master");
    setDraftSessionId("");
    setDraftNewName("");
    setSearchOpen(false);
  };

  // Make the picked verses a keyword study linked to a chapter: created in that
  // chapter's book, linkedScope set, opened as a tab. No naming/book step — it
  // folds into the chapter's study (mirrors desktop's linkSearchToChapterTab).
  const linkSearchToChapter = (refs: string[], scope: string, label?: string) => {
    if (!refs.length || !scope) return;
    const newOrdered = refs.slice().sort((a, b) => orderOf(a) - orderOf(b));
    // A chapter keeps ONE gathered search. If one already exists anywhere in this
    // chapter's group, add the new verses to it (fresh ones on top to be marked,
    // stored in book order) rather than spawning a second tab.
    const groupScopes = groupMembers(scope).length
      ? groupMembers(scope)
      : [scope];
    const existing = searchStudies.find(
      (s) =>
        !isSearchDeleted(s) &&
        !!s.linkedScope &&
        groupScopes.includes(s.linkedScope)
    );
    if (existing) {
      const existingSet = new Set(existing.refs);
      const fresh = newOrdered.filter((r) => !existingSet.has(r));
      const mergedBookOrder = Array.from(
        new Set([...existing.refs, ...newOrdered])
      ).sort((a, b) => orderOf(a) - orderOf(b));
      setSearchStudies((prev) =>
        prev.map((s) =>
          s.id === existing.id
            ? { ...s, refs: mergedBookOrder, updatedAt: Date.now() }
            : s
        )
      );
      const esc = "searchstudy:" + existing.id;
      Array.from(new Set(newOrdered.map((r) => scopeOf(r)))).forEach((ch) =>
        seedScopeLabels(esc, scopedLabels[ch] || {})
      );
      if (fresh.length) setGatheredTop({ id: existing.id, refs: fresh });
      openStudyTab(existing);
      flash(fresh.length ? "Added to linked search" : "Already in this search");
      return;
    }
    const study: SearchStudy = {
      id: "ss_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      name: (label || "").trim() || "Search",
      bookId: activeBookId,
      refs: newOrdered,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      linkedScope: scope,
    };
    setSearchStudies((prev) => [study, ...prev]);
    const sscope = "searchstudy:" + study.id;
    Array.from(new Set(newOrdered.map((r) => scopeOf(r)))).forEach((ch) =>
      seedScopeLabels(sscope, scopedLabels[ch] || {})
    );
    openStudyTab(study);
    flash("Search linked");
    triggerMergeFlash();
  };

  // Add verses to an existing keyword/imported study, or fork a new copy with the
  // additions. The selection IS the full new verse set (the study's verses come
  // pre-selected). Refs edits + new copies sync across devices via the shared
  // studies store.
  // The selection is ONLY the additions — merged into the study, never
  // replacing it (owner rule, Jul 14, aligned with desktop after the
  // update-replaces bug wiped a study; SCR-38). Removing verses lives in the
  // study view's "Remove verses", not here. The flash names the specific
  // verses that were already in the study, since search picks its destination
  // study at the end and results can't flag duplicates up front.
  const addFlash = (added: number, dupeRefs: string[], name: string) => {
    const nm = "“" + name + "”";
    const dupList =
      dupeRefs.slice(0, 2).join(", ") +
      (dupeRefs.length > 2 ? " (+" + (dupeRefs.length - 2) + " more)" : "");
    flash(
      added === 0
        ? (dupeRefs.length === 1
            ? dupList + " is already in " + nm
            : "Already in " + nm + ": " + dupList) + " — nothing changed"
        : "Added " +
            (added === 1 ? "1 verse" : added + " verses") +
            " to " +
            nm +
            (dupeRefs.length > 0 ? " — already there: " + dupList : "")
    );
  };
  // iOS-PWA scroll-freeze guard: reopening the study screen in the same frame
  // the search sheet unmounts — with the keyboard still up — can leave the
  // study's scroller frozen until the screen is fully remounted (hit on
  // device, Jul 15). Dismiss the keyboard first, then reopen a beat later so
  // the sheet is gone and the keyboard has settled before the scroller mounts.
  const closeSearchThen = (reopen: () => void) => {
    const ae = document.activeElement as HTMLElement | null;
    if (ae && typeof ae.blur === "function") ae.blur();
    window.setTimeout(reopen, 300);
  };
  const handleAddToStudy = (refs: string[], mode: "update" | "copy") => {
    const id = addToStudyId;
    setAddToStudyId(null);
    setSearchOpen(false);
    if (!refs.length) return;
    const study = searchStudies.find((s) => s.id === id);
    if (!study) return;
    const merged = Array.from(new Set([...study.refs, ...refs])).sort(
      (a, b) => orderOf(a) - orderOf(b)
    );
    if (mode === "copy") {
      const copy: SearchStudy = {
        id: "ss_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        name: study.name + " (copy)",
        bookId: study.bookId,
        refs: merged,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setSearchStudies((prev) => [copy, ...prev]);
      const scope = "searchstudy:" + copy.id;
      Array.from(new Set(merged.map((r) => scopeOf(r)))).forEach((ch) =>
        seedScopeLabels(scope, scopedLabels[ch] || {})
      );
      closeSearchThen(() => {
        openStudyTab(copy);
        flash("Study created");
      });
    } else {
      const existing = new Set(study.refs);
      const dupes = refs.filter((r) => existing.has(r));
      const added = refs.length - dupes.length;
      if (added > 0) {
        setSearchStudies((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, refs: merged, updatedAt: Date.now() } : s
          )
        );
        const scope = "searchstudy:" + id;
        Array.from(new Set(merged.map((r) => scopeOf(r)))).forEach((ch) =>
          seedScopeLabels(scope, scopedLabels[ch] || {})
        );
      }
      closeSearchThen(() => {
        openStudyTab(study);
        addFlash(added, dupes, study.name);
      });
    }
  };
  // "Send verses" → merge picked refs into an existing study (union, book
  // order) and open it. Mirrors desktop's sendToExistingStudy.
  const sendToExistingStudyMobile = (study: SearchStudy, refs: string[]) => {
    if (!refs.length) return;
    const merged = Array.from(new Set([...study.refs, ...refs])).sort(
      (a, b) => orderOf(a) - orderOf(b)
    );
    setSearchStudies((prev) =>
      prev.map((s) =>
        s.id === study.id ? { ...s, refs: merged, updatedAt: Date.now() } : s
      )
    );
    const sscope = "searchstudy:" + study.id;
    Array.from(new Set(refs.map((r) => scopeOf(r)))).forEach((ch) =>
      seedScopeLabels(sscope, scopedLabels[ch] || {})
    );
    openStudyTab(study);
    flash("Verses added");
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
  const linkChapters = (a: string, b: string): string | null => {
    if (a === b) return chapterGroups[a] || null;
    const ga = chapterGroups[a];
    const gb = chapterGroups[b];
    if (ga && gb && ga === gb) return ga;
    const next = { ...chapterGroups };
    let gid: string;
    if (ga && gb) {
      // Merge into the SMALLER group id, matching how the cross-device merge
      // (mergeLinkGroups) reconciles — otherwise a merge done here could keep an
      // id that sync later drops, orphaning the study.
      const keep = ga < gb ? ga : gb;
      const drop = ga < gb ? gb : ga;
      seedScopeLabels("group:" + keep, scopedLabels["group:" + drop] || {});
      Object.keys(next).forEach((s) => {
        if (next[s] === drop) next[s] = keep;
      });
      gid = keep;
      // The dropped group is gone — re-point its recorded linked study to the
      // kept group (or retire it if the kept group already has one) so it isn't
      // left orphaned.
      const at = Date.now();
      setStudies((prev) => {
        let changed = false;
        const out = prev.map((s) => {
          if (s.type !== "linked" || s.scopeRef !== drop || isStudyDeleted(s))
            return s;
          const keepHas = prev.some(
            (o) =>
              o.id !== s.id &&
              o.type === "linked" &&
              o.bookId === s.bookId &&
              o.scopeRef === keep &&
              !isStudyDeleted(o)
          );
          changed = true;
          return keepHas
            ? { ...s, deletedAt: at }
            : { ...s, scopeRef: keep, compiledAt: at };
        });
        return changed ? out : prev;
      });
    } else if (ga && !gb) {
      seedScopeLabels("group:" + ga, scopedLabels[b] || {});
      next[b] = ga;
      gid = ga;
    } else if (!ga && gb) {
      seedScopeLabels("group:" + gb, scopedLabels[a] || {});
      next[a] = gb;
      gid = gb;
    } else {
      gid = newGroupId();
      seedScopeLabels("group:" + gid, scopedLabels[a] || {});
      seedScopeLabels("group:" + gid, scopedLabels[b] || {});
      next[a] = gid;
      next[b] = gid;
    }
    stampGroupChanges(chapterGroups, next); // record the link so it syncs
    setChapterGroups(next);
    return gid;
  };
  const unlink = (a: string) => {
    const next = { ...chapterGroups };
    delete next[a];
    const counts: Record<string, number> = {};
    Object.values(next).forEach((g) => (counts[g] = (counts[g] || 0) + 1));
    const dissolved = new Set<string>(); // group ids that just dropped below 2
    Object.keys(next).forEach((s) => {
      if (counts[next[s]] < 2) {
        dissolved.add(next[s]);
        delete next[s];
      }
    });
    stampGroupChanges(chapterGroups, next); // record the unlink so it syncs
    setChapterGroups(next);
    // A dissolved 2-chapter group leaves its recorded "linked" study pointing at
    // a group that no longer exists. Convert it back to a single-chapter study
    // for the chapter that remains (the group's other member). If a chapter
    // study for that chapter already exists, the link's study is redundant, so
    // retire it instead of duplicating.
    if (dissolved.size) {
      setStudies((prev) => {
        let changed = false;
        const out = prev.map((s) => {
          if (s.type !== "linked" || !dissolved.has(s.scopeRef)) return s;
          const members = Object.keys(chapterGroups).filter(
            (c) => chapterGroups[c] === s.scopeRef
          );
          const survivor = members.find((c) => c !== a) || members[0];
          if (!survivor) return s;
          const now = Date.now();
          const dupe = prev.some(
            (o) =>
              o.id !== s.id &&
              o.type === "chapter" &&
              o.bookId === s.bookId &&
              o.scopeRef === survivor &&
              !isStudyDeleted(o)
          );
          changed = true;
          if (dupe) {
            const t: Study = { ...s, deletedAt: now };
            return t;
          }
          const auto = members.map(displayOf).join("  +  ");
          const keepName =
            !!s.name && s.name !== auto && s.name.indexOf("  +  ") < 0;
          const m: Study = {
            ...s,
            type: "chapter",
            scopeRef: survivor,
            name: keepName ? s.name : displayOf(survivor),
            nameAt: keepName ? s.nameAt : now,
            compiledAt: now,
          };
          return m;
        });
        return changed ? out : prev;
      });
    }
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
    // Warn if the next chapter is already part of another link group — linking
    // here pulls it out of that group.
    const destGid = chapterGroups[title];
    const otherGid = chapterGroups[nextTitle];
    if (otherGid && otherGid !== destGid) {
      if (
        !window.confirm(
          displayOf(nextTitle) +
            " is already linked to another study. Move it into this one?"
        )
      )
        return;
    }
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
    // Warn if the picked chapter is already part of another link group —
    // linking here pulls it out of that group.
    const destGid = chapterGroups[title];
    const otherGid = chapterGroups[targetScope];
    if (otherGid && otherGid !== destGid) {
      if (
        !window.confirm(
          displayOf(targetScope) +
            " is already linked to another study. Move it into this one?"
        )
      )
        return;
    }
    linkChapters(title, targetScope);
    setLinkOpen(false);
    // Take the user to the chapter they just picked (they expected to land
    // there) — mirrors "link with next", which also jumps.
    if (pickV >= 0 && pickB >= 0 && pickC >= 0) {
      setLoc({ v: pickV, b: pickB, c: pickC });
    }
    flash("Linked with " + targetScope);
  };

  // ---- Keyword-study link sheet ----
  // Open the link sheet for a keyword study (always starts on the menu view).
  const openKwLink = (st: SearchStudy) => {
    setKwLinkStudy(st);
    setKwLinkMode("menu");
    setPickV(-1);
    setPickB(-1);
    setPickC(-1);
  };
  // "Go to" a chapter from the keyword sheet: surface it in a chapter tab (reuse
  // an open one if there is one), which closes the study screen via the tab
  // bridge. "New tab" always opens a fresh chapter tab.
  const kwGoToChapter = (scope: string) => {
    const cl = chapterLoc.get(scope);
    if (!cl) return;
    const existing = tabs.find(
      (t) => !t.studyId && t.v === cl.v && t.b === cl.b && t.c === cl.c
    );
    if (existing) {
      setActiveTabId(existing.id);
    } else if (tabs.length >= MAX_TABS) {
      flash("Close a tab to open another");
      return;
    } else {
      openTab({ v: cl.v, b: cl.b, c: cl.c });
    }
    setKwLinkStudy(null);
  };
  const kwNewTabChapter = (scope: string) => {
    const cl = chapterLoc.get(scope);
    if (!cl) return;
    if (tabs.length >= MAX_TABS) {
      flash("Close a tab to open another");
      return;
    }
    openTab({ v: cl.v, b: cl.b, c: cl.c });
    setKwLinkStudy(null);
  };
  // Confirm "Add a chapter to this study" from the keyword sheet's picker. A
  // standalone study links to the picked chapter (sets linkedScope); a study
  // already linked pulls the picked chapter into its chapter group.
  const kwAddChapter = () => {
    if (!kwLinkStudy || !targetScope) return;
    const st = searchStudies.find((s) => s.id === kwLinkStudy.id) || kwLinkStudy;
    if (st.linkedScope) {
      linkChapters(st.linkedScope, targetScope);
    } else {
      setSearchStudies((prev) =>
        prev.map((s) =>
          s.id === st.id
            ? { ...s, linkedScope: targetScope, updatedAt: Date.now() }
            : s
        )
      );
      seedScopeLabels(
        "searchstudy:" + st.id,
        scopedLabels[targetScope] || {}
      );
      triggerMergeFlash();
    }
    setKwLinkMode("menu");
    setPickV(-1);
    setPickB(-1);
    setPickC(-1);
    flash("Chapter added");
  };

  // "Add a chapter to this study" (from the Studies hub). A chapter study
  // anchors on its own chapter; a linked study anchors on any chapter already in
  // its group. Linking a chapter into a chapter study promotes it to a linked
  // study — a study can't be a single chapter and also span two.
  const addChapterAnchor = addChapterStudy
    ? addChapterStudy.type === "chapter"
      ? addChapterStudy.scopeRef
      : Object.keys(chapterGroups).find(
          (s) => chapterGroups[s] === addChapterStudy.scopeRef
        ) || null
    : null;
  const addChapterInStudy = (scope: string) =>
    !!addChapterAnchor &&
    (scope === addChapterAnchor ||
      (!!chapterGroups[addChapterAnchor] &&
        chapterGroups[scope] === chapterGroups[addChapterAnchor]));
  const confirmAddChapter = () => {
    if (!addChapterStudy || !targetScope || !addChapterAnchor) return;
    if (addChapterInStudy(targetScope)) return;
    // Warn if this chapter already belongs to another link group — adding it
    // here pulls it out of that group.
    const destGid = chapterGroups[addChapterAnchor];
    const otherGid = chapterGroups[targetScope];
    if (otherGid && otherGid !== destGid) {
      if (
        !window.confirm(
          displayOf(targetScope) +
            " is already linked to another study. Move it into this one?"
        )
      )
        return;
    }
    const gid = linkChapters(addChapterAnchor, targetScope);
    if (addChapterStudy.type === "chapter" && gid) {
      const sid = addChapterStudy.id;
      const bid = addChapterStudy.bookId;
      const now = Date.now();
      // If a linked study for this group already exists, the chapter study is
      // now redundant — retire it rather than creating a duplicate (matches
      // desktop's "+ Add chapter").
      const existingLinked = studies.find(
        (s) =>
          s.type === "linked" &&
          s.bookId === bid &&
          s.scopeRef === gid &&
          !isStudyDeleted(s)
      );
      const promote = (s: Study): Study =>
        s.id !== sid
          ? s
          : existingLinked
          ? { ...s, deletedAt: now }
          : { ...s, type: "linked", scopeRef: gid, compiledAt: now };
      setStudies((prev) => prev.map(promote));
    }
    // Send the user straight to the chapter they just added so they can mark
    // it (mirrors the reading-view link, which also jumps to the chapter).
    setCompileRec(null);
    setAddChapterStudy(null);
    jumpToRef(targetScope);
    flash("Added " + displayOf(targetScope));
  };

  // Add loose verses (from keyword search) to a recorded chapter/linked study.
  // The selection is only the ADDITIONS — merged into the study's extras,
  // never replacing them (owner rule, Jul 14; SCR-38). Their marks then show
  // in the study's compile alongside the chapter's own marks.
  const handleAddVersesToRec = (refs: string[]) => {
    const rid = addVersesRecId;
    setAddVersesRecId(null);
    setSearchOpen(false);
    if (!rid) return;
    const rec = studies.find((s) => s.id === rid);
    if (!rec) return;
    const existing = new Set(rec.extraRefs || []);
    const dupes = refs.filter((r) => existing.has(r));
    const added = refs.length - dupes.length;
    if (added === 0) {
      if (refs.length) addFlash(0, dupes, rec.name);
      return;
    }
    const merged = Array.from(new Set([...(rec.extraRefs || []), ...refs])).sort(
      (a, b) => orderOf(a) - orderOf(b)
    );
    const at = Date.now();
    setStudies((prev) =>
      prev.map((s) =>
        s.id === rid
          ? { ...s, extraRefs: merged, extraRefsAt: at, compiledAt: at }
          : s
      )
    );
    // Reflect on the (still-open) compile underneath too, so closing the
    // reading view shows the new verses.
    setCompileRec((prev) =>
      prev && prev.id === rid
        ? { ...prev, extraRefs: merged, extraRefsAt: at, compiledAt: at }
        : prev
    );
    // Land on the markable reading list (added verses first) so they can be
    // marked, then compiled — deferred past the sheet unmount (scroll-freeze
    // guard, same as handleAddToStudy).
    closeSearchThen(() => {
      setMarkRec({ ...rec, extraRefs: merged, extraRefsAt: at });
      flash(
        "Added " +
          (added === 1 ? "1 verse" : added + " verses") +
          " — mark, then compile"
      );
    });
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
  const isDefine = pen.tool === "define";
  // Warm the dictionary the moment Define mode is armed, so the first tap is
  // instant rather than waiting on the (one-time) fetch.
  useEffect(() => {
    if (isDefine) loadWebster();
  }, [isDefine]);
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

  const [defn, setDefn] = useState<{
    ref: string;
    word: string;
    start: number;
    end: number;
    result: WebsterResult | null;
  } | null>(null);
  // In Define mode a tap looks the word up instead of marking. We resolve the
  // first whole word of the selection and remember its exact character range so
  // a tag can anchor to that one occurrence.
  const openDefine = (ref: string, text: string, s: number, e: number) => {
    const slice = text.slice(s, e);
    const m = slice.match(/[A-Za-z][A-Za-z'-]*/);
    if (!m) return;
    const start = s + (m.index || 0);
    const end = start + m[0].length;
    const word = m[0];
    websterLookup(word).then((result) =>
      setDefn({ ref, word, start, end, result })
    );
  };
  // Tapping a word's footnote marker reopens the same sheet as a quick
  // reference, with the definition pulled fresh from the dictionary by its key.
  const openTagRef = (tag: WordTag) => {
    loadWebster().then(() => {
      const def = definitionForKey(tag.dictKey);
      setDefn({
        ref: tag.reference,
        word: tag.word,
        start: tag.start,
        end: tag.end,
        result: def ? { key: tag.dictKey, definition: def } : null,
      });
    });
  };

  const onTap = (ref: string, text: string, s: number, e: number) => {
    if (isDefine) {
      openDefine(ref, text, s, e);
      return;
    }
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
    if (isDefine) {
      openDefine(ref, text, s, e);
      return;
    }
    if (isEraser) eraseRange(ref, s, e);
    else addRange(ref, text, s, e);
  };

  const onManage = (ref: string, text: string, s: number, e: number) => {
    if (isDefine) {
      openDefine(ref, text, s, e);
      return;
    }
    setManage({ ref, text, s, e });
  };

  // ---- Refine a mark's edges (double-tap to enter, tap words to adjust) ----
  const onEnterEdit = (id: string, ref: string) => {
    if (isDefine) return;
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
  const studyScopes = (
    chapterGroups[title] && !mtourOpen ? groupMembers(title) : [title]
  )
    .slice()
    .sort(
      (a, b) => (chapterLoc.get(a)?.order ?? 0) - (chapterLoc.get(b)?.order ?? 0)
    );
  const studyMarks = marks.filter((m) =>
    studyScopes.includes(scopeOf(m.reference))
  );

  // ---- Compile (gathering animation, then full-screen view) ----
  // Source marks default to the current chapter's; pass a study's marks for
  // keyword / linked / combined compiles. The animation always pulls whatever
  // marked words are actually visible on screen (it's a visual effect, not the
  // canonical marks); when nothing visible is found it falls back to a gather
  // built from the study's mark colors.
  const startCompile = (sourceMarks: { color: number }[] = studyMarks) => {
    const lastCount = Number(
      localStorage.getItem("scribal_mobile_compile_count") || "0"
    );
    const delta = Math.max(0, marks.length - lastCount);
    const duration = delta > 8 ? 2500 : 1000;
    localStorage.setItem("scribal_mobile_compile_count", String(marks.length));

    // Capture only the marks currently on screen (their position, color, and
    // text) so the animation flies a legible handful — never hundreds — no
    // matter how large the study is. The viewport filter naturally excludes any
    // off-screen or hidden reader.
    const flyers: CompileFlyer[] = [];
    try {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      document
        .querySelectorAll<HTMLElement>("[data-mc]")
        .forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.height <= 0 || r.top >= vh - 4 || r.bottom <= 4) return;
          // Only lift it if it's the topmost thing at its center — anything
          // sitting behind an overlay (e.g. the studies list covering the
          // reader) is skipped, so that compile falls back to the color gather.
          const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
          const cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
          const top = document.elementFromPoint(cx, cy);
          if (!top || !(el === top || el.contains(top) || top.contains(el)))
            return;
          flyers.push({
            x: r.left,
            y: r.top,
            w: r.width,
            h: r.height,
            color: Number(el.getAttribute("data-mc")) || 1,
            text: (el.textContent || "").trim(),
          });
        });
    } catch (e) {
      /* DOM not ready — fall back to the color-only (synth) animation */
    }
    const capped = flyers.slice(0, 28);

    // Colors that drop into the book when there are no on-screen marks to pull.
    const colors = sourceMarks.map((m) => m.color).slice(0, 24);

    setCompileAnim({ show: true, duration, flyers: capped, colors });
  };

  // Record the current chapter (or its linked group) as a study, then compile.
  // Compile is the save — the single intentional action that lists a study.
  const recordStudy = (
    type: "chapter" | "linked",
    scopeRef: string,
    name: string,
    rename: boolean = true,
    view?: "outline" | "charting" | "distilled" | "covenants" | "semantic",
    memberScopes?: string[]
  ) => {
    if (mtourOpen) return;
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
          // Remember the view it was saved in; keep the existing one when the
          // caller doesn't pass a view (e.g. a background re-compile).
          view: view !== undefined ? view : cur.view,
          memberScopes:
            memberScopes && memberScopes.length
              ? memberScopes
              : cur.memberScopes,
        };
        return next;
      }
      // Linked studies: the group id drifts (regrouping, other devices), so an
      // exact scopeRef miss doesn't mean the study is new. If a linked study
      // already covers the SAME chapter set, update it — and re-key it to the
      // current group id — instead of duplicating it in the list.
      if (type === "linked" && memberScopes && memberScopes.length) {
        const want = memberScopes.slice().sort().join("|");
        const j = prev.findIndex(
          (s) =>
            s.type === "linked" &&
            s.bookId === bookId &&
            (s.memberScopes || []).slice().sort().join("|") === want
        );
        if (j >= 0) {
          const next = prev.slice();
          const cur = next[j];
          const nameChanged = rename && name !== cur.name;
          next[j] = {
            ...cur,
            scopeRef,
            name: rename ? name : cur.name,
            nameAt: nameChanged ? now : cur.nameAt || cur.compiledAt || now,
            compiledAt: now,
            view: view !== undefined ? view : cur.view,
            memberScopes,
          };
          return next;
        }
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
          view,
          memberScopes,
        },
        ...prev,
      ];
    });
  };
  const compileCurrentStudy = () => {
    const studyTags = wordTags.filter((t) =>
      studyScopes.includes(scopeOf(t.reference))
    );
    if (studyMarks.length === 0 && studyTags.length === 0) {
      flash("Mark or tag something first, then compile");
      return;
    }
    const gid = chapterGroups[title];
    const type: "chapter" | "linked" = gid ? "linked" : "chapter";
    const scopeRef = gid || title;
    const members = gid ? groupMembers(title) : [title];
    const defName = gid
      ? groupMembers(title).map(displayOf).join("  +  ")
      : displayTitle;
    // Compiling lists the study, but must NOT rename one you've already named.
    // rename = false → the default name is only used when first creating it;
    // an existing study keeps whatever you called it.
    recordStudy(type, scopeRef, defName, false, undefined, members);
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
    // With no marks the compiled notes would be empty — land on the reading
    // view instead so there's something to see.
    const chs =
      s.type === "linked"
        ? Object.keys(chapterGroups).filter(
            (c) => chapterGroups[c] === s.scopeRef
          )
        : [s.scopeRef];
    const extra = s.extraRefs || [];
    const recMarks = allMarks.filter(
      (m) =>
        m.bookId === s.bookId &&
        (chs.includes(scopeOf(m.reference)) || extra.includes(m.reference))
    );
    // Straight to the notes — the gather animation belongs to COMPILING, not
    // to reopening a study you already have.
    if (recMarks.length > 0) setCompileOpen(true);
    else setCompileOpen(false);
  };
  // Open a keyword study straight to its compiled notes (in its saved view),
  // with the study's verse list positioned underneath for when the notes are
  // closed — so it lands on the synthesis, not the verse list, matching how
  // recorded studies open from the Studies screen.
  const openKeywordCompile = (ss: SearchStudy) => {
    openStudy(ss);
    if (ss.bookId !== activeBookId) setActiveBook(ss.bookId);
    setCompileRec(null);
    setCompileStudy(ss);
    // No marks → the compiled notes are empty; show the verse list instead.
    const kwMarks = allMarks.filter(
      (m) => m.bookId === ss.bookId && ss.refs.includes(m.reference)
    );
    if (kwMarks.length > 0) setCompileOpen(true);
    else setCompileOpen(false);
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
  const sheet = (
    onClose: () => void,
    children: React.ReactNode,
    z: number = 450
  ) => (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.4)",
        zIndex: z,
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
      <span style={{ color: ACCENT, display: "inline-flex" }}>{icon}</span>
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
      <SplashScreen />
      {/* The strip under the iOS status bar (notch/Dynamic Island area) must
          track the LIVE theme — the app draws under the translucent status
          bar, so a fixed color here shows through wrong in some themes. Match
          whatever background sits behind it: the reader's (incl. warm tone)
          while reading, the theme background otherwise. */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: "env(safe-area-inset-top)",
          backgroundColor: compileOpen ? C.bg : readBg,
          zIndex: 99999,
          pointerEvents: "none",
          transition: "background-color .2s",
        }}
      />
      <style>{`
        @keyframes mob-fadein { from { opacity: 0; } to { opacity: 1; } }
        @keyframes mob-slideup { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes mob-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes mob-toast-in { 0% { opacity: 0; transform: translateX(-50%) translateY(16px) scale(0.9); } 55% { opacity: 1; } 100% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } }
        /* Combined-study moment: a center-screen red+blue→purple fuse with a
           glow and label over a brief dim — announces a new combined study. */
        @keyframes mo-dim { 0% { background: rgba(20,18,15,0); } 18% { background: rgba(20,18,15,.34); } 78% { background: rgba(20,18,15,.34); } 100% { background: rgba(20,18,15,0); } }
        @keyframes mo-fromLeft { 0%,8% { transform: translateX(-30px); opacity: 0; } 16% { opacity: 1; } 34% { transform: translateX(0); opacity: 1; } 44%,100% { opacity: 0; } }
        @keyframes mo-fromRight { 0%,8% { transform: translateX(30px); opacity: 0; } 16% { opacity: 1; } 34% { transform: translateX(0); opacity: 1; } 44%,100% { opacity: 0; } }
        @keyframes mo-popIn { 0%,34% { transform: scale(0); opacity: 0; } 44% { transform: scale(1.35); opacity: 1; } 54% { transform: scale(.94); } 62% { transform: scale(1); } 78% { transform: scale(1); opacity: 1; } 100% { transform: scale(.7); opacity: 0; } }
        @keyframes mo-ripple { 0%,34% { transform: scale(.3); opacity: 0; } 46% { opacity: .6; } 66% { transform: scale(2); opacity: 0; } 100% { opacity: 0; } }
        @keyframes mo-glow { 0%,30% { opacity: 0; } 46% { opacity: 1; } 70% { opacity: .5; } 100% { opacity: 0; } }
        @keyframes mo-label { 0%,40% { opacity: 0; transform: translateY(8px); } 52% { opacity: 1; transform: translateY(0); } 78% { opacity: 1; } 100% { opacity: 0; } }
        .mo-wrap { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; pointer-events: none; z-index: 100000; animation: mo-dim 1.5s ease both; }
        .mo-stage { position: relative; width: 120px; height: 120px; }
        .mo-glow { position: absolute; top: 0; left: 0; right: 0; bottom: 0; margin: auto; width: 120px; height: 120px; border-radius: 50%; background: radial-gradient(circle, rgba(139,92,246,.45), rgba(139,92,246,0) 70%); animation: mo-glow 1.5s ease both; }
        .mo-ripple { position: absolute; top: 0; left: 0; right: 0; bottom: 0; margin: auto; width: 78px; height: 78px; border-radius: 50%; border: 3px solid #8b5cf6; opacity: 0; animation: mo-ripple 1.5s ease both; }
        .mo-lk { position: absolute; top: 0; left: 0; right: 0; bottom: 0; margin: auto; width: 60px; height: 60px; }
        .mo-red { animation: mo-fromLeft 1.5s ease both; }
        .mo-blue { animation: mo-fromRight 1.5s ease both; }
        .mo-purple { animation: mo-popIn 1.5s ease both; }
        .mo-label { text-align: center; opacity: 0; animation: mo-label 1.5s ease both; }
        .mo-big { font-size: 19px; font-weight: 800; color: #fff; }
        .mo-small { font-size: 12.5px; color: rgba(255,255,255,.82); margin-top: 3px; }
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
            backgroundColor: ACCENT,
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

          <button
            onClick={() => setScreensOpen(true)}
            style={{
              ...navBtn(C, false),
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label="Screens"
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
              <rect x="8" y="3" width="13" height="13" rx="2.5" />
              <path d="M16 19v.5A1.5 1.5 0 0 1 14.5 21h-9A1.5 1.5 0 0 1 4 19.5v-9A1.5 1.5 0 0 1 5.5 9H6" />
            </svg>
            {tabs.length > 1 && (
              <span
                style={{
                  position: "absolute",
                  top: "4px",
                  right: "3px",
                  minWidth: "14px",
                  height: "14px",
                  padding: "0 3px",
                  background: ACCENT,
                  color: "#fff",
                  borderRadius: "99px",
                  fontSize: "9px",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1,
                }}
              >
                {tabs.length}
              </span>
            )}
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
                display: "flex",
                alignItems: "baseline",
                overflow: "hidden",
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
              <FitTitle
                full={displayTitle}
                compact={headerCompact}
                suffix={activeBookId !== "master" ? "  · session" : undefined}
                suffixStyle={{
                  color: C.muted,
                  fontSize: "12px",
                  fontWeight: 400,
                  whiteSpace: "pre",
                }}
                style={{ flex: "0 1 auto" }}
              />
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
            data-wt="wt-compile"
            onClick={compileCurrentStudy}
            disabled={sendMode}
            style={{
              flexShrink: 0,
              background: C.text,
              color: C.bg,
              border: "none",
              borderRadius: "999px",
              padding: "8px 16px",
              fontSize: "12.5px",
              fontWeight: 700,
              cursor: sendMode ? "default" : "pointer",
              opacity: sendMode ? 0.4 : 1,
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
          {sendMode ? (
            <>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: "12.5px",
                  color: C.muted,
                  fontFamily: "inherit",
                }}
              >
                {sendSel.size
                  ? sendSel.size +
                    (sendSel.size === 1
                      ? " verse selected"
                      : " verses selected")
                  : "Tap verses to select"}
              </span>
              <button
                onClick={() => {
                  const all = chapter.verses.map((v: any) => v.reference);
                  setSendSel((prev) =>
                    prev.size === all.length ? new Set() : new Set(all)
                  );
                }}
                style={{
                  flexShrink: 0,
                  padding: "5px 11px",
                  borderRadius: "8px",
                  border: "1px solid " + C.border,
                  background: "transparent",
                  color: C.text,
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {sendSel.size > 0 && sendSel.size === chapter.verses.length
                  ? "Clear all"
                  : "Select all"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setSendMode(true);
                  setSendSel(new Set());
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexShrink: 0,
                  background: "transparent",
                  border: "1px solid " + C.border,
                  borderRadius: "999px",
                  padding: "5px 12px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
                aria-label="Send verses to a study"
              >
                <span
                  style={{ fontSize: "12px", fontWeight: 700, color: C.text }}
                >
                  Send verses
                </span>
              </button>
          <button
            data-tour="m-menu"
            onClick={() => setSettingsOpen(true)}
            style={{
              display: "flex",
              alignItems: "center",
              // Centered between the Send verses and Link pills so the row
              // reads left · middle · right instead of lumping to the left.
              justifyContent: "center",
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
            data-wt="wt-link"
          >
            <LinkGlyph
              color={chapterIsCombined(title) ? TYPE_PURPLE : TYPE_RED}
              size={15}
            />
            <span
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: chapterIsCombined(title) ? TYPE_PURPLE : TYPE_RED,
              }}
            >
              {chapterGroups[title] || chapterIsCombined(title)
                ? "Linked"
                : "Link"}
            </span>
          </button>
            </>
          )}
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
          {chapter.verses.map((vs: any, vi: number) => {
            const verse = (
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
                  !sendMode && editMark && editMark.reference === vs.reference
                    ? editMark.id
                    : null
                }
                editingActive={!sendMode && !!editMark}
                onEnterEdit={onEnterEdit}
                onAdjust={onAdjust}
                dark={dark}
                tags={wordTags}
                onTagTap={openTagRef}
              />
            );
            if (!sendMode)
              return mtourOpen && vi === 0 ? (
                <div data-wt="wt-verse" key={vs.reference}>
                  {verse}
                </div>
              ) : (
                verse
              );
            const checked = sendSel.has(vs.reference);
            return (
              <div
                key={vs.reference}
                onClick={() =>
                  setSendSel((prev) => {
                    const next = new Set(prev);
                    if (next.has(vs.reference)) next.delete(vs.reference);
                    else next.add(vs.reference);
                    return next;
                  })
                }
                style={{
                  display: "flex",
                  gap: "12px",
                  alignItems: "flex-start",
                  cursor: "pointer",
                  marginBottom: "10px",
                }}
              >
                <span
                  style={{
                    width: "22px",
                    height: "22px",
                    borderRadius: "6px",
                    border: "2px solid " + (checked ? ACCENT : C.border),
                    background: checked ? ACCENT : "transparent",
                    color: "#fff",
                    flexShrink: 0,
                    marginTop: "3px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "13px",
                    fontWeight: 800,
                  }}
                >
                  {checked ? "✓" : ""}
                </span>
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    pointerEvents: "none",
                    opacity: checked ? 0.55 : 1,
                  }}
                >
                  {verse}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {sendMode && !openStudyId && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 61,
            padding: "0 14px calc(14px + env(safe-area-inset-bottom))",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              pointerEvents: "auto",
              display: "flex",
              gap: "10px",
              padding: "12px 14px",
              backgroundColor: C.bg,
              border: "1px solid " + C.border,
              borderRadius: "16px",
              boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
            }}
          >
            <button
              onClick={() => {
                setSendMode(false);
                setSendSel(new Set());
              }}
              style={{
                flex: 1,
                padding: "11px",
                borderRadius: "10px",
                border: "1px solid " + C.border,
                background: "transparent",
                color: C.text,
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (!sendSel.size) return;
                const refs = Array.from(sendSel).sort(
                  (a, b) => orderOf(a) - orderOf(b)
                );
                setSendMode(false);
                setSendSel(new Set());
                setSendPicking(false);
                setSendRefs(refs);
              }}
              disabled={sendSel.size === 0}
              style={{
                flex: 1,
                padding: "11px",
                borderRadius: "10px",
                border: "none",
                background: sendSel.size === 0 ? C.soft : ACCENT,
                color: sendSel.size === 0 ? C.muted : "#fff",
                fontSize: "14px",
                fontWeight: 700,
                cursor: sendSel.size === 0 ? "default" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {sendSel.size ? "Send (" + sendSel.size + ")" : "Send"}
            </button>
          </div>
        </div>
      )}

      {/* Pen tray (collapsible, locked to bottom) */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 60,
          display: sendMode ? "none" : undefined,
          // Keep the compact floating card, but push the WHOLE tray low — down
          // into the wasted strip above the home indicator — so it covers less
          // of the reading area. The card itself stays its original size (it is
          // NOT stretched to fill the strip); only its position moves. The tiny
          // bottom margin sits just clear of the home-indicator gesture zone.
          padding: "0 14px max(8px, calc(env(safe-area-inset-bottom) - 20px))",
          pointerEvents: "none",
        }}
      >
        <div
          data-wt="wt-tray"
          style={{
            pointerEvents: "auto",
            backgroundColor: C.panel,
            border: "1px solid " + C.border,
            borderRadius: "16px",
            // A firm shadow so the compact card still reads as a distinct floating
            // tray against the beige page.
            boxShadow: "0 6px 24px rgba(0,0,0,0.22)",
            overflow: "hidden",
          }}
        >
          {/* Colors — always visible */}
          <div data-wt="wt-colors" style={{ padding: "12px 14px 0", display: "flex", gap: "8px" }}>
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
            data-wt="wt-styles"
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
                  data-wt={
                    s.tool === "eraser"
                      ? "wt-eraser"
                      : s.tool === "define"
                      ? "wt-define"
                      : undefined
                  }
                  onClick={() => setPen((p) => ({ ...p, tool: s.tool }))}
                  aria-label={s.label}
                  title={s.label}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: 0,
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
                  {toolGlyph(s.tool)}
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
              {isDefine
                ? "Define · tap a word to look it up"
                : isEraser
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
              <span style={{ flex: 1 }} />
              <button
                onClick={() => setLinkOpen(false)}
                aria-label="Close link panel"
                style={{
                  border: "none",
                  background: "transparent",
                  color: C.muted,
                  fontSize: "22px",
                  lineHeight: 1,
                  padding: "4px 8px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
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
                              background: ACCENT,
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

            {chapterLinkedSearches.length > 0 && (
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
                  Linked searches
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    marginBottom: "14px",
                  }}
                >
                  {chapterLinkedSearches.map((ks) => (
                    <div
                      key={ks.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "11px 13px",
                          borderRadius: "10px",
                          border: "1px solid " + C.border,
                          background: C.soft,
                          fontSize: "14px",
                        }}
                      >
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke={anchorColor(title)}
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <circle cx="11" cy="11" r="7" />
                          <path d="M21 21l-4.3-4.3" />
                        </svg>
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {ks.name || "Search"}
                          <span style={{ fontSize: "11px", color: C.muted }}>
                            {" "}
                            · {ks.refs.length}{" "}
                            {ks.refs.length === 1 ? "verse" : "verses"}
                          </span>
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          openStudyTab(ks);
                          setLinkOpen(false);
                        }}
                        style={{
                          flexShrink: 0,
                          padding: "9px 13px",
                          borderRadius: "8px",
                          border: "none",
                          background: anchorColor(title),
                          color: "#fff",
                          cursor: "pointer",
                          fontSize: "12px",
                          fontWeight: 700,
                          fontFamily: "inherit",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Open
                      </button>
                      <button
                        onClick={() => {
                          if (
                            window.confirm(
                              "Unlink this search? It stays in Studies and can be linked again."
                            )
                          ) {
                            unlinkSearch(ks.id);
                            flash("Search unlinked");
                          }
                        }}
                        style={{
                          flexShrink: 0,
                          padding: "9px 13px",
                          borderRadius: "8px",
                          border: "1px solid " + C.border,
                          background: "transparent",
                          color: C.muted,
                          cursor: "pointer",
                          fontSize: "12px",
                          fontWeight: 600,
                          fontFamily: "inherit",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Unlink
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {nextTitle && (
              <button
                onClick={linkWithNext}
                style={{
                  width: "100%",
                  background: ACCENT,
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
                background: ACCENT,
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

            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: C.muted,
                margin: "18px 0 8px",
              }}
            >
              Or add a keyword search
            </div>
            <button data-wt="wt-search"

              onClick={() => {
                setLinkToChapterScope(title);
                setLinkOpen(false);
                setSearchOpen(true);
              }}
              style={{
                width: "100%",
                background: "transparent",
                color: TYPE_BLUE,
                border: "1px solid " + C.border,
                borderRadius: "10px",
                padding: "13px",
                fontSize: "14px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke={TYPE_BLUE}
                strokeWidth="2.3"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              Add a keyword search to this study
            </button>
          </div>
        )}

      {/* Keyword-study link sheet: same experience as the chapter link button,
          minus "link with next chapter". Standalone = two options; linked =
          members (chapters with Go to / New tab / Unlink, sibling searches with
          Open / Unlink) plus Add a chapter / Add a keyword search. */}
      {kwLinkStudy &&
        (() => {
          const base = kwLinkStudy;
          if (!base) return null;
          const ks =
            searchStudies.find((s) => s.id === base.id) || base;
          const linkScope = ks.linkedScope || null;
          const grpMembers = linkScope
            ? groupMembers(linkScope).length
              ? groupMembers(linkScope)
              : [linkScope]
            : [];
          const kwSet = new Set<string>(
            linkScope ? [linkScope, ...groupMembers(linkScope)] : []
          );
          const siblingSearches = linkScope
            ? searchStudies.filter(
                (s) =>
                  !isSearchDeleted(s) &&
                  s.id !== ks.id &&
                  !!s.linkedScope &&
                  kwSet.has(s.linkedScope)
              )
            : [];
          const kwColor = linkScope ? TYPE_PURPLE : TYPE_BLUE;
          const eyebrowStyle: React.CSSProperties = {
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: C.muted,
            marginBottom: "8px",
          };
          const goAddVerses = () => {
            setKwLinkStudy(null);
            setAddToStudyId(ks.id);
            setOpenStudyId(null);
            setSearchOpen(true);
          };
          const startAddChapter = () => {
            setPickV(-1);
            setPickB(-1);
            setPickC(-1);
            setKwLinkMode("chapter");
          };
          return sheet(
            () => {
              setKwLinkStudy(null);
              setKwLinkMode("menu");
            },
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  fontSize: "10.5px",
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: ks.linkedScope ? TYPE_PURPLE : TYPE_BLUE,
                  marginBottom: "4px",
                }}
              >
                <LinkGlyph
                  color={ks.linkedScope ? TYPE_PURPLE : TYPE_BLUE}
                  size={12}
                />
                Keyword study
              </div>
              <div
                style={{ fontSize: "18px", fontWeight: 700, marginBottom: "2px" }}
              >
                {ks.name || "Search"}
              </div>
              <div
                style={{
                  fontSize: "12.5px",
                  color: C.muted,
                  marginBottom: "16px",
                }}
              >
                {ks.refs.length} {ks.refs.length === 1 ? "verse" : "verses"} ·{" "}
                {linkScope ? "linked into a study" : "not linked yet"}
              </div>

              {kwLinkMode === "chapter" ? (
                <>
                  <div style={eyebrowStyle}>Chapter to add</div>
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
                        const single =
                          v >= 0 && vols[v].books.length === 1;
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

                  {targetScope && grpMembers.includes(targetScope) && (
                    <div
                      style={{
                        fontSize: "13px",
                        color: C.muted,
                        marginBottom: "8px",
                      }}
                    >
                      That chapter is already in this study — pick another.
                    </div>
                  )}

                  <button
                    onClick={kwAddChapter}
                    disabled={
                      !targetScope || grpMembers.includes(targetScope)
                    }
                    style={{
                      width: "100%",
                      background: ACCENT,
                      color: "#fff",
                      border: "none",
                      borderRadius: "10px",
                      padding: "13px",
                      fontSize: "14px",
                      fontWeight: 700,
                      cursor:
                        !targetScope || grpMembers.includes(targetScope)
                          ? "default"
                          : "pointer",
                      opacity:
                        !targetScope || grpMembers.includes(targetScope)
                          ? 0.5
                          : 1,
                      fontFamily: "inherit",
                      marginBottom: "8px",
                    }}
                  >
                    {targetScope && !grpMembers.includes(targetScope)
                      ? "Add " + targetScope
                      : "Add chapter"}
                  </button>
                  <button
                    onClick={() => setKwLinkMode("menu")}
                    style={{
                      width: "100%",
                      background: "transparent",
                      color: C.muted,
                      border: "1px solid " + C.border,
                      borderRadius: "10px",
                      padding: "11px",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    ← Back
                  </button>
                </>
              ) : linkScope ? (
                <>
                  <div style={eyebrowStyle}>In this study</div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      marginBottom: "14px",
                    }}
                  >
                    {grpMembers.map((sc) => (
                      <div
                        key={sc}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <div
                          style={{
                            flex: 1,
                            minWidth: 0,
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            padding: "11px 13px",
                            borderRadius: "10px",
                            border: "1px solid " + C.border,
                            background: C.soft,
                            fontSize: "14px",
                          }}
                        >
                          <span
                            style={{
                              width: "12px",
                              height: "12px",
                              borderRadius: "50%",
                              background: kwColor,
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {displayOf(sc)}
                          </span>
                        </div>
                        <button
                          onClick={() => kwGoToChapter(sc)}
                          style={{
                            flexShrink: 0,
                            padding: "9px 12px",
                            borderRadius: "8px",
                            border: "none",
                            background: kwColor,
                            color: "#fff",
                            cursor: "pointer",
                            fontSize: "12px",
                            fontWeight: 700,
                            fontFamily: "inherit",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Go to
                        </button>
                        <button
                          onClick={() => kwNewTabChapter(sc)}
                          style={{
                            flexShrink: 0,
                            padding: "9px 12px",
                            borderRadius: "8px",
                            border: "1px solid " + C.border,
                            background: "transparent",
                            color: C.text,
                            cursor: "pointer",
                            fontSize: "12px",
                            fontWeight: 600,
                            fontFamily: "inherit",
                            whiteSpace: "nowrap",
                          }}
                        >
                          New tab
                        </button>
                        <button
                          onClick={() => {
                            if (groupMembers(sc).length > 0) {
                              unlink(sc);
                              flash("Unlinked " + displayOf(sc));
                            } else if (
                              window.confirm(
                                "Unlink this study from " +
                                  displayOf(sc) +
                                  "?"
                              )
                            ) {
                              unlinkSearch(ks.id);
                              setKwLinkStudy(null);
                              flash("Search unlinked");
                            }
                          }}
                          style={{
                            flexShrink: 0,
                            padding: "9px 12px",
                            borderRadius: "8px",
                            border: "1px solid " + C.border,
                            background: "transparent",
                            color: C.muted,
                            cursor: "pointer",
                            fontSize: "12px",
                            fontWeight: 600,
                            fontFamily: "inherit",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Unlink
                        </button>
                      </div>
                    ))}
                    {siblingSearches.map((s) => (
                      <div
                        key={s.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <div
                          style={{
                            flex: 1,
                            minWidth: 0,
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            padding: "11px 13px",
                            borderRadius: "10px",
                            border: "1px solid " + C.border,
                            background: C.soft,
                            fontSize: "14px",
                          }}
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke={kwColor}
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <circle cx="11" cy="11" r="7" />
                            <path d="M21 21l-4.3-4.3" />
                          </svg>
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {s.name || "Search"}
                            <span
                              style={{ fontSize: "11px", color: C.muted }}
                            >
                              {" "}
                              · {s.refs.length}{" "}
                              {s.refs.length === 1 ? "verse" : "verses"}
                            </span>
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            openStudyTab(s);
                            setKwLinkStudy(null);
                          }}
                          style={{
                            flexShrink: 0,
                            padding: "9px 13px",
                            borderRadius: "8px",
                            border: "none",
                            background: kwColor,
                            color: "#fff",
                            cursor: "pointer",
                            fontSize: "12px",
                            fontWeight: 700,
                            fontFamily: "inherit",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Open
                        </button>
                        <button
                          onClick={() => {
                            if (
                              window.confirm(
                                "Unlink this search? It stays in Studies and can be linked again."
                              )
                            ) {
                              unlinkSearch(s.id);
                              flash("Search unlinked");
                            }
                          }}
                          style={{
                            flexShrink: 0,
                            padding: "9px 13px",
                            borderRadius: "8px",
                            border: "1px solid " + C.border,
                            background: "transparent",
                            color: C.muted,
                            cursor: "pointer",
                            fontSize: "12px",
                            fontWeight: 600,
                            fontFamily: "inherit",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Unlink
                        </button>
                      </div>
                    ))}
                  </div>

                  <div style={eyebrowStyle}>Add to this study</div>
                  <button
                    onClick={startAddChapter}
                    style={{
                      width: "100%",
                      background: ACCENT,
                      color: "#fff",
                      border: "none",
                      borderRadius: "10px",
                      padding: "13px",
                      fontSize: "14px",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      marginBottom: "8px",
                    }}
                  >
                    Add a chapter to this study
                  </button>
                  <button
                    onClick={goAddVerses}
                    style={{
                      width: "100%",
                      background: "transparent",
                      color: TYPE_BLUE,
                      border: "1px solid " + C.border,
                      borderRadius: "10px",
                      padding: "13px",
                      fontSize: "14px",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={TYPE_BLUE}
                      strokeWidth="2.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="11" cy="11" r="7" />
                      <path d="M21 21l-4.3-4.3" />
                    </svg>
                    Add a keyword search to this study
                  </button>
                </>
              ) : (
                <>
                  <div style={eyebrowStyle}>Add to this study</div>
                  <button
                    onClick={goAddVerses}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "14px",
                      borderRadius: "12px",
                      border: "1px solid " + C.border,
                      background: C.soft,
                      color: C.text,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      marginBottom: "9px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "15px",
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <svg
                        width="17"
                        height="17"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={TYPE_BLUE}
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <circle cx="11" cy="11" r="7" />
                        <path d="M21 21l-4.3-4.3" />
                      </svg>
                      Add a keyword search to this study
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: C.muted,
                        marginTop: "3px",
                      }}
                    >
                      Find verses by keyword and add just those
                    </div>
                  </button>
                  <button
                    onClick={startAddChapter}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "14px",
                      borderRadius: "12px",
                      border: "1px solid " + C.border,
                      background: C.soft,
                      color: C.text,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "15px",
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <svg
                        width="17"
                        height="17"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={TYPE_RED}
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                      </svg>
                      Add a chapter to this study
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: C.muted,
                        marginTop: "3px",
                      }}
                    >
                      Link a whole chapter in — it shares this study’s themes
                    </div>
                  </button>
                </>
              )}
            </div>,
            460
          );
        })()}

      {/* Add a chapter to a recorded (chapter/linked) study, from the Studies hub */}
      {addChapterStudy && (
        <div
          onClick={() => setAddChapterStudy(null)}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.4)",
            zIndex: 500,
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
          <div>
            {addSheetMode === "choice" ? (
              <>
                <div
                  style={{
                    fontSize: "18px",
                    fontWeight: 700,
                    marginBottom: "2px",
                  }}
                >
                  Add to this study
                </div>
                <div
                  style={{
                    fontSize: "12.5px",
                    color: C.muted,
                    marginBottom: "16px",
                  }}
                >
                  “{addChapterStudy.name}”
                </div>
                <button
                  onClick={() => setAddSheetMode("chapter")}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "14px",
                    borderRadius: "12px",
                    border: "1px solid " + C.border,
                    background: C.soft,
                    color: C.text,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    marginBottom: "8px",
                  }}
                >
                  <div style={{ fontSize: "15px", fontWeight: 700 }}>
                    Add a specific chapter
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: C.muted,
                      marginTop: "2px",
                    }}
                  >
                    Link a whole chapter into this study
                  </div>
                </button>
                <button
                  onClick={() => {
                    const rec = addChapterStudy;
                    setAddChapterStudy(null);
                    if (rec) {
                      setAddVersesRecId(rec.id);
                      setSearchOpen(true);
                    }
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "14px",
                    borderRadius: "12px",
                    border: "1px solid " + C.border,
                    background: C.soft,
                    color: C.text,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <div style={{ fontSize: "15px", fontWeight: 700 }}>
                    Search &amp; add verses
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: C.muted,
                      marginTop: "2px",
                    }}
                  >
                    Find verses by keyword and add just those
                  </div>
                </button>
              </>
            ) : (
              <>
            <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "2px" }}>
              Add a chapter
            </div>
            <div
              style={{ fontSize: "12.5px", color: C.muted, marginBottom: "4px" }}
            >
              to “{addChapterStudy.name}”
            </div>
            <div
              style={{
                fontSize: "11.5px",
                color: C.muted,
                lineHeight: 1.5,
                marginBottom: "16px",
              }}
            >
              {addChapterStudy.type === "chapter"
                ? "Linked chapters share one set of theme names and compile together. Adding a chapter turns this into a linked study."
                : "Pick another chapter to link in. It shares this study’s theme names and compiles together."}
            </div>

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
              Chapter to add
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

            {targetScope && addChapterInStudy(targetScope) && (
              <div
                style={{ fontSize: "13px", color: C.muted, marginBottom: "8px" }}
              >
                That chapter is already in this study — pick another.
              </div>
            )}

            <button
              onClick={confirmAddChapter}
              disabled={!targetScope || addChapterInStudy(targetScope)}
              style={{
                width: "100%",
                background: ACCENT,
                color: "#fff",
                border: "none",
                borderRadius: "10px",
                padding: "13px",
                fontSize: "14px",
                fontWeight: 700,
                cursor:
                  !targetScope || addChapterInStudy(targetScope)
                    ? "default"
                    : "pointer",
                opacity:
                  !targetScope || addChapterInStudy(targetScope) ? 0.5 : 1,
                fontFamily: "inherit",
              }}
            >
              {targetScope && !addChapterInStudy(targetScope)
                ? "Add " + targetScope
                : "Add chapter"}
            </button>
              </>
            )}
          </div>
          </div>
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
      {screensOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 260,
            backgroundColor: C.bg,
            color: C.text,
            display: "flex",
            flexDirection: "column",
            animation: "mob-fadein 0.2s ease",
          }}
        >
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "54px",
              paddingTop: "env(safe-area-inset-top)",
              flexShrink: 0,
            }}
          >
            <div style={{ fontSize: "19px", fontWeight: 800 }}>Screens</div>
            <button
              onClick={() => setScreensOpen(false)}
              aria-label="Back to reading"
              style={{
                position: "absolute",
                right: "14px",
                top: "calc(env(safe-area-inset-top) + 50%)",
                transform: "translateY(-50%)",
                width: "34px",
                height: "34px",
                borderRadius: "50%",
                border: "1px solid " + C.border,
                background: C.panel,
                color: C.text,
                fontSize: "18px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "inherit",
              }}
            >
              {"\u2715"}
            </button>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "14px",
              padding: "6px 14px calc(env(safe-area-inset-bottom) + 100px)",
            }}
          >
            {tabs.map((t) => {
              const info = tabInfo(t);
              const isActive = t.id === activeTabId;
              return (
                <div
                  key={t.id}
                  onClick={() => switchTab(t.id)}
                  style={{
                    background: C.panel,
                    border: isActive
                      ? "2px solid " + ACCENT
                      : "1px solid " + C.border,
                    borderRadius: "14px",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    height: "200px",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      padding: "10px 10px 8px 12px",
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: "6px",
                      borderBottom: "1px solid " + C.border,
                      background: isActive
                        ? "rgba(139,92,246,0.07)"
                        : "transparent",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      {info.study && (
                        <div
                          style={{
                            fontSize: "9.5px",
                            fontWeight: 700,
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                            color: info.linked ? TYPE_PURPLE : TYPE_BLUE,
                            marginBottom: "2px",
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          <svg
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke={info.linked ? TYPE_PURPLE : TYPE_BLUE}
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <circle cx="11" cy="11" r="7" />
                            <path d="M21 21l-4.3-4.3" />
                          </svg>
                          Keyword study
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: "14px",
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          gap: "5px",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                        }}
                      >
                        {info.color && (
                          <span style={{ flexShrink: 0, display: "flex" }}>
                            <IconLink color={info.color} size={14} />
                          </span>
                        )}
                        <FitTitle
                          full={info.title}
                          compact={info.titleCompact}
                          style={{ flex: "0 1 auto" }}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: C.muted,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          marginTop: "2px",
                        }}
                      >
                        {info.sub}
                      </div>
                    </div>
                    {tabs.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(t.id);
                        }}
                        aria-label="Close tab"
                        style={{
                          flexShrink: 0,
                          width: "24px",
                          height: "24px",
                          borderRadius: "50%",
                          border: "none",
                          background: "transparent",
                          color: C.muted,
                          fontSize: "15px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontFamily: "inherit",
                        }}
                      >
                        {"\u2715"}
                      </button>
                    )}
                  </div>
                  <div
                    style={{
                      padding: "10px 11px",
                      overflow: "hidden",
                      position: "relative",
                      flex: 1,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "Georgia, serif",
                        fontSize: "12.5px",
                        lineHeight: 1.45,
                        color: C.text,
                      }}
                    >
                      {info.preview}
                    </div>
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: "34px",
                        background:
                          "linear-gradient(transparent, " + C.panel + ")",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 22px calc(env(safe-area-inset-bottom) + 18px)",
              height: "84px",
              pointerEvents: "none",
            }}
          >
            <button
              onClick={closeAllTabs}
              style={{
                pointerEvents: "auto",
                fontFamily: "inherit",
                fontSize: "15px",
                fontWeight: 600,
                color: C.text,
                cursor: "pointer",
                padding: "13px 26px",
                borderRadius: "999px",
                border: "1px solid " + C.border,
                background: C.soft,
              }}
            >
              Close All
            </button>
            {tabs.length < MAX_TABS && (
              <button
                onClick={() => {
                  openTab();
                  setScreensOpen(false);
                  setJumpOpen(true);
                }}
                aria-label="New tab"
                style={{
                  pointerEvents: "auto",
                  width: "58px",
                  height: "58px",
                  borderRadius: "50%",
                  border: "none",
                  background: ACCENT,
                  color: "#fff",
                  fontSize: "30px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1,
                  boxShadow: "0 6px 16px rgba(139,92,246,0.4)",
                  fontFamily: "inherit",
                }}
              >
                +
              </button>
            )}
          </div>
        </div>
      )}

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
                marginBottom: "2px",
              }}
            >
              <ScribalWordmark size={36} />
            </div>
            <div
              style={{
                fontSize: "11px",
                letterSpacing: "0.2em",
                color: C.muted,
                marginTop: "10px",
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
              borderLeft: "4px solid " + ACCENT,
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
                style={{ marginLeft: "auto", color: ACCENT, fontSize: "22px" }}
              >
                →
              </span>
            </div>
          </button>

          {/* Gentle progress — a calm reflection, shown only once there's
              something to reflect (no empty state for a brand-new study). */}
          {progress.total > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: "20px",
                marginBottom: "16px",
                color: C.muted,
                fontSize: "12.5px",
              }}
            >
              <span>
                <strong style={{ color: C.text, fontWeight: 700 }}>
                  {progress.chapters}
                </strong>{" "}
                {progress.chapters === 1 ? "chapter" : "chapters"}
              </span>
              <span>
                <strong style={{ color: C.text, fontWeight: 700 }}>
                  {progress.books}
                </strong>{" "}
                {progress.books === 1 ? "book" : "books"}
              </span>
              <span>
                <strong style={{ color: C.text, fontWeight: 700 }}>
                  {progress.total}
                </strong>{" "}
                {progress.total === 1 ? "mark" : "marks"}
              </span>
            </div>
          )}

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
              "How Scribal works",
              "Every feature, on the real screens",
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
                <path d="M16 8l-2.5 5.5L8 16l2.5-5.5z" />
              </svg>,
              () => {
                setHomeOpen(false);
                setSlidesOpen(true);
              }
            )}
            {homeTile(
              "Study tables",
              "Build & present lessons",
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
                <rect x="4" y="3" width="16" height="18" rx="2" />
                <path d="M8 8h8 M8 12h8 M8 16h5" />
              </svg>,
              () => {
                setHomeOpen(false);
                setTablesHomeOpen(true);
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
                {/* Explicit close: on the installed PWA the backdrop strip
                    above the sheet can't be relied on as the only way out
                    (SCR-22 — users got trapped in Settings). */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ fontSize: "16px", fontWeight: 700 }}>
                    Settings
                  </div>
                  <button
                    onClick={() => setSettingsOpen(false)}
                    aria-label="Close settings"
                    style={{
                      border: "none",
                      background: "transparent",
                      color: C.muted,
                      fontSize: "22px",
                      lineHeight: 1,
                      padding: "4px 8px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    ✕
                  </button>
                </div>

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
                  {COLORS.map((c) => (
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
                {actionBtn("How Scribal works", () => {
                  setSettingsOpen(false);
                  setSlidesOpen(true);
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

                {label("Legal")}
                {actionBtn("Privacy Policy", () => {
                  window.open("/privacy.html", "_blank");
                })}
                {actionBtn("Terms of Service", () => {
                  window.open("/terms.html", "_blank");
                })}
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
            zIndex: addVersesRecId ? 500 : 200,
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
                  stroke={TYPE_BLUE}
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
                setLinkToChapterScope(null);
                if (addToStudyId) {
                  const id = addToStudyId;
                  setAddToStudyId(null);
                  // Same scroll-freeze guard as handleAddToStudy: let the
                  // sheet unmount and the keyboard settle before the study
                  // screen remounts.
                  closeSearchThen(() => openStudyTabById(id));
                }
                setAddVersesRecId(null);
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
              currentChapter={title}
              C={C}
              marks={marks}
              markLabel={effLabel}
              orderOf={orderOf}
              onJump={jumpToRef}
              onPickScripture={(ref) => setChooseRef(ref)}
              onLinkConfirm={onLinkConfirm}
              startLinking={
                !!addToStudyId || !!addVersesRecId || !!linkToChapterScope
              }
              addToStudyName={
                addToStudyId
                  ? searchStudies.find((s) => s.id === addToStudyId)?.name
                  : undefined
              }
              onAddToStudy={handleAddToStudy}
              addVersesName={
                addVersesRecId
                  ? studies.find((s) => s.id === addVersesRecId)?.name
                  : undefined
              }
              onAddVerses={handleAddVersesToRec}
            />
          </div>
        </div>
      )}

      {/* Send verses → start a new study or add to an existing one */}
      {sendRefs && !sendTablePicking && (
        <div
          onClick={() => {
            setSendRefs(null);
            setSendPicking(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 470,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: "380px",
              background: C.bg,
              color: C.text,
              borderRadius: "16px",
              border: "1px solid " + C.border,
              padding: "18px",
              boxShadow: "0 24px 70px rgba(0,0,0,0.4)",
            }}
          >
            {!sendPicking ? (
              <>
                <div style={{ fontSize: "16px", fontWeight: 700 }}>
                  Send{" "}
                  {sendRefs.length === 1
                    ? "this verse"
                    : sendRefs.length + " verses"}
                </div>
                <div
                  style={{
                    fontSize: "12.5px",
                    color: C.muted,
                    marginTop: "3px",
                    lineHeight: 1.45,
                  }}
                >
                  Start a new study from{" "}
                  {sendRefs.length === 1 ? "it" : "them"}, or add to one you
                  already have.
                </div>
                <button
                  onClick={() => {
                    const refs = sendRefs;
                    setSendRefs(null);
                    setSendPicking(false);
                    setLinkDraftRefs(refs);
                  }}
                  style={{
                    width: "100%",
                    marginTop: "14px",
                    padding: "12px 14px",
                    borderRadius: "10px",
                    border: "none",
                    background: ACCENT,
                    color: "#fff",
                    fontSize: "14px",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Create a new study
                </button>
                <button
                  onClick={() => setSendPicking(true)}
                  style={{
                    width: "100%",
                    marginTop: "10px",
                    padding: "12px 14px",
                    borderRadius: "10px",
                    border: "1px solid " + C.border,
                    background: C.panel,
                    color: C.text,
                    fontSize: "14px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Add to an existing study
                </button>
                <button
                  onClick={() => setSendTablePicking(true)}
                  style={{
                    width: "100%",
                    marginTop: "10px",
                    padding: "12px 14px",
                    borderRadius: "10px",
                    border: "1px solid #16a34a",
                    background: "transparent",
                    color: "#16a34a",
                    fontSize: "14px",
                    fontWeight: 650,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Set aside in a study table
                </button>
                <button
                  onClick={() => {
                    setSendRefs(null);
                    setSendPicking(false);
                  }}
                  style={{
                    display: "block",
                    margin: "14px 0 0 auto",
                    background: "transparent",
                    border: "none",
                    color: C.muted,
                    fontSize: "13.5px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    padding: "4px",
                  }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: "16px", fontWeight: 700 }}>
                  Add to a study
                </div>
                <div
                  style={{
                    fontSize: "12.5px",
                    color: C.muted,
                    marginTop: "3px",
                    lineHeight: 1.45,
                  }}
                >
                  {sendRefs.length === 1
                    ? "1 verse"
                    : sendRefs.length + " verses"}{" "}
                  will be added to the study you pick.
                </div>
                {(() => {
                  const opts = searchStudies.filter((s) => !isSearchDeleted(s));
                  if (!opts.length)
                    return (
                      <div
                        style={{
                          marginTop: "14px",
                          fontSize: "13.5px",
                          color: C.muted,
                          lineHeight: 1.5,
                        }}
                      >
                        You don’t have any studies to add to yet. Create one
                        instead.
                      </div>
                    );
                  return (
                    <div
                      style={{
                        marginTop: "12px",
                        maxHeight: "300px",
                        overflowY: "auto",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      }}
                    >
                      {opts.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => {
                            const refs = sendRefs;
                            setSendRefs(null);
                            setSendPicking(false);
                            sendToExistingStudyMobile(s, refs);
                          }}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "11px 13px",
                            borderRadius: "10px",
                            border: "1px solid " + C.border,
                            background: C.panel,
                            color: C.text,
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "14px",
                              fontWeight: 600,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {s.name || "Untitled study"}
                          </div>
                          <div
                            style={{
                              fontSize: "12px",
                              color: C.muted,
                              marginTop: "2px",
                            }}
                          >
                            {s.refs.length === 1
                              ? "1 verse"
                              : s.refs.length + " verses"}
                          </div>
                        </button>
                      ))}
                    </div>
                  );
                })()}
                <button
                  onClick={() => setSendPicking(false)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: C.muted,
                    fontSize: "13.5px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    padding: "6px 2px",
                    marginTop: "14px",
                  }}
                >
                  ‹ Back
                </button>
              </>
            )}
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
          const gTop =
            gatheredTop && gatheredTop.id === study.id ? gatheredTop.refs : [];
          const gTopSet = new Set(gTop);
          const studyRefs = [
            ...gTop,
            ...study.refs.filter((r) => !gTopSet.has(r)),
          ];
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
              {/* Row 1 — home / screens / title / compile, like the reading screen */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "calc(env(safe-area-inset-top) + 10px) 12px 0",
                }}
              >
                <button
                  onClick={() => {
                    leaveStudyTab();
                    setHomeOpen(true);
                  }}
                  aria-label="Home"
                  style={navBtn(C, false)}
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
                <button
                  onClick={() => setScreensOpen(true)}
                  aria-label="Screens"
                  style={{
                    ...navBtn(C, false),
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
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
                    <rect x="8" y="3" width="13" height="13" rx="2.5" />
                    <path d="M16 19v.5A1.5 1.5 0 0 1 14.5 21h-9A1.5 1.5 0 0 1 4 19.5v-9A1.5 1.5 0 0 1 5.5 9H6" />
                  </svg>
                  {tabs.length > 1 && (
                    <span
                      style={{
                        position: "absolute",
                        top: "4px",
                        right: "3px",
                        minWidth: "14px",
                        height: "14px",
                        padding: "0 3px",
                        background: ACCENT,
                        color: "#fff",
                        borderRadius: "99px",
                        fontSize: "9px",
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        lineHeight: 1,
                      }}
                    >
                      {tabs.length}
                    </span>
                  )}
                </button>
                <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "10px",
                      fontWeight: 700,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      color: study.linkedScope ? TYPE_PURPLE : TYPE_BLUE,
                    }}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={study.linkedScope ? TYPE_PURPLE : TYPE_BLUE}
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
                    {study.refs.length}{" "}
                    {study.refs.length === 1 ? "verse" : "verses"} · {bookName}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setCompileStudy(study);
                    setCompileRec(null);
                    const kwMarks = allMarks.filter(
                      (m) =>
                        m.bookId === study.bookId &&
                        study.refs.includes(m.reference)
                    );
                    if (kwMarks.length > 0) startCompile(kwMarks);
                    else setCompileOpen(true);
                  }}
                  disabled={removeMode || sendMode}
                  aria-label="Compile this study"
                  style={{
                    flexShrink: 0,
                    background: removeMode || sendMode ? C.soft : C.text,
                    color: removeMode || sendMode ? C.muted : C.bg,
                    border: "none",
                    borderRadius: "999px",
                    padding: "8px 16px",
                    fontSize: "12.5px",
                    fontWeight: 700,
                    cursor: removeMode || sendMode ? "default" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Compile
                </button>
              </div>

              {/* Row 2 — remove verses / link, or the remove-mode status */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  padding: "9px 14px 10px",
                  borderBottom: "1px solid " + C.border,
                }}
              >
                {removeMode ? (
                  <>
                    <span
                      style={{
                        fontSize: "13px",
                        fontWeight: 700,
                        color: C.text,
                      }}
                    >
                      Tap verses to remove
                    </span>
                    <span style={{ fontSize: "12px", color: C.muted }}>
                      {removeSel.size} selected
                    </span>
                  </>
                ) : sendMode ? (
                  <>
                    <span
                      style={{
                        fontSize: "13px",
                        fontWeight: 700,
                        color: C.text,
                      }}
                    >
                      Tap verses to send
                    </span>
                    <span style={{ fontSize: "12px", color: C.muted }}>
                      {sendSel.size} selected
                    </span>
                  </>
                ) : (
                  <>
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      onClick={() => {
                        setSendSel(new Set());
                        setSendMode(true);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        padding: "8px 14px",
                        borderRadius: "999px",
                        border: "1px solid " + C.border,
                        background: "transparent",
                        color: C.text,
                        fontFamily: "inherit",
                        fontSize: "13px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Send verses
                    </button>
                    <button
                      onClick={() => {
                        setRemoveSel(new Set());
                        setRemoveMode(true);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        padding: "8px 14px",
                        borderRadius: "999px",
                        border: "1px solid " + C.border,
                        background: "transparent",
                        color: C.text,
                        fontFamily: "inherit",
                        fontSize: "13px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Remove verses
                    </button>
                  </div>
                    <button
                      onClick={() => openKwLink(study)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "7px",
                        flexShrink: 0,
                        padding: "8px 14px",
                        borderRadius: "999px",
                        border: "1px solid " + C.border,
                        background: "transparent",
                        color: study.linkedScope ? TYPE_PURPLE : TYPE_BLUE,
                        fontFamily: "inherit",
                        fontSize: "13px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      <LinkGlyph
                        color={study.linkedScope ? TYPE_PURPLE : TYPE_BLUE}
                        size={15}
                      />
                      {study.linkedScope ? "Linked" : "Link"}
                    </button>
                  </>
                )}
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
                  {studyRefs.map((ref) => {
                    const vi = VI.get(ref);
                    if (!vi) return null;
                    const selecting = removeMode || sendMode;
                    const selSet = removeMode ? removeSel : sendSel;
                    const setSel = removeMode ? setRemoveSel : setSendSel;
                    const checked = selSet.has(ref);
                    const verse = (
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
                          !selecting && editMark && editMark.reference === ref
                            ? editMark.id
                            : null
                        }
                        editingActive={!selecting && !!editMark}
                        onEnterEdit={onEnterEdit}
                        onAdjust={onAdjust}
                        tags={wordTags}
                        onTagTap={openTagRef}
                      />
                    );
                    return (
                      <div key={ref} style={{ marginBottom: "16px" }}>
                        <div
                          style={{
                            fontFamily:
                              "system-ui, -apple-system, sans-serif",
                            fontSize: "11px",
                            color: C.muted,
                            marginBottom: "3px",
                            marginLeft: selecting ? "34px" : 0,
                          }}
                        >
                          {ref}
                        </div>
                        {selecting ? (
                          <div
                            onClick={() =>
                              setSel((prev) => {
                                const next = new Set(prev);
                                if (next.has(ref)) next.delete(ref);
                                else next.add(ref);
                                return next;
                              })
                            }
                            style={{
                              display: "flex",
                              gap: "12px",
                              alignItems: "flex-start",
                              cursor: "pointer",
                            }}
                          >
                            <span
                              style={{
                                width: "22px",
                                height: "22px",
                                borderRadius: "6px",
                                border:
                                  "2px solid " + (checked ? ACCENT : C.border),
                                background: checked ? ACCENT : "transparent",
                                color: "#fff",
                                flexShrink: 0,
                                marginTop: "4px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "13px",
                                fontWeight: 800,
                              }}
                            >
                              {checked ? "✓" : ""}
                            </span>
                            <div
                              style={{
                                flex: 1,
                                minWidth: 0,
                                pointerEvents: "none",
                                opacity: checked ? 0.55 : 1,
                              }}
                            >
                              {verse}
                            </div>
                          </div>
                        ) : (
                          verse
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ height: "24px" }} />
              </div>

              {/* Remove-verses bar (replaces the pen bar in remove mode) */}
              {removeMode && (
                <div
                  style={{
                    padding:
                      "12px 14px calc(14px + env(safe-area-inset-bottom))",
                    borderTop: "1px solid " + C.border,
                    background: C.panel,
                    display: "flex",
                    gap: "10px",
                  }}
                >
                  <button
                    onClick={() => {
                      setRemoveMode(false);
                      setRemoveSel(new Set());
                    }}
                    style={{
                      flex: 1,
                      padding: "12px",
                      borderRadius: "10px",
                      border: "1px solid " + C.border,
                      background: "transparent",
                      color: C.muted,
                      fontSize: "14px",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => removeSelectedVerses(study.id)}
                    disabled={removeSel.size === 0}
                    style={{
                      flex: 1,
                      padding: "12px",
                      borderRadius: "10px",
                      border: "none",
                      background: removeSel.size === 0 ? C.soft : "#ef4444",
                      color: removeSel.size === 0 ? C.muted : "#fff",
                      fontSize: "14px",
                      fontWeight: 800,
                      cursor: removeSel.size === 0 ? "default" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {removeSel.size === 0
                      ? "Remove verses"
                      : "Remove " +
                        removeSel.size +
                        (removeSel.size === 1 ? " verse" : " verses")}
                  </button>
                </div>
              )}

              {/* Send-verses bar (mirrors the reading-page send bar) */}
              {sendMode && (
                <div
                  style={{
                    padding:
                      "12px 14px calc(14px + env(safe-area-inset-bottom))",
                    borderTop: "1px solid " + C.border,
                    background: C.panel,
                    display: "flex",
                    gap: "10px",
                  }}
                >
                  <button
                    onClick={() => {
                      setSendMode(false);
                      setSendSel(new Set());
                    }}
                    style={{
                      flex: 1,
                      padding: "12px",
                      borderRadius: "10px",
                      border: "1px solid " + C.border,
                      background: "transparent",
                      color: C.muted,
                      fontSize: "14px",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (!sendSel.size) return;
                      const refs = Array.from(sendSel).sort(
                        (a, b) => orderOf(a) - orderOf(b)
                      );
                      setSendMode(false);
                      setSendSel(new Set());
                      setSendPicking(false);
                      setSendRefs(refs);
                    }}
                    disabled={sendSel.size === 0}
                    style={{
                      flex: 1,
                      padding: "12px",
                      borderRadius: "10px",
                      border: "none",
                      background: sendSel.size === 0 ? C.soft : ACCENT,
                      color: sendSel.size === 0 ? C.muted : "#fff",
                      fontSize: "14px",
                      fontWeight: 800,
                      cursor: sendSel.size === 0 ? "default" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {sendSel.size === 0
                      ? "Send verses"
                      : "Send " +
                        sendSel.size +
                        (sendSel.size === 1 ? " verse" : " verses")}
                  </button>
                </div>
              )}

              {/* Compact pen bar */}
              {!removeMode && !sendMode && (
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
                          minWidth: 0,
                          padding: 0,
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
                        {toolGlyph(s.tool)}
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
              )}
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
          // A chapter/group with a keyword search linked to it is a combined
          // study: it shows once under Combined, never also as a chapter/linked
          // row. Multiple searches on one chapter collapse into one entry.
          const combinedScopes = new Set(
            liveSearch
              .filter((s) => s.linkedScope)
              .map((s) => resolveScope(s.linkedScope as string))
          );
          const chapterStudyRecs = chapterRecs.filter(
            (s) => !combinedScopes.has(resolveScope(s.scopeRef))
          );
          const linkedStudyRecs = linkedRecs.filter(
            (s) => !combinedScopes.has("group:" + s.scopeRef)
          );
          const standaloneSearch = liveSearch.filter((s) => !s.linkedScope);
          const combinedMap = new Map<string, SearchStudy[]>();
          liveSearch
            .filter((s) => s.linkedScope)
            .forEach((s) => {
              const sc = resolveScope(s.linkedScope as string);
              const arr = combinedMap.get(sc) || [];
              arr.push(s);
              combinedMap.set(sc, arr);
            });
          const combinedGroups = Array.from(combinedMap.entries());
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
            chapterRecs.length +
            linkedRecs.length +
            liveSearch.length;

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
            onInfo?: () => void,
            onMove?: () => void
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
                {onMove && (
                  <button
                    onClick={onMove}
                    aria-label="Move study to another book"
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
                    <svg
                      width="17"
                      height="17"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={C.muted}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
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
                  <>
                    <div
                      style={{
                        fontSize: "13px",
                        color: C.muted,
                        lineHeight: 1.5,
                      }}
                    >
                      No studies yet. Mark a chapter and tap{" "}
                      <b style={{ color: C.text }}>Compile</b> to record it here,
                      or build one from Search.
                    </div>
                    <button
                      onClick={() => {
                        setStudiesOpen(false);
                        setExampleOpen(true);
                      }}
                      style={{
                        marginTop: "16px",
                        background: "transparent",
                        border: "1px solid " + C.border,
                        borderRadius: "999px",
                        padding: "10px 18px",
                        color: C.text,
                        fontSize: "13px",
                        fontWeight: 600,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      See an example study →
                    </button>
                  </>
                ) : (
                  <>
                    {(chapterStudyRecs.length > 0 ||
                      linkedStudyRecs.length > 0) &&
                      section("Chapter studies", TYPE_RED, [
                        ...chapterStudyRecs.map((s) =>
                          row(
                            s.id,
                            s.name,
                            countChapter(s) +
                              " mark" +
                              (countChapter(s) === 1 ? "" : "s") +
                              (bookLabel(s.bookId)
                                ? " · " + bookLabel(s.bookId)
                                : ""),
                            TYPE_RED,
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
                              ),
                            () =>
                              setMoveTarget({
                                id: s.id,
                                kind: "chapter",
                                bookId: s.bookId,
                                name: s.name,
                                refs: studyRefsFor(
                                  s.bookId,
                                  (r) => scopeOf(r) === s.scopeRef,
                                  s.extraRefs
                                ),
                                scope: resolveScope(s.scopeRef),
                              })
                          )
                        ),
                        ...linkedStudyRecs.map((s) =>
                          row(
                            s.id,
                            s.name,
                            countLinked(s) +
                              " mark" +
                              (countLinked(s) === 1 ? "" : "s") +
                              (bookLabel(s.bookId)
                                ? " · " + bookLabel(s.bookId)
                                : ""),
                            TYPE_RED,
                            () => openRecordedStudy(s),
                            () => {
                              if (
                                window.confirm(
                                  "Remove this study from the list? Your marks stay in the book."
                                )
                              )
                                deleteStudy(s.id);
                            },
                            <IconLink color={TYPE_RED} />,
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
                              ),
                            () =>
                              setMoveTarget({
                                id: s.id,
                                kind: "linked",
                                bookId: s.bookId,
                                name: s.name,
                                refs: studyRefsFor(
                                  s.bookId,
                                  (r) =>
                                    chapterGroups[scopeOf(r)] === s.scopeRef,
                                  s.extraRefs
                                ),
                                scope: "group:" + s.scopeRef,
                              })
                          )
                        ),
                      ])}
                    {combinedGroups.length > 0 &&
                      section(
                        "Combined studies",
                        TYPE_PURPLE,
                        combinedGroups.map(([sc, group]) => {
                          const primary = group[0];
                          const rec = liveStudies.find(
                            (s) =>
                              (s.type === "chapter" &&
                                resolveScope(s.scopeRef) === sc) ||
                              (s.type === "linked" &&
                                "group:" + s.scopeRef === sc)
                          );
                          const terms = group
                            .map((g) => '"' + g.name + '"')
                            .join(", ");
                          const allRefs = new Set(group.flatMap((g) => g.refs));
                          const title =
                            (rec && rec.name) ||
                            displayOf(primary.linkedScope as string) ||
                            primary.name;
                          return row(
                            "combined:" + sc,
                            title,
                            terms +
                              " · " +
                              allRefs.size +
                              " verse" +
                              (allRefs.size === 1 ? "" : "s"),
                            TYPE_PURPLE,
                            () => openKeywordCompile(primary),
                            () => {
                              if (
                                window.confirm(
                                  "Delete this combined study? The linked keyword " +
                                    (group.length === 1
                                      ? "search"
                                      : "searches") +
                                    " will be removed. Your marks stay in the book."
                                )
                              )
                                group.forEach((g) => deleteSearchStudy(g.id));
                            },
                            <IconLink color={TYPE_PURPLE} />,
                            detail(
                              displayOf(primary.linkedScope as string) +
                                "  +  " +
                                terms,
                              themesFor(
                                primary.bookId,
                                "searchstudy:" + primary.id,
                                (r) => allRefs.has(r)
                              )
                            ),
                            infoStudyId === "combined:" + sc,
                            () =>
                              setInfoStudyId(
                                infoStudyId === "combined:" + sc
                                  ? null
                                  : "combined:" + sc
                              )
                          );
                        })
                      )}
                    {standaloneSearch.length > 0 &&
                      section(
                        "Keyword studies",
                        TYPE_BLUE,
                        standaloneSearch.map((ss) =>
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
                            TYPE_BLUE,
                            () => openKeywordCompile(ss),
                            () => {
                              if (
                                window.confirm(
                                  "Delete this study? Your marks stay in the book."
                                )
                              )
                                deleteSearchStudy(ss.id);
                            },
                            <IconLink color={TYPE_BLUE} />,
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
                              ),
                            () =>
                              setMoveTarget({
                                id: ss.id,
                                kind: "keyword",
                                bookId: ss.bookId,
                                name: ss.name,
                                refs: ss.refs,
                                scope: "searchstudy:" + ss.id,
                              })
                          )
                        )
                      )}
                  </>
                )}
              </div>
            </div>
          );
        })()}

      {/* Back-to-table pill: shown while marking a card's verses in the reader */}
      {markTripTableId && !editTableId && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: "calc(20px + env(safe-area-inset-bottom))",
            transform: "translateX(-50%)",
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: C.panel,
            border: "1px solid " + C.border,
            borderRadius: "999px",
            boxShadow: "0 12px 34px -10px rgba(0,0,0,.45)",
            padding: "4px 4px 4px 6px",
          }}
        >
          <button
            onClick={() => {
              setEditTableId(markTripTableId);
              setMarkTripTableId(null);
            }}
            style={{
              border: "none",
              background: "transparent",
              color: ACCENT,
              fontSize: "14px",
              fontWeight: 700,
              padding: "10px 12px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            ‹ Back to table
          </button>
          <button
            onClick={() => setMarkTripTableId(null)}
            aria-label="Dismiss"
            style={{
              width: "34px",
              height: "34px",
              borderRadius: "999px",
              border: "none",
              background: "transparent",
              color: C.muted,
              fontSize: "16px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* New-table flow: import a study, or pick where marking lives */}
      {newTableFlow && (
        <div
          onClick={() => setNewTableFlow(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 470,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "flex-end",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxHeight: "75vh",
              overflowY: "auto",
              background: C.panel,
              color: C.text,
              borderRadius: "16px 16px 0 0",
              padding: "16px 16px calc(16px + env(safe-area-inset-bottom))",
            }}
          >
            {newTableFlow === "choose" ? (
              <>
                <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px" }}>
                  New study table
                </div>
                <button
                  onClick={() => setNewTableFlow("import")}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "13px 14px",
                    borderRadius: "11px",
                    border: "1px solid #16a34a",
                    background: "transparent",
                    color: C.text,
                    marginBottom: "9px",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <div style={{ fontSize: "14.5px", fontWeight: 650 }}>Import a study</div>
                  <div style={{ fontSize: "12px", color: C.muted, marginTop: "2px" }}>
                    Its verses arrive in Selected, grouped by theme
                  </div>
                </button>
                <button
                  onClick={() => {
                    setNtSessionName("");
                    setNewTableFlow("book");
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "13px 14px",
                    borderRadius: "11px",
                    border: "1px solid " + C.border,
                    background: C.panel,
                    color: C.text,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <div style={{ fontSize: "14.5px", fontWeight: 650 }}>Start from scratch</div>
                  <div style={{ fontSize: "12px", color: C.muted, marginTop: "2px" }}>
                    A blank table — you pick where its marking lives
                  </div>
                </button>
              </>
            ) : newTableFlow === "book" ? (
              <>
                <div style={{ fontSize: "16px", fontWeight: 700 }}>
                  Where should marking live?
                </div>
                <div style={{ fontSize: "12.5px", color: C.muted, margin: "4px 0 12px" }}>
                  This table pulls its verse marking from the book you pick.
                </div>
                {books.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => pickTableBook(b.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "12px 13px",
                      borderRadius: "10px",
                      border: "1px solid " + C.border,
                      background: C.panel,
                      color: C.text,
                      marginBottom: "8px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    <div style={{ fontSize: "14px", fontWeight: 650 }}>
                      {b.isMaster ? "Master Book" : b.name || "Session"}
                    </div>
                    <div style={{ fontSize: "12px", color: C.muted, marginTop: "2px" }}>
                      {b.markCount === 1 ? "1 mark" : b.markCount + " marks"}
                    </div>
                  </button>
                ))}
                <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                  <input
                    value={ntSessionName}
                    placeholder="Or name a new session…"
                    onChange={(e) => setNtSessionName(e.target.value)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      border: "1px solid " + C.border,
                      borderRadius: "10px",
                      outline: "none",
                      background: C.soft,
                      color: C.text,
                      fontSize: "16px",
                      padding: "11px 12px",
                      fontFamily: "inherit",
                    }}
                  />
                  <button
                    onClick={() => {
                      if (!ntSessionName.trim()) return;
                      pickTableBook(createSession(ntSessionName.trim()));
                    }}
                    disabled={!ntSessionName.trim()}
                    style={{
                      border: "none",
                      borderRadius: "10px",
                      background: ACCENT,
                      color: "#fff",
                      fontSize: "13.5px",
                      fontWeight: 700,
                      padding: "11px 16px",
                      opacity: ntSessionName.trim() ? 1 : 0.45,
                      cursor: ntSessionName.trim() ? "pointer" : "default",
                      fontFamily: "inherit",
                      flexShrink: 0,
                    }}
                  >
                    Create
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px" }}>
                  Import a study
                </div>
                {[
                  ...studies.map((st) => ({
                    id: st.id,
                    name: st.name,
                    bookId: st.bookId,
                    kind: st.type === "linked" ? "Linked study" : "Chapter study",
                  })),
                  ...searchStudies.map((st) => ({
                    id: st.id,
                    name: st.name,
                    bookId: st.bookId,
                    kind: "Keyword study",
                  })),
                ].map((m) => (
                  <button
                    key={m.id}
                    onClick={() => importStudyToTable(m)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "12px 13px",
                      borderRadius: "10px",
                      border: "1px solid " + C.border,
                      background: C.panel,
                      color: C.text,
                      marginBottom: "8px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    <div style={{ fontSize: "14px", fontWeight: 650 }}>
                      {m.name || "Untitled study"}
                    </div>
                    <div style={{ fontSize: "12px", color: C.muted, marginTop: "2px" }}>
                      {m.kind}
                      {m.bookId !== "master"
                        ? " · " + (getBook(m.bookId).name || "session")
                        : ""}
                    </div>
                  </button>
                ))}
                {studies.length + searchStudies.length === 0 && (
                  <div style={{ fontSize: "13px", color: C.muted }}>
                    No studies yet — compile a chapter or save a keyword search
                    first.
                  </div>
                )}
              </>
            )}
            {newTableFlow !== "choose" && (
              <button
                onClick={() => setNewTableFlow("choose")}
                style={{
                  marginTop: "10px",
                  border: "none",
                  background: "transparent",
                  color: C.muted,
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  padding: "6px 2px",
                }}
              >
                ‹ Back
              </button>
            )}
          </div>
        </div>
      )}

      {/* Send → table: pick which table's Selected the verses land in */}
      {sendTablePicking && sendRefs && (
        <div
          onClick={() => setSendTablePicking(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 460,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "flex-end",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxHeight: "70vh",
              overflowY: "auto",
              background: C.panel,
              color: C.text,
              borderRadius: "16px 16px 0 0",
              padding:
                "16px 16px calc(16px + env(safe-area-inset-bottom))",
            }}
          >
            <div style={{ fontSize: "15px", fontWeight: 700, marginBottom: "4px" }}>
              Set aside in…
            </div>
            <div style={{ fontSize: "12.5px", color: C.muted, marginBottom: "12px" }}>
              {sendRefs.length === 1 ? "1 verse lands" : sendRefs.length + " verses land"} in the table's Selected list.
            </div>
            {studyTables.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  const cards = sendRefs.map((r) => ({
                    id: newCardId(),
                    kind: "scripture" as const,
                    refs: [r],
                    bookId: activeBookId,
                    shelfGroup: "Sent from reading",
                  }));
                  updateStudyTable(t.id, {
                    shelf: [...(t.shelf || []), ...cards],
                  });
                  setSendTablePicking(false);
                  setSendRefs(null);
                  setSendPicking(false);
                  setSendMode(false);
                  flash("Set aside in " + (t.name || "table"));
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 13px",
                  borderRadius: "10px",
                  border: "1px solid " + C.border,
                  background: C.panel,
                  color: C.text,
                  marginBottom: "8px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <div style={{ fontSize: "14px", fontWeight: 650 }}>
                  {t.name || "Untitled table"}
                </div>
                <div style={{ fontSize: "12px", color: C.muted, marginTop: "2px" }}>
                  {(t.shelf || []).length
                    ? (t.shelf || []).length + " set aside"
                    : t.cards.length + " cards"}
                </div>
              </button>
            ))}
            <button
              onClick={() => {
                const id = createStudyTable("Untitled", undefined, activeBookId);
                const cards = sendRefs.map((r) => ({
                  id: newCardId(),
                  kind: "scripture" as const,
                  refs: [r],
                  bookId: activeBookId,
                  shelfGroup: "Sent from reading",
                }));
                updateStudyTable(id, { shelf: cards });
                setSendTablePicking(false);
                setSendRefs(null);
                setSendPicking(false);
                setSendMode(false);
                flash("New table created");
              }}
              style={{
                width: "100%",
                padding: "12px 13px",
                borderRadius: "10px",
                border: "1.5px dashed " + C.border,
                background: "transparent",
                color: "#16a34a",
                fontSize: "14px",
                fontWeight: 650,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              + New study table
            </button>
          </div>
        </div>
      )}

      {/* Study tables home: the menu entry — learn it, open the example,
          open or create a table */}
      {tablesHomeOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 250,
            background: C.bg,
            color: C.text,
            display: "flex",
            flexDirection: "column",
            paddingTop: "env(safe-area-inset-top)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "12px 14px",
              borderBottom: "1px solid " + C.border,
              flex: "0 0 auto",
            }}
          >
            <button
              onClick={() => setTablesHomeOpen(false)}
              aria-label="Back"
              style={{
                width: "34px",
                height: "34px",
                borderRadius: "9px",
                border: "1px solid " + C.border,
                background: C.panel,
                color: C.muted,
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                lineHeight: 0,
                flex: "0 0 auto",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <div style={{ fontSize: "17px", fontWeight: 700 }}>
              Study tables
            </div>
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
              padding:
                "14px 14px calc(24px + env(safe-area-inset-bottom))",
            }}
          >
            {!tablesIntroSeen && (
              <div
                style={{
                  border: "1px solid " + C.border,
                  background: C.panel,
                  borderRadius: "14px",
                  padding: "14px 15px",
                  marginBottom: "14px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    marginBottom: "8px",
                  }}
                >
                  <div style={{ flex: 1, fontSize: "15px", fontWeight: 700 }}>
                    How a study table works
                  </div>
                  <button
                    onClick={() => {
                      setTablesIntroSeen(true);
                      try {
                        localStorage.setItem("scribal_tables_intro_seen", "1");
                      } catch {}
                    }}
                    style={{
                      border: 0,
                      background: "transparent",
                      color: C.muted,
                      fontSize: "12.5px",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Dismiss
                  </button>
                </div>
                <div
                  style={{
                    fontSize: "13px",
                    lineHeight: 1.65,
                    color: C.text,
                  }}
                >
                  <b>1 · Gather</b> — pull verses in from your studies or
                  search. <b>2 · Arrange</b> — stack cards in order: scripture,
                  your words, questions, quotes, a clip; the column becomes the
                  lesson. <b>3 · Mark</b> — mark the verses in the reader and
                  name your themes; they appear on the cards. <b>4 · Present</b>{" "}
                  — perform it beat by beat, and share a QR so others follow
                  along live.
                </div>
                <button
                  onClick={() => {
                    setTablesHomeOpen(false);
                    openExampleTable();
                  }}
                  style={{
                    marginTop: "11px",
                    fontSize: "13px",
                    fontWeight: 650,
                    color: "#16a34a",
                    background: "transparent",
                    border: "1px solid #16a34a",
                    borderRadius: "999px",
                    padding: "8px 15px",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Open the example table →
                </button>
              </div>
            )}

            {studyTables.map((t) => (
              <div
                key={t.id}
                onClick={() => {
                  setTablesHomeOpen(false);
                  setEditTableId(t.id);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "13px 13px",
                  borderRadius: "12px",
                  border: "1px solid " + C.border,
                  background: C.panel,
                  marginBottom: "9px",
                  cursor: "pointer",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "14.5px",
                      fontWeight: 650,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t.name || "Untitled table"}
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: C.muted,
                      marginTop: "2px",
                    }}
                  >
                    {(t.cards.length === 1
                      ? "1 card"
                      : t.cards.length + " cards") +
                      ((t.shelf || []).length
                        ? " · " + (t.shelf || []).length + " set aside"
                        : "")}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (
                      window.confirm(
                        "Delete this study table? This can't be undone."
                      )
                    )
                      deleteStudyTable(t.id);
                  }}
                  aria-label="Delete table"
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "8px",
                    border: "1px solid " + C.border,
                    background: "transparent",
                    color: C.muted,
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                    lineHeight: 0,
                    flex: "0 0 auto",
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6" />
                  </svg>
                </button>
              </div>
            ))}

            <button
              onClick={() => setNewTableFlow("choose")}
              style={{
                width: "100%",
                padding: "13px 12px",
                borderRadius: "12px",
                border: "1.5px dashed " + C.border,
                background: "transparent",
                color: "#16a34a",
                fontSize: "14px",
                fontWeight: 650,
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "center",
              }}
            >
              + New study table
            </button>

            {tablesIntroSeen && (
              <button
                onClick={() => {
                  setTablesHomeOpen(false);
                  openExampleTable();
                }}
                style={{
                  width: "100%",
                  marginTop: "10px",
                  padding: "11px 12px",
                  borderRadius: "12px",
                  border: 0,
                  background: "transparent",
                  color: C.muted,
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "center",
                }}
              >
                See the example table
              </button>
            )}
          </div>
        </div>
      )}

      {/* Edit a study table on the phone */}
      {editTableId &&
        (() => {
          const t =
            exampleTable && editTableId === exampleTable.id
              ? exampleTable
              : studyTables.find((x) => x.id === editTableId);
          if (!t) return null;
          const isExample = !!exampleTable && t.id === exampleTable.id;
          return (
            <StudyTablesMobile
              table={t}
              onClose={() => {
                setEditTableId(null);
                setEditOpenShelf(false);
                if (isExample) setExampleTable(null);
              }}
              onPresent={() => setPresentTableId(t.id)}
              updateTable={tableUpdate}
              renameTable={tableRename}
              onDelete={() => {
                if (isExample) {
                  setExampleTable(null);
                  setEditTableId(null);
                  return;
                }
                if (
                  window.confirm(
                    "Delete this study table? This can't be undone."
                  )
                ) {
                  deleteStudyTable(t.id);
                  setEditTableId(null);
                }
              }}
              allMarks={allMarks}
              getBook={getBook}
              books={books}
              chapterGroups={chapterGroups}
              wordTags={wordTags}
              onTagTap={openTagRef}
              initialShelfOpen={editOpenShelf}
              onMarkCard={(card) => {
                const ref = (card.refs || [])[0];
                if (!ref) return;
                const bid = card.bookId || t.bookId || "master";
                if (activeBookId !== bid) setActiveBook(bid);
                jumpToRef(ref);
                setMarkTripTableId(t.id);
                setEditTableId(null);
                setEditOpenShelf(false);
              }}
            />
          );
        })()}

      {/* Present a study table (built anywhere, performed here) */}
      {presentTableId &&
        (() => {
          const t =
            exampleTable && presentTableId === exampleTable.id
              ? exampleTable
              : studyTables.find((x) => x.id === presentTableId);
          if (!t) return null;
          return (
            <StudyTablePresent
              table={t}
              renderVerse={(reference, bookId) => {
                const rec = getVerse(reference);
                if (!rec) return <span>{reference}</span>;
                return (
                  <MarkedVerse
                    reference={reference}
                    verseNumber={rec.verse}
                    text={rec.text}
                    marks={bookId ? getBook(bookId).marks : []}
                    tags={wordTags}
                    onTagTap={openTagRef}
                  />
                );
              }}
              themesFor={(refs, bookId) => {
                // Same resolution the desktop card uses: scoped label for the
                // verse's chapter/group only (no book-level fallback, which
                // leaked unrelated old names).
                const bk = getBook(bookId || "master");
                const refset = new Set(refs);
                const seen = new Map<number, string>();
                bk.marks.forEach((m) => {
                  if (!refset.has(m.reference) || seen.has(m.color)) return;
                  const scoped =
                    bk.scopedLabels?.[resolveScope(scopeOf(m.reference))]?.[
                      m.color
                    ];
                  const label = ((scoped || "") as string).trim();
                  seen.set(m.color, label);
                });
                return Array.from(seen.entries())
                  .filter(([, label]) => !!label)
                  .sort((a, b) => a[0] - b[0])
                  .map(([color, label]) => ({ color, label }));
              }}
              onClose={() => setPresentTableId(null)}
              room={{
                start: async () => {
                  // Serialize what a follower needs: table + its verses' marks
                  // (per card book) + named themes, same as the desktop shell.
                  const marks: Mark[] = [];
                  const seenMark = new Set<string>();
                  const themes: Record<
                    string,
                    { color: number; label: string }[]
                  > = {};
                  [...t.cards, ...(t.shelf || [])].forEach((c) => {
                    if (c.kind !== "scripture" || !c.refs || !c.refs.length)
                      return;
                    const bid = c.bookId || t.bookId || "master";
                    const refset = new Set(c.refs);
                    const bk = getBook(bid);
                    bk.marks.forEach((m) => {
                      if (refset.has(m.reference) && !seenMark.has(m.id)) {
                        seenMark.add(m.id);
                        marks.push(m);
                      }
                    });
                    const chips = new Map<number, string>();
                    bk.marks.forEach((m) => {
                      if (!refset.has(m.reference) || chips.has(m.color))
                        return;
                      const scoped =
                        bk.scopedLabels?.[
                          resolveScope(scopeOf(m.reference))
                        ]?.[m.color];
                      chips.set(m.color, ((scoped || "") as string).trim());
                    });
                    themes[themesKey(c.refs, c.bookId)] = Array.from(
                      chips.entries()
                    )
                      .filter(([, label]) => !!label)
                      .sort((a, b) => a[0] - b[0])
                      .map(([color, label]) => ({ color, label }));
                  });
                  const code = newRoomCode();
                  await createRoom(code, {
                    tableJson: JSON.stringify(redactTableForRoom(t)),
                    marksJson: JSON.stringify(marks),
                    themesJson: JSON.stringify(themes),
                  });
                  return code;
                },
                push: pushBeat,
                end: endRoom,
                joinUrl: roomJoinUrl,
              }}
            />
          );
        })()}

      {/* Move a study into a different book */}
      {moveTarget &&
        (() => {
          const target = moveTarget;
          const dateStr = new Date().toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          });
          const choiceBtn = (
            label: string,
            sub: string,
            onClick: () => void
          ) => (
            <button
              key={label}
              onClick={onClick}
              style={{
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "1px solid " + C.border,
                borderRadius: "12px",
                padding: "13px 14px",
                marginBottom: "8px",
                color: C.text,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <div style={{ fontSize: "14px", fontWeight: 600 }}>{label}</div>
              <div
                style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}
              >
                {sub}
              </div>
            </button>
          );
          return sheet(
            () => setMoveTarget(null),
            <div>
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: 700,
                  marginBottom: "2px",
                }}
              >
                Move “{target.name}”
              </div>
              <div
                style={{
                  fontSize: "12px",
                  color: C.muted,
                  marginBottom: "16px",
                  lineHeight: 1.5,
                }}
              >
                Moves the study and its marks into the chosen book, clearing them
                from the old one.
              </div>

              {target.bookId !== "master" &&
                choiceBtn("Master Book", "your default book", () =>
                  tryMove(target, "master", "Master Book")
                )}

              {books
                .filter((b) => !b.isMaster && b.id !== target.bookId)
                .map((b) =>
                  choiceBtn(
                    b.name,
                    b.markCount + " mark" + (b.markCount === 1 ? "" : "s"),
                    () => tryMove(target, b.id, b.name)
                  )
                )}

              {choiceBtn("New session", "a fresh dedicated book", () => {
                const nm = window.prompt("Name this session", target.name);
                if (nm === null) return;
                const id = createSession(nm.trim() || "Session · " + dateStr);
                performMove(target, id);
              })}
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
        <CompileBook
          flyers={compileAnim.flyers}
          colors={compileAnim.colors}
          duration={compileAnim.duration}
          onDone={() => {
            setCompileAnim((a) => ({ ...a, show: false }));
            setCompileOpen(true);
          }}
        />
      )}

      {/* After adding verses to a chapter/linked study: a markable reading list
          (the just-added verses first, then the study's chapter verses) with a
          pen bar, so they can be marked, then compiled. */}
      {markRec &&
        (() => {
          const rec = markRec;
          const VI = verseByRef();
          const recScopes = (
            rec.type === "linked"
              ? Object.keys(chapterGroups).filter(
                  (c) => chapterGroups[c] === rec.scopeRef
                )
              : [rec.scopeRef]
          )
            .slice()
            .sort(
              (a, b) =>
                (chapterLoc.get(a)?.order ?? 0) - (chapterLoc.get(b)?.order ?? 0)
            );
          const chapterRefs: string[] = [];
          recScopes.forEach((scope) => {
            const cl = chapterLoc.get(scope);
            if (cl)
              vols[cl.v].books[cl.b].chapters[cl.c].verses.forEach((v: any) =>
                chapterRefs.push(v.reference)
              );
          });
          const extras = rec.extraRefs || [];
          const extraSet = new Set(extras);
          const readRefs = [
            ...extras,
            ...chapterRefs.filter((r) => !extraSet.has(r)),
          ];
          const goCompile = () => {
            setCompileStudy(null);
            setCompileRec(rec);
            const recMarks = marks.filter(
              (m) =>
                recScopes.includes(scopeOf(m.reference)) ||
                extras.includes(m.reference)
            );
            if (recMarks.length > 0) startCompile(recMarks);
            else setCompileOpen(true);
            setMarkRec(null);
          };
          return (
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 400,
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
                  onClick={() => setMarkRec(null)}
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
                      fontSize: "15px",
                      fontWeight: 700,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {rec.name}
                  </div>
                  <div style={{ fontSize: "11.5px", color: C.muted }}>
                    Mark your added verses, then compile
                  </div>
                </div>
                <button
                  onClick={goCompile}
                  style={{
                    flexShrink: 0,
                    background: C.text,
                    color: C.bg,
                    border: "none",
                    borderRadius: "999px",
                    padding: "9px 16px",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
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
                {extras.length > 0 && (
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: TYPE_BLUE,
                      marginBottom: "8px",
                    }}
                  >
                    Just added
                  </div>
                )}
                <div
                  style={{
                    fontFamily: '"Times New Roman", Times, serif',
                    fontSize: verseSize,
                    lineHeight: reading.lineScale,
                    userSelect: "none",
                    WebkitUserSelect: "none",
                  }}
                >
                  {readRefs.map((ref, i) => {
                    const vi = VI.get(ref);
                    if (!vi) return null;
                    const showStudyHeader =
                      extras.length > 0 && i === extras.length;
                    return (
                      <div key={ref}>
                        {showStudyHeader && (
                          <div
                            style={{
                              fontFamily:
                                "system-ui, -apple-system, sans-serif",
                              fontSize: "11px",
                              fontWeight: 700,
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                              color: C.muted,
                              margin: "4px 0 10px",
                            }}
                          >
                            Study verses
                          </div>
                        )}
                        <div style={{ marginBottom: "16px" }}>
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
                            tags={wordTags}
                            onTagTap={openTagRef}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ height: "24px" }} />
              </div>
              <div
                style={{
                  padding: "10px 14px calc(10px + env(safe-area-inset-bottom))",
                  borderTop: "1px solid " + C.border,
                  background: C.panel,
                }}
              >
                <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
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
                <div style={{ display: "flex", gap: "8px" }}>
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
                          minWidth: 0,
                          padding: 0,
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
                        {toolGlyph(s.tool)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

      {compileOpen &&
        (() => {
          const byOrder = (a: string, b: string) =>
            (chapterLoc.get(a)?.order ?? 0) - (chapterLoc.get(b)?.order ?? 0);
          const cs = compileStudy;
          const cr = compileRec;
          let cMarks: Mark[];
          let cTags: WordTag[];
          let cScopes: string[];
          let cScope: string;
          let cTitle: string;
          let cLabels: Record<number, string>;
          if (cs) {
            cScopes = Array.from(new Set(cs.refs.map((r) => scopeOf(r)))).sort(
              byOrder
            );
            cMarks = marks.filter((m) => cs.refs.includes(m.reference));
            cTags = wordTags.filter((t) => cs.refs.includes(t.reference));
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
            const crExtra = cr.extraRefs || [];
            cMarks = marks.filter(
              (m) =>
                cScopes.includes(scopeOf(m.reference)) ||
                crExtra.includes(m.reference)
            );
            cTags = wordTags.filter(
              (t) =>
                cScopes.includes(scopeOf(t.reference)) ||
                crExtra.includes(t.reference)
            );
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
            cTags = wordTags.filter((t) =>
              studyScopes.includes(scopeOf(t.reference))
            );
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
              key={cr ? "rec:" + cr.id : cs ? "ss:" + cs.id : "ch:" + title}
              initialFormat={
                (cr?.view ?? cs?.view) === "distilled"
                  ? "distilled"
                  : (cr?.view ?? cs?.view) === "covenants"
                  ? "covenants"
                  : "outline"
              }
              savedStudy={!!(cr || cs)}
              relSavedRoles={scopedRoles[cScope]}
              onRelRoles={(r) => setScopedRoles(cScope, r)}
              savedPins={scopedPins[cScope]}
              onPins={(p) => setScopedPins(cScope, p)}
              relSavedThreads={scopedThreads[cScope]}
              onRelThreads={(t) => setScopedThreads(cScope, t)}
              relSavedLens={scopedLens[cScope]}
              onRelLens={(l) => setScopedLens(cScope, l)}
              marks={cMarks}
              tags={cTags}
              studyScopes={cScopes}
              colorLabels={cLabels}
              C={C}
              orderOf={orderOf}
              sessionNew={sessionNew}
              onJump={jumpToRef}
              notes={notes}
              setNote={setNote}
              defaultName={cTitle}
              onSave={(nm, view) => {
                // During the walkthrough, "Save" just closes the demo compile —
                // nothing is persisted (the throwaway study is discarded on exit,
                // and the walkthrough's own cleanup runs off compileOpen).
                if (mtourOpen) {
                  setCompileOpen(false);
                  return;
                }
                const name = nm.trim();
                if (cs) {
                  setSearchStudies((prev) =>
                    prev.map((s) =>
                      s.id === cs.id
                        ? {
                            ...s,
                            name: name || s.name,
                            view,
                            updatedAt: Date.now(),
                          }
                        : s
                    )
                  );
                } else if (cr) {
                  recordStudy(cr.type, cr.scopeRef, name || cr.name, true, view);
                } else if (chapterGroups[title]) {
                  recordStudy(
                    "linked",
                    chapterGroups[title],
                    name || groupMembers(title).map(displayOf).join("  +  "),
                    true,
                    view,
                    groupMembers(title)
                  );
                } else {
                  recordStudy(
                    "chapter",
                    title,
                    name || displayTitle,
                    true,
                    view
                  );
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
              onAddChapter={
                cr
                  ? () => {
                      setPickV(-1);
                      setPickB(-1);
                      setPickC(-1);
                      setAddSheetMode("choice");
                      setAddChapterStudy(cr);
                    }
                  : undefined
              }
            />
          );
        })()}

      {/* See how it works — read-only example (marked John 1 + live compile) */}
      {exampleOpen && (
        <ExampleStudy
          C={C}
          dark={dark}
          onClose={() => setExampleOpen(false)}
          onTryIt={() => {
            setExampleOpen(false);
            setLoc({ v: 1, b: 3, c: 0 });
            setHomeOpen(false);
          }}
        />
      )}


      {/* Manage a mark (long-press) */}
      {defn &&
        sheet(
          () => setDefn(null),
          <DefinitionView
            word={defn.word}
            result={defn.result}
            colors={C}
            tagged={hasTag(defn.ref, defn.start, defn.end)}
            onToggleTag={
              defn.result
                ? () => {
                    if (hasTag(defn.ref, defn.start, defn.end)) {
                      removeTag(defn.ref, defn.start, defn.end);
                    } else if (defn.result) {
                      addTag({
                        reference: defn.ref,
                        start: defn.start,
                        end: defn.end,
                        word: defn.word,
                        dictKey: defn.result.key,
                      });
                    }
                  }
                : undefined
            }
          />
        )}

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
            studies.filter((s) => s.bookId === bid && !isStudyDeleted(s));
          const searchesInBook = (bid: string) =>
            searchStudies.filter(
              (ss) => ss.bookId === bid && !isSearchDeleted(ss)
            );
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
            color: string,
            rows: React.ReactNode
          ) => (
            <div style={{ marginBottom: "20px" }}>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  color: color,
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
                    // Same combined rule as the main hub: a chapter/group with a
                    // linked search shows once under Combined, never also as a
                    // chapter/linked row.
                    const combinedScopesV = new Set(
                      searches
                        .filter((s) => s.linkedScope)
                        .map((s) => resolveScope(s.linkedScope as string))
                    );
                    const chapV = chap.filter(
                      (s) => !combinedScopesV.has(resolveScope(s.scopeRef))
                    );
                    const linkedV = linked.filter(
                      (s) => !combinedScopesV.has("group:" + s.scopeRef)
                    );
                    const standaloneSearchesV = searches.filter(
                      (s) => !s.linkedScope
                    );
                    const combinedMapV = new Map<string, SearchStudy[]>();
                    searches
                      .filter((s) => s.linkedScope)
                      .forEach((s) => {
                        const sc = resolveScope(s.linkedScope as string);
                        const arr = combinedMapV.get(sc) || [];
                        arr.push(s);
                        combinedMapV.set(sc, arr);
                      });
                    const combinedGroupsV = Array.from(combinedMapV.entries());
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
                        {(chapV.length > 0 || linkedV.length > 0) &&
                          section("Chapter studies", TYPE_RED, [
                            ...chapV.map((s) =>
                              studyRow(
                                s.id,
                                s.name,
                                countChapter(s) +
                                  " mark" +
                                  (countChapter(s) === 1 ? "" : "s"),
                                TYPE_RED,
                                () =>
                                  openFromVault(() => openRecordedStudy(s))
                              )
                            ),
                            ...linkedV.map((s) =>
                              studyRow(
                                s.id,
                                s.name,
                                countLinked(s) +
                                  " mark" +
                                  (countLinked(s) === 1 ? "" : "s"),
                                TYPE_RED,
                                () =>
                                  openFromVault(() => openRecordedStudy(s)),
                                <IconLink color={TYPE_RED} />
                              )
                            ),
                          ])}
                        {combinedGroupsV.length > 0 &&
                          section(
                            "Combined studies",
                            TYPE_PURPLE,
                            combinedGroupsV.map(([sc, group]) => {
                              const primary = group[0];
                              const rec = [...chap, ...linked].find(
                                (s) =>
                                  (s.type === "chapter" &&
                                    resolveScope(s.scopeRef) === sc) ||
                                  (s.type === "linked" &&
                                    "group:" + s.scopeRef === sc)
                              );
                              const terms = group
                                .map((g) => '"' + g.name + '"')
                                .join(", ");
                              const allRefs = new Set(
                                group.flatMap((g) => g.refs)
                              );
                              const title =
                                (rec && rec.name) ||
                                displayOf(primary.linkedScope as string) ||
                                primary.name;
                              return studyRow(
                                "combined:" + sc,
                                title,
                                terms +
                                  " · " +
                                  allRefs.size +
                                  " verse" +
                                  (allRefs.size === 1 ? "" : "s"),
                                TYPE_PURPLE,
                                () => openFromVault(() => openStudy(primary)),
                                <IconLink color={TYPE_PURPLE} />
                              );
                            })
                          )}
                        {standaloneSearchesV.length > 0 &&
                          section(
                            "Keyword studies",
                            TYPE_BLUE,
                            standaloneSearchesV.map((ss) =>
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
                                TYPE_BLUE,
                                () => openFromVault(() => openStudy(ss)),
                                <IconLink color={TYPE_BLUE} />
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
      {undoFlash && canUndo && !compileOpen && !mtourOpen && (
        <button
          onClick={() => {
            undo();
            setUndoFlash(false);
          }}
          style={{
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            bottom: "calc(96px + env(safe-area-inset-bottom))",
            zIndex: 260,
            display: "inline-flex",
            alignItems: "center",
            gap: "7px",
            minHeight: "44px",
            padding: "10px 18px",
            borderRadius: "999px",
            border: "1px solid " + C.border,
            background: C.panel,
            color: C.text,
            fontSize: "14px",
            fontWeight: 700,
            boxShadow: "0 10px 28px rgba(0,0,0,0.25)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          ↺ Undo
        </button>
      )}

      {slidesOpen && (
        <FeatureSlides C={C} onClose={() => setSlidesOpen(false)} />
      )}

      {mtourOpen && (
        <MobileWalkthrough
          C={C}
          onClose={() => setMtourOpen(false)}
          createSession={createSession}
          deleteBook={deleteBook}
          setActiveBook={setActiveBook}
          addMark={addMark}
          setScopedLabel={setScopedLabel}
          resolveScope={resolveScope}
          scopedLabels={getBook(activeBookId).scopedLabels || {}}
          linkOpen={linkOpen}
          searchOpen={searchOpen}
          chapterGroups={chapterGroups}
          searchStudyIds={searchStudies.map((x) => x.id)}
          tabIds={tabs.map((x) => x.id)}
          demoCombined={chapterIsCombined("1 Nephi 1")}
          unlinkChapter={unlink}
          deleteSearchStudy={(id) =>
            setSearchStudies((prev) => prev.filter((x) => x.id !== id))
          }
          closeTab={closeTab}
          marks={marks}
          activeBookId={activeBookId}
          loc={loc}
          setLoc={setLoc}
          setHomeOpen={setHomeOpen}
          setCompileOpen={setCompileOpen}
          compileOpen={compileOpen}
          pen={pen}
          setPen={setPen}
          notes={notes}
          setNote={setNote}
        />
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

      {/* Center-screen moment when a study turns combined */}
      {linkFlash && <MergeMoment key={mergeFlash} />}

      {/* Center-screen moment when two chapters are linked */}
      {chapterLinkOn && <ChapterLinkMoment key={chapterLinkFlash} />}

      {/* Lighter pulse when a study you already have gains verses */}
      {growOn && <GrowPulse key={growFlash} fixed />}

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
  const accent = ACCENT;

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
