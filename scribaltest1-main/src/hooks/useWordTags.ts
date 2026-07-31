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

export interface TagStore {
  tags: WordTag[];
  tombs: Record<string, number>;
}

// The merge, as a pure function so it can be tested without a React tree.
//
// Tombstones: newest deletion per id wins, then expired ones are dropped.
// Tags: union by id — but for an id BOTH sides hold, the sense selection is
// last-write-wins on `updatedAt` (absent = 0, so a device that has chosen beats
// one that never has). Before this, the local row simply won and a selection
// made on one device could never reach the other. Everything else about a tag is
// immutable — it is anchored to a fixed character range — so the selection is
// the only field that can legitimately differ between two copies.
//
// Idempotent: when nothing changes, the previous object identities are returned
// so two syncing devices don't ping-pong.
export function mergeTagState(
  prev: TagStore,
  remoteTags: WordTag[],
  remoteTombs: Record<string, number>
): TagStore {
  const mergedRaw: Record<string, number> = { ...prev.tombs };
  Object.keys(remoteTombs).forEach((id) => {
    const rt = remoteTombs[id];
    if (typeof rt === "number" && (mergedRaw[id] == null || rt > mergedRaw[id]))
      mergedRaw[id] = rt;
  });
  const tombs = gc(mergedRaw);

  const byId = new Map(
    remoteTags.filter((t) => t && t.id).map((t) => [t.id, t])
  );
  let changed = false;
  const reconciled = prev.tags.map((mine) => {
    const theirs = byId.get(mine.id);
    if (!theirs) return mine;
    if ((theirs.updatedAt || 0) <= (mine.updatedAt || 0)) return mine;
    changed = true;
    return { ...mine, senses: theirs.senses, updatedAt: theirs.updatedAt };
  });
  const haveIds = new Set(prev.tags.map((t) => t.id));
  const added = remoteTags.filter((t) => t && t.id && !haveIds.has(t.id));
  const unioned = added.length ? reconciled.concat(added) : reconciled;
  const tags = unioned.filter((t) => tombs[t.id] == null);

  const tagsSame =
    !changed &&
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

  // Change which senses a tag carries. Separate from addTag, which is a no-op on
  // an existing tag — a selection has to be revisable after the fact, and the
  // stamp is what lets the other device's merge see that this side is newer.
  const updateTag = useCallback(
    (reference: string, start: number, end: number, senses: number[]) => {
      const id = reference + ":" + start + ":" + end;
      setStore((prev) => {
        const i = prev.tags.findIndex((t) => t.id === id);
        if (i < 0) return prev;
        const cur = prev.tags[i];
        const next = senses.slice().sort((a, b) => a - b);
        const same =
          (cur.senses || []).length === next.length &&
          (cur.senses || []).every((s, j) => s === next[j]);
        if (same) return prev;
        const tags = prev.tags.slice();
        tags[i] = { ...cur, senses: next, updatedAt: Date.now() };
        return { tags, tombs: prev.tombs };
      });
    },
    []
  );

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
      setStore((prev) => mergeTagState(prev, remoteTags, remoteTombs));
    },
    []
  );

  const tagAt = useCallback(
    (reference: string, start: number, end: number): WordTag | null =>
      store.tags.find(
        (t) => t.reference === reference && t.start === start && t.end === end
      ) || null,
    [store.tags]
  );

  return { wordTags, hasTag, tagAt, addTag, updateTag, removeTag, mergeRemote };
}
