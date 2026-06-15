import { useState } from "react";
import { Mark, MarkColor, COLORS, COLOR_MAP, markStyleCSS } from "./types";
import { VaultEntry } from "./hooks/useVault";

interface Palette {
  bg: string;
  panel: string;
  soft: string;
  text: string;
  muted: string;
  border: string;
}

interface Props {
  entries: VaultEntry[];
  C: Palette;
  onUpdate: (id: string, partial: Partial<VaultEntry>) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRestore: (entry: VaultEntry) => void;
  onClose: () => void;
}

const synthKey = (color: number) => "synthesis:" + color;

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export default function MobileVault({
  entries,
  C,
  onUpdate,
  onDelete,
  onRename,
  onRestore,
  onClose,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const entry = entries.find((e) => e.id === openId) || null;

  const shell = (children: React.ReactNode) => (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        backgroundColor: C.bg,
        color: C.text,
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, -apple-system, sans-serif",
        animation: "mob-fadein 0.2s ease",
      }}
    >
      {children}
    </div>
  );

  // ---- Detail (full-screen study view) ----
  if (entry) {
    const labels = entry.colorLabels || {};
    const byColor: Record<number, Mark[]> = {};
    (entry.marks || []).forEach((m) => {
      (byColor[m.color] = byColor[m.color] || []).push(m);
    });
    const activeColors = COLORS.filter((c) => (byColor[c] || []).length > 0);
    const notes = entry.notes || {};

    const setSynth = (color: number, text: string) => {
      onUpdate(entry.id, { notes: { ...notes, [synthKey(color)]: text } });
    };

    return shell(
      <>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "calc(12px + env(safe-area-inset-top)) 12px 12px",
            borderBottom: "1px solid " + C.border,
          }}
        >
          <button
            onClick={() => setOpenId(null)}
            style={iconBtn(C)}
            aria-label="Back"
          >
            ‹
          </button>
          <div style={{ flex: 1, fontSize: "16px", fontWeight: 700 }}>
            {entry.name}
          </div>
          <button
            onClick={() => {
              const name = window.prompt("Rename note", entry.name);
              if (name && name.trim()) onRename(entry.id, name.trim());
            }}
            style={textBtn(C)}
          >
            Rename
          </button>
          <button
            onClick={() => {
              if (window.confirm("Delete this note from the Vault?")) {
                onDelete(entry.id);
                setOpenId(null);
              }
            }}
            style={textBtn(C)}
          >
            Delete
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
            padding: "20px 22px calc(40px + env(safe-area-inset-bottom))",
          }}
        >
          <div style={{ fontSize: "12px", color: C.muted, marginBottom: "20px" }}>
            {entry.bookName} · {fmtDate(entry.updatedAt)}
          </div>

          <button
            onClick={() => {
              if (
                window.confirm(
                  "Add this study's highlights and themes back into your current book? It only fills in what's missing — nothing you already have is changed or removed."
                )
              ) {
                onRestore(entry);
                onClose();
              }
            }}
            style={{
              width: "100%",
              background: C.text,
              color: C.bg,
              border: "none",
              borderRadius: "10px",
              padding: "13px",
              fontSize: "14px",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              marginBottom: "22px",
            }}
          >
            Restore into my reading
          </button>

          {activeColors.length === 0 && (
            <div style={{ fontSize: "14px", color: C.muted }}>
              This note has no marks.
            </div>
          )}

          {activeColors.map((c) => {
            const list = (byColor[c] || []).slice();
            const name = (labels[c] || "Color " + c).toString().trim();
            return (
              <div key={c} style={{ marginBottom: "26px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "9px",
                    marginBottom: "10px",
                  }}
                >
                  <span
                    style={{
                      width: "14px",
                      height: "14px",
                      borderRadius: "50%",
                      backgroundColor: COLOR_MAP[c as MarkColor],
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: "14px", fontWeight: 600 }}>{name}</span>
                  <span style={{ fontSize: "12px", color: C.muted }}>
                    {list.length}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    marginBottom: "10px",
                  }}
                >
                  {list.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        background: C.soft,
                        border: "1px solid " + C.border,
                        borderRadius: "10px",
                        padding: "10px 12px",
                      }}
                    >
                      <div
                        style={{
                          fontFamily: '"Times New Roman", Times, serif',
                          fontSize: "15px",
                          lineHeight: 1.7,
                          marginBottom: "4px",
                        }}
                      >
                        “
                        <span style={markStyleCSS(m.style, m.color)}>
                          {m.markedText}
                        </span>
                        ”
                      </div>
                      <div style={{ fontSize: "11px", color: C.muted }}>
                        {m.reference}
                      </div>
                    </div>
                  ))}
                </div>
                <textarea
                  value={notes[synthKey(c)] || ""}
                  onChange={(e) => setSynth(c, e.target.value)}
                  placeholder={"Synthesize " + name + "…"}
                  rows={3}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "10px 12px",
                    fontSize: "16px",
                    lineHeight: 1.5,
                    borderRadius: "10px",
                    border: "1px solid " + C.border,
                    backgroundColor: C.panel,
                    color: C.text,
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                />
              </div>
            );
          })}
        </div>
      </>
    );
  }

  // ---- List ----
  const sorted = entries.slice().sort((a, b) => b.updatedAt - a.updatedAt);

  return shell(
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "calc(12px + env(safe-area-inset-top)) 12px 12px",
          borderBottom: "1px solid " + C.border,
        }}
      >
        <div style={{ flex: 1, fontSize: "18px", fontWeight: 700 }}>Vault</div>
        <button onClick={onClose} style={iconBtn(C)} aria-label="Close">
          ✕
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          overscrollBehavior: "contain",
          padding: "16px 16px calc(40px + env(safe-area-inset-bottom))",
        }}
      >
        {sorted.length === 0 ? (
          <div style={{ fontSize: "14px", color: C.muted, lineHeight: 1.6, padding: "8px" }}>
            Your Vault is empty. Open the Outline and tap “Save to Vault” to keep
            a study here — it'll be waiting whenever you want to revisit or share
            it.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {sorted.map((e) => (
              <button
                key={e.id}
                onClick={() => setOpenId(e.id)}
                style={{
                  textAlign: "left",
                  background: C.panel,
                  border: "1px solid " + C.border,
                  borderRadius: "12px",
                  padding: "14px 16px",
                  cursor: "pointer",
                  color: C.text,
                  fontFamily: "inherit",
                }}
              >
                <div style={{ fontSize: "15px", fontWeight: 600, marginBottom: "3px" }}>
                  {e.name}
                </div>
                <div style={{ fontSize: "12px", color: C.muted }}>
                  {e.bookName} · {(e.marks || []).length} marks · {fmtDate(e.updatedAt)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function iconBtn(C: { text: string }): React.CSSProperties {
  return {
    width: "40px",
    height: "40px",
    background: "transparent",
    border: "none",
    color: C.text,
    fontSize: "22px",
    cursor: "pointer",
    flexShrink: 0,
  };
}

function textBtn(C: { text: string; border: string }): React.CSSProperties {
  return {
    background: "transparent",
    border: "1px solid " + C.border,
    borderRadius: "8px",
    padding: "6px 10px",
    fontSize: "12px",
    color: C.text,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
