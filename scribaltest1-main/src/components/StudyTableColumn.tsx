import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ACCENT } from "../theme";
import {
  TableCard,
  CardKind,
  WordRole,
  QuestionType,
  newCardId,
} from "../hooks/useStudyTables";

// The COLUMN surface of a Study Table: an ordered stack of cards you build by
// hand. The order is the lesson. This component only renders + edits the column
// and reports changes up via onChange; persistence (localStorage + sync) lives
// in useStudyTables, owned by the parent.
//
// Scripture and Clip cards get simple, forward-compatible editors here (a
// reference list; a link + start/end). Later stages replace those with the
// theme-grouped verse picker and the clip preview — the stored shape doesn't
// change, so nothing built now is thrown away.

interface StudyTableColumnProps {
  cards: TableCard[];
  onChange: (cards: TableCard[]) => void;
  // Accent for active/primary bits; defaults to the app accent.
  accent?: string;
  // Render one verse (its text + the marks from a chosen book) for a scripture
  // card. Supplied by the parent, which owns the marks; absent in previews.
  renderVerse?: (reference: string, bookId?: string) => React.ReactNode;
  // Picking "Scripture" from the chooser opens the verse panel at this insert
  // index instead of dropping an empty card. Absent → falls back to an empty card.
  onPickScripture?: (index: number) => void;
}

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF =
  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif';

// ---- card-type metadata for the picker ----
const ICON: Record<CardKind, string> = {
  scripture: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z",
  text: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  question: "M9.2 9.3a2.8 2.8 0 0 1 5.4 1c0 1.9-2.6 2.2-2.6 3.7 M12 17h.01 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  quote: "M7 7H4v5h3l-1.5 4H8l1.5-4V7z M16 7h-3v5h3l-1.5 4H18l1.5-4V7z",
  clip: "M10 8l6 4-6 4V8z M3 5h18v14H3z",
  heading: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
  note: "M2 12s3.5-7 10-7 10 7 10 7 M2 12s3.5 7 10 7 10-7 10-7 M4 4l16 16",
};
const TYPES: { kind: CardKind; name: string; desc: string }[] = [
  { kind: "scripture", name: "Scripture", desc: "your marks come with it" },
  { kind: "text", name: "Your words", desc: "a thought in your voice" },
  { kind: "question", name: "Question", desc: "something to ask" },
  { kind: "quote", name: "Quote", desc: "an outside voice" },
  { kind: "clip", name: "Clip", desc: "a video, starting where you want" },
  { kind: "heading", name: "Heading", desc: "start a section" },
  { kind: "note", name: "Note to self", desc: "private — only you" },
];

const ROLES: WordRole[] = ["thought", "story", "invitation"];
const QTYPES: { t: QuestionType; c: string }[] = [
  { t: "fact", c: "var(--muted)" },
  { t: "analysis", c: "var(--pen4)" },
  { t: "application", c: "var(--pen2)" },
  { t: "feeling", c: "var(--pen1)" },
];

function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block" }}
    >
      {d.split(" M").map((seg, i) => (
        <path key={i} d={(i === 0 ? seg : "M" + seg)} />
      ))}
    </svg>
  );
}

// Textarea that grows to fit its content.
function AutoTextarea({
  value,
  onChange,
  placeholder,
  autoFocus,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.max(el.scrollHeight, 22) + "px";
    }
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      style={{
        width: "100%",
        border: 0,
        outline: 0,
        background: "transparent",
        resize: "none",
        overflow: "hidden",
        display: "block",
        color: "var(--text)",
        fontFamily: SERIF,
        fontSize: "16px",
        lineHeight: 1.6,
        padding: 0,
        ...style,
      }}
    />
  );
}

