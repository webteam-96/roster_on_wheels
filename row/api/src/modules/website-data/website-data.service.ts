import { Injectable } from "@nestjs/common";
import { Db, type Row } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { defineDto } from "../../common/dto";
import { InvalidOperationException } from "../../common/exceptions";
import { saveWithGuidName, type UploadedFile } from "../../services/media-storage";

const str = { type: "string" as const, default: () => "" };
const scalar = (rows: Row[]) => Number(Object.values(rows[0] ?? {})[0] ?? 0);
const trimOrNull = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

export const ClubAboutDto = defineDto({ Id: "int", ClubId: "int", Content: str, IsActive: "bool" });
export const SaveClubAboutDto = defineDto({ Content: str, IsActive: { type: "bool", default: () => true } });
export const ClubContactDetailDto = defineDto({ Id: "int", ClubId: "int", YearId: "int", YearLabel: str, Email: str, Phone: str, IsActive: "bool" });
export const SaveClubContactDetailDto = defineDto({ YearId: "int", Email: str, Phone: str, IsActive: { type: "bool", default: () => true } });
export const ClubSocialLinkDto = defineDto({ Id: "int", ClubId: "int", Platform: str, LinkUrl: str, SortOrder: "int", IsActive: "bool" });
export const SaveClubSocialLinkDto = defineDto({ Platform: str, LinkUrl: str, SortOrder: "int", IsActive: { type: "bool", default: () => true } });
export const ClubThemeDto = defineDto({ Id: "int", ClubId: "int", YearId: "int", YearLabel: str, ThemeId: "int", ThemeName: str, ThemeImagePath: "string" });
export const WebsiteDataModuleDto = defineDto({ Id: "int", ModuleName: str, ModuleKey: str, IconClass: { type: "string", default: () => "Globe" }, SortOrder: "int" });
export const SaveWebsiteDataModuleDto = defineDto({ ModuleName: str, ModuleKey: str, IconClass: { type: "string", default: () => "Globe" } });
export const ClubBannerDto = defineDto({
  Id: "int", ClubId: "int", YearId: "int", YearLabel: str, BannerImagePath: str, DocumentPath: "string", LinkUrl: "string", Description: "string",
  SortOrder: "int", IsActive: "bool",
});
export const SaveClubBannerDto = defineDto({
  YearId: "int", BannerImagePath: str, DocumentPath: "string", LinkUrl: "string", Description: "string", SortOrder: "int",
  IsActive: { type: "bool", default: () => true },
});
export type SaveClubBanner = {
  yearId: number; bannerImagePath: string; documentPath: string | null; linkUrl: string | null; description: string | null; sortOrder: number; isActive: boolean;
};
export const ClubAdvertisementDto = defineDto({
  Id: "int", ClubId: "int", YearId: "int", YearLabel: str, AdvertisementImagePath: str, DocumentPath: "string", LinkUrl: "string",
  Description: "string", SortOrder: "int", IsActive: "bool",
});
export const SaveClubAdvertisementDto = defineDto({
  YearId: "int", AdvertisementImagePath: str, DocumentPath: "string", LinkUrl: "string", Description: "string", SortOrder: "int",
  IsActive: { type: "bool", default: () => true },
});
export type SaveClubAdvertisement = {
  yearId: number; advertisementImagePath: string; documentPath: string | null; linkUrl: string | null; description: string | null; sortOrder: number;
  isActive: boolean;
};

/** A stored upload: absolute path kept, a nested relative path gets "/", a bare file name lives in /uploads/<folder>/. */
const uploadPath = (col: string, folder: string, nested = true) => `
    CASE
        WHEN ${col} IS NULL OR ${col} = '' THEN NULL
        WHEN ${col} LIKE '/%' THEN ${col}
        ${nested ? `WHEN ${col} LIKE '%/%' THEN CONCAT('/', ${col})` : ""}
        ELSE CONCAT('/uploads/${folder}/', ${col})
    END`;

