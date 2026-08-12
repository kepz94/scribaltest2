import { useMemo, useState } from "react";
import { ACCENT } from "../theme";
import { Mark, WordTag } from "../types";
import MarkedVerse from "./MarkedVerse";
import RichNoteField from "./RichNoteField";
import { verseList, VerseRec } from "../data/verseIndex";
import {
  ParallelAlignment,
  Slots,
  slotsFor,
  rowCount,
  nudge,
  pairRows,
} from "../parallelAlign";
import { alignSequences, groupByCorrespondence } from "../parallelMatch";

// The Parallel compile view: a study's chapters laid side by side, one column
// each, so parallel accounts can be read across instead of one after another.
//
// Scribal could already SHOW several chapters at once — the reading row holds up
// to eight. What it could not do is say that two verses are the same verse and
// keep that judgment. That is all this view adds: a row correspondence, plus
// somewhere to write down what the comparison shows.
//
// Rows come from parallelAlign; matches come from parallelMatch; both are pure
// and tested. This file is the surface over them.

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF =
  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif';

const GUTTER_W = 44;
const DRAWER_W = 320;

// Columns FIT THE WINDOW rather than claiming a minimum width.
//
// The first attempt gave each column a floor — 168px at eight columns — which
// reads well but needs 1388px of board to show all eight, and anything narrower
// silently pushed the rest into the horizontal scroll. Asking for eight columns
// and being shown four is the wrong answer however good the four look, so the
// grid is `minmax(0, 1fr)`: every column always on screen, sharing whatever
// width there is.
//
// Wide mode is the escape hatch. It restores generous columns and lets the
// board scroll sideways, for when reading one account matters more than seeing
// all of them at once.
const WIDE_COL = 300;

// One shared empty array, so a verse with no marks never mints a new one and
// MarkedVerse's props stay referentially stable across renders.
const NO_MARKS: Mark[] = [];

export interface ParallelViewProps {
  // Ordered chapter scopes ("Genesis 1", "Isaiah 51"), one per column. Derived
  // from the study's compile tabs by the caller, which already owns the tab ->
  // scope mapping.
  chapters: string[];
  marks: Mark[];
  tags?: WordTag[];
  notes: Record<string, string>;
  setNote: (key: string, text: string) => void;
  // The study synthesis, resolved by the caller exactly as the other compile
  // views resolve it, so all four doorways read and write ONE note.
  synthesisValue: string;
  onSynthesis: (text: string) => void;
  alignment: ParallelAlignment | undefined;
  onAlignment: (
    a: Omit<ParallelAlignment, "updatedAt" | "scope" | "clearedAt">
  ) => void;
  onClearAlignment: () => void;
  dark: boolean;
}

interface Column {
  id: string;
  chapter: string;
  verses: VerseRec[];
}

// Which note key a verse's text lives under.
//
// Desktop verse notes are per-verse PER THEME COLOUR — "note|<chapterRef>|c<n>|
// <ref>" — because the Outline groups verses under the colour they are marked
// in. This view has no theme grouping, so it does two things: it reads whatever
// is already there under any colour (the way SemanticView does), and when
// writing it prefers the key that already holds text so a note is never
// duplicated into a second colour. Only a verse with no note at all picks a
// fresh key, and it picks the colour the verse is most marked in — which is
// where the Outline will show it.
const existingNoteKey = (
  notes: Record<string, string>,
  reference: string
): string | undefined => {
  const suffix = "|" + reference;
  let found: string | undefined;
  Object.keys(notes || {}).forEach((k) => {
    if (!found && k.startsWith("note|") && k.endsWith(suffix)) {
      if ((notes[k] || "").trim()) found = k;
    }
  });
  return found;
};

const noteKeyFor = (
  notes: Record<string, string>,
  reference: string,
  chapterRef: string,
  verseMarks: Mark[]
): string => {
  const existing = existingNoteKey(notes, reference);
  if (existing) return existing;
  const tally = new Map<number, number>();
  verseMarks.forEach((m) => tally.set(m.color, (tally.get(m.color) || 0) + 1));
  let color = 0;
  let best = 0;
  tally.forEach((n, c) => {
    if (n > best) {
      best = n;
      color = c;
    }
  });
  return "note|" + chapterRef + "|c" + color + "|" + reference;
};

