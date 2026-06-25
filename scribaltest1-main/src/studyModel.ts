// studyModel.ts
// -----------------------------------------------------------------------------
// The unified study model: ONE record type that replaces the old separate
// linking representations. There is no "linking", "keyword search into a
// chapter", or "send" as distinct acts anymore -- there is only ADDING to a
// study, in one of two ways:
//   - Add scope:  a chapter / book / volume -> goes in `scopes` (live; marks
//                 always reflect the current state of those chapters).
//   - Add verses: hand-picked or found by search -> goes in `looseRefs`.
//
// Linking is PER-STUDY: two chapters are "linked" precisely because they are in
// the same study's `scopes` list. There is no global link map at runtime -- a
// study's `scopes` list is the only thing that groups chapters (KISS / DRY: one
// place, the study itself).
//
// Compiled set = (every verse in `scopes`, expanded) + looseRefs. That single
// rule is resolveStudyRefs() below.
//
// NOTE on migration: the OLD system stored chapter links in a global map
// (scribal_linked_chapters). migrateToStudyLibrary() reads that map ONCE to
// reconstruct each existing linked study into its member chapters; afterward the
// map is never consulted again (the key is left in storage as a rollback).
// -----------------------------------------------------------------------------

import {
  versesInScope,
  scopesInBook,
  scopesInVolume,
  orderOfRef,
  BOOK_TOKEN,
  VOLUME_TOKEN,
} from "./scriptureIndex";

export interface Study {
  id: string;
  name: string;
  bookId: string; // which StudyBook holds the marks ("master" or a session)
  scopes: string[]; // tokens: "1 Nephi 3" | "book:Alma" | "vol:Book of Mormon"
  looseRefs: string[]; // hand-picked verse refs, kept in scripture order
  view?: "outline" | "charting" | "distilled" | "covenants";
  note?: string; // optional overview (carried from the ScriptureNotes import)
  createdAt: number;
  // Per-field last-write stamps. Each guards its OWN field, so add AND remove
  // converge across devices -- the same mechanism today's extraRefsAt and
  // refs/updatedAt use. On merge, the field whichever device touched last wins.
  nameAt?: number;
  scopesAt?: number;
  looseRefsAt?: number;
  // Tombstone: deleted only while this is the newest action (>= every *At), so a
  // later rename/edit revives it. Carried in the record so a delete syncs.
  deletedAt?: number;
}

// Hidden iff its delete is its newest action (unifies the old isStudyDeleted /
// isSearchStudyDeleted predicates into one).
export function isStudyDeleted(s: Study): boolean {
  const newest = Math.max(
    s.nameAt || 0,
    s.scopesAt || 0,
    s.looseRefsAt || 0,
    s.createdAt || 0
  );
  return !!s.deletedAt && s.deletedAt >= newest;
}

// Expand one scope token to the chapter scopes it covers. A chapter token is
// itself; book/volume tokens fan out through the index. (KISS: the single place
// a token's shape is interpreted.)
function chapterScopesOfToken(token: string): readonly string[] {
  if (token.startsWith(BOOK_TOKEN)) {
    return scopesInBook(token.slice(BOOK_TOKEN.length));
  }
  if (token.startsWith(VOLUME_TOKEN)) {
    return scopesInVolume(token.slice(VOLUME_TOKEN.length));
  }
  return [token]; // already a chapter scope
}

// THE compile rule. Pure -- same inputs always give the same output, with no
// React and no storage -- so it is trivially unit-testable (principle: make code
// easy to test) and is the ONLY place the compiled reference set is defined.
//
// Per-study model: a study compiles exactly the scopes in its own list (chapter
// tokens expanded, book/volume tokens fanned out) plus its loose verses. No
// global link map is consulted -- the `scopes` list IS the grouping.
export function resolveStudyRefs(
  study: Pick<Study, "scopes" | "looseRefs">
): string[] {
  // 1) scope tokens -> the set of chapter scopes they cover (de-duped, so an
  //    overlapping chapter + book/volume token never double-counts)
  const chapterScopeSet = new Set<string>();
  study.scopes.forEach((token) =>
    chapterScopesOfToken(token).forEach((s) => chapterScopeSet.add(s))
  );

  // 2) chapter scopes -> verse refs, then add the loose refs
  const refSet = new Set<string>();
  chapterScopeSet.forEach((scope) =>
    versesInScope(scope).forEach((r) => refSet.add(r))
  );
  (study.looseRefs || []).forEach((r) => refSet.add(r));

  // 3) one ordered, de-duplicated list in scripture order
  return Array.from(refSet).sort((a, b) => orderOfRef(a) - orderOfRef(b));
}

