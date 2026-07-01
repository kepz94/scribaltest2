import { useEffect, useMemo, useRef, useState } from "react";
import { TableCard, StudyTable } from "../hooks/useStudyTables";
import { passageLabel } from "../data/verseIndex";
import { ClipPlayer, parseYouTubeId, fmtTime } from "./StudyTableColumn";

// Present mode: the table performed as a NOTEPAD. A dimmed desk backdrop with
// one centered paper pad — bound top edge, faint ruled lines — and every beat
// rendered on that same page, one at a time. Headings become section-break
// pages; questions and private notes arrive veiled and reveal on tap; a tap
// (or arrow key) turns to the next beat. The order of the column IS the lesson.

interface Props {
  table: StudyTable;
  renderVerse: (reference: string, bookId?: string) => React.ReactNode;
  accent?: string;
  onClose: () => void;
}

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF =
  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif';

// The pad's palette.
const P = {
  desk1: "#4a4234",
  desk2: "#2e2a20",
  paper: "#fdfaf1",
  text: "#2b2416",
  muted: "#8d7c5c",
  faint: "#b3a482",
  border: "#e4dbc4",
  veil: "#f1ead6",
  binding: "#e9e1cb",
};

// Present pins its OWN CSS variables so verse marks always render with the
// light-reader palette on paper — even when the app is in dark mode (whose
// pens are pale and highlights are dark washes; both unreadable here).
const PRESENT_VARS = {
  "--bg": P.paper,
  "--panel": P.paper,
  "--soft": P.veil,
  "--text": P.text,
  "--muted": P.muted,
  "--border": P.border,
  "--pen1": "#d11a2a",
  "--pen2": "#e07b1a",
  "--pen3": "#c9a200",
  "--pen4": "#2f8f3e",
  "--pen5": "#2f6fb0",
  "--pen6": "#7b4fbf",
  "--pen7": "#1a1a1a",
  "--pen8": "#d6448c",
  "--pen9": "#5fa515",
  "--pen10": "#0e9aab",
  "--hl1": "#ffd6d6",
  "--hl2": "#ffe2c2",
  "--hl3": "#fbedb0",
  "--hl4": "#d3f0d6",
  "--hl5": "#cfe2f7",
  "--hl6": "#e6d9f7",
  "--hl7": "#e0e0e0",
  "--hl8": "#fcd9ea",
  "--hl9": "#e8f5c4",
  "--hl10": "#c9f0f5",
} as React.CSSProperties;

// A beat is one page: a section break, a card, or the closing page.
type Beat =
  | { kind: "section"; title: string; n: number }
  | { kind: "card"; card: TableCard; section: string }
  | { kind: "end" };

function hasContent(c: TableCard): boolean {
  if (c.kind === "heading") return true;
  if (c.kind === "scripture") return (c.refs || []).length > 0;
  if (c.kind === "clip") return !!(c.url && parseYouTubeId(c.url));
  return !!(c.text || "").trim();
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m + ":" + String(s % 60).padStart(2, "0");
}

// A small ornamental rule: — ◆ —
function Ornament({ color }: { color: string }) {
  return (
    <div
      aria-hidden
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        margin: "24px 0 0",
      }}
    >
      <span style={{ width: 42, height: 1, background: color, opacity: 0.5 }} />
      <span
        style={{
          width: 6,
          height: 6,
          background: color,
          transform: "rotate(45deg)",
          borderRadius: 1.5,
        }}
      />
      <span style={{ width: 42, height: 1, background: color, opacity: 0.5 }} />
    </div>
  );
}