// Read a YouTube start time out of a pasted link's ?t= / &start= param.
function parseStart(url: string): number | undefined {
  const m = url.match(/[?&](?:t|start)=([0-9hms]+)/i);
  if (!m) return undefined;
  const v = m[1];
  if (/^\d+s?$/.test(v)) return parseInt(v, 10);
  const h = +(v.match(/(\d+)h/)?.[1] || 0);
  const mi = +(v.match(/(\d+)m/)?.[1] || 0);
  const s = +(v.match(/(\d+)s/)?.[1] || 0);
  return h * 3600 + mi * 60 + s;
}
function fmtTime(t?: number): string {
  if (t == null) return "";
  const m = Math.floor(t / 60),
    s = t % 60;
  return m + ":" + String(s).padStart(2, "0");
}

// Fade a hex color to an rgba tint (safe on every browser, unlike color-mix).
// If the accent isn't a 6-digit hex, it's passed through unchanged.
function hexToRgba(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
}

// Pull a YouTube video id out of any of its link shapes (watch, youtu.be,
// embed, shorts, live). Returns null when it isn't a recognizable YouTube link.
function parseYouTubeId(url: string): string | null {
  if (!url) return null;
  let m = url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
  if (m) return m[1];
  m = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  if (m) return m[1];
  m = url.match(/youtube\.com\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{6,})/);
  if (m) return m[1];
  return null;
}

// Load the YouTube IFrame Player API once, shared across every clip card.
// Resolves with the global YT namespace when it's ready.
let ytApiPromise: Promise<any> | null = null;
function loadYouTubeApi(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  const w = window as any;
  if (w.YT && w.YT.Player) return Promise.resolve(w.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") prev();
      resolve(w.YT);
    };
    if (!document.getElementById("youtube-iframe-api")) {
      const tag = document.createElement("script");
      tag.id = "youtube-iframe-api";
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  });
  return ytApiPromise;
}

// An embedded player for a clip card: play the video, and capture the current
// playback position as the clip's start or end (YouTube share links carry no
// end, so the end is set by ear here). Previewing the clip stops at the end.
function ClipPreview({
  videoId,
  startSec,
  endSec,
  onSetStart,
  onSetEnd,
  accent,
}: {
  videoId: string;
  startSec?: number;
  endSec?: number;
  onSetStart: (sec: number) => void;
  onSetEnd: (sec: number) => void;
  accent: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const pollRef = useRef<number | null>(null);
  const endRef = useRef<number | undefined>(endSec);
  endRef.current = endSec;
  const [ready, setReady] = useState(false);
  const [cur, setCur] = useState(0);

  // Build the player once per video. YouTube replaces a child node with its
  // iframe, so we hand it a node React doesn't manage (avoids reconcile fights).
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    loadYouTubeApi().then((YT) => {
      if (cancelled || !hostRef.current) return;
      const node = document.createElement("div");
      hostRef.current.innerHTML = "";
      hostRef.current.appendChild(node);
      playerRef.current = new YT.Player(node, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          start: Math.max(0, Math.round(startSec || 0)),
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: () => {
            if (!cancelled) setReady(true);
          },
        },
      });
    });
    return () => {
      cancelled = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
      try {
        playerRef.current?.destroy?.();
      } catch {}
      playerRef.current = null;
    };
  }, [videoId]);

  // While the player is live, track the current time (for the readout) and stop
  // a preview once it reaches the clip's end.
  useEffect(() => {
    if (!ready) return;
    pollRef.current = window.setInterval(() => {
      const p = playerRef.current;
      if (!p || !p.getCurrentTime) return;
      const t = p.getCurrentTime() || 0;
      setCur(t);
      const end = endRef.current;
      if (end != null && t >= end && p.getPlayerState && p.getPlayerState() === 1) {
        p.pauseVideo();
      }
    }, 250);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [ready]);

  const now = () => Math.round(playerRef.current?.getCurrentTime?.() || 0);
  const playClip = () => {
    const p = playerRef.current;
    if (!p) return;
    p.seekTo(Math.max(0, Math.round(startSec || 0)), true);
    p.playVideo();
  };

  const ctrlBtn: React.CSSProperties = {
    fontFamily: SANS,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    border: "1px solid var(--border)",
    background: "var(--panel)",
    color: "var(--text)",
    borderRadius: 8,
    padding: "6px 10px",
  };

  return (
    <div>
      <div
        style={{
          position: "relative",
          paddingBottom: "56.25%",
          height: 0,
          borderRadius: 10,
          overflow: "hidden",
          background: "#000",
        }}
      >
        <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
        {!ready && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              color: "rgba(255,255,255,.7)",
              fontFamily: SANS,
              fontSize: 12.5,
            }}
          >
            Loading player…
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 9 }}>
        <button onClick={playClip} style={{ ...ctrlBtn, color: "#fff", background: accent, border: 0 }}>
          ▶ Play clip
        </button>
        <button onClick={() => onSetStart(now())} style={ctrlBtn}>
          Set start here
        </button>
        <button onClick={() => onSetEnd(now())} style={ctrlBtn}>
          End clip here
        </button>
      </div>
      <div style={{ marginTop: 8, fontFamily: SANS, fontSize: 11.5, color: "var(--muted)" }}>
        Start {fmtTime(startSec)} · End {endSec != null ? fmtTime(endSec) : "—"} ·{" "}
        Playhead {fmtTime(Math.round(cur))}
      </div>
    </div>
  );
}

