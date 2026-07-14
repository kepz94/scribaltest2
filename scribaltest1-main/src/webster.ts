// ---------------------------------------------------------------------------
// Webster's 1828 lookup (shared by the mobile and desktop reading views).
//
// The dictionary is a static asset at public/webster1828.json — a { word: text }
// map already filtered to scripture vocabulary. It is fetched once, lazily, on
// the first lookup (or call loadWebster() eagerly on mount to avoid first-tap
// latency) and then kept in memory for the session.
//
// candidateKeys() below is IDENTICAL to the stemmer used to build that file, so
// every scripture word that has a 1828 entry resolves here (e.g. "baptized" ->
// baptize, "saith" -> say, "mysteries" -> mystery, "began" -> begin).
// ---------------------------------------------------------------------------

export interface WebsterResult {
  key: string; // the dictionary headword that matched (store this on a tag)
  definition: string; // the 1828 definition text
}

const IRREGULAR: Record<string, string> = {
  saith: "say", sayeth: "say", hath: "have", hast: "have", doth: "do", dost: "do",
  began: "begin", begun: "begin", knew: "know", known: "know", ran: "run",
  came: "come", saw: "see", seen: "see", went: "go", took: "take", taken: "take",
  gave: "give", given: "give", spake: "speak", spoke: "speak", spoken: "speak",
  wrote: "write", written: "write", bare: "bear", bore: "bear", born: "bear", borne: "bear",
  arose: "arise", arisen: "arise", rose: "rise", risen: "rise", fell: "fall", fallen: "fall",
  slew: "slay", slain: "slay", smote: "smite", smitten: "smite", drew: "draw", drawn: "draw",
  threw: "throw", thrown: "throw", grew: "grow", grown: "grow", bade: "bid", bidden: "bid",
  sware: "swear", sworn: "swear", forsook: "forsake", forsaken: "forsake", beheld: "behold",
  bound: "bind", found: "find", stood: "stand", understood: "understand", held: "hold",
  told: "tell", sold: "sell", dwelt: "dwell", felt: "feel", wept: "weep", kept: "keep",
  left: "leave", slept: "sleep", sought: "seek", bought: "buy", brought: "bring",
  taught: "teach", caught: "catch", fought: "fight", thought: "think", wrought: "work",
  brethren: "brother", men: "man", women: "woman", children: "child", feet: "foot",
  teeth: "tooth", oxen: "ox", mice: "mouse", geese: "goose",
};

function candidateKeys(raw: string): string[] {
  const out: string[] = [];
  const seen: Record<string, true> = {};
  const add = (k: string) => {
    if (k && k.length >= 2 && !seen[k]) { seen[k] = true; out.push(k); }
  };
  // add a suffix-stripped stem, plus a de-doubled form when it ends in a
  // doubled consonant (sinn -> sin, runn -> run, forbidd -> forbid)
  const addStem = (base: string) => {
    add(base);
    const n = base.length;
    if (n > 2 && base[n - 1] === base[n - 2] && "bcdfghjklmnpqrstvwxz".indexOf(base[n - 1]) >= 0) {
      add(base.slice(0, -1));
    }
  };
  let w = raw;
  add(w);
  if (IRREGULAR[w]) add(IRREGULAR[w]);
  if (w.endsWith("'s")) add(w.slice(0, -2));
  const noap = w.replace(/'/g, "");
  add(noap); w = noap;
  if (IRREGULAR[w]) add(IRREGULAR[w]);
  if (w.endsWith("ies") && w.length > 4) add(w.slice(0, -3) + "y");
  if (w.endsWith("eth") && w.length > 4) { addStem(w.slice(0, -3)); add(w.slice(0, -3) + "e"); }
  if (w.endsWith("est") && w.length > 4) { addStem(w.slice(0, -3)); add(w.slice(0, -3) + "e"); }
  if (w.endsWith("st") && w.length > 3) add(w.slice(0, -2));
  if (w.endsWith("es") && w.length > 3) { addStem(w.slice(0, -2)); add(w.slice(0, -1)); }
  if (w.endsWith("s") && w.length > 3) add(w.slice(0, -1));
  if (w.endsWith("ing") && w.length > 5) { addStem(w.slice(0, -3)); add(w.slice(0, -3) + "e"); }
  if (w.endsWith("ed") && w.length > 4) { addStem(w.slice(0, -2)); add(w.slice(0, -1)); }
  if (w.endsWith("en") && w.length > 4) { addStem(w.slice(0, -2)); add(w.slice(0, -1)); }
  return out;
}

const DICT_URL = "/webster1828.json";
let dict: Record<string, string> | null = null;
let loadPromise: Promise<Record<string, string>> | null = null;

// True once the dictionary is in memory (lets the UI decide enabled/disabled
// state synchronously after an eager loadWebster()).
export function isLoaded(): boolean {
  return dict !== null;
}

// Fetch + cache the dictionary once. Fails soft: on any error the dictionary is
// treated as empty, so the Define feature simply stays inert rather than erroring.
export function loadWebster(): Promise<Record<string, string>> {
  if (dict) return Promise.resolve(dict);
  if (loadPromise) return loadPromise;
  loadPromise = fetch(DICT_URL)
    .then((r) => (r.ok ? r.json() : {}))
    .then((d: unknown) => {
      dict = d && typeof d === "object" ? (d as Record<string, string>) : {};
      return dict;
    })
    .catch(() => {
      dict = {};
      return dict;
    });
  return loadPromise;
}

function resolveIn(d: Record<string, string>, word: string): WebsterResult | null {
  const raw = (word || "").toLowerCase().replace(/[^a-z']/g, "");
  if (!raw) return null;
  for (const k of candidateKeys(raw)) {
    const def = d[k];
    if (typeof def === "string") return { key: k, definition: def };
  }
  return null;
}

// Resolve a selected word to its 1828 entry, loading the dictionary if needed.
export async function lookup(word: string): Promise<WebsterResult | null> {
  const d = await loadWebster();
  return resolveIn(d, word);
}

// Synchronous resolve for when the dictionary is already loaded (e.g. deciding
// whether to show the Define action). Returns null if not loaded or not found.
export function lookupSync(word: string): WebsterResult | null {
  if (!dict) return null;
  return resolveIn(dict, word);
}

// Tags persist the matched key, not the text; this fetches the current text for
// a stored key (so updating the dictionary updates every tag's definition).
export function definitionForKey(key: string): string | null {
  if (!dict) return null;
  const def = dict[key];
  return typeof def === "string" ? def : null;
}

// Cheap check (once loaded) for whether a word can be defined/tagged at all.
export function hasEntry(word: string): boolean {
  return lookupSync(word) !== null;
}
