interface ShortcutsProps {
  onClose: () => void;
}

interface Group {
  heading: string;
  rows: [string, string][];
}

const GROUPS: Group[] = [
  {
    heading: "Getting around",
    rows: [
      ["Ctrl / Cmd + K", "Open search"],
      ["Ctrl / Cmd + Z", "Undo"],
      ["Ctrl / Cmd + Shift + Z", "Redo"],
    ],
  },
  {
    heading: "Colors",
    rows: [["1 - 7", "Pick a highlight color"]],
  },
  {
    heading: "Tools",
    rows: [
      ["H", "Highlight"],
      ["U", "Underline"],
      ["B", "Bold"],
      ["I", "Italic"],
      ["C", "Circle"],
      ["E", "Eraser"],
    ],
  },
];

export default function Shortcuts({ onClose }: ShortcutsProps) {
  return (
    <div
      className="scribal-fade"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 4000,
        padding: "20px",
      }}
    >
      <div
        className="scribal-rise"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "var(--panel)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: "14px",
          maxWidth: "400px",
          width: "100%",
          padding: "24px",
          boxShadow: "0 14px 44px rgba(0,0,0,0.28)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "19px" }}>Keyboard shortcuts</h2>
        <p
          style={{
            color: "var(--muted)",
            fontSize: "12px",
            marginTop: "4px",
            marginBottom: "18px",
          }}
        >
          Tool and color keys work while you're reading (not while typing).
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {GROUPS.map((grp) => (
            <div key={grp.heading}>
              <div
                style={{
                  fontSize: "11px",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--muted)",
                  marginBottom: "8px",
                }}
              >
                {grp.heading}
              </div>
              <div
                style={{ display: "flex", flexDirection: "column", gap: "6px" }}
              >
                {grp.rows.map(([keys, desc]) => (
                  <div
                    key={keys}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                    }}
                  >
                    <span style={{ fontSize: "14px" }}>{desc}</span>
                    <kbd
                      style={{
                        fontSize: "12px",
                        fontFamily: "system-ui, sans-serif",
                        backgroundColor: "var(--soft)",
                        border: "1px solid var(--border)",
                        borderRadius: "6px",
                        padding: "3px 8px",
                        color: "var(--text)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: "right", marginTop: "20px" }}>
          <button
            onClick={onClose}
            style={{
              backgroundColor: "#8b5cf6",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              padding: "9px 20px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
