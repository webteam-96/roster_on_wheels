import { defineDto } from "../common/dto";

export const ZoneListDto = defineDto({
  Id: "int", ZoneName: { type: "string", default: () => "" }, IsActive: "bool", CreatedDate: "datetime?",
  TotalDistricts: "int", TotalClubs: "int", TotalMembers: "int", IsZonalAwardsEnabled: "bool",
  CoordinatorName: "string", CoordinatorEmail: "string",
});

export const ZoneDetailDto = defineDto({
  Id: "int", ZoneName: { type: "string", default: () => "" }, IsActive: "bool", CreatedBy: "int?", CreatedDate: "datetime?",
  ModifiedBy: "int?", ModifiedDate: "datetime?", TotalDistricts: "int", TotalClubs: "int", TotalMembers: "int",
});

export const CreateZoneDto = defineDto({ ZoneName: { type: "string", default: () => "" }, IsActive: { type: "bool", default: () => true } });
export const UpdateZoneDto = CreateZoneDto;
