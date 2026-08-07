// What a block-style button (Heading, Quote, Normal text) does when pressed —
// the professional-editor rule, stated by Kepu (Aug 7 2026): "when you arm
// anything at all it only applies to the next things you're about to type OR
// something you've already selected."
//
// It used to $setBlocksType unconditionally, and with a collapsed caret Lexical
// converts the ENTIRE block the caret sits in. A synthesis typed as one
// paragraph became a heading wholesale the moment Heading was pressed, and the
// only way to stop the spread was inserting a divider to break the block. A
// linked verse's block suffered the same conversion.
//
// Three cases, decided here so the rule is testable without a Lexical tree:
//   selection  → convert what was selected (the blocks it touches)
//   caret on an EMPTY block → convert that block in place, so what is typed
//     next lands in the armed style ("applies to the next things")
//   caret on a block WITH content → leave it alone; start a NEW block of the
//     armed style after it and move the caret there
export type BlockArmAction = "convert-selection" | "convert-in-place" | "new-block-after";

export function blockArmAction(
  isCollapsed: boolean,
  blockIsEmpty: boolean
): BlockArmAction {
  if (!isCollapsed) return "convert-selection";
  return blockIsEmpty ? "convert-in-place" : "new-block-after";
}
