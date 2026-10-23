using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// AG (Assistant Governor) dashboard data service.
//
// Mapping rules:
//   AG → clubs           : district_ag (fk_member_id, fk_club_id, fk_year_id, is_active=1, isdeleted=0)
//   Members per club     : COUNT(*) club_members WHERE IsActive=1 AND isdeleted=0
//   Meetings per club    : COUNT(*) club_attendance for year
//   Projects per club    : COUNT across rotary_projects_YYYY_YY year tables filtered by club + year
//   TRF                  : SUM(AmountUSD) from trf_contributions, shown in USD
//   Citation             : SUM(points_earned + bonus_earned) from district_citation_club_entry
//   OCV                  : COUNT(*) club_documents AccessType IN ('readonly','downloadonly')  (proxy)
//   Beneficiaries        : SUM(direct_beneficiaries) from year-wise project tables
//
// All queries scoped to the AG's assigned clubs only — never returns other clubs' data.
public class AgDashboardService : IAgDashboardService
{
    // TRF is stored AND shown in USD — no currency conversion (was 84 for a legacy INR display).
    private const decimal USD_INR = 1m;

    private static readonly string[] MONTH_LABELS =
        { "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun" };

    private readonly string _connectionString;
    private readonly IYearTableResolver _yearTables;
    private readonly ICurrencyRateService _fx;

    public AgDashboardService(IConfiguration configuration, IYearTableResolver yearTables, ICurrencyRateService fx)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _yearTables = yearTables;
        _fx = fx;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // The district default currency for a set of clubs (an AG's clubs are all in one district).
    // Cost totals convert into this; per-project rows keep their own currency.
    private static async Task<string> ResolveDistrictTargetCurrencyAsync(MySqlConnection conn, int anyClubId)
    {
        if (anyClubId <= 0) return RotaryApi.Services.Brand.DefaultCurrency;
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT d.DefaultCurrency AS DefaultCurrency, d.Country AS Country
            FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE c.pk_club_id = @ClubId
            LIMIT 1", new { ClubId = anyClubId });
        return CurrencyHelper.ResolveDefaultCurrency(row?.DefaultCurrency as string, row?.Country as string);
    }

    // ─── Shared helpers ─────────────────────────────────────────────────

    private async Task<List<int>> GetAgClubIdsAsync(MySqlConnection conn, int memberId, int? yearId, int? districtId = null)
    {
        if (memberId <= 0) return new List<int>();
        // Wave 9G: when a districtId is provided (AG with clubs in multiple districts
        // has picked one from the topbar), join club_master to restrict the result
        // to that district. Without the filter, behavior is unchanged.
        var sql = districtId.HasValue && districtId.Value > 0
            ? @"SELECT DISTINCT da.fk_club_id FROM district_ag da
                JOIN club_master c ON c.pk_club_id = da.fk_club_id AND c.isdeleted = 0
                WHERE da.fk_member_id = @MemberId AND da.isdeleted = 0 AND da.is_active = 1
                  AND (@YearId IS NULL OR da.fk_year_id = @YearId)
                  AND c.fk_district_id = @DistrictId"
            : @"SELECT DISTINCT fk_club_id FROM district_ag
                WHERE fk_member_id = @MemberId AND isdeleted = 0 AND is_active = 1
                  AND (@YearId IS NULL OR fk_year_id = @YearId)";
        var rows = await conn.QueryAsync<int>(sql,
            new { MemberId = memberId, YearId = yearId, DistrictId = districtId });
        return rows.ToList();
    }

    // When a caller passes an explicit `requestedClubId`, validate that the AG
    // actually has an active assignment at that club for this year, then return
    // the singleton list. When `requestedClubId` is null, return the full list of
    // the AG's clubs (legacy behavior). Throws `UnauthorizedAccessException` if
    // the AG has no active assignment to the requested club.
    //
    // Wave 9G: also honours `requestedDistrictId` — restricts the AG's clubs to
    // a single district. If both clubId + districtId are passed, the club must
    // belong to the picked district (otherwise UnauthorizedAccessException).
    private async Task<List<int>> ResolveAgClubIdsAsync(MySqlConnection conn, int memberId, int? yearId, int? requestedClubId, int? requestedDistrictId = null)
    {
        var allClubIds = await GetAgClubIdsAsync(conn, memberId, yearId, requestedDistrictId);
        if (!requestedClubId.HasValue || requestedClubId.Value <= 0) return allClubIds;

        if (!allClubIds.Contains(requestedClubId.Value))
            throw new UnauthorizedAccessException("You are not an active AG for this club in this year.");

        return new List<int> { requestedClubId.Value };
    }

    // Years to offer in the AG's global year picker = the years this member actually
    // holds an AG assignment for (district_ag.fk_year_id). NOT "years with data" and
    // NOT the district's years: an AG appointed for one year must only ever see that
    // year, so the current Rotary year is deliberately NOT force-added here.
    //
    // One year  -> the frontend renders the picker disabled (nothing to switch to).
    // Two+ years -> the frontend enables it.
    public async Task<AgAvailableYearsResponse> GetAvailableYearsAsync(int memberId, int? districtId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Restrict to a district only when the AG spans several and has picked one —
        // mirrors GetAgClubIdsAsync so the year list matches the clubs on screen.
        var sql = districtId.HasValue && districtId.Value > 0
            ? @"SELECT DISTINCT y.pk_year_id AS Id, y.YearLabel AS Label, y.IsCurrent AS IsCurrent, y.StartDate
                FROM district_ag da
                JOIN club_master c        ON c.pk_club_id = da.fk_club_id AND c.isdeleted = 0
                JOIN rotary_year_master y ON y.pk_year_id = da.fk_year_id AND y.isdeleted = 0
                WHERE da.fk_member_id = @MemberId AND da.isdeleted = 0 AND da.is_active = 1
                  AND c.fk_district_id = @DistrictId
                ORDER BY y.StartDate DESC"
            : @"SELECT DISTINCT y.pk_year_id AS Id, y.YearLabel AS Label, y.IsCurrent AS IsCurrent, y.StartDate
                FROM district_ag da
                JOIN rotary_year_master y ON y.pk_year_id = da.fk_year_id AND y.isdeleted = 0
                WHERE da.fk_member_id = @MemberId AND da.isdeleted = 0 AND da.is_active = 1
                ORDER BY y.StartDate DESC";

        var years = (await conn.QueryAsync<(int Id, string Label, sbyte IsCurrent, DateTime? StartDate)>(
            sql, new { MemberId = memberId, DistrictId = districtId })).ToList();

        if (years.Count == 0)
        {
            return new AgAvailableYearsResponse
            {
                CurrentYearId = null,
                CurrentYearLabel = "",
                Years = new List<AgYearOptionDto>(),
            };
        }

        // Default selection: the live Rotary year when the AG holds it, else their most
        // recent AG year — otherwise a past-year-only AG would open on a year they have
        // no assignment for and see nothing.
        var pick = years.FirstOrDefault(y => y.IsCurrent == 1);
        if (pick.Id == 0) pick = years[0];   // already sorted newest-first

        return new AgAvailableYearsResponse
        {
            CurrentYearId = pick.Id,
            CurrentYearLabel = pick.Label ?? "",
            Years = years.Select(y => new AgYearOptionDto
            {
                Id = y.Id,
                YearLabel = y.Label ?? "",
                IsCurrent = y.IsCurrent == 1,
            }).ToList(),
        };
    }

