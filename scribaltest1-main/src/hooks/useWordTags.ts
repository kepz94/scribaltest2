import { useState, useEffect, useCallback } from "react";
import { WordTag } from "../types";

// Definition tags live in their own store, entirely separate from marks — they
// never touch marking, points, or search. A tag is { id, reference, start, end,
// word, dictKey }, with id = reference:start:end so each occurrence is unique.
//
// Sync mirrors marks: a flat array unioned by id, plus a tombstone map so an
// un-tag on one device propagates across devices instead of being resurrected by
// the union. Tags + tombstones are held in ONE state object so a remote merge
// updates both atomically.
const KEY = "scribal_wordtags";
const TOMB_KEY = "scribal_wordtags_tomb";
const TOMBSTONE_TTL = 1000 * 60 * 60 * 24 * 90; // keep deletions 90 days

interface Store {
  tags: WordTag[];
  tombs: Record<string, number>;
}

function read(): Store {
  let tags: WordTag[] = [];
  let tombs: Record<string, number> = {};
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) tags = arr as WordTag[];
  } catch {
    /* ignore */
  }
  try {
    const raw = localStorage.getItem(TOMB_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    if (obj && typeof obj === "object") tombs = obj as Record<string, number>;
  } catch {
    /* ignore */
  }
  return { tags, tombs };
}

function gc(t: Record<string, number>): Record<string, number> {
  const cutoff = Date.now() - TOMBSTONE_TTL;
  const out: Record<string, number> = {};
  Object.keys(t).forEach((id) => {
    if (t[id] >= cutoff) out[id] = t[id];
  });
  return out;
}

export function useWordTags() {
  const [store, setStore] = useState<Store>(read);
  const wordTags = store.tags;

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(store.tags));
    } catch {
      /* storage unavailable — tags stay in-session only */
    }
  }, [store.tags]);

  useEffect(() => {
    try {
      localStorage.setItem(TOMB_KEY, JSON.stringify(store.tombs));
    } catch {
      /* ignore */
    }
  }, [store.tombs]);

  const hasTag = useCallback(
    (reference: string, start: number, end: number) =>
      store.tags.some(
        (t) => t.reference === reference && t.start === start && t.end === end
      ),
    [store.tags]
  );

  const addTag = useCallback((t: Omit<WordTag, "id">) => {
    const id = t.reference + ":" + t.start + ":" + t.end;
    setStore((prev) => {
      const exists = prev.tags.some((x) => x.id === id);
      const tombed = prev.tombs[id] != null;
      if (exists && !tombed) return prev;
      // Re-tagging revives the word: clear any tombstone so a merge won't drop it.
      let tombs = prev.tombs;
      if (tombed) {
        tombs = { ...prev.tombs };
        delete tombs[id];
      }
      const tags = exists ? prev.tags : [...prev.tags, { ...t, id }];
      return { tags, tombs };
    });
  }, []);

  const removeTag = useCallback(
    (reference: string, start: number, end: number) => {
      const id = reference + ":" + start + ":" + end;
      setStore((prev) => {
        const tags = prev.tags.filter(
          (t) =>
            !(t.reference === reference && t.start === start && t.end === end)
        );
        if (tags.length === prev.tags.length && prev.tombs[id] != null) {
          return prev;
        }
        // Tombstone the deletion so it propagates across devices.
        return { tags, tombs: { ...prev.tombs, [id]: Date.now() } };
      });
    },
    []
  );

  // Live-merge a remote snapshot: union tags by id (local edits survive), merge
  // tombstones (newest deletion per id wins), then drop any tombstoned id so a
  // deletion wins over a stale remote add — exactly like marks. Idempotent: when
  // nothing changes, the same state is returned so two devices don't ping-pong.
  const mergeRemote = useCallback(
    (
      tagsJson: string | null | undefined,
      tombJson: string | null | undefined
    ) => {
      let remoteTags: WordTag[] = [];
      let remoteTombs: Record<string, number> = {};
      try {
        const a = JSON.parse(tagsJson || "[]");
        if (Array.isArray(a)) remoteTags = a as WordTag[];
      } catch {
        /* ignore */
      }
      try {
        const o = JSON.parse(tombJson || "{}");
        if (o && typeof o === "object")
          remoteTombs = o as Record<string, number>;
      } catch {
        /* ignore */
      }
      if (remoteTags.length === 0 && Object.keys(remoteTombs).length === 0) {
        return;
      }
      setStore((prev) => {
        // Merge tombstones (newest per id wins), then drop expired ones.
        const mergedRaw: Record<string, number> = { ...prev.tombs };
        Object.keys(remoteTombs).forEach((id) => {
          const rt = remoteTombs[id];
          if (
            typeof rt === "number" &&
            (mergedRaw[id] == null || rt > mergedRaw[id])
          )
            mergedRaw[id] = rt;
        });
        const tombs = gc(mergedRaw);
        // Union tags by id, then remove any that are tombstoned.
        const haveIds = new Set(prev.tags.map((t) => t.id));
        const added = remoteTags.filter((t) => t && t.id && !haveIds.has(t.id));
        const unioned = added.length ? prev.tags.concat(added) : prev.tags;
        const tags = unioned.filter((t) => tombs[t.id] == null);
        // Idempotency: return prev refs when content is unchanged.
        const tagsSame =
          tags.length === prev.tags.length &&
          tags.every((t, i) => t === prev.tags[i]);
        const tKeys = Object.keys(tombs);
        const pKeys = Object.keys(prev.tombs);
        const tombsSame =
          tKeys.length === pKeys.length &&
          tKeys.every((k) => tombs[k] === prev.tombs[k]);
        if (tagsSame && tombsSame) return prev;
        return {
          tags: tagsSame ? prev.tags : tags,
          tombs: tombsSame ? prev.tombs : tombs,
        };
      });
    },
    []
  );

  return { wordTags, hasTag, addTag, removeTag, mergeRemote };
}
