import { useState, useRef, useEffect, useCallback } from "react";
import { Mark, MarkColor, COLOR_MAP } from "../types";

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
  const exec = (cmd: string, arg?: string) => {
    editorRef.current?.focus();
    if (savedRange.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedRange.current);
    }
    document.execCommand(cmd, false, arg);
    commit();
  };
  const rememberSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) savedRange.current = sel.getRangeAt(0).cloneRange();
  };

  const setBlock = (tag: string) => exec("formatBlock", tag);
  const setColor = (c: string) => {
    exec("foreColor", c);
    setColorOpen(false);
  };
  const setHighlight = (c: string) => {
    exec("hiliteColor", c);
    setHlOpen(false);
  };

  const insertVerseChip = (ref: string) => {
    editorRef.current?.focus();
    if (savedRange.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedRange.current);
    }
    // A chip is a styled, non-editable span carrying the reference.
    const chip =
      '<span data-ref="' +
      ref.replace(/"/g, "") +
      '" class="scribal-vchip" style="color: #8b5cf6; font-weight: 600;">\u2937\u00a0' +
      ref +
      "</span>\u00a0";
    document.execCommand("insertHTML", false, chip);
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
  const onRestingClick = useCallback((e: React.MouseEvent) => {
    const t = (e.target as HTMLElement).closest(".scribal-vchip");
    if (t) {
      const ref = t.getAttribute("data-ref");
      if (ref) setPreview({ ref, focused: true });
    }
  }, []);

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
          <select
            onChange={(e) => {
              setBlock(e.target.value);
              e.target.selectedIndex = 0;
            }}
            style={{
              height: "30px",
              background: "transparent",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              fontSize: "11.5px",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
            defaultValue=""
          >
            <option value="" disabled>
              Style
            </option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="p">Body</option>
          </select>
          {sep}
          <button style={{ ...tb, fontWeight: 800 }} onClick={() => exec("bold")}>
            B
          </button>
          <button style={{ ...tb, fontStyle: "italic" }} onClick={() => exec("italic")}>
            I
          </button>
          <button
            style={{ ...tb, textDecoration: "underline" }}
            onClick={() => exec("underline")}
          >
            U
          </button>
          {sep}
          {/* text color */}
          <div style={{ position: "relative" }}>
            <button
              style={tb}
              onClick={() => {
                rememberSelection();
                setColorOpen((v) => !v);
                setHlOpen(false);
              }}
              title="Text color"
            >
              <span
                style={{
                  width: "14px",
                  height: "14px",
                  borderRadius: "50%",
                  background: accent,
                  border: "1.5px solid rgba(255,255,255,.2)",
                }}
              />
              <span style={{ fontSize: "9px" }}>▾</span>
            </button>
            {colorOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "34px",
                  left: 0,
                  zIndex: 30,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "6px",
                  width: "160px",
                  padding: "9px",
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: "9px",
                  boxShadow: "0 10px 30px rgba(0,0,0,.4)",
                }}
              >
                {penColors.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => setColor(c)}
                    style={{
                      width: "22px",
                      height: "22px",
                      borderRadius: "50%",
                      background: c,
                      border: "1.5px solid rgba(255,255,255,.18)",
                      cursor: "pointer",
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          {/* highlight */}
          <div style={{ position: "relative" }}>
            <button
              style={tb}
              onClick={() => {
                rememberSelection();
                setHlOpen((v) => !v);
                setColorOpen(false);
              }}
              title="Highlight"
            >
              <span
                style={{
                  width: "14px",
                  height: "14px",
                  borderRadius: "3px",
                  background: accent + "80",
                }}
              />
              <span style={{ fontSize: "9px" }}>▾</span>
            </button>
            {hlOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "34px",
                  left: 0,
                  zIndex: 30,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "6px",
                  width: "160px",
                  padding: "9px",
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: "9px",
                  boxShadow: "0 10px 30px rgba(0,0,0,.4)",
                }}
              >
                {Array.from({ length: 10 }, (_, i) => COLOR_MAP[(i + 1) as MarkColor]).map(
                  (c, i) => (
                    <button
                      key={i}
                      onClick={() => setHighlight(c)}
                      style={{
                        width: "22px",
                        height: "22px",
                        borderRadius: "4px",
                        background: c,
                        border: "1.5px solid rgba(255,255,255,.18)",
                        cursor: "pointer",
                      }}
                    />
                  )
                )}
              </div>
            )}
          </div>
          {sep}
          <button style={tb} onClick={() => exec("insertOrderedList")} title="Numbered list">
            1.
          </button>
          <button
            style={tb}
            onClick={() => {
              // checklist = unordered list flagged for checkbox styling
              exec("insertUnorderedList");
              // tag the nearest list as a checklist
              const sel = window.getSelection();
              const li = (sel?.anchorNode as HTMLElement | null)?.parentElement?.closest(
                "li"
              );
              const ul = li?.closest("ul");
              if (ul) ul.setAttribute("data-checklist", "1");
              commit();
            }}
            title="Checklist"
          >
            ☑
          </button>
          <button style={tb} onClick={() => exec("insertUnorderedList")} title="Bullets">
            •
          </button>
          <button style={tb} onClick={() => exec("indent")} title="Indent">
            ⇥
          </button>
          {sep}
          <button style={tb} onClick={() => exec("justifyLeft")} title="Align left">
            ≡
          </button>
          <button style={tb} onClick={() => exec("justifyCenter")} title="Align center">
            ≣
          </button>
          {sep}
          <button
            style={tb}
            onClick={() => exec("formatBlock", "blockquote")}
            title="Block quote"
          >
            ❝
          </button>
          <button style={tb} onClick={() => exec("insertHorizontalRule")} title="Divider">
            —
          </button>
          {sep}
          {linkableVerses.length > 0 && (
            <button
              style={tb}
              onClick={() => {
                rememberSelection();
                setLinkOpen((v) => !v);
              }}
              title="Link a verse"
            >
              ⤷ <span style={{ fontSize: "10.5px" }}>Link verse</span>
            </button>
          )}
          <button
            style={tb}
            onClick={() => exec("removeFormat")}
            title="Clear formatting"
          >
            ⌫
          </button>
        </div>

        {/* the editable surface */}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={commit}
          onBlur={commit}
          onPaste={handlePaste}
          onKeyUp={rememberSelection}
          onMouseUp={rememberSelection}
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
