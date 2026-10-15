using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class CategoryService : ICategoryService
{
    private readonly string _connectionString;

    public CategoryService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<List<CategoryDto>> GetByAreaOfFocusAsync(int areaOfFocusId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<CategoryDto>(
            "sp_category_get_by_area_of_focus",
            new { p_AreaOfFocusId = areaOfFocusId },
            commandType: CommandType.StoredProcedure)).ToList();
    }

    public async Task<CategoryDto?> GetByIdAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.QueryFirstOrDefaultAsync<CategoryDto>(
            "sp_category_get_by_id",
            new { p_Id = id },
            commandType: CommandType.StoredProcedure);
    }

    public async Task<int> CreateAsync(CreateCategoryDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.ExecuteScalarAsync<int>(
            "sp_category_create",
            new { p_AreaOfFocusId = dto.AreaOfFocusId, p_Name = dto.Name, p_SortOrder = dto.SortOrder, p_IsActive = dto.IsActive, p_CreatedBy = createdBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task UpdateAsync(int id, UpdateCategoryDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_category_update",
            new { p_Id = id, p_AreaOfFocusId = dto.AreaOfFocusId, p_Name = dto.Name, p_SortOrder = dto.SortOrder, p_IsActive = dto.IsActive, p_ModifiedBy = modifiedBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_category_delete",
            new { p_Id = id, p_DeletedBy = deletedBy },
            commandType: CommandType.StoredProcedure);
    }
}
