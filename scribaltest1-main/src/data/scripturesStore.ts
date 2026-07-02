// ── The scripture store: scriptures.json OUT of the JS bundle. ──────────────
//
// scriptures.json is ~16 MB. Compiled into the bundle (its old life), every
// first-time visitor downloaded and parsed it before the app could paint.
// Now it lives in /public and is fetched ONCE at startup (Root gates the app
// on it); the service worker's cache-on-demand keeps it offline afterwards.
//
// Consumers get the data two ways:
//   • getScriptures() — the raw parsed JSON; throws if called before load,
//     which can only happen from module-scope code (a bug by definition,
//     since Root doesn't render the app until loading finishes).
//   • volumesProxy — a drop-in stand-in for the old module-scope
//     `const vols = scriptures.volumes` snapshot: an array Proxy that
//     forwards every read to the real volumes array at call time.

let DATA: any = null;
const onLoaded: (() => void)[] = [];
export function registerOnLoaded(fn: () => void): void {
  if (DATA) fn();
  else onLoaded.push(fn);
}
let loadPromise: Promise<any> | null = null;

export function getScriptures(): any {
  if (!DATA)
    throw new Error(
      "scriptures accessed before load — call loadScriptures() first"
    );
  return DATA;
}

export function scripturesReady(): boolean {
  return DATA !== null;
}

export function loadScriptures(): Promise<any> {
  if (DATA) return Promise.resolve(DATA);
  if (loadPromise) return loadPromise;
  loadPromise = fetch(process.env.PUBLIC_URL + "/scriptures.json")
    .then((r) => {
      if (!r.ok) throw new Error("scriptures fetch failed: " + r.status);
      return r.json();
    })
    .then((json) => {
      DATA = json;
      loadPromise = null;
      // Build the verse indexes immediately, so every consumer downstream of
      // Root's gate sees them complete. verseIndex registers itself here at
      // import time (callback, so no import cycle).
      onLoaded.forEach((fn) => fn());
      return DATA;
    })
    .catch((err) => {
      loadPromise = null; // allow retry
      throw err;
    });
  return loadPromise;
}

// Structural types matching scriptures.json, so consumers keep the parameter
// inference the old typed-JSON import gave them. Index signatures allow any
// extra fields the data carries.
export interface ScriptureVerse {
  reference: string;
  verse: number;
  text: string;
  [k: string]: any;
}
export interface ScriptureChapter {
  chapter: number;
  verses: ScriptureVerse[];
  [k: string]: any;
}
export interface ScriptureBook {
  book: string;
  chapters: ScriptureChapter[];
  [k: string]: any;
}
export interface ScriptureVolume {
  volume: string;
  books: ScriptureBook[];
  [k: string]: any;
}

// Drop-in replacement for the old `const vols = scriptures.volumes` pattern:
// looks like an array, resolves against the real data on every access.
export const volumesProxy: ScriptureVolume[] = new Proxy([] as any[], {
  get(_t, prop) {
    return Reflect.get(getScriptures().volumes || [], prop);
  },
  has(_t, prop) {
    return Reflect.has(getScriptures().volumes || [], prop);
  },
  ownKeys() {
    return Reflect.ownKeys(getScriptures().volumes || []);
  },
  getOwnPropertyDescriptor(_t, prop) {
    return Object.getOwnPropertyDescriptor(getScriptures().volumes || [], prop);
  },
});
