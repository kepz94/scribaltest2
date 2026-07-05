import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import "./desktop.css";
import { useMarks } from "./hooks/useMarks";
import { useVault } from "./hooks/useVault";
import { useWordTags } from "./hooks/useWordTags";
import VerseViewer from "./components/VerseViewer";
import DefinitionView from "./components/DefinitionView";
import { lookup as websterLookup, loadWebster, definitionForKey, WebsterResult } from "./webster";
import * as drive from "./googleDrive";
import ScribalMark from "./components/ScribalMark";
import ScribalWordmark from "./components/ScribalWordmark";
import StudyTablesDesktop from "./components/StudyTablesDesktop";
import { useStudyTables, newCardId, TableCard } from "./hooks/useStudyTables";
import SplashScreen from "./components/SplashScreen";
import Outline from "./components/Outline";
import Charting from "./components/Charting";
import Distilled from "./components/Distilled";
import Covenants from "./components/Covenants";
import WordStudies from "./components/WordStudies";
import { NEUTRAL, ACCENT } from "./theme";
import PrintView from "./components/PrintView";
import ShareVerses from "./components/ShareVerses";
import StudiesList, { StudyRow } from "./components/StudiesList";
import BooksVault, { VaultBook } from "./components/BooksVault";
import {
  useSearchStudies,
  SearchStudy,
  isSearchStudyDeleted,
} from "./hooks/useSearchStudies";
import {
  extractPdfText,
  parseScriptureNotes,
  verseTextOf,
  ParsedImport,
} from "./scriptureNotesImport";
import { useStudies, Study, isStudyDeleted } from "./hooks/useStudies";
import FeatureSlides from "./FeatureSlides";
import SemanticView from "./components/SemanticView";
import DesktopWalkthrough from "./DesktopWalkthrough";

import Shortcuts from "./components/Shortcuts";
import CompileBook, { CompileFlyer } from "./components/CompileBook";
import DesktopExample from "./components/DesktopExample";
import SearchPanel from "./components/SearchPanel";
import { getScriptures, volumesProxy, registerOnLoaded } from "./data/scripturesStore";
import {
  Mark,
  MarkColor,
  MarkStyle,
  Tool,
  Tab,
  WordTag,
  COLOR_MAP,
  COLORS,
  STYLE_LABELS,
  KEY_TO_TOOL,
} from "./types";
import {
  CORE_KEYS,
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

// Everything this (desktop) shell backs up: the shared study data (CORE_KEYS)
// plus the desktop-only layout / concept-map / walkthrough keys.
const BACKUP_KEYS = [
  ...CORE_KEYS,
  "scribal_toolbar_pos",
  "scribal_toolbar_orient",
  "scribal_map_pos",
  "scribal_map_links",
  "scribal_map_layout",
  "scribal_map_colorfilter",
  "scribal_map_stylefilter",
  "scribal_tutorial_seen",
  "scribal_guide_compile",
  "scribal_guide_search",
  "scribal_guide_vault",
  "scribal_guide_tabs",
  "scribal_guide_books",
  "scribal_last_compile_count",
]

// --- Mark color intensity: make marks "pop" more or softer ---
// Higher intensity boosts saturation and eases lightness toward the vivid
// midpoint (deepening the color so it stands out); lower intensity mutes it.
// Operating in HSL (not raw RGB) is what keeps high settings from washing out
// toward white. Works in both light and dark themes, pens and highlights.
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
    s = clamp01(s0 * (1 + t * 0.9));
    const k = Math.min(1, t * 1.1);
    l = l0 + (0.5 - l0) * k;
  } else {
    s = clamp01(s0 * (1 + t * 0.6));
    const extreme = l0 >= 0.5 ? 1 : 0;
    const k = Math.min(1, -t * 0.8);
    l = l0 + (extreme - l0) * k;
  }
  if (isHighlight) l = Math.max(0.35, Math.min(0.95, l));
  return hslToHex(h, clamp01(s), clamp01(l));
};

const applyIntensityToTheme = (
  themeObj: Record<string, string>,
  intensity: number
): Record<string, string> => {
  const scaled = { ...themeObj };
  COLORS.forEach((i) => {
    const penKey = `--pen${i}`;
    if (scaled[penKey]) scaled[penKey] = adjustColor(scaled[penKey], intensity, false);
    const hlKey = `--hl${i}`;
    if (scaled[hlKey]) scaled[hlKey] = adjustColor(scaled[hlKey], intensity, true);
  });
  return scaled;
};

const LIGHT_THEME = {
  "--bg": NEUTRAL.light.bg,
  "--panel": NEUTRAL.light.panel,
  "--soft": NEUTRAL.light.soft,
  "--text": NEUTRAL.light.text,
  "--muted": NEUTRAL.light.muted,
  "--border": NEUTRAL.light.border,
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

const DARK_THEME = {
  "--bg": NEUTRAL.dark.bg,
  "--panel": NEUTRAL.dark.panel,
  "--soft": NEUTRAL.dark.soft,
  "--text": NEUTRAL.dark.text,
  "--muted": NEUTRAL.dark.muted,
  "--border": NEUTRAL.dark.border,
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

const makeTabId = (
  bookId: string,
  volume: number,
  book: number,
  chapter: number
) => "tab_" + bookId + "_" + volume + "_" + book + "_" + chapter;

// "Genesis 1:5" -> "Genesis 1". Matches the per-chapter label scope in useMarks.
const scopeOfRef = (ref: string) => {
  const i = ref.indexOf(":");
  return i < 0 ? ref : ref.slice(0, i);
};

const vols = volumesProxy;

// Reference -> scripture order, so hand-picked study verses sort canonically.
const refOrderIndex = new Map<string, number>();
// Filled after the runtime scripture load (module-scope access would crash
// the bundle before React mounts — the black-screen bug).
registerOnLoaded(() =>
  vols.forEach((v, vi) =>
    v.books.forEach((b, bi) =>
      b.chapters.forEach((c, ci) =>
        c.verses.forEach((ve, vei) =>
          refOrderIndex.set(
            ve.reference,
            ((vi * 1000 + bi) * 1000 + ci) * 1000 + vei
          )
        )
      )
    )
  )
);
const orderOfRef = (ref: string) => refOrderIndex.get(ref) ?? 1e12;

// Where each verse lives, so a study tab can open at its first verse's location.
const refLoc = new Map<
  string,
  { volume: number; book: number; chapter: number }
>();
registerOnLoaded(() =>
  vols.forEach((v, vi) =>
    v.books.forEach((b, bi) =>
      b.chapters.forEach((c, ci) =>
        c.verses.forEach((ve) =>
          refLoc.set(ve.reference, { volume: vi, book: bi, chapter: ci })
        )
      )
    )
  )
);

// Chapter scope ("Genesis 1") -> its location, so a recorded study can reopen
// the right chapter tab(s) even when they aren't currently open.
const chapterLoc = new Map<
  string,
  { volume: number; book: number; chapter: number }
>();
registerOnLoaded(() =>
  vols.forEach((v, vi) =>
    v.books.forEach((b, bi) =>
      b.chapters.forEach((c, ci) => {
        const ref = c.verses[0]?.reference;
        if (ref)
          chapterLoc.set(scopeOfRef(ref), { volume: vi, book: bi, chapter: ci });
      })
    )
  )
);

// The per-chapter label scope for a tab, e.g. "Genesis 1". Unique per chapter.
const chapterScopeOf = (t: { volume: number; book: number; chapter: number }) =>
  scopeOfRef(
    vols[t.volume]?.books[t.book]?.chapters[t.chapter]?.verses[0]?.reference ||
      ""
  );

// The scope label of the chapter that follows this one across the whole canon:
// the next chapter in the same book, else the first chapter of the next book,
// else the first chapter of the next volume. Null at the very end.
const nextChapterScopeOf = (t: {
  volume: number;
  book: number;
  chapter: number;
}): string | null => {
  const vol = vols[t.volume];
  const bk = vol?.books[t.book];
  if (!bk) return null;
  const ref =
    bk.chapters[t.chapter + 1]?.verses[0]?.reference ||
    vol.books[t.book + 1]?.chapters[0]?.verses[0]?.reference ||
    vols[t.volume + 1]?.books[0]?.chapters[0]?.verses[0]?.reference ||
    "";
  return ref ? scopeOfRef(ref) : null;
};

// A fresh id for a new link group.
const newGroupId = () =>
  "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

// Distinct border colors so different link groups are visually distinguishable.
const LINK_COLORS = [
  "#8b5cf6",
  "#0ea5e9",
  "#f59e0b",
  "#ec4899",
  "#10b981",
  "#ef4444",
  "#6366f1",
  "#14b8a6",
];

// Chapter-to-chapter group colors: the link palette minus purple (reserved for
// combined studies) and red (reserved for chapter studies), so a plain chapter
// group never wears a color that already means something else.
const GROUP_COLORS = LINK_COLORS.filter(
  (c) => c !== "#8b5cf6" && c !== "#ef4444"
);

const VIEW_NAMES: Record<string, string> = {
  outline: "Outline",
  charting: "Charting",
  distilled: "Distilled",
  covenants: "Relational",
};

type CompileView = "outline" | "charting" | "distilled" | "covenants" | "semantic";

type Mode = "read" | "compile" | "vault" | "table";

// Mobile-style line icons. Stroke is "currentColor" so the parent sets the
// color (we wrap these in a purple span in the header).
const ICON_ACCENT = ACCENT;
// Link-icon colors by study type — one glance tells you the kind:
//   red = chapter study · blue = keyword study · purple = combined (both).
const TYPE_RED = "#ef4444";
const TYPE_BLUE = "#3b82f6";
const TYPE_PURPLE = ACCENT;

// One chain-link glyph, absolutely centered on its parent's (50%,50%) point.
// Its transform/opacity are driven by a CSS class so the keyframes can slide
// and fuse it; the class name decides which link this is (left/right/result).
const MergeLink = ({
  color,
  cls,
  w = 30,
}: {
  color: string;
  cls: string;
  w?: number;
}) => (
  <svg
    className={cls}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={2.4}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ position: "absolute", top: "50%", left: 0, width: w, height: w }}
  >
    <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
    <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
  </svg>
);

// The desktop "merge moment". When two tabs are linked, this 0-width flex item
// is dropped into the reading row BETWEEN the two now-adjacent panels, so the
// animation plays in the seam itself — no DOM measurement needed. A link in
// each panel's color slides toward the seam and fuses into the result color;
// for a combined study (chapter + keyword) the result is purple with a label.
const MergeSeam = ({
  leftColor,
  rightColor,
  resultColor,
  combined,
}: {
  leftColor: string;
  rightColor: string;
  resultColor: string;
  combined: boolean;
}) => (
  <div
    style={{
      flex: "0 0 0px",
      width: 0,
      alignSelf: "stretch",
      position: "relative",
      overflow: "visible",
      pointerEvents: "none",
      zIndex: 30,
    }}
  >
    <style>{`
      @keyframes scribal-merge-dim {
        0% { opacity: 0; }
        18% { opacity: 1; }
        72% { opacity: 1; }
        100% { opacity: 0; }
      }
      @keyframes scribal-merge-left {
        0% { opacity: 0; transform: translate(-50%,-50%) translateX(-70px) scale(.85); }
        22% { opacity: 1; transform: translate(-50%,-50%) translateX(-30px) scale(1); }
        46% { opacity: 1; transform: translate(-50%,-50%) translateX(0) scale(1); }
        58% { opacity: 0; transform: translate(-50%,-50%) translateX(0) scale(.9); }
        100% { opacity: 0; }
      }
      @keyframes scribal-merge-right {
        0% { opacity: 0; transform: translate(-50%,-50%) translateX(70px) scale(.85); }
        22% { opacity: 1; transform: translate(-50%,-50%) translateX(30px) scale(1); }
        46% { opacity: 1; transform: translate(-50%,-50%) translateX(0) scale(1); }
        58% { opacity: 0; transform: translate(-50%,-50%) translateX(0) scale(.9); }
        100% { opacity: 0; }
      }
      @keyframes scribal-merge-pop {
        0%, 42% { opacity: 0; transform: translate(-50%,-50%) scale(.4); }
        54% { opacity: 1; transform: translate(-50%,-50%) scale(1.25); }
        66% { transform: translate(-50%,-50%) scale(.95); }
        74% { transform: translate(-50%,-50%) scale(1.05); }
        84% { opacity: 1; transform: translate(-50%,-50%) scale(1); }
        100% { opacity: 0; transform: translate(-50%,-50%) scale(1); }
      }
      @keyframes scribal-merge-glow {
        0%, 42% { opacity: 0; transform: translate(-50%,-50%) scale(.4); }
        56% { opacity: .5; transform: translate(-50%,-50%) scale(1.5); }
        100% { opacity: 0; transform: translate(-50%,-50%) scale(2.4); }
      }
      @keyframes scribal-merge-ripple {
        0%, 48% { opacity: 0; transform: translate(-50%,-50%) scale(.3); }
        56% { opacity: .7; }
        100% { opacity: 0; transform: translate(-50%,-50%) scale(1); }
      }
      @keyframes scribal-merge-label {
        0%, 52% { opacity: 0; transform: translate(-50%,0) translateY(64px); }
        66% { opacity: 1; transform: translate(-50%,0) translateY(56px); }
        86% { opacity: 1; transform: translate(-50%,0) translateY(56px); }
        100% { opacity: 0; transform: translate(-50%,0) translateY(56px); }
      }
      .scribal-merge-dim { animation: scribal-merge-dim 1.6s ease both; }
      .scribal-merge-ripple { animation: scribal-merge-ripple 1.6s ease both; }
      .scribal-merge-glow { animation: scribal-merge-glow 1.6s ease both; }
      .scribal-merge-left { animation: scribal-merge-left 1.6s cubic-bezier(.4,0,.2,1) both; }
      .scribal-merge-right { animation: scribal-merge-right 1.6s cubic-bezier(.4,0,.2,1) both; }
      .scribal-merge-pop { animation: scribal-merge-pop 1.6s cubic-bezier(.34,1.4,.5,1) both; }
      .scribal-merge-label { animation: scribal-merge-label 1.6s ease both; }

      /* Rich note editor + rendered notes */
      .scribal-rich-editor:empty:before {
        content: attr(data-placeholder);
        color: var(--muted);
        pointer-events: none;
      }
      .scribal-rich-editor h1, .scribal-rich-view h1 { font-size: 19px; font-weight: 800; margin: 0 0 4px; }
      /* Lexical theme classes */
      .rt-bold { font-weight: 800; }
      .rt-italic { font-style: italic; }
      .rt-underline { text-decoration: underline; }
      .rt-h1 { font-size: 19px; font-weight: 800; margin: 0 0 4px; }
      .rt-h2 { font-size: 15.5px; font-weight: 800; margin: 12px 0 5px; }
      .rt-quote { border-left: 3px solid var(--border); padding: 2px 0 2px 12px; margin: 0 0 10px; color: var(--muted); font-style: italic; }
      .rt-ol { margin: 0 0 10px 24px; list-style: decimal; }
      .rt-ul { margin: 0 0 10px 22px; list-style: disc; }
      .rt-li { margin-bottom: 4px; }
      /* nested list indent */
      .rt-ol .rt-ol, .rt-ul .rt-ul, .rt-ol .rt-ul, .rt-ul .rt-ol { margin-left: 20px; }
      /* checklist items (Lexical adds __lexicalListType / checked via aria) */
      .scribal-rich-editor li[role="checkbox"], .scribal-rich-view li[role="checkbox"] {
        list-style: none; position: relative; padding-left: 26px; cursor: pointer; outline: none;
      }
      .scribal-rich-editor li[role="checkbox"]:before, .scribal-rich-view li[role="checkbox"]:before {
        content: ""; position: absolute; left: 0; top: 2px; width: 16px; height: 16px;
        border-radius: 4px; border: 1.5px solid var(--muted);
      }
      .scribal-rich-editor li[role="checkbox"][aria-checked="true"], .scribal-rich-view li[role="checkbox"][aria-checked="true"] {
        color: var(--muted); text-decoration: line-through;
      }
      .scribal-rich-editor li[role="checkbox"][aria-checked="true"]:before, .scribal-rich-view li[role="checkbox"][aria-checked="true"]:before {
        content: "\\2713"; background: #4caf7d; border-color: #4caf7d; color: #0c1a10;
        font-size: 11px; font-weight: 900; display: flex; align-items: center; justify-content: center; text-decoration: none;
      }
      .scribal-rich-editor h2, .scribal-rich-view h2 { font-size: 15.5px; font-weight: 800; margin: 12px 0 5px; }
      .scribal-rich-editor p, .scribal-rich-view p { margin: 0 0 8px; }
      .scribal-rich-editor blockquote, .scribal-rich-view blockquote {
        border-left: 3px solid var(--border); padding: 2px 0 2px 12px; margin: 0 0 10px;
        color: var(--muted); font-style: italic;
      }
      .scribal-rich-editor ol, .scribal-rich-view ol { margin: 0 0 10px 24px; }
      .scribal-rich-editor ul, .scribal-rich-view ul { margin: 0 0 10px 22px; }
      .scribal-rich-editor ul[data-checklist], .scribal-rich-view ul[data-checklist] {
        list-style: none; margin-left: 2px; padding-left: 0;
      }
      .scribal-rich-editor ul[data-checklist] li, .scribal-rich-view ul[data-checklist] li {
        position: relative; padding-left: 26px; margin-bottom: 6px;
      }
      .scribal-rich-editor ul[data-checklist] li:before, .scribal-rich-view ul[data-checklist] li:before {
        content: ""; position: absolute; left: 0; top: 2px; width: 16px; height: 16px;
        border-radius: 4px; border: 1.5px solid var(--muted);
      }
      .scribal-rich-view ul[data-checklist] li { cursor: pointer; }
      .scribal-rich-editor ul[data-checklist] li[data-checked="1"], .scribal-rich-view ul[data-checklist] li[data-checked="1"] {
        color: var(--muted); text-decoration: line-through;
      }
      .scribal-rich-editor ul[data-checklist] li[data-checked="1"]:before, .scribal-rich-view ul[data-checklist] li[data-checked="1"]:before {
        content: "\\2713"; background: #4caf7d; border-color: #4caf7d; color: #0c1a10;
        font-size: 11px; font-weight: 900; display: flex; align-items: center; justify-content: center; text-decoration: none;
      }
      .scribal-rich-view .scribal-vchip { cursor: pointer; white-space: nowrap; }
      .scribal-rich-editor hr, .scribal-rich-view hr { border: none; border-top: 1px solid var(--border); margin: 12px 0; }
    `}</style>
    {/* soft localized dim, spilling into the two adjacent panels */}
    <div
      className="scribal-merge-dim"
      style={{
        position: "absolute",
        top: "50%",
        left: 0,
        width: 560,
        height: 560,
        transform: "translate(-50%,-50%)",
        background:
          "radial-gradient(circle, rgba(20,16,12,0.16), transparent 62%)",
      }}
    />
    <div
      className="scribal-merge-ripple"
      style={{
        position: "absolute",
        top: "50%",
        left: 0,
        width: 120,
        height: 120,
        borderRadius: "50%",
        border: "2.5px solid " + resultColor,
      }}
    />
    <div
      className="scribal-merge-glow"
      style={{
        position: "absolute",
        top: "50%",
        left: 0,
        width: 92,
        height: 92,
        borderRadius: "50%",
        background:
          "radial-gradient(circle, " + resultColor + "b3, transparent 65%)",
      }}
    />
    <MergeLink color={leftColor} cls="scribal-merge-left" />
    <MergeLink color={rightColor} cls="scribal-merge-right" />
    <MergeLink color={resultColor} cls="scribal-merge-pop" w={34} />
    {combined && (
      <div
        className="scribal-merge-label"
        style={{
          position: "absolute",
          top: "50%",
          left: 0,
          whiteSpace: "nowrap",
          fontFamily: "system-ui, sans-serif",
          fontSize: "12px",
          fontWeight: 800,
          color: resultColor,
          letterSpacing: "0.02em",
          textShadow: "0 1px 8px rgba(251,249,244,0.9)",
        }}
      >
        Combined study
      </div>
    )}
  </div>
);

// A single blue link icon for the "grow" pulse, centered on the panel
// (left:50% rather than the seam's left:0).
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

// The keyword "grow" pulse. When verses are added to an existing search, this
// plays centered in that search's OWN reading panel (no seam) - two blue links
// converge and fuse. In a multi-panel row it is pinned (absolute) inside the
// search panel's visible box so it stays put even if the panel is scrolled; in
// single-pane reading the panel grows with the page, so it pins to the viewport
// (fixed) instead.
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

const IconSearch = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);
const IconMoon = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
);
const IconSun = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
const IconBulb = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 18h6" />
    <path d="M10 22h4" />
    <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z" />
  </svg>
);
const IconKey = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 18v3a1 1 0 0 0 1 1h4v-3h3v-3h2l1.4-1.4a6 6 0 1 0-4-4Z" />
    <circle cx="16.5" cy="7.5" r="0.6" fill="currentColor" />
  </svg>
);
const IconBook = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
  </svg>
);
const IconDownload = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5" />
    <path d="M12 15V3" />
  </svg>
);
const IconUpload = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 9l5-5 5 5" />
    <path d="M12 4v12" />
  </svg>
);
const IconCloud = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z" />
  </svg>
);
const IconStudies = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3 3 8l9 5 9-5z" />
    <path d="M3 13l9 5 9-5" />
  </svg>
);
const IconDrop = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3s6 6.4 6 10a6 6 0 0 1-12 0c0-3.6 6-10 6-10z" />
  </svg>
);
const IconUndo = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 7 4 12l5 5" />
    <path d="M4 12h11a4 4 0 0 1 0 8h-2" />
  </svg>
);
const IconRedo = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m15 7 5 5-5 5" />
    <path d="M20 12H9a4 4 0 0 0 0 8h2" />
  </svg>
);
// A purple wrapper so the line icons match the mobile home page's accent.
const purpleIcon = (node: React.ReactNode) => (
  <span style={{ color: ICON_ACCENT, display: "inline-flex" }}>{node}</span>
);

interface PrintData {
  view: CompileView;
  title: string;
  compileTabs: Tab[];
  marks: Mark[];
  colorLabels: Record<number, string>;
  notes: Record<string, string>;
  tags: WordTag[];
}

