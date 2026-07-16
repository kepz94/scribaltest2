import { useState, useRef, useEffect } from "react";
import StyleGlyph from "./StyleGlyph";
import { MarkColor, MarkStyle, Tool, COLORS, COLOR_MAP } from "../types";

// Tools that actually paint with the selected color. Everything else — eraser,
// pointer, define — ignores color, so picking a color while one of them is
// active signals that the reader wants to mark again.
const PEN_TOOLS: Tool[] = [
  "highlight",
  "underline",
  "bold",
  "italic",
  "circle",
  "box",
  "dashed",
  "squiggly",
];

type Orientation = "vertical" | "horizontal";

interface MarkingToolbarProps {
  // Assignable toolbar hotkeys (tool → key). Falls back to the classic layout
  // baked into each toolButton call when absent.
  toolHotkeys?: Partial<Record<Tool, string>>;
  selectedTool: Tool;
  selectedColor: MarkColor;
  onChangeTool: (t: Tool) => void;
  onChangeColor: (c: MarkColor) => void;
  pos: { x: number; y: number };
  onPos: (
    v:
      | { x: number; y: number }
      | ((p: { x: number; y: number }) => { x: number; y: number })
  ) => void;
  orient: Orientation;
  onOrient: (v: Orientation | ((p: Orientation) => Orientation)) => void;
  // 1 = the designed size; the Aa dropdown's "Toolbar size" scales the whole
  // toolbar uniformly (buttons, swatches, badges) without touching layout math.
  scale?: number;
  // The toolbar floats above every marking surface but under real dialogs.
  // The one marking surface that outranks dialogs (the mark-added-verses
  // screen, z 1200) passes a higher value while it's open.
  zIndex?: number;
}

