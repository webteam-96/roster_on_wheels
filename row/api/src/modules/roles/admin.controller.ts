import { Body, Controller, Delete, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { RoleService } from "./role.service";
import { Db } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, notFound, ok, statusCode } from "../../common/results";
import { InvalidOperationException, KeyNotFoundException } from "../../common/exceptions";
import { paramInt, queryDate, queryInt, queryString } from "../../common/binding";
import { AssignRIDirectorDto, AssignZonalCoordinatorDto, RoleRequestDto, type RoleRequest } from "../../dtos/role.dtos";

const msg = (e: unknown) => (e as Error).message;

/** Port of AdminController.cs: api/Admin. */
@Controller("api/admin")
@Authorize()
export class AdminController {
  constructor(
    private readonly roles: RoleService,
    private readonly db: Db,
  ) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private isSuperAdminOrAdmin = (u: CurrentUser) => {
    const roles = u.findFirst("roles") ?? "";
    return roles.includes("SuperAdmin") || roles.includes("Admin");
  };
  private memberId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);

  @Post("assign-role")
  async assignRole(@Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    if (!this.isSuperAdminOrAdmin(user)) return statusCode(403, { message: "Only SuperAdmin or Admin can assign roles." });
    try {
      return ok(await this.roles.assignAdminRole(RoleRequestDto.create(body ?? {}) as unknown as RoleRequest, this.memberId(user)));
    } catch (e) {
      if (e instanceof KeyNotFoundException) return notFound({ message: msg(e) });
      if (e instanceof InvalidOperationException) return badRequest({ message: msg(e) });
      return statusCode(500, { message: `Failed to assign admin role: ${msg(e)}` });
    }
  }

  @Post("remove-role")
  async removeRole(@Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    if (!this.isSuperAdminOrAdmin(user)) return statusCode(403, { message: "Only SuperAdmin or Admin can remove roles." });
    try {
      return ok(await this.roles.removeAdminRole(RoleRequestDto.create(body ?? {}) as unknown as RoleRequest, this.memberId(user)));
    } catch (e) {
      if (e instanceof InvalidOperationException) return badRequest({ message: msg(e) });
      return statusCode(500, { message: `Failed to remove admin role: ${msg(e)}` });
    }
  }

  @Get("members-with-roles")
  async membersWithRoles(@User() user: CurrentUser, @Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("search") search?: string) {
    if (!this.isSuperAdminOrAdmin(user)) return statusCode(403, { message: "Only SuperAdmin or Admin can view member roles." });
    try {
      return ok(await this.roles.getAllMembersWithRoles(queryInt(page, 1), queryInt(pageSize, 10), queryString(search)));
    } catch (e) {
      return statusCode(500, { message: `Failed to fetch member roles: ${msg(e)}` });
    }
  }

  @Get("zonal-coordinator/:zoneId")
  async getZonalCoordinator(@Param("zoneId") zoneText: string, @User() user: CurrentUser) {
    const zoneId = paramInt(zoneText, "zoneId");
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can manage zonal coordinators." });
    try {
      return ok(await this.roles.getZonalCoordinator(zoneId));
    } catch (e) {
      return statusCode(500, { message: `Failed to get zonal coordinator: ${msg(e)}` });
    }
  }

  @Post("zonal-coordinator")
  async assignZonalCoordinator(@Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can assign zonal coordinators." });
    const dto = AssignZonalCoordinatorDto.create(body ?? {}) as { memberId: number; zoneId: number };
    try {
      return ok(await this.roles.assignZonalCoordinator(dto.memberId, dto.zoneId, this.memberId(user)));
    } catch (e) {
      if (e instanceof KeyNotFoundException) return notFound({ message: msg(e) });
      return statusCode(500, { message: `Failed to assign zonal coordinator: ${msg(e)}` });
    }
  }

  @Delete("zonal-coordinator/:zoneId")
  async removeZonalCoordinator(@Param("zoneId") zoneText: string, @User() user: CurrentUser) {
    const zoneId = paramInt(zoneText, "zoneId");
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can remove zonal coordinators." });
    try {
      return ok(await this.roles.removeZonalCoordinator(zoneId, this.memberId(user)));
    } catch (e) {
      return statusCode(500, { message: `Failed to remove zonal coordinator: ${msg(e)}` });
    }
  }

  @Get("ri-directors")
  async riDirectors(@User() user: CurrentUser) {
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can view RI Directors." });
    try {
      return ok(await this.roles.getRIDirectors());
    } catch (e) {
      return statusCode(500, { message: `Failed to list RI Directors: ${msg(e)}` });
    }
  }

  /** {memberId:int}: a non-numeric id does not match the route (404). */
  @Get("ri-directors/:memberId/profile")
  async riDirectorProfile(@Param("memberId") idText: string, @User() user: CurrentUser) {
    if (!/^-?\d+$/.test(idText)) return notFound();
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can view RI Director profiles." });
    const profile = await this.roles.getRIDirectorProfile(Number(idText));
    return profile ? ok(profile) : notFound({ message: "Member not found." });
  }

  @Post("assign-ri-director")
  async assignRIDirector(@Body() body: Record<string, unknown>, @User() user: CurrentUser, @Req() req: Request) {
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can assign RI Director." });
    const { memberId } = AssignRIDirectorDto.create(body ?? {}) as { memberId: number };
    try {
      return ok(await this.roles.assignRIDirector(memberId, this.memberId(user), req));
    } catch (e) {
      if (e instanceof KeyNotFoundException) return notFound({ message: msg(e) });
      if (e instanceof InvalidOperationException) return badRequest({ message: msg(e) });
      return statusCode(500, { message: `Failed to assign RI Director: ${msg(e)}` });
    }
  }

  @Post("send-ri-director-credentials")
  async sendRIDirectorCredentials(@Body() body: Record<string, unknown>, @User() user: CurrentUser, @Req() req: Request) {
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can send RI Director login details." });
    const { memberId } = AssignRIDirectorDto.create(body ?? {}) as { memberId: number };
    try {
      return ok(await this.roles.sendRIDirectorCredentials(memberId, this.memberId(user), req));
    } catch (e) {
      if (e instanceof KeyNotFoundException) return notFound({ message: msg(e) });
      if (e instanceof InvalidOperationException) return badRequest({ message: msg(e) });
      return statusCode(500, { message: `Failed to send login details: ${msg(e)}` });
    }
  }

  @Post("remove-ri-director")
  async removeRIDirector(@Body() body: Record<string, unknown>, @User() user: CurrentUser, @Req() req: Request) {
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can remove RI Director." });
    const { memberId } = AssignRIDirectorDto.create(body ?? {}) as { memberId: number };
    try {
      return ok(await this.roles.removeRIDirector(memberId, this.memberId(user), req));
    } catch (e) {
      if (e instanceof InvalidOperationException) return badRequest({ message: msg(e) });
      return statusCode(500, { message: `Failed to remove RI Director: ${msg(e)}` });
    }
  }

  @Get("audit-log")
  async auditLog(
    @User() user: CurrentUser, @Query("page") pageText?: string, @Query("pageSize") pageSizeText?: string, @Query("search") searchText?: string,
    @Query("action") actionText?: string, @Query("entityType") entityTypeText?: string, @Query("fromDate") fromText?: string, @Query("toDate") toText?: string,
  ) {
    const page = queryInt(pageText, 1);
    const pageSize = queryInt(pageSizeText, 50);
    const fromDate = queryDate(fromText);
    const toDate = queryDate(toText);
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can view audit logs." });
    const search = queryString(searchText);
    const action = queryString(actionText);
    const entityType = queryString(entityTypeText);

    const where = ["1=1"];
    const p: Record<string, unknown> = {};
    if (search && search.trim()) {
      where.push("(a.member_name LIKE @Search OR a.entity_name LIKE @Search OR a.details LIKE @Search OR a.ip_address LIKE @Search)");
      p.Search = `%${search}%`;
    }
    if (action && action.trim()) {
      where.push("a.action = @Action");
      p.Action = action;
    }
    if (entityType && entityType.trim()) {
      where.push("a.entity_type = @EntityType");
      p.EntityType = entityType;
    }
    if (fromDate) {
      where.push("a.created_date >= @FromDate");
      p.FromDate = fromDate;
    }
    if (toDate) {
      // toDate is inclusive: up to the start of the next day.
      where.push("a.created_date <= DATE_ADD(@ToDate, INTERVAL 1 DAY)");
      p.ToDate = toDate;
    }
    const whereSql = where.join(" AND ");
    p.Limit = pageSize;
    p.Offset = Math.max(0, (page - 1) * pageSize);

    return this.db.session(async (conn) => {
      const totalCount = Number(await conn.executeScalar(`SELECT COUNT(*) FROM audit_log a WHERE ${whereSql}`, p));
      const entityTypes = (await conn.query("SELECT DISTINCT entity_type FROM audit_log ORDER BY entity_type")).map((r) => r.entity_type as string | null);
      const items = await conn.query(
        `SELECT a.pk_audit_id AS id, a.fk_member_master_profile_id AS memberId, a.member_name AS memberName,
                a.role_name AS roleName, a.action, a.entity_type AS entityType, a.entity_id AS entityId,
                a.entity_name AS entityName, a.details, a.ip_address AS ipAddress, a.user_agent AS userAgent,
                a.created_date AS createdDate,
                c.ClubName AS clubName,
                COALESCE(dmp.DistrictNumber, dmc.DistrictNumber) AS districtNumber
         FROM audit_log a
         LEFT JOIN club_master c ON c.pk_club_id =
             CASE WHEN a.details LIKE '%/clubs/%'
                  THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(a.details, '/clubs/', -1), '/', 1) AS UNSIGNED) END
         LEFT JOIN district_master dmp ON dmp.pk_district_id =
             CASE WHEN a.details LIKE '%/districts/%'
                  THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(a.details, '/districts/', -1), '/', 1) AS UNSIGNED) END
         LEFT JOIN district_master dmc ON dmc.pk_district_id = c.fk_district_id
         WHERE ${whereSql}
         ORDER BY a.created_date DESC
         LIMIT @Limit OFFSET @Offset`,
        p,
      );
      return ok({ items, totalCount, page, pageSize, entityTypes });
    });
  }

  @Get("zone-members/:zoneId")
  async zoneMembers(@Param("zoneId") zoneText: string, @User() user: CurrentUser, @Query("search") search?: string) {
    const zoneId = paramInt(zoneText, "zoneId");
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can search zone members." });
    try {
      return ok(await this.roles.searchZoneMembers(zoneId, queryString(search, "")));
    } catch (e) {
      return statusCode(500, { message: `Failed to search zone members: ${msg(e)}` });
    }
  }
}
