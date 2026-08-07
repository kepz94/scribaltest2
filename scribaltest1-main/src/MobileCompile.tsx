import { useState, useRef, useEffect, useLayoutEffect, CSSProperties } from "react";
import { getScriptures, volumesProxy } from "./data/scripturesStore";
import MarkedVerse from "./components/MarkedVerse";
import { Mark, MarkColor, Tab, WordTag, COLORS, COLOR_MAP, STYLE_POINTS, markStyleCSS } from "./types";
import Distilled from "./components/Distilled";
import RichNoteField from "./components/RichNoteField";
import type { LinkableDefinition, LinkableVerse } from "./components/RichNoteField";
import { definitionForKey, sensesFor } from "./webster";
import { glossesFor } from "./components/MarkedVerse";
import {
  resolveSynthesisKey,
  legacySynthesisKeyToMigrate,
  synthesisKeyForScope,
} from "./synthesisKey";
import { useWebsterReady } from "./useWebsterReady";
import { dockTop } from "./chromeDock";
import {
  linkableDefinitionsFor,
  linkableVersesFor,
  hasTaggedWords,
} from "./linkableDefinitions";
import SemanticView from "./components/SemanticView";
import WordStudies from "./components/WordStudies";
import SharePreview from "./SharePreview";
import type { VersesCardEntry, VersesSynthesis } from "./shareCard";
import { buildStudySummary, StudySummary } from "./studySummary";

interface Palette {
  bg: string;
  panel: string;
  soft: string;
  text: string;
  muted: string;
  border: string;
}

interface Props {
  marks: Mark[];
  colorLabels: Record<number, string>;
  C: Palette;
  orderOf: (ref: string) => number;
  // The exact references this study's reading panel shows, when narrower than
  // its chapters (a keyword study's gathered verses). The Link verse picker
  // offers these and only these — see linkableVersesFor.
  panelRefs?: string[];
  sessionNew: Set<string>;
  onJump: (ref: string) => void;
  notes: Record<string, string>;
  setNote: (key: string, text: string) => void;
  onSave: (name: string, view: "outline" | "distilled" | "semantic") => void;
  // The view to open in — a saved study reopens on the tab it was saved in.
  // Absent → Outline.
  initialFormat?: "outline" | "distilled" | "semantic";
  // True when this compile is a saved study (opened from the Studies tab). Saved
  // studies open straight to their saved format with the format switcher tucked
  // behind a button, to keep the study itself the focus.
  savedStudy?: boolean;
  // This study's saved relational condition/promise roles (synced) + a setter
  // Outline lead verses: per color, refs the user pinned to a theme's top —
  // "this verse carries the theme for me." Pure user choice; no ranking.
  savedPins?: Record<string, string[]>;
  onPins?: (pins: Record<string, string[]>) => void;
  defaultName: string;
  onClose: () => void;
  dark: boolean;
  title: string;
  scope: string;
  studyScopes?: string[];
  // Word-study tags already scoped to this study; rendered as a glossary at the
  // bottom of every compiled view.
  tags?: WordTag[];
  onFlash: (msg: string) => void;
  // Rename a theme (color) for this study's scope. Optional so older callers
  // still type-check; when supplied, active theme names become editable inline.
  onRenameTheme?: (color: number, name: string) => void;
  // Read-only preview (the built-in example study): hides Save/Share and makes
  // the study name non-editable, so nothing can be written from the demo.
  readOnly?: boolean;
  // Example-only handoff: when provided (with readOnly), a single primary CTA
  // replaces the Save/Share row, inviting the reader to start marking for real.
  onTryIt?: () => void;
  tryItLabel?: string;
  // Add another chapter to this study (recorded chapter/linked studies only).
  // Opens the chapter picker; the chosen chapter is linked into the study.
  onAddChapter?: () => void;
}

type SortMode = "order" | "points";

// Look up a verse's full text + number by reference (e.g. "1 Nephi 2:5").
// Built once, lazily, the first time Compile opens — used for the Full-verse view.
let _verseIndex: Map<string, { text: string; verse: number }> | null = null;
function verseIndex(): Map<string, { text: string; verse: number }> {
  if (_verseIndex) return _verseIndex;
  const m = new Map<string, { text: string; verse: number }>();
  getScriptures().volumes.forEach((vol: any) =>
    vol.books.forEach((bk: any) =>
      bk.chapters.forEach((ch: any) =>
        ch.verses.forEach((v: any) =>
          m.set(v.reference, { text: v.text, verse: v.verse })
        )
      )
    )
  );
  _verseIndex = m;
  return m;
}

// Reference -> volume/book/chapter indices. Lets the shared Distilled /
// Covenants views (which expect compile tabs) work from mobile's flat marks.
let _locIndex: Map<string, { v: number; b: number; c: number }> | null = null;
function locIndex(): Map<string, { v: number; b: number; c: number }> {
  if (_locIndex) return _locIndex;
  const m = new Map<string, { v: number; b: number; c: number }>();
  getScriptures().volumes.forEach((vol: any, vi: number) =>
    vol.books.forEach((bk: any, bi: number) =>
      bk.chapters.forEach((ch: any, ci: number) =>
        ch.verses.forEach((v: any) =>
          m.set(v.reference, { v: vi, b: bi, c: ci })
        )
      )
    )
  );
  _locIndex = m;
  return m;
}

