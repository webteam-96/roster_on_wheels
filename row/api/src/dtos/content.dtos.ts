import { defineDto } from "../common/dto";

const str = { type: "string" as const, default: () => "" };
const list = { type: "object" as const, default: () => [] };

/** DTOs/AnnouncementDtos.cs */
export const AnnouncementListDto = defineDto({
  Id: "int", ClubId: "int", Title: str, Description: "string", ImagePath: "string", PublishDateTime: "datetime", ExpiryDateTime: "datetime",
  IsDisplayOnBanner: "bool", IsSendWhatsapp: "bool", IsSendEmail: "bool", IsRepeatNotification: "bool", Status: str, ReminderCount: "int",
  WhatsAppSentDate: "datetime?", WhatsAppSentCount: "int", WhatsAppFailedCount: "int", EmailSentDate: "datetime?", EmailSentCount: "int",
  EmailFailedCount: "int",
});
export const AnnouncementDetailDto = defineDto({
  Id: "int", ClubId: "int", Title: str, Description: "string", ImagePath: "string", PublishDateTime: "datetime", ExpiryDateTime: "datetime",
  IsDisplayOnBanner: "bool", IsSendWhatsapp: "bool", IsSendEmail: "bool", IsRepeatNotification: "bool", Status: str, RecipientTarget: "string",
  RecipientZoneIds: "string", RecipientDistrictIds: "string", RecipientSubgroupIds: "string", Reminders: list,
});
export const AnnouncementReminderDto = defineDto({ Id: "int", ReminderDateTime: "datetime" });
/** CreateAnnouncementDto / UpdateAnnouncementDto. Dates stay as sent and are converted with dbDateTime. */
export const SaveAnnouncementDto = defineDto({
  Title: str, Description: "string", ImagePath: "string", PublishDateTime: "string", ExpiryDateTime: "string", IsDisplayOnBanner: "bool",
  IsSendWhatsapp: "bool", IsSendEmail: "bool", IsRepeatNotification: "bool", Reminders: "object", RecipientTarget: "string",
  RecipientZoneIds: "object", RecipientDistrictIds: "object", RecipientSubgroupIds: "object",
});
export type SaveAnnouncement = {
  title: string; description: string | null; imagePath: string | null; publishDateTime: string | null; expiryDateTime: string | null;
  isDisplayOnBanner: boolean; isSendWhatsapp: boolean; isSendEmail: boolean; isRepeatNotification: boolean; reminders: unknown;
  recipientTarget: string | null; recipientZoneIds: unknown; recipientDistrictIds: unknown; recipientSubgroupIds: unknown;
};

/** DTOs/DocumentDtos.cs (list and detail share a shape). */
export const DocumentDto = defineDto({
  Id: "int", ClubId: "int", Title: str, AccessType: { type: "string", default: () => "downloadable" }, FilePath: str, OriginalFileName: "string",
  PublishDateTime: "datetime", ExpiryDateTime: "datetime", Status: str,
});
export const SaveDocumentDto = defineDto({
  Title: str, AccessType: { type: "string", default: () => "downloadable" }, FilePath: str, OriginalFileName: "string", PublishDateTime: "string",
  ExpiryDateTime: "string",
});
export type SaveDocument = { title: string; accessType: string; filePath: string; originalFileName: string | null; publishDateTime: string | null; expiryDateTime: string | null };

/** Area of focus / category / sub-category taxonomy. */
export const AreaOfFocusDto = defineDto({ Id: "int", ModuleId: "int?", ModuleName: "string", Name: str, ImagePath: "string", SortOrder: "int", IsActive: "bool" });
export const SaveAreaOfFocusDto = defineDto({ ModuleId: "int", Name: str, ImagePath: "string", SortOrder: "int", IsActive: { type: "bool", default: () => true } });
export const CategoryDto = defineDto({ Id: "int", AreaOfFocusId: "int", Name: str, SortOrder: "int", IsActive: "bool" });
export const SaveCategoryDto = defineDto({ AreaOfFocusId: "int", Name: str, SortOrder: "int", IsActive: { type: "bool", default: () => true } });
export const SubCategoryDto = defineDto({ Id: "int", CategoryId: "int", Name: str, SortOrder: "int", IsActive: "bool" });
export const SaveSubCategoryDto = defineDto({ CategoryId: "int", Name: str, SortOrder: "int", IsActive: { type: "bool", default: () => true } });

