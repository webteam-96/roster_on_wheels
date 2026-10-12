export interface Designation {
  id: number;
  designationName: string;
  sortOrder: number;
  bodCount?: number;
}

export interface CreateDesignationRequest {
  designationName: string;
  sortOrder: number;
}

export interface UpdateDesignationRequest {
  designationName: string;
  sortOrder: number;
}

export interface BoardDirector {
  id: number;
  clubId: number;
  memberId: number | null;
  isMember: boolean;
  memberName: string; // resolved: member name OR non-member name
  profilePhotoPath: string | null;
  nonMemberName: string | null;
  nonMemberMobile: string | null;
  nonMemberEmail: string | null;
  designationId: number;
  designationName: string;        // resolved: custom text when designation is "Other", else master name
  customDesignation: string | null;
  yearId: number;
  yearLabel: string;
}

export interface CreateBoardDirectorRequest {
  memberId: number | null;
  nonMemberName: string | null;
  nonMemberMobile: string | null;
  nonMemberEmail: string | null;
  designationId: number;
  customDesignation: string | null;   // required when the designation is "Other"
  yearId: number;
}

export interface UpdateBoardDirectorRequest {
  memberId: number | null;
  nonMemberName: string | null;
  nonMemberMobile: string | null;
  nonMemberEmail: string | null;
  designationId: number;
  customDesignation: string | null;   // required when the designation is "Other"
  yearId: number;
}
