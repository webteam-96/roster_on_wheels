import { sameAddressType } from "@/lib/memberAddress";
import { Member, MemberAddress, FamilyMember } from "@/types/member";

// The "COG" club — a roster of past District Governors rather than a real club.
// A COG membership row carries the member's DG district + Rotary year (held in
// club_members.Designation, e.g. "3292 Dg 2025 - 26") and has no meaningful
// admission/joining date. Keyed off the ?clubId= in the URL, NEVER off the
// member's memberships: 840 of COG's active members ALSO belong to a real club,
// and editing them from that club must show the normal form.
export const COG_CLUB_ID = 31598;

// Same partial-edit lock list as MemberForm.tsx (V1) and the backend
// UserPermissionHelper.DirectoryMemberLockedFields. Update 2026-06-10:
// Primary Mobile / Email / Primary Country are NOW editable for Club Admin
// (so CA can keep member contact info current). Backend enforces duplicate
// check on mobile + email and force-relogins the affected mobile session
// when mobile changes.
export const PARTIAL_EDIT_LOCKED_FIELDS = new Set<string>([
  "secondaryMobileNumber",
  "rotaryId",
  // isHonoraryMember moved to club_members per-club 2026-06-26.
  "isYouth",
  "joinedDate",
  "isPersonalDetailsVisible",
  "fkSecondaryCountryId",
  "isFamilyDetailsVisible",
  "primaryLanguage",
]);

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
