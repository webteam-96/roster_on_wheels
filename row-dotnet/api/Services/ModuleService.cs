using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class ModuleService : IModuleService
{
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;

    public ModuleService(IConfiguration configuration, IWebHostEnvironment env)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _env = env;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // CATEGORIES
    public async Task<List<ModuleCategoryDto>> GetCategoriesAsync()
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<ModuleCategoryDto>(
            "sp_module_category_get_all", commandType: CommandType.StoredProcedure)).ToList();
    }

    public async Task<int> CreateCategoryAsync(CreateModuleCategoryDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.ExecuteScalarAsync<int>(
            "sp_module_category_create",
            new { p_CategoryName = dto.CategoryName.Trim(), p_SortOrder = dto.SortOrder, p_CreatedBy = createdBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task UpdateCategoryAsync(int id, UpdateModuleCategoryDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_module_category_update",
            new { p_Id = id, p_CategoryName = dto.CategoryName.Trim(), p_SortOrder = dto.SortOrder, p_IsActive = dto.IsActive ? 1 : 0, p_ModifiedBy = modifiedBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task DeleteCategoryAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_module_category_delete",
            new { p_Id = id, p_DeletedBy = deletedBy },
            commandType: CommandType.StoredProcedure);
    }

    // MODULES
    // NOTE: Module get/create/update converted to inline SQL (instead of the
    // sp_module_* stored procedures) so the new IsDefaultForMember column
    // flows through without requiring an SP redeploy — the existing SPs were
    // created by a higher-privilege MySQL user and can't be dropped by the
    // current connection. See feedback on SYSTEM_USER privilege issue.
    private const string ModuleSelectColumns = @"
        pk_module_id           AS Id,
        ModuleName             AS ModuleName,
        ModuleKey              AS ModuleKey,
        fk_category_id         AS CategoryId,
        (SELECT CategoryName FROM module_categories c WHERE c.pk_category_id = m.fk_category_id) AS CategoryName,
        ModuleLevel            AS ModuleLevel,
        IconClass              AS IconClass,
        IconPath               AS IconPath,
        Description            AS Description,
        RouteUrl               AS RouteUrl,
        IsDefaultForDistrict   AS IsDefaultForDistrict,
        IsDefaultForClub       AS IsDefaultForClub,
        IsDefaultForMember     AS IsDefaultForMember,
        SortOrder              AS SortOrder,
        IsActive               AS IsActive";

    public async Task<List<ModuleDto>> GetModulesAsync()
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<ModuleDto>(
            $@"SELECT {ModuleSelectColumns}
               FROM module_master m
               WHERE isdeleted = 0
               ORDER BY SortOrder, ModuleName")).ToList();
    }

    public async Task<ModuleDto?> GetModuleByIdAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.QueryFirstOrDefaultAsync<ModuleDto>(
            $@"SELECT {ModuleSelectColumns}
               FROM module_master m
               WHERE pk_module_id = @Id AND isdeleted = 0",
            new { Id = id });
    }

    public async Task<int> CreateModuleAsync(CreateModuleDto dto, int createdBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var moduleId = await connection.ExecuteScalarAsync<int>(@"
            INSERT INTO module_master
                (ModuleName, ModuleKey, fk_category_id, ModuleLevel, IconClass, IconPath, Description, RouteUrl,
                 IsDefaultForDistrict, IsDefaultForClub, IsDefaultForMember, SortOrder, IsActive, created_by, created_date)
            VALUES
                (@ModuleName, @ModuleKey, @CategoryId, @ModuleLevel, @IconClass, @IconPath, @Description, @RouteUrl,
                 @IsDefaultForDistrict, @IsDefaultForClub, @IsDefaultForMember, @SortOrder, 1, @CreatedBy, NOW());
            SELECT LAST_INSERT_ID();",
            new
            {
                ModuleName = dto.ModuleName.Trim(),
                ModuleKey = dto.ModuleKey.Trim(),
                dto.CategoryId,
                dto.ModuleLevel,
                dto.IconClass,
                dto.IconPath,
                dto.Description,
                dto.RouteUrl,
                IsDefaultForDistrict = dto.IsDefaultForDistrict ? 1 : 0,
                IsDefaultForClub = dto.IsDefaultForClub ? 1 : 0,
                IsDefaultForMember = dto.IsDefaultForMember ? 1 : 0,
                dto.SortOrder,
                CreatedBy = createdBy
            });

        // Auto-assign the new module to every district and/or club per its Module Level —
        // only when the SuperAdmin ticked "Assign to all". Unticked = create it unassigned so
        // it can be hand-scoped (e.g. a Club Dues module for district 5656 only).
        if (dto.AssignToAll)
            await PropagateModuleByLevelAsync(connection, moduleId, dto.ModuleLevel, createdBy);
        return moduleId;
    }

    // Grants a module to ALL districts and/or ALL clubs according to its ModuleLevel:
    //   Both     -> all districts + all clubs
    //   District -> all districts
    //   Club     -> all clubs
    // Level ALONE drives this (per the SuperAdmin's decision) — the IsDefaultFor* flags are
    // NOT consulted here; they still feed the separate "backfill defaults to empty clubs" button.
    //
    // INSERT IGNORE + the UNIQUE (district|club, module) keys make it idempotent and purely
    // ADDITIVE: existing assignments are left exactly as-is, so widening a level on edit only
    // fills the newly-covered scope and never disturbs manual per-club/district customisation.
    // Narrowing a level does NOT remove rows — removal is deliberately not automatic.
    private static async Task PropagateModuleByLevelAsync(MySqlConnection connection, int moduleId, string? moduleLevel, int assignedBy)
    {
        var level = (moduleLevel ?? "Both").Trim();

        if (level == "District" || level == "Both")
        {
            await connection.ExecuteAsync(@"
                INSERT IGNORE INTO district_modules (fk_district_id, fk_module_id, IsEnabled, AssignedBy)
                SELECT d.pk_district_id, @ModuleId, 1, @AssignedBy
                FROM district_master d
                WHERE d.isdeleted = 0",
                new { ModuleId = moduleId, AssignedBy = assignedBy });
        }

        if (level == "Club" || level == "Both")
        {
            await connection.ExecuteAsync(@"
                INSERT IGNORE INTO club_modules (fk_club_id, fk_module_id, IsEnabled, AssignedBy)
                SELECT c.pk_club_id, @ModuleId, 1, @AssignedBy
                FROM club_master c
                WHERE c.isdeleted = 0",
                new { ModuleId = moduleId, AssignedBy = assignedBy });
        }
    }

    public async Task UpdateModuleAsync(int id, UpdateModuleDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(@"
            UPDATE module_master SET
                ModuleName = @ModuleName,
                ModuleKey = @ModuleKey,
                fk_category_id = @CategoryId,
                ModuleLevel = @ModuleLevel,
                IconClass = @IconClass,
                IconPath = @IconPath,
                Description = @Description,
                RouteUrl = @RouteUrl,
                IsDefaultForDistrict = @IsDefaultForDistrict,
                IsDefaultForClub = @IsDefaultForClub,
                IsDefaultForMember = @IsDefaultForMember,
                SortOrder = @SortOrder,
                IsActive = @IsActive,
                modified_by = @ModifiedBy,
                modified_date = NOW()
            WHERE pk_module_id = @Id AND isdeleted = 0",
            new
            {
                Id = id,
                ModuleName = dto.ModuleName.Trim(),
                ModuleKey = dto.ModuleKey.Trim(),
                dto.CategoryId,
                dto.ModuleLevel,
                dto.IconClass,
                dto.IconPath,
                dto.Description,
                dto.RouteUrl,
                IsDefaultForDistrict = dto.IsDefaultForDistrict ? 1 : 0,
                IsDefaultForClub = dto.IsDefaultForClub ? 1 : 0,
                IsDefaultForMember = dto.IsDefaultForMember ? 1 : 0,
                dto.SortOrder,
                IsActive = dto.IsActive ? 1 : 0,
                ModifiedBy = modifiedBy
            });

        // Edit propagates only when "Assign to all" is ticked. Additive + idempotent, so
        // widening the level (e.g. Club -> Both) fills the newly-covered scope; re-saving an
        // unchanged level is a no-op. Narrowing never removes rows. Unticked = leave the
        // module's current per-district/club assignments exactly as they are (no re-broadcast).
        if (dto.AssignToAll)
            await PropagateModuleByLevelAsync(connection, id, dto.ModuleLevel, modifiedBy);
    }

    public async Task DeleteModuleAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Remove the module's per-district and per-club assignments FIRST. The FK on both
        // join tables is ON DELETE CASCADE, so deleting the module row should clear these
        // automatically — but prod runs Database:SkipInit=true, so if a table was ever
        // created without that FK the cascade silently wouldn't fire and orphan assignment
        // rows would linger. Doing it explicitly makes removal deterministic either way.
        // These are assignment join tables (no isdeleted column) — hard delete is correct
        // and matches how the FK cascade would behave.
        await connection.ExecuteAsync(
            "DELETE FROM district_modules WHERE fk_module_id = @Id", new { Id = id });
        await connection.ExecuteAsync(
            "DELETE FROM club_modules WHERE fk_module_id = @Id", new { Id = id });

        await connection.ExecuteAsync(
            "sp_module_delete",
            new { p_Id = id },
            commandType: CommandType.StoredProcedure);
    }

    public async Task<ModuleUsageCountDto> GetModuleUsageCountAsync(int moduleId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await connection.QueryFirstAsync<ModuleUsageCountDto>(
            "sp_module_get_usage_count",
            new { p_ModuleId = moduleId },
            commandType: CommandType.StoredProcedure);
    }

    // DISTRICT MODULES
    // Inline SQL (not sp_district_modules_get) so the IsActive filter is guaranteed to apply
    // regardless of the SYSTEM_USER SP-update issue — inactive modules must not show on the dashboard.
    private async Task<List<AssignedModuleDto>> QueryDistrictModulesAsync(MySqlConnection connection, int districtId)
    {
        return (await connection.QueryAsync<AssignedModuleDto>(@"
            SELECT dm.pk_district_module_id AS Id, dm.fk_module_id AS ModuleId,
                   m.ModuleName, m.ModuleKey, m.IconClass, m.IconPath, m.Description, m.RouteUrl,
                   m.fk_category_id AS CategoryId, c.CategoryName,
                   c.SortOrder AS CategorySortOrder, m.SortOrder AS ModuleSortOrder,
                   dm.IsEnabled
            FROM district_modules dm
            JOIN module_master m ON m.pk_module_id = dm.fk_module_id AND m.isdeleted = 0 AND m.IsActive = 1
            JOIN module_categories c ON c.pk_category_id = m.fk_category_id AND c.isdeleted = 0
            WHERE dm.fk_district_id = @DistrictId
            ORDER BY c.SortOrder, m.SortOrder",
            new { DistrictId = districtId })).ToList();
    }

    public async Task<List<AssignedModuleDto>> GetDistrictModulesAsync(int districtId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await QueryDistrictModulesAsync(connection, districtId);
    }

    public async Task<List<AvailableModuleDto>> GetDistrictAvailableModulesAsync(int districtId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<AvailableModuleDto>(
            "sp_district_modules_get_available",
            new { p_DistrictId = districtId },
            commandType: CommandType.StoredProcedure)).ToList();
    }

    public async Task AssignDistrictModulesAsync(int districtId, List<int> moduleIds, int assignedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        foreach (var moduleId in moduleIds)
        {
            await connection.ExecuteAsync(
                "sp_district_modules_assign",
                new { p_DistrictId = districtId, p_ModuleId = moduleId, p_AssignedBy = assignedBy },
                commandType: CommandType.StoredProcedure);
        }
    }

    public async Task UnassignDistrictModulesAsync(int districtId, List<int> moduleIds)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        foreach (var moduleId in moduleIds)
        {
            await connection.ExecuteAsync(
                "sp_district_modules_unassign",
                new { p_DistrictId = districtId, p_ModuleId = moduleId },
                commandType: CommandType.StoredProcedure);
        }
    }

    public async Task AssignDistrictDefaultModulesAsync(int districtId, int assignedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_district_modules_assign_defaults",
            new { p_DistrictId = districtId, p_AssignedBy = assignedBy },
            commandType: CommandType.StoredProcedure);
    }

    // CLUB MODULES
    // Inline SQL (not sp_club_modules_get) so the IsActive filter is guaranteed to apply
    // even if the SP update is skipped due to the SYSTEM_USER privilege issue. An inactive
    // module (module_master.IsActive=0) must NOT appear on the club dashboard.
    private async Task<List<AssignedModuleDto>> QueryClubModulesAsync(MySqlConnection connection, int clubId)
    {
        return (await connection.QueryAsync<AssignedModuleDto>(@"
            SELECT cm.pk_club_module_id AS Id, cm.fk_module_id AS ModuleId,
                   m.ModuleName, m.ModuleKey, m.IconClass, m.IconPath, m.Description, m.RouteUrl,
                   m.fk_category_id AS CategoryId, c.CategoryName,
                   c.SortOrder AS CategorySortOrder, m.SortOrder AS ModuleSortOrder,
                   cm.IsEnabled
            FROM club_modules cm
            JOIN module_master m ON m.pk_module_id = cm.fk_module_id AND m.isdeleted = 0 AND m.IsActive = 1
            JOIN module_categories c ON c.pk_category_id = m.fk_category_id AND c.isdeleted = 0
            WHERE cm.fk_club_id = @ClubId
            ORDER BY c.SortOrder, m.SortOrder",
            new { ClubId = clubId })).ToList();
    }

    public async Task<List<AssignedModuleDto>> GetClubModulesAsync(int clubId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return await QueryClubModulesAsync(connection, clubId);
    }

    public async Task<List<AvailableModuleDto>> GetClubAvailableModulesAsync(int clubId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<AvailableModuleDto>(
            "sp_club_modules_get_available",
            new { p_ClubId = clubId },
            commandType: CommandType.StoredProcedure)).ToList();
    }

    public async Task AssignClubModulesAsync(int clubId, List<int> moduleIds, int assignedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        foreach (var moduleId in moduleIds)
        {
            await connection.ExecuteAsync(
                "sp_club_modules_assign",
                new { p_ClubId = clubId, p_ModuleId = moduleId, p_AssignedBy = assignedBy },
                commandType: CommandType.StoredProcedure);
        }
    }

    public async Task UnassignClubModulesAsync(int clubId, List<int> moduleIds)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        foreach (var moduleId in moduleIds)
        {
            await connection.ExecuteAsync(
                "sp_club_modules_unassign",
                new { p_ClubId = clubId, p_ModuleId = moduleId },
                commandType: CommandType.StoredProcedure);
        }
    }

    public async Task AssignClubDefaultModulesAsync(int clubId, int assignedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            "sp_club_modules_assign_defaults",
            new { p_ClubId = clubId, p_AssignedBy = assignedBy },
            commandType: CommandType.StoredProcedure);
    }

    public async Task<(int ClubsTouched, int RowsInserted)> BulkAssignClubDefaultsToEmptyClubsAsync(int assignedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Count clubs that currently have zero club_modules rows (only non-deleted clubs).
        var clubsTouched = await connection.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_master c
            WHERE c.isdeleted = 0
              AND NOT EXISTS (
                  SELECT 1 FROM club_modules cm WHERE cm.fk_club_id = c.pk_club_id
              )");

        if (clubsTouched == 0) return (0, 0);

        // Single-pass cross-join INSERT — only fires for clubs with no existing module
        // rows, so it never disturbs clubs that have been manually customised.
        var rowsInserted = await connection.ExecuteAsync(@"
            INSERT IGNORE INTO club_modules (fk_club_id, fk_module_id, IsEnabled, AssignedBy)
            SELECT c.pk_club_id, m.pk_module_id, 1, @AssignedBy
            FROM club_master c
            CROSS JOIN module_master m
            WHERE c.isdeleted = 0
              AND m.IsDefaultForClub = 1
              AND m.ModuleLevel IN ('Club', 'Both')
              AND m.IsActive = 1
              AND m.isdeleted = 0
              AND NOT EXISTS (
                  SELECT 1 FROM club_modules cm WHERE cm.fk_club_id = c.pk_club_id
              )",
            new { AssignedBy = assignedBy });

        return (clubsTouched, rowsInserted);
    }

    // DASHBOARD
    public async Task<DistrictDashboardDto?> GetDistrictDashboardAsync(int districtId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var district = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "sp_district_dashboard_get",
            new { p_DistrictId = districtId },
            commandType: CommandType.StoredProcedure);

        if (district == null) return null;

        var modules = await QueryDistrictModulesAsync(connection, districtId);

        // Check if zone has Zonal Awards enabled for this district
        var zonalAwardsEnabled = await connection.ExecuteScalarAsync<bool?>(@"
            SELECT z.IsZonalAwardsEnabled FROM zone_master z
            JOIN district_master d ON d.fk_zone_id = z.pk_zone_id
            WHERE d.pk_district_id = @DistrictId AND d.isdeleted = 0 AND z.isdeleted = 0",
            new { DistrictId = districtId });

        var groups = modules
            .Where(m => m.IsEnabled)
            .Where(m => m.ModuleKey != "zonal_awards" || (zonalAwardsEnabled == true))
            .GroupBy(m => new { m.CategoryId, m.CategoryName, m.CategorySortOrder })
            .OrderBy(g => g.Key.CategorySortOrder)
            .Select(g => new DashboardCategoryGroupDto
            {
                CategoryId = g.Key.CategoryId,
                CategoryName = g.Key.CategoryName,
                SortOrder = g.Key.CategorySortOrder,
                Modules = g.OrderBy(m => m.ModuleSortOrder).Select(m => new DashboardModuleDto
                {
                    ModuleId = m.ModuleId,
                    ModuleName = m.ModuleName,
                    ModuleKey = m.ModuleKey,
                    IconClass = m.IconClass,
                    IconPath = m.IconPath,
                    RouteUrl = m.RouteUrl,
                    Description = m.Description
                }).ToList()
            }).ToList();

        return new DistrictDashboardDto
        {
            DistrictId = (int)district.Id,
            DistrictNumber = (string)district.DistrictNumber,
            DistrictLogoPath = (string?)district.DistrictLogoPath,
            ModuleGroups = groups
        };
    }

    public async Task<ClubDashboardDto?> GetClubDashboardAsync(int clubId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var club = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "sp_club_dashboard_get",
            new { p_ClubId = clubId },
            commandType: CommandType.StoredProcedure);

        if (club == null) return null;

        var modules = await QueryClubModulesAsync(connection, clubId);

        var groups = modules
            .Where(m => m.IsEnabled)
            .GroupBy(m => new { m.CategoryId, m.CategoryName, m.CategorySortOrder })
            .OrderBy(g => g.Key.CategorySortOrder)
            .Select(g => new DashboardCategoryGroupDto
            {
                CategoryId = g.Key.CategoryId,
                CategoryName = g.Key.CategoryName,
                SortOrder = g.Key.CategorySortOrder,
                Modules = g.OrderBy(m => m.ModuleSortOrder).Select(m => new DashboardModuleDto
                {
                    ModuleId = m.ModuleId,
                    ModuleName = m.ModuleName,
                    ModuleKey = m.ModuleKey,
                    IconClass = m.IconClass,
                    IconPath = m.IconPath,
                    RouteUrl = m.RouteUrl,
                    Description = m.Description
                }).ToList()
            }).ToList();

        return new ClubDashboardDto
        {
            ClubId = (int)club.Id,
            ClubName = (string)club.ClubName,
            ClubLogoPath = (string?)club.ClubLogoPath,
            DistrictNumber = (string)club.DistrictNumber,
            ModuleGroups = groups
        };
    }

    // ── Mobile member-scoped dashboards ─────────────────────────────────
    // Mirror of GetDistrictDashboardAsync / GetClubDashboardAsync, but the
    // module list is filtered by module_master.IsDefaultForMember = 1 when
    // the caller isn't an Admin of that scope. Admin sees the full list.

    private async Task<bool> IsAdminOfDistrictAsync(MySqlConnection conn, int districtId, int memberId)
    {
        return await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles mr
            JOIN roles r ON r.pk_role_id = mr.fk_role_id
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND r.RoleName IN ('Admin','SuperAdmin')
              AND mr.IsActive = 1 AND mr.isdeleted = 0
              AND (
                  r.RoleName = 'SuperAdmin'
                  OR mr.fk_district_id = @DistrictId
              )",
            new { MemberId = memberId, DistrictId = districtId }) > 0;
    }

    private async Task<bool> IsAdminOfClubAsync(MySqlConnection conn, int clubId, int memberId)
    {
        return await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles mr
            JOIN roles r ON r.pk_role_id = mr.fk_role_id
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND r.RoleName IN ('Admin','SuperAdmin')
              AND mr.IsActive = 1 AND mr.isdeleted = 0
              AND (
                  r.RoleName = 'SuperAdmin'
                  OR mr.fk_club_id = @ClubId
              )",
            new { MemberId = memberId, ClubId = clubId }) > 0;
    }

    public async Task<DistrictDashboardDto?> GetDistrictDashboardForMemberAsync(int districtId, int memberId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var district = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "sp_district_dashboard_get",
            new { p_DistrictId = districtId },
            commandType: CommandType.StoredProcedure);
        if (district == null) return null;

        bool isAdmin = await IsAdminOfDistrictAsync(connection, districtId, memberId);
        var modules = await QueryDistrictModulesAsync(connection, districtId);

        // Member-mode → keep only modules flagged IsDefaultForMember = 1.
        if (!isAdmin)
        {
            var memberKeys = (await connection.QueryAsync<string>(@"
                SELECT ModuleKey FROM module_master
                WHERE IsDefaultForMember = 1 AND IsActive = 1 AND isdeleted = 0"))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            modules = modules.Where(m => memberKeys.Contains(m.ModuleKey)).ToList();
        }

        var zonalAwardsEnabled = await connection.ExecuteScalarAsync<bool?>(@"
            SELECT z.IsZonalAwardsEnabled FROM zone_master z
            JOIN district_master d ON d.fk_zone_id = z.pk_zone_id
            WHERE d.pk_district_id = @DistrictId AND d.isdeleted = 0 AND z.isdeleted = 0",
            new { DistrictId = districtId });

        var groups = modules
            .Where(m => m.IsEnabled)
            .Where(m => m.ModuleKey != "zonal_awards" || (zonalAwardsEnabled == true))
            .GroupBy(m => new { m.CategoryId, m.CategoryName, m.CategorySortOrder })
            .OrderBy(g => g.Key.CategorySortOrder)
            .Select(g => new DashboardCategoryGroupDto
            {
                CategoryId = g.Key.CategoryId,
                CategoryName = g.Key.CategoryName,
                SortOrder = g.Key.CategorySortOrder,
                Modules = g.OrderBy(m => m.ModuleSortOrder).Select(m => new DashboardModuleDto
                {
                    ModuleId = m.ModuleId,
                    ModuleName = m.ModuleName,
                    ModuleKey = m.ModuleKey,
                    IconClass = m.IconClass,
                    IconPath = m.IconPath,
                    RouteUrl = m.RouteUrl,
                    Description = m.Description
                }).ToList()
            }).ToList();

        return new DistrictDashboardDto
        {
            DistrictId = (int)district.Id,
            DistrictNumber = (string)district.DistrictNumber,
            DistrictLogoPath = (string?)district.DistrictLogoPath,
            ModuleGroups = groups
        };
    }

    public async Task<ClubDashboardDto?> GetClubDashboardForMemberAsync(int clubId, int memberId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var club = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "sp_club_dashboard_get",
            new { p_ClubId = clubId },
            commandType: CommandType.StoredProcedure);
        if (club == null) return null;

        bool isAdmin = await IsAdminOfClubAsync(connection, clubId, memberId);
        var modules = await QueryClubModulesAsync(connection, clubId);

        if (!isAdmin)
        {
            var memberKeys = (await connection.QueryAsync<string>(@"
                SELECT ModuleKey FROM module_master
                WHERE IsDefaultForMember = 1 AND IsActive = 1 AND isdeleted = 0"))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            modules = modules.Where(m => memberKeys.Contains(m.ModuleKey)).ToList();
        }

        var groups = modules
            .Where(m => m.IsEnabled)
            .GroupBy(m => new { m.CategoryId, m.CategoryName, m.CategorySortOrder })
            .OrderBy(g => g.Key.CategorySortOrder)
            .Select(g => new DashboardCategoryGroupDto
            {
                CategoryId = g.Key.CategoryId,
                CategoryName = g.Key.CategoryName,
                SortOrder = g.Key.CategorySortOrder,
                Modules = g.OrderBy(m => m.ModuleSortOrder).Select(m => new DashboardModuleDto
                {
                    ModuleId = m.ModuleId,
                    ModuleName = m.ModuleName,
                    ModuleKey = m.ModuleKey,
                    IconClass = m.IconClass,
                    IconPath = m.IconPath,
                    RouteUrl = m.RouteUrl,
                    Description = m.Description
                }).ToList()
            }).ToList();

        return new ClubDashboardDto
        {
            ClubId = (int)club.Id,
            ClubName = (string)club.ClubName,
            ClubLogoPath = (string?)club.ClubLogoPath,
            DistrictNumber = (string)club.DistrictNumber,
            ModuleGroups = groups
        };
    }

    public async Task<string> UploadIconAsync(IFormFile file)
    {
        var uploadsPath = Path.Combine(_env.WebRootPath, "uploads", "module");
        Directory.CreateDirectory(uploadsPath);

        var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(uploadsPath, fileName);

        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);

        return $"/uploads/module/{fileName}";
    }

    // ── Coming Soon ───────────────────────────────────────────────
    // Inline SQL (additive — does not touch existing module SPs).
    public async Task<List<ModuleComingSoonDto>> GetModulesComingSoonAsync()
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        return (await connection.QueryAsync<ModuleComingSoonDto>(@"
            SELECT pk_module_id AS ModuleId,
                   ModuleKey,
                   ModuleName,
                   IFNULL(IsComingSoon, 0) AS IsComingSoon,
                   ComingSoonDate
            FROM module_master
            WHERE isdeleted = 0
            ORDER BY SortOrder, ModuleName")).ToList();
    }

    public async Task UpdateModuleComingSoonAsync(int moduleId, UpdateModuleComingSoonDto dto, int modifiedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(@"
            UPDATE module_master
            SET IsComingSoon = @IsComingSoon,
                ComingSoonDate = @ComingSoonDate,
                modified_by = @ModifiedBy,
                modified_date = NOW()
            WHERE pk_module_id = @Id AND isdeleted = 0",
            new
            {
                Id = moduleId,
                IsComingSoon = dto.IsComingSoon ? 1 : 0,
                ComingSoonDate = dto.IsComingSoon ? dto.ComingSoonDate : (DateTime?)null,
                ModifiedBy = modifiedBy
            });
    }
}
