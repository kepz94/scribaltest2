import { useState, useEffect, useRef } from "react";
import { FLAT_MARKS, hlVar, penVar, themeName } from "./walkthroughDemo";
import WalkthroughFrame from "./WalkthroughFrame";

interface Props {
  onClose: () => void;
}

type Phase = "intro" | "typing" | "mymarks" | "wildcard" | "done";
const ORDER: Phase[] = ["intro", "typing", "mymarks", "wildcard", "done"];

const stageBox: React.CSSProperties = {
  backgroundColor: "var(--bg)",
  borderRadius: "12px",
  border: "1px solid var(--border)",
  padding: "16px 18px",
  fontFamily: "system-ui, sans-serif",
  minHeight: "180px",
};

export default function SearchWalkthrough({ onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [typed, setTyped] = useState("");
  const [source, setSource] = useState<"scripture" | "marks">("scripture");
  const timers = useRef<number[]>([]);

  const clear = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => () => clear(), []);

  // Drive the typing animation for the query box
  useEffect(() => {
    clear();
    if (phase === "typing" || phase === "intro") setSource("scripture");
    if (phase === "mymarks") setSource("marks");

    const target =
      phase === "wildcard" ? "serv*" : phase === "intro" ? "" : "covenant";
    setTyped("");
    if (!target) return;
    let i = 0;
    const type = () => {
      i++;
      setTyped(target.slice(0, i));
      if (i < target.length) timers.current.push(window.setTimeout(type, 90));
    };
    timers.current.push(window.setTimeout(type, 350));
  }, [phase]);

  const idx = ORDER.indexOf(phase);
  const next = () => (phase === "done" ? onClose() : setPhase(ORDER[idx + 1]));

  // Which demo marks match the current query
  const results = (() => {
    if (phase === "intro") return [];
    if (phase === "wildcard")
      return FLAT_MARKS.filter((m) => /serv/i.test(m.text));
    return FLAT_MARKS.filter(
      (m) => m.color === 4 // "covenant" theme demo
    );
  })();

  const caption = (() => {
    switch (phase) {
      case "intro":
        return "Search finds any word or phrase across all of scripture — or just within the text you've marked.";
      case "typing":
        return "Type a word and matches appear instantly, grouped by where they are. Tap one to jump straight there.";
      case "mymarks":
        return "Flip to “My marks” to search only what you've highlighted — find that idea you know you marked somewhere.";
      case "wildcard":
        return "Use * as a wildcard. “serv*” catches serve, serving, servant, and more.";
      case "done":
        return "Open search anytime with Ctrl/Cmd + K.";
      default:
        return "";
    }
  })();

  const nextLabel = (() => {
    switch (phase) {
      case "intro":
        return "Search “covenant” →";
      case "typing":
        return "Search my marks →";
      case "mymarks":
        return "Try a wildcard →";
      case "wildcard":
        return "Wrap up →";
      case "done":
        return "Got it";
      default:
        return "";
    }
  })();

  return (
    <WalkthroughFrame
      label="Walkthrough · Search"
      caption={caption}
      onSkip={onClose}
      onNext={next}
      nextLabel={nextLabel}
    >
      <div style={stageBox}>
        {/* source toggle */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
          {(["scripture", "marks"] as const).map((s) => (
            <span
              key={s}
              style={{
                fontSize: "12px",
                padding: "4px 12px",
                borderRadius: "999px",
                border: "1px solid var(--border)",
                backgroundColor: source === s ? "var(--text)" : "transparent",
                color: source === s ? "var(--bg)" : "var(--muted)",
              }}
            >
              {s === "scripture" ? "Scripture" : "My marks"}
            </span>
          ))}
        </div>

        {/* query box */}
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "9px 12px",
            fontSize: "14px",
            backgroundColor: "var(--panel)",
            marginBottom: "12px",
            minHeight: "20px",
          }}
        >
          {typed ? (
            <span>
              {typed}
              <span style={{ opacity: 0.5 }}>|</span>
            </span>
          ) : (
            <span style={{ color: "var(--muted)" }}>Search…</span>
          )}
        </div>

        {/* results */}
        <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
          {results.map((r, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "9px",
                fontSize: "13px",
                opacity: typed.length > 2 ? 1 : 0,
                transition: `opacity 0.3s ${i * 90}ms`,
              }}
            >
              <span style={{ fontSize: "10px", color: "var(--muted)", minWidth: "58px" }}>
                Mosiah 18:{r.verse}
              </span>
              <span
                style={{
                  width: "9px",
                  height: "9px",
                  borderRadius: "50%",
                  backgroundColor: penVar(r.color),
                  flexShrink: 0,
                }}
              />
              <span style={{ fontFamily: '"Times New Roman", Times, serif' }}>
                <span style={{ backgroundColor: hlVar(r.color), borderRadius: "3px" }}>
                  {r.text.length > 38 ? r.text.slice(0, 38) + "…" : r.text}
                </span>
              </span>
            </div>
          ))}
          {phase !== "intro" && results.length > 0 && source === "marks" && (
            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "4px" }}>
              within theme: {themeName(results[0].color)}
            </div>
          )}
        </div>
      </div>
    </WalkthroughFrame>
  );
}
