export interface ClubSocialLink {
  id: number;
  clubId: number;
  platform: string;
  linkUrl: string;
  sortOrder: number;
  isActive: boolean;
}

export interface CreateClubSocialLinkRequest {
  platform: string;
  linkUrl: string;
  sortOrder: number;
  isActive: boolean;
}

export interface UpdateClubSocialLinkRequest {
  platform: string;
  linkUrl: string;
  sortOrder: number;
  isActive: boolean;
}

export const SOCIAL_PLATFORMS = [
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "twitter", label: "Twitter / X" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "youtube", label: "YouTube" },
  { value: "telegram", label: "Telegram" },
  { value: "pinterest", label: "Pinterest" },
  { value: "threads", label: "Threads" },
  { value: "googleplus", label: "Google Plus" },
  { value: "website", label: "Website" },
] as const;
