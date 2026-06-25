// useStudyLibrary.ts
// -----------------------------------------------------------------------------
// The React data layer for the unified study model (studyModel.ts). ONE hook and
// ONE store (scribal_studies_v2) that replace the two separate stores + hooks the
// app uses today (useStudies + useSearchStudies), now that SearchStudy is gone.
//
// Responsibilities (Single Responsibility): own the Study[] -- load it (running
// the one-time migration from the legacy stores on first use), persist it, expose
// the intention-revealing mutations the single Add button needs (add/remove a
// scope, add/remove loose verses, rename, delete, set view/note), and merge a
// remote snapshot for cross-device sync.
//
// This hook is ADDITIVE: nothing imports it until the desktop cutover (Step 2),
// so the app keeps running on the old hooks until then.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { Study, isStudyDeleted, migrateToStudyLibrary } from "../studyModel";
import { orderOfRef } from "../scriptureIndex";

const KEY = "scribal_studies_v2";

// Legacy keys read ONCE to seed v2 on a device that has never run the new model.
// They are never written here, so the old system stays intact as a rollback.
const LEGACY_RECORDED = "scribal_studies_v1";
const LEGACY_SEARCH = "scribal_search_studies";
const LEGACY_LINKS = "scribal_linked_chapters";

const rand = (): string => Math.random().toString(36).slice(2, 7);

const safeGet = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

