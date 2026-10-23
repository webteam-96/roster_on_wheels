using System.Text.Json;
using System.Text.Json.Serialization;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Login-announcement audience.
//   • target_roles  — comma list of the role keys below; NULL = ALL (every logged-in user except Family Login).
//   • target_filters — JSON {filterKey: value} of purchase filters; NULL = no filter.
// A user sees an active, un-acknowledged announcement when they hold ANY targeted role AND match EVERY
// filter. All matching announcements show together in one popup with ◀ ▶ arrows (web + mobile).
// Year targeting is intentionally NOT implemented yet (roles aren't year-wise).
public static class LoginAnnouncementAudience
{
    public const string All = "ALL";

    // Canonical keys + order (must match rotary-frontend/src/utils/loginAnnouncementRoles.ts).
    public static readonly string[] RoleKeys =
    {
        "SuperAdmin", "ClubAdmin", "DistrictAdmin", "AG",
        "Member", "ClubPresident", "ClubSecretary",
    };

    // Purchase filters + allowed values (must match the frontend LOGIN_ANNOUNCEMENT_FILTERS). "any" = not set.
    //   clubWebsite      — the member's club(s): live website (Active, today within Start/End). expired = bought before, not live now.
    //   clubDues         — club collects dues from members (membership_dues), CURRENT Rotary year, active.
    //   districtDues     — district collects dues from clubs (club_dues), CURRENT Rotary year, active.
    //   districtWebsite  — district_websites Status = Active.
    //   emailCredits — unexpired credits left, on the member's clubs or districts they administer.
    public static readonly (string Key, string[] Values)[] FilterDefs =
    {
        ("clubWebsite", new[] { "purchased", "not_purchased", "expired" }),
        ("clubDues", new[] { "purchased", "not_purchased" }),
        ("districtDues", new[] { "purchased", "not_purchased" }),
        ("districtWebsite", new[] { "purchased", "not_purchased" }),
        ("emailCredits", new[] { "purchased", "not_purchased" }),
    };

    // Validates the submitted role selection. Returns (storedValue, error): storedValue NULL means ALL.
    public static (string? Stored, string? Error) Normalize(IEnumerable<string>? input)
    {
        var list = (input ?? Enumerable.Empty<string>())
            .Select(s => (s ?? "").Trim())
            .Where(s => s.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (list.Count == 0) return (null, "Select at least one role (or ALL).");
        if (list.Any(s => s.Equals(All, StringComparison.OrdinalIgnoreCase))) return (null, null);

        var unknown = list.Where(s => !RoleKeys.Contains(s, StringComparer.OrdinalIgnoreCase)).ToList();
        if (unknown.Count > 0) return (null, $"Unknown role(s): {string.Join(", ", unknown)}.");

        var canonical = RoleKeys.Where(k => list.Contains(k, StringComparer.OrdinalIgnoreCase));
        return (string.Join(",", canonical), null);
    }

    public static List<string> Parse(string? stored) =>
        string.IsNullOrWhiteSpace(stored)
            ? new List<string> { All }
            : stored.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

    // Validates the submitted filters. "any"/blank entries are dropped. Returns (storedJson, error); NULL = no filter.
    public static (string? Stored, string? Error) NormalizeFilters(Dictionary<string, string>? input)
    {
        if (input == null) return (null, null);
        var chosen = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (key, raw) in input)
        {
            var value = (raw ?? "").Trim().ToLowerInvariant();
            if (value.Length == 0 || value == "any") continue;
            var def = FilterDefs.FirstOrDefault(d => d.Key.Equals(key, StringComparison.OrdinalIgnoreCase));
            if (def.Key == null) return (null, $"Unknown filter: {key}.");
            if (!def.Values.Contains(value)) return (null, $"Invalid value '{raw}' for filter {def.Key}.");
            chosen[def.Key] = value;
        }
        if (chosen.Count == 0) return (null, null);
        var ordered = FilterDefs.Where(d => chosen.ContainsKey(d.Key)).ToDictionary(d => d.Key, d => chosen[d.Key]);
        return (JsonSerializer.Serialize(ordered), null);
    }

    public static Dictionary<string, string> ParseFilters(string? stored)
    {
        if (string.IsNullOrWhiteSpace(stored)) return new Dictionary<string, string>();
        try { return JsonSerializer.Deserialize<Dictionary<string, string>>(stored) ?? new Dictionary<string, string>(); }
        catch (JsonException) { return new Dictionary<string, string>(); }
    }

