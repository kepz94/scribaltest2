// Reading a rich note back out, for surfaces that cannot render HTML — the
// canvas cards and the PDF built from them.
//
// This existed as three byte-identical private copies (ShareVerses twice,
// MobileCompile once) that all did the same lossy thing: replace a few closing
// tags with newlines and take textContent. That loses list markers, and callers
// then wrapped the result with a whitespace splitter that discarded the newlines
// too — so a synthesis with headings, paragraphs and bullets arrived on a card
// as one undifferentiated run of prose.
//
// richToBlocks goes further: it keeps what the reader actually built. A
// synthesis is organized — headings, dividers, numbered steps, an emphasized
// clause — and that organization IS the argument. Flattening it to paragraphs
// and setting the whole thing in italic loses the shape it was written in.
// richToParagraphs still exists, built on the same walk, for the short notes
// that only ever wanted lines of text.

export interface RichRun {
  text: string;
  b?: boolean; // bold
  i?: boolean; // italic
  u?: boolean; // underline
  chip?: "verse"; // a linked verse reference, drawn in the accent
}

export type RichBlockKind =
  | "h1"
  | "h2"
  | "p"
  | "quote"
  | "li"
  | "def" // a linked definition — its own card, as the note editor draws it
  | "vcard" // a linked verse — its own card, in the verse accent
  | "rule"; // a divider

export interface RichBlock {
  kind: RichBlockKind;
  runs: RichRun[];
  marker?: string; // "•", "3.", "✓" — what precedes a list item
  depth?: number; // nesting level for lists, 0 at the top
}

interface Fmt {
  b?: boolean;
  i?: boolean;
  u?: boolean;
}

const BULLET = "•";
const CHECKED = "✓";
const UNCHECKED = "□";
const NBSP = / /g;

function classOf(el: Element): string {
  return ((el as HTMLElement).className || "").toString();
}
function hasClass(el: Element, c: string): boolean {
  return classOf(el).split(/\s+/).indexOf(c) >= 0;
}
function styleOf(el: Element): CSSStyleDeclaration | null {
  return (el as HTMLElement).style || null;
}
function isBoldEl(el: Element): boolean {
  if (el.tagName === "B" || el.tagName === "STRONG") return true;
  const s = styleOf(el);
  const w = s ? s.fontWeight : "";
  if (w === "bold" || (w && parseInt(w, 10) >= 600)) return true;
  return classOf(el).indexOf("rt-bold") >= 0;
}
function isItalicEl(el: Element): boolean {
  if (el.tagName === "I" || el.tagName === "EM") return true;
  const s = styleOf(el);
  if (s && s.fontStyle === "italic") return true;
  return classOf(el).indexOf("rt-italic") >= 0;
}
function isUnderlineEl(el: Element): boolean {
  if (el.tagName === "U") return true;
  const s = styleOf(el);
  if (s && s.textDecoration && s.textDecoration.indexOf("underline") >= 0)
    return true;
  return classOf(el).indexOf("rt-underline") >= 0;
}

// Collect the inline content of one block into runs, merging adjacent runs that
// share formatting so the layout has as few pieces as possible to measure.
// `onDefChip` fires when a definition or verse card is met mid-paragraph: it is
// a block in its own right (the note editor draws it as one), so the caller
// flushes what it has and starts fresh after it.
function collectRuns(
  el: Node,
  fmt: Fmt,
  out: RichRun[],
  onDefChip: (runs: RichRun[], kind: RichBlockKind) => void
): void {
  const kids = Array.prototype.slice.call(el.childNodes) as Node[];
  kids.forEach((n) => {
    if (n.nodeType === 3) {
      const t = (n.nodeValue || "").replace(NBSP, " ");
      if (!t) return;
      const last = out[out.length - 1];
      if (
        last &&
        !last.chip &&
        !!last.b === !!fmt.b &&
        !!last.i === !!fmt.i &&
        !!last.u === !!fmt.u
      ) {
        last.text += t;
      } else {
        out.push({ text: t, b: fmt.b, i: fmt.i, u: fmt.u });
      }
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    if (e.tagName === "BR") {
      out.push({ text: " " });
      return;
    }
    // A linked definition or verse is a card, not a phrase — it interrupts
    // the prose and stands on its own.
    if (
      e.tagName === "SPAN" &&
      (hasClass(e, "scribal-dchip") || hasClass(e, "scribal-vcard"))
    ) {
      const t = (e.textContent || "").replace(NBSP, " ").trim();
      if (t)
        onDefChip(
          [{ text: t }],
          hasClass(e, "scribal-vcard") ? "vcard" : "def"
        );
      return;
    }
    const next: Fmt = {
      b: fmt.b || isBoldEl(e),
      i: fmt.i || isItalicEl(e),
      u: fmt.u || isUnderlineEl(e),
    };
    if (e.tagName === "SPAN" && hasClass(e, "scribal-vchip")) {
      out.push({
        text: (e.textContent || "").replace(NBSP, " "),
        chip: "verse",
        b: next.b,
        i: next.i,
        u: next.u,
      });
      return;
    }
    collectRuns(e, next, out, onDefChip);
  });
}

function trimRuns(runs: RichRun[]): RichRun[] {
  const out = runs.map((r) => ({ ...r }));
  while (out.length && !out[0].text.trim()) out.shift();
  while (out.length && !out[out.length - 1].text.trim()) out.pop();
  if (out.length) {
    out[0].text = out[0].text.replace(/^\s+/, "");
    out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, "");
  }
  return out.filter((r) => r.text);
}

const HEADING = /^H[1-6]$/;
const CONTAINER = /^(P|DIV|UL|OL|BLOCKQUOTE|HR|SECTION|ARTICLE)$/;

