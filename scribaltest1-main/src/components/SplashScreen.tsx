import { useState, useEffect } from "react";
import ScribalWordmark from "./ScribalWordmark";

// The Scribal launch splash: the wordmark's underline draws itself in, then the
// whole thing fades out to reveal the app. Self-dismissing — render it once at
// the top of the app and it removes itself when finished. It plays on every
// mount, i.e. every time the app loads / the PWA opens.
const HOLD_MS = 1770; // word fades up + underline draws in, then a brief hold
const FADE_MS = 520; // fade-out to reveal the app

// The splash paints in the LAST-USED theme color (warm / light / dark) so
// launching the app doesn't flash a dark screen when the user is on a light or
// warm theme — it flows straight into whatever they left. `scribal_bg` is
// written by the shells whenever the effective background changes.
function splashTheme(): { bg: string; word: string } {
  let bg = "#131210";
  try {
    const saved = localStorage.getItem("scribal_bg");
    if (saved) {
      bg = saved;
    } else {
      const t = localStorage.getItem("scribal_theme");
      const prefersDark =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      bg = t === "dark" ? "#131210" : t === "light" ? "#f6f4ee" : prefersDark ? "#131210" : "#f6f4ee";
    }
  } catch {}
  // Ink that reads on this background: dark word on a light/warm screen, light
  // word on a dark one (perceived-luminance test on the hex).
  const h = bg.replace("#", "");
  let lightBg = true;
  if (h.length >= 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    lightBg = 0.299 * r + 0.587 * g + 0.114 * b > 140;
  }
  return { bg, word: lightBg ? "#1d1c18" : "#f4f3ee" };
}

export default function SplashScreen() {
  const [fading, setFading] = useState(false);
  const [gone, setGone] = useState(false);
  // Read once at mount — the theme can't change while the splash is up.
  const [{ bg, word }] = useState(splashTheme);
  useEffect(() => {
    const t1 = setTimeout(() => setFading(true), HOLD_MS);
    const t2 = setTimeout(() => setGone(true), HOLD_MS + FADE_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);
  if (gone) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: fading ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: fading ? "none" : "auto",
      }}
    >
      <ScribalWordmark size={64} color={word} underline="#8b5cf6" animate />
    </div>
  );
}
