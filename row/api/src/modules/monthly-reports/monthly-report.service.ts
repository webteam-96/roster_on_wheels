import { Injectable, Logger } from "@nestjs/common";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { defineDto } from "../../common/dto";

import { dotnetRound } from "../../common/dotnet-format";
import { Brand } from "../../brand/brand";
import { YearTableResolver } from "../../services/year-table.resolver";
import { EmailService, emailFooter, emailHeader } from "../../services/email.service";
import { CitationRecalcTrigger } from "../../services/citation-recalc.trigger";

const str = { type: "string" as const, default: () => "" };
const list = { type: "object" as const, default: () => [] };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const AVENUE_KEYS = ["community_service", "vocational_service", "international_service", "new_generation_service", "public_image_initiative"];
const CMR_MODULE_KEYS = ["club_service", ...AVENUE_KEYS];

/** DTOs/ClubMonthlyReportDtos.cs */
export const MonthlyReportListDto = defineDto({
  ReportId: "int?", Month: "int", MonthName: str, IsCreated: "bool", CreatedDate: "datetime?", ModifiedDate: "datetime?", IsUploadedToDistrict: "bool",
});
export const TrfEntryDto = defineDto({ TrfId: "int", TrfDate: "datetime", DonorName: str, AmountUSD: "decimal", FundType: str, OtherFundName: "string" });
export const MonthlyReportDetailDto = defineDto({
  ReportId: "int", ClubId: "int", YearId: "int", ReportMonth: "int", MemberCountLastMonth: "int", MembersDeleted: "int", MembersAdded: "int",
  CurrentMemberCount: "int", AdditionalRemarks: "string", IsUploadedToDistrict: "bool", AssistantGovernor: "string", CreatedDate: "datetime?",
  ModifiedDate: "datetime?", TrfEntries: list,
});
export const ReportMeetingDto = defineDto({ ProjectId: "int", Title: str, MeetingType: "string", ProjectDate: "string", Attendance: "int?", AttendancePercentage: "decimal?" });
export const ReportProjectDto = defineDto({
  ProjectId: "int", Title: str, ProjectType: "string", ParentProjectId: "int?", ProjectDate: "string", AreaOfFocusName: "string", CategoryName: "string",
  SubCategoryName: "string", ProjectCost: "decimal?", DirectBeneficiaries: "int?", ManHours: "int?", RotariansInvolved: "int?", RotaractorsInvolved: "int?",
  RccInvolved: "int?",
});
export const ReportYearDto = defineDto({ Id: "int", YearLabel: str, IsCurrent: "bool" });
export const CmrWordPhotoDto = defineDto({ ProjectId: "int", ImagePath: str, Description: "string", IsPrimary: "bool", SortOrder: "int" });
export const CmrWordProjectDto = defineDto({
  ProjectId: "int", ModuleKey: str, Title: str, Description: "string", Location: "string", ProjectDate: "string", MeetingType: "string",
  AreaOfFocusName: "string", OtherAreaOfFocus: "string", CategoryName: "string", SubCategoryName: "string", ProjectCost: "decimal?", FundingName: "string",
  DirectBeneficiaries: "int?", ManHours: "int?", RotariansInvolved: "int?", RotaractorsInvolved: "int?", RccInvolved: "int?", Attendance: "int?",
  AttendancePercentage: "decimal?", IsJointProject: "bool", CoHostName: "string", AgendaDocument: "string", MinutesDocument: "string", Photos: list,
});

