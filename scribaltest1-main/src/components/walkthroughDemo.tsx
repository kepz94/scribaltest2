import { MarkColor } from "../types";

// One shared demo passage (Mosiah 18:8-9) marked in TWO themes, reused by
// the main tutorial and every per-feature walkthrough so the whole onboarding
// tells a single continuous story.

export interface DemoMark {
  start: number;
  end: number;
  color: MarkColor;
}

export interface DemoVerse {
  verse: number;
  text: string;
  marks: DemoMark[];
}

// color 4 = green, color 5 = blue (matches the app's pen/hl palette)
export const GREEN: MarkColor = 4;
export const BLUE: MarkColor = 5;

export interface DemoTheme {
  color: MarkColor;
  name: string;
}

export const THEMES: DemoTheme[] = [
  { color: GREEN, name: "The covenant we make" },
  { color: BLUE, name: "Serving one another" },
];

export const DEMO: DemoVerse[] = [
  {
    verse: 8,
    text:
      "And it came to pass that he said unto them: Behold, here are the waters of Mormon (for thus were they called) and now, as ye are desirous to come into the fold of God, and to be called his people, and are willing to bear one another's burdens, that they may be light;",
    marks: [
      { start: 154, end: 207, color: GREEN }, // "willing to bear one another's burdens"
    ],
  },
  {
    verse: 9,
    text:
      "Yea, and are willing to mourn with those that mourn; yea, and comfort those that stand in need of comfort, and to stand as witnesses of God at all times and in all things, and in all places that ye may be in, even until death…",
    marks: [
      { start: 9, end: 50, color: BLUE }, // "are willing to mourn with those that mourn"
      { start: 62, end: 104, color: BLUE }, // "comfort those that stand in need of comfort"
      { start: 113, end: 167, color: GREEN }, // "to stand as witnesses of God at all times..."
    ],
  },
];

export const TOTAL_MARKS = DEMO.reduce((n, v) => n + v.marks.length, 0);

export const hlVar = (c: MarkColor) => `var(--hl${c})`;
export const penVar = (c: MarkColor) => `var(--pen${c})`;

// Flatten marks in reading order, tagged with theme info — handy for the
// focused-notes view and the compile walkthrough.
export interface FlatMark {
  verse: number;
  text: string;
  color: MarkColor;
}

export const FLAT_MARKS: FlatMark[] = (() => {
  const out: FlatMark[] = [];
  DEMO.forEach((v) =>
    v.marks.forEach((m) =>
      out.push({ verse: v.verse, text: v.text.slice(m.start, m.end), color: m.color })
    )
  );
  return out;
})();

export const themeName = (c: MarkColor) =>
  THEMES.find((t) => t.color === c)?.name || "";

// Render a demo verse with the first `revealedSoFar` marks shown (in reading
// order). `offset` is how many marks appear in earlier verses.
export function renderVerse(
  v: DemoVerse,
  revealedSoFar: number,
  offset: number
) {
  const pieces: React.ReactNode[] = [];
  let cursor = 0;
  v.marks.forEach((m, idx) => {
    const globalIdx = offset + idx;
    const isRevealed = globalIdx < revealedSoFar;
    if (m.start > cursor) {
      pieces.push(
        <span key={"plain" + idx}>{v.text.slice(cursor, m.start)}</span>
      );
    }
    pieces.push(
      <span
        key={"mark" + idx}
        style={{
          backgroundColor: isRevealed ? hlVar(m.color) : "transparent",
          transition: "background-color 0.45s",
          borderRadius: "3px",
        }}
      >
        {v.text.slice(m.start, m.end)}
      </span>
    );
    cursor = m.end;
  });
  if (cursor < v.text.length) {
    pieces.push(<span key="tail">{v.text.slice(cursor)}</span>);
  }
  return (
    <p style={{ margin: "0 0 14px 0", lineHeight: 1.85 }}>
      <strong
        style={{
          color: "var(--muted)",
          fontSize: "0.75em",
          marginRight: "8px",
          fontFamily: "system-ui, sans-serif",
          verticalAlign: "top",
        }}
      >
        {v.verse}
      </strong>
      {pieces}
    </p>
  );
}
