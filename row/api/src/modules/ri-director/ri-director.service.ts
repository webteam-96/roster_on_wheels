import { Injectable, Logger } from "@nestjs/common";
import { AppConfig } from "../../config/app-config";
import { bodyField, dbDateTime } from "../../common/binding";
import { defineDto } from "../../common/dto";
import { formatDate, nowIn } from "../../common/dotnet-format";
import { InvalidOperationException } from "../../common/exceptions";
import { Brand } from "../../brand/brand";
import { Db, type DbCommands } from "../../database/db.service";
import {
  AnnouncementDetailDto, AnnouncementListDto, AnnouncementReminderDto, DocumentDto, EventReminderDto, NewsletterDetailDto, NewsletterListDto,
  UpcomingEventDetailDto, UpcomingEventListDto,
} from "../../dtos/content.dtos";
import { reminderList } from "../../services/comms-credits";
import { EmailService } from "../../services/email.service";
import { saveWithGuidName, saveWithReadableName, type UploadedFile } from "../../services/media-storage";
import { ExcelJS, toBuffer } from "../../services/xlsx";
import { validateWeblinkUrls } from "../club-groups/club-groups.service";
import { mapLimit } from "../goal-setting/goal-reports";
import { MassEmailListDto, MassEmailRecipientDto } from "../mass-emails/mass-email.service";

const str = { type: "string" as const, default: () => "" };
const list = { type: "object" as const, default: () => [] };

// ── DTOs/RiDirectorDtos.cs ───────────────────────────────────────────────────────────────────────
export const RiCreditBalanceDto = defineDto({ EmailTotal: "int", EmailUsed: "int", EmailBalance: "int", WhatsappTotal: "int", WhatsappUsed: "int", WhatsappBalance: "int" });
export const RiCreditListDto = defineDto({
  Id: "int", CreditType: str, CreditCount: "int", UsedCount: "int", PreviousCount: "int", FromDate: "datetime", ToDate: "datetime", TransactionId: "string",
  PaymentDate: "datetime?", ProofDocumentPath: "string", IsActive: "bool", CreatedDate: "datetime?", LastUsedDate: "datetime?",
});
export const RiCreditUsageHistoryDto = defineDto({
  Id: "int", CreditType: str, DeductedCount: "int", Source: str, SourceId: "int?", SourceDetail: "string", BalanceBefore: "int", BalanceAfter: "int", CreatedDate: "datetime?",
});
export const RiSubGroupYearDto = defineDto({ Id: "int", YearLabel: str, IsCurrent: "bool", GroupCount: "int" });
export const RiSubGroupListDto = defineDto({ Id: "int", YearId: "int", YearLabel: "string", GroupName: str, MemberCount: "int", CreatedDate: "datetime?" });
export const RiSubGroupMemberDto = defineDto({ MemberId: "int", MemberName: str, Email: "string", MobileNumber: "string", ProfilePhotoPath: "string", ClubName: "string", DistrictNumber: "string" });
export const RiSubGroupDetailDto = defineDto({ Id: "int", YearId: "int", YearLabel: "string", GroupName: str, Members: list });
export const RiAvailableMemberDto = defineDto({
  Id: "int", MemberName: str, Email: "string", MobileNumber: "string", ProfilePhotoPath: "string", ClubName: "string", DistrictNumber: "string", ZoneId: "int?", ZoneName: "string",
});
export const RiWeblinkListDto = defineDto({
  Id: "int", Title: str, Writeup: "string", LinkType: { type: "string", default: () => "url" }, LinkUrl: "string", YoutubeUrl: "string", ButtonText: "string",
  SortOrder: "int", IsActive: "bool", CreatedDate: "datetime?",
});
export const RiMassEmailDetailDto = defineDto({
  Id: "int", RecipientType: "int", RecipientTarget: "string", RecipientZoneIds: "string", RecipientDistrictIds: "string", RecipientSubgroupIds: "string",
  FkSubgroupId: "int?", SubgroupName: "string", FromName: str, ReplyName: "string", ReplyEmail: "string", Subject: str, EmailBody: "string", Status: str,
  TotalRecipients: "int", SentCount: "int", FailedCount: "int", SentDate: "datetime?", CreatedDate: "datetime?", Recipients: list,
});

// ── Request binding (System.Text.Json: case-insensitive, C# defaults) ────────────────────────────
const f = bodyField;
const s = (b: unknown, k: string) => { const v = f(b, k); return v === null || v === undefined ? null : String(v); };
const n = (b: unknown, k: string, d = 0) => { const v = Number(f(b, k)); return Number.isFinite(v) && f(b, k) !== null && f(b, k) !== "" ? Math.trunc(v) : d; };
const yes = (b: unknown, k: string, d = false) => { const v = f(b, k); return v === undefined || v === null ? d : v === true || v === 1 || String(v).toLowerCase() === "true"; };
/** int[]? — null when missing (the C# checks null and empty the same way). */
const ints = (b: unknown, k: string): number[] | null => { const v = f(b, k); return Array.isArray(v) ? v.map(Number).filter(Number.isFinite).map(Math.trunc) : null; };
const csv = (a: number[] | null) => (a && a.length ? a.join(",") : null);
const dt = (b: unknown, k: string) => dbDateTime(f(b, k)) ?? "0001-01-01 00:00:00";

export interface RecipientScope { recipientTarget: string | null; recipientZoneIds: number[] | null; recipientDistrictIds: number[] | null; recipientSubgroupIds: number[] | null }
const scopeOf = (b: unknown): RecipientScope => ({ recipientTarget: s(b, "recipientTarget"), recipientZoneIds: ints(b, "recipientZoneIds"), recipientDistrictIds: ints(b, "recipientDistrictIds"), recipientSubgroupIds: ints(b, "recipientSubgroupIds") });
const scopeParams = (x: RecipientScope) => ({
  RecipientTarget: x.recipientTarget ?? "all", RecipientZoneIds: csv(x.recipientZoneIds), RecipientDistrictIds: csv(x.recipientDistrictIds), RecipientSubgroupIds: csv(x.recipientSubgroupIds),
});
const STATUS_CASE = (pub: string, exp: string) => `CASE WHEN NOW() < ${pub} THEN 'Unpublished' WHEN NOW() > ${exp} THEN 'Expired' ELSE 'Published' END`;
const PHOTO = `CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END`;
const num = (v: unknown) => Number(v ?? 0) || 0;

/**
 * Port of RiDirectorService.cs (+ .Modules / .Modules2): RI-scoped content (Scope = 'ri'),
 * the RI Director's own Email/WhatsApp credit pool, and the RI reports.
 */
@Injectable()
export class RiDirectorService {
  private readonly log = new Logger("RiDirectorService");

  constructor(private readonly db: Db, private readonly config: AppConfig, private readonly email: EmailService) {}

  private get today() { return nowIn(Brand.Current.locale.defaultTimeZone).slice(0, 10); }

  // ── Context ──────────────────────────────────────────────────────────────────────────────────
  async getContext() {
    const c = this.db;
    // Placeholder zones are excluded so a newly activated zone is counted without a code change.
    const realZone = "z.isdeleted = 0 AND z.ZoneName NOT IN ('Other Zones','Zone 0')";
    const zoneCount = num(await c.executeScalar(`SELECT COUNT(*) FROM zone_master z WHERE ${realZone}`));
    const districtCount = num(await c.executeScalar(`SELECT COUNT(*) FROM district_master d JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND ${realZone} WHERE d.isdeleted = 0`));
    const clubCount = num(await c.executeScalar(
      `SELECT COUNT(*) FROM club_master c JOIN district_master d ON d.pk_district_id = c.fk_district_id
       JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND ${realZone} WHERE c.isdeleted = 0 AND d.isdeleted = 0`));
    const memberCount = num(await c.executeScalar(
      `SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
       FROM club_members cm
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND ${realZone}
       JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
       WHERE cm.IsActive = 1 AND cm.isdeleted = 0 AND c.isdeleted = 0 AND m.isdeleted = 0`));
    return { zoneCount, districtCount, clubCount, memberCount, credits: await this.getCreditBalance() };
  }

  // ── Credits ──────────────────────────────────────────────────────────────────────────────────
  async getCreditBalance() {
    const rows = await this.db.query(
      `SELECT CreditType, COALESCE(SUM(CreditCount),0) AS total, COALESCE(SUM(UsedCount),0) AS used
       FROM ri_director_credits
       WHERE isdeleted = 0 AND IsActive = 1 AND @Today BETWEEN FromDate AND ToDate
       GROUP BY CreditType`,
      { Today: this.today },
    );
    let eT = 0, eU = 0, wT = 0, wU = 0;
    for (const r of rows) {
      const type = String(r.CreditType ?? "").toLowerCase();
      if (type === "email") { eT = num(r.total); eU = num(r.used); }
      else if (type === "whatsapp") { wT = num(r.total); wU = num(r.used); }
    }
    return RiCreditBalanceDto.create({ EmailTotal: eT, EmailUsed: eU, EmailBalance: Math.max(0, eT - eU), WhatsappTotal: wT, WhatsappUsed: wU, WhatsappBalance: Math.max(0, wT - wU) });
  }

  async getCredits(creditType: string | null, page: number, pageSize: number) {
    const typeFilter = !creditType || !creditType.trim() ? "" : " AND CreditType = @CreditType ";
    const total = num(await this.db.executeScalar(`SELECT COUNT(*) FROM ri_director_credits WHERE isdeleted = 0 ${typeFilter}`, { CreditType: creditType }));
    const items = await this.db.query(
      `SELECT pk_credit_id AS Id, CreditType, CreditCount, UsedCount, PreviousCount,
              FromDate, ToDate, TransactionId, PaymentDate,
              CASE
                  WHEN ProofDocumentPath IS NULL OR ProofDocumentPath = '' THEN NULL
                  WHEN ProofDocumentPath LIKE '/%' THEN ProofDocumentPath
                  ELSE CONCAT('/Documents/ri_credit_proofs/', ProofDocumentPath)
              END AS ProofDocumentPath,
              IsActive, created_date AS CreatedDate,
              (SELECT MAX(h.created_date) FROM ri_director_credit_usage_history h WHERE h.CreditType = ri_director_credits.CreditType) AS LastUsedDate
       FROM ri_director_credits
       WHERE isdeleted = 0 ${typeFilter}
       ORDER BY pk_credit_id DESC
       LIMIT @PageSize OFFSET @Offset`,
      { CreditType: creditType, PageSize: pageSize, Offset: (page - 1) * pageSize },
    );
    return { items: RiCreditListDto.mapAll(items), totalCount: total };
  }

