// Word tags had no test coverage at all. The sense selection makes a tag
// EDITABLE for the first time, and the old merge kept the local copy of any id
// it already held — so a choice made on one device could never reach the other.
// These cover the parser and that merge.

import { parseSenses, sensesFor } from "./webster";
import { mergeTagState, TagStore } from "./hooks/useWordTags";
import { WordTag } from "./types";

describe("parseSenses", () => {
  const grace = [
    "GRACE, noun [Latin gratia, formed on the Celtic.]",
    "1. Favor; good will; kindness.",
    "Or each, or all, may win a lady's grace",
    "2. The free unmerited love and favor of God.",
    "And if by grace, then it is no more of works. Romans 11:6.",
    "3. Favorable influence of God.",
  ].join("\n\n");

  it("splits the header from the numbered senses", () => {
    const e = parseSenses(grace);
    expect(e.header).toBe("GRACE, noun [Latin gratia, formed on the Celtic.]");
    expect(e.senses.map((s) => s.n)).toEqual([1, 2, 3]);
  });

  it("attaches a quotation to the sense it illustrates, not the next one", () => {
    const e = parseSenses(grace);
    expect(e.senses[0].text).toContain("may win a lady's grace");
    expect(e.senses[1].text).toContain("Romans 11:6");
    expect(e.senses[1].text).not.toContain("lady's grace");
    expect(e.senses[2].text).not.toContain("Romans 11:6");
  });

  it("handles an entry with no numbered senses at all", () => {
    const e = parseSenses("ABASH, verb transitive To make ashamed.");
    expect(e.senses).toEqual([]);
    expect(e.header).toContain("To make ashamed");
  });

  it("keeps the dictionary's own numbering when it is not 1..n", () => {
    // Some entries restart or skip; the number printed is what the reader sees,
    // so a selection has to key off it rather than array position.
    const e = parseSenses("WORD, noun\n\n1. A single component.\n\n3. A promise.");
    expect(e.senses.map((s) => s.n)).toEqual([1, 3]);
  });

  it("survives empty input", () => {
    expect(parseSenses("")).toEqual({ header: "", senses: [] });
  });

  describe("sensesFor", () => {
    it("returns the chosen senses in dictionary order regardless of pick order", () => {
      const picked = sensesFor(grace, [3, 1]);
      expect(picked.map((s) => s.n)).toEqual([1, 3]);
    });

    it("returns nothing when the reader never chose, so callers keep their default", () => {
      expect(sensesFor(grace, undefined)).toEqual([]);
      expect(sensesFor(grace, [])).toEqual([]);
    });

    it("ignores a sense number the entry doesn't have", () => {
      expect(sensesFor(grace, [2, 99]).map((s) => s.n)).toEqual([2]);
    });
  });
});

describe("mergeTagState", () => {
  const tag = (over: Partial<WordTag> = {}): WordTag => ({
    id: "Alma 32:21:8:13",
    reference: "Alma 32:21",
    start: 8,
    end: 13,
    word: "faith",
    dictKey: "faith",
    ...over,
  });
  const store = (tags: WordTag[], tombs: Record<string, number> = {}): TagStore => ({
    tags,
    tombs,
  });

  it("adds a tag the local device has never seen", () => {
    const out = mergeTagState(store([]), [tag()], {});
    expect(out.tags).toHaveLength(1);
    expect(out.tags[0].word).toBe("faith");
  });

  it("carries a remote sense choice onto a tag we already hold", () => {
    // The case that was broken: same id both sides, remote has chosen.
    const mine = tag();
    const theirs = tag({ senses: [2, 4], updatedAt: 5000 });
    const out = mergeTagState(store([mine]), [theirs], {});
    expect(out.tags[0].senses).toEqual([2, 4]);
    expect(out.tags[0].updatedAt).toBe(5000);
  });

  it("keeps the newer choice when both devices have chosen", () => {
    const mine = tag({ senses: [1], updatedAt: 9000 });
    const theirs = tag({ senses: [2, 4], updatedAt: 5000 });
    const out = mergeTagState(store([mine]), [theirs], {});
    expect(out.tags[0].senses).toEqual([1]);
    expect(out.tags[0].updatedAt).toBe(9000);
  });

  it("lets a device that has chosen beat a legacy tag with no stamp", () => {
    const legacy = tag(); // no senses, no updatedAt
    const chosen = tag({ senses: [3], updatedAt: 1 });
    const out = mergeTagState(store([legacy]), [chosen], {});
    expect(out.tags[0].senses).toEqual([3]);
  });

  it("never lets a legacy tag wipe a local choice", () => {
    const chosen = tag({ senses: [3], updatedAt: 1 });
    const legacy = tag();
    const out = mergeTagState(store([chosen]), [legacy], {});
    expect(out.tags[0].senses).toEqual([3]);
  });

  it("keeps a deletion winning over a stale remote add", () => {
    const t = tag();
    const out = mergeTagState(store([], { [t.id]: Date.now() }), [t], {});
    expect(out.tags).toHaveLength(0);
  });

  it("keeps the newest deletion per id", () => {
    // Within the 90-day tombstone TTL — older stamps are garbage-collected.
    const t = tag();
    const older = Date.now() - 1000 * 60 * 60;
    const newer = Date.now() - 1000 * 60;
    const out = mergeTagState(store([t], { [t.id]: older }), [], {
      [t.id]: newer,
    });
    expect(out.tombs[t.id]).toBe(newer);
  });

  it("garbage-collects a deletion older than the tombstone window", () => {
    const t = tag();
    const ancient = Date.now() - 1000 * 60 * 60 * 24 * 120; // 120 days
    const out = mergeTagState(store([]), [t], { [t.id]: ancient });
    expect(out.tombs[t.id]).toBeUndefined();
    // …and with the tombstone expired, the tag comes back on the next sync.
    expect(out.tags).toHaveLength(1);
  });

  it("returns the very same object when nothing changed", () => {
    // Two devices must not ping-pong writes at each other.
    const prev = store([tag({ senses: [2], updatedAt: 400 })]);
    const out = mergeTagState(prev, [tag({ senses: [2], updatedAt: 400 })], {});
    expect(out).toBe(prev);
  });

  it("leaves other tags untouched while reconciling one", () => {
    const a = tag();
    const b = tag({ id: "Alma 32:27:4:9", reference: "Alma 32:27", word: "awake" });
    const out = mergeTagState(
      store([a, b]),
      [tag({ senses: [2], updatedAt: 7 })],
      {}
    );
    expect(out.tags.find((t) => t.id === a.id)!.senses).toEqual([2]);
    expect(out.tags.find((t) => t.id === b.id)).toBe(b);
  });
});
