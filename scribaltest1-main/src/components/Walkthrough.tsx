import { useState, useEffect, useRef } from "react";
import { MarkStyle, markStyleCSS, COLORS } from "../types";
import {
  DEMO,
  THEMES,
  GREEN,
  TOTAL_MARKS,
  FLAT_MARKS,
  hlVar,
  penVar,
  renderVerse,
} from "./walkthroughDemo";
import WalkthroughFrame from "./WalkthroughFrame";

interface WalkthroughProps {
  onClose: () => void;
}

type Phase =
  | "welcome"
  | "intro"
  | "tools"
  | "marking"
  | "marked"
  | "naming"
  | "named"
  | "notes"
  | "invite";

const STYLE_DEMOS: { style: MarkStyle; label: string; hint: string }[] = [
  { style: "highlight", label: "Highlight", hint: "the main idea" },
  { style: "underline", label: "Underline", hint: "supporting points" },
  { style: "bold", label: "Bold", hint: "key words" },
  { style: "italic", label: "Italic", hint: "tone or emphasis" },
  { style: "circle", label: "Circle", hint: "questions to revisit" },
];

export default function Walkthrough({ onClose }: WalkthroughProps) {
  const [phase, setPhase] = useState<Phase>("welcome");
  const [revealedMarks, setRevealedMarks] = useState(0);
  const [typedNames, setTypedNames] = useState<string[]>(["", ""]);
  const [typingIndex, setTypingIndex] = useState(-1);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => () => clearTimers(), []);

  useEffect(() => {
    clearTimers();

    if (phase === "marking") {
      for (let i = 1; i <= TOTAL_MARKS; i++) {
        timers.current.push(
          window.setTimeout(() => setRevealedMarks(i), i * 600)
        );
      }
      timers.current.push(
        window.setTimeout(() => setPhase("marked"), TOTAL_MARKS * 600 + 500)
      );
    }

    if (phase === "naming") {
      const names = ["", ""];
      let ti = 0;
      setTypingIndex(0);
      const type = () => {
        const full = THEMES[ti].name;
        if (names[ti].length < full.length) {
          names[ti] = full.slice(0, names[ti].length + 1);
          setTypedNames([names[0], names[1]]);
          timers.current.push(window.setTimeout(type, 45));
        } else if (ti < THEMES.length - 1) {
          ti++;
          setTypingIndex(ti);
          timers.current.push(window.setTimeout(type, 350));
        } else {
          setTypingIndex(-1);
          timers.current.push(window.setTimeout(() => setPhase("named"), 600));
        }
      };
      timers.current.push(window.setTimeout(type, 300));
    }
  }, [phase]);

  const showLegend =
    phase === "naming" ||
    phase === "named" ||
    phase === "notes" ||
    phase === "invite";

  const next = () => {
    if (phase === "welcome") setPhase("intro");
    else if (phase === "intro") setPhase("tools");
    else if (phase === "tools") {
      setRevealedMarks(0);
      setPhase("marking");
    } else if (phase === "marked") {
      setTypedNames(["", ""]);
      setPhase("naming");
    } else if (phase === "named") setPhase("notes");
    else if (phase === "notes") setPhase("invite");
    else if (phase === "invite") onClose();
  };

  const showNextButton = [
    "welcome",
    "intro",
    "tools",
    "marked",
    "named",
    "notes",
    "invite",
  ].includes(phase);

  const nextLabel = (() => {
    switch (phase) {
      case "welcome":
        return "Take the tour →";
      case "intro":
        return "Begin";
      case "tools":
        return "Try marking →";
      case "marked":
        return "Name the colors →";
      case "named":
        return "Turn marks into notes →";
      case "notes":
        return "What's next →";
      case "invite":
        return "Start studying";
      default:
        return "";
    }
  })();

  const caption = (() => {
    switch (phase) {
      case "welcome":
        return "A quiet workbench for studying scripture — read it, mark what stands out, and gather your marks into notes that trace the themes you care about. Here's a quick tour.";
      case "intro":
        return "Scribal isn't just for reading scripture — it's for studying it. First, the tools you'll mark with.";
      case "tools":
        return "Five ways to mark, in any of seven colors — plus an eraser to undo one. Use whichever fits what you're noticing.";
      case "marking":
        return "As you read, you mark what stands out. Watch two themes take shape across the passage.";
      case "marked":
        return "Four phrases, two threads of thought — marked with intention, not everything.";
      case "naming":
      case "named":
        return "Give each color a meaning. Now they aren't just colors — they're ideas you're tracing.";
      case "notes":
        return "And here's the payoff: your marks gather into focused notes, grouped by theme, with room for your own thoughts beside each verse.";
      case "invite":
        return "That's the heart of Scribal. From here, explore at your own pace — a short walkthrough greets you the first time you open each feature.";
      default:
        return "";
    }
  })();

  const stageBox: React.CSSProperties = {
    backgroundColor: "var(--bg)",
    borderRadius: "12px",
    border: "1px solid var(--border)",
    padding: "18px 20px",
  };

  const legend = showLegend ? (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "14px" }}>
      {THEMES.map((t, i) => (
        <div
          key={t.color}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            fontFamily: "system-ui, sans-serif",
            fontSize: "12px",
            color: typedNames[i] ? "var(--text)" : "var(--muted)",
            backgroundColor: "var(--soft)",
            borderRadius: "999px",
            padding: "6px 13px",
          }}
        >
          <span
            style={{
              width: "11px",
              height: "11px",
              borderRadius: "50%",
              backgroundColor: penVar(t.color),
              flexShrink: 0,
            }}
          />
          {typedNames[i] || "Name this color…"}
          {typingIndex === i && <span style={{ opacity: 0.5 }}>|</span>}
        </div>
      ))}
    </div>
  ) : null;

  const stage = (() => {
    if (phase === "welcome") {
      return (
        <div style={{ ...stageBox, textAlign: "center", padding: "44px 24px" }}>
          <svg width="76" height="76" viewBox="0 0 84 84" style={{ marginBottom: "18px" }}>
            <rect width="84" height="84" rx="20" fill="var(--text)" />
            <text
              x="42"
              y="54"
              textAnchor="middle"
              fontFamily="Georgia, 'Times New Roman', serif"
              fontSize="46"
              fontWeight="700"
              fill="var(--bg)"
            >
              S
            </text>
            <rect x="24" y="62" width="36" height="4" rx="2" fill="#8b5cf6" />
          </svg>
          <div
            style={{
              fontFamily: "system-ui, sans-serif",
              fontSize: "23px",
              fontWeight: 700,
              color: "var(--text)",
            }}
          >
            Welcome to Scribal
          </div>
        </div>
      );
    }

    if (phase === "tools") {
      return (
        <div style={stageBox}>
          <div style={{ display: "flex", flexDirection: "column", gap: "13px" }}>
            {STYLE_DEMOS.map((s) => (
              <div
                key={s.style}
                style={{ display: "flex", alignItems: "center", gap: "12px" }}
              >
                <span
                  style={{
                    fontFamily: '"Times New Roman", Times, serif',
                    fontSize: "17px",
                    minWidth: "92px",
                    ...markStyleCSS(s.style, GREEN),
                  }}
                >
                  covenant
                </span>
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    fontFamily: "system-ui, sans-serif",
                    minWidth: "76px",
                  }}
                >
                  {s.label}
                </span>
                <span
                  style={{
                    fontSize: "12px",
                    color: "var(--muted)",
                    fontFamily: "system-ui, sans-serif",
                  }}
                >
                  for {s.hint}
                </span>
              </div>
            ))}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                paddingTop: "12px",
                borderTop: "1px solid var(--border)",
                fontFamily: "system-ui, sans-serif",
              }}
            >
              <span style={{ fontSize: "13px", fontWeight: 600, minWidth: "92px" }}>
                7 colors
              </span>
              <div style={{ display: "flex", gap: "5px" }}>
                {COLORS.map((c) => (
                  <span
                    key={c}
                    style={{
                      width: "16px",
                      height: "16px",
                      borderRadius: "50%",
                      backgroundColor: hlVar(c),
                      border: "1px solid var(--border)",
                    }}
                  />
                ))}
              </div>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                each one a theme you name
              </span>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                fontFamily: "system-ui, sans-serif",
              }}
            >
              <span style={{ fontSize: "13px", fontWeight: 600, minWidth: "92px" }}>
                Eraser
              </span>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                tap a mark to remove it
              </span>
            </div>
          </div>
        </div>
      );
    }

    if (phase === "notes") {
      return (
        <div style={stageBox}>
          {THEMES.map((t) => {
            const items = FLAT_MARKS.filter((m) => m.color === t.color);
            return (
              <div key={t.color} style={{ marginBottom: "14px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "9px",
                    paddingBottom: "7px",
                    marginBottom: "8px",
                    borderBottom: "2px solid " + penVar(t.color),
                  }}
                >
                  <span
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "50%",
                      backgroundColor: penVar(t.color),
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      fontFamily: "system-ui, sans-serif",
                    }}
                  >
                    {t.name}
                  </span>
                </div>
                {items.map((s, i) => (
                  <div
                    key={i}
                    style={{ display: "flex", gap: "12px", padding: "5px 0" }}
                  >
                    <div
                      style={{
                        flex: 1,
                        fontFamily: '"Times New Roman", Times, serif',
                        fontSize: "14px",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "system-ui, sans-serif",
                          fontSize: "11px",
                          color: "var(--muted)",
                          marginRight: "7px",
                        }}
                      >
                        v{s.verse}
                      </span>
                      <span style={{ backgroundColor: hlVar(s.color), borderRadius: "3px" }}>
                        {s.text}
                      </span>
                    </div>
                    <div
                      style={{
                        flex: 1,
                        fontSize: "12px",
                        fontStyle: "italic",
                        color: "var(--muted)",
                        fontFamily: "system-ui, sans-serif",
                        borderLeft: "1px dashed var(--border)",
                        paddingLeft: "12px",
                      }}
                    >
                      your thoughts…
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      );
    }

    // intro / marking / marked / naming / named / invite → the reading panel
    return (
      <div
        style={{
          fontFamily: '"Times New Roman", Times, serif',
          fontSize: "16px",
          ...stageBox,
        }}
      >
        {legend}
        {renderVerse(DEMO[0], revealedMarks, 0)}
        {renderVerse(DEMO[1], revealedMarks, DEMO[0].marks.length)}
      </div>
    );
  })();

  return (
    <WalkthroughFrame
      label="Walkthrough · Mosiah 18"
      caption={caption}
      onSkip={onClose}
      onNext={showNextButton ? next : undefined}
      nextLabel={nextLabel}
    >
      {stage}
    </WalkthroughFrame>
  );
}
