import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField, paramInt, queryInt, queryString, requireQuery, requireFile } from "../../common/binding";
import { badRequest, forbid, notFound, ok } from "../../common/results";
import { InvalidOperationException } from "../../common/exceptions";
import { AppConfig } from "../../config/app-config";
import { Db } from "../../database/db.service";
import { Brand } from "../../brand/brand";
import { formatDate, nowIn } from "../../common/dotnet-format";
import { DG_EMAIL, DG_JOIN_MEMBER, DG_MOBILE, DG_NAME, DG_PHOTO } from "../../services/district-governor-sql";
import { ensureWithinLimit, validateImage } from "../../services/image-tools";
import { lowerExtension, webRootPath, type UploadedFile as Upload } from "../../services/media-storage";

const blank = (s: string | null) => (!s || !s.trim() ? null : s.trim());
/** Photos are stored file-name only; strip any folder a client sends back (URLs pass through). */
export function normalizeDgPhoto(path: string | null): string | null {
  const p = blank(path);
  if (p === null || p.toLowerCase().startsWith("http")) return p;
  const name = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const slash = name.lastIndexOf("/");
  return slash >= 0 ? name.slice(slash + 1) : name;
}

const SET_CLAUSE = `fk_district_id = @DistrictId, fk_year_id = @YearId,
                   fk_member_id = @MemberId, member_name = @MemberName, description = @Description,
                   profile_photo = @ProfilePhoto, email = @Email, mobile_number = @Mobile,
                   modified_by = @UserId, modified_date = NOW()`;

