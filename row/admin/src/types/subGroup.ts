export interface SubGroup {
  id: number;
  clubId: number;
  yearId: number;
  yearLabel: string;
  groupName: string;
  memberCount: number;
}

export interface SubGroupDetail {
  id: number;
  clubId: number;
  yearId: number;
  yearLabel: string;
  groupName: string;
  members: SubGroupMember[];
}

export interface SubGroupMember {
  memberId: number;
  memberName: string;
  clubName: string | null;
  email: string | null;
  mobileNumber: string | null;
  profilePhotoPath: string | null;
}
