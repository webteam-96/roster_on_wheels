using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class WeblinkService : IWeblinkService
{
    private readonly string _connectionString;

    public WeblinkService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // ── Get Weblinks (flat list) ────────────────────────────────────────

    public async Task<IEnumerable<WeblinkListDto>> GetWeblinksAsync(int clubId, int? parentId = null, int? districtId = null)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var ownerClause = districtId.HasValue ? "w.fk_district_id = @OwnerId" : "w.fk_club_id = @OwnerId";
        var ownerId = districtId.HasValue ? districtId.Value : clubId;

        string sql;
        object parameters;

        // Common CASE expressions for reconstructing full URLs from filename-only DB values
        string LogoPathCase() => @"
                       CASE
                           WHEN w.LogoPath IS NULL OR w.LogoPath = '' THEN NULL
                           WHEN w.LogoPath LIKE '/%' THEN w.LogoPath
                           WHEN w.fk_district_id IS NOT NULL THEN CONCAT('/Documents/Weblink/Group', w.fk_district_id, '/', w.LogoPath)
                           ELSE CONCAT('/Documents/Weblink/Group', w.fk_club_id, '/', w.LogoPath)
                       END AS LogoPath";
        string BannerPathCase() => @"
                       CASE
                           WHEN w.BannerPath IS NULL OR w.BannerPath = '' THEN NULL
                           WHEN w.BannerPath LIKE '/%' THEN w.BannerPath
                           WHEN w.fk_district_id IS NOT NULL THEN CONCAT('/Documents/Weblink/Group', w.fk_district_id, '/', w.BannerPath)
                           ELSE CONCAT('/Documents/Weblink/Group', w.fk_club_id, '/', w.BannerPath)
                       END AS BannerPath";
        string PdfPathCase() => @"
                       CASE
                           WHEN w.PdfPath IS NULL OR w.PdfPath = '' THEN NULL
                           WHEN w.PdfPath LIKE '/%' THEN w.PdfPath
                           WHEN w.fk_district_id IS NOT NULL THEN CONCAT('/Documents/Weblink/Group', w.fk_district_id, '/', w.PdfPath)
                           ELSE CONCAT('/Documents/Weblink/Group', w.fk_club_id, '/', w.PdfPath)
                       END AS PdfPath";

        if (parentId == null)
        {
            sql = $@"SELECT w.pk_weblink_id AS Id, w.fk_club_id AS ClubId, w.fk_parent_id AS ParentId,
                           w.Level, w.Title, w.Writeup,
                           {LogoPathCase()},
                           {BannerPathCase()},
                           w.LinkType, w.LinkUrl,
                           {PdfPathCase()},
                           w.YoutubeUrl, w.ButtonText,
                           w.SortOrder, w.IsActive,
                           (SELECT COUNT(*) FROM weblinks c WHERE c.fk_parent_id = w.pk_weblink_id AND c.isdeleted = 0) AS ChildCount
                    FROM weblinks w
                    WHERE {ownerClause} AND w.fk_parent_id IS NULL AND w.isdeleted = 0
                    ORDER BY w.SortOrder, w.pk_weblink_id";
            parameters = new { OwnerId = ownerId };
        }
        else
        {
            sql = $@"SELECT w.pk_weblink_id AS Id, w.fk_club_id AS ClubId, w.fk_parent_id AS ParentId,
                           w.Level, w.Title, w.Writeup,
                           {LogoPathCase()},
                           {BannerPathCase()},
                           w.LinkType, w.LinkUrl,
                           {PdfPathCase()},
                           w.YoutubeUrl, w.ButtonText,
                           w.SortOrder, w.IsActive,
                           (SELECT COUNT(*) FROM weblinks c WHERE c.fk_parent_id = w.pk_weblink_id AND c.isdeleted = 0) AS ChildCount
                    FROM weblinks w
                    WHERE {ownerClause} AND w.fk_parent_id = @ParentId AND w.isdeleted = 0
                    ORDER BY w.SortOrder, w.pk_weblink_id";
            parameters = new { OwnerId = ownerId, ParentId = parentId };
        }

        return await connection.QueryAsync<WeblinkListDto>(sql, parameters);
    }

    // ── Get Weblink Tree ────────────────────────────────────────────────

    public async Task<List<WeblinkTreeDto>> GetWeblinkTreeAsync(int clubId, int? districtId = null)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var ownerClause = districtId.HasValue ? "fk_district_id = @OwnerId" : "fk_club_id = @OwnerId";
        var ownerId = districtId.HasValue ? districtId.Value : clubId;

        var allWeblinks = (await connection.QueryAsync<WeblinkTreeDto>(
            $@"SELECT pk_weblink_id AS Id, fk_parent_id AS ParentId, Level, Title, Writeup,
                     CASE
                         WHEN LogoPath IS NULL OR LogoPath = '' THEN NULL
                         WHEN LogoPath LIKE '/%' THEN LogoPath
                         WHEN fk_district_id IS NOT NULL THEN CONCAT('/Documents/Weblink/Group', fk_district_id, '/', LogoPath)
                         ELSE CONCAT('/Documents/Weblink/Group', fk_club_id, '/', LogoPath)
                     END AS LogoPath,
                     CASE
                         WHEN BannerPath IS NULL OR BannerPath = '' THEN NULL
                         WHEN BannerPath LIKE '/%' THEN BannerPath
                         WHEN fk_district_id IS NOT NULL THEN CONCAT('/Documents/Weblink/Group', fk_district_id, '/', BannerPath)
                         ELSE CONCAT('/Documents/Weblink/Group', fk_club_id, '/', BannerPath)
                     END AS BannerPath,
                     LinkType, LinkUrl,
                     CASE
                         WHEN PdfPath IS NULL OR PdfPath = '' THEN NULL
                         WHEN PdfPath LIKE '/%' THEN PdfPath
                         WHEN fk_district_id IS NOT NULL THEN CONCAT('/Documents/Weblink/Group', fk_district_id, '/', PdfPath)
                         ELSE CONCAT('/Documents/Weblink/Group', fk_club_id, '/', PdfPath)
                     END AS PdfPath,
                     YoutubeUrl, ButtonText,
                     SortOrder, IsActive
              FROM weblinks
              WHERE {ownerClause} AND isdeleted = 0 AND IsActive = 1
              ORDER BY SortOrder, pk_weblink_id",
            new { OwnerId = ownerId })).ToList();

        // Build tree in C#
        var lookup = allWeblinks.ToLookup(w => w.ParentId);

        foreach (var weblink in allWeblinks)
        {
            weblink.Children = lookup[weblink.Id].ToList();
        }

        // Return root-level items. A weblink is a "root" if:
        //   1. its ParentId is NULL (the canonical root case), OR
        //   2. its ParentId is 0 (legacy migrated rows where NULL was stored as 0), OR
        //   3. its parent isn't in the current result set — i.e. the parent row
        //      belongs to a different club/scope/RI and was excluded by the
        //      `{ownerClause}` filter above. Without this, every club whose
        //      migrated weblinks point to a missing-from-this-scope parent
        //      (e.g. a global root with pk_weblink_id=1) returns an empty tree
        //      even though the children are perfectly valid + active.
        var idsInResult = new HashSet<int>(allWeblinks.Select(w => w.Id));
        return allWeblinks
            .Where(w => w.ParentId == null
                        || w.ParentId == 0
                        || !idsInResult.Contains(w.ParentId.Value))
            .ToList();
    }

    // ── Create Weblink ──────────────────────────────────────────────────

    public async Task<WeblinkListDto> CreateWeblinkAsync(int clubId, CreateWeblinkDto dto, IFormFile? logo, IFormFile? banner, IFormFile? pdf, int userId, IWebHostEnvironment env, int? districtId = null)
    {
        UrlValidator.ValidateWeblinkUrls(dto.LinkType, dto.LinkUrl, dto.YoutubeUrl);
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Determine level
        int level = 1;
        if (dto.ParentId != null)
        {
            var parentLevel = await connection.ExecuteScalarAsync<int?>(
                "SELECT Level FROM weblinks WHERE pk_weblink_id = @ParentId AND isdeleted = 0",
                new { dto.ParentId });

            if (parentLevel == null)
                throw new KeyNotFoundException("Parent weblink not found.");

            level = parentLevel.Value + 1;

            if (level > 3)
                throw new InvalidOperationException("Maximum nesting level is 3.");
        }

        // Handle file uploads
        var fileOwnerId = districtId ?? clubId;
        string? logoPath = null;
        string? bannerPath = null;
        string? pdfPath = null;

        if (logo != null)
            logoPath = await SaveFileAsync(fileOwnerId, logo, "logo", env);

        if (banner != null && level == 1)
            bannerPath = await SaveFileAsync(fileOwnerId, banner, "banner", env);

        if (pdf != null && dto.LinkType == "PDF")
            pdfPath = await SaveFileAsync(fileOwnerId, pdf, "pdf", env);

        var id = await connection.ExecuteScalarAsync<int>(
            @"INSERT INTO weblinks (fk_club_id, fk_district_id, fk_parent_id, Level, Title, Writeup, LogoPath, BannerPath,
                     LinkType, LinkUrl, PdfPath, YoutubeUrl, ButtonText, SortOrder, IsActive,
                     created_by, created_date, isdeleted)
              VALUES (@ClubId, @DistrictId, @ParentId, @Level, @Title, @Writeup, @LogoPath, @BannerPath,
                     @LinkType, @LinkUrl, @PdfPath, @YoutubeUrl, @ButtonText, @SortOrder, 1,
                     @UserId, NOW(), 0);
              SELECT LAST_INSERT_ID();",
            new
            {
                ClubId = districtId.HasValue ? 0 : clubId,
                DistrictId = districtId,
                dto.ParentId,
                Level = level,
                dto.Title,
                dto.Writeup,
                LogoPath = logoPath,
                BannerPath = bannerPath,
                dto.LinkType,
                dto.LinkUrl,
                PdfPath = pdfPath,
                dto.YoutubeUrl,
                dto.ButtonText,
                dto.SortOrder,
                UserId = userId
            });

        // Reconstruct full URLs for response (DB stores filename only)
        string? BuildFullPath(string? filename) =>
            string.IsNullOrEmpty(filename) ? null :
            filename.StartsWith("/") ? filename :
            $"/Documents/Weblink/Group{fileOwnerId}/{filename}";

        return new WeblinkListDto
        {
            Id = id,
            ClubId = districtId.HasValue ? 0 : clubId,
            ParentId = dto.ParentId,
            Level = level,
            Title = dto.Title,
            Writeup = dto.Writeup,
            LogoPath = BuildFullPath(logoPath),
            BannerPath = BuildFullPath(bannerPath),
            LinkType = dto.LinkType,
            LinkUrl = dto.LinkUrl,
            PdfPath = BuildFullPath(pdfPath),
            YoutubeUrl = dto.YoutubeUrl,
            ButtonText = dto.ButtonText,
            SortOrder = dto.SortOrder,
            IsActive = true,
            ChildCount = 0
        };
    }

    // ── Update Weblink ──────────────────────────────────────────────────

    public async Task<WeblinkListDto> UpdateWeblinkAsync(int clubId, int weblinkId, UpdateWeblinkDto dto, IFormFile? logo, IFormFile? banner, IFormFile? pdf, int userId, IWebHostEnvironment env, int? districtId = null)
    {
        UrlValidator.ValidateWeblinkUrls(dto.LinkType, dto.LinkUrl, dto.YoutubeUrl);
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var ownerClause = districtId.HasValue ? "fk_district_id = @OwnerId" : "fk_club_id = @OwnerId";
        var ownerId = districtId.HasValue ? districtId.Value : clubId;

        var existing = await connection.QueryFirstOrDefaultAsync<dynamic>(
            $@"SELECT pk_weblink_id, fk_club_id, fk_parent_id, Level,
                      LogoPath AS LogoPathRaw, BannerPath AS BannerPathRaw, PdfPath AS PdfPathRaw,
                      CASE
                          WHEN LogoPath IS NULL OR LogoPath = '' THEN NULL
                          WHEN LogoPath LIKE '/%' THEN LogoPath
                          WHEN fk_district_id IS NOT NULL THEN CONCAT('/Documents/Weblink/Group', fk_district_id, '/', LogoPath)
                          ELSE CONCAT('/Documents/Weblink/Group', fk_club_id, '/', LogoPath)
                      END AS LogoPathFull,
                      CASE
                          WHEN BannerPath IS NULL OR BannerPath = '' THEN NULL
                          WHEN BannerPath LIKE '/%' THEN BannerPath
                          WHEN fk_district_id IS NOT NULL THEN CONCAT('/Documents/Weblink/Group', fk_district_id, '/', BannerPath)
                          ELSE CONCAT('/Documents/Weblink/Group', fk_club_id, '/', BannerPath)
                      END AS BannerPathFull,
                      CASE
                          WHEN PdfPath IS NULL OR PdfPath = '' THEN NULL
                          WHEN PdfPath LIKE '/%' THEN PdfPath
                          WHEN fk_district_id IS NOT NULL THEN CONCAT('/Documents/Weblink/Group', fk_district_id, '/', PdfPath)
                          ELSE CONCAT('/Documents/Weblink/Group', fk_club_id, '/', PdfPath)
                      END AS PdfPathFull
              FROM weblinks WHERE pk_weblink_id = @Id AND {ownerClause} AND isdeleted = 0",
            new { Id = weblinkId, OwnerId = ownerId });

        if (existing == null)
            throw new KeyNotFoundException("Weblink not found.");

        // Raw values (filename-only after migration) — what gets written back to DB
        string? logoPath = (string?)existing.LogoPathRaw;
        string? bannerPath = (string?)existing.BannerPathRaw;
        string? pdfPath = (string?)existing.PdfPathRaw;
        // Reconstructed full URLs — used only for disk-delete of the old files
        string? logoPathFull = (string?)existing.LogoPathFull;
        string? bannerPathFull = (string?)existing.BannerPathFull;
        string? pdfPathFull = (string?)existing.PdfPathFull;
        int level = (int)existing.Level;
        var fileOwnerId = districtId ?? clubId;

        if (logo != null)
        {
            DeleteFileFromDisk(logoPathFull, env);
            logoPath = await SaveFileAsync(fileOwnerId, logo, "logo", env);
        }

        if (banner != null && level == 1)
        {
            DeleteFileFromDisk(bannerPathFull, env);
            bannerPath = await SaveFileAsync(fileOwnerId, banner, "banner", env);
        }

        if (pdf != null && dto.LinkType == "PDF")
        {
            DeleteFileFromDisk(pdfPathFull, env);
            pdfPath = await SaveFileAsync(fileOwnerId, pdf, "pdf", env);
        }

        // If LinkType changed away from PDF, clear PdfPath
        if (dto.LinkType != "PDF" && pdfPath != null)
        {
            DeleteFileFromDisk(pdfPathFull, env);
            pdfPath = null;
        }

        await connection.ExecuteAsync(
            @"UPDATE weblinks
              SET Title = @Title, Writeup = @Writeup, LogoPath = @LogoPath, BannerPath = @BannerPath,
                  LinkType = @LinkType, LinkUrl = @LinkUrl, PdfPath = @PdfPath, YoutubeUrl = @YoutubeUrl,
                  ButtonText = @ButtonText, SortOrder = @SortOrder, IsActive = @IsActive,
                  modified_by = @UserId, modified_date = NOW()
              WHERE pk_weblink_id = @Id AND isdeleted = 0",
            new
            {
                Id = weblinkId,
                dto.Title,
                dto.Writeup,
                LogoPath = logoPath,
                BannerPath = bannerPath,
                dto.LinkType,
                dto.LinkUrl,
                PdfPath = pdfPath,
                dto.YoutubeUrl,
                dto.ButtonText,
                dto.SortOrder,
                IsActive = dto.IsActive ? 1 : 0,
                UserId = userId
            });

        var childCount = await connection.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM weblinks WHERE fk_parent_id = @Id AND isdeleted = 0",
            new { Id = weblinkId });

        // Reconstruct full URLs for response (DB stores filename only)
        string? BuildFullPath(string? filename) =>
            string.IsNullOrEmpty(filename) ? null :
            filename.StartsWith("/") ? filename :
            $"/Documents/Weblink/Group{fileOwnerId}/{filename}";

        return new WeblinkListDto
        {
            Id = weblinkId,
            ClubId = districtId.HasValue ? 0 : clubId,
            ParentId = (int?)existing.fk_parent_id,
            Level = level,
            Title = dto.Title,
            Writeup = dto.Writeup,
            LogoPath = BuildFullPath(logoPath),
            BannerPath = BuildFullPath(bannerPath),
            LinkType = dto.LinkType,
            LinkUrl = dto.LinkUrl,
            PdfPath = BuildFullPath(pdfPath),
            YoutubeUrl = dto.YoutubeUrl,
            ButtonText = dto.ButtonText,
            SortOrder = dto.SortOrder,
            IsActive = dto.IsActive,
            ChildCount = childCount
        };
    }

    // ── Delete Weblink (recursive soft delete) ──────────────────────────

    public async Task DeleteWeblinkAsync(int weblinkId, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Get all direct child IDs first (for grandchild deletion)
        var childIds = (await connection.QueryAsync<int>(
            "SELECT pk_weblink_id FROM weblinks WHERE fk_parent_id = @Id AND isdeleted = 0",
            new { Id = weblinkId })).ToList();

        // Soft delete grandchildren (children of children)
        if (childIds.Any())
        {
            await connection.ExecuteAsync(
                @"UPDATE weblinks SET isdeleted = 1, deleted_by = @UserId, deleted_date = NOW()
                  WHERE fk_parent_id IN @ChildIds AND isdeleted = 0",
                new { ChildIds = childIds, UserId = userId });
        }

        // Soft delete the weblink itself and its direct children
        await connection.ExecuteAsync(
            @"UPDATE weblinks SET isdeleted = 1, deleted_by = @UserId, deleted_date = NOW()
              WHERE (pk_weblink_id = @Id OR fk_parent_id = @Id) AND isdeleted = 0",
            new { Id = weblinkId, UserId = userId });
    }

    // ── Toggle Active ───────────────────────────────────────────────────

    public async Task ToggleActiveAsync(int weblinkId, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        await connection.ExecuteAsync(
            @"UPDATE weblinks SET IsActive = NOT IsActive, modified_by = @UserId, modified_date = NOW()
              WHERE pk_weblink_id = @Id AND isdeleted = 0",
            new { Id = weblinkId, UserId = userId });
    }

    // ── File Helpers ────────────────────────────────────────────────────

    private static async Task<string> SaveFileAsync(int ownerId, IFormFile file, string prefix, IWebHostEnvironment env)
    {
        var groupFolder = $"Group{ownerId}";
        var uploadsPath = Path.Combine(env.WebRootPath, "Documents", "Weblink", groupFolder);
        Directory.CreateDirectory(uploadsPath);

        // IIS/URL-safe filename: replace spaces/'+'/special chars with '_' (IIS 404s on '+' etc. in the path).
        var originalBaseName = System.Text.RegularExpressions.Regex.Replace(Path.GetFileNameWithoutExtension(file.FileName), @"[^A-Za-z0-9\-]+", "_").Trim('_');
        if (string.IsNullOrEmpty(originalBaseName)) originalBaseName = "file";
        var extension = Path.GetExtension(file.FileName);
        var now = DateTime.Now;
        var timestamp = now.ToString("ddMMyyyyhhmmsstt");
        var fileName = $"{prefix}_{originalBaseName}_{Guid.NewGuid().ToString("N")[..8]}{timestamp}{extension}";
        var fullPath = Path.Combine(uploadsPath, fileName);

        using var stream = new FileStream(fullPath, FileMode.Create);
        await file.CopyToAsync(stream);

        // Store filename only — full URL reconstructed via SQL CONCAT on read
        return fileName;
    }

    private static void DeleteFileFromDisk(string? relativePath, IWebHostEnvironment env)
    {
        if (string.IsNullOrEmpty(relativePath)) return;
        var fullPath = Path.Combine(env.WebRootPath, relativePath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
        if (File.Exists(fullPath))
            File.Delete(fullPath);
    }
}
