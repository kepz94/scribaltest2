// booksStore.ts
// The ONE way the book store (scribal_books_v1 — every book, mark and note) is
// read from or written to this device's localStorage (SCR-121).
//
// Oct 1 2026: the phone's localStorage hit WebKit's per-origin quota (~5 MB).
// The books blob was already 1.57M characters on Aug 20, and every save was a
// bare `try { setItem } catch {}` — so for ten days each save failed without a
// word. The phone ran on in-memory state (marks showed at work), reloaded the
// ten-day-old blob whenever iOS restarted the app (studies listed, 0 marks),
// and cloudSync, which pushes what it READS from storage, uploaded that stale
// blob over the cloud. Only the work PC re-pushing brought it back.
//
// Three rules live here:
// 1. At rest the blob is compressed: "zf1:" + base64(raw DEFLATE of its UTF-8).
//    JSON this repetitive shrinks several-fold, which buys the headroom back.
//    A value without the prefix is the legacy raw JSON and reads unchanged, so
//    nothing is lost on upgrade; the next save rewrites it compressed.
// 2. Everyone else sees RAW JSON. Merges, cloud shards, backup files and Drive
//    payloads never carry the at-rest form — readStoredValue() decodes.
// 3. A failed save is a fact other code can ask about (booksSaveFailed), so
//    sync can refuse to upload a copy that is not what this device holds, and
//    the status line can say so instead of hiding it.
//
// UTF-8 goes through TextEncoder/TextDecoder (every target browser has them),
// falling back to the encodeURIComponent route — NOT fflate's own codec, whose
// fallback mangles 4-byte characters (an emoji in a note came back as a
// different character in testing).

import { deflateSync, inflateSync, strToU8, strFromU8 } from "fflate";

export const BOOKS_STORE_KEY = "scribal_books_v1";
export const STORE_PREFIX = "zf1:";
export const STORAGE_FULL_MESSAGE = "Storage full — not saving on this device";

function utf8Bytes(s: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
  // encodeURIComponent emits UTF-8 percent-escapes (surrogate pairs included);
  // unescape turns each into one char code 0–255 — a byte string.
  return strToU8(unescape(encodeURIComponent(s)), true);
}

function utf8String(b: Uint8Array): string {
  if (typeof TextDecoder !== "undefined")
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  return decodeURIComponent(escape(strFromU8(b, true)));
}

// Raw JSON → at-rest form. Pure; exported for tests.
export function encodeBooks(json: string): string {
  const z = deflateSync(utf8Bytes(json), { level: 6 });
  return STORE_PREFIX + btoa(strFromU8(z, true));
}

// At-rest form (or legacy raw JSON) → raw JSON. null for a missing value or a
// compressed value that will not decode — never hand a merge garbage.
export function decodeBooks(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined) return null;
  if (stored.indexOf(STORE_PREFIX) !== 0) return stored; // legacy raw JSON
  try {
    const bin = atob(stored.slice(STORE_PREFIX.length));
    return utf8String(inflateSync(strToU8(bin, true)));
  } catch {
    return null;
  }
}

// Decoding a large blob costs tens of milliseconds and sync reads it on every
// push, so the last stored string and its JSON are remembered.
let memoStored: string | null = null;
let memoJson: string | null = null;

export function readBooksJson(): string | null {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(BOOKS_STORE_KEY);
  } catch {
    return null;
  }
  if (stored === null) return null;
  if (stored === memoStored) return memoJson;
  const json = decodeBooks(stored);
  memoStored = stored;
  memoJson = json;
  return json;
}

let saveFailed = false;

// True while the most recent save of the book store did not land — this
// device's storage no longer holds what it is showing.
export function booksSaveFailed(): boolean {
  return saveFailed;
}

// Save the book store. Returns whether it landed; a failure is remembered for
// booksSaveFailed() until a later save succeeds.
export function writeBooksJson(json: string): boolean {
  let stored: string;
  try {
    stored = encodeBooks(json);
    localStorage.setItem(BOOKS_STORE_KEY, stored);
  } catch {
    saveFailed = true;
    return false;
  }
  saveFailed = false;
  memoStored = stored;
  memoJson = json;
  return true;
}

// What a backup / sync layer should see for any localStorage key: the book
// store as raw JSON, every other key exactly as stored.
export function readStoredValue(key: string): string | null {
  if (key === BOOKS_STORE_KEY) return readBooksJson();
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
