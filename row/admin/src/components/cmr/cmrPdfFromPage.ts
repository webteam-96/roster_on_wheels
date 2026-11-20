// NEW CMR PDF = a picture of the report page itself (user 2026-11-10: "page preview and PDF must be the same").
// The report element (Design A or Design B) is drawn with html2canvas and laid on A4 pages. Page breaks are
// only taken between blocks / table rows ([data-pdf-block] elements and <tr>), never through text; a block
// taller than a page is cut where it must. Each page gets a small footer. The same PDF is downloaded, or sent with
// "Upload to District" to be emailed (reportPdfBase64, user 2026-11-13).

import jsPDF from "jspdf";
import html2canvas from "html2canvas";

export async function downloadReportPdf(el: HTMLElement, fileName: string, footerLeft: string) {
  (await buildReportPdf(el, footerLeft)).save(fileName);
}

/** The same PDF as Download, as base64 (no "data:" prefix) - sent with Upload to District for the email. */
export async function reportPdfBase64(el: HTMLElement, footerLeft: string): Promise<string> {
  const uri = (await buildReportPdf(el, footerLeft)).output("datauristring");
  return uri.slice(uri.indexOf(",") + 1);
}

async function buildReportPdf(el: HTMLElement, footerLeft: string): Promise<jsPDF> {
  const scale = 2;
  const canvas = await html2canvas(el, { scale, backgroundColor: "#ffffff", useCORS: true, logging: false, windowWidth: el.scrollWidth });

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210, pageH = 297, footerMm = 10;
  const pxPerMm = canvas.width / pageW;                       // image fills the page width
  const sliceMax = Math.floor((pageH - footerMm) * pxPerMm);   // canvas px that fit above the footer

  // Allowed break points (canvas px from the top): the bottom of every block / row.
  const top = el.getBoundingClientRect().top;
  const breaks = Array.from(el.querySelectorAll<HTMLElement>("[data-pdf-block], tr"))
    .map((b) => Math.round((b.getBoundingClientRect().bottom - top) * scale))
    .filter((y) => y > 0 && y < canvas.height)
    .sort((a, b) => a - b);

  const slices: [number, number][] = [];
  let start = 0;
  while (start < canvas.height - 2) {
    const limit = start + sliceMax;
    if (limit >= canvas.height) { slices.push([start, canvas.height]); break; }
    const fit = breaks.filter((b) => b > start + sliceMax * 0.4 && b <= limit);   // keep pages at least 40% full
    const end = fit.length ? fit[fit.length - 1] : limit;
    slices.push([start, end]);
    start = end;
  }

  slices.forEach(([y0, y1], i) => {
    if (i > 0) doc.addPage();
    const part = document.createElement("canvas");
    part.width = canvas.width; part.height = y1 - y0;
    const ctx = part.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, part.width, part.height);
    ctx.drawImage(canvas, 0, y0, canvas.width, y1 - y0, 0, 0, canvas.width, y1 - y0);
    doc.addImage(part.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageW, (y1 - y0) / pxPerMm);

    doc.setDrawColor(226, 232, 240); doc.line(10, pageH - 8.5, pageW - 10, pageH - 8.5);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(100, 116, 139);
    doc.text(footerLeft.replace(/[^\x00-\xff]/g, "-"), 10, pageH - 4.5);
    doc.text(`Page ${i + 1} of ${slices.length}`, pageW - 10, pageH - 4.5, { align: "right" });
  });

  return doc;
}
