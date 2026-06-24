// ===========================================================================
// migrateStudies.ts — one-time converter from the three old stores to the
// unified Study model (spec §10).
//
// Standalone and SAFE: nothing imports this yet, and it only READS the old
// shapes (passed in) — it never writes or deletes anything. Wiring it to
// localStorage and the new store happens in a later step; at that point it
// runs non-destructively (old keys are left in place as a fallback).
//
// migrateStudies() is the pure, tested core. readOldStores() is a thin
// localStorage reader for convenience at wire-in time.
// ===========================================================================

import { Member, Study, StudyView, orderOf } from "./studyModel";

// --- The old record shapes, exactly as stored today ------------------------

interface OldRecordedStudy {
  id: string;
  type: "chapter" | "linked";
  bookId: string;
  name: string;
  scopeRef: string; // chapter scope (chapter) OR a group id (linked)
  extraRefs?: string[];
  extraRefsAt?: number;
  view?: StudyView;
  compiledAt?: number;
  nameAt?: number;
  deletedAt?: number;
}

interface OldSearchStudy {
  id: string;
  name: string;
  bookId: string;
  refs: string[];
  view?: "outline" | "distilled" | "covenants"; // keyword studies never had charting
  linkedScope?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

type ChapterGroups = Record<string, string>; // chapter scope -> group id

export const OLD_KEYS = {
  recorded: "scribal_studies_v1",
  searches: "scribal_search_studies",
  chapterGroups: "scribal_linked_chapters",
} as const;

// --- Conversion -------------------------------------------------------------

function normalizeView(v: string | undefined): StudyView {
  if (v === "outline" || v === "charting" || v === "distilled" || v === "covenants") {
    return v;
  }
  return "outline";
}

/** A recorded chapter/linked study → a unified Study.
 *  chapter:  one chapter member (+ extraRefs as a verses member)
 *  linked:   every chapter in its group, in scripture order (+ extraRefs) */
function convertRecorded(s: OldRecordedStudy, groups: ChapterGroups): Study {
  const members: Member[] = [];

  if (s.type === "linked") {
    const scopes = Object.keys(groups)
      .filter((scope) => groups[scope] === s.scopeRef)
      .sort((a, b) => orderOf(a) - orderOf(b));
    for (const scope of scopes) members.push({ kind: "chapter", scope });
  } else {
    members.push({ kind: "chapter", scope: s.scopeRef });
  }

  if (s.extraRefs && s.extraRefs.length) {
    members.push({ kind: "verses", refs: s.extraRefs.slice() });
  }

  const when = s.compiledAt || s.nameAt || Date.now();
  return {
    id: s.id,
    name: s.name,
    members,
    view: normalizeView(s.view),
    bookId: s.bookId,
    createdAt: when,
    updatedAt: Math.max(s.compiledAt || 0, s.extraRefsAt || 0) || when,
    compiledAt: s.compiledAt,
    nameAt: s.nameAt,
  };
}

/** A keyword study → a unified Study.
 *  its refs as a verses member (+ its linkedScope chapter, if any). */
function convertSearch(s: OldSearchStudy): Study {
  const members: Member[] = [];

  if (s.linkedScope) members.push({ kind: "chapter", scope: s.linkedScope });
  if (s.refs && s.refs.length) members.push({ kind: "verses", refs: s.refs.slice() });

  return {
    id: s.id,
    name: s.name,
    members,
    view: normalizeView(s.view),
    bookId: s.bookId,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    compiledAt: s.updatedAt, // keyword studies become "compiled" in the new model
  };
}

/** Pure core: the three parsed stores → unified Study[]. Tombstoned
 *  (deletedAt-stamped) records are skipped — the new store holds live studies
 *  only. Original ids, names, books, views and timestamps carry across. */
export function migrateStudies(
  recorded: OldRecordedStudy[],
  searches: OldSearchStudy[],
  chapterGroups: ChapterGroups
): Study[] {
  const out: Study[] = [];
  for (const s of recorded) {
    if (!s.deletedAt) out.push(convertRecorded(s, chapterGroups));
  }
  for (const s of searches) {
    if (!s.deletedAt) out.push(convertSearch(s));
  }
  return out;
}

// --- Convenience: read + parse the old localStorage keys -------------------

/** Reads and parses the three old stores. Safe to call where localStorage may
 *  be absent; missing/corrupt keys fall back to empty. */
export function readOldStores(): {
  recorded: OldRecordedStudy[];
  searches: OldSearchStudy[];
  chapterGroups: ChapterGroups;
} {
  const get = (k: string): string | null => {
    try {
      if (typeof localStorage === "undefined") return null;
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  function parse<T>(raw: string | null, fallback: T): T {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return {
    recorded: parse<OldRecordedStudy[]>(get(OLD_KEYS.recorded), []),
    searches: parse<OldSearchStudy[]>(get(OLD_KEYS.searches), []),
    chapterGroups: parse<ChapterGroups>(get(OLD_KEYS.chapterGroups), {}),
  };
}
