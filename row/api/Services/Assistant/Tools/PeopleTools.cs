using System.Globalization;
using System.Text.RegularExpressions;
using Dapper;

namespace RotaryApi.Services.Assistant.Tools;

// People and club administration: who leads a unit, one member's contact card, meeting attendance
// and Club Monthly Report submission.
public static partial class PeopleTools
{
    private static readonly string[] Levels = { "zone", "district", "club", "all" };
    private static readonly string[] DistrictOrClub = { "district", "club" };

    public static IEnumerable<AssistantTool> All() => new[]
    {
        new AssistantTool(new ToolSpec("leadership",
            "Who leads a club or district in a rotary year, names only (no phone/email - use member_contact). " +
            "Club: the board of directors (President, Secretary, ...) and the club's Assistant Governor. District: " +
            "the District Governor and each Assistant Governor with the clubs they look after.",
            Schema.Object(Schema.Level(DistrictOrClub), Schema.Id(), Schema.Year(),
                ("designation", Schema.Str("Club level only: keep board roles containing this text, e.g. \"President\", \"Treasurer\"."), false))),
            DataArea.General, LeadershipAsync),

        new AssistantTool(new ToolSpec("member_contact",
            "One member's Rotary ID, phone, email and - only if the member allows it - birthday, anniversary, home " +
            "address and family (spouse/children: name, relation, phone, email, birthday, anniversary), with their clubs. Obeys the member's privacy settings (fields in 'hidden' are private) and uses up one " +
            "of the user's few daily contact lookups, so call it only when the user asks to reach a specific person.",
            Schema.Object(("member_id", Schema.Int("Member id from resolve_entity or leadership."), true))),
            DataArea.General, MemberContactAsync, Cacheable: false, ReadsContactData: true),

        new AssistantTool(new ToolSpec("attendance_stats",
            "Club Service meetings held and average attendance % for a zone, district, club or all, for a rotary year " +
            "or one month. Attendance % is the figure the club recorded on each meeting (present / members on roll, or " +
            "/ board size for BOD meetings); the average is over meetings that have one. Per-club rows for zone/district.",
            Schema.Object(Schema.Level(Levels), Schema.Id(false), Schema.Year(),
                ("month", Schema.Int("Calendar month 1-12 (7 = July ... 6 = June) inside the rotary year. Omit for the whole year."), false),
                ("sort", Schema.Enum("Order of per-club rows. Default meetings_desc.", "meetings_desc", "attendance_desc", "attendance_asc"), false),
                Schema.LimitArg())),
            DataArea.General, AttendanceStatsAsync),

        new AssistantTool(new ToolSpec("monthly_report_status",
            "Club Monthly Report (CMR) status for a district's clubs or one club: 'submitted' = uploaded to the district, " +
            "'pending' = created but not uploaded, 'not_started' = no report. Give a month to list which clubs have and " +
            "have not submitted; omit it for every month of the rotary year so far.",
            Schema.Object(Schema.Level(DistrictOrClub), Schema.Id(), Schema.Year(),
                ("month", Schema.Int("Calendar month 1-12 (7 = July ... 6 = June) inside the rotary year. Omit for all months so far."), false),
                ("limit", Schema.Int("Max club names per list (default 100, max 200)."), false))),
            DataArea.General, MonthlyReportStatusAsync),
    };

    // ── leadership ──────────────────────────────────────────────────────────

