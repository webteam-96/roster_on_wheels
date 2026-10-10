import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res, UploadedFile, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { AnyFilesInterceptor, FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { Authorize, User, ReadsRequestForm } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, file, forbid, notFound, ok, statusCode, type ActionResult } from "../../common/results";
import { bodyField, queryInt, queryString, requireQuery, routeInt, requireFile } from "../../common/binding";
import { InvalidOperationException, UnauthorizedAccessException } from "../../common/exceptions";
import { Brand } from "../../brand/brand";
import { formatDate, nowIn } from "../../common/dotnet-format";
import { XLSX_CONTENT_TYPE } from "../../services/xlsx";
import { GoalSettingService } from "./goal-setting.service";
import type {
  AddGoalRoleHolderRequest, ChangeGoalRoleAssignmentRequest, CreateGoalDesignationRequest, CreateGoalRoleAssignmentRequest, GoalBulkLockRequest,
  SaveGoalEntriesRequest, SaveGoalMonthlyRequest, SaveGoalTargetSplitRequest,
} from "./goal-setting.dtos";

type Upload = { fieldname: string; originalname: string; buffer: Buffer; size: number };

// ── Request binding (case-insensitive, C# defaults) ──────────────────────────────────────────
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const int = (v: unknown, d = 0) => Math.trunc(num(v) ?? d);
const intOrNull = (v: unknown) => (num(v) === null ? null : Math.trunc(num(v)!));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean | null => (v === null || v === undefined ? null : typeof v === "boolean" ? v : String(v).toLowerCase() === "true" || v === 1);
const list = (body: unknown, name: string): Record<string, unknown>[] => {
  const v = bodyField(body, name);
  return Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [];
};
const intList = (body: unknown, name: string): number[] | null => {
  const v = bodyField(body, name);
  return Array.isArray(v) ? v.map((x) => Math.trunc(Number(x))).filter(Number.isFinite) : null;
};
const f = bodyField;
export const bindEntries = (b: unknown): SaveGoalEntriesRequest => ({
  yearId: int(f(b, "yearId")),
  entries: list(b, "entries").map((e) => ({ fieldId: int(f(e, "fieldId")), numericValue: num(f(e, "numericValue")), textValue: str(f(e, "textValue")), boolValue: bool(f(e, "boolValue")) })),
});
export const bindMonthly = (b: unknown): SaveGoalMonthlyRequest => ({
  yearId: int(f(b, "yearId")), month: int(f(b, "month")),
  entries: list(b, "entries").map((e) => ({ fieldId: int(f(e, "fieldId")), numericValue: num(f(e, "numericValue")) })),
});
export const bindSplit = (b: unknown): SaveGoalTargetSplitRequest => ({
  yearId: int(f(b, "yearId")), period: str(f(b, "period")) ?? "month",
  fields: list(b, "fields").map((x) => {
    const raw = f(x, "values");
    const values: Record<number, number | null> = {};
    if (raw && typeof raw === "object") for (const [k, v] of Object.entries(raw as Record<string, unknown>)) values[Math.trunc(Number(k))] = num(v);
    return { fieldId: int(f(x, "fieldId")), values };
  }),
});
export const bindCreateRole = (b: unknown): CreateGoalRoleAssignmentRequest => ({
  memberId: int(f(b, "memberId")), memberNameText: str(f(b, "memberNameText")), roleType: str(f(b, "roleType")) ?? "", assignmentName: str(f(b, "assignmentName")) ?? "",
  categoryId: intOrNull(f(b, "categoryId")), zoneId: intOrNull(f(b, "zoneId")), districtIds: intList(b, "districtIds"), zoneIds: intList(b, "zoneIds"),
  roleTitle: str(f(b, "roleTitle")), avenue: str(f(b, "avenue")), homeDistrictId: intOrNull(f(b, "homeDistrictId")), dgYear: str(f(b, "dgYear")), supportingText: str(f(b, "supportingText")),
});
const bindHolder = (b: unknown): AddGoalRoleHolderRequest => ({ memberId: int(f(b, "memberId")), memberNameText: str(f(b, "memberNameText")) });
const bindChange = (b: unknown): ChangeGoalRoleAssignmentRequest => ({ memberId: int(f(b, "memberId")), memberNameText: str(f(b, "memberNameText")), zoneIds: intList(b, "zoneIds"), zoneId: intOrNull(f(b, "zoneId")), districtIds: intList(b, "districtIds") });
export const bindDesignation = (b: unknown): CreateGoalDesignationRequest => ({ title: str(f(b, "title")) ?? "", avenue: str(f(b, "avenue")) ?? "", roleType: str(f(b, "roleType")) ?? "", defaultCategoryName: str(f(b, "defaultCategoryName")) });
export const bindBulkLock = (b: unknown): GoalBulkLockRequest => ({ yearId: int(f(b, "yearId")), categoryIds: intList(b, "categoryIds"), zoneIds: intList(b, "zoneIds"), locked: bool(f(b, "locked")) ?? false });
export const commentText = (b: unknown) => str(f(b, "commentText")) ?? "";

