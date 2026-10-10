import { AlignmentType, BorderStyle, Document, Packer, Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType } from "docx";

/**
 * Port of ClubReportWordBuilder.cs: the two Word reports of the Club Report page,
 * "Avenue of Service Raw Data" (a table per avenue, by area of focus) and
 * "Annual Club Service Raw Data" (one row per meeting).
 */
const BRAND = "003DA5";

export type AvenueAreaSummary = { areaOfFocus: string; projects: number; beneficiaries: number; amountSpent: number };
export type AvenueSection = { avenueName: string; rows: AvenueAreaSummary[] };
export type MeetingRow = { dateLabel: string; title: string; description: string; membersPresent: number };

// Strip characters XML cannot carry (imported text), as WordXmlHelper.Clean does.
const clean = (s: string) => (s ?? "").replace(/[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu, "");
const run = (text: string, o: { bold?: boolean; color?: string; size?: number } = {}) => new TextRun({ text: clean(text), ...o });
const centered = (text: string, size: number, bold = false, color?: string) =>
  new Paragraph({ children: [run(text, { size, bold, color })], alignment: AlignmentType.CENTER, spacing: { after: 120 } });
const spacer = () => new Paragraph({ children: [run("")] });
const sectionHeading = (title: string) =>
  new Paragraph({ children: [run(" " + title, { bold: true, color: "FFFFFF", size: 26 })], spacing: { before: 200, after: 200 }, shading: { fill: BRAND, type: ShadingType.CLEAR, color: "auto" } });

const outer = { style: BorderStyle.SINGLE, size: 4, color: BRAND };
const inner = { style: BorderStyle.SINGLE, size: 2, color: "BFD3F0" };
function table(headers: string[], rows: string[][]) {
  const header = new TableRow({
    tableHeader: true,
    children: headers.map((h) => new TableCell({ shading: { fill: BRAND, type: ShadingType.CLEAR, color: "auto" }, children: [new Paragraph({ children: [run(h, { bold: true, color: "FFFFFF", size: 22 })] })] })),
  });
  return new Table({
    width: { size: 5000, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.AUTOFIT,
    borders: { top: outer, bottom: outer, left: outer, right: outer, insideHorizontal: inner, insideVertical: inner },
    rows: [header, ...rows.map((r) => new TableRow({ children: r.map((c) => new TableCell({ children: [new Paragraph({ children: [run(c ?? "", { size: 20 })] })] })) }))],
  });
}

const header = (clubName: string, yearLabel: string, membershipStrength: number) => [
  centered(`Rotary Club of ${clubName}`, 32, true),
  centered(`Annual Report — RY ${yearLabel}`, 28, true, BRAND),
  centered(`Name of Club: Rotary Club of ${clubName}`, 30, true),
  centered(`Membership Strength: ${membershipStrength}`, 28, true),
  spacer(),
];

const doc = (children: (Paragraph | Table)[]) =>
  Packer.toBuffer(new Document({ sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 720, bottom: 720, left: 720, right: 720, header: 0, footer: 0, gutter: 0 } } }, children }] }));

export function buildAvenueRawData(clubName: string, yearLabel: string, membershipStrength: number, sections: AvenueSection[]): Promise<Buffer> {
  const blocks: (Paragraph | Table)[] = header(clubName, yearLabel, membershipStrength);
  for (const s of sections) {
    blocks.push(sectionHeading(s.avenueName));
    const rows = s.rows.map((r, i) => [String(i + 1), r.areaOfFocus, String(r.projects), String(r.beneficiaries), Math.round(r.amountSpent).toString()]);
    blocks.push(table(["Sr. No.", "Sub Heading", "Number of projects", "No Of Benefciaries", "Amount Spent"], rows.length ? rows : [["", "(no records)", "", "", ""]]));
    blocks.push(spacer());
  }
  return doc(blocks);
}

export function buildAnnualClubServiceRawData(clubName: string, yearLabel: string, membershipStrength: number, meetings: MeetingRow[]): Promise<Buffer> {
  const rows = meetings.map((m, i) => [String(i + 1), m.dateLabel, m.title, m.description ?? "", String(m.membersPresent)]);
  return doc([
    ...header(clubName, yearLabel, membershipStrength),
    sectionHeading("Club Service"),
    table(["Sr. No.", "Date", "Title", "Meeting Description", "Member Attendence"], rows.length ? rows : [["", "", "(no meetings recorded)", "", ""]]),
  ]);
}
