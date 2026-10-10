import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { basename } from "node:path";
import { AllowAnonymous, Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField, dbDateTime, paramInt, queryInt, queryString, requireQuery, requireFile } from "../../common/binding";
import { formatDate, nowIn } from "../../common/dotnet-format";
import { InvalidOperationException, KeyNotFoundException } from "../../common/exceptions";
import { badRequest, file, forbid, notFound, ok, statusCode } from "../../common/results";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { Db, type DbCommands } from "../../database/db.service";
import { CLUB_BLOCKED_MESSAGE, isClubDrillReachable } from "../../services/kill-switch.helper";
import { cogJoinedDateExpr, cogSelectColumns } from "../../services/cog-designation.helper";
import { lowerExtension, webRootPath, type UploadedFile as Upload } from "../../services/media-storage";
import { OcvLiveVisibility } from "../../services/ocv-live-visibility";
import { YearTableResolver } from "../../services/year-table.resolver";
import { loadMediaBytes } from "../monthly-reports/cmr-documents";
import { buildOcvExcel, buildOcvModuleReport, buildOcvWordReport } from "./ocv-report-documents";
import { NEWSLETTER_PATH, OcvGovService, PROJECT_MODULES, type OcvWordReportData } from "./ocv-gov.service";

const ALLOWED = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".jpg", ".jpeg", ".png", ".gif"];
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const now = () => nowIn(Brand.Current.locale.defaultTimeZone);
const requestBase = (req: Request) => `${req.protocol}://${req.get("host")}${req.baseUrl ?? ""}`;
const intField = (b: unknown, k: string) => { const n = Number(bodyField(b, k)); return Number.isFinite(n) ? Math.trunc(n) : 0; };
const strField = (b: unknown, k: string) => { const v = bodyField(b, k); return v === null || v === undefined || v === "" ? null : String(v); };
const decField = (b: unknown, k: string) => { const v = strField(b, k); return v === null || !Number.isFinite(Number(v)) ? null : Number(v); };
/** DateTime? from a form field, echoed the way System.Text.Json writes it. */
const dateField = (b: unknown, k: string) => dbDateTime(bodyField(b, k));
const echoDate = (v: string | null) => (v ? v.replace(" ", "T") : null);

