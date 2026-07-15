import React, { useMemo, useRef, useState } from "react";
import {
  Mark,
  MarkColor,
  MarkStyle,
  Tool,
  WordTag,
  COLORS,
  COLOR_MAP,
  STYLE_POINTS,
} from "../types";
import MarkedVerse from "./MarkedVerse";

// Topic study panel (SCR-47, retargeting the SCR-27 chassis): the container
// for a topic study — its verses grouped by theme, markable in place. It is a
// LENS, not a mirror: the title renames the study and the theme labels write
// the shared scopedLabels store (searchstudy:<id> scope), so edits here
// propagate everywhere those names appear. The panel is dumb — the parent
// derives verses/marks/labels from the live stores and this component only
// groups and renders them, so mark changes re-render (and regroup) it free.

export interface StudyPanelVerse {
  reference: string;
  text: string;
}

// In-panel marking (SCR-47): the parent passes the global tool state and
// book-targeted mark writers; the panel turns text selections over its verses
// into marks with the same range math the reader uses. Marks land in the
// study's book, themed under its searchstudy:<id> scope.
export interface StudyPanelMarking {
  tool: Tool;
  color: MarkColor;
  onMarkMany: (
    items: {
      reference: string;
      verseText: string;
      markedText: string;
      startIndex: number;
      endIndex: number;
      style: MarkStyle;
      color: MarkColor;
    }[]
  ) => void;
  onEraseMark: (markId: string) => void;
  tags?: WordTag[];
  onTagTap?: (tag: WordTag) => void;
  dark?: boolean;
}

interface StudyPanelProps {
  title: string;
  subtitle?: string;
  verses: StudyPanelVerse[];
  marks: Mark[];
  labels: Record<number, string>;
  fallbackLabels: Record<number, string>;
  onRenameTitle: (name: string) => void;
  onEditLabel: (color: MarkColor, label: string) => void;
  onCompile: () => void;
  onJump: (reference: string) => void;
  onClose: () => void;
  // Opens the Unmarked verses as a markable surface beside the panel.
  onMarkUnmarked?: () => void;
  // Drops one verse from the study (its marks stay in the book — the existing
  // onRemoveVerses semantics, one verse at a time).
  onRemoveVerse?: (reference: string) => void;
  marking?: StudyPanelMarking;
  // SCR-50: drag-and-drop. dragId names this panel in drag payloads so the
  // same grabber disambiguates by source — from outside the panel a drop ADDS
  // the verse (onDropVerse); from inside it reorders within its theme group
  // (onReorderVerse — persistence is SCR-51).
  dragId?: string;
  onDropVerse?: (reference: string) => void;
  onReorderVerse?: (reference: string, beforeRef: string | null) => void;
  // Set when the panel's study no longer exists (deleted topic study):
  // render only the message + close.
  missing?: string;
}

interface VerseRow {
  reference: string;
  // "Focused" = the dominant color's marked fragments (or the verse text when
  // nothing is marked); "full" = the whole verse, rendered markable. Which one
  // shows is the panel-level Focused / Full verse toggle.
  focused: string;
  full: string;
}

// "1 Nephi 2:5" -> 5, for MarkedVerse's verse-number gutter.
const verseNumOf = (ref: string): number => {
  const i = ref.lastIndexOf(":");
  const n = i >= 0 ? Number(ref.slice(i + 1)) : NaN;
  return Number.isFinite(n) ? n : 0;
};

const MARK_STYLES: MarkStyle[] = [
  "bold",
  "circle",
  "box",
  "underline",
  "dashed",
  "squiggly",
  "italic",
  "highlight",
];

