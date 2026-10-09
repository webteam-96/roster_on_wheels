import { Injectable } from "@nestjs/common";
import { Db } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { InvalidOperationException } from "../../common/exceptions";
import { isFutureUtc, reminderList, requireCommsCredits, resendPlan } from "../../services/comms-credits";
import { dbDateTime } from "../../common/binding";
import { CommsLimits, requireMax } from "../../services/comms-limits";
import { CreditManagementService } from "../../services/credit-management.service";
import { saveWithReadableName, type UploadedFile } from "../../services/media-storage";
import { AnnouncementDetailDto, AnnouncementListDto, AnnouncementReminderDto, type SaveAnnouncement } from "../../dtos/content.dtos";

const IMAGE_PATH = (alias: string) => `
    CASE
        WHEN ${alias}.ImagePath IS NULL OR ${alias}.ImagePath = '' THEN NULL
        WHEN ${alias}.ImagePath LIKE '/%' THEN ${alias}.ImagePath
        WHEN ${alias}.Scope = 'ri' THEN CONCAT('/Documents/announcement/ri/', ${alias}.ImagePath)
        WHEN ${alias}.fk_district_id IS NOT NULL THEN CONCAT('/Documents/announcement/Group', ${alias}.fk_district_id, '/', ${alias}.ImagePath)
        ELSE CONCAT('/Documents/announcement/Group', ${alias}.fk_club_id, '/', ${alias}.ImagePath)
    END`;

/**
 * Port of AnnouncementService.cs. Club announcements (fk_club_id) and, when a
 * district id is given, district announcements (fk_club_id = 0). Saving with
 * "send through WhatsApp / Email" checks the credit balance first.
 */
