import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ACCENT } from "../theme";
import { COLOR_MAP, MarkColor } from "../types";
import { isConsecutive, sortRefs } from "../data/verseIndex";
import {
  TableCard,
  CardKind,
  WordRole,
  QuestionType,
  newCardId,
} from "../hooks/useStudyTables";
import { setVerseDragImage, setCardDragImage } from "../dragGhost";
import { RichCardText, richToPlain } from "./RichNoteField";

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
  renderVerse?: (
    reference: string,
    bookId?: string,
    themeColor?: MarkColor
  ) => React.ReactNode;
  // Picking "Scripture" from the chooser opens the verse panel at this insert
  // index instead of dropping an empty card. Absent → falls back to an empty card.
  onPickScripture?: (index: number) => void;
  // Open the marking panel for a single scripture card's verse(s). Absent →
  // the per-card "Mark" affordance is hidden.
  onMarkCard?: (card: TableCard) => void;
  // Named themes present on a scripture card's verses (color + the user's
  // name for it, resolved by the parent). Rendered as chips on the card.
  themesFor?: (
    refs: string[],
    bookId?: string
  ) => { color: number; label: string }[];
  // One quiet line pinned to the bottom of the add-a-card chooser. The parent
  // passes it only while the table is still Compiled · live (SCR-56): the deal
  // line stating that this act makes the table yours.
  chooserFootnote?: string;
  // ---- The tray (SCR-57): cards waiting at the bottom of the column ----
  // Waiting entries (verse arrivals, staged verses, cleared cards). When
  // present, the tray pill renders after the column; it never auto-places.
  shelf?: TableCard[];
  // Place a waiting card. With an index (grab-drag to a drop line) it lands
  // exactly there; without one (the Place button) the parent chooses — end of
  // the card's theme section, else the end of the column.
  onPlaceFromShelf?: (cardId: string, index?: number) => void;
  // Delete a waiting VERSE from the study itself — topic tables only (Kepu's
  // ruling); absent on chapter tables, where verses leave by unmarking. The
  // tray confirms before calling this.
  onDeleteFromShelf?: (cardId: string) => void;
  // Verse text for tray row previews.
  verseTextFor?: (reference: string) => string;
  // ---- Outline mode (SCR-58 inverse): the desktop table wears Outline's UI.
  // Dense rows at rest — theme headers, ref + verse text, accent lines —
  // with edit-in-place on demand. Mobile never passes this.
  outlineMode?: boolean;
  // Compiled · live? Routes a compiled heading's rename to the theme label
  // (via onRenameTheme) instead of the card text — renaming never promotes.
  live?: boolean;
  // Focused = only the marked fragments of each verse; full = whole verse.
  verseView?: "full" | "focused";
  renderVerseFocused?: (
    reference: string,
    bookId?: string,
    themeColor?: MarkColor
  ) => React.ReactNode;
  onRenameTheme?: (color: MarkColor, name: string) => void;
  // A verse drag from the in-table reader (VersePicker) in flight: the ref
  // being dragged, or null. The column shows its drop lines and, on drop,
  // calls onExternalDrop with the landing index — the caller inserts the
  // scripture card there (Kepu, Jul 22: grab a verse, drag it straight in).
  externalDragRef?: string | null;
  onExternalDrop?: (index: number) => void;
  // Tray dock (Kepu, Jul 22): true = the tray is a fixed right-side panel,
  // always open while cards wait (desktop; the verse picker takes precedence —
  // the caller passes false while it's open, falling back to the bottom pill).
  // Absent/false = the sticky bottom pill (mobile, and the fallback).
  traySide?: boolean;
  // Top offset for the side panel (below the app's sticky header).
  trayTop?: number;
}

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF =
  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif';

// Touch screens get thumb-sized card controls (the 26px buttons were too
// small to hit reliably on a phone).
const COARSE =
  typeof window !== "undefined" &&
  !!window.matchMedia &&
  window.matchMedia("(pointer: coarse)").matches;

