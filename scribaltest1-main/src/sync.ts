// Shared Google Drive sync + local-backup logic for Scribal.
//
// Both the desktop (App) and mobile (MobileApp) shells use this one module so the
// data-safety rules live in exactly one place. Previously each shell carried its
// own near-identical copy of all of this, which meant a fix made to one shell
// never reached the other — a real hazard for a system that guards a user's
// scripture annotations.
//
// What each shell still owns:
//   - its own BACKUP_KEYS list, built from CORE_KEYS plus the keys that only make
//     sense on that device (desktop: toolbar/concept-map layout, walkthrough
//     flags; mobile: reading position).
//   - its device-local restore rules, passed in as ApplyOptions (mobile keeps its
//     own reading position / scroll when a pulled backup is applied).

import * as drive from "./googleDrive";

// Paste your Google OAuth Client ID here (looks like 1234-abc.apps.googleusercontent.com),
// or set REACT_APP_GOOGLE_CLIENT_ID in your hosting env instead.
export const GOOGLE_CLIENT_ID =
  process.env.REACT_APP_GOOGLE_CLIENT_ID || "PASTE_YOUR_GOOGLE_CLIENT_ID_HERE";

// True once a real client ID is configured (i.e. it isn't the placeholder).
export const DRIVE_CONFIGURED = GOOGLE_CLIENT_ID.indexOf("PASTE_") !== 0;

// The keys every device syncs — the study data itself. Each shell appends its own
// device-specific keys to this when it builds its BACKUP_KEYS list.
export const CORE_KEYS = [
  "scribal_books_v1",
  "scribal_vault_v1",
  "scribal_studies_v1",
  "scribal_search_studies",
  "scribal_linked_chapters",
  "scribal_marks",
  "scribal_labels",
  "scribal_notes",
  "scribal_wordtags",
  "scribal_wordtags_tomb",
  "scribal_tabs_v2",
  "scribal_active_tab_v2",
  "scribal_theme",
  "scribal_compile_view",
  // Per-scope timestamp of the last link/unlink action. Travels with
  // scribal_linked_chapters so that UNLINKING (not just linking) converges
  // across devices — see mergeLinkGroups.
  "scribal_linked_chapters_at",
  // Mark colour intensity (saturation). A shared display setting, so it syncs
  // and marks look the same on every device.
  "scribal_color_intensity",
  // Study tables (lesson boards): built on desktop, presentable on any device.
  "scribal_tables_v1",
];