// The saved clip's "press play" view: a thumbnail that, on tap, plays only the
// chosen slice (YouTube's start/end embed params stop it at the end). No editing
// controls — this is the clip as it will appear when the lesson is presented.
function ClipPlayer({
  videoId,
  startSec,
  endSec,
  accent,
}: {
  videoId: string;
  startSec?: number;
  endSec?: number;
  accent: string;
}) {
  const [playing, setPlaying] = useState(false);
  const start = Math.max(0, Math.round(startSec || 0));
  const src =
    "https://www.youtube.com/embed/" +
    videoId +
    "?start=" +
    start +
    (endSec != null ? "&end=" + Math.round(endSec) : "") +
    "&autoplay=1&rel=0&modestbranding=1";
  return (
    <div
      style={{
        position: "relative",
        paddingBottom: "56.25%",
        height: 0,
        borderRadius: 10,
        overflow: "hidden",
        background: "#000",
      }}
    >
      {playing ? (
        <iframe
          title="clip"
          src={src}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
        />
      ) : (
        <button
          onClick={() => setPlaying(true)}
          aria-label="Play clip"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            padding: 0,
            border: 0,
            cursor: "pointer",
            background: "#000",
          }}
        >
          <img
            src={"https://img.youtube.com/vi/" + videoId + "/hqdefault.jpg"}
            alt=""
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
          <span
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%,-50%)",
              width: 58,
              height: 58,
              borderRadius: 999,
              background: hexToRgba(accent, 0.92),
              display: "grid",
              placeItems: "center",
              boxShadow: "0 6px 20px -6px rgba(0,0,0,.6)",
            }}
          >
            <span
              style={{
                width: 0,
                height: 0,
                marginLeft: 4,
                borderTop: "11px solid transparent",
                borderBottom: "11px solid transparent",
                borderLeft: "18px solid #fff",
              }}
            />
          </span>
        </button>
      )}
    </div>
  );
}

