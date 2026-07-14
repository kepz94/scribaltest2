import { useState, useEffect, useCallback, useRef } from "react";
import { MarkColor, COLOR_MAP } from "../types";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import {
  HorizontalRuleNode,
  $createHorizontalRuleNode,
} from "@lexical/react/LexicalHorizontalRuleNode";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  INDENT_CONTENT_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  TextNode,
  KEY_DOWN_COMMAND,
  COMMAND_PRIORITY_LOW,
  ElementNode,
} from "lexical";
import {
  $setBlocksType,
  $patchStyleText,
  $getSelectionStyleValueForProperty,
} from "@lexical/selection";
import {
  HeadingNode,
  QuoteNode,
  $createHeadingNode,
  $createQuoteNode,
} from "@lexical/rich-text";
import {
  ListNode,
  ListItemNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";

// ── The note box, rebuilt Lexical-first ─────────────────────────────────────
// The box is designed AROUND the editor: toolbar, writing surface, verse
// picker, and footer are one unit sharing the composer, instead of a toolbar
// bolted onto the old NoteField shell. Same props as before, so Outline's
// wiring is untouched. Notes still save as one HTML string in the same slot.

export interface LinkableVerse {
  reference: string;
  text: string;
  color: MarkColor | null;
  themeName: string;
}

interface Props {
  value: string;
  onChange: (html: string) => void;
  accent: string;
  placeholder?: string;
  addLabel?: string;
  linkableVerses?: LinkableVerse[];
  focusedFor?: (reference: string) => string;
  fullTextFor?: (reference: string) => string;
  onJumpToReference?: (reference: string) => void;
  // Editor/resting text size. Default suits desktop; MOBILE callers must pass
  // >= 16 — iOS zooms (and the zoom can stick in installed PWAs) when any
  // focused editable's font is under 16px.
  editorFontSize?: number;
}

const isPlainText = (v: string) => !/<[a-z][\s\S]*>/i.test(v);
const ACCENT = "#8b5cf6";

// The editor/rendered-note CSS, injected once into <head> so rich notes are
// styled wherever this component mounts — either shell, any view. (These
// rules previously lived in a desktop-only <style> that mounted with the
// MergeSeam animation, so checklists/placeholders rendered unstyled most of
// the time.)
let richCssInjected = false;
const ensureRichNoteCss = () => {
  if (richCssInjected || typeof document === "undefined") return;
  richCssInjected = true;
  if (document.getElementById("scribal-richnote-css")) return;
  const el = document.createElement("style");
  el.id = "scribal-richnote-css";
  el.textContent = `
    .scribal-rich-editor:empty:before {
      content: attr(data-placeholder);
      color: var(--muted);
      pointer-events: none;
    }
    .rt-bold { font-weight: 800 !important; }
    .rt-italic { font-style: italic !important; }
    .rt-underline { text-decoration: underline !important; }
    .rt-underline.rt-bold, .rt-underline.rt-italic { text-decoration: underline !important; }
    .rt-h1 { font-size: 19px; font-weight: 800; margin: 0 0 4px; }
    .rt-h2 { font-size: 15.5px; font-weight: 800; margin: 12px 0 5px; }
    .rt-quote { border-left: 3px solid var(--border); padding: 2px 0 2px 12px; margin: 0 0 10px; color: var(--muted); font-style: italic; }
    .rt-ol { margin: 0 0 10px 24px; list-style: decimal; }
    .rt-ul { margin: 0 0 10px 22px; list-style: disc; }
    .rt-li { margin-bottom: 4px; }
    .rt-checklist { list-style: none; margin: 0 0 10px 2px; padding-left: 0; }
    .rt-checklist .rt-li { list-style: none; }
    .rt-li-unchecked, .rt-li-checked {
      list-style: none; position: relative; padding-left: 26px; cursor: pointer; outline: none;
    }
    .rt-li-unchecked:before, .rt-li-checked:before {
      content: ""; position: absolute; left: 0; top: 2px; width: 16px; height: 16px;
      border-radius: 4px; border: 1.5px solid var(--muted);
    }
    .rt-li-checked { color: var(--muted); text-decoration: line-through; }
    .rt-li-checked:before {
      content: "\\2713"; background: #4caf7d; border-color: #4caf7d; color: #0c1a10;
      font-size: 11px; font-weight: 900; display: flex; align-items: center; justify-content: center; text-decoration: none;
    }
    .rt-ol .rt-ol, .rt-ul .rt-ul, .rt-ol .rt-ul, .rt-ul .rt-ol { margin-left: 20px; }
    .scribal-rich-editor h1, .scribal-rich-view h1 { font-size: 19px; font-weight: 800; margin: 0 0 4px; }
    .scribal-rich-editor h2, .scribal-rich-view h2 { font-size: 15.5px; font-weight: 800; margin: 12px 0 5px; }
    .scribal-rich-editor p, .scribal-rich-view p { margin: 0 0 8px; }
    .scribal-rich-editor blockquote, .scribal-rich-view blockquote {
      border-left: 3px solid var(--border); padding: 2px 0 2px 12px; margin: 0 0 10px;
      color: var(--muted); font-style: italic;
    }
    .scribal-rich-editor ol, .scribal-rich-view ol { margin: 0 0 10px 24px; }
    .scribal-rich-editor ul, .scribal-rich-view ul { margin: 0 0 10px 22px; }
    .scribal-rich-editor li[role="checkbox"], .scribal-rich-view li[role="checkbox"] {
      list-style: none; position: relative; padding-left: 26px; cursor: pointer; outline: none;
    }
    .scribal-rich-editor li[role="checkbox"]:before, .scribal-rich-view li[role="checkbox"]:before {
      content: ""; position: absolute; left: 0; top: 2px; width: 16px; height: 16px;
      border-radius: 4px; border: 1.5px solid var(--muted);
    }
    .scribal-rich-editor li[role="checkbox"][aria-checked="true"], .scribal-rich-view li[role="checkbox"][aria-checked="true"] {
      color: var(--muted); text-decoration: line-through;
    }
    .scribal-rich-editor li[role="checkbox"][aria-checked="true"]:before, .scribal-rich-view li[role="checkbox"][aria-checked="true"]:before {
      content: "\\2713"; background: #4caf7d; border-color: #4caf7d; color: #0c1a10;
      font-size: 11px; font-weight: 900; display: flex; align-items: center; justify-content: center; text-decoration: none;
    }
    .scribal-rich-editor ul[data-checklist], .scribal-rich-view ul[data-checklist] {
      list-style: none; margin-left: 2px; padding-left: 0;
    }
    .scribal-rich-editor ul[data-checklist] li, .scribal-rich-view ul[data-checklist] li {
      position: relative; padding-left: 26px; margin-bottom: 6px;
    }
    .scribal-rich-editor ul[data-checklist] li:before, .scribal-rich-view ul[data-checklist] li:before {
      content: ""; position: absolute; left: 0; top: 2px; width: 16px; height: 16px;
      border-radius: 4px; border: 1.5px solid var(--muted);
    }
    .scribal-rich-view ul[data-checklist] li { cursor: pointer; }
    .scribal-rich-editor ul[data-checklist] li[data-checked="1"], .scribal-rich-view ul[data-checklist] li[data-checked="1"] {
      color: var(--muted); text-decoration: line-through;
    }
    .scribal-rich-editor ul[data-checklist] li[data-checked="1"]:before, .scribal-rich-view ul[data-checklist] li[data-checked="1"]:before {
      content: "\\2713"; background: #4caf7d; border-color: #4caf7d; color: #0c1a10;
      font-size: 11px; font-weight: 900; display: flex; align-items: center; justify-content: center; text-decoration: none;
    }
    .scribal-rich-view .scribal-vchip { cursor: pointer; white-space: nowrap; }
    .scribal-rich-editor hr, .scribal-rich-view hr { border: none; border-top: 1px solid var(--border); margin: 12px 0; }
  `;
  document.head.appendChild(el);
};
if (typeof document !== "undefined") ensureRichNoteCss();

// ── Verse chip: an atomic (token) node that keeps its reference through the
// save/load round trip, so the resting view can open its preview. Deletes as
// one unit, exactly like a chip in Docs/Notion.
class ChipNode extends TextNode {
  __ref: string;
  static getType(): string {
    return "verse-chip";
  }
  static clone(node: any): any {
    return new ChipNode(node.__ref, node.__text, node.__key);
  }
  constructor(ref: string, text: string, key?: any) {
    super(text, key);
    this.__ref = ref;
  }
  createDOM(config: any): any {
    const el = super.createDOM(config);
    el.classList.add("scribal-vchip");
    el.setAttribute("data-ref", this.__ref);
    el.style.color = ACCENT;
    el.style.fontWeight = "600";
    el.style.cursor = "pointer";
    return el;
  }
  exportDOM(): any {
    const el = document.createElement("span");
    el.className = "scribal-vchip";
    el.setAttribute("data-ref", this.__ref);
    el.setAttribute("style", "color: " + ACCENT + "; font-weight: 600;");
    el.textContent = this.getTextContent();
    return { element: el };
  }
  static importDOM(): any {
    return {
      span: (node: any) =>
        node.classList && node.classList.contains("scribal-vchip")
          ? {
              conversion: (el: any) => ({
                node: $createChipNode(
                  el.getAttribute("data-ref") || "",
                  el.textContent || ""
                ),
              }),
              priority: 3,
            }
          : null,
    };
  }
  exportJSON(): any {
    return { ...super.exportJSON(), type: "verse-chip", ref: this.__ref, version: 1 };
  }
  static importJSON(json: any): any {
    return $createChipNode(json.ref || "", json.text || "");
  }
}
function $createChipNode(ref: string, text: string) {
  const n: any = new ChipNode(ref, text);
  n.setMode("token");
  return n;
}

const editorTheme = {
  text: { bold: "rt-bold", italic: "rt-italic", underline: "rt-underline" },
  heading: { h1: "rt-h1", h2: "rt-h2" },
  quote: "rt-quote",
  list: {
    ol: "rt-ol",
    ul: "rt-ul",
    checklist: "rt-checklist",
    listitem: "rt-li",
    listitemChecked: "rt-li-checked",
    listitemUnchecked: "rt-li-unchecked",
  },
};

// ═══ Toolbar ═════════════════════════════════════════════════════════════
const BTN = (on?: boolean): React.CSSProperties => ({
  height: "32px",
  minWidth: "32px",
  padding: "0 7px",
  border: "none",
  background: on ? "rgba(139,92,246,.22)" : "transparent",
  color: on ? "#b79df5" : "var(--text)",
  borderRadius: "6px",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "system-ui, sans-serif",
  fontSize: "13px",
  fontWeight: 700,
  userSelect: "none",
  gap: "4px",
  flexShrink: 0,
});
const POP: React.CSSProperties = {
  position: "absolute",
  top: "36px",
  left: 0,
  zIndex: 40,
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: "9px",
  boxShadow: "0 10px 30px rgba(0,0,0,.4)",
};
const Sep = () => (
  <span style={{ width: "1px", height: "20px", background: "var(--border)", margin: "0 5px", flexShrink: 0 }} />
);

function Toolbar({
  accent,
  hasVerses,
  onLinkOpen,
}: {
  accent: string;
  hasVerses: boolean;
  onLinkOpen: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [pop, setPop] = useState<"" | "style" | "color" | "hl">("");
  const hlRef = useRef("");
  const lastHlRef = useRef(COLOR_MAP[3 as MarkColor] || accent);
  const [active, setActive] = useState({
    bold: false,
    italic: false,
    underline: false,
    block: "Normal text",
    color: "",
    hl: "",
    align: "left",
    list: "",
  });

  // Live readback: the toolbar always shows what's under the caret.
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }: any) => {
      editorState.read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel)) return;
        let block = "Normal text";
        const n = sel.anchor.getNode();
        const el = n.getKey() === "root" ? n : n.getTopLevelElementOrThrow();
        const t = el.getType ? el.getType() : "";
        if (t === "heading")
          block = el.getTag() === "h1" ? "Heading 1" : "Heading 2";
        else if (t === "quote") block = "Quote";
        // list type under the caret (the list is the top-level element)
        let list = "";
        if (t === "list" && el.getListType) list = el.getListType();
        // alignment of the block (or the list item) under the caret
        let align = "left";
        let fmtEl: any = el;
        if (t === "list") {
          let li: any = n;
          while (li && li.getType && li.getType() !== "listitem") li = li.getParent && li.getParent();
          if (li) fmtEl = li;
        }
        if (fmtEl.getFormatType) align = fmtEl.getFormatType() || "left";
        setActive({
          bold: sel.hasFormat("bold"),
          italic: sel.hasFormat("italic"),
          underline: sel.hasFormat("underline"),
          block,
          color: $getSelectionStyleValueForProperty(sel, "color", ""),
          hl: (hlRef.current = $getSelectionStyleValueForProperty(sel, "background-color", "")),
          align,
          list,
        });
      });
    });
  }, [editor]);

  // Every control fires on mousedown+preventDefault: focus never leaves the
  // editor, so commands always act on the user's real selection.
  const md = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    fn();
  };
  // Hotkeys (Ctrl+B/I/U are native to Lexical): Ctrl/Cmd+Alt+0/1/2 = Normal/
  // H1/H2, Ctrl/Cmd+Alt+Q = Quote, Ctrl/Cmd+Alt+H = toggle highlighter with
  // the last-used color.
  useEffect(() => {
    return editor.registerCommand(
      KEY_DOWN_COMMAND,
      (e: KeyboardEvent) => {
        if (!(e.ctrlKey || e.metaKey) || !e.altKey) return false;
        const k = e.key.toLowerCase();
        if (k === "0") { e.preventDefault(); setBlock("p"); return true; }
        if (k === "1") { e.preventDefault(); setBlock("h1"); return true; }
        if (k === "2") { e.preventDefault(); setBlock("h2"); return true; }
        if (k === "q") { e.preventDefault(); setBlock("quote"); return true; }
        if (k === "h") {
          e.preventDefault();
          setHl(hlRef.current ? null : lastHlRef.current);
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_LOW
    );
    // eslint-disable-next-line
  }, [editor]);

  const fmt = (f: "bold" | "italic" | "underline") =>
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, f);
  const setBlock = (kind: "p" | "h1" | "h2" | "quote") => {
    editor.update(() => {
      const sel = $getSelection();
      if (!$isRangeSelection(sel)) return;
      if (kind === "p") $setBlocksType(sel, () => $createParagraphNode());
      else if (kind === "quote") $setBlocksType(sel, () => $createQuoteNode());
      else $setBlocksType(sel, () => $createHeadingNode(kind));
    });
    setPop("");
  };
  const setColor = (c: string | null) => {
    editor.update(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel)) $patchStyleText(sel, { color: c });
    });
    setPop("");
  };
  const setHl = (c: string | null) => {
    if (c) lastHlRef.current = c;
    editor.update(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel))
        $patchStyleText(sel, { "background-color": c });
    });
    setPop("");
  };
  const clearFmt = () =>
    editor.update(() => {
      const sel: any = $getSelection();
      if (!$isRangeSelection(sel)) return;
      $patchStyleText(sel, { color: null, "background-color": null });
      sel.getNodes().forEach((node: any) => {
        if (node.getType && node.getType() === "verse-chip") return; // chips keep their look
        if (node.setFormat) node.setFormat(0);
        if (node.setStyle) node.setStyle("");
      });
      // reset what the NEXT typed character inherits
      sel.format = 0;
      sel.style = "";
      $setBlocksType(sel, () => $createParagraphNode());
    });

  const penColors = [
    "var(--text)",
    ...Array.from({ length: 10 }, (_, i) => COLOR_MAP[(i + 1) as MarkColor]),
  ];
  const styles: { label: string; kind: "p" | "h1" | "h2" | "quote"; key: string }[] = [
    { label: "Normal text", kind: "p", key: "Ctrl+Alt+0" },
    { label: "Heading 1", kind: "h1", key: "Ctrl+Alt+1" },
    { label: "Heading 2", kind: "h2", key: "Ctrl+Alt+2" },
    { label: "Quote", kind: "quote", key: "Ctrl+Alt+Q" },
  ];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "2px",
        padding: "7px 9px",
        borderBottom: "1px solid var(--border)",
        background: "var(--panel)",
        flexWrap: "wrap",
        borderRadius: "8px 8px 0 0",
      }}
    >
      {/* Style — button dropdown (a native <select> steals the selection) */}
      <div style={{ position: "relative" }}>
        <button
          onMouseDown={md(() => setPop(pop === "style" ? "" : "style"))}
          title="Text style"
          style={{
            height: "32px",
            minWidth: "112px",
            justifyContent: "space-between",
            padding: "0 9px",
            background: "var(--soft)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            fontSize: "12.5px",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "system-ui, sans-serif",
            display: "inline-flex",
            alignItems: "center",
            userSelect: "none",
          }}
        >
          <span>{active.block}</span>
          <span style={{ fontSize: "9px", color: "var(--muted)" }}>▾</span>
        </button>
        {pop === "style" && (
          <div style={{ ...POP, width: "150px", overflow: "hidden" }}>
            {styles.map((o) => (
              <button
                key={o.kind}
                onMouseDown={md(() => setBlock(o.kind))}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  background:
                    active.block === o.label ? "rgba(139,92,246,.15)" : "transparent",
                  color: active.block === o.label ? "#b79df5" : "var(--text)",
                  padding: "9px 12px",
                  fontSize: o.kind === "h1" ? "16px" : o.kind === "h2" ? "14px" : "12.5px",
                  fontWeight: o.kind.startsWith("h") ? 800 : 600,
                  fontStyle: o.kind === "quote" ? "italic" : "normal",
                  cursor: "pointer",
                  fontFamily: "system-ui, sans-serif",
                }}
              >
                <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "10px" }}>
                  <span>{o.label}</span>
                  <span style={{ fontSize: "9px", color: "var(--muted)", fontWeight: 500 }}>{o.key}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <Sep />
      <button style={BTN(active.bold)} title="Bold (Ctrl+B)" onMouseDown={md(() => fmt("bold"))}>
        <span style={{ fontWeight: 900 }}>B</span>
      </button>
      <button style={BTN(active.italic)} title="Italic (Ctrl+I)" onMouseDown={md(() => fmt("italic"))}>
        <span style={{ fontStyle: "italic", fontFamily: "Georgia, serif" }}>I</span>
      </button>
      <button style={BTN(active.underline)} title="Underline (Ctrl+U)" onMouseDown={md(() => fmt("underline"))}>
        <span style={{ textDecoration: "underline" }}>U</span>
      </button>
      <Sep />
      {/* color */}
      <div style={{ position: "relative" }}>
        <button style={BTN()} title="Text color" onMouseDown={md(() => setPop(pop === "color" ? "" : "color"))}>
          <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontWeight: 800, fontSize: "13px", lineHeight: 1 }}>A</span>
            <span
              style={{
                width: "15px",
                height: "3px",
                borderRadius: "2px",
                background: active.color || "var(--text)",
                marginTop: "1px",
              }}
            />
          </span>
          <span style={{ fontSize: "9px", color: "var(--muted)" }}>▾</span>
        </button>
        {pop === "color" && (
          <div style={{ ...POP, display: "flex", flexWrap: "wrap", gap: "6px", width: "170px", padding: "10px" }}>
            {penColors.map((c, i) => (
              <button
                key={i}
                title={i === 0 ? "Default color" : "Set color"}
                onMouseDown={md(() => setColor(i === 0 ? null : c))}
                style={{
                  width: "24px",
                  height: "24px",
                  borderRadius: "50%",
                  background: c,
                  border:
                    active.color === c
                      ? "2px solid #fff"
                      : "1.5px solid rgba(255,255,255,.18)",
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
        )}
      </div>
      {/* highlight */}
      <div style={{ position: "relative" }}>
        <button style={BTN()} title="Highlight (Ctrl+Alt+H)" onMouseDown={md(() => setPop(pop === "hl" ? "" : "hl"))}>
          <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
            <svg width="16" height="13" viewBox="0 0 24 18" fill="none">
              <path d="M9 15l-2 .5.5-2 7-7 1.5 1.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
            <span style={{ width: "15px", height: "3px", borderRadius: "2px", background: active.hl || "var(--border)", marginTop: "1px" }} />
          </span>
          <span style={{ fontSize: "9px", color: "var(--muted)" }}>▾</span>
        </button>
        {pop === "hl" && (
          <div style={{ ...POP, display: "flex", flexWrap: "wrap", gap: "6px", width: "170px", padding: "10px" }}>
            <button
              title="No highlight"
              onMouseDown={md(() => setHl(null))}
              style={{ width: "24px", height: "24px", borderRadius: "4px", background: "var(--soft)", border: "1.5px dashed var(--muted)", cursor: "pointer", color: "var(--muted)", fontSize: "11px", lineHeight: "1", fontFamily: "system-ui, sans-serif" }}
            >
              ✕
            </button>
            {Array.from({ length: 10 }, (_, i) => COLOR_MAP[(i + 1) as MarkColor]).map((c, i) => (
              <button
                key={i}
                title="Highlight"
                onMouseDown={md(() => setHl(c))}
                style={{ width: "24px", height: "24px", borderRadius: "4px", background: c, border: "1.5px solid rgba(255,255,255,.18)", cursor: "pointer" }}
              />
            ))}
          </div>
        )}
      </div>
      <Sep />
      {hasVerses && (
        <button style={{ ...BTN(), minWidth: undefined, padding: "0 10px" }} title="Link a verse" onMouseDown={md(onLinkOpen)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M10 14a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 0 0-5.66-5.66L11 7M14 10a4 4 0 0 0-5.66 0l-2.83 2.83a4 4 0 0 0 5.66 5.66L13 17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></svg>
          <span style={{ fontSize: "12px", fontWeight: 600 }}>Link verse</span>
        </button>
      )}
      <Sep />
      <button style={BTN(active.align === "left" || active.align === "")} title="Align left" onMouseDown={md(() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "left"))}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h10M4 18h13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
      </button>
      <button style={BTN(active.align === "center")} title="Align center" onMouseDown={md(() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "center"))}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M7 12h10M6 18h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
      </button>
      <Sep />
      <button style={BTN(active.list === "bullet")} title="Bulleted list" onMouseDown={md(() => editor.dispatchCommand(active.list === "bullet" ? REMOVE_LIST_COMMAND : INSERT_UNORDERED_LIST_COMMAND, undefined))}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 6h11M9 12h11M9 18h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><circle cx="4" cy="6" r="1.4" fill="currentColor"/><circle cx="4" cy="12" r="1.4" fill="currentColor"/><circle cx="4" cy="18" r="1.4" fill="currentColor"/></svg>
      </button>
      <button style={BTN(active.list === "number")} title="Numbered list" onMouseDown={md(() => editor.dispatchCommand(active.list === "number" ? REMOVE_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND, undefined))}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M10 6h10M10 12h10M10 18h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><text x="2" y="8" fontSize="7" fill="currentColor">1</text><text x="2" y="14" fontSize="7" fill="currentColor">2</text><text x="2" y="20" fontSize="7" fill="currentColor">3</text></svg>
      </button>
      <Sep />
      <button style={BTN()} title="Outdent" onMouseDown={md(() => editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined))}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20 6H4M20 12h-9M20 18H4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M7 9l-3 3 3 3z" fill="currentColor"/></svg>
      </button>
      <button style={BTN()} title="Indent" onMouseDown={md(() => editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined))}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M11 12h9M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M4 9l3 3-3 3z" fill="currentColor"/></svg>
      </button>
      <Sep />
      <button style={BTN()} title="Divider line" onMouseDown={md(() =>
          editor.update(() => {
            const sel = $getSelection();
            if ($isRangeSelection(sel))
              sel.insertNodes([$createHorizontalRuleNode(), $createParagraphNode()]);
          })
        )}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
      </button>
      <Sep />
      <button style={BTN()} title="Clear formatting" onMouseDown={md(clearFmt)}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M6 5h13M9 5l-1.5 9M13 5l-.5 3M5 21l14-14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></svg>
      </button>
    </div>
  );
}

