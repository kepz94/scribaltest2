import { useState, useRef, useLayoutEffect } from "react";

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

/*
  The compile animation: your marks gather into a book.

  Two entry shapes, one motion:
   - PULL mode (compiling what you're reading): the on-screen marks lift off the
     page as tiles, stream into an orbit, become color dots, then drop one-by-one
     into an opening two-page book that inks in with their colors.
   - SYNTH mode (keyword / combined / saved studies whose marks aren't on screen):
     the dots materialize from the study's own mark colors at the orbit, then the
     same spin -> open -> drop-in plays out.

  When the book is full, the whole thing grows and fades, handing off to the real
  compiled view (MobileCompile) that mounts underneath.
*/

interface Props {
  // On-screen marks (rectangles + color + text). Drives the PULL.
  flyers: CompileFlyer[];
  // Every compiled mark's color (1..10). Drives SYNTH and the inking lines.
  colors: number[];
  // Loosely respected; the book has its own internal pacing.
  duration: number;
  onDone: () => void;
}

const CAP = 12; // marks that fly / drop in (the count is carried by the real view)
const TILE = "#FBF7EC";
const INK = "#2B2620";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";
const penVar = (c: number) => "var(--pen" + (c || 1) + ")";

const RAD = 100; // orbit horizontal radius
const RY = 46; // orbit vertical radius (perspective ellipse)

type Dot = { key: string; color: number; text: string; x: number; y: number; w: number; h: number };