export interface WordPhoto {
  projectId: number;
  imagePath: string;
  description: string | null;
  isPrimary: boolean;
  sortOrder: number;
  /** Loaded from disk by the document builders (never serialised). */
  imageBytes?: Buffer | null;
  imageExtension?: string | null;
}
export interface WordProject {
  projectId: number; moduleKey: string; title: string; description: string | null; location: string | null; projectDate: string | null;
  meetingType: string | null; areaOfFocusName: string | null; otherAreaOfFocus: string | null; categoryName: string | null; subCategoryName: string | null;
  projectCost: number | null; fundingName: string | null; directBeneficiaries: number | null; manHours: number | null; rotariansInvolved: number | null;
  rotaractorsInvolved: number | null; rccInvolved: number | null; attendance: number | null; attendancePercentage: number | null; isJointProject: boolean;
  coHostName: string | null; agendaDocument: string | null; minutesDocument: string | null; photos: WordPhoto[];
}
export interface ReportPreview {
  reportId: number; clubId: number; clubName: string; clubCode: string | null; yearId: number; yearLabel: string; reportMonth: number; monthName: string;
  reportDate: string | null; preparedBy: string | null; designation: string | null; assistantGovernor: string | null; memberCountLastMonth: number;
  membersDeleted: number; membersAdded: number; currentMemberCount: number; totalMeetings: number; averageAttendance: number; trfCurrentMonth: number;
  trfThisYear: number; additionalRemarks: string | null; isUploadedToDistrict: boolean; uploadedToDistrictDate: string | null;
  meetings: Record<string, unknown>[]; trfEntries: Record<string, unknown>[]; projects: Record<string, Record<string, unknown>[]>;
}
interface Snapshot {
  preview: ReportPreview;
  wordProjects: WordProject[];
}

const agNameSql = (alias: string) => `(SELECT mp.MemberName FROM district_ag da
    JOIN member_master_profile mp ON mp.pk_member_master_profile_id = da.fk_member_id AND COALESCE(mp.isdeleted, 0) = 0
    WHERE da.fk_club_id = ${alias}.fk_club_id AND da.fk_year_id = ${alias}.fk_year_id AND da.is_active = 1 AND (da.isdeleted = 0 OR da.isdeleted IS NULL)
    ORDER BY da.id DESC LIMIT 1)`;

/** Port of ClubMonthlyReportService.cs: the Club Monthly Report (CMR), frozen as a snapshot once uploaded to the district. */
@Injectable()
export class MonthlyReportService {
  private readonly log = new Logger("ClubMonthlyReportService");

  constructor(
    private readonly db: Db,
    private readonly yearTables: YearTableResolver,
    private readonly email: EmailService,
    private readonly citation: CitationRecalcTrigger,
  ) {}

  async getYears(clubId: number) {
    return ReportYearDto.mapAll(
      await this.db.query(
        `SELECT DISTINCT y.pk_year_id AS Id, y.YearLabel, y.IsCurrent
         FROM club_monthly_reports r INNER JOIN rotary_year_master y ON y.pk_year_id = r.fk_year_id
         WHERE r.fk_club_id = @ClubId AND r.isdeleted = 0
         UNION
         SELECT y.pk_year_id AS Id, y.YearLabel, y.IsCurrent FROM rotary_year_master y WHERE y.IsCurrent = 1
         ORDER BY Id DESC`,
        { ClubId: clubId },
      ),
    );
  }

  /** One row per month from July up to now (current year) or June (past years). */
  async getMonths(clubId: number, yearId: number) {
    return this.db.session(async (conn) => {
      const year = await conn.queryFirstOrDefault("SELECT StartDate, EndDate, IsCurrent FROM rotary_year_master WHERE pk_year_id = @YearId", { YearId: yearId });
      if (!year) return [];
      const reports = await conn.query(
        "SELECT pk_report_id, ReportMonth, IsUploadedToDistrict, created_date, modified_date FROM club_monthly_reports WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0",
        { ClubId: clubId, YearId: yearId },
      );
      const [sy, sm] = String(year.StartDate).slice(0, 7).split("-").map(Number);
      const now = new Date();
      const isCurrent = year.IsCurrent === true || Number(year.IsCurrent) === 1;
      const [ey, em] = isCurrent ? [now.getUTCFullYear(), now.getUTCMonth() + 1] : String(year.EndDate).slice(0, 7).split("-").map(Number);
      const result = [];
      for (let y = sy, m = sm; y < ey || (y === ey && m <= em); m === 12 ? ((m = 1), y++) : m++) {
        const existing = reports.find((r) => Number(r.ReportMonth) === m);
        result.push(
          MonthlyReportListDto.map({
            ReportId: existing ? existing.pk_report_id : null, Month: m, MonthName: `${MONTHS[m - 1]} ${y}`, IsCreated: !!existing,
            CreatedDate: existing?.created_date ?? null, ModifiedDate: existing?.modified_date ?? null,
            IsUploadedToDistrict: !!existing && (existing.IsUploadedToDistrict === true || Number(existing.IsUploadedToDistrict) === 1),
          }),
        );
      }
      return result;
    });
  }

