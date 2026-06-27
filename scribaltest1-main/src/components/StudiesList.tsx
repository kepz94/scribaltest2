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
  onOpen: () => import { COLOR_MAP, MarkColor } from "../types";

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
  onAddVerses?: () => void;
  onMove?: () => void;
  onDelete: () => void;
};

interface Props {
  rows: StudyRow[];
  onClose: () => void;
  onImport?: () => void;
}

const SECTIONS: {
  kind: StudyRow["kind"];
  label: string;
  icon: string;
  color: string;
}[] = [
  { kind: "chapter", label: "Chapter studies", icon: "📖", color: "#ef4444" },
  { kind: "linked", label: "Linked studies", icon: "🔗", color: "#ef4444" },
  { kind: "keyword", label: "Keyword studies", icon: "📑", color: "#3b82f6" },
];

export default function StudiesList({ rows, onClose, onImport }: Props) {
  return (
    <div
      className="scribal-fade"
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
        className="scribal-rise"
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
          {onImport && (
            <button
              onClick={onImport}
              title="Import a note exported from ScriptureNotes"
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
              Import
            </button>
          )}
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
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                padding: "40px 16px",
                gap: "11px",
              }}
            >
              <div
                style={{
                  width: "52px",
                  height: "52px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid var(--border)",
                  color: "var(--muted)",
                  opacity: 0.8,
                }}
              >
                <svg
                  width="25"
                  height="25"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3 3 8l9 5 9-5z" />
                  <path d="M3 13l9 5 9-5" />
                </svg>
              </div>
              <div
                style={{
                  fontSize: "15px",
                  fontWeight: 600,
                  color: "var(--text)",
                }}
              >
                No studies yet
              </div>
              <div
                style={{
                  color: "var(--muted)",
                  fontSize: "13px",
                  lineHeight: 1.6,
                  maxWidth: "260px",
                }}
              >
                Compile a chapter or a linked group to record it here, or bundle
                search results into a keyword study.
              </div>
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
                    color: sec.color,
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
                      borderLeft: "3px solid " + sec.color,
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

  onAddVerses?: () => void;
  onMove?: () => void;
  onDelete: () => void;
};

interface Props {
  rows: StudyRow[];
  onClose: () => void;
  onImport?: () => void;
}

const SECTIONS: { kind: StudyRow["kind"]; label: string; icon: string }[] = [
  { kind: "chapter", label: "Chapter studies", icon: "📖" },
  { kind: "linked", label: "Linked studies", icon: "🔗" },
  { kind: "keyword", label: "Keyword studies", icon: "📑" },
];

export default function StudiesList({ rows, onClose, onImport }: Props) {
  return (
    <div
      className="scribal-fade"
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
        className="scribal-rise"
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
          {onImport && (
            <button
              onClick={onImport}
              title="Import a note exported from ScriptureNotes"
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
              Import
            </button>
          )}
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
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                padding: "40px 16px",
                gap: "11px",
              }}
            >
              <div
                style={{
                  width: "52px",
                  height: "52px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid var(--border)",
                  color: "var(--muted)",
                  opacity: 0.8,
                }}
              >
                <svg
                  width="25"
                  height="25"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3 3 8l9 5 9-5z" />
                  <path d="M3 13l9 5 9-5" />
                </svg>
              </div>
              <div
                style={{
                  fontSize: "15px",
                  fontWeight: 600,
                  color: "var(--text)",
                }}
              >
                No studies yet
              </div>
              <div
                style={{
                  color: "var(--muted)",
                  fontSize: "13px",
                  lineHeight: 1.6,
                  maxWidth: "260px",
                }}
              >
                Compile a chapter or a linked group to record it here, or bundle
                search results into a keyword study.
              </div>
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
