using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class RotaryYearService : IRotaryYearService
{
    private readonly string _connectionString;

    public RotaryYearService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<List<RotaryYearDto>> GetAllYearsAsync()
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<RotaryYearDto>(
            "sp_rotary_year_get_all", commandType: CommandType.StoredProcedure)).ToList();
    }

    public async Task<RotaryYearDto?> GetCurrentYearAsync()
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.QueryFirstOrDefaultAsync<RotaryYearDto>(
            "sp_rotary_year_get_current", commandType: CommandType.StoredProcedure);
    }
}
