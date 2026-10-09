import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Db, type DbCommands } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { defineDto } from "../../common/dto";
import { badRequest, notFound, ok, statusCode } from "../../common/results";
import { bodyField, bodyIntList, paramInt, queryBool, queryInt } from "../../common/binding";
import { DISTRICT_BLOCKED_MESSAGE, isDistrictDrillReachable } from "../../services/kill-switch.helper";
import { lowerExtension, saveWithGuidName, type UploadedFile as Upload } from "../../services/media-storage";
import { ensureWithinLimit, validateImage } from "../../services/image-tools";

const MAX_UPLOAD = 55 * 1024 * 1024;
const str = { type: "string" as const, default: () => "" };
const active = { type: "bool" as const, default: () => true };
const page = { type: "string" as const, default: () => "page" };

const BannerBody = defineDto({ YearId: "int?", BannerImagePath: str, DocumentPath: "string", LinkUrl: "string", Description: "string", SortOrder: "int", IsActive: active });
const AdvertisementBody = defineDto({
  YearId: "int?", AdvertisementImagePath: str, DocumentPath: "string", LinkUrl: "string", Description: "string", SortOrder: "int", IsActive: active,
});
const SocialLinkBody = defineDto({ Platform: str, LinkUrl: str, SortOrder: "int", IsActive: active });
const MenuBody = defineDto({ MenuName: str, LinkType: page, LinkValue: str, SortOrder: "int", IsActive: active });
const SubMenuBody = defineDto({ SubMenuName: str, LinkType: page, LinkValue: str, SortOrder: "int", IsActive: active });
const SwapBody = defineDto({ Id1: "int", Id2: "int" });
const AboutBody = defineDto({ Content: str, IsActive: active });
const ContactBody = defineDto({ YearId: "int", Email: str, Phone: str, SortOrder: "int", IsActive: active });

type B = Record<string, unknown>;
const trimOrNull = (s: unknown) => (typeof s === "string" && s.trim() ? s.trim() : null);
const DOCUMENT_TYPES = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".jpg", ".jpeg", ".png"];
const CURRENT_YEAR = "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1";

