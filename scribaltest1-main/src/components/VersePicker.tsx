import { useMemo, useState } from "react";
import { ACCENT } from "../theme";
import { MarkColor, COLOR_MAP } from "../types";
import { buildSearchMatcher, SearchMode } from "../searchMatch";
import { verseList, sortRefs, isConsecutive } from "../data/verseIndex";
import type { ThemeMark } from "./SearchPanel";

// The docked verse panel for a Study Table. Its search IS the app's search — the
// same shared matcher (searchMatch.ts), the same modes, operators, and legend —
// with the same Scripture / My marks / Themes sources. On top of that it adds
// the table-specific bit: choose WHICH of your books a verse's marks come from
// (or none), preview those themes, then drop the verses in as scripture cards.

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF =
  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif';

type Source = "scripture" | "marks" | "themes";

interface BookMeta {
  id: string;
  name: string;
  isMaster: boolean;
  markCount: number;
}

interface Props {
  // Insert the chosen verses as scripture cards, pulling marks from `bookId`
  // (undefined = an empty, unmarked verse). asPassage groups consecutive verses
  // into one card.
  onAdd: (refs: string[], asPassage: boolean, bookId?: string) => void;
  // Render one verse's text + the marks from a given book (undefined = no marks).
  renderVerse: (reference: string, bookId?: string) => React.ReactNode;
  allMarks: ThemeMark[];
  books: BookMeta[];
  onClose: () => void;
  accent?: string;
  headerOffset?: number;
}

function hexToRgba(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
}

// One-time lowercased scripture text, so live matching stays fast over the whole
// library (matches the app's own indexed search).
const lowerText: string[] = verseList.map((v) => v.text.toLowerCase());

const RESULT_CAP = 50;

function Ico({ d, size = 15 }: { d: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block" }}
    >
      {d.split(" M").map((seg, i) => (
        <path key={i} d={i === 0 ? seg : "M" + seg} />
      ))}
    </svg>
  );
}

