interface ScribalMarkProps {
  // Overall width/height of the rounded square, in px.
  size?: number;
}

// The Scribal logo: a serif "S" underlined in purple, set in a dark rounded
// square. Fixed brand colors (it reads the same in light or dark mode); a
// faint hairline keeps the dark square legible against a dark panel.
export default function ScribalMark({ size = 34 }: ScribalMarkProps) {
  const radius = Math.round(size * 0.27);
  const letter = Math.round(size * 0.6);
  const underlineW = Math.round(size * 0.4);
  const underlineH = Math.max(2, Math.round(size * 0.085));
  const gap = Math.max(2, Math.round(size * 0.05));
  return (
    <div
      aria-label="Scribal"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: "#1d1c18",
        border: "1px solid rgba(255,255,255,0.10)",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap,
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      <span
        style={{
          fontFamily: '"Times New Roman", Georgia, Times, serif',
          fontSize: letter,
          fontWeight: 700,
          lineHeight: 1,
          color: "#f4f0e8",
        }}
      >
        S
      </span>
      <span
        style={{
          width: underlineW,
          height: underlineH,
          borderRadius: underlineH / 2,
          background: "#8b5cf6",
        }}
      />
    </div>
  );
}