    // ── Location filter (target_locations) ──────────────────────────────────────
    // Zones / districts / clubs picked with multi-select checkboxes. The most specific level that has a
    // selection applies: clubs, else districts, else zones. Empty = no location filter.
    public class TargetLocations
    {
        public List<int> ZoneIds { get; set; } = new();
        public List<int> DistrictIds { get; set; } = new();
        public List<int> ClubIds { get; set; } = new();

        [JsonIgnore]
        public bool IsEmpty => ZoneIds.Count == 0 && DistrictIds.Count == 0 && ClubIds.Count == 0;
    }

    // Validates the submitted location selection (ids must exist). Returns (storedJson, error); NULL = none.
    public static async Task<(string? Stored, string? Error)> NormalizeLocationsAsync(MySqlConnection conn, TargetLocations? input)
    {
        if (input == null) return (null, null);
        static List<int> Clean(List<int>? ids) => (ids ?? new List<int>()).Where(i => i > 0).Distinct().ToList();
        var clean = new TargetLocations
        {
            ZoneIds = Clean(input.ZoneIds),
            DistrictIds = Clean(input.DistrictIds),
            ClubIds = Clean(input.ClubIds),
        };
        if (clean.IsEmpty) return (null, null);
        if (clean.ClubIds.Count > 3000) return (null, "Select at most 3000 clubs.");

        async Task<bool> AllExist(string table, string pk, List<int> ids) =>
            ids.Count == 0 || await conn.ExecuteScalarAsync<int>(
                $"SELECT COUNT(*) FROM {table} WHERE {pk} IN @Ids AND isdeleted = 0", new { Ids = ids }) == ids.Count;

        if (!await AllExist("zone_master", "pk_zone_id", clean.ZoneIds)) return (null, "One or more selected zones no longer exist.");
        if (!await AllExist("district_master", "pk_district_id", clean.DistrictIds)) return (null, "One or more selected districts no longer exist.");
        if (!await AllExist("club_master", "pk_club_id", clean.ClubIds)) return (null, "One or more selected clubs no longer exist.");
        return (JsonSerializer.Serialize(clean), null);
    }

    public static TargetLocations ParseLocations(string? stored)
    {
        if (string.IsNullOrWhiteSpace(stored)) return new TargetLocations();
        try { return JsonSerializer.Deserialize<TargetLocations>(stored) ?? new TargetLocations(); }
        catch (JsonException) { return new TargetLocations(); }
    }

    // Admin list/edit payload: ids plus display names so cards and the edit dialog can show them.
    public static async Task<object> DescribeLocationsAsync(MySqlConnection conn, TargetLocations loc)
    {
        var zones = loc.ZoneIds.Count == 0 ? Enumerable.Empty<dynamic>() : await conn.QueryAsync<dynamic>(
            "SELECT pk_zone_id AS id, ZoneName AS name FROM zone_master WHERE pk_zone_id IN @Ids ORDER BY ZoneName",
            new { Ids = loc.ZoneIds });
        var districts = loc.DistrictIds.Count == 0 ? Enumerable.Empty<dynamic>() : await conn.QueryAsync<dynamic>(
            "SELECT pk_district_id AS id, DistrictNumber AS name, fk_zone_id AS zoneId FROM district_master WHERE pk_district_id IN @Ids ORDER BY DistrictNumber",
            new { Ids = loc.DistrictIds });
        var clubs = loc.ClubIds.Count == 0 ? Enumerable.Empty<dynamic>() : await conn.QueryAsync<dynamic>(@"
            SELECT c.pk_club_id AS id, c.ClubName AS name, c.fk_district_id AS districtId, d.DistrictNumber AS districtNumber
            FROM club_master c LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE c.pk_club_id IN @Ids ORDER BY c.ClubName",
            new { Ids = loc.ClubIds });
        return new { zoneIds = loc.ZoneIds, districtIds = loc.DistrictIds, clubIds = loc.ClubIds, zones, districts, clubs };
    }

