import { useState } from "react";
import { COLOR_MAP, MarkColor } from "../types";
import { StudyRow } from "./StudiesList";

// One book in the Vault, with the studies recorded inside it.
export type VaultBook = {
  id: string;
  name: string;
  isMaster: boolean;
  active: boolean;
  // Built-in canvases (Master Book, Master Topic Book): no rename/delete.
  builtin?: boolean;
  // Two-canvas book type (SCR-54): shown on the book row. Undefined =
  // pre-migration book (no tag).
  type?: "chapter" | "topic";
  rows: StudyRow[];
};

interface Props {
  books: VaultBook[];
  onSetActive: (id: string) => void;
  onNewSession: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

// Two-canvas model (SCR-54): the Vault groups studies two ways — Chapter
// studies and Topic studies. Combined no longer exists as a category; any
// legacy combined rows (pre-migration data) list under Topic studies.
const SECTIONS: {
  kinds: StudyRow["kind"][];
  label: string;
  color: string;
}[] = [
  { kinds: ["chapter", "linked"], label: "Chapter studies", color: "#ef4444" },
  { kinds: ["keyword", "combined"], label: "Topic studies", color: "#3b82f6" },
];

export default function BooksVault({
  books,
  onSetActive,
  onNewSession,
  onRename,
  onDelete,
  onClose,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(
    books.find((b) => b.active)?.id || books[0]?.id || null
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const pill = (label: string, onClick: () => void, accent?: boolean) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        background: "transparent",
        border: "1px solid " + (accent ? "#8b5cf6" : "var(--border)"),
        color: accent ? "#8b5cf6" : "var(--muted)",
        borderRadius: "999px",
        padding: "4px 10px",
        fontSize: "11.5px",
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );

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
          maxWidth: "600px",
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
          <span style={{ fontSize: "18px" }}>❖</span>
          <div style={{ flex: 1, fontSize: "16px", fontWeight: 700 }}>
            Study books
          </div>
          <button
            onClick={onNewSession}
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
            + New study book
          </button>
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

        <div style={{ padding: "10px 12px 16px" }}>
          {books.map((b) => {
            const expanded = openId === b.id;
            const editing = editingId === b.id;
            const total = b.rows.length;
            return (
              <div
                key={b.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "12px",
                  background: "var(--panel)",
                  marginBottom: "8px",
                  overflow: "hidden",
                }}
              >
                <div
                  onClick={() => setOpenId(expanded ? null : b.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "11px 12px",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      color: "var(--muted)",
                      width: "12px",
                    }}
                  >
                    {expanded ? "▾" : "▸"}
                  </span>
                  {editing ? (
                    <input
                      autoFocus
                      value={draft}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          onRename(b.id, draft.trim() || b.name);
                          setEditingId(null);
                        } else if (e.key === "Escape") setEditingId(null);
                      }}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: "15px",
                        fontWeight: 700,
                        padding: "4px 8px",
                        borderRadius: "8px",
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        color: "var(--text)",
                        fontFamily: "inherit",
                      }}
                    />
                  ) : (
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: "15px",
                          fontWeight: 700,
                          marginRight: "8px",
                        }}
                      >
                        {b.name}
                      </span>
                      {b.type && (
                        <span
                          style={{
                            fontSize: "9px",
                            letterSpacing: "1px",
                            color: b.type === "chapter" ? "#ef4444" : "#3b82f6",
                            border:
                              "1px solid " +
                              (b.type === "chapter" ? "#ef4444" : "#3b82f6"),
                            borderRadius: "999px",
                            padding: "1px 6px",
                            marginRight: "6px",
                          }}
                        >
                          {b.type === "chapter" ? "CHAPTER" : "TOPIC"}
                        </span>
                      )}
                      {b.active && (
                        <span
                          style={{
                            fontSize: "9px",
                            letterSpacing: "1px",
                            color: "#8b5cf6",
                            border: "1px solid #8b5cf6",
                            borderRadius: "999px",
                            padding: "1px 6px",
                          }}
                        >
                          ACTIVE
                        </span>
                      )}
                      <div
                        style={{
                          fontSize: "11.5px",
                          color: "var(--muted)",
                          marginTop: "2px",
                        }}
                      >
                        {total === 0
                          ? "No studies yet"
                          : total + (total === 1 ? " study" : " studies")}
                      </div>
                    </div>
                  )}

                  {editing ? (
                    <>
                      {pill("Save", () => {
                        onRename(b.id, draft.trim() || b.name);
                        setEditingId(null);
                      })}
                      {pill("Cancel", () => setEditingId(null))}
                    </>
                  ) : (
                    <div style={{ display: "flex", gap: "6px" }}>
                      {!b.active && pill("Switch to", () => onSetActive(b.id), true)}
                      {!(b.builtin ?? b.isMaster) &&
                        pill("Rename", () => {
                          setDraft(b.name);
                          setEditingId(b.id);
                        })}
                      {!(b.builtin ?? b.isMaster) &&
                        pill("Delete", () => {
                          if (
                            window.confirm(
                              'Delete "' +
                                b.name +
                                '"? Its marks and studies will be removed. This cannot be undone.'
                            )
                          )
                            onDelete(b.id);
                        })}
                    </div>
                  )}
                </div>

                {expanded && (
                  <div
                    style={{
                      padding: "0 12px 10px",
                      borderTop: "1px solid var(--border)",
                    }}
                  >
                    {total === 0 && (
                      <div
                        style={{
                          color: "var(--muted)",
                          fontSize: "13px",
                          padding: "14px 4px",
                        }}
                      >
                        Compile a chapter or linked group while this book is
                        active, or gather a topic study, to fill it in.
                      </div>
                    )}
                    {SECTIONS.map((sec) => {
                      const items = b.rows.filter((r) =>
                        sec.kinds.includes(r.kind)
                      );
                      if (items.length === 0) return null;
                      return (
                        <div key={sec.label} style={{ marginTop: "12px" }}>
                          <div
                            style={{
                              fontSize: "10.5px",
                              fontWeight: 700,
                              letterSpacing: "0.05em",
                              textTransform: "uppercase",
                              color: sec.color,
                              margin: "0 2px 6px",
                            }}
                          >
                            {sec.label}
                          </div>
                          {items.map((r) => (
                            <div
                              key={r.id}
                              style={{
                                display: "flex",
                                alignItems: "flex-start",
                                gap: "10px",
                                padding: "9px 4px 9px 9px",
                                borderTop: "1px solid var(--border)",
                                borderLeft: "3px solid " + sec.color,
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
                                    fontSize: "14px",
                                    fontWeight: 600,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {r.name}
                                </div>
                                <div
                                  style={{
                                    fontSize: "11px",
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
                                      marginTop: "6px",
                                    }}
                                  >
                                    {r.themes.map((t) => (
                                      <span
                                        key={t.color}
                                        style={{
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: "5px",
                                          fontSize: "11px",
                                          color: "var(--muted)",
                                        }}
                                      >
                                        <span
                                          style={{
                                            width: "9px",
                                            height: "9px",
                                            borderRadius: "50%",
                                            background:
                                              COLOR_MAP[t.color as MarkColor],
                                            flexShrink: 0,
                                          }}
                                        />
                                        {t.name || "Unnamed"}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </button>
                              {r.onMove && (
                                <button
                                  onClick={r.onMove}
                                  title="Move to another book"
                                  style={{
                                    flexShrink: 0,
                                    height: "26px",
                                    padding: "0 10px",
                                    borderRadius: "999px",
                                    border: "1px solid var(--border)",
                                    background: "transparent",
                                    color: "var(--text)",
                                    cursor: "pointer",
                                    fontSize: "12px",
                                    fontWeight: 600,
                                    fontFamily: "inherit",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  Move
                                </button>
                              )}
                              <button
                                onClick={r.onDelete}
                                title="Remove from Studies"
                                style={{
                                  flexShrink: 0,
                                  width: "26px",
                                  height: "26px",
                                  borderRadius: "50%",
                                  border: "1px solid var(--border)",
                                  background: "transparent",
                                  color: "var(--muted)",
                                  cursor: "pointer",
                                  fontSize: "15px",
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
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
