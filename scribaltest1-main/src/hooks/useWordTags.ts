import { useState, useEffect, useCallback } from "react";
import { WordTag } from "../types";

// Definition tags live in their own store, entirely separate from marks — they
// never touch marking, points, or search. Persisted locally for now; because a
// tag is just { reference, start, end, word, dictKey }, adding cloud sync later
// is a flat-array merge, not a reducer rewrite.
const KEY = "scribal_wordtags";

function read(): WordTag[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as WordTag[]) : [];
  } catch {
    return [];
  }
}

export function useWordTags() {
  const [wordTags, setWordTags] = useState<WordTag[]>(read);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(wordTags));
    } catch {
      /* storage unavailable — tags stay in-session only */
    }
  }, [wordTags]);

  // A tag is identified by its verse + exact range, so each occurrence is unique.
  const hasTag = useCallback(
    (reference: string, start: number, end: number) =>
      wordTags.some(
        (t) => t.reference === reference && t.start === start && t.end === end
      ),
    [wordTags]
  );

  const addTag = useCallback((t: Omit<WordTag, "id">) => {
    setWordTags((prev) => {
      if (
        prev.some(
          (x) =>
            x.reference === t.reference && x.start === t.start && x.end === t.end
        )
      ) {
        return prev;
      }
      const id = t.reference + ":" + t.start + ":" + t.end;
      return [...prev, { ...t, id }];
    });
  }, []);

  const removeTag = useCallback(
    (reference: string, start: number, end: number) => {
      setWordTags((prev) =>
        prev.filter(
          (t) =>
            !(t.reference === reference && t.start === start && t.end === end)
        )
      );
    },
    []
  );

  return { wordTags, hasTag, addTag, removeTag };
}
