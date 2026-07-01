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

// The parchment. Fixed light "sanctuary" palette, independent of app dark mode
// (a dark sanctuary is a later variant).
const P = {
  bg: "#f8f3e7",
  panel: "#fffdf6",
  text: "#2b2416",
  muted: "#8d7f63",
  border: "#e3d9c2",
  veil: "#efe7d2",
};

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

  useEffect(() => {
    const t = window.setInterval(
      () => setElapsed(Date.now() - startRef.current),
      1000
    );
    return () => window.clearInterval(t);
  }, []);

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
    letterSpacing: ".16em",
    textTransform: "uppercase",
    color: P.muted,
  };

  const renderBeat = () => {
    if (beat.kind === "section") {
      return (
        <div style={{ textAlign: "center" }}>
          <div style={{ ...kicker, marginBottom: 16 }}>
            Section {beat.n}
          </div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 40,
              fontWeight: 600,
              color: P.text,
              lineHeight: 1.25,
            }}
          >
            {beat.title}
          </div>
          <div
            style={{
              width: 54,
              height: 2,
              background: accent,
              margin: "26px auto 0",
              borderRadius: 2,
            }}
          />
        </div>
      );
    }

    if (beat.kind === "end") {
      return (
        <div style={{ textAlign: "center" }}>
          <div style={{ ...kicker, marginBottom: 16 }}>The end</div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 34,
              fontWeight: 600,
              color: P.text,
            }}
          >
            {table.name || "That’s the lesson."}
          </div>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 13.5,
              color: P.muted,
              marginTop: 12,
            }}
          >
            {fmtElapsed(elapsed)} · thank you
          </div>
          <button
            onClick={onClose}
            style={{
              marginTop: 28,
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
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              display: "inline-flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
              background: P.veil,
              border: "1.5px dashed " + P.border,
              borderRadius: 18,
              padding: "44px 60px",
            }}
          >
            <span style={kicker}>{label}</span>
            <span
              style={{ fontFamily: SANS, fontSize: 13.5, color: P.muted }}
            >
              Tap to reveal
            </span>
          </div>
        </div>
      );
    }

    if (c.kind === "scripture") {
      const refs = c.refs || [];
      const label = c.passage ? passageLabel(refs) : refs.join(" · ");
      return (
        <div>
          <div style={{ ...kicker, color: accent, marginBottom: 18 }}>
            {label}
          </div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 22,
              lineHeight: 1.85,
              color: P.text,
            }}
          >
            {refs.map((r) => (
              <div key={r} style={{ marginBottom: 10 }}>
                {renderVerse(r, c.bookId)}
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (c.kind === "text") {
      return (
        <div>
          {c.role && (
            <div style={{ ...kicker, marginBottom: 16 }}>{c.role}</div>
          )}
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 27,
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
        <div style={{ textAlign: "center" }}>
          <div style={{ ...kicker, color: accent, marginBottom: 18 }}>
            {c.qtype ? c.qtype + " · question" : "Question"}
          </div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 30,
              lineHeight: 1.5,
              color: P.text,
              whiteSpace: "pre-wrap",
            }}
          >
            {c.text}
          </div>
        </div>
      );
    }

    if (c.kind === "quote") {
      return (
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 27,
              fontStyle: "italic",
              lineHeight: 1.6,
              color: P.text,
              whiteSpace: "pre-wrap",
            }}
          >
            “{(c.text || "").trim()}”
          </div>
          {c.attribution && (
            <div
              style={{
                fontFamily: SANS,
                fontSize: 14,
                color: P.muted,
                marginTop: 18,
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
        <div style={{ textAlign: "center" }}>
          <div style={{ ...kicker, marginBottom: 16 }}>
            Note to self · only you see this
          </div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 24,
              fontStyle: "italic",
              lineHeight: 1.6,
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
        <div style={{ ...kicker, marginBottom: 14 }}>
          Clip · plays {fmtTime(c.startSec) || "0:00"} –{" "}
          {c.endSec != null ? fmtTime(c.endSec) : "end"}
        </div>
        <ClipPlayer
          videoId={vid}
          startSec={c.startSec}
          endSec={c.endSec}
          accent={accent}
        />
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
        background: P.bg,
        display: "flex",
        flexDirection: "column",
        // Verse marks render with the app's pen/highlight vars; keep them
        // legible on parchment regardless of the app's dark mode.
        color: P.text,
      }}
    >
      {/* top strip: exit + section + timer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 20px",
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
            fontFamily: SANS,
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: ".13em",
            textTransform: "uppercase",
            color: P.muted,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {sectionLabel || table.name || "Present"}
        </div>
        <div style={{ fontFamily: SANS, fontSize: 12.5, color: P.muted }}>
          {fmtElapsed(elapsed)}
        </div>
      </div>

      {/* the beat — tapping anywhere advances (or lifts the veil) */}
      <div
        onClick={next}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px 28px",
          cursor: atEnd ? "default" : "pointer",
        }}
      >
        <div
          key={i + (isVeiled ? "v" : "")}
          className="scribal-fade"
          style={{ width: "100%", maxWidth: 720 }}
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
          gap: 14,
          padding: "14px 20px 18px",
          flex: "0 0 auto",
        }}
      >
        <button
          onClick={back}
          disabled={i === 0}
          aria-label="Back"
          style={{
            width: 34,
            height: 34,
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
        <div style={{ flex: 1 }}>
          <div
            style={{
              height: 4,
              borderRadius: 999,
              background: P.veil,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width:
                  Math.round(((i + 1) / beats.length) * 100) + "%",
                background: accent,
                borderRadius: 999,
                transition: "width .25s ease",
              }}
            />
          </div>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 11,
              color: P.muted,
              marginTop: 6,
              textAlign: "center",
            }}
          >
            {Math.min(i + 1, beats.length)} of {beats.length}
          </div>
        </div>
        <button
          onClick={next}
          disabled={atEnd}
          aria-label="Next"
          style={{
            width: 34,
            height: 34,
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