  async addCredit(body: unknown, proof: UploadedFile | null, userId: number): Promise<number> {
    const creditType = s(body, "creditType") ?? "";
    // Store the file name only; the read rebuilds the URL.
    const proofPath = proof && proof.size > 0 ? await saveWithGuidName(this.config, proof, "Documents", "ri_credit_proofs") : s(body, "proofDocumentPath");
    const previousTotal = num(await this.db.executeScalar("SELECT COALESCE(SUM(CreditCount),0) FROM ri_director_credits WHERE CreditType = @T AND isdeleted = 0", { T: creditType }));
    return this.db.session(async (conn) => num(await conn.executeScalar(
      `INSERT INTO ri_director_credits
          (CreditType, CreditCount, UsedCount, PreviousCount, FromDate, ToDate, TransactionId, PaymentDate, ProofDocumentPath, IsActive, created_by, created_date, isdeleted)
       VALUES (@CreditType, @CreditCount, 0, @PreviousCount, @FromDate, @ToDate, @TransactionId, @PaymentDate, @ProofPath, 1, @UserId, NOW(), 0);
       SELECT LAST_INSERT_ID();`,
      {
        CreditType: creditType, CreditCount: n(body, "creditCount"), PreviousCount: previousTotal, FromDate: dt(body, "fromDate"), ToDate: dt(body, "toDate"),
        TransactionId: s(body, "transactionId"), PaymentDate: dbDateTime(f(body, "paymentDate")), ProofPath: proofPath, UserId: userId,
      },
    )));
  }

  async deductCreditWithHistory(creditType: string, count: number, source: string, sourceId: number | null, sourceDetail: string | null, userId: number) {
    if (count <= 0) return;
    const today = this.today;
    const balanceBefore = num(await this.db.executeScalar(
      `SELECT COALESCE(SUM(CreditCount - UsedCount),0) FROM ri_director_credits
       WHERE CreditType = @T AND IsActive = 1 AND isdeleted = 0 AND @Today BETWEEN FromDate AND ToDate`,
      { T: creditType, Today: today },
    ));
    let remaining = count;
    // FIFO across the active rows.
    const rows = await this.db.query(
      `SELECT pk_credit_id, CreditCount, UsedCount FROM ri_director_credits
       WHERE CreditType = @T AND IsActive = 1 AND isdeleted = 0 AND @Today BETWEEN FromDate AND ToDate
       ORDER BY pk_credit_id ASC`,
      { T: creditType, Today: today },
    );
    for (const r of rows) {
      const avail = num(r.CreditCount) - num(r.UsedCount);
      if (avail <= 0) continue;
      const take = Math.min(avail, remaining);
      await this.db.execute("UPDATE ri_director_credits SET UsedCount = UsedCount + @Take, modified_by = @U, modified_date = NOW() WHERE pk_credit_id = @Id", { Take: take, U: userId, Id: num(r.pk_credit_id) });
      remaining -= take;
      if (remaining <= 0) break;
    }
    await this.db.execute(
      `INSERT INTO ri_director_credit_usage_history (CreditType, DeductedCount, Source, SourceId, SourceDetail, BalanceBefore, BalanceAfter, created_by, created_date)
       VALUES (@T, @Ded, @Src, @SrcId, @Detail, @BB, @BA, @U, NOW())`,
      { T: creditType, Ded: count, Src: source, SrcId: sourceId, Detail: sourceDetail, BB: balanceBefore, BA: Math.max(0, balanceBefore - count), U: userId },
    );
  }

  async getDeductedAmount(creditType: string, source: string, sourceId: number) {
    return num(await this.db.executeScalar(
      "SELECT COALESCE(SUM(DeductedCount), 0) FROM ri_director_credit_usage_history WHERE CreditType = @T AND Source = @S AND SourceId = @Id",
      { T: creditType, S: source, Id: sourceId },
    ));
  }

  async refundCreditWithHistory(creditType: string, count: number, source: string, sourceId: number | null, sourceDetail: string | null, userId: number) {
    if (count <= 0) return;
    const balanceBefore = num(await this.db.executeScalar(
      "SELECT COALESCE(SUM(CreditCount - UsedCount),0) FROM ri_director_credits WHERE CreditType = @T AND IsActive = 1 AND isdeleted = 0", { T: creditType }));
    const rows = await this.db.query(
      "SELECT pk_credit_id AS Id, UsedCount FROM ri_director_credits WHERE CreditType = @T AND isdeleted = 0 AND UsedCount > 0 ORDER BY pk_credit_id DESC", { T: creditType });
    let remaining = count, totalRefunded = 0;
    for (const r of rows) {
      if (remaining <= 0) break;
      const fromRow = Math.min(num(r.UsedCount), remaining);
      if (fromRow <= 0) continue;
      await this.db.execute("UPDATE ri_director_credits SET UsedCount = UsedCount - @R, modified_by = @U, modified_date = NOW() WHERE pk_credit_id = @Id", { R: fromRow, U: userId, Id: num(r.Id) });
      remaining -= fromRow;
      totalRefunded += fromRow;
    }
    if (totalRefunded === 0) return;
    await this.db.execute(
      `INSERT INTO ri_director_credit_usage_history (CreditType, DeductedCount, Source, SourceId, SourceDetail, BalanceBefore, BalanceAfter, created_by, created_date)
       VALUES (@T, @Count, @Src, @SrcId, @Detail, @BB, @BA, @U, NOW())`,
      { T: creditType, Count: -totalRefunded, Src: source, SrcId: sourceId, Detail: "[Refund] " + (sourceDetail ?? ""), BB: balanceBefore, BA: balanceBefore + totalRefunded, U: userId },
    );
  }

  async hasSufficientCredits(creditType: string, count: number) {
    const avail = num(await this.db.executeScalar(
      `SELECT COALESCE(SUM(CreditCount - UsedCount),0) FROM ri_director_credits
       WHERE CreditType = @T AND IsActive = 1 AND isdeleted = 0 AND @Today BETWEEN FromDate AND ToDate`,
      { T: creditType, Today: this.today },
    ));
    return avail >= count;
  }

  async getUsageHistory(creditType: string | null, page: number, pageSize: number) {
    const typeFilter = !creditType || !creditType.trim() ? "" : " WHERE CreditType = @CreditType ";
    const total = num(await this.db.executeScalar(`SELECT COUNT(*) FROM ri_director_credit_usage_history ${typeFilter}`, { CreditType: creditType }));
    const items = await this.db.query(
      `SELECT pk_id AS Id, CreditType, DeductedCount, Source, SourceId, SourceDetail, BalanceBefore, BalanceAfter, created_date AS CreatedDate
       FROM ri_director_credit_usage_history
       ${typeFilter}
       ORDER BY pk_id DESC
       LIMIT @PageSize OFFSET @Offset`,
      { CreditType: creditType, PageSize: pageSize, Offset: (page - 1) * pageSize },
    );
    return { items: RiCreditUsageHistoryDto.mapAll(items), totalCount: total };
  }

  /** Recipients × (1 initial + N reminders) must be covered by the RI pool before a save with sending on. */
  private async requireCredits(channel: "WhatsApp" | "Email", scope: RecipientScope, reminders: number) {
    const count = await this.getRecipientCount(channel.toLowerCase(), scope.recipientTarget ?? "all", scope.recipientZoneIds, scope.recipientDistrictIds, scope.recipientSubgroupIds);
    const needed = count * (1 + reminders);
    if (needed > 0 && !(await this.hasSufficientCredits(channel, needed))) {
      const what = channel === "WhatsApp" ? "WhatsApp notification" : "email notification";
      throw new InvalidOperationException(`Insufficient ${channel} credits. Need ${needed} credit(s) for ${count} members × ${1 + reminders} sends. Please uncheck 'Send through ${channel}' to save without ${what}, or reduce reminders, or purchase more credits.`);
    }
  }

  // ── Recipient count ──────────────────────────────────────────────────────────────────────────
  async getRecipientCount(channel: string, target: string, zoneIds: number[] | null, districtIds: number[] | null, subgroupIds: number[] | null = null): Promise<number> {
    const contactFilter = channel?.toLowerCase() === "whatsapp" ? "m.PrimaryMobileNumber IS NOT NULL AND m.PrimaryMobileNumber <> ''" : "m.EmailId IS NOT NULL AND m.EmailId <> ''";
    const t = target?.toLowerCase();
    if (t === "subgroups") {
      if (!subgroupIds || subgroupIds.length === 0) return 0;
      return num(await this.db.executeScalar(
        `SELECT COUNT(DISTINCT m.pk_member_master_profile_id)
         FROM sub_group_members sm
         JOIN sub_groups sg ON sg.pk_sub_group_id = sm.fk_sub_group_id AND sg.Scope = 'ri' AND sg.isdeleted = 0
         JOIN member_master_profile m ON m.pk_member_master_profile_id = sm.fk_member_master_profile_id
         WHERE sm.fk_sub_group_id IN @SubgroupIds AND sm.isdeleted = 0 AND m.isdeleted = 0
           AND ${contactFilter}`,
        { SubgroupIds: subgroupIds },
      ));
    }
    let whereScope = "1=1";
    if (t === "zones") {
      if (!zoneIds || zoneIds.length === 0) return 0;
      whereScope = "d.fk_zone_id IN @ZoneIds";
    } else if (t === "districts") {
      if (!districtIds || districtIds.length === 0) return 0;
      whereScope = "c.fk_district_id IN @DistrictIds";
    }
    return num(await this.db.executeScalar(
      `SELECT COUNT(DISTINCT m.pk_member_master_profile_id)
       FROM member_master_profile m
       JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id
       LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
       WHERE cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0 AND c.isdeleted = 0
         AND ${contactFilter}
         AND ${whereScope}`,
      { ZoneIds: zoneIds ?? [], DistrictIds: districtIds ?? [] },
    ));
  }

  // ── Announcements ────────────────────────────────────────────────────────────────────────────
  async getAnnouncements(status: string, search: string, page: number, pageSize: number) {
    const statusCond = status ? `AND (${STATUS_CASE("a.PublishDateTime", "a.ExpiryDateTime")} = @Status)` : "";
    const searchCond = search ? "AND a.Title LIKE CONCAT('%', @Search, '%')" : "";
    const [items, count] = await this.db.queryMultiple(
      `SELECT a.pk_announcement_id AS Id, a.fk_club_id AS ClubId, a.Title, a.Description,
              CASE WHEN a.ImagePath IS NULL OR a.ImagePath = '' THEN NULL WHEN a.ImagePath LIKE '/%' THEN a.ImagePath ELSE CONCAT('/Documents/announcement/ri/', a.ImagePath) END AS ImagePath,
              a.PublishDateTime, a.ExpiryDateTime,
              a.IsDisplayOnBanner, a.IsSendWhatsapp, a.IsSendEmail, a.IsRepeatNotification,
              a.WhatsAppSentDate, a.WhatsAppSentCount, a.WhatsAppFailedCount,
              a.EmailSentDate, a.EmailSentCount, a.EmailFailedCount,
              ${STATUS_CASE("a.PublishDateTime", "a.ExpiryDateTime")} AS Status,
              (SELECT COUNT(*) FROM announcement_reminders r WHERE r.fk_announcement_id = a.pk_announcement_id) AS ReminderCount
       FROM announcements a
       WHERE a.Scope = 'ri' AND a.isdeleted = 0
       ${statusCond} ${searchCond}
       ORDER BY a.PublishDateTime DESC
       LIMIT @PageSize OFFSET @Offset;
       SELECT COUNT(*) AS N FROM announcements a WHERE a.Scope = 'ri' AND a.isdeleted = 0 ${statusCond} ${searchCond};`,
      { Status: status ?? "", Search: search ?? "", PageSize: pageSize, Offset: (page - 1) * pageSize },
    );
    return { items: AnnouncementListDto.mapAll(items), totalCount: num(count[0]?.N) };
  }

