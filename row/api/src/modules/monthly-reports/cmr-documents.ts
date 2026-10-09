import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import sharp from "sharp";
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, ImageRun, Packer, Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow,
  TextRun, WidthType, type ParagraphChild,
} from "docx";
import PdfPrinter from "pdfmake";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { formatNumber } from "../../common/dotnet-format";
import type { ReportPreview, WordPhoto, WordProject } from "./monthly-report.service";

/**
 * Ports of ClubMonthlyReportWordBuilder.cs (OpenXML) and
 * ClubMonthlyReportPdfBuilder.cs (QuestPDF) to docx and pdfmake, plus
 * CmrMediaLoader.cs. Project costs are shown in the brand currency (RIZones
 * printed rupees); PDF text uses Times as the serif face (the PDF standard
 * fonts have no Georgia).
 */

const BRAND = "003DA5";
const LABEL = "44546A";
const MUTED = "7A7A7A";
const LINK = "0563C1";
const DIVIDER = "B9C7DE";
const LABEL_BG = "EEF3FB";
const INK = "222222";
const AVENUES: [string, string][] = [
  ["community_service", "Community Service"], ["vocational_service", "Vocational Service"], ["international_service", "International Service"],
  ["new_generation_service", "New Generation Service"], ["public_image_initiative", "Public Image Initiative"],
];
const MEETING_TYPES: Record<string, string> = { regular: "Regular", fellowship: "Fellowship", bod: "BOD", assembly: "Assembly", trust: "Trust" };
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---- shared helpers ----

/** CmrMediaLoader: the photo from wwwroot, else from Media:RedirectBaseUrl. */
export async function loadPhoto(webRoot: string, redirectBase: string | null, ph: WordPhoto) {
  if (!ph.imagePath) return;
  ph.imageExtension = extname(ph.imagePath).replace(/^\./, "").toLowerCase();
  ph.imageBytes = await loadMediaBytes(webRoot, redirectBase, ph.imagePath);
}

