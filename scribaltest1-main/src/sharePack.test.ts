// The share-card fit rule: how many verses land on one card, and what a study
// looks like once it outgrows one. Heights are injected rather than measured —
// jsdom has no canvas, so the real renderer could only ever report the minimum.

import { packPages, pdfProseSize } from "./SharePreview";
import { CARD_TARGET_H, MAX_PER_CARD, VersesCardEntry } from "./shareCard";
import { buildStudySummary } from "./studySummary";
import { Mark, MarkColor, MarkStyle } from "./types";

const verse = (n: number): VersesCardEntry => ({
  reference: "Alma 32:" + n,
  theme: "Faith",
  color: 5,
  phrases: [{ text: "phrase " + n, style: "highlight" }],
});

// A card whose height is the sum of its verses — one knob per test.
const perVerse = (h: number) => (vs: VersesCardEntry[]) => vs.length * h;

const shape = (pages: VersesCardEntry[][]) => pages.map((p) => p.length);
const refsOf = (pages: VersesCardEntry[][]) =>
  pages.map((p) => p.map((v) => v.reference));

describe("packPages", () => {
  const list = (n: number) => Array.from({ length: n }, (_, i) => verse(i + 1));

  it("keeps a single card when everything fits", () => {
    // 3 x 400 = 1200, under the 1500 target.
    expect(shape(packPages(list(3), false, perVerse(400)))).toEqual([3]);
  });

  it("splits once the card would outgrow the target", () => {
    // 500 each: 3 fit exactly (1500), a 4th would not.
    expect(shape(packPages(list(4), false, perVerse(500)))).toEqual([1, 3]);
  });

  it("packs backwards so the short page is first, not orphaned last", () => {
    // Forward-greedy would give [3, 1] — a lone verse on the final page.
    const pages = packPages(list(4), false, perVerse(500));
    expect(refsOf(pages)).toEqual([
      ["Alma 32:1"],
      ["Alma 32:2", "Alma 32:3", "Alma 32:4"],
    ]);
  });

  it("holds the verses in their original order across pages", () => {
    const pages = packPages(list(7), false, perVerse(500));
    expect(pages.flat().map((v) => v.reference)).toEqual(
      list(7).map((v) => v.reference)
    );
  });

  it("caps at MAX_PER_CARD even when the verses are tiny", () => {
    // 10px each never reaches the height target, so only the count stops it.
    const pages = packPages(list(13), false, perVerse(10));
    expect(shape(pages)).toEqual([1, MAX_PER_CARD, MAX_PER_CARD]);
  });

  it("gives a verse too tall for any card its own page", () => {
    const pages = packPages(list(2), false, perVerse(CARD_TARGET_H + 100));
    expect(shape(pages)).toEqual([1, 1]);
  });

  it("returns no pages for no verses", () => {
    expect(packPages([], false, perVerse(400))).toEqual([]);
  });

  it("never exceeds the target unless the page holds a single verse", () => {
    const pages = packPages(list(9), false, perVerse(600));
    pages.forEach((p) => {
      if (p.length > 1) expect(perVerse(600)(p)).toBeLessThanOrEqual(CARD_TARGET_H);
    });
  });
});

describe("pdfProseSize", () => {
  const list = (n: number) => Array.from({ length: n }, (_, i) => verse(i + 1));

  it("holds the whole document to the smallest size any page needed", () => {
    // Page sizes 44, 32, 40 -> every page must be set at 32.
    const sizes = [44, 32, 40];
    const pages = [list(2), list(3), list(1)];
    const size = pdfProseSize(pages, (p) => sizes[pages.indexOf(p)]);
    expect(size).toBe(32);
  });

  it("is undefined when there are no pages", () => {
    expect(pdfProseSize([], () => 40)).toBeUndefined();
  });

  it("returns the single page's own size when there is only one", () => {
    expect(pdfProseSize([list(3)], () => 38)).toBe(38);
  });
});

