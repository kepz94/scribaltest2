import { useEffect, useState } from "react";
import { WordTag } from "../types";
import { loadWebster, definitionForKey, isLoaded, sensesFor } from "../webster";

interface WordStudiesColors {
  text: string;
  muted: string;
  border: string;
  soft: string;
}

interface WordStudiesProps {
  // Tags already scoped to the compiled study by the caller.
  tags: WordTag[];
  colors: WordStudiesColors;
  // Heading override; defaults to "Word Studies".
  heading?: string;
  // Render complete entries with no expanders — for print/PDF, where there is
  // nothing to tap and the exported study should carry the whole entry.
  full?: boolean;
}

interface Entry {
  key: string;
  headword: string;
  definition: string;
  refs: string[];
  // The senses the reader chose for this word, pooled across every verse it was
  // tagged in. Empty means they never chose, and the entry shows the compact
  // form it always has.
  chosen: number[];
}

// Webster entries open with a header paragraph ("WILL, noun [etymology]")
// followed by numbered senses as their own paragraphs ("1. …", "2. …").
// Compact = header + the first sense; the rest stay behind the expander. The
// system never judges which senses are "relevant" (Monastic rule) — it just
// shows the first and lets the reader open the rest.
function splitEntry(def: string): {
  compact: string;
  senseCount: number;
  hasMore: boolean;
} {
  const paras = def.split(/\n\s*\n/).filter((p) => p.trim());
  const senseIdx = paras.findIndex((p) => /^\s*1\.\s/.test(p));
  const compactParas =
    senseIdx >= 0
      ? paras.slice(0, senseIdx + 1)
      : paras.slice(0, Math.min(2, paras.length));
  const compact = compactParas.join("\n\n");
  const senseCount = paras.filter((p) => /^\s*\d+\.\s/.test(p)).length;
  return {
    compact,
    senseCount,
    hasMore: compact.trim().length < def.trim().length,
  };
}

// A glossary of the words the reader tagged within a compiled study, gathered
// at the bottom of the study. It only organizes — it pulls the 1828 entry for
// each tagged word and lists it; it never interprets or summarizes. Entries
// render compact (headword + first sense) with a per-word expander (SCR-13);
// print passes `full` for complete entries.
export default function WordStudies({
  tags,
  colors,
  heading = "Word Studies",
  full = false,
}: WordStudiesProps) {
  const [ready, setReady] = useState(isLoaded);
  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let alive = true;
    loadWebster().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // One entry per dictionary lemma, even when the same word was tagged in
  // several verses. The headword shown is the form the reader first tagged.
  const byKey = new Map<string, Entry>();
  tags.forEach((t) => {
    const def = ready ? definitionForKey(t.dictKey) || "" : "";
    if (ready && !def) return; // no entry — nothing to study
    const existing = byKey.get(t.dictKey);
    if (existing) {
      if (!existing.refs.includes(t.reference)) existing.refs.push(t.reference);
      (t.senses || []).forEach((n) => {
        if (!existing.chosen.includes(n)) existing.chosen.push(n);
      });
    } else {
      const headword = t.word
        ? t.word.charAt(0).toUpperCase() + t.word.slice(1)
        : t.dictKey;
      byKey.set(t.dictKey, {
        key: t.dictKey,
        headword,
        definition: def,
        refs: [t.reference],
        chosen: (t.senses || []).slice(),
      });
    }
  });
  const entries = Array.from(byKey.values()).sort((a, b) =>
    a.headword.localeCompare(b.headword)
  );

  if (tags.length === 0) return null;
  if (!ready) {
    return (
      <div style={{ fontSize: "13px", color: colors.muted, padding: "12px 0" }}>
        Loading word studies…
      </div>
    );
  }
  if (entries.length === 0) return null;

  return (
    <div
      style={{
        marginTop: "8px",
        borderTop: "1px solid " + colors.border,
        paddingTop: "16px",
      }}
    >
      <div
        style={{
          fontSize: "12px",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: colors.muted,
          marginBottom: "12px",
        }}
      >
        {heading}
      </div>
      {entries.map((e) => {
        const { compact, senseCount, hasMore } = splitEntry(e.definition);
        // The senses this reader chose lead the entry. Absent a choice it falls
        // back to the compact form (header + sense 1) exactly as before.
        const picked = sensesFor(e.definition, e.chosen);
        const open = full || !!openKeys[e.key] || !hasMore;
        return (
          <div key={e.key} style={{ marginBottom: "14px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "10px",
                marginBottom: "3px",
              }}
            >
              <div
                style={{
                  fontSize: "15px",
                  fontWeight: 700,
                  color: colors.text,
                }}
              >
                {e.headword}
              </div>
              <div style={{ fontSize: "11.5px", color: colors.muted }}>
                {e.refs.join(" · ")}
              </div>
            </div>
            {picked.length > 0 && !open ? (
              <div
                style={{
                  fontSize: "14px",
                  lineHeight: 1.5,
                  color: colors.text,
                  whiteSpace: "pre-wrap",
                }}
              >
                {picked.map((s) => (
                  <div key={s.n} style={{ marginBottom: "5px" }}>
                    {s.text}
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  fontSize: "14px",
                  lineHeight: 1.5,
                  color: colors.text,
                  whiteSpace: "pre-wrap",
                }}
              >
                {open ? e.definition : compact}
              </div>
            )}
            {!full && hasMore && (
              <button
                onClick={() =>
                  setOpenKeys((prev) => ({ ...prev, [e.key]: !prev[e.key] }))
                }
                style={{
                  marginTop: "5px",
                  background: "transparent",
                  border: "1px solid " + colors.border,
                  borderRadius: "999px",
                  padding: "4px 12px",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  color: colors.muted,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {open
                  ? "Show less"
                  : senseCount > 1
                  ? "Full entry — " + senseCount + " senses"
                  : "Full entry"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
