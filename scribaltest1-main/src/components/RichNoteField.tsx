import { useState, useRef, useEffect, useCallback } from "react";
import { Mark, MarkColor, COLOR_MAP } from "../types";

// ── icon toolbar building blocks ──
const IcoBtn = ({
  title,
  onClick,
  active,
  children,
  wide,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  wide?: boolean;
}) => (
  <button
    title={title}
    aria-label={title}
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
    style={{
      height: "32px",
      minWidth: wide ? undefined : "32px",
      padding: wide ? "0 9px" : 0,
      border: "none",
      background: active ? "rgba(139,92,246,.20)" : "transparent",
      color: active ? "#b79df5" : "var(--text)",
      borderRadius: "6px",
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "6px",
      fontFamily: "system-ui, sans-serif",
      fontSize: "12.5px",
      fontWeight: 600,
    }}
  >
    {children}
  </button>
);
const Divider = () => (
  <span
    style={{
      width: "1px",
      height: "20px",
      background: "var(--border)",
      margin: "0 5px",
      flexShrink: 0,
    }}
  />
);
const barStroke = "currentColor";
const I = {
  bold: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M7 5h6.5a3.5 3.5 0 0 1 0 7H7zM7 12h7.5a3.5 3.5 0 0 1 0 7H7z" stroke={barStroke} strokeWidth="2" strokeLinejoin="round"/></svg>
  ),
  italic: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M15 5h-5M14 19H9M14 5l-4 14" stroke={barStroke} strokeWidth="2" strokeLinecap="round"/></svg>
  ),
  underline: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M7 5v6a5 5 0 0 0 10 0V5M6 21h12" stroke={barStroke} strokeWidth="2" strokeLinecap="round"/></svg>
  ),
  ol: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M10 6h10M10 12h10M10 18h10" stroke={barStroke} strokeWidth="2" strokeLinecap="round"/><text x="3" y="8" fontSize="7" fill={barStroke} fontFamily="system-ui">1</text><text x="3" y="14" fontSize="7" fill={barStroke} fontFamily="system-ui">2</text><text x="3" y="20" fontSize="7" fill={barStroke} fontFamily="system-ui">3</text></svg>
  ),
  ul: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 6h11M9 12h11M9 18h11" stroke={barStroke} strokeWidth="2" strokeLinecap="round"/><circle cx="4" cy="6" r="1.4" fill={barStroke}/><circle cx="4" cy="12" r="1.4" fill={barStroke}/><circle cx="4" cy="18" r="1.4" fill={barStroke}/></svg>
  ),
  check: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="7" height="7" rx="1.5" stroke={barStroke} strokeWidth="1.8"/><path d="M4.5 7.5 6 9l2.5-3" stroke={barStroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><rect x="3" y="14" width="7" height="7" rx="1.5" stroke={barStroke} strokeWidth="1.8"/><path d="M13 7h8M13 17h8" stroke={barStroke} strokeWidth="2" strokeLinecap="round"/></svg>
  ),
  indent: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M10 12h10M10 18h10M4 10v4l3-2z" stroke={barStroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
  ),
  alignLeft: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h10M4 18h13" stroke={barStroke} strokeWidth="2" strokeLinecap="round"/></svg>
  ),
  alignCenter: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M7 12h10M6 18h12" stroke={barStroke} strokeWidth="2" strokeLinecap="round"/></svg>
  ),
  quote: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M7 7c-2 .5-3 2-3 4v3h4v-4H5.5C5.5 8.5 6.2 8 7.5 7.7zM17 7c-2 .5-3 2-3 4v3h4v-4h-2.5C15.5 8.5 16.2 8 17.5 7.7z" fill={barStroke}/></svg>
  ),
  divider: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 12h16" stroke={barStroke} strokeWidth="2" strokeLinecap="round"/></svg>
  ),
  link: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M10 14a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 0 0-5.66-5.66L11 7M14 10a4 4 0 0 0-5.66 0l-2.83 2.83a4 4 0 0 0 5.66 5.66L13 17" stroke={barStroke} strokeWidth="1.9" strokeLinecap="round"/></svg>
  ),
  clear: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M6 5h13M9 5l-1.5 9M13 5l-.5 3M5 21l14-14" stroke={barStroke} strokeWidth="1.9" strokeLinecap="round"/></svg>
  ),
};


