// Where the toolbar lands, and what its `top` is measured from. The second one
// is the part that was wrong twice.
import { dockTarget, dockTop } from "./chromeDock";

const CHROME = 127;
const PAD = CHROME + 10; // the mobile scroller's paddingTop

describe("where it should land on screen", () => {
  test("scrolled, chrome gone: under the camera cutout", () => {
    expect(dockTarget({ chromeH: CHROME, chromeHidden: true })).toBe(
      "env(safe-area-inset-top)"
    );
  });
  test("chrome showing: flush under it, since the chrome paints over the scroller", () => {
    expect(dockTarget({ chromeH: CHROME, chromeHidden: false })).toBe("127px");
  });
});

describe("the offset cancels the scroller's own top padding", () => {
  // A sticky offset resolves against the scroll container's CONTENT box, so the
  // padding already sits between the top of the screen and `top: 0`. Publishing
  // the target on its own put the bar one chrome-height down the screen.
  test("scrolled: lands at the safe-area top, not at the padding", () => {
    expect(
      dockTop({ chromeH: CHROME, chromeHidden: true, scrollerPadTop: PAD })
    ).toBe("calc(env(safe-area-inset-top) - 137px)");
  });

  test("chrome showing: lands flush under the chrome", () => {
    expect(
      dockTop({ chromeH: CHROME, chromeHidden: false, scrollerPadTop: PAD })
    ).toBe("calc(127px - 137px)");
  });

  test("the value is expected to go negative — that is the point", () => {
    // 127 - 137 renders at 127 from the top of the screen. Refusing to go
    // negative would pin it at the padding, which is the bug.
    const v = dockTop({
      chromeH: CHROME,
      chromeHidden: false,
      scrollerPadTop: PAD,
    });
    expect(v).toContain("- 137px");
  });
});

describe("a container with no padding — the desktop compile screen", () => {
  test("target and offset are the same number", () => {
    expect(
      dockTop({ chromeH: 76, chromeHidden: false, scrollerPadTop: 0 })
    ).toBe("76px");
  });
  test("no pointless calc() wrapper", () => {
    expect(
      dockTop({ chromeH: 76, chromeHidden: false, scrollerPadTop: 0 })
    ).not.toContain("calc");
  });
});

describe("nonsense in, usable CSS out", () => {
  test("an unmeasured chrome still yields a valid value", () => {
    expect(
      dockTop({ chromeH: 0, chromeHidden: false, scrollerPadTop: 0 })
    ).toBe("0px");
    expect(
      dockTop({ chromeH: NaN as any, chromeHidden: false, scrollerPadTop: PAD })
    ).toBe("calc(0px - 137px)");
  });
  test("a negative or missing padding is not subtracted", () => {
    expect(
      dockTop({ chromeH: 50, chromeHidden: false, scrollerPadTop: -20 })
    ).toBe("50px");
    expect(
      dockTop({
        chromeH: 50,
        chromeHidden: false,
        scrollerPadTop: undefined as any,
      })
    ).toBe("50px");
  });
});
