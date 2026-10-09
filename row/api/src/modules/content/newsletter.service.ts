import { Injectable } from "@nestjs/common";
import { Db } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { ArgumentException } from "../../common/exceptions";
import { dbDateTime } from "../../common/binding";
import { CommsLimits, requireMax } from "../../services/comms-limits";
import { CreditManagementService } from "../../services/credit-management.service";
import { CitationRecalcTrigger } from "../../services/citation-recalc.trigger";
import { isFutureUtc, requireCommsCredits, resendPlan } from "../../services/comms-credits";
import { saveWithReadableName, type UploadedFile } from "../../services/media-storage";
import { NewsletterDetailDto, NewsletterListDto, type SaveNewsletter } from "../../dtos/content.dtos";

const FILE_PATH = `
    CASE
        WHEN n.FilePath IS NULL OR n.FilePath = '' THEN NULL
        WHEN n.FilePath LIKE '/%' THEN n.FilePath
        WHEN n.Scope = 'ri' THEN CONCAT('/Documents/ebulletin/ri/', n.FilePath)
        WHEN n.fk_district_id IS NOT NULL AND n.fk_district_id > 0
             THEN CONCAT('/Documents/ebulletin/Group', n.fk_district_id, '/', n.FilePath)
        WHEN n.fk_club_id IS NOT NULL AND n.fk_club_id > 0
             THEN CONCAT('/Documents/ebulletin/Group', n.fk_club_id, '/', n.FilePath)
        ELSE NULL
    END`;
const NO_DATE = "0001-01-01 00:00:00";
/** The Rotary year a publish date falls in. */
const YEAR_OF = `(SELECT pk_year_id FROM rotary_year_master
                 WHERE @PublishDateTime >= StartDate
                   AND @PublishDateTime < DATE_ADD(EndDate, INTERVAL 1 DAY)
                 LIMIT 1)`;

