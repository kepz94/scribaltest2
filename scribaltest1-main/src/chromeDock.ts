// The sticky `top` for a note's formatting toolbar, as a CSS value.
//
// Two things have to be right, and each one has been got wrong once.
//
// 1. WHERE IT SHOULD LAND. At the top of the screen, under the camera cutout,
//    once the chrome has slid away on scroll-down — and flush under the chrome
//    while the chrome is still there, since the chrome paints over the scroller
//    and would otherwise swallow it.
//
// 2. WHAT `top` IS MEASURED FROM. Not the top of the screen. A sticky box's
//    offset is resolved against its scroll container's CONTENT box, so the
//    scroller's own `paddingTop` already sits between the top of the screen and
//    `top: 0`. On the mobile compile screen that padding is `headerH + 10` — it
//    is there so the content clears the chrome overlay without reflowing when
//    the chrome slides. Measured in Chromium: padding 130 with `top: 0` renders
//    at 130; padding 130 with `top: -130px` renders at 0; padding 130 with
//    `top: calc(59px - 130px)` renders at 59.
//
// So the published value is a target MINUS that padding, and it is routinely
// negative. Publishing the target on its own docked the bar one chrome-height
// too low — the bar Kepu photographed sitting in the middle of his screen.
//
// The reason this survived two rounds of "verified by measurement" is worth
// keeping: the browser harness reproduced the scroller but not its padding, so
// it measured 0 and agreed with code that was rendering at 137. A harness that
// omits a property of the real container does not test the real container.
//
// Desktop passes scrollerPadTop: 0 — its compile screen scrolls the document
// and has no such padding, so target and offset are the same number there.

export interface DockInput {
  // Measured height of the chrome overlay (header + toggles).
  chromeH: number;
  // Whether the chrome has slid away on scroll-down.
  chromeHidden: boolean;
  // The scroll container's own top padding, which the offset must cancel.
  scrollerPadTop: number;
}

const nonNeg = (n: number): number => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

// Where the toolbar should come to rest, measured from the top of the screen.
export function dockTarget({
  chromeH,
  chromeHidden,
}: Pick<DockInput, "chromeH" | "chromeHidden">): string {
  // Under the camera cutout. The chrome carries its own notch strip, so when
  // the chrome is showing, its measured height already clears the same area.
  if (chromeHidden) return "env(safe-area-inset-top)";
  return nonNeg(chromeH) + "px";
}

export function dockTop(input: DockInput): string {
  const target = dockTarget(input);
  const pad = nonNeg(input.scrollerPadTop);
  if (!pad) return target;
  return "calc(" + target + " - " + pad + "px)";
}