export default function MobileCompileBook({ flyers, colors, duration, onDone }: Props) {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const pull = flyers.length > 0;
  const src: Dot[] = pull
    ? flyers.slice(0, CAP).map((f, i) => ({ key: "f" + i, color: f.color, text: f.text, x: f.x, y: f.y, w: f.w, h: f.h }))
    : colors.slice(0, CAP).map((c, i) => ({ key: "c" + i, color: c, text: "", x: 0, y: 0, w: 0, h: 0 }));
  const N = src.length;

  const [act, setAct] = useState<"intro" | "spin" | "open" | "gather" | "end">("intro");
  const [landed, setLanded] = useState<boolean[]>([]);

  const center = useRef({
    x: typeof window !== "undefined" ? window.innerWidth / 2 : 200,
    y: typeof window !== "undefined" ? window.innerHeight * 0.42 : 320,
  });
  const dotRefs = useRef<Record<string, HTMLElement | null>>({});
  const rowRefs = useRef<Record<string, HTMLElement | null>>({});
  const landedRef = useRef<boolean[]>([]);
  const spinRaf = useRef(0);
  const spinT0 = useRef(0);
  const tims = useRef<ReturnType<typeof setTimeout>[]>([]);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // angle of dot i around the orbit
  const angleOf = (i: number) => (i / Math.max(1, N)) * Math.PI * 2 - Math.PI / 2;
  const baseCenter = (d: Dot) => (pull ? { x: d.x + d.w / 2, y: d.y + d.h / 2 } : { x: center.current.x, y: center.current.y });

  useLayoutEffect(() => {
    const cx = center.current.x;
    const cy = center.current.y;
    const SPEED = (Math.PI * 2 * 0.8) / 1000;

    const LIFT = reduced ? 1 : 320;
    const READ = reduced ? 1 : 360;
    const FLY = reduced ? 1 : 920;
    const SYNTH = reduced ? 1 : 480;
    const SPIN = reduced ? 1 : 640;
    const OPEN = reduced ? 1 : 500;
    const END = reduced ? 1 : 480;
    const GSTAG = reduced ? 0 : 66;
    const GFLY = reduced ? 1 : 460;
    const gDur = reduced ? 1 : Math.max(0, N - 1) * GSTAG + GFLY + 200;
    const introEnd = pull ? LIFT + READ + FLY : SYNTH;

    // initial placement
    src.forEach((d) => {
      const el = dotRefs.current[d.key];
      if (!el) return;
      el.style.transition = "none";
      el.style.transform = "translate(0px,0px) scale(" + (pull ? 1 : 0.4) + ")";
      if (!pull) el.style.opacity = "0";
    });

    const raf1 = requestAnimationFrame(() => {
      if (pull) {
        // lift the tiles off the page
        src.forEach((d, i) => {
          const el = dotRefs.current[d.key];
          if (!el) return;
          const dl = Math.min(340, i * 22);
          el.style.transition = "transform 0.34s cubic-bezier(0.34,1.45,0.5,1) " + dl + "ms";
          el.style.transform = "translateY(-10px) scale(1.32)";
        });
      } else {
        // materialize the dots at the orbit
        src.forEach((d, i) => {
          const el = dotRefs.current[d.key];
          if (!el) return;
          const ang = angleOf(i);
          const ox = cx + Math.cos(ang) * RAD;
          const oy = cy + Math.sin(ang) * RY;
          const dl = Math.min(360, i * 30);
          el.style.transition =
            "transform " + SYNTH + "ms cubic-bezier(0.4,0,0.2,1) " + dl + "ms, opacity 260ms ease " + dl + "ms";
          el.style.transform = "translate(" + (ox - cx) + "px," + (oy - cy) + "px) scale(1)";
          el.style.opacity = "1";
        });
      }
    });

    // PULL: stream tiles into the orbit (as words)
    let tFly: ReturnType<typeof setTimeout> | null = null;
    if (pull) {
      tFly = setTimeout(() => {
        src.forEach((d, i) => {
          const el = dotRefs.current[d.key];
          if (!el) return;
          const ang = angleOf(i);
          const c = baseCenter(d);
          const ox = cx + Math.cos(ang) * RAD;
          const oy = cy + Math.sin(ang) * RY;
          const dl = Math.min(720, i * 56);
          el.style.transition = "transform " + FLY + "ms cubic-bezier(0.36,0,0.18,1) " + dl + "ms";
          el.style.transform = "translate(" + (ox - c.x) + "px," + (oy - c.y) + "px) scale(1.05)";
        });
      }, LIFT + READ);
    }

    // SPIN: orbit the book in 3D (passing behind it at the back)
    const tSpin = setTimeout(() => {
      setAct("spin");
      spinT0.current = performance.now();
      const loop = (now: number) => {
        const dt = now - spinT0.current;
        src.forEach((d, i) => {
          const el = dotRefs.current[d.key];
          if (!el) return;
          const ang = angleOf(i) + SPEED * dt;
          const depth = (Math.sin(ang) + 1) / 2;
          const ox = cx + Math.cos(ang) * RAD;
          const oy = cy + Math.sin(ang) * RY;
          const c = baseCenter(d);
          const sc = 0.78 + 0.34 * depth;
          el.style.transition = "none";
          el.style.zIndex = Math.sin(ang) < 0 ? "51" : "61";
          el.style.transform = "translate(" + (ox - c.x) + "px," + (oy - c.y) + "px) scale(" + sc + ")";
        });
        spinRaf.current = requestAnimationFrame(loop);
      };
      spinRaf.current = requestAnimationFrame(loop);
    }, introEnd);

    // OPEN: the center book opens into a blank two-page spread
    const tOpen = setTimeout(() => setAct("open"), introEnd + SPIN);

    // GATHER: each dot breaks from the orbit, flies onto a page, drops in as a line
    const tGather = setTimeout(() => {
      cancelAnimationFrame(spinRaf.current);
      setAct("gather");
      landedRef.current = new Array(N).fill(false);
      setLanded(landedRef.current.slice());
      requestAnimationFrame(() => {
        src.forEach((d, i) => {
          const el = dotRefs.current[d.key];
          const rowEl = rowRefs.current[d.key];
          if (!el) return;
          const c = baseCenter(d);
          let sx = cx;
          let sy = cy;
          if (rowEl) {
            const rr = rowEl.getBoundingClientRect();
            sx = rr.left + rr.width / 2;
            sy = rr.top + rr.height / 2;
          }
          const delay = i * GSTAG;
          el.style.zIndex = "61";
          el.style.transition =
            "transform " + GFLY + "ms cubic-bezier(0.5,0.02,0.3,1) " + delay + "ms, opacity 180ms ease " + (delay + GFLY - 120) + "ms";
          el.style.transform = "translate(" + (sx - c.x) + "px," + (sy - c.y) + "px) scale(0.45)";
          el.style.opacity = "0";
          const tl = setTimeout(() => {
            landedRef.current[i] = true;
            setLanded(landedRef.current.slice());
          }, delay + GFLY - 150);
          tims.current.push(tl);
        });
      });
    }, introEnd + SPIN + OPEN);

    // END: the full book grows and the overlay fades; hand off to the real view
    const tEnd = setTimeout(() => {
      setAct("end");
      const t2 = setTimeout(() => onDoneRef.current(), END);
      tims.current.push(t2);
    }, introEnd + SPIN + OPEN + gDur);

    tims.current.push(tSpin, tOpen, tGather, tEnd);
    if (tFly) tims.current.push(tFly);

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(spinRaf.current);
      tims.current.forEach((t) => clearTimeout(t));
      tims.current = [];
    };
    // eslint-disable-next-line
  }, []);

  const coverOpen = act === "open" || act === "gather" || act === "end";
  const ringFade = act === "gather" || act === "end";
  const asDot = pull ? act !== "intro" : true;
  const ending = act === "end";
  const label = pull && act === "intro" ? "Pulling your marks" : "Gathering your study";
  const backdropOpacity = ending ? 0 : act === "intro" && pull ? 0.5 : 1;

  // marks split across the two pages; each inks a line of its color when it lands
  const leftItems: { d: Dot; i: number }[] = [];
  const rightItems: { d: Dot; i: number }[] = [];
  src.forEach((d, i) => (i % 2 === 0 ? leftItems : rightItems).push({ d, i }));

  const C = center.current;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 480,
        pointerEvents: "none",
        animation: "scribalFadeIn 0.25s ease",
      }}
    >
      <style>{`
        @keyframes scribalFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes mcb-pulse { 0%,100%{transform:scale(1);opacity:0.92} 50%{transform:scale(1.16);opacity:1} }
        @keyframes mcb-ell { 0%{opacity:0.2} 50%{opacity:1} 100%{opacity:0.2} }
        .mcb-bk { position: relative; width: 78px; height: 66px; display: flex; align-items: center; justify-content: center; perspective: 560px; }
        .mcb-spread { position: absolute; inset: 0; display: flex; transform-origin: center; transition: transform 0.5s cubic-bezier(0.34,1.2,0.5,1); }
        .mcb-page { width: 50%; height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 5px; padding: 7px 6px; box-sizing: border-box; background: linear-gradient(180deg,#ffffff,#f1e9d8); }
        .mcb-left { border: 1px solid #d9cbac; border-right: none; border-radius: 3px 0 0 3px; box-shadow: inset -5px 0 8px rgba(0,0,0,0.06); align-items: flex-end; }
        .mcb-right { border: 1px solid #d9cbac; border-left: none; border-radius: 0 3px 3px 0; box-shadow: inset 5px 0 8px rgba(0,0,0,0.06); align-items: flex-start; }
        .mcb-slot { width: 100%; height: 3px; display: flex; }
        .mcb-left .mcb-slot { justify-content: flex-end; }
        .mcb-right .mcb-slot { justify-content: flex-start; }
        .mcb-fill { height: 2.5px; border-radius: 1.5px; transition: transform 0.3s cubic-bezier(0.3,1.3,0.5,1), opacity 0.2s ease; }
        .mcb-left .mcb-fill { transform-origin: right center; }
        .mcb-right .mcb-fill { transform-origin: left center; }
        .mcb-gutter { position: absolute; left: 50%; top: 4px; bottom: 4px; width: 2px; transform: translateX(-1px); background: rgba(0,0,0,0.16); border-radius: 1px; }
        .mcb-cover { position: absolute; left: 50%; top: 0; margin-left: -23px; width: 46px; height: 66px; transform-origin: center; border-radius: 3px; background: linear-gradient(135deg,#4c3f30,#241c14); box-shadow: 1px 2px 10px rgba(0,0,0,0.45); transition: opacity 0.4s ease, transform 0.5s cubic-bezier(0.45,0,0.15,1); }
        .mcb-spine { position: absolute; left: 3px; top: 6px; bottom: 6px; width: 2px; border-radius: 1px; background: rgba(255,255,255,0.28); }
      `}</style>

      {/* backdrop */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          opacity: backdropOpacity,
          transition: "opacity 0.5s ease",
        }}
      />

      {/* spinner: ring + opening book + label */}
      <div
        style={{
          position: "absolute",
          left: C.x,
          top: C.y,
          transform: "translate(-50%,-50%) scale(" + (ending ? 1.7 : 1) + ")",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          opacity: ending ? 0 : act === "intro" && pull ? 0.55 : 1,
          transition: "opacity 0.5s ease, transform 0.55s cubic-bezier(0.3,0,0.2,1)",
        }}
      >
        <div style={{ position: "relative", width: 200, height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg
            viewBox="0 0 200 200"
            width="200"
            height="200"
            style={{ position: "absolute", inset: 0, overflow: "visible", opacity: ringFade ? 0 : 1, transition: "opacity 0.4s ease" }}
          >
            <circle cx="100" cy="100" r="62" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="3" />
            <circle
              cx="100"
              cy="100"
              r="62"
              fill="none"
              stroke="#fff"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 62}
              transform="rotate(-90 100 100)"
            >
              <animate
                attributeName="stroke-dashoffset"
                from={2 * Math.PI * 62}
                to="0"
                dur={(reduced ? 0.001 : Math.max(1.6, duration / 1000 + 1.6)) + "s"}
                fill="freeze"
                calcMode="spline"
                keySplines="0.4 0 0.2 1"
                keyTimes="0;1"
                values={2 * Math.PI * 62 + ";0"}
              />
            </circle>
          </svg>

          {/* the center book */}
          <div className="mcb-bk" style={{ transform: "scale(" + (coverOpen ? 1.5 : 1) + ")", transition: "transform 0.5s cubic-bezier(0.34,1.2,0.5,1)" }}>
            <div className="mcb-spread" style={{ transform: "scaleX(" + (coverOpen ? 1 : 0.12) + ")" }}>
              <div className="mcb-page mcb-left">
                {leftItems.map(({ d, i }) => {
                  const isLanded = !!landed[i];
                  const w = 52 + ((i * 29) % 40);
                  return (
                    <span key={d.key} className="mcb-slot" ref={(el) => (rowRefs.current[d.key] = el)}>
                      <span
                        className="mcb-fill"
                        style={{ width: w + "%", background: penVar(d.color), transform: isLanded ? "scaleX(1)" : "scaleX(0)", opacity: isLanded ? 1 : 0 }}
                      />
                    </span>
                  );
                })}
              </div>
              <div className="mcb-page mcb-right">
                {rightItems.map(({ d, i }) => {
                  const isLanded = !!landed[i];
                  const w = 52 + ((i * 29) % 40);
                  return (
                    <span key={d.key} className="mcb-slot" ref={(el) => (rowRefs.current[d.key] = el)}>
                      <span
                        className="mcb-fill"
                        style={{ width: w + "%", background: penVar(d.color), transform: isLanded ? "scaleX(1)" : "scaleX(0)", opacity: isLanded ? 1 : 0 }}
                      />
                    </span>
                  );
                })}
              </div>
              <span className="mcb-gutter" />
            </div>
            <div className="mcb-cover" style={{ opacity: coverOpen ? 0 : 1, transform: "rotateY(" + (coverOpen ? -38 : 0) + "deg) scale(" + (coverOpen ? 0.92 : 1) + ")" }}>
              <span className="mcb-spine" />
            </div>
          </div>
        </div>
        <div style={{ marginTop: 16, fontSize: 14, letterSpacing: "1px", color: "#fff", fontFamily: SANS }}>
          {label}
          <span style={{ animation: "mcb-ell 1.2s infinite" }}>.</span>
          <span style={{ animation: "mcb-ell 1.2s infinite", animationDelay: "0.2s" }}>.</span>
          <span style={{ animation: "mcb-ell 1.2s infinite", animationDelay: "0.4s" }}>.</span>
        </div>
      </div>

      {/* the marks in transit: a tile (pull) that morphs to a color dot */}
      {src.map((d) => {
        const base = pull
          ? { left: d.x, top: d.y, width: d.w, height: d.h }
          : { left: C.x - 8, top: C.y - 8, width: 16, height: 16 };
        return (
          <div
            key={d.key}
            ref={(el) => (dotRefs.current[d.key] = el)}
            style={{
              position: "absolute",
              left: base.left,
              top: base.top,
              width: base.width,
              height: base.height,
              zIndex: 61,
              pointerEvents: "none",
              willChange: "transform, opacity",
            }}
          >
            {pull && (
              <span
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  transform: "translate(-50%,-50%)",
                  fontFamily: SERIF,
                  fontSize: 16.5,
                  lineHeight: "1",
                  color: INK,
                  background: TILE,
                  boxShadow: "0 4px 14px rgba(0,0,0,0.30), inset 0 -2px 0 " + penVar(d.color),
                  borderRadius: 5,
                  padding: "3px 6px",
                  whiteSpace: "nowrap",
                  maxWidth: 160,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  opacity: asDot ? 0 : 1,
                  transition: "opacity 0.26s ease",
                }}
              >
                {d.text}
              </span>
            )}
            <span
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 13,
                height: 13,
                borderRadius: "50%",
                background: penVar(d.color),
                boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
                transform: "translate(-50%,-50%) scale(" + (asDot ? 1 : 0.3) + ")",
                opacity: asDot ? 1 : 0,
                transition: "opacity 0.26s ease, transform 0.26s ease",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