export async function loadMediaBytes(webRoot: string, redirectBase: string | null, webPath: string | null): Promise<Buffer | null> {
  if (!webPath) return null;
  try {
    return await readFile(join(webRoot, ...webPath.replace(/^\/+/, "").split("/")));
  } catch {
    // not on this server's disk
  }
  if (redirectBase) {
    try {
      const r = await fetch(redirectBase.replace(/\/+$/, "") + webPath, { signal: AbortSignal.timeout(20_000) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch {
      // unreachable: no photo
    }
  }
  return null;
}

const blank = (s: string | null | undefined) => !s || !s.trim();
const dash = (s: string | null | undefined) => (blank(s) ? "-" : String(s));
const firstNonEmpty = (...v: (string | null | undefined)[]) => v.find((x) => !blank(x)) ?? null;
const pad = (n: number) => String(n).padStart(2, "0");
const usd = (n: number) => "$" + new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const pct = (n: number) => String(Math.round(n * 100) / 100);

/** "yyyy-MM-dd..." -> "dd MMM yyyy" (invariant). */
function fmtDate(text: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text ?? "");
  return m ? `${m[3]} ${MONTHS_SHORT[Number(m[2]) - 1]} ${m[1]}` : (text ?? "");
}

/** "ddd, dd MMM yyyy hh:mm:ss tt" (invariant). */
function fmtDateTime(text: string): string {
  const d = new Date(/Z|[+-]\d{2}:?\d{2}$/.test(text) ? text : text + "Z");
  if (isNaN(d.getTime())) return text;
  const h = d.getUTCHours();
  return `${DAYS[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(h % 12 || 12)}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${h < 12 ? "AM" : "PM"}`;
}

function docUrl(mediaBase: string, path: string | null): string | null {
  if (blank(path)) return null;
  if (/^http/i.test(path!)) return path;
  const base = (mediaBase ?? "").replace(/\/+$/, "");
  return path!.startsWith("/") ? base + path : `${base}/${path}`;
}

/** The label: value pairs printed under each meeting / project title. */
function facts(p: WordProject, isMeeting: boolean): [string, string][] {
  const out: [string, string][] = [];
  const pos = (n: number | null) => n !== null && n !== undefined && n > 0;
  if (isMeeting) {
    if (pos(p.attendance)) out.push(["Attendance", `${p.attendance}${pos(p.attendancePercentage) ? ` (${pct(Number(p.attendancePercentage))}%)` : ""}`]);
    if (!blank(p.location)) out.push(["Location", p.location!]);
    return out;
  }
  const focus = firstNonEmpty(p.areaOfFocusName, p.otherAreaOfFocus);
  if (focus) out.push(["Area of Focus", focus]);
  if (!blank(p.categoryName)) out.push(["Category", p.categoryName!]);
  if (!blank(p.subCategoryName)) out.push(["Sub-Category", p.subCategoryName!]);
  if (!blank(p.location)) out.push(["Location", p.location!]);
  if (pos(p.projectCost)) out.push(["Cost", formatNumber(Number(p.projectCost), "C0")]);
  if (!blank(p.fundingName)) out.push(["Funding", p.fundingName!]);
  if (pos(p.directBeneficiaries)) out.push(["Beneficiaries", String(p.directBeneficiaries)]);
  if (pos(p.manHours)) out.push(["Man-hours", String(p.manHours)]);
  if (pos(p.rotariansInvolved)) out.push(["Rotarians", String(p.rotariansInvolved)]);
  if (pos(p.rotaractorsInvolved)) out.push(["Rotaractors", String(p.rotaractorsInvolved)]);
  if (pos(p.rccInvolved)) out.push(["RCC", String(p.rccInvolved)]);
  if (p.isJointProject) out.push(["Joint Project", blank(p.coHostName) ? "Yes" : `with ${p.coHostName}`]);
  return out;
}

function metaLine(p: WordProject, isMeeting: boolean): string {
  const meta: string[] = [];
  if (!blank(p.projectDate)) meta.push(fmtDate(p.projectDate));
  if (isMeeting && !blank(p.meetingType)) meta.push(`${MEETING_TYPES[p.meetingType!.toLowerCase()] ?? p.meetingType} meeting`);
  return meta.join("   ·   ");
}

function trfRows(s: ReportPreview): string[][] {
  return s.trfEntries.map((e, i) => {
    const fund = e.fundType === "Other" && !blank(e.otherFundName as string) ? String(e.otherFundName) : String(e.fundType ?? "");
    return [String(i + 1), fmtDate(String(e.trfDate ?? "")), String(e.donorName ?? ""), usd(Number(e.amountUSD ?? 0)), fund];
  });
}

/** XmlClean: drop characters XML cannot carry. */
const xmlClean = (s: string) => s.replace(/[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu, "");

function imageSize(b: Buffer): [number, number] {
  try {
    if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return [b.readInt32BE(16), b.readInt32BE(20)];
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = b[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return [(b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]];
        const len = (b[i + 2] << 8) | b[i + 3];
        if (len <= 0) break;
        i += 2 + len;
      }
    }
    if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return [b[6] | (b[7] << 8), b[8] | (b[9] << 8)];
  } catch {
    // unreadable header
  }
  return [800, 600];
}

// ---- Word ----

const run = (text: string, o: { bold?: boolean; italics?: boolean; color?: string; size?: number } = {}) => new TextRun({ text: xmlClean(text), ...o });
const para = (children: ParagraphChild[], o: Record<string, unknown> = {}) => new Paragraph({ children, ...o });
const centered = (text: string, size: number, bold = false, color?: string) => para([run(text, { size, bold, color })], { alignment: AlignmentType.CENTER, spacing: { after: 60 } });
const sectionHeading = (title: string) =>
  para([run(title, { bold: true, color: BRAND, size: 30 })], { spacing: { before: 360, after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BRAND, space: 4 } } });
const subHeading = (title: string) => para([run(title, { bold: true, color: BRAND, size: 24 })], { spacing: { before: 240, after: 80 } });
const mutedText = (text: string) => para([run(text, { italics: true, color: MUTED, size: 20 })]);
const bodyPara = (text: string) => para([run(text, { size: 21 })], { alignment: AlignmentType.BOTH, spacing: { after: 80 } });
const spacer = () => para([run("")]);
const thin = { style: BorderStyle.SINGLE, size: 2, color: DIVIDER };
const tableBorders = { top: thin, bottom: thin, left: thin, right: thin, insideHorizontal: thin, insideVertical: thin };
const cell = (text: string, label: boolean) =>
  new TableCell({
    shading: label ? { fill: LABEL_BG, type: ShadingType.CLEAR, color: "auto" } : undefined,
    children: [para([run(text ?? "", label ? { bold: true, color: LABEL, size: 19 } : { size: 19 })])],
  });

function fourColTable(rows: string[][]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [2600, 2400, 2600, 2400], layout: TableLayoutType.FIXED, borders: tableBorders,
    rows: rows.map((r) => new TableRow({ children: [cell(r[0], true), cell(r[1], false), cell(r[2], true), cell(r[3], false)] })),
  });
}