  async getReport(clubId: number, yearId: number, month: number) {
    const r = await this.db.queryFirstOrDefault(
      `SELECT pk_report_id, fk_club_id, fk_year_id, ReportMonth, MemberCountLastMonth, MembersDeleted, MembersAdded, CurrentMemberCount,
              AdditionalRemarks, IsUploadedToDistrict, created_date, modified_date, ${agNameSql("club_monthly_reports")} AS AssistantGovernorName
       FROM club_monthly_reports
       WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND ReportMonth = @Month AND isdeleted = 0`,
      { ClubId: clubId, YearId: yearId, Month: month },
    );
    if (!r) return null;
    const ag = String(r.AssistantGovernorName ?? "");
    return MonthlyReportDetailDto.map({
      ReportId: r.pk_report_id, ClubId: r.fk_club_id, YearId: r.fk_year_id, ReportMonth: r.ReportMonth, MemberCountLastMonth: r.MemberCountLastMonth,
      MembersDeleted: r.MembersDeleted, MembersAdded: r.MembersAdded, CurrentMemberCount: r.CurrentMemberCount, AdditionalRemarks: r.AdditionalRemarks,
      IsUploadedToDistrict: r.IsUploadedToDistrict, AssistantGovernor: ag.trim() ? ag : "N/A", CreatedDate: r.created_date, ModifiedDate: r.modified_date, TrfEntries: [],
    });
  }

  async createOrGetReport(clubId: number, yearId: number, month: number, createdBy: number): Promise<number> {
    return this.db.session(async (conn) => {
      const existing = await conn.executeScalar(
        "SELECT pk_report_id FROM club_monthly_reports WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND ReportMonth = @Month AND isdeleted = 0",
        { ClubId: clubId, YearId: yearId, Month: month },
      );
      if (existing !== null && existing !== undefined) return Number(existing);
      await conn.execute(
        `INSERT INTO club_monthly_reports (fk_club_id, fk_year_id, ReportMonth, fk_ag_member_id, created_by, created_date)
         VALUES (@ClubId, @YearId, @Month,
                 (SELECT da.fk_member_id FROM district_ag da
                  WHERE da.fk_club_id = @ClubId AND da.fk_year_id = @YearId AND da.is_active = 1 AND (da.isdeleted = 0 OR da.isdeleted IS NULL)
                  ORDER BY da.id DESC LIMIT 1),
                 @CreatedBy, NOW())`,
        { ClubId: clubId, YearId: yearId, Month: month, CreatedBy: createdBy },
      );
      return Number(await conn.executeScalar("SELECT LAST_INSERT_ID()"));
    });
  }

  async saveMemberInfo(reportId: number, d: { memberCountLastMonth: number; membersDeleted: number; membersAdded: number; additionalRemarks: string | null }, by: number) {
    await this.db.execute(
      `UPDATE club_monthly_reports SET MemberCountLastMonth = @MemberCountLastMonth, MembersDeleted = @MembersDeleted, MembersAdded = @MembersAdded,
           CurrentMemberCount = @CurrentMemberCount, AdditionalRemarks = @AdditionalRemarks, modified_by = @ModifiedBy, modified_date = NOW()
       WHERE pk_report_id = @ReportId`,
      {
        ReportId: reportId, MemberCountLastMonth: d.memberCountLastMonth, MembersDeleted: d.membersDeleted, MembersAdded: d.membersAdded,
        CurrentMemberCount: d.memberCountLastMonth - d.membersDeleted + d.membersAdded, AdditionalRemarks: d.additionalRemarks, ModifiedBy: by,
      },
    );
  }

