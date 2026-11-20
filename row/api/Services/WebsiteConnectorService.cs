using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// WordPress connector (gap agent): read-only website API keys for a club or district, and the public-safe data a
/// WordPress site may show with one. Keys are random, shown once, stored only as a SHA-256 hash (they are 256-bit
/// random, so a plain hash is enough; no password stretching needed), scoped to one club or district, revocable.
/// </summary>
public class WebsiteConnectorService
{
    public const string KeyHeader = "X-ROW-Key";
    public const int MaxActiveKeys = 10;
    private const string KeyPrefix = "rowk_";

    private static readonly string[] ProjectModuleKeys =
    {
        "community_service", "vocational_service", "international_service",
        "new_generation_service", "public_image_initiative", "club_service",
    };

    private readonly string _connectionString;
    private readonly IYearTableResolver _yearTables;

    public WebsiteConnectorService(IConfiguration config, IYearTableResolver yearTables)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _yearTables = yearTables;
    }

    // ── pure helpers (unit tested) ──────────────────────────────────────

    public static string NewKey()
    {
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return KeyPrefix + token;
    }

    public static string HashKey(string key) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key))).ToLowerInvariant();

    /// <summary>What the admin list shows so a key can be recognised; never enough to use it.</summary>
    public static string DisplayPrefix(string key) => key[..Math.Min(12, key.Length)];

    /// <summary>A header value worth hashing: our prefix, sane length, URL-safe characters only.</summary>
    public static bool LooksLikeKey(string? key) =>
        key != null && key.StartsWith(KeyPrefix, StringComparison.Ordinal) && key.Length is >= 30 and <= 80
        && key.Skip(KeyPrefix.Length).All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');

    public static bool IsScope(string? scope) => scope is "club" or "district";

    private static readonly Regex Tags = new("<[^>]*>", RegexOptions.Compiled);
    private static readonly Regex Spaces = new(@"\s+", RegexOptions.Compiled);

    /// <summary>Admin rich text to plain text: the plugin escapes everything, so markup must not reach it.</summary>
    public static string? PlainText(string? html, int max = 600)
    {
        if (string.IsNullOrWhiteSpace(html)) return null;
        var text = Spaces.Replace(WebUtility.HtmlDecode(Tags.Replace(html, " ")), " ").Trim();
        return text.Length <= max ? text : text[..max].TrimEnd() + "...";
    }

    public static int ClampLimit(int? limit, int fallback = 10) => Math.Clamp(limit ?? fallback, 1, 50);

    private MySqlConnection Conn() => RowDb.Connect(_connectionString);

    // ── keys (admin) ─────────────────────────────────────────────────────

    public sealed record KeyRow(int Id, string Label, string KeyPrefix, DateTime CreatedUtc, DateTime? LastUsedUtc, DateTime? RevokedUtc);

    public async Task<IEnumerable<KeyRow>> ListKeysAsync(string scope, int scopeId)
    {
        await using var c = Conn();
        return await c.QueryAsync<KeyRow>(@"
            SELECT pk_website_api_key_id AS Id, label AS Label, key_prefix AS KeyPrefix, created_utc AS CreatedUtc,
                   last_used_utc AS LastUsedUtc, revoked_utc AS RevokedUtc
            FROM website_api_keys WHERE scope_type = @scope AND scope_id = @scopeId
            ORDER BY revoked_utc IS NULL DESC, created_utc DESC", new { scope, scopeId });
    }

    /// <returns>the new key in plain text (shown once), or null when the scope already has MaxActiveKeys.</returns>
    public async Task<(KeyRow Row, string Key)?> CreateKeyAsync(string scope, int scopeId, string label, int memberId)
    {
        await using var c = Conn();
        var active = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM website_api_keys WHERE scope_type = @scope AND scope_id = @scopeId AND revoked_utc IS NULL",
            new { scope, scopeId });
        if (active >= MaxActiveKeys) return null;
        var key = NewKey();
        var now = DateTime.UtcNow;
        var id = await c.ExecuteScalarAsync<int>(@"
            INSERT INTO website_api_keys (scope_type, scope_id, label, key_prefix, key_hash, created_by, created_utc)
            VALUES (@scope, @scopeId, @label, @prefix, @hash, @memberId, @now); SELECT LAST_INSERT_ID();",
            new { scope, scopeId, label, prefix = DisplayPrefix(key), hash = HashKey(key), memberId, now });
        return (new KeyRow(id, label, DisplayPrefix(key), now, null, null), key);
    }

    public async Task<bool> RevokeKeyAsync(string scope, int scopeId, int keyId)
    {
        await using var c = Conn();
        return await c.ExecuteAsync(@"
            UPDATE website_api_keys SET revoked_utc = UTC_TIMESTAMP()
            WHERE pk_website_api_key_id = @keyId AND scope_type = @scope AND scope_id = @scopeId AND revoked_utc IS NULL",
            new { keyId, scope, scopeId }) > 0;
    }

    /// <summary>The live club/district a key reads, or null for an unknown, revoked or inactive one.</summary>
    public async Task<(string Scope, int ScopeId)?> ResolveKeyAsync(string? key)
    {
        if (!LooksLikeKey(key)) return null;
        await using var c = Conn();
        var row = await c.QueryFirstOrDefaultAsync<(int Id, string Scope, int ScopeId)?>(@"
            SELECT k.pk_website_api_key_id, k.scope_type, k.scope_id
            FROM website_api_keys k
            LEFT JOIN club_master cm ON k.scope_type = 'club' AND cm.pk_club_id = k.scope_id
            LEFT JOIN district_master dm ON k.scope_type = 'district' AND dm.pk_district_id = k.scope_id
            WHERE k.key_hash = @hash AND k.revoked_utc IS NULL
              AND ((k.scope_type = 'club' AND cm.isdeleted = 0 AND cm.IsActive = 1)
                OR (k.scope_type = 'district' AND dm.isdeleted = 0 AND dm.IsActive = 1))",
            new { hash = HashKey(key!) });
        if (row is not { } r) return null;
        await c.ExecuteAsync(@"UPDATE website_api_keys SET last_used_utc = UTC_TIMESTAMP()
            WHERE pk_website_api_key_id = @Id AND (last_used_utc IS NULL OR last_used_utc < UTC_TIMESTAMP() - INTERVAL 5 MINUTE)",
            new { r.Id });
        return (r.Scope, r.ScopeId);
    }

    // ── document switch (admin) ──────────────────────────────────────────

    private static string DocScope(string scope) => scope == "club"
        ? "d.fk_club_id = @scopeId AND d.fk_district_id IS NULL"
        : "d.fk_district_id = @scopeId";

    public sealed record DocRow(int Id, string Title, DateTime PublishDateTime, DateTime ExpiryDateTime, bool IsPublicOnWebsite);

    public async Task<IEnumerable<DocRow>> ListDocumentsAsync(string scope, int scopeId)
    {
        await using var c = Conn();
        return await c.QueryAsync<DocRow>($@"
            SELECT d.pk_document_id AS Id, d.Title, d.PublishDateTime, d.ExpiryDateTime,
                   d.IsPublicOnWebsite AS IsPublicOnWebsite
            FROM club_documents d WHERE {DocScope(scope)} AND d.isdeleted = 0
            ORDER BY d.PublishDateTime DESC LIMIT 500", new { scopeId });
    }

    public async Task<bool> SetDocumentPublicAsync(string scope, int scopeId, int documentId, bool isPublic)
    {
        await using var c = Conn();
        // affected-rows counts matched rows only if the value changes, so check existence separately
        var exists = await c.ExecuteScalarAsync<int>($@"SELECT COUNT(*) FROM club_documents d
            WHERE d.pk_document_id = @documentId AND {DocScope(scope)} AND d.isdeleted = 0", new { documentId, scopeId });
        if (exists == 0) return false;
        await c.ExecuteAsync("UPDATE club_documents SET IsPublicOnWebsite = @v WHERE pk_document_id = @documentId",
            new { v = isPublic ? 1 : 0, documentId });
        return true;
    }

    // ── public-safe data (connector) ─────────────────────────────────────

    public sealed record EventItem(int Id, string Title, string? Description, string? Venue, DateTime EventDate, string? ImagePath, string? RegistrationLink);

    public async Task<IEnumerable<EventItem>> EventsAsync(string scope, int scopeId, int limit)
    {
        await using var c = Conn();
        var col = scope == "club" ? "fk_club_id" : "fk_district_id";
        var rows = await c.QueryAsync<EventItem>($@"
            SELECT pk_upcoming_event_id AS Id, Title, Description, EventVenue AS Venue, EventDate,
                   CASE WHEN ImagePath IS NULL OR ImagePath = '' THEN NULL
                        WHEN ImagePath LIKE '/%' THEN ImagePath
                        WHEN fk_district_id IS NOT NULL THEN CONCAT('/Documents/Event/Group', fk_district_id, '/', ImagePath)
                        ELSE CONCAT('/Documents/Event/Group', fk_club_id, '/', ImagePath) END AS ImagePath,
                   RegistrationLink
            FROM upcoming_events
            WHERE {col} = @scopeId AND isdeleted = 0
              AND PublishDate <= NOW() AND ExpiryDate >= NOW() AND EventDate >= CURDATE()
            ORDER BY EventDate ASC LIMIT @limit", new { scopeId, limit });
        return rows.Select(e => e with { Description = PlainText(e.Description) });
    }

    public sealed record OfficerItem(string Name, string? Designation, string? Group, string? ClubName, string? PhotoPath);

    public async Task<IEnumerable<OfficerItem>> OfficersAsync(string scope, int scopeId)
    {
        await using var c = Conn();
        var year = await c.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1") ?? 0;
        if (scope == "club")
            return await c.QueryAsync<OfficerItem>(@"
                SELECT m.MemberName AS Name, d.designation_name AS Designation, CAST(NULL AS CHAR) AS `Group`, CAST(NULL AS CHAR) AS ClubName,
                       CASE WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                            WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                            ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1)) END AS PhotoPath
                FROM board_of_directors bd
                JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
                JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
                WHERE bd.fk_club_id = @scopeId AND bd.fk_year_id = @year AND bd.isdeleted = 0 AND m.isdeleted = 0
                ORDER BY CASE bd.fk_designation_id WHEN 1 THEN 0 WHEN 2 THEN 1 ELSE 2 END,
                         COALESCE(bd.sort_order, 9999), d.sort_order, bd.pk_board_director_id",
                new { scopeId, year });

        var list = new List<OfficerItem>();
        var governor = await c.QueryFirstOrDefaultAsync<OfficerItem>($@"
            SELECT {DistrictGovernorSql.Name} AS Name, 'District Governor' AS Designation, CAST(NULL AS CHAR) AS `Group`,
                   CAST(NULL AS CHAR) AS ClubName, {DistrictGovernorSql.Photo} AS PhotoPath
            FROM district_governors g {DistrictGovernorSql.JoinMember}
            WHERE g.fk_district_id = @scopeId AND g.fk_year_id = @year AND g.isdeleted = 0 LIMIT 1",
            new { scopeId, year });
        if (governor != null) list.Add(governor);
        list.AddRange(await c.QueryAsync<OfficerItem>(@"
            SELECT CASE WHEN COALESCE(gm.fk_member_id, 0) > 0 THEN m.MemberName ELSE gm.name END AS Name,
                   gm.district_designation AS Designation, g.group_name AS `Group`,
                   CASE WHEN COALESCE(gm.fk_member_id, 0) > 0 THEN cm.ClubName ELSE gm.club_name END AS ClubName,
                   CASE WHEN COALESCE(gm.fk_member_id, 0) > 0 AND m.ProfilePhotoPath IS NOT NULL AND m.ProfilePhotoPath <> '' THEN
                             CASE WHEN m.ProfilePhotoPath LIKE '/%' OR m.ProfilePhotoPath LIKE 'http%' THEN m.ProfilePhotoPath
                                  ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1)) END
                        ELSE NULL END AS PhotoPath
            FROM district_committee_group g
            JOIN district_committee_group_member gm ON gm.fk_group_id = g.id AND gm.is_active = 1 AND gm.isdeleted = 0
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = gm.fk_member_id AND m.isdeleted = 0
            LEFT JOIN club_master cm ON cm.pk_club_id = gm.fk_club_id
            WHERE g.fk_district_id = @scopeId AND g.fk_year_id = @year AND g.is_active = 1 AND g.isdeleted = 0
            ORDER BY g.sort_order, g.id, gm.sort_order, gm.id",
            new { scopeId, year }));
        return list.Where(o => !string.IsNullOrWhiteSpace(o.Name));
    }

    public sealed record NewsItem(int Id, string Title, DateTime PublishedAt, string? FilePath, string? LinkUrl);

    public async Task<IEnumerable<NewsItem>> NewsAsync(string scope, int scopeId, int limit)
    {
        await using var c = Conn();
        var where = scope == "club"
            ? "n.fk_club_id = @scopeId"
            : "n.fk_district_id = @scopeId AND COALESCE(n.fk_club_id, 0) = 0";
        // same publish/expiry gate as the club website (ClubWebsitePublicDataController.GetNewsletters)
        return await c.QueryAsync<NewsItem>($@"
            SELECT n.pk_newsletter_id AS Id, n.Title, n.PublishDateTime AS PublishedAt,
                   CASE WHEN n.FilePath IS NULL OR n.FilePath = '' THEN NULL
                        WHEN n.FilePath LIKE '/%' THEN n.FilePath
                        WHEN n.fk_district_id IS NOT NULL AND n.fk_district_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_district_id, '/', n.FilePath)
                        WHEN n.fk_club_id IS NOT NULL AND n.fk_club_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_club_id, '/', n.FilePath)
                        ELSE NULL END AS FilePath,
                   n.LinkUrl
            FROM newsletters n
            WHERE {where} AND COALESCE(n.isdeleted, 0) = 0 AND n.PublishDateTime <= NOW()
              AND (n.ExpiryDateTime IS NULL OR n.ExpiryDateTime <= n.PublishDateTime OR n.ExpiryDateTime >= NOW())
            ORDER BY n.PublishDateTime DESC LIMIT @limit", new { scopeId, limit });
    }

    public sealed record ProjectItem(int Id, string Title, string? Description, string? Location, DateTime? ProjectDate,
        string? Avenue, string? AreaOfFocus, string? ClubName, string? PhotoPath);

    public async Task<IEnumerable<ProjectItem>> ProjectsAsync(string scope, int scopeId, int limit)
    {
        await using var c = Conn();
        var year = await c.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
        var t = year is int y ? await _yearTables.ResolveExistingByYearIdAsync(c, y) : null;
        if (t == null) return Array.Empty<ProjectItem>();
        var clubFilter = scope == "club"
            ? "p.fk_club_id = @scopeId"
            : "p.fk_club_id IN (SELECT pk_club_id FROM club_master WHERE fk_district_id = @scopeId AND isdeleted = 0 AND IsActive = 1)";
        var suffix = t.YearLabel.Replace("-", "_");
        // table names come from the resolver (rotary_year_master), never from the request
        var rows = await c.QueryAsync<ProjectItem>($@"
            SELECT p.pk_project_id AS Id, p.title AS Title, p.description AS Description, p.location AS Location,
                   p.project_date AS ProjectDate, mm.ModuleName AS Avenue, aof.name AS AreaOfFocus,
                   (SELECT ClubName FROM club_master WHERE pk_club_id = p.fk_club_id) AS ClubName,
                   (SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                             CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk)
                                  ELSE CONCAT('{suffix}/Album', p.pk_project_id) END, '/', ph.image_path)
                    FROM `{t.PhotosTable}` ph WHERE ph.fk_project_id = p.pk_project_id
                    ORDER BY ph.is_primary DESC, ph.sort_order, ph.pk_photo_id LIMIT 1) AS PhotoPath
            FROM `{t.ProjectsTable}` p
            JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
            LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
            WHERE {clubFilter} AND p.isdeleted = 0 AND p.is_active = 1 AND mm.ModuleKey IN @Keys
              AND NOT (mm.ModuleKey IN ('community_service','public_image_initiative') AND p.project_type = 'ongoing_repeat')
            ORDER BY p.project_date DESC, p.pk_project_id DESC LIMIT @limit",
            new { scopeId, limit, Keys = ProjectModuleKeys });
        return rows.Select(p => p with { Description = PlainText(p.Description) });
    }

    // shortcut: no email or phone ever leaves through the connector ("show in all clubs" is in-ROW visibility, default on);
    // adding them needs a separate explicit "public website" opt-in per member.
    public sealed record MemberItem(string Name, string? PhotoPath, string? Classification);
    public sealed record ClubItem(int Id, string Name, string? City, string? MeetingDay, string? MeetingFrom, string? MeetingTo, string? MeetingAddress, string? Website);

    /// <summary>Club key: the club's members (name, photo, classification; never contact details).
    /// District key: the district's active clubs.</summary>
    public async Task<object> DirectoryAsync(string scope, int scopeId)
    {
        await using var c = Conn();
        if (scope == "district")
            return new
            {
                kind = "clubs",
                items = await c.QueryAsync<ClubItem>(@"
                    SELECT c.pk_club_id AS Id, c.ClubName AS Name, c.City, c.MeetingDay,
                           TIME_FORMAT(c.MeetingFromTime, '%H:%i') AS MeetingFrom, TIME_FORMAT(c.MeetingToTime, '%H:%i') AS MeetingTo,
                           c.MeetingAddress,
                           (SELECT COALESCE(NULLIF(w.ClientDomain, ''), w.Subdomain) FROM club_websites w
                            WHERE w.fk_club_id = c.pk_club_id AND w.isdeleted = 0 ORDER BY w.created_date DESC LIMIT 1) AS Website
                    FROM club_master c WHERE c.fk_district_id = @scopeId AND c.isdeleted = 0 AND c.IsActive = 1
                    ORDER BY c.ClubName", new { scopeId }),
            };

        return new
        {
            kind = "members",
            items = await c.QueryAsync<MemberItem>(@"
                SELECT m.MemberName AS Name,
                       CASE WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                            WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                            ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1)) END AS PhotoPath,
                       cm.ClassificationProfession AS Classification
                FROM club_members cm
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                WHERE cm.fk_club_id = @scopeId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
                ORDER BY m.MemberName", new { scopeId }),
        };
    }

    public sealed record DocumentItem(int Id, string Title, string? FilePath, string? FileName, DateTime PublishedAt);

    public async Task<IEnumerable<DocumentItem>> DocumentsAsync(string scope, int scopeId)
    {
        await using var c = Conn();
        return await c.QueryAsync<DocumentItem>($@"
            SELECT d.pk_document_id AS Id, d.Title,
                   CASE WHEN d.FilePath IS NULL OR d.FilePath = '' THEN NULL
                        WHEN d.FilePath LIKE '/%' THEN d.FilePath
                        WHEN d.fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', d.fk_district_id, '/', d.FilePath)
                        ELSE CONCAT('/Documents/documentsafe/Group', d.fk_club_id, '/', d.FilePath) END AS FilePath,
                   d.OriginalFileName AS FileName, d.PublishDateTime AS PublishedAt
            FROM club_documents d
            WHERE {DocScope(scope)} AND d.isdeleted = 0 AND d.IsPublicOnWebsite = 1
              AND d.PublishDateTime <= NOW() AND d.ExpiryDateTime >= NOW()
            ORDER BY d.PublishDateTime DESC LIMIT 200", new { scopeId });
    }
}