const BANNER_SELECT = `
    SELECT b.pk_club_website_banner_id AS Id,
           b.fk_club_id AS ClubId,
           b.fk_year_id AS YearId,
           y.YearLabel,
           ${uploadPath("b.banner_image_path", "banner", false)} AS BannerImagePath,
           ${uploadPath("b.document_path", "banner")} AS DocumentPath,
           b.link_url AS LinkUrl,
           b.description AS Description,
           b.sort_order AS SortOrder,
           b.is_active AS IsActive
    FROM club_website_banner b
    JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id`;

const ADVERT_SELECT = `
    SELECT a.pk_club_website_advertisement_id AS Id,
           a.fk_club_id AS ClubId,
           a.fk_year_id AS YearId,
           y.YearLabel,
           ${uploadPath("a.advertisement_image_path", "advertisement")} AS AdvertisementImagePath,
           ${uploadPath("a.document_path", "advertisement")} AS DocumentPath,
           a.link_url AS LinkUrl,
           a.description AS Description,
           a.sort_order AS SortOrder,
           a.is_active AS IsActive
    FROM club_website_advertisement a
    JOIN rotary_year_master y ON y.pk_year_id = a.fk_year_id`;

/**
 * Ports of ClubAboutService.cs, ClubContactDetailService.cs, ClubSocialLinkService.cs,
 * ClubThemeService.cs, WebsiteDataModuleService.cs, ClubBannerService.cs and
 * ClubAdvertisementService.cs: the content of a club's public website.
 */
