// The matcher against the real text, not a fixture.
//
// MATCH_FLOOR is an empirical constant. A unit test with hand-written verses
// proves the algorithm is sound; only the actual scriptures prove the constant
// is set anywhere near right. These seven pairs are the ones the feature was
// designed against, and the counts below were measured during planning.
//
// If one of these numbers moves, the constant moved with it — treat that as a
// regression in the matcher, not as a new baseline to write down.
import { alignSequences, groupByCorrespondence } from "./parallelMatch";

type Verse = { verse: number; text: string };

const chapters = (() => {
  // Required lazily and once: the file is 16 MB and only this suite wants it.
  const data = require("./data/scriptures.json");
  const out: Record<string, string[]> = {};
  (data.volumes || []).forEach((vol: any) => {
    (vol.books || []).forEach((book: any) => {
      (book.chapters || []).forEach((ch: any) => {
        out[book.book + " " + ch.chapter] = (ch.verses || []).map(
          (v: Verse) => v.text
        );
      });
    });
  });
  return out;
})();

const matchCount = (refName: string, colName: string): number => {
  const ref = chapters[refName];
  const col = chapters[colName];
  if (!ref || !col) throw new Error("missing chapter: " + refName + " / " + colName);
  return alignSequences(ref, col).filter((m) => m !== null).length;
};

describe("Nephi quoting Isaiah — near word-for-word, so near-perfect", () => {
  test("Isaiah 51 against 2 Nephi 8 matches all 23", () => {
    expect(matchCount("2 Nephi 8", "Isaiah 51")).toBe(23);
  });

  test("Isaiah 50 against 2 Nephi 7 matches all 11", () => {
    expect(matchCount("2 Nephi 7", "Isaiah 50")).toBe(11);
  });

  test("Isaiah 52 against 2 Nephi 8 matches exactly the 2 verses that belong", () => {
    // 2 Nephi 8 runs past Isaiah 51 into Isaiah 52:1-2 and stops. The other 13
    // verses of Isaiah 52 have no counterpart and must stay unmatched — this is
    // the case that fails outright without MISS_PENALTY.
    const map = alignSequences(chapters["2 Nephi 8"], chapters["Isaiah 52"]);
    expect(map.filter((m) => m !== null).length).toBe(2);
    expect(map[0]).toBe(23); // Isaiah 52:1 -> 2 Nephi 8:24
    expect(map[1]).toBe(24); // Isaiah 52:2 -> 2 Nephi 8:25
    expect(map.slice(2).every((m) => m === null)).toBe(true);
  });
});

describe("the creation accounts — same events, different words, so looser", () => {
  test("Moses 2 against Genesis 1 matches 30 of 31", () => {
    expect(matchCount("Genesis 1", "Moses 2")).toBe(30);
  });

  test("Abraham 4 against Genesis 1 matches 29 of 31", () => {
    expect(matchCount("Genesis 1", "Abraham 4")).toBe(29);
  });

  test("Moses 3 against Genesis 2 matches all 25", () => {
    expect(matchCount("Genesis 2", "Moses 3")).toBe(25);
  });

  test("Abraham 5 against Genesis 2 matches 17 of 21", () => {
    // The loosest of the seven. Four verses are left for the reader to pair by
    // hand, which is why the suggestion is a button and not an automatic act.
    expect(matchCount("Genesis 2", "Abraham 5")).toBe(17);
  });
});

describe("unrelated chapters are not forced together", () => {
  test("Genesis 1 against Isaiah 52 finds little or nothing", () => {
    // A guard on the floor from the other side: if this ever starts matching
    // freely, MATCH_FLOOR has drifted too low and every board will look aligned
    // when it is not.
    expect(matchCount("Genesis 1", "Isaiah 52")).toBeLessThanOrEqual(1);
  });
});

describe("a study holding both creation accounts at once", () => {
  // The board Kepu actually built: Genesis 1 and 2, Moses 2 and 3, Abraham 4
  // and 5. Six columns, two accounts. Aligning everything against the leftmost
  // column would try to match Moses 3 to Genesis 1, which share nothing.
  const NAMES = [
    "Genesis 1", "Genesis 2", "Moses 2", "Moses 3", "Abraham 4", "Abraham 5",
  ];
  const cols = NAMES.map((n) => chapters[n]);

  test("splits into the two accounts, not six strangers or one blob", () => {
    const groups = groupByCorrespondence(cols).map((g) => g.map((i) => NAMES[i]));
    expect(groups).toEqual([
      ["Genesis 1", "Moses 2", "Abraham 4"],
      ["Genesis 2", "Moses 3", "Abraham 5"],
    ]);
  });

  test("the accounts are separated by a wide margin, not a hair", () => {
    // Same account 0.81-1.00, different account 0.00-0.12 — the threshold sits
    // in an empty range. If this margin ever narrows, GROUP_FLOOR needs looking
    // at before the grouping starts guessing.
    const { correspondence } = require("./parallelMatch");
    const same = [
      correspondence(chapters["Genesis 1"], chapters["Moses 2"]),
      correspondence(chapters["Genesis 1"], chapters["Abraham 4"]),
      correspondence(chapters["Genesis 2"], chapters["Moses 3"]),
      correspondence(chapters["Genesis 2"], chapters["Abraham 5"]),
    ];
    const different = [
      correspondence(chapters["Genesis 1"], chapters["Genesis 2"]),
      correspondence(chapters["Genesis 1"], chapters["Moses 3"]),
      correspondence(chapters["Moses 2"], chapters["Abraham 5"]),
      correspondence(chapters["Abraham 4"], chapters["Abraham 5"]),
    ];
    expect(Math.min(...same)).toBeGreaterThan(0.8);
    expect(Math.max(...different)).toBeLessThan(0.2);
  });

  test("Nephi and Isaiah group the same way", () => {
    const names = ["2 Nephi 7", "Isaiah 50", "2 Nephi 8", "Isaiah 51"];
    const groups = groupByCorrespondence(names.map((n) => chapters[n])).map((g) =>
      g.map((i) => names[i])
    );
    expect(groups).toEqual([
      ["2 Nephi 7", "Isaiah 50"],
      ["2 Nephi 8", "Isaiah 51"],
    ]);
  });
});
