interface Props {
  onClose: () => void;
}

interface Group {
  heading: string;
  items: [string, string][];
}

const GROUPS: Group[] = [
  {
    heading: "Reading & marking",
    items: [
      ["Six mark tools", "Highlight, underline, bold, italic, circle, and an eraser."],
      ["Seven colors", "Mark in any of seven colors, each one a theme you name."],
      ["Name your colors", "Tap a color in the legend to give it a meaning."],
      ["Hotkeys", "1–7 for colors, H/U/B/I/C/E for tools — mark without leaving the text."],
    ],
  },
  {
    heading: "Organizing your study",
    items: [
      ["Tabs", "Keep up to five passages open side by side."],
      ["Linking", "Join tabs so they share one set of marks across passages."],
      ["Master & sessions", "A permanent book plus fresh, independent layers on the same chapter."],
    ],
  },
  {
    heading: "Seeing the patterns",
    items: [
      ["Compile", "Gather your marks four ways: Cornell Notes, Outline, Charting, Concept Map."],
      ["Search", "Find any word across scripture, or within your own marks; * is a wildcard."],
      ["Color key", "See every color, its name, and how many marks use it."],
    ],
  },
  {
    heading: "Keeping & syncing",
    items: [
      ["Vault", "Save snapshots of a compiled study, tag them, and filter by tag."],
      ["Google Drive", "Optional sign-in that auto-saves your study to your own Drive."],
      ["Backup & restore", "Export your whole study to a file and bring it back anytime."],
    ],
  },
];

export default function FeatureList({ onClose }: Props) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 4600,
        padding: "20px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "var(--panel)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: "16px",
          maxWidth: "520px",
          width: "100%",
          maxHeight: "82vh",
          overflowY: "auto",
          padding: "26px",
          boxShadow: "0 18px 50px rgba(0,0,0,0.3)",
        }}
      >
        <h2 style={{ margin: "0 0 4px", fontSize: "20px" }}>Everything Scribal does</h2>
        <p style={{ color: "var(--muted)", fontSize: "13px", margin: "0 0 20px" }}>
          A quick map of the features. Open the ? menu anytime to watch any of these in action.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {GROUPS.map((g) => (
            <div key={g.heading}>
              <div
                style={{
                  fontSize: "11px",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--muted)",
                  marginBottom: "10px",
                }}
              >
                {g.heading}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "11px" }}>
                {g.items.map(([name, desc]) => (
                  <div key={name} style={{ display: "flex", gap: "12px" }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, minWidth: "132px" }}>
                      {name}
                    </div>
                    <div style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.5, flex: 1 }}>
                      {desc}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: "right", marginTop: "22px" }}>
          <button
            onClick={onClose}
            style={{
              backgroundColor: "var(--text)",
              color: "var(--bg)",
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
