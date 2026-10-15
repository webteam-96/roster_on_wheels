using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Public (no-auth) endpoint to view a project's full details, photos, and current-year
/// president/secretary of the club that owns the project. Used by WhatsApp links sent to
/// members — link opens without login.
/// </summary>
[ApiController]
[AllowAnonymous]
public class PublicProjectController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IYearTableResolver _yearTables;

    public PublicProjectController(IConfiguration config, IYearTableResolver yearTables)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _yearTables = yearTables;
    }

    // Year-wise note: URL has no yearId (used by WhatsApp share-links from previous code).
    // Accepts optional ?yearId= for efficiency; otherwise scans existing year tables to find the row.
    [HttpGet("api/public/projects/{id}")]
    public async Task<ActionResult> GetProject(int id, [FromQuery] int? yearId = null)
    {
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();

        YearTableInfo? info = null;
        if (yearId.HasValue && yearId.Value > 0)
        {
            info = await _yearTables.ResolveByYearIdAsync(conn, yearId.Value);
        }
        else
        {
            foreach (var t in await _yearTables.GetAllExistingYearTablesAsync(conn))
            {
                var exists = await conn.ExecuteScalarAsync<int>(
                    $"SELECT COUNT(*) FROM `{t.ProjectsTable}` WHERE pk_project_id = @Id AND isdeleted = 0",
                    new { Id = id });
                if (exists > 0) { info = t; break; }
            }
        }
        if (info is null) return NotFound(new { message = "Project not found." });

        var project = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
            SELECT p.pk_project_id AS id, p.title, p.description,
                   p.project_date AS projectDate,
                   p.project_cost AS projectCost,
                   COALESCE(p.Currency, '{RotaryApi.Services.Brand.SqlCurrency}') AS currency,
                   p.direct_beneficiaries AS directBeneficiaries,
                   p.man_hours AS manHours,
                   p.rotarians_involved AS rotariansInvolved,
                   p.rotaractors_involved AS rotaractorsInvolved,
                   COALESCE(p.rcc_involved,0) AS rccInvolved,
                   p.location,
                   aof.name AS areaOfFocus,
                   cat.name AS category,
                   sc.name AS subCategory,
                   f.name AS funding,
                   p.fk_club_id AS clubId,
                   c.ClubName AS clubName,
                   c.ClubRotaryId AS clubRotaryId,
                   c.City AS clubCity,
                   c.State AS clubState,
                   d.DistrictNumber AS districtNumber,
                   z.ZoneName AS zoneName,
                   -- Club Service meetings (moduleKey 'club_service') render their own fields on the page.
                   mm.ModuleKey AS moduleKey,
                   p.meeting_type AS meetingType,
                   p.attendance AS attendance,
                   p.attendance_percentage AS attendancePercentage,
                   p.agenda_document AS agendaDocument,
                   p.minutes_document AS minutesDocument
            FROM `{info.ProjectsTable}` p
            LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
            LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
            LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
            LEFT JOIN sub_category_master sc ON sc.pk_sub_category_id = p.fk_sub_category_id
            LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
            LEFT JOIN club_master c ON c.pk_club_id = p.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE p.pk_project_id = @Id AND p.isdeleted = 0", new { Id = id });

        if (project == null) return NotFound(new { message = "Project not found." });

        // Photos: reconstruct full URL based on whether project is migrated (old_pk) or new.
        var suffix = info.YearLabel.Replace("-", "_");
        int clubIdForPath = project.clubId != null ? (int)project.clubId : 0;
        var photos = (await conn.QueryAsync<dynamic>($@"
            SELECT CONCAT('/Documents/gallery/Group', @ClubId, '/',
                          CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk)
                               ELSE CONCAT('{suffix}/Album', p.pk_project_id) END,
                          '/', ph.image_path) AS imagePath,
                   ph.description, ph.is_primary AS isPrimary
            FROM `{info.PhotosTable}` ph
            JOIN `{info.ProjectsTable}` p ON p.pk_project_id = ph.fk_project_id
            WHERE ph.fk_project_id = @Id
            ORDER BY ph.is_primary DESC, ph.sort_order ASC, ph.pk_photo_id ASC",
            new { Id = id, ClubId = clubIdForPath })).ToList();

        int clubId = project.clubId != null ? (int)project.clubId : 0;
        var officers = new List<object>();
        if (clubId > 0)
        {
            officers = (await conn.QueryAsync<dynamic>(@"
                SELECT dm.designation_name AS designation,
                       m.MemberName AS memberName,
                       m.EmailId AS email,
                       m.PrimaryMobileNumber AS mobile,
                       CASE
                           WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                           WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                           ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                       END AS profilePhotoPath
                FROM board_of_directors bd
                JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
                JOIN rotary_year_master ry ON ry.pk_year_id = bd.fk_year_id
                JOIN designation_master dm ON dm.pk_designation_id = bd.fk_designation_id
                WHERE bd.fk_club_id = @ClubId
                  AND bd.isdeleted = 0 AND m.isdeleted = 0
                  AND CURDATE() BETWEEN ry.StartDate AND ry.EndDate
                  AND (dm.designation_name = 'President' OR dm.designation_name = 'Secretary')
                ORDER BY FIELD(dm.designation_name, 'President', 'Secretary')",
                new { ClubId = clubId })).Cast<object>().ToList();
        }

        return Ok(new { project, photos, officers });
    }
}
