// Renders beautiful, social-ready PNG cards for a verse or a compilation.
// Rendering (-> canvas, for live preview) is separate from sharing (-> share
// sheet / download), so the UI can show a preview before committing.

import {
  richToBlocks,
  richToParagraphs,
  RichBlockKind,
  RichRun,
} from "./richText";

export type ShareResult =
  | "shared"
  | "copied"
  | "downloaded"
  | "cancelled"
  | "failed";

// The OS share sheet is a phone affordance. A desktop Chrome still advertises
// canShare({ files }), so every share went to a sheet offering little more than
// an email list and a copy button that pastes nothing — and the download
// fallback underneath it was unreachable. On a desktop, sharing means the
// clipboard and the file system; the sheet is only worth opening on a touch
// device, where it reaches Messages, Notes and the rest.
export function prefersOsShare(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return true;
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return true;
  }
}

// Put a blob on the clipboard. Desktop-only path: it needs a secure context, a
// focused document, and ClipboardItem — any of which can be missing, so the
// caller always has a download to fall back to.
async function copyBlob(blob: Blob, type: string): Promise<boolean> {
  try {
    const w = window as any;
    if (!w.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write)
      return false;
    await navigator.clipboard.write([new w.ClipboardItem({ [type]: blob })]);
    return true;
  } catch {
    return false;
  }
}

function downloadBlob(blob: Blob, filename: string): ShareResult {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return "downloaded";
  } catch {
    return "failed";
  }
}

// The definition accent, shared with the reader and the note editor.
const DEF_SPINE = "#9a7b4f";

const W = 1080;
const H = 1350;

// How much a single card may carry. A card grows to fit its verses, so the
// real limit is height, not count: past CARD_TARGET_H the card stops being a
// card and becomes a scroll (five full verses measure ~2450px — a 1:2.3 sliver
// that any feed scales down to nothing). H is the design height (4:5 portrait);
// the target allows one verse of tolerance past it. MAX_PER_CARD is the
// backstop for short focused snippets, which would otherwise pile up.
export const MAX_PER_CARD = 6;
export const CARD_TARGET_H = 1500;
const CARD_MIN_H = 1080; // a light card is never shorter than this
const CARD_MAX_H = 2600; // a heavy card is never taller than this
const SERIF = '"Times New Roman", Georgia, "Hoefler Text", serif';
const SANS = '-apple-system, "Segoe UI", Roboto, system-ui, sans-serif';

// Card-local color tables (so cards can switch light/dark independently of app).
// These mirror the app's --penN / --hlN CSS variables (which the canvas can't
// read) for all ten palette colors, light and dark.
const PEN_LIGHT = ["", "#d11a2a", "#e07b1a", "#c9a200", "#2f8f3e", "#2f6fb0", "#7b4fbf", "#1a1a1a", "#d6448c", "#5fa515", "#0e9aab"];
const PEN_DARK = ["", "#ff7b72", "#f0a24b", "#e3c341", "#5fcf6b", "#7cb0e8", "#b794f6", "#f2efe8", "#f48fb1", "#b4e052", "#4dd0e1"];
const HL_LIGHT = ["", "#ffd6d6", "#ffe2c2", "#fbedb0", "#d3f0d6", "#cfe2f7", "#e6d9f7", "#e0e0e0", "#fcd9ea", "#e8f5c4", "#c9f0f5"];
const HL_DARK = ["", "#5c2b2e", "#5c3f1f", "#5a4a1c", "#1f4d2a", "#243d56", "#3d2b5c", "#3f3e3a", "#5a2742", "#3a4a12", "#134048"];
const penHex = (c: number, dark: boolean) => (dark ? PEN_DARK : PEN_LIGHT)[c] || "#888888";
const hlHex = (c: number, dark: boolean) => (dark ? HL_DARK : HL_LIGHT)[c] || "#dddddd";

interface Palette {
  bg: string;
  bg2: string;
  text: string;
  muted: string;
  frame: string;
}
const lightCard: Palette = {
  bg: "#f4ead4",
  bg2: "#efe3c8",
  text: "#241f17",
  muted: "#8a8068",
  frame: "rgba(36,31,23,0.14)",
};
const darkCard: Palette = {
  bg: "#171410",
  bg2: "#1f1b15",
  text: "#ece4d4",
  muted: "#9a9180",
  frame: "rgba(236,228,212,0.16)",
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  words.forEach((w0) => {
    const test = line ? line + " " + w0 : w0;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w0;
    } else {
      line = test;
    }
  });
  if (line) lines.push(line);
  return lines;
}

// Limit wrapped lines to a maximum, adding an ellipsis to the last shown line.
function clampLines(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = kept[max - 1].replace(/[\s.,;:]+$/, "") + "\u2026";
  return kept;
}

function paintBackground(ctx: CanvasRenderingContext2D, p: Palette, h = H) {
  const g = ctx.createLinearGradient(0, 0, W, h);
  g.addColorStop(0, p.bg);
  g.addColorStop(1, p.bg2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, h);
  ctx.strokeStyle = p.frame;
  ctx.lineWidth = 2;
  roundRect(ctx, 46, 46, W - 92, h - 92, 26);
  ctx.stroke();
}

function paintBrand(
  ctx: CanvasRenderingContext2D,
  p: Palette,
  accent: string,
  h = H
) {
  // Footer signature: the "S" monogram + a one-line descriptor, centered.
  const cx = W / 2;
  const y = h - 110;
  const s = 40;
  const gap = 15;
  const tracking = 2;
  const tagline = "A PLACE TO STUDY SCRIPTURE";
  ctx.save();
  ctx.font = "600 19px " + SANS;
  const tagW =
    Array.from(tagline).reduce(
      (acc, ch) => acc + ctx.measureText(ch).width + tracking,
      0
    ) - tracking;
  const totalW = s + gap + tagW;
  const startX = cx - totalW / 2;
  const tileY = y - s / 2;
  ctx.fillStyle = p.text;
  roundRect(ctx, startX, tileY, s, s, 11);
  ctx.fill();
  ctx.fillStyle = p.bg;
  ctx.font = "700 23px " + SERIF;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("S", startX + s / 2, y + 1);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(startX + s - 6, tileY + 6, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = p.muted;
  ctx.font = "600 19px " + SANS;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  drawTrackedLeft(ctx, tagline, startX + s + gap, y + 1, tracking);
  ctx.restore();
}

// How much taller the header is once a study name rides under the rule.
const TITLE_BAND = 38;

// Top nameplate so the card reads "Scribal" the instant it is seen. `title`
// names the study beneath the rule — a page of a multi-page study has to say
// which study it belongs to, or the pages don't read as one document.
function paintMasthead(
  ctx: CanvasRenderingContext2D,
  p: Palette,
  accent: string,
  title?: string
) {
  const cx = W / 2;
  ctx.save();
  ctx.fillStyle = p.text;
  ctx.font = "700 33px " + SERIF;
  ctx.textBaseline = "alphabetic";
  drawTracked(ctx, "SCRIBAL", cx, 106, 8);
  // a hairline rule split by a small accent "jewel"
  const ry = 130;
  const half = 92;
  ctx.strokeStyle = p.frame;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - half, ry);
  ctx.lineTo(cx - 13, ry);
  ctx.moveTo(cx + 13, ry);
  ctx.lineTo(cx + half, ry);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, ry, 4.5, 0, Math.PI * 2);
  ctx.fill();
  if (title && title.trim()) {
    ctx.fillStyle = p.muted;
    ctx.font = "600 22px " + SANS;
    ctx.textAlign = "center";
    drawTracked(ctx, clampToWidth(ctx, title.trim().toUpperCase(), W - 260, 3), cx, ry + TITLE_BAND, 3);
  }
  ctx.restore();
}

// Tracked text has no measureText, so trim to width by character and ellipsize.
function clampToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  tracking: number
): string {
  const widthOf = (s: string) =>
    Array.from(s).reduce((a, ch) => a + ctx.measureText(ch).width + tracking, 0) -
    tracking;
  if (widthOf(text) <= maxW) return text;
  let out = text;
  while (out.length > 1 && widthOf(out + "…") > maxW) out = out.slice(0, -1);
  return out.replace(/\s+$/, "") + "…";
}

