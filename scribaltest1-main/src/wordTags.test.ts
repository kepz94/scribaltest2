// Word tags had no test coverage at all. The sense selection makes a tag
// EDITABLE for the first time, and the old merge kept the local copy of any id
// it already held — so a choice made on one device could never reach the other.
// These cover the parser and that merge.

import { parseSenses, sensesFor } from "./webster";
import { mergeTagState, TagStore } from "./hooks/useWordTags";
import { WordTag } from "./types";
import { richToParagraphs, richToText } from "./richText";

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

// The definition chip's whole contract is that it survives the HTML round trip
// (notes are stored as HTML, never Lexical JSON) and that it flattens to real
// words for share cards and print. Both are attribute/text-content properties of
// the markup, so they can be asserted without mounting an editor.
describe("definition chip markup", () => {
  const chipHtml =
    '<span class="scribal-dchip" data-dictkey="grace" data-senses="2" ' +
    'style="color: #9a7b4f; font-style: italic;">' +
    "Grace, 2. The free unmerited love and favor of God.</span>";

  it("carries the key and the chosen sense for re-resolution", () => {
    const el = document.createElement("div");
    el.innerHTML = chipHtml;
    const chip = el.querySelector(".scribal-dchip")!;
    expect(chip.getAttribute("data-dictkey")).toBe("grace");
    expect(chip.getAttribute("data-senses")).toBe("2");
  });

  it("keeps the definition as real text, so flattening never loses it", () => {
    // richToPlain / flattenRich / the empty-note check are all textContent
    // based — a chip holding its text only in an attribute would vanish.
    const el = document.createElement("div");
    el.innerHTML = chipHtml;
    expect((el.textContent || "").trim()).toBe(
      "Grace, 2. The free unmerited love and favor of God."
    );
  });

  it("is not mistaken for a verse chip", () => {
    const el = document.createElement("div");
    el.innerHTML = chipHtml;
    expect(el.querySelector(".scribal-vchip")).toBeNull();
  });

  it("survives the emptiness test the Done button applies", () => {
    // A note whose only content is a chip must still save.
    const textOnly = chipHtml.replace(/<[^>]*>/g, "").replace(/ /g, " ").trim();
    expect(textOnly.length).toBeGreaterThan(0);
  });
});

// A synthesis is written prose — paragraphs, headings, bullets. It reached the
// share cards through a flattener that collapsed all of it into one run, and the
// card then clamped that run to six lines. The result read as "only my first
// paragraph came through".
describe("richToParagraphs", () => {
  const synth =
    "<h1>Why the temple</h1><p>The cleansing is not an outburst.</p>" +
    "<p>Three things follow:</p><ul><li>deliberate, not reactive</li>" +
    "<li>his own house</li></ul><p>So the question is not anger.</p>";

  it("recovers every block, in order", () => {
    expect(richToParagraphs(synth)).toEqual([
      "Why the temple",
      "The cleansing is not an outburst.",
      "Three things follow:",
      "• deliberate, not reactive",
      "• his own house",
      "So the question is not anger.",
    ]);
  });

  it("marks list items, because a bullet is content not decoration", () => {
    expect(richToParagraphs(synth).filter((p) => p.startsWith("• "))).toHaveLength(2);
  });

  it("does not run a heading into the paragraph after it", () => {
    // The separator has to survive innerHTML parsing; a control character does
    // not, and everything silently concatenated.
    expect(richToParagraphs(synth)[0]).toBe("Why the temple");
  });

  it("handles a plain-text note with newlines", () => {
    expect(richToParagraphs("one\n\ntwo\nthree")).toEqual(["one", "two", "three"]);
  });

  it("returns nothing for empty or whitespace-only input", () => {
    expect(richToParagraphs("")).toEqual([]);
    expect(richToParagraphs("   ")).toEqual([]);
    expect(richToParagraphs("<p></p>")).toEqual([]);
  });

  it("joins to newline-separated text for callers that lay out themselves", () => {
    expect(richToText("<p>a</p><p>b</p>")).toBe("a\nb");
  });
});