    // Full detail for ONE project, for the AG projects popup. Fetched on demand rather
    // than shipped with the list — photos + long text would bloat a several-hundred-row
    // payload for data only read when a row is opened.
    //
    // projectId is unique only WITHIN its year table, so yearId is required to pick the
    // right rotary_projects_YYYY_YY. Returns null when the project doesn't exist OR isn't
    // in one of this AG's clubs — never leak another club's project.
    public async Task<AgProjectDetailDto?> GetProjectDetailAsync(int memberId, int projectId, int? yearId, int? districtId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        if (resolvedYearId <= 0 || projectId <= 0) return null;

        // Authorisation: the project's club must be one this AG actually holds.
        var clubIds = await GetAgClubIdsAsync(conn, memberId, resolvedYearId, districtId);
        if (clubIds.Count == 0) return null;

        var info = await _yearTables.ResolveByYearIdAsync(conn, resolvedYearId);
        if (info is null) return null;
        var suffix = info.YearLabel.Replace("-", "_");

        // Photo URL layout mirrors ProjectService: migrated rows (old_pk set) have no year
        // segment, new rows do. image_path stores the filename only.
        string sql = $@"
            SELECT p.pk_project_id AS projectId, p.fk_club_id AS clubId, p.fk_year_id AS yearId,
                   c.ClubName AS clubName, y.YearLabel AS yearLabel,
                   p.title, p.description, p.location,
                   COALESCE(md.ModuleName,'')  AS avenue,
                   COALESCE(aof.name,'')       AS areaOfFocus,
                   p.project_date              AS projectDate,
                   COALESCE(p.project_cost,0)  AS cost,
                   COALESCE(f.name,'')         AS funding,
                   COALESCE(p.direct_beneficiaries,0) AS beneficiaries,
                   COALESCE(p.rotarians_involved,0)   AS rotariansInvolved,
                   COALESCE(p.rotaractors_involved,0) AS rotaractorsInvolved,
                   COALESCE(p.rcc_involved,0) AS rccInvolved,
                   p.project_type   AS projectType,
                   COALESCE(p.is_joint_project,0) AS isJointProject,
                   p.co_host_name   AS coHostName,
                   p.club_role      AS clubRole
            FROM `{info.ProjectsTable}` p
            LEFT JOIN club_master c            ON c.pk_club_id = p.fk_club_id
            LEFT JOIN rotary_year_master y     ON y.pk_year_id = p.fk_year_id
            LEFT JOIN module_master md         ON md.pk_module_id = p.fk_module_id
            LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
            LEFT JOIN funding_master f         ON f.pk_funding_id = p.fk_funding_id
            WHERE p.pk_project_id = @ProjectId AND p.fk_club_id IN @ClubIds AND p.isdeleted = 0
            LIMIT 1";

        dynamic? r;
        try { r = await conn.QueryFirstOrDefaultAsync<dynamic>(sql, new { ProjectId = projectId, ClubIds = clubIds }); }
        catch { return null; }   // year table may predate a column (e.g. man_hours)
        if (r is null) return null;

        DateTime? d = r.projectDate is DateTime dd ? dd : (DateTime?)null;

        // man_hours may not exist on older year tables — probe separately so its absence
        // can't take the whole detail down.
        int manHours = 0; bool manHoursPending = true;
        try
        {
            manHours = await conn.ExecuteScalarAsync<int>(
                $"SELECT COALESCE(man_hours,0) FROM `{info.ProjectsTable}` WHERE pk_project_id = @Id",
                new { Id = projectId });
            manHoursPending = false;
        }
        catch { /* column missing — leave pending */ }

        // NOTE: do NOT alias a column `desc` — it's a MySQL reserved word and the query
        // dies with a syntax error that the catch below would swallow, silently reporting
        // "no photos" for projects that have them.
        var photos = new List<AgProjectPhotoDto>();
        try
        {
            var prows = await conn.QueryAsync<(string photoUrl, string? photoDesc, sbyte isPrimary)>($@"
                SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                              CASE WHEN p.old_pk IS NOT NULL
                                   THEN CONCAT('Album', p.old_pk)
                                   ELSE CONCAT('{suffix}/Album', p.pk_project_id)
                              END, '/', pp.image_path) AS photoUrl,
                       pp.description AS photoDesc,
                       COALESCE(pp.is_primary,0) AS isPrimary
                FROM `{info.PhotosTable}` pp
                JOIN `{info.ProjectsTable}` p ON p.pk_project_id = pp.fk_project_id
                WHERE pp.fk_project_id = @Id
                ORDER BY pp.is_primary DESC, pp.sort_order, pp.pk_photo_id",
                new { Id = projectId });
            foreach (var pr in prows)
                photos.Add(new AgProjectPhotoDto { Url = pr.photoUrl ?? "", Description = pr.photoDesc, IsPrimary = pr.isPrimary == 1 });
        }
        catch (Exception ex)
        {
            // Older year tables may genuinely lack a photos table — but log it rather than
            // pretending the project has no photos.
            Console.WriteLine($"[AG project {projectId}] photo fetch failed: {ex.Message}");
        }