  async getAnnouncementById(id: number) {
    const row = await this.db.queryFirstOrDefault(
      `SELECT pk_announcement_id AS Id, fk_club_id AS ClubId, Title, Description,
              CASE WHEN ImagePath IS NULL OR ImagePath = '' THEN NULL WHEN ImagePath LIKE '/%' THEN ImagePath ELSE CONCAT('/Documents/announcement/ri/', ImagePath) END AS ImagePath,
              PublishDateTime, ExpiryDateTime,
              IsDisplayOnBanner, IsSendWhatsapp, IsSendEmail, IsRepeatNotification,
              RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds,
              ${STATUS_CASE("PublishDateTime", "ExpiryDateTime")} AS Status
       FROM announcements
       WHERE pk_announcement_id = @Id AND Scope = 'ri' AND isdeleted = 0`,
      { Id: id },
    );
    const detail = AnnouncementDetailDto.map(row);
    if (!detail) return null;
    detail.reminders = AnnouncementReminderDto.mapAll(await this.db.query(
      "SELECT pk_reminder_id AS Id, ReminderDateTime FROM announcement_reminders WHERE fk_announcement_id = @Id ORDER BY ReminderDateTime", { Id: id }));
    return detail;
  }

  private announcementParams(b: unknown) {
    return {
      Title: s(b, "title") ?? "", Description: s(b, "description"), ImagePath: s(b, "imagePath"), PublishDateTime: dt(b, "publishDateTime"), ExpiryDateTime: dt(b, "expiryDateTime"),
      IsDisplayOnBanner: yes(b, "isDisplayOnBanner") ? 1 : 0, IsSendWhatsapp: yes(b, "isSendWhatsapp") ? 1 : 0, IsSendEmail: yes(b, "isSendEmail") ? 1 : 0,
      IsRepeatNotification: yes(b, "isRepeatNotification") ? 1 : 0, ...scopeParams(scopeOf(b)),
    };
  }

  async createAnnouncement(body: unknown, createdBy: number): Promise<number> {
    const scope = scopeOf(body);
    const reminders = reminderList(f(body, "reminders"));
    if (yes(body, "isSendWhatsapp")) await this.requireCredits("WhatsApp", scope, reminders.length);
    if (yes(body, "isSendEmail")) await this.requireCredits("Email", scope, reminders.length);
    const id = await this.db.session(async (conn) => num(await conn.executeScalar(
      `INSERT INTO announcements (fk_club_id, fk_district_id, Scope, Title, Description, ImagePath,
           PublishDateTime, ExpiryDateTime, IsDisplayOnBanner, IsSendWhatsapp, IsSendEmail, IsRepeatNotification,
           RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds, created_by, created_date, isdeleted)
       VALUES (0, NULL, 'ri', @Title, @Description, @ImagePath,
           @PublishDateTime, @ExpiryDateTime, @IsDisplayOnBanner, @IsSendWhatsapp, @IsSendEmail, @IsRepeatNotification,
           @RecipientTarget, @RecipientZoneIds, @RecipientDistrictIds, @RecipientSubgroupIds, @CreatedBy, NOW(), 0);
       SELECT LAST_INSERT_ID();`,
      { ...this.announcementParams(body), CreatedBy: createdBy },
    )));
    for (const r of reminders)
      await this.db.execute("INSERT INTO announcement_reminders (fk_announcement_id, ReminderDateTime, created_by, created_date) VALUES (@Id, @Dt, @U, NOW())", { Id: id, Dt: r, U: createdBy });
    if (yes(body, "isSendWhatsapp")) {
      const count = await this.getRecipientCount("whatsapp", scope.recipientTarget ?? "all", scope.recipientZoneIds, scope.recipientDistrictIds, scope.recipientSubgroupIds);
      if (count > 0) await this.deductCreditWithHistory("WhatsApp", count, "RiAnnouncement", id, `WhatsApp notification for ${s(body, "title") ?? ""}`, createdBy);
    }
    return id;
  }

  async updateAnnouncement(id: number, body: unknown, modifiedBy: number) {
    const scope = scopeOf(body);
    const reminders = reminderList(f(body, "reminders"));
    const prior = await this.db.queryFirstOrDefault("SELECT IsSendWhatsapp FROM announcements WHERE pk_announcement_id = @Id AND Scope = 'ri' AND isdeleted = 0", { Id: id });
    const priorWhatsapp = !!prior && num(prior.IsSendWhatsapp) !== 0;
    if (yes(body, "isSendWhatsapp") && !priorWhatsapp) await this.requireCredits("WhatsApp", scope, reminders.length);
    if (yes(body, "isSendEmail")) await this.requireCredits("Email", scope, reminders.length);
    await this.db.execute(
      `UPDATE announcements
       SET Title = @Title, Description = @Description, ImagePath = @ImagePath,
           PublishDateTime = @PublishDateTime, ExpiryDateTime = @ExpiryDateTime,
           IsDisplayOnBanner = @IsDisplayOnBanner, IsSendWhatsapp = @IsSendWhatsapp, IsSendEmail = @IsSendEmail,
           IsRepeatNotification = @IsRepeatNotification,
           RecipientTarget = @RecipientTarget, RecipientZoneIds = @RecipientZoneIds,
           RecipientDistrictIds = @RecipientDistrictIds, RecipientSubgroupIds = @RecipientSubgroupIds,
           modified_by = @ModifiedBy, modified_date = NOW()
       WHERE pk_announcement_id = @Id AND Scope = 'ri'`,
      { ...this.announcementParams(body), Id: id, ModifiedBy: modifiedBy },
    );
    await this.db.execute("DELETE FROM announcement_reminders WHERE fk_announcement_id = @Id", { Id: id });
    for (const r of reminders)
      await this.db.execute("INSERT INTO announcement_reminders (fk_announcement_id, ReminderDateTime, created_by, created_date) VALUES (@Id, @Dt, @U, NOW())", { Id: id, Dt: r, U: modifiedBy });
    // Deduct only when WhatsApp is newly switched on (no refund when switched off). RIZones counts without the sub-groups here.
    if (yes(body, "isSendWhatsapp") && !priorWhatsapp) {
      const count = await this.getRecipientCount("whatsapp", scope.recipientTarget ?? "all", scope.recipientZoneIds, scope.recipientDistrictIds);
      if (count > 0) await this.deductCreditWithHistory("WhatsApp", count, "RiAnnouncement", id, `WhatsApp notification for ${s(body, "title") ?? ""}`, modifiedBy);
    }
  }

  /** Soft delete; WhatsApp credits come back when the scheduler had not sent yet. */
  private async deleteWithRefund(table: string, pk: string, id: number, deletedBy: number, source: string, softDelete: string) {
    const row = await this.db.queryFirstOrDefault(`SELECT IsSendWhatsapp, WhatsAppSentDate, Title FROM ${table} WHERE ${pk} = @Id AND Scope = 'ri' AND isdeleted = 0`, { Id: id });
    const shouldRefund = !!row && num(row.IsSendWhatsapp) !== 0 && (row.WhatsAppSentDate === null || row.WhatsAppSentDate === undefined);
    await this.db.execute(`UPDATE ${table} SET ${softDelete} WHERE ${pk} = @Id AND Scope = 'ri'`, { Id: id, U: deletedBy });
    if (shouldRefund) {
      const deducted = await this.getDeductedAmount("WhatsApp", source, id);
      if (deducted > 0) await this.refundCreditWithHistory("WhatsApp", deducted, source, id, `Deleted before publish: ${String(row!.Title ?? "")}`, deletedBy);
    }
  }

  deleteAnnouncement(id: number, deletedBy: number) {
    return this.deleteWithRefund("announcements", "pk_announcement_id", id, deletedBy, "RiAnnouncement", "isdeleted = 1, modified_by = @U, modified_date = NOW()");
  }

  uploadAnnouncementImage(file: UploadedFile) {
    return saveWithReadableName(this.config, file, "", "Documents", "announcement", "ri");
  }

  // ── Upcoming events ──────────────────────────────────────────────────────────────────────────
  async getUpcomingEvents(status: string, search: string, page: number, pageSize: number) {
    const statusCond = status ? `AND (${STATUS_CASE("e.PublishDate", "e.ExpiryDate")} = @Status)` : "";
    const searchCond = search ? "AND e.Title LIKE CONCAT('%', @Search, '%')" : "";
    const [items, count] = await this.db.queryMultiple(
      `SELECT e.pk_upcoming_event_id AS Id, e.fk_club_id AS ClubId, e.Title, e.Description,
              CASE WHEN e.ImagePath IS NULL OR e.ImagePath = '' THEN NULL WHEN e.ImagePath LIKE '/%' THEN e.ImagePath ELSE CONCAT('/Documents/Event/ri/', e.ImagePath) END AS ImagePath,
              e.EventDate, e.PublishDate, e.ExpiryDate,
              e.EventVenue, e.RegistrationLink, e.IsSendWhatsapp, e.IsSendEmail, e.IsRepeatNotification,
              e.WhatsAppSentDate, e.WhatsAppSentCount, e.WhatsAppFailedCount,
              e.EmailSentDate, e.EmailSentCount, e.EmailFailedCount,
              ${STATUS_CASE("e.PublishDate", "e.ExpiryDate")} AS Status,
              (SELECT COUNT(*) FROM upcoming_event_reminders r WHERE r.fk_upcoming_event_id = e.pk_upcoming_event_id AND r.IsActive = 1) AS ReminderCount
       FROM upcoming_events e
       WHERE e.Scope = 'ri' AND e.isdeleted = 0
       ${statusCond} ${searchCond}
       ORDER BY e.EventDate DESC
       LIMIT @PageSize OFFSET @Offset;
       SELECT COUNT(*) AS N FROM upcoming_events e WHERE e.Scope = 'ri' AND e.isdeleted = 0 ${statusCond} ${searchCond};`,
      { Status: status ?? "", Search: search ?? "", PageSize: pageSize, Offset: (page - 1) * pageSize },
    );
    return { items: UpcomingEventListDto.mapAll(items), totalCount: num(count[0]?.N) };
  }

