// Citation matrix Excel export — used by 3 surfaces:
//  · /districts/{id}/district-report  (all clubs, current year)
//  · /district-admin-dashboard/egovernance  (all clubs in DA's district)
//  · /clubs/{id}/club-report/v2  (single club row)
//
// Each Auto/Manual question is shown as 3 sub-columns:
//     Base Points | Achieved | Total Points
//
// Non-numeric answers (Yes/No, Choose-One) render text in Achieved.
// Yes/No: Base = Yes-points, Achieved = "Yes"/"No"/"".
// Choose-One: Base = blank, Achieved = chosen option text.

import XLSX from "xlsx-js-style";
import { fileTimestamp } from "@/lib/dateUtils";

export interface CitationMatrixColumn {
  type: "auto" | "manual";
  questionId: number;
  title: string;
  basePoints: number;
  answerType: "number" | "yesno" | "choose_one";
}

export interface CitationMatrixCell {
  achievedDisplay: string;     // what we draw in Achieved cell ("Yes", "4+", "10", "")
  achievedNumeric: number | null;
  total: number;
}

export interface CitationMatrixCategory {
  id: number;
  name: string;
  span: number;
}

export interface CitationMatrixRow {
  clubId: number;
  clubName: string;
  cells: Record<string, CitationMatrixCell>;
}

export interface CitationMatrixPayload {
  districtNumber: string;
  yearLabel: string;
  categories: CitationMatrixCategory[];
  columns: CitationMatrixColumn[];
  rows: CitationMatrixRow[];
}

const border = {
  top: { style: "thin" as const, color: { rgb: "000000" } },
  bottom: { style: "thin" as const, color: { rgb: "000000" } },
  left: { style: "thin" as const, color: { rgb: "000000" } },
  right: { style: "thin" as const, color: { rgb: "000000" } },
};

