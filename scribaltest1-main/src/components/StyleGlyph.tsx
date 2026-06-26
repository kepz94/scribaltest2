import type { ReactNode } from "react";
import type { MarkStyle } from "../types";

const FAM = 'Georgia, "Times New Roman", serif';

// A small, monochrome preview of a marking style, used on the toolbar buttons
// so each style identifies itself at a glance. Naked letters (Bold, Italic)
// fill the button; the underline family stacks a small letter over a
// hand-drawn line so solid / dashed / waved are obviously different; Circle and
// Box enclose the letter in a ring vs a square; Highlight keeps its swatch.
// Everything inherits currentColor, so it inverts on an active button. The one
// fill — Highlight — uses the theme's --hl3, which is defined on both shells.
export default function StyleGlyph({
  style,
  size = 14,
}: {
  style: MarkStyle;
  size?: number;
}) {
  const r = (m: number) => Math.round(size * m);
  const lw = Math.round(size + 1); // drawn-underline width

  // Letter stacked above a hand-drawn underline — shared by the three
  // underline-family styles so the line itself is the only difference.
  const lineStack = (line: ReactNode) => (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1,
        lineHeight: 1,
        verticalAlign: "middle",
      }}
    >
      <span style={{ fontFamily: FAM, fontSize: r(0.92), lineHeight: 1 }}>A</span>
      {line}
    </span>
  );

  switch (style) {
    case "bold":
      return (
        <span
          style={{
            fontFamily: FAM,
            fontWeight: 900,
            fontSize: r(1.2),
            lineHeight: 1,
            display: "inline-block",
            verticalAlign: "middle",
          }}
        >
          A
        </span>
      );
    case "italic":
      return (
        <span
          style={{
            fontFamily: FAM,
            fontStyle: "italic",
            fontWeight: 600,
            fontSize: r(1.5),
            lineHeight: 1,
            display: "inline-block",
            verticalAlign: "middle",
          }}
        >
          a
        </span>
      );
    case "highlight":
      return (
        <span
          style={{
            fontFamily: FAM,
            fontWeight: 600,
            fontSize: r(0.95),
            background: "var(--hl3)",
            color: "var(--text)",
            borderRadius: 2,
            padding: "1px 4px",
            lineHeight: 1,
            display: "inline-block",
            verticalAlign: "middle",
          }}
        >
          A
        </span>
      );
    case "circle":
    case "box": {
      const sidePx = r(1.35);
      return (
        <span
          style={{
            fontFamily: FAM,
            fontSize: r(0.85),
            width: sidePx,
            height: sidePx,
            border: "1.5px solid currentColor",
            borderRadius: style === "circle" ? "50%" : 2,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
            verticalAlign: "middle",
          }}
        >
          A
        </span>
      );
    }
    case "underline":
      return lineStack(
        <svg width={lw} height="3">
          <line
            x1="1"
            y1="1.5"
            x2={lw - 1}
            y2="1.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );
    case "dashed":
      return lineStack(
        <svg width={lw} height="3">
          <line
            x1="1"
            y1="1.5"
            x2={lw - 1}
            y2="1.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="butt"
            strokeDasharray="3.5 2.8"
          />
        </svg>
      );
    case "squiggly":
      return lineStack(
        <svg width={lw} height="5" viewBox="0 0 15 5">
          <path
            d="M1 2.6 Q 2.6 0.5 4.2 2.6 T 7.4 2.6 T 10.6 2.6 T 13.8 2.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      );
    default:
      return (
        <span style={{ fontFamily: FAM, fontSize: size, verticalAlign: "middle" }}>
          A
        </span>
      );
  }
}
