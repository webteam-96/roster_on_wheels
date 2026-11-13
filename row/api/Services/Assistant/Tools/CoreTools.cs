using System.Text.RegularExpressions;
using Dapper;

namespace RotaryApi.Services.Assistant.Tools;

// Finding things and the basic counts: names -> ids, rotary years, membership, clubs.
public static partial class CoreTools
{
    private static readonly string[] Levels = { "zone", "district", "club", "all" };

    public static IEnumerable<AssistantTool> All() => new[]
    {
        new AssistantTool(new ToolSpec("resolve_entity",
            "Find zones, districts, clubs or members by name or number and get their ids. Call this first " +
            "whenever the user names a place or person (e.g. \"district 3141\", \"RC Bombay Midtown\"). Only " +
            "returns units the user may see.",
            Schema.Object(
                ("text", Schema.Str("Name or number as the user wrote it."), true),
                ("kind", Schema.Enum("What to look for. Default any.", "any", "zone", "district", "club", "member"), false))),
            DataArea.General, ResolveEntityAsync),

        new AssistantTool(new ToolSpec("get_rotary_years",
            "List rotary year labels (July to June) with dates, and which one is current.",
            Schema.Object()),
            DataArea.General, GetRotaryYearsAsync),

        new AssistantTool(new ToolSpec("membership_stats",
            "Membership numbers for a zone, district, club or all: active members, honorary, male/female, " +
            "joined and terminated in a rotary year. Counting rule matches the dashboards: a person in two clubs " +
            "counts in both; honorary members are not in 'members'. Optional breakdown by club or by month.",
            Schema.Object(Schema.Level(Levels), Schema.Id(false), Schema.Year(),
                ("breakdown", Schema.Enum("Extra rows to return. Default none.", "none", "club", "month"), false),
                Schema.LimitArg())),
            DataArea.General, MembershipStatsAsync),

        new AssistantTool(new ToolSpec("list_clubs",
            "Clubs of a district with member counts, charter date and city, sorted.",
            Schema.Object(
                ("district_id", Schema.Int("District id from resolve_entity."), true),
                ("sort", Schema.Enum("Default members_desc.", "members_desc", "members_asc", "name", "charter_date"), false),
                Schema.LimitArg())),
            DataArea.General, ListClubsAsync),

        new AssistantTool(new ToolSpec("club_profile",
            "One club's details: Rotary id, charter date, meeting day/time/place, city, member count, website, " +
            "and this year's President, Secretary and Assistant Governor (names only).",
            Schema.Object(("club_id", Schema.Int("Club id from resolve_entity."), true))),
            DataArea.General, ClubProfileAsync),
    };

