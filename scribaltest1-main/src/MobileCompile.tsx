import { useState, CSSProperties } from "react";
import scriptures from "./data/scriptures.json";
import MarkedVerse from "./components/MarkedVerse";
import { Mark, MarkColor, COLORS, COLOR_MAP, STYLE_POINTS, markStyleCSS } from "./types";
import SharePreview from "./SharePreview";
import type { VersesCardEntry } from "./shareCard";

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
  onSaveToVault: () => void;
  onClose: () => void;
  dark: boolean;
  title: string;
  scope: string;
  studyScopes?: string[];
  onFlash: (msg: string) => void;
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

export default function MobileCompile({
  marks,
  colorLabels,
  C,
  orderOf,
  sessionNew,
  onJump,
  notes,
  setNote,
  onSaveToVault,
  onClose,
  dark,
  title,
  scope,
  studyScopes,
  onFlash,
}: Props) {
  const synthKey = (color: number) => "synthesis:" + scope + ":" + color;
  const [sortMode, setSortMode] = useState<SortMode>("order");
  const [view, setView] = useState<"focused" | "full">("focused");
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [versesPreview, setVersesPreview] = useState<VersesCardEntry[] | null>(
    null
  );
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
      }))
    );
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
      {/* header */}
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
          onClick={onClose}
          aria-label="Back"
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
          <div style={{ fontSize: "18px", fontWeight: 700 }}>Compile</div>
          {title && (
            <div style={{ fontSize: "12px", color: C.muted }}>
              {studyScopes && studyScopes.length > 1
                ? studyScopes.length + " chapters · " + studyScopes.join(", ")
                : title + " · this chapter"}
            </div>
          )}
        </div>
        {liveMarks.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={() => {
                setPicked([]);
                setPicking(true);
              }}
              style={{
                background: "transparent",
                color: C.text,
                border: "1px solid " + C.border,
                borderRadius: "999px",
                padding: "8px 14px",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Share
            </button>
            <button
              onClick={onSaveToVault}
              style={{
                background: C.text,
                color: C.bg,
                border: "none",
                borderRadius: "999px",
                padding: "8px 14px",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Save to Vault
            </button>
          </div>
        )}
      </div>

      {liveMarks.length === 0 ? (
        <div style={{ padding: "30px 24px", fontSize: "14px", color: C.muted, lineHeight: 1.6 }}>
          No marks in this book yet. Arm a pen and tap a word to begin — your
          themes will gather here.
        </div>
      ) : (
        <>
          {/* view + sort toggles */}
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
              {seg(view === "full", "Full verse", () => setView("full"))}
            </div>
            <div
              style={{
                display: "flex",
                gap: "4px",
                backgroundColor: C.soft,
                borderRadius: "10px",
                padding: "4px",
              }}
            >
              {seg(sortMode === "order", "In order", () => setSortMode("order"))}
              {seg(sortMode === "points", "By points", () => setSortMode("points"))}
            </div>
          </div>

          {/* categories */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
              overscrollBehavior: "contain",
              padding: "10px 16px calc(40px + env(safe-area-inset-bottom))",
            }}
          >
            {groups.map((g) => {
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
                  {/* header row (tap to expand verses) */}
                  <button
                    onClick={() => toggle(g.key)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      width: "100%",
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
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
                    <span style={{ fontSize: "15px", fontWeight: 700, flex: 1 }}>
                      {name}
                    </span>
                    {newCount > 0 && (
                      <span
                        style={{
                          fontSize: "10.5px",
                          fontWeight: 700,
                          color: COLOR_MAP[c as MarkColor],
                        }}
                      >
                        {newCount} new
                      </span>
                    )}
                    <span style={{ fontSize: "11.5px", color: C.muted }}>
                      {list.length} {list.length === 1 ? "mark" : "marks"}
                      {sortMode === "points" ? " · " + pts + " pts" : ""}
                    </span>
                    <span
                      style={{
                        fontSize: "12px",
                        color: C.muted,
                        transform: isOpen ? "rotate(90deg)" : "none",
                        transition: "transform 0.15s",
                      }}
                    >
                      ›
                    </span>
                  </button>

                  {/* synthesis-first: the conclusion sits up top, always visible */}
                  <div style={{ padding: "0 14px 14px" }}>
                    <textarea
                      value={notes[synthKey(c)] || ""}
                      onChange={(e) => setNote(synthKey(c), e.target.value)}
                      placeholder={"What do these verses say together about " + name + "?"}
                      rows={2}
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
                          const fullStyle: CSSProperties = {
                            fontFamily: '"Times New Roman", Times, serif',
                            fontSize: "16px",
                            lineHeight: 1.8,
                            color: C.text,
                          };
                          // MarkedVerse colors its verse number with var(--muted);
                          // feed it the live palette so it matches light/dark.
                          (fullStyle as any)["--muted"] = C.muted;
                          return (
                            <div
                              key={ve.reference}
                              style={{
                                background: C.soft,
                                border: "1px solid " + C.border,
                                borderLeft: ve.isNew
                                  ? "3px solid " + COLOR_MAP[c as MarkColor]
                                  : "1px solid " + C.border,
                                borderRadius: "10px",
                                padding: "10px 12px",
                              }}
                            >
                              {/* verse header: reference + points */}
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
                                  onClick={() => onJump(ve.reference)}
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
                                    style={{ fontSize: "10.5px", color: C.muted }}
                                  >
                                    just marked
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
        </>
      )}
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
            {shareableVerses.map((sv) => {
              const on = picked.includes(sv.key);
              const atCap = !on && picked.length >= 4;
              const preview = sv.phrases[0] ? sv.phrases[0].text : "";
              return (
                <button
                  key={sv.key}
                  onClick={() => togglePick(sv.key)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "10px",
                    width: "100%",
                    textAlign: "left",
                    background: on ? C.soft : "transparent",
                    border:
                      "1px solid " +
                      (on ? COLOR_MAP[sv.color as MarkColor] : C.border),
                    borderRadius: "12px",
                    padding: "11px 12px",
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
                        (on ? COLOR_MAP[sv.color as MarkColor] : C.muted),
                      background: on
                        ? COLOR_MAP[sv.color as MarkColor]
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
                        display: "flex",
                        alignItems: "center",
                        gap: "7px",
                        marginBottom: "3px",
                      }}
                    >
                      <span
                        style={{
                          width: "9px",
                          height: "9px",
                          borderRadius: "50%",
                          backgroundColor: COLOR_MAP[sv.color as MarkColor],
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: "12.5px", fontWeight: 700 }}>
                        {sv.reference}
                      </span>
                      <span style={{ fontSize: "11px", color: C.muted }}>
                        {sv.theme}
                      </span>
                    </span>
                    <span
                      style={
                        {
                          fontFamily: '"Times New Roman", Times, serif',
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
                      {sv.phrases.length > 1
                        ? " +" + (sv.phrases.length - 1) + " more"
                        : ""}
                    </span>
                  </span>
                </button>
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
          onClose={() => setVersesPreview(null)}
          onFlash={onFlash}
        />
      )}
    </div>
  );
}
