// Rich-text DOM operations that do NOT rely on document.execCommand (which is
// deprecated and unreliable/absent in modern engines). Every function operates
// on the live Selection within a given editor root. Pure DOM + Range.

export function currentSelectionInside(root: HTMLElement): Range | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  return range;
}

function setCaretAfter(node: Node) {
  const sel = window.getSelection();
  if (!sel) return;
  const r = document.createRange();
  r.setStartAfter(node);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

// Wrap the current (non-collapsed) selection in a span carrying one inline style.
export function applyInlineStyle(
  root: HTMLElement,
  prop: "fontWeight" | "fontStyle" | "textDecoration" | "color" | "backgroundColor",
  value: string,
  range: Range
) {
  if (range.collapsed) return;
  const span = document.createElement("span");
  (span.style as any)[prop] = value;
  try {
    span.appendChild(range.extractContents());
    range.insertNode(span);
    // unwrap redundant nested spans of the same prop inside
    span.querySelectorAll("span").forEach((inner) => {
      if ((inner.style as any)[prop]) (inner.style as any)[prop] = "";
      if (!inner.getAttribute("style")) {
        const p = inner.parentNode!;
        while (inner.firstChild) p.insertBefore(inner.firstChild, inner);
        p.removeChild(inner);
      }
    });
    setCaretAfter(span);
  } catch {
    /* selection spans block boundaries — skip */
  }
}

// Toggle a boolean inline style (bold/italic/underline) on the selection.
export function toggleInline(
  root: HTMLElement,
  kind: "bold" | "italic" | "underline",
  range: Range
) {
  const map = {
    bold: ["fontWeight", "700", "400"],
    italic: ["fontStyle", "italic", "normal"],
    underline: ["textDecoration", "underline", "none"],
  } as const;
  const [prop, on] = map[kind];
  // is the selection already styled? check the common ancestor chain
  let node: HTMLElement | null =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : (range.startContainer as HTMLElement);
  let already = false;
  while (node && node !== root) {
    const v = (node.style as any)?.[prop];
    if (v && v.toString().includes(on.replace("700", "bold"))) already = true;
    if (prop === "fontWeight" && (v === "700" || v === "bold")) already = true;
    if (prop === "fontStyle" && v === "italic") already = true;
    if (prop === "textDecoration" && v && v.includes("underline")) already = true;
    node = node.parentElement;
  }
  if (already) {
    // strip: re-wrap with the "off" value
    applyInlineStyle(root, prop as any, map[kind][2], range);
  } else {
    applyInlineStyle(root, prop as any, on as string, range);
  }
}

// Change the block element the caret is in (p / h1 / h2 / blockquote).
export function setBlockTag(root: HTMLElement, tag: string, range: Range) {
  let node: Node | null = range.startContainer;
  // find the nearest block-level ancestor within root
  const blockTags = new Set(["P", "H1", "H2", "H3", "BLOCKQUOTE", "DIV", "LI"]);
  let block: HTMLElement | null = null;
  let n: HTMLElement | null =
    node.nodeType === Node.TEXT_NODE
      ? (node.parentElement as HTMLElement)
      : (node as HTMLElement);
  while (n && n !== root) {
    if (blockTags.has(n.tagName)) {
      block = n;
      break;
    }
    n = n.parentElement;
  }
  const newEl = document.createElement(tag);
  if (block) {
    while (block.firstChild) newEl.appendChild(block.firstChild);
    block.parentNode!.replaceChild(newEl, block);
  } else {
    // no block wrapper — wrap the whole root's direct content selection
    newEl.appendChild(range.extractContents());
    range.insertNode(newEl);
  }
  // caret into the new block
  const sel = window.getSelection();
  if (sel) {
    const r = document.createRange();
    r.selectNodeContents(newEl);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
}

// Wrap the caret's block(s) into a list (ol / ul), or a checklist ul.
export function makeList(
  root: HTMLElement,
  kind: "ol" | "ul" | "checklist",
  range: Range
) {
  let n: HTMLElement | null =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : (range.startContainer as HTMLElement);
  let block: HTMLElement | null = null;
  while (n && n !== root) {
    if (["P", "H1", "H2", "DIV", "BLOCKQUOTE"].includes(n.tagName)) {
      block = n;
      break;
    }
    n = n.parentElement;
  }
  const list = document.createElement(kind === "checklist" ? "ul" : kind);
  if (kind === "checklist") list.setAttribute("data-checklist", "1");
  const li = document.createElement("li");
  if (block) {
    while (block.firstChild) li.appendChild(block.firstChild);
    list.appendChild(li);
    block.parentNode!.replaceChild(list, block);
  } else {
    li.appendChild(range.extractContents());
    if (!li.firstChild) li.appendChild(document.createElement("br"));
    list.appendChild(li);
    range.insertNode(list);
  }
  const sel = window.getSelection();
  if (sel) {
    const r = document.createRange();
    r.selectNodeContents(li);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
}

// Insert a divider followed by an empty paragraph (so it's deletable).
export function insertDividerNode(root: HTMLElement, range: Range) {
  range.deleteContents();
  const hr = document.createElement("hr");
  const p = document.createElement("p");
  p.appendChild(document.createElement("br"));
  range.insertNode(p);
  range.insertNode(hr);
  const sel = window.getSelection();
  if (sel) {
    const r = document.createRange();
    r.setStart(p, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }
}

// Insert a non-editable verse chip at the caret.
export function insertChip(root: HTMLElement, ref: string, range: Range) {
  const chip = document.createElement("span");
  chip.setAttribute("data-ref", ref);
  chip.setAttribute("contenteditable", "false");
  chip.className = "scribal-vchip";
  chip.style.color = "#8b5cf6";
  chip.style.fontWeight = "600";
  chip.textContent = "\u2937\u00a0" + ref;
  range.deleteContents();
  const space = document.createTextNode("\u00a0");
  range.insertNode(space);
  range.insertNode(chip);
  setCaretAfter(space);
}

// Strip all inline formatting + lift block to plain paragraph, for the whole
// block containing the caret.
export function clearBlockFormatting(root: HTMLElement, range: Range) {
  let n: HTMLElement | null =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : (range.startContainer as HTMLElement);
  let block: HTMLElement | null = null;
  while (n && n !== root) {
    if (["P", "H1", "H2", "H3", "BLOCKQUOTE", "LI", "DIV"].includes(n.tagName)) {
      block = n;
    }
    n = n.parentElement;
  }
  const target = block || root;
  const text = target.textContent || "";
  const p = document.createElement("p");
  p.textContent = text;
  if (target === root) {
    root.innerHTML = "";
    root.appendChild(p);
  } else {
    target.parentNode!.replaceChild(p, target);
  }
  const sel = window.getSelection();
  if (sel) {
    const r = document.createRange();
    r.selectNodeContents(p);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
}

// Indent the caret's block by bumping padding-left.
export function indentBlock(root: HTMLElement, range: Range) {
  let n: HTMLElement | null =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : (range.startContainer as HTMLElement);
  let block: HTMLElement | null = null;
  while (n && n !== root) {
    if (["P", "H1", "H2", "BLOCKQUOTE", "LI", "DIV"].includes(n.tagName)) {
      block = n;
      break;
    }
    n = n.parentElement;
  }
  const target = block;
  if (!target) return;
  const cur = parseInt(target.style.paddingLeft || "0", 10) || 0;
  target.style.paddingLeft = Math.min(cur + 24, 120) + "px";
}

// Set text-align on the caret's block.
export function alignBlock(
  root: HTMLElement,
  how: "left" | "center" | "right",
  range: Range
) {
  let n: HTMLElement | null =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : (range.startContainer as HTMLElement);
  let block: HTMLElement | null = null;
  while (n && n !== root) {
    if (["P", "H1", "H2", "BLOCKQUOTE", "LI", "DIV"].includes(n.tagName)) {
      block = n;
      break;
    }
    n = n.parentElement;
  }
  if (block) block.style.textAlign = how;
}