    private static async Task<object> ResolveEntityAsync(AssistantToolContext ctx, ToolArgs args)
    {
        var text = args.RequiredString("text");
        var kind = args.Enum("kind", new[] { "any", "zone", "district", "club", "member" }, "any");
        var digits = Digits().Match(text).Value;
        var words = ClubPrefix().Replace(text, "").Trim();
        if (words.Length < 2 && digits.Length == 0) throw new ToolInputException("Give at least two letters or a number.");
        var like = "%" + words.Replace("%", "").Replace("_", "") + "%";

        await using var conn = await ctx.OpenReadOnlyAsync();
        var zones = new List<object>();
        var districts = new List<object>();
        var clubs = new List<object>();
        var members = new List<object>();

        if (kind is "any" or "zone")
        {
            var rows = await conn.QueryAsync<(int Id, string Name)>($@"
                SELECT z.pk_zone_id, z.ZoneName FROM zone_master z
                WHERE z.isdeleted = 0 AND {HierarchyScopeSql.ZoneLive("z")}
                  AND (z.ZoneName LIKE @like OR (@digits <> '' AND z.ZoneName = CONCAT('Zone ', @digits)))
                LIMIT 10", new { like, digits });
            foreach (var r in rows)
                if (ScopeGuard.CanSee(ctx.Scope, new ScopeTarget(r.Id, null, null), ScopeDepth.Aggregate, DataArea.General, null))
                    zones.Add(new { id = r.Id, name = r.Name });
        }
        if ((kind is "any" or "district") && digits.Length > 0)
        {
            var rows = await conn.QueryAsync<(int Id, string Number, int? ZoneId, string? Zone)>($@"
                SELECT d.pk_district_id, d.DistrictNumber, d.fk_zone_id, z.ZoneName
                FROM district_master d LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                WHERE d.isdeleted = 0 AND {HierarchyScopeSql.DistrictLive("d")} AND d.DistrictNumber LIKE @dl
                ORDER BY d.DistrictNumber = @digits DESC LIMIT 10", new { dl = digits + "%", digits });
            foreach (var r in rows)
                if (ScopeGuard.CanSee(ctx.Scope, new ScopeTarget(r.ZoneId, r.Id, null), ScopeDepth.Aggregate, DataArea.General, null)
                    || ScopeGuard.CanSee(ctx.Scope, new ScopeTarget(r.ZoneId, r.Id, null), ScopeDepth.Aggregate, DataArea.Goals, null))
                    districts.Add(new { id = r.Id, number = r.Number, zone = r.Zone });
        }
        var current = await ctx.Years.CurrentAsync();
        if ((kind is "any" or "club") && words.Length >= 2)
        {
            var rows = await conn.QueryAsync<(int Id, string Name, int? DistrictId, string? District, int? ZoneId)>($@"
                SELECT c.pk_club_id, c.ClubName, c.fk_district_id, d.DistrictNumber, d.fk_zone_id
                FROM club_master c {ToolSql.ClubJoins()}
                WHERE {ToolSql.ClubCounts()} AND c.ClubName LIKE @like
                ORDER BY CHAR_LENGTH(c.ClubName) LIMIT 40", new { like });
            foreach (var r in rows.Where(r => ScopeGuard.CanSee(ctx.Scope, new ScopeTarget(r.ZoneId, r.DistrictId, r.Id),
                         ScopeDepth.Aggregate, DataArea.Projects, current.Id)).Take(10))
                clubs.Add(new { id = r.Id, name = r.Name, district = r.District });
        }
        if ((kind is "any" or "member") && words.Length >= 3)
        {
            var rows = await conn.QueryAsync<(int Id, string Name, int ClubId, string Club, int? DistrictId, int? ZoneId)>($@"
                SELECT m.pk_member_master_profile_id, m.MemberName, c.pk_club_id, c.ClubName, c.fk_district_id, d.fk_zone_id
                FROM member_master_profile m
                JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                     AND cm.IsActive = 1 AND cm.isdeleted = 0
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                {ToolSql.ClubJoins()}
                WHERE m.isdeleted = 0 AND {ToolSql.ClubCounts()} AND m.MemberName LIKE @like
                LIMIT 60", new { like });
            foreach (var r in rows.Where(r => ScopeGuard.CanSee(ctx.Scope, new ScopeTarget(r.ZoneId, r.DistrictId, r.ClubId),
                         ScopeDepth.Detail, DataArea.General, current.Id)).Take(10))
                members.Add(new { id = r.Id, name = r.Name, club = r.Club, clubId = r.ClubId });
        }

        if (zones.Count + districts.Count + clubs.Count + members.Count == 0)
            return new { found = false, note = "Nothing matching that the user can see. Ask the user to check the name." };
        return new { zones, districts, clubs, members };
    }

    private static async Task<object> GetRotaryYearsAsync(AssistantToolContext ctx, ToolArgs args)
    {
        var years = await ctx.Years.AllAsync();
        return new
        {
            current = (await ctx.Years.CurrentAsync()).Label,
            years = years.Take(12).Select(y => new { label = y.Label, start = y.Start.ToString("yyyy-MM-dd"), end = y.End.ToString("yyyy-MM-dd") }),
        };
    }

    private static async Task<object> MembershipStatsAsync(AssistantToolContext ctx, ToolArgs args)
    {
        var level = args.Enum("level", Levels);
        var unit = await ctx.Hierarchy.ResolveAsync(level, args.Int("id"));
        var year = await ctx.Years.ResolveAsync(args.String("year"));
        ctx.Require(unit.Target, ScopeDepth.Aggregate, DataArea.General, year.Id, unit.Label);
        var breakdown = args.Enum("breakdown", new[] { "none", "club", "month" }, "none");

        var where = $"{ToolSql.ClubCounts()} AND {ToolSql.Level(level)} AND {ctx.ExcludedZonesSql("d.fk_zone_id")}";
        var p = new { Id = unit.ClubId ?? unit.DistrictId ?? unit.ZoneId ?? 0, Start = year.Start, End = year.End.Date.AddDays(1).AddTicks(-1) };
        await using var conn = await ctx.OpenReadOnlyAsync();

        // Same rules as DistrictAdminDashboardService.GetMembershipAsync: COUNT(*) over memberships,
        // honorary kept apart, terminated = soft-deleted with deleted_date inside the year.
        var totals = await conn.QuerySingleAsync<dynamic>($@"
            SELECT COALESCE(SUM(cm.IsActive = 1 AND cm.isdeleted = 0 AND COALESCE(cm.IsHonoraryMember,0) = 0), 0) AS members,
                   COALESCE(SUM(cm.IsActive = 1 AND cm.isdeleted = 0 AND COALESCE(cm.IsHonoraryMember,0) = 1), 0) AS honorary,
                   COALESCE(SUM(cm.IsActive = 1 AND cm.isdeleted = 0 AND m.Gender = 'Male'), 0) AS male,
                   COALESCE(SUM(cm.IsActive = 1 AND cm.isdeleted = 0 AND m.Gender = 'Female'), 0) AS female,
                   COUNT(DISTINCT CASE WHEN cm.IsActive = 1 AND cm.isdeleted = 0 THEN cm.fk_member_master_profile_id END) AS distinctPeople,
                   COALESCE(SUM(cm.isdeleted = 0 AND cm.JoinedDate BETWEEN @Start AND @End), 0) AS joined,
                   COALESCE(SUM(cm.isdeleted = 1 AND cm.deleted_date BETWEEN @Start AND @End), 0) AS terminatedCount
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            {ToolSql.ClubJoins()}
            WHERE {where}", p);

        object? rows = null;
        if (breakdown == "club" && level != "club")
        {
            rows = await conn.QueryAsync($@"
                SELECT c.pk_club_id AS clubId, c.ClubName AS club,
                       COALESCE(SUM(cm.IsActive = 1 AND cm.isdeleted = 0 AND COALESCE(cm.IsHonoraryMember,0) = 0), 0) AS members,
                       COALESCE(SUM(cm.isdeleted = 0 AND cm.JoinedDate BETWEEN @Start AND @End), 0) AS joined,
                       COALESCE(SUM(cm.isdeleted = 1 AND cm.deleted_date BETWEEN @Start AND @End), 0) AS terminatedCount
                FROM club_master c
                {ToolSql.ClubJoins()}
                LEFT JOIN club_members cm ON cm.fk_club_id = c.pk_club_id
                WHERE {where}
                GROUP BY c.pk_club_id, c.ClubName
                ORDER BY members DESC LIMIT {args.Limit()}", p);
        }
        else if (breakdown == "month")
        {
            rows = await conn.QueryAsync($@"
                SELECT DATE_FORMAT(x.dt, '%Y-%m') AS month, SUM(x.joined) AS joined, SUM(x.leaving) AS terminatedCount
                FROM (
                    SELECT cm.JoinedDate AS dt, 1 AS joined, 0 AS leaving
                    FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id {ToolSql.ClubJoins()}
                    WHERE {where} AND cm.isdeleted = 0 AND cm.JoinedDate BETWEEN @Start AND @End
                    UNION ALL
                    SELECT cm.deleted_date, 0, 1
                    FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id {ToolSql.ClubJoins()}
                    WHERE {where} AND cm.isdeleted = 1 AND cm.deleted_date BETWEEN @Start AND @End
                ) x
                GROUP BY month ORDER BY month", p);
        }

        return new { unit = unit.Label, year = year.Label, totals, rows };
    }

    private static async Task<object> ListClubsAsync(AssistantToolContext ctx, ToolArgs args)
    {
        var unit = await ctx.Hierarchy.ResolveAsync("district", args.RequiredInt("district_id"));
        var current = await ctx.Years.CurrentAsync();
        ctx.Require(unit.Target, ScopeDepth.Aggregate, DataArea.General, current.Id, unit.Label);
        var order = args.Enum("sort", new[] { "members_desc", "members_asc", "name", "charter_date" }, "members_desc") switch
        {
            "members_asc" => "members ASC",
            "name" => "c.ClubName",
            "charter_date" => "c.ClubCharterDate",
            _ => "members DESC",
        };
        await using var conn = await ctx.OpenReadOnlyAsync();
        var clubs = await conn.QueryAsync($@"
            SELECT c.pk_club_id AS id, c.ClubName AS name, DATE_FORMAT(c.ClubCharterDate, '%Y-%m-%d') AS charterDate,
                   c.City AS city,
                   (SELECT COUNT(*) FROM club_members cm
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                    WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0
                      AND COALESCE(cm.IsHonoraryMember,0) = 0) AS members
            FROM club_master c
            WHERE c.fk_district_id = @Id AND {ToolSql.ClubCounts()}
            ORDER BY {order} LIMIT {args.Limit()}", new { Id = unit.DistrictId });
        var total = await conn.ExecuteScalarAsync<int>(
            $"SELECT COUNT(*) FROM club_master c WHERE c.fk_district_id = @Id AND {ToolSql.ClubCounts()}", new { Id = unit.DistrictId });
        return new { district = unit.DistrictNumber, totalClubs = total, clubs };
    }

    private static async Task<object> ClubProfileAsync(AssistantToolContext ctx, ToolArgs args)
    {
        var unit = await ctx.Hierarchy.ResolveAsync("club", args.RequiredInt("club_id"));
        var current = await ctx.Years.CurrentAsync();
        ctx.Require(unit.Target, ScopeDepth.Aggregate, DataArea.General, current.Id, unit.Label);
        await using var conn = await ctx.OpenReadOnlyAsync();
        var club = await conn.QuerySingleAsync<dynamic>(@"
            SELECT c.ClubName AS name, c.ClubRotaryId AS rotaryId, DATE_FORMAT(c.ClubCharterDate, '%Y-%m-%d') AS charterDate,
                   c.MeetingDay AS meetingDay, c.MeetingFromTime AS meetingFrom, c.MeetingToTime AS meetingTo,
                   c.MeetingAddress AS meetingAddress, c.City AS city, c.State AS state, c.ClubWebsite AS website,
                   (SELECT COUNT(*) FROM club_members cm
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                    WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0
                      AND COALESCE(cm.IsHonoraryMember,0) = 0) AS members
            FROM club_master c WHERE c.pk_club_id = @Id", new { Id = unit.ClubId });
        // Designation 1 = President, 2 = Secretary (ReportsController board-of-directors report).
        var officers = await conn.QueryAsync(@"
            SELECT dm.designation_name AS role, COALESCE(m.MemberName, b.non_member_name) AS name
            FROM board_of_directors b
            JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
            WHERE b.fk_club_id = @Id AND b.fk_year_id = @Year AND COALESCE(b.isdeleted,0) = 0
              AND b.fk_designation_id IN (1, 2)
            ORDER BY b.fk_designation_id", new { Id = unit.ClubId, Year = current.Id });
        var ag = await conn.ExecuteScalarAsync<string?>(@"
            SELECT m.MemberName FROM district_ag ag
            JOIN member_master_profile m ON m.pk_member_master_profile_id = ag.fk_member_id
            WHERE ag.fk_club_id = @Id AND ag.fk_year_id = @Year AND COALESCE(ag.is_active,1) = 1 AND COALESCE(ag.isdeleted,0) = 0
            LIMIT 1", new { Id = unit.ClubId, Year = current.Id });
        return new { club, district = unit.DistrictNumber, year = current.Label, officers, assistantGovernor = ag };
    }

    [GeneratedRegex(@"\d{2,}")]
    private static partial Regex Digits();

    // "Rotary Club of X" / "RC X" -> "X", so the LIKE matches how clubs are stored.
    [GeneratedRegex(@"^\s*(the\s+)?(rotary\s+club\s+of|rotary\s+club|rc\s+of|rc|r\.c\.)\s+", RegexOptions.IgnoreCase)]
    private static partial Regex ClubPrefix();
}
