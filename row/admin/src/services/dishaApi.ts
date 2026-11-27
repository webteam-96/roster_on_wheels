// Disha Goals = District Awards one level up (user 2026-11-17). Same function names / shapes as the District Awards
// calls in services/api.ts, so DishaAwardsModule (a copy of DistrictAwardsModule) works unchanged. The first
// "districtId" argument is ignored: Disha questions belong to the signed-in RI Director / Super Admin.
import { getCitationActivities as baseActivities } from "@/services/api";
import { apiClient as api } from "@/services/goalFlowApi";

/* eslint-disable @typescript-eslint/no-unused-vars */
export async function getCitationCategoriesByDistrict(_d: number, yearId?: number) {
  return (await api.get(`/api/disha-awards/categories`, { params: { yearId } })).data;
}
export async function createCitationCategory(_d: number, dto: any) { return (await api.post(`/api/disha-awards/categories`, dto)).data; }
export async function updateCitationCategory(_d: number, id: number, dto: any) { return (await api.put(`/api/disha-awards/categories/${id}`, dto)).data; }
export async function deleteCitationCategory(_d: number, id: number) { await api.delete(`/api/disha-awards/categories/${id}`); }

export async function getCitationAutoQuestions(_d: number, yearId?: number) {
  return (await api.get(`/api/disha-awards/auto-questions`, { params: { yearId } })).data;
}
export async function createCitationAutoQuestion(_d: number, dto: any) { return (await api.post(`/api/disha-awards/auto-questions`, dto)).data; }
export async function updateCitationAutoQuestion(_d: number, id: number, dto: any) { return (await api.put(`/api/disha-awards/auto-questions/${id}`, dto)).data; }
export async function deleteCitationAutoQuestion(_d: number, id: number) { await api.delete(`/api/disha-awards/auto-questions/${id}`); }

export async function getCitationManualCriteria(_d: number, yearId?: number) {
  return (await api.get(`/api/disha-awards/manual-criteria`, { params: { yearId } })).data;
}
export async function createCitationManualCriteria(_d: number, dto: any) { return (await api.post(`/api/disha-awards/manual-criteria`, dto)).data; }
export async function updateCitationManualCriteria(_d: number, id: number, dto: any) { return (await api.put(`/api/disha-awards/manual-criteria/${id}`, dto)).data; }
export async function deleteCitationManualCriteria(_d: number, id: number) { await api.delete(`/api/disha-awards/manual-criteria/${id}`); }

// The Auto list = the District Awards activities (incl. "RISAO - ...").
export const getCitationActivities = baseActivities;

// ── Ranking / goals / district answers ──
export interface DishaZone { id: number; name: string }
export interface DishaDistrictRank { rank: number; districtId: number; districtNumber: string; zoneId: number; zoneName: string; points: number; goals: number; reached: number; score: number | null }
export async function getDishaAwardsDistricts(yearId?: number | null, zoneId?: number | null): Promise<{ yearId: number; zones: DishaZone[]; districts: DishaDistrictRank[]; canManage?: boolean }> {
  return (await api.get(`/api/disha-awards/districts`, { params: { yearId: yearId || undefined, zoneId: zoneId || undefined } })).data;
}
export interface DishaGoalLine { key: string; lineType: string; lineId: number; categoryName: string; title: string; source: string; isRisao: boolean; answerType: string; options: any[]; linked?: boolean; youth?: boolean }
export async function getDishaAwardsGoals(yearId?: number | null, zoneId?: number | null): Promise<{
  yearId: number; districts: { id: number; districtNumber: string; zoneId: number; zoneName: string }[]; lines: DishaGoalLine[];
  goals: Record<string, Record<string, number | null>>; answers: Record<string, Record<string, string | null>>;
  baselines?: Record<string, Record<string, number | null>>;   // Goal Setting boxes: "as on 1 July" per district
}> {
  return (await api.get(`/api/disha-awards/goals`, { params: { yearId: yearId || undefined, zoneId: zoneId || undefined } })).data;
}
export async function saveDishaAwardsGoals(yearId: number, goals: { lineType: string; lineId: number; districtId: number; goalValue: number | null }[]) {
  return (await api.put(`/api/disha-awards/goals`, { yearId, goals })).data;
}
export async function refreshDishaAwardsAll(yearId?: number | null, zoneId?: number | null) {
  return (await api.post(`/api/disha-awards/refresh-auto`, null, { params: { yearId: yearId || undefined, zoneId: zoneId || undefined }, timeout: 600000 })).data;
}
export interface DishaDistrictLine {
  lineType: string; lineId: number; questionId: number; categoryName: string; title: string; source: string; isRisao: boolean;
  answerType: string; options: { id: number; optionText: string; optionPoints: number }[]; points: number;
  isBonus: boolean; bonusPoints: number; minBonus: number; maxBonus: number; perUnit?: number;
  goalValue: number | null; answerValue: string | null; pointsEarned: number; achievementPct: number | null;
}
export async function getDishaAwardsDistrict(districtId: number, yearId?: number | null): Promise<{ yearId: number; canAnswer: boolean; risaoAsOn: string | null; totalPoints: number; lines: DishaDistrictLine[] }> {
  return (await api.get(`/api/disha-awards/district/${districtId}`, { params: { yearId: yearId || undefined } })).data;
}
export async function saveDishaAwardsAnswers(districtId: number, answers: { subCriteriaId: number; answerValue: string | null }[]) {
  return (await api.post(`/api/disha-awards/district/${districtId}/answers`, answers)).data;
}
export async function refreshDishaAwardsDistrict(districtId: number, yearId?: number | null) {
  return (await api.post(`/api/disha-awards/district/${districtId}/refresh-auto`, null, { params: { yearId: yearId || undefined }, timeout: 300000 })).data;
}

