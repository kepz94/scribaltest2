import { useEffect, useMemo, useState } from "react";
import { getScriptures, volumesProxy } from "./data/scripturesStore";
import { Mark, COLOR_MAP } from "./types";
import { buildSearchMatcher, SearchMode } from "./searchMatch";

const vols = volumesProxy;

const ACCENT = "#8b5cf6";

interface Palette {
  bg: string;
  panel: string;
  soft: string;
  text: string;
  muted: string;
  border: string;
}

interface Props {
  // The chapter open behind the search (e.g. "1 Nephi 3") — enables the
  // "This chapter" chip for find-on-this-page searches.
  currentChapter?: string;
  C: Palette;
  marks: Mark[];
  // Resolves a mark's theme name the same way the rest of the app does
  // (chapter-scoped name, not the book-wide color label), so search reflects
  // the actual name shown when viewing that mark's chapter/study.
  markLabel: (m: Mark) => string;
  orderOf: (ref: string) => number;
  onJump: (ref: string) => void; // marks results jump directly
  onPickScripture: (ref: string) => void; // scripture results choose a book first
  // When provided, a "Link" button lets the user multi-select scripture results
  // and bundle them into one study; called with the chosen verse references.
  onLinkConfirm?: (refs: string[], label?: string) => void;
  // Adding verses to an existing keyword study: start already in link mode with
  // the study's current verses pre-selected, and relabel the confirm button.
  initialPicked?: string[];
  startLinking?: boolean;
  confirmLabel?: string;
  // When adding to an existing study, the link bar offers update-vs-new-copy.
  addToStudyName?: string;
  onAddToStudy?: (refs: string[], mode: "update" | "copy") => void;
  // Adding loose verses to a recorded chapter/linked study: a single "add"
  // button — the selection is the full new set (so it adds and removes).
  addVersesName?: string;
  onAddVerses?: (refs: string[]) => void;
}

const SCRIPTURE_CAP = 120;

function highlight(text: string, terms: string[], hlColor: string) {
  if (!terms.length) return text;
  // Highlight the matched phrase(s). The strings passed in are already regex
  // sources from buildSearchMatcher, so use them directly.
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
      <strong key={i} style={{ color: hlColor, fontWeight: 700 }}>
        {p}
      </strong>
    ) : (
      p
    )
  );
}

