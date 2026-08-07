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

// ── the keyboard ──────────────────────────────────────────────────────────────
// iOS moves the visible window over (or shrinks it under) a fixed screen in
// THREE different ways — resize the layout viewport, pan the visual viewport,
// or overlay without touching either — and which one you get depends on iOS
// version and on installed-PWA vs Safari-tab. Two models have now been shipped
// and disproved by device (ebcd981: "the keyboard pans, add offsetTop" — put
// the bar mid-screen; c1b5884: "iOS clamps the screen, no offset needed" — the
// bar wandered whenever the keyboard was involved). So: no model. The caller
// MEASURES where the visible top edge actually sits relative to the screen —
//   viewportTop = visualViewport.offsetTop − screen.getBoundingClientRect().top
// — and the dock line is simply the LOWER of that edge and the chrome's
// bottom. Under a resizing/clamping iOS the measurement reads 0 and the chrome
// rule stands alone; under a panning iOS it reads the pan and the bar rides
// the visible edge. Either way the bar sits where the user can see it.

export interface DockInput {
  // Measured height of the chrome overlay (header + toggles).
  chromeH: number;
  // Whether the chrome has slid away on scroll-down.
  chromeHidden: boolean;
  // The scroll container's own top padding, which the offset must cancel.
  scrollerPadTop: number;
  // MEASURED: how far the visible window's top edge sits below the screen's
  // top (see above). 0 whenever no keyboard is involved.
  viewportTop?: number;
}

const nonNeg = (n: number): number => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

// Where the toolbar should come to rest, measured from the top of the screen.
export function dockTarget({
  chromeH,
  chromeHidden,
  viewportTop,
}: Pick<DockInput, "chromeH" | "chromeHidden" | "viewportTop">): string {
  const vv = nonNeg(viewportTop || 0);
  // Under the camera cutout. The chrome carries its own notch strip, so when
  // the chrome is showing, its measured height already clears the same area.
  // The visible edge, when the keyboard has pushed it lower than either, wins
  // — a bar docked above what can be seen is a bar the user does not have.
  if (chromeHidden)
    return vv > 0
      ? "max(env(safe-area-inset-top), " + vv + "px)"
      : "env(safe-area-inset-top)";
  return Math.max(nonNeg(chromeH), vv) + "px";
}

export function dockTop(input: DockInput): string {
  const target = dockTarget(input);
  const pad = nonNeg(input.scrollerPadTop);
  if (!pad) return target;
  return "calc(" + target + " - " + pad + "px)";
}

// How the toolbar travels to a new dock line. The chrome's slide is a 0.3s
// animation the bar should ride along with; a keyboard move is tracking the
// OS's own slide through sparse viewport events, so a short glide smooths the
// gaps without reading as lag.
export const DOCK_ANIM_CHROME = "0.3s";
export const DOCK_ANIM_VIEWPORT = "0.15s";