// Merge a remote chapter-link map into the local one. Two chapters belong to the
// same group if they're linked on EITHER device (union of connected components),
// so a link made anywhere survives and both devices converge on the same grouping
// AND the same group id (the lexicographically smallest id among the group's
// members — computed identically on both sides).
//
// UNLINKING also converges, via a companion per-scope timestamp map (`prevAt` /
// the remote "scribal_linked_chapters_at"): for each chapter we trust whichever
// device touched it most recently. If the newer side has the chapter unlinked, it
// stays unlinked even though the older side still lists it — which is exactly
// what the old union-only merge couldn't do. Stamps are merged forward (max) so
// the tombstone keeps defending the unlink on later syncs.
//
// Returns the SAME object references when nothing changed, so callers can set
// state unconditionally and let React bail out (no sync ping-pong).
export function mergeLinkGroups(
  prevGroups: Record<string, string>,
  prevAt: Record<string, number>,
  remoteGroupsRaw: string | null | undefined,
  remoteAtRaw: string | null | undefined
): { groups: Record<string, string>; at: Record<string, number> } {
  const pAt = prevAt || {};
  let remoteGroups: Record<string, string> = {};
  let remoteAt: Record<string, number> = {};
  try {
    const g = JSON.parse(remoteGroupsRaw || "{}");
    if (g && typeof g === "object" && !Array.isArray(g)) remoteGroups = g;
  } catch {
    /* keep empty */
  }
  try {
    const a = JSON.parse(remoteAtRaw || "{}");
    if (a && typeof a === "object" && !Array.isArray(a)) remoteAt = a;
  } catch {
    /* keep empty */
  }

  // 1) Per scope: decide current linked-ness by whichever side acted last, and
  //    carry the freshest timestamp forward.
  const scopes = new Set<string>([
    ...Object.keys(prevGroups),
    ...Object.keys(pAt),
    ...Object.keys(remoteGroups),
    ...Object.keys(remoteAt),
  ]);
  const linkedNow: Record<string, boolean> = {};
  const mergedAt: Record<string, number> = {};
  scopes.forEach((s) => {
    const lAt = pAt[s] || 0;
    const rAt = remoteAt[s] || 0;
    linkedNow[s] = rAt > lAt ? s in remoteGroups : s in prevGroups;
    const at = Math.max(lAt, rAt);
    if (at) mergedAt[s] = at;
  });

  // 2) Union-find over both maps' memberships — but only chapters still linked.
  const parent: Record<string, string> = {};
  const find = (x: string): string => {
    let r = x;
    while (parent[r] !== undefined && parent[r] !== r) r = parent[r];
    while (parent[x] !== undefined && parent[x] !== r) {
      const nxt = parent[x];
      parent[x] = r;
      x = nxt;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    if (parent[a] === undefined) parent[a] = a;
    if (parent[b] === undefined) parent[b] = b;
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra;
    else parent[ra] = rb;
  };
  const linkByGid = (map: Record<string, string>) => {
    const byGid: Record<string, string[]> = {};
    Object.keys(map).forEach((s) => {
      if (!linkedNow[s]) return; // unlinked more recently on the other device
      const g = map[s];
      if (typeof g !== "string" || !g) return;
      (byGid[g] = byGid[g] || []).push(s);
    });
    Object.keys(byGid).forEach((g) => {
      const members = byGid[g];
      for (let i = 1; i < members.length; i++) union(members[0], members[i]);
    });
  };
  linkByGid(prevGroups);
  linkByGid(remoteGroups);

  // 3) Each component (of 2+) becomes a group keyed by its smallest member id.
  const components: Record<string, string[]> = {};
  Object.keys(parent).forEach((s) => {
    const r = find(s);
    (components[r] = components[r] || []).push(s);
  });
  const groups: Record<string, string> = {};
  Object.keys(components).forEach((root) => {
    const members = components[root];
    if (members.length < 2) return; // a lone chapter isn't a group
    const gids: string[] = [];
    members.forEach((s) => {
      if (prevGroups[s]) gids.push(prevGroups[s]);
      if (remoteGroups[s]) gids.push(remoteGroups[s]);
    });
    gids.sort();
    const gid = gids[0];
    members.forEach((s) => {
      groups[s] = gid;
    });
  });

  // Idempotency: hand back the original objects when unchanged.
  const gk = Object.keys(prevGroups);
  const ngk = Object.keys(groups);
  const groupsSame =
    gk.length === ngk.length && gk.every((k) => prevGroups[k] === groups[k]);
  const ak = Object.keys(pAt);
  const nak = Object.keys(mergedAt);
  const atSame =
    ak.length === nak.length && ak.every((k) => pAt[k] === mergedAt[k]);
  return {
    groups: groupsSame ? prevGroups : groups,
    at: atSame ? pAt : mergedAt,
  };
}

export type PushResult = "pushed" | "adopted" | "blocked" | "fail";

// Functions the calling shell supplies from its useMarks / useVault hooks.
type MergeBooks = (json: string) => void;
type MergeVault = (json: string | null | undefined) => void;
// Live-merges the study keys (recorded + keyword studies) that aren't books or
// vault. The calling shell supplies this so a study created on one device shows
// up on the other without a reload. Receives the parsed key->value backup map.
type MergeOther = (data: Record<string, string | null>) => void;

export interface ApplyOptions {
  // Keys that are device-local scratch and must never be written from a backup.
  alwaysLocal?: string[];
  // Keys adopted from a backup only when this device has no value yet — so a pull
  // can seed a fresh install but never moves a device you're already using off its
  // current spot.
  keepLocalIfPresent?: string[];
}

// Counts total marks across all study books in a persisted scribal_books_v1
// string. Used by the safeguards to refuse empty-over-full writes/reads.
export function countBookMarksFromJson(raw: string | null | undefined): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    const books = parsed && parsed.books ? parsed.books : null;
    if (!books || typeof books !== "object") return 0;
    let n = 0;
    Object.keys(books).forEach((k) => {
      const m = books[k] && books[k].marks;
      if (Array.isArray(m)) n += m.length;
    });
    return n;
  } catch {
    return 0;
  }
}

// Pulls the scribal_books_v1 value out of a full backup string.
export function booksFromBackup(text: string): string | null {
  try {
    const p = JSON.parse(text);
    const data = p && p.data ? p.data : p;
    return data ? data["scribal_books_v1"] || null : null;
  } catch {
    return null;
  }
}

// Pulls any single backed-up key's value out of a full backup string (the
// generic form of booksFromBackup).
export function valueFromBackup(text: string, key: string): string | null {
  try {
    const p = JSON.parse(text);
    const data = p && p.data ? p.data : p;
    return data ? data[key] || null : null;
  } catch {
    return null;
  }
}

