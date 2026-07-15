import React, { useMemo, useState } from "react";
import { Mark, MarkColor, COLORS, COLOR_MAP, STYLE_POINTS } from "../types";

// Live study panel (SCR-27): a reading-row panel that shows what's going into
// a study — its verses grouped by theme — as a quick, live reference while
// the user marks in the reader beside it. It is a LENS, not a mirror: the
// title renames the study and the theme labels write the shared scopedLabels
// store, so edits here propagate everywhere those names appear. The panel is
// dumb — the parent derives verses/marks/labels from the live stores and this
// component only groups and renders them, so mark changes re-render it free.

export interface StudyPanelVerse {
  reference: string;
  text: string;
}

interface StudyPanelProps {
  title: string;
  // Shown muted under the title when the scope has no recorded study yet —
  // the rename is a session draft until Compile records it.
  titleHint?: string;
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
  // Set when the panel's study no longer exists (deleted keyword study):
  // render only the message + close.
  missing?: string;
}

interface VerseRow {
  reference: string;
  preview: string;
}

export default function StudyPanel({
  title,
  titleHint,
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
  missing,
}: StudyPanelProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingColor, setEditingColor] = useState<MarkColor | null>(null);
  const [colorDraft, setColorDraft] = useState("");

  // Group each verse under its dominant color (summed STYLE_POINTS across its
  // marks — the Outline's assignment rule), or Unmarked when it has no marks.
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
        unmarked.push({ reference: v.reference, preview: v.text });
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
        preview: frags.length ? frags.join(" · ") : v.text,
      };
      const list = groups.get(best);
      if (list) list.push(row);
      else groups.set(best, [row]);
    });
    return {
      unmarked,
      groups: COLORS.filter((c) => groups.has(c)).map((c) => ({
        color: c,
        rows: groups.get(c) as VerseRow[],
      })),
    };
  }, [verses, marks]);

  const commitTitle = () => {
    setEditingTitle(false);
    const t = titleDraft.trim();
    if (t && t !== title) onRenameTitle(t);
  };
  const commitLabel = (c: MarkColor) => {
    setEditingColor(null);
    onEditLabel(c, colorDraft.trim());
  };

  const sectionHeader = (
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
        marginBottom: "8px",
      }}
    >
      {dot}
      <div style={{ flex: 1, minWidth: 0 }}>{body}</div>
      {action}
      <span
        style={{
          flexShrink: 0,
          fontSize: "11px",
          color: "var(--muted)",
        }}
      >
        {count} {count === 1 ? "verse" : "verses"}
      </span>
    </div>
  );

  const verseRow = (row: VerseRow) => (
    <button
      key={row.reference}
      onClick={() => onJump(row.reference)}
      title={"Go to " + row.reference}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "6px 8px",
        borderRadius: "8px",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <span
        style={{
          display: "block",
          fontSize: "12.5px",
          fontWeight: 600,
          color: "var(--text)",
          marginBottom: "2px",
        }}
      >
        {row.reference}
      </span>
      <span
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical" as any,
          overflow: "hidden",
          fontSize: "12.5px",
          lineHeight: 1.45,
          color: "var(--muted)",
        }}
      >
        {row.preview}
      </span>
    </button>
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
            marginBottom: subtitle || titleHint ? "4px" : "16px",
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
                textAlign: "left",
                fontSize: "16px",
                fontWeight: 700,
                color: "var(--text)",
                background: "transparent",
                border: "none",
                padding: "6px 0",
                cursor: "text",
                fontFamily: "system-ui, sans-serif",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {title}
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
        {(subtitle || titleHint) && (
          <div style={{ marginBottom: "16px" }}>
            {subtitle && (
              <span
                style={{
                  display: "block",
                  fontSize: "12px",
                  color: "var(--muted)",
                }}
              >
                {subtitle}
              </span>
            )}
            {titleHint && (
              <span
                style={{
                  display: "block",
                  fontSize: "11px",
                  fontStyle: "italic",
                  color: "var(--muted)",
                  marginTop: "2px",
                }}
              >
                {titleHint}
              </span>
            )}
          </div>
        )}

        {/* Unmarked group first — the verses still waiting for a theme. */}
        {grouped.unmarked.length > 0 && (
          <div style={{ marginBottom: "18px" }}>
            {sectionHeader(
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
            {grouped.unmarked.map(verseRow)}
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
                    title="Name this theme"
                    style={{
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
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label || "Name this color"}
                  </button>
                ),
                g.rows.length
              )}
              {g.rows.map(verseRow)}
            </div>
          );
        })}

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