  /** Members at the start of the month, removed and added during it (honorary members excluded). */
  async computeMemberInfo(clubId: number, yearId: number, month: number) {
    return this.db.session(async (conn) => {
      const start = await conn.executeScalar<string>("SELECT StartDate FROM rotary_year_master WHERE pk_year_id = @YearId LIMIT 1", { YearId: yearId });
      if (!start) return { memberCountLastMonth: 0, membersDeleted: 0, membersAdded: 0, currentMemberCount: 0 };
      const [sy, sm] = String(start).slice(0, 7).split("-").map(Number);
      const calYear = month >= sm ? sy : sy + 1;
      const monthStart = `${calYear}-${String(month).padStart(2, "0")}-01 00:00:00`;
      const next = month === 12 ? `${calYear + 1}-01-01 00:00:00` : `${calYear}-${String(month + 1).padStart(2, "0")}-01 00:00:00`;
      const removed = "CASE WHEN (cm.isdeleted = 1 OR cm.IsActive = 0) THEN COALESCE(cm.TerminationDate, cm.deleted_date, cm.modified_date) ELSE NULL END";
      const row = await conn.queryFirstOrDefault(
        `SELECT
           COUNT(DISTINCT CASE WHEN cm.JoinedDate IS NOT NULL AND cm.JoinedDate < @MonthStart AND (${removed} IS NULL OR ${removed} >= @MonthStart)
                               THEN cm.fk_member_master_profile_id END) AS lastMonth,
           COUNT(DISTINCT CASE WHEN ${removed} >= @MonthStart AND ${removed} < @MonthEnd THEN cm.fk_member_master_profile_id END) AS deleted,
           COUNT(DISTINCT CASE WHEN cm.JoinedDate >= @MonthStart AND cm.JoinedDate < @MonthEnd THEN cm.fk_member_master_profile_id END) AS added
         FROM club_members cm
         JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
         WHERE cm.fk_club_id = @ClubId AND COALESCE(cm.IsHonoraryMember, 0) = 0`,
        { ClubId: clubId, MonthStart: monthStart, MonthEnd: next },
      );
      const [last, del, add] = [Number(row?.lastMonth ?? 0), Number(row?.deleted ?? 0), Number(row?.added ?? 0)];
      return { memberCountLastMonth: last, membersDeleted: del, membersAdded: add, currentMemberCount: last - del + add };
    });
  }

  async getMeetingsForMonth(clubId: number, yearId: number, month: number, conn: DbCommands = this.db) {
    const info = await this.yearTables.resolveByYearId(conn, yearId);
    if (!info) return [];
    return ReportMeetingDto.mapAll(
      await conn.query(
        `SELECT p.pk_project_id AS ProjectId, p.title AS Title, p.meeting_type AS MeetingType, DATE_FORMAT(p.project_date, '%Y-%m-%d') AS ProjectDate,
                p.attendance AS Attendance, p.attendance_percentage AS AttendancePercentage
         FROM \`${info.projectsTable}\` p INNER JOIN module_master m ON m.pk_module_id = p.fk_module_id
         WHERE p.fk_club_id = @ClubId AND m.ModuleKey = 'club_service' AND MONTH(p.project_date) = @Month AND p.isdeleted = 0
         ORDER BY p.project_date`,
        { ClubId: clubId, Month: month },
      ),
    );
  }

