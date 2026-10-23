using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Public read-only feeds for the Club-Website Next.js app — Gallery + Past Events.
// New (additive) file per project memory feedback_additive_only_new_modules:
// nothing in the existing ClubWebsitePublicDataController is touched.
//
// Both endpoints reuse the same kill-switch chain as ClubWebsitePublicDataController:
// active club + district + zone + non-deleted club_websites row. A killed club's
// public site goes fully dark — gallery and past events included.

[ApiController]
[Route("api/public/club")]
[AllowAnonymous]
public class ClubGalleryPublicController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IYearTableResolver _yearTables;

    public ClubGalleryPublicController(IConfiguration config, IYearTableResolver yearTables)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _yearTables = yearTables;
    }

    private MySqlConnection CreateConn() => new(_connectionString);

    // Same SQL as ClubWebsitePublicDataController.IsClubServiceableAsync — duplicated
    // intentionally so this controller has no compile-time dependency on the other one
    // (additive rule). The two queries must stay in lockstep if the kill-switch
    // criteria ever change — that's the cost of the duplication.
    private async Task<bool> IsClubServiceableAsync(MySqlConnection conn, int clubId)
    {
        var count = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*)
            FROM club_websites w
            JOIN club_master c   ON c.pk_club_id      = w.fk_club_id
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN zone_master z   ON z.pk_zone_id      = d.fk_zone_id
            WHERE w.fk_club_id = @ClubId
              AND w.isdeleted = 0
              AND c.isdeleted = 0 AND c.IsActive = 1
              AND d.isdeleted = 0 AND d.IsActive = 1
              AND z.isdeleted = 0 AND z.IsActive = 1",
            new { ClubId = clubId });
        return count > 0;
    }

    // ── Gallery — aggregated project photos across year tables ────────────

    public class GalleryPhotoDto
    {
        public int ProjectId { get; set; }
        public string ProjectTitle { get; set; } = "";
        public string ModuleKey { get; set; } = "";
        public string ModuleName { get; set; } = "";
        public string ImagePath { get; set; } = "";
        public bool IsPrimary { get; set; }
        public string? CreatedDate { get; set; }   // ISO datetime
    }

    public class GalleryPageDto
    {
        public int TotalCount { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }
        public List<GalleryPhotoDto> Photos { get; set; } = new();
    }

    // UNION ALL across every existing year-wise project + photo table for the
    // club (or a single year when yearId is supplied). Pagination metadata is
    // returned alongside the page so the UI can render a "page X of Y" footer.
    [HttpGet("{clubId:int}/gallery")]
    public async Task<ActionResult<GalleryPageDto>> GetGallery(
        int clubId,
        [FromQuery] int? yearId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 24)
    {
        if (page < 1) page = 1;
        if (pageSize < 1) pageSize = 24;
        if (pageSize > 100) pageSize = 100;

        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        var tables = (yearId.HasValue && yearId.Value > 0)
            ? new List<YearTableInfo> { (await _yearTables.ResolveByYearIdAsync(conn, yearId.Value)) }
                .Where(t => t != null).Cast<YearTableInfo>().ToList()
            : await _yearTables.GetAllExistingYearTablesAsync(conn);

        if (tables.Count == 0)
        {
            return Ok(new GalleryPageDto { TotalCount = 0, Page = page, PageSize = pageSize });
        }

        // Build one UNION leg per year. Photo path reconstruction mirrors the
        // pattern in ClubWebsitePublicDataController (Group<clubId>/[Album<oldPk>
        // when migrated | YYYY_YY/Album<projectId> when new] / <filename>).
        var unionLegs = string.Join(" UNION ALL ", tables.Select(t =>
        {
            var suffix = t.YearLabel.Replace("-", "_");
            return $@"SELECT p.pk_project_id AS ProjectId,
                             p.title         AS ProjectTitle,
                             mm.ModuleKey    AS ModuleKey,
                             mm.ModuleName   AS ModuleName,
                             CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                                    CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk)
                                         ELSE CONCAT('{suffix}/Album', p.pk_project_id) END,
                                    '/', ph.image_path) AS ImagePath,
                             ph.is_primary   AS IsPrimary,
                             ph.created_date AS CreatedDate
                      FROM `{t.PhotosTable}` ph
                      JOIN `{t.ProjectsTable}` p ON p.pk_project_id = ph.fk_project_id
                      JOIN module_master mm     ON mm.pk_module_id = p.fk_module_id
                      WHERE p.fk_club_id = @ClubId
                        AND p.isdeleted = 0 AND p.is_active = 1
                        AND ph.image_path IS NOT NULL AND ph.image_path <> ''";
        }));

        // COUNT first so the response carries totalCount. The inner SELECT is the
        // same shape as the data query so MySQL can reuse the query plan.
        var totalCount = await conn.ExecuteScalarAsync<long>(
            $"SELECT COUNT(*) FROM ({unionLegs}) u",
            new { ClubId = clubId });

        var offset = (page - 1) * pageSize;
        var pageSql = $@"
            SELECT * FROM ({unionLegs}) u
            ORDER BY COALESCE(u.CreatedDate, '1900-01-01') DESC, u.IsPrimary DESC, u.ProjectId DESC
            LIMIT @PageSize OFFSET @Offset";

        var raw = await conn.QueryAsync<dynamic>(pageSql,
            new { ClubId = clubId, PageSize = pageSize, Offset = offset });

        var photos = raw.Select(r => new GalleryPhotoDto
        {
            ProjectId    = (int)r.ProjectId,
            ProjectTitle = (string?)r.ProjectTitle ?? "",
            ModuleKey    = (string?)r.ModuleKey ?? "",
            ModuleName   = (string?)r.ModuleName ?? "",
            ImagePath    = (string?)r.ImagePath ?? "",
            IsPrimary    = r.IsPrimary == null ? false : Convert.ToBoolean(r.IsPrimary),
            CreatedDate  = r.CreatedDate is DateTime cd ? cd.ToString("yyyy-MM-ddTHH:mm:ss") : null,
        }).ToList();

        return Ok(new GalleryPageDto
        {
            TotalCount = (int)totalCount,
            Page       = page,
            PageSize   = pageSize,
            Photos     = photos,
        });
    }

    // ── Past Events — events with EventDate < TODAY ───────────────────────

    public class PastEventDto
    {
        public int Id { get; set; }
        public string Title { get; set; } = "";
        public string? Description { get; set; }
        public string? Venue { get; set; }
        public string EventDate { get; set; } = "";   // ISO datetime
        public string? ImagePath { get; set; }
        public string? RegistrationLink { get; set; }
    }

    [HttpGet("{clubId:int}/past-events")]
    public async Task<ActionResult<IEnumerable<PastEventDto>>> GetPastEvents(
        int clubId,
        [FromQuery] int? yearId,
        [FromQuery] int limit = 99)
    {
        if (limit < 1) limit = 99;
        if (limit > 500) limit = 500;

        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        // Resolve yearId → Rotary year window (StartDate..EndDate) so we can filter
        // events by their EventDate falling inside the Rotary year. We don't trust
        // upcoming_events.fk_year_id alone because some legacy rows have it 0/NULL.
        DateTime? winStart = null, winEnd = null;
        if (yearId.HasValue && yearId.Value > 0)
        {
            var win = await conn.QueryFirstOrDefaultAsync<(DateTime StartDate, DateTime EndDate)?>(@"
                SELECT StartDate, EndDate
                FROM rotary_year_master
                WHERE pk_year_id = @Id AND isdeleted = 0 LIMIT 1",
                new { Id = yearId.Value });
            if (win.HasValue) { winStart = win.Value.StartDate; winEnd = win.Value.EndDate; }
        }

        // Past events = EventDate strictly before today. We deliberately ignore
        // PublishDate / ExpiryDate (an event from 3 years ago is "past", whether
        // or not someone bothered to keep it published).
        var sql = @"
            SELECT pk_upcoming_event_id AS Id, Title, Description,
                   EventVenue AS Venue, EventDate,
                   CASE
                       WHEN ImagePath IS NULL OR ImagePath = '' THEN NULL
                       WHEN ImagePath LIKE '/%' THEN ImagePath
                       WHEN fk_district_id IS NOT NULL THEN CONCAT('/Documents/Event/Group', fk_district_id, '/', ImagePath)
                       ELSE CONCAT('/Documents/Event/Group', fk_club_id, '/', ImagePath)
                   END AS ImagePath,
                   RegistrationLink
            FROM upcoming_events
            WHERE fk_club_id = @ClubId AND isdeleted = 0
              AND EventDate < CURDATE()";
        var p = new DynamicParameters();
        p.Add("ClubId", clubId);
        if (winStart.HasValue && winEnd.HasValue)
        {
            sql += " AND EventDate BETWEEN @WinStart AND @WinEnd";
            p.Add("WinStart", winStart.Value);
            p.Add("WinEnd", winEnd.Value);
        }
        sql += " ORDER BY EventDate DESC LIMIT @Limit";
        p.Add("Limit", limit);

        var rows = await conn.QueryAsync<dynamic>(sql, p);

        return Ok(rows.Select(r => new PastEventDto
        {
            Id               = (int)r.Id,
            Title            = (string?)r.Title ?? "",
            Description      = (string?)r.Description,
            Venue            = (string?)r.Venue,
            EventDate        = ((DateTime)r.EventDate).ToString("yyyy-MM-ddTHH:mm:ss"),
            ImagePath        = (string?)r.ImagePath,
            RegistrationLink = (string?)r.RegistrationLink,
        }));
    }
}
