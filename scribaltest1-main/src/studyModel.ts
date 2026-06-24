// ===========================================================================
// studyModel.ts — the unified study model + resolver.
//
// This is the foundation of the redesign (spec §3–4). It is INTENTIONALLY
// standalone: nothing imports it yet, so adding this file cannot affect the
// running app. The existing stores (useStudies / useSearchStudies /
// chapterGroups) and compile feed are untouched. Later steps wire this in.
//
// One study = a name + an ordered list of MEMBERS. A member is either a whole
// chapter or a set of loose verses. resolveStudy() flattens members to a
// scripture-ordered, deduped reference set and the marks that fall on it —
// the single bundle every compile format will be fed.
// ===========================================================================

import scriptures from "./data/scriptures.json";
import { Mark, MarkColor } from "./types";

// --- The unified model ------------------------------------------------------

/** A member is the only place the chapter-vs-verse distinction survives. It
 *  exists purely so the resolver knows how much scripture to pull. */
export type Member =
  | { kind: "chapter"; scope: string } // scope === a chapter reference, e.g. "1 Nephi 2"
  | { kind: "verses"; refs: string[] }; // e.g. ["1 Nephi 2:11", "1 Nephi 2:12"]

export type StudyView = "outline" | "charting" | "distilled" | "covenants";

/** One kind of study. No more chapter/linked/keyword types — how members were
 *  gathered is not stored here, only what they are. */
export interface Study {
  id: string;
  name: string;
  members: Member[];
  view: StudyView;
  bookId: string; // "master" or a session book id — which book holds the marks
  createdAt: number;
  updatedAt: number;
  compiledAt?: number;
  nameAt?: number;
  deletedAt?: number; // tombstone for cross-device delete convergence
}

// --- Scripture indices (built once at module load) --------------------------

// Global scripture order for every verse reference, and the verse list for
// every chapter scope. Built once from scriptures.json.
const REF_ORDER = new Map<string, number>();
const CHAPTER_VERSES = new Map<string, string[]>();

(() => {
  let order = 0;
  const vols = (scriptures as { volumes: any[] }).volumes;
  for (const vol of vols) {
    for (const book of vol.books) {
      for (const chap of book.chapters) {
        const verseRefs: string[] = [];
        for (const v of chap.verses) {
          REF_ORDER.set(v.reference, order);
          order += 1;
          verseRefs.push(v.reference);
        }
        // chap.reference is the chapter scope, e.g. "1 Nephi 2"
        CHAPTER_VERSES.set(chap.reference, verseRefs);
      }
    }
  }
})();

/** Scripture-order rank for a reference (verse refs and chapter scopes share
 *  the verse index; a chapter scope sorts at its first verse). Unknown refs
 *  sort last. */
export function orderOf(reference: string): number {
  const direct = REF_ORDER.get(reference);
  if (direct !== undefined) return direct;
  // Maybe it's a chapter scope — rank it at its first verse.
  const verses = CHAPTER_VERSES.get(reference);
  if (verses && verses.length) {
    const first = REF_ORDER.get(verses[0]);
    if (first !== undefined) return first;
  }
  return Number.MAX_SAFE_INTEGER;
}

/** True if a string is a known chapter scope (e.g. "1 Nephi 2"). */
export function isChapterScope(scope: string): boolean {
  return CHAPTER_VERSES.has(scope);
}

// --- The resolver -----------------------------------------------------------

/** Flatten members → scripture-ordered, deduped verse references.
 *  Chapter members expand to their whole chapter's verses; verse members
 *  contribute only themselves. A chapter absorbs any loose verses it contains
 *  (no duplicates), regardless of the order members were added. */
export function resolveStudyRefs(members: Member[]): string[] {
  const set = new Set<string>();
  for (const m of members) {
    if (m.kind === "chapter") {
      const verses = CHAPTER_VERSES.get(m.scope);
      if (verses) for (const r of verses) set.add(r);
    } else {
      for (const r of m.refs) set.add(r);
    }
  }
  return Array.from(set).sort((a, b) => orderOf(a) - orderOf(b));
}

export interface ResolvedStudy {
  refs: string[];
  marks: Mark[];
  themeLabels: Record<MarkColor, string>;
}

/** The single bundle every compile format receives. `marks` should be the
 *  marks of the study's book; only those falling on the resolved refs are
 *  returned. `themeLabels` is the study's palette and passes through. */
export function resolveStudy(
  members: Member[],
  marks: Mark[],
  themeLabels: Record<MarkColor, string>
): ResolvedStudy {
  const refs = resolveStudyRefs(members);
  const refSet = new Set(refs);
  return {
    refs,
    marks: marks.filter((m) => refSet.has(m.reference)),
    themeLabels,
  };
}
