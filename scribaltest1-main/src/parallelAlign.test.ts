// The alignment model for the Parallel compile view. The interesting rules are
// the last two describes: a nudge must never move a pinned verse, and pairing
// two verses must put them on the same row in one act.
import {
  lockstepSlots,
  slotsFor,
  rowCount,
  rowOfVerse,
  snapTo,
  nudge,
  pairRows,
  isAlignmentCleared,
  ParallelAlignment,
} from "./parallelAlign";

const align = (
  slots: Record<string, (number | null)[]>,
  pins: Record<string, number[]> = {}
): ParallelAlignment => ({
  scope: "chapter:Genesis 1",
  order: Object.keys(slots),
  slots,
  pins,
  updatedAt: 1000,
});

describe("lockstep is the starting state", () => {
  test("a column of three verses is rows 0,1,2", () => {
    expect(lockstepSlots(3)).toEqual([0, 1, 2]);
  });
  test("an empty chapter has no rows", () => {
    expect(lockstepSlots(0)).toEqual([]);
  });
  test("an absent alignment means lockstep, not an error", () => {
    expect(slotsFor(undefined, "col_Genesis 1", 3)).toEqual([0, 1, 2]);
  });
  test("a stored column is returned verbatim", () => {
    const a = align({ "col_Moses 2": [null, 0, 1] });
    expect(slotsFor(a, "col_Moses 2", 2)).toEqual([null, 0, 1]);
  });
  test("a column the alignment has never heard of falls back to lockstep", () => {
    const a = align({ "col_Moses 2": [null, 0, 1] });
    expect(slotsFor(a, "col_Abraham 4", 2)).toEqual([0, 1]);
  });
});

describe("how tall the board is", () => {
  test("three chapters of 31 verses each is 31 rows", () => {
    expect(
      rowCount(undefined, [
        { id: "a", verseCount: 31 },
        { id: "b", verseCount: 31 },
        { id: "c", verseCount: 31 },
      ])
    ).toBe(31);
  });

  test("the longest column wins, gaps included", () => {
    // 21 verses pushed down two rows is 23 tall; the 25-verse column is taller.
    const a = align({ short: [null, null, ...Array.from({ length: 21 }, (_, i) => i)] });
    expect(
      rowCount(a, [
        { id: "short", verseCount: 21 },
        { id: "long", verseCount: 25 },
      ])
    ).toBe(25);
  });

  test("never reports zero, so the board always has something to render", () => {
    expect(rowCount(undefined, [])).toBe(1);
  });

  test("finds a verse's row, and says -1 when it isn't placed", () => {
    expect(rowOfVerse([null, null, 0, 1], 0)).toBe(2);
    expect(rowOfVerse([null, null, 0, 1], 9)).toBe(-1);
  });
});

describe("snapping a verse to a row", () => {
  test("moving down inserts the blanks above it", () => {
    const r = snapTo([0, 1, 2], 0, 3);
    expect(r.slots).toEqual([null, null, null, 0, 1, 2]);
    expect(r.shortfall).toBe(0);
  });

  test("moving up reclaims the blanks above it", () => {
    const r = snapTo([null, null, 0, 1], 0, 0);
    expect(r.slots).toEqual([0, 1]);
    expect(r.shortfall).toBe(0);
  });

  test("a move it cannot make is reported, not faked", () => {
    // Nothing above verse 0 to reclaim, so row -1 is unreachable. The caller
    // needs to know that rather than be handed a wrong row.
    const r = snapTo([0, 1], 0, -1);
    expect(r.shortfall).toBe(1);
    expect(r.slots).toEqual([0, 1]);
  });

  test("snapping to the row it already occupies changes nothing", () => {
    const r = snapTo([0, 1, 2], 1, 1);
    expect(r.slots).toEqual([0, 1, 2]);
    expect(r.shortfall).toBe(0);
  });
});

