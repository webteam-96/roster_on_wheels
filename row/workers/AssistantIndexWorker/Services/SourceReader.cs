using RotaryApi.Services;
using Dapper;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace AssistantIndexWorker.Services;

// Reads the live source rows (read-only) and turns them into IndexItems.
//
// Projects: every existing rotary_projects_YYYY_YY table, live rows only (isdeleted = 0, is_active = 1).
// Comms:    announcements, upcoming_events, newsletters, club_documents (isdeleted = 0).
//
// Hidden hierarchy is skipped like everywhere else in the platform (RotaryApi HierarchyScopeSql):
// a deleted/inactive club, district or zone hides everything under it. Rows hidden that way, or
// with no club, simply drop out of the index on the next run.
public sealed class SourceReader
{
    private readonly string _connString;
    private readonly YearTableResolver _years;
    private readonly string _model;
    private readonly int _dims;
    private readonly ILogger<SourceReader> _log;

    public SourceReader(string connString, YearTableResolver years, string embeddingModel, int embeddingDims,
        ILogger<SourceReader> log)
    {
        _connString = connString;
        _years = years;
        _model = embeddingModel;
        _dims = embeddingDims;
        _log = log;
    }

    // ── Projects ────────────────────────────────────────────────────────────

    private sealed class ProjectRow
    {
        public int ProjectId { get; set; }
        public int ClubId { get; set; }
        public string? ModuleKey { get; set; }
        public int? AreaOfFocusId { get; set; }
        public string? ApprovalStatus { get; set; }
        public string? ProjectDate { get; set; }
        public string? Title { get; set; }
        public string? Description { get; set; }
        public string? Location { get; set; }
        public string? OtherAreaOfFocus { get; set; }
        public string? OtherCategory { get; set; }
        public string? OtherSubCategory { get; set; }
    }

