import { COLORS, MarkColor } from "../types";

interface ColorKeyProps {
  colorLabels: Record<number, string>;
  marks: { color: MarkColor }[];
  bookName: string;
  onClose: () => void;
}

export default function ColorKey({
  colorLabels,
  marks,
  bookName,
  onClose,
}: ColorKeyProps) {
  const countFor = (c: MarkColor) =>
    marks.filter((m) => m.color === c).length;

  return (
    <div
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
        <h2 style={{ margin: 0, fontSize: "19px" }}>Color key</h2>
        <p
          style={{
            color: "var(--muted)",
            fontSize: "12px",
            marginTop: "4px",
            marginBottom: "18px",
          }}
        >
          Themes and mark counts in {bookName}.
        </p>

        <div
          style={{ display: "flex", flexDirection: "column", gap: "10px" }}
        >
          {COLORS.map((c) => {
            const name = (colorLabels[c] || "").trim();
            const count = countFor(c);
            return (
              <div
                key={c}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                }}
              >
                <span
                  style={{
                    width: "22px",
                    height: "22px",
                    borderRadius: "6px",
                    backgroundColor: `var(--hl${c})`,
                    border: "1px solid var(--border)",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    fontSize: "14px",
                    color: name ? "var(--text)" : "var(--muted)",
                    fontStyle: name ? "normal" : "italic",
                  }}
                >
                  {name || "Unnamed"}
                </span>
                <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                  {count} {count === 1 ? "mark" : "marks"}
                </span>
              </div>
            );
          })}
        </div>

        <p
          style={{
            fontSize: "11px",
            color: "var(--muted)",
            marginTop: "18px",
            marginBottom: 0,
          }}
        >
          Name a color by tapping it in the legend while you read.
        </p>

        <div style={{ textAlign: "right", marginTop: "16px" }}>
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