        return new AgProjectDetailDto
        {
            ProjectId = projectId,
            ClubId = r.clubId is int ci ? ci : 0,
            ClubName = (r.clubName as string) ?? "",
            YearId = resolvedYearId,
            YearLabel = (r.yearLabel as string) ?? "",
            Title = (r.title as string) ?? "",
            Description = r.description as string,
            Location = r.location as string,
            Avenue = r.avenue as string,
            AreaOfFocus = r.areaOfFocus as string,
            Date = d?.ToString("yyyy-MM-dd"),
            Cost = r.cost is decimal cst ? cst : 0,
            Funding = (r.funding as string) ?? "",
            Beneficiaries = r.beneficiaries is long bl ? (int)bl : (r.beneficiaries is int bi ? bi : 0),
            ManHours = manHours,
            ManHoursIsPending = manHoursPending,
            RotariansInvolved = r.rotariansInvolved is long r1 ? (int)r1 : (r.rotariansInvolved is int r2 ? r2 : 0),
            RotaractorsInvolved = r.rotaractorsInvolved is long q1 ? (int)q1 : (r.rotaractorsInvolved is int q2 ? q2 : 0),
            RccInvolved = r.rccInvolved is long q3 ? (int)q3 : (r.rccInvolved is int q4 ? q4 : 0),
            ProjectType = r.projectType as string,
            IsJointProject = Convert.ToInt32(r.isJointProject ?? 0) == 1,
            CoHostName = r.coHostName as string,
            ClubRole = r.clubRole as string,
            Photos = photos,
        };
    }

    private static async Task<int> ResolveYearIdAsync(MySqlConnection conn, int? yearId)
    {
        if (yearId.HasValue && yearId.Value > 0) return yearId.Value;
        var current = await conn.ExecuteScalarAsync<int?>(@"
            SELECT pk_year_id FROM rotary_year_master
            WHERE isdeleted = 0 AND IsCurrent = 1 LIMIT 1");
        return current ?? 0;
    }

    private async Task<AgIdentityDto> BuildIdentityAsync(MySqlConnection conn, int memberId, int yearId)
    {
        var ident = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT m.MemberName AS name, COALESCE(d.DistrictNumber,'') AS districtNumber
            FROM member_master_profile m
            LEFT JOIN district_ag ag ON ag.fk_member_id = m.pk_member_master_profile_id
              AND ag.isdeleted = 0 AND ag.is_active = 1
              AND (@YearId = 0 OR ag.fk_year_id = @YearId)
            LEFT JOIN club_master c ON c.pk_club_id = ag.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE m.pk_member_master_profile_id = @MemberId AND m.isdeleted = 0
            LIMIT 1",
            new { MemberId = memberId, YearId = yearId });

        var yearLabel = await conn.ExecuteScalarAsync<string?>(@"
            SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @YearId LIMIT 1",
            new { YearId = yearId }) ?? "";

        return new AgIdentityDto
        {
            MemberId = memberId,
            Name = ident?.name as string ?? "",
            DistrictNumber = (ident?.districtNumber as string) ?? "",
            YearLabel = yearLabel,
        };
    }

    // Members per club: ACTIVE members in club_members
    private async Task<Dictionary<int, int>> GetMemberCountsAsync(MySqlConnection conn, List<int> clubIds)
    {
        if (clubIds.Count == 0) return new Dictionary<int, int>();
        // Honorary members are never counted as part of "Total Members" (business rule
        // 2026-08-25) — an honorary member is not an active member of the club.
        var rows = await conn.QueryAsync<(int clubId, int cnt)>(@"
            SELECT fk_club_id, COUNT(*) AS cnt FROM club_members
            WHERE fk_club_id IN @ClubIds AND IsActive = 1 AND isdeleted = 0 AND IsHonoraryMember = 0
            GROUP BY fk_club_id",
            new { ClubIds = clubIds });
        return rows.ToDictionary(r => r.clubId, r => r.cnt);
    }

    // Meetings per club: club_attendance count
    private async Task<Dictionary<int, int>> GetMeetingCountsAsync(MySqlConnection conn, List<int> clubIds, int yearId)
    {
        if (clubIds.Count == 0) return new Dictionary<int, int>();
        var rows = await conn.QueryAsync<(int clubId, int cnt)>(@"
            SELECT fk_club_id, COUNT(*) AS cnt FROM club_attendance
            WHERE fk_club_id IN @ClubIds AND isdeleted = 0
              AND (@YearId = 0 OR fk_year_id = @YearId)
            GROUP BY fk_club_id",
            new { ClubIds = clubIds, YearId = yearId });
        return rows.ToDictionary(r => r.clubId, r => r.cnt);
    }

    // President + Secretary per club for a year, from the BOD.
    //
    // Matched on designation NAME, not id. The ids are seed-order dependent — the seed
    // gives 1=Club President, 2=Immediate Past President, 3=Vice President, 4=Club
    // Secretary — so hardcoding "2 = Secretary" would silently show the Immediate Past
    // President. Migrated data can order them differently again. Name matching excludes
    // "Immediate Past President" / "Vice President" / "Joint Secretary" explicitly.
    private async Task<Dictionary<int, (string President, string Secretary)>> GetOfficerNamesAsync(
        MySqlConnection conn, List<int> clubIds, int yearId)
    {
        var result = new Dictionary<int, (string, string)>();
        if (clubIds.Count == 0) return result;
        // Year is MANDATORY: the officers shown must belong to the selected year. With an
        // "any year" fallback a club with BOD rows across years would surface an arbitrary
        // year's President — worse than showing N/A, because it looks correct.
        if (yearId <= 0) return result;

        var rows = (await conn.QueryAsync<(int clubId, string designation, string name)>(@"
            SELECT bod.fk_club_id, dm.designation_name, m.MemberName
            FROM board_of_directors bod
            JOIN designation_master dm       ON dm.pk_designation_id = bod.fk_designation_id AND COALESCE(dm.isdeleted,0) = 0
            JOIN member_master_profile m     ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE bod.fk_club_id IN @ClubIds AND bod.isdeleted = 0
              AND bod.fk_year_id = @YearId
              AND ( (dm.designation_name LIKE '%President%'
                     AND dm.designation_name NOT LIKE '%Past%'
                     AND dm.designation_name NOT LIKE '%Vice%')
                 OR (dm.designation_name LIKE '%Secretary%'
                     AND dm.designation_name NOT LIKE '%Joint%') )",
            new { ClubIds = clubIds, YearId = yearId })).ToList();

        foreach (var g in rows.GroupBy(r => r.clubId))
        {
            var pres = g.FirstOrDefault(r => (r.designation ?? "").IndexOf("President", StringComparison.OrdinalIgnoreCase) >= 0).name ?? "";
            var sec  = g.FirstOrDefault(r => (r.designation ?? "").IndexOf("Secretary", StringComparison.OrdinalIgnoreCase) >= 0).name ?? "";
            result[g.Key] = (pres, sec);
        }
        return result;
    }

    // Club Service is NOT a project - it is what the club files under Club Service, and it has its own
    // figure on every AG screen. So every project number in this module (count, rank, beneficiaries,
    // man-hours, the monthly chart and the project lists) joins the 5 project avenues and leaves Club
    // Service out (user 2026-10-01). Same definition as ProjectCountRules, which the public website and
    // the daily email use, so the numbers agree. A row with no module at all (fk_module_id = 0) is in no
    // avenue and counts nowhere, exactly as on the website.
    private const string ProjectAvenueOnly = @"
                   JOIN module_master pm ON pm.pk_module_id = p.fk_module_id
                        AND pm.ModuleKey IN (" + ProjectCountFilter.ProjectModuleKeys + @")";

    // Project counts per club via year-wise tables
    private async Task<Dictionary<int, int>> GetProjectCountsAsync(MySqlConnection conn, List<int> clubIds, int yearId)
    {
        var result = clubIds.ToDictionary(id => id, _ => 0);
        if (clubIds.Count == 0) return result;
        var tables = await GetTargetTablesAsync(conn, yearId);
        foreach (var t in tables)
        {
            var rows = await conn.QueryAsync<(int clubId, int cnt)>(
                $@"SELECT p.fk_club_id, COUNT(*) AS cnt FROM `{t.ProjectsTable}` p
                   {ProjectAvenueOnly}
                   WHERE p.fk_club_id IN @ClubIds AND p.isdeleted = 0
                   GROUP BY p.fk_club_id",
                new { ClubIds = clubIds });
            foreach (var r in rows)
                result[r.clubId] = (result.TryGetValue(r.clubId, out var prev) ? prev : 0) + r.cnt;
        }
        return result;
    }

    // Club Service per club, from the year-wise project tables (user 2026-09-24).
    // The District view used to show "Meetings" = rows in club_attendance, which is the
    // attendance register, not what the club files under Club Service. This counts the
    // club's OWN club_service entries for the selected year - the same source the Club
    // Monthly Report uses - so the two screens agree.
    private async Task<Dictionary<int, int>> GetClubServiceCountsAsync(MySqlConnection conn, List<int> clubIds, int yearId)
    {
        var result = clubIds.ToDictionary(id => id, _ => 0);
        if (clubIds.Count == 0) return result;
        var tables = await GetTargetTablesAsync(conn, yearId);
        foreach (var t in tables)
        {
            var rows = await conn.QueryAsync<(int clubId, int cnt)>(
                $@"SELECT p.fk_club_id, COUNT(*) AS cnt
                   FROM `{t.ProjectsTable}` p
                   JOIN module_master m ON m.pk_module_id = p.fk_module_id
                   WHERE p.fk_club_id IN @ClubIds AND p.isdeleted = 0 AND m.ModuleKey = 'club_service'
                   GROUP BY p.fk_club_id",
                new { ClubIds = clubIds });
            foreach (var r in rows)
                result[r.clubId] = (result.TryGetValue(r.clubId, out var prev) ? prev : 0) + r.cnt;
        }
        return result;
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

    // TRF totals per club (broken out by fund type)
    private async Task<Dictionary<int, AgTrfBreakdownDto>> GetTrfBreakdownAsync(MySqlConnection conn, List<int> clubIds, int yearId)
    {
        var result = clubIds.ToDictionary(id => id, _ => new AgTrfBreakdownDto());
        if (clubIds.Count == 0) return result;
        var rows = await conn.QueryAsync<(int clubId, string? fundName, decimal amount)>(@"
            SELECT t.fk_club_id, COALESCE(f.FundName, t.OtherFundName, '') AS fundName, COALESCE(t.AmountUSD, 0) AS amount
            FROM trf_contributions t
            LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
            WHERE t.fk_club_id IN @ClubIds AND t.isdeleted = 0
              AND (@YearId = 0 OR t.fk_year_id = @YearId)",
            new { ClubIds = clubIds, YearId = yearId });

        foreach (var r in rows)
        {
            var b = result[r.clubId];
            var inr = r.amount * USD_INR;
            var fund = (r.fundName ?? "").ToLowerInvariant();
            if (fund.Contains("annual")) b.AnnualInr += inr;
            else if (fund.Contains("polio")) b.PolioInr += inr;
            else if (fund.Contains("endowment")) b.Endowment += inr;
            else b.Others += inr;
            b.TotalInr += inr;
            b.TotalUsd += r.amount;
        }
        return result;
    }

    // OCV = club_documents count (downloadonly/readonly access type)
    private async Task<Dictionary<int, int>> GetOcvCountsAsync(MySqlConnection conn, List<int> clubIds, int yearId)
    {
        var result = clubIds.ToDictionary(id => id, _ => 0);
        if (clubIds.Count == 0) return result;
        var rows = await conn.QueryAsync<(int clubId, int cnt)>(@"
            SELECT fk_club_id, COUNT(*) AS cnt FROM club_documents
            WHERE fk_club_id IN @ClubIds AND isdeleted = 0
              AND (AccessType IN ('readonly','downloadonly','read','download') OR AccessType IS NULL)
            GROUP BY fk_club_id",
            new { ClubIds = clubIds });
        foreach (var r in rows) result[r.clubId] = r.cnt;
        return result;
    }

    // Beneficiaries totals per club (sum of direct_beneficiaries across year tables)
    private async Task<Dictionary<int, int>> GetBeneficiaryTotalsAsync(MySqlConnection conn, List<int> clubIds, int yearId)
    {
        var result = clubIds.ToDictionary(id => id, _ => 0);
        if (clubIds.Count == 0) return result;
        var tables = await GetTargetTablesAsync(conn, yearId);
        foreach (var t in tables)
        {
            var rows = await conn.QueryAsync<(int clubId, int cnt)>(
                $@"SELECT p.fk_club_id, COALESCE(SUM(p.direct_beneficiaries),0) AS cnt FROM `{t.ProjectsTable}` p
                   {ProjectAvenueOnly}
                   WHERE p.fk_club_id IN @ClubIds AND p.isdeleted = 0
                   GROUP BY p.fk_club_id",
                new { ClubIds = clubIds });
            foreach (var r in rows) result[r.clubId] = (result.TryGetValue(r.clubId, out var prev) ? prev : 0) + r.cnt;
        }
        return result;
    }

    // Wave 12A: Goals-citations per club — count of citation_club_entry rows where
    // points_earned > 0, treated as "goals achieved" for the membership summary.
    private async Task<Dictionary<int, int>> GetGoalsCitationCountsAsync(MySqlConnection conn, List<int> clubIds, int yearId)
    {
        var result = clubIds.ToDictionary(id => id, _ => 0);
        if (clubIds.Count == 0) return result;
        try
        {
            var rows = await conn.QueryAsync<(int clubId, int cnt)>(@"
                SELECT fk_club_id, COUNT(*) AS cnt FROM district_citation_club_entry
                WHERE fk_club_id IN @ClubIds AND isdeleted = 0
                  AND COALESCE(points_earned, 0) > 0
                  AND (@YearId = 0 OR fk_year_id = @YearId)
                GROUP BY fk_club_id",
                new { ClubIds = clubIds, YearId = yearId });
            foreach (var r in rows) result[r.clubId] = r.cnt;
        }
        catch
        {
            // Table missing or column differs — leave zeros.
        }
        return result;
    }

    // Wave 12A: MyRotary tracking — reads from club_myrotary_tracking (created by
    // Wave 13A3). Returns (percentage, isPending) per club. When the table
    // doesn't exist or has no row, percentage is 0 and isPending is true.
    private async Task<Dictionary<int, (decimal pct, bool isPending)>> GetMyRotaryTrackingAsync(MySqlConnection conn, List<int> clubIds, int yearId)
    {
        var result = clubIds.ToDictionary(id => id, _ => ((decimal)0m, true));
        if (clubIds.Count == 0) return result;
        try
        {
            var rows = await conn.QueryAsync<(int clubId, decimal pct)>(@"
                SELECT fk_club_id, COALESCE(registration_percentage, 0) AS pct
                FROM club_myrotary_tracking
                WHERE fk_club_id IN @ClubIds AND isdeleted = 0
                  AND (@YearId = 0 OR fk_year_id = @YearId)",
                new { ClubIds = clubIds, YearId = yearId });
            foreach (var r in rows) result[r.clubId] = (r.pct, false);
        }
        catch
        {
            // Table doesn't exist yet (Wave 13A3 not shipped). Leave isPending=true.
        }
        return result;
    }

    // Wave 12A: Award status per club. Reads from club_award_status (created by
    // Wave 13A3). When the table is missing or no row exists, returns a row
    // with IsPending=true and all status fields = "pending".
    private async Task<(Dictionary<int, AgAwardStatusDto> map, bool tableMissing)>
        GetAwardStatusAsync(MySqlConnection conn, List<int> clubIds, int yearId, Dictionary<int, string> clubNames)
    {
        var map = clubIds.ToDictionary(id => id, id => new AgAwardStatusDto
        {
            ClubId = id,
            ClubName = clubNames.GetValueOrDefault(id, ""),
            IsPending = true,
            PresidentialCitation = "pending",
            DistrictCitation = "pending",
            MembershipExcellence = "pending",
        });
        if (clubIds.Count == 0) return (map, false);
        try
        {
            var rows = await conn.QueryAsync<(int clubId, bool? onTrack, bool? achieved, string? pres, string? dist, string? mem)>(@"
                SELECT fk_club_id, on_track, achieved,
                       COALESCE(presidential_citation_status, 'pending') AS pres,
                       COALESCE(district_citation_status, 'pending') AS dist,
                       COALESCE(membership_excellence_status, 'pending') AS mem
                FROM club_award_status
                WHERE fk_club_id IN @ClubIds AND isdeleted = 0
                  AND (@YearId = 0 OR fk_year_id = @YearId)",
                new { ClubIds = clubIds, YearId = yearId });
            foreach (var r in rows)
            {
                map[r.clubId] = new AgAwardStatusDto
                {
                    ClubId = r.clubId,
                    ClubName = clubNames.GetValueOrDefault(r.clubId, ""),
                    OnTrack = r.onTrack ?? false,
                    Achieved = r.achieved ?? false,
                    PresidentialCitation = r.pres ?? "pending",
                    DistrictCitation = r.dist ?? "pending",
                    MembershipExcellence = r.mem ?? "pending",
                    IsPending = false,
                };
            }
            return (map, false);
        }
        catch
        {
            // Table doesn't exist yet — table-level pending flag set on response.
            return (map, true);
        }
    }

    // Wave 12A: Man-hours sum per club, reading the optional `man_hours` column
    // on each year's rotary_projects table. Returns (totalManHoursByClub,
    // isPending) — when the column is missing on every queried table, pending=true.
    private async Task<(Dictionary<int, int> byClub, bool isPending)>
        GetManHoursAsync(MySqlConnection conn, List<int> clubIds, int yearId)
    {
        var result = clubIds.ToDictionary(id => id, _ => 0);
        if (clubIds.Count == 0) return (result, true);
        var tables = await GetTargetTablesAsync(conn, yearId);
        if (tables.Count == 0) return (result, true);

        var anyColumnFound = false;
        foreach (var t in tables)
        {
            try
            {
                var rows = await conn.QueryAsync<(int clubId, int hrs)>(
                    $@"SELECT p.fk_club_id, COALESCE(SUM(p.man_hours), 0) AS hrs FROM `{t.ProjectsTable}` p
                       {ProjectAvenueOnly}
                       WHERE p.fk_club_id IN @ClubIds AND p.isdeleted = 0
                       GROUP BY p.fk_club_id",
                    new { ClubIds = clubIds });
                anyColumnFound = true;
                foreach (var r in rows) result[r.clubId] = result.GetValueOrDefault(r.clubId, 0) + r.hrs;
            }
            catch
            {
                // man_hours column doesn't exist on this year's table — skip.
            }
        }
        return (result, !anyColumnFound);
    }

    // Project rank — among all clubs in the AG's district, ordered by project count desc.
    private async Task<Dictionary<int, int>> GetProjectRanksAsync(MySqlConnection conn, List<int> clubIds, int yearId)
    {
        var result = clubIds.ToDictionary(id => id, _ => 0);
        if (clubIds.Count == 0) return result;

        // Find the district that contains the AG's clubs (use the first as representative)
        var districtId = await conn.ExecuteScalarAsync<int?>(@"
            SELECT fk_district_id FROM club_master
            WHERE pk_club_id = @ClubId AND isdeleted = 0 LIMIT 1",
            new { ClubId = clubIds.First() });
        if (districtId == null || districtId.Value <= 0) return result;

        var districtClubIds = (await conn.QueryAsync<int>(@"
            SELECT pk_club_id FROM club_master
            WHERE fk_district_id = @DistrictId AND isdeleted = 0",
            new { DistrictId = districtId.Value })).ToList();
        if (districtClubIds.Count == 0) return result;

        var counts = new Dictionary<int, int>();
        foreach (var id in districtClubIds) counts[id] = 0;

        var tables = await GetTargetTablesAsync(conn, yearId);
        foreach (var t in tables)
        {
            var rows = await conn.QueryAsync<(int clubId, int cnt)>(
                $@"SELECT p.fk_club_id, COUNT(*) AS cnt FROM `{t.ProjectsTable}` p
                   {ProjectAvenueOnly}
                   WHERE p.fk_club_id IN @ClubIds AND p.isdeleted = 0
                   GROUP BY p.fk_club_id",
                new { ClubIds = districtClubIds });
            foreach (var r in rows) counts[r.clubId] = (counts.TryGetValue(r.clubId, out var prev) ? prev : 0) + r.cnt;
        }

        var ordered = counts.OrderByDescending(kv => kv.Value).ToList();
        for (int i = 0; i < ordered.Count; i++)
        {
            if (result.ContainsKey(ordered[i].Key))
                result[ordered[i].Key] = i + 1;
        }
        return result;
    }

    // ─── 1. GetClubs (My Clubs landing) ──────────────────────────────────

    public async Task<AgClubsResponse> GetClubsAsync(int memberId, int? yearId, int? requestedClubId = null, int? requestedDistrictId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var clubIds = await ResolveAgClubIdsAsync(conn, memberId, resolvedYearId, requestedClubId, requestedDistrictId);
        var identity = await BuildIdentityAsync(conn, memberId, resolvedYearId);

        if (clubIds.Count == 0)
            return new AgClubsResponse { Ag = identity, Clubs = new List<AgClubSummaryDto>() };

        // Sync flag + website status use the SAME definitions as the SuperAdmin global
        // search (GlobalSearchController) so the two screens can never disagree about
        // whether a club is synced or its site is live.
        var clubMeta = (await conn.QueryAsync<(int clubId, string clubName, string districtNumber, int? districtId,
                                               bool isSynced, string websiteSubdomain, string websiteStatus)>(@"
            SELECT c.pk_club_id, c.ClubName, COALESCE(d.DistrictNumber,'') AS districtNumber, d.pk_district_id,
                   COALESCE(c.IsSyncedFromRotaryOrg, 0) AS isSynced,
                   (SELECT cw.Subdomain
                      FROM club_websites cw
                      WHERE cw.fk_club_id = c.pk_club_id AND COALESCE(cw.isdeleted, 0) = 0
                      ORDER BY cw.pk_id DESC LIMIT 1) AS websiteSubdomain,
                   (SELECT CASE
                             WHEN cw.Status = 'Active' AND (cw.EndDate IS NULL OR cw.EndDate >= CURDATE()) THEN 'active'
                             WHEN cw.Status = 'Active' AND cw.EndDate < CURDATE() THEN 'expired'
                             WHEN cw.Status IS NOT NULL THEN 'expired'
                             ELSE 'none'
                           END
                      FROM club_websites cw
                      WHERE cw.fk_club_id = c.pk_club_id AND COALESCE(cw.isdeleted, 0) = 0
                      ORDER BY cw.pk_id DESC LIMIT 1) AS websiteStatus
            FROM club_master c
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE c.pk_club_id IN @ClubIds AND c.isdeleted = 0",
            new { ClubIds = clubIds })).ToList();

        var members = await GetMemberCountsAsync(conn, clubIds);
        // Club Service, not club_attendance (user 2026-09-29) - see AgClubSummaryDto.ClubService.
        var clubService = await GetClubServiceCountsAsync(conn, clubIds, resolvedYearId);
        var officers = await GetOfficerNamesAsync(conn, clubIds, resolvedYearId);
        var projectCounts = await GetProjectCountsAsync(conn, clubIds, resolvedYearId);
        var ranks = await GetProjectRanksAsync(conn, clubIds, resolvedYearId);
        var trf = await GetTrfBreakdownAsync(conn, clubIds, resolvedYearId);
        var ocv = await GetOcvCountsAsync(conn, clubIds, resolvedYearId);

        var clubs = new List<AgClubSummaryDto>();
        foreach (var c in clubMeta.OrderBy(x => x.clubName))
        {
            clubs.Add(new AgClubSummaryDto
            {
                ClubId = c.clubId,
                ClubName = c.clubName,
                DistrictNumber = c.districtNumber,
                PresidentName = officers.TryGetValue(c.clubId, out var o) ? o.President : "",
                SecretaryName = officers.TryGetValue(c.clubId, out var o2) ? o2.Secretary : "",
                IsSyncedFromRotaryOrg = c.isSynced,
                ClubWebsiteStatus = string.IsNullOrEmpty(c.websiteStatus) ? "none" : c.websiteStatus,
                ClubWebsiteSubdomain = c.websiteSubdomain,
                Members = members.GetValueOrDefault(c.clubId, 0),
                ClubService = clubService.GetValueOrDefault(c.clubId, 0),
                TotalProjects = projectCounts.GetValueOrDefault(c.clubId, 0),
                ProjectRank = ranks.GetValueOrDefault(c.clubId, 0),
                TrfTotalInr = trf.TryGetValue(c.clubId, out var t) ? t.TotalInr : 0,
                TrfTotalUsd = trf.TryGetValue(c.clubId, out var t2) ? t2.TotalUsd : 0,
                Ocv = ocv.GetValueOrDefault(c.clubId, 0),
            });
        }

        int totalClubsInDistrict = 0;
        if (clubIds.Count > 0)
        {
            var districtId = await conn.ExecuteScalarAsync<int?>(@"
                SELECT fk_district_id FROM club_master WHERE pk_club_id = @ClubId LIMIT 1",
                new { ClubId = clubIds.First() });
            if (districtId.HasValue)
            {
                totalClubsInDistrict = await conn.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM club_master WHERE fk_district_id = @DistrictId AND isdeleted = 0",
                    new { DistrictId = districtId.Value });
            }
        }

        return new AgClubsResponse
        {
            Ag = identity,
            Clubs = clubs,
            TotalMembers = clubs.Sum(c => c.Members),
            TotalClubService = clubs.Sum(c => c.ClubService),
            TotalProjects = clubs.Sum(c => c.TotalProjects),
            TotalTrfInr = clubs.Sum(c => c.TrfTotalInr),
            TotalClubsInDistrict = totalClubsInDistrict,
        };
    }

    // ─── 2. GetClubDetail (one club drill-down) ──────────────────────────

    public async Task<AgClubDetailResponse?> GetClubDetailAsync(int memberId, int clubId, int? yearId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var clubIds = await GetAgClubIdsAsync(conn, memberId, resolvedYearId);
        if (!clubIds.Contains(clubId)) return null;

        var meta = await conn.QueryFirstOrDefaultAsync<(int clubId, string clubName, string districtNumber)>(@"
            SELECT c.pk_club_id, c.ClubName, COALESCE(d.DistrictNumber,'')
            FROM club_master c LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE c.pk_club_id = @ClubId AND c.isdeleted = 0 LIMIT 1",
            new { ClubId = clubId });

        var only = new List<int> { clubId };
        var members = await GetMemberCountsAsync(conn, only);
        var meetings = await GetMeetingCountsAsync(conn, only, resolvedYearId);   // monthly trend only
        var clubServiceOne = await GetClubServiceCountsAsync(conn, only, resolvedYearId);
        var officers = await GetOfficerNamesAsync(conn, only, resolvedYearId);
        var projectCounts = await GetProjectCountsAsync(conn, only, resolvedYearId);
        var ranks = await GetProjectRanksAsync(conn, only, resolvedYearId);
        var trf = await GetTrfBreakdownAsync(conn, only, resolvedYearId);
        var ocv = await GetOcvCountsAsync(conn, only, resolvedYearId);

        var summary = new AgClubSummaryDto
        {
            ClubId = clubId,
            ClubName = meta.clubName,
            DistrictNumber = meta.districtNumber,
            PresidentName = officers.GetValueOrDefault(clubId).President ?? "",
            SecretaryName = officers.GetValueOrDefault(clubId).Secretary ?? "",
            Members = members.GetValueOrDefault(clubId, 0),
            ClubService = clubServiceOne.GetValueOrDefault(clubId, 0),
            TotalProjects = projectCounts.GetValueOrDefault(clubId, 0),
            ProjectRank = ranks.GetValueOrDefault(clubId, 0),
            TrfTotalInr = trf[clubId].TotalInr,
            TrfTotalUsd = trf[clubId].TotalUsd,
            Ocv = ocv.GetValueOrDefault(clubId, 0),
        };

        var monthly = await BuildMonthlySeriesForClubAsync(conn, clubId, resolvedYearId);

        var tables = await GetTargetTablesAsync(conn, resolvedYearId);
        var recentProjects = new List<AgProjectRowDto>();
        foreach (var t in tables)
        {
            var rows = await conn.QueryAsync<dynamic>(
                $@"SELECT p.title, p.project_date AS projectDate,
                          COALESCE(md.ModuleName,'') AS avenue,
                          COALESCE(aof.name,'') AS areaOfFocus,
                          COALESCE(p.project_cost, 0) AS cost,
                          COALESCE(p.direct_beneficiaries, 0) AS beneficiaries,
                          (COALESCE(p.rotarians_involved,0) + COALESCE(p.rotaractors_involved,0)) AS rotarians,
                          COALESCE(f.name,'') AS funding
                   FROM `{t.ProjectsTable}` p
                   LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
                   LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
                   LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
                   {ProjectAvenueOnly}
                   WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0
                   ORDER BY p.project_date DESC LIMIT 10",
                new { ClubId = clubId });
            foreach (var r in rows)
            {
                DateTime? d = r.projectDate is DateTime dd ? dd : (DateTime?)null;
                recentProjects.Add(new AgProjectRowDto
                {
                    ClubId = clubId,
                    ClubName = meta.clubName,
                    Title = r.title as string ?? "",
                    Avenue = r.avenue as string,
                    AreaOfFocus = r.areaOfFocus as string,
                    Date = d?.ToString("yyyy-MM-dd"),
                    Cost = r.cost is decimal cost ? cost : 0,
                    Beneficiaries = r.beneficiaries is long b1 ? (int)b1 : (r.beneficiaries is int b2 ? b2 : 0),
                    Funding = r.funding as string ?? "",
                    Rotarians = r.rotarians is long ro1 ? (int)ro1 : (r.rotarians is int ro2 ? ro2 : 0),
                });
            }
        }

        return new AgClubDetailResponse
        {
            Summary = summary,
            Monthly = monthly,
            Trf = trf[clubId],
            RecentProjects = recentProjects.Take(10).ToList(),
        };
    }

    private async Task<List<AgMonthlyPointDto>> BuildMonthlySeriesForClubAsync(MySqlConnection conn, int clubId, int yearId)
    {
        var (start, _) = await ResolveYearRangeAsync(conn, yearId);
        if (start == null) return new List<AgMonthlyPointDto>();

        var points = new List<AgMonthlyPointDto>();
        for (int i = 0; i < 9; i++)
        {
            var monthStart = start.Value.AddMonths(i);
            var monthEnd = monthStart.AddMonths(1);
            var label = $"{MONTH_LABELS[i]} {monthStart:yyyy}";

            // Club Service filed in this month, not attendance rows (user 2026-10-01) - the per-month
            // slice of GetClubServiceCountsAsync, so the chart adds up to the club's yearly figure.
            int clubServiceThisMonth = 0;
            foreach (var ct in await GetTargetTablesAsync(conn, yearId))
            {
                clubServiceThisMonth += await conn.ExecuteScalarAsync<int>(
                    $@"SELECT COUNT(*) FROM `{ct.ProjectsTable}` p
                       JOIN module_master m ON m.pk_module_id = p.fk_module_id
                       WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0
                         AND m.ModuleKey = 'club_service'
                         AND p.project_date >= @Start AND p.project_date < @End",
                    new { ClubId = clubId, Start = monthStart, End = monthEnd });
            }

            var trf = await conn.ExecuteScalarAsync<decimal?>(@"
                SELECT COALESCE(SUM(AmountUSD),0) FROM trf_contributions
                WHERE fk_club_id = @ClubId AND isdeleted = 0
                  AND TrfDate >= @Start AND TrfDate < @End",
                new { ClubId = clubId, Start = monthStart, End = monthEnd }) ?? 0;

            int projects = 0;
            var tables = await GetTargetTablesAsync(conn, yearId);
            foreach (var t in tables)
            {
                projects += await conn.ExecuteScalarAsync<int>(
                    $@"SELECT COUNT(*) FROM `{t.ProjectsTable}` p
                       {ProjectAvenueOnly}
                       WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0
                         AND p.project_date >= @Start AND p.project_date < @End",
                    new { ClubId = clubId, Start = monthStart, End = monthEnd });
            }

            points.Add(new AgMonthlyPointDto
            {
                Month = label,
                ClubService = clubServiceThisMonth,
                Projects = projects,
                TrfInr = trf * USD_INR,
            });
        }
        return points;
    }

    private async Task<(DateTime? start, DateTime? end)> ResolveYearRangeAsync(MySqlConnection conn, int yearId)
    {
        if (yearId <= 0) return (null, null);
        var row = await conn.QueryFirstOrDefaultAsync<(DateTime start, DateTime end)?>(@"
            SELECT StartDate, EndDate FROM rotary_year_master WHERE pk_year_id = @Id LIMIT 1",
            new { Id = yearId });
        return row == null ? (null, null) : (row.Value.start, row.Value.end);
    }

    // ─── 3. GetMembership ───────────────────────────────────────────────

    public async Task<AgMembershipResponse> GetMembershipAsync(int memberId, int? yearId, int? requestedClubId = null, int? requestedDistrictId = null)
    {
        var clubs = await GetClubsAsync(memberId, yearId, requestedClubId, requestedDistrictId);
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubIds = clubs.Clubs.Select(c => c.ClubId).ToList();
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var benefMap = await GetBeneficiaryTotalsAsync(conn, clubIds, resolvedYearId);
        var goalsMap = await GetGoalsCitationCountsAsync(conn, clubIds, resolvedYearId);

        var rows = clubs.Clubs.Select(c => new AgMembershipClubRowDto
        {
            ClubId = c.ClubId,
            ClubName = c.ClubName,
            Members = c.Members,
            ClubService = c.ClubService,
            TotalProjects = c.TotalProjects,
            ProjectRank = c.ProjectRank,
            Trf = c.TrfTotalInr,
            Ocv = c.Ocv,
            Beneficiaries = benefMap.GetValueOrDefault(c.ClubId, 0),
            GoalsCitations = goalsMap.GetValueOrDefault(c.ClubId, 0),
        }).ToList();

        return new AgMembershipResponse
        {
            Ag = clubs.Ag,
            Clubs = rows,
            TotalMembers = clubs.TotalMembers,
            TotalClubService = clubs.TotalClubService,
            TotalProjects = clubs.TotalProjects,
            TotalTrfInr = clubs.TotalTrfInr,
            TotalOcv = rows.Sum(r => r.Ocv),
            TotalBeneficiaries = rows.Sum(r => r.Beneficiaries),
            TotalClubsInDistrict = clubs.TotalClubsInDistrict,
        };
    }

    // ─── 4. GetTrf ──────────────────────────────────────────────────────

    public async Task<AgTrfResponse> GetTrfAsync(int memberId, int? yearId, int? requestedClubId = null, int? requestedDistrictId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var clubIds = await ResolveAgClubIdsAsync(conn, memberId, resolvedYearId, requestedClubId, requestedDistrictId);
        var identity = await BuildIdentityAsync(conn, memberId, resolvedYearId);
        if (clubIds.Count == 0) return new AgTrfResponse { Ag = identity };

        var clubMeta = (await conn.QueryAsync<(int clubId, string clubName)>(@"
            SELECT pk_club_id, ClubName FROM club_master
            WHERE pk_club_id IN @ClubIds AND isdeleted = 0",
            new { ClubIds = clubIds })).ToDictionary(c => c.clubId, c => c.clubName);

        var members = await GetMemberCountsAsync(conn, clubIds);
        var breakdown = await GetTrfBreakdownAsync(conn, clubIds, resolvedYearId);

        var totals = new AgTrfBreakdownDto();
        var list = new List<AgClubTrfDto>();
        foreach (var (cid, br) in breakdown)
        {
            list.Add(new AgClubTrfDto
            {
                ClubId = cid,
                ClubName = clubMeta.GetValueOrDefault(cid, ""),
                Members = members.GetValueOrDefault(cid, 0),
                Trf = br,
            });
            totals.AnnualInr += br.AnnualInr;
            totals.PolioInr += br.PolioInr;
            totals.Endowment += br.Endowment;
            totals.Others += br.Others;
            totals.TotalInr += br.TotalInr;
            totals.TotalUsd += br.TotalUsd;
        }
        // Wave 12A: per-club percent of AG total — needs full totals first.
        if (totals.TotalInr > 0)
        {
            foreach (var row in list)
                row.PercentOfAgTotal = Math.Round(row.Trf.TotalInr / totals.TotalInr * 100m, 1);
        }
        list = list.OrderByDescending(c => c.Trf.TotalInr).ToList();

        return new AgTrfResponse { Ag = identity, Clubs = list, Totals = totals };
    }

    // ─── 5. GetExcellence (Citation + Goals + Monthly tracking) ──────────

    public async Task<AgExcellenceResponse> GetExcellenceAsync(int memberId, int? yearId, int? requestedClubId = null, int? requestedDistrictId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var clubIds = await ResolveAgClubIdsAsync(conn, memberId, resolvedYearId, requestedClubId, requestedDistrictId);
        var identity = await BuildIdentityAsync(conn, memberId, resolvedYearId);
        if (clubIds.Count == 0) return new AgExcellenceResponse { Ag = identity };

        var clubMeta = (await conn.QueryAsync<(int clubId, string clubName)>(@"
            SELECT pk_club_id, ClubName FROM club_master
            WHERE pk_club_id IN @ClubIds AND isdeleted = 0",
            new { ClubIds = clubIds })).ToDictionary(c => c.clubId, c => c.clubName);

        var members = await GetMemberCountsAsync(conn, clubIds);
        var meetings = await GetMeetingCountsAsync(conn, clubIds, resolvedYearId);
        var projects = await GetProjectCountsAsync(conn, clubIds, resolvedYearId);
        var trf = await GetTrfBreakdownAsync(conn, clubIds, resolvedYearId);

        // Citation — sum points + bonus per club for this year
        var citationTotals = await conn.QueryAsync<(int clubId, decimal pts)>(@"
            SELECT fk_club_id, COALESCE(SUM(points_earned),0) + COALESCE(SUM(bonus_earned),0) AS pts
            FROM district_citation_club_entry
            WHERE fk_club_id IN @ClubIds AND isdeleted = 0
              AND (@YearId = 0 OR fk_year_id = @YearId)
            GROUP BY fk_club_id",
            new { ClubIds = clubIds, YearId = resolvedYearId });
        var citationMap = citationTotals.ToDictionary(c => c.clubId, c => c.pts);

        // Citation by category (matched via question's category — fk_question_id → category_id)
        // We do a best-effort split: try to join district_citation_question on category. If schema
        // is different in production, the category breakdown defaults to even split.
        var byCategory = new Dictionary<int, Dictionary<string, decimal>>();
        try
        {
            var catRows = await conn.QueryAsync<(int clubId, string cat, decimal pts)>(@"
                SELECT e.fk_club_id, COALESCE(c.category_name,'Other') AS cat,
                       COALESCE(SUM(e.points_earned),0) + COALESCE(SUM(e.bonus_earned),0) AS pts
                FROM district_citation_club_entry e
                LEFT JOIN district_citation_question q ON q.pk_question_id = e.fk_question_id
                LEFT JOIN district_citation_category c ON c.pk_category_id = q.fk_category_id
                WHERE e.fk_club_id IN @ClubIds AND e.isdeleted = 0
                  AND (@YearId = 0 OR e.fk_year_id = @YearId)
                GROUP BY e.fk_club_id, COALESCE(c.category_name,'Other')",
                new { ClubIds = clubIds, YearId = resolvedYearId });
            foreach (var r in catRows)
            {
                if (!byCategory.TryGetValue(r.clubId, out var d))
                    byCategory[r.clubId] = d = new Dictionary<string, decimal>();
                d[r.cat] = r.pts;
            }
        }
        catch
        {
            // Schema differs — skip the category split. Totals still correct.
        }

        var citation = new List<AgCitationClubRowDto>();
        foreach (var cid in clubIds)
        {
            var total = citationMap.GetValueOrDefault(cid, 0m);
            var cats = byCategory.GetValueOrDefault(cid) ?? new Dictionary<string, decimal>();
            decimal Find(string key) => cats.FirstOrDefault(kv => kv.Key.Contains(key, StringComparison.OrdinalIgnoreCase)).Value;
            citation.Add(new AgCitationClubRowDto
            {
                ClubId = cid,
                ClubName = clubMeta.GetValueOrDefault(cid, ""),
                Members = members.GetValueOrDefault(cid, 0),
                Total = total,
                Membership = Find("member"),
                Trf = Find("trf"),
                Service = Find("service"),
                PublicImage = Find("public"),
                Youth = Find("youth"),
                Foundation = Find("foundation"),
            });
        }
        citation = citation.OrderByDescending(c => c.Total).ToList();

        // Wave 12A: MyRotary tracking lookup — single call, graceful when table missing.
        var myRotaryMap = await GetMyRotaryTrackingAsync(conn, clubIds, resolvedYearId);

        // Goals — derive what we can from real data; rest defaults to 0
        var goals = new List<AgGoalsClubRowDto>();
        foreach (var cid in clubIds)
        {
            var m = members.GetValueOrDefault(cid, 0);
            var trfTotalInr = trf.TryGetValue(cid, out var t) ? t.TotalInr : 0;
            var attendance = await ComputeMeetingAttendanceAsync(conn, cid, resolvedYearId);
            var newMembers = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_members
                WHERE fk_club_id = @ClubId AND isdeleted = 0
                  AND JoinedDate >= (SELECT StartDate FROM rotary_year_master WHERE pk_year_id = @YearId)
                  AND JoinedDate <= (SELECT EndDate FROM rotary_year_master WHERE pk_year_id = @YearId)",
                new { ClubId = cid, YearId = resolvedYearId });

            var (myRotaryPct, myRotaryPending) = myRotaryMap.TryGetValue(cid, out var mr) ? mr : (0m, true);

            goals.Add(new AgGoalsClubRowDto
            {
                ClubId = cid,
                ClubName = clubMeta.GetValueOrDefault(cid, ""),
                Members = m,
                MembershipGrowth = m > 0 && newMembers > 0 ? Math.Round((decimal)newMembers / m * 100m, 1) : 0,
                TrfPerCapita = m > 0 ? Math.Round(trfTotalInr / m, 0) : 0,
                ServiceProjects = projects.GetValueOrDefault(cid, 0),
                MeetingAttendance = attendance,
                MyRotary = myRotaryPct,
                MyRotaryIsPending = myRotaryPending,
                NewMembers = newMembers,
            });
        }

        // Wave 12A: Award status per club (club_award_status). When the table
        // doesn't exist yet (pre-Wave-13A3), AwardStatusIsPending=true and the
        // per-row IsPending=true with status fields = "pending".
        var (awardMap, awardTableMissing) = await GetAwardStatusAsync(conn, clubIds, resolvedYearId, clubMeta);
        var awardStatus = clubIds.Select(cid => awardMap[cid]).ToList();

        // Monthly tracking series (projects, meetings, trf — one series per club)
        var monthlyProjects = new List<AgMonthlyTrackingPointDto>();
        var monthlyMeetings = new List<AgMonthlyTrackingPointDto>();
        var monthlyTrf = new List<AgMonthlyTrackingPointDto>();
        var (start, _) = await ResolveYearRangeAsync(conn, resolvedYearId);
        if (start != null)
        {
            for (int i = 0; i < 9; i++)
            {
                var monthStart = start.Value.AddMonths(i);
                var monthEnd = monthStart.AddMonths(1);
                var label = $"{MONTH_LABELS[i]} {monthStart:yyyy}";

                var p = new AgMonthlyTrackingPointDto { Month = label };
                var me = new AgMonthlyTrackingPointDto { Month = label };
                var tr = new AgMonthlyTrackingPointDto { Month = label };

                foreach (var cid in clubIds)
                {
                    var name = clubMeta.GetValueOrDefault(cid, $"Club {cid}");
                    int projCount = 0;
                    var tables = await GetTargetTablesAsync(conn, resolvedYearId);
                    foreach (var tbl in tables)
                    {
                        projCount += await conn.ExecuteScalarAsync<int>(
                            $@"SELECT COUNT(*) FROM `{tbl.ProjectsTable}` p
                               {ProjectAvenueOnly}
                               WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0
                                 AND p.project_date >= @Start AND p.project_date < @End",
                            new { ClubId = cid, Start = monthStart, End = monthEnd });
                    }
                    var meet = await conn.ExecuteScalarAsync<int>(@"
                        SELECT COUNT(*) FROM club_attendance
                        WHERE fk_club_id = @ClubId AND isdeleted = 0
                          AND EventDateTime >= @Start AND EventDateTime < @End",
                        new { ClubId = cid, Start = monthStart, End = monthEnd });
                    var trfUsd = await conn.ExecuteScalarAsync<decimal?>(@"
                        SELECT COALESCE(SUM(AmountUSD),0) FROM trf_contributions
                        WHERE fk_club_id = @ClubId AND isdeleted = 0
                          AND TrfDate >= @Start AND TrfDate < @End",
                        new { ClubId = cid, Start = monthStart, End = monthEnd }) ?? 0;

                    p.ByClub[name] = projCount;
                    me.ByClub[name] = meet;
                    tr.ByClub[name] = trfUsd * USD_INR;
                }
                monthlyProjects.Add(p);
                monthlyMeetings.Add(me);
                monthlyTrf.Add(tr);
            }
        }

        var avgCitation = citation.Count > 0 ? Math.Round(citation.Sum(c => c.Total) / citation.Count, 0) : 0;
        var topClub = citation.FirstOrDefault();

        return new AgExcellenceResponse
        {
            Ag = identity,
            Citation = citation,
            Goals = goals,
            MonthlyProjects = monthlyProjects,
            MonthlyMeetings = monthlyMeetings,
            MonthlyTrf = monthlyTrf,
            AverageCitationScore = avgCitation,
            TopScoringClub = topClub,
            AwardStatus = awardStatus,
            AwardStatusIsPending = awardTableMissing,
        };
    }

    private async Task<decimal> ComputeMeetingAttendanceAsync(MySqlConnection conn, int clubId, int yearId)
    {
        var rows = await conn.QueryAsync<(int total, int present)>(@"
            SELECT
                (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = a.fk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0) AS total,
                (SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) AS present
            FROM club_attendance a
            WHERE a.fk_club_id = @ClubId AND a.isdeleted = 0
              AND (@YearId = 0 OR a.fk_year_id = @YearId)",
            new { ClubId = clubId, YearId = yearId });
        var list = rows.ToList();
        if (list.Count == 0) return 0;
        var totals = list.Where(r => r.total > 0).ToList();
        if (totals.Count == 0) return 0;
        var avgPct = totals.Average(r => (decimal)r.present / r.total * 100m);
        return Math.Round(avgPct, 1);
    }

    // ─── 6. GetYouth ─────────────────────────────────────────────────────

    public async Task<AgYouthResponse> GetYouthAsync(int memberId, int? yearId, int? requestedClubId = null, int? requestedDistrictId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var clubIds = await ResolveAgClubIdsAsync(conn, memberId, resolvedYearId, requestedClubId, requestedDistrictId);
        var identity = await BuildIdentityAsync(conn, memberId, resolvedYearId);
        if (clubIds.Count == 0) return new AgYouthResponse { Ag = identity };

        var clubMeta = (await conn.QueryAsync<(int clubId, string clubName)>(@"
            SELECT pk_club_id, ClubName FROM club_master
            WHERE pk_club_id IN @ClubIds AND isdeleted = 0",
            new { ClubIds = clubIds })).ToDictionary(c => c.clubId, c => c.clubName);

        var members = await GetMemberCountsAsync(conn, clubIds);
        var meetings = await GetMeetingCountsAsync(conn, clubIds, resolvedYearId);

        // Count projects per club + per service-avenue (matched via module name LIKE)
        var newGenMap = new Dictionary<int, int>();
        var vocMap = new Dictionary<int, int>();
        var intlMap = new Dictionary<int, int>();
        var totalsMap = new Dictionary<int, int>();
        var tables = await GetTargetTablesAsync(conn, resolvedYearId);
        foreach (var t in tables)
        {
            var rows = await conn.QueryAsync<(int clubId, string? modName, int cnt)>(
                $@"SELECT p.fk_club_id, COALESCE(md.ModuleName,'') AS modName, COUNT(*) AS cnt
                   FROM `{t.ProjectsTable}` p
                   LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
                   {ProjectAvenueOnly}
                   WHERE p.fk_club_id IN @ClubIds AND p.isdeleted = 0
                   GROUP BY p.fk_club_id, COALESCE(md.ModuleName,'')",
                new { ClubIds = clubIds });
            foreach (var r in rows)
            {
                totalsMap[r.clubId] = totalsMap.GetValueOrDefault(r.clubId, 0) + r.cnt;
                var lower = (r.modName ?? "").ToLowerInvariant();
                if (lower.Contains("new generation") || lower.Contains("youth"))
                    newGenMap[r.clubId] = newGenMap.GetValueOrDefault(r.clubId, 0) + r.cnt;
                else if (lower.Contains("vocational"))
                    vocMap[r.clubId] = vocMap.GetValueOrDefault(r.clubId, 0) + r.cnt;
                else if (lower.Contains("international"))
                    intlMap[r.clubId] = intlMap.GetValueOrDefault(r.clubId, 0) + r.cnt;
            }
        }

        var list = clubIds.Select(cid => new AgYouthClubRowDto
        {
            ClubId = cid,
            ClubName = clubMeta.GetValueOrDefault(cid, ""),
            NewGenerationService = newGenMap.GetValueOrDefault(cid, 0),
            VocationalService = vocMap.GetValueOrDefault(cid, 0),
            InternationalService = intlMap.GetValueOrDefault(cid, 0),
            TotalProjects = totalsMap.GetValueOrDefault(cid, 0),
            Members = members.GetValueOrDefault(cid, 0),
            Meetings = meetings.GetValueOrDefault(cid, 0),
        }).OrderBy(c => c.ClubName).ToList();

        return new AgYouthResponse
        {
            Ag = identity,
            Clubs = list,
            TotalNewGeneration = list.Sum(c => c.NewGenerationService),
            TotalVocational = list.Sum(c => c.VocationalService),
            TotalInternational = list.Sum(c => c.InternationalService),
            TotalProjects = list.Sum(c => c.TotalProjects),
        };
    }

    // ─── 7. GetProjects ──────────────────────────────────────────────────

    public async Task<AgProjectsResponse> GetProjectsAsync(int memberId, int? yearId, int? requestedClubId = null, int? requestedDistrictId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var clubIds = await ResolveAgClubIdsAsync(conn, memberId, resolvedYearId, requestedClubId, requestedDistrictId);
        var identity = await BuildIdentityAsync(conn, memberId, resolvedYearId);
        if (clubIds.Count == 0) return new AgProjectsResponse { Ag = identity };

        var clubMeta = (await conn.QueryAsync<(int clubId, string clubName)>(@"
            SELECT pk_club_id, ClubName FROM club_master
            WHERE pk_club_id IN @ClubIds AND isdeleted = 0",
            new { ClubIds = clubIds })).ToDictionary(c => c.clubId, c => c.clubName);

        var projects = new List<AgProjectRowDto>();
        var tables = await GetTargetTablesAsync(conn, resolvedYearId);
        // Wave 12A: try to read the optional `man_hours` column. If absent on a
        // given year table, fall back to a query without it and flag pending.
        var anyManHoursColumn = false;
        foreach (var t in tables)
        {
            bool tableHasManHours = false;
            IEnumerable<dynamic> rows;
            try
            {
                rows = await conn.QueryAsync<dynamic>(
                    $@"SELECT p.pk_project_id AS projectId, p.fk_year_id AS yearId,
                              p.fk_club_id AS clubId, p.title, p.project_date AS projectDate,
                              COALESCE(md.ModuleName,'') AS avenue,
                              COALESCE(aof.name,'') AS areaOfFocus,
                              COALESCE(p.project_cost, 0) AS cost,
                              COALESCE(p.Currency, '{RotaryApi.Services.Brand.SqlCurrency}') AS currency,
                              COALESCE(p.direct_beneficiaries, 0) AS beneficiaries,
                              (COALESCE(p.rotarians_involved,0) + COALESCE(p.rotaractors_involved,0)) AS rotarians,
                              COALESCE(p.man_hours, 0) AS manHours,
                              COALESCE(f.name,'Self Funded') AS funding
                       FROM `{t.ProjectsTable}` p
                       LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
                       LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
                       LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
                       {ProjectAvenueOnly}
                       WHERE p.fk_club_id IN @ClubIds AND p.isdeleted = 0
                       ORDER BY p.project_date DESC",
                    new { ClubIds = clubIds });
                tableHasManHours = true;
                anyManHoursColumn = true;
            }
            catch
            {
                // man_hours column missing on this year's table — fall back.
                rows = await conn.QueryAsync<dynamic>(
                    $@"SELECT p.pk_project_id AS projectId, p.fk_year_id AS yearId,
                              p.fk_club_id AS clubId, p.title, p.project_date AS projectDate,
                              COALESCE(md.ModuleName,'') AS avenue,
                              COALESCE(aof.name,'') AS areaOfFocus,
                              COALESCE(p.project_cost, 0) AS cost,
                              COALESCE(p.Currency, '{RotaryApi.Services.Brand.SqlCurrency}') AS currency,
                              COALESCE(p.direct_beneficiaries, 0) AS beneficiaries,
                              (COALESCE(p.rotarians_involved,0) + COALESCE(p.rotaractors_involved,0)) AS rotarians,
                              0 AS manHours,
                              COALESCE(f.name,'Self Funded') AS funding
                       FROM `{t.ProjectsTable}` p
                       LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
                       LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
                       LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
                       {ProjectAvenueOnly}
                       WHERE p.fk_club_id IN @ClubIds AND p.isdeleted = 0
                       ORDER BY p.project_date DESC",
                    new { ClubIds = clubIds });
            }
            foreach (var r in rows)
            {
                int cid = (int)r.clubId;
                DateTime? d = r.projectDate is DateTime dd ? dd : (DateTime?)null;
                projects.Add(new AgProjectRowDto
                {
                    ProjectId = r.projectId is int pid ? pid : (r.projectId is long pl ? (int)pl : 0),
                    YearId = r.yearId is int yid ? yid : (r.yearId is long yl ? (int)yl : 0),
                    ClubId = cid,
                    ClubName = clubMeta.GetValueOrDefault(cid, ""),
                    Title = (r.title as string) ?? "",
                    Avenue = r.avenue as string,
                    AreaOfFocus = r.areaOfFocus as string,
                    Date = d?.ToString("yyyy-MM-dd"),
                    Cost = r.cost is decimal cc ? cc : 0,
                    Currency = CurrencyHelper.Normalize(r.currency as string),
                    Beneficiaries = r.beneficiaries is long b1 ? (int)b1 : (r.beneficiaries is int b2 ? b2 : 0),
                    Funding = (r.funding as string) ?? "Self Funded",
                    Rotarians = r.rotarians is long ro1 ? (int)ro1 : (r.rotarians is int ro2 ? ro2 : 0),
                    ManHours = r.manHours is long mh1 ? (int)mh1 : (r.manHours is int mh2 ? mh2 : 0),
                    ManHoursIsPending = !tableHasManHours,
                });
            }
        }

        var targetCurrency = await ResolveDistrictTargetCurrencyAsync(conn, clubIds.Count > 0 ? clubIds[0] : 0);
        var fxRates = await _fx.GetInrRatesAsync();

        var clubCounts = projects.GroupBy(p => p.ClubName).ToDictionary(g => g.Key, g => g.Count());
        var monthlyCounts = projects
            .Where(p => p.Date != null)
            .GroupBy(p => $"{p.Date!.Substring(5, 2)}-{p.Date!.Substring(0, 4)}")
            .ToDictionary(g => g.Key, g => g.Count());

        return new AgProjectsResponse
        {
            Ag = identity,
            Projects = projects,
            ClubProjectCounts = clubCounts,
            MonthlyProjectCounts = monthlyCounts,
            TotalProjects = projects.Count,
            TotalBeneficiaries = projects.Sum(p => p.Beneficiaries),
            // Wave 12A: TotalManHours sums real values when the column exists;
            // 0 when no year table has the column yet.
            TotalManHours = anyManHoursColumn ? projects.Sum(p => p.ManHours) : 0,
            TotalCost = projects.Sum(p => CurrencyHelper.Convert(p.Cost, p.Currency, targetCurrency, fxRates)),
            TargetCurrency = targetCurrency,
        };
    }

    // ─── 8. GetDistrict (comparison view) ───────────────────────────────

    public async Task<AgDistrictResponse> GetDistrictAsync(int memberId, int? yearId, int? requestedClubId = null, int? requestedDistrictId = null)
    {
        var membership = await GetMembershipAsync(memberId, yearId, requestedClubId, requestedDistrictId);
        var youth = await GetYouthAsync(memberId, yearId, requestedClubId, requestedDistrictId);

        var youthByClub = youth.Clubs.ToDictionary(c => c.ClubId);
        var rows = membership.Clubs.Select(c => new AgDistrictClubRowDto
        {
            ClubId = c.ClubId,
            ClubName = c.ClubName,
            Members = c.Members,
            ClubService = c.ClubService,
            TotalProjects = c.TotalProjects,
            TrfTotalInr = c.Trf,
            Ocv = c.Ocv,
            ProjectRank = c.ProjectRank,
            VocationalService = youthByClub.TryGetValue(c.ClubId, out var y) ? y.VocationalService : 0,
            InternationalService = youthByClub.TryGetValue(c.ClubId, out var y2) ? y2.InternationalService : 0,
            NewGenerationService = youthByClub.TryGetValue(c.ClubId, out var y3) ? y3.NewGenerationService : 0,
        }).ToList();

        // Wave 12A: extra derived structures for the District View screen.
        // Citation totals per club for the DCK column + radar goals axis.
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var resolvedYearId = await ResolveYearIdAsync(conn, yearId);
        var clubIds = rows.Select(r => r.ClubId).ToList();
        // Club Service filed by each club (user 2026-09-24) - what the District view shows in place
        // of the old attendance-based "Meetings". Club Service now arrives on the membership row, so
        // only the legacy Meetings figure still needs its own attendance lookup here.
        var meetingCounts = await GetMeetingCountsAsync(conn, clubIds, resolvedYearId);
        foreach (var row in rows) row.Meetings = meetingCounts.GetValueOrDefault(row.ClubId, 0);
        var citationTotalsMap = new Dictionary<int, decimal>();
        if (clubIds.Count > 0)
        {
            try
            {
                var ctRows = await conn.QueryAsync<(int clubId, decimal pts)>(@"
                    SELECT fk_club_id, COALESCE(SUM(points_earned),0) + COALESCE(SUM(bonus_earned),0) AS pts
                    FROM district_citation_club_entry
                    WHERE fk_club_id IN @ClubIds AND isdeleted = 0
                      AND (@YearId = 0 OR fk_year_id = @YearId)
                    GROUP BY fk_club_id",
                    new { ClubIds = clubIds, YearId = resolvedYearId });
                citationTotalsMap = ctRows.ToDictionary(r => r.clubId, r => r.pts);
            }
            catch
            {
                // Citation table unavailable — DCK stays 0.
            }
        }

        // Award status (Wave 13A3 table) — used as fallback signal for the
        // radar "goals" axis if citation data is missing.
        var clubNameMap = rows.ToDictionary(r => r.ClubId, r => r.ClubName);
        var (awardMap, _) = await GetAwardStatusAsync(conn, clubIds, resolvedYearId, clubNameMap);

        // Head-to-Head table — one row per AG club with the full metric set.
        var headToHeadTable = rows.Select(r => new AgHeadToHeadRowDto
        {
            ClubId = r.ClubId,
            ClubName = r.ClubName,
            Members = r.Members,
            Meetings = r.Meetings,
            ClubService = r.ClubService,
            TotalProjects = r.TotalProjects,
            TrfInr = r.TrfTotalInr,
            Dck = citationTotalsMap.GetValueOrDefault(r.ClubId, 0m),
            NationalRank = null,
            NationalRankIsPending = true,
            VocationalService = r.VocationalService,
            InternationalService = r.InternationalService,
            NewGenerationService = r.NewGenerationService,
        }).ToList();

        // Metric bars — four series of clubName -> value for the bar charts.
        var metricBars = new AgMetricBarsDto
        {
            MembersPerClub = rows.ToDictionary(r => r.ClubName, r => r.Members),
            ProjectsPerClub = rows.ToDictionary(r => r.ClubName, r => r.TotalProjects),
            TrfPerClub = rows.ToDictionary(r => r.ClubName, r => r.TrfTotalInr),
            MeetingsPerClub = rows.ToDictionary(r => r.ClubName, r => (int)r.Meetings),
            ClubServicePerClub = rows.ToDictionary(r => r.ClubName, r => r.ClubService),
        };

        // Radar — 4 axes per club (members, projects, trf, goals). The goals axis
        // uses citation total when available; otherwise count of achieved awards
        // from club_award_status as a fallback.
        var radar = rows.Select(r =>
        {
            decimal goalsScore = citationTotalsMap.GetValueOrDefault(r.ClubId, 0m);
            if (goalsScore == 0m && awardMap.TryGetValue(r.ClubId, out var aw) && !aw.IsPending)
            {
                // Each achieved status contributes 1 to the score.
                int achievedCount = 0;
                if (aw.Achieved) achievedCount++;
                if (string.Equals(aw.PresidentialCitation, "achieved", StringComparison.OrdinalIgnoreCase)) achievedCount++;
                if (string.Equals(aw.DistrictCitation, "achieved", StringComparison.OrdinalIgnoreCase)) achievedCount++;
                if (string.Equals(aw.MembershipExcellence, "achieved", StringComparison.OrdinalIgnoreCase)) achievedCount++;
                goalsScore = achievedCount;
            }
            return new AgRadarPointDto
            {
                ClubId = r.ClubId,
                ClubName = r.ClubName,
                Members = r.Members,
                Projects = r.TotalProjects,
                TrfInr = r.TrfTotalInr,
                GoalsScore = goalsScore,
            };
        }).ToList();

        return new AgDistrictResponse
        {
            Ag = membership.Ag,
            Clubs = rows,
            TotalMembers = membership.TotalMembers,
            TotalMeetings = rows.Sum(r => r.Meetings),
            TotalClubService = rows.Sum(r => r.ClubService),
            TotalProjects = membership.TotalProjects,
            TotalTrfInr = membership.TotalTrfInr,
            HeadToHeadTable = headToHeadTable,
            MetricBars = metricBars,
            Radar = radar,
        };
    }
}
