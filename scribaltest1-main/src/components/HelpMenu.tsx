export type HelpPick =
  | "main"
  | "compile"
  | "search"
  | "vault"
  | "tabs"
  | "books";

interface Props {
  onPick: (key: HelpPick) => void;
  onFeatureList: () => void;
  onClose: () => void;
}

const WALKS: { key: HelpPick; label: string; desc: string }[] = [
  { key: "main", label: "How to use Scribal", desc: "The core: marking with intention" },
  { key: "compile", label: "Compile", desc: "Four ways to study your marks" },
  { key: "search", label: "Search", desc: "Find words and your marks" },
  { key: "vault", label: "Vault", desc: "Save and organize studies" },
  { key: "tabs", label: "Tabs", desc: "Multiple passages, linking" },
  { key: "books", label: "Master & sessions", desc: "Independent layers of marks" },
];

export default function HelpMenu({ onPick, onFeatureList, onClose }: Props) {
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
          maxWidth: "420px",
          width: "100%",
          padding: "24px",
          boxShadow: "0 18px 50px rgba(0,0,0,0.3)",
        }}
      >
        <h2 style={{ margin: "0 0 4px", fontSize: "19px" }}>Walkthroughs</h2>
        <p style={{ color: "var(--muted)", fontSize: "13px", margin: "0 0 18px" }}>
          Watch any feature in action — pick one to replay it.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {WALKS.map((w) => (
            <button
              key={w.key}
              onClick={() => onPick(w.key)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: "2px",
                textAlign: "left",
                width: "100%",
                backgroundColor: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "11px 14px",
                cursor: "pointer",
                color: "var(--text)",
              }}
            >
              <span style={{ fontSize: "14px", fontWeight: 600 }}>{w.label}</span>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>{w.desc}</span>
            </button>
          ))}
        </div>

        <button
          onClick={onFeatureList}
          style={{
            width: "100%",
            marginTop: "14px",
            backgroundColor: "var(--soft)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: "10px",
            padding: "11px 14px",
            fontSize: "14px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          📋 Full feature list
        </button>

        <div style={{ textAlign: "right", marginTop: "16px" }}>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
