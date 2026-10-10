import { AlignmentType, ExternalHyperlink, ImageRun, Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType, type ParagraphChild } from "docx";
import { formatDate, nowIn } from "../../common/dotnet-format";
import { Brand } from "../../brand/brand";
import {
  BRAND, DIVIDER, INK, LABEL, LINK, MUTED, type Block, cell, centered, docUrl, fourColTable, imageSize, mutedText, para, run, sectionHeading, spacer, subHeading, tableBorders, wordDocument,
} from "../monthly-reports/cmr-documents";
import { n2, type OcvReportItem, type OcvWordDocument, type OcvWordNewsletter, type OcvWordProject, type OcvWordReportData } from "./ocv-gov.service";

/**
 * Ports of OcvReportWordBuilder.cs (OpenXML → docx) and OcvReportExcelBuilder.cs (HTML-table .xls).
 * PDFs and Office files are not rasterised inline (no rasteriser in ROW): they get the labelled
 * entry + download link that RIZones fell back to when rasterising failed.
 */

const NON_UPLOAD_CATEGORIES = ["live_documents", "newsletters"];
const PROJECT_LABELS = ["Community Service Projects", "Vocational Service", "International Service", "New Generation Service", "Public Image Initiative", "Club Service"];
const now = () => nowIn(Brand.Current.locale.defaultTimeZone);
const blank = (s: string | null | undefined) => !s || !s.trim();
const dash = (s: string | null | undefined) => (blank(s) ? "—" : String(s));
const dayMonthYear = (v: string | null) => formatDate(v, "dd MMM yyyy");

function gridTable(headers: string[], rows: string[][]) {
  const header = new TableRow({
    tableHeader: true,
    children: headers.map((h) => new TableCell({ shading: { fill: BRAND, type: ShadingType.CLEAR, color: "auto" }, children: [para([run(h, { bold: true, color: "FFFFFF", size: 18 })])] })),
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.AUTOFIT, borders: tableBorders,
    rows: [header, ...rows.map((r) => new TableRow({ children: r.map((c) => new TableCell({ children: [para([run(c ?? "", { size: 17 })])] })) }))],
  });
}

function twoColTable(pairs: [string, string][]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [3200, 6800], layout: TableLayoutType.FIXED, borders: tableBorders,
    rows: pairs.map(([l, v]) => new TableRow({ children: [cell(l, true), cell(v, false)] })),
  });
}

const itemTitle = (title: string) => para([run(title, { bold: true, color: INK, size: 25 })], { spacing: { before: 220, after: 20 } });
const caption = (text: string) => para([run(text, { bold: true, color: LABEL, size: 17 })], { alignment: AlignmentType.CENTER, spacing: { before: 60, after: 20 } });

function inlineFacts(blocks: Block[], pairs: [string, string][]) {
  if (!pairs.length) return;
  const parts: ParagraphChild[] = [];
  pairs.forEach(([k, v], i) => {
    if (i > 0) parts.push(run("   ·   ", { color: DIVIDER, size: 19 }));
    parts.push(run(`${k}: `, { bold: true, color: LABEL, size: 19 }), run(v ?? "", { size: 19 }));
  });
  blocks.push(para(parts, { spacing: { after: 40 } }));
}

function docLink(blocks: Block[], mediaBase: string, path: string, label: string) {
  blocks.push(para([new ExternalHyperlink({ link: docUrl(mediaBase, path)!, children: [new TextRun({ text: label, color: LINK, underline: {}, size: 19 })] })], { spacing: { before: 40, after: 60 } }));
}

/** MapImageType: the picture types Word embeds; null = cannot embed. */
const imageType = (ext: string | null | undefined) => {
  const e = (ext ?? "").toLowerCase();
  return e === "jpg" || e === "jpeg" ? "jpg" : e === "png" ? "png" : e === "gif" ? "gif" : e === "bmp" ? "bmp" : null;
};

/** A centred inline picture, at most ~4.48" × 3.72", never enlarged. */
function embedImage(blocks: Block[], bytes: Buffer, type: "jpg" | "png" | "gif" | "bmp") {
  let [w, h] = imageSize(bytes);
  if (w <= 0 || h <= 0) [w, h] = [800, 600];
  const scale = Math.min(4_100_000 / (w * 9525), 3_400_000 / (h * 9525), 1);
  blocks.push(para([new ImageRun({ type, data: bytes, transformation: { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) } })],
    { alignment: AlignmentType.CENTER, spacing: { before: 120, after: 40 } }));
}

