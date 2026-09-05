// Reading-row panel identity (SCR-109).
//
// A chapter panel's id IS its location: makeTabId(bookId, volume, book,
// chapter). Re-aiming a panel at another chapter or book therefore mints a NEW
// id for the SAME on-screen panel. Two maps are keyed by that id:
//
//   rowOrder     — the arranged left-to-right order of the reading row
//   panelWidths  — the width the user dragged each panel to (SCR-29)
//
// Neither followed the rename, so on every chapter change the panel
//   1. lost its stored width and snapped back to DEFAULT_PANEL_WIDTH, and
//   2. dropped out of the remembered arrangement — reconcileRowOrder filters
//      the now-unknown old id out and appends the new id at the END, so the
//      panel swapped places with whatever sat to its right.
//
// These reducers are pure so the carry is provable in tests; App.tsx holds the
// React state and calls them.

/** The reconciled row order: remembered arrangement first, then anything new. */
export const reconcileRowOrder = (
  rowOrder: string[],
  rowIds: string[]
): string[] =>
  rowOrder
    .filter((id) => rowIds.includes(id))
    .concat(rowIds.filter((id) => !rowOrder.includes(id)));

/**
 * Carry a panel's row slot across a rename.
 *
 * Branches, all of them:
 *  - fromId === toId               -> unchanged (nothing was renamed)
 *  - rowOrder empty                -> unchanged. No arrangement is remembered
 *                                     yet, so the row already follows the tabs
 *                                     array, which keeps the panel in place on
 *                                     its own. Writing one here would invent an
 *                                     arrangement the user never made.
 *  - fromId not in rowOrder        -> unchanged (this panel was never arranged)
 *  - toId already in rowOrder      -> drop fromId. The target chapter is open
 *                                     in another panel and already owns a slot;
 *                                     renaming onto it would give one panel two.
 *  - otherwise                     -> fromId's slot becomes toId, in place.
 */
export const carryRowOrder = (
  rowOrder: string[],
  fromId: string,
  toId: string
): string[] => {
  if (fromId === toId) return rowOrder;
  if (!rowOrder.length) return rowOrder;
  if (rowOrder.indexOf(fromId) < 0) return rowOrder;
  if (rowOrder.indexOf(toId) >= 0) return rowOrder.filter((x) => x !== fromId);
  return rowOrder.map((x) => (x === fromId ? toId : x));
};

/**
 * Carry a panel's dragged width across a rename.
 *
 * Branches, all of them:
 *  - fromId === toId               -> unchanged
 *  - fromId has no stored width    -> unchanged (it is at the default already)
 *  - toId already has a width      -> keep toId's own width, drop fromId's. The
 *                                     target panel's width belongs to the panel
 *                                     the user sized, not to the one arriving.
 *  - otherwise                     -> move fromId's width onto toId.
 */
export const carryPanelWidth = (
  widths: Record<string, number>,
  fromId: string,
  toId: string
): Record<string, number> => {
  if (fromId === toId) return widths;
  if (!(fromId in widths)) return widths;
  const next = { ...widths };
  if (!(toId in next)) next[toId] = next[fromId];
  delete next[fromId];
  return next;
};

/** Drop a panel's stored width so it returns to the default opening width. */
export const clearPanelWidth = (
  widths: Record<string, number>,
  id: string
): Record<string, number> => {
  if (!(id in widths)) return widths;
  const next = { ...widths };
  delete next[id];
  return next;
};
