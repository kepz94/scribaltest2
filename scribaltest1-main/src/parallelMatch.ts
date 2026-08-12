// Proposing which verses correspond, by reading the wording.
//
// Nephi's Isaiah chapters are near word-for-word with Isaiah, so a comparison
// of the two can be aligned by the text itself instead of by hand. The creation
// accounts are looser — same events, different words — so the proposal there is
// a starting point the reader corrects. Either way nothing here decides
// anything: every match it produces is a pin the reader can move or remove.
//
// THE THREE CONSTANTS. Each exists because of a specific way this went wrong.
//
//  MATCH_FLOOR — two verses both saying "Jerusalem" is coincidence, not
//    correspondence. Below the floor a pair counts as no match at all.
//    The value is EMPIRICAL, tuned against seven chapter pairs (2 Nephi 7-8 vs
//    Isaiah 50-52, Genesis 1-2 vs Moses 2-3 and Abraham 4-5). It is not derived
//    from anything, and a different corpus might want a different number.
//
//  MISS_PENALTY — a mismatched pair must COST something. With a plain
//    similarity score a non-matching diagonal is worth zero, which is cheaper
//    than a gap, so the aligner happily walks fifteen worthless pairings rather
//    than pay two gaps to reach two perfect ones. That is not hypothetical:
//    Isaiah 52 against 2 Nephi 8 matched NOTHING until this was added, even
//    though two of its verses score a flat 1.0. See the last test in
//    parallelMatch.test.ts.
//
//  GAP_PENALTY — cheaper than a miss, so a verse with no counterpart falls out
//    as a blank row instead of being forced against a stranger.
//
// Pure: no React, no DOM, no state.

export const MATCH_FLOOR = 0.35;
export const GAP_PENALTY = -0.28;
export const MISS_PENALTY = -0.5;

// Float sums of -0.28 are not exact, so the traceback compares with a
// tolerance. Strict equality drops the optimal path and the alignment silently
// degrades to something plausible but wrong.
const EPS = 1e-9;

// Words that carry no evidence of correspondence. Scripture is dense with these
// and leaving them in lets any two verses look vaguely alike.
const STOP = new Set([
  "the", "and", "of", "that", "to", "in", "it", "is", "for", "unto", "shall",
  "was", "were", "a", "i", "he", "they", "them", "their", "his", "which",
  "with", "not", "be", "as", "said", "god", "lord",
]);

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .split(" ")
    .forEach((w) => {
      if (w.length > 2 && !STOP.has(w)) out.add(w);
    });
  return out;
}

// Sørensen–Dice over content words. Symmetric, 0..1, and 1 only for verses
// whose vocabulary is identical.
export function similarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  A.forEach((w) => {
    if (B.has(w)) shared++;
  });
  return (2 * shared) / (A.size + B.size);
}

const scoreOf = (a: string, b: string): number => {
  const s = similarity(a, b);
  return s < MATCH_FLOOR ? MISS_PENALTY : s;
};

const isMatch = (a: string, b: string): boolean => similarity(a, b) >= MATCH_FLOOR;

// Needleman–Wunsch. Returns, for each index of `b`, the index of `a` it
// corresponds to, or null. The result is monotonic by construction: a later
// verse of b can never match an earlier verse of a, because a crossed pair
// would render as two verses swapping rows, which no parallel reading means.
export function alignSequences(a: string[], b: string[]): (number | null)[] {
  const n = a.length;
  const m = b.length;
  const map: (number | null)[] = new Array(m).fill(null);
  if (!n || !m) return map;

  const M: Float64Array[] = [];
  for (let i = 0; i <= n; i++) M.push(new Float64Array(m + 1));
  for (let i = 1; i <= n; i++) M[i][0] = i * GAP_PENALTY;
  for (let j = 1; j <= m; j++) M[0][j] = j * GAP_PENALTY;

  // Score every pair once; the traceback needs the same numbers the fill used.
  const cell: Float64Array[] = [];
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(m);
    for (let j = 0; j < m; j++) row[j] = scoreOf(a[i], b[j]);
    cell.push(row);
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = M[i - 1][j - 1] + cell[i - 1][j - 1];
      const up = M[i - 1][j] + GAP_PENALTY;
      const left = M[i][j - 1] + GAP_PENALTY;
      M[i][j] = Math.max(diag, up, left);
    }
  }

  const eq = (x: number, y: number): boolean => Math.abs(x - y) < EPS;
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (eq(M[i][j], M[i - 1][j - 1] + cell[i - 1][j - 1])) {
      if (isMatch(a[i - 1], b[j - 1])) map[j - 1] = i - 1;
      i--;
      j--;
    } else if (eq(M[i][j], M[i - 1][j] + GAP_PENALTY)) {
      i--;
    } else {
      j--;
    }
  }
  return map;
}