export default function App() {
  const {
    marks,
    addMark,
    deleteMark,
    addMarks,
    addMarksToBook,
    deleteMarkInBook,
    setScopedLabelInBook,
    deleteMarkGroup,
    clearMarks,
    undo,
    redo,
    canUndo,
    canRedo,
    colorLabels,
    scopedLabels,
    setScopedLabel,
    seedScopeLabels,
    scopedRoles,
    setScopedRoles,
    scopedLens,
    setScopedLens,
    scopedPins,
    setScopedPins,
    scopedThreads,
    setScopedThreads,
    notes,
    setNote,
    books,
    allMarks,
    activeBookId,
    activeBookName,
    isMasterActive,
    setActiveBook,
    createSession,
    renameBook,
    deleteBook,
    getBook,
    absorb,
    moveStudyMarks,
    mergeRemoteBooks,
  } = useMarks();

  const {
    entries,
    mergeRemote: vaultMergeRemote,
  } = useVault();

  // Study tables live in the shell (single source of truth) so the reading
  // panels can drop verses onto a table's shelf and the Studies hub can list
  // them. StudyTablesDesktop receives these as props.
  const {
    tables: studyTables,
    createTable: createStudyTable,
    updateTable: updateStudyTable,
    renameTable: renameStudyTable,
    deleteTable: deleteStudyTable,
    mergeRemote: tablesMergeRemote,
  } = useStudyTables();
  const [openTableId, setOpenTableId] = useState<string | null>(null);
  // Study Table marking panel: a full-screen VerseViewer that loads a set of the
  // table's verses so they can be marked together (not one card at a time). Each
  // verse is marked in its own book, so refBook maps reference -> bookId.
  const [markPanel, setMarkPanel] = useState<{
    refs: string[];
    refBook: Record<string, string>;
    title: string;
  } | null>(null);
  const openTableMarkPanel = (
    refs: string[],
    refBook: Record<string, string>,
    title?: string
  ) => {
    if (!refs.length) return;
    setMarkPanel({ refs, refBook, title: title || "Mark verses" });
  };

  const {
    studies: searchStudies,
    addStudy,
    updateStudy,
    deleteStudy,
    renameStudy,
    setStudies: setSearchStudies,
    mergeRemote: mergeSearchRemote,
  } = useSearchStudies();
  const {
    studies: recordedStudies,
    recordStudy,
    deleteStudy: deleteRecordedStudy,
    setStudies: setRecordedStudies,
    mergeRemote: mergeRecordedRemote,
  } = useStudies();

  const { wordTags, hasTag, addTag, removeTag, mergeRemote: wordTagsMergeRemote } =
    useWordTags();

  // Live-merge from a pulled cloud backup: the study lists (recorded + keyword)
  // and the chapter-link groups. All additive — syncing only ADDS studies/links
  // made on another device; it never deletes or overwrites local ones.
  const mergeRemoteStudies = (data: Record<string, string | null>) => {
    wordTagsMergeRemote(
      data["scribal_wordtags"],
      data["scribal_wordtags_tomb"]
    );
    mergeRecordedRemote(data["scribal_studies_v1"]);
    mergeSearchRemote(data["scribal_search_studies"]);
    // Study tables: field-level last-write-wins merge with tombstones (the hook
    // owns the rules), so a table edited on one device and renamed on another
    // converges instead of one side clobbering the other.
    tablesMergeRemote(data["scribal_tables_v1"]);
    // Chapter-link groups + their per-scope timestamps. Converges links AND
    // unlinks; reads current state via refs so this long-lived merge (held by the
    // Firebase listener) never works off stale mount-time values.
    try {
      const merged = mergeLinkGroups(
        chapterGroupsRef.current,
        chapterGroupsAtRef.current,
        data["scribal_linked_chapters"],
        data["scribal_linked_chapters_at"]
      );
      setChapterGroups(merged.groups);
      setChapterGroupsAt(merged.at);
    } catch {
      /* ignore malformed link data */
    }
    // Mark colour intensity — a shared display setting, so adopt the incoming
    // value and marks look the same on every device.
    const ci = data["scribal_color_intensity"];
    if (ci != null) {
      const v = parseFloat(ci);
      if (!Number.isNaN(v)) setColorIntensity((cur) => (cur === v ? cur : v));
    }
  };

  // Restore a manual backup file into localStorage. (Drive sync uses the shared
  // pushToDrive / pullIfNewer paths directly.) Implementation lives in ./sync.
  const applyBackupString = (text: string) => syncApplyBackupString(text);

  // The single safe path for writing to Drive (rules: staleness + emptiness).
  // Lives in ./sync so desktop and mobile share one implementation.
  const pushToDrive = () =>
    syncPushToDrive(
      BACKUP_KEYS,
      mergeRemoteBooks,
      vaultMergeRemote,
      mergeRemoteStudies
    );

  const [mode, setMode] = useState<Mode>("read");
  // The built-in, read-only "See how it works" example (marked John 1 + a live
  // compile using the real desktop views). Opens over everything; writes nothing.
  const [exampleOpen, setExampleOpen] = useState(false);
  const [compileView, setCompileView] = useState<CompileView>(() => {
    const saved = localStorage.getItem("scribal_compile_view");
    return saved === "outline" ||
      saved === "charting" ||
      saved === "distilled" ||
      saved === "covenants" ||
      saved === "semantic"
      ? saved
      : "outline";
  });
  // Quick-find on the compiled board: the live query, the Outline collapse
  // state lifted here (so a result can open a collapsed theme before scrolling),
  // and a ref to the board container so a result can scroll its card into view.
  const [compileFindQ, setCompileFindQ] = useState("");
  const [compileCollapsed, setCompileCollapsed] = useState<number[]>([]);
  const scribalSwapRef = useRef<HTMLDivElement>(null);

  const [tabs, setTabs] = useState<Tab[]>(() => {
    const saved = localStorage.getItem("scribal_tabs_v2");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length) {
          // migrate older tabs that have no bookId
          return parsed.map((t: any) => {
            const bookId = t.bookId || "master";
            return {
              id: t.bookId
                ? t.id
                : makeTabId(bookId, t.volume, t.book, t.chapter),
              volume: t.volume,
              book: t.book,
              chapter: t.chapter,
              bookId,
              studyId: t.studyId,
            };
          });
        }
      } catch {}
    }
    return [
      {
        id: makeTabId("master", 0, 0, 0),
        volume: 0,
        book: 0,
        chapter: 0,
        bookId: "master",
      },
    ];
  });
  const [activeTabId, setActiveTabId] = useState<string>(
    () =>
      localStorage.getItem("scribal_active_tab_v2") ||
      makeTabId("master", 0, 0, 0)
  );

  // Drag-to-reorder reading panels via their tab pills. dragTabRef holds the
  // pill being dragged; draggingTab drives the source pill's lifted look;
  // dragOverTab is the pill we last reordered past (throttles live reordering
  // so each crossing moves the tab exactly once).
  const dragTabRef = useRef<string | null>(null);
  const [dragOverTab, setDragOverTab] = useState<string | null>(null);
  const [draggingTab, setDraggingTab] = useState<string | null>(null);
  const reorderTabs = (fromId: string | null, toId: string) => {
    if (!fromId || fromId === toId) return;
    setTabs((prev) => {
      const fromIdx = prev.findIndex((t) => t.id === fromId);
      const toIdx = prev.findIndex((t) => t.id === toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = prev.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  // The sticky tab-pill row must pin directly beneath the sticky header. The
  // header height is not fixed (it reflows/wraps at narrow widths), so measure
  // it and pin the pill row at exactly that offset — otherwise the header
  // overlaps the pills as you scroll.
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [headerH, setHeaderH] = useState(76);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderH(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The theme-labels legend and the reading panels sit below BOTH the header
  // and the tab-pill row. That row's height varies too (it wraps at narrow
  // widths, and each pill carries a small book label above it), so measure it
  // the same way as the header. Without this, the legend pinned at a guessed
  // offset and the panels were sized against a guessed chrome height; when the
  // guesses ran short of the real height, the page grew past the viewport, the
  // whole window scrolled, and the "fixed" legend slid up behind the tabs. It
  // only renders while reading, so re-measure whenever the reading view mounts.
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const [tabsH, setTabsH] = useState(66);
  useEffect(() => {
    if (mode !== "read") return;
    const el = tabsRef.current;
    if (!el) return;
    const measure = () => setTabsH(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  // Link groups: maps a chapter scope ("Genesis 1") to a group id. Chapters in
  // the same group are one study — they compile together and share one set of
  // theme names. Different groups are fully independent (no theme bleed).
  const [chapterGroups, setChapterGroups] = useState<Record<string, string>>(
    () => {
      try {
        const raw = JSON.parse(
          localStorage.getItem("scribal_linked_chapters") || "{}"
        );
        // ignore the old flat-list format from a previous version
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

  // Per-scope timestamp of the last link/unlink action. Carried alongside
  // chapterGroups so that unlinking (not just linking) converges across devices.
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

  // Live mirrors so the (long-lived) sync merge can read the CURRENT groups +
  // timestamps without a stale closure capturing mount-time values.
  const chapterGroupsRef = useRef(chapterGroups);
  const chapterGroupsAtRef = useRef(chapterGroupsAt);
  useEffect(() => {
    chapterGroupsRef.current = chapterGroups;
    chapterGroupsAtRef.current = chapterGroupsAt;
  }, [chapterGroups, chapterGroupsAt]);

  // Stamp "changed now" for every scope whose group membership differs between
  // prev and next — this is what makes a link OR an unlink propagate.
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

  // A chapter's label scope: its group's shared scope if linked, else its own.
  const resolveScope = (chapterScope: string) =>
    chapterGroups[chapterScope] ? "group:" + chapterGroups[chapterScope] : chapterScope;

  // Stable distinct color for each link group (so borders differ per group).
  const groupColor = (gid: string) => {
    const ids = Array.from(new Set(Object.values(chapterGroups))).sort();
    const i = ids.indexOf(gid);
    return GROUP_COLORS[(i < 0 ? 0 : i) % GROUP_COLORS.length];
  };

  const [compileSelection, setCompileSelection] = useState<string[]>([]);
  const [compileStudyId, setCompileStudyId] = useState<string | null>(null);
  // When set, the compile renders these synthetic chapter tabs instead of the
  // open reading tabs — lets a linked study compile its whole group without
  // popping every chapter open as a tab. Cleared on any normal compile.
  const [compileVirtualTabs, setCompileVirtualTabs] = useState<Tab[] | null>(
    null
  );
  const [compileName, setCompileName] = useState("");
  const [savedToStudies, setSavedToStudies] = useState(false);
  const [compileSettingsOpen, setCompileSettingsOpen] = useState(false);
  const [saveStudyPrompt, setSaveStudyPrompt] = useState<{
    info: {
      type: "chapter" | "linked";
      bookId: string;
      scopeRef: string;
      refs: string[];
      memberScopes?: string[];
      defaultName: string;
    };
    existing: Study;
  } | null>(null);
  const [selectedTool, setSelectedTool] = useState<Tool>("highlight");
  // Assignable toolbar hotkeys. Defaults mirror the classic layout
  // (Q W E / A S D F / Z X C V, from KEY_TO_TOOL); the Shortcuts sheet edits
  // them, localStorage keeps them, the toolbar displays them.
  const DEFAULT_TOOL_HOTKEYS = (() => {
    const out = {} as Record<Tool, string>;
    (Object.keys(KEY_TO_TOOL) as string[]).forEach((k) => {
      out[KEY_TO_TOOL[k]] = k;
    });
    return out;
  })();
  const [toolHotkeys, setToolHotkeys] = useState<Record<Tool, string>>(() => {
    try {
      const raw = localStorage.getItem("scribal_tool_hotkeys_v1");
      if (raw)
        return { ...DEFAULT_TOOL_HOTKEYS, ...(JSON.parse(raw) || {}) };
    } catch {
      /* ignore */
    }
    return { ...DEFAULT_TOOL_HOTKEYS };
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        "scribal_tool_hotkeys_v1",
        JSON.stringify(toolHotkeys)
      );
    } catch {
      /* ignore */
    }
  }, [toolHotkeys]);
  const toolHotkeysRef = useRef(toolHotkeys);
  toolHotkeysRef.current = toolHotkeys;
  const [selectedColor, setSelectedColor] = useState<MarkColor>(1);
  // Define: the looked-up word's verse + exact range + result (range lets a tag
  // anchor to that occurrence, same as mobile).
  const [defn, setDefn] = useState<{
    ref: string;
    word: string;
    start: number;
    end: number;
    result: WebsterResult | null;
  } | null>(null);
  const handleDefine = (
    reference: string,
    _verseText: string,
    start: number,
    end: number,
    word: string
  ) => {
    websterLookup(word).then((result) =>
      setDefn({ ref: reference, word, start, end, result })
    );
  };
  // Clicking a word's footnote marker reopens the same modal as a quick
  // reference, the definition pulled fresh from the dictionary by its key.
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
  // Warm the dictionary when Define mode is armed so the first lookup is instant.
  useEffect(() => {
    if (selectedTool === "define") loadWebster();
  }, [selectedTool]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [jumpTarget, setJumpTarget] = useState<string | null>(null);

  // The study-table READER DOCK: a docked reading panel beside the open table.
  // Browse any chapter with the real reader + marking toolbar, marks land in
  // the table's marks home, dictionary tags work, and "Send verses" drops the
  // chosen verses onto the table's shelf (Selected).
  const [tableReader, setTableReader] = useState<{
    tableId: string;
    bookId: string;
  } | null>(null);
  const [trLoc, setTrLoc] = useState<{ v: number; b: number; c: number }>({
    v: 0,
    b: 0,
    c: 0,
  });
  const [trJump, setTrJump] = useState<string | null>(null);
  const openTableReader = (tableId: string, bookId: string, atRef?: string) => {
    if (atRef) {
      const cut = atRef.lastIndexOf(":");
      const scope = cut > 0 ? atRef.slice(0, cut) : atRef;
      const loc = chapterLoc.get(scope);
      if (loc) setTrLoc({ v: loc.volume, b: loc.book, c: loc.chapter });
      setTrJump(atRef);
    }
    setTableReader({ tableId, bookId });
  };
  const sendReaderVersesToTable = (refs: string[]) => {
    if (!tableReader || refs.length === 0) return;
    const t = studyTables.find((x) => x.id === tableReader.tableId);
    if (!t) return;
    const cards: TableCard[] = refs.map((r) => ({
      id: newCardId(),
      kind: "scripture" as const,
      refs: [r],
      bookId: tableReader.bookId,
      shelfGroup: "Sent from reading",
    }));
    updateStudyTable(t.id, { shelf: [...(t.shelf || []), ...cards] });
  };

  const [showTutorial, setShowTutorial] = useState<boolean>(
    () => !localStorage.getItem("scribal_tutorial_seen")
  );
  const [showSearch, setShowSearch] = useState(false);
  // When set, the search panel is in "add verses to this keyword study" mode:
  // the study's verses are pre-selected and the link bar offers update-vs-copy.
  const [addToStudyId, setAddToStudyId] = useState<string | null>(null);
  // When set, the search panel is adding loose verses to this recorded
  // chapter/linked study (writing its extraRefs).
  const [addVersesRecId, setAddVersesRecId] = useState<string | null>(null);
  // After adding verses to a recorded study, a banner offers to compile it once
  // the added verses are marked.
  const [markVersesStudyId, setMarkVersesStudyId] = useState<string | null>(
    null
  );
  const [slidesOpen, setSlidesOpen] = useState(false);
  const [walkOpen, setWalkOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const [compileAnim, setCompileAnim] = useState<{
    show: boolean;
    duration: number;
    flyers: CompileFlyer[];
    colors: number[];
  }>({ show: false, duration: 1000, flyers: [], colors: [] });

  // When more than one separate thing is open, compile asks what to combine
  // instead of silently merging everything.
  const [compilePrompt, setCompilePrompt] = useState<
    { label: string; tabIds: string[] }[] | null
  >(null);

  // "Which open tabs do you want to link this one with?" prompt.
  const [linkPromptTabId, setLinkPromptTabId] = useState<string | null>(null);
  // The desktop merge moment: which source tab the seam animation plays after,
  // the two converging colors, and the fused result. `key` remounts the seam so
  // the animation replays on every link. Cleared by a short timer below.
  const [mergeMoment, setMergeMoment] = useState<{
    sourceTabId: string;
    leftColor: string;
    rightColor: string;
    resultColor: string;
    combined: boolean;
    key: number;
  } | null>(null);
  const mergeKeyRef = useRef(0);
  // The keyword "grow" pulse: set to the study id whose verse list just grew, so
  // the pulse plays centered in that search's own panel. Separate from the seam
  // (a grow is not a link), so the two never interfere.
  const [growMoment, setGrowMoment] = useState<{
    studyId: string;
    key: number;
  } | null>(null);
  const growKeyRef = useRef(0);
  // Central link-watcher: a render-to-render diff of the link data, so the seam
  // fires on ANY new link no matter which action made it. `ready` gates out the
  // brief startup window (and any data hydration / first sync) so loading saved
  // data never plays the animation - only links made afterward do.
  const linkWatchReady = useRef(false);
  const prevKwLinks = useRef<Record<string, string>>({});
  const prevChapGroups = useRef<Record<string, string>>({});
  // Per-study verse counts from the previous render, so the watcher can spot a
  // study that GREW (verses added) versus one that is merely new or shrank.
  const prevStudyRefs = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!mergeMoment) return;
    const id = window.setTimeout(() => setMergeMoment(null), 1700);
    return () => window.clearTimeout(id);
  }, [mergeMoment]);
  useEffect(() => {
    if (!growMoment) return;
    const id = window.setTimeout(() => setGrowMoment(null), 1750);
    return () => window.clearTimeout(id);
  }, [growMoment]);
  useEffect(() => {
    const id = window.setTimeout(() => {
      linkWatchReady.current = true;
    }, 1200);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    // Current links: keyword studies that point at a chapter (combined), and the
    // chapter-to-chapter grouping. Compared against the previous render to spot a
    // newly-created link.
    const curKw: Record<string, string> = {};
    searchStudies.forEach((s) => {
      if (!isSearchStudyDeleted(s) && s.linkedScope)
        curKw[s.id] = s.linkedScope;
    });
    const curGroups = chapterGroups;
    // Verse counts per live study, to detect a study that just gained verses.
    const curStudyRefs: Record<string, number> = {};
    searchStudies.forEach((s) => {
      if (!isSearchStudyDeleted(s)) curStudyRefs[s.id] = s.refs.length;
    });

    if (!linkWatchReady.current) {
      prevKwLinks.current = curKw;
      prevChapGroups.current = curGroups;
      prevStudyRefs.current = curStudyRefs;
      return;
    }

    const sessionBookId =
      (tabs.find((t) => t.id === activeTabId) || tabs[0])?.bookId || "";
    // A tab for a chapter scope: reuse the open chapter tab if one shows it, else
    // build one in the current session book.
    const tabForScope = (scope: string): Tab | null => {
      const open = tabs.find((t) => !t.studyId && chapterScopeOf(t) === scope);
      if (open) return open;
      const loc = chapterLoc.get(scope);
      if (!loc) return null;
      return {
        id: makeTabId(sessionBookId, loc.volume, loc.book, loc.chapter),
        volume: loc.volume,
        book: loc.book,
        chapter: loc.chapter,
        bookId: sessionBookId,
      };
    };
    // Make the two linked tabs adjacent (right after left), focus them, and play
    // the seam between their panels.
    const fireSeam = (
      left: Tab,
      right: Tab,
      leftColor: string,
      rightColor: string,
      resultColor: string,
      combined: boolean
    ) => {
      if (left.id === right.id) return;
      setTabs((prev) => {
        let arr = prev;
        if (!arr.some((t) => t.id === left.id)) arr = [...arr, left];
        const without = arr.filter((t) => t.id !== right.id);
        const si = without.findIndex((t) => t.id === left.id);
        const copy = [...without];
        copy.splice(si < 0 ? copy.length : si + 1, 0, right);
        return copy;
      });
      setActiveTabId(left.id);
      setMode("read");
      mergeKeyRef.current += 1;
      setMergeMoment({
        sourceTabId: left.id,
        leftColor,
        rightColor,
        resultColor,
        combined,
        key: mergeKeyRef.current,
      });
    };

    let fired = false;
    // 1) A keyword newly gained (or changed) a linkedScope -> combined link
    //    (blue keyword + red chapter -> purple). Covers the keyword modal, the
    //    chapter prompt, gathered searches, and any re-link after an unlink.
    for (const sid of Object.keys(curKw)) {
      const scope = curKw[sid];
      if (prevKwLinks.current[sid] === scope) continue;
      const study = searchStudies.find((s) => s.id === sid);
      const loc = chapterLoc.get(scope);
      if (study && loc) {
        const r = study.refs.length ? refLoc.get(study.refs[0]) : undefined;
        const kwTab: Tab = {
          id: "studytab_" + study.id,
          volume: r ? r.volume : 0,
          book: r ? r.book : 0,
          chapter: r ? r.chapter : 0,
          bookId: study.bookId,
          studyId: study.id,
        };
        const chTab: Tab = {
          id: makeTabId(study.bookId, loc.volume, loc.book, loc.chapter),
          volume: loc.volume,
          book: loc.book,
          chapter: loc.chapter,
          bookId: study.bookId,
        };
        fireSeam(kwTab, chTab, TYPE_BLUE, TYPE_RED, TYPE_PURPLE, true);
        fired = true;
      }
      break;
    }
    // 2) Else a chapter newly joined (or changed) a group -> chapter link
    //    (red -> red). Covers the chapter prompt's chapter checkboxes.
    if (!fired) {
      for (const scope of Object.keys(curGroups)) {
        const gid = curGroups[scope];
        if (prevChapGroups.current[scope] === gid) continue;
        const otherScope = Object.keys(curGroups).find(
          (s) => s !== scope && curGroups[s] === gid
        );
        if (otherScope) {
          const right = tabForScope(scope);
          const left = tabForScope(otherScope);
          if (left && right)
            fireSeam(left, right, TYPE_RED, TYPE_RED, TYPE_RED, false);
        }
        break;
      }
    }
    // 3) Independently of any link: a study that already existed gained verses
    //    -> a "keywords added" pulse, centered in that search's own panel (no
    //    seam). New studies (no prior count) and removals don't pulse.
    for (const sid of Object.keys(curStudyRefs)) {
      const before = prevStudyRefs.current[sid];
      if (before === undefined) continue;
      if (curStudyRefs[sid] <= before) continue;
      growKeyRef.current += 1;
      setGrowMoment({ studyId: sid, key: growKeyRef.current });
      break;
    }

    prevKwLinks.current = curKw;
    prevChapGroups.current = curGroups;
    prevStudyRefs.current = curStudyRefs;
  }, [searchStudies, chapterGroups, tabs, activeTabId]);
  // When set, the "link this keyword search to a chapter" prompt is open for the
  // keyword study with this id.
  const [linkKwStudyId, setLinkKwStudyId] = useState<string | null>(null);
  const [linkSearchDraft, setLinkSearchDraft] = useState<{
    refs: string[];
    label: string;
  } | null>(null);
  // When the search is opened from a chapter's link prompt, this holds that
  // chapter's tab so the gathered verses link straight to it (no "which chapter"
  // step). Cleared whenever the search closes so it never leaks into a later,
  // ordinary search.
  const [linkSearchTab, setLinkSearchTab] = useState<Tab | null>(null);
  useEffect(() => {
    if (!showSearch) setLinkSearchTab(null);
  }, [showSearch]);
  const [linkSelected, setLinkSelected] = useState<string[]>([]);
  const [pickV, setPickV] = useState(-1);
  const [pickB, setPickB] = useState(-1);
  const [pickC, setPickC] = useState(-1);
  const [linkedCompilePrompt, setLinkedCompilePrompt] = useState<{
    gid: string;
    tabId: string;
  } | null>(null);

  // Floating-toolbar position/orientation — ONE shared value across every open
  // tab, so the toolbar doesn't jump when you switch tabs.
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number }>(() => {
    try {
      const s = localStorage.getItem("scribal_toolbar_pos");
      return s
        ? JSON.parse(s)
        : { x: Math.max(12, (window.innerWidth - 860) / 2 - 60), y: 200 };
    } catch {
      return { x: 100, y: 200 };
    }
  });
  useEffect(() => {
    localStorage.setItem("scribal_toolbar_pos", JSON.stringify(toolbarPos));
  }, [toolbarPos]);
  const [toolbarOrient, setToolbarOrient] = useState<"vertical" | "horizontal">(
    () =>
      (localStorage.getItem("scribal_toolbar_orient") as
        | "vertical"
        | "horizontal") || "horizontal"
  );
  useEffect(() => {
    localStorage.setItem("scribal_toolbar_orient", toolbarOrient);
  }, [toolbarOrient]);

  const [backupOpen, setBackupOpen] = useState(false);
  const [driveMsg, setDriveMsg] = useState("");
  const [diag, setDiag] = useState("");
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "stale"
  >("idle");
  const [lastSync, setLastSync] = useState<number | null>(
    () => Date.parse(localStorage.getItem("scribal_sync_seen") || "") || null
  );
  const [driveConnected, setDriveConnected] = useState(
    () => !!localStorage.getItem("scribal_drive_enabled")
  );

  // Firebase cloud sync state (the seamless replacement for Drive). When signed
  // in, sync is automatic + cross-device and the old Drive path stays dormant.
  const [cloudSignedIn, setCloudSignedIn] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudEmail, setCloudEmail] = useState<string | null>(null);
  // Hide the legacy Google Drive sign-in UI while we run on Firebase. The Drive
  // code stays in place (so nothing breaks) but can't be triggered from the UI.
  const SHOW_LEGACY_DRIVE = false;
  const [gateOpen, setGateOpen] = useState(
    () =>
      !localStorage.getItem("scribal_skip_welcome") &&
      !sessionStorage.getItem("scribal_gate_done")
  );
  const [gateBusy, setGateBusy] = useState(false);
  const [gateMsg, setGateMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [bookMenuOpen, setBookMenuOpen] = useState(false);
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editingColor, setEditingColor] = useState<MarkColor | null>(null);
  const [colorDraft, setColorDraft] = useState("");

  const [sharingVerses, setSharingVerses] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [studiesOpen, setStudiesOpen] = useState(false);
  const [studyDraftRefs, setStudyDraftRefs] = useState<string[] | null>(null);
  const [studyDraftName, setStudyDraftName] = useState("");
  const [studyDraftBook, setStudyDraftBook] = useState<string>("master");
  const [studyDraftNewName, setStudyDraftNewName] = useState("");
  // "Send verses" from a reading panel: the captured verse refs (dialog open when
  // non-null), and whether the dialog is on its second step (picking an existing
  // study) versus the first step (new study vs. existing study).
  const [sendRefs, setSendRefs] = useState<string[] | null>(null);
  const [sendPicking, setSendPicking] = useState(false);
  // Third send destination: picking which study table to set the verses aside in.
  const [sendTablesPicking, setSendTablesPicking] = useState(false);
  const [moveTarget, setMoveTarget] = useState<{
    id: string;
    kind: "chapter" | "linked" | "keyword";
    bookId: string;
    name: string;
    refs: string[];
    scope: string;
  } | null>(null);
  const [moveStudyBook, setMoveStudyBook] = useState<string>("master");
  const [moveStudyNewName, setMoveStudyNewName] = useState("");
  // When a move starts, default the destination picker to the study's own book.
  useEffect(() => {
    if (moveTarget) {
      setMoveStudyBook(moveTarget.bookId);
      setMoveStudyNewName("");
    }
  }, [moveTarget]);

  // ScriptureNotes importer
  const [snImportOpen, setSnImportOpen] = useState(false);
  const [snBusy, setSnBusy] = useState(false);
  const [snErr, setSnErr] = useState("");
  const [snParsed, setSnParsed] = useState<ParsedImport | null>(null);
  const [snName, setSnName] = useState("");
  const [snPaste, setSnPaste] = useState(false);
  const [snText, setSnText] = useState("");

  const [printData, setPrintData] = useState<PrintData | null>(null);

  // Reusable confirmation dialog for destructive actions.
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    body: string;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
    secondaryLabel?: string;
    onSecondary?: () => void;
  } | null>(null);
  const askConfirm = (opts: {
    title: string;
    body: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    secondaryLabel?: string;
    onSecondary?: () => void;
  }) =>
    setConfirmAction({
      title: opts.title,
      body: opts.body,
      confirmLabel: opts.confirmLabel || "Delete",
      cancelLabel: opts.cancelLabel || "Cancel",
      onConfirm: opts.onConfirm,
      secondaryLabel: opts.secondaryLabel,
      onSecondary: opts.onSecondary,
    });


  const [dark, setDark] = useState<boolean>(() => {
    const saved = localStorage.getItem("scribal_theme");
    if (saved) return saved === "dark";
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  });

  const [colorIntensity, setColorIntensity] = useState<number>(() => {
    const saved = localStorage.getItem("scribal_color_intensity");
    return saved ? parseFloat(saved) : 1.0;
  });

  useEffect(() => {
    localStorage.setItem("scribal_theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    localStorage.setItem("scribal_color_intensity", colorIntensity.toFixed(2));
  }, [colorIntensity]);

  // Reading comfort (device-local; phones and desktop keep their own).
  const [reading, setReading] = useState<{
    fontScale: number;
    lineScale: number;
    warm: boolean;
  }>(() => {
    try {
      const s = localStorage.getItem("scribal_desktop_reading");
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
      localStorage.setItem("scribal_desktop_reading", JSON.stringify(reading));
    } catch {}
  }, [reading]);
  const [readingOpen, setReadingOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("scribal_tabs_v2", JSON.stringify(tabs));
  }, [tabs]);
  useEffect(() => {
    localStorage.setItem("scribal_active_tab_v2", activeTabId);
  }, [activeTabId]);
  useEffect(() => {
    localStorage.setItem("scribal_compile_view", compileView);
  }, [compileView]);

  const baseTheme = dark ? DARK_THEME : LIGHT_THEME;
  const theme = applyIntensityToTheme(baseTheme, colorIntensity);

  const activeTab = tabs.find((t) => t.id === activeTabId) ||
    tabs[0] || {
      id: makeTabId("master", 0, 0, 0),
      volume: 0,
      book: 0,
      chapter: 0,
      bookId: "master",
    };

  // Keep the active study book in sync with the active tab's bookId
  useEffect(() => {
    const bid = activeTab.bookId || "master";
    if (bid !== activeBookId) setActiveBook(bid);
  }, [activeTab.bookId, activeBookId, setActiveBook]);

  // Safeguard: if a saved tab points at a study book that no longer exists
  // (e.g. a deleted session, or stale persisted layout), fall back to Master.
  // Without this, the reading panel reads an empty book and shows no marks
  // even though the marks are saved and visible everywhere else.
  useEffect(() => {
    const valid = new Set(books.map((b) => b.id));
    setTabs((prev) => {
      let changed = false;
      const fixed = prev.map((t) => {
        if (valid.has(t.bookId)) return t;
        changed = true;
        return { ...t, bookId: "master" };
      });
      return changed ? fixed : prev;
    });
  }, [books]);

  // Give cloud sync this shell's merge hooks + the keys it backs up.
  useEffect(() => {
    configureSync({
      backupKeys: BACKUP_KEYS,
      mergeRemoteBooks,
      vaultMergeRemote,
      mergeRemoteStudies,
    });
  }, [mergeRemoteBooks, vaultMergeRemote]);

  // Start Firebase and mirror its sync state into the UI. Once signed in,
  // Firestore's live listener + debounced push handle sync automatically.
  useEffect(() => {
    onCloudState((s) => {
      setCloudSignedIn(s.signedIn);
      setCloudSyncing(s.syncing);
      setCloudEmail(s.email);
      if (s.lastSync) setLastSync(s.lastSync);
    });
    initCloud();
  }, []);

  // One list of the local data whose change should trigger a sync push. Both the
  // Firebase push (below) and the Drive auto-save (further down) use this exact
  // array, so the two can never drift apart again — adding a new synced field
  // means adding it here once.
  const syncData = [
    marks,
    tabs,
    activeTabId,
    colorLabels,
    scopedLabels,
    notes,
    chapterGroups,
    chapterGroupsAt,
    recordedStudies,
    searchStudies,
    colorIntensity,
  ];

  // Push local changes to Firebase (debounced inside cloudSync; only acts when
  // signed in). The live counterpart to the Drive auto-save below.
  useEffect(() => {
    noteLocalChange();
  }, syncData);

  // Auto-save to Google Drive (debounced, silent).
  // Reuses the token captured at sign-in — never requests a new one, so no popup.
  const autoSaveReady = useRef(false);
  useEffect(() => {
    if (!autoSaveReady.current) {
      autoSaveReady.current = true;
      return; // don't auto-save (or flip to "stale") just from opening the app
    }
    if (cloudSignedIn) return; // Firebase is handling sync — stay out of its way
    if (!localStorage.getItem("scribal_drive_enabled") && !drive.getToken())
      return; // not using Drive — nothing to do

    const timer = setTimeout(() => {
      setSaveStatus("saving");
      pushToDrive()
        .then((res) => {
          // "adopted" means the cloud was newer and we merged it in — that's a
          // successful sync too, so stamp the time just like a real "pushed".
          // ("fail"/"blocked" didn't sync, so we leave the timestamp alone.)
          setSaveStatus("saved");
          if (res === "pushed" || res === "adopted") setLastSync(Date.now());
        })
        .catch(() => setSaveStatus("saved"));
    }, 3000); // debounce 3 seconds after last change

    return () => clearTimeout(timer);
  }, [...syncData, cloudSignedIn]);

  // Auto-pull the other device's changes when this tab opens or regains focus.
  // Guarded by the saved timestamp so it only pulls when Drive is genuinely
  // newer than what's here — it never clobbers newer local edits.
  useEffect(() => {
    if (cloudSignedIn) return; // Firebase's live listener handles incoming changes
    const checkRemote = async () => {
      if (GOOGLE_CLIENT_ID.indexOf("PASTE_") === 0) return;
      if (!localStorage.getItem("scribal_drive_enabled") && !drive.getToken())
        return;
      // Keep the Google token warm so background syncs don't fail and nag.
      // Best-effort + silent (no popup); if it can't refresh, ops just retry later.
      try {
        await drive.connectSilent(GOOGLE_CLIENT_ID);
      } catch {
        /* silent refresh unavailable right now — fine */
      }
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
    // Poll every 15s while the tab is open + visible, so the other device's
    // changes (and deletes) show up on their own without needing to refocus.
    // Same silent path — no popup — and it's skipped whenever the tab is hidden.
    const pollId = window.setInterval(() => {
      if (!document.hidden) checkRemote();
    }, 15000);
    return () => {
      window.removeEventListener("focus", checkRemote);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(pollId);
    };
  }, [cloudSignedIn]);

  const getChapter = useCallback(
    (t: { volume: number; book: number; chapter: number }) =>
      vols[t.volume].books[t.book].chapters[t.chapter],
    []
  );
  const tabLabel = useCallback(
    (t: Tab) =>
      t.studyId
        ? searchStudies.find((s) => s.id === t.studyId)?.name || "Study"
        : vols[t.volume].books[t.book].book + " " + getChapter(t).chapter,
    [getChapter, searchStudies]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing =
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowSearch(true);
        return;
      }

      if (!typing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (!typing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }

      if (typing) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();
      // Number keys pick a marking color: 1–9 map to colors 1–9, and 0 maps to
      // color 10 (the last swatch, mirroring the keyboard's 1234567890 row).
      // Guarded on COLORS so it stays correct if the palette size changes.
      if (key >= "0" && key <= "9") {
        const c = (key === "0" ? 10 : Number(key)) as MarkColor;
        if (COLORS.includes(c)) {
          setSelectedColor(c);
          e.preventDefault();
        }
        return;
      }
      if (key === "r") {
        setToolbarOrient((o) => (o === "vertical" ? "horizontal" : "vertical"));
        e.preventDefault();
        return;
      }
      {
        const hk = toolHotkeysRef.current;
        const tool = (Object.keys(hk) as Tool[]).find((t) => hk[t] === key);
        if (tool) {
          setSelectedTool(tool);
          e.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // First run: greet new users with the live guided tour, once any opening
  // gate is out of the way.
  useEffect(() => {
    if (showTutorial && !gateOpen) {
      localStorage.setItem("scribal_tutorial_seen", "1");
      setShowTutorial(false);
      setExampleOpen(false);
      setWalkOpen(true);
    }
  }, [showTutorial, gateOpen]);

  const addNewTab = () => {
    if (tabs.length >= 7) return; // up to 7 panels
    const openIds = new Set(tabs.map((t) => t.id));
    for (let v = 0; v < vols.length; v++) {
      for (let b = 0; b < vols[v].books.length; b++) {
        for (let c = 0; c < vols[v].books[b].chapters.length; c++) {
          const id = makeTabId("master", v, b, c);
          if (!openIds.has(id)) {
            setTabs((prev) => [
              ...prev,
              { id, volume: v, book: b, chapter: c, bookId: "master" },
            ]);
            setActiveTabId(id);
            return;
          }
        }
      }
    }
  };

  const closeTab = (id: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        const fb = {
          id: makeTabId("master", 0, 0, 0),
          volume: 0,
          book: 0,
          chapter: 0,
          bookId: "master",
        };
        setActiveTabId(fb.id);
        return [fb];
      }
      if (id === activeTabId) setActiveTabId(next[next.length - 1].id);
      return next;
    });
  };

  const updateActiveTab = (volume: number, book: number, chapter: number) => {
    const bookId = activeTab.bookId || "master";
    const newId = makeTabId(bookId, volume, book, chapter);
    setTabs((prev) => {
      const existing = prev.find((t) => t.id === newId);
      if (existing) {
        setActiveTabId(newId);
        return prev;
      }
      const next = prev.map((t) =>
        t.id === activeTabId
          ? { id: newId, volume, book, chapter, bookId }
          : t
      );
      setActiveTabId(newId);
      return next;
    });
  };

  const updateTab = (
    tabId: string,
    volume: number,
    book: number,
    chapter: number
  ) => {
    const target = tabs.find((t) => t.id === tabId);
    const bookId = target?.bookId || "master";
    // Re-aiming a tab by volume or book lands on chapter 1 by default. Since a
    // tab's id is its location, that chapter can't be open in two tabs, so if
    // it's already open elsewhere the move would bounce and the tab would get
    // stuck (e.g. selecting Book of Mormon always defaults to 1 Nephi 1). When
    // the volume or book changed, skip to the first chapter of the chosen book
    // that isn't already open so navigation can continue; an explicit chapter
    // pick is honored exactly.
    let c = chapter;
    if (target && (volume !== target.volume || book !== target.book)) {
      const count = vols[volume].books[book].chapters.length;
      const openElsewhere = new Set(
        tabs.filter((t) => t.id !== tabId).map((t) => t.id)
      );
      while (c < count && openElsewhere.has(makeTabId(bookId, volume, book, c)))
        c++;
      if (c >= count) c = chapter;
    }
    const newId = makeTabId(bookId, volume, book, c);
    setTabs((prev) => {
      const existing = prev.find((t) => t.id === newId);
      if (existing) {
        setActiveTabId(newId);
        return prev;
      }
      const next = prev.map((t) =>
        t.id === tabId ? { id: newId, volume, book, chapter: c, bookId } : t
      );
      setActiveTabId(newId);
      return next;
    });
  };

  // Point the active tab at a given study book (its own session, master, etc.)
  const setActiveTabBook = (bookId: string) => {
    const t = tabs.find((x) => x.id === activeTabId);
    if (!t) return;
    const newId = makeTabId(bookId, t.volume, t.book, t.chapter);
    setTabs((prev) => {
      // if that book+chapter is already open in another tab, switch to it
      if (prev.some((x) => x.id === newId && x.id !== t.id)) {
        return prev.filter((x) => x.id !== t.id);
      }
      return prev.map((x) => (x.id === t.id ? { ...x, id: newId, bookId } : x));
    });
    setActiveTabId(newId);
  };

  // Create a fresh session and attach the active tab to it
  const fmtShortDate = (ts: number) =>
    new Date(ts).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  const fmtStudied = (ts: number) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today.getTime() - d.getTime()) / 86400000);
    if (diffDays <= 0) return "today";
    if (diffDays === 1) return "yesterday";
    if (diffDays < 7) return diffDays + " days ago";
    return fmtShortDate(ts);
  };

  const newSessionForActiveTab = () => {
    const id = createSession("Session · " + fmtShortDate(Date.now()));
    setActiveTabBook(id);
  };

  // Open the "which tabs do you want to link?" prompt for a tab. Pre-checks the
  // tab's current group members so you can also change or unlink from here.
  const openLinkPrompt = (t: Tab) => {
    const csT = chapterScopeOf(t);
    const gid = chapterGroups[csT];
    const pre = gid
      ? Object.keys(chapterGroups).filter(
          (s) => chapterGroups[s] === gid && s !== csT
        )
      : [];
    setLinkSelected(pre);
    setPickV(-1);
    setPickB(-1);
    setPickC(-1);
    setLinkPromptTabId(t.id);
  };

  // Every chapter already linked to this scope (or just the scope itself if it
  // isn't linked yet). Adding any one of them should bring the whole group.
  const groupScopesOf = (cs: string): string[] => {
    const g = chapterGroups[cs];
    return g
      ? Object.keys(chapterGroups).filter((k) => chapterGroups[k] === g)
      : [cs];
  };

  const toggleLinkSelect = (cs: string) =>
    setLinkSelected((prev) => {
      if (prev.includes(cs)) return prev.filter((s) => s !== cs);
      // Linking with a chapter that's already in a group links with the entire
      // group, so the chapters that aren't open in a tab are never dropped.
      const set = new Set(prev);
      groupScopesOf(cs).forEach((s) => set.add(s));
      return Array.from(set);
    });

  // When a link change leaves a group with a single chapter, that group
  // dissolves and its recorded "linked" study would point at nothing. Convert
  // that study back to a single-chapter study for the chapter that remains, or
  // retire it if a chapter study for that chapter already exists. `survivors`
  // maps each dissolved group id to its lone remaining chapter scope.
  const convertDissolvedStudies = (survivors: Record<string, string>) => {
    if (!Object.keys(survivors).length) return;
    setRecordedStudies((prev) => {
      let changed = false;
      const out = prev.map((s) => {
        if (s.type !== "linked" || !(s.scopeRef in survivors)) return s;
        const survivor = survivors[s.scopeRef];
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
        // The auto linked name joins chapters with "  +  "; if the user gave it a
        // real name (no separator) keep it, otherwise name it for the chapter.
        const keepName = !!s.name && s.name.indexOf("  +  ") < 0;
        const m: Study = {
          ...s,
          type: "chapter",
          scopeRef: survivor,
          name: keepName ? s.name : survivor,
          nameAt: keepName ? s.nameAt : now,
          compiledAt: now,
        };
        return m;
      });
      return changed ? out : prev;
    });
  };

  // Apply the prompt: the clicked tab is linked with exactly the checked tabs.
  // Checking none unlinks it. Any old groups left with one chapter dissolve.
  const applyLinkPrompt = () => {
    const t = tabs.find((x) => x.id === linkPromptTabId);
    const members = linkSelected;
    setLinkPromptTabId(null);
    if (!t) return;
    const csT = chapterScopeOf(t);
    const doApply = () => {
    if (members.length === 0) {
      const prev = chapterGroups;
      const next = { ...prev };
      delete next[csT];
      const counts: Record<string, number> = {};
      Object.values(next).forEach((g) => (counts[g] = (counts[g] || 0) + 1));
      const survivors: Record<string, string> = {};
      Object.keys(next).forEach((s) => {
        if (counts[next[s]] < 2) survivors[next[s]] = s;
      });
      Object.keys(next).forEach((s) => {
        if (counts[next[s]] < 2) delete next[s];
      });
      stampGroupChanges(prev, next); // record the unlink so it syncs
      setChapterGroups(next);
      convertDissolvedStudies(survivors);
      if (mode === "compile") reCompileFromLink(next, csT);
      return;
    }
    const all = [csT, ...members];
    // Reuse an existing group's id when one is involved, so the id stays stable
    // across devices and the group's themes aren't orphaned; only mint a new id
    // when none of these chapters were grouped yet. Picking the smallest existing
    // id matches how the cross-device merge chooses, keeping both consistent.
    const existingGids = Array.from(
      new Set(
        all
          .map((s) => chapterGroups[s])
          .filter((g): g is string => typeof g === "string" && !!g)
      )
    ).sort();
    const gid = existingGids.length ? existingGids[0] : newGroupId();
    // Carry theme names into the chosen group's palette, reading each chapter
    // from its CURRENT label scope — a grouped chapter's themes live under its
    // "group:<id>" scope, so seed from there (not its bare scope) or they'd be
    // lost when groups merge/extend. Fill-blanks only, so existing names survive.
    all.forEach((ms) => {
      const eff = chapterGroups[ms] ? "group:" + chapterGroups[ms] : ms;
      seedScopeLabels("group:" + gid, scopedLabels[eff] || {});
    });
    const prev = chapterGroups;
    const next = { ...prev };
    all.forEach((ms) => {
      next[ms] = gid;
    });
    // Unchecking a member must actually drop it: this group becomes EXACTLY
    // {current chapter + checked chapters}. Any chapter still carrying this
    // group's id that wasn't re-selected is removed here (the singleton sweep
    // below then cleans up any other group this leaves with a lone chapter).
    Object.keys(next).forEach((s) => {
      if (next[s] === gid && all.indexOf(s) < 0) delete next[s];
    });
    const counts: Record<string, number> = {};
    Object.values(next).forEach((g) => (counts[g] = (counts[g] || 0) + 1));
    const survivors: Record<string, string> = {};
    Object.keys(next).forEach((s) => {
      if (next[s] !== gid && counts[next[s]] < 2) survivors[next[s]] = s;
    });
    Object.keys(next).forEach((s) => {
      if (next[s] !== gid && counts[next[s]] < 2) delete next[s];
    });
    stampGroupChanges(prev, next); // record the link so it syncs
    setChapterGroups(next);
    convertDissolvedStudies(survivors);
    // Any other existing group whose chapters all merged into `gid` is absorbed;
    // re-point its recorded linked study to `gid` (or retire it if `gid` already
    // has one) so it isn't orphaned.
    const liveGids = new Set(Object.values(next));
    const absorbed = existingGids.filter(
      (g) => g !== gid && !liveGids.has(g) && !survivors[g]
    );
    if (absorbed.length) {
      const at = Date.now();
      setRecordedStudies((prevS) => {
        let changed = false;
        const out = prevS.map((s) => {
          if (
            s.type !== "linked" ||
            !absorbed.includes(s.scopeRef) ||
            isStudyDeleted(s)
          )
            return s;
          const keepHas = prevS.some(
            (o) =>
              o.id !== s.id &&
              o.type === "linked" &&
              o.bookId === s.bookId &&
              o.scopeRef === gid &&
              !isStudyDeleted(o)
          );
          changed = true;
          return keepHas
            ? { ...s, deletedAt: at }
            : { ...s, scopeRef: gid, compiledAt: at };
        });
        return changed ? out : prevS;
      });
    }
    const csTG = chapterGroups[csT];
    const newlyAdded = members.filter(
      (m) => !csTG || chapterGroups[m] !== csTG
    );
    if (mode === "compile") {
      if (newlyAdded.length) {
        // Send the user straight to the chapter they just added so they can
        // mark it (mirrors mobile's "Add a chapter", which jumps to it).
        const target = newlyAdded[0];
        const loc = chapterLoc.get(target);
        if (loc) {
          const tid = makeTabId(activeBookId, loc.volume, loc.book, loc.chapter);
          setTabs((prev) =>
            prev.some((t2) => t2.id === tid)
              ? prev
              : [
                  ...prev,
                  {
                    id: tid,
                    volume: loc.volume,
                    book: loc.book,
                    chapter: loc.chapter,
                    bookId: activeBookId,
                  },
                ]
          );
          setActiveTabId(tid);
          setMode("read");
          setJumpTarget(target + ":1");
        } else {
          reCompileFromLink(next, csT);
        }
      } else {
        reCompileFromLink(next, csT);
      }
    }
    };
    // The unlink confirmation fires the moment a linked chapter is unchecked
    // (see the link prompt's checkboxes), and linking never prompts, so the
    // commit just applies.
    doApply();
  };

  const locateReference = (reference: string) => {
    for (let v = 0; v < vols.length; v++) {
      for (let b = 0; b < vols[v].books.length; b++) {
        for (let c = 0; c < vols[v].books[b].chapters.length; c++) {
          const ch = vols[v].books[b].chapters[c];
          if (ch.verses.some((vs) => vs.reference === reference)) {
            return { v, b, c };
          }
        }
      }
    }
    return null;
  };

  const jumpToReference = (reference: string) => {
    const loc = locateReference(reference);
    if (!loc) return;
    updateActiveTab(loc.v, loc.b, loc.c);
    setMode("read");
    setJumpTarget(reference);
  };

  const openInNewTab = (reference: string) => {
    const loc = locateReference(reference);
    if (!loc) return;
    const id = makeTabId("master", loc.v, loc.b, loc.c);
    setTabs((prev) =>
      prev.find((t) => t.id === id)
        ? prev
        : [
            ...prev,
            {
              id,
              volume: loc.v,
              book: loc.b,
              chapter: loc.c,
              bookId: "master",
            },
          ]
    );
    setActiveTabId(id);
    setMode("read");
    setJumpTarget(reference);
  };

  // Jump to a specific marked verse in a specific study book (theme search).
  // Done in one pass so the tab's book + chapter switch together.
  const jumpToMark = (bookId: string, reference: string) => {
    const loc = locateReference(reference);
    if (!loc) return;
    const t = tabs.find((x) => x.id === activeTabId);
    if (!t) return;
    const newId = makeTabId(bookId, loc.v, loc.b, loc.c);
    setTabs((prev) => {
      if (prev.some((x) => x.id === newId && x.id !== t.id)) {
        return prev.filter((x) => x.id !== t.id);
      }
      return prev.map((x) =>
        x.id === t.id
          ? {
              ...x,
              id: newId,
              bookId,
              volume: loc.v,
              book: loc.b,
              chapter: loc.c,
            }
          : x
      );
    });
    setActiveTabId(newId);
    setMode("read");
    setJumpTarget(reference);
    setShowSearch(false);
  };

  // Resolve a chapter scope ("1 Nephi 1") to its canon location.
  const locOfScope = (scope: string) => {
    for (let v = 0; v < vols.length; v++)
      for (let b = 0; b < vols[v].books.length; b++)
        for (let c = 0; c < vols[v].books[b].chapters.length; c++) {
          const r = vols[v].books[b].chapters[c].verses[0]?.reference;
          if (r && scopeOfRef(r) === scope) return { v, b, c };
        }
    return null;
  };

  // From the link prompt: point its own tab at a linked chapter (mirrors
  // jumpToMark, but for the prompt's tab and book). If that chapter is already
  // open in another tab, focus it rather than duplicate it.
  const jumpLinkedTab = (scope: string) => {
    const t = tabs.find((x) => x.id === linkPromptTabId);
    if (!t) return;
    const loc = locOfScope(scope);
    if (!loc) return;
    const newId = makeTabId(t.bookId, loc.v, loc.b, loc.c);
    setTabs((prev) => {
      if (prev.some((x) => x.id === newId && x.id !== t.id)) {
        return prev.filter((x) => x.id !== t.id);
      }
      return prev.map((x) =>
        x.id === t.id
          ? { ...x, id: newId, volume: loc.v, book: loc.b, chapter: loc.c }
          : x
      );
    });
    setActiveTabId(newId);
    setMode("read");
    setLinkPromptTabId(null);
  };

  // From the link prompt: open a linked chapter in a new tab, in the same book.
  const openLinkedTab = (scope: string) => {
    const t = tabs.find((x) => x.id === linkPromptTabId);
    if (!t) return;
    const loc = locOfScope(scope);
    if (!loc) return;
    const id = makeTabId(t.bookId, loc.v, loc.b, loc.c);
    setTabs((prev) =>
      prev.some((x) => x.id === id)
        ? prev
        : [
            ...prev,
            {
              id,
              volume: loc.v,
              book: loc.b,
              chapter: loc.c,
              bookId: t.bookId,
            },
          ]
    );
    setActiveTabId(id);
    setMode("read");
    setLinkPromptTabId(null);
  };

  // ---- Keyword-study link modal: navigate to / link chapters ----
  // Open (or focus) a chapter the study is linked to, in the study's book so
  // its marks line up. Self-contained — unlike jumpLinkedTab it isn't tied to
  // the chapter link prompt.
  const kwOpenChapter = (study: SearchStudy, scope: string) => {
    const loc = locOfScope(scope);
    if (!loc) return;
    const id = makeTabId(study.bookId, loc.v, loc.b, loc.c);
    setTabs((prev) =>
      prev.some((x) => x.id === id)
        ? prev
        : [
            ...prev,
            {
              id,
              volume: loc.v,
              book: loc.b,
              chapter: loc.c,
              bookId: study.bookId,
            },
          ]
    );
    setActiveTabId(id);
    setMode("read");
    setLinkKwStudyId(null);
  };
  // Link a keyword study to a chapter. Standalone → just set linkedScope. Already
  // linked → grow the linked chapter's group to include the new chapter, mirroring
  // the chapter link modal's SAFE path (reuse an existing group id, absorb the new
  // chapter's old group, seed theme names fill-blanks, dissolve any group left with
  // a single chapter, and re-point dissolved studies).
  const linkKwToChapter = (study: SearchStudy, scope: string) => {
    const cur = study.linkedScope;
    if (!cur) {
      updateStudy(study.id, { linkedScope: scope });
      setLinkKwStudyId(null);
      return;
    }
    if (resolveScope(cur) === resolveScope(scope)) {
      setLinkKwStudyId(null);
      return;
    }
    const prev = chapterGroups;
    const involved = Array.from(
      new Set([prev[cur], prev[scope]].filter((g): g is string => !!g))
    ).sort();
    const gid = involved.length ? involved[0] : newGroupId();
    const next = { ...prev };
    Object.keys(next).forEach((s) => {
      if (involved.includes(next[s])) next[s] = gid;
    });
    next[cur] = gid;
    next[scope] = gid;
    [cur, scope].forEach((s) => {
      const eff = prev[s] ? "group:" + prev[s] : s;
      seedScopeLabels("group:" + gid, scopedLabels[eff] || {});
    });
    const counts: Record<string, number> = {};
    Object.values(next).forEach((g) => (counts[g] = (counts[g] || 0) + 1));
    const survivors: Record<string, string> = {};
    Object.keys(next).forEach((s) => {
      if (next[s] !== gid && counts[next[s]] < 2) survivors[next[s]] = s;
    });
    Object.keys(next).forEach((s) => {
      if (next[s] !== gid && counts[next[s]] < 2) delete next[s];
    });
    stampGroupChanges(prev, next);
    setChapterGroups(next);
    convertDissolvedStudies(survivors);
    setLinkKwStudyId(null);
  };

  const activeChapterRefs = useMemo(() => {
    if (activeTab.studyId) {
      const st = searchStudies.find((s) => s.id === activeTab.studyId);
      return new Set(st ? st.refs : []);
    }
    return new Set(getChapter(activeTab).verses.map((v) => v.reference));
  }, [activeTab, getChapter, searchStudies]);

  const groups: { reference: string; color: MarkColor; items: Mark[] }[] = [];
  marks
    .filter((m) => activeChapterRefs.has(m.reference))
    .forEach((mark) => {
      const existing = groups.find(
        (g) => g.reference === mark.reference && g.color === mark.color
      );
      if (existing) existing.items.push(mark);
      else
        groups.push({
          reference: mark.reference,
          color: mark.color,
          items: [mark],
        });
    });
  groups.forEach((g) => g.items.sort((a, b) => a.startIndex - b.startIndex));

  // Group open tabs into "compile units": each unlinked tab is its own unit,
  // and each link group becomes one unit. (Mirrors the verified rules.)
  const compileUnits = (): { label: string; tabIds: string[] }[] => {
    const units: { label: string; tabIds: string[] }[] = [];
    const seen: Record<string, { label: string; tabIds: string[] }> = {};
    const seenTabs: Record<string, Tab[]> = {};
    tabs.forEach((t) => {
      if (t.studyId) {
        const ks = searchStudies.find((s) => s.id === t.studyId);
        // A linked keyword search is not its own compile unit — it folds into
        // its linked chapter's compile (by scope), so skip it here.
        if (ks?.linkedScope) return;
      }
      const gid = chapterGroups[chapterScopeOf(t)];
      if (gid) {
        if (!seen[gid]) {
          seen[gid] = { label: "", tabIds: [] };
          seenTabs[gid] = [];
          units.push(seen[gid]);
        }
        seen[gid].tabIds.push(t.id);
        seenTabs[gid].push(t);
      } else {
        units.push({ label: tabLabel(t), tabIds: [t.id] });
      }
    });
    Object.keys(seen).forEach((gid) => {
      seen[gid].label =
        "Linked: " + seenTabs[gid].map((t) => tabLabel(t)).join(" + ");
    });
    return units;
  };

  // Resolve compile tab ids (real OR the synthetic ones a linked-study compile
  // builds) to the chapter scopes they cover. Tab ids encode volume/book/chapter
  // as their last three segments, so this works even when the ids don't match
  // any open tab.
  const scopesFromTabIds = (tabIds: string[]): Set<string> => {
    const set = new Set<string>();
    tabIds.forEach((id) => {
      const p = id.split("_");
      const chapter = Number(p[p.length - 1]);
      const book = Number(p[p.length - 2]);
      const volume = Number(p[p.length - 3]);
      const sc = chapterScopeOf({ volume, book, chapter });
      if (sc) set.add(sc);
    });
    return set;
  };

  // Capture the marked words on screen for a compile. A mark is taken if it
  // sits in a reading panel (data-compile-tab) and it's in the viewport. When
  // an inScope filter is given (keyword studies) the mark's verse must also be
  // part of the compile. Marks are grouped per panel and then interleaved
  // round-robin, so the flying tiles are pulled EVENLY from every open panel
  // instead of all coming from whichever panel is first in the DOM (which,
  // with the flyer cap, used to starve the other panels of any tiles).
  const captureCompileFlyers = (
    inScope?: (ref: string) => boolean
  ): CompileFlyer[] => {
    const byPanel: CompileFlyer[][] = [];
    const panelIndex = new Map<string, number>();
    try {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      document.querySelectorAll<HTMLElement>("[data-mc]").forEach((el) => {
        const panel = el.closest("[data-compile-tab]");
        if (!panel) return;
        if (inScope) {
          const verse = el.closest("[data-verse-ref]");
          const ref = verse ? verse.getAttribute("data-verse-ref") || "" : "";
          if (!inScope(ref)) return;
        }
        const r = el.getBoundingClientRect();
        if (
          r.height <= 0 ||
          r.top >= vh - 4 ||
          r.bottom <= 4 ||
          r.left >= vw ||
          r.right <= 0
        )
          return;
        const tid = panel.getAttribute("data-compile-tab") || "?";
        let pi = panelIndex.get(tid);
        if (pi === undefined) {
          pi = byPanel.length;
          panelIndex.set(tid, pi);
          byPanel.push([]);
        }
        byPanel[pi].push({
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
    // Interleave: take the 1st mark of each panel, then the 2nd of each, etc.
    const out: CompileFlyer[] = [];
    let col = 0;
    let any = true;
    while (any && out.length < 40) {
      any = false;
      for (let p = 0; p < byPanel.length; p++) {
        if (col < byPanel[p].length) {
          out.push(byPanel[p][col]);
          any = true;
        }
      }
      col++;
    }
    return out;
  };

  const runCompile = (tabIds: string[], animate = true) => {
    setCompileVirtualTabs(null);
    setCompileStudyId(null);
    const ids = tabIds.length ? tabIds : tabs.map((t) => t.id);
    setCompileSelection(ids);
    // Saving is now an explicit step (Save to Studies). Seed the name field
    // from an existing record for this scope, else the chapter label(s).
    const unitTabs = tabs.filter((t) => ids.includes(t.id));
    let defName = unitTabs.map((t) => tabLabel(t)).join("  +  ");
    if (unitTabs.length) {
      const gid = chapterGroups[chapterScopeOf(unitTabs[0])];
      const isLinked =
        !!gid &&
        unitTabs.every((t) => chapterGroups[chapterScopeOf(t)] === gid);
      const type: "chapter" | "linked" = isLinked ? "linked" : "chapter";
      const scopeRef = isLinked ? gid : chapterScopeOf(unitTabs[0]);
      const ex = recordedStudies.find(
        (s) =>
          s.type === type &&
          s.bookId === activeBookId &&
          s.scopeRef === scopeRef
      );
      if (ex) defName = ex.name;
    }
    setCompileName(defName);
    // Opening an existing study jumps straight to its notes; only the Compile
    // button plays the gather animation.
    if (!animate) {
      setMode("compile");
      return;
    }
    const lastCount = Number(
      localStorage.getItem("scribal_last_compile_count") || "0"
    );
    const currentCount = marks.length;
    const delta = Math.max(0, currentCount - lastCount);
    const duration = delta > 8 ? 2500 : 1000;
    localStorage.setItem("scribal_last_compile_count", String(currentCount));
    const scopeSet = scopesFromTabIds(ids);
    const flyers = captureCompileFlyers((ref) => scopeSet.has(scopeOfRef(ref)));
    const colors = marks
      .filter((m) => scopeSet.has(scopeOfRef(m.reference)))
      .map((m) => m.color)
      .slice(0, 24);
    setCompileAnim({ show: true, duration, flyers, colors });
  };

  const startStudyCompile = (study: SearchStudy, animate = true) => {
    setCompileVirtualTabs(null);
    setCompileStudyId(study.id);
    setCompileName(study.name);
    // Reopening from the Studies list jumps straight to the notes — the gather
    // animation is only for the act of compiling while marking.
    if (!animate) {
      setMode("compile");
      return;
    }
    const lastCount = Number(
      localStorage.getItem("scribal_last_compile_count") || "0"
    );
    const currentCount = marks.length;
    const delta = Math.max(0, currentCount - lastCount);
    const duration = delta > 8 ? 2500 : 1000;
    localStorage.setItem("scribal_last_compile_count", String(currentCount));
    const refSet = new Set(study.refs);
    const flyers = captureCompileFlyers((ref) => refSet.has(ref));
    const colors = getBook(study.bookId)
      .marks.filter((m) => refSet.has(m.reference))
      .map((m) => m.color)
      .slice(0, 24);
    setCompileAnim({ show: true, duration, flyers, colors });
  };

  // Compile a linked keyword search together with its chapter: compile the
  // linked chapter (opening it if it isn't already in a tab) so the scope-based
  // fold pulls this search's verses in. Same combined result as compiling from
  // the chapter side, themed by the chapter.
  const compileLinkedSearch = (st: SearchStudy, animate = true) => {
    const scope = st.linkedScope;
    if (!scope) {
      startStudyCompile(st, animate);
      return;
    }
    const target = resolveScope(scope);
    let chapterTabIds = tabs
      .filter((t) => !t.studyId && resolveScope(chapterScopeOf(t)) === target)
      .map((t) => t.id);
    if (chapterTabIds.length === 0) {
      const loc = chapterLoc.get(scope);
      if (!loc) {
        startStudyCompile(st, animate);
        return;
      }
      const id = makeTabId(activeBookId, loc.volume, loc.book, loc.chapter);
      setTabs((prev) =>
        prev.some((t) => t.id === id)
          ? prev
          : [
              ...prev,
              {
                id,
                volume: loc.volume,
                book: loc.book,
                chapter: loc.chapter,
                bookId: activeBookId,
              },
            ]
      );
      chapterTabIds = [id];
    }
    runCompile(chapterTabIds, animate);
  };
  // resulting unit's chapters as tabs and recompile, so the notes reflect the
  // new link set. `groups` is the just-computed map (state isn't updated yet).
  const reCompileFromLink = (
    groups: Record<string, string>,
    member: string
  ) => {
    const gid = groups[member];
    // Adding a chapter promotes a saved single-chapter study into the linked
    // group (mirrors mobile's "+ Add chapter"): convert it in place, or retire
    // it if a linked study for the group already exists — so you don't end up
    // with a stale single-chapter study beside the new linked one.
    if (gid) {
      setRecordedStudies((prevS) => {
        const linkedExists = prevS.some(
          (s) =>
            s.type === "linked" &&
            s.bookId === activeBookId &&
            s.scopeRef === gid &&
            !isStudyDeleted(s)
        );
        let changed = false;
        const out = prevS.map((s) => {
          if (
            s.type !== "chapter" ||
            s.bookId !== activeBookId ||
            s.scopeRef !== member ||
            isStudyDeleted(s)
          )
            return s;
          changed = true;
          const now = Date.now();
          if (linkedExists) {
            const t: Study = { ...s, deletedAt: now };
            return t;
          }
          const m: Study = {
            ...s,
            type: "linked",
            scopeRef: gid,
            compiledAt: now,
          };
          return m;
        });
        return changed ? out : prevS;
      });
    }
    const scopes = gid
      ? Object.keys(groups).filter((s) => groups[s] === gid)
      : [member];
    const locs = scopes
      .map((sc) => chapterLoc.get(sc))
      .filter(Boolean) as { volume: number; book: number; chapter: number }[];
    if (!locs.length) return;
    const tabIds = locs.map((loc) =>
      makeTabId(activeBookId, loc.volume, loc.book, loc.chapter)
    );
    setTabs((prev) => {
      let nx = prev;
      locs.forEach((loc) => {
        const id = makeTabId(activeBookId, loc.volume, loc.book, loc.chapter);
        if (!nx.some((t) => t.id === id))
          nx = [
            ...nx,
            {
              id,
              volume: loc.volume,
              book: loc.book,
              chapter: loc.chapter,
              bookId: activeBookId,
            },
          ];
      });
      return nx;
    });
    if (tabIds[0]) setActiveTabId(tabIds[0]);
    runCompile(tabIds);
  };

  const startCompile = () => {
    setCompileStudyId(null);
    const gid =
      activeTab && !activeTab.studyId
        ? chapterGroups[chapterScopeOf(activeTab)]
        : undefined;
    if (gid) {
      setLinkedCompilePrompt({ gid, tabId: activeTab.id });
      return;
    }
    const units = compileUnits();
    // Only one thing open (a single chapter, or a single linked group) — just
    // compile it. More than one separate thing — ask first.
    if (units.length <= 1) {
      runCompile(units.length ? units[0].tabIds : tabs.map((t) => t.id));
    } else {
      setCompilePrompt(units);
    }
  };

  const chooseCompileUnit = (u: { label: string; tabIds: string[] }) => {
    setCompilePrompt(null);
    runCompile(u.tabIds);
  };

  // Compile the whole linked study (all chapters in the group) without opening
  // them as tabs — the open reading tabs stay exactly as they are.
  const compileLinkedAll = (gid: string) => {
    setLinkedCompilePrompt(null);
    const scopes = Object.keys(chapterGroups).filter(
      (c) => chapterGroups[c] === gid
    );
    const locs = scopes
      .map((sc) => chapterLoc.get(sc))
      .filter(Boolean) as {
      volume: number;
      book: number;
      chapter: number;
    }[];
    if (!locs.length) return;
    // Compile the whole linked study WITHOUT opening every chapter as a tab:
    // build synthetic compile tabs (scripture order) and feed them straight to
    // the compile, exactly the way a keyword study compiles. The open reading
    // tabs are left untouched.
    const virtualTabs: Tab[] = locs
      .map((loc) => ({
        id: makeTabId(activeBookId, loc.volume, loc.book, loc.chapter),
        volume: loc.volume,
        book: loc.book,
        chapter: loc.chapter,
        bookId: activeBookId,
      }))
      .sort(
        (a, b) =>
          a.volume - b.volume || a.book - b.book || a.chapter - b.chapter
      );
    const tabIds = virtualTabs.map((t) => t.id);
    runCompile(tabIds);
    setCompileVirtualTabs(virtualTabs);
    const linkedRec = recordedStudies.find(
      (s) =>
        s.type === "linked" &&
        s.bookId === activeBookId &&
        s.scopeRef === gid &&
        !isStudyDeleted(s)
    );
    setCompileName(
      linkedRec
        ? linkedRec.name
        : virtualTabs.map((t) => tabLabel(t)).join("  +  ")
    );
  };

  // Study just this chapter on its own: copy its marks into a fresh session
  // book and compile only it, leaving the linked study untouched.
  const compileJustThisSession = (tabId: string) => {
    setLinkedCompilePrompt(null);
    const t = tabs.find((x) => x.id === tabId);
    if (!t) return;
    const cs = chapterScopeOf(t);
    const refs = vols[t.volume].books[t.book].chapters[t.chapter].verses.map(
      (v) => v.reference
    );
    const id = createSession(cs);
    absorb(id, activeBookId, refs);
    setActiveBook(id);
    const newTabId = makeTabId(id, t.volume, t.book, t.chapter);
    setTabs((prev) =>
      prev.some((x) => x.id === newTabId)
        ? prev
        : [
            ...prev,
            {
              id: newTabId,
              volume: t.volume,
              book: t.book,
              chapter: t.chapter,
              bookId: id,
            },
          ]
    );
    setActiveTabId(newTabId);
    runCompile([newTabId]);
  };

  const finishCompileAnim = () => {
    setCompileAnim((a) => ({ ...a, show: false }));
    setMode("compile");
  };

  const toggleCompileTab = (id: string) => {
    setCompileSelection((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const compileTabs = compileVirtualTabs
    ? compileVirtualTabs
    : tabs.filter((t) => compileSelection.includes(t.id));

  // The label scope for the active chapter (its group's scope if linked).
  // A keyword search linked to a chapter borrows that chapter's scope, so its
  // tab shows and edits the chapter's themes (shared palette) rather than its
  // own separate set.
  const activeKwStudy = activeTab.studyId
    ? searchStudies.find((s) => s.id === activeTab.studyId)
    : undefined;
  const activeScope = activeTab.studyId
    ? activeKwStudy?.linkedScope
      ? resolveScope(activeKwStudy.linkedScope)
      : "searchstudy:" + activeTab.studyId
    : resolveScope(chapterScopeOf(activeTab));
  const activeScopedLabels = scopedLabels[activeScope] || {};

  // For a linked chapter, the themes the study has already established (named in
  // the group, or used by a mark anywhere in the group). A blank linked chapter
  // shows these so its shared palette is visible to continue with.
  const activeChapterScope = activeTab.studyId
    ? ""
    : chapterScopeOf(activeTab);
  const isLinkedChapter =
    !!activeChapterScope && !!chapterGroups[activeChapterScope];
  const establishedThemes = useMemo<{ color: MarkColor; name: string }[]>(() => {
    if (!isLinkedChapter) return [];
    const gid = chapterGroups[activeChapterScope];
    const gScopes = new Set(
      Object.keys(chapterGroups).filter((k) => chapterGroups[k] === gid)
    );
    const used = new Set<MarkColor>();
    allMarks.forEach((m) => {
      if (gScopes.has(scopeOfRef(m.reference))) used.add(m.color);
    });
    const out: { color: MarkColor; name: string }[] = [];
    COLORS.forEach((c) => {
      const nm = (activeScopedLabels[c] || "").trim();
      if (nm || used.has(c)) out.push({ color: c, name: nm || "Color " + c });
    });
    return out;
  }, [isLinkedChapter, activeChapterScope, chapterGroups, allMarks, activeScopedLabels]);

  // Scope for whatever is being compiled (the prompt guarantees one unit:
  // a single chapter, or one link group — both resolve to a single scope).
  const compileScope = compileTabs[0]
    ? resolveScope(chapterScopeOf(compileTabs[0]))
    : "";

  // When compiling a keyword study, override what the compile views + print see
  // (its spanned chapters and only its marks) without touching the chapter
  // compile selection. The study's theme names live under its own scope, so
  // the names set in the study tab's reader carry straight into the compile.
  const compileStudy =
    compileStudyId != null
      ? searchStudies.find((s) => s.id === compileStudyId) || null
      : null;
  const studyCompileTabs: Tab[] = [];
  if (compileStudy) {
    const seen = new Set<string>();
    compileStudy.refs.forEach((r) => {
      const loc = refLoc.get(r);
      if (!loc) return;
      const key = loc.volume + ":" + loc.book + ":" + loc.chapter;
      if (seen.has(key)) return;
      seen.add(key);
      studyCompileTabs.push({
        id: "studycompile_" + key,
        volume: loc.volume,
        book: loc.book,
        chapter: loc.chapter,
        bookId: compileStudy.bookId,
      });
    });
  }
  const studyRefSet = compileStudy
    ? new Set(compileStudy.refs as string[])
    : null;
  // For a recorded chapter/linked study, fold in any loose verses it has added
  // (extraRefs) so their marks show alongside the chapter's — exactly like
  // mobile. Find the recorded study matching what's being compiled to read its
  // extras (the compile itself is driven by tabs, not a Study object).
  const compiledRec =
    !compileStudy && compileTabs.length
      ? (() => {
          const cs0 = chapterScopeOf(compileTabs[0]);
          const gid = chapterGroups[cs0];
          const isLinked =
            !!gid &&
            compileTabs.every((t) => chapterGroups[chapterScopeOf(t)] === gid);
          const type: "chapter" | "linked" = isLinked ? "linked" : "chapter";
          const scopeRef = isLinked ? gid : cs0;
          return (
            recordedStudies.find(
              (s) =>
                s.type === type &&
                s.bookId === activeBookId &&
                s.scopeRef === scopeRef
            ) || null
          );
        })()
      : null;
  // Keyword searches linked to any chapter being compiled — their verses fold
  // in as extras so the compiled study shows the chapter's marks and the linked
  // search's marks together. Driven by the search's saved linkedScope, so it
  // holds across reopens.
  const linkedSearchRefs = compileStudy
    ? []
    : (() => {
        const compiledScopes = new Set(
          compileTabs.map((t) => resolveScope(chapterScopeOf(t)))
        );
        return Array.from(
          new Set(
            searchStudies
              .filter(
                (s) =>
                  !isSearchStudyDeleted(s) &&
                  s.linkedScope &&
                  compiledScopes.has(resolveScope(s.linkedScope))
              )
              .flatMap((s) => s.refs)
          )
        );
      })();
  const compiledExtras = Array.from(
    new Set([
      ...(compiledRec && compiledRec.extraRefs ? compiledRec.extraRefs : []),
      ...linkedSearchRefs,
    ])
  );
  // A tab for each extra verse's chapter (so the views can render it). The marks
  // filter below keeps only the extra verses from those chapters, not the whole
  // chapter — so an added verse from elsewhere doesn't drag its neighbours in.
  const extraTabs: Tab[] = compiledExtras.length
    ? (() => {
        const have = new Set(compileTabs.map((t) => t.id));
        const seen = new Set<string>();
        const out: Tab[] = [];
        compiledExtras.forEach((r) => {
          const loc = refLoc.get(r);
          if (!loc) return;
          const id = makeTabId(activeBookId, loc.volume, loc.book, loc.chapter);
          if (have.has(id) || seen.has(id)) return;
          seen.add(id);
          out.push({
            id,
            volume: loc.volume,
            book: loc.book,
            chapter: loc.chapter,
            bookId: activeBookId,
          });
        });
        return out;
      })()
    : [];
  const studyScopeSet = compiledExtras.length
    ? new Set(compileTabs.map((t) => chapterScopeOf(t)))
    : null;
  const extrasSet = compiledExtras.length ? new Set(compiledExtras) : null;
  const effectiveCompileTabs = compileStudy
    ? studyCompileTabs
    : [...compileTabs, ...extraTabs];
  const effectiveScope = compileStudy
    ? "searchstudy:" + compileStudy.id
    : compileScope;
  const effectiveScopedLabels = scopedLabels[effectiveScope] || {};
  const effectiveMarks =
    compileStudy && studyRefSet
      ? getBook(compileStudy.bookId).marks.filter((m) =>
          studyRefSet.has(m.reference)
        )
      : studyScopeSet && extrasSet
      ? marks.filter(
          (m) =>
            studyScopeSet.has(scopeOfRef(m.reference)) ||
            extrasSet.has(m.reference)
        )
      : marks;

  // ── Quick-find (compiled board) ────────────────────────────────────────────
  // A per-verse index of the compiled study's marks. A verse matches the Find
  // bar on its reference, on any word marked in it, or on any theme name.
  const compileFindIndex = (() => {
    const byRef = new Map<
      string,
      { color: number; themes: Set<string>; texts: string[] }
    >();
    effectiveMarks.forEach((m) => {
      const sealed = m.label !== undefined && m.label.trim() !== "";
      const theme = sealed
        ? (m.label as string).trim()
        : (effectiveScopedLabels[m.color] || "Color " + m.color).trim();
      let cur = byRef.get(m.reference);
      if (!cur) {
        cur = { color: m.color, themes: new Set<string>(), texts: [] };
        byRef.set(m.reference, cur);
      }
      if (theme) cur.themes.add(theme);
      if (m.markedText.trim()) cur.texts.push(m.markedText.trim());
    });
    return Array.from(byRef.entries())
      .map(([reference, v]) => ({
        reference,
        color: v.color,
        themes: Array.from(v.themes),
        texts: v.texts,
      }))
      .sort((a, b) => orderOfRef(a.reference) - orderOfRef(b.reference));
  })();
  const compileFindQuery = compileFindQ.trim().toLowerCase();
  const compileFindResults = compileFindQuery
    ? compileFindIndex
        .filter(
          (r) =>
            r.reference.toLowerCase().includes(compileFindQuery) ||
            r.themes.some((t) => t.toLowerCase().includes(compileFindQuery)) ||
            r.texts.some((t) => t.toLowerCase().includes(compileFindQuery))
        )
        .slice(0, 40)
    : [];

  // Scroll the board to a verse's card and flash it. In Outline the verse's
  // theme section may be collapsed (its card not mounted), so open the matching
  // color section(s) first; the rAF retry waits for the card before scrolling.
  const compileFlashAndScroll = (ref: string, tries = 0) => {
    const box = scribalSwapRef.current;
    const el = box
      ? (box.querySelector(`[data-vref="${ref}"]`) as HTMLElement | null)
      : null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("qf-flash");
      window.setTimeout(() => el.classList.remove("qf-flash"), 1400);
      return;
    }
    if (tries < 14)
      requestAnimationFrame(() => compileFlashAndScroll(ref, tries + 1));
  };
  const compileScrollToVerse = (ref: string) => {
    if (compileView === "outline") {
      const colors: number[] = Array.from(
        new Set(
          effectiveMarks.filter((m) => m.reference === ref).map((m) => m.color)
        )
      );
      if (colors.length)
        setCompileCollapsed((prev) => prev.filter((c) => !colors.includes(c)));
    }
    compileFlashAndScroll(ref);
  };
  const effectiveTags =
    compileStudy && studyRefSet
      ? wordTags.filter((t) => studyRefSet.has(t.reference))
      : studyScopeSet && extrasSet
      ? wordTags.filter(
          (t) =>
            studyScopeSet.has(scopeOfRef(t.reference)) ||
            extrasSet.has(t.reference)
        )
      : wordTags;

  // The per-chapter (group-aware) theme name for any verse — used by search.
  const labelFor = (reference: string, color: MarkColor | null) =>
    color == null
      ? ""
      : scopedLabels[resolveScope(scopeOfRef(reference))]?.[color] || "";

  const usedColors = COLORS.filter((c) =>
    marks.some((m) => activeChapterRefs.has(m.reference) && m.color === c)
  );
  // The color legend shows the study's established themes on a linked chapter
  // (so a blank linked chapter still shows the shared palette), otherwise just
  // the colors used in this chapter.
  const legendColors = isLinkedChapter
    ? establishedThemes.map((t) => t.color)
    : usedColors;

  // Reopen a recorded chapter/linked study. Opening it must NOT disturb the
  // tabs already on screen and must NOT flood the workspace: a linked study of
  // many chapters contributes a SINGLE representative chapter tab (the first in
  // scripture order), appended to whatever is already open (capped at 7). The
  // notes still compile the study's FULL scope via synthetic compile tabs, so
  // nothing is lost by leaving the other chapters closed.
  const openRecordedStudy = (s: Study) => {
    setStudiesOpen(false);
    const scopes =
      s.type === "linked"
        ? // Prefer the snapshot saved WITH the study; only fall back to live
          // chapterGroups for old studies saved before memberScopes existed.
          // This is the fix for "opens with one chapter" and "nothing shows on
          // another device" — both were live-chapterGroups being incomplete.
          s.memberScopes && s.memberScopes.length
          ? s.memberScopes
          : Object.keys(chapterGroups).filter(
              (c) => chapterGroups[c] === s.scopeRef
            )
        : [s.scopeRef];
    const locs = (
      scopes.map((sc) => chapterLoc.get(sc)).filter(Boolean) as {
        volume: number;
        book: number;
        chapter: number;
      }[]
    ).sort(
      (a, b) => a.volume - b.volume || a.book - b.book || a.chapter - b.chapter
    );
    if (!locs.length) return;
    if (s.bookId !== activeBookId) setActiveBook(s.bookId);
    // Keyword searches linked into this study's scope (a combined study) reopen
    // alongside as their own tab (their verses fold into the compile by scope).
    const scopeKeys = new Set(scopes.map((sc) => resolveScope(sc)));
    const linkedKw = searchStudies.filter(
      (ks) =>
        !isSearchStudyDeleted(ks) &&
        ks.linkedScope &&
        scopeKeys.has(resolveScope(ks.linkedScope))
    );
    // Just ONE chapter represents the study in the reading panels; append it
    // (and any linked keyword panels) to the existing tabs without replacing.
    const firstLoc = locs[0];
    const repId = makeTabId(
      s.bookId,
      firstLoc.volume,
      firstLoc.book,
      firstLoc.chapter
    );
    const roomForRep = tabs.some((t) => t.id === repId) || tabs.length < 7;
    setTabs((prev) => {
      let next = prev;
      const add = (tab: Tab) => {
        if (!next.some((t) => t.id === tab.id) && next.length < 7)
          next = [...next, tab];
      };
      add({
        id: repId,
        volume: firstLoc.volume,
        book: firstLoc.book,
        chapter: firstLoc.chapter,
        bookId: s.bookId,
      });
      linkedKw.forEach((ks) => {
        const loc = ks.refs.length ? refLoc.get(ks.refs[0]) : undefined;
        add({
          id: "studytab_" + ks.id,
          volume: loc ? loc.volume : 0,
          book: loc ? loc.book : 0,
          chapter: loc ? loc.chapter : 0,
          bookId: ks.bookId,
          studyId: ks.id,
        });
      });
      return next;
    });
    if (roomForRep) setActiveTabId(repId);
    // Reopen on the view this study was saved in (Relational, Distilled, …)
    // instead of whatever view happened to be on screen.
    setCompileView(s.view ?? "outline");
    // The compile covers every chapter in the study, even the ones we didn't
    // open as tabs — build synthetic compile tabs (scripture order) exactly the
    // way a linked/keyword compile does, so the notes stay complete.
    const virtualTabs: Tab[] = locs.map((loc) => ({
      id: makeTabId(s.bookId, loc.volume, loc.book, loc.chapter),
      volume: loc.volume,
      book: loc.book,
      chapter: loc.chapter,
      bookId: s.bookId,
    }));
    const tabIds = virtualTabs.map((t) => t.id);
    // Jump straight to the notes (no gather animation). If the study has no
    // marks yet, there are no notes to show, so just leave the chapter in the
    // reading panel so the user can start marking.
    const scopeSet = scopesFromTabIds(tabIds);
    const hasMarks = getBook(s.bookId).marks.some((m) =>
      scopeSet.has(scopeOfRef(m.reference))
    );
    if (hasMarks) {
      runCompile(tabIds, false);
      // Title the notes with the study's own name. runCompile derives a name
      // from the OPEN tabs, but only one chapter is open here, so set it directly.
      setCompileName(s.name);
      // Only a linked group needs virtual tabs (its other chapters aren't open);
      // a single chapter is already the one open tab.
      if (locs.length > 1) setCompileVirtualTabs(virtualTabs);
    } else {
      setMode("read");
    }
  };

  // ---- keyword (search) studies ----
  // Open a study as its own tab — desktop is tab-based, not a full-screen screen.
  // Appends to whatever is already open (never replaces), capped at 7 tabs. Pass
  // landInReading to jump to the reading panel (opening one from the Studies
  // list); other callers keep whatever view they were in.
  const openStudyTab = (study: SearchStudy, landInReading = false) => {
    setStudiesOpen(false);
    const loc = study.refs.length ? refLoc.get(study.refs[0]) : undefined;
    const tabId = "studytab_" + study.id;
    const tab = {
      id: tabId,
      volume: loc ? loc.volume : 0,
      book: loc ? loc.book : 0,
      chapter: loc ? loc.chapter : 0,
      bookId: study.bookId,
      studyId: study.id,
    };
    const room = tabs.some((t) => t.id === tabId) || tabs.length < 7;
    setTabs((prev) =>
      prev.some((t) => t.id === tabId)
        ? prev
        : prev.length < 7
        ? [...prev, tab]
        : prev
    );
    if (room) setActiveTabId(tabId);
    // Reopen on the view this study was saved in, so a relational keyword study
    // lands on Relational instead of whatever view was last on screen.
    setCompileView(study.view ?? "outline");
    // Opened from the Studies list: show its verses in the reading panel (its
    // notes are one Compile away).
    if (landInReading) setMode("read");
  };
  // "Open as a study": open the selected verses as their own working study tab
  // right away — no naming or book step. Nothing is saved here; the study is
  // saved later, at compile (Save to Studies). Auto-named from the search words,
  // in whatever book is active.
  const onLinkStudy = (refs: string[]) => {
    if (!refs.length) return;
    const ordered = refs.slice().sort((a, b) => orderOfRef(a) - orderOfRef(b));
    setStudyDraftRefs(ordered);
    setStudyDraftName("");
    setStudyDraftBook(activeBookId);
    setStudyDraftNewName("");
    setShowSearch(false);
  };
  const createStudyFromDraft = () => {
    const refs = studyDraftRefs;
    if (!refs || !refs.length) return;
    let bookId = studyDraftBook;
    if (bookId === "__new__") {
      bookId = createSession(
        studyDraftNewName.trim() ||
          studyDraftName.trim() ||
          "Session · " + fmtShortDate(Date.now())
      );
    }
    const study = addStudy(studyDraftName, bookId, refs);
    setStudyDraftRefs(null);
    setStudyDraftBook("master");
    setStudyDraftNewName("");
    openStudyTab(study);
  };

  // Link a keyword search to a chapter at the moment of search — no naming or
  // book step. The search opens as its own tab in the chapter's book, linked so
  // it shares the chapter's themes and folds into the chapter's compile.
  const linkSearchToChapterTab = (refs: string[], label: string, ct: Tab) => {
    if (!refs.length) return;
    const ordered = refs.slice().sort((a, b) => orderOfRef(a) - orderOfRef(b));
    const scope = chapterScopeOf(ct);
    const study = addStudy(label.trim() || "Search", ct.bookId, ordered);
    updateStudy(study.id, { linkedScope: scope });
    setLinkSearchDraft(null);
    setShowSearch(false);
    openStudyTab(study);
  };
  const onLinkSearchToChapter = (refs: string[], label: string) => {
    if (!refs.length) return;
    const ordered = refs.slice().sort((a, b) => orderOfRef(a) - orderOfRef(b));
    // Launched from a chapter's link prompt: the destination chapter is already
    // chosen, so link straight to it (after a mark-collision check) instead of
    // asking which chapter. The standalone search path below is unchanged.
    if (linkSearchTab) {
      const ct = linkSearchTab;
      setShowSearch(false);
      linkGatheredToChapter(ordered, label, ct);
      return;
    }
    // Always confirm in a window — which chapter, even when only one is open.
    setLinkSearchDraft({ refs: ordered, label });
    setShowSearch(false);
  };

  // Link verses gathered from a chapter's link prompt to that chapter. They
  // always arrive unmarked. If any already carry marks in this study's book —
  // where a verse can hold only one set of marks — the clean way to give them a
  // fresh slate is to move the whole study into its own session, so offer that.
  const linkGatheredToChapter = (refs: string[], label: string, ct: Tab) => {
    if (!refs.length) return;
    const bookMarked = new Set(
      allMarks.filter((m) => m.bookId === ct.bookId).map((m) => m.reference)
    );
    const collides = refs.some((r) => bookMarked.has(r));
    if (!collides) {
      linkSearchBesideTab(refs, label, ct);
      return;
    }
    askConfirm({
      title: "Some of these verses are already marked here",
      body:
        "Some of the verses you gathered are already marked in this study\u2019s book, and a verse can only hold one set of marks per book. Move this whole study into a new session book? Your gathered verses start unmarked there, every mark you\u2019ve already made comes with it, and the existing marks on those verses stay where they are.",
      confirmLabel: "Move to a new session",
      onConfirm: () => moveStudyThenLink(refs, label, ct),
    });
  };

  // No collision: create the gathered verses as a keyword study in the study's
  // current book, linked to the chapter, and open it in a tab right beside the
  // chapter it was linked from (mirrors linkSearchToChapterTab, adjacent open).
  const linkSearchBesideTab = (refs: string[], label: string, ct: Tab) => {
    const scope = chapterScopeOf(ct);
    // Open (or insert beside the chapter) the tab for a study and focus it.
    const focusTab = (st: SearchStudy) => {
      const loc = st.refs.length
        ? refLoc.get(st.refs[0])
        : refs.length
        ? refLoc.get(refs[0])
        : undefined;
      const tabId = "studytab_" + st.id;
      setTabs((prev) => {
        if (prev.some((t) => t.id === tabId)) return prev;
        const tab: Tab = {
          id: tabId,
          volume: loc ? loc.volume : 0,
          book: loc ? loc.book : 0,
          chapter: loc ? loc.chapter : 0,
          bookId: st.bookId,
          studyId: st.id,
        };
        const i = prev.findIndex((t) => t.id === ct.id);
        return i < 0
          ? [...prev, tab]
          : [...prev.slice(0, i + 1), tab, ...prev.slice(i + 1)];
      });
      setActiveTabId(tabId);
      setCompileView("outline");
    };
    // A chapter keeps ONE gathered search. If one already exists anywhere in the
    // chapter's group, add the new verses to it (deduped, book order) and focus
    // it, instead of creating a second linked search.
    const gid = chapterGroups[scope];
    const groupScopes = gid
      ? Object.keys(chapterGroups).filter((s) => chapterGroups[s] === gid)
      : [scope];
    const groupSet = new Set(groupScopes.map((s) => resolveScope(s)));
    const existing = searchStudies.find(
      (s) =>
        !isSearchStudyDeleted(s) &&
        !!s.linkedScope &&
        groupSet.has(resolveScope(s.linkedScope))
    );
    if (existing) {
      const merged = Array.from(new Set([...existing.refs, ...refs])).sort(
        (a, b) => orderOfRef(a) - orderOfRef(b)
      );
      updateStudy(existing.id, { refs: merged });
      focusTab(existing);
      return;
    }
    const study = addStudy(label.trim() || "Search", ct.bookId, refs);
    updateStudy(study.id, { linkedScope: scope });
    focusTab(study);
  };

  // Collision: move the whole study (this chapter, or its linked group) into a
  // fresh session so the gathered verses can be marked cleanly, carrying the
  // marks already made — exactly as confirmMoveStudy moves a study. The marks
  // already on the gathered verses (in other chapters) stay behind in the old
  // book, untouched.
  const moveStudyThenLink = (refs: string[], label: string, ct: Tab) => {
    const cs = chapterScopeOf(ct);
    const gid = chapterGroups[cs];
    const groupScopes = gid
      ? Object.keys(chapterGroups).filter((s) => chapterGroups[s] === gid)
      : [cs];
    const scope = resolveScope(cs);
    // The study's OWN marked verses in its current book (not the gathered ones).
    const studyRefs = Array.from(
      new Set(
        allMarks
          .filter(
            (m) =>
              m.bookId === ct.bookId &&
              groupScopes.indexOf(scopeOfRef(m.reference)) !== -1
          )
          .map((m) => m.reference)
      )
    );
    const newBook = createSession("Session \u00b7 " + fmtShortDate(Date.now()));
    moveStudyMarks(ct.bookId, newBook, studyRefs, scope);
    // Re-point any saved study for this chapter/group at the new book.
    setRecordedStudies((prev) =>
      prev.map((s) => {
        if (isStudyDeleted(s) || s.bookId !== ct.bookId) return s;
        const match =
          (s.type === "chapter" && groupScopes.indexOf(s.scopeRef) !== -1) ||
          (s.type === "linked" && s.scopeRef === gid);
        return match ? { ...s, bookId: newBook, compiledAt: Date.now() } : s;
      })
    );
    // The gathered verses become a keyword study in the new session, unmarked.
    const study = addStudy(label.trim() || "Search", newBook, refs);
    updateStudy(study.id, { linkedScope: cs });
    setActiveBook(newBook);
    openStudyTab(study);
  };

  // Move a study to a different session book, taking its marks (and notes, theme
  // names, relational pair) with it and clearing them from the old book — for
  // giving a study its own dedicated book. Works for chapter, linked, and keyword
  // studies. If the destination already has marks, confirm first and name what's
  // there.
  const confirmMoveStudy = () => {
    if (!moveTarget) return;
    const t = moveTarget;
    const runMove = (bookId: string) => {
      if (bookId !== t.bookId) {
        moveStudyMarks(t.bookId, bookId, t.refs, t.scope);
        if (t.kind === "keyword") updateStudy(t.id, { bookId });
        else
          setRecordedStudies((prev) =>
            prev.map((s) =>
              s.id === t.id ? { ...s, bookId, compiledAt: Date.now() } : s
            )
          );
      }
      setMoveTarget(null);
      setMoveStudyBook("master");
      setMoveStudyNewName("");
    };

    // A brand-new session is empty, so nothing can collide — move straight in.
    if (moveStudyBook === "__new__") {
      runMove(
        createSession(
          moveStudyNewName.trim() || "Session · " + fmtShortDate(Date.now())
        )
      );
      return;
    }

    const target = moveStudyBook;
    if (target === t.bookId) {
      setMoveTarget(null);
      return;
    }

    // What's already marked in the destination, and which studies those marks
    // belong to, so moving into an in-use book is a deliberate choice.
    const tMarks = allMarks.filter((m) => m.bookId === target);
    const markedRefs = new Set(tMarks.map((m) => m.reference));
    if (markedRefs.size === 0) {
      runMove(target);
      return;
    }
    const owners: string[] = [];
    searchStudies.forEach((s) => {
      if (s.bookId !== target || (t.kind === "keyword" && s.id === t.id)) return;
      if (s.refs.some((r) => markedRefs.has(r))) owners.push(s.name);
    });
    recordedStudies.forEach((s) => {
      if (s.bookId !== target || s.id === t.id) return;
      const chs =
        s.type === "linked"
          ? Object.keys(chapterGroups).filter(
              (c) => chapterGroups[c] === s.scopeRef
            )
          : [s.scopeRef];
      if (tMarks.some((m) => chs.includes(scopeOfRef(m.reference))))
        owners.push(s.name);
    });

    const targetName =
      target === "master"
        ? "Master Book"
        : books.find((b) => b.id === target)?.name || "this session";
    const belongs = owners.length
      ? " Those marks belong to: " + owners.join(", ") + "."
      : "";
    setMoveTarget(null);
    askConfirm({
      title: targetName + " already has marks",
      body:
        targetName +
        " already has " +
        markedRefs.size +
        " marked verse" +
        (markedRefs.size === 1 ? "" : "s") +
        "." +
        belongs +
        ' Moving "' +
        t.name +
        '" here keeps both sets of marks together, or migrate it to a brand-new book to keep it on its own.',
      confirmLabel: "Move here",
      onConfirm: () => runMove(target),
      secondaryLabel: "Migrate to a new book instead",
      onSecondary: () =>
        runMove(
          createSession(
            moveStudyNewName.trim() ||
              "Session \u00b7 " + fmtShortDate(Date.now())
          )
        ),
    });
  };

  // Add verses to an existing keyword/imported study, or fork a new copy with the
  // additions. The selection IS the full new verse set (the study's verses are
  // pre-checked in the panel), so we just write it. Refs edits sync across
  // devices via updatedAt; a copy syncs as a brand-new study.
  const handleAddToStudy = (refs: string[], mode: "update" | "copy") => {
    const id = addToStudyId;
    setAddToStudyId(null);
    setShowSearch(false);
    if (!refs.length) return;
    const study = searchStudies.find((s) => s.id === id);
    if (!study) return;
    const ordered = refs.slice().sort((a, b) => orderOfRef(a) - orderOfRef(b));
    if (mode === "copy") {
      const copy = addStudy(study.name + " (copy)", study.bookId, ordered);
      openStudyTab(copy);
    } else {
      updateStudy(study.id, { refs: ordered });
      openStudyTab(study);
    }
  };

  // Send loose verses (picked in a reading panel) into an existing keyword study,
  // MERGING them with whatever the study already holds rather than replacing —
  // the panel selection is only the additions, so the union is the new verse set.
  // When `migrate` is true the study is given its own brand-new session book and
  // its marks/notes/theme-names travel there (same path as "move to a new book"),
  // otherwise the study stays in its current book.
  // ---- Send verses to a study table's shelf ("stored verses") ----
  // Verses arrive as scripture cards carrying the currently active book, so the
  // shelf shows them with the same marks the reader sees. They land in the
  // table's "Selected" tab, ready to be placed into a column later.
  const tableShelfCards = (refs: string[]): TableCard[] =>
    refs.map((r) => ({
      id: newCardId(),
      kind: "scripture" as const,
      refs: [r],
      bookId: activeBookId,
      // Their own dropdown in Selected — same on desktop and mobile.
      shelfGroup: "Sent from reading",
    }));
  const sendVersesToTableShelf = (tableId: string, refs: string[]) => {
    const t = studyTables.find((x) => x.id === tableId);
    if (!t || refs.length === 0) return;
    updateStudyTable(tableId, {
      shelf: [...(t.shelf || []), ...tableShelfCards(refs)],
    });
    setShareMsg(
      (refs.length === 1 ? "Verse" : refs.length + " verses") +
        " set aside in \u201C" +
        (t.name || "table") +
        "\u201D"
    );
    setTimeout(() => setShareMsg(null), 2200);
  };
  // "New study table" from the send sheet: create it with these verses already
  // on its shelf, then open it so they can be placed.
  const sendVersesToNewTable = (refs: string[]) => {
    const id = createStudyTable("Untitled", undefined, activeBookId);
    if (refs.length) updateStudyTable(id, { shelf: tableShelfCards(refs) });
    setOpenTableId(id);
    setMode("table");
  };

  const sendToExistingStudy = (
    study: SearchStudy,
    refs: string[],
    migrate: boolean
  ) => {
    if (!refs.length) return;
    const merged = Array.from(new Set([...study.refs, ...refs])).sort(
      (a, b) => orderOfRef(a) - orderOfRef(b)
    );
    if (migrate) {
      const newBook = createSession(
        study.name.trim() || "Session \u00b7 " + fmtShortDate(Date.now())
      );
      moveStudyMarks(study.bookId, newBook, merged, "searchstudy:" + study.id);
      updateStudy(study.id, { bookId: newBook, refs: merged });
      // Re-point an already-open tab for this study at the new book so it shows
      // the migrated marks instead of the now-emptied source book.
      setTabs((prev) =>
        prev.map((t) =>
          t.studyId === study.id ? { ...t, bookId: newBook } : t
        )
      );
      openStudyTab({ ...study, bookId: newBook, refs: merged });
    } else {
      updateStudy(study.id, { refs: merged });
      openStudyTab({ ...study, refs: merged });
    }
  };
  // "Remove verses" on a study panel: drop the chosen references from the
  // study's verse list. Their marks stay in the book; an open tab updates
  // live. Emptying a study just leaves it with no verses.
  const removeVersesFromStudy = (studyId: string, refs: string[]) => {
    if (!refs.length) return;
    const study = searchStudies.find((s) => s.id === studyId);
    if (!study) return;
    const drop = new Set(refs);
    updateStudy(studyId, { refs: study.refs.filter((r) => !drop.has(r)) });
  };
  // Display name for a study's book in the send picker.
  const bookLabel = (bookId: string) => {
    const b = books.find((x) => x.id === bookId);
    return b ? (b.isMaster ? "Master Book" : b.name || "Session") : "Session";
  };

  // Add loose verses to a recorded chapter/linked study (its extraRefs), then
  // jump to the first added verse in read mode so they can be marked. A banner
  // (rendered below) offers to compile the study once they're marked.
  const handleAddVersesToRec = (refs: string[]) => {
    const rid = addVersesRecId;
    setAddVersesRecId(null);
    setShowSearch(false);
    if (!rid) return;
    const study = recordedStudies.find((s) => s.id === rid);
    if (!study) return;
    const ordered = refs.slice().sort((a, b) => orderOfRef(a) - orderOfRef(b));
    const at = Date.now();
    setRecordedStudies((prev) =>
      prev.map((s) =>
        s.id === rid
          ? { ...s, extraRefs: ordered, extraRefsAt: at, compiledAt: at }
          : s
      )
    );
    if (ordered.length) {
      if (study.bookId !== activeBookId) setActiveBook(study.bookId);
      setMarkVersesStudyId(rid);
    } else {
      setMarkVersesStudyId(null);
    }
  };

  // ---- ScriptureNotes import: PDF report (or pasted text) -> a Search Study ----
  const openSnImport = () => {
    setSnParsed(null);
    setSnErr("");
    setSnName("");
    setSnText("");
    setSnPaste(false);
    setSnBusy(false);
    setSnImportOpen(true);
  };
  const applyParsed = (parsed: ParsedImport, rawForDiag?: string) => {
    if (!parsed.verses.length && !parsed.unmatched.length) {
      const preview = (rawForDiag || "").replace(/\s+/g, " ").trim().slice(0, 240);
      setSnErr(
        rawForDiag
          ? "Couldn't find verses in that PDF. You can paste the report text instead — use “Paste text” below." +
              (preview
                ? "\n\nWhat the PDF reader saw: " + preview + "…"
                : "\n\nThe PDF reader couldn't read any text from it.")
          : "Couldn't find any verses in that text. Paste the whole report, including the verse lines."
      );
      return;
    }
    setSnParsed(parsed);
    setSnName(parsed.title || "Imported study");
    setSnErr("");
  };
  const handleSnFile = async (file: File | null | undefined) => {
    if (!file) return;
    setSnErr("");
    setSnParsed(null);
    setSnBusy(true);
    try {
      const text = await extractPdfText(file);
      applyParsed(parseScriptureNotes(text), text);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't read that PDF.";
      setSnErr(msg);
    } finally {
      setSnBusy(false);
    }
  };
  const handleSnPaste = () => {
    setSnErr("");
    applyParsed(parseScriptureNotes(snText));
  };
  const commitSnImport = () => {
    if (!snParsed || !snParsed.verses.length) return;
    const parts: string[] = [];
    if (snParsed.description) parts.push(snParsed.description);
    if (snParsed.favorites.length)
      parts.push("★ Favorites: " + snParsed.favorites.join(", "));
    const note = parts.join("\n\n");

    // Highlight every imported verse so the collection actually populates the
    // compile/Outline (which groups marked verses into themes by color).
    const markItems = snParsed.verses
      .map((ref) => {
        const text = verseTextOf(ref);
        if (!text) return null;
        return {
          reference: ref,
          verseText: text,
          markedText: text,
          startIndex: 0,
          endIndex: text.length,
          style: "highlight" as MarkStyle,
          color: 1 as MarkColor,
        };
      })
      .filter(
        (
          m
        ): m is {
          reference: string;
          verseText: string;
          markedText: string;
          startIndex: number;
          endIndex: number;
          style: MarkStyle;
          color: MarkColor;
        } => m != null
      );
    // Give the import its OWN book so its highlights never bleed into master
    // or into other studies that happen to share verses. createSession makes the
    // new book active, so the marks, theme label, and synthesis written below
    // all land in it; opening the study tab (further down) keeps it active.
    const importBookId = createSession(snName.trim() || "Imported study");
    if (markItems.length) addMarks(markItems);

    const study = addStudy(
      snName.trim() || "Imported study",
      importBookId,
      snParsed.verses,
      note
    );

    // Name the single theme and seed the synthesis (shown at the top of the
    // Outline) with the report's note, keyed exactly as the compile views key it.
    const scope = "searchstudy:" + study.id;
    setScopedLabel(scope, 1, "Verses");
    if (note.trim()) {
      const seen = new Set<string>();
      const labels: string[] = [];
      snParsed.verses.forEach((r) => {
        const loc = refLoc.get(r);
        if (!loc) return;
        const key = loc.volume + ":" + loc.book + ":" + loc.chapter;
        if (seen.has(key)) return;
        seen.add(key);
        labels.push(
          vols[loc.volume].books[loc.book].book +
            " " +
            vols[loc.volume].books[loc.book].chapters[loc.chapter].chapter
        );
      });
      const synthKey = "synthesis|" + labels.join("+");
      setNote(synthKey, note);
    }

    openStudyTab(study);
    setSnImportOpen(false);
    setSnParsed(null);
    setSnName("");
    setSnText("");
    setSnPaste(false);
    setSnErr("");
    setStudiesOpen(false);
    setCompileView("outline");
    startStudyCompile(study);
  };
  // Deleting a study also closes any tab that was showing it.
  const removeStudy = (id: string) => {
    deleteStudy(id);
    setTabs((prev) => {
      const next = prev.filter((t) => t.studyId !== id);
      if (next.length === prev.length) return prev;
      if (next.length === 0) {
        const fb = {
          id: makeTabId("master", 0, 0, 0),
          volume: 0,
          book: 0,
          chapter: 0,
          bookId: "master",
        };
        setActiveTabId(fb.id);
        return [fb];
      }
      if (!next.some((t) => t.id === activeTabId))
        setActiveTabId(next[next.length - 1].id);
      return next;
    });
  };

  const handlePrintLive = () => {
    if (effectiveCompileTabs.length === 0) {
      alert("Nothing to print yet.");
      return;
    }
    const first = compileStudy
      ? compileStudy.name
      : effectiveCompileTabs[0]
      ? tabLabel(effectiveCompileTabs[0])
      : "";
    const extra =
      !compileStudy && effectiveCompileTabs.length > 1
        ? " +" + (effectiveCompileTabs.length - 1)
        : "";
    loadWebster();
    setPrintData({
      view: compileView,
      title: VIEW_NAMES[compileView] + " — " + first + extra,
      compileTabs: effectiveCompileTabs,
      marks: effectiveMarks,
      colorLabels: effectiveScopedLabels,
      notes,
      tags: effectiveTags,
    });
  };

  const exportData = () => {
    try {
      const blob = new Blob([syncBuildBackupString(BACKUP_KEYS, true)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        "scribal-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Could not create the backup file.");
    }
    setBackupOpen(false);
  };

  const importData = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        applyBackupString(String(reader.result));
        window.location.reload();
      } catch {
        alert("That file couldn't be read as a Scribal backup.");
      }
    };
    reader.readAsText(file);
  };

  // ---- Google Drive sync ----
  const driveReady = () => {
    if (GOOGLE_CLIENT_ID.indexOf("PASTE_") === 0) {
      setDriveMsg("Add your Google client ID in App.tsx first.");
      return false;
    }
    return true;
  };

  const connectDrive = async () => {
    if (!driveReady()) return;
    setDriveMsg("Connecting…");
    try {
      await drive.connect(GOOGLE_CLIENT_ID);
      localStorage.setItem("scribal_drive_enabled", "1");
      setDriveConnected(true);
      setDriveMsg("Connected to Google Drive.");
    } catch (e: any) {
      setDriveMsg("Sign-in failed: " + (e && e.message ? e.message : "unknown"));
    }
  };

  // One-look diagnostic: compares what THIS device has vs what's in the cloud.
  const runDiag = async () => {
    const localMarks = countBookMarksFromJson(
      localStorage.getItem("scribal_books_v1")
    );
    const seen = localStorage.getItem("scribal_sync_seen") || "(never)";
    setDiag("Desktop: " + localMarks + " marks. Checking cloud…");
    try {
      const text = await withFreshToken((tok) => drive.loadData(tok));
      if (!text) {
        setDiag(
          "Desktop has " +
            localMarks +
            " marks.\nCloud: NO file found for this account."
        );
        return;
      }
      const p = JSON.parse(text);
      const cloudMarks = countBookMarksFromJson(booksFromBackup(text));
      setDiag(
        "Desktop: " +
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

  const saveToDrive = async () => {
    if (!driveReady()) return;
    setDriveMsg("Saving…");
    try {
      const res = await pushToDrive();
      if (res === "adopted")
        return; // page is reloading with the newer cloud copy
      if (res === "blocked") {
        setDriveMsg(
          "Skipped — the cloud copy has more than this device. Refresh to pull it first."
        );
        return;
      }
      setDriveMsg(
        res === "pushed"
          ? "Saved to Drive ✓ " + new Date().toLocaleTimeString()
          : "Save failed — try again."
      );
      if (res === "pushed") setLastSync(Date.now());
    } catch (e: any) {
      setDriveMsg("Save failed: " + (e && e.message ? e.message : "unknown"));
    }
  };

  const loadFromDrive = async () => {
    if (!driveReady()) return;
    setDriveMsg("Loading…");
    try {
      const token = drive.getToken() || (await drive.connect(GOOGLE_CLIENT_ID));
      const text = await drive.loadData(token);
      if (!text) {
        setDriveMsg("No saved study found in Drive yet.");
        return;
      }
      applyBackupString(text);
      window.location.reload();
    } catch (e: any) {
      setDriveMsg("Load failed: " + (e && e.message ? e.message : "unknown"));
    }
  };

  // Re-sign-in (used by the "Reconnect to sync" nudge when the token expires)
  const reconnectDrive = async () => {
    setSaveStatus("saving");
    try {
      await drive.connect(GOOGLE_CLIENT_ID);
      const res = await pushToDrive();
      setSaveStatus(res === "fail" ? "stale" : "saved");
      if (res !== "fail") {
        setDriveConnected(true);
        setLastSync(Date.now());
      }
    } catch {
      setSaveStatus("stale");
    }
  };

  // ---- Welcome gate (optional sign-in shown on app open) ----
  const gateContinueGoogle = async () => {
    setGateBusy(true);
    setGateMsg("Connecting…");
    try {
      await cloudSignIn();
      sessionStorage.setItem("scribal_gate_done", "1");
      setGateOpen(false);
    } catch (e: any) {
      setGateBusy(false);
      setGateMsg(
        "Sign-in failed: " + (e && e.message ? e.message : "try again")
      );
    }
  };

  const gateSkip = () => {
    localStorage.setItem("scribal_skip_welcome", "1");
    setGateOpen(false);
  };

  const handleNewSession = () => {
    newSessionForActiveTab();
    setBookMenuOpen(false);
  };
  const startEditBook = (id: string, name: string) => {
    setEditingBookId(id);
    setEditDraft(name);
  };
  const saveEditBook = () => {
    if (editingBookId) {
      renameBook(editingBookId, editDraft.trim() || "Untitled session");
      setEditingBookId(null);
      setEditDraft("");
    }
  };
  const handleDeleteBook = (b: { id: string; name: string }) => {
    askConfirm({
      title: "Delete this session?",
      body:
        'Delete "' + b.name + "\" and all of its markings? This can't be undone.",
      onConfirm: () => deleteBook(b.id),
    });
  };

  // ---- header control helpers ----
  const vDivider = (
    <div
      style={{
        width: "1px",
        height: "24px",
        backgroundColor: "var(--border)",
        flexShrink: 0,
      }}
    />
  );

  const actionButton = (
    label: string,
    onClick: () => void,
    primary?: boolean
  ) => (
    <button
      onClick={onClick}
      style={{
        height: "40px",
        padding: "0 20px",
        backgroundColor: primary ? ICON_ACCENT : "transparent",
        color: primary ? "#fff" : "var(--text)",
        border: primary ? "none" : "1px solid var(--border)",
        borderRadius: "999px",
        cursor: "pointer",
        fontSize: "14.5px",
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        whiteSpace: "nowrap",
        transition: "all 0.15s",
      }}
    >
      {label}
    </button>
  );

  const roundUtil = (
    label: React.ReactNode,
    onClick: () => void,
    title: string,
    disabled?: boolean
  ) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: "40px",
        height: "40px",
        borderRadius: "50%",
        border: "1px solid var(--border)",
        backgroundColor: "transparent",
        color: "var(--muted)",
        cursor: disabled ? "default" : "pointer",
        fontSize: "18px",
        lineHeight: 1,
        opacity: disabled ? 0.35 : 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );

  const pillStyle: React.CSSProperties = {
    height: "40px",
    padding: "0 16px",
    borderRadius: "999px",
    border: "1px solid var(--border)",
    backgroundColor: "transparent",
    color: "var(--muted)",
    cursor: "pointer",
    fontSize: "14px",
    display: "flex",
    alignItems: "center",
    gap: "7px",
    flexShrink: 0,
  };

  const readingStepBtn: React.CSSProperties = {
    width: "34px",
    height: "32px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text)",
    fontSize: "14px",
    fontWeight: 700,
    lineHeight: 1,
    fontFamily: "inherit",
  };

  const viewTabButton = (
    active: boolean,
    label: string,
    onClick: () => void
  ) => (
    <button
      onClick={onClick}
      style={{
        padding: "9px 18px",
        border: "none",
        cursor: "pointer",
        fontSize: "13.5px",
        fontWeight: active ? 600 : 400,
        backgroundColor: active ? ICON_ACCENT : "transparent",
        color: active ? "#fff" : "var(--muted)",
        transition: "all 0.15s",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );

  // ---- Save to Studies: the explicit gate for what's listed in Studies ----
  const flashSaved = () => {
    setSavedToStudies(true);
    window.setTimeout(() => setSavedToStudies(false), 2200);
  };

  // The chapter/linked unit currently being compiled (null for keyword studies).
  const getCompileInfo = (idsArg?: string[]) => {
    if (compileStudy) return null;
    const ids =
      idsArg && idsArg.length
        ? idsArg
        : compileSelection.length
        ? compileSelection
        : tabs.map((t) => t.id);
    const unitTabs = tabs.filter((t) => ids.includes(t.id));
    if (!unitTabs.length) return null;
    const gid = chapterGroups[chapterScopeOf(unitTabs[0])];
    const isLinked =
      !!gid && unitTabs.every((t) => chapterGroups[chapterScopeOf(t)] === gid);
    const type: "chapter" | "linked" = isLinked ? "linked" : "chapter";
    const scopeRef = isLinked ? gid : chapterScopeOf(unitTabs[0]);
    const refs: string[] = [];
    unitTabs.forEach((t) => {
      vols[t.volume].books[t.book].chapters[t.chapter].verses.forEach((v) =>
        refs.push(v.reference)
      );
    });
    // The study's true membership = every chapter being compiled (compileTabs
    // includes the virtual tabs for a linked group, not just the one open tab).
    // Snapshot it so the study can reopen without rebuilding from live
    // chapterGroups — the source of the "only one chapter" / "nothing shows on
    // my friend's device" bug.
    const memberScopes = Array.from(
      new Set(
        (compileTabs.length ? compileTabs : unitTabs).map((t) =>
          chapterScopeOf(t)
        )
      )
    );
    return {
      type,
      bookId: activeBookId,
      scopeRef,
      refs,
      memberScopes,
      defaultName: unitTabs.map((t) => tabLabel(t)).join("  +  "),
    };
  };

  const saveToStudies = () => {
    const nm = compileName.trim() || "Untitled study";
    if (compileStudy) {
      renameStudy(compileStudy.id, nm);
      flashSaved();
      return;
    }
    const info = getCompileInfo();
    if (!info) return;
    const existing = recordedStudies.find(
      (s) =>
        s.type === info.type &&
        s.bookId === info.bookId &&
        s.scopeRef === info.scopeRef
    );
    if (existing) {
      setSaveStudyPrompt({ info, existing });
    } else {
      recordStudy(info.type, info.bookId, info.scopeRef, nm, compileView, info.memberScopes);
      flashSaved();
    }
  };

  // Prompt actions when a study for this scope already exists.
  const saveAddToExisting = () => {
    if (!saveStudyPrompt) return;
    const { info, existing } = saveStudyPrompt;
    recordStudy(
      info.type,
      info.bookId,
      info.scopeRef,
      // Keep the name it already has unless the user typed a new one — never
      // silently reset a named study back to the default.
      compileName.trim() || existing.name,
      compileView,
      info.memberScopes
    );
    setSaveStudyPrompt(null);
    flashSaved();
  };

  const saveAsNewKept = () => {
    if (!saveStudyPrompt) return;
    const { info } = saveStudyPrompt;
    const nm = compileName.trim() || info.defaultName;
    const id = createSession(nm);
    absorb(id, info.bookId, info.refs); // copy the current marks into the new book
    setActiveBook(id);
    recordStudy(info.type, id, info.scopeRef, nm, compileView, info.memberScopes);
    setSaveStudyPrompt(null);
    flashSaved();
  };

  const saveAsNewFresh = () => {
    if (!saveStudyPrompt) return;
    const { info } = saveStudyPrompt;
    const nm = compileName.trim() || info.defaultName;
    const id = createSession(nm);
    setActiveBook(id);
    recordStudy(info.type, id, info.scopeRef, nm, compileView, info.memberScopes);
    setSaveStudyPrompt(null);
    setMode("read");
    setCompileStudyId(null);
  };

  // Build a row for every study (chapter, linked, keyword) with live counts and
  // theme names. Shared by the Studies hub and the books Vault.
  const buildStudyRows = (): StudyRow[] => {
    const bookMarksOf = (bid: string) =>
      allMarks.filter((m) => m.bookId === bid);
    // Every reference a study "owns" in its book — marked verses in scope, any
    // verses it carries notes on, plus loose added verses — so a move takes the
    // whole study with it.
    const studyRefsFor = (
      bid: string,
      refOk: (ref: string) => boolean,
      extra?: string[]
    ) => {
      const set = new Set<string>(extra || []);
      bookMarksOf(bid).forEach((m) => {
        if (refOk(m.reference)) set.add(m.reference);
      });
      const bk = getBook(bid);
      Object.keys(bk.notes || {}).forEach((k) => {
        const ref = k.split("|").pop();
        if (ref && refOk(ref)) set.add(ref);
      });
      return Array.from(set);
    };
    const bookLabel = (bid: string) =>
      bid === "master"
        ? ""
        : books.find((b) => b.id === bid)?.name || "Session";
    const fmtDate = (ms: number) =>
      new Date(ms).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    const themesFor = (
      bid: string,
      repScope: string,
      refOk: (ref: string) => boolean
    ) => {
      const bk = getBook(bid);
      const scoped = bk.scopedLabels[resolveScope(repScope)];
      const nameFor = (c: MarkColor) =>
        scoped && c in scoped
          ? (scoped[c] || "").trim()
          : (bk.colorLabels[c] || "").trim();
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
    const markWord = (n: number) => (n === 1 ? " mark" : " marks");
    const withBook = (bl: string) => (bl ? " · " + bl : "");
    const rows: StudyRow[] = [];

    // Chapters/groups that have a keyword search linked to them are combined
    // studies — they show once under Combined, never also as a chapter/linked row.
    const combinedScopes = new Set(
      searchStudies
        .filter((ss) => ss.linkedScope && !isSearchStudyDeleted(ss))
        .map((ss) => resolveScope(ss.linkedScope as string))
    );

    recordedStudies
      .filter((s) => s.type === "chapter")
      .forEach((s) => {
        if (combinedScopes.has(resolveScope(s.scopeRef))) return;
        const refOk = (ref: string) => scopeOfRef(ref) === s.scopeRef;
        const n = bookMarksOf(s.bookId).filter((m) =>
          refOk(m.reference)
        ).length;
        rows.push({
          id: s.id,
          kind: "chapter",
          bookId: s.bookId,
          name: s.name,
          meta:
            n +
            markWord(n) +
            withBook(bookLabel(s.bookId)) +
            " · " +
            fmtDate(s.compiledAt),
          themes: themesFor(s.bookId, s.scopeRef, refOk),
          onMove: () =>
            setMoveTarget({
              id: s.id,
              kind: "chapter",
              bookId: s.bookId,
              name: s.name,
              refs: studyRefsFor(s.bookId, refOk, s.extraRefs),
              scope: resolveScope(s.scopeRef),
            }),
          onOpen: () => openRecordedStudy(s),
          onDelete: () =>
            askConfirm({
              title: "Delete this study?",
              body:
                'Delete "' +
                s.name +
                "\" from your studies? This can't be undone.",
              onConfirm: () => deleteRecordedStudy(s.id),
            }),
        });
      });

    recordedStudies
      .filter((s) => s.type === "linked")
      .forEach((s) => {
        if (combinedScopes.has("group:" + s.scopeRef)) return;
        const chs = Object.keys(chapterGroups).filter(
          (c) => chapterGroups[c] === s.scopeRef
        );
        const refOk = (ref: string) => chs.includes(scopeOfRef(ref));
        const n = bookMarksOf(s.bookId).filter((m) =>
          refOk(m.reference)
        ).length;
        rows.push({
          id: s.id,
          kind: "linked",
          bookId: s.bookId,
          name: s.name,
          meta:
            n +
            markWord(n) +
            withBook(bookLabel(s.bookId)) +
            " · " +
            fmtDate(s.compiledAt),
          themes: themesFor(s.bookId, chs[0] || s.scopeRef, refOk),
          onMove: () =>
            setMoveTarget({
              id: s.id,
              kind: "linked",
              bookId: s.bookId,
              name: s.name,
              refs: studyRefsFor(s.bookId, refOk, s.extraRefs),
              scope: "group:" + s.scopeRef,
            }),
          onOpen: () => openRecordedStudy(s),
          onDelete: () =>
            askConfirm({
              title: "Delete this study?",
              body:
                'Delete "' +
                s.name +
                "\" from your studies? This can't be undone.",
              onConfirm: () => deleteRecordedStudy(s.id),
            }),
        });
      });

    // Standalone keyword searches → their own Keyword rows.
    searchStudies
      .filter((ss) => !ss.linkedScope)
      .forEach((ss) => {
        const refSet = new Set(ss.refs);
        const refOk = (ref: string) => refSet.has(ref);
        rows.push({
          id: ss.id,
          kind: "keyword",
          bookId: ss.bookId,
          name: ss.name,
          meta:
            ss.refs.length +
            " verses" +
            withBook(bookLabel(ss.bookId)) +
            " · " +
            fmtDate(ss.createdAt),
          themes: themesFor(ss.bookId, "searchstudy:" + ss.id, refOk),
          onOpen: () => {
            // The opening rule, same as everywhere else: a study with marks
            // opens straight to its notes; only an unmarked one lands in
            // reading. (openStudyTab already restores the saved view.)
            const bk = getBook(ss.bookId);
            const marked = ss.refs.some((r) =>
              bk.marks.some((m) => m.reference === r)
            );
            openStudyTab(ss, !marked);
            // Compiling is what actually points the notes at THIS study. A bare
            // setMode("compile") left compileStudyId on whatever was compiled
            // last — the "opens a different study / blank notes" bug. Route a
            // combined (linked) search through its chapter, a standalone one
            // straight to its own compile.
            if (marked) {
              // Reopening from the list → straight to notes, no gather anim.
              if (ss.linkedScope) compileLinkedSearch(ss, false);
              else startStudyCompile(ss, false);
            }
          },
          onAddVerses: () => {
            setAddToStudyId(ss.id);
            setShowSearch(true);
          },
          onMove: () =>
            setMoveTarget({
              id: ss.id,
              kind: "keyword",
              bookId: ss.bookId,
              name: ss.name,
              refs: ss.refs,
              scope: "searchstudy:" + ss.id,
            }),
          onDelete: () =>
            askConfirm({
              title: "Delete this study?",
              body:
                'Delete "' +
                ss.name +
                "\" from your studies? This can't be undone.",
              onConfirm: () => removeStudy(ss.id),
            }),
        });
      });

    // Combined studies: a chapter and the keyword search(es) linked to it collapse
    // into ONE listing under Combined (never also a chapter/linked row). Name is
    // the saved study name if it was compiled/saved, else a default of the chapter.
    const combinedByScope = new Map<string, SearchStudy[]>();
    searchStudies
      .filter((ss) => ss.linkedScope && !isSearchStudyDeleted(ss))
      .forEach((ss) => {
        const sc = resolveScope(ss.linkedScope as string);
        const arr = combinedByScope.get(sc) || [];
        arr.push(ss);
        combinedByScope.set(sc, arr);
      });
    combinedByScope.forEach((group, sc) => {
      const primary = group[0];
      const loc = chapterLoc.get(primary.linkedScope as string);
      const chapterName = loc
        ? vols[loc.volume].books[loc.book].book +
          " " +
          vols[loc.volume].books[loc.book].chapters[loc.chapter].chapter
        : null;
      // A recorded chapter/linked study at this scope means it was compiled +
      // named; use that name, otherwise fall back to the chapter name.
      const rec = recordedStudies.find(
        (s) =>
          !isStudyDeleted(s) &&
          ((s.type === "chapter" && resolveScope(s.scopeRef) === sc) ||
            (s.type === "linked" && "group:" + s.scopeRef === sc))
      );
      const title = (rec && rec.name) || chapterName || primary.name;
      const refSet = new Set(group.flatMap((g) => g.refs));
      const refOk = (ref: string) => refSet.has(ref);
      const terms = group.map((g) => '"' + g.name + '"').join(", ");
      rows.push({
        id: "combined:" + sc,
        kind: "combined",
        bookId: primary.bookId,
        name: title,
        meta:
          terms +
          " · " +
          refSet.size +
          " verses" +
          withBook(bookLabel(primary.bookId)),
        themes: themesFor(primary.bookId, "searchstudy:" + primary.id, refOk),
        onOpen: () => {
          // Same opening rule as standalone searches: marked → its notes
          // (compiled through the chapter for a combined study), unmarked →
          // reading. A bare openStudyTab left the notes on the last-compiled
          // study.
          const bk = getBook(primary.bookId);
          const marked = primary.refs.some((r) =>
            bk.marks.some((m) => m.reference === r)
          );
          if (marked) {
            openStudyTab(primary);
            if (primary.linkedScope) compileLinkedSearch(primary, false);
            else startStudyCompile(primary, false);
          } else {
            openStudyTab(primary, true);
          }
        },
        onAddVerses: () => {
          setAddToStudyId(primary.id);
          setShowSearch(true);
        },
        onDelete: () =>
          askConfirm({
            title: "Delete this combined study?",
            body:
              "Delete this combined study? The linked keyword " +
              (group.length === 1 ? "search" : "searches") +
              " will be removed. This can't be undone.",
            onConfirm: () => group.forEach((g) => removeStudy(g.id)),
          }),
      });
    });


    return rows;
  };

  // One-time: migrate old saved Vault snapshots into the live Studies list, so
  // nothing is lost when the Vault becomes the session-books browser.
  useEffect(() => {
    if (localStorage.getItem("scribal_vault_migrated_v1")) return;
    const recs: Study[] = [];
    entries.forEach((e) => {
      if (!e || e.deleted) return;
      let type: "chapter" | "linked";
      let scopeRef: string;
      if (e.scopeKey) {
        if (e.scopeKey.indexOf("searchstudy:") === 0) return;
        type = e.scopeKey.indexOf("group:") === 0 ? "linked" : "chapter";
        scopeRef =
          type === "linked" ? e.scopeKey.slice("group:".length) : e.scopeKey;
      } else if (e.compileTabs && e.compileTabs.length === 1) {
        type = "chapter";
        scopeRef = chapterScopeOf(e.compileTabs[0]);
      } else {
        return; // can't safely map a multi-chapter snapshot without a scope key
      }
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
      setRecordedStudies((prev) => {
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
  }, [books, entries, setRecordedStudies]);

  // Drop studies whose book no longer exists (any delete path).
  useEffect(() => {
    const ids = new Set(books.map((b) => b.id));
    setRecordedStudies((prev) => {
      const keep = prev.filter((s) => ids.has(s.bookId));
      return keep.length === prev.length ? prev : keep;
    });
    setSearchStudies((prev) => {
      const keep = prev.filter((ss) => ids.has(ss.bookId));
      return keep.length === prev.length ? prev : keep;
    });
  }, [books, setRecordedStudies, setSearchStudies]);

  const sharedCompileProps = {
    tabs: compileStudy ? effectiveCompileTabs : tabs,
    compileTabs: effectiveCompileTabs,
    compileSelection: compileStudy
      ? effectiveCompileTabs.map((t) => t.id)
      : compileSelection,
    onToggleCompileTab: toggleCompileTab,
    hideTabPicker: true,
    marks: effectiveMarks,
    colorLabels: effectiveScopedLabels,
    setColorLabel: (c: MarkColor, l: string) =>
      setScopedLabel(effectiveScope, c, l),
    onJumpToReference: jumpToReference,
  };

  return (
    <div
      style={
        {
          ...theme,
          "--hb": dark ? "1.18" : "0.95",
          minHeight: "100vh",
          backgroundColor: "var(--bg)",
          color: "var(--text)",
          transition: "background-color 0.25s, color 0.25s",
        } as React.CSSProperties
      }
    >
      <SplashScreen />
      {gateOpen && (
        <div
          className="scribal-fade-plain"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            backgroundColor: "var(--bg)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            textAlign: "center",
          }}
        >
          <div style={{ maxWidth: "360px", width: "100%" }}>
            <h1
              style={{
                fontSize: "30px",
                margin: "0 0 6px",
                color: "var(--text)",
              }}
            >
              Scribal
            </h1>
            <p
              style={{
                color: "var(--muted)",
                fontSize: "14px",
                lineHeight: 1.5,
                margin: "0 0 28px",
              }}
            >
              Sign in with Google to save and sync your study across devices, or
              continue without signing in to study on this device only.
            </p>

            <button
              onClick={gateContinueGoogle}
              disabled={gateBusy}
              style={{
                width: "100%",
                padding: "13px 16px",
                borderRadius: "10px",
                border: "none",
                backgroundColor: ICON_ACCENT,
                color: "#fff",
                fontSize: "15px",
                fontWeight: 600,
                cursor: gateBusy ? "default" : "pointer",
                opacity: gateBusy ? 0.6 : 1,
                marginBottom: "10px",
              }}
            >
              {gateBusy ? "Please wait…" : "Continue with Google"}
            </button>

            <button
              onClick={gateSkip}
              disabled={gateBusy}
              style={{
                width: "100%",
                padding: "13px 16px",
                borderRadius: "10px",
                border: "1px solid var(--border)",
                backgroundColor: "transparent",
                color: "var(--text)",
                fontSize: "15px",
                cursor: gateBusy ? "default" : "pointer",
              }}
            >
              Continue without signing in
            </button>

            <button
              onClick={() => {
                setGateOpen(false);
                setExampleOpen(true);
              }}
              style={{
                marginTop: "16px",
                background: "transparent",
                border: "none",
                color: ICON_ACCENT,
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              See how Scribal works →
            </button>

            {gateMsg && (
              <p
                style={{
                  color: "var(--muted)",
                  fontSize: "12px",
                  marginTop: "16px",
                }}
              >
                {gateMsg}
              </p>
            )}
          </div>
        </div>
      )}

      {exampleOpen && (
        <DesktopExample
          dark={dark}
          onClose={() => setExampleOpen(false)}
          onTryIt={() => {
            setExampleOpen(false);
            updateActiveTab(1, 3, 0);
            setMode("read");
          }}
        />
      )}

      {walkOpen && (
        <DesktopWalkthrough
          onClose={() => setWalkOpen(false)}
          createSession={createSession}
          deleteBook={deleteBook}
          setActiveBook={setActiveBook}
          addMark={addMark}
          setScopedLabel={setScopedLabel}
          resolveScope={resolveScope}
          scopedLabels={getBook(activeBookId).scopedLabels || {}}
          marks={marks}
          activeBookId={activeBookId}
          openDemoChapter={() => jumpToReference("1 Nephi 1:1")}
          tabIds={tabs.map((t) => t.id)}
          activeTabId={activeTabId}
          setActiveTab={setActiveTabId}
          closeTab={closeTab}
          compileOpen={mode === "compile"}
          setCompileOpen={(v) => setMode(v ? "compile" : "read")}
          pen={{ color: selectedColor, tool: selectedTool }}
          setPen={(p) => {
            setSelectedColor(p.color);
            setSelectedTool(p.tool);
          }}
          notes={notes}
          setNote={setNote}
        />
      )}

      {slidesOpen && (
        <FeatureSlides
          C={{
            bg: "var(--bg)",
            panel: "var(--panel)",
            soft: "var(--soft)",
            text: "var(--text)",
            muted: "var(--muted)",
            border: "var(--border)",
          }}
          onClose={() => setSlidesOpen(false)}
        />
      )}

      {showShortcuts && (
        <Shortcuts
          onClose={() => setShowShortcuts(false)}
          hotkeys={toolHotkeys}
          onChange={setToolHotkeys}
          defaults={DEFAULT_TOOL_HOTKEYS}
        />
      )}
      {showSearch && (
        <SearchPanel
          currentChapter={chapterScopeOf(activeTab)}
          currentVolume={activeTab.volume}
          currentBook={activeTab.book}
          marks={marks}
          colorLabels={activeScopedLabels}
          labelFor={labelFor}
          allMarks={allMarks}
          onJump={(ref) => {
            jumpToReference(ref);
            setShowSearch(false);
          }}
          onJumpToMark={jumpToMark}
          onLinkStudy={linkSearchTab ? undefined : onLinkStudy}
          onLinkSearchToChapter={onLinkSearchToChapter}
          linkChapterLabel={
            linkSearchTab ? tabLabel(linkSearchTab) : undefined
          }
          initialSelected={
            addToStudyId
              ? searchStudies.find((s) => s.id === addToStudyId)?.refs
              : addVersesRecId
              ? recordedStudies.find((s) => s.id === addVersesRecId)
                  ?.extraRefs || []
              : undefined
          }
          addToStudyName={
            addToStudyId
              ? searchStudies.find((s) => s.id === addToStudyId)?.name
              : undefined
          }
          onAddToStudy={handleAddToStudy}
          addVersesName={
            addVersesRecId
              ? recordedStudies.find((s) => s.id === addVersesRecId)?.name
              : undefined
          }
          onAddVerses={handleAddVersesToRec}
          onOpenNewTab={(ref) => {
            openInNewTab(ref);
            setShowSearch(false);
          }}
          onClose={() => {
            setShowSearch(false);
            setAddToStudyId(null);
            setAddVersesRecId(null);
          }}
        />
      )}
      {linkKwStudyId &&
        (() => {
          const ks = searchStudies.find((s) => s.id === linkKwStudyId);
          if (!ks) return null;
          const linkScope = ks.linkedScope || null;
          const gid = linkScope ? chapterGroups[linkScope] : undefined;
          const members = linkScope
            ? gid
              ? Object.keys(chapterGroups)
                  .filter((s) => chapterGroups[s] === gid)
                  .sort()
              : [linkScope]
            : [];
          const gColor = gid ? groupColor(gid) : ACCENT;
          const scopeLabel = (sc: string) => {
            const l = chapterLoc.get(sc);
            if (!l) return sc;
            const bk = vols[l.volume].books[l.book];
            return bk.book + " " + bk.chapters[l.chapter].chapter;
          };
          // Open chapter panels not already in this search's group. Offered as a
          // one-tap combined link - the mirror of "Link an open search" on the
          // chapter side, routed through the same linkKwToChapter path.
          const memberScopeSet = new Set(members.map((m) => resolveScope(m)));
          const openChapterLink: Tab[] = [];
          const seenChLink = new Set<string>();
          tabs.forEach((x) => {
            if (x.studyId) return;
            const sc = chapterScopeOf(x);
            if (!sc || memberScopeSet.has(resolveScope(sc))) return;
            if (seenChLink.has(sc)) return;
            seenChLink.add(sc);
            openChapterLink.push(x);
          });
          const eyebrow: React.CSSProperties = {
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--muted)",
            marginBottom: "8px",
          };
          const selStyle: React.CSSProperties = {
            boxSizing: "border-box",
            width: "100%",
            padding: "11px 10px",
            borderRadius: "10px",
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            fontSize: "14px",
            fontFamily: "inherit",
          };
          const addSearch = () => {
            setLinkKwStudyId(null);
            setAddToStudyId(ks.id);
            setShowSearch(true);
          };
          const pickRef =
            pickV >= 0 && pickB >= 0 && pickC >= 0
              ? vols[pickV].books[pickB].chapters[pickC].verses[0]
                  ?.reference || ""
              : "";
          const pickedScope = pickRef ? scopeOfRef(pickRef) : "";
          const pickedInStudy =
            !!pickedScope &&
            ((linkScope && resolveScope(pickedScope) === resolveScope(linkScope)) ||
              members.some(
                (m) => resolveScope(m) === resolveScope(pickedScope)
              ));
          const canAdd = !!pickedScope && !pickedInStudy;
          return (
            <div
              className="scribal-fade"
              onClick={() => setLinkKwStudyId(null)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
                padding: "20px",
              }}
            >
              <div
                className="scribal-rise"
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: "var(--panel)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: "14px",
                  padding: "22px",
                  width: "100%",
                  maxWidth: "440px",
                  maxHeight: "82vh",
                  overflowY: "auto",
                  boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: ks.linkedScope ? TYPE_PURPLE : TYPE_BLUE,
                    marginBottom: "5px",
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.3-4.3" />
                  </svg>
                  {ks.linkedScope ? "Combined study" : "Keyword study"}
                </div>
                <div style={{ fontSize: "17px", fontWeight: 700 }}>
                  {ks.name || "Search"}
                </div>
                <div
                  style={{
                    fontSize: "12.5px",
                    color: "var(--muted)",
                    marginTop: "2px",
                    marginBottom: "18px",
                  }}
                >
                  {ks.refs.length} {ks.refs.length === 1 ? "verse" : "verses"} ·{" "}
                  {linkScope ? "linked into a study" : "not linked yet"}
                </div>

                {linkScope ? (
                  <>
                    <div style={eyebrow}>In this study</div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--muted)",
                        lineHeight: 1.5,
                        marginBottom: "12px",
                      }}
                    >
                      Chapters this search compiles with. Go to one, open it in a
                      new tab, or unlink.
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      }}
                    >
                      {members.map((sc) => (
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
                              border: "1px solid var(--border)",
                              background: "var(--bg)",
                              fontSize: "14px",
                            }}
                          >
                            <span
                              style={{
                                width: "12px",
                                height: "12px",
                                borderRadius: "50%",
                                background: gColor,
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
                              {scopeLabel(sc)}
                            </span>
                          </div>
                          <button
                            onClick={() => kwOpenChapter(ks, sc)}
                            title="Open this chapter in a tab"
                            style={{
                              flexShrink: 0,
                              padding: "9px 12px",
                              borderRadius: "8px",
                              border: "none",
                              background: gColor,
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
                            onClick={() => kwOpenChapter(ks, sc)}
                            title="Open this chapter in a new tab"
                            style={{
                              flexShrink: 0,
                              padding: "9px 12px",
                              borderRadius: "8px",
                              border: "1px solid var(--border)",
                              background: "transparent",
                              color: "var(--text)",
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
                            onClick={() =>
                              askConfirm({
                                title: "Unlink this search?",
                                body: "It can be linked again anytime.",
                                confirmLabel: "Unlink",
                                cancelLabel: "Cancel",
                                onConfirm: () =>
                                  updateStudy(ks.id, {
                                    linkedScope: undefined,
                                  }),
                              })
                            }
                            title="Unlink this search from the study"
                            style={{
                              flexShrink: 0,
                              padding: "9px 12px",
                              borderRadius: "8px",
                              border: "1px solid var(--border)",
                              background: "transparent",
                              color: "var(--muted)",
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
                ) : (
                  <div
                    style={{
                      fontSize: "13px",
                      color: "var(--muted)",
                      lineHeight: 1.55,
                      marginBottom: "18px",
                    }}
                  >
                    Link this search to a chapter so they compile together as one
                    study and reopen side by side. You can also gather another
                    search into it.
                  </div>
                )}

                <div style={{ ...eyebrow, marginTop: "18px" }}>
                  Add to this study
                </div>
                <button
                  onClick={addSearch}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    padding: "11px 14px",
                    borderRadius: "10px",
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontSize: "14px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={TYPE_BLUE}
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.3-4.3" />
                  </svg>
                  Add a keyword search
                </button>

                {openChapterLink.length > 0 && (
                  <>
                    <div style={{ ...eyebrow, marginTop: "18px" }}>
                      Link an open chapter
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      }}
                    >
                      {openChapterLink.map((x) => (
                        <div
                          key={x.id}
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
                              border: "1px solid var(--border)",
                              background: "var(--bg)",
                              color: "var(--text)",
                              fontSize: "14px",
                            }}
                          >
                            <span
                              style={{
                                width: "12px",
                                height: "12px",
                                borderRadius: "50%",
                                background: TYPE_RED,
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
                              {scopeLabel(chapterScopeOf(x))}
                            </span>
                          </div>
                          <button
                            onClick={() =>
                              linkKwToChapter(ks, chapterScopeOf(x))
                            }
                            title="Combine this search with this chapter"
                            style={{
                              flexShrink: 0,
                              padding: "9px 13px",
                              borderRadius: "8px",
                              border: "none",
                              background: ACCENT,
                              color: "#fff",
                              cursor: "pointer",
                              fontSize: "12px",
                              fontWeight: 700,
                              fontFamily: "inherit",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Link
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <div style={{ ...eyebrow, marginTop: "18px" }}>
                  {linkScope ? "Or link another chapter" : "Link a chapter"}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
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
                    style={selStyle}
                  >
                    <option value={-1}>Choose a volume…</option>
                    {vols.map((vol, v) => (
                      <option key={v} value={v}>
                        {vol.volume}
                      </option>
                    ))}
                  </select>
                  {pickV >= 0 && vols[pickV].books.length > 1 && (
                    <select
                      value={pickB}
                      onChange={(e) => {
                        setPickB(Number(e.target.value));
                        setPickC(-1);
                      }}
                      style={selStyle}
                    >
                      <option value={-1}>Choose a book…</option>
                      {vols[pickV].books.map((bk, b) => (
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
                    style={{ ...selStyle, opacity: pickB < 0 ? 0.5 : 1 }}
                  >
                    <option value={-1}>
                      {pickV >= 0 && vols[pickV].books.length === 1
                        ? "Choose a section…"
                        : "Choose a chapter…"}
                    </option>
                    {(pickV >= 0 && pickB >= 0
                      ? vols[pickV].books[pickB].chapters
                      : []
                    ).map((ch, c) => (
                      <option key={c} value={c}>
                        {ch.chapter}
                      </option>
                    ))}
                  </select>
                </div>
                {pickedInStudy && (
                  <div
                    style={{
                      fontSize: "12.5px",
                      color: "var(--muted)",
                      marginTop: "8px",
                    }}
                  >
                    That chapter is already in this study — pick another.
                  </div>
                )}
                <button
                  onClick={() => {
                    if (canAdd) {
                      linkKwToChapter(ks, pickedScope);
                      setPickV(-1);
                      setPickB(-1);
                      setPickC(-1);
                    }
                  }}
                  disabled={!canAdd}
                  style={{
                    marginTop: "10px",
                    width: "100%",
                    padding: "11px 14px",
                    borderRadius: "10px",
                    border: "none",
                    background: canAdd ? ACCENT : "var(--border)",
                    color: canAdd ? "#fff" : "var(--muted)",
                    fontSize: "14px",
                    fontWeight: 700,
                    cursor: canAdd ? "pointer" : "default",
                    fontFamily: "inherit",
                  }}
                >
                  {linkScope ? "Add chapter" : "Link chapter"}
                </button>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    marginTop: "18px",
                  }}
                >
                  <button
                    onClick={() => setLinkKwStudyId(null)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--muted)",
                      fontSize: "13.5px",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      padding: "6px 4px",
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {linkSearchDraft &&
        (() => {
          const chapterTabs = tabs.filter((x) => !x.studyId);
          return (
            <div
              className="scribal-fade"
              onClick={() => setLinkSearchDraft(null)}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 380,
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "20px",
              }}
            >
              <div
                className="scribal-rise"
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "100%",
                  maxWidth: "420px",
                  background: "var(--bg)",
                  color: "var(--text)",
                  borderRadius: "16px",
                  border: "1px solid var(--border)",
                  padding: "20px",
                  boxShadow: "0 24px 70px rgba(0,0,0,0.4)",
                  maxHeight: "80vh",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {chapterTabs.length === 1 ? (
                  <>
                    <div style={{ fontSize: "16px", fontWeight: 700 }}>
                      Link to this chapter?
                    </div>
                    <div
                      style={{
                        fontSize: "12.5px",
                        color: "var(--muted)",
                        marginTop: "3px",
                        lineHeight: 1.5,
                      }}
                    >
                      Your{" "}
                      {linkSearchDraft.refs.length === 1
                        ? "verse"
                        : linkSearchDraft.refs.length + " verses"}{" "}
                      will open as their own tab linked to{" "}
                      <strong style={{ color: "var(--text)" }}>
                        {tabLabel(chapterTabs[0])}
                      </strong>
                      , sharing its themes and compiling together with it.
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: "10px",
                        justifyContent: "flex-end",
                        marginTop: "18px",
                      }}
                    >
                      <button
                        onClick={() => setLinkSearchDraft(null)}
                        style={{
                          padding: "10px 16px",
                          borderRadius: "10px",
                          border: "1px solid var(--border)",
                          background: "transparent",
                          color: "var(--text)",
                          cursor: "pointer",
                          fontSize: "13px",
                          fontWeight: 600,
                          fontFamily: "inherit",
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() =>
                          linkSearchToChapterTab(
                            linkSearchDraft.refs,
                            linkSearchDraft.label,
                            chapterTabs[0]
                          )
                        }
                        style={{
                          padding: "10px 18px",
                          borderRadius: "10px",
                          border: "none",
                          background: TYPE_BLUE,
                          color: "#fff",
                          cursor: "pointer",
                          fontSize: "13px",
                          fontWeight: 700,
                          fontFamily: "inherit",
                        }}
                      >
                        Link to {tabLabel(chapterTabs[0])}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: "16px", fontWeight: 700 }}>
                      Link this search to a chapter
                    </div>
                    <div
                      style={{
                        fontSize: "12.5px",
                        color: "var(--muted)",
                        marginTop: "3px",
                        lineHeight: 1.5,
                      }}
                    >
                      Your{" "}
                      {linkSearchDraft.refs.length === 1
                        ? "verse"
                        : linkSearchDraft.refs.length + " verses"}{" "}
                      open as their own tab, sharing the chapter&rsquo;s themes
                      and compiling together with it.
                    </div>
                    {chapterTabs.length === 0 ? (
                      <div
                        style={{
                          fontSize: "13.5px",
                          color: "var(--muted)",
                          padding: "18px 2px",
                          lineHeight: 1.6,
                        }}
                      >
                        Open a chapter in a tab first, then link this search to
                        it.
                      </div>
                    ) : (
                      <div
                        style={{
                          marginTop: "14px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                          overflowY: "auto",
                        }}
                      >
                        {chapterTabs.map((ct) => (
                          <button
                            key={ct.id}
                            onClick={() =>
                              linkSearchToChapterTab(
                                linkSearchDraft.refs,
                                linkSearchDraft.label,
                                ct
                              )
                            }
                            style={{
                              textAlign: "left",
                              padding: "11px 13px",
                              borderRadius: "10px",
                              border: "1px solid var(--border)",
                              background: "var(--bg)",
                              color: "var(--text)",
                              cursor: "pointer",
                              fontFamily: "inherit",
                              fontSize: "14px",
                              fontWeight: 600,
                            }}
                          >
                            {tabLabel(ct)}
                          </button>
                        ))}
                      </div>
                    )}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        marginTop: "16px",
                      }}
                    >
                      <button
                        onClick={() => setLinkSearchDraft(null)}
                        style={{
                          padding: "10px 16px",
                          borderRadius: "10px",
                          border: "1px solid var(--border)",
                          background: "transparent",
                          color: "var(--text)",
                          cursor: "pointer",
                          fontSize: "13px",
                          fontWeight: 600,
                          fontFamily: "inherit",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })()}

      {linkPromptTabId && (
        <div
          className="scribal-fade"
          onClick={() => setLinkPromptTabId(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px",
          }}
        >
          <div
            className="scribal-rise"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--panel)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: "14px",
              padding: "22px",
              width: "100%",
              maxWidth: "440px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
            }}
          >
            {(() => {
              const t = tabs.find((x) => x.id === linkPromptTabId);
              if (!t) return null;
              const cs = chapterScopeOf(t);
              const gid = chapterGroups[cs];
              const gColor = gid ? groupColor(gid) : ACCENT;
              const members = gid
                ? Object.keys(chapterGroups)
                    .filter((s) => chapterGroups[s] === gid && s !== cs)
                    .sort()
                : [];
              const chMarks = marks.filter(
                (m) => scopeOfRef(m.reference) === cs
              );
              const themeMap = new Map<
                string,
                { color: MarkColor; name: string; count: number }
              >();
              chMarks.forEach((m) => {
                const sc = scopedLabels[resolveScope(scopeOfRef(m.reference))];
                const raw =
                  (sc && m.color in sc ? sc[m.color] : colorLabels[m.color]) ||
                  "";
                const nm = raw.trim();
                const key = nm ? "n:" + nm : "c:" + m.color;
                const e = themeMap.get(key);
                if (e) e.count += 1;
                else
                  themeMap.set(key, {
                    color: m.color,
                    name: nm || "Color " + m.color,
                    count: 1,
                  });
              });
              const themes = Array.from(themeMap.values());
              const openRows = tabs
                .filter((x) => x.id !== linkPromptTabId && !x.studyId)
                .map((x) => ({
                  scope: chapterScopeOf(x),
                  label: tabLabel(x),
                  open: true,
                  next: false,
                }));
              const openSet = new Set(openRows.map((o) => o.scope));
              const baseRows = [
                ...openRows,
                ...linkSelected
                  .filter((s) => !openSet.has(s) && s !== cs)
                  .map((s) => ({
                    scope: s,
                    label: s,
                    open: false,
                    next: false,
                  })),
              ];
              // Offer the very next chapter as a one-tap link even when it isn't
              // open in a tab — the most common way a study grows.
              const nextScope = nextChapterScopeOf(t);
              const hasRow = new Set(baseRows.map((r) => r.scope));
              const linkRows =
                nextScope && nextScope !== cs && !hasRow.has(nextScope)
                  ? [
                      {
                        scope: nextScope,
                        label: nextScope,
                        open: false,
                        next: true,
                      },
                      ...baseRows,
                    ]
                  : baseRows;
              const eyebrow: React.CSSProperties = {
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--muted)",
                marginBottom: "8px",
              };
              const selStyle: React.CSSProperties = {
                boxSizing: "border-box",
                width: "100%",
                padding: "11px 10px",
                borderRadius: "10px",
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                fontSize: "14px",
                fontFamily: "inherit",
              };
              // Keyword searches linked to this chapter (or anywhere in its
              // group) — each one its own gathered set of loose verses, opened in
              // its own tab.
              const linkScopeSet = new Set([
                resolveScope(cs),
                ...members.map((m) => resolveScope(m)),
              ]);
              const linkedSearches = searchStudies.filter(
                (ks) =>
                  !isSearchStudyDeleted(ks) &&
                  ks.linkedScope &&
                  linkScopeSet.has(resolveScope(ks.linkedScope))
              );
              // Open keyword-search panels not yet linked into this chapter's
              // group. Offered as a real combined link (sets linkedScope) - the
              // mirror of linking an open chapter from the keyword side.
              const linkedHereIds = new Set(linkedSearches.map((k) => k.id));
              const openKwLink: SearchStudy[] = [];
              const seenKwLink = new Set<string>();
              tabs.forEach((x) => {
                if (x.id === linkPromptTabId || !x.studyId) return;
                if (seenKwLink.has(x.studyId)) return;
                seenKwLink.add(x.studyId);
                const ks = searchStudies.find((s) => s.id === x.studyId);
                if (ks && !isSearchStudyDeleted(ks) && !linkedHereIds.has(ks.id))
                  openKwLink.push(ks);
              });
              return (
                <>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "9px",
                      marginBottom: "3px",
                    }}
                  >
                    {gid && (
                      <span
                        style={{
                          width: "12px",
                          height: "12px",
                          borderRadius: "50%",
                          background: gColor,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <span style={{ fontSize: "17px", fontWeight: 700 }}>
                      {tabLabel(t)}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "12.5px",
                      color: "var(--muted)",
                      marginBottom: members.length ? "4px" : "16px",
                    }}
                  >
                    {chMarks.length}{" "}
                    {chMarks.length === 1 ? "marking" : "markings"} in this
                    chapter
                  </div>
                  {themes.length > 0 && (
                    <>
                      <div style={eyebrow}>Themes here</div>
                      <div style={{ marginBottom: "18px" }}>
                        {themes.map((th, i) => (
                          <div
                            key={i}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                              padding: "6px 0",
                            }}
                          >
                            <span
                              style={{
                                width: "14px",
                                height: "14px",
                                borderRadius: "50%",
                                backgroundColor: COLOR_MAP[th.color],
                                flexShrink: 0,
                              }}
                            />
                            <span
                              style={{
                                flex: 1,
                                fontSize: "14px",
                                fontWeight: 600,
                              }}
                            >
                              {th.name}
                            </span>
                            <span
                              style={{
                                fontSize: "11.5px",
                                color: "var(--muted)",
                              }}
                            >
                              {th.count} {th.count === 1 ? "mark" : "marks"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <div style={eyebrow}>Combine into a study</div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--muted)",
                      lineHeight: 1.5,
                      marginBottom: "12px",
                    }}
                  >
                    Linked chapters share one set of theme names and compile as
                    one. Check the chapters to study together; uncheck to unlink.
                  </div>
                  {linkRows.length === 0 ? (
                    <div
                      style={{
                        fontSize: "13px",
                        color: "var(--muted)",
                        padding: "4px 0",
                      }}
                    >
                      Open another chapter in a tab to link it with this one.
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                        maxHeight: "260px",
                        overflowY: "auto",
                      }}
                    >
                      {linkRows.map((r) => {
                        const on = linkSelected.includes(r.scope);
                        // Unchecking a chapter that is actually part of this
                        // chapter's linked study is an unlink, so confirm first.
                        // Unchecking one just picked this session is a plain
                        // deselect and needs no prompt.
                        const isLinkedHere =
                          !!chapterGroups[r.scope] &&
                          chapterGroups[r.scope] === chapterGroups[cs];
                        return (
                          <div
                            key={r.scope}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                          >
                            <button
                              onClick={() => {
                                if (on && isLinkedHere) {
                                  askConfirm({
                                    title:
                                      "Are you sure you want to unlink this study?",
                                    body:
                                      "You can re-link these chapters anytime.",
                                    confirmLabel: "Yes",
                                    cancelLabel: "No",
                                    onConfirm: () =>
                                      toggleLinkSelect(r.scope),
                                  });
                                } else {
                                  toggleLinkSelect(r.scope);
                                }
                              }}
                              style={{
                                flex: 1,
                                minWidth: 0,
                                display: "flex",
                                alignItems: "center",
                                gap: "10px",
                                textAlign: "left",
                                padding: "11px 13px",
                                borderRadius: "10px",
                                border: on
                                  ? "2px solid " + gColor
                                  : "1px solid var(--border)",
                                background: "var(--bg)",
                                color: "var(--text)",
                                fontSize: "14px",
                                fontWeight: on ? 600 : 400,
                                cursor: "pointer",
                                fontFamily: "inherit",
                              }}
                            >
                              <span
                                style={{
                                  width: "16px",
                                  height: "16px",
                                  borderRadius: "4px",
                                  border: on
                                    ? "1px solid " + gColor
                                    : "1px solid var(--muted)",
                                  background: on ? gColor : "transparent",
                                  color: "#fff",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  flexShrink: 0,
                                  fontSize: "11px",
                                }}
                              >
                                {on ? "✓" : ""}
                              </span>
                              <span
                                style={{
                                  flex: 1,
                                  minWidth: 0,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {r.label}
                                {(r.next || !r.open) && (
                                  <span
                                    style={{
                                      fontSize: "11px",
                                      color: "var(--muted)",
                                    }}
                                  >
                                    {" "}
                                    · {r.next ? "next chapter" : "not open"}
                                  </span>
                                )}
                              </span>
                            </button>
                            <button
                              onClick={() => jumpLinkedTab(r.scope)}
                              title="Jump to this chapter in this tab"
                              style={{
                                flexShrink: 0,
                                padding: "9px 11px",
                                borderRadius: "8px",
                                border: "none",
                                background: gColor,
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
                              onClick={() => openLinkedTab(r.scope)}
                              title="Open this chapter in a new tab"
                              style={{
                                flexShrink: 0,
                                padding: "9px 11px",
                                borderRadius: "8px",
                                border: "1px solid var(--border)",
                                background: "transparent",
                                color: "var(--text)",
                                cursor: "pointer",
                                fontSize: "12px",
                                fontWeight: 600,
                                fontFamily: "inherit",
                                whiteSpace: "nowrap",
                              }}
                            >
                              New tab
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {linkedSearches.length > 0 && (
                    <>
                      <div style={{ ...eyebrow, marginTop: "18px" }}>
                        Linked searches
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--muted)",
                          lineHeight: 1.5,
                          marginBottom: "12px",
                        }}
                      >
                        Keyword searches gathered into this study. Open one to
                        read its loose verses in its own tab.
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                        }}
                      >
                        {linkedSearches.map((ks) => (
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
                                border: "1px solid var(--border)",
                                background: "var(--bg)",
                                color: "var(--text)",
                                fontSize: "14px",
                              }}
                            >
                              <svg
                                width="15"
                                height="15"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke={gColor}
                                strokeWidth={2.4}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ flexShrink: 0 }}
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
                                <span
                                  style={{
                                    fontSize: "11px",
                                    color: "var(--muted)",
                                  }}
                                >
                                  {" "}
                                  · {ks.refs.length}{" "}
                                  {ks.refs.length === 1 ? "verse" : "verses"}
                                </span>
                              </span>
                            </div>
                            <button
                              onClick={() => {
                                openStudyTab(ks);
                                setLinkPromptTabId(null);
                              }}
                              title="Open this search in its own tab"
                              style={{
                                flexShrink: 0,
                                padding: "9px 13px",
                                borderRadius: "8px",
                                border: "none",
                                background: gColor,
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
                              onClick={() =>
                                askConfirm({
                                  title: "Are you sure?",
                                  body:
                                    "This can be linked again in Studies.",
                                  confirmLabel: "Yes",
                                  cancelLabel: "No",
                                  onConfirm: () =>
                                    updateStudy(ks.id, {
                                      linkedScope: undefined,
                                    }),
                                })
                              }
                              title="Unlink this search from this chapter"
                              style={{
                                flexShrink: 0,
                                padding: "9px 13px",
                                borderRadius: "8px",
                                border: "1px solid var(--border)",
                                background: "transparent",
                                color: "var(--muted)",
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

                  {openKwLink.length > 0 && (
                    <>
                      <div style={{ ...eyebrow, marginTop: "18px" }}>
                        Link an open search
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--muted)",
                          lineHeight: 1.5,
                          marginBottom: "12px",
                        }}
                      >
                        Open keyword searches you can combine into this chapter.
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                        }}
                      >
                        {openKwLink.map((ks) => (
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
                                border: "1px solid var(--border)",
                                background: "var(--bg)",
                                color: "var(--text)",
                                fontSize: "14px",
                              }}
                            >
                              <svg
                                width="15"
                                height="15"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke={TYPE_BLUE}
                                strokeWidth={2.4}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ flexShrink: 0 }}
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
                                <span
                                  style={{
                                    fontSize: "11px",
                                    color: "var(--muted)",
                                  }}
                                >
                                  {" "}
                                  · {ks.refs.length}{" "}
                                  {ks.refs.length === 1 ? "verse" : "verses"}
                                </span>
                              </span>
                            </div>
                            <button
                              onClick={() => {
                                linkKwToChapter(ks, cs);
                                setLinkPromptTabId(null);
                              }}
                              title="Combine this search into this chapter"
                              style={{
                                flexShrink: 0,
                                padding: "9px 13px",
                                borderRadius: "8px",
                                border: "none",
                                background: ACCENT,
                                color: "#fff",
                                cursor: "pointer",
                                fontSize: "12px",
                                fontWeight: 700,
                                fontFamily: "inherit",
                                whiteSpace: "nowrap",
                              }}
                            >
                              Link
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <div style={{ ...eyebrow, marginTop: "18px" }}>
                    Or link any chapter
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    <select
                      value={pickV}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setPickV(v);
                        // D&C (any single-book volume) has no book to choose, so
                        // auto-select its one book — leaving just volume + section.
                        const single = v >= 0 && vols[v].books.length === 1;
                        setPickB(single ? 0 : -1);
                        setPickC(-1);
                      }}
                      style={selStyle}
                    >
                      <option value={-1}>Choose a volume…</option>
                      {vols.map((vol, v) => (
                        <option key={v} value={v}>
                          {vol.volume}
                        </option>
                      ))}
                    </select>
                    {pickV >= 0 && vols[pickV].books.length > 1 && (
                      <select
                        value={pickB}
                        onChange={(e) => {
                          setPickB(Number(e.target.value));
                          setPickC(-1);
                        }}
                        style={selStyle}
                      >
                        <option value={-1}>Choose a book…</option>
                        {vols[pickV].books.map((bk, b) => (
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
                      style={{ ...selStyle, opacity: pickB < 0 ? 0.5 : 1 }}
                    >
                      <option value={-1}>
                        {pickV >= 0 && vols[pickV].books.length === 1
                          ? "Choose a section…"
                          : "Choose a chapter…"}
                      </option>
                      {(pickV >= 0 && pickB >= 0
                        ? vols[pickV].books[pickB].chapters
                        : []
                      ).map((ch, c) => (
                        <option key={c} value={c}>
                          {ch.chapter}
                        </option>
                      ))}
                    </select>
                  </div>
                  {(() => {
                    if (pickV < 0 || pickB < 0 || pickC < 0) return null;
                    const ref =
                      vols[pickV].books[pickB].chapters[pickC].verses[0]
                        ?.reference || "";
                    const ts = scopeOfRef(ref);
                    if (ts === cs) {
                      return (
                        <div
                          style={{
                            fontSize: "12.5px",
                            color: "var(--muted)",
                            marginTop: "8px",
                          }}
                        >
                          That's the chapter you're on — pick another.
                        </div>
                      );
                    }
                    const already = linkSelected.includes(ts);
                    return (
                      <button
                        onClick={() => {
                          if (!already)
                            setLinkSelected((prev) => {
                              const set = new Set(prev);
                              groupScopesOf(ts).forEach((s) => set.add(s));
                              return Array.from(set);
                            });
                          setPickV(-1);
                          setPickB(-1);
                          setPickC(-1);
                        }}
                        style={{
                          marginTop: "10px",
                          width: "100%",
                          padding: "11px",
                          borderRadius: "10px",
                          border: "none",
                          background: gColor,
                          color: "#fff",
                          fontSize: "14px",
                          fontWeight: 700,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {already
                          ? ts + " is already in the list"
                          : "Add " + ts + " to this study"}
                      </button>
                    );
                  })()}

                  <div style={{ ...eyebrow, marginTop: "18px" }}>
                    Or link a keyword search
                  </div>
                  <button
                    onClick={() => {
                      setLinkSearchTab(t);
                      setLinkPromptTabId(null);
                      setShowSearch(true);
                    }}
                    style={{
                      marginTop: "10px",
                      width: "100%",
                      padding: "11px 13px",
                      borderRadius: "10px",
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--text)",
                      fontSize: "14px",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textAlign: "left",
                    }}
                  >
                    Search verses to link to this study
                  </button>
                </>
              );
            })()}
            <div style={{ display: "flex", gap: "10px", marginTop: "18px" }}>
              <button
                onClick={applyLinkPrompt}
                style={{
                  flex: 1,
                  padding: "11px",
                  borderRadius: "10px",
                  border: "none",
                  background: ICON_ACCENT,
                  color: "#fff",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Done
              </button>
              <button
                onClick={() => setLinkPromptTabId(null)}
                style={{
                  padding: "11px 16px",
                  borderRadius: "10px",
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text)",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {linkedCompilePrompt &&
        (() => {
          const { gid, tabId } = linkedCompilePrompt;
          const t = tabs.find((x) => x.id === tabId);
          const thisScope = t ? chapterScopeOf(t) : "";
          const members = Object.keys(chapterGroups)
            .filter((c) => chapterGroups[c] === gid)
            .sort();
          const others = members.filter((s) => s !== thisScope);
          const gColor = groupColor(gid);
          const thisLabel = t ? tabLabel(t) : "This chapter";
          const option = (
            title: string,
            hint: string,
            onClick: () => void,
            primary: boolean
          ) => (
            <button
              onClick={onClick}
              style={{
                textAlign: "left",
                padding: "14px 16px",
                borderRadius: "12px",
                border:
                  "1px solid " + (primary ? ICON_ACCENT : "var(--border)"),
                background: primary ? "var(--soft)" : "var(--bg)",
                color: "var(--text)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <div style={{ fontSize: "15px", fontWeight: 600 }}>{title}</div>
              <div
                style={{
                  fontSize: "12.5px",
                  color: "var(--muted)",
                  marginTop: "3px",
                  lineHeight: 1.5,
                }}
              >
                {hint}
              </div>
            </button>
          );
          return (
            <div
              className="scribal-fade"
              onClick={() => setLinkedCompilePrompt(null)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1001,
                padding: "20px",
              }}
            >
              <div
                className="scribal-rise"
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: "var(--panel)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: "16px",
                  padding: "24px",
                  width: "100%",
                  maxWidth: "480px",
                  boxShadow: "0 16px 50px rgba(0,0,0,0.4)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    marginBottom: "4px",
                  }}
                >
                  <span
                    style={{
                      width: "13px",
                      height: "13px",
                      borderRadius: "50%",
                      background: gColor,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: "18px", fontWeight: 700 }}>
                    Linked study
                  </span>
                </div>
                <div
                  style={{
                    fontSize: "13.5px",
                    color: "var(--muted)",
                    marginBottom: "16px",
                  }}
                >
                  {thisLabel} is linked with {others.length}{" "}
                  {others.length === 1 ? "other chapter" : "other chapters"}.
                </div>

                <div
                  style={{
                    background: "var(--soft)",
                    border: "1px solid var(--border)",
                    borderRadius: "12px",
                    padding: "12px 14px",
                    marginBottom: "20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  {members.map((s) => (
                    <div
                      key={s}
                      style={{
                        fontSize: "13.5px",
                        fontWeight: s === thisScope ? 600 : 500,
                      }}
                    >
                      {s}
                      {s === thisScope && (
                        <span
                          style={{
                            fontSize: "11.5px",
                            fontWeight: 400,
                            color: "var(--muted)",
                          }}
                        >
                          {" "}
                          · this chapter
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                <div
                  style={{ display: "flex", flexDirection: "column", gap: "10px" }}
                >
                  {option(
                    "Compile the linked study",
                    "All " +
                      members.length +
                      " chapters together, sharing one set of themes.",
                    () => compileLinkedAll(gid),
                    true
                  )}
                  {option(
                    "Just this chapter, in a new session",
                    "Study " +
                      thisLabel +
                      " on its own — its marks are copied into a new session book, leaving the linked study untouched.",
                    () => compileJustThisSession(tabId),
                    false
                  )}
                </div>

                <div style={{ textAlign: "right", marginTop: "16px" }}>
                  <button
                    onClick={() => setLinkedCompilePrompt(null)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--muted)",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontFamily: "inherit",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {saveStudyPrompt && (
        <div
          className="scribal-fade"
          onClick={() => setSaveStudyPrompt(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1001,
            padding: "20px",
          }}
        >
          <div
            className="scribal-rise"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--panel)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: "14px",
              padding: "22px",
              width: "100%",
              maxWidth: "460px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
            }}
          >
            <div
              style={{ fontSize: "16px", fontWeight: 700, marginBottom: "6px" }}
            >
              A study for this already exists
            </div>
            <div style={{ fontSize: "13px", opacity: 0.75, marginBottom: "18px" }}>
              “{saveStudyPrompt.existing.name}” · {saveStudyPrompt.info.defaultName}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
              {[
                {
                  title: "Add to the existing study",
                  hint: "Update it in place — no duplicate.",
                  onClick: saveAddToExisting,
                  primary: true,
                },
                {
                  title: "New study, verses kept",
                  hint: "Copy these marks into a new session book.",
                  onClick: saveAsNewKept,
                  primary: false,
                },
                {
                  title: "New study in a fresh session",
                  hint: "Start over on these chapters in a new session book.",
                  onClick: saveAsNewFresh,
                  primary: false,
                },
              ].map((o) => (
                <button
                  key={o.title}
                  onClick={o.onClick}
                  style={{
                    textAlign: "left",
                    padding: "12px 14px",
                    borderRadius: "10px",
                    border:
                      "1px solid " +
                      (o.primary ? ICON_ACCENT : "var(--border)"),
                    background: o.primary ? "var(--soft)" : "var(--bg)",
                    color: "var(--text)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <div style={{ fontSize: "14px", fontWeight: 600 }}>
                    {o.title}
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--muted)",
                      marginTop: "2px",
                    }}
                  >
                    {o.hint}
                  </div>
                </button>
              ))}
            </div>
            <div style={{ textAlign: "right", marginTop: "16px" }}>
              <button
                onClick={() => setSaveStudyPrompt(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--muted)",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {defn && (
        <div
          onClick={() => setDefn(null)}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.4)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(560px, 92vw)",
              maxHeight: "80vh",
              overflowY: "auto",
              backgroundColor: "var(--panel)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: "14px",
              padding: "22px",
              boxShadow: "0 12px 48px rgba(0,0,0,0.3)",
            }}
          >
            <DefinitionView
              word={defn.word}
              result={defn.result}
              colors={{
                text: "var(--text)",
                muted: "var(--muted)",
                border: "var(--border)",
                soft: "var(--soft)",
              }}
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
          </div>
        </div>
      )}

      {compilePrompt && (
        <div
          className="scribal-fade"
          onClick={() => setCompilePrompt(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px",
          }}
        >
          <div
            className="scribal-rise"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--panel)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: "14px",
              padding: "22px",
              width: "100%",
              maxWidth: "420px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
            }}
          >
            <div
              style={{ fontSize: "16px", fontWeight: 600, marginBottom: "6px" }}
            >
              What do you want to compile?
            </div>
            <div
              style={{
                fontSize: "13px",
                opacity: 0.7,
                marginBottom: "16px",
              }}
            >
              You have more than one thing open. Pick what to compile.
            </div>
            <div
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              {compilePrompt.map((u, i) => (
                <button
                  key={i}
                  onClick={() => chooseCompileUnit(u)}
                  style={{
                    textAlign: "left",
                    padding: "12px 14px",
                    borderRadius: "10px",
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontSize: "14px",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  {u.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setCompilePrompt(null)}
              style={{
                marginTop: "16px",
                width: "100%",
                padding: "10px",
                borderRadius: "10px",
                border: "none",
                background: "transparent",
                color: "var(--text)",
                opacity: 0.6,
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {compileAnim.show && (
        <CompileBook
          flyers={compileAnim.flyers}
          colors={compileAnim.colors}
          scale={1.55}
          cap={30}
          duration={compileAnim.duration}
          onDone={finishCompileAnim}
        />
      )}
      {sharingVerses && (
        <ShareVerses
          compileTabs={effectiveCompileTabs}
          marks={effectiveMarks}
          colorLabels={effectiveScopedLabels}
          notes={notes}
          dark={dark}
          C={
            dark
              ? {
                  bg: "#131210",
                  panel: "#1d1c19",
                  soft: "#232220",
                  text: "#eae7de",
                  muted: "#8d8a82",
                  border: "#343229",
                }
              : {
                  bg: "#f6f4ee",
                  panel: "#ffffff",
                  soft: "#efece4",
                  text: "#1d1c18",
                  muted: "#8d8a80",
                  border: "#e2dfd6",
                }
          }
          onClose={() => setSharingVerses(false)}
          onFlash={(m) => {
            setShareMsg(m);
            setTimeout(() => setShareMsg(null), 2200);
          }}
        />
      )}

      {shareMsg && (
        <div
          className="scribal-rise-plain"
          style={{
            position: "fixed",
            bottom: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 5000,
            background: "var(--text)",
            color: "var(--bg)",
            padding: "10px 18px",
            borderRadius: "999px",
            fontSize: "13.5px",
            fontWeight: 600,
            boxShadow: "0 8px 30px rgba(0,0,0,0.3)",
          }}
        >
          {shareMsg}
        </div>
      )}

      {markVersesStudyId &&
        (() => {
          const st = recordedStudies.find((s) => s.id === markVersesStudyId);
          if (!st) return null;
          // Same chapter ordering as openRecordedStudy, so a linked study reads
          // in canonical order.
          const scopeOrder = (s: string) => {
            const l = chapterLoc.get(s);
            return l ? l.volume * 1e6 + l.book * 1e3 + l.chapter : 1e12;
          };
          const scopes = (
            st.type === "linked"
              ? Object.keys(chapterGroups).filter(
                  (c) => chapterGroups[c] === st.scopeRef
                )
              : [st.scopeRef]
          )
            .slice()
            .sort((a, b) => scopeOrder(a) - scopeOrder(b));
          const chapterRefs: string[] = [];
          scopes.forEach((scope) => {
            const cl = chapterLoc.get(scope);
            if (cl)
              vols[cl.volume].books[cl.book].chapters[
                cl.chapter
              ].verses.forEach((v: { reference: string }) =>
                chapterRefs.push(v.reference)
              );
          });
          const extras = st.extraRefs || [];
          const extraSet = new Set(extras);
          // Added verses first, then the chapter's own verses (deduped), so it's
          // obvious which ones were just added and still need marking.
          const readRefs = [
            ...extras,
            ...chapterRefs.filter((r) => !extraSet.has(r)),
          ];
          if (!readRefs.length) return null;
          const firstLoc = refLoc.get(readRefs[0]) || {
            volume: 0,
            book: 0,
            chapter: 0,
          };
          const goCompile = () => {
            setMarkVersesStudyId(null);
            openRecordedStudy(st);
          };
          return (
            <div
              className="scribal-fade"
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 1200,
                background: "var(--bg)",
                color: "var(--text)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "12px 18px",
                  borderBottom: "1px solid var(--border)",
                  flexShrink: 0,
                }}
              >
                <button
                  onClick={() => setMarkVersesStudyId(null)}
                  title="Back"
                  style={{
                    width: "34px",
                    height: "34px",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: "9px",
                    color: "var(--text)",
                    fontSize: "18px",
                    lineHeight: 1,
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
                    {st.name}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                    Mark your added verses, then compile
                  </div>
                </div>
                <button
                  onClick={goCompile}
                  style={{
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    height: "36px",
                    padding: "0 18px",
                    borderRadius: "999px",
                    border: "none",
                    background: ICON_ACCENT,
                    color: "#fff",
                    fontSize: "14px",
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
                  padding: "4px 0 64px",
                }}
              >
                <VerseViewer
                toolHotkeys={toolHotkeys}
                  key={"markverses_" + st.id}
                  selectedVolume={firstLoc.volume}
                  selectedBook={firstLoc.book}
                  selectedChapter={firstLoc.chapter}
                  onChange={() => {}}
                  selectedTool={selectedTool}
                  selectedColor={selectedColor}
                  onChangeTool={setSelectedTool}
                  onChangeColor={setSelectedColor}
                  onMark={addMark}
                  onEraseMark={deleteMark}
                  onMarkMany={addMarks}
                  onDefine={handleDefine}
                  tags={wordTags}
                  onTagTap={openTagRef}
                  marks={getBook(st.bookId).marks}
                  showToolbar={true}
                  toolbarPos={toolbarPos}
                  onToolbarPos={setToolbarPos}
                  toolbarOrient={toolbarOrient}
                  onToolbarOrient={setToolbarOrient}
                  panelMode={false}
                  fontScale={reading.fontScale}
                  lineScale={reading.lineScale}
                  warm={reading.warm}
                  dark={dark}
                  sidebarOpen={false}
                  studyRefs={readRefs}
                  studyTitle={st.name}
                  splitAfter={extras.length}
                  splitLabels={{ first: "Just added", second: "Study verses" }}
                  hideStudyHeader={true}
                  jumpTarget={null}
                  onJumpHandled={() => {}}
                />
              </div>
            </div>
          );
        })()}

      {studiesOpen && (
        <StudiesList
          rows={buildStudyRows()}
          onClose={() => setStudiesOpen(false)}
          onImport={openSnImport}
        />
      )}

      {snImportOpen && (
        <div
          className="scribal-fade"
          onClick={() => setSnImportOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 390,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          <div
            className="scribal-rise"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: "460px",
              maxHeight: "calc(100vh - 80px)",
              overflowY: "auto",
              background: "var(--bg)",
              color: "var(--text)",
              borderRadius: "16px",
              border: "1px solid var(--border)",
              padding: "20px",
              boxShadow: "0 24px 70px rgba(0,0,0,0.4)",
            }}
          >
            <div style={{ fontSize: "16px", fontWeight: 700 }}>
              Import from ScriptureNotes
            </div>
            <div
              style={{
                fontSize: "12.5px",
                color: "var(--muted)",
                marginTop: "3px",
              }}
            >
              Upload a note exported as a PDF report — it becomes a study with all
              of its verses.
            </div>

            {!snParsed && (
              <>
                {!snPaste ? (
                  <label
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!snBusy)
                        handleSnFile(
                          e.dataTransfer.files && e.dataTransfer.files[0]
                        );
                    }}
                    style={{
                      display: "block",
                      marginTop: "16px",
                      padding: "26px 16px",
                      border: "1.5px dashed var(--border)",
                      borderRadius: "12px",
                      textAlign: "center",
                      cursor: snBusy ? "default" : "pointer",
                      background: "var(--panel)",
                    }}
                  >
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      disabled={snBusy}
                      onChange={(e) =>
                        handleSnFile(e.target.files && e.target.files[0])
                      }
                      style={{ display: "none" }}
                    />
                    <div style={{ fontSize: "14px", fontWeight: 600 }}>
                      {snBusy ? "Reading your PDF…" : "Choose a PDF"}
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--muted)",
                        marginTop: "4px",
                      }}
                    >
                      {snBusy ? "One moment" : "or drag the file here"}
                    </div>
                  </label>
                ) : (
                  <>
                    <textarea
                      value={snText}
                      onChange={(e) => setSnText(e.target.value)}
                      placeholder="Open your ScriptureNotes report, select all the text, copy it, and paste it here."
                      style={{
                        width: "100%",
                        marginTop: "16px",
                        minHeight: "150px",
                        resize: "vertical",
                        padding: "12px 13px",
                        borderRadius: "12px",
                        border: "1px solid var(--border)",
                        background: "var(--panel)",
                        color: "var(--text)",
                        fontSize: "13px",
                        lineHeight: 1.5,
                        fontFamily: "inherit",
                        boxSizing: "border-box",
                      }}
                    />
                    <button
                      onClick={handleSnPaste}
                      disabled={!snText.trim()}
                      style={{
                        width: "100%",
                        marginTop: "10px",
                        background: snText.trim() ? "var(--text)" : "var(--panel)",
                        color: snText.trim() ? "var(--bg)" : "var(--muted)",
                        border: "none",
                        borderRadius: "10px",
                        padding: "11px",
                        fontSize: "14px",
                        fontWeight: 700,
                        cursor: snText.trim() ? "pointer" : "default",
                        fontFamily: "inherit",
                      }}
                    >
                      Read text
                    </button>
                  </>
                )}
                {snErr && (
                  <div
                    style={{
                      marginTop: "12px",
                      fontSize: "13px",
                      lineHeight: 1.45,
                      color: "#c0392b",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {snErr}
                  </div>
                )}
                <div
                  style={{
                    marginTop: "16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <button
                    onClick={() => {
                      setSnPaste((v) => !v);
                      setSnErr("");
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: ICON_ACCENT,
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      padding: 0,
                    }}
                  >
                    {snPaste ? "Upload a PDF instead" : "Paste text instead"}
                  </button>
                  <button
                    onClick={() => setSnImportOpen(false)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--muted)",
                      fontSize: "13px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}

            {snParsed && (
              <>
                <div
                  style={{
                    marginTop: "16px",
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: "var(--muted)",
                  }}
                >
                  Study name
                </div>
                <input
                  value={snName}
                  onChange={(e) => setSnName(e.target.value)}
                  style={{
                    width: "100%",
                    marginTop: "6px",
                    padding: "11px 13px",
                    borderRadius: "10px",
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                    color: "var(--text)",
                    fontSize: "15px",
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                  }}
                />
                <div
                  style={{
                    marginTop: "14px",
                    display: "flex",
                    gap: "8px",
                    flexWrap: "wrap",
                  }}
                >
                  {[
                    `${snParsed.verses.length} verses`,
                    `${snParsed.favorites.length} favorites`,
                    `${snParsed.unmatched.length} unmatched`,
                  ].map((chip) => (
                    <span
                      key={chip}
                      style={{
                        fontSize: "12.5px",
                        fontWeight: 600,
                        padding: "5px 11px",
                        borderRadius: "999px",
                        background: "var(--panel)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                      }}
                    >
                      {chip}
                    </span>
                  ))}
                </div>
                {snParsed.description && (
                  <div
                    style={{
                      marginTop: "14px",
                      padding: "12px 14px",
                      background: "var(--panel)",
                      borderRadius: "10px",
                      fontSize: "13px",
                      lineHeight: 1.5,
                      maxHeight: "150px",
                      overflowY: "auto",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {snParsed.description}
                  </div>
                )}
                {snParsed.unmatched.length > 0 && (
                  <div
                    style={{
                      marginTop: "12px",
                      fontSize: "12.5px",
                      color: "var(--muted)",
                      lineHeight: 1.45,
                    }}
                  >
                    Couldn't match{" "}
                    {snParsed.unmatched.map((u) => u.raw).join(", ")}. These are
                    skipped — everything else imports.
                  </div>
                )}
                <div style={{ marginTop: "18px", display: "flex", gap: "10px" }}>
                  <button
                    onClick={() => {
                      setSnParsed(null);
                      setSnErr("");
                    }}
                    style={{
                      flex: "0 0 auto",
                      background: "transparent",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      borderRadius: "10px",
                      padding: "11px 16px",
                      fontSize: "14px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Back
                  </button>
                  <button
                    onClick={commitSnImport}
                    disabled={!snParsed.verses.length}
                    style={{
                      flex: 1,
                      background: snParsed.verses.length
                        ? "var(--text)"
                        : "var(--panel)",
                      color: snParsed.verses.length ? "var(--bg)" : "var(--muted)",
                      border: "none",
                      borderRadius: "10px",
                      padding: "11px",
                      fontSize: "14px",
                      fontWeight: 700,
                      cursor: snParsed.verses.length ? "pointer" : "default",
                      fontFamily: "inherit",
                    }}
                  >
                    Import{" "}
                    {snParsed.verses.length === 1
                      ? "1 verse"
                      : snParsed.verses.length + " verses"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {studyDraftRefs && (
        <div
          className="scribal-fade"
          onClick={() => setStudyDraftRefs(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 380,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          <div
            className="scribal-rise"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: "420px",
              background: "var(--bg)",
              color: "var(--text)",
              borderRadius: "16px",
              border: "1px solid var(--border)",
              padding: "20px",
              boxShadow: "0 24px 70px rgba(0,0,0,0.4)",
            }}
          >
            <div style={{ fontSize: "16px", fontWeight: 700 }}>
              Name this study
            </div>
            <div
              style={{ fontSize: "12.5px", color: "var(--muted)", marginTop: "3px" }}
            >
              {studyDraftRefs.length}{" "}
              {studyDraftRefs.length === 1 ? "verse" : "verses"}
            </div>
            <input
              autoFocus
              value={studyDraftName}
              onChange={(e) => setStudyDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createStudyFromDraft();
              }}
              placeholder="e.g. Covenant"
              style={{
                width: "100%",
                marginTop: "14px",
                padding: "11px 13px",
                borderRadius: "10px",
                border: "1px solid var(--border)",
                background: "var(--panel)",
                color: "var(--text)",
                fontSize: "15px",
                fontFamily: "inherit",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <div style={{ marginTop: "14px" }}>
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--muted)",
                  marginBottom: "6px",
                }}
              >
                Marks save to
              </div>
              <select
                value={studyDraftBook}
                onChange={(e) => setStudyDraftBook(e.target.value)}
                style={{
                  width: "100%",
                  padding: "11px 13px",
                  borderRadius: "10px",
                  border: "1px solid var(--border)",
                  background: "var(--panel)",
                  color: "var(--text)",
                  fontSize: "14px",
                  fontFamily: "inherit",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              >
                <option value="master">Master Book</option>
                {books
                  .filter((b) => !b.isMaster)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                <option value="__new__">+ New session…</option>
              </select>
              {studyDraftBook === "__new__" && (
                <input
                  value={studyDraftNewName}
                  onChange={(e) => setStudyDraftNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createStudyFromDraft();
                  }}
                  placeholder="New session name (optional)"
                  style={{
                    width: "100%",
                    marginTop: "8px",
                    padding: "11px 13px",
                    borderRadius: "10px",
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                    color: "var(--text)",
                    fontSize: "14px",
                    fontFamily: "inherit",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              )}
            </div>
            <div
              style={{
                display: "flex",
                gap: "10px",
                marginTop: "16px",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={() => setStudyDraftRefs(null)}
                style={{
                  padding: "10px 16px",
                  borderRadius: "10px",
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text)",
                  cursor: "pointer",
                  fontSize: "13.5px",
                  fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
              <button
                onClick={createStudyFromDraft}
                style={{
                  padding: "10px 18px",
                  borderRadius: "10px",
                  border: "none",
                  background: ICON_ACCENT,
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "13.5px",
                  fontWeight: 700,
                  fontFamily: "inherit",
                }}
              >
                Create study
              </button>
            </div>
          </div>
        </div>
      )}

      {sendRefs && (
        <div
          className="scribal-fade"
          onClick={() => {
            setSendRefs(null);
            setSendPicking(false);
            setSendTablesPicking(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 380,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          <div
            className="scribal-rise"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: "420px",
              background: "var(--bg)",
              color: "var(--text)",
              borderRadius: "16px",
              border: "1px solid var(--border)",
              padding: "20px",
              boxShadow: "0 24px 70px rgba(0,0,0,0.4)",
            }}
          >
            {sendTablesPicking ? (
              <>
                <div style={{ fontSize: "16px", fontWeight: 700 }}>
                  Add to a study table
                </div>
                <div
                  style={{
                    fontSize: "12.5px",
                    color: "var(--muted)",
                    marginTop: "3px",
                  }}
                >
                  {sendRefs.length === 1
                    ? "1 verse"
                    : sendRefs.length + " verses"}{" "}
                  will be set aside in the table’s stored verses.
                </div>
                {studyTables.length > 0 && (
                  <div
                    style={{
                      marginTop: "14px",
                      maxHeight: "300px",
                      overflowY: "auto",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    {studyTables.map((t) => {
                      const n = t.cards.length;
                      const shelfN = (t.shelf || []).length;
                      return (
                        <button
                          key={t.id}
                          onClick={() => {
                            const refs = sendRefs;
                            setSendRefs(null);
                            setSendTablesPicking(false);
                            sendVersesToTableShelf(t.id, refs);
                          }}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "11px 13px",
                            borderRadius: "10px",
                            border: "1px solid var(--border)",
                            background: "var(--panel)",
                            color: "var(--text)",
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
                            {t.name || "Untitled table"}
                          </div>
                          <div
                            style={{
                              fontSize: "12px",
                              color: "var(--muted)",
                              marginTop: "2px",
                            }}
                          >
                            {n === 1 ? "1 card" : n + " cards"}
                            {shelfN ? " · " + shelfN + " set aside" : ""}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                <button
                  onClick={() => {
                    const refs = sendRefs;
                    setSendRefs(null);
                    setSendTablesPicking(false);
                    sendVersesToNewTable(refs);
                  }}
                  style={{
                    width: "100%",
                    marginTop: "10px",
                    padding: "12px 14px",
                    borderRadius: "10px",
                    border: "1px dashed var(--border)",
                    background: "transparent",
                    color: "var(--text)",
                    fontSize: "14px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  + New study table
                </button>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-start",
                    marginTop: "14px",
                  }}
                >
                  <button
                    onClick={() => setSendTablesPicking(false)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--muted)",
                      fontSize: "13.5px",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      padding: "6px 4px",
                    }}
                  >
                    Back
                  </button>
                </div>
              </>
            ) : !sendPicking ? (
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
                    color: "var(--muted)",
                    marginTop: "3px",
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
                    onLinkStudy(refs);
                  }}
                  style={{
                    width: "100%",
                    marginTop: "16px",
                    padding: "12px 14px",
                    borderRadius: "10px",
                    border: "none",
                    background: ICON_ACCENT,
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
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                    color: "var(--text)",
                    fontSize: "14px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Add to an existing study
                </button>
                <button
                  onClick={() => setSendTablesPicking(true)}
                  style={{
                    width: "100%",
                    marginTop: "10px",
                    padding: "12px 14px",
                    borderRadius: "10px",
                    border: "1px solid #16a34a",
                    background: "transparent",
                    color: "#16a34a",
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
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="M3 9h18M9 20V9" />
                  </svg>
                  Set aside in a study table
                </button>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    marginTop: "14px",
                  }}
                >
                  <button
                    onClick={() => {
                      setSendRefs(null);
                      setSendPicking(false);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--muted)",
                      fontSize: "13.5px",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      padding: "6px 4px",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: "16px", fontWeight: 700 }}>
                  Add to a study
                </div>
                <div
                  style={{
                    fontSize: "12.5px",
                    color: "var(--muted)",
                    marginTop: "3px",
                  }}
                >
                  {sendRefs.length === 1 ? "1 verse" : sendRefs.length + " verses"}{" "}
                  will be added to the study you pick.
                </div>
                {searchStudies.length === 0 ? (
                  <div
                    style={{
                      marginTop: "16px",
                      fontSize: "13.5px",
                      color: "var(--muted)",
                      lineHeight: 1.5,
                    }}
                  >
                    You don’t have any studies to add to yet. Create one instead.
                  </div>
                ) : (
                  <div
                    style={{
                      marginTop: "14px",
                      maxHeight: "320px",
                      overflowY: "auto",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    {searchStudies.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          const refs = sendRefs;
                          setSendRefs(null);
                          setSendPicking(false);
                          askConfirm({
                            title: "Add to “" + (s.name || "this study") + "”?",
                            body:
                              (refs.length === 1
                                ? "1 verse"
                                : refs.length + " verses") +
                              " will be added. This study currently lives in " +
                              bookLabel(s.bookId) +
                              ".",
                            confirmLabel: "Add",
                            onConfirm: () =>
                              sendToExistingStudy(s, refs, false),
                            secondaryLabel: "Add & move to a new session book",
                            onSecondary: () =>
                              sendToExistingStudy(s, refs, true),
                          });
                        }}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "11px 13px",
                          borderRadius: "10px",
                          border: "1px solid var(--border)",
                          background: "var(--panel)",
                          color: "var(--text)",
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
                            color: "var(--muted)",
                            marginTop: "2px",
                          }}
                        >
                          {bookLabel(s.bookId)} ·{" "}
                          {s.refs.length === 1
                            ? "1 verse"
                            : s.refs.length + " verses"}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    gap: "10px",
                    justifyContent: "space-between",
                    marginTop: "16px",
                  }}
                >
                  <button
                    onClick={() => setSendPicking(false)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--muted)",
                      fontSize: "13.5px",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      padding: "6px 4px",
                    }}
                  >
                    Back
                  </button>
                  {searchStudies.length === 0 && (
                    <button
                      onClick={() => {
                        const refs = sendRefs;
                        setSendRefs(null);
                        setSendPicking(false);
                        onLinkStudy(refs);
                      }}
                      style={{
                        padding: "10px 16px",
                        borderRadius: "10px",
                        border: "none",
                        background: ICON_ACCENT,
                        color: "#fff",
                        fontSize: "13.5px",
                        fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Create a new study
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {moveTarget && (
        <div
          className="scribal-fade"
          onClick={() => setMoveTarget(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 380,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          <div
            className="scribal-rise"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: "420px",
              background: "var(--bg)",
              color: "var(--text)",
              borderRadius: "16px",
              border: "1px solid var(--border)",
              padding: "20px",
              boxShadow: "0 24px 70px rgba(0,0,0,0.4)",
            }}
          >
            <div style={{ fontSize: "16px", fontWeight: 700 }}>
              Move to a session
            </div>
            <div
              style={{
                fontSize: "12.5px",
                color: "var(--muted)",
                marginTop: "3px",
              }}
            >
              Moves the study and its marks into the chosen book and clears them
              from the old one.
            </div>
            <div style={{ marginTop: "14px" }}>
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--muted)",
                  marginBottom: "6px",
                }}
              >
                Marks save to
              </div>
              <select
                value={moveStudyBook}
                onChange={(e) => setMoveStudyBook(e.target.value)}
                style={{
                  width: "100%",
                  padding: "11px 13px",
                  borderRadius: "10px",
                  border: "1px solid var(--border)",
                  background: "var(--panel)",
                  color: "var(--text)",
                  fontSize: "14px",
                  fontFamily: "inherit",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              >
                <option value="master">Master Book</option>
                {books
                  .filter((b) => !b.isMaster)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                <option value="__new__">+ New session…</option>
              </select>
              {moveStudyBook === "__new__" && (
                <input
                  value={moveStudyNewName}
                  onChange={(e) => setMoveStudyNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmMoveStudy();
                  }}
                  placeholder="New session name (optional)"
                  style={{
                    width: "100%",
                    marginTop: "8px",
                    padding: "11px 13px",
                    borderRadius: "10px",
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                    color: "var(--text)",
                    fontSize: "14px",
                    fontFamily: "inherit",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              )}
            </div>
            <div
              style={{
                display: "flex",
                gap: "10px",
                marginTop: "16px",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={() => setMoveTarget(null)}
                style={{
                  padding: "10px 16px",
                  borderRadius: "10px",
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text)",
                  cursor: "pointer",
                  fontSize: "13.5px",
                  fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmMoveStudy}
                style={{
                  padding: "10px 18px",
                  borderRadius: "10px",
                  border: "none",
                  background: ICON_ACCENT,
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "13.5px",
                  fontWeight: 700,
                  fontFamily: "inherit",
                }}
              >
                Move study
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmAction && (
        <div
          onClick={() => setConfirmAction(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 3000,
            backgroundColor: "rgba(0,0,0,0.45)",
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
              backgroundColor: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "16px",
              padding: "22px 22px 18px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
            }}
          >
            <h3 style={{ margin: "0 0 8px 0", fontSize: "17px", fontWeight: 600 }}>
              {confirmAction.title}
            </h3>
            <p
              style={{
                margin: "0 0 20px 0",
                fontSize: "14px",
                lineHeight: 1.5,
                color: "var(--muted)",
              }}
            >
              {confirmAction.body}
            </p>
            {confirmAction.onSecondary && (
              <button
                onClick={() => {
                  const fn = confirmAction.onSecondary!;
                  setConfirmAction(null);
                  fn();
                }}
                style={{
                  width: "100%",
                  marginBottom: "10px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  borderRadius: "10px",
                  padding: "10px 16px",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {confirmAction.secondaryLabel}
              </button>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
              }}
            >
              <button
                onClick={() => setConfirmAction(null)}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  borderRadius: "10px",
                  padding: "9px 16px",
                  fontSize: "14px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {confirmAction.cancelLabel}
              </button>
              <button
                onClick={() => {
                  const fn = confirmAction.onConfirm;
                  setConfirmAction(null);
                  fn();
                }}
                style={{
                  background: "#c0392b",
                  border: "none",
                  color: "#fff",
                  borderRadius: "10px",
                  padding: "9px 16px",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {confirmAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {printData && (
        <PrintView
          view={printData.view as "outline" | "charting"}
          title={printData.title}
          compileTabs={printData.compileTabs}
          marks={printData.marks}
          colorLabels={printData.colorLabels}
          notes={printData.notes}
          tags={printData.tags}
          onClose={() => setPrintData(null)}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files && e.target.files[0];
          if (f) importData(f);
          e.target.value = "";
        }}
      />

      {/* ============ HEADER ============ */}
      <div
        ref={headerRef}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "18px",
          padding: "18px 30px",
          backgroundColor: "var(--panel)",
          borderBottom: "1px solid var(--border)",
          position: "sticky",
          top: 0,
          zIndex: 40,
          flexWrap: "wrap",
        }}
      >
        {/* Left zone: brand + study book */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "14px",
            minWidth: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "11px" }}>
            <ScribalMark size={36} />
            <ScribalWordmark size={23} />
          </div>

          {vDivider}

          {/* Study-book selector */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setBookMenuOpen((o) => !o)}
              title="Switch study book"
              style={{
                height: "40px",
                padding: "0 16px",
                borderRadius: "999px",
                border: isMasterActive
                  ? "1px solid var(--border)"
                  : "1px solid " + ICON_ACCENT,
                backgroundColor: isMasterActive ? "transparent" : "var(--soft)",
                color: "var(--text)",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span style={{ color: ICON_ACCENT, fontSize: "13px" }}>❖</span>
              {activeBookName}
              {!isMasterActive && (
                <span
                  style={{
                    fontSize: "9px",
                    letterSpacing: "1px",
                    color: ICON_ACCENT,
                    border: "1px solid " + ICON_ACCENT,
                    borderRadius: "999px",
                    padding: "1px 6px",
                  }}
                >
                  SESSION
                </span>
              )}
              <span style={{ fontSize: "9px", color: "var(--muted)" }}>▼</span>
            </button>

            {bookMenuOpen && (
              <>
                <div
                  onClick={() => {
                    setBookMenuOpen(false);
                    setEditingBookId(null);
                  }}
                  style={{ position: "fixed", inset: 0, zIndex: 40 }}
                />
                <div
                  className="scribal-pop"
                  style={{
                    position: "absolute",
                    top: "40px",
                    left: 0,
                    width: "300px",
                    backgroundColor: "var(--panel)",
                    border: "1px solid var(--border)",
                    borderRadius: "14px",
                    boxShadow: "0 16px 40px rgba(0,0,0,0.22)",
                    padding: "8px",
                    zIndex: 41,
                  }}
                >
                  <div
                    style={{
                      fontSize: "10px",
                      letterSpacing: "2px",
                      textTransform: "uppercase",
                      color: "var(--muted)",
                      padding: "6px 8px 8px",
                    }}
                  >
                    Study books
                  </div>

                  {[...books]
                    .sort((a, b) => {
                      if (a.isMaster) return -1;
                      if (b.isMaster) return 1;
                      return b.lastStudiedAt - a.lastStudiedAt;
                    })
                    .map((b) => {
                    const active = b.id === activeBookId;
                    const editing = editingBookId === b.id;
                    return (
                      <div
                        key={b.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          padding: "8px 8px",
                          borderRadius: "9px",
                          backgroundColor: active
                            ? "var(--soft)"
                            : "transparent",
                        }}
                      >
                        <span
                          onClick={() => {
                            setActiveTabBook(b.id);
                            setBookMenuOpen(false);
                          }}
                          style={{
                            cursor: "pointer",
                            color: active ? "var(--text)" : "var(--muted)",
                            fontSize: "12px",
                            width: "14px",
                            flexShrink: 0,
                          }}
                        >
                          {active ? "●" : "○"}
                        </span>

                        {editing ? (
                          <input
                            autoFocus
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            onBlur={saveEditBook}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEditBook();
                              if (e.key === "Escape") {
                                setEditingBookId(null);
                                setEditDraft("");
                              }
                            }}
                            style={{
                              flex: 1,
                              border: "1px solid var(--border)",
                              borderRadius: "6px",
                              padding: "4px 8px",
                              fontSize: "13px",
                              background: "var(--bg)",
                              color: "var(--text)",
                              outline: "none",
                            }}
                          />
                        ) : (
                          <div
                            onClick={() => {
                              setActiveTabBook(b.id);
                              setBookMenuOpen(false);
                            }}
                            style={{ flex: 1, cursor: "pointer" }}
                          >
                            <div
                              style={{
                                fontSize: "13.5px",
                                fontWeight: active ? 600 : 400,
                                color: "var(--text)",
                              }}
                            >
                              {b.name}
                              {b.isMaster && (
                                <span
                                  style={{
                                    fontSize: "10px",
                                    color: "var(--muted)",
                                    marginLeft: "6px",
                                  }}
                                >
                                  · default
                                </span>
                              )}
                            </div>
                            <div
                              style={{
                                fontSize: "10px",
                                color: "var(--muted)",
                                marginTop: "1px",
                              }}
                            >
                              {b.isMaster
                                ? "always available"
                                : "studied " + fmtStudied(b.lastStudiedAt)}
                            </div>
                          </div>
                        )}

                        <span
                          style={{
                            fontSize: "11px",
                            color: "var(--muted)",
                            flexShrink: 0,
                          }}
                        >
                          {b.markCount}
                        </span>

                        {!b.isMaster && !editing && (
                          <button
                            onClick={() => startEditBook(b.id, b.name)}
                            title="Rename"
                            style={{
                              background: "transparent",
                              border: "none",
                              color: "var(--muted)",
                              cursor: "pointer",
                              fontSize: "12px",
                              padding: "2px",
                            }}
                          >
                            ✎
                          </button>
                        )}
                        {!b.isMaster && !editing && (
                          <button
                            onClick={() => handleDeleteBook(b)}
                            title="Delete session"
                            style={{
                              background: "transparent",
                              border: "none",
                              color: "var(--muted)",
                              cursor: "pointer",
                              fontSize: "12px",
                              padding: "2px",
                            }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    );
                  })}

                  <div
                    style={{
                      height: "1px",
                      backgroundColor: "var(--border)",
                      margin: "6px 4px",
                    }}
                  />
                  <div
                    onClick={handleNewSession}
                    style={{
                      padding: "9px 10px",
                      borderRadius: "9px",
                      cursor: "pointer",
                      fontSize: "13px",
                      color: "var(--text)",
                      fontWeight: 500,
                    }}
                  >
                    + New session
                  </div>
                  <div
                    style={{
                      padding: "4px 10px 6px",
                      fontSize: "11px",
                      color: "var(--muted)",
                      lineHeight: 1.45,
                    }}
                  >
                    Sessions are separate workspaces — marks made here never
                    touch your Master Book.
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right zone: grouped controls */}
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          {/* Find group */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              data-tour="search"
              onClick={() => setShowSearch(true)}
              title="Search (Ctrl/Cmd+K)"
              style={pillStyle}
            >
              {purpleIcon(<IconSearch size={17} />)}
              Search
            </button>
            <button
              data-tour="studies"
              onClick={() => setStudiesOpen(true)}
              title="Every study you've done"
              style={pillStyle}
            >
              {purpleIcon(<IconStudies size={17} />)}
              Studies
              {searchStudies.length > 0 && (
                <span
                  style={{
                    fontSize: "10px",
                    color: "var(--muted)",
                    backgroundColor: "var(--bg)",
                    borderRadius: "999px",
                    padding: "0 6px",
                  }}
                >
                  {searchStudies.length}
                </span>
              )}
            </button>
          </div>

          {vDivider}

          {/* Tools group */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {(() => {
              const timeStr = lastSync
                ? new Date(lastSync).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : null;
              const stale = driveConnected && saveStatus === "stale";
              const label = !cloudSignedIn
                ? "Local only"
                : cloudSyncing
                ? "Saving…"
                : "Synced" + (timeStr ? " ✓ " + timeStr : " ✓");
              const onClick = !cloudSignedIn
                ? () => setBackupOpen(true)
                : stale
                ? reconnectDrive
                : undefined;
              return (
                <span
                  onClick={onClick}
                  title={
                    !cloudSignedIn
                      ? "Saved on this device only — click to sign in with Google and sync across your devices."
                      : timeStr
                      ? "Last synced at " + timeStr
                      : "Synced to the cloud"
                  }
                  style={{
                    fontSize: "11px",
                    borderRadius: "999px",
                    padding: "4px 11px",
                    whiteSpace: "nowrap",
                    cursor: onClick ? "pointer" : "default",
                    color: "var(--muted)",
                    backgroundColor: "transparent",
                    border: "1px solid var(--border)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                  }}
                >
                  {cloudSignedIn && cloudSyncing && (
                    <span className="scribal-spinner" />
                  )}
                  {label}
                </span>
              );
            })()}
            <div style={{ position: "relative" }}>
              <button
                data-tour="more"
                onClick={() => setBackupOpen((o) => !o)}
                title="More — display, study books, shortcuts, back up"
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "50%",
                  border: "1px solid var(--border)",
                  backgroundColor: "transparent",
                  color: "var(--muted)",
                  cursor: "pointer",
                  fontSize: "22px",
                  lineHeight: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                ⋯
              </button>
              {backupOpen && (
                <>
                  <div
                    onClick={() => setBackupOpen(false)}
                    style={{ position: "fixed", inset: 0, zIndex: 40 }}
                  />
                  <div
                    className="scribal-pop"
                    style={{
                      position: "absolute",
                      top: "38px",
                      right: 0,
                      width: "240px",
                      backgroundColor: "var(--panel)",
                      border: "1px solid var(--border)",
                      borderRadius: "12px",
                      boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
                      padding: "6px",
                      zIndex: 41,
                    }}
                  >
                    <div
                      onClick={() => setDark(!dark)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "13px",
                        color: "var(--text)",
                      }}
                    >
                      {dark ? (
                        <>
                          <span
                            style={{
                              display: "inline-flex",
                              verticalAlign: "-2px",
                              marginRight: "6px",
                            }}
                          >
                            <IconSun size={14} />
                          </span>
                          Light mode
                        </>
                      ) : (
                        <>
                          <span
                            style={{
                              display: "inline-flex",
                              verticalAlign: "-2px",
                              marginRight: "6px",
                            }}
                          >
                            <IconMoon size={14} />
                          </span>
                          Dark mode
                        </>
                      )}
                    </div>
                    <div
                      onClick={() => {
                        setBackupOpen(false);
                        setMode("vault");
                      }}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "13px",
                        color: "var(--text)",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          verticalAlign: "-2px",
                          marginRight: "6px",
                        }}
                      >
                        <IconBook size={14} />
                      </span>
                      Vault
                    </div>
                    <div
                      style={{
                        height: "1px",
                        backgroundColor: "var(--border)",
                        margin: "6px 4px",
                      }}
                    />
                    <div
                      onClick={() => {
                        setBackupOpen(false);
                        setExampleOpen(false);
                        setWalkOpen(true);
                      }}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "13px",
                        color: "var(--text)",
                      }}
                    >
                      ▶ Take the guided tour
                    </div>
                    <div
                      onClick={() => {
                        setBackupOpen(false);
                        setSlidesOpen(true);
                      }}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "13px",
                        fontWeight: 600,
                        color: "var(--text)",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor = "var(--soft)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = "transparent")
                      }
                    >
                      ◈ How Scribal works
                    </div>
                    <div
                      onClick={() => {
                        setBackupOpen(false);
                        setExampleOpen(true);
                      }}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "13px",
                        color: "var(--text)",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          verticalAlign: "-2px",
                          marginRight: "6px",
                        }}
                      >
                        <IconBulb size={14} />
                      </span>
                      See how it works
                    </div>
                    <div
                      onClick={() => {
                        setBackupOpen(false);
                        setShowShortcuts(true);
                      }}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "13px",
                        color: "var(--text)",
                      }}
                    >
                      ⌨ Keyboard shortcuts
                    </div>
                    <div
                      style={{
                        height: "1px",
                        backgroundColor: "var(--border)",
                        margin: "6px 4px",
                      }}
                    />
                    <div
                      onClick={exportData}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "13px",
                        color: "var(--text)",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          verticalAlign: "-2px",
                          marginRight: "6px",
                        }}
                      >
                        <IconDownload size={14} />
                      </span>
                      Export my study (.json)
                    </div>
                    <div
                      onClick={() => {
                        setBackupOpen(false);
                        fileInputRef.current && fileInputRef.current.click();
                      }}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "13px",
                        color: "var(--text)",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          verticalAlign: "-2px",
                          marginRight: "6px",
                        }}
                      >
                        <IconUpload size={14} />
                      </span>
                      Restore from backup
                    </div>
                    <div
                      style={{
                        height: "1px",
                        backgroundColor: "var(--border)",
                        margin: "6px 4px",
                      }}
                    />
                    {cloudSignedIn ? (
                      <>
                        {cloudEmail && (
                          <div
                            style={{
                              padding: "10px 12px",
                              fontSize: "13px",
                              color: "var(--muted)",
                            }}
                          >
                            {cloudEmail}
                          </div>
                        )}
                        <div
                          onClick={() => {
                            signOutCloud().catch(() => {});
                          }}
                          style={{
                            padding: "10px 12px",
                            borderRadius: "8px",
                            cursor: "pointer",
                            fontSize: "13px",
                            color: "var(--text)",
                          }}
                        >
                          Sign out
                        </div>
                      </>
                    ) : (
                      <div
                        onClick={() => {
                          cloudSignIn().catch(() => {});
                        }}
                        style={{
                          padding: "10px 12px",
                          borderRadius: "8px",
                          cursor: "pointer",
                          fontSize: "13px",
                          color: "var(--text)",
                        }}
                      >
                        <span
                          style={{
                            display: "inline-flex",
                            verticalAlign: "-2px",
                            marginRight: "6px",
                          }}
                        >
                          <IconKey size={14} />
                        </span>
                        Sign in with Google
                      </div>
                    )}
                    {SHOW_LEGACY_DRIVE && (
                      <>
                        <div
                          onClick={connectDrive}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "13px",
                        color: "var(--text)",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          verticalAlign: "-2px",
                          marginRight: "6px",
                        }}
                      >
                        <IconKey size={14} />
                      </span>
                      Sign in with Google
                    </div>
                    <div
                      onClick={saveToDrive}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "13px",
                        color: "var(--text)",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          verticalAlign: "-2px",
                          marginRight: "6px",
                        }}
                      >
                        <IconCloud size={14} />
                      </span>
                      Save to Google Drive
                    </div>
                    <div
                      onClick={loadFromDrive}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "13px",
                        color: "var(--text)",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          verticalAlign: "-2px",
                          marginRight: "6px",
                        }}
                      >
                        <IconDownload size={14} />
                      </span>
                      Load from Google Drive
                    </div>
                    <div
                      onClick={runDiag}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "13px",
                        color: "var(--text)",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          verticalAlign: "-2px",
                          marginRight: "6px",
                        }}
                      >
                        <IconSearch size={14} />
                      </span>
                      Check sync
                    </div>
                      </>
                    )}
                    {diag && (
                      <div
                        style={{
                          margin: "4px 12px 6px",
                          padding: "10px 12px",
                          fontSize: "11px",
                          color: "var(--text)",
                          lineHeight: 1.5,
                          whiteSpace: "pre-line",
                          fontFamily: "monospace",
                          background: "var(--panel-soft, rgba(127,127,127,0.12))",
                          borderRadius: "8px",
                        }}
                      >
                        {diag}
                      </div>
                    )}
                    {driveMsg && (
                      <div
                        style={{
                          padding: "4px 12px 6px",
                          fontSize: "11px",
                          color: "var(--muted)",
                          lineHeight: 1.4,
                        }}
                      >
                        {driveMsg}
                      </div>
                    )}
                    <div
                      style={{
                        padding: "6px 12px 2px",
                        fontSize: "11px",
                        color: "var(--muted)",
                        lineHeight: 1.45,
                      }}
                    >
                      Restoring replaces current data and reloads.
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {vDivider}

          {/* View / mode group */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ position: "relative" }}>
              {roundUtil(
                <span style={{ color: ICON_ACCENT, fontWeight: 700 }}>Aa</span>,
                () => setReadingOpen((o) => !o),
                "Reading — text size, spacing, tone"
              )}
              {readingOpen && (
                <>
                  <div
                    onClick={() => setReadingOpen(false)}
                    style={{ position: "fixed", inset: 0, zIndex: 40 }}
                  />
                  <div
                    className="scribal-pop"
                    style={{
                      position: "absolute",
                      top: "38px",
                      right: 0,
                      width: "248px",
                      backgroundColor: "var(--panel)",
                      border: "1px solid var(--border)",
                      borderRadius: "12px",
                      boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
                      padding: "14px",
                      zIndex: 41,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: "12px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          color: "var(--text)",
                        }}
                      >
                        Text size
                      </span>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
                        <button
                          onClick={() =>
                            setReading((r) => ({
                              ...r,
                              fontScale: Math.max(
                                0.8,
                                +(r.fontScale - 0.1).toFixed(2)
                              ),
                            }))
                          }
                          disabled={reading.fontScale <= 0.8}
                          style={{
                            ...readingStepBtn,
                            opacity: reading.fontScale <= 0.8 ? 0.4 : 1,
                            cursor:
                              reading.fontScale <= 0.8 ? "default" : "pointer",
                          }}
                        >
                          A−
                        </button>
                        <span
                          style={{
                            minWidth: "44px",
                            textAlign: "center",
                            fontSize: "12px",
                            color: "var(--muted)",
                          }}
                        >
                          {Math.round(reading.fontScale * 100)}%
                        </span>
                        <button
                          onClick={() =>
                            setReading((r) => ({
                              ...r,
                              fontScale: Math.min(
                                1.7,
                                +(r.fontScale + 0.1).toFixed(2)
                              ),
                            }))
                          }
                          disabled={reading.fontScale >= 1.7}
                          style={{
                            ...readingStepBtn,
                            fontSize: "16px",
                            opacity: reading.fontScale >= 1.7 ? 0.4 : 1,
                            cursor:
                              reading.fontScale >= 1.7 ? "default" : "pointer",
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
                        marginBottom: "14px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          color: "var(--text)",
                        }}
                      >
                        Line spacing
                      </span>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
                        <button
                          onClick={() =>
                            setReading((r) => ({
                              ...r,
                              lineScale: Math.max(
                                1.5,
                                +(r.lineScale - 0.15).toFixed(2)
                              ),
                            }))
                          }
                          disabled={reading.lineScale <= 1.5}
                          style={{
                            ...readingStepBtn,
                            fontSize: "16px",
                            opacity: reading.lineScale <= 1.5 ? 0.4 : 1,
                            cursor:
                              reading.lineScale <= 1.5 ? "default" : "pointer",
                          }}
                        >
                          −
                        </button>
                        <span
                          style={{
                            minWidth: "54px",
                            textAlign: "center",
                            fontSize: "12px",
                            color: "var(--muted)",
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
                          onClick={() =>
                            setReading((r) => ({
                              ...r,
                              lineScale: Math.min(
                                2.3,
                                +(r.lineScale + 0.15).toFixed(2)
                              ),
                            }))
                          }
                          disabled={reading.lineScale >= 2.3}
                          style={{
                            ...readingStepBtn,
                            fontSize: "16px",
                            opacity: reading.lineScale >= 2.3 ? 0.4 : 1,
                            cursor:
                              reading.lineScale >= 2.3 ? "default" : "pointer",
                          }}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <button
                      onClick={() =>
                        setReading((r) => ({ ...r, warm: !r.warm }))
                      }
                      style={{
                        width: "100%",
                        padding: "11px",
                        borderRadius: "9px",
                        border: "1px solid var(--border)",
                        background: reading.warm ? "var(--text)" : "transparent",
                        color: reading.warm ? "var(--bg)" : "var(--text)",
                        fontSize: "13px",
                        fontWeight: 600,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {reading.warm ? "Warm tone: on" : "Warm tone: off"}
                    </button>
                  </div>
                </>
              )}
            </div>
            <div style={{ position: "relative" }}>
              {roundUtil(
                purpleIcon(<IconDrop size={18} />),
                () => setColorOpen((o) => !o),
                "Marks — color intensity / saturation"
              )}
              {colorOpen && (
                <>
                  <div
                    onClick={() => setColorOpen(false)}
                    style={{ position: "fixed", inset: 0, zIndex: 40 }}
                  />
                  <div
                    className="scribal-pop"
                    style={{
                      position: "absolute",
                      top: "38px",
                      right: 0,
                      width: "280px",
                      backgroundColor: "var(--panel)",
                      border: "1px solid var(--border)",
                      borderRadius: "12px",
                      boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
                      padding: "16px",
                      zIndex: 41,
                    }}
                  >
                    <div
                      style={{
                        marginBottom: "14px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          color: "var(--text)",
                          display: "block",
                          marginBottom: "10px",
                        }}
                      >
                        Mark Saturation
                      </span>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                        }}
                      >
                        <input
                          type="range"
                          min="0.6"
                          max="1.5"
                          step="0.05"
                          value={colorIntensity}
                          onChange={(e) => setColorIntensity(parseFloat(e.target.value))}
                          style={{
                            flex: 1,
                            cursor: "pointer",
                          }}
                        />
                        <span
                          style={{
                            minWidth: "44px",
                            textAlign: "right",
                            fontSize: "12px",
                            color: "var(--muted)",
                            fontWeight: 600,
                          }}
                        >
                          {(colorIntensity * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div
                        style={{
                          marginTop: "10px",
                          display: "flex",
                          gap: "6px",
                          fontSize: "11px",
                          color: "var(--muted)",
                        }}
                      >
                        <span style={{ flex: 1 }}>Soft</span>
                        <span style={{ flex: 1, textAlign: "center" }}>Normal</span>
                        <span style={{ flex: 1, textAlign: "right" }}>Bold</span>
                      </div>
                    </div>
                    <div
                      style={{
                        borderTop: "1px solid var(--border)",
                        paddingTop: "12px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "12px",
                          color: "var(--muted)",
                          display: "block",
                          marginBottom: "8px",
                        }}
                      >
                        Preview:
                      </span>
                      <div
                        style={{
                          display: "flex",
                          gap: "6px",
                          flexWrap: "wrap",
                        }}
                      >
                        {COLORS.map((c) => (
                          <div
                            key={c}
                            style={{
                              width: "20px",
                              height: "20px",
                              backgroundColor: applyIntensityToTheme(
                                dark ? DARK_THEME : LIGHT_THEME,
                                colorIntensity
                              )[`--hl${c}`],
                              borderRadius: "4px",
                              border: "1px solid var(--border)",
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
            {roundUtil(
              purpleIcon(<IconUndo size={17} />),
              undo,
              "Undo (Ctrl/Cmd+Z)",
              !canUndo
            )}
            {roundUtil(
              purpleIcon(<IconRedo size={17} />),
              redo,
              "Redo (Ctrl/Cmd+Shift+Z)",
              !canRedo
            )}
            {vDivider}
            {mode === "read" &&
              actionButton(sidebarOpen ? "Hide marks" : "Show marks", () =>
                setSidebarOpen(!sidebarOpen)
              )}
            {mode === "read" &&
              actionButton("Study tables", () => setMode("table"))}
            {mode === "read" && (
              <span data-tour="compile" style={{ display: "inline-flex" }}>
                {actionButton(
                  "Compile →",
                  activeTab.studyId
                    ? () => {
                        const st = searchStudies.find(
                          (s) => s.id === activeTab.studyId
                        );
                        if (!st) return;
                        if (st.linkedScope) compileLinkedSearch(st);
                        else startStudyCompile(st);
                      }
                    : startCompile,
                  true
                )}
              </span>
            )}
            {mode === "compile" &&
              actionButton(
                "← Back to Reading",
                () => {
                  setMode("read");
                  setCompileStudyId(null);
                },
                true
              )}
            {mode === "vault" &&
              actionButton("← Close Vault", () => setMode("read"), true)}
          </div>
        </div>
      </div>

      {mode === "read" && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "8px",
            padding: "10px 16px",
            backgroundColor: "var(--bg)",
            borderBottom: "1px solid var(--border)",
            flexWrap: "wrap",
            position: "sticky",
            top: headerH,
            zIndex: 31,
          }}
          ref={tabsRef}
          data-tour="tabs"
        >
          {tabs.map((t) => {
            const active = t.id === activeTabId;
            const gid = chapterGroups[chapterScopeOf(t)];
            const kwStudy = t.studyId
              ? searchStudies.find((s) => s.id === t.studyId)
              : undefined;
            const kwLinked = !!kwStudy?.linkedScope;
            // A chapter is part of a combined study when a live keyword search
            // is linked into its scope. Every tab in a combined study - the
            // search and the chapters it compiles with - shares the combined
            // purple so they read as one study, matching the reading panels; a
            // plain chapter-only group keeps its own palette color.
            const chapterCombined =
              !t.studyId &&
              (() => {
                const r = resolveScope(chapterScopeOf(t));
                return searchStudies.some(
                  (s) =>
                    !isSearchStudyDeleted(s) &&
                    !!s.linkedScope &&
                    resolveScope(s.linkedScope) === r
                );
              })();
            const linked =
              (!t.studyId && !!gid) || kwLinked || chapterCombined;
            const linkColor =
              kwLinked || chapterCombined
                ? TYPE_PURPLE
                : gid
                ? groupColor(gid)
                : ACCENT;
            const tabBook = books.find((b) => b.id === (t.bookId || "master"));
            const tabBookLabel =
              !tabBook || tabBook.isMaster ? "Master" : tabBook.name;
            return (
              <div
                key={t.id}
                draggable={tabs.length > 1}
                onDragStart={(e) => {
                  dragTabRef.current = t.id;
                  setDraggingTab(t.id);
                  e.dataTransfer.effectAllowed = "move";
                  try {
                    e.dataTransfer.setData("text/plain", t.id);
                  } catch (err) {
                    /* some browsers require a payload; ignore if it throws */
                  }
                }}
                onDragEnd={() => {
                  dragTabRef.current = null;
                  setDraggingTab(null);
                  setDragOverTab(null);
                }}
                onDragOver={(e) => {
                  const from = dragTabRef.current;
                  if (!from || from === t.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  // Reorder live as the cursor crosses each pill, so the tab
                  // visibly slides into its new spot while you drag it (the
                  // panels follow because both are driven by the same order).
                  if (dragOverTab !== t.id) {
                    setDragOverTab(t.id);
                    reorderTabs(from, t.id);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  dragTabRef.current = null;
                  setDraggingTab(null);
                  setDragOverTab(null);
                }}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "3px",
                  cursor: tabs.length > 1 ? "grab" : "default",
                  opacity: draggingTab === t.id ? 0.4 : 1,
                  transform: draggingTab === t.id ? "scale(0.96)" : "scale(1)",
                  transition: "opacity 0.15s, transform 0.15s",
                }}
              >
                <span
                  title={tabBookLabel}
                  style={{
                    fontSize: "10px",
                    lineHeight: 1,
                    color: "var(--muted)",
                    fontFamily: "system-ui, sans-serif",
                    maxWidth: "170px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {tabBookLabel}
                </span>
                <div
                  onClick={() => setActiveTabId(t.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "7px 14px",
                    borderRadius: "999px",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: active ? 600 : 400,
                    backgroundColor: active
                      ? linked
                        ? linkColor
                        : "#57534e"
                      : "var(--panel)",
                    color: active ? "#fff" : "var(--text)",
                    border: linked
                      ? "2px solid " + linkColor
                      : active
                      ? "2px solid #57534e"
                      : "1px solid var(--border)",
                    transition: "all 0.15s",
                  }}
                >
                  {t.studyId && (
                    <span style={{ display: "inline-flex", flexShrink: 0 }}>
                      <IconSearch size={14} />
                    </span>
                  )}
                  {tabLabel(t)}
                  {tabs.length > 1 && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(t.id);
                      }}
                      style={{ fontSize: "14px", opacity: 0.6, lineHeight: 1 }}
                    >
                      ✕
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {tabs.length < 5 && (
            <button
              onClick={addNewTab}
              title="Open another tab"
              style={{
                width: "34px",
                height: "34px",
                borderRadius: "50%",
                border: "1px dashed var(--border)",
                backgroundColor: "transparent",
                color: "var(--muted)",
                cursor: "pointer",
                fontSize: "18px",
                lineHeight: 1,
              }}
            >
              +
            </button>
          )}
        </div>
      )}

      {mode === "read" && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "16px",
            flexWrap: "nowrap",
            overflowX: "auto",
            overflowY: "hidden",
            padding: "7px 16px",
            height: "46px",
            boxSizing: "border-box",
            backgroundColor: "var(--bg)",
            borderBottom: "1px solid var(--border)",
            position: "sticky",
            top: headerH + tabsH,
            zIndex: 24,
            fontSize: "11.5px",
          }}
        >
          {legendColors.length === 0 ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                color: "var(--muted)",
                opacity: 0.6,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  color: ACCENT,
                  opacity: 0.75,
                }}
              >
                <IconDrop size={13} />
              </span>
              Highlight a verse, then name its color here
            </span>
          ) : (
            legendColors.map((c) => {
            const editing = editingColor === c;
            const commit = () => {
              setScopedLabel(activeScope, c, colorDraft.trim());
              setEditingColor(null);
            };
            return (
              <span
                key={c}
                style={{ display: "flex", alignItems: "center", gap: "6px" }}
              >
                <span
                  style={{
                    width: "9px",
                    height: "9px",
                    borderRadius: "50%",
                    backgroundColor: COLOR_MAP[c],
                    flexShrink: 0,
                  }}
                />
                {editing ? (
                  <input
                    autoFocus
                    value={colorDraft}
                    onChange={(e) => setColorDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commit();
                      if (e.key === "Escape") setEditingColor(null);
                    }}
                    placeholder="Name this color"
                    style={{
                      fontSize: "11.5px",
                      padding: "2px 6px",
                      borderRadius: "6px",
                      border: "1px solid " + ACCENT,
                      boxShadow: "0 0 0 2px rgba(139,92,246,0.18)",
                      background: "var(--bg)",
                      color: "var(--text)",
                      outline: "none",
                      width: "130px",
                    }}
                  />
                ) : (
                  <span
                    onClick={() => {
                      setEditingColor(c);
                      setColorDraft(activeScopedLabels[c] || "");
                    }}
                    title={
                      activeScopedLabels[c]?.trim()
                        ? "Click to rename this color"
                        : "Click to name this color"
                    }
                    className="scribal-colorchip"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      color: activeScopedLabels[c]?.trim()
                        ? "var(--text)"
                        : "var(--muted)",
                      fontStyle: activeScopedLabels[c]?.trim()
                        ? "normal"
                        : "italic",
                      cursor: "pointer",
                      borderBottom: "1px dashed var(--muted)",
                      paddingBottom: "1px",
                      lineHeight: 1.2,
                      transition: "border-color 0.15s, color 0.15s",
                    }}
                  >
                    {activeScopedLabels[c]?.trim()
                      ? activeScopedLabels[c]
                      : "Name this color"}
                    <span
                      className="scribal-colorchip-pen"
                      style={{ display: "inline-flex", flexShrink: 0 }}
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </span>
                  </span>
                )}
              </span>
            );
          })
          )}
        </div>
      )}

      {mode === "read" && (
        <div style={{ display: "flex" }}>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              overflowX: tabs.length > 1 ? "auto" : "visible",
            }}
          >
            {tabs.map((t) => {
              const isActive = t.id === activeTabId;
              const multi = tabs.length > 1;
              const study = t.studyId
                ? searchStudies.find((s) => s.id === t.studyId)
                : undefined;
              const linkGid = !t.studyId
                ? chapterGroups[chapterScopeOf(t)]
                : undefined;
              // A chapter reads as "combined" (purple) when a live keyword
              // search is linked into it (or its group); otherwise it's a plain
              // chapter study (red). Derived live — no stored flag to drift.
              const chapterCombined =
                !t.studyId &&
                (() => {
                  const r = resolveScope(chapterScopeOf(t));
                  return searchStudies.some(
                    (s) =>
                      !isSearchStudyDeleted(s) &&
                      !!s.linkedScope &&
                      resolveScope(s.linkedScope) === r
                  );
                })();
              return [
                <div
                  key={t.id}
                  data-compile-tab={t.id}
                  onMouseDown={() => setActiveTabId(t.id)}
                  style={{
                    flex: multi ? "1 0 540px" : 1,
                    minWidth: 0,
                    borderRight: multi ? "1px solid var(--border)" : "none",
                    outline:
                      multi && isActive ? "2px solid " + ICON_ACCENT : "none",
                    outlineOffset: "-2px",
                    position: "relative",
                    overflow: "hidden",
                    height: `calc(100vh - ${headerH + tabsH + 46}px)`,
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      overflowY: "auto",
                    }}
                  >
                  {study && study.note && (
                    <div
                      style={{
                        padding: "12px 16px",
                        background: "var(--panel)",
                        borderBottom: "1px solid var(--border)",
                        fontSize: "13.5px",
                        lineHeight: 1.55,
                        color: "var(--text)",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {study.note}
                    </div>
                  )}
                  <VerseViewer
                toolHotkeys={toolHotkeys}
                    key={t.id}
                    selectedVolume={t.volume}
                    selectedBook={t.book}
                    selectedChapter={t.chapter}
                    onChange={(v, b, c) => updateTab(t.id, v, b, c)}
                    selectedTool={selectedTool}
                    selectedColor={selectedColor}
                    onChangeTool={setSelectedTool}
                    onChangeColor={setSelectedColor}
                    onMark={addMark}
                    onEraseMark={deleteMark}
                    onMarkMany={addMarks}
                    onDefine={handleDefine}
                    tags={wordTags}
                    onTagTap={openTagRef}
                    marks={getBook(t.bookId).marks}
                    showToolbar={isActive}
                    toolbarPos={toolbarPos}
                    onToolbarPos={setToolbarPos}
                    toolbarOrient={toolbarOrient}
                    onToolbarOrient={setToolbarOrient}
                    panelMode={multi}
                    controlsStickyTop={
                      // The reader column is its own fixed-height scroller in
                      // both single and multi pane, so the pinned header sits at
                      // the top of that scroller (0) in every case.
                      0
                    }
                    fontScale={reading.fontScale}
                    lineScale={reading.lineScale}
                    warm={reading.warm}
                    dark={dark}
                    sidebarOpen={sidebarOpen}
                    studyRefs={
                      study ? study.refs : t.studyId ? [] : undefined
                    }
                    studyTitle={study ? study.name : "Study"}
                    jumpTarget={isActive ? jumpTarget : null}
                    onJumpHandled={() => setJumpTarget(null)}
                    onSendVerses={(refs) => {
                      if (refs.length) {
                        setSendRefs(refs);
                        setSendPicking(false);
                        setSendTablesPicking(false);
                      }
                    }}
                    linkScriptures={
                      t.studyId
                        ? {
                            onClick: () =>
                              setLinkKwStudyId(t.studyId as string),
                            linked: !!study?.linkedScope,
                            color: study?.linkedScope
                              ? TYPE_PURPLE
                              : TYPE_BLUE,
                            title: study?.linkedScope
                              ? "Combined study — manage the link or unlink"
                              : "Link this search to a chapter so they compile together",
                          }
                        : {
                            onClick: () => openLinkPrompt(t),
                            linked: chapterCombined || !!linkGid,
                            color: chapterCombined ? TYPE_PURPLE : TYPE_RED,
                            title: chapterCombined
                              ? "Combined study — a keyword search is linked here"
                              : "Link this chapter — to other chapters or a keyword search",
                          }
                    }
                    onRemoveVerses={
                      t.studyId
                        ? (refs) =>
                            removeVersesFromStudy(t.studyId as string, refs)
                        : undefined
                    }
                  />
                  </div>
                  {growMoment &&
                    t.studyId &&
                    growMoment.studyId === t.studyId && (
                      <GrowPulse key={"grow_" + growMoment.key} fixed={!multi} />
                    )}
                </div>,
                mergeMoment && mergeMoment.sourceTabId === t.id ? (
                  <MergeSeam
                    key={"mergeseam_" + mergeMoment.key}
                    leftColor={mergeMoment.leftColor}
                    rightColor={mergeMoment.rightColor}
                    resultColor={mergeMoment.resultColor}
                    combined={mergeMoment.combined}
                  />
                ) : null,
              ];
            })}
          </div>

          {sidebarOpen && (
            <div
              style={{
                width: "260px",
                backgroundColor: "var(--panel)",
                padding: "16px",
                borderLeft: "1px solid var(--border)",
                overflowY: "auto",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginTop: 0,
                }}
              >
                <h3 style={{ margin: 0, fontSize: "14px" }}>
                  Marks ({groups.length})
                </h3>
                {groups.length > 0 && (
                  <button
                    onClick={() =>
                      askConfirm({
                        title: activeTab.studyId
                          ? "Clear all marks on this study?"
                          : "Clear all marks on this chapter?",
                        body:
                          "This removes every highlight, underline, and other mark here, regardless of color or style. You can undo it.",
                        confirmLabel: "Clear all",
                        onConfirm: () =>
                          clearMarks(Array.from(activeChapterRefs)),
                      })
                    }
                    title={`Remove every mark on ${
                      activeTab.studyId ? "this study" : "this chapter"
                    } (undoable)`}
                    style={{
                      fontSize: "11px",
                      color: "var(--muted)",
                      background: "none",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      padding: "3px 8px",
                      cursor: "pointer",
                    }}
                  >
                    Clear all
                  </button>
                )}
              </div>
              <p
                style={{
                  color: "var(--muted)",
                  fontSize: "11px",
                  marginTop: "-6px",
                }}
              >
                {activeBookName} · {tabLabel(activeTab)}
              </p>

              {groups.length === 0 && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    padding: "30px 16px",
                    gap: "9px",
                  }}
                >
                  <div
                    style={{
                      width: "46px",
                      height: "46px",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "1px solid var(--border)",
                      color: "var(--muted)",
                      opacity: 0.8,
                    }}
                  >
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M5 8h14" />
                      <path d="M5 12h10" />
                      <path d="M5 16h7" />
                    </svg>
                  </div>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "var(--text)",
                    }}
                  >
                    Nothing marked yet
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--muted)",
                      lineHeight: 1.6,
                      maxWidth: "230px",
                    }}
                  >
                    {activeTab.studyId
                      ? "Highlight or underline verses in this study and they'll show up here."
                      : "Highlight or underline verses and they'll show up here."}
                  </div>
                </div>
              )}

              {groups.map((group) => (
                <div
                  key={group.reference + "|" + group.color}
                  style={{
                    marginBottom: "10px",
                    padding: "10px",
                    backgroundColor: "var(--soft)",
                    borderRadius: "8px",
                    fontSize: "12px",
                    borderLeft: "4px solid " + COLOR_MAP[group.color],
                    position: "relative",
                  }}
                >
                  <button
                    onClick={() =>
                      askConfirm({
                        title: "Remove these marks?",
                        body:
                          "This removes all marks of this color on this verse. You can undo it.",
                        confirmLabel: "Remove",
                        onConfirm: () =>
                          deleteMarkGroup(group.reference, group.color),
                      })
                    }
                    title="Remove all marks of this color on this verse"
                    style={{
                      position: "absolute",
                      top: "6px",
                      right: "6px",
                      width: "20px",
                      height: "20px",
                      borderRadius: "50%",
                      border: "none",
                      backgroundColor: "var(--border)",
                      color: "var(--muted)",
                      cursor: "pointer",
                      fontSize: "11px",
                      lineHeight: "20px",
                      padding: 0,
                    }}
                  >
                    ✕
                  </button>
                  <strong>{group.reference}</strong>
                  {group.items.map((mark) => (
                    <p
                      key={mark.id}
                      style={{
                        margin: "6px 14px 0 0",
                        display: "flex",
                        gap: "6px",
                        alignItems: "baseline",
                      }}
                    >
                      <span
                        style={{
                          fontWeight: "bold",
                          color: COLOR_MAP[group.color],
                          fontSize: "11px",
                          flexShrink: 0,
                          width: "14px",
                        }}
                      >
                        {STYLE_LABELS[mark.style]}
                      </span>
                      <span style={{ color: "var(--text)" }}>
                        "{mark.markedText}"
                      </span>
                    </p>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === "table" && (
        <StudyTablesDesktop
          onClose={() => setMode("read")}
          headerOffset={headerH}
          allMarks={allMarks}
          getBook={getBook}
          books={books}
          recordedStudies={recordedStudies}
          searchStudies={searchStudies}
          chapterGroups={chapterGroups}
          tables={studyTables}
          createTable={createStudyTable}
          updateTable={updateStudyTable}
          renameTable={renameStudyTable}
          deleteTable={deleteStudyTable}
          createSession={createSession}
          openTableId={openTableId}
          onConsumeOpenTable={() => setOpenTableId(null)}
          onMarkVerses={openTableMarkPanel}
          onOpenReader={openTableReader}
          wordTags={wordTags}
          onTagTap={openTagRef}
        />
      )}

      {/* READER DOCK for the open study table: browse, mark, define, send */}
      {tableReader && (
        <div
          style={{
            position: "fixed",
            top: headerH,
            right: 0,
            bottom: 0,
            width: "min(500px, 94vw)",
            zIndex: 60,
            display: "flex",
            flexDirection: "column",
            background: "var(--panel)",
            borderLeft: "1px solid var(--border)",
            boxShadow: "-18px 0 40px -28px rgba(0,0,0,.35)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              flex: "0 0 auto",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>
                Reader
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 2,
                }}
              >
                <span style={{ fontSize: 11.5, color: "var(--muted)", flex: "0 0 auto" }}>
                  Marks go to
                </span>
                <select
                  value={tableReader.bookId}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__new") {
                      const name = window.prompt("Name the new session:");
                      if (name && name.trim()) {
                        const id = createSession(name.trim());
                        setTableReader((p) => (p ? { ...p, bookId: id } : p));
                      }
                      return;
                    }
                    setTableReader((p) => (p ? { ...p, bookId: v } : p));
                  }}
                  style={{
                    fontFamily: "inherit",
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "var(--text)",
                    background: "var(--soft)",
                    border: "1px solid var(--border)",
                    borderRadius: 7,
                    padding: "3px 6px",
                    maxWidth: 170,
                  }}
                >
                  {books.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.isMaster ? "Master Book" : b.name || "Session"}
                    </option>
                  ))}
                  <option value="__new">＋ New session…</option>
                </select>
                <span style={{ fontSize: 11.5, color: "var(--muted)", flex: "0 0 auto" }}>
                  · Send → Selected
                </span>
              </div>
            </div>
            <button
              onClick={() => setTableReader(null)}
              aria-label="Close reader"
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--panel)",
                color: "var(--muted)",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                lineHeight: 0,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            <VerseViewer
                toolHotkeys={toolHotkeys}
              selectedVolume={trLoc.v}
              selectedBook={trLoc.b}
              selectedChapter={trLoc.c}
              onChange={(v, b, c) => setTrLoc({ v, b, c })}
              selectedTool={selectedTool}
              selectedColor={selectedColor}
              onChangeTool={setSelectedTool}
              onChangeColor={setSelectedColor}
              onMark={(reference, verseText, markedText, startIndex, endIndex, style, color) =>
                addMarksToBook(tableReader.bookId, [
                  { reference, verseText, markedText, startIndex, endIndex, style, color },
                ])
              }
              onMarkMany={(items) => addMarksToBook(tableReader.bookId, items)}
              onEraseMark={(id) => deleteMarkInBook(tableReader.bookId, id)}
              onDefine={handleDefine}
              tags={wordTags}
              onTagTap={openTagRef}
              marks={getBook(tableReader.bookId).marks}
              showToolbar
              panelMode
              toolbarPos={toolbarPos}
              onToolbarPos={setToolbarPos}
              toolbarOrient={toolbarOrient}
              onToolbarOrient={setToolbarOrient}
              jumpTarget={trJump}
              onJumpHandled={() => setTrJump(null)}
              onSendVerses={sendReaderVersesToTable}
            />
          </div>
        </div>
      )}

      {markPanel &&
        (() => {
          // Assemble the marks to show (union across the verses' books) and a
          // markId -> book map for erasing. Marks route per-verse to the book
          // that verse's card belongs to.
          const books = Array.from(new Set(Object.values(markPanel.refBook)));
          const refset = new Set(markPanel.refs);
          const unionMarks: Mark[] = [];
          const markBook: Record<string, string> = {};
          books.forEach((bid) => {
            getBook(bid).marks.forEach((m) => {
              if (refset.has(m.reference)) {
                unionMarks.push(m);
                markBook[m.id] = bid;
              }
            });
          });
          const fallbackBook = books[0] || "master";
          const loc = refLoc.get(markPanel.refs[0]);
          // Theme legend: every (book, resolved scope) pair the panel's verses
          // live in. Naming a color writes the scoped label to ALL pairs, which
          // is exactly where the cards and Present resolve names from.
          const labelPairs: { book: string; scope: string }[] = [];
          {
            const seen = new Set<string>();
            markPanel.refs.forEach((r) => {
              const book = markPanel.refBook[r] || fallbackBook;
              const scope = resolveScope(scopeOfRef(r));
              const k = book + "||" + scope;
              if (!seen.has(k)) {
                seen.add(k);
                labelPairs.push({ book, scope });
              }
            });
          }
          const legendColors = Array.from(
            new Set<number>([...unionMarks.map((m) => m.color), selectedColor])
          ).sort((a, b) => a - b) as MarkColor[];
          const legendValue = (color: MarkColor): string => {
            // Scoped labels ONLY — the reader's own precedence. Falling back to
            // the book-level color name leaked old names (e.g. red = "Nephi")
            // onto brand-new pages that had nothing to do with that study.
            for (const p of labelPairs) {
              const bk = getBook(p.book);
              const v = bk.scopedLabels?.[p.scope]?.[color];
              if (v && v.trim()) return v;
            }
            return "";
          };
          const setLegendValue = (color: MarkColor, label: string) =>
            labelPairs.forEach((p) =>
              setScopedLabelInBook(p.book, p.scope, color, label)
            );
          const routeMany = (
            items: {
              reference: string;
              verseText: string;
              markedText: string;
              startIndex: number;
              endIndex: number;
              style: MarkStyle;
              color: MarkColor;
            }[]
          ) => {
            const byBook: Record<string, typeof items> = {};
            items.forEach((it) => {
              const b = markPanel.refBook[it.reference] || fallbackBook;
              if (!byBook[b]) byBook[b] = [];
              byBook[b].push(it);
            });
            Object.keys(byBook).forEach((b) => addMarksToBook(b, byBook[b]));
          };
          return (
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 420,
                background: "var(--bg)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--border)",
                  flex: "0 0 auto",
                }}
              >
                <button
                  onClick={() => setMarkPanel(null)}
                  aria-label="Close marking"
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                    color: "var(--text)",
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                    lineHeight: 0,
                  }}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M15 6l-6 6 6 6" />
                  </svg>
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text)" }}>
                    {markPanel.title}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                    {markPanel.refs.length === 1
                      ? "1 verse"
                      : markPanel.refs.length + " verses"}{" "}
                    · select text to mark
                  </div>
                </div>
                <button
                  onClick={() => setMarkPanel(null)}
                  style={{
                    padding: "9px 16px",
                    borderRadius: 999,
                    border: "none",
                    background: ICON_ACCENT,
                    color: "#fff",
                    fontSize: "13.5px",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Done
                </button>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "9px 16px",
                  borderBottom: "1px solid var(--border)",
                  background: "var(--panel)",
                  overflowX: "auto",
                  flex: "0 0 auto",
                }}
              >
                <span
                  style={{
                    fontSize: "10.5px",
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "var(--muted)",
                    flex: "0 0 auto",
                  }}
                >
                  Themes
                </span>
                {legendColors.map((color) => (
                  <span
                    key={color}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "7px",
                      flex: "0 0 auto",
                      border:
                        "1px solid " +
                        (color === selectedColor
                          ? COLOR_MAP[color]
                          : "var(--border)"),
                      borderRadius: "999px",
                      padding: "4px 10px 4px 7px",
                      background: "var(--bg)",
                    }}
                  >
                    <span
                      style={{
                        width: "12px",
                        height: "12px",
                        borderRadius: "50%",
                        background: COLOR_MAP[color],
                        flexShrink: 0,
                      }}
                    />
                    <input
                      value={legendValue(color)}
                      placeholder={"Name theme " + color + "…"}
                      onChange={(e) => setLegendValue(color, e.target.value)}
                      style={{
                        border: 0,
                        outline: 0,
                        background: "transparent",
                        color: "var(--text)",
                        fontSize: "12.5px",
                        fontWeight: 600,
                        fontFamily: "inherit",
                        width: "120px",
                      }}
                    />
                  </span>
                ))}
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--muted)",
                    flex: "0 0 auto",
                  }}
                >
                  Names appear on the cards and in Present
                </span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", position: "relative" }}>
                <VerseViewer
                toolHotkeys={toolHotkeys}
                  selectedVolume={loc ? loc.volume : 0}
                  selectedBook={loc ? loc.book : 0}
                  selectedChapter={loc ? loc.chapter : 0}
                  onChange={() => {}}
                  selectedTool={selectedTool}
                  selectedColor={selectedColor}
                  onChangeTool={setSelectedTool}
                  onChangeColor={setSelectedColor}
                  onMark={(
                    reference,
                    verseText,
                    markedText,
                    startIndex,
                    endIndex,
                    style,
                    color
                  ) =>
                    routeMany([
                      {
                        reference,
                        verseText,
                        markedText,
                        startIndex,
                        endIndex,
                        style,
                        color,
                      },
                    ])
                  }
                  onEraseMark={(id) =>
                    deleteMarkInBook(markBook[id] || fallbackBook, id)
                  }
                  onMarkMany={routeMany}
                  marks={unionMarks}
                  showToolbar
                  toolbarPos={toolbarPos}
                  onToolbarPos={setToolbarPos}
                  toolbarOrient={toolbarOrient}
                  onToolbarOrient={setToolbarOrient}
                  panelMode
                  controlsStickyTop={0}
                  fontScale={reading.fontScale}
                  lineScale={reading.lineScale}
                  warm={reading.warm}
                  dark={dark}
                  studyRefs={markPanel.refs}
                  studyTitle={markPanel.title}
                  hideStudyHeader
                  jumpTarget={null}
                  onJumpHandled={() => {}}
                />
              </div>
            </div>
          );
        })()}

      {mode === "compile" && (
        <div>
          <div
            style={{
              maxWidth: "920px",
              margin: "0 auto",
              padding: "16px 16px 0",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
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
              <input
                value={compileName}
                onChange={(e) => setCompileName(e.target.value)}
                placeholder="Name this study"
                style={{
                  flex: 1,
                  minWidth: "180px",
                  height: "40px",
                  padding: "0 14px",
                  borderRadius: "10px",
                  border: "1px solid var(--border)",
                  background: "var(--panel)",
                  color: "var(--text)",
                  fontSize: "15px",
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
              <button
                data-tour="save-study"
                onClick={saveToStudies}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "7px",
                  height: "40px",
                  padding: "0 18px",
                  borderRadius: "10px",
                  border: "none",
                  background: ICON_ACCENT,
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: 700,
                  fontFamily: "inherit",
                }}
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <path d="M17 21v-8H7v8M7 3v5h8" />
                </svg>
                Save to Studies
              </button>
              {savedToStudies && (
                <span
                  style={{
                    fontSize: "13.5px",
                    color: TYPE_BLUE,
                    fontWeight: 600,
                  }}
                >
                  Saved ✓
                </span>
              )}
              <div style={{ position: "relative", marginLeft: "auto" }}>
                <button
                  onClick={() => setCompileSettingsOpen((o) => !o)}
                  title="Print & share"
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "10px",
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--text)",
                    cursor: "pointer",
                    fontSize: "20px",
                    lineHeight: 1,
                  }}
                >
                  ⋯
                </button>
                {compileSettingsOpen && (
                  <>
                    <div
                      onClick={() => setCompileSettingsOpen(false)}
                      style={{ position: "fixed", inset: 0, zIndex: 50 }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        top: "46px",
                        right: 0,
                        zIndex: 51,
                        background: "var(--panel)",
                        border: "1px solid var(--border)",
                        borderRadius: "12px",
                        boxShadow: "0 16px 40px rgba(0,0,0,0.22)",
                        padding: "6px",
                        width: "190px",
                      }}
                    >
                      {(compileView === "outline" ||
                        compileView === "charting") && (
                        <button
                          onClick={() => {
                            setCompileSettingsOpen(false);
                            handlePrintLive();
                          }}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "9px 11px",
                            borderRadius: "8px",
                            border: "none",
                            background: "transparent",
                            color: "var(--text)",
                            cursor: "pointer",
                            fontSize: "13.5px",
                            fontFamily: "inherit",
                          }}
                        >
                          ⎙ Print / PDF
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setCompileSettingsOpen(false);
                          setSharingVerses(true);
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "9px 11px",
                          borderRadius: "8px",
                          border: "none",
                          background: "transparent",
                          color: "var(--text)",
                          cursor: "pointer",
                          fontSize: "13.5px",
                          fontFamily: "inherit",
                        }}
                      >
                        ⤴ Share image
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {compileStudy?.view === "covenants" ? (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    letterSpacing: "1px",
                    textTransform: "uppercase",
                    color: "var(--muted)",
                    padding: "6px 0",
                  }}
                >
                  Relational study
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <div
                  data-tour="compile-views"
                  style={{
                    display: "flex",
                    border: "1px solid var(--border)",
                    borderRadius: "999px",
                    overflow: "hidden",
                    backgroundColor: "var(--panel)",
                    flexWrap: "wrap",
                  }}
                >
                  {viewTabButton(compileView === "outline", "Outline", () =>
                    setCompileView("outline")
                  )}
                  {viewTabButton(compileView === "charting", "Charting", () =>
                    setCompileView("charting")
                  )}
                  {viewTabButton(compileView === "distilled", "Distilled", () =>
                    setCompileView("distilled")
                  )}
                  {viewTabButton(compileView === "covenants", "Relational", () =>
                    setCompileView("covenants")
                  )}
                  {viewTabButton(compileView === "semantic", "Semantic", () =>
                    setCompileView("semantic")
                  )}
                </div>
              </div>
            )}
          </div>

          <style>{`
            @keyframes qf-flash {
              0% { box-shadow: 0 0 0 0 rgba(217,164,65,0); }
              18% { box-shadow: 0 0 0 3px rgba(217,164,65,.95); }
              100% { box-shadow: 0 0 0 0 rgba(217,164,65,0); }
            }
            .qf-flash { animation: qf-flash 1.4s ease; border-radius: 8px; }
          `}</style>
          {/* Quick-find — filter this study's marked verses and jump the board
              to a chosen verse's card. 16px input keeps it consistent with
              mobile (and avoids iOS zoom there). */}
          {effectiveMarks.length > 0 && (
            <div style={{ maxWidth: "760px", margin: "0 auto 14px", padding: "0 4px" }}>
              <div style={{ position: "relative" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    background: "var(--soft)",
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    padding: "0 12px",
                  }}
                >
                  <span
                    aria-hidden
                    style={{ color: "var(--muted)", fontSize: "16px", flexShrink: 0 }}
                  >
                    ⌕
                  </span>
                  <input
                    value={compileFindQ}
                    onChange={(e) => setCompileFindQ(e.target.value)}
                    placeholder="Find a verse, word, or theme"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      color: "var(--text)",
                      fontFamily: "inherit",
                      fontSize: "16px",
                      padding: "10px 0",
                    }}
                  />
                  {compileFindQ !== "" && (
                    <button
                      onClick={() => setCompileFindQ("")}
                      aria-label="Clear find"
                      style={{
                        flexShrink: 0,
                        background: "transparent",
                        border: "none",
                        color: "var(--muted)",
                        fontSize: "20px",
                        lineHeight: 1,
                        cursor: "pointer",
                        padding: "2px 4px",
                        fontFamily: "inherit",
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
                {compileFindQuery !== "" && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      left: 0,
                      right: 0,
                      zIndex: 60,
                      background: "var(--panel)",
                      border: "1px solid var(--border)",
                      borderRadius: "12px",
                      boxShadow: "0 16px 40px rgba(0,0,0,0.22)",
                      maxHeight: "50vh",
                      overflowY: "auto",
                    }}
                  >
                    {compileFindResults.length === 0 ? (
                      <div
                        style={{
                          padding: "14px 16px",
                          color: "var(--muted)",
                          fontSize: "13.5px",
                        }}
                      >
                        No marked verses match “{compileFindQ.trim()}”.
                      </div>
                    ) : (
                      compileFindResults.map((r, i) => {
                        const snippet =
                          r.texts.join("  ·  ") || r.themes.join(", ");
                        return (
                          <button
                            key={r.reference}
                            onClick={() => {
                              compileScrollToVerse(r.reference);
                              setCompileFindQ("");
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                              width: "100%",
                              textAlign: "left",
                              background: "transparent",
                              border: "none",
                              borderBottom:
                                i < compileFindResults.length - 1
                                  ? "1px solid var(--border)"
                                  : "none",
                              padding: "11px 14px",
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            <span
                              style={{
                                width: "10px",
                                height: "10px",
                                borderRadius: "50%",
                                backgroundColor: COLOR_MAP[r.color as MarkColor],
                                flexShrink: 0,
                              }}
                            />
                            <span
                              style={{
                                flexShrink: 0,
                                fontWeight: 700,
                                fontSize: "12.5px",
                                color: "var(--text)",
                              }}
                            >
                              {r.reference}
                            </span>
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: "12.5px",
                                color: "var(--muted)",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                fontFamily: '"Times New Roman", Times, serif',
                              }}
                            >
                              {snippet}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="scribal-swap" key={compileView} ref={scribalSwapRef}>
            {compileView === "outline" && (
              <Outline
                savedPins={scopedPins[effectiveScope]}
                onPins={(p) => setScopedPins(effectiveScope, p)}
                {...sharedCompileProps}
                notes={notes}
                setNote={setNote}
                collapsed={compileCollapsed}
                onCollapsedChange={setCompileCollapsed}
              />
            )}
            {compileView === "charting" && <Charting {...sharedCompileProps} />}
            {compileView === "semantic" && (
              <SemanticView
                compileTabs={sharedCompileProps.compileTabs}
                marks={sharedCompileProps.marks}
                colorLabels={sharedCompileProps.colorLabels}
                onJumpToReference={sharedCompileProps.onJumpToReference}
                noteFor={(ref) => {
                  // Desktop verse notes are per-color: "note|<chapterRef>|c<n>|<ref>".
                  // Ground level shows them joined.
                  const found: string[] = [];
                  Object.keys(notes || {}).forEach((k) => {
                    if (k.startsWith("note|") && k.endsWith("|" + ref)) {
                      const v = (notes[k] || "").trim();
                      if (v) found.push(v);
                    }
                  });
                  return found.join(" · ");
                }}
                synthesisFor={() => {
                  // Desktop keeps ONE synthesis per study (not per theme);
                  // every doorway shows it.
                  const k =
                    "synthesis|" +
                    sharedCompileProps.compileTabs.map(tabLabel).join("+");
                  return notes[k] || "";
                }}
              />
            )}
            {compileView === "distilled" && (
              <Distilled {...sharedCompileProps} />
            )}
            {compileView === "covenants" && (
              <Covenants
                key={effectiveScope}
                {...sharedCompileProps}
                savedRoles={scopedRoles[effectiveScope]}
                onRoles={(r) => setScopedRoles(effectiveScope, r)}
                savedLens={scopedLens[effectiveScope]}
                onLens={(l) => setScopedLens(effectiveScope, l)}
                savedThreads={scopedThreads[effectiveScope]}
                onThreads={(t) => setScopedThreads(effectiveScope, t)}
              />
            )}
            {effectiveTags.length > 0 && (
              <div style={{ marginTop: "24px" }}>
                <WordStudies
                  tags={effectiveTags}
                  colors={{
                    text: "var(--text)",
                    muted: "var(--muted)",
                    border: "var(--border)",
                    soft: "var(--soft)",
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {mode === "vault" &&
        (() => {
          const all = buildStudyRows();
          const vaultBooks: VaultBook[] = [...books]
            .sort((a, b) =>
              a.isMaster
                ? -1
                : b.isMaster
                ? 1
                : (b.lastStudiedAt || 0) - (a.lastStudiedAt || 0)
            )
            .map((b) => ({
              id: b.id,
              name: b.name,
              isMaster: !!b.isMaster,
              active: b.id === activeBookId,
              rows: all.filter((r) => r.bookId === b.id),
            }));
          return (
            <BooksVault
              books={vaultBooks}
              onSetActive={setActiveBook}
              onNewSession={() => {
                const id = createSession(
                  "Session · " + fmtShortDate(Date.now())
                );
                setActiveBook(id);
              }}
              onRename={(id, name) => renameBook(id, name)}
              onDelete={(id) =>
                askConfirm({
                  title: "Delete this book?",
                  body:
                    'Delete "' +
                    (getBook(id).name || "this book") +
                    "\" and all of its markings? This can't be undone.",
                  onConfirm: () => {
                    if (id === activeBookId) setActiveBook("master");
                    deleteBook(id);
                  },
                })
              }
              onClose={() => setMode("read")}
            />
          );
        })()}
    </div>
  );
}
