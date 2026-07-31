import { WordTag } from "./types";
import { definitionForKey, carriedSenses } from "./webster";

export interface LinkableDefinitionData {
  dictKey: string;
  word: string;
  reference: string;
  senses: { n: number; text: string }[];
}

// The definitions a study can link from a note: one row per sense the reader
// actually chose. Both outlines built this inline and identically.
//
// `dictReady` is load-bearing, not a nicety. Every row resolves through
// definitionForKey, which returns null until the 5MB dictionary is in memory —
// so before it lands this returns [], the toolbar's `hasDefs` gate is false, and
// the Link definition button silently never renders. That is exactly how the
// button went missing: neither outline ever loaded or awaited the dictionary.
export function linkableDefinitionsFor(
  tags: WordTag[] | undefined,
  dictReady: boolean
): LinkableDefinitionData[] {
  if (!dictReady) return [];
  return (tags || [])
    .map((t) => ({
      dictKey: t.dictKey,
      word: t.word || t.dictKey,
      reference: t.reference,
      // Chosen senses, or the sole sense of a single-meaning word.
      senses: carriedSenses(definitionForKey(t.dictKey) || "", t.senses),
    }))
    .filter((d) => d.senses.length > 0);
}

// Whether this study has anything to look up — and so whether it is worth
// fetching the dictionary at all. ANY tag qualifies, not just one with chosen
// senses: a single-meaning word carries its meaning without the reader having
// chosen anything.
export function hasTaggedWords(tags: WordTag[] | undefined): boolean {
  return (tags || []).length > 0;
}
