import { useState, useEffect, useCallback } from "react";

// A keyword (search) study: a named, hand-picked set of verses pulled from
// search results. Its marks live in the chosen book (master or a session);
// this is the saved "lens" over them, persisted so it can be reopened later.
export interface SearchStudy {
  id: string;
  name: string;
  bookId: string; // "master" or a session book id — which book holds the marks
  refs: string[]; // verse references, kept in scripture order
  createdAt: number;
  // Last time the user changed this study's content (renamed it, or edited its
  // verse set). Drives two-way sync: on merge, the name + refs from whichever
  // device edited most recently win. Optional for back-compat (treated as
  // createdAt when absent).
  updatedAt?: number;
}

// Same key the mobile app uses, so the two stay in sync through the shared
// backup/restore path.
const KEY = "scribal_search_studies";

const safeRead = (): SearchStudy[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
};

export function useSearchStudies() {
  const [studies, setStudies] = useState<SearchStudy[]>(() => safeRead());

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(studies));
    } catch {}
  }, [studies]);

  const addStudy = useCallback(
    (name: string, bookId: string, refs: string[]): SearchStudy => {
      const study: SearchStudy = {
        id: "ss_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        name: name.trim() || "Untitled study",
        bookId,
        refs,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setStudies((prev) => [study, ...prev]);
      return study;
    },
    []
  );

  const updateStudy = useCallback((id: string, partial: Partial<SearchStudy>) => {
    setStudies((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, ...partial, updatedAt: Date.now() } : s
      )
    );
  }, []);

  const renameStudy = useCallback((id: string, name: string) => {
    setStudies((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, name: name.trim() || s.name, updatedAt: Date.now() }
          : s
      )
    );
  }, []);

  const deleteStudy = useCallback((id: string) => {
    setStudies((prev) => prev.filter((s) => s.id !== id));
  }, []);

  // Merge a remote keyword-studies snapshot into ours:
  //  - A study we've never seen (new id) is added.
  //  - A study we both have: its name + verse set are taken from whichever device
  //    edited it most recently (updatedAt). A local study is otherwise untouched.
  // This gives two-way rename + verse-edit sync. Deletions are NOT propagated (a
  // study removed on one device can reappear from the other) — deliberate, so a
  // sync can never silently lose a saved study.
  const mergeRemote = useCallback((raw: string | null | undefined) => {
    if (!raw) return;
    let remote: SearchStudy[];
    try {
      const parsed = JSON.parse(raw);
      remote = Array.isArray(parsed) ? parsed : [];
    } catch {
      return;
    }
    if (!remote.length) return;
    setStudies((prev) => {
      const byId = new Map<string, SearchStudy>(prev.map((s) => [s.id, s]));
      let changed = false;
      remote.forEach((r) => {
        if (!r || !r.id) return;
        const local = byId.get(r.id);
        if (!local) {
          byId.set(r.id, r);
          changed = true;
          return;
        }
        const lAt = local.updatedAt || local.createdAt || 0;
        const rAt = r.updatedAt || r.createdAt || 0;
        if (rAt > lAt) {
          byId.set(r.id, {
            ...local,
            name: r.name,
            refs: r.refs,
            updatedAt: rAt,
          });
          changed = true;
        }
      });
      if (!changed) return prev; // idempotent
      return Array.from(byId.values()).sort(
        (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
      );
    });
  }, []);

  return {
    studies,
    addStudy,
    updateStudy,
    renameStudy,
    deleteStudy,
    setStudies,
    mergeRemote,
  };
}
