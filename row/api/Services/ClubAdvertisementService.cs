using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class ClubAdvertisementService : IClubAdvertisementService
{
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;

    public ClubAdvertisementService(IConfiguration configuration, IWebHostEnvironment env)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _env = env;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<List<ClubAdvertisementDto>> GetByClubAsync(int clubId, int yearId)
    {
        // Inline SQL (mirrors sp_club_advertisement_get_by_club) so we can use a NULL-safe
        // COALESCE(isdeleted,0)=0 filter — migrated rows have isdeleted IS NULL, which the SP's
        // `isdeleted = 0` silently excluded. Also sidesteps the SYSTEM_USER SP-replace privilege issue.
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<ClubAdvertisementDto>(@"
            SELECT a.pk_club_website_advertisement_id AS Id,
                   a.fk_club_id AS ClubId,
                   a.fk_year_id AS YearId,
                   y.YearLabel,
                   CASE
                       WHEN a.advertisement_image_path IS NULL OR a.advertisement_image_path = '' THEN NULL
                       WHEN a.advertisement_image_path LIKE '/%' THEN a.advertisement_image_path
                       -- Legacy/migrated rows can carry an already-relative nested path (e.g.
                       -- 'Documents/ClubAdvertisement/xyz.jpg') rather than a bare filename — blindly
                       -- prefixing '/uploads/advertisement/' onto that produced a non-existent, double-
                       -- nested path. Only bare filenames (no '/') get that prefix; anything else that
                       -- already looks like a path just gets a leading slash.
                       WHEN a.advertisement_image_path LIKE '%/%' THEN CONCAT('/', a.advertisement_image_path)
                       ELSE CONCAT('/uploads/advertisement/', a.advertisement_image_path)
                   END AS AdvertisementImagePath,
                   CASE
                       WHEN a.document_path IS NULL OR a.document_path = '' THEN NULL
                       WHEN a.document_path LIKE '/%' THEN a.document_path
                       WHEN a.document_path LIKE '%/%' THEN CONCAT('/', a.document_path)
                       ELSE CONCAT('/uploads/advertisement/', a.document_path)
                   END AS DocumentPath,
                   a.link_url AS LinkUrl,
                   a.description AS Description,
                   a.sort_order AS SortOrder,
                   a.is_active AS IsActive
            FROM club_website_advertisement a
            JOIN rotary_year_master y ON y.pk_year_id = a.fk_year_id
            WHERE a.fk_club_id = @ClubId AND a.fk_year_id = @YearId AND COALESCE(a.isdeleted,0) = 0
            ORDER BY a.sort_order ASC",
            new { ClubId = clubId, YearId = yearId })).ToList();
    }

    public async Task<ClubAdvertisementDto?> GetByIdAsync(int id)
    {
        // Inline SQL (mirrors sp_club_advertisement_get_by_id) with NULL-safe COALESCE(isdeleted,0)=0
        // so migrated rows (isdeleted IS NULL) are still editable. Sidesteps the SP-replace privilege issue.
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.QueryFirstOrDefaultAsync<ClubAdvertisementDto>(@"
            SELECT a.pk_club_website_advertisement_id AS Id,
                   a.fk_club_id AS ClubId,
                   a.fk_year_id AS YearId,
                   y.YearLabel,
                   CASE
                       WHEN a.advertisement_image_path IS NULL OR a.advertisement_image_path = '' THEN NULL
                       WHEN a.advertisement_image_path LIKE '/%' THEN a.advertisement_image_path
                       -- Legacy/migrated rows can carry an already-relative nested path (e.g.
                       -- 'Documents/ClubAdvertisement/xyz.jpg') rather than a bare filename — blindly
                       -- prefixing '/uploads/advertisement/' onto that produced a non-existent, double-
                       -- nested path. Only bare filenames (no '/') get that prefix; anything else that
                       -- already looks like a path just gets a leading slash.
                       WHEN a.advertisement_image_path LIKE '%/%' THEN CONCAT('/', a.advertisement_image_path)
                       ELSE CONCAT('/uploads/advertisement/', a.advertisement_image_path)
                   END AS AdvertisementImagePath,
                   CASE
                       WHEN a.document_path IS NULL OR a.document_path = '' THEN NULL
                       WHEN a.document_path LIKE '/%' THEN a.document_path
                       WHEN a.document_path LIKE '%/%' THEN CONCAT('/', a.document_path)
                       ELSE CONCAT('/uploads/advertisement/', a.document_path)
                   END AS DocumentPath,
                   a.link_url AS LinkUrl,
                   a.description AS Description,
                   a.sort_order AS SortOrder,
                   a.is_active AS IsActive
            FROM club_website_advertisement a
            JOIN rotary_year_master y ON y.pk_year_id = a.fk_year_id
            WHERE a.pk_club_website_advertisement_id = @Id AND COALESCE(a.isdeleted,0) = 0",
            new { Id = id });
    }

    public async Task<int> CreateAsync(int clubId, CreateClubAdvertisementDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var newId = await connection.ExecuteScalarAsync<int>(
            "sp_club_advertisement_create",
            new
            {
                p_ClubId = clubId,
                p_YearId = dto.YearId,
                p_AdvertisementImagePath = dto.AdvertisementImagePath,
                p_DocumentPath = dto.DocumentPath,
                p_Description = dto.Description,
                p_SortOrder = dto.SortOrder,
                p_IsActive = dto.IsActive ? 1 : 0,
                p_CreatedBy = createdBy
            },
            commandType: CommandType.StoredProcedure);
        // link_url isn't part of the (privilege-locked) SP — write it in a follow-up UPDATE.
        // An ad points to EITHER a document OR a link, never both (or neither).
        await connection.ExecuteAsync(
            "UPDATE club_website_advertisement SET link_url = @Link WHERE pk_club_website_advertisement_id = @Id",
            new { Link = string.IsNullOrWhiteSpace(dto.LinkUrl) ? null : dto.LinkUrl.Trim(), Id = newId });
        return newId;
    }

    public async Task UpdateAsync(int id, UpdateClubAdvertisementDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_club_advertisement_update",
            new
            {
                p_Id = id,
                p_AdvertisementImagePath = dto.AdvertisementImagePath,
                p_DocumentPath = dto.DocumentPath,
                p_Description = dto.Description,
                p_SortOrder = dto.SortOrder,
                p_IsActive = dto.IsActive ? 1 : 0,
                p_ModifiedBy = modifiedBy
            },
            commandType: CommandType.StoredProcedure);
        // link_url isn't in the SP — write it (and clear it when a document is used) in a follow-up UPDATE.
        await connection.ExecuteAsync(
            "UPDATE club_website_advertisement SET link_url = @Link WHERE pk_club_website_advertisement_id = @Id",
            new { Link = string.IsNullOrWhiteSpace(dto.LinkUrl) ? null : dto.LinkUrl.Trim(), Id = id });
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_club_advertisement_delete",
            new { p_Id = id, p_DeletedBy = deletedBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task ReorderAsync(int id1, int id2)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_club_advertisement_reorder",
            new { p_Id1 = id1, p_Id2 = id2 },
            commandType: CommandType.StoredProcedure);
    }

    public async Task<string> UploadImageAsync(IFormFile file)
    {
        var uploadsPath = Path.Combine(_env.WebRootPath, "uploads", "advertisement");
        Directory.CreateDirectory(uploadsPath);

        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(uploadsPath, fileName);

        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);

        // Store filename only. Full URL is reconstructed via SQL CONCAT('/uploads/advertisement/', ...) on read.
        return fileName;
    }

    public async Task<string> UploadDocumentAsync(IFormFile file)
    {
        var uploadsPath = Path.Combine(_env.WebRootPath, "uploads", "advertisement");
        Directory.CreateDirectory(uploadsPath);

        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(uploadsPath, fileName);

        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);

        // Store filename only. Full URL is reconstructed via SQL CONCAT('/uploads/advertisement/', ...) on read.
        return fileName;
    }
}
