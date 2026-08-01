// shareTable.ts
// "Send a copy": hand a finished study table to someone else. They type a
// six-character code into their own Scribal and get a WORKING COPY — theirs to
// reorder, rewrite, mark further, present, and pass on again. There is no live
// link. Once the copy lands, the two tables have nothing to do with each other:
// the sender can edit or delete theirs and the recipient's is untouched.
//
// Deliberately NOT a Present Room. A room follower watches the presenter's
// screen and holds no data; a recipient here owns everything that arrives. Two
// consequences shape this file:
//
//   1. Word tags travel as TAGS (dictKey + chosen senses), not as the resolved
//      gloss text a room ships. The recipient has the dictionary, so a tag lets
//      Define and Word Studies work natively on their copy.
//   2. Theme names travel as the book's own colorLabels + scopedLabels rather
//      than the room's flattened {refsKey: themes} map. Book ids change on
//      import, which would strand a map keyed by them; installed on the new
//      book, the marks simply render themselves.
//
// The copy always lands in a NEW session book. Nothing merges into a book the
// recipient already studies in, so an incoming table can never disturb their
// own marking — the whole reason this isn't just a marks import.
//
// Transport rides rooms/{code} with kind:"copy" (see presentRoom.ts). Those
// security rules already say exactly what this needs — anyone with the code
// reads, only the owner writes — so sharing needs no new Firestore rules.

// This file is PURE — no Firebase, no network — so the pack/install rules can
// be tested directly. The transport that carries a payload between devices is
// shareRoom.ts.

import { Mark, WordTag } from "./types";
import type {
  StudyTable,
  TableCard,
  CardKind,
  TablePurpose,
} from "./hooks/useStudyTables";

// A SENT TABLE's code lives a week, not a day like a present room. A room is
// watched live by people in the same meeting; a copy is texted to someone who
// opens it on Sunday. Only the CODE expires — the copy they saved is permanent.
// Defined here rather than in presentRoom.ts so the pure module stays free of
// Firebase; presentRoom imports it for the sweep.
export const SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Bumped only when the payload shape changes in a way an older app cannot
// read. An app that meets a HIGHER version refuses the code outright rather
// than importing half a table (see readShare).
export const SHARE_VERSION = 1;

// Firestore hard-caps a document at 1 MiB. Marks carry their verse text (the
// renderer reads it), so a table spanning many chapters is the realistic way
// to approach that. Refuse a little early and say so at share time — the
// alternative is an opaque failure when the recipient tries to open it.
export const MAX_SHARE_BYTES = 900_000;

// Card kinds this build knows how to render. A payload written by a NEWER
// Scribal may contain kinds absent here; those become a plain placeholder card
// rather than breaking the table or vanishing silently (installShare).
export const KNOWN_KINDS: CardKind[] = [
  "heading",
  "scripture",
  "text",
  "question",
  "quote",
  "clip",
  "note",
  "grid",
];

export interface SharePayload {
  v: number;
  name: string;
  purpose?: TablePurpose;
  // Who sent it, for the recipient's confirmation screen. Best-effort: the
  // display name on the sender's account, absent if they have none.
  senderName?: string;
  // The COLUMN only. The tray never travels — verses gathered but not placed
  // are the sender's raw material, not part of the lesson (Kepu, Aug 1).
  cards: TableCard[];
  marks: Mark[];
  colorLabels: Record<number, string>;
  scopedLabels: Record<string, Record<number, string>>;
  wordTags: WordTag[];
  // False when the sender chose to send clean scripture. Distinguishes "they
  // sent no marking" from "this table's verses happen to be unmarked", which
  // the recipient's confirmation screen states plainly.
  marksIncluded: boolean;
}

export interface ShareDoc extends SharePayload {
  kind: "copy";
  createdAt: number;
  ownerUid: string;
}

export type ShareError =
  | "not-signed-in"
  | "too-big"
  | "not-found"
  | "expired"
  | "needs-update"
  | "offline";

export class ShareFailure extends Error {
  reason: ShareError;
  constructor(reason: ShareError) {
    super(reason);
    this.reason = reason;
  }
}

// "John 2:15" -> "John 2". Theme names (scopedLabels) are keyed by chapter, so
// this is how a card's verses name the scopes whose palettes must travel.
export const chapterOf = (reference: string): string => {
  const i = reference.lastIndexOf(":");
  return i === -1 ? reference : reference.slice(0, i);
};