describe("a nudge stays inside its own segment", () => {
  test("down, with nothing pinned below: the column just grows", () => {
    const r = nudge([0, 1, 2], [], 1, 1);
    expect(r.blocked).toBe(false);
    expect(r.slots).toEqual([0, null, 1, 2]);
  });

  test("up, with a blank above to reclaim", () => {
    const r = nudge([0, null, 1, 2], [], 1, -1);
    expect(r.blocked).toBe(false);
    expect(r.slots).toEqual([0, 1, 2]);
  });

  test("down, with a pin below and slack to spend: the pin does not move", () => {
    // verse 3 is pinned at row 4. Nudging verse 1 down eats the blank at row 3
    // instead of pushing verse 3 to row 5.
    const before = [0, 1, 2, null, 3];
    const r = nudge(before, [3], 1, 1);
    expect(r.blocked).toBe(false);
    expect(rowOfVerse(r.slots, 3)).toBe(4);
    expect(rowOfVerse(r.slots, 1)).toBe(2);
  });

  test("down, with a pin below and no slack: refused, and nothing changes", () => {
    const before = [0, 1, 2, 3];
    const r = nudge(before, [3], 1, 1);
    expect(r.blocked).toBe(true);
    expect(r.slots).toEqual(before);
  });

  test("up, with nothing above to reclaim: refused, and nothing changes", () => {
    const before = [0, 1, 2];
    const r = nudge(before, [], 0, -1);
    expect(r.blocked).toBe(true);
    expect(r.slots).toEqual(before);
  });

  test("up, with a pin above: it will not cross it", () => {
    // verse 0 is pinned at row 1. Verse 1 cannot reclaim the blank at row 0,
    // because doing so would drag the pinned verse up with it.
    const before = [null, 0, 1];
    const r = nudge(before, [0], 1, -1);
    expect(r.blocked).toBe(true);
    expect(r.slots).toEqual(before);
  });
});

describe("pairing two verses", () => {
  test("both land on the same row, and the later row wins", () => {
    const a = [0, 1, 2, 3];
    const b = [0, 1];
    const r = pairRows(a, 3, b, 0);
    expect(r.row).toBe(3);
    expect(rowOfVerse(r.aSlots, 3)).toBe(3);
    expect(rowOfVerse(r.bSlots, 0)).toBe(3);
    expect(r.shortfall).toBe(0);
  });

  test("the column that was already lower is left alone", () => {
    const a = [0, 1, 2, 3];
    const r = pairRows(a, 3, [0, 1], 0);
    expect(r.aSlots).toEqual(a);
  });
});

describe("the case this was built for: Isaiah 52:1 belongs on row 24", () => {
  // 2 Nephi 8 has 25 verses; it continues past Isaiah 51 into Isaiah 52:1-2.
  // So Isaiah 52's first verse corresponds to 2 Nephi 8:24 — verse index 23,
  // board row 23. Lockstep puts it on row 0, twenty-three rows too high.
  const nephi = lockstepSlots(25);
  const isaiah52 = lockstepSlots(15);

  test("pairing puts them on the same row in one act", () => {
    const r = pairRows(nephi, 23, isaiah52, 0);
    expect(r.row).toBe(23);
    expect(rowOfVerse(r.bSlots, 0)).toBe(23);
    expect(r.bSlots.slice(0, 23).every((s) => s === null)).toBe(true);
  });

  test("and a later nudge elsewhere in the column does not disturb it", () => {
    const paired = pairRows(nephi, 23, isaiah52, 0);
    const pins = [0]; // Isaiah 52:1 pinned by the pairing
    const after = nudge(paired.bSlots, pins, 2, 1);
    expect(after.blocked).toBe(false);
    expect(rowOfVerse(after.slots, 0)).toBe(23);
    expect(rowOfVerse(after.slots, 2)).toBe(26);
  });
});

describe("the reset tombstone", () => {
  test("cleared after its last edit reads as cleared", () => {
    expect(isAlignmentCleared({ ...align({}), updatedAt: 10, clearedAt: 20 })).toBe(true);
  });
  test("edited after being cleared is live again", () => {
    expect(isAlignmentCleared({ ...align({}), updatedAt: 30, clearedAt: 20 })).toBe(false);
  });
  test("never cleared is live", () => {
    expect(isAlignmentCleared(align({}))).toBe(false);
  });
});