    public async Task<List<IndexItem>> ReadProjectsAsync()
    {
        await using var conn = RowDb.Connect(_connString);
        await conn.OpenAsync();
        var hierarchy = await LoadHierarchyAsync(conn);
        var tables = await _years.GetAllExistingYearTablesAsync(conn);

        var items = new List<IndexItem>();
        var skipped = 0;
        foreach (var t in tables)
        {
            var rows = await conn.QueryAsync<ProjectRow>($@"
                SELECT p.pk_project_id AS ProjectId, p.fk_club_id AS ClubId, m.ModuleKey AS ModuleKey,
                       p.fk_area_of_focus_id AS AreaOfFocusId, p.approval_status AS ApprovalStatus,
                       DATE_FORMAT(p.project_date, '%Y-%m-%d') AS ProjectDate,
                       p.title AS Title, p.description AS Description, p.location AS Location,
                       COALESCE(NULLIF(TRIM(p.other_area_of_focus),''), TRIM(af.name)) AS OtherAreaOfFocus,
                       COALESCE(NULLIF(TRIM(p.other_category),''), TRIM(cat.name)) AS OtherCategory,
                       COALESCE(NULLIF(TRIM(p.other_sub_category),''), TRIM(sub.name)) AS OtherSubCategory
                FROM `{t.ProjectsTable}` p
                LEFT JOIN module_master m ON m.pk_module_id = p.fk_module_id
                LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
                LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
                LEFT JOIN sub_category_master sub ON sub.pk_sub_category_id = p.fk_sub_category_id
                WHERE p.isdeleted = 0 AND p.is_active = 1", commandTimeout: 300);

            var count = 0;
            foreach (var r in rows)
            {
                if (!hierarchy.ClubDistrict.TryGetValue(r.ClubId, out var districtId))
                {
                    skipped++;
                    continue;
                }

                var payload = new SortedDictionary<string, object>(StringComparer.Ordinal)
                {
                    ["year_id"] = t.YearId,
                    ["year_label"] = t.YearLabel,
                    ["project_id"] = r.ProjectId,
                    ["club_id"] = r.ClubId,
                    ["district_id"] = districtId,
                    ["module_key"] = r.ModuleKey ?? "",
                    ["approval_status"] = r.ApprovalStatus ?? "",   // NULL = no approval needed (counts as approved)
                };
                AddIfNotNull(payload, "zone_id", hierarchy.DistrictZone[districtId]);
                AddIfNotNull(payload, "area_of_focus_id", r.AreaOfFocusId);
                AddIfNotNull(payload, "project_date", ValidDate(r.ProjectDate));

                var body = JoinLines(
                    r.Description,
                    Labelled("Location", r.Location),
                    Labelled("Area of focus", r.OtherAreaOfFocus),
                    Labelled("Category", r.OtherCategory),
                    Labelled("Sub-category", r.OtherSubCategory));

                items.Add(new IndexItem("project",
                    itemKey: $"{YearTableResolver.SuffixFromLabel(t.YearLabel)}:{r.ProjectId}",
                    pointKey: $"project:{t.YearLabel}:{r.ProjectId}",
                    r.Title, body, payload, _model, _dims));
                count++;
            }
            if (count > 0) _log.LogInformation("  {Table}: {Count} live projects", t.ProjectsTable, count);
        }

        if (skipped > 0)
            _log.LogInformation("  Skipped {Skipped} projects with no live club (district-level, deleted or hidden club).", skipped);
        return items;
    }

    // ── Communications ──────────────────────────────────────────────────────

    private sealed class CommsRow
    {
        public int ItemId { get; set; }
        public string? DbScope { get; set; }
        public int? ClubId { get; set; }
        public int? DistrictId { get; set; }
        public string? Title { get; set; }
        public string? Description { get; set; }
        public string? Venue { get; set; }
        public string? FileName { get; set; }
        public string? PublishDate { get; set; }
        public string? ExpiryDate { get; set; }
        public string? EventDate { get; set; }
        public string? Status { get; set; }
    }

    // Status is derived from the dates exactly like the admin listings do: the stored Status column
    // defaults to 'Unpublished' and is never refreshed (see RotaryApi OcvLiveVisibility).
    private static string StatusSql(string publish, string expiry) => $@"
        CASE WHEN {expiry} < NOW() THEN 'Expired'
             WHEN {publish} <= NOW() THEN 'Published'
             ELSE 'Unpublished' END";

    private static readonly (string Type, string Sql)[] CommsQueries =
    {
        ("announcement", $@"
            SELECT a.pk_announcement_id AS ItemId, a.Scope AS DbScope, a.fk_club_id AS ClubId, a.fk_district_id AS DistrictId,
                   a.Title, a.Description, NULL AS Venue, NULL AS FileName,
                   DATE_FORMAT(a.PublishDateTime, '%Y-%m-%d') AS PublishDate,
                   DATE_FORMAT(a.ExpiryDateTime, '%Y-%m-%d') AS ExpiryDate, NULL AS EventDate,
                   {StatusSql("a.PublishDateTime", "a.ExpiryDateTime")} AS Status
            FROM announcements a
            WHERE a.isdeleted = 0"),
        ("event", $@"
            SELECT e.pk_upcoming_event_id AS ItemId, e.Scope AS DbScope, e.fk_club_id AS ClubId, e.fk_district_id AS DistrictId,
                   e.Title, e.Description, e.EventVenue AS Venue, NULL AS FileName,
                   DATE_FORMAT(e.PublishDate, '%Y-%m-%d') AS PublishDate,
                   DATE_FORMAT(e.ExpiryDate, '%Y-%m-%d') AS ExpiryDate,
                   DATE_FORMAT(e.EventDate, '%Y-%m-%d') AS EventDate,
                   {StatusSql("e.PublishDate", "e.ExpiryDate")} AS Status
            FROM upcoming_events e
            WHERE e.isdeleted = 0"),
        // Legacy newsletters were saved with expiry = publish, which the public site treats as "never
        // expires" (OcvLiveVisibility.Newsletters) — so such an expiry is dropped here.
        ("newsletter", $@"
            SELECT n.pk_newsletter_id AS ItemId, n.Scope AS DbScope, n.fk_club_id AS ClubId, n.fk_district_id AS DistrictId,
                   n.Title, NULL AS Description, NULL AS Venue, NULL AS FileName,
                   DATE_FORMAT(n.PublishDateTime, '%Y-%m-%d') AS PublishDate,
                   CASE WHEN n.ExpiryDateTime > n.PublishDateTime THEN DATE_FORMAT(n.ExpiryDateTime, '%Y-%m-%d') END AS ExpiryDate,
                   NULL AS EventDate,
                   {StatusSql("n.PublishDateTime", "(CASE WHEN n.ExpiryDateTime > n.PublishDateTime THEN n.ExpiryDateTime END)")} AS Status
            FROM newsletters n
            WHERE n.isdeleted = 0"),
        ("document", $@"
            SELECT d.pk_document_id AS ItemId, d.Scope AS DbScope, d.fk_club_id AS ClubId, d.fk_district_id AS DistrictId,
                   d.Title, NULL AS Description, NULL AS Venue, d.OriginalFileName AS FileName,
                   DATE_FORMAT(d.PublishDateTime, '%Y-%m-%d') AS PublishDate,
                   DATE_FORMAT(d.ExpiryDateTime, '%Y-%m-%d') AS ExpiryDate, NULL AS EventDate,
                   {StatusSql("d.PublishDateTime", "d.ExpiryDateTime")} AS Status
            FROM club_documents d
            WHERE d.isdeleted = 0"),
    };

    public async Task<List<IndexItem>> ReadCommsAsync()
    {
        await using var conn = RowDb.Connect(_connString);
        await conn.OpenAsync();
        var hierarchy = await LoadHierarchyAsync(conn);

        var items = new List<IndexItem>();
        foreach (var (type, sql) in CommsQueries)
        {
            var count = 0;
            var skipped = 0;
            foreach (var r in await conn.QueryAsync<CommsRow>(sql, commandTimeout: 300))
            {
                var payload = new SortedDictionary<string, object>(StringComparer.Ordinal)
                {
                    ["type"] = type,
                    ["item_id"] = r.ItemId,
                    ["status"] = r.Status ?? "Unpublished",
                };

                // DB Scope is 'ri' for RI Director records and 'district' (the column default) for
                // everything else; district vs club comes from which fk is set (club rows carry
                // fk_district_id = NULL, district rows carry fk_club_id = 0).
                if (string.Equals(r.DbScope, "ri", StringComparison.OrdinalIgnoreCase))
                {
                    payload["scope"] = "ri";
                }
                else if (r.DistrictId is > 0)
                {
                    if (!hierarchy.DistrictZone.TryGetValue(r.DistrictId.Value, out var zoneId)) { skipped++; continue; }
                    payload["scope"] = "district";
                    payload["district_id"] = r.DistrictId.Value;
                    AddIfNotNull(payload, "zone_id", zoneId);
                }
                else if (r.ClubId is > 0 && hierarchy.ClubDistrict.TryGetValue(r.ClubId.Value, out var clubDistrictId))
                {
                    payload["scope"] = "club";
                    payload["club_id"] = r.ClubId.Value;
                    payload["district_id"] = clubDistrictId;
                    AddIfNotNull(payload, "zone_id", hierarchy.DistrictZone[clubDistrictId]);
                }
                else
                {
                    skipped++;
                    continue;
                }

                AddIfNotNull(payload, "publish_date", ValidDate(r.PublishDate));
                AddIfNotNull(payload, "expiry_date", ValidDate(r.ExpiryDate));
                AddIfNotNull(payload, "event_date", ValidDate(r.EventDate));

                // Newsletters and documents live in files, so only the title (and file name) is embedded.
                var body = type switch
                {
                    "announcement" => r.Description,
                    "event" => JoinLines(r.Description, Labelled("Venue", r.Venue)),
                    "newsletter" => "Newsletter",
                    _ => JoinLines("Document", Labelled("File", r.FileName)),
                };

                items.Add(new IndexItem("comms",
                    itemKey: $"{type}:{r.ItemId}",
                    pointKey: $"comms:{type}:{r.ItemId}",
                    r.Title, body, payload, _model, _dims));
                count++;
            }
            _log.LogInformation("  {Type}: {Count} rows{Skipped}", type, count,
                skipped > 0 ? $" ({skipped} skipped: no live club/district)" : "");
        }
        return items;
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    // Live clubs → their district, live districts → their zone (NULL when the district has no zone).
    private sealed record Hierarchy(Dictionary<int, int> ClubDistrict, Dictionary<int, int?> DistrictZone);

    private static async Task<Hierarchy> LoadHierarchyAsync(MySqlConnection conn)
    {
        var districts = (await conn.QueryAsync<(int Id, int? ZoneId)>(@"
            SELECT d.pk_district_id, d.fk_zone_id
            FROM district_master d
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE COALESCE(d.isdeleted, 0) = 0 AND COALESCE(d.IsActive, 1) = 1
              AND COALESCE(z.isdeleted, 0) = 0 AND COALESCE(z.IsActive, 1) = 1"))
            .ToDictionary(r => r.Id, r => r.ZoneId);

        var clubs = (await conn.QueryAsync<(int Id, int DistrictId)>(@"
            SELECT c.pk_club_id, c.fk_district_id
            FROM club_master c
            WHERE COALESCE(c.isdeleted, 0) = 0 AND COALESCE(c.IsActive, 1) = 1"))
            .Where(c => districts.ContainsKey(c.DistrictId))
            .ToDictionary(c => c.Id, c => c.DistrictId);

        return new Hierarchy(clubs, districts);
    }

    private static void AddIfNotNull(SortedDictionary<string, object> payload, string key, object? value)
    {
        if (value != null) payload[key] = value;
    }

    // DATE_FORMAT output; MySQL zero dates ("0000-00-00") count as no date.
    private static string? ValidDate(string? yyyyMmDd) =>
        string.IsNullOrEmpty(yyyyMmDd) || yyyyMmDd.StartsWith("0000", StringComparison.Ordinal) ? null : yyyyMmDd;

    private static string? Labelled(string label, string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : $"{label}: {value.Trim()}";

    private static string JoinLines(params string?[] parts) =>
        string.Join("\n", parts.Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => p!.Trim()));
}
