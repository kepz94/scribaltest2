import type { CSSProperties } from "react";
import type { MarkStyle } from "../types";

// A small, monochrome preview of a marking style: a sample letter rendered in
// that very style (bold A, italic A, an A with a wavy underline, an A in a box,
// and so on). Used on the toolbar buttons so each style button identifies
// itself instead of relying on a first-letter label (which collides now that
// Box/Bold and Dashed/Define share letters). Inherits currentColor, so it
// inverts correctly on an active button. Highlight is the one style that needs
// a fill, so it uses the theme's --hl3 swatch — defined on both shells.
export default function StyleGlyph({
  style,
  size = 14,
}: {
  style: MarkStyle;
  size?: number;
}) {
  const base: CSSProperties = {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: size,
    fontWeight: 400,
    lineHeight: 1,
    display: "inline-block",
    verticalAlign: "middle",
  };
  const enclosed = Math.round(size * 0.8);

  switch (style) {
    case "bold":
      return <span style={{ ...base, fontWeight: 800 }}>A</span>;
    case "italic":
      return (
        <span style={{ ...base, fontStyle: "italic", fontWeight: 600 }}>A</span>
      );
    case "underline":
      return (
        <span
          style={{
            ...base,
            textDecorationLine: "underline",
            textDecorationThickness: "2px",
            textUnderlineOffset: "2px",
          }}
        >
          A
        </span>
      );
    case "dashed":
      return (
        <span
          style={{
            ...base,
            textDecorationLine: "underline",
            textDecorationStyle: "dashed",
            textDecorationThickness: "2px",
            textUnderlineOffset: "2px",
          }}
        >
          A
        </span>
      );
    case "squiggly":
      return (
        <span
          style={{
            ...base,
            textDecorationLine: "underline",
            textDecorationStyle: "wavy",
            textDecorationThickness: "1.5px",
            textUnderlineOffset: "2px",
          }}
        >
          A
        </span>
      );
    case "circle":
      return (
        <span
          style={{
            ...base,
            fontSize: enclosed,
            border: "1.5px solid currentColor",
            borderRadius: 9,
            padding: "1px 4px",
          }}
        >
          A
        </span>
      );
    case "box":
      return (
        <span
          style={{
            ...base,
            fontSize: enclosed,
            border: "1.5px solid currentColor",
            borderRadius: 2,
            padding: "1px 4px",
          }}
        >
          A
        </span>
      );
    case "highlight":
      return (
        <span
          style={{
            ...base,
            fontSize: enclosed,
            fontWeight: 600,
            background: "var(--hl3)",
            color: "var(--text)",
            borderRadius: 2,
            padding: "1px 4px",
          }}
        >
          A
        </span>
      );
    default:
      return <span style={base}>A</span>;
  }
}
