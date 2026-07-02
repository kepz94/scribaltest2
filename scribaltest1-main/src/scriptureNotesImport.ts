// ---------------------------------------------------------------------------
// ScriptureNotes import
//
// ScriptureNotes' ONLY export is a printable PDF "report". A report has a
// predictable shape:
//
//     <Title>
//     Tags            (label; values optional)
//     Categories      (label; values optional)
//     <description paragraph(s)>
//     Favorites (★): Ref ; Ref ; Ref ...
//     <Reference>. <verse text>          ← body; favorites are prefixed "★ "
//     ...
//
// plus a print header/footer on every page ("6/18/26, 4:59 PM Title Report"
// and "about:blank 1/3") that must be stripped, and long lines that the PDF
// wraps and we must rejoin.
//
// This module turns that report into a structured result whose references are
// resolved against Scribal's own scripture data, so the importer can build a
// real Search Study and tell the user exactly what matched.
// ---------------------------------------------------------------------------
import { getScriptures, volumesProxy } from "./data/scripturesStore";

export interface ParsedVerse {
  ref: string; // canonical Scribal reference (e.g. "D&C 20:41")
  favorite: boolean;
}

export interface UnmatchedRef {
  raw: string; // as written in the report (e.g. "Doctrine and Covenants 200:1")
  favorite: boolean;
}

export interface ParsedImport {
  title: string;
  description: string;
  verses: string[]; // matched references, in scripture order
  favorites: string[]; // matched favorite references, in scripture order
  unmatched: UnmatchedRef[]; // references that did not resolve (never silently dropped)
}

// ---------------------------------------------------------------------------
// Reference index, built once from the scripture data.
//   - `refSet`         : every valid verse reference
//   - `orderOf`        : scripture-order index for sorting
//   - `prefixByBook`   : normalized book name / prefix  ->  the prefix used in
//                        references (handles "Doctrine and Covenants" -> "D&C")
// ---------------------------------------------------------------------------
const refSet = new Set<string>();
const orderOf = new Map<string, number>();
const prefixByBook = new Map<string, string>();
const vtextByRef = new Map<string, string>();

const norm = (s: string): string =>
  s.replace(/[—–]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();

(() => {
  let n = 0;
  const vols = getScriptures().volumes || [];
  for (const v of vols) {
    for (const b of v.books || []) {
      const chapters = b.chapters || [];
      const sample =
        chapters[0] && chapters[0].verses && chapters[0].verses[0]
          ? chapters[0].verses[0].reference
          : "";
      const prefix = sample.replace(/\s\d+:\d+$/, ""); // "D&C 20:1" -> "D&C"
      if (b.book) prefixByBook.set(norm(b.book), prefix);
      if (prefix) prefixByBook.set(norm(prefix), prefix);
      for (const c of chapters) {
        for (const ver of c.verses || []) {
          const r = ver.reference;
          if (!refSet.has(r)) {
            refSet.add(r);
            orderOf.set(r, n++);
            vtextByRef.set(r, typeof ver.text === "string" ? ver.text : "");
          }
        }
      }
    }
  }
})();

// Resolve a (book text, chapter, verse) triple to a canonical reference, or null.
function resolveRef(
  bookText: string,
  chapter: string,
  verse: string
): string | null {
  const prefix = prefixByBook.get(norm(bookText));
  if (!prefix) return null;
  const cand = `${prefix} ${chapter}:${verse}`;
  return refSet.has(cand) ? cand : null;
}

const byScriptureOrder = (a: string, b: string): number =>
  (orderOf.get(a) ?? 1e12) - (orderOf.get(b) ?? 1e12);

// Full text of a canonical verse reference (empty string if unknown).
export function verseTextOf(ref: string): string {
  return vtextByRef.get(ref) || "";
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------
// A verse line: optional ★, then "<Book> <ch>:<v>" followed by ". " and text.
// Non-greedy book capture so the chapter:verse anchor wins.
const VERSE_RX = /^(★\s*)?(.+?)\s(\d+):(\d+)[.\u2024]\s*(.*)$/;
const FAV_LABEL_RX = /^Favorites?\s*\(★\)\s*:?\s*(.*)$/i;
const SINGLE_REF_RX = /^(.+?)\s(\d+):(\d+)$/;

function cleanLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\u00a0/g, " ").trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !/about:blank/i.test(l) && // print footer
        !/^\d{1,2}\/\d{1,2}\/\d{2,4},/.test(l) // print header "6/18/26, 4:59 PM ..."
    );
}

