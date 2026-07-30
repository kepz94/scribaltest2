import { getScriptures, registerOnLoaded } from "./scripturesStore";

// A flat, canonical-order index over every verse in scriptures.json. This is a
// pure projection of the same file the reader uses, so it can never drift from
// what marks reference. Used by the study table (verse panel + scripture cards).

export interface VerseRec {
  reference: string; // e.g. "Alma 32:21"
  text: string;
  verse: number; // verse number within its chapter
  chapterRef: string; // e.g. "Alma 32" (everything before the final ":")
  order: number; // canonical position across the whole library
}

const list: VerseRec[] = [];
const byRef = new Map<string, VerseRec>();
// Chapter scope ("Alma 32") -> the reader's volume/book/chapter indices and
// the chapter's first verse ref — for opening a reading view at a scope.
const chapterLoc = new Map<
  string,
  { volume: number; book: number; chapter: number; firstRef: string }
>();

let indexBuilt = false;
registerOnLoaded(() => buildVerseIndex());
// Fills the module-scope indexes from the runtime-loaded scripture data.
// Root awaits loadScriptures() before rendering anything, and the store calls
// this the moment the fetch resolves — so every consumer downstream of the
// gate sees complete indexes. All exported constants (verseList etc.) keep
// their identities; this only fills them.
export function buildVerseIndex(): void {
  if (indexBuilt) return;
  indexBuilt = true;
  let order = 0;
  const vols: any[] = getScriptures().volumes || [];
  for (let vi = 0; vi < vols.length; vi++) {
    const vol = vols[vi];
    const books: any[] = vol.books || [];
    for (let bi = 0; bi < books.length; bi++) {
      const book = books[bi];
      const chapters: any[] = book.chapters || [];
      for (let ci = 0; ci < chapters.length; ci++) {
        const ch = chapters[ci];
        const verses: any[] = ch.verses || [];
        for (const v of verses) {
          const reference: string = v.reference;
          if (!reference) continue;
          const cut = reference.lastIndexOf(":");
          const chapterRef = cut > 0 ? reference.slice(0, cut) : reference;
          const rec: VerseRec = {
            reference,
            text: v.text || "",
            verse: typeof v.verse === "number" ? v.verse : order,
            chapterRef,
            order: order++,
          };
          list.push(rec);
          byRef.set(reference, rec);
          if (!chapterLoc.has(chapterRef))
            chapterLoc.set(chapterRef, {
              volume: vi,
              book: bi,
              chapter: ci,
              firstRef: reference,
            });
        }
      }
    }
  }
}

// Reader indices for a chapter scope, or undefined for an unknown scope.
export function chapterLocFor(
  scope: string
): { volume: number; book: number; chapter: number } | undefined {
  const loc = chapterLoc.get(scope);
  return loc
    ? { volume: loc.volume, book: loc.book, chapter: loc.chapter }
    : undefined;
}

// The first verse reference of a chapter scope (a real ref, so it can be a
// reading view's jump target), or undefined.
export function firstVerseRefOfScope(scope: string): string | undefined {
  const loc = chapterLoc.get(scope);
  return loc ? loc.firstRef : undefined;
}

export const verseList = list;

export function getVerse(reference: string): VerseRec | undefined {
  return byRef.get(reference);
}

// Sort a set of references into canonical order (unknown refs sink to the end
// but keep a stable relative order).
export function sortRefs(refs: string[]): string[] {
  return refs
    .slice()
    .sort(
      (a, b) =>
        (byRef.get(a)?.order ?? Number.MAX_SAFE_INTEGER) -
        (byRef.get(b)?.order ?? Number.MAX_SAFE_INTEGER)
    );
}

// True only when the references form a single unbroken passage: same chapter and
// strictly sequential verse numbers (so "One passage" is offered only when it is
// actually meaningful).
export function isConsecutive(refs: string[]): boolean {
  if (refs.length < 2) return refs.length === 1;
  const recs = refs.map((r) => byRef.get(r));
  if (recs.some((r) => !r)) return false;
  const sorted = (recs as VerseRec[])
    .slice()
    .sort((a, b) => a.order - b.order);
  const chapter = sorted[0].chapterRef;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].chapterRef !== chapter) return false;
    if (i > 0 && sorted[i].verse !== sorted[i - 1].verse + 1) return false;
  }
  return true;
}

// A compact range label for a passage, e.g. "Alma 32:21–24". Falls back to the
// single reference when there is only one verse.
export function passageLabel(refs: string[]): string {
  const sorted = sortRefs(refs);
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return sorted[0];
  const first = byRef.get(sorted[0]);
  const last = byRef.get(sorted[sorted.length - 1]);
  if (!first || !last) return sorted[0];
  return first.reference + "\u2013" + last.verse;
}
