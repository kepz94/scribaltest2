import { useEffect, useRef, useState } from "react";

/**
 * The guided first study.
 *
 * Not a tour. Tours show; this one WAITS. Each step asks the user to actually
 * do the thing in the real reader — swipe a mark, name a theme, use a second
 * color, compile — and the guide watches live counts from the app to know
 * when it happened, then advances. The finale is the Map: one screen showing
 * how everything ties together. The guide never interprets scripture and
 * never marks anything itself; it only teaches the loop.
 *
 * The same component doubles as the "How Scribal works" reference: pass
 * startAtMap and it opens straight to the Map.
 */

interface Props {
  colors: {
    panel: string;
    text: string;
    muted: string;
    border: string;
    soft: string;
  };
  accent: string;
  /** Live counts from the active book — the guide advances when they move. */
  markCount: number;
  colorCount: number;
  namedThemeCount: number;
  compileOpen: boolean;
  /** Open straight to the Map (menu: "How Scribal works"). */
  startAtMap?: boolean;
  onClose: (finished: boolean) => void;
}

const SwipeDemo = ({ accent }: { accent: string }) => (
  <div
    style={{
      position: "relative",
      margin: "10px 0 2px",
      padding: "10px 12px",
      borderRadius: "10px",
      background: "rgba(127,127,127,0.08)",
      overflow: "hidden",
    }}
  >
    <style>{`
      @keyframes fsg-sweep {
        0% { width: 0; opacity: 0; }
        15% { opacity: 1; }
        55% { width: 78%; opacity: 1; }
        75% { width: 78%; opacity: 1; }
        100% { width: 78%; opacity: 0; }
      }
      @keyframes fsg-finger {
        0% { left: 8%; opacity: 0; }
        12% { opacity: 1; }
        55% { left: 84%; opacity: 1; }
        70% { opacity: 0; }
        100% { left: 84%; opacity: 0; }
      }
    `}</style>
    <div
      style={{
        fontFamily: '"Times New Roman", Times, serif',
        fontSize: "15px",
        lineHeight: 1.6,
        position: "relative",
        zIndex: 1,
      }}
    >
      …and it came to pass that I did go and do…
    </div>
    <div
      style={{
        position: "absolute",
        left: "8%",
        top: "9px",
        height: "24px",
        borderRadius: "5px",
        background: accent,
        opacity: 0.25,
        animation: "fsg-sweep 2.6s ease-in-out infinite",
      }}
    />
    <div
      style={{
        position: "absolute",
        top: "20px",
        width: "18px",
        height: "18px",
        borderRadius: "50%",
        background: accent,
        opacity: 0.85,
        boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
        animation: "fsg-finger 2.6s ease-in-out infinite",
      }}
    />
  </div>
);

