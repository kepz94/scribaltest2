import { WordTag } from "./types";
import { definitionForKey, sensesFor } from "./webster";

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
    .filter((t) => t.senses && t.senses.length > 0)
    .map((t) => ({
      dictKey: t.dictKey,
      word: t.word || t.dictKey,
      reference: t.reference,
      senses: sensesFor(definitionForKey(t.dictKey) || "", t.senses),
    }))
    .filter((d) => d.senses.length > 0);
}

// Whether this study has anything to link — also whether it is worth fetching
// the dictionary at all.
export function hasChosenSenses(tags: WordTag[] | undefined): boolean {
  return (tags || []).some((t) => t.senses && t.senses.length > 0);
}
