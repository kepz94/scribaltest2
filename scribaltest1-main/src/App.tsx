import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useMarks } from "./hooks/useMarks";
import { useVault } from "./hooks/useVault";
import VerseViewer from "./components/VerseViewer";
import * as drive from "./googleDrive";
import CornellNotes from "./components/CornellNotes";
import Outline from "./components/Outline";
import Charting from "./components/Charting";
import ConceptMap from "./components/ConceptMap";
import PrintView from "./components/PrintView";
import MapPrint from "./components/MapPrint";
import ShareVerses from "./components/ShareVerses";
import StudiesList, { StudyRow } from "./components/StudiesList";
import BooksVault, { VaultBook } from "./components/BooksVault";
import { useSearchStudies, SearchStudy } from "./hooks/useSearchStudies";
import { useStudies, Study } from "./hooks/useStudies";
import Walkthrough from "./components/Walkthrough";
import CompileWalkthrough from "./components/CompileWalkthrough";
import SearchWalkthrough from "./components/SearchWalkthrough";
import VaultWalkthrough from "./components/VaultWalkthrough";
import TabsWalkthrough from "./components/TabsWalkthrough";
import BooksWalkthrough from "./components/BooksWalkthrough";
import HelpMenu, { HelpPick } from "./components/HelpMenu";
import FeatureList from "./components/FeatureList";

type FeatureKey = "compile" | "search" | "vault" | "tabs" | "books";
import ColorKey from "./components/ColorKey";
import Shortcuts from "./components/Shortcuts";
import CompileAnimation from "./components/CompileAnimation";
import SearchPanel from "./components/SearchPanel";
import scriptures from "./data/scriptures.json";
import {
  Mark,
  MarkColor,
  Tool,
  Tab,
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
  for (let i = 1; i <= 7; i++) {
    const penKey = `--pen${i}`;
    if (scaled[penKey]) scaled[penKey] = adjustColor(scaled[penKey], intensity, false);
    const hlKey = `--hl${i}`;
    if (scaled[hlKey]) scaled[hlKey] = adjustColor(scaled[hlKey], intensity, true);
  }
  return scaled;
};

