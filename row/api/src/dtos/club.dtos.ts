import { defineDto } from "../common/dto";

const str = { type: "string" as const, default: () => "" };

/** DTOs/ClubDtos.cs ClubListDto (also returned by api/districts/{id}/clubs). */
export const ClubListDto = defineDto({
  Id: "int", FkDistrictId: "int", DistrictNumber: str, ClubRotaryId: str, ClubName: str, ClubLogoPath: "string",
  MeetingDay: "string", MeetingFromTime: "timespan?", MeetingToTime: "timespan?", City: "string", State: "string",
  IsActive: "bool", CreatedDate: "datetime?", TotalMembers: "int", HonoraryMembers: "int", IsSyncedFromRotaryOrg: "bool",
  WebsiteSubdomain: "string", WebsiteClientDomain: "string", WebsiteEndDate: "datetime?", WebsiteStatus: "string",
});

export const ClubDetailDto = defineDto({
  Id: "int", FkDistrictId: "int", DistrictNumber: str, ClubRotaryId: str, ClubName: str,
  Timezone: "string", ClubCharterDate: "datetime?", ClubLogoPath: "string", ClubWebsite: "string",
  MeetingDay: "string", MeetingFromTime: "timespan?", MeetingToTime: "timespan?", MeetingAddress: "string",
  Country: "string", DistrictCountry: "string", DistrictDefaultCurrency: "string", State: "string", City: "string", Pincode: "string",
  Latitude: "decimal?", Longitude: "decimal?", ActiveFromDate: "datetime?", ActiveToDate: "datetime?",
  IsAutomaticMeetingReminder: "bool", IsFamilyLogin: "bool", IsActive: "bool",
  CreatedBy: "int?", CreatedDate: "datetime?", ModifiedBy: "int?", ModifiedDate: "datetime?", TotalMembers: "int",
});

export const ClubMemberDto = defineDto({
  Id: "int", MemberName: str, ProfilePhotoPath: "string", EmailId: "string", PrimaryMobileNumber: "string", RotaryId: "string",
  JoinedDate: "datetime?", ClubMemberId: "int", MembershipActive: "bool", IsHonorary: "bool",
  Roles: { type: "object", default: () => [] }, HasAdminRole: "bool", Designation: "string", ClassificationProfession: "string",
  CogDistrictNumber: "string", CogYear: "string",
});

export const TerminatedMemberDto = defineDto({
  Id: "int", RotaryId: "string", MemberName: str, JoinedDate: "datetime?", TerminationDate: "datetime?", TerminationReason: "string",
});

export const MemberRemovalPreviewDto = defineDto({
  MemberId: "int", MemberName: str, EmailId: "string", ClubId: "int", ClubName: str, IsLastClub: "bool",
  OtherClubs: { type: "object", default: () => [] },
  RolesInThisClub: { type: "object", default: () => [] },
  AllRoleNames: { type: "object", default: () => [] },
  BodEntries: { type: "object", default: () => [] },
  DcCommitteeMemberships: { type: "object", default: () => [] },
  DcGroupMemberships: { type: "object", default: () => [] },
  SubGroupMemberships: { type: "object", default: () => [] },
});
export const OtherClubInfo = defineDto({ ClubId: "int", ClubName: str });
export const BodEntry = defineDto({ DesignationName: str, YearLabel: str });
export const DcCommitteeEntry = defineDto({ Designation: str, YearLabel: str, DistrictNumber: str });
export const DcGroupEntry = defineDto({ GroupName: str, DistrictNumber: str });
export const DcSubGroupEntry = defineDto({ SubGroupName: str, DistrictNumber: str });

export const AddClubMemberDto = defineDto({ MemberId: "int", JoinedDate: "string" });

/**
 * CreateClubDto / UpdateClubDto. RIZones defaulted Timezone to "Asia/Kolkata"
 * and Country to "India"; ROW defaults the zone to the brand's and has no
 * default country (see SaveClubDefaults in the service).
 */
export const SaveClubDto = defineDto({
  FkDistrictId: "int", ClubRotaryId: str, ClubName: str, Timezone: "string", ClubCharterDate: "string",
  ClubLogoPath: "string", ClubWebsite: "string", MeetingDay: "string", MeetingFromTime: "string", MeetingToTime: "string",
  MeetingAddress: "string", Country: "string", State: "string", City: "string", Pincode: "string",
  Latitude: "decimal?", Longitude: "decimal?", ActiveFromDate: "string", ActiveToDate: "string",
  IsAutomaticMeetingReminder: { type: "bool", default: () => true }, IsFamilyLogin: "bool", IsActive: { type: "bool", default: () => true },
});

export const UpdateCogDesignationDto = defineDto({ DistrictNumber: str, YearLabel: str });