// Build the initial list. The presence of the v2 KEY -- even when it holds an
// empty array -- means migration has already run on this device, so we must NOT
// re-migrate, or a study the user deleted would be resurrected from the still-
// present legacy keys. We therefore migrate ONLY when the v2 key is absent.
function initStudies(): Study[] {
  const existing = safeGet(KEY);
  if (existing !== null) {
    try {
      const parsed = JSON.parse(existing);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return migrateToStudyLibrary(
    safeGet(LEGACY_RECORDED),
    safeGet(LEGACY_SEARCH),
    safeGet(LEGACY_LINKS)
  );
}

// The most recent action on a record, used to decide which side's cosmetic
// fields (view/note) win on merge. Content fields carry their own stamps.
function recencyOf(s: Study): number {
  return Math.max(
    s.nameAt || 0,
    s.scopesAt || 0,
    s.looseRefsAt || 0,
    s.createdAt || 0
  );
}

// Most-recently-edited list wins (add AND remove propagate). When BOTH stamps are
// absent (legacy), fall back to a de-duplicated union so an older edit is never
// lost until the set is re-edited. Mirrors today's extraRefs merge in useStudies.
function mergeList(
  lArr: string[],
  rArr: string[],
  lAt: number,
  rAt: number
): { list: string[]; at: number } {
  const at = Math.max(lAt, rAt);
  if (rAt > lAt) return { list: rArr, at };
  if (lAt > rAt) return { list: lArr, at };
  const seen = new Set<string>();
  const union: string[] = [];
  [...lArr, ...rArr].forEach((x) => {
    if (!seen.has(x)) {
      seen.add(x);
      union.push(x);
    }
  });
  return { list: union, at };
}

// Merge one remote record into its local twin. Per-FIELD last-write: each content
// field (name / scopes / looseRefs) converges on its own stamp, so a rename on one
// device and a verse edit on another both survive -- an improvement over today's
// keyword-study merge, which bundles name+refs under one stamp and can drop a
// rename. Returns the SAME local reference when nothing changed (idempotency: no
// sync churn).
function mergeStudyPair(local: Study, remote: Study): Study {
  const lNameAt = local.nameAt || local.createdAt || 0;
  const rNameAt = remote.nameAt || remote.createdAt || 0;
  const name = rNameAt > lNameAt ? remote.name : local.name;
  const nameAt = Math.max(lNameAt, rNameAt);

  const scopesMerge = mergeList(
    local.scopes || [],
    remote.scopes || [],
    local.scopesAt || 0,
    remote.scopesAt || 0
  );
  const looseMerge = mergeList(
    local.looseRefs || [],
    remote.looseRefs || [],
    local.looseRefsAt || 0,
    remote.looseRefsAt || 0
  );

  const deletedAt = Math.max(local.deletedAt || 0, remote.deletedAt || 0);

  // Cosmetic fields follow whichever side is overall more recently active.
  const remoteNewer = recencyOf(remote) > recencyOf(local);
  const view = remoteNewer && remote.view ? remote.view : local.view;
  const note = remoteNewer ? remote.note ?? local.note : local.note;

  const same =
    name === local.name &&
    nameAt === (local.nameAt || 0) &&
    scopesMerge.at === (local.scopesAt || 0) &&
    looseMerge.at === (local.looseRefsAt || 0) &&
    scopesMerge.list.join("|") === (local.scopes || []).join("|") &&
    looseMerge.list.join("|") === (local.looseRefs || []).join("|") &&
    deletedAt === (local.deletedAt || 0) &&
    view === local.view &&
    note === local.note;
  if (same) return local;

  const merged: Study = {
    ...local,
    name,
    nameAt,
    scopes: scopesMerge.list,
    scopesAt: scopesMerge.at,
    looseRefs: looseMerge.list,
    looseRefsAt: looseMerge.at,
    view,
  };
  if (note !== undefined) merged.note = note;
  else delete merged.note;
  if (deletedAt) merged.deletedAt = deletedAt;
  return merged;
}

export function useStudyLibrary() {
  const [studies, setStudies] = useState<Study[]>(initStudies);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(studies));
    } catch {
      /* storage unavailable -- studies stay in-session only */
    }
  }, [studies]);

  const createStudy = useCallback(
    (input: {
      name: string;
      bookId: string;
      scopes?: string[];
      looseRefs?: string[];
      view?: Study["view"];
      note?: string;
    }): Study => {
      const now = Date.now();
      const study: Study = {
        id: "study_" + now + "_" + rand(),
        name: input.name.trim() || "Untitled study",
        bookId: input.bookId,
        scopes: input.scopes ? input.scopes.slice() : [],
        looseRefs: input.looseRefs
          ? input.looseRefs
              .slice()
              .sort((a, b) => orderOfRef(a) - orderOfRef(b))
          : [],
        createdAt: now,
        nameAt: now,
        scopesAt: now,
        looseRefsAt: now,
      };
      if (input.view) study.view = input.view;
      if (input.note && input.note.trim()) study.note = input.note.trim();
      setStudies((prev) => [study, ...prev]);
      return study;
    },
    []
  );

  const renameStudy = useCallback((id: string, name: string) => {
    setStudies((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, name: name.trim() || s.name, nameAt: Date.now() }
          : s
      )
    );
  }, []);

  // Soft-delete: tombstone (kept + stamped) so the deletion syncs; filtered out
  // of the returned list below. Matches the tombstone pattern across the app.
  const deleteStudy = useCallback((id: string) => {
    setStudies((prev) =>
      prev.map((s) => (s.id === id ? { ...s, deletedAt: Date.now() } : s))
    );
  }, []);

  // Add a scope token. Idempotent: a token already present is a no-op and does
  // NOT bump the stamp, so re-adding can't churn sync.
  const addScope = useCallback((id: string, token: string) => {
    setStudies((prev) =>
      prev.map((s) => {
        if (s.id !== id || s.scopes.indexOf(token) !== -1) return s;
        return { ...s, scopes: [...s.scopes, token], scopesAt: Date.now() };
      })
    );
  }, []);

  const removeScope = useCallback((id: string, token: string) => {
    setStudies((prev) =>
      prev.map((s) => {
        if (s.id !== id || s.scopes.indexOf(token) === -1) return s;
        return {
          ...s,
          scopes: s.scopes.filter((t) => t !== token),
          scopesAt: Date.now(),
        };
      })
    );
  }, []);

  // Add loose verses (from keyword search or Send). Union + scripture order; only
  // stamps when something new is actually added (idempotent).
  const addLooseRefs = useCallback((id: string, refs: string[]) => {
    setStudies((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const have = new Set(s.looseRefs);
        const added = refs.filter((r) => !have.has(r));
        if (!added.length) return s;
        const next = [...s.looseRefs, ...added].sort(
          (a, b) => orderOfRef(a) - orderOfRef(b)
        );
        return { ...s, looseRefs: next, looseRefsAt: Date.now() };
      })
    );
  }, []);

  const removeLooseRefs = useCallback((id: string, refs: string[]) => {
    const drop = new Set(refs);
    setStudies((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const next = s.looseRefs.filter((r) => !drop.has(r));
        if (next.length === s.looseRefs.length) return s;
        return { ...s, looseRefs: next, looseRefsAt: Date.now() };
      })
    );
  }, []);

  // Remember which compile view a study reopens in. View is cosmetic, so it has
  // no dedicated stamp; on sync it follows whichever device touched the study
  // most recently (see mergeStudyPair). Add a viewAt stamp if instant view-sync
  // is ever needed.
  const setView = useCallback((id: string, view: Study["view"]) => {
    setStudies((prev) => prev.map((s) => (s.id === id ? { ...s, view } : s)));
  }, []);

  const setNote = useCallback((id: string, note: string) => {
    const trimmed = note.trim();
    setStudies((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        if (trimmed) return { ...s, note: trimmed };
        const next = { ...s };
        delete next.note;
        return next;
      })
    );
  }, []);

  const mergeRemote = useCallback((raw: string | null | undefined) => {
    if (!raw) return;
    let remote: Study[];
    try {
      const parsed = JSON.parse(raw);
      remote = Array.isArray(parsed) ? parsed : [];
    } catch {
      return;
    }
    if (!remote.length) return;
    setStudies((prev) => {
      const byId = new Map<string, Study>(prev.map((s) => [s.id, s]));
      let changed = false;
      remote.forEach((r) => {
        if (!r || !r.id) return;
        const local = byId.get(r.id);
        if (!local) {
          byId.set(r.id, r);
          changed = true;
          return;
        }
        const merged = mergeStudyPair(local, r);
        if (merged !== local) {
          byId.set(r.id, merged);
          changed = true;
        }
      });
      if (!changed) return prev; // idempotent -- don't churn sync
      return Array.from(byId.values()).sort(
        (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
      );
    });
  }, []);

  // Consumers see only live studies; the full list (with tombstones) is what's
  // persisted + synced so deletions propagate between devices.
  const visibleStudies = studies.filter((s) => !isStudyDeleted(s));

  return {
    studies: visibleStudies,
    createStudy,
    renameStudy,
    deleteStudy,
    addScope,
    removeScope,
    addLooseRefs,
    removeLooseRefs,
    setView,
    setNote,
    mergeRemote,
    setStudies,
  };
}
