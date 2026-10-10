import { Body, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Authorize, User, ReadsRequestForm } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, file, forbid, notFound, ok, type ActionResult } from "../../common/results";
import { bodyField, queryInt, queryString, requireQuery, routeInt } from "../../common/binding";
import { Brand } from "../../brand/brand";
import { formatDate, nowIn } from "../../common/dotnet-format";
import { XLSX_CONTENT_TYPE } from "../../services/xlsx";
import { GoalSettingService } from "./goal-setting.service";
import type { GoalOverviewMatrixDto } from "./goal-setting.dtos";
import { bindBulkLock, bindCreateRole, bindDesignation, bindEntries, bindMonthly, bindSplit, commentText, guarded } from "./goal-setting.controller";

type Upload = { buffer: Buffer; size: number };

const stamp = (fmt: string) => formatDate(nowIn(Brand.Current.locale.defaultTimeZone), fmt);
const xlsx = (bytes: Buffer | null, name: () => string) => (bytes ? file(bytes, XLSX_CONTENT_TYPE, name()) : notFound({ message: "No data." }));
const yearOf = (body: unknown) => Math.trunc(Number(bodyField(body, "yearId")) || 0);

/** Mobile overview: no Public Image "Suggestions" text rows, and no Youth Service Achievement(%) rows. */
export function mobileOverview(m: GoalOverviewMatrixDto): GoalOverviewMatrixDto {
  m.rows = m.rows.filter((r) => (r.groupName ?? "").toLowerCase() !== "suggestions");
  if ((m.categoryName ?? "").toLowerCase() === "youth service") m.rows = m.rows.filter((r) => r.dataType !== "Percentage");
  return m;
}

/** Port of MobileGoalSettingController.cs: the web surface without "view as"; SuperAdmin-only routes simply Forbid on mobile tokens. */
@Controller("api/mobile/goal-setting")
@Authorize()
export class MobileGoalSettingController {
  constructor(private readonly svc: GoalSettingService) {}

