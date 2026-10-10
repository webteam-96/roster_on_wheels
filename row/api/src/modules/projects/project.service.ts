import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { Db, type DbCommands } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { defineDto } from "../../common/dto";
import { bodyField } from "../../common/binding";
import { pagedResult } from "../../common/paged";
import { InvalidOperationException } from "../../common/exceptions";
import { webRootPath, type UploadedFile } from "../../services/media-storage";
import { YearTableResolver, ensureRotaryYear, type YearTableInfo } from "../../services/year-table.resolver";
import { CreditManagementService } from "../../services/credit-management.service";
import { CitationRecalcTrigger } from "../../services/citation-recalc.trigger";
import { normalizeCurrency, resolveDefaultCurrency } from "../../services/currency.helper";
import { throwIfInvalidProjectDate, tryParseDate } from "../../services/project-date.validator";
import { ProjectApprovalService } from "./project-approval.service";

const str = { type: "string" as const, default: () => "" };
const currency = { type: "string" as const, default: () => resolveDefaultCurrency(null) };

/** DTOs/ProjectDtos.cs */
export const ProjectListDto = defineDto({
  Id: "int", ClubId: "int", ModuleId: "int", YearId: "int", YearLabel: str, ProjectType: str, ParentProjectId: "int?", OngoingGroupTitle: "string",
  IsJointProject: "bool", CoHostName: "string", ClubRole: "string", Title: str, Location: "string", AreaOfFocusName: "string", OtherAreaOfFocus: "string",
  CategoryName: "string", OtherCategory: "string", SubCategoryName: "string", OtherSubCategory: "string", ProjectDate: "datetime?", ProjectCost: "decimal?",
  Currency: currency, FundingName: "string", DirectBeneficiaries: "int?", MeetingType: "string", Attendance: "int?", AttendancePercentage: "decimal?",
  IsActive: "bool", ApprovalStatus: "string", PrimaryPhotoPath: "string", IsSendWhatsapp: "bool", IsSendEmail: "bool", WhatsAppSentDate: "datetime?",
  WhatsAppSentCount: "int", WhatsAppFailedCount: "int", EmailSentDate: "datetime?", EmailSentCount: "int", EmailFailedCount: "int",
});
export const ProjectPhotoDto = defineDto({ Id: "int", ProjectId: "int", ImagePath: str, Description: "string", IsPrimary: "bool", SortOrder: "int" });
export const ProjectDetailDto = defineDto({
  Id: "int", ClubId: "int", ModuleId: "int", YearId: "int", YearLabel: str, ProjectType: str, ParentProjectId: "int?", OngoingGroupTitle: "string",
  IsJointProject: "bool", CoHostName: "string", ClubRole: "string", Title: str, Description: "string", Location: "string", AreaOfFocusId: "int?",
  AreaOfFocusName: "string", OtherAreaOfFocus: "string", CategoryId: "int?", CategoryName: "string", OtherCategory: "string", SubCategoryId: "int?",
  SubCategoryName: "string", OtherSubCategory: "string", ProjectDate: "datetime?", ProjectCost: "decimal?", Currency: currency, FundingId: "int?",
  FundingName: "string", DirectBeneficiaries: "int?", ManHours: "int?", RotariansInvolved: "int?", RotaractorsInvolved: "int?", RccInvolved: "int?",
  SendWhatsapp: "bool", SendEmail: "bool", MeetingType: "string", AgendaDocument: "string", MinutesDocument: "string", Attendance: "int?",
  AttendancePercentage: "decimal?", GlobalGrantNumber: "string", AmountSanctioned: "decimal?", AmountReceived: "decimal?", AmountSpent: "decimal?",
  HostClubsDistricts: "string", GlobalPartnerClubsDistricts: "string", CsrCompanyName: "string", IsActive: "bool", Photos: { type: "object", default: () => [] },
});
export const OngoingProjectDto = defineDto({ Id: "int", Title: str });
export const ProjectPublicDto = defineDto({
  Id: "int", Title: str, Description: "string", Location: "string", AreaOfFocusName: "string", OtherAreaOfFocus: "string", ProjectDate: "datetime?",
  ProjectCost: "decimal?", DirectBeneficiaries: "int?", PrimaryPhotoPath: "string",
});
export const ProjectYearDto = defineDto({ Id: "int", YearLabel: str, StartDate: "datetime", EndDate: "datetime", IsCurrent: "bool" });

const SaveProjectBody = defineDto({
  ModuleId: "int", ProjectType: { type: "string", default: () => "one_time" }, ParentProjectId: "int?", OngoingGroupTitle: "string", IsJointProject: "bool",
  CoHostName: "string", ClubRole: "string", Title: str, Description: "string", Location: "string", AreaOfFocusId: "int?", OtherAreaOfFocus: "string",
  CategoryId: "int?", OtherCategory: "string", SubCategoryId: "int?", OtherSubCategory: "string", ProjectCost: "decimal?", Currency: "string", FundingId: "int?",
  DirectBeneficiaries: "int?", ManHours: "int?", RotariansInvolved: "int?", RotaractorsInvolved: "int?", RccInvolved: "int?", SendWhatsapp: "bool",
  SendEmail: "bool", MeetingType: "string", AgendaDocument: "string", MinutesDocument: "string", Attendance: "int?", AttendancePercentage: "decimal?",
  GlobalGrantNumber: "string", AmountSanctioned: "decimal?", AmountReceived: "decimal?", AmountSpent: "decimal?", HostClubsDistricts: "string",
  GlobalPartnerClubsDistricts: "string", CsrCompanyName: "string",
});