function appendProject(blocks: Block[], pr: OcvWordProject, index: number) {
  blocks.push(itemTitle(`${index}.  ${blank(pr.title) ? "(untitled)" : pr.title}`));
  blocks.push(para([run("Description: ", { bold: true, color: LABEL, size: 20 }), run(blank(pr.description) ? "—" : pr.description, { size: 20 })], { spacing: { before: 20, after: 60 } }));
  if (pr.fields.length) blocks.push(twoColTable(pr.fields));
  for (const img of pr.images) {
    const type = imageType(img.extension);
    if (!img.imageBytes?.length || !type) continue;
    try {
      embedImage(blocks, img.imageBytes, type);
    } catch {
      // unembeddable image: skipped
    }
    if (!blank(img.caption)) blocks.push(caption(img.caption));
  }
}

function appendDocument(blocks: Block[], mediaBase: string, d: OcvWordDocument, index: number) {
  const label = blank(d.customTypeName) ? d.typeName : `${d.typeName} — ${d.customTypeName}`;
  blocks.push(itemTitle(`${index}.  ${blank(label) ? "(untitled)" : label}`));
  const facts: [string, string][] = [];
  if (d.amount !== null && d.amount > 0) facts.push(["Amount", `${Brand.Current.locale.defaultCurrency} ${n2(d.amount)}`]);
  if (d.paidOn) facts.push(["Paid On", dayMonthYear(d.paidOn)]);
  inlineFacts(blocks, facts);
  if (blank(d.filePath)) {
    blocks.push(mutedText("File missing."), spacer());
    return;
  }
  let shown = false;
  const type = ["jpg", "jpeg", "png", "gif"].includes(d.extension) ? imageType(d.extension) : null;
  if (type && d.imageBytes?.length) {
    try {
      embedImage(blocks, d.imageBytes, type);
      shown = true;
    } catch {
      shown = false;
    }
  }
  if (!shown) {
    const ext = blank(d.extension) ? "file" : d.extension.toUpperCase();
    blocks.push(mutedText(`[${ext}] ${blank(d.originalFileName) ? "attachment" : d.originalFileName} — could not be rendered as an image inline; use the download link below.`));
  }
  docLink(blocks, mediaBase, d.filePath!, "Download document");
  blocks.push(spacer());
}

function appendNewsletter(blocks: Block[], mediaBase: string, nl: OcvWordNewsletter, index: number) {
  blocks.push(itemTitle(`${index}.  ${blank(nl.title) ? "(untitled)" : nl.title}`));
  const facts: [string, string][] = [];
  if (nl.publishDate) facts.push(["Published", dayMonthYear(nl.publishDate)]);
  if (!blank(nl.attachmentType)) facts.push(["Type", nl.attachmentType!]);
  if (!blank(nl.status)) facts.push(["Status", nl.status!]);
  inlineFacts(blocks, facts);
  const target = !blank(nl.filePath) ? nl.filePath : nl.linkUrl;
  if (blank(target)) blocks.push(mutedText("No attachment."));
  else docLink(blocks, mediaBase, target!, "Open newsletter");
}

/** One item that fails to render is noted and the report carries on. */
function safely(blocks: Block[], work: (b: Block[]) => void, fallback: string) {
  const local: Block[] = [];
  try {
    work(local);
    blocks.push(...local);
  } catch {
    blocks.push(mutedText(fallback));
  }
}

function headerBlocks(data: OcvWordReportData, moduleLabel: string | null): Block[] {
  const blocks: Block[] = [centered(`Rotary Club of ${data.clubName}`, 34, true), centered("Governor's Official Visit (OCV) Report", 28, true, BRAND)];
  if (moduleLabel !== null) blocks.push(centered(moduleLabel, 24, true, LABEL));
  blocks.push(centered(`Rotary Year ${data.yearLabel}`, 22, false, MUTED), spacer());
  blocks.push(fourColTable([
    ["Zone", dash(data.zoneName), "District Number", dash(data.districtNumber)],
    ["Club Name", dash(data.clubName), "Club ID", dash(data.clubRotaryId)],
    ["President", dash(data.presidentName), "Assistant Governor", dash(data.assistantGovernorName)],
    ["Rotary Year", dash(data.yearLabel), "Report Generated", formatDate(now(), "dd MMM yyyy HH:mm")],
  ]), spacer());
  return blocks;
}

const projectSection = (blocks: Block[], projects: OcvWordProject[]) =>
  projects.forEach((pr, i) => safely(blocks, (b) => appendProject(b, pr, i + 1), `${i + 1}.  This project could not be rendered.`));
const newsletterSection = (blocks: Block[], mediaBase: string, list: OcvWordNewsletter[]) => {
  if (!list.length) blocks.push(mutedText("No newsletters published for this year."));
  list.forEach((nl, i) => safely(blocks, (b) => appendNewsletter(b, mediaBase, nl, i + 1), `${i + 1}.  Could not be included in this report.`));
};