/** DTOs/UpcomingEventDtos.cs */
export const UpcomingEventListDto = defineDto({
  Id: "int", ClubId: "int", Title: str, Description: "string", ImagePath: "string", EventDate: "datetime", PublishDate: "datetime",
  ExpiryDate: "datetime", EventVenue: "string", RegistrationLink: "string", IsSendWhatsapp: "bool", IsSendEmail: "bool",
  IsRepeatNotification: "bool", Status: str, ReminderCount: "int", WhatsAppSentDate: "datetime?", WhatsAppSentCount: "int",
  WhatsAppFailedCount: "int", EmailSentDate: "datetime?", EmailSentCount: "int", EmailFailedCount: "int",
});
export const UpcomingEventDetailDto = defineDto({
  Id: "int", ClubId: "int", Title: str, Description: "string", ImagePath: "string", EventDate: "datetime", PublishDate: "datetime",
  ExpiryDate: "datetime", EventVenue: "string", RegistrationLink: "string", IsSendWhatsapp: "bool", IsSendEmail: "bool",
  IsRepeatNotification: "bool", Status: str, RecipientTarget: "string", RecipientZoneIds: "string", RecipientDistrictIds: "string",
  RecipientSubgroupIds: "string", Reminders: list,
});
export const EventReminderDto = defineDto({ Id: "int", ReminderDateTime: "datetime" });
export const SaveUpcomingEventDto = defineDto({
  Title: str, Description: "string", ImagePath: "string", EventDate: "string", PublishDate: "string", ExpiryDate: "string", EventVenue: "string",
  RegistrationLink: "string", IsSendWhatsapp: "bool", IsSendEmail: "bool", IsRepeatNotification: "bool", Reminders: "object",
});
export type SaveUpcomingEvent = {
  title: string; description: string | null; imagePath: string | null; eventDate: string | null; publishDate: string | null; expiryDate: string | null;
  eventVenue: string | null; registrationLink: string | null; isSendWhatsapp: boolean; isSendEmail: boolean; isRepeatNotification: boolean; reminders: unknown;
};

/** DTOs/NewsletterDtos.cs */
export const NewsletterListDto = defineDto({
  Id: "int", ClubId: "int", Title: str, PublishDateTime: "datetime", ExpiryDateTime: "datetime", AttachmentType: { type: "string", default: () => "link" },
  LinkUrl: "string", FilePath: "string", IsSendWhatsapp: "bool", IsSendEmail: "bool", Status: str, WhatsAppSentDate: "datetime?",
  WhatsAppSentCount: "int", WhatsAppFailedCount: "int", EmailSentDate: "datetime?", EmailSentCount: "int", EmailFailedCount: "int",
});
export const NewsletterDetailDto = defineDto({
  Id: "int", ClubId: "int", Title: str, PublishDateTime: "datetime", ExpiryDateTime: "datetime", AttachmentType: { type: "string", default: () => "link" },
  LinkUrl: "string", FilePath: "string", IsSendWhatsapp: "bool", IsSendEmail: "bool", Status: str, RecipientTarget: "string",
  RecipientZoneIds: "string", RecipientDistrictIds: "string", RecipientSubgroupIds: "string",
});
export const SaveNewsletterDto = defineDto({
  Title: str, PublishDateTime: "string", ExpiryDateTime: "string", AttachmentType: { type: "string", default: () => "link" }, LinkUrl: "string",
  FilePath: "string", IsSendWhatsapp: "bool", IsSendEmail: "bool",
});
export type SaveNewsletter = {
  title: string; publishDateTime: string | null; expiryDateTime: string | null; attachmentType: string; linkUrl: string | null; filePath: string | null;
  isSendWhatsapp: boolean; isSendEmail: boolean;
};
