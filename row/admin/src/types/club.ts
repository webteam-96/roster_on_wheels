export interface ClubListItem {
  id: number;
  fkDistrictId: number;
  districtNumber: string;
  clubRotaryId: string;
  clubName: string;
  clubLogoPath: string | null;
  meetingDay: string | null;
  meetingFromTime: string | null;
  meetingToTime: string | null;
  city: string | null;
  state: string | null;
  isActive: boolean;
  createdDate: string | null;
  totalMembers: number;
  // Of totalMembers, how many are honorary. Regular "member count" = totalMembers - honoraryMembers.
  honoraryMembers?: number;
  isSyncedFromRotaryOrg?: boolean;
  // Club website presence for the listing column. If subdomain is null,
  // the club has no website record ("No"). If EndDate is past, the site
  // is "Expired". Otherwise a link is rendered to the subdomain URL.
  websiteSubdomain?: string | null;
  websiteClientDomain?: string | null;
  websiteEndDate?: string | null;
  websiteStatus?: string | null;
}

export interface Club {
  id: number;
  fkDistrictId: number;
  districtNumber: string;
  clubRotaryId: string;
  clubName: string;
  timezone: string;
  clubCharterDate: string | null;
  clubLogoPath: string | null;
  clubWebsite: string | null;
  meetingDay: string | null;
  meetingFromTime: string | null;
  meetingToTime: string | null;
  meetingAddress: string | null;
  country: string;
  // The club's OWN country (above) defaults to "India" regardless of reality — unreliable for
  // currency defaulting. This is the club's DISTRICT's country instead, used as a fallback guess
  // when districtDefaultCurrency (below) isn't set yet (see lib/currency.ts).
  districtCountry?: string | null;
  // SuperAdmin-set default currency for this club's district. Null until explicitly configured.
  districtDefaultCurrency?: string | null;
  state: string | null;
  city: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  activeFromDate: string | null;
  activeToDate: string | null;
  isAutomaticMeetingReminder: boolean;
  isFamilyLogin: boolean;
  isActive: boolean;
  createdBy: number | null;
  createdDate: string | null;
  modifiedBy: number | null;
  modifiedDate: string | null;
  totalMembers: number;
}

export interface CreateClubRequest {
  fkDistrictId: number;
  clubRotaryId: string;
  clubName: string;
  timezone?: string;
  clubCharterDate?: string | null;
  clubLogoPath?: string | null;
  clubWebsite?: string | null;
  meetingDay?: string | null;
  meetingFromTime?: string | null;
  meetingToTime?: string | null;
  meetingAddress?: string | null;
  country?: string;
  state?: string | null;
  city?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  activeFromDate?: string | null;
  activeToDate?: string | null;
  isAutomaticMeetingReminder?: boolean;
  isFamilyLogin?: boolean;
  isActive?: boolean;
}

export interface UpdateClubRequest {
  fkDistrictId: number;
  clubRotaryId: string;
  clubName: string;
  timezone?: string;
  clubCharterDate?: string | null;
  clubLogoPath?: string | null;
  clubWebsite?: string | null;
  meetingDay?: string | null;
  meetingFromTime?: string | null;
  meetingToTime?: string | null;
  meetingAddress?: string | null;
  country?: string;
  state?: string | null;
  city?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  activeFromDate?: string | null;
  activeToDate?: string | null;
  isAutomaticMeetingReminder?: boolean;
  isFamilyLogin?: boolean;
  isActive?: boolean;
}

export interface ClubMemberItem {
  id: number;
  memberName: string;
  profilePhotoPath: string | null;
  emailId: string;
  primaryMobileNumber: string;
  rotaryId: string;
  joinedDate: string | null;
  clubMemberId: number;
  membershipActive: boolean;
  roles: string[];
  hasAdminRole: boolean;
  // COG (club 31598) only — past-DG designation label, e.g. "3261 Dg 2003 04".
  designation?: string | null;
  // COG only — the same label split into its two structured parts. The COG
  // listing (and the mobile app) show these instead of the joined/admission
  // date, which is meaningless for a past-Governors roster.
  cogDistrictNumber?: string | null;
  cogYear?: string | null;   // Rotary-year label, e.g. "2025-26"
}

export interface AddClubMemberRequest {
  memberId: number;
  joinedDate?: string | null;
}

export interface TerminatedMember {
  id: number;
  rotaryId: string | null;
  memberName: string;
  joinedDate: string | null;
  terminationDate: string | null;
  terminationReason: string | null;
}
