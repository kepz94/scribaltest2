import { useState, useEffect, useCallback, useRef } from "react";
import { MarkColor, COLOR_MAP } from "../types";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
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
  INSERT_CHECK_LIST_COMMAND,
} from "@lexical/list";
import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";

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
}

const isPlainText = (v: string) => !/<[a-z][\s\S]*>/i.test(v);

function Toolbar({
  accent,
  linkableVerses,
  onLinkOpen,
}: {
  accent: string;
  linkableVerses: LinkableVerse[];
  onLinkOpen: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [colorOpen, setColorOpen] = useState(false);
  const [hlOpen, setHlOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);

  // Active-state readback — so the toolbar shows what's currently applied.
  const [active, setActive] = useState({
    bold: false,
    italic: false,
    underline: false,
    block: "Normal text",
    color: accent,
  });

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }: any) => {
      editorState.read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel)) return;
        let block = "Normal text";
        const anchorNode = sel.anchor.getNode();
        let el =
          anchorNode.getKey() === "root"
            ? anchorNode
            : anchorNode.getTopLevelElementOrThrow();
        const type = el.getType ? el.getType() : "";
        if (type === "heading") {
          const tag = el.getTag ? el.getTag() : "";
          block = tag === "h1" ? "Heading 1" : tag === "h2" ? "Heading 2" : "Heading";
        } else if (type === "quote") block = "Quote";
        const col = $getSelectionStyleValueForProperty(sel, "color", "");
        setActive({
          bold: sel.hasFormat("bold"),
          italic: sel.hasFormat("italic"),
          underline: sel.hasFormat("underline"),
          block,
          color: col || accent,
        });
      });
    });
  }, [editor, accent]);

  const fmt = (f: "bold" | "italic" | "underline") =>
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, f);

  const block = (kind: "p" | "h1" | "h2" | "quote") => {
    editor.update(() => {
      const sel = $getSelection();
      if (!$isRangeSelection(sel)) return;
      if (kind === "p") $setBlocksType(sel, () => $createParagraphNode());
      else if (kind === "quote") $setBlocksType(sel, () => $createQuoteNode());
      else $setBlocksType(sel, () => $createHeadingNode(kind));
    });
    setStyleOpen(false);
  };

  const color = (c: string) =>
    editor.update(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel)) $patchStyleText(sel, { color: c });
    });
  const highlight = (c: string) =>
    editor.update(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel)) $patchStyleText(sel, { "background-color": c });
    });

  const penColors = [
    "var(--text)",
    ...Array.from({ length: 10 }, (_, i) => COLOR_MAP[(i + 1) as MarkColor]),
  ];

  const btn = (on?: boolean): React.CSSProperties => ({
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
  });
  const sep = (
    <span style={{ width: "1px", height: "20px", background: "var(--border)", margin: "0 5px", flexShrink: 0 }} />
  );
  // fire on mousedown + preventDefault → editor keeps its selection
  const md = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    fn();
  };

  const styleOptions: { label: string; kind: "p" | "h1" | "h2" | "quote" }[] = [
    { label: "Normal text", kind: "p" },
    { label: "Heading 1", kind: "h1" },
    { label: "Heading 2", kind: "h2" },
    { label: "Quote", kind: "quote" },
  ];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "2px", padding: "7px 9px", borderBottom: "1px solid var(--border)", background: "var(--panel)", flexWrap: "wrap" }}>
      {/* Style dropdown — button-based so it never steals the editor selection */}
      <div style={{ position: "relative" }}>
        <button
          onMouseDown={md(() => setStyleOpen((v) => !v))}
          style={{ height: "32px", minWidth: "118px", justifyContent: "space-between", padding: "0 9px", background: "var(--soft)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", fontFamily: "system-ui, sans-serif", display: "inline-flex", alignItems: "center", gap: "6px", userSelect: "none" }}
          title="Text style"
        >
          <span>{active.block}</span>
          <span style={{ fontSize: "9px", color: "var(--muted)" }}>▾</span>
        </button>
        {styleOpen && (
          <div style={{ position: "absolute", top: "36px", left: 0, zIndex: 40, width: "150px", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "9px", boxShadow: "0 10px 30px rgba(0,0,0,.4)", overflow: "hidden" }}>
            {styleOptions.map((o) => (
              <button
                key={o.kind}
                onMouseDown={md(() => block(o.kind))}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  background: active.block === o.label ? "rgba(139,92,246,.15)" : "transparent",
                  color: active.block === o.label ? "#b79df5" : "var(--text)",
                  padding: "9px 12px",
                  fontSize: o.kind === "h1" ? "16px" : o.kind === "h2" ? "14px" : "12.5px",
                  fontWeight: o.kind.startsWith("h") ? 800 : 600,
                  fontStyle: o.kind === "quote" ? "italic" : "normal",
                  cursor: "pointer",
                  fontFamily: "system-ui, sans-serif",
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {sep}
      <button style={btn(active.bold)} title="Bold" onMouseDown={md(() => fmt("bold"))}>
        <span style={{ fontWeight: 900 }}>B</span>
      </button>
      <button style={btn(active.italic)} title="Italic" onMouseDown={md(() => fmt("italic"))}>
        <span style={{ fontStyle: "italic", fontFamily: "Georgia, serif" }}>I</span>
      </button>
      <button style={btn(active.underline)} title="Underline" onMouseDown={md(() => fmt("underline"))}>
        <span style={{ textDecoration: "underline" }}>U</span>
      </button>
      {sep}
      {/* text color with live indicator */}
      <div style={{ position: "relative" }}>
        <button style={btn()} title="Text color" onMouseDown={md(() => { setColorOpen((v) => !v); setHlOpen(false); setStyleOpen(false); })}>
          <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontWeight: 800, fontSize: "13px", lineHeight: 1 }}>A</span>
            <span style={{ width: "15px", height: "3px", borderRadius: "2px", background: active.color, marginTop: "1px" }} />
          </span>
          <span style={{ fontSize: "9px", color: "var(--muted)" }}>▾</span>
        </button>
        {colorOpen && (
          <div style={swatchPop}>
            {penColors.map((c, i) => (
              <button key={i} title="Set color" onMouseDown={md(() => { color(c); setColorOpen(false); })} style={{ ...swatch, background: c, borderRadius: "50%" }} />
            ))}
          </div>
        )}
      </div>
      {/* highlight */}
      <div style={{ position: "relative" }}>
        <button style={btn()} title="Highlight" onMouseDown={md(() => { setHlOpen((v) => !v); setColorOpen(false); setStyleOpen(false); })}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
            <path d="M4 20h16" stroke={accent} strokeWidth="2.4" strokeLinecap="round" />
            <path d="M9 15l-2 .5.5-2 7-7 1.5 1.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          <span style={{ fontSize: "9px", color: "var(--muted)" }}>▾</span>
        </button>
        {hlOpen && (
          <div style={swatchPop}>
            {Array.from({ length: 10 }, (_, i) => COLOR_MAP[(i + 1) as MarkColor]).map((c, i) => (
              <button key={i} title="Highlight" onMouseDown={md(() => { highlight(c); setHlOpen(false); })} style={{ ...swatch, background: c, borderRadius: "4px" }} />
            ))}
          </div>
        )}
      </div>
      {sep}
      {/* lists */}
      <button style={btn()} title="Numbered list" onMouseDown={md(() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined))}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M10 6h10M10 12h10M10 18h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><text x="2" y="8" fontSize="7" fill="currentColor">1</text><text x="2" y="14" fontSize="7" fill="currentColor">2</text><text x="2" y="20" fontSize="7" fill="currentColor">3</text></svg>
      </button>
      <button style={btn()} title="Bulleted list" onMouseDown={md(() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined))}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 6h11M9 12h11M9 18h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><circle cx="4" cy="6" r="1.4" fill="currentColor"/><circle cx="4" cy="12" r="1.4" fill="currentColor"/><circle cx="4" cy="18" r="1.4" fill="currentColor"/></svg>
      </button>
      <button style={btn()} title="Checklist" onMouseDown={md(() => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined))}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><path d="M4.5 7.5 6 9l2.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><path d="M13 7h8M13 17h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
      </button>
      {sep}
      {/* indent / outdent */}
      <button style={btn()} title="Outdent" onMouseDown={md(() => editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined))}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20 6H4M20 12h-9M20 18H4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M7 9l-3 3 3 3z" fill="currentColor"/></svg>
      </button>
      <button style={btn()} title="Indent" onMouseDown={md(() => editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined))}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M11 12h9M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M4 9l3 3-3 3z" fill="currentColor"/></svg>
      </button>
      {sep}
      {/* align */}
      <button style={btn()} title="Align left" onMouseDown={md(() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "left"))}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h10M4 18h13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
      </button>
      <button style={btn()} title="Align center" onMouseDown={md(() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "center"))}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M7 12h10M6 18h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
      </button>
      {sep}
      {linkableVerses.length > 0 && (
        <button style={{ ...btn(), minWidth: undefined, padding: "0 10px" }} title="Link a verse" onMouseDown={md(onLinkOpen)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M10 14a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 0 0-5.66-5.66L11 7M14 10a4 4 0 0 0-5.66 0l-2.83 2.83a4 4 0 0 0 5.66 5.66L13 17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></svg>
          <span style={{ fontSize: "12px", fontWeight: 600 }}>Link verse</span>
        </button>
      )}
    </div>
  );
}
const swatchPop: React.CSSProperties = { position: "absolute", top: "36px", left: 0, zIndex: 40, display: "flex", flexWrap: "wrap", gap: "6px", width: "170px", padding: "10px", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "9px", boxShadow: "0 10px 30px rgba(0,0,0,.4)" };
const swatch: React.CSSProperties = { width: "24px", height: "24px", border: "1.5px solid rgba(255,255,255,.18)", cursor: "pointer" };

