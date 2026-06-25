import { useState, CSSProperties } from "react";
import scriptures from "../data/scriptures.json";
import { Mark, MarkColor, COLORS, COLOR_MAP, Tab } from "../types";
import SharePreview from "../SharePreview";
import { VersesCardEntry } from "../shareCard";

const vols = scriptures.volumes;

interface CC {
  bg: string;
  panel: string;
  soft: string;
  text: string;
  muted: string;
  border: string;
}

interface Props {
  compileTabs: Tab[];
  marks: Mark[];
  colorLabels: Record<number, string>;
  notes: Record<string, string>;
  dark: boolean;
  C: CC;
  onClose: () => void;
  onFlash: (m: string) => void;
}

// Desktop "share up to 4 verses" picker. Mirrors the mobile flow: pick verses
// grouped by theme, then hand off to the shared SharePreview to render/share
// the social card.
export default function ShareVerses({
  compileTabs,
  marks,
  colorLabels,
  notes,
  dark,
  C,
  onClose,
  onFlash,
}: Props) {
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState<number[]>([]);
  const [previewing, setPreviewing] = useState(false);

  // The verses of the compiled chapters, in reading order (same as Outline).
  type Row = { reference: string; chapterRef: string; order: number };
  const allRows: Row[] = [];
  compileTabs.forEach((t, ti) => {
    const book = vols[t.volume].books[t.book];
    const chapter = book.chapters[t.chapter];
    const chapterRef = book.book + " " + chapter.chapter;
    chapter.verses.forEach((v, i) => {
      allRows.push({
        reference: v.reference,
        chapterRef,
        order: ti * 100000 + i,
      });
    });
  });
  const orderOf = new Map(allRows.map((r) => [r.reference, r.order]));
  const chapterRefOf = new Map(allRows.map((r) => [r.reference, r.chapterRef]));
  const selectedRefs = new Set(allRows.map((r) => r.reference));
  const relevant = marks.filter((m) => selectedRefs.has(m.reference));

  // Group by theme color -> verses -> the marked phrases on each verse.
  const groups = COLORS.filter((c) => relevant.some((m) => m.color === c)).map(
    (color) => {
      const colorMarks = relevant.filter((m) => m.color === color);
      const refs = Array.from(
        new Set(colorMarks.map((m) => m.reference))
      ).sort((a, b) => (orderOf.get(a) || 0) - (orderOf.get(b) || 0));
      const verses = refs.map((reference) => ({
        reference,
        phrases: colorMarks
          .filter((m) => m.reference === reference)
          .sort((a, b) => a.startIndex - b.startIndex)
          .map((m) => ({ text: m.markedText, style: m.style as string })),
      }));
      return {
        color,
        name: (colorLabels[color] || "Color " + color).trim(),
        verses,
      };
    }
  );

  const keyFor = (color: number, reference: string) => color + "|" + reference;
  const togglePick = (key: string) => {
    if (picked.includes(key)) {
      setPicked((p) => p.filter((k) => k !== key));
      return;
    }
    if (picked.length >= 4) {
      onFlash("You can share up to 4 verses");
      return;
    }
    setPicked((p) => [...p, key]);
  };
  const toggleOpen = (c: number) =>
    setOpen((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));

  // Turn the chosen verses into share-card entries (with any per-verse note).
  const buildEntries = (): VersesCardEntry[] => {
    const entries: VersesCardEntry[] = [];
    groups.forEach((g) => {
      g.verses.forEach((v) => {
        if (!picked.includes(keyFor(g.color, v.reference))) return;
        const chRef = chapterRefOf.get(v.reference) || "";
        const noteKey = "note|" + chRef + "|c" + g.color + "|" + v.reference;
        const note = (notes[noteKey] || "").trim();
        entries.push({
          reference: v.reference,
          theme: g.name,
          color: g.color,
          phrases: v.phrases,
          note: note || undefined,
        });
      });
    });
    return entries;
  };

  if (previewing) {
    return (
      <SharePreview
        C={C}
        appDark={dark}
        kind="verses"
        verses={buildEntries()}
        syntheses={[]}
        onClose={() => setPreviewing(false)}
        onFlash={onFlash}
      />
    );
  }

  const clamp2: CSSProperties = {
    fontFamily: '"Times New Roman", Georgia, serif',
    fontSize: "14px",
    lineHeight: 1.5,
    color: C.text,
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
  };

  return (
    <div
      className="scribal-fade"
      onClick={onClose}
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
          maxWidth: "560px",
          maxHeight: "86vh",
          display: "flex",
          flexDirection: "column",
          background: C.bg,
          color: C.text,
          borderRadius: "16px",
          border: "1px solid " + C.border,
          overflow: "hidden",
          boxShadow: "0 24px 70px rgba(0,0,0,0.4)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "16px 18px",
            borderBottom: "1px solid " + C.border,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "16px", fontWeight: 700 }}>
              Choose verses to share
            </div>
            <div style={{ fontSize: "12px", color: C.muted }}>
              {picked.length} of 4 selected
            </div>
          </div>
          <button
            onClick={() => picked.length > 0 && setPreviewing(true)}
            disabled={picked.length === 0}
            style={{
              background: picked.length ? C.text : C.soft,
              color: picked.length ? C.bg : C.muted,
              border: "none",
              borderRadius: "999px",
              padding: "9px 18px",
              fontSize: "13.5px",
              fontWeight: 700,
              cursor: picked.length ? "pointer" : "default",
              fontFamily: "inherit",
            }}
          >
            Create image →
          </button>
          <button
            onClick={onClose}
            aria-label="Cancel"
            style={{
              background: "transparent",
              border: "1px solid " + C.border,
              color: C.text,
              borderRadius: "999px",
              padding: "9px 14px",
              fontSize: "13px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
          {groups.length === 0 && (
            <div
              style={{
                color: C.muted,
                padding: "30px 0",
                textAlign: "center",
              }}
            >
              No marked verses in this compilation yet.
            </div>
          )}
          {groups.map((g) => {
            const isOpen = open.includes(g.color);
            const pickedInTheme = g.verses.filter((v) =>
              picked.includes(keyFor(g.color, v.reference))
            ).length;
            return (
              <div
                key={g.color}
                style={{
                  marginBottom: "12px",
                  border: "1px solid " + C.border,
                  borderRadius: "12px",
                  background: C.panel,
                  overflow: "hidden",
                }}
              >
                <button
                  onClick={() => toggleOpen(g.color)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    width: "100%",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    padding: "13px 14px",
                    cursor: "pointer",
                    color: C.text,
                    fontFamily: "inherit",
                  }}
                >
                  <span
                    style={{
                      width: "14px",
                      height: "14px",
                      borderRadius: "50%",
                      backgroundColor: COLOR_MAP[g.color as MarkColor],
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: "15px",
                      fontWeight: 700,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {g.name}
                  </span>
                  {pickedInTheme > 0 && (
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        color: COLOR_MAP[g.color as MarkColor],
                      }}
                    >
                      {pickedInTheme} picked
                    </span>
                  )}
                  <span style={{ fontSize: "11.5px", color: C.muted }}>
                    {g.verses.length}{" "}
                    {g.verses.length === 1 ? "verse" : "verses"}
                  </span>
                  <span
                    style={{
                      fontSize: "12px",
                      color: C.muted,
                      transform: isOpen ? "rotate(90deg)" : "none",
                      transition: "transform 0.15s",
                    }}
                  >
                    ›
                  </span>
                </button>

                {isOpen && (
                  <div style={{ padding: "0 12px 10px" }}>
                    {g.verses.map((v) => {
                      const key = keyFor(g.color, v.reference);
                      const on = picked.includes(key);
                      const atCap = !on && picked.length >= 4;
                      const preview = v.phrases[0] ? v.phrases[0].text : "";
                      return (
                        <button
                          key={key}
                          onClick={() => togglePick(key)}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: "10px",
                            width: "100%",
                            textAlign: "left",
                            background: on ? C.soft : "transparent",
                            border:
                              "1px solid " +
                              (on ? COLOR_MAP[g.color as MarkColor] : C.border),
                            borderRadius: "10px",
                            padding: "10px 11px",
                            marginBottom: "8px",
                            cursor: "pointer",
                            color: C.text,
                            fontFamily: "inherit",
                            opacity: atCap ? 0.45 : 1,
                          }}
                        >
                          <span
                            style={{
                              width: "20px",
                              height: "20px",
                              borderRadius: "6px",
                              border:
                                "2px solid " +
                                (on
                                  ? COLOR_MAP[g.color as MarkColor]
                                  : C.muted),
                              background: on
                                ? COLOR_MAP[g.color as MarkColor]
                                : "transparent",
                              color: "#fff",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "13px",
                              flexShrink: 0,
                              marginTop: "1px",
                            }}
                          >
                            {on ? "\u2713" : ""}
                          </span>
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              display: "flex",
                              flexDirection: "column",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "12.5px",
                                fontWeight: 700,
                                marginBottom: "3px",
                              }}
                            >
                              {v.reference}
                            </span>
                            <span style={clamp2}>
                              {"\u201C" + preview + "\u201D"}
                              {v.phrases.length > 1
                                ? " +" + (v.phrases.length - 1) + " more"
                                : ""}
                            </span>
                          </span>
                        </button>
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
