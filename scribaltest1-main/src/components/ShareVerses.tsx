import { useState, useEffect, CSSProperties } from "react";
import { getScriptures, volumesProxy } from "../data/scripturesStore";
import { Mark, MarkColor, COLORS, COLOR_MAP, Tab, WordTag } from "../types";
import SharePreview from "../SharePreview";
import { VersesCardEntry } from "../shareCard";
import { buildStudySummary } from "../studySummary";
import { glossesFor } from "./MarkedVerse";
import { isLoaded, loadWebster } from "../webster";
import { richToText } from "../richText";

const vols = volumesProxy;

// The dialog's outline button — used by Cancel, the view toggle, and the
// whole-study share so they read as one row of controls.
const pill = (C: CC, off: boolean): CSSProperties => ({
  background: "transparent",
  border: "1px solid " + C.border,
  color: off ? C.muted : C.text,
  borderRadius: "999px",
  padding: "9px 14px",
  fontSize: "13px",
  cursor: off ? "default" : "pointer",
  fontFamily: "inherit",
  flexShrink: 0,
});

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
  // What this compilation is called — a named study, else the chapter(s).
  studyName: string;
  // The study's word tags, so a shared card can carry the chosen definitions.
  tags?: WordTag[];
  // "study" skips the picker and opens the whole-study PDF directly — what the
  // Save as PDF action wants. "pick" is the ordinary verse picker.
  initialMode?: "pick" | "study";
  notes: Record<string, string>;
  dark: boolean;
  C: CC;
  onClose: () => void;
  onFlash: (m: string) => void;
}

