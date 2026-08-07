// The dock line has to answer to two independent things that move the toolbar's
// reference: the chrome sliding on scroll, and the keyboard panning the visible
// window. It only ever answered to the first.
import {
  dockLine,
  dockAnim,
  DOCK_ANIM_SLIDE,
  DOCK_ANIM_INSTANT,
} from "./chromeDock";

const CHROME = 120;

describe("no keyboard — the chrome alone decides", () => {
  test("docks below the chrome while it is showing", () => {
    expect(
      dockLine({ chromeH: CHROME, chromeHidden: false, viewportTop: 0 })
    ).toBe(120);
  });
  test("rides to the top once the chrome slides away", () => {
    expect(
      dockLine({ chromeH: CHROME, chromeHidden: true, viewportTop: 0 })
    ).toBe(0);
  });
});

describe("keyboard up — the visible window decides once it passes the chrome", () => {
  // iOS pans the visual viewport down the layout viewport to keep the caret
  // above the keyboard. The fixed screen does not move, so the chrome and
  // anything docked under it pan out of view.
  test("a pan smaller than the chrome leaves the chrome in charge", () => {
    // 80px down: the chrome's bottom edge (120) is still the lower of the two.
    expect(
      dockLine({ chromeH: CHROME, chromeHidden: false, viewportTop: 80 })
    ).toBe(120);
  });

  test("a pan past the chrome hands over to the visible top", () => {
    // The whole chrome is now above the fold; docking at 120 would put the
    // toolbar off-screen, which is the reported bug.
    expect(
      dockLine({ chromeH: CHROME, chromeHidden: false, viewportTop: 260 })
    ).toBe(260);
  });

  test("keyboard up AND chrome slid away still follows the keyboard", () => {
    // The case the old code got most wrong: both inputs say "move", and it
    // tracked neither.
    expect(
      dockLine({ chromeH: CHROME, chromeHidden: true, viewportTop: 260 })
    ).toBe(260);
  });

  test("the keyboard closing returns it to the chrome", () => {
    expect(
      dockLine({ chromeH: CHROME, chromeHidden: false, viewportTop: 0 })
    ).toBe(120);
  });
});

describe("nothing is allowed to push it above the fold", () => {
  test("negative or missing values floor at 0", () => {
    expect(
      dockLine({ chromeH: -50, chromeHidden: false, viewportTop: -10 })
    ).toBe(0);
    expect(
      dockLine({ chromeH: NaN as any, chromeHidden: false, viewportTop: 0 })
    ).toBe(0);
  });
  test("a chrome not yet measured docks at the top, not at NaN", () => {
    const d = dockLine({ chromeH: 0, chromeHidden: false, viewportTop: 0 });
    expect(d).toBe(0);
    expect(Number.isFinite(d)).toBe(true);
  });
});

describe("how it travels", () => {
  test("the chrome's slide is animated so the toolbar rides with it", () => {
    expect(dockAnim(false)).toBe(DOCK_ANIM_SLIDE);
  });
  test("a keyboard move is instant — a transition reads as lag", () => {
    expect(dockAnim(true)).toBe(DOCK_ANIM_INSTANT);
  });
});
