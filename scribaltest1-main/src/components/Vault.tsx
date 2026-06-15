import { useState, useEffect } from "react";
import CornellNotes from "./CornellNotes";
import Outline from "./Outline";
import Charting from "./Charting";
import ConceptMap from "./ConceptMap";
import { VaultEntry } from "../hooks/useVault";
import { STYLE_POINTS, Tab } from "../types";

interface VaultProps {
  entries: VaultEntry[];
  onUpdateEntry: (id: string, partial: Partial<VaultEntry>) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onJumpToReference: (reference: string) => void;
  onPrint: (entry: VaultEntry) => void;
}

const VIEW_NAMES: Record<string, string> = {
  cornell: "Cornell Notes",
  outline: "Outline",
  charting: "Charting",
  map: "Concept Map",
};

export default function Vault(props: VaultProps) {
  const {
    entries,
    onUpdateEntry,
    onRename,
    onDelete,
    onJumpToReference,
    onPrint,
  } = props;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [localSel, setLocalSel] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [addingTagFor, setAddingTagFor] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");

  const selected = entries.find((e) => e.id === selectedId) || null;

  const allTags = Array.from(
    new Set(entries.flatMap((e) => e.tags || []))
  ).sort();
  const visibleEntries = tagFilter
    ? entries.filter((e) => (e.tags || []).includes(tagFilter))
    : entries;

  const addTag = (e: VaultEntry) => {
    const t = tagDraft.trim();
    if (!t) {
      setAddingTagFor(null);
      return;
    }
    const current = e.tags || [];
    if (!current.includes(t)) onUpdateEntry(e.id, { tags: [...current, t] });
    setTagDraft("");
    setAddingTagFor(null);
  };
  const removeTag = (e: VaultEntry, tag: string) => {
    onUpdateEntry(e.id, { tags: (e.tags || []).filter((x) => x !== tag) });
  };

  useEffect(() => {
    if (selected) {
      setLocalSel(selected.compileTabs.map((t) => t.id));
      setNameDraft(selected.name);
    }
  }, [selectedId]); // eslint-disable-line

  const stats = (e: VaultEntry) => {
    const themes = new Set(e.marks.map((m) => m.color)).size;
    const verses = new Set(e.marks.map((m) => m.reference)).size;
    const points = e.marks.reduce((s, m) => s + STYLE_POINTS[m.style], 0);
    return { themes, verses, points };
  };

  if (selected) {
    const compileTabs = selected.compileTabs.filter((t) =>
      localSel.includes(t.id)
    ) as Tab[];

    const shared = {
      tabs: selected.compileTabs as Tab[],
      compileTabs,
      compileSelection: localSel,
      onToggleCompileTab: (id: string) =>
        setLocalSel((prev) =>
          prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        ),
      marks: selected.marks,
      colorLabels: selected.colorLabels,
      setColorLabel: (c: any, l: string) =>
        onUpdateEntry(selected.id, {
          colorLabels: { ...selected.colorLabels, [c]: l },
        }),
      onJumpToReference,
    };
    const withNotes = {
      notes: selected.notes,
      setNote: (k: string, t: string) =>
        onUpdateEntry(selected.id, {
          notes: { ...selected.notes, [k]: t },
        }),
    };

    return (
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "14px",
            padding: "14px 22px",
            borderBottom: "1px solid var(--border)",
            backgroundColor: "var(--panel)",
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={() => setSelectedId(null)}
            style={{
              padding: "7px 16px",
              borderRadius: "999px",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text)",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            ← Vault
          </button>
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() =>
              onRename(selected.id, nameDraft.trim() || "Untitled note")
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            style={{
              flex: 1,
              minWidth: "180px",
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: "19px",
              fontWeight: 600,
              color: "var(--text)",
            }}
          />
          <span
            style={{
              fontSize: "11px",
              color: "var(--muted)",
              border: "1px solid var(--border)",
              borderRadius: "999px",
              padding: "3px 10px",
            }}
          >
            {VIEW_NAMES[selected.view]}
          </span>
          <span style={{ fontSize: "11.5px", color: "var(--muted)" }}>
            from {selected.bookName}
          </span>
          <button
            onClick={() => onPrint(selected)}
            style={{
              padding: "7px 16px",
              borderRadius: "999px",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text)",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            ⎙ Print / PDF
          </button>
        </div>

        {selected.view === "cornell" && (
          <CornellNotes {...shared} {...withNotes} />
        )}
        {selected.view === "outline" && <Outline {...shared} {...withNotes} />}
        {selected.view === "charting" && <Charting {...shared} />}
        {selected.view === "map" && <ConceptMap {...shared} />}
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "26px 22px 80px",
        maxWidth: "1000px",
        margin: "0 auto",
      }}
    >
      <div style={{ marginBottom: "20px" }}>
        <div
          style={{
            fontSize: "11px",
            letterSpacing: "2px",
            color: "var(--muted)",
            textTransform: "uppercase",
          }}
        >
          Notes Vault
        </div>
        <h1 style={{ margin: "4px 0 0 0", fontWeight: 500, fontSize: "26px" }}>
          Your saved studies
        </h1>
      </div>

      {allTags.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "8px",
            marginBottom: "18px",
            alignItems: "center",
          }}
        >
          <button
            onClick={() => setTagFilter(null)}
            style={{
              fontSize: "12px",
              padding: "4px 12px",
              borderRadius: "999px",
              cursor: "pointer",
              border: "1px solid var(--border)",
              backgroundColor: tagFilter === null ? "var(--text)" : "transparent",
              color: tagFilter === null ? "var(--bg)" : "var(--muted)",
            }}
          >
            All
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => setTagFilter(t)}
              style={{
                fontSize: "12px",
                padding: "4px 12px",
                borderRadius: "999px",
                cursor: "pointer",
                border: "1px solid var(--border)",
                backgroundColor: tagFilter === t ? "var(--text)" : "transparent",
                color: tagFilter === t ? "var(--bg)" : "var(--muted)",
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {entries.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "70px 20px",
            color: "var(--muted)",
            border: "1px dashed var(--border)",
            borderRadius: "16px",
          }}
        >
          <div style={{ fontSize: "32px", marginBottom: "10px" }}>❑</div>
          <p style={{ fontSize: "15px", margin: 0 }}>Nothing saved yet.</p>
          <p style={{ fontSize: "13px", marginTop: "6px" }}>
            Compile a view you like, then tap <strong>★ Save to Vault</strong>{" "}
            to keep it here.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "16px",
          }}
        >
          {visibleEntries.map((e) => {
            const s = stats(e);
            const editing = editingId === e.id;
            return (
              <div
                key={e.id}
                onClick={() => {
                  if (!editing) setSelectedId(e.id);
                }}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "14px",
                  padding: "16px",
                  backgroundColor: "var(--panel)",
                  cursor: "pointer",
                  position: "relative",
                  transition: "box-shadow 0.15s",
                }}
                onMouseEnter={(ev) =>
                  (ev.currentTarget.style.boxShadow =
                    "0 8px 24px rgba(0,0,0,0.12)")
                }
                onMouseLeave={(ev) =>
                  (ev.currentTarget.style.boxShadow = "none")
                }
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "10px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "10px",
                      letterSpacing: "0.5px",
                      color: "var(--muted)",
                      border: "1px solid var(--border)",
                      borderRadius: "999px",
                      padding: "2px 9px",
                    }}
                  >
                    {VIEW_NAMES[e.view]}
                  </span>
                  <div style={{ flex: 1 }} />
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onPrint(e);
                    }}
                    title="Print / Save as PDF"
                    style={iconBtn}
                  >
                    ⎙
                  </button>
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setEditingId(e.id);
                      setEditDraft(e.name);
                    }}
                    title="Rename"
                    style={iconBtn}
                  >
                    ✎
                  </button>
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation();
                      if (
                        window.confirm(
                          'Delete "' + e.name + '" from the Vault?'
                        )
                      )
                        onDelete(e.id);
                    }}
                    title="Delete"
                    style={iconBtn}
                  >
                    ✕
                  </button>
                </div>

                {editing ? (
                  <input
                    autoFocus
                    value={editDraft}
                    onClick={(ev) => ev.stopPropagation()}
                    onChange={(ev) => setEditDraft(ev.target.value)}
                    onBlur={() => {
                      onRename(e.id, editDraft.trim() || "Untitled note");
                      setEditingId(null);
                    }}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") {
                        onRename(e.id, editDraft.trim() || "Untitled note");
                        setEditingId(null);
                      }
                    }}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      padding: "6px 10px",
                      fontSize: "16px",
                      fontWeight: 600,
                      background: "var(--bg)",
                      color: "var(--text)",
                      outline: "none",
                      marginBottom: "8px",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      fontSize: "17px",
                      fontWeight: 600,
                      marginBottom: "8px",
                      lineHeight: 1.3,
                    }}
                  >
                    {e.name}
                  </div>
                )}

                <div
                  style={{
                    fontSize: "12.5px",
                    color: "var(--muted)",
                    marginBottom: "10px",
                  }}
                >
                  {s.themes} theme{s.themes === 1 ? "" : "s"} · {s.verses} verse
                  {s.verses === 1 ? "" : "s"} · {s.points} pts
                </div>

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px",
                    alignItems: "center",
                    marginBottom: "10px",
                  }}
                >
                  {(e.tags || []).map((tag) => (
                    <span
                      key={tag}
                      onClick={(ev) => ev.stopPropagation()}
                      style={{
                        fontSize: "11px",
                        padding: "2px 8px",
                        borderRadius: "999px",
                        backgroundColor: "var(--soft)",
                        color: "var(--text)",
                        display: "flex",
                        alignItems: "center",
                        gap: "5px",
                      }}
                    >
                      {tag}
                      <span
                        onClick={(ev) => {
                          ev.stopPropagation();
                          removeTag(e, tag);
                        }}
                        style={{ cursor: "pointer", opacity: 0.6 }}
                      >
                        ✕
                      </span>
                    </span>
                  ))}
                  {addingTagFor === e.id ? (
                    <input
                      autoFocus
                      value={tagDraft}
                      onClick={(ev) => ev.stopPropagation()}
                      onChange={(ev) => setTagDraft(ev.target.value)}
                      onBlur={() => addTag(e)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") addTag(e);
                        if (ev.key === "Escape") {
                          setTagDraft("");
                          setAddingTagFor(null);
                        }
                      }}
                      placeholder="tag"
                      style={{
                        fontSize: "11px",
                        padding: "2px 8px",
                        borderRadius: "999px",
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        color: "var(--text)",
                        outline: "none",
                        width: "70px",
                      }}
                    />
                  ) : (
                    <span
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setTagDraft("");
                        setAddingTagFor(e.id);
                      }}
                      title="Add a tag"
                      style={{
                        fontSize: "11px",
                        padding: "2px 8px",
                        borderRadius: "999px",
                        border: "1px dashed var(--border)",
                        color: "var(--muted)",
                        cursor: "pointer",
                      }}
                    >
                      + tag
                    </span>
                  )}
                </div>

                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--muted)",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>{e.bookName}</span>
                  <span>{new Date(e.updatedAt).toLocaleDateString()}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: "12px",
  padding: "2px 4px",
};
