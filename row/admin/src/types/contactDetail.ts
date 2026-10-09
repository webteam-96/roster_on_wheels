export interface ClubContactDetail {
  id: number;
  clubId: number;
  yearId: number;
  yearLabel: string;
  email: string;
  phone: string;
  isActive: boolean;
}

export interface CreateClubContactDetailRequest {
  yearId: number;
  email: string;
  phone: string;
  isActive: boolean;
}

export interface UpdateClubContactDetailRequest {
  email: string;
  phone: string;
  isActive: boolean;
}
