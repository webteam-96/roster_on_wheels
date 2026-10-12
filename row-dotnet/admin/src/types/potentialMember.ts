export interface PotentialMember {
  id: number;
  clubId: number;
  name: string;
  email: string | null;
  mobileNumber: string | null;
  referenceDetails: string | null;
}

export interface CreatePotentialMemberRequest {
  name: string;
  email?: string | null;
  mobileNumber?: string | null;
  referenceDetails?: string | null;
}

export interface UpdatePotentialMemberRequest {
  name: string;
  email?: string | null;
  mobileNumber?: string | null;
  referenceDetails?: string | null;
}
