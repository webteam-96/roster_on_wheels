export interface OtherClubInfo {
  clubId: number;
  clubName: string;
}

export interface BodEntry {
  designationName: string;
  yearLabel: string;
}

export interface DcGroupEntry {
  groupName: string;
  districtNumber: string;
}

export interface DcSubGroupEntry {
  subGroupName: string;
  districtNumber: string;
}

export interface DcCommitteeEntry {
  designation: string;
  yearLabel: string;
  districtNumber: string;
}

export interface MemberRemovalPreview {
  memberId: number;
  memberName: string;
  emailId: string | null;
  clubId: number;
  clubName: string;
  isLastClub: boolean;
  otherClubs: OtherClubInfo[];
  rolesInThisClub: string[];
  allRoleNames: string[];
  bodEntries: BodEntry[];
  dcCommitteeMemberships?: DcCommitteeEntry[];
  dcGroupMemberships: DcGroupEntry[];
  subGroupMemberships: DcSubGroupEntry[];
}
