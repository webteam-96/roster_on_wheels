using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class DocumentService : IDocumentService
{
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;

    public DocumentService(IConfiguration configuration, IWebHostEnvironment env)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _env = env;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<(List<DocumentListDto> Items, int TotalCount)> GetAllAsync(int clubId, string status, string search, int page, int pageSize, int? districtId = null)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var whereClause = districtId.HasValue ? "d.fk_district_id = @EntityId" : "d.fk_club_id = @EntityId";
        var entityId = districtId.HasValue ? districtId.Value : clubId;

        var statusCondition = string.IsNullOrEmpty(status) ? "" : @"AND (
            CASE
                WHEN NOW() < d.PublishDateTime THEN 'Unpublished'
                WHEN NOW() > d.ExpiryDateTime THEN 'Expired'
                ELSE 'Published'
            END = @Status)";

        var searchCondition = string.IsNullOrEmpty(search) ? "" : "AND d.Title LIKE CONCAT('%', @Search, '%')";

        var sql = $@"
            SELECT d.pk_document_id AS Id, d.fk_club_id AS ClubId,
                   d.Title, d.AccessType,
                   CASE
                       WHEN d.FilePath IS NULL OR d.FilePath = '' THEN NULL
                       WHEN d.FilePath LIKE '/%' THEN d.FilePath
                       WHEN d.Scope = 'ri' THEN CONCAT('/Documents/documentsafe/ri/', d.FilePath)
                       WHEN d.fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', d.fk_district_id, '/', d.FilePath)
                       ELSE CONCAT('/Documents/documentsafe/Group', d.fk_club_id, '/', d.FilePath)
                   END AS FilePath,
                   d.OriginalFileName, d.PublishDateTime, d.ExpiryDateTime,
                   CASE
                       WHEN NOW() < d.PublishDateTime THEN 'Unpublished'
                       WHEN NOW() > d.ExpiryDateTime THEN 'Expired'
                       ELSE 'Published'
                   END AS Status
            FROM club_documents d
            WHERE {whereClause} AND d.isdeleted = 0
            {statusCondition} {searchCondition}
            ORDER BY d.PublishDateTime DESC
            LIMIT @PageSize OFFSET @Offset;

            SELECT COUNT(*) FROM club_documents d
            WHERE {whereClause} AND d.isdeleted = 0
            {statusCondition} {searchCondition};";

        using var multi = await connection.QueryMultipleAsync(sql, new
        {
            EntityId = entityId,
            Status = status ?? "",
            Search = search ?? "",
            PageSize = pageSize,
            Offset = (page - 1) * pageSize
        });

        var items = (await multi.ReadAsync<DocumentListDto>()).ToList();
        var totalCount = await multi.ReadSingleAsync<int>();
        return (items, totalCount);
    }

    public async Task<DocumentDetailDto?> GetByIdAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        // Inline SQL (SP source updated in DatabaseInitializer.StoredProcedures.cs but
        // SP drop may be silently skipped due to SYSTEM_USER privilege issue — see MEMORY.md)
        var detail = await connection.QueryFirstOrDefaultAsync<DocumentDetailDto>(
            @"SELECT d.pk_document_id AS Id,
                     d.fk_club_id AS ClubId,
                     d.Title,
                     d.AccessType,
                     CASE
                         WHEN d.FilePath IS NULL OR d.FilePath = '' THEN NULL
                         WHEN d.FilePath LIKE '/%' THEN d.FilePath
                         WHEN d.Scope = 'ri' THEN CONCAT('/Documents/documentsafe/ri/', d.FilePath)
                         WHEN d.fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', d.fk_district_id, '/', d.FilePath)
                         ELSE CONCAT('/Documents/documentsafe/Group', d.fk_club_id, '/', d.FilePath)
                     END AS FilePath,
                     d.OriginalFileName,
                     d.PublishDateTime,
                     d.ExpiryDateTime,
                     CASE
                         WHEN d.ExpiryDateTime < NOW() THEN 'Expired'
                         WHEN d.PublishDateTime <= NOW() AND d.ExpiryDateTime >= NOW() THEN 'Published'
                         ELSE 'Unpublished'
                     END AS Status
              FROM club_documents d
              WHERE d.pk_document_id = @Id AND d.isdeleted = 0",
            new { Id = id });
        return detail;
    }

    public async Task<int> CreateAsync(int clubId, CreateDocumentDto dto, int createdBy, int? districtId = null)
    {
        CommsLimits.Require(dto.Title, CommsLimits.DocumentTitle, "Title"); // club + district

        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Documents are NOT year-wise — fk_year_id removed from the table.
        var sql = @"INSERT INTO club_documents (fk_club_id, fk_district_id, Title, AccessType, FilePath,
                        OriginalFileName, PublishDateTime, ExpiryDateTime, created_by, created_date, isdeleted)
                    VALUES (@ClubId, @DistrictId, @Title, @AccessType, @FilePath,
                        @OriginalFileName, @PublishDateTime, @ExpiryDateTime, @CreatedBy, NOW(), 0);
                    SELECT LAST_INSERT_ID();";

        var documentId = await connection.ExecuteScalarAsync<int>(sql, new
        {
            ClubId = districtId.HasValue ? 0 : clubId,
            DistrictId = districtId,
            dto.Title,
            dto.AccessType,
            dto.FilePath,
            dto.OriginalFileName,
            dto.PublishDateTime,
            dto.ExpiryDateTime,
            CreatedBy = createdBy
        });

        return documentId;
    }

    public async Task UpdateAsync(int id, UpdateDocumentDto dto, int modifiedBy)
    {
        CommsLimits.Require(dto.Title, CommsLimits.DocumentTitle, "Title"); // club + district, edit too

        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Expiry guard: reject edits on already-expired items (defense-in-depth; UI hides Edit too)
        var existingExpiry = await connection.ExecuteScalarAsync<DateTime?>(
            @"SELECT ExpiryDateTime FROM club_documents WHERE pk_document_id = @Id AND isdeleted = 0",
            new { Id = id });
        if (existingExpiry.HasValue && existingExpiry.Value < DateTime.Now)
            throw new InvalidOperationException("Cannot edit an expired item. Once an item's expiry date has passed, it can no longer be modified.");

        await connection.ExecuteAsync(
            "sp_document_update",
            new
            {
                p_Id = id,
                p_Title = dto.Title,
                p_AccessType = dto.AccessType,
                p_FilePath = dto.FilePath,
                p_OriginalFileName = dto.OriginalFileName,
                p_PublishDateTime = dto.PublishDateTime,
                p_ExpiryDateTime = dto.ExpiryDateTime,
                p_ModifiedBy = modifiedBy
            },
            commandType: CommandType.StoredProcedure);
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_document_delete",
            new { p_Id = id, p_DeletedBy = deletedBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task<(string path, string originalName)> UploadFileAsync(int clubId, IFormFile file)
    {
        var groupFolder = $"Group{clubId}";
        var uploadsPath = Path.Combine(_env.WebRootPath, "Documents", "documentsafe", groupFolder);
        Directory.CreateDirectory(uploadsPath);

        var originalName = file.FileName;
        // IIS/URL-safe filename: replace spaces/'+'/special chars with '_' (IIS 404s on '+' etc. in the path).
        var originalBaseName = System.Text.RegularExpressions.Regex.Replace(Path.GetFileNameWithoutExtension(file.FileName), @"[^A-Za-z0-9\-]+", "_").Trim('_');
        if (string.IsNullOrEmpty(originalBaseName)) originalBaseName = "file";
        var extension = Path.GetExtension(file.FileName);
        var now = DateTime.Now;
        var timestamp = now.ToString("ddMMyyyyhhmmsstt");
        var fileName = $"{originalBaseName}_{Guid.NewGuid().ToString("N").Substring(0, 8)}{timestamp}{extension}";
        var filePath = Path.Combine(uploadsPath, fileName);

        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);

        // Store filename only — full URL reconstructed via SQL CONCAT on read
        return (fileName, originalName);
    }
}
