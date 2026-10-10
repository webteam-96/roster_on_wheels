import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Db, type DbCommands } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { defineDto } from "../../common/dto";
import { badRequest, conflict, notFound, ok, statusCode } from "../../common/results";
import { InvalidOperationException } from "../../common/exceptions";
import { paramInt, queryBool, queryInt, queryString, requireFile } from "../../common/binding";
import { DISTRICT_BLOCKED_MESSAGE, isDistrictDrillReachable } from "../../services/kill-switch.helper";
import { YearTableResolver, ensureRotaryYear, type YearTableInfo } from "../../services/year-table.resolver";
import { saveWithGuidName, type UploadedFile as Upload } from "../../services/media-storage";
import { ensureWithinLimit, validateImage } from "../../services/image-tools";
import { resolveDefaultCurrency } from "../../services/currency.helper";
import { tryParseDate, validateProjectDate, validateProjectDateText } from "../../services/project-date.validator";

const MAX_UPLOAD = 55 * 1024 * 1024;
const str = { type: "string" as const, default: () => "" };

/** DistrictProjectDto / DistrictEventDto (one binder: the event fields are a subset). */
const DistrictProjectBody = defineDto({
  Title: str, Description: "string", Location: "string", EventDate: "string", AreaOfFocusId: "int?", OtherAreaOfFocus: "string", CategoryId: "int?",
  OtherCategory: "string", SubCategoryId: "int?", OtherSubCategory: "string", ProjectDate: "string", ProjectCost: "decimal?", FundingId: "int?",
  GlobalGrantNumber: "string", AmountSanctioned: "decimal?", AmountReceived: "decimal?", AmountSpent: "decimal?", HostClubsDistricts: "string",
  GlobalPartnerClubsDistricts: "string", CsrCompanyName: "string", DirectBeneficiaries: "int?", ManHours: "int?", RotariansInvolved: "int?",
  RotaractorsInvolved: "int?", RccInvolved: "int?", Photos: "object",
});
interface Photo {
  imagePath: string;
  description: string | null;
}
interface DistrictProject {
  title: string; description: string | null; location: string | null; eventDate: string | null; areaOfFocusId: number | null;
  otherAreaOfFocus: string | null; categoryId: number | null; otherCategory: string | null; subCategoryId: number | null; otherSubCategory: string | null;
  projectDate: string | null; projectCost: number | null; fundingId: number | null; globalGrantNumber: string | null; amountSanctioned: number | null;
  amountReceived: number | null; amountSpent: number | null; hostClubsDistricts: string | null; globalPartnerClubsDistricts: string | null;
  csrCompanyName: string | null; directBeneficiaries: number | null; manHours: number | null; rotariansInvolved: number | null;
  rotaractorsInvolved: number | null; rccInvolved: number | null; photos: Photo[] | null;
}

function bind(body: unknown): DistrictProject {
  const dto = DistrictProjectBody.create((body ?? {}) as Record<string, unknown>) as unknown as DistrictProject & { photos: unknown };
  dto.photos = Array.isArray(dto.photos)
    ? (dto.photos as unknown as Record<string, unknown>[]).map((p) => {
        const get = (k: string) => Object.entries(p ?? {}).find(([key]) => key.toLowerCase() === k)?.[1];
        const d = get("description");
        return { imagePath: String(get("imagepath") ?? ""), description: d === null || d === undefined ? null : String(d) };
      })
    : null;
  return dto;
}

/** Path.GetFileName: the part after the last / or \. */
const fileName = (path: string) => (path ? path.split(/[\\/]/).pop() ?? "" : "");

/** ClassifyFunding: "global_grant", "csr" or "". */
function classifyFunding(name: string | null): string {
  if (!name || !name.trim()) return "";
  const n = name.trim().toLowerCase();
  if (n.includes("global grant")) return "global_grant";
  if (n === "csr" || n.startsWith("csr ") || n.includes(" csr") || n.includes("(csr)")) return "csr";
  return "";
}

/** ValidateAndNormalizeDistrictFunding: required fields per funding class; the others are cleared. */
function normalizeFunding(fundingClass: string, dto: DistrictProject) {
  const blank = (s: string | null) => !s || !s.trim();
  if (fundingClass === "global_grant") {
    dto.csrCompanyName = null;
    if (blank(dto.globalGrantNumber)) throw new InvalidOperationException("Global Grant Number is required for Global Grant funding.");
    if (dto.amountSanctioned === null) throw new InvalidOperationException("Amount Sanctioned is required for Global Grant funding.");
    if (dto.amountReceived === null) throw new InvalidOperationException("Amount Received is required for Global Grant funding.");
    if (dto.amountSpent === null) throw new InvalidOperationException("Amount Spent Till Date is required for Global Grant funding.");
    if (blank(dto.hostClubsDistricts)) throw new InvalidOperationException("Host Clubs / Districts is required for Global Grant funding.");
    if (blank(dto.globalPartnerClubsDistricts)) throw new InvalidOperationException("Global Partner Clubs / Districts is required for Global Grant funding.");
  } else if (fundingClass === "csr") {
    dto.globalGrantNumber = dto.hostClubsDistricts = dto.globalPartnerClubsDistricts = null;
    dto.amountSpent = null;
    if (blank(dto.csrCompanyName)) throw new InvalidOperationException("CSR Company Name is required for CSR funding.");
    if (dto.amountSanctioned === null) throw new InvalidOperationException("Amount Sanctioned is required for CSR funding.");
    if (dto.amountReceived === null) throw new InvalidOperationException("Amount Received is required for CSR funding.");
  } else {
    dto.globalGrantNumber = dto.hostClubsDistricts = dto.globalPartnerClubsDistricts = dto.csrCompanyName = null;
    dto.amountSanctioned = dto.amountReceived = dto.amountSpent = null;
  }
}

