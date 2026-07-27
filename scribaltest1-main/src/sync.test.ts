// Round-trip test for the backup file format (SCR-69): the file the mobile
// "Export backup" action produces must restore cleanly through the same
// applyBackupString path that desktop "Restore from backup" and the mobile
// restore rules use.

import {
  CORE_KEYS,
  buildBackupString,
  applyBackupString,
} from "./sync";

const MOBILE_KEYS = [
  ...CORE_KEYS,
  "scribal_mobile_loc",
  "scribal_mobile_tabs",
  "scribal_mobile_active",
];

const SAMPLE: Record<string, string> = {
  scribal_books_v1: JSON.stringify({
    books: { master: { marks: [{ id: "m1", style: "bold" }] } },
  }),
  scribal_studies_v1: JSON.stringify([{ id: "s1", name: "Faith" }]),
  scribal_notes: JSON.stringify({ "John 1": "In the beginning" }),
  scribal_tables_v1: JSON.stringify([
    { id: "t1", name: "Lesson", cards: [], createdAt: 1, updatedAt: 1 },
  ]),
  scribal_mobile_loc: JSON.stringify({ volume: 2, book: 0, chapter: 0 }),
};

beforeEach(() => localStorage.clear());

test("mobile export restores cleanly on a blank device (desktop-style apply)", () => {
  Object.keys(SAMPLE).forEach((k) => localStorage.setItem(k, SAMPLE[k]));
  const file = buildBackupString(MOBILE_KEYS, true); // exactly what exportBackup writes
  localStorage.clear();

  applyBackupString(file); // desktop importData path: no device-local rules
  Object.keys(SAMPLE).forEach((k) => {
    expect(localStorage.getItem(k)).toBe(SAMPLE[k]);
  });
});

test("mobile export restores under the mobile rules without moving the reading position", () => {
  Object.keys(SAMPLE).forEach((k) => localStorage.setItem(k, SAMPLE[k]));
  const file = buildBackupString(MOBILE_KEYS, true);
  localStorage.clear();
  // The restoring phone is already open somewhere — that must survive.
  const here = JSON.stringify({ volume: 4, book: 2, chapter: 7 });
  localStorage.setItem("scribal_mobile_loc", here);

  applyBackupString(file, {
    alwaysLocal: ["scribal_mobile_scroll"],
    keepLocalIfPresent: [
      "scribal_mobile_loc",
      "scribal_mobile_tabs",
      "scribal_mobile_active",
    ],
  });
  expect(localStorage.getItem("scribal_books_v1")).toBe(
    SAMPLE["scribal_books_v1"]
  );
  expect(localStorage.getItem("scribal_notes")).toBe(SAMPLE["scribal_notes"]);
  expect(localStorage.getItem("scribal_mobile_loc")).toBe(here); // kept local
});

test("the pretty export is valid JSON in the versioned backup shape", () => {
  Object.keys(SAMPLE).forEach((k) => localStorage.setItem(k, SAMPLE[k]));
  const parsed = JSON.parse(buildBackupString(MOBILE_KEYS, true));
  expect(parsed.app).toBe("scribal");
  expect(parsed.version).toBe(2);
  expect(typeof parsed.exportedAt).toBe("string");
  expect(parsed.data["scribal_books_v1"]).toBe(SAMPLE["scribal_books_v1"]);
});
