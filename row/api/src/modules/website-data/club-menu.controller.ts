import { Body, Controller, Delete, Get, Injectable, Param, Post, Put, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Db } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { defineDto } from "../../common/dto";
import { badRequest, notFound, ok, statusCode } from "../../common/results";
import { InvalidOperationException } from "../../common/exceptions";
import { bodyField, bodyIntList, paramInt } from "../../common/binding";
import { CLUB_BLOCKED_MESSAGE, isClubDrillReachable } from "../../services/kill-switch.helper";
import { ClubSiteCachePurger } from "../../services/club-site-cache-purger";
import { lowerExtension, saveWithGuidName, type UploadedFile as Upload } from "../../services/media-storage";

const str = { type: "string" as const, default: () => "" };
const page = { type: "string" as const, default: () => "page" };
const active = { type: "bool" as const, default: () => true };

/** DTOs/ClubMenuDtos.cs */
export const ClubMenuDto = defineDto({
  Id: "int", ClubId: "int", MenuName: str, LinkType: page, LinkValue: str, ContentHtml: "string", SortOrder: "int", IsActive: "bool", SubMenuCount: "int", IsDefault: "bool",
});
export const ClubSubMenuDto = defineDto({ Id: "int", MenuId: "int", SubMenuName: str, LinkType: page, LinkValue: str, SortOrder: "int", IsActive: "bool", IsSystemManaged: "bool" });
const MenuBody = defineDto({ MenuName: str, LinkType: page, LinkValue: str, ContentHtml: "string", SortOrder: "int", IsActive: active });
const SubMenuBody = defineDto({ SubMenuName: str, LinkType: page, LinkValue: str, SortOrder: "int", IsActive: active });
type Menu = { id: number; clubId: number; menuName: string; linkType: string; linkValue: string; isActive: boolean; isDefault: boolean };

const LINK_VALUE = (a: string, club: string) => `CASE
    WHEN ${a}.link_value IS NULL OR ${a}.link_value = '' THEN ${a}.link_value
    WHEN ${a}.link_type = 'document' AND ${a}.link_value NOT LIKE '/%' AND ${a}.link_value NOT LIKE 'http%'
         THEN CONCAT('/Documents/WebsiteData/Group', ${club}, '/MENU/', ${a}.link_value)
    ELSE ${a}.link_value END`;
const MENU_SELECT = `SELECT m.pk_club_website_menu_id AS Id, m.fk_club_id AS ClubId, m.menu_name AS MenuName, m.link_type AS LinkType,
    ${LINK_VALUE("m", "m.fk_club_id")} AS LinkValue, m.content_html AS ContentHtml, m.sort_order AS SortOrder, m.is_active AS IsActive,
    COALESCE(m.is_default, 0) AS IsDefault,
    (SELECT COUNT(*) FROM club_website_submenu sm WHERE sm.fk_menu_id = m.pk_club_website_menu_id AND sm.isdeleted = 0) AS SubMenuCount
  FROM club_website_menu m`;
const SUBMENU_SELECT = `SELECT sm.pk_club_website_submenu_id AS Id, sm.fk_menu_id AS MenuId, sm.submenu_name AS SubMenuName, sm.link_type AS LinkType,
    ${LINK_VALUE("sm", "m.fk_club_id")} AS LinkValue, sm.sort_order AS SortOrder, sm.is_active AS IsActive, COALESCE(sm.is_system_managed, 0) AS IsSystemManaged
  FROM club_website_submenu sm JOIN club_website_menu m ON m.pk_club_website_menu_id = sm.fk_menu_id`;

/** ValidateExternalLink: an "external" link must be an absolute http(s) URL. */
function externalLinkError(linkType: string | null, linkValue: string | null): string | null {
  if ((linkType ?? "").toLowerCase() !== "external") return null;
  try {
    const u = new URL((linkValue ?? "").trim());
    if (u.protocol === "http:" || u.protocol === "https:") return null;
  } catch {
    // not a URL
  }
  return "External link must be a valid URL starting with http:// or https://.";
}

