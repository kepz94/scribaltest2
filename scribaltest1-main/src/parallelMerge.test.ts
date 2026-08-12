// Merging alignments between devices. The describe that matters is the last
// one: a reset has to survive meeting a device that never saw it.
import { mergeParallel } from "./hooks/useParallel";
import { ParallelAlignment, isAlignmentCleared } from "./parallelAlign";

const at = (
  scope: string,
  updatedAt: number,
  extra: Partial<ParallelAlignment> = {}
): ParallelAlignment => ({
  scope,
  order: ["col_a"],
  slots: { col_a: [0, 1, 2] },
  pins: { col_a: [] },
  updatedAt,
  ...extra,
});

const raw = (record: Record<string, ParallelAlignment>): string =>
  JSON.stringify(record);

describe("adopting what the other device has", () => {
  test("a scope this device has never seen is taken", () => {
    const r = mergeParallel({}, raw({ s1: at("s1", 100) }));
    expect(r.changed).toBe(true);
    expect(r.next.s1.updatedAt).toBe(100);
  });

  test("a newer remote wins", () => {
    const r = mergeParallel({ s1: at("s1", 100) }, raw({ s1: at("s1", 200) }));
    expect(r.changed).toBe(true);
    expect(r.next.s1.updatedAt).toBe(200);
  });

  test("a newer local stands", () => {
    const local = { s1: at("s1", 300) };
    const r = mergeParallel(local, raw({ s1: at("s1", 200) }));
    expect(r.next.s1.updatedAt).toBe(300);
    expect(r.changed).toBe(false);
  });

  test("a tie keeps local, so re-reading our own write is not a change", () => {
    const r = mergeParallel({ s1: at("s1", 100) }, raw({ s1: at("s1", 100) }));
    expect(r.changed).toBe(false);
    expect(r.next.s1.updatedAt).toBe(100);
  });

  test("other scopes are left alone", () => {
    const local = { s1: at("s1", 100), s2: at("s2", 100) };
    const r = mergeParallel(local, raw({ s1: at("s1", 200) }));
    expect(r.next.s2.updatedAt).toBe(100);
    expect(Object.keys(r.next).sort()).toEqual(["s1", "s2"]);
  });

  test("the local record is never mutated in place", () => {
    const local = { s1: at("s1", 100) };
    mergeParallel(local, raw({ s1: at("s1", 200) }));
    expect(local.s1.updatedAt).toBe(100);
  });
});

describe("nothing it is handed can make it throw", () => {
  const local = { s1: at("s1", 100) };
  const junk: (string | null | undefined)[] = [
    null,
    undefined,
    "",
    "not json",
    "[]",
    '{"a": 3}',
    '{"s1": null}',
    '{"s1": "a string"}',
    "42",
    '"a bare string"',
  ];
  junk.forEach((input) => {
    test("survives " + JSON.stringify(input), () => {
      const r = mergeParallel(local, input);
      expect(r.changed).toBe(false);
      expect(r.next).toEqual(local);
    });
  });
});

describe("a reset has to stick", () => {
  // The failure this prevents: reset on the desktop, and the laptop -- which
  // still holds the pre-reset alignment -- hands it straight back on the next
  // sync. The reset silently un-happens, and the only way to make one stick is
  // to reset on every device in the same sitting. Same shape as SCR-68 and
  // SCR-83: a deletion that carries no tombstone loses to stale state.
  test("a cleared local survives a remote that still holds the alignment", () => {
    const local = { s1: at("s1", 100, { clearedAt: 200 }) };
    const r = mergeParallel(local, raw({ s1: at("s1", 100) }));
    expect(isAlignmentCleared(r.next.s1)).toBe(true);
  });

  test("even when the remote is NEWER than the local edit", () => {
    // The remote wins on updatedAt and its slots are adopted -- but it never
    // saw the reset, so clearedAt has to carry regardless of who won.
    const local = { s1: at("s1", 100, { clearedAt: 500 }) };
    const r = mergeParallel(local, raw({ s1: at("s1", 400) }));
    expect(r.next.s1.clearedAt).toBe(500);
    expect(isAlignmentCleared(r.next.s1)).toBe(true);
  });

  test("a reset made on the OTHER device reaches this one", () => {
    const local = { s1: at("s1", 100) };
    const r = mergeParallel(local, raw({ s1: at("s1", 100, { clearedAt: 300 }) }));
    expect(r.changed).toBe(true);
    expect(isAlignmentCleared(r.next.s1)).toBe(true);
  });

  test("the newest reset wins when both devices reset", () => {
    const local = { s1: at("s1", 100, { clearedAt: 300 }) };
    const r = mergeParallel(local, raw({ s1: at("s1", 100, { clearedAt: 900 }) }));
    expect(r.next.s1.clearedAt).toBe(900);
  });

  test("aligning again after a reset revives it", () => {
    // A later edit outranks the reset -- the rule isTableDeleted uses, so that
    // a tombstone can never strand a study forever.
    const local = { s1: at("s1", 1000, { clearedAt: 300 }) };
    const r = mergeParallel(local, raw({ s1: at("s1", 100, { clearedAt: 300 }) }));
    expect(isAlignmentCleared(r.next.s1)).toBe(false);
    expect(r.next.s1.updatedAt).toBe(1000);
  });

  test("a remote edit newer than this device's reset revives it", () => {
    const local = { s1: at("s1", 100, { clearedAt: 200 }) };
    const r = mergeParallel(local, raw({ s1: at("s1", 900) }));
    expect(r.next.s1.updatedAt).toBe(900);
    expect(isAlignmentCleared(r.next.s1)).toBe(false);
  });
});
