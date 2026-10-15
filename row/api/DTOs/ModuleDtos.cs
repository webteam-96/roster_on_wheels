namespace RotaryApi.DTOs;

// Module Category DTOs
public class ModuleCategoryDto
{
    public int Id { get; set; }
    public string CategoryName { get; set; } = "";
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
}

public class CreateModuleCategoryDto
{
    public string CategoryName { get; set; } = "";
    public int SortOrder { get; set; }
}

public class UpdateModuleCategoryDto
{
    public string CategoryName { get; set; } = "";
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

// Module Master DTOs
public class ModuleDto
{
    public int Id { get; set; }
    public string ModuleName { get; set; } = "";
    public string ModuleKey { get; set; } = "";
    public int CategoryId { get; set; }
    public string CategoryName { get; set; } = "";
    public string ModuleLevel { get; set; } = "Both";
    public string? IconClass { get; set; }
    public string? IconPath { get; set; }
    public string? Description { get; set; }
    public string? RouteUrl { get; set; }
    public bool IsDefaultForDistrict { get; set; }
    public bool IsDefaultForClub { get; set; }
    public bool IsDefaultForMember { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
}

public class CreateModuleDto
{
    public string ModuleName { get; set; } = "";
    public string ModuleKey { get; set; } = "";
    public int CategoryId { get; set; }
    public string ModuleLevel { get; set; } = "Both";
    public string? IconClass { get; set; }
    public string? IconPath { get; set; }
    public string? Description { get; set; }
    public string? RouteUrl { get; set; }
    public bool IsDefaultForDistrict { get; set; }
    public bool IsDefaultForClub { get; set; }
    public bool IsDefaultForMember { get; set; }
    public int SortOrder { get; set; }
    // When true, the module is auto-assigned to ALL districts and/or clubs per its ModuleLevel.
    // When false, it is created/edited but assigned to nobody, so SuperAdmin can hand-pick scope
    // (e.g. a Club Dues module visible only to district 5656). Defaults true to keep prior behaviour.
    public bool AssignToAll { get; set; } = true;
}

public class UpdateModuleDto
{
    public string ModuleName { get; set; } = "";
    public string ModuleKey { get; set; } = "";
    public int CategoryId { get; set; }
    public string ModuleLevel { get; set; } = "Both";
    public string? IconClass { get; set; }
    public string? IconPath { get; set; }
    public string? Description { get; set; }
    public string? RouteUrl { get; set; }
    public bool IsDefaultForDistrict { get; set; }
    public bool IsDefaultForClub { get; set; }
    public bool IsDefaultForMember { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
    // See CreateModuleDto.AssignToAll. On edit, checking this pushes the module to all districts/
    // clubs for its level now; unchecked leaves existing assignments untouched (no re-broadcast).
    public bool AssignToAll { get; set; } = true;
}

public class ModuleUsageCountDto
{
    public int DistrictCount { get; set; }
    public int ClubCount { get; set; }
}

// Coming-Soon DTOs (per-module placeholder for non-SuperAdmin during phased data migration)
public class ModuleComingSoonDto
{
    public int ModuleId { get; set; }
    public string ModuleKey { get; set; } = "";
    public string ModuleName { get; set; } = "";
    public bool IsComingSoon { get; set; }
    public DateTime? ComingSoonDate { get; set; }
}

public class UpdateModuleComingSoonDto
{
    public bool IsComingSoon { get; set; }
    public DateTime? ComingSoonDate { get; set; }
}

// Module Assignment DTOs
public class AssignedModuleDto
{
    public int Id { get; set; }
    public int ModuleId { get; set; }
    public string ModuleName { get; set; } = "";
    public string ModuleKey { get; set; } = "";
    public string? IconClass { get; set; }
    public string? IconPath { get; set; }
    public string? Description { get; set; }
    public string? RouteUrl { get; set; }
    public int CategoryId { get; set; }
    public string CategoryName { get; set; } = "";
    public int CategorySortOrder { get; set; }
    public int ModuleSortOrder { get; set; }
    public bool IsEnabled { get; set; }
}

public class AvailableModuleDto
{
    public int ModuleId { get; set; }
    public string ModuleName { get; set; } = "";
    public string ModuleKey { get; set; } = "";
    public string? IconClass { get; set; }
    public string? IconPath { get; set; }
    public int CategoryId { get; set; }
    public string CategoryName { get; set; } = "";
    public int CategorySortOrder { get; set; }
    public int ModuleSortOrder { get; set; }
    public bool IsAssigned { get; set; }
}

public class ModuleAssignRequestDto
{
    public List<int> ModuleIds { get; set; } = new();
}

// Dashboard DTOs
public class DashboardModuleDto
{
    public int ModuleId { get; set; }
    public string ModuleName { get; set; } = "";
    public string ModuleKey { get; set; } = "";
    public string? IconClass { get; set; }
    public string? IconPath { get; set; }
    public string? RouteUrl { get; set; }
    public string? Description { get; set; }
}

public class DashboardCategoryGroupDto
{
    public int CategoryId { get; set; }
    public string CategoryName { get; set; } = "";
    public int SortOrder { get; set; }
    public List<DashboardModuleDto> Modules { get; set; } = new();
}

public class DistrictDashboardDto
{
    public int DistrictId { get; set; }
    public string DistrictNumber { get; set; } = "";
    public string? DistrictLogoPath { get; set; }
    public List<DashboardCategoryGroupDto> ModuleGroups { get; set; } = new();
}

public class ClubDashboardDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public string? ClubLogoPath { get; set; }
    public string DistrictNumber { get; set; } = "";
    public List<DashboardCategoryGroupDto> ModuleGroups { get; set; } = new();
}
