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

export function chaptersOfKey(key: string): string[] {
  return key.slice(SYNTH_PREFIX.length).split("+").filter(Boolean);
}

export function synthesisKeyFor(chapters: string[]): string {
  return SYNTH_PREFIX + chapters.join("+");
}

const canon = (chapters: string[]) => chapters.slice().sort().join("+");

// The key this study's synthesis lives under: an existing note for the same set
// of chapters, whatever order it was written in, else a fresh key in the order
// given.
//
// Deliberately NO fuzzy matching. An earlier attempt fell back to "any written
// study whose scope contains all my chapters", which reads well until a plain
// chapter study of John 2 silently adopts the synthesis of a keyword study that
// happens to include John 2. Two studies over overlapping chapters are still two
// studies; only an exact set is the same study.
export function resolveSynthesisKey(
  notes: Record<string, string>,
  chapters: string[]
): string {
  const want = canon(chapters);
  const written = Object.keys(notes).filter(
    (k) => k.indexOf(SYNTH_PREFIX) === 0 && (notes[k] || "").trim()
  );
  const exact = written.find((k) => canon(chaptersOfKey(k)) === want);
  return exact || synthesisKeyFor(chapters);
}
