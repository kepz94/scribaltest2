import { useState, useEffect } from "react";
import WalkthroughFrame from "./WalkthroughFrame";

interface Props {
  onClose: () => void;
}

type Phase = "intro" | "open" | "link" | "done";
const ORDER: Phase[] = ["intro", "open", "link", "done"];

const stageBox: React.CSSProperties = {
  backgroundColor: "var(--bg)",
  borderRadius: "12px",
  border: "1px solid var(--border)",
  padding: "16px 18px",
  fontFamily: "system-ui, sans-serif",
  minHeight: "190px",
};

const LINK = "#8b5cf6";

export default function TabsWalkthrough({ onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [shown, setShown] = useState(false);

  useEffect(() => {
    setShown(false);
    const t = window.setTimeout(() => setShown(true), 40);
    return () => clearTimeout(t);
  }, [phase]);

  const idx = ORDER.indexOf(phase);
  const next = () => (phase === "done" ? onClose() : setPhase(ORDER[idx + 1]));

  const twoPanels = phase === "open" || phase === "link" || phase === "done";
  const linked = phase === "link" || phase === "done";

  const caption = (() => {
    switch (phase) {
      case "intro":
        return "Tabs let you keep more than one passage open at a time — each remembers its own place and its own marks.";
      case "open":
        return "Open another and read them side by side — up to five panels at once.";
      case "link":
        return "Tap the link button to join two tabs. Linked tabs share one set of marks, colors, and notes — perfect for tracing a theme across passages.";
      case "done":
        return "Unlink anytime to give a tab its own marks again.";
      default:
        return "";
    }
  })();

  const nextLabel = (() => {
    switch (phase) {
      case "intro":
        return "Open a second tab →";
      case "open":
        return "Link them →";
      case "link":
        return "Wrap up →";
      case "done":
        return "Got it";
      default:
        return "";
    }
  })();

  const panel = (title: string, isLinked: boolean) => (
    <div
      style={{
        flex: 1,
        border: isLinked ? "2px solid " + LINK : "1px solid var(--border)",
        borderRadius: "10px",
        padding: "12px",
        backgroundColor: "var(--panel)",
        transition: "border-color 0.4s",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "12px",
          fontWeight: 600,
          marginBottom: "8px",
        }}
      >
        {title}
        {isLinked && <span style={{ color: LINK }}>🔗</span>}
      </div>
      <div style={{ fontSize: "10px", color: "var(--muted)", lineHeight: 1.6 }}>
        ▦▦▦▦▦▦▦
        <br />
        ▦▦▦▦▦
      </div>
    </div>
  );

  return (
    <WalkthroughFrame
      label="Walkthrough · Tabs"
      caption={caption}
      onSkip={onClose}
      onNext={next}
      nextLabel={nextLabel}
    >
      <div style={stageBox}>
        {/* tab bar */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
          <span
            style={{
              fontSize: "11px",
              padding: "4px 10px",
              borderRadius: "7px 7px 0 0",
              backgroundColor: "var(--soft)",
              border: linked ? "1px solid " + LINK : "1px solid var(--border)",
            }}
          >
            Mosiah 18 {linked && <span style={{ color: LINK }}>🔗</span>}
          </span>
          {twoPanels && (
            <span
              style={{
                fontSize: "11px",
                padding: "4px 10px",
                borderRadius: "7px 7px 0 0",
                backgroundColor: "var(--soft)",
                border: linked ? "1px solid " + LINK : "1px solid var(--border)",
                opacity: shown ? 1 : 0,
                transition: "opacity 0.4s",
              }}
            >
              Alma 5 {linked && <span style={{ color: LINK }}>🔗</span>}
            </span>
          )}
        </div>

        {/* panels */}
        <div style={{ display: "flex", gap: "10px" }}>
          {panel("Mosiah 18", linked)}
          {twoPanels && (
            <div
              style={{
                flex: 1,
                display: "flex",
                opacity: shown ? 1 : 0,
                transform: shown ? "translateX(0)" : "translateX(12px)",
                transition: "opacity 0.45s, transform 0.45s",
              }}
            >
              {panel("Alma 5", linked)}
            </div>
          )}
        </div>
      </div>
    </WalkthroughFrame>
  );
}