export default function MobileSearch({
  currentChapter,
  C,
  marks,
  markLabel,
  orderOf,
  onJump,
  onPickScripture,
  onLinkConfirm,
  initialPicked,
  startLinking,
  confirmLabel,
  addToStudyName,
  onAddToStudy,
  addVersesName,
  onAddVerses,
}: Props) {
  const [mode, setMode] = useState<"scripture" | "marks">("scripture");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [volIdx, setVolIdx] = useState(-1); // -1 = all volumes
  const [chapterOnly, setChapterOnly] = useState(false);
  const [bookIdx, setBookIdx] = useState(-1); // -1 = all books
  // Search-match controls, shared with the desktop search via one engine.
  // matchMode = how plain words combine. Whole-word matching is always on
  // ("love" never matches "beloved").
  const [matchMode, setMatchMode] = useState<SearchMode>("phrase");
  const [showLegend, setShowLegend] = useState(false);
  // Link-select: tick scripture results to bundle them into one study.
  const [linkMode, setLinkMode] = useState(!!startLinking);
  const [picked, setPicked] = useState<string[]>(() => initialPicked || []);
  const togglePick = (ref: string) =>
    setPicked((p) =>
      p.includes(ref) ? p.filter((x) => x !== ref) : [...p, ref]
    );

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  const matcher = useMemo(
    () => buildSearchMatcher(debounced, matchMode, true),
    [debounced, matchMode]
  );
  const terms = matcher ? matcher.terms : [];

  const scriptureResults = useMemo(() => {
    if (mode !== "scripture" || !matcher) return [];
    const out: { reference: string; text: string }[] = [];
    let done = false;
    for (let vi = 0; vi < vols.length && !done; vi++) {
      if (volIdx >= 0 && vi !== volIdx) continue;
      const vol = vols[vi];
      for (let bi = 0; bi < vol.books.length && !done; bi++) {
        if (volIdx >= 0 && bookIdx >= 0 && bi !== bookIdx) continue;
        const bk = vol.books[bi];
        for (let ci = 0; ci < bk.chapters.length && !done; ci++) {
          const verses = bk.chapters[ci].verses as any[];
          for (let vj = 0; vj < verses.length; vj++) {
            const v = verses[vj];
            if (
              chapterOnly &&
              currentChapter &&
              !String(v.reference).startsWith(currentChapter + ":")
            )
              continue;
            if (matcher.test(v.text.toLowerCase())) {
              out.push({ reference: v.reference, text: v.text });
              if (out.length >= SCRIPTURE_CAP) {
                done = true;
                break;
              }
            }
          }
        }
      }
    }
    return out;
  }, [mode, matcher, volIdx, bookIdx, chapterOnly, currentChapter]);

  const markResults = useMemo(() => {
    if (mode !== "marks" || !matcher) return [];
    return marks
      .filter(
        (m) =>
          matcher.test(m.markedText.toLowerCase()) ||
          matcher.test(markLabel(m).toLowerCase())
      )
      .sort((a, b) => orderOf(a.reference) - orderOf(b.reference));
  }, [mode, matcher, marks, markLabel, orderOf]);

  const seg = (active: boolean, label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "9px 0",
        border: "none",
        borderRadius: "8px",
        fontSize: "13px",
        fontWeight: active ? 600 : 400,
        backgroundColor: active ? C.text : "transparent",
        color: active ? C.bg : C.muted,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );

  const legendRow = (label: string, desc: string) => (
    <div style={{ marginBottom: "8px" }}>
      <span style={{ fontWeight: 700 }}>{label}</span>
      <span style={{ color: C.muted }}>{" — " + desc}</span>
    </div>
  );

  const selStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: "10px",
    fontSize: "16px",
    borderRadius: "10px",
    border: "1px solid " + C.border,
    backgroundColor: C.bg,
    color: C.text,
    fontFamily: "inherit",
  };

  const resultBtn = (
    key: string,
    reference: string,
    body: React.ReactNode,
    onClick: () => void,
    dotColor?: string,
    theme?: string,
    checked: boolean | null = null
  ) => (
    <button
      key={key}
      onClick={onClick}
      style={{
        textAlign: "left",
        background: checked ? C.panel : C.soft,
        border: "1px solid " + (checked ? COLOR_MAP[3] : C.border),
        borderRadius: "10px",
        padding: "11px 13px",
        cursor: "pointer",
        color: C.text,
        fontFamily: "inherit",
        width: "100%",
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
      }}
    >
      {checked != null && (
        <span
          style={{
            width: "20px",
            height: "20px",
            borderRadius: "6px",
            border: "2px solid " + (checked ? COLOR_MAP[3] : C.muted),
            background: checked ? COLOR_MAP[3] : "transparent",
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "13px",
            flexShrink: 0,
            marginTop: "1px",
          }}
        >
          {checked ? "✓" : ""}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "7px",
            marginBottom: "5px",
          }}
        >
          {dotColor && (
            <span
              style={{
                width: "11px",
                height: "11px",
                borderRadius: "50%",
                backgroundColor: dotColor,
                flexShrink: 0,
              }}
            />
          )}
          <span style={{ fontSize: "11px", color: C.muted }}>{reference}</span>
          {theme && (
            <span style={{ fontSize: "11px", color: C.muted }}>· {theme}</span>
          )}
        </div>
        <div
          style={{
            fontFamily: '"Times New Roman", Times, serif',
            fontSize: "15px",
            lineHeight: 1.5,
          }}
        >
          {body}
        </div>
      </div>
    </button>
  );

  const count =
    mode === "scripture" ? scriptureResults.length : markResults.length;
  const tooShort = !matcher;

  return (
    <div>
      <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px" }}>
        Search
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={
          mode === "scripture" ? "Search scripture…" : "Search your marks…"
        }
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
          marginBottom: "6px",
        }}
      />
      <div style={{ fontSize: "11px", color: C.muted, marginBottom: "12px" }}>
        Use <b>AND</b>, <b>OR</b>, and <b>*</b> — e.g. <i>faith OR hope</i>,{" "}
        <i>bapti*</i>, <i>love AND neighbor</i>.
      </div>

      <div
        style={{
          display: "flex",
          gap: "4px",
          backgroundColor: C.soft,
          borderRadius: "10px",
          padding: "4px",
          marginBottom: "12px",
        }}
      >
        {seg(mode === "scripture", "Scripture", () => setMode("scripture"))}
        {seg(mode === "marks", "My marks", () => setMode("marks"))}
      </div>

      {/* Match mode — shared with desktop: how the plain words combine */}
      <div
        style={{
          display: "flex",
          gap: "4px",
          backgroundColor: C.soft,
          borderRadius: "10px",
          padding: "4px",
          marginBottom: "12px",
        }}
      >
        {seg(matchMode === "all", "All words", () => setMatchMode("all"))}
        {seg(matchMode === "any", "Any word", () => setMatchMode("any"))}
        {seg(matchMode === "phrase", "Phrase", () => setMatchMode("phrase"))}
      </div>

      {mode === "scripture" && currentChapter && (
        <button
          onClick={() => setChapterOnly((v) => !v)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "10px",
            minHeight: "40px",
            padding: "8px 14px",
            borderRadius: "999px",
            border: "1.5px solid " + (chapterOnly ? ACCENT : C.border),
            background: chapterOnly ? ACCENT + "1a" : "transparent",
            color: chapterOnly ? ACCENT : C.muted,
            fontSize: "13px",
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {chapterOnly ? "✓ " : ""}Only {currentChapter}
        </button>
      )}
      {mode === "scripture" && (
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          <select
            value={volIdx}
            onChange={(e) => {
              setVolIdx(Number(e.target.value));
              setBookIdx(-1);
            }}
            style={selStyle}
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
            >
              <option value={-1}>All books</option>
              {vols[volIdx].books.map((bk, i) => (
                <option key={i} value={i}>
                  {bk.book}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Legend — shared control with the desktop search */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
        <button
          onClick={() => setShowLegend((v) => !v)}
          style={{
            flex: 1,
            padding: "9px",
            borderRadius: "10px",
            border: "1px solid " + C.border,
            backgroundColor: showLegend ? C.soft : "transparent",
            color: showLegend ? C.text : C.muted,
            fontFamily: "inherit",
            fontSize: "13px",
            fontWeight: showLegend ? 600 : 400,
            cursor: "pointer",
          }}
        >
          ? Legend
        </button>
      </div>
      {showLegend && (
        <div
          style={{
            padding: "12px 14px",
            marginBottom: "14px",
            borderRadius: "10px",
            border: "1px solid " + C.border,
            backgroundColor: C.soft,
            fontSize: "12.5px",
            color: C.text,
            lineHeight: 1.5,
          }}
        >
          <div
            style={{
              fontSize: "10px",
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              color: C.muted,
              marginBottom: "8px",
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
        </div>
      )}

      {mode === "scripture" && onLinkConfirm && !startLinking && (
        <button
          onClick={() => {
            if (linkMode) {
              setLinkMode(false);
              setPicked([]);
            } else setLinkMode(true);
          }}
          style={{
            width: "100%",
            padding: "11px",
            marginBottom: "14px",
            borderRadius: "10px",
            border: "1px solid " + (linkMode ? COLOR_MAP[3] : C.border),
            background: linkMode ? C.panel : C.soft,
            color: linkMode ? COLOR_MAP[3] : C.text,
            fontFamily: "inherit",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {linkMode ? (
            "Cancel selection"
          ) : (
            <span
              style={{
                display: "inline-flex",
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
                stroke="#0d9488"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
                <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
              </svg>
              Link verses into a study
            </span>
          )}
        </button>
      )}

      {tooShort ? (
        <div style={{ fontSize: "13px", color: C.muted }}>
          Type to search scripture and your marks.
        </div>
      ) : count === 0 ? (
        <div style={{ fontSize: "13px", color: C.muted }}>No matches.</div>
      ) : (
        <>
          <div
            style={{ fontSize: "11px", color: C.muted, marginBottom: "10px" }}
          >
            {count}
            {count === SCRIPTURE_CAP ? "+" : ""} result
            {count === 1 ? "" : "s"}
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "8px" }}
          >
            {mode === "scripture"
              ? scriptureResults.map((r) =>
                  resultBtn(
                    r.reference,
                    r.reference,
                    highlight(r.text, terms, COLOR_MAP[3]),
                    () =>
                      linkMode
                        ? togglePick(r.reference)
                        : onPickScripture(r.reference),
                    undefined,
                    undefined,
                    linkMode ? picked.includes(r.reference) : null
                  )
                )
              : markResults.map((m) =>
                  resultBtn(
                    m.id,
                    m.reference,
                    highlight(m.markedText, terms, COLOR_MAP[3]),
                    () => onJump(m.reference),
                    COLOR_MAP[m.color],
                    markLabel(m).trim() || undefined
                  )
                )}
          </div>
        </>
      )}

      {linkMode && (onLinkConfirm || onAddToStudy || onAddVerses) && (
        <>
          <div style={{ height: "84px" }} />
          <div
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 210,
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "12px 16px calc(14px + env(safe-area-inset-bottom))",
              background: C.panel,
              borderTop: "1px solid " + C.border,
            }}
          >
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: "12.5px",
                color: C.muted,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {picked.length} selected
            </span>
            {onAddToStudy && addToStudyName ? (
              <>
                <button
                  onClick={() => picked.length && onAddToStudy(picked, "update")}
                  disabled={!picked.length}
                  style={{
                    flexShrink: 0,
                    background: picked.length ? C.text : C.soft,
                    color: picked.length ? C.bg : C.muted,
                    border: "none",
                    borderRadius: "999px",
                    padding: "10px 16px",
                    fontSize: "12.5px",
                    fontWeight: 700,
                    cursor: picked.length ? "pointer" : "default",
                    fontFamily: "inherit",
                  }}
                >
                  Add to study
                </button>
                <button
                  onClick={() => picked.length && onAddToStudy(picked, "copy")}
                  disabled={!picked.length}
                  style={{
                    flexShrink: 0,
                    background: "transparent",
                    color: C.text,
                    border: "1px solid " + C.border,
                    borderRadius: "999px",
                    padding: "10px 14px",
                    fontSize: "12.5px",
                    fontWeight: 700,
                    cursor: picked.length ? "pointer" : "default",
                    fontFamily: "inherit",
                  }}
                >
                  New copy
                </button>
              </>
            ) : onAddVerses && addVersesName ? (
              <button
                onClick={() => picked.length && onAddVerses(picked)}
                disabled={!picked.length}
                style={{
                  flexShrink: 0,
                  background: picked.length ? C.text : C.soft,
                  color: picked.length ? C.bg : C.muted,
                  border: "none",
                  borderRadius: "999px",
                  padding: "10px 20px",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: picked.length ? "pointer" : "default",
                  fontFamily: "inherit",
                }}
              >
                Add to study
              </button>
            ) : (
              onLinkConfirm && (
                <button
                  onClick={() => picked.length && onLinkConfirm(picked, query)}
                  disabled={!picked.length}
                  style={{
                    flexShrink: 0,
                    background: picked.length ? C.text : C.soft,
                    color: picked.length ? C.bg : C.muted,
                    border: "none",
                    borderRadius: "999px",
                    padding: "10px 20px",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: picked.length ? "pointer" : "default",
                    fontFamily: "inherit",
                  }}
                >
                  {confirmLabel || "Next"}
                </button>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}