function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  tracking: number
) {
  const chars = Array.from(text);
  const widths = chars.map((ch) => ctx.measureText(ch).width + tracking);
  const total = widths.reduce((a, b) => a + b, 0) - tracking;
  let x = cx - total / 2;
  const prev = ctx.textAlign;
  ctx.textAlign = "left";
  chars.forEach((ch, i) => {
    ctx.fillText(ch, x, y);
    x += widths[i];
  });
  ctx.textAlign = prev;
}

function drawTrackedLeft(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number
) {
  const chars = Array.from(text);
  let cx = x;
  chars.forEach((ch) => {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  });
}

function newCanvas(h = H): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext("2d") };
}

// ---------- Verse card ----------
export interface VerseCardOpts {
  phrase: string;
  reference: string;
  theme: string;
  style: string;
  color: number;
  dark: boolean;
}

export function renderVerseCard(o: VerseCardOpts): HTMLCanvasElement {
  const p = o.dark ? darkCard : lightCard;
  const accent = penHex(o.color, o.dark);
  const highlight = hlHex(o.color, o.dark);
  const { canvas, ctx } = newCanvas();
  if (!ctx) return canvas;

  paintBackground(ctx, p);
  paintMasthead(ctx, p, accent);
  const padX = 130;
  const maxW = W - padX * 2;

  let topY = 215;
  if (o.theme.trim()) {
    ctx.fillStyle = accent;
    ctx.font = "700 26px " + SANS;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    drawTracked(ctx, o.theme.trim().toUpperCase(), W / 2, topY, 4);
    topY += 34;
  }
  ctx.fillStyle = accent;
  ctx.fillRect(W / 2 - 32, topY, 64, 4);

  const bold = o.style === "bold";
  const italic = o.style === "italic";
  const weight = bold ? "700" : "500";
  const ital = italic ? "italic " : "";
  const sizes = [78, 72, 66, 60, 54, 48, 42, 38, 34];
  let chosen = sizes[sizes.length - 1];
  let lines: string[] = [];
  const HERO_MAX_H = 600;
  for (const sz of sizes) {
    ctx.font = ital + weight + " " + sz + "px " + SERIF;
    const ls = wrap(ctx, o.phrase, maxW);
    chosen = sz;
    lines = ls;
    if (ls.length * sz * 1.3 <= HERO_MAX_H) break;
  }
  ctx.font = ital + weight + " " + chosen + "px " + SERIF;
  const lineH = chosen * 1.32;
  const blockH = lines.length * lineH;
  const centerY = 660;
  let y = centerY - blockH / 2 + chosen * 0.5;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  lines.forEach((ln) => {
    const tw = ctx.measureText(ln).width;
    if (o.style === "highlight") {
      ctx.fillStyle = highlight;
      roundRect(ctx, W / 2 - tw / 2 - 14, y - chosen + chosen * 0.18, tw + 28, chosen * 1.12, 8);
      ctx.fill();
    }
    ctx.fillStyle =
      o.style === "bold" || o.style === "italic" ? accent : p.text;
    ctx.fillText(ln, W / 2, y);
    if (o.style === "underline") {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(W / 2 - tw / 2, y + 12);
      ctx.lineTo(W / 2 + tw / 2, y + 12);
      ctx.stroke();
    } else if (o.style === "circle") {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      roundRect(
        ctx,
        W / 2 - tw / 2 - 16,
        y - chosen + chosen * 0.14,
        tw + 32,
        chosen * 1.12,
        chosen * 0.55
      );
      ctx.stroke();
    }
    y += lineH;
  });

  const refY = centerY + blockH / 2 + 78;
  ctx.fillStyle = p.muted;
  ctx.font = "italic 36px " + SERIF;
  ctx.textAlign = "center";
  ctx.fillText("— " + o.reference, W / 2, refY);

  paintBrand(ctx, p, accent);
  return canvas;
}

// ---------- Multi-verse card: as many verses as fit, focused or full ----------
export interface VersesCardEntry {
  reference: string;
  theme: string;
  color: number;
  phrases: { text: string; style: string }[];
  note?: string;
  // The definitions the reader chose for words tagged in this verse, already
  // resolved to text — the canvas never loads the dictionary, and a shared card
  // has to carry its own meaning.
  glosses?: { word: string; n: number; text: string }[];
  // When the verse is shown in "full" mode, the card redraws the entire verse
  // with its marks layered on (exactly like the reading view) instead of only
  // the marked snippets. These carry that view; absent => focused snippets.
  view?: "focused" | "full";
  fullText?: string;
  verseNumber?: number;
  marks?: { startIndex: number; endIndex: number; style: string; color: number }[];
}
export interface VersesSynthesis {
  theme: string;
  color: number;
  text: string;
}
export interface VersesCardOpts {
  verses: VersesCardEntry[];
  dark: boolean;
  showNotes?: boolean;
  showSynthesis?: boolean;
  syntheses?: VersesSynthesis[];
  // The study this card belongs to, printed under the masthead. Set on every
  // page of a multi-page share so the pages read as one document.
  title?: string;
  // Force the prose size instead of letting the card pick its own. A PDF sets
  // one size for every page — type that changes page to page reads as sloppy.
  sizeOverride?: number;
}

export function renderVersesCard(o: VersesCardOpts): HTMLCanvasElement {
  return buildVersesCard(o, false) as HTMLCanvasElement;
}

// The same layout pass, stopped before it draws. The packer asks for the height
// before committing a verse to a page, so the fit rule and the renderer can
// never disagree about what fits; a PDF asks for the size so every page can be
// held to the smallest one any page needed.
export function versesCardMetrics(o: VersesCardOpts): {
  height: number;
  size: number;
} {
  return buildVersesCard(o, true) as { height: number; size: number };
}
export function versesCardHeight(o: VersesCardOpts): number {
  return versesCardMetrics(o).height;
}

