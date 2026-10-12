using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class ClubBannerService : IClubBannerService
{
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;

    public ClubBannerService(IConfiguration configuration, IWebHostEnvironment env)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _env = env;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // Inline SQL (mirrors sp_club_banner_get_by_club) so we can return the new document_path + link_url
    // columns without editing the privilege-locked SP. NULL-safe isdeleted filter for migrated rows.
    private const string BannerSelect = @"
        SELECT b.pk_club_website_banner_id AS Id,
               b.fk_club_id AS ClubId,
               b.fk_year_id AS YearId,
               y.YearLabel,
               CASE
                   WHEN b.banner_image_path IS NULL OR b.banner_image_path = '' THEN NULL
                   WHEN b.banner_image_path LIKE '/%' THEN b.banner_image_path
                   ELSE CONCAT('/uploads/banner/', b.banner_image_path)
               END AS BannerImagePath,
               CASE
                   WHEN b.document_path IS NULL OR b.document_path = '' THEN NULL
                   WHEN b.document_path LIKE '/%' THEN b.document_path
                   WHEN b.document_path LIKE '%/%' THEN CONCAT('/', b.document_path)
                   ELSE CONCAT('/uploads/banner/', b.document_path)
               END AS DocumentPath,
               b.link_url AS LinkUrl,
               b.description AS Description,
               b.sort_order AS SortOrder,
               b.is_active AS IsActive
        FROM club_website_banner b
        JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id";

    public async Task<List<ClubBannerDto>> GetByClubAsync(int clubId, int yearId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<ClubBannerDto>(
            BannerSelect + @" WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId
                              AND COALESCE(b.isdeleted,0) = 0 ORDER BY b.sort_order ASC",
            new { ClubId = clubId, YearId = yearId })).ToList();
    }

    public async Task<ClubBannerDto?> GetByIdAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.QueryFirstOrDefaultAsync<ClubBannerDto>(
            BannerSelect + " WHERE b.pk_club_website_banner_id = @Id AND COALESCE(b.isdeleted,0) = 0",
            new { Id = id });
    }

    public async Task<int> CreateAsync(int clubId, CreateClubBannerDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var newId = await connection.ExecuteScalarAsync<int>(
            "sp_club_banner_create",
            new
            {
                p_ClubId = clubId,
                p_YearId = dto.YearId,
                p_BannerImagePath = dto.BannerImagePath,
                p_Description = dto.Description,
                p_SortOrder = dto.SortOrder,
                p_IsActive = dto.IsActive ? 1 : 0,
                p_CreatedBy = createdBy
            },
            commandType: CommandType.StoredProcedure);
        // document_path + link_url aren't in the SP — write them in a follow-up UPDATE.
        // A banner points to EITHER a document OR a link, never both (or neither).
        await connection.ExecuteAsync(
            @"UPDATE club_website_banner SET document_path = @Doc, link_url = @Link
              WHERE pk_club_website_banner_id = @Id",
            new
            {
                Doc = string.IsNullOrWhiteSpace(dto.DocumentPath) ? null : dto.DocumentPath.Trim(),
                Link = string.IsNullOrWhiteSpace(dto.LinkUrl) ? null : dto.LinkUrl.Trim(),
                Id = newId
            });
        return newId;
    }

    public async Task UpdateAsync(int id, UpdateClubBannerDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_club_banner_update",
            new
            {
                p_Id = id,
                p_BannerImagePath = dto.BannerImagePath,
                p_Description = dto.Description,
                p_SortOrder = dto.SortOrder,
                p_IsActive = dto.IsActive ? 1 : 0,
                p_ModifiedBy = modifiedBy
            },
            commandType: CommandType.StoredProcedure);
        // document_path + link_url aren't in the SP — write them (mutually exclusive) in a follow-up UPDATE.
        await connection.ExecuteAsync(
            @"UPDATE club_website_banner SET document_path = @Doc, link_url = @Link
              WHERE pk_club_website_banner_id = @Id",
            new
            {
                Doc = string.IsNullOrWhiteSpace(dto.DocumentPath) ? null : dto.DocumentPath.Trim(),
                Link = string.IsNullOrWhiteSpace(dto.LinkUrl) ? null : dto.LinkUrl.Trim(),
                Id = id
            });
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_club_banner_delete",
            new { p_Id = id, p_DeletedBy = deletedBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task ReorderAsync(int id1, int id2)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_club_banner_reorder",
            new { p_Id1 = id1, p_Id2 = id2 },
            commandType: CommandType.StoredProcedure);
    }

    public async Task<string> UploadImageAsync(IFormFile file)
    {
        var uploadsPath = Path.Combine(_env.WebRootPath, "uploads", "banner");
        Directory.CreateDirectory(uploadsPath);

        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(uploadsPath, fileName);

        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);

        // Store filename only. Full URL is reconstructed via SQL CONCAT('/uploads/banner/', ...) on read.
        return fileName;
    }

    // Optional document a banner can point to (alternative to a link). Stored alongside banner images
    // under /uploads/banner/; filename-only, URL rebuilt on read like the image.
    public async Task<string> UploadDocumentAsync(IFormFile file)
    {
        var uploadsPath = Path.Combine(_env.WebRootPath, "uploads", "banner");
        Directory.CreateDirectory(uploadsPath);

        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(uploadsPath, fileName);

        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);
        return fileName;
    }
}
