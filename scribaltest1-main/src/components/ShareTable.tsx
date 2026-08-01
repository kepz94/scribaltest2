// ShareTable.tsx
// The two surfaces of "Send a copy": the sender's sheet (what travels → the
// code) and the recipient's (six characters → what's arriving → save).
//
// One component file for both shells. The dialogs are centred overlays rather
// than a phone sheet plus a desktop modal, because every word in them is the
// same on both and two copies of this wording would drift.
//
// Nothing here decides what travels — that is packShare/installShare in
// shareTable.ts, which is pure and tested. These are the words and the buttons.

import { useEffect, useRef, useState } from "react";
import {
  ShareFailure,
  shareErrorText,
  shareInstructions,
  summarize,
  savedShareAt,
} from "../shareTable";
// Separate type-only import: TS 4.4.4 has no inline `type` modifier in a
// named import list (a standing constraint — see the working agreements).
import type { SharePayload, ShareSummary } from "../shareTable";

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF = 'Iowan Old Style, "Palatino Linotype", Palatino, Georgia, serif';
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace';

const CODE_LEN = 6;

function Shell({
  children,
  onClose,
  wide,
}: {
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(30,25,15,.4)",
        display: "grid",
        placeItems: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: 22,
          maxWidth: wide ? 460 : 390,
          width: "100%",
          maxHeight: "88vh",
          overflowY: "auto",
          boxShadow: "0 24px 60px -20px rgba(30,25,10,.5)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

const titleStyle = {
  fontFamily: SERIF,
  fontSize: 20,
  fontWeight: 600,
  color: "var(--text)",
} as const;

const subStyle = {
  fontFamily: SANS,
  fontSize: 13,
  color: "var(--muted)",
  lineHeight: 1.5,
} as const;

const btn = (kind: "primary" | "ghost", accent: string) =>
  ({
    fontFamily: SANS,
    fontSize: 13.5,
    fontWeight: 600,
    cursor: "pointer",
    borderRadius: 9,
    padding: "9px 16px",
    ...(kind === "primary"
      ? { color: "#fff", background: accent, border: 0 }
      : {
          color: "var(--text)",
          background: "transparent",
          border: "1px solid var(--border)",
        }),
  } as const);

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 11, alignItems: "baseline" }}>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 9.5,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "var(--muted)",
          width: 62,
          flex: "0 0 auto",
        }}
      >
        {k}
      </span>
      <span style={{ fontFamily: SANS, fontSize: 13, color: "var(--text)" }}>
        {children}
      </span>
    </div>
  );
}

function Switch({
  on,
  onToggle,
  label,
  hint,
  accent,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  hint: string;
  accent: string;
}) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={on}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: 0,
        borderTop: "1px solid var(--border)",
        padding: "11px 0",
        cursor: "pointer",
      }}
    >
      <span style={{ flex: 1, display: "block" }}>
        <span
          style={{
            display: "block",
            fontFamily: SANS,
            fontSize: 13.5,
            color: "var(--text)",
          }}
        >
          {label}
        </span>
        <span
          style={{
            display: "block",
            fontFamily: SANS,
            fontSize: 11.5,
            color: "var(--muted)",
            marginTop: 1,
          }}
        >
          {hint}
        </span>
      </span>
      <span
        style={{
          width: 40,
          height: 24,
          borderRadius: 12,
          background: on ? accent : "var(--border)",
          position: "relative",
          flex: "0 0 auto",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: on ? 18 : 2,
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 2px rgba(0,0,0,.25)",
          }}
        />
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- sender