export default function MarkingToolbar({
  toolHotkeys,
  selectedTool,
  selectedColor,
  onChangeTool,
  onChangeColor,
  pos,
  onPos: setPos,
  orient: orientation,
  onOrient: setOrientation,
  scale = 1,
  zIndex = 430,
}: MarkingToolbarProps) {
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  // Remember the most recent pen tool. When the reader picks a color while a
  // non-pen tool is active, we step back onto this one so marking just works.
  const lastPenTool = useRef<MarkStyle>("highlight");
  useEffect(() => {
    if (PEN_TOOLS.includes(selectedTool)) {
      lastPenTool.current = selectedTool as MarkStyle;
    }
  }, [selectedTool]);

  // The toolbar stays exactly where you drop it (no edge-snapping), so it can
  // sit right next to the text. These clamps only keep it fully on-screen.
  // getBoundingClientRect (not offsetWidth) so the clamp sees the SCALED size.
  const TB_GAP = 12; // min gap from the viewport edge
  const clampX = (x: number, w: number) =>
    Math.max(TB_GAP, Math.min(x, window.innerWidth - w - TB_GAP));
  const clampY = (y: number, h: number) =>
    Math.max(56, Math.min(y, window.innerHeight - h - TB_GAP));
  const measured = () => {
    const el = toolbarRef.current;
    if (!el) return { w: 56, h: 56 };
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const { w, h } = measured();
      // Follow the cursor, clamped to the screen. No edge-snapping — it stays
      // wherever you let go, so you can park it right beside the text.
      setPos({
        x: clampX(e.clientX - dragOffset.current.x, w),
        y: clampY(e.clientY - dragOffset.current.y, h),
      });
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  // Keep the toolbar on-screen when the window resizes or the scale changes.
  useEffect(() => {
    const reclamp = () => {
      const { w, h } = measured();
      setPos((p) => ({ x: clampX(p.x, w), y: clampY(p.y, h) }));
    };
    reclamp();
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, [scale]);

  const startDrag = (e: React.MouseEvent) => {
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    setDragging(true);
  };

  const isV = orientation === "vertical";

  // Picking a color is intent to mark. If a non-pen tool (eraser/pointer/
  // define) is active, step back onto the last pen tool so the next selection
  // actually marks instead of doing nothing.
  const pickColor = (color: MarkColor) => {
    onChangeColor(color);
    if (!PEN_TOOLS.includes(selectedTool)) {
      onChangeTool(lastPenTool.current);
    }
  };

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
    const hint = ((toolHotkeys && toolHotkeys[tool]) || keyHint).toUpperCase();
    return (
      <button
        onClick={() => onChangeTool(tool)}
        title={"Shortcut: " + hint}
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
            : "1.5px solid var(--border)",
          backgroundColor: active ? "var(--text)" : "transparent",
          color: active ? "var(--bg)" : "var(--text)",
          transition: "all 0.15s",
          flexShrink: 0,
        }}
      >
        {label}
        {keyBadge(hint, active)}
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

  return (
    <div
      ref={toolbarRef}
      data-tour="toolbar"
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex,
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
        transition: "box-shadow 0.15s",
        transform: scale === 1 ? undefined : "scale(" + scale + ")",
        transformOrigin: "top left",
      }}
    >
      <div
        onMouseDown={startDrag}
        title="Drag to move"
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
      <div
        style={{
          display: "grid",
          // Utilities, matching the section grids: 2 rows when horizontal, 2
          // columns when vertical. Pointer / dictionary / eraser are tools
          // (Q W E); the fourth cell flips the toolbar's orientation (R).
          gridTemplateRows: isV ? "repeat(2, auto)" : undefined,
          gridTemplateColumns: isV ? undefined : "repeat(2, auto)",
          gridAutoFlow: isV ? "column" : "row",
          gap: "7px",
          justifyItems: "center",
          alignItems: "center",
        }}
      >
        {toolButton(
          "pointer",
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" />
          </svg>,
          "q"
        )}
        {toolButton(
          "define",
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>,
          "w"
        )}
        {toolButton("eraser", "⌫", "e")}
        <button
          onClick={() => setOrientation(isV ? "horizontal" : "vertical")}
          title="Switch orientation (R)"
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
            border: "1.5px solid var(--border)",
            backgroundColor: "transparent",
            color: "var(--text)",
            transition: "all 0.15s",
            flexShrink: 0,
          }}
        >
          {isV ? "↔" : "↕"}
          {keyBadge("R", false)}
        </button>
      </div>
      {divider}
      <div
        style={{
          display: "grid",
          // Mirror the color grid's orientation logic: a vertical toolbar
          // gets 2 columns of 4 styles (tall, narrow); a horizontal one gets
          // 2 rows of 4. Each button previews its own style and carries its
          // shortcut badge, so the two new families (Box, and Dashed/Squiggly)
          // read at a glance.
          gridTemplateRows: isV ? "repeat(4, auto)" : undefined,
          gridTemplateColumns: isV ? undefined : "repeat(4, auto)",
          gridAutoFlow: isV ? "column" : "row",
          gap: "7px",
          justifyItems: "center",
          alignItems: "center",
        }}
      >
        {toolButton("highlight", <StyleGlyph style="highlight" />, "a")}
        {toolButton("underline", <StyleGlyph style="underline" />, "s")}
        {toolButton("bold", <StyleGlyph style="bold" />, "d")}
        {toolButton("italic", <StyleGlyph style="italic" />, "f")}
        {toolButton("circle", <StyleGlyph style="circle" />, "z")}
        {toolButton("box", <StyleGlyph style="box" />, "x")}
        {toolButton("dashed", <StyleGlyph style="dashed" />, "c")}
        {toolButton("squiggly", <StyleGlyph style="squiggly" />, "v")}
      </div>
      {divider}
      <div
        style={{
          display: "grid",
          // Lay the 10 colors along the toolbar's long axis: a vertical
          // toolbar gets 2 columns of 5 (tall, narrow); a horizontal one gets
          // 2 rows of 5 (short, wide) so it isn't needlessly bulky.
          gridTemplateRows: isV ? "repeat(5, auto)" : undefined,
          gridTemplateColumns: isV ? undefined : "repeat(5, auto)",
          gridAutoFlow: isV ? "column" : "row",
          gap: "7px",
          justifyItems: "center",
          alignItems: "center",
        }}
      >
        {COLORS.map((color) => {
          const active = selectedColor === color;
          return (
            <button
              key={color}
              onClick={() => pickColor(color)}
              title={
                "Color " +
                color +
                " · shortcut: " +
                (color === 10 ? "0" : color)
              }
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
                {color === 10 ? "0" : color}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
