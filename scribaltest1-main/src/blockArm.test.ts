// The block-style arming rule: selection converts, an armed empty line
// converts in place, and text already typed is never restyled by a collapsed
// caret — the "everything I previously typed becomes a heading" bug.
import { blockArmAction } from "./blockArm";

test("a selection converts what was selected", () => {
  expect(blockArmAction(false, false)).toBe("convert-selection");
  expect(blockArmAction(false, true)).toBe("convert-selection");
});

test("arming on an empty line styles what is typed next, in place", () => {
  expect(blockArmAction(true, true)).toBe("convert-in-place");
});

test("arming mid-text NEVER restyles what was already typed", () => {
  expect(blockArmAction(true, false)).toBe("new-block-after");
});