export interface ProjectPhotoInput {
  imagePath: string;
  description: string | null;
  isPrimary: boolean;
  sortOrder: number;
}
export interface SaveProject {
  moduleId: number; projectType: string; parentProjectId: number | null; ongoingGroupTitle: string | null; isJointProject: boolean; coHostName: string | null;
  clubRole: string | null; title: string; description: string | null; location: string | null; areaOfFocusId: number | null; otherAreaOfFocus: string | null;
  categoryId: number | null; otherCategory: string | null; subCategoryId: number | null; otherSubCategory: string | null; projectDate: string | null;
  projectCost: number | null; currency: string | null; fundingId: number | null; directBeneficiaries: number | null; manHours: number | null;
  rotariansInvolved: number | null; rotaractorsInvolved: number | null; rccInvolved: number | null; sendWhatsapp: boolean; sendEmail: boolean;
  meetingType: string | null; agendaDocument: string | null; minutesDocument: string | null; attendance: number | null; attendancePercentage: number | null;
  globalGrantNumber: string | null; amountSanctioned: number | null; amountReceived: number | null; amountSpent: number | null;
  hostClubsDistricts: string | null; globalPartnerClubsDistricts: string | null; csrCompanyName: string | null; photos: ProjectPhotoInput[] | null;
}

/** Binds Create/UpdateProjectDto; `dateInvalid` when ProjectDate is present but not a date (a 400 from model binding in .NET). */
export function bindProject(body: unknown): { dto: SaveProject; dateInvalid: boolean } {
  const dto = SaveProjectBody.create((body ?? {}) as Record<string, unknown>) as unknown as SaveProject;
  const rawDate = bodyField(body, "projectDate");
  dto.projectDate = rawDate === null || rawDate === undefined || rawDate === "" ? null : tryParseDate(String(rawDate));
  const rawPhotos = bodyField(body, "photos");
  dto.photos = Array.isArray(rawPhotos)
    ? rawPhotos.map((p) => {
        const d = bodyField(p, "description");
        return {
          imagePath: String(bodyField(p, "imagePath") ?? ""), description: d === null || d === undefined ? null : String(d),
          isPrimary: bodyField(p, "isPrimary") === true, sortOrder: Math.trunc(Number(bodyField(p, "sortOrder") ?? 0)) || 0,
        };
      })
    : null;
  return { dto, dateInvalid: rawDate !== null && rawDate !== undefined && rawDate !== "" && dto.projectDate === null };
}

/** UpdateAsync found the new date in another Rotary year (409 with the move details). */
export class CrossYearMoveRequiredException extends Error {
  constructor(readonly fromYearId: number, readonly toYearId: number, readonly fromYearLabel: string, readonly toYearLabel: string) {
    super("Cross-year move required.");
  }
}

/** ClassifyFunding (club flavour: unknown names are "other"). */
function classifyFunding(name: string | null): string {
  if (!name || !name.trim()) return "";
  const n = name.trim().toLowerCase();
  if (n.includes("global grant")) return "global_grant";
  if (n === "csr" || n.startsWith("csr ") || n.includes(" csr") || n.includes("(csr)")) return "csr";
  return "other";
}

/** ValidateAndNormalizeFundingFields: required grant / CSR details; the fields of other funding kinds are cleared. */
function normalizeFunding(kind: string, d: SaveProject) {
  const blank = (s: string | null) => !s || !s.trim();
  if (kind === "global_grant") {
    d.csrCompanyName = null;
    if (blank(d.globalGrantNumber)) throw new InvalidOperationException("Global Grant Number is required for Global Grant funding.");
    if (d.amountSanctioned === null) throw new InvalidOperationException("Amount Sanctioned is required for Global Grant funding.");
    if (d.amountReceived === null) throw new InvalidOperationException("Amount Received is required for Global Grant funding.");
    if (d.amountSpent === null) throw new InvalidOperationException("Amount Spent Till Date is required for Global Grant funding.");
    if (blank(d.hostClubsDistricts)) throw new InvalidOperationException("Host Clubs / Districts is required for Global Grant funding.");
    if (blank(d.globalPartnerClubsDistricts)) throw new InvalidOperationException("Global Partner Clubs / Districts is required for Global Grant funding.");
  } else if (kind === "csr") {
    d.globalGrantNumber = d.hostClubsDistricts = d.globalPartnerClubsDistricts = null;
    d.amountSpent = null;
    if (blank(d.csrCompanyName)) throw new InvalidOperationException("CSR Company Name is required for CSR funding.");
    if (d.amountSanctioned === null) throw new InvalidOperationException("Amount Sanctioned is required for CSR funding.");
    if (d.amountReceived === null) throw new InvalidOperationException("Amount Received is required for CSR funding.");
  } else {
    d.globalGrantNumber = d.hostClubsDistricts = d.globalPartnerClubsDistricts = d.csrCompanyName = null;
    d.amountSanctioned = d.amountReceived = d.amountSpent = null;
  }
}

const fileName = (path: string) => (path ? path.split(/[\\/]/).pop() ?? "" : "");
const photoPathSql = (suffix: string) => `CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
    CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk) ELSE CONCAT('${suffix}/Album', p.pk_project_id) END, '/', pp.image_path)`;
const TYPE_FILTER = `(@ProjectType IS NULL OR project_type = @ProjectType
  OR (@ProjectType = 'ongoing_repeat' AND project_type = 'ongoing') OR (@ProjectType = 'ongoing' AND project_type = 'ongoing_repeat'))`;

