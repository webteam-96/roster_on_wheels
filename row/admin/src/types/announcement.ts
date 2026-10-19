export interface AnnouncementListItem {
  id: number;
  clubId: number;
  title: string;
  description: string | null;
  imagePath: string | null;
  publishDateTime: string;
  expiryDateTime: string;
  isDisplayOnBanner: boolean;
  isSendEmail: boolean;
  isRepeatNotification: boolean;
  status: string;
  reminderCount: number;
  emailSentDate?: string | null;
  emailSentCount?: number;
  emailFailedCount?: number;
}

export interface AnnouncementDetail {
  id: number;
  clubId: number;
  title: string;
  description: string | null;
  imagePath: string | null;
  publishDateTime: string;
  expiryDateTime: string;
  isDisplayOnBanner: boolean;
  isSendEmail: boolean;
  isRepeatNotification: boolean;
  status: string;
  reminders: AnnouncementReminder[];
}

export interface AnnouncementReminder {
  id: number;
  reminderDateTime: string;
}

export interface CreateAnnouncementRequest {
  title: string;
  description: string | null;
  imagePath: string | null;
  publishDateTime: string;
  expiryDateTime: string;
  isDisplayOnBanner: boolean;
  isSendEmail: boolean;
  isRepeatNotification: boolean;
  reminders: string[] | null;
}

export interface UpdateAnnouncementRequest {
  title: string;
  description: string | null;
  imagePath: string | null;
  publishDateTime: string;
  expiryDateTime: string;
  isDisplayOnBanner: boolean;
  isSendEmail: boolean;
  isRepeatNotification: boolean;
  reminders: string[] | null;
}
