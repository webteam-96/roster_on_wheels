import { defineDto } from "../common/dto";

const str = { type: "string" as const, default: () => "" };

/** DTOs/ClubDtos.cs ClubListDto (also returned by api/districts/{id}/clubs). */
export const ClubListDto = defineDto({
  Id: "int", FkDistrictId: "int", DistrictNumber: str, ClubRotaryId: str, ClubName: str, ClubLogoPath: "string",
  MeetingDay: "string", MeetingFromTime: "timespan?", MeetingToTime: "timespan?", City: "string", State: "string",
  IsActive: "bool", CreatedDate: "datetime?", TotalMembers: "int", HonoraryMembers: "int", IsSyncedFromRotaryOrg: "bool",
  WebsiteSubdomain: "string", WebsiteClientDomain: "string", WebsiteEndDate: "datetime?", WebsiteStatus: "string",
});