/** Port of DistrictModulesController.cs, part 3: the district website's banners, ads, social links, logo, menus, contact details and about. */
@Controller("api/districts/:districtId/website-data")
@Authorize()
export class DistrictWebsiteDataController {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);
  private async guarded(districtText: string, work: (districtId: number) => Promise<unknown>) {
    const districtId = paramInt(districtText, "districtId");
    if (!(await isDistrictDrillReachable(this.db, districtId))) return statusCode(403, { message: DISTRICT_BLOCKED_MESSAGE });
    return ok(await work(districtId));
  }
  private static async currentYear(conn: DbCommands) {
    return Number((await conn.executeScalar(CURRENT_YEAR)) ?? 0);
  }
  private async save(file: Upload, folder: string) {
    return saveWithGuidName(this.config, file, "uploads", folder);
  }
  private async uploadDocument(file: Upload | undefined, folder: string) {
    if (!file || file.size === 0) return badRequest({ message: "No file uploaded" });
    if (!DOCUMENT_TYPES.includes(lowerExtension(file.originalname))) {
      return badRequest({ message: "Invalid file type. Allowed: pdf, doc, docx, xls, xlsx, ppt, pptx, jpg, jpeg, png" });
    }
    if (file.size > 10 * 1024 * 1024) return badRequest({ message: "File size must be less than 10 MB." });
    return ok({ path: await this.save(file, folder) });
  }
  /** An upload with no checks at all (advertisement image, about image, menu document). */
  private async uploadAny(file: Upload | undefined, folder: string, withUrl: boolean) {
    if (!file || file.size === 0) return badRequest({ message: "No file uploaded" });
    const path = await this.save(file, folder);
    return ok(withUrl ? { path, url: `/uploads/${folder}/${path}` } : { path });
  }
  private async reorderAll(table: string, pk: string, districtId: number, body: unknown) {
    const ids = bodyIntList(body, "orderedIds");
    if (!ids.length) return badRequest({ message: "OrderedIds is required." });
    for (let i = 0; i < ids.length; i++) {
      await this.db.execute(`UPDATE ${table} SET sort_order=@S WHERE ${pk}=@Id AND fk_district_id=@D AND fk_club_id=0`, { S: i, Id: ids[i], D: districtId });
    }
    return ok({ message: "Order saved." });
  }
  private yearsOf(table: string, alias: string, districtId: number, deletedCheck: string) {
    return this.db.query(
      `SELECT DISTINCT ry.pk_year_id AS id, ry.YearLabel AS yearLabel, ry.IsCurrent AS isCurrent
       FROM ${table} ${alias} INNER JOIN rotary_year_master ry ON ry.pk_year_id = ${alias}.fk_year_id
       WHERE ${alias}.fk_district_id = @DistrictId AND ${alias}.fk_club_id = 0 AND ${deletedCheck} ORDER BY ry.YearLabel DESC`,
      { DistrictId: districtId },
    );
  }

  // ---- banners ----

  @Get("banners/available-years")
  bannerYears(@Param("districtId") d: string) {
    return this.guarded(d, (id) => this.yearsOf("club_website_banner", "b", id, "COALESCE(b.isdeleted, 0) = 0"));
  }

  @Get("banners")
  banners(@Param("districtId") d: string, @Query("yearId") y?: string) {
    const yearId = queryInt(y);
    return this.guarded(d, (districtId) =>
      this.db.session(async (conn) =>
        conn.query(
          `SELECT pk_club_website_banner_id AS id,
                  CASE WHEN banner_image_path IS NULL OR banner_image_path = '' THEN NULL
                       WHEN banner_image_path LIKE '/%' THEN banner_image_path
                       ELSE CONCAT('/uploads/banner/', banner_image_path) END AS bannerImagePath,
                  CASE WHEN document_path IS NULL OR document_path = '' THEN NULL
                       WHEN document_path LIKE '/%' THEN document_path
                       WHEN document_path LIKE '%/%' THEN CONCAT('/', document_path)
                       ELSE CONCAT('/uploads/banner/', document_path) END AS documentPath,
                  link_url AS linkUrl, description, sort_order AS sortOrder, is_active AS isActive, fk_year_id AS yearId
           FROM club_website_banner
           WHERE fk_district_id = @DistrictId AND fk_club_id = 0 AND fk_year_id = @YearId AND COALESCE(isdeleted, 0) = 0
           ORDER BY sort_order`,
          { DistrictId: districtId, YearId: yearId ?? (await DistrictWebsiteDataController.currentYear(conn)) },
        ),
      ),
    );
  }

  @Post("banners")
  async createBanner(@Param("districtId") d: string, @Body() body: B, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    const dto = BannerBody.create(body ?? {}) as Record<string, any>;
    return this.db.session(async (conn) => {
      await conn.execute(
        `INSERT INTO club_website_banner (fk_club_id, fk_district_id, fk_year_id, banner_image_path, document_path, link_url, description, sort_order, is_active, created_by, created_date)
         VALUES (0, @DistrictId, @YearId, @BannerImagePath, @DocumentPath, @LinkUrl, @Description, @SortOrder, @IsActive, @UserId, NOW())`,
        {
          DistrictId: districtId, YearId: dto.yearId ?? (await DistrictWebsiteDataController.currentYear(conn)), BannerImagePath: dto.bannerImagePath,
          DocumentPath: trimOrNull(dto.documentPath), LinkUrl: trimOrNull(dto.linkUrl), Description: dto.description, SortOrder: dto.sortOrder,
          IsActive: dto.isActive ? 1 : 0, UserId: this.userId(u),
        },
      );
      return ok({ id: Number(await conn.executeScalar("SELECT LAST_INSERT_ID()")) });
    });
  }

  @Post("banners/upload-document")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  uploadBannerDocument(@Param("districtId") d: string, @UploadedFile() file: Upload | undefined) {
    paramInt(d, "districtId");
    return this.uploadDocument(file, "banner");
  }

  @Post("banners/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadBanner(@Param("districtId") d: string, @UploadedFile() upload: Upload | undefined, @Query("strict") strict?: string) {
    paramInt(d, "districtId");
    const file = await ensureWithinLimit(upload);
    const v = validateImage(file, queryBool(strict, false)!);
    if (!v.ok) return badRequest({ message: v.error });
    const fileName = await saveWithGuidName(this.config, { ...file!, originalname: `x${lowerExtension(file!.originalname)}` }, "uploads", "banner");
    return ok({ path: fileName, url: "/uploads/banner/" + fileName, width: v.width, height: v.height, sizeBytes: v.sizeBytes });
  }

  @Put("banners/reorder-all")
  reorderBanners(@Param("districtId") d: string, @Body() body: unknown) {
    return this.reorderAll("club_website_banner", "pk_club_website_banner_id", paramInt(d, "districtId"), body);
  }

  @Put("banners/:id")
  async updateBanner(@Param("districtId") d: string, @Param("id") i: string, @Body() body: B, @User() u: CurrentUser) {
    const [districtId, id] = [paramInt(d, "districtId"), paramInt(i)];
    const dto = BannerBody.create(body ?? {}) as Record<string, any>;
    await this.db.execute(
      `UPDATE club_website_banner SET banner_image_path = @BannerImagePath, document_path = @DocumentPath, link_url = @LinkUrl,
           description = @Description, sort_order = @SortOrder, is_active = @IsActive, modified_by = @UserId, modified_date = NOW()
       WHERE pk_club_website_banner_id = @Id AND fk_district_id = @DistrictId`,
      {
        Id: id, DistrictId: districtId, BannerImagePath: dto.bannerImagePath, DocumentPath: trimOrNull(dto.documentPath), LinkUrl: trimOrNull(dto.linkUrl),
        Description: dto.description, SortOrder: dto.sortOrder, IsActive: dto.isActive ? 1 : 0, UserId: this.userId(u),
      },
    );
    return ok({ message: "Banner updated successfully." });
  }

  @Delete("banners/:id")
  async deleteBanner(@Param("districtId") d: string, @Param("id") i: string, @User() u: CurrentUser) {
    await this.db.execute(
      "UPDATE club_website_banner SET isdeleted = 1, modified_by = @UserId, modified_date = NOW() WHERE pk_club_website_banner_id = @Id AND fk_district_id = @DistrictId",
      { Id: paramInt(i), DistrictId: paramInt(d, "districtId"), UserId: this.userId(u) },
    );
    return ok({ message: "Banner deleted successfully." });
  }

  // ---- advertisements ----

  @Get("advertisements/available-years")
  adYears(@Param("districtId") d: string) {
    return this.guarded(d, (id) => this.yearsOf("club_website_advertisement", "a", id, "COALESCE(a.isdeleted,0) = 0"));
  }

  @Get("advertisements")
  advertisements(@Param("districtId") d: string, @Query("yearId") y?: string) {
    const yearId = queryInt(y);
    return this.guarded(d, (districtId) =>
      this.db.session(async (conn) =>
        conn.query(
          `SELECT pk_club_website_advertisement_id AS id,
                  CASE WHEN advertisement_image_path IS NULL OR advertisement_image_path = '' THEN NULL
                       WHEN advertisement_image_path LIKE '/%' THEN advertisement_image_path
                       WHEN advertisement_image_path LIKE '%/%' THEN CONCAT('/', advertisement_image_path)
                       ELSE CONCAT('/uploads/advertisement/', advertisement_image_path) END AS advertisementImagePath,
                  CASE WHEN document_path IS NULL OR document_path = '' THEN NULL
                       WHEN document_path LIKE '/%' THEN document_path
                       WHEN document_path LIKE '%/%' THEN CONCAT('/', document_path)
                       ELSE CONCAT('/uploads/advertisement/', document_path) END AS documentPath,
                  link_url AS linkUrl, description, sort_order AS sortOrder, is_active AS isActive, fk_year_id AS yearId
           FROM club_website_advertisement
           WHERE fk_district_id = @DistrictId AND fk_club_id = 0 AND fk_year_id = @YearId AND COALESCE(isdeleted, 0) = 0
           ORDER BY sort_order`,
          { DistrictId: districtId, YearId: yearId ?? (await DistrictWebsiteDataController.currentYear(conn)) },
        ),
      ),
    );
  }

  @Post("advertisements")
  async createAdvertisement(@Param("districtId") d: string, @Body() body: B, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    const dto = AdvertisementBody.create(body ?? {}) as Record<string, any>;
    return this.db.session(async (conn) => {
      await conn.execute(
        `INSERT INTO club_website_advertisement (fk_club_id, fk_district_id, fk_year_id, advertisement_image_path, document_path, link_url, description, sort_order, is_active, created_by, created_date)
         VALUES (0, @DistrictId, @YearId, @AdvertisementImagePath, @DocumentPath, @LinkUrl, @Description, @SortOrder, @IsActive, @UserId, NOW())`,
        {
          DistrictId: districtId, YearId: dto.yearId ?? (await DistrictWebsiteDataController.currentYear(conn)), AdvertisementImagePath: dto.advertisementImagePath,
          DocumentPath: trimOrNull(dto.documentPath), LinkUrl: trimOrNull(dto.linkUrl), Description: dto.description, SortOrder: dto.sortOrder,
          IsActive: dto.isActive ? 1 : 0, UserId: this.userId(u),
        },
      );
      return ok({ id: Number(await conn.executeScalar("SELECT LAST_INSERT_ID()")) });
    });
  }

  @Post("advertisements/upload-document")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  uploadAdDocument(@Param("districtId") d: string, @UploadedFile() file: Upload | undefined) {
    paramInt(d, "districtId");
    return this.uploadDocument(file, "advertisement");
  }

  @Post("advertisements/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  uploadAd(@Param("districtId") d: string, @UploadedFile() file: Upload | undefined) {
    paramInt(d, "districtId");
    return this.uploadAny(file, "advertisement", true);
  }

  @Put("advertisements/reorder-all")
  reorderAds(@Param("districtId") d: string, @Body() body: unknown) {
    return this.reorderAll("club_website_advertisement", "pk_club_website_advertisement_id", paramInt(d, "districtId"), body);
  }

  @Put("advertisements/:id")
  async updateAdvertisement(@Param("districtId") d: string, @Param("id") i: string, @Body() body: B, @User() u: CurrentUser) {
    const [districtId, id] = [paramInt(d, "districtId"), paramInt(i)];
    const dto = AdvertisementBody.create(body ?? {}) as Record<string, any>;
    await this.db.execute(
      `UPDATE club_website_advertisement SET advertisement_image_path = @AdvertisementImagePath, document_path = @DocumentPath, link_url = @LinkUrl,
           description = @Description, sort_order = @SortOrder, is_active = @IsActive, modified_by = @UserId, modified_date = NOW()
       WHERE pk_club_website_advertisement_id = @Id AND fk_district_id = @DistrictId`,
      {
        Id: id, DistrictId: districtId, AdvertisementImagePath: dto.advertisementImagePath, DocumentPath: trimOrNull(dto.documentPath),
        LinkUrl: trimOrNull(dto.linkUrl), Description: dto.description, SortOrder: dto.sortOrder, IsActive: dto.isActive ? 1 : 0, UserId: this.userId(u),
      },
    );
    return ok({ message: "Advertisement updated successfully." });
  }

  @Delete("advertisements/:id")
  async deleteAdvertisement(@Param("districtId") d: string, @Param("id") i: string, @User() u: CurrentUser) {
    await this.db.execute(
      "UPDATE club_website_advertisement SET isdeleted = 1, modified_by = @UserId, modified_date = NOW() WHERE pk_club_website_advertisement_id = @Id AND fk_district_id = @DistrictId",
      { Id: paramInt(i), DistrictId: paramInt(d, "districtId"), UserId: this.userId(u) },
    );
    return ok({ message: "Advertisement deleted successfully." });
  }

  // ---- social links ----

  @Get("social-links")
  socialLinks(@Param("districtId") d: string) {
    return this.guarded(d, (districtId) =>
      this.db.query(
        `SELECT pk_club_website_social_link_id AS id, platform, link_url AS linkUrl, sort_order AS sortOrder, is_active AS isActive
         FROM club_website_social_link
         WHERE fk_district_id = @DistrictId AND fk_club_id = 0 AND (isdeleted = 0 OR isdeleted IS NULL)
         ORDER BY sort_order`,
        { DistrictId: districtId },
      ),
    );
  }

  private async duplicatePlatform(districtId: number, platform: string, exceptId: number | null) {
    const n = Number(
      await this.db.executeScalar(
        `SELECT COUNT(*) FROM club_website_social_link
         WHERE fk_district_id = @DistrictId AND LOWER(platform) = LOWER(@Platform) ${exceptId !== null ? "AND pk_club_website_social_link_id <> @Id" : ""} AND isdeleted = 0`,
        { DistrictId: districtId, Platform: platform, Id: exceptId },
      ),
    );
    return n > 0 ? badRequest({ message: `${platform} is already added for this district. Edit the existing entry instead of creating a duplicate.` }) : null;
  }

  @Post("social-links")
  async createSocialLink(@Param("districtId") d: string, @Body() body: B, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    const dto = SocialLinkBody.create(body ?? {}) as Record<string, any>;
    const dupe = await this.duplicatePlatform(districtId, dto.platform, null);
    if (dupe) return dupe;
    return this.db.session(async (conn) => {
      await conn.execute(
        `INSERT INTO club_website_social_link (fk_club_id, fk_district_id, platform, link_url, sort_order, is_active, created_by, created_date)
         VALUES (0, @DistrictId, @Platform, @LinkUrl, @SortOrder, @IsActive, @UserId, NOW())`,
        { DistrictId: districtId, Platform: dto.platform, LinkUrl: dto.linkUrl, SortOrder: dto.sortOrder, IsActive: dto.isActive ? 1 : 0, UserId: this.userId(u) },
      );
      return ok({ id: Number(await conn.executeScalar("SELECT LAST_INSERT_ID()")) });
    });
  }

  @Put("social-links/reorder-all")
  reorderSocialLinks(@Param("districtId") d: string, @Body() body: unknown) {
    return this.reorderAll("club_website_social_link", "pk_club_website_social_link_id", paramInt(d, "districtId"), body);
  }

  @Put("social-links/:id")
  async updateSocialLink(@Param("districtId") d: string, @Param("id") i: string, @Body() body: B, @User() u: CurrentUser) {
    const [districtId, id] = [paramInt(d, "districtId"), paramInt(i)];
    const dto = SocialLinkBody.create(body ?? {}) as Record<string, any>;
    const dupe = await this.duplicatePlatform(districtId, dto.platform, id);
    if (dupe) return dupe;
    await this.db.execute(
      `UPDATE club_website_social_link SET platform = @Platform, link_url = @LinkUrl, sort_order = @SortOrder, is_active = @IsActive,
           modified_by = @UserId, modified_date = NOW()
       WHERE pk_club_website_social_link_id = @Id AND fk_district_id = @DistrictId`,
      { Id: id, DistrictId: districtId, Platform: dto.platform, LinkUrl: dto.linkUrl, SortOrder: dto.sortOrder, IsActive: dto.isActive ? 1 : 0, UserId: this.userId(u) },
    );
    return ok({ message: "Social link updated successfully." });
  }

  @Delete("social-links/:id")
  async deleteSocialLink(@Param("districtId") d: string, @Param("id") i: string, @User() u: CurrentUser) {
    await this.db.execute(
      "UPDATE club_website_social_link SET isdeleted = 1, modified_by = @UserId, modified_date = NOW() WHERE pk_club_website_social_link_id = @Id AND fk_district_id = @DistrictId",
      { Id: paramInt(i), DistrictId: paramInt(d, "districtId"), UserId: this.userId(u) },
    );
    return ok({ message: "Social link deleted successfully." });
  }

  // ---- logo ----

  @Get("logo")
  logo(@Param("districtId") d: string) {
    return this.guarded(d, async (districtId) => ({
      logoPath:
        (await this.db.executeScalar<string>(
          `SELECT CASE WHEN DistrictLogoPath IS NULL OR DistrictLogoPath = '' THEN NULL
                       WHEN DistrictLogoPath LIKE '/%' THEN DistrictLogoPath
                       ELSE CONCAT('/uploads/district/', DistrictLogoPath) END
           FROM district_master WHERE pk_district_id = @DistrictId`,
          { DistrictId: districtId },
        )) ?? null,
    }));
  }

  @Post("logo/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadLogo(@Param("districtId") d: string, @UploadedFile() file: Upload | undefined) {
    const districtId = paramInt(d, "districtId");
    if (!file || file.size === 0) return badRequest({ message: "No file uploaded" });
    if (![".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(lowerExtension(file.originalname))) return badRequest({ message: "Invalid file type. Allowed: jpg, jpeg, png, gif, webp" });
    if (file.size > 5 * 1024 * 1024) return badRequest({ message: "File size must be less than 5MB" });
    const fileName = await saveWithGuidName(this.config, { ...file, originalname: `x${lowerExtension(file.originalname)}` }, "uploads", "district");
    await this.db.execute("UPDATE district_master SET DistrictLogoPath = @LogoPath WHERE pk_district_id = @DistrictId", { LogoPath: fileName, DistrictId: districtId });
    return ok({ path: fileName });
  }

  // ---- menus ----

  private static readonly LINK_VALUE = (alias: string) => `CASE
      WHEN ${alias}link_value IS NULL OR ${alias}link_value = '' THEN ${alias}link_value
      WHEN ${alias}link_type = 'document' AND ${alias}link_value NOT LIKE '/%' AND ${alias}link_value NOT LIKE 'http%'
           THEN CONCAT('/uploads/menu/', ${alias}link_value)
      ELSE ${alias}link_value END AS linkValue`;

  @Get("menus")
  menus(@Param("districtId") d: string) {
    return this.guarded(d, (districtId) =>
      this.db.query(
        `SELECT m.pk_club_website_menu_id AS id, m.menu_name AS menuName, m.link_type AS linkType, ${DistrictWebsiteDataController.LINK_VALUE("m.")},
                m.sort_order AS sortOrder, m.is_active AS isActive, COALESCE(m.is_default, 0) AS isDefault,
                (SELECT COUNT(*) FROM club_website_submenu s WHERE s.fk_menu_id = m.pk_club_website_menu_id AND s.isdeleted = 0) AS subMenuCount
         FROM club_website_menu m
         WHERE m.fk_district_id = @DistrictId AND m.fk_club_id = 0 AND (m.isdeleted = 0 OR m.isdeleted IS NULL)
         ORDER BY m.sort_order`,
        { DistrictId: districtId },
      ),
    );
  }

  @Post("menus")
  async createMenu(@Param("districtId") d: string, @Body() body: B, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    const dto = MenuBody.create(body ?? {}) as Record<string, any>;
    const count = Number(await this.db.executeScalar("SELECT COUNT(*) FROM club_website_menu WHERE fk_district_id = @DistrictId AND isdeleted = 0", { DistrictId: districtId }));
    if (count >= 9) return badRequest({ message: `Menu limit reached (${count}/9). Delete an existing menu before adding a new one.` });
    return this.db.session(async (conn) => {
      await conn.execute(
        `INSERT INTO club_website_menu (fk_club_id, fk_district_id, menu_name, link_type, link_value, sort_order, is_active, created_by, created_date)
         VALUES (0, @DistrictId, @MenuName, @LinkType, @LinkValue, @SortOrder, @IsActive, @UserId, NOW())`,
        { DistrictId: districtId, MenuName: dto.menuName, LinkType: dto.linkType, LinkValue: dto.linkValue, SortOrder: dto.sortOrder, IsActive: dto.isActive ? 1 : 0, UserId: this.userId(u) },
      );
      return ok({ id: Number(await conn.executeScalar("SELECT LAST_INSERT_ID()")) });
    });
  }

  @Post("menus/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  uploadMenuDocument(@Param("districtId") d: string, @UploadedFile() file: Upload | undefined) {
    paramInt(d, "districtId");
    return this.uploadAny(file, "menu", false);
  }

  @Post("menus/reorder")
  async swapMenus(@Param("districtId") d: string, @Body() body: B) {
    paramInt(d, "districtId");
    const dto = SwapBody.create(body ?? {}) as Record<string, any>;
    await this.db.execute(
      `UPDATE club_website_menu m1 JOIN club_website_menu m2 ON m2.pk_club_website_menu_id = @Id2
       SET m1.sort_order = m2.sort_order, m2.sort_order = m1.sort_order
       WHERE m1.pk_club_website_menu_id = @Id1`,
      { Id1: dto.id1, Id2: dto.id2 },
    );
    return ok({ message: "Menus reordered successfully." });
  }

  @Put("menus/reorder-bulk")
  async reorderMenusBulk(@Param("districtId") d: string, @Body() body: unknown) {
    const districtId = paramInt(d, "districtId");
    const ids = bodyIntList(body, "orderedIds");
    for (let i = 0; i < ids.length; i++) {
      await this.db.execute(
        `UPDATE club_website_menu SET sort_order = @Sort, modified_date = NOW()
         WHERE pk_club_website_menu_id = @Id AND fk_district_id = @DistrictId AND fk_club_id = 0 AND (isdeleted = 0 OR isdeleted IS NULL)`,
        { Sort: i + 1, Id: ids[i], DistrictId: districtId },
      );
    }
    return ok({ message: "Menus reordered successfully." });
  }

  @Put("menus/:id")
  async updateMenu(@Param("districtId") d: string, @Param("id") i: string, @Body() body: B, @User() u: CurrentUser) {
    const [districtId, id] = [paramInt(d, "districtId"), paramInt(i)];
    const isDefault = await this.db.executeScalar("SELECT is_default FROM club_website_menu WHERE pk_club_website_menu_id = @Id AND fk_district_id = @DistrictId AND isdeleted = 0", { Id: id, DistrictId: districtId });
    if (Number(isDefault) === 1) return badRequest({ message: "Default menus cannot be edited." });
    const dto = MenuBody.create(body ?? {}) as Record<string, any>;
    await this.db.execute(
      `UPDATE club_website_menu SET menu_name = @MenuName, link_type = @LinkType, link_value = @LinkValue, sort_order = @SortOrder, is_active = @IsActive,
           modified_by = @UserId, modified_date = NOW()
       WHERE pk_club_website_menu_id = @Id AND fk_district_id = @DistrictId`,
      { Id: id, DistrictId: districtId, MenuName: dto.menuName, LinkType: dto.linkType, LinkValue: dto.linkValue, SortOrder: dto.sortOrder, IsActive: dto.isActive ? 1 : 0, UserId: this.userId(u) },
    );
    return ok({ message: "Menu updated successfully." });
  }

  @Put("menus/:id/active")
  async setMenuActive(@Param("districtId") d: string, @Param("id") i: string, @Body() body: B, @User() u: CurrentUser) {
    const [districtId, id] = [paramInt(d, "districtId"), paramInt(i)];
    const isActive = bodyField(body, "isActive") === true;
    const isHome = Number(
      await this.db.executeScalar(
        `SELECT COUNT(*) FROM club_website_menu
         WHERE pk_club_website_menu_id = @Id AND fk_district_id = @DistrictId AND fk_club_id = 0 AND isdeleted = 0
           AND is_default = 1 AND LOWER(TRIM(link_value)) = 'home'`,
        { Id: id, DistrictId: districtId },
      ),
    );
    if (isHome > 0) return badRequest({ message: "The Home menu is always active." });
    const rows = await this.db.execute(
      `UPDATE club_website_menu SET is_active = @IsActive, modified_by = @UserId, modified_date = NOW()
       WHERE pk_club_website_menu_id = @Id AND fk_district_id = @DistrictId AND fk_club_id = 0 AND isdeleted = 0`,
      { Id: id, DistrictId: districtId, IsActive: isActive ? 1 : 0, UserId: this.userId(u) },
    );
    if (rows === 0) return notFound({ message: "Menu not found." });
    return ok({ message: isActive ? "Menu activated." : "Menu deactivated." });
  }

  @Delete("menus/:id")
  async deleteMenu(@Param("districtId") d: string, @Param("id") i: string, @User() u: CurrentUser) {
    const [districtId, id] = [paramInt(d, "districtId"), paramInt(i)];
    const isDefault = await this.db.executeScalar("SELECT is_default FROM club_website_menu WHERE pk_club_website_menu_id = @Id AND fk_district_id = @DistrictId AND isdeleted = 0", { Id: id, DistrictId: districtId });
    if (Number(isDefault) === 1) return badRequest({ message: "Default menus cannot be deleted." });
    await this.db.execute(
      "UPDATE club_website_menu SET isdeleted = 1, modified_by = @UserId, modified_date = NOW() WHERE pk_club_website_menu_id = @Id AND fk_district_id = @DistrictId",
      { Id: id, DistrictId: districtId, UserId: this.userId(u) },
    );
    await this.db.execute("UPDATE club_website_submenu SET isdeleted = 1, modified_by = @UserId, modified_date = NOW() WHERE fk_menu_id = @Id AND isdeleted = 0", { Id: id, UserId: this.userId(u) });
    return ok({ message: "Menu deleted successfully." });
  }

  // ---- sub-menus ----

  @Get("menus/:menuId/submenus")
  subMenus(@Param("districtId") d: string, @Param("menuId") m: string) {
    const menuId = paramInt(m, "menuId");
    return this.guarded(d, () =>
      this.db.query(
        `SELECT pk_club_website_submenu_id AS id, fk_menu_id AS menuId, submenu_name AS subMenuName, link_type AS linkType,
                ${DistrictWebsiteDataController.LINK_VALUE("")}, sort_order AS sortOrder, is_active AS isActive,
                COALESCE(is_system_managed, 0) AS isSystemManaged
         FROM club_website_submenu WHERE fk_menu_id = @MenuId AND isdeleted = 0
         ORDER BY sort_order ASC`,
        { MenuId: menuId },
      ),
    );
  }

  @Post("menus/:menuId/submenus")
  async createSubMenu(@Param("districtId") d: string, @Param("menuId") m: string, @Body() body: B, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    const menuId = paramInt(m, "menuId");
    const dto = SubMenuBody.create(body ?? {}) as Record<string, any>;
    return this.db.session(async (conn) => {
      await conn.execute(
        `INSERT INTO club_website_submenu (fk_menu_id, submenu_name, link_type, link_value, sort_order, is_active, created_by, created_date)
         VALUES (@MenuId, @SubMenuName, @LinkType, @LinkValue, @SortOrder, @IsActive, @UserId, NOW())`,
        { MenuId: menuId, SubMenuName: dto.subMenuName, LinkType: dto.linkType, LinkValue: dto.linkValue, SortOrder: dto.sortOrder, IsActive: dto.isActive ? 1 : 0, UserId: this.userId(u) },
      );
      return ok({ id: Number(await conn.executeScalar("SELECT LAST_INSERT_ID()")) });
    });
  }

  @Post("menus/:menuId/submenus/reorder")
  async swapSubMenus(@Param("districtId") d: string, @Param("menuId") m: string, @Body() body: B) {
    paramInt(d, "districtId");
    paramInt(m, "menuId");
    const dto = SwapBody.create(body ?? {}) as Record<string, any>;
    await this.db.execute(
      `UPDATE club_website_submenu s1 JOIN club_website_submenu s2 ON s2.pk_club_website_submenu_id = @Id2
       SET s1.sort_order = s2.sort_order, s2.sort_order = s1.sort_order
       WHERE s1.pk_club_website_submenu_id = @Id1`,
      { Id1: dto.id1, Id2: dto.id2 },
    );
    return ok({ message: "Sub-menus reordered successfully." });
  }

  @Put("menus/:menuId/submenus/reorder-bulk")
  async reorderSubMenusBulk(@Param("districtId") d: string, @Param("menuId") m: string, @Body() body: unknown) {
    paramInt(d, "districtId");
    const menuId = paramInt(m, "menuId");
    const ids = bodyIntList(body, "orderedIds");
    for (let i = 0; i < ids.length; i++) {
      await this.db.execute(
        `UPDATE club_website_submenu SET sort_order = @Sort, modified_date = NOW()
         WHERE pk_club_website_submenu_id = @Id AND fk_menu_id = @MenuId AND (isdeleted = 0 OR isdeleted IS NULL)`,
        { Sort: i + 1, Id: ids[i], MenuId: menuId },
      );
    }
    return ok({ message: "Sub-menus reordered successfully." });
  }

  @Put("menus/:menuId/submenus/:id")
  async updateSubMenu(@Param("districtId") d: string, @Param("menuId") m: string, @Param("id") i: string, @Body() body: B, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    const [menuId, id] = [paramInt(m, "menuId"), paramInt(i)];
    const dto = SubMenuBody.create(body ?? {}) as Record<string, any>;
    await this.db.execute(
      `UPDATE club_website_submenu SET submenu_name = @SubMenuName, link_type = @LinkType, link_value = @LinkValue, sort_order = @SortOrder,
           is_active = @IsActive, modified_by = @UserId, modified_date = NOW()
       WHERE pk_club_website_submenu_id = @Id AND fk_menu_id = @MenuId`,
      { Id: id, MenuId: menuId, SubMenuName: dto.subMenuName, LinkType: dto.linkType, LinkValue: dto.linkValue, SortOrder: dto.sortOrder, IsActive: dto.isActive ? 1 : 0, UserId: this.userId(u) },
    );
    return ok({ message: "Sub-menu updated successfully." });
  }

  @Delete("menus/:menuId/submenus/:id")
  async deleteSubMenu(@Param("districtId") d: string, @Param("menuId") m: string, @Param("id") i: string, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    await this.db.execute(
      "UPDATE club_website_submenu SET isdeleted = 1, modified_by = @UserId, modified_date = NOW() WHERE pk_club_website_submenu_id = @Id AND fk_menu_id = @MenuId",
      { Id: paramInt(i), MenuId: paramInt(m, "menuId"), UserId: this.userId(u) },
    );
    return ok({ message: "Sub-menu deleted successfully." });
  }

  // ---- contact details ----

  @Get("contact-details/available-years")
  contactYears(@Param("districtId") d: string) {
    return this.guarded(d, (id) => this.yearsOf("club_website_contact_detail", "cd", id, "cd.isdeleted = 0"));
  }

  @Get("contact-details")
  contactDetails(@Param("districtId") d: string, @Query("yearId") y?: string) {
    const yearId = queryInt(y);
    return this.guarded(d, (districtId) =>
      this.db.session(async (conn) =>
        conn.query(
          `SELECT pk_club_website_contact_detail_id AS id, email, phone, sort_order AS sortOrder, is_active AS isActive
           FROM club_website_contact_detail
           WHERE fk_district_id = @DistrictId AND fk_club_id = 0 AND fk_year_id = @YearId AND isdeleted = 0
           ORDER BY sort_order ASC`,
          { DistrictId: districtId, YearId: yearId ?? (await DistrictWebsiteDataController.currentYear(conn)) },
        ),
      ),
    );
  }

  @Post("contact-details")
  async createContact(@Param("districtId") d: string, @Body() body: B, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    const dto = ContactBody.create(body ?? {}) as Record<string, any>;
    return this.db.session(async (conn) => {
      const yearId = dto.yearId > 0 ? dto.yearId : Number((await conn.executeScalar(CURRENT_YEAR)) ?? 1);
      await conn.execute(
        `INSERT INTO club_website_contact_detail (fk_club_id, fk_district_id, fk_year_id, email, phone, sort_order, is_active, created_by, created_date)
         VALUES (0, @DistrictId, @YearId, @Email, @Phone, @SortOrder, @IsActive, @UserId, NOW())`,
        { DistrictId: districtId, YearId: yearId, Email: dto.email, Phone: dto.phone, SortOrder: dto.sortOrder, IsActive: dto.isActive ? 1 : 0, UserId: this.userId(u) },
      );
      return ok({ id: Number(await conn.executeScalar("SELECT LAST_INSERT_ID()")), message: "Contact detail added." });
    });
  }

  @Put("contact-details/:id")
  async updateContact(@Param("districtId") d: string, @Param("id") i: string, @Body() body: B, @User() u: CurrentUser) {
    const dto = ContactBody.create(body ?? {}) as Record<string, any>;
    await this.db.execute(
      `UPDATE club_website_contact_detail SET email = @Email, phone = @Phone, sort_order = @SortOrder, is_active = @IsActive, modified_by = @UserId, modified_date = NOW()
       WHERE pk_club_website_contact_detail_id = @Id AND fk_district_id = @DistrictId`,
      { Id: paramInt(i), DistrictId: paramInt(d, "districtId"), Email: dto.email, Phone: dto.phone, SortOrder: dto.sortOrder, IsActive: dto.isActive ? 1 : 0, UserId: this.userId(u) },
    );
    return ok({ message: "Contact detail updated." });
  }

  @Delete("contact-details/:id")
  async deleteContact(@Param("districtId") d: string, @Param("id") i: string, @User() u: CurrentUser) {
    await this.db.execute(
      "UPDATE club_website_contact_detail SET isdeleted = 1, deleted_by = @UserId, deleted_date = NOW() WHERE pk_club_website_contact_detail_id = @Id AND fk_district_id = @DistrictId",
      { Id: paramInt(i), DistrictId: paramInt(d, "districtId"), UserId: this.userId(u) },
    );
    return ok({ message: "Deleted." });
  }

  // ---- about ----

  @Get("about")
  about(@Param("districtId") d: string) {
    return this.guarded(d, (districtId) =>
      this.db.query(
        `SELECT pk_club_website_about_id AS id, content, is_active AS isActive
         FROM club_website_about
         WHERE fk_district_id = @DistrictId AND fk_club_id = 0 AND (isdeleted = 0 OR isdeleted IS NULL)
         ORDER BY modified_date DESC, created_date DESC, pk_club_website_about_id DESC
         LIMIT 1`,
        { DistrictId: districtId },
      ),
    );
  }

  @Post("about")
  async createAbout(@Param("districtId") d: string, @Body() body: B, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    const dto = AboutBody.create(body ?? {}) as Record<string, any>;
    return this.db.session(async (conn) => {
      await conn.execute(
        `INSERT INTO club_website_about (fk_club_id, fk_district_id, content, is_active, created_by, created_date)
         VALUES (0, @DistrictId, @Content, @IsActive, @UserId, NOW())`,
        { DistrictId: districtId, Content: dto.content, IsActive: dto.isActive ? 1 : 0, UserId: this.userId(u) },
      );
      return ok({ id: Number(await conn.executeScalar("SELECT LAST_INSERT_ID()")), message: "About content created." });
    });
  }

  @Post("about/upload-image")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  uploadAboutImage(@Param("districtId") d: string, @UploadedFile() file: Upload | undefined) {
    paramInt(d, "districtId");
    return this.uploadAny(file, "about", false);
  }

  @Put("about/:id")
  async updateAbout(@Param("districtId") d: string, @Param("id") i: string, @Body() body: B, @User() u: CurrentUser) {
    const dto = AboutBody.create(body ?? {}) as Record<string, any>;
    await this.db.execute(
      `UPDATE club_website_about SET content = @Content, is_active = @IsActive, modified_by = @UserId, modified_date = NOW()
       WHERE pk_club_website_about_id = @Id AND fk_district_id = @DistrictId`,
      { Id: paramInt(i), DistrictId: paramInt(d, "districtId"), Content: dto.content, IsActive: dto.isActive ? 1 : 0, UserId: this.userId(u) },
    );
    return ok({ message: "About content updated." });
  }

  @Delete("about/:id")
  async deleteAbout(@Param("districtId") d: string, @Param("id") i: string, @User() u: CurrentUser) {
    await this.db.execute(
      "UPDATE club_website_about SET isdeleted = 1, deleted_by = @UserId, deleted_date = NOW() WHERE pk_club_website_about_id = @Id AND fk_district_id = @DistrictId",
      { Id: paramInt(i), DistrictId: paramInt(d, "districtId"), UserId: this.userId(u) },
    );
    return ok({ message: "Deleted." });
  }
}
