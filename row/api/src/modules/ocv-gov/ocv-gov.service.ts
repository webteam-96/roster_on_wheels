import { Injectable } from "@nestjs/common";
import { unlink } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { InvalidOperationException, KeyNotFoundException } from "../../common/exceptions";
import { AppConfig } from "../../config/app-config";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { saveWithReadableName, webRootPath, type UploadedFile } from "../../services/media-storage";
import { OcvLiveVisibility } from "../../services/ocv-live-visibility";
import { YearTableResolver, type YearTableInfo } from "../../services/year-table.resolver";


export interface OcvReportItem {
  categoryName: string; categoryCode: string; categoryId: number; typeId: number; typeName: string; isUploaded: boolean; documentId: number | null; filePath: string | null; originalFileName: string | null;
}
export interface OcvWordDocument {
  categoryCode: string; categoryName: string; typeName: string; customTypeName: string | null; originalFileName: string | null; filePath: string | null;
  amount: number | null; paidOn: string | null; createdDate: string | null; extension: string; imageBytes?: Buffer | null;
}
export interface OcvWordModuleTable { label: string; moduleKey: string; headers: string[]; rows: string[][] }
export interface OcvWordNewsletter { title: string | null; publishDate: string | null; attachmentType: string | null; filePath: string | null; linkUrl: string | null; status: string | null }
export interface OcvWordProjectImage { imagePath: string; extension: string; caption: string; imageBytes?: Buffer | null }
export interface OcvWordProject { title: string; description: string; fields: [string, string][]; images: OcvWordProjectImage[] }
export interface OcvWordProjectModule { moduleKey: string; label: string; projects: OcvWordProject[] }
export interface OcvWordReportData {
  clubName: string; yearLabel: string; clubRotaryId: string; districtNumber: string; zoneName: string; presidentName: string; assistantGovernorName: string;
  categories: { code: string; name: string }[]; documents: OcvWordDocument[]; liveTables: OcvWordModuleTable[]; newsletters: OcvWordNewsletter[]; projectModules: OcvWordProjectModule[];
}

const PROJECT_COLS: [string, string][] = [["title", "Title"], ["projectDate", "Date"], ["areaOfFocus", "Area of Focus"], ["location", "Location"], ["projectCost", "Cost"], ["directBeneficiaries", "Beneficiaries"]];
/** Live Documents modules rendered as tables; newsletters get their own section. */
const LIVE_MODULES: [string, string, [string, string][]][] = [
  ["community_service", "Community Service Projects", PROJECT_COLS], ["vocational_service", "Vocational Service", PROJECT_COLS],
  ["international_service", "International Service", PROJECT_COLS], ["new_generation_service", "New Generation Service", PROJECT_COLS],
  ["public_image_initiative", "Public Image Initiative", PROJECT_COLS],
  ["club_service", "Club Service", [["title", "Title"], ["projectDate", "Date"], ["location", "Location"], ["manHours", "Man Hours"], ["approvalStatus", "Status"]]],
  ["announcements", "Announcements", [["title", "Title"], ["publishDate", "Publish Date"], ["expiryDate", "Expiry Date"], ["status", "Status"]]],
  ["upcoming_events", "Upcoming Events", [["title", "Title"], ["eventDate", "Event Date"], ["eventVenue", "Venue"], ["publishDate", "Publish Date"], ["status", "Status"]]],
  ["documents", "Documents", [["title", "Title"], ["accessType", "Access Type"], ["publishDate", "Publish Date"], ["expiryDate", "Expiry Date"]]],
  ["attendance", "Attendance", [["eventName", "Event"], ["eventDateTime", "Date"], ["membersPresent", "Present"], ["visitors", "Visitors"], ["totalMembers", "Total Active"], ["attendancePercent", "Attendance %"]]],
  ["board_of_directors", "Board of Directors", [["designation", "Designation"], ["memberName", "Name"], ["mobile", "Mobile"], ["email", "Email"]]],
  ["members", "Members", [["memberName", "Name"], ["mobile", "Mobile"], ["email", "Email"], ["rotaryId", "Rotary ID"], ["joinedDate", "Joined"], ["isActive", "Active"]]],
  ["trf_contributions", "TRF Contributions", [["fund", "Fund"], ["amount", "Amount (USD)"]]],
];
export const PROJECT_MODULES: [string, string][] = [
  ["community_service", "Community Service Projects"], ["vocational_service", "Vocational Service"], ["international_service", "International Service"],
  ["new_generation_service", "New Generation Service"], ["public_image_initiative", "Public Image Initiative"], ["club_service", "Club Service"],
];