// Counts the live (not soft-deleted) entries in a persisted study list
// (scribal_studies_v1 or scribal_search_studies). The emptiness safeguards use
// this so a device that has lost its studies can't push that emptiness over a
// cloud copy that still holds them — the same protection marks already had.
export function countStudiesFromJson(raw: string | null | undefined): number {
  if (!raw) return 0;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return 0;
    return arr.filter((s) => s && !s.deletedAt).length;
  } catch {
    return 0;
  }
}

// A tolerant census of every kind of user content Scribal syncs. The cloud
// emptiness guard (SCR-68) uses these so a blank device can never overwrite a
// cloud doc that still holds ANY content — the original guard only counted
// marks, which left a doc holding only studies/tables/notes unprotected.
export interface ContentCounts {
  marks: number;
  vault: number;
  studies: number;
  search: number;
  tables: number;
  notes: number;
}

export const totalContent = (c: ContentCounts): number =>
  c.marks + c.vault + c.studies + c.search + c.tables + c.notes;

// Counts live (non-tombstoned) vault entries.
function countVaultFromJson(raw: string | null | undefined): number {
  if (!raw) return 0;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return 0;
    return arr.filter((e) => e && !e.deleted).length;
  } catch {
    return 0;
  }
}

// Counts live study tables. A delete only counts while it is the table's
// newest action — the same rule as useStudyTables.isTableDeleted, inlined here
// so the sync layer stays hook-free.
function countTablesFromJson(raw: string | null | undefined): number {
  if (!raw) return 0;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return 0;
    return arr.filter(
      (t) =>
        t &&
        !(
          t.deletedAt &&
          t.deletedAt >= (t.nameAt || 0) &&
          t.deletedAt >= (t.updatedAt || 0)
        )
    ).length;
  } catch {
    return 0;
  }
}

// Counts non-empty entries in the scribal_notes ref→text map.
function countNotesFromJson(raw: string | null | undefined): number {
  if (!raw) return 0;
  try {
    const map = JSON.parse(raw);
    if (!map || typeof map !== "object" || Array.isArray(map)) return 0;
    return Object.keys(map).filter((k) => {
      const v = map[k];
      return typeof v === "string" && v.trim() !== "";
    }).length;
  } catch {
    return 0;
  }
}

// Counts non-empty notes living INSIDE the book store — syntheses, theme notes
// and verse notes. These are the notes that actually matter, and they were
// invisible to the emptiness guards, which only ever counted the legacy flat
// scribal_notes map. A books payload that had lost every note still counted as
// full because its marks were intact, and pushed straight over the cloud copy.
function countBookNotesFromJson(raw: string | null | undefined): number {
  if (!raw) return 0;
  try {
    const s = JSON.parse(raw);
    let n = 0;
    const countMap = (notes: any) => {
      if (!notes || typeof notes !== "object") return;
      Object.keys(notes).forEach((k) => {
        if (typeof notes[k] === "string" && notes[k].trim() !== "") n++;
      });
    };
    // The global store at the payload root (where every note lives now), plus
    // any still embedded in books (older payloads).
    countMap(s && s.notes);
    const books = s && s.books;
    if (books && typeof books === "object")
      Object.keys(books).forEach((id) => countMap(books[id] && books[id].notes));
    return n;
  } catch {
    return 0;
  }
}

function countContent(get: (key: string) => string | null): ContentCounts {
  return {
    marks: countBookMarksFromJson(get("scribal_books_v1")),
    vault: countVaultFromJson(get("scribal_vault_v1")),
    studies: countStudiesFromJson(get("scribal_studies_v1")),
    search: countStudiesFromJson(get("scribal_search_studies")),
    tables: countTablesFromJson(get("scribal_tables_v1")),
    notes:
      countNotesFromJson(get("scribal_notes")) +
      countBookNotesFromJson(get("scribal_books_v1")),
  };
}

// Census of a backup/cloud payload string (parses the payload once).
export function contentCountsFromBackup(text: string): ContentCounts {
  let data: Record<string, unknown> | null = null;
  try {
    const p = JSON.parse(text);
    const d = p && p.data ? p.data : p;
    if (d && typeof d === "object" && !Array.isArray(d)) data = d;
  } catch {
    /* unreadable payload counts as empty */
  }
  return countContent((k) => {
    const v = data ? data[k] : null;
    return typeof v === "string" ? v : null;
  });
}

