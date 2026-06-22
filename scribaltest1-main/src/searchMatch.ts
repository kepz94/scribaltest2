// Shared search matcher used by BOTH the desktop search (SearchPanel) and the
// mobile search (MobileSearch), so the two behave *identically*. This is the
// single source of truth for how a query is interpreted.
//
// Query language (works in every mode):
//   OR  -> alternatives, e.g. "mercy OR grace" matches either side.
//          (lowest precedence — splits the query into independent groups)
//   &   -> required parts, e.g. "good works & faith" requires both.
//          (binds tighter than OR)
//   *   -> word wildcard, e.g. "merc*" matches mercy, merciful, mercies.
//
// The mode decides how the plain words *within a part* combine:
//   "phrase" -> the words must appear together, in order (flexible spacing).
//   "all"    -> every word must appear somewhere.
//   "any"    -> at least one word must appear.
//
// wholeWord:
//   true  -> words match whole words only ("love" will not match "beloved").
//   false -> words may match inside longer words.
//
// Returns a tester plus `terms`: a list of regex sources that callers feed
// straight into a highlight regex (already wildcard/whole-word aware).

export type SearchMode = "all" | "any" | "phrase";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A word inside a phrase: honor * but let the phrase ends carry the boundaries.
const innerWordSource = (w: string) =>
  w.includes("*") ? escapeRe(w).replace(/\\\*/g, "\\w*") : escapeRe(w);

const phraseSource = (words: string[], wholeWord: boolean) => {
  const inner = words.map(innerWordSource).join("\\s+");
  return (wholeWord ? "\\b" : "") + inner + (wholeWord ? "\\b" : "");
};

// A standalone word (All / Any modes).
const wordSource = (w: string, wholeWord: boolean) => {
  if (w.includes("*")) return "\\b" + escapeRe(w).replace(/\\\*/g, "\\w*");
  if (wholeWord) return "\\b" + escapeRe(w) + "\\b";
  return escapeRe(w);
};

const safeRe = (src: string): RegExp | null => {
  try {
    return new RegExp(src, "i");
  } catch {
    return null;
  }
};

export function buildSearchMatcher(
  query: string,
  mode: SearchMode,
  wholeWord: boolean
): { test: (txt: string) => boolean; terms: string[] } | null {
  const lower = (query || "").trim().toLowerCase();
  if (!lower) return null;

  const hi: string[] = []; // regex sources for highlighting
  const groups = lower
    .split(/\s+or\s+/i) // OR -> alternative groups
    .map((g) =>
      g
        .split("&") // & -> required parts within a group
        .map((part) =>
          part
            .trim()
            .split(/\s+/) // spaces -> words
            .map((t) => t.trim())
            .filter((t) => t.replace(/\*/g, "").length > 0)
        )
        .filter((words) => words.length > 0)
    )
    .filter((parts) => parts.length > 0);
  if (!groups.length) return null;

  const compiled = groups.map((parts) =>
    parts.map((words): ((txt: string) => boolean) => {
      if (mode === "phrase") {
        const src = phraseSource(words, wholeWord);
        hi.push(src);
        const re = safeRe(src);
        return (txt) => (re ? re.test(txt) : false);
      }
      // "all" / "any": each word is matched on its own.
      const res = words.map((w) => {
        const s = wordSource(w, wholeWord);
        hi.push(s);
        return safeRe(s);
      });
      if (mode === "any") {
        return (txt) => res.some((re) => (re ? re.test(txt) : false));
      }
      return (txt) => res.every((re) => (re ? re.test(txt) : false)); // all
    })
  );

  const test = (txt: string) =>
    compiled.some((parts) => parts.every((fn) => fn(txt)));

  // De-dupe the highlight sources (no Set spread, for older TS targets).
  const seen: Record<string, true> = {};
  const terms: string[] = [];
  for (const s of hi) {
    if (!seen[s]) {
      seen[s] = true;
      terms.push(s);
    }
  }

  return { test, terms };
}
