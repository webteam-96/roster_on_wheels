// District Set Goals "Save goals": only the goals that changed are sent (RIZones 2026-11-23: every club x every
// line, now with the 26 RCC lines, timed out). Blank = no goal; a goal that was cleared is sent as null.

export type DsgLineType = "auto" | "auto_sub" | "manual" | "rcc";
export interface DsgGoalChange { lineType: DsgLineType; lineId: number; clubId: number; goalValue: number | null }

interface Line { lineType: DsgLineType; lineId: number; answerType: string; clubGoals?: Record<string, number | null> }

/** typed[`${lineType}:${lineId}`][clubId] = what the DG typed ("" = blank). Number lines only. */
export function changedDsgGoals(lines: Line[], clubIds: number[], typed: Record<string, Record<number, string>>): DsgGoalChange[] {
  const out: DsgGoalChange[] = [];
  for (const l of lines) {
    if (l.answerType !== "number") continue;
    for (const clubId of clubIds) {
      const v = typed[`${l.lineType}:${l.lineId}`]?.[clubId] ?? "";
      const was = l.clubGoals?.[clubId];
      const before = was == null ? "" : String(Number(was));
      const now = v === "" ? "" : String(Number(v));
      if (before !== now) out.push({ lineType: l.lineType, lineId: l.lineId, clubId, goalValue: v === "" ? null : Number(v) });
    }
  }
  return out;
}
