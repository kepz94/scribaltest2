import scriptures from "./scriptures.json";

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

(() => {
  let order = 0;
  const vols: any[] = (scriptures as any).volumes || [];
  for (const vol of vols) {
    const books: any[] = vol.books || [];
    for (const book of books) {
      const chapters: any[] = book.chapters || [];
      for (const ch of chapters) {
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
        }
      }
    }
  }
})();

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
