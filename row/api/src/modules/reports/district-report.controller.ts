import { Controller, Get, Param, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, statusCode } from "../../common/results";
import { paramInt, queryInt } from "../../common/binding";
import { isSuperAdmin } from "../../services/user-permission.helper";
import { DistrictReportService } from "./district-report.service";

/** Port of DistrictReportController.cs: api/districts/{districtId}/district-report. */
@Controller("api/districts/:districtId/district-report")
@Authorize()
export class DistrictReportController {
  constructor(private readonly svc: DistrictReportService) {}

  @Get()
  getReport(@User() u: CurrentUser, @Param("districtId") d: string, @Query("yearId") y?: string, @Query("agMemberId") ag?: string) {
    return this.svc.getReport(paramInt(d, "districtId"), queryInt(y, 0), queryInt(ag), isSuperAdmin(u));
  }

  @Get("data-collection/all-members")
  dataCollectionAllMembers(@User() u: CurrentUser, @Param("districtId") d: string, @Query("yearId") y?: string, @Query("clubId") c?: string, @Query("agMemberId") ag?: string) {
    return this.svc.dataCollectionClubList(paramInt(d, "districtId"), queryInt(y, 0), queryInt(c), queryInt(ag), isSuperAdmin(u), "all-members");
  }

  @Get("data-collection/bod")
  dataCollectionBod(@User() u: CurrentUser, @Param("districtId") d: string, @Query("yearId") y?: string, @Query("clubId") c?: string, @Query("agMemberId") ag?: string) {
    return this.svc.dataCollectionClubList(paramInt(d, "districtId"), queryInt(y, 0), queryInt(c), queryInt(ag), isSuperAdmin(u), "bod");
  }

  @Get("data-collection/dc")
  dataCollectionDc(@Param("districtId") d: string, @Query("yearId") y?: string, @Query("agMemberId") ag?: string) {
    return this.svc.dataCollectionDc(paramInt(d, "districtId"), queryInt(y, 0), queryInt(ag));
  }

  @Get("ocv-gov")
  ocvGov(@User() u: CurrentUser, @Param("districtId") d: string, @Query("yearId") y?: string, @Query("clubId") c?: string, @Query("agMemberId") ag?: string) {
    return this.svc.ocvGov(paramInt(d, "districtId"), queryInt(y, 0), queryInt(c), queryInt(ag), isSuperAdmin(u));
  }

  @Get("club-officers-ri")
  clubOfficersFromRi(@User() u: CurrentUser, @Param("districtId") d: string, @Query("yearId") y?: string, @Query("clubId") c?: string, @Query("agMemberId") ag?: string) {
    return this.svc.clubOfficersFromRi(paramInt(d, "districtId"), queryInt(y, 0), queryInt(c), queryInt(ag), isSuperAdmin(u));
  }

  @Get("available-years")
  availableYears(@User() u: CurrentUser, @Param("districtId") d: string) {
    return this.svc.availableYears(paramInt(d, "districtId"), isSuperAdmin(u));
  }

  @Get("avenue-of-service-all-clubs")
  avenueOfServiceAllClubs(@Param("districtId") d: string, @Query("yearId") y?: string, @Query("agMemberId") ag?: string) {
    return this.svc.avenueOfServiceAllClubs(paramInt(d, "districtId"), queryInt(y, 0), queryInt(ag));
  }

  @Get("avenue-of-service-club-count")
  avenueOfServiceClubCount(@User() u: CurrentUser, @Param("districtId") d: string, @Query("yearId") y?: string, @Query("agMemberId") ag?: string) {
    return this.svc.avenueOfServiceClubCount(paramInt(d, "districtId"), queryInt(y, 0), queryInt(ag), isSuperAdmin(u));
  }
}

/**
 * Port of MobileDistrictAdminReportController.cs: the district-report surface for the mobile
 * app. SuperAdmin / Admin may filter by any AG; an AG is always scoped to their own clubs.
 */
@Controller("api/mobile/district-admin/district-report")
@Authorize()
export class MobileDistrictAdminReportController {
  constructor(private readonly svc: DistrictReportService) {}

  private roles = (u: CurrentUser) => u.findFirst("roles") ?? "";
  private saOrAdmin = (u: CurrentUser) => this.roles(u).includes("SuperAdmin") || this.roles(u).includes("Admin");
  private memberId = (u: CurrentUser) => { const v = u.findFirst("memberId") ?? ""; return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0; };

