// Browser-only Google Drive sync for Scribal.
// Uses Google Identity Services (GIS) for the OAuth token and the Drive REST API.
// Data is stored in the hidden appDataFolder, so it never clutters the user's Drive
// and the app can only see files it created. No backend required.

const GIS_SRC = "https://accounts.google.com/gsi/client";
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const FILE_NAME = "scribal-data.json";

let gisLoading: Promise<void> | null = null;
let accessToken: string | null = null;

const TOKEN_KEY = "scribal_drive_token";
const EXP_KEY = "scribal_drive_token_exp";

// When the current token goes stale (epoch ms; 0 = none/unknown yet).
let tokenExpiry = 0;

function ssGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

// Store the token in memory AND sessionStorage so it survives a page reload
// (the gate's auto-load reloads the page; we don't want to re-popup after that).
// We also record when it expires so we never hand a dead token to a Drive call.
function setToken(t: string, expiresInSec?: number) {
  accessToken = t;
  // GIS access tokens last ~3600s. Treat ours as stale ~2 min early so a refresh
  // happens before it actually dies (and so the UI can prompt a reconnect).
  const ttl = (expiresInSec && expiresInSec > 0 ? expiresInSec : 3600) - 120;
  tokenExpiry = Date.now() + Math.max(ttl, 60) * 1000;
  try {
    sessionStorage.setItem(TOKEN_KEY, t);
    sessionStorage.setItem(EXP_KEY, String(tokenExpiry));
  } catch {}
}

// Return the current token without any popup or network call — but only if it
// hasn't expired. Returns null once stale so callers refresh instead of using a
// dead token. Used by auto-save.
export function getToken(): string | null {
  const t = accessToken || ssGet(TOKEN_KEY);
  if (!t) return null;
  const exp = tokenExpiry || Number(ssGet(EXP_KEY) || 0);
  if (exp && Date.now() >= exp) return null; // expired — force a refresh
  return t;
}

// True when we currently hold a token that hasn't expired (no popup/network).
// The UI uses this to show a "tap to reconnect" cue when a silent refresh fails.
export function tokenValid(): boolean {
  return getToken() !== null;
}

function loadGis(): Promise<void> {
  if (gisLoading) return gisLoading;
  gisLoading = new Promise<void>((resolve, reject) => {
    const w = window as any;
    if (w.google && w.google.accounts && w.google.accounts.oauth2) {
      resolve();
      return;
    }
    const existing = document.querySelector(
      'script[src="' + GIS_SRC + '"]'
    ) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load Google sign-in"))
      );
      return;
    }
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google sign-in"));
    document.head.appendChild(s);
  });
  return gisLoading;
}


// Opens the Google consent/sign-in popup and resolves with an access token.
export function preloadGis(): void {
  // Warm up the Google script early so the interactive popup can open
  // synchronously within the user's tap (iOS blocks popups after an await).
  loadGis().catch(() => {});
}

export async function connect(clientId: string): Promise<string> {
  if (!clientId) throw new Error("Missing Google client ID");
  const w = window as any;
  const ready = w.google && w.google.accounts && w.google.accounts.oauth2;
  if (!ready) await loadGis();
  const google = (window as any).google;
  return new Promise<string>((resolve, reject) => {
    try {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: (resp: any) => {
          if (resp && resp.access_token) {
            setToken(resp.access_token, resp.expires_in);
            resolve(resp.access_token);
          } else {
            reject(new Error(resp && resp.error ? resp.error : "Sign-in failed"));
          }
        },
        error_callback: (err: any) => {
          reject(new Error(err && err.type ? err.type : "Sign-in cancelled"));
        },
      });
      // Interactive sign-in: always show the Google account/consent screen
      // (testers must pass the consent screen to grant the Drive scope).
      tokenClient.requestAccessToken({ prompt: "consent" });
    } catch (e) {
      reject(e as Error);
    }
  });
}

export function disconnect(): void {
  const google = (window as any).google;
  if (accessToken && google && google.accounts && google.accounts.oauth2) {
    try {
      google.accounts.oauth2.revoke(accessToken, () => {});
    } catch {}
  }
  accessToken = null;
  tokenExpiry = 0;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EXP_KEY);
  } catch {}
}

// NOTE (SCR-11): there is deliberately no "silent" refresh here. GIS's
// requestAccessToken({ prompt: "" }) still opens a popup window (it only
// skips the consent UI), so calling it without a user gesture gets the popup
// blocked — the "Failed to open popup window" console error on every load.
// Token refresh happens only through connect() from a real click (the
// "Reconnect to sync" nudge); background ops use getToken() or skip.

async function findFileId(token: string): Promise<string | null> {
  const q = encodeURIComponent("name='" + FILE_NAME + "'");
  const url =
    "https://www.googleapis.com/drive/v3/files" +
    "?spaces=appDataFolder&fields=files(id,name)&q=" +
    q;
  const res = await fetch(url, {
    headers: { Authorization: "Bearer " + token },
  });
  if (!res.ok) throw new Error("Drive list failed (" + res.status + ")");
  const json = await res.json();
  const files = (json && json.files) || [];
  return files.length ? files[0].id : null;
}

// Writes the given JSON string to the single app-data file (create or overwrite).
export async function saveData(token: string, content: string): Promise<void> {
  const existingId = await findFileId(token);
  if (existingId) {
    const res = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files/" +
        existingId +
        "?uploadType=media",
      {
        method: "PATCH",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: content,
      }
    );
    if (!res.ok) throw new Error("Drive save failed (" + res.status + ")");
    return;
  }
  const boundary = "scribal_" + Math.random().toString(36).slice(2);
  const metadata = { name: FILE_NAME, parents: ["appDataFolder"] };
  const body =
    "--" +
    boundary +
    "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    "\r\n--" +
    boundary +
    "\r\nContent-Type: application/json\r\n\r\n" +
    content +
    "\r\n--" +
    boundary +
    "--";
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "multipart/related; boundary=" + boundary,
      },
      body,
    }
  );
  if (!res.ok) throw new Error("Drive create failed (" + res.status + ")");
}

// Reads the app-data file, or returns null if it doesn't exist yet.
export async function loadData(token: string): Promise<string | null> {
  const id = await findFileId(token);
  if (!id) return null;
  const res = await fetch(
    "https://www.googleapis.com/drive/v3/files/" + id + "?alt=media",
    { headers: { Authorization: "Bearer " + token } }
  );
  if (!res.ok) throw new Error("Drive read failed (" + res.status + ")");
  return await res.text();
}
