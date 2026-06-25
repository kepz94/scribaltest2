// AddToStudyMenu.tsx
// -----------------------------------------------------------------------------
// THE single "Add" front door. It is the one place that replaces every old way
// of getting scripture into a study: linking chapters, keyword-searching into a
// chapter, building one study from many sources, and sending selected verses.
// Under the unified model there are only two moves, both landing in ONE study:
//   - add a SCOPE (chapter / book / volume)  -> study.scopes
//   - add LOOSE verses (search result or hand-picked) -> study.looseRefs
// Adding two chapters to a study IS "linking" them (per-study model).
//
// Design (Separation of Concerns): this component ORCHESTRATES. It does not
// rebuild search -- the "by search" action routes out to the app's existing
// SearchPanel (DRY). It reuses the app's CSS variables + the Send-picker visual
// language so it matches the desktop UI and light/dark automatically.
//
// It is self-contained for everything except the two things only App.tsx can
// own: the actual study mutations (passed in as callbacks, backed by
// useStudyLibrary) and routing to SearchPanel. Until App.tsx wires those props,
// rendering this changes nothing -- it is additive.
// -----------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { Study } from "../studyModel";
import { BOOK_TOKEN, VOLUME_TOKEN } from "../scriptureIndex";
import scriptures from "../data/scriptures.json";

// Minimal shape of the scripture data we navigate (clearer than `any`).
interface RawChapter {
  reference: string;
}
interface RawBook {
  book: string;
  chapters: RawChapter[];
}
interface RawVolume {
  volume: string;
  books: RawBook[];
}
const VOLUMES = (scriptures as { volumes: RawVolume[] }).volumes;

const ACCENT = "#8b5cf6";

interface AddToStudyMenuProps {
  // Live, visible studies (from useStudyLibrary).
  studies: Study[];
  // Which book a NEW study's marks live in. App.tsx owns this policy.
  defaultBookId: string;
  // Where the reader currently is, so the browser opens at the current chapter
  // (the common case is one tap) while everything stays reachable.
  currentLocation?: { volume: number; book: number; chapter: number };
  // Verses currently selected in the reading panel, for the "Send" path.
  selectedRefs?: string[];
  // Study mutations (backed by useStudyLibrary). createStudy returns the record
  // so we can immediately add to it.
  onCreateStudy: (input: { name: string; bookId: string }) => Study;
  onAddScope: (studyId: string, token: string) => void;
  onAddLooseRefs: (studyId: string, refs: string[]) => void;
  // Route to the existing SearchPanel in "add to this study" mode (DRY).
  onRequestSearch: (studyId: string) => void;
  dark: boolean;
}

// A study's contents, summarised for the Stage-2 header ("2 chapters · 5 verses").
function summarizeContents(scopes: string[], looseCount: number): string {
  let chapters = 0;
  let books = 0;
  let volumes = 0;
  scopes.forEach((t) => {
    if (t.indexOf(VOLUME_TOKEN) === 0) volumes += 1;
    else if (t.indexOf(BOOK_TOKEN) === 0) books += 1;
    else chapters += 1;
  });
  const parts: string[] = [];
  const plural = (n: number, word: string) => n + " " + word + (n === 1 ? "" : "s");
  if (volumes) parts.push(plural(volumes, "volume"));
  if (books) parts.push(plural(books, "book"));
  if (chapters) parts.push(plural(chapters, "chapter"));
  if (looseCount) parts.push(plural(looseCount, "verse"));
  return parts.length ? parts.join(" · ") : "nothing yet";
}

