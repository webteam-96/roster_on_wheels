import { Controller, Get } from "@nestjs/common";
import { Db, type DbCommands } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { ok } from "../../common/results";

interface DashboardEntry {
  kind: string;
  route: string;
  label: string;
  clubId: number | null;
  clubName: string | null;
  districtId: number | null;
  districtNumber: string | null;
  zoneId: number | null;
  zoneName: string | null;
}

const entry = (kind: string, route: string, label: string, scope: Partial<DashboardEntry> = {}): DashboardEntry => ({
  kind, route, label, clubId: null, clubName: null, districtId: null, districtNumber: null, zoneId: null, zoneName: null, ...scope,
});
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const text = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** Goal-setting oversight role types, in switcher order. */
const GOAL_ROLES: [string, string, string][] = [
  ["AllCategoryAllDistrictsFewZones", "RI Director", "ri-director"],
  ["AllDistrictsOneCategoryOneZone", "Zone Co-ordinator", "zone-coordinator"],
  ["FewDistrictsOneCategoryOneZone", "District Assistant", "district-assistant"],
];

/**
 * Port of DashboardResolverController.cs: where a signed-in member lands, and
 * every dashboard they can switch to (one entry per role and scope).
 *
 * Web landing priority: District Admin > Club Admin > RI Director > Zonal
 * Coordinator > AG > Club Moderator > goal oversight > SuperAdmin (SuperAdmin
 * only when it is the sole role). Mobile keeps RI Director > Zonal Coordinator
 * > District Admin > AG > Club Admin and has no goal-oversight entries.
 */
@Controller()
@Authorize()
export class DashboardResolverController {
  constructor(private readonly db: Db) {}

  @Get("api/dashboard/resolve-landing")
  resolve(@User() user: CurrentUser) {
    return this.resolveCore(user, true);
  }

  @Get("api/mobile/dashboard/resolve-landing")
  resolveMobile(@User() user: CurrentUser) {
    return this.resolveCore(user, false);
  }

  private async resolveCore(user: CurrentUser, includeGoal: boolean) {
    const memberId = parseInt(user.findFirst("memberId") ?? "0", 10);
    if (memberId <= 0) return ok({ route: "/", reason: "no-member-id", available: [] });
    const available = await this.db.session((conn) => DashboardResolverController.entries(conn, memberId, user.findFirst("roles") ?? "", includeGoal));
    if (!available.length) return ok({ route: "/", reason: "member-fallback", available });

    const first = (kind: string) => available.find((e) => e.kind === kind);
    const order = includeGoal
      ? ["district-admin", "club-admin", "ri-director", "zonal-coordinator", "ag"]
      : ["ri-director", "zonal-coordinator", "district-admin", "ag", "club-admin"];
    const landing =
      order.map(first).find(Boolean) ?? first("club-moderator") ?? first("goal-oversight") ?? first("super-admin") ?? available[0];
    const reason = available.length > 1 ? `multi-role-default:${landing.kind}` : landing.kind;
    return ok({ route: landing.route, reason, available });
  }

