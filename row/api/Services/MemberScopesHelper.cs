using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// Shared scope builder used by BOTH web (AuthService.LoginAsync) and mobile
// (MobileAuthService.VerifyOtpAsync / GetMyContextAsync).
//
// Returns the same shape mobile already returns:
//   - Roles[]:            one RoleScopeDto per (role × scoping unit) row in member_roles,
//                         plus implicit "Member" rows for every active club membership.
//   - AccessibleZones[]:  every distinct zone the user touches via any role/membership.
//   - AccessibleDistricts[]: every distinct district + (TotalClubs/TotalMembers counts).
//   - AccessibleClubs[]:  every distinct club + (TotalMembers, WebsiteUrl) populated.
//
// SuperAdmin filter:
//   - Mobile callers pass excludeSuperAdmin=true (mobile session strips SA).
//   - Web callers pass excludeSuperAdmin=false (SA is the headline web role).
//
// Expansion rules (kept identical to the original mobile implementation):
//   - ZonalCoordinator: all districts in their zone become accessible
//     (auto-club expansion intentionally NOT done — clubs need explicit Club Admin).
//   - District Admin: NO implicit club access — must have explicit Club Admin row.
public static class MemberScopesHelper
{
    public class MemberScopesResult
    {
        public List<RoleScopeDto> Roles { get; set; } = new();
        public List<ZoneScopeDto> Zones { get; set; } = new();
        public List<DistrictScopeDto> Districts { get; set; } = new();
        public List<ClubScopeDto> Clubs { get; set; } = new();
        // Districts where this member is a District Admin WITH all-clubs access
        // (member_roles.AllClubsAccess=1). Drives the district-admin club switcher +
        // lets the client allow the club-admin dashboard for any club in these districts.
        public List<DistrictScopeDto> DistrictClubAccess { get; set; } = new();
        // Per-scope module groups for the mobile dashboard. Each accessible
        // club / district produces one group; the module list inside is
        // already role-filtered (admin sees everything, plain member sees
        // only IsDefaultForMember=1).
        public MemberMobileDashboardDto MemberMobileDashboard { get; set; } = new();
    }

