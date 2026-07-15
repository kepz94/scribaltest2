import { useState, useRef, useEffect } from "react";
import { getScriptures, volumesProxy, registerOnLoaded } from "../data/scripturesStore";
import MarkedVerse from "./MarkedVerse";
import StyleGlyph from "./StyleGlyph";
import { Mark, MarkStyle, MarkColor, Tool, WordTag, COLORS, COLOR_MAP } from "../types";
import { isSermonsVolume, sermonLabel } from "../sermons";

// Tools that actually paint with the selected color. Everything else — eraser,
// pointer, define — ignores color, so picking a color while one of them is
// active signals that the reader wants to mark again.
const PEN_TOOLS: Tool[] = [
  "highlight",
  "underline",
  "bold",
  "italic",
  "circle",
  "box",
  "dashed",
  "squiggly",
];

interface VerseViewerProps {
  // Assignable toolbar hotkeys (tool → key). Falls back to the classic layout
  // baked into each toolButton call when absent.
  toolHotkeys?: Partial<Record<Tool, string>>;
  selectedVolume: number;
  selectedBook: number;
  selectedChapter: number;
  onChange: (volume: number, book: number, chapter: number) => void;
  selectedTool: Tool;
  selectedColor: MarkColor;
  onChangeTool: (t: Tool) => void;
  onChangeColor: (c: MarkColor) => void;
  onMark: (
    reference: string,
    verseText: string,
    markedText: string,
    startIndex: number,
    endIndex: number,
    style: MarkStyle,
    color: MarkColor
  ) => void;
  onEraseMark: (markId: string) => void;
  // Define mode: a single word was selected for lookup — the parent shows the
  // definition. Never marks.
  onDefine?: (
    reference: string,
    verseText: string,
    start: number,
    end: number,
    word: string
  ) => void;
  tags?: WordTag[];
  onTagTap?: (tag: WordTag) => void;
  onMarkMany: (
    items: {
      reference: string;
      verseText: string;
      markedText: string;
      startIndex: number;
      endIndex: number;
      style: MarkStyle;
      color: MarkColor;
    }[]
  ) => void;
  marks: Mark[];
  showToolbar?: boolean;
  toolbarPos: { x: number; y: number };
  onToolbarPos: (
    v:
      | { x: number; y: number }
      | ((p: { x: number; y: number }) => { x: number; y: number })
  ) => void;
  toolbarOrient: Orientation;
  onToolbarOrient: (v: Orientation | ((p: Orientation) => Orientation)) => void;
  panelMode?: boolean;
  fontScale?: number;
  lineScale?: number;
  warm?: boolean;
  dark?: boolean;
  sidebarOpen?: boolean;
  studyRefs?: string[];
  studyTitle?: string;
  // Optional two-section split for studyRefs (used by the "mark added verses"
  // screen): show the first `splitAfter` refs under splitLabels.first and the
  // rest under splitLabels.second. Omitted by every other caller, which keeps
  // the plain chapter-grouped rendering.
  splitAfter?: number;
  splitLabels?: { first: string; second: string };
  // When the screen already shows the study's name in its own header (the
  // "mark added verses" screen), suppress VerseViewer's built-in study caption.
  hideStudyHeader?: boolean;
  jumpTarget: string | null;
  onJumpHandled: () => void;
  // Optional: enable "Send verses" mode (toolbar button + verse checkboxes).
  // Emits the chosen verse references; the parent runs the send/create-study UI.
  onSendVerses?: (refs: string[]) => void;
  // Optional: enable "Remove verses" mode on a study panel (toolbar button +
  // verse checkboxes). Emits the references to drop; the parent updates the
  // study's verse list. The verses' marks stay in the book.
  onRemoveVerses?: (refs: string[]) => void;
  // Optional: "Link scriptures" control shown in the panel header, next to Send
  // verses. Carries the chapter-link button's exact behavior up from the tab —
  // the parent supplies the same click handler, linked flag, group color, and
  // tooltip it previously computed for the tab icon.
  linkScriptures?: {
    onClick: () => void;
    linked: boolean;
    color: string;
    title: string;
  };
  // Optional: per-panel Compile (SCR-48) — each chapter reading panel compiles
  // itself (its chapter, or its linked group). The parent gates this to
  // chapter-book panels; topic-book panels never get it.
  onCompilePanel?: () => void;
  // How far from the top of the scroll area the function-button row (Link
  // scriptures / Send verses) pins while reading. Defaults to
  // 0, which is right when the row's own scroll container starts at the panel
  // top; the main single-pane reading view passes the fixed header + legend
  // height so the pinned row clears them.
  controlsStickyTop?: number;
}

type Orientation = "vertical" | "horizontal";

type AppliedRange = {
  reference: string;
  verseText: string;
  markedText: string;
  startIndex: number;
  endIndex: number;
};

const vols = volumesProxy;

// Every verse reference -> number, text, and chapter title. Study tabs render
// hand-picked verses that span many chapters, so they look these up here.
const verseByRef = new Map<
  string,
  { verse: number; text: string; chapterTitle: string }
>();
// Filled after the runtime scripture load lands (see scripturesStore).
registerOnLoaded(() =>
  vols.forEach((v) =>
    v.books.forEach((b) =>
      b.chapters.forEach((c) => {
        const ct = b.book + " " + c.chapter;
        c.verses.forEach((ve) =>
          verseByRef.set(ve.reference, {
            verse: ve.verse,
            text: ve.text,
            chapterTitle: ct,
          })
        );
      })
    )
  )
);