  async getUpcomingEventById(id: number) {
    const detail = UpcomingEventDetailDto.map(await this.db.queryFirstOrDefault(
      `SELECT pk_upcoming_event_id AS Id, fk_club_id AS ClubId, Title, Description,
              CASE WHEN ImagePath IS NULL OR ImagePath = '' THEN NULL WHEN ImagePath LIKE '/%' THEN ImagePath ELSE CONCAT('/Documents/Event/ri/', ImagePath) END AS ImagePath,
              EventDate, PublishDate, ExpiryDate,
              EventVenue, RegistrationLink, IsSendWhatsapp, IsSendEmail, IsRepeatNotification,
              RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds,
              ${STATUS_CASE("PublishDate", "ExpiryDate")} AS Status
       FROM upcoming_events
       WHERE pk_upcoming_event_id = @Id AND Scope = 'ri' AND isdeleted = 0`,
      { Id: id },
    ));
    if (!detail) return null;
    detail.reminders = EventReminderDto.mapAll(await this.db.query(
      "SELECT pk_reminder_id AS Id, ReminderDateTime FROM upcoming_event_reminders WHERE fk_upcoming_event_id = @Id AND IsActive = 1 ORDER BY ReminderDateTime", { Id: id }));
    return detail;
  }

  private eventParams(b: unknown) {
    return {
      Title: s(b, "title") ?? "", Description: s(b, "description"), ImagePath: s(b, "imagePath"), EventDate: dt(b, "eventDate"), PublishDate: dt(b, "publishDate"),
      ExpiryDate: dt(b, "expiryDate"), EventVenue: s(b, "eventVenue"), RegistrationLink: s(b, "registrationLink"),
      IsSendWhatsapp: yes(b, "isSendWhatsapp") ? 1 : 0, IsSendEmail: yes(b, "isSendEmail") ? 1 : 0, IsRepeatNotification: yes(b, "isRepeatNotification") ? 1 : 0,
      ...scopeParams(scopeOf(b)),
    };
  }

  async createUpcomingEvent(body: unknown, createdBy: number): Promise<number> {
    const scope = scopeOf(body);
    const reminders = reminderList(f(body, "reminders"));
    if (yes(body, "isSendWhatsapp")) await this.requireCredits("WhatsApp", scope, reminders.length);
    if (yes(body, "isSendEmail")) await this.requireCredits("Email", scope, reminders.length);
    const id = await this.db.session(async (conn) => num(await conn.executeScalar(
      `INSERT INTO upcoming_events (fk_club_id, fk_district_id, Scope, Title, Description, ImagePath,
           EventDate, PublishDate, ExpiryDate, EventVenue, RegistrationLink,
           IsSendWhatsapp, IsSendEmail, IsRepeatNotification, Status,
           RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds, created_by, created_date, isdeleted)
       VALUES (0, NULL, 'ri', @Title, @Description, @ImagePath,
           @EventDate, @PublishDate, @ExpiryDate, @EventVenue, @RegistrationLink,
           @IsSendWhatsapp, @IsSendEmail, @IsRepeatNotification, 'Unpublished',
           @RecipientTarget, @RecipientZoneIds, @RecipientDistrictIds, @RecipientSubgroupIds, @CreatedBy, NOW(), 0);
       SELECT LAST_INSERT_ID();`,
      { ...this.eventParams(body), CreatedBy: createdBy },
    )));
    for (const r of reminders)
      await this.db.execute("INSERT INTO upcoming_event_reminders (fk_upcoming_event_id, ReminderDateTime, IsActive, created_by, created_date) VALUES (@Id, @Dt, 1, @U, NOW())", { Id: id, Dt: r, U: createdBy });
    if (yes(body, "isSendWhatsapp")) {
      const count = await this.getRecipientCount("whatsapp", scope.recipientTarget ?? "all", scope.recipientZoneIds, scope.recipientDistrictIds, scope.recipientSubgroupIds);
      if (count > 0) await this.deductCreditWithHistory("WhatsApp", count, "RiUpcomingEvent", id, `Event WhatsApp: ${s(body, "title") ?? ""}`, createdBy);
    }
    return id;
  }

  async updateUpcomingEvent(id: number, body: unknown, modifiedBy: number) {
    const scope = scopeOf(body);
    const reminders = reminderList(f(body, "reminders"));
    const prior = await this.db.queryFirstOrDefault("SELECT IsSendWhatsapp, IsSendEmail FROM upcoming_events WHERE pk_upcoming_event_id = @Id AND Scope = 'ri' AND isdeleted = 0", { Id: id });
    const priorWhatsapp = !!prior && num(prior.IsSendWhatsapp) !== 0;
    const priorEmail = !!prior && num(prior.IsSendEmail) !== 0;
    if (yes(body, "isSendWhatsapp") && !priorWhatsapp) await this.requireCredits("WhatsApp", scope, reminders.length);
    if (yes(body, "isSendEmail") && !priorEmail) await this.requireCredits("Email", scope, reminders.length);
    await this.db.execute(
      `UPDATE upcoming_events
       SET Title = @Title, Description = @Description, ImagePath = @ImagePath,
           EventDate = @EventDate, PublishDate = @PublishDate, ExpiryDate = @ExpiryDate,
           EventVenue = @EventVenue, RegistrationLink = @RegistrationLink,
           IsSendWhatsapp = @IsSendWhatsapp, IsSendEmail = @IsSendEmail, IsRepeatNotification = @IsRepeatNotification,
           RecipientTarget = @RecipientTarget, RecipientZoneIds = @RecipientZoneIds,
           RecipientDistrictIds = @RecipientDistrictIds, RecipientSubgroupIds = @RecipientSubgroupIds,
           modified_by = @ModifiedBy, modified_date = NOW()
       WHERE pk_upcoming_event_id = @Id AND Scope = 'ri'`,
      { ...this.eventParams(body), Id: id, ModifiedBy: modifiedBy },
    );
    await this.db.execute("DELETE FROM upcoming_event_reminders WHERE fk_upcoming_event_id = @Id", { Id: id });
    for (const r of reminders)
      await this.db.execute("INSERT INTO upcoming_event_reminders (fk_upcoming_event_id, ReminderDateTime, IsActive, created_by, created_date) VALUES (@Id, @Dt, 1, @U, NOW())", { Id: id, Dt: r, U: modifiedBy });
    if (yes(body, "isSendWhatsapp") && !priorWhatsapp) {
      const count = await this.getRecipientCount("whatsapp", scope.recipientTarget ?? "all", scope.recipientZoneIds, scope.recipientDistrictIds, scope.recipientSubgroupIds);
      if (count > 0) await this.deductCreditWithHistory("WhatsApp", count, "RiUpcomingEvent", id, `Event WhatsApp: ${s(body, "title") ?? ""}`, modifiedBy);
    }
  }

  deleteUpcomingEvent(id: number, deletedBy: number) {
    return this.deleteWithRefund("upcoming_events", "pk_upcoming_event_id", id, deletedBy, "RiUpcomingEvent", "isdeleted = 1, deleted_by = @U, deleted_date = NOW()");
  }

  uploadUpcomingEventImage(file: UploadedFile) {
    return saveWithReadableName(this.config, file, "", "Documents", "Event", "ri");
  }

  // ── Sub groups ───────────────────────────────────────────────────────────────────────────────
  async getSubGroups(yearId: number | null) {
    const yearFilter = yearId !== null ? " AND sg.fk_year_id = @YearId " : "";
    return RiSubGroupListDto.mapAll(await this.db.query(
      `SELECT sg.pk_sub_group_id AS Id, sg.fk_year_id AS YearId, ry.YearLabel, sg.GroupName,
              (SELECT COUNT(*) FROM sub_group_members sm WHERE sm.fk_sub_group_id = sg.pk_sub_group_id AND sm.isdeleted = 0) AS MemberCount,
              sg.created_date AS CreatedDate
       FROM sub_groups sg
       LEFT JOIN rotary_year_master ry ON ry.pk_year_id = sg.fk_year_id
       WHERE sg.Scope = 'ri' AND sg.isdeleted = 0 ${yearFilter}
       ORDER BY sg.fk_year_id DESC, sg.GroupName`,
      { YearId: yearId },
    ));
  }

  async getSubGroupYears() {
    return RiSubGroupYearDto.mapAll(await this.db.query(
      `SELECT ry.pk_year_id AS Id, ry.YearLabel,
              CASE WHEN CURDATE() BETWEEN ry.StartDate AND ry.EndDate THEN 1 ELSE 0 END AS IsCurrent,
              COUNT(sg.pk_sub_group_id) AS GroupCount
       FROM rotary_year_master ry
       JOIN sub_groups sg ON sg.fk_year_id = ry.pk_year_id AND sg.Scope = 'ri' AND sg.isdeleted = 0
       GROUP BY ry.pk_year_id, ry.YearLabel, ry.StartDate, ry.EndDate
       HAVING GroupCount > 0
       ORDER BY ry.StartDate DESC`,
    ));
  }

  async getSubGroupById(id: number) {
    const header = await this.db.queryFirstOrDefault(
      `SELECT sg.pk_sub_group_id, sg.fk_year_id, ry.YearLabel, sg.GroupName
       FROM sub_groups sg LEFT JOIN rotary_year_master ry ON ry.pk_year_id = sg.fk_year_id
       WHERE sg.pk_sub_group_id = @Id AND sg.Scope = 'ri' AND sg.isdeleted = 0`,
      { Id: id },
    );
    if (!header) return null;
    const members = await this.db.query(
      `SELECT m.pk_member_master_profile_id AS MemberId, m.MemberName,
              m.EmailId AS Email, m.PrimaryMobileNumber AS MobileNumber,
              ${PHOTO} AS ProfilePhotoPath,
              c.ClubName, d.DistrictNumber
       FROM sub_group_members sm
       JOIN member_master_profile m ON m.pk_member_master_profile_id = sm.fk_member_master_profile_id
       LEFT JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
       LEFT JOIN club_master c ON c.pk_club_id = cm.fk_club_id
       LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
       WHERE sm.fk_sub_group_id = @Id AND sm.isdeleted = 0 AND m.isdeleted = 0
       GROUP BY m.pk_member_master_profile_id, m.MemberName, m.EmailId, m.PrimaryMobileNumber, m.ProfilePhotoPath, c.ClubName, d.DistrictNumber
       ORDER BY m.MemberName`,
      { Id: id },
    );
    return RiSubGroupDetailDto.create({ Id: header.pk_sub_group_id, YearId: header.fk_year_id, YearLabel: header.YearLabel, GroupName: header.GroupName, Members: RiSubGroupMemberDto.mapAll(members) });
  }

  private subGroupBody(b: unknown) {
    const ids = ints(b, "memberIds") ?? [];
    return { yearId: n(b, "yearId"), groupName: s(b, "groupName") ?? "", memberIds: [...new Set(ids)] };
  }