/** The C# actions' try/catch: Unauthorized → 403 { message }, InvalidOperation → 400 { message }. */
export async function guarded(work: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof UnauthorizedAccessException) return statusCode(403, { message: e.message });
    if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
    throw e;
  }
}
/** Imports also answer any read failure with 400 "Failed to read the Excel file: …". */
async function importGuard(work: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await guarded(work);
  } catch (e) {
    return badRequest({ message: `Failed to read the Excel file: ${(e as Error).message}` });
  }
}
const stamp = (fmt: string) => formatDate(nowIn(Brand.Current.locale.defaultTimeZone), fmt);
const xlsx = (bytes: Buffer | null, name: () => string, missing = "No data.") => (bytes ? file(bytes, XLSX_CONTENT_TYPE, name()) : notFound({ message: missing }));

/** Port of GoalSettingController.cs: api/goal-setting. */
@Controller("api/goal-setting")
@Authorize()
export class GoalSettingController {
  constructor(private readonly svc: GoalSettingService) {}

  private memberId = (u: CurrentUser) => { const v = u.findFirst("memberId") ?? u.findFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier") ?? ""; return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0; };
  private roles = (u: CurrentUser) => u.findFirst("roles") ?? "";
  private isAuthorisedRole = (u: CurrentUser) => this.roles(u).includes("Admin") || this.roles(u).includes("SuperAdmin");
  private isSuperAdmin = (u: CurrentUser) => this.roles(u).includes("SuperAdmin");
  private isZoneAuthorisedRole = (u: CurrentUser) => this.roles(u).includes("ZonalCoordinator") || this.roles(u).includes("SuperAdmin");

  /** "View as": only a SuperAdmin holding the goal oversight flag may act as another member. */
  private async effective(u: CurrentUser, asMemberId: string | undefined) {
    const me = this.memberId(u);
    const as = queryInt(asMemberId);
    if (as !== null && as > 0 && this.isSuperAdmin(u) && (await this.svc.isGoalObserver(me))) return as;
    return me;
  }

  @Get("observer/role-list")
  async observerRoleList(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.svc.getObserverRoleList(this.memberId(u)));
  }

  @Get("categories")
  async categories(@User() u: CurrentUser, @Query("asMemberId") as?: string) {
    return ok(await this.svc.getCategoriesFor(await this.effective(u, as)));
  }

  @Get("oversight-categories")
  async oversightCategories(@User() u: CurrentUser, @Query("asMemberId") as?: string) {
    return ok(await this.svc.getOversightCategories(await this.effective(u, as)));
  }

  // ── Target split ─────────────────────────────────────────────────────────
  @Post("targets/split/districts/:categoryId")
  saveDistrictTargetSplit(@User() u: CurrentUser, @Param("categoryId") c: string, @Body() body: unknown, @Query("districtId") d?: string) {
    const [categoryId, req, districtId] = [routeInt(c), bindSplit(body), queryInt(d)];
    return guarded(async () => ok(await this.svc.saveDistrictTargetSplit(this.memberId(u), categoryId, req, districtId)));
  }

  @Post("targets/split/clubs/:categoryId")
  saveClubTargetSplit(@User() u: CurrentUser, @Param("categoryId") c: string, @Body() body: unknown, @Query("clubId") cl?: string) {
    const [categoryId, req, clubId] = [routeInt(c), bindSplit(body), queryInt(cl)];
    return guarded(async () => ok(await this.svc.saveClubTargetSplit(this.memberId(u), categoryId, req, clubId)));
  }

  // ── Club goal entry ──────────────────────────────────────────────────────
  @Get("clubs/:categoryId")
  getClubGoalForm(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("clubId") cl?: string) {
    const [categoryId, yearId, clubId] = [routeInt(c), queryInt(y), queryInt(cl)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => {
      const r = await this.svc.getClubGoalForm(this.memberId(u), categoryId, yearId, clubId);
      return r ? ok(r) : notFound({ message: "No club admin assignment found." });
    });
  }

  @Post("clubs/:categoryId")
  saveClubGoalForm(@User() u: CurrentUser, @Param("categoryId") c: string, @Body() body: unknown, @Query("clubId") cl?: string) {
    const [categoryId, req, clubId] = [routeInt(c), bindEntries(body), queryInt(cl)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => ok(await this.svc.saveClubGoalForm(this.memberId(u), categoryId, req, clubId)));
  }

  @Get("monthly/clubs/:categoryId")
  getClubMonthly(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("clubId") cl?: string) {
    const [categoryId, yearId, clubId] = [routeInt(c), queryInt(y), queryInt(cl)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => {
      const r = await this.svc.getClubMonthlyGoalForm(this.memberId(u), categoryId, yearId, clubId);
      return r ? ok(r) : notFound({ message: "No club admin assignment found." });
    });
  }

  @Post("monthly/clubs/:categoryId")
  saveClubMonthly(@User() u: CurrentUser, @Param("categoryId") c: string, @Body() body: unknown, @Query("clubId") cl?: string) {
    const [categoryId, req, clubId] = [routeInt(c), bindMonthly(body), queryInt(cl)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => ok(await this.svc.saveClubMonthlyGoals(this.memberId(u), categoryId, req, clubId)));
  }