    // Every role key the member currently holds. Mobile passes includeSuperAdmin=false (SA is web-only
    // and stripped from the mobile session).
    public static async Task<HashSet<string>> ResolveMemberRoleKeysAsync(MySqlConnection conn, int memberId, bool includeSuperAdmin)
    {
        var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (memberId <= 0) return keys;

        // member_roles — Admin splits into Club Admin (club-scoped) / District Admin (district-scoped).
        var roleRows = await conn.QueryAsync<dynamic>(@"
            SELECT r.RoleName AS roleName, mr.fk_club_id AS clubId, mr.fk_district_id AS districtId
            FROM member_roles mr
            JOIN roles r ON r.pk_role_id = mr.fk_role_id
            WHERE mr.fk_member_master_profile_id = @Id AND mr.IsActive = 1 AND mr.isdeleted = 0",
            new { Id = memberId });
        foreach (var row in roleRows)
        {
            var name = (string?)row.roleName ?? "";
            int clubId = row.clubId == null ? 0 : Convert.ToInt32(row.clubId);
            int districtId = row.districtId == null ? 0 : Convert.ToInt32(row.districtId);
            switch (name)
            {
                case "Admin":
                    if (clubId > 0) keys.Add("ClubAdmin");
                    else if (districtId > 0) keys.Add("DistrictAdmin");
                    break;
                case "SuperAdmin":
                    if (includeSuperAdmin) keys.Add("SuperAdmin");
                    break;
                case "AG":
                case "Member":
                    keys.Add(name);
                    break;
            }
        }

        // Member — any active club membership.
        var memberships = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            WHERE cm.fk_member_master_profile_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0",
            new { Id = memberId });
        if (memberships > 0) keys.Add("Member");

        // Club President / Club Secretary — current Rotary year Board of Directors.
        var bod = await conn.QueryAsync<string>(@"
            SELECT DISTINCT dm.designation_name
            FROM board_of_directors b
            JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
            JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id AND y.IsCurrent = 1
            WHERE b.fk_member_master_profile_id = @Id AND b.isdeleted = 0
              AND dm.designation_name IN ('Club President', 'Club Secretary')",
            new { Id = memberId });
        foreach (var d in bod)
        {
            if (d == "Club President") keys.Add("ClubPresident");
            else if (d == "Club Secretary") keys.Add("ClubSecretary");
        }