const LIGHT_THEME = {
  "--bg": "#f6f4ee",
  "--panel": "#ffffff",
  "--soft": "#efece4",
  "--text": "#1d1c18",
  "--muted": "#8d8a80",
  "--border": "#e2dfd6",
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

const DARK_THEME = {
  "--bg": "#131210",
  "--panel": "#1d1c19",
  "--soft": "#232220",
  "--text": "#eae7de",
  "--muted": "#8d8a82",
  "--border": "#343229",
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

const vols = scriptures.volumes;

// Reference -> scripture order, so hand-picked study verses sort canonically.
const refOrderIndex = new Map<string, number>();
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
);
const orderOfRef = (ref: string) => refOrderIndex.get(ref) ?? 1e12;

// Where each verse lives, so a study tab can open at its first verse's location.
const refLoc = new Map<
  string,
  { volume: number; book: number; chapter: number }
>();
vols.forEach((v, vi) =>
  v.books.forEach((b, bi) =>
    b.chapters.forEach((c, ci) =>
      c.verses.forEach((ve) =>
        refLoc.set(ve.reference, { volume: vi, book: bi, chapter: ci })
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
vols.forEach((v, vi) =>
  v.books.forEach((b, bi) =>
    b.chapters.forEach((c, ci) => {
      const ref = c.verses[0]?.reference;
      if (ref) chapterLoc.set(scopeOfRef(ref), { volume: vi, book: bi, chapter: ci });
    })
  )
);

// The per-chapter label scope for a tab, e.g. "Genesis 1". Unique per chapter.
const chapterScopeOf = (t: { volume: number; book: number; chapter: number }) =>
  scopeOfRef(
    vols[t.volume]?.books[t.book]?.chapters[t.chapter]?.verses[0]?.reference ||
      ""
  );

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

const VIEW_NAMES: Record<string, string> = {
  cornell: "Cornell Notes",
  outline: "Outline",
  charting: "Charting",
  map: "Concept Map",
};

type CompileView = "cornell" | "outline" | "charting" | "map";
type Mode = "read" | "compile" | "vault";

interface PrintData {
  view: CompileView;
  title: string;
  compileTabs: Tab[];
  marks: Mark[];
  colorLabels: Record<number, string>;
  notes: Record<string, string>;
}

export default function App() {
  const {
    marks,
    addMark,
    deleteMark,
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
    mergeRemoteBooks,
  } = useMarks();

  const {
    entries,
    mergeRemote: vaultMergeRemote,
  } = useVault();

  const {
    studies: searchStudies,
    addStudy,
    deleteStudy,
    setStudies: setSearchStudies,
  } = useSearchStudies();
  const {
    studies: recordedStudies,
    recordStudy,
    deleteStudy: deleteRecordedStudy,
    setStudies: setRecordedStudies,
  } = useStudies();

  // Restore a manual backup file into localStorage. (Drive sync uses the shared
  // pushToDrive / pullIfNewer paths directly.) Implementation lives in ./sync.
  const applyBackupString = (text: string) => syncApplyBackupString(text);

  // The single safe path for writing to Drive (rules: staleness + emptiness).
  // Lives in ./sync so desktop and mobile share one implementation.
  const pushToDrive = () =>
    syncPushToDrive(BACKUP_KEYS, mergeRemoteBooks, vaultMergeRemote);

  const [mode, setMode] = useState<Mode>("read");
  const [compileView, setCompileView] = useState<CompileView>(
    () =>
      (localStorage.getItem("scribal_compile_view") as CompileView) || "cornell"
  );

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

  // A chapter's label scope: its group's shared scope if linked, else its own.
  const resolveScope = (chapterScope: string) =>
    chapterGroups[chapterScope] ? "group:" + chapterGroups[chapterScope] : chapterScope;

  // Stable distinct color for each link group (so borders differ per group).
  const groupColor = (gid: string) => {
    const ids = Array.from(new Set(Object.values(chapterGroups))).sort();
    const i = ids.indexOf(gid);
    return LINK_COLORS[(i < 0 ? 0 : i) % LINK_COLORS.length];
  };

  const [compileSelection, setCompileSelection] = useState<string[]>([]);
  const [compileStudyId, setCompileStudyId] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<Tool>("highlight");
  const [selectedColor, setSelectedColor] = useState<MarkColor>(1);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [jumpTarget, setJumpTarget] = useState<string | null>(null);

  const [showTutorial, setShowTutorial] = useState<boolean>(
    () => !localStorage.getItem("scribal_tutorial_seen")
  );
  const [showSearch, setShowSearch] = useState(false);
  const [featureWalk, setFeatureWalk] = useState<FeatureKey | null>(null);
  const [showHelpMenu, setShowHelpMenu] = useState(false);
  const [showFeatureList, setShowFeatureList] = useState(false);
  const [showColorKey, setShowColorKey] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const [compileAnim, setCompileAnim] = useState<{
    show: boolean;
    duration: number;
  }>({ show: false, duration: 1000 });

  // When more than one separate thing is open, compile asks what to combine
  // instead of silently merging everything.
  const [compilePrompt, setCompilePrompt] = useState<
    { label: string; tabIds: string[] }[] | null
  >(null);

  // "Which open tabs do you want to link this one with?" prompt.
  const [linkPromptTabId, setLinkPromptTabId] = useState<string | null>(null);
  const [linkSelected, setLinkSelected] = useState<string[]>([]);

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
        | "horizontal") || "vertical"
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

  const [printData, setPrintData] = useState<PrintData | null>(null);

  const closeTutorial = () => {
    localStorage.setItem("scribal_tutorial_seen", "1");
    setShowTutorial(false);
  };

  const maybeGuide = useCallback(
    (key: FeatureKey) => {
      if (localStorage.getItem("scribal_guide_" + key)) return;
      if (gateOpen || showTutorial) return;
      setFeatureWalk((cur) => cur || key);
    },
    [gateOpen, showTutorial]
  );
  const closeFeatureWalk = () => {
    if (featureWalk) {
      localStorage.setItem("scribal_guide_" + featureWalk, "1");
    }
    setFeatureWalk(null);
  };

  const pickHelp = (key: HelpPick) => {
    setShowHelpMenu(false);
    if (key === "main") setShowTutorial(true);
    else setFeatureWalk(key);
  };

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

  // Push local changes to Firebase (debounced inside cloudSync; only acts when
  // signed in). The live counterpart to the Drive auto-save below.
  useEffect(() => {
    noteLocalChange();
  }, [marks, tabs, activeTabId, colorLabels, scopedLabels, notes]);

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
  }, [marks, tabs, activeTabId, colorLabels, scopedLabels, notes, cloudSignedIn]);

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
      const pulled = await syncPullIfNewer(mergeRemoteBooks, vaultMergeRemote);
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
        ? "📑 " +
          (searchStudies.find((s) => s.id === t.studyId)?.name || "Study")
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
      if (key >= "1" && key <= "7") {
        const c = Number(key) as MarkColor;
        if (COLORS.includes(c)) {
          setSelectedColor(c);
          e.preventDefault();
        }
        return;
      }
      if (KEY_TO_TOOL[key]) {
        setSelectedTool(KEY_TO_TOOL[key]);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // First-time feature guides: each fires once when you first reach a feature.
  useEffect(() => {
    if (showSearch) maybeGuide("search");
  }, [showSearch, maybeGuide]);

  useEffect(() => {
    if (mode === "compile") maybeGuide("compile");
    else if (mode === "vault") maybeGuide("vault");
  }, [mode, maybeGuide]);

  useEffect(() => {
    if (tabs.length >= 2) maybeGuide("tabs");
  }, [tabs.length, maybeGuide]);

  useEffect(() => {
    if (books.length >= 2) maybeGuide("books");
  }, [books.length, maybeGuide]);

  const addNewTab = () => {
    if (tabs.length >= 5) return; // up to 5 panels
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
    const newId = makeTabId(bookId, volume, book, chapter);
    setTabs((prev) => {
      const existing = prev.find((t) => t.id === newId);
      if (existing) {
        setActiveTabId(newId);
        return prev;
      }
      const next = prev.map((t) =>
        t.id === tabId ? { id: newId, volume, book, chapter, bookId } : t
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
    setLinkPromptTabId(t.id);
  };

  const toggleLinkSelect = (cs: string) =>
    setLinkSelected((prev) =>
      prev.includes(cs) ? prev.filter((s) => s !== cs) : [...prev, cs]
    );

  // Apply the prompt: the clicked tab is linked with exactly the checked tabs.
  // Checking none unlinks it. Any old groups left with one chapter dissolve.
  const applyLinkPrompt = () => {
    const t = tabs.find((x) => x.id === linkPromptTabId);
    const members = linkSelected;
    setLinkPromptTabId(null);
    if (!t) return;
    const csT = chapterScopeOf(t);
    if (members.length === 0) {
      setChapterGroups((prev) => {
        const next = { ...prev };
        delete next[csT];
        const counts: Record<string, number> = {};
        Object.values(next).forEach((g) => (counts[g] = (counts[g] || 0) + 1));
        Object.keys(next).forEach((s) => {
          if (counts[next[s]] < 2) delete next[s];
        });
        return next;
      });
      return;
    }
    const gid = newGroupId();
    const all = [csT, ...members];
    // carry names into the new group's palette (fill blanks, clicked tab first)
    all.forEach((ms) => seedScopeLabels("group:" + gid, scopedLabels[ms] || {}));
    setChapterGroups((prev) => {
      const next = { ...prev };
      all.forEach((ms) => {
        next[ms] = gid;
      });
      const counts: Record<string, number> = {};
      Object.values(next).forEach((g) => (counts[g] = (counts[g] || 0) + 1));
      Object.keys(next).forEach((s) => {
        if (next[s] !== gid && counts[next[s]] < 2) delete next[s];
      });
      return next;
    });
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

  const runCompile = (tabIds: string[], skipRecord?: boolean) => {
    const ids = tabIds.length ? tabIds : tabs.map((t) => t.id);
    setCompileSelection(ids);
    // Compile is the save — record this chapter or linked group as a study so
    // it shows in the Studies hub (mirrors the mobile flow). Reopening an
    // existing study from the hub passes skipRecord so its date doesn't churn.
    const unitTabs = skipRecord ? [] : tabs.filter((t) => ids.includes(t.id));
    if (unitTabs.length) {
      const gid = chapterGroups[chapterScopeOf(unitTabs[0])];
      if (
        gid &&
        unitTabs.every((t) => chapterGroups[chapterScopeOf(t)] === gid)
      ) {
        recordStudy(
          "linked",
          unitTabs[0].bookId,
          gid,
          unitTabs.map((t) => tabLabel(t)).join("  +  ")
        );
      } else if (unitTabs.length === 1) {
        recordStudy(
          "chapter",
          unitTabs[0].bookId,
          chapterScopeOf(unitTabs[0]),
          tabLabel(unitTabs[0])
        );
      }
    }
    const lastCount = Number(
      localStorage.getItem("scribal_last_compile_count") || "0"
    );
    const currentCount = marks.length;
    const delta = Math.max(0, currentCount - lastCount);
    const duration = delta > 8 ? 2500 : 1000;
    localStorage.setItem("scribal_last_compile_count", String(currentCount));
    setCompileAnim({ show: true, duration });
  };

  const startStudyCompile = (study: SearchStudy) => {
    setCompileStudyId(study.id);
    const lastCount = Number(
      localStorage.getItem("scribal_last_compile_count") || "0"
    );
    const currentCount = marks.length;
    const delta = Math.max(0, currentCount - lastCount);
    const duration = delta > 8 ? 2500 : 1000;
    localStorage.setItem("scribal_last_compile_count", String(currentCount));
    setCompileAnim({ show: true, duration });
  };

  const startCompile = () => {
    setCompileStudyId(null);
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

  const finishCompileAnim = () => {
    setCompileAnim((a) => ({ ...a, show: false }));
    setMode("compile");
  };

  const toggleCompileTab = (id: string) => {
    setCompileSelection((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const compileTabs = tabs.filter((t) => compileSelection.includes(t.id));

  // The label scope for the active chapter (its group's scope if linked).
  const activeScope = activeTab.studyId
    ? "searchstudy:" + activeTab.studyId
    : resolveScope(chapterScopeOf(activeTab));
  const activeScopedLabels = scopedLabels[activeScope] || {};

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
  const effectiveCompileTabs = compileStudy ? studyCompileTabs : compileTabs;
  const effectiveScope = compileStudy
    ? "searchstudy:" + compileStudy.id
    : compileScope;
  const effectiveScopedLabels = scopedLabels[effectiveScope] || {};
  const effectiveMarks =
    compileStudy && studyRefSet
      ? getBook(compileStudy.bookId).marks.filter((m) =>
          studyRefSet.has(m.reference)
        )
      : marks;

  // The per-chapter (group-aware) theme name for any verse — used by search.
  const labelFor = (reference: string, color: MarkColor | null) =>
    color == null
      ? ""
      : scopedLabels[resolveScope(scopeOfRef(reference))]?.[color] || "";

  const usedColors = COLORS.filter((c) =>
    marks.some((m) => activeChapterRefs.has(m.reference) && m.color === c)
  );

  // Reopen a recorded chapter/linked study: open its chapter tab(s) in its
  // book and compile them fresh (live, from current marks).
  const openRecordedStudy = (s: Study) => {
    setStudiesOpen(false);
    const scopes =
      s.type === "linked"
        ? Object.keys(chapterGroups).filter(
            (c) => chapterGroups[c] === s.scopeRef
          )
        : [s.scopeRef];
    const locs = scopes
      .map((sc) => chapterLoc.get(sc))
      .filter(Boolean) as {
      volume: number;
      book: number;
      chapter: number;
    }[];
    if (!locs.length) return;
    if (s.bookId !== activeBookId) setActiveBook(s.bookId);
    const tabIds: string[] = [];
    setTabs((prev) => {
      let next = prev;
      locs.forEach((loc) => {
        const id = makeTabId(s.bookId, loc.volume, loc.book, loc.chapter);
        tabIds.push(id);
        if (!next.some((t) => t.id === id))
          next = [
            ...next,
            {
              id,
              volume: loc.volume,
              book: loc.book,
              chapter: loc.chapter,
              bookId: s.bookId,
            },
          ];
      });
      return next;
    });
    if (tabIds[0]) setActiveTabId(tabIds[0]);
    runCompile(tabIds, true);
  };

  // ---- keyword (search) studies ----
  // Open a study as its own tab — desktop is tab-based, not a full-screen screen.
  const openStudyTab = (study: SearchStudy) => {
    setStudiesOpen(false);
    const loc = study.refs.length ? refLoc.get(study.refs[0]) : undefined;
    const tabId = "studytab_" + study.id;
    setTabs((prev) =>
      prev.some((t) => t.id === tabId)
        ? prev
        : [
            ...prev,
            {
              id: tabId,
              volume: loc ? loc.volume : 0,
              book: loc ? loc.book : 0,
              chapter: loc ? loc.chapter : 0,
              bookId: study.bookId,
              studyId: study.id,
            },
          ]
    );
    setActiveTabId(tabId);
  };
  const onLinkStudy = (refs: string[]) => {
    if (!refs.length) return;
    const ordered = refs.slice().sort((a, b) => orderOfRef(a) - orderOfRef(b));
    setStudyDraftRefs(ordered);
    setStudyDraftName("");
    setShowSearch(false);
  };
  const createStudyFromDraft = () => {
    const refs = studyDraftRefs;
    if (!refs || !refs.length) return;
    const study = addStudy(studyDraftName, activeBookId, refs);
    setStudyDraftRefs(null);
    openStudyTab(study);
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
      ? "📑 " + compileStudy.name
      : effectiveCompileTabs[0]
      ? tabLabel(effectiveCompileTabs[0])
      : "";
    const extra =
      !compileStudy && effectiveCompileTabs.length > 1
        ? " +" + (effectiveCompileTabs.length - 1)
        : "";
    setPrintData({
      view: compileView,
      title: VIEW_NAMES[compileView] + " — " + first + extra,
      compileTabs: effectiveCompileTabs,
      marks: effectiveMarks,
      colorLabels: effectiveScopedLabels,
      notes,
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
    if (
      window.confirm(
        'Delete "' +
          b.name +
          "\" and all of its markings? This can't be undone."
      )
    ) {
      deleteBook(b.id);
    }
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
        height: "32px",
        padding: "0 18px",
        backgroundColor: primary ? "var(--text)" : "transparent",
        color: primary ? "var(--bg)" : "var(--text)",
        border: primary ? "none" : "1px solid var(--border)",
        borderRadius: "999px",
        cursor: "pointer",
        fontSize: "13.5px",
        fontWeight: 500,
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
        width: "32px",
        height: "32px",
        borderRadius: "50%",
        border: "1px solid var(--border)",
        backgroundColor: "transparent",
        color: "var(--muted)",
        cursor: disabled ? "default" : "pointer",
        fontSize: "15px",
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
    height: "32px",
    padding: "0 14px",
    borderRadius: "999px",
    border: "1px solid var(--border)",
    backgroundColor: "transparent",
    color: "var(--muted)",
    cursor: "pointer",
    fontSize: "12.5px",
    display: "flex",
    alignItems: "center",
    gap: "6px",
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
        backgroundColor: active ? "var(--text)" : "transparent",
        color: active ? "var(--bg)" : "var(--muted)",
        transition: "all 0.15s",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );

  // Build a row for every study (chapter, linked, keyword) with live counts and
  // theme names. Shared by the Studies hub and the books Vault.
  const buildStudyRows = (): StudyRow[] => {
    const bookMarksOf = (bid: string) =>
      allMarks.filter((m) => m.bookId === bid);
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

    recordedStudies
      .filter((s) => s.type === "chapter")
      .forEach((s) => {
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
          onOpen: () => openRecordedStudy(s),
          onDelete: () => deleteRecordedStudy(s.id),
        });
      });

    recordedStudies
      .filter((s) => s.type === "linked")
      .forEach((s) => {
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
          onOpen: () => openRecordedStudy(s),
          onDelete: () => deleteRecordedStudy(s.id),
        });
      });

    searchStudies.forEach((ss) => {
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
        onOpen: () => openStudyTab(ss),
        onDelete: () => removeStudy(ss.id),
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
          minHeight: "100vh",
          backgroundColor: "var(--bg)",
          color: "var(--text)",
          transition: "background-color 0.25s, color 0.25s",
        } as React.CSSProperties
      }
    >
      {gateOpen && (
        <div
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
                backgroundColor: "var(--text)",
                color: "var(--bg)",
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

      {!gateOpen && showTutorial && <Walkthrough onClose={closeTutorial} />}
      {featureWalk === "compile" && (
        <CompileWalkthrough onClose={closeFeatureWalk} />
      )}
      {featureWalk === "search" && (
        <SearchWalkthrough onClose={closeFeatureWalk} />
      )}
      {featureWalk === "vault" && (
        <VaultWalkthrough onClose={closeFeatureWalk} />
      )}
      {featureWalk === "tabs" && <TabsWalkthrough onClose={closeFeatureWalk} />}
      {featureWalk === "books" && (
        <BooksWalkthrough onClose={closeFeatureWalk} />
      )}
      {showHelpMenu && (
        <HelpMenu
          onPick={pickHelp}
          onFeatureList={() => {
            setShowHelpMenu(false);
            setShowFeatureList(true);
          }}
          onClose={() => setShowHelpMenu(false)}
        />
      )}
      {showFeatureList && (
        <FeatureList onClose={() => setShowFeatureList(false)} />
      )}
      {showColorKey && (
        <ColorKey
          colorLabels={activeScopedLabels}
          marks={marks}
          bookName={activeBookName}
          onClose={() => setShowColorKey(false)}
        />
      )}
      {showShortcuts && <Shortcuts onClose={() => setShowShortcuts(false)} />}
      {showSearch && (
        <SearchPanel
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
          onLinkStudy={onLinkStudy}
          onOpenNewTab={(ref) => {
            openInNewTab(ref);
            setShowSearch(false);
          }}
          onClose={() => setShowSearch(false)}
        />
      )}
      {linkPromptTabId && (
        <div
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
            <div
              style={{ fontSize: "16px", fontWeight: 600, marginBottom: "6px" }}
            >
              Link{" "}
              {(() => {
                const t = tabs.find((x) => x.id === linkPromptTabId);
                return t ? tabLabel(t) : "this chapter";
              })()}{" "}
              with…
            </div>
            <div
              style={{ fontSize: "13px", opacity: 0.7, marginBottom: "16px" }}
            >
              Pick the open tabs to study together. They'll share one set of
              themes and compile as one. Leave all unchecked to unlink.
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                maxHeight: "320px",
                overflowY: "auto",
              }}
            >
              {tabs
                .filter((x) => x.id !== linkPromptTabId)
                .map((x) => {
                  const cs = chapterScopeOf(x);
                  const on = linkSelected.includes(cs);
                  return (
                    <button
                      key={x.id}
                      onClick={() => toggleLinkSelect(cs)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        textAlign: "left",
                        padding: "12px 14px",
                        borderRadius: "10px",
                        border: on
                          ? "2px solid var(--text)"
                          : "1px solid var(--border)",
                        background: "var(--bg)",
                        color: "var(--text)",
                        fontSize: "14px",
                        fontWeight: on ? 600 : 400,
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          width: "16px",
                          height: "16px",
                          borderRadius: "4px",
                          border: "1px solid currentColor",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          fontSize: "11px",
                        }}
                      >
                        {on ? "✓" : ""}
                      </span>
                      {tabLabel(x)}
                    </button>
                  );
                })}
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "18px" }}>
              <button
                onClick={applyLinkPrompt}
                style={{
                  flex: 1,
                  padding: "11px",
                  borderRadius: "10px",
                  border: "none",
                  background: "var(--text)",
                  color: "var(--bg)",
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
      {compilePrompt && (
        <div
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
        <CompileAnimation
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
          style={{
            position: "fixed",
            bottom: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 500,
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

      {studiesOpen && (
        <StudiesList
          rows={buildStudyRows()}
          onClose={() => setStudiesOpen(false)}
        />
      )}

      {studyDraftRefs && (
        <div
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
              {studyDraftRefs.length === 1 ? "verse" : "verses"} · marks save to{" "}
              {activeBookName}
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
                  background: "var(--text)",
                  color: "var(--bg)",
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

      {printData &&
        (printData.view === "map" ? (
          <MapPrint
            title={printData.title}
            compileTabs={printData.compileTabs}
            marks={printData.marks}
            colorLabels={printData.colorLabels}
            onClose={() => setPrintData(null)}
          />
        ) : (
          <PrintView
            view={printData.view as "cornell" | "outline" | "charting"}
            title={printData.title}
            compileTabs={printData.compileTabs}
            marks={printData.marks}
            colorLabels={printData.colorLabels}
            notes={printData.notes}
            onClose={() => setPrintData(null)}
          />
        ))}

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
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
          padding: "15px 26px",
          backgroundColor: "var(--panel)",
          borderBottom: "1px solid var(--border)",
          position: "sticky",
          top: 0,
          zIndex: 30,
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
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "30px",
                height: "30px",
                borderRadius: "9px",
                backgroundColor: "var(--text)",
                color: "var(--bg)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "15px",
                flexShrink: 0,
              }}
            >
              ✦
            </div>
            <h2
              style={{
                margin: 0,
                fontSize: "19px",
                letterSpacing: "3px",
                fontWeight: 600,
              }}
            >
              SCRIBAL
            </h2>
          </div>

          {vDivider}

          {/* Study-book selector */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setBookMenuOpen((o) => !o)}
              title="Switch study book"
              style={{
                height: "32px",
                padding: "0 14px",
                borderRadius: "999px",
                border: isMasterActive
                  ? "1px solid var(--border)"
                  : "1px solid var(--pen5)",
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
              <span style={{ fontSize: "13px" }}>❖</span>
              {activeBookName}
              {!isMasterActive && (
                <span
                  style={{
                    fontSize: "9px",
                    letterSpacing: "1px",
                    color: "var(--pen5)",
                    border: "1px solid var(--pen5)",
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
              onClick={() => setShowSearch(true)}
              title="Search (Ctrl/Cmd+K)"
              style={pillStyle}
            >
              <span style={{ fontSize: "14px" }}>⌕</span>
              Search
            </button>
            <button
              onClick={() => setMode("vault")}
              title="Open your Notes Vault"
              style={{
                ...pillStyle,
                border:
                  mode === "vault"
                    ? "1px solid var(--text)"
                    : "1px solid var(--border)",
                backgroundColor:
                  mode === "vault" ? "var(--soft)" : "transparent",
                color: "var(--text)",
              }}
            >
              <span style={{ fontSize: "13px" }}>❑</span>
              Vault
              {entries.length > 0 && (
                <span
                  style={{
                    fontSize: "10px",
                    color: "var(--muted)",
                    backgroundColor: "var(--bg)",
                    borderRadius: "999px",
                    padding: "0 6px",
                  }}
                >
                  {entries.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setStudiesOpen(true)}
              title="Every study you've done"
              style={pillStyle}
            >
              <span style={{ fontSize: "13px" }}>📑</span>
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
                  }}
                >
                  {label}
                </span>
              );
            })()}
            {roundUtil("?", () => setShowHelpMenu(true), "Walkthroughs & features")}
            {roundUtil("🎨", () => setShowColorKey(true), "Color key")}
            {roundUtil("⌨", () => setShowShortcuts(true), "Keyboard shortcuts")}
            {roundUtil("↶", undo, "Undo (Ctrl/Cmd+Z)", !canUndo)}
            {roundUtil("↷", redo, "Redo (Ctrl/Cmd+Shift+Z)", !canRedo)}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setBackupOpen((o) => !o)}
                title="Back up or restore your study"
                style={pillStyle}
              >
                Backup
                <span style={{ fontSize: "9px" }}>▼</span>
              </button>
              {backupOpen && (
                <>
                  <div
                    onClick={() => setBackupOpen(false)}
                    style={{ position: "fixed", inset: 0, zIndex: 40 }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      top: "38px",
                      right: 0,
                      width: "210px",
                      backgroundColor: "var(--panel)",
                      border: "1px solid var(--border)",
                      borderRadius: "12px",
                      boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
                      padding: "6px",
                      zIndex: 41,
                    }}
                  >
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
                      ⬇ Export my study (.json)
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
                      ⬆ Restore from backup
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
                        <div
                          style={{
                            padding: "10px 12px",
                            fontSize: "13px",
                            color: "var(--muted)",
                          }}
                        >
                          ● Synced
                          {cloudEmail ? " · " + cloudEmail : ""}
                          {cloudSyncing ? " · saving…" : ""}
                        </div>
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
                        🔑 Sign in with Google
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
                      🔑 Sign in with Google
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
                      ☁️ Save to Google Drive
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
                      ⬇ Load from Google Drive
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
                      🔍 Check sync
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
            {roundUtil(
              dark ? "☀" : "🌙",
              () => setDark(!dark),
              dark ? "Switch to light mode" : "Switch to dark mode"
            )}
            <div style={{ position: "relative" }}>
              {roundUtil(
                "Aa",
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
                "🎨",
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
            {mode === "read" &&
              actionButton(sidebarOpen ? "Hide marks" : "Show marks", () =>
                setSidebarOpen(!sidebarOpen)
              )}
            {mode === "read" &&
              actionButton(
                "Compile →",
                activeTab.studyId
                  ? () => {
                      const st = searchStudies.find(
                        (s) => s.id === activeTab.studyId
                      );
                      if (st) startStudyCompile(st);
                    }
                  : startCompile,
                true
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
            top: "62px",
            zIndex: 25,
          }}
        >
          {tabs.map((t) => {
            const active = t.id === activeTabId;
            const gid = chapterGroups[chapterScopeOf(t)];
            const linked = !t.studyId && !!gid;
            const linkColor = gid ? groupColor(gid) : "#8b5cf6";
            return (
              <div
                key={t.id}
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
                  backgroundColor: active ? "var(--text)" : "var(--panel)",
                  color: active ? "var(--bg)" : "var(--text)",
                  border: linked
                    ? "2px solid " + linkColor
                    : "1px solid var(--border)",
                  transition: "all 0.15s",
                }}
              >
                {tabLabel(t)}
                {tabs.length > 1 && !t.studyId && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      openLinkPrompt(t);
                    }}
                    title={
                      linked
                        ? "Linked study — click to change which chapters it links, or unlink"
                        : "Link this chapter — choose which open tabs to link it with"
                    }
                    style={{
                      fontSize: "12px",
                      lineHeight: 1,
                      opacity: linked ? 1 : 0.4,
                      color: linked
                        ? linkColor
                        : active
                        ? "var(--bg)"
                        : "var(--text)",
                    }}
                  >
                    🔗
                  </span>
                )}
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
            top: "113px",
            zIndex: 24,
            fontSize: "11.5px",
          }}
        >
          {usedColors.length === 0 ? (
            <span style={{ color: "var(--muted)", opacity: 0.55 }}>
              Highlight verses to start naming your colors
            </span>
          ) : (
            usedColors.map((c) => {
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
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--text)",
                      outline: "none",
                      width: "120px",
                    }}
                  />
                ) : (
                  <span
                    onClick={() => {
                      setEditingColor(c);
                      setColorDraft(activeScopedLabels[c] || "");
                    }}
                    title="Click to name this color"
                    style={{
                      color: "var(--muted)",
                      cursor: "pointer",
                      borderBottom: "1px dashed var(--border)",
                    }}
                  >
                    {activeScopedLabels[c]?.trim() ? activeScopedLabels[c] : "Name…"}
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
              return (
                <div
                  key={t.id}
                  onMouseDown={() => setActiveTabId(t.id)}
                  style={{
                    flex: multi ? "1 0 360px" : 1,
                    minWidth: 0,
                    borderRight: multi ? "1px solid var(--border)" : "none",
                    outline:
                      multi && isActive ? "2px solid var(--text)" : "none",
                    outlineOffset: "-2px",
                    overflowY: multi ? "auto" : "visible",
                    height: multi ? "calc(100vh - 150px)" : "auto",
                  }}
                >
                  <VerseViewer
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
                    marks={getBook(t.bookId).marks}
                    showToolbar={isActive}
                    toolbarPos={toolbarPos}
                    onToolbarPos={setToolbarPos}
                    toolbarOrient={toolbarOrient}
                    onToolbarOrient={setToolbarOrient}
                    panelMode={multi}
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
                  />
                </div>
              );
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
                    onClick={() => {
                      if (
                        window.confirm(
                          `Clear ALL marks on ${
                            activeTab.studyId ? "this study" : "this chapter"
                          }? This removes every highlight, underline, and other mark here regardless of color or style. You can undo it.`
                        )
                      ) {
                        clearMarks(Array.from(activeChapterRefs));
                      }
                    }}
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
                <p style={{ color: "var(--muted)", fontSize: "13px" }}>
                  {activeTab.studyId
                    ? "No marks on this study yet."
                    : "No marks on this chapter yet."}
                </p>
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
                      deleteMarkGroup(group.reference, group.color)
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

      {mode === "compile" && (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: "12px",
              padding: "16px 16px 0",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "flex",
                border: "1px solid var(--border)",
                borderRadius: "999px",
                overflow: "hidden",
                backgroundColor: "var(--panel)",
                flexWrap: "wrap",
              }}
            >
              {viewTabButton(compileView === "cornell", "Cornell Notes", () =>
                setCompileView("cornell")
              )}
              {viewTabButton(compileView === "outline", "Outline", () =>
                setCompileView("outline")
              )}
              {viewTabButton(compileView === "charting", "Charting", () =>
                setCompileView("charting")
              )}
              {viewTabButton(compileView === "map", "Concept Map", () =>
                setCompileView("map")
              )}
            </div>

            <button
              onClick={handlePrintLive}
              style={{
                padding: "9px 18px",
                borderRadius: "999px",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text)",
                cursor: "pointer",
                fontSize: "13.5px",
              }}
            >
              ⎙ Print / PDF
            </button>

            <button
              onClick={() => setSharingVerses(true)}
              style={{
                padding: "9px 18px",
                borderRadius: "999px",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text)",
                cursor: "pointer",
                fontSize: "13.5px",
              }}
            >
              ⤴ Share image
            </button>
          </div>

          {compileView === "cornell" && (
            <CornellNotes
              {...sharedCompileProps}
              notes={notes}
              setNote={setNote}
            />
          )}
          {compileView === "outline" && (
            <Outline {...sharedCompileProps} notes={notes} setNote={setNote} />
          )}
          {compileView === "charting" && <Charting {...sharedCompileProps} />}
          {compileView === "map" && <ConceptMap {...sharedCompileProps} />}
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
              onDelete={(id) => {
                if (id === activeBookId) setActiveBook("master");
                deleteBook(id);
              }}
              onClose={() => setMode("read")}
            />
          );
        })()}
    </div>
  );
}
