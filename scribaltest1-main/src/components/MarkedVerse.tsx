import React from "react";
import { Mark, WordTag, markStyleCSS, STYLE_POINTS } from "../types";

interface MarkedVerseProps {
  reference: string;
  verseNumber: number;
  text: string;
  marks: Mark[];
  onEraseMark?: (markId: string) => void;
  dark?: boolean;
  tags?: WordTag[];
  onTagTap?: (tag: WordTag) => void;
  // Rendered after the verse text, OUTSIDE data-verse-text so it never shifts
  // the selection offsets that drive marking. Used for the topic-book grabber
  // (SCR-50).
  trailing?: React.ReactNode;
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
  trailing,
}: MarkedVerseProps) {
  const verseMarks = marks.filter((m) => m.reference === reference);
  const verseTags = (tags || []).filter((t) => t.reference === reference);

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
      {trailing}
    </p>
  );
}
