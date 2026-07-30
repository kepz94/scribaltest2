import { Mark, MarkColor, COLORS, STYLE_POINTS } from "./types";
import { TableCard } from "./hooks/useStudyTables";

// The Outline assembly, extracted (SCR-56) so the compiled starting state of a
// study's table and the Outline rendering share ONE arrangement instead of two
// drifting copies: themes in pen order, each holding the verses marked in that
// color, pin-aware, sorted by points or by order. Pure data — no React.

// A verse in compile scope. `order` is the canonical position (or a topic
// study's saved order — the caller decides, exactly as Outline always has).
// Generic so callers keep their richer entry shapes (chapterRef, text, …).
export interface AssemblyEntry {
  reference: string;
  order: number;
}

export interface MarkRun {
  start: number;
  end: number;
  style: Mark["style"];
}

export interface ThemeGroup<E extends AssemblyEntry> {
  color: MarkColor;
  // The in-scope marks of this color — what the verses render with.
  colorMarks: Mark[];
  entries: E[];
  totalPts: number;
}

// Merge overlapping/adjacent ranges of the SAME style into clean runs
// (SCR-12). Stacked near-duplicate marks (the triple-click double-fire,
// off-by-one legacy boundaries) rendered as separate near-identical outline
// entries and double-counted points. Different styles stay separate runs so
// intentional layering (a bold word inside a highlighted phrase) keeps its
// own entry and its own points.
export const mergedRunsFor = (ms: Mark[]): MarkRun[] => {
  const styles = Array.from(new Set(ms.map((m) => m.style)));
  const out: MarkRun[] = [];
  styles.forEach((style) => {
    const runs: MarkRun[] = [];
    ms.filter((m) => m.style === style)
      .map((m) => ({ start: m.startIndex, end: m.endIndex, style }))
      .filter((f) => f.end > f.start)
      .sort((a, b) => a.start - b.start)
      .forEach((f) => {
        const last = runs[runs.length - 1];
        if (last && f.start <= last.end) last.end = Math.max(last.end, f.end);
        else runs.push(f);
      });
    out.push(...runs);
  });
  return out.sort((a, b) => a.start - b.start);
};

// A verse's points within one color, summed over merged runs so stacked
// duplicate marks don't inflate the total (SCR-12).
export const pointsFor = (reference: string, colorMarks: Mark[]): number =>
  mergedRunsFor(colorMarks.filter((m) => m.reference === reference)).reduce(
    (s, f) => s + STYLE_POINTS[f.style],
    0
  );

export const assembleThemes = <E extends AssemblyEntry>(
  entries: E[],
  marks: Mark[],
  opts?: {
    // Per color, refs the user pinned to the theme's top, in pin order —
    // their call outranks either automatic sort. Keyed by String(color).
    pins?: Record<string, string[]>;
    sortMode?: "points" | "order";
  }
): ThemeGroup<E>[] => {
  const sortMode = (opts && opts.sortMode) || "points";
  const pins = (opts && opts.pins) || {};
  // Scope to the entries' refs so an out-of-scope mark can neither surface a
  // theme nor color a verse (Outline's relevantMarks semantics).
  const inScope = new Set(entries.map((e) => e.reference));
  const scoped = marks.filter((m) => inScope.has(m.reference));
  const groups: ThemeGroup<E>[] = [];
  COLORS.forEach((color) => {
    const colorMarks = scoped.filter((m) => m.color === color);
    if (colorMarks.length === 0) return;
    const refs = new Set(colorMarks.map((m) => m.reference));
    const pinned = pins[String(color)] || [];
    const pinRank = (r: string) => {
      const i = pinned.indexOf(r);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    const list = entries
      .filter((e) => refs.has(e.reference))
      .sort((a, b) =>
        sortMode === "points"
          ? pinRank(a.reference) - pinRank(b.reference) ||
            pointsFor(b.reference, colorMarks) -
              pointsFor(a.reference, colorMarks)
          : pinRank(a.reference) - pinRank(b.reference) || a.order - b.order
      );
    const totalPts = list.reduce(
      (s, e) => s + pointsFor(e.reference, colorMarks),
      0
    );
    groups.push({ color, colorMarks, entries: list, totalPts });
  });
  return groups;
};

// The compiled starting state of a study's table (ADR-007 §3 / SCR-56): the
// Outline arrangement as cards — one heading per theme, scripture cards in
// canon order beneath. Ids are deterministic per (color, ref) so the live
// (unpromoted) table can be re-generated every render without churning keys,
// and the promotion write persists exactly what was on screen.
export const compiledCards = (
  entries: AssemblyEntry[],
  marks: Mark[],
  themeName: (color: MarkColor) => string
): TableCard[] => {
  const cards: TableCard[] = [];
  assembleThemes(entries, marks, { sortMode: "order" }).forEach((g) => {
    cards.push({
      id: "compiled_h" + g.color,
      kind: "heading",
      text: themeName(g.color),
    });
    g.entries.forEach((e) =>
      cards.push({
        id: "compiled_" + g.color + "_" + e.reference,
        kind: "scripture",
        refs: [e.reference],
      })
    );
  });
  return cards;
};
