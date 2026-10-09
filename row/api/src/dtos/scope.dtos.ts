import { defineDto } from "../common/dto";

/** DTOs/MobileAuthDtos.cs: the scope shapes shared by web login and the mobile context. */

export const RoleScopeDto = defineDto({
  RoleName: "string",
  Scope: "string", // "global" | "zone" | "district" | "club"
  ZoneId: "int?",
  ZoneName: "string",
  DistrictId: "int?",
  DistrictNumber: "string",
  ClubId: "int?",
  ClubName: "string",
});

export const ZoneScopeDto = defineDto({ Id: "int", Name: "string" });

export const DistrictScopeDto = defineDto({
  Id: "int",
  Number: "string",
  ZoneId: "int?",
  TotalClubs: "int",
  TotalMembers: "int",
  IsSynced: "bool",
});

export const ClubScopeDto = defineDto({
  Id: "int",
  Name: "string",
  DistrictId: "int?",
  TotalMembers: "int",
  WebsiteUrl: "string",
  IsSynced: "bool",
});

export const MemberMobileModuleDto = defineDto({
  Id: "int",
  ModuleName: "string",
  ModuleKey: "string",
  IconClass: "string",
  IconPath: "string",
  Description: "string",
  RouteUrl: "string",
  SortOrder: "int",
});

export const MemberMobileClubGroupDto = defineDto({
  ClubId: "int",
  ClubName: "string",
  IsAdmin: "bool",
  Modules: { type: "object", default: () => [] },
});

export const MemberMobileDistrictGroupDto = defineDto({
  DistrictId: "int",
  DistrictNumber: "string",
  IsAdmin: "bool",
  Modules: { type: "object", default: () => [] },
});

export const MemberMobileDashboardDto = defineDto({
  Clubs: { type: "object", default: () => [] },
  Districts: { type: "object", default: () => [] },
});