const bannerStyle = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 14 },
  fill: { fgColor: { rgb: "1F4E79" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border,
};
const catHeaderStyle = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 12 },
  fill: { fgColor: { rgb: "1F4E79" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const, wrapText: true },
  border,
};
const questionHeaderStyle = {
  font: { bold: true, color: { rgb: "000000" }, sz: 10 },
  fill: { fgColor: { rgb: "DCE6F1" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const, wrapText: true },
  border,
};
const typeAutoStyle = {
  font: { bold: true, color: { rgb: "1F4E79" }, sz: 9 },
  fill: { fgColor: { rgb: "E8EEF4" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border,
};
const typeManualStyle = {
  font: { bold: true, color: { rgb: "8B4513" }, sz: 9 },
  fill: { fgColor: { rgb: "FBE9D8" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border,
};
const subHeaderStyle = {
  font: { bold: true, color: { rgb: "1F4E79" }, sz: 9 },
  fill: { fgColor: { rgb: "F4F7FA" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border,
};
const totalHeaderStyle = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill: { fgColor: { rgb: "C00000" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border,
};
const clubCellStyle = {
  font: { bold: true, sz: 10 },
  alignment: { horizontal: "left" as const, vertical: "center" as const },
  border,
};
const baseCellStyle = {
  font: { sz: 10, color: { rgb: "555555" } },
  alignment: { horizontal: "right" as const, vertical: "center" as const },
  fill: { fgColor: { rgb: "F9FAFC" } },
  border,
};
const achievedCellStyle = {
  font: { sz: 10 },
  alignment: { horizontal: "right" as const, vertical: "center" as const },
  border,
};
const achievedTextStyle = {
  font: { sz: 10 },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border,
};
const totalCellStyle = {
  font: { bold: true, sz: 10, color: { rgb: "1F4E79" } },
  alignment: { horizontal: "right" as const, vertical: "center" as const },
  border,
};
const rowTotalStyle = {
  font: { bold: true, color: { rgb: "1F4E79" }, sz: 10 },
  fill: { fgColor: { rgb: "FFF2CC" } },
  alignment: { horizontal: "right" as const, vertical: "center" as const },
  border,
};
const totalRowLabelStyle = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill: { fgColor: { rgb: "1F4E79" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border,
};
const totalRowCellStyle = {
  font: { bold: true, color: { rgb: "1F4E79" }, sz: 10 },
  fill: { fgColor: { rgb: "FFF2CC" } },
  alignment: { horizontal: "right" as const, vertical: "center" as const },
  border,
};
const grandTotalStyle = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 12 },
  fill: { fgColor: { rgb: "C00000" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border,
};

const fmtNum = (n: number) => String(Math.round(n));

const addr = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });

export function exportCitationMatrix(
  matrix: CitationMatrixPayload,
  opts?: { filenamePrefix?: string; compact?: boolean }
): boolean {
  const { districtNumber, yearLabel, categories, columns, rows } = matrix;
  if (!columns || columns.length === 0 || !rows || rows.length === 0) return false;

  // Compact mode = "District Awards" (swapped 2026-09-09) — only Total Points per question
  // (no Base, no Achieved). Non-compact = "District Awards Extended" = Base | Achieved | Total.
  const SUB_COLS_PER_QUESTION = opts?.compact ? 1 : 3;
  const totalQCells = columns.length * SUB_COLS_PER_QUESTION;
  const autoTotalCol = totalQCells + 1;
  const manualTotalCol = totalQCells + 2;
  const grandTotalCol = totalQCells + 3;

  const ws: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];

  // ── Row 0: Banner — spans every column
  ws[addr(0, 0)] = {
    v: `District ${districtNumber}     Rotary Year: ${yearLabel}`,
    t: "s",
    s: bannerStyle,
  };
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: grandTotalCol } });

  // ── Row 1: Club Name | Category headers (span 3*span_in_questions) | totals
  ws[addr(1, 0)] = { v: "Club Name", t: "s", s: catHeaderStyle };
  merges.push({ s: { r: 1, c: 0 }, e: { r: 4, c: 0 } });

  let colCursor = 1;
  for (const cat of categories) {
    const span = cat.span * SUB_COLS_PER_QUESTION;
    ws[addr(1, colCursor)] = { v: cat.name, t: "s", s: catHeaderStyle };
    merges.push({ s: { r: 1, c: colCursor }, e: { r: 1, c: colCursor + span - 1 } });
    colCursor += span;
  }
  ws[addr(1, autoTotalCol)] = { v: "Auto Total", t: "s", s: totalHeaderStyle };
  merges.push({ s: { r: 1, c: autoTotalCol }, e: { r: 4, c: autoTotalCol } });
  ws[addr(1, manualTotalCol)] = { v: "Manual Total", t: "s", s: totalHeaderStyle };
  merges.push({ s: { r: 1, c: manualTotalCol }, e: { r: 4, c: manualTotalCol } });
  ws[addr(1, grandTotalCol)] = { v: "Total", t: "s", s: totalHeaderStyle };
  merges.push({ s: { r: 1, c: grandTotalCol }, e: { r: 4, c: grandTotalCol } });

  // ── Row 2: Question titles (span 3 sub-cols each)
  // ── Row 3: Auto/Manual chip (span 3 sub-cols each)
  // ── Row 4: Base | Achieved | Total sub-headers
  columns.forEach((col, i) => {
    const c0 = 1 + i * SUB_COLS_PER_QUESTION;
    ws[addr(2, c0)] = { v: col.title || "", t: "s", s: questionHeaderStyle };
    merges.push({ s: { r: 2, c: c0 }, e: { r: 2, c: c0 + SUB_COLS_PER_QUESTION - 1 } });

    ws[addr(3, c0)] = {
      v: col.type === "auto" ? "Auto" : "Manual",
      t: "s",
      s: col.type === "auto" ? typeAutoStyle : typeManualStyle,
    };
    if (SUB_COLS_PER_QUESTION > 1) {
      merges.push({ s: { r: 3, c: c0 }, e: { r: 3, c: c0 + SUB_COLS_PER_QUESTION - 1 } });
      ws[addr(4, c0)] = { v: "Base", t: "s", s: subHeaderStyle };
      ws[addr(4, c0 + 1)] = { v: "Achieved", t: "s", s: subHeaderStyle };
      ws[addr(4, c0 + 2)] = { v: "Total", t: "s", s: subHeaderStyle };
    } else {
      // compact — Auto/Manual chip directly above each Total cell; no Base/Achieved sub-headers.
      ws[addr(4, c0)] = { v: "Total", t: "s", s: subHeaderStyle };
    }
  });

  // ── Body rows: each club gets 3 sub-cells per question
  const colTotals: number[] = new Array(columns.length).fill(0);
  let grandAuto = 0;
  let grandManual = 0;

  rows.forEach((row, ri) => {
    const r = 5 + ri;
    ws[addr(r, 0)] = { v: row.clubName, t: "s", s: clubCellStyle };

    let rowAuto = 0;
    let rowManual = 0;

    columns.forEach((col, i) => {
      const c0 = 1 + i * SUB_COLS_PER_QUESTION;
      const key = `${col.type}-${col.questionId}`;
      const cell = row.cells?.[key];
      const total = Number(cell?.total) || 0;

      if (SUB_COLS_PER_QUESTION > 1) {
        // Base
        if (col.answerType === "choose_one") {
          ws[addr(r, c0)] = { v: "", t: "s", s: baseCellStyle };
        } else {
          ws[addr(r, c0)] = { v: Number(col.basePoints) || 0, t: "n", s: baseCellStyle };
        }

        // Achieved — number for "number"/"auto", text for "yesno"/"choose_one"
        const isTextAchieved = col.answerType === "yesno" || col.answerType === "choose_one";
        if (cell == null || cell.achievedDisplay === undefined || cell.achievedDisplay === "") {
          ws[addr(r, c0 + 1)] = { v: "", t: "s", s: isTextAchieved ? achievedTextStyle : achievedCellStyle };
        } else if (isTextAchieved) {
          ws[addr(r, c0 + 1)] = { v: cell.achievedDisplay, t: "s", s: achievedTextStyle };
        } else {
          const n = cell.achievedNumeric;
          if (n != null && !Number.isNaN(Number(n))) {
            ws[addr(r, c0 + 1)] = { v: Number(n), t: "n", s: achievedCellStyle };
          } else {
            ws[addr(r, c0 + 1)] = { v: cell.achievedDisplay, t: "s", s: achievedTextStyle };
          }
        }

        // Total
        ws[addr(r, c0 + 2)] = { v: total, t: "n", s: totalCellStyle };
      } else {
        // compact — single Total cell per question
        ws[addr(r, c0)] = { v: total, t: "n", s: totalCellStyle };
      }

      if (col.type === "auto") rowAuto += total;
      else rowManual += total;
      colTotals[i] += total;
    });

    ws[addr(r, autoTotalCol)] = { v: rowAuto, t: "n", s: rowTotalStyle };
    ws[addr(r, manualTotalCol)] = { v: rowManual, t: "n", s: rowTotalStyle };
    ws[addr(r, grandTotalCol)] = { v: rowAuto + rowManual, t: "n", s: rowTotalStyle };

    grandAuto += rowAuto;
    grandManual += rowManual;
  });

  // ── Bottom totals row
  const totalR = 5 + rows.length;
  ws[addr(totalR, 0)] = { v: "Total", t: "s", s: totalRowLabelStyle };

  let bottomAuto = 0;
  let bottomManual = 0;
  columns.forEach((col, i) => {
    const c0 = 1 + i * SUB_COLS_PER_QUESTION;
    if (SUB_COLS_PER_QUESTION > 1) {
      ws[addr(totalR, c0)] = { v: "", t: "s", s: totalRowCellStyle };
      if (col.answerType === "number") {
        let achSum = 0; let any = false;
        rows.forEach((row) => {
          const c = row.cells?.[`${col.type}-${col.questionId}`];
          if (c?.achievedNumeric != null) { achSum += Number(c.achievedNumeric); any = true; }
        });
        ws[addr(totalR, c0 + 1)] = { v: any ? achSum : "", t: any ? "n" : "s", s: totalRowCellStyle };
      } else {
        ws[addr(totalR, c0 + 1)] = { v: "", t: "s", s: totalRowCellStyle };
      }
      ws[addr(totalR, c0 + 2)] = { v: colTotals[i], t: "n", s: totalRowCellStyle };
    } else {
      ws[addr(totalR, c0)] = { v: colTotals[i], t: "n", s: totalRowCellStyle };
    }

    if (col.type === "auto") bottomAuto += colTotals[i];
    else bottomManual += colTotals[i];
  });

  ws[addr(totalR, autoTotalCol)] = { v: bottomAuto, t: "n", s: grandTotalStyle };
  ws[addr(totalR, manualTotalCol)] = { v: bottomManual, t: "n", s: grandTotalStyle };
  ws[addr(totalR, grandTotalCol)] = { v: grandAuto + grandManual, t: "n", s: grandTotalStyle };

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalR, c: grandTotalCol } });
  ws["!merges"] = merges;
  ws["!cols"] = [
    { wch: 32 },
    ...columns.flatMap(() => SUB_COLS_PER_QUESTION === 3
      ? [{ wch: 8 }, { wch: 12 }, { wch: 10 }]
      : [{ wch: 14 }]),
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
  ];
  ws["!rows"] = [
    { hpt: 26 }, // banner
    { hpt: 24 }, // category
    { hpt: 56 }, // question title
    { hpt: 20 }, // auto/manual
    { hpt: 18 }, // base/achieved/total sub-header
    ...rows.map(() => ({ hpt: 20 })),
    { hpt: 22 }, // bottom total
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "District Awards");
  const prefix = opts?.filenamePrefix || `District_${districtNumber}_District_Awards`;
  const yearSlug = yearLabel.replace(/[^\w-]/g, "");
  XLSX.writeFile(wb, `${prefix}_${yearSlug}_${fileTimestamp()}.xlsx`);
  return true;
}

