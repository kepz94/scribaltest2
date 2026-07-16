// Custom drag image for verse grabbers: the verse itself follows the pointer
// (a card with the reference and text — or the stack summary for a group
// drag) instead of the browser's default tiny ghost of the ⠿ chip.
//
// The browser renders anything given to setDragImage at its own reduced
// opacity (way too faded — Kepu's dress-rehearsal note), so the native ghost
// is hidden behind a 1×1 transparent canvas and the card is a real DOM node
// moved along on document dragover at full opacity. It anchors at its
// top-RIGHT corner: the grabber sits at the verse's right end, so the card
// hangs left of the pointer — anchored left it reads as if you'd grabbed the
// wrong side.
export function setVerseDragImage(
  e: { dataTransfer: DataTransfer | null; clientX?: number; clientY?: number },
  verses: { reference: string; text?: string }[]
): void {
  try {
    const dt = e.dataTransfer;
    if (!dt || typeof dt.setDragImage !== "function" || !verses.length) return;
    const g = document.createElement("div");
    g.style.cssText =
      "position:fixed;top:-1000px;left:-1000px;max-width:340px;z-index:9999;" +
      "padding:10px 13px;border-radius:12px;border:1.5px solid #3b82f6;" +
      "background:var(--panel,#fff);color:var(--text,#292524);" +
      "font-family:system-ui,sans-serif;font-size:12.5px;line-height:1.5;" +
      "box-shadow:0 12px 30px rgba(59,130,246,.35);pointer-events:none;";
    const first = verses[0];
    const head = document.createElement("div");
    head.style.cssText =
      "font-weight:700;font-size:11.5px;margin-bottom:2px;color:#3b82f6;";
    head.textContent =
      verses.length > 1 ? verses.length + " verses" : first.reference;
    g.appendChild(head);
    const t = (first.text || "").trim();
    if (t) {
      const body = document.createElement("div");
      body.textContent = t.length > 140 ? t.slice(0, 140) + "…" : t;
      g.appendChild(body);
    }
    if (verses.length > 1) {
      const more = document.createElement("div");
      more.style.cssText = "margin-top:4px;font-size:11px;color:#78716c;";
      more.textContent =
        verses
          .map((v) => v.reference)
          .slice(0, 4)
          .join(" · ") + (verses.length > 4 ? " …" : "");
      g.appendChild(more);
    }
    document.body.appendChild(g);

    // Blank out the native (faded) ghost.
    const blank = document.createElement("canvas");
    blank.width = 1;
    blank.height = 1;
    blank.style.cssText = "position:fixed;top:-10px;left:-10px;";
    document.body.appendChild(blank);
    dt.setDragImage(blank, 0, 0);

    const place = (x: number, y: number) => {
      g.style.left = x - Math.max(0, g.offsetWidth - 18) + "px";
      g.style.top = y - 18 + "px";
    };
    if (typeof e.clientX === "number" && typeof e.clientY === "number")
      place(e.clientX, e.clientY);
    const move = (ev: DragEvent) => {
      if (ev.clientX || ev.clientY) place(ev.clientX, ev.clientY);
    };
    const cleanup = () => {
      document.removeEventListener("dragover", move);
      document.removeEventListener("dragend", cleanup);
      document.removeEventListener("drop", cleanup);
      if (g.parentNode) g.parentNode.removeChild(g);
      if (blank.parentNode) blank.parentNode.removeChild(blank);
    };
    document.addEventListener("dragover", move);
    document.addEventListener("dragend", cleanup);
    document.addEventListener("drop", cleanup);
  } catch {
    /* the drag still works with the browser's default image */
  }
}
