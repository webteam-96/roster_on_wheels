using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class WebsiteDataModuleService : IWebsiteDataModuleService
{
    private readonly string _connectionString;

    public WebsiteDataModuleService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<List<WebsiteDataModuleDto>> GetAllAsync()
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<WebsiteDataModuleDto>(
            "sp_website_data_module_get_all",
            commandType: CommandType.StoredProcedure)).ToList();
    }

    public async Task<int> CreateAsync(CreateWebsiteDataModuleDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.ExecuteScalarAsync<int>(
            "sp_website_data_module_create",
            new { p_ModuleName = dto.ModuleName, p_ModuleKey = dto.ModuleKey, p_IconClass = dto.IconClass, p_CreatedBy = createdBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task UpdateAsync(int id, UpdateWebsiteDataModuleDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_website_data_module_update",
            new { p_Id = id, p_ModuleName = dto.ModuleName, p_ModuleKey = dto.ModuleKey, p_IconClass = dto.IconClass, p_ModifiedBy = modifiedBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_website_data_module_delete",
            new { p_Id = id, p_DeletedBy = deletedBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task SwapOrderAsync(int id1, int id2)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_website_data_module_swap_order",
            new { p_Id1 = id1, p_Id2 = id2 },
            commandType: CommandType.StoredProcedure);
    }
}