  async getProjectsForMonth(clubId: number, yearId: number, month: number, conn: DbCommands = this.db) {
    const info = await this.yearTables.resolveByYearId(conn, yearId);
    const result: Record<string, Record<string, unknown>[]> = {};
    for (const key of AVENUE_KEYS) {
      result[key] = info
        ? ReportProjectDto.mapAll(
            await conn.query(
              `SELECT p.pk_project_id AS ProjectId, p.title AS Title, p.project_type AS ProjectType, p.parent_project_id AS ParentProjectId,
                      DATE_FORMAT(p.project_date, '%Y-%m-%d') AS ProjectDate, aof.name AS AreaOfFocusName, c.name AS CategoryName, sc.name AS SubCategoryName,
                      p.project_cost AS ProjectCost, p.direct_beneficiaries AS DirectBeneficiaries, p.man_hours AS ManHours, p.rotarians_involved AS RotariansInvolved,
                      p.rotaractors_involved AS RotaractorsInvolved, COALESCE(p.rcc_involved,0) AS RccInvolved
               FROM \`${info.projectsTable}\` p
               INNER JOIN module_master m ON m.pk_module_id = p.fk_module_id
               LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
               LEFT JOIN category_master c ON c.pk_category_id = p.fk_category_id
               LEFT JOIN sub_category_master sc ON sc.pk_sub_category_id = p.fk_sub_category_id
               WHERE p.fk_club_id = @ClubId AND m.ModuleKey = @ModuleKey AND MONTH(p.project_date) = @Month AND p.isdeleted = 0
               ORDER BY p.project_date`,
              { ClubId: clubId, ModuleKey: key, Month: month },
            ),
          )
        : [];
    }
    return result;
  }

  /** The project rows the Word / PDF builders print; the frozen copy once the report is uploaded. */
  async getWordProjectsForMonth(clubId: number, yearId: number, month: number): Promise<WordProject[]> {
    const state = await this.snapshotState(clubId, yearId, month);
    if (state.uploaded) {
      const snap = MonthlyReportService.parseSnapshot(state.json);
      if (snap?.wordProjects) return snap.wordProjects;
      return (await this.captureSnapshot(clubId, yearId, month, state.reportId, 0)).wordProjects;
    }
    return this.wordProjectsCore(clubId, yearId, month);
  }

  getWordProjectsForYear(clubId: number, yearId: number) {
    return this.wordProjectsCore(clubId, yearId, null);
  }

  private async wordProjectsCore(clubId: number, yearId: number, month: number | null): Promise<WordProject[]> {
    return this.db.session(async (conn) => {
      const info = await this.yearTables.resolveByYearId(conn, yearId);
      if (!info) return [];
      const suffix = info.yearLabel.replace(/-/g, "_");
      const monthClause = month !== null ? "AND MONTH(p.project_date) = @Month" : "";
      const p = { ClubId: clubId, Keys: CMR_MODULE_KEYS, Month: month ?? 0 };
      const projects = CmrWordProjectDto.mapAll(
        await conn.query(
          `SELECT p.pk_project_id AS ProjectId, m.ModuleKey AS ModuleKey, p.title AS Title, p.description AS Description, p.location AS Location,
                  DATE_FORMAT(p.project_date, '%Y-%m-%d') AS ProjectDate, p.meeting_type AS MeetingType, aof.name AS AreaOfFocusName,
                  p.other_area_of_focus AS OtherAreaOfFocus, c.name AS CategoryName, sc.name AS SubCategoryName, p.project_cost AS ProjectCost,
                  f.name AS FundingName, p.direct_beneficiaries AS DirectBeneficiaries, p.man_hours AS ManHours, p.rotarians_involved AS RotariansInvolved,
                  p.rotaractors_involved AS RotaractorsInvolved, COALESCE(p.rcc_involved,0) AS RccInvolved, p.attendance AS Attendance,
                  p.attendance_percentage AS AttendancePercentage, p.is_joint_project AS IsJointProject, p.co_host_name AS CoHostName,
                  p.agenda_document AS AgendaDocument, p.minutes_document AS MinutesDocument
           FROM \`${info.projectsTable}\` p
           INNER JOIN module_master m ON m.pk_module_id = p.fk_module_id
           LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
           LEFT JOIN category_master c ON c.pk_category_id = p.fk_category_id
           LEFT JOIN sub_category_master sc ON sc.pk_sub_category_id = p.fk_sub_category_id
           LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
           WHERE p.fk_club_id = @ClubId AND m.ModuleKey IN @Keys ${monthClause} AND p.isdeleted = 0
           ORDER BY FIELD(m.ModuleKey, 'club_service','community_service','vocational_service','international_service','new_generation_service','public_image_initiative'),
                    p.project_date, p.pk_project_id`,
          p,
        ),
      ) as unknown as WordProject[];
      if (!projects.length) return projects;
      const photos = CmrWordPhotoDto.mapAll(
        await conn.query(
          `SELECT pp.fk_project_id AS ProjectId,
                  CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                         CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk) ELSE CONCAT('${suffix}/Album', p.pk_project_id) END, '/', pp.image_path) AS ImagePath,
                  pp.description AS Description, pp.is_primary AS IsPrimary, pp.sort_order AS SortOrder
           FROM \`${info.photosTable}\` pp
           INNER JOIN \`${info.projectsTable}\` p ON p.pk_project_id = pp.fk_project_id
           INNER JOIN module_master m ON m.pk_module_id = p.fk_module_id
           WHERE p.fk_club_id = @ClubId AND m.ModuleKey IN @Keys ${monthClause} AND p.isdeleted = 0
           ORDER BY pp.fk_project_id, pp.is_primary DESC, pp.sort_order`,
          p,
        ),
      ) as unknown as WordPhoto[];
      for (const pr of projects) pr.photos = photos.filter((ph) => ph.projectId === pr.projectId);
      return projects;
    });
  }

