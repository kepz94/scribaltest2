// Dependency-free PDF assembly: each canvas becomes one PDF page, embedded as
// a JPEG (DCTDecode passes JPEG bytes straight through, so no pixel encoding
// is needed). Used when a share selection is too large for a single image
// card — the pages ARE the same rendered cards, so the look stays consistent.

import { ShareResult } from "./shareCard";

// Raw JPEG bytes from a canvas (strip the data-URL header, base64-decode).
function canvasJpegBytes(canvas: HTMLCanvasElement): Uint8Array | null {
  try {
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return null;
    const bin = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

// Build a complete PDF: catalog → pages → per page (page obj, image XObject,
// content stream drawing the image full-bleed). Object offsets are tracked so
// the xref table is exact. Pages are sized to each canvas (2 canvas px = 1 pt,
// so a 1080px-wide card becomes a 540pt-wide page).
export function canvasesToPdf(canvases: HTMLCanvasElement[]): Blob | null {
  const enc = (s: string): Uint8Array => {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  };

  const parts: Uint8Array[] = [];
  let offset = 0;
  const offsets: number[] = []; // 1-based object number -> byte offset
  const push = (chunk: Uint8Array) => {
    parts.push(chunk);
    offset += chunk.length;
  };
  const beginObj = (num: number, body: string) => {
    offsets[num] = offset;
    push(enc(num + " 0 obj\n" + body + "\nendobj\n"));
  };

  const pageCount = canvases.length;
  if (!pageCount) return null;
  // Object layout: 1 = catalog, 2 = pages, then per page i (0-based):
  // 3+i*3 = page, 4+i*3 = content stream, 5+i*3 = image XObject.
  const pageObj = (i: number) => 3 + i * 3;
  const contentObj = (i: number) => 4 + i * 3;
  const imageObj = (i: number) => 5 + i * 3;
  const totalObjs = 2 + pageCount * 3;

  push(enc("%PDF-1.4\n%âãÏÓ\n"));
  beginObj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  const kids = canvases.map((_, i) => pageObj(i) + " 0 R").join(" ");
  beginObj(2, "<< /Type /Pages /Kids [" + kids + "] /Count " + pageCount + " >>");

  for (let i = 0; i < pageCount; i++) {
    const c = canvases[i];
    const jpeg = canvasJpegBytes(c);
    if (!jpeg) return null;
    const wPt = c.width / 2;
    const hPt = c.height / 2;
    beginObj(
      pageObj(i),
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " +
        wPt +
        " " +
        hPt +
        "] /Resources << /XObject << /Im" +
        i +
        " " +
        imageObj(i) +
        " 0 R >> >> /Contents " +
        contentObj(i) +
        " 0 R >>"
    );
    const content = "q " + wPt + " 0 0 " + hPt + " 0 0 cm /Im" + i + " Do Q";
    beginObj(
      contentObj(i),
      "<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream"
    );
    // Image XObject: header + raw JPEG bytes + stream close.
    offsets[imageObj(i)] = offset;
    push(
      enc(
        imageObj(i) +
          " 0 obj\n<< /Type /XObject /Subtype /Image /Width " +
          c.width +
          " /Height " +
          c.height +
          " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " +
          jpeg.length +
          " >>\nstream\n"
      )
    );
    push(jpeg);
    push(enc("\nendstream\nendobj\n"));
  }

  const xrefStart = offset;
  let xref = "xref\n0 " + (totalObjs + 1) + "\n0000000000 65535 f \n";
  for (let n = 1; n <= totalObjs; n++) {
    xref += ("0000000000" + (offsets[n] || 0)).slice(-10) + " 00000 n \n";
  }
  push(
    enc(
      xref +
        "trailer\n<< /Size " +
        (totalObjs + 1) +
        " /Root 1 0 R >>\nstartxref\n" +
        xrefStart +
        "\n%%EOF\n"
    )
  );

  try {
    return new Blob(parts as unknown as BlobPart[], { type: "application/pdf" });
  } catch {
    return null;
  }
}

// Same share-sheet-then-download semantics as shareCanvas in shareCard.ts.
export async function sharePdf(
  blob: Blob,
  filename: string,
  caption: string
): Promise<ShareResult> {
  const nav = navigator as Navigator & {
    canShare?: (d: any) => boolean;
    share?: (d: any) => Promise<void>;
  };
  try {
    const file = new File([blob], filename, { type: "application/pdf" });
    if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
      try {
        await nav.share({ files: [file], text: caption });
        return "shared";
      } catch (e) {
        if (e && (e as { name?: string }).name === "AbortError")
          return "cancelled";
      }
    }
  } catch {
    /* fall through to download */
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return "downloaded";
  } catch {
    return "failed";
  }
}
