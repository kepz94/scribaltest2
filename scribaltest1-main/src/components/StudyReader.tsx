import { useState, useRef } from "react";
import scriptures from "../data/scriptures.json";
import {
  Mark,
  MarkColor,
  MarkStyle,
  COLORS,
  COLOR_MAP,
  markStyleCSS,
} from "../types";
import MarkedVerse from "./MarkedVerse";
import { SearchStudy } from "../hooks/useSearchStudies";

const vols = scriptures.volumes;

// Built once: every verse reference -> its number, text, and chapter title.
const verseIndex = new Map<
  string,
  { verse: number; text: string; chapterRef: string }
>();
vols.forEach((v) =>
  v.books.forEach((b) =>
    b.chapters.forEach((c) => {
      const chapterRef = b.book + " " + c.chapter;
      c.verses.forEach((ve) =>
        verseIndex.set(ve.reference, {
          verse: ve.verse,
          text: ve.text,
          chapterRef,
        })
      );
    })
  )
);

const STYLES: { id: MarkStyle; label: string }[] = [
  { id: "highlight", label: "Highlight" },
  { id: "underline", label: "Underline" },
  { id: "bold", label: "Bold" },
  { id: "italic", label: "Italic" },
  { id: "circle", label: "Circle" },
];

interface Props {
  study: SearchStudy;
  marks: Mark[];
  onMark: (
    reference: string,
    verseText: string,
    markedText: string,
    startIndex: number,
    endIndex: number,
    style: MarkStyle,
    color: MarkColor
  ) => void;
  onEraseMark: (markId: string) => void;
  colorLabels: Record<number, string>;
  setColorLabel: (color: MarkColor, label: string) => void;
  onRename: (name: string) => void;
  onClose: () => void;
  dark?: boolean;
  fontScale?: number;
}

