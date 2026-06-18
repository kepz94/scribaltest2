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

  // Merge a remote studies snapshot (from another device's backup) into ours:
  // union by id, newest compiledAt wins. Purely additive — never deletes a
  // local study, so a sync can only ever ADD studies the other device made.
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
      const byId = new Map<string, Study>();
      prev.forEach((s) => byId.set(s.id, s));
      let changed = false;
      remote.forEach((s) => {
        if (!s || !s.id) return;
        const ex = byId.get(s.id);
        if (!ex || (s.compiledAt || 0) > (ex.compiledAt || 0)) {
          byId.set(s.id, s);
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