// ---- card-type metadata for the picker ----
const ICON: Record<CardKind, string> = {
  scripture: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z",
  text: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  question: "M9.2 9.3a2.8 2.8 0 0 1 5.4 1c0 1.9-2.6 2.2-2.6 3.7 M12 17h.01 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  quote: "M7 7H4v5h3l-1.5 4H8l1.5-4V7z M16 7h-3v5h3l-1.5 4H18l1.5-4V7z",
  clip: "M10 8l6 4-6 4V8z M3 5h18v14H3z",
  heading: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
  note: "M2 12s3.5-7 10-7 10 7 10 7 M2 12s3.5 7 10 7 10-7 10-7 M4 4l16 16",
  grid: "M4 4h16v16H4z M4 10h16 M4 15h16 M10 4v16 M15 10v10",
};
const TYPES: { kind: CardKind; name: string; desc: string }[] = [
  { kind: "scripture", name: "Scripture", desc: "your marks come with it" },
  { kind: "text", name: "Your words", desc: "a thought in your voice" },
  { kind: "question", name: "Question", desc: "something to ask" },
  { kind: "quote", name: "Quote", desc: "an outside voice" },
  { kind: "clip", name: "Clip", desc: "a video, starting where you want" },
  { kind: "heading", name: "Heading", desc: "start a section" },
  { kind: "note", name: "Note to self", desc: "private — only you" },
  { kind: "grid", name: "Grid", desc: "rows and columns of info" },
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

// One grid cell (SCR-73): a plain-text textarea that grows with its wrapped
// content, so the grid never scrolls sideways and never clips a cell.
function GridCell({
  value,
  onChange,
  placeholder,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.max(el.scrollHeight, 34) + "px";
    }
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      style={style}
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
export function fmtTime(t?: number): string {
  if (t == null) return "";
  const m = Math.floor(t / 60),
    s = t % 60;
  return m + ":" + String(s).padStart(2, "0");
}

// A time field ("m:ss" or plain seconds) that lets you TYPE freely. The old
// version parsed and reformatted on every keystroke, so entering "6" instantly
// became "0:06" and the caret/digits jumped around. This one holds a local
// draft while focused and only parses + commits on blur or Enter.
function TimeInput({
  seconds,
  placeholder,
  onCommit,
  style,
}: {
  seconds?: number;
  placeholder?: string;
  onCommit: (secs: number | undefined) => void;
  style?: React.CSSProperties;
}) {
  const [draft, setDraft] = useState(fmtTime(seconds));
  const focused = useRef(false);
  // Adopt outside changes (e.g. "Set start here" from the preview player) —
  // but never while the user is mid-typing.
  useEffect(() => {
    if (!focused.current) setDraft(fmtTime(seconds));
  }, [seconds]);
  const commit = () => {
    const val = draft.trim();
    if (!val) {
      onCommit(undefined);
      setDraft("");
      return;
    }
    const p = val.split(":").map((n) => parseInt(n, 10) || 0);
    const secs =
      p.length >= 3
        ? p[0] * 3600 + p[1] * 60 + p[2]
        : p.length === 2
        ? p[0] * 60 + p[1]
        : p[0] || 0;
    onCommit(secs);
    setDraft(fmtTime(secs));
  };
  return (
    <input
      value={draft}
      placeholder={placeholder}
      inputMode="numeric"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      style={style}
    />
  );
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
export function parseYouTubeId(url: string): string | null {
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
        // Privacy-enhanced host + explicit origin, to satisfy YouTube's bot
        // check (same treatment as the saved-clip player).
        host: "https://www.youtube-nocookie.com",
        playerVars: {
          start: Math.max(0, Math.round(startSec || 0)),
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          origin:
            typeof window !== "undefined" ? window.location.origin : undefined,
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
export function ClipPlayer({
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
  // The privacy-enhanced embed host + an explicit origin usually satisfies
  // YouTube's bot check (the plain youtube.com/embed + autoplay combo is what
  // trips the "sign in to confirm you're not a bot" wall, and there's no way
  // to sign in inside the frame).
  const src =
    "https://www.youtube-nocookie.com/embed/" +
    videoId +
    "?start=" +
    start +
    (endSec != null ? "&end=" + Math.round(endSec) : "") +
    "&autoplay=1&rel=0&modestbranding=1&playsinline=1" +
    (typeof window !== "undefined"
      ? "&origin=" + encodeURIComponent(window.location.origin)
      : "");
  // Escape hatch for videos that refuse to embed at all (age-restricted,
  // embed-disabled, or a bot wall that won't clear): open on YouTube at the
  // clip's start.
  const watchUrl =
    "https://www.youtube.com/watch?v=" +
    videoId +
    (start ? "&t=" + start + "s" : "");
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
        {playing ? (
          <iframe
            title="clip"
            src={src}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
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
      {playing && (
        <div style={{ textAlign: "right", marginTop: 6 }}>
          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              fontFamily: SANS,
              fontSize: 11.5,
              fontWeight: 600,
              color: "var(--muted)",
              textDecoration: "none",
            }}
          >
            Trouble playing? Watch on YouTube ↗
          </a>
        </div>
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
  onMarkCard,
  themesFor,
  chooserFootnote,
  shelf,
  onPlaceFromShelf,
  onDeleteFromShelf,
  verseTextFor,
  outlineMode,
  externalDragRef,
  onExternalDrop,
  traySide,
  trayTop,
  live,
  verseView = "full",
  renderVerseFocused,
  onRenameTheme,
}: StudyTableColumnProps) {
  // Outline mode: which card is expanded to its full editor, which row is
  // hovered (tools), which is drag-reordering, which ✕ is armed.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hoverRowId, setHoverRowId] = useState<string | null>(null);
  const [rowDragId, setRowDragId] = useState<string | null>(null);
  const [outlineConfirmId, setOutlineConfirmId] = useState<string | null>(
    null
  );
  // Tray state: pill vs expanded, the delete being confirmed, and the
  // grab-drag in flight (trayOverIndex = where the drop line sits).
  const [trayOpen, setTrayOpen] = useState(false);
  const [trayConfirmId, setTrayConfirmId] = useState<string | null>(null);
  const [trayDragId, setTrayDragId] = useState<string | null>(null);
  const [trayOverIndex, setTrayOverIndex] = useState<number | null>(null);
  // Any drag the column can receive: a tray card, a row reorder, or a verse
  // from the in-table reader. One gate for drop lines / aprons, one executor
  // for the drop itself.
  const extDrag = !!(externalDragRef && onExternalDrop);
  const dragInFlight = !!trayDragId || !!rowDragId || extDrag;
  const performDrop = (at: number) => {
    if (trayDragId && onPlaceFromShelf) onPlaceFromShelf(trayDragId, at);
    else if (rowDragId) moveTo(rowDragId, at);
    else if (extDrag) onExternalDrop!(at);
    setTrayDragId(null);
    setRowDragId(null);
    setTrayOverIndex(null);
  };
  // Which "+" gap has its type-chooser open (insert index), or null.
  const [openAt, setOpenAt] = useState<number | null>(null);
  // Newly inserted card to autofocus once.
  const [focusId, setFocusId] = useState<string | null>(null);
  // Which gap is hovered — the + affordance reveals only there, so at rest the
  // card stack stays an unbroken line.
  const [hoverGap, setHoverGap] = useState<number | null>(null);
  // Drag a scripture card onto another scripture card to MERGE them: their
  // verses join one card (presented together). dragId = the card in hand,
  // mergeOverId = the card it's hovering, mergePrompt = the confirm dialog.
  const [dragId, setDragId] = useState<string | null>(null);
  // Button-driven merge (works everywhere, incl. touch): tap Merge on a card
  // to arm the mode, tap more scripture cards to add them, then hit "Merge
  // cards" in the floating bar. Verses combine in COLUMN PLACEMENT order —
  // the order is the lesson (Kepu, SCR-76); the opened card's chip arrows and
  // Scripture-order sort rearrange them afterwards.
  const [mergeSel, setMergeSel] = useState<string[]>([]);
  const toggleMergeSel = (id: string) =>
    setMergeSel((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : [...p, id]
    );
  const [mergeOverId, setMergeOverId] = useState<string | null>(null);
  const [mergePrompt, setMergePrompt] = useState<{ ids: string[] } | null>(
    null
  );
  const doMerge = () => {
    if (!mergePrompt) return;
    const ids = mergePrompt.ids;
    setMergePrompt(null);
    setMergeSel([]);
    const chosen = cards.filter(
      (c) => ids.includes(c.id) && c.kind === "scripture"
    );
    if (chosen.length < 2) return;
    // The topmost selected card (column order) receives everyone's verses,
    // kept in the order the cards sat in the column (SCR-76: placement order,
    // not scripture order — resort within the card afterwards if wanted).
    const target = chosen[0];
    const merged = Array.from(
      new Set(chosen.flatMap((c) => c.refs || []))
    );
    const dropIds = new Set(chosen.slice(1).map((c) => c.id));
    onChange(
      cards
        .filter((c) => !dropIds.has(c.id))
        .map((c) =>
          c.id === target.id
            ? {
                ...c,
                refs: merged,
                // A passage stays a passage only while its verses still run
                // consecutively; otherwise it becomes a verse list.
                passage: !!target.passage && isConsecutive(merged),
              }
            : c
        )
    );
    };
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
  // Move a card to an absolute index (outline-mode grab-drag reorder).
  const moveTo = (id: string, index: number) => {
    const from = cards.findIndex((c) => c.id === id);
    if (from === -1) return;
    const next = cards.slice();
    const [c] = next.splice(from, 1);
    const to = Math.max(0, Math.min(from < index ? index - 1 : index, next.length));
    next.splice(to, 0, c);
    onChange(next);
  };
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
    // Grid (SCR-73): starts as 2 columns × 1 body row; the editor's column
    // chips (1–3) and add-row control take it from there.
    if (kind === "grid") {
      card.gridHead = ["", ""];
      card.gridRows = [["", ""]];
    }
    onChange([...cards.slice(0, index), card, ...cards.slice(index)]);
    setOpenAt(null);
    setFocusId(card.id);
    // In the dense (outline) rendering a fresh card must EXPAND to its
    // editor — otherwise the insert lands as a collapsed one-line row and
    // the user has to find and tap it again.
    if (outlineMode) setEditingId(card.id);
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
    // Longhand on purpose: scripture/grid cards override borderLeft with their
    // accent bar, and React warns when a shorthand and a longhand for the same
    // edge trade places across rerenders (the Focused/Full density flip).
    borderTop: "1px solid var(--border)",
    borderRight: "1px solid var(--border)",
    borderBottom: "1px solid var(--border)",
    borderLeft: "1px solid var(--border)",
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
      width: COARSE ? 42 : 26,
      height: COARSE ? 42 : 26,
      borderRadius: COARSE ? 11 : 7,
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
          aria-label="Move card up"
          onClick={() => move(id, -1)}
          style={btn}
        >
          <Icon d="M12 19V5 M6 11l6-6 6 6" size={COARSE ? 18 : 13} />
        </button>
        <button
          title="Move down"
          aria-label="Move card down"
          onClick={() => move(id, 1)}
          style={btn}
        >
          <Icon d="M12 5v14 M6 13l6 6 6-6" size={COARSE ? 18 : 13} />
        </button>
        <button
          title="Delete card"
          aria-label="Delete card"
          onClick={() => setConfirmId(id)}
          style={{ ...btn, marginLeft: "auto" }}
        >
          <Icon d="M18 6 6 18 M6 6l12 12" size={COARSE ? 18 : 13} />
        </button>
      </div>
    );
  }

  // ---------- per-kind editors ----------
  // Text-bearing kinds get ONE Done: the editor's, which saves AND collapses
  // the card (Kepu, Jul 28 — never two Done buttons on one box). The outer
  // collapse Done renders only for multi-part kinds (scripture, clip, grid).
  const SINGLE_DONE_KINDS: CardKind[] = [
    "heading",
    "text",
    "question",
    "quote",
    "note",
  ];
  const collapseCard = (id: string) =>
    setEditingId((p) => (p === id ? null : p));

  const renderCard = (card: TableCard, index: number) => {
    // Open the rich editor immediately for a freshly inserted card AND for a
    // card expanded from its dense row — a dense tap means "edit this", same
    // as when the dense line opened a bare textarea.
    const focus = card.id === focusId || (!!outlineMode && editingId === card.id);
    const doneCollapse = outlineMode
      ? () => collapseCard(card.id)
      : undefined;

    if (card.kind === "heading") {
      return (
        <div
          style={{
            borderBottom: "1.5px dashed var(--border)",
            padding: "6px 2px",
          }}
        >
          <RichCardText
            value={card.text || ""}
            autoFocus={focus}
            placeholder="Name this section…"
            onChange={(v) => patch(card.id, { text: v })}
            onDone={doneCollapse}
            accent={accent}
            style={{
              fontFamily: SANS,
              fontSize: COARSE ? 16 : 15,
              fontWeight: 700,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: "var(--text)",
            }}
          />
        </div>
      );
    }

    if (card.kind === "text") {
      return (
        <div style={{ borderLeft: "2px solid " + softAccentBorder, paddingLeft: 15 }}>
          <RichCardText
            value={card.text || ""}
            autoFocus={focus}
            placeholder="Write your thought…"
            onChange={(v) => patch(card.id, { text: v })}
            onDone={doneCollapse}
            accent={accent}
            style={{
              fontFamily: SERIF,
              fontSize: COARSE ? 16 : 15.5,
              lineHeight: 1.6,
              color: "var(--text)",
            }}
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
          <RichCardText
            value={card.text || ""}
            autoFocus={focus}
            placeholder="Ask something…"
            onChange={(v) => patch(card.id, { text: v })}
            onDone={doneCollapse}
            accent={accent}
            style={{
              fontFamily: SERIF,
              fontSize: 16,
              lineHeight: 1.6,
              color: "var(--text)",
            }}
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
          <RichCardText
            value={card.text || ""}
            autoFocus={focus}
            placeholder="The quote…"
            onChange={(v) => patch(card.id, { text: v })}
            onDone={doneCollapse}
            accent={accent}
            style={{
              fontFamily: SERIF,
              fontStyle: "italic",
              fontSize: COARSE ? 16 : 15.5,
              lineHeight: 1.6,
              color: "var(--text)",
            }}
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

    if (card.kind === "grid") {
      // SCR-73: header row + up to 4 body rows, up to 3 columns, plain-text
      // wrapped cells (never sideways scroll). The description OUTSIDE the
      // grid is rich text like every other card text.
      const head = card.gridHead && card.gridHead.length ? card.gridHead : ["", ""];
      const cols = Math.max(1, Math.min(3, head.length));
      const rows = (card.gridRows || []).map((r) => {
        const c = r.slice(0, cols);
        while (c.length < cols) c.push("");
        return c;
      });
      const setCols = (n: number) => {
        if (n === cols) return;
        if (n < cols) {
          const dropped =
            head.slice(n).some((x) => (x || "").trim()) ||
            rows.some((r) => r.slice(n).some((x) => (x || "").trim()));
          if (
            dropped &&
            !window.confirm(
              "Dropping to " +
                n +
                (n === 1 ? " column" : " columns") +
                " deletes the text in the removed column" +
                (cols - n > 1 ? "s" : "") +
                ". Continue?"
            )
          )
            return;
        }
        const resize = (r: string[]) => {
          const c = r.slice(0, n);
          while (c.length < n) c.push("");
          return c;
        };
        patch(card.id, {
          gridHead: resize(head),
          gridRows: rows.map(resize),
        });
      };
      const setCell = (row: number, col: number, v: string) => {
        if (row < 0) {
          const h = head.slice();
          h[col] = v;
          patch(card.id, { gridHead: h });
        } else {
          const rs = rows.map((r) => r.slice());
          rs[row][col] = v;
          patch(card.id, { gridRows: rs });
        }
      };
      const cellBox: React.CSSProperties = {
        width: "100%",
        boxSizing: "border-box",
        border: "1px solid var(--border)",
        background: "var(--panel)",
        color: "var(--text)",
        fontFamily: SANS,
        fontSize: COARSE ? 16 : 13,
        lineHeight: 1.45,
        padding: "7px 8px",
        resize: "none",
        outline: "none",
        overflow: "hidden",
        display: "block",
        borderRadius: 0,
      };
      return (
        <div style={{ ...cardBox, borderLeft: "3px solid var(--pen5)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ ...kicker, margin: 0, flex: 1 }}>
              <Icon d={ICON.grid} size={12} /> Grid
            </div>
            <span style={{ ...kicker, margin: 0 }}>columns</span>
            {[1, 2, 3].map((n) => (
              <Chip
                key={n}
                on={cols === n}
                label={String(n)}
                onClick={() => setCols(n)}
              />
            ))}
          </div>
          <RichCardText
            value={card.text || ""}
            autoFocus={focus}
            placeholder="What does this table hold?…"
            onChange={(v) => patch(card.id, { text: v })}
            accent={accent}
            style={{
              fontFamily: SERIF,
              fontSize: COARSE ? 16 : 14.5,
              lineHeight: 1.55,
              color: "var(--muted)",
            }}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(" + cols + ", 1fr)",
              gap: 0,
              marginTop: 10,
              border: "1px solid var(--border)",
              borderRadius: 9,
              overflow: "hidden",
            }}
          >
            {head.map((h, ci) => (
              <GridCell
                key={"h" + ci}
                value={h}
                placeholder={"Header " + (ci + 1)}
                onChange={(v) => setCell(-1, ci, v)}
                style={{
                  ...cellBox,
                  fontWeight: 700,
                  background: "var(--soft)",
                }}
              />
            ))}
            {rows.map((r, ri) =>
              r.map((cell, ci) => (
                <GridCell
                  key={ri + "." + ci}
                  value={cell}
                  placeholder=""
                  onChange={(v) => setCell(ri, ci, v)}
                  style={cellBox}
                />
              ))
            )}
          </div>
          <div style={{ display: "flex", gap: 7, marginTop: 9, alignItems: "center" }}>
            {rows.length < 4 ? (
              <Chip
                on={false}
                label="+ row"
                onClick={() =>
                  patch(card.id, {
                    gridRows: [...rows, Array.from({ length: cols }, () => "")],
                  })
                }
              />
            ) : (
              <span style={{ ...kicker, margin: 0 }}>4 rows is the ceiling</span>
            )}
            {rows.length > 1 && (
              <Chip
                on={false}
                label="− row"
                onClick={() => {
                  const last = rows[rows.length - 1];
                  if (
                    last.some((x) => (x || "").trim()) &&
                    !window.confirm(
                      "Remove the last row? Its text will be deleted."
                    )
                  )
                    return;
                  patch(card.id, { gridRows: rows.slice(0, -1) });
                }}
              />
            )}
          </div>
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
          <RichCardText
            value={card.text || ""}
            autoFocus={focus}
            placeholder="A private note — pause here, tell the story…"
            onChange={(v) => patch(card.id, { text: v })}
            onDone={doneCollapse}
            accent={accent}
            style={{
              fontFamily: SERIF,
              fontStyle: "italic",
              fontSize: COARSE ? 16 : 15,
              lineHeight: 1.6,
              color: "var(--text)",
            }}
          />
        </div>
      );
    }

    if (card.kind === "scripture") {
      const refs = card.refs || [];
      return (
        <div style={{ ...cardBox, borderLeft: "3px solid " + accent }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ ...kicker, color: accent, margin: 0, flex: 1 }}>
              <Icon d={ICON.scripture} size={12} /> Scripture
            </div>
            {refs.length > 0 && (
              <button
                onClick={() => toggleMergeSel(card.id)}
                title={
                  mergeSel.includes(card.id)
                    ? "Remove from the merge"
                    : mergeSel.length
                    ? "Add this card to the merge"
                    : "Merge cards — tap Merge here, then tap the other cards to combine"
                }
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontFamily: SANS,
                  fontSize: COARSE ? 12.5 : 11.5,
                  fontWeight: 600,
                  color: mergeSel.includes(card.id) ? "#fff" : "var(--muted)",
                  background: mergeSel.includes(card.id)
                    ? accent
                    : "transparent",
                  border:
                    "1px solid " +
                    (mergeSel.includes(card.id) ? accent : "var(--border)"),
                  borderRadius: 999,
                  padding: COARSE ? "6px 13px" : "3px 10px",
                  cursor: "pointer",
                }}
              >
                <Icon
                  d="M8 7h8M8 12h8M8 17h5 M17 14l3 3-3 3"
                  size={11}
                />
                {mergeSel.includes(card.id)
                  ? "✓ Merging"
                  : mergeSel.length
                  ? "Select"
                  : "Merge"}
              </button>
            )}
            {refs.length > 1 && (
              <button
                onClick={() => {
                  const sorted = sortRefs([...refs]);
                  patch(card.id, {
                    refs: sorted,
                    passage: !!card.passage && isConsecutive(sorted),
                  });
                }}
                title="Re-sort this card's verses into scripture order (merge keeps them in placement order)"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontFamily: SANS,
                  fontSize: COARSE ? 12.5 : 11.5,
                  fontWeight: 600,
                  color: "var(--muted)",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  padding: COARSE ? "6px 13px" : "3px 10px",
                  cursor: "pointer",
                }}
              >
                <Icon d="M3 6h13M3 12h9M3 18h5 M17 8v10 M14 15l3 3 3-3" size={11} />
                Sort
              </button>
            )}
            {refs.length > 1 && (
              <button
                onClick={() => {
                  // One tap undoes a merge: one card per verse, in the card's
                  // current order, standing where the merged card stood. The
                  // first split keeps this card's id so nothing else re-keys.
                  const split: TableCard[] = refs.map((r, k) => ({
                    id: k === 0 ? card.id : newCardId(),
                    kind: "scripture",
                    refs: [r],
                    bookId: card.bookId,
                  }));
                  onChange(
                    cards.flatMap((c) => (c.id === card.id ? split : [c]))
                  );
                  setEditingId(null);
                }}
                title="Split this card back into one card per verse, in this order"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontFamily: SANS,
                  fontSize: COARSE ? 12.5 : 11.5,
                  fontWeight: 600,
                  color: "var(--muted)",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  padding: COARSE ? "6px 13px" : "3px 10px",
                  cursor: "pointer",
                }}
              >
                <Icon d="M8 7h8M8 12h8M8 17h8 M4 5v14 M20 5v14" size={11} />
                Unmerge
              </button>
            )}
            {onMarkCard && refs.length > 0 && (
              <button
                onClick={() => onMarkCard(card)}
                title="Mark this verse"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontFamily: SANS,
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: accent,
                  background: "transparent",
                  border: "1px solid " + accent,
                  borderRadius: 999,
                  padding: "3px 10px",
                  cursor: "pointer",
                }}
              >
                <Icon
                  d="M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"
                  size={11}
                />
                Mark
              </button>
            )}
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
                {refs.length > 1 && (
                  <span style={{ display: "inline-flex", gap: 2 }}>
                    <button
                      onClick={() => {
                        if (i === 0) return;
                        const next = [...refs];
                        [next[i - 1], next[i]] = [next[i], next[i - 1]];
                        patch(card.id, { refs: next });
                      }}
                      title="Move earlier"
                      aria-label="Move verse earlier"
                      style={{
                        border: 0,
                        background: "transparent",
                        color: i === 0 ? "var(--border)" : "var(--muted)",
                        cursor: i === 0 ? "default" : "pointer",
                        padding: 0,
                        lineHeight: 0,
                      }}
                    >
                      <Icon d="M15 6l-6 6 6 6" size={11} />
                    </button>
                    <button
                      onClick={() => {
                        if (i === refs.length - 1) return;
                        const next = [...refs];
                        [next[i + 1], next[i]] = [next[i], next[i + 1]];
                        patch(card.id, { refs: next });
                      }}
                      title="Move later"
                      aria-label="Move verse later"
                      style={{
                        border: 0,
                        background: "transparent",
                        color:
                          i === refs.length - 1
                            ? "var(--border)"
                            : "var(--muted)",
                        cursor:
                          i === refs.length - 1 ? "default" : "pointer",
                        padding: 0,
                        lineHeight: 0,
                      }}
                    >
                      <Icon d="M9 6l6 6-6 6" size={11} />
                    </button>
                  </span>
                )}
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
          {refs.length > 0 &&
            themesFor &&
            (() => {
              const themes = themesFor(refs, card.bookId);
              if (!themes.length) return null;
              return (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    marginBottom: 8,
                  }}
                >
                  {themes.map((t) => (
                    <span
                      key={t.color}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontFamily: SANS,
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: "var(--muted)",
                      }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: COLOR_MAP[t.color as MarkColor],
                          flexShrink: 0,
                        }}
                      />
                      {t.label}
                    </span>
                  ))}
                </div>
              );
            })()}
          {refs.length > 1 && (
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                marginTop: 4,
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
              {refs.map((r, vi) => (
                <Fragment key={r}>
                  {/* SCR-79: a merged card labels every verse with its own
                      reference — without this the verses read as one
                      continuous text. Passage mode stays continuous on
                      purpose (that is what "Show as one passage" means). */}
                  {refs.length > 1 && !card.passage && (
                    <div
                      style={{
                        fontFamily: SANS,
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: accent,
                        marginTop: vi > 0 ? 12 : 0,
                        marginBottom: 3,
                      }}
                    >
                      {r}
                    </div>
                  )}
                  {renderVerse(r, card.bookId)}
                </Fragment>
              ))}
            </div>
          ) : refs.length === 0 && onPickScripture ? (
            <button
              onClick={() => {
                // A verse-less card is a dead end (verses come from the panel),
                // so swap it for the panel itself: remove it and open the picker
                // at its spot — the chosen verses land exactly here.
                remove(card.id);
                onPickScripture(index);
              }}
              style={{
                marginTop: 4,
                fontFamily: SANS,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                color: accent,
                background: "transparent",
                border: "1px solid " + accent,
                borderRadius: 999,
                padding: "6px 14px",
              }}
            >
              Choose verses
            </button>
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
            <TimeInput
              seconds={card.startSec}
              placeholder="0:00"
              onCommit={(secs) => patch(card.id, { startSec: secs ?? 0 })}
              style={clipTimeStyle}
            />
          </div>
          <div style={{ flex: 1, minWidth: 110 }}>
            <div style={{ ...kicker, marginBottom: 5 }}>End (optional)</div>
            <TimeInput
              seconds={card.endSec}
              placeholder="e.g. 6:10"
              onCommit={(secs) => patch(card.id, { endSec: secs })}
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

  // ---- Outline-mode dense rows (SCR-58 inverse) ----
  const compiledHeadingColor = (card: TableCard): MarkColor | null => {
    if (card.kind !== "heading" || card.id.indexOf("compiled_h") !== 0)
      return null;
    const n = Number(card.id.slice("compiled_h".length));
    return n >= 1 && n <= 10 ? (n as MarkColor) : null;
  };
  // The pen governing a card's section: the nearest heading above it, when
  // that heading is a compiled theme. Verses under it render ONLY that color
  // (Kepu, Jul 20 — red only shows in red); under an authored heading (or no
  // heading) a verse wears all its colors as before.
  const sectionColorAt = (i: number): MarkColor | undefined => {
    for (let j = i; j >= 0; j--) {
      if (cards[j].kind === "heading")
        return compiledHeadingColor(cards[j]) ?? undefined;
    }
    return undefined;
  };
  const denseLine = (
    card: TableCard,
    color: string,
    tag: string,
    body: string,
    extra?: string
  ) => (
    <div
      onClick={() => setEditingId(card.id)}
      style={{
        borderLeft: "3px solid " + color,
        padding: "4px 10px",
        margin: "5px 0 2px 4px",
        fontFamily: SANS,
        fontSize: 13,
        color: "var(--text)",
        lineHeight: 1.55,
        cursor: "pointer",
      }}
    >
      <span
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: ".06em",
          color: "var(--muted)",
          textTransform: "uppercase",
          marginRight: 7,
        }}
      >
        {tag}
      </span>
      {/* Dense rows are deliberately tight plain-text lines — rich card text
          shows its words here; formatting appears in the full rendering. */}
      {richToPlain(body) || (
        <span style={{ color: "var(--muted)", fontStyle: "italic" }}>
          tap to write…
        </span>
      )}
      {extra ? <span style={{ color: "var(--muted)" }}> — {extra}</span> : null}
    </div>
  );
  const denseRow = (card: TableCard, themeColor?: MarkColor) => {
    if (card.kind === "heading") {
      const hc = compiledHeadingColor(card);
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "16px 0 6px",
            borderBottom:
              "2.5px solid " + (hc != null ? COLOR_MAP[hc] : "var(--border)"),
            marginBottom: 4,
          }}
        >
          {hc != null && (
            <span
              style={{
                width: 11,
                height: 11,
                borderRadius: "50%",
                background: COLOR_MAP[hc],
                flex: "0 0 auto",
              }}
            />
          )}
          <input
            value={richToPlain(card.text || "")}
            placeholder="Name this theme…"
            onChange={(e) =>
              // While Compiled · live a compiled heading IS the theme — its
              // rename edits the theme's label and never promotes. Once the
              // table is yours (or the heading is user-made) it's card text.
              live && hc != null && onRenameTheme
                ? onRenameTheme(hc, e.target.value)
                : patch(card.id, { text: e.target.value })
            }
            style={{
              border: "none",
              outline: "none",
              fontSize: 16,
              fontWeight: 700,
              background: "transparent",
              flex: 1,
              color: "var(--text)",
              fontFamily: SANS,
            }}
          />
        </div>
      );
    }
    if (card.kind === "scripture") {
      const refs = card.refs || [];
      return (
        <div style={{ padding: "6px 0 2px 4px" }}>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 12.5,
              fontWeight: 700,
              color: accent,
              marginBottom: 1,
            }}
          >
            {refs.join(", ")}
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 15, lineHeight: 1.65 }}>
            {refs.map((r) => (
              <div key={r} data-vref={r}>
                {verseView === "focused" && renderVerseFocused
                  ? renderVerseFocused(r, card.bookId, themeColor)
                  : renderVerse
                  ? renderVerse(r, card.bookId, themeColor)
                  : r}
              </div>
            ))}
          </div>
        </div>
      );
    }
    if (card.kind === "text")
      return denseLine(
        card,
        "#f0a24b",
        "Your words" + (card.role ? " · " + card.role : ""),
        card.text || ""
      );
    if (card.kind === "question")
      return denseLine(
        card,
        "#8b5cf6",
        "Question" + (card.qtype ? " · " + card.qtype : ""),
        card.text || ""
      );
    if (card.kind === "quote")
      return denseLine(card, "var(--muted)", "Quote", card.text || "", card.attribution);
    if (card.kind === "note")
      return denseLine(card, "var(--border)", "Note · private", card.text || "");
    if (card.kind === "grid")
      return denseLine(
        card,
        "var(--pen5)",
        "Grid",
        card.text || "",
        (card.gridHead || []).length +
          " × " +
          ((card.gridRows || []).length + 1)
      );
    // clip: title + slice; the full player lives in the expanded editor.
    return denseLine(
      card,
      accent,
      "Clip",
      card.clipTitle || card.url || "",
      card.startSec != null ? "from " + card.startSec + "s" : undefined
    );
  };
  const toolBtn: React.CSSProperties = {
    width: 24,
    height: 24,
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--panel)",
    color: "var(--muted)",
    fontSize: 12,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    lineHeight: 0,
  };
  const rowTools = (card: TableCard, i: number) => (
    // Anchored to the card's own bounded surface (SCR-72) — the tools sit
    // just inside its border, never floating in the gutter between cards.
    <div
      style={{
        position: "absolute",
        right: 6,
        top: card.kind === "heading" ? 14 : 5,
        display: "flex",
        gap: 4,
        zIndex: 5,
      }}
    >
      {card.kind === "scripture" && (
        <button
          onClick={() => toggleMergeSel(card.id)}
          title={
            mergeSel.includes(card.id)
              ? "Remove from the merge"
              : mergeSel.length
              ? "Add this card to the merge"
              : "Merge cards — tap here, then tap the other cards to combine"
          }
          style={
            mergeSel.includes(card.id)
              ? { ...toolBtn, background: accent, borderColor: accent, color: "#fff" }
              : toolBtn
          }
        >
          ⧉
        </button>
      )}
      {card.kind === "scripture" && (
        <button
          onClick={() => setEditingId(card.id)}
          title="Edit this card"
          style={toolBtn}
        >
          ✎
        </button>
      )}
      <button
        onClick={() => {
          if (outlineConfirmId === card.id) {
            setOutlineConfirmId(null);
            remove(card.id);
          } else {
            setOutlineConfirmId(card.id);
          }
        }}
        title={
          outlineConfirmId === card.id
            ? "Tap again to remove" +
              (card.kind === "scripture" ? " — the verse waits in the tray" : "")
            : "Remove"
        }
        style={
          outlineConfirmId === card.id
            ? { ...toolBtn, background: "#b3452f", borderColor: "#b3452f", color: "#fff" }
            : toolBtn
        }
      >
        ✕
      </button>
    </div>
  );

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
          {chooserFootnote && (
            <div
              style={{
                fontFamily: SANS,
                fontSize: 11,
                color: "var(--muted)",
                fontStyle: "italic",
                lineHeight: 1.5,
                padding: "8px 6px 2px",
              }}
            >
              {chooserFootnote}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- empty state ----------
  // Only when the tray is empty too — with cards waiting (e.g. right after
  // Clear to tray), the main render carries the tray and its drop target.
  if (cards.length === 0 && !(shelf && shelf.length)) {
    return (
      <div
        style={{
          maxWidth: 660,
          margin: "0 auto",
          // Droppable like the main column (SCR-75): this early return used
          // to carry no drag handlers at all, so a blank table refused every
          // drop — the reader drag only "worked" via the tray detour.
          borderRadius: 13,
          border: dragInFlight
            ? "2px dashed var(--muted)"
            : "2px dashed transparent",
        }}
        onDragOver={(e) => {
          if (dragInFlight) {
            e.preventDefault();
            e.dataTransfer.dropEffect = extDrag ? "copy" : "move";
          }
        }}
        onDrop={(e) => {
          if (dragInFlight) {
            e.preventDefault();
            performDrop(0);
          }
        }}
      >
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
    <div
      style={{
        maxWidth: 660,
        margin: "0 auto",
        position: "relative",
        // While a drag is in flight the column grows a drop apron below its
        // last card, so "just below the column" is droppable too — without
        // it, the root ends at its content and drops there are refused.
        paddingBottom: dragInFlight ? "26vh" : undefined,
      }}
      // Catch-all drop target: a tray card or an outline row dropped anywhere
      // in the column that no inner target claimed lands at the END. Without
      // this, an empty column offered only the thin empty-message strip as a
      // droppable area — the first drag from the tray read as "not allowed"
      // everywhere else (Kepu's bug, Jul 22). Inner targets preventDefault
      // first, so `defaultPrevented` marks them as having claimed the event.
      onDragOver={(e) => {
        if (e.defaultPrevented) return;
        if ((e.target as HTMLElement).closest("[data-tray]")) return;
        if (dragInFlight) {
          e.preventDefault();
          // Reader/search grabbers start their drag with effectAllowed
          // "copy" (the verse is copied in; the source keeps it). Answering
          // "move" made the browser refuse the drop outright — the drop line
          // showed but releasing did nothing (SCR-75). Internal tray/reorder
          // drags stay moves.
          e.dataTransfer.dropEffect = extDrag ? "copy" : "move";
          setTrayOverIndex(cards.length);
        }
      }}
      onDrop={(e) => {
        if (e.defaultPrevented) return;
        if ((e.target as HTMLElement).closest("[data-tray]")) return;
        if (dragInFlight) {
          e.preventDefault();
          performDrop(cards.length);
        }
      }}
    >
      {/* spine */}
      {!outlineMode && (
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
      )}
      {cards.map((card, i) => {
        const isSection = card.kind === "heading";
        return (
          <Fragment key={card.id}>
            <div
              style={{ paddingLeft: 32 }}
              onMouseEnter={() => setHoverGap(i)}
              onMouseLeave={() => setHoverGap((g) => (g === i ? null : g))}
            >
              {dragInFlight && trayOverIndex === i && (
                <div
                  style={{
                    height: 3,
                    borderRadius: 2,
                    background: accent,
                    margin: "5px 2px",
                  }}
                />
              )}
              <AddBar index={i} show={hoverGap === i} />
              {openAt === i && <Chooser index={i} />}
            </div>
            <div
              data-card-id={card.id}
              data-card-kind={card.kind}
              draggable={!outlineMode && card.kind === "scripture"}
              onDragStart={(e) => {
                if (outlineMode || card.kind !== "scripture") return;
                setDragId(card.id);
                e.dataTransfer.effectAllowed = "move";
                try {
                  e.dataTransfer.setData("text/plain", card.id);
                } catch {}
              }}
              onDragEnd={() => {
                setDragId(null);
                setMergeOverId(null);
              }}
              onDragOver={(e) => {
                // A tray card, an outline row, or a reader verse in hand:
                // show the drop line above or below this card by pointer
                // half — exact placement.
                if (dragInFlight) {
                  e.preventDefault();
                  // "copy" for reader/search verses, "move" for internal
                  // drags — a dropEffect outside the source's effectAllowed
                  // makes the browser refuse the drop (SCR-75).
                  e.dataTransfer.dropEffect = extDrag ? "copy" : "move";
                  const r = e.currentTarget.getBoundingClientRect();
                  setTrayOverIndex(
                    e.clientY < r.top + r.height / 2 ? i : i + 1
                  );
                  return;
                }
                if (
                  dragId &&
                  dragId !== card.id &&
                  card.kind === "scripture"
                ) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setMergeOverId(card.id);
                }
              }}
              onDragLeave={() =>
                setMergeOverId((p) => (p === card.id ? null : p))
              }
              onDrop={(e) => {
                if (dragInFlight) {
                  e.preventDefault();
                  performDrop(trayOverIndex ?? i);
                  return;
                }
                if (
                  dragId &&
                  dragId !== card.id &&
                  card.kind === "scripture"
                ) {
                  e.preventDefault();
                  setMergePrompt({ ids: [dragId, card.id] });
                }
                setDragId(null);
                setMergeOverId(null);
              }}
              onClickCapture={
                mergeSel.length > 0 && card.kind === "scripture"
                  ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleMergeSel(card.id);
                    }
                  : undefined
              }
              onMouseEnter={
                outlineMode ? () => setHoverRowId(card.id) : undefined
              }
              onMouseLeave={
                outlineMode
                  ? () => {
                      setHoverRowId((p) => (p === card.id ? null : p));
                      setOutlineConfirmId((p) => (p === card.id ? null : p));
                    }
                  : undefined
              }
              style={{
                position: "relative",
                display: "grid",
                gridTemplateColumns: outlineMode ? "30px 1fr" : "28px 1fr",
                alignItems: "start",
                marginTop: !outlineMode && isSection ? 18 : 0,
                marginBottom: !outlineMode && isSection ? 6 : 0,
                cursor:
                  mergeSel.length && card.kind === "scripture"
                    ? "pointer"
                    : card.kind === "scripture"
                    ? "grab"
                    : undefined,
                opacity: dragId === card.id ? 0.45 : 1,
                outline: mergeSel.includes(card.id)
                  ? "2.5px solid " + accent
                  : mergeOverId === card.id ||
                    (mergeSel.length && card.kind === "scripture")
                  ? "2.5px dashed " + accent
                  : undefined,
                outlineOffset:
                  mergeOverId === card.id ||
                  mergeSel.length ||
                  mergeSel.includes(card.id)
                    ? 3
                    : undefined,
                borderRadius:
                  mergeOverId === card.id || mergeSel.length ? 14 : undefined,
                transition: "opacity .12s ease",
              }}
            >
              {!outlineMode && (
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
              )}
              {outlineMode && (
                <span
                  draggable
                  onDragStart={(e) => {
                    setRowDragId(card.id);
                    e.dataTransfer.effectAllowed = "move";
                    try {
                      e.dataTransfer.setData("text/plain", card.id);
                    } catch {}
                    // The card itself follows the pointer — the reading
                    // panel grabber's ghost (Kepu, Jul 22).
                    if (card.kind === "scripture") {
                      setVerseDragImage(
                        e,
                        (card.refs || []).map((r) => ({
                          reference: r,
                          text: verseTextFor ? verseTextFor(r) : "",
                        }))
                      );
                    } else {
                      const title =
                        card.kind === "heading"
                          ? richToPlain(card.text || "") || "Heading"
                          : (TYPES.find((t) => t.kind === card.kind) || {
                              name: "Card",
                            }).name;
                      setCardDragImage(
                        e,
                        title,
                        card.kind === "heading"
                          ? undefined
                          : card.kind === "clip"
                          ? card.clipTitle || card.url
                          : richToPlain(card.text || ""),
                        accent
                      );
                    }
                  }}
                  onDragEnd={() => {
                    setRowDragId(null);
                    setTrayOverIndex(null);
                  }}
                  title="Drag to move"
                  style={{
                    gridColumn: 1,
                    justifySelf: "start",
                    alignSelf: "start",
                    marginTop: card.kind === "heading" ? 12 : 0,
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    border: "1px solid var(--grabBorder)",
                    background: "var(--grabBg)",
                    color: "var(--grabFg)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontFamily: "system-ui, sans-serif",
                    cursor: "grab",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    zIndex: 4,
                  }}
                >
                  ⠿
                </span>
              )}
              <div
                style={{
                  gridColumn: 2,
                  minWidth: 0,
                  padding: outlineMode ? "3px 0" : "8px 0 8px 4px",
                }}
              >
                {outlineMode ? (
                  // SCR-72: every card sits in its own bounded surface so its
                  // controls — hover tools, the Controls row, the delete
                  // confirm — visibly belong to THIS card and no other. While
                  // a delete is armed the border turns red, identifying the
                  // card that's about to go.
                  <div
                    style={{
                      position: "relative",
                      background: "var(--panel)",
                      border:
                        "1px solid " +
                        (outlineConfirmId === card.id || confirmId === card.id
                          ? "#b3452f"
                          : "var(--border)"),
                      boxShadow:
                        outlineConfirmId === card.id || confirmId === card.id
                          ? "0 0 0 3px rgba(179,69,47,.14)"
                          : "0 1px 2px rgba(60,50,30,.04)",
                      borderRadius: 11,
                      padding:
                        editingId === card.id ? "8px 12px 12px" : "2px 10px 4px",
                      transition: "border-color .12s ease, box-shadow .12s ease",
                    }}
                  >
                    {editingId !== card.id ? (
                      denseRow(card, sectionColorAt(i))
                    ) : (
                      <>
                        {!SINGLE_DONE_KINDS.includes(card.kind) && (
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "flex-end",
                            margin: "2px 0 4px",
                          }}
                        >
                          <button
                            onClick={() => setEditingId(null)}
                            style={{
                              fontFamily: SANS,
                              fontSize: 11.5,
                              fontWeight: 700,
                              color: "#fff",
                              background: accent,
                              border: 0,
                              borderRadius: 999,
                              padding: "4px 14px",
                              cursor: "pointer",
                            }}
                          >
                            Done
                          </button>
                        </div>
                        )}
                        {renderCard(card, i)}
                        <Controls id={card.id} />
                      </>
                    )}
                    {editingId !== card.id &&
                      hoverRowId === card.id &&
                      rowTools(card, i)}
                  </div>
                ) : (
                  <>
                    {renderCard(card, i)}
                    <Controls id={card.id} />
                  </>
                )}
              </div>
            </div>
          </Fragment>
        );
      })}
      <div
        style={{ paddingLeft: 32 }}
        onDragOver={(e) => {
          if (dragInFlight) {
            e.preventDefault();
            // Same rule as the other drop zones: match the source's
            // effectAllowed or the browser refuses the drop (SCR-75).
            e.dataTransfer.dropEffect = extDrag ? "copy" : "move";
            setTrayOverIndex(cards.length);
          }
        }}
        onDrop={(e) => {
          if (dragInFlight) {
            e.preventDefault();
            performDrop(cards.length);
          }
        }}
      >
        {cards.length === 0 && shelf && shelf.length > 0 && (
          <div
            style={{
              fontFamily: SANS,
              fontSize: 12.5,
              color: "var(--muted)",
              fontStyle: "italic",
              textAlign: "center",
              padding: "26px 10px 6px",
              // The whole empty column is a drop zone (root catch-all) —
              // this area just makes that visible and easy to hit.
              minHeight: dragInFlight ? "38vh" : undefined,
              border: dragInFlight ? "2px dashed " + accent : undefined,
              borderRadius: dragInFlight ? 14 : undefined,
              display: dragInFlight ? "grid" : undefined,
              placeItems: dragInFlight ? "center" : undefined,
            }}
          >
            {dragInFlight
              ? "Drop anywhere to place your first card."
              : "Your table is empty — drag cards from the tray, or Place them, in any order."}
          </div>
        )}
        {dragInFlight && trayOverIndex === cards.length && (
          <div
            style={{
              height: 3,
              borderRadius: 2,
              background: accent,
              margin: "5px 2px",
            }}
          />
        )}
        <AddBar index={cards.length} big />
        {openAt === cards.length && <Chooser index={cards.length} />}
      </div>

      {/* ---- The tray (SCR-57): waiting cards, grouped by theme. Never
           auto-places — Place drops at the end of the theme's section, the
           grab handle drags to an exact spot. ---- */}
      {shelf && shelf.length > 0 && (() => {
        const sideDock = !!traySide && !!outlineMode;
        return (
        <div
          data-tray
          style={
            sideDock
              ? {
                  // Right-side dock (Kepu, Jul 22): a fixed panel while cards
                  // wait, so the tray never covers the column it places into.
                  position: "fixed",
                  right: 14,
                  top: trayTop || 90,
                  width: 274,
                  maxHeight: "calc(100vh - " + ((trayTop || 90) + 24) + "px)",
                  overflowY: "auto",
                  zIndex: 30,
                }
              : {
                  paddingLeft: 32,
                  marginTop: 16,
                  // Docked: while the column is longer than the screen, the
                  // tray rides the bottom edge until its natural spot scrolls
                  // into view.
                  position: "sticky",
                  bottom: 12,
                  zIndex: 30,
                }
          }
        >
          {!sideDock && !trayOpen ? (
            <button
              onClick={() => setTrayOpen(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontFamily: SANS,
                fontSize: 13,
                fontWeight: 600,
                color: accent,
                background: "var(--panel)",
                border: "1.5px solid " + accent,
                borderRadius: 999,
                padding: "8px 16px",
                cursor: "pointer",
                boxShadow: "0 2px 8px " + softAccent,
              }}
            >
              <span
                style={{
                  background: accent,
                  color: "#fff",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "1px 8px",
                }}
              >
                {shelf.length}
              </span>
              waiting
              <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 11 }}>
                tap to place
              </span>
            </button>
          ) : (
            <div
              style={{
                background: "var(--panel)",
                border: "1.5px solid " + accent,
                borderRadius: 13,
                overflow: "hidden",
                maxWidth: sideDock ? undefined : 560,
                boxShadow: "0 4px 14px " + softAccent,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 13px",
                  borderBottom: "1px solid var(--border)",
                  fontFamily: SANS,
                  fontSize: 12.5,
                }}
              >
                <span
                  style={{
                    background: accent,
                    color: "#fff",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "1px 8px",
                  }}
                >
                  {shelf.length}
                </span>
                <span style={{ fontWeight: 600, color: accent }}>waiting</span>
                {sideDock ? (
                  <span
                    style={{
                      marginLeft: "auto",
                      color: "var(--muted)",
                      fontSize: 10.5,
                    }}
                  >
                    drag or Place
                  </span>
                ) : (
                  <button
                    onClick={() => setTrayOpen(false)}
                    style={{
                      marginLeft: "auto",
                      border: 0,
                      background: "transparent",
                      color: "var(--muted)",
                      cursor: "pointer",
                      lineHeight: 0,
                    }}
                  >
                    <Icon d="M18 6 6 18 M6 6l12 12" size={14} />
                  </button>
                )}
              </div>
              {(() => {
                // Group by theme (shelfGroup); authored cards from a clear
                // fall under "Your cards", unlabeled verses under "Set aside".
                const groups = new Map<string, TableCard[]>();
                shelf.forEach((c) => {
                  const key =
                    c.kind !== "scripture"
                      ? "__yours"
                      : c.shelfGroup || "__aside";
                  if (!groups.has(key)) groups.set(key, []);
                  groups.get(key)!.push(c);
                });
                const label = (k: string) =>
                  k === "__yours"
                    ? "Your cards"
                    : k === "__aside"
                    ? "Set aside"
                    : k;
                return Array.from(groups.entries()).map(([k, list]) => (
                  <div key={k}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "8px 13px 2px",
                        fontFamily: SANS,
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: "var(--muted)",
                      }}
                    >
                      {list[0].shelfGroupColor != null && k !== "__yours" && (
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 3,
                            background:
                              COLOR_MAP[list[0].shelfGroupColor as MarkColor] ||
                              "var(--border)",
                          }}
                        />
                      )}
                      {label(k)}
                    </div>
                    {list.map((c) => {
                      const ref = (c.refs || [])[0] || "";
                      const preview =
                        c.kind === "scripture"
                          ? (verseTextFor ? verseTextFor(ref) : "")
                          : richToPlain(c.text || "");
                      const rowLabel =
                        c.kind === "scripture"
                          ? (c.refs || []).join(", ")
                          : c.kind === "text"
                          ? "Your words"
                          : c.kind.charAt(0).toUpperCase() + c.kind.slice(1);
                      if (trayConfirmId === c.id) {
                        return (
                          <div
                            key={c.id}
                            style={{
                              // SCR-72: the confirm keeps the row's bounded
                              // tile, turned red — no doubt which entry the
                              // remove acts on.
                              margin: "6px 8px",
                              padding: "8px 11px",
                              border: "1px solid #b3452f",
                              boxShadow: "0 0 0 3px rgba(179,69,47,.14)",
                              borderRadius: 9,
                              background: "var(--panel)",
                              fontFamily: SANS,
                              fontSize: 12,
                            }}
                          >
                            <div style={{ fontWeight: 600, marginBottom: 6 }}>
                              Remove {rowLabel} from this study?
                            </div>
                            <div
                              style={{
                                color: "var(--muted)",
                                fontSize: 11.5,
                                marginBottom: 8,
                                lineHeight: 1.5,
                              }}
                            >
                              The verse leaves this study and its table. Its
                              marks stay in the book.
                            </div>
                            <div
                              style={{
                                display: "flex",
                                gap: 8,
                                justifyContent: "flex-end",
                              }}
                            >
                              <button
                                onClick={() => setTrayConfirmId(null)}
                                style={{
                                  fontFamily: SANS,
                                  fontSize: 11.5,
                                  border: "1px solid var(--border)",
                                  background: "var(--panel)",
                                  color: "var(--text)",
                                  borderRadius: 7,
                                  padding: "5px 12px",
                                  cursor: "pointer",
                                }}
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => {
                                  setTrayConfirmId(null);
                                  onDeleteFromShelf && onDeleteFromShelf(c.id);
                                }}
                                style={{
                                  fontFamily: SANS,
                                  fontSize: 11.5,
                                  fontWeight: 700,
                                  border: 0,
                                  background: "#b3452f",
                                  color: "#fff",
                                  borderRadius: 7,
                                  padding: "5px 12px",
                                  cursor: "pointer",
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        );
                      }
                      const rowColor =
                        c.kind === "scripture" && c.shelfGroupColor != null
                          ? COLOR_MAP[c.shelfGroupColor as MarkColor]
                          : undefined;
                      return (
                        <div
                          key={c.id}
                          draggable
                          onDragStart={(e) => {
                            setTrayDragId(c.id);
                            e.dataTransfer.effectAllowed = "move";
                            try {
                              e.dataTransfer.setData("text/plain", c.id);
                            } catch {}
                            // The card follows the pointer, as everywhere.
                            if (c.kind === "scripture") {
                              setVerseDragImage(
                                e,
                                (c.refs || []).map((r) => ({
                                  reference: r,
                                  text: verseTextFor ? verseTextFor(r) : "",
                                }))
                              );
                            } else {
                              setCardDragImage(
                                e,
                                rowLabel,
                                richToPlain(c.text || ""),
                                accent
                              );
                            }
                          }}
                          onDragEnd={() => {
                            setTrayDragId(null);
                            setTrayOverIndex(null);
                          }}
                          title="Drag to an exact spot"
                          style={{
                            // SCR-72: each waiting entry is its own bounded
                            // tile, so its Place/remove controls read as its
                            // own — same rule as the column's cards.
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 8,
                            margin: "6px 8px",
                            padding: sideDock ? "8px 10px" : "6px 11px",
                            border: "1px solid var(--border)",
                            borderRadius: 9,
                            background: "var(--panel)",
                            fontFamily: SANS,
                            fontSize: 12,
                            cursor: "grab",
                          }}
                        >
                          <span
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: 6,
                              border: "1px solid var(--grabBorder)",
                              background: "var(--grabBg)",
                              color: "var(--grabFg)",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 10,
                              fontFamily: "system-ui, sans-serif",
                              flex: "0 0 auto",
                              cursor: "grab",
                              userSelect: "none",
                              WebkitUserSelect: "none",
                            }}
                          >
                            ⠿
                          </span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                minWidth: 0,
                              }}
                            >
                              {rowColor && (
                                <span
                                  style={{
                                    width: 9,
                                    height: 9,
                                    borderRadius: 3,
                                    background: rowColor,
                                    flex: "0 0 auto",
                                  }}
                                />
                              )}
                              <span
                                style={{
                                  fontWeight: 700,
                                  color: accent,
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {rowLabel}
                              </span>
                            </span>
                            <span
                              style={{
                                display: "block",
                                color: "var(--muted)",
                                fontFamily: SERIF,
                                fontSize: 11.5,
                                lineHeight: 1.45,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {preview}
                            </span>
                          </span>
                          <button
                            onClick={() =>
                              onPlaceFromShelf && onPlaceFromShelf(c.id)
                            }
                            style={{
                              fontFamily: SANS,
                              fontSize: 11,
                              fontWeight: 700,
                              color: "#fff",
                              background: accent,
                              border: 0,
                              borderRadius: 999,
                              padding: "4px 12px",
                              cursor: "pointer",
                              flex: "0 0 auto",
                            }}
                          >
                            Place
                          </button>
                          {onDeleteFromShelf && c.kind === "scripture" && (
                            <button
                              onClick={() => setTrayConfirmId(c.id)}
                              title="Remove from this study"
                              style={{
                                border: 0,
                                background: "transparent",
                                color: "var(--muted)",
                                cursor: "pointer",
                                lineHeight: 0,
                                flex: "0 0 auto",
                              }}
                            >
                              <Icon d="M18 6 6 18 M6 6l12 12" size={13} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ));
              })()}
            </div>
          )}
        </div>
        );
      })()}

      {/* Floating merge bar: shown while cards are selected for merging */}
      {mergeSel.length > 0 && !mergePrompt && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: "calc(18px + env(safe-area-inset-bottom))",
            transform: "translateX(-50%)",
            zIndex: 390,
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 999,
            padding: "8px 10px 8px 16px",
            boxShadow: "0 14px 40px -12px rgba(0,0,0,.4)",
          }}
        >
          <span
            style={{
              fontFamily: SANS,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text)",
              whiteSpace: "nowrap",
            }}
          >
            {mergeSel.length} selected
            {mergeSel.length < 2 ? " · tap more cards" : ""}
          </span>
          <button
            onClick={() => setMergeSel([])}
            style={{
              fontFamily: SANS,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--muted)",
              background: "transparent",
              border: 0,
              padding: "8px 6px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const ordered = cards
                .filter((c) => mergeSel.includes(c.id))
                .map((c) => c.id);
              setMergePrompt({ ids: ordered });
            }}
            disabled={mergeSel.length < 2}
            style={{
              fontFamily: SANS,
              fontSize: 13.5,
              fontWeight: 700,
              color: "#fff",
              background: accent,
              border: 0,
              borderRadius: 999,
              padding: "9px 18px",
              opacity: mergeSel.length < 2 ? 0.45 : 1,
              cursor: mergeSel.length < 2 ? "default" : "pointer",
            }}
          >
            Merge cards
          </button>
        </div>
      )}

      {/* Merge confirm */}
      {mergePrompt &&
        (() => {
          const chosen = cards.filter(
            (c) => mergePrompt.ids.includes(c.id) && c.kind === "scripture"
          );
          if (chosen.length < 2) return null;
          const total = new Set(chosen.flatMap((c) => c.refs || [])).size;
          return (
            <div
              onClick={() => setMergePrompt(null)}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 400,
                background: "rgba(0,0,0,.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 20,
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "100%",
                  maxWidth: 380,
                  background: "var(--panel)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 14,
                  padding: "20px 22px",
                  boxShadow: "0 24px 60px -20px rgba(0,0,0,.4)",
                }}
              >
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 16,
                    fontWeight: 700,
                    marginBottom: 6,
                  }}
                >
                  Merge {chosen.length} cards?
                </div>
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 13,
                    color: "var(--muted)",
                    lineHeight: 1.55,
                    marginBottom: 16,
                  }}
                >
                  {total === 1 ? "1 verse combines" : total + " verses combine"}{" "}
                  onto one card, in the order the cards sit in the column.
                  They'll present together.
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    justifyContent: "flex-end",
                  }}
                >
                  <button
                    onClick={() => setMergePrompt(null)}
                    style={{
                      fontFamily: SANS,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--muted)",
                      background: "transparent",
                      border: "1px solid var(--border)",
                      borderRadius: 999,
                      padding: "8px 16px",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={doMerge}
                    style={{
                      fontFamily: SANS,
                      fontSize: 13,
                      fontWeight: 650,
                      color: "#fff",
                      background: accent,
                      border: 0,
                      borderRadius: 999,
                      padding: "8px 18px",
                      cursor: "pointer",
                    }}
                  >
                    Merge
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
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
