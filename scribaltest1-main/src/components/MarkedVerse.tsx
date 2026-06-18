import React from "react";
import { Mark, markStyleCSS, STYLE_POINTS } from "../types";

interface MarkedVerseProps {
  reference: string;
  verseNumber: number;
  text: string;
  marks: Mark[];
  onEraseMark?: (markId: string) => void;
}

export default function MarkedVerse({
  reference,
  verseNumber,
  text,
  marks,
  onEraseMark,
}: MarkedVerseProps) {
  const verseMarks = marks.filter((m) => m.reference === reference);

  const boundaries = new Set<number>([0, text.length]);
  verseMarks.forEach((m) => {
    boundaries.add(Math.max(0, Math.min(m.startIndex, text.length)));
    boundaries.add(Math.max(0, Math.min(m.endIndex, text.length)));
  });
  const points = Array.from(boundaries).sort((a, b) => a - b);

  const segments = [];
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

          if (seg.applicable.length === 0) {
            return <React.Fragment key={seg.start}>{segText}</React.Fragment>;
          }

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

          return (
            <span
              key={seg.start}
              style={style}
              title={onEraseMark ? "Click to erase this mark" : undefined}
              onClick={onEraseMark ? () => onEraseMark(pickMark.id) : undefined}
            >
              {segText}
            </span>
          );
        })}
      </span>
    </p>
  );
}