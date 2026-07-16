// Custom drag image for verse grabbers: the verse itself follows the pointer
// (a card with the reference and text — or the stack summary for a group
// drag) instead of the browser's default tiny ghost of the ⠿ chip. The node
// is parked offscreen, handed to setDragImage, and removed right after the
// browser snapshots it.
export function setVerseDragImage(
  e: { dataTransfer: DataTransfer | null },
  verses: { reference: string; text?: string }[]
): void {
  try {
    const dt = e.dataTransfer;
    if (!dt || typeof dt.setDragImage !== "function" || !verses.length) return;
    const g = document.createElement("div");
    g.style.cssText =
      "position:fixed;top:-1000px;left:-1000px;max-width:340px;" +
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
    dt.setDragImage(g, 24, 18);
    window.setTimeout(() => {
      if (g.parentNode) g.parentNode.removeChild(g);
    }, 0);
  } catch {
    /* the drag still works with the browser's default image */
  }
}