function gridTable(headers: string[], rows: string[][]) {
  const header = new TableRow({
    tableHeader: true,
    children: headers.map((h) => new TableCell({ shading: { fill: BRAND, type: ShadingType.CLEAR, color: "auto" }, children: [para([run(h, { bold: true, color: "FFFFFF", size: 19 })])] })),
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED, borders: tableBorders,
    rows: [header, ...rows.map((r) => new TableRow({ children: r.map((c) => cell(c, false)) }))],
  });
}

type Block = Paragraph | Table;

function wordItem(blocks: Block[], mediaBase: string, p: WordProject, isMeeting: boolean, index: number) {
  blocks.push(para([run(`${index}.  ${blank(p.title) ? "(untitled)" : p.title}`, { bold: true, color: INK, size: 25 })], { spacing: { before: 220, after: 20 } }));
  const meta = metaLine(p, isMeeting);
  if (meta) blocks.push(para([run(meta, { italics: true, color: MUTED, size: 19 })], { spacing: { after: 40 } }));
  const f = facts(p, isMeeting);
  if (f.length) {
    const parts: ParagraphChild[] = [];
    f.forEach(([k, v], i) => {
      if (i > 0) parts.push(run("   ·   ", { color: DIVIDER, size: 19 }));
      parts.push(run(`${k}: `, { bold: true, color: LABEL, size: 19 }), run(v, { size: 19 }));
    });
    blocks.push(para(parts, { spacing: { after: 40 } }));
  }
  if (!blank(p.description)) blocks.push(bodyPara(p.description!));
  const links = ([["Agenda", p.agendaDocument], ["Minutes of Meeting", p.minutesDocument]] as [string, string | null][]).filter(([, path]) => !blank(path));
  if (links.length) {
    const parts: ParagraphChild[] = [run("Documents:  ", { bold: true, color: LABEL, size: 19 })];
    links.forEach(([label, path], i) => {
      if (i > 0) parts.push(run("    ·    ", { color: MUTED, size: 19 }));
      parts.push(new ExternalHyperlink({ link: docUrl(mediaBase, path)!, children: [new TextRun({ text: label, color: LINK, underline: {}, size: 19 })] }));
    });
    blocks.push(para(parts, { spacing: { before: 40, after: 60 } }));
  }
  for (const ph of p.photos) {
    const ext = (ph.imageExtension ?? "").toLowerCase();
    const type = ext === "jpg" || ext === "jpeg" ? "jpg" : ext === "png" ? "png" : ext === "gif" ? "gif" : ext === "bmp" ? "bmp" : null;
    if (!ph.imageBytes || !ph.imageBytes.length || !type) continue;
    // FitEmu: at most ~4.48" x 3.72", never enlarged.
    let [w, h] = imageSize(ph.imageBytes);
    if (w <= 0 || h <= 0) [w, h] = [800, 600];
    const scale = Math.min(4_100_000 / (w * 9525), 3_400_000 / (h * 9525), 1);
    blocks.push(
      para([new ImageRun({ type, data: ph.imageBytes, transformation: { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) } })], {
        alignment: AlignmentType.CENTER, spacing: { before: 120, after: 40 },
      }),
    );
    if (!blank(ph.description)) blocks.push(para([run(ph.description!, { italics: true, color: MUTED, size: 18 })], { alignment: AlignmentType.CENTER, spacing: { after: 140 } }));
  }
  blocks.push(spacer());
}

function wordSections(blocks: Block[], items: WordProject[], mediaBase: string, period: "month" | "year", meetingsTitle: string) {
  const meetings = items.filter((i) => i.moduleKey === "club_service");
  blocks.push(sectionHeading(`${meetingsTitle} (${meetings.length})`));
  if (!meetings.length) blocks.push(mutedText(`No meetings recorded for this ${period}.`));
  meetings.forEach((m, i) => wordItem(blocks, mediaBase, m, true, i + 1));
  for (const [key, label] of AVENUES) {
    const list = items.filter((i) => i.moduleKey === key);
    blocks.push(sectionHeading(`${label} (${list.length})`));
    if (!list.length) blocks.push(mutedText(`No ${label} projects recorded for this ${period}.`));
    list.forEach((p, i) => wordItem(blocks, mediaBase, p, false, i + 1));
  }
}