// Census of this device's localStorage.
export function contentCountsFromLocal(): ContentCounts {
  return countContent((k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  });
}

// Run a Drive operation with the CURRENT valid token, or skip it. Background
// ops never attempt a token refresh: GIS's "silent" refresh (prompt: "")
// still opens a popup window, so without a user gesture the browser blocks it
// — that was SCR-11's blocked-popup console error on every load. When the
// token is stale this resolves undefined and the caller's "Reconnect to sync"
// nudge (a real click, which CAN open the popup) is the recovery path.
// Never throws.
export async function withFreshToken<T>(
  fn: (token: string) => Promise<T>
): Promise<T | undefined> {
  const token = drive.getToken();
  if (!token) return undefined;
  try {
    return await fn(token);
  } catch {
    return undefined;
  }
}

// Serialize the given localStorage keys into a backup string. Pretty-prints when
// `pretty` is set (used for the human-readable downloadable backup file).
export function buildBackupString(keys: string[], pretty = false): string {
  const data: Record<string, string | null> = {};
  keys.forEach((k) => {
    try {
      data[k] = localStorage.getItem(k);
    } catch {
      data[k] = null;
    }
  });
  const payload = {
    app: "scribal",
    version: 2,
    exportedAt: new Date().toISOString(),
    data,
  };
  return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
}

// Restore a backup string into localStorage. `opts` carries device-local rules
// (keys never to overwrite, keys to adopt only on a device that has none yet).
export function applyBackupString(text: string, opts: ApplyOptions = {}) {
  const alwaysLocal = new Set(opts.alwaysLocal || []);
  const keepIfPresent = new Set(opts.keepLocalIfPresent || []);
  const present = (k: string): boolean => {
    try {
      return !!localStorage.getItem(k);
    } catch {
      return false;
    }
  };
  const parsed = JSON.parse(text);
  const data = parsed && parsed.data ? parsed.data : parsed;
  if (!data || typeof data !== "object") throw new Error("bad backup");
  Object.keys(data).forEach((k) => {
    if (alwaysLocal.has(k)) return;
    if (keepIfPresent.has(k) && present(k)) return;
    const v = data[k];
    if (v === null || v === undefined) return;
    try {
      localStorage.setItem(k, String(v));
    } catch {}
  });
  if (parsed && parsed.exportedAt) {
    try {
      localStorage.setItem("scribal_sync_seen", parsed.exportedAt);
    } catch {}
  }
}

// Apply a remote snapshot into LIVE state with no page reload: marks union by id
// (in-progress marks survive), vault unions by id, theme names + notes fill blanks
// only. The two merge functions come from the calling shell's hooks.
export function applyRemoteLive(
  text: string,
  mergeRemoteBooks: MergeBooks,
  vaultMergeRemote: MergeVault,
  mergeOther?: MergeOther
) {
  try {
    const p = JSON.parse(text);
    const data = p && p.data ? p.data : p;
    if (!data || typeof data !== "object") return;
    if (data["scribal_books_v1"]) mergeRemoteBooks(data["scribal_books_v1"]);
    if (data["scribal_vault_v1"]) vaultMergeRemote(data["scribal_vault_v1"]);
    if (mergeOther) mergeOther(data);
    if (p.exportedAt) {
      try {
        localStorage.setItem("scribal_sync_seen", p.exportedAt);
      } catch {}
    }
  } catch {}
}

