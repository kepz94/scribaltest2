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

// ═══ Link verse: which verses the picker may offer ═══════════════════════════
// One rule, one builder, both shells: the Link verse picker offers exactly the
// verses the study's READING PANEL shows — marked ones grouped under the theme
// they're most heavily marked in, and an Unmarked group for the panel's verses
// with no marks yet.
//
// `panelRefs` is that panel, when it is narrower than the chapters the study
// spans. A keyword study's panel shows only its GATHERED verses — but desktop
// built the picker from every verse of every chapter a gathered verse had ever
// come from, so the Unmarked group buried the study's own verses under
// hundreds of strangers (Kepu, Aug 7 2026: "every verse from every chapter
// I've ever pulled a verse from"). A chapter or linked study's panel IS its
// whole chapters, so those callers pass nothing and keep every verse.
export interface LinkableEntry {
  reference: string;
  text: string;
}

export function linkableVersesFor<
  M extends { reference: string; color: number; style: string }
>(
  entries: LinkableEntry[],
  marks: M[],
  stylePoints: Record<string, number>,
  labelFor: (color: number) => string,
  panelRefs?: string[] | null
): { reference: string; text: string; color: number | null; themeName: string }[] {
  const panel = panelRefs ? new Set(panelRefs) : null;
  const byRef = new Map<string, M[]>();
  marks.forEach((m) => {
    const list = byRef.get(m.reference);
    if (list) list.push(m);
    else byRef.set(m.reference, [m]);
  });
  return entries
    .filter((e) => !panel || panel.has(e.reference))
    .map((e) => {
      const vMarks = byRef.get(e.reference) || [];
      let color: number | null = null;
      let best = 0;
      const weights = new Map<number, number>();
      vMarks.forEach((m) => {
        weights.set(
          m.color,
          (weights.get(m.color) || 0) + (stylePoints[m.style] || 0)
        );
      });
      weights.forEach((w, c) => {
        if (w > best) {
          best = w;
          color = c;
        }
      });
      const themeName =
        color != null
          ? (labelFor(color) || "").trim() || "Color " + color
          : "Unmarked";
      return { reference: e.reference, text: e.text, color, themeName };
    });
}
