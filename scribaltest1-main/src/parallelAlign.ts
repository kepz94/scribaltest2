// The row model for the Parallel compile view.
//
// A column's `slots` array IS the rendered column, top to bottom: each entry is
// either an index into that chapter's verses or `null` for a blank. Row N of the
// board is index N of every column's slots, so two verses "correspond" exactly
// when they sit at the same index in their respective arrays. There is no
// separate row object — the arrays are the geometry.
//
// A PIN marks a verse whose row the reader has decided. Pins are what make this
// usable rather than maddening: without them, nudging a verse pushes everything
// below it, so fixing an alignment near the end of a chapter silently undoes the
// work done near the start. A pin cuts the column into segments, and a nudge is
// only ever allowed to spend slack inside its own segment. When there is no
// slack to spend, the nudge is REFUSED rather than allowed to shove a pin — the
// caller shows why, and nothing moves.
//
// Everything here is pure. No React, no scripture, no notes, no storage.

export interface ParallelColumn {
  id: string; // stable per board, minted from the chapter scope
  chapter: string; // chapter scope, e.g. "Isaiah 51"
}

export interface ParallelAlignment {
  // The study's scope — the same string synthesisKeyForScope takes, so an
  // alignment and a synthesis name the same study.
  scope: string;
  order: string[]; // column ids, left to right
  slots: Record<string, (number | null)[]>;
  pins: Record<string, number[]>;
  updatedAt: number;
  // Reset tombstone. clearAlignment stamps this instead of deleting the entry:
  // a deleted entry is simply re-adopted from whichever device still holds a
  // copy, and the reset silently un-happens. Same failure shape as SCR-68 and
  // SCR-83. An alignment counts as cleared while this is its newest action,
  // which also means a later edit revives it — the rule isTableDeleted uses.
  clearedAt?: number;
}

export const isAlignmentCleared = (a: ParallelAlignment): boolean =>
  !!a.clearedAt && a.clearedAt >= (a.updatedAt || 0);

export type Slots = (number | null)[];

// ── reading the model ────────────────────────────────────────────────────────

export function lockstepSlots(verseCount: number): number[] {
  const n = Math.max(0, Math.floor(verseCount) || 0);
  return Array.from({ length: n }, (_, i) => i);
}

// An alignment that has never heard of this column — including no alignment at
// all — means lockstep. Storing nothing is the common case and must be free.
export function slotsFor(
  a: ParallelAlignment | undefined,
  colId: string,
  verseCount: number
): Slots {
  const stored = a && a.slots ? a.slots[colId] : undefined;
  return Array.isArray(stored) ? stored : lockstepSlots(verseCount);
}

export function rowCount(
  a: ParallelAlignment | undefined,
  cols: { id: string; verseCount: number }[]
): number {
  let max = 1;
  cols.forEach((c) => {
    const len = slotsFor(a, c.id, c.verseCount).length;
    if (len > max) max = len;
  });
  return max;
}

export function rowOfVerse(slots: Slots, verseIndex: number): number {
  return slots.indexOf(verseIndex);
}

// ── segment boundaries ───────────────────────────────────────────────────────
// A pin is a wall. These find the nearest wall in each direction, and the slack
// (a blank) available before reaching it.

const pinIndexAtOrAfter = (slots: Slots, pins: number[], from: number): number => {
  for (let i = Math.max(0, from); i < slots.length; i++) {
    const v = slots[i];
    if (v != null && pins.indexOf(v) !== -1) return i;
  }
  return slots.length;
};

const pinIndexAtOrBefore = (slots: Slots, pins: number[], from: number): number => {
  for (let i = Math.min(slots.length - 1, from); i >= 0; i--) {
    const v = slots[i];
    if (v != null && pins.indexOf(v) !== -1) return i;
  }
  return -1;
};

const gapForward = (slots: Slots, from: number, to: number): number => {
  for (let i = Math.max(0, from); i < Math.min(to, slots.length); i++)
    if (slots[i] === null) return i;
  return -1;
};

