export interface ClubAbout {
  id: number;
  clubId: number;
  content: string;
  isActive: boolean;
}

export interface CreateClubAboutRequest {
  content: string;
  isActive: boolean;
}

export interface UpdateClubAboutRequest {
  content: string;
  isActive: boolean;
}
