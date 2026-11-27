import { sameAddressType } from "@/lib/memberAddress";
import { Member, MemberAddress, FamilyMember } from "@/types/member";

/* ----- helpers ----- */

export const todayIso = (): string => new Date().toISOString().substring(0, 10);

export function formatDateForInput(date: string | null | undefined): string {
  if (!date) return "";
  return date.substring(0, 10);
}

export function getAddress(addresses: MemberAddress[] | undefined, type: string): MemberAddress | undefined {
  return addresses?.find((a) => sameAddressType(a.addressType, type));
}

export const emptyFamilyMember: Omit<FamilyMember, "id" | "fkMemberMasterProfileId"> = {
  name: "",
  relation: "",
  bloodGroup: "",
  fkCountryId: 0,
  country: "",
  countryPhoneCode: "",
  phoneNumber: "",
  emailId: "",
  birthDate: null,
  anniversaryDate: null,
  photoPath: null,
};

export const emptyResidentialAddress: Partial<MemberAddress> = {
  addressType: "Residence",
  fkCountryId: 0,
  country: "",
  countryPhoneCode: "",
  phoneNumber: "",
  address: "",
  state: "",
  city: "",
  pinCode: "",
  businessName: null,
  businessEmailId: null,
  keywords: null,
};

export const emptyBusinessAddress: Partial<MemberAddress> = {
  addressType: "Business",
  fkCountryId: 0,
  country: "",
  countryPhoneCode: "",
  phoneNumber: "",
  address: "",
  state: "",
  city: "",
  pinCode: "",
  businessName: "",
  businessEmailId: "",
  keywords: "",
};

export const defaultFormData: Partial<Member> = {
  memberName: "",
  profilePhotoPath: null,
  fkPrimaryCountryId: 0,
  primaryCountry: "",
  primaryCountryPhoneCode: "",
  primaryMobileNumber: "",
  emailId: "",
  birthDate: null,
  anniversaryDate: null,
  bloodGroup: "",
  fkSecondaryCountryId: 0,
  secondaryCountry: "",
  secondaryCountryPhoneCode: "",
  secondaryMobileNumber: "",
  isPersonalDetailsVisible: true,
  // Honorary is per-club; only written when ?clubId= is present (writes the
  // initial club_members row). Edit page has no per-club context so it's
  // gone from there — post-create toggles go through the SuperAdmin directory.
  isHonoraryMember: false,
  gender: "",
  primaryLanguage: "English",
  isYouth: false,
  memberIntroduction: "",
  facebook: "",
  instagram: "",
  linkedIn: "",
  twitter: "",
  youtube: "",
  website: "",
  rotaryId: "",
  donorRecognition: "",
  designation: null,
  classificationProfession: null,
  familyPhotoPath: null,
  isFamilyDetailsVisible: true,
  addresses: [],
  familyMembers: [],
  joinedDate: null,
};

/* ----- presentational primitives (mirrors club-service v2 add) ----- */

export const inputCls =
  "row-field w-full";
export const errInputCls =
  "row-field w-full";