/** Port of OcvGovController.cs: club OCV / GOV compliance documents and reports. */
@Controller("api/clubs/:clubId/ocv-gov")
@Authorize()
export class OcvGovController {
  constructor(private readonly ocv: OcvGovService, private readonly db: Db, private readonly config: AppConfig) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10) || 0;
  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roleName") ?? "") === "SuperAdmin";
  private async blocked(clubId: number) {
    return !(await isClubDrillReachable(this.db, clubId)) ? statusCode(403, { message: CLUB_BLOCKED_MESSAGE }) : null;
  }
  private get redirect() { return this.config.get("Media:RedirectBaseUrl") ?? null; }

  @Get("categories")
  async categories(@Param("clubId") c: string) {
    const clubId = paramInt(c, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.ocv.categories());
  }

  @Get("document-types/:categoryId")
  async documentTypes(@Param("clubId") c: string, @Param("categoryId") cat: string) {
    const clubId = paramInt(c, "clubId"), categoryId = paramInt(cat, "categoryId");
    return (await this.blocked(clubId)) ?? ok(await this.ocv.documentTypes(categoryId));
  }

  @Get("documents/:categoryId")
  async documents(@Param("clubId") c: string, @Param("categoryId") cat: string, @Query("yearId") y?: string) {
    const clubId = paramInt(c, "clubId"), categoryId = paramInt(cat, "categoryId");
    return (await this.blocked(clubId)) ?? ok(await this.ocv.documents(clubId, queryInt(y, 0), categoryId));
  }

  @Post("documents")
  @UseInterceptors(FileInterceptor("file"))
  async upload(@Param("clubId") c: string, @Body() body: unknown, @User() u: CurrentUser, @UploadedFile() f?: Upload) {
    requireFile(f);
    const clubId = paramInt(c, "clubId");
    if (!f || f.size === 0) return badRequest({ message: "No file uploaded." });
    if (!ALLOWED.includes(lowerExtension(f.originalname))) return badRequest({ message: "Invalid file type. Allowed: PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG, GIF" });
    // RIZones quirk kept: the limit is 20 MB, the message says 10MB.
    if (f.size > 20 * 1024 * 1024) return badRequest({ message: "File size must be less than 10MB." });
    try {
      const paidOn = dateField(body, "paidOn");
      const r = await this.ocv.uploadDocument(clubId, {
        yearId: intField(body, "yearId"), categoryId: intField(body, "categoryId"), typeId: intField(body, "typeId"), customTypeName: strField(body, "customTypeName"),
        amount: decField(body, "amount"), paidOn,
      }, f, this.userId(u), now());
      return ok({ ...r, paidOn: echoDate(paidOn) });
    } catch (e) {
      if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
      throw e;
    }
  }

  @Put("documents/:documentId")
  @UseInterceptors(FileInterceptor("file"))
  async update(@Param("clubId") c: string, @Param("documentId") d: string, @Body() body: unknown, @UploadedFile() f?: Upload) {
    const clubId = paramInt(c, "clubId"), documentId = paramInt(d, "documentId");
    const hasFile = !!f && f.size > 0;
    if (hasFile && !ALLOWED.includes(lowerExtension(f!.originalname))) return badRequest({ message: "Invalid file type. Allowed: PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG, GIF" });
    try {
      const paidOn = dateField(body, "paidOn");
      const r = await this.ocv.updateDocument(clubId, documentId, { typeId: intField(body, "typeId"), customTypeName: strField(body, "customTypeName"), amount: decField(body, "amount"), paidOn },
        hasFile ? f! : null, now());
      return ok({ ...r, paidOn: echoDate(paidOn) });
    } catch (e) {
      if (e instanceof KeyNotFoundException) return notFound({ message: e.message });
      throw e;
    }
  }

  @Delete("documents/:documentId")
  async remove(@Param("clubId") c: string, @Param("documentId") d: string) {
    paramInt(c, "clubId");
    await this.ocv.deleteDocument(paramInt(d, "documentId"));
    return ok({ message: "Document deleted successfully." });
  }

  /** Always an attachment; disk first, then the media host. */
  @Get("documents/:documentId/download")
  async download(@Param("clubId") c: string, @Param("documentId") d: string) {
    const clubId = paramInt(c, "clubId"), documentId = paramInt(d, "documentId");
    const block = await this.blocked(clubId);
    if (block) return block;
    const info = await this.ocv.documentFile(clubId, documentId);
    if (!info) return notFound({ message: "Document not found." });
    const webPath = "/" + (info.filePath ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
    const bytes = await loadMediaBytes(webRootPath(this.config), this.redirect, webPath);
    if (!bytes || bytes.length === 0) return notFound({ message: "File not found." });
    return file(bytes, "application/octet-stream", info.originalFileName && info.originalFileName.trim() ? info.originalFileName : basename(webPath));
  }

  @Get("report")
  async report(@Param("clubId") c: string, @Query("yearId") y?: string, @Query("status") s?: string) {
    const clubId = paramInt(c, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.ocv.report(clubId, queryInt(y, 0), queryString(s, "all")));
  }

  @Get("report/word")
  async reportWord(@Param("clubId") c: string, @Req() req: Request, @Query("yearId") y?: string) {
    const clubId = paramInt(c, "clubId"), yearId = queryInt(y, 0);
    const block = await this.blocked(clubId);
    if (block) return block;
    if (yearId <= 0) return badRequest({ message: "yearId is required." });
    try {
      const data = await this.ocv.wordReportData(clubId, yearId);
      const root = webRootPath(this.config);
      for (const d of data.documents) if (["jpg", "jpeg", "png", "gif"].includes(d.extension)) d.imageBytes = await loadMediaBytes(root, this.redirect, d.filePath);
      await loadProjectImages(data, root, this.redirect);
      const items = await this.ocv.report(clubId, yearId, "all");
      const mediaBase = this.redirect && this.redirect.trim() ? this.redirect : requestBase(req);
      const bytes = await buildOcvWordReport(data, items, mediaBase);
      return file(bytes, DOCX, `OCV_Report_${data.clubName}_${data.yearLabel}.docx`.replace(/ /g, "_").replace(/\//g, "-"));
    } catch (e) {
      return statusCode(500, { message: `Failed to generate Word report: ${message(e)}`, detail: null });
    }
  }

  /** The legacy "OCVList….xls": an HTML table served as application/vnd.ms-excel. */
  @Get("report/excel")
  async reportExcel(@Param("clubId") c: string, @Req() req: Request, @Query("yearId") y?: string) {
    const clubId = paramInt(c, "clubId"), yearId = queryInt(y, 0);
    const block = await this.blocked(clubId);
    if (block) return block;
    if (yearId <= 0) return badRequest({ message: "yearId is required." });
    try {
      const header = await this.ocv.wordReportData(clubId, yearId);
      const items = await this.ocv.report(clubId, yearId, "all");
      const mediaBase = this.redirect && this.redirect.trim() ? this.redirect : requestBase(req);
      const bytes = buildOcvExcel(header, items, clubId, yearId, mediaBase, this.config.get("FrontendUrl") ?? "");
      const name = `OCV_Report_${header.clubName}_${formatDate(now(), "yyyy-MM-dd_HH-mm-ss")}.xls`.replace(/ /g, "_").replace(/\//g, "-");
      return file(bytes, "application/vnd.ms-excel", name);
    } catch (e) {
      return statusCode(500, { message: `Failed to generate Excel report: ${message(e)}`, detail: null });
    }
  }

  @Get("report/live-tables")
  async liveTables(@Param("clubId") c: string, @Query("yearId") y?: string) {
    const clubId = paramInt(c, "clubId"), yearId = queryInt(y, 0);
    const block = await this.blocked(clubId);
    if (block) return block;
    if (yearId <= 0) return badRequest({ message: "yearId is required." });
    try {
      const data = await this.ocv.wordReportData(clubId, yearId);
      return ok(data.liveTables.map((t) => ({ label: t.label, headers: t.headers, rows: t.rows })));
    } catch (e) {
      return statusCode(500, { message: `Failed to load live documents: ${message(e)}` });
    }
  }

  @Post("settings/document-types")
  async createType(@Param("clubId") c: string, @Body() body: unknown, @User() u: CurrentUser) {
    paramInt(c, "clubId");
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.ocv.createDocumentType({ categoryId: intField(body, "categoryId"), typeName: strField(body, "typeName") ?? "", allowMultiple: bodyField(body, "allowMultiple") === true, sortOrder: intField(body, "sortOrder") }));
  }

  @Put("settings/document-types/:typeId")
  async updateType(@Param("clubId") c: string, @Param("typeId") t: string, @Body() body: unknown, @User() u: CurrentUser) {
    paramInt(c, "clubId");
    const typeId = paramInt(t, "typeId");
    if (!this.isSuperAdmin(u)) return forbid();
    await this.ocv.updateDocumentType(typeId, { typeName: strField(body, "typeName") ?? "", allowMultiple: bodyField(body, "allowMultiple") === true, sortOrder: intField(body, "sortOrder") });
    return ok({ message: "Document type updated successfully." });
  }

  @Delete("settings/document-types/:typeId")
  async deleteType(@Param("clubId") c: string, @Param("typeId") t: string, @User() u: CurrentUser) {
    paramInt(c, "clubId");
    const typeId = paramInt(t, "typeId");
    if (!this.isSuperAdmin(u)) return forbid();
    await this.ocv.deleteDocumentType(typeId);
    return ok({ message: "Document type deleted successfully." });
  }
}

async function loadProjectImages(data: OcvWordReportData, root: string, redirect: string | null, moduleKey?: string) {
  for (const pm of data.projectModules)
    if (!moduleKey || pm.moduleKey.toLowerCase() === moduleKey)
      for (const pr of pm.projects) for (const img of pr.images) img.imageBytes = await loadMediaBytes(root, redirect, img.imagePath);
}

const PROJECT_KEYS = new Set(PROJECT_MODULES.map(([k]) => k));
const TABLE_KEYS = new Set(["announcements", "upcoming_events", "documents", "attendance", "board_of_directors", "members", "trf_contributions"]);
const known = (k: string) => PROJECT_KEYS.has(k) || TABLE_KEYS.has(k) || k === "newsletters";

/** Port of PublicOcvLiveDocumentsController.cs: no-login view of one OCV Live Documents module (linked from the OCV Excel). */
@Controller("api/public/ocv-live-documents")
@AllowAnonymous()
export class PublicOcvLiveDocumentsController {
  constructor(private readonly ocv: OcvGovService, private readonly db: Db, private readonly config: AppConfig) {}

  private mediaBase(req: Request) {
    const r = this.config.get("Media:RedirectBaseUrl");
    return (r && r.trim() ? r : requestBase(req)).replace(/\/+$/, "");
  }
  private abs = (base: string, path: string | null | undefined) => (!path || !path.trim() ? "" : /^http/i.test(path) ? path : path.startsWith("/") ? base + path : `${base}/${path}`);

  private headerObj(d: OcvWordReportData, moduleKey: string, moduleLabel: string) {
    return {
      clubName: d.clubName,
      clubDisplayName: !d.clubName.trim() ? "Rotary Club" : /^rotary/i.test(d.clubName) ? d.clubName : `Rotary Club of ${d.clubName}`,
      zoneName: d.zoneName, districtNumber: d.districtNumber, clubRotaryId: d.clubRotaryId, presidentName: d.presidentName, assistantGovernorName: d.assistantGovernorName,
      yearLabel: d.yearLabel, generatedAt: formatDate(now(), "dd MMM yyyy HH:mm"), moduleKey, moduleLabel,
    };
  }

  /** null = the request is fine; otherwise the error result. */
  private async check(clubId: number, yearId: number, key: string | null) {
    if (clubId <= 0 || yearId <= 0 || !key || !key.trim()) return badRequest({ message: "clubId, yearId and moduleKey are required." });
    if (!known(key.toLowerCase())) return badRequest({ message: "Unknown module." });
    if (!(await isClubDrillReachable(this.db, clubId))) return notFound({ message: "Not available." });
    return null;
  }

  @Get()
  async module(@Req() req: Request, @Query("clubId") c?: string, @Query("yearId") y?: string, @Query("moduleKey") m?: string) {
    const clubId = queryInt(c, 0), yearId = queryInt(y, 0), moduleKey = queryString(m);
    const bad = await this.check(clubId, yearId, moduleKey);
    if (bad) return bad;
    const key = moduleKey!.toLowerCase();
    const data = await this.ocv.wordReportData(clubId, yearId);
    const base = this.mediaBase(req);
    if (PROJECT_KEYS.has(key)) {
      const pm = data.projectModules.find((x) => x.moduleKey.toLowerCase() === key);
      if (!pm) return notFound({ message: "Not available." });
      return ok({
        kind: "projects", header: this.headerObj(data, pm.moduleKey, pm.label),
        projects: pm.projects.map((p) => ({ title: p.title, description: p.description, fields: p.fields.map(([label, value]) => ({ label, value })),
          images: p.images.map((im) => ({ url: this.abs(base, im.imagePath), caption: im.caption })) })),
      });
    }
    if (key === "newsletters")
      return ok({
        kind: "newsletters", header: this.headerObj(data, "newsletters", "Newsletters"),
        newsletters: data.newsletters.map((n) => ({ title: n.title, publishDate: n.publishDate ? formatDate(n.publishDate, "dd MMM yyyy") : null, attachmentType: n.attachmentType, status: n.status,
          url: this.abs(base, n.filePath && n.filePath.trim() ? n.filePath : n.linkUrl) })),
      });
    const t = data.liveTables.find((x) => x.moduleKey.toLowerCase() === key);
    if (!t) return notFound({ message: "Not available." });
    return ok({ kind: "table", header: this.headerObj(data, t.moduleKey, t.label), table: { headers: t.headers, rows: t.rows } });
  }

  @Get("word")
  async word(@Req() req: Request, @Query("clubId") c?: string, @Query("yearId") y?: string, @Query("moduleKey") m?: string) {
    const clubId = queryInt(c, 0), yearId = queryInt(y, 0), moduleKey = queryString(m);
    const bad = await this.check(clubId, yearId, moduleKey);
    if (bad) return bad;
    const key = moduleKey!.toLowerCase();
    try {
      const data = await this.ocv.wordReportData(clubId, yearId);
      const pm = data.projectModules.find((x) => x.moduleKey.toLowerCase() === key);
      const t = data.liveTables.find((x) => x.moduleKey.toLowerCase() === key);
      if (!pm && !t && key !== "newsletters") return notFound({ message: "Not available." });
      const label = pm?.label ?? t?.label ?? "Newsletters";
      if (pm) await loadProjectImages(data, webRootPath(this.config), this.config.get("Media:RedirectBaseUrl") ?? null, key);
      const bytes = await buildOcvModuleReport(data, moduleKey!, this.mediaBase(req));
      return file(bytes, DOCX, `OCV_${label}_${data.clubName}_${data.yearLabel}.docx`.replace(/ /g, "_").replace(/\//g, "-"));
    } catch (e) {
      return statusCode(500, { message: `Failed to generate Word report: ${message(e)}` });
    }
  }
}

/** Port of LiveDocumentsExportController.cs: one module's raw rows as JSON, for the in-app export. */
@Controller("api/clubs/:clubId/live-documents")
@Authorize()
export class LiveDocumentsExportController {
  constructor(private readonly db: Db, private readonly yearTables: YearTableResolver) {}

  @Get("export")
  async export(@Param("clubId") c: string, @Query("yearId") y?: string, @Query("module") m?: string) {
    requireQuery({ module: m });
    const clubId = paramInt(c, "clubId"), yearId = queryInt(y, 0), module = queryString(m);
    if (!(await isClubDrillReachable(this.db, clubId))) return statusCode(403, { message: CLUB_BLOCKED_MESSAGE });
    if (yearId <= 0 || !module || !module.trim()) return badRequest({ message: "yearId and module are required." });
    const data = await this.db.session((conn) => this.rows(conn, clubId, yearId, module));
    return data === null ? badRequest({ message: `Unknown module: ${module}` }) : ok(data);
  }

  private async rows(conn: DbCommands, clubId: number, yearId: number, module: string) {
    const p = { ClubId: clubId, YearId: yearId };
    const inYear = (col: string) => `${col} >= y.StartDate AND ${col} < DATE_ADD(y.EndDate, INTERVAL 1 DAY)`;
    switch (module.toLowerCase()) {
      case "static_documents": case "financial_documents": case "trust_documents": case "grants": case "additional_documents": case "dues":
        return conn.query(
          `SELECT dt.TypeName AS documentType, d.OriginalFileName AS fileName, d.FileSize AS fileSize, d.Amount AS amount, d.PaidOn AS paidOn,
                  d.CustomTypeName AS customType, d.created_date AS uploadDate
           FROM ocv_documents d
           JOIN ocv_document_category c ON c.pk_category_id = d.fk_category_id
           JOIN ocv_document_type dt ON dt.pk_type_id = d.fk_type_id
           WHERE d.fk_club_id = @ClubId AND d.fk_year_id = @YearId AND d.isdeleted = 0 AND c.CategoryCode = @Code
           ORDER BY dt.SortOrder, d.created_date`, { ...p, Code: module });
      // RIZones quirk kept: "community_service" returns every module, and the hyphenated keys below match no module_master.ModuleKey.
      case "projects": case "community_service": return this.projects(conn, clubId, yearId, null);
      case "vocational_service": return this.projects(conn, clubId, yearId, "vocational-service");
      case "international_service": return this.projects(conn, clubId, yearId, "international-service");
      case "new_generation_service": return this.projects(conn, clubId, yearId, "new-generation-service");
      case "public_image_initiative": return this.projects(conn, clubId, yearId, "public-image-initiative");
      case "club_service": return this.projects(conn, clubId, yearId, "club-service");
      case "announcements":
        return conn.query(
          `SELECT a.Title AS title, a.Description AS description, a.PublishDateTime AS publishDate, a.ExpiryDateTime AS expiryDate, a.IsDisplayOnBanner AS isDisplayOnBanner,
                  a.IsSendWhatsapp AS isSendWhatsapp, a.created_date AS createdDate,
                  CASE WHEN NOW() < a.PublishDateTime THEN 'Unpublished' WHEN NOW() > a.ExpiryDateTime THEN 'Expired' ELSE 'Published' END AS status
           FROM announcements a JOIN rotary_year_master y ON y.pk_year_id = @YearId
           WHERE a.fk_club_id = @ClubId AND a.isdeleted = 0 AND ${inYear("a.PublishDateTime")} ORDER BY a.PublishDateTime DESC`, p);
      case "upcoming_events":
        return conn.query(
          `SELECT e.Title AS title, e.Description AS description, e.EventDate AS eventDate, e.EventVenue AS eventVenue, e.PublishDate AS publishDate, e.ExpiryDate AS expiryDate,
                  e.RegistrationLink AS registrationLink, e.IsSendWhatsapp AS isSendWhatsapp, e.created_date AS createdDate,
                  CASE WHEN NOW() < e.PublishDate THEN 'Unpublished' WHEN NOW() > e.ExpiryDate THEN 'Expired' ELSE 'Published' END AS status
           FROM upcoming_events e JOIN rotary_year_master y ON y.pk_year_id = @YearId
           WHERE e.fk_club_id = @ClubId AND e.isdeleted = 0 AND ${OcvLiveVisibility.upcomingEvents("e")} AND ${inYear("e.PublishDate")} ORDER BY e.EventDate DESC`, p);
      case "newsletters":
        return conn.query(
          `SELECT n.Title AS title, n.PublishDateTime AS publishDate, n.ExpiryDateTime AS expiryDate, n.AttachmentType AS attachmentType, n.LinkUrl AS linkUrl,
                  ${NEWSLETTER_PATH} AS filePath, n.IsSendWhatsapp AS isSendWhatsapp, n.created_date AS createdDate,
                  CASE WHEN NOW() < n.PublishDateTime THEN 'Unpublished' WHEN NOW() > n.ExpiryDateTime THEN 'Expired' ELSE 'Published' END AS status
           FROM newsletters n JOIN rotary_year_master y ON y.pk_year_id = @YearId
           WHERE n.fk_club_id = @ClubId AND n.isdeleted = 0 AND ${OcvLiveVisibility.newsletters("n")} AND ${inYear("n.PublishDateTime")} ORDER BY n.PublishDateTime DESC`, p);
      case "documents":
        return conn.query(
          `SELECT cd.Title AS title, cd.AccessType AS accessType,
                  CASE WHEN cd.FilePath IS NULL OR cd.FilePath = '' THEN NULL WHEN cd.FilePath LIKE '/%' THEN cd.FilePath
                       WHEN cd.Scope = 'ri' THEN CONCAT('/Documents/documentsafe/ri/', cd.FilePath)
                       WHEN cd.fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', cd.fk_district_id, '/', cd.FilePath)
                       ELSE CONCAT('/Documents/documentsafe/Group', cd.fk_club_id, '/', cd.FilePath) END AS filePath,
                  cd.PublishDateTime AS publishDate, cd.ExpiryDateTime AS expiryDate, cd.created_date AS createdDate
           FROM club_documents cd JOIN rotary_year_master y ON y.pk_year_id = @YearId
           WHERE cd.fk_club_id = @ClubId AND cd.isdeleted = 0 AND ${OcvLiveVisibility.clubDocuments("cd")} AND ${inYear("cd.PublishDateTime")} ORDER BY cd.PublishDateTime DESC`, p);
      case "attendance": {
        const total = Number(await conn.executeScalar("SELECT COUNT(*) FROM club_members WHERE fk_club_id = @C AND IsActive = 1 AND isdeleted = 0", { C: clubId }));
        return conn.query(
          `SELECT a.EventName AS eventName, a.EventDateTime AS eventDateTime,
                  (SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) AS membersPresent,
                  (SELECT COUNT(*) FROM club_attendance_visitors v WHERE v.fk_attendance_id = a.pk_attendance_id) AS visitors,
                  (SELECT COUNT(*) FROM club_attendance_rotarians r WHERE r.fk_attendance_id = a.pk_attendance_id) AS rotarians,
                  @Total AS totalMembers,
                  ROUND((SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) * 100.0 / NULLIF(@Total, 0), 1) AS attendancePercent,
                  a.created_date AS createdDate
           FROM club_attendance a WHERE a.fk_club_id = @ClubId AND a.fk_year_id = @YearId AND a.isdeleted = 0 ORDER BY a.EventDateTime DESC`, { ...p, Total: total });
      }
      case "board_of_directors":
        return conn.query(
          `SELECT m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email, dm.designation_name AS designation, dm.sort_order AS sortOrder
           FROM board_of_directors b
           JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
           JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
           WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId AND b.isdeleted = 0 ORDER BY dm.sort_order`, p);
      case "members": {
        const rows = await conn.query(
          `SELECT m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email, m.RotaryId AS rotaryId, m.Gender AS gender, m.BirthDate AS birthDate,
                  m.AnniversaryDate AS anniversaryDate, m.BloodGroup AS bloodGroup, ${cogJoinedDateExpr("cm")} AS joinedDate, cm.IsActive AS isActive,
                  ${cogSelectColumns("cm")}
           FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
           WHERE cm.fk_club_id = @ClubId AND cm.isdeleted = 0 ORDER BY m.MemberName`, p);
        if (!Brand.feature("member.bloodGroup")) for (const r of rows) r.bloodGroup = null;
        return rows;
      }
      case "trf_contributions":
        return conn.query(
          `SELECT t.TrfDate AS trfDate, t.DonorName AS donorName, t.AmountUSD AS amountUsd, t.FundType AS fundType, t.OtherFundName AS otherFundName,
                  COALESCE(f.FundName, t.OtherFundName) AS fundName, t.created_date AS createdDate
           FROM trf_contributions t LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
           WHERE t.fk_club_id = @ClubId AND t.fk_year_id = @YearId AND t.isdeleted = 0 ORDER BY t.TrfDate DESC`, p);
      default:
        return null;
    }
  }

  private async projects(conn: DbCommands, clubId: number, yearId: number, moduleKey: string | null) {
    const info = await this.yearTables.resolveByYearId(conn, yearId);
    if (!info) return [];
    return conn.query(
      `SELECT p.title, p.description, p.location, p.project_date AS projectDate, p.project_cost AS projectCost, p.direct_beneficiaries AS directBeneficiaries,
              p.man_hours AS manHours, p.rotarians_involved AS rotariansInvolved, p.rotaractors_involved AS rotaractorsInvolved, COALESCE(p.rcc_involved,0) AS rccInvolved,
              af.name AS areaOfFocus, cat.name AS category, sc.name AS subCategory, f.name AS funding, p.approval_status AS approvalStatus, mm.ModuleName AS moduleName, p.created_date AS createdDate
       FROM \`${info.projectsTable}\` p
       LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
       LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
       LEFT JOIN sub_category_master sc ON sc.pk_sub_category_id = p.fk_sub_category_id
       LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
       LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
       WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0 ${moduleKey ? "AND mm.ModuleKey = @ModuleKey" : ""}
       ORDER BY p.project_date DESC`, { ClubId: clubId, ModuleKey: moduleKey ?? "" });
  }
}
