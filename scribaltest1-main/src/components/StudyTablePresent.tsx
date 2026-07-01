import { useEffect, useMemo, useRef, useState } from "react";
import { TableCard, StudyTable } from "../hooks/useStudyTables";
import { passageLabel } from "../data/verseIndex";
import { ClipPlayer, parseYouTubeId, fmtTime } from "./StudyTableColumn";

// Present mode: the table performed. One beat at a time, full screen, on light
// parchment. Headings become section-break screens; questions and private notes
// arrive veiled and reveal on tap; a tap (or arrow key) advances. The order of
// the column IS the lesson — this just walks it.

interface Props {
  table: StudyTable;
  renderVerse: (reference: string, bookId?: string) => React.ReactNode;
  accent?: string;
  onClose: () => void;
}

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF =
  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif';

// The parchment palette.
const P = {
  bg: "#f6efe0",
  panel: "#fefcf5",
  text: "#2b2416",
  muted: "#8d7c5c",
  faint: "#b3a482",
  border: "#e0d5ba",
  veil: "#ede4cc",
  shadow: "0 22px 50px -28px rgba(74,60,28,.45), 0 2px 8px rgba(74,60,28,.07)",
};

// Present pins its OWN CSS variables so verse marks always render with the
// light-reader palette on the parchment — even when the app is in dark mode
// (whose pens are pale and highlights are dark washes; both unreadable here).
const PRESENT_VARS = {
  "--bg": P.bg,
  "--panel": P.panel,
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

// A beat is one screen: a section break, a card, or the closing screen.
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
        margin: "26px 0 0",
      }}
    >
      <span style={{ width: 46, height: 1, background: color, opacity: 0.55 }} />
      <span
        style={{
          width: 7,
          height: 7,
          background: color,
          transform: "rotate(45deg)",
          borderRadius: 1.5,
        }}
      />
      <span style={{ width: 46, height: 1, background: color, opacity: 0.55 }} />
    </div>
  );
}