// ── District Awards-only features the copied screen calls - not used by Disha (no switch, no clear, no description) ──
export async function getCitationAvailableYears(_d: number) { return []; }
export async function getDistrictAwardsConfig(_d: number, _y: number) { return { isEnabled: true }; }
export async function setDistrictAwardsConfig(_d: number, _y: number, _e: boolean) { return { isEnabled: true }; }
export async function getAwardsClearStatus(_d: number, _y: number): Promise<any> { return null; }
export async function clearAwardsPoints(_d: number, _y: number): Promise<any> { return { message: "" }; }
export async function restoreAwardsPoints(_d: number, _y: number): Promise<any> { return { message: "" }; }
export async function getCitationDescription(_d: number, _y: number) { return { descriptionHtml: "" }; }
export async function saveCitationDescription(_d: number, _dto: any) { return {}; }
export async function getCitationClubPoints(_d: number, _y: number) { return []; }
export async function downloadCitationClubReport(..._a: any[]): Promise<any> { return null; }
export async function downloadCitationSingleClubReport(..._a: any[]): Promise<any> { return null; }
export type AwardsClearStatus = any;

// ── Reports (user 2026-11-18): real .xlsx ──
export async function downloadDishaAllReport(yearId?: number | null, zoneId?: number | null): Promise<Blob> {
  return (await api.get(`/api/disha-awards/report`, { params: { yearId: yearId || undefined, zoneId: zoneId || undefined }, responseType: "blob", timeout: 600000 })).data;
}
export async function downloadDishaDistrictReport(districtId: number, yearId?: number | null): Promise<Blob> {
  return (await api.get(`/api/disha-awards/district/${districtId}/report`, { params: { yearId: yearId || undefined }, responseType: "blob", timeout: 300000 })).data;
}
export async function downloadDistrictSetGoalsAllClubsReport(districtId: number, yearId?: number | null): Promise<Blob> {
  return (await api.get(`/api/goal-flow/district-set-goals/district/${districtId}/report`, { params: { yearId: yearId || undefined }, responseType: "blob", timeout: 600000 })).data;
}
export async function downloadClubSetGoalsReport(clubId: number, yearId?: number | null): Promise<Blob> {
  return (await api.get(`/api/goal-flow/district-set-goals/club/${clubId}/report`, { params: { yearId: yearId || undefined }, responseType: "blob", timeout: 300000 })).data;
}

// Month-wise (user 2026-11-18, option A): Auto lines by month (RISAO from the monthly import); Manual = yearly only.
export interface MonthlyLine {
  lineType: string; lineId: number; categoryName: string; title: string; source: string; isRisao: boolean;
  answerType: string; goalValue: number | null; answerValue: string | null; monthly: Record<string, number> | null;
  baseline?: number | null; youth?: boolean;   // Goal Setting box: Achieved = 1 July + the months
  isRcc?: boolean; rccGoal?: number | null;     // District Set Goals RCC line (user 2026-11-23)
}
export async function getDishaAwardsDistrictMonthly(districtId: number, yearId?: number | null): Promise<{ yearId: number; months: number[]; risaoAsOn: string | null; lines: MonthlyLine[] }> {
  return (await api.get(`/api/disha-awards/district/${districtId}/monthly`, { params: { yearId: yearId || undefined }, timeout: 300000 })).data;
}
// District Set Goals - the district's month-wise (all clubs added up; user 2026-11-19, RCC design).
export async function getDistrictSetGoalsMonthly(districtId: number, yearId?: number | null): Promise<{ yearId: number; months: number[]; risaoAsOn: string | null; lines: MonthlyLine[] }> {
  return (await api.get(`/api/goal-flow/district-set-goals/district/${districtId}/monthly`, { params: { yearId: yearId || undefined }, timeout: 300000 })).data;
}
export async function getClubSetGoalsMonthly(clubId: number, yearId?: number | null): Promise<{ yearId: number; months: number[]; risaoAsOn: string | null; lines: MonthlyLine[] }> {
  return (await api.get(`/api/goal-flow/district-set-goals/club/${clubId}/monthly`, { params: { yearId: yearId || undefined }, timeout: 300000 })).data;
}

