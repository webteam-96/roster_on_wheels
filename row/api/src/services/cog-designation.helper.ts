import { Brand } from "../brand/brand";

/**
 * Port of CogDesignationHelper.cs. One configured club (Brand.scope.cogClubId,
 * a "council of governors" roster) keeps each member's past-governor label in
 * club_members.Designation ("3292 Dg 2025 - 26"); these helpers split it into
 * district and Rotary year. With cogClubId 0 (ROW's default) no club matches
 * and every COG branch is inert.
 */
const cogId = () => Math.trunc(Number(Brand.Current.scope.cogClubId) || 0);

export const isCog = (clubId: number) => cogId() > 0 && clubId === cogId();
export const cogClubId = cogId;

export const cogDistrictSql = (cm = "cm") => `NULLIF(REGEXP_SUBSTR(${cm}.Designation, '^[0-9]+'), '')`;

export const cogYearStartSql = (cm = "cm") =>
  `NULLIF(REGEXP_SUBSTR(TRIM(SUBSTRING(${cm}.Designation, LENGTH(REGEXP_SUBSTR(${cm}.Designation, '^[0-9]+')) + 1)), '[0-9]{4}'), '')`;

export function cogYearLabelSql(cm = "cm"): string {
  const y = cogYearStartSql(cm);
  return `CASE WHEN ${y} IS NULL THEN NULL ELSE CONCAT(${y}, '-', LPAD((CAST(${y} AS SIGNED) + 1) % 100, 2, '0')) END`;
}

export const cogDistrictColumn = (cm = "cm") => `CASE WHEN ${cm}.fk_club_id = ${cogId()} THEN ${cogDistrictSql(cm)} END`;
export const cogYearColumn = (cm = "cm") => `CASE WHEN ${cm}.fk_club_id = ${cogId()} THEN ${cogYearLabelSql(cm)} END`;
export const cogJoinedDateExpr = (cm = "cm") => `CASE WHEN ${cm}.fk_club_id = ${cogId()} THEN NULL ELSE ${cm}.JoinedDate END`;
export const cogSelectColumns = (cm = "cm") => `${cogDistrictColumn(cm)} AS cogDistrictNumber,\n                   ${cogYearColumn(cm)} AS cogYear`;

/** "2025" -> "2025-26" */
export function toRotaryYearLabel(startYear: string | null | undefined): string | null {
  if (!startYear || !startYear.trim() || !/^\s*-?\d+\s*$/.test(startYear)) return null;
  const y = parseInt(startYear, 10);
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

export function parseCogDesignation(designation: string | null | undefined): { districtNumber: string | null; yearLabel: string | null } {
  if (!designation || !designation.trim()) return { districtNumber: null, yearLabel: null };
  const s = designation.trim();
  const district = /^\d+/.exec(s)?.[0] ?? null;
  const rest = s.slice(district?.length ?? 0);
  const yearStart = /\d{4}/.exec(rest)?.[0] ?? null;
  return { districtNumber: district, yearLabel: toRotaryYearLabel(yearStart) };
}

/** ("3292", "2025-26") -> "3292 Dg 2025 - 26" */
export function composeCogDesignation(districtNumber: string, yearLabel: string): string {
  const start = parseInt(yearLabel.slice(0, 4), 10);
  return `${districtNumber.trim()} Dg ${start} - ${String((start + 1) % 100).padStart(2, "0")}`;
}
