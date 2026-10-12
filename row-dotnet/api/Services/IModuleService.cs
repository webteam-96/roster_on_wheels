using Microsoft.AspNetCore.Http;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IModuleService
{
    // Categories
    Task<List<ModuleCategoryDto>> GetCategoriesAsync();
    Task<int> CreateCategoryAsync(CreateModuleCategoryDto dto, int createdBy);
    Task UpdateCategoryAsync(int id, UpdateModuleCategoryDto dto, int modifiedBy);
    Task DeleteCategoryAsync(int id, int deletedBy);

    // Modules
    Task<List<ModuleDto>> GetModulesAsync();
    Task<ModuleDto?> GetModuleByIdAsync(int id);
    Task<int> CreateModuleAsync(CreateModuleDto dto, int createdBy);
    Task UpdateModuleAsync(int id, UpdateModuleDto dto, int modifiedBy);
    Task DeleteModuleAsync(int id);
    Task<ModuleUsageCountDto> GetModuleUsageCountAsync(int moduleId);
    Task<string> UploadIconAsync(IFormFile file);

    // Coming Soon (per-module placeholder for non-SuperAdmin during phased data migration)
    Task<List<ModuleComingSoonDto>> GetModulesComingSoonAsync();
    Task UpdateModuleComingSoonAsync(int moduleId, UpdateModuleComingSoonDto dto, int modifiedBy);

    // District Modules
    Task<List<AssignedModuleDto>> GetDistrictModulesAsync(int districtId);
    Task<List<AvailableModuleDto>> GetDistrictAvailableModulesAsync(int districtId);
    Task AssignDistrictModulesAsync(int districtId, List<int> moduleIds, int assignedBy);
    Task UnassignDistrictModulesAsync(int districtId, List<int> moduleIds);
    Task AssignDistrictDefaultModulesAsync(int districtId, int assignedBy);

    // Club Modules
    Task<List<AssignedModuleDto>> GetClubModulesAsync(int clubId);
    Task<List<AvailableModuleDto>> GetClubAvailableModulesAsync(int clubId);
    Task AssignClubModulesAsync(int clubId, List<int> moduleIds, int assignedBy);
    Task UnassignClubModulesAsync(int clubId, List<int> moduleIds);
    Task AssignClubDefaultModulesAsync(int clubId, int assignedBy);

    // One-shot backfill: assigns default club modules to every non-deleted club
    // that currently has ZERO rows in club_modules. Clubs that already have any
    // module (even one) are skipped. Idempotent — safe to run repeatedly.
    Task<(int ClubsTouched, int RowsInserted)> BulkAssignClubDefaultsToEmptyClubsAsync(int assignedBy);

    // Dashboard
    Task<DistrictDashboardDto?> GetDistrictDashboardAsync(int districtId);
    Task<ClubDashboardDto?> GetClubDashboardAsync(int clubId);

    // Mobile member-scoped dashboards — same payload as the web dashboards
    // but module list is filtered by module_master.IsDefaultForMember when
    // the caller is NOT an Admin of that scope. Admin = full module list.
    Task<DistrictDashboardDto?> GetDistrictDashboardForMemberAsync(int districtId, int memberId);
    Task<ClubDashboardDto?> GetClubDashboardForMemberAsync(int clubId, int memberId);
}