// Every verse the COLUMN references, in first-appearance order.
export const columnRefs = (cards: TableCard[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  cards.forEach((c) => {
    if (c.kind !== "scripture") return;
    (c.refs || []).forEach((r) => {
      if (!seen.has(r)) {
        seen.add(r);
        out.push(r);
      }
    });
  });
  return out;
};

export interface PackArgs {
  table: StudyTable;
  // The visible column, already resolved by the caller (a Compiled · live
  // table sends what is on screen, exactly as Present does).
  cards: TableCard[];
  // Reads one of the sender's books. Undefined for a book that no longer
  // exists, which a card can outlive.
  // Shaped to match the shells' getBook exactly, optional fields and all, so
  // it can be passed straight through with no adapter.
  bookOf: (bookId: string) =>
    | {
        marks: Mark[];
        colorLabels?: Record<number, string>;
        scopedLabels?: Record<string, Record<number, string>>;
      }
    | undefined;
  wordTags: WordTag[];
  includeMarks: boolean;
  includeNotes: boolean;
  senderName?: string;
}

// Build the payload. Pure — no clock, no network, no Firestore.
//
// Only what the column actually shows travels: marks on its verses, the theme
// names of the chapters those verses live in, and the word tags anchored to
// them. A verse the recipient will never see contributes nothing.
export function packShare(args: PackArgs): SharePayload {
  const { table, cards, bookOf, wordTags, includeMarks, includeNotes } = args;

  // Private note-to-self cards are dropped WHOLE when excluded. A room blanks
  // them instead, because a follower's beat indexes have to line up with the
  // presenter's; a copy has no such constraint, and an empty card is just
  // clutter in someone else's table.
  const kept = includeNotes ? cards : cards.filter((c) => c.kind !== "note");

  const refs = columnRefs(kept);
  const refSet = new Set(refs);
  const scopes = new Set(refs.map(chapterOf));

  const marks: Mark[] = [];
  const colorLabels: Record<number, string> = {};
  const scopedLabels: Record<string, Record<number, string>> = {};

  if (includeMarks) {
    const seenMark = new Set<string>();
    // Which books the column draws from: each card's own, falling back to the
    // table's marks home.
    const bookIds = new Set<string>();
    kept.forEach((c) => {
      if (c.kind === "scripture")
        bookIds.add(c.bookId || table.bookId || "master");
    });
    bookIds.forEach((bid) => {
      const bk = bookOf(bid);
      if (!bk) return;
      bk.marks.forEach((m) => {
        if (refSet.has(m.reference) && !seenMark.has(m.id)) {
          seenMark.add(m.id);
          marks.push(m);
        }
      });
      // Color meanings: first book to name a color wins, so a card's own book
      // can't be overwritten by a later one that left that color blank.
      const labels = bk.colorLabels || {};
      Object.keys(labels).forEach((k) => {
        const n = Number(k);
        if ((labels[n] || "").trim() && !colorLabels[n])
          colorLabels[n] = labels[n];
      });
      Object.keys(bk.scopedLabels || {}).forEach((scope) => {
        if (scopes.has(scope) && !(scope in scopedLabels))
          scopedLabels[scope] = (bk.scopedLabels as Record<
            string,
            Record<number, string>
          >)[scope];
      });
    });
  }

  // Tags on verses that travel. Kept even when marking is excluded: a
  // definition the sender attached is part of what they wrote, not part of
  // their marking.
  const tags = (wordTags || []).filter((t) => t && refSet.has(t.reference));

  return {
    v: SHARE_VERSION,
    name: table.name,
    purpose: table.purpose,
    senderName: args.senderName,
    cards: kept,
    marks,
    colorLabels,
    scopedLabels,
    wordTags: tags,
    marksIncluded: includeMarks,
  };
}

export const shareBytes = (payload: SharePayload): number =>
  JSON.stringify(payload).length;

// What the recipient is told before anything is written.
export interface ShareSummary {
  name: string;
  senderName?: string;
  cardCount: number;
  verseCount: number;
  chapters: string[];
  marksIncluded: boolean;
  markCount: number;
}

export function summarize(payload: SharePayload): ShareSummary {
  const refs = columnRefs(payload.cards);
  const chapters: string[] = [];
  refs.forEach((r) => {
    const c = chapterOf(r);
    if (!chapters.includes(c)) chapters.push(c);
  });
  return {
    name: payload.name,
    senderName: payload.senderName,
    cardCount: payload.cards.length,
    verseCount: refs.length,
    chapters,
    marksIncluded: payload.marksIncluded,
    markCount: payload.marks.length,
  };
}

export interface InstallArgs {
  payload: SharePayload;
  // The session book minted for this copy. Every scripture card is repointed
  // at it, which is what keeps the arrival away from the recipient's own books.
  bookId: string;
  tableId: string;
  // Injected so tests are deterministic and ids stay unique per call.
  newId: (seed: string) => string;
  now: number;
}

export interface Installed {
  book: {
    marks: Mark[];
    colorLabels: Record<number, string>;
    scopedLabels: Record<string, Record<number, string>>;
  };
  table: StudyTable;
  wordTags: Omit<WordTag, "id">[];
}

// Turn a payload into the three things the recipient's app writes: a session
// book's contents, a table, and word tags. Pure.
//
// Everything is RE-IDENTIFIED. Reusing the sender's mark and card ids would
// leave two people's data sharing identifiers across accounts — and if either
// ever deleted a mark, the other's tombstones could match it.
export function installShare(args: InstallArgs): Installed {
  const { payload, bookId, tableId, newId, now } = args;

  const marks: Mark[] = (payload.marks || []).map((m, i) => ({
    ...m,
    id: newId("m" + i),
  }));

  const known = new Set<string>(KNOWN_KINDS);
  const cards: TableCard[] = (payload.cards || []).map((c, i) => {
    const base: TableCard = { ...c, id: newId("c" + i) };

    // A card kind this build has never heard of — the sender is on a newer
    // Scribal. Keep its place in the lesson and say so, rather than dropping a
    // beat out of someone's talk without telling them.
    if (!known.has(c.kind)) {
      return {
        id: base.id,
        kind: "text",
        text: "This card needs a newer version of Scribal.",
      };
    }

    // Marks render from the book named here, so every scripture card is
    // repointed at the new session.
    if (base.kind === "scripture") base.bookId = bookId;

    // Tray bookkeeping never applies to a placed card.
    delete base.shelfSource;
    delete base.arrivedAt;
    return base;
  });

  const table: StudyTable = {
    id: tableId,
    name: payload.name,
    purpose: payload.purpose,
    bookId,
    cards,
    createdAt: now,
    updatedAt: now,
    nameAt: now,
    // Authored, not generated: it opens as the column the sender built rather
    // than as a Compiled · live table looking for a study to rebuild from.
    promotedAt: now,
    // No studyId, and no shelf. The recipient has no such study — a dangling
    // link would leave Organize as outline and the coverage meter pointing at
    // nothing — and the tray is the sender's raw material, not the lesson.
  };

  const wordTags = (payload.wordTags || []).map((t) => {
    const { id, ...rest } = t;
    return rest;
  });

  return {
    book: {
      marks,
      colorLabels: { ...(payload.colorLabels || {}) },
      scopedLabels: { ...(payload.scopedLabels || {}) },
    },
    table,
    wordTags,
  };
}

export const shareExpired = (d: { createdAt: number }, now: number): boolean =>
  now - (d.createdAt || 0) > SHARE_TTL_MS;

// The one wording for both shells, so the code entry never invents its own.
export const shareErrorText = (reason: ShareError): string => {
  switch (reason) {
    case "not-found":
      return "No table with that code.";
    case "expired":
      return "This code has expired — ask them to send a new one.";
    case "needs-update":
      return "This table needs a newer Scribal. Update and try again.";
    case "not-signed-in":
      return "Sign in to send a copy.";
    case "too-big":
      return "This table is too large to send. Try sending it without marking.";
    default:
      return "No connection. Try again in a moment.";
  }
};

// What the sender's Copy button puts on the clipboard: the code and how to use
// it, so a pasted message carries both halves.
export const shareInstructions = (code: string, name: string): string =>
  "I sent you a study table — “" +
  name +
  "”.\n\n" +
  "Open Scribal, go to Study tables → New study table → Enter a code, " +
  "and type:\n\n" +
  code +
  "\n\nThe code works for 7 days. Your copy is yours to keep.";

// Codes this device has already saved, so entering one twice asks first
// instead of quietly building a second copy.
const SAVED_KEY = "scribal_saved_shares_v1";

export const savedShareAt = (code: string): number | null => {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) || "{}");
    const at = raw && raw[code];
    return typeof at === "number" ? at : null;
  } catch {
    return null;
  }
};

export const rememberSavedShare = (code: string): void => {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) || "{}");
    raw[code] = Date.now();
    localStorage.setItem(SAVED_KEY, JSON.stringify(raw));
  } catch {}
};
