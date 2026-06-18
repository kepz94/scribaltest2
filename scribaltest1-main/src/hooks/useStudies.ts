import { useEffect, useState } from "react";

// A recorded study = a compiled chapter or linked group. Keyword studies live
// separately in useSearchStudies; the Studies hub shows all three together.
// This store shares its localStorage key + shape with the mobile app, so a
// study compiled on either device shows up on the other.
export interface Study {
  id: string;
  type: "chapter" | "linked";
  bookId: string;
  name: string;
  scopeRef: string; // chapter scope ("Genesis 1") for chapter; link-group id for linked
  compiledAt: number;
  // When the name was last set by the user (create or rename). Drives rename
  // sync: on merge, the name from whichever device edited it most recently wins.
  // Optional for backward-compat; treated as compiledAt when absent.
  nameAt?: number;
}

const KEY = "scribal_studies_v1";

export function useStudies() {
  const [studies, setStudies] = useState<Study[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(studies));
    } catch {}
  }, [studies]);

  // Compile is the save: record this chapter/linked group, or refresh an
  // existing record's name + timestamp.
  const recordStudy = (
    type: "chapter" | "linked",
    bookId: string,
    scopeRef: string,
    name: string
  ) => {
    setStudies((prev) => {
      const now = Date.now();
      const i = prev.findIndex(
        (s) => s.type === type && s.bookId === bookId && s.scopeRef === scopeRef
      );
      if (i >= 0) {
        const next = prev.slice();
        const cur = next[i];
        const nameChanged = name !== cur.name;
        next[i] = {
          ...cur,
          name,
          // Only move nameAt when the name actually changes, so a plain
          // re-compile never makes a stale/default name "win" a rename sync.
          nameAt: nameChanged ? now : cur.nameAt || cur.compiledAt || now,
          compiledAt: now,
        };
        return next;
      }
      return [
        {
          id: "study_" + now + "_" + Math.random().toString(36).slice(2, 7),
          type,
          bookId,
          name,
          scopeRef,
          compiledAt: now,
          nameAt: now,
        },
        ...prev,
      ];
    });
  };

  const deleteStudy = (id: string) =>
    setStudies((prev) => prev.filter((s) => s.id !== id));

  // Merge a remote studies snapshot (from another device's backup) into ours.
  //  - A study we've never seen (new id) is added.
  //  - A study we both have: its NAME is taken from whichever device set the name
  //    most recently (nameAt), and compiledAt advances to the latest of the two.
  //    Nothing else about a local study is replaced.
  // This gives true two-way rename sync while making it impossible for a plain
  // re-compile (which never moves nameAt) to overwrite a rename.
  const mergeRemote = (raw: string | null | undefined) => {
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
        const lNameAt = local.nameAt || local.compiledAt || 0;
        const rNameAt = r.nameAt || r.compiledAt || 0;
        const name = rNameAt > lNameAt ? r.name : local.name;
        const nameAt = Math.max(lNameAt, rNameAt);
        const compiledAt = Math.max(local.compiledAt || 0, r.compiledAt || 0);
        if (
          name !== local.name ||
          nameAt !== (local.nameAt || 0) ||
          compiledAt !== (local.compiledAt || 0)
        ) {
          byId.set(r.id, { ...local, name, nameAt, compiledAt });
          changed = true;
        }
      });
      if (!changed) return prev; // idempotent — don't churn sync
      return Array.from(byId.values()).sort(
        (a, b) => (b.compiledAt || 0) - (a.compiledAt || 0)
      );
    });
  };

  return { studies, recordStudy, deleteStudy, setStudies, mergeRemote };
}
