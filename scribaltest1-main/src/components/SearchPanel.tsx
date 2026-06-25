import { useState, useMemo, useRef, useEffect } from "react";
import scriptures from "../data/scriptures.json";
import { Mark, MarkColor, COLORS, COLOR_MAP } from "../types";
import { buildSearchMatcher } from "../searchMatch";

export interface ThemeMark {
  bookId: string;
  bookName: string;
  isMaster: boolean;
  reference: string;
  color: MarkColor;
  markedText: string;
  label: string;
}

interface SearchPanelProps {
  currentVolume: number;
  currentBook: number;
  marks: Mark[];
  colorLabels: Record<number, string>;
  labelFor: (reference: string, color: MarkColor | null) => string;
  allMarks: ThemeMark[];
  onJump: (reference: string) => void;
  onJumpToMark: (bookId: string, reference: string) => void;
  onOpenNewTab: (reference: string) => void;
  onLinkStudy?: (refs: string[]) => void;
  onLinkSearchToChapter?: (refs: string[], label: string) => void;
  // When set, the panel is adding verses to an existing keyword study: its
  // verses come pre-selected, and the link bar offers update-vs-new-copy.
  initialSelected?: string[];
  addToStudyName?: string;
  onAddToStudy?: (refs: string[], mode: "update" | "copy") => void;
  // When set, the panel is adding loose verses to a recorded chapter/linked
  // study: its current extras come pre-selected, and the bar offers one button.
  addVersesName?: string;
  onAddVerses?: (refs: string[]) => void;
  onClose: () => void;
}

type Mode = "all" | "any" | "phrase";
type Source = "scripture" | "marks" | "themes";

const vols = scriptures.volumes;
const MAX_RESULTS = 400;

interface IndexEntry {
  vol: number;
  book: number;
  reference: string;
  verse: number;
  text: string;
  lower: string;
  volName: string;
  bookName: string;
}

