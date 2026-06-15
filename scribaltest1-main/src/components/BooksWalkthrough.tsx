import { useState, useEffect } from "react";
import { DEMO, hlVar, renderVerse } from "./walkthroughDemo";
import WalkthroughFrame from "./WalkthroughFrame";

interface Props {
  onClose: () => void;
}

type Phase = "intro" | "master" | "session" | "done";
const ORDER: Phase[] = ["intro", "master", "session", "done"];

const stageBox: React.CSSProperties = {
  backgroundColor: "var(--bg)",
  borderRadius: "12px",
  border: "1px solid var(--border)",
  padding: "16px 18px",
  minHeight: "190px",
};

export default function BooksWalkthrough({ onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [shown, setShown] = useState(false);

  useEffect(() => {
    setShown(false);
    const t = window.setTimeout(() => setShown(true), 40);
    return () => clearTimeout(t);
  }, [phase]);

  const idx = ORDER.indexOf(phase);
  const next = () => (phase === "done" ? onClose() : setPhase(ORDER[idx + 1]));

  // master shows marks; session is a fresh, empty layer on the same chapter
  const activeBook = phase === "session" ? "Session · June 14" : "Master";
  const showMarks = phase !== "session";

  const caption = (() => {
    switch (phase) {
      case "intro":
        return "Every tab is backed by a study book that holds its marks. You always have one: Master.";
      case "master":
        return "Master is your default book. Marks you make here show up whenever you open this chapter.";
      case "session":
        return "Start a session to study the same chapter on a fresh, separate layer — a clean slate that won't touch your master marks.";
      case "done":
        return "Switch a tab between master and any session anytime. The marks follow the book, not the tab — and linked tabs share one book.";
      default:
        return "";
    }
  })();

  const nextLabel = (() => {
    switch (phase) {
      case "intro":
        return "See master →";
      case "master":
        return "Start a session →";
      case "session":
        return "Wrap up →";
      case "done":
        return "Got it";
      default:
        return "";
    }
  })();

  return (
    <WalkthroughFrame
      label="Walkthrough · Books"
      caption={caption}
      onSkip={onClose}
      onNext={next}
      nextLabel={nextLabel}
    >
      <div style={stageBox}>
        {/* book switcher */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "12px", fontFamily: "system-ui, sans-serif" }}>
          {["Master", "Session · June 14"].map((b) => {
            const active = b === activeBook;
            return (
              <span
                key={b}
                style={{
                  fontSize: "11px",
                  padding: "4px 11px",
                  borderRadius: "999px",
                  border: "1px solid var(--border)",
                  backgroundColor: active ? "var(--text)" : "transparent",
                  color: active ? "var(--bg)" : "var(--muted)",
                  opacity: b.startsWith("Session") && phase !== "session" && phase !== "done" ? 0.5 : 1,
                  transition: "background-color 0.3s, color 0.3s",
                }}
              >
                {b}
              </span>
            );
          })}
        </div>

        {/* the same chapter, marks depending on the active book */}
        <div
          style={{
            fontFamily: '"Times New Roman", Times, serif',
            fontSize: "15px",
            opacity: shown ? 1 : 0,
            transition: "opacity 0.4s",
          }}
        >
          {renderVerse(DEMO[0], showMarks ? 1 : 0, 0)}
          {!showMarks && (
            <div
              style={{
                fontFamily: "system-ui, sans-serif",
                fontSize: "11px",
                color: "var(--muted)",
                fontStyle: "italic",
                marginTop: "4px",
              }}
            >
              fresh layer — no marks yet, master is untouched
            </div>
          )}
          {showMarks && (
            <div
              style={{
                fontFamily: "system-ui, sans-serif",
                fontSize: "11px",
                color: "var(--muted)",
                marginTop: "4px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span style={{ width: "9px", height: "9px", borderRadius: "50%", backgroundColor: hlVar(4) }} />
              your master marks
            </div>
          )}
        </div>
      </div>
    </WalkthroughFrame>
  );
}
