// Text pasted from another site brings that site's body colour with it as an
// inline style. On the light reader it looks fine; in dark mode it is black
// words on a black card. These are the rules that decide which colours are
// someone's decision and which are just "whatever the source document used".

import {
  isThemelessColor,
  stripThemelessColors,
  richToHtml,
} from "./cardText";

describe("isThemelessColor", () => {
  it("catches the exact colour that broke Kepu's cards", () => {
    // rgb(32, 21, 0) — the body colour that came along with a paste from
    // another notes site.
    expect(isThemelessColor("rgb(32, 21, 0)")).toBe(true);
  });

  it("catches black and white however they are written", () => {
    ["black", "#000", "#000000", "rgb(0,0,0)", "rgba(0, 0, 0, 1)"].forEach((c) =>
      expect(isThemelessColor(c)).toBe(true)
    );
    ["white", "#fff", "#FFFFFF", "rgb(255, 255, 255)"].forEach((c) =>
      expect(isThemelessColor(c)).toBe(true)
    );
  });

  it("keeps every pen in the palette", () => {
    // The whole point: a colour someone chose is a decision and survives.
    // pen1 (#d11a2a) is the darkest and sits nearest the threshold at 0.26.
    [
      "#d11a2a",
      "#e07b1a",
      "#c9a200",
      "#2f8f3e",
      "#2f6fb0",
      "#7b4fbf",
      "#d6448c",
      "#5fa515",
      "#0e9aab",
    ].forEach((c) => expect(isThemelessColor(c)).toBe(false));
  });

  it("keeps the mid-tone colour from the same paste", () => {
    // rgb(229, 158, 37) sat in the same card and IS a deliberate highlight.
    expect(isThemelessColor("rgb(229, 158, 37)")).toBe(false);
  });

  it("leaves colours it cannot parse alone", () => {
    // Unknown names and functions are not guessed at — better to keep a
    // colour we don't understand than to strip something meaningful.
    expect(isThemelessColor("rebeccapurple")).toBe(false);
    expect(isThemelessColor("var(--pen3)")).toBe(false);
    expect(isThemelessColor("")).toBe(false);
  });
});

describe("stripThemelessColors", () => {
  it("removes the colour but keeps the rest of the declaration", () => {
    const html =
      '<span style="color: rgb(32, 21, 0); white-space: pre-wrap;">The Lord revealed</span>';
    const out = stripThemelessColors(html);
    expect(out).not.toContain("color: rgb(32, 21, 0)");
    expect(out).toContain("white-space: pre-wrap");
    expect(out).toContain("The Lord revealed");
  });

  it("drops the style attribute entirely when nothing survives", () => {
    expect(stripThemelessColors('<span style="color: #000;">x</span>')).toBe(
      "<span >x</span>"
    );
  });

  it("keeps a chosen colour untouched", () => {
    const html = '<span style="color: rgb(229, 158, 37);">second coming.</span>';
    expect(stripThemelessColors(html)).toContain("color: rgb(229, 158, 37)");
  });

  it("drops a background only when it is effectively white or black", () => {
    // A white highlight is not a highlight; a black one hides the words.
    expect(
      stripThemelessColors('<span style="background-color: #ffffff;">x</span>')
    ).not.toContain("background-color");
    expect(
      stripThemelessColors('<span style="background-color: #000;">x</span>')
    ).not.toContain("background-color");
  });

  it("keeps every highlight wash — they are pale on purpose", () => {
    // The bug this pins: the text threshold (0.92) cut into the highlight
    // palette, which runs up to 0.94, and threw away real highlights.
    [
      "#ffd6d6",
      "#ffe2c2",
      "#fbedb0",
      "#d3f0d6",
      "#cfe2f7",
      "#e6d9f7",
      "#e0e0e0",
      "#fcd9ea",
      "#e8f5c4",
      "#c9f0f5",
    ].forEach((hl) =>
      expect(
        stripThemelessColors('<span style="background-color: ' + hl + ';">x</span>')
      ).toContain("background-color: " + hl)
    );
  });

  it("still judges TEXT by the stricter cut", () => {
    // A highlight wash as ink would be unreadable on paper.
    expect(isThemelessColor("#fbedb0")).toBe(true);
    expect(isThemelessColor("#fbedb0", "background")).toBe(false);
  });

  it("does not confuse background-color with color", () => {
    const html =
      '<span style="color: rgb(32,21,0); background-color: #cfe2f7;">x</span>';
    const out = stripThemelessColors(html);
    expect(out).not.toContain("color: rgb(32,21,0)");
    expect(out).toContain("background-color: #cfe2f7");
  });

  it("handles a whole pasted card", () => {
    const html =
      '<p><b><strong class="rt-bold" style="white-space: pre-wrap;">Spencer W. Kimball</strong></b></p>' +
      '<p><u><span class="rt-underline" style="color: rgb(32, 21, 0); white-space: pre-wrap;">The Fruit of Our Welfare Services Labors 1978</span></u>' +
      '<span style="color: rgb(229, 158, 37); white-space: pre-wrap;">second coming.</span></p>';
    const out = stripThemelessColors(html);
    expect(out).not.toContain("rgb(32, 21, 0)");
    expect(out).toContain("rgb(229, 158, 37)");
    // Structure and classes are untouched — only colour declarations go.
    expect(out).toContain('class="rt-bold"');
    expect(out).toContain('class="rt-underline"');
    expect(out).toContain("Spencer W. Kimball");
  });

  it("leaves html with no styles exactly as it was", () => {
    const html = "<p><strong>Plain</strong> words</p>";
    expect(stripThemelessColors(html)).toBe(html);
  });
});

describe("richToHtml", () => {
  it("strips themeless colour on the way to the screen", () => {
    // One display path for every surface — card, Present, Present Rooms — so
    // fixing it here fixes all of them, and the stored value is never touched.
    const out = richToHtml('<p><span style="color: rgb(32, 21, 0);">Hi</span></p>');
    expect(out).not.toContain("rgb(32, 21, 0)");
    expect(out).toContain("Hi");
  });

  it("still escapes legacy plain text rather than parsing it", () => {
    // The SCR-63 rule this must not break.
    expect(richToHtml("an <angle> example")).toBe(
      "an &lt;angle&gt; example"
    );
  });
});