export default function SearchPanel(props: SearchPanelProps) {
  const {
    marks,
    colorLabels,
    labelFor,
    allMarks,
    onJump,
    onJumpToMark,
    onOpenNewTab,
    onLinkStudy,
    onLinkSearchToChapter,
    addToStudyName,
    onAddToStudy,
    addVersesName,
    onAddVerses,
    onClose,
  } = props;

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("phrase");
  const [source, setSource] = useState<Source>("scripture");
  const [volIdx, setVolIdx] = useState(-1); // -1 = all volumes
  const [bookIdx, setBookIdx] = useState(-1); // -1 = all books
  const [markColor, setMarkColor] = useState<MarkColor | 0>(0);
  const [showLegend, setShowLegend] = useState(false);
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(
    () => new Set(props.initialSelected || [])
  );
  const [committed, setCommitted] = useState<{
    q: string;
    mode: Mode;
    source: Source;
    volIdx: number;
    bookIdx: number;
    color: MarkColor | 0;
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current && inputRef.current.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const index = useMemo<IndexEntry[]>(() => {
    const arr: IndexEntry[] = [];
    vols.forEach((v, vi) =>
      v.books.forEach((b, bi) =>
        b.chapters.forEach((c) =>
          c.verses.forEach((ve) =>
            arr.push({
              vol: vi,
              book: bi,
              reference: ve.reference,
              verse: ve.verse,
              text: ve.text,
              lower: ve.text.toLowerCase(),
              volName: v.volume,
              bookName: b.book,
            })
          )
        )
      )
    );
    return arr;
  }, []);

  const refLookup = useMemo(() => {
    const m: Record<string, IndexEntry> = {};
    index.forEach((e) => {
      m[e.reference] = e;
    });
    return m;
  }, [index]);

  const results = useMemo(() => {
    if (!committed) return null;
    const q = committed.q.trim();
    const themeColorOnly =
      committed.source === "themes" && committed.color !== 0;
    if (!q && !themeColorOnly)
      return {
        items: [] as {
          reference: string;
          text: string;
          volName: string;
          color: MarkColor | null;
          bookId?: string;
          bookName?: string;
          label?: string;
        }[],
        total: 0,
        byVol: {} as Record<string, number>,
        terms: [] as string[],
      };

    // Unified matcher: shared with the mobile search (src/searchMatch.ts) so the
    // phone and the computer interpret a query exactly the same way.
    const matcher = buildSearchMatcher(q, committed.mode, true);
    const test = matcher ? matcher.test : () => false;
    const terms = matcher ? matcher.terms : [];

    const inScope = (e: IndexEntry) =>
      committed.volIdx < 0
        ? true
        : e.vol === committed.volIdx &&
          (committed.bookIdx < 0 ? true : e.book === committed.bookIdx);

    const items: {
      reference: string;
      text: string;
      volName: string;
      color: MarkColor | null;
      bookId?: string;
      bookName?: string;
      label?: string;
    }[] = [];
    const byVol: Record<string, number> = {};

    if (committed.source === "scripture") {
      for (const e of index) {
        if (!inScope(e)) continue;
        if (test(e.lower)) {
          items.push({
            reference: e.reference,
            text: e.text,
            volName: e.volName,
            color: null,
          });
          byVol[e.volName] = (byVol[e.volName] || 0) + 1;
          if (items.length >= 4000) break;
        }
      }
    } else if (committed.source === "themes") {
      for (const tm of allMarks) {
        if (committed.color && tm.color !== committed.color) continue;
        const e = refLookup[tm.reference];
        if (e && !inScope(e)) continue;
        const matches =
          terms.length === 0 ||
          test(tm.markedText.toLowerCase()) ||
          test((tm.label || "").toLowerCase());
        if (matches) {
          items.push({
            reference: tm.reference,
            text: tm.markedText,
            volName: e ? e.volName : "",
            color: tm.color,
            bookId: tm.bookId,
            bookName: tm.bookName,
            label: tm.label,
          });
          if (e) byVol[e.volName] = (byVol[e.volName] || 0) + 1;
        }
      }
    } else {
      for (const mk of marks) {
        if (committed.color && mk.color !== committed.color) continue;
        const e = refLookup[mk.reference];
        if (e && !inScope(e)) continue;
        if (test(mk.markedText.toLowerCase())) {
          items.push({
            reference: mk.reference,
            text: mk.markedText,
            volName: e ? e.volName : "",
            color: mk.color,
          });
          if (e) byVol[e.volName] = (byVol[e.volName] || 0) + 1;
        }
      }
    }

    return { items, total: items.length, byVol, terms };
  }, [committed, index, refLookup, marks, allMarks]);

  const renderHighlighted = (text: string, terms: string[]) => {
    if (!terms.length) return text;
    const src = terms.join("|");
    let re: RegExp;
    try {
      re = new RegExp("(" + src + ")", "gi");
    } catch {
      return text;
    }
    const parts = text.split(re);
    return parts.map((p, i) =>
      i % 2 === 1 ? (
        <mark
          key={i}
          style={{
            backgroundColor: "var(--hl3)",
            color: "var(--text)",
            borderRadius: "2px",
            padding: "0 1px",
          }}
        >
          {p}
        </mark>
      ) : (
        <span key={i}>{p}</span>
      )
    );
  };

  const submit = () =>
    setCommitted({
      q: query,
      mode,
      source,
      volIdx,
      bookIdx,
      color: markColor,
    });

  const seg = (active: boolean, label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      style={{
        padding: "6px 13px",
        border: "none",
        cursor: "pointer",
        fontSize: "12.5px",
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

  const segGroup = (children: React.ReactNode) => (
    <div
      style={{
        display: "flex",
        border: "1px solid var(--border)",
        borderRadius: "999px",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );

  const selStyle: React.CSSProperties = {
    padding: "7px 12px",
    borderRadius: "999px",
    border: "1px solid var(--border)",
    backgroundColor: "transparent",
    color: "var(--text)",
    fontSize: "12.5px",
    fontFamily: "inherit",
    cursor: "pointer",
    maxWidth: "190px",
  };

  const legendRow = (head: string, body: string) => (
    <div style={{ display: "flex", gap: "10px", marginBottom: "8px" }}>
      <span
        style={{
          flexShrink: 0,
          minWidth: "104px",
          fontWeight: 600,
          color: "var(--text)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {head}
      </span>
      <span style={{ color: "var(--muted)", lineHeight: 1.5 }}>{body}</span>
    </div>
  );

  const shown = results ? results.items.slice(0, MAX_RESULTS) : [];

  // When the panel is pulling verses into a study, the rows are a multi-select
  // list: clicking a row toggles its checkbox rather than jumping away (a stray
  // tap used to open the verse and close the search, losing the whole selection).
  // Jumping moves to a dedicated button on the far side of the row.
  const selectMode = !!(onLinkStudy || onAddToStudy || onAddVerses);
  const shownRefs = shown.map((r) => r.reference);
  const allShownSelected =
    shownRefs.length > 0 && shownRefs.every((ref) => selectedRefs.has(ref));
  const toggleRef = (ref: string) =>
    setSelectedRefs((prev) => {
      const n = new Set(prev);
      if (n.has(ref)) n.delete(ref);
      else n.add(ref);
      return n;
    });
  const toggleSelectAllShown = () =>
    setSelectedRefs((prev) => {
      const n = new Set(prev);
      if (shownRefs.every((ref) => n.has(ref)))
        shownRefs.forEach((ref) => n.delete(ref));
      else shownRefs.forEach((ref) => n.add(ref));
      return n;
    });

  return (
    <div
      className="scribal-fade"
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 130,
        backgroundColor: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "60px 20px 20px",
      }}
    >
      <div
        className="scribal-rise"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "680px",
          maxHeight: "calc(100vh - 90px)",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--panel)",
          color: "var(--text)",
          borderRadius: "16px",
          border: "1px solid var(--border)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
          overflow: "hidden",
        }}
      >
        {/* Search field */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span style={{ color: "var(--muted)", fontSize: "18px" }}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="Search a word, phrase, or theme…  (try merc*)"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: "17px",
              color: "var(--text)",
            }}
          />
          <button
            onClick={submit}
            style={{
              padding: "8px 18px",
              borderRadius: "999px",
              border: "none",
              backgroundColor: "#8b5cf6",
              color: "#fff",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 500,
            }}
          >
            Search
          </button>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: "18px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Options */}
        <div
          style={{
            display: "flex",
            gap: "10px",
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {segGroup(
            <>
              {seg(mode === "all", "All words", () => setMode("all"))}
              {seg(mode === "any", "Any word", () => setMode("any"))}
              {seg(mode === "phrase", "Phrase", () => setMode("phrase"))}
            </>
          )}
          {segGroup(
            <>
              {seg(source === "scripture", "Scripture", () =>
                setSource("scripture")
              )}
              {seg(source === "marks", "My marks", () => setSource("marks"))}
              {seg(source === "themes", "Themes", () => setSource("themes"))}
            </>
          )}
          <select
            value={volIdx}
            onChange={(e) => {
              setVolIdx(Number(e.target.value));
              setBookIdx(-1);
            }}
            style={selStyle}
            aria-label="Filter by volume"
          >
            <option value={-1}>All volumes</option>
            {vols.map((vol, i) => (
              <option key={i} value={i}>
                {vol.volume}
              </option>
            ))}
          </select>
          {volIdx >= 0 && (
            <select
              value={bookIdx}
              onChange={(e) => setBookIdx(Number(e.target.value))}
              style={selStyle}
              aria-label="Filter by book"
            >
              <option value={-1}>All books</option>
              {vols[volIdx].books.map((bk, i) => (
                <option key={i} value={i}>
                  {bk.book}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setShowLegend((s) => !s)}
            title="What can I search?"
            style={{
              padding: "6px 13px",
              borderRadius: "999px",
              border: "1px solid var(--border)",
              cursor: "pointer",
              fontSize: "12.5px",
              backgroundColor: showLegend ? "var(--soft)" : "transparent",
              color: showLegend ? "var(--text)" : "var(--muted)",
              fontWeight: showLegend ? 600 : 400,
            }}
          >
            ? Legend
          </button>
        </div>

        {/* Legend panel */}
        {showLegend && (
          <div
            style={{
              padding: "14px 18px",
              borderBottom: "1px solid var(--border)",
              backgroundColor: "var(--soft)",
              fontSize: "12.5px",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                letterSpacing: "2px",
                textTransform: "uppercase",
                color: "var(--muted)",
                marginBottom: "10px",
              }}
            >
              How search works
            </div>
            {legendRow(
              "All / Any / Phrase",
              "Choose how plain words combine — every word, any word, or the exact phrase in order."
            )}
            {legendRow("faith & hope", "Use & to require all parts.")}
            {legendRow("mercy OR grace", "Use OR to match either side.")}
            {legendRow(
              "merc*",
              "Put * after a stem to match every word that starts with it → mercy, merciful, mercies."
            )}
            {legendRow(
              "Scripture / My marks",
              "Search the full text, or only the passages you’ve marked."
            )}
            {legendRow(
              "Volume / Book",
              "Limit results to any volume, or a single book within it."
            )}
            {legendRow(
              "Color",
              "When searching your marks, narrow to one theme color."
            )}
            {legendRow(
              "⧉  New tab",
              "On any result, open it in a separate tab without leaving the verse you’re on."
            )}
          </div>
        )}

        {/* Color filter — marks & themes sources */}
        {(source === "marks" || source === "themes") && (
          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              padding: "10px 18px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span style={{ fontSize: "12px", color: "var(--muted)" }}>
              Color:
            </span>
            <button
              onClick={() => setMarkColor(0)}
              style={{
                padding: "4px 12px",
                borderRadius: "999px",
                border: "1px solid var(--border)",
                cursor: "pointer",
                fontSize: "12px",
                backgroundColor:
                  markColor === 0 ? "var(--text)" : "transparent",
                color: markColor === 0 ? "var(--bg)" : "var(--muted)",
              }}
            >
              Any
            </button>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setMarkColor(c)}
                title={colorLabels[c]?.trim() || "Color " + c}
                style={{
                  width: "22px",
                  height: "22px",
                  borderRadius: "50%",
                  backgroundColor: COLOR_MAP[c],
                  cursor: "pointer",
                  border: "none",
                  opacity: markColor === 0 || markColor === c ? 1 : 0.3,
                  boxShadow:
                    markColor === c
                      ? "0 0 0 2px var(--panel), 0 0 0 4px var(--text)"
                      : "0 0 0 1px var(--border)",
                }}
              />
            ))}
          </div>
        )}

        {/* Results */}
        <div style={{ overflowY: "auto", padding: "8px 0" }}>
          {!results && (
            <p
              style={{
                color: "var(--muted)",
                textAlign: "center",
                padding: "40px 20px",
                fontSize: "14px",
              }}
            >
              Type a word or phrase and press Enter. Use <strong>*</strong> for
              wildcards (e.g. <em>merc*</em> → mercy, merciful), or tap{" "}
              <strong>? Legend</strong> to see everything search can do.
            </p>
          )}

          {results && results.total === 0 && (
            <p
              style={{
                color: "var(--muted)",
                textAlign: "center",
                padding: "40px 20px",
              }}
            >
              No matches.
            </p>
          )}

          {results && results.total > 0 && (
            <>
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  flexWrap: "wrap",
                  alignItems: "center",
                  padding: "6px 18px 12px",
                }}
              >
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--text)",
                  }}
                >
                  {results.total} match{results.total === 1 ? "" : "es"}
                </span>
                {Object.keys(results.byVol).map((vn) => (
                  <span
                    key={vn}
                    style={{
                      fontSize: "11px",
                      color: "var(--muted)",
                      backgroundColor: "var(--soft)",
                      borderRadius: "999px",
                      padding: "2px 9px",
                    }}
                  >
                    {vn} {results.byVol[vn]}
                  </span>
                ))}
                {selectMode && shownRefs.length > 0 && (
                  <>
                    <div style={{ flex: 1 }} />
                    <button
                      onClick={toggleSelectAllShown}
                      style={{
                        padding: "5px 12px",
                        borderRadius: "999px",
                        border: "1px solid var(--border)",
                        background: allShownSelected
                          ? "var(--soft)"
                          : "transparent",
                        color: "var(--text)",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontWeight: 600,
                        fontFamily: "inherit",
                        flexShrink: 0,
                      }}
                    >
                      {allShownSelected ? "Select none" : "Select all"}
                    </button>
                  </>
                )}
              </div>

              {(onLinkStudy || onAddToStudy || onAddVerses) &&
                selectedRefs.size > 0 && (
                <div
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "10px 18px",
                    borderTop: "1px solid var(--border)",
                    background: "var(--panel)",
                  }}
                >
                  <span
                    style={{
                      fontSize: "12.5px",
                      color: "var(--text)",
                      fontWeight: 600,
                    }}
                  >
                    {selectedRefs.size} selected
                  </span>
                  <div style={{ flex: 1 }} />
                  <button
                    onClick={() => setSelectedRefs(new Set())}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "999px",
                      border: "1px solid var(--border)",
                      background: "transparent",
                      color: "var(--muted)",
                      cursor: "pointer",
                      fontSize: "12px",
                      fontFamily: "inherit",
                    }}
                  >
                    Clear
                  </button>
                  {onAddVerses && addVersesName ? (
                    <button
                      onClick={() => onAddVerses(Array.from(selectedRefs))}
                      style={{
                        padding: "6px 14px",
                        borderRadius: "999px",
                        border: "none",
                        background: "#0d9488",
                        color: "#fff",
                        cursor: "pointer",
                        fontSize: "12.5px",
                        fontWeight: 700,
                        fontFamily: "inherit",
                      }}
                    >
                      Add to “
                      {addVersesName.length > 16
                        ? addVersesName.slice(0, 15) + "…"
                        : addVersesName}
                      ”
                    </button>
                  ) : onAddToStudy && addToStudyName ? (
                    <>
                      <button
                        onClick={() =>
                          onAddToStudy(Array.from(selectedRefs), "update")
                        }
                        style={{
                          padding: "6px 14px",
                          borderRadius: "999px",
                          border: "none",
                          background: "#0d9488",
                          color: "#fff",
                          cursor: "pointer",
                          fontSize: "12.5px",
                          fontWeight: 700,
                          fontFamily: "inherit",
                        }}
                      >
                        Update “
                        {addToStudyName.length > 16
                          ? addToStudyName.slice(0, 15) + "…"
                          : addToStudyName}
                        ”
                      </button>
                      <button
                        onClick={() =>
                          onAddToStudy(Array.from(selectedRefs), "copy")
                        }
                        style={{
                          padding: "6px 12px",
                          borderRadius: "999px",
                          border: "1px solid var(--border)",
                          background: "transparent",
                          color: "var(--text)",
                          cursor: "pointer",
                          fontSize: "12.5px",
                          fontWeight: 600,
                          fontFamily: "inherit",
                        }}
                      >
                        Save as new study
                      </button>
                    </>
                  ) : (
                    <>
                      {onLinkSearchToChapter && (
                        <button
                          onClick={() => {
                            onLinkSearchToChapter(
                              Array.from(selectedRefs),
                              query.trim()
                            );
                            setSelectedRefs(new Set());
                          }}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "6px 14px",
                            borderRadius: "999px",
                            border: "none",
                            background: "#0d9488",
                            color: "#fff",
                            cursor: "pointer",
                            fontSize: "12.5px",
                            fontWeight: 700,
                            fontFamily: "inherit",
                          }}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#fff"
                            strokeWidth={2.4}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
                            <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
                          </svg>
                          Link to a chapter
                        </button>
                      )}
                      {onLinkStudy && (
                        <button
                          onClick={() => {
                            onLinkStudy(Array.from(selectedRefs));
                            setSelectedRefs(new Set());
                          }}
                          style={{
                            padding: "6px 12px",
                            borderRadius: "999px",
                            border: "1px solid var(--border)",
                            background: "transparent",
                            color: "var(--text)",
                            cursor: "pointer",
                            fontSize: "12.5px",
                            fontWeight: 600,
                            fontFamily: "inherit",
                          }}
                        >
                          Link verses into a study
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
              {shown.map((r, i) => (
                <div
                  key={r.reference + "|" + i}
                  onClick={() => {
                    if (selectMode) toggleRef(r.reference);
                    else if (r.bookId) onJumpToMark(r.bookId, r.reference);
                    else onJump(r.reference);
                  }}
                  style={{
                    padding: "11px 18px",
                    cursor: "pointer",
                    borderTop: "1px solid var(--border)",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = "var(--soft)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "transparent")
                  }
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "3px",
                    }}
                  >
                    {(onLinkStudy || onAddToStudy || onAddVerses) && (
                      <input
                        type="checkbox"
                        checked={selectedRefs.has(r.reference)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleRef(r.reference)}
                        style={{
                          width: "15px",
                          height: "15px",
                          cursor: "pointer",
                          flexShrink: 0,
                          accentColor: "#0d9488",
                        }}
                      />
                    )}
                    {r.color && (
                      <span
                        style={{
                          width: "9px",
                          height: "9px",
                          borderRadius: "50%",
                          backgroundColor: COLOR_MAP[r.color],
                        }}
                      />
                    )}
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "var(--text)",
                        fontFamily: "system-ui, sans-serif",
                      }}
                    >
                      {r.reference}
                    </span>
                    <div style={{ flex: 1 }} />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (r.bookId) onJumpToMark(r.bookId, r.reference);
                        else onJump(r.reference);
                      }}
                      title="Open here (current tab)"
                      style={{
                        padding: "3px 10px",
                        borderRadius: "999px",
                        border: "1px solid var(--border)",
                        background: "transparent",
                        color: "var(--muted)",
                        cursor: "pointer",
                        fontSize: "11px",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        flexShrink: 0,
                      }}
                    >
                      Open ↗
                    </button>
                    {!r.bookId && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenNewTab(r.reference);
                        }}
                        title="Open in a new tab (keeps your current tab)"
                        style={{
                          padding: "3px 10px",
                          borderRadius: "999px",
                          border: "1px solid var(--border)",
                          background: "transparent",
                          color: "var(--muted)",
                          cursor: "pointer",
                          fontSize: "11px",
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                          flexShrink: 0,
                        }}
                      >
                        ⧉ New tab
                      </button>
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: '"Times New Roman", Times, serif',
                      fontSize: "15px",
                      lineHeight: 1.6,
                      color: "var(--text)",
                    }}
                  >
                    {renderHighlighted(r.text, results.terms)}
                  </div>
                  {r.bookId && (
                    <div
                      style={{
                        fontSize: "11px",
                        color: "var(--muted)",
                        fontFamily: "system-ui, sans-serif",
                        marginTop: "4px",
                      }}
                    >
                      {labelFor(r.reference, r.color) ||
                        (r.label && r.label.trim()) ||
                        "Unnamed color"}
                      {" · "}
                      {r.bookName}
                    </div>
                  )}
                </div>
              ))}

              {results.total > MAX_RESULTS && (
                <p
                  style={{
                    color: "var(--muted)",
                    textAlign: "center",
                    padding: "14px",
                    fontSize: "12px",
                  }}
                >
                  Showing the first {MAX_RESULTS} of {results.total}. Narrow
                  your scope or add words to refine.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
