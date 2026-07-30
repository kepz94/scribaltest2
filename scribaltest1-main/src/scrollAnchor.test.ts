// SCR-86: scroll-anchor capture/restore around send/remove-mode toggles.
// jsdom has no layout, so element geometry is mocked via getBoundingClientRect.

import {
  captureVerseAnchor,
  restoreVerseAnchor,
  findScrollContainer,
  VerseAnchor,
} from "./scrollAnchor";

// Build a scroll container holding verse rows at the given viewport-space
// tops (each row 40px tall). scrollTop is a real mutable property.
function makeContainer(
  cTop: number,
  rows: { ref: string; top: number }[]
): HTMLElement {
  const c = document.createElement("div");
  c.style.overflowY = "auto";
  (c as any).getBoundingClientRect = () => ({
    top: cTop,
    bottom: cTop + 500,
    left: 0,
    right: 300,
    width: 300,
    height: 500,
    x: 0,
    y: cTop,
    toJSON: () => ({}),
  });
  let st = 0;
  Object.defineProperty(c, "scrollTop", {
    get: () => st,
    set: (v: number) => {
      st = v;
    },
    configurable: true,
  });
  rows.forEach((row) => {
    const el = document.createElement("div");
    el.setAttribute("data-vref", row.ref);
    (el as any).getBoundingClientRect = () => ({
      top: row.top,
      bottom: row.top + 40,
      left: 0,
      right: 300,
      width: 300,
      height: 40,
      x: 0,
      y: row.top,
      toJSON: () => ({}),
    });
    c.appendChild(el);
  });
  document.body.appendChild(c);
  return c;
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("capture picks the topmost verse intersecting the viewport", () => {
  // Rows above the container top are scrolled out; 1 Ne 1:3 pokes into view
  // (bottom 110 > cTop 100) and is the anchor, 30px above the container top.
  const c = makeContainer(100, [
    { ref: "1 Ne 1:1", top: -20 },
    { ref: "1 Ne 1:2", top: 20 },
    { ref: "1 Ne 1:3", top: 70 },
    { ref: "1 Ne 1:4", top: 110 },
  ]);
  const a = captureVerseAnchor(c);
  expect(a).toEqual({ ref: "1 Ne 1:3", offset: -30 });
});

test("restore moves scrollTop by the layout delta so the verse holds position", () => {
  const c = makeContainer(100, [{ ref: "Alma 32:21", top: 130 }]);
  const a = captureVerseAnchor(c);
  expect(a).toEqual({ ref: "Alma 32:21", offset: 30 });
  c.scrollTop = 400;
  // Mode toggle re-heights everything above: the verse now renders 90px
  // below the container top instead of 30.
  (c.firstChild as any).getBoundingClientRect = () => ({
    top: 190,
    bottom: 230,
    left: 0,
    right: 300,
    width: 300,
    height: 40,
    x: 0,
    y: 190,
    toJSON: () => ({}),
  });
  restoreVerseAnchor(c, a);
  expect(c.scrollTop).toBe(460); // += (90 - 30)
});

test("restore no-ops when the anchored verse is gone (e.g. just removed)", () => {
  const c = makeContainer(0, [{ ref: "John 1:1", top: 10 }]);
  const a: VerseAnchor = { ref: "John 99:9", offset: 10 };
  c.scrollTop = 250;
  restoreVerseAnchor(c, a);
  expect(c.scrollTop).toBe(250);
});

test("capture returns null on empty container and restore tolerates null anchor", () => {
  const c = makeContainer(0, []);
  expect(captureVerseAnchor(c)).toBeNull();
  c.scrollTop = 33;
  restoreVerseAnchor(c, null);
  expect(c.scrollTop).toBe(33);
  expect(captureVerseAnchor(null)).toBeNull();
  restoreVerseAnchor(null, { ref: "x", offset: 0 });
});

test("quotes and backslashes in references are escaped in the restore query", () => {
  const weird = 'Odd "Ref" \\ 1:1';
  const c = makeContainer(0, [{ ref: weird, top: 60 }]);
  const a = captureVerseAnchor(c);
  expect(a && a.ref).toBe(weird);
  c.scrollTop = 100;
  (c.firstChild as any).getBoundingClientRect = () => ({
    top: 80,
    bottom: 120,
    left: 0,
    right: 300,
    width: 300,
    height: 40,
    x: 0,
    y: 80,
    toJSON: () => ({}),
  });
  restoreVerseAnchor(c, a);
  expect(c.scrollTop).toBe(120); // += (80 - 60)
});

test("findScrollContainer returns the nearest overflowY:auto ancestor", () => {
  const outer = document.createElement("div");
  outer.style.overflowY = "auto";
  const mid = document.createElement("div"); // plain block, not a scroller
  const inner = document.createElement("div");
  mid.appendChild(inner);
  outer.appendChild(mid);
  document.body.appendChild(outer);
  expect(findScrollContainer(inner)).toBe(outer);
  // Detached-from-any-scroller falls back to the page scroller (jsdom has
  // no document.scrollingElement, so the fallback normalizes to null there).
  const loose = document.createElement("div");
  document.body.appendChild(loose);
  const pageScroller =
    (document.scrollingElement as HTMLElement | null) || null;
  expect(findScrollContainer(loose)).toBe(pageScroller);
});