export default function VerseViewer(props: VerseViewerProps) {
  const {
    selectedVolume,
    selectedBook,
    selectedChapter,
    onChange,
    toolHotkeys,
    selectedTool,
    selectedColor,
    onChangeTool,
    onChangeColor,
    onEraseMark,
    onDefine,
    tags,
    onTagTap,
    onMarkMany,
    marks,
    showToolbar = true,
    panelMode = false,
    fontScale = 1,
    lineScale = 1.85,
    warm = false,
    dark = false,
    sidebarOpen = false,
    studyRefs,
    studyTitle,
    splitAfter,
    splitLabels,
    hideStudyHeader,
    jumpTarget,
    onJumpHandled,
    onSendVerses,
    onRemoveVerses,
    linkScriptures,
    onCompilePanel,
    toolbarPos: pos,
    onToolbarPos: setPos,
    toolbarOrient: orientation,
    onToolbarOrient: setOrientation,
    controlsStickyTop = 0,
  } = props;

  const currentVolume = vols[selectedVolume];
  const currentBook = currentVolume.books[selectedBook];
  const currentChapter = currentBook.chapters[selectedChapter];
  const erasing = selectedTool === "eraser";

  // Remember the most recent pen tool. When the reader picks a color while a
  // non-pen tool is active, we step back onto this one so marking just works.
  const lastPenTool = useRef<MarkStyle>("highlight");
  useEffect(() => {
    if (PEN_TOOLS.includes(selectedTool)) {
      lastPenTool.current = selectedTool as MarkStyle;
    }
  }, [selectedTool]);

  // Identity of the open chapter/study — per-tab UI state (like the remove
  // selection) resets when this changes.
  const tabKey = studyRefs
    ? "study:" + (studyTitle || studyRefs.join(","))
    : selectedVolume + ":" + selectedBook + ":" + selectedChapter;

  // "Send verses": check off verses on this tab to send to a study (new or
  // existing). The selection lives here; the parent runs the send UI.
  const [sendMode, setSendMode] = useState(false);
  const [sendSel, setSendSel] = useState<string[]>([]);
  const toggleSend = (ref: string) =>
    setSendSel((p) =>
      p.includes(ref) ? p.filter((r) => r !== ref) : [...p, ref]
    );
  // Navigating to another chapter drops any in-progress selection.
  useEffect(() => {
    setSendMode(false);
    setSendSel([]);
  }, [selectedVolume, selectedBook, selectedChapter]);

  // "Remove verses": on a study panel, check off verses to drop from the study.
  // The selection lives here; the parent removes them (marks stay in the book).
  const [removeMode, setRemoveMode] = useState(false);
  const [removeSel, setRemoveSel] = useState<string[]>([]);
  const toggleRemove = (ref: string) =>
    setRemoveSel((p) =>
      p.includes(ref) ? p.filter((r) => r !== ref) : [...p, ref]
    );
  useEffect(() => {
    setRemoveMode(false);
    setRemoveSel([]);
  }, [tabKey]);

  // Warm reading palette (matches the phone): paper-toned bg + ink text.
  const readBg = warm ? (dark ? "#1a1410" : "#f4ecd6") : "var(--panel)";
  const readText = warm ? (dark ? "#e9ddc2" : "#53442c") : "var(--text)";

  // Step to the previous/next chapter, crossing book and volume edges.
  const lastVol = vols.length - 1;
  const lastBook = vols[lastVol].books.length - 1;
  const lastChap = vols[lastVol].books[lastBook].chapters.length - 1;
  const atStart =
    selectedVolume === 0 && selectedBook === 0 && selectedChapter === 0;
  const atEnd =
    selectedVolume === lastVol &&
    selectedBook === lastBook &&
    selectedChapter === lastChap;
  const stepChapter = (dir: number) => {
    let v = selectedVolume;
    let b = selectedBook;
    let c = selectedChapter + dir;
    if (c < 0) {
      b -= 1;
      if (b < 0) {
        v -= 1;
        if (v < 0) return;
        b = vols[v].books.length - 1;
      }
      c = vols[v].books[b].chapters.length - 1;
    } else if (c >= vols[v].books[b].chapters.length) {
      b += 1;
      c = 0;
      if (b >= vols[v].books.length) {
        v += 1;
        if (v >= vols.length) return;
        b = 0;
      }
    }
    onChange(v, b, c);
  };
  // Pin the floating arrows to the ACTUAL text panel edges (measured), not to a
  // guessed column width. getBoundingClientRect is viewport-relative, which is
  // exactly what position:fixed needs. Re-measure on resize and layout shifts.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [panelBox, setPanelBox] = useState<{ left: number; right: number } | null>(
    null
  );
  useEffect(() => {
    const measure = () => {
      const el = bodyRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPanelBox({ left: r.left, right: r.right });
    };
    measure();
    const t = setTimeout(measure, 150); // after fonts/layout settle
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
    };
  }, [panelMode, sidebarOpen, selectedVolume, selectedBook, selectedChapter]);

  const ARROW_W = 42;
  const ARROW_GAP = 12; // equal gap on both sides, just outside the panel border
  const leftArrowPos = panelBox
    ? "max(8px, " + (panelBox.left - ARROW_GAP - ARROW_W) + "px)"
    : "";
  const rightArrowPos = panelBox
    ? "min(calc(100% - " +
      (ARROW_W + 8) +
      "px), " +
      (panelBox.right + ARROW_GAP) +
      "px)"
    : "";
  const sideArrowStyle: React.CSSProperties = {
    position: "fixed",
    top: "50%",
    transform: "translateY(-50%)",
    width: ARROW_W + "px",
    height: "42px",
    borderRadius: "50%",
    border: "1px solid var(--border)",
    backgroundColor: "var(--panel)",
    color: "var(--muted)",
    fontSize: "24px",
    lineHeight: 1,
    cursor: "pointer",
    zIndex: 30,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 4px 16px rgba(0,0,0,0.14)",
    fontFamily: "inherit",
  };

  // Compact inline twin of the side arrows, shown inside each panel's pinned
  // header when reading in multiple panels (where the wide page margins that
  // hold the floating side arrows don't exist).
  const headerArrowStyle: React.CSSProperties = {
    width: "30px",
    height: "30px",
    flexShrink: 0,
    borderRadius: "50%",
    border: "1px solid var(--border)",
    backgroundColor: "var(--panel)",
    color: "var(--muted)",
    fontSize: "20px",
    lineHeight: 1,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "inherit",
    padding: 0,
  };

  const chapterWord =
    currentVolume.volume === "Doctrine and Covenants" ? "Section" : "Chapter";

  // The Joseph Smith sermons volume labels each "chapter" by the date it was
  // given instead of a meaningless sequence number; every other volume keeps the
  // usual "Chapter N" / "Section N".
  const sermonsVol = isSermonsVolume(currentVolume.volume);
  const chapterLabel = (ch: { chapter: number; title?: string }) =>
    sermonsVol ? sermonLabel(ch.title, ch.chapter) : chapterWord + " " + ch.chapter;

  // Hide the book dropdown for single-book volumes (e.g. D&C)
  const showBook = currentVolume.books.length > 1;

  const [volMenuOpen, setVolMenuOpen] = useState(false);
  const [bookMenuOpen, setBookMenuOpen] = useState(false);
  const [chapMenuOpen, setChapMenuOpen] = useState(false);
  const [flashRef, setFlashRef] = useState<string | null>(null);

  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  // The toolbar stays exactly where you drop it (no edge-snapping), so it can
  // sit right next to the text. These clamps only keep it fully on-screen.
  const TB_GAP = 12; // min gap from the viewport edge
  const clampX = (x: number, w: number) =>
    Math.max(TB_GAP, Math.min(x, window.innerWidth - w - TB_GAP));
  const clampY = (y: number, h: number) =>
    Math.max(56, Math.min(y, window.innerHeight - h - TB_GAP));

  // Walk every verse the selection touches and return the covered character
  // range within each — so a selection that crosses verses marks all of them.
  const computeRanges = (range: Range): AppliedRange[] => {
    const body = bodyRef.current;
    const out: AppliedRange[] = [];
    if (!body) return out;
    const els = Array.from(body.querySelectorAll("[data-verse-ref]"));
    els.forEach((el) => {
      if (typeof range.intersectsNode !== "function" || !range.intersectsNode(el))
        return;
      const reference = el.getAttribute("data-verse-ref");
      if (!reference) return;
      const verse = studyRefs
        ? verseByRef.get(reference)
        : currentChapter?.verses.find((v) => v.reference === reference);
      if (!verse) return;
      const textSpan = el.querySelector("[data-verse-text]");
      if (!textSpan) return;
      // Real-intersection guard: intersectsNode counts a mere boundary touch.
      // A triple-click selection ends exactly AT the start of the next verse
      // block — zero characters selected there — and the full-length endIndex
      // default below used to mark that ENTIRE next verse (SCR-14).
      try {
        const spanRange = document.createRange();
        spanRange.selectNodeContents(textSpan);
        if (
          spanRange.compareBoundaryPoints(Range.END_TO_START, range) >= 0 ||
          spanRange.compareBoundaryPoints(Range.START_TO_END, range) <= 0
        )
          return;
      } catch {
        /* boundary comparison unavailable — keep the old permissive path */
      }
      let startIndex = 0;
      let endIndex = verse.text.length;
      if (textSpan.contains(range.startContainer)) {
        const r = document.createRange();
        r.selectNodeContents(textSpan);
        try {
          r.setEnd(range.startContainer, range.startOffset);
        } catch {
          return;
        }
        startIndex = r.toString().length;
      }
      if (textSpan.contains(range.endContainer)) {
        const r = document.createRange();
        r.selectNodeContents(textSpan);
        try {
          r.setEnd(range.endContainer, range.endOffset);
        } catch {
          return;
        }
        endIndex = r.toString().length;
      }
      startIndex = Math.max(0, Math.min(startIndex, verse.text.length));
      endIndex = Math.max(0, Math.min(endIndex, verse.text.length));
      if (endIndex > startIndex) {
        out.push({
          reference,
          verseText: verse.text,
          markedText: verse.text.slice(startIndex, endIndex),
          startIndex,
          endIndex,
        });
      }
    });
    return out;
  };

  useEffect(() => {
    if (!jumpTarget) return;
    const target = jumpTarget;
    const tryScroll = () => {
      const el = document.querySelector(
        '[data-verse-ref="' + target.replace(/"/g, '\\"') + '"]'
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setFlashRef(target);
        setTimeout(() => setFlashRef(null), 1600);
      }
      onJumpHandled();
    };
    const id = setTimeout(tryScroll, 120);
    return () => clearTimeout(id);
  }, [jumpTarget, onJumpHandled]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const el = toolbarRef.current;
      const w = el ? el.offsetWidth : 56;
      const h = el ? el.offsetHeight : 56;
      // Follow the cursor, clamped to the screen. No edge-snapping — it stays
      // wherever you let go, so you can park it right beside the text.
      setPos({
        x: clampX(e.clientX - dragOffset.current.x, w),
        y: clampY(e.clientY - dragOffset.current.y, h),
      });
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  // Keep the toolbar on-screen when the window is resized.
  useEffect(() => {
    const onResize = () => {
      const el = toolbarRef.current;
      const w = el ? el.offsetWidth : 56;
      const h = el ? el.offsetHeight : 56;
      setPos((p) => ({ x: clampX(p.x, w), y: clampY(p.y, h) }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const startDrag = (e: React.MouseEvent) => {
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    setDragging(true);
  };

  // One marking action per GESTURE, not per mouseup. A triple-click fires
  // mouseup twice (double-click phase selects the word, triple-click phase the
  // verse); marking on each created a stray word mark plus the verse mark, and
  // undo needed multiple steps (SCR-14). Double-click marking waits a beat for
  // a possible third click; drags (detail 1) still mark instantly.
  const pendingMark = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (pendingMark.current !== null) clearTimeout(pendingMark.current);
    },
    []
  );

  const handleMouseUp = (e: React.MouseEvent) => {
    if (pendingMark.current !== null) {
      clearTimeout(pendingMark.current);
      pendingMark.current = null;
    }
    if (e.detail === 2) {
      pendingMark.current = window.setTimeout(() => {
        pendingMark.current = null;
        applySelection();
      }, 350);
      return;
    }
    applySelection();
  };

  const applySelection = () => {
    // In "send verses" mode the panel is for picking verses, not marking.
    if (sendMode) return;
    // Pointer tool (and eraser) leave the selection alone, so you can read and
    // copy without marking. A pen tool marks instantly — one motion, done.
    if (selectedTool === "pointer" || erasing || dragging) return;
    try {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      if (!selection.toString().trim()) return;
      const range = selection.getRangeAt(0);
      const ranges = computeRanges(range);
      if (selectedTool === "define") {
        if (ranges.length && onDefine) {
          const r = ranges[0];
          const m = r.markedText.match(/[A-Za-z][A-Za-z'-]*/);
          if (m) {
            const wStart = r.startIndex + (m.index || 0);
            onDefine(
              r.reference,
              r.verseText,
              wStart,
              wStart + m[0].length,
              m[0]
            );
          }
        }
        selection.removeAllRanges();
        return;
      }
      if (ranges.length) {
        onMarkMany(
          ranges.map((r) => ({
            ...r,
            style: selectedTool as MarkStyle,
            color: selectedColor,
          }))
        );
        selection.removeAllRanges();
      }
    } catch {
      /* selection geometry unavailable — leave the selection as-is */
    }
  };

  const isV = orientation === "vertical";

  // Picking a color is intent to mark. If a non-pen tool (eraser/pointer/
  // define) is active, step back onto the last pen tool so the next selection
  // actually marks instead of doing nothing.
  const pickColor = (color: MarkColor) => {
    onChangeColor(color);
    if (!PEN_TOOLS.includes(selectedTool)) {
      onChangeTool(lastPenTool.current);
    }
  };

  const keyBadge = (k: string, active: boolean) => (
    <span
      style={{
        position: "absolute",
        bottom: "-2px",
        right: "-2px",
        fontSize: "8px",
        fontWeight: 700,
        fontFamily: "system-ui, sans-serif",
        lineHeight: 1,
        padding: "2px 3px",
        borderRadius: "4px",
        backgroundColor: active ? "var(--bg)" : "var(--soft)",
        color: active ? "var(--text)" : "var(--muted)",
        border: "1px solid var(--border)",
      }}
    >
      {k}
    </span>
  );

  const toolButton = (tool: Tool, label: React.ReactNode, keyHint: string) => {
    const active = selectedTool === tool;
    const hint = ((toolHotkeys && toolHotkeys[tool]) || keyHint).toUpperCase();
    return (
      <button
        onClick={() => onChangeTool(tool)}
        title={"Shortcut: " + hint}
        style={{
          width: "40px",
          height: "40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "10px",
          cursor: "pointer",
          fontSize: "15px",
          position: "relative",
          border: active
            ? "1.5px solid var(--text)"
            : "1.5px solid var(--border)",
          backgroundColor: active ? "var(--text)" : "transparent",
          color: active ? "var(--bg)" : "var(--text)",
          transition: "all 0.15s",
          flexShrink: 0,
        }}
      >
        {label}
        {keyBadge(hint, active)}
      </button>
    );
  };

  const divider = (
    <div
      style={{
        backgroundColor: "var(--border)",
        flexShrink: 0,
        ...(isV
          ? { height: "1px", width: "70%", margin: "2px auto" }
          : { width: "1px", height: "26px", margin: "0 2px" }),
      }}
    />
  );

  const pillButton = (label: React.ReactNode, onClick: () => void) => (
    <button
      onClick={onClick}
      style={{
        // SCR-34: sized for the 380px default panel width — big enough to
        // read and click, small enough that all three pills fit with air.
        padding: "9px 16px",
        borderRadius: "999px",
        border: "1px solid var(--border)",
        backgroundColor: "var(--panel)",
        color: "var(--text)",
        fontSize: "15px",
        fontWeight: 600,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: "8px",
      }}
    >
      {label}
      <span style={{ color: "var(--muted)", fontSize: "11px" }}>▼</span>
    </button>
  );

  const dropdownPanel = (
    children: React.ReactNode,
    close: () => void,
    width: number
  ) => (
    <>
      <div
        onClick={close}
        style={{ position: "fixed", inset: 0, zIndex: 40 }}
      />
      <div
        style={{
          // Sits just below the (SCR-34 smaller) pill button.
          position: "absolute",
          top: "44px",
          left: 0,
          width: width + "px",
          maxHeight: "340px",
          overflowY: "auto",
          backgroundColor: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "14px",
          boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
          padding: "6px",
          zIndex: 41,
        }}
      >
        {children}
      </div>
    </>
  );

  const menuItem = (label: string, active: boolean, onClick: () => void) => (
    <div
      onClick={onClick}
      style={{
        padding: "9px 12px",
        borderRadius: "8px",
        cursor: "pointer",
        fontSize: "14px",
        backgroundColor: active ? "var(--text)" : "transparent",
        color: active ? "var(--bg)" : "var(--text)",
      }}
    >
      {label}
    </div>
  );

  // Study tabs render their verses with a heading whenever the chapter
  // changes, so cross-chapter sets stay readable. Factored into a helper so the
  // "mark added verses" screen can render two labeled sections (added + study).
  const renderRefGroups = (refs: string[], keyPrefix: string) =>
    refs
      .filter((r) => verseByRef.has(r))
      .reduce<{ chapterTitle: string; refs: string[] }[]>((groups, r) => {
        const ct = verseByRef.get(r)!.chapterTitle;
        const last = groups[groups.length - 1];
        if (last && last.chapterTitle === ct) last.refs.push(r);
        else groups.push({ chapterTitle: ct, refs: [r] });
        return groups;
      }, [])
      .map((g) => (
        <div key={keyPrefix + g.chapterTitle}>
          <div
            style={{
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--muted)",
              fontFamily: "system-ui, sans-serif",
              margin: "18px 0 10px",
            }}
          >
            {g.chapterTitle}
          </div>
          {g.refs.map((r) => {
            const info = verseByRef.get(r)!;
            const marked = (
              <MarkedVerse
                reference={r}
                verseNumber={info.verse}
                text={info.text}
                marks={marks}
                onEraseMark={erasing && !removeMode ? onEraseMark : undefined}
                dark={dark}
                tags={tags}
                onTagTap={onTagTap}
              />
            );
            const checked = removeSel.includes(r);
            const sendChecked = sendSel.includes(r);
            return (
              <div
                key={r}
                style={{
                  borderRadius: "6px",
                  transition: "background-color 0.6s",
                  backgroundColor:
                    flashRef === r ? "var(--soft)" : "transparent",
                  margin: "0 -8px",
                  padding: "0 8px",
                }}
              >
                {removeMode ? (
                  <div
                    onClick={() => toggleRemove(r)}
                    style={{
                      display: "flex",
                      gap: "12px",
                      alignItems: "flex-start",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      style={{
                        width: "20px",
                        height: "20px",
                        borderRadius: "5px",
                        border:
                          "2px solid " +
                          (checked ? "#ef4444" : "var(--border)"),
                        background: checked ? "#ef4444" : "transparent",
                        color: "#fff",
                        flexShrink: 0,
                        marginTop: "3px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "12px",
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
                        opacity: checked ? 0.5 : 1,
                      }}
                    >
                      {marked}
                    </div>
                  </div>
                ) : sendMode ? (
                  <div
                    onClick={() => toggleSend(r)}
                    style={{
                      display: "flex",
                      gap: "12px",
                      alignItems: "flex-start",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      style={{
                        width: "20px",
                        height: "20px",
                        borderRadius: "5px",
                        border:
                          "2px solid " +
                          (sendChecked
                            ? dark
                              ? "#a5b4fc"
                              : "#4f46e5"
                            : "var(--border)"),
                        background: sendChecked
                          ? dark
                            ? "#a5b4fc"
                            : "#4f46e5"
                          : "transparent",
                        color: dark ? "#1a1410" : "#fff",
                        flexShrink: 0,
                        marginTop: "3px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "12px",
                        fontWeight: 800,
                      }}
                    >
                      {sendChecked ? "\u2713" : ""}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        pointerEvents: "none",
                        opacity: sendChecked ? 0.5 : 1,
                      }}
                    >
                      {marked}
                    </div>
                  </div>
                ) : (
                  marked
                )}
              </div>
            );
          })}
        </div>
      ));

  const sectionHeader = (text: string, color: string) => (
    <div
      style={{
        fontSize: "12px",
        fontWeight: 800,
        letterSpacing: "0.07em",
        textTransform: "uppercase",
        color,
        fontFamily: "system-ui, sans-serif",
        margin: "10px 0 -6px",
      }}
    >
      {text}
    </div>
  );

  const allStudyRefs = (studyRefs || []).filter((r) => verseByRef.has(r));
  const doSplit =
    typeof splitAfter === "number" &&
    splitAfter > 0 &&
    splitAfter < allStudyRefs.length &&
    !!splitLabels;
  const studyBody = doSplit ? (
    <>
      {sectionHeader(splitLabels!.first, "#3b82f6")}
      {renderRefGroups(allStudyRefs.slice(0, splitAfter), "added:")}
      {sectionHeader(splitLabels!.second, "var(--muted)")}
      {renderRefGroups(allStudyRefs.slice(splitAfter), "study:")}
    </>
  ) : (
    renderRefGroups(studyRefs || [], "")
  );

  return (
    <div style={{ position: "relative" }}>
      {showToolbar && (
      <div
        ref={toolbarRef}
        data-tour="toolbar"
        style={{
          position: "fixed",
          left: pos.x,
          top: pos.y,
          zIndex: 50,
          display: "flex",
          flexDirection: isV ? "column" : "row",
          alignItems: "center",
          gap: "7px",
          padding: isV ? "8px 6px" : "6px 8px",
          backgroundColor: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "16px",
          boxShadow: dragging
            ? "0 12px 36px rgba(0,0,0,0.28)"
            : "0 6px 22px rgba(0,0,0,0.14)",
          userSelect: "none",
          transition: "box-shadow 0.15s",
        }}
      >
        <div
          onMouseDown={startDrag}
          title="Drag to move"
          style={{
            cursor: "grab",
            color: "var(--muted)",
            fontSize: "16px",
            lineHeight: 1,
            padding: "2px",
          }}
        >
          {isV ? "⋮⋮" : "⠿"}
        </div>
        {divider}
        <div
          style={{
            display: "grid",
            // Utilities, matching the section grids: 2 rows when horizontal, 2
            // columns when vertical. Pointer / dictionary / eraser are tools
            // (Q W E); the fourth cell flips the toolbar's orientation (R).
            gridTemplateRows: isV ? "repeat(2, auto)" : undefined,
            gridTemplateColumns: isV ? undefined : "repeat(2, auto)",
            gridAutoFlow: isV ? "column" : "row",
            gap: "7px",
            justifyItems: "center",
            alignItems: "center",
          }}
        >
          {toolButton(
            "pointer",
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" />
            </svg>,
            "q"
          )}
          {toolButton(
            "define",
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>,
            "w"
          )}
          {toolButton("eraser", "⌫", "e")}
          <button
            onClick={() => setOrientation(isV ? "horizontal" : "vertical")}
            title="Switch orientation (R)"
            style={{
              width: "40px",
              height: "40px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "10px",
              cursor: "pointer",
              fontSize: "15px",
              position: "relative",
              border: "1.5px solid var(--border)",
              backgroundColor: "transparent",
              color: "var(--text)",
              transition: "all 0.15s",
              flexShrink: 0,
            }}
          >
            {isV ? "↔" : "↕"}
            {keyBadge("R", false)}
          </button>
        </div>
        {divider}
        <div
          style={{
            display: "grid",
            // Mirror the color grid's orientation logic: a vertical toolbar
            // gets 2 columns of 4 styles (tall, narrow); a horizontal one gets
            // 2 rows of 4. Each button previews its own style and carries its
            // shortcut badge, so the two new families (Box, and Dashed/Squiggly)
            // read at a glance.
            gridTemplateRows: isV ? "repeat(4, auto)" : undefined,
            gridTemplateColumns: isV ? undefined : "repeat(4, auto)",
            gridAutoFlow: isV ? "column" : "row",
            gap: "7px",
            justifyItems: "center",
            alignItems: "center",
          }}
        >
          {toolButton("highlight", <StyleGlyph style="highlight" />, "a")}
          {toolButton("underline", <StyleGlyph style="underline" />, "s")}
          {toolButton("bold", <StyleGlyph style="bold" />, "d")}
          {toolButton("italic", <StyleGlyph style="italic" />, "f")}
          {toolButton("circle", <StyleGlyph style="circle" />, "z")}
          {toolButton("box", <StyleGlyph style="box" />, "x")}
          {toolButton("dashed", <StyleGlyph style="dashed" />, "c")}
          {toolButton("squiggly", <StyleGlyph style="squiggly" />, "v")}
        </div>
        {divider}
        <div
          style={{
            display: "grid",
            // Lay the 10 colors along the toolbar's long axis: a vertical
            // toolbar gets 2 columns of 5 (tall, narrow); a horizontal one gets
            // 2 rows of 5 (short, wide) so it isn't needlessly bulky.
            gridTemplateRows: isV ? "repeat(5, auto)" : undefined,
            gridTemplateColumns: isV ? undefined : "repeat(5, auto)",
            gridAutoFlow: isV ? "column" : "row",
            gap: "7px",
            justifyItems: "center",
            alignItems: "center",
          }}
        >
          {COLORS.map((color) => {
            const active = selectedColor === color;
            return (
              <button
                key={color}
                onClick={() => pickColor(color)}
                title={
                  "Color " +
                  color +
                  " · shortcut: " +
                  (color === 10 ? "0" : color)
                }
                style={{
                  width: "26px",
                  height: "26px",
                  borderRadius: "50%",
                  backgroundColor: COLOR_MAP[color],
                  cursor: "pointer",
                  border: "none",
                  flexShrink: 0,
                  position: "relative",
                  boxShadow: active
                    ? "0 0 0 2px var(--panel), 0 0 0 4px var(--text)"
                    : "0 0 0 1px var(--border)",
                  transition: "box-shadow 0.15s",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    bottom: "-3px",
                    right: "-3px",
                    fontSize: "8px",
                    fontWeight: 700,
                    fontFamily: "system-ui, sans-serif",
                    lineHeight: 1,
                    padding: "1px 3px",
                    borderRadius: "4px",
                    backgroundColor: "var(--soft)",
                    color: "var(--muted)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {color === 10 ? "0" : color}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      )}

      <div
        style={{
          padding: panelMode ? "20px 20px 60px 24px" : "20px 20px 60px 100px",
          maxWidth: "860px",
          margin: "0 auto",
        }}
      >
        {/* Reading chrome that stays put while the verses scroll: the
            volume/book/chapter header, the function-button row, and the
            send/remove mode bars all pin together above the text. */}
        <div
          style={{
            position: "sticky",
            top: controlsStickyTop,
            zIndex: 20,
            backgroundColor: "var(--bg)",
            paddingTop: "6px",
            marginBottom: "8px",
            borderBottom: "1px solid var(--border)",
          }}
        >
        {studyRefs ? (
          hideStudyHeader ? null : (
          <div style={{ marginBottom: "12px", textAlign: "center" }}>
            <span
              style={{
                fontSize: "13px",
                fontWeight: 700,
                color: "var(--muted)",
                fontFamily: "system-ui, sans-serif",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              {studyTitle || "Study"}
            </span>
          </div>
          )
        ) : (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
            gap: "10px",
            marginBottom: "12px",
            flexWrap: "wrap",
          }}
        >
          {/* Volume */}
          <div style={{ position: "relative" }}>
            {pillButton(currentVolume.volume, () => {
              setVolMenuOpen((o) => !o);
              setBookMenuOpen(false);
              setChapMenuOpen(false);
            })}
            {volMenuOpen &&
              dropdownPanel(
                vols.map((vol, idx) =>
                  menuItem(vol.volume, idx === selectedVolume, () => {
                    onChange(idx, 0, 0);
                    setVolMenuOpen(false);
                  })
                ),
                () => setVolMenuOpen(false),
                220
              )}
          </div>

          {/* Book — only for multi-book volumes */}
          {showBook && (
            <div style={{ position: "relative" }}>
              {pillButton(currentBook.book, () => {
                setBookMenuOpen((o) => !o);
                setVolMenuOpen(false);
                setChapMenuOpen(false);
              })}
              {bookMenuOpen &&
                dropdownPanel(
                  currentVolume.books.map((book, idx) =>
                    menuItem(book.book, idx === selectedBook, () => {
                      onChange(selectedVolume, idx, 0);
                      setBookMenuOpen(false);
                    })
                  ),
                  () => setBookMenuOpen(false),
                  240
                )}
            </div>
          )}

          {/* Chapter / Section */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {panelMode && !atStart && (
              <button
                onClick={() => stepChapter(-1)}
                title="Previous chapter"
                aria-label="Previous chapter"
                style={headerArrowStyle}
              >
                ‹
              </button>
            )}
            <div style={{ position: "relative" }}>
              {pillButton(chapterLabel(currentChapter), () => {
                setChapMenuOpen((o) => !o);
                setVolMenuOpen(false);
                setBookMenuOpen(false);
              })}
              {chapMenuOpen &&
                dropdownPanel(
                  currentBook.chapters.map((ch, idx) =>
                    menuItem(
                      chapterLabel(ch),
                      idx === selectedChapter,
                      () => {
                        onChange(selectedVolume, selectedBook, idx);
                        setChapMenuOpen(false);
                      }
                    )
                  ),
                  () => setChapMenuOpen(false),
                  sermonsVol ? 220 : 160
                )}
            </div>
            {panelMode && !atEnd && (
              <button
                onClick={() => stepChapter(1)}
                title="Next chapter"
                aria-label="Next chapter"
                style={headerArrowStyle}
              >
                ›
              </button>
            )}
          </div>
        </div>
        )}

        {/* Function buttons anchor the row's edges: Link scriptures far left,
            Send/Remove verses far right (Kepu's pick after the Find
            conditionals group left the middle empty). The empty spacer div
            keeps Send verses pinned right even when no link button renders. */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "10px",
            marginBottom: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {linkScriptures && (
            <button
              onClick={linkScriptures.onClick}
              title={linkScriptures.title}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                padding: "6px 12px",
                borderRadius: "999px",
                border: "1px solid " + linkScriptures.color,
                backgroundColor: linkScriptures.color + "14",
                color: linkScriptures.color,
                fontSize: "12.5px",
                fontWeight: 600,
                fontFamily: "system-ui, sans-serif",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
                <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
              </svg>
              Link scriptures
            </button>
          )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {onCompilePanel && (
            // Per-panel Compile (SCR-48): this surface compiles itself — its
            // chapter, or its linked group. Same row as the other function
            // buttons, so the header height (SCR-20 guarantee) is unchanged.
            <button
              onClick={onCompilePanel}
              title="Compile this chapter (or its linked group)"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                padding: "6px 12px",
                borderRadius: "999px",
                border: "none",
                backgroundColor: "var(--text)",
                color: "var(--bg)",
                fontSize: "12.5px",
                fontWeight: 700,
                fontFamily: "system-ui, sans-serif",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              Compile
            </button>
          )}
          {onSendVerses && !removeMode && (
            <button
              onClick={() => {
                setSendMode((v) => !v);
                setSendSel([]);
              }}
              title="Pick verses on this tab to send to a study"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                padding: "6px 12px",
                borderRadius: "999px",
                border:
                  "1px solid " +
                  (sendMode
                    ? dark
                      ? "#a5b4fc"
                      : "#4f46e5"
                    : "var(--border)"),
                backgroundColor: sendMode
                  ? dark
                    ? "rgba(165,180,252,0.16)"
                    : "rgba(79,70,229,0.10)"
                  : "var(--panel)",
                color: sendMode
                  ? dark
                    ? "#a5b4fc"
                    : "#4f46e5"
                  : "var(--muted)",
                fontSize: "12.5px",
                fontWeight: 600,
                fontFamily: "system-ui, sans-serif",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {sendMode ? "Selecting\u2026" : "Send verses"}
            </button>
          )}
          {studyRefs && onRemoveVerses && !removeMode && !sendMode && (
            <button
              onClick={() => {
                setRemoveMode(true);
                setRemoveSel([]);
              }}
              title="Remove verses from this study"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                padding: "6px 12px",
                borderRadius: "999px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--panel)",
                color: "var(--text)",
                fontSize: "12.5px",
                fontWeight: 600,
                fontFamily: "system-ui, sans-serif",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              Remove verses
            </button>
          )}
          </div>
        </div>

        {/* Mode-banner OVERLAY (SCR-40, keeps SCR-20's guarantee): the strip
            reserves no vertical space at rest — when a click-precision mode
            (send / remove / eraser) is active, its bar floats just below the
            pinned header, over the first verse lines. Verses still never
            shift on mode toggle; the reclaimed 46px slot becomes reading
            room. */}
        {(sendMode || removeMode || erasing) && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            height: "46px",
            display: "flex",
            alignItems: "stretch",
            filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.14))",
          }}
        >
        {sendMode && (
          <div
            style={{
              flex: 1,
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "0 12px",
              borderRadius: "10px",
              border: "1px solid var(--border)",
              background: "var(--panel)",
            }}
          >
            <span
              style={{
                fontSize: "13px",
                color: "var(--muted)",
                fontFamily: "system-ui, sans-serif",
                whiteSpace: "nowrap",
              }}
            >
              {sendSel.length
                ? sendSel.length + " selected"
                : "Tap verses to select"}
            </span>
            <button
              onClick={() => {
                const all = studyRefs
                  ? allStudyRefs
                  : currentChapter?.verses.map((v) => v.reference) ?? [];
                setSendSel(sendSel.length === all.length ? [] : all);
              }}
              style={{
                padding: "5px 10px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text)",
                fontSize: "12px",
                fontWeight: 600,
                fontFamily: "system-ui, sans-serif",
                cursor: "pointer",
              }}
            >
              {sendSel.length > 0 &&
              sendSel.length ===
                (studyRefs
                  ? allStudyRefs.length
                  : currentChapter?.verses.length ?? 0)
                ? "Clear all"
                : "Select all"}
            </button>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => {
                setSendMode(false);
                setSendSel([]);
              }}
              style={{
                padding: "7px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text)",
                fontSize: "13px",
                fontWeight: 600,
                fontFamily: "system-ui, sans-serif",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (!sendSel.length) return;
                const refs = sendSel.slice();
                setSendMode(false);
                setSendSel([]);
                onSendVerses && onSendVerses(refs);
              }}
              disabled={!sendSel.length}
              style={{
                padding: "7px 14px",
                borderRadius: "8px",
                border: "none",
                background: sendSel.length
                  ? dark
                    ? "#a5b4fc"
                    : "#4f46e5"
                  : "var(--border)",
                color: sendSel.length
                  ? dark
                    ? "#1a1410"
                    : "#fff"
                  : "var(--muted)",
                fontSize: "13px",
                fontWeight: 700,
                fontFamily: "system-ui, sans-serif",
                cursor: sendSel.length ? "pointer" : "default",
                transition: "all 0.15s",
              }}
            >
              Send{sendSel.length ? " (" + sendSel.length + ")" : ""}
            </button>
          </div>
        )}

        {removeMode && (
          <div
            style={{
              flex: 1,
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "0 12px",
              borderRadius: "10px",
              border: "1px solid var(--border)",
              background: "var(--panel)",
            }}
          >
            <span
              style={{
                fontSize: "13px",
                color: "var(--muted)",
                fontFamily: "system-ui, sans-serif",
                whiteSpace: "nowrap",
              }}
            >
              {removeSel.length
                ? removeSel.length + " selected"
                : "Tap verses to remove"}
            </span>
            <button
              onClick={() => {
                setRemoveSel(
                  removeSel.length === allStudyRefs.length
                    ? []
                    : allStudyRefs.slice()
                );
              }}
              style={{
                padding: "5px 10px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text)",
                fontSize: "12px",
                fontWeight: 600,
                fontFamily: "system-ui, sans-serif",
                cursor: "pointer",
              }}
            >
              {removeSel.length > 0 && removeSel.length === allStudyRefs.length
                ? "Clear all"
                : "Select all"}
            </button>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => {
                setRemoveMode(false);
                setRemoveSel([]);
              }}
              style={{
                padding: "7px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text)",
                fontSize: "13px",
                fontWeight: 600,
                fontFamily: "system-ui, sans-serif",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (!removeSel.length) return;
                const refs = removeSel.slice();
                setRemoveMode(false);
                setRemoveSel([]);
                onRemoveVerses && onRemoveVerses(refs);
              }}
              disabled={!removeSel.length}
              style={{
                padding: "7px 14px",
                borderRadius: "8px",
                border: "none",
                background: removeSel.length ? "#ef4444" : "var(--border)",
                color: removeSel.length ? "#fff" : "var(--muted)",
                fontSize: "13px",
                fontWeight: 700,
                fontFamily: "system-ui, sans-serif",
                cursor: removeSel.length ? "pointer" : "default",
                transition: "all 0.15s",
              }}
            >
              Remove{removeSel.length ? " (" + removeSel.length + ")" : ""}
            </button>
          </div>
        )}

        {!sendMode && !removeMode && erasing && (
          <p
            style={{
              flex: 1,
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              margin: 0,
              padding: "0 12px",
              borderRadius: "10px",
              border: "1px solid var(--border)",
              background: "var(--panel)",
              fontSize: "13px",
              color: "var(--muted)",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            Eraser active — click any marked text to remove that mark.
          </p>
        )}
        </div>
        )}
        </div>

        <div
          ref={bodyRef}
          onMouseUp={handleMouseUp}
          style={{
            backgroundColor: readBg,
            color: readText,
            // SCR-40: top padding trimmed 36→20 for more reading room; sides
            // and bottom keep the original breathing space.
            padding: "20px 40px 36px",
            borderRadius: "16px",
            border: "1px solid var(--border)",
            lineHeight: lineScale,
            fontSize: (18 * fontScale).toFixed(1) + "px",
            fontFamily: '"Times New Roman", Times, serif',
            cursor: sendMode ? "default" : erasing ? "default" : "text",
            userSelect: sendMode ? "none" : undefined,
            WebkitUserSelect: sendMode ? "none" : undefined,
            transition: "background-color 0.25s, color 0.25s",
          }}
        >
          <div
            className="scribal-swap"
            key={selectedVolume + "-" + selectedBook + "-" + selectedChapter}
          >
          {studyRefs ? studyBody : currentChapter?.verses.map((verse) => {
            const picked = sendMode && sendSel.includes(verse.reference);
            return (
            <div
              key={verse.reference}
              onClickCapture={
                sendMode
                  ? (e) => {
                      e.stopPropagation();
                      toggleSend(verse.reference);
                    }
                  : undefined
              }
              style={{
                borderRadius: "6px",
                transition: "background-color 0.6s",
                backgroundColor: picked
                  ? "var(--soft)"
                  : flashRef === verse.reference
                  ? "var(--soft)"
                  : "transparent",
                margin: "0 -8px",
                padding: sendMode ? "3px 8px" : "0 8px",
                cursor: sendMode ? "pointer" : undefined,
                display: sendMode ? "flex" : undefined,
                alignItems: sendMode ? "flex-start" : undefined,
                gap: sendMode ? "10px" : undefined,
              }}
            >
              {sendMode && (
                <span
                  style={{
                    flexShrink: 0,
                    marginTop: "5px",
                    width: "18px",
                    height: "18px",
                    borderRadius: "4px",
                    border:
                      "1px solid " +
                      (picked ? (dark ? "#a5b4fc" : "#4f46e5") : "var(--muted)"),
                    background: picked
                      ? dark
                        ? "#a5b4fc"
                        : "#4f46e5"
                      : "transparent",
                    color: dark ? "#1a1410" : "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                    fontFamily: "system-ui, sans-serif",
                  }}
                >
                  {picked ? "✓" : ""}
                </span>
              )}
              <div style={sendMode ? { flex: 1, minWidth: 0 } : undefined}>
                <MarkedVerse
                  reference={verse.reference}
                  verseNumber={verse.verse}
                  text={verse.text}
                  marks={marks}
                  onEraseMark={erasing ? onEraseMark : undefined}
                  dark={dark}
                  tags={tags}
                  onTagTap={onTagTap}
                />
              </div>
            </div>
            );
          })}
          </div>
        </div>

        <p
          style={{
            textAlign: "center",
            color: "var(--muted)",
            fontSize: "11.5px",
            marginTop: "16px",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          Shortcuts: 1–7 colors · B C U I H styles · E erase · P select
        </p>
      </div>

      {/* Floating chapter arrows — pinned beside the text so you never scroll
          up to the dropdown. Single-pane reading only. */}
      {!panelMode && !studyRefs && panelBox && !atStart && (
        <button
          onClick={() => stepChapter(-1)}
          title="Previous chapter"
          aria-label="Previous chapter"
          style={{ ...sideArrowStyle, left: leftArrowPos }}
        >
          ‹
        </button>
      )}
      {!panelMode && !studyRefs && panelBox && !atEnd && (
        <button
          onClick={() => stepChapter(1)}
          title="Next chapter"
          aria-label="Next chapter"
          style={{ ...sideArrowStyle, left: rightArrowPos }}
        >
          ›
        </button>
      )}
    </div>
  );
}
