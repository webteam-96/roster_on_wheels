import { defineDto } from "../common/dto";

const str = { type: "string" as const, default: () => "" };
const list = { type: "object" as const, default: () => [] };

/** DTOs/ModuleDtos.cs */
export const ModuleCategoryDto = defineDto({ Id: "int", CategoryName: str, SortOrder: "int", IsActive: "bool" });
export const SaveModuleCategoryDto = defineDto({ CategoryName: str, SortOrder: "int", IsActive: { type: "bool", default: () => true } });

export const ModuleDto = defineDto({
  Id: "int", ModuleName: str, ModuleKey: str, CategoryId: "int", CategoryName: str, ModuleLevel: { type: "string", default: () => "Both" },
  IconClass: "string", IconPath: "string", Description: "string", RouteUrl: "string", IsDefaultForDistrict: "bool",
  IsDefaultForClub: "bool", IsDefaultForMember: "bool", SortOrder: "int", IsActive: "bool",
});

/** CreateModuleDto / UpdateModuleDto (Update adds IsActive). */
export const SaveModuleDto = defineDto({
  ModuleName: str, ModuleKey: str, CategoryId: "int", ModuleLevel: { type: "string", default: () => "Both" }, IconClass: "string",
  IconPath: "string", Description: "string", RouteUrl: "string", IsDefaultForDistrict: "bool", IsDefaultForClub: "bool",
  IsDefaultForMember: "bool", SortOrder: "int", IsActive: { type: "bool", default: () => true }, AssignToAll: { type: "bool", default: () => true },
});
export type SaveModule = {
  moduleName: string; moduleKey: string; categoryId: number; moduleLevel: string; iconClass: string | null; iconPath: string | null;
  description: string | null; routeUrl: string | null; isDefaultForDistrict: boolean; isDefaultForClub: boolean; isDefaultForMember: boolean;
  sortOrder: number; isActive: boolean; assignToAll: boolean;
};

export const ModuleUsageCountDto = defineDto({ DistrictCount: "int", ClubCount: "int" });

export const AssignedModuleDto = defineDto({
  Id: "int", ModuleId: "int", ModuleName: str, ModuleKey: str, IconClass: "string", IconPath: "string", Description: "string",
  RouteUrl: "string", CategoryId: "int", CategoryName: str, CategorySortOrder: "int", ModuleSortOrder: "int", IsEnabled: "bool",
});

export const AvailableModuleDto = defineDto({
  ModuleId: "int", ModuleName: str, ModuleKey: str, IconClass: "string", IconPath: "string", CategoryId: "int", CategoryName: str,
  CategorySortOrder: "int", ModuleSortOrder: "int", IsAssigned: "bool",
});

export const DashboardModuleDto = defineDto({
  ModuleId: "int", ModuleName: str, ModuleKey: str, IconClass: "string", IconPath: "string", RouteUrl: "string", Description: "string",
});
export const DashboardCategoryGroupDto = defineDto({ CategoryId: "int", CategoryName: str, SortOrder: "int", Modules: list });
export const DistrictDashboardDto = defineDto({ DistrictId: "int", DistrictNumber: str, DistrictLogoPath: "string", ModuleGroups: list });
export const ClubDashboardDto = defineDto({ ClubId: "int", ClubName: str, ClubLogoPath: "string", DistrictNumber: str, ModuleGroups: list });

export const ModuleComingSoonDto = defineDto({ ModuleId: "int", ModuleKey: str, ModuleName: str, IsComingSoon: "bool", ComingSoonDate: "datetime?" });
export const UpdateModuleComingSoonDto = defineDto({ IsComingSoon: "bool", ComingSoonDate: "string" });
