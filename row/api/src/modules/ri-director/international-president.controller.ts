import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField, paramInt, queryInt, requireFile } from "../../common/binding";
import { badRequest, forbid, notFound, ok } from "../../common/results";
import { AppConfig } from "../../config/app-config";
import { Db } from "../../database/db.service";
import { Brand } from "../../brand/brand";
import { formatDate, nowIn } from "../../common/dotnet-format";
import { lowerExtension, webRootPath, type UploadedFile as Upload } from "../../services/media-storage";

const PHOTO = `CASE
                   WHEN p.ProfilePhotoPath IS NULL OR p.ProfilePhotoPath = '' THEN NULL
                   WHEN p.ProfilePhotoPath LIKE '/Documents/directory/%' THEN p.ProfilePhotoPath
                   ELSE CONCAT('/Documents/WebsiteData/International_President/', p.ProfilePhotoPath)
               END`;
const IP_PREFIX = "/Documents/WebsiteData/International_President/";
/** Back to the bare file name when the client sends our own read URL back (the GET adds the prefix). */
export function normalizeProfilePhoto(path: string | null): string | null {
  if (!path || !path.trim()) return path;
  const idx = path.toLowerCase().lastIndexOf(IP_PREFIX.toLowerCase());
  return idx >= 0 ? path.slice(idx + IP_PREFIX.length) : path;
}

/** Port of InternationalPresidentController.cs (SuperAdmin). */
@Controller("api/admin/international-president")
@Authorize()
export class InternationalPresidentController {
  constructor(private readonly db: Db, private readonly config: AppConfig) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private userId = (u: CurrentUser) => { const v = u.findFirst("memberId") ?? u.findFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier") ?? ""; return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0; };

  @Get("all")
  async all(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.db.query(
      `SELECT p.pk_id AS id, p.fk_year_id AS yearId, y.YearLabel AS yearName, y.IsCurrent AS isCurrent,
              p.Name AS name, p.Designation AS designation, ${PHOTO} AS profilePhoto,
              p.Description AS description, p.created_date AS createdDate, p.modified_date AS modifiedDate
       FROM international_president p
       JOIN rotary_year_master y ON y.pk_year_id = p.fk_year_id
       WHERE p.isdeleted = 0
       ORDER BY y.YearLabel DESC`,
    ));
  }

  @Get()
  async byYear(@User() u: CurrentUser, @Query("yearId") y?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    const yearId = queryInt(y, 0);
    if (yearId <= 0) return badRequest({ message: "yearId is required" });
    return ok(await this.db.queryFirstOrDefault(
      `SELECT p.pk_id AS id, p.fk_year_id AS yearId, y.YearLabel AS yearName,
              p.Name AS name, p.Designation AS designation, ${PHOTO} AS profilePhoto, p.Description AS description
       FROM international_president p
       JOIN rotary_year_master y ON y.pk_year_id = p.fk_year_id
       WHERE p.fk_year_id = @YearId AND p.isdeleted = 0`,
      { YearId: yearId },
    ));
  }

  @Put()
  async upsert(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const s = (k: string) => { const v = bodyField(body, k); return v === null || v === undefined ? null : String(v); };
    const yearId = Math.trunc(Number(bodyField(body, "yearId")) || 0);
    const name = s("name") ?? "";
    if (yearId <= 0) return badRequest({ message: "yearId is required" });
    if (!name.trim()) return badRequest({ message: "Name is required" });
    const p = { YearId: yearId, Name: name, Designation: s("designation"), ProfilePhotoPath: normalizeProfilePhoto(s("profilePhotoPath")), Description: s("description"), UserId: this.userId(u) };
    // A soft-deleted row for the year is brought back.
    const existingId = await this.db.executeScalar("SELECT pk_id FROM international_president WHERE fk_year_id = @Y LIMIT 1", { Y: yearId });
    if (existingId !== null && existingId !== undefined) {
      await this.db.execute(
        `UPDATE international_president SET Name = @Name, Designation = @Designation, ProfilePhotoPath = @ProfilePhotoPath, Description = @Description, isdeleted = 0, modified_by = @UserId
         WHERE pk_id = @Id`,
        { ...p, Id: Number(existingId) },
      );
      return ok({ success: true, id: Number(existingId), message: "International President updated." });
    }
    const newId = await this.db.session(async (conn) => Number(await conn.executeScalar(
      `INSERT INTO international_president (fk_year_id, Name, Designation, ProfilePhotoPath, Description, created_by)
       VALUES (@YearId, @Name, @Designation, @ProfilePhotoPath, @Description, @UserId);
       SELECT LAST_INSERT_ID();`,
      p,
    )));
    return ok({ success: true, id: newId, message: "International President saved." });
  }

  @Delete(":id")
  async remove(@User() u: CurrentUser, @Param("id") id: string) {
    const recordId = paramInt(id);
    if (!this.isSuperAdmin(u)) return forbid();
    const updated = await this.db.execute("UPDATE international_president SET isdeleted = 1, modified_by = @U WHERE pk_id = @Id AND isdeleted = 0", { Id: recordId, U: this.userId(u) });
    if (updated === 0) return notFound({ message: "Record not found." });
    return ok({ success: true });
  }

  /** Saved as PRESIDENT{ddMMyyyyhhmmssfffffff}{AM|PM}{ext}; returns the file name only. */
  @Post("upload-photo")
  @UseInterceptors(FileInterceptor("file"))
  async uploadPhoto(@User() u: CurrentUser, @UploadedFile() file?: Upload) {
    requireFile(file);
    if (!this.isSuperAdmin(u)) return forbid();
    if (!file || !file.size) return badRequest({ message: "No file uploaded" });
    const ext = lowerExtension(file.originalname);
    if (![".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) return badRequest({ message: "Invalid file type. Allowed: jpg, jpeg, png, gif, webp" });
    if (file.size > 5 * 1024 * 1024) return badRequest({ message: "File size must be less than 5MB" });
    const dir = join(webRootPath(this.config), "Documents", "WebsiteData", "International_President");
    await mkdir(dir, { recursive: true });
    const now = nowIn(Brand.Current.locale.defaultTimeZone);
    const ms = String(new Date().getMilliseconds()).padStart(3, "0");
    const fileName = `PRESIDENT${formatDate(now, "ddMMyyyyhhmmss")}${ms}0000${formatDate(now, "tt")}${ext}`;
    await writeFile(join(dir, fileName), file.buffer);
    return ok({ path: fileName });
  }
}
