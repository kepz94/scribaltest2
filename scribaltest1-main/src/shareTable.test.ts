// What travels when you send a study table, and what a received one becomes.
// The rules that matter here are the promises the share sheet makes out loud:
// the recipient's own marking is never touched, the tray stays home, private
// notes leave only if you said so, and a copy is nobody's second reference to
// the sender's data.

import {
  KNOWN_KINDS,
  SharePayload,
  chapterOf,
  columnRefs,
  installShare,
  packShare,
  shareErrorText,
  shareExpired,
  shareInstructions,
  summarize,
  SHARE_TTL_MS,
} from "./shareTable";
import { sweepable, ttlFor, ROOM_TTL_MS } from "./presentRoom";
import { Mark, MarkColor, MarkStyle, WordTag } from "./types";
import type { StudyTable, TableCard } from "./hooks/useStudyTables";

const mark = (
  id: string,
  reference: string,
  color: MarkColor = 3,
  style: MarkStyle = "highlight"
): Mark => ({
  id,
  reference,
  verseText: "the whole verse for " + reference,
  markedText: "a fragment",
  startIndex: 0,
  endIndex: 8,
  style,
  color,
  timestamp: 1000,
});

const scripture = (id: string, refs: string[], bookId?: string): TableCard => ({
  id,
  kind: "scripture",
  refs,
  ...(bookId ? { bookId } : {}),
});

const table = (over: Partial<StudyTable> = {}): StudyTable => ({
  id: "table_1",
  name: "The Cleansing of the Temple",
  cards: [],
  createdAt: 500,
  updatedAt: 500,
  ...over,
});

// One book holding marks on John 2 and Matthew 21.
const senderBook = {
  marks: [
    mark("m1", "John 2:15"),
    mark("m2", "John 2:16", 5),
    mark("m3", "Matthew 21:13"),
    mark("m4", "Alma 32:21"), // not on any card — must not travel
  ],
  colorLabels: { 3: "Zeal", 5: "The Father's house" } as Record<number, string>,
  scopedLabels: {
    "John 2": { 3: "Zeal" },
    "Matthew 21": { 3: "A den of thieves" },
    "Alma 32": { 3: "Faith" }, // untouched chapter — must not travel
  } as Record<string, Record<number, string>>,
};

const bookOf = (id: string) => (id === "master" ? senderBook : undefined);

const tags: WordTag[] = [
  { id: "t1", reference: "John 2:15", start: 0, end: 5, word: "scourge", dictKey: "scourge", senses: [2] },
  { id: "t2", reference: "Alma 32:21", start: 0, end: 5, word: "faith", dictKey: "faith" },
];

const baseCards = [
  { id: "c1", kind: "heading", text: "He found them selling" } as TableCard,
  scripture("c2", ["John 2:15", "John 2:16"]),
  scripture("c3", ["Matthew 21:13"]),
  { id: "c4", kind: "question", text: "What did he defend?" } as TableCard,
  { id: "c5", kind: "note", text: "Ask Brother Hale to read this one" } as TableCard,
];

const pack = (over: Partial<Parameters<typeof packShare>[0]> = {}) =>
  packShare({
    table: table({ bookId: "master" }),
    cards: baseCards,
    bookOf,
    wordTags: tags,
    includeMarks: true,
    includeNotes: false,
    senderName: "Kepu",
    ...over,
  });

describe("chapterOf / columnRefs", () => {
  it("names the chapter a verse lives in", () => {
    expect(chapterOf("John 2:15")).toBe("John 2");
    expect(chapterOf("Doctrine and Covenants 93:24")).toBe(
      "Doctrine and Covenants 93"
    );
  });

  it("survives a reference with no verse number", () => {
    expect(chapterOf("Sermon 4")).toBe("Sermon 4");
  });

  it("collects the column's verses once each, in order", () => {
    expect(columnRefs(baseCards)).toEqual([
      "John 2:15",
      "John 2:16",
      "Matthew 21:13",
    ]);
  });
});

