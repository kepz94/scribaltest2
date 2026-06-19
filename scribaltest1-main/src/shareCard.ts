// Renders beautiful, social-ready PNG cards for a verse or a compilation.
// Rendering (-> canvas, for live preview) is separate from sharing (-> share
// sheet / download), so the UI can show a preview before committing.

export type ShareResult = "shared" | "downloaded" | "cancelled" | "failed";

const W = 1080;
const H = 1350;
const SERIF = '"Times New Roman", Georgia, "Hoefler Text", serif';
const SANS = '-apple-system, "Segoe UI", Roboto, system-ui, sans-serif';

// Card-local color tables (so cards can switch light/dark independently of app).
const PEN_LIGHT = ["", "#d11a2a", "#e07b1a", "#c9a200", "#2f8f3e", "#2f6fb0", "#7b4fbf", "#1a1a1a"];
const PEN_DARK = ["", "#ff7b72", "#f0a24b", "#e3c341", "#5fcf6b", "#7cb0e8", "#b794f6", "#f2efe8"];
const HL_LIGHT = ["", "#ffd6d6", "#ffe2c2", "#fbedb0", "#d3f0d6", "#cfe2f7", "#e6d9f7", "#e0e0e0"];
const HL_DARK = ["", "#5c2b2e", "#5c3f1f", "#5a4a1c", "#1f4d2a", "#243d56", "#3d2b5c", "#3f3e3a"];
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

// Top nameplate so the card reads "Scribal" the instant it is seen.
function paintMasthead(
  ctx: CanvasRenderingContext2D,
  p: Palette,
  accent: string
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
  ctx.restore();
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
    ctx.fillStyle = p.text;
    ctx.fillText(ln, W / 2, y);
    if (o.style === "underline" || o.style === "circle") {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(W / 2 - tw / 2, y + 12);
      ctx.lineTo(W / 2 + tw / 2, y + 12);
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

// ---------- Multi-verse card (up to 4 selected verses, focused phrases) ----------
export interface VersesCardEntry {
  reference: string;
  theme: string;
  color: number;
  phrases: { text: string; style: string }[];
  note?: string;
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
}

export function renderVersesCard(o: VersesCardOpts): HTMLCanvasElement {
  const p = o.dark ? darkCard : lightCard;
  const { canvas, ctx } = newCanvas();
  if (!ctx) return canvas;

  const verses = o.verses.slice(0, 4);
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
  const top = 172;
  const FOOTER_SPACE = 168; // room beneath the content for the brand footer
  const MIN_H = 1080; // a light card is never shorter than this
  const MAX_H = 2600; // a heavy card is never taller than this

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

  const fontFor = (style: string, size: number) => {
    const weight = style === "bold" ? "700" : "500";
    const ital = style === "italic" ? "italic " : "";
    return ital + weight + " " + size + "px " + SERIF;
  };
  const proseFont = (sz: number) => "italic 500 " + sz + "px " + SERIF;

  // Measure the whole stack at a candidate phrase font size.
  const measure = (size: number) => {
    const noteSize = Math.max(16, Math.round(size * 0.66));
    const synthSize = Math.max(18, Math.round(size * 0.74));
    const synthLabelSize = 18;

    const blocks = verses.map((v) => {
      const phraseLines = v.phrases.map((ph) => {
        ctx.font = fontFor(ph.style, size);
        return {
          style: ph.style,
          lines: wrap(ctx, "\u201C" + ph.text + "\u201D", maxW),
        };
      });
      const phrasesH =
        phraseLines.reduce((s, pl) => s + pl.lines.length * size * 1.34, 0) +
        Math.max(0, phraseLines.length - 1) * phraseGap;
      const headerH = (v.theme.trim() ? themeSize + 9 : 0) + refSize + headerGap;
      let noteLines: string[] = [];
      if (showNotes && v.note && v.note.trim()) {
        ctx.font = proseFont(noteSize);
        noteLines = clampLines(wrap(ctx, v.note.trim(), maxW), 4);
      }
      const noteH = noteLines.length
        ? noteGap + noteLines.length * noteSize * 1.32
        : 0;
      return {
        v,
        phraseLines,
        noteLines,
        noteSize,
        height: headerH + phrasesH + noteH,
      };
    });

    const synthItems = showSynth
      ? syntheses.map((s) => {
          ctx.font = proseFont(synthSize);
          const lines = clampLines(wrap(ctx, s.text.trim(), maxW), 6);
          const labelH = s.theme.trim() ? synthLabelSize + synthLabelGap : 0;
          return { s, lines, labelH, synthSize, synthLabelSize };
        })
      : [];
    let synthH = 0;
    if (showSynth) {
      synthH += synthTopGap + synthRuleGap;
      synthItems.forEach((it, i) => {
        synthH +=
          it.labelH +
          it.lines.length * synthSize * 1.34 +
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
  const baseByCount: { [k: number]: number } = { 1: 48, 2: 44, 3: 42, 4: 40 };
  const maxSize = 64;
  const minSize = 22;
  const minContent = MIN_H - top - FOOTER_SPACE;
  const maxContent = MAX_H - top - FOOTER_SPACE;
  let size = baseByCount[verses.length] || 40;
  let lay = measure(size);
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

  // Grow the canvas to fit the content (clamped) rather than cramming the
  // content into a fixed height — no empty top/bottom and no overflow.
  const cardH = Math.round(
    Math.max(MIN_H, Math.min(MAX_H, top + lay.total + FOOTER_SPACE))
  );
  canvas.height = cardH;
  paintBackground(ctx, p, cardH);
  paintMasthead(ctx, p, penHex(verses[0] ? verses[0].color : 7, o.dark));

  // Top-align; center only when content is shorter than the card (light cards).
  const contentBudget = cardH - top - FOOTER_SPACE;
  let y = top + Math.max(0, (contentBudget - lay.total) / 2);

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
        ctx.fillStyle = p.text;
        ctx.textAlign = "left";
        ctx.fillText(ln, contentX, lineBase);
        if (pl.style === "underline" || pl.style === "circle") {
          ctx.strokeStyle = accent;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(contentX, lineBase + 9);
          ctx.lineTo(contentX + tw, lineBase + 9);
          ctx.stroke();
        }
        y += size * 1.34;
      });
      y += phraseGap;
    });
    y -= phraseGap; // remove trailing gap after the last phrase

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

    const barH = Math.max(14, y - blockTop);
    ctx.fillStyle = accent;
    roundRect(ctx, padX, blockTop, barW, barH, 3);
    ctx.fill();

    y += verseGap;
  });

  // synthesis (the study's conclusion) beneath the verses
  if (showSynth) {
    y -= verseGap; // undo the trailing gap after the last verse
    y += synthTopGap;
    ctx.strokeStyle = p.frame;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(W - padX, y);
    ctx.stroke();
    y += synthRuleGap;

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
      ctx.font = proseFont(it.synthSize);
      ctx.fillStyle = p.text;
      ctx.textAlign = "left";
      it.lines.forEach((ln) => {
        ctx.fillText(ln, contentX, y + it.synthSize);
        y += it.synthSize * 1.34;
      });
      if (i < lay.synthItems.length - 1) y += synthItemGap;
    });
  }

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
  hero: { text: string; reference: string } | null;
  themes: CompTheme[];
  dark: boolean;
}