function wordDocument(blocks: Block[]) {
  return Packer.toBuffer(
    new Document({
      styles: { default: { document: { run: { font: "Georgia", size: 22 }, paragraph: { spacing: { after: 120, line: 276 } } } } },
      sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1080, bottom: 1080, left: 1080, right: 1080, header: 0, footer: 0, gutter: 0 } } }, children: blocks }],
    }),
  );
}

/** BuildReport: the monthly report as .docx. */
export function buildWordReport(s: ReportPreview, items: WordProject[], mediaBase: string): Promise<Buffer> {
  const blocks: Block[] = [centered(`Club Monthly Report — ${s.monthName} ${s.yearLabel}`, 32, true)];
  if (s.uploadedToDistrictDate) blocks.push(centered(`Uploaded to District: ${fmtDateTime(s.uploadedToDistrictDate)}`, 22, true, MUTED));
  blocks.push(spacer());
  blocks.push(
    fourColTable([
      ["Club Name", s.clubName, "Prepared By", dash(s.preparedBy)],
      ["Rotary Club ID", dash(s.clubCode), "Designation", dash(s.designation)],
      ["Assistant Governor", dash(s.assistantGovernor), "No. Of Members", String(s.currentMemberCount)],
      ["No. Of Meetings", String(s.totalMeetings), "Avg. Attendance", `${pct(s.averageAttendance)}%`],
    ]),
  );
  blocks.push(subHeading("TRF Contribution"));
  blocks.push(para([run(`Current Month: ${usd(s.trfCurrentMonth)}    |    This Year: ${usd(s.trfThisYear)}`, { size: 21 })]));
  if (s.trfEntries.length) blocks.push(gridTable(["Sr.No", "Date", "Name", "Amount (USD)", "Fund Type"], trfRows(s)));
  blocks.push(subHeading("Members"));
  blocks.push(
    fourColTable([
      ["Member count as on last month", String(s.memberCountLastMonth), "Members Deleted/Terminated", String(s.membersDeleted)],
      ["Members Added", String(s.membersAdded), "Current No. Of Members", String(s.currentMemberCount)],
    ]),
  );
  if (!blank(s.additionalRemarks)) {
    blocks.push(para([run("Additional achievement / participation / hosting of events / projects above club, if any:", { bold: true, color: LABEL, size: 20 })], { spacing: { before: 120, after: 20 } }));
    blocks.push(bodyPara(s.additionalRemarks!));
  }
  wordSections(blocks, items, mediaBase, "month", "Meetings");
  blocks.push(spacer());
  blocks.push(
    para(
      [
        run("Note: ", { bold: true, italics: true, size: 16 }),
        run("Agenda, MOM and photographs added to Club Meetings are not shared with the District — only the content displayed here is shared.", { italics: true, size: 16 }),
      ],
      { spacing: { before: 200 } },
    ),
  );
  return wordDocument(blocks);
}

/** BuildAnnualReport: the club's year as .docx. */
export function buildWordAnnualReport(
  clubName: string, yearLabel: string, mem: { current: number; male: number; female: number; honorary: number; addedThisYear: number }, items: WordProject[], mediaBase: string,
): Promise<Buffer> {
  const blocks: Block[] = [centered(`Rotary Club of ${clubName}`, 34, true), centered(`Annual Report — RY ${yearLabel}`, 28, true, BRAND), spacer(), sectionHeading("Membership")];
  blocks.push(
    fourColTable([
      ["Current Members", String(mem.current), "Added this year", String(mem.addedThisYear)],
      ["Male", String(mem.male), "Female", String(mem.female)],
      ["Honorary", String(mem.honorary), "", ""],
    ]),
  );
  wordSections(blocks, items, mediaBase, "year", "Club Service — Meetings");
  return wordDocument(blocks);
}

// ---- PDF ----

