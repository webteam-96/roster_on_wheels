import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { ZoneService } from "./zones.service";
import { Db } from "../../database/db.service";
import { AuditLogService } from "../../services/audit-log.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { conflict, createdAt, noContent, notFound, ok, statusCode } from "../../common/results";
import { paramInt, queryInt, queryString } from "../../common/binding";
import { CreateZoneDto, UpdateZoneDto } from "../../dtos/zone.dtos";

type ZoneInput = { zoneName: string; isActive: boolean };

/** Port of ZonesController.cs: api/Zones. */
@Controller("api/zones")
@Authorize()
export class ZonesController {
  constructor(
    private readonly zones: ZoneService,
    private readonly audit: AuditLogService,
    private readonly db: Db,
  ) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private memberId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);

  @Get()
  async getAll(@Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("search") search?: string, @Query("isActive") isActive?: string) {
    return ok(await this.zones.getAll(queryInt(page, 1), queryInt(pageSize, 12), queryString(search), queryInt(isActive)));
  }

  @Get(":id")
  async getById(@Param("id") idText: string) {
    const zone = await this.zones.getById(paramInt(idText));
    if (!zone) return notFound({ message: "Zone not found" });
    return ok(zone);
  }

  @Post()
  async create(@Body() body: Record<string, unknown>, @User() user: CurrentUser, @Req() req: Request) {
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can create zones." });
    const dto = CreateZoneDto.create(body ?? {}) as ZoneInput;
    try {
      const id = await this.zones.create(dto, this.memberId(user));
      await this.audit.log(this.memberId(user), "CREATE", "zone", id, dto.zoneName, { ZoneName: dto.zoneName, IsActive: dto.isActive }, req);
      return createdAt(`/api/Zones/${id}`, { id });
    } catch (e) {
      // The C# catches every exception here and answers 409.
      return conflict({ message: (e as Error).message });
    }
  }

  @Put(":id")
  async update(@Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser, @Req() req: Request) {
    const id = paramInt(idText);
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can update zones." });
    const dto = UpdateZoneDto.create(body ?? {}) as ZoneInput;
    if (!(await this.zones.getById(id))) return notFound({ message: "Zone not found" });
    try {
      await this.zones.update(id, dto, this.memberId(user));
      await this.audit.log(this.memberId(user), "UPDATE", "zone", id, dto.zoneName, { ZoneName: dto.zoneName, IsActive: dto.isActive }, req);
      return noContent();
    } catch (e) {
      return conflict({ message: (e as Error).message });
    }
  }

  @Delete(":id")
  async remove(@Param("id") idText: string, @User() user: CurrentUser, @Req() req: Request) {
    const id = paramInt(idText);
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can delete zones." });
    const existing = await this.zones.getById(id);
    if (!existing) return notFound({ message: "Zone not found" });
    await this.zones.delete(id, this.memberId(user));
    await this.audit.log(this.memberId(user), "DELETE", "zone", id, existing.zoneName as string, null, req);
    return noContent();
  }

  @Post(":id/toggle-zonal-awards")
  async toggleZonalAwards(@Param("id") idText: string, @User() user: CurrentUser) {
    const id = paramInt(idText);
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can toggle zonal awards." });
    return this.db.session(async (conn) => {
      await conn.execute("UPDATE zone_master SET IsZonalAwardsEnabled = IF(IsZonalAwardsEnabled = 1, 0, 1) WHERE pk_zone_id = @Id AND isdeleted = 0", { Id: id });
      const v = await conn.executeScalar("SELECT IsZonalAwardsEnabled FROM zone_master WHERE pk_zone_id = @Id", { Id: id });
      return ok({ isZonalAwardsEnabled: v === true || Number(v) === 1 });
    });
  }
}