function walkBlocks(parent: Node, out: RichBlock[], depth: number): void {
  // Inline content that sits in no block tag still belongs to a paragraph — a
  // note can be saved as bare text with a <b> in the middle of it.
  let loose: RichRun[] = [];
  const flushLoose = () => {
    const t = trimRuns(loose);
    if (t.length) out.push({ kind: "p", runs: t });
    loose = [];
  };
  const blockOf = (
    el: Node,
    kind: RichBlockKind,
    extra?: { marker?: string; depth?: number }
  ) => {
    const runs: RichRun[] = [];
    const emit = () => {
      const t = trimRuns(runs);
      if (t.length) out.push({ kind, runs: t, ...(extra || {}) });
      runs.length = 0;
    };
    collectRuns(el, {}, runs, (cardRuns, cardKind) => {
      emit();
      out.push({ kind: cardKind, runs: cardRuns });
    });
    emit();
  };

  const kids = Array.prototype.slice.call(parent.childNodes) as Node[];
  kids.forEach((n) => {
    if (n.nodeType === 3) {
      const t = (n.nodeValue || "").replace(NBSP, " ");
      if (t.trim()) loose.push({ text: t });
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    const tag = e.tagName;

    if (tag === "HR") {
      flushLoose();
      out.push({ kind: "rule", runs: [] });
      return;
    }
    if (HEADING.test(tag)) {
      flushLoose();
      blockOf(e, tag === "H1" ? "h1" : "h2");
      return;
    }
    if (tag === "BLOCKQUOTE") {
      flushLoose();
      blockOf(e, "quote");
      return;
    }
    if (tag === "UL" || tag === "OL") {
      flushLoose();
      const ordered = tag === "OL";
      let auto = 0;
      const items = Array.prototype.slice.call(e.children) as Element[];
      items.forEach((li) => {
        if (li.tagName !== "LI") return;
        auto += 1;
        const checked = li.getAttribute("aria-checked");
        const isCheck =
          checked !== null || li.getAttribute("role") === "checkbox";
        const value = parseInt(li.getAttribute("value") || "", 10);
        const marker = isCheck
          ? checked === "true"
            ? CHECKED
            : UNCHECKED
          : ordered
          ? (isNaN(value) ? auto : value) + "."
          : BULLET;
        // A list item's own text first, then any list nested inside it — so a
        // sub-list lands under its parent rather than before it.
        const shallow = document.createElement("div");
        const nested: Element[] = [];
        (Array.prototype.slice.call(li.childNodes) as Node[]).forEach((k) => {
          const kt = k.nodeType === 1 ? (k as Element).tagName : "";
          if (kt === "UL" || kt === "OL") nested.push(k as Element);
          else shallow.appendChild(k.cloneNode(true));
        });
        blockOf(shallow, "li", { marker, depth });
        nested.forEach((sub) => {
          const holder = document.createElement("div");
          holder.appendChild(sub.cloneNode(true));
          walkBlocks(holder, out, depth + 1);
        });
      });
      return;
    }
    if (tag === "P" || tag === "DIV" || tag === "SECTION" || tag === "ARTICLE") {
      flushLoose();
      // A wrapper holding blocks is a container, not a paragraph.
      const hasBlockKid = (Array.prototype.slice.call(e.children) as Element[]).some(
        (c) => CONTAINER.test(c.tagName) || HEADING.test(c.tagName)
      );
      if (hasBlockKid) walkBlocks(e, out, depth);
      else blockOf(e, "p");
      return;
    }
    if (
      tag === "SPAN" &&
      (hasClass(e, "scribal-dchip") || hasClass(e, "scribal-vcard"))
    ) {
      flushLoose();
      const t = (e.textContent || "").replace(NBSP, " ").trim();
      if (t)
        out.push({
          kind: hasClass(e, "scribal-vcard") ? "vcard" : "def",
          runs: [{ text: t }],
        });
      return;
    }
    // Anything else inline at this level joins the running paragraph.
    collectRuns(
      e,
      { b: isBoldEl(e), i: isItalicEl(e), u: isUnderlineEl(e) },
      loose,
      (cardRuns, cardKind) => {
        flushLoose();
        out.push({ kind: cardKind, runs: cardRuns });
      }
    );
  });
  flushLoose();
}

// The note as the reader built it: headings, paragraphs, quotes, list items,
// dividers and definition cards, in order.
export function richToBlocks(raw: string): RichBlock[] {
  const v = raw || "";
  if (!v.trim()) return [];
  if (!/<[a-z]/i.test(v)) {
    return v
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((t) => ({ kind: "p" as RichBlockKind, runs: [{ text: t }] }));
  }
  const host = document.createElement("div");
  host.innerHTML = v;
  const out: RichBlock[] = [];
  walkBlocks(host, out, 0);
  // A rule stays though it has no text; everything else must say something.
  return out.filter((b) => b.kind === "rule" || b.runs.length > 0);
}

export function blockText(b: RichBlock): string {
  return b.runs
    .map((r) => r.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

// Paragraphs, in order, with list items marked. Blank entries are dropped, so
// the caller can join them or lay them out however it likes. A divider carries
// no text, so it does not appear here — surfaces that want it use richToBlocks.
export function richToParagraphs(raw: string): string[] {
  return richToBlocks(raw)
    .filter((b) => b.kind !== "rule")
    .map((b) => {
      const t = blockText(b);
      if (!t) return "";
      return b.kind === "li" && b.marker ? b.marker + " " + t : t;
    })
    .filter(Boolean);
}

// The same content as one string, paragraphs separated by newlines. Surfaces
// that lay text out themselves should prefer richToParagraphs, so they can space
// the paragraphs instead of running them together.
export function richToText(raw: string): string {
  return richToParagraphs(raw).join("\n");
}
