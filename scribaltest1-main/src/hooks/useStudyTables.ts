import { useEffect, useState } from "react";

// A Study Table = an ordered COLUMN of cards you build by hand to teach from.
// It sits ON TOP of your marks and studies (it can pull verses out of them),
// but the system never arranges it — the order of the cards is the lesson, and
// that order is entirely the interpreter's. This is the authoring + presenting
// surface; it is deliberately separate from Compile (which only *renders* a
// study), and separate from the marking reader (which stays pure scripture).
//
// Persistence + sync mirror useStudies / the old useLessons scaffolding exactly:
// one localStorage key, a shape shared across desktop and mobile, and a
// last-write-wins merge with tombstones so a table built on one device shows up
// (and stays in step) on the other. The whole table is the sync unit — it's
// edited on one device at a time — so its cards merge by updatedAt rather than
// per-card, which keeps the model simple and predictable. Rename and delete
// carry their own timestamps (nameAt / deletedAt) so those actions propagate
// independently of edits.

// What a table is *for*. Chosen at creation, always skippable (undefined until
// the user picks one). It quietly tailors the experience; it never gates.
export type TablePurpose = "lesson" | "talk" | "study" | "open";

// The seven kinds of card, and nothing else:
//  heading    — a section beat; its text is the section name (a fold point + a
//               natural stop when presenting).
//  scripture  — one or more verse references. Marks are NOT stored here; they
//               render LIVE from the marking session named in `bookId`, so a
//               verse always shows exactly how it's marked. One ref = a single
//               verse; several refs with `passage: true` = one passage card.
//  text       — "your words": a thought in the user's own voice. May carry an
//               optional `role` (thought / story / invitation).
//  question   — something to ask, with an optional `qtype` (fact / analysis /
//               application / feeling). Never graded — the type is just a tag.
//  quote      — an outside voice in text, with an optional `attribution`.
//  clip       — an outside voice on video: a link plus the exact slice to play.
//  note       — a private note-to-self. Never shown to a class or a room.
export type CardKind =
  | "heading"
  | "scripture"
  | "text"
  | "question"
  | "quote"
  | "clip"
  | "note";

export type WordRole = "thought" | "story" | "invitation";
export type QuestionType = "fact" | "analysis" | "application" | "feeling";

// How a shelf (tray) entry got there. "staged" = set aside by hand (the intake
// drawer's "+", or the legacy set-aside flow); "mark" = delivered automatically
// because a new mark landed in the table's scope (a newly linked chapter's
// themed verses arrive the same way). Absent => "staged", which grandfathers
// every pre-existing shelf card without a migration.
export type ShelfSource = "staged" | "mark";

export interface TableCard {
  id: string;
  kind: CardKind;

  // Text-bearing kinds (heading / text / question / quote / note) put their
  // content here. Only the fields relevant to `kind` are set.
  text?: string;

  // text (your words): optional role tag. Story + invitation live here as roles
  // rather than as their own kinds, so the palette stays at seven.
  role?: WordRole;

  // question: optional type tag.
  qtype?: QuestionType;

  // quote: source line.
  attribution?: string;

  // scripture: the verse reference(s), in scripture order. One entry is a
  // single-verse card; several with `passage: true` is one passage card
  // (consecutive verses only — enforced at the picker, not here). Marks are
  // pulled live from `bookId`'s session ("master" when absent).
  refs?: string[];
  // Shelf grouping (set at import): the study theme this card came from, so
  // Selected can mirror the study's own structure. Cards set aside from search
  // carry no tag and group by their marks instead.
  shelfGroup?: string;
  shelfGroupColor?: number;
  passage?: boolean;
  bookId?: string;
  // Shelf-only: how this entry arrived (see ShelfSource) and when. Both are
  // dropped when the card is placed into the column — placement is the act
  // that turns an arrival into an authored card.
  shelfSource?: ShelfSource;
  arrivedAt?: number;

  // clip: the source link plus the slice to play. `startSec` is read from the
  // link's ?t= param; `endSec` is set by the user (blank => play to the end).
  // title / source are fetched from the link for display + an offline caption.
  url?: string;
  startSec?: number;
  endSec?: number;
  clipTitle?: string;
  clipSource?: string;
  // Once true, the clip card shows its clean "press play" view (the slice, ready
  // to watch) instead of the editing fields. Toggled by Save as clip / Edit.
  clipSaved?: boolean;
}

