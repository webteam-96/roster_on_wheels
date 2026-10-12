using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// Club Admin dashboard data service. Resolves the admin's clubId from member_roles
// (fk_role_id = 2 + fk_club_id > 0) and serves 8 endpoints. All queries scoped to
// that one club only.
public class ClubAdminDashboardService : IClubAdminDashboardService
{
    // TRF is stored AND shown in USD — no currency conversion (was 84 for a legacy INR display).
    private const decimal USD_INR = 1m;
    private static readonly string[] MONTH_LABELS =
        { "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun" };

    private readonly string _connectionString;
    private readonly IYearTableResolver _yearTables;
    private readonly ICurrencyRateService _fx;

    public ClubAdminDashboardService(IConfiguration configuration, IYearTableResolver yearTables, ICurrencyRateService fx)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _yearTables = yearTables;
        _fx = fx;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // The currency a club's project-cost totals should be shown in: its district's DefaultCurrency
    // (SuperAdmin-set) or a country-based guess. Mirrors frontend resolveDefaultCurrency (currency.ts).
    private static async Task<string> ResolveClubTargetCurrencyAsync(MySqlConnection conn, int clubId)
    {
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT d.DefaultCurrency AS DefaultCurrency, d.Country AS Country
            FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE c.pk_club_id = @ClubId
            LIMIT 1", new { ClubId = clubId });
        return CurrencyHelper.ResolveDefaultCurrency(row?.DefaultCurrency as string, row?.Country as string);
    }

    // Resolves which club this dashboard request is scoped to.
    //
    // - When `requestedClubId` is provided, validate that the caller actually has
    //   an active Club Admin assignment at that club. Throws
    //   `UnauthorizedAccessException` if not (controllers translate to 403).
    // - When `requestedClubId` is null, fall back to the legacy LIMIT 1 lookup
    //   so existing callers that don't pass clubId still work (backward compat).
    private async Task<int> ResolveClubIdAsync(MySqlConnection conn, int memberId, int? requestedClubId = null)
    {
        if (memberId <= 0) return 0;

        if (requestedClubId.HasValue && requestedClubId.Value > 0)
        {
            var isAdmin = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_roles
                WHERE fk_member_master_profile_id = @MemberId
                  AND fk_role_id = 2
                  AND fk_club_id = @ClubId
                  AND IsActive = 1 AND isdeleted = 0",
                new { MemberId = memberId, ClubId = requestedClubId.Value });

            // Scope override: SuperAdmin (any club — e.g. opened from global search) or a
            // District Admin WITH all-clubs access (their district only). A plain district
            // admin (AllClubsAccess=0) is NOT granted club access.
            if (isAdmin == 0 && await ClubAdminAccessHelper.CanOverrideClubAdminAsync(conn, memberId, requestedClubId.Value))
                isAdmin = 1;

            if (isAdmin == 0)
                throw new UnauthorizedAccessException("You are not an active admin for this club.");

            return requestedClubId.Value;
        }

