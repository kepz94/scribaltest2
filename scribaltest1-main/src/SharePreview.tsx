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
  prefersOsShare,
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
    versesCardHeight({ verses: vs, dark }),
  // The leading page carries the synthesis as well as its verses, so it is a
  // different measurement from every other page. Measuring it like the rest
  // packed it full and then bolted the synthesis on top: page 1 of a study
  // share came out around 1:2.4 — the unshareable sliver this packer exists to
  // prevent — while every page behind it obeyed the target. Defaults to
  // `measure`, so a share with no synthesis packs exactly as before.
  measureFirst: (vs: VersesCardEntry[]) => number = measure
): VersesCardEntry[][] {
  const pages: VersesCardEntry[][] = [];
  let page: VersesCardEntry[] = [];
  for (let i = verses.length - 1; i >= 0; i--) {
    const trial = [verses[i], ...page];
    // Packing backwards means the page still open when i reaches 0 IS the
    // leading page — the only point where the synthesis has to be counted.
    const lead = i === 0;
    const fits =
      trial.length <= MAX_PER_CARD &&
      (lead ? measureFirst(trial) : measure(trial)) <= CARD_TARGET_H;
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
  synthesis?: string;
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
  // If a synthesis exists it ships by default — picking a few core verses to
  // send alongside your conclusion is a normal thing to want, and having to
  // find a chip for it every time is not. The chip still turns it off.
  const [showSynthesis, setShowSynthesis] = useState(
    kind === "study" ||
      (!!syntheses && syntheses.some((x) => (x.text || "").trim().length > 0))
  );
  const [showMarks, setShowMarks] = useState(true);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  // Which page the preview is showing. A share is a document, and you should be
  // able to read all of it before you send it — not just page 1 and a promise.
  // Pages render on demand rather than all at once: a fifty-page study would
  // otherwise hold fifty full-size bitmaps in memory on a phone.
  const [pageIdx, setPageIdx] = useState(0);

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
  // Packing and sizing are circular: a lone verse grows its type to fill a card,
  // so measuring at natural size says two verses won't fit — then the page is
  // drawn at the smaller uniform size and sits mostly empty. So pack twice: once
  // to learn the document's size, then again measuring at THAT size, which is
  // what will actually be drawn. The second pass is stable (the size is forced,
  // so it can't shift again).
  const pages = useMemo(() => {
    if (kind !== "verses" && kind !== "study") return [];
    // What the leading page will actually carry, so it is packed against its
    // real height rather than its verses alone.
    const lead =
      showSynthesis && !!syntheses && syntheses.some((s) => s.text.trim());
    // Measure a page exactly as it will be DRAWN — same notes, same title, and
    // the synthesis on the leading page. The packer used to measure with none
    // of them (showNotes defaults to false in the renderer), so every page was
    // sized as if its notes weren't there and could overflow the target by
    // however much they added.
    const height = (vs: VersesCardEntry[], withSynth: boolean, size?: number) =>
      versesCardHeight({
        verses: vs,
        dark: cardDark,
        title,
        sizeOverride: size,
        showNotes,
        showSynthesis: withSynth,
        syntheses,
      });
    const first = packPages(
      effVerses,
      cardDark,
      (vs) => height(vs, false),
      (vs) => height(vs, lead)
    );
    if (first.length < 2) return first;
    const size = pdfProseSize(
      first,
      (vs) =>
        versesCardMetrics({ verses: vs, dark: cardDark, title, showNotes }).size
    );
    if (!size) return first;
    return packPages(
      effVerses,
      cardDark,
      (vs) => height(vs, false, size),
      (vs) => height(vs, lead, size)
    );
  }, [kind, effVerses, cardDark, title, showNotes, showSynthesis, syntheses]);
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
            (vs) =>
              versesCardMetrics({
                verses: vs,
                dark: cardDark,
                title,
                showNotes,
              }).size
          )
        : undefined,
    [pdfMode, pages, cardDark, title, showNotes]
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
      synthesis: comp.synthesis,
      dark: cardDark,
    });
  };

  const build = (): HTMLCanvasElement | null => {
    if (kind === "verse" && verse) {
      return renderVerseCard({ ...verse, dark: cardDark });
    }
    if ((kind === "study" || kind === "verses") && verses) {
      // Page 0 of a study PDF is its cover; the verse pages follow it.
      if (coverPage && pageIdx === 0) return buildCover();
      const vi = coverPage ? pageIdx - 1 : pageIdx;
      return renderVersesCard({
        verses: pages[vi] || pages[0] || [],
        dark: cardDark,
        showNotes,
        // Exactly the rule the PDF builder uses: the synthesis leads, so it
        // rides on the first page of verses and nowhere else.
        showSynthesis: showSynthesis && (!pdfMode || vi === 0),
        syntheses,
        title,
        sizeOverride: pdfSize,
      });
    }
    if (kind === "compilation" && comp) {
      return buildCover();
    }
    return null;
  };

  // A toggle can change how many pages there are; never leave the reader
  // parked past the end of the document.
  useEffect(() => {
    if (pageIdx > pageCount - 1) setPageIdx(Math.max(0, pageCount - 1));
  }, [pageCount, pageIdx]);

  useEffect(() => {
    const c = build();
    if (c) setUrl(canvasURL(c));
    // eslint: re-render preview when inputs change
  }, [cardDark, featured, kind, showNotes, showSynthesis, showMarks, pages, verses, syntheses, pageIdx]);

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
        onFlash("PDF saved to your downloads");
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
    if (r === "copied") {
      onFlash("Card copied — paste it anywhere");
      onClose();
    } else if (r === "downloaded") {
      onFlash("Card saved to your downloads");
      onClose();
    } else if (r === "failed") {
      onFlash("Couldn't create image");
    } else {
      onClose();
    }
  };

  // The pager sits on the dimmed backdrop, not on the panel, so it takes its
  // colors from the overlay rather than the app theme.
  const pageArrow = (off: boolean) => ({
    width: "34px",
    height: "34px",
    flex: "0 0 auto",
    borderRadius: "50%",
    border: "none",
    background: off ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.9)",
    color: off ? "rgba(255,255,255,0.35)" : "#111",
    fontSize: "20px",
    lineHeight: "34px",
    padding: 0,
    cursor: off ? "default" : "pointer",
    fontFamily: "inherit",
  });
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
  // Whether the OS share sheet is worth offering — a touch device. Decides the
  // button's wording as well as what pressing it does.
  const osShare = prefersOsShare();

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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              width: "100%",
            }}
          >
            {pageCount > 1 && (
              <button
                onClick={() => setPageIdx((n) => Math.max(0, n - 1))}
                disabled={pageIdx === 0}
                aria-label="Previous page"
                style={pageArrow(pageIdx === 0)}
              >
                {"‹"}
              </button>
            )}
            <img
              src={url}
              alt={
                pageCount > 1
                  ? "Share preview, page " + (pageIdx + 1) + " of " + pageCount
                  : "Share preview"
              }
              style={{
                width: pageCount > 1 ? "68%" : "78%",
                maxWidth: "300px",
                borderRadius: "14px",
                boxShadow: "0 14px 44px rgba(0,0,0,0.45)",
              }}
            />
            {pageCount > 1 && (
              <button
                onClick={() =>
                  setPageIdx((n) => Math.min(pageCount - 1, n + 1))
                }
                disabled={pageIdx >= pageCount - 1}
                aria-label="Next page"
                style={pageArrow(pageIdx >= pageCount - 1)}
              >
                {"›"}
              </button>
            )}
          </div>
        ) : (
          <div style={{ color: "#fff", padding: "40px" }}>Rendering…</div>
        )}

        {pageCount > 1 && (
          // Every page is reachable: arrows for one at a time, dots to jump.
          <div
            data-share-pager=""
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "8px",
              marginTop: "-6px",
            }}
          >
            <div
              style={{
                color: "rgba(255,255,255,0.9)",
                fontSize: "12.5px",
                fontWeight: 600,
                letterSpacing: "0.03em",
              }}
            >
              {coverPage && pageIdx === 0
                ? "Cover · page 1 of " + pageCount
                : "Page " + (pageIdx + 1) + " of " + pageCount}
            </div>
            <div
              style={{
                display: "flex",
                gap: "6px",
                flexWrap: "wrap",
                justifyContent: "center",
                maxWidth: "300px",
              }}
            >
              {Array.from({ length: pageCount }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setPageIdx(i)}
                  aria-label={"Page " + (i + 1)}
                  style={{
                    width: i === pageIdx ? "22px" : "8px",
                    height: "8px",
                    borderRadius: "4px",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    background:
                      i === pageIdx
                        ? "rgba(255,255,255,0.95)"
                        : "rgba(255,255,255,0.38)",
                    transition: "width 0.15s ease",
                  }}
                />
              ))}
            </div>
          </div>
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
            {/* Name the actual outcome. On a desktop this saves a PDF or puts
                the card on the clipboard; "Share" promised a sheet that had
                nothing useful behind it. */}
            {busy
              ? pdfMode
                ? "Building PDF…"
                : osShare
                ? "Sharing…"
                : "Copying…"
              : pdfMode
              ? (osShare ? "Create PDF (" : "Save PDF (") + pageCount + " pages)"
              : osShare
              ? "Share"
              : "Copy card"}
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