export interface StudyTable {
  id: string;
  name: string;
  purpose?: TablePurpose;
  // The table's marks home: which book scripture cards pull marking from by
  // default (master, an existing session, or a session created for this table).
  // Individual cards can still carry their own bookId (e.g. imported studies).
  bookId?: string;
  // Table-as-notes (ADR-007): the study this table is the notes section OF.
  // One table per study; a linked chapter group shares one study and so one
  // table. bookId keeps its marks-home meaning — the two are independent.
  // Absent on legacy tables until the SCR-67 migration attaches them.
  studyId?: string;
  // The ordered column. Index IS the order — first card first, and that order
  // drives Present. There is no board geometry here; a spatial "board" lens can
  // be layered on later without touching this shape.
  cards: TableCard[];
  createdAt: number;
  // Last content edit (cards / purpose / name). Drives last-write-wins on merge.
  updatedAt: number;
  // When the name was last set by the user. Lets a rename win a sync without a
  // plain edit's newer updatedAt clobbering it. Absent => treated as createdAt.
  nameAt?: number;
  // Tombstone. A table counts as deleted only while the delete is its newest
  // action (>= nameAt and updatedAt), so a later edit or rename revives it.
  deletedAt?: number;
  // Verses set aside for this table but not yet placed in the column — a staging
  // shelf. Holds scripture cards only; each is moved into `cards` when the user
  // decides where it goes. Syncs last-write like `cards`.
  shelf?: TableCard[];
  // Table-as-notes lifecycle (ADR-007 §3): stamped by the first authoring act
  // (insert / drag / delete). Until then the table is Compiled · live — its
  // column is GENERATED from the study's marks (cards stays empty) and re-sorts
  // freely; the promotion write persists the on-screen arrangement into cards.
  // Promotion is one-way, so on merge the stamp advances like deletedAt.
  promotedAt?: number;
}

// A table counts as promoted (Table · yours) once stamped — or, for tables
// authored before the lifecycle existed, whenever it has any cards at all.
export const isTablePromoted = (t: StudyTable): boolean =>
  !!t.promotedAt || t.cards.length > 0;

// A table is hidden iff its delete is its newest action (so editing or renaming
// after a delete brings it back).
export const isTableDeleted = (t: StudyTable): boolean =>
  !!t.deletedAt &&
  t.deletedAt >= (t.nameAt || 0) &&
  t.deletedAt >= (t.updatedAt || 0);

const KEY = "scribal_tables_v1";

const newTableId = (): string =>
  "table_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);

// Exported so the column surface can mint stable card ids as it builds them.
export const newCardId = (): string =>
  "card_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);