  async getPreview(clubId: number, yearId: number, month: number, requestedBy: number): Promise<ReportPreview> {
    const state = await this.snapshotState(clubId, yearId, month);
    if (state.uploaded) {
      const snap = MonthlyReportService.parseSnapshot(state.json);
      if (snap?.preview) return snap.preview;
      return (await this.captureSnapshot(clubId, yearId, month, state.reportId, requestedBy)).preview;
    }
    return this.buildPreviewLive(clubId, yearId, month, requestedBy);
  }

  private async buildPreviewLive(clubId: number, yearId: number, month: number, requestedBy: number): Promise<ReportPreview> {
    return this.db.session(async (conn) => {
      const report = await conn.queryFirstOrDefault(
        `SELECT r.pk_report_id, r.MemberCountLastMonth, r.MembersDeleted, r.MembersAdded, r.CurrentMemberCount, r.AdditionalRemarks, r.IsUploadedToDistrict,
                r.uploaded_to_district_date, r.created_date, r.modified_date, r.created_by, r.modified_by, cm.ClubName, cm.ClubRotaryId AS ClubCode,
                y.YearLabel, y.pk_year_id, ${agNameSql("r")} AS AssistantGovernorName
         FROM club_monthly_reports r
         INNER JOIN club_master cm ON cm.pk_club_id = r.fk_club_id
         INNER JOIN rotary_year_master y ON y.pk_year_id = r.fk_year_id
         WHERE r.fk_club_id = @ClubId AND r.fk_year_id = @YearId AND r.ReportMonth = @Month AND r.isdeleted = 0`,
        { ClubId: clubId, YearId: yearId, Month: month },
      );
      if (!report) throw new Error(`Report not found for club=${clubId}, year=${yearId}, month=${month}`);
      let preparedBy = "";
      let designation = "Rotarian";
      const uploader = report.modified_by ?? report.created_by ?? requestedBy;
      const member = await conn.queryFirstOrDefault(
        `SELECT m.MemberName AS MemberName,
                (SELECT d.designation_name FROM board_of_directors bod JOIN designation_master d ON d.pk_designation_id = bod.fk_designation_id
                 WHERE bod.fk_member_master_profile_id = m.pk_member_master_profile_id AND bod.fk_club_id = @ClubId AND bod.fk_year_id = @YearId AND bod.isdeleted = 0
                 ORDER BY d.pk_designation_id LIMIT 1) AS BodDesignation
         FROM member_master_profile m WHERE m.pk_member_master_profile_id = @Id`,
        { Id: uploader, ClubId: clubId, YearId: yearId },
      );
      if (member) {
        preparedBy = String(member.MemberName ?? "");
        if (member.BodDesignation && String(member.BodDesignation).trim()) designation = String(member.BodDesignation).trim();
      }
      const meetings = await this.getMeetingsForMonth(clubId, yearId, month, conn);
      const withAttendance = meetings.filter((m) => m.attendancePercentage !== null && m.attendancePercentage !== undefined);
      const avgAttendance = withAttendance.length ? withAttendance.reduce((s, m) => s + Number(m.attendancePercentage), 0) / withAttendance.length : 0;
      const trfEntries = TrfEntryDto.mapAll(
        await conn.query(
          `SELECT pk_trf_id AS TrfId, TrfDate, DonorName, AmountUSD, FundType, OtherFundName FROM trf_contributions
           WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND MONTH(TrfDate) = @Month AND isdeleted = 0 ORDER BY TrfDate`,
          { ClubId: clubId, YearId: yearId, Month: month },
        ),
      );
      const trfYear = Number((await conn.executeScalar("SELECT SUM(AmountUSD) FROM trf_contributions WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0", { ClubId: clubId, YearId: yearId })) ?? 0);
      const projects = await this.getProjectsForMonth(clubId, yearId, month, conn);
      const ag = String(report.AssistantGovernorName ?? "");
      return {
        reportId: Number(report.pk_report_id), clubId, clubName: String(report.ClubName ?? ""), clubCode: report.ClubCode ?? null, yearId,
        yearLabel: String(report.YearLabel ?? ""), reportMonth: month, monthName: MONTHS[month - 1], reportDate: report.modified_date ?? report.created_date ?? null,
        preparedBy, designation, assistantGovernor: ag.trim() ? ag : "N/A", memberCountLastMonth: Number(report.MemberCountLastMonth ?? 0),
        membersDeleted: Number(report.MembersDeleted ?? 0), membersAdded: Number(report.MembersAdded ?? 0), currentMemberCount: Number(report.CurrentMemberCount ?? 0),
        totalMeetings: meetings.length, averageAttendance: dotnetRound(avgAttendance, 2), trfCurrentMonth: trfEntries.reduce((s, e) => s + Number(e.amountUSD ?? 0), 0),
        trfThisYear: trfYear, additionalRemarks: report.AdditionalRemarks ?? null,
        isUploadedToDistrict: report.IsUploadedToDistrict === true || Number(report.IsUploadedToDistrict) === 1, uploadedToDistrictDate: report.uploaded_to_district_date ?? null,
        meetings, trfEntries, projects,
      };
    });
  }

