import { useEffect, useState } from "react";
import { WordTag } from "../types";
import { loadWebster, definitionForKey, isLoaded } from "../webster";

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
}

interface Entry {
  key: string;
  headword: string;
  definition: string;
  refs: string[];
}

// A glossary of the words the reader tagged within a compiled study, gathered
// at the bottom of the study. It only organizes — it pulls the 1828 entry for
// each tagged word and lists it; it never interprets or summarizes.
export default function WordStudies({
  tags,
  colors,
  heading = "Word Studies",
}: WordStudiesProps) {
  const [ready, setReady] = useState(isLoaded);
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
    } else {
      const headword = t.word
        ? t.word.charAt(0).toUpperCase() + t.word.slice(1)
        : t.dictKey;
      byKey.set(t.dictKey, {
        key: t.dictKey,
        headword,
        definition: def,
        refs: [t.reference],
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
      {entries.map((e) => (
        <div key={e.key} style={{ marginBottom: "14px" }}>
          <div
            style={{
              fontSize: "15px",
              fontWeight: 700,
              color: colors.text,
              marginBottom: "3px",
            }}
          >
            {e.headword}
          </div>
          <div
            style={{
              fontSize: "14px",
              lineHeight: 1.5,
              color: colors.text,
              whiteSpace: "pre-wrap",
            }}
          >
            {e.definition}
          </div>
        </div>
      ))}
    </div>
  );
}
