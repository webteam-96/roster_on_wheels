import { Controller, Get, Param, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, statusCode } from "../../common/results";
import { paramInt, queryInt } from "../../common/binding";
import { ClubReportService } from "./club-report.service";

/** Port of ClubReportController.cs: api/clubs/{clubId}/club-report. */
@Controller("api/clubs/:clubId/club-report")
@Authorize()
export class ClubReportController {
  constructor(private readonly svc: ClubReportService) {}

  @Get("attendance-matrix")
  attendanceMatrix(@Param("clubId") c: string, @Query("yearId") y?: string) {
    return this.svc.attendanceMatrix(paramInt(c, "clubId"), queryInt(y, 0));
  }

  @Get()
  getReport(@Param("clubId") c: string, @Query("yearId") y?: string) {
    return this.svc.getReport(paramInt(c, "clubId"), queryInt(y, 0));
  }

  @Get("data-collection/all-members")
  dataCollectionAllMembers(@Param("clubId") c: string, @Query("yearId") y?: string) {
    return this.svc.dataCollection(paramInt(c, "clubId"), queryInt(y, 0), "all-members");
  }

  @Get("data-collection/bod")
  dataCollectionBod(@Param("clubId") c: string, @Query("yearId") y?: string) {
    return this.svc.dataCollection(paramInt(c, "clubId"), queryInt(y, 0), "bod");
  }

  @Get("data-collection/dc")
  dataCollectionDc(@Param("clubId") c: string, @Query("yearId") y?: string) {
    return this.svc.dataCollection(paramInt(c, "clubId"), queryInt(y, 0), "dc");
  }

  @Get("avenue-of-service-raw-data")
  avenueOfServiceRawData(@Param("clubId") c: string, @Query("yearId") y?: string) {
    return this.svc.avenueOfServiceRawData(paramInt(c, "clubId"), queryInt(y, 0));
  }

  @Get("annual-club-service-raw-data")
  annualClubServiceRawData(@Param("clubId") c: string, @Query("yearId") y?: string) {
    return this.svc.annualClubServiceRawData(paramInt(c, "clubId"), queryInt(y, 0));
  }

  @Get("annual-report")
  annualReport(@Param("clubId") c: string, @Query("yearId") y?: string) {
    return this.svc.annualReport(paramInt(c, "clubId"), queryInt(y, 0));
  }

  @Get("available-years")
  availableYears(@Param("clubId") c: string) {
    return this.svc.availableYears(paramInt(c, "clubId"));
  }
}

/**
 * Port of MobileClubAdminReportController.cs: the club-report surface for the mobile
 * Club Admin app. SuperAdmin picks any club; Admin is pinned to the clubId claim.
 */
@Controller("api/mobile/club-admin/club-report")
@Authorize()
export class MobileClubAdminReportController {
  constructor(private readonly svc: ClubReportService) {}

  private roles = (u: CurrentUser) => u.findFirst("roles") ?? "";
  private allowed = (u: CurrentUser) => this.roles(u).includes("SuperAdmin") || this.roles(u).includes("Admin");
  private denied = () => statusCode(403, { message: "Access denied." });

  /** Admin: the clubId claim, whatever was asked; SuperAdmin: the requested club. */
  private clubId(u: CurrentUser, requested: string | undefined) {
    const asked = queryInt(requested);
    if (this.roles(u).includes("SuperAdmin")) return asked;
    const claim = u.findFirst("clubId");
    return claim && /^-?\d+$/.test(claim.trim()) ? parseInt(claim, 10) : asked;
  }

  private run(u: CurrentUser, c: string | undefined, work: (clubId: number) => unknown) {
    if (!this.allowed(u)) return this.denied();
    const clubId = this.clubId(u, c);
    if (clubId === null) return badRequest({ message: "clubId is required." });
    return work(clubId);
  }

  @Get()
  getReport(@User() u: CurrentUser, @Query("clubId") c?: string, @Query("yearId") y?: string) {
    const yearId = queryInt(y, 0);
    return this.run(u, c, (id) => this.svc.getReport(id, yearId));
  }

  @Get("data-collection/all-members")
  dataCollectionAllMembers(@User() u: CurrentUser, @Query("clubId") c?: string, @Query("yearId") y?: string) {
    const yearId = queryInt(y, 0);
    return this.run(u, c, (id) => this.svc.dataCollection(id, yearId, "all-members"));
  }

  @Get("data-collection/bod")
  dataCollectionBod(@User() u: CurrentUser, @Query("clubId") c?: string, @Query("yearId") y?: string) {
    const yearId = queryInt(y, 0);
    return this.run(u, c, (id) => this.svc.dataCollection(id, yearId, "bod"));
  }

  @Get("data-collection/dc")
  dataCollectionDc(@User() u: CurrentUser, @Query("clubId") c?: string, @Query("yearId") y?: string) {
    const yearId = queryInt(y, 0);
    return this.run(u, c, (id) => this.svc.dataCollection(id, yearId, "dc"));
  }

  @Get("avenue-of-service-raw-data")
  avenueOfServiceRawData(@User() u: CurrentUser, @Query("clubId") c?: string, @Query("yearId") y?: string) {
    const yearId = queryInt(y, 0);
    return this.run(u, c, (id) => this.svc.avenueOfServiceRawData(id, yearId));
  }

  @Get("annual-club-service-raw-data")
  annualClubServiceRawData(@User() u: CurrentUser, @Query("clubId") c?: string, @Query("yearId") y?: string) {
    const yearId = queryInt(y, 0);
    return this.run(u, c, (id) => this.svc.annualClubServiceRawData(id, yearId));
  }

  @Get("annual-report")
  annualReport(@User() u: CurrentUser, @Query("clubId") c?: string, @Query("yearId") y?: string) {
    const yearId = queryInt(y, 0);
    return this.run(u, c, (id) => this.svc.annualReport(id, yearId));
  }

  @Get("available-years")
  availableYears(@User() u: CurrentUser, @Query("clubId") c?: string) {
    return this.run(u, c, (id) => this.svc.availableYears(id));
  }
}
