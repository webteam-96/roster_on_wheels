export interface Designation {
  id: number;
  designationName: string;
  sortOrder: number;
  bodCount?: number;
  /** RI officer title it maps to (build spec 3.12). */
  riTitle?: string | null;
}

export interface CreateDesignationRequest {
  designationName: string;
  sortOrder: number;
}

export interface UpdateDesignationRequest {
  designationName: string;
  sortOrder: number;
  /** "" clears the mapping; omitted keeps it. */
  riTitle?: string;
}

/** RI's six officer titles (build spec 3.12); the API accepts only these. */
export const RI_OFFICER_TITLES = ["President", "Secretary", "Treasurer", "Executive Secretary", "Membership Chair", "Foundation Chair"] as const;

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
