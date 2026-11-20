using System.Text.Json;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public sealed class WebsitePageSummary
{
    public int Id { get; set; }
    public string Slug { get; set; } = "";
    public string Title { get; set; } = "";
    public bool IsPublished { get; set; }
    /// <summary>The draft differs from what the public site shows.</summary>
    public bool HasUnpublishedChanges { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? PublishedAt { get; set; }
    /// <summary>Only signed-in members of the club see it. Takes effect on save, not on publish.</summary>
    public bool MembersOnly { get; set; }
}

public sealed class WebsitePageDetail
{
    public int Id { get; set; }
    public string Slug { get; set; } = "";
    public string Title { get; set; } = "";
    public List<WebsiteSection> Sections { get; set; } = new();
    public bool IsPublished { get; set; }
    public bool HasUnpublishedChanges { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? PublishedAt { get; set; }
    public bool MembersOnly { get; set; }
}

public sealed class SaveWebsitePageDto
{
    public string? Slug { get; set; }
    public string? Title { get; set; }
    public List<WebsiteSection>? Sections { get; set; }
    public bool MembersOnly { get; set; }
}

public sealed class WebsiteMediaDto
{
    public int Id { get; set; }
    public string Url { get; set; } = "";
    public string FileName { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    /// <summary>Stored outside the web root; only reachable through a signed link handed to a signed-in member.</summary>
    public bool MembersOnly { get; set; }
    public string? ContentType { get; set; }
}

/// <summary>
/// Website builder storage: custom pages and the home layout (slug "home") for club and district sites, each with a
/// draft and a published copy, plus the site's media library. owner_type is 'club' or 'district'.
/// Times are UTC (UTC_TIMESTAMP()).
/// </summary>
public class WebsitePageService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly string _cs;

    public WebsitePageService(IConfiguration configuration) =>
        _cs = configuration.GetConnectionString("DefaultConnection")!;

    private MySqlConnection Conn() => new(_cs);

    public static List<WebsiteSection> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();
        try { return JsonSerializer.Deserialize<List<WebsiteSection>>(json, Json) ?? new(); }
        catch (JsonException) { return new(); }
    }

    private const string SummaryCols = @"pk_website_page_id AS Id, slug AS Slug, title AS Title,
        published_at IS NOT NULL AS IsPublished,
        (published_at IS NOT NULL AND (published_title <> title OR published_sections_json <> sections_json)) AS HasUnpublishedChanges,
        updated_at AS UpdatedAt, published_at AS PublishedAt, members_only AS MembersOnly";

    public async Task<List<WebsitePageSummary>> ListAsync(string ownerType, int ownerId)
    {
        await using var c = Conn();
        return (await c.QueryAsync<WebsitePageSummary>(
            $"SELECT {SummaryCols} FROM website_pages WHERE owner_type = @T AND owner_id = @O ORDER BY slug = 'home' DESC, title",
            new { T = ownerType, O = ownerId })).ToList();
    }

    public async Task<WebsitePageDetail?> GetAsync(string ownerType, int ownerId, int id)
    {
        await using var c = Conn();
        var row = await c.QueryFirstOrDefaultAsync<WebsitePageSummary>(
            $"SELECT {SummaryCols} FROM website_pages WHERE pk_website_page_id = @Id AND owner_type = @T AND owner_id = @O",
            new { Id = id, T = ownerType, O = ownerId });
        if (row == null) return null;
        var json = await c.ExecuteScalarAsync<string?>(
            "SELECT sections_json FROM website_pages WHERE pk_website_page_id = @Id", new { Id = id });
        return new WebsitePageDetail
        {
            Id = row.Id, Slug = row.Slug, Title = row.Title, Sections = Parse(json), IsPublished = row.IsPublished,
            HasUnpublishedChanges = row.HasUnpublishedChanges, UpdatedAt = row.UpdatedAt, PublishedAt = row.PublishedAt,
            MembersOnly = row.MembersOnly,
        };
    }

    /// <summary>Returns the new id, or null when the address is already used on this site.</summary>
    public async Task<int?> CreateAsync(string ownerType, int ownerId, string slug, string title, List<WebsiteSection> sections, bool membersOnly, int by)
    {
        await using var c = Conn();
        try
        {
            return await c.ExecuteScalarAsync<int>(@"
                INSERT INTO website_pages (owner_type, owner_id, slug, title, sections_json, members_only, created_by, created_at, updated_by, updated_at)
                VALUES (@T, @O, @Slug, @Title, @S, @M, @By, UTC_TIMESTAMP(), @By, UTC_TIMESTAMP());
                SELECT LAST_INSERT_ID();",
                new { T = ownerType, O = ownerId, Slug = slug, Title = title, S = JsonSerializer.Serialize(sections, Json), M = membersOnly, By = by });
        }
        catch (MySqlException ex) when (ex.ErrorCode == MySqlErrorCode.DuplicateKeyEntry) { return null; }
    }

    /// <summary>Saves the draft. False when the page is not on this site, null when the new address is taken.</summary>
    public async Task<bool?> UpdateDraftAsync(string ownerType, int ownerId, int id, string slug, string title, List<WebsiteSection> sections, bool membersOnly, int by)
    {
        await using var c = Conn();
        try
        {
            return await c.ExecuteAsync(@"
                UPDATE website_pages SET slug = @Slug, title = @Title, sections_json = @S, members_only = @M, updated_by = @By, updated_at = UTC_TIMESTAMP()
                WHERE pk_website_page_id = @Id AND owner_type = @T AND owner_id = @O",
                new { Id = id, T = ownerType, O = ownerId, Slug = slug, Title = title, S = JsonSerializer.Serialize(sections, Json), M = membersOnly, By = by }) > 0;
        }
        catch (MySqlException ex) when (ex.ErrorCode == MySqlErrorCode.DuplicateKeyEntry) { return null; }
    }

    public async Task<bool> PublishAsync(string ownerType, int ownerId, int id, bool publish, int by)
    {
        await using var c = Conn();
        var sql = publish
            ? @"UPDATE website_pages SET published_title = title, published_sections_json = sections_json,
                   published_at = UTC_TIMESTAMP(), updated_by = @By
                WHERE pk_website_page_id = @Id AND owner_type = @T AND owner_id = @O"
            : @"UPDATE website_pages SET published_title = NULL, published_sections_json = NULL, published_at = NULL, updated_by = @By
                WHERE pk_website_page_id = @Id AND owner_type = @T AND owner_id = @O";
        return await c.ExecuteAsync(sql, new { Id = id, T = ownerType, O = ownerId, By = by }) > 0;
    }

    public async Task<bool> DeleteAsync(string ownerType, int ownerId, int id)
    {
        await using var c = Conn();
        return await c.ExecuteAsync("DELETE FROM website_pages WHERE pk_website_page_id = @Id AND owner_type = @T AND owner_id = @O",
            new { Id = id, T = ownerType, O = ownerId }) > 0;
    }

    /// <summary>The published copy only; null when there is none.</summary>
    public async Task<(string Title, List<WebsiteSection> Sections, DateTime PublishedAt, bool MembersOnly)?> GetPublishedAsync(string ownerType, int ownerId, string slug)
    {
        await using var c = Conn();
        var row = await c.QueryFirstOrDefaultAsync<PublishedRow>(
            @"SELECT published_title AS Title, published_sections_json AS Sections, published_at AS At, members_only AS MembersOnly FROM website_pages
              WHERE owner_type = @T AND owner_id = @O AND slug = @Slug AND published_at IS NOT NULL",
            new { T = ownerType, O = ownerId, Slug = slug });
        if (row?.At is not DateTime at) return null;
        return (row.Title ?? "", Parse(row.Sections), at, row.MembersOnly);
    }

    private sealed class PublishedRow { public string? Title { get; set; } public string? Sections { get; set; } public DateTime? At { get; set; } public bool MembersOnly { get; set; } }

    // ── Media library ──────────────────────────────────────────────────────────────────────────────────────

    public async Task<List<WebsiteMediaDto>> ListMediaAsync(string ownerType, int ownerId)
    {
        await using var c = Conn();
        return (await c.QueryAsync<WebsiteMediaDto>(
            @"SELECT pk_website_media_id AS Id, url AS Url, file_name AS FileName, created_at AS CreatedAt,
                     members_only AS MembersOnly, content_type AS ContentType
              FROM website_media WHERE owner_type = @T AND owner_id = @O ORDER BY pk_website_media_id DESC LIMIT 500",
            new { T = ownerType, O = ownerId })).ToList();
    }

    public async Task<int> AddMediaAsync(string ownerType, int ownerId, string url, string fileName, bool membersOnly, string contentType, int by)
    {
        await using var c = Conn();
        return await c.ExecuteScalarAsync<int>(@"
            INSERT INTO website_media (owner_type, owner_id, url, file_name, members_only, content_type, created_by, created_at)
            VALUES (@T, @O, @Url, @F, @M, @CT, @By, UTC_TIMESTAMP()); SELECT LAST_INSERT_ID();",
            new { T = ownerType, O = ownerId, Url = url, F = fileName, M = membersOnly, CT = contentType, By = by });
    }

    /// <summary>One media row with its owner, or null.</summary>
    public async Task<MediaRow?> GetMediaAsync(int id)
    {
        await using var c = Conn();
        return await c.QueryFirstOrDefaultAsync<MediaRow>(
            @"SELECT owner_type AS OwnerType, owner_id AS OwnerId, pk_website_media_id AS Id, url AS Url, file_name AS FileName,
                     members_only AS MembersOnly, content_type AS ContentType
              FROM website_media WHERE pk_website_media_id = @Id", new { Id = id });
    }

    public sealed class MediaRow
    {
        public string OwnerType { get; set; } = "";
        public int OwnerId { get; set; }
        public int Id { get; set; }
        public string Url { get; set; } = "";
        public string FileName { get; set; } = "";
        public bool MembersOnly { get; set; }
        public string? ContentType { get; set; }
    }

    /// <summary>Removes the row and returns its URL so the caller can delete the file; null when not on this site.</summary>
    public async Task<string?> DeleteMediaAsync(string ownerType, int ownerId, int id)
    {
        await using var c = Conn();
        var url = await c.ExecuteScalarAsync<string?>(
            "SELECT url FROM website_media WHERE pk_website_media_id = @Id AND owner_type = @T AND owner_id = @O",
            new { Id = id, T = ownerType, O = ownerId });
        if (url == null) return null;
        await c.ExecuteAsync("DELETE FROM website_media WHERE pk_website_media_id = @Id", new { Id = id });
        return url;
    }
}