// ═══ inner plugins ═══════════════════════════════════════════════════════
function InitPlugin({ html }: { html: string }) {
  const [editor] = useLexicalComposerContext();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      if (!html || !html.trim()) {
        root.append($createParagraphNode());
        return;
      }
      if (isPlainText(html)) {
        html.split("\n").forEach((line) => {
          const p = $createParagraphNode();
          if (line) p.append($createTextNode(line));
          root.append(p);
        });
        return;
      }
      const dom = new DOMParser().parseFromString(html, "text/html");
      const nodes = $generateNodesFromDOM(editor, dom);
      nodes.forEach((n: any) => {
        if (n instanceof ElementNode) root.append(n);
        else {
          const p = $createParagraphNode();
          p.append(n);
          root.append(p);
        }
      });
      if (root.getChildrenSize() === 0) root.append($createParagraphNode());
    });
    editor.focus();
    // eslint-disable-next-line
  }, []);
  return null;
}

function VersePicker({
  groups,
  linkFilter,
  setLinkFilter,
  openThemes,
  setOpenThemes,
  onClose,
}: any) {
  const [editor] = useLexicalComposerContext();
  const insert = (ref: string) => {
    editor.update(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel)) {
        sel.insertNodes([
          $createChipNode(ref, "\u2937\u00a0" + ref),
          $createTextNode("\u00a0"),
        ]);
      }
    });
    editor.focus();
    onClose();
  };
  const filt = (vs: LinkableVerse[]) =>
    !linkFilter.trim()
      ? vs
      : vs.filter(
          (v: LinkableVerse) =>
            v.reference.toLowerCase().includes(linkFilter.toLowerCase()) ||
            v.text.toLowerCase().includes(linkFilter.toLowerCase())
        );
  return (
    <div
      style={{
        margin: "0 10px 10px",
        border: "1px solid " + ACCENT,
        borderRadius: "10px",
        background: "var(--panel)",
        maxHeight: "300px",
        overflowY: "auto",
      }}
    >
      <div style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)", display: "flex", gap: "8px", alignItems: "center" }}>
        <input
          value={linkFilter}
          onChange={(e) => setLinkFilter(e.target.value)}
          placeholder="Filter verses in this study…"
          style={{ flex: 1, background: "var(--soft)", border: "1px solid var(--border)", borderRadius: "7px", padding: "7px 10px", color: "var(--text)", fontSize: "12.5px", fontFamily: "inherit", outline: "none" }}
        />
        <button onMouseDown={(e) => { e.preventDefault(); onClose(); }} style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: "14px", cursor: "pointer" }}>✕</button>
      </div>
      {groups.map((g: any) => {
        const vs = filt(g.verses);
        if (!vs.length) return null;
        const isOpen = openThemes[g.name] ?? !!linkFilter.trim();
        return (
          <div key={g.name} style={{ borderBottom: "1px solid var(--border)" }}>
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                setOpenThemes((p: any) => ({ ...p, [g.name]: !isOpen }));
              }}
              style={{ display: "flex", alignItems: "center", gap: "9px", padding: "10px 12px", cursor: "pointer" }}
            >
              <span style={{ width: "11px", height: "11px", borderRadius: "50%", background: g.color ? COLOR_MAP[g.color as MarkColor] : "var(--muted)" }} />
              <span style={{ fontSize: "12.5px", fontWeight: 800, flex: 1 }}>{g.name}</span>
              <span style={{ fontSize: "10.5px", color: "var(--muted)" }}>{vs.length}</span>
              <span style={{ color: "var(--muted)", fontSize: "11px", transform: isOpen ? "rotate(90deg)" : "none" }}>›</span>
            </div>
            {isOpen &&
              vs.map((v: LinkableVerse) => (
                <div
                  key={v.reference}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insert(v.reference);
                  }}
                  style={{ display: "flex", gap: "9px", padding: "8px 12px 8px 34px", cursor: "pointer", alignItems: "flex-start" }}
                >
                  <span style={{ fontSize: "9.5px", fontWeight: 800, color: "var(--text)", width: "72px", flexShrink: 0, paddingTop: "2px" }}>{v.reference}</span>
                  <span style={{ fontFamily: '"Times New Roman", Times, serif', fontSize: "12.5px", lineHeight: 1.5, color: "var(--muted)", flex: 1 }}>{v.text}</span>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}

// ═══ the component ═══════════════════════════════════════════════════════
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
  editorFontSize = 13.5,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [openThemes, setOpenThemes] = useState<Record<string, boolean>>({});
  const [linkFilter, setLinkFilter] = useState("");
  const [preview, setPreview] = useState<{ ref: string; focused: boolean } | null>(null);
  const has = (value || "").trim().length > 0;
  const htmlRef = useRef(value);

  const groups: { name: string; color: MarkColor | null; verses: LinkableVerse[] }[] = [];
  linkableVerses.forEach((v) => {
    let g = groups.find((x) => x.name === v.themeName);
    if (!g) {
      g = { name: v.themeName, color: v.color, verses: [] };
      groups.push(g);
    }
    g.verses.push(v);
  });

  const onRestingClick = useCallback((e: React.MouseEvent) => {
    const t = (e.target as HTMLElement).closest(".scribal-vchip");
    if (t) {
      const ref = t.getAttribute("data-ref");
      if (ref) setPreview({ ref, focused: true });
    }
  }, []);

  if (editing) {
    const initialConfig = {
      namespace: "scribal-note",
      theme: editorTheme,
      onError: (e: Error) => console.error("Lexical:", e),
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, HorizontalRuleNode, ChipNode],
    };
    return (
      <div style={{ border: "1px solid " + ACCENT, borderRadius: "8px", background: "var(--soft)" }}>
        <LexicalComposer initialConfig={initialConfig}>
          <Toolbar accent={accent} hasVerses={linkableVerses.length > 0} onLinkOpen={() => setLinkOpen((v) => !v)} />
          <div style={{ position: "relative" }}>
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  className="scribal-rich-editor"
                  style={{ padding: "11px 12px", minHeight: "96px", fontSize: editorFontSize + "px", lineHeight: 1.7, color: "var(--text)", outline: "none", fontFamily: "system-ui, sans-serif" }}
                />
              }
              placeholder={
                <div style={{ position: "absolute", top: "11px", left: "12px", color: "var(--muted)", fontSize: editorFontSize + "px", pointerEvents: "none" }}>
                  {placeholder || "Write a note…"}
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
          </div>
          <ListPlugin />
          <CheckListPlugin />
          <TabIndentationPlugin />
          <HistoryPlugin />
          <InitPlugin html={value} />
          <OnChangePlugin
            onChange={(editorState: any, editor: any) => {
              editorState.read(() => {
                htmlRef.current = $generateHtmlFromNodes(editor, null);
              });
            }}
          />
          {linkOpen && (
            <VersePicker
              groups={groups}
              linkFilter={linkFilter}
              setLinkFilter={setLinkFilter}
              openThemes={openThemes}
              setOpenThemes={setOpenThemes}
              onClose={() => setLinkOpen(false)}
            />
          )}
        </LexicalComposer>
        <div style={{ display: "flex", gap: "8px", padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              // an editor holding only an empty paragraph saves as empty
              const out = htmlRef.current || "";
              const textOnly = out.replace(/<[^>]*>/g, "").replace(/\u00a0/g, " ").trim();
              onChange(textOnly ? out : "");
              setEditing(false);
              setLinkOpen(false);
            }}
            style={{ background: ACCENT, color: "#fff", border: "none", borderRadius: "8px", padding: "7px 16px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", fontFamily: "system-ui, sans-serif" }}
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
              style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: "8px", padding: "7px 14px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", fontFamily: "system-ui, sans-serif", color: "var(--muted)" }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    );
  }

  if (has) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", borderLeft: "3px solid " + accent, background: "var(--soft)", borderRadius: "0 8px 8px 0", padding: "10px 12px" }}>
          <div
            className="scribal-rich-view"
            onClick={onRestingClick}
            style={{ flex: 1, fontSize: editorFontSize + "px", lineHeight: 1.6, color: "var(--text)", fontFamily: "system-ui, sans-serif", overflowWrap: "anywhere" }}
            dangerouslySetInnerHTML={{
              __html: isPlainText(value)
                ? value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")
                : value,
            }}
          />
          <button
            onClick={() => setEditing(true)}
            style={{ flexShrink: 0, background: "transparent", border: "1px solid var(--border)", borderRadius: "8px", padding: "5px 12px", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "system-ui, sans-serif", color: "var(--muted)" }}
          >
            Edit
          </button>
        </div>
        {preview && (
          <div style={{ marginTop: "8px", border: "1px solid " + ACCENT, borderRadius: "11px", background: "var(--panel)", overflow: "hidden", maxWidth: "360px", boxShadow: "0 14px 40px rgba(0,0,0,.5)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "9px 12px", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontSize: "11px", fontWeight: 800 }}>{preview.ref}</span>
              <span onClick={() => setPreview(null)} style={{ marginLeft: "auto", color: "var(--muted)", fontSize: "14px", cursor: "pointer" }}>✕</span>
            </div>
            <div style={{ display: "flex", margin: "9px 12px", background: "var(--soft)", borderRadius: "8px", padding: "3px" }}>
              {(["full", "focused"] as const).map((m) => {
                const on = preview.focused === (m === "focused");
                return (
                  <button key={m} onClick={() => setPreview({ ref: preview.ref, focused: m === "focused" })} style={{ flex: 1, border: "none", background: on ? ACCENT : "transparent", color: on ? "#fff" : "var(--muted)", fontSize: "11px", fontWeight: 700, padding: "6px", borderRadius: "6px", cursor: "pointer", fontFamily: "inherit" }}>
                    {m === "full" ? "Full verse" : "Focused"}
                  </button>
                );
              })}
            </div>
            <div style={{ padding: "2px 13px 12px", fontFamily: '"Times New Roman", Times, serif', fontSize: "13.5px", lineHeight: 1.7, color: "var(--text)" }}>
              {preview.focused
                ? (focusedFor && focusedFor(preview.ref)) || "(no marked fragments)"
                : (fullTextFor && fullTextFor(preview.ref)) || preview.ref}
            </div>
            {onJumpToReference && (
              <div style={{ display: "flex", padding: "9px 12px", borderTop: "1px solid var(--border)", background: "var(--soft)" }}>
                <button onClick={() => { onJumpToReference(preview.ref); setPreview(null); }} style={{ marginLeft: "auto", border: "1px solid " + ACCENT, background: "transparent", color: "#c4aef6", borderRadius: "7px", padding: "6px 11px", fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                  Open in reader ↗
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      aria-label={addLabel || "Add a note"}
      style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "1px dashed var(--border)", borderRadius: "8px", padding: "10px", cursor: "pointer", fontFamily: "system-ui, sans-serif" }}
    >
      <span style={{ fontSize: "20px", fontWeight: 700, color: accent, lineHeight: 1 }}>+</span>
    </button>
  );
}
