// Matching verses by their wording. The test that matters most is the last
// describe: without a mismatch penalty the aligner takes a pile of bad pairings
// over a couple of perfect ones, and Isaiah 52 matched nothing at all.
import {
  similarity,
  alignSequences,
  MATCH_FLOOR,
  GAP_PENALTY,
  MISS_PENALTY,
} from "./parallelMatch";

describe("how alike two verses are", () => {
  test("the same verse is a perfect match", () => {
    const v = "And God said, Let there be light: and there was light.";
    expect(similarity(v, v)).toBe(1);
  });

  test("Nephi's Isaiah against Isaiah is near-identical", () => {
    const nephi =
      "Awake, awake, put on thy strength, O Zion; put on thy beautiful " +
      "garments, O Jerusalem, the holy city;";
    const isaiah =
      "Awake, awake; put on thy strength, O Zion; put on thy beautiful " +
      "garments, O Jerusalem, the holy city:";
    expect(similarity(nephi, isaiah)).toBeGreaterThan(0.9);
  });

  test("two verses sharing only a proper noun are not a match", () => {
    const a = "And the Gods called the expanse, Heaven.";
    const b = "Awake, and put on thy strength, O Jerusalem.";
    expect(similarity(a, b)).toBeLessThan(MATCH_FLOOR);
  });

  test("nothing in common is zero", () => {
    expect(similarity("firmament waters divided", "awake strength garments")).toBe(0);
  });

  test("an empty verse is zero, not a crash or a NaN", () => {
    expect(similarity("", "anything at all here")).toBe(0);
    expect(similarity("", "")).toBe(0);
  });

  test("it is symmetric", () => {
    const a = "And God made the firmament, and divided the waters.";
    const b = "And I, God, made the firmament and divided the waters.";
    expect(similarity(a, b)).toBe(similarity(b, a));
  });

  test("stop words alone cannot carry a match", () => {
    // Both are almost entirely stop words; nothing of substance is shared.
    expect(similarity("and it was so", "and they were not")).toBe(0);
  });
});

describe("the penalties are ordered the way the aligner needs", () => {
  test("a miss costs more than a gap, so strangers are not forced together", () => {
    expect(MISS_PENALTY).toBeLessThan(GAP_PENALTY);
  });
  test("a gap costs something, so the aligner does not shred both columns", () => {
    expect(GAP_PENALTY).toBeLessThan(0);
  });
});

describe("lining two chapters up", () => {
  const A = [
    "In the beginning God created the heaven and the earth",
    "the earth was without form and void darkness upon the deep",
    "And God said Let there be light and there was light",
    "And God saw the light that it was good",
    "And God called the light Day and the darkness Night",
  ];

  test("a chapter against itself maps every verse to itself", () => {
    expect(alignSequences(A, A)).toEqual([0, 1, 2, 3, 4]);
  });

  test("a missing verse becomes a skip, not a shift", () => {
    const B = A.filter((_, i) => i !== 2);
    expect(alignSequences(A, B)).toEqual([0, 1, 3, 4]);
  });

  test("an extra verse in the middle matches nothing and shifts nothing", () => {
    const B = [A[0], A[1], "wholly unrelated speech about commerce", A[2], A[3], A[4]];
    expect(alignSequences(A, B)).toEqual([0, 1, null, 2, 3, 4]);
  });

  test("chapters with no shared wording produce no matches at all", () => {
    const B = ["commerce shipping tariffs", "harbour freight schedules"];
    expect(alignSequences(A, B)).toEqual([null, null]);
  });

  test("matches only ever run forwards", () => {
    // Monotonicity: a later verse of B can never match an earlier verse of A.
    // A crossed pair would render as two verses swapping rows, which is never
    // what a parallel reading means.
    const B = [A[0], A[2], A[4]];
    const map = alignSequences(A, B);
    const hits = map.filter((m): m is number => m !== null);
    for (let i = 1; i < hits.length; i++) expect(hits[i]).toBeGreaterThan(hits[i - 1]);
  });

  test("empty input is handled rather than thrown at", () => {
    expect(alignSequences([], [])).toEqual([]);
    expect(alignSequences(A, [])).toEqual([]);
    expect(alignSequences([], ["anything"])).toEqual([null]);
  });
});

describe("the partial overlap that motivated MISS_PENALTY", () => {
  // 2 Nephi 8 quotes Isaiah 51 and then keeps going into Isaiah 52:1-2. So a
  // column of Isaiah 52 against a column of 2 Nephi 8 has exactly TWO real
  // correspondences, both at the far end of Nephi's chapter, and thirteen
  // verses that match nothing.
  //
  // The naive scoring gives a non-matching diagonal a score of zero, which is
  // FREE — cheaper than a gap. So the aligner walked fifteen worthless pairings
  // rather than pay two gaps to reach two perfect ones, and Isaiah 52 aligned
  // to nothing. MISS_PENALTY is what makes a bad pairing cost more than a skip.
  const nephi = [
    "the cup of trembling the dregs of the cup of my fury",
    "But I will put it into the hand of them that afflict thee",
    "Awake awake put on thy strength O Zion thy beautiful garments Jerusalem",
    "Shake thyself from the dust arise sit down O Jerusalem loose thyself",
  ];
  const isaiah52 = [
    "Awake awake put on thy strength O Zion thy beautiful garments Jerusalem",
    "Shake thyself from the dust arise sit down O Jerusalem loose thyself",
    "For thus saith the LORD Ye have sold yourselves for nought",
    "For thus saith the Lord GOD My people went down aforetime into Egypt",
    "Now therefore what have I here saith the LORD that my people is taken",
  ];

  test("exactly the two real correspondences, and no others", () => {
    const map = alignSequences(nephi, isaiah52);
    expect(map[0]).toBe(2);
    expect(map[1]).toBe(3);
    expect(map.slice(2)).toEqual([null, null, null]);
  });

  test("the matches sit at the END of the reference, where they belong", () => {
    const map = alignSequences(nephi, isaiah52);
    const hits = map.filter((m): m is number => m !== null);
    expect(hits).toEqual([2, 3]);
    expect(hits.length).toBe(2);
  });
});
