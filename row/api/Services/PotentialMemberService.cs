using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class PotentialMemberService : IPotentialMemberService
{
    private readonly string _connectionString;

    public PotentialMemberService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<PagedResult<PotentialMemberDto>> GetByClubAsync(int clubId, int page, int pageSize, string? search)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var offset = (page - 1) * pageSize;

        using var multi = await connection.QueryMultipleAsync(
            "sp_potential_member_get_by_club",
            new { p_ClubId = clubId, p_Search = string.IsNullOrWhiteSpace(search) ? null : search, p_PageSize = pageSize, p_Offset = offset },
            commandType: CommandType.StoredProcedure);

        var items = (await multi.ReadAsync<PotentialMemberDto>()).ToList();
        var totalCount = await multi.ReadSingleAsync<int>();

        return new PagedResult<PotentialMemberDto>
        {
            Items = items,
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize
        };
    }

    public async Task<PotentialMemberDto?> GetByIdAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.QueryFirstOrDefaultAsync<PotentialMemberDto>(
            "sp_potential_member_get_by_id",
            new { p_Id = id },
            commandType: CommandType.StoredProcedure);
    }

    public async Task<int> CreateAsync(int clubId, CreatePotentialMemberDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        // Inline SQL (not sp_potential_member_create) so the new referrer column is written
        // without depending on the SP being updatable (SYSTEM_USER privilege issue).
        // fk_member_master_profile_id_as_referrer = the logged-in member who added this potential member.
        return await connection.ExecuteScalarAsync<int>(@"
            INSERT INTO potential_members
                (fk_club_id, name, email, mobile_number, reference_details,
                 created_by, fk_member_master_profile_id_as_referrer)
            VALUES (@ClubId, @Name, @Email, @MobileNumber, @ReferenceDetails,
                    @CreatedBy, @CreatedBy);
            SELECT LAST_INSERT_ID();",
            new
            {
                ClubId = clubId,
                Name = dto.Name,
                Email = dto.Email,
                MobileNumber = dto.MobileNumber,
                ReferenceDetails = dto.ReferenceDetails,
                CreatedBy = createdBy
            });
    }

    public async Task UpdateAsync(int id, UpdatePotentialMemberDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_potential_member_update",
            new
            {
                p_Id = id,
                p_Name = dto.Name,
                p_Email = dto.Email,
                p_MobileNumber = dto.MobileNumber,
                p_ReferenceDetails = dto.ReferenceDetails,
                p_ModifiedBy = modifiedBy
            },
            commandType: CommandType.StoredProcedure);
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_potential_member_delete",
            new { p_Id = id, p_DeletedBy = deletedBy },
            commandType: CommandType.StoredProcedure);
    }
}