  async createSubGroup(body: unknown, createdBy: number): Promise<number> {
    const dto = this.subGroupBody(body);
    if (!dto.groupName.trim()) throw new InvalidOperationException("Group name is required.");
    if (dto.yearId <= 0) throw new InvalidOperationException("Year is required.");
    const name = dto.groupName.trim();
    const exists = num(await this.db.executeScalar("SELECT COUNT(*) FROM sub_groups WHERE Scope = 'ri' AND isdeleted = 0 AND fk_year_id = @YearId AND GroupName = @Name", { YearId: dto.yearId, Name: name }));
    if (exists > 0) throw new InvalidOperationException("A sub group with this name already exists for this year.");
    return this.db.session(async (conn) => {
      const id = num(await conn.executeScalar(
        `INSERT INTO sub_groups (fk_club_id, fk_district_id, fk_year_id, Scope, GroupName, created_by, created_date, isdeleted)
         VALUES (0, NULL, @YearId, 'ri', @Name, @U, NOW(), 0);
         SELECT LAST_INSERT_ID();`,
        { YearId: dto.yearId, Name: name, U: createdBy },
      ));
      for (const memberId of dto.memberIds)
        await conn.execute("INSERT INTO sub_group_members (fk_sub_group_id, fk_member_master_profile_id, created_by, created_date, isdeleted) VALUES (@Gid, @Mid, @U, NOW(), 0)", { Gid: id, Mid: memberId, U: createdBy });
      return id;
    });
  }

  async updateSubGroup(id: number, body: unknown, modifiedBy: number) {
    const dto = this.subGroupBody(body);
    if (!dto.groupName.trim()) throw new InvalidOperationException("Group name is required.");
    if (dto.yearId <= 0) throw new InvalidOperationException("Year is required.");
    const name = dto.groupName.trim();
    const exists = num(await this.db.executeScalar(
      "SELECT COUNT(*) FROM sub_groups WHERE Scope = 'ri' AND isdeleted = 0 AND fk_year_id = @YearId AND GroupName = @Name AND pk_sub_group_id <> @Id", { YearId: dto.yearId, Name: name, Id: id }));
    if (exists > 0) throw new InvalidOperationException("A sub group with this name already exists for this year.");
    await this.db.execute("UPDATE sub_groups SET fk_year_id = @YearId, GroupName = @Name, modified_by = @U, modified_date = NOW() WHERE pk_sub_group_id = @Id AND Scope = 'ri'", { YearId: dto.yearId, Name: name, Id: id, U: modifiedBy });
    const existing = (await this.db.query("SELECT fk_member_master_profile_id AS Id FROM sub_group_members WHERE fk_sub_group_id = @Id AND isdeleted = 0", { Id: id })).map((r) => num(r.Id));
    const toRemove = [...new Set(existing.filter((x) => !dto.memberIds.includes(x)))];
    const toAdd = dto.memberIds.filter((x) => !existing.includes(x));
    if (toRemove.length > 0) await this.db.execute("UPDATE sub_group_members SET isdeleted = 1 WHERE fk_sub_group_id = @Id AND fk_member_master_profile_id IN @Mids", { Id: id, Mids: toRemove });
    for (const m of toAdd)
      await this.db.execute("INSERT INTO sub_group_members (fk_sub_group_id, fk_member_master_profile_id, created_by, created_date, isdeleted) VALUES (@Gid, @Mid, @U, NOW(), 0)", { Gid: id, Mid: m, U: modifiedBy });
  }

  async deleteSubGroup(id: number, deletedBy: number) {
    await this.db.execute("UPDATE sub_groups SET isdeleted = 1, deleted_by = @U, deleted_date = NOW() WHERE pk_sub_group_id = @Id AND Scope = 'ri'", { Id: id, U: deletedBy });
  }

  async getAvailableMembers(search: string | null) {
    const where = !search || !search.trim()
      ? ""
      : "AND (m.MemberName LIKE CONCAT('%', @Search, '%') OR m.EmailId LIKE CONCAT('%', @Search, '%') OR m.PrimaryMobileNumber LIKE CONCAT('%', @Search, '%') OR m.RotaryId LIKE CONCAT('%', @Search, '%'))";
    return RiAvailableMemberDto.mapAll(await this.db.query(
      `SELECT m.pk_member_master_profile_id AS Id, m.MemberName,
              m.EmailId AS Email, m.PrimaryMobileNumber AS MobileNumber,
              ${PHOTO} AS ProfilePhotoPath,
              c.ClubName, d.DistrictNumber, d.fk_zone_id AS ZoneId, z.ZoneName
       FROM member_master_profile m
       JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
       LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
       LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE m.isdeleted = 0 ${where}
       GROUP BY m.pk_member_master_profile_id, m.MemberName, m.EmailId, m.PrimaryMobileNumber, m.ProfilePhotoPath, c.ClubName, d.DistrictNumber, d.fk_zone_id, z.ZoneName
       ORDER BY m.MemberName
       LIMIT 500`,
      { Search: search },
    ));
  }

  // ── Mass emails ──────────────────────────────────────────────────────────────────────────────
  async getMassEmails(status: string, search: string, page: number, pageSize: number) {
    const statusCond = status ? "AND Status = @Status" : "";
    const searchCond = search ? "AND (Subject LIKE CONCAT('%', @Search, '%') OR FromName LIKE CONCAT('%', @Search, '%'))" : "";
    const [items, count] = await this.db.queryMultiple(
      `SELECT pk_mass_email_id AS Id, Subject, Status, RecipientType, TotalRecipients, SentCount, FailedCount, SentDate, created_date AS CreatedDate
       FROM club_mass_emails
       WHERE Scope = 'ri' AND isdeleted = 0 ${statusCond} ${searchCond}
       ORDER BY pk_mass_email_id DESC
       LIMIT @PageSize OFFSET @Offset;
       SELECT COUNT(*) AS N FROM club_mass_emails WHERE Scope = 'ri' AND isdeleted = 0 ${statusCond} ${searchCond};`,
      { Status: status ?? "", Search: search ?? "", PageSize: pageSize, Offset: (page - 1) * pageSize },
    );
    return { items: MassEmailListDto.mapAll(items), totalCount: num(count[0]?.N) };
  }

  async getMassEmailById(id: number) {
    const detail = await this.db.queryFirstOrDefault(
      `SELECT me.pk_mass_email_id AS Id, me.RecipientType,
              me.RecipientTarget, me.RecipientZoneIds, me.RecipientDistrictIds, me.RecipientSubgroupIds,
              me.fk_subgroup_id AS FkSubgroupId, sg.GroupName AS SubgroupName,
              me.FromName, me.ReplyName, me.ReplyEmail, me.Subject, me.EmailBody,
              me.Status, me.TotalRecipients, me.SentCount, me.FailedCount,
              me.SentDate, me.created_date AS CreatedDate
       FROM club_mass_emails me
       LEFT JOIN sub_groups sg ON sg.pk_sub_group_id = me.fk_subgroup_id
       WHERE me.pk_mass_email_id = @Id AND me.Scope = 'ri' AND me.isdeleted = 0`,
      { Id: id },
    );
    if (!detail) return null;
    const recipients = await this.db.query(
      "SELECT fk_member_id AS MemberId, MemberName, Email, Status, SentDate, ErrorMessage FROM club_mass_email_recipients WHERE fk_mass_email_id = @Id AND isdeleted = 0 ORDER BY MemberName", { Id: id });
    return RiMassEmailDetailDto.create({ ...detail, Recipients: MassEmailRecipientDto.mapAll(recipients) });
  }

  private massEmailBody(b: unknown) {
    return {
      recipientType: n(b, "recipientType", 1), zoneIds: ints(b, "zoneIds"), districtIds: ints(b, "districtIds"), subgroupIds: ints(b, "subgroupIds"),
      fromName: s(b, "fromName") ?? "", replyName: s(b, "replyName"), replyEmail: s(b, "replyEmail"), subject: s(b, "subject") ?? "", emailBody: s(b, "emailBody"),
    };
  }
  private static target = (t: number) => (t === 2 ? "zones" : t === 3 ? "districts" : t === 4 ? "subgroups" : "all");

  private massEmailParams(dto: ReturnType<RiDirectorService["massEmailBody"]>) {
    return {
      RecipientType: dto.recipientType, FkSubgroupId: dto.subgroupIds && dto.subgroupIds.length ? dto.subgroupIds[0] : null, Target: RiDirectorService.target(dto.recipientType),
      ZoneIds: csv(dto.zoneIds), DistrictIds: csv(dto.districtIds), SubgroupIds: csv(dto.subgroupIds),
      FromName: dto.fromName, ReplyName: dto.replyName, ReplyEmail: dto.replyEmail, Subject: dto.subject, EmailBody: dto.emailBody,
    };
  }

  async createMassEmail(body: unknown, createdBy: number): Promise<number> {
    const dto = this.massEmailBody(body);
    if (!dto.subject.trim()) throw new InvalidOperationException("Subject is required.");
    if (!dto.fromName.trim()) throw new InvalidOperationException("From Name is required.");
    if (dto.recipientType === 5) throw new InvalidOperationException("Manual Members recipient type is not supported.");
    return this.db.session(async (conn) => {
      const id = num(await conn.executeScalar(
        `INSERT INTO club_mass_emails
            (fk_club_id, fk_district_id, Scope, RecipientType, fk_subgroup_id,
             RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds,
             FromName, ReplyName, ReplyEmail, Subject, EmailBody, Status, created_by, created_date, isdeleted)
         VALUES (0, NULL, 'ri', @RecipientType, @FkSubgroupId,
             @Target, @ZoneIds, @DistrictIds, @SubgroupIds,
             @FromName, @ReplyName, @ReplyEmail, @Subject, @EmailBody, 'Draft', @U, NOW(), 0);
         SELECT LAST_INSERT_ID();`,
        { ...this.massEmailParams(dto), U: createdBy },
      ));
      await RiDirectorService.populateMassEmailRecipients(conn, id, dto);
      await RiDirectorService.refreshTotal(conn, id);
      return id;
    });
  }

  async updateMassEmail(id: number, body: unknown, modifiedBy: number) {
    const dto = this.massEmailBody(body);
    await this.db.session(async (conn) => {
      const status = await conn.executeScalar("SELECT Status FROM club_mass_emails WHERE pk_mass_email_id = @Id AND Scope = 'ri' AND isdeleted = 0", { Id: id });
      if (status !== "Draft") throw new InvalidOperationException("Only draft emails can be edited.");
      if (dto.recipientType === 5) throw new InvalidOperationException("Manual Members recipient type is not supported.");
      await conn.execute(
        `UPDATE club_mass_emails
         SET RecipientType = @RecipientType, fk_subgroup_id = @FkSubgroupId,
             RecipientTarget = @Target, RecipientZoneIds = @ZoneIds, RecipientDistrictIds = @DistrictIds, RecipientSubgroupIds = @SubgroupIds,
             FromName = @FromName, ReplyName = @ReplyName, ReplyEmail = @ReplyEmail, Subject = @Subject, EmailBody = @EmailBody,
             modified_by = @U, modified_date = NOW()
         WHERE pk_mass_email_id = @Id AND Scope = 'ri'`,
        { ...this.massEmailParams(dto), Id: id, U: modifiedBy },
      );
      await conn.execute("UPDATE club_mass_email_recipients SET isdeleted = 1 WHERE fk_mass_email_id = @Id", { Id: id });
      await RiDirectorService.populateMassEmailRecipients(conn, id, dto);
      await RiDirectorService.refreshTotal(conn, id);
    });
  }