export function useStudyTables() {
  const [tables, setTables] = useState<StudyTable[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(raw) ? (raw as StudyTable[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(tables));
    } catch {}
  }, [tables]);

  // Create a blank, untitled table and return its id so the caller can open it.
  // No purpose yet — the empty state offers one but never requires it.
  const createTable = (
    name = "Untitled",
    purpose?: TablePurpose,
    bookId?: string,
    studyId?: string
  ): string => {
    const now = Date.now();
    const id = newTableId();
    setTables((prev) => [
      {
        id,
        name,
        purpose,
        bookId,
        studyId,
        cards: [],
        createdAt: now,
        updatedAt: now,
        nameAt: now,
      },
      ...prev,
    ]);
    return id;
  };

  // Save an edit: any of cards / purpose / name. Always advances updatedAt;
  // advances nameAt only when the name actually changes, so a card edit can't
  // make a stale name win a rename sync.
  const updateTable = (
    id: string,
    changes: Partial<
      Pick<
        StudyTable,
        "name" | "cards" | "purpose" | "shelf" | "studyId" | "promotedAt"
      >
    >
  ) => {
    setTables((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const now = Date.now();
        const nameChanged =
          changes.name !== undefined && changes.name !== t.name;
        return {
          ...t,
          ...changes,
          updatedAt: now,
          nameAt: nameChanged ? now : t.nameAt || t.createdAt,
        };
      })
    );
  };

  const renameTable = (id: string, name: string) => updateTable(id, { name });

  // Deliver mark arrivals to a table's shelf (the tray). Each ref becomes one
  // scripture entry stamped shelfSource:"mark" + arrivedAt. A ref already
  // placed in the column or already waiting on the shelf is skipped, so
  // re-marking a verse never queues a duplicate. Never places — placement is
  // always the user's act (Monastic rule; the tray UI is SCR-57).
  const addShelfArrivals = (
    id: string,
    refs: string[],
    extras?: Partial<Pick<TableCard, "bookId" | "shelfGroup" | "shelfGroupColor">>
  ) => {
    setTables((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const have = new Set<string>();
        t.cards.forEach((c) => (c.refs || []).forEach((r) => have.add(r)));
        (t.shelf || []).forEach((c) =>
          (c.refs || []).forEach((r) => have.add(r))
        );
        const fresh = refs.filter((r) => !have.has(r));
        if (!fresh.length) return t;
        const now = Date.now();
        const arrivals: TableCard[] = fresh.map((r) => ({
          id: newCardId(),
          kind: "scripture",
          refs: [r],
          shelfSource: "mark",
          arrivedAt: now,
          ...extras,
        }));
        return {
          ...t,
          shelf: [...(t.shelf || []), ...arrivals],
          updatedAt: now,
        };
      })
    );
  };

  // Soft-delete: tombstone the table (kept, stamped) so the deletion travels to
  // other devices. Filtered out of the returned list below.
  const deleteTable = (id: string) =>
    setTables((prev) =>
      prev.map((t) => (t.id === id ? { ...t, deletedAt: Date.now() } : t))
    );

  // Merge a remote tables snapshot (another device's backup) into ours.
  //  - A table we've never seen (new id) is added.
  //  - A table we both have: NAME from whichever device set it most recently
  //    (nameAt); CONTENT (cards / purpose / bookId / studyId / shelf) from
  //    whichever edited most recently (updatedAt); updatedAt + deletedAt
  //    advance to the latest.
  // Idempotent: returns the previous array unchanged when nothing differs, so it
  // never churns the sync loop.
  const mergeRemote = (raw: string | null | undefined) => {
    if (!raw) return;
    let remote: StudyTable[];
    try {
      const parsed = JSON.parse(raw);
      remote = Array.isArray(parsed) ? (parsed as StudyTable[]) : [];
    } catch {
      return;
    }
    if (!remote.length) return;
    setTables((prev) => {
      const byId = new Map<string, StudyTable>(prev.map((t) => [t.id, t]));
      let changed = false;
      remote.forEach((r) => {
        if (!r || !r.id) return;
        const local = byId.get(r.id);
        if (!local) {
          byId.set(r.id, r);
          changed = true;
          return;
        }
        const lNameAt = local.nameAt || local.createdAt || 0;
        const rNameAt = r.nameAt || r.createdAt || 0;
        const name = rNameAt > lNameAt ? r.name : local.name;
        const nameAt = Math.max(lNameAt, rNameAt);
        const contentNewer = (r.updatedAt || 0) > (local.updatedAt || 0);
        const cards = contentNewer ? r.cards || [] : local.cards;
        const purpose = contentNewer ? r.purpose : local.purpose;
        const bookId = contentNewer ? r.bookId : local.bookId;
        const studyId = contentNewer ? r.studyId : local.studyId;
        const shelf = contentNewer ? r.shelf : local.shelf;
        const updatedAt = Math.max(local.updatedAt || 0, r.updatedAt || 0);
        const deletedAt = Math.max(local.deletedAt || 0, r.deletedAt || 0);
        // Promotion is one-way, so the stamp advances to the latest on either
        // device rather than following contentNewer.
        const promotedAt = Math.max(local.promotedAt || 0, r.promotedAt || 0);
        const differs =
          name !== local.name ||
          nameAt !== (local.nameAt || 0) ||
          updatedAt !== (local.updatedAt || 0) ||
          deletedAt !== (local.deletedAt || 0) ||
          promotedAt !== (local.promotedAt || 0) ||
          contentNewer;
        if (differs) {
          const merged: StudyTable = {
            ...local,
            name,
            nameAt,
            cards,
            purpose,
            updatedAt,
          };
          if (bookId) merged.bookId = bookId;
          else delete merged.bookId;
          if (studyId) merged.studyId = studyId;
          else delete merged.studyId;
          if (shelf && shelf.length) merged.shelf = shelf;
          else delete merged.shelf;
          if (deletedAt) merged.deletedAt = deletedAt;
          if (promotedAt) merged.promotedAt = promotedAt;
          byId.set(r.id, merged);
          changed = true;
        }
      });
      if (!changed) return prev;
      return Array.from(byId.values()).sort(
        (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
      );
    });
  };

  // Consumers see only live tables; the full list (with tombstones) is what's
  // persisted and synced, so deletions still propagate between devices.
  const visibleTables = tables.filter((t) => !isTableDeleted(t));

  return {
    tables: visibleTables,
    createTable,
    updateTable,
    renameTable,
    deleteTable,
    addShelfArrivals,
    setTables,
    mergeRemote,
  };
}
