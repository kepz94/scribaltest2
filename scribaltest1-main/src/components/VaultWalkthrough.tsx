import { useState, useEffect } from "react";
import { THEMES, penVar } from "./walkthroughDemo";
import WalkthroughFrame from "./WalkthroughFrame";

interface Props {
  onClose: () => void;
}

type Phase = "intro" | "saving" | "tags" | "frozen" | "done";
const ORDER: Phase[] = ["intro", "saving", "tags", "frozen", "done"];

const stageBox: React.CSSProperties = {
  backgroundColor: "var(--bg)",
  borderRadius: "12px",
  border: "1px solid var(--border)",
  padding: "16px 18px",
  fontFamily: "system-ui, sans-serif",
  minHeight: "180px",
};

export default function VaultWalkthrough({ onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [shown, setShown] = useState(false);

  useEffect(() => {
    setShown(false);
    const t = window.setTimeout(() => setShown(true), 40);
    return () => clearTimeout(t);
  }, [phase]);

  const idx = ORDER.indexOf(phase);
  const next = () => (phase === "done" ? onClose() : setPhase(ORDER[idx + 1]));

  const onShelf = phase === "tags" || phase === "frozen" || phase === "done";

  const caption = (() => {
    switch (phase) {
      case "intro":
        return "When a study is worth keeping, save it to the Vault — a snapshot of your compiled marks and notes.";
      case "saving":
        return "The compiled study slides onto your shelf, ready to reopen, rename, or print any time.";
      case "tags":
        return "Add tags to organize entries, then filter your shelf by tag.";
      case "frozen":
        return "A saved entry is frozen in time — if you change your marks later, the snapshot stays exactly as it was.";
      case "done":
        return "Open or delete saved entries whenever you like. The Vault lives on your desktop study space.";
      default:
        return "";
    }
  })();

  const nextLabel = (() => {
    switch (phase) {
      case "intro":
        return "Save it →";
      case "saving":
        return "Add tags →";
      case "tags":
        return "Why a snapshot? →";
      case "frozen":
        return "Wrap up →";
      case "done":
        return "Got it";
      default:
        return "";
    }
  })();

  const card = (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "10px",
        padding: "12px 14px",
        backgroundColor: "var(--panel)",
        boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
        transition: "transform 0.6s, opacity 0.6s",
        transform:
          phase === "intro"
            ? "translateY(0)"
            : onShelf || (phase === "saving" && shown)
            ? "translateY(0)"
            : "translateY(0)",
      }}
    >
      <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
        Mosiah 18 · Two themes
      </div>
      <div style={{ display: "flex", gap: "6px", marginBottom: onShelf ? "10px" : 0 }}>
        {THEMES.map((t) => (
          <span
            key={t.color}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              fontSize: "11px",
              color: "var(--muted)",
            }}
          >
            <span
              style={{
                width: "9px",
                height: "9px",
                borderRadius: "50%",
                backgroundColor: penVar(t.color),
              }}
            />
            {t.name}
          </span>
        ))}
      </div>
      {onShelf && (
        <div
          style={{
            display: "flex",
            gap: "6px",
            opacity: shown ? 1 : 0,
            transition: "opacity 0.4s",
          }}
        >
          {["covenant", "favorites"].map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: "10px",
                padding: "2px 8px",
                borderRadius: "999px",
                backgroundColor: "var(--soft)",
                color: "var(--text)",
              }}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  const stage = (() => {
    if (phase === "intro" || phase === "saving") {
      return (
        <div style={stageBox}>
          <div
            style={{
              fontSize: "11px",
              textTransform: "uppercase",
              letterSpacing: "1px",
              color: "var(--muted)",
              marginBottom: "10px",
            }}
          >
            {phase === "saving" ? "→ Saving to Vault" : "Compiled study"}
          </div>
          <div
            style={{
              opacity: shown ? 1 : 0,
              transform: shown
                ? "translateY(0)"
                : phase === "saving"
                ? "translateY(-12px)"
                : "translateY(0)",
              transition: "opacity 0.5s, transform 0.5s",
            }}
          >
            {card}
          </div>
        </div>
      );
    }

    if (phase === "frozen") {
      return (
        <div style={stageBox}>
          <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "6px" }}>
                Saved snapshot
              </div>
              {card}
            </div>
            <div style={{ fontSize: "20px", color: "var(--muted)" }}>≠</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "6px" }}>
                Live marks (later edits)
              </div>
              <div
                style={{
                  border: "1px dashed var(--border)",
                  borderRadius: "10px",
                  padding: "12px 14px",
                  fontSize: "12px",
                  color: "var(--muted)",
                  fontStyle: "italic",
                }}
              >
                change freely — the snapshot won't move
              </div>
            </div>
          </div>
        </div>
      );
    }

    // tags / done → card on the shelf
    return (
      <div style={stageBox}>
        <div
          style={{
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "1px",
            color: "var(--muted)",
            marginBottom: "10px",
          }}
        >
          Your shelf
        </div>
        {card}
      </div>
    );
  })();

  return (
    <WalkthroughFrame
      label="Walkthrough · Vault"
      caption={caption}
      onSkip={onClose}
      onNext={next}
      nextLabel={nextLabel}
    >
      {stage}
    </WalkthroughFrame>
  );
}
