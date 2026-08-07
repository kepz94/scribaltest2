// A verse card renders the study's real markings — MarkedVerse's segmentation
// extracted pure. These pin the reader's layering rules so the chip and the
// reader can never disagree.
import { chipSegments } from "./chipMarks";
import { Mark } from "./types";

const mark = (
  startIndex: number,
  endIndex: number,
  style: Mark["style"] = "bold",
  color = 1
): Mark =>
  ({
    id: "m" + startIndex + "-" + endIndex + style,
    reference: "Luke 19:1",
    verseText: "",
    markedText: "",
    startIndex,
    endIndex,
    style,
    color,
  } as any);

test("no marks: one plain segment covering the whole body", () => {
  expect(chipSegments(20, [])).toEqual([{ start: 0, end: 20, css: null }]);
});

test("one mark: plain / styled / plain, boundaries exact", () => {
  const segs = chipSegments(20, [mark(5, 10)]);
  expect(segs.map((s) => [s.start, s.end, !!s.css])).toEqual([
    [0, 5, false],
    [5, 10, true],
    [10, 20, false],
  ]);
  expect(segs[1].css).toMatchObject({ fontWeight: "bold" });
});

test("overlapping marks layer on the shared slice, heavier style applied last", () => {
  // highlight (1pt) under bold (5pt): the shared slice carries BOTH the
  // background and the bold — the reader's exact rule.
  const segs = chipSegments(20, [
    mark(0, 10, "highlight", 3),
    mark(5, 15, "bold", 1),
  ]);
  const shared = segs.find((s) => s.start === 5 && s.end === 10)!;
  expect(shared.css).toMatchObject({ fontWeight: "bold" });
  expect((shared.css as any).backgroundColor || (shared.css as any).background).toBeTruthy();
});

test("mark ranges clamp to the body instead of throwing or spilling", () => {
  const segs = chipSegments(10, [mark(5, 500)]);
  expect(segs[segs.length - 1]).toMatchObject({ start: 5, end: 10 });
  expect(segs[segs.length - 1].css).toBeTruthy();
});

test("segment texts reassemble to the exact body — nothing lost or doubled", () => {
  const body = "abcdefghijklmnopqrst";
  const segs = chipSegments(body.length, [mark(2, 7), mark(7, 12, "underline", 2)]);
  expect(segs.map((s) => body.slice(s.start, s.end)).join("")).toBe(body);
});