  private static async entries(conn: DbCommands, memberId: number, roles: string, includeGoal: boolean): Promise<DashboardEntry[]> {
    const available: DashboardEntry[] = [];
    if (roles.includes("SuperAdmin")) available.push(entry("super-admin", "/settings/global-search", "Super Admin"));

    // District Admin: role 2 with a district and no club.
    for (const r of await conn.query(
      `SELECT mr.fk_district_id AS districtId, d.DistrictNumber AS districtNumber, d.fk_zone_id AS zoneId, z.ZoneName AS zoneName
       FROM member_roles mr
       JOIN district_master d ON d.pk_district_id = mr.fk_district_id
       LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE mr.fk_member_master_profile_id = @MemberId
         AND mr.fk_role_id = 2
         AND mr.fk_district_id IS NOT NULL AND mr.fk_district_id > 0
         AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
         AND mr.IsActive = 1 AND mr.isdeleted = 0
         AND d.isdeleted = 0
       ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber`,
      { MemberId: memberId },
    )) {
      available.push(entry("district-admin", "/district-admin-dashboard", "District Admin", {
        districtId: num(r.districtId), districtNumber: text(r.districtNumber), zoneId: num(r.zoneId), zoneName: text(r.zoneName),
      }));
    }

    // AG (role 6), district-scoped.
    for (const r of await conn.query(
      `SELECT mr.fk_district_id AS districtId, d.DistrictNumber AS districtNumber, d.fk_zone_id AS zoneId, z.ZoneName AS zoneName
       FROM member_roles mr
       LEFT JOIN district_master d ON d.pk_district_id = mr.fk_district_id
       LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE mr.fk_member_master_profile_id = @MemberId
         AND mr.fk_role_id = 6
         AND mr.IsActive = 1 AND mr.isdeleted = 0
         AND (d.isdeleted IS NULL OR d.isdeleted = 0)
       ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber`,
      { MemberId: memberId },
    )) {
      available.push(entry("ag", "/ag-dashboard", "AG Dashboard", {
        districtId: num(r.districtId), districtNumber: text(r.districtNumber), zoneId: num(r.zoneId), zoneName: text(r.zoneName),
      }));
    }

    // Club Admin: role 2 with a club.
    for (const r of await conn.query(
      `SELECT mr.fk_club_id AS clubId, c.ClubName AS clubName, c.fk_district_id AS districtId,
              d.DistrictNumber AS districtNumber, d.fk_zone_id AS zoneId, z.ZoneName AS zoneName
       FROM member_roles mr
       JOIN club_master c ON c.pk_club_id = mr.fk_club_id
       LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
       LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE mr.fk_member_master_profile_id = @MemberId
         AND mr.fk_role_id = 2
         AND mr.fk_club_id IS NOT NULL AND mr.fk_club_id > 0
         AND mr.IsActive = 1 AND mr.isdeleted = 0
         AND c.isdeleted = 0
       ORDER BY c.ClubName`,
      { MemberId: memberId },
    )) {
      available.push(entry("club-admin", "/club-admin-dashboard", "Club Admin", {
        clubId: num(r.clubId), clubName: text(r.clubName), districtId: num(r.districtId), districtNumber: text(r.districtNumber),
        zoneId: num(r.zoneId), zoneName: text(r.zoneName),
      }));
    }

    if (roles.includes("ClubModerator")) {
      const rows = await conn.query(
        `SELECT mr.fk_club_id AS clubId, c.ClubName AS clubName, c.fk_district_id AS districtId,
                d.DistrictNumber AS districtNumber, d.fk_zone_id AS zoneId, z.ZoneName AS zoneName
         FROM member_roles mr
         JOIN roles r ON r.pk_role_id = mr.fk_role_id
         LEFT JOIN club_master c ON c.pk_club_id = mr.fk_club_id
         LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
         LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
         WHERE mr.fk_member_master_profile_id = @MemberId
           AND r.RoleName = 'ClubModerator'
           AND mr.IsActive = 1 AND mr.isdeleted = 0
           AND (c.isdeleted IS NULL OR c.isdeleted = 0)
         ORDER BY c.ClubName`,
        { MemberId: memberId },
      );
      for (const r of rows) {
        available.push(entry("club-moderator", "/club-moderator/v2", "Club Moderator", {
          clubId: num(r.clubId), clubName: text(r.clubName), districtId: num(r.districtId), districtNumber: text(r.districtNumber),
          zoneId: num(r.zoneId), zoneName: text(r.zoneName),
        }));
      }
      // The claim says moderator but no row resolved: keep the dashboard reachable.
      if (!rows.length) available.push(entry("club-moderator", "/club-moderator/v2", "Club Moderator"));
    }

    if (roles.includes("ZonalCoordinator")) {
      const rows = await conn.query(
        `SELECT mr.fk_zone_id AS zoneId, z.ZoneName AS zoneName
         FROM member_roles mr
         JOIN roles r ON r.pk_role_id = mr.fk_role_id
         LEFT JOIN zone_master z ON z.pk_zone_id = mr.fk_zone_id
         WHERE mr.fk_member_master_profile_id = @MemberId
           AND r.RoleName = 'ZonalCoordinator'
           AND mr.IsActive = 1 AND mr.isdeleted = 0
         ORDER BY z.ZoneName`,
        { MemberId: memberId },
      );
      for (const r of rows) available.push(entry("zonal-coordinator", "/zonal-dashboard", "Zonal Dashboard", { zoneId: num(r.zoneId), zoneName: text(r.zoneName) }));
      if (!rows.length) available.push(entry("zonal-coordinator", "/zonal-dashboard", "Zonal Dashboard"));
    }

    if (roles.includes("RIDirector")) available.push(entry("ri-director", "/ri-director/v2", "RI Director"));

    if (includeGoal) {
      // Goal-setting oversight roles live in goal_role_assignments, not member_roles.
      const held = new Set(
        (await conn.query(
          `SELECT DISTINCT RoleType FROM goal_role_assignments
           WHERE fk_member_id = @MemberId AND fk_member_id > 0 AND IsActive = 1 AND isdeleted = 0`,
          { MemberId: memberId },
        )).map((r) => String(r.RoleType)),
      );
      for (const [roleType, label, as] of GOAL_ROLES) {
        if (held.has(roleType)) available.push(entry("goal-oversight", `/goal-overviews?as=${as}`, `Goal Setting - ${label}`));
      }
      // A SuperAdmin with the per-user "Goal Setting enabled" switch gets the unscoped overview.
      if (!available.some((e) => e.kind === "goal-oversight") && roles.includes("SuperAdmin")) {
        const enabled = await conn.executeScalar("SELECT IsEnabled FROM goal_oversight_access WHERE fk_member_id = @Id", { Id: memberId });
        if (Number(enabled) === 1) available.push(entry("goal-oversight", "/goal-overviews", "Goal Overview"));
      }
    }
    return available;
  }
}
