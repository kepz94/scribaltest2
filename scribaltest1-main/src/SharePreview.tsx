import { useEffect, useMemo, useState } from "react";
import {
  renderVerseCard,
  renderCompilationCard,
  renderVersesCard,
  versesCardHeight,
  versesCardMetrics,
  canvasURL,
  shareCanvas,
  CARD_TARGET_H,
  MAX_PER_CARD,
  CompTheme,
  VersesCardEntry,
  VersesSynthesis,
} from "./shareCard";
import { canvasesToPdf, sharePdf } from "./sharePdf";

// Past this many pages the PDF is big enough to say so before it is built.
const BIG_PDF_PAGES = 30;

// How many verses fit on one card is a question of height, not count: a card
// grows to fit its verses, and past CARD_TARGET_H it stops having shareable
// proportions. So ask the renderer to measure each candidate before committing
// it to a page. Packing runs BACKWARDS so any short page lands first rather
// than leaving a single orphaned verse on the last one.
export function packPages(
  verses: VersesCardEntry[],
  dark: boolean,
  // Injectable so tests can pack against known heights — jsdom has no canvas,
  // where the real renderer can only ever report the minimum.
  measure: (vs: VersesCardEntry[]) => number = (vs) =>
    versesCardHeight({ verses: vs, dark })
): VersesCardEntry[][] {
  const pages: VersesCardEntry[][] = [];
  let page: VersesCardEntry[] = [];
  for (let i = verses.length - 1; i >= 0; i--) {
    const trial = [verses[i], ...page];
    const fits = trial.length <= MAX_PER_CARD && measure(trial) <= CARD_TARGET_H;
    // A single verse always gets its own page even when it overflows on its
    // own — there is nothing left to split.
    if (!fits && page.length > 0) {
      pages.unshift(page);
      page = [verses[i]];
    } else {
      page = trial;
    }
  }
  if (page.length) pages.unshift(page);
  return pages;
}

// One prose size for the whole document: the smallest any single page needed.
// Left to itself each card sizes independently, which reads as sloppy the
// moment you flip between pages.
export function pdfProseSize(
  pages: VersesCardEntry[][],
  measureSize: (vs: VersesCardEntry[]) => number
): number | undefined {
  if (pages.length === 0) return undefined;
  return pages.reduce(
    (min, page) => Math.min(min, measureSize(page)),
    Infinity
  );
}

interface CC {
  bg: string;
  panel: string;
  soft: string;
  text: string;
  muted: string;
  border: string;
}

interface VerseData {
  phrase: string;
  reference: string;
  theme: string;
  style: string;
  color: number;
}
interface CompData {
  scopeTitle: string;
  studyLabel: string;
  dateStr: string;
  totalMarks: number;
  passages: number;
  themes: CompTheme[];
  candidates: { text: string; reference: string; style: string; color: number }[];
  defaultFeatured: number;
}

interface Props {
  C: CC;
  appDark: boolean;
  // "study" is the whole thing: the summary card as a cover, then every marked
  // verse behind it. It needs both comp and verses.
  kind: "verse" | "compilation" | "verses" | "study";
  verse?: VerseData;
  comp?: CompData;
  verses?: VersesCardEntry[];
  syntheses?: VersesSynthesis[];
  // Show a "Markings" on/off chip (reader-share flow): off strips the marks
  // so the card carries clean verse text.
  marksToggle?: boolean;
  // The study's name, printed under the masthead on every card so a multi-page
  // share reads as one document.
  title?: string;
  onClose: () => void;
  onFlash: (m: string) => void;
}

