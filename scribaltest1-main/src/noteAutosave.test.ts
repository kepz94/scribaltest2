// The rule an open note editor uses to decide what to write. The asymmetry
// between "typing" and "done" is the safety property: autosave adds, only a
// deliberate act clears.
import {
  plainTextOf,
  noteCommit,
  autosaveDueNow,
  AUTOSAVE_MAX_WAIT_MS,
} from "./noteAutosave";

const P = (s: string) => "<p>" + s + "</p>";

describe("plainTextOf", () => {
  test("a document holding only an empty paragraph is empty", () => {
    expect(plainTextOf("<p><br></p>")).toBe("");
    expect(plainTextOf("<p> </p>")).toBe("");
    expect(plainTextOf("<p>&nbsp;</p>")).toBe("");
    expect(plainTextOf("")).toBe("");
  });
  test("markup is not text", () => {
    expect(plainTextOf('<p class="x"><b>Grace</b> abounds</p>')).toBe(
      "Grace abounds"
    );
  });
});

describe("autosave may only ever add", () => {
  test("a pause in typing commits what was typed", () => {
    const r = noteCommit(P("Grace is the enabling power"), "", "typing");
    expect(r).toEqual({ save: true, text: P("Grace is the enabling power") });
  });

  test("typing over an existing note commits the new text", () => {
    const r = noteCommit(P("second thought"), P("first thought"), "typing");
    expect(r.save).toBe(true);
    expect(r.text).toBe(P("second thought"));
  });

  // The one that matters. Select-all then a pause before retyping must not be
  // able to travel as a deletion.
  test("an emptied editor NEVER autosaves a clear", () => {
    const r = noteCommit("<p><br></p>", P("eight thousand characters"), "typing");
    expect(r).toEqual({ save: false, text: "" });
  });

  test("leaving an untouched empty editor writes nothing", () => {
    expect(noteCommit("<p><br></p>", "", "typing").save).toBe(false);
    expect(noteCommit("<p><br></p>", "", "done").save).toBe(false);
  });
});

describe("Done is the deliberate act", () => {
  test("Done on an editor the user emptied clears the note", () => {
    const r = noteCommit("<p><br></p>", P("a thought"), "done");
    expect(r).toEqual({ save: true, text: "" });
  });

  test("Done saves text exactly as autosave would have", () => {
    const html = P("State the main idea");
    expect(noteCommit(html, "", "done")).toEqual(
      noteCommit(html, "", "typing")
    );
  });
});

describe("an unchanged editor is not a save", () => {
  // The reducer stamps every write and the stamp decides merges, so re-saving
  // identical text would let this device outrank a real edit made elsewhere.
  test("identical text is declined under both reasons", () => {
    const html = P("unchanged");
    expect(noteCommit(html, html, "typing").save).toBe(false);
    expect(noteCommit(html, html, "done").save).toBe(false);
  });
});

describe("the commit ceiling", () => {
  test("an unbroken stretch of typing still commits", () => {
    expect(autosaveDueNow(10_000, 10_000 - AUTOSAVE_MAX_WAIT_MS)).toBe(true);
  });
  test("a fresh edit waits for the pause instead", () => {
    expect(autosaveDueNow(10_000, 9_900)).toBe(false);
  });
});
