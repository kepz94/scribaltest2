import { useEffect } from "react";

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
}

// The Scribal wordmark: "Scribal" set in Playfair Display, bold, with a rounded
// purple rule beneath it the full width of the word — the type half of the
// brand (the icon half is <ScribalMark/>).
export default function ScribalWordmark({
  size = 28,
  color = "currentColor",
  underline = "#8b5cf6",
}: ScribalWordmarkProps) {
  useEffect(() => {
    ensurePlayfair();
  }, []);
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
        style={{
          fontFamily: '"Playfair Display", Georgia, "Times New Roman", serif',
          fontWeight: 700,
          fontSize: size,
          lineHeight: 1,
          color,
          letterSpacing: "-0.005em",
        }}
      >
        Scribal
      </span>
      <span
        style={{
          width: "100%",
          height: barH,
          borderRadius: 999,
          background: underline,
        }}
      />
    </span>
  );
}