// Desktop verse picker. Pick as many verses as you like — the system decides how
// they ship (one card, or a paged PDF); it never tells you to pick fewer. Whole
// study is a convenience button, not the only alternative to a handful.
export default function ShareVerses({
  compileTabs,
  marks,
  colorLabels,
  studyName,
  tags,
  initialMode = "pick",
  notes,
  dark,
  C,
  onClose,
  onFlash,
}: Props) {
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState<number[]>([]);
  const [previewing, setPreviewing] = useState<null | "verses" | "study">(
    initialMode === "study" ? "study" : null
  );
  // Focused shows the marked phrases alone; Full redraws the whole verse with
  // the marks layered on, exactly as the reading view has them. Mirrors mobile.
  const [view, setView] = useState<"focused" | "full">("full");
  // The canvas can't look anything up, so the dictionary has to be in memory
  // before the entries are built or a shared card ships without its definitions.
  const [dictReady, setDictReady] = useState(isLoaded());
  useEffect(() => {
    if (dictReady) return;
    let alive = true;
    loadWebster().then(() => alive && setDictReady(true));
    return () => {
      alive = false;
    };
  }, [dictReady]);
  const tagsFor = (reference: string) =>
    dictReady ? (tags || []).filter((t) => t.reference === reference) : [];

  // The verses of the compiled chapters, in reading order (same as Outline).
  type Row = {
    reference: string;
    chapterRef: string;
    order: number;
    text: string;
    verse: number;
  };
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
        text: v.text,
        verse: v.verse,
      });
    });
  });
  const orderOf = new Map(allRows.map((r) => [r.reference, r.order]));
  const chapterRefOf = new Map(allRows.map((r) => [r.reference, r.chapterRef]));
  // Full-verse rendering needs the verse itself, not just the marked snippet.
  const verseInfo = new Map(
    allRows.map((r) => [r.reference, { text: r.text, verse: r.verse }])
  );
  const selectedRefs = new Set(allRows.map((r) => r.reference));
  const relevant = marks.filter((m) => selectedRefs.has(m.reference));

  // Group by theme color -> verses -> the marked phrases on each verse.
  const groups = COLORS.filter((c) => relevant.some((m) => m.color === c)).map(
    (color) => {
      const colorMarks = relevant.filter((m) => m.color === color);
      const refs = Array.from(
        new Set(colorMarks.map((m) => m.reference))
      ).sort((a, b) => (orderOf.get(a) || 0) - (orderOf.get(b) || 0));
      const verses = refs.map((reference) => {
        const vm = colorMarks
          .filter((m) => m.reference === reference)
          .sort((a, b) => a.startIndex - b.startIndex);
        return {
          reference,
          phrases: vm.map((m) => ({ text: m.markedText, style: m.style as string })),
          // Carried through to the card so Full view can draw each mark in
          // place instead of quoting the phrase out of the verse.
          marks: vm.map((m) => ({
            startIndex: m.startIndex,
            endIndex: m.endIndex,
            style: m.style as string,
            color: m.color as number,
          })),
        };
      });
      return {
        color,
        name: (colorLabels[color] || "Color " + color).trim(),
        verses,
      };
    }
  );

  const keyFor = (color: number, reference: string) => color + "|" + reference;
  // No cap: a selection bigger than one card simply becomes a multi-page PDF,
  // the same way the mobile reader's send-to-share does.
  const togglePick = (key: string) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  const toggleOpen = (c: number) =>
    setOpen((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));

  // Turn the chosen verses into share-card entries (with any per-verse note).
  // Rich (HTML) notes flatten to clean text for the canvas card.
  const flattenRich = (raw: string) => {
    if (!/<[a-z]/i.test(raw)) return raw.trim();
    const el = document.createElement("div");
    el.innerHTML = raw.replace(/<(br|\/p|\/li|\/h1|\/h2|\/blockquote)[^>]*>/gi, "\n");
    return (el.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  };
  // The study's synthesis — the exact key Outline saves it under.
  const chapterNames = compileTabs.map((t) => {
    const book = vols[t.volume].books[t.book];
    return book.book + " " + book.chapters[t.chapter].chapter;
  });
  const synthKey = "synthesis|" + chapterNames.join("+");
  // Two readings of the same note. The card gets it RAW, because the canvas
  // now lays a synthesis out block by block and keeps its headings, dividers
  // and lists. The cover blurb gets it flattened — it is a clamped teaser, and
  // structure there would only be truncated mid-shape.
  const synthHtml = notes[synthKey] || "";
  const synthText = richToText(synthHtml);

  // all = every marked verse in the compilation (the whole-study share);
  // otherwise just what the user picked.
  const buildEntries = (all?: boolean): VersesCardEntry[] => {
    const entries: VersesCardEntry[] = [];
    groups.forEach((g) => {
      g.verses.forEach((v) => {
        if (!all && !picked.includes(keyFor(g.color, v.reference))) return;
        const chRef = chapterRefOf.get(v.reference) || "";
        const noteKey = "note|" + chRef + "|c" + g.color + "|" + v.reference;
        const rawNote = notes[noteKey] || "";
        // Rich (HTML) notes flatten to clean text for the share image.
        const note = (/<[a-z]/i.test(rawNote)
          ? (() => {
              const el = document.createElement("div");
              el.innerHTML = rawNote.replace(/<(br|\/p|\/li|\/h1|\/h2|\/blockquote)[^>]*>/gi, "\n");
              return (el.textContent || "").replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n");
            })()
          : rawNote
        ).trim();
        const info = verseInfo.get(v.reference);
        entries.push({
          reference: v.reference,
          theme: g.name,
          color: g.color,
          phrases: v.phrases,
          note: note || undefined,
          view,
          fullText: info ? info.text : undefined,
          verseNumber: info ? info.verse : undefined,
          marks: v.marks,
          glosses: glossesFor(tagsFor(v.reference)),
        });
      });
    });
    return entries;
  };

  // Live page count so the header can say what the share will actually be.
  const pickedCount = picked.length;
  const allCount = groups.reduce((s, g) => s + g.verses.length, 0);

  if (previewing) {
    const whole = previewing === "study";
    return (
      <SharePreview
        C={C}
        appDark={dark}
        kind={whole ? "study" : "verses"}
        verses={buildEntries(whole)}
        comp={
          whole
            ? buildStudySummary({
                marks: relevant,
                colorLabels,
                orderOf: (r) => orderOf.get(r) || 0,
                title: studyName,
                synthesis: synthText,
              })
            : undefined
        }
        syntheses={
          synthText ? [{ theme: "Synthesis", color: 6, text: synthHtml }] : []
        }
        title={studyName}
        marksToggle
        onClose={() =>
          initialMode === "study" ? onClose() : setPreviewing(null)
        }
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
            flexDirection: "column",
            gap: "12px",
            padding: "16px 18px",
            borderBottom: "1px solid " + C.border,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "16px", fontWeight: 700 }}>
                Choose verses to share
              </div>
              <div style={{ fontSize: "12px", color: C.muted }}>
                {/* No cap any more — a big pick becomes a PDF. Say which it
                    will be, so "Create image" never surprises (SCR-16). */}
                {pickedCount === 0
                  ? allCount +
                    (allCount === 1 ? " marked verse" : " marked verses") +
                    " in this study"
                  : pickedCount +
                    " picked · shares as " +
                    (pickedCount > 4 ? "a PDF" : "one card")}
              </div>
            </div>
            <button
              onClick={() => setView((v) => (v === "full" ? "focused" : "full"))}
              title="Full shows the whole verse with your marks on it; Focused shows the marked phrases alone"
              style={pill(C, false)}
            >
              {view === "full" ? "Full verses" : "Focused"}
            </button>
            <button onClick={onClose} aria-label="Cancel" style={pill(C, false)}>
              Cancel
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              onClick={() => picked.length > 0 && setPreviewing("verses")}
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
              onClick={() => allCount > 0 && setPreviewing("study")}
              disabled={allCount === 0}
              title="The summary card, then every marked verse"
              style={{
                ...pill(C, allCount === 0),
                fontWeight: 600,
              }}
            >
              Share whole study →
            </button>
          </div>
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
