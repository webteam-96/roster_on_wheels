import { Body, Controller, Get, Header, Put } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField, dbDateTime } from "../../common/binding";
import { defineDto } from "../../common/dto";
import { badRequest, ok, statusCode } from "../../common/results";
import { Db } from "../../database/db.service";

const RouteMaintenanceActiveDto = defineDto({
  RouteKey: { type: "string", default: () => "" }, IsUnderMaintenance: "bool", Message: "string", MaintenanceUntil: "datetime?",
});
const RouteMaintenanceFullDto = defineDto({
  Id: "int", RouteKey: { type: "string", default: () => "" }, Label: "string", IsUnderMaintenance: "bool", Message: "string",
  MaintenanceUntil: "datetime?", ModifiedDate: "datetime?",
});

/**
 * Port of RouteMaintenanceController.cs: the app's per-screen maintenance switchboard.
 * The app polls the active flags (any signed-in user; cached 30 s, the same for
 * everyone); SuperAdmins (member_roles role 3) read and set every flag.
 */
@Controller("api/app/route-maintenance")
@Authorize()
export class RouteMaintenanceController {
  constructor(private readonly db: Db) {}

  private userId = (u: CurrentUser) => { const v = u.findFirst("memberId") ?? ""; return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0; };

  private async isSuperAdmin(u: CurrentUser) {
    const count = await this.db.executeScalar(
      `SELECT COUNT(*) FROM member_roles
       WHERE fk_member_master_profile_id = @MemberId
         AND fk_role_id = 3
         AND IsActive = 1
         AND isdeleted = 0`,
      { MemberId: this.userId(u) },
    );
    return Number(count) > 0;
  }

  @Get()
  @Header("Cache-Control", "public,max-age=30")
  async getActive() {
    return ok(RouteMaintenanceActiveDto.mapAll(await this.db.query(`
      SELECT
          RouteKey            AS RouteKey,
          IsUnderMaintenance  AS IsUnderMaintenance,
          Message             AS Message,
          MaintenanceUntil    AS MaintenanceUntil
      FROM route_maintenance
      WHERE IsUnderMaintenance = 1
      ORDER BY RouteKey`)));
  }

  @Get("all")
  async getAll(@User() u: CurrentUser) {
    if (!(await this.isSuperAdmin(u))) return statusCode(403, { message: "SuperAdmin access required." });
    return ok(RouteMaintenanceFullDto.mapAll(await this.db.query(`
      SELECT
          pk_route_maintenance_id AS Id,
          RouteKey                AS RouteKey,
          Label                   AS Label,
          IsUnderMaintenance      AS IsUnderMaintenance,
          Message                 AS Message,
          MaintenanceUntil        AS MaintenanceUntil,
          modified_date           AS ModifiedDate
      FROM route_maintenance
      ORDER BY RouteKey`)));
  }

  @Put()
  async upsert(@User() u: CurrentUser, @Body() body: unknown) {
    if (!(await this.isSuperAdmin(u))) return statusCode(403, { message: "SuperAdmin access required." });
    const routeKey = bodyField(body, "routeKey");
    if (routeKey === null || routeKey === undefined || !String(routeKey).trim()) return badRequest({ message: "RouteKey is required." });
    const message = bodyField(body, "message");
    // A RouteKey not in the seed is inserted, so new app screens can be switched without a migration.
    await this.db.execute(
      `INSERT INTO route_maintenance
          (RouteKey, IsUnderMaintenance, Message, MaintenanceUntil, modified_by)
       VALUES
          (@RouteKey, @IsUnderMaintenance, @Message, @MaintenanceUntil, @ModifiedBy)
       ON DUPLICATE KEY UPDATE
          IsUnderMaintenance = VALUES(IsUnderMaintenance),
          Message            = VALUES(Message),
          MaintenanceUntil   = VALUES(MaintenanceUntil),
          modified_by        = VALUES(modified_by),
          modified_date      = CURRENT_TIMESTAMP`,
      {
        RouteKey: String(routeKey), IsUnderMaintenance: bodyField(body, "isUnderMaintenance") === true ? 1 : 0,
        Message: message === null || message === undefined ? null : String(message),
        MaintenanceUntil: dbDateTime(bodyField(body, "maintenanceUntil")), ModifiedBy: this.userId(u),
      },
    );
    return ok({ message: "Route maintenance flag updated." });
  }
}
