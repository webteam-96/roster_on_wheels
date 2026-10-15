using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class DistrictService : IDistrictService
{
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;

    public DistrictService(IConfiguration configuration, IWebHostEnvironment env)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _env = env;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<PagedResult<DistrictListDto>> GetAllAsync(int page, int pageSize, string? search, int? isActive, int? zoneId = null, bool? hasClubs = null, bool? hasMembers = null, bool? hasSyncClubs = null)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var searchParam = string.IsNullOrWhiteSpace(search) ? null : search;

        // hasMembers=true (stricter) → only districts with ≥1 club that has ≥1 active member.
        // hasClubs=true (looser)   → only districts with ≥1 non-deleted club.
        // Used by credit-management dropdown so empty placeholder districts don't clutter the list.
        string hasClubsClause;
        if (hasSyncClubs == true)
        {
            // Only districts that have ≥1 SYNC club (IsSyncedFromRotaryOrg=1). Used by the Rotary.org
            // sync/compare pages so non-sync-only districts (e.g. Taiwan) don't clutter the dropdown.
            hasClubsClause = " AND EXISTS (SELECT 1 FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.isdeleted = 0 AND IFNULL(c.IsSyncedFromRotaryOrg,0) = 1)";
        }
        else if (hasMembers == true)
        {
            hasClubsClause = @" AND EXISTS (
                SELECT 1 FROM club_master c
                WHERE c.fk_district_id = d.pk_district_id AND c.isdeleted = 0
                  AND EXISTS (SELECT 1 FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0)
            )";
        }
        else if (hasClubs == true)
        {
            hasClubsClause = " AND EXISTS (SELECT 1 FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.isdeleted = 0)";
        }
        else
        {
            hasClubsClause = string.Empty;
        }

        // Inline SQL (replaces sp_district_get_all_count) — needed so projection includes new Country column
        var countSql = $@"
            SELECT COUNT(*)
            FROM district_master d
            WHERE d.isdeleted = 0
              AND (@Search IS NULL OR d.DistrictNumber LIKE CONCAT('%', @Search, '%'))
              AND (@IsActive IS NULL OR d.IsActive = @IsActive)
              AND (@ZoneId IS NULL OR d.fk_zone_id = @ZoneId){hasClubsClause}";

        var totalCount = await connection.ExecuteScalarAsync<int>(countSql,
            new { Search = searchParam, IsActive = isActive, ZoneId = zoneId });

        var offset = (page - 1) * pageSize;

        // Inline SQL (replaces sp_district_get_all_paginated)
        var dataSql = $@"
            SELECT
                d.pk_district_id AS Id,
                d.DistrictNumber,
                CASE
                    WHEN d.DistrictLogoPath IS NULL OR d.DistrictLogoPath = '' THEN NULL
                    WHEN d.DistrictLogoPath LIKE '/%' THEN d.DistrictLogoPath
                    ELSE CONCAT('/uploads/district/', d.DistrictLogoPath)
                END AS DistrictLogoPath,
                d.IsActive,
                d.created_date AS CreatedDate,
                d.fk_zone_id AS FkZoneId,
                z.ZoneName,
                d.Country,
                d.DefaultCurrency,
                (SELECT COUNT(*) FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.isdeleted = 0 AND COALESCE(c.ClubType,'') <> 'Rotaract Club') AS TotalClubs,
                (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
                 FROM club_members cm
                 JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0
                 JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                 WHERE c2.fk_district_id = d.pk_district_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0) AS TotalMembers
            FROM district_master d
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0
            WHERE d.isdeleted = 0
              AND (@Search IS NULL OR d.DistrictNumber LIKE CONCAT('%', @Search, '%'))
              AND (@IsActive IS NULL OR d.IsActive = @IsActive)
              AND (@ZoneId IS NULL OR d.fk_zone_id = @ZoneId){hasClubsClause}
            ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber
            LIMIT @PageSize OFFSET @Offset";

        var items = (await connection.QueryAsync<DistrictListDto>(dataSql,
            new { Search = searchParam, IsActive = isActive, ZoneId = zoneId, PageSize = pageSize, Offset = offset })).ToList();

        return new PagedResult<DistrictListDto>
        {
            Items = items,
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize
        };
    }

    public async Task<DistrictDetailDto?> GetByIdAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Inline SQL (replaces sp_district_get_by_id) — needed for new Country column
        var sql = @"
            SELECT
                d.pk_district_id AS Id,
                d.DistrictNumber,
                CASE
                    WHEN d.DistrictLogoPath IS NULL OR d.DistrictLogoPath = '' THEN NULL
                    WHEN d.DistrictLogoPath LIKE '/%' THEN d.DistrictLogoPath
                    ELSE CONCAT('/uploads/district/', d.DistrictLogoPath)
                END AS DistrictLogoPath,
                d.IsActive,
                d.created_by AS CreatedBy,
                d.created_date AS CreatedDate,
                d.modified_by AS ModifiedBy,
                d.modified_date AS ModifiedDate,
                d.fk_zone_id AS FkZoneId,
                z.ZoneName,
                d.Country,
                d.DefaultCurrency,
                (SELECT COUNT(*) FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.isdeleted = 0 AND COALESCE(c.ClubType,'') <> 'Rotaract Club') AS TotalClubs,
                (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
                 FROM club_members cm
                 JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0
                 JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                 WHERE c2.fk_district_id = d.pk_district_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0) AS TotalMembers
            FROM district_master d
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0
            WHERE d.pk_district_id = @Id AND d.isdeleted = 0";

        return await connection.QueryFirstOrDefaultAsync<DistrictDetailDto>(sql, new { Id = id });
    }

    public async Task<int> CreateAsync(CreateDistrictDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // No duplicate validation — same DistrictNumber can exist across (or even within) zones/countries.
        // Inline SQL (replaces sp_district_create) — supports new Country column.
        var country = string.IsNullOrWhiteSpace(dto.Country) ? "India" : dto.Country.Trim();
        var defaultCurrency = CurrencyHelper.Normalize(dto.DefaultCurrency);

        var insertSql = @"
            INSERT INTO district_master
                (DistrictNumber, DistrictLogoPath, IsActive, fk_zone_id, Country, DefaultCurrency, created_by, created_date, isdeleted)
            VALUES
                (@DistrictNumber, @DistrictLogoPath, @IsActive, @FkZoneId, @Country, @DefaultCurrency, @CreatedBy, NOW(), 0);
            SELECT LAST_INSERT_ID();";

        var districtId = await connection.ExecuteScalarAsync<int>(insertSql, new
        {
            DistrictNumber = dto.DistrictNumber.Trim(),
            DistrictLogoPath = dto.DistrictLogoPath,
            IsActive = dto.IsActive ? 1 : 0,
            // No zone → NULL, never 0. FK fk_district_zone has no zone 0; a 0 would fail the write.
            FkZoneId = (dto.FkZoneId.HasValue && dto.FkZoneId.Value != 0) ? dto.FkZoneId : (int?)null,
            Country = country,
            DefaultCurrency = defaultCurrency,
            CreatedBy = createdBy,
        });

        // Auto-assign default modules to new district
        await connection.ExecuteAsync(
            "sp_district_modules_assign_defaults",
            new { p_DistrictId = districtId, p_AssignedBy = createdBy },
            commandType: CommandType.StoredProcedure);

        return districtId;
    }

    public async Task UpdateAsync(int id, UpdateDistrictDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // No duplicate validation — same DistrictNumber can exist across (or even within) zones/countries.
        // Inline SQL (replaces sp_district_update) — supports new Country column.
        var country = string.IsNullOrWhiteSpace(dto.Country) ? "India" : dto.Country.Trim();
        var defaultCurrency = CurrencyHelper.Normalize(dto.DefaultCurrency);

        var updateSql = @"
            UPDATE district_master SET
                DistrictNumber = @DistrictNumber,
                DistrictLogoPath = @DistrictLogoPath,
                IsActive = @IsActive,
                fk_zone_id = @FkZoneId,
                Country = @Country,
                DefaultCurrency = @DefaultCurrency,
                modified_by = @ModifiedBy,
                modified_date = NOW()
            WHERE pk_district_id = @Id AND isdeleted = 0";

        await connection.ExecuteAsync(updateSql, new
        {
            Id = id,
            DistrictNumber = dto.DistrictNumber.Trim(),
            DistrictLogoPath = dto.DistrictLogoPath,
            IsActive = dto.IsActive ? 1 : 0,
            // No zone → NULL, never 0. FK fk_district_zone has no zone 0; a 0 would fail the write.
            FkZoneId = (dto.FkZoneId.HasValue && dto.FkZoneId.Value != 0) ? dto.FkZoneId : (int?)null,
            Country = country,
            DefaultCurrency = defaultCurrency,
            ModifiedBy = modifiedBy,
        });

        // Auto-assign any new default modules
        await connection.ExecuteAsync(
            "sp_district_modules_assign_defaults",
            new { p_DistrictId = id, p_AssignedBy = modifiedBy },
            commandType: CommandType.StoredProcedure);
    }

    // Lightweight update for the Settings → Currency screen — doesn't require the full
    // UpdateDistrictDto (DistrictNumber/LogoPath/IsActive/FkZoneId/Country) just to change currency.
    public async Task UpdateDefaultCurrencyAsync(int id, string? defaultCurrency, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        await connection.ExecuteAsync(@"
            UPDATE district_master
            SET DefaultCurrency = @DefaultCurrency, modified_by = @ModifiedBy, modified_date = NOW()
            WHERE pk_district_id = @Id AND isdeleted = 0",
            new { Id = id, DefaultCurrency = CurrencyHelper.Normalize(defaultCurrency), ModifiedBy = modifiedBy });
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        await connection.ExecuteAsync(
            "sp_district_soft_delete",
            new { p_Id = id, p_DeletedBy = deletedBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task<IEnumerable<ClubListDto>> GetClubsAsync(int districtId, bool? hasMembers = null, bool excludeRotaract = false)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // When hasMembers=true, filter to clubs with at least one non-deleted member.
        // Inline SQL used (instead of sp_district_get_clubs) so we can add this filter without
        // touching the SP (SYSTEM_USER privilege issue blocks SP updates on this DB).
        if (hasMembers == true)
        {
            // user 2026-10-08: Rotaract clubs hidden from everyone except SuperAdmin.
            var sql = $@"
                SELECT
                    c.pk_club_id AS Id,
                    c.fk_district_id AS FkDistrictId,
                    c.ClubRotaryId,
                    c.ClubName,
                    CASE
                        WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                        WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                        ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                    END AS ClubLogoPath,
                    c.MeetingDay,
                    c.City,
                    c.State,
                    c.IsActive,
                    (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0 AND COALESCE(cm.IsHonoraryMember,0) = 0) AS TotalMembers,
                    (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0 AND COALESCE(cm.IsHonoraryMember,0) = 1) AS HonoraryMembers
                FROM club_master c
                WHERE c.fk_district_id = @DistrictId
                  AND c.isdeleted = 0
                  AND EXISTS (SELECT 1 FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0)
                  {(excludeRotaract ? "AND " + ClubScopeSql.NotRotaract("c") : "")}
                ORDER BY c.ClubName";
            return await connection.QueryAsync<ClubListDto>(sql, new { DistrictId = districtId });
        }

        // Default (no hasMembers filter): all non-deleted clubs in the district, each with a
        // CORRECTLY filtered member count. Inline SQL instead of sp_district_get_clubs — that SP
        // does NOT filter club_members.isdeleted=0 (and can't be updated: SYSTEM_USER privilege),
        // so a non-sync club whose members were soft-deleted kept showing a stale member count.
        var allSql = $@"
            SELECT
                c.pk_club_id AS Id,
                c.fk_district_id AS FkDistrictId,
                c.ClubRotaryId,
                c.ClubName,
                CASE
                    WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                    WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                    ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                END AS ClubLogoPath,
                c.MeetingDay,
                c.City,
                c.State,
                c.IsActive,
                (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0 AND COALESCE(cm.IsHonoraryMember,0) = 0) AS TotalMembers,
                (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0 AND COALESCE(cm.IsHonoraryMember,0) = 1) AS HonoraryMembers
            FROM club_master c
            WHERE c.fk_district_id = @DistrictId
              AND c.isdeleted = 0
              {(excludeRotaract ? "AND " + ClubScopeSql.NotRotaract("c") : "")}
            ORDER BY c.ClubName";
        return await connection.QueryAsync<ClubListDto>(allSql, new { DistrictId = districtId });
    }

    public async Task<PagedResult<DistrictMemberDto>> GetMembersAsync(int districtId, int page, int pageSize, string? search)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var offset = (page - 1) * pageSize;
        var searchParam = string.IsNullOrWhiteSpace(search) ? null : search;

        // Use inline SQL instead of SP (SYSTEM_USER privilege prevents SP update).
        //
        // Count PER-MEMBERSHIP, not per distinct member: a member in 10
        // clubs of the district must count 10 times so pagination total
        // matches the KPI totals on the Membership + Overview cards
        // (locked by user 2026-07-03). The data query GROUPs BY
        // (member_id, ClubName) — each (member, club) pair renders as
        // its own row — so this count now matches the row count returned.
        var countSql = @"
            SELECT COUNT(*)
            FROM member_master_profile m
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            WHERE c.fk_district_id = @DistrictId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
              AND (@Search IS NULL
                   OR m.MemberName LIKE CONCAT('%', @Search, '%')
                   OR m.EmailId LIKE CONCAT('%', @Search, '%')
                   OR m.PrimaryMobileNumber LIKE CONCAT('%', @Search, '%')
                   OR m.RotaryId LIKE CONCAT('%', @Search, '%'))";

        var totalCount = await connection.ExecuteScalarAsync<int>(countSql,
            new { DistrictId = districtId, Search = searchParam });

        // Honorary split — same per-membership basis + same search filter as totalCount, so
        // total = paid + honorary always holds. paid (regular) = totalCount - honoraryCount.
        var honoraryCount = await connection.ExecuteScalarAsync<int>(
            countSql + " AND COALESCE(cm.IsHonoraryMember, 0) = 1",
            new { DistrictId = districtId, Search = searchParam });

        var dataSql = @"
            SELECT m.pk_member_master_profile_id AS Id, m.MemberName,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS ProfilePhotoPath,
                   m.EmailId, m.PrimaryMobileNumber, m.RotaryId, cm.JoinedDate,
                   c.ClubName,
                   GROUP_CONCAT(DISTINCT
                     CASE
                       WHEN r.RoleName = 'Admin' AND mr.fk_district_id > 0 AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0) THEN 'District Admin'
                       WHEN r.RoleName = 'Admin' AND mr.fk_club_id > 0 THEN 'Club Admin'
                       WHEN r.RoleName = 'Admin' AND (mr.fk_district_id IS NULL OR mr.fk_district_id = 0) AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0) THEN 'Admin'
                       ELSE r.RoleName
                     END ORDER BY r.RoleName SEPARATOR ',') AS RoleNames,
                   MAX(CASE WHEN mr.fk_role_id = 2 AND mr.fk_district_id = @DistrictId AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0) AND mr.IsActive = 1 AND mr.isdeleted = 0 THEN 1 ELSE 0 END) AS HasDistrictAdminRole,
                   MAX(CASE WHEN mr.fk_role_id = 2 AND mr.fk_district_id = @DistrictId AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0) AND mr.AllClubsAccess = 1 AND mr.IsActive = 1 AND mr.isdeleted = 0 THEN 1 ELSE 0 END) AS AllClubsAccess,
                   MAX(CASE WHEN mr.fk_role_id = 2 AND mr.fk_club_id > 0 AND mr.IsActive = 1 AND mr.isdeleted = 0 THEN 1 ELSE 0 END) AS HasClubAdminRole,
                   MAX(CASE WHEN r.RoleName = 'SuperAdmin' AND mr.IsActive = 1 AND mr.isdeleted = 0 THEN 1 ELSE 0 END) AS IsSuperAdmin
            FROM member_master_profile m
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            LEFT JOIN member_roles mr ON mr.fk_member_master_profile_id = m.pk_member_master_profile_id
                AND mr.IsActive = 1 AND mr.isdeleted = 0
                AND (
                    /* Club Admin tied to THIS club row */
                    (mr.fk_role_id = 2 AND mr.fk_club_id = c.pk_club_id)
                    /* District Admin of parent district — DB stores fk_club_id=0 (not NULL) for the no-club sentinel */
                    OR (mr.fk_role_id = 2 AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0) AND mr.fk_district_id = c.fk_district_id)
                    /* Any non-Admin role */
                    OR mr.fk_role_id != 2
                )
            LEFT JOIN roles r ON r.pk_role_id = mr.fk_role_id
            WHERE c.fk_district_id = @DistrictId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
              AND (@Search IS NULL
                   OR m.MemberName LIKE CONCAT('%', @Search, '%')
                   OR m.EmailId LIKE CONCAT('%', @Search, '%')
                   OR m.PrimaryMobileNumber LIKE CONCAT('%', @Search, '%')
                   OR m.RotaryId LIKE CONCAT('%', @Search, '%'))
            GROUP BY m.pk_member_master_profile_id, m.MemberName, m.ProfilePhotoPath,
                     m.EmailId, m.PrimaryMobileNumber, m.RotaryId, cm.JoinedDate, c.ClubName
            -- 4-tier sort so the district-admin dashboard Directory tab
            -- surfaces admins and rows needing attention first:
            --   0 = District Admin, 1 = Club Admin,
            --   2 = active member with blank mobile (needs data cleanup),
            --   3 = everyone else. Within each tier, alphabetical.
            ORDER BY
                CASE
                    WHEN MAX(CASE WHEN mr.fk_role_id = 2 AND mr.fk_district_id = @DistrictId AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0) AND mr.IsActive = 1 AND mr.isdeleted = 0 THEN 1 ELSE 0 END) = 1 THEN 0
                    WHEN MAX(CASE WHEN mr.fk_role_id = 2 AND mr.fk_club_id > 0 AND mr.IsActive = 1 AND mr.isdeleted = 0 THEN 1 ELSE 0 END) = 1 THEN 1
                    WHEN m.PrimaryMobileNumber IS NULL OR m.PrimaryMobileNumber = '' THEN 2
                    ELSE 3
                END,
                m.MemberName
            LIMIT @PageSize OFFSET @Offset";

        var rawItems = await connection.QueryAsync<dynamic>(dataSql,
            new { DistrictId = districtId, Search = searchParam, PageSize = pageSize, Offset = offset });

        var items = rawItems.Select(row => new DistrictMemberDto
        {
            Id = (int)row.Id,
            MemberName = (string)(row.MemberName ?? ""),
            ProfilePhotoPath = (string?)row.ProfilePhotoPath,
            EmailId = (string)(row.EmailId ?? ""),
            PrimaryMobileNumber = (string)(row.PrimaryMobileNumber ?? ""),
            RotaryId = (string)(row.RotaryId ?? ""),
            JoinedDate = row.JoinedDate as DateTime?,
            ClubName = (string)(row.ClubName ?? ""),
            ClubNames = (string)(row.ClubName ?? ""),
            RoleNames = (string?)(row.RoleNames),
            HasDistrictAdminRole = ((long?)row.HasDistrictAdminRole ?? 0) == 1,
            AllClubsAccess = ((long?)row.AllClubsAccess ?? 0) == 1,
            HasClubAdminRole = ((long?)row.HasClubAdminRole ?? 0) == 1,
            IsSuperAdmin = ((long?)row.IsSuperAdmin ?? 0) == 1
        }).ToList();

        var totalPages = (int)Math.Ceiling((double)totalCount / pageSize);

        return new PagedResult<DistrictMemberDto>
        {
            Items = items,
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize,
            HonoraryCount = honoraryCount,
            MemberCount = totalCount - honoraryCount
        };
    }

    public async Task<string> UploadLogoAsync(IFormFile file)
    {
        var uploadsPath = Path.Combine(_env.WebRootPath, "uploads", "district");
        Directory.CreateDirectory(uploadsPath);

        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(uploadsPath, fileName);

        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);

        // Store filename only — full URL reconstructed on SELECT via CONCAT('/uploads/district/', DistrictLogoPath)
        return fileName;
    }
}