const hasNote = (notes: Record<string, string>, reference: string): boolean =>
  !!existingNoteKey(notes, reference);

export default function ParallelView({
  chapters,
  marks,
  tags,
  notes,
  setNote,
  synthesisValue,
  onSynthesis,
  alignment,
  onAlignment,
  onClearAlignment,
  dark,
}: ParallelViewProps) {
  const [sel, setSel] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ colId: string; vi: number } | null>(
    null
  );
  const [message, setMessage] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  // Off by default: seeing every column beats giving any one of them room.
  const [wide, setWide] = useState(false);

  const columns: Column[] = useMemo(() => {
    const seen = new Set<string>();
    const out: Column[] = [];
    chapters.forEach((chapter) => {
      if (!chapter || seen.has(chapter)) return;
      seen.add(chapter);
      out.push({
        id: "col_" + chapter,
        chapter,
        verses: verseList.filter((v) => v.chapterRef === chapter),
      });
    });
    // A stored alignment carries the column ORDER as well as the rows, because
    // matching regroups the board so chapters telling the same account stand
    // together. Columns the stored order has never heard of keep their place at
    // the end, so adding a chapter to the study never scrambles the rest.
    const order = alignment && alignment.order;
    if (!order || !order.length) return out;
    const rank = new Map(order.map((id, i) => [id, i]));
    return out
      .map((c, i) => ({ c, i }))
      .sort((a, b) => {
        const ra = rank.has(a.c.id) ? (rank.get(a.c.id) as number) : order.length + a.i;
        const rb = rank.has(b.c.id) ? (rank.get(b.c.id) as number) : order.length + b.i;
        return ra - rb;
      })
      .map((x) => x.c);
  }, [chapters, alignment]);

  // One pass over the marks instead of one filter per cell. A full board is
  // eight columns of a long chapter — up to a few hundred cells — and each one
  // scanning the whole marks array turns a click into visible lag on a
  // well-marked book.
  const marksByRef = useMemo(() => {
    const m = new Map<string, Mark[]>();
    marks.forEach((k) => {
      const at = m.get(k.reference);
      if (at) at.push(k);
      else m.set(k.reference, [k]);
    });
    return m;
  }, [marks]);

  const slotsByCol = useMemo(() => {
    const m: Record<string, Slots> = {};
    columns.forEach((c) => {
      m[c.id] = slotsFor(alignment, c.id, c.verses.length);
    });
    return m;
  }, [columns, alignment]);

  const rows = useMemo(
    () =>
      rowCount(
        alignment,
        columns.map((c) => ({ id: c.id, verseCount: c.verses.length }))
      ),
    [alignment, columns]
  );

  const pinsOf = (colId: string): number[] =>
    (alignment && alignment.pins && alignment.pins[colId]) || [];

  const say = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage((m) => (m === text ? null : m)), 3200);
  };

  // Every edit writes the whole board, so one Reset undoes any single act and
  // the merge has one timestamp to reason about.
  const commit = (
    slots: Record<string, Slots>,
    pins: Record<string, number[]>
  ) => {
    onAlignment({
      order: columns.map((c) => c.id),
      slots,
      pins,
    });
  };

  const currentSlots = (): Record<string, Slots> => {
    const out: Record<string, Slots> = {};
    columns.forEach((c) => (out[c.id] = slotsByCol[c.id].slice()));
    return out;
  };
  const currentPins = (): Record<string, number[]> => {
    const out: Record<string, number[]> = {};
    columns.forEach((c) => (out[c.id] = pinsOf(c.id).slice()));
    return out;
  };

  const doNudge = (colId: string, vi: number, dir: 1 | -1) => {
    const res = nudge(slotsByCol[colId], pinsOf(colId), vi, dir);
    if (res.blocked) {
      say(
        dir === 1
          ? "Pinned below — unpin that verse to move this one further."
          : "Nothing to pull up into — this verse is as high as it goes."
      );
      return;
    }
    const slots = currentSlots();
    slots[colId] = res.slots;
    commit(slots, currentPins());
  };

  const doPair = (colId: string, vi: number) => {
    if (!pairing) {
      setPairing({ colId, vi });
      say("Now click the verse it lines up with.");
      return;
    }
    if (pairing.colId === colId) {
      setPairing({ colId, vi });
      return;
    }
    const res = pairRows(
      slotsByCol[pairing.colId],
      pairing.vi,
      slotsByCol[colId],
      vi
    );
    const slots = currentSlots();
    slots[pairing.colId] = res.aSlots;
    slots[colId] = res.bSlots;
    const pins = currentPins();
    if (pins[pairing.colId].indexOf(pairing.vi) === -1)
      pins[pairing.colId].push(pairing.vi);
    if (pins[colId].indexOf(vi) === -1) pins[colId].push(vi);
    commit(slots, pins);
    setPairing(null);
    say(
      res.shortfall
        ? "Paired as closely as a pin above allows."
        : "Paired on row " + (res.row + 1) + "."
    );
  };

  const unpin = (colId: string, vi: number) => {
    const pins = currentPins();
    pins[colId] = pins[colId].filter((p) => p !== vi);
    commit(currentSlots(), pins);
  };

  // Ask the text which verses correspond.
  //
  // A board can hold more than one account — Genesis 1 / Moses 2 / Abraham 4 is
  // the first creation account, Genesis 2 / Moses 3 / Abraham 5 the second, and
  // a study can carry all six at once. So this groups the columns first, stands
  // each account's chapters together, and aligns each group against its OWN
  // longest chapter. Aligning everything against the leftmost column would try
  // to match Moses 3 to Genesis 1, which share nothing, and scatter both
  // accounts across rows neither belongs on.
  //
  // Matches become pins, so every one of them is corrected with the same ⇄ and
  // ↓ as a pair made by hand.
  const matchByWording = () => {
    if (columns.length < 2) return;

    const groups = groupByCorrespondence(
      columns.map((c) => c.verses.map((v) => v.text))
    );

    const slots: Record<string, Slots> = {};
    const pins: Record<string, number[]> = {};
    let matched = 0;

    groups.forEach((group) => {
      // The longest chapter is the spine: it offers the most places for the
      // others to attach, and nothing has to be invented to hold a gap.
      const refIdx = group.reduce(
        (best, i) =>
          columns[i].verses.length > columns[best].verses.length ? i : best,
        group[0]
      );
      const ref = columns[refIdx];
      const refTexts = ref.verses.map((v) => v.text);
      slots[ref.id] = ref.verses.map((_, i) => i);
      pins[ref.id] = [];

      group.forEach((i) => {
        if (i === refIdx) return;
        const c = columns[i];
        const map = alignSequences(refTexts, c.verses.map((v) => v.text));
        const out: Slots = [];
        const p: number[] = [];
        let nextFree = 0;
        c.verses.forEach((_, vi) => {
          const m = map[vi];
          const target = m == null ? nextFree : Math.max(m, nextFree);
          while (out.length < target) out.push(null);
          out.push(vi);
          if (m != null) {
            p.push(vi);
            matched++;
          }
          nextFree = out.length;
        });
        slots[c.id] = out;
        pins[c.id] = p;
      });
    });

    if (!matched) {
      setBanner(
        "No wording matches found — these chapters differ too much to match automatically. Align them by hand."
      );
      return;
    }

    // Regroup the board so each account's chapters stand together.
    const order = groups.reduce(
      (acc: string[], g) => acc.concat(g.map((i) => columns[i].id)),
      []
    );
    onAlignment({ order, slots, pins });

    const accounts = groups.filter((g) => g.length > 1).length;
    setBanner(
      "Matched " +
        matched +
        " verse" +
        (matched === 1 ? "" : "s") +
        (accounts > 1
          ? " across " + accounts + " accounts, and stood each account's chapters together"
          : "") +
        ". Matched verses are pinned; correct any of them with ⇄ or ↓."
    );
  };

  if (columns.length < 2) {
    return (
      <div
        style={{
          padding: "64px 24px",
          textAlign: "center",
          fontFamily: SANS,
        }}
      >
        <div style={{ fontSize: "15px", color: "var(--text)", fontWeight: 600 }}>
          Parallel compares two or more chapters.
        </div>
        <div style={{ fontSize: "13.5px", color: "var(--muted)", marginTop: "6px" }}>
          {columns.length === 1
            ? "This study covers one. Link another chapter to compare it."
            : "This study has no chapters yet."}
        </div>
      </div>
    );
  }

  const selRec = (() => {
    if (!sel) return null;
    for (const c of columns) {
      const v = c.verses.find((x) => x.reference === sel);
      if (v) return { col: c, verse: v };
    }
    return null;
  })();

  const tight = !wide && columns.length > 4;
  const cellBase = {
    borderRight: "1px solid var(--border)",
    borderBottom: "1px solid var(--border)",
    padding: tight ? "9px 10px" : "12px 14px",
    minWidth: 0,
  } as const;

  return (
    <div style={{ fontFamily: SANS }}>
      {/* Board actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "0 0 10px",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: "12px", color: "var(--muted)" }}>
          {pairing
            ? "Now click the verse it lines up with…"
            : "⇄ pair two verses · ↓ ↑ nudge within a segment"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
          <button
            onClick={() => setWide((w) => !w)}
            title={
              wide
                ? "Fit every column on screen"
                : "Give columns room to read, and scroll the board sideways"
            }
            style={{
              background: wide ? "var(--soft)" : "var(--panel)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              borderRadius: "8px",
              padding: "6px 12px",
              font: "inherit",
              fontSize: "12.5px",
              cursor: "pointer",
            }}
          >
            {wide ? "Fit columns" : "Wider columns"}
          </button>
          <button
            onClick={matchByWording}
            title="Propose an alignment from the wording of the verses"
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              borderRadius: "8px",
              padding: "6px 12px",
              font: "inherit",
              fontSize: "12.5px",
              cursor: "pointer",
            }}
          >
            Match by wording
          </button>
          {alignment && (
            <button
              onClick={() => {
                onClearAlignment();
                setBanner(null);
                setPairing(null);
              }}
              style={{
                background: "none",
                border: "1px solid transparent",
                color: "var(--muted)",
                borderRadius: "8px",
                padding: "6px 12px",
                font: "inherit",
                fontSize: "12.5px",
                cursor: "pointer",
              }}
            >
              Reset alignment
            </button>
          )}
        </div>
      </div>

      {banner && (
        <div
          style={{
            padding: "9px 14px",
            fontSize: "12.5px",
            background: "var(--soft)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            marginBottom: "10px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <span style={{ flex: 1 }}>{banner}</span>
          <button
            onClick={() => setBanner(null)}
            aria-label="Dismiss"
            style={{
              background: "none",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "stretch", minWidth: 0 }}>
        <div
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            overflow: "auto",
            maxHeight: "62vh",
            border: "1px solid var(--border)",
            borderRadius: "10px",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                GUTTER_W +
                "px repeat(" +
                columns.length +
                (wide ? ", minmax(" + WIDE_COL + "px, 1fr))" : ", minmax(0, 1fr))"),
            }}
          >
            <div
              style={{
                ...cellBase,
                position: "sticky",
                top: 0,
                left: 0,
                zIndex: 4,
                background: "var(--soft)",
                padding: "9px 14px",
              }}
            />
            {columns.map((c) => (
              <div
                key={c.id}
                style={{
                  ...cellBase,
                  position: "sticky",
                  top: 0,
                  zIndex: 3,
                  background: "var(--soft)",
                  padding: "9px 14px",
                  fontSize: "12.5px",
                  fontWeight: 650,
                }}
              >
                {c.chapter}
                <span
                  style={{
                    color: "var(--muted)",
                    fontWeight: 400,
                    fontSize: "11.5px",
                    marginLeft: "7px",
                  }}
                >
                  {c.verses.length} verses
                </span>
              </div>
            ))}

            {Array.from({ length: rows }, (_, r) => (
              <Row
                key={r}
                r={r}
                columns={columns}
                slotsByCol={slotsByCol}
                pinsOf={pinsOf}
                marksByRef={marksByRef}
                notes={notes}
                tags={tags}
                dark={dark}
                sel={sel}
                pairing={pairing}
                cellBase={cellBase}
                onSelect={(ref) => setSel((s) => (s === ref ? null : ref))}
                onPair={doPair}
                onNudge={doNudge}
                onUnpin={unpin}
              />
            ))}
          </div>
        </div>

        {/* Verse note. Only present once a verse is chosen — an empty 320px
            panel sitting there permanently costs two whole columns, and on a
            board this wide the columns are the point. */}
        {selRec && (
        <aside
          style={{
            flex: "0 0 " + DRAWER_W + "px",
            marginLeft: "12px",
            maxHeight: "62vh",
            overflow: "auto",
            padding: "0 2px",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--muted)",
              fontWeight: 650,
              marginBottom: "8px",
            }}
          >
            Verse note
          </div>
          {selRec && (
            <div>
              <div style={{ fontSize: "13.5px", fontWeight: 650 }}>
                {selRec.verse.reference}
              </div>
              <div
                style={{
                  fontFamily: SERIF,
                  fontSize: "13.5px",
                  lineHeight: 1.6,
                  color: "var(--muted)",
                  borderLeft: "2px solid var(--border)",
                  paddingLeft: "10px",
                  margin: "8px 0 10px",
                }}
              >
                {selRec.verse.text}
              </div>
              <RichNoteField
                value={
                  notes[
                    noteKeyFor(
                      notes,
                      selRec.verse.reference,
                      selRec.col.chapter,
                      marksByRef.get(selRec.verse.reference) || NO_MARKS
                    )
                  ] || ""
                }
                onChange={(t) =>
                  setNote(
                    noteKeyFor(
                      notes,
                      selRec.verse.reference,
                      selRec.col.chapter,
                      marksByRef.get(selRec.verse.reference) || NO_MARKS
                    ),
                    t
                  )
                }
                accent={ACCENT}
                placeholder="What does this account say that the others don't?"
              />
            </div>
          )}
        </aside>
        )}
      </div>

      {/* Study synthesis — the same one Outline and Semantic show. */}
      <div style={{ marginTop: "18px" }}>
        <div
          style={{
            fontSize: "10px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--muted)",
            fontWeight: 650,
            marginBottom: "8px",
          }}
        >
          Synthesis
        </div>
        <RichNoteField
          value={synthesisValue}
          onChange={onSynthesis}
          accent={ACCENT}
          placeholder="What does this comparison show?"
        />
      </div>

      {message && (
        <div
          role="status"
          style={{
            position: "fixed",
            left: "50%",
            bottom: "26px",
            transform: "translateX(-50%)",
            background: "var(--text)",
            color: "var(--bg)",
            borderRadius: "8px",
            padding: "10px 16px",
            fontSize: "13px",
            zIndex: 60,
            boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
          }}
        >
          {message}
        </div>
      )}
    </div>
  );
}