/** Port of DistrictGovernorController.cs (SuperAdmin; member search open to any signed-in user). */
@Controller("api/district-governors")
@Authorize()
export class DistrictGovernorController {
  constructor(private readonly db: Db, private readonly config: AppConfig) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10) || 0;
  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");

  /** What the DG row stores: a member-linked DG keeps its contacts on the member record, so its own copies are cleared. */
  private ownFields(body: unknown, userId: number) {
    const s = (k: string) => { const v = bodyField(body, k); return v === null || v === undefined ? null : String(v); };
    const memberRaw = bodyField(body, "memberId");
    const memberId = memberRaw === null || memberRaw === undefined || memberRaw === "" ? null : Math.trunc(Number(memberRaw));
    return {
      DistrictId: Math.trunc(Number(bodyField(body, "districtId")) || 0), YearId: Math.trunc(Number(bodyField(body, "yearId")) || 0), MemberId: memberId,
      MemberName: (s("memberName") ?? "").trim(), Description: s("description"), ProfilePhoto: normalizeDgPhoto(s("profilePhoto")),
      Email: memberId !== null ? null : blank(s("email")), Mobile: memberId !== null ? null : blank(s("mobile")), UserId: userId,
    };
  }

  @Get()
  async all(@User() u: CurrentUser, @Query("districtId") d?: string, @Query("yearId") y?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    const [districtId, yearId] = [queryInt(d), queryInt(y)];
    let where = "g.isdeleted = 0";
    if (districtId !== null) where += " AND g.fk_district_id = @DistrictId";
    if (yearId !== null) where += " AND g.fk_year_id = @YearId";
    return ok(await this.db.query(
      `SELECT g.pk_id AS id, g.fk_district_id AS districtId, g.fk_year_id AS yearId, g.fk_member_id AS memberId,
              ${DG_NAME} AS memberName, g.description, ${DG_PHOTO} AS profilePhoto, ${DG_EMAIL} AS email, ${DG_MOBILE} AS mobile,
              d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel, g.created_date AS createdDate,
              CASE WHEN d.IsActive = 1 AND d.isdeleted = 0 AND z.IsActive = 1 AND z.isdeleted = 0 THEN 1 ELSE 0 END AS isActive
       FROM district_governors g
       JOIN district_master d ON d.pk_district_id = g.fk_district_id
       JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
       ${DG_JOIN_MEMBER}
       WHERE ${where}
       ORDER BY y.pk_year_id DESC, CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber`,
      { DistrictId: districtId, YearId: yearId },
    ));
  }

  @Get("filter-districts")
  async filterDistricts(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.db.query(
      `SELECT DISTINCT d.pk_district_id AS id, d.DistrictNumber AS districtNumber
       FROM district_governors g JOIN district_master d ON d.pk_district_id = g.fk_district_id
       WHERE g.isdeleted = 0 AND d.isdeleted = 0
       ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber`,
    ));
  }

  @Get("filter-years")
  async filterYears(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.db.query(
      `SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
       FROM district_governors g JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
       WHERE g.isdeleted = 0
       ORDER BY y.pk_year_id DESC`,
    ));
  }

  @Get("search-members")
  async searchMembers(@Query("search") q?: string) {
    requireQuery({ search: q });
    const search = queryString(q);
    if (!search || !search.trim() || search.length < 2) return ok([]);
    return ok(await this.db.query(
      `SELECT DISTINCT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
              CASE
                  WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                  WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                  ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
              END AS profilePhoto,
              m.PrimaryMobileNumber AS mobile, m.EmailId AS email, c.ClubName AS clubName, d.DistrictNumber AS districtNumber
       FROM member_master_profile m
       JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0
       WHERE m.isdeleted = 0
         AND (m.MemberName LIKE @Search OR m.PrimaryMobileNumber LIKE @Search OR m.EmailId LIKE @Search)
       ORDER BY m.MemberName
       LIMIT 20`,
      { Search: `%${search}%` },
    ));
  }

  @Get(":id")
  async byId(@User() u: CurrentUser, @Param("id") id: string) {
    const dgId = paramInt(id);
    if (!this.isSuperAdmin(u)) return forbid();
    const item = await this.db.queryFirstOrDefault(
      `SELECT g.pk_id AS id, g.fk_district_id AS districtId, g.fk_year_id AS yearId, g.fk_member_id AS memberId,
              ${DG_NAME} AS memberName, g.description, ${DG_PHOTO} AS profilePhoto, ${DG_EMAIL} AS email, ${DG_MOBILE} AS mobile
       FROM district_governors g
       ${DG_JOIN_MEMBER}
       WHERE g.pk_id = @Id AND g.isdeleted = 0`,
      { Id: dgId },
    );
    return item ? ok(item) : notFound({ message: "Not found." });
  }

  @Post()
  async create(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const p = this.ownFields(body ?? {}, this.userId(u));
    const exists = Number(await this.db.executeScalar(
      "SELECT COUNT(*) FROM district_governors WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId AND isdeleted = 0", p));
    if (exists > 0) throw new InvalidOperationException("District Governor already assigned for this district and rotary year.");
    if (!p.MemberName) throw new InvalidOperationException("Name is required.");
    // uk_district_year ignores isdeleted: a deleted governor still holds the slot, so reuse that row.
    const slotHolder = await this.db.executeScalar(
      "SELECT pk_id FROM district_governors WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId AND isdeleted = 1 ORDER BY pk_id DESC LIMIT 1", p);
    if (slotHolder !== null && slotHolder !== undefined) {
      await this.db.execute(`UPDATE district_governors SET ${SET_CLAUSE}, isdeleted = 0, created_by = COALESCE(created_by, @UserId) WHERE pk_id = @Id`, { ...p, Id: Number(slotHolder) });
      return ok({ id: Number(slotHolder), message: "District Governor added." });
    }
    const id = await this.db.session(async (conn) => Number(await conn.executeScalar(
      `INSERT INTO district_governors (fk_district_id, fk_year_id, fk_member_id, member_name, description, profile_photo, email, mobile_number, created_by, created_date, isdeleted)
       VALUES (@DistrictId, @YearId, @MemberId, @MemberName, @Description, @ProfilePhoto, @Email, @Mobile, @UserId, NOW(), 0);
       SELECT LAST_INSERT_ID();`,
      p,
    )));
    return ok({ id, message: "District Governor added." });
  }

  @Put(":id")
  async update(@User() u: CurrentUser, @Param("id") id: string, @Body() body: unknown) {
    const dgId = paramInt(id);
    if (!this.isSuperAdmin(u)) return forbid();
    const p = this.ownFields(body ?? {}, this.userId(u));
    const exists = Number(await this.db.executeScalar(
      "SELECT COUNT(*) FROM district_governors WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId AND isdeleted = 0 AND pk_id != @Id", { ...p, Id: dgId }));
    if (exists > 0) throw new InvalidOperationException("District Governor already assigned for this district and rotary year.");
    if (!p.MemberName) throw new InvalidOperationException("Name is required.");
    // Moving onto a slot whose old row was deleted: revive that row and retire the one being edited.
    const slotHolder = await this.db.executeScalar(
      "SELECT pk_id FROM district_governors WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId AND isdeleted = 1 AND pk_id != @Id ORDER BY pk_id DESC LIMIT 1", { ...p, Id: dgId });
    if (slotHolder !== null && slotHolder !== undefined) {
      await this.db.execute("UPDATE district_governors SET isdeleted = 1, modified_by = @UserId, modified_date = NOW() WHERE pk_id = @Id", { UserId: p.UserId, Id: dgId });
      await this.db.execute(`UPDATE district_governors SET ${SET_CLAUSE}, isdeleted = 0 WHERE pk_id = @Id`, { ...p, Id: Number(slotHolder) });
      return ok({ message: "District Governor updated." });
    }
    await this.db.execute(`UPDATE district_governors SET ${SET_CLAUSE} WHERE pk_id = @Id AND isdeleted = 0`, { ...p, Id: dgId });
    return ok({ message: "District Governor updated." });
  }

  @Delete(":id")
  async remove(@User() u: CurrentUser, @Param("id") id: string) {
    const dgId = paramInt(id);
    if (!this.isSuperAdmin(u)) return forbid();
    await this.db.execute("UPDATE district_governors SET isdeleted = 1, modified_by = @UserId, modified_date = NOW() WHERE pk_id = @Id", { UserId: this.userId(u), Id: dgId });
    return ok({ message: "District Governor deleted." });
  }

  /** Photo for a DG who is not a member; saved as DG{ddMMyyyyHHmmssfff}{ext}, file name returned. */
  @Post("upload-photo")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 6 * 1024 * 1024 } }))
  async uploadPhoto(@User() u: CurrentUser, @UploadedFile() upload?: Upload) {
    requireFile(upload);
    if (!this.isSuperAdmin(u)) return forbid();
    if (!upload || !upload.size) return badRequest({ message: "No file uploaded." });
    const file = (await ensureWithinLimit(upload))!;
    const check = validateImage(file, false);
    if (!check.ok) return badRequest({ message: check.error });
    const dir = join(webRootPath(this.config), "Documents", "WebsiteData", "District_Governor");
    await mkdir(dir, { recursive: true });
    const fileName = `DG${formatDate(nowIn(Brand.Current.locale.defaultTimeZone), "ddMMyyyyHHmmss")}${String(new Date().getMilliseconds()).padStart(3, "0")}${lowerExtension(file.originalname)}`;
    await writeFile(join(dir, fileName), file.buffer);
    return ok({ path: fileName });
  }
}
