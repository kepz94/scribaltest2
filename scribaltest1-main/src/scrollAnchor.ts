// SCR-86: scroll-anchor preservation around layout-mutating mode toggles.
//
// Entering/leaving send-verses (and remove-verses) mode restructures every
// verse row — checkbox insets, gaps, per-row padding — so the whole column
// re-wraps and re-heights while the container's scrollTop stays fixed, and
// the verse under the reader's eyes slides away by the cumulative height
// delta. The fix: right before the toggle, record which verse sits at the
// top of the viewport and where; right after React re-renders (in a
// useLayoutEffect, before paint), put that verse back at the same offset by
// direct scrollTop math.
//
// Direct scrollTop math only — CSS overflow-anchor is not supported in iOS
// Safari, and Scribal is iPhone-first. Verse rows are located by their
// data-vref attribute, which both shells render in every mode.

export interface VerseAnchor {
  // data-vref of the topmost verse intersecting the viewport at capture time.
  ref: string;
  // That verse's offset from the top edge of the scroll container's viewport.
  offset: number;
}

// The y coordinate (viewport space) where the container's visible area
// starts. The document scroller's rect.top is -scrollY, so it gets 0.
const containerTop = (container: HTMLElement): number =>
  container === document.scrollingElement
    ? 0
    : container.getBoundingClientRect().top;

// Nearest ancestor that actually scrolls vertically; the page scroller when
// no overflow ancestor exists. Every reading surface in both shells mounts
// inside an overflowY:auto div, so the walk normally ends on the first hop.
export function findScrollContainer(
  el: HTMLElement | null
): HTMLElement | null {
  let node = el ? el.parentElement : null;
  while (node) {
    const oy = window.getComputedStyle(node).overflowY;
    if (oy === "auto" || oy === "scroll" || oy === "overlay") return node;
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) || null;
}

// Record the topmost verse currently visible in `container`. `root` limits
// the [data-vref] query to one reading surface (defaults to the container).
// Returns null when nothing is visible — callers then skip the restore.
export function captureVerseAnchor(
  container: HTMLElement | null,
  root?: HTMLElement | null
): VerseAnchor | null {
  if (!container) return null;
  const scope = root || container;
  const cTop = containerTop(container);
  const rows = scope.querySelectorAll("[data-vref]");
  for (let i = 0; i < rows.length; i++) {
    const el = rows[i] as HTMLElement;
    const r = el.getBoundingClientRect();
    if (r.bottom > cTop) {
      const ref = el.getAttribute("data-vref");
      if (!ref) continue;
      return { ref, offset: r.top - cTop };
    }
  }
  return null;
}

// Put the anchored verse back at its captured offset. No-ops when the verse
// is gone (e.g. it was just removed from the study) or nothing was captured.
export function restoreVerseAnchor(
  container: HTMLElement | null,
  anchor: VerseAnchor | null,
  root?: HTMLElement | null
): void {
  if (!container || !anchor) return;
  const scope = root || container;
  const safe = anchor.ref.replace(/["\\]/g, "\\$&");
  const el = scope.querySelector(
    '[data-vref="' + safe + '"]'
  ) as HTMLElement | null;
  if (!el) return;
  const cTop = containerTop(container);
  const nowOffset = el.getBoundingClientRect().top - cTop;
  const delta = nowOffset - anchor.offset;
  if (delta !== 0) container.scrollTop = container.scrollTop + delta;
}