// One board row. Split out so a selection change repaints rows rather than
// rebuilding the whole grid's JSX in one function.
function Row({
  r,
  columns,
  slotsByCol,
  pinsOf,
  marksByRef,
  notes,
  tags,
  dark,
  sel,
  pairing,
  cellBase,
  onSelect,
  onPair,
  onNudge,
  onUnpin,
}: {
  r: number;
  columns: Column[];
  slotsByCol: Record<string, Slots>;
  pinsOf: (colId: string) => number[];
  marksByRef: Map<string, Mark[]>;
  notes: Record<string, string>;
  tags?: WordTag[];
  dark: boolean;
  sel: string | null;
  pairing: { colId: string; vi: number } | null;
  cellBase: { [k: string]: string | number };
  onSelect: (ref: string) => void;
  onPair: (colId: string, vi: number) => void;
  onNudge: (colId: string, vi: number, dir: 1 | -1) => void;
  onUnpin: (colId: string, vi: number) => void;
}) {
  const stripe = r % 2 === 1;
  return (
    <>
      <div
        style={{
          ...cellBase,
          position: "sticky",
          left: 0,
          zIndex: 2,
          background: "var(--bg)",
          color: "var(--muted)",
          fontSize: "11.5px",
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
          padding: "12px 10px",
        }}
      >
        {r + 1}
      </div>
      {columns.map((c) => {
        const vi = slotsByCol[c.id][r];
        const rec = vi == null ? undefined : c.verses[vi];
        if (vi == null || !rec)
          return (
            <div
              key={c.id}
              style={{ ...cellBase, background: "var(--bg)" }}
              aria-hidden="true"
            />
          );

        return (
          <Cell
            key={c.id}
            colId={c.id}
            vi={vi}
            rec={rec}
            stripe={stripe}
            cellBase={cellBase}
            pinned={pinsOf(c.id).indexOf(vi) !== -1}
            selected={sel === rec.reference}
            pairing={pairing}
            noted={hasNote(notes, rec.reference)}
            verseMarks={marksByRef.get(rec.reference) || NO_MARKS}
            tags={tags}
            dark={dark}
            onSelect={onSelect}
            onPair={onPair}
            onNudge={onNudge}
            onUnpin={onUnpin}
          />
        );
      })}
    </>
  );
}