/** BuildReport: summary tables, uploaded documents, then every Live Documents module in full. */
export function buildOcvWordReport(data: OcvWordReportData, items: OcvReportItem[], mediaBase: string): Promise<Buffer> {
  const blocks = headerBlocks(data, null);
  const categories = data.categories.filter((c) => !NON_UPLOAD_CATEGORIES.includes(c.code));
  blocks.push(fourColTable([
    ["Documents Uploaded", String(data.documents.length), "Document Categories", String(categories.length)],
    ["Live Document Modules", String(data.liveTables.length), "Newsletters", String(data.newsletters.length)],
  ]));
  blocks.push(sectionHeading("Documents Summary"));
  blocks.push(items.length ? gridTable(["Sr.No.", "Module Name", "Document Type"], items.map((it, i) => [String(i + 1), it.categoryName ?? "", it.typeName ?? ""])) : mutedText("No document types configured."));
  blocks.push(sectionHeading("Live Documents"));
  blocks.push(data.liveTables.length ? gridTable(["Sr.No.", "Module Name"], data.liveTables.map((t, i) => [String(i + 1), t.label])) : mutedText("No live document modules."));
  blocks.push(sectionHeading("Newsletters"));
  blocks.push(data.newsletters.length ? gridTable(["Sr.No.", "Module Name"], data.newsletters.map((n, i) => [String(i + 1), blank(n.title) ? "(untitled)" : n.title!])) : mutedText("No newsletters published for this year."));
  blocks.push(sectionHeading("Uploaded Documents"));
  if (!data.documents.length) blocks.push(mutedText("No documents uploaded."));
  data.documents.forEach((d, i) => safely(blocks, (b) => appendDocument(b, mediaBase, d, i + 1), `${i + 1}.  Could not be included in this report.`));
  blocks.push(sectionHeading("Live Documents — Detailed"));
  blocks.push(mutedText(`Current data as on ${formatDate(now(), "dd MMM yyyy")}. These modules are not uploaded files — the content below is read live from the club's records.`));
  for (const pm of data.projectModules) {
    blocks.push(subHeading(`${pm.label} (${pm.projects.length})`));
    if (!pm.projects.length) blocks.push(mutedText("No projects for this year."));
    else projectSection(blocks, pm.projects);
  }
  for (const t of data.liveTables.filter((t) => !PROJECT_LABELS.includes(t.label))) {
    blocks.push(subHeading(`${t.label} (${t.rows.length})`));
    safely(blocks, (b) => b.push(t.rows.length ? gridTable(t.headers, t.rows) : mutedText("No records.")), "This section could not be rendered.");
  }
  blocks.push(subHeading(`Newsletters (${data.newsletters.length})`));
  newsletterSection(blocks, mediaBase, data.newsletters);
  return wordDocument(blocks);
}

/** BuildModuleReport: the identity header and ONE module (projects | table | newsletters). */
export function buildOcvModuleReport(data: OcvWordReportData, moduleKey: string, mediaBase: string): Promise<Buffer> {
  const key = moduleKey.toLowerCase();
  const isNewsletters = key === "newsletters";
  const pm = data.projectModules.find((m) => m.moduleKey.toLowerCase() === key);
  const table = data.liveTables.find((t) => t.moduleKey.toLowerCase() === key);
  const label = pm?.label ?? table?.label ?? (isNewsletters ? "Newsletters" : moduleKey);
  const blocks = headerBlocks(data, label);
  if (pm) {
    blocks.push(sectionHeading(`${label} (${pm.projects.length})`));
    if (!pm.projects.length) blocks.push(mutedText("No projects for this year."));
    else projectSection(blocks, pm.projects);
  } else if (isNewsletters) {
    blocks.push(sectionHeading(`Newsletters (${data.newsletters.length})`));
    newsletterSection(blocks, mediaBase, data.newsletters);
  } else if (table) {
    blocks.push(sectionHeading(`${label} (${table.rows.length})`));
    safely(blocks, (b) => b.push(table.rows.length ? gridTable(table.headers, table.rows) : mutedText("No records.")), "This section could not be rendered.");
  } else {
    blocks.push(sectionHeading(label), mutedText("No data for this module."));
  }
  return wordDocument(blocks);
}

// ---- Excel (.xls as an HTML table, the legacy "OCVList….xls" layout) ----

