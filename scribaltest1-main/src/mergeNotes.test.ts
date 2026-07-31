import { mergeNotes } from "./hooks/useMarks";

// The bug this rule exists to kill: a synthesis begun on the phone and finished
// on the desktop showed only its first paragraph on the phone, forever. Notes
// merged "fill blanks only" — a key the device already had could never be
// replaced — so the two copies could never converge.
const KEY = "synthesis|Luke 19+John 2+Psalms 69";
const FIRST = "<p>In those days, offering a ritual sacrifice was customary.</p>";
const WHOLE =
  "<h1>Christ Cleansing The Temple</h1>" +
  FIRST +
  "<hr><p>This event was a fulfillment of Psalm 69:9.</p>";

describe("mergeNotes", () => {
  it("takes the newer remote note over an older local one", () => {
    const r = mergeNotes(
      { [KEY]: FIRST },
      { [KEY]: 100 },
      { [KEY]: WHOLE },
      { [KEY]: 200 }
    );
    expect(r.notes[KEY]).toBe(WHOLE);
    expect(r.changed).toBe(true);
  });

  it("keeps a newer local note against an older remote one", () => {
    const r = mergeNotes(
      { [KEY]: WHOLE },
      { [KEY]: 300 },
      { [KEY]: FIRST },
      { [KEY]: 100 }
    );
    expect(r.notes[KEY]).toBe(WHOLE);
    expect(r.changed).toBe(false);
  });

  it("propagates a note DELIBERATELY cleared on another device", () => {
    // The original rule ignored this outright, so a deletion never travelled.
    // It still travels — but now it has to say so.
    const r = mergeNotes(
      { [KEY]: WHOLE },
      { [KEY]: 100 },
      { [KEY]: "" },
      { [KEY]: 200 },
      {},
      { [KEY]: 200 }
    );
    expect(r.notes[KEY]).toBe("");
  });

  it("an empty remote does NOT erase real text without a recorded deletion", () => {
    // Jul 31 2026, and the reason this file exists. A stale editor saved blank
    // and last-write-wins carried that blank to every device at once. A newer
    // stamp is not evidence of intent — two devices' clocks disagree by more
    // than the gap between a save and a sync.
    const r = mergeNotes(
      { [KEY]: WHOLE },
      { [KEY]: 100 },
      { [KEY]: "" },
      { [KEY]: 999999 }
    );
    expect(r.notes[KEY]).toBe(WHOLE);
    expect(r.changed).toBe(false);
  });

  it("a deletion recorded BEFORE our own edit does not win", () => {
    // They cleared it, then we wrote again. Ours is the later intent.
    const r = mergeNotes(
      { [KEY]: WHOLE },
      { [KEY]: 500 },
      { [KEY]: "" },
      { [KEY]: 400 },
      {},
      { [KEY]: 400 }
    );
    expect(r.notes[KEY]).toBe(WHOLE);
  });

  it("does not resurrect a note cleared HERE more recently", () => {
    const r = mergeNotes({ [KEY]: "" }, { [KEY]: 300 }, { [KEY]: WHOLE }, {
      [KEY]: 100,
    });
    expect(r.notes[KEY]).toBe("");
  });

  it("adopts a key it has never seen", () => {
    const r = mergeNotes({}, {}, { [KEY]: WHOLE }, { [KEY]: 200 });
    expect(r.notes[KEY]).toBe(WHOLE);
  });

  it("ignores an unseen key whose remote value is blank", () => {
    const r = mergeNotes({}, {}, { [KEY]: "   " }, {});
    expect(r.notes[KEY]).toBeUndefined();
    expect(r.changed).toBe(false);
  });

  it("reconciles two UNSTAMPED copies by taking the fuller one", () => {
    // Exactly Kepu's data: both written before stamps existed, so neither
    // carries a time. The phone holds the first paragraph, the cloud the whole
    // synthesis, and the reader is missing the rest.
    const r = mergeNotes({ [KEY]: FIRST }, {}, { [KEY]: WHOLE }, {});
    expect(r.notes[KEY]).toBe(WHOLE);
  });

  it("does not shrink an unstamped local note to a shorter remote one", () => {
    const r = mergeNotes({ [KEY]: WHOLE }, {}, { [KEY]: FIRST }, {});
    expect(r.notes[KEY]).toBe(WHOLE);
    expect(r.changed).toBe(false);
  });

  it("is idempotent — a second merge of the same input changes nothing", () => {
    const once = mergeNotes({ [KEY]: FIRST }, {}, { [KEY]: WHOLE }, {});
    const twice = mergeNotes(once.notes, once.noteAt, { [KEY]: WHOLE }, {});
    expect(twice.changed).toBe(false);
    expect(twice.notes).toBe(once.notes);
  });

  it("leaves identical text alone whatever the stamps say", () => {
    const r = mergeNotes(
      { [KEY]: WHOLE },
      { [KEY]: 1 },
      { [KEY]: WHOLE },
      { [KEY]: 999 }
    );
    expect(r.changed).toBe(false);
  });
});
