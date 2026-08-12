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

// Tokenising is the inner loop: aligning two 31-verse chapters asks for it a
// thousand times, and grouping eight columns asks for twenty-eight alignments.
// The same verse text recurs constantly across those calls, so it is cached.
// Bounded by the number of distinct verses on a board — a few hundred.
const tokenCache = new Map<string, Set<string>>();

function tokens(text: string): Set<string> {
  const key = String(text || "");
  const hit = tokenCache.get(key);
  if (hit) return hit;
  const out = new Set<string>();
  key
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .split(" ")
    .forEach((w) => {
      if (w.length > 2 && !STOP.has(w)) out.add(w);
    });
  if (tokenCache.size < 5000) tokenCache.set(key, out);
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

// ── which columns are the same account ───────────────────────────────────────
//
// A board can hold several accounts at once: Genesis 1 / Moses 2 / Abraham 4 is
// one telling of the creation, Genesis 2 / Moses 3 / Abraham 5 is the next, and
// a study can carry all six. Aligning every column against the leftmost is
// wrong there — Moses 3 has nothing to say to Genesis 1, and forcing them into
// shared rows scatters both accounts.
//
// So the columns are grouped first, and each group is aligned on its own. The
// measurements this threshold is set from, over the real text: chapters of the
// SAME account score 0.81 to 1.00, chapters of DIFFERENT accounts score 0.00 to
// 0.12. There is nothing in between, which is why a flat cut works and why it
// sits in the middle of an empty range rather than next to real data.
export const GROUP_FLOOR = 0.5;

// Matched verses as a fraction of the shorter chapter. Using the shorter one
// means a chapter fully quoted inside a longer one still reads as a match.
export function correspondence(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  let hits = 0;
  alignSequences(a, b).forEach((m) => {
    if (m !== null) hits++;
  });
  return hits / Math.min(a.length, b.length);
}

// Group columns that tell the same account. Returns groups of column indexes:
// groups ordered by their earliest member, members in their original order, so
// re-ordering a board by these groups never shuffles anything more than it must.
export function groupByCorrespondence(columns: string[][]): number[][] {
  const n = columns.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) {
      const next = parent[x];
      parent[x] = r;
      x = next;
    }
    return r;
  };
  // Union toward the SMALLER index, so a group's root is its earliest member.
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (correspondence(columns[i], columns[j]) >= GROUP_FLOOR) union(i, j);

  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const at = byRoot.get(r);
    if (at) at.push(i);
    else byRoot.set(r, [i]);
  }
  return Array.from(byRoot.values()).sort((x, y) => x[0] - y[0]);
}
