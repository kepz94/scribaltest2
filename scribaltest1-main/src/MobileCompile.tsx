import { useState, useRef, useLayoutEffect, CSSProperties } from "react";
import scriptures from "./data/scriptures.json";
import MarkedVerse from "./components/MarkedVerse";
import { Mark, MarkColor, Tab, COLORS, COLOR_MAP, STYLE_POINTS, markStyleCSS } from "./types";
import Distilled from "./components/Distilled";
import Covenants from "./components/Covenants";
import SharePreview from "./SharePreview";
import type { VersesCardEntry, VersesSynthesis } from "./shareCard";

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
  sessionNew: Set<string>;
  onJump: (ref: string) => void;
  notes: Record<string, string>;
  setNote: (key: string, text: string) => void;
  onSave: (name: string) => void;
  defaultName: string;
  onClose: () => void;
  dark: boolean;
  title: string;
  scope: string;
  studyScopes?: string[];
  onFlash: (msg: string) => void;
  // Rename a theme (color) for this study's scope. Optional so older callers
  // still type-check; when supplied, active theme names become editable inline.
  onRenameTheme?: (color: number, name: string) => void;
}

type SortMode = "order" | "points";

// Look up a verse's full text + number by reference (e.g. "1 Nephi 2:5").
// Built once, lazily, the first time Compile opens — used for the Full-verse view.
let _verseIndex: Map<string, { text: string; verse: number }> | null = null;
function verseIndex(): Map<string, { text: string; verse: number }> {
  if (_verseIndex) return _verseIndex;
  const m = new Map<string, { text: string; verse: number }>();
  (scriptures as any).volumes.forEach((vol: any) =>
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
  (scriptures as any).volumes.forEach((vol: any, vi: number) =>
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
  sessionNew,
  onJump,
  notes,
  setNote,
  onSave,
  defaultName,
  onClose,
  dark,
  title,
  scope,
  studyScopes,
  onFlash,
  onRenameTheme,
}: Props) {
  // Inline theme-name editing on the outline. Only one name edits at a time; the
  // draft is committed (saved) on blur so we don't churn the store per keystroke.
  const [editingTheme, setEditingTheme] = useState<number | null>(null);
  const [themeDraft, setThemeDraft] = useState("");
  const synthKey = (color: number) => "synthesis:" + scope + ":" + color;
  // Per-verse notes live in the same store, keyed by the verse reference, so a
  // note follows its verse whether viewed alone or inside a linked study.
  const verseNoteKey = (ref: string) => "versenote:" + ref;
  const [sortMode, setSortMode] = useState<SortMode>("order");
  const [studyName, setStudyName] = useState(defaultName);
  const [view, setView] = useState<
    "focused" | "full" | "distilled" | "covenants"
  >("focused");
  // Which verse card is flipped to its note side (one at a time).
  const [flippedRef, setFlippedRef] = useState<string | null>(null);
  // Which synthesis / verse-note is in edit mode (textarea open). Otherwise the
  // text shows as a finished part of the card with an Edit button.
  const [editSynth, setEditSynth] = useState<string | null>(null);
  const [editNote, setEditNote] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  // Hide the header + toggles while reading down through verses (and bring
  // them back when scrolling up), so a long study isn't half-covered by chrome.
  const [headHidden, setHeadHidden] = useState(false);
  const lastY = useRef(0);
  const onScroll = (y: number) => {
    if (y > lastY.current + 6 && y > 40) setHeadHidden(true);
    else if (y < lastY.current - 6) setHeadHidden(false);
    lastY.current = y;
  };
  // Measure the chrome (header + toggles) so the scroll area can pad its top by
  // exactly that much. The chrome is an absolute overlay that slides up/down —
  // so the scroll area never resizes mid-scroll (which is what was stuttering).
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(0);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Which theme cards are expanded in the share picker (collapsed by default,
  // so themes are the headline and verses are a tap away).
  const [pickOpen, setPickOpen] = useState<string[]>([]);
  const [versesPreview, setVersesPreview] = useState<VersesCardEntry[] | null>(
    null
  );
  const [versesSyntheses, setVersesSyntheses] = useState<VersesSynthesis[]>([]);
  const VI = verseIndex();
  const [compPreview, setCompPreview] = useState<{
    scopeTitle: string;
    studyLabel: string;
    dateStr: string;
    totalMarks: number;
    passages: number;
    themes: { name: string; color: number; synthesis: string; count: number }[];
    candidates: { text: string; reference: string }[];
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

  const shareStudy = () => {
    const themes = activeColors
      .map((c) => ({
        name: (colorLabels[c] || "Color " + c).trim(),
        color: c,
        synthesis: (notes[synthKey(c)] || "").trim(),
        count: (byColor[c] || []).length,
      }))
      .sort((a, b) => b.count - a.count);

    // Scripture scope — what was actually studied.
    const byBook = new Map<
      string,
      { min: number; max: number; chaps: Set<number>; order: number }
    >();
    liveMarks.forEach((m) => {
      const mm = m.reference.match(/^(.*?)\s+(\d+):/);
      if (!mm) return;
      const book = mm[1];
      const chap = parseInt(mm[2], 10);
      const ord = orderOf(m.reference);
      const cur = byBook.get(book);
      if (!cur)
        byBook.set(book, { min: chap, max: chap, chaps: new Set([chap]), order: ord });
      else {
        cur.min = Math.min(cur.min, chap);
        cur.max = Math.max(cur.max, chap);
        cur.chaps.add(chap);
        cur.order = Math.min(cur.order, ord);
      }
    });
    const bookEntries = Array.from(byBook.entries()).sort(
      (a, b) => a[1].order - b[1].order
    );
    const passages = bookEntries.reduce((s, [, v]) => s + v.chaps.size, 0);
    let scopeTitle = "Scripture Study";
    if (bookEntries.length === 1) {
      const [name, v] = bookEntries[0];
      scopeTitle =
        v.min === v.max ? name + " " + v.min : name + " " + v.min + "–" + v.max;
    } else if (bookEntries.length >= 2 && bookEntries.length <= 3) {
      scopeTitle = bookEntries.map(([n]) => n).join(" · ");
    } else if (bookEntries.length > 3) {
      scopeTitle = bookEntries[0][0] + " – " + bookEntries[bookEntries.length - 1][0];
    }

    // Candidate verses (for the featured-verse picker), in scripture order.
    const candidates = liveMarks
      .filter((m) => m.markedText.trim())
      .slice()
      .sort((a, b) => orderOf(a.reference) - orderOf(b.reference))
      .map((m) => ({ text: m.markedText, reference: m.reference }));

    // Default featured = the most-emphasized mark.
    let defaultFeatured = 0;
    let bestScore = -1;
    const ordered = liveMarks
      .filter((m) => m.markedText.trim())
      .slice()
      .sort((a, b) => orderOf(a.reference) - orderOf(b.reference));
    ordered.forEach((m, i) => {
      const sc = STYLE_POINTS[m.style] || 0;
      if (sc > bestScore) {
        bestScore = sc;
        defaultFeatured = i;
      }
    });

    const dateStr = new Date().toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    setCompPreview({
      scopeTitle,
      studyLabel: title,
      dateStr,
      totalMarks: liveMarks.length,
      passages,
      themes,
      candidates,
      defaultFeatured,
    });
  };

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
  const verseEntriesFor = (list: Mark[]): VerseEntry[] => {
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
    entries.sort((a, b) => {
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
  };
  const shareableVerses: ShareableVerse[] = [];
  groups.forEach((g) => {
    verseEntriesFor(g.marks).forEach((ve) => {
      shareableVerses.push({
        key: g.key + "|" + ve.reference,
        reference: ve.reference,
        theme: g.name,
        color: g.color,
        phrases: ve.marks.map((m) => ({ text: m.markedText, style: m.style })),
      });
    });
  });
  const togglePick = (key: string) => {
    if (picked.includes(key)) {
      setPicked((prev) => prev.filter((k) => k !== key));
      return;
    }
    if (picked.length >= 4) {
      onFlash("You can share up to 4 verses");
      return;
    }
    setPicked((prev) => (prev.includes(key) ? prev : [...prev, key]));
  };
  const startShareVerses = () => {
    const chosen = picked
      .map((k) => shareableVerses.find((sv) => sv.key === k))
      .filter((x): x is ShareableVerse => !!x);
    if (chosen.length === 0) return;
    setVersesPreview(
      chosen.map((sv) => ({
        reference: sv.reference,
        theme: sv.theme,
        color: sv.color,
        phrases: sv.phrases,
        note: (notes[verseNoteKey(sv.reference)] || "").trim() || undefined,
      }))
    );
    // One synthesis per distinct theme among the chosen verses (if written).
    const seen = new Set<number>();
    const synths: VersesSynthesis[] = [];
    chosen.forEach((sv) => {
      if (seen.has(sv.color)) return;
      seen.add(sv.color);
      const text = (notes[synthKey(sv.color)] || "").trim();
      if (text) synths.push({ theme: sv.theme, color: sv.color, text });
    });
    setVersesSyntheses(synths);
    setPicking(false);
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
              style={{
                width: "100%",
                boxSizing: "border-box",
                fontSize: "19px",
                fontWeight: 700,
                background: "transparent",
                border: "none",
                borderBottom: "1px dashed " + C.border,
                color: C.text,
                fontFamily: "inherit",
                padding: "1px 0 4px",
                outline: "none",
              }}
            />
            {title && (
              <div style={{ fontSize: "12px", color: C.muted, marginTop: "4px" }}>
                {studyScopes && studyScopes.length > 1
                  ? studyScopes.length + " chapters · " + studyScopes.join(", ")
                  : title + " · this chapter"}
              </div>
            )}
          </div>
        </div>
        {/* Row 2 — actions (Save is the primary, Share is secondary) */}
        {liveMarks.length > 0 && (
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => {
                setPicked([]);
                setPicking(true);
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
            <button
              onClick={() => onSave(studyName.trim() || defaultName)}
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
      </div>
      {/* view + sort toggles — part of the chrome, so they slide away too */}
      {liveMarks.length !== 0 && (
          <div
            style={{
              padding: "12px 16px 4px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
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
              {seg(view === "full", "Full", () => setView("full"))}
              {seg(view === "distilled", "Distilled", () =>
                setView("distilled")
              )}
              {seg(view === "covenants", "Covenants", () =>
                setView("covenants")
              )}
            </div>
            {view !== "distilled" && view !== "covenants" && (
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
        onScroll={(e) => onScroll((e.target as HTMLDivElement).scrollTop)}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          overscrollBehavior: "contain",
          paddingTop: headerH + 10,
          paddingLeft: 16,
          paddingRight: 16,
          paddingBottom: "calc(40px + env(safe-area-inset-bottom))",
        }}
      >
        {view === "distilled" && <Distilled {...sharedViewProps} />}
        {view === "covenants" && <Covenants {...sharedViewProps} />}
        {view !== "distilled" &&
          view !== "covenants" &&
          liveMarks.length === 0 && (
          <div style={{ padding: "30px 24px", fontSize: "14px", color: C.muted, lineHeight: 1.6 }}>
            No marks in this book yet. Arm a pen and tap a word to begin — your
            themes will gather here.
          </div>
        )}
            {view !== "distilled" &&
              view !== "covenants" &&
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
                        placeholder={"Color " + c}
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

                  {/* synthesis-first: the conclusion sits up top */}
                  <div style={{ padding: "0 14px 14px" }}>
                    {(() => {
                      const sk = synthKey(c);
                      const sVal = notes[sk] || "";
                      const sHas = sVal.trim().length > 0;
                      const sEditing = editSynth === sk;
                      const accent = COLOR_MAP[c as MarkColor];
                      if (sEditing) {
                        return (
                          <div>
                            <textarea
                              value={sVal}
                              onChange={(e) => setNote(sk, e.target.value)}
                              autoFocus
                              placeholder={
                                "What do these verses say together about " +
                                name +
                                "?"
                              }
                              rows={3}
                              style={{
                                width: "100%",
                                boxSizing: "border-box",
                                padding: "10px 12px",
                                fontSize: "16px",
                                lineHeight: 1.5,
                                borderRadius: "10px",
                                border: "1px solid " + C.border,
                                backgroundColor: C.bg,
                                color: C.text,
                                fontFamily: "inherit",
                                resize: "vertical",
                              }}
                            />
                            <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                              <button
                                onClick={() => setEditSynth(null)}
                                style={{
                                  background: C.text,
                                  color: C.bg,
                                  border: "none",
                                  borderRadius: "8px",
                                  padding: "8px 16px",
                                  fontSize: "13px",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  fontFamily: "inherit",
                                }}
                              >
                                Done
                              </button>
                              {sHas && (
                                <button
                                  onClick={() => {
                                    setNote(sk, "");
                                    setEditSynth(null);
                                  }}
                                  style={{
                                    background: "transparent",
                                    border: "1px solid " + C.border,
                                    borderRadius: "8px",
                                    padding: "8px 14px",
                                    fontSize: "13px",
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    fontFamily: "inherit",
                                    color: C.muted,
                                  }}
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      }
                      if (sHas) {
                        return (
                          <div
                            style={{
                              borderLeft: "3px solid " + accent,
                              background: C.bg,
                              borderRadius: "0 10px 10px 0",
                              padding: "11px 14px",
                              display: "flex",
                              alignItems: "flex-start",
                              gap: "10px",
                            }}
                          >
                            <div
                              style={{
                                flex: 1,
                                fontSize: "16px",
                                lineHeight: 1.6,
                                color: C.text,
                                whiteSpace: "pre-wrap",
                              }}
                            >
                              {sVal}
                            </div>
                            <button
                              onClick={() => setEditSynth(sk)}
                              aria-label="Edit note"
                              style={{
                                flexShrink: 0,
                                background: "transparent",
                                border: "1px solid " + C.border,
                                borderRadius: "8px",
                                padding: "5px 12px",
                                fontSize: "12.5px",
                                fontWeight: 600,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                color: C.muted,
                              }}
                            >
                              Edit
                            </button>
                          </div>
                        );
                      }
                      return (
                        <button
                          onClick={() => setEditSynth(sk)}
                          aria-label={"Add a thought about " + name}
                          style={{
                            width: "100%",
                            textAlign: "center",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "8px",
                            background: "transparent",
                            border: "1px dashed " + C.border,
                            borderRadius: "10px",
                            padding: "12px",
                            fontSize: "13.5px",
                            fontWeight: 600,
                            color: C.muted,
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "18px",
                              fontWeight: 700,
                              color: accent,
                              lineHeight: 1,
                            }}
                          >
                            +
                          </span>
                        </button>
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
                        {verseEntriesFor(list).map((ve) => {
                          const info = VI.get(ve.reference);
                          const noteKey = verseNoteKey(ve.reference);
                          const noteVal = notes[noteKey] || "";
                          const hasNote = noteVal.trim().length > 0;
                          const isFlipped = flippedRef === ve.reference;
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
                                {/* FRONT — tap anywhere to flip to the note */}
                                <div
                                  onClick={() => {
                                    setFlippedRef(ve.reference);
                                    setEditNote(null);
                                  }}
                                  style={{
                                    ...faceBase,
                                    borderLeft: ve.isNew
                                      ? "3px solid " + COLOR_MAP[c as MarkColor]
                                      : "1px solid " + C.border,
                                    cursor: "pointer",
                                  }}
                                >
                                  {/* verse header: reference + points + note flag */}
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
                                    const editing = editNote === noteKey;
                                    if (editing) {
                                      return (
                                        <>
                                          <textarea
                                            value={noteVal}
                                            onChange={(e) =>
                                              setNote(noteKey, e.target.value)
                                            }
                                            autoFocus
                                            placeholder="Write a note for this verse…"
                                            style={{
                                              flex: 1,
                                              minHeight: "72px",
                                              resize: "none",
                                              border: "1px solid " + C.border,
                                              borderRadius: "8px",
                                              padding: "8px 10px",
                                              fontFamily: "inherit",
                                              fontSize: "16px",
                                              lineHeight: 1.5,
                                              background: C.bg,
                                              color: C.text,
                                            }}
                                          />
                                          <div style={{ display: "flex", gap: "8px" }}>
                                            <button
                                              onClick={() => setEditNote(null)}
                                              style={{
                                                flex: 1,
                                                background: C.text,
                                                color: C.bg,
                                                border: "none",
                                                borderRadius: "8px",
                                                padding: "8px",
                                                fontSize: "13px",
                                                fontWeight: 700,
                                                cursor: "pointer",
                                                fontFamily: "inherit",
                                              }}
                                            >
                                              Save
                                            </button>
                                            {hasNote && (
                                              <button
                                                onClick={() => {
                                                  setNote(noteKey, "");
                                                  setEditNote(null);
                                                  setFlippedRef(null);
                                                }}
                                                style={{
                                                  background: "transparent",
                                                  border: "1px solid " + C.border,
                                                  borderRadius: "8px",
                                                  padding: "8px 14px",
                                                  fontSize: "13px",
                                                  fontWeight: 600,
                                                  cursor: "pointer",
                                                  fontFamily: "inherit",
                                                  color: C.muted,
                                                }}
                                              >
                                                Delete
                                              </button>
                                            )}
                                          </div>
                                        </>
                                      );
                                    }
                                    if (hasNote) {
                                      return (
                                        <>
                                          <div
                                            style={{
                                              flex: 1,
                                              overflowY: "auto",
                                              fontSize: "16px",
                                              lineHeight: 1.6,
                                              color: C.text,
                                              whiteSpace: "pre-wrap",
                                              fontFamily: "inherit",
                                            }}
                                          >
                                            {noteVal}
                                          </div>
                                          <div style={{ display: "flex", gap: "8px" }}>
                                            <button
                                              onClick={() => setEditNote(noteKey)}
                                              style={{
                                                background: "transparent",
                                                border: "1px solid " + C.border,
                                                borderRadius: "8px",
                                                padding: "8px 16px",
                                                fontSize: "13px",
                                                fontWeight: 600,
                                                cursor: "pointer",
                                                fontFamily: "inherit",
                                                color: C.muted,
                                              }}
                                            >
                                              Edit
                                            </button>
                                            <button
                                              onClick={() => setFlippedRef(null)}
                                              style={{
                                                flex: 1,
                                                background: C.text,
                                                color: C.bg,
                                                border: "none",
                                                borderRadius: "8px",
                                                padding: "8px",
                                                fontSize: "13px",
                                                fontWeight: 700,
                                                cursor: "pointer",
                                                fontFamily: "inherit",
                                              }}
                                            >
                                              Done
                                            </button>
                                          </div>
                                        </>
                                      );
                                    }
                                    return (
                                      <>
                                        <button
                                          onClick={() => setEditNote(noteKey)}
                                          style={{
                                            flex: 1,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            gap: "7px",
                                            background: "transparent",
                                            border: "1px dashed " + C.border,
                                            borderRadius: "8px",
                                            padding: "10px",
                                            fontSize: "13.5px",
                                            fontWeight: 600,
                                            color: C.muted,
                                            cursor: "pointer",
                                            fontFamily: "inherit",
                                          }}
                                        >
                                          <span style={{ fontSize: "22px", fontWeight: 700, lineHeight: 1 }}>
                                            +
                                          </span>
                                        </button>
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

      {picking && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 400,
            backgroundColor: C.bg,
            color: C.text,
            display: "flex",
            flexDirection: "column",
            fontFamily: "system-ui, -apple-system, sans-serif",
            animation: "mob-fadein 0.2s ease",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "calc(12px + env(safe-area-inset-top)) 12px 12px",
              borderBottom: "1px solid " + C.border,
            }}
          >
            <button
              onClick={() => setPicking(false)}
              aria-label="Cancel"
              style={{
                width: "40px",
                height: "40px",
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
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "17px", fontWeight: 700 }}>
                Choose verses to share
              </div>
              <div style={{ fontSize: "12px", color: C.muted }}>
                {picked.length} of 4 selected
              </div>
            </div>
            <button
              onClick={startShareVerses}
              disabled={picked.length === 0}
              style={{
                background: picked.length ? C.text : C.soft,
                color: picked.length ? C.bg : C.muted,
                border: "none",
                borderRadius: "999px",
                padding: "8px 16px",
                fontSize: "13px",
                fontWeight: 700,
                cursor: picked.length ? "pointer" : "default",
                fontFamily: "inherit",
              }}
            >
              Share{picked.length ? " " + picked.length : ""}
            </button>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
              padding: "12px 16px calc(20px + env(safe-area-inset-bottom))",
            }}
          >
            {groups.map((g) => {
              const versesForTheme = verseEntriesFor(g.marks);
              if (versesForTheme.length === 0) return null;
              const open = pickOpen.includes(g.key);
              const pickedInTheme = versesForTheme.filter((ve) =>
                picked.includes(g.key + "|" + ve.reference)
              ).length;
              return (
                <div
                  key={g.key}
                  style={{
                    marginBottom: "12px",
                    border: "1px solid " + C.border,
                    borderRadius: "14px",
                    backgroundColor: C.panel,
                    overflow: "hidden",
                  }}
                >
                  {/* theme header (tap to reveal verses) */}
                  <button
                    onClick={() =>
                      setPickOpen((prev) =>
                        prev.includes(g.key)
                          ? prev.filter((k) => k !== g.key)
                          : [...prev, g.key]
                      )
                    }
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      width: "100%",
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
                      padding: "14px 14px",
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
                        backgroundColor: COLOR_MAP[g.color as MarkColor],
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontSize: "15px",
                        fontWeight: 700,
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {g.name}
                    </span>
                    {pickedInTheme > 0 && (
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          color: COLOR_MAP[g.color as MarkColor],
                        }}
                      >
                        {pickedInTheme} picked
                      </span>
                    )}
                    <span style={{ fontSize: "11.5px", color: C.muted }}>
                      {versesForTheme.length}{" "}
                      {versesForTheme.length === 1 ? "verse" : "verses"}
                    </span>
                    <span
                      style={{
                        fontSize: "12px",
                        color: C.muted,
                        transform: open ? "rotate(90deg)" : "none",
                        transition: "transform 0.15s",
                      }}
                    >
                      ›
                    </span>
                  </button>

                  {open && (
                    <div style={{ padding: "0 12px 8px" }}>
                      {versesForTheme.map((ve) => {
                        const key = g.key + "|" + ve.reference;
                        const on = picked.includes(key);
                        const atCap = !on && picked.length >= 4;
                        const phrases = ve.marks.map((m) => ({
                          text: m.markedText,
                          style: m.style,
                        }));
                        const preview = phrases[0] ? phrases[0].text : "";
                        return (
                          <button
                            key={key}
                            onClick={() => togglePick(key)}
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: "10px",
                              width: "100%",
                              textAlign: "left",
                              background: on ? C.soft : "transparent",
                              border:
                                "1px solid " +
                                (on
                                  ? COLOR_MAP[g.color as MarkColor]
                                  : C.border),
                              borderRadius: "10px",
                              padding: "10px 11px",
                              marginBottom: "8px",
                              cursor: "pointer",
                              color: C.text,
                              fontFamily: "inherit",
                              opacity: atCap ? 0.45 : 1,
                            }}
                          >
                            <span
                              style={{
                                width: "20px",
                                height: "20px",
                                borderRadius: "6px",
                                border:
                                  "2px solid " +
                                  (on
                                    ? COLOR_MAP[g.color as MarkColor]
                                    : C.muted),
                                background: on
                                  ? COLOR_MAP[g.color as MarkColor]
                                  : "transparent",
                                color: "#fff",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "13px",
                                flexShrink: 0,
                                marginTop: "1px",
                              }}
                            >
                              {on ? "✓" : ""}
                            </span>
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                display: "flex",
                                flexDirection: "column",
                              }}
                            >
                              <span
                                style={{
                                  fontSize: "12.5px",
                                  fontWeight: 700,
                                  marginBottom: "3px",
                                }}
                              >
                                {ve.reference}
                              </span>
                              <span
                                style={
                                  {
                                    fontFamily:
                                      '"Times New Roman", Times, serif',
                                    fontSize: "14px",
                                    lineHeight: 1.5,
                                    color: C.text,
                                    overflow: "hidden",
                                    display: "-webkit-box",
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: "vertical",
                                  } as CSSProperties
                                }
                              >
                                “{preview}”
                                {phrases.length > 1
                                  ? " +" + (phrases.length - 1) + " more"
                                  : ""}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            <button
              onClick={() => {
                setPicking(false);
                shareStudy();
              }}
              style={{
                marginTop: "6px",
                background: "transparent",
                border: "none",
                color: C.muted,
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                padding: "10px 0",
                width: "100%",
                textAlign: "center",
              }}
            >
              Or share a study summary instead
            </button>
          </div>
        </div>
      )}

      {versesPreview && (
        <SharePreview
          C={C}
          appDark={dark}
          kind="verses"
          verses={versesPreview}
          syntheses={versesSyntheses}
          onClose={() => setVersesPreview(null)}
          onFlash={onFlash}
        />
      )}
    </div>
  );
}