describe("packShare", () => {
  it("sends only marks on verses the column shows", () => {
    // Alma 32:21 is marked in the same book but appears on no card.
    expect(pack().marks.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("sends theme names only for chapters the column touches", () => {
    expect(Object.keys(pack().scopedLabels).sort()).toEqual([
      "John 2",
      "Matthew 21",
    ]);
  });

  it("drops private note cards unless the sender included them", () => {
    expect(pack().cards.some((c) => c.kind === "note")).toBe(false);
    const withNotes = pack({ includeNotes: true });
    expect(withNotes.cards.filter((c) => c.kind === "note")).toHaveLength(1);
    // Included means the text goes too — a blanked card would be a room's
    // behaviour, and there are no beats to keep aligned here.
    expect(withNotes.cards.find((c) => c.kind === "note")!.text).toContain(
      "Brother Hale"
    );
  });

  it("never sends the tray, whatever is waiting in it", () => {
    const payload = pack({
      table: table({
        bookId: "master",
        shelf: [scripture("s1", ["3 Nephi 18:20"])],
      }),
    });
    expect(JSON.stringify(payload)).not.toContain("3 Nephi 18:20");
    expect((payload as unknown as { shelf?: unknown }).shelf).toBeUndefined();
  });

  it("sends clean scripture when marking is excluded", () => {
    const payload = pack({ includeMarks: false });
    expect(payload.marks).toEqual([]);
    expect(payload.scopedLabels).toEqual({});
    expect(payload.colorLabels).toEqual({});
    expect(payload.marksIncluded).toBe(false);
    // The cards themselves still travel — that's the lesson.
    expect(payload.cards).toHaveLength(4);
  });

  it("keeps word tags even when marking is excluded", () => {
    // A definition the sender attached is something they wrote, not part of
    // their marking.
    expect(pack({ includeMarks: false }).wordTags.map((t) => t.id)).toEqual([
      "t1",
    ]);
  });

  it("sends only word tags anchored to the column's verses", () => {
    expect(pack().wordTags.map((t) => t.id)).toEqual(["t1"]);
  });

  it("carries the chosen dictionary sense, not resolved gloss text", () => {
    // Unlike a present room, whose follower has no dictionary.
    expect(pack().wordTags[0]).toMatchObject({ dictKey: "scourge", senses: [2] });
  });

  it("survives a card pointing at a book that no longer exists", () => {
    const payload = pack({ cards: [scripture("c9", ["John 2:15"], "gone")] });
    expect(payload.marks).toEqual([]);
    expect(payload.cards).toHaveLength(1);
  });
});

describe("summarize", () => {
  it("counts what the recipient is told before saving", () => {
    expect(summarize(pack())).toMatchObject({
      name: "The Cleansing of the Temple",
      senderName: "Kepu",
      cardCount: 4,
      verseCount: 3,
      chapters: ["John 2", "Matthew 21"],
      marksIncluded: true,
      markCount: 3,
    });
  });

  it("separates 'sent no marking' from 'these verses are unmarked'", () => {
    const clean = summarize(pack({ includeMarks: false }));
    expect(clean.marksIncluded).toBe(false);
    expect(clean.markCount).toBe(0);
  });
});

describe("installShare", () => {
  const run = (payload: SharePayload = pack()) =>
    installShare({
      payload,
      bookId: "session_new",
      tableId: "table_new",
      newId: (seed) => "new_" + seed,
      now: 9000,
    });

  it("points every scripture card at the new session book", () => {
    const { table: t } = run();
    t.cards
      .filter((c) => c.kind === "scripture")
      .forEach((c) => expect(c.bookId).toBe("session_new"));
    expect(t.bookId).toBe("session_new");
  });

  it("re-identifies every mark and card", () => {
    const { book, table: t } = run();
    // Sharing an id across two accounts would let one person's deletion
    // tombstone match the other's mark.
    expect(book.marks.map((m) => m.id)).toEqual(["new_m0", "new_m1", "new_m2"]);
    expect(t.cards.map((c) => c.id)).toEqual([
      "new_c0",
      "new_c1",
      "new_c2",
      "new_c3",
    ]);
    expect(t.id).toBe("table_new");
  });

  it("keeps the marks themselves intact", () => {
    const m = run().book.marks[0];
    expect(m).toMatchObject({
      reference: "John 2:15",
      style: "highlight",
      color: 3,
      verseText: "the whole verse for John 2:15",
    });
  });

  it("drops the study link so nothing points at a study they don't have", () => {
    const payload = pack();
    const { table: t } = run(payload);
    expect(t.studyId).toBeUndefined();
  });

  it("arrives with an empty tray", () => {
    expect(run().table.shelf).toBeUndefined();
  });

  it("opens as the column the sender built, not as a live outline", () => {
    // Without the stamp the table reads as Compiled · live and would try to
    // regenerate its column from a study that isn't there.
    expect(run().table.promotedAt).toBe(9000);
  });

  it("installs theme names on the new book", () => {
    const { book } = run();
    expect(book.scopedLabels["John 2"]).toEqual({ 3: "Zeal" });
    expect(book.colorLabels[5]).toBe("The Father's house");
  });

  it("strips the sender's word-tag ids so the recipient mints their own", () => {
    const t = run().wordTags[0] as WordTag;
    expect(t.id).toBeUndefined();
    expect(t).toMatchObject({ dictKey: "scourge", senses: [2] });
  });

  it("clears tray bookkeeping from placed cards", () => {
    const payload = pack({
      cards: [{ ...scripture("c1", ["John 2:15"]), shelfSource: "mark" as const, arrivedAt: 5 }],
    });
    const c = run(payload).table.cards[0];
    expect(c.shelfSource).toBeUndefined();
    expect(c.arrivedAt).toBeUndefined();
  });

  it("replaces a card kind this build cannot render with a placeholder", () => {
    // Sent from a newer Scribal. Keeping the beat matters — dropping it would
    // silently remove a step from someone's lesson.
    const payload = pack();
    (payload.cards as TableCard[]).push({
      id: "cX",
      kind: "timeline" as never,
      text: "future",
    });
    const cards = run(payload).table.cards;
    expect(cards).toHaveLength(5);
    expect(cards[4].kind).toBe("text");
    expect(cards[4].text).toContain("newer version");
  });

  it("leaves every known kind alone", () => {
    const payload = pack({
      cards: KNOWN_KINDS.map((k, i) => ({ id: "k" + i, kind: k, text: "x" })),
      includeNotes: true,
    });
    expect(run(payload).table.cards.map((c) => c.kind)).toEqual(KNOWN_KINDS);
  });

  it("round-trips a table with nothing in it", () => {
    const payload = pack({ cards: [] });
    const { table: t, book } = run(payload);
    expect(t.cards).toEqual([]);
    expect(book.marks).toEqual([]);
  });
});

describe("expiry", () => {
  it("gives a sent table a week and a present room a day", () => {
    expect(ttlFor({ kind: "copy" })).toBe(SHARE_TTL_MS);
    expect(ttlFor({})).toBe(ROOM_TTL_MS);
    expect(SHARE_TTL_MS).toBeGreaterThan(ROOM_TTL_MS);
  });

  it("expires a code after seven days, not before", () => {
    const born = { createdAt: 0 };
    expect(shareExpired(born, SHARE_TTL_MS - 1)).toBe(false);
    expect(shareExpired(born, SHARE_TTL_MS + 1)).toBe(true);
  });
});

describe("the sweep leaves sent tables alone", () => {
  const now = 10 * 24 * 60 * 60 * 1000;
  const day = 24 * 60 * 60 * 1000;
  // A whisker over a day old: past a room's TTL, nowhere near a copy's.
  const yesterday = now - day - 1;

  it("does not delete a copy shared yesterday", () => {
    // The regression this guards: cleanupMyRooms runs on every new present
    // room, so without the kind check, presenting anything would destroy a
    // table you shared the day before.
    expect(sweepable({ kind: "copy", createdAt: yesterday }, now)).toBe(false);
  });

  it("still deletes a room of exactly the same age", () => {
    expect(sweepable({ createdAt: yesterday }, now)).toBe(true);
  });

  it("never treats a copy as ended, whatever the flag says", () => {
    // End presentation must not reach across and delete a sent table.
    expect(
      sweepable({ kind: "copy", ended: true, createdAt: yesterday }, now)
    ).toBe(false);
  });

  it("deletes an ended room immediately", () => {
    expect(sweepable({ ended: true, createdAt: now }, now)).toBe(true);
  });

  it("deletes a copy once its week is up", () => {
    expect(sweepable({ kind: "copy", createdAt: now - 8 * day }, now)).toBe(true);
  });
});

describe("what the sender copies and the recipient reads", () => {
  it("puts the code and how to use it on the clipboard together", () => {
    const text = shareInstructions("K7RM4Q", "The Cleansing of the Temple");
    expect(text).toContain("K7RM4Q");
    expect(text).toContain("Enter a code");
    expect(text).toContain("The Cleansing of the Temple");
  });

  it("explains every failure in one plain sentence", () => {
    expect(shareErrorText("not-found")).toBe("No table with that code.");
    expect(shareErrorText("expired")).toContain("send a new one");
    expect(shareErrorText("needs-update")).toContain("newer Scribal");
    expect(shareErrorText("too-big")).toContain("without marking");
    // No error code, no apology, and every one says what to do next.
    (["not-found", "expired", "needs-update", "too-big", "offline", "not-signed-in"] as const).forEach(
      (r) => {
        expect(shareErrorText(r)).toMatch(/\.$/);
        expect(shareErrorText(r).toLowerCase()).not.toContain("error");
      }
    );
  });
});
