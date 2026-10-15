using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class ClubThemeService : IClubThemeService
{
    private readonly string _connectionString;

    public ClubThemeService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<ClubThemeDto?> GetByClubYearAsync(int clubId, int yearId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.QueryFirstOrDefaultAsync<ClubThemeDto>(
            "sp_club_theme_get",
            new { p_ClubId = clubId, p_YearId = yearId },
            commandType: CommandType.StoredProcedure);
    }

    public async Task SaveAsync(int clubId, SaveClubThemeDto dto, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_club_theme_save",
            new { p_ClubId = clubId, p_YearId = dto.YearId, p_ThemeId = dto.ThemeId, p_UserId = userId },
            commandType: CommandType.StoredProcedure);
    }
}