        return keys;
    }

    // Evaluates purchase filters for ONE member. Linked units and each filter's lookup are loaded lazily and
    // cached, so a popup with several filtered announcements costs each query at most once.
    //   Clubs          = active club memberships ∪ Club Admin clubs ∪ current-year President/Secretary clubs.
    //   Admin districts = District Admin / AG districts.  All districts = admin districts ∪ the clubs' districts.
    // "purchased" = at least one linked unit has it; "not_purchased" = at least one lacks it;
    // "expired" (club website) = at least one club bought before but isn't live now. No linked unit → no match.
    private sealed class PurchaseFilterContext
    {
        private readonly MySqlConnection _conn;
        private readonly int _memberId;
        private List<int>? _clubs;
        private List<int> _adminDistricts = new();
        private List<int> _allDistricts = new();
        private string? _yearLabel;
        private readonly Dictionary<string, (List<string> Units, HashSet<string> Has, HashSet<string> Ever)> _cache = new();

        public PurchaseFilterContext(MySqlConnection conn, int memberId)
        {
            _conn = conn;
            _memberId = memberId;
        }

        public async Task<bool> MatchesAllAsync(Dictionary<string, string> filters)
        {
            foreach (var (key, value) in filters)
                if (!await MatchesAsync(key, value)) return false;
            return true;
        }

        private List<int>? _locDistricts;
        private List<int> _locZones = new();

        // Location filter — the most specific selected level applies: clubs, else districts, else zones.
        public async Task<bool> MatchesLocationsAsync(TargetLocations loc)
        {
            if (loc.IsEmpty) return true;
            await LoadUnitsAsync();
            if (loc.ClubIds.Count > 0) return _clubs!.Any(loc.ClubIds.Contains);
            await LoadLocationUnitsAsync();
            if (loc.DistrictIds.Count > 0) return _locDistricts!.Any(loc.DistrictIds.Contains);
            return _locZones.Any(loc.ZoneIds.Contains);
        }

        // Location-only units: the purchase-filter districts; zones = those districts' zones.
        private async Task LoadLocationUnitsAsync()
        {
            if (_locDistricts != null) return;
            _locDistricts = _allDistricts.ToList();

            var zones = new HashSet<int>();
            if (_locDistricts.Count > 0)
            {
                foreach (var z in await _conn.QueryAsync<int?>(
                    "SELECT DISTINCT fk_zone_id FROM district_master WHERE pk_district_id IN @Ids AND fk_zone_id > 0",
                    new { Ids = _locDistricts }))
                    if (z is > 0) zones.Add(z.Value);
            }
            _locZones = zones.ToList();
        }

        private async Task<bool> MatchesAsync(string key, string value)
        {
            var (units, has, ever) = await GetStatusAsync(key);
            if (units.Count == 0) return false;
            return value switch
            {
                "purchased" => units.Any(has.Contains),
                "not_purchased" => units.Any(u => !has.Contains(u)),
                "expired" => units.Any(u => ever.Contains(u) && !has.Contains(u)),
                _ => true,   // unknown values were rejected on save; ignore defensively
            };
        }

        private async Task LoadUnitsAsync()
        {
            if (_clubs != null) return;
            _clubs = (await _conn.QueryAsync<int?>(@"
                SELECT cm.fk_club_id FROM club_members cm
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
                WHERE cm.fk_member_master_profile_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0
                UNION
                SELECT mr.fk_club_id FROM member_roles mr
                WHERE mr.fk_member_master_profile_id = @Id AND mr.IsActive = 1 AND mr.isdeleted = 0 AND mr.fk_club_id > 0
                UNION
                SELECT b.fk_club_id FROM board_of_directors b
                JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
                JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id AND y.IsCurrent = 1
                WHERE b.fk_member_master_profile_id = @Id AND b.isdeleted = 0
                  AND dm.designation_name IN ('Club President', 'Club Secretary')",
                new { Id = _memberId })).Where(x => x is > 0).Select(x => x!.Value).Distinct().ToList();

            _adminDistricts = (await _conn.QueryAsync<int?>(@"
                SELECT DISTINCT mr.fk_district_id FROM member_roles mr
                JOIN roles r ON r.pk_role_id = mr.fk_role_id
                WHERE mr.fk_member_master_profile_id = @Id AND mr.IsActive = 1 AND mr.isdeleted = 0
                  AND r.RoleName IN ('Admin', 'AG')
                  AND mr.fk_district_id > 0 AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)",
                new { Id = _memberId })).Where(x => x is > 0).Select(x => x!.Value).ToList();

            var clubDistricts = _clubs.Count == 0
                ? new List<int>()
                : (await _conn.QueryAsync<int?>(
                    "SELECT DISTINCT fk_district_id FROM club_master WHERE pk_club_id IN @Ids AND fk_district_id > 0",
                    new { Ids = _clubs })).Where(x => x is > 0).Select(x => x!.Value).ToList();
            _allDistricts = _adminDistricts.Union(clubDistricts).ToList();

            _yearLabel = await _conn.ExecuteScalarAsync<string?>(
                "SELECT YearLabel FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
        }

        private async Task<(List<string> Units, HashSet<string> Has, HashSet<string> Ever)> GetStatusAsync(string key)
        {
            if (_cache.TryGetValue(key, out var cached)) return cached;
            await LoadUnitsAsync();
            var clubs = _clubs!;
            var clubUnits = clubs.Select(c => $"c{c}").ToList();
            var districtUnits = _allDistricts.Select(d => $"d{d}").ToList();

            async Task<HashSet<string>> Ids(string prefix, List<int> ids, string sql, object? extra = null)
            {
                if (ids.Count == 0) return new HashSet<string>();
                var p = new DynamicParameters(extra);
                p.Add("Ids", ids);
                p.Add("Year", _yearLabel);
                return (await _conn.QueryAsync<int>(sql, p)).Select(i => $"{prefix}{i}").ToHashSet();
            }

            (List<string>, HashSet<string>, HashSet<string>) status;
            switch (key)
            {
                case "clubWebsite":
                {
                    var live = await Ids("c", clubs, @"
                        SELECT DISTINCT fk_club_id FROM club_websites
                        WHERE fk_club_id IN @Ids AND COALESCE(isdeleted, 0) = 0
                          AND Status = 'Active' AND CURDATE() BETWEEN StartDate AND EndDate");
                    var ever = await Ids("c", clubs, @"
                        SELECT DISTINCT fk_club_id FROM club_websites
                        WHERE fk_club_id IN @Ids AND COALESCE(isdeleted, 0) = 0");
                    status = (clubUnits, live, ever);
                    break;
                }
                case "clubDues":
                    status = (clubUnits, await Ids("c", clubs, @"
                        SELECT DISTINCT fk_club_id FROM membership_dues
                        WHERE fk_club_id IN @Ids AND isdeleted = 0 AND IsActive = 1 AND RotaryYear = @Year"), new HashSet<string>());
                    break;
                case "districtDues":
                    status = (districtUnits, await Ids("d", _allDistricts, @"
                        SELECT DISTINCT fk_district_id FROM club_dues
                        WHERE fk_district_id IN @Ids AND isdeleted = 0 AND IsActive = 1 AND RotaryYear = @Year"), new HashSet<string>());
                    break;
                case "districtWebsite":
                    status = (districtUnits, await Ids("d", _allDistricts, @"
                        SELECT DISTINCT fk_district_id FROM district_websites
                        WHERE fk_district_id IN @Ids AND COALESCE(isdeleted, 0) = 0 AND Status = 'Active'"), new HashSet<string>());
                    break;
                case "emailCredits":
                {
                    var type = "Email";
                    var clubHas = await Ids("c", clubs, @"
                        SELECT DISTINCT fk_club_id FROM club_credits
                        WHERE fk_club_id IN @Ids AND CreditType = @Type AND IsActive = 1 AND isdeleted = 0
                          AND NOW() <= ToDate AND (CreditCount - UsedCount) > 0", new { Type = type });
                    var districtHas = await Ids("d", _adminDistricts, @"
                        SELECT DISTINCT fk_district_id FROM club_credits
                        WHERE fk_club_id = 0 AND fk_district_id IN @Ids AND CreditType = @Type AND IsActive = 1 AND isdeleted = 0
                          AND NOW() <= ToDate AND (CreditCount - UsedCount) > 0", new { Type = type });
                    // Credits are bought by the club, or by the district for its admins — not the clubs' districts.
                    var units = clubUnits.Concat(_adminDistricts.Select(d => $"d{d}")).ToList();
                    clubHas.UnionWith(districtHas);
                    status = (units, clubHas, new HashSet<string>());
                    break;
                }
                default:
                    status = (new List<string> { "x" }, new HashSet<string> { "x" }, new HashSet<string>());
                    break;
            }

            _cache[key] = status;
            return status;
        }
    }

    public class ActiveItem
    {
        public int Id { get; set; }
        public string Content { get; set; } = "";
        public List<string> Roles { get; set; } = new();   // matched role keys, or ["ALL"]
    }

    // Shared by the web + mobile "active" endpoints. Keeps the legacy single-item fields (show/id/content =
    // first item) so the existing mobile app keeps working, and adds items[] for the ◀ ▶ popup.
    public static async Task<object> BuildActivePayloadAsync(MySqlConnection conn, int memberId, bool includeSuperAdmin, string? currentRole)
    {
        var rows = (await conn.QueryAsync<dynamic>(@"
            SELECT a.pk_announcement_id AS id, a.content AS content,
                   a.target_roles AS targetRoles, a.target_filters AS targetFilters, a.target_locations AS targetLocations
            FROM login_announcements a
            WHERE a.is_active = 1 AND a.isdeleted = 0
              AND NOT EXISTS (
                  SELECT 1 FROM login_announcement_reads r
                  WHERE r.fk_announcement_id = a.pk_announcement_id AND r.fk_member_id = @MemberId
              )
            ORDER BY a.pk_announcement_id DESC",
            new { MemberId = memberId })).ToList();
        if (rows.Count == 0) return new { show = false, items = Array.Empty<ActiveItem>() };

        var memberKeys = await ResolveMemberRoleKeysAsync(conn, memberId, includeSuperAdmin);
        PurchaseFilterContext? filterContext = null;
        var items = new List<ActiveItem>();
        foreach (var row in rows)
        {
            var target = Parse((string?)row.targetRoles);
            List<string> matched;
            if (target.Contains(All, StringComparer.OrdinalIgnoreCase)) matched = new List<string> { All };
            else
            {
                matched = target.Where(memberKeys.Contains).ToList();
                if (matched.Count == 0) continue;
            }

            var filters = ParseFilters((string?)row.targetFilters);
            if (filters.Count > 0)
            {
                filterContext ??= new PurchaseFilterContext(conn, memberId);
                if (!await filterContext.MatchesAllAsync(filters)) continue;
            }

            var locations = ParseLocations((string?)row.targetLocations);
            if (!locations.IsEmpty)
            {
                filterContext ??= new PurchaseFilterContext(conn, memberId);
                if (!await filterContext.MatchesLocationsAsync(locations)) continue;
            }

            items.Add(new ActiveItem { Id = (int)row.id, Content = (string?)row.content ?? "", Roles = matched });
        }
        if (items.Count == 0) return new { show = false, items = Array.Empty<ActiveItem>() };

        // The role of the dashboard the user just landed on goes first; otherwise newest first (stable sort).
        if (!string.IsNullOrWhiteSpace(currentRole))
            items = items.OrderByDescending(i => i.Roles.Contains(currentRole, StringComparer.OrdinalIgnoreCase)).ToList();

        var first = items[0];
        return new { show = true, id = first.Id, content = first.Content, items };
    }

    public static async Task AcknowledgeAsync(MySqlConnection conn, int memberId, IEnumerable<int> ids)
    {
        foreach (var id in ids.Where(i => i > 0).Distinct().Take(100))
        {
            await conn.ExecuteAsync(@"
                INSERT IGNORE INTO login_announcement_reads (fk_announcement_id, fk_member_id, created_date)
                VALUES (@AnnId, @MemberId, NOW())",
                new { AnnId = id, MemberId = memberId });
        }
    }
}
