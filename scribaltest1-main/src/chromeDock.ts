// Where a note's sticky toolbar docks, in the compile screen's own coordinates.
//
// One rule: the top of the screen, below the chrome only while the chrome is
// actually there. Scroll down, the chrome slides away, the toolbar goes to the
// top and stays there.
//
// It does NOT add visualViewport.offsetTop, and that is the whole lesson of
// this file. The reasoning that said it should went: the compile screen is
// `position: fixed; inset: 0`, so it is laid out against the layout viewport,
// which the software keyboard does not move — therefore anything docked to its
// top pans out of view when iOS pans the visual viewport to clear the keyboard.
// Every step of that is true except the conclusion, because iOS already clamps
// the fixed screen to the visual viewport. The offset is applied for us. Adding
// it again put the toolbar exactly one keyboard-pan BELOW where it belonged —
// floating in the middle of the screen between the note's own lines, which is
// what Kepu photographed (Aug 7, ~266px down, chrome not even on screen).
//
// If a keyboard-aware offset is ever wanted here again: measure it on a device
// first. This one was shipped on unit tests and a model of iOS, and the model
// was wrong in the one way that mattered.

export interface DockInput {
  // Measured height of the chrome overlay (header + toggles).
  chromeH: number;
  // Whether the chrome has slid away on scroll-down.
  chromeHidden: boolean;
}

export function dockLine({ chromeH, chromeHidden }: DockInput): number {
  if (chromeHidden) return 0;
  const h = Number(chromeH);
  return Number.isFinite(h) && h > 0 ? h : 0;
}
