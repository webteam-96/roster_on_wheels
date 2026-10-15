using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// Converted from SPs (sp_theme_get_all / sp_theme_create / sp_theme_update / sp_theme_delete)
// to inline SQL because the existing SPs were created by a higher-privilege MySQL user and
// the current connection user cannot drop/replace them. New "description" column needs to
// be read/written here, so inline is required.
public class ThemeService : IThemeService
{
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;

    public ThemeService(IConfiguration configuration, IWebHostEnvironment env)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _env = env;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<List<ThemeDto>> GetAllAsync()
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var rows = await connection.QueryAsync<ThemeDto>(@"
            SELECT pk_theme_id       AS Id,
                   theme_name        AS ThemeName,
                   CASE
                       WHEN theme_image_path IS NULL OR theme_image_path = '' THEN NULL
                       WHEN theme_image_path LIKE '/%' THEN theme_image_path
                       ELSE CONCAT('/uploads/theme/', theme_image_path)
                   END               AS ThemeImagePath,
                   description       AS Description
            FROM theme_master
            WHERE isdeleted = 0 OR isdeleted IS NULL
            ORDER BY pk_theme_id");
        return rows.ToList();
    }

    public async Task<int> CreateAsync(CreateThemeDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var sql = @"
            INSERT INTO theme_master (theme_name, theme_image_path, description, created_by, created_date)
            VALUES (@ThemeName, @ThemeImagePath, @Description, @CreatedBy, NOW());
            SELECT LAST_INSERT_ID();";
        return await connection.ExecuteScalarAsync<int>(sql, new
        {
            ThemeName      = dto.ThemeName.Trim(),
            ThemeImagePath = dto.ThemeImagePath,
            Description    = string.IsNullOrWhiteSpace(dto.Description) ? null : dto.Description!.Trim(),
            CreatedBy      = createdBy,
        });
    }

    public async Task UpdateAsync(int id, UpdateThemeDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(@"
            UPDATE theme_master
            SET theme_name       = @ThemeName,
                theme_image_path = @ThemeImagePath,
                description      = @Description,
                modified_by      = @ModifiedBy,
                modified_date    = NOW()
            WHERE pk_theme_id = @Id AND (isdeleted = 0 OR isdeleted IS NULL)",
            new
            {
                Id             = id,
                ThemeName      = dto.ThemeName.Trim(),
                ThemeImagePath = dto.ThemeImagePath,
                Description    = string.IsNullOrWhiteSpace(dto.Description) ? null : dto.Description!.Trim(),
                ModifiedBy     = modifiedBy,
            });
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(@"
            UPDATE theme_master
            SET isdeleted    = 1,
                deleted_by   = @DeletedBy,
                deleted_date = NOW()
            WHERE pk_theme_id = @Id",
            new { Id = id, DeletedBy = deletedBy });
    }

    public async Task<string> UploadImageAsync(IFormFile file)
    {
        var uploadsPath = Path.Combine(_env.WebRootPath, "uploads", "theme");
        Directory.CreateDirectory(uploadsPath);

        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(uploadsPath, fileName);

        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);

        // Store filename only. Full URL is reconstructed via SQL CONCAT('/uploads/theme/', ...) on read.
        return fileName;
    }
}
