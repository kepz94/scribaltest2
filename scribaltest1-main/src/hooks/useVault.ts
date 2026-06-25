import { useState, useEffect, useCallback } from "react";
import { Mark } from "../types";

export interface VaultEntry {
  id: string;
  name: string;
  view: "cornell" | "outline" | "charting" | "map";
  bookName: string;
  // Identifies which study (chapter) this entry is for, so re-saving updates
  // the same file instead of creating a duplicate.
  scopeKey?: string;
  createdAt: number;
  updatedAt: number;
  compileTabs: { id: string; volume: number; book: number; chapter: number }[];
  marks: Mark[];
  colorLabels: Record<number, string>;
  notes: Record<string, string>;
  tags?: string[];
  // Soft-delete marker: kept in storage (and synced) so a deletion isn't
  // resurrected by a union-merge from the cloud. Hidden from the UI, and
  // pruned after 90 days.
  deleted?: boolean;
}

const KEY = "scribal_vault_v1";
const TOMBSTONE_TTL = 1000 * 60 * 60 * 24 * 90; // keep hidden deletions 90 days

const safeRead = (): VaultEntry[] => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - TOMBSTONE_TTL;
    // drop deletions older than the TTL so the list can't grow forever
    return parsed.filter(
      (e: VaultEntry) => !(e && e.deleted && (e.updatedAt || 0) < cutoff)
    );
  } catch {
    return [];
  }
};

export function useVault() {
  const [entries, setEntries] = useState<VaultEntry[]>(() => safeRead());

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(entries));
    } catch {}
  }, [entries]);

  const addEntry = useCallback(
    (entry: Omit<VaultEntry, "id" | "createdAt" | "updatedAt">) => {
      const now = Date.now();
      const full: VaultEntry = {
        ...entry,
        id: "vault_" + now + "_" + Math.random().toString(36).slice(2, 7),
        createdAt: now,
        updatedAt: now,
      };
      setEntries((prev) => [full, ...prev]);
    },
    []
  );

  const updateEntry = useCallback(
    (id: string, partial: Partial<VaultEntry>) => {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === id ? { ...e, ...partial, updatedAt: Date.now() } : e
        )
      );
    },
    []
  );

  const renameEntry = useCallback((id: string, name: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, name, updatedAt: Date.now() } : e))
    );
  }, []);

  const deleteEntry = useCallback((id: string) => {
    // Soft delete: mark it and bump updatedAt so the deletion wins any cloud
    // merge. A hard remove would get resurrected by mergeRemote's union.
    setEntries((prev) =>
      prev.map((e) =>
        e.id === id ? { ...e, deleted: true, updatedAt: Date.now() } : e
      )
    );
  }, []);

  // Live merge of a remote vault snapshot — union by id, newer updatedAt wins.
  const mergeRemote = useCallback((json: string | null | undefined) => {
    if (!json) return;
    let remote: VaultEntry[] = [];
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) remote = parsed;
      else if (parsed && Array.isArray(parsed.entries)) remote = parsed.entries;
    } catch {
      return;
    }
    if (!remote.length) return;
    setEntries((prev) => {
      const byId: Record<string, VaultEntry> = {};
      prev.forEach((e) => {
        if (e && e.id) byId[e.id] = e;
      });
      remote.forEach((e) => {
        if (!e || !e.id) return;
        const cur = byId[e.id];
        if (!cur || (e.updatedAt || 0) > (cur.updatedAt || 0)) byId[e.id] = e;
      });
      const seen = new Set<string>();
      const merged: VaultEntry[] = [];
      prev.forEach((e) => {
        if (e && e.id && byId[e.id] && !seen.has(e.id)) {
          merged.push(byId[e.id]);
          seen.add(e.id);
        }
      });
      remote.forEach((e) => {
        if (e && e.id && !seen.has(e.id)) {
          merged.push(byId[e.id]);
          seen.add(e.id);
        }
      });
      return merged;
    });
  }, []);

  // Hide soft-deleted entries from the UI; they stay in storage so the
  // deletion can sync and outlast a stale cloud merge.
  const visibleEntries = entries.filter((e) => !e.deleted);

  return {
    entries: visibleEntries,
    addEntry,
    updateEntry,
    renameEntry,
    deleteEntry,
    mergeRemote,
  };
}
