// ===========================================================================
// useStudyStore.ts — the unified study store (spec §3, the store piece).
//
// Holds the unified Study[] under a NEW localStorage key, persists it, and on
// first mount (when that key is empty) seeds itself from the old stores via the
// converter — non-destructively (the old keys are read, never written).
//
// SAFE: nothing mounts this hook yet, so it does literally nothing until the
// cutover. Because seeding happens on first mount (not on import), the seed
// will be taken from the CURRENT old stores whenever we actually adopt it — it
// can't go stale in the meantime.
//
// The pure helpers below carry all the logic and are unit-tested in isolation;
// the hook is a thin React wrapper (state + persistence + seeding).
// ===========================================================================

import { useState, useEffect } from "react";
import { Study, Member, StudyView } from "../studyModel";
import { migrateStudies, readOldStores } from "../migrateStudies";

const KEY = "scribal_studies_unified_v1";

function uid(): string {
  return (
    "st_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8)
  );
}

function safeGet(k: string): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function safeParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// --- Pure helpers (the logic; tested in isolation) --------------------------

export function makeStudy(
  name: string,
  members: Member[],
  bookId: string,
  view: StudyView = "outline"
): Study {
  const now = Date.now();
  return {
    id: uid(),
    name,
    members: normalizeMembers(members),
    view,
    bookId,
    createdAt: now,
    updatedAt: now,
  };
}

/** Canonical member shape for storage: chapter members deduped by scope, then
 *  a single consolidated verses member holding all loose refs (deduped). The
 *  resolver tolerates any shape, but normalizing keeps the store tidy and makes
 *  membership editing predictable. */
export function normalizeMembers(members: Member[]): Member[] {
  const chapters: string[] = [];
  const verses: string[] = [];
  const seenVerse = new Set<string>();
  for (const m of members) {
    if (m.kind === "chapter") {
      if (!chapters.includes(m.scope)) chapters.push(m.scope);
    } else {
      for (const r of m.refs) {
        if (!seenVerse.has(r)) {
          seenVerse.add(r);
          verses.push(r);
        }
      }
    }
  }
  const out: Member[] = chapters.map((scope) => ({ kind: "chapter", scope }));
  if (verses.length) out.push({ kind: "verses", refs: verses });
  return out;
}

export function addMembersTo(study: Study, add: Member[]): Study {
  return {
    ...study,
    members: normalizeMembers([...study.members, ...add]),
    updatedAt: Date.now(),
  };
}

export function removeChapterFrom(study: Study, scope: string): Study {
  return {
    ...study,
    members: study.members.filter(
      (m) => !(m.kind === "chapter" && m.scope === scope)
    ),
    updatedAt: Date.now(),
  };
}

export function removeVersesFrom(study: Study, refs: string[]): Study {
  const drop = new Set(refs);
  const members = study.members
    .map((m) =>
      m.kind === "verses"
        ? { kind: "verses" as const, refs: m.refs.filter((r) => !drop.has(r)) }
        : m
    )
    .filter((m) => !(m.kind === "verses" && m.refs.length === 0));
  return { ...study, members, updatedAt: Date.now() };
}

function loadOrSeed(): Study[] {
  try {
    const raw = safeGet(KEY);
    if (raw) {
      const parsed = safeParse<Study[] | null>(raw, null);
      if (parsed && Array.isArray(parsed)) return parsed;
    }
    // First adoption: seed from the existing stores (read-only).
    const o = readOldStores();
    return migrateStudies(o.recorded, o.searches, o.chapterGroups);
  } catch {
    // Never let unexpected legacy data crash mount — start empty instead.
    return [];
  }
}

// --- The hook ---------------------------------------------------------------

export function useStudyStore() {
  const [studies, setStudies] = useState<Study[]>(loadOrSeed);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(KEY, JSON.stringify(studies));
    } catch {
      return;
    }
  }, [studies]);

  const create = (
    name: string,
    members: Member[],
    bookId: string,
    view: StudyView = "outline"
  ): string => {
    const s = makeStudy(name, members, bookId, view);
    setStudies((prev) => [s, ...prev]);
    return s.id;
  };

  const rename = (id: string, name: string) =>
    setStudies((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, name, nameAt: Date.now(), updatedAt: Date.now() } : s
      )
    );

  const setView = (id: string, view: StudyView) =>
    setStudies((prev) =>
      prev.map((s) => (s.id === id ? { ...s, view, updatedAt: Date.now() } : s))
    );

  const markCompiled = (id: string) =>
    setStudies((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, compiledAt: Date.now(), updatedAt: Date.now() } : s
      )
    );

  const addMembers = (id: string, add: Member[]) =>
    setStudies((prev) => prev.map((s) => (s.id === id ? addMembersTo(s, add) : s)));

  const removeChapter = (id: string, scope: string) =>
    setStudies((prev) =>
      prev.map((s) => (s.id === id ? removeChapterFrom(s, scope) : s))
    );

  const removeVerses = (id: string, refs: string[]) =>
    setStudies((prev) =>
      prev.map((s) => (s.id === id ? removeVersesFrom(s, refs) : s))
    );

  const remove = (id: string) =>
    setStudies((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, deletedAt: Date.now(), updatedAt: Date.now() } : s
      )
    );

  const live = studies.filter((s) => !s.deletedAt);

  return {
    studies: live,
    allStudies: studies,
    create,
    rename,
    setView,
    markCompiled,
    addMembers,
    removeChapter,
    removeVerses,
    remove,
  };
}
