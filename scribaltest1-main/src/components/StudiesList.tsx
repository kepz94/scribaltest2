import { COLOR_MAP, MarkColor } from "../types";

// One row in the Studies hub. App computes these (live counts + theme names)
// and hands them over ready to render.
export type StudyRow = {
  id: string;
  kind: "chapter" | "linked" | "keyword";
  bookId: string;
  name: string;
  meta: string;
  themes: { color: number; name: string }[];
  onOpen: () => void;
  onDelete: () => void;
};

interface Props {
  rows: StudyRow[];
  onClose: () => void;
}

const SECTIONS: { kind: StudyRow["kind"]; label: string; icon: string }[] = [
  { kind: "chapter", label: "Chapter studies", icon: "📖" },
  { kind: "linked", label: "Linked studies", icon: "🔗" },
  { kind: "keyword", label: "Keyword studies", icon: "📑" },
];

export default function StudiesList({ rows, onClose }: Props) {
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
          maxWidth: "580px",
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
          <span style={{ fontSize: "18px" }}>📚</span>
          <div style={{ flex: 1, fontSize: "16px", fontWeight: 700 }}>
            Studies
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

        <div style={{ padding: "10px 14px 16px" }}>
          {rows.length === 0 && (
            <div
              style={{
                color: "var(--muted)",
                textAlign: "center",
                padding: "34px 16px",
                fontSize: "14px",
                lineHeight: 1.6,
              }}
            >
              No studies yet. Compile a chapter or a linked group to record it
              here, or bundle search results into a keyword study.
            </div>
          )}

          {SECTIONS.map((sec) => {
            const items = rows.filter((r) => r.kind === sec.kind);
            if (items.length === 0) return null;
            return (
              <div key={sec.kind} style={{ marginTop: "14px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "7px",
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: "var(--muted)",
                    margin: "0 2px 8px",
                  }}
                >
                  <span>{sec.icon}</span>
                  {sec.label}
                  <span style={{ opacity: 0.7 }}>({items.length})</span>
                </div>

                {items.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "10px",
                      padding: "11px 12px",
                      borderRadius: "12px",
                      border: "1px solid var(--border)",
                      background: "var(--panel)",
                      marginBottom: "8px",
                    }}
                  >
                    <button
                      onClick={r.onOpen}
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
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {r.name}
                      </div>
                      <div
                        style={{
                          fontSize: "11.5px",
                          color: "var(--muted)",
                          marginTop: "2px",
                        }}
                      >
                        {r.meta}
                      </div>
                      {r.themes.length > 0 && (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "8px",
                            marginTop: "7px",
                          }}
                        >
                          {r.themes.map((t) => (
                            <span
                              key={t.color}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "5px",
                                fontSize: "11.5px",
                                color: "var(--muted)",
                              }}
                            >
                              <span
                                style={{
                                  width: "10px",
                                  height: "10px",
                                  borderRadius: "50%",
                                  background: COLOR_MAP[t.color as MarkColor],
                                  flexShrink: 0,
                                }}
                              />
                              {t.name || "Unnamed"}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>

                    <button
                      onClick={r.onDelete}
                      title="Remove from Studies"
                      style={{
                        flexShrink: 0,
                        width: "28px",
                        height: "28px",
                        borderRadius: "50%",
                        border: "1px solid var(--border)",
                        background: "transparent",
                        color: "var(--muted)",
                        cursor: "pointer",
                        fontSize: "16px",
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
