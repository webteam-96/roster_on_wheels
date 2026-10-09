import { defineDto } from "../common/dto";

const str = { type: "string" as const, default: () => "" };
const list = { type: "object" as const, default: () => [] };

/**
 * DTOs/MemberDtos.cs. RIZones defaulted countries to India (id 1); ROW leaves
 * an unknown country empty (0 / null).
 */
export const MemberListDto = defineDto({
  Id: "int", MemberName: str, ProfilePhotoPath: "string", EmailId: "string", PrimaryMobileNumber: "string",
  PrimaryCountryPhoneCode: "string", BloodGroup: "string", Gender: "string", RotaryId: "string", BusinessName: "string",
  Designation: "string", ResCity: "string", ResState: "string",
});

export const MemberAddressDto = defineDto({
  Id: "int", FkMemberMasterProfileId: "int", AddressType: str, FkCountryId: "int", Country: "string", CountryPhoneCode: "string",
  PhoneNumber: "string", Address: "string", State: "string", City: "string", PinCode: "string", BusinessName: "string",
  BusinessEmailId: "string", Keywords: "string",
});

export const FamilyMemberDto = defineDto({
  Id: "int", FkMemberMasterProfileId: "int", Name: str, Relation: "string", BloodGroup: "string", FkCountryId: "int",
  Country: "string", CountryPhoneCode: "string", PhoneNumber: "string", EmailId: "string", BirthDate: "datetime?",
  AnniversaryDate: "datetime?", PhotoPath: "string",
});

export const MemberDetailDto = defineDto({
  Id: "int", MemberName: str, ProfilePhotoPath: "string", FkPrimaryCountryId: "int", PrimaryCountry: "string",
  PrimaryCountryPhoneCode: "string", PrimaryMobileNumber: "string", EmailId: "string", BirthDate: "datetime?",
  AnniversaryDate: "datetime?", BloodGroup: "string", FkSecondaryCountryId: "int", SecondaryCountry: "string",
  SecondaryCountryPhoneCode: "string", SecondaryMobileNumber: "string", IsPersonalDetailsVisible: "bool", Gender: "string",
  PrimaryLanguage: "string", IsYouth: "bool", MemberIntroduction: "string", Facebook: "string", Instagram: "string",
  LinkedIn: "string", Twitter: "string", Youtube: "string", Website: "string", RotaryId: "string", DonorRecognition: "string",
  FamilyPhotoPath: "string", IsFamilyDetailsVisible: "bool", CreatedBy: "int?", CreatedDate: "datetime?", ModifiedBy: "int?",
  ModifiedDate: "datetime?", Addresses: list, FamilyMembers: list, ClubId: "int?", JoinedDate: "datetime?",
  Designation: "string", ClassificationProfession: "string",
});

/** CreateMemberDto / UpdateMemberDto (Update has no IsHonoraryMember). Lists stay raw and are bound per item. */
export const SaveMemberDto = defineDto({
  MemberName: str, ProfilePhotoPath: "string", FkPrimaryCountryId: "int?", PrimaryMobileNumber: "string", EmailId: "string",
  BirthDate: "string", AnniversaryDate: "string", BloodGroup: "string", FkSecondaryCountryId: "int?", SecondaryMobileNumber: "string",
  IsPersonalDetailsVisible: { type: "bool", default: () => true }, IsHonoraryMember: "bool", Gender: "string",
  PrimaryLanguage: { type: "string", default: () => "English" }, IsYouth: "bool", MemberIntroduction: "string", Facebook: "string",
  Instagram: "string", LinkedIn: "string", Twitter: "string", Youtube: "string", Website: "string", RotaryId: "string",
  DonorRecognition: "string", FamilyPhotoPath: "string", IsFamilyDetailsVisible: { type: "bool", default: () => true },
  Addresses: "object", FamilyMembers: "object", ClubId: "int?", JoinedDate: "string", Designation: "string", ClassificationProfession: "string",
});

export const SaveAddressDto = defineDto({
  Id: "int", AddressType: str, FkCountryId: "int?", PhoneNumber: "string", Address: "string", State: "string", City: "string",
  PinCode: "string", BusinessName: "string", BusinessEmailId: "string", Keywords: "string",
});

export const SaveFamilyMemberDto = defineDto({
  Id: "int", Name: str, Relation: "string", BloodGroup: "string", FkCountryId: "int?", PhoneNumber: "string", EmailId: "string",
  BirthDate: "string", AnniversaryDate: "string", PhotoPath: "string",
});

export type SaveMember = {
  memberName: string; profilePhotoPath: string | null; fkPrimaryCountryId: number | null; primaryMobileNumber: string | null;
  emailId: string | null; birthDate: string | null; anniversaryDate: string | null; bloodGroup: string | null;
  fkSecondaryCountryId: number | null; secondaryMobileNumber: string | null; isPersonalDetailsVisible: boolean;
  isHonoraryMember: boolean; gender: string | null; primaryLanguage: string; isYouth: boolean; memberIntroduction: string | null;
  facebook: string | null; instagram: string | null; linkedIn: string | null; twitter: string | null; youtube: string | null;
  website: string | null; rotaryId: string | null; donorRecognition: string | null; familyPhotoPath: string | null;
  isFamilyDetailsVisible: boolean; addresses: unknown; familyMembers: unknown; clubId: number | null; joinedDate: string | null;
  designation: string | null; classificationProfession: string | null;
};
export type SaveAddress = {
  id: number; addressType: string; fkCountryId: number | null; phoneNumber: string | null; address: string | null; state: string | null;
  city: string | null; pinCode: string | null; businessName: string | null; businessEmailId: string | null; keywords: string | null;
};
export type SaveFamilyMember = {
  id: number; name: string; relation: string | null; bloodGroup: string | null; fkCountryId: number | null; phoneNumber: string | null;
  emailId: string | null; birthDate: string | null; anniversaryDate: string | null; photoPath: string | null;
};