/** Port of ClubMenuService.cs: the club website's menus and sub-menus. */
@Injectable()
export class ClubMenuService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  async menus(clubId: number) {
    return ClubMenuDto.mapAll(await this.db.query(`${MENU_SELECT} WHERE m.fk_club_id = @ClubId AND m.isdeleted = 0 ORDER BY m.sort_order, m.pk_club_website_menu_id`, { ClubId: clubId })) as unknown as Menu[];
  }

  async menu(id: number) {
    const row = await this.db.queryFirstOrDefault(`${MENU_SELECT} WHERE m.pk_club_website_menu_id = @Id AND m.isdeleted = 0`, { Id: id });
    return row ? (ClubMenuDto.map(row) as unknown as Menu) : null;
  }

  async createMenu(clubId: number, d: Record<string, any>, by: number) {
    if (!d.menuName || !String(d.menuName).trim()) throw new InvalidOperationException("Menu name is required.");
    return this.db.session(async (conn) => {
      await conn.execute(
        `INSERT INTO club_website_menu (fk_club_id, menu_name, link_type, link_value, content_html, sort_order, is_active, is_default, created_by, created_date, isdeleted)
         VALUES (@ClubId, @MenuName, @LinkType, @LinkValue, @ContentHtml, @SortOrder, @IsActive, 0, @CreatedBy, NOW(), 0)`,
        { ClubId: clubId, MenuName: d.menuName, LinkType: d.linkType, LinkValue: d.linkValue, ContentHtml: d.contentHtml, SortOrder: d.sortOrder, IsActive: d.isActive ? 1 : 0, CreatedBy: by },
      );
      return Number(await conn.executeScalar("SELECT LAST_INSERT_ID()"));
    });
  }

  async updateMenu(id: number, d: Record<string, any>, by: number) {
    if (!d.menuName || !String(d.menuName).trim()) throw new InvalidOperationException("Menu name is required.");
    await this.db.execute(
      `UPDATE club_website_menu SET menu_name = @MenuName, link_type = @LinkType, link_value = @LinkValue, content_html = @ContentHtml, sort_order = @SortOrder,
           is_active = @IsActive, modified_by = @ModifiedBy, modified_date = NOW()
       WHERE pk_club_website_menu_id = @Id AND isdeleted = 0`,
      { Id: id, MenuName: d.menuName, LinkType: d.linkType, LinkValue: d.linkValue, ContentHtml: d.contentHtml, SortOrder: d.sortOrder, IsActive: d.isActive ? 1 : 0, ModifiedBy: by },
    );
  }

  deleteMenu(id: number, by: number) {
    return this.db.executeProcedure("sp_club_menu_delete", { p_Id: id, p_DeletedBy: by });
  }

  reorderMenus(id1: number, id2: number) {
    return this.db.executeProcedure("sp_club_menu_reorder", { p_Id1: id1, p_Id2: id2 });
  }

  async reorderMenusBulk(clubId: number, ids: number[]) {
    for (let i = 0; i < ids.length; i++) {
      await this.db.execute("UPDATE club_website_menu SET sort_order = @Sort, modified_date = NOW() WHERE pk_club_website_menu_id = @Id AND fk_club_id = @ClubId AND isdeleted = 0", {
        Sort: i + 1, Id: ids[i], ClubId: clubId,
      });
    }
  }

  async subMenus(menuId: number) {
    return ClubSubMenuDto.mapAll(await this.db.query(`${SUBMENU_SELECT} WHERE sm.fk_menu_id = @MenuId AND sm.isdeleted = 0 ORDER BY sm.sort_order, sm.pk_club_website_submenu_id`, { MenuId: menuId }));
  }

  private static checkSubMenu(d: Record<string, any>) {
    if (!d.subMenuName || !String(d.subMenuName).trim()) throw new InvalidOperationException("Sub-menu name is required.");
    if (!d.linkValue || !String(d.linkValue).trim()) throw new InvalidOperationException("Sub-menu link value is required.");
  }

  async createSubMenu(menuId: number, d: Record<string, any>, by: number) {
    ClubMenuService.checkSubMenu(d);
    return this.db.session(async (conn) => {
      await conn.execute(
        `INSERT INTO club_website_submenu (fk_menu_id, submenu_name, link_type, link_value, sort_order, is_active, is_system_managed, created_by, created_date, isdeleted)
         VALUES (@MenuId, @SubMenuName, @LinkType, @LinkValue, @SortOrder, @IsActive, 0, @CreatedBy, NOW(), 0)`,
        { MenuId: menuId, SubMenuName: d.subMenuName, LinkType: d.linkType, LinkValue: d.linkValue, SortOrder: d.sortOrder, IsActive: d.isActive ? 1 : 0, CreatedBy: by },
      );
      return Number(await conn.executeScalar("SELECT LAST_INSERT_ID()"));
    });
  }

  async updateSubMenu(id: number, d: Record<string, any>, by: number) {
    ClubMenuService.checkSubMenu(d);
    await this.db.execute(
      `UPDATE club_website_submenu SET submenu_name = @SubMenuName, link_type = @LinkType, link_value = @LinkValue, sort_order = @SortOrder, is_active = @IsActive,
           modified_by = @ModifiedBy, modified_date = NOW()
       WHERE pk_club_website_submenu_id = @Id AND isdeleted = 0`,
      { Id: id, SubMenuName: d.subMenuName, LinkType: d.linkType, LinkValue: d.linkValue, SortOrder: d.sortOrder, IsActive: d.isActive ? 1 : 0, ModifiedBy: by },
    );
  }

  async deleteSubMenu(id: number, by: number) {
    await this.db.execute("UPDATE club_website_submenu SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW() WHERE pk_club_website_submenu_id = @Id AND isdeleted = 0", { Id: id, DeletedBy: by });
  }

  reorderSubMenus(id1: number, id2: number) {
    return this.db.executeProcedure("sp_club_submenu_reorder", { p_Id1: id1, p_Id2: id2 });
  }

  async reorderSubMenusBulk(menuId: number, ids: number[]) {
    for (let i = 0; i < ids.length; i++) {
      await this.db.execute("UPDATE club_website_submenu SET sort_order = @Sort, modified_date = NOW() WHERE pk_club_website_submenu_id = @Id AND fk_menu_id = @MenuId AND isdeleted = 0", {
        Sort: i + 1, Id: ids[i], MenuId: menuId,
      });
    }
  }

  uploadDocument(clubId: number, file: Upload) {
    return saveWithGuidName(this.config, file, "Documents", "WebsiteData", `Group${clubId}`, "MENU");
  }
}