  private static async refreshTotal(conn: DbCommands, id: number) {
    const total = num(await conn.executeScalar("SELECT COUNT(*) FROM club_mass_email_recipients WHERE fk_mass_email_id = @Id AND isdeleted = 0", { Id: id }));
    await conn.execute("UPDATE club_mass_emails SET TotalRecipients = @T WHERE pk_mass_email_id = @Id", { T: total, Id: id });
  }

  async deleteMassEmail(id: number, deletedBy: number) {
    // Refund only a never-sent draft; any send attempt consumed the credits.
    const row = await this.db.queryFirstOrDefault("SELECT Status, Subject FROM club_mass_emails WHERE pk_mass_email_id = @Id AND Scope = 'ri' AND isdeleted = 0", { Id: id });
    const shouldRefund = !!row && row.Status === "Draft";
    await this.db.execute("UPDATE club_mass_emails SET isdeleted = 1, modified_by = @U, modified_date = NOW() WHERE pk_mass_email_id = @Id AND Scope = 'ri'", { Id: id, U: deletedBy });
    if (shouldRefund) {
      const deducted = await this.getDeductedAmount("Email", "RiMassEmail", id);
      if (deducted > 0) await this.refundCreditWithHistory("Email", deducted, "RiMassEmail", id, `Deleted draft: ${String(row!.Subject ?? "")}`, deletedBy);
    }
  }

  /** Starts the send and returns; recipients are mailed in the background, 10 at a time. */
  async sendMassEmail(id: number, userId: number) {
    const email = await this.db.queryFirstOrDefault(
      "SELECT pk_mass_email_id, Subject, EmailBody, Status, FromName, ReplyName, ReplyEmail FROM club_mass_emails WHERE pk_mass_email_id = @Id AND Scope = 'ri' AND isdeleted = 0", { Id: id });
    if (!email) throw new InvalidOperationException("Mass email not found.");
    // Draft (first send), Failed / Partial (retry), Sending (stuck after a restart).
    const currentStatus = String(email.Status ?? "");
    if (!["Draft", "Failed", "Partial", "Sending"].includes(currentStatus)) throw new InvalidOperationException("This email is already sent or cannot be resent.");
    const recipients = await this.db.query(
      `SELECT pk_id AS Id, Email, MemberName FROM club_mass_email_recipients
       WHERE fk_mass_email_id = @Id AND isdeleted = 0 AND (Status = 'Pending' OR Status = 'Failed') AND Email IS NOT NULL AND Email <> ''`,
      { Id: id },
    );
    if (recipients.length === 0) throw new InvalidOperationException("No pending recipients to send.");
    // Credits are taken on the first send only; a resume already paid.
    if (currentStatus === "Draft") {
      if (!(await this.hasSufficientCredits("Email", recipients.length))) throw new InvalidOperationException(`Insufficient Email credits. Need ${recipients.length} credit(s).`);
      await this.deductCreditWithHistory("Email", recipients.length, "RiMassEmail", id, `Mass Email: ${String(email.Subject ?? "")}`, userId);
    }
    await this.db.execute("UPDATE club_mass_emails SET Status = 'Sending' WHERE pk_mass_email_id = @Id", { Id: id });
    const subject = String(email.Subject ?? "");
    const body = String(email.EmailBody ?? "");
    void (async () => {
      let sent = 0, failed = 0;
      try {
        await mapLimit(recipients, 10, async (r) => {
          try {
            await this.email.sendGenericEmail(String(r.Email), subject, body);
            await this.db.execute("UPDATE club_mass_email_recipients SET Status = 'Sent', SentDate = NOW(), ErrorMessage = NULL WHERE pk_id = @Id", { Id: num(r.Id) });
            sent++;
          } catch (e) {
            const msg = (e as Error).message;
            await this.db.execute("UPDATE club_mass_email_recipients SET Status = 'Failed', ErrorMessage = @E WHERE pk_id = @Id", { E: msg.length > 500 ? msg.slice(0, 500) : msg, Id: num(r.Id) }).catch(() => undefined);
            failed++;
          }
        });
        await this.db.execute(
          "UPDATE club_mass_emails SET Status = @Status, SentCount = @Sent, FailedCount = @Failed, SentDate = NOW() WHERE pk_mass_email_id = @Id",
          { Id: id, Sent: sent, Failed: failed, Status: failed === 0 ? "Sent" : sent === 0 ? "Failed" : "Partial" },
        );
      } catch (e) {
        this.log.error(`RI mass email send failed for ${id}: ${(e as Error).message}`);
      }
    })();
  }

  private static async populateMassEmailRecipients(conn: DbCommands, massEmailId: number, dto: { recipientType: number; zoneIds: number[] | null; districtIds: number[] | null; subgroupIds: number[] | null }) {
    let whereScope = "1=1";
    const prm: Record<string, unknown> = { MassId: massEmailId };
    switch (dto.recipientType) {
      case 2:
        if (!dto.zoneIds || dto.zoneIds.length === 0) return;
        whereScope = "d.fk_zone_id IN @ZoneIds";
        prm.ZoneIds = dto.zoneIds;
        break;
      case 3:
        if (!dto.districtIds || dto.districtIds.length === 0) return;
        whereScope = "c.fk_district_id IN @DistrictIds";
        prm.DistrictIds = dto.districtIds;
        break;
      case 4: {
        if (!dto.subgroupIds || dto.subgroupIds.length === 0) return;
        const ids = (await conn.query(
          `SELECT DISTINCT sm.fk_member_master_profile_id AS Id FROM sub_group_members sm
           JOIN sub_groups sg ON sg.pk_sub_group_id = sm.fk_sub_group_id
           WHERE sm.fk_sub_group_id IN @Ids AND sm.isdeleted = 0 AND sg.Scope = 'ri'`,
          { Ids: dto.subgroupIds },
        )).map((r) => num(r.Id));
        if (ids.length === 0) return;
        whereScope = "m.pk_member_master_profile_id IN @MemberIds";
        prm.MemberIds = ids;
        break;
      }
    }
    await conn.execute(
      `INSERT INTO club_mass_email_recipients (fk_mass_email_id, fk_member_id, MemberName, Email, Status, isdeleted)
       SELECT @MassId, m.pk_member_master_profile_id, m.MemberName, m.EmailId, 'Pending', 0
       FROM member_master_profile m
       JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
       LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
       WHERE m.isdeleted = 0 AND m.EmailId IS NOT NULL AND m.EmailId <> ''
         AND ${whereScope}
       GROUP BY m.pk_member_master_profile_id, m.MemberName, m.EmailId`,
      prm,
    );
  }

  // ── Web links ────────────────────────────────────────────────────────────────────────────────
  private static readonly WEBLINK_COLS = "pk_weblink_id AS Id, Title, Writeup, LinkType, LinkUrl, YoutubeUrl, ButtonText, SortOrder, IsActive, created_date AS CreatedDate";
  async getWeblinks() {
    return RiWeblinkListDto.mapAll(await this.db.query(`SELECT ${RiDirectorService.WEBLINK_COLS} FROM weblinks WHERE Scope = 'ri' AND isdeleted = 0 ORDER BY SortOrder ASC, pk_weblink_id DESC`));
  }
  async getWeblinkById(id: number) {
    return RiWeblinkListDto.map(await this.db.queryFirstOrDefault(`SELECT ${RiDirectorService.WEBLINK_COLS} FROM weblinks WHERE pk_weblink_id = @Id AND Scope = 'ri' AND isdeleted = 0`, { Id: id }));
  }
  private weblinkParams(b: unknown) {
    const p = {
      Title: s(b, "title") ?? "", Writeup: s(b, "writeup"), LinkType: s(b, "linkType") ?? "url", LinkUrl: s(b, "linkUrl"), YoutubeUrl: s(b, "youtubeUrl"),
      ButtonText: s(b, "buttonText"), SortOrder: n(b, "sortOrder"), IsActive: yes(b, "isActive", true) ? 1 : 0,
    };
    if (!p.Title.trim()) throw new InvalidOperationException("Title is required.");
    validateWeblinkUrls(p.LinkType, p.LinkUrl, p.YoutubeUrl);
    return p;
  }
  async createWeblink(body: unknown, createdBy: number): Promise<number> {
    const p = this.weblinkParams(body);
    return this.db.session(async (conn) => num(await conn.executeScalar(
      `INSERT INTO weblinks (fk_club_id, fk_district_id, fk_parent_id, Level, Scope, Title, Writeup, LinkType, LinkUrl, YoutubeUrl, ButtonText, SortOrder, IsActive, created_by, created_date, isdeleted)
       VALUES (0, NULL, NULL, 1, 'ri', @Title, @Writeup, @LinkType, @LinkUrl, @YoutubeUrl, @ButtonText, @SortOrder, @IsActive, @U, NOW(), 0);
       SELECT LAST_INSERT_ID();`,
      { ...p, U: createdBy },
    )));
  }
  async updateWeblink(id: number, body: unknown, modifiedBy: number) {
    const p = this.weblinkParams(body);
    await this.db.execute(
      `UPDATE weblinks SET Title = @Title, Writeup = @Writeup, LinkType = @LinkType, LinkUrl = @LinkUrl, YoutubeUrl = @YoutubeUrl, ButtonText = @ButtonText,
           SortOrder = @SortOrder, IsActive = @IsActive, modified_by = @U, modified_date = NOW()
       WHERE pk_weblink_id = @Id AND Scope = 'ri'`,
      { ...p, Id: id, U: modifiedBy },
    );
  }
  async deleteWeblink(id: number, deletedBy: number) {
    await this.db.execute("UPDATE weblinks SET isdeleted = 1, deleted_by = @U, deleted_date = NOW() WHERE pk_weblink_id = @Id AND Scope = 'ri'", { Id: id, U: deletedBy });
  }