export default function StudyTableColumn({
  cards,
  onChange,
  accent = ACCENT,
  renderVerse,
  onPickScripture,
}: StudyTableColumnProps) {
  // Which "+" gap has its type-chooser open (insert index), or null.
  const [openAt, setOpenAt] = useState<number | null>(null);
  // Newly inserted card to autofocus once.
  const [focusId, setFocusId] = useState<string | null>(null);
  // Which gap is hovered — the + affordance reveals only there, so at rest the
  // card stack stays an unbroken line.
  const [hoverGap, setHoverGap] = useState<number | null>(null);
  // Which card is pending a delete confirmation (guards accidental deletes).
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // Which clip card has its preview player open (only one at a time).
  const [previewId, setPreviewId] = useState<string | null>(null);

  // Clear the one-shot focus flag after it has been applied on mount.
  useEffect(() => {
    if (!focusId) return;
    const t = setTimeout(() => setFocusId(null), 0);
    return () => clearTimeout(t);
  }, [focusId]);

  const softAccent = hexToRgba(accent, 0.1);
  const softAccentBorder = hexToRgba(accent, 0.28);

  const patch = (id: string, p: Partial<TableCard>) =>
    onChange(cards.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const remove = (id: string) => onChange(cards.filter((c) => c.id !== id));
  const move = (id: string, dir: -1 | 1) => {
    const i = cards.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cards.length) return;
    const next = cards.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const insertAt = (index: number, kind: CardKind) => {
    const card: TableCard = { id: newCardId(), kind };
    if (kind === "scripture") card.refs = [];
    if (kind === "clip") card.url = "";
    onChange([...cards.slice(0, index), card, ...cards.slice(index)]);
    setOpenAt(null);
    setFocusId(card.id);
  };
  // Choosing a type from the chooser. Scripture opens the verse panel (so verses
  // come in already carrying their marks) instead of dropping an empty card.
  const pickType = (index: number, kind: CardKind) => {
    if (kind === "scripture" && onPickScripture) {
      setOpenAt(null);
      onPickScripture(index);
      return;
    }
    insertAt(index, kind);
  };

  // ---------- shared bits ----------
  const cardBox: React.CSSProperties = {
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: 13,
    padding: "14px 16px",
    boxShadow: "0 1px 2px rgba(60,50,30,.04), 0 8px 20px -14px rgba(60,50,30,.16)",
  };
  const kicker: React.CSSProperties = {
    fontFamily: SANS,
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: ".13em",
    textTransform: "uppercase",
    color: "var(--muted)",
    display: "flex",
    alignItems: "center",
    gap: 7,
    marginBottom: 8,
  };

  function Chip({
    on,
    dot,
    label,
    onClick,
  }: {
    on: boolean;
    dot?: string;
    label: string;
    onClick: () => void;
  }) {
    return (
      <button
        onClick={onClick}
        style={{
          fontFamily: SANS,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          color: on ? accent : "var(--muted)",
          background: on ? softAccent : "transparent",
          border: "1px solid " + (on ? accent : "var(--border)"),
          borderRadius: 999,
          padding: "4px 11px",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {dot && (
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: dot,
            }}
          />
        )}
        {label}
      </button>
    );
  }

  // reorder + delete controls for a card
  function Controls({ id }: { id: string }) {
    const btn: React.CSSProperties = {
      width: 26,
      height: 26,
      borderRadius: 7,
      border: "1px solid var(--border)",
      background: "var(--panel)",
      color: "var(--muted)",
      cursor: "pointer",
      display: "grid",
      placeItems: "center",
      lineHeight: 0,
    };
    if (confirmId === id) {
      return (
        <div style={{ display: "flex", gap: 8, marginTop: 9, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontFamily: SANS, fontSize: 12.5, color: "var(--muted)", marginRight: "auto" }}>
            Delete this card?
          </span>
          <button
            onClick={() => {
              remove(id);
              setConfirmId(null);
            }}
            style={{
              fontFamily: SANS,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              color: "#fff",
              background: "var(--pen1)",
              border: 0,
              borderRadius: 8,
              padding: "6px 13px",
            }}
          >
            Delete
          </button>
          <button
            onClick={() => setConfirmId(null)}
            style={{
              fontFamily: SANS,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              color: "var(--text)",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "6px 13px",
            }}
          >
            Cancel
          </button>
        </div>
      );
    }
    return (
      <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
        <button
          title="Move up"
          onClick={() => move(id, -1)}
          style={btn}
        >
          <Icon d="M12 19V5 M6 11l6-6 6 6" size={13} />
        </button>
        <button
          title="Move down"
          onClick={() => move(id, 1)}
          style={btn}
        >
          <Icon d="M12 5v14 M6 13l6 6 6-6" size={13} />
        </button>
        <button
          title="Delete card"
          onClick={() => setConfirmId(id)}
          style={{ ...btn, marginLeft: "auto" }}
        >
          <Icon d="M18 6 6 18 M6 6l12 12" size={13} />
        </button>
      </div>
    );
  }

  // ---------- per-kind editors ----------
  const renderCard = (card: TableCard) => {
    const focus = card.id === focusId;

    if (card.kind === "heading") {
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input
            value={card.text || ""}
            autoFocus={focus}
            placeholder="Name this section…"
            onChange={(e) => patch(card.id, { text: e.target.value })}
            style={{
              fontFamily: SANS,
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: "var(--text)",
              background: "transparent",
              border: 0,
              borderBottom: "1.5px dashed var(--border)",
              outline: 0,
              padding: "6px 2px",
              flex: "0 1 340px",
              minWidth: 0,
            }}
          />
          <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>
      );
    }

    if (card.kind === "text") {
      return (
        <div style={{ borderLeft: "2px solid " + softAccentBorder, paddingLeft: 15 }}>
          <AutoTextarea
            value={card.text || ""}
            autoFocus={focus}
            placeholder="Write your thought…"
            onChange={(v) => patch(card.id, { text: v })}
            style={{ fontSize: 15.5, color: "var(--text)" }}
          />
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 11, alignItems: "center" }}>
            <span style={{ ...kicker, margin: 0 }}>optional</span>
            {ROLES.map((r) => (
              <Chip
                key={r}
                on={card.role === r}
                label={r}
                onClick={() => patch(card.id, { role: card.role === r ? undefined : r })}
              />
            ))}
          </div>
        </div>
      );
    }

    if (card.kind === "question") {
      return (
        <div
          style={{
            background: softAccent,
            border: "1px solid " + softAccentBorder,
            borderRadius: 13,
            padding: "13px 15px",
          }}
        >
          <AutoTextarea
            value={card.text || ""}
            autoFocus={focus}
            placeholder="Ask something…"
            onChange={(v) => patch(card.id, { text: v })}
          />
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 11, alignItems: "center" }}>
            <span style={{ ...kicker, margin: 0 }}>type</span>
            {QTYPES.map(({ t, c }) => (
              <Chip
                key={t}
                on={card.qtype === t}
                dot={c}
                label={t}
                onClick={() => patch(card.id, { qtype: card.qtype === t ? undefined : t })}
              />
            ))}
          </div>
        </div>
      );
    }

    if (card.kind === "quote") {
      return (
        <div style={{ borderLeft: "2px solid var(--pen3)", paddingLeft: 15 }}>
          <AutoTextarea
            value={card.text || ""}
            autoFocus={focus}
            placeholder="The quote…"
            onChange={(v) => patch(card.id, { text: v })}
            style={{ fontStyle: "italic", fontSize: 15.5, color: "var(--text)" }}
          />
          <input
            value={card.attribution || ""}
            placeholder="— who said it"
            onChange={(e) => patch(card.id, { attribution: e.target.value })}
            style={{
              width: "100%",
              border: 0,
              outline: 0,
              background: "transparent",
              fontFamily: SANS,
              fontSize: 12,
              color: "var(--muted)",
              marginTop: 8,
            }}
          />
        </div>
      );
    }

    if (card.kind === "note") {
      return (
        <div
          style={{
            background:
              "repeating-linear-gradient(135deg, var(--soft), var(--soft) 9px, var(--panel) 9px, var(--panel) 18px)",
            border: "1.5px dashed var(--border)",
            borderRadius: 11,
            padding: "12px 15px",
          }}
        >
          <div style={{ ...kicker, color: "var(--muted)" }}>
            <Icon d={ICON.note} size={12} /> Note to self · only you see this
          </div>
          <AutoTextarea
            value={card.text || ""}
            autoFocus={focus}
            placeholder="A private note — pause here, tell the story…"
            onChange={(v) => patch(card.id, { text: v })}
            style={{ fontStyle: "italic", fontSize: 15, color: "var(--text)" }}
          />
        </div>
      );
    }

    if (card.kind === "scripture") {
      const refs = card.refs || [];
      return (
        <div style={{ ...cardBox, borderLeft: "3px solid var(--pen3)" }}>
          <div style={{ ...kicker, color: accent }}>
            <Icon d={ICON.scripture} size={12} /> Scripture
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: refs.length ? 10 : 0 }}>
            {refs.map((r, i) => (
              <span
                key={i}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  fontFamily: SANS,
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--text)",
                  background: "var(--soft)",
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  padding: "4px 6px 4px 11px",
                }}
              >
                {r}
                <button
                  onClick={() => patch(card.id, { refs: refs.filter((_, k) => k !== i) })}
                  style={{
                    border: 0,
                    background: "transparent",
                    color: "var(--muted)",
                    cursor: "pointer",
                    lineHeight: 0,
                  }}
                >
                  <Icon d="M18 6 6 18 M6 6l12 12" size={12} />
                </button>
              </span>
            ))}
          </div>
          <input
            autoFocus={focus}
            placeholder="Add a reference, e.g. Alma 32:21 — Enter"
            onKeyDown={(e) => {
              const el = e.target as HTMLInputElement;
              if (e.key === "Enter" && el.value.trim()) {
                e.preventDefault();
                patch(card.id, { refs: [...refs, el.value.trim()] });
                el.value = "";
              }
            }}
            style={{
              width: "100%",
              boxSizing: "border-box",
              border: "1px solid var(--border)",
              borderRadius: 8,
              outline: 0,
              background: "var(--soft)",
              fontFamily: SERIF,
              fontSize: 14.5,
              color: "var(--text)",
              padding: "9px 11px",
            }}
          />
          {refs.length > 1 && (
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                marginTop: 11,
                fontFamily: SANS,
                fontSize: 12.5,
                color: "var(--muted)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={!!card.passage}
                onChange={(e) => patch(card.id, { passage: e.target.checked })}
              />
              Show as one passage
            </label>
          )}
          {refs.length > 0 && renderVerse ? (
            <div
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: "1px solid var(--border)",
                fontFamily: SERIF,
                fontSize: 15.5,
                lineHeight: 1.7,
                color: "var(--text)",
              }}
            >
              {refs.map((r) => (
                <Fragment key={r}>{renderVerse(r, card.bookId)}</Fragment>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 11, fontFamily: SANS, fontSize: 11.5, color: "var(--muted)" }}>
              The verse text and your marks appear here once linked.
            </div>
          )}
        </div>
      );
    }

    // clip
    const url = card.url || "";
    const vid = parseYouTubeId(url);
    const previewOpen = previewId === card.id;

    // Saved clip: a clean, press-to-play view with no editing controls.
    if (card.clipSaved && vid) {
      return (
        <div style={cardBox}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ ...kicker, color: "var(--pen3)", margin: 0, flex: 1 }}>
              <Icon d={ICON.clip} size={12} /> Clip
            </div>
            <button
              onClick={() => patch(card.id, { clipSaved: false })}
              style={{
                fontFamily: SANS,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                color: "var(--muted)",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 999,
                padding: "4px 11px",
              }}
            >
              Edit
            </button>
          </div>
          <div style={{ marginTop: 10 }}>
            <ClipPlayer
              videoId={vid}
              startSec={card.startSec}
              endSec={card.endSec}
              accent={accent}
            />
          </div>
          <div style={{ marginTop: 8, fontFamily: SANS, fontSize: 11.5, color: "var(--muted)" }}>
            Plays {fmtTime(card.startSec) || "0:00"} –{" "}
            {card.endSec != null ? fmtTime(card.endSec) : "end"}
          </div>
        </div>
      );
    }

    return (
      <div style={cardBox}>
        <div style={{ ...kicker, color: "var(--pen3)" }}>
          <Icon d={ICON.clip} size={12} /> Clip
        </div>
        <input
          autoFocus={focus}
          value={url}
          placeholder="Paste a YouTube link…"
          onChange={(e) => {
            const u = e.target.value;
            patch(card.id, { url: u, startSec: parseStart(u) });
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            border: "1px solid var(--border)",
            borderRadius: 8,
            outline: 0,
            background: "var(--soft)",
            fontFamily: SANS,
            fontSize: 13.5,
            color: "var(--text)",
            padding: "9px 11px",
          }}
        />
        <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 110 }}>
            <div style={{ ...kicker, marginBottom: 5 }}>
              Starts at {card.startSec != null ? "(from link)" : ""}
            </div>
            <input
              value={fmtTime(card.startSec)}
              placeholder="0:00"
              onChange={(e) => {
                const p = e.target.value.split(":").map((n) => parseInt(n, 10) || 0);
                const secs = p.length === 2 ? p[0] * 60 + p[1] : p[0] || 0;
                patch(card.id, { startSec: secs });
              }}
              style={clipTimeStyle}
            />
          </div>
          <div style={{ flex: 1, minWidth: 110 }}>
            <div style={{ ...kicker, marginBottom: 5 }}>End (optional)</div>
            <input
              value={fmtTime(card.endSec)}
              placeholder="e.g. 6:10"
              onChange={(e) => {
                const val = e.target.value.trim();
                if (!val) return patch(card.id, { endSec: undefined });
                const p = val.split(":").map((n) => parseInt(n, 10) || 0);
                const secs = p.length === 2 ? p[0] * 60 + p[1] : p[0] || 0;
                patch(card.id, { endSec: secs });
              }}
              style={clipTimeStyle}
            />
          </div>
        </div>
        {vid ? (
          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => setPreviewId(previewOpen ? null : card.id)}
              style={{
                fontFamily: SANS,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                color: previewOpen ? "var(--muted)" : accent,
                background: "transparent",
                border: "1px solid " + (previewOpen ? "var(--border)" : accent),
                borderRadius: 999,
                padding: "6px 13px",
              }}
            >
              {previewOpen ? "Hide preview" : "Preview & set clip"}
            </button>
            {previewOpen && (
              <div style={{ marginTop: 11 }}>
                <ClipPreview
                  videoId={vid}
                  startSec={card.startSec}
                  endSec={card.endSec}
                  onSetStart={(s) => patch(card.id, { startSec: s })}
                  onSetEnd={(s) => patch(card.id, { endSec: s })}
                  accent={accent}
                />
              </div>
            )}
          </div>
        ) : (
          <div style={{ marginTop: 11, fontFamily: SANS, fontSize: 11.5, color: "var(--muted)" }}>
            Paste a YouTube link to preview it and set the clip’s start and end.
          </div>
        )}
        {vid && (
          <button
            onClick={() => {
              setPreviewId(null);
              patch(card.id, { clipSaved: true });
            }}
            style={{
              marginTop: 14,
              width: "100%",
              fontFamily: SANS,
              fontSize: 13,
              fontWeight: 650,
              cursor: "pointer",
              color: "#fff",
              background: accent,
              border: 0,
              borderRadius: 9,
              padding: "9px 0",
            }}
          >
            Save as clip
          </button>
        )}
      </div>
    );
  }

  // + bar between/around cards
  function AddBar({
    index,
    big,
    show,
  }: {
    index: number;
    big?: boolean;
    show?: boolean;
  }) {
    if (big) {
      return (
        <div style={{ marginTop: 8, paddingLeft: 4 }}>
          <button
            onClick={() => setOpenAt(openAt === index ? null : index)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontFamily: SANS,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--muted)",
              cursor: "pointer",
              background: "transparent",
              border: "1px dashed var(--border)",
              borderRadius: 10,
              padding: "10px 14px",
            }}
          >
            <Icon d="M12 5v14 M5 12h14" size={14} /> Add a card
          </button>
        </div>
      );
    }
    return (
      <div
        style={{
          height: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <button
          onClick={() => setOpenAt(openAt === index ? null : index)}
          aria-label="Add a card here"
          style={{
            width: 22,
            height: 22,
            borderRadius: 999,
            border: "1px solid " + accent,
            background: "var(--panel)",
            color: accent,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: show ? 1 : 0,
            pointerEvents: show ? "auto" : "none",
            transition: "opacity .12s ease",
            boxShadow: "0 0 3px rgba(60,50,30,.14)",
          }}
        >
          <Icon d="M12 5v14 M5 12h14" size={14} />
        </button>
      </div>
    );
  }

  function Chooser({ index }: { index: number }) {
    return (
      <div style={{ paddingLeft: 4, margin: "4px 0" }}>
        <div
          style={{
            border: "1px solid " + accent,
            background: "var(--panel)",
            borderRadius: 13,
            padding: 8,
            boxShadow: "0 12px 30px -14px rgba(60,50,30,.35)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "4px 6px 8px",
            }}
          >
            <span style={{ ...kicker, color: accent, margin: 0 }}>Add a card</span>
            <button
              onClick={() => setOpenAt(null)}
              style={{ border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", lineHeight: 0 }}
            >
              <Icon d="M18 6 6 18 M6 6l12 12" size={15} />
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
            {TYPES.map((t) => (
              <button
                key={t.kind}
                onClick={() => pickType(index, t.kind)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  textAlign: "left",
                  fontFamily: SANS,
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "9px 10px",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 7,
                    flex: "0 0 auto",
                    display: "grid",
                    placeItems: "center",
                    background: softAccent,
                    color: accent,
                  }}
                >
                  <Icon d={ICON[t.kind]} size={15} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.15 }}>
                    {t.name}
                  </span>
                  <span style={{ display: "block", fontSize: 10.5, color: "var(--muted)", marginTop: 1 }}>
                    {t.desc}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---------- empty state ----------
  if (cards.length === 0) {
    return (
      <div style={{ maxWidth: 660, margin: "0 auto" }}>
        {openAt === 0 ? (
          <Chooser index={0} />
        ) : (
          <div
            style={{
              textAlign: "center",
              padding: "48px 22px",
              color: "var(--muted)",
              fontFamily: SANS,
            }}
          >
            <div style={{ fontFamily: SERIF, fontSize: 20, color: "var(--text)", marginBottom: 6 }}>
              A blank table.
            </div>
            <div style={{ fontSize: 13.5, marginBottom: 20 }}>
              Add cards in any order — the order becomes the lesson.
            </div>
            <button
              onClick={() => setOpenAt(0)}
              style={{
                fontFamily: SANS,
                fontSize: 14,
                fontWeight: 650,
                color: "#fff",
                cursor: "pointer",
                background: accent,
                border: 0,
                borderRadius: 11,
                padding: "11px 18px",
              }}
            >
              Add your first card
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---------- the column ----------
  return (
    <div style={{ maxWidth: 660, margin: "0 auto", position: "relative" }}>
      {/* spine */}
      <div
        style={{
          position: "absolute",
          top: 8,
          bottom: 34,
          left: 13,
          width: 1,
          background: "var(--border)",
          zIndex: 0,
        }}
      />
      {cards.map((card, i) => {
        const isSection = card.kind === "heading";
        return (
          <Fragment key={card.id}>
            <div
              style={{ paddingLeft: 32 }}
              onMouseEnter={() => setHoverGap(i)}
              onMouseLeave={() => setHoverGap((g) => (g === i ? null : g))}
            >
              <AddBar index={i} show={hoverGap === i} />
              {openAt === i && <Chooser index={i} />}
            </div>
            <div
              data-card-id={card.id}
              style={{
                position: "relative",
                display: "grid",
                gridTemplateColumns: "28px 1fr",
                alignItems: "start",
              }}
            >
              <span
                style={{
                  gridColumn: 1,
                  justifySelf: "center",
                  marginTop: 16,
                  zIndex: 1,
                  width: isSection ? 11 : 9,
                  height: isSection ? 11 : 9,
                  borderRadius: "50%",
                  background: "var(--panel)",
                  border: "1.5px solid " + (isSection ? "var(--pen3)" : "var(--border)"),
                }}
              />
              <div style={{ gridColumn: 2, minWidth: 0, padding: "8px 0 8px 4px" }}>
                {renderCard(card)}
                <Controls id={card.id} />
              </div>
            </div>
          </Fragment>
        );
      })}
      <div style={{ paddingLeft: 32 }}>
        <AddBar index={cards.length} big />
        {openAt === cards.length && <Chooser index={cards.length} />}
      </div>
    </div>
  );
}

const clipTimeStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid var(--border)",
  borderRadius: 8,
  outline: 0,
  background: "var(--panel)",
  fontFamily: SANS,
  fontSize: 14,
  color: "var(--text)",
  padding: "9px 11px",
};
