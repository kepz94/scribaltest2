// Shared visual tokens for both shells (mobile MobileApp + desktop App).
//
// This is the single source of truth for the neutral palette and the accent,
// so they can no longer drift between mobile and desktop. Whenever a color here
// changes, both shells pick it up automatically.
//
// NOTE: the mark colors are intentionally NOT defined here. They live as the
// --pen1..7 / --hl1..7 CSS variables (set in App.tsx LIGHT_THEME/DARK_THEME)
// and are referenced through types.ts COLOR_MAP / HIGHLIGHT_MAP. Keep them there.

export const NEUTRAL = {
  light: {
    bg: "#f6f4ee",
    panel: "#ffffff",
    soft: "#efece4",
    text: "#1d1c18",
    muted: "#8d8a80",
    border: "#e2dfd6",
  },
  dark: {
    bg: "#131210",
    panel: "#1d1c19",
    soft: "#232220",
    text: "#eae7de",
    muted: "#8d8a82",
    border: "#343229",
  },
};

// Primary accent — links, primary actions, active/selected states.
export const ACCENT = "#8b5cf6";
