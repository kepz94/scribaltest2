import React, { useEffect, useState } from "react";
import { Mark, WordTag, markStyleCSS, STYLE_POINTS } from "../types";
import { definitionForKey, sensesFor, isLoaded, loadWebster } from "../webster";

// Glosses need the dictionary, and a verse can render in surfaces that never
// load it (the reader before Define is armed, study tables, a compile view).
// Fetch once for the whole app, then wake every waiting verse. Only verses that
// actually carry a chosen sense ever ask, so nothing pays for this by default.
const dictWaiters = new Set<() => void>();
let dictRequested = false;
function whenDictReady(cb: () => void): () => void {
  dictWaiters.add(cb);
  if (!dictRequested) {
    dictRequested = true;
    loadWebster().then(() => {
      const waiting = Array.from(dictWaiters);
      dictWaiters.clear();
      waiting.forEach((f) => f());
    });
  }
  return () => dictWaiters.delete(cb);
}

// The established "definition" accent — the same family as the footnote dagger.
const DEF_ACCENT = "#9a7b4f";

// The glosses a verse carries: for each tagged word, the senses its reader
// chose. A tag with no chosen senses contributes nothing — choosing is opt-in,
// and a verse without choices looks exactly as it always has.
export function glossesFor(
  verseTags: WordTag[]
): { word: string; n: number; text: string }[] {
  const out: { word: string; n: number; text: string }[] = [];
  verseTags.forEach((t) => {
    if (!t.senses || t.senses.length === 0) return;
    const def = definitionForKey(t.dictKey);
    if (!def) return; // dictionary not loaded yet, or the key is gone
    const word = t.word ? t.word.charAt(0).toUpperCase() + t.word.slice(1) : t.dictKey;
    sensesFor(def, t.senses).forEach((s) =>
      // Strip the leading "N. " — the number is rendered as its own element.
      out.push({ word, n: s.n, text: s.text.replace(/^\s*\d+\.\s*/, "") })
    );
  });
  return out;
}

interface MarkedVerseProps {
  reference: string;
  verseNumber: number;
  text: string;
  marks: Mark[];
  onEraseMark?: (markId: string) => void;
  dark?: boolean;
  tags?: WordTag[];
  onTagTap?: (tag: WordTag) => void;
  // Pre-resolved definitions, for surfaces that cannot look anything up — a
  // Present-room follower has the room doc and no dictionary. When supplied
  // these are used verbatim instead of resolving the tags.
  glosses?: { word: string; n: number; text: string }[];
}

export default function MarkedVerse({
  reference,
  verseNumber,
  text,
  marks,
  onEraseMark,
  dark = false,
  tags,
  onTagTap,
  glosses: givenGlosses,
}: MarkedVerseProps) {
  const verseMarks = marks.filter((m) => m.reference === reference);
  const verseTags = (tags || []).filter((t) => t.reference === reference);
  const wantsGloss =
    !givenGlosses && verseTags.some((t) => t.senses && t.senses.length > 0);
  const [, bumpDict] = useState(0);
  useEffect(() => {
    if (!wantsGloss || isLoaded()) return;
    return whenDictReady(() => bumpDict((n) => n + 1));
  }, [wantsGloss]);
  const glosses = givenGlosses || (wantsGloss ? glossesFor(verseTags) : []);

  const boundaries = new Set<number>([0, text.length]);
  verseMarks.forEach((m) => {
    boundaries.add(Math.max(0, Math.min(m.startIndex, text.length)));
    boundaries.add(Math.max(0, Math.min(m.endIndex, text.length)));
  });
  verseTags.forEach((t) => {
    boundaries.add(Math.max(0, Math.min(t.end, text.length)));
  });
  const points = Array.from(boundaries).sort((a, b) => a - b);

  const segments: {
    start: number;
    end: number;
    applicable: Mark[];
  }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const applicable = verseMarks.filter(
      (m) => m.startIndex <= start && m.endIndex >= end
    );
    segments.push({ start, end, applicable });
  }

  return (
    <p data-verse-ref={reference} style={{ marginBottom: "16px" }}>
      <strong
        style={{
          userSelect: "none",
          color: "var(--muted)",
          fontSize: "0.75em",
          marginRight: "10px",
          verticalAlign: "top",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {verseNumber}
      </strong>
      <span data-verse-text>
        {segments.map((seg) => {
          const segText = text.slice(seg.start, seg.end);
          // A footnote marker rides after the word it tags. Its dagger comes
          // from CSS ::after (generated content), so it adds no real text to
          // data-verse-text and never shifts the selection offsets that drive
          // marking and Define.
          const endTag = onTagTap
            ? verseTags.find((t) => t.end === seg.end)
            : undefined;
          const marker = endTag ? (
            <sup
              className="wordtag-marker"
              style={{ color: dark ? "#cbb892" : "#9a7b4f" }}
              title="Word study — click for the 1828 definition"
              onClick={(e) => {
                e.stopPropagation();
                if (onTagTap) onTagTap(endTag);
              }}
            />
          ) : null;

          let body: React.ReactNode = segText;
          if (seg.applicable.length > 0) {
            // Layer every mark covering this slice so a highlight + underline
            // (etc.) are all visible, instead of only the first one.
            const ordered = [...seg.applicable].sort(
              (a, b) => STYLE_POINTS[a.style] - STYLE_POINTS[b.style]
            );
            const style: React.CSSProperties = {};
            ordered.forEach((m) =>
              Object.assign(style, markStyleCSS(m.style, m.color))
            );

            // The most recently added mark on this slice is the erase target.
            const pickMark = seg.applicable[seg.applicable.length - 1];
            if (onEraseMark) {
              style.cursor = "pointer";
            }

            body = (
              <span
                data-mc={pickMark.color}
                style={style}
                title={onEraseMark ? "Click to erase this mark" : undefined}
                onClick={
                  onEraseMark ? () => onEraseMark(pickMark.id) : undefined
                }
              >
                {segText}
              </span>
            );
          }

          return (
            <React.Fragment key={seg.start}>
              {body}
              {marker}
            </React.Fragment>
          );
        })}
      </span>
      {glosses.length > 0 && (
        // The chosen definitions ride under the verse. This sits OUTSIDE
        // [data-verse-text] on purpose: everything inside that span is the
        // verse, and marking and Define both compute character offsets from it —
        // a gloss in there would silently shift every mark to its right.
        <span
          data-verse-gloss
          style={{
            display: "block",
            marginTop: "8px",
            paddingTop: "7px",
            borderTop: "1px solid var(--border)",
            fontSize: "0.82em",
            lineHeight: 1.5,
            color: "var(--muted)",
          }}
        >
          {glosses.map((g, i) => (
            <span key={g.word + ":" + g.n + ":" + i} style={{ display: "block" }}>
              <strong
                style={{
                  color: "var(--text)",
                  fontVariant: "small-caps",
                  letterSpacing: "0.02em",
                  marginRight: "6px",
                }}
              >
                {g.word}
              </strong>
              <span style={{ color: DEF_ACCENT, fontWeight: 700, marginRight: "5px" }}>
                {g.n}.
              </span>
              {g.text}
            </span>
          ))}
        </span>
      )}
    </p>
  );
}
