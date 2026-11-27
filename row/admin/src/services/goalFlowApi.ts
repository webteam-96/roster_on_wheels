// New goal flow (RIZones 2026-11-17..23, ported 2026-11-27): District Set Goals (DG -> clubs), RCC Set Points and
// Disha Goals (off in ROW). Kept out of services/api.ts on purpose.
import { apiClient as api } from "./api";
export { apiClient } from "./api";

// ── District Set Goals (DG -> clubs) ──
export interface GoalFlowLine {
  lineType: "auto" | "auto_sub" | "manual" | "rcc"; lineId: number; categoryName: string; title: string;
  source: "auto" | "manual" | "risao" | "rcc";
  // RCC lines (user 2026-11-23): the 26 Rotary.org goals - RCC goal + Achieved from Rotary.org, the DG sets the
  // District Set Goal; no % and no points.
  isRcc?: boolean; rccGoal?: number | null; clubRccGoals?: Record<string, number | null>; answerType: "number" | "yesno" | "choose_one" | "text";
  options: { id: number; optionText: string; optionPoints?: number }[]; goalValue: number | null; risaoKey: string | null;
  clubGoals: Record<string, number | null>;   // district view: each club's goal (user 2026-11-17)
  clubsAnswered: number; clubsReached: number; answerValue: string | null; achievementPct: number | null;
  // District Awards points (user 2026-11-18)
  points?: number; isBonus?: boolean; bonusPoints?: number; minBonus?: number; maxBonus?: number; pointsEarned?: number; perUnit?: number;
}
export async function getDistrictSetGoals(districtId: number, yearId?: number | null): Promise<{
  yearId: number; clubCount: number; canEdit: boolean; risaoAsOn: string | null; lines: GoalFlowLine[];
  clubs: { id: number; name: string }[]; clubAnswers: Record<string, Record<string, string | null>>;
  clubPoints?: Record<string, Record<string, number>>;   // line -> club -> District Awards points (Overview)
}> {
  const r = await api.get(`/api/goal-flow/district-set-goals/district/${districtId}`, { params: yearId ? { yearId } : {} });
  return r.data;
}
export async function saveDistrictSetGoals(districtId: number, yearId: number,
  goals: { lineType: string; lineId: number; clubId: number; goalValue: number | null }[],
  links: { lineId: number; risaoKey: string | null }[]) {
  const r = await api.put(`/api/goal-flow/district-set-goals/district/${districtId}`, { yearId, goals, links });
  return r.data;
}
export async function getClubSetGoals(clubId: number, yearId?: number | null): Promise<{ yearId: number; districtId: number; clubName?: string; canAnswer: boolean; canSetGoals?: boolean; locks?: string[]; awardsEnabled: boolean; risaoAsOn: string | null; lines: GoalFlowLine[] }> {
  const r = await api.get(`/api/goal-flow/district-set-goals/club/${clubId}`, { params: yearId ? { yearId } : {} });
  return r.data;
}
export async function saveClubSetGoalAnswers(clubId: number, answers: { lineId: number; answerValue: string | null }[]) {
  const r = await api.post(`/api/goal-flow/district-set-goals/club/${clubId}/answers`, answers);
  return r.data;
}
// RISAO-linked questions (user 2026-11-17): answered from the RISAO monthly import.
export interface RisaoSource { key: string; label: string; club: boolean; district: boolean }
export async function getRisaoSources(): Promise<RisaoSource[]> {
  const r = await api.get(`/api/goal-flow/risao-sources`);
  return r.data;
}
export async function syncDistrictSetGoalsRisao(districtId: number, yearId?: number | null) {
  const r = await api.post(`/api/goal-flow/district-set-goals/district/${districtId}/sync-risao`, null, { params: yearId ? { yearId } : {}, timeout: 120000 });
  return r.data;
}
export interface GoalRankRow { rank: number; goals: number; reached: number; score: number | null }
export async function getDistrictSetGoalClubs(districtId: number, yearId?: number | null): Promise<{ yearId: number; clubs: (GoalRankRow & { clubId: number; clubName: string; points: number; totalGoal?: number; totalAchieved?: number })[] }> {
  const r = await api.get(`/api/goal-flow/district-set-goals/district/${districtId}/clubs`, { params: yearId ? { yearId } : {} });
  return r.data;
}
// District Set Goals - Lock / Unlock (DG / SA) + the Club Admin's own goals (user 2026-11-19, same as Disha).
export async function getDsgLocks(districtId: number, yearId?: number | null): Promise<{ yearId: number; canLock: boolean; clubs: Record<number, string[]> }> {
  return (await api.get(`/api/goal-flow/district-set-goals/district/${districtId}/locks`, { params: yearId ? { yearId } : {} })).data;
}
export async function setDsgLocks(districtId: number, body: { yearId: number; clubIds?: number[] | null; sections?: string[] | null; locked: boolean }): Promise<{ message: string }> {
  return (await api.post(`/api/goal-flow/district-set-goals/district/${districtId}/locks`, body)).data;
}
export async function saveClubSetGoalsGoals(clubId: number, yearId: number, goals: { lineType: string; lineId: number; clubId: number; goalValue: number | null }[]): Promise<{ message: string; saved: number; skipped: number }> {
  return (await api.put(`/api/goal-flow/district-set-goals/club/${clubId}/goals`, { yearId, goals })).data;
}


