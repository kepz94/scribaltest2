// The Link verse picker offers exactly what the study's reading panel shows.
// The bug this pins (Kepu, Aug 7 2026): a keyword study's Unmarked group
// carried every verse of every chapter a gathered verse had ever come from —
// "that filters out the noise" is the spec, verbatim.
import { linkableVersesFor, LinkableEntry } from "./linkableDefinitions";

const POINTS: Record<string, number> = { bold: 5, underline: 3, highlight: 1 };

// Two chapters' worth of entries, the way desktop builds them (every verse of
// every chapter the study spans).
const chapterEntries: LinkableEntry[] = [
  { reference: "Luke 19:1", text: "v1" },
  { reference: "Luke 19:2", text: "v2" },
  { reference: "Luke 19:3", text: "v3" },
  { reference: "John 2:13", text: "v13" },
  { reference: "John 2:14", text: "v14" },
  { reference: "John 2:15", text: "v15" },
];

const mark = (reference: string, color: number, style = "bold") => ({
  reference,
  color,
  style,
});

const labelFor = (c: number) => (c === 1 ? "Cleansing" : "");

describe("the keyword-study filter", () => {
  // The study gathered three verses; one is marked. The panel shows three
  // verses, so the picker offers three — not six.
  const panel = ["Luke 19:2", "John 2:14", "John 2:15"];
  const marks = [mark("John 2:14", 1)];

  test("only the panel's verses are offered", () => {
    const out = linkableVersesFor(chapterEntries, marks, POINTS, labelFor, panel);
    expect(out.map((v) => v.reference)).toEqual(panel.slice().sort(
      (a, b) =>
        chapterEntries.findIndex((e) => e.reference === a) -
        chapterEntries.findIndex((e) => e.reference === b)
    ));
  });

  test("Unmarked is the panel's unmarked verses, nothing from the rest of the chapters", () => {
    const out = linkableVersesFor(chapterEntries, marks, POINTS, labelFor, panel);
    const unmarked = out.filter((v) => v.themeName === "Unmarked");
    expect(unmarked.map((v) => v.reference).sort()).toEqual(
      ["John 2:15", "Luke 19:2"]
    );
    // The five chapter verses the study never gathered do not appear at all.
    expect(out.some((v) => v.reference === "Luke 19:1")).toBe(false);
    expect(out.some((v) => v.reference === "John 2:13")).toBe(false);
  });

  test("marked panel verses still group under their theme", () => {
    const out = linkableVersesFor(chapterEntries, marks, POINTS, labelFor, panel);
    const hit = out.find((v) => v.reference === "John 2:14")!;
    expect(hit.color).toBe(1);
    expect(hit.themeName).toBe("Cleansing");
  });
});

describe("a chapter study passes no panel and keeps every verse", () => {
  test("all entries offered, unmarked ones as Unmarked", () => {
    const out = linkableVersesFor(
      chapterEntries,
      [mark("Luke 19:1", 1)],
      POINTS,
      labelFor,
      undefined
    );
    expect(out).toHaveLength(chapterEntries.length);
    expect(out.filter((v) => v.themeName === "Unmarked")).toHaveLength(5);
  });
});

describe("theme assignment", () => {
  test("the heaviest color wins, by style points", () => {
    const out = linkableVersesFor(
      [{ reference: "Luke 19:1", text: "v1" }],
      [
        mark("Luke 19:1", 2, "highlight"), // 1 point
        mark("Luke 19:1", 2, "highlight"), // 2 total
        mark("Luke 19:1", 1, "underline"), // 3 — wins
      ],
      POINTS,
      labelFor,
      null
    );
    expect(out[0].color).toBe(1);
  });

  test("an unnamed color falls back to its number, not to Unmarked", () => {
    const out = linkableVersesFor(
      [{ reference: "Luke 19:1", text: "v1" }],
      [mark("Luke 19:1", 7)],
      POINTS,
      labelFor,
      null
    );
    expect(out[0].themeName).toBe("Color 7");
  });

  test("marks with unknown styles carry no weight and leave a verse Unmarked", () => {
    const out = linkableVersesFor(
      [{ reference: "Luke 19:1", text: "v1" }],
      [mark("Luke 19:1", 1, "mystery")],
      POINTS,
      labelFor,
      null
    );
    expect(out[0].color).toBeNull();
    expect(out[0].themeName).toBe("Unmarked");
  });
});