const gapBackward = (slots: Slots, from: number, to: number): number => {
  for (let i = Math.min(from, slots.length - 1); i > to; i--)
    if (slots[i] === null) return i;
  return -1;
};

// ── editing the model ────────────────────────────────────────────────────────

// Put `verseIndex` on `targetRow`. Moving down inserts blanks above it; moving
// up reclaims them. A move it cannot complete is REPORTED as a shortfall with
// the slots untouched, never silently rounded to some other row — a comparison
// that quietly lands on the wrong row is worse than one that refuses.
export function snapTo(
  slots: Slots,
  verseIndex: number,
  targetRow: number
): { slots: Slots; shortfall: number } {
  const at = slots.indexOf(verseIndex);
  if (at < 0) return { slots, shortfall: 0 };
  const delta = targetRow - at;
  if (delta === 0) return { slots, shortfall: 0 };

  if (delta > 0) {
    const next = slots.slice();
    for (let k = 0; k < delta; k++) next.splice(at, 0, null);
    return { slots: next, shortfall: 0 };
  }

  // Moving up: only blanks above the verse can be reclaimed.
  let available = 0;
  for (let i = at - 1; i >= 0; i--) if (slots[i] === null) available++;
  const need = -delta;
  if (available < need) return { slots, shortfall: need - available };

  const next = slots.slice();
  let removed = 0;
  for (let i = next.indexOf(verseIndex) - 1; i >= 0 && removed < need; i--) {
    if (next[i] === null) {
      next.splice(i, 1);
      removed++;
    }
  }
  return { slots: next, shortfall: 0 };
}

// Move one verse one row, without moving any pinned verse.
//
// Down: insert a blank above the verse, then pay for it by reclaiming a blank
// before the next pin below. No pin below means nothing to pay for and the
// column simply grows. A pin below with no blank to reclaim means refusal.
// Up is the mirror image.
export function nudge(
  slots: Slots,
  pins: number[],
  verseIndex: number,
  dir: 1 | -1
): { slots: Slots; blocked: boolean } {
  const at = slots.indexOf(verseIndex);
  if (at < 0) return { slots, blocked: true };

  if (dir === 1) {
    const next = slots.slice();
    next.splice(at, 0, null);
    // The verse now sits at `at + 1`; look past it for the wall.
    const wall = pinIndexAtOrAfter(next, pins, at + 2);
    if (wall < next.length) {
      const slack = gapForward(next, at + 2, wall);
      if (slack < 0) return { slots, blocked: true };
      next.splice(slack, 1);
    }
    return { slots: next, blocked: false };
  }

  const floor = pinIndexAtOrBefore(slots, pins, at - 1);
  const slack = gapBackward(slots, at - 1, floor);
  if (slack < 0) return { slots, blocked: true };
  const next = slots.slice();
  next.splice(slack, 1);
  // The verse has moved up to `at - 1`; anything pinned below it must stay put.
  const wall = pinIndexAtOrAfter(next, pins, at);
  if (wall < next.length) next.splice(wall, 0, null);
  return { slots: next, blocked: false };
}

// Say that two verses correspond: put them on the same row. The lower of the
// two rows wins, so both moves are downward and neither can fail against a pin
// above. This is the verb the whole view is built around — one act instead of
// N nudges, and it is what makes Isaiah 52:1 reach row 23 in two clicks.
export function pairRows(
  aSlots: Slots,
  aVerse: number,
  bSlots: Slots,
  bVerse: number
): { aSlots: Slots; bSlots: Slots; row: number; shortfall: number } {
  const ra = aSlots.indexOf(aVerse);
  const rb = bSlots.indexOf(bVerse);
  if (ra < 0 || rb < 0) return { aSlots, bSlots, row: Math.max(ra, rb), shortfall: 0 };
  const row = Math.max(ra, rb);
  const a = snapTo(aSlots, aVerse, row);
  const b = snapTo(bSlots, bVerse, row);
  return {
    aSlots: a.slots,
    bSlots: b.slots,
    row,
    shortfall: a.shortfall + b.shortfall,
  };
}