  // ── Documents ────────────────────────────────────────────────────────────────────────────────
  private static readonly DOC_COLS = `pk_document_id AS Id, fk_club_id AS ClubId, fk_year_id AS YearId, Title, AccessType,
              CASE
                  WHEN FilePath IS NULL OR FilePath = '' THEN NULL
                  WHEN FilePath LIKE '/%' THEN FilePath
                  WHEN Scope = 'ri' THEN CONCAT('/Documents/documentsafe/ri/', FilePath)
                  WHEN fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', fk_district_id, '/', FilePath)
                  ELSE CONCAT('/Documents/documentsafe/Group', fk_club_id, '/', FilePath)
              END AS FilePath,
              OriginalFileName, PublishDateTime, ExpiryDateTime,
              ${STATUS_CASE("PublishDateTime", "ExpiryDateTime")} AS Status`;
  async getDocuments(status: string, search: string, page: number, pageSize: number) {
    const statusCond = status ? `AND (${STATUS_CASE("PublishDateTime", "ExpiryDateTime")} = @Status)` : "";
    const searchCond = search ? "AND Title LIKE CONCAT('%', @Search, '%')" : "";
    const [items, count] = await this.db.queryMultiple(
      `SELECT ${RiDirectorService.DOC_COLS}
       FROM club_documents WHERE Scope = 'ri' AND isdeleted = 0 ${statusCond} ${searchCond}
       ORDER BY PublishDateTime DESC LIMIT @PageSize OFFSET @Offset;
       SELECT COUNT(*) AS N FROM club_documents WHERE Scope = 'ri' AND isdeleted = 0 ${statusCond} ${searchCond};`,
      { Status: status ?? "", Search: search ?? "", PageSize: pageSize, Offset: (page - 1) * pageSize },
    );
    return { items: DocumentDto.mapAll(items), totalCount: num(count[0]?.N) };
  }
  async getDocumentById(id: number) {
    return DocumentDto.map(await this.db.queryFirstOrDefault(`SELECT ${RiDirectorService.DOC_COLS} FROM club_documents WHERE pk_document_id = @Id AND Scope = 'ri' AND isdeleted = 0`, { Id: id }));
  }
  private documentParams(b: unknown) {
    return { Title: s(b, "title") ?? "", AccessType: s(b, "accessType") ?? "downloadable", FilePath: s(b, "filePath") ?? "", OriginalFileName: s(b, "originalFileName"), PublishDateTime: dt(b, "publishDateTime"), ExpiryDateTime: dt(b, "expiryDateTime") };
  }
  async createDocument(body: unknown, createdBy: number): Promise<number> {
    return this.db.session(async (conn) => num(await conn.executeScalar(
      `INSERT INTO club_documents (fk_club_id, fk_district_id, Scope, Title, AccessType, FilePath, OriginalFileName, PublishDateTime, ExpiryDateTime, Status, created_by, created_date, isdeleted)
       VALUES (0, NULL, 'ri', @Title, @AccessType, @FilePath, @OriginalFileName, @PublishDateTime, @ExpiryDateTime, 'Unpublished', @U, NOW(), 0);
       SELECT LAST_INSERT_ID();`,
      { ...this.documentParams(body), U: createdBy },
    )));
  }
  async updateDocument(id: number, body: unknown, modifiedBy: number) {
    await this.db.execute(
      `UPDATE club_documents SET Title = @Title, AccessType = @AccessType, FilePath = @FilePath, OriginalFileName = @OriginalFileName,
           PublishDateTime = @PublishDateTime, ExpiryDateTime = @ExpiryDateTime, modified_by = @U, modified_date = NOW()
       WHERE pk_document_id = @Id AND Scope = 'ri'`,
      { ...this.documentParams(body), Id: id, U: modifiedBy },
    );
  }
  async deleteDocument(id: number, deletedBy: number) {
    await this.db.execute("UPDATE club_documents SET isdeleted = 1, deleted_by = @U, deleted_date = NOW() WHERE pk_document_id = @Id AND Scope = 'ri'", { Id: id, U: deletedBy });
  }
  async uploadDocumentFile(file: UploadedFile) {
    return { path: await saveWithReadableName(this.config, file, "", "Documents", "documentsafe", "ri"), originalName: file.originalname };
  }

  // ── Newsletters ──────────────────────────────────────────────────────────────────────────────
  private static readonly NEWSLETTER_FILE = "CASE WHEN FilePath IS NULL OR FilePath = '' THEN NULL WHEN FilePath LIKE '/%' THEN FilePath ELSE CONCAT('/Documents/ebulletin/ri/', FilePath) END AS FilePath";
  async getNewsletters(status: string, search: string, page: number, pageSize: number) {
    const statusCond = status ? `AND (${STATUS_CASE("PublishDateTime", "ExpiryDateTime")} = @Status)` : "";
    const searchCond = search ? "AND Title LIKE CONCAT('%', @Search, '%')" : "";
    const [items, count] = await this.db.queryMultiple(
      `SELECT pk_newsletter_id AS Id, fk_club_id AS ClubId, Title, PublishDateTime, ExpiryDateTime, AttachmentType, LinkUrl,
              ${RiDirectorService.NEWSLETTER_FILE}, IsSendWhatsapp, IsSendEmail,
              ${STATUS_CASE("PublishDateTime", "ExpiryDateTime")} AS Status
       FROM newsletters WHERE Scope = 'ri' AND isdeleted = 0 ${statusCond} ${searchCond}
       ORDER BY PublishDateTime DESC LIMIT @PageSize OFFSET @Offset;
       SELECT COUNT(*) AS N FROM newsletters WHERE Scope = 'ri' AND isdeleted = 0 ${statusCond} ${searchCond};`,
      { Status: status ?? "", Search: search ?? "", PageSize: pageSize, Offset: (page - 1) * pageSize },
    );
    return { items: NewsletterListDto.mapAll(items), totalCount: num(count[0]?.N) };
  }
  async getNewsletterById(id: number) {
    return NewsletterDetailDto.map(await this.db.queryFirstOrDefault(
      `SELECT pk_newsletter_id AS Id, fk_club_id AS ClubId, Title, PublishDateTime, ExpiryDateTime, AttachmentType, LinkUrl,
              ${RiDirectorService.NEWSLETTER_FILE}, IsSendWhatsapp, IsSendEmail,
              RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds,
              ${STATUS_CASE("PublishDateTime", "ExpiryDateTime")} AS Status
       FROM newsletters WHERE pk_newsletter_id = @Id AND Scope = 'ri' AND isdeleted = 0`,
      { Id: id },
    ));
  }
  private newsletterParams(b: unknown) {
    return {
      Title: s(b, "title") ?? "", PublishDateTime: dt(b, "publishDateTime"), ExpiryDateTime: dt(b, "expiryDateTime"), AttachmentType: s(b, "attachmentType") ?? "link",
      LinkUrl: s(b, "linkUrl"), FilePath: s(b, "filePath"), IsSendWhatsapp: yes(b, "isSendWhatsapp") ? 1 : 0, IsSendEmail: yes(b, "isSendEmail") ? 1 : 0, ...scopeParams(scopeOf(b)),
    };
  }
  private async newsletterWhatsappCount(b: unknown) {
    const x = scopeOf(b);
    return this.getRecipientCount("whatsapp", x.recipientTarget ?? "all", x.recipientZoneIds, x.recipientDistrictIds, x.recipientSubgroupIds);
  }
  async createNewsletter(body: unknown, createdBy: number): Promise<number> {
    if (yes(body, "isSendWhatsapp")) {
      const count = await this.newsletterWhatsappCount(body);
      if (count > 0 && !(await this.hasSufficientCredits("WhatsApp", count))) throw new InvalidOperationException(`Insufficient WhatsApp credits. Need ${count} credit(s).`);
    }
    const id = await this.db.session(async (conn) => num(await conn.executeScalar(
      `INSERT INTO newsletters (fk_club_id, fk_district_id, Scope, Title, PublishDateTime, ExpiryDateTime, AttachmentType, LinkUrl, FilePath,
           IsSendWhatsapp, IsSendEmail, Status, RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds, created_by, created_date, isdeleted)
       VALUES (0, NULL, 'ri', @Title, @PublishDateTime, @ExpiryDateTime, @AttachmentType, @LinkUrl, @FilePath,
           @IsSendWhatsapp, @IsSendEmail, 'Unpublished', @RecipientTarget, @RecipientZoneIds, @RecipientDistrictIds, @RecipientSubgroupIds, @U, NOW(), 0);
       SELECT LAST_INSERT_ID();`,
      { ...this.newsletterParams(body), U: createdBy },
    )));
    if (yes(body, "isSendWhatsapp")) {
      const count = await this.newsletterWhatsappCount(body);
      if (count > 0) await this.deductCreditWithHistory("WhatsApp", count, "RiNewsletter", id, `Newsletter WhatsApp: ${s(body, "title") ?? ""}`, createdBy);
    }
    return id;
  }
  async updateNewsletter(id: number, body: unknown, modifiedBy: number) {
    const prior = await this.db.queryFirstOrDefault("SELECT IsSendWhatsapp FROM newsletters WHERE pk_newsletter_id = @Id AND Scope = 'ri' AND isdeleted = 0", { Id: id });
    const priorWhatsapp = !!prior && num(prior.IsSendWhatsapp) !== 0;
    if (yes(body, "isSendWhatsapp") && !priorWhatsapp) {
      const count = await this.newsletterWhatsappCount(body);
      if (count > 0 && !(await this.hasSufficientCredits("WhatsApp", count))) throw new InvalidOperationException(`Insufficient WhatsApp credits. Need ${count} credit(s).`);
    }
    await this.db.execute(
      `UPDATE newsletters
       SET Title = @Title, PublishDateTime = @PublishDateTime, ExpiryDateTime = @ExpiryDateTime,
           AttachmentType = @AttachmentType, LinkUrl = @LinkUrl, FilePath = @FilePath,
           IsSendWhatsapp = @IsSendWhatsapp, IsSendEmail = @IsSendEmail,
           RecipientTarget = @RecipientTarget, RecipientZoneIds = @RecipientZoneIds,
           RecipientDistrictIds = @RecipientDistrictIds, RecipientSubgroupIds = @RecipientSubgroupIds,
           modified_by = @U, modified_date = NOW()
       WHERE pk_newsletter_id = @Id AND Scope = 'ri'`,
      { ...this.newsletterParams(body), Id: id, U: modifiedBy },
    );
    if (yes(body, "isSendWhatsapp") && !priorWhatsapp) {
      const count = await this.newsletterWhatsappCount(body);
      if (count > 0) await this.deductCreditWithHistory("WhatsApp", count, "RiNewsletter", id, `Newsletter WhatsApp: ${s(body, "title") ?? ""}`, modifiedBy);
    }
  }
  deleteNewsletter(id: number, deletedBy: number) {
    return this.deleteWithRefund("newsletters", "pk_newsletter_id", id, deletedBy, "RiNewsletter", "isdeleted = 1, deleted_by = @U, deleted_date = NOW()");
  }
  uploadNewsletterFile(file: UploadedFile) {
    return saveWithReadableName(this.config, file, "", "Documents", "ebulletin", "ri");
  }

  // ── Reports (xlsx) ───────────────────────────────────────────────────────────────────────────
  private generated() { return formatDate(nowIn(Brand.Current.locale.defaultTimeZone), "yyyy-MM-dd HH:mm"); }