function buildVersesCard(
  o: VersesCardOpts,
  measureOnly: boolean
): HTMLCanvasElement | { height: number; size: number } {
  const p = o.dark ? darkCard : lightCard;
  const { canvas, ctx } = newCanvas();
  if (!ctx) return measureOnly ? { height: CARD_MIN_H, size: 40 } : canvas;

  const verses = o.verses.slice(0, MAX_PER_CARD);
  const cardTitle = (o.title || "").trim();
  const showNotes = !!o.showNotes;
  const syntheses =
    o.showSynthesis && o.syntheses
      ? o.syntheses.filter((s) => s.text.trim())
      : [];
  const showSynth = syntheses.length > 0;

  const padX = 110;
  const barW = 6;
  const contentX = padX + 22; // text begins to the right of the accent bar
  const maxW = W - contentX - padX;
  const top = cardTitle ? 172 + TITLE_BAND : 172;
  const FOOTER_SPACE = 168; // room beneath the content for the brand footer
  const MIN_H = CARD_MIN_H;
  const MAX_H = CARD_MAX_H;

  const refSize = 27;
  const themeSize = 21;
  const headerGap = 16; // header block -> phrases
  const phraseGap = 10; // between phrases within one verse
  const verseGap = 38; // between verse blocks
  const noteGap = 10; // phrases -> note
  const synthTopGap = 30; // last verse -> synthesis rule
  const synthRuleGap = 18; // rule -> first synthesis
  const synthItemGap = 16; // between syntheses
  const synthLabelGap = 7; // synthesis theme label -> its text
  const synthParaGap = 12; // between paragraphs within one synthesis

  const fontFor = (style: string, size: number) => {
    const weight = style === "bold" ? "700" : "500";
    const ital = style === "italic" ? "italic " : "";
    return ital + weight + " " + size + "px " + SERIF;
  };
  const proseFont = (sz: number) => "italic 500 " + sz + "px " + SERIF;
  const lineMul = 1.4; // full-verse line height multiple

  // ---- synthesis layout: a note keeps the shape it was written in ----
  //
  // A synthesis is organized — headings, a divider between movements, numbered
  // steps, an emphasized clause. That organization IS the argument, so the card
  // honors it instead of flattening everything to italic prose. Sizes and gaps
  // are all relative to the prose size, so the same note reads the same whether
  // it is on a one-verse card or a fifty-page PDF.
  type SynthPiece = {
    text: string;
    font: string;
    x: number;
    w: number;
    u: boolean;
    chip: boolean;
  };
  type SynthLine = { pieces: SynthPiece[] };
  type SynthLaid = {
    kind: RichBlockKind;
    lines: SynthLine[];
    size: number;
    lineH: number;
    indent: number;
    gapBefore: number;
    gapAfter: number;
    marker?: string;
    markerFont?: string;
    height: number;
  };

  const runFont = (
    sz: number,
    r: RichRun,
    baseWeight: string,
    baseItalic: boolean
  ) =>
    (r.i || baseItalic ? "italic " : "") +
    (r.b ? "700" : baseWeight) +
    " " +
    sz +
    "px " +
    SERIF;

  // Word-level wrap that measures each run in its own font, so a bold clause
  // mid-sentence breaks in the right place instead of at the wrong width.
  const wrapRuns = (
    runs: RichRun[],
    sz: number,
    maxW: number,
    baseWeight: string,
    baseItalic: boolean
  ): SynthLine[] => {
    const lines: SynthLine[] = [];
    let cur: SynthPiece[] = [];
    let x = 0;
    const flush = () => {
      while (cur.length && !cur[cur.length - 1].text.trim()) cur.pop();
      if (cur.length) lines.push({ pieces: cur });
      cur = [];
      x = 0;
    };
    runs.forEach((r) => {
      const font = runFont(sz, r, baseWeight, baseItalic);
      r.text.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        const ws = /^\s+$/.test(part);
        if (ws && x === 0) return; // no leading space on a wrapped line
        ctx.font = font;
        const w = ctx.measureText(part).width;
        if (!ws && x + w > maxW && cur.length) {
          flush();
          ctx.font = font;
        }
        cur.push({ text: part, font, x, w, u: !!r.u, chip: r.chip === "verse" });
        x += w;
      });
    });
    flush();
    return lines.length ? lines : [{ pieces: [] }];
  };

  const DEF_PAD = 0.42; // card padding, in prose sizes
  // A linked definition and a linked verse are both cards — a tinted panel with
  // an accent spine, set apart from the prose the way the note editor sets them.
  const isCard = (k: RichBlockKind) => k === "def" || k === "vcard";
  const tint = (hex: string, a: number) => {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
    return (
      "rgba(" +
      ((n >> 16) & 255) +
      "," +
      ((n >> 8) & 255) +
      "," +
      (n & 255) +
      "," +
      a +
      ")"
    );
  };

  const layoutSynth = (html: string, sz: number, width: number): SynthLaid[] => {
    const blocks = richToBlocks(html);
    const out: SynthLaid[] = [];
    blocks.forEach((b, i) => {
      const first = out.length === 0;
      if (b.kind === "rule") {
        out.push({
          kind: b.kind,
          lines: [],
          size: sz,
          lineH: 0,
          indent: 0,
          gapBefore: first ? 0 : sz * 0.62,
          gapAfter: sz * 0.62,
          height: 2,
        });
        return;
      }
      const depth = b.depth || 0;
      let size = sz;
      let weight = "500";
      let italic = false;
      let indent = 0;
      let gapBefore = 0;
      let gapAfter = synthParaGap;
      let lineH = sz * 1.34;
      let marker: string | undefined;
      let markerFont: string | undefined;

      if (b.kind === "h1") {
        size = Math.round(sz * 1.3);
        weight = "700";
        gapBefore = first ? 0 : sz * 0.8;
        gapAfter = sz * 0.3;
        lineH = size * 1.24;
      } else if (b.kind === "h2") {
        size = Math.round(sz * 1.1);
        weight = "700";
        gapBefore = first ? 0 : sz * 0.65;
        gapAfter = sz * 0.24;
        lineH = size * 1.26;
      } else if (b.kind === "quote") {
        italic = true;
        indent = sz * 1.0;
        gapBefore = first ? 0 : sz * 0.3;
        gapAfter = sz * 0.5;
      } else if (b.kind === "li") {
        indent = sz * 1.5 + depth * sz * 1.3;
        gapAfter = sz * 0.26;
        marker = b.marker || "•";
        markerFont = "500 " + size + "px " + SERIF;
      } else if (b.kind === "def" || b.kind === "vcard") {
        size = Math.round(sz * 0.94);
        italic = b.kind === "def";
        indent = sz * 0.95;
        gapBefore = sz * 0.45;
        gapAfter = sz * 0.45;
        lineH = size * 1.32;
      }

      // A list item hangs: its marker sits in the gutter, its text runs in a
      // column of its own so a wrapped second line lines up under the first.
      const hang = b.kind === "li" ? sz * 1.15 : 0;
      const lines = wrapRuns(
        b.runs,
        size,
        Math.max(
          60,
          width - indent - hang - (isCard(b.kind) ? sz * DEF_PAD * 2 : 0)
        ),
        weight,
        italic
      );
      const inner = lines.length * lineH;
      out.push({
        kind: b.kind,
        lines,
        size,
        lineH,
        indent: indent + hang,
        // A divider already opened the space beneath itself; a heading that
        // follows one must not open it a second time.
        gapBefore:
          out.length && out[out.length - 1].kind === "rule" ? 0 : gapBefore,
        gapAfter: i === blocks.length - 1 ? 0 : gapAfter,
        marker,
        markerFont,
        height: inner + (isCard(b.kind) ? sz * DEF_PAD * 2 : 0),
      });
    });
    return out;
  };

  const synthBlockH = (bl: SynthLaid[]) =>
    bl.reduce((n, b) => n + b.gapBefore + b.height + b.gapAfter, 0);

  const drawSynthBlocks = (
    bl: SynthLaid[],
    x0: number,
    y0: number,
    accent: string
  ): number => {
    let yy = y0;
    bl.forEach((b) => {
      yy += b.gapBefore;
      if (b.kind === "rule") {
        ctx.strokeStyle = p.frame;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x0, yy + 1);
        ctx.lineTo(x0 + maxW * 0.62, yy + 1);
        ctx.stroke();
        yy += b.height + b.gapAfter;
        return;
      }
      const bx = x0 + b.indent;
      if (b.kind === "quote") {
        ctx.strokeStyle = p.frame;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x0 + b.size * 0.2, yy);
        ctx.lineTo(x0 + b.size * 0.2, yy + b.height);
        ctx.stroke();
      }
      if (isCard(b.kind)) {
        // The same card the note editor draws: tinted panel, accent spine. A
        // definition is tan, a linked verse takes the theme's own pen.
        const spine = b.kind === "def" ? DEF_SPINE : accent;
        const pad = b.size * DEF_PAD;
        roundRect(ctx, x0, yy, maxW, b.height, 10);
        ctx.fillStyle = tint(spine, o.dark ? 0.14 : 0.1);
        ctx.fill();
        ctx.fillStyle = spine;
        roundRect(ctx, x0, yy, 4, b.height, 2);
        ctx.fill();
        yy += pad;
      }
      if (b.marker) {
        ctx.font = b.markerFont || "500 " + b.size + "px " + SERIF;
        ctx.fillStyle = p.muted;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(b.marker, bx - b.size * 1.15, yy + b.size);
      }
      const textX = isCard(b.kind) ? bx + b.size * DEF_PAD : bx;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      b.lines.forEach((ln) => {
        ln.pieces.forEach((pc) => {
          ctx.font = pc.font;
          ctx.fillStyle = pc.chip ? DEF_SPINE : b.kind === "quote" ? p.muted : p.text;
          ctx.fillText(pc.text, textX + pc.x, yy + b.size);
          if (pc.u) {
            ctx.strokeStyle = ctx.fillStyle as string;
            ctx.lineWidth = Math.max(1, b.size * 0.055);
            ctx.beginPath();
            ctx.moveTo(textX + pc.x, yy + b.size * 1.16);
            ctx.lineTo(textX + pc.x + pc.w, yy + b.size * 1.16);
            ctx.stroke();
          }
        });
        yy += b.lineH;
      });
      if (isCard(b.kind)) yy += b.size * DEF_PAD;
      yy += b.gapAfter;
    });
    return yy;
  };

  // ---- full-verse layout: split the verse at mark boundaries (exactly like
  // the reading view), then lay the pieces out word-by-word with per-mark
  // styling so every one of the eight mark styles is honored on the card. ----
  type Mk = { startIndex: number; endIndex: number; style: string; color: number };
  type Tk = { text: string; ws: boolean; marks: Mk[] };

  const verseTokens = (text: string, marks: Mk[]): Tk[] => {
    const len = text.length;
    const bset = new Set<number>([0, len]);
    marks.forEach((m) => {
      bset.add(Math.max(0, Math.min(m.startIndex, len)));
      bset.add(Math.max(0, Math.min(m.endIndex, len)));
    });
    const pts = Array.from(bset).sort((a, b) => a - b);
    const toks: Tk[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (b <= a) continue;
      const ms = marks.filter((m) => m.startIndex <= a && m.endIndex >= b);
      text
        .slice(a, b)
        .split(/(\s+)/)
        .forEach((piece) => {
          if (piece === "") return;
          toks.push({ text: piece, ws: /^\s+$/.test(piece), marks: ms });
        });
    }
    return toks;
  };
  const tokFontV = (t: Tk, sz: number) => {
    const bold = t.marks.some((m) => m.style === "bold");
    const ital = t.marks.some((m) => m.style === "italic");
    return (ital ? "italic " : "") + (bold ? "700" : "500") + " " + sz + "px " + SERIF;
  };
  const wrapTokens = (toks: Tk[], sz: number): Tk[][] => {
    const lines: Tk[][] = [];
    let line: Tk[] = [];
    let w = 0;
    const flush = () => {
      while (line.length && line[line.length - 1].ws) line.pop();
      if (line.length) lines.push(line);
      line = [];
      w = 0;
    };
    toks.forEach((t) => {
      ctx.font = tokFontV(t, sz);
      const tw = ctx.measureText(t.text).width;
      if (!t.ws && line.length && w + tw > maxW) {
        flush();
        line = [t];
        w = tw;
      } else {
        if (t.ws && line.length === 0) return;
        line.push(t);
        w += tw;
      }
    });
    flush();
    return lines;
  };
  const wavy = (x0: number, x1: number, yy: number, sz: number, stroke: string) => {
    const amp = Math.max(1.5, sz * 0.05);
    const wl = Math.max(5, sz * 0.34);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, yy);
    let up = true;
    for (let x = x0; x < x1; x += wl / 2) {
      const nx = Math.min(x + wl / 2, x1);
      ctx.quadraticCurveTo((x + nx) / 2, up ? yy - amp : yy + amp, nx, yy);
      up = !up;
    }
    ctx.stroke();
  };
  const catMark = (t: Tk, styles: string[]): Mk | undefined =>
    t.marks.find((m) => styles.indexOf(m.style) >= 0);
  const isFull = (v: VersesCardEntry) =>
    v.view === "full" && v.fullText != null && v.marks != null;

  // Measure the whole stack at a candidate phrase font size.
  const measure = (size: number) => {
    const noteSize = Math.max(16, Math.round(size * 0.66));
    const synthSize = Math.max(18, Math.round(size * 0.74));
    const synthLabelSize = 18;

    const blocks = verses.map((v) => {
      const full = isFull(v);
      let phraseLines: { style: string; lines: string[] }[] = [];
      let verseLines: Tk[][] = [];
      let bodyH = 0;
      if (full) {
        verseLines = wrapTokens(
          verseTokens(v.fullText as string, v.marks as Mk[]),
          size
        );
        bodyH = verseLines.length * size * lineMul;
      } else {
        phraseLines = v.phrases.map((ph) => {
          ctx.font = fontFor(ph.style, size);
          return {
            style: ph.style,
            lines: wrap(ctx, "\u201C" + ph.text + "\u201D", maxW),
          };
        });
        bodyH =
          phraseLines.reduce((s, pl) => s + pl.lines.length * size * 1.34, 0) +
          Math.max(0, phraseLines.length - 1) * phraseGap;
      }
      const headerH = (v.theme.trim() ? themeSize + 9 : 0) + refSize + headerGap;
      // A note is the reader's own words, and it prints in full — the same rule
      // the synthesis follows. It used to stop at four lines with an ellipsis,
      // which quietly dropped half a long note; on the desktop PDF, which moved
      // here from PrintView, those notes had always printed whole. The card
      // grows to fit and the packer measures what it drew, so length is a
      // paging question, never a truncation one.
      let noteLines: string[] = [];
      if (showNotes && v.note && v.note.trim()) {
        ctx.font = proseFont(noteSize);
        noteLines = wrap(ctx, v.note.trim(), maxW);
      }
      const noteH = noteLines.length
        ? noteGap + noteLines.length * noteSize * 1.32
        : 0;
      // Chosen definitions sit below the note, in the same measured pass so the
      // packer's height and the drawn card can never disagree. Whole, for the
      // same reason a note is: a sense the reader picked on purpose is not
      // something to show four lines of.
      const glossLines: { head: string; lines: string[] }[] = [];
      (v.glosses || []).forEach((g) => {
        ctx.font = proseFont(noteSize);
        const head = g.n > 0 ? g.word + " " + g.n + ". " : g.word + " — ";
        glossLines.push({
          head,
          lines: wrap(ctx, head + g.text, maxW),
        });
      });
      const glossH = glossLines.length
        ? noteGap +
          glossLines.reduce((s2, gl) => s2 + gl.lines.length * noteSize * 1.32, 0)
        : 0;
      return {
        v,
        full,
        phraseLines,
        verseLines,
        noteLines,
        glossLines,
        noteSize,
        height: headerH + bodyH + noteH + glossH,
      };
    });

    // A synthesis is written, organized prose — headings, dividers, numbered
    // steps. It is laid out block by block and never clamped: it is the
    // reader's conclusion, and it prints in full and in the shape they gave it.
    const synthItems = showSynth
      ? syntheses
          .map((s) => {
            const blocks = layoutSynth(s.text, synthSize, maxW);
            const labelH = s.theme.trim() ? synthLabelSize + synthLabelGap : 0;
            return { s, blocks, labelH, synthSize, synthLabelSize };
          })
          .filter((it) => it.blocks.length > 0)
      : [];
    let synthH = 0;
    if (synthItems.length) {
      synthH += synthTopGap + synthRuleGap;
      synthItems.forEach((it, i) => {
        synthH +=
          it.labelH +
          synthBlockH(it.blocks) +
          (i < synthItems.length - 1 ? synthItemGap : 0);
      });
    }

    const total =
      blocks.reduce((s, b) => s + b.height, 0) +
      Math.max(0, blocks.length - 1) * verseGap +
      synthH;
    return { blocks, synthItems, total };
  };

  // Comfortable, readable text sized by how many verses are on the card.
  const baseByCount: { [k: number]: number } = {
    1: 48,
    2: 44,
    3: 42,
    4: 40,
    5: 38,
    6: 36,
  };
  const maxSize = 64;
  const minSize = 22;
  const minContent = MIN_H - top - FOOTER_SPACE;
  const maxContent = MAX_H - top - FOOTER_SPACE;
  let size = o.sizeOverride || baseByCount[verses.length] || 40;
  let lay = measure(size);
  // A forced size is the whole point of the override — a PDF holds every page
  // to one size, so neither fitting loop may move it. The canvas still grows to
  // whatever that size needs, so nothing clips.
  if (!o.sizeOverride) {
    // Grow a light card's text so it fills a standard-height card.
    while (size < maxSize && measure(size + 2).total <= minContent) {
      size += 2;
      lay = measure(size);
    }
    // Shrink a very heavy card so it never exceeds the maximum height.
    while (size > minSize && lay.total > maxContent) {
      size -= 2;
      lay = measure(size);
    }
  }

  // Grow the canvas to fit the content (clamped) rather than cramming the
  // content into a fixed height — no empty top/bottom and no overflow.
  const cardH = Math.round(
    Math.max(MIN_H, Math.min(MAX_H, top + lay.total + FOOTER_SPACE))
  );
  if (measureOnly) return { height: cardH, size };
  canvas.height = cardH;
  paintBackground(ctx, p, cardH);
  paintMasthead(
    ctx,
    p,
    penHex(verses[0] ? verses[0].color : 7, o.dark),
    cardTitle
  );

  // A single shared card centers short content so it sits nicely in frame. A
  // PDF page must NOT — pages of a document start at the same place or the eye
  // sees them drift as it flips. sizeOverride is only set when paginating, so
  // it doubles as "this is a page, not a card".
  const contentBudget = cardH - top - FOOTER_SPACE;
  let y = o.sizeOverride
    ? top
    : top + Math.max(0, (contentBudget - lay.total) / 2);

  // The synthesis LEADS: a study states its conclusion first, which is where
  // the outline puts it and therefore where a shared card puts it too. Drawn
  // above the verses, with the rule beneath it instead of above.
  const drawSynth = () => {
    if (!lay.synthItems.length) return;

    lay.synthItems.forEach((it, i) => {
      const accent = penHex(it.s.color, o.dark);
      if (it.s.theme.trim()) {
        ctx.fillStyle = accent;
        ctx.font = "700 " + it.synthLabelSize + "px " + SANS;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        drawTrackedLeft(
          ctx,
          it.s.theme.trim().toUpperCase(),
          contentX,
          y + it.synthLabelSize,
          3
        );
        y += it.synthLabelSize + synthLabelGap;
      }
      y = drawSynthBlocks(it.blocks, contentX, y, accent);
      if (i < lay.synthItems.length - 1) y += synthItemGap;
    });
    // a rule beneath it, separating the conclusion from the verses that
    // support it
    y += synthRuleGap;
    ctx.strokeStyle = p.frame;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(W - padX, y);
    ctx.stroke();
    y += synthTopGap;
  };

  drawSynth();

  lay.blocks.forEach((b) => {
    const accent = penHex(b.v.color, o.dark);
    const highlight = hlHex(b.v.color, o.dark);
    const blockTop = y;

    if (b.v.theme.trim()) {
      ctx.fillStyle = accent;
      ctx.font = "700 " + themeSize + "px " + SANS;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      drawTrackedLeft(
        ctx,
        b.v.theme.trim().toUpperCase(),
        contentX,
        y + themeSize,
        3
      );
      y += themeSize + 9;
    }

    ctx.fillStyle = p.muted;
    ctx.font = "600 " + refSize + "px " + SANS;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(b.v.reference, contentX, y + refSize);
    y += refSize + headerGap;

    if (b.full) {
      // ---- full verse, faithful to the reading view ----
      b.verseLines.forEach((ln, li) => {
        const lineBase = y + size;
        const pos: { x: number; w: number }[] = [];
        let cx = contentX;
        if (li === 0 && b.v.verseNumber != null) {
          ctx.font = "600 " + Math.round(size * 0.7) + "px " + SANS;
          ctx.fillStyle = p.muted;
          ctx.textAlign = "left";
          ctx.fillText(String(b.v.verseNumber), cx, lineBase - size * 0.04);
          cx += ctx.measureText(String(b.v.verseNumber)).width + size * 0.34;
        }
        ln.forEach((t) => {
          ctx.font = tokFontV(t, size);
          pos.push({ x: cx, w: ctx.measureText(t.text).width });
          cx += ctx.measureText(t.text).width;
        });
        // highlight backgrounds (one rounded fill per contiguous run)
        let i = 0;
        while (i < ln.length) {
          const m = catMark(ln[i], ["highlight"]);
          if (m) {
            let j = i;
            while (j + 1 < ln.length && catMark(ln[j + 1], ["highlight"]) === m) j++;
            const x0 = pos[i].x;
            const x1 = pos[j].x + pos[j].w;
            ctx.fillStyle = hlHex(m.color, o.dark);
            roundRect(ctx, x0 - 3, lineBase - size * 0.82, x1 - x0 + 6, size * 1.04, 5);
            ctx.fill();
            i = j + 1;
          } else i++;
        }
        // circle / box enclosures (one shape per contiguous run)
        i = 0;
        while (i < ln.length) {
          const m = catMark(ln[i], ["circle", "box"]);
          if (m) {
            let j = i;
            while (j + 1 < ln.length && catMark(ln[j + 1], ["circle", "box"]) === m) j++;
            const x0 = pos[i].x;
            const x1 = pos[j].x + pos[j].w;
            ctx.strokeStyle = penHex(m.color, o.dark);
            ctx.lineWidth = 2.5;
            roundRect(
              ctx,
              x0 - 5,
              lineBase - size * 0.86,
              x1 - x0 + 10,
              size * 1.12,
              m.style === "circle" ? size * 0.55 : 4
            );
            ctx.stroke();
            i = j + 1;
          } else i++;
        }
        // words (bold/italic take the pen color; otherwise body text)
        ln.forEach((t, k) => {
          const bold = t.marks.some((m) => m.style === "bold");
          const ital = t.marks.some((m) => m.style === "italic");
          ctx.font = tokFontV(t, size);
          ctx.fillStyle = bold || ital ? accent : p.text;
          ctx.textAlign = "left";
          ctx.fillText(t.text, pos[k].x, lineBase);
        });
        // underline / dashed / squiggly (one stroke per contiguous run)
        const decos = ["underline", "dashed", "squiggly"];
        i = 0;
        while (i < ln.length) {
          const m = catMark(ln[i], decos);
          if (m) {
            let j = i;
            while (j + 1 < ln.length && catMark(ln[j + 1], decos) === m) j++;
            const x0 = pos[i].x;
            const x1 = pos[j].x + pos[j].w;
            const uy = lineBase + Math.round(size * 0.16);
            if (m.style === "squiggly") {
              wavy(x0, x1, uy, size, penHex(m.color, o.dark));
            } else {
              ctx.strokeStyle = penHex(m.color, o.dark);
              ctx.lineWidth = 2.5;
              ctx.setLineDash(m.style === "dashed" ? [6, 4] : []);
              ctx.beginPath();
              ctx.moveTo(x0, uy);
              ctx.lineTo(x1, uy);
              ctx.stroke();
              ctx.setLineDash([]);
            }
            i = j + 1;
          } else i++;
        }
        y += size * lineMul;
      });
    } else {
      // ---- focused snippets (each marked phrase on its own line) ----
      b.phraseLines.forEach((pl) => {
        ctx.font = fontFor(pl.style, size);
        pl.lines.forEach((ln) => {
          const lineBase = y + size;
          const tw = ctx.measureText(ln).width;
          if (pl.style === "highlight") {
            ctx.fillStyle = highlight;
            roundRect(
              ctx,
              contentX - 8,
              lineBase - size + size * 0.2,
              tw + 16,
              size * 1.1,
              7
            );
            ctx.fill();
          }
          if (pl.style === "circle" || pl.style === "box") {
            ctx.strokeStyle = accent;
            ctx.lineWidth = 2.5;
            roundRect(
              ctx,
              contentX - 6,
              lineBase - size * 0.86,
              tw + 12,
              size * 1.12,
              pl.style === "circle" ? size * 0.55 : 4
            );
            ctx.stroke();
          }
          ctx.fillStyle =
            pl.style === "bold" || pl.style === "italic" ? accent : p.text;
          ctx.textAlign = "left";
          ctx.fillText(ln, contentX, lineBase);
          if (pl.style === "underline" || pl.style === "dashed") {
            ctx.strokeStyle = accent;
            ctx.lineWidth = 3;
            ctx.setLineDash(pl.style === "dashed" ? [6, 4] : []);
            ctx.beginPath();
            ctx.moveTo(contentX, lineBase + 9);
            ctx.lineTo(contentX + tw, lineBase + 9);
            ctx.stroke();
            ctx.setLineDash([]);
          } else if (pl.style === "squiggly") {
            wavy(contentX, contentX + tw, lineBase + 9, size, accent);
          }
          y += size * 1.34;
        });
        y += phraseGap;
      });
      y -= phraseGap; // remove trailing gap after the last phrase
    }

    // per-verse note (muted italic, beneath the phrases)
    if (b.noteLines.length) {
      y += noteGap;
      ctx.font = proseFont(b.noteSize);
      ctx.fillStyle = p.muted;
      ctx.textAlign = "left";
      b.noteLines.forEach((ln) => {
        ctx.fillText(ln, contentX, y + b.noteSize);
        y += b.noteSize * 1.32;
      });
    }

    // chosen definitions, under the note; the accent bar below grows to cover
    // them because it is sized from the running y.
    if (b.glossLines.length) {
      y += noteGap;
      ctx.font = proseFont(b.noteSize);
      ctx.textAlign = "left";
      b.glossLines.forEach((gl) => {
        gl.lines.forEach((ln, li) => {
          // The headword takes the card's text color so a definition doesn't
          // read as a continuation of the note above it. Same font either way —
          // a bolder head would widen the first line past what was measured.
          if (li === 0 && ln.indexOf(gl.head) === 0) {
            ctx.fillStyle = p.text;
            ctx.fillText(gl.head, contentX, y + b.noteSize);
            const hw = ctx.measureText(gl.head).width;
            ctx.fillStyle = p.muted;
            ctx.fillText(ln.slice(gl.head.length), contentX + hw, y + b.noteSize);
          } else {
            ctx.fillStyle = p.muted;
            ctx.fillText(ln, contentX, y + b.noteSize);
          }
          y += b.noteSize * 1.32;
        });
      });
    }

    const barH = Math.max(14, y - blockTop);
    ctx.fillStyle = accent;
    roundRect(ctx, padX, blockTop, barW, barH, 3);
    ctx.fill();

    y += verseGap;
  });

  paintBrand(ctx, p, penHex(verses[0] ? verses[0].color : 7, o.dark), cardH);
  return canvas;
}

