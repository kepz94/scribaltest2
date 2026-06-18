import { SearchStudy } from "../hooks/useSearchStudies";

interface Props {
  studies: SearchStudy[];
  onOpen: (study: SearchStudy) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export default function SearchStudiesList({
  studies,
  onOpen,
  onDelete,
  onClose,
}: Props) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 360,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "60px 20px",
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "560px",
          background: "var(--bg)",
          color: "var(--text)",
          borderRadius: "16px",
          border: "1px solid var(--border)",
          overflow: "hidden",
          boxShadow: "0 24px 70px rgba(0,0,0,0.4)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "16px 18px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span style={{ fontSize: "18px" }}>📑</span>
          <div style={{ flex: 1, fontSize: "16px", fontWeight: 700 }}>
            Keyword studies
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text)",
              borderRadius: "999px",
              padding: "8px 14px",
              fontSize: "13px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Close
          </button>
        </div>

        <div style={{ padding: "10px 12px" }}>
          {studies.length === 0 && (
            <div
              style={{
                color: "var(--muted)",
                textAlign: "center",
                padding: "34px 16px",
                fontSize: "14px",
                lineHeight: 1.6,
              }}
            >
              No keyword studies yet. In Search, tick the verses you want and
              choose “Link into a study” to bundle them together.
            </div>
          )}
          {studies.map((s) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "12px 12px",
                borderRadius: "12px",
                border: "1px solid var(--border)",
                background: "var(--panel)",
                marginBottom: "8px",
              }}
            >
              <button
                onClick={() => onOpen(s)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: "left",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text)",
                  fontFamily: "inherit",
                  padding: 0,
                }}
              >
                <div
                  style={{
                    fontSize: "15px",
                    fontWeight: 700,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.name}
                </div>
                <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
                  {s.refs.length} {s.refs.length === 1 ? "verse" : "verses"} ·{" "}
                  {new Date(s.createdAt).toLocaleDateString()}
                </div>
              </button>
              <button
                onClick={() => onOpen(s)}
                style={{
                  padding: "7px 14px",
                  borderRadius: "999px",
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text)",
                  cursor: "pointer",
                  fontSize: "12.5px",
                  fontFamily: "inherit",
                  flexShrink: 0,
                }}
              >
                Open
              </button>
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      "Remove this study from the list? Your marks stay in the book."
                    )
                  )
                    onDelete(s.id);
                }}
                title="Remove study"
                style={{
                  padding: "7px 10px",
                  borderRadius: "999px",
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--muted)",
                  cursor: "pointer",
                  fontSize: "12.5px",
                  fontFamily: "inherit",
                  flexShrink: 0,
                }}
              >
                ⌫
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