  async uploadToDistrict(reportId: number, by: number) {
    const meta = await this.db.session(async (conn) => {
      await conn.execute("UPDATE club_monthly_reports SET IsUploadedToDistrict = 1, uploaded_to_district_date = NOW(), modified_by = @ModifiedBy, modified_date = NOW() WHERE pk_report_id = @ReportId", {
        ReportId: reportId, ModifiedBy: by,
      });
      return conn.queryFirstOrDefault("SELECT fk_club_id AS ClubId, fk_year_id AS YearId, ReportMonth AS Month FROM club_monthly_reports WHERE pk_report_id = @Id", { Id: reportId });
    });
    const clubId = Number(meta?.ClubId ?? 0);
    if (clubId > 0) {
      try {
        // Freeze what was submitted: later edits to projects or TRF no longer change this report.
        await this.captureSnapshot(clubId, Number(meta!.YearId), Number(meta!.Month), reportId, by);
      } catch (e) {
        this.log.error(`CMR freeze-snapshot capture failed for report ${reportId}: ${(e as Error).message}`);
      }
      this.citation.triggerForClub(clubId);
    }
  }

  private async snapshotState(clubId: number, yearId: number, month: number) {
    const row = await this.db.queryFirstOrDefault(
      `SELECT pk_report_id AS ReportId, COALESCE(IsUploadedToDistrict, 0) AS Uploaded, report_snapshot_json AS Json
       FROM club_monthly_reports WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND ReportMonth = @Month AND isdeleted = 0`,
      { ClubId: clubId, YearId: yearId, Month: month },
    );
    if (!row) return { uploaded: false, json: null as string | null, reportId: 0 };
    return { uploaded: row.Uploaded === true || Number(row.Uploaded) === 1, json: (row.Json as string | null) ?? null, reportId: Number(row.ReportId) };
  }