describe("buildStudySummary", () => {
  const mark = (
    reference: string,
    color: MarkColor,
    style: MarkStyle = "highlight",
    markedText = "a marked phrase"
  ): Mark => ({
    id: reference + "|" + color + "|" + style,
    reference,
    verseText: "verse text",
    markedText,
    startIndex: 0,
    endIndex: 5,
    style,
    color,
    timestamp: 0,
  });
  // Scripture order: whatever sequence the refs were handed in.
  const orderBy = (refs: string[]) => (r: string) => refs.indexOf(r);
  const base = {
    colorLabels: { 5: "Faith is a choice", 4: "The seed" } as Record<
      number,
      string
    >,
    title: "Faith & the seed",
    now: new Date("2026-07-30T12:00:00Z"),
  };

  it("names a single chapter by its reference", () => {
    const marks = [mark("Alma 32:21", 5), mark("Alma 32:27", 5)];
    const s = buildStudySummary({
      ...base,
      marks,
      orderOf: orderBy(marks.map((m) => m.reference)),
    });
    expect(s.scopeTitle).toBe("Alma 32");
    expect(s.passages).toBe(1);
    expect(s.totalMarks).toBe(2);
  });

  it("spans a chapter range within one book", () => {
    const marks = [mark("Alma 30:1", 5), mark("Alma 32:21", 5)];
    const s = buildStudySummary({
      ...base,
      marks,
      orderOf: orderBy(marks.map((m) => m.reference)),
    });
    expect(s.scopeTitle).toBe("Alma 30–32");
    expect(s.passages).toBe(2);
  });

  it("lists two or three books by name", () => {
    const marks = [mark("Alma 32:21", 5), mark("Moroni 7:1", 4)];
    const s = buildStudySummary({
      ...base,
      marks,
      orderOf: orderBy(marks.map((m) => m.reference)),
    });
    expect(s.scopeTitle).toBe("Alma · Moroni");
  });

  it("abbreviates more than three books to first – last", () => {
    const marks = [
      mark("Alma 32:21", 5),
      mark("Helaman 5:12", 5),
      mark("Moroni 7:1", 4),
      mark("Ether 12:6", 4),
    ];
    const s = buildStudySummary({
      ...base,
      marks,
      orderOf: orderBy(marks.map((m) => m.reference)),
    });
    expect(s.scopeTitle).toBe("Alma – Ether");
  });

  it("orders themes by mark count and hangs the synthesis on the largest", () => {
    const marks = [
      mark("Alma 32:21", 4),
      mark("Alma 32:27", 5),
      mark("Alma 32:28", 5),
    ];
    const s = buildStudySummary({
      ...base,
      marks,
      orderOf: orderBy(marks.map((m) => m.reference)),
      synthesis: "  Faith is an act.  ",
    });
    expect(s.themes.map((t) => [t.name, t.count])).toEqual([
      ["Faith is a choice", 2],
      ["The seed", 1],
    ]);
    expect(s.themes[0].synthesis).toBe("Faith is an act.");
    expect(s.themes[1].synthesis).toBe("");
  });

  it("features the most emphasized mark by default", () => {
    // bold (5 points) outranks highlight (1), whatever the reading order.
    const marks = [
      mark("Alma 32:21", 5, "highlight"),
      mark("Alma 32:27", 5, "bold"),
      mark("Alma 32:28", 5, "underline"),
    ];
    const s = buildStudySummary({
      ...base,
      marks,
      orderOf: orderBy(marks.map((m) => m.reference)),
    });
    expect(s.candidates[s.defaultFeatured].reference).toBe("Alma 32:27");
  });

  it("skips unmarked-text marks as featured candidates", () => {
    const marks = [
      mark("Alma 32:21", 5, "bold", "   "),
      mark("Alma 32:27", 5, "highlight"),
    ];
    const s = buildStudySummary({
      ...base,
      marks,
      orderOf: orderBy(marks.map((m) => m.reference)),
    });
    expect(s.candidates).toHaveLength(1);
    expect(s.candidates[0].reference).toBe("Alma 32:27");
    // The card still reports every mark it was built from.
    expect(s.totalMarks).toBe(2);
  });
});