  private memberId = (u: CurrentUser) => { const v = u.findFirst("memberId") ?? u.findFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier") ?? ""; return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0; };
  private roles = (u: CurrentUser) => u.findFirst("roles") ?? "";
  private isAuthorisedRole = (u: CurrentUser) => this.roles(u).includes("Admin") || this.roles(u).includes("SuperAdmin");
  private isSuperAdmin = (u: CurrentUser) => this.roles(u).includes("SuperAdmin");
  private isZoneAuthorisedRole = (u: CurrentUser) => this.roles(u).includes("ZonalCoordinator") || this.roles(u).includes("SuperAdmin");

  @Get("categories")
  async categories() {
    return ok(await this.svc.getCategories());
  }

  @Get("monthly/categories")
  async monthWiseCategories() {
    return ok((await this.svc.getCategories()).filter((c) => c.hasMonthWise));
  }

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

  // ── Goal entry ───────────────────────────────────────────────────────────
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

  @Get("districts/:categoryId/clubs")
  districtClubsList(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [categoryId, yearId, districtId] = [routeInt(c), queryInt(y, 0), queryInt(d)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => ok(await this.svc.getDistrictClubsGoalList(this.memberId(u), categoryId, yearId, districtId)));
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

  @Get("monthly/districts/:categoryId")
  getDistrictMonthly(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("districtId") d?: string) {
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

  // ── Excel downloads (same builders + file names as web) ──────────────────
  @Get("goals-excel/districts")
  districtGoalsExcel(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [yearId, districtId] = [queryInt(y), queryInt(d)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => xlsx(await this.svc.buildDistrictMonthlyExcel(this.memberId(u), 0, yearId, districtId), () => `district-goal-report-${stamp("yyyyMMdd-HHmm")}.xlsx`));
  }

  @Get("goals-excel/clubs")
  clubGoalsExcel(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") cl?: string) {
    const [yearId, clubId] = [queryInt(y), queryInt(cl)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => xlsx(await this.svc.buildClubMonthlyExcel(this.memberId(u), 0, yearId, clubId), () => `club-goal-report-${stamp("yyyyMMdd-HHmm")}.xlsx`));
  }

  @Get("goals-excel/clubs-all")
  allClubsGoalsExcel(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [yearId, districtId] = [queryInt(y), queryInt(d)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => xlsx(await this.svc.buildAllClubsMonthlyExcel(this.memberId(u), yearId, districtId), () => `all-clubs-goal-report-${stamp("yyyyMMdd-HHmm")}.xlsx`));
  }

  @Get("monthly/districts/:categoryId/excel")
  districtMonthlyExcel(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [categoryId, yearId, districtId] = [routeInt(c), queryInt(y), queryInt(d)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => xlsx(await this.svc.buildDistrictMonthlyExcel(this.memberId(u), categoryId, yearId, districtId), () => `goals-monthly-district-${stamp("yyyyMMdd-HHmm")}.xlsx`));
  }

  @Get("monthly/clubs/:categoryId/excel")
  clubMonthlyExcel(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("clubId") cl?: string) {
    const [categoryId, yearId, clubId] = [routeInt(c), queryInt(y), queryInt(cl)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => xlsx(await this.svc.buildClubMonthlyExcel(this.memberId(u), categoryId, yearId, clubId), () => `goals-monthly-club-${stamp("yyyyMMdd-HHmm")}.xlsx`));
  }

  // ── Zonal Coordinator ────────────────────────────────────────────────────
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
    return this.districtLock(u, routeInt(c), queryInt(y, 0), routeInt(d), true, true);
  }

  @Post("zone/districts/:categoryId/:districtId/unlock")
  zoneUnlock(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Query("yearId") y?: string) {
    return this.districtLock(u, routeInt(c), queryInt(y, 0), routeInt(d), false, true);
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
    return r ? ok(mobileOverview(r)) : notFound({ message: "Invalid zone or year." });
  }

  @Get("overview-scoped")
  scopedOverview(@User() u: CurrentUser, @Query("zoneId") z?: string, @Query("categoryId") c?: string, @Query("yearId") y?: string) {
    const [zoneId, categoryId, yearId] = [queryInt(z, 0), queryInt(c, 0), queryInt(y)];
    return guarded(async () => {
      const r = await this.svc.getScopedOverviewMatrix(this.memberId(u), zoneId, categoryId, yearId);
      return r ? ok(mobileOverview(r)) : notFound({ message: "Invalid zone or year." });
    });
  }

  // ── Locking ──────────────────────────────────────────────────────────────
  @Post("clubs/:categoryId/lock")
  lockClub(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("clubId") cl?: string) {
    return this.clubLock(u, routeInt(c), queryInt(y, 0), queryInt(cl, 0), true);
  }

  @Post("clubs/:categoryId/unlock")
  unlockClub(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("clubId") cl?: string) {
    return this.clubLock(u, routeInt(c), queryInt(y, 0), queryInt(cl, 0), false);
  }

  @Post("districts/:categoryId/lock")
  lockDistrict(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    return this.districtLock(u, routeInt(c), queryInt(y, 0), queryInt(d, 0), true, false);
  }

  @Post("districts/:categoryId/unlock")
  unlockDistrict(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    return this.districtLock(u, routeInt(c), queryInt(y, 0), queryInt(d, 0), false, false);
  }

  private clubLock(u: CurrentUser, categoryId: number, yearId: number, clubId: number, locked: boolean) {
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => ok(await this.svc.setClubLock(this.memberId(u), categoryId, yearId, clubId, locked)));
  }

  private districtLock(u: CurrentUser, categoryId: number, yearId: number, districtId: number, locked: boolean, zone: boolean) {
    if (!(zone ? this.isZoneAuthorisedRole(u) : this.isAuthorisedRole(u))) return forbid();
    return guarded(async () => ok(await this.svc.setDistrictLock(this.memberId(u), categoryId, yearId, districtId, locked)));
  }

  // ── Oversight roles (SuperAdmin; Forbid for mobile tokens) ───────────────
  @Get("role-assignments")
  async roleAssignments(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.svc.getRoleAssignments());
  }

  @Post("role-assignments")
  createRoleAssignment(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    return guarded(async () => ok(await this.svc.createRoleAssignment(this.memberId(u), bindCreateRole(body))));
  }

  @Delete("role-assignments/:assignmentId")
  async revokeRoleAssignment(@User() u: CurrentUser, @Param("assignmentId") a: string) {
    const assignmentId = routeInt(a);
    if (!this.isSuperAdmin(u)) return forbid();
    await this.svc.revokeRoleAssignment(assignmentId, this.memberId(u));
    return ok({ message: "Assignment revoked." });
  }

