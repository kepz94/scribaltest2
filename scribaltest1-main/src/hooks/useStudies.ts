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
        next[i] = { ...next[i], name, compiledAt: now };
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
        },
        ...prev,
      ];
    });
  };

  const deleteStudy = (id: string) =>
    setStudies((prev) => prev.filter((s) => s.id !== id));

  // Merge a remote studies snapshot (from another device's backup) into ours.
  // ADDITIVE ONLY: add a study whose id we've never seen; never modify or replace
  // one we already have. So a sync can only ever ADD a study made on another
  // device — it can never change a name, timestamp, or anything on a local study.
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
      const have = new Set(prev.map((s) => s.id));
      const additions = remote.filter((s) => s && s.id && !have.has(s.id));
      if (!additions.length) return prev; // idempotent — don't churn sync
      return [...prev, ...additions].sort(
        (a, b) => (b.compiledAt || 0) - (a.compiledAt || 0)
      );
    });
  };

  return { studies, recordStudy, deleteStudy, setStudies, mergeRemote };
}
