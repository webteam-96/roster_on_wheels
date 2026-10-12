using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class ClubAboutService : IClubAboutService
{
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;

    public ClubAboutService(IConfiguration configuration, IWebHostEnvironment env)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _env = env;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // About is NOT year-wise — one About per club, persisting across years.
    // Inline SQL (instead of sp_club_about_*) avoids the SYSTEM_USER privilege issue
    // where CreateOrReplaceProcedure silently skips SPs it cannot drop.
    public async Task<List<ClubAboutDto>> GetByClubAsync(int clubId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<ClubAboutDto>(@"
            SELECT pk_club_website_about_id AS Id,
                   fk_club_id AS ClubId,
                   content AS Content,
                   is_active AS IsActive
            FROM club_website_about
            WHERE fk_club_id = @ClubId AND isdeleted = 0
            ORDER BY modified_date DESC, created_date DESC, pk_club_website_about_id DESC
            LIMIT 1",
            new { ClubId = clubId })).ToList();
    }

    public async Task<ClubAboutDto?> GetByIdAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.QueryFirstOrDefaultAsync<ClubAboutDto>(@"
            SELECT pk_club_website_about_id AS Id,
                   fk_club_id AS ClubId,
                   content AS Content,
                   is_active AS IsActive
            FROM club_website_about
            WHERE pk_club_website_about_id = @Id AND isdeleted = 0
            LIMIT 1",
            new { Id = id });
    }

    public async Task<int> CreateAsync(int clubId, CreateClubAboutDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        // Only one About per club (no longer per year).
        var existing = await connection.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_website_about WHERE fk_club_id = @ClubId AND isdeleted = 0",
            new { ClubId = clubId });
        if (existing > 0)
            throw new InvalidOperationException("About content already exists for this club.");

        return await connection.ExecuteScalarAsync<int>(@"
            INSERT INTO club_website_about (fk_club_id, content, is_active, created_by, created_date)
            VALUES (@ClubId, @Content, @IsActive, @CreatedBy, NOW());
            SELECT LAST_INSERT_ID();",
            new
            {
                ClubId = clubId,
                Content = dto.Content,
                IsActive = dto.IsActive ? 1 : 0,
                CreatedBy = createdBy
            });
    }

    public async Task UpdateAsync(int id, UpdateClubAboutDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(@"
            UPDATE club_website_about
            SET content = @Content,
                is_active = @IsActive,
                modified_by = @ModifiedBy,
                modified_date = NOW()
            WHERE pk_club_website_about_id = @Id AND isdeleted = 0",
            new
            {
                Id = id,
                Content = dto.Content,
                IsActive = dto.IsActive ? 1 : 0,
                ModifiedBy = modifiedBy
            });
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(@"
            UPDATE club_website_about
            SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW()
            WHERE pk_club_website_about_id = @Id",
            new { Id = id, DeletedBy = deletedBy });
    }

    public async Task<string> UploadImageAsync(IFormFile file)
    {
        var uploadsPath = Path.Combine(_env.WebRootPath, "uploads", "about");
        Directory.CreateDirectory(uploadsPath);

        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(uploadsPath, fileName);

        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);

        // Store filename only. Caller / frontend is responsible for embedding with /uploads/about/ prefix.
        return fileName;
    }
}