export function SendCopyDialog({
  summary,
  noteCount,
  onCreate,
  onClose,
  accent,
}: {
  // Counts of the table as it stands, with everything included. The dialog
  // states what travels BEFORE anything is packed, so the sender decides on
  // facts rather than on a guess.
  summary: ShareSummary;
  noteCount: number;
  onCreate: (
    includeMarks: boolean,
    includeNotes: boolean
  ) => Promise<{ code: string; name: string }>;
  onClose: () => void;
  accent: string;
}) {
  const [marks, setMarks] = useState(true);
  const [notes, setNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [big, setBig] = useState(false);

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const made = await onCreate(marks, notes);
      setCode(made.code);
    } catch (e) {
      setErr(
        e instanceof ShareFailure
          ? shareErrorText(e.reason)
          : shareErrorText("offline")
      );
    }
    setBusy(false);
  };

  const copy = () => {
    const text = shareInstructions(code || "", summary.name);
    try {
      void navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setErr("Couldn’t copy. Write the code down instead.");
    }
  };

  // The projector view: a code big enough for a room to read off a screen.
  if (code && big) {
    return (
      <div
        onClick={() => setBig(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 70,
          background: "var(--text)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 22,
          padding: 30,
          cursor: "pointer",
        }}
      >
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 24,
            fontWeight: 600,
            color: "var(--bg)",
            opacity: 0.8,
            textAlign: "center",
          }}
        >
          {summary.name}
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: "min(17vw, 110px)",
            fontWeight: 700,
            letterSpacing: ".16em",
            textIndent: ".16em",
            color: "var(--bg)",
            lineHeight: 1,
          }}
        >
          {code}
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 15,
            color: "var(--bg)",
            opacity: 0.62,
            textAlign: "center",
          }}
        >
          Scribal → Study tables → New study table → Enter a code
        </div>
      </div>
    );
  }

  if (code) {
    return (
      <Shell onClose={onClose}>
        <div style={titleStyle}>Ready to send</div>
        <div
          style={{
            background: "var(--soft, var(--bg))",
            border: "1px solid var(--border)",
            borderRadius: 13,
            padding: "18px 12px 13px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 7,
            margin: "14px 0",
          }}
        >
          <div
            style={{
              fontFamily: MONO,
              fontSize: 34,
              fontWeight: 600,
              letterSpacing: ".17em",
              textIndent: ".17em",
              color: "var(--text)",
            }}
          >
            {code}
          </div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: ".07em",
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            Works for 7 days
          </div>
        </div>
        <div style={{ ...subStyle, marginBottom: 16 }}>
          They open Scribal, go to <b style={{ color: "var(--text)" }}>Study
          tables → New study table → Enter a code</b>, and type these six
          characters. Their copy is theirs to keep — it outlives the code.
        </div>
        {err && (
          <div style={{ ...subStyle, color: "var(--pen1)", marginBottom: 12 }}>
            {err}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={() => setBig(true)} style={btn("ghost", accent)}>
            Show large
          </button>
          <button onClick={copy} style={btn("primary", accent)}>
            {copied ? "Copied" : "Copy code"}
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose} wide>
      <div style={titleStyle}>Send a copy</div>
      <div style={{ ...subStyle, margin: "5px 0 15px" }}>
        They get their own table to build on. Yours stays as it is, and nothing
        syncs between them afterwards.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <Fact k="Cards">{summary.cardCount}</Fact>
        <Fact k="Verses">
          {summary.verseCount}
          {summary.chapters.length
            ? " across " + summary.chapters.join(", ")
            : ""}
        </Fact>
        <Fact k="Tray">
          {"Stays with you — only the column travels"}
        </Fact>
      </div>
      <div style={{ marginTop: 13 }}>
        <Switch
          on={marks}
          onToggle={() => setMarks((v) => !v)}
          label="Include my marking"
          hint="Off sends clean scripture for them to mark themselves"
          accent={accent}
        />
        <Switch
          on={notes}
          onToggle={() => setNotes((v) => !v)}
          label="Include my private notes"
          hint={
            noteCount === 0
              ? "No note cards in this table"
              : noteCount +
                (noteCount === 1 ? " note card" : " note cards") +
                " — off leaves them out entirely"
          }
          accent={accent}
        />
      </div>
      {err && (
        <div style={{ ...subStyle, color: "var(--pen1)", margin: "12px 0 0" }}>
          {err}
        </div>
      )}
      <div
        style={{
          display: "flex",
          gap: 10,
          justifyContent: "flex-end",
          marginTop: 18,
          borderTop: "1px solid var(--border)",
          paddingTop: 16,
        }}
      >
        <button onClick={onClose} style={btn("ghost", accent)}>
          Cancel
        </button>
        <button
          onClick={create}
          disabled={busy}
          style={{ ...btn("primary", accent), opacity: busy ? 0.5 : 1 }}
        >
          {busy ? "Creating…" : "Create code"}
        </button>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------- recipient

export function EnterCodeDialog({
  onLookup,
  onSave,
  onClose,
  accent,
}: {
  onLookup: (code: string) => Promise<SharePayload>;
  onSave: (payload: SharePayload, code: string) => void;
  onClose: () => void;
  accent: string;
}) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [found, setFound] = useState<SharePayload | null>(null);
  const [seenBefore, setSeenBefore] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LEN);
  const ready = code.length === CODE_LEN;

  const look = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const payload = await onLookup(code);
      setSeenBefore(savedShareAt(code));
      setFound(payload);
    } catch (e) {
      setErr(
        e instanceof ShareFailure
          ? shareErrorText(e.reason)
          : shareErrorText("offline")
      );
    }
    setBusy(false);
  };

  if (found) {
    const s = summarize(found);
    return (
      <Shell onClose={onClose} wide>
        <div
          style={{
            background: "var(--soft, var(--bg))",
            border: "1px solid " + accent,
            borderRadius: 12,
            padding: 13,
            marginBottom: 14,
          }}
        >
          <div style={{ fontFamily: SANS, fontSize: 11.5, color: "var(--muted)" }}>
            {s.senderName ? s.senderName + " sent you" : "Someone sent you"}
          </div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 19,
              fontWeight: 600,
              color: "var(--text)",
              lineHeight: 1.2,
              marginTop: 2,
            }}
          >
            {s.name || "Untitled"}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <Fact k="Cards">{s.cardCount}</Fact>
          <Fact k="Verses">
            {s.verseCount}
            {s.chapters.length ? " · " + s.chapters.join(", ") : ""}
          </Fact>
          <Fact k="Marking">
            {s.marksIncluded
              ? s.markCount + (s.markCount === 1 ? " mark" : " marks")
              : "Not included — clean scripture"}
          </Fact>
        </div>
        <div
          style={{
            ...subStyle,
            background: "var(--soft, var(--bg))",
            borderRadius: 9,
            padding: "10px 11px",
            margin: "14px 0 0",
          }}
        >
          Saves as a <b style={{ color: "var(--text)" }}>new table</b> in a{" "}
          <b style={{ color: "var(--text)" }}>new notebook</b> called “
          {s.name || "Untitled"}”. Your own marking isn’t touched.
        </div>
        {seenBefore !== null && (
          <div
            style={{
              ...subStyle,
              color: "var(--text)",
              marginTop: 12,
              fontWeight: 600,
            }}
          >
            You saved this on{" "}
            {new Date(seenBefore).toLocaleDateString(undefined, {
              weekday: "long",
            })}
            . Save another copy?
          </div>
        )}
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            marginTop: 18,
          }}
        >
          <button onClick={onClose} style={btn("ghost", accent)}>
            Not now
          </button>
          <button
            onClick={() => onSave(found, code)}
            style={btn("primary", accent)}
          >
            {seenBefore !== null ? "Save another" : "Save to my tables"}
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose}>
      <div style={titleStyle}>Enter a code</div>
      <div style={{ ...subStyle, margin: "5px 0 16px" }}>
        Six characters, from whoever sent you the table.
      </div>
      <div
        style={{ position: "relative", cursor: "text" }}
        onClick={() => inputRef.current?.focus()}
      >
        <div style={{ display: "flex", gap: 7, justifyContent: "center" }}>
          {Array.from({ length: CODE_LEN }, (_, i) => {
            const ch = code[i] || "";
            const here = i === code.length;
            return (
              <span
                key={i}
                style={{
                  width: 42,
                  height: 54,
                  border:
                    "1px solid " + (ch || here ? accent : "var(--border)"),
                  borderRadius: 10,
                  background: "var(--panel)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: MONO,
                  fontSize: 24,
                  fontWeight: 600,
                  color: "var(--text)",
                }}
              >
                {ch}
              </span>
            );
          })}
        </div>
        {/* The real field, invisible over the boxes. One input rather than six
            keeps paste working and keeps focus from hopping on iOS; 16px is
            the floor that stops Safari zooming the page on focus. */}
        <input
          ref={inputRef}
          value={code}
          onChange={(e) => {
            setRaw(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && look()}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Six-character code"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: 0,
            fontSize: 16,
            border: 0,
            background: "transparent",
          }}
        />
      </div>
      {err && (
        <div
          style={{
            ...subStyle,
            color: "var(--text)",
            textAlign: "center",
            marginTop: 14,
          }}
        >
          {err}
        </div>
      )}
      <div
        style={{
          display: "flex",
          gap: 10,
          justifyContent: "flex-end",
          marginTop: 18,
        }}
      >
        <button onClick={onClose} style={btn("ghost", accent)}>
          Back
        </button>
        <button
          onClick={look}
          disabled={!ready || busy}
          style={{
            ...btn("primary", accent),
            opacity: !ready || busy ? 0.4 : 1,
            cursor: !ready || busy ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Looking…" : "Find it"}
        </button>
      </div>
    </Shell>
  );
}
