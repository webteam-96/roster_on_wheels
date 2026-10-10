import { Controller, Get, Post, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, file, forbid, ok } from "../../common/results";
import { XLSX_CONTENT_TYPE } from "../../services/xlsx";
import { DailyStatsReportService } from "./daily-stats-report.service";

/** Port of DailyStatsReportController.cs: SuperAdmin trigger and preview of the daily statistics report. */
@Controller()
@Authorize()
export class DailyStatsReportController {
  constructor(private readonly service: DailyStatsReportService) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");

  @Post("api/daily-stats-report/run")
  async runNow(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    try {
      await this.service.sendDailyReport(true);
      return ok({ message: "Daily statistics report sent to the configured recipients. Check the recipient inboxes and the email logs." });
    } catch (e) {
      return badRequest({ message: `Failed to run the daily statistics report: ${(e as Error).message}` });
    }
  }

  @Get("api/daily-stats-report/preview")
  async preview(@User() u: CurrentUser, @Query("format") format?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    try {
      const r = await this.service.buildReport();
      if ((format ?? "").toLowerCase() === "counts")
        return ok({ subject: r.subject, counts: r.metrics.map(([metric, count]) => ({ metric, count })), breakdowns: r.breakdowns });
      return file(r.excel, XLSX_CONTENT_TYPE, r.fileName);
    } catch (e) {
      return badRequest({ message: `Failed to build the daily statistics report: ${(e as Error).message}` });
    }
  }
}
