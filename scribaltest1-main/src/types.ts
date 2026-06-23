import type { CSSProperties } from "react";

export type MarkStyle = "bold" | "circle" | "underline" | "italic" | "highlight";
export type MarkColor = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Tool = MarkStyle | "eraser" | "pointer" | "define";

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

export const COLORS: MarkColor[] = [1, 2, 3, 4, 5, 6, 7];

export const STYLE_POINTS: Record<MarkStyle, number> = {
  bold: 5,
  circle: 4,
  underline: 3,
  italic: 2,
  highlight: 1,
};

export const STYLE_LABELS: Record<MarkStyle, string> = {
  bold: "B",
  circle: "C",
  underline: "U",
  italic: "I",
  highlight: "H",
};

// Keyboard map: which key selects which tool
export const KEY_TO_TOOL: Record<string, Tool> = {
  b: "bold",
  c: "circle",
  u: "underline",
  i: "italic",
  h: "highlight",
  e: "eraser",
  p: "pointer",
};

export const COLOR_MAP: Record<MarkColor, string> = {
  1: "var(--pen1)",
  2: "var(--pen2)",
  3: "var(--pen3)",
  4: "var(--pen4)",
  5: "var(--pen5)",
  6: "var(--pen6)",
  7: "var(--pen7)",
};

export const HIGHLIGHT_MAP: Record<MarkColor, string> = {
  1: "var(--hl1)",
  2: "var(--hl2)",
  3: "var(--hl3)",
  4: "var(--hl4)",
  5: "var(--hl5)",
  6: "var(--hl6)",
  7: "var(--hl7)",
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
  if (style === "underline") {
    css.textDecoration = "underline";
    css.textDecorationColor = COLOR_MAP[color];
    css.textDecorationThickness = "2.5px";
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