/** Columns copied when a district project/event moves to another year's table. */
const MOVE_COLUMNS =
  "fk_club_id, fk_district_id, fk_module_id, fk_year_id, DistrictProjectType, project_type, " +
  "parent_project_id, ongoing_group_title, is_joint_project, co_host_name, club_role, title, " +
  "description, location, fk_area_of_focus_id, other_area_of_focus, fk_category_id, other_category, " +
  "fk_sub_category_id, other_sub_category, project_date, project_cost, fk_funding_id, " +
  "direct_beneficiaries, man_hours, rotarians_involved, rotaractors_involved, rcc_involved, send_whatsapp, " +
  "meeting_type, agenda_document, minutes_document, attendance, attendance_percentage, " +
  "global_grant_number, amount_sanctioned, amount_received, amount_spent, host_clubs_districts, " +
  "global_partner_clubs_districts, csr_company_name, IsSendWhatsapp, WhatsAppSentDate, " +
  "WhatsAppSentCount, WhatsAppFailedCount, approval_status, approval_remark, approved_by, " +
  "approval_date, approval_token, is_active, created_by, created_date, modified_by, modified_date, " +
  "isdeleted, deleted_by, deleted_date, old_pk";

type Kind = "Project" | "Event";
const KIND_FILTER: Record<Kind, string> = {
  Project: "(p.DistrictProjectType = 'Project' OR p.DistrictProjectType IS NULL)",
  Event: "p.DistrictProjectType = 'Event'",
};
const FOLDER: Record<Kind, string> = { Project: "DistrictProject", Event: "DistrictEvent" };