// ── RichNoteField ─────────────────────────────────────────────────────────────
// The desktop Outline note editor. Stores a note as an HTML string (same
// notes[key] slot as before — a plain-text note is just HTML with no tags, so
// old notes and sync are untouched). The toolbar lives INSIDE the box and only
// shows while editing; a resting note renders the formatted HTML with an Edit
// button, exactly like the plain NoteField it replaces.
//
// Formatting is done with document.execCommand — deprecated but universally
// supported, zero-dependency, and perfectly adequate for a note editor. Output
// is sanitized on the way in (paste) and on the way out (render) so a note can
// only ever contain the formatting tags we allow.

export interface LinkableVerse {
  reference: string;
  text: string;
  color: MarkColor | null; // dominant theme color, for the picker grouping
  themeName: string;
}

interface Props {
  value: string;
  onChange: (html: string) => void;
  accent: string;
  placeholder?: string;
  addLabel?: string;
  // Verses available to link (the current study's verses, grouped by theme).
  linkableVerses?: LinkableVerse[];
  // Full marked-fragment lookup for a reference, for the chip's "Focused" mode.
  focusedFor?: (reference: string) => string;
  fullTextFor?: (reference: string) => string;
  onJumpToReference?: (reference: string) => void;
}

// Allow-list sanitizer: keep only formatting tags/attributes we emit.
const ALLOWED_TAGS = new Set([
  "B", "STRONG", "I", "EM", "U", "H1", "H2", "P", "DIV", "BR", "SPAN",
  "OL", "UL", "LI", "BLOCKQUOTE", "HR",
]);
function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walk = (node: Node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (!ALLOWED_TAGS.has(el.tagName)) {
          // unwrap disallowed element (keep its text), drop scripts entirely
          if (el.tagName === "SCRIPT" || el.tagName === "STYLE") {
            el.remove();
            continue;
          }
          const parent = el.parentNode!;
          while (el.firstChild) parent.insertBefore(el.firstChild, el);
          parent.removeChild(el);
          continue;
        }
        // strip everything but the attributes we use
        const keepStyle = el.getAttribute("style") || "";
        const keepClass = el.getAttribute("class") || "";
        const keepRef =
          el.tagName === "SPAN" ? el.getAttribute("data-ref") || "" : "";
        const keepChecked =
          el.tagName === "LI" ? el.getAttribute("data-checked") || "" : "";
        const keepChecklist =
          el.tagName === "UL" ? el.getAttribute("data-checklist") || "" : "";
        Array.from(el.attributes).forEach((a) => el.removeAttribute(a.name));
        // re-apply only safe style props (color / background / text-align / padding-left / font-*)
        if (keepStyle) {
          const safe = keepStyle
            .split(";")
            .map((s) => s.trim())
            .filter((s) =>
              /^(color|background-color|text-align|padding-left|font-style|font-weight|text-decoration|font-family)\s*:/i.test(
                s
              )
            )
            .join("; ");
          if (safe) el.setAttribute("style", safe);
        }
        if (keepClass) el.setAttribute("class", keepClass);
        if (keepRef) el.setAttribute("data-ref", keepRef);
        if (keepChecked) el.setAttribute("data-checked", keepChecked);
        if (keepChecklist) el.setAttribute("data-checklist", keepChecklist);
        walk(el);
      } else if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
      }
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

const isPlainText = (v: string) => !/<[a-z][\s\S]*>/i.test(v);
const toDisplayHtml = (v: string) =>
  isPlainText(v)
    ? v
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>")
    : sanitize(v);

