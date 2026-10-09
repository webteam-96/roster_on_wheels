import { defineDto } from "../common/dto";

/** DTOs/AuthDtos.cs */

export const LoginRequestDto = defineDto({
  Email: "string",
  CountryCode: "string",
  MobileNumber: "string",
  Password: { type: "string", default: () => "" },
});

export const LoginResponseDto = defineDto({
  Token: { type: "string", default: () => "" },
  MemberName: { type: "string", default: () => "" },
  Email: { type: "string", default: () => "" },
  MemberId: "int",
  Roles: { type: "object", default: () => [] },
  IsTemporaryPassword: "bool",
  LastLoginTime: "datetime?",
  SessionExpiryMinutes: "int",
  ScopedRoles: { type: "object", default: () => [] },
  AccessibleZones: { type: "object", default: () => [] },
  AccessibleDistricts: { type: "object", default: () => [] },
  AccessibleClubs: { type: "object", default: () => [] },
  DistrictClubAccess: { type: "object", default: () => [] },
});

export const ForgotPasswordRequestDto = defineDto({ Email: "string", CountryCode: "string", MobileNumber: "string" });

export const ResetPasswordRequestDto = defineDto({
  Token: { type: "string", default: () => "" },
  NewPassword: { type: "string", default: () => "" },
  ConfirmPassword: { type: "string", default: () => "" },
});

export const ChangePasswordRequestDto = defineDto({
  CurrentPassword: { type: "string", default: () => "" },
  NewPassword: { type: "string", default: () => "" },
  ConfirmPassword: { type: "string", default: () => "" },
});

export const LoginAuditLogDto = defineDto({
  Id: "int",
  MemberId: "int?",
  MemberName: { type: "string", default: () => "" },
  EmailOrMobile: { type: "string", default: () => "" },
  LoginTime: "datetime",
  IpAddress: "string",
  UserAgent: "string",
  LoginStatus: { type: "string", default: () => "" },
  FailureReason: "string",
});
