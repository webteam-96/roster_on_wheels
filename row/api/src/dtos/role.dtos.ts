import { defineDto } from "../common/dto";

const str = { type: "string" as const, default: () => "" };
const list = { type: "object" as const, default: () => [] };

/** DTOs/RoleDtos.cs and AdminController.AssignRIDirectorDto. */
export const RoleRequestDto = defineDto({ MemberId: "int", RoleId: { type: "int", default: () => 2 }, ClubId: "int?" });
export type RoleRequest = { memberId: number; roleId: number; clubId: number | null };

export const MemberWithRolesDto = defineDto({
  Id: "int", MemberName: str, EmailId: str, PrimaryMobileNumber: str, Roles: list, HasAdminRole: "bool", HasCredentials: "bool",
  ClubName: "string", DistrictNumber: "string",
});

export const ZonalCoordinatorDto = defineDto({ MemberId: "int", MemberName: str, Email: str, AssignedDate: "datetime?" });
export const AssignZonalCoordinatorDto = defineDto({ MemberId: "int", ZoneId: "int" });
export const ZonalMemberSearchDto = defineDto({ MemberId: "int", MemberName: str, Email: str, ClubName: str, DistrictNumber: str });

export const RIDirectorProfileDto = defineDto({
  MemberId: "int", MemberName: str, Email: "string", Mobile: "string", PhotoPath: "string", City: "string", State: "string",
  RotaryId: "string", AssignedDate: "datetime?", AdminDistricts: list, OtherRoles: list, Clubs: list,
});
export const RIDirectorClubDto = defineDto({
  ClubId: "int", ClubName: str, DistrictNumber: "string", ZoneName: "string", Designation: "string", IsHonorary: "bool", IsClubAdmin: "bool",
});
export const RIDirectorDto = defineDto({
  MemberId: "int", MemberName: str, Email: str, Mobile: "string", AssignedDate: "datetime?", EmailSentCount: "int", EmailLastSentDate: "datetime?",
});
export const AssignRIDirectorDto = defineDto({ MemberId: "int" });
