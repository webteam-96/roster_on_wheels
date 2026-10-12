using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class ZoneService : IZoneService
{
    private readonly string _connectionString;

    public ZoneService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<PagedResult<ZoneListDto>> GetAllAsync(int page, int pageSize, string? search, int? isActive)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var totalCount = await connection.ExecuteScalarAsync<int>(
            "sp_zone_get_all_count",
            new { p_Search = string.IsNullOrWhiteSpace(search) ? null : search, p_IsActive = isActive },
            commandType: CommandType.StoredProcedure);

        var offset = (page - 1) * pageSize;

        var items = (await connection.QueryAsync<ZoneListDto>(@"
            SELECT
                z.pk_zone_id AS Id,
                z.ZoneName,
                z.IsActive,
                z.created_date AS CreatedDate,
                CAST(IFNULL(z.IsZonalAwardsEnabled, 0) AS UNSIGNED) AS IsZonalAwardsEnabled,
                (SELECT COUNT(*) FROM district_master d WHERE d.fk_zone_id = z.pk_zone_id AND d.isdeleted = 0) AS TotalDistricts,
                (SELECT COUNT(*) FROM club_master c
                 JOIN district_master d2 ON d2.pk_district_id = c.fk_district_id AND d2.isdeleted = 0
                 WHERE d2.fk_zone_id = z.pk_zone_id AND c.isdeleted = 0) AS TotalClubs,
                (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
                 FROM club_members cm
                 JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0
                 JOIN district_master d3 ON d3.pk_district_id = c2.fk_district_id AND d3.isdeleted = 0
                 JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                 WHERE d3.fk_zone_id = z.pk_zone_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
                   AND cm.IsHonoraryMember = 0) AS TotalMembers,
                coord.MemberName AS CoordinatorName,
                coord.EmailId AS CoordinatorEmail
            FROM zone_master z
            LEFT JOIN (
                SELECT mr.fk_zone_id, m.MemberName, m.EmailId
                FROM member_roles mr
                JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id
                WHERE mr.fk_role_id = 4 AND mr.IsActive = 1 AND mr.isdeleted = 0 AND m.isdeleted = 0
            ) coord ON coord.fk_zone_id = z.pk_zone_id
            WHERE z.isdeleted = 0
              AND (@Search IS NULL OR z.ZoneName LIKE CONCAT('%', @Search, '%'))
              AND (@IsActive IS NULL OR z.IsActive = @IsActive)
            ORDER BY z.pk_zone_id DESC
            LIMIT @PageSize OFFSET @Offset",
            new { Search = string.IsNullOrWhiteSpace(search) ? null : search, IsActive = isActive, PageSize = pageSize, Offset = offset })).ToList();

        return new PagedResult<ZoneListDto>
        {
            Items = items,
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize
        };
    }

    public async Task<ZoneDetailDto?> GetByIdAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        return await connection.QueryFirstOrDefaultAsync<ZoneDetailDto>(
            "sp_zone_get_by_id",
            new { p_Id = id },
            commandType: CommandType.StoredProcedure);
    }

    public async Task<int> CreateAsync(CreateZoneDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Check duplicate
        var isDuplicate = await connection.ExecuteScalarAsync<int>(
            "sp_zone_check_duplicate",
            new { p_ZoneName = dto.ZoneName.Trim(), p_ExcludeId = (int?)null },
            commandType: CommandType.StoredProcedure);

        if (isDuplicate > 0)
            throw new Exception("A zone with this name already exists.");

        return await connection.ExecuteScalarAsync<int>(
            "sp_zone_create",
            new { p_ZoneName = dto.ZoneName.Trim(), p_IsActive = dto.IsActive ? 1 : 0, p_CreatedBy = createdBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task UpdateAsync(int id, UpdateZoneDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Check duplicate
        var isDuplicate = await connection.ExecuteScalarAsync<int>(
            "sp_zone_check_duplicate",
            new { p_ZoneName = dto.ZoneName.Trim(), p_ExcludeId = id },
            commandType: CommandType.StoredProcedure);

        if (isDuplicate > 0)
            throw new Exception("A zone with this name already exists.");

        await connection.ExecuteAsync(
            "sp_zone_update",
            new { p_Id = id, p_ZoneName = dto.ZoneName.Trim(), p_IsActive = dto.IsActive ? 1 : 0, p_ModifiedBy = modifiedBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        await connection.ExecuteAsync(
            "sp_zone_soft_delete",
            new { p_Id = id, p_DeletedBy = deletedBy },
            commandType: CommandType.StoredProcedure);
    }
}
