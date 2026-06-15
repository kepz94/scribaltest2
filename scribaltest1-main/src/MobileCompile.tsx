import { useState } from "react";
import { Mark, MarkColor, COLORS, COLOR_MAP, STYLE_POINTS, markStyleCSS } from "./types";
import SharePreview from "./SharePreview";

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
  onFlash: (msg: string) => void;
}

type SortMode = "order" | "points";

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
  onFlash,
}: Props) {
  const synthKey = (color: number) => "synthesis:" + scope + ":" + color;
  const [sortMode, setSortMode] = useState<SortMode>("order");
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

  const sortMarks = (list: Mark[]) => {
    const cmp =
      sortMode === "points"
        ? (a: Mark, b: Mark) =>
            (STYLE_POINTS[b.style] || 0) - (STYLE_POINTS[a.style] || 0) ||
            orderOf(a.reference) - orderOf(b.reference)
        : (a: Mark, b: Mark) =>
            orderOf(a.reference) - orderOf(b.reference) ||
            a.startIndex - b.startIndex;
    // freshly-marked verses always rise to the top of their theme
    return list.slice().sort((a, b) => {
      const na = isNew(a) ? 0 : 1;
      const nb = isNew(b) ? 0 : 1;
      return na - nb || cmp(a, b);
    });
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
              {title} · this chapter
            </div>
          )}
        </div>
        {liveMarks.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={shareStudy}
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
          {/* sort toggle */}
          <div style={{ padding: "12px 16px 4px" }}>
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
                        Show {list.length} {list.length === 1 ? "verse" : "verses"} ▾
                      </button>
                    )}

                    {isOpen && (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                          marginTop: "12px",
                        }}
                      >
                        {sortMarks(list).map((m) => (
                          <button
                            key={m.id}
                            onClick={() => onJump(m.reference)}
                            style={{
                              textAlign: "left",
                              background: C.soft,
                              border: "1px solid " + C.border,
                              borderLeft: isNew(m)
                                ? "3px solid " + COLOR_MAP[c as MarkColor]
                                : "1px solid " + C.border,
                              borderRadius: "10px",
                              padding: "10px 12px",
                              cursor: "pointer",
                              color: C.text,
                              fontFamily: "inherit",
                            }}
                          >
                            <div
                              style={{
                                fontFamily: '"Times New Roman", Times, serif',
                                fontSize: "15px",
                                lineHeight: 1.7,
                                marginBottom: "4px",
                              }}
                            >
                              “
                              <span style={markStyleCSS(m.style, m.color)}>
                                {m.markedText}
                              </span>
                              ”
                            </div>
                            <div style={{ fontSize: "11px", color: C.muted }}>
                              {m.reference}
                              {isNew(m) ? " · just marked" : ""}
                            </div>
                          </button>
                        ))}
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
    </div>
  );
}
