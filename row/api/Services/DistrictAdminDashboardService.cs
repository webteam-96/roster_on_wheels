using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services.RotaryOrg;

namespace RotaryApi.Services;

// District Admin dashboard data service.
// Resolves the admin's districtId from member_roles (fk_role_id = 2 + fk_district_id > 0)
// then aggregates data across ALL clubs in that district.
//
// Wave 13A2 — extended to return full data for 13 District Admin screens.
// Mirrors to MobileDistrictAdminDashboardController per the mobile-API-parity rule.
// Multi-district admins pass requestedDistrictId; we validate then scope.
public class DistrictAdminDashboardService : IDistrictAdminDashboardService
{
    // TRF is stored AND shown in USD — no currency conversion (was 84 for a legacy INR display).
    private const decimal USD_INR = 1m;
    private static readonly string[] MONTH_LABELS =
        { "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun" };

    // Avenues used across panels — these match seeded module_master.ModuleKey values
    // (DatabaseInitializer.cs ~line 5107-5112).
    private static readonly (string Key, string Label)[] AVENUE_KEYS = new[]
    {
        ("community_service",       "Community Service"),
        ("vocational_service",      "Vocational Service"),
        ("international_service",   "International Service"),
        ("public_image_initiative", "Public Image Initiative"),
        ("new_generation_service",  "New Generation Service"),
    };

    private readonly string _connectionString;
    private readonly IYearTableResolver _yearTables;
    private readonly IRotaryOrgApiClient _rotaryOrgClient;

    public DistrictAdminDashboardService(IConfiguration configuration, IYearTableResolver yearTables, IRotaryOrgApiClient rotaryOrgClient)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _yearTables = yearTables;
        _rotaryOrgClient = rotaryOrgClient;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // Resolves which district this dashboard request is scoped to.
    //
    // - When `requestedDistrictId` is provided, validate that the caller has
    //   an active District Admin assignment at that district. Throws
    //   `UnauthorizedAccessException` if not (controllers translate to 403).
    // - When `requestedDistrictId` is null, fall back to legacy LIMIT 1 lookup
    //   so existing callers that don't pass districtId still work.
    private async Task<int> ResolveDistrictIdAsync(MySqlConnection conn, int memberId, int? requestedDistrictId = null)
    {
        if (memberId <= 0) return 0;

        // A proper DA row has fk_role_id=2 + fk_district_id set + fk_club_id NULL.
        // The fk_club_id IS NULL filter prevents Club Admin rows (which share
        // role_id=2 but have fk_club_id) from being mistaken for DA assignments.
        if (requestedDistrictId.HasValue && requestedDistrictId.Value > 0)
        {
            var isAdmin = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_roles
                WHERE fk_member_master_profile_id = @MemberId
                  AND fk_role_id = 2
                  AND fk_district_id = @DistrictId
                  AND (fk_club_id IS NULL OR fk_club_id = 0)
                  AND IsActive = 1 AND isdeleted = 0",
                new { MemberId = memberId, DistrictId = requestedDistrictId.Value });

            // SuperAdmin may open ANY district's dashboard (e.g. from /settings/global-search
            // "New Dashboard"). SuperAdmins hold no DA rows, so without this every district-admin
            // endpoint would 403 for them. Nothing else is broadened.
            if (isAdmin == 0 && await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId))
                isAdmin = 1;

            if (isAdmin == 0)
                throw new UnauthorizedAccessException("You are not an active admin for this district.");

