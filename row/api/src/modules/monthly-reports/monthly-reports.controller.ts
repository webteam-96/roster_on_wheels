import { Body, Controller, Delete, Get, Logger, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { Db } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { defineDto } from "../../common/dto";
import { file, forbid, notFound, ok, statusCode } from "../../common/results";
import { bodyField, dbDateTime, paramInt, queryInt } from "../../common/binding";
import { CLUB_BLOCKED_MESSAGE, isClubDrillReachable } from "../../services/kill-switch.helper";
import { webRootPath } from "../../services/media-storage";
import { MonthlyReportService } from "./monthly-report.service";
import { CmrSubmissionMailer } from "./cmr-submission.mailer";
import { buildWordReport, loadPhoto } from "./cmr-documents";

const isInt = (s: string) => /^-?\d+$/.test(s);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Port of ClubMonthlyReportController.cs: api/clubs/{clubId}/monthly-reports. */
@Controller("api/clubs/:clubId/monthly-reports")
@Authorize()
export class MonthlyReportsController {
  private readonly log = new Logger("ClubMonthlyReportController");

  constructor(
    private readonly reports: MonthlyReportService,
    private readonly mailer: CmrSubmissionMailer,
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10) || 0;
  private async blocked(clubId: number) {
    return !(await isClubDrillReachable(this.db, clubId)) ? statusCode(403, { message: CLUB_BLOCKED_MESSAGE }) : null;
  }
  /** {yearId:int}/{month:int} style routes: anything else does not match (404). */
  private ints(...v: string[]) {
    return v.every(isInt) ? v.map(Number) : null;
  }

  @Get("years")
  async years(@Param("clubId") c: string) {
    const clubId = paramInt(c, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.reports.getYears(clubId));
  }

  @Get("months/:yearId")
  async months(@Param("clubId") c: string, @Param("yearId") y: string) {
    const clubId = paramInt(c, "clubId");
    const n = this.ints(y);
    if (!n) return notFound();
    return (await this.blocked(clubId)) ?? ok(await this.reports.getMonths(clubId, n[0]));
  }

  @Get("detail/:yearId/:month")
  async detail(@Param("clubId") c: string, @Param("yearId") y: string, @Param("month") m: string) {
    const clubId = paramInt(c, "clubId");
    const n = this.ints(y, m);
    if (!n) return notFound();
    // Ok(null) is a 204, as in .NET.
    return (await this.blocked(clubId)) ?? ok(await this.reports.getReport(clubId, n[0], n[1]));
  }

  @Post("init/:yearId/:month")
  async init(@Param("clubId") c: string, @Param("yearId") y: string, @Param("month") m: string, @User() u: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    const n = this.ints(y, m);
    if (!n) return notFound();
    return ok({ reportId: await this.reports.createOrGetReport(clubId, n[0], n[1], this.userId(u)) });
  }

  @Get("meetings/:yearId/:month")
  async meetings(@Param("clubId") c: string, @Param("yearId") y: string, @Param("month") m: string) {
    const clubId = paramInt(c, "clubId");
    const n = this.ints(y, m);
    if (!n) return notFound();
    return (await this.blocked(clubId)) ?? ok(await this.reports.getMeetingsForMonth(clubId, n[0], n[1]));
  }

  @Get("projects/:yearId/:month")
  async projects(@Param("clubId") c: string, @Param("yearId") y: string, @Param("month") m: string) {
    const clubId = paramInt(c, "clubId");
    const n = this.ints(y, m);
    if (!n) return notFound();
    return (await this.blocked(clubId)) ?? ok(await this.reports.getProjectsForMonth(clubId, n[0], n[1]));
  }

  @Get("word/:yearId/:month")
  async word(@Param("clubId") c: string, @Param("yearId") y: string, @Param("month") m: string, @User() u: CurrentUser, @Req() req: Request) {
    const clubId = paramInt(c, "clubId");
    const n = this.ints(y, m);
    if (!n) return notFound();
    const block = await this.blocked(clubId);
    if (block) return block;
    try {
      await this.reports.createOrGetReport(clubId, n[0], n[1], this.userId(u));
      const summary = await this.reports.getPreview(clubId, n[0], n[1], this.userId(u));
      const items = await this.reports.getWordProjectsForMonth(clubId, n[0], n[1]);
      const redirect = this.config.get("Media:RedirectBaseUrl") ?? null;
      for (const it of items) for (const ph of it.photos) await loadPhoto(webRootPath(this.config), redirect, ph);
      const mediaBase = redirect && redirect.trim() ? redirect : `${req.protocol}://${req.get("host")}${req.baseUrl ?? ""}`;
      const bytes = await buildWordReport(summary, items, mediaBase);
      const name = `${summary.clubName}_Monthly_Report_${summary.monthName}_${summary.yearLabel}.docx`.replace(/ /g, "_").replace(/\//g, "-");
      return file(bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", name);
    } catch (e) {
      return statusCode(500, { message: `Failed to generate Word report: ${message(e)}`, detail: null });
    }
  }

  @Get("member-stats/:yearId/:month")
  async memberStats(@Param("clubId") c: string, @Param("yearId") y: string, @Param("month") m: string) {
    const clubId = paramInt(c, "clubId");
    const n = this.ints(y, m);
    if (!n) return notFound();
    return (await this.blocked(clubId)) ?? ok(await this.reports.computeMemberInfo(clubId, n[0], n[1]));
  }

  @Put("member-info/:reportId")
  async memberInfo(@Param("clubId") c: string, @Param("reportId") r: string, @Body() body: unknown, @User() u: CurrentUser) {
    paramInt(c, "clubId");
    if (!isInt(r)) return notFound();
    const num = (k: string) => Math.trunc(Number(bodyField(body, k) ?? 0)) || 0;
    const remarks = bodyField(body, "additionalRemarks");
    try {
      await this.reports.saveMemberInfo(
        Number(r),
        { memberCountLastMonth: num("memberCountLastMonth"), membersDeleted: num("membersDeleted"), membersAdded: num("membersAdded"), additionalRemarks: remarks === null || remarks === undefined ? null : String(remarks) },
        this.userId(u),
      );
      return ok({ message: "Member info saved." });
    } catch (e) {
      return statusCode(500, { message: `Failed to save member info: ${message(e)}`, detail: null });
    }
  }

  @Get("preview/:yearId/:month")
  async preview(@Param("clubId") c: string, @Param("yearId") y: string, @Param("month") m: string, @User() u: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    const n = this.ints(y, m);
    if (!n) return notFound();
    const block = await this.blocked(clubId);
    if (block) return block;
    try {
      return ok(await this.reports.getPreview(clubId, n[0], n[1], this.userId(u)));
    } catch (e) {
      return statusCode(500, { message: `Failed to load preview: ${message(e)}`, detail: null });
    }
  }

  @Post("upload-to-district/:reportId")
  async upload(@Param("clubId") c: string, @Param("reportId") r: string, @User() u: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    if (!isInt(r)) return notFound();
    const reportId = Number(r);
    await this.reports.uploadToDistrict(reportId, this.userId(u));
    void this.mailer.sendSubmissionEmails(clubId, reportId, this.userId(u)).catch((e) => this.log.error(message(e)));
    return ok({ message: "Report uploaded to district. The report PDF is being emailed to the DG, AG, President and Secretary." });
  }

  @Post("send-report-email")
  async sendReportEmail(@Param("clubId") c: string, @Body() body: unknown) {
    const clubId = paramInt(c, "clubId");
    const s = (k: string) => String(bodyField(body, k) ?? "");
    try {
      return ok(
        await this.reports.sendReportEmail(clubId, {
          pdfBase64: s("pdfBase64"), yearId: Math.trunc(Number(bodyField(body, "yearId") ?? 0)) || 0, monthName: s("monthName"), clubName: s("clubName"), yearLabel: s("yearLabel"),
        }),
      );
    } catch (e) {
      return statusCode(500, { message: `Failed to send report email: ${message(e)}`, detail: null });
    }
  }
}

// ---- TRF contributions ----

const str = { type: "string" as const, default: () => "" };
export const TrfFundDto = defineDto({ Id: "int", FundName: str, SortOrder: "int", IsActive: "bool" });
export const TrfContributionDto = defineDto({
  Id: "int", ClubId: "int", YearId: "int", TrfDate: "datetime", DonorName: str, AmountUSD: "decimal", FundId: "int", FundType: str, OtherFundName: "string",
});
const CONTRIBUTION_SELECT = `SELECT pk_trf_id AS Id, fk_club_id AS ClubId, fk_year_id AS YearId, TrfDate, DonorName, AmountUSD, fk_fund_id AS FundId, FundType, OtherFundName
  FROM trf_contributions`;

/**
 * Port of TrfContributionsController.cs / TrfContributionService.cs:
 * api/clubs/{clubId}/trf. The fund settings check a "roleName" claim the
 * tokens never carry, so they always answer 403, as in RIZones.
 */
@Controller("api/clubs/:clubId/trf")
@Authorize()
export class TrfContributionsController {
  constructor(private readonly db: Db) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);
  private isSuperAdminByRoleName = (u: CurrentUser) => (u.findFirst("roleName") ?? "") === "SuperAdmin";
  private async blocked(clubId: number) {
    return !(await isClubDrillReachable(this.db, clubId)) ? statusCode(403, { message: CLUB_BLOCKED_MESSAGE }) : null;
  }
  private static body(body: unknown) {
    const other = bodyField(body, "otherFundName");
    return {
      // Non-nullable DateTime: a missing value binds as DateTime.MinValue.
      trfDate: dbDateTime(bodyField(body, "trfDate")) ?? "0001-01-01 00:00:00", donorName: String(bodyField(body, "donorName") ?? ""), amountUSD: Number(bodyField(body, "amountUSD") ?? 0),
      fundId: Math.trunc(Number(bodyField(body, "fundId") ?? 0)) || 0, otherFundName: other === null || other === undefined ? null : String(other),
    };
  }
  private fundName(fundId: number) {
    return this.db.executeScalar<string>("SELECT FundName FROM trf_fund_master WHERE pk_fund_id = @FundId AND isdeleted = 0", { FundId: fundId }).then((n) => n ?? "");
  }

  @Get("funds")
  async funds(@Param("clubId") c: string) {
    const clubId = paramInt(c, "clubId");
    return (
      (await this.blocked(clubId)) ??
      ok(TrfFundDto.mapAll(await this.db.query("SELECT pk_fund_id AS Id, FundName, SortOrder, IsActive FROM trf_fund_master WHERE isdeleted = 0 AND IsActive = 1 ORDER BY SortOrder, pk_fund_id")))
    );
  }

  @Post("settings/funds")
  async createFund(@Param("clubId") c: string, @Body() body: unknown, @User() u: CurrentUser) {
    paramInt(c, "clubId");
    if (!this.isSuperAdminByRoleName(u)) return forbid();
    const name = String(bodyField(body, "fundName") ?? "");
    const sort = Math.trunc(Number(bodyField(body, "sortOrder") ?? 0)) || 0;
    return this.db.session(async (conn) => {
      await conn.execute("INSERT INTO trf_fund_master (FundName, SortOrder, IsActive, isdeleted, created_by, created_date) VALUES (@FundName, @SortOrder, 1, 0, @UserId, NOW())", {
        FundName: name, SortOrder: sort, UserId: this.userId(u),
      });
      return ok({ id: Number(await conn.executeScalar("SELECT LAST_INSERT_ID()")), fundName: name, sortOrder: sort, isActive: true });
    });
  }

  @Put("settings/funds/:fundId")
  async updateFund(@Param("clubId") c: string, @Param("fundId") f: string, @Body() body: unknown, @User() u: CurrentUser) {
    paramInt(c, "clubId");
    const fundId = paramInt(f, "fundId");
    if (!this.isSuperAdminByRoleName(u)) return forbid();
    await this.db.execute(
      "UPDATE trf_fund_master SET FundName = @FundName, SortOrder = @SortOrder, IsActive = @IsActive, modified_by = @UserId, modified_date = NOW() WHERE pk_fund_id = @FundId AND isdeleted = 0",
      { FundId: fundId, FundName: String(bodyField(body, "fundName") ?? ""), SortOrder: Math.trunc(Number(bodyField(body, "sortOrder") ?? 0)) || 0, IsActive: bodyField(body, "isActive") === true ? 1 : 0, UserId: this.userId(u) },
    );
    return ok({ message: "Fund updated successfully." });
  }

  @Delete("settings/funds/:fundId")
  async deleteFund(@Param("clubId") c: string, @Param("fundId") f: string, @User() u: CurrentUser) {
    paramInt(c, "clubId");
    const fundId = paramInt(f, "fundId");
    if (!this.isSuperAdminByRoleName(u)) return forbid();
    await this.db.execute("UPDATE trf_fund_master SET isdeleted = 1, modified_by = @UserId, modified_date = NOW() WHERE pk_fund_id = @FundId", { FundId: fundId, UserId: this.userId(u) });
    return ok({ message: "Fund deleted successfully." });
  }

  @Get()
  async list(@Param("clubId") c: string, @Query("yearId") y?: string) {
    const clubId = paramInt(c, "clubId");
    const yearId = queryInt(y, 0);
    return (
      (await this.blocked(clubId)) ??
      ok(TrfContributionDto.mapAll(await this.db.query(`${CONTRIBUTION_SELECT} WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0 ORDER BY TrfDate DESC`, { ClubId: clubId, YearId: yearId })))
    );
  }

  @Get("year-total")
  async yearTotal(@Param("clubId") c: string, @Query("yearId") y?: string) {
    const clubId = paramInt(c, "clubId");
    const yearId = queryInt(y, 0);
    const block = await this.blocked(clubId);
    if (block) return block;
    return ok({ total: Number((await this.db.executeScalar("SELECT SUM(AmountUSD) FROM trf_contributions WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0", { ClubId: clubId, YearId: yearId })) ?? 0) });
  }

  @Get("month-total")
  async monthTotal(@Param("clubId") c: string, @Query("yearId") y?: string, @Query("month") m?: string) {
    const clubId = paramInt(c, "clubId");
    const [yearId, month] = [queryInt(y, 0), queryInt(m, 0)];
    const block = await this.blocked(clubId);
    if (block) return block;
    return ok({
      total: Number(
        (await this.db.executeScalar("SELECT SUM(AmountUSD) FROM trf_contributions WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND MONTH(TrfDate) = @Month AND isdeleted = 0", {
          ClubId: clubId, YearId: yearId, Month: month,
        })) ?? 0,
      ),
    });
  }

  @Get("by-month")
  async byMonth(@Param("clubId") c: string, @Query("yearId") y?: string, @Query("month") m?: string) {
    const clubId = paramInt(c, "clubId");
    const [yearId, month] = [queryInt(y, 0), queryInt(m, 0)];
    return (
      (await this.blocked(clubId)) ??
      ok(TrfContributionDto.mapAll(await this.db.query(`${CONTRIBUTION_SELECT} WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND MONTH(TrfDate) = @Month AND isdeleted = 0 ORDER BY TrfDate`, { ClubId: clubId, YearId: yearId, Month: month })))
    );
  }

  @Post()
  async create(@Param("clubId") c: string, @Body() body: unknown, @User() u: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    const d = TrfContributionsController.body(body);
    const yearId = Math.trunc(Number(bodyField(body, "yearId") ?? 0)) || 0;
    const fundType = await this.fundName(d.fundId);
    return this.db.session(async (conn) => {
      await conn.execute(
        `INSERT INTO trf_contributions (fk_club_id, fk_year_id, TrfDate, DonorName, AmountUSD, fk_fund_id, FundType, OtherFundName, created_by, created_date, isdeleted)
         VALUES (@ClubId, @YearId, @TrfDate, @DonorName, @AmountUSD, @FundId, @FundType, @OtherFundName, @UserId, NOW(), 0)`,
        { ClubId: clubId, YearId: yearId, TrfDate: d.trfDate, DonorName: d.donorName, AmountUSD: d.amountUSD, FundId: d.fundId, FundType: fundType, OtherFundName: d.otherFundName, UserId: this.userId(u) },
      );
      const id = Number(await conn.executeScalar("SELECT LAST_INSERT_ID()"));
      return ok(TrfContributionDto.map({ Id: id, ClubId: clubId, YearId: yearId, TrfDate: d.trfDate?.replace(" ", "T") ?? null, DonorName: d.donorName, AmountUSD: d.amountUSD, FundId: d.fundId, FundType: fundType, OtherFundName: d.otherFundName }));
    });
  }

  @Put(":trfId")
  async update(@Param("clubId") c: string, @Param("trfId") t: string, @Body() body: unknown, @User() u: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    const trfId = paramInt(t, "trfId");
    const d = TrfContributionsController.body(body);
    const fundType = await this.fundName(d.fundId);
    await this.db.execute(
      `UPDATE trf_contributions SET TrfDate = @TrfDate, DonorName = @DonorName, AmountUSD = @AmountUSD, fk_fund_id = @FundId, FundType = @FundType,
           OtherFundName = @OtherFundName, modified_by = @UserId, modified_date = NOW()
       WHERE pk_trf_id = @TrfId AND fk_club_id = @ClubId AND isdeleted = 0`,
      { TrfId: trfId, ClubId: clubId, TrfDate: d.trfDate, DonorName: d.donorName, AmountUSD: d.amountUSD, FundId: d.fundId, FundType: fundType, OtherFundName: d.otherFundName, UserId: this.userId(u) },
    );
    // As in RIZones the response leaves YearId at 0.
    return ok(TrfContributionDto.map({ Id: trfId, ClubId: clubId, YearId: 0, TrfDate: d.trfDate?.replace(" ", "T") ?? null, DonorName: d.donorName, AmountUSD: d.amountUSD, FundId: d.fundId, FundType: fundType, OtherFundName: d.otherFundName }));
  }

  @Delete(":trfId")
  async remove(@Param("clubId") c: string, @Param("trfId") t: string, @User() u: CurrentUser) {
    paramInt(c, "clubId");
    await this.db.execute("UPDATE trf_contributions SET isdeleted = 1, deleted_by = @UserId, deleted_date = NOW() WHERE pk_trf_id = @TrfId", { TrfId: paramInt(t, "trfId"), UserId: this.userId(u) });
    return ok({ message: "Contribution deleted successfully." });
  }
}