/** Port of DistrictModulesController.cs, part 2: district projects and district events (rows in the year-wise project tables). */
@Controller("api/districts/:districtId")
@Authorize()
export class DistrictProjectsController {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly yearTables: YearTableResolver,
  ) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);
  private async blocked(districtId: number) {
    return !(await isDistrictDrillReachable(this.db, districtId)) ? statusCode(403, { message: DISTRICT_BLOCKED_MESSAGE }) : null;
  }
  private async tables(conn: DbCommands, yearId: number | null): Promise<YearTableInfo[]> {
    if (yearId === null) return this.yearTables.getAllExistingYearTables(conn);
    const t = await this.yearTables.resolveByYearId(conn, yearId);
    return t ? [t] : [];
  }
  private async requireTable(conn: DbCommands, yearId: number) {
    const t = await this.yearTables.resolveByYearId(conn, yearId);
    if (!t) throw new InvalidOperationException(`No year-wise table resolved for yearId ${yearId}.`);
    return t;
  }
  /** GetRotaryYearIdAsync: the year of the date, or the current year when there is none. */
  private static yearOf(conn: DbCommands, dateText: string | null) {
    return ensureRotaryYear(conn, tryParseDate(dateText));
  }
  private static async insertPhotos(conn: DbCommands, table: string, projectId: number, photos: Photo[], withDescription = true) {
    let sort = 0;
    for (const photo of photos) {
      await conn.execute(
        withDescription
          ? `INSERT INTO \`${table}\` (fk_project_id, image_path, description, is_primary, sort_order, created_date)
             VALUES (@ProjectId, @ImagePath, @Description, @IsPrimary, @SortOrder, NOW())`
          : `INSERT INTO \`${table}\` (fk_project_id, image_path, is_primary, sort_order, created_date)
             VALUES (@ProjectId, @ImagePath, @IsPrimary, @SortOrder, NOW())`,
        { ProjectId: projectId, ImagePath: fileName(photo.imagePath), Description: photo.description, IsPrimary: sort === 0 ? 1 : 0, SortOrder: sort },
      );
      sort++;
    }
  }
  private static moveConflict(kind: "project" | "event", yearId: number, toYearId: number, from: YearTableInfo, to: YearTableInfo | null) {
    const toLabel = to?.yearLabel ?? String(toYearId);
    return conflict({
      requiresMove: true, fromYearId: yearId, toYearId, fromYearLabel: from.yearLabel, toYearLabel: toLabel,
      message: `This ${kind}'s date moves it from ${from.yearLabel} to ${toLabel}. Move the ${kind} and its photos? It will get a new ID in ${toLabel}.`,
    });
  }

  private async list(kind: Kind, districtId: number, yearId: number | null, search: string | null, page: number, pageSize: number) {
    const block = await this.blocked(districtId);
    if (block) return block;
    return this.db.session(async (conn) => {
      const tables = await this.tables(conn, yearId);
      if (!tables.length) return ok({ items: [], totalCount: 0, page, pageSize });
      const where = `WHERE p.fk_district_id = @DistrictId AND ${KIND_FILTER[kind]} AND p.isdeleted = 0 AND (@Search IS NULL OR p.title LIKE CONCAT('%', @Search, '%'))`;
      const legs = tables.map((t) =>
        kind === "Project"
          ? `SELECT p.pk_project_id AS id, p.title, p.description, p.location, p.project_date AS projectDate, p.project_cost AS projectCost,
                    p.Currency AS currency, p.direct_beneficiaries AS directBeneficiaries, p.man_hours AS manHours,
                    p.rotarians_involved AS rotariansInvolved, p.rotaractors_involved AS rotaractorsInvolved, p.fk_year_id AS yearId,
                    aof.name AS areaOfFocusName, cat.name AS categoryName,
                    (SELECT CONCAT('/Documents/DistrictProject/', p.fk_district_id, '/', pp.image_path)
                       FROM \`${t.photosTable}\` pp WHERE pp.fk_project_id = p.pk_project_id LIMIT 1) AS primaryPhoto,
                    p.created_date AS createdDate
             FROM \`${t.projectsTable}\` p
             LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
             LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
             ${where}`
          : `SELECT p.pk_project_id AS id, p.title, p.description, p.project_date AS eventDate, p.fk_year_id AS yearId,
                    (SELECT CONCAT('/Documents/DistrictEvent/', p.fk_district_id, '/', pp.image_path)
                       FROM \`${t.photosTable}\` pp WHERE pp.fk_project_id = p.pk_project_id LIMIT 1) AS primaryPhoto,
                    p.created_date AS createdDate
             FROM \`${t.projectsTable}\` p
             ${where}`,
      );
      const params = { DistrictId: districtId, Search: search && search.trim() ? search : null, PageSize: pageSize, Offset: (page - 1) * pageSize };
      const items = await conn.query(`SELECT * FROM (${legs.join(" UNION ALL ")}) u ORDER BY u.createdDate DESC LIMIT @PageSize OFFSET @Offset`, params);
      if (kind === "Project") {
        // COALESCE(p.Currency, 'INR') in RIZones: a missing currency is the brand default.
        for (const i of items) i.currency = i.currency ?? resolveDefaultCurrency(null);
      }
      const counts = tables.map((t) => `SELECT COUNT(*) AS c FROM \`${t.projectsTable}\` p ${where}`);
      const totalCount = Number(await conn.executeScalar(`SELECT COALESCE(SUM(c), 0) FROM (${counts.join(" UNION ALL ")}) u`, params));
      return ok({ items, totalCount, page, pageSize });
    });
  }

  private async availableYears(kind: Kind, districtId: number) {
    const block = await this.blocked(districtId);
    if (block) return block;
    return this.db.session(async (conn) => {
      const tables = await this.yearTables.getAllExistingYearTables(conn);
      if (!tables.length) return ok([]);
      const legs = tables.map(
        (t) => `(SELECT ${t.yearId} AS id, '${t.yearLabel}' AS yearLabel,
                        (SELECT IsCurrent FROM rotary_year_master WHERE pk_year_id = ${t.yearId}) AS isCurrent
                 FROM \`${t.projectsTable}\` p
                 WHERE p.fk_district_id = @DistrictId AND ${KIND_FILTER[kind]} AND p.isdeleted = 0
                 LIMIT 1)`,
      );
      return ok(await conn.query(`SELECT * FROM (${legs.join(" UNION ALL ")}) u ORDER BY u.yearLabel DESC`, { DistrictId: districtId }));
    });
  }

  private async upload(kind: Kind, districtId: number, upload: Upload | undefined, strict: boolean) {
    const file = await ensureWithinLimit(upload);
    const v = validateImage(file, strict);
    if (!v.ok) return badRequest({ message: v.error });
    const name = await saveWithGuidName(this.config, file!, "Documents", FOLDER[kind], String(districtId));
    return ok({ path: `/Documents/${FOLDER[kind]}/${districtId}/${name}`, width: v.width, height: v.height, sizeBytes: v.sizeBytes });
  }

  private async softDelete(districtId: number, yearId: number, id: number, userId: number) {
    return this.db.session(async (conn) => {
      const info = await this.yearTables.resolveByYearId(conn, yearId);
      if (!info) return notFound();
      await conn.execute(
        `UPDATE \`${info.projectsTable}\` SET isdeleted=1, deleted_by=@UserId, deleted_date=NOW() WHERE pk_project_id=@Id AND fk_district_id=@DistrictId`,
        { Id: id, DistrictId: districtId, UserId: userId },
      );
      return ok({ message: "Deleted." });
    });
  }

  /** RelocateDistrictRowAsync: copy the row and its photos to the target year, verify, then remove the source. */
  private static async relocate(tx: DbCommands, src: YearTableInfo, tgt: YearTableInfo, id: number, districtId: number, newYearId: number, userId: number) {
    const selectCols = MOVE_COLUMNS.replace("fk_year_id", "@NewYearId AS fk_year_id");
    await tx.execute(
      `INSERT INTO \`${tgt.projectsTable}\` (${MOVE_COLUMNS})
       SELECT ${selectCols} FROM \`${src.projectsTable}\` WHERE pk_project_id=@Id AND fk_district_id=@DistrictId AND isdeleted=0`,
      { NewYearId: newYearId, Id: id, DistrictId: districtId },
    );
    const newId = Number(await tx.executeScalar("SELECT LAST_INSERT_ID()"));
    await tx.execute(
      `INSERT INTO \`${tgt.photosTable}\` (fk_project_id, image_path, description, is_primary, sort_order, created_date)
       SELECT @NewId, image_path, description, is_primary, sort_order, created_date FROM \`${src.photosTable}\` WHERE fk_project_id=@Id`,
      { NewId: newId, Id: id },
    );
    const srcPhotos = Number(await tx.executeScalar(`SELECT COUNT(*) FROM \`${src.photosTable}\` WHERE fk_project_id=@Id`, { Id: id }));
    const tgtPhotos = Number(await tx.executeScalar(`SELECT COUNT(*) FROM \`${tgt.photosTable}\` WHERE fk_project_id=@NewId`, { NewId: newId }));
    const tgtExists = Number(await tx.executeScalar(`SELECT COUNT(*) FROM \`${tgt.projectsTable}\` WHERE pk_project_id=@NewId`, { NewId: newId }));
    if (tgtExists !== 1 || srcPhotos !== tgtPhotos) {
      throw new InvalidOperationException(`Move verification failed (target rows=${tgtExists}, photos src=${srcPhotos}/tgt=${tgtPhotos}). Nothing deleted.`);
    }
    await tx.execute(`DELETE FROM \`${src.photosTable}\` WHERE fk_project_id=@Id`, { Id: id });
    await tx.execute(
      `UPDATE \`${src.projectsTable}\` SET isdeleted=1, deleted_by=@UserId, deleted_date=NOW() WHERE pk_project_id=@Id AND fk_district_id=@DistrictId`,
      { Id: id, DistrictId: districtId, UserId: userId },
    );
    return newId;
  }

  private static projectParams(dto: DistrictProject) {
    return {
      Title: dto.title, Description: dto.description, Location: dto.location, AreaOfFocusId: dto.areaOfFocusId, OtherAreaOfFocus: dto.otherAreaOfFocus,
      CategoryId: dto.categoryId, OtherCategory: dto.otherCategory, SubCategoryId: dto.subCategoryId, OtherSubCategory: dto.otherSubCategory,
      ProjectDate: tryParseDate(dto.projectDate) ?? dto.projectDate, ProjectCost: dto.projectCost, FundingId: dto.fundingId, GlobalGrantNumber: dto.globalGrantNumber,
      AmountSanctioned: dto.amountSanctioned, AmountReceived: dto.amountReceived, AmountSpent: dto.amountSpent, HostClubsDistricts: dto.hostClubsDistricts,
      GlobalPartnerClubsDistricts: dto.globalPartnerClubsDistricts, CsrCompanyName: dto.csrCompanyName, DirectBeneficiaries: dto.directBeneficiaries,
      ManHours: dto.manHours, RotariansInvolved: dto.rotariansInvolved, RotaractorsInvolved: dto.rotaractorsInvolved, RccInvolved: dto.rccInvolved ?? 0,
    };
  }

  private static async fundingClass(conn: DbCommands, fundingId: number | null) {
    if (fundingId === null || fundingId <= 0) return "";
    return classifyFunding(await conn.executeScalar<string>("SELECT name FROM funding_master WHERE pk_funding_id = @id AND isdeleted = 0", { id: fundingId }));
  }

  // ---- projects ----

  @Get("projects")
  async getProjects(
    @Param("districtId") d: string, @Query("yearId") y?: string, @Query("search") search?: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string,
  ) {
    const districtId = paramInt(d, "districtId");
    return this.list("Project", districtId, queryInt(y), queryString(search), queryInt(page, 1), queryInt(pageSize, 20));
  }

  @Get("projects/available-years")
  async projectYears(@Param("districtId") d: string) {
    return this.availableYears("Project", paramInt(d, "districtId"));
  }

  @Post("projects/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadProjectPhoto(@Param("districtId") d: string, @UploadedFile() file: Upload | undefined, @Query("strict") strict?: string) {
    requireFile(file);
    const districtId = paramInt(d, "districtId");
    return this.upload("Project", districtId, file, queryBool(strict, false)!);
  }

  @Get("projects/:yearId/:id")
  async getProject(@Param("districtId") d: string, @Param("yearId") y: string, @Param("id") i: string) {
    const [districtId, yearId, id] = [paramInt(d, "districtId"), paramInt(y, "yearId"), paramInt(i)];
    const block = await this.blocked(districtId);
    if (block) return block;
    return this.db.session(async (conn) => {
      const info = await this.yearTables.resolveByYearId(conn, yearId);
      if (!info) return notFound();
      const project = await conn.queryFirstOrDefault(
        `SELECT p.pk_project_id AS id, p.fk_year_id AS yearId, p.title, p.description, p.location, p.fk_area_of_focus_id AS areaOfFocusId,
                p.other_area_of_focus AS otherAreaOfFocus, p.fk_category_id AS categoryId, p.other_category AS otherCategory,
                p.fk_sub_category_id AS subCategoryId, p.other_sub_category AS otherSubCategory, p.project_date AS projectDate,
                p.project_cost AS projectCost, p.fk_funding_id AS fundingId, p.global_grant_number AS globalGrantNumber,
                p.amount_sanctioned AS amountSanctioned, p.amount_received AS amountReceived, p.amount_spent AS amountSpent,
                p.host_clubs_districts AS hostClubsDistricts, p.global_partner_clubs_districts AS globalPartnerClubsDistricts,
                p.csr_company_name AS csrCompanyName, p.direct_beneficiaries AS directBeneficiaries, p.man_hours AS manHours,
                p.rotarians_involved AS rotariansInvolved, p.rotaractors_involved AS rotaractorsInvolved
         FROM \`${info.projectsTable}\` p
         WHERE p.pk_project_id = @Id AND p.fk_district_id = @DistrictId AND p.isdeleted = 0`,
        { Id: id, DistrictId: districtId },
      );
      if (!project) return notFound();
      const photos = await conn.query(
        `SELECT pk_photo_id AS id, CONCAT('/Documents/DistrictProject/', @DistrictId, '/', image_path) AS imagePath,
                description, is_primary AS isPrimary, sort_order AS sortOrder
         FROM \`${info.photosTable}\` WHERE fk_project_id = @Id`,
        { Id: id, DistrictId: districtId },
      );
      return ok({ project, photos });
    });
  }

  @Post("projects")
  async createProject(@Param("districtId") d: string, @Body() body: unknown, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    const dto = bind(body);
    if (!dto.photos?.length) return badRequest({ message: "At least 1 photo is required to save this project." });
    const dateError = validateProjectDateText(dto.projectDate) ?? validateProjectDateText(dto.eventDate);
    if (dateError) return badRequest({ message: dateError });
    try {
      return await this.db.session(async (conn) => {
        const yearId = await DistrictProjectsController.yearOf(conn, dto.projectDate ?? dto.eventDate);
        const info = await this.requireTable(conn, yearId);
        const moduleId = Number((await conn.executeScalar("SELECT pk_module_id FROM module_master WHERE ModuleKey = 'community_service' AND isdeleted = 0 LIMIT 1")) ?? 0);
        normalizeFunding(await DistrictProjectsController.fundingClass(conn, dto.fundingId), dto);
        await conn.execute(
          `INSERT INTO \`${info.projectsTable}\` (fk_club_id, fk_district_id, fk_module_id, fk_year_id, DistrictProjectType,
               title, description, location, fk_area_of_focus_id, other_area_of_focus, fk_category_id, other_category, fk_sub_category_id, other_sub_category,
               project_date, project_cost, fk_funding_id,
               global_grant_number, amount_sanctioned, amount_received, amount_spent, host_clubs_districts, global_partner_clubs_districts, csr_company_name,
               direct_beneficiaries, man_hours, rotarians_involved, rotaractors_involved, rcc_involved, created_by, created_date)
           VALUES (0, @DistrictId, @ModuleId, @YearId, 'Project',
               @Title, @Description, @Location, @AreaOfFocusId, @OtherAreaOfFocus, @CategoryId, @OtherCategory, @SubCategoryId, @OtherSubCategory,
               @ProjectDate, @ProjectCost, @FundingId,
               @GlobalGrantNumber, @AmountSanctioned, @AmountReceived, @AmountSpent, @HostClubsDistricts, @GlobalPartnerClubsDistricts, @CsrCompanyName,
               @DirectBeneficiaries, @ManHours, @RotariansInvolved, @RotaractorsInvolved, @RccInvolved, @UserId, NOW())`,
          { ...DistrictProjectsController.projectParams(dto), DistrictId: districtId, ModuleId: moduleId, YearId: yearId, UserId: this.userId(u) },
        );
        const id = Number(await conn.executeScalar("SELECT LAST_INSERT_ID()"));
        await DistrictProjectsController.insertPhotos(conn, info.photosTable, id, dto.photos!);
        return ok({ id, yearId, message: "District project created." });
      });
    } catch (e) {
      if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
      return statusCode(500, { message: `Failed: ${e instanceof Error ? e.message : e}`, dtoTitle: dto.title, dtoDesc: dto.description });
    }
  }

  @Put("projects/:yearId/:id")
  async updateProject(@Param("districtId") d: string, @Param("yearId") y: string, @Param("id") i: string, @Body() body: unknown, @User() u: CurrentUser) {
    const [districtId, yearId, id] = [paramInt(d, "districtId"), paramInt(y, "yearId"), paramInt(i)];
    const dto = bind(body);
    if (!dto.photos?.length) return badRequest({ message: "At least 1 photo is required to save this project." });
    const dateError = validateProjectDateText(dto.projectDate) ?? validateProjectDateText(dto.eventDate);
    if (dateError) return badRequest({ message: dateError });
    return this.db.session(async (conn) => {
      const info = await this.requireTable(conn, yearId);
      const parsed = dto.projectDate && dto.projectDate.trim() ? tryParseDate(dto.projectDate) : null;
      if (parsed) {
        const dateYearId = await ensureRotaryYear(conn, parsed);
        if (dateYearId !== yearId) return DistrictProjectsController.moveConflict("project", yearId, dateYearId, info, await this.yearTables.resolveByYearId(conn, dateYearId));
      }
      try {
        normalizeFunding(await DistrictProjectsController.fundingClass(conn, dto.fundingId), dto);
      } catch (e) {
        if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
        throw e;
      }
      await conn.execute(
        `UPDATE \`${info.projectsTable}\` SET title=@Title, description=@Description, location=@Location,
             fk_area_of_focus_id=@AreaOfFocusId, other_area_of_focus=@OtherAreaOfFocus, fk_category_id=@CategoryId, other_category=@OtherCategory,
             fk_sub_category_id=@SubCategoryId, other_sub_category=@OtherSubCategory, project_date=@ProjectDate, project_cost=@ProjectCost,
             fk_funding_id=@FundingId, global_grant_number=@GlobalGrantNumber, amount_sanctioned=@AmountSanctioned, amount_received=@AmountReceived,
             amount_spent=@AmountSpent, host_clubs_districts=@HostClubsDistricts, global_partner_clubs_districts=@GlobalPartnerClubsDistricts,
             csr_company_name=@CsrCompanyName, direct_beneficiaries=@DirectBeneficiaries, man_hours=@ManHours, rotarians_involved=@RotariansInvolved,
             rotaractors_involved=@RotaractorsInvolved, rcc_involved=@RccInvolved, modified_by=@UserId, modified_date=NOW()
         WHERE pk_project_id=@Id AND fk_district_id=@DistrictId AND isdeleted=0`,
        { ...DistrictProjectsController.projectParams(dto), Id: id, DistrictId: districtId, UserId: this.userId(u) },
      );
      await conn.execute(`DELETE FROM \`${info.photosTable}\` WHERE fk_project_id=@Id`, { Id: id });
      await DistrictProjectsController.insertPhotos(conn, info.photosTable, id, dto.photos!);
      return ok({ message: "District project updated." });
    });
  }

  @Delete("projects/:yearId/:id")
  async deleteProject(@Param("districtId") d: string, @Param("yearId") y: string, @Param("id") i: string, @User() u: CurrentUser) {
    return this.softDelete(paramInt(d, "districtId"), paramInt(y, "yearId"), paramInt(i), this.userId(u));
  }

  @Post("projects/:yearId/:id/move")
  async moveProject(@Param("districtId") d: string, @Param("yearId") y: string, @Param("id") i: string, @Body() body: unknown, @User() u: CurrentUser) {
    const [districtId, yearId, id] = [paramInt(d, "districtId"), paramInt(y, "yearId"), paramInt(i)];
    const dto = bind(body);
    if (!dto.photos?.length) return badRequest({ message: "At least 1 photo is required to save this project." });
    const parsed = dto.projectDate && dto.projectDate.trim() ? tryParseDate(dto.projectDate) : null;
    if (!parsed) return badRequest({ message: "A valid project date is required to move the project." });
    const dateError = validateProjectDate(parsed);
    if (dateError) return badRequest({ message: dateError });
    return this.db.session(async (conn) => {
      const src = await this.requireTable(conn, yearId);
      const toYearId = await ensureRotaryYear(conn, parsed);
      if (toYearId === yearId) return badRequest({ message: "Project date is in the same year — use normal update, not move." });
      const tgt = await this.requireTable(conn, toYearId);
      try {
        const newId = await this.db.transaction(async (tx) => {
          const p = DistrictProjectsController.projectParams(dto);
          await tx.execute(
            `UPDATE \`${src.projectsTable}\` SET title=@Title, description=@Description, location=@Location,
                 fk_area_of_focus_id=@AreaOfFocusId, other_area_of_focus=@OtherAreaOfFocus, fk_category_id=@CategoryId, other_category=@OtherCategory,
                 fk_sub_category_id=@SubCategoryId, other_sub_category=@OtherSubCategory, project_date=@ProjectDate, project_cost=@ProjectCost,
                 fk_funding_id=@FundingId, direct_beneficiaries=@DirectBeneficiaries, man_hours=@ManHours, rotarians_involved=@RotariansInvolved,
                 rotaractors_involved=@RotaractorsInvolved, rcc_involved=@RccInvolved, modified_by=@UserId, modified_date=NOW()
             WHERE pk_project_id=@Id AND fk_district_id=@DistrictId AND isdeleted=0`,
            { ...p, Id: id, DistrictId: districtId, UserId: this.userId(u) },
          );
          await tx.execute(`DELETE FROM \`${src.photosTable}\` WHERE fk_project_id=@Id`, { Id: id });
          await DistrictProjectsController.insertPhotos(tx, src.photosTable, id, dto.photos!);
          return DistrictProjectsController.relocate(tx, src, tgt, id, districtId, toYearId, this.userId(u));
        });
        return ok({ message: `District project moved to ${tgt.yearLabel} successfully.`, newYearId: toYearId, newId, newYearLabel: tgt.yearLabel });
      } catch (e) {
        return badRequest({ message: e instanceof Error ? e.message : String(e) });
      }
    });
  }

  // ---- district events ----

  @Get("district-events")
  async getEvents(
    @Param("districtId") d: string, @Query("yearId") y?: string, @Query("search") search?: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string,
  ) {
    const districtId = paramInt(d, "districtId");
    return this.list("Event", districtId, queryInt(y), queryString(search), queryInt(page, 1), queryInt(pageSize, 20));
  }

  @Get("district-events/available-years")
  async eventYears(@Param("districtId") d: string) {
    return this.availableYears("Event", paramInt(d, "districtId"));
  }

  @Post("district-events/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadEventPhoto(@Param("districtId") d: string, @UploadedFile() file: Upload | undefined, @Query("strict") strict?: string) {
    requireFile(file);
    const districtId = paramInt(d, "districtId");
    return this.upload("Event", districtId, file, queryBool(strict, false)!);
  }

  @Get("district-events/:yearId/:id")
  async getEvent(@Param("districtId") d: string, @Param("yearId") y: string, @Param("id") i: string) {
    const [districtId, yearId, id] = [paramInt(d, "districtId"), paramInt(y, "yearId"), paramInt(i)];
    const block = await this.blocked(districtId);
    if (block) return block;
    return this.db.session(async (conn) => {
      const info = await this.yearTables.resolveByYearId(conn, yearId);
      if (!info) return notFound();
      const evt = await conn.queryFirstOrDefault(
        `SELECT p.pk_project_id AS id, p.fk_year_id AS yearId, p.title, p.description, p.project_date AS eventDate
         FROM \`${info.projectsTable}\` p
         WHERE p.pk_project_id = @Id AND p.fk_district_id = @DistrictId AND p.isdeleted = 0`,
        { Id: id, DistrictId: districtId },
      );
      if (!evt) return notFound();
      const photos = await conn.query(
        `SELECT pk_photo_id AS id, CONCAT('/Documents/DistrictEvent/', @DistrictId, '/', image_path) AS imagePath, description, sort_order AS sortOrder
         FROM \`${info.photosTable}\` WHERE fk_project_id = @Id`,
        { Id: id, DistrictId: districtId },
      );
      return ok({ eventDetail: evt, photos });
    });
  }

  @Post("district-events")
  async createEvent(@Param("districtId") d: string, @Body() body: unknown, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    const dto = bind(body);
    if (!dto.photos?.length) return badRequest({ message: "At least 1 photo is required to save this event." });
    const dateError = validateProjectDateText(dto.eventDate) ?? validateProjectDateText(dto.projectDate);
    if (dateError) return badRequest({ message: dateError });
    return this.db.session(async (conn) => {
      const yearId = await DistrictProjectsController.yearOf(conn, dto.projectDate ?? dto.eventDate);
      const info = await this.requireTable(conn, yearId);
      const moduleId = Number((await conn.executeScalar("SELECT pk_module_id FROM module_master WHERE ModuleKey = 'community_service' AND isdeleted = 0 LIMIT 1")) ?? 0);
      await conn.execute(
        `INSERT INTO \`${info.projectsTable}\` (fk_club_id, fk_district_id, fk_module_id, fk_year_id, DistrictProjectType, title, description, project_date, created_by, created_date)
         VALUES (0, @DistrictId, @ModuleId, @YearId, 'Event', @Title, @Description, @EventDate, @UserId, NOW())`,
        { DistrictId: districtId, ModuleId: moduleId, YearId: yearId, Title: dto.title, Description: dto.description, EventDate: tryParseDate(dto.eventDate) ?? dto.eventDate, UserId: this.userId(u) },
      );
      const id = Number(await conn.executeScalar("SELECT LAST_INSERT_ID()"));
      await DistrictProjectsController.insertPhotos(conn, info.photosTable, id, dto.photos!);
      return ok({ id, yearId, message: "District event created." });
    });
  }

  @Put("district-events/:yearId/:id")
  async updateEvent(@Param("districtId") d: string, @Param("yearId") y: string, @Param("id") i: string, @Body() body: unknown, @User() u: CurrentUser) {
    const [districtId, yearId, id] = [paramInt(d, "districtId"), paramInt(y, "yearId"), paramInt(i)];
    const dto = bind(body);
    if (!dto.photos?.length) return badRequest({ message: "At least 1 photo is required to save this event." });
    const dateError = validateProjectDateText(dto.eventDate) ?? validateProjectDateText(dto.projectDate);
    if (dateError) return badRequest({ message: dateError });
    return this.db.session(async (conn) => {
      const info = await this.requireTable(conn, yearId);
      const parsed = dto.eventDate && dto.eventDate.trim() ? tryParseDate(dto.eventDate) : null;
      if (parsed) {
        const dateYearId = await ensureRotaryYear(conn, parsed);
        if (dateYearId !== yearId) return DistrictProjectsController.moveConflict("event", yearId, dateYearId, info, await this.yearTables.resolveByYearId(conn, dateYearId));
      }
      await conn.execute(
        `UPDATE \`${info.projectsTable}\` SET title=@Title, description=@Description, project_date=@EventDate, modified_by=@UserId, modified_date=NOW()
         WHERE pk_project_id=@Id AND fk_district_id=@DistrictId AND isdeleted=0`,
        { Id: id, DistrictId: districtId, Title: dto.title, Description: dto.description, EventDate: parsed ?? dto.eventDate, UserId: this.userId(u) },
      );
      await conn.execute(`DELETE FROM \`${info.photosTable}\` WHERE fk_project_id=@Id`, { Id: id });
      await DistrictProjectsController.insertPhotos(conn, info.photosTable, id, dto.photos!);
      return ok({ message: "District event updated." });
    });
  }

  @Delete("district-events/:yearId/:id")
  async deleteEvent(@Param("districtId") d: string, @Param("yearId") y: string, @Param("id") i: string, @User() u: CurrentUser) {
    return this.softDelete(paramInt(d, "districtId"), paramInt(y, "yearId"), paramInt(i), this.userId(u));
  }

  @Post("district-events/:yearId/:id/move")
  async moveEvent(@Param("districtId") d: string, @Param("yearId") y: string, @Param("id") i: string, @Body() body: unknown, @User() u: CurrentUser) {
    const [districtId, yearId, id] = [paramInt(d, "districtId"), paramInt(y, "yearId"), paramInt(i)];
    const dto = bind(body);
    if (!dto.photos?.length) return badRequest({ message: "At least 1 photo is required to save this event." });
    const parsed = dto.eventDate && dto.eventDate.trim() ? tryParseDate(dto.eventDate) : null;
    if (!parsed) return badRequest({ message: "A valid event date is required to move the event." });
    const dateError = validateProjectDate(parsed);
    if (dateError) return badRequest({ message: dateError });
    return this.db.session(async (conn) => {
      const src = await this.requireTable(conn, yearId);
      const toYearId = await ensureRotaryYear(conn, parsed);
      if (toYearId === yearId) return badRequest({ message: "Event date is in the same year — use normal update, not move." });
      const tgt = await this.requireTable(conn, toYearId);
      try {
        const newId = await this.db.transaction(async (tx) => {
          await tx.execute(
            `UPDATE \`${src.projectsTable}\` SET title=@Title, description=@Description, project_date=@EventDate, modified_by=@UserId, modified_date=NOW()
             WHERE pk_project_id=@Id AND fk_district_id=@DistrictId AND isdeleted=0`,
            { Id: id, DistrictId: districtId, Title: dto.title, Description: dto.description, EventDate: parsed, UserId: this.userId(u) },
          );
          await tx.execute(`DELETE FROM \`${src.photosTable}\` WHERE fk_project_id=@Id`, { Id: id });
          // As in RIZones the event move drops photo descriptions.
          await DistrictProjectsController.insertPhotos(tx, src.photosTable, id, dto.photos!, false);
          return DistrictProjectsController.relocate(tx, src, tgt, id, districtId, toYearId, this.userId(u));
        });
        return ok({ message: `District event moved to ${tgt.yearLabel} successfully.`, newYearId: toYearId, newId, newYearLabel: tgt.yearLabel });
      } catch (e) {
        return badRequest({ message: e instanceof Error ? e.message : String(e) });
      }
    });
  }
}