// ── Rotary.org sync per Rotary year + cancel (RIZones 2026-11-20/23) ──
// Same endpoints as services/api.ts getRotaryOrgSyncStatus / startRotaryOrgSync, plus the year and cancel fields.
import type { RotaryOrgSyncStatus } from "./api";
export type RotaryOrgSyncYearStatus = Omit<RotaryOrgSyncStatus, "current" | "last"> & {
  current?: (Omit<NonNullable<RotaryOrgSyncStatus["current"]>, "status"> & { status: "QUEUED" | "RUNNING" | "CANCELLING"; cancelling?: boolean; canCancel?: boolean }) | null;
  last?: (Omit<NonNullable<RotaryOrgSyncStatus["last"]>, "status"> & { status: "DONE" | "FAILED" | "LOGIN_FAILED" | "CANCELLED" }) | null;
};
export async function getRotaryOrgSyncStatusForYear(districtId: number, clubId?: number, yearId?: number | null): Promise<RotaryOrgSyncYearStatus> {
  return (await api.get("/api/goal-setting-rotary/sync/status", { params: { districtId, clubId: clubId || 0, yearId: yearId || 0 } })).data;
}
export async function startRotaryOrgSyncForYear(body: { districtId: number; clubId?: number; email?: string; password?: string; savePassword?: boolean; allowNightly?: boolean; yearId?: number }): Promise<{ requestId: number; alreadyRunning: boolean }> {
  return (await api.post("/api/goal-setting-rotary/sync/start", body)).data;
}
// The person who started it, or the Super Admin.
export async function cancelRotaryOrgSync(districtId: number, clubId?: number) {
  return (await api.post("/api/goal-setting-rotary/sync/cancel", { districtId, clubId: clubId || 0 })).data;
}

// ── RCC Goals pages (RIZones 2026-11-18): the Rotary.org goals report with only the 26 goals (rccOnly) ──
export async function downloadRotaryDistrictReport(districtIds: number[], yearId: number | null | undefined, oversight: boolean, rccOnly = false): Promise<Blob> {
  return (await api.get(`/api/goal-setting-rotary/report/districts`, {
    params: { districtIds: districtIds.join(","), ...(yearId ? { yearId } : {}), oversight, ...(rccOnly ? { rccOnly } : {}) }, responseType: "blob", timeout: 300000 })).data;
}
export async function downloadRotaryAllClubsReport(districtId: number, yearId: number | null | undefined, oversight = false, rccOnly = false): Promise<Blob> {
  return (await api.get(`/api/goal-setting-rotary/report/clubs-all`, {
    params: { districtId, ...(yearId ? { yearId } : {}), oversight, ...(rccOnly ? { rccOnly } : {}) }, responseType: "blob", timeout: 600000 })).data;
}
export async function downloadRotaryClubReport(clubId: number, yearId: number | null | undefined, rccOnly = false): Promise<Blob> {
  return (await api.get(`/api/goal-setting-rotary/report/clubs/${clubId}`, { params: { ...(yearId ? { yearId } : {}), ...(rccOnly ? { rccOnly } : {}) }, responseType: "blob", timeout: 300000 })).data;
}

export interface GoalClubSummaryDto {
  clubId: number;
  clubName: string;
  hasAnyGoalSet: boolean;
  lastUpdatedDate: string | null;
  lastUpdatedBy: string | null;
  isLocked: boolean;
}
export async function getDistrictClubsGoalList(categoryId: number, yearId?: number | null, districtId?: number | null): Promise<GoalClubSummaryDto[]> {
  const params: Record<string, unknown> = {};
  if (yearId != null) params.yearId = yearId;
  if (districtId != null) params.districtId = districtId;
  return (await api.get(`/api/goal-setting/districts/${categoryId}/clubs`, { params })).data;
}

// ── Disha Goals only (off in ROW) ──
// District Awards area-of-focus categories for the Disha Auto sub-items (same endpoints RIZones calls).
export async function getCitationAofCategories(areaOfFocusId?: number) {
  return (await api.get("/api/district-modules/citation/categories", { params: { areaOfFocusId } })).data;
}
export async function getCitationSubCategories(categoryId?: number) {
  return (await api.get("/api/district-modules/citation/sub-categories", { params: { categoryId } })).data;
}
// ROW has no Goal Setting roles (no RI Director / Zone Co-ordinator / District Assistant), so nobody holds an
// assignment and the role message board stays empty.
export interface GoalMyAssignmentDto { roleType: string; zoneIds: number[]; districtIds: number[]; categoryIds: number[] }
export async function getMyGoalAssignments(): Promise<GoalMyAssignmentDto[]> { return []; }
export async function markGoalMessagesSeen(_zoneId: number, _yearId: number): Promise<void> { /* no goal-role board in ROW */ }
