import { MonthlyReportPreview } from "@/types/clubMonthlyReport";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Document, Packer, Paragraph, Table as DocxTable, TableRow as DocxTableRow, TableCell as DocxTableCell, TextRun, HeadingLevel, WidthType, BorderStyle, AlignmentType } from "docx";
import { saveAs } from "file-saver";

import { appLocale, currencySymbol } from "@/lib/appFormat";
const PROJECT_LABELS: Record<string, string> = {
  community_service: "Community Service",
  vocational_service: "Vocational Service",
  international_service: "International Service",
  new_generation_service: "New Generation Service",
  public_image_initiative: "Public Image Initiative",
};

const MEETING_TYPE_LABELS: Record<string, string> = {
  regular: "Regular",
  fellowship: "Fellowship",
  bod: "BOD",
  assembly: "Assembly",
  trust: "Trust",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = days[d.getDay()];
  const dd = String(d.getDate()).padStart(2, "0");
  const mon = months[d.getMonth()];
  const year = d.getFullYear();
  let hours = d.getHours();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const hh = String(hours).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${day}, ${dd} ${mon} ${year} ${hh}:${mm}:${ss} ${ampm}`;
}

function getFileName(report: MonthlyReportPreview): string {
  // CMR filename is club + month + year only (no download timestamp) — per user 2026-08-03.
  return `${report.clubName}_Monthly_Report_${report.monthName}_${report.yearLabel}`.replace(/\s+/g, "_");
}

// ==================== PDF ====================
export function downloadPDF(report: MonthlyReportPreview) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 15;

  // Title
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(`Club Monthly Report - ${report.monthName} ${report.yearLabel}`, pageWidth / 2, y, { align: "center" });
  y += 7;

  // Upload to district date
  if (report.uploadedToDistrictDate) {
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(`Uploaded to District: ${formatDateTime(report.uploadedToDistrictDate)}`, pageWidth / 2, y, { align: "center" });
  }
  y += 6;

  // Club info
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const infoRows = [
    ["Club Name", report.clubName, "Prepared By", report.preparedBy || "-"],
    ["Rotary Club ID", report.clubCode || "-", "Designation", report.designation || "-"],
    ["Assistant Governor", report.assistantGovernor || "N/A", "No. Of Members", String(report.currentMemberCount)],
    ["No. Of Meetings", String(report.totalMeetings), "Avg. Attendance", `${report.averageAttendance}%`],
  ];
  autoTable(doc, {
    startY: y,
    body: infoRows.map(row => [
      { content: row[0], styles: { fontStyle: "bold" } }, row[1],
      { content: row[2], styles: { fontStyle: "bold" } }, row[3],
    ]),
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { cellWidth: 40 }, 2: { cellWidth: 40 } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8;

  // TRF Section
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("TRF Contribution", 14, y);
  y += 5;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Current Month: $${report.trfCurrentMonth.toFixed(2)}    |    This Year: $${report.trfThisYear.toFixed(2)}`, 14, y);
  y += 4;

  if (report.trfEntries.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["Sr.No", "Date", "Name", "Amount (USD)", "Fund Type"]],
      body: report.trfEntries.map((e, i) => [
        i + 1,
        formatDate(e.trfDate),
        e.donorName,
        `$${e.amountUSD.toFixed(2)}`,
        e.fundType === "Other" && e.otherFundName ? e.otherFundName : e.fundType,
      ]),
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [41, 128, 185], fontStyle: "bold" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 8;
  } else {
    y += 4;
  }

  // Meetings Section
  const meetingsByType: Record<string, typeof report.meetings> = {};
  for (const m of report.meetings) {
    const t = m.meetingType || "other";
    if (!meetingsByType[t]) meetingsByType[t] = [];
    meetingsByType[t].push(m);
  }

  if (Object.keys(meetingsByType).length > 0) {
    if (y > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 15; }
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Meetings", 14, y);
    y += 6;

    for (const [type, meetings] of Object.entries(meetingsByType)) {
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(`${MEETING_TYPE_LABELS[type] || type} (${meetings.length})`, 14, y);
      y += 4;
      autoTable(doc, {
        startY: y,
        head: [["Sr.No", "Date", "Title", "Attendance", "Attendance %"]],
        body: meetings.map((m, i) => [
          i + 1, formatDate(m.projectDate), m.title,
          m.attendance ?? "-", m.attendancePercentage != null ? `${m.attendancePercentage}%` : "-",
        ]),
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [41, 128, 185], fontStyle: "bold" },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      y = (doc as any).lastAutoTable.finalY + 6;
    }
  }

  // Projects Sections
  for (const [key, label] of Object.entries(PROJECT_LABELS)) {
    const projects = report.projects[key];
    if (!projects || projects.length === 0) continue;

    if (y > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 15; }
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(label, 14, y);
    y += 6;

    const isCommunity = key === "community_service";
    const head = isCommunity
      ? [["Sr.No", "Date", "Title", "Area of Focus", "Category", "Sub Category", "Cost", "Beneficiaries", "Man Hours", "Rotarians", "Rotaractors"]]
      : [["Sr.No", "Date", "Title", "Category", "Sub Category", "Cost", "Beneficiaries", "Man Hours", "Rotarians", "Rotaractors"]];

    const body = projects.map((p, i) => {
      const typeTag = (key === "community_service" || key === "public_image_initiative") && p.projectType
        ? ` [${p.projectType === "one_time" ? "One Time" : "Ongoing"}]` : "";
      const childTag = p.parentProjectId ? " [Child]" : "";
      const title = `${p.title}${typeTag}${childTag}`;
      const common = [
        p.projectCost != null ? p.projectCost.toLocaleString() : "-",
        p.directBeneficiaries ?? "-", p.manHours ?? "-",
        p.rotariansInvolved ?? "-", p.rotaractorsInvolved ?? "-",
      ];
      if (isCommunity) {
        return [i + 1, formatDate(p.projectDate), title, p.areaOfFocusName || "-", p.categoryName || "-", p.subCategoryName || "-", ...common];
      }
      return [i + 1, formatDate(p.projectDate), title, p.areaOfFocusName || "-", p.categoryName || "-", ...common];
    });

    autoTable(doc, {
      startY: y,
      head, body,
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [41, 128, 185], fontStyle: "bold" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // Members Section
  if (y > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 15; }
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Members", 14, y);
  y += 6;
  autoTable(doc, {
    startY: y,
    body: [
      [{ content: "Member count as on last month", styles: { fontStyle: "bold" } }, String(report.memberCountLastMonth),
       { content: "Members Deleted/Terminated", styles: { fontStyle: "bold" } }, String(report.membersDeleted)],
      [{ content: "Members Added", styles: { fontStyle: "bold" } }, String(report.membersAdded),
       { content: "Current No. Of Members", styles: { fontStyle: "bold" } }, String(report.currentMemberCount)],
    ],
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { cellWidth: 55 }, 2: { cellWidth: 55 } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 4;

  if (report.additionalRemarks) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("Additional achievement/participation/hosting of events/projects above club if any:", 14, y);
    y += 4;
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(report.additionalRemarks, pageWidth - 28);
    doc.text(lines, 14, y);
    y += lines.length * 4 + 4;
  } else {
    y += 4;
  }

  // Note
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.text("Note: Agenda, MOM added in meeting & Photographs added in Club Meetings will not be shared to the District, only the content displayed here will be shared to the District.", 14, y, { maxWidth: pageWidth - 28 });

  doc.save(`${getFileName(report)}.pdf`);
}

// Generate PDF as base64 string (for email attachment)
export function generatePDFBase64(report: MonthlyReportPreview): string {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 15;

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(`Club Monthly Report - ${report.monthName} ${report.yearLabel}`, pageWidth / 2, y, { align: "center" });
  y += 7;

  if (report.uploadedToDistrictDate) {
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(`Uploaded to District: ${formatDateTime(report.uploadedToDistrictDate)}`, pageWidth / 2, y, { align: "center" });
  }
  y += 6;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const infoRows = [
    ["Club Name", report.clubName, "Prepared By", report.preparedBy || "-"],
    ["Rotary Club ID", report.clubCode || "-", "Designation", report.designation || "-"],
    ["Assistant Governor", report.assistantGovernor || "N/A", "No. Of Members", String(report.currentMemberCount)],
    ["No. Of Meetings", String(report.totalMeetings), "Avg. Attendance", `${report.averageAttendance}%`],
  ];
  autoTable(doc, {
    startY: y,
    body: infoRows,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 40 }, 2: { fontStyle: "bold", cellWidth: 40 } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 6;

  // TRF
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("TRF Contribution", 14, y);
  y += 5;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Current Month: $${report.trfCurrentMonth.toFixed(2)}    |    This Year: $${report.trfThisYear.toFixed(2)}`, 14, y);
  y += 5;

  if (report.trfEntries.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["Sr.No", "Date", "Name", "Amount (USD)", "Fund Type"]],
      body: report.trfEntries.map((e, i) => [
        i + 1, formatDate(e.trfDate), e.donorName, `$${e.amountUSD.toFixed(2)}`,
        e.fundType === "Other" && e.otherFundName ? e.otherFundName : e.fundType,
      ]),
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // Meetings
  const meetingsByType: Record<string, typeof report.meetings> = {};
  for (const m of report.meetings) {
    const t = m.meetingType || "Other";
    if (!meetingsByType[t]) meetingsByType[t] = [];
    meetingsByType[t].push(m);
  }
  for (const [type, items] of Object.entries(meetingsByType)) {
    const label = MEETING_TYPE_LABELS[type] || type;
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(`${label} Meetings`, 14, y);
    y += 5;
    autoTable(doc, {
      startY: y,
      head: [["Sr.No", "Title", "Date", "Attendance", "Attendance %"]],
      body: items.map((m, i) => [i + 1, m.title, formatDate(m.projectDate), m.attendance ?? "-", m.attendancePercentage != null ? `${m.attendancePercentage}%` : "-"]),
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // Projects
  for (const [key, items] of Object.entries(report.projects)) {
    const label = PROJECT_LABELS[key] || key;
    const isCommunityService = key === "community_service";
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(label, 14, y);
    y += 5;
    const head = isCommunityService
      ? [["Sr.No", "Title", "Date", "Area of Focus", "Category", "Sub Category", "Cost", "Beneficiaries", "Man Hours", "Rotarians", "Rotaractors"]]
      : [["Sr.No", "Title", "Date", "Category", "Sub Category", "Cost", "Beneficiaries", "Man Hours", "Rotarians", "Rotaractors"]];
    const body = items.map((p, i) => {
      const base = [i + 1, p.title, formatDate(p.projectDate)];
      if (isCommunityService) base.push(p.areaOfFocusName || "-", p.categoryName || "-", p.subCategoryName || "-");
      else base.push(p.categoryName || "-", p.subCategoryName || "-");
      base.push(p.projectCost != null ? `${currencySymbol()}${p.projectCost}` : "-", p.directBeneficiaries ?? "-", p.manHours ?? "-", p.rotariansInvolved ?? "-", p.rotaractorsInvolved ?? "-");
      return base;
    });
    autoTable(doc, { startY: y, head, body, theme: "grid", styles: { fontSize: 7, cellPadding: 1.5 } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // Members
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Members", 14, y);
  y += 5;
  autoTable(doc, {
    startY: y,
    body: [
      ["Member count as on last month", String(report.memberCountLastMonth), "Members Deleted/Terminated", String(report.membersDeleted)],
      ["Members Added", String(report.membersAdded), "Current No. Of Members", String(report.currentMemberCount)],
    ],
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { cellWidth: 55 }, 2: { cellWidth: 55 } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 4;

  if (report.additionalRemarks) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("Additional achievement/participation/hosting of events/projects above club if any:", 14, y);
    y += 4;
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(report.additionalRemarks, pageWidth - 28);
    doc.text(lines, 14, y);
    y += lines.length * 4 + 4;
  } else {
    y += 4;
  }

  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.text("Note: Agenda, MOM added in meeting & Photographs added in Club Meetings will not be shared to the District, only the content displayed here will be shared to the District.", 14, y, { maxWidth: pageWidth - 28 });

  // Return base64 without the data:application/pdf;base64, prefix
  const pdfOutput = doc.output("datauristring");
  return pdfOutput.split(",")[1];
}

// ==================== WORD ====================
export async function downloadWord(report: MonthlyReportPreview) {
  const border = {
    top: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
    left: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
    right: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
  };

  function cell(text: string, bold = false): DocxTableCell {
    return new DocxTableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold, size: 18 })] })],
      borders: border,
    });
  }

  function headerCell(text: string): DocxTableCell {
    return new DocxTableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 18, color: "FFFFFF" })] })],
      borders: border,
      shading: { fill: "2980B9" },
    });
  }

  const sections: Paragraph[] = [];
  const tables: (Paragraph | DocxTable)[] = [];

  // Title
  tables.push(new Paragraph({
    children: [new TextRun({ text: `Club Monthly Report - ${report.monthName} ${report.yearLabel}`, bold: true, size: 28 })],
    alignment: AlignmentType.CENTER,
    spacing: { after: report.uploadedToDistrictDate ? 50 : 200 },
  }));

  if (report.uploadedToDistrictDate) {
    tables.push(new Paragraph({
      children: [new TextRun({ text: `Uploaded to District: ${formatDateTime(report.uploadedToDistrictDate)}`, size: 24, bold: true })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }));
  }

  // Info table
  tables.push(new DocxTable({
    rows: [
      new DocxTableRow({ children: [cell("Club Name", true), cell(report.clubName), cell("Prepared By", true), cell(report.preparedBy || "-")] }),
      new DocxTableRow({ children: [cell("Rotary Club ID", true), cell(report.clubCode || "-"), cell("Designation", true), cell(report.designation || "-")] }),
      new DocxTableRow({ children: [cell("Assistant Governor", true), cell(report.assistantGovernor || "N/A"), cell("No. Of Members", true), cell(String(report.currentMemberCount))] }),
      new DocxTableRow({ children: [cell("No. Of Meetings", true), cell(String(report.totalMeetings)), cell("Avg. Attendance", true), cell(`${report.averageAttendance}%`)] }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  }));

  tables.push(new Paragraph({ spacing: { before: 200 } }));

  // TRF
  tables.push(new Paragraph({
    children: [new TextRun({ text: "TRF Contribution", bold: true, size: 24 })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 100 },
  }));
  tables.push(new Paragraph({
    children: [new TextRun({ text: `Current Month: $${report.trfCurrentMonth.toFixed(2)}    |    This Year: $${report.trfThisYear.toFixed(2)}`, size: 18 })],
    spacing: { after: 100 },
  }));

  if (report.trfEntries.length > 0) {
    tables.push(new DocxTable({
      rows: [
        new DocxTableRow({ children: [headerCell("Sr.No"), headerCell("Date"), headerCell("Name"), headerCell("Amount (USD)"), headerCell("Fund Type")] }),
        ...report.trfEntries.map((e, i) =>
          new DocxTableRow({ children: [
            cell(String(i + 1)), cell(formatDate(e.trfDate)), cell(e.donorName),
            cell(`$${e.amountUSD.toFixed(2)}`),
            cell(e.fundType === "Other" && e.otherFundName ? e.otherFundName : e.fundType),
          ]})
        ),
      ],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }));
  }

  // Meetings
  const meetingsByType: Record<string, typeof report.meetings> = {};
  for (const m of report.meetings) {
    const t = m.meetingType || "other";
    if (!meetingsByType[t]) meetingsByType[t] = [];
    meetingsByType[t].push(m);
  }

  if (Object.keys(meetingsByType).length > 0) {
    tables.push(new Paragraph({
      children: [new TextRun({ text: "Meetings", bold: true, size: 24 })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 100 },
    }));

    for (const [type, meetings] of Object.entries(meetingsByType)) {
      tables.push(new Paragraph({
        children: [new TextRun({ text: `${MEETING_TYPE_LABELS[type] || type} (${meetings.length})`, bold: true, size: 20 })],
        spacing: { before: 100, after: 50 },
      }));
      tables.push(new DocxTable({
        rows: [
          new DocxTableRow({ children: [headerCell("Sr.No"), headerCell("Date"), headerCell("Title"), headerCell("Attendance"), headerCell("Attendance %")] }),
          ...meetings.map((m, i) =>
            new DocxTableRow({ children: [
              cell(String(i + 1)), cell(formatDate(m.projectDate)), cell(m.title),
              cell(m.attendance != null ? String(m.attendance) : "-"),
              cell(m.attendancePercentage != null ? `${m.attendancePercentage}%` : "-"),
            ]})
          ),
        ],
        width: { size: 100, type: WidthType.PERCENTAGE },
      }));
    }
  }

  // Projects
  for (const [key, label] of Object.entries(PROJECT_LABELS)) {
    const projects = report.projects[key];
    if (!projects || projects.length === 0) continue;

    tables.push(new Paragraph({
      children: [new TextRun({ text: label, bold: true, size: 24 })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 100 },
    }));

    const isCommunity = key === "community_service";
    const headerRow = isCommunity
      ? new DocxTableRow({ children: [headerCell("Sr.No"), headerCell("Date"), headerCell("Title"), headerCell("Area of Focus"), headerCell("Category"), headerCell("Sub Category"), headerCell("Cost"), headerCell("Beneficiaries"), headerCell("Man Hours"), headerCell("Rotarians"), headerCell("Rotaractors")] })
      : new DocxTableRow({ children: [headerCell("Sr.No"), headerCell("Date"), headerCell("Title"), headerCell("Category"), headerCell("Sub Category"), headerCell("Cost"), headerCell("Beneficiaries"), headerCell("Man Hours"), headerCell("Rotarians"), headerCell("Rotaractors")] });

    const dataRows = projects.map((p, i) => {
      const typeTag = (key === "community_service" || key === "public_image_initiative") && p.projectType
        ? ` [${p.projectType === "one_time" ? "One Time" : "Ongoing"}]` : "";
      const childTag = p.parentProjectId ? " [Child]" : "";
      const title = `${p.title}${typeTag}${childTag}`;
      const common = [
        cell(p.projectCost != null ? p.projectCost.toLocaleString() : "-"),
        cell(p.directBeneficiaries != null ? String(p.directBeneficiaries) : "-"),
        cell(p.manHours != null ? String(p.manHours) : "-"),
        cell(p.rotariansInvolved != null ? String(p.rotariansInvolved) : "-"),
        cell(p.rotaractorsInvolved != null ? String(p.rotaractorsInvolved) : "-"),
      ];
      if (isCommunity) {
        return new DocxTableRow({ children: [cell(String(i + 1)), cell(formatDate(p.projectDate)), cell(title), cell(p.areaOfFocusName || "-"), cell(p.categoryName || "-"), cell(p.subCategoryName || "-"), ...common] });
      }
      return new DocxTableRow({ children: [cell(String(i + 1)), cell(formatDate(p.projectDate)), cell(title), cell(p.areaOfFocusName || "-"), cell(p.categoryName || "-"), ...common] });
    });

    tables.push(new DocxTable({
      rows: [headerRow, ...dataRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }));
  }

  // Members
  tables.push(new Paragraph({
    children: [new TextRun({ text: "Members", bold: true, size: 24 })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 100 },
  }));
  tables.push(new DocxTable({
    rows: [
      new DocxTableRow({ children: [cell("Member count as on last month", true), cell(String(report.memberCountLastMonth)), cell("Members Deleted/Terminated", true), cell(String(report.membersDeleted))] }),
      new DocxTableRow({ children: [cell("Members Added", true), cell(String(report.membersAdded)), cell("Current No. Of Members", true), cell(String(report.currentMemberCount))] }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  }));

  if (report.additionalRemarks) {
    tables.push(new Paragraph({
      children: [new TextRun({ text: "Additional achievement/participation/hosting of events/projects above club if any: ", bold: true, size: 18 }), new TextRun({ text: report.additionalRemarks, size: 18 })],
      spacing: { before: 100 },
    }));
  }

  // Note
  tables.push(new Paragraph({
    children: [
      new TextRun({ text: "Note: ", bold: true, size: 16, italics: true }),
      new TextRun({ text: "Agenda, MOM added in meeting & Photographs added in Club Meetings will not be shared to the District, only the content displayed here will be shared to the District.", size: 16, italics: true }),
    ],
    spacing: { before: 200 },
  }));

  const doc = new Document({
    sections: [{ children: [...tables, ...sections] }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${getFileName(report)}.docx`);
}
