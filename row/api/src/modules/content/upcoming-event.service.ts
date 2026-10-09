import { Injectable } from "@nestjs/common";
import { Db } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { InvalidOperationException } from "../../common/exceptions";
import { dbDateTime } from "../../common/binding";
import { CommsLimits, requireMax } from "../../services/comms-limits";
import { CreditManagementService } from "../../services/credit-management.service";
import { isFutureUtc, reminderList, requireCommsCredits, resendPlan } from "../../services/comms-credits";
import { saveWithReadableName, type UploadedFile } from "../../services/media-storage";
import { EventReminderDto, UpcomingEventDetailDto, UpcomingEventListDto, type SaveUpcomingEvent } from "../../dtos/content.dtos";

const IMAGE_PATH = `
    CASE
        WHEN e.ImagePath IS NULL OR e.ImagePath = '' THEN NULL
        WHEN e.ImagePath LIKE '/%' THEN e.ImagePath
        WHEN e.Scope = 'ri' THEN CONCAT('/Documents/Event/ri/', e.ImagePath)
        WHEN e.fk_district_id IS NOT NULL THEN CONCAT('/Documents/Event/Group', e.fk_district_id, '/', e.ImagePath)
        ELSE CONCAT('/Documents/Event/Group', e.fk_club_id, '/', e.ImagePath)
    END`;
const NO_DATE = "0001-01-01 00:00:00";

