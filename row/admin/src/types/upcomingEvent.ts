export interface UpcomingEventListItem {
  id: number;
  clubId: number;
  title: string;
  description: string | null;
  imagePath: string | null;
  eventDate: string;
  publishDate: string;
  expiryDate: string;
  eventVenue: string | null;
  registrationLink: string | null;
  isSendEmail: boolean;
  isRepeatNotification: boolean;
  status: string;
  reminderCount: number;
  emailSentDate?: string | null;
  emailSentCount?: number;
  emailFailedCount?: number;
}

export interface UpcomingEventDetail {
  id: number;
  clubId: number;
  title: string;
  description: string | null;
  imagePath: string | null;
  eventDate: string;
  publishDate: string;
  expiryDate: string;
  eventVenue: string | null;
  registrationLink: string | null;
  isSendEmail: boolean;
  isRepeatNotification: boolean;
  status: string;
  reminders: EventReminder[];
}

export interface EventReminder {
  id: number;
  reminderDateTime: string;
}

export interface CreateUpcomingEventRequest {
  title: string;
  description: string | null;
  imagePath: string | null;
  eventDate: string;
  publishDate: string;
  expiryDate: string;
  eventVenue: string | null;
  registrationLink: string | null;
  isSendEmail: boolean;
  isRepeatNotification: boolean;
  reminders: string[] | null;
}

export interface UpdateUpcomingEventRequest {
  title: string;
  description: string | null;
  imagePath: string | null;
  eventDate: string;
  publishDate: string;
  expiryDate: string;
  eventVenue: string | null;
  registrationLink: string | null;
  isSendEmail: boolean;
  isRepeatNotification: boolean;
  reminders: string[] | null;
}
