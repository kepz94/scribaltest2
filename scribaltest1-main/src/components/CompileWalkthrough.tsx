import { useState, useEffect } from "react";
import { THEMES, FLAT_MARKS, DEMO, hlVar, penVar } from "./walkthroughDemo";
import WalkthroughFrame from "./WalkthroughFrame";

interface Props {
  onClose: () => void;
}

type Phase = "intro" | "cornell" | "outline" | "charting" | "map" | "done";

const ORDER: Phase[] = ["intro", "cornell", "outline", "charting", "map", "done"];

const stageBox: React.CSSProperties = {
  backgroundColor: "var(--bg)",
  borderRadius: "12px",
  border: "1px solid var(--border)",
  padding: "16px 18px",
  fontFamily: "system-ui, sans-serif",
};

export default function CompileWalkthrough({ onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [shown, setShown] = useState(false);

  useEffect(() => {
    setShown(false);
    const t = window.setTimeout(() => setShown(true), 40);
    return () => clearTimeout(t);
  }, [phase]);

  const idx = ORDER.indexOf(phase);
  const next = () =>
    phase === "done" ? onClose() : setPhase(ORDER[idx + 1]);

  const caption = (() => {
    switch (phase) {
      case "intro":
        return "You marked Mosiah 18 in two themes. Compile gathers those marks four different ways so you can see the patterns.";
      case "cornell":
        return "Cornell Notes groups your marks by theme, with room for your own thoughts beside each verse.";
      case "outline":
        return "Outline ranks the verses by how heavily you marked them — the busiest verses rise to the top.";
      case "charting":
        return "Charting lays it out as a grid: themes across the top, verses down the side, so you see where attention clustered.";
      case "map":
        return "Concept Map turns each theme into a node you can drag and connect — the shape of your study becomes visible.";
      case "done":
        return "Pick which open tabs to include, switch views anytime, and tap any reference to jump back to the verse.";
      default:
        return "";
    }
  })();

  const nextLabel = (() => {
    switch (phase) {
      case "intro":
        return "Cornell Notes →";
      case "cornell":
        return "Outline →";
      case "outline":
        return "Charting →";
      case "charting":
        return "Concept Map →";
      case "map":
        return "Wrap up →";
      case "done":
        return "Got it";
      default:
        return "";
    }
  })();

  const reveal = (delay: number): React.CSSProperties => ({
    opacity: shown ? 1 : 0,
    transform: shown ? "translateY(0)" : "translateY(6px)",
    transition: `opacity 0.4s ${delay}ms, transform 0.4s ${delay}ms`,
  });

  const stage = (() => {
    if (phase === "intro" || phase === "cornell") {
      return (
        <div style={stageBox}>
          {THEMES.map((t, ti) => {
            const items = FLAT_MARKS.filter((m) => m.color === t.color);
            return (
              <div key={t.color} style={{ marginBottom: "12px", ...reveal(ti * 120) }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    paddingBottom: "6px",
                    marginBottom: "6px",
                    borderBottom: "2px solid " + penVar(t.color),
                  }}
                >
                  <span
                    style={{
                      width: "11px",
                      height: "11px",
                      borderRadius: "50%",
                      backgroundColor: penVar(t.color),
                    }}
                  />
                  <span style={{ fontSize: "13px", fontWeight: 600 }}>{t.name}</span>
                </div>
                {items.map((s, i) => (
                  <div key={i} style={{ display: "flex", gap: "10px", padding: "4px 0" }}>
                    <div style={{ flex: 1, fontFamily: '"Times New Roman", Times, serif', fontSize: "13px" }}>
                      <span style={{ fontSize: "10px", color: "var(--muted)", marginRight: "6px" }}>
                        v{s.verse}
                      </span>
                      <span style={{ backgroundColor: hlVar(s.color), borderRadius: "3px" }}>
                        {s.text}
                      </span>
                    </div>
                    <div
                      style={{
                        flex: 1,
                        fontSize: "11px",
                        fontStyle: "italic",
                        color: "var(--muted)",
                        borderLeft: "1px dashed var(--border)",
                        paddingLeft: "10px",
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

    if (phase === "outline") {
      // verses ranked by mark count
      const counts = DEMO.map((v) => ({ verse: v.verse, n: v.marks.length })).sort(
        (a, b) => b.n - a.n
      );
      const max = Math.max(...counts.map((c) => c.n));
      return (
        <div style={stageBox}>
          {counts.map((c, i) => (
            <div key={c.verse} style={{ marginBottom: "12px", ...reveal(i * 140) }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
                <span style={{ fontWeight: 600 }}>Mosiah 18:{c.verse}</span>
                <span style={{ color: "var(--muted)" }}>
                  {c.n} {c.n === 1 ? "mark" : "marks"}
                </span>
              </div>
              <div style={{ height: "10px", backgroundColor: "var(--soft)", borderRadius: "5px", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: shown ? (c.n / max) * 100 + "%" : "0%",
                    backgroundColor: "#8b5cf6",
                    borderRadius: "5px",
                    transition: `width 0.6s ${i * 140}ms`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (phase === "charting") {
      const verses = DEMO.map((v) => v.verse);
      const hasMark = (color: number, verse: number) =>
        DEMO.some((v) => v.verse === verse && v.marks.some((m) => m.color === color));
      return (
        <div style={{ ...stageBox, ...reveal(0) }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px", color: "var(--muted)" }}>Theme</th>
                {verses.map((v) => (
                  <th key={v} style={{ padding: "6px", color: "var(--muted)" }}>
                    v{v}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {THEMES.map((t) => (
                <tr key={t.color} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 6px", fontWeight: 600 }}>{t.name}</td>
                  {verses.map((v) => (
                    <td key={v} style={{ padding: "8px 6px", textAlign: "center" }}>
                      {hasMark(t.color, v) ? (
                        <span
                          style={{
                            display: "inline-block",
                            width: "13px",
                            height: "13px",
                            borderRadius: "50%",
                            backgroundColor: penVar(t.color),
                          }}
                        />
                      ) : (
                        <span style={{ color: "var(--border)" }}>·</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    // map
    return (
      <div style={{ ...stageBox, minHeight: "180px", position: "relative" }}>
        <svg width="100%" height="170" style={{ display: "block" }}>
          <line
            x1="28%"
            y1="50%"
            x2="72%"
            y2="50%"
            stroke="var(--border)"
            strokeWidth="2"
            strokeDasharray="4 4"
            style={{ opacity: shown ? 1 : 0, transition: "opacity 0.5s 300ms" }}
          />
        </svg>
        {THEMES.map((t, i) => (
          <div
            key={t.color}
            style={{
              position: "absolute",
              top: "38%",
              left: i === 0 ? "10%" : "58%",
              width: "32%",
              textAlign: "center",
              opacity: shown ? 1 : 0,
              transform: shown ? "scale(1)" : "scale(0.85)",
              transition: `opacity 0.4s ${i * 200}ms, transform 0.4s ${i * 200}ms`,
            }}
          >
            <div
              style={{
                backgroundColor: hlVar(t.color),
                border: "2px solid " + penVar(t.color),
                borderRadius: "12px",
                padding: "10px 8px",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              {t.name}
              <div style={{ fontSize: "10px", fontWeight: 400, color: "var(--muted)", marginTop: "3px" }}>
                {FLAT_MARKS.filter((m) => m.color === t.color).length} marks
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  })();

  return (
    <WalkthroughFrame
      label="Walkthrough · Compile"
      caption={caption}
      onSkip={onClose}
      onNext={next}
      nextLabel={nextLabel}
    >
      {stage}
    </WalkthroughFrame>
  );
}
