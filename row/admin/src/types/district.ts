export interface DistrictListItem {
  id: number;
  districtNumber: string;
  districtLogoPath: string | null;
  isActive: boolean;
  createdDate: string | null;
  fkZoneId: number | null;
  zoneName: string | null;
  country: string | null;
  defaultCurrency: string | null;
  /** IANA time zone (N12); null = the instance default. */
  timezone: string | null;
  totalClubs: number;
  totalMembers: number;
}

export interface District {
  id: number;
  districtNumber: string;
  districtLogoPath: string | null;
  isActive: boolean;
  createdBy: number | null;
  createdDate: string | null;
  modifiedBy: number | null;
  modifiedDate: string | null;
  fkZoneId: number | null;
  zoneName: string | null;
  country: string | null;
  defaultCurrency: string | null;
  /** IANA time zone (N12); null = the instance default. */
  timezone: string | null;
  totalClubs: number;
  totalMembers: number;
}

export interface CreateDistrictRequest {
  districtNumber: string;
  districtLogoPath?: string | null;
  isActive: boolean;
  fkZoneId?: number | null;
  country?: string | null;
  defaultCurrency?: string | null;
  timezone?: string | null;
}

export interface UpdateDistrictRequest {
  districtNumber: string;
  districtLogoPath?: string | null;
  isActive: boolean;
  fkZoneId?: number | null;
  country?: string | null;
  defaultCurrency?: string | null;
  timezone?: string | null;
}

export interface DistrictMember {
  id: number;
  memberName: string;
  profilePhotoPath: string | null;
  emailId: string;
  primaryMobileNumber: string;
  rotaryId: string;
  clubNames: string;
  clubName: string;
  joinedDate: string | null;
  roles: string[];
  hasDistrictAdminRole: boolean;
  allClubsAccess?: boolean;
  hasClubAdminRole: boolean;
  isSuperAdmin: boolean;
}