export function renderCompilationCard(o: CompCardOpts): HTMLCanvasElement {
  const p = o.dark ? darkCard : lightCard;
  const accent = o.themes.length ? penHex(o.themes[0].color, o.dark) : "#8b5cf6";
  const { canvas, ctx } = newCanvas();
  if (!ctx) return canvas;

  paintBackground(ctx, p);
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

  ctx.fillStyle = p.text;
  ctx.textAlign = "left";
  const tSizes = [70, 60, 52, 44, 38];
  let tSize = tSizes[0];
  let tLines: string[] = [];
  for (const sz of tSizes) {
    ctx.font = "600 " + sz + "px " + SERIF;
    tLines = wrap(ctx, o.scopeTitle, maxW);
    tSize = sz;
    if (tLines.length <= 2) break;
  }
  ctx.font = "600 " + tSize + "px " + SERIF;
  tLines.slice(0, 2).forEach((ln) => {
    y += tSize;
    ctx.fillText(ln, padX, y);
    y += 6;
  });

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

  if (o.hero && o.hero.text.trim()) {
    const qSizes = [42, 38, 34, 30, 27];
    let qSize = qSizes[0];
    let qLines: string[] = [];
    const quoteW = maxW - 34;
    for (const sz of qSizes) {
      ctx.font = "italic 500 " + sz + "px " + SERIF;
      qLines = wrap(ctx, o.hero.text.trim(), quoteW);
      qSize = sz;
      if (qLines.length <= 3) break;
    }
    if (qLines.length > 3) {
      qLines = qLines.slice(0, 3);
      qLines[2] = qLines[2].replace(/\s+\S*$/, "") + "…";
    }
    ctx.font = "italic 500 " + qSize + "px " + SERIF;
    const qLineH = qSize * 1.34;
    const barTop = y - qSize + 8;
    const barH = qLines.length * qLineH;
    ctx.fillStyle = accent;
    roundRect(ctx, padX, barTop, 5, barH, 2.5);
    ctx.fill();
    ctx.fillStyle = p.text;
    ctx.textAlign = "left";
    qLines.forEach((ln) => {
      y += qSize;
      ctx.fillText(ln, padX + 34, y);
      y += qLineH - qSize;
    });
    y += 12;
    ctx.fillStyle = p.muted;
    ctx.font = "italic 26px " + SERIF;
    y += 26;
    ctx.fillText("— " + o.hero.reference, padX + 34, y);
    y += 44;
    divider();
  }

  ctx.textAlign = "left";
  const footerTop = H - 190;
  let drawn = 0;
  for (const th of o.themes) {
    if (y > footerTop - 70) break;
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
  }

  paintBrand(ctx, p, accent);
  return canvas;
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
  try {
    const file = new File([blob], filename, { type: "image/png" });
    if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
      try {
        await nav.share({ files: [file], text: caption });
        return "shared";
      } catch (e) {
        if (e && (e as { name?: string }).name === "AbortError") return "cancelled";
      }
    }
  } catch {
    /* fall through to download */
  }
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
  drawTrackedLeft(ctx, "COVENANT LEDGER", padX, headerTop + labelSize, 3);
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
      let x = tx;
      ln.forEach((t, i) => {
        if (i > 0) x += sp;
        ctx.font = tokFont(t, size);
        const w = ctx.measureText(t.text).width;
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
        } else if (!t.gap && t.style === "circle") {
          ctx.strokeStyle = penHex(t.color, dark);
          ctx.lineWidth = 2.5;
          roundRect(ctx, x - 4, lineBase - size * 0.86, w + 8, size * 1.12, size * 0.55);
          ctx.stroke();
        }
        x += w;
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
