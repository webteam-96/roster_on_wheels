import ExcelJS from "exceljs";

/** The ClosedXML XLColor values the ported reports use, as ARGB. */
export const XLColor = {
  White: "FFFFFFFF", Black: "FF000000", DarkBlue: "FF00008B", DarkSlateGray: "FF2F4F4F", RoyalBlue: "FF4169E1", SeaGreen: "FF2E8B57",
  DarkOrange: "FFFF8C00", LightBlue: "FFADD8E6", LightGreen: "FF90EE90", LightSkyBlue: "FF87CEFA", PaleGreen: "FF98FB98", Gold: "FFFFD700",
  WhiteSmoke: "FFF5F5F5", LightSteelBlue: "FFB0C4DE", AliceBlue: "FFF0F8FF", Honeydew: "FFF0FFF0", LightGray: "FFD3D3D3", LightYellow: "FFFFFFE0",
  DarkGreen: "FF006400", Green: "FF008000", Red: "FFFF0000", LightCoral: "FFF08080", Navy: "FF000080", SteelBlue: "FF4682B4", Orange: "FFFFA500",
} as const;

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type Cell = ExcelJS.Cell;

/** Style a cell the way the ClosedXML code does: fill, font, alignment. */
export function style(
  cell: Cell,
  s: { fill?: string; bold?: boolean; italic?: boolean; size?: number; color?: string; align?: "left" | "center" | "right"; vAlign?: "top" | "middle" | "bottom"; wrap?: boolean },
) {
  if (s.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: s.fill } };
  if (s.bold !== undefined || s.italic !== undefined || s.size !== undefined || s.color !== undefined) {
    cell.font = { ...cell.font, ...(s.bold !== undefined ? { bold: s.bold } : {}), ...(s.italic !== undefined ? { italic: s.italic } : {}), ...(s.size ? { size: s.size } : {}), ...(s.color ? { color: { argb: s.color } } : {}) };
  }
  if (s.align || s.vAlign || s.wrap) cell.alignment = { ...cell.alignment, ...(s.align ? { horizontal: s.align } : {}), ...(s.vAlign ? { vertical: s.vAlign } : {}), ...(s.wrap ? { wrapText: true } : {}) };
}

/** Apply a style to every cell of a rectangular range. */
export function styleRange(ws: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number, s: Parameters<typeof style>[1]) {
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) style(ws.getCell(r, c), s);
}

/** Thin outside and inside borders over a range (Border.OutsideBorder / InsideBorder = Thin). */
export function thinBorders(ws: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number) {
  const thin = { style: "thin" as const };
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = { top: thin, left: thin, bottom: thin, right: thin };
}

/** IXLWorksheet.CopyTo(otherWorkbook, name): values, styles, merges, widths, heights and frozen panes. */
export function copyWorksheet(src: ExcelJS.Worksheet, dst: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = dst.addWorksheet(name);
  src.columns?.forEach((col, i) => { if (col.width) ws.getColumn(i + 1).width = col.width; });
  src.eachRow({ includeEmpty: true }, (row, r) => {
    const to = ws.getRow(r);
    if (row.height) to.height = row.height;
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      const t = to.getCell(c);
      t.value = cell.value;
      t.style = JSON.parse(JSON.stringify(cell.style ?? {}));
    });
  });
  for (const range of (src.model as { merges?: string[] }).merges ?? []) ws.mergeCells(range);
  if (src.views?.length) ws.views = JSON.parse(JSON.stringify(src.views));
  return ws;
}

/** ClosedXML Columns().AdjustToContents(), approximated: each column as wide as its longest text (+2), at least 8. */
export function fitColumns(ws: ExcelJS.Worksheet) {
  ws.columns?.forEach((col) => {
    let w = 8;
    col.eachCell?.({ includeEmpty: false }, (cell) => { w = Math.max(w, String(cell.text ?? "").length + 2); });
    col.width = Math.min(w, 100);
  });
}

export async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export { ExcelJS };
