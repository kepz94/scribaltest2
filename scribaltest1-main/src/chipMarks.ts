// A verse card in a note inherits the study's ACTUAL markings.
//
// Kepu, Aug 7 2026: the reason he was hand-bolding inside verse chips at all
// was that a linked verse rendered as plain text — "it doesn't inherit my
// actual study markings." So instead of making chips hand-formattable (they
// are atomic tokens on purpose), the chip's body renders through the same
// segmentation the reader uses.
//
// This is MarkedVerse's rule extracted pure (boundaries at every mark edge,
// per-segment layering with heavier styles applied last so a bold rides on a
// highlight), minus the reader-only concerns: word-tag daggers, erase taps,
// verse numbers. If MarkedVerse's layering ever changes, change this with it.
import type { CSSProperties } from "react";
import { Mark, STYLE_POINTS, markStyleCSS } from "./types";

export interface ChipSegment {
  start: number;
  end: number;
  // null = unmarked text, rendered as-is.
  css: CSSProperties | null;
}

export function chipSegments(textLength: number, marks: Mark[]): ChipSegment[] {
  const clamp = (n: number) => Math.max(0, Math.min(n, textLength));
  const boundaries = new Set<number>([0, textLength]);
  marks.forEach((m) => {
    boundaries.add(clamp(m.startIndex));
    boundaries.add(clamp(m.endIndex));
  });
  const points = Array.from(boundaries).sort((a, b) => a - b);
  const out: ChipSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;
    const applicable = marks.filter(
      (m) => m.startIndex <= start && m.endIndex >= end
    );
    if (!applicable.length) {
      out.push({ start, end, css: null });
      continue;
    }
    // Layer every mark covering this slice, lightest first, so a highlight +
    // underline (etc.) are all visible instead of only the first one — the
    // reader's exact rule.
    const ordered = [...applicable].sort(
      (a, b) => (STYLE_POINTS[a.style] || 0) - (STYLE_POINTS[b.style] || 0)
    );
    const css: CSSProperties = {};
    ordered.forEach((m) => Object.assign(css, markStyleCSS(m.style, m.color)));
    out.push({ start, end, css });
  }
  if (!out.length && textLength > 0) out.push({ start: 0, end: textLength, css: null });
  return out;
}