        var clubId = await conn.ExecuteScalarAsync<int?>(@"
            SELECT fk_club_id FROM member_roles
            WHERE fk_member_master_profile_id = @MemberId
              AND fk_role_id = 2
              AND fk_club_id IS NOT NULL AND fk_club_id > 0
              AND IsActive = 1 AND isdeleted = 0
            ORDER BY pk_member_role_id ASC
            LIMIT 1",
            new { MemberId = memberId });
        return clubId ?? 0;
    }

    private async Task<int> ResolveYearIdAsync(MySqlConnection conn, int? yearId)
    {
        if (yearId.HasValue && yearId.Value > 0) return yearId.Value;
        var current = await conn.ExecuteScalarAsync<int?>(@"
            SELECT pk_year_id FROM rotary_year_master WHERE isdeleted = 0 AND IsCurrent = 1 LIMIT 1");
        return current ?? 0;
    }

    private async Task<ClubAdminIdentityDto?> BuildIdentityAsync(MySqlConnection conn, int memberId, int clubId, int yearId)
    {
        if (clubId == 0) return null;
        // Rotary.org Sync status reuses the existing IsSyncedFromRotaryOrg flag —
        // set to 1 by the nightly RotaryOrgSyncWorker for clubs it actually
        // syncs, 0 for manually-created or opted-out clubs. (Phase 1 originally
        // added a separate IsRotaryOrgSyncEnabled column; that turned out to be
        // a duplicate and was retired.)
        var info = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT c.ClubName AS clubName, COALESCE(d.DistrictNumber,'') AS districtNumber,
                   m.MemberName AS memberName,
                   COALESCE(c.IsSyncedFromRotaryOrg, 0) AS isRotaryOrgSyncEnabled
            FROM club_master c
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = @MemberId
            WHERE c.pk_club_id = @ClubId AND c.isdeleted = 0 LIMIT 1",
            new { ClubId = clubId, MemberId = memberId });
        if (info == null) return null;

        var yearLabel = await conn.ExecuteScalarAsync<string?>(@"
            SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @YearId LIMIT 1",
            new { YearId = yearId }) ?? "";

        var websiteRow = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT EndDate AS endDate, AmountPaid AS amountPaid, Status AS status
            FROM club_websites
            WHERE fk_club_id = @ClubId AND isdeleted = 0
            ORDER BY pk_id DESC LIMIT 1",
            new { ClubId = clubId });
        DateTime? expiry = websiteRow?.endDate is DateTime e ? e : (DateTime?)null;
        string? wsStatus = websiteRow?.status as string;
        bool websiteActive = websiteRow != null
            && string.Equals(wsStatus, "Active", StringComparison.OrdinalIgnoreCase)
            && (expiry == null || expiry >= DateTime.Today);

        // Available WhatsApp + Email credit balances for the hero chip.
        // Mirrors the query in CreditManagementService.cs:105 — only active,
        // unexpired credits count; expired or used-up batches don't.
        int emailCredits = await conn.ExecuteScalarAsync<int?>(@"
            SELECT COALESCE(SUM(CreditCount - UsedCount), 0)
            FROM club_credits
            WHERE fk_club_id = @ClubId AND CreditType = 'Email'
              AND IsActive = 1 AND isdeleted = 0 AND NOW() <= ToDate",
            new { ClubId = clubId }) ?? 0;
        int waCredits = await conn.ExecuteScalarAsync<int?>(@"
            SELECT COALESCE(SUM(CreditCount - UsedCount), 0)
            FROM club_credits
            WHERE fk_club_id = @ClubId AND CreditType = 'WhatsApp'
              AND IsActive = 1 AND isdeleted = 0 AND NOW() <= ToDate",
            new { ClubId = clubId }) ?? 0;

        return new ClubAdminIdentityDto
        {
            MemberId = memberId,
            Name = (info.memberName as string) ?? "",
            ClubId = clubId,
            ClubName = (info.clubName as string) ?? "",
            DistrictNumber = (info.districtNumber as string) ?? "",
            YearLabel = yearLabel,
            // Default to false when missing — the field is "is this club synced",
            // and a NULL means the worker never touched it.
            RotaryOrgSyncEnabled = Convert.ToBoolean((sbyte?)info.isRotaryOrgSyncEnabled ?? (sbyte)0),
            ClubWebsiteActive = websiteActive,
            ClubWebsiteExpiry = expiry,
            EmailCreditBalance = emailCredits,
            WhatsAppCreditBalance = waCredits,
        };
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

    // ─── 1. OVERVIEW ────────────────────────────────────────────────────

    public async Task<ClubAdminOverviewResponse?> GetOverviewAsync(int memberId, int? yearId, int? requestedClubId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, clubId, resolvedYearId);
        if (identity == null) return null;

        var (start, end) = await YearRangeAsync(conn, resolvedYearId);

        var memberStats = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN m.Gender = 'Male' THEN 1 ELSE 0 END) AS male,
                SUM(CASE WHEN m.Gender = 'Female' THEN 1 ELSE 0 END) AS female,
                SUM(CASE WHEN cm.IsHonoraryMember = 1 THEN 1 ELSE 0 END) AS honorary
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0",
            new { ClubId = clubId });

        int total = memberStats?.total == null ? 0 : (int)(long)memberStats.total;
        int male = memberStats?.male == null ? 0 : (int)(long)memberStats.male;
        int female = memberStats?.female == null ? 0 : (int)(long)memberStats.female;
        int honorary = memberStats?.honorary == null ? 0 : (int)(long)memberStats.honorary;

        int newMembers = 0, terminated = 0;
        if (start != null)
        {
            newMembers = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_members
                WHERE fk_club_id = @ClubId AND isdeleted = 0
                  AND JoinedDate >= @Start AND JoinedDate <= @End",
                new { ClubId = clubId, Start = start, End = end });
            terminated = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_members
                WHERE fk_club_id = @ClubId AND isdeleted = 1
                  AND deleted_date >= @Start AND deleted_date <= @End",
                new { ClubId = clubId, Start = start, End = end });
        }

        var trfRow = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT
                COALESCE(SUM(AmountUSD), 0) AS totalUsd,
                COALESCE(SUM(CASE WHEN LOWER(COALESCE(f.FundName, t.OtherFundName, '')) LIKE '%annual%' THEN AmountUSD ELSE 0 END), 0) AS annualUsd,
                COALESCE(SUM(CASE WHEN LOWER(COALESCE(f.FundName, t.OtherFundName, '')) LIKE '%polio%' THEN AmountUSD ELSE 0 END), 0) AS polioUsd,
                COALESCE(SUM(CASE WHEN LOWER(COALESCE(f.FundName, t.OtherFundName, '')) LIKE '%endowment%' THEN AmountUSD ELSE 0 END), 0) AS endowmentUsd
            FROM trf_contributions t
            LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
            WHERE t.fk_club_id = @ClubId AND t.isdeleted = 0
              AND (@YearId = 0 OR t.fk_year_id = @YearId)",
            new { ClubId = clubId, YearId = resolvedYearId });

        decimal trfRaised = (decimal)(trfRow?.totalUsd ?? 0m) * USD_INR;
        decimal annual = (decimal)(trfRow?.annualUsd ?? 0m) * USD_INR;
        decimal polio = (decimal)(trfRow?.polioUsd ?? 0m) * USD_INR;
        decimal endowment = (decimal)(trfRow?.endowmentUsd ?? 0m) * USD_INR;

        // Major Donors = donors whose CUMULATIVE giving in the year is >= $1000.
        // Previously counted per-contribution >= 1000, which under-counted
        // donors who reached the threshold through multiple smaller donations.
        var majorDonors = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM (
                SELECT DonorName, SUM(AmountUSD) AS total
                FROM trf_contributions
                WHERE fk_club_id = @ClubId AND isdeleted = 0
                  AND (@YearId = 0 OR fk_year_id = @YearId)
                GROUP BY DonorName
                HAVING SUM(AmountUSD) >= 1000
            ) major",
            new { ClubId = clubId, YearId = resolvedYearId });
        var phfContributors = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(DISTINCT DonorName) FROM trf_contributions
            WHERE fk_club_id = @ClubId AND isdeleted = 0
              AND (@YearId = 0 OR fk_year_id = @YearId)
              AND AmountUSD > 0",
            new { ClubId = clubId, YearId = resolvedYearId });

        var avgAttendance = await ComputeAvgAttendanceAsync(conn, clubId, resolvedYearId);

        // Overview "Service Projects" KPI counts the 4 SERVICE avenues only
        // (community + vocational + international + new-gen). Per user request
        // 2026-06-12, club_service (meetings) and public_image_initiative
        // (communications) are NOT counted as "service projects" on the card.
        int totalProjects = 0;
        var avenueDict = new Dictionary<string, int>();
        var tables = await GetTargetTablesAsync(conn, resolvedYearId);
        foreach (var t in tables)
        {
            var rows = await conn.QueryAsync<(string? moduleName, int cnt)>(
                $@"SELECT COALESCE(md.ModuleName, 'Other') AS moduleName, COUNT(*) AS cnt
                   FROM `{t.ProjectsTable}` p
                   LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
                   WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0
                     AND md.ModuleKey IN ('community_service','vocational_service','international_service','new_generation_service')
                   GROUP BY COALESCE(md.ModuleName, 'Other')",
                new { ClubId = clubId });
            foreach (var r in rows)
            {
                totalProjects += r.cnt;
                var key = r.moduleName ?? "Other";
                avenueDict[key] = avenueDict.GetValueOrDefault(key, 0) + r.cnt;
            }
        }
        var avenues = avenueDict.OrderByDescending(kv => kv.Value).Take(6).Select(kv => new ClubAdminAvenueRow { Avenue = kv.Key, Completed = kv.Value }).ToList();

        decimal citation = await conn.ExecuteScalarAsync<decimal?>(@"
            SELECT COALESCE(SUM(points_earned), 0) + COALESCE(SUM(bonus_earned), 0)
            FROM district_citation_club_entry
            WHERE fk_club_id = @ClubId AND isdeleted = 0
              AND (@YearId = 0 OR fk_year_id = @YearId)",
            new { ClubId = clubId, YearId = resolvedYearId }) ?? 0;

        var citationChecklist = new List<ClubAdminCitationRow>();
        try
        {
            var rows = await conn.QueryAsync<(string cat, decimal earned, decimal max)>(@"
                SELECT COALESCE(c.category_name, 'Other') AS cat,
                       COALESCE(SUM(e.points_earned), 0) + COALESCE(SUM(e.bonus_earned), 0) AS earned,
                       0 AS maxPts
                FROM district_citation_club_entry e
                LEFT JOIN district_citation_question q ON q.pk_question_id = e.fk_question_id
                LEFT JOIN district_citation_category c ON c.pk_category_id = q.fk_category_id
                WHERE e.fk_club_id = @ClubId AND e.isdeleted = 0
                  AND (@YearId = 0 OR e.fk_year_id = @YearId)
                GROUP BY COALESCE(c.category_name, 'Other')",
                new { ClubId = clubId, YearId = resolvedYearId });
            foreach (var r in rows)
                citationChecklist.Add(new ClubAdminCitationRow { Criterion = r.cat, Earned = r.earned, MaxPoints = r.max });
        }
        catch { /* schema may differ — skip */ }

        // Member growth — 9 months Jul-Mar
        var memberGrowth = new List<ClubAdminMemberGrowthPoint>();
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
                    WHERE cm.fk_club_id = @ClubId AND cm.isdeleted = 0
                      AND cm.JoinedDate >= @Start AND cm.JoinedDate < @End",
                    new { ClubId = clubId, Start = ms, End = me });
                memberGrowth.Add(new ClubAdminMemberGrowthPoint
                {
                    Month = label,
                    Male = (int)(long)(gRow?.male ?? 0L),
                    Female = (int)(long)(gRow?.female ?? 0L),
                    Honorary = (int)(long)(gRow?.honorary ?? 0L),
                });
            }
        }

        var upcoming = new List<ClubAdminEventRow>();
        var upcomingRows = await conn.QueryAsync<dynamic>(@"
            SELECT Title AS title, EventDate AS eventDate, EventVenue AS location
            FROM upcoming_events
            WHERE fk_club_id = @ClubId AND isdeleted = 0
              AND EventDate >= CURDATE()
            ORDER BY EventDate ASC LIMIT 8",
            new { ClubId = clubId });
        foreach (var r in upcomingRows)
        {
            DateTime? d = r.eventDate is DateTime dd ? dd : (DateTime?)null;
            upcoming.Add(new ClubAdminEventRow
            {
                Title = (r.title as string) ?? "",
                Type = "Event",
                Date = d?.ToString("yyyy-MM-dd"),
                Location = r.location as string,
            });
        }

        // Honorary members are NOT part of "Total Members" (business rule 2026-08-25, reconfirmed by
        // the user 2026-09-29) - an honorary member is not an active member of the club. `total` is the
        // raw row count, so take them off both figures; HonoraryMembers below still reports them.
        return new ClubAdminOverviewResponse
        {
            Club = identity,
            TotalMembers = total - honorary,
            ActiveMembers = total - honorary,
            MaleMembers = male,
            FemaleMembers = female,
            HonoraryMembers = honorary,
            NewMembersThisYear = newMembers,
            TerminatedThisYear = terminated,
            AvgAttendance = avgAttendance,
            TrfRaisedInr = trfRaised,
            TrfGoalInr = 0,
            ServiceProjects = totalProjects,
            ServiceGoal = 20,
            DistrictCitationScore = citation,
            TrfAnnualFund = annual,
            TrfPolioFund = polio,
            TrfEndowment = endowment,
            TrfMajorDonors = majorDonors,
            PhfContributors = phfContributors,
            Avenues = avenues,
            CitationChecklist = citationChecklist,
            MemberGrowth = memberGrowth,
            UpcomingEvents = upcoming,
        };
    }

    private async Task<decimal> ComputeAvgAttendanceAsync(MySqlConnection conn, int clubId, int yearId)
    {
        var rows = await conn.QueryAsync<(int total, int present)>(@"
            SELECT
                (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = a.fk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0) AS total,
                (SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) AS present
            FROM club_attendance a
            WHERE a.fk_club_id = @ClubId AND a.isdeleted = 0
              AND (@YearId = 0 OR a.fk_year_id = @YearId)",
            new { ClubId = clubId, YearId = yearId });
        var list = rows.Where(r => r.total > 0).ToList();
        if (list.Count == 0) return 0;
        return Math.Round(list.Average(r => (decimal)r.present / r.total * 100m), 1);
    }

    // ─── 2. FOUNDATION ──────────────────────────────────────────────────

    public async Task<ClubAdminFoundationResponse?> GetFoundationAsync(int memberId, int? yearId, int? requestedClubId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, clubId, resolvedYearId);
        if (identity == null) return null;

        var rows = await conn.QueryAsync<(string? fundName, decimal totalUsd, int donorCount)>(@"
            SELECT COALESCE(f.FundName, t.OtherFundName, 'Other') AS fundName,
                   COALESCE(SUM(t.AmountUSD), 0) AS totalUsd,
                   COUNT(DISTINCT t.DonorName) AS donorCount
            FROM trf_contributions t
            LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
            WHERE t.fk_club_id = @ClubId AND t.isdeleted = 0
              AND (@YearId = 0 OR t.fk_year_id = @YearId)
            GROUP BY COALESCE(f.FundName, t.OtherFundName, 'Other')",
            new { ClubId = clubId, YearId = resolvedYearId });

        var metrics = new List<ClubAdminFundMetric>();
        decimal totalInr = 0, annual = 0, polio = 0, endowment = 0, others = 0;
        int majorDonors = 0;
        foreach (var r in rows)
        {
            var inr = r.totalUsd * USD_INR;
            metrics.Add(new ClubAdminFundMetric
            {
                Id = (r.fundName ?? "other").ToLowerInvariant().Replace(' ', '_'),
                Name = r.fundName ?? "Other",
                Value = inr,
                Unit = "USD",
            });
            totalInr += inr;
            var lower = (r.fundName ?? "").ToLowerInvariant();
            if (lower.Contains("annual")) annual += inr;
            else if (lower.Contains("polio")) polio += inr;
            else if (lower.Contains("endowment")) endowment += inr;
            else others += inr;
        }
        // Aggregate-per-donor definition (>= $1000 cumulative for the year) —
        // matches TRF's "Major Donor" convention and stays consistent with the
        // Overview hero card's identical metric.
        majorDonors = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM (
                SELECT DonorName, SUM(AmountUSD) AS total
                FROM trf_contributions
                WHERE fk_club_id = @ClubId AND isdeleted = 0
                  AND (@YearId = 0 OR fk_year_id = @YearId)
                GROUP BY DonorName
                HAVING SUM(AmountUSD) >= 1000
            ) major",
            new { ClubId = clubId, YearId = resolvedYearId });

        return new ClubAdminFoundationResponse
        {
            Club = identity,
            Metrics = metrics,
            TotalCollectedInr = totalInr,
            AnnualFundInr = annual,
            PolioFundInr = polio,
            EndowmentInr = endowment,
            OthersInr = others,
            MajorDonors = majorDonors,
        };
    }

    // ─── 3. MEMBERSHIP ──────────────────────────────────────────────────

    public async Task<ClubAdminMembershipResponse?> GetMembershipAsync(int memberId, int? yearId, int? requestedClubId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, clubId, resolvedYearId);
        if (identity == null) return null;

        var members = (await conn.QueryAsync<ClubAdminMemberRow>(@"
            SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS name,
                   m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
                   m.Gender AS gender, m.RotaryId AS rotaryId,
                   DATE_FORMAT(cm.JoinedDate, '%Y-%m-%d') AS joinedDate
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            LEFT JOIN member_roles mr ON mr.fk_member_master_profile_id = m.pk_member_master_profile_id
                AND mr.IsActive = 1 AND mr.isdeleted = 0
                AND ((mr.fk_role_id = 2 AND mr.fk_club_id = @ClubId)
                  OR (mr.fk_role_id = 2 AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
                      AND mr.fk_district_id = (SELECT fk_district_id FROM club_master WHERE pk_club_id = @ClubId)))
            WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
            GROUP BY m.pk_member_master_profile_id, m.MemberName, m.EmailId, m.PrimaryMobileNumber,
                     m.Gender, m.RotaryId, cm.JoinedDate
            ORDER BY
                CASE
                    WHEN MAX(CASE WHEN mr.fk_role_id = 2 THEN 1 ELSE 0 END) = 1 THEN 0
                    WHEN m.PrimaryMobileNumber IS NULL OR m.PrimaryMobileNumber = '' THEN 1
                    ELSE 2
                END,
                m.MemberName",
            new { ClubId = clubId })).ToList();

        var stats = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT
                SUM(CASE WHEN m.Gender = 'Male' THEN 1 ELSE 0 END) AS male,
                SUM(CASE WHEN m.Gender = 'Female' THEN 1 ELSE 0 END) AS female,
                SUM(CASE WHEN cm.IsHonoraryMember = 1 THEN 1 ELSE 0 END) AS honorary
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0",
            new { ClubId = clubId });

        var (start, end) = await YearRangeAsync(conn, resolvedYearId);
        int newMembers = 0, terminated = 0;
        var recent = new List<ClubAdminMemberRow>();
        var trend = new List<ClubAdminMemberGrowthPoint>();
        if (start != null)
        {
            newMembers = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_members
                WHERE fk_club_id = @ClubId AND isdeleted = 0
                  AND JoinedDate >= @Start AND JoinedDate <= @End",
                new { ClubId = clubId, Start = start, End = end });
            terminated = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_members
                WHERE fk_club_id = @ClubId AND isdeleted = 1
                  AND deleted_date >= @Start AND deleted_date <= @End",
                new { ClubId = clubId, Start = start, End = end });

            recent = (await conn.QueryAsync<ClubAdminMemberRow>(@"
                SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS name,
                       m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
                       m.Gender AS gender, m.RotaryId AS rotaryId,
                       DATE_FORMAT(cm.JoinedDate, '%Y-%m-%d') AS joinedDate
                FROM club_members cm
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                WHERE cm.fk_club_id = @ClubId AND cm.isdeleted = 0
                  AND cm.JoinedDate >= @Start AND cm.JoinedDate <= @End
                ORDER BY cm.JoinedDate DESC LIMIT 10",
                new { ClubId = clubId, Start = start, End = end })).ToList();

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
                    WHERE cm.fk_club_id = @ClubId AND cm.isdeleted = 0
                      AND cm.JoinedDate >= @Start AND cm.JoinedDate < @End",
                    new { ClubId = clubId, Start = ms, End = me });
                trend.Add(new ClubAdminMemberGrowthPoint
                {
                    Month = label,
                    Male = (int)(long)(gRow?.male ?? 0L),
                    Female = (int)(long)(gRow?.female ?? 0L),
                    Honorary = (int)(long)(gRow?.honorary ?? 0L),
                });
            }
        }

        // Honorary members are never counted as part of "Total Members" (business rule
        // 2026-08-25) — an honorary member is not an active member of the club. They are
        // still surfaced separately via HonoraryMembers for anywhere that wants to show them.
        var honoraryCount = (int)(long)(stats?.honorary ?? 0L);
        return new ClubAdminMembershipResponse
        {
            Club = identity,
            TotalMembers = members.Count - honoraryCount,
            MaleMembers = (int)(long)(stats?.male ?? 0L),
            FemaleMembers = (int)(long)(stats?.female ?? 0L),
            HonoraryMembers = honoraryCount,
            NewMembersThisYear = newMembers,
            TerminatedThisYear = terminated,
            Members = members,
            RecentJoiners = recent,
            MonthlyTrend = trend,
        };
    }

    // ─── 4. AVENUE / SERVICE PROJECTS ───────────────────────────────────

    public async Task<ClubAdminAvenueResponse?> GetAvenueAsync(int memberId, int? yearId, int? requestedClubId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, clubId, resolvedYearId);
        if (identity == null) return null;

        var avenueDict = new Dictionary<string, int>();
        var projects = new List<ClubAdminProjectRow>();
        decimal totalCost = 0;
        int totalBenef = 0;
        var tables = await GetTargetTablesAsync(conn, resolvedYearId);
        // TotalCost is converted into the district default currency; rows keep their native currency.
        var targetCurrency = await ResolveClubTargetCurrencyAsync(conn, clubId);
        var fxRates = await _fx.GetInrRatesAsync();

        foreach (var t in tables)
        {
            var rows = await conn.QueryAsync<dynamic>(
                $@"SELECT p.title, COALESCE(md.ModuleName, 'Other') AS avenue,
                          COALESCE(aof.name, '') AS category,
                          p.project_date AS projectDate,
                          COALESCE(p.project_cost, 0) AS cost,
                          COALESCE(p.Currency, 'INR') AS currency,
                          COALESCE(p.direct_beneficiaries, 0) AS beneficiaries,
                          COALESCE(f.name, 'Self Funded') AS funding,
                          COALESCE(p.approval_status, '') AS approvalStatus
                   FROM `{t.ProjectsTable}` p
                   LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
                   LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
                   LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
                   WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0
                   ORDER BY p.project_date DESC",
                new { ClubId = clubId });
            foreach (var r in rows)
            {
                var av = (r.avenue as string) ?? "Other";
                avenueDict[av] = avenueDict.GetValueOrDefault(av, 0) + 1;
                DateTime? d = r.projectDate is DateTime dd ? dd : (DateTime?)null;
                decimal cost = r.cost is decimal cc ? cc : 0;
                string curr = CurrencyHelper.Normalize(r.currency as string);
                int benef = r.beneficiaries is long b1 ? (int)b1 : (r.beneficiaries is int b2 ? b2 : 0);
                totalCost += CurrencyHelper.Convert(cost, curr, targetCurrency, fxRates);
                totalBenef += benef;
                projects.Add(new ClubAdminProjectRow
                {
                    Title = (r.title as string) ?? "",
                    Avenue = av,
                    Category = r.category as string,
                    Date = d?.ToString("yyyy-MM-dd"),
                    Cost = cost,
                    Currency = curr,
                    Beneficiaries = benef,
                    Funding = r.funding as string,
                    ApprovalStatus = (r.approvalStatus as string) ?? "",
                });
            }
        }

        return new ClubAdminAvenueResponse
        {
            Club = identity,
            Avenues = avenueDict.OrderByDescending(kv => kv.Value).Select(kv => new ClubAdminAvenueRow { Avenue = kv.Key, Completed = kv.Value }).ToList(),
            Projects = projects,
            TotalProjects = projects.Count,
            TotalCost = totalCost,
            TargetCurrency = targetCurrency,
            TotalBeneficiaries = totalBenef,
        };
    }

    // ─── 5. E-GOVERNANCE ────────────────────────────────────────────────

    public async Task<ClubAdminEGovernanceResponse?> GetEGovernanceAsync(int memberId, int? yearId, int? requestedClubId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, clubId, resolvedYearId);
        if (identity == null) return null;

        var cmrRows = (await conn.QueryAsync<dynamic>(@"
            SELECT ReportMonth, IsUploadedToDistrict AS submitted,
                   DATE_FORMAT(created_date, '%Y-%m-%d') AS submittedDate
            FROM club_monthly_reports
            WHERE fk_club_id = @ClubId AND isdeleted = 0
              AND (@YearId = 0 OR fk_year_id = @YearId)
            ORDER BY ReportMonth DESC",
            new { ClubId = clubId, YearId = resolvedYearId })).ToList();

        var cmrList = cmrRows.Select(r => new ClubAdminCmrRow
        {
            ReportMonth = r.ReportMonth?.ToString() ?? "",
            // MySQL TINYINT(1) comes back as bool, byte, sbyte, short, int or long
            // depending on driver/server combo — Convert.ToBoolean handles them all.
            IsSubmitted = r.submitted != null && Convert.ToBoolean(r.submitted),
            SubmittedDate = r.submittedDate as string,
        }).ToList();

        int cmrSubmitted = cmrList.Count(c => c.IsSubmitted);
        int cmrPending = cmrList.Count - cmrSubmitted;

        var meetingRows = (await conn.QueryAsync<dynamic>(@"
            SELECT a.EventDateTime AS meetingDate,
                   a.EventName AS topic,
                   (SELECT COUNT(*) FROM club_attendance_members am WHERE am.fk_attendance_id = a.pk_attendance_id) AS present,
                   (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = a.fk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0) AS total
            FROM club_attendance a
            WHERE a.fk_club_id = @ClubId AND a.isdeleted = 0
              AND (@YearId = 0 OR a.fk_year_id = @YearId)
            ORDER BY a.EventDateTime DESC LIMIT 20",
            new { ClubId = clubId, YearId = resolvedYearId })).ToList();

        var meetings = new List<ClubAdminAttendanceRow>();
        foreach (var r in meetingRows)
        {
            DateTime? d = r.meetingDate is DateTime dd ? dd : (DateTime?)null;
            int present = r.present is long p1 ? (int)p1 : (r.present is int p2 ? p2 : 0);
            int total = r.total is long t1 ? (int)t1 : (r.total is int t2 ? t2 : 0);
            decimal pct = total > 0 ? Math.Round((decimal)present / total * 100m, 1) : 0;
            meetings.Add(new ClubAdminAttendanceRow
            {
                Date = d?.ToString("yyyy-MM-dd") ?? "",
                Topic = r.topic as string,
                Present = present,
                Total = total,
                Pct = pct,
            });
        }

        return new ClubAdminEGovernanceResponse
        {
            Club = identity,
            ClubMonthlyReports = cmrList,
            RecentMeetings = meetings,
            CmrSubmitted = cmrSubmitted,
            CmrPending = cmrPending,
            AvgAttendance = await ComputeAvgAttendanceAsync(conn, clubId, resolvedYearId),
            MeetingsHeld = meetings.Count,
        };
    }

    // ─── 6. COMMUNICATION ───────────────────────────────────────────────

    public async Task<ClubAdminCommunicationResponse?> GetCommunicationAsync(int memberId, int? yearId, int? requestedClubId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, clubId, resolvedYearId);
        if (identity == null) return null;

        // Communication tables (announcements, newsletters, upcoming_events, club_documents)
        // have no fk_year_id — we filter by PublishDateTime/EventDate falling within the
        // Rotary year window (1 Jul → 30 Jun). yearStart/yearEnd null ⇒ no year filter.
        var (yearStart, yearEnd) = await YearRangeAsync(conn, resolvedYearId);
        var yStart = yearStart;
        var yEnd = yearEnd;

        var announcements = (await conn.QueryAsync<dynamic>(@"
            SELECT Title AS title, PublishDateTime AS publishDate,
                   CASE WHEN ImagePath IS NULL OR ImagePath = '' THEN NULL
                        WHEN ImagePath LIKE '/%' THEN ImagePath
                        ELSE CONCAT('/Documents/announcement/Group', fk_club_id, '/', ImagePath) END AS imagePath,
                   Description AS description
            FROM announcements
            WHERE fk_club_id = @ClubId AND isdeleted = 0
              AND (@YStart IS NULL OR PublishDateTime BETWEEN @YStart AND @YEnd)
            ORDER BY PublishDateTime DESC LIMIT 15",
            new { ClubId = clubId, YStart = yStart, YEnd = yEnd })).ToList();
        var announcementTotal = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM announcements
            WHERE fk_club_id = @ClubId AND isdeleted = 0
              AND (@YStart IS NULL OR PublishDateTime BETWEEN @YStart AND @YEnd)",
            new { ClubId = clubId, YStart = yStart, YEnd = yEnd });

        var newsletters = (await conn.QueryAsync<dynamic>(@"
            SELECT Title AS title, PublishDateTime AS publishDate
            FROM newsletters
            WHERE fk_club_id = @ClubId AND COALESCE(isdeleted, 0) = 0
              AND (@YStart IS NULL OR PublishDateTime BETWEEN @YStart AND @YEnd)
            ORDER BY PublishDateTime DESC LIMIT 15",
            new { ClubId = clubId, YStart = yStart, YEnd = yEnd })).ToList();
        var newsletterTotal = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM newsletters
            WHERE fk_club_id = @ClubId AND COALESCE(isdeleted, 0) = 0
              AND (@YStart IS NULL OR PublishDateTime BETWEEN @YStart AND @YEnd)",
            new { ClubId = clubId, YStart = yStart, YEnd = yEnd });

        // Upcoming events: when no year picked, keep the classic "future events" view.
        // When a year IS picked, show ALL events falling in that year's window regardless
        // of whether they're past or future — the topbar is now the source of truth.
        var events = (await conn.QueryAsync<dynamic>(@"
            SELECT Title AS title, EventDate AS publishDate, EventVenue AS description
            FROM upcoming_events
            WHERE fk_club_id = @ClubId AND isdeleted = 0
              AND (
                (@YStart IS NULL AND EventDate >= CURDATE())
                OR (@YStart IS NOT NULL AND EventDate BETWEEN @YStart AND @YEnd)
              )
            ORDER BY EventDate ASC LIMIT 15",
            new { ClubId = clubId, YStart = yStart, YEnd = yEnd })).ToList();
        var eventTotal = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM upcoming_events
            WHERE fk_club_id = @ClubId AND isdeleted = 0
              AND (
                (@YStart IS NULL AND EventDate >= CURDATE())
                OR (@YStart IS NOT NULL AND EventDate BETWEEN @YStart AND @YEnd)
              )",
            new { ClubId = clubId, YStart = yStart, YEnd = yEnd });

        // Shared Documents — read-only list. Defensive: documents table may not
        // exist on every DB; degrade gracefully to empty.
        var documents = new List<dynamic>();
        var documentTotal = 0;
        try
        {
            documents = (await conn.QueryAsync<dynamic>(@"
                SELECT Title AS title, PublishDateTime AS publishDate
                FROM documents
                WHERE fk_club_id = @ClubId AND isdeleted = 0
                  AND (@YStart IS NULL OR PublishDateTime BETWEEN @YStart AND @YEnd)
                ORDER BY PublishDateTime DESC LIMIT 15",
                new { ClubId = clubId, YStart = yStart, YEnd = yEnd })).ToList();
            documentTotal = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM documents
                WHERE fk_club_id = @ClubId AND isdeleted = 0
                  AND (@YStart IS NULL OR PublishDateTime BETWEEN @YStart AND @YEnd)",
                new { ClubId = clubId, YStart = yStart, YEnd = yEnd });
        }
        catch { /* table missing — ignore */ }

        // Greetings — birthdays + anniversaries for THIS month. Frontend filters
        // for Today / Week / Month from this same list. Read-only.
        var birthdays = (await conn.QueryAsync<ClubAdminGreetingRow>(@"
            SELECT m.MemberName AS Name, m.PrimaryMobileNumber AS Mobile,
                   m.BirthDate AS Date, 'birthday' AS Kind, DAY(m.BirthDate) AS Day
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND m.BirthDate IS NOT NULL AND MONTH(m.BirthDate) = MONTH(CURDATE())
            ORDER BY DAY(m.BirthDate), m.MemberName",
            new { ClubId = clubId })).ToList();

        var anniversaries = (await conn.QueryAsync<ClubAdminGreetingRow>(@"
            SELECT m.MemberName AS Name, m.PrimaryMobileNumber AS Mobile,
                   m.AnniversaryDate AS Date, 'anniversary' AS Kind, DAY(m.AnniversaryDate) AS Day
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND m.AnniversaryDate IS NOT NULL AND MONTH(m.AnniversaryDate) = MONTH(CURDATE())
            ORDER BY DAY(m.AnniversaryDate), m.MemberName",
            new { ClubId = clubId })).ToList();

        int today = DateTime.Now.Day;
        var greetingsTodayCount = birthdays.Count(b => b.Day == today) + anniversaries.Count(a => a.Day == today);

        ClubAdminCommunicationItem Mk(dynamic r, string kind)
        {
            DateTime? d = r.publishDate is DateTime dd ? dd : (DateTime?)null;
            return new ClubAdminCommunicationItem
            {
                Kind = kind,
                Title = (r.title as string) ?? "",
                PublishDate = d?.ToString("yyyy-MM-dd"),
                ImagePath = (kind == "announcement" ? r.imagePath as string : null),
                Description = kind != "newsletter" ? r.description as string : null,
            };
        }

        return new ClubAdminCommunicationResponse
        {
            Club = identity,
            AnnouncementCount = announcementTotal,
            NewsletterCount = newsletterTotal,
            UpcomingEventCount = eventTotal,
            DocumentCount = documentTotal,
            GreetingsTodayCount = greetingsTodayCount,
            Announcements = announcements.Select(r => Mk(r, "announcement")).ToList(),
            Newsletters = newsletters.Select(r => Mk(r, "newsletter")).ToList(),
            UpcomingEvents = events.Select(r => Mk(r, "event")).ToList(),
            Documents = documents.Select(r => Mk(r, "document")).ToList(),
            BirthdaysThisMonth = birthdays,
            AnniversariesThisMonth = anniversaries,
        };
    }

    // ─── 7. WEBSITE ─────────────────────────────────────────────────────

    public async Task<ClubAdminWebsiteResponse?> GetWebsiteAsync(int memberId, int? yearId, int? requestedClubId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, clubId, resolvedYearId);
        if (identity == null) return null;

        // isdeleted is a nullable TINYINT(1) DEFAULT 0 on club_websites — some legacy rows
        // have NULL rather than 0, which a plain `isdeleted = 0` silently excludes. COALESCE
        // so this agrees with GlobalSearchController's already-defensive check (same table).
        var ws = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT Subdomain, ClientDomain, EndDate AS endDate, AmountPaid AS amountPaid, TransactionId AS transactionId,
                   IsPurchased AS isPurchased, Status AS rawStatus, created_date AS createdDate
            FROM club_websites
            WHERE fk_club_id = @ClubId AND COALESCE(isdeleted, 0) = 0
            ORDER BY pk_id DESC LIMIT 1",
            new { ClubId = clubId });

        if (ws == null)
        {
            return new ClubAdminWebsiteResponse { Club = identity, Configured = false, Status = "not_configured" };
        }

        DateTime? expiry = ws.endDate is DateTime e ? e : (DateTime?)null;
        decimal amountPaid = ws.amountPaid is decimal a ? a : 0;
        // Purchased is the source of truth once set explicitly (admin can mark Purchased with no
        // payment data yet); Amount/TransactionId remain a fallback for legacy rows.
        bool isPaid = Convert.ToBoolean(ws.isPurchased) || amountPaid > 0
            || !string.IsNullOrWhiteSpace((string?)ws.transactionId);
        string rawStatus = (ws.rawStatus as string ?? "").Trim();
        bool isActive = string.Equals(rawStatus, "Active", StringComparison.OrdinalIgnoreCase);
        bool killSwitch = false; // No kill_switch column on club_websites — kept off for now
        string status;
        if (!isActive && rawStatus.Length > 0) status = rawStatus.ToLowerInvariant();
        else if (!isActive) status = "inactive";
        else if (expiry == null) status = "trial";
        else if (expiry < DateTime.Today) status = isPaid ? "expired" : "trial_expired";
        else status = isPaid ? "active" : "trial";

        // Menu is not year-wise (see feedback_social_links_not_yearwise memory — same reasoning).
        // Banners ARE year-wise (fk_year_id exists). Events/announcements have no fk_year_id;
        // filter by PublishDateTime/EventDate falling within the Rotary year window.
        var (wsYStart, wsYEnd) = await YearRangeAsync(conn, resolvedYearId);
        int menuCount = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_website_menu WHERE fk_club_id = @ClubId AND isdeleted = 0",
            new { ClubId = clubId });
        int bannerCount = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_website_banner
            WHERE fk_club_id = @ClubId AND isdeleted = 0
              AND (@YearId = 0 OR fk_year_id = @YearId)",
            new { ClubId = clubId, YearId = resolvedYearId });
        int evCount = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM upcoming_events
            WHERE fk_club_id = @ClubId AND isdeleted = 0
              AND (@YStart IS NULL OR EventDate BETWEEN @YStart AND @YEnd)",
            new { ClubId = clubId, YStart = wsYStart, YEnd = wsYEnd });
        int annCount = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM announcements
            WHERE fk_club_id = @ClubId AND isdeleted = 0
              AND (@YStart IS NULL OR PublishDateTime BETWEEN @YStart AND @YEnd)",
            new { ClubId = clubId, YStart = wsYStart, YEnd = wsYEnd });

        DateTime? created = ws.createdDate is DateTime cc ? cc : (DateTime?)null;

        // The mobile app opens whatever string we put in `thirdPartyDomain` mostly
        // as-is, so we write the FINAL sanitised URL into that field (full https://...
        // when a real domain or subdomain is configured; empty string "" otherwise —
        // never "na" / "null" / "n/a", else the app would build https://na). Same
        // helper used by ClubFinderController + AccessibleClubs[].WebsiteUrl, so
        // sanitisation is identical across all surfaces. `subdomain` is still
        // returned as a fallback.
        var parentDomain = await conn.ExecuteScalarAsync<string?>(
            "SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteParentDomain' LIMIT 1");
        if (string.IsNullOrWhiteSpace(parentDomain)) parentDomain = RotaryApi.Services.Brand.ClubSiteParentDomain;

        var resolvedUrl = MemberScopesHelper.BuildWebsiteUrl(
            ws.ClientDomain as string, ws.Subdomain as string, parentDomain);

        return new ClubAdminWebsiteResponse
        {
            Club = identity,
            Configured = true,
            Subdomain = (ws.Subdomain as string) ?? "",
            ThirdPartyDomain = resolvedUrl,
            VisitUrl = resolvedUrl,
            Status = status,
            ActivatedDate = created?.ToString("yyyy-MM-dd"),
            ExpiryDate = expiry?.ToString("yyyy-MM-dd"),
            MenuCount = menuCount,
            BannerCount = bannerCount,
            EventCount = evCount,
            AnnouncementCount = annCount,
            KillSwitchOn = killSwitch,
        };
    }

    // ─── 8. PAYMENTS ────────────────────────────────────────────────────

    public async Task<ClubAdminPaymentsResponse?> GetPaymentsAsync(int memberId, int? yearId, int? requestedClubId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, clubId, resolvedYearId);
        if (identity == null) return null;

        var yearLabel = identity.YearLabel;
        var duesRow = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_membership_dues_id AS id, OnlineSurchargePercent,
                   IsFees1, IsFees2, IsFees3, DefaultAnnualAmount, DefaultSemi1Amount, DefaultSemi2Amount
            FROM membership_dues
            WHERE fk_club_id = @ClubId AND RotaryYear = @YearLabel AND IsActive = 1 AND isdeleted = 0
            ORDER BY pk_membership_dues_id DESC LIMIT 1",
            new { ClubId = clubId, YearLabel = yearLabel });

        if (duesRow == null)
        {
            return new ClubAdminPaymentsResponse { Club = identity };
        }
        int duesId = (int)duesRow.id;
        decimal surchargePercent = (decimal)duesRow.OnlineSurchargePercent;

        // Each member's due is the campaign's own CONFIGURED base amount, not
        // whatever happens to be stored on their individual fee row — a few
        // members can carry stale/customized per-member amounts (e.g. from
        // before a migration) that would otherwise throw off the KPI totals
        // and misclassify an actually-fully-paid member as "partial". Annual
        // and Semi1+Semi2 are EQUIVALENT (same money, one lump vs two halves),
        // so prefer Annual when enabled+non-zero, else fall back to Semi1+Semi2.
        bool isFees1 = (bool)duesRow.IsFees1;
        bool isFees2 = (bool)duesRow.IsFees2;
        bool isFees3 = (bool)duesRow.IsFees3;
        decimal defaultAnnual = (decimal)duesRow.DefaultAnnualAmount;
        decimal perMemberDue = (isFees1 && defaultAnnual > 0)
            ? defaultAnnual
            : (isFees2 ? (decimal)duesRow.DefaultSemi1Amount : 0) + (isFees3 ? (decimal)duesRow.DefaultSemi2Amount : 0);

        // Exclude honorary members from the dues KPI + list (added 2026-07-09).
        // Honoraries don't pay dues, so counting them in totalDue / paidCount /
        // unpaidCount produced a misleading "collection rate". They're counted
        // separately via HonoraryCount below so the dashboard can surface the
        // number in the subtitle (e.g. "from 23 members + 2 honorary").
        var members = (await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                   COALESCE((SELECT SUM(CASE WHEN p.IsOnline = 1 THEN ROUND(p.Amount / (1 + @SurchargePercent / 100), 2) ELSE p.Amount END)
                             FROM membership_dues_payments p
                             WHERE p.fk_member_profile_id = m.pk_member_master_profile_id
                               AND p.fk_membership_dues_id = @DuesId AND p.IsPaid = 1), 0) AS paid
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND COALESCE(cm.IsHonoraryMember, 0) = 0
            ORDER BY m.MemberName",
            new { ClubId = clubId, DuesId = duesId, SurchargePercent = surchargePercent })).ToList();

        var honoraryCount = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_members
            WHERE fk_club_id = @ClubId AND IsActive = 1 AND isdeleted = 0
              AND COALESCE(IsHonoraryMember, 0) = 1",
            new { ClubId = clubId });

        var list = new List<ClubAdminDuesMemberRow>();
        decimal totalDueNet = 0;                         // net of the online surcharge
        int paidCount = 0, unpaidCount = 0, partialCount = 0;
        decimal roundedPerMemberDue = Math.Round(perMemberDue, MidpointRounding.AwayFromZero);
        foreach (var r in members)
        {
            decimal due = perMemberDue;
            decimal paid = r.paid is decimal pp ? pp : 0;
            // due is already the ONE true (base) amount, and paid has already
            // had the online surcharge backed out per-payment in the SQL above
            // (see the CASE WHEN p.IsOnline=1 clause) — both are already
            // net-of-surcharge, so no further deduction is needed here. Still
            // rounded PER MEMBER (not after summing) to match the web dues
            // tile's rounding order exactly.
            totalDueNet += Math.Round(due, MidpointRounding.AwayFromZero);
            // 1-paisa tolerance: paid is a back-out division of an amount that
            // was rounded to 2dp at charge time (ComputeOnlineAmount), so it
            // rarely reconstructs the exact base figure — a strict >= here
            // misclassified fully-paid online members as "partial"/"unpaid".
            string status;
            if (due == 0) status = "no_dues";
            else if (paid >= due - 0.01m) { status = "paid"; paidCount++; }
            else if (paid > 0) { status = "partial"; partialCount++; }
            else { status = "unpaid"; unpaidCount++; }

            list.Add(new ClubAdminDuesMemberRow
            {
                MemberId = (int)(long)r.memberId,
                MemberName = (r.memberName as string) ?? "",
                AmountDue = due,
                AmountPaid = paid,
                Status = status,
            });
        }
        // Collected = base amount × number of fully-paid members — NOT a sum of actual
        // payment amounts. Summing actual payments would also pull in partial-payment
        // amounts (arbitrary, member-specific figures), which understates/misrepresents
        // "how much has been collected at the campaign's own rate."
        decimal totalPaidNet = roundedPerMemberDue * paidCount;

        return new ClubAdminPaymentsResponse
        {
            Club = identity,
            TotalDue = totalDueNet,
            TotalCollected = totalPaidNet,
            PaidCount = paidCount,
            UnpaidCount = unpaidCount,
            PartialCount = partialCount,
            HonoraryCount = honoraryCount,
            Members = list,
        };
    }

    // ─── DASHBOARD SUB-TABS (Phase B) ────────────────────────────────────

    // Dashboard › Directory
    public async Task<ClubAdminDashboardDirectoryResponse?> GetDashboardDirectoryAsync(int memberId, int? yearId, int? requestedClubId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, clubId, resolvedYearId);
        if (identity == null) return null;

        // Members with their photo, gender, honorary flag, and an optional designation
        // pulled from the current year's BOD (so "President", "Secretary" surface on the
        // directory row instead of just a blank "member" line).
        // ProfilePhotoPath (not PhotoPath) — wrapped in the same CASE expression
        // existing controllers use so the path is web-servable.
        var rows = (await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId,
                   m.MemberName AS name,
                   m.EmailId AS email,
                   m.PrimaryMobileNumber AS mobile,
                   m.Gender AS gender,
                   m.RotaryId AS rotaryId,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS photoPath,
                   COALESCE(cm.IsHonoraryMember, 0) AS isHonorary,
                   DATE_FORMAT(cm.JoinedDate, '%Y-%m-%d') AS joinedDate,
                   (SELECT dg.designation_name
                      FROM board_of_directors bod
                      JOIN designation_master dg ON dg.pk_designation_id = bod.fk_designation_id
                     WHERE bod.fk_member_master_profile_id = m.pk_member_master_profile_id
                       AND bod.fk_club_id = @ClubId
                       AND bod.isdeleted = 0
                       AND (@YearId = 0 OR bod.fk_year_id = @YearId)
                     ORDER BY dg.sort_order LIMIT 1) AS designation,
                   (SELECT COUNT(*) FROM member_roles mr
                     WHERE mr.fk_member_master_profile_id = m.pk_member_master_profile_id
                       AND mr.fk_role_id = 2
                       AND mr.fk_club_id = @ClubId
                       AND mr.IsActive = 1
                       AND mr.isdeleted = 0) AS adminFlag,
                   (SELECT COUNT(*) FROM member_roles mr
                     WHERE mr.fk_member_master_profile_id = m.pk_member_master_profile_id
                       AND mr.fk_role_id = 2
                       AND mr.fk_district_id = (SELECT fk_district_id FROM club_master WHERE pk_club_id = @ClubId)
                       AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
                       AND mr.IsActive = 1
                       AND mr.isdeleted = 0) AS districtAdminFlag
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
            ORDER BY m.MemberName",
            new { ClubId = clubId, YearId = resolvedYearId })).ToList();

        var members = new List<ClubAdminDashboardDirectoryMemberRow>();
        int honorary = 0, clubAdmins = 0, male = 0, female = 0;
        foreach (var r in rows)
        {
            bool isHonorary = Convert.ToBoolean(r.isHonorary);
            bool isClubAdmin = (int)(long)(r.adminFlag ?? 0L) > 0;
            bool isDistrictAdmin = (int)(long)(r.districtAdminFlag ?? 0L) > 0;
            string genderStr = (r.gender as string) ?? "";
            if (isHonorary) honorary++;
            if (isClubAdmin) clubAdmins++;
            if (string.Equals(genderStr, "Male", StringComparison.OrdinalIgnoreCase)) male++;
            else if (string.Equals(genderStr, "Female", StringComparison.OrdinalIgnoreCase)) female++;
            members.Add(new ClubAdminDashboardDirectoryMemberRow
            {
                MemberId = (int)(long)r.memberId,
                Name = (r.name as string) ?? "",
                Email = r.email as string,
                Mobile = r.mobile as string,
                Gender = r.gender as string,
                RotaryId = r.rotaryId as string,
                PhotoPath = r.photoPath as string,
                Designation = r.designation as string,
                IsHonorary = isHonorary,
                IsClubAdmin = isClubAdmin,
                IsDistrictAdmin = isDistrictAdmin,
                JoinedDate = r.joinedDate as string,
            });
        }

        return new ClubAdminDashboardDirectoryResponse
        {
            Club = identity,
            // Same rule as Membership and the district clubs list: honorary members sit OUTSIDE the
            // total (user 2026-09-29). FullMembers is the same figure, kept for the existing tile.
            TotalMembers = members.Count - honorary,
            FullMembers = members.Count - honorary,
            HonoraryMembers = honorary,
            ClubAdminsCount = clubAdmins,
            MaleMembers = male,
            FemaleMembers = female,
            Members = members,
        };
    }

    // Dashboard › Board of Directors
    public async Task<ClubAdminDashboardBodResponse?> GetDashboardBodAsync(int memberId, int? yearId, int? requestedClubId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, clubId, resolvedYearId);
        if (identity == null) return null;

        // Available years — keep dropdown limited to years that actually have BOD rows.
        var availableYears = (await conn.QueryAsync<dynamic>(@"
            SELECT y.pk_year_id AS id, y.YearLabel AS yearLabel,
                   COALESCE(y.IsCurrent, 0) AS isCurrent
            FROM rotary_year_master y
            WHERE EXISTS (
                SELECT 1 FROM board_of_directors b
                WHERE b.fk_club_id = @ClubId AND b.fk_year_id = y.pk_year_id AND b.isdeleted = 0
            )
            ORDER BY y.pk_year_id DESC",
            new { ClubId = clubId })).ToList();

        var yearOptions = availableYears.Select(y => new ClubAdminYearOption
        {
            Id = (int)y.id,
            YearLabel = (y.yearLabel as string) ?? "",
            IsCurrent = Convert.ToBoolean(y.isCurrent),
        }).ToList();

        // Resolve selected year — request → current → newest with data
        int selectedYearId = resolvedYearId;
        if (selectedYearId <= 0 || !yearOptions.Any(o => o.Id == selectedYearId))
        {
            selectedYearId = yearOptions.FirstOrDefault()?.Id ?? 0;
        }
        string selectedYearLabel = yearOptions.FirstOrDefault(o => o.Id == selectedYearId)?.YearLabel ?? "";

        // LEFT JOIN member so non-member BOD rows (past years) render too. The WHERE guard keeps
        // orphaned/soft-deleted member rows hidden while including non-member rows (member FK NULL).
        var bodRows = (await conn.QueryAsync<dynamic>(@"
            SELECT b.pk_board_director_id AS id,
                   b.fk_designation_id AS designationId,
                   d.designation_name AS designation,
                   d.sort_order AS sortOrder,
                   m.pk_member_master_profile_id AS memberId,
                   CASE WHEN b.fk_member_master_profile_id IS NOT NULL THEN 1 ELSE 0 END AS isMember,
                   COALESCE(m.MemberName, b.non_member_name, '') AS name,
                   COALESCE(m.EmailId, b.non_member_email) AS email,
                   COALESCE(m.PrimaryMobileNumber, b.non_member_mobile) AS mobile,
                   CASE
                       WHEN b.fk_member_master_profile_id IS NULL THEN NULL
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS photoPath
            FROM board_of_directors b
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
            LEFT JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
            WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId AND b.isdeleted = 0
              AND (b.fk_member_master_profile_id IS NULL OR m.pk_member_master_profile_id IS NOT NULL)
            ORDER BY
                CASE b.fk_designation_id WHEN 1 THEN 0 WHEN 2 THEN 1 ELSE 2 END,
                d.sort_order, d.designation_name",
            new { ClubId = clubId, YearId = selectedYearId })).ToList();

        var directors = bodRows.Select((r, i) => new ClubAdminDashboardBodRow
        {
            Id = (int)(long)r.id,
            Sr = i + 1,
            Name = (r.name as string) ?? "",
            Designation = (r.designation as string) ?? "",
            DesignationSortOrder = r.sortOrder is null ? (int?)null : Convert.ToInt32(r.sortOrder),
            Mobile = r.mobile as string,
            Email = r.email as string,
            PhotoPath = r.photoPath as string,
            DesignationId = r.designationId is null ? (int?)null : Convert.ToInt32(r.designationId),
            MemberId = r.memberId is null ? 0 : (int)(long)r.memberId,
            IsMember = Convert.ToBoolean(r.isMember),
        }).ToList();

        // KPI buckets — keyword match on designation_name. Tolerant to spelling
        // variants because designations are free-text managed by admins.
        int execRoles = directors.Count(d => MatchesAny(d.Designation,
            "president", "vice president", "secretary", "treasurer", "sergeant"));
        int serviceChairs = directors.Count(d => MatchesAny(d.Designation,
            "club service", "community service", "vocational service",
            "international service", "new generation"));
        int growthOutreach = directors.Count(d => MatchesAny(d.Designation,
            "membership", "public image", "youth"));

        return new ClubAdminDashboardBodResponse
        {
            Club = identity,
            BoardMembers = directors.Count,
            ExecutiveRoles = execRoles,
            ServiceChairs = serviceChairs,
            GrowthOutreach = growthOutreach,
            SelectedYearId = selectedYearId > 0 ? selectedYearId : (int?)null,
            SelectedYearLabel = selectedYearLabel,
            AvailableYears = yearOptions,
            Directors = directors,
        };
    }

    private static bool MatchesAny(string text, params string[] needles)
    {
        if (string.IsNullOrEmpty(text)) return false;
        var lower = text.ToLowerInvariant();
        return needles.Any(n => lower.Contains(n));
    }

    // Dashboard › Marketplace
    public async Task<ClubAdminDashboardMarketplaceResponse?> GetDashboardMarketplaceAsync(int memberId, int? yearId, int? requestedClubId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, clubId, resolvedYearId);
        if (identity == null) return null;

        // Treat the count of upcoming-events + active-announcements as "listings"
        // (these are the items a member sees on the public ROW marketplace
        // pages for this club today).
        int listingsCount = await conn.ExecuteScalarAsync<int>(@"
            SELECT
                (SELECT COUNT(*) FROM upcoming_events WHERE fk_club_id = @ClubId AND isdeleted = 0
                    AND EventDate >= CURDATE())
              + (SELECT COUNT(*) FROM announcements   WHERE fk_club_id = @ClubId AND isdeleted = 0)",
            new { ClubId = clubId });

        var listings = new List<ClubAdminDashboardMarketplaceListing>();

        var upcoming = await conn.QueryAsync<dynamic>(@"
            SELECT Title AS title, EventDate AS date
            FROM upcoming_events
            WHERE fk_club_id = @ClubId AND isdeleted = 0 AND EventDate >= CURDATE()
            ORDER BY EventDate ASC LIMIT 8",
            new { ClubId = clubId });
        foreach (var u in upcoming)
        {
            DateTime? d = u.date is DateTime dd ? dd : (DateTime?)null;
            listings.Add(new ClubAdminDashboardMarketplaceListing
            {
                Title = (u.title as string) ?? "",
                Kind = "event",
                Date = d?.ToString("yyyy-MM-dd"),
                Status = "Active",
            });
        }

        // Rotary ID acts as the "club account id" on the external marketplace.
        var rotaryId = await conn.ExecuteScalarAsync<string?>(@"
            SELECT ClubRotaryId FROM club_master WHERE pk_club_id = @ClubId AND isdeleted = 0",
            new { ClubId = clubId }) ?? "";

        return new ClubAdminDashboardMarketplaceResponse
        {
            Club = identity,
            Subscription = identity.ClubWebsiteActive ? "Active" : "Inactive",
            ClubListingsCount = listingsCount,
            MemberId = string.IsNullOrEmpty(rotaryId) ? "—" : "#" + rotaryId,
            Platform = "ROW",
            PlatformUrl = RotaryApi.Services.Brand.PortalDomain,
            LaunchUrl = RotaryApi.Services.Brand.PortalOrigin,
            Listings = listings,
            Account = new ClubAdminDashboardMarketplaceAccount
            {
                ClubName = identity.ClubName,
                MarketplaceId = string.IsNullOrEmpty(rotaryId) ? "—" : "#" + rotaryId,
                DistrictNumber = identity.DistrictNumber,
                Subscription = identity.ClubWebsiteActive ? "Active" : "Inactive",
                ContactSupport = RotaryApi.Services.Brand.SupportEmail,
            },
        };
    }

    // Dashboard › Rotary Network — terminated + potential members
    public async Task<ClubAdminDashboardRotaryNetworkResponse?> GetDashboardRotaryNetworkAsync(int memberId, int? yearId, int? requestedClubId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, clubId, resolvedYearId);
        if (identity == null) return null;

        // Terminated members: soft-deleted or IsActive = 0 club_members rows that
        // ALSO carry a real termination date + reason — an inactive/deleted row with
        // neither is some other kind of removal (data cleanup, transfer, etc.), not an
        // actual termination, and must not inflate this count/list.
        // IsHonoraryMember is per-club (cm.IsHonoraryMember) since 2026-06-26 —
        // the chip label below derives from this club's honorary flag for the
        // terminated membership, not a member-wide flag (which no longer exists).
        // memberType is blank for non-honorary rows — "Active" is misleading for
        // someone who has just been shown to be terminated.
        var terminatedRows = (await conn.QueryAsync<dynamic>(@"
            SELECT cm.pk_club_member_id AS id,
                   m.pk_member_master_profile_id AS memberId,
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
            WHERE cm.fk_club_id = @ClubId
              AND (cm.IsActive = 0 OR cm.isdeleted = 1)
              AND cm.TerminationDate IS NOT NULL
              AND cm.TerminationReason IS NOT NULL AND cm.TerminationReason <> ''
            ORDER BY cm.TerminationDate DESC, m.MemberName",
            new { ClubId = clubId })).ToList();

        // Potential members: rows from potential_members table — that table only
        // stores a single `name` field (no first/middle/last) per the schema, so
        // we split the name client-side just like terminated members.
        var potentialRows = new List<dynamic>();
        try
        {
            potentialRows = (await conn.QueryAsync<dynamic>(@"
                SELECT pk_potential_member_id AS id,
                       name AS fullName,
                       email AS email,
                       mobile_number AS mobile,
                       reference_details AS referenceDetails,
                       DATE_FORMAT(created_date, '%Y-%m-%d') AS admissionDate
                FROM potential_members
                WHERE fk_club_id = @ClubId AND COALESCE(isdeleted, 0) = 0
                ORDER BY pk_potential_member_id DESC",
                new { ClubId = clubId })).ToList();
        }
        catch
        {
            // Table may not exist on every DB; treat as empty.
        }

        var terminated = terminatedRows.Select(r => SplitName(
            (r.fullName as string) ?? "",
            (r.memberType as string) ?? "Active",
            r.rotaryId as string,
            r.admissionDate as string,
            r.terminationDate as string,
            (r.terminationReason as string) ?? "",
            (long)r.id,
            "Terminated",
            r.mobile as string,
            r.email as string
        )).ToList();

        var potential = potentialRows.Select(r => SplitName(
            (r.fullName as string) ?? "",
            "Potential",
            null,
            r.admissionDate as string,
            null,
            "",
            (long)r.id,
            "Potential",
            r.mobile as string,
            r.email as string,
            r.referenceDetails as string
        )).ToList();

        // KPIs computed off the terminated list.
        int totalTerminated = terminated.Count;
        int thisRy = 0;
        var (yearStart, yearEnd) = await YearRangeAsync(conn, resolvedYearId);
        if (yearStart != null)
        {
            thisRy = terminated.Count(t =>
                !string.IsNullOrEmpty(t.TerminationDate)
                && DateTime.TryParse(t.TerminationDate, out var dt)
                && dt >= yearStart && dt <= yearEnd);
        }
        int nowMember = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_members
            WHERE fk_club_id = @ClubId AND IsActive = 1 AND isdeleted = 0
              AND fk_member_master_profile_id IN (
                  SELECT fk_member_master_profile_id FROM club_members
                  WHERE fk_club_id = @ClubId AND (IsActive = 0 OR isdeleted = 1)
              )",
            new { ClubId = clubId });
        int lackOfParticipation = terminated.Count(t =>
            !string.IsNullOrEmpty(t.TerminationReason)
            && t.TerminationReason.ToLowerInvariant().Contains("participat"));

        return new ClubAdminDashboardRotaryNetworkResponse
        {
            Club = identity,
            TotalTerminated = totalTerminated,
            ThisRotaryYear = thisRy,
            NowMember = nowMember,
            LackOfParticipation = lackOfParticipation,
            TerminatedMembers = terminated,
            PotentialMembers = potential,
        };
    }

    private static ClubAdminDashboardRotaryNetworkRow SplitName(
        string fullName, string memberType, string? rotaryId,
        string? admissionDate, string? terminationDate, string terminationReason,
        long id, string status, string? mobile = null, string? email = null, string? notes = null)
    {
        var parts = (fullName ?? "").Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        string first = parts.Length > 0 ? parts[0] : "";
        string last = parts.Length > 1 ? parts[^1] : "";
        string middle = parts.Length > 2 ? string.Join(' ', parts[1..^1]) : "";
        return new ClubAdminDashboardRotaryNetworkRow
        {
            Id = (int)id,
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

    // ─── SERVICE PROJECTS & PUBLIC IMAGE (Phase C) ───────────────────────

    // Order matches the on-screen tab order in the screenshots
    private static readonly (string Key, string Name)[] AvenueOrder = new[]
    {
        ("club_service",            "Club Service"),
        ("community_service",       "Community Service"),
        ("vocational_service",      "Vocational Service"),
        ("international_service",   "International Service"),
        ("new_generation_service",  "New Generation"),
        ("public_image_initiative", "Public Image"),
        ("pph_camp",                "PPH Camp"),
    };

    public async Task<ServiceProjectsOverviewResponse?> GetServiceProjectsOverviewAsync(int memberId, int? yearId, int? requestedClubId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, clubId, resolvedYearId);
        if (identity == null) return null;

        var availableYears = await GetClubProjectYearsAsync(conn, clubId);
        var (selectedYearId, selectedYearLabel) = ResolveSelectedYear(availableYears, resolvedYearId);

        var tables = await GetTargetTablesAsync(conn, selectedYearId);

        // Aggregate per avenue + global totals in a single pass.
        var byAvenue = AvenueOrder.ToDictionary(
            a => a.Key,
            a => new ServiceProjectsAvenueSummaryRow { AvenueKey = a.Key, AvenueName = a.Name });
        var kpis = new ServiceProjectsOverviewKpis();
        var pendingItems = new List<ServiceProjectsPendingFixRow>();
        // TotalCost + per-avenue Cost subtotals convert into the district default currency.
        var targetCurrency = await ResolveClubTargetCurrencyAsync(conn, clubId);
        var fxRates = await _fx.GetInrRatesAsync();

        foreach (var t in tables)
        {
            // Per-row aggregation for KPIs + avenue summary
            var rows = await conn.QueryAsync<dynamic>(
                $@"SELECT mm.ModuleKey AS moduleKey,
                          mm.ModuleName AS moduleName,
                          p.pk_project_id AS projectId,
                          COALESCE(p.title, '') AS title,
                          COALESCE(p.project_cost, 0) AS cost,
                          COALESCE(p.Currency, 'INR') AS currency,
                          COALESCE(p.direct_beneficiaries, 0) AS beneficiaries,
                          COALESCE(p.man_hours, 0) AS manHours,
                          COALESCE(p.attendance, 0) AS attendance,
                          COALESCE(p.approval_status, '') AS approvalStatus,
                          COALESCE(p.meeting_type, '') AS meetingType
                   FROM `{t.ProjectsTable}` p
                   JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
                   WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0",
                new { ClubId = clubId });

            foreach (var r in rows)
            {
                var key = (r.moduleKey as string) ?? "";
                if (!byAvenue.TryGetValue(key, out var row)) continue;

                decimal cost = r.cost is decimal cc ? cc : Convert.ToDecimal(r.cost ?? 0);
                cost = CurrencyHelper.Convert(cost, r.currency as string, targetCurrency, fxRates);
                int benef    = AsInt(r.beneficiaries);
                int hours    = AsInt(r.manHours);

                if (key == "club_service")
                {
                    // Club Service items are meetings — count them but don't fold
                    // their attendance into TotalBeneficiaries.
                    row.Projects++;
                    kpis.MeetingsHeld++;
                }
                else
                {
                    row.Projects++;
                    row.Beneficiaries += benef;
                    row.Cost          += cost;
                    row.ManHours      += hours;

                    kpis.TotalProjects++;
                    kpis.TotalBeneficiaries += benef;
                    kpis.TotalCost          += cost;
                    kpis.TotalManHours      += hours;
                }

                // Items that look incomplete / pending → top accordion
                var status = (r.approvalStatus as string ?? "").Trim().ToLowerInvariant();
                if (status == "pending" || status == "rejected" || status == "draft")
                {
                    if (pendingItems.Count < 8)
                    {
                        pendingItems.Add(new ServiceProjectsPendingFixRow
                        {
                            ProjectId      = AsInt(r.projectId),
                            Title          = (r.title as string) ?? "",
                            AvenueKey      = key,
                            AvenueLabel    = row.AvenueName,
                            ApprovalStatus = status,
                            // Fix URL points to existing module edit page
                            FixUrl = AvenueEditUrl(identity.ClubId, key, AsInt(r.projectId)),
                        });
                    }
                }
            }
        }

        // PPH camps live in their own `pph_camps` table, not the year-partitioned
        // `rotary_projects_YYYY_YY` tables the loop above scans — aggregate them
        // separately so the PPH Camp avenue row (and the global totals) aren't
        // silently stuck at zero.
        {
            var (pphYearStart, pphYearEnd) = await YearRangeAsync(conn, selectedYearId);
            var campRows = await conn.QueryAsync<dynamic>(
                $@"SELECT c.pk_camp_id AS id, COUNT(a.pk_attendance_id) AS attendance
                   FROM pph_camps c
                   LEFT JOIN pph_camp_attendance a ON a.fk_camp_id = c.pk_camp_id AND COALESCE(a.isdeleted, 0) = 0
                   WHERE c.fk_club_id = @ClubId AND COALESCE(c.isdeleted, 0) = 0
                     {(pphYearStart.HasValue && pphYearEnd.HasValue ? "AND c.CampDate BETWEEN @YearStart AND @YearEnd" : "")}
                   GROUP BY c.pk_camp_id",
                new { ClubId = clubId, YearStart = pphYearStart, YearEnd = pphYearEnd });

            var pphRow = byAvenue["pph_camp"];
            foreach (var r in campRows)
            {
                var benef = AsInt(r.attendance);
                pphRow.Projects++;
                pphRow.Beneficiaries += benef;
                kpis.TotalProjects++;
                kpis.TotalBeneficiaries += benef;
            }
        }

        return new ServiceProjectsOverviewResponse
        {
            Club = identity,
            SelectedYearId = selectedYearId > 0 ? selectedYearId : (int?)null,
            // Label falls back to identity.YearLabel when the selected year has
            // no project rows yet (fresh Rotary year on 1 July) — otherwise the
            // frontend would show a blank chip while the correct year IS in URL.
            SelectedYearLabel = !string.IsNullOrEmpty(selectedYearLabel) ? selectedYearLabel : identity.YearLabel,
            AvailableYears = availableYears,
            Kpis = kpis,
            TargetCurrency = targetCurrency,
            Avenues = AvenueOrder.Select(a => byAvenue[a.Key]).ToList(),
            PendingItems = pendingItems,
        };
    }

    public async Task<ServiceProjectsAvenueDetailResponse?> GetServiceProjectsAvenueDetailAsync(int memberId, string avenueKey, int? yearId, int? requestedClubId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return null;
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var identity = await BuildIdentityAsync(conn, memberId, clubId, resolvedYearId);
        if (identity == null) return null;

        if (string.IsNullOrEmpty(avenueKey)) avenueKey = "community_service";
        var avenueMeta = AvenueOrder.FirstOrDefault(a => a.Key == avenueKey);
        if (avenueMeta.Key == null)
        {
            // Unknown avenue → return empty payload rather than 404 so the page can show "no data".
            avenueMeta = ("unknown", "Unknown");
        }

        var availableYears = await GetClubProjectYearsAsync(conn, clubId);
        var (selectedYearId, selectedYearLabel) = ResolveSelectedYear(availableYears, resolvedYearId);

        var response = new ServiceProjectsAvenueDetailResponse
        {
            Club = identity,
            AvenueKey = avenueMeta.Key,
            AvenueName = avenueMeta.Name,
            SelectedYearId = selectedYearId > 0 ? selectedYearId : (int?)null,
            // Same fallback as overview — hydrate label from identity when the
            // requested year has no data yet, so the label chip isn't blank.
            SelectedYearLabel = !string.IsNullOrEmpty(selectedYearLabel) ? selectedYearLabel : identity.YearLabel,
            AvailableYears = availableYears,
        };

        // PPH camps live in their own `pph_camps` table, not the year-partitioned
        // `rotary_projects_YYYY_YY` tables — handle them before the tables.Count
        // guard below, which only applies to the generic avenue tables.
        if (avenueKey == "pph_camp")
        {
            await LoadPphCampsAsync(conn, clubId, selectedYearId, response);
            return response;
        }

        // Get target tables — single year for the detail view.
        var tables = await GetTargetTablesAsync(conn, selectedYearId);

        if (tables.Count == 0) return response;

        if (avenueKey == "club_service")
        {
            await LoadClubServiceMeetingsAsync(conn, clubId, tables, response);
        }
        else
        {
            await LoadAvenueProjectsAsync(conn, clubId, tables, avenueKey, avenueMeta.Name, response);
        }

        return response;
    }

    private async Task LoadClubServiceMeetingsAsync(MySqlConnection conn, int clubId, List<YearTableInfo> tables, ServiceProjectsAvenueDetailResponse response)
    {
        var meetings = new List<ServiceProjectsMeetingRow>();
        int totalAttendance = 0, totalRoll = 0, meetingsHeld = 0;
        decimal sumPct = 0;
        int withPct = 0;

        foreach (var t in tables)
        {
            var rows = await conn.QueryAsync<dynamic>(
                $@"SELECT p.pk_project_id AS id,
                          p.project_date AS projectDate,
                          COALESCE(p.title, '') AS title,
                          COALESCE(p.meeting_type, '') AS meetingType,
                          COALESCE(p.attendance, 0) AS attendance,
                          COALESCE(p.attendance_percentage, 0) AS attendancePct,
                          COALESCE(p.fk_year_id, 0) AS yearId
                   FROM `{t.ProjectsTable}` p
                   JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
                   WHERE p.fk_club_id = @ClubId AND mm.ModuleKey = 'club_service'
                     AND p.isdeleted = 0
                   ORDER BY p.project_date DESC",
                new { ClubId = clubId });

            int i = 0;
            foreach (var r in rows)
            {
                DateTime? d = r.projectDate is DateTime dd ? dd : (DateTime?)null;
                int att = AsInt(r.attendance);
                // The stored percentage. Many old rows hold a figure measured against the wrong base -
                // a BOD meeting divided by the whole club - so it is only the fallback; the figure
                // shown is the one the add/edit form shows, worked out below (user 2026-10-01).
                decimal pct = r.attendancePct is decimal pp ? pp : Convert.ToDecimal(r.attendancePct ?? 0);
                var mType = (r.meetingType as string) ?? "";

                meetings.Add(new ServiceProjectsMeetingRow
                {
                    Id = AsInt(r.id),
                    Sr = ++i,
                    Date = d?.ToString("yyyy-MM-dd") ?? "",
                    MeetingType = mType,
                    Title = (r.title as string) ?? "",
                    Attendance = att,
                    AttendancePercent = pct,
                    YearId = AsInt(r.yearId),
                });

                totalAttendance += att;
                meetingsHeld++;
            }
        }

        // Members on roll — at the moment we don't have a per-meeting snapshot of the roll size, so
        // we use the current active count as a proxy. Counted EXACTLY as the add/edit form counts it
        // (AttendanceService.GetClubMembersAsync): honorary members are not active members and a row
        // pointing at a deleted profile is not a member either. Without those two conditions this
        // read 92 where the form read 91, and the same meeting showed 38.04% here and 38.46% there
        // (user 2026-10-01).
        int membersOnRoll = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*)
            FROM club_members cm
            INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id = @ClubId
              AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND cm.IsHonoraryMember = 0
              AND m.isdeleted = 0",
            new { ClubId = clubId });

        // A BOD meeting is attended by the board, not the club: show it against that year's board
        // size, which is exactly what the add/edit form divided by when it saved the percentage
        // (user 2026-10-01, "if meeting type is BOD then get the count of BOD of that club of that
        // year"). Same row rule as BoardDirectorService.GetByClubAsync - a non-member seat counts, a
        // seat pointing at a deleted profile does not. A year with no board falls back to the roll.
        var bodYears = meetings
            .Where(m => string.Equals(m.MeetingType, "bod", StringComparison.OrdinalIgnoreCase) && m.YearId > 0)
            .Select(m => m.YearId).Distinct().ToList();
        var bodCounts = new Dictionary<int, int>();
        if (bodYears.Count > 0)
        {
            var bodRows = await conn.QueryAsync<(int yearId, int cnt)>(@"
                SELECT bd.fk_year_id, COUNT(*) AS cnt
                FROM board_of_directors bd
                LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
                WHERE bd.fk_club_id = @ClubId AND bd.fk_year_id IN @YearIds AND bd.isdeleted = 0
                  AND (bd.fk_member_master_profile_id IS NULL OR m.pk_member_master_profile_id IS NOT NULL)
                GROUP BY bd.fk_year_id",
                new { ClubId = clubId, YearIds = bodYears });
            foreach (var b in bodRows) bodCounts[b.yearId] = b.cnt;
        }

        foreach (var m in meetings)
        {
            var isBod = string.Equals(m.MeetingType, "bod", StringComparison.OrdinalIgnoreCase);
            m.MembersOnRoll = isBod && bodCounts.TryGetValue(m.YearId, out var bc) && bc > 0 ? bc : membersOnRoll;
            m.AttendanceBase = isBod && m.MembersOnRoll != membersOnRoll ? "BOD Members" : "Total Members";

            // The listing must read the same as the add/edit form for the same meeting (user
            // 2026-10-01: "Attendance is 12/24 bod correct no issue but Att % 50%"). The form divides
            // by the base above and shows the result, so this screen does the same - the two can no
            // longer disagree. The stored attendance_percentage stays as it is and is used only when
            // there is no base to divide by; re-saving the meeting on the form writes the new figure.
            if (m.MembersOnRoll > 0 && m.Attendance > 0)
                m.AttendancePercent = Math.Round((decimal)m.Attendance / m.MembersOnRoll * 100, 2);

            // The Avg Attendance tile averages what the rows actually show.
            if (m.AttendancePercent > 0) { sumPct += m.AttendancePercent; withPct++; }
        }

        response.Meetings = meetings;
        response.Kpis = new ServiceProjectsAvenueKpis
        {
            MeetingsHeld = meetingsHeld,
            AvgAttendancePercent = withPct > 0 ? Math.Round(sumPct / withPct, 0) : 0,
            // Stayed-on attendance — no separate column today; mirror avg.
            AvgAttendanceStayedPercent = withPct > 0 ? Math.Round(sumPct / withPct, 0) : 0,
            MembersOnRoll = membersOnRoll,
        };
    }

    private async Task LoadAvenueProjectsAsync(MySqlConnection conn, int clubId, List<YearTableInfo> tables, string avenueKey, string avenueName, ServiceProjectsAvenueDetailResponse response)
    {
        var oneTime = new List<ServiceProjectsProjectRow>();
        var ongoing = new List<ServiceProjectsProjectRow>();
        var pending = new List<ServiceProjectsPendingApprovalBannerRow>();

        int totalProjects = 0, totalBenef = 0, totalHours = 0;
        decimal totalSpent = 0;

        // Multi-currency: AmountSpent is converted into the club's district default currency; each
        // row keeps its own native currency for display.
        var targetCurrency = await ResolveClubTargetCurrencyAsync(conn, clubId);
        var fxRates = await _fx.GetInrRatesAsync();

        foreach (var t in tables)
        {
            var rows = await conn.QueryAsync<dynamic>(
                $@"SELECT p.pk_project_id AS id,
                          p.project_date AS projectDate,
                          COALESCE(p.title, '') AS title,
                          COALESCE(p.project_type, 'one_time') AS projectType,
                          COALESCE(p.project_cost, 0) AS cost,
                          COALESCE(p.Currency, 'INR') AS currency,
                          COALESCE(p.direct_beneficiaries, 0) AS beneficiaries,
                          COALESCE(p.man_hours, 0) AS manHours,
                          COALESCE(p.approval_status, '') AS approvalStatus,
                          COALESCE(p.synced_to_org, 0) AS syncedToOrg,
                          COALESCE(p.is_joint_project, 0) AS isJoint,
                          p.co_host_name AS coHostName,
                          p.parent_project_id AS parentId,
                          p.ongoing_group_title AS ongoingTitle,
                          p.created_by AS createdBy,
                          (SELECT m.MemberName FROM member_master_profile m
                            WHERE m.pk_member_master_profile_id = p.created_by) AS creatorName,
                          (SELECT m.PrimaryMobileNumber FROM member_master_profile m
                            WHERE m.pk_member_master_profile_id = p.created_by) AS creatorMobile,
                          (SELECT m.EmailId FROM member_master_profile m
                            WHERE m.pk_member_master_profile_id = p.created_by) AS creatorEmail
                   FROM `{t.ProjectsTable}` p
                   JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
                   WHERE p.fk_club_id = @ClubId AND mm.ModuleKey = @AvenueKey
                     AND p.isdeleted = 0
                   ORDER BY COALESCE(p.parent_project_id, 0),
                            p.project_date DESC,
                            p.pk_project_id DESC",
                new { ClubId = clubId, AvenueKey = avenueKey });

            int srOne = 0, srOng = 0;
            foreach (var r in rows)
            {
                DateTime? d = r.projectDate is DateTime dd ? dd : (DateTime?)null;
                decimal cost = r.cost is decimal cc ? cc : Convert.ToDecimal(r.cost ?? 0);
                int benef = AsInt(r.beneficiaries);
                int hours = AsInt(r.manHours);
                string projType = ((r.projectType as string) ?? "one_time").Trim().ToLowerInvariant();

                var row = new ServiceProjectsProjectRow
                {
                    Id = AsInt(r.id),
                    Date = d?.ToString("yyyy-MM-dd") ?? "",
                    Title = (r.title as string) ?? "",
                    Type = NormalizeProjectType(projType),
                    Cost = cost,
                    Currency = CurrencyHelper.Normalize(r.currency as string),
                    DirectBeneficiaries = benef,
                    ManHours = hours,
                    Beneficiary = null,
                    ApprovalStatus = (r.approvalStatus as string) ?? "",
                    SyncedToOrg = Convert.ToBoolean(r.syncedToOrg ?? 0),
                    IsJointProject = Convert.ToBoolean(r.isJoint ?? 0),
                    CoHostName = r.coHostName as string,
                    ParentProjectId = r.parentId is null ? (int?)null : AsInt(r.parentId),
                    OngoingGroupTitle = r.ongoingTitle as string,
                };

                bool isOngoing = projType == "ongoing" || projType == "ongoing_repeat";
                bool isChild   = row.ParentProjectId is int pid && pid > 0;

                if (isChild)
                {
                    // Child row — keep only ongoing children (one-time projects
                    // shouldn't have children; legacy rows that do are skipped
                    // so they don't pollute the one-time list).
                    if (!isOngoing) continue;
                    ongoing.Add(row);          // Sr left at 0 for children — frontend nests them under their parent
                }
                else if (isOngoing)
                {
                    row.Sr = ++srOng;
                    ongoing.Add(row);
                }
                else
                {
                    row.Sr = ++srOne;
                    oneTime.Add(row);
                }

                totalProjects++;
                totalBenef += benef;
                totalSpent += CurrencyHelper.Convert(cost, row.Currency, targetCurrency, fxRates);
                totalHours += hours;

                var status = row.ApprovalStatus.Trim().ToLowerInvariant();
                if ((status == "pending" || status == "rejected" || status == "draft")
                    && pending.Count < 3)
                {
                    pending.Add(new ServiceProjectsPendingApprovalBannerRow
                    {
                        ProjectId = row.Id,
                        CreatorName = (r.creatorName as string) ?? "Member",
                        ProjectTitle = row.Title,
                        AvenueLabel = avenueName,
                        Mobile = r.creatorMobile as string,
                        Email = r.creatorEmail as string,
                        ApprovalStatus = status,
                    });
                }
            }
        }

        response.OneTimeProjects = oneTime;
        response.OngoingProjects = ongoing;
        response.PendingApprovals = pending;
        response.TargetCurrency = targetCurrency;
        response.Kpis = new ServiceProjectsAvenueKpis
        {
            Projects = totalProjects,
            Beneficiaries = totalBenef,
            AmountSpent = totalSpent,
            ManHours = totalHours,
        };
    }

    // PPH camps have their own table (`pph_camps`, joined to `pph_camp_attendance`
    // for a beneficiary/attendance count) — they're not projects in the year-wise
    // `rotary_projects_YYYY_YY` tables, so this mirrors LoadAvenueProjectsAsync's
    // shape without touching the shared project tables. Filtering by the selected
    // Rotary year uses CampDate against rotary_year_master's date range (camps have
    // no fk_year_id column), same approach as AgReportsController's PPH report.
    private async Task LoadPphCampsAsync(MySqlConnection conn, int clubId, int yearId, ServiceProjectsAvenueDetailResponse response)
    {
        var (yearStart, yearEnd) = await YearRangeAsync(conn, yearId);

        var rows = await conn.QueryAsync<dynamic>(
            $@"SELECT c.pk_camp_id AS id, c.CampDate AS campDate, COALESCE(c.Title, '') AS title,
                      COUNT(a.pk_attendance_id) AS attendance,
                      COALESCE(c.IsActive, 1) AS isActive,
                      CASE
                          WHEN c.CampLogoPath IS NULL OR c.CampLogoPath = '' THEN NULL
                          WHEN c.CampLogoPath LIKE '/%' THEN c.CampLogoPath
                          ELSE CONCAT('/Documents/Campmaster/Group', c.fk_club_id, '/', c.CampLogoPath)
                      END AS campImageUrl
               FROM pph_camps c
               LEFT JOIN pph_camp_attendance a ON a.fk_camp_id = c.pk_camp_id AND COALESCE(a.isdeleted, 0) = 0
               WHERE c.fk_club_id = @ClubId AND COALESCE(c.isdeleted, 0) = 0
                 {(yearStart.HasValue && yearEnd.HasValue ? "AND c.CampDate BETWEEN @YearStart AND @YearEnd" : "")}
               GROUP BY c.pk_camp_id, c.CampDate, c.Title, c.IsActive, c.CampLogoPath, c.fk_club_id
               ORDER BY c.CampDate DESC, c.pk_camp_id DESC",
            new { ClubId = clubId, YearStart = yearStart, YearEnd = yearEnd });

        var items = new List<ServiceProjectsProjectRow>();
        int totalBenef = 0, sr = 0;
        foreach (var r in rows)
        {
            DateTime? d = r.campDate is DateTime dd ? dd : (DateTime?)null;
            int benef = AsInt(r.attendance);
            items.Add(new ServiceProjectsProjectRow
            {
                Id = AsInt(r.id),
                Sr = ++sr,
                Date = d?.ToString("yyyy-MM-dd") ?? "",
                Title = (r.title as string) ?? "",
                Type = "",
                Cost = 0,
                DirectBeneficiaries = benef,
                ManHours = 0,
                ApprovalStatus = "",
                IsActive = AsInt(r.isActive) == 1,
                CampImageUrl = r.campImageUrl as string,
            });
            totalBenef += benef;
        }

        response.OneTimeProjects = items;
        response.Kpis = new ServiceProjectsAvenueKpis
        {
            Projects = items.Count,
            Beneficiaries = totalBenef,
            AmountSpent = 0,
            ManHours = 0,
        };
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    private static int AsInt(object? v)
    {
        if (v == null) return 0;
        return v switch
        {
            int i => i,
            long l => (int)l,
            decimal d => (int)d,
            double d2 => (int)d2,
            _ => Convert.ToInt32(v),
        };
    }

    // Years that actually have data for this club (across all year-tables).
    // Returns newest first, with the current year flagged.
    private async Task<List<ClubAdminYearOption>> GetClubProjectYearsAsync(MySqlConnection conn, int clubId)
    {
        var all = await _yearTables.GetAllExistingYearTablesAsync(conn);
        var options = new List<ClubAdminYearOption>();
        foreach (var t in all)
        {
            int has = await conn.ExecuteScalarAsync<int>(
                $"SELECT EXISTS(SELECT 1 FROM `{t.ProjectsTable}` WHERE fk_club_id = @ClubId AND isdeleted = 0 LIMIT 1)",
                new { ClubId = clubId });
            if (has == 1)
            {
                var yr = await conn.QueryFirstOrDefaultAsync<dynamic>(
                    "SELECT pk_year_id AS id, YearLabel AS label, COALESCE(IsCurrent,0) AS isCurrent FROM rotary_year_master WHERE pk_year_id = @Id",
                    new { Id = t.YearId });
                if (yr != null)
                {
                    options.Add(new ClubAdminYearOption
                    {
                        Id = AsInt(yr.id),
                        YearLabel = (yr.label as string) ?? "",
                        IsCurrent = Convert.ToBoolean(yr.isCurrent),
                    });
                }
            }
        }
        return options.OrderByDescending(o => o.Id).ToList();
    }

    // HONOR the requested yearId — even if that year has no projects for this
    // club yet. Falling back to "any year with data" was the source of the
    // "picked current year but shows last year" bug: on 1 July, the current
    // Rotary year has zero projects, so silent-fallback would roll every
    // caller back to last year's data. We now return requested when we have
    // it, use its label if we can find it in years, and only fall back to
    // years[0] when the caller passed requested=0 (i.e. "no year filter").
    private static (int yearId, string label) ResolveSelectedYear(List<ClubAdminYearOption> years, int requested)
    {
        if (requested > 0)
        {
            var match = years.FirstOrDefault(y => y.Id == requested);
            return match != null ? (match.Id, match.YearLabel) : (requested, "");
        }
        var current = years.FirstOrDefault(y => y.IsCurrent) ?? years.FirstOrDefault();
        return current == null ? (0, "") : (current.Id, current.YearLabel);
    }

    private static string NormalizeProjectType(string projType)
    {
        return (projType ?? "").ToLowerInvariant() switch
        {
            "one_time"        => "One-time",
            "recurring"       => "Recurring",
            "annual"          => "Annual",
            "ongoing"         => "Ongoing",
            "ongoing_repeat"  => "Ongoing",
            _                 => projType,
        };
    }

    private static string AvenueEditUrl(int clubId, string avenueKey, int projectId)
    {
        // Map avenue → existing module page URL (used by the "fix" link)
        var slug = avenueKey switch
        {
            "club_service"            => "club-service",
            "community_service"       => "community-service",
            "vocational_service"      => "vocational-service",
            "international_service"   => "international-service",
            "new_generation_service"  => "new-generation-service",
            "public_image_initiative" => "public-image-initiative",
            "pph_camp"                => "pph-camps",
            _                         => "projects",
        };
        return $"/clubs/{clubId}/{slug}/{projectId}/edit";
    }

    // ─── AVAILABLE YEARS (powers the global topbar dropdown) ───────────
    // Returns only years where this club has actual data, plus the current year.
    // "Has data" = union of:
    //   - rotary_projects (legacy table)  WHERE fk_club_id
    //   - any rotary_projects_YYYY_YY year-bound table where the club has a row
    //   - bod_master, member_attendance, trf_contribution, club_monthly_report
    // The current year is ALWAYS included even if the club has no data yet (so
    // the dropdown is never empty on a brand-new club).
    public async Task<ClubAdminAvailableYearsResponse?> GetAvailableYearsAsync(int memberId, int? requestedClubId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return null;

        var currentYearId = await conn.ExecuteScalarAsync<int?>(@"
            SELECT pk_year_id FROM rotary_year_master WHERE isdeleted = 0 AND IsCurrent = 1 LIMIT 1") ?? 0;
        var currentYearLabel = currentYearId > 0
            ? (await conn.ExecuteScalarAsync<string?>(
                "SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @Id LIMIT 1",
                new { Id = currentYearId })) ?? ""
            : "";

        // Collect year ids that have data for this club from each year-scoped table.
        // Each query is independent so a missing/empty table doesn't break the others.
        var ids = new HashSet<int>();
        if (currentYearId > 0) ids.Add(currentYearId);

        async Task TryAdd(string sql)
        {
            try
            {
                var rows = await conn.QueryAsync<int>(sql, new { ClubId = clubId });
                foreach (var id in rows) if (id > 0) ids.Add(id);
            }
            catch { /* table may not exist or be year-scoped — ignore */ }
        }

        // Table-name fixes (2026-06-30): the original code used four wrong table names that
        // silently failed through TryAdd's swallowed catch, so the global year selector was
        // missing years where a club only had BOD / attendance / TRF / monthly-report data.
        // Project-years come from the year-wise rotary_projects_YYYY_YY loop below; the legacy
        // monolithic rotary_projects table is dead, so its (always-empty) query was removed.
        await TryAdd("SELECT DISTINCT fk_year_id FROM board_of_directors WHERE fk_club_id = @ClubId AND isdeleted = 0"); // was bod_master
        await TryAdd("SELECT DISTINCT fk_year_id FROM club_attendance WHERE fk_club_id = @ClubId AND isdeleted = 0");    // was member_attendance
        await TryAdd("SELECT DISTINCT fk_year_id FROM trf_contributions WHERE fk_club_id = @ClubId AND isdeleted = 0");  // was trf_contribution
        await TryAdd("SELECT DISTINCT fk_year_id FROM club_monthly_reports WHERE fk_club_id = @ClubId AND isdeleted = 0"); // was club_monthly_report
        // membership_dues stores RotaryYear as a VARCHAR label (e.g. "2026-27"), not a year FK,
        // so we JOIN to rotary_year_master to resolve back to pk_year_id.
        await TryAdd(@"SELECT DISTINCT y.pk_year_id
                       FROM membership_dues md
                       JOIN rotary_year_master y ON y.YearLabel = md.RotaryYear AND y.isdeleted = 0
                       WHERE md.fk_club_id = @ClubId AND md.isdeleted = 0");

        // Pull any year-bound rotary_projects_YYYY_YY tables the resolver knows about
        // and check each for any row for this club.
        try
        {
            var tables = await _yearTables.GetAllExistingYearTablesAsync(conn);
            foreach (var t in tables)
            {
                var has = await conn.ExecuteScalarAsync<int>(
                    $"SELECT EXISTS(SELECT 1 FROM `{t.ProjectsTable}` WHERE fk_club_id = @ClubId AND isdeleted = 0 LIMIT 1)",
                    new { ClubId = clubId });
                if (has == 1) ids.Add(t.YearId);
            }
        }
        catch { /* ignore — resolver may be unavailable */ }

        if (ids.Count == 0)
        {
            return new ClubAdminAvailableYearsResponse
            {
                ClubId = clubId,
                CurrentYearId = currentYearId > 0 ? currentYearId : null,
                CurrentYearLabel = currentYearLabel,
                Years = new List<ClubAdminYearOption>(),
            };
        }

        // Hydrate labels + sort newest-first by StartDate.
        var years = (await conn.QueryAsync<(int Id, string Label, sbyte IsCurrent)>(@"
            SELECT pk_year_id AS Id, YearLabel AS Label, IsCurrent AS IsCurrent
            FROM rotary_year_master
            WHERE pk_year_id IN @Ids AND isdeleted = 0
            ORDER BY StartDate DESC",
            new { Ids = ids.ToArray() })).ToList();

        return new ClubAdminAvailableYearsResponse
        {
            ClubId = clubId,
            CurrentYearId = currentYearId > 0 ? currentYearId : null,
            CurrentYearLabel = currentYearLabel,
            Years = years.Select(y => new ClubAdminYearOption
            {
                Id = y.Id,
                YearLabel = y.Label ?? "",
                IsCurrent = y.IsCurrent == 1,
            }).ToList(),
        };
    }
}