// ---------- Compilation card ----------
export interface CompTheme {
  name: string;
  color: number;
  synthesis: string;
  count: number;
}
export interface CompCardOpts {
  scopeTitle: string;
  studyLabel: string;
  dateStr: string;
  totalMarks: number;
  passages: number;
  hero: {
    text: string;
    reference: string;
    style: string;
    color: number;
  } | null;
  themes: CompTheme[];
  // The study's synthesis, in full. Its own block on the cover: it is the
  // study's conclusion, and it led every other surface while the cover showed
  // one clipped line of it borrowed from a theme caption.
  synthesis?: string;
  dark: boolean;
}

const COMP_FOOTER_SPACE = 190; // room beneath the content for the brand footer
// Measuring height for pass one: tall enough that nothing is cut off or pushed
// past the footer line while the layout is still being sized.
const MEASURE_H = H * 8;

export function renderCompilationCard(o: CompCardOpts): HTMLCanvasElement {
  // Two passes: the first finds where the content actually ends, the second
  // redraws it on a canvas trimmed to that height — a three-theme study used to
  // ship with the bottom third of the card empty. The theme count from pass one
  // carries into pass two, so trimming can never drop a theme it had room for.
  //
  // Pass one measures on a deliberately over-tall canvas, and the card GROWS to
  // whatever it needs rather than being capped at H. The cover carries the whole
  // synthesis now, and on a "Summary" share it is the only card there is — a cap
  // meant the brand footer painted straight over the last paragraphs and the
  // theme list fell off the bottom entirely.
  const first = paintCompilationCard(o, MEASURE_H, -1);
  const cardH = Math.round(
    Math.max(CARD_MIN_H, first.contentEnd + COMP_FOOTER_SPACE)
  );
  return paintCompilationCard(o, cardH, first.drawn).canvas;
}

