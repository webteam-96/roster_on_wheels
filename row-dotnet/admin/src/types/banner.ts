export interface ClubBanner {
  id: number;
  clubId: number;
  yearId: number;
  yearLabel: string;
  bannerImagePath: string;
  documentPath?: string;
  linkUrl?: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
}

export interface CreateClubBannerRequest {
  yearId: number;
  bannerImagePath: string;
  documentPath?: string;
  linkUrl?: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
}

export interface UpdateClubBannerRequest {
  bannerImagePath: string;
  documentPath?: string;
  linkUrl?: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
}