export default function MobileCompile({
  marks,
  colorLabels,
  C,
  orderOf,
  panelRefs,
  sessionNew,
  onJump,
  notes,
  setNote,
  onSave,
  initialFormat,
  savedStudy,
  savedPins,
  onPins,
  defaultName,
  onClose,
  dark,
  title,
  scope,
  studyScopes,
  tags,
  onFlash,
  onRenameTheme,
  readOnly,
  onTryIt,
  tryItLabel,
  onAddChapter,
}: Props) {
  // Inline theme-name editing on the outline. Only one name edits at a time; the
  // draft is committed (saved) on blur so we don't churn the store per keystroke.
  const [editingTheme, setEditingTheme] = useState<number | null>(null);
  const [themeDraft, setThemeDraft] = useState("");
  const synthKey = (color: number) => "synthesis:" + scope + ":" + color;
  // Per-verse notes live in the same store, keyed by the verse reference, so a
  // note follows its verse whether viewed alone or inside a linked study.
  const verseNoteKey = (ref: string) => "versenote:" + ref;
  // ── Unified note model: mobile speaks desktop's keys natively ───────────
  // Verse notes are per-theme (note|chapter|c<color>|verse) and the study has
  // ONE synthesis (synthesis|<chapters>). Legacy mobile keys above are read
  // as fallback only; the first edit re-homes a note under the shared key.
  const chapterRefOf = (ref: string) => ref.replace(/:\d+$/, "");
  const dVerseKey = (color: number, ref: string) =>
    "note|" + chapterRefOf(ref) + "|c" + color + "|" + ref;
  const flattenRich = (raw: string) => {
    if (!/<[a-z]/i.test(raw)) return raw;
    const el = document.createElement("div");
    el.innerHTML = raw.replace(/<(br|\/p|\/li|\/h1|\/h2|\/blockquote)[^>]*>/gi, "\n");
    return (el.textContent || "").replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  };
  // The study's chapters, in the SAME terms desktop states them: its scope.
  // This used to be derived from the marks, which is a narrower thing — a
  // linked study whose second chapter has no marks yet looked like a
  // one-chapter study here, so mobile minted its own synthesis key beside
  // desktop's and the two shells then read and wrote different notes.
  const compileChapters = () => {
    if (studyScopes && studyScopes.length) return studyScopes.slice();
    const seen: string[] = [];
    activeColors.forEach((c) =>
      (byColor[c] || []).forEach((m: any) => {
        const ch = chapterRefOf(m.reference || String(m));
        if (!seen.includes(ch)) seen.push(ch);
      })
    );
    return seen;
  };
  // One resolver, shared with desktop and unit-tested. The scope names the
  // STUDY and is what a new synthesis is keyed by; the chapter list is only
  // consulted to find notes written before that was true. Passing the scope is
  // what stops a study losing its synthesis the moment it gathers a verse from
  // a chapter it did not already cover.
  const dSynthKey = () => resolveSynthesisKey(notes, compileChapters(), scope);
  // One-time hand-off. A synthesis written under the old chapter-list key is
  // copied onto this study's scope key the first time the study is opened,
  // because reading it in place leaves it exposed to the very failure the scope
  // key exists to prevent. Idempotent: once the scope key holds text the helper
  // returns null and this never fires again.
  useEffect(() => {
    const old = legacySynthesisKeyToMigrate(notes, compileChapters(), scope);
    if (old) {
      const text = notes[old];
      setNote(synthesisKeyForScope(scope), text);
      // Clear the legacy key once its text is safely on the scope key. Leaving
      // it meant deleting the migrated synthesis re-ran this migration and the
      // old copy came straight back — a delete that silently reverted.
      setNote(old, "");
    }
    // eslint-disable-next-line
  }, [scope, notes]);
  const readVerseNote = (color: number, ref: string) => {
    const v = notes[dVerseKey(color, ref)];
    if (v && v.trim()) return flattenRich(v);
    return flattenRich(notes[verseNoteKey(ref)] || "");
  };
  // The synthesis as it was written — headings, dividers, lists and all. Every
  // surface that can render structure takes this one.
  // The study synthesis and nothing else. This used to fall back to the first
  // per-THEME synthesis it could find, so the box could display text that was
  // not its own — and clearing the box made the theme text "come back", which
  // read as data resurrecting. One key, one reader.
  const readSynthRaw = () => notes[dSynthKey()] || "";
  const [sortMode, setSortMode] = useState<SortMode>("order");
  // Lead verses (pins): user-chosen verses that always sit at a theme's top,
  // in the order they were pinned — above any automatic sort.
  const pins = savedPins || {};
  const pinsFor = (color: number): string[] => pins[String(color)] || [];
  const togglePin = (color: number, ref: string) => {
    if (!onPins) return;
    const key = String(color);
    const cur = pins[key] || [];
    onPins({
      ...pins,
      [key]: cur.includes(ref)
        ? cur.filter((r) => r !== ref)
        : [...cur, ref],
    });
  };
  const [studyName, setStudyName] = useState(defaultName);
  // Full verse by default, matching desktop. One state drives both the outline
  // and what a share card carries, so a share defaults to full verses too.
  const [view, setView] = useState<"focused" | "full">("full");
  // The study format. Outline keeps its own Focused/Full + sort sub-options;
  // Distilled is its own format, its own view.
  const [format, setFormat] = useState<"outline" | "distilled" | "semantic">(
    initialFormat || "outline"
  );
  // Whether the tucked-away view options (Focused/Full, In order/By points) are
  // showing. Collapsed by default so the study itself stays the focus.
  const [optionsOpen, setOptionsOpen] = useState(false);
  // For saved studies: whether the format switcher (Outline/Distilled/Relational)
  // is revealed. Collapsed by default — the study opens on its saved format.
  const [showFormats, setShowFormats] = useState(false);
  // Which verse card is flipped to its note side (one at a time).
  const [flippedRef, setFlippedRef] = useState<string | null>(null);
  // Which synthesis / verse-note is in edit mode (textarea open). Otherwise the
  // text shows as a finished part of the card with an Edit button.
  const [editSynth, setEditSynth] = useState<string | null>(null);
  const [editNote, setEditNote] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  // Hide the header + toggles while reading down through verses (and bring
  // them back when scrolling up), so a long study isn't half-covered by chrome.
  const [headHidden, setHeadHidden] = useState(false);
  // How many note editors are open. While one is, its toolbar is anchored to the
  // top of the screen, and the chrome is not allowed to take that back: scrolling
  // up by a line would otherwise slide the header in over the toolbar and shove
  // it a chrome's height down the screen mid-paragraph. It still gets out of the
  // way on scroll-down, and it still comes home once you are back at the top of
  // the study, where the chrome is what you are reaching for.
  const [editorsOpen, setEditorsOpen] = useState(0);
  const noteEditing = (on: boolean) =>
    setEditorsOpen((n) => Math.max(0, n + (on ? 1 : -1)));
  const editorsOpenRef = useRef(0);
  editorsOpenRef.current = editorsOpen;
  const lastY = useRef(0);
  const onScroll = (y: number) => {
    if (y > lastY.current + 6 && y > 40) setHeadHidden(true);
    else if (y < lastY.current - 6 && !(editorsOpenRef.current > 0 && y > 40))
      setHeadHidden(false);
    lastY.current = y;
  };
  // Measure the chrome (header + toggles) so the scroll area can pad its top by
  // exactly that much. The chrome is an absolute overlay that slides up/down —
  // so the scroll area never resizes mid-scroll (which is what was stuttering).
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(0);
  // Quick-find: a ref to the board's scroll container (so a result can scroll
  // its verse card into view) and the live query the Find bar is filtering on.
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  const [findQ, setFindQ] = useState("");
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The scroll area clears the chrome with padding rather than by resizing, so
  // nothing reflows when the chrome slides. One constant, used by the scroller
  // itself and by the toolbar's offset — a sticky offset resolves against this
  // container's CONTENT box, so anything docking to the top of the SCREEN has to
  // subtract it back off.
  const scrollPadTop = headerH + 10;

  // Publish the line a note's toolbar docks to. A note cannot work this out from
  // the inside — the chrome is an absolute overlay over the scroller, not a
  // sticky ancestor — and only App.tsx was ever setting the variable, so on
  // mobile the toolbar fell back to top: 0 and docked underneath the overlay.
  //
  // The chrome is the only input. The keyboard needs no term of its own: iOS
  // clamps this fixed screen to the visual viewport, so the top of the screen
  // already IS the top of what can be seen. See chromeDock.ts — adding
  // visualViewport.offsetTop on top of that is what left the toolbar floating
  // mid-screen.
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--scribal-chrome-h",
      dockTop({
        chromeH: headerH,
        chromeHidden: headHidden,
        // The scroller's own padding sits between the top of the screen and a
        // sticky `top: 0`, so the offset has to cancel it. Same expression as
        // the scroller below, off one constant, so the two cannot drift.
        scrollerPadTop: scrollPadTop,
      })
    );
    return () => {
      document.documentElement.style.setProperty("--scribal-chrome-h", "0px");
    };
  }, [headerH, headHidden, scrollPadTop]);
  const [versesPreview, setVersesPreview] = useState<VersesCardEntry[] | null>(
    null
  );
  const [versesSyntheses, setVersesSyntheses] = useState<VersesSynthesis[]>([]);
  // The whole study: its summary card as a cover, then every marked verse.
  const [studyPreview, setStudyPreview] = useState<{
    verses: VersesCardEntry[];
    comp: StudySummary;
    syntheses: VersesSynthesis[];
  } | null>(null);
  const VI = verseIndex();
  const [compPreview, setCompPreview] = useState<{
    scopeTitle: string;
    studyLabel: string;
    dateStr: string;
    totalMarks: number;
    passages: number;
    themes: { name: string; color: number; synthesis: string; count: number }[];
    candidates: {
      text: string;
      reference: string;
      style: string;
      color: number;
    }[];
    defaultFeatured: number;
  } | null>(null);
  // Collapsed by default — but themes you just added open automatically.
  const sealedOf = (m: Mark) =>
    m.label !== undefined && m.label.trim() !== "";
  const groupKeyOf = (m: Mark) =>
    sealedOf(m) ? "s:" + (m.label as string).trim() : "c:" + m.color;
  // Compile is scoped to one chapter (the marks passed in), so every mark here
  // belongs to this study — show them all, grouped by their theme.
  const liveMarks = marks;

  // For the shared Distilled / Covenants views: the distinct chapters present
  // in these marks, expressed as compile tabs, plus the prop shape those
  // components expect (most fields unused on mobile — the tab picker is hidden).
  const sharedCompileTabs: Tab[] = (() => {
    const loc = locIndex();
    const seen = new Set<string>();
    const out: Tab[] = [];
    liveMarks.forEach((m) => {
      const l = loc.get(m.reference);
      if (!l) return;
      const key = l.v + ":" + l.b + ":" + l.c;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        id: "mob_" + key,
        volume: l.v,
        book: l.b,
        chapter: l.c,
        bookId: "mobile",
      });
    });
    return out;
  })();
  const sharedViewProps = {
    tabs: [] as Tab[],
    compileTabs: sharedCompileTabs,
    compileSelection: [] as string[],
    onToggleCompileTab: () => {},
    hideTabPicker: true,
    marks: liveMarks,
    colorLabels,
    setColorLabel: () => {},
    onJumpToReference: onJump,
  };
  const [expanded, setExpanded] = useState<string[]>(() => {
    // Linked studies span several chapters and many verses — open them
    // collapsed so the themes are the headline; verses are a tap away.
    if (studyScopes && studyScopes.length > 1) return [];
    const s = new Set<string>();
    liveMarks.forEach((m) => {
      if (sessionNew.has(m.id)) s.add(groupKeyOf(m));
    });
    return Array.from(s);
  });

  const isNew = (m: Mark) => sessionNew.has(m.id);

  const byColor: Record<number, Mark[]> = {};
  liveMarks.forEach((m) => {
    (byColor[m.color] = byColor[m.color] || []).push(m);
  });
  const activeColors = COLORS.filter((c) => (byColor[c] || []).length > 0);

  // Group marks by their effective theme name: sealed marks group by their
  // frozen label, active marks by their color's live label. This keeps a
  // sealed "Faith" study separate from a later "Hope" study on the same color.
  type Group = {
    key: string;
    color: number;
    name: string;
    isSealed: boolean;
    marks: Mark[];
  };
  const groupMap = new Map<string, Group>();
  liveMarks.forEach((m) => {
    const sealed = sealedOf(m);
    const key = groupKeyOf(m);
    let g = groupMap.get(key);
    if (!g) {
      g = {
        key,
        color: m.color,
        name: sealed
          ? (m.label as string).trim()
          : (colorLabels[m.color] || "Color " + m.color).trim(),
        isSealed: sealed,
        marks: [],
      };
      groupMap.set(key, g);
    }
    g.marks.push(m);
  });
  const groupMinOrder = (g: Group) =>
    Math.min(...g.marks.map((m) => orderOf(m.reference)));
  const groups = Array.from(groupMap.values()).sort((a, b) => {
    const an = a.marks.some((m) => sessionNew.has(m.id)) ? 0 : 1;
    const bn = b.marks.some((m) => sessionNew.has(m.id)) ? 0 : 1;
    if (an !== bn) return an - bn;
    if (a.isSealed !== b.isSealed) return a.isSealed ? 1 : -1;
    return groupMinOrder(a) - groupMinOrder(b);
  });

  // Definitions tagged within this study, one row per chosen sense — what the
  // note editor's Link definition button can offer.
  // Only fetch the dictionary if this study has anything to look up.
  const dictReady = useWebsterReady(hasTaggedWords(tags));
  const linkableDefinitions: LinkableDefinition[] = linkableDefinitionsFor(
    tags,
    dictReady
  );

  // Verses this study can link from a note — the shared builder, one rule with
  // desktop: exactly what the reading panel shows. Marked verses group under
  // their heaviest theme; panelRefs (a keyword study's gathered verses) adds
  // its not-yet-marked verses as the Unmarked group, and ONLY those — never
  // the whole chapters they came from.
  const linkableVerses: LinkableVerse[] = linkableVersesFor(
    Array.from(
      new Set([...liveMarks.map((m) => m.reference), ...(panelRefs || [])])
    )
      .sort((a, b) => orderOf(a) - orderOf(b))
      .map((reference) => {
        const info = VI.get(reference);
        return { reference, text: info ? info.text : "" };
      }),
    liveMarks,
    STYLE_POINTS as Record<string, number>,
    (c) => colorLabels[c] || "",
    // The entry list is already the panel; no second filter needed.
    null
  ) as LinkableVerse[];
  // A chip's preview: the marked phrases alone, or the whole verse.
  const focusedForRef = (reference: string) =>
    liveMarks
      .filter((m) => m.reference === reference)
      .sort((a, b) => a.startIndex - b.startIndex)
      .map((m) => m.markedText)
      .join(" · ");
  const fullTextForRef = (reference: string) => {
    const info = VI.get(reference);
    return info ? info.text : "";
  };

  // Everything the note toolbar needs, so mobile's editor is one-to-one with
  // desktop's — the same buttons, the same pickers, the same chip previews.
  const noteWiring = {
    linkableVerses,
    linkableDefinitions,
    focusedFor: focusedForRef,
    fullTextFor: fullTextForRef,
    onJumpToReference: onJump,
    // Every note field on this screen reports its editor, so the chrome knows
    // to leave the top of the screen alone while one is open.
    onEditingChange: noteEditing,
  };

  const studySummary = () =>
    buildStudySummary({
      marks: liveMarks,
      colorLabels,
      orderOf,
      title,
      // Raw: the cover reads its paragraphs and prints them all. Flattening it
      // here is what reduced a whole synthesis to one line on the card.
      synthesis: readSynthRaw(),
    });

  const shareStudy = () => setCompPreview(studySummary());

  const pointsFor = (list: Mark[]) =>
    list.reduce((s, m) => s + (STYLE_POINTS[m.style] || 0), 0);

  // Group a theme's marks by verse → one entry per verse (matches desktop),
  // then sort: freshly-marked verses first, then by points or scripture order.
  type VerseEntry = {
    reference: string;
    marks: Mark[];
    pts: number;
    order: number;
    isNew: boolean;
  };
  const verseEntriesFor = (list: Mark[], color?: number): VerseEntry[] => {
    const byRef = new Map<string, Mark[]>();
    list.forEach((m) => {
      const arr = byRef.get(m.reference);
      if (arr) arr.push(m);
      else byRef.set(m.reference, [m]);
    });
    const entries: VerseEntry[] = [];
    byRef.forEach((ms, reference) => {
      entries.push({
        reference,
        marks: ms.slice().sort((a, b) => a.startIndex - b.startIndex),
        pts: pointsFor(ms),
        order: orderOf(reference),
        isNew: ms.some(isNew),
      });
    });
    const pinned = color != null ? pinsFor(color) : [];
    const pinRank = (r: string) => {
      const i = pinned.indexOf(r);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    entries.sort((a, b) => {
      // The user's lead verses first, in pin order — their call outranks
      // every automatic sort.
      const pa = pinRank(a.reference);
      const pb = pinRank(b.reference);
      if (pa !== pb) return pa - pb;
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      return sortMode === "points"
        ? b.pts - a.pts || a.order - b.order
        : a.order - b.order;
    });
    return entries;
  };

  // Flat list of every (verse × theme) entry, for the share picker. Each carries
  // that theme's marks on the verse — matching what the outline shows.
  type ShareableVerse = {
    key: string;
    reference: string;
    theme: string;
    color: number;
    phrases: { text: string; style: string }[];
    marks: { startIndex: number; endIndex: number; style: string; color: number }[];
  };
  const shareableVerses: ShareableVerse[] = [];
  groups.forEach((g) => {
    verseEntriesFor(g.marks, g.color).forEach((ve) => {
      shareableVerses.push({
        key: g.key + "|c" + g.color + "|" + ve.reference,
        reference: ve.reference,
        theme: g.name,
        color: g.color,
        phrases: ve.marks.map((m) => ({ text: m.markedText, style: m.style })),
        marks: ve.marks.map((m) => ({
          startIndex: m.startIndex,
          endIndex: m.endIndex,
          style: m.style,
          color: m.color,
        })),
      });
    });
  });
  // No cap: a selection bigger than one card becomes a multi-page PDF.
  const togglePick = (key: string) =>
    setPicked((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  const entriesFor = (chosen: ShareableVerse[]): VersesCardEntry[] =>
    chosen.map((sv) => {
      const info = VI.get(sv.reference);
      return {
        reference: sv.reference,
        theme: sv.theme,
        color: sv.color,
        phrases: sv.phrases,
        note: readVerseNote(sv.color, sv.reference).trim() || undefined,
        view,
        fullText: info ? info.text : undefined,
        verseNumber: info ? info.verse : undefined,
        marks: sv.marks,
        glosses: glossesFor((tags || []).filter((t) => t.reference === sv.reference)),
      };
    });

  // The whole study, in the order the outline shows it — cover card first, then
  // every marked verse. Nothing is picked; the study is the selection.
  const startShareStudy = () => {
    if (shareableVerses.length === 0) return;
    setSelectMode(false);
    // Every theme's synthesis, not just the picked verses' — this is the whole
    // study, so the writing that closes it belongs with it.
    const seen = new Set<number>();
    const synths: VersesSynthesis[] = [];
    shareableVerses.forEach((sv) => {
      if (seen.has(sv.color)) return;
      seen.add(sv.color);
      const text = (notes[synthKey(sv.color)] || "").trim();
      if (text) synths.push({ theme: sv.theme, color: sv.color, text });
    });
    // The study-wide synthesis (the one the outline writes) leads.
    const overall = readSynthRaw().trim();
    if (overall) synths.unshift({ theme: "Synthesis", color: 6, text: overall });
    setStudyPreview({
      verses: entriesFor(shareableVerses),
      comp: studySummary(),
      syntheses: synths,
    });
  };

  const startShareVerses = () => {
    const chosen = picked
      .map((k) => shareableVerses.find((sv) => sv.key === k))
      .filter((x): x is ShareableVerse => !!x);
    if (chosen.length === 0) return;
    setVersesPreview(entriesFor(chosen));
    // One synthesis per distinct theme among the chosen verses (if written).
    const seen = new Set<number>();
    const synths: VersesSynthesis[] = [];
    chosen.forEach((sv) => {
      if (seen.has(sv.color)) return;
      seen.add(sv.color);
      const text = (notes[synthKey(sv.color)] || "").trim();
      if (text) synths.push({ theme: sv.theme, color: sv.color, text });
    });
    // The study's own synthesis leads, as it does on a whole-study share and on
    // desktop — sending a few core verses alongside your conclusion is a normal
    // thing to want. Unshifted, so it sits at the forefront of the card rather
    // than behind the theme notes; the preview's Synthesis chip turns it off.
    const overall = readSynthRaw().trim();
    if (overall) synths.unshift({ theme: "Synthesis", color: 6, text: overall });
    setVersesSyntheses(synths);
    setSelectMode(false);
  };

  const toggle = (key: string) =>
    setExpanded((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    );

  const seg = (active: boolean, label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "8px 0",
        border: "none",
        borderRadius: "8px",
        fontSize: "12.5px",
        fontWeight: active ? 700 : 500,
        backgroundColor: active ? C.text : "transparent",
        color: active ? C.bg : C.muted,
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "background-color 0.15s, color 0.15s",
      }}
    >
      {label}
    </button>
  );

  // ── Quick-find ─────────────────────────────────────────────────────────────
  // A per-verse index of this study's marks. A verse matches the Find bar on
  // its reference, on any word that was marked in it, or on any of its theme
  // names — the three ways someone reaches for a verse mid-class.
  const findIndex = (() => {
    const byRef = new Map<
      string,
      { color: number; themes: Set<string>; texts: string[] }
    >();
    liveMarks.forEach((m) => {
      const theme = sealedOf(m)
        ? (m.label as string).trim()
        : (colorLabels[m.color] || "Color " + m.color).trim();
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
      .sort((a, b) => orderOf(a.reference) - orderOf(b.reference));
  })();
  const findQuery = findQ.trim().toLowerCase();
  const findResults = findQuery
    ? findIndex
        .filter(
          (r) =>
            r.reference.toLowerCase().includes(findQuery) ||
            r.themes.some((t) => t.toLowerCase().includes(findQuery)) ||
            r.texts.some((t) => t.toLowerCase().includes(findQuery))
        )
        .slice(0, 40)
    : [];

  // Scroll the board to a verse's card and flash it briefly. In Outline the
  // verse's theme group may be collapsed (its card not yet mounted), so open
  // the group first; the rAF retry waits for that card to appear, then scrolls.
  const flashAndScroll = (ref: string, tries = 0) => {
    const box = scrollBoxRef.current;
    const el = box
      ? (box.querySelector(`[data-vref="${ref}"]`) as HTMLElement | null)
      : null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("qf-flash");
      window.setTimeout(() => el.classList.remove("qf-flash"), 1400);
      return;
    }
    if (tries < 14) requestAnimationFrame(() => flashAndScroll(ref, tries + 1));
  };
  const scrollToVerse = (ref: string) => {
    if (format === "outline") {
      const keys = Array.from(
        new Set(
          liveMarks
            .filter((m) => m.reference === ref)
            .map((m) => groupKeyOf(m))
        )
      );
      if (keys.length)
        setExpanded((prev) => Array.from(new Set([...prev, ...keys])));
    }
    flashAndScroll(ref);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        backgroundColor: C.bg,
        color: C.text,
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, -apple-system, sans-serif",
        animation: "mob-fadein 0.2s ease",
      }}
    >
      <style>{`
        @keyframes qf-flash {
          0% { box-shadow: 0 0 0 0 rgba(217,164,65,0); }
          18% { box-shadow: 0 0 0 3px rgba(217,164,65,.95); }
          100% { box-shadow: 0 0 0 0 rgba(217,164,65,0); }
        }
        .qf-flash { animation: qf-flash 1.4s ease; border-radius: 8px; }
      `}</style>
      {/* chrome (header + toggles) — an absolute overlay that slides up while
          reading down and back on scroll-up, like the reading screen. Because
          it's an overlay, the scroll area never resizes, so scrolling is smooth. */}
      <div
        ref={headerRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 5,
          backgroundColor: C.bg,
          transform: headHidden ? "translateY(-100%)" : "translateY(0)",
          transition: "transform 0.3s ease",
          willChange: "transform",
        }}
      >
        {/* notch strip — content never hides under the status bar */}
        <div style={{ height: "env(safe-area-inset-top)", backgroundColor: C.bg }} />
        {selectMode && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "12px 14px",
              borderBottom: "1px solid " + C.border,
            }}
          >
            <button
              onClick={() => setSelectMode(false)}
              aria-label="Cancel selecting"
              style={{
                width: "36px",
                height: "36px",
                background: "transparent",
                border: "none",
                color: C.text,
                fontSize: "22px",
                cursor: "pointer",
                flexShrink: 0,
                marginLeft: "-6px",
              }}
            >
              ‹
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "17px", fontWeight: 700 }}>
                Choose verses to share
              </div>
              <div style={{ fontSize: "12px", color: C.muted }}>
                {/* There is no cap. Say what the selection will BECOME — the
                    system decides the format, the reader decides the verses. */}
                {picked.length === 0
                  ? "Tap verses to select · " +
                    shareableVerses.length +
                    " in this study"
                  : picked.length +
                    (picked.length === 1 ? " verse" : " verses") +
                    " · shares as " +
                    (picked.length > 4 ? "a PDF" : "one card")}
              </div>
            </div>
          </div>
        )}
        {!selectMode && (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          padding: "12px 14px 12px",
          borderBottom: "1px solid " + C.border,
        }}
      >
        {/* Row 1 — back + editable study name + scope */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <button
            onClick={onClose}
            aria-label="Back"
            style={{
              width: "36px",
              height: "36px",
              background: "transparent",
              border: "none",
              color: C.text,
              fontSize: "22px",
              cursor: "pointer",
              flexShrink: 0,
              marginLeft: "-6px",
            }}
          >
            ‹
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <input
              value={studyName}
              onChange={(e) => setStudyName(e.target.value)}
              placeholder={defaultName}
              aria-label="Study name"
              readOnly={readOnly}
              style={{
                width: "100%",
                boxSizing: "border-box",
                fontSize: "19px",
                fontWeight: 700,
                background: "transparent",
                border: "none",
                borderBottom: readOnly ? "none" : "1px dashed " + C.border,
                color: C.text,
                fontFamily: "inherit",
                padding: "1px 0 4px",
                outline: "none",
              }}
            />
          </div>
        </div>
        {/* Row 2 — actions (Save is the primary, Share is secondary) */}
        {!readOnly && liveMarks.length > 0 && (
          <div style={{ display: "flex", gap: "8px" }}>
            {onAddChapter && (
              <button
                onClick={onAddChapter}
                title="Add a chapter to this study"
                style={{
                  flexShrink: 0,
                  background: "transparent",
                  color: C.text,
                  border: "1px solid " + C.border,
                  borderRadius: "999px",
                  padding: "10px 14px",
                  fontSize: "13.5px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                + Chapter
              </button>
            )}
            {(
              <button
                onClick={() => {
                  setPicked([]);
                  setFormat("outline");
                  setSelectMode(true);
                }}
                style={{
                  flexShrink: 0,
                  background: "transparent",
                  color: C.text,
                  border: "1px solid " + C.border,
                  borderRadius: "999px",
                  padding: "10px 18px",
                  fontSize: "13.5px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Share
              </button>
            )}
            <button
              onClick={() => onSave(studyName.trim() || defaultName, format)}
              style={{
                flex: 1,
                background: C.text,
                color: C.bg,
                border: "none",
                borderRadius: "999px",
                padding: "10px 18px",
                fontSize: "13.5px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Save to Studies
            </button>
          </div>
        )}
        {readOnly && onTryIt && (
          <button
            onClick={onTryIt}
            style={{
              width: "100%",
              background: C.text,
              color: C.bg,
              border: "none",
              borderRadius: "999px",
              padding: "11px 18px",
              fontSize: "13.5px",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {tryItLabel || "Start marking"}
          </button>
        )}
      </div>
        )}
      {/* view + sort toggles — part of the chrome, so they slide away too */}
      {!selectMode && liveMarks.length !== 0 && (
          <div
            style={{
              padding: "12px 16px 4px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            {/* format selector + quick-find share one row */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {savedStudy ? (
                <button
                  onClick={() => setShowFormats((s) => !s)}
                  style={{
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    background: C.soft,
                    border: "none",
                    color: C.text,
                    fontFamily: "inherit",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: "pointer",
                    padding: "11px 14px",
                    borderRadius: "10px",
                  }}
                >
                  {format === "distilled"
                    ? "Distilled"
                    : format === "semantic"
                    ? "Semantic"
                    : "Outline"}
                  <span style={{ fontSize: "11px", opacity: 0.6 }}>
                    {showFormats ? "▲" : "▼"}
                  </span>
                </button>
              ) : (
                <div
                  style={{
                    display: "flex",
                    gap: "4px",
                    backgroundColor: C.soft,
                    borderRadius: "10px",
                    padding: "4px",
                  }}
                >
                  {seg(format === "outline", "Outline", () =>
                    setFormat("outline")
                  )}
                  {seg(format === "distilled", "Distilled", () =>
                    setFormat("distilled")
                  )}
                  {seg(format === "semantic", "Semantic", () =>
                    setFormat("semantic")
                  )}
                </div>
              )}
            {/* Quick-find — filters this study's marked verses live and jumps
                the board to a chosen verse's card. 16px input so iOS Safari
                doesn't zoom the page on focus. */}
              <div style={{ position: "relative", flex: 1, minWidth: "150px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  backgroundColor: C.soft,
                  border: "1px solid " + C.border,
                  borderRadius: "10px",
                  padding: "0 12px",
                }}
              >
                <span
                  aria-hidden
                  style={{ color: C.muted, fontSize: "16px", flexShrink: 0 }}
                >
                  ⌕
                </span>
                <input
                  value={findQ}
                  onChange={(e) => setFindQ(e.target.value)}
                  placeholder="Find a verse, word, or theme"
                  inputMode="search"
                  enterKeyHint="search"
                  autoCapitalize="none"
                  spellCheck={false}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    color: C.text,
                    fontFamily: "inherit",
                    fontSize: "16px",
                    padding: "11px 0",
                  }}
                />
                {findQ !== "" && (
                  <button
                    onClick={() => setFindQ("")}
                    aria-label="Clear find"
                    style={{
                      flexShrink: 0,
                      background: "transparent",
                      border: "none",
                      color: C.muted,
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
              {findQuery !== "" && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 6px)",
                    left: 0,
                    right: 0,
                    zIndex: 20,
                    backgroundColor: C.bg,
                    border: "1px solid " + C.border,
                    borderRadius: "12px",
                    boxShadow: "0 12px 34px rgba(0,0,0,.28)",
                    maxHeight: "46vh",
                    overflowY: "auto",
                    WebkitOverflowScrolling: "touch",
                  }}
                >
                  {findResults.length === 0 ? (
                    <div
                      style={{
                        padding: "14px 16px",
                        color: C.muted,
                        fontSize: "13.5px",
                      }}
                    >
                      No marked verses match “{findQ.trim()}”.
                    </div>
                  ) : (
                    findResults.map((r, i) => {
                      const snippet =
                        r.texts.join("  ·  ") || r.themes.join(", ");
                      return (
                        <button
                          key={r.reference}
                          onClick={() => {
                            scrollToVerse(r.reference);
                            setFindQ("");
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
                              i < findResults.length - 1
                                ? "1px solid " + C.border
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
                              backgroundColor:
                                COLOR_MAP[r.color as MarkColor],
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              flexShrink: 0,
                              fontWeight: 700,
                              fontSize: "12.5px",
                              color: C.text,
                            }}
                          >
                            {r.reference}
                          </span>
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              fontSize: "12.5px",
                              color: C.muted,
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
            {savedStudy && showFormats && (
              <div
                style={{
                  display: "flex",
                  gap: "4px",
                  backgroundColor: C.soft,
                  borderRadius: "10px",
                  padding: "4px",
                }}
              >
                {seg(format === "outline", "Outline", () =>
                  setFormat("outline")
                )}
                {seg(format === "distilled", "Distilled", () =>
                  setFormat("distilled")
                )}
                {seg(format === "semantic", "Semantic", () =>
                  setFormat("semantic")
                )}
              </div>
            )}
            {format === "outline" && (
              <button
                onClick={() => setOptionsOpen((o) => !o)}
                style={{
                  alignSelf: "flex-start",
                  background: "transparent",
                  border: "none",
                  color: C.muted,
                  fontFamily: "inherit",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: "2px",
                }}
              >
                {optionsOpen ? "Hide options ▲" : "View options ▼"}
              </button>
            )}
            {format === "outline" && optionsOpen && (
              <div
                style={{
                  display: "flex",
                  gap: "4px",
                  backgroundColor: C.soft,
                  borderRadius: "10px",
                  padding: "4px",
                }}
              >
                {seg(view === "focused", "Focused", () => setView("focused"))}
                {seg(view === "full", "Full verse", () => setView("full"))}
              </div>
            )}
            {format === "outline" && optionsOpen && (
              <div
                style={{
                  display: "flex",
                  gap: "4px",
                  backgroundColor: C.soft,
                  borderRadius: "10px",
                  padding: "4px",
                }}
              >
                {seg(sortMode === "order", "In order", () =>
                  setSortMode("order")
                )}
                {seg(sortMode === "points", "By points", () =>
                  setSortMode("points")
                )}
              </div>
            )}
          </div>
      )}
      </div>

      {/* verses — fill the whole screen; top-padded to clear the chrome so
          nothing reflows when the chrome slides away */}
      <div
        ref={scrollBoxRef}
        onScroll={(e) => onScroll((e.target as HTMLDivElement).scrollTop)}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          overscrollBehavior: "contain",
          paddingTop: scrollPadTop,
          paddingLeft: 16,
          paddingRight: 16,
          paddingBottom: selectMode
            ? "calc(112px + env(safe-area-inset-bottom))"
            : "calc(40px + env(safe-area-inset-bottom))",
        }}
      >
        {format === "distilled" && <Distilled {...sharedViewProps} />}
        {format === "semantic" && (
          <SemanticView
            compileTabs={sharedCompileTabs}
            marks={liveMarks}
            tags={tags}
            colorLabels={colorLabels}
            onJumpToReference={onJump}
            noteFor={(ref) => {
              for (const c of activeColors) {
                const v = readVerseNote(c, ref);
                if (v.trim()) return v;
              }
              return "";
            }}
            synthesisFor={() => readSynthRaw()}
            onSaveSynthesis={(t: string) => setNote(dSynthKey(), t)}
            panel={C.panel}
            border={C.border}
            text={C.text}
            muted={C.muted}
            noteFontSize={16}
          />
        )}
        {format === "outline" &&
          liveMarks.length === 0 &&
          (!tags || tags.length === 0) && (
            <div style={{ padding: "30px 24px", fontSize: "14px", color: C.muted, lineHeight: 1.6 }}>
              No marks in this book yet. Arm a pen and tap a word to begin — your
              themes will gather here.
            </div>
          )}
        {/* The study's synthesis leads — same box, same key, same position as
            the desktop Outline. Mobile had no study-level synthesis at all;
            the per-theme boxes below are each a thought about their own theme. */}
        {format === "outline" && liveMarks.length > 0 && (
          <div
            style={{
              // Same box as a theme card below it: the container supplies the
              // horizontal padding, so adding our own inset it by 14px a side
              // and it read as a different width from everything under it.
              marginBottom: "14px",
              border: "1px solid " + C.border,
              borderRadius: "14px",
              backgroundColor: C.panel,
              padding: "14px",
            }}
          >
            <div
              style={{
                fontSize: "11.5px",
                fontWeight: 700,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: C.muted,
                marginBottom: "8px",
              }}
            >
              Synthesis
            </div>
            {/* One resolver for display and for every share. The box used to
                read notes[dSynthKey()] directly while everything else read
                readSynthRaw(), so the box could show one thing and a share
                carry another. */}
            <RichNoteField
              value={readSynthRaw()}
              onChange={(t) => setNote(dSynthKey(), t)}
              {...noteWiring}
              accent={C.text}
              placeholder="State the main idea these verses support…"
              addLabel="Add your synthesis"
              editorFontSize={16}
            />
          </div>
        )}

            {format === "outline" &&
              groups.map((g) => {
              const c = g.color;
              const list = g.marks;
              const name = g.name;
              const isOpen = expanded.includes(g.key);
              const pts = pointsFor(list);
              const newCount = list.filter(isNew).length;
              const verseCount = new Set(list.map((m) => m.reference)).size;
              return (
                <div
                  key={g.key}
                  style={{
                    marginBottom: "14px",
                    border: "1px solid " + C.border,
                    borderRadius: "14px",
                    backgroundColor: C.panel,
                    overflow: "hidden",
                  }}
                >
                  {/* header row: tap to expand; active theme names edit inline */}
                  <div
                    onClick={() => toggle(g.key)}
                    role="button"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      width: "100%",
                      padding: "14px 14px 10px",
                      cursor: "pointer",
                      color: C.text,
                      fontFamily: "inherit",
                    }}
                  >
                    <span
                      style={{
                        width: "15px",
                        height: "15px",
                        borderRadius: "50%",
                        backgroundColor: COLOR_MAP[c as MarkColor],
                        flexShrink: 0,
                      }}
                    />
                    {onRenameTheme && g.key.indexOf("c:") === 0 ? (
                      <>
                      <input
                        value={
                          editingTheme === c
                            ? themeDraft
                            : (colorLabels[c] || "").trim()
                        }
                        onChange={(e) => setThemeDraft(e.target.value)}
                        onFocus={() => {
                          setEditingTheme(c);
                          setThemeDraft((colorLabels[c] || "").trim());
                        }}
                        onBlur={() => {
                          if (editingTheme === c) {
                            const v = themeDraft.trim();
                            if (v !== (colorLabels[c] || "").trim())
                              onRenameTheme(c, v);
                            setEditingTheme(null);
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter")
                            (e.target as HTMLInputElement).blur();
                        }}
                        placeholder="Name this theme…"
                        aria-label="Theme name"
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: "16px",
                          fontWeight: 700,
                          background: "transparent",
                          border: "none",
                          borderBottom: "1px dashed " + C.border,
                          color: C.text,
                          fontFamily: "inherit",
                          padding: "1px 0 2px",
                          outline: "none",
                        }}
                      />
                    {!(colorLabels[c] || "").trim() && (
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ color: C.muted, flexShrink: 0, marginLeft: "-6px" }}
                        aria-hidden="true"
                      >
                        <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
                      </svg>
                    )}
                      </>
                    ) : (
                      <span
                        style={{ fontSize: "15px", fontWeight: 700, flex: 1 }}
                      >
                        {name}
                      </span>
                    )}
                    {newCount > 0 && (
                      <span
                        style={{
                          fontSize: "10.5px",
                          fontWeight: 700,
                          color: COLOR_MAP[c as MarkColor],
                          flexShrink: 0,
                        }}
                      >
                        {newCount} new
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: "11.5px",
                        color: C.muted,
                        flexShrink: 0,
                      }}
                    >
                      {list.length} {list.length === 1 ? "mark" : "marks"}
                      {sortMode === "points" ? " · " + pts + " pts" : ""}
                    </span>
                    <span
                      style={{
                        fontSize: "12px",
                        color: C.muted,
                        transform: isOpen ? "rotate(90deg)" : "none",
                        transition: "transform 0.15s",
                        flexShrink: 0,
                      }}
                    >
                      ›
                    </span>
                  </div>

                  {/* collapsed face: the theme's lead verse (user-pinned) or,
                      failing that, the user's own heaviest-marked fragments —
                      so a closed card still says something, in their words */}
                  {!isOpen &&
                    (() => {
                      const pinned = pinsFor(c).filter((r) =>
                        list.some((m) => m.reference === r)
                      );
                      const lead = pinned[0];
                      if (lead) {
                        const vt = (
                          list.find((m) => m.reference === lead)?.verseText ||
                          ""
                        ).trim();
                        if (!vt) return null;
                        return (
                          <div style={{ padding: "0 14px 12px" }}>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                marginBottom: "4px",
                              }}
                            >
                              <svg
                                width="10"
                                height="10"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                stroke="currentColor"
                                strokeWidth="2"
                                style={{
                                  color: COLOR_MAP[c as MarkColor],
                                  flexShrink: 0,
                                }}
                              >
                                <path d="M12 17v5 M9 3h6l-1 7 3 2v2H7v-2l3-2z" />
                              </svg>
                              <span
                                style={{
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  color: C.muted,
                                }}
                              >
                                {lead}
                              </span>
                            </div>
                            <div
                              style={{
                                fontFamily: "Georgia, serif",
                                fontSize: "14px",
                                lineHeight: 1.55,
                                color: C.text,
                                display: "-webkit-box",
                                WebkitLineClamp: 3,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                              }}
                            >
                              {vt}
                            </div>
                          </div>
                        );
                      }
                      // No pin: surface the user's own marked fragments from
                      // the heaviest-marked verse — their emphasis, verbatim.
                      const top = verseEntriesFor(list, c)[0];
                      if (!top) return null;
                      const frags = top.marks
                        .map((m) => (m.markedText || "").trim())
                        .filter(Boolean)
                        .slice(0, 3);
                      if (!frags.length) return null;
                      return (
                        <div style={{ padding: "0 14px 12px" }}>
                          <div
                            style={{
                              fontSize: "11px",
                              fontWeight: 700,
                              color: C.muted,
                              marginBottom: "4px",
                            }}
                          >
                            {top.reference}
                          </div>
                          <div
                            style={{
                              fontFamily: "Georgia, serif",
                              fontSize: "13.5px",
                              fontStyle: "italic",
                              lineHeight: 1.5,
                              color: C.text,
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {frags.join(" · ")}
                          </div>
                        </div>
                      );
                    })()}
                  {/* synthesis-first: the conclusion sits up top. One rich
                      editor everywhere notes are taken (SCR-9) — same
                      component as the desktop Outline synthesis box, sized
                      ≥16px for iOS. */}
                  <div style={{ padding: "0 14px 14px" }}>
                    {(() => {
                      // Per-THEME, not the study synthesis: this box used to
                      // write dSynthKey(), so every theme edited the same field
                      // and showed the same text. synthKey(color) is the key the
                      // share path already reads per-theme syntheses from.
                      const sk = synthKey(c);
                      const sVal = notes[sk] || "";
                      const accent = COLOR_MAP[c as MarkColor];
                      return (
                        <RichNoteField
                          value={sVal}
                          onChange={(t) => setNote(sk, t)}
                          {...noteWiring}
                          accent={accent}
                          placeholder={"What does " + name + " say across these verses?"}
                          addLabel={"Add a thought about " + name}
                          editorFontSize={16}
                        />
                      );
                    })()}

                    {!isOpen && (
                      <button
                        onClick={() => toggle(g.key)}
                        style={{
                          marginTop: "10px",
                          background: "transparent",
                          border: "none",
                          color: C.muted,
                          fontSize: "12.5px",
                          fontWeight: 600,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          padding: 0,
                        }}
                      >
                        Show {verseCount} {verseCount === 1 ? "verse" : "verses"} ▾
                      </button>
                    )}

                    {isOpen && (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px",
                          marginTop: "12px",
                        }}
                      >
                        {verseEntriesFor(list, c).map((ve) => {
                          const info = VI.get(ve.reference);
                          const noteKey = dVerseKey(c, ve.reference);
                          const noteVal = readVerseNote(c, ve.reference);
                          const hasNote = noteVal.trim().length > 0;
                          const isFlipped = flippedRef === ve.reference;
                          const on = picked.includes(
                            g.key + "|c" + g.color + "|" + ve.reference
                          );
                          const fullStyle: CSSProperties = {
                            fontFamily: '"Times New Roman", Times, serif',
                            fontSize: "16px",
                            lineHeight: 1.8,
                            color: C.text,
                          };
                          // MarkedVerse colors its verse number with var(--muted);
                          // feed it the live palette so it matches light/dark.
                          (fullStyle as any)["--muted"] = C.muted;
                          const faceBase: CSSProperties = {
                            background: C.soft,
                            border: "1px solid " + C.border,
                            borderRadius: "10px",
                            padding: "10px 12px",
                            backfaceVisibility: "hidden",
                            WebkitBackfaceVisibility: "hidden",
                          };
                          return (
                            <div
                              key={ve.reference}
                              data-vref={ve.reference}
                              style={{ perspective: "1200px" }}
                            >
                              <div
                                style={{
                                  position: "relative",
                                  transformStyle: "preserve-3d",
                                  WebkitTransformStyle: "preserve-3d",
                                  transition: "transform 0.45s",
                                  transform: isFlipped
                                    ? "rotateY(180deg)"
                                    : "rotateY(0deg)",
                                  WebkitTransform: isFlipped
                                    ? "rotateY(180deg)"
                                    : "rotateY(0deg)",
                                  minHeight: isFlipped ? "168px" : undefined,
                                }}
                              >
                                {/* FRONT — tap to flip to the note, or (in
                                    select mode) tap to pick this verse to share */}
                                <div
                                  onClick={() => {
                                    if (selectMode) {
                                      togglePick(
                                        g.key + "|c" + g.color + "|" + ve.reference
                                      );
                                      return;
                                    }
                                    setFlippedRef(ve.reference);
                                    setEditNote(null);
                                  }}
                                  style={{
                                    ...faceBase,
                                    borderLeft: ve.isNew
                                      ? "3px solid " + COLOR_MAP[c as MarkColor]
                                      : "1px solid " + C.border,
                                    ...(selectMode && on
                                      ? {
                                          border:
                                            "2px solid " +
                                            COLOR_MAP[c as MarkColor],
                                        }
                                      : {}),
                                    cursor: "pointer",
                                  }}
                                >
                                  {selectMode && (
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "9px",
                                        marginBottom: "9px",
                                      }}
                                    >
                                      <span
                                        style={{
                                          width: "20px",
                                          height: "20px",
                                          borderRadius: "6px",
                                          flexShrink: 0,
                                          border:
                                            "2px solid " +
                                            (on
                                              ? COLOR_MAP[c as MarkColor]
                                              : C.muted),
                                          background: on
                                            ? COLOR_MAP[c as MarkColor]
                                            : "transparent",
                                          color: "#fff",
                                          display: "inline-flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          fontSize: "13px",
                                          fontWeight: 700,
                                        }}
                                      >
                                        {on ? "\u2713" : ""}
                                      </span>
                                      <span
                                        style={{
                                          fontSize: "11px",
                                          color: C.muted,
                                        }}
                                      >
                                        {on ? "Selected" : "Tap to select"}
                                      </span>
                                    </div>
                                  )}                                  {/* verse header: reference + points + note flag */}
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "baseline",
                                      gap: "8px",
                                      marginBottom: "6px",
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onJump(ve.reference);
                                      }}
                                      style={{
                                        background: "transparent",
                                        border: "none",
                                        padding: 0,
                                        cursor: "pointer",
                                        color: C.text,
                                        fontFamily: "inherit",
                                        fontSize: "12.5px",
                                        fontWeight: 700,
                                        textDecoration: "underline",
                                        textDecorationStyle: "dotted",
                                      }}
                                    >
                                      {ve.reference} ↗
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        togglePin(c, ve.reference);
                                      }}
                                      aria-label={
                                        pinsFor(c).includes(ve.reference)
                                          ? "Unpin from top"
                                          : "Pin to top of theme"
                                      }
                                      title={
                                        pinsFor(c).includes(ve.reference)
                                          ? "Unpin — return to the sorted list"
                                          : "Pin to top — this verse leads the theme"
                                      }
                                      style={{
                                        // A real thumb target, pushed to the
                                        // far end of the row so it can never
                                        // be confused with the jump link.
                                        marginLeft: "auto",
                                        width: "40px",
                                        height: "40px",
                                        margin: "-10px -8px -10px auto",
                                        display: "grid",
                                        placeItems: "center",
                                        background: "transparent",
                                        border: "none",
                                        cursor: "pointer",
                                        color: pinsFor(c).includes(ve.reference)
                                          ? COLOR_MAP[c as MarkColor]
                                          : C.muted,
                                        lineHeight: 0,
                                        flexShrink: 0,
                                      }}
                                    >
                                      <svg
                                        width="18"
                                        height="18"
                                        viewBox="0 0 24 24"
                                        fill={
                                          pinsFor(c).includes(ve.reference)
                                            ? "currentColor"
                                            : "none"
                                        }
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      >
                                        <path d="M12 17v5 M9 3h6l-1 7 3 2v2H7v-2l3-2z" />
                                      </svg>
                                    </button>
                                    <span
                                      style={{
                                        fontSize: "10.5px",
                                        fontWeight: 700,
                                        color: COLOR_MAP[c as MarkColor],
                                        background: C.bg,
                                        borderRadius: "999px",
                                        padding: "1px 8px",
                                      }}
                                    >
                                      +{ve.pts}
                                    </span>
                                    {ve.isNew && (
                                      <span
                                        style={{
                                          fontSize: "10.5px",
                                          color: C.muted,
                                        }}
                                      >
                                        just marked
                                      </span>
                                    )}
                                    {hasNote && (
                                      <span
                                        title="Has a note"
                                        style={{
                                          marginLeft: "auto",
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: "4px",
                                          fontSize: "10.5px",
                                          fontWeight: 700,
                                          color: COLOR_MAP[c as MarkColor],
                                        }}
                                      >
                                        <svg
                                          width="11"
                                          height="11"
                                          viewBox="0 0 16 16"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="1.6"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          aria-hidden="true"
                                        >
                                          <rect
                                            x="2.5"
                                            y="2.5"
                                            width="11"
                                            height="11"
                                            rx="2.5"
                                          />
                                          <path d="M5.5 6.5h5M5.5 9.5h3" />
                                        </svg>
                                        note
                                      </span>
                                    )}
                                  </div>

                                  {view === "full" && info ? (
                                    <div style={fullStyle}>
                                      <MarkedVerse
                                        reference={ve.reference}
                                        verseNumber={info.verse}
                                        text={info.text}
                                        marks={ve.marks}
                                        tags={tags}
                                      />
                                    </div>
                                  ) : (
                                    <div
                                      style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "4px",
                                      }}
                                    >
                                      {ve.marks.map((m) => (
                                        <div
                                          key={m.id}
                                          style={{
                                            fontFamily:
                                              '"Times New Roman", Times, serif',
                                            fontSize: "15px",
                                            lineHeight: 1.7,
                                          }}
                                        >
                                          “
                                          <span
                                            style={markStyleCSS(m.style, m.color)}
                                          >
                                            {m.markedText}
                                          </span>
                                          ”
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {/* Focused renders the marked phrases itself
                                      rather than MarkedVerse, so the chosen
                                      definitions are drawn here too — otherwise
                                      picking them does nothing in the view the
                                      outline opens in. */}
                                  {view !== "full" &&
                                    (() => {
                                      const g = glossesFor(
                                        (tags || []).filter(
                                          (t) => t.reference === ve.reference
                                        )
                                      );
                                      if (g.length === 0) return null;
                                      return (
                                        <div
                                          style={{
                                            marginTop: "8px",
                                            paddingTop: "6px",
                                            borderTop: "1px solid " + C.border,
                                            fontSize: "12.5px",
                                            lineHeight: 1.5,
                                            color: C.muted,
                                          }}
                                        >
                                          {g.map((d, gi) => (
                                            <div key={d.word + d.n + gi}>
                                              <strong style={{ color: C.text }}>
                                                {d.word}
                                              </strong>{" "}
                                              {d.n > 0 && (
                                                <span
                                                  style={{
                                                    color: "#9a7b4f",
                                                    fontWeight: 700,
                                                  }}
                                                >
                                                  {d.n}.
                                                </span>
                                              )}{" "}
                                              {d.text}
                                            </div>
                                          ))}
                                        </div>
                                      );
                                    })()}
                                  {!selectMode && (
                                    <div
                                      style={{
                                        marginTop: "8px",
                                        fontSize: "10.5px",
                                        color: C.muted,
                                      }}
                                    >
                                      {hasNote
                                        ? "Tap to view note"
                                        : "Tap to add a note"}
                                    </div>
                                  )}
                                </div>

                                {/* BACK — the note editor */}
                                <div
                                  style={{
                                    ...faceBase,
                                    position: "absolute",
                                    inset: 0,
                                    transform: "rotateY(180deg)",
                                    WebkitTransform: "rotateY(180deg)",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "8px",
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: "10.5px",
                                      fontWeight: 700,
                                      letterSpacing: "0.05em",
                                      textTransform: "uppercase",
                                      color: C.muted,
                                    }}
                                  >
                                    Note · {ve.reference}
                                  </div>
                                  {(() => {
                                    // The editor round-trips the RAW stored
                                    // note (rich HTML preserved) — flattening
                                    // is only for the front-face preview.
                                    // Same rich editor as desktop (SCR-9).
                                    const noteRaw =
                                      (notes[noteKey] && notes[noteKey].trim()
                                        ? notes[noteKey]
                                        : "") ||
                                      notes[verseNoteKey(ve.reference)] ||
                                      "";
                                    return (
                                      <>
                                        <div
                                          style={{
                                            flex: 1,
                                            minHeight: 0,
                                            overflowY: "auto",
                                          }}
                                        >
                                          <RichNoteField
                                            {...noteWiring}
                                            value={noteRaw}
                                            onChange={(t) => {
                                              setNote(noteKey, t);
                                              // A cleared note also clears
                                              // its legacy mobile twin.
                                              if (!t)
                                                setNote(
                                                  verseNoteKey(ve.reference),
                                                  ""
                                                );
                                            }}
                                            accent={COLOR_MAP[c as MarkColor]}
                                            placeholder="Write a note for this verse…"
                                            addLabel={
                                              "Add a note for " + ve.reference
                                            }
                                            editorFontSize={16}
                                          />
                                        </div>
                                        <button
                                          onClick={() => setFlippedRef(null)}
                                          style={{
                                            background: "transparent",
                                            border: "none",
                                            color: C.muted,
                                            fontSize: "12.5px",
                                            fontWeight: 600,
                                            cursor: "pointer",
                                            fontFamily: "inherit",
                                            padding: "4px",
                                          }}
                                        >
                                          Back
                                        </button>
                                      </>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {/* Word Studies lives with the Outline only, not under every
                format (SCR-13). */}
            {format === "outline" && tags && tags.length > 0 && (
              <div style={{ marginTop: "18px" }}>
                <WordStudies
                  tags={tags}
                  colors={{
                    text: C.text,
                    muted: C.muted,
                    border: C.border,
                    soft: C.soft,
                  }}
                />
              </div>
            )}
      </div>
      {compPreview && (
        <SharePreview
          C={C}
          appDark={dark}
          kind="compilation"
          comp={compPreview}
          onClose={() => setCompPreview(null)}
          onFlash={onFlash}
        />
      )}

      {selectMode && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 6,
            backgroundColor: C.bg,
            borderTop: "1px solid " + C.border,
            padding: "12px 14px calc(12px + env(safe-area-inset-bottom))",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <button
            onClick={startShareVerses}
            disabled={picked.length === 0}
            style={{
              flex: 1,
              background: picked.length ? C.text : C.soft,
              color: picked.length ? C.bg : C.muted,
              border: "none",
              borderRadius: "999px",
              padding: "13px",
              fontSize: "14px",
              fontWeight: 700,
              cursor: picked.length ? "pointer" : "default",
              fontFamily: "inherit",
            }}
          >
            {picked.length ? "Share " + picked.length : "Share"}
          </button>
          <button
            onClick={startShareStudy}
            style={{
              background: "transparent",
              color: C.text,
              border: "1px solid " + C.border,
              borderRadius: "999px",
              padding: "13px 12px",
              fontSize: "12.5px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            Whole study
          </button>
          <button
            onClick={() => {
              setSelectMode(false);
              shareStudy();
            }}
            style={{
              background: "transparent",
              color: C.muted,
              border: "1px solid " + C.border,
              borderRadius: "999px",
              padding: "13px 12px",
              fontSize: "12.5px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            Summary
          </button>
        </div>
      )}

      {versesPreview && (
        <SharePreview
          C={C}
          appDark={dark}
          kind="verses"
          verses={versesPreview}
          syntheses={versesSyntheses}
          title={title}
          onClose={() => setVersesPreview(null)}
          onFlash={onFlash}
        />
      )}

      {studyPreview && (
        <SharePreview
          C={C}
          appDark={dark}
          kind="study"
          verses={studyPreview.verses}
          comp={studyPreview.comp}
          syntheses={studyPreview.syntheses}
          title={title}
          onClose={() => setStudyPreview(null)}
          onFlash={onFlash}
        />
      )}
    </div>
  );
}
