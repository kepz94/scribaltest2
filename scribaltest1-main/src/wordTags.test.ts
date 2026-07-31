// Word tags had no test coverage at all. The sense selection makes a tag
// EDITABLE for the first time, and the old merge kept the local copy of any id
// it already held — so a choice made on one device could never reach the other.
// These cover the parser and that merge.

import { parseSenses, sensesFor, carriedSenses } from "./webster";
import { mergeTagState, TagStore } from "./hooks/useWordTags";
import { WordTag } from "./types";
import { richToParagraphs, richToText, richToBlocks } from "./richText";

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

// Kepu, on the deploy: "My synthesis is laid out in italics the whole way
// through. Doesn't show my divider lines and it's just not how i want it to
// look. i want my synthesis to look like how it does on my actual study
// because i organized it in such a way for it to be read that way."
// Flattening to paragraphs was never enough — the shape is the argument.
describe("richToBlocks", () => {
  // Exactly what Lexical writes when the reader uses the toolbar.
  const NOTE =
    "<h1>Why the temple</h1>" +
    "<p><span>It is the </span><b><strong>zeal prophesied</strong></b><span> of him.</span></p>" +
    "<hr>" +
    "<h2>What follows</h2>" +
    '<ul><li value="1"><span>deliberate</span></li><li value="2"><span>his own house</span></li></ul>' +
    '<ol><li value="1"><span>He arrives</span></li><li value="2"><span>He drives them out</span></li></ol>' +
    "<blockquote><span>as it was written.</span></blockquote>" +
    '<span class="scribal-dchip" data-dictkey="zeal">Zeal — Passionate ardor.</span>' +
    '<p><span class="scribal-vchip scribal-vcard" data-ref="John 2:16">John 2:16 — Take these things hence.</span></p>' +
    "<p><span>not whether he was </span><i><em>angry</em></i><span>.</span></p>";

  const kinds = (h: string) => richToBlocks(h).map((b) => b.kind);

  it("keeps every block, in the order it was written", () => {
    expect(kinds(NOTE)).toEqual([
      "h1", "p", "rule", "h2",
      "li", "li", "li", "li",
      "quote", "def", "vcard", "p",
    ]);
  });

  it("keeps the divider — it has no text, and that is not the same as no content", () => {
    expect(richToBlocks("<p>a</p><hr><p>b</p>").map((b) => b.kind)).toEqual([
      "p", "rule", "p",
    ]);
  });

  it("numbers an ordered list instead of bulleting it", () => {
    const li = richToBlocks(NOTE).filter((b) => b.kind === "li");
    expect(li.map((b) => b.marker)).toEqual(["•", "•", "1.", "2."]);
  });

  it("carries bold and italic as runs, so emphasis survives", () => {
    const blocks = richToBlocks(NOTE);
    const para = blocks[1];
    expect(para.runs.some((r) => r.b && r.text.includes("zeal prophesied"))).toBe(true);
    const last = blocks[blocks.length - 1];
    expect(last.runs.some((r) => r.i && r.text.includes("angry"))).toBe(true);
  });

  it("treats a linked definition and a linked verse as cards, not phrases", () => {
    const blocks = richToBlocks(NOTE);
    expect(blocks.find((b) => b.kind === "def")!.runs[0].text).toContain("Passionate ardor");
    expect(blocks.find((b) => b.kind === "vcard")!.runs[0].text).toContain("John 2:16");
  });

  it("splits a paragraph around a card that interrupts it", () => {
    const k = kinds(
      '<p><span>before </span><span class="scribal-dchip">Zeal — ardor.</span><span> after</span></p>'
    );
    expect(k).toEqual(["p", "def", "p"]);
  });

  it("keeps a checklist's state as its marker", () => {
    const k = richToBlocks(
      '<ul __lexicallisttype="check">' +
        '<li role="checkbox" aria-checked="true" value="1"><span>done</span></li>' +
        '<li role="checkbox" aria-checked="false" value="2"><span>not done</span></li></ul>'
    );
    expect(k.map((b) => b.marker)).toEqual(["✓", "□"]);
  });

  it("nests a sub-list under its parent item, not before it", () => {
    const b = richToBlocks(
      "<ul><li><span>parent</span><ul><li><span>child</span></li></ul></li></ul>"
    );
    expect(b.map((x) => [x.runs[0].text, x.depth])).toEqual([
      ["parent", 0],
      ["child", 1],
    ]);
  });

  it("returns nothing for an empty note", () => {
    expect(richToBlocks("")).toEqual([]);
    expect(richToBlocks("<p></p>")).toEqual([]);
    expect(richToBlocks("<p><br></p>")).toEqual([]);
  });
});