export default function StudyReader({
  study,
  marks,
  onMark,
  onEraseMark,
  colorLabels,
  setColorLabel,
  onRename,
  onClose,
  dark,
  fontScale = 1,
}: Props) {
  const [activeStyle, setActiveStyle] = useState<MarkStyle>("highlight");
  const [activeColor, setActiveColor] = useState<MarkColor>(1);
  const [erasing, setErasing] = useState(false);
  const [name, setName] = useState(study.name);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Turn a text selection inside the verse list into a mark (mirrors the reader).
  const handleMouseUp = () => {
    if (erasing) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const selectedText = selection.toString();
    if (!selectedText.trim()) return;

    let node: Node | null = selection.anchorNode;
    while (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode;
    let el = node as HTMLElement | null;
    while (el && !el.getAttribute("data-verse-ref")) el = el.parentElement;
    if (!el) return;
    const reference = el.getAttribute("data-verse-ref");
    if (!reference) return;
    const info = verseIndex.get(reference);
    if (!info) return;
    const textSpan = el.querySelector("[data-verse-text]");
    if (!textSpan) return;

    const range = selection.getRangeAt(0);
    const preRange = range.cloneRange();
    preRange.selectNodeContents(textSpan);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startIndex = preRange.toString().length;
    const endIndex = Math.min(startIndex + selectedText.length, info.text.length);
    if (startIndex >= endIndex) return;

    const markedText = info.text.slice(startIndex, endIndex);
    onMark(
      reference,
      info.text,
      markedText,
      startIndex,
      endIndex,
      activeStyle,
      activeColor
    );
    selection.removeAllRanges();
  };

  // Refs that actually exist in scripture, grouped by chapter for headings.
  const present = study.refs.filter((r) => verseIndex.has(r));
  const groupsByChapter: { chapterRef: string; refs: string[] }[] = [];
  present.forEach((r) => {
    const ch = verseIndex.get(r)!.chapterRef;
    const last = groupsByChapter[groupsByChapter.length - 1];
    if (last && last.chapterRef === ch) last.refs.push(r);
    else groupsByChapter.push({ chapterRef: ch, refs: [r] });
  });

  const usedColors = COLORS.filter((c) =>
    marks.some((m) => present.includes(m.reference) && m.color === c)
  );

  const styleBtn = (id: MarkStyle, label: string) => {
    const on = !erasing && activeStyle === id;
    return (
      <button
        key={id}
        onClick={() => {
          setErasing(false);
          setActiveStyle(id);
        }}
        title={label}
        style={{
          padding: "6px 11px",
          borderRadius: "8px",
          border: on ? "1px solid var(--text)" : "1px solid var(--border)",
          background: on ? "var(--soft)" : "transparent",
          color: "var(--text)",
          cursor: "pointer",
          fontSize: "12.5px",
          fontFamily: "inherit",
        }}
      >
        <span style={markStyleCSS(id, activeColor)}>{label}</span>
      </button>
    );
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 350,
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "14px 20px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: "18px" }}>📑</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => onRename(name)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="Untitled study"
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: "17px",
            fontWeight: 700,
            border: "none",
            background: "transparent",
            color: "var(--text)",
            fontFamily: "inherit",
            outline: "none",
          }}
        />
        <span style={{ fontSize: "12.5px", color: "var(--muted)" }}>
          {present.length} {present.length === 1 ? "verse" : "verses"}
        </span>
        <button
          onClick={onClose}
          style={{
            padding: "8px 16px",
            borderRadius: "999px",
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text)",
            cursor: "pointer",
            fontSize: "13px",
            fontFamily: "inherit",
          }}
        >
          Done
        </button>
      </div>

      {/* Marking toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "14px",
          flexWrap: "wrap",
          padding: "10px 20px",
          borderBottom: "1px solid var(--border)",
          background: "var(--panel)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {STYLES.map((s) => styleBtn(s.id, s.label))}
        </div>
        <div style={{ display: "flex", gap: "7px", alignItems: "center" }}>
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                setErasing(false);
                setActiveColor(c);
              }}
              title={colorLabels[c] || "Color " + c}
              style={{
                width: "22px",
                height: "22px",
                borderRadius: "50%",
                backgroundColor: COLOR_MAP[c],
                border:
                  !erasing && activeColor === c
                    ? "3px solid var(--text)"
                    : "2px solid var(--border)",
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
        </div>
        <input
          value={colorLabels[activeColor] || ""}
          onChange={(e) => setColorLabel(activeColor, e.target.value)}
          placeholder={"Name color " + activeColor + "…"}
          style={{
            flex: 1,
            minWidth: "120px",
            maxWidth: "260px",
            padding: "7px 11px",
            borderRadius: "8px",
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            fontSize: "13px",
            fontFamily: "inherit",
            outline: "none",
          }}
        />
        <button
          onClick={() => setErasing((v) => !v)}
          title="Erase: click a mark to remove it"
          style={{
            padding: "6px 12px",
            borderRadius: "8px",
            border: erasing ? "1px solid var(--text)" : "1px solid var(--border)",
            background: erasing ? "var(--soft)" : "transparent",
            color: "var(--text)",
            cursor: "pointer",
            fontSize: "12.5px",
            fontFamily: "inherit",
          }}
        >
          ⌫ Erase
        </button>
      </div>

      {/* Verse list */}
      <div
        ref={bodyRef}
        onMouseUp={handleMouseUp}
        style={{ flex: 1, overflowY: "auto", padding: "22px 20px 80px" }}
      >
        <div style={{ maxWidth: "720px", margin: "0 auto" }}>
          {present.length === 0 && (
            <p style={{ color: "var(--muted)", textAlign: "center" }}>
              This study has no verses yet.
            </p>
          )}
          {usedColors.length > 0 && (
            <div
              style={{
                display: "flex",
                gap: "12px",
                flexWrap: "wrap",
                marginBottom: "18px",
                fontSize: "12px",
                color: "var(--muted)",
              }}
            >
              {usedColors.map((c) => (
                <span
                  key={c}
                  style={{ display: "flex", alignItems: "center", gap: "5px" }}
                >
                  <span
                    style={{
                      width: "9px",
                      height: "9px",
                      borderRadius: "50%",
                      backgroundColor: COLOR_MAP[c],
                    }}
                  />
                  {colorLabels[c] || "Color " + c}
                </span>
              ))}
            </div>
          )}
          {groupsByChapter.map((g) => (
            <div key={g.chapterRef} style={{ marginBottom: "8px" }}>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "var(--muted)",
                  fontFamily: "system-ui, sans-serif",
                  margin: "14px 0 10px",
                }}
              >
                {g.chapterRef}
              </div>
              <div
                style={{
                  fontFamily: '"Times New Roman", Times, serif',
                  fontSize: 18 * fontScale + "px",
                  lineHeight: 1.7,
                  color: "var(--text)",
                }}
              >
                {g.refs.map((r) => {
                  const info = verseIndex.get(r)!;
                  return (
                    <MarkedVerse
                      key={r}
                      reference={r}
                      verseNumber={info.verse}
                      text={info.text}
                      marks={marks}
                      onEraseMark={erasing ? onEraseMark : undefined}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