@Injectable()
export class AnnouncementService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly credits: CreditManagementService,
  ) {}

  async getAll(clubId: number, status: string, search: string, page: number, pageSize: number, districtId: number | null = null) {
    const where = districtId !== null ? "a.fk_district_id = @EntityId" : "a.fk_club_id = @EntityId";
    const statusCond = status
      ? `AND (CASE WHEN NOW() < a.PublishDateTime THEN 'Unpublished' WHEN NOW() > a.ExpiryDateTime THEN 'Expired' ELSE 'Published' END = @Status)`
      : "";
    const searchCond = search ? "AND a.Title LIKE CONCAT('%', @Search, '%')" : "";
    const [rows, count] = await this.db.queryMultiple(
      `SELECT a.pk_announcement_id AS Id, a.fk_club_id AS ClubId,
              a.Title, a.Description,
              ${IMAGE_PATH("a")} AS ImagePath,
              a.PublishDateTime, a.ExpiryDateTime,
              a.IsDisplayOnBanner, a.IsSendWhatsapp, a.IsSendEmail, a.IsRepeatNotification,
              a.WhatsAppSentDate, a.WhatsAppSentCount, a.WhatsAppFailedCount,
              a.EmailSentDate, a.EmailSentCount, a.EmailFailedCount,
              CASE
                  WHEN NOW() < a.PublishDateTime THEN 'Unpublished'
                  WHEN NOW() > a.ExpiryDateTime THEN 'Expired'
                  ELSE 'Published'
              END AS Status,
              (SELECT COUNT(*) FROM announcement_reminders r WHERE r.fk_announcement_id = a.pk_announcement_id) AS ReminderCount
       FROM announcements a
       WHERE ${where} AND a.isdeleted = 0
       ${statusCond} ${searchCond}
       ORDER BY a.PublishDateTime DESC
       LIMIT @PageSize OFFSET @Offset;
       SELECT COUNT(*) FROM announcements a
       WHERE ${where} AND a.isdeleted = 0
       ${statusCond} ${searchCond};`,
      { EntityId: districtId ?? clubId, Status: status ?? "", Search: search ?? "", PageSize: pageSize, Offset: (page - 1) * pageSize },
    );
    return { items: AnnouncementListDto.mapAll(rows), totalCount: Number(Object.values(count[0] ?? {})[0] ?? 0) };
  }

  async getById(id: number) {
    const [rows, reminders] = await this.db.queryMultiple(
      `SELECT a.pk_announcement_id AS Id,
              a.fk_club_id AS ClubId,
              a.Title, a.Description,
              ${IMAGE_PATH("a")} AS ImagePath,
              a.PublishDateTime, a.ExpiryDateTime,
              a.IsDisplayOnBanner, a.IsSendWhatsapp, a.IsSendEmail, a.IsRepeatNotification,
              a.RecipientTarget, a.RecipientZoneIds, a.RecipientDistrictIds, a.RecipientSubgroupIds,
              CASE
                  WHEN a.ExpiryDateTime < NOW() THEN 'Expired'
                  WHEN a.PublishDateTime <= NOW() AND a.ExpiryDateTime >= NOW() THEN 'Published'
                  ELSE 'Unpublished'
              END AS Status
       FROM announcements a
       WHERE a.pk_announcement_id = @Id AND a.isdeleted = 0;
       SELECT r.pk_reminder_id AS Id, r.ReminderDateTime
       FROM announcement_reminders r
       WHERE r.fk_announcement_id = @Id AND r.IsActive = 1
       ORDER BY r.ReminderDateTime;`,
      { Id: id },
    );
    const detail = AnnouncementDetailDto.map(rows[0] ?? null);
    if (detail) detail.reminders = AnnouncementReminderDto.mapAll(reminders);
    return detail;
  }

  async create(clubId: number, dto: SaveAnnouncement, createdBy: number, districtId: number | null = null): Promise<number> {
    requireMax(dto.title, CommsLimits.AnnouncementTitle, "Title");
    requireMax(dto.description, CommsLimits.AnnouncementDescription, "Description");
    const reminders = reminderList(dto.reminders);
    const entityId = districtId ?? clubId;
    return this.db.session(async (conn) => {
      if (dto.isSendWhatsapp && entityId > 0) await requireCommsCredits(this.credits, conn, entityId, clubId, districtId, "WhatsApp", reminders.length);
      if (dto.isSendEmail && entityId > 0) await requireCommsCredits(this.credits, conn, entityId, clubId, districtId, "Email", reminders.length);
      const id = Number(
        await conn.executeScalar(
          `INSERT INTO announcements (fk_club_id, fk_district_id, Title, Description, ImagePath,
               PublishDateTime, ExpiryDateTime, IsDisplayOnBanner, IsSendWhatsapp, IsSendEmail, IsRepeatNotification,
               created_by, created_date, isdeleted)
           VALUES (@ClubId, @DistrictId, @Title, @Description, @ImagePath,
               @PublishDateTime, @ExpiryDateTime, @IsDisplayOnBanner, @IsSendWhatsapp, @IsSendEmail, @IsRepeatNotification,
               @CreatedBy, NOW(), 0);
           SELECT LAST_INSERT_ID();`,
          {
            ClubId: districtId !== null ? 0 : clubId, DistrictId: districtId, Title: dto.title, Description: dto.description, ImagePath: dto.imagePath,
            PublishDateTime: dbDateTime(dto.publishDateTime) ?? "0001-01-01 00:00:00", ExpiryDateTime: dbDateTime(dto.expiryDateTime) ?? "0001-01-01 00:00:00",
            IsDisplayOnBanner: dto.isDisplayOnBanner ? 1 : 0, IsSendWhatsapp: dto.isSendWhatsapp ? 1 : 0, IsSendEmail: dto.isSendEmail ? 1 : 0,
            IsRepeatNotification: dto.isRepeatNotification ? 1 : 0, CreatedBy: createdBy,
          },
        ),
      );
      for (const r of reminders) await conn.executeProcedure("sp_announcement_reminder_add", { p_AnnouncementId: id, p_ReminderDateTime: r, p_CreatedBy: createdBy });
      return id;
    });
  }

  /**
   * Turning a channel on, or moving an already-sent announcement to a future
   * publish time, re-checks credits and clears the sent counters so the
   * scheduler sends again.
   */
  async update(id: number, dto: SaveAnnouncement, modifiedBy: number): Promise<void> {
    requireMax(dto.title, CommsLimits.AnnouncementTitle, "Title");
    requireMax(dto.description, CommsLimits.AnnouncementDescription, "Description");
    const reminders = reminderList(dto.reminders);
    const publish = dbDateTime(dto.publishDateTime) ?? "0001-01-01 00:00:00";
    await this.db.session(async (conn) => {
      const expired = Number(await conn.executeScalar("SELECT COUNT(*) FROM announcements WHERE pk_announcement_id = @Id AND isdeleted = 0 AND ExpiryDateTime < NOW()", { Id: id }));
      if (expired > 0) throw new InvalidOperationException("Cannot edit an expired item. Once an item's expiry date has passed, it can no longer be modified.");
      const prior = await conn.queryFirstOrDefault(
        `SELECT fk_club_id, fk_district_id, IsSendWhatsapp, WhatsAppSentDate, IsSendEmail, EmailSentDate,
                DATE_FORMAT(PublishDateTime, '%Y-%m-%d %H:%i:%s') AS PublishDateTime
         FROM announcements WHERE pk_announcement_id = @Id AND isdeleted = 0`,
        { Id: id },
      );
      const clubId = prior ? Number(prior.fk_club_id) : 0;
      const districtId = prior && prior.fk_district_id !== null ? Number(prior.fk_district_id) : null;
      const entityId = districtId ?? clubId;
      const plan = resendPlan(prior, dto.isSendWhatsapp, dto.isSendEmail, isFutureUtc(publish));
      if (plan.wa && entityId > 0) await requireCommsCredits(this.credits, conn, entityId, clubId, districtId, "WhatsApp", reminders.length);
      if (plan.email && entityId > 0) await requireCommsCredits(this.credits, conn, entityId, clubId, districtId, "Email", reminders.length);

      await conn.executeProcedure("sp_announcement_update", {
        p_Id: id, p_Title: dto.title, p_Description: dto.description, p_ImagePath: dto.imagePath, p_PublishDateTime: publish,
        p_ExpiryDateTime: dbDateTime(dto.expiryDateTime) ?? "0001-01-01 00:00:00", p_IsDisplayOnBanner: dto.isDisplayOnBanner ? 1 : 0,
        p_IsSendWhatsapp: dto.isSendWhatsapp ? 1 : 0, p_IsRepeatNotification: dto.isRepeatNotification ? 1 : 0, p_ModifiedBy: modifiedBy,
      });
      await conn.execute("UPDATE announcements SET IsSendEmail = @E WHERE pk_announcement_id = @Id", { E: dto.isSendEmail ? 1 : 0, Id: id });
      if (plan.clear.length) await conn.execute(`UPDATE announcements SET ${plan.clear.join(", ")} WHERE pk_announcement_id = @Id`, { Id: id });
      // A moved publish time re-arms the push notification.
      if (prior && prior.PublishDateTime && prior.PublishDateTime !== publish) {
        await conn.execute("UPDATE announcements SET PushNotificationSent = 0, PushNotificationSentAt = NULL WHERE pk_announcement_id = @Id", { Id: id });
      }
      await conn.execute("DELETE FROM announcement_reminders WHERE fk_announcement_id = @EventId", { EventId: id });
      for (const r of reminders) await conn.executeProcedure("sp_announcement_reminder_add", { p_AnnouncementId: id, p_ReminderDateTime: r, p_CreatedBy: modifiedBy });
    });
  }

  async delete(id: number, deletedBy: number) {
    await this.db.executeProcedure("sp_announcement_delete", { p_Id: id, p_DeletedBy: deletedBy });
  }

  uploadImage(clubId: number, file: UploadedFile): Promise<string> {
    return saveWithReadableName(this.config, file, "", "Documents", "announcement", `Group${clubId}`);
  }
}
