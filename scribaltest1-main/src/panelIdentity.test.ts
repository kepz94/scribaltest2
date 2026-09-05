import {
  reconcileRowOrder,
  carryRowOrder,
  carryPanelWidth,
  clearPanelWidth,
} from "./panelIdentity";

// Stand-ins for makeTabId output — the shape that makes the id location-bound.
const GEN1 = "tab_master_0_0_0";
const GEN2 = "tab_master_0_0_1";
const GEN3 = "tab_master_0_0_2";
const SEARCH = "search_1";

describe("reconcileRowOrder", () => {
  it("keeps the remembered arrangement and appends unknown ids", () => {
    expect(reconcileRowOrder([SEARCH, GEN1], [GEN1, SEARCH, GEN3])).toEqual([
      SEARCH,
      GEN1,
      GEN3,
    ]);
  });

  it("drops remembered ids that are no longer open", () => {
    expect(reconcileRowOrder([GEN1, SEARCH], [SEARCH])).toEqual([SEARCH]);
  });

  it("REGRESSION: a renamed panel with no carry falls to the end of the row", () => {
    // The bug, stated as a test: the panel was arranged FIRST, changed chapter
    // (Genesis 1 -> Genesis 2), and the untouched rowOrder pushed it last.
    const rowOrder = [GEN1, SEARCH];
    const rowIdsAfterChapterChange = [GEN2, SEARCH];
    expect(reconcileRowOrder(rowOrder, rowIdsAfterChapterChange)).toEqual([
      SEARCH,
      GEN2,
    ]);
  });
});

describe("carryRowOrder", () => {
  it("holds the panel's slot across a chapter change", () => {
    const carried = carryRowOrder([GEN1, SEARCH], GEN1, GEN2);
    expect(carried).toEqual([GEN2, SEARCH]);
    // ...and the reconciled row now keeps it first, where the user put it.
    expect(reconcileRowOrder(carried, [GEN2, SEARCH])).toEqual([GEN2, SEARCH]);
  });

  it("holds the slot through repeated chapter changes", () => {
    let order = [SEARCH, GEN1, GEN3];
    order = carryRowOrder(order, GEN1, GEN2);
    order = carryRowOrder(order, GEN2, GEN1);
    expect(order).toEqual([SEARCH, GEN1, GEN3]);
  });

  it("leaves an unarranged row alone (the tabs array already holds order)", () => {
    expect(carryRowOrder([], GEN1, GEN2)).toEqual([]);
  });

  it("leaves the arrangement alone when the panel was never in it", () => {
    expect(carryRowOrder([SEARCH], GEN1, GEN2)).toEqual([SEARCH]);
  });

  it("drops the source slot when the target chapter already has one", () => {
    // Genesis 2 is already open in another panel — the source tab is closed,
    // so its slot goes away rather than duplicating Genesis 2's.
    expect(carryRowOrder([GEN1, GEN2, SEARCH], GEN1, GEN2)).toEqual([
      GEN2,
      SEARCH,
    ]);
  });

  it("is a no-op when the id did not change", () => {
    const order = [GEN1, SEARCH];
    expect(carryRowOrder(order, GEN1, GEN1)).toBe(order);
  });
});

describe("carryPanelWidth", () => {
  it("holds a dragged width across a chapter change", () => {
    expect(carryPanelWidth({ [GEN1]: 720 }, GEN1, GEN2)).toEqual({
      [GEN2]: 720,
    });
  });

  it("holds the width through repeated chapter changes", () => {
    let w: Record<string, number> = { [GEN1]: 300 };
    w = carryPanelWidth(w, GEN1, GEN2);
    w = carryPanelWidth(w, GEN2, GEN3);
    expect(w).toEqual({ [GEN3]: 300 });
  });

  it("does not disturb other panels' widths", () => {
    expect(carryPanelWidth({ [GEN1]: 720, [SEARCH]: 400 }, GEN1, GEN2)).toEqual({
      [GEN2]: 720,
      [SEARCH]: 400,
    });
  });

  it("keeps the target's own width and releases the source's", () => {
    expect(carryPanelWidth({ [GEN1]: 720, [GEN2]: 300 }, GEN1, GEN2)).toEqual({
      [GEN2]: 300,
    });
  });

  it("stays at the default when nothing was ever dragged", () => {
    const w = { [SEARCH]: 400 };
    expect(carryPanelWidth(w, GEN1, GEN2)).toBe(w);
  });

  it("is a no-op when the id did not change", () => {
    const w = { [GEN1]: 720 };
    expect(carryPanelWidth(w, GEN1, GEN1)).toBe(w);
  });
});

describe("clearPanelWidth", () => {
  it("drops the panel's width so it reopens at the default", () => {
    expect(clearPanelWidth({ [GEN1]: 720, [SEARCH]: 400 }, GEN1)).toEqual({
      [SEARCH]: 400,
    });
  });

  it("is a no-op for a panel that has no stored width", () => {
    const w = { [SEARCH]: 400 };
    expect(clearPanelWidth(w, GEN1)).toBe(w);
  });
});
