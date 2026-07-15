import { useState } from "react";
import { isSermonsVolume, sermonLabel } from "../sermons";
import { COLOR_MAP, MarkColor } from "../types";

// A fresh reading-row tab before it becomes anything (SCR-43): instead of
// auto-opening a chapter, the panel offers Library (drill volumes → books →
// chapters) or Search (the tab converts to a search panel). The panel itself
// never navigates — the parent swaps it for the real tab on pick.

type Chapter = { chapter: number; title?: string };
type Book = { book: string; chapters: Chapter[] };
type Volume = { volume: string; books: Book[] };

// A pickable study-panel target (SCR-27). The id is an encoded descriptor the
// parent parses back — this component never interprets it. themes/accent make
// the row read like a Studies-hub row (SCR-44) for quick identification.
export interface NewTabStudyChoice {
  id: string;
  label: string;
  meta?: string;
  accent?: string;
  themes?: { color: number; name: string }[];
}

interface NewTabPanelProps {
  vols: Volume[];
  studies: NewTabStudyChoice[];
  onPickChapter: (v: number, b: number, c: number) => void;
  onPickStudy: (id: string) => void;
  onSearch: () => void;
  // Creates an empty topic study (in the Master Topic Book) and converts
  // this launcher into its live panel — start empty, drag verses in.
  onNewTopicStudy: () => void;
  onClose: () => void;
}