/** Port of UpcomingEventService.cs: club (or district) upcoming events with WhatsApp / email reminders. */
@Injectable()
export class UpcomingEventService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly credits: CreditManagementService,
  ) {}

  async getAll(clubId: number, status: string, search: string, page: number, pageSize: number, districtId: number | null = null) {
    const where = districtId !== null ? "e.fk_district_id = @EntityId" : "e.fk_club_id = @EntityId";
    const statusCond = status
      ? `AND (CASE WHEN NOW() < e.PublishDate THEN 'Unpublished' WHEN NOW() > e.ExpiryDate THEN 'Expired' ELSE 'Published' END = @Status)`
      : "";
    const searchCond = search ? "AND e.Title LIKE CONCAT('%', @Search, '%')" : "";
    const [rows, count] = await this.db.queryMultiple(
      `SELECT e.pk_upcoming_event_id AS Id, e.fk_club_id AS ClubId,
              e.Title, e.Description,
              ${IMAGE_PATH} AS ImagePath,
              e.EventDate, e.PublishDate, e.ExpiryDate,
              e.EventVenue, e.RegistrationLink, e.IsSendWhatsapp, e.IsSendEmail, e.IsRepeatNotification,
              e.WhatsAppSentDate, e.WhatsAppSentCount, e.WhatsAppFailedCount,
              e.EmailSentDate, e.EmailSentCount, e.EmailFailedCount,
              CASE
                  WHEN NOW() < e.PublishDate THEN 'Unpublished'
                  WHEN NOW() > e.ExpiryDate THEN 'Expired'
                  ELSE 'Published'
              END AS Status,
              (SELECT COUNT(*) FROM upcoming_event_reminders r WHERE r.fk_upcoming_event_id = e.pk_upcoming_event_id) AS ReminderCount
       FROM upcoming_events e
       WHERE ${where} AND e.isdeleted = 0
       ${statusCond} ${searchCond}
       ORDER BY e.EventDate DESC
       LIMIT @PageSize OFFSET @Offset;
       SELECT COUNT(*) FROM upcoming_events e
       WHERE ${where} AND e.isdeleted = 0
       ${statusCond} ${searchCond};`,
      { EntityId: districtId ?? clubId, Status: status ?? "", Search: search ?? "", PageSize: pageSize, Offset: (page - 1) * pageSize },
    );
    return { items: UpcomingEventListDto.mapAll(rows), totalCount: Number(Object.values(count[0] ?? {})[0] ?? 0) };
  }

  async getById(id: number) {
    const [rows, reminders] = await this.db.queryMultiple(
      `SELECT e.pk_upcoming_event_id AS Id,
              e.fk_club_id AS ClubId,
              e.Title, e.Description,
              ${IMAGE_PATH} AS ImagePath,
              e.EventDate, e.PublishDate, e.ExpiryDate,
              e.EventVenue, e.RegistrationLink,
              e.IsSendWhatsapp, e.IsSendEmail, e.IsRepeatNotification,
              CASE
                  WHEN e.ExpiryDate < NOW() THEN 'Expired'
                  WHEN e.PublishDate <= NOW() AND e.ExpiryDate >= NOW() THEN 'Published'
                  ELSE 'Unpublished'
              END AS Status
       FROM upcoming_events e
       WHERE e.pk_upcoming_event_id = @Id AND e.isdeleted = 0;
       SELECT r.pk_reminder_id AS Id, r.ReminderDateTime
       FROM upcoming_event_reminders r
       WHERE r.fk_upcoming_event_id = @Id AND r.IsActive = 1
       ORDER BY r.ReminderDateTime;`,
      { Id: id },
    );
    const detail = UpcomingEventDetailDto.map(rows[0] ?? null);
    if (detail) detail.reminders = EventReminderDto.mapAll(reminders);
    return detail;
  }

  private static checkLimits(dto: SaveUpcomingEvent) {
    requireMax(dto.title, CommsLimits.EventTitle, "Title");
    requireMax(dto.eventVenue, CommsLimits.EventVenue, "Event Venue");
    requireMax(dto.description, CommsLimits.EventDescription, "Description");
  }

  private static values(dto: SaveUpcomingEvent) {
    return {
      Title: dto.title, Description: dto.description, ImagePath: dto.imagePath, EventDate: dbDateTime(dto.eventDate) ?? NO_DATE,
      PublishDate: dbDateTime(dto.publishDate) ?? NO_DATE, ExpiryDate: dbDateTime(dto.expiryDate) ?? NO_DATE, EventVenue: dto.eventVenue,
      RegistrationLink: dto.registrationLink, IsSendWhatsapp: dto.isSendWhatsapp ? 1 : 0, IsSendEmail: dto.isSendEmail ? 1 : 0,
      IsRepeatNotification: dto.isRepeatNotification ? 1 : 0,
    };
  }

  async create(clubId: number, dto: SaveUpcomingEvent, createdBy: number, districtId: number | null = null): Promise<number> {
    UpcomingEventService.checkLimits(dto);
    const reminders = reminderList(dto.reminders);
    const entityId = districtId ?? clubId;
    return this.db.session(async (conn) => {
      if (dto.isSendWhatsapp && entityId > 0) await requireCommsCredits(this.credits, conn, entityId, clubId, districtId, "WhatsApp", reminders.length);
      if (dto.isSendEmail && entityId > 0) await requireCommsCredits(this.credits, conn, entityId, clubId, districtId, "Email", reminders.length);
      const id = Number(
        await conn.executeScalar(
          `INSERT INTO upcoming_events (fk_club_id, fk_district_id, Title, Description, ImagePath,
               EventDate, PublishDate, ExpiryDate, EventVenue, RegistrationLink,
               IsSendWhatsapp, IsSendEmail, IsRepeatNotification, created_by, created_date, isdeleted)
           VALUES (@ClubId, @DistrictId, @Title, @Description, @ImagePath,
               @EventDate, @PublishDate, @ExpiryDate, @EventVenue, @RegistrationLink,
               @IsSendWhatsapp, @IsSendEmail, @IsRepeatNotification, @CreatedBy, NOW(), 0);
           SELECT LAST_INSERT_ID();`,
          { ...UpcomingEventService.values(dto), ClubId: districtId !== null ? 0 : clubId, DistrictId: districtId, CreatedBy: createdBy },
        ),
      );
      for (const r of reminders) {
        await conn.execute(
          `INSERT INTO upcoming_event_reminders (fk_upcoming_event_id, ReminderDateTime, IsActive, created_by, created_date)
           VALUES (@EventId, @ReminderDateTime, 1, @CreatedBy, NOW())`,
          { EventId: id, ReminderDateTime: r, CreatedBy: createdBy },
        );
      }
      return id;
    });
  }

  async update(id: number, dto: SaveUpcomingEvent, modifiedBy: number): Promise<void> {
    UpcomingEventService.checkLimits(dto);
    const reminders = reminderList(dto.reminders);
    const values = UpcomingEventService.values(dto);
    await this.db.session(async (conn) => {
      const expired = Number(await conn.executeScalar("SELECT COUNT(*) FROM upcoming_events WHERE pk_upcoming_event_id = @Id AND isdeleted = 0 AND ExpiryDate < NOW()", { Id: id }));
      if (expired > 0) throw new InvalidOperationException("Cannot edit an expired item. Once an item's expiry date has passed, it can no longer be modified.");
      const prior = await conn.queryFirstOrDefault(
        `SELECT fk_club_id, fk_district_id, IsSendWhatsapp, WhatsAppSentDate, IsSendEmail, EmailSentDate
         FROM upcoming_events WHERE pk_upcoming_event_id = @Id AND isdeleted = 0`,
        { Id: id },
      );
      const clubId = prior ? Number(prior.fk_club_id) : 0;
      const districtId = prior && prior.fk_district_id !== null ? Number(prior.fk_district_id) : null;
      const entityId = districtId ?? clubId;
      const plan = resendPlan(prior, dto.isSendWhatsapp, dto.isSendEmail, isFutureUtc(values.PublishDate));
      if (plan.wa && entityId > 0) await requireCommsCredits(this.credits, conn, entityId, clubId, districtId, "WhatsApp", reminders.length);
      if (plan.email && entityId > 0) await requireCommsCredits(this.credits, conn, entityId, clubId, districtId, "Email", reminders.length);
      await conn.execute(
        `UPDATE upcoming_events SET
             Title = @Title, Description = @Description, ImagePath = @ImagePath,
             EventDate = @EventDate, PublishDate = @PublishDate, ExpiryDate = @ExpiryDate,
             EventVenue = @EventVenue, RegistrationLink = @RegistrationLink,
             IsSendWhatsapp = @IsSendWhatsapp, IsSendEmail = @IsSendEmail, IsRepeatNotification = @IsRepeatNotification,
             modified_by = @ModifiedBy, modified_date = NOW()${plan.clear.map((c) => ", " + c).join("")}
         WHERE pk_upcoming_event_id = @Id AND isdeleted = 0`,
        { ...values, Id: id, ModifiedBy: modifiedBy },
      );
      await conn.execute("DELETE FROM upcoming_event_reminders WHERE fk_upcoming_event_id = @EventId", { EventId: id });
      for (const r of reminders) {
        await conn.execute(
          `INSERT INTO upcoming_event_reminders (fk_upcoming_event_id, ReminderDateTime, IsActive, created_by, created_date)
           VALUES (@EventId, @ReminderDateTime, 1, @CreatedBy, NOW())`,
          { EventId: id, ReminderDateTime: r, CreatedBy: modifiedBy },
        );
      }
    });
  }

  async delete(id: number, deletedBy: number) {
    await this.db.execute("UPDATE upcoming_events SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW() WHERE pk_upcoming_event_id = @Id", { Id: id, DeletedBy: deletedBy });
  }

  uploadImage(clubId: number, file: UploadedFile): Promise<string> {
    return saveWithReadableName(this.config, file, "", "Documents", "Event", `Group${clubId}`);
  }
}
