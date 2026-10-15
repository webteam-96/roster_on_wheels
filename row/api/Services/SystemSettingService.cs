using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class SystemSettingService : ISystemSettingService
{
    private readonly string _connectionString;

    public SystemSettingService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<SystemSettingDto?> GetSettingAsync(string key)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        return await connection.QueryFirstOrDefaultAsync<SystemSettingDto>(
            "sp_setting_get_by_key",
            new { p_Key = key },
            commandType: CommandType.StoredProcedure);
    }

    public async Task UpsertSettingAsync(UpsertSettingDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        await connection.ExecuteAsync(
            "sp_setting_upsert",
            new { p_Key = dto.SettingKey, p_Value = dto.SettingValue, p_Description = dto.Description, p_ModifiedBy = modifiedBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task<List<SystemSettingDto>> GetAllSettingsAsync()
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var results = await connection.QueryAsync<SystemSettingDto>(
            "sp_setting_get_all",
            commandType: CommandType.StoredProcedure);

        return results.ToList();
    }
}
