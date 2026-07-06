// Lexical ships modern "exports" maps that TypeScript 4.4.4 can't resolve, so
// it serves a "typescript-too-old" stub that exports nothing. The runtime code
// is fine; only compile-time types are blocked. These ambient declarations let
// the app compile against Lexical without upgrading TypeScript across the whole
// codebase. Types are intentionally loose (any) — the library is exercised at
// runtime and covered by the app's own tests.

declare module "lexical" {
  export const $getSelection: any;
  export const $isRangeSelection: any;
  export const $getRoot: any;
  export const $createParagraphNode: any;
  export const $createTextNode: any;
  export const FORMAT_TEXT_COMMAND: any;
  export const FORMAT_ELEMENT_COMMAND: any;
  export const INDENT_CONTENT_COMMAND: any;
  export const OUTDENT_CONTENT_COMMAND: any;
  export const ElementNode: any;
  export const TextNode: any;
  const _default: any;
  export default _default;
  export = _default;
}
declare module "@lexical/react/LexicalComposer" {
  export const LexicalComposer: any;
}
declare module "@lexical/react/LexicalRichTextPlugin" {
  export const RichTextPlugin: any;
}
declare module "@lexical/react/LexicalContentEditable" {
  export const ContentEditable: any;
}
declare module "@lexical/react/LexicalHistoryPlugin" {
  export const HistoryPlugin: any;
}
declare module "@lexical/react/LexicalErrorBoundary" {
  export const LexicalErrorBoundary: any;
  const _default: any;
  export default _default;
}
declare module "@lexical/react/LexicalListPlugin" {
  export const ListPlugin: any;
}
declare module "@lexical/react/LexicalCheckListPlugin" {
  export const CheckListPlugin: any;
}
declare module "@lexical/react/LexicalTabIndentationPlugin" {
  export const TabIndentationPlugin: any;
}
declare module "@lexical/react/LexicalHorizontalRuleNode" {
  export const HorizontalRuleNode: any;
  export const INSERT_HORIZONTAL_RULE_COMMAND: any;
}
declare module "@lexical/react/LexicalComposerContext" {
  export const useLexicalComposerContext: any;
}
declare module "@lexical/react/LexicalOnChangePlugin" {
  export const OnChangePlugin: any;
}
declare module "@lexical/rich-text" {
  export const HeadingNode: any;
  export const QuoteNode: any;
  export const $createHeadingNode: any;
  export const $createQuoteNode: any;
}
declare module "@lexical/list" {
  export const ListNode: any;
  export const ListItemNode: any;
  export const INSERT_ORDERED_LIST_COMMAND: any;
  export const INSERT_UNORDERED_LIST_COMMAND: any;
  export const INSERT_CHECK_LIST_COMMAND: any;
  export const $isListNode: any;
}
declare module "@lexical/selection" {
  export const $setBlocksType: any;
  export const $patchStyleText: any;
  export const $getSelectionStyleValueForProperty: any;
}
declare module "@lexical/html" {
  export const $generateHtmlFromNodes: any;
  export const $generateNodesFromDOM: any;
}
declare module "@lexical/utils" {
  const _default: any;
  export default _default;
}
