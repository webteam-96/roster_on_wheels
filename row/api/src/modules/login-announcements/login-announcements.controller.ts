import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField, paramInt, queryString } from "../../common/binding";
import { badRequest, forbid, notFound, ok } from "../../common/results";
import { Db } from "../../database/db.service";
import {
  acknowledge, buildActivePayload, describeLocations, normalizeFilters, normalizeLocations, normalizeRoles, parseFilters, parseLocations, parseRoles,
} from "./login-announcement-audience";

const userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10) || 0;
const ackIds = (body: unknown) => { const v = bodyField(body, "ids"); return Array.isArray(v) ? v.map(Number).filter(Number.isFinite).map(Math.trunc) : []; };

/** Port of LoginAnnouncementController.cs: SuperAdmin manages the post-login popup; any user reads and acknowledges. */
@Controller("api/login-announcements")
@Authorize()
export class LoginAnnouncementController {
  constructor(private readonly db: Db) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");

  private async present(row: Record<string, unknown>, withDates: boolean) {
    return {
      id: row.id, content: row.content, isActive: row.isActive,
      ...(withDates ? { createdDate: row.createdDate, modifiedDate: row.modifiedDate } : {}),
      targetRoles: parseRoles(row.targetRoles as string | null), targetFilters: parseFilters(row.targetFilters as string | null),
      targetLocations: await describeLocations(this.db, parseLocations(row.targetLocations as string | null)),
    };
  }

  /** Each targeting part is validated only when sent (older clients omit it). */
  private async targeting(body: unknown) {
    const roles = bodyField(body, "targetRoles"), filters = bodyField(body, "targetFilters"), locations = bodyField(body, "targetLocations");
    const out = { sentRoles: roles !== undefined && roles !== null, sentFilters: filters !== undefined && filters !== null, sentLocations: locations !== undefined && locations !== null,
      roles: null as string | null, filters: null as string | null, locations: null as string | null, error: null as string | null };
    if (out.sentRoles) [out.roles, out.error] = normalizeRoles(Array.isArray(roles) ? roles : []);
    if (!out.error && out.sentFilters) [out.filters, out.error] = normalizeFilters(typeof filters === "object" ? (filters as Record<string, unknown>) : {});
    if (!out.error && out.sentLocations) [out.locations, out.error] = await normalizeLocations(this.db, locations);
    return out;
  }

  @Get()
  async all(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const rows = await this.db.query(
      `SELECT pk_announcement_id AS id, content, is_active AS isActive, created_date AS createdDate, modified_date AS modifiedDate,
              target_roles AS targetRoles, target_filters AS targetFilters, target_locations AS targetLocations
       FROM login_announcements WHERE isdeleted = 0 ORDER BY pk_announcement_id DESC`);
    const result = [];
    for (const r of rows) result.push(await this.present(r, true));
    return ok(result);
  }

  @Get("active")
  async active(@User() u: CurrentUser, @Query("currentRole") role?: string) {
    return ok(await buildActivePayload(this.db, userId(u), true, queryString(role)));
  }

  @Get(":id")
  async byId(@User() u: CurrentUser, @Param("id") idText: string) {
    const id = paramInt(idText);
    if (!this.isSuperAdmin(u)) return forbid();
    const row = await this.db.queryFirstOrDefault(
      `SELECT pk_announcement_id AS id, content, is_active AS isActive, target_roles AS targetRoles, target_filters AS targetFilters, target_locations AS targetLocations
       FROM login_announcements WHERE pk_announcement_id = @Id AND isdeleted = 0`, { Id: id });
    return row ? ok(await this.present(row, false)) : notFound({ message: "Not found." });
  }

  @Post()
  async create(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const t = await this.targeting(body ?? {});
    if (t.error) return badRequest({ message: t.error });
    const isActive = bodyField(body, "isActive");
    const id = await this.db.session(async (conn) => Number(await conn.executeScalar(
      `INSERT INTO login_announcements (content, is_active, target_roles, target_filters, target_locations, created_by, created_date, isdeleted)
       VALUES (@Content, @IsActive, @TargetRoles, @TargetFilters, @TargetLocations, @UserId, NOW(), 0);
       SELECT LAST_INSERT_ID();`,
      { Content: String(bodyField(body, "content") ?? ""), IsActive: isActive === false ? 0 : 1, TargetRoles: t.roles, TargetFilters: t.filters, TargetLocations: t.locations, UserId: userId(u) },
    )));
    return ok({ id, message: "Announcement created." });
  }

