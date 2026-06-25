// scriptureIndex.ts
// -----------------------------------------------------------------------------
// Single source of truth for turning scripture *scope tokens* into the verse
// references they contain, and for scripture ordering. Built once from
// scriptures.json at module load, then read-only for the rest of the session.
//
// Why this module exists (DRY): App.tsx and MobileApp.tsx each build their own
// near-identical copies of these lookup maps from the same data. The new study
// model resolves through this one index, and both shells can later do the same
// — three copies collapse to one.
//
// A *scope token* is exactly one of:
//   - a chapter scope, verbatim as stored on each chapter ("Genesis 1", "D&C 93")
//   - a book token:   BOOK_TOKEN + book name    ("book:Alma", "book:Doctrine and Covenants")
//   - a volume token: VOLUME_TOKEN + volume name ("vol:Book of Mormon")
// No chapter scope contains a colon (verified across all 2,763 chapters), so the
// "book:" / "vol:" prefixes can never be mistaken for a chapter scope.
// -----------------------------------------------------------------------------

import scriptures from "./data/scriptures.json";

// Minimal shape of the data we read — clearer and safer than `any`.
interface RawVerse {
  reference: string;
}
interface RawChapter {
  reference: string;
  verses: RawVerse[];
}
interface RawBook {
  book: string;
  chapters: RawChapter[];
}
interface RawVolume {
  volume: string;
  books: RawBook[];
}

export const BOOK_TOKEN = "book:";
export const VOLUME_TOKEN = "vol:";

// chapter scope ("Genesis 1") -> its verse references, in order.
const versesByScope = new Map<string, string[]>();
// book name ("Alma") -> its chapter scopes, in order.
const scopesByBook = new Map<string, string[]>();
// volume name ("Book of Mormon") -> its chapter scopes, in order.
const scopesByVolume = new Map<string, string[]>();
// verse reference -> global scripture-order index, for sorting any ref list.
const orderIndex = new Map<string, number>();

// One pass over the canon builds every lookup. Runs once, at import.
((): void => {
  let order = 0;
  const volumes = (scriptures as { volumes: RawVolume[] }).volumes;
  volumes.forEach((vol) => {
    const volScopes: string[] = [];
    vol.books.forEach((bk) => {
      const bookScopes: string[] = [];
      bk.chapters.forEach((ch) => {
        const scope = ch.reference; // the chapter scope IS chapter.reference
        const refs = ch.verses.map((v) => v.reference);
        versesByScope.set(scope, refs);
        refs.forEach((r) => orderIndex.set(r, order++));
        bookScopes.push(scope);
        volScopes.push(scope);
      });
      scopesByBook.set(bk.book, bookScopes);
    });
    scopesByVolume.set(vol.volume, volScopes);
  });
})();

// Verse references for one chapter scope. Empty if the scope is unknown
// (robustness: a stale/unknown scope yields nothing rather than throwing).
// Returned read-only so callers can't mutate the shared index.
export function versesInScope(scope: string): readonly string[] {
  return versesByScope.get(scope) || [];
}

// Chapter scopes contained by a book / volume name. Empty if unknown.
export function scopesInBook(bookName: string): readonly string[] {
  return scopesByBook.get(bookName) || [];
}
export function scopesInVolume(volumeName: string): readonly string[] {
  return scopesByVolume.get(volumeName) || [];
}

// Global scripture order of a verse reference, for sorting a mixed list.
// Unknown refs sort to the end, deterministically.
export function orderOfRef(ref: string): number {
  const i = orderIndex.get(ref);
  return i === undefined ? Number.MAX_SAFE_INTEGER : i;
}
