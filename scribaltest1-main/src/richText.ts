// Turning a rich note into plain text for surfaces that cannot render HTML —
// the canvas cards and the PDF built from them.
//
// This existed as three byte-identical private copies (ShareVerses twice,
// MobileCompile once) that all did the same lossy thing: replace a few closing
// tags with newlines and take textContent. That loses list markers, and callers
// then wrapped the result with a whitespace splitter that discarded the newlines
// too — so a synthesis with headings, paragraphs and bullets arrived on a card
// as one undifferentiated run of prose.

// A newline, not an exotic sentinel: anything set via innerHTML goes through the
// HTML parser, and a control character like U+0000 is dropped there — the
// paragraphs then run together with nothing between them.
const SEP = "\n";

// Paragraphs, in order, with list items marked. Blank entries are dropped, so
// the caller can join them or lay them out however it likes.
export function richToParagraphs(raw: string): string[] {
  const v = raw || "";
  if (!v.trim()) return [];
  if (!/<[a-z]/i.test(v)) {
    return v
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const el = document.createElement("div");
  el.innerHTML = v
    // A bullet is content, not decoration — a bare line break leaves the reader
    // guessing why a line is short.
    .replace(/<li[^>]*>/gi, SEP + "• ")
    .replace(/<\/(p|li|h1|h2|h3|h4|h5|h6|blockquote|div)\s*>/gi, SEP)
    .replace(/<br\s*\/?>/gi, SEP);
  return (el.textContent || "")
    .replace(/\u00a0/g, " ")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// The same content as one string, paragraphs separated by newlines. Surfaces
// that lay text out themselves should prefer richToParagraphs, so they can space
// the paragraphs instead of running them together.
export function richToText(raw: string): string {
  return richToParagraphs(raw).join("\n");
}