/** Port of NewsletterService.cs: club (or district) e-bulletins, a link or an uploaded PDF. */
@Injectable()
export class NewsletterService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly credits: CreditManagementService,
    private readonly citation: CitationRecalcTrigger,
  ) {}

  async getAll(clubId: number, yearId: number, status: string, search: string, page: number, pageSize: number, districtId: number | null = null) {
    const where = districtId !== null ? "n.fk_district_id = @EntityId" : "n.fk_club_id = @EntityId";
    const statusCond = status ? `AND (CASE WHEN NOW() < n.PublishDateTime THEN 'Unpublished' ELSE 'Published' END = @Status)` : "";
    const searchCond = search ? "AND n.Title LIKE CONCAT('%', @Search, '%')" : "";
    const yearJoin = yearId > 0
      ? "JOIN rotary_year_master y ON y.pk_year_id = @YearId AND n.PublishDateTime >= y.StartDate AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)"
      : "";
    const [rows, count] = await this.db.queryMultiple(
      `SELECT n.pk_newsletter_id AS Id, n.fk_club_id AS ClubId,
              n.Title, n.PublishDateTime, n.ExpiryDateTime, n.AttachmentType, n.LinkUrl,
              ${FILE_PATH} AS FilePath,
              n.IsSendWhatsapp, n.IsSendEmail,
              n.WhatsAppSentDate, n.WhatsAppSentCount, n.WhatsAppFailedCount,
              n.EmailSentDate, n.EmailSentCount, n.EmailFailedCount,
              CASE WHEN NOW() < n.PublishDateTime THEN 'Unpublished' ELSE 'Published' END AS Status
       FROM newsletters n
       ${yearJoin}
       WHERE ${where} AND COALESCE(n.isdeleted, 0) = 0
       ${statusCond} ${searchCond}
       ORDER BY n.PublishDateTime DESC
       LIMIT @PageSize OFFSET @Offset;
       SELECT COUNT(*) FROM newsletters n
       ${yearJoin}
       WHERE ${where} AND COALESCE(n.isdeleted, 0) = 0
       ${statusCond} ${searchCond};`,
      { EntityId: districtId ?? clubId, YearId: yearId, Status: status ?? "", Search: search ?? "", PageSize: pageSize, Offset: (page - 1) * pageSize },
    );
    return { items: NewsletterListDto.mapAll(rows), totalCount: Number(Object.values(count[0] ?? {})[0] ?? 0) };
  }

  async getById(id: number) {
    return NewsletterDetailDto.map(
      await this.db.queryFirstOrDefault(
        `SELECT n.pk_newsletter_id AS Id,
                n.fk_club_id AS ClubId,
                n.Title, n.PublishDateTime, n.ExpiryDateTime,
                n.AttachmentType, n.LinkUrl,
                ${FILE_PATH} AS FilePath,
                n.IsSendWhatsapp, n.IsSendEmail,
                CASE WHEN NOW() < n.PublishDateTime THEN 'Unpublished' ELSE 'Published' END AS Status
         FROM newsletters n
         WHERE n.pk_newsletter_id = @Id AND COALESCE(n.isdeleted, 0) = 0`,
        { Id: id },
      ),
    );
  }

  async create(clubId: number, dto: SaveNewsletter, createdBy: number, districtId: number | null = null): Promise<number> {
    requireMax(dto.title, CommsLimits.NewsletterTitle, "Title");
    const entityId = districtId ?? clubId;
    const id = await this.db.session(async (conn) => {
      if (dto.isSendWhatsapp && entityId > 0) await requireCommsCredits(this.credits, conn, entityId, clubId, districtId, "WhatsApp", 0, true);
      if (dto.isSendEmail && entityId > 0) await requireCommsCredits(this.credits, conn, entityId, clubId, districtId, "Email", 0, true);
      return Number(
        await conn.executeScalar(
          `INSERT INTO newsletters (fk_club_id, fk_district_id, fk_year_id, Title, PublishDateTime, ExpiryDateTime,
               AttachmentType, LinkUrl, FilePath, IsSendWhatsapp, IsSendEmail, created_by, created_date, isdeleted)
           VALUES (@ClubId, @DistrictId, ${YEAR_OF},
               @Title, @PublishDateTime, @ExpiryDateTime,
               @AttachmentType, @LinkUrl, @FilePath, @IsSendWhatsapp, @IsSendEmail, @CreatedBy, NOW(), 0);
           SELECT LAST_INSERT_ID();`,
          {
            ClubId: districtId !== null ? 0 : clubId, DistrictId: districtId, Title: dto.title, PublishDateTime: dbDateTime(dto.publishDateTime) ?? NO_DATE,
            ExpiryDateTime: dbDateTime(dto.expiryDateTime) ?? NO_DATE, AttachmentType: dto.attachmentType, LinkUrl: dto.linkUrl, FilePath: dto.filePath,
            IsSendWhatsapp: dto.isSendWhatsapp ? 1 : 0, IsSendEmail: dto.isSendEmail ? 1 : 0, CreatedBy: createdBy,
          },
        ),
      );
    });
    if (districtId === null) this.citation.triggerForClub(clubId);
    return id;
  }

  async update(id: number, dto: SaveNewsletter, modifiedBy: number): Promise<void> {
    requireMax(dto.title, CommsLimits.NewsletterTitle, "Title");
    const publish = dbDateTime(dto.publishDateTime) ?? NO_DATE;
    await this.db.session(async (conn) => {
      const prior = await conn.queryFirstOrDefault(
        `SELECT fk_club_id, fk_district_id, IsSendWhatsapp, WhatsAppSentDate, IsSendEmail, EmailSentDate,
                DATE_FORMAT(PublishDateTime, '%Y-%m-%d %H:%i:%s') AS PublishDateTime
         FROM newsletters WHERE pk_newsletter_id = @Id AND COALESCE(isdeleted, 0) = 0`,
        { Id: id },
      );
      const clubId = prior ? Number(prior.fk_club_id) : 0;
      const districtId = prior && prior.fk_district_id !== null ? Number(prior.fk_district_id) : null;
      const entityId = districtId ?? clubId;
      const plan = resendPlan(prior, dto.isSendWhatsapp, dto.isSendEmail, isFutureUtc(publish));
      if (plan.wa && entityId > 0) await requireCommsCredits(this.credits, conn, entityId, clubId, districtId, "WhatsApp", 0, true);
      if (plan.email && entityId > 0) await requireCommsCredits(this.credits, conn, entityId, clubId, districtId, "Email", 0, true);
      await conn.executeProcedure("sp_newsletter_update", {
        p_Id: id, p_Title: dto.title, p_PublishDateTime: publish, p_ExpiryDateTime: dbDateTime(dto.expiryDateTime) ?? NO_DATE,
        p_AttachmentType: dto.attachmentType, p_LinkUrl: dto.linkUrl, p_FilePath: dto.filePath, p_IsSendWhatsapp: dto.isSendWhatsapp ? 1 : 0,
        p_ModifiedBy: modifiedBy,
      });
      await conn.execute(`UPDATE newsletters SET fk_year_id = ${YEAR_OF}, IsSendEmail = @IsSendEmail WHERE pk_newsletter_id = @Id`, {
        Id: id, PublishDateTime: publish, IsSendEmail: dto.isSendEmail ? 1 : 0,
      });
      if (plan.clear.length) await conn.execute(`UPDATE newsletters SET ${plan.clear.join(", ")} WHERE pk_newsletter_id = @Id`, { Id: id });
      if (prior && prior.PublishDateTime && prior.PublishDateTime !== publish) {
        await conn.execute("UPDATE newsletters SET PushNotificationSent = 0, PushNotificationSentAt = NULL WHERE pk_newsletter_id = @Id", { Id: id });
      }
    });
  }

  async delete(id: number, deletedBy: number) {
    const row = await this.db.queryFirstOrDefault("SELECT fk_club_id FROM newsletters WHERE pk_newsletter_id = @Id AND COALESCE(isdeleted, 0) = 0", { Id: id });
    await this.db.executeProcedure("sp_newsletter_delete", { p_Id: id, p_DeletedBy: deletedBy });
    const clubFk = row && row.fk_club_id !== null ? Number(row.fk_club_id) : 0;
    if (clubFk > 0) this.citation.triggerForClub(clubFk);
  }

  uploadFile(clubId: number, file: UploadedFile): Promise<string> {
    if (clubId <= 0) throw new ArgumentException("Newsletter upload requires a valid club or district id (>0). (Parameter 'clubId')");
    return saveWithReadableName(this.config, file, "", "Documents", "ebulletin", `Group${clubId}`);
  }

  async getYears(clubId: number, districtId: number | null = null) {
    const where = districtId !== null ? "n.fk_district_id = @EntityId" : "n.fk_club_id = @EntityId";
    return this.db.query(
      `SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
       FROM rotary_year_master y
       INNER JOIN newsletters n
         ON n.PublishDateTime >= y.StartDate
        AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
       WHERE ${where}
         AND COALESCE(n.isdeleted, 0) = 0
       UNION
       SELECT y2.pk_year_id AS id, y2.YearLabel AS yearLabel, y2.IsCurrent AS isCurrent
       FROM rotary_year_master y2
       WHERE y2.IsCurrent = 1
       ORDER BY id DESC`,
      { EntityId: districtId ?? clubId },
    );
  }
}
