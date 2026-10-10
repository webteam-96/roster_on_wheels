import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { AllowAnonymous, Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField, queryString, requireQuery, routeInt } from "../../common/binding";
import { badRequest, forbid, notFound, ok } from "../../common/results";
import { AppConfig } from "../../config/app-config";
import { Db } from "../../database/db.service";

/** "1.2.3" vs "1.4.0" part by part (missing or non-numeric parts count as 0): -1, 0 or 1. */
export function compareVersions(a: string | null, b: string | null): number {
  const ap = (a ?? "0").split(".").filter(Boolean), bp = (b ?? "0").split(".").filter(Boolean);
  const part = (p: string[], i: number) => (i < p.length && /^\s*[+-]?\d+\s*$/.test(p[i]) ? parseInt(p[i], 10) : 0);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const x = part(ap, i), y = part(bp, i);
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const versionBody = (b: unknown) => {
  const s = (k: string) => { const v = bodyField(b, k); return v === null || v === undefined ? null : String(v); };
  const force = bodyField(b, "isForceUpdate");
  return { Version: s("version") ?? "", Message: s("message"), PlayStoreUrl: s("playStoreUrl"), AppStoreUrl: s("appStoreUrl"), Url: s("url"), IsForceUpdate: force === undefined || force === null ? 1 : force === true ? 1 : 0 };
};

/** Port of MobileVersionController.cs: the app's launch-time update check, and SuperAdmin version management. */
@Controller()
export class MobileVersionController {
  constructor(private readonly db: Db, private readonly config: AppConfig) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private userId = (u: CurrentUser) => { const v = u.findFirst("memberId") ?? ""; return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0; };

  @Get("api/mobile/version-check")
  @AllowAnonymous()
  async versionCheck(@Query("currentVersion") cv?: string) {
    requireQuery({ currentVersion: cv });
    const currentVersion = queryString(cv);
    if (!currentVersion || !currentVersion.trim()) return badRequest({ message: "currentVersion required" });
    const active = await this.db.queryFirstOrDefault(
      `SELECT pk_id AS id, Version AS version, Message AS message, PlayStoreUrl AS playStoreUrl, AppStoreUrl AS appStoreUrl, Url AS url, IsForceUpdate AS isForceUpdate
       FROM mobile_app_versions WHERE IsActive = 1 AND isdeleted = 0 ORDER BY pk_id DESC LIMIT 1`,
    );
    if (!active)
      return ok({ isForceUpdate: false, isUpdateAvailable: false, currentVersion, requiredVersion: null, message: null, playStoreUrl: null, appStoreUrl: null, url: null });
    const requiredVersion = String(active.version ?? "");
    const isUpdateAvailable = compareVersions(currentVersion, requiredVersion) < 0;
    return ok({
      isForceUpdate: isUpdateAvailable && Number(active.isForceUpdate) === 1, isUpdateAvailable, currentVersion, requiredVersion,
      message: active.message ?? null, playStoreUrl: active.playStoreUrl ?? null, appStoreUrl: active.appStoreUrl ?? null, url: active.url ?? null,
    });
  }

  @Get("api/admin/mobile-versions")
  @Authorize()
  async list(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.db.query(
      `SELECT pk_id AS id, Version AS version, Message AS message, PlayStoreUrl AS playStoreUrl, AppStoreUrl AS appStoreUrl, Url AS url,
              IsForceUpdate AS isForceUpdate, IsActive AS isActive, created_date AS createdDate, modified_date AS modifiedDate
       FROM mobile_app_versions WHERE isdeleted = 0 ORDER BY pk_id DESC`,
    ));
  }

  /** A new version becomes the single active one. */
  @Post("api/admin/mobile-versions")
  @Authorize()
  async create(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const p = versionBody(body ?? {});
    if (!p.Version.trim()) return badRequest({ message: "Version required" });
    const id = await this.db.session((conn) => conn.transaction(async (tx) => {
      await tx.execute("UPDATE mobile_app_versions SET IsActive = 0 WHERE isdeleted = 0");
      return Number(await tx.executeScalar(
        `INSERT INTO mobile_app_versions (Version, Message, PlayStoreUrl, AppStoreUrl, Url, IsForceUpdate, IsActive, created_by, created_date)
         VALUES (@Version, @Message, @PlayStoreUrl, @AppStoreUrl, IFNULL(NULLIF(@Url, ''), @DefaultUrl), @IsForceUpdate, 1, @U, NOW());
         SELECT LAST_INSERT_ID();`,
        // RIZones defaulted the URL to its own App Store link; ROW reads it from MobileApp:DefaultUpdateUrl.
        { ...p, DefaultUrl: this.config.get("MobileApp:DefaultUpdateUrl") ?? null, U: this.userId(u) },
      ));
    }));
    return ok({ id });
  }

  @Put("api/admin/mobile-versions/:id")
  @Authorize()
  async update(@User() u: CurrentUser, @Param("id") idText: string, @Body() body: unknown) {
    const id = routeInt(idText);
    if (!this.isSuperAdmin(u)) return forbid();
    const rows = await this.db.execute(
      `UPDATE mobile_app_versions SET Version = @Version, Message = @Message, PlayStoreUrl = @PlayStoreUrl, AppStoreUrl = @AppStoreUrl, Url = @Url,
           IsForceUpdate = @IsForceUpdate, modified_by = @U, modified_date = NOW()
       WHERE pk_id = @Id AND isdeleted = 0`,
      { ...versionBody(body ?? {}), Id: id, U: this.userId(u) },
    );
    return rows === 0 ? notFound() : ok({ message: "Updated" });
  }

  @Post("api/admin/mobile-versions/:id/activate")
  @Authorize()
  async activate(@User() u: CurrentUser, @Param("id") idText: string) {
    const id = routeInt(idText);
    if (!this.isSuperAdmin(u)) return forbid();
    const rows = await this.db.session((conn) => conn.transaction(async (tx) => {
      await tx.execute("UPDATE mobile_app_versions SET IsActive = 0 WHERE isdeleted = 0");
      return tx.execute("UPDATE mobile_app_versions SET IsActive = 1, modified_date = NOW() WHERE pk_id = @Id AND isdeleted = 0", { Id: id });
    }));
    return rows === 0 ? notFound() : ok({ message: "Activated" });
  }

  @Post("api/admin/mobile-versions/:id/deactivate")
  @Authorize()
  async deactivate(@User() u: CurrentUser, @Param("id") idText: string) {
    const id = routeInt(idText);
    if (!this.isSuperAdmin(u)) return forbid();
    const rows = await this.db.execute("UPDATE mobile_app_versions SET IsActive = 0, modified_date = NOW() WHERE pk_id = @Id AND isdeleted = 0", { Id: id });
    return rows === 0 ? notFound() : ok({ message: "Deactivated" });
  }

  @Delete("api/admin/mobile-versions/:id")
  @Authorize()
  async remove(@User() u: CurrentUser, @Param("id") idText: string) {
    const id = routeInt(idText);
    if (!this.isSuperAdmin(u)) return forbid();
    const rows = await this.db.execute("UPDATE mobile_app_versions SET isdeleted = 1, IsActive = 0, modified_date = NOW() WHERE pk_id = @Id AND isdeleted = 0", { Id: id });
    return rows === 0 ? notFound() : ok({ message: "Deleted" });
  }
}