@Injectable()
export class WebsiteDataService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  // ---- about (one text per club) ----
  async getAbout(clubId: number) {
    return ClubAboutDto.mapAll(
      await this.db.query(
        `SELECT pk_club_website_about_id AS Id, fk_club_id AS ClubId, content AS Content, is_active AS IsActive
         FROM club_website_about
         WHERE fk_club_id = @ClubId AND isdeleted = 0
         ORDER BY modified_date DESC, created_date DESC, pk_club_website_about_id DESC
         LIMIT 1`,
        { ClubId: clubId },
      ),
    );
  }
  async getAboutById(id: number) {
    return ClubAboutDto.map(
      await this.db.queryFirstOrDefault(
        `SELECT pk_club_website_about_id AS Id, fk_club_id AS ClubId, content AS Content, is_active AS IsActive
         FROM club_website_about
         WHERE pk_club_website_about_id = @Id AND isdeleted = 0
         LIMIT 1`,
        { Id: id },
      ),
    );
  }
  async createAbout(clubId: number, content: string, isActive: boolean, by: number) {
    return this.db.session(async (conn) => {
      if (Number(await conn.executeScalar("SELECT COUNT(*) FROM club_website_about WHERE fk_club_id = @ClubId AND isdeleted = 0", { ClubId: clubId })) > 0) {
        throw new InvalidOperationException("About content already exists for this club.");
      }
      return Number(
        await conn.executeScalar(
          `INSERT INTO club_website_about (fk_club_id, content, is_active, created_by, created_date)
           VALUES (@ClubId, @Content, @IsActive, @CreatedBy, NOW());
           SELECT LAST_INSERT_ID();`,
          { ClubId: clubId, Content: content, IsActive: isActive ? 1 : 0, CreatedBy: by },
        ),
      );
    });
  }
  async updateAbout(id: number, content: string, isActive: boolean, by: number) {
    await this.db.execute(
      `UPDATE club_website_about SET content = @Content, is_active = @IsActive, modified_by = @ModifiedBy, modified_date = NOW()
       WHERE pk_club_website_about_id = @Id AND isdeleted = 0`,
      { Id: id, Content: content, IsActive: isActive ? 1 : 0, ModifiedBy: by },
    );
  }
  async deleteAbout(id: number, by: number) {
    await this.db.execute("UPDATE club_website_about SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW() WHERE pk_club_website_about_id = @Id", { Id: id, DeletedBy: by });
  }

  // ---- contact details (per year) ----
  async getContactDetails(clubId: number, yearId: number) {
    return ClubContactDetailDto.mapAll(await this.db.callProcedure("sp_club_contact_detail_get_by_club", { p_ClubId: clubId, p_YearId: yearId }));
  }
  async getContactDetail(id: number) {
    return ClubContactDetailDto.map((await this.db.callProcedure("sp_club_contact_detail_get_by_id", { p_Id: id }))[0] ?? null);
  }
  async createContactDetail(clubId: number, d: { yearId: number; email: string; phone: string; isActive: boolean }, by: number) {
    return scalar(
      await this.db.callProcedure("sp_club_contact_detail_create", {
        p_ClubId: clubId, p_YearId: d.yearId, p_Email: d.email, p_Phone: d.phone, p_IsActive: d.isActive ? 1 : 0, p_CreatedBy: by,
      }),
    );
  }
  async updateContactDetail(id: number, d: { email: string; phone: string; isActive: boolean }, by: number) {
    await this.db.executeProcedure("sp_club_contact_detail_update", { p_Id: id, p_Email: d.email, p_Phone: d.phone, p_IsActive: d.isActive ? 1 : 0, p_ModifiedBy: by });
  }
  async deleteContactDetail(id: number, by: number) {
    await this.db.executeProcedure("sp_club_contact_detail_delete", { p_Id: id, p_DeletedBy: by });
  }

  // ---- social links ----
  private static readonly SOCIAL_COLUMNS = `pk_club_website_social_link_id AS Id, fk_club_id AS ClubId, platform AS Platform,
       link_url AS LinkUrl, sort_order AS SortOrder, is_active AS IsActive`;
  async getSocialLinks(clubId: number) {
    return ClubSocialLinkDto.mapAll(
      await this.db.query(`SELECT ${WebsiteDataService.SOCIAL_COLUMNS} FROM club_website_social_link WHERE fk_club_id = @ClubId AND isdeleted = 0 ORDER BY sort_order ASC`, { ClubId: clubId }),
    );
  }
  async getSocialLink(id: number) {
    return ClubSocialLinkDto.map(
      await this.db.queryFirstOrDefault(`SELECT ${WebsiteDataService.SOCIAL_COLUMNS} FROM club_website_social_link WHERE pk_club_website_social_link_id = @Id AND isdeleted = 0 LIMIT 1`, { Id: id }),
    );
  }
  async createSocialLink(clubId: number, d: { platform: string; linkUrl: string; sortOrder: number; isActive: boolean }, by: number) {
    return Number(
      await this.db.executeScalar(
        `INSERT INTO club_website_social_link (fk_club_id, platform, link_url, sort_order, is_active, created_by, created_date)
         VALUES (@ClubId, @Platform, @LinkUrl, @SortOrder, @IsActive, @CreatedBy, NOW());
         SELECT LAST_INSERT_ID();`,
        { ClubId: clubId, Platform: d.platform, LinkUrl: d.linkUrl, SortOrder: d.sortOrder, IsActive: d.isActive ? 1 : 0, CreatedBy: by },
      ),
    );
  }
  async updateSocialLink(id: number, d: { platform: string; linkUrl: string; sortOrder: number; isActive: boolean }, by: number) {
    await this.db.execute(
      `UPDATE club_website_social_link
       SET platform = @Platform, link_url = @LinkUrl, sort_order = @SortOrder, is_active = @IsActive, modified_by = @ModifiedBy, modified_date = NOW()
       WHERE pk_club_website_social_link_id = @Id AND isdeleted = 0`,
      { Id: id, Platform: d.platform, LinkUrl: d.linkUrl, SortOrder: d.sortOrder, IsActive: d.isActive ? 1 : 0, ModifiedBy: by },
    );
  }
  async deleteSocialLink(id: number, by: number) {
    await this.db.execute("UPDATE club_website_social_link SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW() WHERE pk_club_website_social_link_id = @Id", { Id: id, DeletedBy: by });
  }

  /** Saves a full drag-and-drop order (0-based) for one club's rows. */
  async reorderAll(table: "club_website_social_link" | "club_website_banner" | "club_website_advertisement", clubId: number, orderedIds: number[]) {
    const pk = `pk_${table}_id`;
    await this.db.session(async (conn) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await conn.execute(`UPDATE ${table} SET sort_order=@S WHERE ${pk}=@Id AND fk_club_id=@C`, { S: i, Id: orderedIds[i], C: clubId });
      }
    });
  }

  /** Years that have rows in a club website table. */
  async availableYears(table: "club_website_contact_detail" | "club_website_banner" | "club_website_advertisement", clubId: number) {
    const live = table === "club_website_contact_detail" ? "t.isdeleted = 0" : "COALESCE(t.isdeleted,0) = 0";
    return this.db.query(
      `SELECT DISTINCT ry.pk_year_id AS id, ry.YearLabel AS yearLabel, ry.IsCurrent AS isCurrent
       FROM ${table} t
       INNER JOIN rotary_year_master ry ON ry.pk_year_id = t.fk_year_id
       WHERE t.fk_club_id = @ClubId AND ${live}
       ORDER BY ry.YearLabel DESC`,
      { ClubId: clubId },
    );
  }

  // ---- theme ----
  async getClubTheme(clubId: number, yearId: number) {
    return ClubThemeDto.map((await this.db.callProcedure("sp_club_theme_get", { p_ClubId: clubId, p_YearId: yearId }))[0] ?? null);
  }
  async saveClubTheme(clubId: number, yearId: number, themeId: number, by: number) {
    await this.db.executeProcedure("sp_club_theme_save", { p_ClubId: clubId, p_YearId: yearId, p_ThemeId: themeId, p_UserId: by });
  }

  // ---- website data modules (catalogue) ----
  async getWebsiteDataModules() {
    return WebsiteDataModuleDto.mapAll(await this.db.callProcedure("sp_website_data_module_get_all"));
  }
  async createWebsiteDataModule(d: { moduleName: string; moduleKey: string; iconClass: string }, by: number) {
    return scalar(await this.db.callProcedure("sp_website_data_module_create", { p_ModuleName: d.moduleName, p_ModuleKey: d.moduleKey, p_IconClass: d.iconClass, p_CreatedBy: by }));
  }
  async updateWebsiteDataModule(id: number, d: { moduleName: string; moduleKey: string; iconClass: string }, by: number) {
    await this.db.executeProcedure("sp_website_data_module_update", { p_Id: id, p_ModuleName: d.moduleName, p_ModuleKey: d.moduleKey, p_IconClass: d.iconClass, p_ModifiedBy: by });
  }
  async deleteWebsiteDataModule(id: number, by: number) {
    await this.db.executeProcedure("sp_website_data_module_delete", { p_Id: id, p_DeletedBy: by });
  }
  async swapWebsiteDataModules(id1: number, id2: number) {
    await this.db.executeProcedure("sp_website_data_module_swap_order", { p_Id1: id1, p_Id2: id2 });
  }

  // ---- banners ----
  async getBanners(clubId: number, yearId: number) {
    return ClubBannerDto.mapAll(
      await this.db.query(`${BANNER_SELECT} WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId AND COALESCE(b.isdeleted,0) = 0 ORDER BY b.sort_order ASC`, { ClubId: clubId, YearId: yearId }),
    );
  }
  async getBanner(id: number) {
    return ClubBannerDto.map(await this.db.queryFirstOrDefault(`${BANNER_SELECT} WHERE b.pk_club_website_banner_id = @Id AND COALESCE(b.isdeleted,0) = 0`, { Id: id }));
  }
  async createBanner(clubId: number, d: SaveClubBanner, by: number) {
    return this.db.session(async (conn) => {
      const id = scalar(
        await conn.callProcedure("sp_club_banner_create", {
          p_ClubId: clubId, p_YearId: d.yearId, p_BannerImagePath: d.bannerImagePath, p_Description: d.description, p_SortOrder: d.sortOrder,
          p_IsActive: d.isActive ? 1 : 0, p_CreatedBy: by,
        }),
      );
      await conn.execute("UPDATE club_website_banner SET document_path = @Doc, link_url = @Link WHERE pk_club_website_banner_id = @Id", {
        Doc: trimOrNull(d.documentPath), Link: trimOrNull(d.linkUrl), Id: id,
      });
      return id;
    });
  }
  async updateBanner(id: number, d: SaveClubBanner, by: number) {
    await this.db.session(async (conn) => {
      await conn.executeProcedure("sp_club_banner_update", {
        p_Id: id, p_BannerImagePath: d.bannerImagePath, p_Description: d.description, p_SortOrder: d.sortOrder, p_IsActive: d.isActive ? 1 : 0, p_ModifiedBy: by,
      });
      await conn.execute("UPDATE club_website_banner SET document_path = @Doc, link_url = @Link WHERE pk_club_website_banner_id = @Id", {
        Doc: trimOrNull(d.documentPath), Link: trimOrNull(d.linkUrl), Id: id,
      });
    });
  }
  async deleteBanner(id: number, by: number) {
    await this.db.executeProcedure("sp_club_banner_delete", { p_Id: id, p_DeletedBy: by });
  }
  async swapBanners(id1: number, id2: number) {
    await this.db.executeProcedure("sp_club_banner_reorder", { p_Id1: id1, p_Id2: id2 });
  }

  // ---- advertisements ----
  async getAdvertisements(clubId: number, yearId: number) {
    return ClubAdvertisementDto.mapAll(
      await this.db.query(`${ADVERT_SELECT} WHERE a.fk_club_id = @ClubId AND a.fk_year_id = @YearId AND COALESCE(a.isdeleted,0) = 0 ORDER BY a.sort_order ASC`, { ClubId: clubId, YearId: yearId }),
    );
  }
  async getAdvertisement(id: number) {
    return ClubAdvertisementDto.map(await this.db.queryFirstOrDefault(`${ADVERT_SELECT} WHERE a.pk_club_website_advertisement_id = @Id AND COALESCE(a.isdeleted,0) = 0`, { Id: id }));
  }
  async createAdvertisement(clubId: number, d: SaveClubAdvertisement, by: number) {
    return this.db.session(async (conn) => {
      const id = scalar(
        await conn.callProcedure("sp_club_advertisement_create", {
          p_ClubId: clubId, p_YearId: d.yearId, p_AdvertisementImagePath: d.advertisementImagePath, p_DocumentPath: d.documentPath,
          p_Description: d.description, p_SortOrder: d.sortOrder, p_IsActive: d.isActive ? 1 : 0, p_CreatedBy: by,
        }),
      );
      await conn.execute("UPDATE club_website_advertisement SET link_url = @Link WHERE pk_club_website_advertisement_id = @Id", { Link: trimOrNull(d.linkUrl), Id: id });
      return id;
    });
  }
  async updateAdvertisement(id: number, d: SaveClubAdvertisement, by: number) {
    await this.db.session(async (conn) => {
      await conn.executeProcedure("sp_club_advertisement_update", {
        p_Id: id, p_AdvertisementImagePath: d.advertisementImagePath, p_DocumentPath: d.documentPath, p_Description: d.description,
        p_SortOrder: d.sortOrder, p_IsActive: d.isActive ? 1 : 0, p_ModifiedBy: by,
      });
      await conn.execute("UPDATE club_website_advertisement SET link_url = @Link WHERE pk_club_website_advertisement_id = @Id", { Link: trimOrNull(d.linkUrl), Id: id });
    });
  }
  async deleteAdvertisement(id: number, by: number) {
    await this.db.executeProcedure("sp_club_advertisement_delete", { p_Id: id, p_DeletedBy: by });
  }
  async swapAdvertisements(id1: number, id2: number) {
    await this.db.executeProcedure("sp_club_advertisement_reorder", { p_Id1: id1, p_Id2: id2 });
  }

  /** Uploads under /uploads/<folder>/<guid><ext>; returns the file name. */
  upload(file: UploadedFile, folder: "about" | "banner" | "advertisement") {
    return saveWithGuidName(this.config, file, "uploads", folder);
  }
}