  /** Clears the reads so everyone sees the edited content. */
  @Put(":id")
  async update(@User() u: CurrentUser, @Param("id") idText: string, @Body() body: unknown) {
    const id = paramInt(idText);
    if (!this.isSuperAdmin(u)) return forbid();
    const t = await this.targeting(body ?? {});
    if (t.error) return badRequest({ message: t.error });
    const isActive = bodyField(body, "isActive");
    await this.db.execute(
      `UPDATE login_announcements SET content = @Content, is_active = @IsActive,
           ${t.sentRoles ? "target_roles = @TargetRoles," : ""} ${t.sentFilters ? "target_filters = @TargetFilters," : ""} ${t.sentLocations ? "target_locations = @TargetLocations," : ""}
           modified_by = @UserId, modified_date = NOW()
       WHERE pk_announcement_id = @Id AND isdeleted = 0`,
      { Content: String(bodyField(body, "content") ?? ""), IsActive: isActive === false ? 0 : 1, TargetRoles: t.roles, TargetFilters: t.filters, TargetLocations: t.locations, UserId: userId(u), Id: id },
    );
    await this.db.execute("DELETE FROM login_announcement_reads WHERE fk_announcement_id = @Id", { Id: id });
    return ok({ message: "Announcement updated. All users will see the popup again." });
  }

  /** Reactivating clears the reads. */
  @Put(":id/toggle")
  async toggle(@User() u: CurrentUser, @Param("id") idText: string) {
    const id = paramInt(idText);
    if (!this.isSuperAdmin(u)) return forbid();
    const v = await this.db.executeScalar("SELECT is_active FROM login_announcements WHERE pk_announcement_id = @Id AND isdeleted = 0", { Id: id });
    const current = v === true || Number(v) === 1;
    await this.db.execute("UPDATE login_announcements SET is_active = IF(is_active = 1, 0, 1), modified_by = @UserId, modified_date = NOW() WHERE pk_announcement_id = @Id AND isdeleted = 0", { UserId: userId(u), Id: id });
    if (!current) await this.db.execute("DELETE FROM login_announcement_reads WHERE fk_announcement_id = @Id", { Id: id });
    return ok({ message: current ? "Deactivated." : "Activated. All users will see this popup again." });
  }

  @Delete(":id")
  async remove(@User() u: CurrentUser, @Param("id") idText: string) {
    const id = paramInt(idText);
    if (!this.isSuperAdmin(u)) return forbid();
    await this.db.execute("UPDATE login_announcements SET isdeleted = 1, modified_by = @UserId, modified_date = NOW() WHERE pk_announcement_id = @Id", { UserId: userId(u), Id: id });
    return ok({ message: "Announcement deleted." });
  }

  @Post("acknowledge")
  async acknowledgeMany(@User() u: CurrentUser, @Body() body: unknown) {
    await acknowledge(this.db, userId(u), ackIds(body));
    return ok({ message: "Acknowledged." });
  }

  @Post(":id/acknowledge")
  async acknowledgeOne(@User() u: CurrentUser, @Param("id") idText: string) {
    await acknowledge(this.db, userId(u), [paramInt(idText)]);
    return ok({ message: "Acknowledged." });
  }
}

/** Port of MobileLoginAnnouncementController (same .cs file). Family Login sessions never see announcements. */
@Controller("api/mobile/login-announcement")
@Authorize()
export class MobileLoginAnnouncementController {
  constructor(private readonly db: Db) {}

  private isFamily = (u: CurrentUser) => u.findFirst("familyMemberId") !== null && u.findFirst("familyMemberId") !== undefined;

  @Get("active")
  async active(@User() u: CurrentUser, @Query("currentRole") role?: string) {
    if (this.isFamily(u)) return ok({ show: false, items: [] });
    return ok(await buildActivePayload(this.db, userId(u), false, queryString(role)));
  }

  @Post("acknowledge")
  async acknowledgeMany(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isFamily(u)) await acknowledge(this.db, userId(u), ackIds(body));
    return ok({ message: "Acknowledged." });
  }

  @Post(":id/acknowledge")
  async acknowledgeOne(@User() u: CurrentUser, @Param("id") idText: string) {
    const id = paramInt(idText);
    if (!this.isFamily(u)) await acknowledge(this.db, userId(u), [id]);
    return ok({ message: "Acknowledged." });
  }
}
