import { useEffect, useMemo, useState } from "react";
import scriptures from "./data/scriptures.json";
import { Mark, COLOR_MAP } from "./types";

const vols = scriptures.volumes;

interface Palette {
  bg: string;
  panel: string;
  soft: string;
  text: string;
  muted: string;
  border: string;
}

interface Props {
  C: Palette;
  marks: Mark[];
  colorLabels: Record<number, string>;
  orderOf: (ref: string) => number;
  onJump: (ref: string) => void; // marks results jump directly
  onPickScripture: (ref: string) => void; // scripture results choose a book first
}

const SCRIPTURE_CAP = 120;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wildcardSource = (term: string) =>
  "\\b" + escapeRe(term).replace(/\\\*/g, "\\w*");
// A plain term matches a WHOLE WORD (\bif\b), so "if" no longer hits inside
// "strife" or "fifty". The * wildcard (e.g. if*) is how you match word prefixes.
const termSource = (term: string) =>
  term.includes("*") ? wildcardSource(term) : "\\b" + escapeRe(term) + "\\b";

type TermTest = (txt: string) => boolean;

// Parse a query into OR-groups of AND-terms. Space = AND, "OR" = new group,
// "AND" is explicit, and "*" is a word-wildcard (bapti* -> baptism/baptize).
function buildMatcher(
  query: string
): { test: (t: string) => boolean; terms: string[] } | null {
  const lower = query.trim().toLowerCase();
  if (!lower) return null;
  const allTerms: string[] = [];
  const orGroups = lower
    .split(/\s+or\s+/i)
    .map((g) => g.trim())
    .filter(Boolean);
  const groups = orGroups
    .map((g) => {
      const cleaned = g.replace(/\s+and\s+/gi, " ");
      const terms = cleaned
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.replace(/\*/g, "").length > 0);
      terms.forEach((t) => allTerms.push(t));
      return terms.map((term): TermTest => {
        let re: RegExp;
        try {
          re = new RegExp(termSource(term), "i");
        } catch {
          return () => false;
        }
        return (txt) => re.test(txt);
      });
    })
    .filter((g) => g.length > 0);
  if (!groups.length) return null;
  return {
    test: (txt) => groups.some((group) => group.every((fn) => fn(txt))),
    terms: allTerms,
  };
}

function highlight(text: string, terms: string[], hlColor: string) {
  if (!terms.length) return text;
  // Highlight WHOLE WORDS only (same rule as the matcher), so "if" doesn't get
  // lit up inside "strife" or "fifty". termSource adds the \b word boundaries
  // for plain terms and expands * into a word-wildcard.
  const src = terms.map((t) => termSource(t)).join("|");
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
  C,
  marks,
  colorLabels,
  orderOf,
  onJump,
  onPickScripture,
}: Props) {
  const [mode, setMode] = useState<"scripture" | "marks">("scripture");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [volIdx, setVolIdx] = useState(-1); // -1 = all volumes
  const [bookIdx, setBookIdx] = useState(-1); // -1 = all books

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  const matcher = useMemo(() => buildMatcher(debounced), [debounced]);
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
  }, [mode, matcher, volIdx, bookIdx]);

  const markResults = useMemo(() => {
    if (mode !== "marks" || !matcher) return [];
    return marks
      .filter(
        (m) =>
          matcher.test(m.markedText.toLowerCase()) ||
          matcher.test((colorLabels[m.color] || "").toLowerCase())
      )
      .sort((a, b) => orderOf(a.reference) - orderOf(b.reference));
  }, [mode, matcher, marks, colorLabels, orderOf]);

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
    theme?: string
  ) => (
    <button
      key={key}
      onClick={onClick}
      style={{
        textAlign: "left",
        background: C.soft,
        border: "1px solid " + C.border,
        borderRadius: "10px",
        padding: "11px 13px",
        cursor: "pointer",
        color: C.text,
        fontFamily: "inherit",
        width: "100%",
      }}
    >
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
                    () => onPickScripture(r.reference)
                  )
                )
              : markResults.map((m) =>
                  resultBtn(
                    m.id,
                    m.reference,
                    highlight(m.markedText, terms, COLOR_MAP[3]),
                    () => onJump(m.reference),
                    COLOR_MAP[m.color],
                    (colorLabels[m.color] || "").trim() || undefined
                  )
                )}
          </div>
        </>
      )}
    </div>
  );
}