// One verse. Owns its own hover state so the alignment controls stay out of the
// way until they are wanted — a board that shows four buttons on every verse is
// a board you cannot read, and reading is the point.
function Cell({
  colId,
  vi,
  rec,
  stripe,
  cellBase,
  pinned,
  selected,
  pairing,
  noted,
  verseMarks,
  tags,
  dark,
  onSelect,
  onPair,
  onNudge,
  onUnpin,
}: {
  colId: string;
  vi: number;
  rec: VerseRec;
  stripe: boolean;
  cellBase: { [k: string]: string | number };
  pinned: boolean;
  selected: boolean;
  pairing: { colId: string; vi: number } | null;
  noted: boolean;
  verseMarks: Mark[];
  tags?: WordTag[];
  dark: boolean;
  onSelect: (ref: string) => void;
  onPair: (colId: string, vi: number) => void;
  onNudge: (colId: string, vi: number, dir: 1 | -1) => void;
  onUnpin: (colId: string, vi: number) => void;
}) {
  const [hover, setHover] = useState(false);
  const isSource = !!pairing && pairing.colId === colId && pairing.vi === vi;
  const isTarget = !!pairing && pairing.colId !== colId;
  const showTools = hover || selected || isSource;

  const shadow: string[] = [];
  if (selected) shadow.push("inset 0 0 0 2px " + ACCENT);
  if (isSource) shadow.push("inset 0 0 0 2px var(--pen4)");
  if (pinned) shadow.push("inset 3px 0 0 " + ACCENT);

  return (
    <div
      tabIndex={0}
      role="button"
      data-parallel-ref={rec.reference}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      onClick={() =>
        pairing && !isSource ? onPair(colId, vi) : onSelect(rec.reference)
      }
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(rec.reference);
        }
      }}
      style={{
        ...cellBase,
        background: stripe ? "var(--soft)" : "var(--panel)",
        fontFamily: SERIF,
        fontSize: "14.5px",
        lineHeight: 1.62,
        cursor: isTarget ? "crosshair" : "pointer",
        position: "relative",
        boxShadow: shadow.length ? shadow.join(", ") : undefined,
        // Room for the controls so they never sit on top of the last line.
        paddingBottom: showTools ? "30px" : undefined,
      }}
    >
      <MarkedVerse
        reference={rec.reference}
        verseNumber={rec.verse}
        text={rec.text}
        marks={verseMarks}
        tags={tags}
        dark={dark}
      />
      {noted && (
        <span
          title="Has a note"
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
            width: "7px",
            height: "7px",
            borderRadius: "50%",
            background: ACCENT,
          }}
        />
      )}
      {showTools && (
        <div
          style={{
            position: "absolute",
            right: "6px",
            bottom: "5px",
            display: "flex",
            gap: "3px",
            fontFamily: SANS,
          }}
        >
          <Tool
            label="⇄"
            title="Pair this verse with one in another column"
            onClick={() => onPair(colId, vi)}
          />
          <Tool
            label="↓"
            title="Nudge down within its segment"
            onClick={() => onNudge(colId, vi, 1)}
          />
          <Tool
            label="↑"
            title="Nudge up within its segment"
            onClick={() => onNudge(colId, vi, -1)}
          />
          {pinned && (
            <Tool label="📌" title="Unpin" onClick={() => onUnpin(colId, vi)} />
          )}
        </div>
      )}
    </div>
  );
}

function Tool({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        fontFamily: SANS,
        fontSize: "11px",
        lineHeight: 1,
        background: "var(--panel)",
        border: "1px solid var(--border)",
        color: "var(--muted)",
        borderRadius: "5px",
        padding: "3px 6px",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
