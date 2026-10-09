export interface ClubAdvertisement {
  id: number;
  clubId: number;
  yearId: number;
  yearLabel: string;
  advertisementImagePath: string;
  documentPath?: string;
  linkUrl?: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
}

export interface CreateClubAdvertisementRequest {
  yearId: number;
  advertisementImagePath: string;
  documentPath?: string;
  linkUrl?: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
}

export interface UpdateClubAdvertisementRequest {
  advertisementImagePath: string;
  documentPath?: string;
  linkUrl?: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
}
