using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class FundingService : IFundingService
{
    private readonly string _connectionString;

    public FundingService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<List<FundingDto>> GetAllAsync()
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<FundingDto>(
            "sp_funding_get_all",
            commandType: CommandType.StoredProcedure)).ToList();
    }

    public async Task<FundingDto?> GetByIdAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.QueryFirstOrDefaultAsync<FundingDto>(
            "sp_funding_get_by_id",
            new { p_Id = id },
            commandType: CommandType.StoredProcedure);
    }

    public async Task<int> CreateAsync(CreateFundingDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.ExecuteScalarAsync<int>(
            "sp_funding_create",
            new { p_Name = dto.Name, p_SortOrder = dto.SortOrder, p_IsActive = dto.IsActive, p_CreatedBy = createdBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task UpdateAsync(int id, UpdateFundingDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_funding_update",
            new { p_Id = id, p_Name = dto.Name, p_SortOrder = dto.SortOrder, p_IsActive = dto.IsActive, p_ModifiedBy = modifiedBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_funding_delete",
            new { p_Id = id, p_DeletedBy = deletedBy },
            commandType: CommandType.StoredProcedure);
    }
}
