using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/clubs/{clubId}/live-documents")]
[Authorize]
public class LiveDocumentsExportController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IYearTableResolver _yearTables;

    public LiveDocumentsExportController(IConfiguration config, IYearTableResolver yearTables)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _yearTables = yearTables;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    [HttpGet("export")]
    public async Task<ActionResult> Export(int clubId, [FromQuery] int yearId, [FromQuery] string module)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        if (yearId <= 0 || string.IsNullOrWhiteSpace(module))
            return BadRequest(new { message = "yearId and module are required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        object? data = module.ToLowerInvariant() switch
        {
            // ── OCV/GOV Document categories ──
            "static_documents" or "financial_documents" or "trust_documents" or "grants" or "additional_documents" or "dues"
                => await GetOcvDocumentsAsync(conn, clubId, yearId, module),

            // ── Club Modules ──
            "projects" or "community_service" => await GetProjectsAsync(conn, clubId, yearId, null),
            "vocational_service" => await GetProjectsAsync(conn, clubId, yearId, "vocational-service"),
            "international_service" => await GetProjectsAsync(conn, clubId, yearId, "international-service"),
            "new_generation_service" => await GetProjectsAsync(conn, clubId, yearId, "new-generation-service"),
            "public_image_initiative" => await GetProjectsAsync(conn, clubId, yearId, "public-image-initiative"),
            "club_service" => await GetProjectsAsync(conn, clubId, yearId, "club-service"),
            "announcements" => await GetAnnouncementsAsync(conn, clubId, yearId),
            "upcoming_events" => await GetUpcomingEventsAsync(conn, clubId, yearId),
            "newsletters" => await GetNewslettersAsync(conn, clubId, yearId),
            "documents" => await GetClubDocumentsAsync(conn, clubId, yearId),
            "attendance" => await GetAttendanceAsync(conn, clubId, yearId),
            "board_of_directors" => await GetBodAsync(conn, clubId, yearId),
            "members" => await GetMembersAsync(conn, clubId),
            "trf_contributions" => await GetTrfAsync(conn, clubId, yearId),
            _ => null
        };

        if (data == null) return BadRequest(new { message = $"Unknown module: {module}" });
        return Ok(data);
    }

    private async Task<object> GetOcvDocumentsAsync(MySqlConnection conn, int clubId, int yearId, string categoryCode)
    {
        return await conn.QueryAsync<dynamic>(@"
            SELECT dt.TypeName AS documentType, d.OriginalFileName AS fileName,
                   d.FileSize AS fileSize, d.Amount AS amount, d.PaidOn AS paidOn,
                   d.CustomTypeName AS customType, d.created_date AS uploadDate
            FROM ocv_documents d
            JOIN ocv_document_category c ON c.pk_category_id = d.fk_category_id
            JOIN ocv_document_type dt ON dt.pk_type_id = d.fk_type_id
            WHERE d.fk_club_id = @ClubId AND d.fk_year_id = @YearId AND d.isdeleted = 0
              AND c.CategoryCode = @Code
            ORDER BY dt.SortOrder, d.created_date",
            new { ClubId = clubId, YearId = yearId, Code = categoryCode });
    }

    private async Task<object> GetProjectsAsync(MySqlConnection conn, int clubId, int yearId, string? moduleKey)
    {
        // Year-wise: resolve to the single year-wise projects table.
        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId);
        if (info is null) return Array.Empty<object>();

        var moduleFilter = "";
        if (!string.IsNullOrEmpty(moduleKey))
            moduleFilter = "AND mm.ModuleKey = @ModuleKey";

        return await conn.QueryAsync<dynamic>($@"
            SELECT p.title, p.description, p.location, p.project_date AS projectDate,
                   p.project_cost AS projectCost, p.direct_beneficiaries AS directBeneficiaries,
                   p.man_hours AS manHours, p.rotarians_involved AS rotariansInvolved,
                   p.rotaractors_involved AS rotaractorsInvolved,
                   COALESCE(p.rcc_involved,0) AS rccInvolved,
                   af.name AS areaOfFocus,
                   f.name AS funding,
                   mm.ModuleName AS moduleName, p.created_date AS createdDate
            FROM `{info.ProjectsTable}` p
            LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
            LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
            LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
            WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0
              {moduleFilter}
            ORDER BY p.project_date DESC",
            new { ClubId = clubId, ModuleKey = moduleKey ?? "" });
    }

    private async Task<object> GetAnnouncementsAsync(MySqlConnection conn, int clubId, int yearId)
    {
        return await conn.QueryAsync<dynamic>(@"
            SELECT a.Title AS title, a.Description AS description, a.PublishDateTime AS publishDate,
                   a.ExpiryDateTime AS expiryDate, a.IsDisplayOnBanner AS isDisplayOnBanner,
                   a.created_date AS createdDate,
                   CASE WHEN NOW() < a.PublishDateTime THEN 'Unpublished'
                        WHEN NOW() > a.ExpiryDateTime THEN 'Expired' ELSE 'Published' END AS status
            FROM announcements a
            JOIN rotary_year_master y ON y.pk_year_id = @YearId
            WHERE a.fk_club_id = @ClubId AND a.isdeleted = 0
              AND a.PublishDateTime >= y.StartDate
              AND a.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
            ORDER BY a.PublishDateTime DESC",
            new { ClubId = clubId, YearId = yearId });
    }

    // Published + not expired only — same predicate the public club website uses
    // (OcvLiveVisibility), so this export agrees with the OCV Word report.
    private async Task<object> GetUpcomingEventsAsync(MySqlConnection conn, int clubId, int yearId)
    {
        return await conn.QueryAsync<dynamic>($@"
            SELECT e.Title AS title, e.Description AS description, e.EventDate AS eventDate,
                   e.EventVenue AS eventVenue, e.PublishDate AS publishDate, e.ExpiryDate AS expiryDate,
                   e.RegistrationLink AS registrationLink,
                   e.created_date AS createdDate,
                   CASE WHEN NOW() < e.PublishDate THEN 'Unpublished'
                        WHEN NOW() > e.ExpiryDate THEN 'Expired' ELSE 'Published' END AS status
            FROM upcoming_events e
            JOIN rotary_year_master y ON y.pk_year_id = @YearId
            WHERE e.fk_club_id = @ClubId AND e.isdeleted = 0
              AND {OcvLiveVisibility.UpcomingEvents("e")}
              AND e.PublishDate >= y.StartDate
              AND e.PublishDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
            ORDER BY e.EventDate DESC",
            new { ClubId = clubId, YearId = yearId });
    }

    // Published + not expired only — see OcvLiveVisibility.Newsletters for the
    // "expiry == publish means never expires" legacy rule.
    private async Task<object> GetNewslettersAsync(MySqlConnection conn, int clubId, int yearId)
    {
        return await conn.QueryAsync<dynamic>($@"
            SELECT n.Title AS title, n.PublishDateTime AS publishDate, n.ExpiryDateTime AS expiryDate,
                   n.AttachmentType AS attachmentType, n.LinkUrl AS linkUrl,
                   CASE
                       WHEN n.FilePath IS NULL OR n.FilePath = '' THEN NULL
                       WHEN n.FilePath LIKE '/%' THEN n.FilePath
                       WHEN n.fk_district_id IS NOT NULL AND n.fk_district_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_district_id, '/', n.FilePath)
                       WHEN n.fk_club_id IS NOT NULL AND n.fk_club_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_club_id, '/', n.FilePath)
                       ELSE NULL
                   END AS filePath,
                   n.created_date AS createdDate,
                   CASE WHEN NOW() < n.PublishDateTime THEN 'Unpublished'
                        WHEN NOW() > n.ExpiryDateTime THEN 'Expired' ELSE 'Published' END AS status
            FROM newsletters n
            JOIN rotary_year_master y ON y.pk_year_id = @YearId
            WHERE n.fk_club_id = @ClubId AND n.isdeleted = 0
              AND {OcvLiveVisibility.Newsletters("n")}
              AND n.PublishDateTime >= y.StartDate
              AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
            ORDER BY n.PublishDateTime DESC",
            new { ClubId = clubId, YearId = yearId });
    }

    private async Task<object> GetClubDocumentsAsync(MySqlConnection conn, int clubId, int yearId)
    {
        // Alias the table — both club_documents AND rotary_year_master have a
        // created_date audit column, so unqualified references in SELECT/ORDER BY
        // raise "Column 'created_date' in field list is ambiguous". Same applies
        // to the other column refs (FilePath, Scope, fk_*) for safety.
        // Published + not expired only — same predicate as OcvLiveVisibility.
        return await conn.QueryAsync<dynamic>($@"
            SELECT cd.Title AS title, cd.AccessType AS accessType,
                   CASE
                       WHEN cd.FilePath IS NULL OR cd.FilePath = '' THEN NULL
                       WHEN cd.FilePath LIKE '/%' THEN cd.FilePath
                       WHEN cd.fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', cd.fk_district_id, '/', cd.FilePath)
                       ELSE CONCAT('/Documents/documentsafe/Group', cd.fk_club_id, '/', cd.FilePath)
                   END AS filePath,
                   cd.PublishDateTime AS publishDate, cd.ExpiryDateTime AS expiryDate, cd.created_date AS createdDate
            FROM club_documents cd
            JOIN rotary_year_master y ON y.pk_year_id = @YearId
            WHERE cd.fk_club_id = @ClubId AND cd.isdeleted = 0
              AND {OcvLiveVisibility.ClubDocuments("cd")}
              AND cd.PublishDateTime >= y.StartDate
              AND cd.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
            ORDER BY cd.PublishDateTime DESC",
            new { ClubId = clubId, YearId = yearId });
    }

    private async Task<object> GetAttendanceAsync(MySqlConnection conn, int clubId, int yearId)
    {
        var total = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_members WHERE fk_club_id = @C AND IsActive = 1 AND isdeleted = 0",
            new { C = clubId });
        return await conn.QueryAsync<dynamic>(@"
            SELECT a.EventName AS eventName, a.EventDateTime AS eventDateTime,
                   (SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) AS membersPresent,
                   (SELECT COUNT(*) FROM club_attendance_visitors v WHERE v.fk_attendance_id = a.pk_attendance_id) AS visitors,
                   (SELECT COUNT(*) FROM club_attendance_rotarians r WHERE r.fk_attendance_id = a.pk_attendance_id) AS rotarians,
                   @Total AS totalMembers,
                   ROUND((SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) * 100.0 / NULLIF(@Total, 0), 1) AS attendancePercent,
                   a.created_date AS createdDate
            FROM club_attendance a
            WHERE a.fk_club_id = @ClubId AND a.fk_year_id = @YearId AND a.isdeleted = 0
            ORDER BY a.EventDateTime DESC",
            new { ClubId = clubId, YearId = yearId, Total = total });
    }

    private async Task<object> GetBodAsync(MySqlConnection conn, int clubId, int yearId)
    {
        return await conn.QueryAsync<dynamic>(@"
            SELECT m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email,
                   dm.designation_name AS designation, dm.sort_order AS sortOrder
            FROM board_of_directors b
            JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
            JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
            WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId AND b.isdeleted = 0
            ORDER BY dm.sort_order",
            new { ClubId = clubId, YearId = yearId });
    }

    private async Task<object> GetMembersAsync(MySqlConnection conn, int clubId)
    {
        return await conn.QueryAsync<dynamic>(@"
            SELECT m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email,
                   m.RotaryId AS rotaryId, m.Gender AS gender, m.BirthDate AS birthDate,
                   m.AnniversaryDate AS anniversaryDate, m.BloodGroup AS bloodGroup,
                   " + CogDesignationHelper.JoinedDateExpr("cm") + @" AS joinedDate, cm.IsActive AS isActive,
                   " + CogDesignationHelper.SelectColumns("cm") + @"
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id = @ClubId AND cm.isdeleted = 0
            ORDER BY m.MemberName",
            new { ClubId = clubId });
    }

    private async Task<object> GetTrfAsync(MySqlConnection conn, int clubId, int yearId)
    {
        return await conn.QueryAsync<dynamic>(@"
            SELECT t.TrfDate AS trfDate, t.DonorName AS donorName, t.AmountUSD AS amountUsd,
                   t.FundType AS fundType, t.OtherFundName AS otherFundName,
                   COALESCE(f.FundName, t.OtherFundName) AS fundName,
                   t.created_date AS createdDate
            FROM trf_contributions t
            LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
            WHERE t.fk_club_id = @ClubId AND t.fk_year_id = @YearId AND t.isdeleted = 0
            ORDER BY t.TrfDate DESC",
            new { ClubId = clubId, YearId = yearId });
    }
}