// The synthesis box grew blank space between paragraphs on every reopen. The
// cause is below the app: parsing saved note HTML yields a node for the
// WHITESPACE between block tags, and the loader wrapped every non-element node
// in a fresh paragraph. Those blanks were saved, re-parsed and wrapped again, so
// the gaps compounded each time the note was opened.
describe("saved note HTML round trip", () => {
  const parseBody = (html: string) =>
    Array.from(
      new DOMParser().parseFromString(html, "text/html").body.childNodes
    );

  it("yields whitespace nodes between block tags — the source of the blank paragraphs", () => {
    const saved = "<p>one</p>\n<p>two</p>\n<p>three</p>";
    const kids = parseBody(saved);
    const blanks = kids.filter(
      (n) => n.nodeType === 3 && !(n.textContent || "").trim()
    );
    expect(blanks.length).toBeGreaterThan(0);
  });

  it("keeps exactly the real paragraphs once whitespace is ignored", () => {
    const saved = "<p>one</p>\n<p>two</p>\n<p>three</p>";
    const kept = parseBody(saved).filter((n) =>
      n.nodeType === 1 ? true : !!(n.textContent || "").trim()
    );
    expect(kept).toHaveLength(3);
    expect(kept.map((n) => n.textContent)).toEqual(["one", "two", "three"]);
  });

  it("still keeps a bare text node that has real content", () => {
    const kept = parseBody("hello<p>two</p>").filter((n) =>
      n.nodeType === 1 ? true : !!(n.textContent || "").trim()
    );
    expect(kept.map((n) => n.textContent)).toEqual(["hello", "two"]);
  });
});

// Most words have several senses and the reader picks. Plenty have exactly one —
// or none numbered at all, like `zeal`, whose entry is a single paragraph. Those
// offer nothing to choose, so the picker hides, and they were then excluded from
// every surface: no gloss under the verse, nothing offered to the note editor. A
// word with one meaning should carry that meaning.
describe("carriedSenses", () => {
  const multi = "GRACE, noun\n\n1. Favor.\n\n2. Unmerited love.";
  const single = "MERCHANDISE, noun\n\n1. The objects of commerce.";
  const unnumbered = "ZEAL, noun Passionate ardor in the pursuit of any thing.";

  it("carries exactly what was chosen when the reader chose", () => {
    expect(carriedSenses(multi, [2]).map((s) => s.n)).toEqual([2]);
  });

  it("carries the sole sense of a single-meaning word with no choice made", () => {
    const got = carriedSenses(single, undefined);
    expect(got).toHaveLength(1);
    expect(got[0].n).toBe(1);
  });

  it("carries an unnumbered entry's body, marked as having no number", () => {
    const got = carriedSenses(unnumbered, undefined);
    expect(got).toHaveLength(1);
    expect(got[0].n).toBe(0); // callers print it without a number
    expect(got[0].text).toContain("Passionate ardor");
  });

  it("carries nothing for a multi-sense word until the reader picks", () => {
    // Choosing is the point; guessing on the reader's behalf is not ours to do.
    expect(carriedSenses(multi, undefined)).toEqual([]);
    expect(carriedSenses(multi, [])).toEqual([]);
  });

  it("carries nothing when the entry is missing entirely", () => {
    expect(carriedSenses("", undefined)).toEqual([]);
  });
});

describe("carriedSenses on an unnumbered entry", () => {
  it("drops the entry's own headword, which the surfaces already print", () => {
    const got = carriedSenses("ZEAL, noun Passionate ardor in the pursuit of any thing.", undefined);
    expect(got[0].text).toBe("Passionate ardor in the pursuit of any thing.");
  });

  it("drops a multi-word headword and its part of speech", () => {
    const got = carriedSenses("CAST DOWN, verb transitive To deject; to depress the mind.", undefined);
    expect(got[0].text).toBe("To deject; to depress the mind.");
  });

  it("drops a leading etymology bracket too", () => {
    const got = carriedSenses(
      "ZEAL, noun [Gr., Latin ] Passionate ardor in the pursuit of any thing.",
      undefined
    );
    expect(got[0].text).toBe("Passionate ardor in the pursuit of any thing.");
  });

  it("keeps the text when stripping would leave nothing", () => {
    const got = carriedSenses("SELAH", undefined);
    expect(got[0].text).toBe("SELAH");
  });
});
