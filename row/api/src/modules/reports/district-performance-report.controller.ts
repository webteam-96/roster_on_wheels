import { Controller, Get, Post, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { queryInt } from "../../common/binding";
import { badRequest, file, forbid, notFound, ok, type ActionResult } from "../../common/results";
import { XLSX_CONTENT_TYPE } from "../../services/xlsx";
import { DistrictPerformanceReportService, KeyNotFoundException } from "./district-performance-report.service";

const report = (r: Awaited<ReturnType<DistrictPerformanceReportService["buildReport"]>>) => ({
  districtId: r.districtId, districtNumber: r.districtNumber, zoneName: r.zoneName, yearId: r.yearId, yearLabel: r.yearLabel, periodLabel: r.periodLabel,
  governorName: r.governorName, governorEmail: r.governorEmail, governorMobile: r.governorMobile, subject: r.subject, highlights: r.highlights, scopeNote: r.scopeNote, sections: r.sections,
});

/** Port of DistrictPerformanceReportController.cs — SuperAdmin only. */
@Controller()
@Authorize()
export class DistrictPerformanceReportController {
  constructor(private readonly svc: DistrictPerformanceReportService) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private memberId = (u: CurrentUser) => { const v = u.findFirst("memberId") ?? u.findFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier") ?? ""; return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0; };

  private async attempt(work: () => Promise<ActionResult>, failure: string, notFoundToo: boolean): Promise<ActionResult> {
    try {
      return await work();
    } catch (e) {
      if (notFoundToo && e instanceof KeyNotFoundException) return notFound({ message: e.message });
      return badRequest({ message: `${failure}: ${(e as Error).message}` });
    }
  }

  @Get("api/district-performance-report/settings")
  async settings(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.svc.getSettings());
  }

  @Get("api/district-performance-report/districts")
  async districts(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.svc.getDistricts());
  }

  @Get("api/district-performance-report/view")
  view(@User() u: CurrentUser, @Query("districtId") d?: string) {
    const districtId = queryInt(d, 0);
    if (!this.isSuperAdmin(u)) return forbid();
    if (districtId <= 0) return badRequest({ message: "Select a district." });
    return this.attempt(async () => {
      const r = await this.svc.buildReport(districtId, false);
      return ok({ ...report(r), html: this.svc.buildPrintHtml(r) });
    }, "Failed to build the report", true);
  }

  @Get("api/district-performance-report/excel")
  excel(@User() u: CurrentUser, @Query("districtId") d?: string) {
    const districtId = queryInt(d, 0);
    if (!this.isSuperAdmin(u)) return forbid();
    if (districtId <= 0) return badRequest({ message: "Select a district." });
    return this.attempt(async () => {
      const r = await this.svc.buildReport(districtId, true);
      return file(r.excel!, XLSX_CONTENT_TYPE, r.fileName);
    }, "Failed to build the Excel", true);
  }

  @Get("api/district-performance-report/zones/view")
  zoneView(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return this.attempt(async () => {
      const r = await this.svc.buildZoneReport(false);
      return ok({
        districtNumber: r.districtNumber, zoneName: r.zoneName, yearId: r.yearId, yearLabel: r.yearLabel, periodLabel: r.periodLabel, subject: r.subject,
        reportKicker: r.reportKicker, reportTitle: r.reportTitle, reportSubtitle: r.reportSubtitle, highlights: r.highlights, scopeNote: r.scopeNote, sections: r.sections,
        html: this.svc.buildPrintHtml(r),
      });
    }, "Failed to build the RI Director report", false);
  }

  @Get("api/district-performance-report/zones/excel")
  zoneExcel(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return this.attempt(async () => {
      const r = await this.svc.buildZoneReport(true);
      return file(r.excel!, XLSX_CONTENT_TYPE, r.fileName);
    }, "Failed to build the RI Director Excel", false);
  }

  @Post("api/district-performance-report/zones/send-test")
  zoneSendTest(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return this.attempt(async () => ok({ message: await this.svc.sendZoneTest(this.memberId(u)) }), "Failed to send the RI Director test email", false);
  }

  @Post("api/district-performance-report/send-test")
  sendTest(@User() u: CurrentUser, @Query("districtId") d?: string) {
    const districtId = queryInt(d, 0);
    if (!this.isSuperAdmin(u)) return forbid();
    if (districtId <= 0) return badRequest({ message: "Select a district." });
    return this.attempt(async () => ok({ message: await this.svc.sendTest(districtId, this.memberId(u)) }), "Failed to send the test email", true);
  }
}