  // ── Excel downloads ──────────────────────────────────────────────────────
  @Get("goals-excel/districts")
  async districtGoalsExcel(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [yearId, districtId] = [queryInt(y), queryInt(d)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return xlsx(await this.svc.buildDistrictMonthlyExcel(this.memberId(u), 0, yearId, districtId), () => `district-goal-report-${stamp("yyyyMMdd-HHmm")}.xlsx`);
  }

  @Get("goals-excel/clubs")
  async clubGoalsExcel(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") cl?: string) {
    const [yearId, clubId] = [queryInt(y), queryInt(cl)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return xlsx(await this.svc.buildClubMonthlyExcel(this.memberId(u), 0, yearId, clubId), () => `club-goal-report-${stamp("yyyyMMdd-HHmm")}.xlsx`);
  }

  @Get("goals-excel/clubs-all/oversight")
  scopedAllClubsGoalsExcel(@User() u: CurrentUser, @Query("districtId") d?: string, @Query("yearId") y?: string, @Query("asMemberId") as?: string) {
    const [districtId, yearId] = [queryInt(d, 0), queryInt(y)];
    return guarded(async () => xlsx(await this.svc.buildAllClubsMonthlyExcelScoped(await this.effective(u, as), yearId, districtId), () => `Club_Goal_Setting_D${districtId}_${stamp("yyyyMMdd-HHmm")}.xlsx`, "No club goal data for this district."));
  }

  @Get("goals-excel/clubs-all")
  async allClubsGoalsExcel(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [yearId, districtId] = [queryInt(y), queryInt(d)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return xlsx(await this.svc.buildAllClubsMonthlyExcel(this.memberId(u), yearId, districtId), () => `all-clubs-goal-report-${stamp("yyyyMMdd-HHmm")}.xlsx`);
  }

  @Get("monthly/districts/:categoryId/excel")
  async districtMonthlyExcel(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [categoryId, yearId, districtId] = [routeInt(c), queryInt(y), queryInt(d)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return xlsx(await this.svc.buildDistrictMonthlyExcel(this.memberId(u), categoryId, yearId, districtId), () => `goals-monthly-district-${stamp("yyyyMMdd-HHmm")}.xlsx`);
  }

  @Get("monthly/clubs/:categoryId/excel")
  async clubMonthlyExcel(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("clubId") cl?: string) {
    const [categoryId, yearId, clubId] = [routeInt(c), queryInt(y), queryInt(cl)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return xlsx(await this.svc.buildClubMonthlyExcel(this.memberId(u), categoryId, yearId, clubId), () => `goals-monthly-club-${stamp("yyyyMMdd-HHmm")}.xlsx`);
  }

  @Get("monthly/districts/:categoryId/oversight")
  districtMonthlyOversight(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("districtId") d?: string, @Query("yearId") y?: string, @Query("asMemberId") as?: string) {
    const [categoryId, districtId, yearId] = [routeInt(c), queryInt(d, 0), queryInt(y)];
    return guarded(async () => {
      const r = await this.svc.getDistrictMonthlyGoalFormScoped(await this.effective(u, as), categoryId, yearId, districtId);
      return r ? ok(r) : notFound({ message: "No month-wise data for this district." });
    });
  }

  @Get("monthly/districts/:categoryId")
  districtMonthly(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [categoryId, yearId, districtId] = [routeInt(c), queryInt(y), queryInt(d)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => {
      const r = await this.svc.getDistrictMonthlyGoalForm(this.memberId(u), categoryId, yearId, districtId);
      return r ? ok(r) : notFound({ message: "No district admin assignment found." });
    });
  }

  @Post("monthly/districts/:categoryId")
  saveDistrictMonthly(@User() u: CurrentUser, @Param("categoryId") c: string, @Body() body: unknown, @Query("districtId") d?: string) {
    const [categoryId, req, districtId] = [routeInt(c), bindMonthly(body), queryInt(d)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => ok(await this.svc.saveDistrictMonthlyGoals(this.memberId(u), categoryId, req, districtId)));
  }

  // ── District's own goal entry and its clubs ──────────────────────────────
  @Get("districts/:categoryId/clubs-matrix/oversight")
  scopedClubsMatrix(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("districtId") d?: string, @Query("yearId") y?: string, @Query("asMemberId") as?: string) {
    const [categoryId, districtId, yearId] = [routeInt(c), queryInt(d, 0), queryInt(y)];
    return guarded(async () => ok(await this.svc.getScopedDistrictClubsGoalMatrix(await this.effective(u, as), categoryId, yearId, districtId)));
  }

  @Get("districts/:categoryId/clubs-monthly-matrix/oversight")
  scopedClubsMonthlyMatrix(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("districtId") d?: string, @Query("yearId") y?: string, @Query("asMemberId") as?: string) {
    const [categoryId, districtId, yearId] = [routeInt(c), queryInt(d, 0), queryInt(y)];
    return guarded(async () => ok(await this.svc.getScopedDistrictClubsMonthlyMatrix(await this.effective(u, as), categoryId, yearId, districtId)));
  }

  @Get("districts/:categoryId/clubs-matrix")
  clubsMatrix(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [categoryId, yearId, districtId] = [routeInt(c), queryInt(y), queryInt(d)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => ok(await this.svc.getDistrictClubsGoalMatrix(this.memberId(u), categoryId, yearId, districtId)));
  }

  @Get("districts/:categoryId/clubs-monthly-matrix")
  clubsMonthlyMatrix(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [categoryId, yearId, districtId] = [routeInt(c), queryInt(y), queryInt(d)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => ok(await this.svc.getDistrictClubsMonthlyMatrix(this.memberId(u), categoryId, yearId, districtId)));
  }

  @Get("districts/:categoryId/clubs")
  districtClubsList(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [categoryId, yearId, districtId] = [routeInt(c), queryInt(y, 0), queryInt(d)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => ok(await this.svc.getDistrictClubsGoalList(this.memberId(u), categoryId, yearId, districtId)));
  }

  @Post("districts/:categoryId/lock")
  lockDistrict(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    return this.lockDistrictCore(u, c, y, d, true, false);
  }

  @Post("districts/:categoryId/unlock")
  unlockDistrict(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    return this.lockDistrictCore(u, c, y, d, false, false);
  }

  private lockDistrictCore(u: CurrentUser, c: string, y: string | undefined, d: string | undefined, locked: boolean, zone: boolean) {
    const [categoryId, yearId, districtId] = [routeInt(c), queryInt(y, 0), routeOrQuery(d)];
    if (!(zone ? this.isZoneAuthorisedRole(u) : this.isAuthorisedRole(u))) return forbid();
    return guarded(async () => ok(await this.svc.setDistrictLock(this.memberId(u), categoryId, yearId, districtId, locked)));
  }

  @Get("districts/:categoryId")
  getDistrictGoalForm(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [categoryId, yearId, districtId] = [routeInt(c), queryInt(y), queryInt(d)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => {
      const r = await this.svc.getDistrictGoalForm(this.memberId(u), categoryId, yearId, districtId);
      return r ? ok(r) : notFound({ message: "No district admin assignment found." });
    });
  }

  @Post("districts/:categoryId")
  saveDistrictGoalForm(@User() u: CurrentUser, @Param("categoryId") c: string, @Body() body: unknown, @Query("districtId") d?: string) {
    const [categoryId, req, districtId] = [routeInt(c), bindEntries(body), queryInt(d)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => ok(await this.svc.saveDistrictGoalForm(this.memberId(u), categoryId, req, districtId)));
  }

  // ── Zonal Coordinator: districts of my zone ──────────────────────────────
  @Get("zone/districts/:categoryId")
  zoneDistricts(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("zoneId") z?: string) {
    const [categoryId, yearId, zoneId] = [routeInt(c), queryInt(y, 0), queryInt(z)];
    if (!this.isZoneAuthorisedRole(u)) return forbid();
    return guarded(async () => ok(await this.svc.getZoneDistrictsGoalList(this.memberId(u), categoryId, yearId, zoneId)));
  }

  @Get("zone/districts/:categoryId/:districtId")
  zoneDistrictForm(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Query("yearId") y?: string) {
    const [categoryId, districtId, yearId] = [routeInt(c), routeInt(d), queryInt(y)];
    if (!this.isZoneAuthorisedRole(u)) return forbid();
    return guarded(async () => {
      const r = await this.svc.getDistrictGoalForm(this.memberId(u), categoryId, yearId, districtId);
      return r ? ok(r) : notFound({ message: "District goals not found." });
    });
  }

  @Post("zone/districts/:categoryId/:districtId/lock")
  zoneLock(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Query("yearId") y?: string) {
    return this.lockDistrictCore(u, c, y, `route:${d}`, true, true);
  }

  @Post("zone/districts/:categoryId/:districtId/unlock")
  zoneUnlock(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Query("yearId") y?: string) {
    return this.lockDistrictCore(u, c, y, `route:${d}`, false, true);
  }

  @Post("zone/districts/:categoryId/:districtId")
  zoneSaveDistrictForm(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Body() body: unknown) {
    const [categoryId, districtId, req] = [routeInt(c), routeInt(d), bindEntries(body)];
    if (!this.isZoneAuthorisedRole(u)) return forbid();
    return guarded(async () => ok(await this.svc.saveDistrictGoalForm(this.memberId(u), categoryId, req, districtId)));
  }

  // ── Overview matrices ────────────────────────────────────────────────────
  @Get("overview")
  async overview(@User() u: CurrentUser, @Query("zoneId") z?: string, @Query("categoryId") c?: string, @Query("yearId") y?: string) {
    const [zoneId, categoryId, yearId] = [queryInt(z, 0), queryInt(c, 0), queryInt(y)];
    if (!this.isSuperAdmin(u)) return forbid();
    const r = await this.svc.getOverviewMatrix(zoneId, categoryId, yearId);
    return r ? ok(r) : notFound({ message: "Invalid zone or year." });
  }

  @Get("overview-scoped")
  scopedOverview(@User() u: CurrentUser, @Query("zoneId") z?: string, @Query("categoryId") c?: string, @Query("yearId") y?: string) {
    const [zoneId, categoryId, yearId] = [queryInt(z, 0), queryInt(c, 0), queryInt(y)];
    return guarded(async () => {
      const r = await this.svc.getScopedOverviewMatrix(this.memberId(u), zoneId, categoryId, yearId);
      return r ? ok(r) : notFound({ message: "Invalid zone or year." });
    });
  }

  @Get("district-summary-matrix")
  districtSummaryMatrix(@User() u: CurrentUser, @Query("zoneId") z?: string, @Query("yearId") y?: string, @Query("asMemberId") as?: string) {
    const [zoneId, yearId] = [queryInt(z, 0), queryInt(y)];
    return guarded(async () => ok(await this.svc.getScopedDistrictSummaryMatrix(await this.effective(u, as), zoneId, yearId)));
  }

  // ── Club locks ───────────────────────────────────────────────────────────
  @Post("clubs/:categoryId/lock")
  lockClub(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("clubId") cl?: string) {
    return this.lockClubCore(u, c, y, cl, true);
  }

  @Post("clubs/:categoryId/unlock")
  unlockClub(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("clubId") cl?: string) {
    return this.lockClubCore(u, c, y, cl, false);
  }

  private lockClubCore(u: CurrentUser, c: string, y: string | undefined, cl: string | undefined, locked: boolean) {
    const [categoryId, yearId, clubId] = [routeInt(c), queryInt(y, 0), queryInt(cl, 0)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => ok(await this.svc.setClubLock(this.memberId(u), categoryId, yearId, clubId, locked)));
  }

  // ── Oversight roles (SuperAdmin) ─────────────────────────────────────────
  @Get("role-assignments/assigned-zones")
  async assignedZones(@User() u: CurrentUser, @Query("excludeAssignmentId") e?: string) {
    const exclude = queryInt(e);
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.svc.getAssignedDirectorZoneIds(exclude));
  }

  @Get("role-assignments/export")
  async exportRoleAssignments(@User() u: CurrentUser, @Query("zoneId") z?: string) {
    const zoneId = queryInt(z);
    if (!this.isSuperAdmin(u)) return forbid();
    const scope = zoneId !== null && zoneId > 0 ? `Zone${zoneId}` : "AllZones";
    return file(await this.svc.buildRoleAssignmentsExcel(zoneId), XLSX_CONTENT_TYPE, `Goal_Role_Assignments_${scope}_${stamp("yyyyMMdd-HHmm")}.xlsx`);
  }

  @Post("role-assignments/send-emails")
  async sendRoleEmails(@User() u: CurrentUser, @Query("zoneId") z?: string) {
    const zoneId = queryInt(z);
    if (!this.isSuperAdmin(u)) return forbid();
    const count = await this.svc.sendAllRoleAssignmentEmails(this.memberId(u), zoneId);
    return ok({ sent: count, message: count > 0 ? `Role-assigned email sent to ${count} member(s).` : "No members with an email address to notify." });
  }

  @Get("role-assignments")
  async roleAssignments(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.svc.getRoleAssignments());
  }

  @Post("role-assignments")
  createRoleAssignment(@User() u: CurrentUser, @Body() body: unknown) {
    const req = bindCreateRole(body);
    if (!this.isSuperAdmin(u)) return forbid();
    return guarded(async () => ok(await this.svc.createRoleAssignment(this.memberId(u), req)));
  }

  @Delete("role-assignments/:assignmentId")
  async revokeRoleAssignment(@User() u: CurrentUser, @Param("assignmentId") a: string) {
    const assignmentId = routeInt(a);
    if (!this.isSuperAdmin(u)) return forbid();
    await this.svc.revokeRoleAssignment(assignmentId, this.memberId(u));
    return ok({ message: "Assignment revoked." });
  }

  @Post("role-assignments/:assignmentId/add-holder")
  addHolder(@User() u: CurrentUser, @Param("assignmentId") a: string, @Body() body: unknown) {
    const [assignmentId, req] = [routeInt(a), bindHolder(body)];
    if (!this.isSuperAdmin(u)) return forbid();
    return guarded(async () => ok({ id: await this.svc.addRoleAssignmentHolder(assignmentId, req, this.memberId(u)), message: "Holder added." }));
  }

  @Put("role-assignments/:assignmentId")
  changeRoleAssignment(@User() u: CurrentUser, @Param("assignmentId") a: string, @Body() body: unknown) {
    const [assignmentId, req] = [routeInt(a), bindChange(body)];
    if (!this.isSuperAdmin(u)) return forbid();
    return guarded(async () => {
      await this.svc.changeRoleAssignment(assignmentId, req, this.memberId(u));
      return ok({ message: "Assignment updated." });
    });
  }

  @Post("role-assignments/:assignmentId/send-credentials")
  async sendCredentials(@User() u: CurrentUser, @Param("assignmentId") a: string) {
    const assignmentId = routeInt(a);
    if (!this.isSuperAdmin(u)) return forbid();
    const sent = await this.svc.sendCredentialsEmail(assignmentId, this.memberId(u));
    return ok({ sent, message: sent > 0 ? "Credentials email sent." : "No email address on file for this member." });
  }

  @Get("designations")
  async designations() {
    return ok(await this.svc.getDesignations());
  }

  @Post("designations")
  addDesignation(@User() u: CurrentUser, @Body() body: unknown) {
    const req = bindDesignation(body);
    if (!this.isSuperAdmin(u)) return forbid();
    return guarded(async () => ok(await this.svc.addDesignation(req)));
  }

  @Get("zone-members")
  async zoneMembers(@User() u: CurrentUser, @Query("zoneIds") z?: string, @Query("search") s?: string) {
    requireQuery({ zoneIds: z });
    if (!this.isSuperAdmin(u)) return forbid();
    const ids = (queryString(z) ?? "").split(",").map((x) => (/^\s*-?\d+\s*$/.test(x) ? parseInt(x, 10) : 0)).filter((n) => n > 0);
    return ok(await this.svc.searchZoneMembers(ids, queryString(s)));
  }

  @Get("search-members")
  async searchMembers(@User() u: CurrentUser, @Query("search") s?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.svc.searchMembersGlobal(queryString(s)));
  }

  // ── Scoped oversight views ───────────────────────────────────────────────
  @Get("my-assignments")
  async myAssignments(@User() u: CurrentUser, @Query("asMemberId") as?: string) {
    return ok(await this.svc.getMyAssignments(await this.effective(u, as)));
  }

  @Get("scoped/districts/:categoryId/clubs")
  scopedDistrictClubs(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("districtId") d?: string, @Query("asMemberId") as?: string) {
    const [categoryId, yearId, districtId] = [routeInt(c), queryInt(y, 0), queryInt(d, 0)];
    return guarded(async () => ok(await this.svc.getScopedDistrictClubsGoalList(await this.effective(u, as), categoryId, yearId, districtId)));
  }

  @Get("scoped/districts/:categoryId/:districtId")
  scopedDistrictForm(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Query("yearId") y?: string, @Query("asMemberId") as?: string) {
    const [categoryId, districtId, yearId] = [routeInt(c), routeInt(d), queryInt(y, 0)];
    return guarded(async () => ok(await this.svc.getScopedDistrictGoalForm(await this.effective(u, as), categoryId, yearId, districtId)));
  }

  @Get("scoped/districts/:categoryId")
  scopedDistricts(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("asMemberId") as?: string) {
    const [categoryId, yearId] = [routeInt(c), queryInt(y, 0)];
    return guarded(async () => ok(await this.svc.getScopedDistrictsGoalList(await this.effective(u, as), categoryId, yearId)));
  }

  @Post("scoped/bulk-lock")
  bulkLock(@User() u: CurrentUser, @Body() body: unknown) {
    const req = bindBulkLock(body);
    return guarded(async () => ok(await this.svc.bulkLockDistricts(this.memberId(u), req)));
  }

  @Get("scoped/clubs/:categoryId")
  scopedClubForm(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("clubId") cl?: string, @Query("asMemberId") as?: string) {
    const [categoryId, yearId, clubId] = [routeInt(c), queryInt(y, 0), queryInt(cl, 0)];
    return guarded(async () => {
      const r = await this.svc.getScopedClubGoalForm(await this.effective(u, as), categoryId, yearId, clubId);
      return r ? ok(r) : notFound({ message: "No club goals found." });
    });
  }

  // ── Reports ──────────────────────────────────────────────────────────────
  @Get("district-report/:districtId")
  districtSettingReport(@User() u: CurrentUser, @Param("districtId") d: string, @Query("yearId") y?: string, @Query("asMemberId") as?: string) {
    const [districtId, yearId] = [routeInt(d), queryInt(y)];
    return guarded(async () => xlsx(await this.svc.buildDistrictGoalSettingReportScoped(await this.effective(u, as), districtId, yearId), () => `District_Goal_Setting_${stamp("yyyyMMdd-HHmm")}.xlsx`, "No goal data to report for this district."));
  }

  @Get("district-report")
  districtReport(@User() u: CurrentUser, @Query("zoneId") z?: string, @Query("districtId") d?: string, @Query("yearId") y?: string, @Query("asMemberId") as?: string) {
    const [zoneId, districtId, yearId] = [queryInt(z), queryInt(d), queryInt(y)];
    return guarded(async () => xlsx(await this.svc.buildGoalDistrictReportExcel(await this.effective(u, as), zoneId, districtId, yearId), () => `goal-district-report-${stamp("yyyyMMdd-HHmm")}.xlsx`, "No goal data to report for this selection."));
  }

  @Get("report/zone/:zoneId")
  zoneReport(@User() u: CurrentUser, @Param("zoneId") z: string, @Query("yearId") y?: string) {
    const [zoneId, yearId] = [routeInt(z), queryInt(y)];
    return guarded(async () => xlsx(await this.svc.buildZoneGoalReport(this.memberId(u), zoneId, yearId), () => `goal-zone-${stamp("yyyyMMdd-HHmm")}.xlsx`));
  }

  @Get("report/district/:districtId")
  districtGoalReport(@User() u: CurrentUser, @Param("districtId") d: string, @Query("yearId") y?: string) {
    const [districtId, yearId] = [routeInt(d), queryInt(y)];
    return guarded(async () => xlsx(await this.svc.buildDistrictGoalReport(this.memberId(u), districtId, yearId), () => `goal-district-${stamp("yyyyMMdd-HHmm")}.xlsx`));
  }

  @Get("report/club/:clubId")
  clubGoalReport(@User() u: CurrentUser, @Param("clubId") cl: string, @Query("yearId") y?: string) {
    const [clubId, yearId] = [routeInt(cl), queryInt(y)];
    return guarded(async () => xlsx(await this.svc.buildClubGoalReport(this.memberId(u), clubId, yearId), () => `goal-club-${stamp("yyyyMMdd-HHmm")}.xlsx`));
  }

  // ── Messaging ────────────────────────────────────────────────────────────
  @Get("comments/:categoryId/:districtId")
  comments(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Query("yearId") y?: string, @Query("clubId") cl?: string, @Query("asMemberId") as?: string) {
    const [categoryId, districtId, yearId, clubId] = [routeInt(c), routeInt(d), queryInt(y, 0), queryInt(cl, 0)];
    return guarded(async () => ok(await this.svc.getComments(await this.effective(u, as), categoryId, districtId, clubId, yearId)));
  }

  @Post("comments/:categoryId/:districtId")
  postComment(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Body() body: unknown, @Query("yearId") y?: string, @Query("clubId") cl?: string, @Query("asMemberId") as?: string) {
    const [categoryId, districtId, yearId, clubId] = [routeInt(c), routeInt(d), queryInt(y, 0), queryInt(cl, 0)];
    return guarded(async () => ok(await this.svc.postComment(await this.effective(u, as), categoryId, districtId, clubId, yearId, commentText(body))));
  }

  @Get("threads/:categoryId/:districtId/:ownerMemberId")
  threadMessages(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Param("ownerMemberId") o: string, @Query("yearId") y?: string, @Query("asMemberId") as?: string) {
    const [categoryId, districtId, owner, yearId] = [routeInt(c), routeInt(d), routeInt(o), queryInt(y, 0)];
    return guarded(async () => ok(await this.svc.getGoalThreadMessages(await this.effective(u, as), categoryId, districtId, yearId, owner)));
  }

  @Post("threads/:categoryId/:districtId/:ownerMemberId")
  postThreadMessage(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Param("ownerMemberId") o: string, @Body() body: unknown, @Query("yearId") y?: string, @Query("asMemberId") as?: string) {
    const [categoryId, districtId, owner, yearId] = [routeInt(c), routeInt(d), routeInt(o), queryInt(y, 0)];
    return guarded(async () => ok(await this.svc.postGoalThreadMessage(await this.effective(u, as), categoryId, districtId, yearId, owner, commentText(body))));
  }

  @Get("threads/:categoryId/:districtId")
  async threadList(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Query("yearId") y?: string, @Query("asMemberId") as?: string) {
    const [categoryId, districtId, yearId] = [routeInt(c), routeInt(d), queryInt(y, 0)];
    return ok(await this.svc.getGoalThreadList(await this.effective(u, as), categoryId, districtId, yearId));
  }

  @Get("messages/has-unread")
  async hasUnread(@User() u: CurrentUser, @Query("zoneId") z?: string, @Query("yearId") y?: string, @Query("asMemberId") as?: string) {
    const [zoneId, yearId] = [queryInt(z, 0), queryInt(y, 0)];
    return ok({ hasUnread: await this.svc.hasUnreadZoneMessages(await this.effective(u, as), zoneId, yearId) });
  }

  @Post("messages/mark-seen")
  async markSeen(@User() u: CurrentUser, @Query("zoneId") z?: string, @Query("yearId") y?: string, @Query("asMemberId") as?: string) {
    const [zoneId, yearId] = [queryInt(z, 0), queryInt(y, 0)];
    await this.svc.markZoneMessagesSeen(await this.effective(u, as), zoneId, yearId);
    return ok({ ok: true });
  }

  @Get("zone-threads/:categoryId/:zoneId")
  async zoneThreads(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("zoneId") z: string, @Query("yearId") y?: string, @Query("act") act?: string, @Query("asMemberId") as?: string, @Query("districtId") d?: string) {
    const [categoryId, zoneId, yearId, districtId] = [routeInt(c), routeInt(z), queryInt(y, 0), queryInt(d)];
    return ok(await this.svc.getGoalZoneThreadList(await this.effective(u, as), categoryId, zoneId, yearId, queryString(act), districtId));
  }

  @Get("owner-thread/:categoryId/:ownerMemberId")
  ownerThread(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("ownerMemberId") o: string, @Query("yearId") y?: string, @Query("asMemberId") as?: string, @Query("zoneId") z?: string) {
    const [categoryId, owner, yearId, zoneId] = [routeInt(c), routeInt(o), queryInt(y, 0), queryInt(z)];
    return guarded(async () => ok(await this.svc.getGoalOwnerThreadMessages(await this.effective(u, as), categoryId, yearId, owner, zoneId)));
  }

  @Post("owner-thread/:categoryId/:ownerMemberId")
  postOwnerThread(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("ownerMemberId") o: string, @Body() body: unknown, @Query("yearId") y?: string, @Query("asMemberId") as?: string, @Query("districtId") d?: string) {
    const [categoryId, owner, yearId, districtId] = [routeInt(c), routeInt(o), queryInt(y, 0), queryInt(d, 0)];
    return guarded(async () => ok(await this.svc.postGoalOwnerThreadMessage(await this.effective(u, as), categoryId, yearId, owner, commentText(body), districtId)));
  }

  @Get("district-messages/inbox")
  async districtInbox(@User() u: CurrentUser, @Query("zoneId") z?: string, @Query("yearId") y?: string, @Query("categoryId") c?: string, @Query("districtId") d?: string, @Query("asMemberId") as?: string) {
    const [zoneId, yearId, categoryId, districtId] = [queryInt(z, 0), queryInt(y, 0), queryInt(c, 0), queryInt(d, 0)];
    return ok(await this.svc.getDistrictMessageInbox(await this.effective(u, as), zoneId, yearId, categoryId, districtId));
  }

  @Get("district-messages/:categoryId/:districtId")
  districtMessages(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Query("yearId") y?: string, @Query("asMemberId") as?: string) {
    const [categoryId, districtId, yearId] = [routeInt(c), routeInt(d), queryInt(y, 0)];
    return guarded(async () => ok(await this.svc.getDistrictMessages(await this.effective(u, as), categoryId, districtId, yearId)));
  }

  /** Never "view as": a message is always written by the logged-in person. */
  @Post("district-messages/:categoryId/:districtId")
  postDistrictMessage(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Body() body: unknown, @Query("yearId") y?: string) {
    const [categoryId, districtId, yearId] = [routeInt(c), routeInt(d), queryInt(y, 0)];
    return guarded(async () => ok(await this.svc.postDistrictMessage(this.memberId(u), categoryId, districtId, yearId, commentText(body))));
  }

  @Get("messages/list")
  messagesList(@User() u: CurrentUser, @Query("zoneId") z?: string, @Query("yearId") y?: string, @Query("categoryId") c?: string, @Query("districtId") d?: string, @Query("asMemberId") as?: string) {
    const [zoneId, yearId, categoryId, districtId] = [queryInt(z, 0), queryInt(y, 0), queryInt(c, 0), queryInt(d, 0)];
    return guarded(async () => ok(await this.svc.getGoalMessagesList(await this.effective(u, as), zoneId, yearId, categoryId, districtId)));
  }

  @Get("messages/roster")
  messagesRoster(@User() u: CurrentUser, @Query("zoneId") z?: string, @Query("yearId") y?: string, @Query("categoryId") c?: string, @Query("districtId") d?: string, @Query("asMemberId") as?: string) {
    const [zoneId, yearId, categoryId, districtId] = [queryInt(z, 0), queryInt(y, 0), queryInt(c, 0), queryInt(d, 0)];
    return guarded(async () => ok(await this.svc.getGoalMessageRoster(await this.effective(u, as), zoneId, yearId, categoryId, districtId)));
  }

  @Get("messages/report")
  messagesReport(@User() u: CurrentUser, @Query("zoneId") z?: string, @Query("yearId") y?: string, @Query("categoryId") c?: string, @Query("districtId") d?: string, @Query("asMemberId") as?: string) {
    const [zoneId, yearId, categoryId, districtId] = [queryInt(z, 0), queryInt(y, 0), queryInt(c, 0), queryInt(d, 0)];
    return guarded(async () => xlsx(await this.svc.buildGoalMessagesReportExcel(await this.effective(u, as), zoneId, yearId, categoryId, districtId), () => `Goal_Messages_Z${zoneId}_${stamp("yyyyMMdd-HHmm")}.xlsx`, "No messages to report for this selection."));
  }

  // ── Imports (SuperAdmin) ─────────────────────────────────────────────────
  @Get("foundation-import/sample")
  async foundationSample(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return file(await this.svc.buildFoundationSampleExcel(), XLSX_CONTENT_TYPE, `foundation_district_sample_${stamp("ddMMyyyy_HHmmss")}.xlsx`);
  }

  @Get("foundation-import/club/sample")
  async foundationClubSample(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return file(await this.svc.buildFoundationClubSampleExcel(), XLSX_CONTENT_TYPE, `foundation_club_sample_${stamp("ddMMyyyy_HHmmss")}.xlsx`);
  }

  @Post("foundation-import/club/convert")
  @ReadsRequestForm()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20_000_000 } }))
  convertClubFile(@User() u: CurrentUser, @UploadedFile() upload: Upload | undefined, @Res({ passthrough: true }) res: Response) {
    requireFile(upload);
    if (!this.isSuperAdmin(u)) return forbid();
    if (!upload || !upload.size) return badRequest({ message: "No file uploaded." });
    return importGuard(async () => {
      const r = await this.svc.convertFoundationMcrToClubFile(upload.buffer);
      res.setHeader("X-Clubs-Filled", String(r.filled));
      res.setHeader("X-Clubs-Missing", String(r.missing));
      res.setHeader("Access-Control-Expose-Headers", "X-Clubs-Filled, X-Clubs-Missing, Content-Disposition");
      return file(r.file, XLSX_CONTENT_TYPE, `foundation_club_import_${stamp("ddMMyyyy_HHmmss")}.xlsx`);
    });
  }

  @Post("foundation-import/club")
  @ReadsRequestForm()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20_000_000 } }))
  importClub(@User() u: CurrentUser, @UploadedFile() upload: Upload | undefined, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    if (!upload || !upload.size) return badRequest({ message: "No file uploaded." });
    return importGuard(async () => ok(await this.svc.importFoundationClub(this.memberId(u), int(f(body, "yearId")), upload.buffer, int(f(body, "month")))));
  }

  @Post("foundation-import")
  @ReadsRequestForm()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20_000_000 } }))
  importDistrict(@User() u: CurrentUser, @UploadedFile() upload: Upload | undefined, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    if (!upload || !upload.size) return badRequest({ message: "No file uploaded." });
    return importGuard(async () => ok(await this.svc.importFoundationMonthly(this.memberId(u), int(f(body, "yearId")), upload.buffer, int(f(body, "month")))));
  }

  @Post("membership-import")
  @ReadsRequestForm()
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 30_000_000 } }))
  importMembership(@User() u: CurrentUser, @UploadedFiles() files: Upload[] | undefined, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const pick = (name: string) => (files ?? []).find((x) => x.fieldname.toLowerCase() === name.toLowerCase() && x.size > 0);
    const [members, gender, rotaract, interact] = [pick("membersFile"), pick("genderFile"), pick("rotaractFile"), pick("interactFile")];
    if (!members || !gender) return badRequest({ message: `Upload both files: the Rotary "Comparison to 1 July" file and the "Members Admitted by Gender" file.` });
    return importGuard(async () =>
      ok(await this.svc.importDistrictMembership(this.memberId(u), int(f(body, "yearId")), members.buffer, members.originalname, gender.buffer, rotaract?.buffer ?? null, rotaract?.originalname ?? null, interact?.buffer ?? null)),
    );
  }
}

/** A district id passed as "route:<id>" (route segment with :int constraint) or a [FromQuery] int. */
function routeOrQuery(v: string | undefined): number {
  return v !== undefined && v.startsWith("route:") ? routeInt(v.slice(6)) : queryInt(v, 0);
}
