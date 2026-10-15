using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class SubGroupService : ISubGroupService
{
    private readonly string _connectionString;

    public SubGroupService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<IEnumerable<SubGroupListDto>> GetSubGroupsAsync(int clubId, int yearId, int? districtId = null)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var whereClause = districtId.HasValue ? "sg.fk_district_id = @EntityId" : "sg.fk_club_id = @EntityId";
        var entityId = districtId.HasValue ? districtId.Value : clubId;

        return await connection.QueryAsync<SubGroupListDto>(
            $@"SELECT sg.pk_sub_group_id AS Id, sg.fk_club_id AS ClubId, sg.fk_year_id AS YearId,
                     y.YearLabel, sg.GroupName,
                     COUNT(sgm.pk_sub_group_member_id) AS MemberCount
              FROM sub_groups sg
              INNER JOIN rotary_year_master y ON y.pk_year_id = sg.fk_year_id
              LEFT JOIN sub_group_members sgm ON sgm.fk_sub_group_id = sg.pk_sub_group_id AND sgm.isdeleted = 0
              WHERE {whereClause} AND sg.fk_year_id = @YearId AND sg.isdeleted = 0
              GROUP BY sg.pk_sub_group_id, sg.fk_club_id, sg.fk_year_id, y.YearLabel, sg.GroupName
              ORDER BY sg.GroupName",
            new { EntityId = entityId, YearId = yearId });
    }

    public async Task<SubGroupDetailDto> GetSubGroupDetailAsync(int subGroupId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var group = await connection.QueryFirstOrDefaultAsync<SubGroupDetailDto>(
            @"SELECT sg.pk_sub_group_id AS Id, sg.fk_club_id AS ClubId, sg.fk_year_id AS YearId,
                     y.YearLabel, sg.GroupName
              FROM sub_groups sg
              INNER JOIN rotary_year_master y ON y.pk_year_id = sg.fk_year_id
              WHERE sg.pk_sub_group_id = @SubGroupId AND sg.isdeleted = 0",
            new { SubGroupId = subGroupId });

        if (group == null)
            throw new KeyNotFoundException("Sub group not found.");

        var members = await connection.QueryAsync<SubGroupMemberDto>(
            @"SELECT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId AS Email,
                     m.PrimaryMobileNumber AS MobileNumber,
                     CASE
                         WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                         WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                         ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                     END AS ProfilePhotoPath
              FROM sub_group_members sgm
              INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = sgm.fk_member_master_profile_id
              WHERE sgm.fk_sub_group_id = @SubGroupId AND sgm.isdeleted = 0 AND m.isdeleted = 0
              ORDER BY m.MemberName",
            new { SubGroupId = subGroupId });

        group.Members = members.ToList();
        return group;
    }

    public async Task<SubGroupListDto> CreateSubGroupAsync(int clubId, CreateSubGroupDto dto, int userId, int? districtId = null)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var groupId = await connection.ExecuteScalarAsync<int>(
            @"INSERT INTO sub_groups (fk_club_id, fk_district_id, fk_year_id, GroupName, created_by, created_date)
              VALUES (@ClubId, @DistrictId, @YearId, @GroupName, @UserId, NOW());
              SELECT LAST_INSERT_ID();",
            new
            {
                ClubId = districtId.HasValue ? 0 : clubId,
                DistrictId = districtId,
                YearId = dto.YearId,
                GroupName = dto.GroupName,
                UserId = userId
            });

        if (dto.MemberIds.Count > 0)
        {
            foreach (var memberId in dto.MemberIds)
            {
                await connection.ExecuteAsync(
                    @"INSERT INTO sub_group_members (fk_sub_group_id, fk_member_master_profile_id, created_by, created_date)
                      VALUES (@GroupId, @MemberId, @UserId, NOW())",
                    new { GroupId = groupId, MemberId = memberId, UserId = userId });
            }
        }

        var yearLabel = await connection.ExecuteScalarAsync<string>(
            "SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @YearId",
            new { YearId = dto.YearId }) ?? "";

        return new SubGroupListDto
        {
            Id = groupId,
            ClubId = districtId.HasValue ? 0 : clubId,
            YearId = dto.YearId,
            YearLabel = yearLabel,
            GroupName = dto.GroupName,
            MemberCount = dto.MemberIds.Count
        };
    }

    public async Task<SubGroupListDto> UpdateSubGroupAsync(int subGroupId, UpdateSubGroupDto dto, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Update group name and year
        await connection.ExecuteAsync(
            @"UPDATE sub_groups SET GroupName = @GroupName,
              fk_year_id = COALESCE(@YearId, fk_year_id),
              modified_by = @UserId, modified_date = NOW()
              WHERE pk_sub_group_id = @SubGroupId AND isdeleted = 0",
            new { GroupName = dto.GroupName, YearId = dto.YearId > 0 ? dto.YearId : (int?)null, UserId = userId, SubGroupId = subGroupId });

        // Soft delete all existing members
        await connection.ExecuteAsync(
            @"UPDATE sub_group_members SET isdeleted = 1
              WHERE fk_sub_group_id = @SubGroupId AND isdeleted = 0",
            new { SubGroupId = subGroupId });

        // Insert new members
        if (dto.MemberIds.Count > 0)
        {
            foreach (var memberId in dto.MemberIds)
            {
                await connection.ExecuteAsync(
                    @"INSERT INTO sub_group_members (fk_sub_group_id, fk_member_master_profile_id, created_by, created_date)
                      VALUES (@SubGroupId, @MemberId, @UserId, NOW())",
                    new { SubGroupId = subGroupId, MemberId = memberId, UserId = userId });
            }
        }

        // Return updated group
        var group = await connection.QueryFirstAsync<SubGroupListDto>(
            @"SELECT sg.pk_sub_group_id AS Id, sg.fk_club_id AS ClubId, sg.fk_year_id AS YearId,
                     y.YearLabel, sg.GroupName,
                     COUNT(sgm.pk_sub_group_member_id) AS MemberCount
              FROM sub_groups sg
              INNER JOIN rotary_year_master y ON y.pk_year_id = sg.fk_year_id
              LEFT JOIN sub_group_members sgm ON sgm.fk_sub_group_id = sg.pk_sub_group_id AND sgm.isdeleted = 0
              WHERE sg.pk_sub_group_id = @SubGroupId AND sg.isdeleted = 0
              GROUP BY sg.pk_sub_group_id, sg.fk_club_id, sg.fk_year_id, y.YearLabel, sg.GroupName",
            new { SubGroupId = subGroupId });

        return group;
    }

    public async Task DeleteSubGroupAsync(int subGroupId, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Soft delete the group
        await connection.ExecuteAsync(
            @"UPDATE sub_groups SET isdeleted = 1, deleted_by = @UserId, deleted_date = NOW()
              WHERE pk_sub_group_id = @SubGroupId",
            new { SubGroupId = subGroupId, UserId = userId });

        // Soft delete all members of the group
        await connection.ExecuteAsync(
            @"UPDATE sub_group_members SET isdeleted = 1
              WHERE fk_sub_group_id = @SubGroupId",
            new { SubGroupId = subGroupId });
    }

    public async Task<IEnumerable<SubGroupMemberDto>> GetClubMembersAsync(int clubId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        return await connection.QueryAsync<SubGroupMemberDto>(
            @"SELECT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId AS Email,
                     m.PrimaryMobileNumber AS MobileNumber,
                     CASE
                         WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                         WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                         ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                     END AS ProfilePhotoPath
              FROM member_master_profile m
              INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
              WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
              ORDER BY m.MemberName",
            new { ClubId = clubId });
    }

    public async Task<IEnumerable<SubGroupMemberDto>> GetDistrictMembersAsync(int districtId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        return await connection.QueryAsync<SubGroupMemberDto>(
            @"SELECT DISTINCT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId AS Email,
                     m.PrimaryMobileNumber AS MobileNumber,
                     CASE
                         WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                         WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                         ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                     END AS ProfilePhotoPath,
                     c.ClubName
              FROM member_master_profile m
              INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
              INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id
              WHERE c.fk_district_id = @DistrictId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
              ORDER BY c.ClubName, m.MemberName",
            new { DistrictId = districtId });
    }

    public async Task<IEnumerable<dynamic>> GetAvailableYearsAsync(int? clubId, int? districtId)
    {
        using var connection = CreateConnection();
        var sql = @"SELECT DISTINCT ry.pk_year_id AS id, ry.YearLabel AS yearLabel
            FROM sub_groups sg
            INNER JOIN rotary_year_master ry ON ry.pk_year_id = sg.fk_year_id
            WHERE sg.isdeleted = 0";
        if (clubId.HasValue && clubId > 0)
            sql += " AND sg.fk_club_id = @ClubId";
        else if (districtId.HasValue && districtId > 0)
            sql += " AND sg.fk_district_id = @DistrictId";
        sql += " ORDER BY ry.YearLabel DESC";
        return await connection.QueryAsync<dynamic>(sql, new { ClubId = clubId, DistrictId = districtId });
    }
}