export function parseScriptureNotes(text: string): ParsedImport {
  const lines = cleanLines(text);
  if (lines.length === 0) {
    return { title: "", description: "", verses: [], favorites: [], unmatched: [] };
  }

  const title = lines[0];

  // Locate the first verse line and the Favorites label (if any).
  let bodyStart = lines.length;
  let favIdx: number | null = null;
  for (let i = 1; i < lines.length; i++) {
    if (favIdx === null && FAV_LABEL_RX.test(lines[i])) favIdx = i;
    if (VERSE_RX.test(lines[i])) {
      bodyStart = i;
      break;
    }
  }

  // Description = everything between the header labels and the favorites/body,
  // minus the bare "Tags"/"Categories" labels.
  const descStop = favIdx !== null ? favIdx : bodyStart;
  const descLines: string[] = [];
  for (let i = 1; i < descStop; i++) {
    const l = lines[i];
    if (l === "Tags" || l === "Categories") continue;
    descLines.push(l);
  }
  const description = descLines.join(" ").trim();

  // Favorites label list (may wrap across lines until the body starts).
  const favFromLabel: string[] = [];
  if (favIdx !== null) {
    const chunk = lines.slice(favIdx, bodyStart).join(" ");
    const m = chunk.match(FAV_LABEL_RX);
    if (m) {
      for (const part of m[1].split(/[;,]/)) {
        const mm = part.trim().match(SINGLE_REF_RX);
        if (mm) {
          const r = resolveRef(mm[1].trim(), mm[2], mm[3]);
          if (r) favFromLabel.push(r);
        }
      }
    }
  }

  // Body: group lines into verse blocks (each starts at a verse line; following
  // continuation lines belong to it). Only the first line of a block is parsed.
  const verses: ParsedVerse[] = [];
  const unmatched: UnmatchedRef[] = [];
  let cur: string | null = null;
  const flush = () => {
    if (cur === null) return;
    const m = cur.match(VERSE_RX);
    if (m) {
      const fav = !!m[1];
      const r = resolveRef(m[2].trim(), m[3], m[4]);
      if (r) verses.push({ ref: r, favorite: fav });
      else unmatched.push({ raw: `${m[2].trim()} ${m[3]}:${m[4]}`, favorite: fav });
    }
    cur = null;
  };
  for (let i = bodyStart; i < lines.length; i++) {
    if (VERSE_RX.test(lines[i])) {
      flush();
      cur = lines[i];
    } else if (cur !== null) {
      cur += " " + lines[i];
    }
  }
  flush();

  // Final ref lists: dedupe + scripture order. Favorites = inline ★ ∪ label list.
  const favSet = new Set<string>(favFromLabel);
  for (const v of verses) if (v.favorite) favSet.add(v.ref);
  const matched = Array.from(new Set(verses.map((v) => v.ref))).sort(
    byScriptureOrder
  );
  const favorites = Array.from(favSet).sort(byScriptureOrder);

  return { title, description, verses: matched, favorites, unmatched };
}

// ---------------------------------------------------------------------------
// PDF text extraction (pdf.js, lazy-loaded from CDN so it never bloats the
// main bundle and needs no package.json change). Text-based PDF only — the
// ScriptureNotes export is text, not scanned images.
// ---------------------------------------------------------------------------
const PDFJS_VERSION = "3.11.174";
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;
let pdfjsPromise: Promise<any> | null = null;

function loadPdfjs(): Promise<any> {
  const w = window as any;
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib);
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${PDFJS_BASE}/pdf.min.js`;
    script.async = true;
    script.onload = () => {
      const lib = (window as any).pdfjsLib;
      if (!lib) {
        reject(new Error("The PDF reader failed to load."));
        return;
      }
      try {
        lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.js`;
      } catch {
        /* ignore */
      }
      resolve(lib);
    };
    script.onerror = () => {
      pdfjsPromise = null;
      reject(
        new Error("Couldn't load the PDF reader — check your internet connection.")
      );
    };
    document.head.appendChild(script);
  });
  return pdfjsPromise;
}

export async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await loadPdfjs();
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    let cur = "";
    let prevEndX: number | null = null;
    let prevY: number | null = null;
    const pushLine = () => {
      const t = cur.replace(/\s+/g, " ").trim();
      if (t) lines.push(t);
      cur = "";
      prevEndX = null;
    };
    for (const it of content.items as any[]) {
      const s = typeof it.str === "string" ? it.str : "";
      const tr = it.transform || [1, 0, 0, 1, 0, 0];
      const x = tr[4];
      const y = tr[5];
      const fontH = Math.abs(tr[3]) || Math.abs(tr[0]) || 10;
      const w = typeof it.width === "number" ? it.width : 0;
      // New visual line when the baseline shifts vertically.
      if (prevY !== null && Math.abs(y - prevY) > Math.max(2, fontH * 0.5)) {
        pushLine();
        prevY = null;
      }
      if (s) {
        // Insert a space when there's a real horizontal gap between runs (about
        // a space wide), so "Matthew" + "3:11" becomes "Matthew 3:11" without
        // splitting kerned letters inside a word.
        if (
          prevEndX !== null &&
          x - prevEndX > fontH * 0.28 &&
          !cur.endsWith(" ") &&
          !s.startsWith(" ")
        ) {
          cur += " ";
        }
        cur += s;
        prevEndX = x + w;
        prevY = y;
      }
      if (it.hasEOL) {
        pushLine();
        prevY = null;
      }
    }
    pushLine();
  }
  return lines.join("\n");
}

// Convenience: PDF file -> parsed import.
export async function importScriptureNotesPdf(file: File): Promise<ParsedImport> {
  const text = await extractPdfText(file);
  return parseScriptureNotes(text);
}
