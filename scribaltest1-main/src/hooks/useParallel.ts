import { useEffect, useState } from "react";
import { ParallelAlignment, isAlignmentCleared } from "../parallelAlign";

// Row alignments for the Parallel compile view: one per study scope, stored
// under its own key and synced like everything else.
//
// The whole alignment is the sync unit, not the individual column, because a
// board is edited on one device at a time — the same reasoning useStudyTables
// gives for merging a table's cards wholesale. Two devices editing the same
// study's alignment between syncs will lose one side's work. That is an
// accepted cost: an alignment is a few seconds to redo and, unlike a note, it
// holds no prose.
//
// An ABSENT alignment means lockstep, so the store holds nothing until the
// reader's first edit and a study that never needs aligning costs no sync at
// all.
//
// RESETS ARE TOMBSTONED, NOT DELETED. Deleting the entry outright lets whichever
// device still holds a copy hand it straight back on the next sync, and the
// reset silently un-happens — the failure shape of SCR-68 and SCR-83. So
// clearAlignment stamps clearedAt and keeps the record, mergeParallel carries
// clearedAt forward as the max across both sides regardless of which won on
// updatedAt, and a later edit revives the entry the way a later edit revives a
// deleted table.

export const PARALLEL_KEY = "scribal_parallel_v1";

export type ParallelStore = Record<string, ParallelAlignment>;

const isPlainObject = (v: unknown): boolean =>
  !!v && typeof v === "object" && !Array.isArray(v);

// Pure so it can be tested without a component. Never throws: a payload this
// cannot read is a payload it declines, leaving the local store untouched.
export function mergeParallel(
  local: ParallelStore,
  remoteRaw: string | null | undefined
): { next: ParallelStore; changed: boolean } {
  if (!remoteRaw) return { next: local, changed: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(remoteRaw);
  } catch {
    return { next: local, changed: false };
  }
  if (!isPlainObject(parsed)) return { next: local, changed: false };

  const remote = parsed as Record<string, unknown>;
  let next = local;
  let changed = false;
  const claim = () => {
    if (next === local) next = { ...local };
  };

  Object.keys(remote).forEach((scope) => {
    const r = remote[scope];
    if (!isPlainObject(r)) return;
    const rem = r as ParallelAlignment;
    if (!isPlainObject(rem.slots)) return;

    const loc = local[scope];
    if (!loc) {
      claim();
      next[scope] = rem;
      changed = true;
      return;
    }

    // The reset stamp travels on its own. A device that never saw the reset
    // still has the alignment and would otherwise revive it just by being
    // newer, so this is deliberately not decided by the updatedAt contest.
    const clearedAt = Math.max(loc.clearedAt || 0, rem.clearedAt || 0);
    const remoteWins = (rem.updatedAt || 0) > (loc.updatedAt || 0);
    const winner = remoteWins ? rem : loc;

    const merged: ParallelAlignment = { ...winner };
    if (clearedAt) merged.clearedAt = clearedAt;
    else delete merged.clearedAt;

    if (remoteWins || clearedAt !== (loc.clearedAt || 0)) {
      claim();
      next[scope] = merged;
      changed = true;
    }
  });

  return { next, changed };
}

const read = (): ParallelStore => {
  try {
    const parsed = JSON.parse(localStorage.getItem(PARALLEL_KEY) || "{}");
    return isPlainObject(parsed) ? (parsed as ParallelStore) : {};
  } catch {
    // Private mode, quota, or a corrupt blob. Starting empty means every board
    // renders lockstep, which is the correct fallback and never a crash.
    return {};
  }
};

export function useParallel() {
  const [alignments, setAlignments] = useState<ParallelStore>(read);

  useEffect(() => {
    try {
      localStorage.setItem(PARALLEL_KEY, JSON.stringify(alignments));
    } catch {}
  }, [alignments]);

  // Cleared reads as absent, so callers see lockstep and never need to know
  // tombstones exist.
  const getAlignment = (scope: string): ParallelAlignment | undefined => {
    const a = alignments[scope];
    return a && !isAlignmentCleared(a) ? a : undefined;
  };

  const setAlignment = (
    scope: string,
    a: Omit<ParallelAlignment, "updatedAt" | "scope" | "clearedAt">
  ) => {
    setAlignments((prev) => ({
      ...prev,
      [scope]: { ...a, scope, updatedAt: Date.now() },
    }));
  };

  const clearAlignment = (scope: string) => {
    setAlignments((prev) => {
      const existing = prev[scope];
      if (!existing || isAlignmentCleared(existing)) return prev;
      return { ...prev, [scope]: { ...existing, clearedAt: Date.now() } };
    });
  };

  const mergeRemote = (rawValue: string | null | undefined) => {
    setAlignments((prev) => {
      const { next, changed } = mergeParallel(prev, rawValue);
      return changed ? next : prev;
    });
  };

  return { alignments, getAlignment, setAlignment, clearAlignment, mergeRemote };
}