const enc = (s: string | null | undefined) => (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const th = (text: string, width: string) => `<th style='width:${width};background-color:#1F4E79;color:White;border:1px solid #1F4E79;padding:2px;'>${enc(text)}</th>`;
const td = (text: string | null | undefined) => `<td style='text-align:center;border:1px solid #D0D0D0;padding:2px;'>${enc(text ?? "")}</td>`;
const linkCell = (url: string, text: string) =>
  `<td style='text-align:center;border:1px solid #D0D0D0;padding:2px;'>${blank(url) ? "<a href='' target='_blank'> </a>" : `<a href='${enc(url)}' target='_blank'>${text} </a>`}</td>`;
function absUrl(mediaBase: string, path: string | null | undefined): string | null {
  if (blank(path)) return null;
  if (/^http/i.test(path!)) return path!;
  const b = (mediaBase ?? "").replace(/\/+$/, "");
  if (!b) return path!;
  return path!.startsWith("/") ? b + path : `${b}/${path}`;
}

/** Documents link straight to the media URL: the API download route needs a bearer token Excel does not send. */
export function buildOcvExcel(header: OcvWordReportData, items: OcvReportItem[], clubId: number, yearId: number, mediaBase: string, frontendBase: string): Buffer {
  const out: string[] = ["<!DOCTYPE HTML PUBLIC \"-//W3C//DTD HTML 4.0 Transitional//EN\">", "<font style='font-size:10.0pt; font-family:Calibri;'>",
    "<table border='0' cellspacing='0' style='width:100%; border-collapse:collapse;'>"];
  out.push(`<tr><td colspan='5' style='color:#1F4E79;font-weight:bold;font-size:16pt;'>${enc("Governor's Official Visit Report — " + (header.clubName ?? ""))}</td></tr>`);
  out.push(`<tr><td colspan='5' style='color:#555555;font-style:italic;'>${enc(Brand.Current.productName)} Admin Portal</td></tr>`);
  out.push(`<tr><td colspan='5' style='color:#555555;font-style:italic;'>Rotary Year: ${enc(header.yearLabel)}</td></tr>`);
  out.push(`<tr><td colspan='5' style='color:#666666;'>Generated: ${formatDate(now(), "dd MMM yyyy, hh:mm tt")}  |  Club ID: ${enc(header.clubRotaryId)}  &#183;  District: ${enc(header.districtNumber)}  &#183;  President: ${enc(header.presidentName)}  &#183;  Assistant Governor: ${enc(header.assistantGovernorName)}</td></tr>`);
  out.push("<tr><td colspan='5'>&nbsp;</td></tr>");
  out.push(`<tr>${th("Sr.No.", "2%")}${th("Module Name", "20%")}${th("Document Type", "20%")}${th("Uploaded", "10%")}${th("Download Document", "48%")}</tr>`);
  items.forEach((it, i) => {
    const url = it.isUploaded ? absUrl(mediaBase, it.filePath) : null;
    out.push(`<tr>${td(String(i + 1))}${td(it.categoryName)}${td(it.typeName)}${td(it.isUploaded ? "Yes" : "No")}${linkCell(url ?? "", "Download Here")}</tr>`);
  });
  const liveBase = blank(frontendBase) ? "" : frontendBase.replace(/\/+$/, "");
  const liveUrl = liveBase ? `${liveBase}/clubs/${clubId}/ocv-gov/v2/live-documents?yearId=${yearId}` : "";
  out.push("<tr></tr>", `<tr>${th("Live Documents", "2%")}${th("Module Name", "20%")}${th("Download Document", "48%")}</tr>`);
  header.liveTables.forEach((t, i) => {
    const pub = liveBase && !blank(t.moduleKey);
    out.push(`<tr>${td(String(i + 1))}${td(t.label)}${linkCell(pub ? `${liveBase}/ocv-live-documents/${clubId}/${t.moduleKey}?yearId=${yearId}` : liveUrl, pub ? "Click Here to Show" : "Download Here")}</tr>`);
  });
  out.push("<tr></tr>", `<tr>${th("Newsletters", "2%")}${th("Module Name", "20%")}${th("Download Document", "48%")}</tr>`);
  const newslettersPage = liveBase ? `${liveBase}/ocv-live-documents/${clubId}/newsletters?yearId=${yearId}` : "";
  header.newsletters.forEach((nl, i) => {
    const url = newslettersPage || absUrl(mediaBase, !blank(nl.filePath) ? nl.filePath : !blank(nl.linkUrl) ? nl.linkUrl : null) || "";
    out.push(`<tr>${td(String(i + 1))}${td(nl.title ?? "(untitled)")}${linkCell(url, newslettersPage ? "Click Here to Show" : "Download Here")}</tr>`);
  });
  out.push("<tr><td style='text-align: center;color:#1F4E79;' colspan='5'><i>End Of Report</i></td></tr>", "</table></font>");
  return Buffer.from(out.join(""), "utf8");
}