// ---------------------------------------------------------------------------
// One-time migration: the three legacy stores -> the unified Study[].
//
// READS the legacy localStorage values and produces the new list; it never
// writes (the hook persists the result, and the old keys stay as a rollback).
// Mapping:
//   recorded chapter study : scopes = [scopeRef]
//   recorded linked study  : scopes = the group's member chapters, read ONCE
//                            from the old global link map (chapterGroups)
//   keyword study          : scopes = linkedScope ? [linkedScope] : []
//   extraRefs / refs       -> looseRefs
// 1:1 and id-preserving: each old record becomes exactly one Study; two studies
// about the same chapter stay two studies (intent is never merged). Robust to
// malformed input: anything unparseable contributes nothing instead of throwing.
// ---------------------------------------------------------------------------

interface OldRecorded {
  id: string;
  type: "chapter" | "linked";
  bookId: string;
  name: string;
  scopeRef: string;
  extraRefs?: string[];
  extraRefsAt?: number;
  view?: Study["view"];
  compiledAt: number;
  nameAt?: number;
  deletedAt?: number;
}

interface OldSearch {
  id: string;
  name: string;
  bookId: string;
  refs: string[];
  createdAt: number;
  updatedAt?: number;
  deletedAt?: number;
  note?: string;
  view?: "outline" | "distilled" | "covenants";
  linkedScope?: string;
}

function parseArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseGroups(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

export function migrateToStudyLibrary(
  recordedRaw: string | null | undefined,
  searchRaw: string | null | undefined,
  linkedChaptersRaw: string | null | undefined
): Study[] {
  // Old global link map, read ONCE here only to reconstruct existing linked
  // studies into their member chapters. Never consulted again after migration.
  const chapterGroups = parseGroups(linkedChaptersRaw);
  const membersByGroup = new Map<string, string[]>();
  Object.keys(chapterGroups).forEach((scope) => {
    const gid = chapterGroups[scope];
    const arr = membersByGroup.get(gid);
    if (arr) arr.push(scope);
    else membersByGroup.set(gid, [scope]);
  });

  const byId = new Map<string, Study>();

  // Recorded chapter / linked studies (scribal_studies_v1).
  parseArray<OldRecorded>(recordedRaw).forEach((o) => {
    if (!o || !o.id) return;
    const scopes =
      o.type === "linked"
        ? (membersByGroup.get(o.scopeRef) || []).slice()
        : o.scopeRef
        ? [o.scopeRef]
        : [];
    const compiledAt = o.compiledAt || Date.now();
    const study: Study = {
      id: o.id,
      name: o.name,
      bookId: o.bookId,
      scopes,
      looseRefs: (o.extraRefs || []).slice(),
      view: o.view,
      createdAt: compiledAt,
      nameAt: o.nameAt || compiledAt,
      scopesAt: compiledAt,
      looseRefsAt: o.extraRefsAt || compiledAt,
    };
    if (o.deletedAt) study.deletedAt = o.deletedAt;
    byId.set(o.id, study);
  });

  // Keyword studies (scribal_search_studies) -- SearchStudy is gone; each becomes
  // a Study with no scope (plain) or one scope (its old linkedScope).
  parseArray<OldSearch>(searchRaw).forEach((o) => {
    if (!o || !o.id) return;
    const at = o.updatedAt || o.createdAt || Date.now();
    const study: Study = {
      id: o.id,
      name: o.name,
      bookId: o.bookId,
      scopes: o.linkedScope ? [o.linkedScope] : [],
      looseRefs: (o.refs || []).slice(),
      view: o.view,
      note: o.note,
      createdAt: o.createdAt || at,
      nameAt: at,
      scopesAt: at,
      looseRefsAt: at,
    };
    if (o.deletedAt) study.deletedAt = o.deletedAt;
    // Old ids are prefix-disjoint ("study_" vs "ss_"), so this never clobbers.
    byId.set(o.id, study);
  });

  return Array.from(byId.values()).sort(
    (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
  );
}
