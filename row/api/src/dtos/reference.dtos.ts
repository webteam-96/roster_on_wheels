import { defineDto } from "../common/dto";

export const CountryDto = defineDto({
  Id: "int",
  CountryName: { type: "string", default: () => "" },
  CountryCode: { type: "string", default: () => "" },
  PhoneCode: { type: "string", default: () => "" },
  GmtOpt: { type: "string", default: () => "" },
  GmtTime: { type: "string", default: () => "" },
  Ordering: "int",
});

export const RotaryYearDto = defineDto({
  Id: "int",
  YearLabel: { type: "string", default: () => "" },
  StartDate: "datetime",
  EndDate: "datetime",
  IsCurrent: "bool",
});
