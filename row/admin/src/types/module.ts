// Module Category
export interface ModuleCategory {
  id: number;
  categoryName: string;
  sortOrder: number;
  isActive: boolean;
}

export interface CreateModuleCategoryRequest {
  categoryName: string;
  sortOrder: number;
}

export interface UpdateModuleCategoryRequest {
  categoryName: string;
  sortOrder: number;
  isActive: boolean;
}

// Module Master
export interface Module {
  id: number;
  moduleName: string;
  moduleKey: string;
  categoryId: number;
  categoryName: string;
  moduleLevel: string;
  iconClass: string | null;
  iconPath: string | null;
  description: string | null;
  routeUrl: string | null;
  isDefaultForDistrict: boolean;
  isDefaultForClub: boolean;
  isDefaultForMember: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface CreateModuleRequest {
  moduleName: string;
  moduleKey: string;
  categoryId: number;
  moduleLevel: string;
  iconClass?: string;
  iconPath?: string;
  description?: string;
  routeUrl?: string;
  isDefaultForDistrict: boolean;
  isDefaultForClub: boolean;
  isDefaultForMember: boolean;
  sortOrder: number;
  assignToAll: boolean;
}

export interface UpdateModuleRequest {
  moduleName: string;
  moduleKey: string;
  categoryId: number;
  moduleLevel: string;
  iconClass?: string;
  iconPath?: string;
  description?: string;
  routeUrl?: string;
  isDefaultForDistrict: boolean;
  isDefaultForClub: boolean;
  isDefaultForMember: boolean;
  sortOrder: number;
  isActive: boolean;
  assignToAll: boolean;
}

export interface ModuleUsageCount {
  districtCount: number;
  clubCount: number;
}

export interface ModuleComingSoonInfo {
  moduleId: number;
  moduleKey: string;
  moduleName: string;
  isComingSoon: boolean;
  comingSoonDate: string | null;
}

export interface UpdateModuleComingSoonRequest {
  isComingSoon: boolean;
  comingSoonDate: string | null;
}

// Module Assignment
export interface AssignedModule {
  id: number;
  moduleId: number;
  moduleName: string;
  moduleKey: string;
  iconClass: string | null;
  iconPath: string | null;
  description: string | null;
  routeUrl: string | null;
  categoryId: number;
  categoryName: string;
  categorySortOrder: number;
  moduleSortOrder: number;
  isEnabled: boolean;
}

export interface AvailableModule {
  moduleId: number;
  moduleName: string;
  moduleKey: string;
  iconClass: string | null;
  iconPath: string | null;
  categoryId: number;
  categoryName: string;
  categorySortOrder: number;
  moduleSortOrder: number;
  isAssigned: boolean;
}

// Dashboard
export interface DashboardModule {
  moduleId: number;
  moduleName: string;
  moduleKey: string;
  iconClass: string | null;
  iconPath: string | null;
  routeUrl: string | null;
  description: string | null;
}

export interface DashboardCategoryGroup {
  categoryId: number;
  categoryName: string;
  sortOrder: number;
  modules: DashboardModule[];
}

export interface DistrictDashboard {
  districtId: number;
  districtNumber: string;
  districtLogoPath: string | null;
  moduleGroups: DashboardCategoryGroup[];
}

export interface ClubDashboard {
  clubId: number;
  clubName: string;
  clubLogoPath: string | null;
  districtNumber: string;
  moduleGroups: DashboardCategoryGroup[];
}
