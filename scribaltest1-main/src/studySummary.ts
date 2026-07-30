// Builds the data behind the study-summary card — the scope of what was
// studied, its themes, and the candidate verses the preview's featured-verse
// picker cycles through. Pure: no React, no DOM, so both shells (and the tests)
// can call it. Lifted out of MobileCompile's shareStudy() when desktop needed
// the same card.
import { Mark, COLORS, STYLE_POINTS } from "./types";
import { CompTheme } from "./shareCard";

export interface StudySummary {
  scopeTitle: string;
  studyLabel: string;
  dateStr: string;
  totalMarks: number;
  passages: number;
  themes: CompTheme[];
  candidates: { text: string; reference: string; style: string; color: number }[];
  defaultFeatured: number;
}

export interface StudySummaryInput {
  marks: Mark[];
  colorLabels: Record<number, string>;
  // Scripture order for a reference — the shells already own this.
  orderOf: (ref: string) => number;
  // The study's own name, shown under the scope title.
  title: string;
  // The synthesis text, if written; it rides on the largest theme.
  synthesis?: string;
  // Injectable so tests aren't dated.
  now?: Date;
}

export function buildStudySummary(input: StudySummaryInput): StudySummary {
  const { marks, colorLabels, orderOf, title } = input;

  const byColor: Record<number, Mark[]> = {};
  marks.forEach((m) => {
    if (!byColor[m.color]) byColor[m.color] = [];
    byColor[m.color].push(m);
  });
  const activeColors = COLORS.filter((c) => (byColor[c] || []).length > 0);

  const themes: CompTheme[] = activeColors
    .map((c) => ({
      name: (colorLabels[c] || "Color " + c).trim(),
      color: c,
      synthesis: "",
      count: (byColor[c] || []).length,
    }))
    .sort((a, b) => b.count - a.count)
    .map((t, i) => (i === 0 ? { ...t, synthesis: (input.synthesis || "").trim() } : t));

  // Scripture scope — what was actually studied.
  const byBook = new Map<
    string,
    { min: number; max: number; chaps: Set<number>; order: number }
  >();
  marks.forEach((m) => {
    const mm = m.reference.match(/^(.*?)\s+(\d+):/);
    if (!mm) return;
    const book = mm[1];
    const chap = parseInt(mm[2], 10);
    const ord = orderOf(m.reference);
    const cur = byBook.get(book);
    if (!cur)
      byBook.set(book, { min: chap, max: chap, chaps: new Set([chap]), order: ord });
    else {
      cur.min = Math.min(cur.min, chap);
      cur.max = Math.max(cur.max, chap);
      cur.chaps.add(chap);
      cur.order = Math.min(cur.order, ord);
    }
  });
  const bookEntries = Array.from(byBook.entries()).sort(
    (a, b) => a[1].order - b[1].order
  );
  const passages = bookEntries.reduce((s, [, v]) => s + v.chaps.size, 0);
  let scopeTitle = "Scripture Study";
  if (bookEntries.length === 1) {
    const [name, v] = bookEntries[0];
    scopeTitle =
      v.min === v.max ? name + " " + v.min : name + " " + v.min + "–" + v.max;
  } else if (bookEntries.length >= 2 && bookEntries.length <= 3) {
    scopeTitle = bookEntries.map(([n]) => n).join(" · ");
  } else if (bookEntries.length > 3) {
    scopeTitle =
      bookEntries[0][0] + " – " + bookEntries[bookEntries.length - 1][0];
  }

  // Candidate verses (for the featured-verse picker), in scripture order.
  const ordered = marks
    .filter((m) => m.markedText.trim())
    .slice()
    .sort((a, b) => orderOf(a.reference) - orderOf(b.reference));
  const candidates = ordered.map((m) => ({
    text: m.markedText,
    reference: m.reference,
    style: m.style,
    color: m.color,
  }));

  // Default featured = the most-emphasized mark.
  let defaultFeatured = 0;
  let bestScore = -1;
  ordered.forEach((m, i) => {
    const sc = STYLE_POINTS[m.style] || 0;
    if (sc > bestScore) {
      bestScore = sc;
      defaultFeatured = i;
    }
  });

  const dateStr = (input.now || new Date()).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return {
    scopeTitle,
    studyLabel: title,
    dateStr,
    totalMarks: marks.length,
    passages,
    themes,
    candidates,
    defaultFeatured,
  };
}