export default function AddToStudyMenu(props: AddToStudyMenuProps) {
  const {
    studies,
    defaultBookId,
    currentLocation,
    selectedRefs,
    onCreateStudy,
    onAddScope,
    onAddLooseRefs,
    onRequestSearch,
    dark,
  } = props;

  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<"pick" | "add">("pick");
  const [target, setTarget] = useState<{ id: string; name: string } | null>(
    null
  );
  // null = not creating a new study; string = the in-progress name draft.
  const [newDraft, setNewDraft] = useState<string | null>(null);
  const [view, setView] = useState<"menu" | "browse">("menu");
  // Browser drill-down position. null = not yet chosen at that level.
  const [bVol, setBVol] = useState<number | null>(null);
  const [bBook, setBBook] = useState<number | null>(null);
  // Brief inline confirmation after an add ("Added Alma 5"), so the popover can
  // stay open for building one study from many sources.
  const [toast, setToast] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape, like the app's other popovers.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Reset to a clean state whenever the popover closes.
  useEffect(() => {
    if (open) return;
    setStage("pick");
    setTarget(null);
    setNewDraft(null);
    setView("menu");
    setBVol(null);
    setBBook(null);
    setToast(null);
  }, [open]);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 1600);
  };

  const goToStudy = (id: string, name: string) => {
    setTarget({ id, name });
    setStage("add");
    setView("menu");
    // Open the browser at the current chapter by default; still fully navigable.
    setBVol(currentLocation ? currentLocation.volume : null);
    setBBook(currentLocation ? currentLocation.book : null);
  };

  const createAndGo = () => {
    const name = (newDraft || "").trim() || "New study";
    const study = onCreateStudy({ name, bookId: defaultBookId });
    setNewDraft(null);
    goToStudy(study.id, study.name);
  };

  const addScope = (token: string, label: string) => {
    if (!target) return;
    onAddScope(target.id, token);
    flash("Added " + label);
  };

  const addSelected = () => {
    if (!target || !selectedRefs || selectedRefs.length === 0) return;
    onAddLooseRefs(target.id, selectedRefs);
    flash(
      "Added " +
        selectedRefs.length +
        (selectedRefs.length === 1 ? " verse" : " verses")
    );
  };

  // ---- shared styles, matching the Send-picker popover ----
  const rowStyle = {
    display: "block",
    width: "100%",
    textAlign: "left" as const,
    padding: "9px 12px",
    borderRadius: "7px",
    border: "none",
    background: "transparent",
    color: "var(--text)",
    cursor: "pointer",
    fontSize: "13px",
    fontFamily: "inherit",
  };
  const divider = (
    <div
      style={{ height: "1px", background: "var(--border)", margin: "4px 6px" }}
    />
  );

  const activeStudy = target
    ? studies.find((s) => s.id === target.id)
    : undefined;

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Add chapters, books, or verses to a study"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 12px",
          borderRadius: "999px",
          border: "1px solid " + (open ? ACCENT : "var(--border)"),
          backgroundColor: open
            ? dark
              ? "rgba(139,92,246,0.20)"
              : "rgba(139,92,246,0.10)"
            : "var(--panel)",
          color: open ? ACCENT : "var(--text)",
          fontSize: "12.5px",
          fontWeight: 600,
          fontFamily: "system-ui, sans-serif",
          cursor: "pointer",
          transition: "all 0.15s",
        }}
      >
        <span style={{ fontSize: "15px", lineHeight: 1, fontWeight: 700 }}>
          +
        </span>
        Add
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 60,
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: "10px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            width: "280px",
            maxHeight: "360px",
            overflowY: "auto",
            padding: "6px",
            textAlign: "left",
          }}
        >
          {stage === "pick" ? (
            <>
              {newDraft === null ? (
                <button
                  onClick={() => setNewDraft("")}
                  style={{
                    ...rowStyle,
                    color: ACCENT,
                    fontWeight: 700,
                  }}
                >
                  ✦ New study
                </button>
              ) : (
                <div style={{ display: "flex", gap: "6px", padding: "4px" }}>
                  <input
                    autoFocus
                    value={newDraft}
                    onChange={(e) => setNewDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") createAndGo();
                      if (e.key === "Escape") setNewDraft(null);
                    }}
                    placeholder="Name this study"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: "13px",
                      padding: "7px 10px",
                      borderRadius: "7px",
                      border: "1px solid " + ACCENT,
                      background: "var(--bg)",
                      color: "var(--text)",
                      outline: "none",
                      fontFamily: "inherit",
                    }}
                  />
                  <button
                    onClick={createAndGo}
                    style={{
                      padding: "7px 12px",
                      borderRadius: "7px",
                      border: "none",
                      background: ACCENT,
                      color: "#fff",
                      fontSize: "12.5px",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Create
                  </button>
                </div>
              )}

              {divider}

              {studies.length === 0 ? (
                <div
                  style={{
                    padding: "8px 12px",
                    fontSize: "12px",
                    color: "var(--muted)",
                  }}
                >
                  No studies yet — start one above.
                </div>
              ) : (
                studies.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => goToStudy(s.id, s.name)}
                    style={rowStyle}
                  >
                    📑 {s.name}
                    <span
                      style={{
                        color: "var(--muted)",
                        fontSize: "11.5px",
                        marginLeft: "6px",
                      }}
                    >
                      {summarizeContents(s.scopes, (s.looseRefs || []).length)}
                    </span>
                  </button>
                ))
              )}
            </>
          ) : (
            <>
              {/* Stage 2 header: which study we're adding to, with a way back. */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "4px 6px 8px",
                }}
              >
                <button
                  onClick={() => {
                    setStage("pick");
                    setTarget(null);
                    setView("menu");
                  }}
                  title="Choose a different study"
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "var(--muted)",
                    cursor: "pointer",
                    fontSize: "16px",
                    lineHeight: 1,
                    padding: "2px 4px",
                    fontFamily: "inherit",
                  }}
                >
                  ‹
                </button>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 700,
                      color: "var(--text)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {target ? target.name : ""}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                    {activeStudy
                      ? summarizeContents(
                          activeStudy.scopes,
                          (activeStudy.looseRefs || []).length
                        )
                      : "nothing yet"}
                  </div>
                </div>
              </div>

              {divider}

              {view === "menu" ? (
                <>
                  {selectedRefs && selectedRefs.length > 0 && (
                    <button onClick={addSelected} style={rowStyle}>
                      ✓ Add selected verses ({selectedRefs.length})
                    </button>
                  )}
                  <button
                    onClick={() => setView("browse")}
                    style={rowStyle}
                  >
                    📖 Add a chapter, book, or volume
                  </button>
                  <button
                    onClick={() => {
                      if (target) onRequestSearch(target.id);
                      setOpen(false);
                    }}
                    style={rowStyle}
                  >
                    🔍 Add verses by search
                  </button>
                </>
              ) : (
                <>
                  {/* Breadcrumb up the scripture hierarchy. */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "4px",
                      alignItems: "center",
                      padding: "2px 6px 6px",
                      fontSize: "11.5px",
                      color: "var(--muted)",
                    }}
                  >
                    <button
                      onClick={() => {
                        setBVol(null);
                        setBBook(null);
                      }}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: bVol === null ? "var(--text)" : ACCENT,
                        cursor: "pointer",
                        fontSize: "11.5px",
                        padding: 0,
                        fontFamily: "inherit",
                      }}
                    >
                      All
                    </button>
                    {bVol !== null && (
                      <>
                        <span>›</span>
                        <button
                          onClick={() => setBBook(null)}
                          style={{
                            border: "none",
                            background: "transparent",
                            color: bBook === null ? "var(--text)" : ACCENT,
                            cursor: "pointer",
                            fontSize: "11.5px",
                            padding: 0,
                            fontFamily: "inherit",
                          }}
                        >
                          {VOLUMES[bVol].volume}
                        </button>
                      </>
                    )}
                    {bVol !== null && bBook !== null && (
                      <>
                        <span>›</span>
                        <span style={{ color: "var(--text)" }}>
                          {VOLUMES[bVol].books[bBook].book}
                        </span>
                      </>
                    )}
                  </div>

                  {bVol === null
                    ? VOLUMES.map((v, vi) => (
                        <button
                          key={v.volume}
                          onClick={() => {
                            setBVol(vi);
                            setBBook(null);
                          }}
                          style={rowStyle}
                        >
                          {v.volume}
                        </button>
                      ))
                    : bBook === null
                    ? (
                        <>
                          <button
                            onClick={() =>
                              addScope(
                                VOLUME_TOKEN + VOLUMES[bVol].volume,
                                "all of " + VOLUMES[bVol].volume
                              )
                            }
                            style={{ ...rowStyle, color: ACCENT, fontWeight: 600 }}
                          >
                            ➕ Add all of {VOLUMES[bVol].volume}
                          </button>
                          {VOLUMES[bVol].books.map((b, bi) => (
                            <button
                              key={b.book}
                              onClick={() => setBBook(bi)}
                              style={rowStyle}
                            >
                              {b.book}
                            </button>
                          ))}
                        </>
                      )
                    : (
                        <>
                          <button
                            onClick={() =>
                              addScope(
                                BOOK_TOKEN + VOLUMES[bVol].books[bBook].book,
                                "all of " + VOLUMES[bVol].books[bBook].book
                              )
                            }
                            style={{ ...rowStyle, color: ACCENT, fontWeight: 600 }}
                          >
                            ➕ Add all of {VOLUMES[bVol].books[bBook].book}
                          </button>
                          {VOLUMES[bVol].books[bBook].chapters.map((c) => (
                            <button
                              key={c.reference}
                              onClick={() => addScope(c.reference, c.reference)}
                              style={rowStyle}
                            >
                              {c.reference}
                            </button>
                          ))}
                        </>
                      )}
                </>
              )}

              {toast && (
                <div
                  style={{
                    margin: "6px 6px 2px",
                    padding: "7px 12px",
                    borderRadius: "7px",
                    background: dark
                      ? "rgba(139,92,246,0.18)"
                      : "rgba(139,92,246,0.10)",
                    color: ACCENT,
                    fontSize: "12px",
                    fontWeight: 600,
                  }}
                >
                  {toast}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