export default function FirstStudyGuide({
  colors: C,
  accent,
  markCount,
  colorCount,
  namedThemeCount,
  compileOpen,
  startAtMap,
  onClose,
}: Props) {
  // Baselines: the guide measures PROGRESS, so users with existing marks
  // aren't skipped ahead or held back.
  const base = useRef({
    marks: markCount,
    colors: colorCount,
    named: namedThemeCount,
  });
  const [step, setStep] = useState(startAtMap ? 5 : 0);

  // Watch the live counts; advance the waiting step when the deed is done.
  useEffect(() => {
    if (step === 1 && markCount > base.current.marks) setStep(2);
  }, [step, markCount]);
  useEffect(() => {
    if (step === 2 && namedThemeCount > base.current.named) setStep(3);
  }, [step, namedThemeCount]);
  useEffect(() => {
    if (step === 3 && (colorCount > base.current.colors || colorCount >= 2))
      setStep(4);
  }, [step, colorCount]);
  useEffect(() => {
    if (step === 4 && compileOpen) setStep(5);
  }, [step, compileOpen]);

  const btn = (
    label: string,
    onClick: () => void,
    primary?: boolean
  ): JSX.Element => (
    <button
      onClick={onClick}
      style={{
        border: primary ? "none" : "1px solid " + C.border,
        borderRadius: "999px",
        background: primary ? accent : "transparent",
        color: primary ? "#fff" : C.muted,
        fontSize: "13.5px",
        fontWeight: 700,
        padding: "10px 18px",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );

  const dots = (
    <div style={{ display: "flex", gap: "5px", marginBottom: "10px" }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          style={{
            width: i === step ? "16px" : "6px",
            height: "6px",
            borderRadius: "3px",
            background: i <= step ? accent : C.border,
            transition: "width .2s ease",
          }}
        />
      ))}
    </div>
  );

  // ---- The Map (step 5): the whole system on one screen ----
  if (step === 5) {
    const node = (
      title: string,
      body: string,
      color?: string
    ): JSX.Element => (
      <div
        style={{
          border: "1px solid " + C.border,
          borderLeft: "3px solid " + (color || accent),
          borderRadius: "12px",
          background: C.panel,
          padding: "11px 13px",
        }}
      >
        <div style={{ fontSize: "13.5px", fontWeight: 700, marginBottom: "2px" }}>
          {title}
        </div>
        <div style={{ fontSize: "12.5px", color: C.muted, lineHeight: 1.5 }}>
          {body}
        </div>
      </div>
    );
    const arrow = (
      <div
        style={{
          width: "2px",
          height: "14px",
          background: C.border,
          marginLeft: "22px",
        }}
      />
    );
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 400,
          background: C.soft,
          color: C.text,
          overflowY: "auto",
          padding:
            "calc(18px + env(safe-area-inset-top)) 18px calc(24px + env(safe-area-inset-bottom))",
        }}
      >
        <div style={{ maxWidth: "560px", margin: "0 auto" }}>
          <div
            style={{
              fontSize: "11px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              color: C.muted,
              fontWeight: 700,
              marginBottom: "6px",
            }}
          >
            How Scribal works
          </div>
          <div
            style={{
              fontSize: "20px",
              fontWeight: 800,
              lineHeight: 1.3,
              marginBottom: "4px",
            }}
          >
            Everything flows from your marking.
          </div>
          <div
            style={{
              fontSize: "13px",
              color: C.muted,
              lineHeight: 1.55,
              marginBottom: "16px",
            }}
          >
            Scribal never tells you what a verse means. You mark; it organizes.
          </div>

          {node(
            "1 · Read & mark",
            "Swipe across words — no press-and-hold. Five tools, ten colors, character-level precision."
          )}
          {arrow}
          {node(
            "2 · Name your themes",
            "Each color is a theme. Name it what YOU see — \"Faith\", \"The Lord's voice\", anything. Names live per chapter, so the same color can mean different things in different studies."
          )}
          {arrow}
          {node(
            "3 · Compile — marking becomes notes",
            "One tap turns a chapter's marks into a study: your themes as sections, your verses under them, your emphasis preserved. Outline for structure, Relational for connections you thread between verses."
          )}
          {arrow}
          {node(
            "4 · Arrange & present",
            "Send verses to a Study table: order them into a lesson with headings, questions, quotes and clips, then Present it — or share a live room by QR.",
            "#16a34a"
          )}

          <div
            style={{
              margin: "18px 0 8px",
              fontSize: "11px",
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              color: C.muted,
              fontWeight: 700,
            }}
          >
            Two power moves
          </div>
          <div style={{ display: "grid", gap: "8px" }}>
            {node(
              "Link chapters",
              "Studying a story that spans chapters? Link them and they compile as ONE study — themes carry across.",
              C.muted
            )}
            {node(
              "Keyword search",
              "Search any word across all scripture, gather the verses you choose into a study — no chapter required.",
              C.muted
            )}
          </div>

          <div
            style={{
              marginTop: "20px",
              display: "flex",
              gap: "10px",
              justifyContent: "flex-end",
            }}
          >
            {btn(startAtMap ? "Close" : "Start studying", () => onClose(true), true)}
          </div>
        </div>
      </div>
    );
  }

  // ---- Steps 0–4: the coach card, docked above the toolbar ----
  const content: Record<
    number,
    { title: string; body: string; demo?: boolean; waitLabel?: string }
  > = {
    0: {
      title: "Learn Scribal by doing it — 90 seconds.",
      body: "This app doesn't take notes for you. It turns YOUR marking into notes. Do the loop once with real scripture and you'll have the whole app.",
    },
    1: {
      title: "Mark something.",
      body: "Pick a tool and a color below, then SWIPE across words that stand out — drag straight through them, no press-and-hold. Anywhere on this page.",
      demo: true,
      waitLabel: "Waiting for your first mark…",
    },
    2: {
      title: "That color is a theme. Name it.",
      body: "Tap the color's name in the toolbar legend and call it what YOU see in what you marked — \"Faith\", \"Warnings\", anything. Named themes are what turn marks into organized notes.",
      waitLabel: "Waiting for a theme name…",
    },
    3: {
      title: "New idea? New color.",
      body: "Switch to a different color and mark a second idea. Different colors become different sections of your notes.",
      waitLabel: "Waiting for a second color…",
    },
    4: {
      title: "Now compile.",
      body: "Tap Compile and watch: your marks become a study — your themes as headings, your verses underneath, your emphasis kept.",
      waitLabel: "Waiting for your first compile…",
    },
  };
  const c = content[step];

  return (
    <div
      style={{
        position: "fixed",
        left: "10px",
        right: "10px",
        bottom: "calc(96px + env(safe-area-inset-bottom))",
        zIndex: 230,
        background: C.panel,
        color: C.text,
        border: "1px solid " + C.border,
        borderRadius: "16px",
        boxShadow: "0 18px 50px -14px rgba(0,0,0,0.45)",
        padding: "14px 16px",
        maxWidth: "560px",
        margin: "0 auto",
      }}
    >
      {dots}
      <div style={{ fontSize: "15.5px", fontWeight: 800, marginBottom: "4px" }}>
        {c.title}
      </div>
      <div style={{ fontSize: "13px", color: C.muted, lineHeight: 1.55 }}>
        {c.body}
      </div>
      {c.demo && <SwipeDemo accent={accent} />}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginTop: "12px",
        }}
      >
        {c.waitLabel && (
          <span
            style={{
              fontSize: "11.5px",
              color: C.muted,
              fontStyle: "italic",
              flex: 1,
              minWidth: 0,
            }}
          >
            {c.waitLabel}
          </span>
        )}
        {!c.waitLabel && <span style={{ flex: 1 }} />}
        {btn("Skip", () => onClose(false))}
        {step === 0
          ? btn("Start", () => setStep(1), true)
          : btn("Next", () => setStep(step + 1))}
      </div>
    </div>
  );
}