export default function StudyPanel({
  title,
  subtitle,
  verses,
  marks,
  labels,
  fallbackLabels,
  onRenameTitle,
  onEditLabel,
  onCompile,
  onJump,
  onClose,
  onMarkUnmarked,
  onRemoveVerse,
  marking,
  dragId,
  onDropVerse,
  onReorderVerse,
  missing,
}: StudyPanelProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingColor, setEditingColor] = useState<MarkColor | null>(null);
  const [colorDraft, setColorDraft] = useState("");
  // SCR-44: sections start collapsed (headers are the overview); the arrow at
  // the end of each row expands it. Keys: "unmarked" | "c<color>".
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpanded = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  // SCR-47: full verse is the default (the panel is a marking surface);
  // Focused remains as the overview.
  const [view, setView] = useState<"focused" | "full">("full");
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Group each verse under its dominant color (summed STYLE_POINTS across its
  // marks — the Outline's assignment rule), or Unmarked when it has no marks.
  // New arrivals have no marks, so they land in Unmarked and disperse into
  // their color's group as they're marked — live, since marks are props.
  const grouped = useMemo(() => {
    const byRef = new Map<string, Mark[]>();
    marks.forEach((m) => {
      const list = byRef.get(m.reference);
      if (list) list.push(m);
      else byRef.set(m.reference, [m]);
    });
    const unmarked: VerseRow[] = [];
    const groups = new Map<MarkColor, VerseRow[]>();
    verses.forEach((v) => {
      const vm = byRef.get(v.reference) || [];
      if (!vm.length) {
        unmarked.push({ reference: v.reference, focused: v.text, full: v.text });
        return;
      }
      const pts = new Map<MarkColor, number>();
      vm.forEach((m) => {
        pts.set(m.color, (pts.get(m.color) || 0) + STYLE_POINTS[m.style]);
      });
      let best: MarkColor = vm[0].color;
      let bestPts = -1;
      COLORS.forEach((c) => {
        const p = pts.get(c) || 0;
        if (p > bestPts) {
          best = c;
          bestPts = p;
        }
      });
      // Preview = the dominant color's marked fragments, deduped in order.
      const seen = new Set<string>();
      const frags: string[] = [];
      vm.forEach((m) => {
        if (m.color !== best) return;
        const t = (m.markedText || "").trim();
        if (t && !seen.has(t)) {
          seen.add(t);
          frags.push(t);
        }
      });
      const row = {
        reference: v.reference,
        focused: frags.length ? frags.join(" · ") : v.text,
        full: v.text,
      };
      const list = groups.get(best);
      if (list) list.push(row);
      else groups.set(best, [row]);
    });
    // Which group (theme color or "unmarked") each verse sits in — reorder
    // drags are constrained WITHIN a group (SCR-51).
    const groupOf = new Map<string, string>();
    unmarked.forEach((r) => groupOf.set(r.reference, "unmarked"));
    groups.forEach((rows, c) =>
      rows.forEach((r) => groupOf.set(r.reference, "c" + c))
    );
    return {
      unmarked,
      groups: COLORS.filter((c) => groups.has(c)).map((c) => ({
        color: c,
        rows: groups.get(c) as VerseRow[],
      })),
      groupOf,
    };
  }, [verses, marks]);

  const textByRef = useMemo(() => {
    const m = new Map<string, string>();
    verses.forEach((v) => m.set(v.reference, v.text));
    return m;
  }, [verses]);

  // Selection → marks, the reader's range math scoped to this panel: walk
  // every verse block the selection touches and mark the covered character
  // range in each. Fires only when a mark style is the active tool.
  const handleMouseUp = () => {
    if (!marking) return;
    if (!MARK_STYLES.includes(marking.tool as MarkStyle)) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const body = bodyRef.current;
    if (!body || !body.contains(range.commonAncestorContainer)) return;
    const items: {
      reference: string;
      verseText: string;
      markedText: string;
      startIndex: number;
      endIndex: number;
      style: MarkStyle;
      color: MarkColor;
    }[] = [];
    const els = Array.from(body.querySelectorAll("[data-verse-ref]"));
    els.forEach((el) => {
      if (
        typeof range.intersectsNode !== "function" ||
        !range.intersectsNode(el)
      )
        return;
      const reference = el.getAttribute("data-verse-ref");
      if (!reference) return;
      const text = textByRef.get(reference);
      if (text == null) return;
      const textSpan = el.querySelector("[data-verse-text]");
      if (!textSpan) return;
      // Real-intersection guard (SCR-14): a triple-click selection ends
      // exactly AT the start of the next verse block — skip boundary touches.
      try {
        const spanRange = document.createRange();
        spanRange.selectNodeContents(textSpan);
        if (
          spanRange.compareBoundaryPoints(Range.END_TO_START, range) >= 0 ||
          spanRange.compareBoundaryPoints(Range.START_TO_END, range) <= 0
        )
          return;
      } catch {
        /* boundary comparison unavailable — keep the permissive path */
      }
      let startIndex = 0;
      let endIndex = text.length;
      if (textSpan.contains(range.startContainer)) {
        const r = document.createRange();
        r.selectNodeContents(textSpan);
        try {
          r.setEnd(range.startContainer, range.startOffset);
        } catch {
          return;
        }
        startIndex = r.toString().length;
      }
      if (textSpan.contains(range.endContainer)) {
        const r = document.createRange();
        r.selectNodeContents(textSpan);
        try {
          r.setEnd(range.endContainer, range.endOffset);
        } catch {
          return;
        }
        endIndex = r.toString().length;
      }
      startIndex = Math.max(0, Math.min(startIndex, text.length));
      endIndex = Math.max(0, Math.min(endIndex, text.length));
      if (endIndex > startIndex) {
        items.push({
          reference,
          verseText: text,
          markedText: text.slice(startIndex, endIndex),
          startIndex,
          endIndex,
          style: marking.tool as MarkStyle,
          color: marking.color,
        });
      }
    });
    if (items.length) {
      marking.onMarkMany(items);
      sel.removeAllRanges();
    }
  };

  const commitTitle = () => {
    setEditingTitle(false);
    const t = titleDraft.trim();
    if (t && t !== title) onRenameTitle(t);
  };
  const commitLabel = (c: MarkColor) => {
    setEditingColor(null);
    onEditLabel(c, colorDraft.trim());
  };

  // A small pencil beside every editable name, so renames are discoverable
  // (SCR-44 — the labels didn't read as editable).
  const pencil = (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, opacity: 0.55 }}
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );

  const sectionHeader = (
    key: string,
    dot: React.ReactNode,
    body: React.ReactNode,
    count: number,
    action?: React.ReactNode
  ) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "4px 2px 7px",
        borderBottom: "1px solid var(--border)",
        marginBottom: expanded[key] ? "8px" : "0",
      }}
    >
      {dot}
      <div style={{ flex: 1, minWidth: 0 }}>{body}</div>
      {action}
      <span
        onClick={() => toggleExpanded(key)}
        style={{
          flexShrink: 0,
          fontSize: "11px",
          color: "var(--muted)",
          cursor: "pointer",
        }}
      >
        {count} {count === 1 ? "verse" : "verses"}
      </span>
      {/* The expand arrow at the end of the row (SCR-44) — Outline's rotating
          chevron. Collapsed points right, open points down. */}
      <span
        onClick={() => toggleExpanded(key)}
        title={expanded[key] ? "Collapse" : "Show the verses"}
        style={{
          flexShrink: 0,
          cursor: "pointer",
          color: "var(--muted)",
          fontSize: "12px",
          width: "14px",
          textAlign: "center",
          transform: expanded[key] ? "none" : "rotate(-90deg)",
          transition: "transform 0.15s",
        }}
      >
        ▼
      </span>
    </div>
  );

  // Drag payload parsing shared by the drop handlers: "scribalverse|<ref>|<src>".
  const parseVersePayload = (
    e: React.DragEvent
  ): { ref: string; fromSelf: boolean } | null => {
    let raw = "";
    try {
      raw = e.dataTransfer.getData("text/plain");
    } catch {
      return null;
    }
    if (!raw.startsWith("scribalverse|")) return null;
    const parts = raw.split("|");
    if (parts.length < 3) return null;
    return { ref: parts[1], fromSelf: parts[2] === "panel:" + (dragId || "") };
  };
  // Whole-panel drop target (SCR-50): a verse dragged in from a topic-book
  // reading panel or a search panel joins the study (it shows under Unmarked
  // until it's marked here).
  const handlePanelDrop = (e: React.DragEvent) => {
    const p = parseVersePayload(e);
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    if (p.fromSelf) return; // inside drags land on a verse row (reorder)
    if (onDropVerse) onDropVerse(p.ref);
  };

  // Reference caption above each verse: grabber first (drag to another panel,
  // or reorder within this one), jump on click, and a quiet per-verse remove
  // (drops the verse from the study; marks stay in the book).
  const refCaption = (row: VerseRow) => (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: "7px",
        marginBottom: "2px",
      }}
    >
      {dragId && (
        <span
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            try {
              e.dataTransfer.setData(
                "text/plain",
                "scribalverse|" + row.reference + "|panel:" + dragId
              );
              e.dataTransfer.effectAllowed = "move";
            } catch {
              /* ignore */
            }
          }}
          title="Drag to rearrange within its theme, or into another topic study panel"
          style={{
            color: "var(--muted)",
            opacity: 0.6,
            cursor: "grab",
            userSelect: "none",
            WebkitUserSelect: "none",
            fontSize: "11px",
          }}
        >
          ⠿
        </span>
      )}
      <button
        onClick={() => onJump(row.reference)}
        title={"Go to " + row.reference}
        style={{
          border: "none",
          background: "transparent",
          padding: 0,
          fontSize: "12.5px",
          fontWeight: 600,
          color: "var(--text)",
          cursor: "pointer",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {row.reference}
      </button>
      {onRemoveVerse && (
        <button
          onClick={() => onRemoveVerse(row.reference)}
          title={"Remove " + row.reference + " from this study (marks stay)"}
          aria-label={"Remove " + row.reference + " from this study"}
          style={{
            border: "none",
            background: "transparent",
            padding: "0 2px",
            fontSize: "11px",
            lineHeight: 1,
            color: "var(--muted)",
            cursor: "pointer",
            opacity: 0.7,
          }}
        >
          ✕
        </button>
      )}
    </span>
  );

  // Row-level drop: an inside drag dropped on a verse row reorders (insert
  // before that row, within its theme group — SCR-51 persists it); an outside
  // drag anywhere still adds.
  const rowDropProps = (row: VerseRow) => ({
    onDragOver: (e: React.DragEvent) => {
      if (onReorderVerse || onDropVerse) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      const p = parseVersePayload(e);
      if (!p) return;
      e.preventDefault();
      e.stopPropagation();
      if (p.fromSelf) {
        // Reorder stays WITHIN a theme group: a drop on a row in another
        // group is ignored (grouping is meaning — marks decide it, not drag).
        if (
          p.ref !== row.reference &&
          onReorderVerse &&
          grouped.groupOf.get(p.ref) === grouped.groupOf.get(row.reference)
        )
          onReorderVerse(p.ref, row.reference);
      } else if (onDropVerse) onDropVerse(p.ref);
    },
  });

  const verseRow = (row: VerseRow) =>
    view === "full" ? (
      // Full verse: the marking surface. MarkedVerse is the reader's renderer,
      // so marks layer identically; selections become marks via handleMouseUp.
      <div key={row.reference} style={{ padding: "6px 8px" }} {...rowDropProps(row)}>
        {refCaption(row)}
        <div style={{ fontSize: "14px", lineHeight: 1.6 }}>
          <MarkedVerse
            reference={row.reference}
            verseNumber={verseNumOf(row.reference)}
            text={row.full}
            marks={marks}
            onEraseMark={
              marking && marking.tool === "eraser"
                ? marking.onEraseMark
                : undefined
            }
            dark={marking?.dark}
            tags={marking?.tags}
            onTagTap={marking?.onTagTap}
          />
        </div>
      </div>
    ) : (
      <div key={row.reference} style={{ padding: "6px 8px" }} {...rowDropProps(row)}>
        {refCaption(row)}
        <span
          onClick={() => onJump(row.reference)}
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical" as any,
            overflow: "hidden",
            fontSize: "12.5px",
            lineHeight: 1.45,
            color: "var(--muted)",
            cursor: "pointer",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {row.focused}
        </span>
      </div>
    );

  if (missing) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "14px",
          padding: "24px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <span style={{ fontSize: "13.5px", color: "var(--muted)" }}>
          {missing}
        </span>
        <button
          onClick={onClose}
          style={{
            padding: "7px 16px",
            borderRadius: "999px",
            border: "1px solid var(--border)",
            background: "var(--panel)",
            color: "var(--text)",
            fontSize: "13px",
            fontWeight: 600,
            fontFamily: "system-ui, sans-serif",
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        if (onDropVerse) e.preventDefault();
      }}
      onDrop={handlePanelDrop}
      style={{
        height: "100%",
        overflowY: "auto",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ padding: "16px 18px 40px", maxWidth: "620px", margin: "0 auto" }}>
        {/* Header: editable title left, Compile + close right */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "10px",
            marginBottom: subtitle ? "4px" : "16px",
          }}
        >
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTitle();
                if (e.key === "Escape") setEditingTitle(false);
              }}
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: "16px",
                fontWeight: 700,
                color: "var(--text)",
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                padding: "5px 9px",
                fontFamily: "system-ui, sans-serif",
              }}
            />
          ) : (
            <button
              onClick={() => {
                setTitleDraft(title);
                setEditingTitle(true);
              }}
              title="Rename this study"
              style={{
                flex: 1,
                minWidth: 0,
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                textAlign: "left",
                fontSize: "16px",
                fontWeight: 700,
                color: "var(--text)",
                background: "transparent",
                border: "none",
                padding: "6px 0",
                cursor: "text",
                fontFamily: "system-ui, sans-serif",
              }}
            >
              <span
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  borderBottom: "1px dashed var(--border)",
                  paddingBottom: "1px",
                }}
              >
                {title}
              </span>
              {pencil}
            </button>
          )}
          <button
            onClick={onCompile}
            title="Compile this study"
            style={{
              flexShrink: 0,
              padding: "7px 15px",
              borderRadius: "999px",
              border: "none",
              background: "var(--text)",
              color: "var(--bg)",
              fontSize: "12.5px",
              fontWeight: 700,
              fontFamily: "system-ui, sans-serif",
              cursor: "pointer",
            }}
          >
            Compile
          </button>
          <button
            onClick={onClose}
            title="Close this panel"
            aria-label="Close this panel"
            style={{
              flexShrink: 0,
              width: "26px",
              height: "26px",
              marginTop: "3px",
              borderRadius: "999px",
              border: "none",
              background: "transparent",
              color: "var(--muted)",
              fontSize: "15px",
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>
        {subtitle && (
          <div style={{ marginBottom: "16px" }}>
            <span
              style={{
                display: "block",
                fontSize: "12px",
                color: "var(--muted)",
              }}
            >
              {subtitle}
            </span>
          </div>
        )}

        {/* Full verse (default — the marking surface) / Focused overview. */}
        {(grouped.unmarked.length > 0 || grouped.groups.length > 0) && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginBottom: "14px",
            }}
          >
            <div
              style={{
                display: "flex",
                border: "1px solid var(--border)",
                borderRadius: "999px",
                overflow: "hidden",
              }}
            >
              {(["focused", "full"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  style={{
                    padding: "5px 13px",
                    border: "none",
                    backgroundColor:
                      view === v ? "var(--text)" : "transparent",
                    color: view === v ? "var(--bg)" : "var(--muted)",
                    fontSize: "11.5px",
                    fontWeight: view === v ? 600 : 400,
                    fontFamily: "system-ui, sans-serif",
                    cursor: "pointer",
                  }}
                >
                  {v === "focused" ? "Focused" : "Full verse"}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={bodyRef} onMouseUp={handleMouseUp}>
          {/* Unmarked group first — gathered-but-unthemed verses waiting to
              disperse into their theme groups as they're marked. */}
          {grouped.unmarked.length > 0 && (
            <div style={{ marginBottom: "18px" }}>
              {sectionHeader(
                "unmarked",
                <span
                  style={{
                    flexShrink: 0,
                    width: "9px",
                    height: "9px",
                    borderRadius: "50%",
                    border: "1.5px solid var(--muted)",
                    background: "transparent",
                  }}
                />,
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "var(--muted)",
                    letterSpacing: "0.03em",
                  }}
                >
                  Unmarked
                </span>,
                grouped.unmarked.length,
                onMarkUnmarked ? (
                  <button
                    onClick={onMarkUnmarked}
                    title="Open these verses beside the panel to mark them"
                    style={{
                      flexShrink: 0,
                      padding: "3px 10px",
                      borderRadius: "999px",
                      border: "1px solid var(--border)",
                      background: "var(--panel)",
                      color: "var(--text)",
                      fontSize: "11px",
                      fontWeight: 700,
                      fontFamily: "system-ui, sans-serif",
                      cursor: "pointer",
                    }}
                  >
                    Mark these
                  </button>
                ) : undefined
              )}
              {expanded["unmarked"] && grouped.unmarked.map(verseRow)}
            </div>
          )}

          {/* Themed groups, by color. Labels edit the shared scopedLabels
              store, so a rename here shows up in the legend, Outline, and
              Studies hub instantly. */}
          {grouped.groups.map((g) => {
            const label = labels[g.color] || fallbackLabels[g.color] || "";
            return (
              <div key={g.color} style={{ marginBottom: "18px" }}>
                {sectionHeader(
                  "c" + g.color,
                  <span
                    style={{
                      flexShrink: 0,
                      width: "9px",
                      height: "9px",
                      borderRadius: "50%",
                      background: COLOR_MAP[g.color],
                    }}
                  />,
                  editingColor === g.color ? (
                    <input
                      autoFocus
                      value={colorDraft}
                      onChange={(e) => setColorDraft(e.target.value)}
                      onBlur={() => commitLabel(g.color)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitLabel(g.color);
                        if (e.key === "Escape") setEditingColor(null);
                      }}
                      placeholder="Name this color"
                      style={{
                        width: "100%",
                        fontSize: "12.5px",
                        fontWeight: 700,
                        color: "var(--text)",
                        background: "var(--panel)",
                        border: "1px solid var(--border)",
                        borderRadius: "6px",
                        padding: "3px 7px",
                        fontFamily: "system-ui, sans-serif",
                      }}
                    />
                  ) : (
                    <button
                      onClick={() => {
                        setColorDraft(label);
                        setEditingColor(g.color);
                      }}
                      title="Rename this theme"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        maxWidth: "100%",
                        textAlign: "left",
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        cursor: "text",
                        fontSize: "12.5px",
                        fontWeight: 700,
                        fontFamily: "system-ui, sans-serif",
                        color: label ? "var(--text)" : "var(--muted)",
                        fontStyle: label ? "normal" : "italic",
                      }}
                    >
                      <span
                        style={{
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          borderBottom: "1px dashed var(--border)",
                          paddingBottom: "1px",
                        }}
                      >
                        {label || "Name this color"}
                      </span>
                      {pencil}
                    </button>
                  ),
                  g.rows.length
                )}
                {expanded["c" + g.color] && g.rows.map(verseRow)}
              </div>
            );
          })}
        </div>

        {grouped.unmarked.length === 0 && grouped.groups.length === 0 && (
          <p
            style={{
              fontSize: "13px",
              color: "var(--muted)",
              textAlign: "center",
              marginTop: "40px",
            }}
          >
            No verses here yet.
          </p>
        )}
      </div>
    </div>
  );
}