export default function StudyTablePresent({
  table,
  renderVerse,
  accent = "#8b5cf6",
  onClose,
}: Props) {
  // Build the beat list once per card set. Headings become section pages;
  // empty cards are skipped so a stray blank never becomes a dead page.
  const beats = useMemo<Beat[]>(() => {
    const out: Beat[] = [];
    let section = "";
    let n = 0;
    table.cards.forEach((c) => {
      if (!hasContent(c)) return;
      if (c.kind === "heading") {
        n += 1;
        section = (c.text || "").trim() || "Section " + n;
        out.push({ kind: "section", title: section, n });
      } else {
        out.push({ kind: "card", card: c, section });
      }
    });
    out.push({ kind: "end" });
    return out;
  }, [table.cards]);

  const [i, setI] = useState(0);
  // Which beat indexes have had their veil lifted (questions / notes).
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const startRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = window.setInterval(
      () => setElapsed(Date.now() - startRef.current),
      1000
    );
    return () => window.clearInterval(t);
  }, []);

  // A new beat always starts at the top of the page.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [i]);

  const beat = beats[Math.min(i, beats.length - 1)];
  const atEnd = beat.kind === "end";
  const veiledKind =
    beat.kind === "card" &&
    (beat.card.kind === "question" || beat.card.kind === "note");
  const isVeiled = veiledKind && !revealed.has(i);

  const next = () => {
    // A veiled beat reveals first; the next tap advances.
    if (isVeiled) {
      setRevealed((p) => new Set(p).add(i));
      return;
    }
    setI((p) => Math.min(p + 1, beats.length - 1));
  };
  const back = () => setI((p) => Math.max(p - 1, 0));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (veiledKind && !revealed.has(i)) {
          setRevealed((p) => new Set(p).add(i));
        } else {
          setI((p) => Math.min(p + 1, beats.length - 1));
        }
      } else if (e.key === "ArrowLeft") {
        setI((p) => Math.max(p - 1, 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, veiledKind, revealed, beats.length, onClose]);

  const kicker: React.CSSProperties = {
    fontFamily: SANS,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: ".18em",
    textTransform: "uppercase",
    color: P.muted,
  };

  const renderBeat = () => {
    if (beat.kind === "section") {
      return (
        <div style={{ textAlign: "center", padding: "36px 0" }}>
          <div style={{ ...kicker, color: P.faint, marginBottom: 18 }}>
            Section {beat.n}
          </div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: "clamp(28px, 5vw, 40px)",
              fontWeight: 600,
              color: P.text,
              lineHeight: 1.25,
            }}
          >
            {beat.title}
          </div>
          <Ornament color={accent} />
        </div>
      );
    }

    if (beat.kind === "end") {
      return (
        <div style={{ textAlign: "center", padding: "36px 0" }}>
          <Ornament color={accent} />
          <div
            style={{
              fontFamily: SERIF,
              fontSize: "clamp(24px, 4.5vw, 34px)",
              fontWeight: 600,
              color: P.text,
              margin: "24px 0 0",
            }}
          >
            {table.name || "That’s the lesson."}
          </div>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 13,
              color: P.muted,
              marginTop: 12,
            }}
          >
            {fmtElapsed(elapsed)} · thank you
          </div>
          <button
            onClick={onClose}
            style={{
              marginTop: 26,
              fontFamily: SANS,
              fontSize: 14,
              fontWeight: 650,
              color: "#fff",
              background: accent,
              border: 0,
              borderRadius: 999,
              padding: "11px 26px",
              cursor: "pointer",
            }}
          >
            Leave present mode
          </button>
        </div>
      );
    }

    const c = beat.card;

    if (isVeiled) {
      // The veil: the presenter sees WHAT is waiting (a question / a note) but
      // not its content — one tap lifts it, the next advances.
      const label =
        c.kind === "question" ? "A question is waiting" : "A note to self";
      return (
        <div style={{ textAlign: "center", padding: "26px 0" }}>
          <div
            style={{
              display: "inline-flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 13,
              background: P.veil,
              border: "1.5px dashed " + P.border,
              borderRadius: 16,
              padding: "44px 56px",
              maxWidth: "100%",
              boxSizing: "border-box",
            }}
          >
            <span style={{ ...kicker, color: accent }}>{label}</span>
            <span style={{ fontFamily: SANS, fontSize: 13, color: P.muted }}>
              Tap to reveal
            </span>
          </div>
        </div>
      );
    }

    if (c.kind === "scripture") {
      const refs = c.refs || [];
      const label = c.passage ? passageLabel(refs) : refs.join("  ·  ");
      return (
        <div>
          <div
            style={{
              ...kicker,
              color: accent,
              paddingBottom: 12,
              marginBottom: 18,
              borderBottom: "1px solid " + P.border,
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 20,
              lineHeight: 1.85,
              color: P.text,
            }}
          >
            {refs.map((r) => (
              <div key={r}>{renderVerse(r, c.bookId)}</div>
            ))}
          </div>
        </div>
      );
    }

    if (c.kind === "text") {
      return (
        <div style={{ padding: "14px 0" }}>
          {c.role && (
            <div style={{ ...kicker, color: P.faint, marginBottom: 14 }}>
              {c.role}
            </div>
          )}
          <div
            style={{
              fontFamily: SERIF,
              fontSize: "clamp(20px, 3.4vw, 26px)",
              lineHeight: 1.6,
              color: P.text,
              whiteSpace: "pre-wrap",
            }}
          >
            {c.text}
          </div>
        </div>
      );
    }

    if (c.kind === "question") {
      return (
        <div style={{ textAlign: "center", padding: "14px 0" }}>
          <div style={{ ...kicker, color: accent, marginBottom: 16 }}>
            {c.qtype ? c.qtype + " · question" : "Question"}
          </div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: "clamp(22px, 3.8vw, 29px)",
              lineHeight: 1.45,
              color: P.text,
              whiteSpace: "pre-wrap",
            }}
          >
            {c.text}
          </div>
          <Ornament color={accent} />
        </div>
      );
    }

    if (c.kind === "quote") {
      return (
        <div style={{ textAlign: "center", padding: "14px 0" }}>
          <div
            aria-hidden
            style={{
              fontFamily: SERIF,
              fontSize: 56,
              lineHeight: 0.6,
              color: accent,
              opacity: 0.4,
              marginBottom: 16,
            }}
          >
            “
          </div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: "clamp(20px, 3.4vw, 25px)",
              fontStyle: "italic",
              lineHeight: 1.62,
              color: P.text,
              whiteSpace: "pre-wrap",
            }}
          >
            {(c.text || "").trim()}
          </div>
          {c.attribution && (
            <div
              style={{
                fontFamily: SANS,
                fontSize: 13,
                letterSpacing: ".04em",
                color: P.muted,
                marginTop: 16,
              }}
            >
              — {c.attribution}
            </div>
          )}
        </div>
      );
    }

    if (c.kind === "note") {
      return (
        <div style={{ textAlign: "center", padding: "14px 0" }}>
          <div style={{ ...kicker, color: P.faint, marginBottom: 14 }}>
            Note to self · only you see this
          </div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: "clamp(18px, 3vw, 22px)",
              fontStyle: "italic",
              lineHeight: 1.65,
              color: P.muted,
              whiteSpace: "pre-wrap",
            }}
          >
            {c.text}
          </div>
        </div>
      );
    }

    // clip
    const vid = c.url ? parseYouTubeId(c.url) : null;
    if (!vid) return null;
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <div style={{ ...kicker, textAlign: "center", marginBottom: 14 }}>
          Clip · plays {fmtTime(c.startSec) || "0:00"} –{" "}
          {c.endSec != null ? fmtTime(c.endSec) : "end"}
        </div>
        <div
          style={{
            borderRadius: 12,
            overflow: "hidden",
            border: "1px solid " + P.border,
          }}
        >
          <ClipPlayer
            videoId={vid}
            startSec={c.startSec}
            endSec={c.endSec}
            accent={accent}
          />
        </div>
      </div>
    );
  };

  const sectionLabel =
    beat.kind === "card" && beat.section ? beat.section : "";

  return (
    <div
      className="scribal-fade"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 440,
        background:
          "radial-gradient(120% 110% at 50% 0%, " +
          P.desk1 +
          " 0%, " +
          P.desk2 +
          " 78%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding:
          "max(14px, env(safe-area-inset-top)) 14px max(14px, env(safe-area-inset-bottom))",
        boxSizing: "border-box",
      }}
    >
      {/* THE PAD — one paper page; every beat renders on it */}
      <div
        style={{
          ...PRESENT_VARS,
          width: "min(780px, 100%)",
          height: "min(860px, 100%)",
          display: "flex",
          flexDirection: "column",
          background: P.paper,
          color: P.text,
          borderRadius: 14,
          overflow: "hidden",
          boxShadow:
            "0 40px 90px -30px rgba(0,0,0,.65), 0 10px 28px -14px rgba(0,0,0,.5), inset 0 0 0 1px rgba(120,100,60,.14)",
        }}
      >
        {/* binding: a bound top edge with punched holes */}
        <div
          style={{
            flex: "0 0 auto",
            background:
              "linear-gradient(180deg, " + P.binding + ", " + P.paper + ")",
            borderBottom: "1px solid " + P.border,
            padding: "10px 16px 8px",
          }}
        >
          <div
            aria-hidden
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 26,
              marginBottom: 8,
            }}
          >
            {Array.from({ length: 9 }).map((_, k) => (
              <span
                key={k}
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 999,
                  background:
                    "radial-gradient(circle at 35% 30%, " +
                    P.desk1 +
                    ", " +
                    P.desk2 +
                    ")",
                  boxShadow: "inset 0 1px 2px rgba(0,0,0,.55)",
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={onClose}
              aria-label="Leave present mode"
              style={{
                width: 28,
                height: 28,
                borderRadius: 999,
                border: "1px solid " + P.border,
                background: P.paper,
                color: P.muted,
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                lineHeight: 0,
                flex: "0 0 auto",
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "center",
                fontFamily: SANS,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: P.faint,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {sectionLabel || table.name || "Present"}
            </div>
            <div
              style={{
                fontFamily: SANS,
                fontSize: 12,
                fontVariantNumeric: "tabular-nums",
                color: P.faint,
                width: 34,
                textAlign: "right",
                flex: "0 0 auto",
              }}
            >
              {fmtElapsed(elapsed)}
            </div>
          </div>
        </div>

        {/* the page. Tap to advance (or lift the veil). The notepad cue is a
            single red margin line down the left — a horizontal rule grid can
            never align with the beats' varied text sizes, so it always looked
            broken; the margin line can't clash with anything. NOTE: content is
            NOT flex-centered in the scroller; `margin: auto` centers it when it
            fits and top-aligns when it overflows, so long passages scroll
            instead of clipping at the top. */}
        <div
          ref={scrollRef}
          onClick={next}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            cursor: atEnd ? "default" : "pointer",
            background:
              "linear-gradient(90deg, transparent 0px, transparent 52px, rgba(209, 84, 84, 0.30) 52px, rgba(209, 84, 84, 0.30) 53.5px, transparent 53.5px)",
          }}
        >
          <div
            key={i + (isVeiled ? "v" : "")}
            className="scribal-rise"
            style={{
              margin: "auto",
              width: "100%",
              maxWidth: 640,
              padding: "30px 34px 40px 74px",
              boxSizing: "border-box",
            }}
            onClick={atEnd ? (e) => e.stopPropagation() : undefined}
          >
            {renderBeat()}
          </div>
        </div>

        {/* the pad's footer: back / progress / next */}
        <div
          style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "10px 16px 12px",
            borderTop: "1px solid " + P.border,
            background: P.paper,
          }}
        >
          <button
            onClick={back}
            disabled={i === 0}
            aria-label="Back"
            style={{
              width: 32,
              height: 32,
              borderRadius: 999,
              border: "1px solid " + P.border,
              background: P.paper,
              color: i === 0 ? P.border : P.muted,
              cursor: i === 0 ? "default" : "pointer",
              display: "grid",
              placeItems: "center",
              lineHeight: 0,
            }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <div
            style={{ flex: 1, display: "flex", alignItems: "center", gap: 12 }}
          >
            <div
              style={{
                flex: 1,
                height: 3,
                borderRadius: 999,
                background: "rgba(74,60,28,.12)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: Math.round(((i + 1) / beats.length) * 100) + "%",
                  background: accent,
                  borderRadius: 999,
                  transition: "width .25s ease",
                }}
              />
            </div>
            <div
              style={{
                fontFamily: SANS,
                fontSize: 11.5,
                fontVariantNumeric: "tabular-nums",
                color: P.faint,
                whiteSpace: "nowrap",
              }}
            >
              {Math.min(i + 1, beats.length)} / {beats.length}
            </div>
          </div>
          <button
            onClick={next}
            disabled={atEnd}
            aria-label="Next"
            style={{
              width: 32,
              height: 32,
              borderRadius: 999,
              border: 0,
              background: atEnd ? P.veil : accent,
              color: atEnd ? P.muted : "#fff",
              cursor: atEnd ? "default" : "pointer",
              display: "grid",
              placeItems: "center",
              lineHeight: 0,
            }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
