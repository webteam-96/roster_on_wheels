export interface NewsletterListItem {
  id: number;
  clubId: number;
  title: string;
  publishDateTime: string;
  expiryDateTime: string;
  attachmentType: string; // "link" or "file"
  linkUrl: string | null;
  filePath: string | null;
  isSendWhatsapp: boolean;
  isSendEmail: boolean;
  status: string;
  whatsAppSentDate?: string | null;
  whatsAppSentCount?: number;
  whatsAppFailedCount?: number;
  emailSentDate?: string | null;
  emailSentCount?: number;
  emailFailedCount?: number;
}

export interface NewsletterDetail {
  id: number;
  clubId: number;
  title: string;
  publishDateTime: string;
  expiryDateTime: string;
  attachmentType: string;
  linkUrl: string | null;
  filePath: string | null;
  isSendWhatsapp: boolean;
  isSendEmail: boolean;
  status: string;
}

export interface CreateNewsletterRequest {
  title: string;
  publishDateTime: string;
  expiryDateTime: string;
  attachmentType: string;
  linkUrl: string | null;
  filePath: string | null;
  isSendWhatsapp: boolean;
  isSendEmail: boolean;
}

export interface UpdateNewsletterRequest {
  title: string;
  publishDateTime: string;
  expiryDateTime: string;
  attachmentType: string;
  linkUrl: string | null;
  filePath: string | null;
  isSendWhatsapp: boolean;
  isSendEmail: boolean;
}
