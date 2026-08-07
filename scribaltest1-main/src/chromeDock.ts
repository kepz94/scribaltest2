// Where a note's sticky toolbar should dock, in the compile screen's own
// coordinates.
//
// The compile screen is `position: fixed; inset: 0`, so it is laid out against
// the LAYOUT viewport — and the layout viewport does not move when the software
// keyboard opens. What moves is the VISUAL viewport: iOS shrinks it to sit above
// the keyboard and then pans it down the layout viewport so the caret stays in
// sight. Everything anchored to the top of the fixed screen — the chrome, and
// the toolbar docked under it — pans straight out of view with it.
//
// So the dock line is the lower of two edges, both measured from the top of the
// fixed screen:
//   1. the bottom of the chrome overlay, when the chrome is showing
//   2. the top of the part of the screen the reader can actually SEE
//
// Below the chrome while the chrome is there; below the keyboard's fold once
// the keyboard has pushed the view past it. Taking the max is what makes it
// answer to both, instead of only to the one that happens to be moving.

export interface DockInput {
  // Measured height of the chrome overlay (header + toggles).
  chromeH: number;
  // Whether the chrome has slid away on scroll-down.
  chromeHidden: boolean;
  // visualViewport.offsetTop: how far the visible window has been panned down
  // the layout viewport. 0 whenever no keyboard is up.
  viewportTop: number;
}

export function dockLine({
  chromeH,
  chromeHidden,
  viewportTop,
}: DockInput): number {
  const chromeBottom = chromeHidden ? 0 : Math.max(0, chromeH || 0);
  const visibleTop = Math.max(0, viewportTop || 0);
  return Math.max(chromeBottom, visibleTop);
}

// How long the toolbar should take to travel to a new dock line.
//
// The chrome's slide is a 0.3s animation and the toolbar should ride with it,
// or it arrives early and waits for the header to catch up. A keyboard move is
// not an animation — it is tracking a gesture, and a transition there makes the
// toolbar lag visibly behind the thing it is supposed to be pinned under.
export const DOCK_ANIM_SLIDE = "0.3s";
export const DOCK_ANIM_INSTANT = "0s";

export function dockAnim(viewportMoved: boolean): string {
  return viewportMoved ? DOCK_ANIM_INSTANT : DOCK_ANIM_SLIDE;
}
