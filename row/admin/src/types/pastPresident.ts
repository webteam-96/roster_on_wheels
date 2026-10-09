export interface PastPresident {
  id: number;
  clubId: number;
  memberId: number | null;
  nonMemberName: string | null;
  isMember: boolean;
  memberName: string;
  profilePhotoPath: string | null;
  yearId: number;
  yearLabel: string;
}

export interface CreatePastPresidentRequest {
  memberId: number | null;
  nonMemberName: string | null;
  yearId: number;
}

export interface UpdatePastPresidentRequest {
  memberId: number | null;
  nonMemberName: string | null;
  yearId: number;
}

export interface ClubMemberSearchResult {
  id: number;
  memberName: string;
  profilePhotoPath: string | null;
}