    private static async Task<object> LeadershipAsync(AssistantToolContext ctx, ToolArgs args)
    {
        var level = args.Enum("level", DistrictOrClub);
        var unit = await ctx.Hierarchy.ResolveAsync(level, args.Int("id"));
        var year = await ctx.Years.ResolveAsync(args.String("year"));
        ctx.Require(unit.Target, ScopeDepth.Aggregate, DataArea.General, year.Id, unit.Label);
        await using var conn = await ctx.OpenReadOnlyAsync();

        if (level == "club")
        {
            var text = args.String("designation")?.Replace("%", "").Replace("_", "");
            // Same rows and order as BoardDirectorService.GetByClubAsync: non-member seats count, a seat
            // pointing at a hard-deleted profile does not; "Other" seats carry their custom_designation.
            var board = await conn.QueryAsync<(int? MemberId, string Role, string Name)>(@"
                SELECT bd.fk_member_master_profile_id,
                       COALESCE(NULLIF(bd.custom_designation, ''), dm.designation_name),
                       COALESCE(m.MemberName, bd.non_member_name, '')
                FROM board_of_directors bd
                JOIN designation_master dm ON dm.pk_designation_id = bd.fk_designation_id
                LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
                WHERE bd.fk_club_id = @Id AND bd.fk_year_id = @Year AND COALESCE(bd.isdeleted,0) = 0
                  AND (bd.fk_member_master_profile_id IS NULL OR m.pk_member_master_profile_id IS NOT NULL)
                  AND (@Like IS NULL OR COALESCE(NULLIF(bd.custom_designation, ''), dm.designation_name) LIKE @Like)
                ORDER BY CASE bd.fk_designation_id WHEN 1 THEN 0 WHEN 2 THEN 1 ELSE 2 END,
                         COALESCE(bd.sort_order, 9999), dm.sort_order, bd.pk_board_director_id
                LIMIT 100",
                new { Id = unit.ClubId, Year = year.Id, Like = string.IsNullOrWhiteSpace(text) ? null : "%" + text + "%" });
            var ag = await conn.ExecuteScalarAsync<string?>(@"
                SELECT m.MemberName FROM district_ag ag
                JOIN member_master_profile m ON m.pk_member_master_profile_id = ag.fk_member_id AND m.isdeleted = 0
                WHERE ag.fk_club_id = @Id AND ag.fk_year_id = @Year AND COALESCE(ag.is_active,1) = 1 AND COALESCE(ag.isdeleted,0) = 0
                ORDER BY ag.id DESC LIMIT 1", new { Id = unit.ClubId, Year = year.Id });
            var list = board.Select(b => new { role = b.Role, name = b.Name, memberId = b.MemberId }).ToList();
            return new
            {
                club = unit.ClubName, district = unit.DistrictNumber, year = year.Label,
                designationFilter = text,
                board = list,
                assistantGovernor = ag,
                note = list.Count == 0 ? "No board of directors recorded for this club and year (or none matching the filter)." : null,
            };
        }

        // District Governor: member record is the source of truth, non-member DGs use the row's own name
        // (DistrictGovernorSql / DistrictGovernorController.GetAll).
        var dg = await conn.ExecuteScalarAsync<string?>($@"
            SELECT {DistrictGovernorSql.Name}
            FROM district_governors g
            {DistrictGovernorSql.JoinMember}
            WHERE g.fk_district_id = @Id AND g.fk_year_id = @Year AND COALESCE(g.isdeleted,0) = 0
            LIMIT 1", new { Id = unit.DistrictId, Year = year.Id });

        // Assistant Governors for the year with their live clubs (DistrictModulesController.GetAGs).
        var agRows = await conn.QueryAsync<(int MemberId, string Name, string Club)>($@"
            SELECT m.pk_member_master_profile_id, m.MemberName, c.ClubName
            FROM district_ag a
            JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_id AND m.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = a.fk_club_id
            {ToolSql.ClubJoins()}
            WHERE a.fk_district_id = @Id AND a.fk_year_id = @Year
              AND COALESCE(a.isdeleted,0) = 0 AND COALESCE(a.is_active,1) = 1
              AND {ToolSql.ClubCounts()} AND {ToolSql.Level("district")} AND {ctx.ExcludedZonesSql("d.fk_zone_id")}
            ORDER BY m.MemberName, c.ClubName
            LIMIT 500", new { Id = unit.DistrictId, Year = year.Id });
        var ags = agRows.GroupBy(r => (r.MemberId, r.Name))
            .Select(g => new { name = g.Key.Name, memberId = g.Key.MemberId, clubs = g.Select(r => r.Club).ToList() })
            .ToList();
        return new
        {
            district = unit.DistrictNumber, zone = unit.ZoneName, year = year.Label,
            districtGovernor = dg,
            assistantGovernors = ags,
            note = dg == null ? "No District Governor recorded for this district and year." : null,
        };
    }

    // ── member_contact ──────────────────────────────────────────────────────

    private sealed class ContactRow
    {
        public string Name { get; init; } = "";
        public string? Mobile { get; init; }
        public string? PhoneCode { get; init; }
        public string? Email { get; init; }
        public string? BirthDate { get; init; }
        public string? Anniversary { get; init; }
        public string? RotaryId { get; init; }
        public bool PersonalVisible { get; init; }
        public bool FamilyVisible { get; init; }
    }

    private static async Task<object> MemberContactAsync(AssistantToolContext ctx, ToolArgs args)
    {
        var memberId = args.RequiredInt("member_id");
        var current = await ctx.Years.CurrentAsync();
        await using var conn = await ctx.OpenReadOnlyAsync();

        // Only the member's active memberships in live clubs - ids, no personal data - so scope is settled
        // before anything about the person is read.
        var memberships = (await conn.QueryAsync<(int ClubId, string? Designation)>($@"
            SELECT c.pk_club_id, NULLIF(cm.Designation, '')
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            {ToolSql.ClubJoins()}
            WHERE cm.fk_member_master_profile_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND {ToolSql.ClubCounts()}
            ORDER BY c.ClubName", new { Id = memberId })).ToList();

        // Detail reach on at least one of the member's clubs; only those clubs are named in the answer.
        var visible = new List<(HierarchyRef Club, string? Designation)>();
        foreach (var ms in memberships)
        {
            var club = await ctx.Hierarchy.ResolveAsync("club", ms.ClubId);
            if (ScopeGuard.CanSee(ctx.Scope, club.Target, ScopeDepth.Detail, DataArea.General, current.Id))
                visible.Add((club, ms.Designation));
        }
        if (visible.Count == 0)
            throw new ToolDeniedException("not_permitted: this user has no access to that member's contact details.");

        await using (var w = await ctx.Store.OpenAsync())
        {
            if (!await ctx.Store.TryUseContactLookupAsync(w, ctx.Scope.MemberId))
                throw new ToolDeniedException("contact_limit: daily limit of contact lookups reached.");
        }

        var row = await conn.QuerySingleOrDefaultAsync<ContactRow>(@"
            SELECT m.MemberName AS Name, m.PrimaryMobileNumber AS Mobile, cty.PhoneCode AS PhoneCode, m.EmailId AS Email,
                   DATE_FORMAT(m.BirthDate, '%Y-%m-%d') AS BirthDate,
                   DATE_FORMAT(m.AnniversaryDate, '%Y-%m-%d') AS Anniversary,
                   NULLIF(m.RotaryId, '') AS RotaryId,
                   COALESCE(m.IsPersonalDetailsVisible + 0, 1) <> 0 AS PersonalVisible,
                   COALESCE(m.IsFamilyDetailsVisible + 0, 1) <> 0 AS FamilyVisible
            FROM member_master_profile m
            LEFT JOIN country_master cty ON cty.pk_country_id = m.fk_primary_country_id
            WHERE m.pk_member_master_profile_id = @Id AND m.isdeleted = 0", new { Id = memberId })
            ?? throw new ToolDeniedException("not_permitted: this user has no access to that member's contact details.");

        // This year's board role in each visible club, else the club_members designation.
        var clubIds = visible.Select(v => v.Club.ClubId!.Value).ToList();
        var roles = (await conn.QueryAsync<(int ClubId, string Role)>(@"
            SELECT bd.fk_club_id, COALESCE(NULLIF(bd.custom_designation, ''), dm.designation_name)
            FROM board_of_directors bd
            JOIN designation_master dm ON dm.pk_designation_id = bd.fk_designation_id
            WHERE bd.fk_member_master_profile_id = @Id AND bd.fk_year_id = @Year AND bd.fk_club_id IN @Clubs
              AND COALESCE(bd.isdeleted,0) = 0
            ORDER BY CASE bd.fk_designation_id WHEN 1 THEN 0 WHEN 2 THEN 1 ELSE 2 END, dm.sort_order",
            new { Id = memberId, Year = current.Id, Clubs = clubIds }))
            .GroupBy(r => r.ClubId).ToDictionary(g => g.Key, g => g.First().Role);

        // Phone / email: the four global flags, exactly as DistrictDirectoryController / FindRotarianController
        // apply them - "MyClub" when the viewer shares an active club with the member, else "AllClubs".
        var viewer = ctx.Scope.MemberId;
        var sharesClub = await MemberPrivacyHelper.ViewerSharesClubWithMemberAsync(conn, viewer, memberId);
        var flags = MemberPrivacyHelper.FlagsFor(await MemberPrivacyHelper.GetFlagsAsync(conn, new[] { memberId }), memberId);
        var showPhone = MemberPrivacyHelper.ShouldShowPhone(viewer, memberId, sharesClub, flags);
        var showEmail = MemberPrivacyHelper.ShouldShowEmail(viewer, memberId, sharesClub, flags);

        // Birthday, anniversary and address only behind the member's IsPersonalDetailsVisible switch.
        object? address = null;
        if (row.PersonalVisible)
        {
            // Latest residential row, as DistrictDirectoryController reads it ("Residential" legacy,
            // "Residence" current). Address phone numbers are left out - they bypass the phone flags.
            var addr = (await conn.QueryAsync<(string? Line, string? City, string? State, string? Pin)>(@"
                SELECT a.Address, a.City, a.State, a.PinCode
                FROM member_address_details a
                WHERE a.fk_member_master_profile_id = @Id AND a.AddressType IN ('Residential','Residence')
                  AND COALESCE(a.isdeleted, 0) = 0
                ORDER BY a.pk_member_address_details_id DESC LIMIT 1", new { Id = memberId })).ToList();
            if (addr.Count > 0)
                address = new { line = addr[0].Line, city = addr[0].City, state = addr[0].State, pin = addr[0].Pin };
        }

        // Family only behind the member's IsFamilyDetailsVisible switch (same switch as the directory).
        // Includes each family member's phone and email (user decision 2026-11-05).
        object? family = null;
        if (row.FamilyVisible)
        {
            var rows = (await conn.QueryAsync(@"
                SELECT f.Name AS name, f.Relation AS relation,
                       CASE WHEN COALESCE(f.PhoneNumber, '') = '' THEN NULL
                            WHEN COALESCE(cty.PhoneCode, '') = '' THEN f.PhoneNumber
                            ELSE CONCAT('+', TRIM(LEADING '+' FROM cty.PhoneCode), ' ', f.PhoneNumber) END AS phone,
                       NULLIF(f.EmailId, '') AS email,
                       DATE_FORMAT(f.BirthDate, '%Y-%m-%d') AS birthDate,
                       DATE_FORMAT(f.AnniversaryDate, '%Y-%m-%d') AS anniversary
                FROM member_family_details f
                LEFT JOIN country_master cty ON cty.pk_country_id = f.fk_country_id
                WHERE f.fk_member_master_profile_id = @Id AND COALESCE(f.isdeleted, 0) = 0
                ORDER BY CASE WHEN LOWER(f.Relation) IN ('spouse','wife','husband') THEN 0 ELSE 1 END, f.pk_member_family_details_id",
                new { Id = memberId })).ToList();
            if (rows.Count > 0) family = rows;
        }

        var hidden = new List<string>();
        if (!showPhone) hidden.Add("phone");
        if (!showEmail) hidden.Add("email");
        if (!row.PersonalVisible) hidden.AddRange(new[] { "birthDate", "anniversary", "address" });
        if (!row.FamilyVisible) hidden.Add("family");

        string? phone = null;
        if (showPhone && !string.IsNullOrWhiteSpace(row.Mobile))
            phone = string.IsNullOrWhiteSpace(row.PhoneCode) ? row.Mobile : $"+{row.PhoneCode.TrimStart('+')} {row.Mobile}";

        return new
        {
            memberId,
            name = row.Name,
            rotaryId = row.RotaryId,
            clubs = visible.Select(v => new
            {
                club = v.Club.ClubName,
                clubId = v.Club.ClubId,
                designation = roles.TryGetValue(v.Club.ClubId!.Value, out var r) ? r : v.Designation,
            }),
            phone,
            email = showEmail && !string.IsNullOrWhiteSpace(row.Email) ? row.Email : null,
            birthDate = row.PersonalVisible ? row.BirthDate : null,
            anniversary = row.PersonalVisible ? row.Anniversary : null,
            address,
            family,
            hidden = hidden.Count > 0 ? hidden : null,
            note = "Fields listed in 'hidden' are private under the member's own privacy settings - say so, do not guess. " +
                   "Any other missing field is simply not on record.",
        };
    }

    // ── attendance_stats ────────────────────────────────────────────────────

    private static async Task<object> AttendanceStatsAsync(AssistantToolContext ctx, ToolArgs args)
    {
        var level = args.Enum("level", Levels);
        var unit = await ctx.Hierarchy.ResolveAsync(level, args.Int("id"));
        var year = await ctx.Years.ResolveAsync(args.String("year"));
        ctx.Require(unit.Target, ScopeDepth.Aggregate, DataArea.General, year.Id, unit.Label);
        var month = ReadMonth(args);
        var avg = "AVG(x.attendance_percentage)";
        var order = args.Enum("sort", new[] { "meetings_desc", "attendance_desc", "attendance_asc" }, "meetings_desc") switch
        {
            "attendance_desc" => $"{avg} IS NULL, {avg} DESC, c.ClubName",
            "attendance_asc" => $"{avg} IS NULL, {avg} ASC, c.ClubName",
            _ => "COUNT(x.fk_club_id) DESC, c.ClubName",
        };

        // Meetings live in the year-wise projects table (rotary_projects_YYYY_YY) under the club_service
        // module - the source ClubMonthlyReportService.GetMeetingsForMonthAsync and the AG dashboard use.
        // club_attendance is not used: it stores no roll size, so any % from it divides by today's count.
        var table = new YearTableResolver().GetProjectsTableName(year.Label);
        if (!ProjectsTable().IsMatch(table)) throw new ToolInputException($"No meeting data for rotary year {year.Label}.");

        var where = $"{ToolSql.ClubCounts()} AND {ToolSql.Level(level)} AND {ctx.ExcludedZonesSql("d.fk_zone_id")}";
        var p = new { Id = unit.ClubId ?? unit.DistrictId ?? unit.ZoneId ?? 0, Month = month };
        await using var conn = await ctx.OpenReadOnlyAsync();
        var clubs = await conn.ExecuteScalarAsync<int>(
            $"SELECT COUNT(*) FROM club_master c {ToolSql.ClubJoins()} WHERE {where}", p);
        var monthLabel = month is int mo ? MonthDate(year, mo).ToString("MMMM yyyy", CultureInfo.InvariantCulture) : null;
        const string definition =
            "meetings = Club Service meetings the clubs filed (regular and BOD). avgAttendancePct = mean of the attendance % " +
            "recorded on each meeting when it was saved (present / members on roll, or / board size for BOD meetings); " +
            "meetings with no recorded % are left out of the average.";

        var exists = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM information_schema.tables
            WHERE table_schema = DATABASE() AND table_name = @table", new { table });
        if (exists == 0)
            return new { unit = unit.Label, year = year.Label, month = monthLabel, clubs, meetings = 0,
                         note = "No Club Service meeting records exist for this rotary year." };

        var meetingsSql = $@"
            SELECT p.fk_club_id, p.project_date, p.attendance_percentage
            FROM `{table}` p
            JOIN module_master mm ON mm.pk_module_id = p.fk_module_id AND mm.ModuleKey = 'club_service'
            WHERE p.isdeleted = 0 AND (@Month IS NULL OR MONTH(p.project_date) = @Month)";

        // Same average as ClubMonthlyReportService.BuildPreviewLiveAsync step 4: AVG of the stored
        // attendance_percentage over meetings that have one (SQL AVG skips NULLs).
        var totals = await conn.QuerySingleAsync<(int Meetings, int WithPct, decimal? AvgPct, int ClubsWithMeetings)>($@"
            SELECT COUNT(*), COUNT(x.attendance_percentage), ROUND(AVG(x.attendance_percentage), 1), COUNT(DISTINCT x.fk_club_id)
            FROM ({meetingsSql}) x
            JOIN club_master c ON c.pk_club_id = x.fk_club_id
            {ToolSql.ClubJoins()}
            WHERE {where}", p);

        object? byClub = null;
        object? byMonth = null;
        if (level is "zone" or "district")
        {
            var rows = await conn.QueryAsync<(int Id, string Club, int Meetings, decimal? AvgPct)>($@"
                SELECT c.pk_club_id, c.ClubName, COUNT(x.fk_club_id), ROUND({avg}, 1)
                FROM club_master c
                {ToolSql.ClubJoins()}
                LEFT JOIN ({meetingsSql}) x ON x.fk_club_id = c.pk_club_id
                WHERE {where}
                GROUP BY c.pk_club_id, c.ClubName
                ORDER BY {order} LIMIT {args.Limit()}", p);
            byClub = rows.Select(r => new { id = r.Id, club = r.Club, meetings = r.Meetings, avgPct = r.AvgPct });
        }
        else if (level == "club" && month == null)
        {
            var rows = await conn.QueryAsync<(int Month, int Meetings, decimal? AvgPct)>($@"
                SELECT MONTH(x.project_date), COUNT(*), ROUND({avg}, 1)
                FROM ({meetingsSql}) x
                JOIN club_master c ON c.pk_club_id = x.fk_club_id
                {ToolSql.ClubJoins()}
                WHERE {where} AND x.project_date IS NOT NULL
                GROUP BY MONTH(x.project_date)", p);
            byMonth = rows.Select(r => (Date: MonthDate(year, r.Month), r.Meetings, r.AvgPct))
                .OrderBy(r => r.Date)
                .Select(r => new { month = r.Date.ToString("yyyy-MM"), meetings = r.Meetings, avgPct = r.AvgPct });
        }

        return new
        {
            unit = unit.Label, year = year.Label, month = monthLabel,
            definition,
            clubs,
            clubsWithMeetings = totals.ClubsWithMeetings,
            meetings = totals.Meetings,
            meetingsWithPct = totals.WithPct,
            avgAttendancePct = totals.AvgPct,
            byClub, byMonth,
        };
    }

    // ── monthly_report_status ───────────────────────────────────────────────

    private sealed class CmrRow
    {
        public int ClubId { get; init; }
        public string Club { get; init; } = "";
        public int? Month { get; init; }
        public bool Uploaded { get; init; }
        public string? SubmittedOn { get; init; }
    }

    private static async Task<object> MonthlyReportStatusAsync(AssistantToolContext ctx, ToolArgs args)
    {
        var level = args.Enum("level", DistrictOrClub);
        var unit = await ctx.Hierarchy.ResolveAsync(level, args.Int("id"));
        var year = await ctx.Years.ResolveAsync(args.String("year"));
        ctx.Require(unit.Target, ScopeDepth.Aggregate, DataArea.General, year.Id, unit.Label);
        var month = ReadMonth(args);
        var limit = args.Limit(100, 200);

        // ReportMonth is the CALENDAR month (7 = July ... 6 = June) inside the report's rotary year
        // (ClubMonthlyReportService.GetMonthsAsync stores current.Month). Months run from July up to the
        // current month for the running year, else to June - the list GetMonthsAsync shows the club.
        var months = month is int m ? new List<DateTime> { MonthDate(year, m) } : MonthsSoFar(year);
        const string basis =
            "ReportMonth is the calendar month inside the rotary year. submitted = uploaded to the district; " +
            "pending = report created but not uploaded; not_started = no report. The running month is included " +
            "even though its report may not be due yet.";

        // Read-only copy of DistrictAdminDashboardService.BuildCmrPerClubGridAsync: every live club of the
        // unit, LEFT JOINed to its non-deleted reports for the year (one row per club/year/month - unique key).
        await using var conn = await ctx.OpenReadOnlyAsync();
        var rows = (await conn.QueryAsync<CmrRow>($@"
            SELECT c.pk_club_id AS ClubId, c.ClubName AS Club, r.ReportMonth AS Month,
                   COALESCE(r.IsUploadedToDistrict, 0) = 1 AS Uploaded,
                   DATE_FORMAT(COALESCE(r.uploaded_to_district_date, r.created_date), '%Y-%m-%d') AS SubmittedOn
            FROM club_master c
            {ToolSql.ClubJoins()}
            LEFT JOIN club_monthly_reports r ON r.fk_club_id = c.pk_club_id AND r.fk_year_id = @Year
                 AND COALESCE(r.isdeleted, 0) = 0
            WHERE {ToolSql.ClubCounts()} AND {ToolSql.Level(level)} AND {ctx.ExcludedZonesSql("d.fk_zone_id")}
            ORDER BY c.ClubName", new { Id = unit.ClubId ?? unit.DistrictId ?? 0, Year = year.Id })).ToList();

        var clubs = rows.GroupBy(r => (r.ClubId, r.Club)).Select(g => g.Key).ToList();
        var reports = new Dictionary<(int, int), CmrRow>();
        foreach (var r in rows.Where(r => r.Month != null))
            if (!reports.TryGetValue((r.ClubId, r.Month!.Value), out var seen) || (r.Uploaded && !seen.Uploaded))
                reports[(r.ClubId, r.Month!.Value)] = r;
        string Status(int clubId, int calMonth, out string? date)
        {
            date = null;
            if (!reports.TryGetValue((clubId, calMonth), out var rep)) return "not_started";
            if (!rep.Uploaded) return "pending";
            date = rep.SubmittedOn;
            return "submitted";
        }

        if (months.Count == 0)
            return new { unit = unit.Label, year = year.Label, note = "This rotary year has not started yet." };

        if (level == "club")
        {
            var list = months.Select(dt =>
            {
                var s = Status(unit.ClubId!.Value, dt.Month, out var date);
                return new { month = dt.ToString("yyyy-MM"), label = dt.ToString("MMMM yyyy", CultureInfo.InvariantCulture), status = s, submittedOn = date };
            }).ToList();
            return new
            {
                club = unit.ClubName, year = year.Label, basis,
                submitted = list.Count(x => x.status == "submitted"),
                pending = list.Count(x => x.status == "pending"),
                notStarted = list.Count(x => x.status == "not_started"),
                months = list,
            };
        }

        if (month is int one)
        {
            var label = months[0].ToString("MMMM yyyy", CultureInfo.InvariantCulture);
            var status = clubs.Select(c => (c.Club, S: Status(c.ClubId, one, out var date), Date: date)).ToList();
            var submitted = status.Where(s => s.S == "submitted").ToList();
            var pending = status.Where(s => s.S == "pending").ToList();
            var notStarted = status.Where(s => s.S == "not_started").ToList();
            return new
            {
                district = unit.DistrictNumber, year = year.Label, month = label, basis,
                totalClubs = clubs.Count,
                submitted = submitted.Count, pending = pending.Count, notStarted = notStarted.Count,
                submittedClubs = submitted.Take(limit).Select(s => new { club = s.Club, on = s.Date }),
                pendingClubs = pending.Take(limit).Select(s => s.Club),
                notStartedClubs = notStarted.Take(limit).Select(s => s.Club),
                truncated = submitted.Count > limit || pending.Count > limit || notStarted.Count > limit ? true : (bool?)null,
            };
        }

        // Whole year so far: counts per month, then the clubs furthest behind first.
        var perMonth = months.Select(dt =>
        {
            int sub = 0, pen = 0;
            foreach (var c in clubs)
            {
                var s = Status(c.ClubId, dt.Month, out _);
                if (s == "submitted") sub++;
                else if (s == "pending") pen++;
            }
            return new { month = dt.ToString("yyyy-MM"), submitted = sub, pending = pen, notStarted = clubs.Count - sub - pen };
        }).ToList();
        var perClub = clubs.Select(c =>
        {
            var missing = months.Where(dt => Status(c.ClubId, dt.Month, out _) != "submitted").ToList();
            return new
            {
                club = c.Club,
                submitted = months.Count - missing.Count,
                notSubmitted = missing.Select(dt => dt.ToString("MMM", CultureInfo.InvariantCulture)).ToList(),
            };
        }).OrderByDescending(c => c.notSubmitted.Count).ThenBy(c => c.club).ToList();

        return new
        {
            district = unit.DistrictNumber, year = year.Label, basis,
            monthsCovered = months.Count,
            totalClubs = clubs.Count,
            clubsUpToDate = perClub.Count(c => c.notSubmitted.Count == 0),
            byMonth = perMonth,
            byClub = perClub.Take(limit),
            truncated = perClub.Count > limit ? true : (bool?)null,
        };
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    // Optional calendar month 1-12; a non-number is an error rather than a silent whole-year answer.
    private static int? ReadMonth(ToolArgs args)
    {
        var month = args.Int("month");
        if (month == null && args.String("month") != null)
            throw new ToolInputException("'month' must be a calendar month number 1-12 (7 = July).");
        if (month is < 1 or > 12)
            throw new ToolInputException("'month' must be a calendar month number 1-12 (7 = July).");
        return month;
    }

    // First day of calendar month m inside the rotary year (July-June).
    private static DateTime MonthDate(RotaryYear year, int m) =>
        new(m >= year.Start.Month ? year.Start.Year : year.Start.Year + 1, m, 1);

    // July .. min(June, this month) for the year; empty when the year lies in the future.
    private static List<DateTime> MonthsSoFar(RotaryYear year)
    {
        var today = DateTime.UtcNow.AddMinutes(330).Date;
        var last = year.End < today ? year.End : today;
        var list = new List<DateTime>();
        for (var dt = new DateTime(year.Start.Year, year.Start.Month, 1); dt <= last; dt = dt.AddMonths(1))
            list.Add(dt);
        return list;
    }

    // The table name is interpolated into SQL, so it must be exactly the year-wise naming pattern.
    [GeneratedRegex(@"^rotary_projects_\d{4}_\d{2}$")]
    private static partial Regex ProjectsTable();
}
