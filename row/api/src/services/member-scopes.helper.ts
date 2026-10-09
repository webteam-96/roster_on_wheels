import type { DbCommands, Row } from "../database/db.service";
import type { DtoObject } from "../common/dto";
import { Brand } from "../brand/brand";
import {
  ClubScopeDto,
  DistrictScopeDto,
  MemberMobileClubGroupDto,
  MemberMobileDashboardDto,
  MemberMobileDistrictGroupDto,
  MemberMobileModuleDto,
  RoleScopeDto,
  ZoneScopeDto,
} from "../dtos/scope.dtos";
import { normalizeClientDomain, normalizeSubdomain } from "./website-domain.helper";

/**
 * Port of MemberScopesHelper.cs: the scope builder shared by web login
 * (AuthService) and mobile (MobileAuthService.VerifyOtp / GetMyContext).
 *
 *  - roles:     one RoleScopeDto per (role x scoping unit) in member_roles, plus
 *               an implicit "Member" row per active club membership.
 *  - zones / districts / clubs: everything the member touches, with counts.
 *  - ZonalCoordinator: every district in the zone becomes accessible (no clubs).
 *  - District Admin: no implicit club access.
 *  - SuperAdmin is dropped for mobile callers (excludeSuperAdmin = true).
 */

export interface MemberScopesResult {
  roles: DtoObject[];
  zones: DtoObject[];
  districts: DtoObject[];
  clubs: DtoObject[];
  districtClubAccess: DtoObject[];
  memberMobileDashboard: DtoObject;
}

type Scope = {
  RoleName: string; Scope: string; ZoneId: number | null; ZoneName: string | null;
  DistrictId: number | null; DistrictNumber: string | null; ClubId: number | null; ClubName: string | null;
};
type District = { Id: number; Number: string; ZoneId: number | null; TotalClubs: number; TotalMembers: number; IsSynced: boolean };
type Club = { Id: number; Name: string; DistrictId: number | null; TotalMembers: number; WebsiteUrl: string | null; IsSynced: boolean };

const intOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function buildScopes(conn: DbCommands, memberId: number, excludeSuperAdmin = false): Promise<MemberScopesResult> {
  const rolesList: Scope[] = [];
  const accessibleZones = new Map<number, { Id: number; Name: string }>();
  const accessibleDistricts = new Map<number, District>();
  const accessibleClubs = new Map<number, Club>();
  const newDistrict = (Id: number, Number: string, ZoneId: number | null): District => ({ Id, Number, ZoneId, TotalClubs: 0, TotalMembers: 0, IsSynced: false });
  const newClub = (Id: number, Name: string, DistrictId: number | null): Club => ({ Id, Name, DistrictId, TotalMembers: 0, WebsiteUrl: null, IsSynced: false });

  // (1) Elevated roles from member_roles: one row per (role x scoping unit).
  const elevatedSql =
    `SELECT r.RoleName AS roleName,
            COALESCE(mr.fk_zone_id, d.fk_zone_id, cd.fk_zone_id) AS zoneId,
            COALESCE(z.ZoneName, dz.ZoneName, cdz.ZoneName) AS zoneName,
            mr.fk_district_id AS districtId, d.DistrictNumber AS districtNumber,
            mr.fk_club_id AS clubId, c.ClubName AS clubName,
            c.fk_district_id AS clubDistrictId, cd.DistrictNumber AS clubDistrictNumber
     FROM member_roles mr
     JOIN roles r ON r.pk_role_id = mr.fk_role_id
     LEFT JOIN zone_master z ON z.pk_zone_id = mr.fk_zone_id
     LEFT JOIN district_master d ON d.pk_district_id = mr.fk_district_id
     LEFT JOIN zone_master dz ON dz.pk_zone_id = d.fk_zone_id
     LEFT JOIN club_master c ON c.pk_club_id = mr.fk_club_id
     LEFT JOIN district_master cd ON cd.pk_district_id = c.fk_district_id
     LEFT JOIN zone_master cdz ON cdz.pk_zone_id = cd.fk_zone_id
     WHERE mr.fk_member_master_profile_id = @MemberId
       AND mr.IsActive = 1 AND mr.isdeleted = 0` + (excludeSuperAdmin ? " AND r.RoleName <> 'SuperAdmin'" : "");

  for (const row of await conn.query(elevatedSql, { MemberId: memberId })) {
    const scope: Scope = {
      RoleName: row.roleName ?? "", Scope: "global", ZoneId: null, ZoneName: null,
      DistrictId: null, DistrictNumber: null, ClubId: null, ClubName: null,
    };
    // fk_*_id = 0 is the legacy "no scope" sentinel: treat it as NULL.
    const zid = intOrNull(row.zoneId);
    const did = intOrNull(row.districtId);
    const cid = intOrNull(row.clubId);

    if (zid !== null && zid > 0) {
      scope.Scope = "zone";
      scope.ZoneId = zid;
      scope.ZoneName = row.zoneName ?? null;
      if (!accessibleZones.has(zid)) accessibleZones.set(zid, { Id: zid, Name: scope.ZoneName ?? "" });
    }
    if (did !== null && did > 0) {
      scope.Scope = "district";
      scope.DistrictId = did;
      scope.DistrictNumber = row.districtNumber ?? null;
      if (!accessibleDistricts.has(did)) accessibleDistricts.set(did, newDistrict(did, scope.DistrictNumber ?? "", scope.ZoneId));
    }
    if (cid !== null && cid > 0) {
      scope.Scope = "club";
      scope.ClubId = cid;
      scope.ClubName = row.clubName ?? null;
      scope.DistrictId = intOrNull(row.clubDistrictId);
      scope.DistrictNumber = row.clubDistrictNumber ?? null;
      if (!accessibleClubs.has(cid)) accessibleClubs.set(cid, newClub(cid, scope.ClubName ?? "", scope.DistrictId));
      if (scope.DistrictId !== null && scope.DistrictId > 0 && !accessibleDistricts.has(scope.DistrictId)) {
        accessibleDistricts.set(scope.DistrictId, newDistrict(scope.DistrictId, scope.DistrictNumber ?? "", scope.ZoneId));
      }
    }
    rolesList.push(scope);
  }

  // (2) Implicit "Member" role for every active club membership.
  const clubMemberships = await conn.query(
    `SELECT c.pk_club_id AS clubId, c.ClubName, c.fk_district_id AS districtId,
            d.DistrictNumber, d.fk_zone_id AS zoneId, z.ZoneName AS zoneName
     FROM club_members cm
     JOIN club_master c ON c.pk_club_id = cm.fk_club_id
     LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
     LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
     WHERE cm.fk_member_master_profile_id = @MemberId
       AND cm.IsActive = 1 AND cm.isdeleted = 0
       AND c.isdeleted = 0`,
    { MemberId: memberId },
  );
  for (const row of clubMemberships) {
    const clubId = Number(row.clubId);
    const distId = intOrNull(row.districtId);
    const zId = intOrNull(row.zoneId);
    rolesList.push({
      RoleName: "Member", Scope: "club", ClubId: clubId, ClubName: row.ClubName ?? null,
      DistrictId: distId, DistrictNumber: row.DistrictNumber ?? null, ZoneId: zId, ZoneName: row.zoneName ?? null,
    });
    if (zId !== null && !accessibleZones.has(zId)) accessibleZones.set(zId, { Id: zId, Name: row.zoneName ?? "" });
    if (!accessibleClubs.has(clubId)) accessibleClubs.set(clubId, newClub(clubId, row.ClubName ?? "", distId));
    if (distId !== null && !accessibleDistricts.has(distId)) accessibleDistricts.set(distId, newDistrict(distId, row.DistrictNumber ?? "", zId));
  }

  // (3) ZonalCoordinator sees every district in their zone (no automatic clubs).
  for (const role of [...rolesList]) {
    if (role.RoleName === "ZonalCoordinator" && role.ZoneId !== null) {
      const zoneDistricts = await conn.query(
        `SELECT pk_district_id AS id, DistrictNumber FROM district_master
         WHERE fk_zone_id = @Z AND isdeleted = 0`,
        { Z: role.ZoneId },
      );
      for (const d of zoneDistricts) {
        const dId = Number(d.id);
        if (!accessibleDistricts.has(dId)) accessibleDistricts.set(dId, newDistrict(dId, d.DistrictNumber ?? "", role.ZoneId));
      }
    }
  }

  // Counts: districts.
  if (accessibleDistricts.size > 0) {
    const districtIds = [...accessibleDistricts.keys()];
    for (const dc of await conn.query(
      `SELECT fk_district_id AS districtId,
              COUNT(*) AS totalClubs,
              SUM(CASE WHEN IsSyncedFromRotaryOrg = 1 THEN 1 ELSE 0 END) AS syncedClubs
       FROM club_master WHERE fk_district_id IN @Ids AND isdeleted = 0
       GROUP BY fk_district_id`,
      { Ids: districtIds },
    )) {
      const d = accessibleDistricts.get(Number(dc.districtId));
      if (d) {
        d.TotalClubs = Number(dc.totalClubs);
        d.IsSynced = Number(dc.syncedClubs ?? 0) > 0;
      }
    }
    for (const dm of await conn.query(
      `SELECT c.fk_district_id AS districtId,
              COUNT(DISTINCT cm.fk_member_master_profile_id) AS totalMembers
       FROM club_members cm
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id
       JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
       WHERE c.fk_district_id IN @Ids AND cm.IsActive = 1 AND cm.isdeleted = 0 AND c.isdeleted = 0 AND m.isdeleted = 0
       GROUP BY c.fk_district_id`,
      { Ids: districtIds },
    )) {
      const d = accessibleDistricts.get(Number(dm.districtId));
      if (d) d.TotalMembers = Number(dm.totalMembers);
    }
  }

  // Counts and website URLs: clubs.
  if (accessibleClubs.size > 0) {
    const clubIds = [...accessibleClubs.keys()];
    for (const cm of await conn.query(
      `SELECT fk_club_id AS clubId,
              COUNT(*) AS totalMembers
       FROM club_members WHERE fk_club_id IN @Ids AND IsActive = 1 AND isdeleted = 0
       GROUP BY fk_club_id`,
      { Ids: clubIds },
    )) {
      const c = accessibleClubs.get(Number(cm.clubId));
      if (c) c.TotalMembers = Number(cm.totalMembers);
    }

    // IsSynced (Rotary.org) per club gates Goal Setting in the sidebar.
    for (const cs of await conn.query(
      `SELECT pk_club_id AS clubId, IsSyncedFromRotaryOrg AS isSynced
       FROM club_master WHERE pk_club_id IN @Ids AND isdeleted = 0`,
      { Ids: clubIds },
    )) {
      const c = accessibleClubs.get(Number(cs.clubId));
      if (c) c.IsSynced = Number(cs.isSynced ?? 0) === 1;
    }

    // WebsiteUrl: ClientDomain, else Subdomain.{parent}. The parent comes from
    // system_settings, else the brand (WS1-06; RIZones default rotaryindia.org).
    let parentDomain = await conn.executeScalar<string>("SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteParentDomain'");
    if (!parentDomain || !parentDomain.trim()) parentDomain = Brand.Current.domains.clubSiteParent;

    const siteRows = await conn.query(
      `SELECT fk_club_id AS clubId, Subdomain, ClientDomain
       FROM club_websites
       WHERE fk_club_id IN @Ids
         AND COALESCE(isdeleted, 0) = 0
         AND Status = 'Active'
         AND CURDATE() BETWEEN StartDate AND EndDate
       ORDER BY pk_id DESC`,
      { Ids: clubIds },
    );
    // Every accessible club carries a WebsiteUrl string, empty when there is no current website.
    for (const entry of accessibleClubs.values()) if (entry.WebsiteUrl === null) entry.WebsiteUrl = "";
    for (const row of siteRows) {
      const c = accessibleClubs.get(Number(row.clubId));
      if (!c || c.WebsiteUrl) continue;
      c.WebsiteUrl = buildWebsiteUrl(row.ClientDomain?.trim() ?? null, row.Subdomain?.trim() ?? null, parentDomain);
    }
  }

  // (4) Mobile dashboard: one module group per accessible club / district.
  //     Admin for this scope -> every enabled module; plain member -> IsDefaultForMember only.
  const adminClubIds = new Set(
    (await conn.query<{ id: number }>(
      `SELECT DISTINCT mr.fk_club_id AS id
       FROM member_roles mr
       JOIN roles r ON r.pk_role_id = mr.fk_role_id
       WHERE mr.fk_member_master_profile_id = @MemberId
         AND r.RoleName = 'Admin'
         AND mr.IsActive = 1 AND mr.isdeleted = 0
         AND mr.fk_club_id IS NOT NULL AND mr.fk_club_id > 0`,
      { MemberId: memberId },
    )).map((r) => Number(r.id)),
  );
  const adminDistrictIds = new Set(
    (await conn.query<{ id: number }>(
      `SELECT DISTINCT mr.fk_district_id AS id
       FROM member_roles mr
       JOIN roles r ON r.pk_role_id = mr.fk_role_id
       WHERE mr.fk_member_master_profile_id = @MemberId
         AND r.RoleName = 'Admin'
         AND mr.IsActive = 1 AND mr.isdeleted = 0
         AND mr.fk_district_id IS NOT NULL AND mr.fk_district_id > 0
         AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)`,
      { MemberId: memberId },
    )).map((r) => Number(r.id)),
  );

  const toModule = (r: Row) => MemberMobileModuleDto.create(r);
  const clubGroups: DtoObject[] = [];
  const districtGroups: DtoObject[] = [];

  if (accessibleClubs.size > 0) {
    const rows = await conn.query(
      `SELECT cm.fk_club_id   AS ClubId,
              m.pk_module_id  AS Id,
              m.ModuleName    AS ModuleName,
              m.ModuleKey     AS ModuleKey,
              m.IconClass     AS IconClass,
              m.IconPath      AS IconPath,
              m.Description   AS Description,
              m.RouteUrl      AS RouteUrl,
              m.SortOrder     AS SortOrder,
              m.IsDefaultForMember AS IsDefaultForMember
       FROM club_modules cm
       JOIN module_master m ON m.pk_module_id = cm.fk_module_id
       WHERE cm.fk_club_id IN @ClubIds
         AND cm.IsEnabled = 1
         AND m.IsActive = 1
         AND m.isdeleted = 0
         AND m.ModuleLevel IN ('Club','Both')
       ORDER BY cm.fk_club_id, m.SortOrder, m.ModuleName`,
      { ClubIds: [...accessibleClubs.keys()] },
    );
    for (const club of [...accessibleClubs.values()].sort((a, b) => a.Id - b.Id)) {
      const isAdmin = adminClubIds.has(club.Id);
      const modules = rows.filter((r) => Number(r.ClubId) === club.Id && (isAdmin || isTrue(r.IsDefaultForMember))).map(toModule);
      clubGroups.push(MemberMobileClubGroupDto.create({ ClubId: club.Id, ClubName: club.Name, IsAdmin: isAdmin, Modules: modules }));
    }
  }

  if (accessibleDistricts.size > 0) {
    const rows = await conn.query(
      `SELECT dm.fk_district_id AS DistrictId,
              m.pk_module_id    AS Id,
              m.ModuleName      AS ModuleName,
              m.ModuleKey       AS ModuleKey,
              m.IconClass       AS IconClass,
              m.IconPath        AS IconPath,
              m.Description     AS Description,
              m.RouteUrl        AS RouteUrl,
              m.SortOrder       AS SortOrder,
              m.IsDefaultForMember AS IsDefaultForMember
       FROM district_modules dm
       JOIN module_master m ON m.pk_module_id = dm.fk_module_id
       WHERE dm.fk_district_id IN @DistrictIds
         AND dm.IsEnabled = 1
         AND m.IsActive = 1
         AND m.isdeleted = 0
         AND m.ModuleLevel IN ('District','Both')
       ORDER BY dm.fk_district_id, m.SortOrder, m.ModuleName`,
      { DistrictIds: [...accessibleDistricts.keys()] },
    );
    for (const district of [...accessibleDistricts.values()].sort((a, b) => a.Id - b.Id)) {
      const isAdmin = adminDistrictIds.has(district.Id);
      const modules = rows.filter((r) => Number(r.DistrictId) === district.Id && (isAdmin || isTrue(r.IsDefaultForMember))).map(toModule);
      districtGroups.push(
        MemberMobileDistrictGroupDto.create({ DistrictId: district.Id, DistrictNumber: district.Number, IsAdmin: isAdmin, Modules: modules }),
      );
    }
  }

  // District Admin with all-clubs access: a DA row (role 2, district set, no club) with AllClubsAccess = 1.
  const dcaRows = await conn.query(
    `SELECT mr.fk_district_id AS id, d.DistrictNumber
     FROM member_roles mr
     JOIN district_master d ON d.pk_district_id = mr.fk_district_id AND d.isdeleted = 0
     WHERE mr.fk_member_master_profile_id = @MemberId
       AND mr.fk_role_id = 2 AND mr.fk_district_id > 0
       AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
       AND mr.AllClubsAccess = 1
       AND mr.IsActive = 1 AND mr.isdeleted = 0`,
    { MemberId: memberId },
  );

  return {
    roles: rolesList.map((s) => RoleScopeDto.create(s)),
    zones: [...accessibleZones.values()].sort((a, b) => a.Id - b.Id).map((z) => ZoneScopeDto.create(z)),
    districts: [...accessibleDistricts.values()].sort((a, b) => a.Id - b.Id).map((d) => DistrictScopeDto.create(d)),
    clubs: [...accessibleClubs.values()].sort((a, b) => a.Id - b.Id).map((c) => ClubScopeDto.create(c)),
    districtClubAccess: dcaRows.map((r) => DistrictScopeDto.create({ Id: Number(r.id), Number: r.DistrictNumber ?? "" })),
    memberMobileDashboard: MemberMobileDashboardDto.create({ Clubs: clubGroups, Districts: districtGroups }),
  };
}

function isTrue(v: unknown): boolean {
  return v === true || Number(v) === 1;
}

/**
 * The canonical website URL: ClientDomain (cleaned) -> "{subdomain}.{parent}" -> "".
 * Never null, so mobile callers always receive a string.
 */
export function buildWebsiteUrl(clientDomain: string | null, subdomain: string | null, parentDomain: string): string {
  const cd = cleanClientDomain(clientDomain);
  if (cd) return `https://${cd}`;
  if (!subdomain || !subdomain.trim()) return "";
  // A Subdomain that is already a full host (has a dot) is used verbatim.
  const host = normalizeClientDomain(subdomain);
  if (host && host.trim() && host.includes(".")) return `https://${host}`;
  const sd = normalizeSubdomain(subdomain);
  if (sd && sd.trim()) return `https://${sd}.${parentDomain}`;
  return "";
}

const JUNK = new Set(["null", "n/a", "na", "none", "-", "--"]);

function cleanClientDomain(raw: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  let v = raw.trim();
  v = v.replace(/^https?:\/\//i, "");
  v = v.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!v.trim()) return null;
  if (JUNK.has(v.toLowerCase())) return null;
  if (!v.includes(".")) return null; // a host without a dot is not a public domain
  return v;
}