            return requestedDistrictId.Value;
        }

        var districtId = await conn.ExecuteScalarAsync<int?>(@"
            SELECT fk_district_id FROM member_roles
            WHERE fk_member_master_profile_id = @MemberId
              AND fk_role_id = 2
              AND fk_district_id IS NOT NULL AND fk_district_id > 0
              AND (fk_club_id IS NULL OR fk_club_id = 0)
              AND IsActive = 1 AND isdeleted = 0
            ORDER BY pk_member_role_id ASC
            LIMIT 1",
            new { MemberId = memberId });
        return districtId ?? 0;
    }

    private async Task<int> ResolveYearIdAsync(MySqlConnection conn, int? yearId)
    {
        if (yearId.HasValue && yearId.Value > 0) return yearId.Value;
        var current = await conn.ExecuteScalarAsync<int?>(@"
            SELECT pk_year_id FROM rotary_year_master WHERE isdeleted = 0 AND IsCurrent = 1 LIMIT 1");
        return current ?? 0;
    }

    private async Task<(DateTime? start, DateTime? end)> YearRangeAsync(MySqlConnection conn, int yearId)
    {
        if (yearId <= 0) return (null, null);
        var row = await conn.QueryFirstOrDefaultAsync<(DateTime start, DateTime end)?>(@"
            SELECT StartDate, EndDate FROM rotary_year_master WHERE pk_year_id = @Id LIMIT 1",
            new { Id = yearId });
        return row == null ? (null, null) : (row.Value.start, row.Value.end);
    }

    private async Task<List<YearTableInfo>> GetTargetTablesAsync(MySqlConnection conn, int yearId)
    {
        if (yearId > 0)
        {
            var t = await _yearTables.ResolveByYearIdAsync(conn, yearId);
            return t == null ? new List<YearTableInfo>() : new List<YearTableInfo> { t };
        }
        return await _yearTables.GetAllExistingYearTablesAsync(conn);
    }

    private async Task<DistrictAdminIdentityDto?> BuildIdentityAsync(MySqlConnection conn, int memberId, int districtId, int yearId)
    {
        if (districtId == 0) return null;
        var info = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT d.DistrictNumber AS districtNumber, m.MemberName AS memberName
            FROM district_master d
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = @MemberId
            WHERE d.pk_district_id = @DistrictId AND d.isdeleted = 0 LIMIT 1",
            new { DistrictId = districtId, MemberId = memberId });
        if (info == null) return null;

        var yearLabel = await conn.ExecuteScalarAsync<string?>(@"
            SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @YearId LIMIT 1",
            new { YearId = yearId }) ?? "";

        // user 2026-10-08: Rotaract clubs hidden from District Admin screens (counts + lists).
        var totalClubs = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_master
            WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND COALESCE(ClubType,'') <> 'Rotaract Club'",
            new { DistrictId = districtId });

        return new DistrictAdminIdentityDto
        {
            MemberId = memberId,
            Name = (info.memberName as string) ?? "",
            DistrictId = districtId,
            DistrictNumber = (info.districtNumber as string) ?? "",
            YearLabel = yearLabel,
            TotalClubs = totalClubs,
        };
    }

    private async Task<List<int>> GetDistrictClubIdsAsync(MySqlConnection conn, int districtId)
    {
        var rows = await conn.QueryAsync<int>(@"
            SELECT pk_club_id FROM club_master
            WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND COALESCE(ClubType,'') <> 'Rotaract Club'",
            new { DistrictId = districtId });
        return rows.ToList();
    }

    // ─── OVERVIEW ───────────────────────────────────────────────────────

    public async Task<DistrictAdminOverviewResponse?> GetOverviewAsync(int memberId, int? yearId, int? requestedDistrictId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        if (districtId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, districtId, resolvedYearId);
        if (identity == null) return null;

        var clubIds = await GetDistrictClubIdsAsync(conn, districtId);
        if (clubIds.Count == 0)
            return new DistrictAdminOverviewResponse { District = identity };

        int activeClubs = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_master
            WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND IsActive = 1 AND COALESCE(ClubType,'') <> 'Rotaract Club'",
            new { DistrictId = districtId });

        // Honorary members are never counted as part of "Total Members" (business rule
        // 2026-08-25) — an honorary member is not an active member of the club.
        int totalMembers = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE c.fk_district_id = @DistrictId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
              AND cm.IsHonoraryMember = 0",
            new { DistrictId = districtId });

        var (start, end) = await YearRangeAsync(conn, resolvedYearId);
        int newMembers = 0, terminated = 0;
        if (start != null)
        {
            newMembers = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_members cm
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
                WHERE c.fk_district_id = @DistrictId AND cm.isdeleted = 0
                  AND cm.JoinedDate >= @Start AND cm.JoinedDate <= @End",
                new { DistrictId = districtId, Start = start, End = end });
            terminated = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_members cm
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
                WHERE c.fk_district_id = @DistrictId AND cm.isdeleted = 1
                  AND cm.deleted_date >= @Start AND cm.deleted_date <= @End",
                new { DistrictId = districtId, Start = start, End = end });
        }

        int totalMeetings = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_attendance a
            JOIN club_master c ON c.pk_club_id = a.fk_club_id AND c.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId AND a.isdeleted = 0
              AND (@YearId = 0 OR a.fk_year_id = @YearId)",
            new { DistrictId = districtId, YearId = resolvedYearId });

        int totalProjects = 0;
        var perClubProjects = new Dictionary<int, int>();
        var tables = await GetTargetTablesAsync(conn, resolvedYearId);
        foreach (var t in tables)
        {
            // Project count = the 5 service avenues only; Club Services (club meetings) are
            // counted separately in the Service Projects panel, so exclude them here.
            var rows = await conn.QueryAsync<(int clubId, int cnt)>(
                $@"SELECT p.fk_club_id, COUNT(*) AS cnt
                   FROM `{t.ProjectsTable}` p
                   JOIN club_master c ON c.pk_club_id = p.fk_club_id AND c.isdeleted = 0
                   LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
                   WHERE c.fk_district_id = @DistrictId AND p.isdeleted = 0
                     AND IFNULL(md.ModuleKey, '') <> 'club_service'
                   GROUP BY p.fk_club_id",
                new { DistrictId = districtId });
            foreach (var r in rows)
            {
                totalProjects += r.cnt;
                perClubProjects[r.clubId] = perClubProjects.GetValueOrDefault(r.clubId, 0) + r.cnt;
            }
        }

        decimal trfTotal = await conn.ExecuteScalarAsync<decimal?>(@"
            SELECT COALESCE(SUM(t.AmountUSD), 0) FROM trf_contributions t
            JOIN club_master c ON c.pk_club_id = t.fk_club_id AND c.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId AND t.isdeleted = 0
              AND (@YearId = 0 OR t.fk_year_id = @YearId)",
            new { DistrictId = districtId, YearId = resolvedYearId }) ?? 0;
        trfTotal *= USD_INR;

        decimal avgAttendance = await ComputeDistrictAvgAttendanceAsync(conn, districtId, resolvedYearId);

        decimal citation = await conn.ExecuteScalarAsync<decimal?>(@"
            SELECT COALESCE(SUM(points_earned), 0) + COALESCE(SUM(bonus_earned), 0)
            FROM district_citation_club_entry
            WHERE fk_district_id = @DistrictId AND isdeleted = 0
              AND (@YearId = 0 OR fk_year_id = @YearId)",
            new { DistrictId = districtId, YearId = resolvedYearId }) ?? 0;

        int annCount = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM announcements a
            JOIN club_master c ON c.pk_club_id = a.fk_club_id AND c.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId AND a.isdeleted = 0",
            new { DistrictId = districtId });
        int newsCount = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM newsletters n
            JOIN club_master c ON c.pk_club_id = n.fk_club_id AND COALESCE(c.isdeleted, 0) = 0
            WHERE c.fk_district_id = @DistrictId AND COALESCE(n.isdeleted, 0) = 0",
            new { DistrictId = districtId });
        int evCount = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM upcoming_events e
            JOIN club_master c ON c.pk_club_id = e.fk_club_id AND c.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId AND e.isdeleted = 0
              AND e.EventDate >= CURDATE()",
            new { DistrictId = districtId });

        // Top clubs by various metrics
        var clubStats = (await conn.QueryAsync<(int clubId, string clubName, int members, int meetings)>(@"
            SELECT c.pk_club_id, c.ClubName,
                   (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0 AND cm.IsHonoraryMember = 0) AS members,
                   (SELECT COUNT(*) FROM club_attendance a WHERE a.fk_club_id = c.pk_club_id AND a.isdeleted = 0 AND (@YearId = 0 OR a.fk_year_id = @YearId)) AS meetings
            FROM club_master c
            WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND COALESCE(c.ClubType,'') <> 'Rotaract Club'",
            new { DistrictId = districtId, YearId = resolvedYearId })).ToList();

        var perClubTrf = (await conn.QueryAsync<(int clubId, decimal totalUsd)>(@"
            SELECT t.fk_club_id, COALESCE(SUM(t.AmountUSD), 0) AS totalUsd
            FROM trf_contributions t
            JOIN club_master c ON c.pk_club_id = t.fk_club_id AND c.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId AND t.isdeleted = 0
              AND (@YearId = 0 OR t.fk_year_id = @YearId)
            GROUP BY t.fk_club_id",
            new { DistrictId = districtId, YearId = resolvedYearId })).ToDictionary(r => r.clubId, r => r.totalUsd);

        var allClubStats = clubStats.Select(c => new DistrictAdminClubStat
        {
            ClubId = c.clubId,
            ClubName = c.clubName,
            Members = c.members,
            Meetings = c.meetings,
            Projects = perClubProjects.GetValueOrDefault(c.clubId, 0),
            TrfInr = perClubTrf.GetValueOrDefault(c.clubId, 0) * USD_INR,
        }).ToList();

        // ── Wave 13A2 panels ────────────────────────────────────────────
        // Per-fund INR totals (used by TRF goal panel).
        var (annualInr, polioInr, endowInr, othersInr) = await ComputePerFundTotalsAsync(conn, districtId, resolvedYearId);

        var membershipGoal = await BuildMembershipGoalPanelAsync(conn, districtId, resolvedYearId, totalMembers, allClubStats);
        var trfGoal = await BuildTrfGoalPanelAsync(conn, districtId, resolvedYearId,
            trfTotal, annualInr, polioInr, endowInr, othersInr);
        var servicePanel = await BuildServiceProjectsPanelAsync(conn, districtId, resolvedYearId, totalProjects);
        var citationPanel = await BuildCitationPanelAsync(conn, districtId, resolvedYearId, clubIds.Count);

        // Club leaderboard — score = members*1 + trfInr/1000 + projects*5 + citation*2
        var leaderboard = await BuildClubLeaderboardAsync(conn, districtId, resolvedYearId, allClubStats);

        // ── Wave 13A4: additional overview UI slots ─────────────────────
        // Gender / honorary / inactive breakdown for the redesigned
        // Membership card. TotalMembers above only counts ACTIVE (IsActive=1)
        // rows — inactive rows exist as separate club_members rows with
        // IsActive=0 and are surfaced here.
        var memBreakdown = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT
                SUM(CASE WHEN cm.IsActive = 1 AND m.Gender = 'Male' THEN 1 ELSE 0 END) AS male,
                SUM(CASE WHEN cm.IsActive = 1 AND m.Gender = 'Female' THEN 1 ELSE 0 END) AS female,
                SUM(CASE WHEN cm.IsActive = 1 AND cm.IsHonoraryMember = 1 THEN 1 ELSE 0 END) AS honorary,
                SUM(CASE WHEN cm.IsActive = 0 THEN 1 ELSE 0 END) AS inactive
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId AND cm.isdeleted = 0",
            new { DistrictId = districtId });
        int male = (int)(long)(memBreakdown?.male ?? 0L);
        int female = (int)(long)(memBreakdown?.female ?? 0L);
        int honorary = (int)(long)(memBreakdown?.honorary ?? 0L);
        int inactive = (int)(long)(memBreakdown?.inactive ?? 0L);

        // PHF / Major Donor counts for the redesigned TRF card.
        // Same definitions as the Foundation page: PHF = distinct donors
        // with any positive contribution, Major = distinct donors with
        // AmountUSD ≥ 1000 (single receipt).
        int phfMembers = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(DISTINCT t.DonorName) FROM trf_contributions t
            JOIN club_master c ON c.pk_club_id = t.fk_club_id AND c.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId AND t.isdeleted = 0
              AND (@YearId = 0 OR t.fk_year_id = @YearId)
              AND t.AmountUSD > 0",
            new { DistrictId = districtId, YearId = resolvedYearId });
        int majorDonors = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(DISTINCT t.DonorName) FROM trf_contributions t
            JOIN club_master c ON c.pk_club_id = t.fk_club_id AND c.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId AND t.isdeleted = 0
              AND (@YearId = 0 OR t.fk_year_id = @YearId)
              AND t.AmountUSD >= 1000",
            new { DistrictId = districtId, YearId = resolvedYearId });

        // Fund-Type breakdown for the "TRF Contribution" panel.
        //
        // Show EVERY active fund from trf_fund_master (LEFT JOIN so funds
        // with zero contributions this year still surface as a row with
        // ₹0). trf_fund_master is a global admin-managed table (5 default
        // funds seeded, admins can add more via TRF Settings) — the panel
        // must reflect the complete fund catalogue, not just what's been
        // contributed to. Order by SortOrder so the panel matches the
        // sequence admins configured.
        //
        // For contributions pointing at the master "Others" fund, we do
        // NOT explode by OtherFundName here — the fund catalogue drives
        // rows, custom labels roll up under the single "Others" bucket.
        // Preferred display order for the 5 seeded default funds. The
        // seed data ships with a different SortOrder (Endowment=2, Polio=4)
        // but the user wants Polio to appear right after Annual — force
        // that sequence at query time regardless of what SortOrder was
        // saved. Any admin-added custom fund falls through the CASE to
        // the ELSE branch and appears after the 5 defaults, ordered by
        // its own SortOrder.
        var fundRows = (await conn.QueryAsync<(int fundId, string fundName, int sortOrder, decimal totalUsd)>(@"
            SELECT f.pk_fund_id AS fundId,
                   f.FundName AS fundName,
                   f.SortOrder AS sortOrder,
                   COALESCE(SUM(t.AmountUSD), 0) AS totalUsd
            FROM trf_fund_master f
            LEFT JOIN trf_contributions t
                   ON t.fk_fund_id = f.pk_fund_id
                  AND t.isdeleted = 0
                  AND (@YearId = 0 OR t.fk_year_id = @YearId)
                  AND EXISTS (
                      SELECT 1 FROM club_master c
                      WHERE c.pk_club_id = t.fk_club_id
                        AND c.fk_district_id = @DistrictId
                        AND c.isdeleted = 0
                  )
            WHERE f.IsActive = 1 AND f.isdeleted = 0
            GROUP BY f.pk_fund_id, f.FundName, f.SortOrder
            ORDER BY
                CASE f.FundName
                    WHEN 'Annual (Unrestricted)'      THEN 1
                    WHEN 'Polio'                      THEN 2
                    WHEN 'Endowment'                  THEN 3
                    WHEN 'Global Grant (Restricted)'  THEN 4
                    WHEN 'Others'                     THEN 5
                    ELSE 100
                END,
                f.SortOrder,
                f.FundName",
            new { DistrictId = districtId, YearId = resolvedYearId })).ToList();
        var fundBreakdown = fundRows
            .Select(r => new DistrictAdminFundBreakdownRow
            {
                FundName = string.IsNullOrWhiteSpace(r.fundName) ? "Others" : r.fundName,
                AmountInr = Math.Round(r.totalUsd * USD_INR),
            })
            .ToList();

        return new DistrictAdminOverviewResponse
        {
            District = identity,
            TotalClubs = clubIds.Count,
            ActiveClubs = activeClubs,
            TotalMembers = totalMembers,
            NewMembersThisYear = newMembers,
            TerminatedThisYear = terminated,
            TotalProjects = totalProjects,
            TotalMeetings = totalMeetings,
            AvgAttendance = avgAttendance,
            TrfTotalInr = trfTotal,
            DistrictCitationScore = citation,
            Announcements = annCount,
            Newsletters = newsCount,
            UpcomingEvents = evCount,
            TopClubsByMembers = allClubStats.OrderByDescending(c => c.Members).Take(5).ToList(),
            TopClubsByTrf = allClubStats.OrderByDescending(c => c.TrfInr).Take(5).ToList(),
            TopClubsByProjects = allClubStats.OrderByDescending(c => c.Projects).Take(5).ToList(),

            // ── new Wave 13A2 fields ───────────────────────────────────
            QualifiedCitationClubs = citationPanel.QualifiedClubs,
            MembershipGoal = membershipGoal,
            TrfGoal = trfGoal,
            ServiceProjects = servicePanel,
            Citation = citationPanel,
            Top20ClubsByMembers = allClubStats.OrderByDescending(c => c.Members).Take(20).ToList(),
            ClubLeaderboard = leaderboard,

            // ── Wave 13A4 fields (redesigned overview) ─────────────────
            MaleMembers = male,
            FemaleMembers = female,
            HonoraryMembers = honorary,
            InactiveMembers = inactive,
            PhfMembers = phfMembers,
            MajorDonors = majorDonors,
            FundTypeBreakdown = fundBreakdown,
        };
    }

    private async Task<decimal> ComputeDistrictAvgAttendanceAsync(MySqlConnection conn, int districtId, int yearId)
    {
        var rows = await conn.QueryAsync<(int total, int present)>(@"
            SELECT
                (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = a.fk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0) AS total,
                (SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) AS present
            FROM club_attendance a
            JOIN club_master c ON c.pk_club_id = a.fk_club_id AND c.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId AND a.isdeleted = 0
              AND (@YearId = 0 OR a.fk_year_id = @YearId)",
            new { DistrictId = districtId, YearId = yearId });
        var list = rows.Where(r => r.total > 0).ToList();
        if (list.Count == 0) return 0;
        return Math.Round(list.Average(r => (decimal)r.present / r.total * 100m), 1);
    }

    // ─── MEMBERSHIP ─────────────────────────────────────────────────────

    public async Task<DistrictAdminMembershipResponse?> GetMembershipAsync(int memberId, int? yearId, int? requestedDistrictId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        if (districtId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, districtId, resolvedYearId);
        if (identity == null) return null;

        // Multi-club counting rule (locked by user 2026-07-03): if a member
        // is in 10 clubs of the district, they count 10× in every KPI. So
        // COUNT(*) over club_members rows is the intended behaviour —
        // NOT COUNT(DISTINCT member_id). Applies to Total, Male, Female,
        // Honorary, New This Year, Terminated.
        var stats = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT SUM(CASE WHEN cm.IsHonoraryMember = 0 THEN 1 ELSE 0 END) AS total,
                   SUM(CASE WHEN m.Gender = 'Male' THEN 1 ELSE 0 END) AS male,
                   SUM(CASE WHEN m.Gender = 'Female' THEN 1 ELSE 0 END) AS female,
                   SUM(CASE WHEN cm.IsHonoraryMember = 1 THEN 1 ELSE 0 END) AS honorary
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId AND cm.IsActive = 1 AND cm.isdeleted = 0",
            new { DistrictId = districtId });

        // New / Terminated bounded by the Rotary year window (Jul 1 → Jun 30).
        // YearRangeAsync reads rotary_year_master.StartDate/EndDate — RY
        // start/end — so the JoinedDate BETWEEN filter is year-wise Jul-Jun
        // for the yearId passed on the query string. COUNT(*) so a member
        // who joined multiple clubs this year counts once per membership.
        var (start, end) = await YearRangeAsync(conn, resolvedYearId);
        int newMembers = 0, terminated = 0;
        if (start != null)
        {
            newMembers = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_members cm
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
                WHERE c.fk_district_id = @DistrictId AND cm.isdeleted = 0
                  AND cm.JoinedDate >= @Start AND cm.JoinedDate <= @End",
                new { DistrictId = districtId, Start = start, End = end });
            terminated = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_members cm
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
                WHERE c.fk_district_id = @DistrictId AND cm.isdeleted = 1
                  AND cm.deleted_date >= @Start AND cm.deleted_date <= @End",
                new { DistrictId = districtId, Start = start, End = end });
        }

        var clubBreakdown = (await conn.QueryAsync<DistrictAdminClubStat>(@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName,
                   (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0 AND cm.IsHonoraryMember = 0) AS members,
                   0 AS meetings, 0 AS projects, 0 AS trfInr
            FROM club_master c
            WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND COALESCE(c.ClubType,'') <> 'Rotaract Club'
            ORDER BY members DESC",
            new { DistrictId = districtId })).ToList();

        // Age groups (rough buckets from BirthDate)
        var ageGroups = new List<DistrictAdminMemberStat>();
        var ageRow = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT
                SUM(CASE WHEN YEAR(m.BirthDate) > 1900 AND TIMESTAMPDIFF(YEAR, m.BirthDate, CURDATE()) BETWEEN 18 AND 30 THEN 1 ELSE 0 END) AS g18_30,
                SUM(CASE WHEN YEAR(m.BirthDate) > 1900 AND TIMESTAMPDIFF(YEAR, m.BirthDate, CURDATE()) BETWEEN 31 AND 45 THEN 1 ELSE 0 END) AS g31_45,
                SUM(CASE WHEN YEAR(m.BirthDate) > 1900 AND TIMESTAMPDIFF(YEAR, m.BirthDate, CURDATE()) BETWEEN 46 AND 60 THEN 1 ELSE 0 END) AS g46_60,
                SUM(CASE WHEN YEAR(m.BirthDate) > 1900 AND TIMESTAMPDIFF(YEAR, m.BirthDate, CURDATE()) > 60 THEN 1 ELSE 0 END) AS g60_plus
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId AND cm.IsActive = 1 AND cm.isdeleted = 0",
            new { DistrictId = districtId });
        if (ageRow != null)
        {
            ageGroups.Add(new DistrictAdminMemberStat { Label = "18-30", Count = (int)(long)(ageRow.g18_30 ?? 0L) });
            ageGroups.Add(new DistrictAdminMemberStat { Label = "31-45", Count = (int)(long)(ageRow.g31_45 ?? 0L) });
            ageGroups.Add(new DistrictAdminMemberStat { Label = "46-60", Count = (int)(long)(ageRow.g46_60 ?? 0L) });
            ageGroups.Add(new DistrictAdminMemberStat { Label = "60+",   Count = (int)(long)(ageRow.g60_plus ?? 0L) });
        }

        var trend = new List<ClubAdminMemberGrowthPoint>();
        if (start != null)
        {
            for (int i = 0; i < 9; i++)
            {
                var ms = start.Value.AddMonths(i);
                var me = ms.AddMonths(1);
                var label = $"{MONTH_LABELS[i]} {ms:yyyy}";
                var gRow = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                    SELECT
                        SUM(CASE WHEN m.Gender = 'Male' THEN 1 ELSE 0 END) AS male,
                        SUM(CASE WHEN m.Gender = 'Female' THEN 1 ELSE 0 END) AS female,
                        SUM(CASE WHEN cm.IsHonoraryMember = 1 THEN 1 ELSE 0 END) AS honorary
                    FROM club_members cm
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                    JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
                    WHERE c.fk_district_id = @DistrictId AND cm.isdeleted = 0
                      AND cm.JoinedDate >= @Start AND cm.JoinedDate < @End",
                    new { DistrictId = districtId, Start = ms, End = me });
                trend.Add(new ClubAdminMemberGrowthPoint
                {
                    Month = label,
                    Male = (int)(long)(gRow?.male ?? 0L),
                    Female = (int)(long)(gRow?.female ?? 0L),
                    Honorary = (int)(long)(gRow?.honorary ?? 0L),
                });
            }
        }

        int totalCnt = (int)(long)(stats?.total ?? 0L);
        var membershipGoal = await BuildMembershipGoalPanelAsync(conn, districtId, resolvedYearId, totalCnt, clubBreakdown);
        var tabCounts = await BuildMembershipTabCountsAsync(conn, districtId, resolvedYearId);

        return new DistrictAdminMembershipResponse
        {
            District = identity,
            TotalMembers = totalCnt,
            MaleMembers = (int)(long)(stats?.male ?? 0L),
            FemaleMembers = (int)(long)(stats?.female ?? 0L),
            HonoraryMembers = (int)(long)(stats?.honorary ?? 0L),
            NewMembersThisYear = newMembers,
            TerminatedThisYear = terminated,
            ClubBreakdown = clubBreakdown,
            AgeGroups = ageGroups,
            MonthlyTrend = trend,

            // ── new Wave 13A2 fields ───────────────────────────────────
            ActiveMembers = totalCnt, // club_members.IsActive=1 was the filter above
            MembershipGoal = membershipGoal,
            TabCounts = tabCounts,
        };
    }

    // ─── FOUNDATION ─────────────────────────────────────────────────────

    public async Task<DistrictAdminFoundationResponse?> GetFoundationAsync(int memberId, int? yearId, int? requestedDistrictId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        if (districtId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, districtId, resolvedYearId);
        if (identity == null) return null;

        var rows = await conn.QueryAsync<(int clubId, string clubName, string? fundName, decimal totalUsd)>(@"
            SELECT t.fk_club_id, c.ClubName, COALESCE(f.FundName, t.OtherFundName, 'Other') AS fundName,
                   COALESCE(SUM(t.AmountUSD), 0) AS totalUsd
            FROM trf_contributions t
            JOIN club_master c ON c.pk_club_id = t.fk_club_id AND c.isdeleted = 0
            LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
            WHERE c.fk_district_id = @DistrictId AND t.isdeleted = 0
              AND (@YearId = 0 OR t.fk_year_id = @YearId)
            GROUP BY t.fk_club_id, c.ClubName, COALESCE(f.FundName, t.OtherFundName, 'Other')",
            new { DistrictId = districtId, YearId = resolvedYearId });

        var clubMap = new Dictionary<int, DistrictAdminFundClubRow>();
        decimal totalAnnual = 0, totalPolio = 0, totalEndowment = 0, totalOthers = 0, totalAll = 0;
        foreach (var r in rows)
        {
            if (!clubMap.TryGetValue(r.clubId, out var row))
            {
                row = new DistrictAdminFundClubRow { ClubId = r.clubId, ClubName = r.clubName };
                clubMap[r.clubId] = row;
            }
            var inr = r.totalUsd * USD_INR;
            var lower = (r.fundName ?? "").ToLowerInvariant();
            if (lower.Contains("annual")) { row.AnnualFund += inr; totalAnnual += inr; }
            else if (lower.Contains("polio")) { row.PolioFund += inr; totalPolio += inr; }
            else if (lower.Contains("endowment")) { row.Endowment += inr; totalEndowment += inr; }
            else { row.Others += inr; totalOthers += inr; }
            row.Total += inr;
            totalAll += inr;
        }

        int majorDonors = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(DISTINCT t.DonorName) FROM trf_contributions t
            JOIN club_master c ON c.pk_club_id = t.fk_club_id AND c.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId AND t.isdeleted = 0
              AND (@YearId = 0 OR t.fk_year_id = @YearId)
              AND t.AmountUSD >= 1000",
            new { DistrictId = districtId, YearId = resolvedYearId });
        int phf = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(DISTINCT t.DonorName) FROM trf_contributions t
            JOIN club_master c ON c.pk_club_id = t.fk_club_id AND c.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId AND t.isdeleted = 0
              AND (@YearId = 0 OR t.fk_year_id = @YearId)
              AND t.AmountUSD > 0",
            new { DistrictId = districtId, YearId = resolvedYearId });

        // ── Wave 13A2 panels ────────────────────────────────────────────
        var foundationGoal = await BuildFoundationGoalPanelAsync(conn, districtId, resolvedYearId);
        var districtProjectTargets = await BuildDistrictProjectTargetsAsync(conn, districtId, resolvedYearId);
        var districtEvents = await GetDistrictEventsAsync(conn, districtId, resolvedYearId, limit: 50);
        var projectFrequency = await GetProjectCompletionFrequencyAsync(conn, districtId, resolvedYearId);
        var allProjects = await GetAllDistrictProjectsAsync(conn, districtId, resolvedYearId, limit: 500);

        return new DistrictAdminFoundationResponse
        {
            District = identity,
            TotalInr = totalAll,
            AnnualFundInr = totalAnnual,
            PolioFundInr = totalPolio,
            EndowmentInr = totalEndowment,
            OthersInr = totalOthers,
            MajorDonors = majorDonors,
            PhfContributors = phf,
            ClubBreakdown = clubMap.Values.OrderByDescending(c => c.Total).ToList(),

            // ── new Wave 13A2 fields ───────────────────────────────────
            FoundationGoal = foundationGoal,
            DistrictProjectTargets = districtProjectTargets,
            DistrictEvents = districtEvents,
            ProjectFrequency = projectFrequency,
            AllProjects = allProjects,
        };
    }

    // ─── COMMUNICATION ──────────────────────────────────────────────────

    public async Task<DistrictAdminCommunicationResponse?> GetCommunicationAsync(int memberId, int? yearId, int? requestedDistrictId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        if (districtId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, districtId, resolvedYearId);
        if (identity == null) return null;

        // Communication tables (announcements, newsletters, upcoming_events, club_documents)
        // are shared between club and district scopes — each row is either
        // fk_club_id != NULL (club row) or fk_district_id != NULL (district row).
        // Dashboard tab-strip listings are district-only (fk_district_id = @DistrictId)
        // so the KPI counts must match — otherwise KPI shows club-aggregated data
        // while the list below it shows district-only rows (empty for most districts).
        //
        // Year filter: same tables have no fk_year_id, so we bound by
        // PublishDateTime/EventDate within the Rotary year window (1 Jul → 30 Jun).
        // yStart/yEnd null ⇒ no year filter.
        var (yearStart, yearEnd) = await YearRangeAsync(conn, resolvedYearId);
        var yStart = yearStart;
        var yEnd = yearEnd;

        var anns = (await conn.QueryAsync<dynamic>(@"
            SELECT a.Title AS title, a.PublishDateTime AS publishDate,
                   CASE WHEN a.ImagePath IS NULL OR a.ImagePath = '' THEN NULL
                        WHEN a.ImagePath LIKE '/%' THEN a.ImagePath
                        ELSE CONCAT('/Documents/announcement/Group', a.fk_district_id, '/', a.ImagePath) END AS imagePath
            FROM announcements a
            WHERE a.fk_district_id = @DistrictId AND a.isdeleted = 0
              AND (@YStart IS NULL OR a.PublishDateTime BETWEEN @YStart AND @YEnd)
            ORDER BY a.PublishDateTime DESC LIMIT 20",
            new { DistrictId = districtId, YStart = yStart, YEnd = yEnd })).ToList();

        var newsletters = (await conn.QueryAsync<dynamic>(@"
            SELECT n.Title AS title, n.PublishDateTime AS publishDate
            FROM newsletters n
            WHERE n.fk_district_id = @DistrictId AND COALESCE(n.isdeleted, 0) = 0
              AND (@YStart IS NULL OR n.PublishDateTime BETWEEN @YStart AND @YEnd)
            ORDER BY n.PublishDateTime DESC LIMIT 20",
            new { DistrictId = districtId, YStart = yStart, YEnd = yEnd })).ToList();

        // Upcoming events: when no year picked, keep the classic "future events" view.
        // When a year IS picked, show ALL events falling in that year's window
        // regardless of past/future — the topbar year selector is the source of truth.
        var events = (await conn.QueryAsync<dynamic>(@"
            SELECT e.Title AS title, e.EventDate AS publishDate, e.EventVenue AS venue
            FROM upcoming_events e
            WHERE e.fk_district_id = @DistrictId AND e.isdeleted = 0
              AND (
                (@YStart IS NULL AND e.EventDate >= CURDATE())
                OR (@YStart IS NOT NULL AND e.EventDate BETWEEN @YStart AND @YEnd)
              )
            ORDER BY e.EventDate ASC LIMIT 20",
            new { DistrictId = districtId, YStart = yStart, YEnd = yEnd })).ToList();

        DistrictAdminCommunicationItem Mk(dynamic r, string kind)
        {
            DateTime? d = r.publishDate is DateTime dd ? dd : (DateTime?)null;
            return new DistrictAdminCommunicationItem
            {
                Kind = kind,
                Title = (r.title as string) ?? "",
                // ClubName intentionally blank for district-scope rows.
                ClubName = "",
                PublishDate = d?.ToString("yyyy-MM-dd"),
                ImagePath = kind == "announcement" ? r.imagePath as string : null,
            };
        }

        var districtEvents = await GetDistrictEventsAsync(conn, districtId, resolvedYearId, limit: 50);
        var greetings = await GetGreetingsAsync(conn, districtId);
        var documents = await GetDistrictDocumentsAsync(conn, districtId, limit: 50);

        // Year-scoped counts, filtered by fk_district_id AND by "Published" status
        // so the KPI matches the tab-strip listings (which default to Published).
        // Status is derived the same way each Service.GetAllAsync derives it:
        //   Events / Announcements / Documents: Published iff
        //     NOW() BETWEEN PublishDate AND ExpiryDate
        //   Newsletters: Published iff NOW() >= PublishDateTime (no expiry)
        int announcementTotal = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM announcements a
            WHERE a.fk_district_id = @DistrictId AND a.isdeleted = 0
              AND NOW() >= a.PublishDateTime
              AND (a.ExpiryDateTime IS NULL OR NOW() <= a.ExpiryDateTime)
              AND (@YStart IS NULL OR a.PublishDateTime BETWEEN @YStart AND @YEnd)",
            new { DistrictId = districtId, YStart = yStart, YEnd = yEnd });

        int newsletterTotal = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM newsletters n
            WHERE n.fk_district_id = @DistrictId AND COALESCE(n.isdeleted, 0) = 0
              AND NOW() >= n.PublishDateTime
              AND (@YStart IS NULL OR n.PublishDateTime BETWEEN @YStart AND @YEnd)",
            new { DistrictId = districtId, YStart = yStart, YEnd = yEnd });

        int eventTotal = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM upcoming_events e
            WHERE e.fk_district_id = @DistrictId AND e.isdeleted = 0
              AND NOW() >= e.PublishDate
              AND (e.ExpiryDate IS NULL OR NOW() <= e.ExpiryDate)
              AND (@YStart IS NULL OR e.EventDate BETWEEN @YStart AND @YEnd)",
            new { DistrictId = districtId, YStart = yStart, YEnd = yEnd });

        // Documents: defensive — the club_documents table may be absent on
        // legacy installs. Also handles the case where the column set differs.
        int documentTotal = 0;
        try
        {
            documentTotal = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_documents d
                WHERE d.fk_district_id = @DistrictId AND d.isdeleted = 0
                  AND NOW() >= d.PublishDateTime
                  AND (d.ExpiryDateTime IS NULL OR NOW() <= d.ExpiryDateTime)
                  AND (@YStart IS NULL OR d.PublishDateTime BETWEEN @YStart AND @YEnd)",
                new { DistrictId = districtId, YStart = yStart, YEnd = yEnd });
        }
        catch { /* table missing — leave 0 */ }

        int greetingsToday = greetings.Count(g => g.Bucket == "today");

        return new DistrictAdminCommunicationResponse
        {
            District = identity,
            AnnouncementCount = announcementTotal,
            NewsletterCount = newsletterTotal,
            UpcomingEventCount = eventTotal,
            Announcements = anns.Select(r => Mk(r, "announcement")).ToList(),
            Newsletters = newsletters.Select(r => Mk(r, "newsletter")).ToList(),
            UpcomingEvents = events.Select(r => Mk(r, "event")).ToList(),

            // ── new Wave 13A2 fields ───────────────────────────────────
            DocumentCount = documentTotal,
            GreetingsTodayCount = greetingsToday,
            DistrictEvents = districtEvents,
            Greetings = greetings,
            Documents = documents,
        };
    }

    // ─── E-GOVERNANCE ───────────────────────────────────────────────────

    public async Task<DistrictAdminEGovernanceResponse?> GetEGovernanceAsync(int memberId, int? yearId, int? requestedDistrictId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        if (districtId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, districtId, resolvedYearId);
        if (identity == null) return null;

        var clubRows = (await conn.QueryAsync<DistrictAdminCmrClubRow>(@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName,
                   COALESCE((SELECT COUNT(*) FROM club_monthly_reports r WHERE r.fk_club_id = c.pk_club_id AND r.isdeleted = 0
                             AND (@YearId = 0 OR r.fk_year_id = @YearId) AND r.IsUploadedToDistrict = 1), 0) AS cmrsSubmitted,
                   COALESCE((SELECT COUNT(*) FROM club_monthly_reports r WHERE r.fk_club_id = c.pk_club_id AND r.isdeleted = 0
                             AND (@YearId = 0 OR r.fk_year_id = @YearId) AND r.IsUploadedToDistrict = 0), 0) AS cmrsPending,
                   COALESCE((SELECT COUNT(*) FROM club_attendance a WHERE a.fk_club_id = c.pk_club_id AND a.isdeleted = 0
                             AND (@YearId = 0 OR a.fk_year_id = @YearId)), 0) AS meetingsHeld,
                   0 AS avgAttendance
            FROM club_master c
            WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND COALESCE(c.ClubType,'') <> 'Rotaract Club'
            ORDER BY c.ClubName",
            new { DistrictId = districtId, YearId = resolvedYearId })).ToList();

        // Compute attendance per club (lightweight loop, max 100 clubs/district)
        foreach (var row in clubRows)
        {
            var attRows = await conn.QueryAsync<(int total, int present)>(@"
                SELECT
                    (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = a.fk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0) AS total,
                    (SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) AS present
                FROM club_attendance a
                WHERE a.fk_club_id = @ClubId AND a.isdeleted = 0
                  AND (@YearId = 0 OR a.fk_year_id = @YearId)",
                new { ClubId = row.ClubId, YearId = resolvedYearId });
            var list = attRows.Where(r => r.total > 0).ToList();
            row.AvgAttendance = list.Count == 0 ? 0 : Math.Round(list.Average(r => (decimal)r.present / r.total * 100m), 1);
        }

        int totalSubmitted = clubRows.Sum(r => r.CmrsSubmitted);
        int totalPending = clubRows.Sum(r => r.CmrsPending);
        int fullCompliance = clubRows.Count(r => r.CmrsPending == 0 && r.CmrsSubmitted > 0);
        int missingCmr = clubRows.Count(r => r.CmrsPending > 0);
        int totalMeetings = clubRows.Sum(r => r.MeetingsHeld);
        decimal avgAtt = await ComputeDistrictAvgAttendanceAsync(conn, districtId, resolvedYearId);

        // Per-month CMR submission breakdown — drives the "District Summary — By Month".
        // ReportMonth is the calendar month (7=Jul … 6=Jun). Submitted = uploaded to district.
        var monthAgg = (await conn.QueryAsync<(int reportMonth, int submitted)>(@"
            SELECT r.ReportMonth AS reportMonth,
                   SUM(CASE WHEN r.IsUploadedToDistrict = 1 THEN 1 ELSE 0 END) AS submitted
            FROM club_monthly_reports r
            JOIN club_master c ON c.pk_club_id = r.fk_club_id AND c.isdeleted = 0 AND c.fk_district_id = @DistrictId
            WHERE r.isdeleted = 0 AND (@YearId = 0 OR r.fk_year_id = @YearId)
            GROUP BY r.ReportMonth",
            new { DistrictId = districtId, YearId = resolvedYearId })).ToList();
        var monthMap = monthAgg.ToDictionary(x => x.reportMonth, x => x.submitted);
        int totalClubsCount = clubRows.Count;
        string[] fullMonthNames = { "", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December" };
        int[] rotaryOrder = { 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6 };
        var cmrMonthBreakdown = new List<DistrictAdminCmrMonthRow>();
        for (int idx = 0; idx < rotaryOrder.Length; idx++)
        {
            int cm = rotaryOrder[idx];
            int submittedThisMonth = monthMap.TryGetValue(cm, out var v) ? v : 0;
            cmrMonthBreakdown.Add(new DistrictAdminCmrMonthRow
            {
                Month = idx + 1,
                CalendarMonth = cm,
                Label = fullMonthNames[cm],
                Submitted = submittedThisMonth,
                OnTime = submittedThisMonth,
                Late = 0,
                Pending = Math.Max(0, totalClubsCount - submittedThisMonth),
                NotStarted = 0,
            });
        }

        // District Awards per-club totals — drives the District Awards sub-tab.
        var citationPerClub = await BuildCitationPerClubAsync(conn, districtId, resolvedYearId);

        // Average award score across clubs (clubs with zero entries excluded so
        // a sparsely-recorded district isn't dragged to ~0).
        var scoredClubs = citationPerClub.Where(c => c.TotalScore > 0).ToList();
        int avgCitation = scoredClubs.Count == 0
            ? 0
            : (int)Math.Round(scoredClubs.Average(c => (double)c.TotalScore));

        return new DistrictAdminEGovernanceResponse
        {
            District = identity,
            TotalCmrSubmitted = totalSubmitted,
            TotalCmrPending = totalPending,
            AvgAttendance = avgAtt,
            TotalMeetings = totalMeetings,
            ClubsWithFullCmrCompliance = fullCompliance,
            ClubsWithMissingCmr = missingCmr,
            ClubCompliance = clubRows,
            DistrictCitation = citationPerClub,
            AvgCitationScore = avgCitation,
            MonthlyReportsCount = totalSubmitted,
            CmrTotalClubs = totalClubsCount,
            CmrMonthBreakdown = cmrMonthBreakdown,
            CmrPerClubGrid = await BuildCmrPerClubGridAsync(conn, districtId, resolvedYearId),
            Kpis = new DistrictAdminEGovernanceKpis
            {
                MonthlyReports = totalSubmitted,
                AvgCitationScore = avgCitation,
            },
        };
    }

    // ════════════════════════════════════════════════════════════════════
    // Wave 13A2 — sub-endpoints
    // ════════════════════════════════════════════════════════════════════

    public async Task<DistrictAdminDirectoryPagedResponse?> GetMembershipDirectoryAsync(
        int memberId, int? yearId, int page, int pageSize, string? search,
        int? requestedDistrictId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        if (districtId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, districtId, resolvedYearId);
        if (identity == null) return null;

        if (page < 1) page = 1;
        if (pageSize < 1 || pageSize > 200) pageSize = 20;
        var offset = (page - 1) * pageSize;
        var like = string.IsNullOrWhiteSpace(search) ? null : $"%{search.Trim()}%";

        // Count distinct members in this district matching the search filter.
        int totalCount = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(DISTINCT m.pk_member_master_profile_id)
            FROM member_master_profile m
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                AND cm.IsActive = 1 AND cm.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId AND m.isdeleted = 0
              AND (@Like IS NULL OR m.MemberName LIKE @Like OR m.EmailId LIKE @Like
                   OR m.PrimaryMobileNumber LIKE @Like OR m.RotaryId LIKE @Like
                   OR c.ClubName LIKE @Like)",
            new { DistrictId = districtId, Like = like });

        var rows = (await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId,
                   m.MemberName AS name,
                   m.ProfilePhotoPath AS photoPath,
                   m.PrimaryMobileNumber AS mobile,
                   m.EmailId AS email,
                   m.RotaryId AS rotaryId,
                   m.Gender AS gender,
                   ANY_VALUE(c.pk_club_id) AS clubId,
                   ANY_VALUE(c.ClubName) AS clubName,
                   ANY_VALUE(cm.JoinedDate) AS joinedDate,
                   COALESCE((
                       SELECT GROUP_CONCAT(DISTINCT
                           CASE
                               WHEN r.RoleName = 'Admin' AND mr.fk_district_id > 0 AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0) THEN 'District Admin'
                               WHEN r.RoleName = 'Admin' AND mr.fk_club_id > 0 THEN 'Club Admin'
                               ELSE r.RoleName
                           END ORDER BY r.RoleName SEPARATOR ',')
                       FROM member_roles mr
                       JOIN roles r ON r.pk_role_id = mr.fk_role_id
                       WHERE mr.fk_member_master_profile_id = m.pk_member_master_profile_id
                         AND mr.IsActive = 1 AND mr.isdeleted = 0
                   ), 'Member') AS roles,
                   (SELECT COUNT(*) FROM member_roles mr2
                     WHERE mr2.fk_member_master_profile_id = m.pk_member_master_profile_id
                       AND mr2.fk_role_id = 2
                       AND mr2.fk_district_id = @DistrictId
                       AND (mr2.fk_club_id IS NULL OR mr2.fk_club_id = 0)
                       AND mr2.IsActive = 1 AND mr2.isdeleted = 0) AS isDistrictAdminFlag,
                   (SELECT COUNT(*) FROM member_roles mr3
                     WHERE mr3.fk_member_master_profile_id = m.pk_member_master_profile_id
                       AND mr3.fk_role_id = 2
                       AND mr3.fk_club_id > 0
                       AND mr3.IsActive = 1 AND mr3.isdeleted = 0) AS isClubAdminFlag
            FROM member_master_profile m
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                AND cm.IsActive = 1 AND cm.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId AND m.isdeleted = 0
              AND (@Like IS NULL OR m.MemberName LIKE @Like OR m.EmailId LIKE @Like
                   OR m.PrimaryMobileNumber LIKE @Like OR m.RotaryId LIKE @Like
                   OR c.ClubName LIKE @Like)
            GROUP BY m.pk_member_master_profile_id
            ORDER BY m.MemberName
            LIMIT @PageSize OFFSET @Offset",
            new { DistrictId = districtId, Like = like, PageSize = pageSize, Offset = offset })).ToList();

        var items = rows.Select(r =>
        {
            var rolesCsv = (r.roles as string) ?? "Member";
            var primary = rolesCsv.Split(',').FirstOrDefault() ?? "Member";
            bool honorary = false;
            try { honorary = Convert.ToInt32(r.isHonorary) == 1; } catch { }
            DateTime? jd = r.joinedDate is DateTime dd ? dd : (DateTime?)null;
            return new DistrictAdminDirectoryMemberRow
            {
                MemberId = (int)r.memberId,
                Name = (r.name as string) ?? "",
                PhotoPath = r.photoPath as string,
                Mobile = r.mobile as string,
                Email = r.email as string,
                RotaryId = r.rotaryId as string,
                Gender = r.gender as string,
                ClubId = r.clubId == null ? null : (int?)r.clubId,
                ClubName = r.clubName as string,
                Role = primary,
                Status = honorary ? "Honorary" : "Active",
                IsHonorary = honorary,
                IsDistrictAdmin = (int)(long)(r.isDistrictAdminFlag ?? 0L) > 0,
                IsClubAdmin = (int)(long)(r.isClubAdminFlag ?? 0L) > 0,
                JoinedDate = jd?.ToString("yyyy-MM-dd"),
            };
        }).ToList();

        return new DistrictAdminDirectoryPagedResponse
        {
            District = identity,
            Page = page,
            PageSize = pageSize,
            TotalCount = totalCount,
            TotalPages = (int)Math.Ceiling(totalCount / (double)pageSize),
            Items = items,
        };
    }

    // District-wide Rotary Network: same Terminated/Potential shape as the club-level
    // page, aggregated across every club in the district, each row carrying its club.
    public async Task<DistrictAdminRotaryNetworkResponse?> GetRotaryNetworkAsync(
        int memberId, int? yearId, string? search, int? clubId, int? requestedDistrictId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        if (districtId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, districtId, resolvedYearId);
        if (identity == null) return null;

        var like = string.IsNullOrWhiteSpace(search) ? null : $"%{search.Trim()}%";

        // A terminated row must carry a real termination date + reason — an
        // inactive/deleted club_members row with neither is some other kind of
        // removal (data cleanup, transfer, etc.), not an actual termination.
        // memberType is blank for non-honorary rows — "Active" is misleading here.
        // Clubs that already have a rotary_org_terminated_cache entry are excluded here —
        // the cache (Rotary.org's own record, written through by the live-fetch/refresh
        // flows) is more complete/authoritative, so it takes over entirely for that club
        // rather than merging row-by-row.
        var terminatedRows = (await conn.QueryAsync<dynamic>(@"
            SELECT cm.pk_club_member_id AS id,
                   c.pk_club_id AS clubId, c.ClubName AS clubName,
                   m.RotaryId AS rotaryId,
                   CASE WHEN COALESCE(cm.IsHonoraryMember, 0) = 1 THEN 'Honorary' ELSE '' END AS memberType,
                   m.MemberName AS fullName,
                   DATE_FORMAT(cm.JoinedDate, '%Y-%m-%d') AS admissionDate,
                   DATE_FORMAT(cm.TerminationDate, '%Y-%m-%d') AS terminationDate,
                   COALESCE(cm.TerminationReason, '') AS terminationReason,
                   m.PrimaryMobileNumber AS mobile,
                   m.EmailId AS email
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.fk_district_id = @DistrictId AND c.isdeleted = 0
            WHERE (cm.IsActive = 0 OR cm.isdeleted = 1)
              AND cm.TerminationDate IS NOT NULL
              AND cm.TerminationReason IS NOT NULL AND cm.TerminationReason <> ''
              AND (@ClubId IS NULL OR c.pk_club_id = @ClubId)
              AND (@Like IS NULL OR m.MemberName LIKE @Like OR m.EmailId LIKE @Like
                   OR m.PrimaryMobileNumber LIKE @Like OR cm.TerminationReason LIKE @Like OR c.ClubName LIKE @Like)
              AND NOT EXISTS (
                    SELECT 1 FROM rotary_org_terminated_cache t
                    WHERE c.ClubRotaryId REGEXP '^[0-9]+$' AND t.fk_rotary_club_id = CAST(c.ClubRotaryId AS UNSIGNED))
            ORDER BY cm.TerminationDate DESC, m.MemberName",
            new { DistrictId = districtId, ClubId = clubId, Like = like })).ToList();

        // Cached Rotary.org terminated members — fast (no live calls), populated by the
        // club-level live fetch and the district-wide batched refresh. This is now the
        // PRIMARY source for any club that's been refreshed at least once.
        var cachedRows = (await conn.QueryAsync<dynamic>(@"
            SELECT t.pk_id AS id,
                   c.pk_club_id AS clubId, c.ClubName AS clubName,
                   CAST(t.RotaryMemberId AS CHAR) AS rotaryId,
                   COALESCE(t.MemberType, '') AS memberType,
                   COALESCE(NULLIF(t.LocalizedName, ''),
                            TRIM(CONCAT_WS(' ', NULLIF(t.FirstName,''), NULLIF(t.MiddleName,''), NULLIF(t.LastName,'')))) AS fullName,
                   DATE_FORMAT(t.AdmissionDate, '%Y-%m-%d') AS admissionDate,
                   DATE_FORMAT(t.TerminationDate, '%Y-%m-%d') AS terminationDate,
                   COALESCE(t.TerminationReason, '') AS terminationReason
            FROM rotary_org_terminated_cache t
            JOIN club_master c ON c.ClubRotaryId = CAST(t.fk_rotary_club_id AS CHAR) AND c.fk_district_id = @DistrictId AND c.isdeleted = 0
            WHERE (@ClubId IS NULL OR c.pk_club_id = @ClubId)
              AND (@Like IS NULL OR t.FirstName LIKE @Like OR t.LastName LIKE @Like OR t.LocalizedName LIKE @Like
                   OR t.TerminationReason LIKE @Like OR c.ClubName LIKE @Like)
            ORDER BY t.TerminationDate DESC",
            new { DistrictId = districtId, ClubId = clubId, Like = like })).ToList();

        // Display-only enrichment: mobile/email for cache-sourced rows from our own
        // already-stored member_master_profile by RotaryId (the cache table carries no
        // contact info itself).
        var cacheRotaryIds = cachedRows.Select(r => (string)r.rotaryId).Distinct().ToList();
        var cacheContacts = cacheRotaryIds.Count == 0
            ? new Dictionary<string, (string? Mobile, string? Email)>()
            : (await conn.QueryAsync<(string RotaryId, string? Mobile, string? Email)>(@"
                SELECT RotaryId, PrimaryMobileNumber AS Mobile, EmailId AS Email
                FROM member_master_profile WHERE isdeleted = 0 AND RotaryId IN @Ids",
                new { Ids = cacheRotaryIds })).ToDictionary(x => x.RotaryId, x => (x.Mobile, x.Email));

        // Potential members: table may not exist on every DB; treat as empty on failure.
        var potentialRows = new List<dynamic>();
        try
        {
            potentialRows = (await conn.QueryAsync<dynamic>(@"
                SELECT pm.pk_potential_member_id AS id,
                       c.pk_club_id AS clubId, c.ClubName AS clubName,
                       pm.name AS fullName,
                       pm.email AS email,
                       pm.mobile_number AS mobile,
                       pm.reference_details AS referenceDetails,
                       DATE_FORMAT(pm.created_date, '%Y-%m-%d') AS admissionDate
                FROM potential_members pm
                JOIN club_master c ON c.pk_club_id = pm.fk_club_id AND c.fk_district_id = @DistrictId AND c.isdeleted = 0
                WHERE COALESCE(pm.isdeleted, 0) = 0
                  AND (@ClubId IS NULL OR c.pk_club_id = @ClubId)
                  AND (@Like IS NULL OR pm.name LIKE @Like OR pm.email LIKE @Like
                       OR pm.mobile_number LIKE @Like OR pm.reference_details LIKE @Like OR c.ClubName LIKE @Like)
                ORDER BY pm.pk_potential_member_id DESC",
                new { DistrictId = districtId, ClubId = clubId, Like = like })).ToList();
        }
        catch { /* table may not exist on every DB */ }

        var terminated = terminatedRows.Select(r => SplitDistrictRotaryNetworkRow(
            (r.fullName as string) ?? "", (r.memberType as string) ?? "Active", r.rotaryId as string,
            r.admissionDate as string, r.terminationDate as string, (r.terminationReason as string) ?? "",
            (long)r.id, "Terminated", (int)r.clubId, (r.clubName as string) ?? "",
            r.mobile as string, r.email as string)).ToList();

        foreach (var r in cachedRows)
        {
            var rotaryId = (string)r.rotaryId;
            cacheContacts.TryGetValue(rotaryId, out var contact);
            terminated.Add(SplitDistrictRotaryNetworkRow(
                (r.fullName as string) ?? "", (r.memberType as string) ?? "", rotaryId,
                r.admissionDate as string, r.terminationDate as string, (r.terminationReason as string) ?? "",
                (long)r.id, "Terminated", (int)r.clubId, (r.clubName as string) ?? "",
                contact.Mobile, contact.Email));
        }
        terminated = terminated.OrderByDescending(r => r.TerminationDate).ThenBy(r => r.ClubName).ToList();

        var potential = potentialRows.Select(r => SplitDistrictRotaryNetworkRow(
            (r.fullName as string) ?? "", "Potential", null,
            r.admissionDate as string, null, "",
            (long)r.id, "Potential", (int)r.clubId, (r.clubName as string) ?? "",
            r.mobile as string, r.email as string, r.referenceDetails as string)).ToList();

        var clubs = (await conn.QueryAsync<DistrictAdminRotaryNetworkClubOption>(@"
            SELECT pk_club_id AS ClubId, ClubName AS ClubName
            FROM club_master
            WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND IsActive = 1 AND COALESCE(ClubType,'') <> 'Rotaract Club'
            ORDER BY ClubName",
            new { DistrictId = districtId })).ToList();

        return new DistrictAdminRotaryNetworkResponse
        {
            District = identity,
            TotalTerminated = terminated.Count,
            TotalPotential = potential.Count,
            TerminatedMembers = terminated,
            PotentialMembers = potential,
            Clubs = clubs,
        };
    }

    private static DistrictAdminRotaryNetworkRow SplitDistrictRotaryNetworkRow(
        string fullName, string memberType, string? rotaryId,
        string? admissionDate, string? terminationDate, string terminationReason,
        long id, string status, int clubId, string clubName,
        string? mobile = null, string? email = null, string? notes = null)
    {
        var parts = (fullName ?? "").Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        string first = parts.Length > 0 ? parts[0] : "";
        string last = parts.Length > 1 ? parts[^1] : "";
        string middle = parts.Length > 2 ? string.Join(' ', parts[1..^1]) : "";
        return new DistrictAdminRotaryNetworkRow
        {
            Id = (int)id,
            ClubId = clubId,
            ClubName = clubName,
            MemberId = rotaryId ?? "",
            MemberType = memberType,
            FirstName = first,
            MiddleName = middle,
            LastName = last,
            AdmissionDate = admissionDate,
            TerminationDate = terminationDate,
            TerminationReason = terminationReason,
            Status = status,
            Mobile = mobile,
            Email = email,
            Notes = notes,
        };
    }

    // Live Rotary.org terminated members for ONE club (fast path for the club-filtered view) —
    // fetches live, writes through to rotary_org_terminated_cache, and returns the fresh data.
    // Fanning this out across every club in a district at once was the old behaviour and it's
    // what broke (too slow / too many concurrent Rotary.org calls at once) — the district-wide
    // "all clubs" case is now served from the cache (see GetRotaryNetworkAsync) plus the
    // separate batched RefreshLiveTerminatedBatchAsync for progressively warming that cache.
    public async Task<DistrictAdminLiveTerminatedResponse> GetLiveTerminatedMembersAsync(
        int memberId, int? requestedDistrictId, int? clubId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        if (districtId == 0) return new DistrictAdminLiveTerminatedResponse { Warning = "No district admin assignment found." };

        if (clubId is null)
            return new DistrictAdminLiveTerminatedResponse { Warning = "Pick a specific club to fetch live — browsing all clubs reads from the last-refreshed cache instead." };

        var club = await conn.QueryFirstOrDefaultAsync<(int ClubId, string ClubName, string? ClubRotaryId, string? ClubType)>(@"
            SELECT pk_club_id AS ClubId, ClubName, ClubRotaryId, ClubType
            FROM club_master
            WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND IsActive = 1 AND pk_club_id = @ClubId AND COALESCE(ClubType,'') <> 'Rotaract Club'",
            new { DistrictId = districtId, ClubId = clubId });
        if (club.ClubId == 0)
            return new DistrictAdminLiveTerminatedResponse { Warning = "Club not found in this district." };
        if (!int.TryParse(club.ClubRotaryId, out var rotaryOrgClubId) || rotaryOrgClubId <= 0)
            return new DistrictAdminLiveTerminatedResponse { ClubsSkippedNoRotaryId = 1, Warning = $"{club.ClubName} is not linked to Rotary.org (missing ClubRotaryId)." };

        var clubType = string.IsNullOrWhiteSpace(club.ClubType) ? "Rotary Club" : club.ClubType!;
        List<RotaryOrgClubMemberDto> list;
        try
        {
            list = await _rotaryOrgClient.GetClubTerminatedMembersAsync(clubType, rotaryOrgClubId);
        }
        catch (Exception ex)
        {
            return new DistrictAdminLiveTerminatedResponse { Warning = $"Failed to fetch {club.ClubName} from Rotary.org: {ex.Message}" };
        }

        try { await RotaryOrgTerminatedCacheHelper.UpsertAsync(conn, rotaryOrgClubId, list); }
        catch { /* best-effort cache write; the live response still succeeds */ }

        var rows = list.Select(m => SplitDistrictRotaryNetworkRow(
            string.Join(" ", new[] { m.FirstName, m.MiddleName, m.LastName }.Where(s => !string.IsNullOrWhiteSpace(s))),
            m.MemberType ?? "", m.MemberId.ToString(),
            m.AdmissionDate?.ToString("yyyy-MM-dd"), m.TerminationDate?.ToString("yyyy-MM-dd"), m.TerminationReason ?? "",
            m.MemberId % int.MaxValue, "Terminated", club.ClubId, club.ClubName)).ToList();

        // Display-only enrichment: mobile/email from our own already-stored member_master_profile
        // by RotaryId (the cache table itself carries no contact info).
        var rotaryIds = rows.Select(r => r.MemberId).Where(s => !string.IsNullOrEmpty(s)).Distinct().ToList();
        if (rotaryIds.Count > 0)
        {
            var contacts = (await conn.QueryAsync<(string RotaryId, string? Mobile, string? Email)>(@"
                SELECT RotaryId, PrimaryMobileNumber AS Mobile, EmailId AS Email
                FROM member_master_profile WHERE isdeleted = 0 AND RotaryId IN @Ids",
                new { Ids = rotaryIds })).ToDictionary(x => x.RotaryId, x => (x.Mobile, x.Email));
            foreach (var r in rows)
            {
                if (contacts.TryGetValue(r.MemberId, out var c))
                {
                    r.Mobile = c.Mobile;
                    r.Email = c.Email;
                }
            }
        }

        return new DistrictAdminLiveTerminatedResponse
        {
            Members = rows.OrderByDescending(r => r.TerminationDate).ToList(),
            ClubsQueried = 1,
        };
    }

    // Thin public wrapper around the private district-resolution rules, for callers (like the
    // background refresh job's controller endpoints) that need the same admin-scoping/
    // authorization behaviour without pulling in a whole dashboard response.
    public async Task<int> ResolveDistrictIdForMemberAsync(int memberId, int? requestedDistrictId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        return await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
    }

    public async Task<DistrictAdminCmrPerClubGridResponse?> GetEGovernancePerClubGridAsync(
        int memberId, int? yearId, int? requestedDistrictId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        if (districtId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, districtId, resolvedYearId);
        if (identity == null) return null;

        var rows = await BuildCmrPerClubGridAsync(conn, districtId, resolvedYearId);
        return new DistrictAdminCmrPerClubGridResponse { District = identity, Rows = rows };
    }

    // ════════════════════════════════════════════════════════════════════
    // Wave 13A2 — Panel builders (used by GetOverview/Membership/Foundation/Communication/EGovernance)
    // ════════════════════════════════════════════════════════════════════

    private async Task<(decimal annual, decimal polio, decimal endow, decimal others)>
        ComputePerFundTotalsAsync(MySqlConnection conn, int districtId, int yearId)
    {
        var rows = await conn.QueryAsync<(string? fundName, decimal totalUsd)>(@"
            SELECT COALESCE(f.FundName, t.OtherFundName, 'Other') AS fundName,
                   COALESCE(SUM(t.AmountUSD), 0) AS totalUsd
            FROM trf_contributions t
            JOIN club_master c ON c.pk_club_id = t.fk_club_id AND c.isdeleted = 0
            LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
            WHERE c.fk_district_id = @DistrictId AND t.isdeleted = 0
              AND (@YearId = 0 OR t.fk_year_id = @YearId)
            GROUP BY COALESCE(f.FundName, t.OtherFundName, 'Other')",
            new { DistrictId = districtId, YearId = yearId });
        decimal a = 0, p = 0, e = 0, o = 0;
        foreach (var r in rows)
        {
            var inr = r.totalUsd * USD_INR;
            var lower = (r.fundName ?? "").ToLowerInvariant();
            if (lower.Contains("annual")) a += inr;
            else if (lower.Contains("polio")) p += inr;
            else if (lower.Contains("endowment")) e += inr;
            else o += inr;
        }
        return (a, p, e, o);
    }

    // Reads from district_membership_goal (Wave 13A3 — same table; we just SELECT here).
    private async Task<DistrictAdminMembershipGoalPanel> BuildMembershipGoalPanelAsync(
        MySqlConnection conn, int districtId, int yearId, int currentCount,
        IEnumerable<DistrictAdminClubStat> clubStats)
    {
        int? target = null;
        try
        {
            target = await conn.ExecuteScalarAsync<int?>(@"
                SELECT target_total FROM district_membership_goal
                WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId AND isdeleted = 0
                LIMIT 1",
                new { DistrictId = districtId, YearId = yearId });
        }
        catch { /* table not yet created by Wave 13A3 */ }

        return new DistrictAdminMembershipGoalPanel
        {
            Current = currentCount,
            Target = target,
            Delta = target.HasValue ? (currentCount - target.Value) : 0,
            IsPending = !target.HasValue,
            TopClubs = clubStats.OrderByDescending(c => c.Members).Take(10).ToList(),
        };
    }

    // Reads from district_foundation_goal (Wave 13A3).
    private async Task<DistrictAdminFoundationGoalPanel> BuildFoundationGoalPanelAsync(
        MySqlConnection conn, int districtId, int yearId)
    {
        try
        {
            var row = await conn.QueryFirstOrDefaultAsync<(decimal? annual, decimal? polio, decimal? endow, decimal? other)?>(@"
                SELECT target_annual_fund_usd, target_polio_fund_usd,
                       target_endowment_fund_usd, target_other_fund_usd
                FROM district_foundation_goal
                WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId AND isdeleted = 0
                LIMIT 1",
                new { DistrictId = districtId, YearId = yearId });
            if (row != null)
            {
                var (a, p, e, o) = row.Value;
                decimal? aInr = a.HasValue ? a.Value * USD_INR : null;
                decimal? pInr = p.HasValue ? p.Value * USD_INR : null;
                decimal? eInr = e.HasValue ? e.Value * USD_INR : null;
                decimal? oInr = o.HasValue ? o.Value * USD_INR : null;
                decimal? totalInr = (aInr ?? 0) + (pInr ?? 0) + (eInr ?? 0) + (oInr ?? 0);
                return new DistrictAdminFoundationGoalPanel
                {
                    TotalTargetInr = totalInr == 0 ? null : totalInr,
                    AnnualTargetInr = aInr,
                    PolioTargetInr = pInr,
                    EndowmentTargetInr = eInr,
                    OthersTargetInr = oInr,
                    IsPending = false,
                };
            }
        }
        catch { /* table not yet created */ }
        return new DistrictAdminFoundationGoalPanel { IsPending = true };
    }

    private async Task<DistrictAdminTrfGoalPanel> BuildTrfGoalPanelAsync(
        MySqlConnection conn, int districtId, int yearId,
        decimal totalRaisedInr, decimal annualInr, decimal polioInr, decimal endowInr, decimal othersInr)
    {
        var goal = await BuildFoundationGoalPanelAsync(conn, districtId, yearId);
        decimal pct = goal.TotalTargetInr.GetValueOrDefault() == 0 ? 0
            : Math.Round(totalRaisedInr / goal.TotalTargetInr!.Value * 100m, 1);
        return new DistrictAdminTrfGoalPanel
        {
            TotalTargetInr = goal.TotalTargetInr,
            RaisedInr = totalRaisedInr,
            RemainingInr = Math.Max(0, goal.TotalTargetInr.GetValueOrDefault() - totalRaisedInr),
            PercentAchieved = pct,
            IsPending = goal.IsPending,
            AnnualFundInr = annualInr,
            PolioFundInr = polioInr,
            EndowmentInr = endowInr,
            OthersInr = othersInr,
            AnnualTargetInr = goal.AnnualTargetInr,
            PolioTargetInr = goal.PolioTargetInr,
            EndowmentTargetInr = goal.EndowmentTargetInr,
            OthersTargetInr = goal.OthersTargetInr,
        };
    }

    // Service Projects panel: per-avenue completed counts + targets from district_project_target.
    private async Task<DistrictAdminServiceProjectsPanel> BuildServiceProjectsPanelAsync(
        MySqlConnection conn, int districtId, int yearId, int totalProjects)
    {
        var avenueCounts = new Dictionary<string, int>();
        var tables = await GetTargetTablesAsync(conn, yearId);
        foreach (var t in tables)
        {
            var rows = await conn.QueryAsync<(string? key, int cnt)>(
                $@"SELECT md.ModuleKey AS k, COUNT(*) AS cnt
                   FROM `{t.ProjectsTable}` p
                   JOIN club_master c ON c.pk_club_id = p.fk_club_id AND c.isdeleted = 0
                   LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
                   WHERE c.fk_district_id = @DistrictId AND p.isdeleted = 0
                   GROUP BY md.ModuleKey",
                new { DistrictId = districtId });
            foreach (var r in rows)
            {
                var k = r.key ?? "";
                avenueCounts[k] = avenueCounts.GetValueOrDefault(k, 0) + r.cnt;
            }
        }

        var targets = new Dictionary<string, int>();
        bool targetsPending = true;
        try
        {
            var trows = await conn.QueryAsync<(string? moduleKey, int target)>(@"
                SELECT md.ModuleKey AS k, t.target_count AS target
                FROM district_project_target t
                JOIN module_master md ON md.pk_module_id = t.fk_module_id
                WHERE t.fk_district_id = @DistrictId AND t.fk_year_id = @YearId AND t.isdeleted = 0",
                new { DistrictId = districtId, YearId = yearId });
            foreach (var t in trows)
            {
                if (!string.IsNullOrEmpty(t.moduleKey))
                {
                    targets[t.moduleKey] = t.target;
                    targetsPending = false;
                }
            }
        }
        catch { /* table not yet created */ }

        var avenueRows = new List<DistrictAdminServiceAvenuePanelRow>();
        foreach (var (key, label) in AVENUE_KEYS)
        {
            int completed = avenueCounts.GetValueOrDefault(key, 0);
            int? target = targets.TryGetValue(key, out var tv) ? tv : (int?)null;
            decimal pct = target.GetValueOrDefault() == 0 ? 0
                : Math.Round((decimal)completed / target!.Value * 100m, 1);
            avenueRows.Add(new DistrictAdminServiceAvenuePanelRow
            {
                AvenueKey = key,
                AvenueName = label,
                Completed = completed,
                Target = target,
                PercentAchieved = pct,
                IsPending = !target.HasValue,
            });
        }

        return new DistrictAdminServiceProjectsPanel
        {
            TotalProjects = totalProjects,
            // Club Services = club-meeting count (module key 'club_service'), shown alongside
            // the 5 service avenues in the panel but excluded from TotalProjects.
            ClubServicesCount = avenueCounts.GetValueOrDefault("club_service", 0),
            TotalTarget = targets.Count == 0 ? null : targets.Values.Sum(),
            IsPending = targetsPending,
            Avenues = avenueRows,
        };
    }

    private async Task<DistrictAdminCitationPanel> BuildCitationPanelAsync(
        MySqlConnection conn, int districtId, int yearId, int totalClubs)
    {
        decimal totalPoints = 0;
        int qualifiedClubs = 0;
        var categories = new List<DistrictAdminCitationCategoryRow>();

        try
        {
            // ONE ROW PER CATEGORY defined for this district+year.
            //
            // Driving table is district_citation_category so every category
            // shows up regardless of whether any club has entries yet —
            // matches the /districts/{id}/citation Categories tab. Left joins
            // add:
            //   • per-category MaxPoints  (sum of max reachable points from
            //                              district_citation_auto_question)
            //   • per-category PointsEarned (aggregated across every club in
            //                               the district from
            //                               district_citation_club_entry —
            //                               points_earned + bonus_earned)
            // Rows are ordered by sort_order to match the Categories tab.
            var catRows = await conn.QueryAsync<(int catId, string catName, int sortOrder, decimal maxPoints, decimal points)>(@"
                SELECT c.pk_id AS catId,
                       c.category_name AS catName,
                       c.sort_order AS sortOrder,
                       COALESCE(qmax.max_points, 0) AS maxPoints,
                       COALESCE(ep.points_earned, 0) AS points
                FROM district_citation_category c
                LEFT JOIN (
                    SELECT q.fk_category_id AS catId,
                           SUM(COALESCE(q.points, 0) + COALESCE(q.bonus_points, 0)) AS max_points
                    FROM district_citation_auto_question q
                    WHERE q.fk_district_id = @DistrictId
                      AND q.isdeleted = 0
                      AND (@YearId = 0 OR q.fk_year_id = @YearId)
                    GROUP BY q.fk_category_id
                ) qmax ON qmax.catId = c.pk_id
                LEFT JOIN (
                    -- Category-level points aggregated across every club in
                    -- the district. UNION of auto entries (joined to
                    -- district_citation_auto_question) and manual entries
                    -- (joined to district_citation_manual_sub_criteria +
                    -- district_citation_manual_criteria). Each join is
                    -- fixed to the SAME district+year to drop orphan
                    -- entries — matches the Club Points tab logic on
                    -- /districts/{id}/citation.
                    SELECT catId, SUM(points_earned) AS points_earned FROM (
                        SELECT q.fk_category_id AS catId,
                               (e.points_earned + e.bonus_earned) AS points_earned
                        FROM district_citation_club_entry e
                        INNER JOIN district_citation_auto_question q
                            ON q.pk_id = e.fk_question_id
                           AND q.fk_district_id = @DistrictId
                           AND q.fk_year_id     = @YearId
                           AND q.isdeleted = 0
                        WHERE e.fk_district_id = @DistrictId
                          AND e.fk_year_id     = @YearId
                          AND e.entry_type = 'auto' AND e.isdeleted = 0
                        UNION ALL
                        SELECT mc.fk_category_id AS catId,
                               (e.points_earned + e.bonus_earned) AS points_earned
                        FROM district_citation_club_entry e
                        INNER JOIN district_citation_manual_sub_criteria sc
                            ON sc.pk_id = e.fk_question_id AND sc.isdeleted = 0
                        INNER JOIN district_citation_manual_criteria mc
                            ON mc.pk_id = sc.fk_criteria_id
                           AND mc.fk_district_id = @DistrictId
                           AND mc.fk_year_id     = @YearId
                           AND mc.isdeleted = 0
                        WHERE e.fk_district_id = @DistrictId
                          AND e.fk_year_id     = @YearId
                          AND e.entry_type = 'manual' AND e.isdeleted = 0
                    ) t
                    GROUP BY catId
                ) ep ON ep.catId = c.pk_id
                WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0
                  AND (@YearId = 0 OR c.fk_year_id = @YearId)
                ORDER BY c.sort_order, c.category_name",
                new { DistrictId = districtId, YearId = yearId });

            var catMap = new Dictionary<int, DistrictAdminCitationCategoryRow>();
            foreach (var r in catRows)
            {
                totalPoints += r.points;
                var row = new DistrictAdminCitationCategoryRow
                {
                    CategoryId = r.catId,
                    CategoryName = r.catName,
                    PointsEarned = (int)Math.Round(r.points),
                    MaxPoints = (int)Math.Round(r.maxPoints),
                    QualifiedClubs = 0,
                };
                categories.Add(row);
                if (r.catId > 0) catMap[r.catId] = row;
            }

            // Per-club-per-category completion buckets. A club is Complete
            // for a category when it has earned ≥ 90% of MaxPoints, Partial
            // when 1..89%, else Incomplete (no entry / zero score).
            try
            {
                var perClubCat = await conn.QueryAsync<(int catId, int clubId, decimal earned)>(@"
                    SELECT COALESCE(q.fk_category_id, 0) AS catId,
                           e.fk_club_id AS clubId,
                           COALESCE(SUM(e.points_earned), 0) + COALESCE(SUM(e.bonus_earned), 0) AS earned
                    FROM district_citation_club_entry e
                    JOIN district_citation_auto_question q ON q.pk_id = e.fk_question_id
                    JOIN club_master c ON c.pk_club_id = e.fk_club_id AND c.isdeleted = 0
                    WHERE e.fk_district_id = @DistrictId AND e.isdeleted = 0
                      AND c.fk_district_id = @DistrictId
                      AND (@YearId = 0 OR e.fk_year_id = @YearId)
                    GROUP BY q.fk_category_id, e.fk_club_id",
                    new { DistrictId = districtId, YearId = yearId });

                var perClubByCat = new Dictionary<int, Dictionary<int, decimal>>();
                foreach (var r in perClubCat)
                {
                    if (!perClubByCat.TryGetValue(r.catId, out var dict))
                    {
                        dict = new Dictionary<int, decimal>();
                        perClubByCat[r.catId] = dict;
                    }
                    dict[r.clubId] = r.earned;
                }

                foreach (var cat in categories)
                {
                    if (cat.CategoryId <= 0) continue;
                    perClubByCat.TryGetValue(cat.CategoryId, out var clubs);
                    int complete = 0, partial = 0;
                    if (clubs != null && cat.MaxPoints > 0)
                    {
                        foreach (var kv in clubs)
                        {
                            var pct = (decimal)kv.Value / cat.MaxPoints * 100m;
                            if (pct >= 90m) complete++;
                            else if (pct > 0m) partial++;
                        }
                    }
                    int inc = Math.Max(0, totalClubs - complete - partial);
                    cat.CompleteClubs = complete;
                    cat.PartialClubs = partial;
                    cat.IncompleteClubs = inc;
                    cat.Status = complete > partial + inc ? "complete"
                        : partial + complete > inc ? "partial"
                        : "incomplete";
                }
            }
            catch { /* schema variation — leave buckets at 0 */ }

            qualifiedClubs = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(DISTINCT e.fk_club_id) FROM district_citation_club_entry e
                JOIN club_master c ON c.pk_club_id = e.fk_club_id AND c.isdeleted = 0
                WHERE e.fk_district_id = @DistrictId AND c.fk_district_id = @DistrictId
                  AND e.isdeleted = 0
                  AND (@YearId = 0 OR e.fk_year_id = @YearId)
                  AND (e.points_earned > 0 OR e.bonus_earned > 0)",
                new { DistrictId = districtId, YearId = yearId });
        }
        catch { /* citation schema variation — skip */ }

        return new DistrictAdminCitationPanel
        {
            TotalPoints = (int)Math.Round(totalPoints),
            QualifiedClubs = qualifiedClubs,
            Categories = categories,
        };
    }

    private async Task<List<DistrictAdminClubLeaderboardRow>> BuildClubLeaderboardAsync(
        MySqlConnection conn, int districtId, int yearId,
        IEnumerable<DistrictAdminClubStat> baseStats)
    {
        var citationByClub = new Dictionary<int, decimal>();
        try
        {
            // Match the Club Points tab on /districts/{id}/citation — INNER
            // JOIN entries against the auto-question / manual-sub-criteria
            // rows for the SAME district+year so orphan entries (question
            // was deleted or migrated to a different year) drop out. Raw
            // SUM(points_earned+bonus_earned) inflates the total past what
            // the Club Points tab shows.
            var cRows = await conn.QueryAsync<(int clubId, decimal score)>(@"
                SELECT clubId, SUM(score) AS score FROM (
                    SELECT e.fk_club_id AS clubId,
                           (e.points_earned + e.bonus_earned) AS score
                    FROM district_citation_club_entry e
                    INNER JOIN district_citation_auto_question q
                        ON q.pk_id = e.fk_question_id
                       AND q.fk_district_id = @DistrictId
                       AND q.fk_year_id     = @YearId
                       AND q.isdeleted = 0
                    WHERE e.fk_district_id = @DistrictId
                      AND e.fk_year_id     = @YearId
                      AND e.entry_type = 'auto' AND e.isdeleted = 0
                    UNION ALL
                    SELECT e.fk_club_id AS clubId,
                           (e.points_earned + e.bonus_earned) AS score
                    FROM district_citation_club_entry e
                    INNER JOIN district_citation_manual_sub_criteria sc
                        ON sc.pk_id = e.fk_question_id AND sc.isdeleted = 0
                    INNER JOIN district_citation_manual_criteria mc
                        ON mc.pk_id = sc.fk_criteria_id
                       AND mc.fk_district_id = @DistrictId
                       AND mc.fk_year_id     = @YearId
                       AND mc.isdeleted = 0
                    WHERE e.fk_district_id = @DistrictId
                      AND e.fk_year_id     = @YearId
                      AND e.entry_type = 'manual' AND e.isdeleted = 0
                ) t
                GROUP BY clubId",
                new { DistrictId = districtId, YearId = yearId });
            foreach (var r in cRows) citationByClub[r.clubId] = r.score;
        }
        catch { }

        // Ranked PURELY by District Awards points for the requested year.
        // Score = sum(points_earned + bonus_earned) per club from
        // district_citation_club_entry, filtered by the same yearId the rest
        // of the overview uses (so the leaderboard tracks the global year
        // picker). Members/TRF/Projects fields stay populated for callers
        // that read them; the rank/order is awards-only.
        //
        // Wave 13A4: the redesigned Overview leaderboard shows every club
        // in the district (client-side paginated + searched) and displays
        // a percentile chip per row. So we no longer Take(20) — return all
        // rows, and compute Percentile = Score / MaxScore * 100 for the UI.
        var list = baseStats.Select(c =>
        {
            var citation = citationByClub.GetValueOrDefault(c.ClubId, 0);
            return new DistrictAdminClubLeaderboardRow
            {
                ClubId = c.ClubId,
                ClubName = c.ClubName,
                Members = c.Members,
                TrfInr = c.TrfInr,
                Projects = c.Projects,
                CitationScore = (int)Math.Round(citation),
                Score = (int)Math.Round(citation),
            };
        }).OrderByDescending(x => x.Score).ThenBy(x => x.ClubName).ToList();

        decimal maxScore = list.Count == 0 ? 0 : list.Max(r => (decimal)r.Score);
        for (int i = 0; i < list.Count; i++)
        {
            list[i].Rank = i + 1;
            list[i].Percentile = maxScore > 0
                ? Math.Round((decimal)list[i].Score / maxScore * 100m, 0)
                : 0;
        }
        return list;
    }

    // Membership tab counts — Directors / DistrictCommittee / AG / Clubs.
    private async Task<List<DistrictAdminMembershipTabCount>> BuildMembershipTabCountsAsync(
        MySqlConnection conn, int districtId, int yearId)
    {
        var tabs = new List<DistrictAdminMembershipTabCount>();

        int bodTotal = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM board_of_directors b
            JOIN club_master c ON c.pk_club_id = b.fk_club_id AND c.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId AND b.isdeleted = 0
              AND (@YearId = 0 OR b.fk_year_id = @YearId)",
            new { DistrictId = districtId, YearId = yearId });
        int activeClubsForBod = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(DISTINCT b.fk_club_id) FROM board_of_directors b
            JOIN club_master c ON c.pk_club_id = b.fk_club_id AND c.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId AND b.isdeleted = 0
              AND (@YearId = 0 OR b.fk_year_id = @YearId)",
            new { DistrictId = districtId, YearId = yearId });
        int totalDistrictClubs = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_master WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND COALESCE(ClubType,'') <> 'Rotaract Club'",
            new { DistrictId = districtId });
        tabs.Add(new DistrictAdminMembershipTabCount
        {
            TabKey = "directors", TabLabel = "Directors",
            Total = bodTotal, Active = activeClubsForBod,
            ParticipationPercent = totalDistrictClubs == 0 ? 0
                : Math.Round((decimal)activeClubsForBod / totalDistrictClubs * 100m, 1),
        });

        int dcTotal = 0, dcActive = 0;
        try
        {
            dcTotal = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM district_committee_member
                WHERE fk_district_id = @DistrictId AND isdeleted = 0
                  AND (@YearId = 0 OR fk_year_id = @YearId)",
                new { DistrictId = districtId, YearId = yearId });
            dcActive = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM district_committee_member
                WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND is_active = 1
                  AND (@YearId = 0 OR fk_year_id = @YearId)",
                new { DistrictId = districtId, YearId = yearId });
        }
        catch { }
        tabs.Add(new DistrictAdminMembershipTabCount
        {
            TabKey = "district_committee", TabLabel = "District Committee",
            Total = dcTotal, Active = dcActive,
            ParticipationPercent = dcTotal == 0 ? 0 : Math.Round((decimal)dcActive / dcTotal * 100m, 1),
        });

        int agTotal = 0, agActiveClubs = 0;
        try
        {
            agTotal = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM district_ag
                WHERE fk_district_id = @DistrictId AND isdeleted = 0
                  AND (@YearId = 0 OR fk_year_id = @YearId)",
                new { DistrictId = districtId, YearId = yearId });
            agActiveClubs = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(DISTINCT fk_club_id) FROM district_ag
                WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND is_active = 1
                  AND (@YearId = 0 OR fk_year_id = @YearId)",
                new { DistrictId = districtId, YearId = yearId });
        }
        catch { }
        tabs.Add(new DistrictAdminMembershipTabCount
        {
            TabKey = "ag", TabLabel = "Assistant Governors",
            Total = agTotal, Active = agActiveClubs,
            ParticipationPercent = totalDistrictClubs == 0 ? 0
                : Math.Round((decimal)agActiveClubs / totalDistrictClubs * 100m, 1),
        });

        int activeClubsAll = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_master
            WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND IsActive = 1 AND COALESCE(ClubType,'') <> 'Rotaract Club'",
            new { DistrictId = districtId });
        tabs.Add(new DistrictAdminMembershipTabCount
        {
            TabKey = "clubs", TabLabel = "Clubs",
            Total = totalDistrictClubs, Active = activeClubsAll,
            ParticipationPercent = totalDistrictClubs == 0 ? 0
                : Math.Round((decimal)activeClubsAll / totalDistrictClubs * 100m, 1),
        });

        return tabs;
    }

    // Reads district_project_target (Wave 13A3) and joins to year-table project counts.
    private async Task<List<DistrictAdminProjectTargetRow>> BuildDistrictProjectTargetsAsync(
        MySqlConnection conn, int districtId, int yearId)
    {
        var completedByModule = new Dictionary<string, int>();
        var moduleLabels = new Dictionary<string, string>();
        var tables = await GetTargetTablesAsync(conn, yearId);
        foreach (var t in tables)
        {
            var rows = await conn.QueryAsync<(string? key, string? name, int cnt)>(
                $@"SELECT md.ModuleKey, md.ModuleName, COUNT(*) AS cnt
                   FROM `{t.ProjectsTable}` p
                   JOIN club_master c ON c.pk_club_id = p.fk_club_id AND c.isdeleted = 0
                   LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
                   WHERE c.fk_district_id = @DistrictId AND p.isdeleted = 0
                   GROUP BY md.ModuleKey, md.ModuleName",
                new { DistrictId = districtId });
            foreach (var r in rows)
            {
                if (string.IsNullOrEmpty(r.key)) continue;
                completedByModule[r.key] = completedByModule.GetValueOrDefault(r.key, 0) + r.cnt;
                if (!moduleLabels.ContainsKey(r.key))
                    moduleLabels[r.key] = r.name ?? r.key;
            }
        }

        var targets = new Dictionary<string, int>();
        try
        {
            var trows = await conn.QueryAsync<(string? key, string? name, int target)>(@"
                SELECT md.ModuleKey, md.ModuleName, t.target_count AS target
                FROM district_project_target t
                JOIN module_master md ON md.pk_module_id = t.fk_module_id
                WHERE t.fk_district_id = @DistrictId AND t.fk_year_id = @YearId AND t.isdeleted = 0",
                new { DistrictId = districtId, YearId = yearId });
            foreach (var r in trows)
            {
                if (string.IsNullOrEmpty(r.key)) continue;
                targets[r.key] = r.target;
                if (!moduleLabels.ContainsKey(r.key)) moduleLabels[r.key] = r.name ?? r.key;
            }
        }
        catch { }

        var result = new List<DistrictAdminProjectTargetRow>();
        foreach (var (key, label) in AVENUE_KEYS)
        {
            int completed = completedByModule.GetValueOrDefault(key, 0);
            int? target = targets.TryGetValue(key, out var tv) ? tv : (int?)null;
            decimal pct = target.GetValueOrDefault() == 0 ? 0
                : Math.Round((decimal)completed / target!.Value * 100m, 1);
            result.Add(new DistrictAdminProjectTargetRow
            {
                TypeKey = key,
                TypeLabel = moduleLabels.TryGetValue(key, out var ml) ? ml : label,
                Target = target,
                Completed = completed,
                PercentAchieved = pct,
                IsPending = !target.HasValue,
            });
        }
        return result;
    }

    // District events list — based on upcoming_events from clubs in this district.
    // (Schema has no district-level events table; we surface club events here.)
    private async Task<List<DistrictAdminDistrictEventRow>> GetDistrictEventsAsync(
        MySqlConnection conn, int districtId, int yearId, int limit)
    {
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT e.pk_upcoming_event_id AS id, e.Title AS title, e.Description AS description,
                   e.EventDate AS eventDate, e.EventVenue AS venue, c.ClubName AS clubName,
                   CASE WHEN e.EventDate >= CURDATE() THEN 'Upcoming' ELSE 'Past' END AS status
            FROM upcoming_events e
            JOIN club_master c ON c.pk_club_id = e.fk_club_id AND c.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId AND e.isdeleted = 0
            ORDER BY e.EventDate DESC
            LIMIT @Limit",
            new { DistrictId = districtId, Limit = limit });
        return rows.Select(r =>
        {
            DateTime? d = r.eventDate is DateTime dd ? dd : (DateTime?)null;
            return new DistrictAdminDistrictEventRow
            {
                Id = (int)r.id,
                Title = (r.title as string) ?? "",
                Description = r.description as string,
                EventDate = d?.ToString("yyyy-MM-dd"),
                Venue = r.venue as string,
                ClubName = r.clubName as string,
                Status = (r.status as string) ?? "",
            };
        }).ToList();
    }

    private async Task<List<DistrictAdminProjectFrequencyRow>> GetProjectCompletionFrequencyAsync(
        MySqlConnection conn, int districtId, int yearId)
    {
        var result = new List<DistrictAdminProjectFrequencyRow>();
        var tables = await GetTargetTablesAsync(conn, yearId);
        foreach (var t in tables)
        {
            // NOTE: `mod` is a MySQL reserved word — alias as `moduleName` instead.
            var rows = await conn.QueryAsync<(int clubId, string clubName, string? moduleName, int cnt)>(
                $@"SELECT p.fk_club_id AS clubId, c.ClubName AS clubName,
                          COALESCE(md.ModuleName, 'Other') AS moduleName, COUNT(*) AS cnt
                   FROM `{t.ProjectsTable}` p
                   JOIN club_master c ON c.pk_club_id = p.fk_club_id AND c.isdeleted = 0
                   LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
                   WHERE c.fk_district_id = @DistrictId AND p.isdeleted = 0
                   GROUP BY p.fk_club_id, c.ClubName, COALESCE(md.ModuleName, 'Other')",
                new { DistrictId = districtId });
            foreach (var r in rows)
            {
                result.Add(new DistrictAdminProjectFrequencyRow
                {
                    ClubId = r.clubId, ClubName = r.clubName,
                    Category = r.moduleName ?? "Other", Completed = r.cnt,
                });
            }
        }
        return result.OrderBy(r => r.ClubName).ThenBy(r => r.Category).ToList();
    }

    private async Task<List<DistrictAdminProjectListingRow>> GetAllDistrictProjectsAsync(
        MySqlConnection conn, int districtId, int yearId, int limit)
    {
        var result = new List<DistrictAdminProjectListingRow>();
        var tables = await GetTargetTablesAsync(conn, yearId);
        foreach (var t in tables)
        {
            var rows = await conn.QueryAsync<dynamic>(
                $@"SELECT p.pk_project_id AS projectId, p.fk_club_id AS clubId, c.ClubName AS clubName,
                          p.title AS title, p.project_date AS pdate,
                          COALESCE(p.direct_beneficiaries, 0) AS bens,
                          COALESCE(p.project_cost, 0) AS funds,
                          COALESCE(p.man_hours, 0) AS mh,
                          md.ModuleName AS avenue, af.name AS aof
                   FROM `{t.ProjectsTable}` p
                   JOIN club_master c ON c.pk_club_id = p.fk_club_id AND c.isdeleted = 0
                   LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
                   LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
                   WHERE c.fk_district_id = @DistrictId AND p.isdeleted = 0
                   ORDER BY p.project_date DESC
                   LIMIT @Limit",
                new { DistrictId = districtId, Limit = limit });
            foreach (var r in rows)
            {
                DateTime? d = r.pdate is DateTime dd ? dd : (DateTime?)null;
                result.Add(new DistrictAdminProjectListingRow
                {
                    ProjectId = (int)r.projectId,
                    ClubId = (int)r.clubId,
                    ClubName = (r.clubName as string) ?? "",
                    Title = (r.title as string) ?? "",
                    ProjectDate = d?.ToString("yyyy-MM-dd"),
                    Beneficiaries = Convert.ToInt32(r.bens ?? 0),
                    Funds = Convert.ToDecimal(r.funds ?? 0),
                    ManHours = Convert.ToInt32(r.mh ?? 0),
                    AvenueName = r.avenue as string,
                    AreaOfFocus = r.aof as string,
                });
            }
        }
        return result.OrderByDescending(p => p.ProjectDate).Take(limit).ToList();
    }

    // Greetings — today / this-week / next-week birthdays + anniversaries
    // for active members in clubs of this district.
    private async Task<List<DistrictAdminGreetingItem>> GetGreetingsAsync(
        MySqlConnection conn, int districtId)
    {
        var today = DateTime.Today;
        var thisWeekEnd = today.AddDays(7);
        var nextWeekEnd = today.AddDays(14);

        var rows = (await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId,
                   m.MemberName AS name, m.ProfilePhotoPath AS photo,
                   m.BirthDate AS birth, m.AnniversaryDate AS anniv,
                   c.ClubName AS clubName
            FROM member_master_profile m
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                AND cm.IsActive = 1 AND cm.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId AND m.isdeleted = 0
              AND (m.BirthDate IS NOT NULL OR m.AnniversaryDate IS NOT NULL)",
            new { DistrictId = districtId })).ToList();

        DateTime? NextOccurrence(DateTime? d)
        {
            if (!d.HasValue) return null;
            var t = today;
            var month = d.Value.Month;
            var day = Math.Min(d.Value.Day, DateTime.DaysInMonth(t.Year, month));
            var next = new DateTime(t.Year, month, day);
            if (next < t) next = next.AddYears(1);
            return next;
        }
        string Bucket(DateTime occurrence)
        {
            if (occurrence == today) return "today";
            if (occurrence < thisWeekEnd) return "this_week";
            if (occurrence < nextWeekEnd) return "next_week";
            return "";
        }

        var items = new List<DistrictAdminGreetingItem>();
        foreach (var r in rows)
        {
            int memberId = (int)r.memberId;
            string name = (r.name as string) ?? "";
            string? photo = r.photo as string;
            string? club = r.clubName as string;
            DateTime? b = r.birth is DateTime bd ? bd : (DateTime?)null;
            DateTime? a = r.anniv is DateTime ad ? ad : (DateTime?)null;

            var bn = NextOccurrence(b);
            if (bn.HasValue && bn.Value < nextWeekEnd)
            {
                var bucket = Bucket(bn.Value);
                if (!string.IsNullOrEmpty(bucket))
                    items.Add(new DistrictAdminGreetingItem
                    {
                        MemberId = memberId, Name = name, PhotoPath = photo, ClubName = club,
                        Kind = "birthday", Date = bn.Value.ToString("yyyy-MM-dd"), Bucket = bucket,
                    });
            }
            var an = NextOccurrence(a);
            if (an.HasValue && an.Value < nextWeekEnd)
            {
                var bucket = Bucket(an.Value);
                if (!string.IsNullOrEmpty(bucket))
                    items.Add(new DistrictAdminGreetingItem
                    {
                        MemberId = memberId, Name = name, PhotoPath = photo, ClubName = club,
                        Kind = "anniversary", Date = an.Value.ToString("yyyy-MM-dd"), Bucket = bucket,
                    });
            }
        }
        return items.OrderBy(i => i.Date).ToList();
    }

    private async Task<List<DistrictAdminDocumentItem>> GetDistrictDocumentsAsync(
        MySqlConnection conn, int districtId, int limit)
    {
        // District-scope only (fk_district_id) — matches the tab-strip listing.
        // ClubName intentionally blank; district documents aren't per-club.
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT d.pk_document_id AS id, d.Title AS title, d.PublishDateTime AS pub,
                   d.FilePath AS filePath, d.OriginalFileName AS origName,
                   d.AccessType AS accessType
            FROM club_documents d
            WHERE d.fk_district_id = @DistrictId AND d.isdeleted = 0
            ORDER BY d.PublishDateTime DESC
            LIMIT @Limit",
            new { DistrictId = districtId, Limit = limit });
        return rows.Select(r =>
        {
            DateTime? d = r.pub is DateTime dd ? dd : (DateTime?)null;
            return new DistrictAdminDocumentItem
            {
                Id = (int)r.id,
                Title = (r.title as string) ?? "",
                ClubName = "",
                PublishDate = d?.ToString("yyyy-MM-dd"),
                FilePath = r.filePath as string,
                OriginalFileName = r.origName as string,
                AccessType = (r.accessType as string) ?? "",
            };
        }).ToList();
    }

    // CMR per-month breakdown across rotary year (Jul–Jun = ReportMonth 7..6 calendar).
    // Late heuristic: uploaded_to_district_date > last-day-of-report-month + 14 days.
    private async Task<List<DistrictAdminCmrMonthRow>> BuildCmrMonthBreakdownAsync(
        MySqlConnection conn, int districtId, int yearId, int totalClubs)
    {
        var result = new List<DistrictAdminCmrMonthRow>();
        int[] calMonths = { 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6 };
        for (int i = 0; i < 12; i++)
        {
            int cm = calMonths[i];
            int submitted = 0, pending = 0, onTime = 0, late = 0;
            try
            {
                var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                    SELECT
                        SUM(CASE WHEN r.IsUploadedToDistrict = 1 THEN 1 ELSE 0 END) AS submitted,
                        SUM(CASE WHEN r.IsUploadedToDistrict = 0 THEN 1 ELSE 0 END) AS pending,
                        SUM(CASE WHEN r.IsUploadedToDistrict = 1
                                  AND r.uploaded_to_district_date IS NOT NULL
                                  AND DATEDIFF(r.uploaded_to_district_date,
                                               LAST_DAY(STR_TO_DATE(CONCAT('1-', r.ReportMonth, '-2024'), '%d-%m-%Y'))) <= 14
                                 THEN 1 ELSE 0 END) AS onTime,
                        SUM(CASE WHEN r.IsUploadedToDistrict = 1
                                  AND r.uploaded_to_district_date IS NOT NULL
                                  AND DATEDIFF(r.uploaded_to_district_date,
                                               LAST_DAY(STR_TO_DATE(CONCAT('1-', r.ReportMonth, '-2024'), '%d-%m-%Y'))) > 14
                                 THEN 1 ELSE 0 END) AS late
                    FROM club_monthly_reports r
                    JOIN club_master c ON c.pk_club_id = r.fk_club_id AND c.isdeleted = 0
                    WHERE c.fk_district_id = @DistrictId AND r.isdeleted = 0
                      AND (@YearId = 0 OR r.fk_year_id = @YearId)
                      AND r.ReportMonth = @Cm",
                    new { DistrictId = districtId, YearId = yearId, Cm = cm });
                submitted = (int)(long)(row?.submitted ?? 0L);
                pending = (int)(long)(row?.pending ?? 0L);
                onTime = (int)(long)(row?.onTime ?? 0L);
                late = (int)(long)(row?.late ?? 0L);
            }
            catch { }
            int notStarted = Math.Max(0, totalClubs - submitted - pending);
            result.Add(new DistrictAdminCmrMonthRow
            {
                Month = i + 1,
                CalendarMonth = cm,
                Label = MONTH_LABELS[i],
                Submitted = submitted,
                OnTime = onTime,
                Late = late,
                Pending = pending,
                NotStarted = notStarted,
            });
        }
        return result;
    }

    // Per-club CMR grid — for each club, a 12-month status array.
    private async Task<List<DistrictAdminCmrPerClubRow>> BuildCmrPerClubGridAsync(
        MySqlConnection conn, int districtId, int yearId)
    {
        var clubs = (await conn.QueryAsync<(int clubId, string clubName)>(@"
            SELECT pk_club_id, ClubName FROM club_master
            WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND COALESCE(ClubType,'') <> 'Rotaract Club'
            ORDER BY ClubName",
            new { DistrictId = districtId })).ToList();

        var reports = (await conn.QueryAsync<(int clubId, int month, int uploaded, DateTime? uploadedDate)>(@"
            SELECT r.fk_club_id, r.ReportMonth,
                   COALESCE(r.IsUploadedToDistrict, 0) AS uploaded,
                   r.uploaded_to_district_date AS uploadedDate
            FROM club_monthly_reports r
            JOIN club_master c ON c.pk_club_id = r.fk_club_id AND c.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId AND r.isdeleted = 0
              AND (@YearId = 0 OR r.fk_year_id = @YearId)",
            new { DistrictId = districtId, YearId = yearId })).ToList();

        int[] calMonths = { 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6 };
        var rows = new List<DistrictAdminCmrPerClubRow>();
        foreach (var c in clubs)
        {
            var monthList = new List<DistrictAdminCmrPerClubMonth>();
            int subTotal = 0, pendTotal = 0;
            for (int i = 0; i < 12; i++)
            {
                int cm = calMonths[i];
                var rep = reports.FirstOrDefault(r => r.clubId == c.clubId && r.month == cm);
                string status;
                string? subDate = null;
                if (rep == default) { status = "not_started"; }
                else if (rep.uploaded == 1)
                {
                    status = "submitted";
                    subTotal++;
                    subDate = rep.uploadedDate?.ToString("yyyy-MM-dd");
                }
                else
                {
                    status = "pending"; pendTotal++;
                }
                monthList.Add(new DistrictAdminCmrPerClubMonth { Month = i + 1, Status = status, SubmittedDate = subDate });
            }
            rows.Add(new DistrictAdminCmrPerClubRow
            {
                ClubId = c.clubId, ClubName = c.clubName,
                Submitted = subTotal, Pending = pendTotal,
                Months = monthList,
            });
        }
        return rows;
    }

    private async Task<List<DistrictAdminCitationClubRow>> BuildCitationPerClubAsync(
        MySqlConnection conn, int districtId, int yearId)
    {
        try
        {
            var rows = await conn.QueryAsync<DistrictAdminCitationClubRow>(@"
                SELECT c.pk_club_id AS clubId, c.ClubName AS clubName,
                       CAST(ROUND(COALESCE(SUM(e.points_earned), 0)) AS SIGNED) AS pointsEarned,
                       CAST(ROUND(COALESCE(SUM(e.bonus_earned), 0)) AS SIGNED) AS bonusEarned,
                       CAST(ROUND(COALESCE(SUM(e.points_earned), 0) + COALESCE(SUM(e.bonus_earned), 0)) AS SIGNED) AS totalScore,
                       CASE WHEN COALESCE(SUM(e.points_earned), 0) + COALESCE(SUM(e.bonus_earned), 0) > 0
                            THEN 1 ELSE 0 END AS qualified
                FROM club_master c
                LEFT JOIN district_citation_club_entry e ON e.fk_club_id = c.pk_club_id
                    AND e.isdeleted = 0
                    AND (@YearId = 0 OR e.fk_year_id = @YearId)
                WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND COALESCE(c.ClubType,'') <> 'Rotaract Club'
                GROUP BY c.pk_club_id, c.ClubName
                ORDER BY totalScore DESC, c.ClubName",
                new { DistrictId = districtId, YearId = yearId });
            return rows.ToList();
        }
        catch { return new List<DistrictAdminCitationClubRow>(); }
    }

    private List<DistrictAdminReportItem> BuildDistrictReportsList(int districtId, int yearId)
    {
        var q = $"?districtId={districtId}&yearId={yearId}";
        return new List<DistrictAdminReportItem>
        {
            new() { Key = "cmr_summary", Name = "CMR Summary",
                    ExportUrl = $"/api/district-report/cmr-summary{q}", Format = "xlsx" },
            new() { Key = "citation_summary", Name = "District Awards Summary",
                    ExportUrl = $"/api/district-report/citation-summary{q}", Format = "xlsx" },
            new() { Key = "trf_summary", Name = "TRF Contribution Summary",
                    ExportUrl = $"/api/district-report/trf-summary{q}", Format = "xlsx" },
            new() { Key = "membership_summary", Name = "Membership Summary",
                    ExportUrl = $"/api/district-report/membership-summary{q}", Format = "xlsx" },
            new() { Key = "projects_summary", Name = "Service Projects Summary",
                    ExportUrl = $"/api/district-report/projects-summary{q}", Format = "xlsx" },
        };
    }

    // ─── Wave 13A3: DG goal-setting + AG-feeding endpoints ─────────────
    // Authorization model:
    //   GET  — uses ResolveDistrictIdAsync (legacy LIMIT 1 if no districtId
    //          passed). Returns the row for caller's district / null when empty.
    //   POST — requires the dto.FkDistrictId to match an active District Admin
    //          assignment for the caller (otherwise UnauthorizedAccessException).
    //
    // Club-scoped tables (award_status, myrotary) take a clubId; we resolve the
    // club's fk_district_id and run the same DA check before allowing upsert.

    private async Task EnsureDistrictAdminAsync(MySqlConnection conn, int memberId, int districtId)
    {
        if (memberId <= 0 || districtId <= 0)
            throw new UnauthorizedAccessException("Invalid request.");

        var isAdmin = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles
            WHERE fk_member_master_profile_id = @MemberId
              AND fk_role_id = 2
              AND fk_district_id = @DistrictId
              AND IsActive = 1 AND isdeleted = 0",
            new { MemberId = memberId, DistrictId = districtId });

        if (isAdmin == 0)
            throw new UnauthorizedAccessException("You are not an active admin for this district.");
    }

    private async Task<int?> GetClubDistrictAsync(MySqlConnection conn, int clubId)
    {
        if (clubId <= 0) return null;
        return await conn.ExecuteScalarAsync<int?>(@"
            SELECT fk_district_id FROM club_master
            WHERE pk_club_id = @ClubId AND isdeleted = 0 LIMIT 1",
            new { ClubId = clubId });
    }

    // ── Membership goal ──

    public async Task<DistrictMembershipGoalDto?> GetMembershipGoalAsync(int memberId, int? yearId, int? requestedDistrictId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        if (districtId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        if (resolvedYearId == 0) return null;

        return await conn.QueryFirstOrDefaultAsync<DistrictMembershipGoalDto>(@"
            SELECT pk_id AS PkId,
                   fk_district_id AS FkDistrictId,
                   fk_year_id AS FkYearId,
                   target_total AS TargetTotal,
                   target_new_members AS TargetNewMembers,
                   target_retention_percent AS TargetRetentionPercent,
                   modified_date AS ModifiedDate
            FROM district_membership_goal
            WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId
              AND isdeleted = 0 LIMIT 1",
            new { DistrictId = districtId, YearId = resolvedYearId });
    }

    public async Task<DistrictMembershipGoalDto> UpsertMembershipGoalAsync(int memberId, DistrictMembershipGoalDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await EnsureDistrictAdminAsync(conn, memberId, dto.FkDistrictId);
        if (dto.FkYearId <= 0)
            throw new ArgumentException("YearId is required.", nameof(dto));

        await conn.ExecuteAsync(@"
            INSERT INTO district_membership_goal
                (fk_district_id, fk_year_id, target_total, target_new_members, target_retention_percent,
                 created_by, modified_by, modified_date, isdeleted, IsActive)
            VALUES (@DistrictId, @YearId, @Total, @New, @Retention,
                    @MemberId, @MemberId, NOW(), 0, 1)
            ON DUPLICATE KEY UPDATE
                target_total = VALUES(target_total),
                target_new_members = VALUES(target_new_members),
                target_retention_percent = VALUES(target_retention_percent),
                modified_by = VALUES(modified_by),
                modified_date = NOW(),
                isdeleted = 0,
                IsActive = 1",
            new
            {
                DistrictId = dto.FkDistrictId,
                YearId = dto.FkYearId,
                Total = dto.TargetTotal,
                New = dto.TargetNewMembers,
                Retention = dto.TargetRetentionPercent,
                MemberId = memberId,
            });

        var saved = await conn.QueryFirstAsync<DistrictMembershipGoalDto>(@"
            SELECT pk_id AS PkId,
                   fk_district_id AS FkDistrictId,
                   fk_year_id AS FkYearId,
                   target_total AS TargetTotal,
                   target_new_members AS TargetNewMembers,
                   target_retention_percent AS TargetRetentionPercent,
                   modified_date AS ModifiedDate
            FROM district_membership_goal
            WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId
              AND isdeleted = 0 LIMIT 1",
            new { DistrictId = dto.FkDistrictId, YearId = dto.FkYearId });
        return saved;
    }

    // ── Foundation goal ──

    public async Task<DistrictFoundationGoalDto?> GetFoundationGoalAsync(int memberId, int? yearId, int? requestedDistrictId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        if (districtId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        if (resolvedYearId == 0) return null;

        return await conn.QueryFirstOrDefaultAsync<DistrictFoundationGoalDto>(@"
            SELECT pk_id AS PkId,
                   fk_district_id AS FkDistrictId,
                   fk_year_id AS FkYearId,
                   target_annual_fund_usd AS TargetAnnualFundUsd,
                   target_polio_fund_usd AS TargetPolioFundUsd,
                   target_endowment_fund_usd AS TargetEndowmentFundUsd,
                   target_other_fund_usd AS TargetOtherFundUsd,
                   modified_date AS ModifiedDate
            FROM district_foundation_goal
            WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId
              AND isdeleted = 0 LIMIT 1",
            new { DistrictId = districtId, YearId = resolvedYearId });
    }

    public async Task<DistrictFoundationGoalDto> UpsertFoundationGoalAsync(int memberId, DistrictFoundationGoalDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await EnsureDistrictAdminAsync(conn, memberId, dto.FkDistrictId);
        if (dto.FkYearId <= 0)
            throw new ArgumentException("YearId is required.", nameof(dto));

        await conn.ExecuteAsync(@"
            INSERT INTO district_foundation_goal
                (fk_district_id, fk_year_id, target_annual_fund_usd, target_polio_fund_usd,
                 target_endowment_fund_usd, target_other_fund_usd,
                 created_by, modified_by, modified_date, isdeleted, IsActive)
            VALUES (@DistrictId, @YearId, @Annual, @Polio, @Endowment, @Other,
                    @MemberId, @MemberId, NOW(), 0, 1)
            ON DUPLICATE KEY UPDATE
                target_annual_fund_usd = VALUES(target_annual_fund_usd),
                target_polio_fund_usd = VALUES(target_polio_fund_usd),
                target_endowment_fund_usd = VALUES(target_endowment_fund_usd),
                target_other_fund_usd = VALUES(target_other_fund_usd),
                modified_by = VALUES(modified_by),
                modified_date = NOW(),
                isdeleted = 0,
                IsActive = 1",
            new
            {
                DistrictId = dto.FkDistrictId,
                YearId = dto.FkYearId,
                Annual = dto.TargetAnnualFundUsd,
                Polio = dto.TargetPolioFundUsd,
                Endowment = dto.TargetEndowmentFundUsd,
                Other = dto.TargetOtherFundUsd,
                MemberId = memberId,
            });

        return await conn.QueryFirstAsync<DistrictFoundationGoalDto>(@"
            SELECT pk_id AS PkId,
                   fk_district_id AS FkDistrictId,
                   fk_year_id AS FkYearId,
                   target_annual_fund_usd AS TargetAnnualFundUsd,
                   target_polio_fund_usd AS TargetPolioFundUsd,
                   target_endowment_fund_usd AS TargetEndowmentFundUsd,
                   target_other_fund_usd AS TargetOtherFundUsd,
                   modified_date AS ModifiedDate
            FROM district_foundation_goal
            WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId
              AND isdeleted = 0 LIMIT 1",
            new { DistrictId = dto.FkDistrictId, YearId = dto.FkYearId });
    }

    // ── Project targets (one row per avenue/module) ──

    public async Task<List<DistrictProjectTargetDto>> GetProjectTargetsAsync(int memberId, int? yearId, int? requestedDistrictId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        if (districtId == 0) return new List<DistrictProjectTargetDto>();
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        if (resolvedYearId == 0) return new List<DistrictProjectTargetDto>();

        var rows = await conn.QueryAsync<DistrictProjectTargetDto>(@"
            SELECT t.pk_id AS PkId,
                   t.fk_district_id AS FkDistrictId,
                   t.fk_year_id AS FkYearId,
                   t.fk_module_id AS FkModuleId,
                   m.ModuleName AS ModuleName,
                   t.target_count AS TargetCount,
                   t.modified_date AS ModifiedDate
            FROM district_project_target t
            LEFT JOIN module_master m ON m.pk_module_id = t.fk_module_id
            WHERE t.fk_district_id = @DistrictId AND t.fk_year_id = @YearId
              AND t.isdeleted = 0
            ORDER BY m.SortOrder, m.ModuleName",
            new { DistrictId = districtId, YearId = resolvedYearId });
        return rows.ToList();
    }

    public async Task<List<DistrictProjectTargetDto>> UpsertProjectTargetsAsync(int memberId, DistrictProjectTargetsBulkRequest req)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await EnsureDistrictAdminAsync(conn, memberId, req.DistrictId);
        if (req.YearId <= 0)
            throw new ArgumentException("YearId is required.", nameof(req));

        foreach (var item in req.Targets)
        {
            if (item.FkModuleId <= 0) continue;
            await conn.ExecuteAsync(@"
                INSERT INTO district_project_target
                    (fk_district_id, fk_year_id, fk_module_id, target_count,
                     created_by, modified_by, modified_date, isdeleted, IsActive)
                VALUES (@DistrictId, @YearId, @ModuleId, @Count,
                        @MemberId, @MemberId, NOW(), 0, 1)
                ON DUPLICATE KEY UPDATE
                    target_count = VALUES(target_count),
                    modified_by = VALUES(modified_by),
                    modified_date = NOW(),
                    isdeleted = 0,
                    IsActive = 1",
                new
                {
                    DistrictId = req.DistrictId,
                    YearId = req.YearId,
                    ModuleId = item.FkModuleId,
                    Count = item.TargetCount,
                    MemberId = memberId,
                });
        }

        return await GetProjectTargetsAsync(memberId, req.YearId, req.DistrictId);
    }

    // ── Club award status ──

    public async Task<ClubAwardStatusDto?> GetClubAwardStatusAsync(int memberId, int clubId, int? yearId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        if (clubId <= 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        if (resolvedYearId == 0) return null;

        return await conn.QueryFirstOrDefaultAsync<ClubAwardStatusDto>(@"
            SELECT pk_id AS PkId,
                   fk_club_id AS FkClubId,
                   fk_year_id AS FkYearId,
                   on_track AS OnTrack,
                   achieved AS Achieved,
                   COALESCE(presidential_citation_status, 'pending') AS PresidentialCitationStatus,
                   COALESCE(district_citation_status, 'pending') AS DistrictCitationStatus,
                   COALESCE(membership_excellence_status, 'pending') AS MembershipExcellenceStatus,
                   notes AS Notes,
                   modified_date AS ModifiedDate
            FROM club_award_status
            WHERE fk_club_id = @ClubId AND fk_year_id = @YearId
              AND isdeleted = 0 LIMIT 1",
            new { ClubId = clubId, YearId = resolvedYearId });
    }

    public async Task<ClubAwardStatusDto> UpsertClubAwardStatusAsync(int memberId, ClubAwardStatusDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubDistrictId = await GetClubDistrictAsync(conn, dto.FkClubId);
        if (clubDistrictId == null || clubDistrictId == 0)
            throw new ArgumentException("Club not found.", nameof(dto));
        await EnsureDistrictAdminAsync(conn, memberId, clubDistrictId.Value);
        if (dto.FkYearId <= 0)
            throw new ArgumentException("YearId is required.", nameof(dto));

        await conn.ExecuteAsync(@"
            INSERT INTO club_award_status
                (fk_club_id, fk_year_id, on_track, achieved,
                 presidential_citation_status, district_citation_status, membership_excellence_status,
                 notes, created_by, modified_by, modified_date, isdeleted, IsActive)
            VALUES (@ClubId, @YearId, @OnTrack, @Achieved,
                    @Pres, @Dist, @Mem,
                    @Notes, @MemberId, @MemberId, NOW(), 0, 1)
            ON DUPLICATE KEY UPDATE
                on_track = VALUES(on_track),
                achieved = VALUES(achieved),
                presidential_citation_status = VALUES(presidential_citation_status),
                district_citation_status = VALUES(district_citation_status),
                membership_excellence_status = VALUES(membership_excellence_status),
                notes = VALUES(notes),
                modified_by = VALUES(modified_by),
                modified_date = NOW(),
                isdeleted = 0,
                IsActive = 1",
            new
            {
                ClubId = dto.FkClubId,
                YearId = dto.FkYearId,
                OnTrack = dto.OnTrack ? 1 : 0,
                Achieved = dto.Achieved ? 1 : 0,
                Pres = dto.PresidentialCitationStatus ?? "pending",
                Dist = dto.DistrictCitationStatus ?? "pending",
                Mem = dto.MembershipExcellenceStatus ?? "pending",
                Notes = dto.Notes,
                MemberId = memberId,
            });

        return (await GetClubAwardStatusAsync(memberId, dto.FkClubId, dto.FkYearId))!;
    }

    // ── Club MyRotary tracking ──

    public async Task<ClubMyRotaryTrackingDto?> GetClubMyRotaryAsync(int memberId, int clubId, int? yearId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        if (clubId <= 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        if (resolvedYearId == 0) return null;

        return await conn.QueryFirstOrDefaultAsync<ClubMyRotaryTrackingDto>(@"
            SELECT pk_id AS PkId,
                   fk_club_id AS FkClubId,
                   fk_year_id AS FkYearId,
                   registered_members AS RegisteredMembers,
                   total_members AS TotalMembers,
                   registration_percentage AS RegistrationPercentage,
                   last_synced AS LastSynced,
                   modified_date AS ModifiedDate
            FROM club_myrotary_tracking
            WHERE fk_club_id = @ClubId AND fk_year_id = @YearId
              AND isdeleted = 0 LIMIT 1",
            new { ClubId = clubId, YearId = resolvedYearId });
    }

    public async Task<ClubMyRotaryTrackingDto> UpsertClubMyRotaryAsync(int memberId, ClubMyRotaryTrackingDto dto)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubDistrictId = await GetClubDistrictAsync(conn, dto.FkClubId);
        if (clubDistrictId == null || clubDistrictId == 0)
            throw new ArgumentException("Club not found.", nameof(dto));
        await EnsureDistrictAdminAsync(conn, memberId, clubDistrictId.Value);
        if (dto.FkYearId <= 0)
            throw new ArgumentException("YearId is required.", nameof(dto));

        // Auto-compute percentage when caller doesn't supply one.
        var pct = dto.RegistrationPercentage;
        if (pct == 0 && dto.TotalMembers > 0)
            pct = Math.Round((decimal)dto.RegisteredMembers / dto.TotalMembers * 100m, 2);

        await conn.ExecuteAsync(@"
            INSERT INTO club_myrotary_tracking
                (fk_club_id, fk_year_id, registered_members, total_members,
                 registration_percentage, last_synced,
                 created_by, modified_by, modified_date, isdeleted, IsActive)
            VALUES (@ClubId, @YearId, @Registered, @Total, @Pct, NOW(),
                    @MemberId, @MemberId, NOW(), 0, 1)
            ON DUPLICATE KEY UPDATE
                registered_members = VALUES(registered_members),
                total_members = VALUES(total_members),
                registration_percentage = VALUES(registration_percentage),
                last_synced = NOW(),
                modified_by = VALUES(modified_by),
                modified_date = NOW(),
                isdeleted = 0,
                IsActive = 1",
            new
            {
                ClubId = dto.FkClubId,
                YearId = dto.FkYearId,
                Registered = dto.RegisteredMembers,
                Total = dto.TotalMembers,
                Pct = pct,
                MemberId = memberId,
            });

        return (await GetClubMyRotaryAsync(memberId, dto.FkClubId, dto.FkYearId))!;
    }
}
