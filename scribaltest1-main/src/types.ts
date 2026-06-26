import type { CSSProperties } from "react";

export type MarkStyle =
  | "bold"
  | "circle"
  | "box"
  | "underline"
  | "dashed"
  | "squiggly"
  | "italic"
  | "highlight";
export type MarkColor = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type Tool = MarkStyle | "eraser" | "pointer" | "define";

// A definition tag: one looked-up word occurrence, anchored to its verse and
// exact character range. Stores the dictionary key (not the text) so the
// dictionary stays the single source of truth.
export interface WordTag {
  id: string;
  reference: string;
  start: number;
  end: number;
  word: string;
  dictKey: string;
}

export interface Mark {
  id: string;
  reference: string;
  verseText: string;
  markedText: string;
  startIndex: number;
  endIndex: number;
  style: MarkStyle;
  color: MarkColor;
  timestamp: number;
  // When a study is sealed, the theme name is frozen onto its marks here.
  // Undefined means the mark still uses its book's live color label.
  label?: string;
}

export const COLORS: MarkColor[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export const STYLE_POINTS: Record<MarkStyle, number> = {
  bold: 5,
  circle: 4,
  box: 4,
  underline: 3,
  dashed: 3,
  squiggly: 3,
  italic: 2,
  highlight: 1,
};

export const STYLE_LABELS: Record<MarkStyle, string> = {
  bold: "B",
  circle: "C",
  box: "X",
  underline: "U",
  dashed: "D",
  squiggly: "S",
  italic: "I",
  highlight: "H",
};

// Keyboard map: which key selects which tool
export const KEY_TO_TOOL: Record<string, Tool> = {
  // Utilities row (Q W E); R flips orientation and is handled in the keydown
  // handler, not here, since it isn't a tool.
  q: "pointer",
  w: "define",
  e: "eraser",
  // Styles, top row (A S D F)
  a: "highlight",
  s: "underline",
  d: "bold",
  f: "italic",
  // Styles, bottom row (Z X C V)
  z: "circle",
  x: "box",
  c: "dashed",
  v: "squiggly",
};

export const COLOR_MAP: Record<MarkColor, string> = {
  1: "var(--pen1)",
  2: "var(--pen2)",
  3: "var(--pen3)",
  4: "var(--pen4)",
  5: "var(--pen5)",
  6: "var(--pen6)",
  7: "var(--pen7)",
  8: "var(--pen8)",
  9: "var(--pen9)",
  10: "var(--pen10)",
};

export const HIGHLIGHT_MAP: Record<MarkColor, string> = {
  1: "var(--hl1)",
  2: "var(--hl2)",
  3: "var(--hl3)",
  4: "var(--hl4)",
  5: "var(--hl5)",
  6: "var(--hl6)",
  7: "var(--hl7)",
  8: "var(--hl8)",
  9: "var(--hl9)",
  10: "var(--hl10)",
};

export function markStyleCSS(style: MarkStyle, color: MarkColor): CSSProperties {
  const css: CSSProperties = {};
  if (style === "bold") {
    css.fontWeight = "bold";
    css.color = COLOR_MAP[color];
  }
  if (style === "circle") {
    css.border = "2px solid " + COLOR_MAP[color];
    css.borderRadius = "12px";
    css.padding = "0px 5px";
    (css as any).boxDecorationBreak = "clone";
    (css as any).WebkitBoxDecorationBreak = "clone";
  }
  if (style === "box") {
    // Same enclosure as circle but with squared-off corners.
    css.border = "2px solid " + COLOR_MAP[color];
    css.borderRadius = "3px";
    css.padding = "0px 5px";
    (css as any).boxDecorationBreak = "clone";
    (css as any).WebkitBoxDecorationBreak = "clone";
  }
  if (style === "underline") {
    css.textDecoration = "underline";
    css.textDecorationColor = COLOR_MAP[color];
    css.textDecorationThickness = "2.5px";
    css.textUnderlineOffset = "3px";
  }
  if (style === "dashed") {
    css.textDecorationLine = "underline";
    css.textDecorationStyle = "dashed";
    css.textDecorationColor = COLOR_MAP[color];
    css.textDecorationThickness = "2.5px";
    css.textUnderlineOffset = "3px";
  }
  if (style === "squiggly") {
    css.textDecorationLine = "underline";
    css.textDecorationStyle = "wavy";
    css.textDecorationColor = COLOR_MAP[color];
    css.textDecorationThickness = "2px";
    css.textUnderlineOffset = "3px";
  }
  if (style === "italic") {
    css.fontStyle = "italic";
    css.color = COLOR_MAP[color];
  }
  if (style === "highlight") {
    css.backgroundColor = HIGHLIGHT_MAP[color];
  }
  return css;
}

export interface Tab {
  id: string;
  volume: number;
  book: number;
  chapter: number;
  bookId: string; // which StudyBook ("session") this tab reads/writes; "master" by default
  studyId?: string; // set => this tab is a keyword study, rendering its picked verses
}