  @Post("role-assignments/send-emails")
  async sendRoleEmails(@User() u: CurrentUser, @Query("zoneId") z?: string) {
    const zoneId = queryInt(z);
    if (!this.isSuperAdmin(u)) return forbid();
    const count = await this.svc.sendAllRoleAssignmentEmails(this.memberId(u), zoneId);
    return ok({ sent: count, message: count > 0 ? `Role-assigned email sent to ${count} member(s).` : "No members with an email address to notify." });
  }

  @Get("designations")
  async designations() {
    return ok(await this.svc.getDesignations());
  }

  @Post("designations")
  addDesignation(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    return guarded(async () => ok(await this.svc.addDesignation(bindDesignation(body))));
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
  async myAssignments(@User() u: CurrentUser) {
    return ok(await this.svc.getMyAssignments(this.memberId(u)));
  }

  @Get("scoped/districts/:categoryId/:districtId")
  scopedDistrictForm(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Query("yearId") y?: string) {
    const [categoryId, districtId, yearId] = [routeInt(c), routeInt(d), queryInt(y, 0)];
    return guarded(async () => ok(await this.svc.getScopedDistrictGoalForm(this.memberId(u), categoryId, yearId, districtId)));
  }

  @Get("scoped/districts/:categoryId")
  scopedDistricts(@User() u: CurrentUser, @Param("categoryId") c: string, @Query("yearId") y?: string) {
    const [categoryId, yearId] = [routeInt(c), queryInt(y, 0)];
    return guarded(async () => ok(await this.svc.getScopedDistrictsGoalList(this.memberId(u), categoryId, yearId)));
  }

  @Post("scoped/bulk-lock")
  bulkLock(@User() u: CurrentUser, @Body() body: unknown) {
    return guarded(async () => ok(await this.svc.bulkLockDistricts(this.memberId(u), bindBulkLock(body))));
  }

  // ── Messaging ────────────────────────────────────────────────────────────
  @Get("comments/:categoryId/:districtId")
  comments(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Query("yearId") y?: string, @Query("clubId") cl?: string) {
    const [categoryId, districtId, yearId, clubId] = [routeInt(c), routeInt(d), queryInt(y, 0), queryInt(cl, 0)];
    return guarded(async () => ok(await this.svc.getComments(this.memberId(u), categoryId, districtId, clubId, yearId)));
  }

  @Post("comments/:categoryId/:districtId")
  postComment(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Body() body: unknown, @Query("yearId") y?: string, @Query("clubId") cl?: string) {
    const [categoryId, districtId, yearId, clubId] = [routeInt(c), routeInt(d), queryInt(y, 0), queryInt(cl, 0)];
    return guarded(async () => ok(await this.svc.postComment(this.memberId(u), categoryId, districtId, clubId, yearId, commentText(body))));
  }

  @Get("threads/:categoryId/:districtId/:ownerMemberId")
  threadMessages(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Param("ownerMemberId") o: string, @Query("yearId") y?: string) {
    const [categoryId, districtId, owner, yearId] = [routeInt(c), routeInt(d), routeInt(o), queryInt(y, 0)];
    return guarded(async () => ok(await this.svc.getGoalThreadMessages(this.memberId(u), categoryId, districtId, yearId, owner)));
  }

  @Post("threads/:categoryId/:districtId/:ownerMemberId")
  postThreadMessage(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Param("ownerMemberId") o: string, @Body() body: unknown, @Query("yearId") y?: string) {
    const [categoryId, districtId, owner, yearId] = [routeInt(c), routeInt(d), routeInt(o), queryInt(y, 0)];
    return guarded(async () => ok(await this.svc.postGoalThreadMessage(this.memberId(u), categoryId, districtId, yearId, owner, commentText(body))));
  }

  @Get("threads/:categoryId/:districtId")
  async threadList(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Query("yearId") y?: string) {
    const [categoryId, districtId, yearId] = [routeInt(c), routeInt(d), queryInt(y, 0)];
    return ok(await this.svc.getGoalThreadList(this.memberId(u), categoryId, districtId, yearId));
  }

  @Get("district-messages/inbox")
  async districtInbox(@User() u: CurrentUser, @Query("zoneId") z?: string, @Query("yearId") y?: string, @Query("categoryId") c?: string, @Query("districtId") d?: string) {
    const [zoneId, yearId, categoryId, districtId] = [queryInt(z, 0), queryInt(y, 0), queryInt(c, 0), queryInt(d, 0)];
    return ok(await this.svc.getDistrictMessageInbox(this.memberId(u), zoneId, yearId, categoryId, districtId));
  }

  @Get("district-messages/:categoryId/:districtId")
  districtMessages(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Query("yearId") y?: string) {
    const [categoryId, districtId, yearId] = [routeInt(c), routeInt(d), queryInt(y, 0)];
    return guarded(async () => ok(await this.svc.getDistrictMessages(this.memberId(u), categoryId, districtId, yearId)));
  }

  @Post("district-messages/:categoryId/:districtId")
  postDistrictMessage(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("districtId") d: string, @Body() body: unknown, @Query("yearId") y?: string) {
    const [categoryId, districtId, yearId] = [routeInt(c), routeInt(d), queryInt(y, 0)];
    return guarded(async () => ok(await this.svc.postDistrictMessage(this.memberId(u), categoryId, districtId, yearId, commentText(body))));
  }

  @Get("messages/has-unread")
  async hasUnread(@User() u: CurrentUser, @Query("zoneId") z?: string, @Query("yearId") y?: string) {
    return ok({ hasUnread: await this.svc.hasUnreadZoneMessages(this.memberId(u), queryInt(z, 0), queryInt(y, 0)) });
  }

  @Get("zone-threads/:categoryId/:zoneId")
  async zoneThreads(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("zoneId") z: string, @Query("yearId") y?: string, @Query("act") act?: string) {
    const [categoryId, zoneId, yearId] = [routeInt(c), routeInt(z), queryInt(y, 0)];
    return ok(await this.svc.getGoalZoneThreadList(this.memberId(u), categoryId, zoneId, yearId, queryString(act)));
  }

  @Get("owner-thread/:categoryId/:ownerMemberId")
  ownerThread(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("ownerMemberId") o: string, @Query("yearId") y?: string, @Query("zoneId") z?: string) {
    const [categoryId, owner, yearId, zoneId] = [routeInt(c), routeInt(o), queryInt(y, 0), queryInt(z)];
    return guarded(async () => ok(await this.svc.getGoalOwnerThreadMessages(this.memberId(u), categoryId, yearId, owner, zoneId)));
  }

  @Post("owner-thread/:categoryId/:ownerMemberId")
  postOwnerThread(@User() u: CurrentUser, @Param("categoryId") c: string, @Param("ownerMemberId") o: string, @Body() body: unknown, @Query("yearId") y?: string) {
    const [categoryId, owner, yearId] = [routeInt(c), routeInt(o), queryInt(y, 0)];
    return guarded(async () => ok(await this.svc.postGoalOwnerThreadMessage(this.memberId(u), categoryId, yearId, owner, commentText(body))));
  }

  // ── Foundation import (SuperAdmin; Forbid for mobile tokens). No month field on mobile. ──
  @Post("foundation-import/club")
  @ReadsRequestForm()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20_000_000 } }))
  importClub(@User() u: CurrentUser, @UploadedFile() upload: Upload | undefined, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    if (!upload || !upload.size) return badRequest({ message: "No file uploaded." });
    return this.importGuard(async () => ok(await this.svc.importFoundationClub(this.memberId(u), yearOf(body), upload.buffer)));
  }

  @Post("foundation-import")
  @ReadsRequestForm()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20_000_000 } }))
  importDistrict(@User() u: CurrentUser, @UploadedFile() upload: Upload | undefined, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    if (!upload || !upload.size) return badRequest({ message: "No file uploaded." });
    return this.importGuard(async () => ok(await this.svc.importFoundationMonthly(this.memberId(u), yearOf(body), upload.buffer)));
  }

  private async importGuard(work: () => Promise<ActionResult>): Promise<ActionResult> {
    try {
      return await guarded(work);
    } catch (e) {
      return badRequest({ message: `Failed to read the Excel file: ${(e as Error).message}` });
    }
  }

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
}