  private async captureSnapshot(clubId: number, yearId: number, month: number, reportId: number, requestedBy: number): Promise<Snapshot> {
    const snap: Snapshot = { preview: await this.buildPreviewLive(clubId, yearId, month, requestedBy), wordProjects: await this.wordProjectsCore(clubId, yearId, month) };
    await this.db.execute("UPDATE club_monthly_reports SET report_snapshot_json = @Json, snapshot_captured_date = NOW() WHERE pk_report_id = @Id", { Json: JSON.stringify(snap), Id: reportId });
    return snap;
  }

  private static parseSnapshot(json: string | null): Snapshot | null {
    if (!json || !json.trim()) return null;
    try {
      const s = JSON.parse(json);
      return s && typeof s === "object" ? (s as Snapshot) : null;
    } catch {
      return null; // corrupt or legacy JSON: recapture
    }
  }

  /** The PDF the web built, emailed to the club President and Secretary. */
  async sendReportEmail(clubId: number, d: { pdfBase64: string; yearId: number; monthName: string; clubName: string; yearLabel: string }) {
    const result = { sentTo: [] as string[], warnings: [] as string[] };
    const pdf = Buffer.from(d.pdfBase64, "base64");
    const fileName = `${d.clubName}_Monthly_Report_${d.monthName}_${d.yearLabel}.pdf`.replace(/ /g, "_");
    const bod = await this.db.query(
      `SELECT m.MemberName, m.EmailId, d.designation_name AS DesignationName
       FROM board_of_directors bod
       INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id
       INNER JOIN designation_master d ON d.pk_designation_id = bod.fk_designation_id
       WHERE bod.fk_club_id = @ClubId AND bod.fk_year_id = @YearId AND bod.isdeleted = 0 AND d.designation_name IN ('Club President', 'Club Secretary')`,
      { ClubId: clubId, YearId: d.yearId },
    );
    const president = bod.find((b) => b.DesignationName === "Club President");
    const secretary = bod.find((b) => b.DesignationName === "Club Secretary");
    if (!president) result.warnings.push("Club President not found in Board of Directors for this year.");
    if (!secretary) result.warnings.push("Club Secretary not found in Board of Directors for this year.");
    result.warnings.push("District Governor and Assistant Governor emails not configured yet.");
    const subject = `Club monthly report Submitted successfully - ${d.clubName} - ${d.monthName} ${d.yearLabel}`;
    const body = `
            ${emailHeader()}
                        <p style='font-style: italic; font-size: 15px; margin-bottom: 20px;'><strong>Dear Rtn,</strong></p>
                        <p style='font-size: 14px; line-height: 1.8;'>
                            The club monthly report for <strong>${d.clubName}</strong> for the month of <strong>${d.monthName} ${d.yearLabel}</strong> is uploaded successfully.
                        </p>
                        <p style='font-size: 14px; line-height: 1.8; font-style: italic;'>The copy of the report is attached.</p>
                        <p style='font-size: 14px; line-height: 1.8; font-style: italic;'>This is an autogenerated Email from ${Brand.Current.productName.replace(/&/g, "&amp;")}.</p>
            ${emailFooter()}`;
    const recipients: [string, string, string][] = [];
    for (const [who, role] of [[president, "Club President"], [secretary, "Club Secretary"]] as [Row | undefined, string][]) {
      if (who && who.EmailId && String(who.EmailId).trim()) recipients.push([String(who.MemberName), String(who.EmailId), role]);
      else if (who) result.warnings.push(`${role} does not have an email address.`);
    }
    for (const [name, to, role] of recipients) {
      try {
        await this.email.sendEmailWithAttachment(to, subject, body, pdf, fileName);
        result.sentTo.push(`${role}: ${name} (${to})`);
      } catch (e) {
        this.log.error(`Failed to send report email to ${role}: ${to}: ${(e as Error).message}`);
        result.warnings.push(`Failed to send email to ${role}: ${name} (${to})`);
      }
    }
    if (!recipients.length && !bod.length) result.warnings.push("No recipients found. Email not sent.");
    return result;
  }
}


