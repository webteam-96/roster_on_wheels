export interface Country {
  id: number;
  countryName: string;
  countryCode: string;
  phoneCode: string;
  gmtOpt: string;
  gmtTime: string;
  ordering: number;
}

export interface MemberAddress {
  id: number;
  fkMemberMasterProfileId: number;
  addressType: "Residential" | "Business";
  fkCountryId: number;
  country: string;
  countryPhoneCode: string;
  phoneNumber: string;
  address: string;
  state: string;
  city: string;
  pinCode: string;
  // Business-specific fields (null for Residential)
  businessName: string | null;
  businessEmailId: string | null;
  keywords: string | null;
}

export interface Member {
  id: number;
  memberName: string;
  profilePhotoPath: string | null;
  fkPrimaryCountryId: number;
  primaryCountry: string;
  primaryCountryPhoneCode: string;
  primaryMobileNumber: string;
  emailId: string;
  birthDate: string | null;
  anniversaryDate: string | null;
  bloodGroup: string;
  fkSecondaryCountryId: number;
  secondaryCountry: string;
  secondaryCountryPhoneCode: string;
  secondaryMobileNumber: string;
  isPersonalDetailsVisible: boolean;
  // Honorary moved to club_members (per-club) 2026-06-26. Kept on the form-side
  // Member type ONLY so the new-member form can stamp it onto the initial
  // club_members row when ?clubId= is provided. Edit form ignores this field.
  isHonoraryMember?: boolean;
  gender: string;
  primaryLanguage: string;
  isYouth: boolean;
  memberIntroduction: string;
  // Social
  facebook: string;
  instagram: string;
  linkedIn: string;
  twitter: string;
  youtube: string;
  website: string;
  // Rotary
  rotaryId: string;
  donorRecognition: string;
  // Member-level club role/profession (stored on club_members, shared across all active memberships)
  designation: string | null;
  classificationProfession: string | null;
  // Family
  familyPhotoPath: string | null;
  isFamilyDetailsVisible: boolean;
  // Related
  addresses: MemberAddress[];
  familyMembers: FamilyMember[];
  createdBy: number | null;
  createdDate: string | null;
  modifiedBy: number | null;
  modifiedDate: string | null;
  // Club membership (only on create/edit forms — not stored on member_master_profile)
  clubId?: number | null;
  joinedDate?: string | null;
}

export interface FamilyMember {
  id: number;
  fkMemberMasterProfileId: number;
  name: string;
  relation: string;
  bloodGroup: string;
  fkCountryId: number;
  country: string;
  countryPhoneCode: string;
  phoneNumber: string;
  emailId: string;
  birthDate: string | null;
  anniversaryDate: string | null;
  photoPath: string | null;
}

export interface MemberListItem {
  id: number;
  memberName: string;
  profilePhotoPath: string | null;
  emailId: string;
  primaryMobileNumber: string;
  primaryCountryPhoneCode: string;
  bloodGroup: string;
  gender: string;
  rotaryId: string;
  businessName: string;
  designation: string;
  resCity: string;
  resState: string;
}

export interface PagedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  // Club-member endpoints only: regular (non-honorary) vs honorary split of the club roster.
  memberCount?: number;
  honoraryCount?: number;
}
