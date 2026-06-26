import { useState, useEffect } from "react";
import ScribalWordmark from "./ScribalWordmark";

// The Scribal launch splash: a dark screen where the wordmark's underline draws
// itself in, then the whole thing fades out to reveal the app. Self-dismissing
// — render it once at the top of the app and it removes itself when finished.
// It plays on every mount, i.e. every time the app loads / the PWA opens.
const HOLD_MS = 1770; // word fades up + underline draws in, then a brief hold
const FADE_MS = 520; // fade-out to reveal the app

export default function SplashScreen() {
  const [fading, setFading] = useState(false);
  const [gone, setGone] = useState(false);
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
        background: "#1d1c18",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: fading ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: fading ? "none" : "auto",
      }}
    >
      <ScribalWordmark size={64} color="#f4f3ee" underline="#8b5cf6" animate />
    </div>
  );
}
