using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// SuperAdmin → Settings → Project Sync. Reads rotary_org_project_sync_log (written by
// RotaryOrgProjectSyncController on Sync click / Publish confirm / Reset) next to each project's
// synced_to_org flag, so support can see a sync that was started but never published.
// Nothing is listed until a club is picked — the screen never loads a default list.
[ApiController]
[Authorize]
[Route("api/settings/project-sync")]
public class RotaryOrgProjectSyncLogController : ControllerBase
{
    private readonly IYearTableResolver _yearTables;
    private readonly string _conn;

    public RotaryOrgProjectSyncLogController(IConfiguration config, IYearTableResolver yearTables)
    {
        _yearTables = yearTables;
        _conn = config.GetConnectionString("DefaultConnection")!;
    }

    private bool IsSuperAdmin() => (User.FindFirst("roles")?.Value ?? "").Contains("SuperAdmin");

    // Smart club search: every word typed must appear in the club name (so "thane city" finds
    // "Rotary Club of Thane City View"). Min 2 characters, top 20.
    [HttpGet("clubs")]
    public async Task<ActionResult> SearchClubs([FromQuery] string? q)
    {
        if (!IsSuperAdmin()) return Forbid();
        var words = (q ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (string.Join("", words).Length < 2) return Ok(Array.Empty<object>());

        var where = new List<string>();
        var p = new DynamicParameters();
        for (int i = 0; i < words.Length && i < 6; i++)
        {
            where.Add($"c.ClubName LIKE @w{i}");
            p.Add($"w{i}", "%" + words[i] + "%");
        }
        p.Add("starts", (q ?? "").Trim() + "%");

        using var conn = new MySqlConnection(_conn);
        var rows = await conn.QueryAsync(@$"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.fk_district_id AS districtId,
                   d.DistrictNumber AS districtNumber
            FROM club_master c
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE c.isdeleted = 0 AND {string.Join(" AND ", where)}
            ORDER BY (c.ClubName LIKE @starts) DESC, c.ClubName
            LIMIT 20", p);
        return Ok(rows);
    }

    // One row per project of the club that has ever been synced or had Sync clicked, newest activity
    // first. Status: Published when synced_to_org = 1 (or "Published (before log)" when it was flagged
    // before this log existed); otherwise the last logged action decides - Reset or Pending for publish.
    [HttpGet("clubs/{clubId:int}/projects")]
    public async Task<ActionResult> GetClubProjects(int clubId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = new MySqlConnection(_conn);
        await conn.OpenAsync();

        var logRows = (await conn.QueryAsync<LogAgg>(@"
            SELECT l.projects_table AS ProjectsTable, l.fk_project_id AS ProjectId,
                   CAST(SUM(l.action = 'sync_clicked') AS SIGNED) AS SyncClicks,
                   MAX(CASE WHEN l.action = 'sync_clicked' THEN l.created_date END) AS LastSyncClickedAt,
                   MAX(CASE WHEN l.action = 'published' THEN l.created_date END) AS LastPublishedAt,
                   MAX(CASE WHEN l.action = 'reset' THEN l.created_date END) AS LastResetAt,
                   CAST(MAX(l.pk_id) AS SIGNED) AS LastLogId
            FROM rotary_org_project_sync_log l
            WHERE l.fk_club_id = @clubId AND l.projects_table IS NOT NULL
            GROUP BY l.projects_table, l.fk_project_id", new { clubId })).ToList();

        // Last action + who clicked Sync last, per project.
        var lastIds = logRows.Select(r => r.LastLogId).ToList();
        var lastAction = lastIds.Count == 0 ? new Dictionary<long, string>() :
            (await conn.QueryAsync<(long id, string action)>(
                "SELECT CAST(pk_id AS SIGNED), action FROM rotary_org_project_sync_log WHERE pk_id IN @lastIds", new { lastIds }))
            .ToDictionary(x => x.id, x => x.action);
        var lastClicker = (await conn.QueryAsync<(string tbl, int pid, string? name)>(@"
            SELECT l.projects_table, l.fk_project_id, m.MemberName
            FROM rotary_org_project_sync_log l
            JOIN (SELECT projects_table, fk_project_id, MAX(pk_id) AS id
                  FROM rotary_org_project_sync_log
                  WHERE fk_club_id = @clubId AND action = 'sync_clicked' AND projects_table IS NOT NULL
                  GROUP BY projects_table, fk_project_id) x ON x.id = l.pk_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = l.fk_member_id",
            new { clubId })).ToDictionary(x => (x.tbl, x.pid), x => x.name);

        var byTable = logRows.GroupBy(r => r.ProjectsTable!).ToDictionary(g => g.Key, g => g.ToList());
        var result = new List<ProjectSyncRow>();
        foreach (var t in await _yearTables.GetAllExistingYearTablesAsync(conn))
        {
            var loggedIds = byTable.TryGetValue(t.ProjectsTable, out var lr) ? lr.Select(r => r.ProjectId).ToList() : new List<int>();
            var projects = await conn.QueryAsync<ProjRow>(@$"
                SELECT p.pk_project_id AS ProjectId, p.title AS Title, p.project_date AS ProjectDate,
                       aof.name AS AreaOfFocus, p.synced_to_org AS SyncedToOrg, p.synced_to_org_date AS SyncedToOrgDate
                FROM `{t.ProjectsTable}` p
                LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
                WHERE p.fk_club_id = @clubId AND p.isdeleted = 0
                  AND (p.synced_to_org = 1 {(loggedIds.Count > 0 ? "OR p.pk_project_id IN @loggedIds" : "")})",
                new { clubId, loggedIds });

            foreach (var p in projects)
            {
                var log = lr?.FirstOrDefault(r => r.ProjectId == p.ProjectId);
                string status;
                if (p.SyncedToOrg) status = log?.LastPublishedAt != null ? "Published" : "Published (before log)";
                else if (log != null && lastAction.TryGetValue(log.LastLogId, out var a) && a == "reset") status = "Reset";
                else status = "Pending for publish";

                lastClicker.TryGetValue((t.ProjectsTable, p.ProjectId), out var clicker);
                result.Add(new ProjectSyncRow
                {
                    ProjectId = p.ProjectId,
                    YearId = t.YearId,
                    YearLabel = t.YearLabel,
                    Title = p.Title,
                    ProjectDate = p.ProjectDate,
                    AreaOfFocus = p.AreaOfFocus,
                    Status = status,
                    SyncClicks = log?.SyncClicks ?? 0,
                    LastSyncClickedAt = log?.LastSyncClickedAt,
                    LastSyncClickedBy = clicker,
                    PublishedAt = p.SyncedToOrg ? (log?.LastPublishedAt ?? p.SyncedToOrgDate) : log?.LastPublishedAt,
                    LastResetAt = log?.LastResetAt,
                    LastActivity = new[] { log?.LastSyncClickedAt, log?.LastPublishedAt, log?.LastResetAt, p.SyncedToOrgDate }.Max(),
                });
            }
        }
        return Ok(result.OrderByDescending(r => r.LastActivity));
    }

    // Every logged event of one project, newest first.
    [HttpGet("clubs/{clubId:int}/projects/{projectId:int}/history")]
    public async Task<ActionResult> GetProjectHistory(int clubId, int projectId, [FromQuery] int? yearId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = new MySqlConnection(_conn);
        var rows = await conn.QueryAsync(@"
            SELECT l.pk_id AS id, l.action, l.created_date AS createdDate, l.fk_member_id AS memberId,
                   m.MemberName AS memberName, l.client_ip AS clientIp
            FROM rotary_org_project_sync_log l
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = l.fk_member_id
            WHERE l.fk_club_id = @clubId AND l.fk_project_id = @projectId
              AND (@yearId IS NULL OR l.fk_year_id = @yearId)
            ORDER BY l.pk_id DESC", new { clubId, projectId, yearId });
        return Ok(rows);
    }

    public sealed class ProjectSyncRow
    {
        public int ProjectId { get; set; }
        public int YearId { get; set; }
        public string? YearLabel { get; set; }
        public string? Title { get; set; }
        public DateTime? ProjectDate { get; set; }
        public string? AreaOfFocus { get; set; }
        public string Status { get; set; } = "";
        public long SyncClicks { get; set; }
        public DateTime? LastSyncClickedAt { get; set; }
        public string? LastSyncClickedBy { get; set; }
        public DateTime? PublishedAt { get; set; }
        public DateTime? LastResetAt { get; set; }
        public DateTime? LastActivity { get; set; }
    }

    private sealed class LogAgg
    {
        public string? ProjectsTable { get; set; }
        public int ProjectId { get; set; }
        public long SyncClicks { get; set; }
        public DateTime? LastSyncClickedAt { get; set; }
        public DateTime? LastPublishedAt { get; set; }
        public DateTime? LastResetAt { get; set; }
        public long LastLogId { get; set; }
    }

    private sealed class ProjRow
    {
        public int ProjectId { get; set; }
        public string? Title { get; set; }
        public DateTime? ProjectDate { get; set; }
        public string? AreaOfFocus { get; set; }
        public bool SyncedToOrg { get; set; }
        public DateTime? SyncedToOrgDate { get; set; }
    }
}
