// Attendance (Member Wise) MATRIX export — used by the Club Report / e-Governance Reports tab.
//
// Layout (mirrors the legacy report):
//   Row 0            Club name banner
//   Row 1            "Attendance Report (Member Wise) — RY ####"
//   Row 2  col0="Member Name" | <Event Name per column> | "Total Present"
//   Row 3            <Event date/time per column>
//   Row 4..N         member name | P / A per event | total present count
//   Row N+1          "Total Present" | per-event present counts | grand total
//
// P = Present, A = Absent.

import XLSX from "xlsx-js-style";
import { fileTimestamp } from "@/lib/dateUtils";
import type { AttendanceMatrixPayload } from "@/services/api";

const border = {
  top: { style: "thin" as const, color: { rgb: "000000" } },
  bottom: { style: "thin" as const, color: { rgb: "000000" } },
  left: { style: "thin" as const, color: { rgb: "000000" } },
  right: { style: "thin" as const, color: { rgb: "000000" } },
};

const bannerStyle = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 14 },
  fill: { fgColor: { rgb: "2D7FC7" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border,
};
const subtitleStyle = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill: { fgColor: { rgb: "1F4E79" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border,
};
const cornerStyle = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill: { fgColor: { rgb: "1F4E79" } },
  alignment: { horizontal: "left" as const, vertical: "center" as const },
  border,
};
const eventNameStyle = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 9 },
  fill: { fgColor: { rgb: "2D7FC7" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const, wrapText: true },
  border,
};
const eventDateStyle = {
  font: { bold: true, color: { rgb: "1F4E79" }, sz: 8 },
  fill: { fgColor: { rgb: "DCE6F1" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const, wrapText: true },
  border,
};
const totalHeaderStyle = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
  fill: { fgColor: { rgb: "C00000" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const, wrapText: true },
  border,
};
const memberCellStyle = {
  font: { bold: true, sz: 10 },
  alignment: { horizontal: "left" as const, vertical: "center" as const },
  border,
};
const presentStyle = {
  font: { bold: true, sz: 10, color: { rgb: "0B6A0B" } },
  fill: { fgColor: { rgb: "E7F4E7" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border,
};
const absentStyle = {
  font: { bold: true, sz: 10, color: { rgb: "B00020" } },
  fill: { fgColor: { rgb: "FBE9E9" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border,
};
const rowTotalStyle = {
  font: { bold: true, color: { rgb: "1F4E79" }, sz: 10 },
  fill: { fgColor: { rgb: "FFF2CC" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border,
};
const totalRowLabelStyle = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill: { fgColor: { rgb: "1F4E79" } },
  alignment: { horizontal: "left" as const, vertical: "center" as const },
  border,
};
const totalRowCellStyle = {
  font: { bold: true, color: { rgb: "1F4E79" }, sz: 10 },
  fill: { fgColor: { rgb: "FFF2CC" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border,
};
const grandTotalStyle = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill: { fgColor: { rgb: "C00000" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border,
};

const addr = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });

function fmtEventDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // Date only — time intentionally omitted (user request 2026-09-09).
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

export function exportAttendanceMatrix(
  payload: AttendanceMatrixPayload,
  opts?: { filenamePrefix?: string },
): boolean {
  const { clubName, yearLabel, events, members } = payload;
  if (!events || events.length === 0 || !members || members.length === 0) return false;

  const E = events.length;
  const totalCol = E + 1; // far-right "Total Present" column index

  const ws: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];

  // Row 0 — club banner across every column.
  ws[addr(0, 0)] = { v: clubName || "Club", t: "s", s: bannerStyle };
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalCol } });

  // Row 1 — subtitle.
  ws[addr(1, 0)] = {
    v: `Attendance Report (Member Wise)${yearLabel ? ` — RY ${yearLabel}` : ""}`,
    t: "s",
    s: subtitleStyle,
  };
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: totalCol } });

  // Row 2 — Member Name (merged down over row 3) | event names | Total Present (merged down).
  ws[addr(2, 0)] = { v: "Member Name", t: "s", s: cornerStyle };
  merges.push({ s: { r: 2, c: 0 }, e: { r: 3, c: 0 } });
  events.forEach((ev, i) => { ws[addr(2, 1 + i)] = { v: ev.name || "", t: "s", s: eventNameStyle }; });
  ws[addr(2, totalCol)] = { v: "Total Present", t: "s", s: totalHeaderStyle };
  merges.push({ s: { r: 2, c: totalCol }, e: { r: 3, c: totalCol } });

  // Row 3 — event date/time.
  events.forEach((ev, i) => { ws[addr(3, 1 + i)] = { v: fmtEventDate(ev.dateTime), t: "s", s: eventDateStyle }; });

  // Body — one row per member.
  const perEventCount: number[] = new Array(E).fill(0);
  members.forEach((m, ri) => {
    const r = 4 + ri;
    ws[addr(r, 0)] = { v: m.memberName || "", t: "s", s: memberCellStyle };
    let presentCount = 0;
    for (let i = 0; i < E; i++) {
      const present = !!m.present[i];
      if (present) { presentCount++; perEventCount[i]++; }
      ws[addr(r, 1 + i)] = { v: present ? "P" : "A", t: "s", s: present ? presentStyle : absentStyle };
    }
    ws[addr(r, totalCol)] = { v: presentCount, t: "n", s: rowTotalStyle };
  });

  // Bottom totals row — per-event present counts + grand total.
  const totalR = 4 + members.length;
  ws[addr(totalR, 0)] = { v: "Total Present", t: "s", s: totalRowLabelStyle };
  let grand = 0;
  for (let i = 0; i < E; i++) { ws[addr(totalR, 1 + i)] = { v: perEventCount[i], t: "n", s: totalRowCellStyle }; grand += perEventCount[i]; }
  ws[addr(totalR, totalCol)] = { v: grand, t: "n", s: grandTotalStyle };

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalR, c: totalCol } });
  ws["!merges"] = merges;
  ws["!cols"] = [{ wch: 28 }, ...events.map(() => ({ wch: 14 })), { wch: 14 }];
  ws["!rows"] = [
    { hpt: 26 }, // banner
    { hpt: 20 }, // subtitle
    { hpt: 26 }, // event name
    { hpt: 34 }, // event date/time
    ...members.map(() => ({ hpt: 18 })),
    { hpt: 22 }, // bottom total
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Attendance Member Wise");
  const prefix = opts?.filenamePrefix || `${(clubName || "Club").replace(/\s+/g, "_")}_Member_Wise_Attendance`;
  const yearSlug = (yearLabel || "").replace(/[^\w-]/g, "");
  XLSX.writeFile(wb, `${prefix}${yearSlug ? `_${yearSlug}` : ""}_${fileTimestamp()}.xlsx`);
  return true;
}