function useInsertChip() {
  const [editor] = useLexicalComposerContext();
  return useCallback(
    (ref: string) => {
      editor.update(() => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) {
          const node = $createTextNode("\u2937\u00a0" + ref + "\u00a0");
          node.setStyle("color: #8b5cf6; font-weight: 600;");
          sel.insertNodes([node]);
        }
      });
    },
    [editor]
  );
}

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
    // eslint-disable-next-line
  }, []);
  return null;
}

const editorTheme = {
  heading: { h1: "rt-h1", h2: "rt-h2" },
  quote: "rt-quote",
  list: { ol: "rt-ol", ul: "rt-ul", listitem: "rt-li" },
  text: { bold: "rt-bold", italic: "rt-italic", underline: "rt-underline" },
};

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
  const [openThemes, setOpenThemes] = useState<Record<string, boolean>>({});
  const [linkFilter, setLinkFilter] = useState("");
  const [preview, setPreview] = useState<{ ref: string; focused: boolean } | null>(null);
  const has = (value || "").trim().length > 0;
  const htmlRef = useRef(value);

  const initialConfig = {
    namespace: "scribal-note",
    theme: editorTheme,
    onError: (e: Error) => console.error("Lexical:", e),
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode],
  };

  const groups: { name: string; color: MarkColor | null; verses: LinkableVerse[] }[] = [];
  linkableVerses.forEach((v) => {
    let g = groups.find((x) => x.name === v.themeName);
    if (!g) { g = { name: v.themeName, color: v.color, verses: [] }; groups.push(g); }
    g.verses.push(v);
  });
  const filtered = (vs: LinkableVerse[]) =>
    !linkFilter.trim()
      ? vs
      : vs.filter((v) => v.reference.toLowerCase().includes(linkFilter.toLowerCase()) || v.text.toLowerCase().includes(linkFilter.toLowerCase()));

  const onRestingClick = useCallback((e: React.MouseEvent) => {
    const t = (e.target as HTMLElement).closest(".scribal-vchip");
    if (t) {
      const ref = t.getAttribute("data-ref");
      if (ref) setPreview({ ref, focused: true });
    }
  }, []);

  if (editing) {
    return (
      <div style={{ border: "1px solid #8b5cf6", borderRadius: "8px", overflow: "visible", background: "var(--soft)" }}>
        <LexicalComposer initialConfig={initialConfig}>
          <Toolbar accent={accent} linkableVerses={linkableVerses} onLinkOpen={() => setLinkOpen((v) => !v)} />
          <div style={{ position: "relative" }}>
            <RichTextPlugin
              contentEditable={<ContentEditable className="scribal-rich-editor" style={{ padding: "11px 12px", minHeight: "96px", fontSize: "13.5px", lineHeight: 1.7, color: "var(--text)", outline: "none", fontFamily: "system-ui, sans-serif" }} />}
              placeholder={<div style={{ position: "absolute", top: "11px", left: "12px", color: "var(--muted)", fontSize: "13.5px", pointerEvents: "none" }}>{placeholder || "Write a note…"}</div>}
              ErrorBoundary={LexicalErrorBoundary}
            />
          </div>
          <ListPlugin />
          <CheckListPlugin />
          <HistoryPlugin />
          <InitPlugin html={value} />
          <OnChangePlugin onChange={(editorState: any, editor: any) => { editorState.read(() => { htmlRef.current = $generateHtmlFromNodes(editor, null); }); }} />
          <ChipInserter open={linkOpen} groups={groups} filtered={filtered} openThemes={openThemes} setOpenThemes={setOpenThemes} linkFilter={linkFilter} setLinkFilter={setLinkFilter} onClose={() => setLinkOpen(false)} />
        </LexicalComposer>
        <div style={{ display: "flex", gap: "8px", padding: "10px 12px" }}>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(htmlRef.current); setEditing(false); setLinkOpen(false); }} style={doneBtn}>Done</button>
          {has && <button onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(""); setEditing(false); }} style={delBtn}>Delete</button>}
        </div>
      </div>
    );
  }

  if (has) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", borderLeft: "3px solid " + accent, background: "var(--soft)", borderRadius: "0 8px 8px 0", padding: "10px 12px" }}>
          <div className="scribal-rich-view" onClick={onRestingClick} style={{ flex: 1, fontSize: "13.5px", lineHeight: 1.6, color: "var(--text)", fontFamily: "system-ui, sans-serif", overflowWrap: "anywhere" }}
            dangerouslySetInnerHTML={{ __html: isPlainText(value) ? value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>") : value }} />
          <button onClick={() => setEditing(true)} style={editBtn}>Edit</button>
        </div>
        {preview && <PreviewCard preview={preview} setPreview={setPreview} focusedFor={focusedFor} fullTextFor={fullTextFor} onJumpToReference={onJumpToReference} />}
      </div>
    );
  }

  return (
    <button onClick={() => setEditing(true)} aria-label={addLabel || "Add a note"} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "1px dashed var(--border)", borderRadius: "8px", padding: "10px", cursor: "pointer", fontFamily: "system-ui, sans-serif" }}>
      <span style={{ fontSize: "20px", fontWeight: 700, color: accent, lineHeight: 1 }}>+</span>
    </button>
  );
}

