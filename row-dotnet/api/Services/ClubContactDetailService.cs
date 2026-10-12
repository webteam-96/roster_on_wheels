using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class ClubContactDetailService : IClubContactDetailService
{
    private readonly string _connectionString;

    public ClubContactDetailService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<List<ClubContactDetailDto>> GetByClubAsync(int clubId, int yearId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<ClubContactDetailDto>(
            "sp_club_contact_detail_get_by_club",
            new { p_ClubId = clubId, p_YearId = yearId },
            commandType: CommandType.StoredProcedure)).ToList();
    }

    public async Task<ClubContactDetailDto?> GetByIdAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.QueryFirstOrDefaultAsync<ClubContactDetailDto>(
            "sp_club_contact_detail_get_by_id",
            new { p_Id = id },
            commandType: CommandType.StoredProcedure);
    }

    public async Task<int> CreateAsync(int clubId, CreateClubContactDetailDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.ExecuteScalarAsync<int>(
            "sp_club_contact_detail_create",
            new
            {
                p_ClubId = clubId,
                p_YearId = dto.YearId,
                p_Email = dto.Email,
                p_Phone = dto.Phone,
                p_IsActive = dto.IsActive ? 1 : 0,
                p_CreatedBy = createdBy
            },
            commandType: CommandType.StoredProcedure);
    }

    public async Task UpdateAsync(int id, UpdateClubContactDetailDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_club_contact_detail_update",
            new
            {
                p_Id = id,
                p_Email = dto.Email,
                p_Phone = dto.Phone,
                p_IsActive = dto.IsActive ? 1 : 0,
                p_ModifiedBy = modifiedBy
            },
            commandType: CommandType.StoredProcedure);
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_club_contact_detail_delete",
            new { p_Id = id, p_DeletedBy = deletedBy },
            commandType: CommandType.StoredProcedure);
    }
}
