import { useEffect } from "react";

interface Props {
  duration: number;
  onDone: () => void;
}

const PENS = [
  "--pen1",
  "--pen2",
  "--pen3",
  "--pen4",
  "--pen5",
  "--pen6",
  "--pen7",
];

export default function CompileAnimation({ duration, onDone }: Props) {
  useEffect(() => {
    const t = setTimeout(onDone, duration);
    return () => clearTimeout(t);
  }, [duration, onDone]);

  const big = duration >= 2000;
  const R = 62;
  const C = 2 * Math.PI * R;
  const dotDur = big ? 1.25 : 0.9; // seconds, repeating gather
  const ringDur = duration / 1000; // seconds, single pass

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        backgroundColor: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        animation: "scribalFadeIn 0.25s ease",
      }}
    >
      <style>{`
        @keyframes scribalFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes scribalPulse {
          0%, 100% { transform: scale(1); opacity: 0.9 }
          50% { transform: scale(1.18); opacity: 1 }
        }
        @keyframes scribalEllipsis {
          0% { opacity: 0.2 } 50% { opacity: 1 } 100% { opacity: 0.2 }
        }
      `}</style>

      <svg
        viewBox="0 0 200 200"
        width="180"
        height="180"
        style={{ overflow: "visible" }}
      >
        {/* Track ring */}
        <circle
          cx="100"
          cy="100"
          r={R}
          fill="none"
          stroke="var(--border)"
          strokeWidth="3"
        />
        {/* Progress ring (real, timed to duration) */}
        <circle
          cx="100"
          cy="100"
          r={R}
          fill="none"
          stroke="var(--text)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={C}
          transform="rotate(-90 100 100)"
        >
          <animate
            attributeName="stroke-dashoffset"
            from={C}
            to="0"
            dur={ringDur + "s"}
            fill="freeze"
            calcMode="spline"
            keySplines="0.4 0 0.2 1"
            keyTimes="0;1"
            values={C + ";0"}
          />
        </circle>

        {/* Forming "page" in the center */}
        <g
          style={{
            transformOrigin: "100px 100px",
            animation: "scribalPulse 1.4s ease-in-out infinite",
          }}
        >
          <rect
            x="84"
            y="80"
            width="32"
            height="40"
            rx="3"
            fill="var(--panel)"
            stroke="var(--text)"
            strokeWidth="2"
          />
          <line
            x1="90"
            y1="90"
            x2="110"
            y2="90"
            stroke="var(--muted)"
            strokeWidth="2"
          />
          <line
            x1="90"
            y1="97"
            x2="110"
            y2="97"
            stroke="var(--muted)"
            strokeWidth="2"
          />
          <line
            x1="90"
            y1="104"
            x2="104"
            y2="104"
            stroke="var(--muted)"
            strokeWidth="2"
          />
        </g>

        {/* Converging mark-colors */}
        {PENS.map((pen, i) => {
          const angle = (i / PENS.length) * Math.PI * 2 - Math.PI / 2;
          const ox = 100 + Math.cos(angle) * 78;
          const oy = 100 + Math.sin(angle) * 78;
          const begin = (i * (dotDur / PENS.length)).toFixed(2) + "s";
          return (
            <circle key={pen} r="5" fill={"var(" + pen + ")"} cx={ox} cy={oy}>
              <animate
                attributeName="cx"
                values={ox + ";100"}
                dur={dotDur + "s"}
                begin={begin}
                repeatCount="indefinite"
                calcMode="spline"
                keySplines="0.3 0 0.2 1"
                keyTimes="0;1"
              />
              <animate
                attributeName="cy"
                values={oy + ";100"}
                dur={dotDur + "s"}
                begin={begin}
                repeatCount="indefinite"
                calcMode="spline"
                keySplines="0.3 0 0.2 1"
                keyTimes="0;1"
              />
              <animate
                attributeName="opacity"
                values="0;1;1;0"
                keyTimes="0;0.2;0.7;1"
                dur={dotDur + "s"}
                begin={begin}
                repeatCount="indefinite"
              />
              <animate
                attributeName="r"
                values="5;2"
                dur={dotDur + "s"}
                begin={begin}
                repeatCount="indefinite"
              />
            </circle>
          );
        })}
      </svg>

      <div
        style={{
          marginTop: "26px",
          fontSize: "14px",
          letterSpacing: "1px",
          color: "var(--text)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {big ? "Gathering your study" : "Updating compilation"}
        <span
          style={{
            animation: "scribalEllipsis 1.2s infinite",
            animationDelay: "0s",
          }}
        >
          .
        </span>
        <span
          style={{
            animation: "scribalEllipsis 1.2s infinite",
            animationDelay: "0.2s",
          }}
        >
          .
        </span>
        <span
          style={{
            animation: "scribalEllipsis 1.2s infinite",
            animationDelay: "0.4s",
          }}
        >
          .
        </span>
      </div>
    </div>
  );
}