function ChipInserter({ open, groups, filtered, openThemes, setOpenThemes, linkFilter, setLinkFilter, onClose }: any) {
  const insertChip = useInsertChip();
  if (!open) return null;
  return (
    <div style={{ margin: "0 10px 10px", border: "1px solid #8b5cf6", borderRadius: "10px", background: "var(--panel)", maxHeight: "300px", overflowY: "auto" }}>
      <div style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)" }}>
        <input value={linkFilter} onChange={(e) => setLinkFilter(e.target.value)} placeholder="Filter verses in this study…" style={{ width: "100%", background: "var(--soft)", border: "1px solid var(--border)", borderRadius: "7px", padding: "7px 10px", color: "var(--text)", fontSize: "12.5px", fontFamily: "inherit", outline: "none" }} />
      </div>
      {groups.map((g: any) => {
        const vs = filtered(g.verses);
        if (!vs.length) return null;
        const isOpen = openThemes[g.name] ?? !!linkFilter.trim();
        return (
          <div key={g.name} style={{ borderBottom: "1px solid var(--border)" }}>
            <div onMouseDown={(e: React.MouseEvent) => { e.preventDefault(); setOpenThemes((p: any) => ({ ...p, [g.name]: !isOpen })); }} style={{ display: "flex", alignItems: "center", gap: "9px", padding: "10px 12px", cursor: "pointer" }}>
              <span style={{ width: "11px", height: "11px", borderRadius: "50%", background: g.color ? COLOR_MAP[g.color as MarkColor] : "var(--muted)" }} />
              <span style={{ fontSize: "12.5px", fontWeight: 800, flex: 1 }}>{g.name}</span>
              <span style={{ fontSize: "10.5px", color: "var(--muted)" }}>{vs.length}</span>
              <span style={{ color: "var(--muted)", fontSize: "11px", transform: isOpen ? "rotate(90deg)" : "none" }}>›</span>
            </div>
            {isOpen && vs.map((v: LinkableVerse) => (
              <div key={v.reference} onMouseDown={(e) => { e.preventDefault(); insertChip(v.reference); onClose(); }} style={{ display: "flex", gap: "9px", padding: "8px 12px 8px 34px", cursor: "pointer", alignItems: "flex-start" }}>
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

function PreviewCard({ preview, setPreview, focusedFor, fullTextFor, onJumpToReference }: any) {
  return (
    <div style={{ marginTop: "8px", border: "1px solid #8b5cf6", borderRadius: "11px", background: "var(--panel)", overflow: "hidden", maxWidth: "360px", boxShadow: "0 14px 40px rgba(0,0,0,.5)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "9px 12px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: "11px", fontWeight: 800 }}>{preview.ref}</span>
        <span onClick={() => setPreview(null)} style={{ marginLeft: "auto", color: "var(--muted)", fontSize: "14px", cursor: "pointer" }}>✕</span>
      </div>
      <div style={{ display: "flex", margin: "9px 12px", background: "var(--soft)", borderRadius: "8px", padding: "3px" }}>
        {(["full", "focused"] as const).map((m) => {
          const on = preview.focused === (m === "focused");
          return (
            <button key={m} onClick={() => setPreview({ ref: preview.ref, focused: m === "focused" })} style={{ flex: 1, border: "none", background: on ? "#8b5cf6" : "transparent", color: on ? "#fff" : "var(--muted)", fontSize: "11px", fontWeight: 700, padding: "6px", borderRadius: "6px", cursor: "pointer", fontFamily: "inherit" }}>
              {m === "full" ? "Full verse" : "Focused"}
            </button>
          );
        })}
      </div>
      <div style={{ padding: "2px 13px 12px", fontFamily: '"Times New Roman", Times, serif', fontSize: "13.5px", lineHeight: 1.7, color: "var(--text)" }}>
        {preview.focused ? (focusedFor && focusedFor(preview.ref)) || "(no marked fragments)" : (fullTextFor && fullTextFor(preview.ref)) || preview.ref}
      </div>
      {onJumpToReference && (
        <div style={{ display: "flex", padding: "9px 12px", borderTop: "1px solid var(--border)", background: "var(--soft)" }}>
          <button onClick={() => { onJumpToReference(preview.ref); setPreview(null); }} style={{ marginLeft: "auto", border: "1px solid #8b5cf6", background: "transparent", color: "#c4aef6", borderRadius: "7px", padding: "6px 11px", fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Open in reader ↗</button>
        </div>
      )}
    </div>
  );
}

const doneBtn: React.CSSProperties = { background: "#8b5cf6", color: "#fff", border: "none", borderRadius: "8px", padding: "7px 16px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", fontFamily: "system-ui, sans-serif" };
const delBtn: React.CSSProperties = { background: "transparent", border: "1px solid var(--border)", borderRadius: "8px", padding: "7px 14px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", fontFamily: "system-ui, sans-serif", color: "var(--muted)" };
const editBtn: React.CSSProperties = { flexShrink: 0, background: "transparent", border: "1px solid var(--border)", borderRadius: "8px", padding: "5px 12px", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "system-ui, sans-serif", color: "var(--muted)" };