// ── Overview tab (user 2026-11-18): every district as cards, like the Goal Setting overview ──
export interface DishaOverviewCell { goal: number | null; achieved: string | null; pct: number | null; points: number; baseline?: number | null }
export interface DishaOverviewLine { key: string; categoryName: string; title: string; source: string; isRisao: boolean; answerType: string; baseKey?: string | null }
export interface DishaOverviewDistrict { rank: number; districtId: number; districtNumber: string; zoneId: number; zoneName: string; points: number; cells: Record<string, DishaOverviewCell> }
export async function getDishaOverview(yearId?: number | null, zoneId?: number | null): Promise<{
  yearId: number; risaoAsOn: string | null; lines: DishaOverviewLine[]; totals: Record<string, DishaOverviewCell>; districts: DishaOverviewDistrict[];
}> {
  return (await api.get(`/api/disha-awards/overview`, { params: { yearId: yearId || undefined, zoneId: zoneId || undefined }, timeout: 300000 })).data;
}

// ── Disha goals by RI Director / SA / DG + Lock / Unlock (user 2026-11-18, like Goal Overview) ──
export interface DishaGoalState { locks: string[]; rccGoals: Record<string, number | null> }
export async function getDishaGoalState(yearId?: number | null, zoneId?: number | null): Promise<{ yearId: number; canManage: boolean; districts: Record<number, DishaGoalState> }> {
  return (await api.get(`/api/disha-awards/goal-state`, { params: { yearId: yearId || undefined, zoneId: zoneId || undefined } })).data;
}
export async function getDishaDistrictGoalState(districtId: number, yearId?: number | null): Promise<DishaGoalState & { yearId: number; canManage: boolean; canSetGoals: boolean }> {
  return (await api.get(`/api/disha-awards/district/${districtId}/goal-state`, { params: { yearId: yearId || undefined } })).data;
}
export async function saveDishaDistrictGoals(districtId: number, body: {
  yearId: number; questionGoals: { lineType: string; lineId: number; districtId: number; goalValue: number | null }[]; rccGoals: { fieldKey: string; goalValue: number | null }[];
}): Promise<{ message: string; saved: number; skipped: number }> {
  return (await api.put(`/api/disha-awards/district/${districtId}/goals`, body)).data;
}
export async function setDishaLocks(body: { yearId: number; districtIds?: number[] | null; zoneId?: number | null; sections?: string[] | null; locked: boolean }): Promise<{ message: string }> {
  return (await api.post(`/api/disha-awards/locks`, body)).data;
}
export async function saveDishaRccGoals(yearId: number, goals: { districtId: number; fieldKey: string; goalValue: number | null }[]) {
  return (await api.put(`/api/disha-awards/rcc-goals`, { yearId, goals })).data;
}
// DG (user 2026-11-18): the Overview of their own district.
export async function getDishaDistrictOverview(districtId: number, yearId?: number | null): Promise<Awaited<ReturnType<typeof getDishaOverview>>> {
  return (await api.get(`/api/disha-awards/district/${districtId}/overview`, { params: { yearId: yearId || undefined }, timeout: 300000 })).data;
}

// ── Report with the Goal Setting boxes (user 2026-11-19, option A: same report, extra rows) ──
export interface DishaFullReportItem {
  kind: "line" | "box"; key?: string; category: string; title: string; twoDecimals?: boolean; number?: boolean;
  cells?: Record<number, { goal: number | null; achieved: string | null; pct: number | null; baseline?: number | null; monthly?: Record<number, number> | null }>;
}
export async function downloadDishaFullReport(body: { yearId: number; zoneId?: number | null; items: DishaFullReportItem[] }): Promise<Blob> {
  return (await api.post(`/api/disha-awards/report-full`, body, { responseType: "blob", timeout: 600000 })).data;
}
export async function downloadDishaClubsReport(districtId: number, body: { yearId: number; clubs: { id: number; name: string }[]; items: DishaFullReportItem[] }): Promise<Blob> {
  return (await api.post(`/api/disha-awards/district/${districtId}/clubs-report`, body, { responseType: "blob", timeout: 600000 })).data;
}
export async function downloadDishaDistrictFullReport(districtId: number, body: { yearId: number; items: DishaFullReportItem[]; showPoints?: boolean }): Promise<Blob> {
  return (await api.post(`/api/disha-awards/district/${districtId}/report-full`, body, { responseType: "blob", timeout: 300000 })).data;
}
