using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;
using System.Security.Claims;

namespace RotaryApi.Controllers;

// AG (Assistant Governor) reports — same shape as SuperAdmin reports BUT every query is scoped
// to clubs assigned to the logged-in AG (district_ag.fk_member_id = current member).
// Used by both web (Excel export) and mobile (list views) — same JWT auth.
[ApiController]
[Route("api/ag/reports")]
[Authorize]
public class AgReportsController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IYearTableResolver _yearTables;

    public AgReportsController(IConfiguration config, IYearTableResolver yearTables)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _yearTables = yearTables;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);
    private bool IsAG() => User.FindFirst("roles")?.Value?.Contains("AG") == true;
    private int GetUserId()
    {
        var id = User.FindFirst("memberId")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(id, out var x) ? x : 0;
    }

    // Load club ids the logged-in AG is assigned to. When yearFilter is supplied,
    // restrict to clubs assigned in that rotary year — so a member who is AG only
    // in 2025-26 can't see 2024-25 data, and vice versa.
    private async Task<List<int>> GetMyClubIdsAsync(MySqlConnection conn, int? clubFilter = null, int? yearFilter = null)
    {
        var memberId = GetUserId();
        if (memberId == 0) return new List<int>();
        var rows = await conn.QueryAsync<int>(@"
            SELECT fk_club_id
            FROM district_ag
            WHERE fk_member_id = @MemberId AND isdeleted = 0 AND is_active = 1
              AND (@YearId IS NULL OR fk_year_id = @YearId)",
            new { MemberId = memberId, YearId = yearFilter });
        var ids = rows.Distinct().ToList();
        if (clubFilter.HasValue) ids = ids.Where(x => x == clubFilter.Value).ToList();
        return ids;
    }

    private async Task<(MySqlConnection conn, List<int> clubIds, ActionResult? guard)> StartAsync(int? clubId, int? yearId = null)
    {
        if (!IsAG()) return (null!, new List<int>(), Forbid());
        var conn = CreateConnection();
        await conn.OpenAsync();
        var clubIds = await GetMyClubIdsAsync(conn, clubId, yearId);
        return (conn, clubIds, null);
    }

    // ── Meta ────────────────────────────────────────────────────────────────

    // "What clubs am I AG for?" — used by frontend club-filter dropdown.
    // When yearId is supplied, restrict to clubs assigned in that rotary year.
    [HttpGet("my-clubs")]
    public async Task<ActionResult> MyClubs([FromQuery] int? yearId = null)
    {
        if (!IsAG()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var memberId = GetUserId();
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                   d.DistrictNumber AS districtNumber
            FROM district_ag ag
            JOIN club_master c ON c.pk_club_id = ag.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE ag.fk_member_id = @MemberId AND ag.isdeleted = 0 AND ag.is_active = 1
              AND (@YearId IS NULL OR ag.fk_year_id = @YearId)
            ORDER BY c.ClubName",
            new { MemberId = memberId, YearId = yearId });
        return Ok(rows);
    }

    // "What rotary years am I AG in?" — used by frontend year-filter dropdown so
    // an AG only sees years they actually hold an assignment for. AG of 2024-25
    // only → one entry; AG of both 2024-25 and 2025-26 → two entries.
    [HttpGet("my-years")]
    public async Task<ActionResult> MyYears()
    {
        if (!IsAG()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var memberId = GetUserId();
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent,
                   y.StartDate AS startDate, y.EndDate AS endDate
            FROM district_ag ag
            JOIN rotary_year_master y ON y.pk_year_id = ag.fk_year_id
            WHERE ag.fk_member_id = @MemberId AND ag.isdeleted = 0 AND ag.is_active = 1
            ORDER BY y.IsCurrent DESC, y.pk_year_id DESC",
            new { MemberId = memberId });
        return Ok(rows);
    }

    // ── Club-level reports ──────────────────────────────────────────────────

    [HttpGet("clubs")]
    public async Task<ActionResult> Clubs([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        var (conn, clubIds, guard) = await StartAsync(clubId, yearId);
        if (guard != null) return guard;
        using (conn)
        {
            if (clubIds.Count == 0) return Ok(Array.Empty<object>());
            var rows = await conn.QueryAsync<dynamic>(@"
                SELECT c.pk_club_id AS clubId, c.ClubRotaryId AS clubRotaryId, c.ClubName AS clubName,
                       d.DistrictNumber AS districtNumber,
                       z.ZoneName AS zoneName,
                       c.MeetingDay AS meetingDay, c.MeetingFromTime AS meetingFromTime, c.MeetingToTime AS meetingToTime,
                       c.MeetingAddress AS meetingAddress,
                       c.City AS city, c.State AS state, c.Country AS country, c.Pincode AS pincode,
                       c.ClubWebsite AS clubWebsite,
                       c.ActiveFromDate AS activeFromDate, c.ActiveToDate AS activeToDate,
                       (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = c.pk_club_id AND cm.isdeleted = 0 AND cm.IsActive = 1 AND m.isdeleted = 0) AS totalMembers,
                       CASE WHEN c.IsActive = 1 THEN 'Yes' ELSE 'No' END AS isActive,
                       c.ClubCharterDate AS charterDate
                FROM club_master c
                LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
                LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                WHERE c.pk_club_id IN @ClubIds AND c.isdeleted = 0
                ORDER BY c.ClubName",
                new { ClubIds = clubIds });
            return Ok(rows);
        }
    }

    [HttpGet("club-members")]
    public async Task<ActionResult> ClubMembers([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        var (conn, clubIds, guard) = await StartAsync(clubId, yearId);
        if (guard != null) return guard;
        using (conn)
        {
            if (clubIds.Count == 0) return Ok(Array.Empty<object>());
            var rows = await conn.QueryAsync<dynamic>(@"
                SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                       m.RotaryId AS rotaryId, m.EmailId AS email,
                       m.PrimaryMobileNumber AS mobile, m.Gender AS gender,
                       m.BirthDate AS birthDate, m.AnniversaryDate AS anniversaryDate,
                       m.BloodGroup AS bloodGroup,
                       c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                       d.DistrictNumber AS districtNumber,
                       cm.JoinedDate AS joinedDate
                FROM club_members cm
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                WHERE c.pk_club_id IN @ClubIds AND cm.isdeleted = 0 AND cm.IsActive = 1
                ORDER BY c.ClubName, m.MemberName",
                new { ClubIds = clubIds });
            return Ok(rows);
        }
    }

    [HttpGet("club-leadership")]
    public async Task<ActionResult> ClubLeadership([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        var (conn, clubIds, guard) = await StartAsync(clubId, yearId);
        if (guard != null) return guard;
        using (conn)
        {
            if (clubIds.Count == 0) return Ok(Array.Empty<object>());
            var sql = @"
                SELECT bod.pk_board_director_id AS id,
                       c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                       d.DistrictNumber AS districtNumber,
                       y.YearLabel AS yearLabel,
                       dg.designation_name AS designation,
                       m.MemberName AS memberName,
                       m.PrimaryMobileNumber AS mobile, m.EmailId AS email
                FROM board_of_directors bod
                JOIN club_master c ON c.pk_club_id = bod.fk_club_id AND c.isdeleted = 0
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id
                JOIN designation_master dg ON dg.pk_designation_id = bod.fk_designation_id
                JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id
                WHERE c.pk_club_id IN @ClubIds AND bod.isdeleted = 0
                  AND bod.fk_designation_id IN (1, 4)";
            var p = new DynamicParameters();
            p.Add("ClubIds", clubIds);
            if (yearId.HasValue) { sql += " AND bod.fk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
            sql += " ORDER BY y.YearLabel DESC, c.ClubName, dg.sort_order";
            var rows = await conn.QueryAsync<dynamic>(sql, p);
            return Ok(rows);
        }
    }

    [HttpGet("board-of-directors")]
    public async Task<ActionResult> BoardOfDirectors([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        var (conn, clubIds, guard) = await StartAsync(clubId, yearId);
        if (guard != null) return guard;
        using (conn)
        {
            if (clubIds.Count == 0) return Ok(Array.Empty<object>());
            var sql = @"
                SELECT bod.pk_board_director_id AS id,
                       c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                       y.YearLabel AS yearLabel,
                       dg.designation_name AS designation,
                       m.MemberName AS memberName,
                       m.PrimaryMobileNumber AS mobile, m.EmailId AS email
                FROM board_of_directors bod
                JOIN club_master c ON c.pk_club_id = bod.fk_club_id AND c.isdeleted = 0
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id
                JOIN designation_master dg ON dg.pk_designation_id = bod.fk_designation_id
                JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id
                WHERE c.pk_club_id IN @ClubIds AND bod.isdeleted = 0";
            var p = new DynamicParameters();
            p.Add("ClubIds", clubIds);
            if (yearId.HasValue) { sql += " AND bod.fk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
            sql += " ORDER BY y.YearLabel DESC, c.ClubName, dg.sort_order";
            var rows = await conn.QueryAsync<dynamic>(sql, p);
            return Ok(rows);
        }
    }

    [HttpGet("club-websites")]
    public async Task<ActionResult> ClubWebsites([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        var (conn, clubIds, guard) = await StartAsync(clubId, yearId);
        if (guard != null) return guard;
        using (conn)
        {
            if (clubIds.Count == 0) return Ok(Array.Empty<object>());
            var rows = await conn.QueryAsync<dynamic>(@"
                SELECT c.pk_club_id AS clubId, c.ClubName AS clubName,
                       d.DistrictNumber AS districtNumber,
                       c.ClubWebsite AS clubWebsite
                FROM club_master c
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                WHERE c.pk_club_id IN @ClubIds AND c.isdeleted = 0
                ORDER BY c.ClubName",
                new { ClubIds = clubIds });
            return Ok(rows);
        }
    }

    [HttpGet("club-announcements")]
    public async Task<ActionResult> ClubAnnouncements([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        var (conn, clubIds, guard) = await StartAsync(clubId, yearId);
        if (guard != null) return guard;
        using (conn)
        {
            if (clubIds.Count == 0) return Ok(Array.Empty<object>());
            var sql = @"
                SELECT a.Title AS title, a.Description AS description,
                       CASE
                           WHEN a.ImagePath IS NULL OR a.ImagePath = '' THEN NULL
                           WHEN a.ImagePath LIKE '/%' THEN a.ImagePath
                           WHEN a.fk_district_id IS NOT NULL THEN CONCAT('/Documents/announcement/Group', a.fk_district_id, '/', a.ImagePath)
                           ELSE CONCAT('/Documents/announcement/Group', a.fk_club_id, '/', a.ImagePath)
                       END AS imagePath,
                       a.PublishDateTime AS publishedDate, a.ExpiryDateTime AS expiryDate,
                       c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                       y.YearLabel AS yearLabel
                FROM announcements a
                JOIN club_master c ON c.pk_club_id = a.fk_club_id AND c.isdeleted = 0
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                LEFT JOIN rotary_year_master y ON a.PublishDateTime >= y.StartDate AND a.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
                WHERE c.pk_club_id IN @ClubIds AND a.isdeleted = 0";
            var p = new DynamicParameters();
            p.Add("ClubIds", clubIds);
            if (yearId.HasValue) { sql += " AND y.pk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
            sql += " ORDER BY a.PublishDateTime DESC";
            var rows = await conn.QueryAsync<dynamic>(sql, p);
            return Ok(rows);
        }
    }

    [HttpGet("club-upcoming-events")]
    public async Task<ActionResult> ClubUpcomingEvents([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        var (conn, clubIds, guard) = await StartAsync(clubId, yearId);
        if (guard != null) return guard;
        using (conn)
        {
            if (clubIds.Count == 0) return Ok(Array.Empty<object>());
            var sql = @"
                SELECT e.Title AS title, e.Description AS description,
                       e.EventDate AS eventDate,
                       DATE_FORMAT(e.EventDate, '%H:%i') AS eventTime,
                       e.EventVenue AS location,
                       c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                       y.YearLabel AS yearLabel
                FROM upcoming_events e
                JOIN club_master c ON c.pk_club_id = e.fk_club_id AND c.isdeleted = 0
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                LEFT JOIN rotary_year_master y ON e.PublishDate >= y.StartDate AND e.PublishDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
                WHERE c.pk_club_id IN @ClubIds AND e.isdeleted = 0";
            var p = new DynamicParameters();
            p.Add("ClubIds", clubIds);
            if (yearId.HasValue) { sql += " AND y.pk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
            sql += " ORDER BY e.EventDate DESC";
            var rows = await conn.QueryAsync<dynamic>(sql, p);
            return Ok(rows);
        }
    }

    [HttpGet("club-attendance")]
    public async Task<ActionResult> ClubAttendance([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        var (conn, clubIds, guard) = await StartAsync(clubId, yearId);
        if (guard != null) return guard;
        using (conn)
        {
            if (clubIds.Count == 0) return Ok(Array.Empty<object>());
            var sql = @"
                SELECT a.EventDateTime AS meetingDate,
                       a.EventName AS meetingTopic,
                       (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = a.fk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0) AS totalMembers,
                       (SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) AS presentMembers,
                       c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                       y.YearLabel AS yearLabel
                FROM club_attendance a
                JOIN club_master c ON c.pk_club_id = a.fk_club_id AND c.isdeleted = 0
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                LEFT JOIN rotary_year_master y ON y.pk_year_id = a.fk_year_id
                WHERE c.pk_club_id IN @ClubIds AND a.isdeleted = 0";
            var p = new DynamicParameters();
            p.Add("ClubIds", clubIds);
            if (yearId.HasValue) { sql += " AND a.fk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
            sql += " ORDER BY a.EventDateTime DESC";
            var rows = await conn.QueryAsync<dynamic>(sql, p);
            return Ok(rows);
        }
    }

    [HttpGet("club-documents")]
    public async Task<ActionResult> ClubDocuments([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        var (conn, clubIds, guard) = await StartAsync(clubId, yearId);
        if (guard != null) return guard;
        using (conn)
        {
            if (clubIds.Count == 0) return Ok(Array.Empty<object>());
            var sql = @"
                SELECT doc.Title AS title,
                       doc.AccessType AS accessType,
                       CASE
                           WHEN doc.FilePath IS NULL OR doc.FilePath = '' THEN NULL
                           WHEN doc.FilePath LIKE '/%' THEN doc.FilePath
                           WHEN doc.fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', doc.fk_district_id, '/', doc.FilePath)
                           ELSE CONCAT('/Documents/documentsafe/Group', doc.fk_club_id, '/', doc.FilePath)
                       END AS documentUrl,
                       doc.PublishDateTime AS documentDate,
                       c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                       y.YearLabel AS yearLabel
                FROM club_documents doc
                JOIN club_master c ON c.pk_club_id = doc.fk_club_id AND c.isdeleted = 0
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                LEFT JOIN rotary_year_master y ON doc.PublishDateTime >= y.StartDate AND doc.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
                WHERE c.pk_club_id IN @ClubIds AND doc.isdeleted = 0";
            var p = new DynamicParameters();
            p.Add("ClubIds", clubIds);
            if (yearId.HasValue) { sql += " AND y.pk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
            sql += " ORDER BY doc.PublishDateTime DESC";
            var rows = await conn.QueryAsync<dynamic>(sql, p);
            return Ok(rows);
        }
    }

    [HttpGet("rotary-projects")]
    public async Task<ActionResult> RotaryProjects([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        var (conn, clubIds, guard) = await StartAsync(clubId, yearId);
        if (guard != null) return guard;
        using (conn)
        {
            if (clubIds.Count == 0) return Ok(Array.Empty<object>());
            // Year-wise tables: pick one when yearId is given, else UNION across all existing.
            var tables = yearId.HasValue
                ? new List<YearTableInfo> { (await _yearTables.ResolveByYearIdAsync(conn, yearId.Value)) }
                    .Where(t => t != null).Cast<YearTableInfo>().ToList()
                : await _yearTables.GetAllExistingYearTablesAsync(conn);
            if (tables.Count == 0) return Ok(Array.Empty<object>());

            var unionLegs = string.Join(" UNION ALL ", tables.Select(t =>
                $@"SELECT p.title AS title, p.description AS description,
                          p.location AS location, p.project_type AS projectType,
                          p.project_date AS startDate, NULL AS endDate,
                          p.direct_beneficiaries AS totalBeneficiaries,
                          (COALESCE(p.rotarians_involved,0) + COALESCE(p.rotaractors_involved,0)) AS totalVolunteers,
                          p.project_cost AS totalCost,
                          c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                          '{t.YearLabel}' AS yearLabel,
                          md.ModuleName AS moduleName
                   FROM `{t.ProjectsTable}` p
                   JOIN club_master c ON c.pk_club_id = p.fk_club_id AND c.isdeleted = 0
                   JOIN district_master d ON d.pk_district_id = c.fk_district_id
                   LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
                   WHERE c.pk_club_id IN @ClubIds AND p.isdeleted = 0"));
            var rows = await conn.QueryAsync<dynamic>(
                $"SELECT * FROM ({unionLegs}) u ORDER BY u.startDate DESC",
                new { ClubIds = clubIds });
            return Ok(rows);
        }
    }

    [HttpGet("trf-contributions")]
    public async Task<ActionResult> TrfContributions([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        var (conn, clubIds, guard) = await StartAsync(clubId, yearId);
        if (guard != null) return guard;
        using (conn)
        {
            if (clubIds.Count == 0) return Ok(Array.Empty<object>());
            var sql = @"
                SELECT t.TrfDate AS contributionDate,
                       t.AmountUSD AS amount,
                       t.FundType AS recognition,
                       t.OtherFundName AS remarks,
                       COALESCE(f.FundName, t.OtherFundName) AS fundName,
                       t.DonorName AS memberName,
                       c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                       y.YearLabel AS yearLabel
                FROM trf_contributions t
                JOIN club_master c ON c.pk_club_id = t.fk_club_id AND c.isdeleted = 0
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                LEFT JOIN rotary_year_master y ON y.pk_year_id = t.fk_year_id
                LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
                WHERE c.pk_club_id IN @ClubIds AND t.isdeleted = 0";
            var p = new DynamicParameters();
            p.Add("ClubIds", clubIds);
            if (yearId.HasValue) { sql += " AND t.fk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
            sql += " ORDER BY t.TrfDate DESC";
            var rows = await conn.QueryAsync<dynamic>(sql, p);
            return Ok(rows);
        }
    }

    [HttpGet("newsletters")]
    public async Task<ActionResult> Newsletters([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        var (conn, clubIds, guard) = await StartAsync(clubId, yearId);
        if (guard != null) return guard;
        using (conn)
        {
            if (clubIds.Count == 0) return Ok(Array.Empty<object>());
            var sql = @"
                SELECT n.Title AS title, n.PublishDateTime AS publishedDate,
                       c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                       y.YearLabel AS yearLabel
                FROM newsletters n
                JOIN club_master c ON c.pk_club_id = n.fk_club_id AND c.isdeleted = 0
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                LEFT JOIN rotary_year_master y ON n.PublishDateTime >= y.StartDate AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
                WHERE c.pk_club_id IN @ClubIds AND n.isdeleted = 0";
            var p = new DynamicParameters();
            p.Add("ClubIds", clubIds);
            if (yearId.HasValue) { sql += " AND y.pk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
            sql += " ORDER BY n.PublishDateTime DESC";
            var rows = await conn.QueryAsync<dynamic>(sql, p);
            return Ok(rows);
        }
    }

    [HttpGet("club-monthly-reports")]
    public async Task<ActionResult> ClubMonthlyReports([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        var (conn, clubIds, guard) = await StartAsync(clubId, yearId);
        if (guard != null) return guard;
        using (conn)
        {
            if (clubIds.Count == 0) return Ok(Array.Empty<object>());
            var sql = @"
                SELECT r.ReportMonth AS reportMonth,
                       CASE WHEN r.IsUploadedToDistrict = 1 THEN 'Yes' ELSE 'No' END AS isSubmitted,
                       COALESCE(r.uploaded_to_district_date, r.created_date) AS submittedDate,
                       c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                       y.YearLabel AS yearLabel
                FROM club_monthly_reports r
                JOIN club_master c ON c.pk_club_id = r.fk_club_id AND c.isdeleted = 0
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                LEFT JOIN rotary_year_master y ON y.pk_year_id = r.fk_year_id
                WHERE c.pk_club_id IN @ClubIds AND r.isdeleted = 0";
            var p = new DynamicParameters();
            p.Add("ClubIds", clubIds);
            if (yearId.HasValue) { sql += " AND r.fk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
            sql += " ORDER BY r.ReportMonth DESC";
            var rows = await conn.QueryAsync<dynamic>(sql, p);
            return Ok(rows);
        }
    }

    // ── Member-detail reports ───────────────────────────────────────────────

    [HttpGet("members-full-details")]
    public async Task<ActionResult> MembersFullDetails([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        var (conn, clubIds, guard) = await StartAsync(clubId, yearId);
        if (guard != null) return guard;
        using (conn)
        {
            if (clubIds.Count == 0) return Ok(Array.Empty<object>());
            var rows = await conn.QueryAsync<dynamic>(@"
                SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                       m.RotaryId AS rotaryId, m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
                       m.SecondaryMobileNumber AS secondaryMobile,
                       m.Gender AS gender, m.BirthDate AS birthDate, m.AnniversaryDate AS anniversaryDate,
                       m.BloodGroup AS bloodGroup, m.PrimaryLanguage AS primaryLanguage,
                       m.MemberIntroduction AS introduction,
                       m.Facebook AS facebook, m.Instagram AS instagram, m.LinkedIn AS linkedIn,
                       m.Twitter AS twitter, m.Youtube AS youtube, m.Website AS website,
                       m.DonorRecognition AS donorRecognition,
                       c.ClubName AS clubName, d.DistrictNumber AS districtNumber
                FROM club_members cm
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                WHERE c.pk_club_id IN @ClubIds AND cm.isdeleted = 0 AND cm.IsActive = 1
                ORDER BY c.ClubName, m.MemberName",
                new { ClubIds = clubIds });
            return Ok(rows);
        }
    }

    [HttpGet("members-contact-summary")]
    public async Task<ActionResult> MembersContactSummary([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        var (conn, clubIds, guard) = await StartAsync(clubId, yearId);
        if (guard != null) return guard;
        using (conn)
        {
            if (clubIds.Count == 0) return Ok(Array.Empty<object>());
            var rows = await conn.QueryAsync<dynamic>(@"
                SELECT m.MemberName AS memberName,
                       m.PrimaryMobileNumber AS primaryMobile,
                       m.SecondaryMobileNumber AS secondaryMobile,
                       m.EmailId AS email,
                       c.ClubName AS clubName, d.DistrictNumber AS districtNumber
                FROM club_members cm
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                WHERE c.pk_club_id IN @ClubIds AND cm.isdeleted = 0 AND cm.IsActive = 1
                ORDER BY c.ClubName, m.MemberName",
                new { ClubIds = clubIds });
            return Ok(rows);
        }
    }

    [HttpGet("members-addresses")]
    public async Task<ActionResult> MembersAddresses([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        var (conn, clubIds, guard) = await StartAsync(clubId, yearId);
        if (guard != null) return guard;
        using (conn)
        {
            if (clubIds.Count == 0) return Ok(Array.Empty<object>());
            var rows = await conn.QueryAsync<dynamic>(@"
                SELECT m.MemberName AS memberName,
                       a.AddressType AS addressType,
                       a.Address AS address, a.City AS city, a.State AS state, a.PinCode AS pinCode,
                       a.PhoneNumber AS phoneNumber,
                       a.BusinessName AS businessName,
                       cm.Designation AS designation,
                       cm.ClassificationProfession AS classification,
                       a.Keywords AS keywords,
                       c.ClubName AS clubName, d.DistrictNumber AS districtNumber
                FROM club_members cm
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                LEFT JOIN member_address_details a ON a.fk_member_master_profile_id = m.pk_member_master_profile_id AND a.isdeleted = 0
                WHERE c.pk_club_id IN @ClubIds AND cm.isdeleted = 0 AND cm.IsActive = 1
                ORDER BY c.ClubName, m.MemberName, a.AddressType",
                new { ClubIds = clubIds });
            return Ok(rows);
        }
    }

    [HttpGet("mobile-app-users")]
    public async Task<ActionResult> MobileAppUsers([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        var (conn, clubIds, guard) = await StartAsync(clubId, yearId);
        if (guard != null) return guard;
        using (conn)
        {
            if (clubIds.Count == 0) return Ok(Array.Empty<object>());
            var rows = await conn.QueryAsync<dynamic>(@"
                SELECT m.MemberName AS memberName,
                       m.PrimaryMobileNumber AS mobile, m.EmailId AS email,
                       m.LastDeviceName AS lastDeviceName,
                       m.MobileLoginCount AS loginCount,
                       m.FirstMobileVisit AS firstVisit,
                       m.LastMobileVisit AS lastLogin,
                       m.LastMobileLogout AS lastLogout,
                       c.ClubName AS clubName, d.DistrictNumber AS districtNumber
                FROM club_members cm
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                WHERE c.pk_club_id IN @ClubIds AND cm.isdeleted = 0 AND cm.IsActive = 1
                  AND COALESCE(m.MobileLoginCount, 0) > 0
                ORDER BY m.LastMobileVisit DESC",
                new { ClubIds = clubIds });
            return Ok(rows);
        }
    }

    [HttpGet("potential-members")]
    public async Task<ActionResult> PotentialMembers([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        var (conn, clubIds, guard) = await StartAsync(clubId, yearId);
        if (guard != null) return guard;
        using (conn)
        {
            if (clubIds.Count == 0) return Ok(Array.Empty<object>());
            var rows = await conn.QueryAsync<dynamic>(@"
                SELECT pm.name AS memberName,
                       pm.mobile_number AS mobile, pm.email AS email,
                       NULL AS classification,
                       pm.reference_details AS referredBy,
                       NULL AS status,
                       pm.created_date AS addedOn,
                       c.ClubName AS clubName, d.DistrictNumber AS districtNumber
                FROM potential_members pm
                JOIN club_master c ON c.pk_club_id = pm.fk_club_id AND c.isdeleted = 0
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                WHERE c.pk_club_id IN @ClubIds AND pm.isdeleted = 0
                ORDER BY pm.created_date DESC",
                new { ClubIds = clubIds });
            return Ok(rows);
        }
    }

    [HttpGet("family-details")]
    public async Task<ActionResult> FamilyDetails([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        var (conn, clubIds, guard) = await StartAsync(clubId, yearId);
        if (guard != null) return guard;
        using (conn)
        {
            if (clubIds.Count == 0) return Ok(Array.Empty<object>());
            var rows = await conn.QueryAsync<dynamic>(@"
                SELECT c.ClubName AS clubName,
                       d.DistrictNumber AS districtNumber,
                       m.MemberName AS rotarianName,
                       f.Name AS familyMemberName,
                       f.Relation AS relation,
                       f.PhoneNumber AS mobile,
                       f.EmailId AS email,
                       f.BloodGroup AS bloodGroup,
                       f.BirthDate AS birthDate,
                       f.AnniversaryDate AS anniversaryDate
                FROM member_family_details f
                JOIN member_master_profile m ON m.pk_member_master_profile_id = f.fk_member_master_profile_id AND m.isdeleted = 0
                JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.isdeleted = 0 AND cm.IsActive = 1
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                WHERE c.pk_club_id IN @ClubIds AND f.isdeleted = 0
                ORDER BY c.ClubName, m.MemberName, f.Name",
                new { ClubIds = clubIds });
            return Ok(RotaryApi.Services.Brand.Feature("member.familyDetails") ? rows : Enumerable.Empty<dynamic>());  // ROW: off by default
        }
    }
}