// VERTICAL, print-friendly single-club variant (for the CLUB download only — the district-admin matrix
// above is unchanged). One question per row grouped by category, like the Club Analytics print report.
export function exportCitationMatrixVertical(
  matrix: CitationMatrixPayload,
  opts?: { filenamePrefix?: string; compact?: boolean }
): boolean {
  const { districtNumber, yearLabel, categories, columns, rows } = matrix;
  if (!columns || columns.length === 0 || !rows || rows.length === 0) return false;
  const compact = !!opts?.compact;
  const club = rows[0];
  const lastCol = compact ? 1 : 3;   // Question(+Total)  OR  Question+Base+Achieved+Total

  const ws: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];
  const rowHeights: { hpt: number }[] = [];
  let r = 0;
  const band = (text: string, style: unknown, h = 22) => {
    ws[addr(r, 0)] = { v: text, t: "s", s: style };
    merges.push({ s: { r, c: 0 }, e: { r, c: lastCol } });
    rowHeights[r] = { hpt: h }; r++;
  };

  band(club.clubName, bannerStyle, 26);
  band(`District ${districtNumber}     Rotary Year: ${yearLabel}     ${compact ? "District Awards" : "District Awards (Extended)"}`, subHeaderStyle, 20);
  rowHeights[r] = { hpt: 6 }; r++;

  let colCursor = 0, grandAuto = 0, grandManual = 0;
  for (const cat of categories) {
    const catCols = columns.slice(colCursor, colCursor + cat.span);
    colCursor += cat.span;
    if (catCols.length === 0) continue;

    band(cat.name, catHeaderStyle, 22);
    ws[addr(r, 0)] = { v: "Question", t: "s", s: subHeaderStyle };
    if (compact) ws[addr(r, 1)] = { v: "Total Points", t: "s", s: subHeaderStyle };
    else { ws[addr(r, 1)] = { v: "Base", t: "s", s: subHeaderStyle }; ws[addr(r, 2)] = { v: "Achieved", t: "s", s: subHeaderStyle }; ws[addr(r, 3)] = { v: "Total", t: "s", s: subHeaderStyle }; }
    rowHeights[r] = { hpt: 18 }; r++;

    let catTotal = 0;
    for (const col of catCols) {
      const cell = club.cells?.[`${col.type}-${col.questionId}`];
      const total = Number(cell?.total) || 0;
      catTotal += total;
      if (col.type === "auto") grandAuto += total; else grandManual += total;

      ws[addr(r, 0)] = { v: col.title || "", t: "s", s: clubCellStyle };
      if (compact) {
        ws[addr(r, 1)] = { v: total, t: "n", s: totalCellStyle };
      } else {
        ws[addr(r, 1)] = col.answerType === "choose_one"
          ? { v: "", t: "s", s: baseCellStyle }
          : { v: Number(col.basePoints) || 0, t: "n", s: baseCellStyle };
        const isText = col.answerType === "yesno" || col.answerType === "choose_one";
        if (cell == null || !cell.achievedDisplay) ws[addr(r, 2)] = { v: "", t: "s", s: isText ? achievedTextStyle : achievedCellStyle };
        else if (isText) ws[addr(r, 2)] = { v: cell.achievedDisplay, t: "s", s: achievedTextStyle };
        else if (cell.achievedNumeric != null && !Number.isNaN(Number(cell.achievedNumeric))) ws[addr(r, 2)] = { v: Number(cell.achievedNumeric), t: "n", s: achievedCellStyle };
        else ws[addr(r, 2)] = { v: cell.achievedDisplay, t: "s", s: achievedTextStyle };
        ws[addr(r, 3)] = { v: total, t: "n", s: totalCellStyle };
      }
      rowHeights[r] = { hpt: 18 }; r++;
    }

    ws[addr(r, 0)] = { v: `${cat.name}: Subtotal`, t: "s", s: totalRowLabelStyle };
    if (compact) ws[addr(r, 1)] = { v: catTotal, t: "n", s: totalRowCellStyle };
    else { ws[addr(r, 1)] = { v: "", t: "s", s: totalRowCellStyle }; ws[addr(r, 2)] = { v: "", t: "s", s: totalRowCellStyle }; ws[addr(r, 3)] = { v: catTotal, t: "n", s: totalRowCellStyle }; }
    rowHeights[r] = { hpt: 20 }; r++;
    rowHeights[r] = { hpt: 6 }; r++;
  }

  const gt = (label: string, val: number) => {
    ws[addr(r, 0)] = { v: label, t: "s", s: totalRowLabelStyle };
    if (compact) ws[addr(r, 1)] = { v: val, t: "n", s: grandTotalStyle };
    else { ws[addr(r, 1)] = { v: "", t: "s", s: grandTotalStyle }; ws[addr(r, 2)] = { v: "", t: "s", s: grandTotalStyle }; ws[addr(r, 3)] = { v: val, t: "n", s: grandTotalStyle }; }
    rowHeights[r] = { hpt: 20 }; r++;
  };
  gt("Auto Total", grandAuto);
  gt("Manual Total", grandManual);
  gt("Total", grandAuto + grandManual);

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: r - 1, c: lastCol } });
  ws["!merges"] = merges;
  ws["!cols"] = compact ? [{ wch: 52 }, { wch: 16 }] : [{ wch: 52 }, { wch: 10 }, { wch: 14 }, { wch: 12 }];
  ws["!rows"] = rowHeights;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "District Awards");
  const prefix = opts?.filenamePrefix || `Club_District_Awards`;
  const yearSlug = yearLabel.replace(/[^\w-]/g, "");
  XLSX.writeFile(wb, `${prefix}_${yearSlug}_${fileTimestamp()}.xlsx`);
  return true;
}
