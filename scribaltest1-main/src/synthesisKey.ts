// Which note holds a study's synthesis.
//
// Both shells store it under "synthesis|<chapter>+<chapter>…", but they used to
// build that chapter list from different things: desktop from the study's SCOPE
// (its compile tabs), mobile from its MARKS. Those are the same list only when
// every chapter in the study has a mark on it — which is exactly what a keyword
// or topic study does NOT guarantee, because gathering a verse does not mark it.
// So a study spanning Luke 19, John 2 and Psalms 69 with marks in only one of
// them gave desktop "synthesis|Luke 19+John 2+Psalms 69" and mobile
// "synthesis|Luke 19": two notes, one study, each shell reading its own and each
// convinced the other had lost text.
//
// The fix is one source (the scope) and one resolver (this file).
//
// Matching is order-INSENSITIVE on purpose. Desktop mints in tab order, mobile
// in scripture order, and neither is wrong — but "John 2+Luke 19" and
// "Luke 19+John 2" are the same study and must resolve to the same note. Minting
// is deliberately NOT normalized: an existing note keeps whatever order it was
// written under, and rewriting that string would orphan it.

export const SYNTH_PREFIX = "synthesis|";
// The stable key. A chapter list describes what a study CONTAINS, and that
// changes every time the study gains a verse from a new chapter — which on
// Jul 31 2026 detached an 8,656-character synthesis from a keyword study the
// moment five verses were gathered into it, on both shells at once, because
// both compute the chapter key the same way. A scope names the study ITSELF
// and does not move when its contents do. The per-theme syntheses were always
// keyed this way ("synthesis:" + scope + ":" + color); only the study-level
// one was keyed by its chapters.
export const SYNTH_SCOPE_PREFIX = "synthesis|scope:";

export function chaptersOfKey(key: string): string[] {
  return key.slice(SYNTH_PREFIX.length).split("+").filter(Boolean);
}

export function synthesisKeyFor(chapters: string[]): string {
  return SYNTH_PREFIX + chapters.join("+");
}

export function synthesisKeyForScope(scope: string): string {
  return SYNTH_SCOPE_PREFIX + scope;
}

// One chapter, two spellings. Verse references say "D&C 93" (MobileApp's ref
// convention, BOOK_ABBREV there); desktop's tab label and the reading header say
// "Doctrine and Covenants 93". A synthesis minted from one spelling could not be
// found from the other, which is how "Record Of John" lost its note without the
// study ever changing — a second, independent way for a chapter-list key to
// break, found Jul 31 2026 alongside the first.
//
// Matching only. Minting still uses whatever the caller was given, so no
// existing key is ever rewritten.
const BOOK_ALIASES: Record<string, string> = {
  "doctrine and covenants": "d&c",
};

const normalizeChapter = (chapter: string): string => {
  const s = String(chapter).trim().replace(/\s+/g, " ").toLowerCase();
  const m = s.match(/^(.*\S)(\s+\d+)$/);
  if (!m) return s;
  return (BOOK_ALIASES[m[1]] || m[1]) + m[2];
};

const canon = (chapters: string[]) =>
  chapters.map(normalizeChapter).sort().join("+");

// Legacy chapter-list keys only — a scope key is not a chapter list and must
// never be read as one.
const legacyKeys = (notes: Record<string, string>) =>
  Object.keys(notes).filter(
    (k) =>
      k.indexOf(SYNTH_PREFIX) === 0 &&
      k.indexOf(SYNTH_SCOPE_PREFIX) !== 0 &&
      (notes[k] || "").trim()
  );

// The key this study's synthesis lives under.
//
// 1. The scope key, when it holds text. Stable across anything the study gains.
// 2. Else a legacy chapter-list note for this exact set of chapters, whatever
//    order it was written in — read in place, so nothing already written moves
//    or is orphaned by this change.
// 3. Else mint. Prefer the scope key; fall back to the chapter list only when
//    the caller has no scope to give.
//
// Step 2 stays deliberately NON-fuzzy. An earlier attempt fell back to "any
// written study whose scope contains all my chapters", which reads well until a
// plain chapter study of John 2 silently adopts the synthesis of a keyword study
// that happens to include John 2. Two studies over overlapping chapters are
// still two studies; only an exact set is the same study. The scope key is what
// makes that strictness safe — identity no longer rides on the chapter list.
export function resolveSynthesisKey(
  notes: Record<string, string>,
  chapters: string[],
  scope?: string
): string {
  if (scope) {
    const sk = synthesisKeyForScope(scope);
    if ((notes[sk] || "").trim()) return sk;
  }
  const want = canon(chapters);
  const exact = legacyKeys(notes).find(
    (k) => canon(chaptersOfKey(k)) === want
  );
  if (exact) return exact;
  return scope ? synthesisKeyForScope(scope) : synthesisKeyFor(chapters);
}

// The one-time hand-off: a legacy chapter-keyed note that should be copied onto
// this study's scope key, or null when there is nothing to move. Returns a key
// only while the scope key is still empty, so the copy happens once and never
// overwrites a synthesis written under the new scheme.
//
// Without this, an existing note keeps being read in place (resolve step 2) and
// stays exposed to the exact failure this change exists to stop: it survives
// only until the study's chapter set moves.
export function legacySynthesisKeyToMigrate(
  notes: Record<string, string>,
  chapters: string[],
  scope: string
): string | null {
  if (!scope) return null;
  if ((notes[synthesisKeyForScope(scope)] || "").trim()) return null;
  const want = canon(chapters);
  return legacyKeys(notes).find((k) => canon(chaptersOfKey(k)) === want) || null;
}
