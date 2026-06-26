import { useEffect, useRef } from "react";

// Load Playfair Display (the wordmark face) once, lazily, from Google Fonts so
// the wordmark renders correctly wherever it's used — even if only the changed
// files are deployed. A serif fallback keeps it readable while the web font
// loads or if the device is offline.
let fontRequested = false;
const ensurePlayfair = () => {
  if (fontRequested || typeof document === "undefined") return;
  fontRequested = true;
  if (document.getElementById("scribal-playfair-font")) return;
  const pre1 = document.createElement("link");
  pre1.rel = "preconnect";
  pre1.href = "https://fonts.googleapis.com";
  const pre2 = document.createElement("link");
  pre2.rel = "preconnect";
  pre2.href = "https://fonts.gstatic.com";
  pre2.crossOrigin = "anonymous";
  const link = document.createElement("link");
  link.id = "scribal-playfair-font";
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap";
  document.head.appendChild(pre1);
  document.head.appendChild(pre2);
  document.head.appendChild(link);
};

interface ScribalWordmarkProps {
  // Font size of the word, in px. The underline scales from this.
  size?: number;
  // Text color. Defaults to the surrounding text color so it adapts to
  // light/dark automatically.
  color?: string;
  // Underline color. Defaults to the brand purple (matches <ScribalMark/>).
  underline?: string;
  // When true, the word fades up and the underline draws itself in left→right
  // (used by the launch splash). Default is a static wordmark.
  animate?: boolean;
}

// The Scribal wordmark: "Scribal" set in Playfair Display, bold, with a rounded
// purple rule beneath it the full width of the word — the type half of the
// brand (the icon half is <ScribalMark/>).
export default function ScribalWordmark({
  size = 28,
  color = "currentColor",
  underline = "#8b5cf6",
  animate = false,
}: ScribalWordmarkProps) {
  const wordRef = useRef<HTMLSpanElement | null>(null);
  const ruleRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    ensurePlayfair();
  }, []);
  useEffect(() => {
    if (!animate) return;
    const word = wordRef.current;
    const rule = ruleRef.current;
    // The word fades up, then the underline draws in. Web Animations API keeps
    // it self-contained (no global CSS). If it's unavailable, just reveal both
    // so the wordmark never stays hidden.
    if (word) {
      if (typeof word.animate === "function") {
        word.animate(
          [
            { opacity: 0, transform: "translateY(12px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          {
            duration: 560,
            delay: 120,
            easing: "cubic-bezier(.2,.7,.2,1)",
            fill: "both",
          }
        );
      } else {
        word.style.opacity = "1";
        word.style.transform = "none";
      }
    }
    if (rule) {
      if (typeof rule.animate === "function") {
        rule.animate(
          [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
          {
            duration: 560,
            delay: 560,
            easing: "cubic-bezier(.45,0,.2,1)",
            fill: "both",
          }
        );
      } else {
        rule.style.transform = "none";
      }
    }
  }, [animate]);
  const barH = Math.max(3, Math.round(size * 0.12));
  const gap = Math.max(3, Math.round(size * 0.16));
  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap,
        lineHeight: 1,
      }}
    >
      <span
        ref={wordRef}
        style={{
          fontFamily: '"Playfair Display", Georgia, "Times New Roman", serif',
          fontWeight: 700,
          fontSize: size,
          lineHeight: 1,
          color,
          letterSpacing: "-0.005em",
          opacity: animate ? 0 : 1,
        }}
      >
        Scribal
      </span>
      <span
        ref={ruleRef}
        style={{
          width: "100%",
          height: barH,
          borderRadius: 999,
          background: underline,
          transformOrigin: "left center",
          transform: animate ? "scaleX(0)" : "none",
        }}
      />
    </span>
  );
}
