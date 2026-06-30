import { useLayoutEffect, useRef, useState } from "react";

// One marked span captured from the reader at compile time: its on-screen
// rectangle, its color (1..10), and the text it covers. Only marks currently
// in the viewport are captured, so the animation never handles more than a
// screenful no matter how many marks the study holds.
export interface CompileFlyer {
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
  text: string;
}

// One theme bucket: a color, its name, and the TRUE total count of marks of
// that color across the whole compile (on-screen and off). A handful of marks
// fly; the count carries the real scale.
export interface CompileBucket {
  color: number;
  name: string;
  count: number;
}

interface Props {
  flyers: CompileFlyer[];
  buckets: CompileBucket[];
  duration: number;
  onDone: () => void;
}

const reduced =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function MobileCompileAnimation({
  flyers,
  buckets,
  duration,
  onDone,
}: Props) {
  const [counts, setCounts] = useState<number[]>(() => buckets.map(() => 0));
  const bucketRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cloneRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // Fallback: a tag-only compile has no mark colors to gather. Hold the caption
  // briefly, then move on.
  useLayoutEffect(() => {
    if (buckets.length > 0) return;
    const t = setTimeout(onDone, Math.min(duration, 1100));
    return () => clearTimeout(t);
  }, [buckets.length, duration, onDone]);

  // Drive the fly-into-bucket motion + the count-up once mounted.
  useLayoutEffect(() => {
    if (buckets.length === 0) return;
    const total = reduced ? 1 : Math.max(duration, 1200);

    // Measure each bucket's center so clones know where to fly.
    const centers = bucketRefs.current.map((b) => {
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });

    // First bucket index for each color.
    const idxByColor = new Map<number, number>();
    buckets.forEach((b, i) => {
      if (!idxByColor.has(b.color)) idxByColor.set(b.color, i);
    });

    // Launch each on-screen mark toward its color's bucket.
    flyers.forEach((f, i) => {
      const el = cloneRefs.current[i];
      const bi = idxByColor.get(f.color);
      if (el == null || bi == null) return;
      const c = centers[bi];
      if (!c) return;
      const cx = f.x + f.w / 2;
      const cy = f.y + f.h / 2;
      el.style.transition = "none";
      el.style.transform = "translate(0px,0px) scale(1)";
      el.style.opacity = "1";
      // force reflow so the launch transition actually animates
      void el.offsetWidth;
      const delay = reduced ? 0 : Math.min(0.5, i * 0.03);
      const fd = reduced ? 0 : 0.7;
      el.style.transition =
        "transform " +
        fd +
        "s cubic-bezier(0.4,0,0.2,1) " +
        delay +
        "s, opacity " +
        fd +
        "s ease " +
        delay +
        "s";
      el.style.transform =
        "translate(" + (c.x - cx) + "px," + (c.y - cy) + "px) scale(0.35)";
      el.style.opacity = "0";
    });

    // Tick every bucket up to its true total.
    let raf = 0;
    const t0 = performance.now();
    const targets = buckets.map((b) => b.count);
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / total);
      const e = 1 - Math.pow(1 - p, 3);
      setCounts(targets.map((t) => Math.round(t * e)));
      if (p < 1) raf = requestAnimationFrame(step);
      else setCounts(targets);
    };
    raf = requestAnimationFrame(step);

    const done = setTimeout(onDone, total + 350);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
    // run once for this compile
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        animation: "scribalCompileFade 0.25s ease",
      }}
    >
      <style>{`
        @keyframes scribalCompileFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes scribalCompileDots {
          0% { opacity: 0.2 } 50% { opacity: 1 } 100% { opacity: 0.2 }
        }
      `}</style>

      <div
        style={{
          fontSize: "13.5px",
          letterSpacing: "0.5px",
          color: "#fff",
          opacity: 0.92,
          fontFamily: "system-ui, sans-serif",
          marginBottom: buckets.length ? "26px" : "0px",
        }}
      >
        Gathering your study
        <span style={{ animation: "scribalCompileDots 1.2s infinite", animationDelay: "0s" }}>.</span>
        <span style={{ animation: "scribalCompileDots 1.2s infinite", animationDelay: "0.2s" }}>.</span>
        <span style={{ animation: "scribalCompileDots 1.2s infinite", animationDelay: "0.4s" }}>.</span>
      </div>

      {buckets.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "10px",
            padding: "0 20px",
            maxWidth: "440px",
          }}
        >
          {buckets.map((b, i) => (
            <div
              key={i}
              ref={(el) => (bucketRefs.current[i] = el)}
              style={{
                minWidth: "84px",
                flex: "0 1 96px",
                backgroundColor: "var(--hl" + b.color + ")",
                border: "1.5px solid var(--pen" + b.color + ")",
                borderRadius: "14px",
                padding: "14px 8px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "28px",
                  fontWeight: 800,
                  lineHeight: 1,
                  color: "var(--pen" + b.color + ")",
                  fontVariantNumeric: "tabular-nums",
                  fontFamily: "system-ui, sans-serif",
                }}
              >
                {counts[i] ?? 0}
              </div>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  marginTop: "5px",
                  color: "var(--text)",
                  fontFamily: "system-ui, sans-serif",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "90px",
                }}
              >
                {b.name}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Flying clones of the on-screen marks. Each starts exactly atop its real
          word, then lifts off toward its bucket. */}
      {buckets.length > 0 &&
        flyers.map((f, i) => (
          <span
            key={i}
            ref={(el) => (cloneRefs.current[i] = el)}
            style={{
              position: "fixed",
              left: f.x + "px",
              top: f.y + "px",
              maxWidth: "60vw",
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: "17px",
              lineHeight: 1.2,
              color: "var(--text)",
              backgroundColor: "var(--hl" + f.color + ")",
              boxShadow: "inset 0 -2px 0 var(--pen" + f.color + ")",
              borderRadius: "3px",
              padding: "1px 2px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              pointerEvents: "none",
              willChange: "transform, opacity",
            }}
          >
            {f.text}
          </span>
        ))}
    </div>
  );
}
