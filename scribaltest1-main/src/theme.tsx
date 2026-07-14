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

// Warm ("paper") palette — the beige counterpart to NEUTRAL. When warm tone is
// on, the shell swaps its whole neutral palette for this one, exactly the way
// dark mode swaps light↔dark. That way every surface that would otherwise be
// white (header, toolbars, cards, sheets) turns the same beige as the reading
// paper — instead of only the reading pane going warm while the chrome stays
// white. The light values are anchored on the reading paper tone (#f4ecd6) so
// the bar under the reader flows seamlessly into the page; panel is a touch
// lighter so cards/sheets still read as elevated (as pure white did before).
export const WARM = {
  light: {
    bg: "#f4ecd6",
    panel: "#fbf4e2",
    soft: "#eadfc2",
    text: "#1d1c18",
    muted: "#8a8268",
    border: "#ddd0b0",
  },
  dark: {
    bg: "#1a1410",
    panel: "#241d14",
    soft: "#2b2318",
    text: "#e9ddc2",
    muted: "#9a8f78",
    border: "#39301f",
  },
};

// Primary accent — links, primary actions, active/selected states.
export const ACCENT = "#8b5cf6";
