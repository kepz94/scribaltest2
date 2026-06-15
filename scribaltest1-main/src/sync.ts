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
  "scribal_marks",
  "scribal_labels",
  "scribal_notes",
  "scribal_tabs_v2",
  "scribal_active_tab_v2",
  "scribal_theme",
  "scribal_compile_view",
];

export type PushResult = "pushed" | "adopted" | "blocked" | "fail";

// Functions the calling shell supplies from its useMarks / useVault hooks.
type MergeBooks = (json: string) => void;
type MergeVault = (json: string | null | undefined) => void;

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

// Run a Drive operation with a valid token, silently refreshing (no popup) when
// the token is missing or has expired, then retrying once. Never throws.
export async function withFreshToken<T>(
  fn: (token: string) => Promise<T>
): Promise<T | undefined> {
  const refresh = async (): Promise<string | null> => {
    try {
      return await drive.connectSilent(GOOGLE_CLIENT_ID);
    } catch {
      return null;
    }
  };
  let token = drive.getToken();
  if (!token) token = await refresh();
  if (!token) return undefined;
  try {
    return await fn(token);
  } catch {
    const t2 = await refresh();
    if (!t2) return undefined;
    try {
      return await fn(t2);
    } catch {
      return undefined;
    }
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
  vaultMergeRemote: MergeVault
) {
  try {
    const p = JSON.parse(text);
    const data = p && p.data ? p.data : p;
    if (!data || typeof data !== "object") return;
    if (data["scribal_books_v1"]) mergeRemoteBooks(data["scribal_books_v1"]);
    if (data["scribal_vault_v1"]) vaultMergeRemote(data["scribal_vault_v1"]);
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
  vaultMergeRemote: MergeVault
): Promise<PushResult> {
  const remoteText = await withFreshToken((tok) => drive.loadData(tok));
  const base = Date.parse(localStorage.getItem("scribal_sync_seen") || "") || 0;
  const localMarks = countBookMarksFromJson(
    localStorage.getItem("scribal_books_v1")
  );
  let remoteAt = 0;
  let remoteMarks = -1;
  if (remoteText) {
    try {
      const p = JSON.parse(remoteText);
      remoteAt = p && p.exportedAt ? Date.parse(p.exportedAt) : 0;
      remoteMarks = countBookMarksFromJson(booksFromBackup(remoteText));
    } catch {
      /* treat as no usable remote */
    }
  }

  // Rule 1 — we're behind the cloud.
  if (remoteText && remoteAt && remoteAt > base) {
    if (remoteMarks === 0 && localMarks > 0) return "blocked";
    applyRemoteLive(remoteText, mergeRemoteBooks, vaultMergeRemote);
    return "adopted";
  }

  // Rule 2 — don't push emptiness over a cloud that has marks.
  if (localMarks === 0 && remoteMarks > 0) return "blocked";

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
  vaultMergeRemote: MergeVault
): Promise<boolean> {
  const text = await withFreshToken((tok) => drive.loadData(tok));
  if (!text) return false;
  try {
    const parsed = JSON.parse(text);
    const remoteAt =
      parsed && parsed.exportedAt ? Date.parse(parsed.exportedAt) : 0;
    const seen =
      Date.parse(localStorage.getItem("scribal_sync_seen") || "") || 0;
    if (remoteAt && remoteAt > seen) {
      const localMarks = countBookMarksFromJson(
        localStorage.getItem("scribal_books_v1")
      );
      const remoteMarks = countBookMarksFromJson(booksFromBackup(text));
      if (remoteMarks === 0 && localMarks > 0) return false;
      applyRemoteLive(text, mergeRemoteBooks, vaultMergeRemote);
      return true;
    }
  } catch {}
  return false;
}
