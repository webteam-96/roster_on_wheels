using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class ClubSocialLinkService : IClubSocialLinkService
{
    private readonly string _connectionString;

    public ClubSocialLinkService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // Social media links are NOT year-wise — one set of links per club, persisting across years.
    // Inline SQL (instead of the sp_club_social_link_* procedures) avoids the SYSTEM_USER
    // privilege issue where CreateOrReplaceProcedure silently skips SPs it cannot drop.
    public async Task<List<ClubSocialLinkDto>> GetByClubAsync(int clubId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<ClubSocialLinkDto>(@"
            SELECT pk_club_website_social_link_id AS Id,
                   fk_club_id AS ClubId,
                   platform AS Platform,
                   link_url AS LinkUrl,
                   sort_order AS SortOrder,
                   is_active AS IsActive
            FROM club_website_social_link
            WHERE fk_club_id = @ClubId AND isdeleted = 0
            ORDER BY sort_order ASC",
            new { ClubId = clubId })).ToList();
    }

    public async Task<ClubSocialLinkDto?> GetByIdAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.QueryFirstOrDefaultAsync<ClubSocialLinkDto>(@"
            SELECT pk_club_website_social_link_id AS Id,
                   fk_club_id AS ClubId,
                   platform AS Platform,
                   link_url AS LinkUrl,
                   sort_order AS SortOrder,
                   is_active AS IsActive
            FROM club_website_social_link
            WHERE pk_club_website_social_link_id = @Id AND isdeleted = 0
            LIMIT 1",
            new { Id = id });
    }

    public async Task<int> CreateAsync(int clubId, CreateClubSocialLinkDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        // Social media links are NOT year-wise — fk_year_id was dropped from the table.
        return await connection.ExecuteScalarAsync<int>(@"
            INSERT INTO club_website_social_link
                (fk_club_id, platform, link_url, sort_order, is_active, created_by, created_date)
            VALUES
                (@ClubId, @Platform, @LinkUrl, @SortOrder, @IsActive, @CreatedBy, NOW());
            SELECT LAST_INSERT_ID();",
            new
            {
                ClubId = clubId,
                Platform = dto.Platform,
                LinkUrl = dto.LinkUrl,
                SortOrder = dto.SortOrder,
                IsActive = dto.IsActive ? 1 : 0,
                CreatedBy = createdBy
            });
    }

    public async Task UpdateAsync(int id, UpdateClubSocialLinkDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(@"
            UPDATE club_website_social_link
            SET platform = @Platform,
                link_url = @LinkUrl,
                sort_order = @SortOrder,
                is_active = @IsActive,
                modified_by = @ModifiedBy,
                modified_date = NOW()
            WHERE pk_club_website_social_link_id = @Id AND isdeleted = 0",
            new
            {
                Id = id,
                Platform = dto.Platform,
                LinkUrl = dto.LinkUrl,
                SortOrder = dto.SortOrder,
                IsActive = dto.IsActive ? 1 : 0,
                ModifiedBy = modifiedBy
            });
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(@"
            UPDATE club_website_social_link
            SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW()
            WHERE pk_club_website_social_link_id = @Id",
            new { Id = id, DeletedBy = deletedBy });
    }
}
