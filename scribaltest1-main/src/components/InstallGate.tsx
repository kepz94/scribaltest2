import { isIOS } from "../pwa/usePlatform";

const C = {
  bg: "#f6f4ee",
  panel: "#ffffff",
  text: "#1d1c18",
  muted: "#8d8a80",
  border: "#e2dfd6",
  accent: "#8b5cf6",
};

export default function InstallGate() {
  const ios = isIOS();

  const steps = ios
    ? [
        "Tap the ••• (three dots) at the bottom of your browser.",
        "Tap “Share.”",
        "Scroll down and tap “Add to Home Screen.”",
      ]
    : [
        "Open your browser's menu (the ⋮ in the corner).",
        "Tap “Add to Home screen” (or “Install app”).",
        "Confirm, then open Scribal from your home screen.",
      ];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: C.bg,
        color: C.text,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "28px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        textAlign: "center",
        overflowY: "auto",
      }}
    >
      <svg
        width="84"
        height="84"
        viewBox="0 0 84 84"
        style={{ marginBottom: "20px" }}
        aria-label="Scribal"
      >
        <rect width="84" height="84" rx="20" fill={C.text} />
        <text
          x="42"
          y="54"
          textAnchor="middle"
          fontFamily="Georgia, 'Times New Roman', serif"
          fontSize="46"
          fontWeight="700"
          fill={C.bg}
        >
          S
        </text>
        <rect x="24" y="62" width="36" height="4" rx="2" fill={C.accent} />
      </svg>
      <h1 style={{ fontSize: "23px", margin: "0 0 10px" }}>
        Add Scribal to your home screen
      </h1>
      <p
        style={{
          fontSize: "15px",
          lineHeight: 1.55,
          color: C.muted,
          maxWidth: "340px",
          margin: "0 0 26px",
        }}
      >
        On your phone, Scribal runs as a home-screen app — full screen, offline,
        and out of the way. Add it once, then open it from your home screen.
      </p>

      <div
        style={{
          backgroundColor: C.panel,
          border: "1px solid " + C.border,
          borderRadius: "16px",
          padding: "20px 18px",
          maxWidth: "360px",
          width: "100%",
          textAlign: "left",
          boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
        }}
      >
        <div
          style={{
            fontSize: "12px",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: C.muted,
            marginBottom: "14px",
          }}
        >
          {ios ? "In Safari" : "In your browser"}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <div
                style={{
                  width: "24px",
                  height: "24px",
                  borderRadius: "50%",
                  backgroundColor: C.text,
                  color: C.bg,
                  fontSize: "13px",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </div>
              <div style={{ fontSize: "14px", lineHeight: 1.5 }}>{s}</div>
            </div>
          ))}
        </div>
      </div>

      <p style={{ fontSize: "12px", color: C.muted, marginTop: "22px", maxWidth: "320px" }}>
        Already added it? Open Scribal from your home screen rather than the
        browser.
      </p>

      <div
        style={{
          width: "40px",
          height: "3px",
          borderRadius: "2px",
          backgroundColor: C.accent,
          marginTop: "22px",
        }}
      />
    </div>
  );
}