/** Port of ProjectService.cs: club projects (the five avenues and Club Service meetings) in the year-wise project tables. */
@Injectable()
export class ProjectService {
  private readonly log = new Logger("ProjectService");

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly yearTables: YearTableResolver,
    private readonly credits: CreditManagementService,
    private readonly citation: CitationRecalcTrigger,
    private readonly approvals: ProjectApprovalService,
  ) {}

  private static async fundingClass(conn: DbCommands, fundingId: number | null) {
    if (fundingId === null || fundingId <= 0) return "";
    return classifyFunding(await conn.executeScalar<string>("SELECT name FROM funding_master WHERE pk_funding_id = @id AND isdeleted = 0", { id: fundingId }));
  }

  private static params(d: SaveProject) {
    return {
      ProjectType: d.projectType, ParentProjectId: d.parentProjectId, OngoingGroupTitle: d.ongoingGroupTitle, IsJointProject: d.isJointProject,
      CoHostName: d.coHostName, ClubRole: d.clubRole, Title: d.title, Description: d.description, Location: d.location, AreaOfFocusId: d.areaOfFocusId,
      OtherAreaOfFocus: d.otherAreaOfFocus, CategoryId: d.categoryId, OtherCategory: d.otherCategory, SubCategoryId: d.subCategoryId,
      OtherSubCategory: d.otherSubCategory, ProjectDate: d.projectDate, ProjectCost: d.projectCost, FundingId: d.fundingId,
      DirectBeneficiaries: d.directBeneficiaries, ManHours: d.manHours, RotariansInvolved: d.rotariansInvolved, RotaractorsInvolved: d.rotaractorsInvolved,
      RccInvolved: d.rccInvolved ?? 0, SendWhatsapp: d.sendWhatsapp, SendEmail: d.sendEmail, MeetingType: d.meetingType, AgendaDocument: d.agendaDocument,
      MinutesDocument: d.minutesDocument, Attendance: d.attendance, AttendancePercentage: d.attendancePercentage, GlobalGrantNumber: d.globalGrantNumber,
      AmountSanctioned: d.amountSanctioned, AmountReceived: d.amountReceived, AmountSpent: d.amountSpent, HostClubsDistricts: d.hostClubsDistricts,
      GlobalPartnerClubsDistricts: d.globalPartnerClubsDistricts, CsrCompanyName: d.csrCompanyName,
    };
  }

  /** The WhatsApp / Email credit pre-checks for the notification the save will trigger. */
  private async checkCredits(conn: DbCommands, clubId: number, d: SaveProject, onUpdate: boolean) {
    const count = (column: string) =>
      conn
        .executeScalar(
          `SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
           WHERE cm.fk_club_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0 AND m.${column} IS NOT NULL AND m.${column} <> ''`,
          { Id: clubId },
        )
        .then(Number);
    if (d.sendWhatsapp && clubId > 0) {
      const n = await count("PrimaryMobileNumber");
      if (n > 0 && !(await this.credits.hasSufficientCredits(clubId, "WhatsApp", n))) {
        throw new InvalidOperationException(
          onUpdate
            ? `Insufficient WhatsApp credits. Need ${n} credit(s). Please uncheck 'Send through WhatsApp' to save without WhatsApp notification, or purchase more credits.`
            : `Insufficient WhatsApp credits. Need ${n} credit(s).`,
        );
      }
    }
    if (d.sendEmail && clubId > 0) {
      const n = await count("EmailId");
      if (n > 0 && !(await this.credits.hasSufficientCredits(clubId, "Email", n))) {
        throw new InvalidOperationException(
          onUpdate
            ? `Insufficient Email credits. Need ${n} credit(s). Please uncheck 'Send through Email' to save without email notification, or purchase more credits.`
            : `Insufficient Email credits. Need ${n} credit(s).`,
        );
      }
    }
  }

  private static async insertPhotos(conn: DbCommands, info: YearTableInfo, projectId: number, photos: ProjectPhotoInput[]) {
    for (const photo of photos) {
      if (photo.isPrimary) await conn.execute(`UPDATE \`${info.photosTable}\` SET is_primary = 0 WHERE fk_project_id = @ProjectId`, { ProjectId: projectId });
      await conn.execute(
        `INSERT INTO \`${info.photosTable}\` (fk_project_id, image_path, description, is_primary, sort_order) VALUES (@ProjectId, @ImagePath, @Description, @IsPrimary, @SortOrder)`,
        { ProjectId: projectId, ImagePath: fileName(photo.imagePath), Description: photo.description, IsPrimary: photo.isPrimary, SortOrder: photo.sortOrder },
      );
    }
  }

  async getByClub(clubId: number, moduleId: number, yearId: number, page: number, pageSize: number, search: string | null, projectType: string | null) {
    return this.db.session(async (conn) => {
      const info = await this.yearTables.resolveByYearId(conn, yearId);
      if (!info) return pagedResult([], 0, page, pageSize);
      const suffix = info.yearLabel.replace(/-/g, "_");
      const params = { ClubId: clubId, ModuleId: moduleId, Offset: (page - 1) * pageSize, PageSize: pageSize, Search: search || null, ProjectType: !projectType || projectType === "all" ? null : projectType };
      // eff_parent: an entry whose ongoing parent lives in an EARLIER year table has no parent row here; the
      // earliest such entry per old parent becomes the top row and later ones nest under it. Pagination
      // counts top rows only, and each page also carries everything nested under its top rows.
      const grp = `base AS (
            SELECT b.pk_project_id, b.parent_project_id, b.project_date, b.project_type, b.title, b.location,
                   CASE WHEN COALESCE(b.parent_project_id, 0) = 0 THEN 0
                        WHEN EXISTS (SELECT 1 FROM \`${info.projectsTable}\` x
                                     WHERE x.pk_project_id = b.parent_project_id AND x.fk_club_id = b.fk_club_id
                                       AND x.isdeleted = 0) THEN 0
                        ELSE 1 END AS orphan
            FROM \`${info.projectsTable}\` b
            WHERE b.fk_club_id = @ClubId AND b.fk_module_id = @ModuleId AND b.isdeleted = 0),
          k AS (
            SELECT base.*,
                   CASE WHEN orphan = 0 THEN COALESCE(parent_project_id, 0)
                        ELSE NULLIF(FIRST_VALUE(pk_project_id) OVER (PARTITION BY orphan, parent_project_id
                                      ORDER BY project_date, pk_project_id), pk_project_id) END AS eff_parent
            FROM base),
          page AS (
            SELECT pk_project_id AS pid FROM k
            WHERE COALESCE(eff_parent, 0) = 0
              AND ${TYPE_FILTER}
              AND (@Search IS NULL OR title LIKE CONCAT('%', @Search, '%') OR location LIKE CONCAT('%', @Search, '%'))`;
      const items = await conn.query(
        `WITH ${grp}
            ORDER BY project_date DESC, pk_project_id DESC
            LIMIT @Offset, @PageSize)
         SELECT p.pk_project_id AS Id, p.fk_club_id AS ClubId, p.fk_module_id AS ModuleId, p.fk_year_id AS YearId, y.YearLabel,
                CASE WHEN p.project_type = 'ongoing' THEN 'ongoing_repeat' ELSE p.project_type END AS ProjectType,
                NULLIF(COALESCE(k.eff_parent, 0), 0) AS ParentProjectId, p.ongoing_group_title AS OngoingGroupTitle, p.is_joint_project AS IsJointProject,
                p.co_host_name AS CoHostName, p.club_role AS ClubRole, p.title AS Title, p.location AS Location, aof.name AS AreaOfFocusName,
                p.other_area_of_focus AS OtherAreaOfFocus, cat.name AS CategoryName, p.other_category AS OtherCategory, scat.name AS SubCategoryName,
                p.other_sub_category AS OtherSubCategory, p.project_date AS ProjectDate, p.project_cost AS ProjectCost, p.Currency AS Currency,
                f.name AS FundingName, p.direct_beneficiaries AS DirectBeneficiaries, p.meeting_type AS MeetingType, p.attendance AS Attendance,
                p.attendance_percentage AS AttendancePercentage, p.is_active AS IsActive, p.approval_status AS ApprovalStatus,
                p.send_whatsapp AS IsSendWhatsapp, p.send_email AS IsSendEmail, p.WhatsAppSentDate, p.WhatsAppSentCount, p.WhatsAppFailedCount,
                p.EmailSentDate, p.EmailSentCount, p.EmailFailedCount,
                (SELECT ${photoPathSql(suffix)} FROM \`${info.photosTable}\` pp WHERE pp.fk_project_id = p.pk_project_id AND pp.is_primary = 1 LIMIT 1) AS PrimaryPhotoPath
         FROM \`${info.projectsTable}\` p
         JOIN k ON k.pk_project_id = p.pk_project_id
         JOIN (SELECT DISTINCT pid FROM page) pg ON pg.pid = p.pk_project_id OR pg.pid = k.eff_parent
         LEFT JOIN rotary_year_master y ON p.fk_year_id = y.pk_year_id
         LEFT JOIN area_of_focus_master aof ON p.fk_area_of_focus_id = aof.pk_area_of_focus_id
         LEFT JOIN category_master cat ON p.fk_category_id = cat.pk_category_id
         LEFT JOIN sub_category_master scat ON p.fk_sub_category_id = scat.pk_sub_category_id
         LEFT JOIN funding_master f ON p.fk_funding_id = f.pk_funding_id
         WHERE p.fk_club_id = @ClubId AND p.fk_module_id = @ModuleId AND p.isdeleted = 0
         ORDER BY p.project_date DESC, p.pk_project_id DESC`,
        params,
      );
      const totalCount = Number(await conn.executeScalar(`WITH ${grp}) SELECT COUNT(*) AS TotalCount FROM page`, params));
      return pagedResult(ProjectListDto.mapAll(items), totalCount, page, pageSize);
    });
  }

  /** GetByIdAsync: the given year first, then wherever the project now lives (it may have been moved). */
  async getById(id: number, yearId: number, clubId: number) {
    return this.db.session(async (conn) => {
      const info = await this.yearTables.resolveByYearId(conn, yearId);
      const found = info ? await ProjectService.fetch(conn, info, id, clubId) : null;
      if (found) return found;
      const located = await this.yearTables.findByProjectAndClub(conn, id, clubId);
      if (!located || (info && located.yearId === info.yearId)) return null;
      return ProjectService.fetch(conn, located, id, clubId);
    });
  }

  private static async fetch(conn: DbCommands, info: YearTableInfo, id: number, clubId: number) {
    const project = await conn.queryFirstOrDefault(
      `SELECT p.pk_project_id AS Id, p.fk_club_id AS ClubId, p.fk_module_id AS ModuleId, p.fk_year_id AS YearId, y.YearLabel,
              CASE WHEN p.project_type = 'ongoing' THEN 'ongoing_repeat' ELSE p.project_type END AS ProjectType,
              p.parent_project_id AS ParentProjectId, p.ongoing_group_title AS OngoingGroupTitle, p.is_joint_project AS IsJointProject,
              p.co_host_name AS CoHostName, p.club_role AS ClubRole, p.title AS Title, p.description AS Description, p.location AS Location,
              p.fk_area_of_focus_id AS AreaOfFocusId, aof.name AS AreaOfFocusName, p.other_area_of_focus AS OtherAreaOfFocus,
              p.fk_category_id AS CategoryId, cat.name AS CategoryName, p.other_category AS OtherCategory, p.fk_sub_category_id AS SubCategoryId,
              scat.name AS SubCategoryName, p.other_sub_category AS OtherSubCategory, p.project_date AS ProjectDate, p.project_cost AS ProjectCost,
              p.Currency AS Currency, p.fk_funding_id AS FundingId, f.name AS FundingName, p.direct_beneficiaries AS DirectBeneficiaries,
              p.man_hours AS ManHours, p.rotarians_involved AS RotariansInvolved, p.rotaractors_involved AS RotaractorsInvolved,
              COALESCE(p.rcc_involved,0) AS RccInvolved, p.send_whatsapp AS SendWhatsapp, p.send_email AS SendEmail, p.meeting_type AS MeetingType,
              p.agenda_document AS AgendaDocument, p.minutes_document AS MinutesDocument, p.attendance AS Attendance,
              p.attendance_percentage AS AttendancePercentage, p.global_grant_number AS GlobalGrantNumber, p.amount_sanctioned AS AmountSanctioned,
              p.amount_received AS AmountReceived, p.amount_spent AS AmountSpent, p.host_clubs_districts AS HostClubsDistricts,
              p.global_partner_clubs_districts AS GlobalPartnerClubsDistricts, p.csr_company_name AS CsrCompanyName, p.is_active AS IsActive
       FROM \`${info.projectsTable}\` p
       LEFT JOIN rotary_year_master y ON p.fk_year_id = y.pk_year_id
       LEFT JOIN area_of_focus_master aof ON p.fk_area_of_focus_id = aof.pk_area_of_focus_id
       LEFT JOIN category_master cat ON p.fk_category_id = cat.pk_category_id
       LEFT JOIN sub_category_master scat ON p.fk_sub_category_id = scat.pk_sub_category_id
       LEFT JOIN funding_master f ON p.fk_funding_id = f.pk_funding_id
       WHERE p.pk_project_id = @Id AND p.fk_club_id = @ClubId AND p.isdeleted = 0`,
      { Id: id, ClubId: clubId },
    );
    if (!project) return null;
    const suffix = info.yearLabel.replace(/-/g, "_");
    project.Photos = ProjectPhotoDto.mapAll(
      await conn.query(
        `SELECT pp.pk_photo_id AS Id, pp.fk_project_id AS ProjectId, ${photoPathSql(suffix)} AS ImagePath, pp.description AS Description,
                pp.is_primary AS IsPrimary, pp.sort_order AS SortOrder
         FROM \`${info.photosTable}\` pp JOIN \`${info.projectsTable}\` p ON p.pk_project_id = pp.fk_project_id
         WHERE pp.fk_project_id = @Id ORDER BY pp.sort_order`,
        { Id: id },
      ),
    );
    return ProjectDetailDto.map(project);
  }

  async create(clubId: number, d: SaveProject, createdBy: number): Promise<number> {
    throwIfInvalidProjectDate(d.projectDate);
    const { projectId, yearId } = await this.db.session(async (conn) => {
      await this.checkCredits(conn, clubId, d, false);
      const yearId = await ensureRotaryYear(conn, d.projectDate);
      const info = await this.yearTables.resolveByYearId(conn, yearId);
      if (!info) throw new InvalidOperationException(`Could not resolve year-wise tables for yearId ${yearId}.`);
      normalizeFunding(await ProjectService.fundingClass(conn, d.fundingId), d);
      await conn.execute(
        `INSERT INTO \`${info.projectsTable}\` (
             fk_club_id, fk_module_id, fk_year_id, project_type, parent_project_id, ongoing_group_title, is_joint_project, co_host_name, club_role,
             title, description, location, fk_area_of_focus_id, other_area_of_focus, fk_category_id, other_category, fk_sub_category_id, other_sub_category,
             project_date, project_cost, Currency, fk_funding_id, direct_beneficiaries, man_hours, rotarians_involved, rotaractors_involved, rcc_involved,
             send_whatsapp, send_email, meeting_type, agenda_document, minutes_document, attendance, attendance_percentage,
             global_grant_number, amount_sanctioned, amount_received, amount_spent, host_clubs_districts, global_partner_clubs_districts, csr_company_name, created_by)
         VALUES (
             @ClubId, @ModuleId, @YearId, @ProjectType, @ParentProjectId, @OngoingGroupTitle, @IsJointProject, @CoHostName, @ClubRole,
             @Title, @Description, @Location, @AreaOfFocusId, @OtherAreaOfFocus, @CategoryId, @OtherCategory, @SubCategoryId, @OtherSubCategory,
             @ProjectDate, @ProjectCost, @Currency, @FundingId, @DirectBeneficiaries, @ManHours, @RotariansInvolved, @RotaractorsInvolved, @RccInvolved,
             @SendWhatsapp, @SendEmail, @MeetingType, @AgendaDocument, @MinutesDocument, @Attendance, @AttendancePercentage,
             @GlobalGrantNumber, @AmountSanctioned, @AmountReceived, @AmountSpent, @HostClubsDistricts, @GlobalPartnerClubsDistricts, @CsrCompanyName, @CreatedBy)`,
        { ...ProjectService.params(d), ClubId: clubId, ModuleId: d.moduleId, YearId: yearId, Currency: normalizeCurrency(d.currency), CreatedBy: createdBy },
      );
      const projectId = Number(await conn.executeScalar("SELECT LAST_INSERT_ID()"));
      if (d.photos) {
        // Photos uploaded before the project existed sit in /tempdocument; move them into the album.
        const album = join(webRootPath(this.config), "Documents", "gallery", `Group${clubId}`, info.yearLabel.replace(/-/g, "_"), `Album${projectId}`);
        await mkdir(album, { recursive: true });
        for (const photo of d.photos) {
          const name = fileName(photo.imagePath);
          if (photo.imagePath.includes("/tempdocument/")) {
            const source = join(webRootPath(this.config), "tempdocument", name);
            if (existsSync(source)) await rename(source, join(album, name)).catch(() => undefined);
          }
        }
        await ProjectService.insertPhotos(conn, info, projectId, d.photos);
      }
      return { projectId, yearId };
    });
    await this.approvals.setPendingApproval(projectId, clubId, d.moduleId, createdBy, yearId).catch((e) => this.log.error(`Failed to check/set moderator approval for project ${projectId}: ${(e as Error).message}`));
    this.citation.triggerForClub(clubId);
    return projectId;
  }

  async update(id: number, yearId: number, d: SaveProject, modifiedBy: number) {
    throwIfInvalidProjectDate(d.projectDate);
    const clubId = await this.db.session(async (conn) => {
      const info = await this.yearTables.resolveByYearId(conn, yearId);
      if (!info) throw new InvalidOperationException(`Could not resolve year-wise tables for yearId ${yearId}.`);
      if (d.projectDate) {
        const dateYearId = await ensureRotaryYear(conn, d.projectDate);
        if (dateYearId !== yearId) {
          const to = await this.yearTables.resolveByYearId(conn, dateYearId);
          throw new CrossYearMoveRequiredException(yearId, dateYearId, info.yearLabel, to?.yearLabel ?? String(dateYearId));
        }
      }
      const prior = await conn.queryFirstOrDefault(`SELECT fk_club_id, send_whatsapp FROM \`${info.projectsTable}\` WHERE pk_project_id = @Id AND isdeleted = 0`, { Id: id });
      const clubId = prior ? Number(prior.fk_club_id) : 0;
      await this.checkCredits(conn, clubId, d, true);
      normalizeFunding(await ProjectService.fundingClass(conn, d.fundingId), d);
      await conn.execute(
        `UPDATE \`${info.projectsTable}\` SET
             project_type = @ProjectType, parent_project_id = @ParentProjectId, ongoing_group_title = @OngoingGroupTitle, is_joint_project = @IsJointProject,
             co_host_name = @CoHostName, club_role = @ClubRole, title = @Title, description = @Description, location = @Location,
             fk_area_of_focus_id = @AreaOfFocusId, other_area_of_focus = @OtherAreaOfFocus, fk_category_id = @CategoryId, other_category = @OtherCategory,
             fk_sub_category_id = @SubCategoryId, other_sub_category = @OtherSubCategory, project_date = @ProjectDate, project_cost = @ProjectCost,
             Currency = COALESCE(@Currency, Currency), fk_funding_id = @FundingId, direct_beneficiaries = @DirectBeneficiaries, man_hours = @ManHours,
             rotarians_involved = @RotariansInvolved, rotaractors_involved = @RotaractorsInvolved, rcc_involved = @RccInvolved, send_whatsapp = @SendWhatsapp,
             send_email = @SendEmail, meeting_type = @MeetingType, agenda_document = @AgendaDocument, minutes_document = @MinutesDocument,
             attendance = @Attendance, attendance_percentage = @AttendancePercentage, global_grant_number = @GlobalGrantNumber,
             amount_sanctioned = @AmountSanctioned, amount_received = @AmountReceived, amount_spent = @AmountSpent, host_clubs_districts = @HostClubsDistricts,
             global_partner_clubs_districts = @GlobalPartnerClubsDistricts, csr_company_name = @CsrCompanyName, modified_by = @ModifiedBy
         WHERE pk_project_id = @Id AND isdeleted = 0`,
        { ...ProjectService.params(d), Id: id, Currency: d.currency && d.currency.trim() ? normalizeCurrency(d.currency) : null, ModifiedBy: modifiedBy },
      );
      // Ticking "send" again re-arms the notification.
      if (d.sendWhatsapp) await conn.execute(`UPDATE \`${info.projectsTable}\` SET WhatsAppSentDate = NULL, WhatsAppSentCount = 0, WhatsAppFailedCount = 0 WHERE pk_project_id = @Id AND isdeleted = 0`, { Id: id });
      if (d.sendEmail) await conn.execute(`UPDATE \`${info.projectsTable}\` SET EmailSentDate = NULL, EmailSentCount = 0, EmailFailedCount = 0 WHERE pk_project_id = @Id AND isdeleted = 0`, { Id: id });
      if (d.photos) {
        await conn.execute(`DELETE FROM \`${info.photosTable}\` WHERE fk_project_id = @ProjectId`, { ProjectId: id });
        await ProjectService.insertPhotos(conn, info, id, d.photos);
      }
      const now = await conn.queryFirstOrDefault(`SELECT fk_club_id, fk_module_id FROM \`${info.projectsTable}\` WHERE pk_project_id = @Id`, { Id: id });
      return now ? { clubId: Number(now.fk_club_id), moduleId: Number(now.fk_module_id) } : { clubId, moduleId: 0 };
    });
    if (clubId.moduleId) {
      await this.approvals.setPendingApproval(id, clubId.clubId, clubId.moduleId, modifiedBy, yearId).catch((e) => this.log.error(`Failed to re-check moderator approval on project update ${id}: ${(e as Error).message}`));
    }
    if (clubId.clubId > 0) this.citation.triggerForClub(clubId.clubId);
  }

  /** MoveProjectAsync: the date moved the project into another Rotary year; copy it (and its photos) there and remove the source. */
  async move(id: number, fromYearId: number, d: SaveProject, modifiedBy: number) {
    if (!d.projectDate) throw new InvalidOperationException("Project date is required to move a project.");
    throwIfInvalidProjectDate(d.projectDate);
    return this.db.session(async (conn) => {
      const src = await this.yearTables.resolveByYearId(conn, fromYearId);
      if (!src) throw new InvalidOperationException(`Could not resolve source year tables for yearId ${fromYearId}.`);
      const toYearId = await ensureRotaryYear(conn, d.projectDate);
      if (toYearId === fromYearId) throw new InvalidOperationException("Project date is in the same rotary year — use the normal update, not move.");
      const tgt = await this.yearTables.resolveByYearId(conn, toYearId);
      if (!tgt) throw new InvalidOperationException(`Could not resolve target year tables for yearId ${toYearId}.`);
      const row = await conn.queryFirstOrDefault(`SELECT fk_club_id, old_pk FROM \`${src.projectsTable}\` WHERE pk_project_id = @Id AND isdeleted = 0`, { Id: id });
      if (!row) throw new InvalidOperationException("Project not found in the source year (or already deleted).");
      const clubId = Number(row.fk_club_id);
      normalizeFunding(await ProjectService.fundingClass(conn, d.fundingId), d);
      const newId = await this.db.transaction(async (tx) => {
        await tx.execute(
          `INSERT INTO \`${tgt.projectsTable}\` (
               fk_club_id, fk_district_id, fk_module_id, fk_year_id, DistrictProjectType, project_type, parent_project_id, ongoing_group_title, is_joint_project,
               co_host_name, club_role, title, description, location, fk_area_of_focus_id, other_area_of_focus, fk_category_id, other_category,
               fk_sub_category_id, other_sub_category, project_date, project_cost, Currency, fk_funding_id, direct_beneficiaries, man_hours, rotarians_involved,
               rotaractors_involved, rcc_involved, send_whatsapp, send_email, meeting_type, agenda_document, minutes_document, attendance, attendance_percentage,
               global_grant_number, amount_sanctioned, amount_received, amount_spent, host_clubs_districts, global_partner_clubs_districts, csr_company_name,
               IsSendWhatsapp, WhatsAppSentDate, WhatsAppSentCount, WhatsAppFailedCount, EmailSentDate, EmailSentCount, EmailFailedCount,
               PushNotificationSent, PushNotificationSentAt, approval_status, approval_remark, approved_by, approval_date, approval_token,
               is_active, created_by, created_date, modified_by, old_pk)
           SELECT fk_club_id, fk_district_id, fk_module_id, @ToYearId, DistrictProjectType, @ProjectType, @ParentProjectId, @OngoingGroupTitle, @IsJointProject,
               @CoHostName, @ClubRole, @Title, @Description, @Location, @AreaOfFocusId, @OtherAreaOfFocus, @CategoryId, @OtherCategory,
               @SubCategoryId, @OtherSubCategory, @ProjectDate, @ProjectCost, Currency, @FundingId, @DirectBeneficiaries, @ManHours, @RotariansInvolved,
               @RotaractorsInvolved, @RccInvolved, @SendWhatsapp, @SendEmail, @MeetingType, @AgendaDocument, @MinutesDocument, @Attendance, @AttendancePercentage,
               @GlobalGrantNumber, @AmountSanctioned, @AmountReceived, @AmountSpent, @HostClubsDistricts, @GlobalPartnerClubsDistricts, @CsrCompanyName,
               IsSendWhatsapp, WhatsAppSentDate, WhatsAppSentCount, WhatsAppFailedCount, EmailSentDate, EmailSentCount, EmailFailedCount,
               PushNotificationSent, PushNotificationSentAt, approval_status, approval_remark, approved_by, approval_date, approval_token,
               is_active, created_by, created_date, @ModifiedBy, old_pk
           FROM \`${src.projectsTable}\` WHERE pk_project_id = @Id AND isdeleted = 0`,
          { ...ProjectService.params(d), ToYearId: toYearId, Id: id, ModifiedBy: modifiedBy },
        );
        const newId = Number(await tx.executeScalar("SELECT LAST_INSERT_ID()"));
        await tx.execute(
          `INSERT INTO \`${tgt.photosTable}\` (fk_project_id, image_path, description, is_primary, sort_order, created_date)
           SELECT @NewId, image_path, description, is_primary, sort_order, created_date FROM \`${src.photosTable}\` WHERE fk_project_id = @Id`,
          { NewId: newId, Id: id },
        );
        const srcPhotos = Number(await tx.executeScalar(`SELECT COUNT(*) FROM \`${src.photosTable}\` WHERE fk_project_id = @Id`, { Id: id }));
        const tgtPhotos = Number(await tx.executeScalar(`SELECT COUNT(*) FROM \`${tgt.photosTable}\` WHERE fk_project_id = @NewId`, { NewId: newId }));
        const tgtExists = Number(await tx.executeScalar(`SELECT COUNT(*) FROM \`${tgt.projectsTable}\` WHERE pk_project_id = @NewId`, { NewId: newId }));
        if (tgtExists !== 1 || srcPhotos !== tgtPhotos) {
          throw new InvalidOperationException(`Move verification failed (target project rows=${tgtExists}, photos src=${srcPhotos}/tgt=${tgtPhotos}). Nothing was deleted.`);
        }
        await tx.execute(`DELETE FROM \`${src.photosTable}\` WHERE fk_project_id = @Id`, { Id: id });
        await tx.execute(`UPDATE \`${src.projectsTable}\` SET isdeleted = 1, deleted_by = @ModifiedBy, deleted_date = NOW() WHERE pk_project_id = @Id`, { Id: id, ModifiedBy: modifiedBy });
        return newId;
      });
      if (row.old_pk === null || row.old_pk === undefined) {
        // New-style albums live under the year folder: move the album with the project.
        try {
          const base = join(webRootPath(this.config), "Documents", "gallery", `Group${clubId}`);
          const from = join(base, src.yearLabel.replace(/-/g, "_"), `Album${id}`);
          const to = join(base, tgt.yearLabel.replace(/-/g, "_"), `Album${newId}`);
          if (existsSync(from)) {
            await mkdir(dirname(to), { recursive: true });
            if (existsSync(to)) await rm(to, { recursive: true, force: true });
            await rename(from, to);
          }
        } catch (e) {
          this.log.error(`Project ${id} moved in DB (${fromYearId}->${toYearId}) but the album folder move failed: ${(e as Error).message}`);
        }
      }
      return { newYearId: toYearId, newId, newYearLabel: tgt.yearLabel };
    });
  }

  async delete(id: number, yearId: number, deletedBy: number) {
    const clubId = await this.db.session(async (conn) => {
      const info = await this.yearTables.resolveByYearId(conn, yearId);
      if (!info) throw new InvalidOperationException(`Could not resolve year-wise tables for yearId ${yearId}.`);
      const clubId = Number((await conn.executeScalar(`SELECT fk_club_id FROM \`${info.projectsTable}\` WHERE pk_project_id = @Id`, { Id: id })) ?? 0);
      await conn.execute(`UPDATE \`${info.projectsTable}\` SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW() WHERE pk_project_id = @Id AND isdeleted = 0`, { Id: id, DeletedBy: deletedBy });
      return clubId;
    });
    if (clubId > 0) this.citation.triggerForClub(clubId);
  }

  async getOngoing(clubId: number, moduleId: number, search: string | null, yearId: number | null) {
    return this.db.session(async (conn) => {
      const tables = yearId !== null ? [await this.yearTables.resolveByYearId(conn, yearId)].filter((t) => t !== null) : await this.yearTables.getAllExistingYearTables(conn);
      if (!tables.length) return [];
      const legs = tables.map(
        (t) => `SELECT pk_project_id AS Id, CONVERT(COALESCE(ongoing_group_title, title) USING utf8mb4) COLLATE utf8mb4_general_ci AS Title
                FROM \`${t.projectsTable}\`
                WHERE fk_club_id = @ClubId AND fk_module_id = @ModuleId AND project_type IN ('ongoing_repeat', 'ongoing')
                  AND (parent_project_id IS NULL OR parent_project_id = 0) AND COALESCE(isdeleted, 0) = 0
                  AND (@Search IS NULL OR ongoing_group_title LIKE CONCAT('%', @Search, '%') OR title LIKE CONCAT('%', @Search, '%'))`,
      );
      return OngoingProjectDto.mapAll(await conn.query(`SELECT * FROM (${legs.join(" UNION ALL ")}) u ORDER BY Title LIMIT 20`, { ClubId: clubId, ModuleId: moduleId, Search: search || null }));
    });
  }

  private async requireTable(conn: DbCommands, yearId: number) {
    const info = await this.yearTables.resolveByYearId(conn, yearId);
    if (!info) throw new InvalidOperationException(`Could not resolve year-wise tables for yearId ${yearId}.`);
    return info;
  }

  async addPhoto(projectId: number, yearId: number, imagePath: string, description: string | null, isPrimary: boolean, sortOrder: number) {
    return this.db.session(async (conn) => {
      const info = await this.requireTable(conn, yearId);
      if (isPrimary) await conn.execute(`UPDATE \`${info.photosTable}\` SET is_primary = 0 WHERE fk_project_id = @ProjectId`, { ProjectId: projectId });
      await conn.execute(
        `INSERT INTO \`${info.photosTable}\` (fk_project_id, image_path, description, is_primary, sort_order) VALUES (@ProjectId, @ImagePath, @Description, @IsPrimary, @SortOrder)`,
        { ProjectId: projectId, ImagePath: fileName(imagePath), Description: description, IsPrimary: isPrimary, SortOrder: sortOrder },
      );
      return Number(await conn.executeScalar("SELECT LAST_INSERT_ID()"));
    });
  }

  async deletePhoto(photoId: number, yearId: number) {
    await this.db.session(async (conn) => {
      const info = await this.requireTable(conn, yearId);
      await conn.execute(`DELETE FROM \`${info.photosTable}\` WHERE pk_photo_id = @Id`, { Id: photoId });
    });
  }

  async setPrimaryPhoto(projectId: number, photoId: number, yearId: number) {
    await this.db.session(async (conn) => {
      const info = await this.requireTable(conn, yearId);
      await conn.execute(`UPDATE \`${info.photosTable}\` SET is_primary = 0 WHERE fk_project_id = @ProjectId`, { ProjectId: projectId });
      await conn.execute(`UPDATE \`${info.photosTable}\` SET is_primary = 1 WHERE pk_photo_id = @PhotoId`, { PhotoId: photoId });
    });
  }

  /** Straight into the project's album when it exists, else /tempdocument until the project is saved. */
  async uploadImage(file: UploadedFile, clubId: number, projectId: number | null, yearId: number | null) {
    const root = webRootPath(this.config);
    if (projectId && projectId > 0 && yearId && yearId > 0) {
      const info = await this.db.session((conn) => this.yearTables.resolveByYearId(conn, yearId));
      if (info) {
        const suffix = info.yearLabel.replace(/-/g, "_");
        const name = `${randomUUID()}${extname(file.originalname)}`;
        const dir = join(root, "Documents", "gallery", `Group${clubId}`, suffix, `Album${projectId}`);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, name), file.buffer);
        return `/Documents/gallery/Group${clubId}/${suffix}/Album${projectId}/${name}`;
      }
    }
    const name = `${randomUUID()}${extname(file.originalname)}`;
    await mkdir(join(root, "tempdocument"), { recursive: true });
    await writeFile(join(root, "tempdocument", name), file.buffer);
    return `/tempdocument/${name}`;
  }

  async uploadDocument(file: UploadedFile, clubId: number) {
    const name = `${randomUUID()}${extname(file.originalname)}`;
    const dir = join(webRootPath(this.config), "Documents", "ClubMonthlyReport", `Group${clubId}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), file.buffer);
    return `/Documents/ClubMonthlyReport/Group${clubId}/${name}`;
  }

  async getPublic(clubId: number, moduleId: number, yearId: number, page: number, pageSize: number) {
    return this.db.session(async (conn) => {
      const info = await this.yearTables.resolveByYearId(conn, yearId);
      if (!info) return pagedResult([], 0, page, pageSize);
      const p = { ClubId: clubId, ModuleId: moduleId, Offset: (page - 1) * pageSize, PageSize: pageSize };
      const items = await conn.query(
        `SELECT p.pk_project_id AS Id, p.title AS Title, p.description AS Description, p.location AS Location, p.project_date AS ProjectDate,
                aof.name AS AreaOfFocusName, cat.name AS CategoryName, p.direct_beneficiaries AS DirectBeneficiaries,
                (SELECT ${photoPathSql(info.yearLabel.replace(/-/g, "_"))} FROM \`${info.photosTable}\` pp WHERE pp.fk_project_id = p.pk_project_id AND pp.is_primary = 1 LIMIT 1) AS PrimaryPhotoPath
         FROM \`${info.projectsTable}\` p
         LEFT JOIN area_of_focus_master aof ON p.fk_area_of_focus_id = aof.pk_area_of_focus_id
         LEFT JOIN category_master cat ON p.fk_category_id = cat.pk_category_id
         WHERE p.fk_club_id = @ClubId AND p.fk_module_id = @ModuleId AND p.isdeleted = 0
         ORDER BY p.project_date DESC, p.pk_project_id DESC
         LIMIT @Offset, @PageSize`,
        p,
      );
      const total = Number(await conn.executeScalar(`SELECT COUNT(*) FROM \`${info.projectsTable}\` WHERE fk_club_id = @ClubId AND fk_module_id = @ModuleId AND isdeleted = 0`, p));
      return pagedResult(ProjectPublicDto.mapAll(items), total, page, pageSize);
    });
  }

  async getYears(clubId: number, moduleId: number) {
    return this.db.session(async (conn) => {
      const tables = await this.yearTables.getAllExistingYearTables(conn);
      if (!tables.length) return [];
      const legs = tables.map(
        (t) => `(SELECT ${t.yearId} AS Id, '${t.yearLabel}' AS YearLabel,
                        (SELECT StartDate FROM rotary_year_master WHERE pk_year_id = ${t.yearId}) AS StartDate,
                        (SELECT EndDate FROM rotary_year_master WHERE pk_year_id = ${t.yearId}) AS EndDate,
                        (SELECT IsCurrent FROM rotary_year_master WHERE pk_year_id = ${t.yearId}) AS IsCurrent
                 FROM \`${t.projectsTable}\` WHERE fk_club_id = @ClubId AND fk_module_id = @ModuleId AND isdeleted = 0 LIMIT 1)`,
      );
      return ProjectYearDto.mapAll(await conn.query(`SELECT * FROM (${legs.join(" UNION ALL ")}) u ORDER BY u.IsCurrent DESC, u.StartDate DESC`, { ClubId: clubId, ModuleId: moduleId }));
    });
  }
}