export default function StudyTablePresent({
  table,
  renderVerse,
  accent = "#8b5cf6",
  onClose,
}: Props) {
  // Build the beat list once per card set. Headings become section screens;
  // empty cards are skipped so a stray blank never becomes a dead screen.
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

  // A new beat always starts at the top of its own scroll.
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
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: ".2em",
    textTransform: "uppercase",
    color: P.muted,
  };

  const renderBeat = () => {
    if (beat.kind === "section") {
      return (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div style={{ ...kicker, color: P.faint, marginBottom: 20 }}>
            Section {beat.n}
          </div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 46,
              fontWeight: 600,
              color: P.text,
              lineHeight: 1.22,
              letterSpacing: "-0.01em",
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
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <Ornament color={accent} />
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 38,
              fontWeight: 600,
              color: P.text,
              margin: "26px 0 0",
            }}
          >
            {table.name || "That’s the lesson."}
          </div>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 13.5,
              color: P.muted,
              marginTop: 14,
            }}
          >
            {fmtElapsed(elapsed)} · thank you
          </div>
          <button
            onClick={onClose}
            style={{
              marginTop: 30,
              fontFamily: SANS,
              fontSize: 14,
              fontWeight: 650,
              color: "#fff",
              background: accent,
              border: 0,
              borderRadius: 999,
              padding: "12px 28px",
              cursor: "pointer",
              boxShadow: P.shadow,
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
        <div style={{ textAlign: "center", padding: "30px 0" }}>
          <div
            style={{
              display: "inline-flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 15,
              background: "linear-gradient(180deg, " + P.panel + ", " + P.veil + ")",
              border: "1px solid " + P.border,
              borderRadius: 20,
              padding: "52px 72px",
              boxShadow: P.shadow,
            }}
          >
            <span style={{ ...kicker, color: accent }}>{label}</span>
            <span style={{ fontFamily: SANS, fontSize: 13.5, color: P.muted }}>
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
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              marginBottom: 24,
            }}
          >
            <span
              aria-hidden
              style={{ flex: "0 1 60px", height: 1, background: P.border }}
            />
            <span style={{ ...kicker, color: accent, whiteSpace: "nowrap" }}>
              {label}
            </span>
            <span
              aria-hidden
              style={{ flex: "0 1 60px", height: 1, background: P.border }}
            />
          </div>
          <div
            style={{
              background: P.panel,
              border: "1px solid " + P.border,
              borderRadius: 18,
              padding: "34px 40px",
              boxShadow: P.shadow,
              fontFamily: SERIF,
              fontSize: 21,
              lineHeight: 1.9,
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
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          {c.role && (
            <div style={{ ...kicker, color: P.faint, marginBottom: 18 }}>
              {c.role}
            </div>
          )}
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 29,
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
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div style={{ ...kicker, color: accent, marginBottom: 20 }}>
            {c.qtype ? c.qtype + " · question" : "Question"}
          </div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 33,
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
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div
            aria-hidden
            style={{
              fontFamily: SERIF,
              fontSize: 64,
              lineHeight: 0.6,
              color: accent,
              opacity: 0.45,
              marginBottom: 18,
            }}
          >
            “
          </div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 28,
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
                fontSize: 13.5,
                letterSpacing: ".04em",
                color: P.muted,
                marginTop: 20,
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
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div style={{ ...kicker, color: P.faint, marginBottom: 18 }}>
            Note to self · only you see this
          </div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 25,
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
        <div style={{ ...kicker, textAlign: "center", marginBottom: 16 }}>
          Clip · plays {fmtTime(c.startSec) || "0:00"} –{" "}
          {c.endSec != null ? fmtTime(c.endSec) : "end"}
        </div>
        <div
          style={{
            borderRadius: 18,
            overflow: "hidden",
            boxShadow: P.shadow,
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
        ...PRESENT_VARS,
        position: "fixed",
        inset: 0,
        zIndex: 440,
        background:
          "radial-gradient(120% 90% at 50% 0%, #faf5e9 0%, " +
          P.bg +
          " 55%, #efe5cf 100%)",
        display: "flex",
        flexDirection: "column",
        color: P.text,
      }}
    >
      {/* top strip: exit + section + timer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 22px",
          flex: "0 0 auto",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Leave present mode"
          style={{
            width: 32,
            height: 32,
            borderRadius: 999,
            border: "1px solid " + P.border,
            background: P.panel,
            color: P.muted,
            cursor: "pointer",
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
            letterSpacing: ".18em",
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
            fontSize: 12.5,
            fontVariantNumeric: "tabular-nums",
            color: P.faint,
            width: 32,
            textAlign: "right",
          }}
        >
          {fmtElapsed(elapsed)}
        </div>
      </div>

      {/* the beat — tapping anywhere advances (or lifts the veil). NOTE: the
          content is NOT flex-centered inside the scroller; `margin: auto` on
          the inner block centers it when it fits and top-aligns it when it
          overflows, so long passages scroll instead of clipping at the top. */}
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
        }}
      >
        <div
          key={i + (isVeiled ? "v" : "")}
          className="scribal-rise"
          style={{
            margin: "auto",
            width: "100%",
            maxWidth: 700,
            padding: "34px 30px 44px",
            boxSizing: "border-box",
          }}
          onClick={atEnd ? (e) => e.stopPropagation() : undefined}
        >
          {renderBeat()}
        </div>
      </div>

      {/* bottom strip: back / progress / next */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "12px 22px 18px",
          flex: "0 0 auto",
        }}
      >
        <button
          onClick={back}
          disabled={i === 0}
          aria-label="Back"
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            border: "1px solid " + P.border,
            background: P.panel,
            color: i === 0 ? P.border : P.muted,
            cursor: i === 0 ? "default" : "pointer",
            display: "grid",
            placeItems: "center",
            lineHeight: 0,
          }}
        >
          <svg
            width="16"
            height="16"
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
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12 }}>
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
            width: 36,
            height: 36,
            borderRadius: 999,
            border: 0,
            background: atEnd ? P.veil : accent,
            color: atEnd ? P.muted : "#fff",
            cursor: atEnd ? "default" : "pointer",
            display: "grid",
            placeItems: "center",
            lineHeight: 0,
            boxShadow: atEnd ? "none" : "0 6px 16px -8px rgba(74,60,28,.5)",
          }}
        >
          <svg
            width="16"
            height="16"
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
  );
}