// The single safe path for writing to Drive, used by every push (auto-save,
// manual save, reconnect). It reads the cloud first and enforces two rules:
//   1. Staleness: if the cloud is newer than the version this device last synced
//      from, this device is behind — adopt the cloud copy (live merge) instead of
//      overwriting it, and let the next auto-save push the union back.
//   2. Emptiness: never replace a cloud copy that has marks with one that has none.
// Returns what happened so callers can show the right message.
export async function pushToDrive(
  keys: string[],
  mergeRemoteBooks: MergeBooks,
  vaultMergeRemote: MergeVault,
  mergeOther?: MergeOther
): Promise<PushResult> {
  const remoteText = await withFreshToken((tok) => drive.loadData(tok));
  const base = Date.parse(localStorage.getItem("scribal_sync_seen") || "") || 0;
  const localMarks = countBookMarksFromJson(
    localStorage.getItem("scribal_books_v1")
  );
  const localStudies = countStudiesFromJson(
    localStorage.getItem("scribal_studies_v1")
  );
  const localSearch = countStudiesFromJson(
    localStorage.getItem("scribal_search_studies")
  );
  let remoteAt = 0;
  let remoteMarks = -1;
  let remoteStudies = -1;
  let remoteSearch = -1;
  if (remoteText) {
    try {
      const p = JSON.parse(remoteText);
      remoteAt = p && p.exportedAt ? Date.parse(p.exportedAt) : 0;
      remoteMarks = countBookMarksFromJson(booksFromBackup(remoteText));
      remoteStudies = countStudiesFromJson(
        valueFromBackup(remoteText, "scribal_studies_v1")
      );
      remoteSearch = countStudiesFromJson(
        valueFromBackup(remoteText, "scribal_search_studies")
      );
    } catch {
      /* treat as no usable remote */
    }
  }

  // The cloud holds marks or studies this device is missing. Pushing would erase
  // them, so the only safe move is to ADOPT the cloud (a union merge, so nothing
  // here is lost either) — regardless of timestamps.
  const cloudHasMore =
    (remoteMarks > 0 && localMarks === 0) ||
    (remoteStudies > 0 && localStudies === 0) ||
    (remoteSearch > 0 && localSearch === 0);

  // Rule 1 — we're behind the cloud (it's newer), or it holds content we lack.
  if (remoteText && ((remoteAt && remoteAt > base) || cloudHasMore)) {
    // Still refuse to let an empty-marks cloud blank good local marks — unless
    // the cloud also holds studies we're missing, in which case we must adopt to
    // recover them (the union merge keeps our marks regardless).
    if (remoteMarks === 0 && localMarks > 0 && !cloudHasMore) return "blocked";
    applyRemoteLive(remoteText, mergeRemoteBooks, vaultMergeRemote, mergeOther);
    return "adopted";
  }

  // Rule 2 — never push emptiness over a cloud that still has content. Now covers
  // studies and gathered studies too, not just marks, so a device that has lost
  // its studies can never overwrite the copy another device kept.
  if (
    (localMarks === 0 && remoteMarks > 0) ||
    (localStudies === 0 && remoteStudies > 0) ||
    (localSearch === 0 && remoteSearch > 0)
  ) {
    return "blocked";
  }

  const payload = buildBackupString(keys);
  const r = await withFreshToken((tok) => drive.saveData(tok, payload));
  if (r === undefined || r === null) return "fail";
  try {
    const p = JSON.parse(payload);
    if (p.exportedAt) localStorage.setItem("scribal_sync_seen", p.exportedAt);
  } catch {}
  return "pushed";
}

// Pull the cloud copy into live state IF it is genuinely newer than what this
// device last synced (the read-side mirror of pushToDrive's Rule 1, with the same
// emptiness guard). Used by the focus/visibility auto-pull in both shells.
// Returns true if a newer cloud copy was merged in.
export async function pullIfNewer(
  mergeRemoteBooks: MergeBooks,
  vaultMergeRemote: MergeVault,
  mergeOther?: MergeOther
): Promise<boolean> {
  const text = await withFreshToken((tok) => drive.loadData(tok));
  if (!text) return false;
  try {
    const parsed = JSON.parse(text);
    const remoteAt =
      parsed && parsed.exportedAt ? Date.parse(parsed.exportedAt) : 0;
    const seen =
      Date.parse(localStorage.getItem("scribal_sync_seen") || "") || 0;
    const localMarks = countBookMarksFromJson(
      localStorage.getItem("scribal_books_v1")
    );
    const localStudies = countStudiesFromJson(
      localStorage.getItem("scribal_studies_v1")
    );
    const localSearch = countStudiesFromJson(
      localStorage.getItem("scribal_search_studies")
    );
    const remoteMarks = countBookMarksFromJson(booksFromBackup(text));
    const remoteStudies = countStudiesFromJson(
      valueFromBackup(text, "scribal_studies_v1")
    );
    const remoteSearch = countStudiesFromJson(
      valueFromBackup(text, "scribal_search_studies")
    );
    // Pull when the cloud is genuinely newer OR it holds marks/studies this
    // device is missing — so a device that lost its studies recovers them on the
    // next focus even if its seen-stamp says it's already up to date.
    const cloudHasMore =
      (remoteMarks > 0 && localMarks === 0) ||
      (remoteStudies > 0 && localStudies === 0) ||
      (remoteSearch > 0 && localSearch === 0);
    if ((remoteAt && remoteAt > seen) || cloudHasMore) {
      if (remoteMarks === 0 && localMarks > 0 && !cloudHasMore) return false;
      applyRemoteLive(text, mergeRemoteBooks, vaultMergeRemote, mergeOther);
      return true;
    }
  } catch {}
  return false;
}
