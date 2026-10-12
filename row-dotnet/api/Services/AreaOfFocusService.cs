using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class AreaOfFocusService : IAreaOfFocusService
{
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;

    public AreaOfFocusService(IConfiguration configuration, IWebHostEnvironment env)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _env = env;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<List<AreaOfFocusDto>> GetAllAsync(int? moduleId = null)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<AreaOfFocusDto>(
            "sp_area_of_focus_get_all",
            new { p_ModuleId = moduleId },
            commandType: CommandType.StoredProcedure)).ToList();
    }

    public async Task<AreaOfFocusDto?> GetByIdAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.QueryFirstOrDefaultAsync<AreaOfFocusDto>(
            "sp_area_of_focus_get_by_id",
            new { p_Id = id },
            commandType: CommandType.StoredProcedure);
    }

    public async Task<int> CreateAsync(CreateAreaOfFocusDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.ExecuteScalarAsync<int>(
            "sp_area_of_focus_create",
            new { p_ModuleId = dto.ModuleId, p_Name = dto.Name, p_ImagePath = dto.ImagePath, p_SortOrder = dto.SortOrder, p_IsActive = dto.IsActive, p_CreatedBy = createdBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task UpdateAsync(int id, UpdateAreaOfFocusDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_area_of_focus_update",
            new { p_Id = id, p_ModuleId = dto.ModuleId, p_Name = dto.Name, p_ImagePath = dto.ImagePath, p_SortOrder = dto.SortOrder, p_IsActive = dto.IsActive, p_ModifiedBy = modifiedBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_area_of_focus_delete",
            new { p_Id = id, p_DeletedBy = deletedBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task<string> UploadImageAsync(IFormFile file)
    {
        var uploadsPath = Path.Combine(_env.WebRootPath, "uploads", "area-of-focus");
        Directory.CreateDirectory(uploadsPath);

        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(uploadsPath, fileName);

        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);

        // Store filename only. Full URL is reconstructed via SQL CONCAT('/uploads/area-of-focus/', ...) on read.
        return fileName;
    }
}
