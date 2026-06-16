import { useState, useRef, useEffect } from "react";
import scriptures from "../data/scriptures.json";
import MarkedVerse from "./MarkedVerse";
import { Mark, MarkStyle, MarkColor, Tool, COLORS, COLOR_MAP } from "../types";

interface VerseViewerProps {
  selectedVolume: number;
  selectedBook: number;
  selectedChapter: number;
  onChange: (volume: number, book: number, chapter: number) => void;
  selectedTool: Tool;
  selectedColor: MarkColor;
  onChangeTool: (t: Tool) => void;
  onChangeColor: (c: MarkColor) => void;
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
  marks: Mark[];
  showToolbar?: boolean;
  toolbarPos: { x: number; y: number };
  onToolbarPos: (
    v:
      | { x: number; y: number }
      | ((p: { x: number; y: number }) => { x: number; y: number })
  ) => void;
  toolbarOrient: Orientation;
  onToolbarOrient: (v: Orientation | ((p: Orientation) => Orientation)) => void;
  panelMode?: boolean;
  fontScale?: number;
  lineScale?: number;
  warm?: boolean;
  dark?: boolean;
  sidebarOpen?: boolean;
  jumpTarget: string | null;
  onJumpHandled: () => void;
}

type Orientation = "vertical" | "horizontal";
const vols = scriptures.volumes;

