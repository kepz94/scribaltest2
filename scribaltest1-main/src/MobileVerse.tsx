import { useRef, useState, useEffect, Fragment } from "react";
import { Mark, WordTag, markStyleCSS } from "./types";

interface Token {
  text: string;
  start: number;
  end: number;
  isWord: boolean;
}

function tokenize(text: string): Token[] {
  const toks: Token[] = [];
  const re = /\S+|\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    toks.push({
      text: m[0],
      start: m.index,
      end: m.index + m[0].length,
      isWord: /\S/.test(m[0]),
    });
  }
  return toks;
}

interface MobileVerseProps {
  reference: string;
  verseNumber: number;
  text: string;
  marks: Mark[];
  selBg: string;
  onTap: (reference: string, verseText: string, start: number, end: number) => void;
  onRange: (reference: string, verseText: string, start: number, end: number) => void;
  onManage: (reference: string, verseText: string, start: number, end: number) => void;
  editMarkId: string | null;
  editingActive: boolean;
  onEnterEdit: (id: string, reference: string) => void;
  onAdjust: (
    id: string,
    startIndex: number,
    endIndex: number,
    markedText: string,
    commit: boolean
  ) => void;
  dark?: boolean;
  tags?: WordTag[];
  onTagTap?: (tag: WordTag) => void;
}

const LONG_PRESS_MS = 380;
const SLOP = 8; // px of movement before we decide scroll vs. mark
const DOUBLE_TAP_MS = 320;
// Marking wins only when the gesture is clearly horizontal; everything else
// (vertical or diagonal) is left to the browser to scroll natively.
const HORIZONTAL_BIAS = 1.25;

type Mode = "idle" | "pending" | "selecting" | "scrolling" | "done";

