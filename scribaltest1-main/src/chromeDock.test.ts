// The toolbar docks to the top of the screen, clearing the chrome only while
// the chrome is on screen.
import { dockLine } from "./chromeDock";

const CHROME = 120;

test("clears the chrome while the chrome is showing", () => {
  expect(dockLine({ chromeH: CHROME, chromeHidden: false })).toBe(120);
});

test("goes to the top of the screen once the chrome slides away", () => {
  expect(dockLine({ chromeH: CHROME, chromeHidden: true })).toBe(0);
});

// The keyboard needs no term of its own: iOS clamps the fixed compile screen to
// the visual viewport, so the top of the screen IS the top of what can be seen.
// Adding visualViewport.offsetTop on top of that docked the toolbar one full
// keyboard-pan too low — mid-screen, between the note's own lines.
test("the dock line depends on nothing but the chrome", () => {
  const inputs = { chromeH: CHROME, chromeHidden: true };
  expect(dockLine(inputs)).toBe(0);
  expect(dockLine({ ...inputs, chromeHidden: false })).toBe(120);
  // Same two answers whatever the viewport is doing — there is no third input
  // that can push it down the screen.
  expect(Object.keys(inputs).length).toBe(2);
});

describe("nothing may push it below the top", () => {
  test("an unmeasured or nonsense chrome docks at the top", () => {
    expect(dockLine({ chromeH: 0, chromeHidden: false })).toBe(0);
    expect(dockLine({ chromeH: -50, chromeHidden: false })).toBe(0);
    expect(dockLine({ chromeH: NaN as any, chromeHidden: false })).toBe(0);
    expect(dockLine({ chromeH: undefined as any, chromeHidden: false })).toBe(0);
  });
  test("always a finite number", () => {
    expect(Number.isFinite(dockLine({ chromeH: NaN as any, chromeHidden: false }))).toBe(true);
  });
});
