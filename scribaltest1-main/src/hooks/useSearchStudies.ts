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
      };
      setStudies((prev) => [study, ...prev]);
      return study;
    },
    []
  );

  const updateStudy = useCallback((id: string, partial: Partial<SearchStudy>) => {
    setStudies((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...partial } : s))
    );
  }, []);

  const renameStudy = useCallback((id: string, name: string) => {
    setStudies((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name: name.trim() || s.name } : s))
    );
  }, []);

  const deleteStudy = useCallback((id: string) => {
    setStudies((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return {
    studies,
    addStudy,
    updateStudy,
    renameStudy,
    deleteStudy,
    setStudies,
  };
}