    public static async Task<MemberScopesResult> BuildScopesAsync(
        MySqlConnection conn,
        int memberId,
        bool excludeSuperAdmin = false)
    {
        var rolesList = new List<RoleScopeDto>();
        var accessibleZones = new Dictionary<int, ZoneScopeDto>();
        var accessibleDistricts = new Dictionary<int, DistrictScopeDto>();
        var accessibleClubs = new Dictionary<int, ClubScopeDto>();

        // (1) Elevated roles from member_roles
        //     One row per (role × scoping unit). The COALESCE on zoneId derives zone from
        //     mr → district → club (whichever is present) so RoleScopeDto.ZoneId is always
        //     populated when the assignment is district/club scoped.
        var elevatedSql = @"
            SELECT r.RoleName AS roleName,
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
              AND mr.IsActive = 1 AND mr.isdeleted = 0"
            + (excludeSuperAdmin ? " AND r.RoleName <> 'SuperAdmin'" : "");

        var elevated = await conn.QueryAsync<dynamic>(elevatedSql, new { MemberId = memberId });

        foreach (var row in elevated)
        {
            var roleName = (string)row.roleName ?? "";
            var scope = new RoleScopeDto { RoleName = roleName, Scope = "global" };

            // CRITICAL: treat fk_*_id = 0 the same as NULL (sentinel for "no scope").
            // The legacy DB uses 0 in unused FK columns rather than NULL on many rows
            // (e.g. a DA row may have fk_club_id=0). Without the > 0 check, scope
            // would incorrectly resolve to the last non-null bucket (club), which
            // makes a DA assignment look club-scoped to downstream consumers and
            // disagrees with the resolver SQL that uses `OR fk_*_id = 0`.
            int? zoneIdVal = row.zoneId == null ? null : (int?)row.zoneId;
            int? districtIdVal = row.districtId == null ? null : (int?)row.districtId;
            int? clubIdVal = row.clubId == null ? null : (int?)row.clubId;

            if (zoneIdVal is int zid && zid > 0)
            {
                scope.Scope = "zone";
                scope.ZoneId = zid;
                scope.ZoneName = (string?)row.zoneName;
                if (!accessibleZones.ContainsKey(zid))
                    accessibleZones[zid] = new ZoneScopeDto { Id = zid, Name = scope.ZoneName ?? "" };
            }
            if (districtIdVal is int did && did > 0)
            {
                scope.Scope = "district";
                scope.DistrictId = did;
                scope.DistrictNumber = (string?)row.districtNumber;
                if (!accessibleDistricts.ContainsKey(did))
                    accessibleDistricts[did] = new DistrictScopeDto { Id = did, Number = scope.DistrictNumber ?? "", ZoneId = scope.ZoneId };
            }
            if (clubIdVal is int cid && cid > 0)
            {
                scope.Scope = "club";
                scope.ClubId = cid;
                scope.ClubName = (string?)row.clubName;
                scope.DistrictId = row.clubDistrictId == null ? null : (int?)row.clubDistrictId;
                scope.DistrictNumber = (string?)row.clubDistrictNumber;
                if (!accessibleClubs.ContainsKey(cid))
                    accessibleClubs[cid] = new ClubScopeDto { Id = cid, Name = scope.ClubName ?? "", DistrictId = scope.DistrictId };
                if (scope.DistrictId.HasValue && scope.DistrictId.Value > 0 && !accessibleDistricts.ContainsKey(scope.DistrictId.Value))
                    accessibleDistricts[scope.DistrictId.Value] = new DistrictScopeDto { Id = scope.DistrictId.Value, Number = scope.DistrictNumber ?? "", ZoneId = scope.ZoneId };
            }

            rolesList.Add(scope);
        }

        // (2) Implicit "Member" role for every active club membership
        var clubMemberships = await conn.QueryAsync<dynamic>(@"
            SELECT c.pk_club_id AS clubId, c.ClubName, c.fk_district_id AS districtId,
                   d.DistrictNumber, d.fk_zone_id AS zoneId, z.ZoneName AS zoneName
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE cm.fk_member_master_profile_id = @MemberId
              AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND c.isdeleted = 0",
            new { MemberId = memberId });

        foreach (var row in clubMemberships)
        {
            int clubId = (int)row.clubId;
            int? distId = row.districtId == null ? null : (int?)row.districtId;
            int? zId = row.zoneId == null ? null : (int?)row.zoneId;

            rolesList.Add(new RoleScopeDto
            {
                RoleName = "Member",
                Scope = "club",
                ClubId = clubId,
                ClubName = (string?)row.ClubName,
                DistrictId = distId,
                DistrictNumber = (string?)row.DistrictNumber,
                ZoneId = zId,
                ZoneName = (string?)row.zoneName
            });

            if (zId.HasValue && !accessibleZones.ContainsKey(zId.Value))
                accessibleZones[zId.Value] = new ZoneScopeDto { Id = zId.Value, Name = (string?)row.zoneName ?? "" };

            if (!accessibleClubs.ContainsKey(clubId))
                accessibleClubs[clubId] = new ClubScopeDto { Id = clubId, Name = (string?)row.ClubName ?? "", DistrictId = distId };

            if (distId.HasValue && !accessibleDistricts.ContainsKey(distId.Value))
                accessibleDistricts[distId.Value] = new DistrictScopeDto { Id = distId.Value, Number = (string?)row.DistrictNumber ?? "", ZoneId = zId };
        }

        // (3) Expansion for ZonalCoordinator — ZC sees all districts in their zone (no auto-clubs).
        foreach (var role in rolesList.ToList())
        {
            if (role.RoleName == "ZonalCoordinator" && role.ZoneId.HasValue)
            {
                var zoneDistricts = await conn.QueryAsync<dynamic>(@"
                    SELECT pk_district_id AS id, DistrictNumber FROM district_master
                    WHERE fk_zone_id = @Z AND isdeleted = 0", new { Z = role.ZoneId.Value });
                foreach (var d in zoneDistricts)
                {
                    int dId = (int)d.id;
                    if (!accessibleDistricts.ContainsKey(dId))
                        accessibleDistricts[dId] = new DistrictScopeDto { Id = dId, Number = (string?)d.DistrictNumber ?? "", ZoneId = role.ZoneId };
                }
            }
        }

        // Counts: districts
        if (accessibleDistricts.Count > 0)
        {
            var districtIds = accessibleDistricts.Keys.ToList();
            var districtCounts = await conn.QueryAsync<dynamic>(@"
                SELECT fk_district_id AS districtId,
                       COUNT(*) AS totalClubs,
                       SUM(CASE WHEN IsSyncedFromRotaryOrg = 1 THEN 1 ELSE 0 END) AS syncedClubs
                FROM club_master WHERE fk_district_id IN @Ids AND isdeleted = 0
                GROUP BY fk_district_id", new { Ids = districtIds });
            foreach (var dc in districtCounts)
            {
                int dId = (int)dc.districtId;
                if (accessibleDistricts.ContainsKey(dId))
                {
                    accessibleDistricts[dId].TotalClubs = (int)(long)dc.totalClubs;
                    accessibleDistricts[dId].IsSynced = Convert.ToInt64(dc.syncedClubs ?? 0L) > 0;
                }
            }
            var districtMemberCounts = await conn.QueryAsync<dynamic>(@"
                SELECT c.fk_district_id AS districtId,
                       COUNT(DISTINCT cm.fk_member_master_profile_id) AS totalMembers
                FROM club_members cm
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                WHERE c.fk_district_id IN @Ids AND cm.IsActive = 1 AND cm.isdeleted = 0 AND c.isdeleted = 0 AND m.isdeleted = 0
                GROUP BY c.fk_district_id", new { Ids = districtIds });
            foreach (var dm in districtMemberCounts)
            {
                int dId = (int)dm.districtId;
                if (accessibleDistricts.ContainsKey(dId))
                    accessibleDistricts[dId].TotalMembers = (int)(long)dm.totalMembers;
            }
        }

        // Counts + website URLs: clubs
        if (accessibleClubs.Count > 0)
        {
            var clubIds = accessibleClubs.Keys.ToList();
            var clubMemberCounts = await conn.QueryAsync<dynamic>(@"
                SELECT fk_club_id AS clubId,
                       COUNT(*) AS totalMembers
                FROM club_members WHERE fk_club_id IN @Ids AND IsActive = 1 AND isdeleted = 0
                GROUP BY fk_club_id", new { Ids = clubIds });
            foreach (var cm in clubMemberCounts)
            {
                int cId = (int)cm.clubId;
                if (accessibleClubs.ContainsKey(cId))
                    accessibleClubs[cId].TotalMembers = (int)(long)cm.totalMembers;
            }

            // IsSynced (Rotary.org) per club — gates Goal Setting in the sidebar.
            var clubSync = await conn.QueryAsync<dynamic>(@"
                SELECT pk_club_id AS clubId, IsSyncedFromRotaryOrg AS isSynced
                FROM club_master WHERE pk_club_id IN @Ids AND isdeleted = 0", new { Ids = clubIds });
            foreach (var cs in clubSync)
            {
                int cId = (int)cs.clubId;
                if (accessibleClubs.ContainsKey(cId))
                    accessibleClubs[cId].IsSynced = Convert.ToInt32(cs.isSynced ?? 0) == 1;
            }

            // WebsiteUrl: prefer ClientDomain, fallback to Subdomain.{parentDomain}.
            // Club + District website parent is example.org (NOT the main
            // portal portal.example.org). The system_settings row should hold the
            // correct value; the hard fallback below is the user-confirmed
            // canonical parent domain for all club/district websites.
            var parentDomain = await conn.ExecuteScalarAsync<string?>(
                "SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteParentDomain'");
            if (string.IsNullOrWhiteSpace(parentDomain)) parentDomain = RotaryApi.Services.Brand.ClubSiteParentDomain;

            var siteRows = await conn.QueryAsync<dynamic>(@"
                SELECT fk_club_id AS clubId, Subdomain, ClientDomain
                FROM club_websites
                WHERE fk_club_id IN @Ids
                  AND COALESCE(isdeleted, 0) = 0
                  AND Status = 'Active'
                  AND CURDATE() BETWEEN StartDate AND EndDate
                ORDER BY pk_id DESC",
                new { Ids = clubIds });
            // Default WebsiteUrl to empty string for every accessible club —
            // ensures the field is always present in the mobile payload even
            // when the club has no website row, no purchase, or its purchase
            // has expired (SQL above filters CURDATE() BETWEEN StartDate AND EndDate).
            foreach (var entry in accessibleClubs.Values)
                if (entry.WebsiteUrl == null) entry.WebsiteUrl = "";

            foreach (var row in siteRows)
            {
                int cId = (int)row.clubId;
                if (!accessibleClubs.ContainsKey(cId)) continue;
                if (!string.IsNullOrEmpty(accessibleClubs[cId].WebsiteUrl)) continue;
                var clientDomain = ((string?)row.ClientDomain)?.Trim();
                var subdomain = ((string?)row.Subdomain)?.Trim();
                accessibleClubs[cId].WebsiteUrl = BuildWebsiteUrl(clientDomain, subdomain, parentDomain);
            }
        }

        // (4) Mobile dashboard — one group per accessible club/district.
        //     Per-scope rule:
        //       • Admin for THIS club/district  → all enabled modules
        //       • Pure member for THIS scope    → only IsDefaultForMember=1
        //     "Admin" = a member_roles row with RoleName='Admin' AND the FK to
        //     this specific club/district set (> 0). District scope honours
        //     ModuleLevel IN ('District','Both'); club scope honours
        //     ('Club','Both'). isdeleted=0 throughout.
        var dashboard = new MemberMobileDashboardDto();

        // Which clubs / districts is THIS member an Admin for? (drives the
        // per-scope "show everything vs filter" decision below.)
        var adminClubIds = (await conn.QueryAsync<int>(@"
            SELECT DISTINCT mr.fk_club_id
            FROM member_roles mr
            JOIN roles r ON r.pk_role_id = mr.fk_role_id
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND r.RoleName = 'Admin'
              AND mr.IsActive = 1 AND mr.isdeleted = 0
              AND mr.fk_club_id IS NOT NULL AND mr.fk_club_id > 0",
            new { MemberId = memberId })).ToHashSet();

        var adminDistrictIds = (await conn.QueryAsync<int>(@"
            SELECT DISTINCT mr.fk_district_id
            FROM member_roles mr
            JOIN roles r ON r.pk_role_id = mr.fk_role_id
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND r.RoleName = 'Admin'
              AND mr.IsActive = 1 AND mr.isdeleted = 0
              AND mr.fk_district_id IS NOT NULL AND mr.fk_district_id > 0
              AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)",
            new { MemberId = memberId })).ToHashSet();

        // Per-club groups — batched.
        // The old code ran one SELECT per accessible club, which for privileged
        // accounts (SuperAdmin / RID / ZC across multiple zones) meant 100+ DB
        // round-trips inside verify-otp → 30s timeout on mobile. Now we fetch
        // every (clubId, moduleRow) pair in ONE query and group in memory; the
        // admin/member filter is applied in C# using adminClubIds.
        if (accessibleClubs.Count > 0)
        {
            var clubIds = accessibleClubs.Keys.ToList();
            var clubModuleRows = (await conn.QueryAsync<ClubModuleRow>(@"
                SELECT cm.fk_club_id   AS ClubId,
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
                ORDER BY cm.fk_club_id, m.SortOrder, m.ModuleName",
                new { ClubIds = clubIds })).ToList();

            var clubRowsByClub = clubModuleRows.GroupBy(r => r.ClubId).ToDictionary(g => g.Key, g => g.ToList());

            foreach (var club in accessibleClubs.Values.OrderBy(c => c.Id))
            {
                bool isAdmin = adminClubIds.Contains(club.Id);
                var rows = clubRowsByClub.GetValueOrDefault(club.Id, new List<ClubModuleRow>());
                var modules = rows
                    .Where(r => isAdmin || r.IsDefaultForMember)
                    .Select(r => new MemberMobileModuleDto
                    {
                        Id = r.Id, ModuleName = r.ModuleName, ModuleKey = r.ModuleKey,
                        IconClass = r.IconClass, IconPath = r.IconPath,
                        Description = r.Description, RouteUrl = r.RouteUrl, SortOrder = r.SortOrder
                    }).ToList();

                dashboard.Clubs.Add(new MemberMobileClubGroupDto
                {
                    ClubId = club.Id,
                    ClubName = club.Name,
                    IsAdmin = isAdmin,
                    Modules = modules
                });
            }
        }

        // Per-district groups — same batched shape, sourced from district_modules.
        if (accessibleDistricts.Count > 0)
        {
            var districtIds = accessibleDistricts.Keys.ToList();
            var distModuleRows = (await conn.QueryAsync<DistrictModuleRow>(@"
                SELECT dm.fk_district_id AS DistrictId,
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
                ORDER BY dm.fk_district_id, m.SortOrder, m.ModuleName",
                new { DistrictIds = districtIds })).ToList();

            var distRowsByDist = distModuleRows.GroupBy(r => r.DistrictId).ToDictionary(g => g.Key, g => g.ToList());

            foreach (var district in accessibleDistricts.Values.OrderBy(d => d.Id))
            {
                bool isAdmin = adminDistrictIds.Contains(district.Id);
                var rows = distRowsByDist.GetValueOrDefault(district.Id, new List<DistrictModuleRow>());
                var modules = rows
                    .Where(r => isAdmin || r.IsDefaultForMember)
                    .Select(r => new MemberMobileModuleDto
                    {
                        Id = r.Id, ModuleName = r.ModuleName, ModuleKey = r.ModuleKey,
                        IconClass = r.IconClass, IconPath = r.IconPath,
                        Description = r.Description, RouteUrl = r.RouteUrl, SortOrder = r.SortOrder
                    }).ToList();

                dashboard.Districts.Add(new MemberMobileDistrictGroupDto
                {
                    DistrictId = district.Id,
                    DistrictNumber = district.Number,
                    IsAdmin = isAdmin,
                    Modules = modules
                });
            }
        }

        // District-Admin all-clubs access: districts where this member holds a DA row
        // (fk_role_id=2, fk_district_id>0, fk_club_id NULL/0) with AllClubsAccess=1.
        var dcaRows = await conn.QueryAsync<dynamic>(@"
            SELECT mr.fk_district_id AS id, d.DistrictNumber
            FROM member_roles mr
            JOIN district_master d ON d.pk_district_id = mr.fk_district_id AND d.isdeleted = 0
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND mr.fk_role_id = 2 AND mr.fk_district_id > 0
              AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
              AND mr.AllClubsAccess = 1
              AND mr.IsActive = 1 AND mr.isdeleted = 0",
            new { MemberId = memberId });
        var districtClubAccess = dcaRows
            .Select(r => new DistrictScopeDto { Id = (int)r.id, Number = (string?)r.DistrictNumber ?? "" })
            .ToList();

        return new MemberScopesResult
        {
            Roles = rolesList,
            Zones = accessibleZones.Values.OrderBy(z => z.Id).ToList(),
            Districts = accessibleDistricts.Values.OrderBy(d => d.Id).ToList(),
            Clubs = accessibleClubs.Values.OrderBy(c => c.Id).ToList(),
            DistrictClubAccess = districtClubAccess,
            MemberMobileDashboard = dashboard
        };
    }

    // Internal row types backing the batched club/district module queries.
    // Materialised intermediate so we can group + filter (admin vs member)
    // in-memory without re-running the SQL per scope.
    private sealed class ClubModuleRow
    {
        public int ClubId { get; set; }
        public int Id { get; set; }
        public string ModuleName { get; set; } = "";
        public string ModuleKey { get; set; } = "";
        public string? IconClass { get; set; }
        public string? IconPath { get; set; }
        public string? Description { get; set; }
        public string? RouteUrl { get; set; }
        public int SortOrder { get; set; }
        public bool IsDefaultForMember { get; set; }
    }

    private sealed class DistrictModuleRow
    {
        public int DistrictId { get; set; }
        public int Id { get; set; }
        public string ModuleName { get; set; } = "";
        public string ModuleKey { get; set; } = "";
        public string? IconClass { get; set; }
        public string? IconPath { get; set; }
        public string? Description { get; set; }
        public string? RouteUrl { get; set; }
        public int SortOrder { get; set; }
        public bool IsDefaultForMember { get; set; }
    }

    // Build the canonical website URL for a club/district record.
    //
    // Precedence: ClientDomain (cleaned) → "{subdomain}.{parentDomain}" → "".
    //
    // Returns "" (NEVER null) when no real URL can be built, so mobile callers
    // always receive a string field — empty when:
    //   • the website row doesn't exist (no purchase)
    //   • the row exists but is expired (caller filters CURDATE() BETWEEN dates)
    //   • clientDomain AND subdomain are both nothing / junk values
    //
    // ClientDomain values rejected as "no real domain set" — every match below
    // falls through to the subdomain fallback:
    //   • null / empty / whitespace
    //   • literal "null", "n/a", "na", "none", "-", "--"
    //   • bare scheme only ("https://", "http://")
    //   • host without a dot (e.g. "localhost", "asdf")
    // Otherwise ClientDomain is normalised: strip http(s):// prefix, strip leading
    // and trailing slashes, prepend https://.
    public static string BuildWebsiteUrl(string? clientDomain, string? subdomain, string parentDomain)
    {
        var cd = CleanClientDomain(clientDomain);
        if (!string.IsNullOrEmpty(cd)) return $"https://{cd}";

        if (string.IsNullOrWhiteSpace(subdomain)) return "";

        // If Subdomain is already a full host (contains a dot), use it verbatim. Some clubs'
        // Subdomain holds an explicit FQDN under a domain other than the CURRENT
        // system_settings.ClubWebsiteParentDomain (e.g. set up back when the platform's
        // default parent domain was different) — reducing that to a bare label and
        // re-appending today's parentDomain silently swaps in the wrong domain.
        var host = WebsiteDomainHelper.NormalizeClientDomain(subdomain);
        if (!string.IsNullOrWhiteSpace(host) && host.Contains('.'))
            return $"https://{host}";

        var sd = WebsiteDomainHelper.NormalizeSubdomain(subdomain);
        if (!string.IsNullOrWhiteSpace(sd))
            return $"https://{sd}.{parentDomain}";
        return "";
    }

    private static string? CleanClientDomain(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var v = raw.Trim();

        // Strip leading scheme + leading/trailing slashes — leaves "host[/path]"
        v = System.Text.RegularExpressions.Regex.Replace(v, "^https?://", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        v = v.Trim().TrimStart('/').TrimEnd('/');
        if (string.IsNullOrWhiteSpace(v)) return null;

        // Reject sentinels / junk values commonly used to "blank" the field.
        var junk = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "null", "n/a", "na", "none", "-", "--" };
        if (junk.Contains(v)) return null;

        // Must contain a "." (domain must have at least one dot — host alone
        // like "localhost" or accidental "asdf" is not a valid public domain).
        if (!v.Contains('.')) return null;

        return v;
    }
}
