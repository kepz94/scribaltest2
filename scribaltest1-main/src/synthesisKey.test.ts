import {
  resolveSynthesisKey,
  synthesisKeyFor,
  chaptersOfKey,
} from "./synthesisKey";

// Kepu's case: a study over three chapters, marks in only one of them, the
// synthesis written on desktop. Mobile has to land on that same note.
const DESKTOP_KEY = "synthesis|Luke 19+John 2+Psalms 69";
const FULL = "<h1>Christ Cleansing The Temple</h1><p>In those days…</p>";

describe("resolveSynthesisKey", () => {
  it("finds the desktop note when this shell lists the chapters in another order", () => {
    const notes = { [DESKTOP_KEY]: FULL };
    // Mobile sorts its scope by scripture order; desktop minted in tab order.
    expect(
      resolveSynthesisKey(notes, ["Psalms 69", "Luke 19", "John 2"])
    ).toBe(DESKTOP_KEY);
  });

  it("finds it whatever the order, so both shells read one note", () => {
    const notes = { [DESKTOP_KEY]: FULL };
    const orders = [
      ["Luke 19", "John 2", "Psalms 69"],
      ["John 2", "Psalms 69", "Luke 19"],
      ["Psalms 69", "John 2", "Luke 19"],
    ];
    orders.forEach((o) => expect(resolveSynthesisKey(notes, o)).toBe(DESKTOP_KEY));
  });

  it("does NOT adopt another study's synthesis just because the chapters overlap", () => {
    // A plain chapter study of John 2 is not the keyword study that includes it.
    const notes = { [DESKTOP_KEY]: FULL };
    expect(resolveSynthesisKey(notes, ["John 2"])).toBe("synthesis|John 2");
  });

  it("does not join a study that merely contains this one's chapters", () => {
    const notes = { "synthesis|John 2": FULL };
    expect(resolveSynthesisKey(notes, ["John 2", "Luke 19"])).toBe(
      "synthesis|John 2+Luke 19"
    );
  });

  it("ignores an empty note under a matching key and still mints there", () => {
    const notes = { [DESKTOP_KEY]: "   " };
    expect(
      resolveSynthesisKey(notes, ["Luke 19", "John 2", "Psalms 69"])
    ).toBe(DESKTOP_KEY);
  });

  it("mints in the order given when nothing is written yet", () => {
    expect(resolveSynthesisKey({}, ["Alma 32", "Alma 33"])).toBe(
      "synthesis|Alma 32+Alma 33"
    );
  });

  it("never rewrites an existing key's order — that would orphan the note", () => {
    const notes: Record<string, string> = { [DESKTOP_KEY]: FULL };
    const got = resolveSynthesisKey(notes, ["John 2", "Luke 19", "Psalms 69"]);
    expect(got).toBe(DESKTOP_KEY);
    expect(notes[got]).toBe(FULL);
  });

  it("round-trips chapters through a key", () => {
    expect(chaptersOfKey(synthesisKeyFor(["Alma 32", "Alma 33"]))).toEqual([
      "Alma 32",
      "Alma 33",
    ]);
  });
});