  async getReportZonesXlsx() {
    const rows = await this.db.query(
      `SELECT z.pk_zone_id AS ZoneId, z.ZoneName,
              (SELECT COUNT(*) FROM district_master d WHERE d.fk_zone_id = z.pk_zone_id AND d.isdeleted = 0) AS Districts,
              (SELECT COUNT(*) FROM club_master c JOIN district_master d ON d.pk_district_id = c.fk_district_id
               WHERE d.fk_zone_id = z.pk_zone_id AND c.isdeleted = 0 AND d.isdeleted = 0) AS Clubs,
              (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
               FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
               JOIN district_master d ON d.pk_district_id = c.fk_district_id
               JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
               WHERE d.fk_zone_id = z.pk_zone_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND c.isdeleted = 0 AND m.isdeleted = 0) AS Members
       FROM zone_master z WHERE z.isdeleted = 0 ORDER BY z.ZoneName`,
    );
    return reportWorkbook("Zones Summary", "RI Director — Zones Summary", "#1E40AF", `Generated: ${this.generated()}`, ["Zone ID", "Zone Name", "Districts", "Clubs", "Members"], "#3B82F6",
      rows.map((r) => [num(r.ZoneId), String(r.ZoneName ?? ""), num(r.Districts), num(r.Clubs), num(r.Members)]), { totals: [3, 4, 5], totalFill: "#DBEAFE" });
  }

  async getReportDistrictsXlsx() {
    const rows = await this.db.query(
      `SELECT d.pk_district_id AS DistrictId, d.DistrictNumber, z.ZoneName,
              (SELECT COUNT(*) FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.isdeleted = 0) AS Clubs,
              (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
               FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
               JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
               WHERE c.fk_district_id = d.pk_district_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND c.isdeleted = 0 AND m.isdeleted = 0) AS Members
       FROM district_master d LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE d.isdeleted = 0 AND d.IsActive = 1 ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber`,
    );
    return reportWorkbook("Districts Summary", "RI Director — Districts Summary", "#059669", `Generated: ${this.generated()}`, ["District ID", "District Number", "Zone", "Clubs", "Members"], "#10B981",
      rows.map((r) => [num(r.DistrictId), String(r.DistrictNumber ?? ""), String(r.ZoneName ?? ""), num(r.Clubs), num(r.Members)]), { totals: [4, 5], totalFill: "#D1FAE5" });
  }

  async getReportClubsXlsx() {
    const rows = await this.db.query(
      `SELECT c.pk_club_id AS ClubId, c.ClubName, c.ClubRotaryId, d.DistrictNumber, z.ZoneName, c.City, c.State,
              (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0) AS Members
       FROM club_master c LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
       LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE c.isdeleted = 0 ORDER BY c.ClubName`,
    );
    const t = (v: unknown) => String(v ?? "");
    return reportWorkbook("Clubs Master", "RI Director — Clubs Master", "#D97706", `Generated: ${this.generated()}`, ["Club ID", "Club Name", "Rotary ID", "District", "Zone", "City", "State", "Members"], "#F59E0B",
      rows.map((r) => [num(r.ClubId), t(r.ClubName), t(r.ClubRotaryId), t(r.DistrictNumber), t(r.ZoneName), t(r.City), t(r.State), num(r.Members)]), { autoFilter: true });
  }

  async getReportMembersXlsx() {
    const rows = await this.db.query(
      `SELECT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId, m.PrimaryMobileNumber, m.RotaryId, c.ClubName, d.DistrictNumber, z.ZoneName
       FROM member_master_profile m
       JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id
       LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
       LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE m.isdeleted = 0 AND cm.IsActive = 1 AND cm.isdeleted = 0 AND c.isdeleted = 0
       GROUP BY m.pk_member_master_profile_id, m.MemberName, m.EmailId, m.PrimaryMobileNumber, m.RotaryId, c.ClubName, d.DistrictNumber, z.ZoneName
       ORDER BY m.MemberName`,
    );
    const t = (v: unknown) => String(v ?? "");
    return reportWorkbook("Members Master", "RI Director — Members Master", "#BE185D", `Generated: ${this.generated()}  |  Total: ${rows.length}`, ["Member ID", "Name", "Email", "Mobile", "Rotary ID", "Club", "District", "Zone"], "#EC4899",
      rows.map((r) => [num(r.MemberId), t(r.MemberName), t(r.EmailId), t(r.PrimaryMobileNumber), t(r.RotaryId), t(r.ClubName), t(r.DistrictNumber), t(r.ZoneName)]), { autoFilter: true });
  }

  async getReportCommunicationsXlsx() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Communications Log");
    titleRows(ws, "RI Director — Communications Log", "#7C3AED", `Generated: ${this.generated()}`, 6);
    headerRow(ws, ["Type", "ID", "Title/Subject", "Recipients", "Date", "Status"], "#8B5CF6");
    let row = 5;
    const STATUS_COLORS: Record<string, [string, string]> = {
      Published: ["#D1FAE5", "#065F46"], Sent: ["#D1FAE5", "#065F46"], Expired: ["#FEE2E2", "#991B1B"], Failed: ["#FEE2E2", "#991B1B"],
      Unpublished: ["#FEF3C7", "#92400E"], Draft: ["#FEF3C7", "#92400E"], Partial: ["#DBEAFE", "#1E40AF"], Sending: ["#DBEAFE", "#1E40AF"],
    };
    const addRow = (type: string, id: number, title: string, recipients: string, at: unknown, status: string, typeColor: string) => {
      ws.getRow(row).values = [type, id, title, recipients, at ? formatDate(String(at), "yyyy-MM-dd HH:mm") : "", status];
      const t = ws.getCell(row, 1);
      t.fill = solid(typeColor);
      t.font = { bold: true, color: { argb: "FFFFFFFF" } };
      t.alignment = { horizontal: "center" };
      const sc = ws.getCell(row, 6);
      sc.alignment = { horizontal: "center" };
      sc.font = { bold: true };
      const c = STATUS_COLORS[status];
      if (c) { sc.fill = solid(c[0]); sc.font = { bold: true, color: { argb: argb(c[1]) } }; }
      row++;
    };
    const statusCase = (p: string, e: string) => `CASE WHEN NOW() < ${p} THEN 'Unpublished' WHEN NOW() > ${e} THEN 'Expired' ELSE 'Published' END`;
    for (const r of await this.db.query(`SELECT pk_announcement_id AS Id, Title, RecipientTarget, PublishDateTime AS Dt, ${statusCase("PublishDateTime", "ExpiryDateTime")} AS Status FROM announcements WHERE Scope = 'ri' AND isdeleted = 0 ORDER BY PublishDateTime DESC`))
      addRow("Announcement", num(r.Id), String(r.Title ?? ""), String(r.RecipientTarget ?? "all"), r.Dt, String(r.Status), "#3B82F6");
    for (const r of await this.db.query(`SELECT pk_upcoming_event_id AS Id, Title, RecipientTarget, EventDate AS Dt, ${statusCase("PublishDate", "ExpiryDate")} AS Status FROM upcoming_events WHERE Scope = 'ri' AND isdeleted = 0 ORDER BY EventDate DESC`))
      addRow("Event", num(r.Id), String(r.Title ?? ""), String(r.RecipientTarget ?? "all"), r.Dt, String(r.Status), "#8B5CF6");
    for (const r of await this.db.query("SELECT pk_mass_email_id AS Id, Subject, RecipientType, TotalRecipients, SentDate, Status, created_date FROM club_mass_emails WHERE Scope = 'ri' AND isdeleted = 0 ORDER BY pk_mass_email_id DESC"))
      addRow("MassEmail", num(r.Id), String(r.Subject ?? ""), String(num(r.TotalRecipients)), r.SentDate ?? r.created_date, String(r.Status ?? ""), "#EC4899");
    for (const r of await this.db.query(`SELECT pk_newsletter_id AS Id, Title, PublishDateTime AS Dt, RecipientTarget, ${statusCase("PublishDateTime", "ExpiryDateTime")} AS Status FROM newsletters WHERE Scope = 'ri' AND isdeleted = 0 ORDER BY PublishDateTime DESC`))
      addRow("Newsletter", num(r.Id), String(r.Title ?? ""), String(r.RecipientTarget ?? "all"), r.Dt, String(r.Status), "#F59E0B");
    if (row > 5) {
      borders(ws, 5, 1, row - 1, 6);
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: row - 1, column: 6 } };
    }
    fit(ws);
    ws.views = [{ state: "frozen", ySplit: 4 }];
    return toBuffer(wb);
  }
}

// ── Excel helpers (ApplyHeader / ApplyDataStyle) ─────────────────────────────────────────────────
const argb = (hex: string) => `FF${hex.replace("#", "").toUpperCase()}`;
const solid = (hex: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb: argb(hex) } });
function borders(ws: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number) {
  const thin = { style: "thin" as const };
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = { top: thin, left: thin, bottom: thin, right: thin };
}
function fit(ws: ExcelJS.Worksheet) {
  ws.columns.forEach((col) => {
    let w = 8;
    // Rows 1-2 are the merged title lines, which AdjustToContents skips.
    col.eachCell?.({ includeEmpty: false }, (cell, r) => { if (r > 2) w = Math.max(w, String(cell.value ?? "").length + 2); });
    col.width = Math.min(w, 80);
  });
}
function titleRows(ws: ExcelJS.Worksheet, title: string, color: string, generated: string, cols: number) {
  ws.getCell(1, 1).value = title;
  ws.mergeCells(1, 1, 1, cols);
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  ws.getCell(1, 1).fill = solid(color);
  ws.getCell(1, 1).alignment = { horizontal: "center" };
  ws.getRow(1).height = 28;
  ws.getCell(2, 1).value = generated;
  ws.mergeCells(2, 1, 2, cols);
  ws.getCell(2, 1).font = { italic: true, color: { argb: "FF808080" } };
}
function headerRow(ws: ExcelJS.Worksheet, headers: string[], color: string) {
  headers.forEach((h, i) => {
    const c = ws.getCell(4, i + 1);
    c.value = h;
    c.fill = solid(color);
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.alignment = { horizontal: "center" };
  });
  borders(ws, 4, 1, 4, headers.length);
}
async function reportWorkbook(sheet: string, title: string, color: string, generated: string, headers: string[], headerColor: string, rows: (string | number)[][],
  opts: { totals?: number[]; totalFill?: string; autoFilter?: boolean }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  const cols = headers.length;
  titleRows(ws, title, color, generated, cols);
  headerRow(ws, headers, headerColor);
  let row = 5;
  for (const r of rows) ws.getRow(row++).values = r;
  if (row > 5) {
    borders(ws, 5, 1, row - 1, cols);
    for (let r = 5; r < row; r++) if (r % 2 === 0) for (let c = 1; c <= cols; c++) ws.getCell(r, c).fill = solid("#F7FAFC");
    if (opts.autoFilter) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: row - 1, column: cols } };
  }
  if (opts.totals && rows.length > 0) {
    ws.getCell(row, 1).value = "TOTAL";
    for (const c of opts.totals) {
      const L = String.fromCharCode(64 + c);
      ws.getCell(row, c).value = { formula: `SUM(${L}5:${L}${row - 1})`, result: rows.reduce((a, r) => a + (Number(r[c - 1]) || 0), 0) };
    }
    for (let c = 1; c <= cols; c++) {
      const cell = ws.getCell(row, c);
      cell.fill = solid(opts.totalFill!);
      cell.font = { bold: true };
    }
  }
  fit(ws);
  ws.views = [{ state: "frozen", ySplit: 4 }];
  return toBuffer(wb);
}
