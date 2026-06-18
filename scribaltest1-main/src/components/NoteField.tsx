import { useState } from "react";

interface NoteFieldProps {
  value: string;
  onChange: (text: string) => void;
  // Color of the "+" sign (usually the theme's color).
  accent: string;
  // A short, neutral hint shown only once you're typing — never a question.
  placeholder?: string;
  // Accessible label for the "+" button.
  addLabel?: string;
}

// A note that shows nothing but a "+" until you tap it — no prompt sitting in
// an empty box. Tapping opens a textarea; once it has text it shows the text
// with an Edit button. Mirrors the mobile compile experience.
export default function NoteField({
  value,
  onChange,
  accent,
  placeholder,
  addLabel,
}: NoteFieldProps) {
  const [editing, setEditing] = useState(false);
  const has = (value || "").trim().length > 0;

  if (editing) {
    return (
      <div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
          placeholder={placeholder}
          rows={2}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 12px",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "13.5px",
            fontFamily: "system-ui, sans-serif",
            lineHeight: 1.55,
            resize: "vertical",
            backgroundColor: "var(--soft)",
            color: "var(--text)",
            outline: "none",
            minHeight: "60px",
          }}
        />
        <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
          <button
            onClick={() => setEditing(false)}
            style={{
              background: "var(--text)",
              color: "var(--bg)",
              border: "none",
              borderRadius: "8px",
              padding: "7px 16px",
              fontSize: "12.5px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            Done
          </button>
          {has && (
            <button
              onClick={() => {
                onChange("");
                setEditing(false);
              }}
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                padding: "7px 14px",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "system-ui, sans-serif",
                color: "var(--muted)",
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    );
  }

  if (has) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "10px",
          borderLeft: "3px solid " + accent,
          background: "var(--soft)",
          borderRadius: "0 8px 8px 0",
          padding: "10px 12px",
        }}
      >
        <div
          style={{
            flex: 1,
            fontSize: "13.5px",
            lineHeight: 1.6,
            color: "var(--text)",
            whiteSpace: "pre-wrap",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {value}
        </div>
        <button
          onClick={() => setEditing(true)}
          aria-label="Edit note"
          style={{
            flexShrink: 0,
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "5px 12px",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "system-ui, sans-serif",
            color: "var(--muted)",
          }}
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      aria-label={addLabel || "Add a note"}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "1px dashed var(--border)",
        borderRadius: "8px",
        padding: "10px",
        cursor: "pointer",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <span
        style={{
          fontSize: "20px",
          fontWeight: 700,
          color: accent,
          lineHeight: 1,
        }}
      >
        +
      </span>
    </button>
  );
}
