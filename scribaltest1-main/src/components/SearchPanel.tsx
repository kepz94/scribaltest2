import { useState, useMemo, useRef, useEffect } from "react";
import scriptures from "../data/scriptures.json";
import { Mark, MarkColor, COLORS, COLOR_MAP } from "../types";

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
  onClose: () => void;
}

type Mode = "all" | "any" | "phrase";
type Source = "scripture" | "marks" | "themes";
type Scope = "all" | "volume" | "book";

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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Turn a search term into a regex source, honoring the * wildcard.
// "merc*" -> "\bmerc\w*" ; plain words are escaped literally.
const wildcardSource = (term: string) =>
  "\\b" + escapeRe(term).replace(/\\\*/g, "\\w*");

export default function SearchPanel(props: SearchPanelProps) {
  const {
    currentVolume,
    currentBook,
    marks,
    colorLabels,
    labelFor,
    allMarks,
    onJump,
    onJumpToMark,
    onOpenNewTab,
    onLinkStudy,
    onClose,
  } = props;

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("phrase");
  const [source, setSource] = useState<Source>("scripture");
  const [scope, setScope] = useState<Scope>("all");
  const [wholeWord, setWholeWord] = useState(false);
  const [markColor, setMarkColor] = useState<MarkColor | 0>(0);
  const [showLegend, setShowLegend] = useState(false);
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
  const [committed, setCommitted] = useState<{
    q: string;
    mode: Mode;
    source: Source;
    scope: Scope;
    wholeWord: boolean;
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

  const currentVolName = vols[currentVolume]?.volume || "";
  const currentBookName = vols[currentVolume]?.books[currentBook]?.book || "";

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

    const lower = q.toLowerCase();
    const terms = (lower.includes("&") ? lower.split("&").map((t) => t.trim()) : committed.mode === "phrase" ? [lower] : lower.split(/\s+/))
      .filter(Boolean)
      .filter((t) => t.replace(/\*/g, "").length > 0);

    // Build one tester per term, honoring * wildcards and whole-word mode
    const buildTermTest = (term: string): ((txt: string) => boolean) => {
      if (term.includes("*")) {
        const re = new RegExp(wildcardSource(term), "i");
        return (txt) => re.test(txt);
      }
      if (committed.wholeWord) {
        const re = new RegExp("\\b" + escapeRe(term) + "\\b");
        return (txt) => re.test(txt);
      }
      return (txt) => txt.includes(term);
    };

    const termTests = terms.map(buildTermTest);
    const test = (txt: string) =>
      !lower.includes("&") && committed.mode === "any"
        ? termTests.some((fn) => fn(txt))
        : termTests.every((fn) => fn(txt));

    const inScope = (e: IndexEntry) =>
      committed.scope === "all"
        ? true
        : committed.scope === "volume"
        ? e.vol === currentVolume
        : e.vol === currentVolume && e.book === currentBook;

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
  }, [committed, index, refLookup, marks, allMarks, currentVolume, currentBook]);

  const renderHighlighted = (text: string, terms: string[]) => {
    if (!terms.length) return text;
    const src = terms
      .map((t) => (t.includes("*") ? wildcardSource(t) : escapeRe(t)))
      .join("|");
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
      scope,
      wholeWord,
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

  return (
    <div
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
              backgroundColor: "var(--text)",
              color: "var(--bg)",
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
          {segGroup(
            <>
              {seg(scope === "all", "All", () => setScope("all"))}
              {seg(
                scope === "volume",
                currentVolName.length > 14
                  ? currentVolName.slice(0, 13) + "…"
                  : currentVolName,
                () => setScope("volume")
              )}
              {seg(
                scope === "book",
                currentBookName.length > 12
                  ? currentBookName.slice(0, 11) + "…"
                  : currentBookName,
                () => setScope("book")
              )}
            </>
          )}
          <button
            onClick={() => setWholeWord((w) => !w)}
            style={{
              padding: "6px 13px",
              borderRadius: "999px",
              border: "1px solid var(--border)",
              cursor: "pointer",
              fontSize: "12.5px",
              backgroundColor: wholeWord ? "var(--soft)" : "transparent",
              color: wholeWord ? "var(--text)" : "var(--muted)",
              fontWeight: wholeWord ? 600 : 400,
            }}
          >
            Whole words
          </button>
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
              Search functions
            </div>
            {legendRow(
              "All words",
              "Every word must appear in the verse (AND). “faith hope” → verses containing both."
            )}
            {legendRow(
              "Any word",
              "At least one word appears (OR). “faith hope” → verses with either."
            )}
            {legendRow(
              "Phrase",
              "The exact phrase, words in order. “charity never faileth”."
            )}
            {legendRow(
              "✲  Wildcard",
              "Put * after a stem to match every word that starts with it. “merc*” → mercy, merciful, mercies. Works on any word, in any mode."
            )}
            {legendRow(
              "Whole words",
              "Match whole words only, so “love” won’t match “glove”. (Wildcards set their own boundaries.)"
            )}
            {legendRow(
              "Scripture / My marks",
              "Search the full text, or only the passages you’ve marked."
            )}
            {legendRow(
              "Scope",
              "Limit to everything, the current volume, or just the current book."
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
              </div>

              {onLinkStudy && selectedRefs.size > 0 && (
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
                  <button
                    onClick={() => {
                      onLinkStudy(Array.from(selectedRefs));
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
                    Link verses into a study
                  </button>
                </div>
              )}
              {shown.map((r, i) => (
                <div
                  key={r.reference + "|" + i}
                  onClick={() =>
                    r.bookId
                      ? onJumpToMark(r.bookId, r.reference)
                      : onJump(r.reference)
                  }
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
                    {onLinkStudy && (
                      <input
                        type="checkbox"
                        checked={selectedRefs.has(r.reference)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() =>
                          setSelectedRefs((prev) => {
                            const n = new Set(prev);
                            if (n.has(r.reference)) n.delete(r.reference);
                            else n.add(r.reference);
                            return n;
                          })
                        }
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
                    <span
                      title="Open here (current tab)"
                      style={{ fontSize: "11px", color: "var(--muted)" }}
                    >
                      ↗
                    </span>
                    <div style={{ flex: 1 }} />
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
