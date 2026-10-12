using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface ICountryService
{
    Task<List<CountryDto>> GetAllAsync();
}

public class CountryService : ICountryService
{
    private readonly string _connectionString;

    public CountryService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<List<CountryDto>> GetAllAsync()
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var countries = await connection.QueryAsync<CountryDto>(
            "sp_country_get_all",
            commandType: CommandType.StoredProcedure);
        return countries.ToList();
    }
}
