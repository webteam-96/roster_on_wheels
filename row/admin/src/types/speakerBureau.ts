// District speaker bureau (api/DTOs/SpeakerBureauDtos.cs; flagged module "volunteers").

export type BureauStatus = "pending" | "approved" | "rejected";

export interface BureauEntry {
  id: number;
  districtId: number;
  name: string;
  bio: string | null;
  topics: string;
  languages: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  availableOnline: boolean;
  availableInPerson: boolean;
  photoPath: string | null;
  memberId: number | null;
  memberName: string | null;
  status: BureauStatus;
  proposedByClubId: number | null;
  proposedByClubName: string | null;
  averageRating: number | null;
  ratingCount: number;
  talkCount: number;
}

export interface SaveBureauEntry {
  name: string;
  bio: string | null;
  topics: string;
  languages: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  availableOnline: boolean;
  availableInPerson: boolean;
}

export interface BureauSearch {
  topic?: string;
  language?: string;
  mode?: "" | "online" | "in_person";
  minRating?: number;
  status?: "" | BureauStatus;
}

export interface BureauRating {
  id: number;
  clubId: number;
  clubName: string | null;
  talkDate: string;
  rating: number;
  comment: string | null;
  commentHidden: boolean;
  createdDate: string;
}

export interface BureauProfile {
  entry: BureauEntry;
  ratings: BureauRating[];
}

export interface BureauBooking {
  id: number;
  entryId: number;
  name: string;
  topics: string;
  talkDate: string;
  rating: number | null;
  comment: string | null;
  canRate: boolean;
}
