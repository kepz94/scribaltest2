import {
  resolveSynthesisKey,
  synthesisKeyFor,
  synthesisKeyForScope,
  legacySynthesisKeyToMigrate,
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

// Jul 31 2026. Kepu's keyword study "Cleansing The Temple" held an 8,656
// character synthesis under a twelve-chapter key. He gathered five more verses
// into the study — Exodus 21, Matthew 13, 1 Corinthians 6 and two JST chapters
// — and the chapter set changed. The exact-set match found nothing, a fresh
// empty key was minted, and the synthesis vanished from both shells at once.
// Nothing had been deleted; the study had simply stopped answering to its own
// note's name.
describe("a study that gains a chapter keeps its synthesis", () => {
  const SCOPE = "searchstudy:ss_1785368084577_wsanz";
  const BEFORE = ["Psalms 69", "Jeremiah 7", "Matthew 21", "Mark 11"];
  const AFTER = BEFORE.concat(["Exodus 21", "Matthew 13", "1 Corinthians 6"]);

  it("REGRESSION: the chapter-keyed note is lost when the study grows", () => {
    // The old behaviour, kept as a test so it can never come back silently.
    const notes = { [synthesisKeyFor(BEFORE)]: FULL };
    const key = resolveSynthesisKey(notes, AFTER);
    expect(notes[key]).toBeUndefined();
  });

  it("the scope key survives the same growth", () => {
    const notes = { [synthesisKeyForScope(SCOPE)]: FULL };
    expect(notes[resolveSynthesisKey(notes, AFTER, SCOPE)]).toBe(FULL);
    expect(notes[resolveSynthesisKey(notes, BEFORE, SCOPE)]).toBe(FULL);
    expect(notes[resolveSynthesisKey(notes, [], SCOPE)]).toBe(FULL);
  });

  it("reads a legacy chapter-keyed note in place before it has moved", () => {
    const notes = { [synthesisKeyFor(BEFORE)]: FULL };
    expect(notes[resolveSynthesisKey(notes, BEFORE, SCOPE)]).toBe(FULL);
  });

  it("mints on the scope, not the chapter list, once a scope is known", () => {
    expect(resolveSynthesisKey({}, BEFORE, SCOPE)).toBe(
      synthesisKeyForScope(SCOPE)
    );
    // No scope to give (an unsaved compile) still mints the chapter key.
    expect(resolveSynthesisKey({}, BEFORE)).toBe(synthesisKeyFor(BEFORE));
  });

  it("hands a legacy note off to the scope key exactly once", () => {
    const legacy = synthesisKeyFor(BEFORE);
    const notes: Record<string, string> = { [legacy]: FULL };
    expect(legacySynthesisKeyToMigrate(notes, BEFORE, SCOPE)).toBe(legacy);
    // After the copy the helper goes quiet — no loop, no second write.
    notes[synthesisKeyForScope(SCOPE)] = FULL;
    expect(legacySynthesisKeyToMigrate(notes, BEFORE, SCOPE)).toBeNull();
  });

  it("never migrates over a synthesis already written on the scope key", () => {
    const notes = {
      [synthesisKeyFor(BEFORE)]: FULL,
      [synthesisKeyForScope(SCOPE)]: "<p>Newer, written since.</p>",
    };
    expect(legacySynthesisKeyToMigrate(notes, BEFORE, SCOPE)).toBeNull();
  });

  it("a scope key is never mistaken for a chapter list", () => {
    // Two studies, one of them already on a scope key. The legacy matcher must
    // not read "scope:searchstudy:…" as a chapter and match it to anything.
    const notes = { [synthesisKeyForScope(SCOPE)]: FULL };
    expect(resolveSynthesisKey(notes, ["scope:" + SCOPE])).toBe(
      synthesisKeyFor(["scope:" + SCOPE])
    );
  });
});
