export interface PotentialMember {
  id: number;
  clubId: number;
  name: string;
  email: string | null;
  mobileNumber: string | null;
  referenceDetails: string | null;
  // Prospect pipeline (N3, feature contacts_growth)
  stage: string;
  ownerMemberId: number | null;
  ownerName: string | null;
  notes: string | null;
  source: string;
  convertedMemberId: number | null;
  createdDate: string | null;
}

export interface CreatePotentialMemberRequest {
  name: string;
  email?: string | null;
  mobileNumber?: string | null;
  referenceDetails?: string | null;
  stage?: string | null;
  ownerMemberId?: number | null;
  notes?: string | null;
}

export interface UpdatePotentialMemberRequest {
  name: string;
  email?: string | null;
  mobileNumber?: string | null;
  referenceDetails?: string | null;
  stage?: string | null;
  ownerMemberId?: number | null;
  notes?: string | null;
}