export default function VerseViewer(props: VerseViewerProps) {
  const {
    selectedVolume,
    selectedBook,
    selectedChapter,
    onChange,
    selectedTool,
    selectedColor,
    onChangeTool,
    onChangeColor,
    onMark,
    onEraseMark,
    marks,
    showToolbar = true,
    panelMode = false,
    fontScale = 1,
    lineScale = 1.85,
    warm = false,
    dark = false,
    sidebarOpen = false,
    jumpTarget,
    onJumpHandled,
    toolbarPos: pos,
    onToolbarPos: setPos,
    toolbarOrient: orientation,
    onToolbarOrient: setOrientation,
  } = props;

  const currentVolume = vols[selectedVolume];
  const currentBook = currentVolume.books[selectedBook];
  const currentChapter = currentBook.chapters[selectedChapter];
  const erasing = selectedTool === "eraser";

  // Warm reading palette (matches the phone): paper-toned bg + ink text.
  const readBg = warm ? (dark ? "#1a1410" : "#f4ecd6") : "var(--panel)";
  const readText = warm ? (dark ? "#e9ddc2" : "#53442c") : "var(--text)";

  // Step to the previous/next chapter, crossing book and volume edges.
  const lastVol = vols.length - 1;
  const lastBook = vols[lastVol].books.length - 1;
  const lastChap = vols[lastVol].books[lastBook].chapters.length - 1;
  const atStart =
    selectedVolume === 0 && selectedBook === 0 && selectedChapter === 0;
  const atEnd =
    selectedVolume === lastVol &&
    selectedBook === lastBook &&
    selectedChapter === lastChap;
  const stepChapter = (dir: number) => {
    let v = selectedVolume;
    let b = selectedBook;
    let c = selectedChapter + dir;
    if (c < 0) {
      b -= 1;
      if (b < 0) {
        v -= 1;
        if (v < 0) return;
        b = vols[v].books.length - 1;
      }
      c = vols[v].books[b].chapters.length - 1;
    } else if (c >= vols[v].books[b].chapters.length) {
      b += 1;
      c = 0;
      if (b >= vols[v].books.length) {
        v += 1;
        if (v >= vols.length) return;
        b = 0;
      }
    }
    onChange(v, b, c);
  };
  // Pin the floating arrows to the ACTUAL text panel edges (measured), not to a
  // guessed column width. getBoundingClientRect is viewport-relative, which is
  // exactly what position:fixed needs. Re-measure on resize and layout shifts.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [panelBox, setPanelBox] = useState<{ left: number; right: number } | null>(
    null
  );
  useEffect(() => {
    const measure = () => {
      const el = bodyRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPanelBox({ left: r.left, right: r.right });
    };
    measure();
    const t = setTimeout(measure, 150); // after fonts/layout settle
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
    };
  }, [panelMode, sidebarOpen, selectedVolume, selectedBook, selectedChapter]);

  const ARROW_W = 42;
  const ARROW_GAP = 12; // equal gap on both sides, just outside the panel border
  const leftArrowPos = panelBox
    ? "max(8px, " + (panelBox.left - ARROW_GAP - ARROW_W) + "px)"
    : "";
  const rightArrowPos = panelBox
    ? "min(calc(100% - " +
      (ARROW_W + 8) +
      "px), " +
      (panelBox.right + ARROW_GAP) +
      "px)"
    : "";
  const sideArrowStyle: React.CSSProperties = {
    position: "fixed",
    top: "50%",
    transform: "translateY(-50%)",
    width: ARROW_W + "px",
    height: "42px",
    borderRadius: "50%",
    border: "1px solid var(--border)",
    backgroundColor: "var(--panel)",
    color: "var(--muted)",
    fontSize: "24px",
    lineHeight: 1,
    cursor: "pointer",
    zIndex: 30,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 4px 16px rgba(0,0,0,0.14)",
    fontFamily: "inherit",
  };

  const chapterWord =
    currentVolume.volume === "Doctrine and Covenants" ? "Section" : "Chapter";

  // Hide the book dropdown for single-book volumes (e.g. D&C)
  const showBook = currentVolume.books.length > 1;

  const [volMenuOpen, setVolMenuOpen] = useState(false);
  const [bookMenuOpen, setBookMenuOpen] = useState(false);
  const [chapMenuOpen, setChapMenuOpen] = useState(false);
  const [flashRef, setFlashRef] = useState<string | null>(null);

  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!jumpTarget) return;
    const tryScroll = () => {
      const el = document.querySelector(
        '[data-verse-ref="' + jumpTarget.replace(/"/g, '\\"') + '"]'
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setFlashRef(jumpTarget);
        setTimeout(() => setFlashRef(null), 1600);
      }
    };
    const id = setTimeout(tryScroll, 80);
    onJumpHandled();
    return () => clearTimeout(id);
  }, [jumpTarget, onJumpHandled]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      let x = e.clientX - dragOffset.current.x;
      let y = e.clientY - dragOffset.current.y;
      x = Math.max(0, Math.min(x, window.innerWidth - 80));
      y = Math.max(56, Math.min(y, window.innerHeight - 80));
      setPos({ x, y });
    };
    const onUp = () => {
      setDragging(false);
      setPos((p) => {
        let { x, y } = p;
        if (x < 40) {
          x = 12;
          setOrientation("vertical");
        } else if (y < 120) {
          y = 110;
          setOrientation("horizontal");
        }
        return { x, y };
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  const startDrag = (e: React.MouseEvent) => {
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    setDragging(true);
  };

  const handleMouseUp = () => {
    if (erasing || dragging) return;
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
    const verse = currentChapter?.verses.find((v) => v.reference === reference);
    if (!verse) return;
    const textSpan = el.querySelector("[data-verse-text]");
    if (!textSpan) return;

    const range = selection.getRangeAt(0);
    const preRange = range.cloneRange();
    preRange.selectNodeContents(textSpan);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startIndex = preRange.toString().length;
    const endIndex = Math.min(
      startIndex + selectedText.length,
      verse.text.length
    );
    if (startIndex >= endIndex) return;

    const markedText = verse.text.slice(startIndex, endIndex);
    onMark(
      reference,
      verse.text,
      markedText,
      startIndex,
      endIndex,
      selectedTool as MarkStyle,
      selectedColor
    );
    selection.removeAllRanges();
  };

  const isV = orientation === "vertical";

  const keyBadge = (k: string, active: boolean) => (
    <span
      style={{
        position: "absolute",
        bottom: "-2px",
        right: "-2px",
        fontSize: "8px",
        fontWeight: 700,
        fontFamily: "system-ui, sans-serif",
        lineHeight: 1,
        padding: "2px 3px",
        borderRadius: "4px",
        backgroundColor: active ? "var(--bg)" : "var(--soft)",
        color: active ? "var(--text)" : "var(--muted)",
        border: "1px solid var(--border)",
      }}
    >
      {k}
    </span>
  );

  const toolButton = (tool: Tool, label: React.ReactNode, keyHint: string) => {
    const active = selectedTool === tool;
    return (
      <button
        onClick={() => onChangeTool(tool)}
        title={"Shortcut: " + keyHint.toUpperCase()}
        style={{
          width: "40px",
          height: "40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "10px",
          cursor: "pointer",
          fontSize: "15px",
          position: "relative",
          border: active
            ? "1.5px solid var(--text)"
            : "1.5px solid transparent",
          backgroundColor: active ? "var(--text)" : "transparent",
          color: active ? "var(--bg)" : "var(--text)",
          transition: "all 0.15s",
          flexShrink: 0,
        }}
      >
        {label}
        {keyBadge(keyHint.toUpperCase(), active)}
      </button>
    );
  };

  const divider = (
    <div
      style={{
        backgroundColor: "var(--border)",
        flexShrink: 0,
        ...(isV
          ? { height: "1px", width: "70%", margin: "2px auto" }
          : { width: "1px", height: "26px", margin: "0 2px" }),
      }}
    />
  );

  const pillButton = (label: React.ReactNode, onClick: () => void) => (
    <button
      onClick={onClick}
      style={{
        padding: "13px 24px",
        borderRadius: "999px",
        border: "1px solid var(--border)",
        backgroundColor: "var(--panel)",
        color: "var(--text)",
        fontSize: "17px",
        fontWeight: 600,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: "10px",
      }}
    >
      {label}
      <span style={{ color: "var(--muted)", fontSize: "12px" }}>▼</span>
    </button>
  );

  const dropdownPanel = (
    children: React.ReactNode,
    close: () => void,
    width: number
  ) => (
    <>
      <div
        onClick={close}
        style={{ position: "fixed", inset: 0, zIndex: 40 }}
      />
      <div
        style={{
          position: "absolute",
          top: "54px",
          left: 0,
          width: width + "px",
          maxHeight: "340px",
          overflowY: "auto",
          backgroundColor: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "14px",
          boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
          padding: "6px",
          zIndex: 41,
        }}
      >
        {children}
      </div>
    </>
  );

  const menuItem = (label: string, active: boolean, onClick: () => void) => (
    <div
      onClick={onClick}
      style={{
        padding: "9px 12px",
        borderRadius: "8px",
        cursor: "pointer",
        fontSize: "14px",
        backgroundColor: active ? "var(--text)" : "transparent",
        color: active ? "var(--bg)" : "var(--text)",
      }}
    >
      {label}
    </div>
  );

  return (
    <div style={{ position: "relative" }}>
      {showToolbar && (
      <div
        style={{
          position: "fixed",
          left: pos.x,
          top: pos.y,
          zIndex: 50,
          display: "flex",
          flexDirection: isV ? "column" : "row",
          alignItems: "center",
          gap: "7px",
          padding: isV ? "8px 6px" : "6px 8px",
          backgroundColor: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "16px",
          boxShadow: dragging
            ? "0 12px 36px rgba(0,0,0,0.28)"
            : "0 6px 22px rgba(0,0,0,0.14)",
          userSelect: "none",
          transition: dragging ? "none" : "box-shadow 0.15s",
        }}
      >
        <div
          onMouseDown={startDrag}
          title="Drag to move · drop near the left or top edge to dock"
          style={{
            cursor: "grab",
            color: "var(--muted)",
            fontSize: "16px",
            lineHeight: 1,
            padding: "2px",
          }}
        >
          {isV ? "⋮⋮" : "⠿"}
        </div>
        {divider}
        {toolButton("bold", <b>B</b>, "b")}
        {toolButton(
          "circle",
          <span
            style={{
              border: "1.5px solid currentColor",
              borderRadius: "999px",
              padding: "0 5px",
              fontSize: "12px",
            }}
          >
            C
          </span>,
          "c"
        )}
        {toolButton("underline", <u>U</u>, "u")}
        {toolButton("italic", <i>I</i>, "i")}
        {toolButton(
          "highlight",
          <span
            style={{
              backgroundColor: "var(--hl3)",
              padding: "0 4px",
              borderRadius: "3px",
              color: "var(--text)",
            }}
          >
            H
          </span>,
          "h"
        )}
        {divider}
        <div
          style={{
            display: "flex",
            flexDirection: isV ? "column" : "row",
            gap: "7px",
            alignItems: "center",
          }}
        >
          {COLORS.map((color) => {
            const active = selectedColor === color;
            return (
              <button
                key={color}
                onClick={() => onChangeColor(color)}
                title={"Color " + color + " · shortcut: " + color}
                style={{
                  width: "26px",
                  height: "26px",
                  borderRadius: "50%",
                  backgroundColor: COLOR_MAP[color],
                  cursor: "pointer",
                  border: "none",
                  flexShrink: 0,
                  position: "relative",
                  boxShadow: active
                    ? "0 0 0 2px var(--panel), 0 0 0 4px var(--text)"
                    : "0 0 0 1px var(--border)",
                  transition: "box-shadow 0.15s",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    bottom: "-3px",
                    right: "-3px",
                    fontSize: "8px",
                    fontWeight: 700,
                    fontFamily: "system-ui, sans-serif",
                    lineHeight: 1,
                    padding: "1px 3px",
                    borderRadius: "4px",
                    backgroundColor: "var(--soft)",
                    color: "var(--muted)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {color}
                </span>
              </button>
            );
          })}
        </div>
        {divider}
        {toolButton("eraser", "⌫", "e")}
        {divider}
        <button
          onClick={() => setOrientation(isV ? "horizontal" : "vertical")}
          title="Switch orientation"
          style={{
            width: "40px",
            height: "30px",
            borderRadius: "8px",
            cursor: "pointer",
            border: "1px solid var(--border)",
            backgroundColor: "transparent",
            color: "var(--muted)",
            fontSize: "14px",
            flexShrink: 0,
          }}
        >
          {isV ? "↔" : "↕"}
        </button>
      </div>
      )}

      <div
        style={{
          padding: panelMode ? "20px 20px 60px 24px" : "20px 20px 60px 100px",
          maxWidth: "860px",
          margin: "0 auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
            gap: "10px",
            marginBottom: "16px",
            flexWrap: "wrap",
          }}
        >
          {/* Volume */}
          <div style={{ position: "relative" }}>
            {pillButton(currentVolume.volume, () => {
              setVolMenuOpen((o) => !o);
              setBookMenuOpen(false);
              setChapMenuOpen(false);
            })}
            {volMenuOpen &&
              dropdownPanel(
                vols.map((vol, idx) =>
                  menuItem(vol.volume, idx === selectedVolume, () => {
                    onChange(idx, 0, 0);
                    setVolMenuOpen(false);
                  })
                ),
                () => setVolMenuOpen(false),
                220
              )}
          </div>

          {/* Book — only for multi-book volumes */}
          {showBook && (
            <div style={{ position: "relative" }}>
              {pillButton(currentBook.book, () => {
                setBookMenuOpen((o) => !o);
                setVolMenuOpen(false);
                setChapMenuOpen(false);
              })}
              {bookMenuOpen &&
                dropdownPanel(
                  currentVolume.books.map((book, idx) =>
                    menuItem(book.book, idx === selectedBook, () => {
                      onChange(selectedVolume, idx, 0);
                      setBookMenuOpen(false);
                    })
                  ),
                  () => setBookMenuOpen(false),
                  240
                )}
            </div>
          )}

          {/* Chapter / Section */}
          <div style={{ position: "relative" }}>
            {pillButton(chapterWord + " " + currentChapter.chapter, () => {
              setChapMenuOpen((o) => !o);
              setVolMenuOpen(false);
              setBookMenuOpen(false);
            })}
            {chapMenuOpen &&
              dropdownPanel(
                currentBook.chapters.map((ch, idx) =>
                  menuItem(
                    chapterWord + " " + ch.chapter,
                    idx === selectedChapter,
                    () => {
                      onChange(selectedVolume, selectedBook, idx);
                      setChapMenuOpen(false);
                    }
                  )
                ),
                () => setChapMenuOpen(false),
                160
              )}
          </div>
        </div>

        {erasing && (
          <p
            style={{
              fontSize: "13px",
              color: "var(--muted)",
              margin: "0 0 12px 4px",
            }}
          >
            Eraser active — click any marked text to remove that mark.
          </p>
        )}

        <div
          ref={bodyRef}
          onMouseUp={handleMouseUp}
          style={{
            backgroundColor: readBg,
            color: readText,
            padding: "36px 40px",
            borderRadius: "16px",
            border: "1px solid var(--border)",
            lineHeight: lineScale,
            fontSize: (18 * fontScale).toFixed(1) + "px",
            fontFamily: '"Times New Roman", Times, serif',
            cursor: erasing ? "default" : "text",
            transition: "background-color 0.25s, color 0.25s",
          }}
        >
          {currentChapter?.verses.map((verse) => (
            <div
              key={verse.reference}
              style={{
                borderRadius: "6px",
                transition: "background-color 0.6s",
                backgroundColor:
                  flashRef === verse.reference ? "var(--soft)" : "transparent",
                margin: "0 -8px",
                padding: "0 8px",
              }}
            >
              <MarkedVerse
                reference={verse.reference}
                verseNumber={verse.verse}
                text={verse.text}
                marks={marks}
                onEraseMark={erasing ? onEraseMark : undefined}
              />
            </div>
          ))}
        </div>

        <p
          style={{
            textAlign: "center",
            color: "var(--muted)",
            fontSize: "11.5px",
            marginTop: "16px",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          Shortcuts: 1–7 colors · B C U I H styles · E eraser
        </p>
      </div>

      {/* Floating chapter arrows — pinned beside the text so you never scroll
          up to the dropdown. Single-pane reading only. */}
      {!panelMode && panelBox && !atStart && (
        <button
          onClick={() => stepChapter(-1)}
          title="Previous chapter"
          aria-label="Previous chapter"
          style={{ ...sideArrowStyle, left: leftArrowPos }}
        >
          ‹
        </button>
      )}
      {!panelMode && panelBox && !atEnd && (
        <button
          onClick={() => stepChapter(1)}
          title="Next chapter"
          aria-label="Next chapter"
          style={{ ...sideArrowStyle, left: rightArrowPos }}
        >
          ›
        </button>
      )}
    </div>
  );
}
