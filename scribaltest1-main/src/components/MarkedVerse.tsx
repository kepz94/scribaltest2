import React from "react";
import { Mark, WordTag, markStyleCSS, STYLE_POINTS } from "../types";

interface MarkedVerseProps {
  reference: string;
  verseNumber: number;
  text: string;
  marks: Mark[];
  onEraseMark?: (markId: string) => void;
  showConditionals?: boolean;
  dark?: boolean;
  tags?: WordTag[];
  onTagTap?: (tag: WordTag) => void;
}

// Conditional / covenantal markers. Surfaced only as a reading lens — they are
// never turned into actual marks. Longer phrases are listed first so the
// alternation prefers them (e.g. "inasmuch as" over "inasmuch").
function findConditionals(text: string): { start: number; end: number }[] {
  const re =
    /\b(inasmuch as|as many as|whosoever|whomsoever|whenever|inasmuch|whoso|except|unless|lest|when|if)\b/gi;
  const out: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export default function MarkedVerse({
  reference,
  verseNumber,
  text,
  marks,
  onEraseMark,
  showConditionals = false,
  dark = false,
  tags,
  onTagTap,
}: MarkedVerseProps) {
  const verseMarks = marks.filter((m) => m.reference === reference);
  const verseTags = (tags || []).filter((t) => t.reference === reference);
  const condRanges = showConditionals ? findConditionals(text) : [];

  // A deliberately non-pen accent so the lens never reads as a real mark.
  const condLine = dark ? "#a5b4fc" : "#4f46e5";
  const condBg = dark ? "rgba(165,180,252,0.16)" : "rgba(79,70,229,0.10)";

  const boundaries = new Set<number>([0, text.length]);
  verseMarks.forEach((m) => {
    boundaries.add(Math.max(0, Math.min(m.startIndex, text.length)));
    boundaries.add(Math.max(0, Math.min(m.endIndex, text.length)));
  });
  condRanges.forEach((r) => {
    boundaries.add(r.start);
    boundaries.add(r.end);
  });
  verseTags.forEach((t) => {
    boundaries.add(Math.max(0, Math.min(t.end, text.length)));
  });
  const points = Array.from(boundaries).sort((a, b) => a - b);

  const segments: {
    start: number;
    end: number;
    applicable: Mark[];
    conditional: boolean;
  }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const applicable = verseMarks.filter(
      (m) => m.startIndex <= start && m.endIndex >= end
    );
    const conditional = condRanges.some(
      (r) => r.start <= start && r.end >= end
    );
    segments.push({ start, end, applicable, conditional });
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
          if (seg.applicable.length > 0 || seg.conditional) {
            // Layer every mark covering this slice so a highlight + underline
            // (etc.) are all visible, instead of only the first one.
            const ordered = [...seg.applicable].sort(
              (a, b) => STYLE_POINTS[a.style] - STYLE_POINTS[b.style]
            );
            const style: React.CSSProperties = {};
            ordered.forEach((m) =>
              Object.assign(style, markStyleCSS(m.style, m.color))
            );

            // The conditional lens is a suggestion, not a mark: a dashed accent
            // underline, plus a faint wash only if the word isn't already
            // highlighted — layered on top of whatever the reader has marked.
            if (seg.conditional) {
              style.borderBottom = "2px dashed " + condLine;
              style.paddingBottom = "1px";
              if (!style.backgroundColor) style.backgroundColor = condBg;
            }

            // The most recently added mark on this slice is the erase target.
            // Conditional-only slices carry no mark, so they are not clickable.
            const hasMark = seg.applicable.length > 0;
            const pickMark = seg.applicable[seg.applicable.length - 1];
            if (onEraseMark && hasMark) {
              style.cursor = "pointer";
            }

            body = (
              <span
                style={style}
                title={
                  onEraseMark && hasMark
                    ? "Click to erase this mark"
                    : undefined
                }
                onClick={
                  onEraseMark && hasMark
                    ? () => onEraseMark(pickMark.id)
                    : undefined
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
    </p>
  );
}
