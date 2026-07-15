import { useState } from "react";
import { isSermonsVolume, sermonLabel } from "../sermons";

// A fresh reading-row tab before it becomes anything (SCR-43): instead of
// auto-opening a chapter, the panel offers Library (drill volumes → books →
// chapters) or Search (the tab converts to a search panel). The panel itself
// never navigates — the parent swaps it for the real tab on pick.

type Chapter = { chapter: number; title?: string };
type Book = { book: string; chapters: Chapter[] };
type Volume = { volume: string; books: Book[] };

// A pickable study-panel target (SCR-27). The id is an encoded descriptor the
// parent parses back — this component never interprets it.
export interface NewTabStudyChoice {
  id: string;
  label: string;
  meta?: string;
}

interface NewTabPanelProps {
  vols: Volume[];
  studies: NewTabStudyChoice[];
  onPickChapter: (v: number, b: number, c: number) => void;
  onPickStudy: (id: string) => void;
  onSearch: () => void;
  onClose: () => void;
}

export default function NewTabPanel({
  vols,
  studies,
  onPickChapter,
  onPickStudy,
  onSearch,
  onClose,
}: NewTabPanelProps) {
  const [browsing, setBrowsing] = useState(false);
  const [pickingStudy, setPickingStudy] = useState(false);
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
              <span style={{ minWidth: 0 }}>
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
                  A live view of a study's verses by theme
                </span>
              </span>
            </button>
          </div>
        )}

        {step === "studies" &&
          (studies.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
              {studies.map((s) =>
                listRow(s.label, () => onPickStudy(s.id), s.id, s.meta)
              )}
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
    </div>
  );
}