export default function SharePreview({
  C,
  appDark,
  kind,
  verse,
  comp,
  verses,
  syntheses,
  marksToggle,
  title,
  onClose,
  onFlash,
}: Props) {
  const [cardDark, setCardDark] = useState(appDark);
  const [featured, setFeatured] = useState(comp ? comp.defaultFeatured : 0);
  const [showNotes, setShowNotes] = useState(true);
  const [showSynthesis, setShowSynthesis] = useState(false);
  const [showMarks, setShowMarks] = useState(true);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const hasNotes = !!verses && verses.some((v) => (v.note || "").trim());
  const hasSynth = !!syntheses && syntheses.some((s) => s.text.trim());

  // The verses as the card should draw them (markings stripped when toggled off).
  const effVerses = useMemo(
    (): VersesCardEntry[] =>
      (verses || []).map((v) =>
        marksToggle && !showMarks ? { ...v, marks: [] } : v
      ),
    [verses, marksToggle, showMarks]
  );
  // Measuring every candidate card is the expensive part, so pack once per
  // change rather than on each render.
  const pages = useMemo(
    () =>
      kind === "verses" || kind === "study"
        ? packPages(effVerses, cardDark)
        : [],
    [kind, effVerses, cardDark]
  );
  // More than one card's worth → a multi-page PDF of card-pages. A whole study
  // that outgrows one card gets the summary card as its cover page too.
  const pdfMode = pages.length > 1;
  const coverPage = kind === "study" && pdfMode && !!comp;
  const pageCount = pages.length + (coverPage ? 1 : 0);
  // Every page of a PDF is set at the same prose size — the smallest any single
  // page needed. Left to itself each card sizes independently, which reads as
  // sloppy once you flip between them.
  const pdfSize = useMemo(
    () =>
      pdfMode
        ? pdfProseSize(
            pages,
            (vs) => versesCardMetrics({ verses: vs, dark: cardDark, title }).size
          )
        : undefined,
    [pdfMode, pages, cardDark, title]
  );

  const buildCover = (): HTMLCanvasElement | null => {
    if (!comp) return null;
    const hero =
      comp.candidates.length > 0
        ? comp.candidates[
            Math.max(0, Math.min(featured, comp.candidates.length - 1))
          ]
        : null;
    return renderCompilationCard({
      scopeTitle: comp.scopeTitle,
      studyLabel: comp.studyLabel,
      dateStr: comp.dateStr,
      totalMarks: comp.totalMarks,
      passages: comp.passages,
      hero,
      themes: comp.themes,
      dark: cardDark,
    });
  };

  const build = (): HTMLCanvasElement | null => {
    if (kind === "verse" && verse) {
      return renderVerseCard({ ...verse, dark: cardDark });
    }
    if (kind === "study" && verses) {
      // The preview shows what ships first: the cover if there is one,
      // otherwise the single card this study fits on.
      return coverPage
        ? buildCover()
        : renderVersesCard({
            verses: pages[0] || [],
            dark: cardDark,
            showNotes,
            showSynthesis,
            syntheses,
            title,
            sizeOverride: pdfSize,
          });
    }
    if (kind === "verses" && verses) {
      return renderVersesCard({
        verses: pages[0] || [],
        dark: cardDark,
        title,
        sizeOverride: pdfSize,
        showNotes,
        showSynthesis,
        syntheses,
      });
    }
    if (kind === "compilation" && comp) {
      return buildCover();
    }
    return null;
  };

  useEffect(() => {
    const c = build();
    if (c) setUrl(canvasURL(c));
    // eslint: re-render preview when inputs change
  }, [cardDark, featured, kind, showNotes, showSynthesis, showMarks, pages, verses, syntheses]);

  const doShare = async () => {
    setBusy(true);
    const caption =
      kind === "verse" && verse
        ? verse.phrase + " — " + verse.reference
        : kind === "verses" && verses
        ? verses.map((v) => v.reference).join(", ") + " — Scribal"
        : comp
        ? comp.scopeTitle +
          (comp.studyLabel.trim() ? " · " + comp.studyLabel.trim() : "") +
          " — a study in Scribal"
        : "Scribal";

    if (pdfMode) {
      // Each page is the same rendered card; the whole set ships as one PDF.
      // Yield between pages so a long study doesn't freeze the phone while it
      // rasterizes — nothing is ever dropped to keep the count down.
      const canvases: HTMLCanvasElement[] = [];
      const cover = coverPage ? buildCover() : null;
      if (cover) canvases.push(cover);
      for (let i = 0; i < pages.length; i++) {
        canvases.push(
          renderVersesCard({
            verses: pages[i],
            dark: cardDark,
            showNotes,
            // The synthesis LEADS the study — that is where the outline puts
            // it, so that is where a shared study puts it too.
            showSynthesis: showSynthesis && i === 0,
            syntheses,
            title,
            sizeOverride: pdfSize,
          })
        );
        if (pages.length > 4) await new Promise((r) => setTimeout(r, 0));
      }
      const blob = canvasesToPdf(canvases);
      const r = blob
        ? await sharePdf(
            blob,
            kind === "study" ? "scribal-study.pdf" : "scribal-verses.pdf",
            caption
          )
        : "failed";
      setBusy(false);
      if (r === "downloaded") {
        onFlash("PDF saved");
        onClose();
      } else if (r === "failed") {
        onFlash("Couldn't create PDF");
      } else {
        onClose();
      }
      return;
    }

    const c = build();
    if (!c) {
      setBusy(false);
      onFlash("Couldn't create image");
      return;
    }
    const r = await shareCanvas(
      c,
      kind === "verse"
        ? "scribal-verse.png"
        : kind === "verses"
        ? "scribal-verses.png"
        : "scribal-study.png",
      caption
    );
    setBusy(false);
    if (r === "downloaded") {
      onFlash("Image saved");
      onClose();
    } else if (r === "failed") {
      onFlash("Couldn't create image");
    } else {
      onClose();
    }
  };

  const seg = (on: boolean) => ({
    flex: 1,
    padding: "10px",
    borderRadius: "9px",
    border: "1px solid " + C.border,
    background: on ? C.text : "transparent",
    color: on ? C.bg : C.text,
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  });
  const cyc = {
    width: "40px",
    height: "40px",
    borderRadius: "9px",
    border: "1px solid " + C.border,
    background: "transparent",
    color: C.text,
    fontSize: "20px",
    cursor: "pointer",
    fontFamily: "inherit",
    flexShrink: 0,
  } as const;

  const candCount = comp ? comp.candidates.length : 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        animation: "mob-fadein 0.18s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "360px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "16px",
        }}
      >
        {url ? (
          <img
            src={url}
            alt="Share preview"
            style={{
              width: "78%",
              maxWidth: "300px",
              borderRadius: "14px",
              boxShadow: "0 14px 44px rgba(0,0,0,0.45)",
            }}
          />
        ) : (
          <div style={{ color: "#fff", padding: "40px" }}>Rendering…</div>
        )}

        <div
          style={{
            width: "100%",
            background: C.panel,
            color: C.text,
            borderRadius: "16px",
            padding: "14px",
            boxShadow: "0 -2px 20px rgba(0,0,0,0.2)",
          }}
        >
          {(kind === "compilation" || coverPage) && candCount > 0 && (
            <>
              <div
                style={{
                  fontSize: "11px",
                  color: C.muted,
                  marginBottom: "8px",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Featured verse
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  marginBottom: "14px",
                }}
              >
                <button
                  onClick={() =>
                    setFeatured((f) => (f - 1 + candCount) % candCount)
                  }
                  style={cyc}
                  aria-label="Previous verse"
                >
                  ‹
                </button>
                <div
                  style={{
                    flex: 1,
                    textAlign: "center",
                    fontSize: "13.5px",
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {comp!.candidates[
                    Math.max(0, Math.min(featured, candCount - 1))
                  ].reference}
                </div>
                <button
                  onClick={() => setFeatured((f) => (f + 1) % candCount)}
                  style={cyc}
                  aria-label="Next verse"
                >
                  ›
                </button>
              </div>
            </>
          )}

          {(kind === "verses" || kind === "study") && (hasNotes || hasSynth) && (
            <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
              {hasNotes && (
                <button
                  onClick={() => setShowNotes((s) => !s)}
                  style={seg(showNotes)}
                >
                  {showNotes ? "\u2713 Notes" : "Notes"}
                </button>
              )}
              {hasSynth && (
                <button
                  onClick={() => setShowSynthesis((s) => !s)}
                  style={seg(showSynthesis)}
                >
                  {showSynthesis ? "\u2713 Synthesis" : "Synthesis"}
                </button>
              )}
            </div>
          )}

          {(kind === "verses" || kind === "study") && marksToggle && (
            <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
              <button
                onClick={() => setShowMarks((s) => !s)}
                style={seg(showMarks)}
                data-share-marks=""
              >
                {showMarks ? "\u2713 Markings" : "Markings"}
              </button>
            </div>
          )}

          {pdfMode && verses && (
            <div
              data-share-pdfnote=""
              style={{
                fontSize: "12px",
                color: C.muted,
                textAlign: "center",
                marginBottom: "10px",
              }}
            >
              {verses.length} verses {"\u00b7"} shares as a PDF ({pageCount} pages)
              {" \u2014 preview shows page 1"}
              {pageCount > BIG_PDF_PAGES && (
                <div style={{ marginTop: "4px" }}>
                  That{"\u2019"}s a large file {"\u2014"} it may take a moment to build.
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
            <button onClick={() => setCardDark(false)} style={seg(!cardDark)}>
              Light
            </button>
            <button onClick={() => setCardDark(true)} style={seg(cardDark)}>
              Dark
            </button>
          </div>

          <button
            onClick={doShare}
            disabled={busy}
            style={{
              width: "100%",
              padding: "14px",
              borderRadius: "10px",
              border: "none",
              background: C.text,
              color: C.bg,
              fontSize: "15px",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              opacity: busy ? 0.6 : 1,
              marginBottom: "8px",
            }}
          >
            {busy
              ? pdfMode
                ? "Building PDF…"
                : "Sharing…"
              : pdfMode
              ? "Create PDF (" + pageCount + " pages)"
              : "Share"}
          </button>
          <button
            onClick={onClose}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: "10px",
              border: "1px solid " + C.border,
              background: "transparent",
              color: C.text,
              fontSize: "13px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