export default function RichNoteField({
  value,
  onChange,
  accent,
  placeholder,
  addLabel,
  linkableVerses = [],
  focusedFor,
  fullTextFor,
  onJumpToReference,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [hlOpen, setHlOpen] = useState(false);
  const [openThemes, setOpenThemes] = useState<Record<string, boolean>>({});
  const [linkFilter, setLinkFilter] = useState("");
  const [preview, setPreview] = useState<{ ref: string; focused: boolean } | null>(
    null
  );
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const has = (value || "").trim().length > 0;

  // Seed the editable div once when entering edit mode.
  useEffect(() => {
    if (editing && editorRef.current) {
      editorRef.current.innerHTML = toDisplayHtml(value || "");
      editorRef.current.focus();
    }
    // eslint-disable-next-line
  }, [editing]);

  const commit = () => {
    if (editorRef.current) onChange(sanitize(editorRef.current.innerHTML));
  };

  // Restore the selection we captured before the toolbar stole focus, so every
  // command acts on the text the user had selected.
  const restoreSelection = (): Selection | null => {
    editorRef.current?.focus();
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    return sel;
  };
  const exec = (cmd: string, arg?: string) => {
    restoreSelection();
    document.execCommand(cmd, false, arg);
    commit();
    // re-capture, since the command may have moved the caret
    rememberSelection();
  };
  const rememberSelection = () => {
    const sel = window.getSelection();
    if (
      sel &&
      sel.rangeCount &&
      editorRef.current?.contains(sel.anchorNode)
    ) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };

  // Wrap the current selection in a styled <span> — reliable where
  // execCommand('foreColor'/'hiliteColor') is not. prop is "color" or
  // "backgroundColor".
  const wrapStyle = (prop: "color" | "backgroundColor", value: string) => {
    const sel = restoreSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return; // nothing selected → nothing to color
    const span = document.createElement("span");
    (span.style as any)[prop] = value;
    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
      // place caret after the new span
      sel.removeAllRanges();
      const r = document.createRange();
      r.setStartAfter(span);
      r.collapse(true);
      sel.addRange(r);
      rememberSelection();
    } catch {
      /* cross-block selection — ignore */
    }
    commit();
  };

  const [curBlock, setCurBlock] = useState("p");
  const setBlock = (tag: string) => {
    exec("formatBlock", "<" + tag + ">");
    setCurBlock(tag);
  };
  const syncBlock = () => {
    const sel = window.getSelection();
    let n = sel?.anchorNode as HTMLElement | null;
    while (n && n !== editorRef.current) {
      const tag = (n.tagName || "").toLowerCase();
      if (tag === "h1" || tag === "h2" || tag === "blockquote") {
        setCurBlock(tag);
        return;
      }
      n = n.parentElement;
    }
    setCurBlock("p");
  };
  // Current text color under the caret — drives the swatch indicator.
  const [curColor, setCurColor] = useState<string>(accent);
  const syncColor = () => {
    const sel = window.getSelection();
    let n = sel?.anchorNode as HTMLElement | null;
    if (n && n.nodeType === Node.TEXT_NODE) n = n.parentElement;
    while (n && n !== editorRef.current) {
      const c = (n as HTMLElement).style?.color;
      if (c) {
        setCurColor(c);
        return;
      }
      n = n.parentElement;
    }
    setCurColor("var(--text)");
  };

  const setColor = (c: string) => {
    wrapStyle("color", c);
    setCurColor(c);
    setColorOpen(false);
  };
  const setHighlight = (c: string) => {
    wrapStyle("backgroundColor", c);
    setHlOpen(false);
  };

  // Turn the list containing the caret into a checklist (or back).
  const makeChecklist = () => {
    restoreSelection();
    document.execCommand("insertUnorderedList");
    const sel = window.getSelection();
    let n = sel?.anchorNode as HTMLElement | null;
    if (n && n.nodeType === Node.TEXT_NODE) n = n.parentElement;
    const ul = n?.closest?.("ul");
    if (ul) ul.setAttribute("data-checklist", "1");
    commit();
    rememberSelection();
  };

  // Insert a divider followed by an empty paragraph, so the caret lands BELOW
  // the rule and it can be backspaced away (the "can't delete the line" fix).
  const insertDivider = () => {
    const sel = restoreSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const hr = document.createElement("hr");
    const p = document.createElement("p");
    p.appendChild(document.createElement("br"));
    range.insertNode(p);
    range.insertNode(hr);
    // caret into the new paragraph
    const r = document.createRange();
    r.setStart(p, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    rememberSelection();
    commit();
  };

  // Real "clear formatting": strip inline styling AND lift the block back to a
  // plain paragraph (execCommand('removeFormat') leaves headings/quotes/color).
  const clearFormatting = () => {
    const sel = restoreSelection();
    document.execCommand("removeFormat");
    document.execCommand("formatBlock", false, "<p>");
    // strip lingering color/background spans in the selection's block
    let n = sel?.anchorNode as HTMLElement | null;
    if (n && n.nodeType === Node.TEXT_NODE) n = n.parentElement;
    const block = n?.closest?.("p,h1,h2,blockquote,li,div");
    if (block) {
      block.querySelectorAll("span").forEach((sp) => {
        const parent = sp.parentNode!;
        while (sp.firstChild) parent.insertBefore(sp.firstChild, sp);
        parent.removeChild(sp);
      });
    }
    setCurBlock("p");
    commit();
    rememberSelection();
  };

  const insertVerseChip = (ref: string) => {
    const sel = restoreSelection();
    // A chip is a styled, non-editable span carrying the reference; a trailing
    // space lets you keep typing after it.
    const chip = document.createElement("span");
    chip.setAttribute("data-ref", ref);
    chip.setAttribute("contenteditable", "false");
    chip.className = "scribal-vchip";
    chip.style.color = "#8b5cf6";
    chip.style.fontWeight = "600";
    chip.textContent = "\u2937\u00a0" + ref;
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode("\u00a0"));
      range.insertNode(chip);
      const r = document.createRange();
      r.setStartAfter(chip);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      rememberSelection();
    }
    commit();
    setLinkOpen(false);
    setLinkFilter("");
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
    commit();
  };

  // Clicks on verse chips (in the resting render) open a preview.
  const onRestingClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const chip = target.closest(".scribal-vchip");
      if (chip) {
        const ref = chip.getAttribute("data-ref");
        if (ref) setPreview({ ref, focused: true });
        return;
      }
      // Tap a checklist item to toggle it done (only near the checkbox).
      const li = target.closest("li");
      if (li && li.closest("ul[data-checklist]")) {
        const done = li.getAttribute("data-checked") === "1";
        if (done) li.removeAttribute("data-checked");
        else li.setAttribute("data-checked", "1");
        // persist the toggle
        const host = (e.currentTarget as HTMLElement);
        onChange(sanitize(host.innerHTML));
      }
    },
    // eslint-disable-next-line
    []
  );

  // ── palette (all 10 pen colors + neutral) ──
  const NEUTRAL = "var(--text)";
  const penColors: string[] = [
    NEUTRAL,
    ...Array.from({ length: 10 }, (_, i) => COLOR_MAP[(i + 1) as MarkColor]),
  ];

  const tb: React.CSSProperties = {
    height: "30px",
    minWidth: "30px",
    padding: "0 7px",
    border: "none",
    background: "transparent",
    color: "var(--muted)",
    borderRadius: "6px",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "system-ui, sans-serif",
    gap: "4px",
  };
  const sep = (
    <span
      style={{
        width: "1px",
        height: "18px",
        background: "var(--border)",
        margin: "0 4px",
      }}
    />
  );

  // ── themed verse groups for the link picker ──
  const groups: { name: string; color: MarkColor | null; verses: LinkableVerse[] }[] =
    [];
  linkableVerses.forEach((v) => {
    let g = groups.find((x) => x.name === v.themeName);
    if (!g) {
      g = { name: v.themeName, color: v.color, verses: [] };
      groups.push(g);
    }
    g.verses.push(v);
  });
  const filtered = (vs: LinkableVerse[]) =>
    !linkFilter.trim()
      ? vs
      : vs.filter(
          (v) =>
            v.reference.toLowerCase().includes(linkFilter.toLowerCase()) ||
            v.text.toLowerCase().includes(linkFilter.toLowerCase())
        );



  // ─────────────────────────────── EDITING ────────────────────────────────
  if (editing) {
    return (
      <div
        style={{
          border: "1px solid #8b5cf6",
          borderRadius: "8px",
          overflow: "hidden",
          background: "var(--soft)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "2px",
            padding: "6px 7px",
            borderBottom: "1px solid var(--border)",
            background: "var(--panel)",
            flexWrap: "wrap",
          }}
          onMouseDown={(e) => e.preventDefault() /* keep selection */}
        >
          {/* Text style */}
          <select
            value={curBlock}
            onChange={(e) => setBlock(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            title="Text style"
            style={{
              height: "32px",
              background: "var(--soft)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              fontSize: "12.5px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "system-ui, sans-serif",
              padding: "0 6px",
            }}
          >
            <option value="p">Normal text</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
          </select>
          <Divider />

          {/* Weight */}
          <IcoBtn title="Bold" onClick={() => exec("bold")}>{I.bold}</IcoBtn>
          <IcoBtn title="Italic" onClick={() => exec("italic")}>{I.italic}</IcoBtn>
          <IcoBtn title="Underline" onClick={() => exec("underline")}>{I.underline}</IcoBtn>
          <Divider />

          {/* Text color */}
          <div style={{ position: "relative" }}>
            <button
              title="Text color"
              onMouseDown={(e) => { e.preventDefault(); rememberSelection(); }}
              onClick={() => { setColorOpen((v) => !v); setHlOpen(false); }}
              style={{
                height: "32px", padding: "0 6px", border: "none", background: "transparent",
                cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "3px",
                borderRadius: "6px", color: "var(--text)",
              }}
            >
              <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ fontWeight: 800, fontSize: "13px", lineHeight: 1 }}>A</span>
                <span style={{ width: "15px", height: "3px", borderRadius: "2px", background: curColor, marginTop: "1px" }} />
              </span>
              <span style={{ fontSize: "9px", color: "var(--muted)" }}>▾</span>
            </button>
            {colorOpen && (
              <div style={{ position: "absolute", top: "36px", left: 0, zIndex: 30, display: "flex", flexWrap: "wrap", gap: "6px", width: "168px", padding: "10px", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "9px", boxShadow: "0 10px 30px rgba(0,0,0,.4)" }}>
                {penColors.map((c, i) => (
                  <button key={i} onMouseDown={(e) => e.preventDefault()} onClick={() => setColor(c)} title="Set text color"
                    style={{ width: "24px", height: "24px", borderRadius: "50%", background: c, border: "1.5px solid rgba(255,255,255,.18)", cursor: "pointer" }} />
                ))}
              </div>
            )}
          </div>

          {/* Highlight */}
          <div style={{ position: "relative" }}>
            <button
              title="Highlight"
              onMouseDown={(e) => { e.preventDefault(); rememberSelection(); }}
              onClick={() => { setHlOpen((v) => !v); setColorOpen(false); }}
              style={{
                height: "32px", padding: "0 6px", border: "none", background: "transparent",
                cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "3px",
                borderRadius: "6px", color: "var(--text)",
              }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M4 20h16" stroke={accent} strokeWidth="2.4" strokeLinecap="round"/><path d="M9 15l-2 .5.5-2 7-7 1.5 1.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>
              <span style={{ fontSize: "9px", color: "var(--muted)" }}>▾</span>
            </button>
            {hlOpen && (
              <div style={{ position: "absolute", top: "36px", left: 0, zIndex: 30, display: "flex", flexWrap: "wrap", gap: "6px", width: "168px", padding: "10px", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "9px", boxShadow: "0 10px 30px rgba(0,0,0,.4)" }}>
                {Array.from({ length: 10 }, (_, i) => COLOR_MAP[(i + 1) as MarkColor]).map((c, i) => (
                  <button key={i} onMouseDown={(e) => e.preventDefault()} onClick={() => setHighlight(c)} title="Highlight color"
                    style={{ width: "24px", height: "24px", borderRadius: "4px", background: c, border: "1.5px solid rgba(255,255,255,.18)", cursor: "pointer" }} />
                ))}
              </div>
            )}
          </div>
          <Divider />

          {/* Lists */}
          <IcoBtn title="Numbered list" onClick={() => exec("insertOrderedList")}>{I.ol}</IcoBtn>
          <IcoBtn title="Bulleted list" onClick={() => exec("insertUnorderedList")}>{I.ul}</IcoBtn>
          <IcoBtn title="Checklist" onClick={makeChecklist}>{I.check}</IcoBtn>
          <IcoBtn title="Indent" onClick={() => exec("indent")}>{I.indent}</IcoBtn>
          <Divider />

          {/* Align */}
          <IcoBtn title="Align left" onClick={() => exec("justifyLeft")}>{I.alignLeft}</IcoBtn>
          <IcoBtn title="Align center" onClick={() => exec("justifyCenter")}>{I.alignCenter}</IcoBtn>
          <Divider />

          {/* Insert */}
          <IcoBtn title="Block quote" onClick={() => setBlock("blockquote")}>{I.quote}</IcoBtn>
          <IcoBtn title="Divider" onClick={insertDivider}>{I.divider}</IcoBtn>
          {linkableVerses.length > 0 && (
            <IcoBtn title="Link a verse" wide onClick={() => { rememberSelection(); setLinkOpen((v) => !v); }}>
              {I.link}<span style={{ fontSize: "12px" }}>Link verse</span>
            </IcoBtn>
          )}
          <Divider />
          <IcoBtn title="Clear formatting" onClick={clearFormatting}>{I.clear}</IcoBtn>
        </div>

        {/* the editable surface */}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={commit}
          onBlur={commit}
          onPaste={handlePaste}
          onKeyUp={() => { rememberSelection(); syncBlock(); syncColor(); }}
          onMouseUp={() => { rememberSelection(); syncBlock(); syncColor(); }}
          data-placeholder={placeholder || "Write a note…"}
          className="scribal-rich-editor"
          style={{
            padding: "11px 12px",
            minHeight: "90px",
            fontSize: "13.5px",
            lineHeight: 1.7,
            color: "var(--text)",
            outline: "none",
            fontFamily: "system-ui, sans-serif",
          }}
        />

        {/* verse link picker */}
        {linkOpen && (
          <div
            style={{
              margin: "0 10px 10px",
              border: "1px solid #8b5cf6",
              borderRadius: "10px",
              background: "var(--panel)",
              maxHeight: "320px",
              overflowY: "auto",
            }}
          >
            <div style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)" }}>
              <input
                value={linkFilter}
                onChange={(e) => setLinkFilter(e.target.value)}
                placeholder="Filter verses in this study…"
                style={{
                  width: "100%",
                  background: "var(--soft)",
                  border: "1px solid var(--border)",
                  borderRadius: "7px",
                  padding: "7px 10px",
                  color: "var(--text)",
                  fontSize: "12.5px",
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
            </div>
            {groups.map((g) => {
              const vs = filtered(g.verses);
              if (!vs.length) return null;
              const open = openThemes[g.name] ?? !!linkFilter.trim();
              return (
                <div key={g.name} style={{ borderBottom: "1px solid var(--border)" }}>
                  <div
                    onClick={() =>
                      setOpenThemes((p) => ({ ...p, [g.name]: !open }))
                    }
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "9px",
                      padding: "10px 12px",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      style={{
                        width: "11px",
                        height: "11px",
                        borderRadius: "50%",
                        background: g.color ? COLOR_MAP[g.color] : "var(--muted)",
                      }}
                    />
                    <span style={{ fontSize: "12.5px", fontWeight: 800, flex: 1 }}>
                      {g.name}
                    </span>
                    <span style={{ fontSize: "10.5px", color: "var(--muted)" }}>
                      {vs.length}
                    </span>
                    <span
                      style={{
                        color: "var(--muted)",
                        fontSize: "11px",
                        transform: open ? "rotate(90deg)" : "none",
                        transition: "transform .15s",
                      }}
                    >
                      ›
                    </span>
                  </div>
                  {open &&
                    vs.map((v) => (
                      <div
                        key={v.reference}
                        onClick={() => insertVerseChip(v.reference)}
                        style={{
                          display: "flex",
                          gap: "9px",
                          padding: "8px 12px 8px 34px",
                          cursor: "pointer",
                          alignItems: "flex-start",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "9.5px",
                            fontWeight: 800,
                            color: "var(--text)",
                            width: "72px",
                            flexShrink: 0,
                            paddingTop: "2px",
                          }}
                        >
                          {v.reference}
                        </span>
                        <span
                          style={{
                            fontFamily: '"Times New Roman", Times, serif',
                            fontSize: "12.5px",
                            lineHeight: 1.5,
                            color: "var(--muted)",
                            flex: 1,
                          }}
                        >
                          {v.text}
                        </span>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: "8px",
            padding: "0 12px 11px",
          }}
        >
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              commit();
              setEditing(false);
              setLinkOpen(false);
              setColorOpen(false);
              setHlOpen(false);
            }}
            style={{
              background: "#8b5cf6",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              padding: "7px 16px",
              fontSize: "12.5px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            Done
          </button>
          {has && (
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange("");
                setEditing(false);
              }}
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                padding: "7px 14px",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "system-ui, sans-serif",
                color: "var(--muted)",
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─────────────────────────────── RESTING ────────────────────────────────
  if (has) {
    return (
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "10px",
            borderLeft: "3px solid " + accent,
            background: "var(--soft)",
            borderRadius: "0 8px 8px 0",
            padding: "10px 12px",
          }}
        >
          <div
            className="scribal-rich-view"
            onClick={onRestingClick}
            style={{
              flex: 1,
              fontSize: "13.5px",
              lineHeight: 1.6,
              color: "var(--text)",
              fontFamily: "system-ui, sans-serif",
              overflowWrap: "anywhere",
            }}
            dangerouslySetInnerHTML={{ __html: toDisplayHtml(value) }}
          />
          <button
            onClick={() => setEditing(true)}
            aria-label="Edit note"
            style={{
              flexShrink: 0,
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "5px 12px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "system-ui, sans-serif",
              color: "var(--muted)",
            }}
          >
            Edit
          </button>
        </div>

        {/* verse-chip preview popover */}
        {preview && (
          <div
            style={{
              marginTop: "8px",
              border: "1px solid #8b5cf6",
              borderRadius: "11px",
              background: "var(--panel)",
              overflow: "hidden",
              maxWidth: "360px",
              boxShadow: "0 14px 40px rgba(0,0,0,.5)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "9px 12px",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <span style={{ fontSize: "11px", fontWeight: 800 }}>{preview.ref}</span>
              <span
                onClick={() => setPreview(null)}
                style={{
                  marginLeft: "auto",
                  color: "var(--muted)",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                ✕
              </span>
            </div>
            <div
              style={{
                display: "flex",
                gap: 0,
                margin: "9px 12px",
                background: "var(--soft)",
                borderRadius: "8px",
                padding: "3px",
              }}
            >
              {(["full", "focused"] as const).map((m) => {
                const on = preview.focused === (m === "focused");
                return (
                  <button
                    key={m}
                    onClick={() =>
                      setPreview({ ref: preview.ref, focused: m === "focused" })
                    }
                    style={{
                      flex: 1,
                      border: "none",
                      background: on ? "#8b5cf6" : "transparent",
                      color: on ? "#fff" : "var(--muted)",
                      fontSize: "11px",
                      fontWeight: 700,
                      padding: "6px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {m === "full" ? "Full verse" : "Focused"}
                  </button>
                );
              })}
            </div>
            <div
              style={{
                padding: "2px 13px 12px",
                fontFamily: '"Times New Roman", Times, serif',
                fontSize: "13.5px",
                lineHeight: 1.7,
                color: "var(--text)",
              }}
            >
              {preview.focused
                ? (focusedFor && focusedFor(preview.ref)) ||
                  "(no marked fragments)"
                : (fullTextFor && fullTextFor(preview.ref)) || preview.ref}
            </div>
            {onJumpToReference && (
              <div
                style={{
                  display: "flex",
                  padding: "9px 12px",
                  borderTop: "1px solid var(--border)",
                  background: "var(--soft)",
                }}
              >
                <button
                  onClick={() => {
                    onJumpToReference(preview.ref);
                    setPreview(null);
                  }}
                  style={{
                    marginLeft: "auto",
                    border: "1px solid #8b5cf6",
                    background: "transparent",
                    color: "#c4aef6",
                    borderRadius: "7px",
                    padding: "6px 11px",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Open in reader ↗
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ─────────────────────────────── EMPTY ──────────────────────────────────
  return (
    <button
      onClick={() => setEditing(true)}
      aria-label={addLabel || "Add a note"}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "1px dashed var(--border)",
        borderRadius: "8px",
        padding: "10px",
        cursor: "pointer",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <span style={{ fontSize: "20px", fontWeight: 700, color: accent, lineHeight: 1 }}>
        +
      </span>
    </button>
  );
}
