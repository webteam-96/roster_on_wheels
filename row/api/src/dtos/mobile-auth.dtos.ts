import { defineDto } from "../common/dto";

const str = { type: "string" as const, default: () => "" };
const list = { type: "object" as const, default: () => [] };

/** DTOs/MobileAuthDtos.cs */
export const MobileRequestOtpDto = defineDto({ LoginType: { type: "string", default: () => "member" }, Identifier: str, CountryId: "int?" });

export const MobileRequestOtpResponse = defineDto({
  Message: str, SentEmail: "bool", SentSms: "bool", SentWhatsApp: "bool", OtpExpiresInSeconds: "int", DebugOtp: "string",
});

export const MobileVerifyOtpDto = defineDto({
  LoginType: { type: "string", default: () => "member" }, Identifier: str, CountryId: "int?", Otp: str,
  Imei: "string", DeviceToken: "string", DeviceName: "string", AppVersion: "string",
});

export const MobileVerifyOtpResponse = defineDto({
  Token: str, ExpiresAt: "object", MemberId: "int", MemberName: str, Email: "string", Mobile: "string",
  MemberType: { type: "string", default: () => "member" }, FamilyMemberId: "int?", RoleNames: list, Roles: list,
  AccessibleDistricts: list, AccessibleClubs: list, AccessibleZones: list, DistrictClubAccess: list,
  MemberMobileDashboard: { type: "object", default: () => ({ clubs: [], districts: [] }) },
});

export const MyContextResponse = defineDto({
  MemberId: "int", MemberName: str, Email: "string", Mobile: "string", CountryId: "int?",
  MemberType: { type: "string", default: () => "member" }, FamilyMemberId: "int?", Roles: list,
  AccessibleZones: list, AccessibleDistricts: list, AccessibleClubs: list, DistrictClubAccess: list,
  MemberMobileDashboard: { type: "object", default: () => ({ clubs: [], districts: [] }) },
});