const FONTS = { Times: { normal: "Times-Roman", bold: "Times-Bold", italics: "Times-Italic", bolditalics: "Times-BoldItalic" } };
const CONTENT_WIDTH = 595.28 - 2 * 42.52;
const c = (hex: string) => `#${hex}`;

function looksLikeImage(b: Buffer) {
  if (b.length < 12) return false;
  return (
    (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) ||
    (b[0] === 0x42 && b[1] === 0x4d) || (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP")
  );
}

/** PDF images must be JPEG or PNG: other formats are converted (and big ones scaled down, like QuestPDF's 96 DPI raster). */
async function pdfImage(b: Buffer): Promise<string | null> {
  try {
    const out = await sharp(b).rotate().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    return null; // a photo that will not decode is skipped
  }
}

function infoGrid(rows: string[][]): Content {
  const lab = (t: string) => ({ text: t, bold: true, color: c(LABEL), fontSize: 9.5, fillColor: c(LABEL_BG) });
  const val = (t: string) => ({ text: t, fontSize: 9.5 });
  return { table: { widths: [2.4, 2.6, 2.4, 2.6].map((w) => (CONTENT_WIDTH * w) / 10), body: rows.map((r) => [lab(r[0]), val(r[1]), lab(r[2]), val(r[3])]) }, layout: gridLayout() };
}

function gridLayout() {
  return {
    hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => c(DIVIDER), vLineColor: () => c(DIVIDER),
    paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 3, paddingBottom: () => 3,
  };
}

const sectionHeadingPdf = (title: string): Content[] => [
  { text: title, bold: true, fontSize: 14.5, color: c(BRAND), margin: [0, 12, 0, 2] },
  { canvas: [{ type: "line", x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 1.2, lineColor: c(BRAND) }] },
];

async function pdfItem(out: Content[], mediaBase: string, p: WordProject, isMeeting: boolean, index: number, includePhotos: boolean) {
  out.push({ text: `${index}.  ${blank(p.title) ? "(untitled)" : p.title}`, bold: true, fontSize: 12.5, color: c(INK), margin: [0, 8, 0, 0] });
  const meta = metaLine(p, isMeeting);
  if (meta) out.push({ text: meta, italics: true, color: c(MUTED), fontSize: 9.5 });
  const f = facts(p, isMeeting);
  if (f.length) {
    const parts: Content[] = [];
    f.forEach(([k, v], i) => {
      if (i > 0) parts.push({ text: "   ·   ", color: c(DIVIDER), fontSize: 9.5 });
      parts.push({ text: `${k}: `, bold: true, color: c(LABEL), fontSize: 9.5 }, { text: v, fontSize: 9.5 });
    });
    out.push({ text: parts, margin: [0, 2, 0, 0] } as Content);
  }
  if (!blank(p.description)) out.push({ text: p.description!, fontSize: 10.5, margin: [0, 2, 0, 0] });
  const agenda = docUrl(mediaBase, p.agendaDocument);
  const mom = docUrl(mediaBase, p.minutesDocument);
  if (agenda || mom) {
    const parts: Content[] = [{ text: "Documents:  ", bold: true, color: c(LABEL), fontSize: 9.5 }];
    if (agenda) parts.push({ text: "Agenda", link: agenda, color: c(LINK), decoration: "underline", fontSize: 9.5 });
    if (agenda && mom) parts.push({ text: "   ", fontSize: 9.5 });
    if (mom) parts.push({ text: "Minutes of Meeting", link: mom, color: c(LINK), decoration: "underline", fontSize: 9.5 });
    out.push({ text: parts, margin: [0, 3, 0, 0] } as Content);
  }
  if (!includePhotos) return;
  for (const ph of p.photos) {
    if (!ph.imageBytes || !looksLikeImage(ph.imageBytes)) continue;
    const image = await pdfImage(ph.imageBytes);
    if (!image) continue;
    out.push({ image, fit: [340.16, 311.81], alignment: "center", margin: [0, 6, 0, 0] });
    if (!blank(ph.description)) out.push({ text: ph.description!, italics: true, color: c(MUTED), fontSize: 8.5, alignment: "center", margin: [0, 0, 0, 4] });
  }
}

/** ClubMonthlyReportPdfBuilder.Build: the monthly report as PDF (A4, page x of y). */
export async function buildPdfReport(s: ReportPreview, items: WordProject[], mediaBase: string, includePhotos = true): Promise<Buffer> {
  const content: Content[] = [{ text: `Club Monthly Report — ${s.monthName} ${s.yearLabel}`, bold: true, fontSize: 17, color: "#111111", alignment: "center" }];
  if (s.uploadedToDistrictDate) content.push({ text: `Uploaded to District: ${fmtDateTime(s.uploadedToDistrictDate)}`, fontSize: 10, color: c(MUTED), alignment: "center" });
  content.push({ text: "", margin: [0, 0, 0, 4] });
  content.push(
    infoGrid([
      ["Club Name", s.clubName, "Prepared By", dash(s.preparedBy)],
      ["Rotary Club ID", dash(s.clubCode), "Designation", dash(s.designation)],
      ["Assistant Governor", dash(s.assistantGovernor), "No. Of Members", String(s.currentMemberCount)],
      ["No. Of Meetings", String(s.totalMeetings), "Avg. Attendance", `${pct(s.averageAttendance)}%`],
    ]),
  );
  content.push({ text: "TRF Contribution", bold: true, fontSize: 12, color: c(BRAND), margin: [0, 8, 0, 0] });
  content.push({ text: `Current Month: ${usd(s.trfCurrentMonth)}     |     This Year: ${usd(s.trfThisYear)}`, fontSize: 10 });
  if (s.trfEntries.length) {
    const header = ["Sr.No", "Date", "Name", "Amount (USD)", "Fund Type"].map((h) => ({ text: h, bold: true, color: "#FFFFFF", fontSize: 9.5, fillColor: c(BRAND) }));
    content.push({
      table: { headerRows: 1, widths: [1, 2, 3, 2, 3].map((w) => (CONTENT_WIDTH * w) / 11), body: [header, ...trfRows(s).map((r) => r.map((v) => ({ text: v, fontSize: 9.5 })))] },
      layout: gridLayout(), margin: [0, 2, 0, 0],
    });
  }
  content.push({ text: "Members", bold: true, fontSize: 12, color: c(BRAND), margin: [0, 8, 0, 0] });
  content.push(
    infoGrid([
      ["Member count as on last month", String(s.memberCountLastMonth), "Members Deleted/Terminated", String(s.membersDeleted)],
      ["Members Added", String(s.membersAdded), "Current No. Of Members", String(s.currentMemberCount)],
    ]),
  );
  if (!blank(s.additionalRemarks)) {
    content.push({ text: "Additional achievement / participation / hosting of events / projects above club, if any:", bold: true, color: c(LABEL), fontSize: 10, margin: [0, 4, 0, 0] });
    content.push({ text: s.additionalRemarks!, fontSize: 10.5 });
  }
  const meetings = items.filter((i) => i.moduleKey === "club_service");
  content.push(...sectionHeadingPdf(`Meetings (${meetings.length})`));
  if (!meetings.length) content.push({ text: "No meetings recorded for this month.", italics: true, color: c(MUTED), fontSize: 10 });
  for (let i = 0; i < meetings.length; i++) await pdfItem(content, mediaBase, meetings[i], true, i + 1, includePhotos);
  for (const [key, label] of AVENUES) {
    const list = items.filter((i) => i.moduleKey === key);
    content.push(...sectionHeadingPdf(`${label} (${list.length})`));
    if (!list.length) content.push({ text: `No ${label} projects recorded for this month.`, italics: true, color: c(MUTED), fontSize: 10 });
    for (let i = 0; i < list.length; i++) await pdfItem(content, mediaBase, list[i], false, i + 1, includePhotos);
  }
  content.push({
    text: [
      { text: "Note: ", bold: true, italics: true, fontSize: 8.5 },
      { text: "Agenda, MOM and photographs added to Club Meetings are not shared with the District — only the content displayed here is shared.", italics: true, fontSize: 8.5, color: c(MUTED) },
    ],
    margin: [0, 12, 0, 0],
  } as Content);
  const definition: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [42.52, 42.52, 42.52, 42.52],
    defaultStyle: { font: "Times", fontSize: 10.5, color: c(INK), lineHeight: 1.2 },
    content,
    footer: (page: number, pages: number) => ({ text: `Page ${page} of ${pages}`, alignment: "center", fontSize: 8, color: c(MUTED) }),
  };
  const doc = new PdfPrinter(FONTS).createPdfKitDocument(definition);
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (d: Buffer) => chunks.push(d));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}
