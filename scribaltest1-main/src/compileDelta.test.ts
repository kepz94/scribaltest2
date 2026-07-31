import {
  compileDelta,
  compileCountKey,
  studyCountKey,
} from "./compileDelta";

function memStore() {
  const m: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in m ? m[k] : null),
    setItem: (k: string, v: string) => {
      m[k] = v;
    },
  };
}

describe("compileDelta", () => {
  it("reports every mark on a study's first compile", () => {
    const s = memStore();
    expect(compileDelta("k", 14, s)).toBe(14);
  });

  it("reports zero when nothing was added since last compile", () => {
    const s = memStore();
    compileDelta("k", 14, s);
    expect(compileDelta("k", 14, s)).toBe(0);
  });

  it("reports only what was added", () => {
    const s = memStore();
    compileDelta("k", 14, s);
    expect(compileDelta("k", 17, s)).toBe(3);
  });

  it("reports zero when marks were REMOVED — nothing was gathered", () => {
    const s = memStore();
    compileDelta("k", 14, s);
    expect(compileDelta("k", 9, s)).toBe(0);
  });

  it("counts each study separately", () => {
    // The old global counter meant compiling one study disarmed the animation
    // for every other, and marking anywhere re-armed it for all of them.
    const s = memStore();
    const a = compileCountKey(["Alma 32"]);
    const b = compileCountKey(["John 2", "Luke 19"]);
    compileDelta(a, 10, s);
    expect(compileDelta(b, 4, s)).toBe(4);
    expect(compileDelta(a, 10, s)).toBe(0);
  });

  it("keys a linked study by its scopes, whatever order they arrive in", () => {
    expect(compileCountKey(["Luke 19", "John 2"])).toBe(
      compileCountKey(["John 2", "Luke 19"])
    );
  });

  it("keeps a keyword study's key distinct from a chapter's", () => {
    expect(studyCountKey("abc")).not.toBe(compileCountKey(["abc"]));
  });

  it("treats a study as fresh when storage is unavailable", () => {
    expect(compileDelta("k", 6, null)).toBe(6);
  });
});
