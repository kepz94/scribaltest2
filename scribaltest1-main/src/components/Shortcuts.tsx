import { useEffect, useState } from "react";
import { Tool } from "../types";

// ── Keyboard shortcuts: reference + EDITOR. The tool rows are live: click a
// key to reassign it (press the new letter; Esc cancels). Assigning a letter
// another tool already owns SWAPS the two, so every tool always keeps a key.
// Colors stay on the number row (1–9, 0) and R keeps rotating the toolbar —
// both fixed, so the editor refuses digits and R.

interface ShortcutsProps {
  onClose: () => void;
  hotkeys: Record<Tool, string>;
  onChange: (next: Record<Tool, string>) => void;
  defaults: Record<Tool, string>;
}

const TOOL_ROWS: [Tool, string][] = [
  ["pointer", "Pointer — read without marking"],
  ["define", "Define — tap a word for the dictionary"],
  ["eraser", "Eraser"],
  ["highlight", "Highlight"],
  ["underline", "Underline"],
  ["bold", "Bold"],
  ["italic", "Italic"],
  ["circle", "Circle"],
  ["box", "Box"],
  ["dashed", "Dashed underline"],
  ["squiggly", "Squiggly underline"],
];

const FIXED_ROWS: [string, string][] = [
  ["1 – 9, 0", "Pick a marking color (fixed)"],
  ["R", "Rotate the toolbar (fixed)"],
  ["Ctrl / Cmd + K", "Open search"],
  ["Ctrl / Cmd + Z", "Undo"],
  ["Ctrl / Cmd + Shift + Z", "Redo"],
];

export default function Shortcuts({
  onClose,
  hotkeys,
  onChange,
  defaults,
}: ShortcutsProps) {
  // Which tool is waiting for a new key.
  const [arming, setArming] = useState<Tool | null>(null);

  useEffect(() => {
    if (!arming) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const k = e.key.toLowerCase();
      if (k === "escape") {
        setArming(null);
        return;
      }
      // Single letters only; digits are colors, R rotates — both reserved.
      if (!/^[a-z]$/.test(k) || k === "r") return;
      const next = { ...hotkeys };
      const holder = (Object.keys(next) as Tool[]).find(
        (t) => next[t] === k && t !== arming
      );
      if (holder) next[holder] = next[arming]; // swap, never orphan
      next[arming] = k;
      onChange(next);
      setArming(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [arming, hotkeys, onChange]);

  const kbd = (label: string, live?: boolean, onClick?: () => void) => (
    <kbd
      onClick={onClick}
      style={{
        display: "inline-block",
        minWidth: "26px",
        textAlign: "center",
        padding: "3px 8px",
        borderRadius: "7px",
        border: "1px solid var(--border)",
        borderBottomWidth: "2.5px",
        background: "var(--soft)",
        color: "var(--text)",
        fontSize: "12px",
        fontWeight: 700,
        fontFamily: "inherit",
        cursor: live ? "pointer" : "default",
      }}
      title={live ? "Click, then press the new key" : undefined}
    >
      {label}
    </kbd>
  );

  return (
    <div
      className="scribal-fade"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "460px",
          maxHeight: "82vh",
          overflowY: "auto",
          background: "var(--panel)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: "16px",
          padding: "22px 24px",
          boxShadow: "0 30px 80px -20px rgba(0,0,0,0.5)",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "4px",
          }}
        >
          <div style={{ fontSize: "17px", fontWeight: 800 }}>
            Keyboard shortcuts
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              border: "none",
              background: "transparent",
              color: "var(--muted)",
              fontSize: "16px",
              cursor: "pointer",
              padding: "6px",
              fontFamily: "inherit",
            }}
          >
            ✕
          </button>
        </div>
        <div
          style={{
            fontSize: "12.5px",
            color: "var(--muted)",
            lineHeight: 1.5,
            marginBottom: "14px",
          }}
        >
          Tool keys are yours to change — click a key, then press its
          replacement. If the letter is taken, the two tools swap.
        </div>

        <div
          style={{
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "1.5px",
            textTransform: "uppercase",
            color: "var(--muted)",
            margin: "10px 0 6px",
          }}
        >
          Tools — click a key to reassign
        </div>
        {TOOL_ROWS.map(([tool, label]) => (
          <div
            key={tool}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "7px 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span style={{ flex: 1, fontSize: "13.5px" }}>{label}</span>
            {arming === tool ? (
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  color: "#8b5cf6",
                }}
              >
                Press a key… (Esc cancels)
              </span>
            ) : (
              kbd((hotkeys[tool] || "?").toUpperCase(), true, () =>
                setArming(tool)
              )
            )}
          </div>
        ))}
        <button
          onClick={() => onChange({ ...defaults })}
          style={{
            marginTop: "12px",
            border: "1px solid var(--border)",
            borderRadius: "999px",
            background: "transparent",
            color: "var(--muted)",
            fontSize: "12.5px",
            fontWeight: 700,
            padding: "8px 16px",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Reset to defaults
        </button>

        <div
          style={{
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "1.5px",
            textTransform: "uppercase",
            color: "var(--muted)",
            margin: "20px 0 6px",
          }}
        >
          Fixed
        </div>
        {FIXED_ROWS.map(([k, label]) => (
          <div
            key={k}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "7px 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span style={{ flex: 1, fontSize: "13.5px", color: "var(--muted)" }}>
              {label}
            </span>
            {kbd(k)}
          </div>
        ))}
      </div>
    </div>
  );
}