export default function VersePicker({
  onAdd,
  renderVerse,
  allMarks,
  books,
  onClose,
  accent = ACCENT,
  headerOffset = 76,
}: Props) {
  const [tab, setTab] = useState<"study" | "search">("search");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("phrase");
  const [source, setSource] = useState<Source>("scripture");
  const [sourceBookId, setSourceBookId] = useState<string>("master");
  const [selected, setSelected] = useState<string[]>([]);
  const [asPassage, setAsPassage] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  const softAccent = hexToRgba(accent, 0.1);

  // All marks grouped by reference, so per-verse theme previews are O(1).
  const marksByRef = useMemo(() => {
    const m = new Map<string, ThemeMark[]>();
    for (const tm of allMarks) {
      const a = m.get(tm.reference);
      if (a) a.push(tm);
      else m.set(tm.reference, [tm]);
    }
    return m;
  }, [allMarks]);

  // Books offered as a marks source: Master (always), plus any session that has
  // marks. "" means pull an empty verse.
  const markSourceBooks = useMemo(() => {
    const out: BookMeta[] = [];
    const master = books.find((b) => b.isMaster);
    if (master) out.push(master);
    books.forEach((b) => {
      if (!b.isMaster && b.markCount > 0) out.push(b);
    });
    return out;
  }, [books]);

  // The colors + theme names a verse carries in the chosen source book.
  const previewFor = (ref: string): { color: MarkColor; label: string }[] => {
    if (!sourceBookId) return [];
    const all = marksByRef.get(ref);
    if (!all) return [];
    const seen = new Map<MarkColor, string>();
    for (const m of all) {
      if (m.bookId === sourceBookId && !seen.has(m.color))
        seen.set(m.color, m.label || "");
    }
    return Array.from(seen.entries()).map(([color, label]) => ({ color, label }));
  };

  const results = useMemo(() => {
    const q = query.trim();
    const browseAll = q.length < 2;
    // Scripture-text search needs a query; marks/themes can browse everything.
    if (source === "scripture" && browseAll) return { rows: [] as string[], total: 0 };

    const matcher = browseAll ? null : buildSearchMatcher(q, mode, true);
    const test = matcher ? matcher.test : () => false;

    const rows: string[] = [];
    let total = 0;

    if (source === "scripture") {
      for (let i = 0; i < verseList.length; i++) {
        if (test(lowerText[i])) {
          total++;
          if (rows.length < RESULT_CAP) rows.push(verseList[i].reference);
        }
      }
    } else if (source === "themes") {
      const seen = new Set<string>();
      for (const tm of allMarks) {
        const ok =
          browseAll ||
          test(tm.markedText.toLowerCase()) ||
          test((tm.label || "").toLowerCase());
        if (ok && !seen.has(tm.reference)) {
          seen.add(tm.reference);
          total++;
          if (rows.length < RESULT_CAP) rows.push(tm.reference);
        }
      }
    } else {
      // "marks": only the chosen source book's marks.
      const seen = new Set<string>();
      for (const tm of allMarks) {
        if (tm.bookId !== sourceBookId) continue;
        if ((browseAll || test(tm.markedText.toLowerCase())) && !seen.has(tm.reference)) {
          seen.add(tm.reference);
          total++;
          if (rows.length < RESULT_CAP) rows.push(tm.reference);
        }
      }
    }
    return { rows: sortRefs(rows), total };
  }, [query, mode, source, sourceBookId, allMarks]);

  const toggle = (ref: string) =>
    setSelected((prev) =>
      prev.includes(ref) ? prev.filter((r) => r !== ref) : [...prev, ref]
    );

  const selCount = selected.length;
  const canPassage = selCount > 1 && isConsecutive(selected);

  const doAdd = () => {
    if (selCount === 0) return;
    onAdd(sortRefs(selected), canPassage && asPassage, sourceBookId || undefined);
    setSelected([]);
    setAsPassage(false);
  };

  // ---- small styled bits, matching the app's search chrome ----
  const seg = (on: boolean, label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      style={{
        fontFamily: SANS,
        fontSize: 11.5,
        fontWeight: 600,
        cursor: "pointer",
        color: on ? "#fff" : "var(--muted)",
        background: on ? accent : "transparent",
        border: 0,
        borderRadius: 7,
        padding: "5px 9px",
      }}
    >
      {label}
    </button>
  );
  const segGroup = (children: React.ReactNode) => (
    <div
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 2,
        background: "var(--soft)",
        border: "1px solid var(--border)",
        borderRadius: 9,
      }}
    >
      {children}
    </div>
  );
  const legendRow = (head: string, body: string) => (
    <div style={{ marginBottom: 7 }}>
      <span
        style={{
          fontFamily: SANS,
          fontSize: 12,
          fontWeight: 700,
          color: "var(--text)",
        }}
      >
        {head}
      </span>
      <span style={{ fontFamily: SANS, fontSize: 12, color: "var(--muted)" }}>
        {" — "}
        {body}
      </span>
    </div>
  );

  return (
    <div
      style={{
        width: 384,
        flex: "0 0 auto",
        position: "sticky",
        top: headerOffset + 14,
        alignSelf: "flex-start",
        maxHeight: "calc(100vh - " + (headerOffset + 34) + "px)",
        display: "flex",
        flexDirection: "column",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      {/* header + tabs */}
      <div style={{ padding: "12px 12px 0", flex: "0 0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <span
            style={{
              fontFamily: SERIF,
              fontSize: 16,
              fontWeight: 600,
              color: "var(--text)",
              flex: 1,
            }}
          >
            Verses
          </span>
          <button
            onClick={onClose}
            title="Close the verse panel"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--panel)",
              color: "var(--muted)",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              lineHeight: 0,
            }}
          >
            <Ico d="M18 6 6 18 M6 6l12 12" size={14} />
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {([
            ["study", "From a study"],
            ["search", "Search"],
          ] as const).map(([key, label]) => {
            const on = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                style={{
                  flex: 1,
                  fontFamily: SANS,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  color: on ? accent : "var(--muted)",
                  background: on ? softAccent : "transparent",
                  border: "1px solid " + (on ? accent : "var(--border)"),
                  borderRadius: 999,
                  padding: "7px 0",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "study" ? (
        <div
          style={{
            padding: "24px 18px 28px",
            fontFamily: SANS,
            fontSize: 13,
            lineHeight: 1.6,
            color: "var(--muted)",
            textAlign: "center",
          }}
        >
          Pulling verses grouped under your own themes is coming next. For now,
          use <strong style={{ color: "var(--text)" }}>Search</strong> — the same
          search as the reader, including your marks and themes.
        </div>
      ) : (
        <>
          {/* search box */}
          <div style={{ padding: "0 12px 8px", flex: "0 0 auto" }}>
            <div style={{ position: "relative" }}>
              <span
                style={{
                  position: "absolute",
                  left: 11,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--muted)",
                  lineHeight: 0,
                }}
              >
                <Ico d="M11 4a7 7 0 100 14 7 7 0 000-14z M20 20l-3.5-3.5" size={15} />
              </span>
              <input
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a word, phrase, or theme…  (try merc*)"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  height: 38,
                  padding: "0 12px 0 34px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--soft)",
                  color: "var(--text)",
                  fontFamily: SANS,
                  fontSize: 14,
                  outline: "none",
                }}
              />
            </div>
          </div>

          {/* options: mode + source + legend */}
          <div
            style={{
              padding: "0 12px 8px",
              flex: "0 0 auto",
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {segGroup(
              <>
                {seg(mode === "all", "All", () => setMode("all"))}
                {seg(mode === "any", "Any", () => setMode("any"))}
                {seg(mode === "phrase", "Phrase", () => setMode("phrase"))}
              </>
            )}
            {segGroup(
              <>
                {seg(source === "scripture", "Scripture", () => setSource("scripture"))}
                {seg(source === "marks", "My marks", () => setSource("marks"))}
                {seg(source === "themes", "Themes", () => setSource("themes"))}
              </>
            )}
            <button
              onClick={() => setShowLegend((s) => !s)}
              title="What can I search?"
              style={{
                fontFamily: SANS,
                fontSize: 12,
                fontWeight: showLegend ? 600 : 500,
                cursor: "pointer",
                color: showLegend ? "var(--text)" : "var(--muted)",
                background: showLegend ? "var(--soft)" : "transparent",
                border: "1px solid var(--border)",
                borderRadius: 999,
                padding: "5px 11px",
              }}
            >
              ? Legend
            </button>
          </div>

          {/* legend */}
          {showLegend && (
            <div
              style={{
                margin: "0 12px 8px",
                padding: "11px 12px",
                borderRadius: 10,
                background: "var(--soft)",
                flex: "0 0 auto",
              }}
            >
              <div
                style={{
                  fontFamily: SANS,
                  fontSize: 10,
                  letterSpacing: "1.5px",
                  textTransform: "uppercase",
                  color: "var(--muted)",
                  marginBottom: 9,
                }}
              >
                How search works
              </div>
              {legendRow(
                "All / Any / Phrase",
                "how plain words combine — every word, any word, or the exact phrase in order."
              )}
              {legendRow("faith & hope", "use & to require all parts.")}
              {legendRow("mercy OR grace", "use OR to match either side.")}
              {legendRow(
                "merc*",
                "a * after a stem matches every word that starts with it → mercy, merciful, mercies."
              )}
              {legendRow(
                "Scripture / My marks",
                "search the full text, or only the passages you’ve marked."
              )}
            </div>
          )}

          {/* marks source */}
          <div
            style={{
              padding: "0 12px 10px",
              flex: "0 0 auto",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                fontFamily: SANS,
                fontSize: 11.5,
                fontWeight: 600,
                color: "var(--muted)",
                flex: "0 0 auto",
              }}
            >
              Marks from
            </span>
            <select
              value={sourceBookId}
              onChange={(e) => setSourceBookId(e.target.value)}
              style={{
                flex: 1,
                minWidth: 0,
                height: 32,
                padding: "0 8px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--soft)",
                color: "var(--text)",
                fontFamily: SANS,
                fontSize: 12.5,
                outline: "none",
              }}
            >
              {markSourceBooks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.isMaster ? "Master" : b.name}
                </option>
              ))}
              <option value="">Empty (no marks)</option>
            </select>
          </div>

          {/* results */}
          <div style={{ flex: 1, overflowY: "auto", padding: "0 4px 8px" }}>
            {source === "scripture" && query.trim().length < 2 ? (
              <div style={hintStyle}>Type at least two letters to search.</div>
            ) : source === "marks" && !sourceBookId ? (
              <div style={hintStyle}>Choose a book above to pull marks from.</div>
            ) : results.rows.length === 0 ? (
              <div style={hintStyle}>
                {query.trim()
                  ? "No verses match “" + query.trim() + "”."
                  : "Nothing to show here yet."}
              </div>
            ) : (
              <>
                {results.rows.map((ref) => {
                  const on = selected.includes(ref);
                  const themes = previewFor(ref);
                  return (
                    <div
                      key={ref}
                      onClick={() => toggle(ref)}
                      style={{
                        display: "flex",
                        gap: 9,
                        alignItems: "flex-start",
                        padding: "9px 8px",
                        borderRadius: 10,
                        cursor: "pointer",
                        background: on ? softAccent : "transparent",
                      }}
                    >
                      <span
                        style={{
                          flex: "0 0 auto",
                          width: 18,
                          height: 18,
                          marginTop: 3,
                          borderRadius: 5,
                          border: "1.5px solid " + (on ? accent : "var(--border)"),
                          background: on ? accent : "transparent",
                          color: "#fff",
                          display: "grid",
                          placeItems: "center",
                          lineHeight: 0,
                        }}
                      >
                        {on && <Ico d="M20 6 9 17l-5-5" size={12} />}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: SANS,
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: ".02em",
                            color: accent,
                            marginBottom: 2,
                          }}
                        >
                          {ref}
                        </div>
                        <div
                          style={{
                            fontFamily: SERIF,
                            fontSize: 14.5,
                            lineHeight: 1.6,
                            color: "var(--text)",
                          }}
                        >
                          {renderVerse(ref, sourceBookId || undefined)}
                        </div>
                        {themes.length > 0 && (
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 6,
                              marginTop: 6,
                            }}
                          >
                            {themes.map((t) => (
                              <span
                                key={t.color}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 5,
                                  fontFamily: SANS,
                                  fontSize: 11,
                                  color: "var(--muted)",
                                }}
                              >
                                <span
                                  style={{
                                    width: 9,
                                    height: 9,
                                    borderRadius: 999,
                                    background: COLOR_MAP[t.color],
                                    flex: "0 0 auto",
                                  }}
                                />
                                {t.label || "Unnamed theme"}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {results.total > results.rows.length && (
                  <div style={hintStyle}>
                    Showing the first {results.rows.length} of {results.total}.
                    Refine your search to narrow it.
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* selection footer */}
      {selCount > 0 && (
        <div
          style={{
            flex: "0 0 auto",
            borderTop: "1px solid var(--border)",
            padding: "10px 12px",
            background: "var(--panel)",
          }}
        >
          {canPassage && (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 9,
                fontFamily: SANS,
                fontSize: 12.5,
                color: "var(--muted)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={asPassage}
                onChange={(e) => setAsPassage(e.target.checked)}
              />
              Add as one passage
            </label>
          )}
          <button
            onClick={doAdd}
            style={{
              width: "100%",
              fontFamily: SANS,
              fontSize: 13.5,
              fontWeight: 650,
              color: "#fff",
              background: accent,
              border: 0,
              borderRadius: 10,
              padding: "10px 0",
              cursor: "pointer",
            }}
          >
            Add {selCount} {selCount === 1 ? "verse" : "verses"}
            {sourceBookId ? "" : " (empty)"}
          </button>
        </div>
      )}
    </div>
  );
}

const hintStyle: React.CSSProperties = {
  padding: "18px 14px",
  fontFamily: SANS,
  fontSize: 12.5,
  lineHeight: 1.5,
  color: "var(--muted)",
  textAlign: "center",
};