  /** SA / Admin: what they asked for; an AG: forced to their own member id (never trust the client). */
  private agScope(u: CurrentUser, requested: number | null) {
    if (this.saOrAdmin(u)) return requested;
    if (this.roles(u).includes("AG")) return this.memberId(u);
    return requested;
  }

  private run(u: CurrentUser, d: string | undefined, work: (districtId: number) => unknown) {
    if (!(this.saOrAdmin(u) || this.roles(u).includes("AG"))) return statusCode(403, { message: "Access denied." });
    const districtId = queryInt(d, 0);
    if (districtId <= 0) return badRequest({ message: "districtId is required." });
    return work(districtId);
  }

  @Get()
  getReport(@User() u: CurrentUser, @Query("districtId") d?: string, @Query("yearId") y?: string, @Query("agMemberId") ag?: string) {
    const [yearId, agId] = [queryInt(y, 0), queryInt(ag)];
    return this.run(u, d, (id) => this.svc.getReport(id, yearId, this.agScope(u, agId), isSuperAdmin(u)));
  }

  @Get("data-collection/all-members")
  dataCollectionAllMembers(@User() u: CurrentUser, @Query("districtId") d?: string, @Query("yearId") y?: string, @Query("clubId") c?: string, @Query("agMemberId") ag?: string) {
    const [yearId, clubId, agId] = [queryInt(y, 0), queryInt(c), queryInt(ag)];
    return this.run(u, d, (id) => this.svc.dataCollectionClubList(id, yearId, clubId, this.agScope(u, agId), isSuperAdmin(u), "all-members"));
  }

  @Get("data-collection/bod")
  dataCollectionBod(@User() u: CurrentUser, @Query("districtId") d?: string, @Query("yearId") y?: string, @Query("clubId") c?: string, @Query("agMemberId") ag?: string) {
    const [yearId, clubId, agId] = [queryInt(y, 0), queryInt(c), queryInt(ag)];
    return this.run(u, d, (id) => this.svc.dataCollectionClubList(id, yearId, clubId, this.agScope(u, agId), isSuperAdmin(u), "bod"));
  }

  @Get("data-collection/dc")
  dataCollectionDc(@User() u: CurrentUser, @Query("districtId") d?: string, @Query("yearId") y?: string, @Query("agMemberId") ag?: string) {
    const [yearId, agId] = [queryInt(y, 0), queryInt(ag)];
    return this.run(u, d, (id) => this.svc.dataCollectionDc(id, yearId, this.agScope(u, agId)));
  }

  @Get("ocv-gov")
  ocvGov(@User() u: CurrentUser, @Query("districtId") d?: string, @Query("yearId") y?: string, @Query("clubId") c?: string, @Query("agMemberId") ag?: string) {
    const [yearId, clubId, agId] = [queryInt(y, 0), queryInt(c), queryInt(ag)];
    return this.run(u, d, (id) => this.svc.ocvGov(id, yearId, clubId, this.agScope(u, agId), isSuperAdmin(u)));
  }

  @Get("club-officers-ri")
  clubOfficersFromRi(@User() u: CurrentUser, @Query("districtId") d?: string, @Query("yearId") y?: string, @Query("clubId") c?: string, @Query("agMemberId") ag?: string) {
    const [yearId, clubId, agId] = [queryInt(y, 0), queryInt(c), queryInt(ag)];
    return this.run(u, d, (id) => this.svc.clubOfficersFromRi(id, yearId, clubId, this.agScope(u, agId), isSuperAdmin(u)));
  }

  @Get("available-years")
  availableYears(@User() u: CurrentUser, @Query("districtId") d?: string) {
    return this.run(u, d, (id) => this.svc.availableYears(id, isSuperAdmin(u)));
  }

  @Get("avenue-of-service-all-clubs")
  avenueOfServiceAllClubs(@User() u: CurrentUser, @Query("districtId") d?: string, @Query("yearId") y?: string, @Query("agMemberId") ag?: string) {
    const [yearId, agId] = [queryInt(y, 0), queryInt(ag)];
    return this.run(u, d, (id) => this.svc.avenueOfServiceAllClubs(id, yearId, this.agScope(u, agId)));
  }

  @Get("avenue-of-service-club-count")
  avenueOfServiceClubCount(@User() u: CurrentUser, @Query("districtId") d?: string, @Query("yearId") y?: string, @Query("agMemberId") ag?: string) {
    const [yearId, agId] = [queryInt(y, 0), queryInt(ag)];
    return this.run(u, d, (id) => this.svc.avenueOfServiceClubCount(id, yearId, this.agScope(u, agId), isSuperAdmin(u)));
  }
}
