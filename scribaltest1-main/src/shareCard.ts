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

function paintBackground(ctx: CanvasRenderingContext2D, p: Palette) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, p.bg);
  g.addColorStop(1, p.bg2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = p.frame;
  ctx.lineWidth = 2;
  roundRect(ctx, 46, 46, W - 92, H - 92, 26);
  ctx.stroke();
}

function paintBrand(ctx: CanvasRenderingContext2D, p: Palette, accent: string) {
  const cx = W / 2;
  const y = H - 116;
  const s = 46;
  ctx.save();
  ctx.fillStyle = p.text;
  roundRect(ctx, cx - 92, y - s / 2, s, s, 12);
  ctx.fill();
  ctx.fillStyle = p.bg;
  ctx.font = "600 26px " + SERIF;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("S", cx - 92 + s / 2, y + 1);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(cx - 92 + s - 6, y - s / 2 + 6, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = p.muted;
  ctx.font = "600 30px " + SANS;
  ctx.textAlign = "left";
  ctx.fillText("Scribal", cx - 92 + s + 16, y + 1);
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

function newCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
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