/** Ports of ClubMenuController.cs and ClubWebsiteThemeController.cs. */
@Controller("api/clubs/:clubId")
@Authorize()
export class ClubMenuController {
  constructor(
    private readonly menus: ClubMenuService,
    private readonly db: Db,
    private readonly purger: ClubSiteCachePurger,
  ) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);
  private async blocked(clubId: number) {
    return !(await isClubDrillReachable(this.db, clubId)) ? statusCode(403, { message: CLUB_BLOCKED_MESSAGE }) : null;
  }
  private done(clubId: number, result: unknown) {
    this.purger.purgeByClub(clubId);
    return ok(result);
  }

  @Get("has-website")
  async hasWebsite(@Param("clubId") c: string) {
    const clubId = paramInt(c, "clubId");
    return (
      (await this.blocked(clubId)) ??
      ok({ hasWebsite: Number(await this.db.executeScalar("SELECT COUNT(*) FROM club_websites WHERE fk_club_id = @ClubId AND isdeleted = 0", { ClubId: clubId })) > 0 })
    );
  }

  // ---- active theme (ClubWebsiteThemeController) ----

  @Get("website/active-theme")
  async activeTheme(@Param("clubId") c: string) {
    if (!/^-?\d+$/.test(c)) return notFound();
    const clubId = Number(c);
    const block = await this.blocked(clubId);
    if (block) return block;
    const row = await this.db.queryFirstOrDefault(
      `SELECT w.fk_theme_id AS themeId, t.theme_name AS themeName,
              CASE WHEN t.theme_image_path IS NULL OR t.theme_image_path = '' THEN NULL WHEN t.theme_image_path LIKE '/%' THEN t.theme_image_path
                   ELSE CONCAT('/uploads/theme/', t.theme_image_path) END AS themeImagePath
       FROM club_websites w LEFT JOIN theme_master t ON t.pk_theme_id = w.fk_theme_id
       WHERE w.fk_club_id = @ClubId AND w.isdeleted = 0 ORDER BY w.created_date DESC LIMIT 1`,
      { ClubId: clubId },
    );
    if (!row) return ok({ hasWebsite: false, themeId: null, themeName: null, themeImagePath: null });
    return ok({ hasWebsite: true, themeId: row.themeId ?? null, themeName: row.themeName ?? null, themeImagePath: row.themeImagePath ?? null });
  }

  @Put("website/active-theme")
  async setActiveTheme(@Param("clubId") c: string, @Body() body: unknown, @User() u: CurrentUser) {
    if (!/^-?\d+$/.test(c)) return notFound();
    const clubId = Number(c);
    const block = await this.blocked(clubId);
    if (block) return block;
    const themeId = Math.trunc(Number(bodyField(body, "themeId") ?? 0)) || 0;
    if (themeId <= 0) return badRequest({ message: "ThemeId is required." });
    return this.db.session(async (conn) => {
      if (Number(await conn.executeScalar("SELECT COUNT(*) FROM theme_master WHERE pk_theme_id = @Id AND (isdeleted = 0 OR isdeleted IS NULL)", { Id: themeId })) === 0) {
        return badRequest({ message: "Invalid theme." });
      }
      const websiteId = await conn.executeScalar("SELECT pk_id FROM club_websites WHERE fk_club_id = @ClubId AND isdeleted = 0 ORDER BY created_date DESC LIMIT 1", { ClubId: clubId });
      if (websiteId === null || websiteId === undefined) {
        return badRequest({ message: "This club does not have a website yet. Ask the SuperAdmin to create one from Settings → Club Websites." });
      }
      const changed = await conn.execute("UPDATE club_websites SET fk_theme_id = @ThemeId, modified_by = @U, modified_date = NOW() WHERE pk_id = @WebsiteId AND isdeleted = 0", {
        ThemeId: themeId, U: this.userId(u), WebsiteId: websiteId,
      });
      return ok({ message: "Theme updated successfully.", changed });
    });
  }

  // ---- menus ----

  @Get("website-data/menu_list")
  async list(@Param("clubId") c: string) {
    const clubId = paramInt(c, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.menus.menus(clubId));
  }

  @Post("website-data/menu_list")
  async create(@Param("clubId") c: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    const d = MenuBody.create(body ?? {}) as Record<string, any>;
    const linkErr = externalLinkError(d.linkType, d.linkValue);
    if (linkErr) return badRequest({ message: linkErr });
    const existing = await this.menus.menus(clubId);
    if (existing.filter((m) => !m.isDefault).length >= 1) {
      return badRequest({ message: "Only 1 custom menu is allowed per club (in addition to the 8 default menus). Edit or delete the existing custom menu first." });
    }
    if (d.isActive && existing.filter((m) => m.isActive).length >= 9) {
      return badRequest({ message: "Only 9 menus can be active at once. Deactivate one before adding another active menu." });
    }
    return this.done(clubId, { id: await this.menus.createMenu(clubId, d, this.userId(u)) });
  }

  @Post("website-data/menu_list/upload-document")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 55 * 1024 * 1024 } }))
  async upload(@Param("clubId") c: string, @UploadedFile() file: Upload | undefined) {
    const clubId = paramInt(c, "clubId");
    if (!file || file.size === 0) return badRequest({ message: "No file uploaded" });
    if (![".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"].includes(lowerExtension(file.originalname))) {
      return badRequest({ message: "Invalid file type. Allowed: pdf, doc, docx, xls, xlsx, ppt, pptx" });
    }
    if (file.size > 20 * 1024 * 1024) return badRequest({ message: "File size must be less than 10MB" });
    return ok({ path: await this.menus.uploadDocument(clubId, file) });
  }

  @Put("website-data/menu_list/reorder")
  async reorder(@Param("clubId") c: string, @Body() body: unknown) {
    const clubId = paramInt(c, "clubId");
    await this.menus.reorderMenus(Math.trunc(Number(bodyField(body, "id1") ?? 0)), Math.trunc(Number(bodyField(body, "id2") ?? 0)));
    return this.done(clubId, { message: "Menus reordered successfully." });
  }

  @Put("website-data/menu_list/reorder-bulk")
  async reorderBulk(@Param("clubId") c: string, @Body() body: unknown) {
    const clubId = paramInt(c, "clubId");
    await this.menus.reorderMenusBulk(clubId, bodyIntList(body, "orderedIds"));
    return this.done(clubId, { message: "Menus reordered successfully." });
  }

  @Get("website-data/menu_list/:id")
  async get(@Param("clubId") c: string, @Param("id") i: string) {
    const clubId = paramInt(c, "clubId");
    const id = paramInt(i);
    const block = await this.blocked(clubId);
    if (block) return block;
    const m = await this.menus.menu(id);
    return m ? ok(m) : notFound({ message: "Menu not found." });
  }

  @Put("website-data/menu_list/:id")
  async update(@Param("clubId") c: string, @Param("id") i: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    const [clubId, id] = [paramInt(c, "clubId"), paramInt(i)];
    const d = MenuBody.create(body ?? {}) as Record<string, any>;
    const existing = await this.menus.menu(id);
    if (!existing) return notFound({ message: "Menu not found." });
    if (existing.isDefault) return badRequest({ message: "Default menus cannot be edited." });
    const linkErr = externalLinkError(d.linkType, d.linkValue);
    if (linkErr) return badRequest({ message: linkErr });
    if (d.isActive && !existing.isActive && (await this.menus.menus(clubId)).filter((m) => m.isActive).length >= 9) {
      return badRequest({ message: "Only 9 menus can be active at once. Deactivate one first." });
    }
    await this.menus.updateMenu(id, d, this.userId(u));
    return this.done(clubId, { message: "Menu updated successfully." });
  }

  @Put("website-data/menu_list/:id/active")
  async setActive(@Param("clubId") c: string, @Param("id") i: string, @Body() body: unknown, @User() u: CurrentUser) {
    const [clubId, id] = [paramInt(c, "clubId"), paramInt(i)];
    const isActive = bodyField(body, "isActive") === true;
    const existing = await this.menus.menu(id);
    if (!existing) return notFound({ message: "Menu not found." });
    if (existing.isDefault && (existing.linkValue ?? "").trim().toLowerCase() === "home") return badRequest({ message: "The Home menu is always active." });
    if (isActive && !existing.isActive && (await this.menus.menus(clubId)).filter((m) => m.isActive).length >= 9) {
      return badRequest({ message: "Only 9 menus can be active at once. Deactivate one first." });
    }
    const rows = await this.db.execute(
      "UPDATE club_website_menu SET is_active = @IsActive, modified_by = @UserId, modified_date = NOW() WHERE pk_club_website_menu_id = @Id AND fk_club_id = @ClubId AND isdeleted = 0",
      { Id: id, ClubId: clubId, IsActive: isActive ? 1 : 0, UserId: this.userId(u) },
    );
    if (rows === 0) return notFound({ message: "Menu not found." });
    return this.done(clubId, { message: isActive ? "Menu activated." : "Menu deactivated." });
  }

  @Delete("website-data/menu_list/:id")
  async remove(@Param("clubId") c: string, @Param("id") i: string, @User() u: CurrentUser) {
    const [clubId, id] = [paramInt(c, "clubId"), paramInt(i)];
    const existing = await this.menus.menu(id);
    if (!existing) return notFound({ message: "Menu not found." });
    if (existing.isDefault) return badRequest({ message: "Default menus cannot be deleted." });
    await this.menus.deleteMenu(id, this.userId(u));
    return this.done(clubId, { message: "Menu deleted successfully." });
  }

  // ---- sub-menus ----

  @Get("website-data/menu_list/:menuId/submenus")
  async subMenus(@Param("clubId") c: string, @Param("menuId") m: string) {
    const clubId = paramInt(c, "clubId");
    const menuId = paramInt(m, "menuId");
    return (await this.blocked(clubId)) ?? ok(await this.menus.subMenus(menuId));
  }

  @Post("website-data/menu_list/:menuId/submenus")
  async createSubMenu(@Param("clubId") c: string, @Param("menuId") m: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    const [clubId, menuId] = [paramInt(c, "clubId"), paramInt(m, "menuId")];
    const d = SubMenuBody.create(body ?? {}) as Record<string, any>;
    const linkErr = externalLinkError(d.linkType, d.linkValue);
    if (linkErr) return badRequest({ message: linkErr });
    return this.done(clubId, { id: await this.menus.createSubMenu(menuId, d, this.userId(u)) });
  }

  @Put("website-data/menu_list/:menuId/submenus/reorder")
  async reorderSubMenus(@Param("clubId") c: string, @Param("menuId") m: string, @Body() body: unknown) {
    const clubId = paramInt(c, "clubId");
    paramInt(m, "menuId");
    await this.menus.reorderSubMenus(Math.trunc(Number(bodyField(body, "id1") ?? 0)), Math.trunc(Number(bodyField(body, "id2") ?? 0)));
    return this.done(clubId, { message: "Sub-menus reordered successfully." });
  }

  @Put("website-data/menu_list/:menuId/submenus/reorder-bulk")
  async reorderSubMenusBulk(@Param("clubId") c: string, @Param("menuId") m: string, @Body() body: unknown) {
    const [clubId, menuId] = [paramInt(c, "clubId"), paramInt(m, "menuId")];
    await this.menus.reorderSubMenusBulk(menuId, bodyIntList(body, "orderedIds"));
    return this.done(clubId, { message: "Sub-menus reordered successfully." });
  }

  @Put("website-data/menu_list/:menuId/submenus/:id")
  async updateSubMenu(@Param("clubId") c: string, @Param("menuId") m: string, @Param("id") i: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    paramInt(m, "menuId");
    const d = SubMenuBody.create(body ?? {}) as Record<string, any>;
    const linkErr = externalLinkError(d.linkType, d.linkValue);
    if (linkErr) return badRequest({ message: linkErr });
    try {
      await this.menus.updateSubMenu(paramInt(i), d, this.userId(u));
      return this.done(clubId, { message: "Sub-menu updated successfully." });
    } catch (e) {
      if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
      throw e;
    }
  }

  @Delete("website-data/menu_list/:menuId/submenus/:id")
  async deleteSubMenu(@Param("clubId") c: string, @Param("menuId") m: string, @Param("id") i: string, @User() u: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    paramInt(m, "menuId");
    await this.menus.deleteSubMenu(paramInt(i), this.userId(u));
    return this.done(clubId, { message: "Sub-menu deleted successfully." });
  }
}
