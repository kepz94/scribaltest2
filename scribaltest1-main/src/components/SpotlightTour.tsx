import { useEffect, useRef, useState } from "react";

// A guided tour that spotlights REAL elements on the live screen. Each step
// can (optionally) drive app state via `before` — e.g. open compile, switch to
// the Relational view — so the highlighted element is actually on screen when
// the step runs. Targets are CSS selectors; a step with no target shows a
// centered card (for intros / hand-offs between sections).

export interface TourStep {
  target?: string;
  title: string;
  body: string;
  placement?: "top" | "bottom" | "left" | "right" | "auto";
  padding?: number;
  before?: () => void;
}

interface SpotlightTourProps {
  steps: TourStep[];
  label?: string;
  accent?: string;
  onClose: () => void;
  onDone?: () => void;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export default function SpotlightTour({
  steps,
  label = "Walkthrough",
  accent = "#8b5cf6",
  onClose,
  onDone,
}: SpotlightTourProps) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);

  // Latest values held in refs so the effects below can stay dependency-free
  // (and never re-fire on every render or trip exhaustive-deps).
  const iRef = useRef(0);
  iRef.current = i;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const total = steps.length;
  const step = steps[i];

  // Measure the current target (or clear, for a centered step).
  const measureRef = useRef<() => void>(() => {});
  measureRef.current = () => {
    const s = stepsRef.current[iRef.current];
    if (!s || !s.target) {
      setBox(null);
      return;
    }
    const el = document.querySelector(s.target) as HTMLElement | null;
    if (!el) {
      setBox(null);
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      setBox(null);
      return;
    }
    const pad = s.padding == null ? 8 : s.padding;
    setBox({
      top: r.top - pad,
      left: r.left - pad,
      width: r.width + pad * 2,
      height: r.height + pad * 2,
    });
  };

  const finishRef = useRef<() => void>(() => {});
  finishRef.current = () => (onDoneRef.current || onCloseRef.current)();
  const advanceRef = useRef<() => void>(() => {});
  advanceRef.current = () => {
    if (iRef.current >= stepsRef.current.length - 1) finishRef.current();
    else setI(iRef.current + 1);
  };
  const backRef = useRef<() => void>(() => {});
  backRef.current = () => {
    if (iRef.current > 0) setI(iRef.current - 1);
  };

  // Per-step: run before(), bring the target into view, then measure once the
  // (smooth) scroll and any state change have settled.
  useEffect(() => {
    const timers: number[] = [];
    const s = stepsRef.current[iRef.current];
    if (s && s.before) {
      try {
        s.before();
      } catch {
        // a step's state hook shouldn't break the tour
      }
    }
    timers.push(
      window.setTimeout(() => {
        const cur = stepsRef.current[iRef.current];
        if (cur && cur.target) {
          const el = document.querySelector(cur.target) as HTMLElement | null;
          if (el && typeof el.scrollIntoView === "function")
            el.scrollIntoView({
              block: "center",
              inline: "center",
              behavior: "smooth",
            });
        }
        timers.push(window.setTimeout(() => measureRef.current(), 340));
      }, 60)
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [i]);

  // Keep the spotlight glued to the element as the page scrolls or resizes.
  useEffect(() => {
    let raf = 0;
    const onMove = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => measureRef.current());
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Keyboard: Esc closes, arrows / Enter navigate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      else if (e.key === "ArrowRight" || e.key === "Enter") advanceRef.current();
      else if (e.key === "ArrowLeft") backRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!step) return null;

  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const TT_W = Math.min(340, vw - 32);

  // Tooltip placement relative to the spotlight box (or centered if none).
  let ttStyle: React.CSSProperties = {
    top: Math.round(vh / 2),
    left: Math.round(vw / 2),
    transform: "translate(-50%, -50%)",
  };
  if (box) {
    const gap = 14;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const spaceBelow = vh - (box.top + box.height);
    const spaceAbove = box.top;
    const spaceRight = vw - (box.left + box.width);
    const spaceLeft = box.left;
    const place =
      step.placement && step.placement !== "auto"
        ? step.placement
        : spaceBelow > 200
        ? "bottom"
        : spaceAbove > 200
        ? "top"
        : spaceRight > TT_W + 40
        ? "right"
        : spaceLeft > TT_W + 40
        ? "left"
        : "bottom";
    const clampL = (l: number) => Math.max(16, Math.min(l, vw - TT_W - 16));
    if (place === "bottom")
      ttStyle = { top: box.top + box.height + gap, left: clampL(cx - TT_W / 2) };
    else if (place === "top")
      ttStyle = {
        top: box.top - gap,
        left: clampL(cx - TT_W / 2),
        transform: "translateY(-100%)",
      };
    else if (place === "right")
      ttStyle = {
        top: cy,
        left: box.left + box.width + gap,
        transform: "translateY(-50%)",
      };
    else
      ttStyle = {
        top: cy,
        left: box.left - gap,
        transform: "translate(-100%, -50%)",
      };
  }

  const last = i >= total - 1;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2147483000 }}>
      {/* Click-blocker so the live app can't be poked mid-tour. Transparent —
          the dimming comes from the spotlight box-shadow (or this layer when
          there's no target). */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          inset: 0,
          background: box ? "transparent" : "rgba(0,0,0,0.6)",
          transition: "background 0.25s",
        }}
      />

      {/* Spotlight cutout — a transparent hole with a giant shadow that dims
          everything else, plus an accent ring. */}
      {box && (
        <div
          style={{
            position: "absolute",
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
            borderRadius: "10px",
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
            outline: "2px solid " + accent,
            outlineOffset: "0px",
            pointerEvents: "none",
            transition:
              "top 0.3s ease, left 0.3s ease, width 0.3s ease, height 0.3s ease",
          }}
        />
      )}

      {/* Tooltip */}
      <div
        style={{
          position: "absolute",
          width: TT_W,
          backgroundColor: "var(--panel)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: "14px",
          boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
          padding: "16px 18px 14px",
          ...ttStyle,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: "8px",
          }}
        >
          <span
            style={{
              fontSize: "10.5px",
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              color: "var(--muted)",
              fontWeight: 700,
            }}
          >
            {label}
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: "11px",
              color: "var(--muted)",
            }}
          >
            {i + 1} / {total}
          </span>
        </div>
        <div
          style={{
            fontSize: "15px",
            fontWeight: 700,
            marginBottom: "6px",
            lineHeight: 1.3,
          }}
        >
          {step.title}
        </div>
        <p
          style={{
            fontSize: "13.5px",
            lineHeight: 1.55,
            color: "var(--muted)",
            margin: "0 0 14px 0",
          }}
        >
          {step.body}
        </p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: "13px",
              padding: "6px 4px",
              fontFamily: "inherit",
            }}
          >
            Skip
          </button>
          <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
            {i > 0 && (
              <button
                onClick={() => backRef.current()}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: 600,
                  padding: "8px 14px",
                  borderRadius: "9px",
                  fontFamily: "inherit",
                }}
              >
                Back
              </button>
            )}
            <button
              onClick={() => advanceRef.current()}
              style={{
                backgroundColor: accent,
                color: "#fff",
                border: "none",
                borderRadius: "9px",
                padding: "8px 18px",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