/** DECIMAL columns: C# formats a decimal "N2"; here every number arrives as a JS number, so they are named. */
const DECIMAL_KEYS = new Set(["projectCost", "attendancePercentage", "amountSanctioned", "amountReceived", "amountSpent", "amount", "attendancePercent"]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const n2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** FormatCell: date → "dd MMM yyyy[ HH:mm]", bool → Yes/No, decimal → N2 (invariant). */
export function formatCell(v: unknown, key = ""): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return DECIMAL_KEYS.has(key) ? n2(v) : String(v);
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z?$/.exec(s);
  if (!m) return s;
  const day = `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return m[4] === "00" && m[5] === "00" && m[6] === "00" && !/[1-9]/.test(m[7] ?? "") ? day : `${day} ${m[4]}:${m[5]}`;
}

/** Stored file name → served path (DB keeps the file name only; older rows carry a full path). */
const OCV_PATH = (a: string) => `CASE WHEN ${a}FilePath IS NULL OR ${a}FilePath = '' THEN NULL WHEN ${a}FilePath LIKE '/%' THEN ${a}FilePath
  ELSE CONCAT('/Documents/OCV/Group', ${a}fk_club_id, '/', ${a}FilePath) END`;
export const NEWSLETTER_PATH = `CASE WHEN n.FilePath IS NULL OR n.FilePath = '' THEN NULL WHEN n.FilePath LIKE '/%' THEN n.FilePath
  WHEN n.Scope = 'ri' THEN CONCAT('/Documents/ebulletin/ri/', n.FilePath)
  WHEN n.fk_district_id IS NOT NULL AND n.fk_district_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_district_id, '/', n.FilePath)
  WHEN n.fk_club_id IS NOT NULL AND n.fk_club_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_club_id, '/', n.FilePath) ELSE NULL END`;
const fullPath = (clubId: number, p: string | null) => (!p ? p : p.startsWith("/") ? p : `/Documents/OCV/Group${clubId}/${p}`);
const nullableNumber = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export interface DocumentForm { yearId: number; categoryId: number; typeId: number; customTypeName: string | null; amount: number | null; paidOn: string | null }

/** Port of OcvGovService.cs: OCV / GOV compliance documents and the report data. */
@Injectable()
export class OcvGovService {
  constructor(private readonly db: Db, private readonly config: AppConfig, private readonly yearTables: YearTableResolver) {}

  categories() {
    return this.db.query("SELECT pk_category_id AS id, CategoryName AS categoryName, CategoryCode AS categoryCode, IconClass AS iconClass, SortOrder AS sortOrder FROM ocv_document_category WHERE IsActive = 1 ORDER BY SortOrder, pk_category_id");
  }

  documentTypes(categoryId: number) {
    return this.db.query(
      `SELECT pk_type_id AS id, fk_category_id AS categoryId, TypeName AS typeName, AllowMultiple AS allowMultiple, SortOrder AS sortOrder, IsActive AS isActive
       FROM ocv_document_type WHERE fk_category_id = @CategoryId AND isdeleted = 0 ORDER BY SortOrder, pk_type_id`, { CategoryId: categoryId });
  }

  async createDocumentType(dto: { categoryId: number; typeName: string; allowMultiple: boolean; sortOrder: number }) {
    const id = Number(await this.db.executeScalar(
      `INSERT INTO ocv_document_type (fk_category_id, TypeName, AllowMultiple, SortOrder, IsActive, isdeleted, created_date)
       VALUES (@CategoryId, @TypeName, @AllowMultiple, @SortOrder, 1, 0, NOW()); SELECT LAST_INSERT_ID();`,
      { CategoryId: dto.categoryId, TypeName: dto.typeName, AllowMultiple: dto.allowMultiple ? 1 : 0, SortOrder: dto.sortOrder }));
    return { id, categoryId: dto.categoryId, typeName: dto.typeName, allowMultiple: dto.allowMultiple, sortOrder: dto.sortOrder, isActive: true };
  }

  updateDocumentType(typeId: number, dto: { typeName: string; allowMultiple: boolean; sortOrder: number }) {
    return this.db.execute("UPDATE ocv_document_type SET TypeName = @TypeName, AllowMultiple = @AllowMultiple, SortOrder = @SortOrder, modified_date = NOW() WHERE pk_type_id = @TypeId AND isdeleted = 0",
      { TypeId: typeId, TypeName: dto.typeName, AllowMultiple: dto.allowMultiple ? 1 : 0, SortOrder: dto.sortOrder });
  }

  deleteDocumentType(typeId: number) {
    return this.db.execute("UPDATE ocv_document_type SET isdeleted = 1, modified_date = NOW() WHERE pk_type_id = @TypeId", { TypeId: typeId });
  }

  /** Static Documents (constitution, bylaws…) are shared across Rotary years; every other category is year-scoped. */
  documents(clubId: number, yearId: number, categoryId: number) {
    return this.db.query(
      `SELECT d.pk_document_id AS id, d.fk_type_id AS typeId, t.TypeName AS typeName, d.CustomTypeName AS customTypeName, d.FileName AS fileName, d.OriginalFileName AS originalFileName,
              ${OCV_PATH("d.")} AS filePath, d.FileSize AS fileSize, d.Amount AS amount, d.PaidOn AS paidOn, d.created_date AS createdDate
       FROM ocv_documents d
       INNER JOIN ocv_document_type t ON t.pk_type_id = d.fk_type_id
       INNER JOIN ocv_document_category c ON c.pk_category_id = d.fk_category_id
       WHERE d.fk_club_id = @ClubId AND d.fk_category_id = @CategoryId AND d.isdeleted = 0 AND (c.CategoryCode = 'static_documents' OR d.fk_year_id = @YearId)
       ORDER BY t.SortOrder, d.created_date DESC`, { ClubId: clubId, YearId: yearId, CategoryId: categoryId });
  }

  async uploadDocument(clubId: number, dto: DocumentForm, file: UploadedFile, uploadedBy: number, now: string) {
    const allowMultiple = await this.db.executeScalar("SELECT AllowMultiple FROM ocv_document_type WHERE pk_type_id = @TypeId AND isdeleted = 0", { TypeId: dto.typeId });
    if (!allowMultiple) {
      const existing = Number(await this.db.executeScalar(
        `SELECT COUNT(*) FROM ocv_documents d INNER JOIN ocv_document_category c ON c.pk_category_id = d.fk_category_id
         WHERE d.fk_club_id = @ClubId AND d.fk_category_id = @CategoryId AND d.fk_type_id = @TypeId AND d.isdeleted = 0 AND (c.CategoryCode = 'static_documents' OR d.fk_year_id = @YearId)`,
        { ClubId: clubId, YearId: dto.yearId, CategoryId: dto.categoryId, TypeId: dto.typeId }));
      if (existing > 0) throw new InvalidOperationException("A document already exists for this type. Only one document is allowed.");
    }
    const fileName = await saveWithReadableName(this.config, file, "", "Documents", "OCV", `Group${clubId}`);
    const id = Number(await this.db.executeScalar(
      `INSERT INTO ocv_documents (fk_club_id, fk_year_id, fk_category_id, fk_type_id, CustomTypeName, FileName, OriginalFileName, FilePath, FileSize, Amount, PaidOn, UploadedBy, created_date, isdeleted)
       VALUES (@ClubId, @YearId, @CategoryId, @TypeId, @CustomTypeName, @FileName, @OriginalFileName, @FilePath, @FileSize, @Amount, @PaidOn, @UploadedBy, NOW(), 0);
       SELECT LAST_INSERT_ID();`,
      { ClubId: clubId, YearId: dto.yearId, CategoryId: dto.categoryId, TypeId: dto.typeId, CustomTypeName: dto.customTypeName, FileName: fileName, OriginalFileName: file.originalname,
        FilePath: fileName, FileSize: file.size, Amount: dto.amount, PaidOn: dto.paidOn, UploadedBy: uploadedBy }));
    const typeName = (await this.db.executeScalar<string>("SELECT TypeName FROM ocv_document_type WHERE pk_type_id = @TypeId", { TypeId: dto.typeId })) ?? "";
    return { id, typeId: dto.typeId, typeName, customTypeName: dto.customTypeName, fileName, originalFileName: file.originalname, filePath: fullPath(clubId, fileName),
      fileSize: file.size, amount: dto.amount, paidOn: dto.paidOn, createdDate: now };
  }

  async updateDocument(clubId: number, documentId: number, dto: Omit<DocumentForm, "yearId" | "categoryId">, file: UploadedFile | null, now: string) {
    const existing = await this.db.queryFirstOrDefault(
      `SELECT FileName, OriginalFileName, FilePath AS FilePathRaw, ${OCV_PATH("")} AS FilePathFull, FileSize
       FROM ocv_documents WHERE pk_document_id = @Id AND fk_club_id = @ClubId AND isdeleted = 0`, { Id: documentId, ClubId: clubId });
    if (!existing) throw new KeyNotFoundException("Document not found.");
    let fileName = existing.FileName as string, originalFileName = existing.OriginalFileName as string, filePath = existing.FilePathRaw as string, fileSize = Number(existing.FileSize);
    if (file) {
      await this.deleteFromDisk(existing.FilePathFull as string | null);
      fileName = filePath = await saveWithReadableName(this.config, file, "", "Documents", "OCV", `Group${clubId}`);
      originalFileName = file.originalname;
      fileSize = file.size;
    }
    await this.db.execute(
      `UPDATE ocv_documents SET fk_type_id = @TypeId, CustomTypeName = @CustomTypeName, FileName = @FileName, OriginalFileName = @OriginalFileName,
           FilePath = @FilePath, FileSize = @FileSize, Amount = @Amount, PaidOn = @PaidOn, modified_date = NOW()
       WHERE pk_document_id = @Id AND isdeleted = 0`,
      { Id: documentId, TypeId: dto.typeId, CustomTypeName: dto.customTypeName, FileName: fileName, OriginalFileName: originalFileName, FilePath: filePath, FileSize: fileSize, Amount: dto.amount, PaidOn: dto.paidOn });
    const typeName = (await this.db.executeScalar<string>("SELECT TypeName FROM ocv_document_type WHERE pk_type_id = @TypeId", { TypeId: dto.typeId })) ?? "";
    return { id: documentId, typeId: dto.typeId, typeName, customTypeName: dto.customTypeName, fileName, originalFileName, filePath: fullPath(clubId, filePath), fileSize,
      amount: dto.amount, paidOn: dto.paidOn, createdDate: now };
  }

  /** RIZones quirk kept: deletes by id without checking the club. */
  deleteDocument(documentId: number) {
    return this.db.execute("UPDATE ocv_documents SET isdeleted = 1, modified_date = NOW() WHERE pk_document_id = @Id", { Id: documentId });
  }

  documentFile(clubId: number, documentId: number) {
    return this.db.queryFirstOrDefault<{ filePath: string | null; originalFileName: string | null }>(
      `SELECT ${OCV_PATH("")} AS filePath, OriginalFileName AS originalFileName FROM ocv_documents WHERE pk_document_id = @DocumentId AND fk_club_id = @ClubId AND isdeleted = 0 LIMIT 1`,
      { DocumentId: documentId, ClubId: clubId });
  }

  private async deleteFromDisk(relativePath: string | null) {
    if (!relativePath) return;
    const root = resolve(webRootPath(this.config));
    const full = resolve(join(root, ...relativePath.replace(/^\/+/, "").split("/")));
    if (!full.startsWith(root + sep)) return;
    await unlink(full).catch(() => undefined);
  }

  async report(clubId: number, yearId: number, status: string | null): Promise<OcvReportItem[]> {
    const rows = (await this.db.query(
      `SELECT c.CategoryName AS categoryName, c.CategoryCode AS categoryCode, c.pk_category_id AS categoryId, t.pk_type_id AS typeId, t.TypeName AS typeName,
              CASE WHEN d.pk_document_id IS NOT NULL THEN 1 ELSE 0 END AS isUploaded, d.pk_document_id AS documentId, ${OCV_PATH("d.")} AS filePath, d.OriginalFileName AS originalFileName
       FROM ocv_document_type t
       INNER JOIN ocv_document_category c ON c.pk_category_id = t.fk_category_id
       LEFT JOIN ocv_documents d ON d.fk_type_id = t.pk_type_id AND d.fk_club_id = @ClubId AND d.isdeleted = 0 AND (c.CategoryCode = 'static_documents' OR d.fk_year_id = @YearId)
       WHERE t.isdeleted = 0 AND t.IsActive = 1 AND c.IsActive = 1
       ORDER BY c.SortOrder, c.pk_category_id, t.SortOrder, t.pk_type_id`, { ClubId: clubId, YearId: yearId })).map((r) => ({ ...r, isUploaded: Number(r.isUploaded) === 1 }) as OcvReportItem);
    if (status === "yes") return rows.filter((r) => r.isUploaded);
    if (status === "no") return rows.filter((r) => !r.isUploaded);
    return rows;
  }

  async wordReportData(clubId: number, yearId: number): Promise<OcvWordReportData> {
    return this.db.session(async (conn) => {
      const identity = await conn.queryFirstOrDefault(
        `SELECT c.ClubName, c.ClubRotaryId, d.DistrictNumber, z.ZoneName FROM club_master c
         LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
         WHERE c.pk_club_id = @ClubId`, { ClubId: clubId });
      const data: OcvWordReportData = {
        yearLabel: (await conn.executeScalar<string>("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @YearId", { YearId: yearId })) ?? "",
        clubName: identity?.ClubName ?? "", clubRotaryId: identity?.ClubRotaryId ?? "", districtNumber: identity?.DistrictNumber ?? "", zoneName: identity?.ZoneName ?? "",
        presidentName: (await conn.executeScalar<string>(
          `SELECT m.MemberName FROM board_of_directors bod
           JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id AND m.isdeleted = 0
           JOIN designation_master dm ON dm.pk_designation_id = bod.fk_designation_id
           WHERE bod.fk_club_id = @ClubId AND bod.fk_year_id = @YearId AND bod.isdeleted = 0 AND dm.designation_name = 'Club President'
           ORDER BY bod.pk_board_director_id DESC LIMIT 1`, { ClubId: clubId, YearId: yearId })) ?? "",
        assistantGovernorName: (await conn.executeScalar<string>(
          `SELECT mp.MemberName FROM district_ag da
           JOIN member_master_profile mp ON mp.pk_member_master_profile_id = da.fk_member_id AND COALESCE(mp.isdeleted, 0) = 0
           WHERE da.fk_club_id = @ClubId AND da.fk_year_id = @YearId AND da.is_active = 1 AND (da.isdeleted = 0 OR da.isdeleted IS NULL)
           ORDER BY da.id DESC LIMIT 1`, { ClubId: clubId, YearId: yearId })) ?? "",
        categories: (await conn.query("SELECT CategoryCode, CategoryName FROM ocv_document_category WHERE IsActive = 1 ORDER BY SortOrder, pk_category_id"))
          .map((c) => ({ code: c.CategoryCode, name: c.CategoryName })),
        documents: [], liveTables: [], newsletters: [], projectModules: [],
      };
      const docs = await conn.query(
        `SELECT c.CategoryCode AS categoryCode, c.CategoryName AS categoryName, t.TypeName AS typeName, d.CustomTypeName AS customTypeName, d.OriginalFileName AS originalFileName,
                ${OCV_PATH("d.")} AS filePath, d.Amount AS amount, d.PaidOn AS paidOn, d.created_date AS createdDate
         FROM ocv_documents d
         INNER JOIN ocv_document_category c ON c.pk_category_id = d.fk_category_id
         INNER JOIN ocv_document_type t ON t.pk_type_id = d.fk_type_id
         WHERE d.fk_club_id = @ClubId AND d.isdeleted = 0 AND (c.CategoryCode = 'static_documents' OR d.fk_year_id = @YearId)
         ORDER BY c.SortOrder, c.pk_category_id, t.SortOrder, d.created_date`, { ClubId: clubId, YearId: yearId });
      data.documents = docs.map((d) => ({ ...(d as OcvWordDocument), amount: nullableNumber(d.amount), extension: extname(d.filePath ?? d.originalFileName ?? "").replace(/^\./, "").toLowerCase() }));

      const yearInfo = await this.yearTables.resolveByYearId(conn, yearId);
      for (const [module, label, columns] of LIVE_MODULES) {
        let rows: Row[] = [];
        try {
          rows = await this.liveModuleRows(conn, yearInfo, clubId, yearId, module);
        } catch {
          rows = [];
        }
        data.liveTables.push({ label, moduleKey: module, headers: ["Sr", ...columns.map(([, h]) => h)], rows: rows.map((r, i) => [String(i + 1), ...columns.map(([c]) => formatCell(r[c], c))]) });
      }
      // Best-effort: a missing year table or a failing module leaves that module with no projects.
      if (yearInfo) {
        for (const [moduleKey, label] of PROJECT_MODULES) {
          const pm: OcvWordProjectModule = { moduleKey, label, projects: [] };
          try {
            await this.loadProjectModule(conn, yearInfo, clubId, pm);
          } catch {
            pm.projects = [];
          }
          data.projectModules.push(pm);
        }
      }
      data.newsletters = (await conn.query(
        `SELECT n.Title AS title, n.PublishDateTime AS publishDate, n.AttachmentType AS attachmentType, n.LinkUrl AS linkUrl, ${NEWSLETTER_PATH} AS filePath,
                CASE WHEN NOW() < n.PublishDateTime THEN 'Unpublished' WHEN NOW() > n.ExpiryDateTime THEN 'Expired' ELSE 'Published' END AS status
         FROM newsletters n JOIN rotary_year_master y ON y.pk_year_id = @YearId
         WHERE n.fk_club_id = @ClubId AND n.isdeleted = 0 AND ${OcvLiveVisibility.newsletters("n")}
           AND n.PublishDateTime >= y.StartDate AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
         ORDER BY n.PublishDateTime DESC`, { ClubId: clubId, YearId: yearId })) as OcvWordNewsletter[];
      return data;
    });
  }

  /** Every project of the year for one avenue with all form fields (pre-formatted) and up to 5 images each. */
  private async loadProjectModule(conn: DbCommands, info: YearTableInfo, clubId: number, pm: OcvWordProjectModule) {
    const projects = await conn.query(
      `SELECT p.pk_project_id AS projectId, p.title AS title, p.description AS description, p.project_date AS projectDate, p.location AS location, p.project_type AS projectType,
              p.is_joint_project AS isJointProject, p.co_host_name AS coHostName, p.club_role AS clubRole, p.project_cost AS projectCost, p.Currency AS currency,
              p.direct_beneficiaries AS directBeneficiaries, p.man_hours AS manHours, p.rotarians_involved AS rotariansInvolved, p.rotaractors_involved AS rotaractorsInvolved,
              COALESCE(p.rcc_involved,0) AS rccInvolved, p.meeting_type AS meetingType, p.attendance AS attendance, p.attendance_percentage AS attendancePercentage,
              p.global_grant_number AS globalGrantNumber, p.amount_sanctioned AS amountSanctioned, p.amount_received AS amountReceived, p.amount_spent AS amountSpent,
              p.host_clubs_districts AS hostClubsDistricts, p.global_partner_clubs_districts AS globalPartnerClubsDistricts, p.csr_company_name AS csrCompanyName,
              p.approval_status AS approvalStatus, af.name AS areaOfFocus, p.other_area_of_focus AS otherAreaOfFocus, cat.name AS categoryName, p.other_category AS otherCategory,
              scat.name AS subCategoryName, p.other_sub_category AS otherSubCategory, f.name AS fundingName
       FROM \`${info.projectsTable}\` p
       LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
       LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
       LEFT JOIN sub_category_master scat ON scat.pk_sub_category_id = p.fk_sub_category_id
       LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
       JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
       WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0 AND mm.ModuleKey = @ModuleKey
       ORDER BY p.project_date DESC, p.pk_project_id DESC`, { ClubId: clubId, ModuleKey: pm.moduleKey });
    if (projects.length === 0) return;
    const suffix = info.yearLabel.replace(/-/g, "_");
    const photos = await conn.query(
      `SELECT pp.fk_project_id AS projectId,
              CONCAT('/Documents/gallery/Group', p.fk_club_id, '/', CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk) ELSE CONCAT('${suffix}/Album', p.pk_project_id) END, '/', pp.image_path) AS imagePath,
              pp.description AS description
       FROM \`${info.photosTable}\` pp
       JOIN \`${info.projectsTable}\` p ON p.pk_project_id = pp.fk_project_id
       JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
       WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0 AND mm.ModuleKey = @ModuleKey
       ORDER BY pp.fk_project_id, pp.is_primary DESC, pp.sort_order`, { ClubId: clubId, ModuleKey: pm.moduleKey });
    const byProject = new Map<number, Row[]>();
    for (const ph of photos) {
      const k = Number(ph.projectId);
      if (!byProject.has(k)) byProject.set(k, []);
      byProject.get(k)!.push(ph);
    }
    for (const f of projects) {
      const fields: [string, string][] = [];
      const add = (label: string, key: string) => { const v = formatCell(f[key], key); if (v.trim()) fields.push([label, v]); };
      const addOr = (label: string, key: string, fallback: string) => { let v = formatCell(f[key], key); if (!v.trim()) v = formatCell(f[fallback], fallback); if (v.trim()) fields.push([label, v]); };
      add("Date", "projectDate");
      add("Location", "location");
      addOr("Area of Focus", "areaOfFocus", "otherAreaOfFocus");
      addOr("Category", "categoryName", "otherCategory");
      addOr("Sub Category", "subCategoryName", "otherSubCategory");
      add("Project Type", "projectType");
      add("Joint Project", "isJointProject");
      add("Co-Host", "coHostName");
      add("Club Role", "clubRole");
      const cost = formatCell(f.projectCost, "projectCost");
      if (cost.trim()) { const cur = formatCell(f.currency); fields.push(["Project Cost", cur.trim() ? `${cur} ${cost}` : cost]); }
      for (const [label, key] of [["Funding", "fundingName"], ["Direct Beneficiaries", "directBeneficiaries"], ["Man Hours", "manHours"], ["Rotarians Involved", "rotariansInvolved"],
        ["Rotaractors Involved", "rotaractorsInvolved"], ["RCC Involved", "rccInvolved"], ["Meeting Type", "meetingType"], ["Attendance", "attendance"], ["Attendance %", "attendancePercentage"],
        ["Global Grant Number", "globalGrantNumber"], ["Amount Sanctioned", "amountSanctioned"], ["Amount Received", "amountReceived"], ["Amount Spent", "amountSpent"],
        ["Host Clubs / Districts", "hostClubsDistricts"], ["Global Partner Clubs / Districts", "globalPartnerClubsDistricts"], ["CSR Company", "csrCompanyName"], ["Approval Status", "approvalStatus"]])
        add(label, key);
      const images = (byProject.get(Number(f.projectId)) ?? []).slice(0, 5)
        .map((pi) => ({ imagePath: formatCell(pi.imagePath), caption: formatCell(pi.description) }))
        .filter((x) => x.imagePath.trim())
        .map((x) => ({ ...x, extension: extname(x.imagePath).replace(/^\./, "").toLowerCase() }));
      pm.projects.push({ title: formatCell(f.title), description: formatCell(f.description), fields, images });
    }
  }

  private async liveModuleRows(conn: DbCommands, info: YearTableInfo | null, clubId: number, yearId: number, module: string): Promise<Row[]> {
    const p = { ClubId: clubId, YearId: yearId, ModuleKey: module };
    const inYear = (col: string) => `${col} >= y.StartDate AND ${col} < DATE_ADD(y.EndDate, INTERVAL 1 DAY)`;
    switch (module) {
      case "community_service": case "vocational_service": case "international_service": case "new_generation_service": case "public_image_initiative": case "club_service":
        if (!info) return [];
        return conn.query(
          `SELECT p.title, p.project_date AS projectDate, p.location, p.project_cost AS projectCost, p.direct_beneficiaries AS directBeneficiaries,
                  p.man_hours AS manHours, af.name AS areaOfFocus, p.approval_status AS approvalStatus
           FROM \`${info.projectsTable}\` p
           LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
           JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
           WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0 AND mm.ModuleKey = @ModuleKey ORDER BY p.project_date DESC`, p);
      case "announcements":
        return conn.query(
          `SELECT a.Title AS title, a.PublishDateTime AS publishDate, a.ExpiryDateTime AS expiryDate,
                  CASE WHEN NOW() < a.PublishDateTime THEN 'Unpublished' WHEN NOW() > a.ExpiryDateTime THEN 'Expired' ELSE 'Published' END AS status
           FROM announcements a JOIN rotary_year_master y ON y.pk_year_id = @YearId
           WHERE a.fk_club_id = @ClubId AND a.isdeleted = 0 AND ${inYear("a.PublishDateTime")} ORDER BY a.PublishDateTime DESC`, p);
      case "upcoming_events":
        // Event date is not gated: the report covers the whole Rotary year, past events included.
        return conn.query(
          `SELECT e.Title AS title, e.EventDate AS eventDate, e.EventVenue AS eventVenue, e.PublishDate AS publishDate,
                  CASE WHEN NOW() < e.PublishDate THEN 'Unpublished' WHEN NOW() > e.ExpiryDate THEN 'Expired' ELSE 'Published' END AS status
           FROM upcoming_events e JOIN rotary_year_master y ON y.pk_year_id = @YearId
           WHERE e.fk_club_id = @ClubId AND e.isdeleted = 0 AND ${OcvLiveVisibility.upcomingEvents("e")} AND ${inYear("e.PublishDate")} ORDER BY e.EventDate DESC`, p);
      case "documents":
        return conn.query(
          `SELECT cd.Title AS title, cd.AccessType AS accessType, cd.PublishDateTime AS publishDate, cd.ExpiryDateTime AS expiryDate
           FROM club_documents cd JOIN rotary_year_master y ON y.pk_year_id = @YearId
           WHERE cd.fk_club_id = @ClubId AND cd.isdeleted = 0 AND ${OcvLiveVisibility.clubDocuments("cd")} AND ${inYear("cd.PublishDateTime")} ORDER BY cd.PublishDateTime DESC`, p);
      case "attendance": {
        const total = Number(await conn.executeScalar("SELECT COUNT(*) FROM club_members WHERE fk_club_id = @C AND IsActive = 1 AND isdeleted = 0", { C: clubId }));
        return conn.query(
          `SELECT a.EventName AS eventName, a.EventDateTime AS eventDateTime,
                  (SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) AS membersPresent,
                  (SELECT COUNT(*) FROM club_attendance_visitors v WHERE v.fk_attendance_id = a.pk_attendance_id) AS visitors,
                  @Total AS totalMembers,
                  ROUND((SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) * 100.0 / NULLIF(@Total, 0), 1) AS attendancePercent
           FROM club_attendance a WHERE a.fk_club_id = @ClubId AND a.fk_year_id = @YearId AND a.isdeleted = 0 ORDER BY a.EventDateTime DESC`, { ...p, Total: total });
      }
      case "board_of_directors":
        return conn.query(
          `SELECT dm.designation_name AS designation, m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email
           FROM board_of_directors b
           JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
           JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
           WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId AND b.isdeleted = 0 ORDER BY dm.sort_order`, p);
      case "members":
        // Birth / anniversary dates are deliberately not exported.
        return conn.query(
          `SELECT m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email, m.RotaryId AS rotaryId, cm.JoinedDate AS joinedDate, cm.IsActive AS isActive
           FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
           WHERE cm.fk_club_id = @ClubId AND cm.isdeleted = 0 ORDER BY m.MemberName`, p);
      case "trf_contributions":
        // The club's Goal Setting TRF (4 fund YTD values), not the trf_contributions module.
        return conn.query(
          `SELECT CASE gf.FieldKey WHEN 'club_annual_fund_ytd' THEN 'Annual Fund' WHEN 'club_polioplus_ytd' THEN 'Polio Plus'
                    WHEN 'club_endowment_ytd' THEN 'Endowment' WHEN 'club_other_funds_ytd' THEN 'Other Funds' END AS fund,
                  COALESCE(e.NumericValue, 0) AS amount
           FROM goal_fields gf
           LEFT JOIN goal_entries e ON e.fk_field_id = gf.pk_field_id AND e.EntityType = 'Club' AND e.fk_club_id = @ClubId AND e.fk_year_id = @YearId AND COALESCE(e.isdeleted, 0) = 0
           WHERE gf.FieldKey IN ('club_annual_fund_ytd','club_polioplus_ytd','club_endowment_ytd','club_other_funds_ytd') AND gf.isdeleted = 0
           ORDER BY FIELD(gf.FieldKey,'club_annual_fund_ytd','club_polioplus_ytd','club_endowment_ytd','club_other_funds_ytd')`, p);
      default:
        return [];
    }
  }
}
