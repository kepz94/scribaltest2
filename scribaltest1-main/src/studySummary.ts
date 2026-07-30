// Builds the data behind the study-summary card — the scope of what was
// studied, its themes, and the candidate verses the preview's featured-verse
// picker cycles through. Pure: no React, no DOM, so both shells (and the tests)
// can call it. Lifted out of MobileCompile's shareStudy() when desktop needed
// the same card.
import { Mark, COLORS, STYLE_POINTS } from "./types";
import { CompTheme } from "./shareCard";

// Scattered chapters are listed by name up to this many, then collapsed to a
// count — a title should never be longer than the thing it titles.
const SCOPE_CHAPTER_LIST_MAX = 4;

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
    // Name the chapters that are actually marked. A keyword study can land on
    // Alma 5, 32 and 45 — calling that "Alma 5–45" claims forty-one chapters
    // while the count beside it says three.
    const chaps = Array.from(v.chaps).sort((a, b) => a - b);
    const contiguous = chaps[chaps.length - 1] - chaps[0] === chaps.length - 1;
    if (chaps.length === 1) scopeTitle = name + " " + chaps[0];
    else if (contiguous)
      scopeTitle = name + " " + chaps[0] + "–" + chaps[chaps.length - 1];
    else if (chaps.length <= SCOPE_CHAPTER_LIST_MAX)
      scopeTitle = name + " " + chaps.join(", ");
    else
      // Name the first few and count the rest — "Alma 3 + 5 more chapters"
      // says less than the count line already beside it.
      scopeTitle =
        name +
        " " +
        chaps.slice(0, SCOPE_CHAPTER_LIST_MAX - 1).join(", ") +
        " + " +
        (chaps.length - (SCOPE_CHAPTER_LIST_MAX - 1)) +
        " more";
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
