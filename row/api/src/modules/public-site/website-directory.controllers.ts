import { Body, Controller, Get, Param, Put, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { AllowAnonymous, Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField, queryInt, routeInt } from "../../common/binding";
import { badRequest, ok, statusCode } from "../../common/results";
import { Brand } from "../../brand/brand";
import { Db, type DbCommands } from "../../database/db.service";
import { CLUB_BLOCKED_MESSAGE, isClubDrillReachable } from "../../services/kill-switch.helper";
import { buildWebsiteUrl } from "../../services/member-scopes.helper";

const setting = async (conn: DbCommands, key: string) => {
  const v = await conn.executeScalar<string>("SELECT SettingValue FROM system_settings WHERE SettingKey = @K", { K: key });
  return v && v.trim() ? v : null;
};
/** [ResponseCache(Duration = 300, Location = Any)] */
const cache5min = (res: Response) => res.setHeader("Cache-Control", "public,max-age=300");

/** Port of PublicWebsiteDirectoryController.cs: live district and club websites (active chain, not expired), for the main site. */
@Controller("api/public/website-directory")
@AllowAnonymous()
export class PublicWebsiteDirectoryController {
  constructor(private readonly db: Db) {}

  @Get("districts")
  async districts(@Res({ passthrough: true }) res: Response) {
    cache5min(res);
    const clubParent = (await setting(this.db, "ClubWebsiteParentDomain")) ?? Brand.Current.domains.clubSiteParent;
    const parent = (await setting(this.db, "DistrictWebsiteParentDomain")) ?? clubParent;
    // district_websites has no start / end dates: expiry is tracked by Status only.
    const rows = await this.db.query(
      `SELECT dw.fk_district_id AS districtId, CONVERT(d.DistrictNumber USING utf8mb4) AS districtNumber, CONVERT(dw.Subdomain USING utf8mb4) AS subdomain,
              CONVERT(dw.ClientDomain USING utf8mb4) AS clientDomain
       FROM district_websites dw
       JOIN district_master d ON d.pk_district_id = dw.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
       JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1
       WHERE COALESCE(dw.isdeleted, 0) = 0 AND dw.Status = 'Active' ORDER BY d.DistrictNumber`);
    return ok(rows.map((r) => ({ districtId: Number(r.districtId), districtNumber: r.districtNumber ?? "", url: buildWebsiteUrl(r.clientDomain?.trim() ?? null, r.subdomain?.trim() ?? null, parent) }))
      .filter((x) => x.url && x.url.trim()));
  }

  @Get("clubs")
  async clubs(@Res({ passthrough: true }) res: Response, @Query("districtId") d?: string) {
    cache5min(res);
    const districtId = queryInt(d);
    const parent = (await setting(this.db, "ClubWebsiteParentDomain")) ?? Brand.Current.domains.clubSiteParent;
    const rows = await this.db.query(
      `SELECT cw.fk_club_id AS clubId, CONVERT(c.ClubName USING utf8mb4) AS clubName, CONVERT(c.City USING utf8mb4) AS city, c.fk_district_id AS districtId,
              CONVERT(d.DistrictNumber USING utf8mb4) AS districtNumber, CONVERT(cw.Subdomain USING utf8mb4) AS subdomain, CONVERT(cw.ClientDomain USING utf8mb4) AS clientDomain
       FROM club_websites cw
       JOIN club_master c ON c.pk_club_id = cw.fk_club_id AND c.isdeleted = 0 AND c.IsActive = 1
       JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
       JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1
       WHERE COALESCE(cw.isdeleted, 0) = 0 AND cw.Status = 'Active' AND CURDATE() BETWEEN cw.StartDate AND cw.EndDate
         AND (@DistrictId IS NULL OR c.fk_district_id = @DistrictId)
       ORDER BY c.ClubName`, { DistrictId: districtId });
    return ok(rows.map((r) => ({ clubId: Number(r.clubId), clubName: r.clubName ?? "", city: r.city, districtId: Number(r.districtId), districtNumber: r.districtNumber ?? "",
      url: buildWebsiteUrl(r.clientDomain?.trim() ?? null, r.subdomain?.trim() ?? null, parent) })).filter((x) => x.url && x.url.trim()));
  }
}

/** Port of ClubWebsiteThemeController.cs: the club website's active theme (club_websites.fk_theme_id). Any signed-in user, as in RIZones. */
@Controller("api/clubs/:clubId/website/active-theme")
@Authorize()
export class ClubWebsiteThemeController {
  constructor(private readonly db: Db) {}

  @Get()
  async get(@Param("clubId") c: string) {
    const clubId = routeInt(c);
    if (!(await isClubDrillReachable(this.db, clubId))) return statusCode(403, { message: CLUB_BLOCKED_MESSAGE });
    const row = await this.db.queryFirstOrDefault(
      `SELECT w.fk_theme_id AS themeId, t.theme_name AS themeName,
              CASE WHEN t.theme_image_path IS NULL OR t.theme_image_path = '' THEN NULL WHEN t.theme_image_path LIKE '/%' THEN t.theme_image_path
                   ELSE CONCAT('/uploads/theme/', t.theme_image_path) END AS themeImagePath
       FROM club_websites w LEFT JOIN theme_master t ON t.pk_theme_id = w.fk_theme_id
       WHERE w.fk_club_id = @ClubId AND w.isdeleted = 0 ORDER BY w.created_date DESC LIMIT 1`, { ClubId: clubId });
    if (!row) return ok({ hasWebsite: false, themeId: null, themeName: null, themeImagePath: null });
    return ok({ hasWebsite: true, themeId: row.themeId === null ? null : Number(row.themeId), themeName: row.themeName, themeImagePath: row.themeImagePath });
  }

  @Put()
  async set(@Param("clubId") c: string, @Body() body: unknown, @User() u: CurrentUser) {
    const clubId = routeInt(c);
    if (!(await isClubDrillReachable(this.db, clubId))) return statusCode(403, { message: CLUB_BLOCKED_MESSAGE });
    const themeId = Math.trunc(Number(bodyField(body, "themeId")) || 0);
    if (themeId <= 0) return badRequest({ message: "ThemeId is required." });
    if (Number(await this.db.executeScalar("SELECT COUNT(*) FROM theme_master WHERE pk_theme_id = @Id AND (isdeleted = 0 OR isdeleted IS NULL)", { Id: themeId })) === 0)
      return badRequest({ message: "Invalid theme." });
    const websiteId = await this.db.executeScalar("SELECT pk_id FROM club_websites WHERE fk_club_id = @ClubId AND isdeleted = 0 ORDER BY created_date DESC LIMIT 1", { ClubId: clubId });
    if (websiteId === null || websiteId === undefined)
      return badRequest({ message: "This club does not have a website yet. Ask the SuperAdmin to create one from Settings → Club Websites." });
    const changed = await this.db.execute("UPDATE club_websites SET fk_theme_id = @ThemeId, modified_by = @U, modified_date = NOW() WHERE pk_id = @WebsiteId AND isdeleted = 0",
      { ThemeId: themeId, U: parseInt(u.findFirst("memberId") ?? "0", 10) || 0, WebsiteId: websiteId });
    return ok({ message: "Theme updated successfully.", changed });
  }
}
