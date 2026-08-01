// cardText.ts
// How a study-table card's TEXT is read and displayed. Pure — no React, no
// Lexical — so these rules can be tested directly; RichNoteField re-exports
// them so every existing call site is unchanged.
//
// A card's text may be legacy plain text or Lexical HTML, and these rules are
// THE way every surface shows it: the card column, Present, and through
// Present the live rooms.

// ── rich or plain (SCR-63) ────────────────────────────────────────────────
// Card text counts as rich HTML only when it carries a tag Lexical actually
// exports — the loose "any <x…>" test would eat hand-typed text like
// "an <angle> example" as if it were markup.
const RICH_TAG =
  /<(p|br|span|strong|em|b|i|u|s|h[1-6]|ul|ol|li|blockquote|hr|div|a)\b/i;
export const isRichHtml = (v: string): boolean => RICH_TAG.test(v || "");

// ── themeless colours ─────────────────────────────────────────────────────
// Text pasted from another site arrives carrying THAT site's body colour as an
// inline style — e.g. `color: rgb(32, 21, 0)`, which is essentially black. It
// looks correct on the light reader and is INVISIBLE in dark mode: black words
// on a black card (Kepu, Aug 1).
//
// The rule that separates the two cases: a mid-tone colour is a decision
// someone made, and it survives. A near-black or near-white is just "default
// body text" in the document it came from — it carries no meaning here, and it
// is unreadable in one of our two themes whichever way it goes. Dropping it
// lets the text inherit var(--text), which is right on paper AND on the dark
// reader. That includes a deliberate black: choosing black means "plain", and
// plain is exactly what inheriting gives you in both themes.
//
// Applies to background-color on the same logic — a white highlight is not a
// highlight, and a black one hides the words.

const relLuminance = (css: string): number | null => {
  const s = (css || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "black") return 0;
  if (s === "white") return 1;
  let r: number, g: number, b: number;
  const rgb = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (rgb) {
    r = parseFloat(rgb[1]);
    g = parseFloat(rgb[2]);
    b = parseFloat(rgb[3]);
  } else {
    const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    if (!hex) return null; // a name or function we don't parse — leave it alone
    const h = hex[1];
    const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
    r = parseInt(full.slice(0, 2), 16);
    g = parseInt(full.slice(2, 4), 16);
    b = parseInt(full.slice(4, 6), 16);
  }
  if ([r, g, b].some((n) => isNaN(n))) return null;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

// TEXT and BACKGROUND need different cuts, and the highlight palette is why.
//
// For text, anything paler than 0.92 is unreadable on paper and anything
// darker than 0.12 is unreadable on the dark reader, so both ends go. The
// thresholds clear every pen: the darkest, pen1 red #d11a2a, sits at 0.26.
//
// Backgrounds cannot use the same pale cut — the highlight washes are LIGHT BY
// DESIGN and run from #ffd6d6 at 0.87 up to #e8f5c4 at 0.94. A 0.92 cut ate
// hl3 and hl9, throwing away real highlights. So a background only counts as
// themeless when it is effectively white (no highlight at all) or effectively
// black (hides the words).
export const isThemelessColor = (
  css: string,
  kind: "text" | "background" = "text"
): boolean => {
  const l = relLuminance(css);
  if (l === null) return false;
  return kind === "background" ? l > 0.97 || l < 0.06 : l < 0.12 || l > 0.92;
};

// Strip themeless colour declarations from an HTML string's inline styles.
// Pure string work applied at DISPLAY: the stored value keeps whatever it
// holds, so nothing of the user's is rewritten or lost — the card simply
// renders in the reader's own ink.
export const stripThemelessColors = (html: string): string =>
  (html || "").replace(/style="([^"]*)"/gi, (_whole, decls: string) => {
    const kept = decls
      .split(";")
      .filter((d) => {
        const [rawProp, ...rest] = d.split(":");
        const prop = (rawProp || "").trim().toLowerCase();
        if (prop !== "color" && prop !== "background-color") return !!d.trim();
        return !isThemelessColor(
          rest.join(":"),
          prop === "background-color" ? "background" : "text"
        );
      })
      .map((d) => d.trim())
      .filter(Boolean);
    return kept.length ? 'style="' + kept.join("; ") + '"' : "";
  });

// ── display ───────────────────────────────────────────────────────────────

// Renderable HTML for a card-text value (escapes legacy plain text).
export const richToHtml = (v: string): string =>
  !isRichHtml(v || "")
    ? (v || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>")
    : stripThemelessColors(v || "");

// Plain words of a card-text value — for places that need text, not markup
// (heading section names, outline rails, tooltips).
export const richToPlain = (v: string): string => {
  if (!v) return "";
  if (!isRichHtml(v)) return v.trim();
  const div = document.createElement("div");
  div.innerHTML = v;
  return (div.textContent || "").replace(/\u00a0+/g, " ").trim();
};