export default function MobileVerse({
  reference,
  verseNumber,
  text,
  marks,
  selBg,
  onTap,
  onRange,
  onManage,
  editMarkId,
  editingActive,
  onEnterEdit,
  onAdjust,
  dark = false,
  tags,
  onTagTap,
}: MobileVerseProps) {
  const toks = tokenize(text);
  const verseMarks = marks.filter((m) => m.reference === reference);
  const verseTags = (tags || []).filter((t) => t.reference === reference);

  const tagMark = dark ? "#cbb892" : "#9a7b4f";

  // pending selection char range while dragging
  const [sel, setSel] = useState<{ s: number; e: number } | null>(null);

  const pRef = useRef<HTMLParagraphElement | null>(null);
  const startTok = useRef<number>(-1);
  const curTok = useRef<number>(-1);
  const startX = useRef(0);
  const startY = useRef(0);
  const mode = useRef<Mode>("idle");
  const timer = useRef<number | null>(null);
  const lastTapAt = useRef(0);
  const lastTapMarkId = useRef<string | null>(null);
  const pendingTap = useRef<number | null>(null);

  // Keep the latest props/derived values reachable from the once-attached
  // listeners without re-binding them on every render.
  const latest = useRef({
    toks,
    verseMarks,
    reference,
    text,
    onTap,
    onRange,
    onManage,
    editMarkId,
    editingActive,
    onEnterEdit,
    onAdjust,
  });
  latest.current = {
    toks,
    verseMarks,
    reference,
    text,
    onTap,
    onRange,
    onManage,
    editMarkId,
    editingActive,
    onEnterEdit,
    onAdjust,
  };

  const clearTimer = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => {
    const el = pRef.current;
    if (!el) return;

    const wordAt = (x: number, y: number): number => {
      const at = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!at || !el.contains(at)) return -1; // stay within this verse
      const attr = at.getAttribute("data-wi");
      return attr === null ? -1 : Number(attr);
    };

    // Like wordAt, but when the finger isn't directly over a word — e.g. in the
    // empty space past the end of a short wrapped line like "of men." — snap to
    // the closest word in THIS verse, strongly preferring the line the finger
    // is on, then the nearest word along it. This is what lets a drag move down
    // to the next line and catch it without tracing back to that line's left
    // edge: drop onto a line anywhere and the selection follows.
    const nearestWordAt = (x: number, y: number): number => {
      const direct = wordAt(x, y);
      if (direct >= 0) return direct;
      const spans = el.querySelectorAll<HTMLElement>("[data-wi]");
      let best = -1;
      let bestScore = Infinity;
      for (let i = 0; i < spans.length; i++) {
        const r = spans[i].getBoundingClientRect();
        const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
        // Vertical distance dominates, so we lock onto the right line first and
        // only then choose the nearest word horizontally along it.
        const score = dy * 1000 + dx;
        if (score < bestScore) {
          bestScore = score;
          const attr = spans[i].getAttribute("data-wi");
          if (attr !== null) best = Number(attr);
        }
      }
      return best;
    };

    const covering = (tok: Token): Mark | undefined =>
      latest.current.verseMarks.find(
        (mk) => mk.startIndex < tok.end && mk.endIndex > tok.start
      );

    const extendTo = (x: number, y: number) => {
      const wi = nearestWordAt(x, y);
      if (wi < 0) return;
      curTok.current = wi;
      const a = latest.current.toks[startTok.current];
      const b = latest.current.toks[curTok.current];
      if (a && b) {
        setSel({ s: Math.min(a.start, b.start), e: Math.max(a.end, b.end) });
      }
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        mode.current = "done";
        clearTimer();
        setSel(null);
        return;
      }
      const t = e.touches[0];
      startX.current = t.clientX;
      startY.current = t.clientY;
      const wi = wordAt(t.clientX, t.clientY);
      startTok.current = wi;
      curTok.current = wi;
      mode.current = "pending";
      clearTimer();
      if (latest.current.editingActive) return; // edit mode is tap-only
      timer.current = window.setTimeout(() => {
        if (mode.current !== "pending") return;
        const tok = latest.current.toks[startTok.current];
        if (!tok) return;
        if (covering(tok)) {
          // long-press on an existing mark → manage it
          mode.current = "done";
          latest.current.onManage(
            latest.current.reference,
            latest.current.text,
            tok.start,
            tok.end
          );
          setSel(null);
        } else {
          // long-press on plain text → begin a deliberate selection
          mode.current = "selecting";
          setSel({ s: tok.start, e: tok.end });
          try {
            const nav = navigator as Navigator & { vibrate?: (n: number) => void };
            if (nav.vibrate) nav.vibrate(8);
          } catch {
            /* no haptics available */
          }
        }
      }, LONG_PRESS_MS);
    };

    const onMove = (e: TouchEvent) => {
      const m = mode.current;
      if (m === "done" || m === "idle" || m === "scrolling") return;
      const t = e.touches[0];
      if (!t) return;
      const dx = Math.abs(t.clientX - startX.current);
      const dy = Math.abs(t.clientY - startY.current);

      if (m === "pending") {
        if (startTok.current < 0) {
          mode.current = "scrolling";
          clearTimer();
          return;
        }
        if (
          !latest.current.editingActive &&
          dx > SLOP &&
          dx > dy * HORIZONTAL_BIAS
        ) {
          // clearly horizontal → mark a phrase
          mode.current = "selecting";
          clearTimer();
        } else if (dy > SLOP) {
          // vertical / diagonal → let the browser scroll
          mode.current = "scrolling";
          clearTimer();
          setSel(null);
          return;
        } else {
          return; // not enough movement to decide yet
        }
      }

      if (mode.current === "selecting") {
        e.preventDefault(); // we own this gesture now — no scrolling
        extendTo(t.clientX, t.clientY);
      }
    };

    const onEnd = () => {
      clearTimer();
      const m = mode.current;
      const a = latest.current.toks[startTok.current];
      const editingActive = latest.current.editingActive;
      const editMarkId = latest.current.editMarkId;

      // ---- edit mode: only the editing verse responds, only to taps ----
      if (editingActive) {
        const isTap =
          a && (m === "pending" || m === "selecting") &&
          curTok.current === startTok.current;
        if (editMarkId && isTap && a) {
          const em = latest.current.verseMarks.find((mk) => mk.id === editMarkId);
          if (em) {
            const ws = a.start;
            const we = a.end;
            let nS = em.startIndex;
            let nE = em.endIndex;
            if (we <= em.startIndex) {
              nS = ws; // extend left
            } else if (ws >= em.endIndex) {
              nE = we; // extend right
            } else {
              // tapped inside → trim the nearer edge to this word
              if (ws - em.startIndex <= em.endIndex - we) nS = ws;
              else nE = we;
            }
            if (nS < nE) {
              latest.current.onAdjust(
                em.id,
                nS,
                nE,
                latest.current.text.slice(nS, nE),
                true
              );
            }
          }
        }
        startTok.current = -1;
        curTok.current = -1;
        mode.current = "idle";
        setSel(null);
        return;
      }

      // ---- normal mode ----
      if (a) {
        if (m === "selecting") {
          if (curTok.current === startTok.current) {
            latest.current.onTap(latest.current.reference, latest.current.text, a.start, a.end);
          } else {
            const b = latest.current.toks[curTok.current] || a;
            latest.current.onRange(
              latest.current.reference,
              latest.current.text,
              Math.min(a.start, b.start),
              Math.max(a.end, b.end)
            );
          }
        } else if (m === "pending") {
          // tap — double-tap a marked word to edit it, else mark/toggle
          const cov = latest.current.verseMarks.find(
            (mk) => mk.startIndex < a.end && mk.endIndex > a.start
          );
          if (cov) {
            const now = Date.now();
            if (
              lastTapMarkId.current === cov.id &&
              now - lastTapAt.current < DOUBLE_TAP_MS
            ) {
              if (pendingTap.current !== null) {
                clearTimeout(pendingTap.current);
                pendingTap.current = null;
              }
              lastTapMarkId.current = null;
              latest.current.onEnterEdit(cov.id, latest.current.reference);
            } else {
              lastTapMarkId.current = cov.id;
              lastTapAt.current = now;
              const ws = a.start;
              const we = a.end;
              if (pendingTap.current !== null) clearTimeout(pendingTap.current);
              pendingTap.current = window.setTimeout(() => {
                pendingTap.current = null;
                lastTapMarkId.current = null;
                latest.current.onTap(
                  latest.current.reference,
                  latest.current.text,
                  ws,
                  we
                );
              }, DOUBLE_TAP_MS);
            }
          } else {
            // unmarked word → instant
            latest.current.onTap(latest.current.reference, latest.current.text, a.start, a.end);
          }
        }
      }
      startTok.current = -1;
      curTok.current = -1;
      mode.current = "idle";
      setSel(null);
    };

    const onCancel = () => {
      clearTimer();
      startTok.current = -1;
      curTok.current = -1;
      mode.current = "idle";
      setSel(null);
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
      if (pendingTap.current !== null) clearTimeout(pendingTap.current);
    };
    // Attach once; live values are read through `latest`.
  }, []);

  const coveringMark = (tok: Token): Mark | undefined =>
    verseMarks.find((mk) => mk.startIndex < tok.end && mk.endIndex > tok.start);

  const isSelected = (tok: Token) =>
    sel !== null && tok.start < sel.e && tok.end > sel.s;

  const editingMark = editMarkId
    ? verseMarks.find((mk) => mk.id === editMarkId)
    : undefined;
  const inEditRange = (tok: Token) =>
    !!editingMark &&
    tok.start < editingMark.endIndex &&
    tok.end > editingMark.startIndex;

  // Group consecutive tokens covered by the same mark so a circle/underline/
  // highlight renders as one continuous shape rather than per word + space.
  const groups: { mark: Mark | undefined; idxs: number[] }[] = [];
  toks.forEach((tok, i) => {
    const mk = coveringMark(tok);
    const last = groups[groups.length - 1];
    const lastKey = last && last.mark ? last.mark.id : null;
    const key = mk ? mk.id : null;
    if (last && lastKey === key) last.idxs.push(i);
    else groups.push({ mark: mk, idxs: [i] });
  });

  const renderTok = (i: number) => {
    const tok = toks[i];
    const highlight = isSelected(tok) || inEditRange(tok);
    const selStyle = highlight
      ? { backgroundColor: selBg, ...(tok.isWord ? { borderRadius: "2px" } : {}) }
      : {};
    // A footnote marker rides after the word it tags. It has no data-wi, so the
    // selection engine ignores taps on it; its own onClick opens the reference.
    const tag = tok.isWord
      ? verseTags.find((t) => t.start >= tok.start && t.start < tok.end)
      : undefined;
    if (tok.isWord) {
      const word = (
        <span
          data-wi={i}
          style={{
            userSelect: "none",
            WebkitUserSelect: "none",
            cursor: "pointer",
            ...selStyle,
          }}
        >
          {tok.text}
        </span>
      );
      if (!tag) return <Fragment key={i}>{word}</Fragment>;
      return (
        <Fragment key={i}>
          {word}
          <sup
            onClick={(ev) => {
              ev.stopPropagation();
              if (onTagTap) onTagTap(tag);
            }}
            style={{
              cursor: "pointer",
              color: tagMark,
              fontWeight: 700,
              fontSize: "0.72em",
              padding: "0 2px",
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
          >
            {"\u2020"}
          </sup>
        </Fragment>
      );
    }
    return (
      <span key={i} style={{ userSelect: "none", ...selStyle }}>
        {tok.text}
      </span>
    );
  };

  return (
    <p
      ref={pRef}
      data-vref={reference}
      style={{
        margin: "0 0 14px 0",
        lineHeight: "var(--verse-lh, 1.85)",
        touchAction: "pan-y",
      }}
    >
      <span
        style={{
          color: "var(--muted, #8d8a80)",
          fontSize: "0.7em",
          marginRight: "8px",
          fontFamily: "system-ui, sans-serif",
          verticalAlign: "top",
          userSelect: "none",
        }}
      >
        {verseNumber}
      </span>
      {groups.map((g, gi) =>
        g.mark ? (
          <span
            key={"g" + gi}
            data-mc={g.mark.color}
            style={markStyleCSS(g.mark.style, g.mark.color)}
          >
            {g.idxs.map(renderTok)}
          </span>
        ) : (
          <span key={"g" + gi}>{g.idxs.map(renderTok)}</span>
        )
      )}
    </p>
  );
}
