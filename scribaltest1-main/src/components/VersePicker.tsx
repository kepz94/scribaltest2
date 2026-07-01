import { useMemo, useState } from "react";
import { ACCENT } from "../theme";
import { verseList, sortRefs, isConsecutive } from "../data/verseIndex";

// The docked verse panel for a Study Table. Two sources: "From a study"
// (grouped under your themes — arriving next) and "Search" (a flat list across
// all scripture, live now). Every result renders through the parent's
// renderVerse, so a verse shows exactly the marks the reader has on it. Picking
// verses and hitting Add inserts scripture cards into the column.

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF =
  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif';

interface Props {
  // Insert the chosen verses as scripture cards. asPassage groups them into one
  // card (only ever true when the verses are consecutive).
  onAdd: (refs: string[], asPassage: boolean) => void;
  // Render one verse's text + live marks (owned by the parent, which has marks).
  renderVerse: (reference: string) => React.ReactNode;
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

// Build a matcher from the query. Supports the app's asterisk wildcard; falls
// back to an all-words-present match (order-independent).
function makeMatcher(q: string): ((text: string) => boolean) | null {
  const query = q.trim().toLowerCase();
  if (query.length < 2) return null;
  if (query.includes("*")) {
    const esc = query
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    try {
      const re = new RegExp(esc);
      return (t) => re.test(t.toLowerCase());
    } catch {
      return null;
    }
  }
  const words = query.split(/\s+/).filter(Boolean);
  return (t) => {
    const lt = t.toLowerCase();
    return words.every((w) => lt.includes(w));
  };
}

const RESULT_CAP = 60;

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
  onClose,
  accent = ACCENT,
  headerOffset = 76,
}: Props) {
  const [tab, setTab] = useState<"study" | "search">("search");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [asPassage, setAsPassage] = useState(false);

  const results = useMemo(() => {
    const match = makeMatcher(query);
    if (!match) return { rows: [] as string[], total: 0 };
    const hits: string[] = [];
    let total = 0;
    for (const v of verseList) {
      if (match(v.text) || match(v.reference)) {
        total++;
        if (hits.length < RESULT_CAP) hits.push(v.reference);
      }
    }
    return { rows: hits, total };
  }, [query]);

  const toggle = (ref: string) =>
    setSelected((prev) =>
      prev.includes(ref) ? prev.filter((r) => r !== ref) : [...prev, ref]
    );

  const selCount = selected.length;
  const canPassage = selCount > 1 && isConsecutive(selected);

  const doAdd = () => {
    if (selCount === 0) return;
    onAdd(sortRefs(selected), canPassage && asPassage);
    setSelected([]);
    setAsPassage(false);
  };

  const softAccent = hexToRgba(accent, 0.1);

  return (
    <div
      style={{
        width: 360,
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
          use <strong style={{ color: "var(--text)" }}>Search</strong> to find any
          verse across scripture — each one comes in carrying your marks.
        </div>
      ) : (
        <>
          {/* search box */}
          <div style={{ padding: "0 12px 10px", flex: "0 0 auto" }}>
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
                placeholder="Search all scripture… (try faith*)"
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

          {/* results */}
          <div style={{ flex: 1, overflowY: "auto", padding: "0 4px 8px" }}>
            {query.trim().length < 2 ? (
              <div style={hintStyle}>Type at least two letters to search.</div>
            ) : results.rows.length === 0 ? (
              <div style={hintStyle}>No verses match “{query.trim()}”.</div>
            ) : (
              <>
                {results.rows.map((ref) => {
                  const on = selected.includes(ref);
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
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontFamily: SERIF,
                          fontSize: 14.5,
                          lineHeight: 1.6,
                          color: "var(--text)",
                        }}
                      >
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
                        {renderVerse(ref)}
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
