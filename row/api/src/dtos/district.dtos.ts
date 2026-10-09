import { defineDto } from "../common/dto";

const str = { type: "string" as const, default: () => "" };

export const DistrictListDto = defineDto({
  Id: "int", DistrictNumber: str, DistrictLogoPath: "string", IsActive: "bool", CreatedDate: "datetime?",
  FkZoneId: "int?", ZoneName: "string", Country: "string", DefaultCurrency: "string", TotalClubs: "int", TotalMembers: "int",
});

export const DistrictDetailDto = defineDto({
  Id: "int", DistrictNumber: str, DistrictLogoPath: "string", IsActive: "bool", CreatedBy: "int?", CreatedDate: "datetime?",
  ModifiedBy: "int?", ModifiedDate: "datetime?", FkZoneId: "int?", ZoneName: "string", Country: "string", DefaultCurrency: "string",
  TotalClubs: "int", TotalMembers: "int",
});

/** CreateDistrictDto / UpdateDistrictDto. RIZones defaulted Country to "India"; ROW has no default country. */
export const SaveDistrictDto = defineDto({
  DistrictNumber: str, DistrictLogoPath: "string", IsActive: { type: "bool", default: () => true },
  FkZoneId: "int?", Country: "string", DefaultCurrency: "string",
});
export type SaveDistrict = {
  districtNumber: string; districtLogoPath: string | null; isActive: boolean; fkZoneId: number | null; country: string | null; defaultCurrency: string | null;
};

export const UpdateDistrictCurrencyDto = defineDto({ DefaultCurrency: "string" });

export const DistrictMemberDto = defineDto({
  Id: "int", MemberName: str, ProfilePhotoPath: "string", EmailId: "string", PrimaryMobileNumber: "string", RotaryId: "string",
  ClubNames: "string", ClubName: "string", JoinedDate: "datetime?", RoleNames: "string",
  HasDistrictAdminRole: "bool", AllClubsAccess: "bool", HasClubAdminRole: "bool", IsSuperAdmin: "bool",
  // computed in C#: RoleNames split on commas
  Roles: { type: "object", default: () => [] },
});