function paintCompilationCard(
  o: CompCardOpts,
  cardH: number,
  themeLimit: number
): { canvas: HTMLCanvasElement; contentEnd: number; drawn: number } {
  const p = o.dark ? darkCard : lightCard;
  const accent = o.themes.length ? penHex(o.themes[0].color, o.dark) : "#8b5cf6";
  const { canvas, ctx } = newCanvas(cardH);
  if (!ctx) return { canvas, contentEnd: cardH, drawn: 0 };

  paintBackground(ctx, p, cardH);
  const padX = 110;
  const maxW = W - padX * 2;
  let y = 150;

  ctx.fillStyle = accent;
  ctx.font = "700 24px " + SANS;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  drawTrackedLeft(ctx, "SCRIBAL · STUDY", padX, y, 3);
  ctx.fillStyle = p.muted;
  ctx.font = "500 24px " + SANS;
  ctx.textAlign = "right";
  ctx.fillText(o.dateStr.toUpperCase(), W - padX, y);
  y += 78;

  // The study's NAME is the headline — it is what this is. The scripture range
  // is a fact about it and sits underneath. A compile with no named study falls
  // back to the scope for the headline and then has no subhead to draw.
  const label = (o.studyLabel || "").trim();
  const scope = o.scopeTitle.trim();
  const named = !!label && label.toLowerCase() !== scope.toLowerCase();
  const headline = named ? label : scope;

  ctx.fillStyle = p.text;
  ctx.textAlign = "left";
  const tSizes = [70, 60, 52, 44, 38];
  let tSize = tSizes[0];
  let tLines: string[] = [];
  for (const sz of tSizes) {
    ctx.font = "600 " + sz + "px " + SERIF;
    tLines = wrap(ctx, headline, maxW);
    tSize = sz;
    if (tLines.length <= 2) break;
  }
  ctx.font = "600 " + tSize + "px " + SERIF;
  // clampLines adds the ellipsis; a bare slice dropped the tail in silence.
  clampLines(tLines, 2).forEach((ln) => {
    y += tSize;
    ctx.fillText(ln, padX, y);
    y += 6;
  });

  if (named) {
    y += 44;
    ctx.fillStyle = p.muted;
    ctx.font = "500 32px " + SERIF;
    ctx.textAlign = "left";
    ctx.fillText(clampLines(wrap(ctx, scope, maxW), 1)[0] || "", padX, y);
    y += 14; // the range and the counts are separate facts — don't crowd them
  }

  y += 30;
  ctx.fillStyle = p.muted;
  ctx.font = "400 28px " + SANS;
  const meta =
    o.totalMarks +
    (o.totalMarks === 1 ? " mark" : " marks") +
    " · " +
    o.themes.length +
    (o.themes.length === 1 ? " theme" : " themes") +
    " · " +
    o.passages +
    (o.passages === 1 ? " chapter" : " chapters");
  ctx.fillText(meta, padX, y);
  y += 40;

  const divider = () => {
    ctx.strokeStyle = p.frame;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(W - padX, y);
    ctx.stroke();
    y += 44;
  };
  divider();

  // The synthesis LEADS — above the featured verse and the theme list, the way
  // it leads the outline, the printout and the first shared card. Every
  // paragraph is drawn; nothing here is clamped.
  const synthParas = richToParagraphs(o.synthesis || "");
  if (synthParas.length) {
    ctx.textAlign = "left";
    ctx.fillStyle = p.text;
    const sSize = 30;
    const sLineH = sSize * 1.42;
    ctx.font = "italic 500 " + sSize + "px " + SERIF;
    synthParas.forEach((para, i) => {
      wrap(ctx, para, maxW).forEach((ln) => {
        y += sLineH;
        ctx.fillText(ln, padX, y);
      });
      if (i < synthParas.length - 1) y += 14;
    });
    y += 40;
    divider();
  }

  if (o.hero && o.hero.text.trim()) {
    const hStyle = o.hero.style;
    const hBold = hStyle === "bold";
    const hItalic = hStyle === "italic";
    const hPen = penHex(o.hero.color, o.dark);
    const hHl = hlHex(o.hero.color, o.dark);
    // The featured verse renders with its actual mark style, exactly as it
    // appears in the reading view — not forced into a generic italic quote.
    const hFont = (sz: number) =>
      (hItalic ? "italic " : "") + (hBold ? "700" : "500") + " " + sz + "px " + SERIF;
    const qSizes = [42, 38, 34, 30, 27];
    let qSize = qSizes[0];
    let qLines: string[] = [];
    const quoteW = maxW - 34;
    for (const sz of qSizes) {
      ctx.font = hFont(sz);
      qLines = wrap(ctx, o.hero.text.trim(), quoteW);
      qSize = sz;
      if (qLines.length <= 3) break;
    }
    if (qLines.length > 3) {
      qLines = qLines.slice(0, 3);
      qLines[2] = qLines[2].replace(/\s+\S*$/, "") + "…";
    }
    ctx.font = hFont(qSize);
    const qLineH = qSize * 1.34;
    const barTop = y - qSize + 8;
    const barH = qLines.length * qLineH;
    // accent bar in the featured mark's own color
    ctx.fillStyle = hPen;
    roundRect(ctx, padX, barTop, 5, barH, 2.5);
    ctx.fill();
    const qx = padX + 34;
    ctx.textAlign = "left";
    qLines.forEach((ln) => {
      y += qSize;
      ctx.font = hFont(qSize);
      const tw = ctx.measureText(ln).width;
      if (hStyle === "highlight") {
        ctx.fillStyle = hHl;
        roundRect(ctx, qx - 6, y - qSize + qSize * 0.18, tw + 12, qSize * 1.12, 6);
        ctx.fill();
      }
      ctx.fillStyle = hBold || hItalic ? hPen : p.text;
      ctx.fillText(ln, qx, y);
      if (hStyle === "underline") {
        ctx.strokeStyle = hPen;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(qx, y + qSize * 0.2);
        ctx.lineTo(qx + tw, y + qSize * 0.2);
        ctx.stroke();
      } else if (hStyle === "circle") {
        ctx.strokeStyle = hPen;
        ctx.lineWidth = 2.5;
        roundRect(
          ctx,
          qx - 6,
          y - qSize * 0.86,
          tw + 12,
          qSize * 1.12,
          qSize * 0.55
        );
        ctx.stroke();
      }
      y += qLineH - qSize;
    });
    y += 12;
    ctx.fillStyle = p.muted;
    ctx.font = "italic 26px " + SERIF;
    y += 26;
    ctx.fillText("— " + o.hero.reference, qx, y);
    y += 44;
    divider();
  }

  ctx.textAlign = "left";
  const footerTop = cardH - COMP_FOOTER_SPACE;
  let drawn = 0;
  for (const th of o.themes) {
    // Pass two draws exactly what pass one had room for; only pass one
    // (themeLimit -1) decides how many themes fit.
    if (themeLimit >= 0 ? drawn >= themeLimit : y > footerTop - 70) break;
    ctx.fillStyle = penHex(th.color, o.dark);
    ctx.beginPath();
    ctx.arc(padX + 11, y - 11, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.text;
    ctx.font = "600 36px " + SERIF;
    ctx.textAlign = "left";
    ctx.fillText(th.name.trim() || "Untitled theme", padX + 40, y);
    ctx.fillStyle = p.muted;
    ctx.font = "400 26px " + SANS;
    ctx.textAlign = "right";
    ctx.fillText(String(th.count), W - padX, y - 4);
    ctx.textAlign = "left";
    if (th.synthesis.trim()) {
      ctx.fillStyle = p.muted;
      ctx.font = "italic 27px " + SERIF;
      const sLines = wrap(ctx, th.synthesis.trim(), maxW - 40);
      let s = sLines[0] || "";
      if (sLines.length > 1) s = s.replace(/\s+\S*$/, "") + "…";
      y += 38;
      ctx.fillText(s, padX + 40, y);
    }
    y += 56;
    drawn++;
  }
  if (o.themes.length > drawn) {
    ctx.fillStyle = p.muted;
    ctx.font = "400 27px " + SANS;
    ctx.fillText("+ " + (o.themes.length - drawn) + " more themes", padX + 40, y);
    y += 20;
  }

  paintBrand(ctx, p, accent, cardH);
  return { canvas, contentEnd: y, drawn };
}

// ---------- Preview + share helpers ----------
export function canvasURL(canvas: HTMLCanvasElement): string {
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

export async function shareCanvas(
  canvas: HTMLCanvasElement,
  filename: string,
  caption: string
): Promise<ShareResult> {
  const blob: Blob | null = await new Promise((res) =>
    canvas.toBlob((b) => res(b), "image/png", 0.95)
  );
  if (!blob) return "failed";
  const nav = navigator as Navigator & {
    canShare?: (d: any) => boolean;
    share?: (d: any) => Promise<void>;
  };
  if (prefersOsShare()) {
    try {
      const file = new File([blob], filename, { type: "image/png" });
      if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
        try {
          await nav.share({ files: [file], text: caption });
          return "shared";
        } catch (e) {
          if (e && (e as { name?: string }).name === "AbortError")
            return "cancelled";
        }
      }
    } catch {
      /* fall through to download */
    }
  } else if (await copyBlob(blob, "image/png")) {
    // On a desktop the clipboard IS the share: the card can go straight into a
    // message, a document, or a chat without a file ever touching the disk.
    return "copied";
  }
  return downloadBlob(blob, filename);
}

// ---------- Covenant card (screen-faithful ledger, per-fragment marks) ----------
export interface CovenantFrag {
  text: string;
  style: string;
  color: number;
  gapBefore: boolean;
}
export interface CovenantPairData {
  reference: string;
  // preferred: the real marked fragments (each keeps its own style/color)
  ifFrags?: CovenantFrag[];
  thenFrags?: CovenantFrag[];
  // legacy fallback: joined text + one representative style
  ifText?: string;
  ifStyle?: string;
  thenText?: string;
  thenStyle?: string;
}
export interface CovenantCardOpts {
  pairs: CovenantPairData[];
  conditionColor: number;
  promiseColor: number;
  dark: boolean;
  heading?: string;
}

interface AppPalette {
  bg: string;
  panel: string;
  soft: string;
  text: string;
  muted: string;
  border: string;
}
const appLight: AppPalette = {
  bg: "#f6f4ee",
  panel: "#ffffff",
  soft: "#efece4",
  text: "#1d1c18",
  muted: "#8d8a80",
  border: "#e2dfd6",
};
const appDark: AppPalette = {
  bg: "#131210",
  panel: "#1d1c19",
  soft: "#232220",
  text: "#eae7de",
  muted: "#8d8a82",
  border: "#343229",
};

interface Tok {
  text: string;
  style: string;
  color: number;
  gap: boolean;
  frag: number;
}

export function renderCovenantCard(o: CovenantCardOpts): HTMLCanvasElement {
  const a = o.dark ? appDark : appLight;
  const dark = o.dark;
  const { canvas, ctx } = newCanvas();
  if (!ctx) return canvas;

  const fallback = (
    frags: CovenantFrag[] | undefined,
    text: string | undefined,
    style: string | undefined,
    color: number
  ): CovenantFrag[] => {
    if (frags && frags.length) return frags;
    if (text && text.trim())
      return [{ text: text, style: style || "highlight", color, gapBefore: false }];
    return [];
  };

  const pairs = o.pairs.slice(0, 3).map((pr) => ({
    reference: pr.reference,
    ifFrags: fallback(pr.ifFrags, pr.ifText, pr.ifStyle, o.conditionColor),
    thenFrags: fallback(pr.thenFrags, pr.thenText, pr.thenStyle, o.promiseColor),
  }));

  const condAccent = penHex(o.conditionColor, dark);
  const promAccent = penHex(o.promiseColor, dark);

  const padX = 84;
  const headerTop = 92;
  const footerSpace = 150;
  const MIN_H = 1080;
  const MAX_H = 2600;

  const labelSize = 22;
  const labelGap = 12;
  const headingSize = 40;
  const headingGap = 34;

  const refSize = 24;
  const refGap = 12;
  const innerPad = 30;
  const boxVPad = 26;
  const boxTextW = W - padX * 2 - innerPad * 2;
  const arrowGap = 46;
  const pairGap = 42;
  const lineMul = 1.42;

  const chapters: string[] = [];
  pairs.forEach((pr) => {
    const idx = pr.reference.lastIndexOf(":");
    const ch = idx > 0 ? pr.reference.slice(0, idx) : pr.reference;
    if (chapters.indexOf(ch) < 0) chapters.push(ch);
  });
  const heading = chapters.join("  ·  ");

  const tokFont = (t: Tok, fsize: number) => {
    if (t.gap) return "500 " + fsize + "px " + SERIF;
    const weight = t.style === "bold" ? "700" : "500";
    const ital = t.style === "italic" ? "italic " : "";
    return ital + weight + " " + fsize + "px " + SERIF;
  };

  const buildToks = (frags: CovenantFrag[]): Tok[] => {
    const toks: Tok[] = [];
    frags.forEach((f, fi) => {
      if (f.gapBefore)
        toks.push({ text: "…", style: "gap", color: 0, gap: true, frag: -1 });
      f.text
        .split(/\s+/)
        .filter(Boolean)
        .forEach((w) =>
          toks.push({ text: w, style: f.style, color: f.color, gap: false, frag: fi })
        );
    });
    return toks;
  };

  const layoutToks = (toks: Tok[], fsize: number): Tok[][] => {
    ctx.font = "500 " + fsize + "px " + SERIF;
    const sp = ctx.measureText(" ").width;
    const lines: Tok[][] = [];
    let line: Tok[] = [];
    let lineW = 0;
    toks.forEach((t) => {
      ctx.font = tokFont(t, fsize);
      const w = ctx.measureText(t.text).width;
      const add = (line.length ? sp : 0) + w;
      if (line.length && lineW + add > boxTextW) {
        lines.push(line);
        line = [t];
        lineW = w;
      } else {
        line.push(t);
        lineW += add;
      }
    });
    if (line.length) lines.push(line);
    return lines;
  };

  const headerH = labelSize + labelGap + headingSize + headingGap;

  const measure = (fsize: number) => {
    const blocks = pairs.map((pr) => {
      const ifLines = layoutToks(buildToks(pr.ifFrags), fsize);
      const thenLines = layoutToks(buildToks(pr.thenFrags), fsize);
      const ifBoxH = boxVPad * 2 + ifLines.length * fsize * lineMul;
      const thenBoxH = boxVPad * 2 + thenLines.length * fsize * lineMul;
      const height = refSize + refGap + ifBoxH + arrowGap + thenBoxH;
      return { pr, ifLines, thenLines, ifBoxH, thenBoxH, height };
    });
    const total =
      blocks.reduce((s, b) => s + b.height, 0) +
      Math.max(0, blocks.length - 1) * pairGap;
    return { blocks, total };
  };

  let size = pairs.length >= 3 ? 38 : pairs.length === 2 ? 42 : 46;
  const minSize = 24;
  const maxContent = MAX_H - headerTop - headerH - footerSpace;
  let lay = measure(size);
  while (size > minSize && lay.total > maxContent) {
    size -= 2;
    lay = measure(size);
  }

  const cardH = Math.round(
    Math.max(
      MIN_H,
      Math.min(MAX_H, headerTop + headerH + lay.total + footerSpace)
    )
  );
  canvas.height = cardH;

  // flat app background (not the parchment style)
  ctx.fillStyle = a.bg;
  ctx.fillRect(0, 0, W, cardH);

  // header, left-aligned like the on-screen ledger
  ctx.fillStyle = a.muted;
  ctx.font = "700 " + labelSize + "px " + SANS;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  drawTrackedLeft(ctx, (o.heading || "COVENANT LEDGER").toUpperCase(), padX, headerTop + labelSize, 3);
  ctx.fillStyle = a.text;
  ctx.font = "500 " + headingSize + "px " + SANS;
  ctx.fillText(heading, padX, headerTop + labelSize + labelGap + headingSize);

  const contentTop = headerTop + headerH;
  const contentBudget = cardH - contentTop - footerSpace;
  let y = contentTop + Math.max(0, (contentBudget - lay.total) / 2);

  const drawBox = (lines: Tok[][], accent: string, boxH: number) => {
    const boxX = padX;
    const boxW = W - padX * 2;
    const boxTop = y;
    ctx.fillStyle = a.soft;
    roundRect(ctx, boxX, boxTop, boxW, boxH, 14);
    ctx.fill();
    ctx.fillStyle = accent;
    roundRect(ctx, boxX, boxTop, 6, boxH, 3);
    ctx.fill();
    const tx = boxX + innerPad;
    let ty = boxTop + boxVPad;
    ctx.textBaseline = "alphabetic";
    ctx.font = "500 " + size + "px " + SERIF;
    const sp = ctx.measureText(" ").width;
    lines.forEach((ln) => {
      const lineBase = ty + size;
      // Pass 1: resolve every token's x position and width first, so a circled
      // phrase can be boxed as one continuous shape rather than one box per
      // word. Width depends on the token's font, so set it before measuring.
      const pos: { x: number; w: number }[] = [];
      let cx = tx;
      ln.forEach((t, i) => {
        if (i > 0) cx += sp;
        ctx.font = tokFont(t, size);
        pos.push({ x: cx, w: ctx.measureText(t.text).width });
        cx += pos[i].w;
      });

      // Pass 2: one rounded box around each run of consecutive same-fragment
      // circled words — this is what "circle" does in the reading view.
      let ci = 0;
      while (ci < ln.length) {
        const t = ln[ci];
        if (!t.gap && t.style === "circle") {
          let cj = ci;
          while (
            cj + 1 < ln.length &&
            !ln[cj + 1].gap &&
            ln[cj + 1].style === "circle" &&
            ln[cj + 1].frag === t.frag
          ) {
            cj++;
          }
          const startX = pos[ci].x;
          const endX = pos[cj].x + pos[cj].w;
          ctx.strokeStyle = penHex(t.color, dark);
          ctx.lineWidth = 2.5;
          roundRect(
            ctx,
            startX - 5,
            lineBase - size * 0.86,
            endX - startX + 10,
            size * 1.12,
            size * 0.55
          );
          ctx.stroke();
          ci = cj + 1;
        } else {
          ci++;
        }
      }

      // Pass 3: highlight backgrounds, the words, then underlines.
      ln.forEach((t, i) => {
        const x = pos[i].x;
        const w = pos[i].w;
        const next = ln[i + 1];
        const contig = !!next && !t.gap && !next.gap && next.frag === t.frag;
        if (!t.gap && t.style === "highlight") {
          ctx.fillStyle = hlHex(t.color, dark);
          const rw = w + (contig ? sp : 0);
          roundRect(ctx, x - 3, lineBase - size * 0.82, rw + 6, size * 1.04, 5);
          ctx.fill();
        }
        if (t.gap) ctx.fillStyle = a.muted;
        else if (t.style === "bold" || t.style === "italic")
          ctx.fillStyle = penHex(t.color, dark);
        else ctx.fillStyle = a.text;
        ctx.font = tokFont(t, size);
        ctx.textAlign = "left";
        ctx.fillText(t.text, x, lineBase);
        if (!t.gap && t.style === "underline") {
          ctx.strokeStyle = penHex(t.color, dark);
          ctx.lineWidth = 2.5;
          const uw = w + (contig ? sp : 0);
          const uy = lineBase + Math.round(size * 0.2);
          ctx.beginPath();
          ctx.moveTo(x, uy);
          ctx.lineTo(x + uw, uy);
          ctx.stroke();
        }
      });
      ty += size * lineMul;
    });
    y = boxTop + boxH;
  };

  lay.blocks.forEach((b) => {
    ctx.fillStyle = a.muted;
    ctx.font = "600 " + refSize + "px " + SANS;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(b.pr.reference, padX, y + refSize);
    y += refSize + refGap;

    drawBox(b.ifLines, condAccent, b.ifBoxH);

    const arrowMid = y + arrowGap / 2;
    ctx.fillStyle = a.muted;
    ctx.font = "500 34px " + SANS;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("\u2193", W / 2, arrowMid + 2);
    y += arrowGap;

    drawBox(b.thenLines, promAccent, b.thenBoxH);
    y += pairGap;
  });

  ctx.fillStyle = a.muted;
  ctx.font = "600 24px " + SERIF;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  drawTracked(ctx, "SCRIBAL", W / 2, cardH - 58, 6);

  return canvas;
}
