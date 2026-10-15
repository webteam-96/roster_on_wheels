using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class SubCategoryService : ISubCategoryService
{
    private readonly string _connectionString;

    public SubCategoryService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<List<SubCategoryDto>> GetByCategoryAsync(int categoryId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<SubCategoryDto>(
            "sp_sub_category_get_by_category",
            new { p_CategoryId = categoryId },
            commandType: CommandType.StoredProcedure)).ToList();
    }

    public async Task<SubCategoryDto?> GetByIdAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.QueryFirstOrDefaultAsync<SubCategoryDto>(
            "sp_sub_category_get_by_id",
            new { p_Id = id },
            commandType: CommandType.StoredProcedure);
    }

    public async Task<int> CreateAsync(CreateSubCategoryDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.ExecuteScalarAsync<int>(
            "sp_sub_category_create",
            new { p_CategoryId = dto.CategoryId, p_Name = dto.Name, p_SortOrder = dto.SortOrder, p_IsActive = dto.IsActive, p_CreatedBy = createdBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task UpdateAsync(int id, UpdateSubCategoryDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_sub_category_update",
            new { p_Id = id, p_CategoryId = dto.CategoryId, p_Name = dto.Name, p_SortOrder = dto.SortOrder, p_IsActive = dto.IsActive, p_ModifiedBy = modifiedBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_sub_category_delete",
            new { p_Id = id, p_DeletedBy = deletedBy },
            commandType: CommandType.StoredProcedure);
    }
}