export default function NewTabPanel({
  vols,
  studies,
  onPickChapter,
  onPickStudy,
  onSearch,
  onNewTopicStudy,
  onClose,
}: NewTabPanelProps) {
  const [browsing, setBrowsing] = useState(false);
  const [pickingStudy, setPickingStudy] = useState(false);
  const [showStudyInfo, setShowStudyInfo] = useState(false);
  const [volIdx, setVolIdx] = useState<number | null>(null);
  const [bookIdx, setBookIdx] = useState<number | null>(null);

  const vol = volIdx !== null ? vols[volIdx] : null;
  const singleBook = vol ? vol.books.length === 1 : false;
  const book = vol && bookIdx !== null ? vol.books[bookIdx] : null;

  const step: "root" | "volumes" | "books" | "chapters" | "studies" =
    pickingStudy
      ? "studies"
      : !browsing
      ? "root"
      : vol === null
      ? "volumes"
      : book === null
      ? "books"
      : "chapters";

  const goBack = () => {
    if (step === "studies") {
      setPickingStudy(false);
    } else if (step === "chapters") {
      if (singleBook) {
        setVolIdx(null);
        setBookIdx(null);
      } else {
        setBookIdx(null);
      }
    } else if (step === "books") {
      setVolIdx(null);
    } else {
      setBrowsing(false);
    }
  };

  const headerTitle =
    step === "volumes"
      ? "Library"
      : step === "books"
      ? vol!.volume
      : step === "chapters"
      ? singleBook
        ? vol!.volume
        : book!.book
      : step === "studies"
      ? "Studies"
      : "New tab";

  const closeX = (
    <button
      onClick={onClose}
      title="Close this tab"
      aria-label="Close this tab"
      style={{
        marginLeft: "auto",
        width: "26px",
        height: "26px",
        borderRadius: "999px",
        border: "none",
        background: "transparent",
        color: "var(--muted)",
        fontSize: "15px",
        lineHeight: 1,
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      ✕
    </button>
  );

  const listRow = (
    label: string,
    onClick: () => void,
    key?: string,
    meta?: string
  ) => (
    <button
      key={key ?? label}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
        width: "100%",
        textAlign: "left",
        padding: "13px 16px",
        borderRadius: "12px",
        border: "1px solid var(--border)",
        background: "var(--panel)",
        color: "var(--text)",
        fontSize: "14px",
        fontWeight: 600,
        fontFamily: "system-ui, sans-serif",
        cursor: "pointer",
        transition: "all 0.15s",
      }}
    >
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </span>
      {meta ? (
        <span
          style={{
            color: "var(--muted)",
            flexShrink: 0,
            fontSize: "11.5px",
            fontWeight: 600,
          }}
        >
          {meta}
        </span>
      ) : (
        <span style={{ color: "var(--muted)", flexShrink: 0 }}>›</span>
      )}
    </button>
  );

  return (
    <div
      style={{
        height: "100%",
        overflowY: "auto",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ padding: "18px 20px 40px", maxWidth: "560px", margin: "0 auto" }}>
        {/* Header: back chevron while browsing, ✕ always */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "9px",
            marginBottom: step === "root" ? "26px" : "14px",
          }}
        >
          {step !== "root" && (
            <button
              onClick={goBack}
              title="Back"
              aria-label="Back"
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "999px",
                border: "1px solid var(--border)",
                background: "var(--panel)",
                color: "var(--text)",
                fontSize: "16px",
                lineHeight: 1,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              ‹
            </button>
          )}
          <span
            style={{
              fontSize: "13px",
              fontWeight: 700,
              color: "var(--muted)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {headerTitle}
          </span>
          {step === "studies" && (
            <button
              onClick={() => setShowStudyInfo(true)}
              title="How live studies work"
              style={{
                flexShrink: 0,
                width: "22px",
                height: "22px",
                borderRadius: "999px",
                border: "1px solid var(--border)",
                background: "var(--panel)",
                color: "var(--muted)",
                fontSize: "13px",
                fontWeight: 700,
                fontStyle: "italic",
                fontFamily: "Georgia, 'Times New Roman', serif",
                lineHeight: 1,
                padding: 0,
                cursor: "pointer",
              }}
            >
              i
            </button>
          )}
          {closeX}
        </div>

        {step === "root" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <button
              onClick={() => setBrowsing(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "14px",
                width: "100%",
                textAlign: "left",
                padding: "18px 18px",
                borderRadius: "14px",
                border: "1px solid var(--border)",
                background: "var(--panel)",
                color: "var(--text)",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
              >
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              <span style={{ minWidth: 0 }}>
                <span
                  style={{ display: "block", fontSize: "15px", fontWeight: 700 }}
                >
                  Library
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: "12.5px",
                    color: "var(--muted)",
                    marginTop: "3px",
                    lineHeight: 1.45,
                  }}
                >
                  Browse the volumes, pick a book and chapter
                </span>
              </span>
            </button>
            <button
              onClick={onSearch}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "14px",
                width: "100%",
                textAlign: "left",
                padding: "18px 18px",
                borderRadius: "14px",
                border: "1px solid var(--border)",
                background: "var(--panel)",
                color: "var(--text)",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <span style={{ minWidth: 0 }}>
                <span
                  style={{ display: "block", fontSize: "15px", fontWeight: 700 }}
                >
                  Search
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: "12.5px",
                    color: "var(--muted)",
                    marginTop: "3px",
                    lineHeight: 1.45,
                  }}
                >
                  Turn this tab into a keyword search
                </span>
              </span>
            </button>
            <button
              onClick={() => setPickingStudy(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "14px",
                width: "100%",
                textAlign: "left",
                padding: "18px 18px",
                borderRadius: "14px",
                border: "1px solid var(--border)",
                background: "var(--panel)",
                color: "var(--text)",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
              >
                <polygon points="12 2 22 8.5 12 15 2 8.5 12 2" />
                <polyline points="2 15.5 12 22 22 15.5" />
              </svg>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span
                  style={{ display: "block", fontSize: "15px", fontWeight: 700 }}
                >
                  Studies
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: "12.5px",
                    color: "var(--muted)",
                    marginTop: "3px",
                    lineHeight: 1.45,
                  }}
                >
                  Open a study — topic studies as live panels
                </span>
              </span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setShowStudyInfo(true);
                }}
                title="How live studies work"
                role="button"
                style={{
                  flexShrink: 0,
                  width: "22px",
                  height: "22px",
                  borderRadius: "999px",
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--muted)",
                  fontSize: "13px",
                  fontWeight: 700,
                  fontStyle: "italic",
                  fontFamily: "Georgia, 'Times New Roman', serif",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1,
                  cursor: "pointer",
                }}
              >
                i
              </span>
            </button>
            <button
              onClick={onNewTopicStudy}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "14px",
                width: "100%",
                textAlign: "left",
                padding: "18px 18px",
                borderRadius: "14px",
                border: "1px solid var(--border)",
                borderLeft: "3px solid #3b82f6",
                background: "var(--panel)",
                color: "var(--text)",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#3b82f6"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span style={{ minWidth: 0 }}>
                <span
                  style={{ display: "block", fontSize: "15px", fontWeight: 700 }}
                >
                  New topic study
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: "12.5px",
                    color: "var(--muted)",
                    marginTop: "3px",
                    lineHeight: 1.45,
                  }}
                >
                  Start empty, drag verses in — lives in your Master Topic Book
                </span>
              </span>
            </button>
          </div>
        )}

        {step === "studies" &&
          (studies.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {/* Hub-style rows (SCR-44): name + meta + theme chips, with the
                  Studies hub's kind accent on the left edge, so a study is
                  recognizable at a glance before opening it. */}
              {studies.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onPickStudy(s.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "11px 12px",
                    borderRadius: "12px",
                    border: "1px solid var(--border)",
                    borderLeft: "3px solid " + (s.accent || "var(--border)"),
                    background: "var(--panel)",
                    color: "var(--text)",
                    cursor: "pointer",
                    fontFamily: "system-ui, sans-serif",
                    transition: "all 0.15s",
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      fontSize: "15px",
                      fontWeight: 700,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.label}
                  </span>
                  {s.meta && (
                    <span
                      style={{
                        display: "block",
                        fontSize: "11.5px",
                        color: "var(--muted)",
                        marginTop: "2px",
                      }}
                    >
                      {s.meta}
                    </span>
                  )}
                  {s.themes && s.themes.length > 0 && (
                    <span
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "8px",
                        marginTop: "7px",
                      }}
                    >
                      {s.themes.map((t) => (
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
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <p
              style={{
                fontSize: "13px",
                color: "var(--muted)",
                textAlign: "center",
                marginTop: "30px",
              }}
            >
              Nothing open and no studies yet.
            </p>
          ))}

        {step === "volumes" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
            {vols.map((v, i) =>
              listRow(v.volume, () => {
                setVolIdx(i);
                if (v.books.length === 1) setBookIdx(0);
              }, "vol_" + i)
            )}
          </div>
        )}

        {step === "books" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
            {vol!.books.map((b, i) =>
              listRow(b.book, () => setBookIdx(i), "book_" + i)
            )}
          </div>
        )}

        {step === "chapters" &&
          (isSermonsVolume(vol!.volume) ? (
            // Sermons carry dates, not chapter numbers — list them like books.
            <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
              {book!.chapters.map((ch, i) =>
                listRow(
                  sermonLabel(ch.title, ch.chapter),
                  () => onPickChapter(volIdx!, bookIdx!, i),
                  "ch_" + i
                )
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {book!.chapters.map((ch, i) => (
                <button
                  key={"ch_" + i}
                  onClick={() => onPickChapter(volIdx!, bookIdx!, i)}
                  style={{
                    minWidth: "44px",
                    height: "40px",
                    padding: "0 8px",
                    borderRadius: "10px",
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                    color: "var(--text)",
                    fontSize: "14px",
                    fontWeight: 600,
                    fontFamily: "system-ui, sans-serif",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  {ch.chapter}
                </button>
              ))}
            </div>
          ))}
      </div>

      {/* How live studies work (SCR-44). The one place the flow is explained:
          a study panel is a live view — it becomes a saved study at Compile. */}
      {showStudyInfo && (
        <div
          className="scribal-fade"
          onClick={() => setShowStudyInfo(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 400,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            className="scribal-rise"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: "460px",
              maxHeight: "82vh",
              overflowY: "auto",
              background: "var(--bg)",
              color: "var(--text)",
              borderRadius: "16px",
              border: "1px solid var(--border)",
              boxShadow: "0 24px 70px rgba(0,0,0,0.4)",
              padding: "22px",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            <div
              style={{
                fontSize: "17px",
                fontWeight: 700,
                marginBottom: "10px",
              }}
            >
              Live studies
            </div>
            <p
              style={{
                fontSize: "13.5px",
                lineHeight: 1.6,
                color: "var(--muted)",
                margin: "0 0 12px",
              }}
            >
              Opening a topic study here adds a live panel to your reading row
              — its gathered verses, grouped by theme and markable right in
              the panel. Unmarked verses sit at the top; as you mark, each
              verse moves into its color's theme. A chapter study opens its
              chapter in the reader instead.
            </p>
            <p
              style={{
                fontSize: "13.5px",
                lineHeight: 1.6,
                color: "var(--muted)",
                margin: "0 0 12px",
              }}
            >
              The title and theme names are editable right in the panel, and
              every edit carries through — the reading legend, the compile
              notes, and the Studies list all show the same names.
            </p>
            <p
              style={{
                fontSize: "13.5px",
                lineHeight: 1.6,
                color: "var(--text)",
                fontWeight: 600,
                margin: "0 0 18px",
              }}
            >
              A live panel isn't a saved study yet — it becomes one when you
              press Compile and save it to Studies.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowStudyInfo(false)}
                style={{
                  padding: "9px 18px",
                  borderRadius: "9px",
                  border: "none",
                  background: "var(--text)",
                  color: "var(--bg)",
                  fontSize: "13.5px",
                  fontWeight: 700,
                  fontFamily: "system-ui, sans-serif",
                  cursor: "pointer",
                }}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
