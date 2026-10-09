import { Injectable, Logger } from "@nestjs/common";
import { Db, type DbCommands } from "../database/db.service";
import { AppConfig } from "../config/app-config";
import { Brand } from "../brand/brand";
import { InvalidOperationException } from "../common/exceptions";
import { dbDateTime } from "../common/binding";
import { defineDto } from "../common/dto";
import { formatDate } from "../common/dotnet-format";
import { EmailService, emailFooter, emailHeader } from "./email.service";
import { saveWithGuidName, type UploadedFile } from "./media-storage";

const str = { type: "string" as const, default: () => "" };

/** DTOs/CreditDtos.cs */
export const CreditListDto = defineDto({
  Id: "int", DistrictNumber: str, ClubName: str, CreditType: str, PreviousCount: "int", CreditCount: "int", UsedCount: "int",
  Remaining: "int", FromDate: "datetime", ToDate: "datetime", IsActive: "bool", IsExpired: "bool", TransactionId: "string",
  PaymentDate: "datetime?", ProofDocumentPath: "string", CreatedDate: "datetime", LastUsedDate: "datetime?",
});
export const AddCreditDto = defineDto({
  FkDistrictId: "int", FkClubId: "int", CreditType: { type: "string", default: () => "Email" }, CreditCount: "int", ToDate: "string",
  TransactionId: "string", PaymentDate: "string",
});
export type AddCredit = { fkDistrictId: number; fkClubId: number; creditType: string; creditCount: number; toDate: string | null; transactionId: string | null; paymentDate: string | null };
export const UpdateCreditDto = defineDto({ CreditCount: "int", ToDate: "string", TransactionId: "string", PaymentDate: "string" });
export type UpdateCredit = { creditCount: number; toDate: string | null; transactionId: string | null; paymentDate: string | null };
export const CreditNotificationDto = defineDto({ CreditType: str, RemainingCredits: "int", ExpiryDate: "datetime", DaysLeft: "int" });
export const CreditUsageHistoryDto = defineDto({
  Id: "int", ClubName: str, DistrictNumber: str, CreditType: str, DeductedCount: "int", Source: str, SourceId: "int?", SourceDetail: "string",
  BalanceBefore: "int", BalanceAfter: "int", CreatedDate: "datetime",
});

export interface CreditBalance {
  emailCredits: number;
  emailUsed: number;
  emailRemaining: number;
  emailExpiry: string | null;
  whatsAppCredits: number;
  whatsAppUsed: number;
  whatsAppRemaining: number;
  whatsAppExpiry: string | null;
}

const blank = (s: string | null | undefined) => !s || !s.trim();

/**
 * Port of CreditManagementService.cs: prepaid Email / WhatsApp send credits per
 * club (fk_club_id) or per district (fk_club_id = 0). Packs are used up in
 * expiry order.
 */
@Injectable()
export class CreditManagementService {
  private readonly log = new Logger("CreditManagementService");

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly email: EmailService,
  ) {}

  private async logOfflineEntry(
    conn: DbCommands, creditId: number, districtId: number, clubId: number, creditType: string, entryType: string, creditCount: number,
    countBefore: number | null, countAfter: number | null, toDate: string | null, transactionId: string | null, paymentDate: string | null,
    proofPath: string | null, userId: number,
  ) {
    try {
      await conn.execute(
        `INSERT INTO club_credit_offline_log (fk_credit_id, fk_district_id, fk_club_id, CreditType, EntryType,
             CreditCount, CountBefore, CountAfter, ToDate, TransactionId, PaymentDate, ProofDocumentPath,
             created_by, created_date)
         VALUES (@CreditId, @DistrictId, @ClubId, @CreditType, @EntryType,
             @CreditCount, @CountBefore, @CountAfter, @ToDate, @TransactionId, @PaymentDate, @ProofPath,
             @UserId, NOW())`,
        {
          CreditId: creditId, DistrictId: districtId, ClubId: clubId, CreditType: creditType, EntryType: entryType, CreditCount: creditCount,
          CountBefore: countBefore, CountAfter: countAfter, ToDate: toDate, TransactionId: transactionId, PaymentDate: paymentDate, ProofPath: proofPath, UserId: userId,
        },
      );
    } catch (e) {
      this.log.error(`Offline credit log write failed (credit ${creditId}, ${creditType} ${creditCount}) — credits were saved: ${(e as Error).message}`);
    }
  }

  async getCredits(districtId: number | null, clubId: number | null, creditType: string | null, status: string | null, page: number, pageSize: number) {
    const conditions = ["cc.isdeleted = 0"];
    if (districtId && districtId > 0) conditions.push("cc.fk_district_id = @DistrictId");
    if (clubId && clubId > 0) conditions.push("cc.fk_club_id = @ClubId");
    if (creditType) conditions.push("cc.CreditType = @CreditType");
    if (status === "Active") conditions.push("cc.IsActive = 1 AND NOW() <= cc.ToDate");
    else if (status === "Expired") conditions.push("(cc.IsActive = 0 OR NOW() > cc.ToDate)");
    const where = conditions.join(" AND ");
    const params = { DistrictId: districtId ?? 0, ClubId: clubId ?? 0, CreditType: creditType ?? "", PageSize: pageSize, Offset: (page - 1) * pageSize };
    return this.db.session(async (conn) => {
      const items = CreditListDto.mapAll(
        await conn.query(
          `SELECT cc.pk_credit_id AS Id,
                  d.DistrictNumber, c.ClubName, cc.CreditType,
                  cc.PreviousCount, cc.CreditCount, cc.UsedCount,
                  (cc.CreditCount - cc.UsedCount) AS Remaining,
                  cc.FromDate, cc.ToDate, cc.IsActive,
                  CASE WHEN NOW() > cc.ToDate THEN 1 ELSE 0 END AS IsExpired,
                  cc.TransactionId, cc.PaymentDate,
                  CASE
                      WHEN cc.ProofDocumentPath IS NULL OR cc.ProofDocumentPath = '' THEN NULL
                      WHEN cc.ProofDocumentPath LIKE '/%' THEN cc.ProofDocumentPath
                      ELSE CONCAT('/Documents/CreditProofs/', cc.ProofDocumentPath)
                  END AS ProofDocumentPath,
                  cc.created_date AS CreatedDate,
                  (SELECT MAX(h.created_date)
                     FROM club_credit_usage_history h
                    WHERE h.fk_club_id = cc.fk_club_id
                      AND h.fk_district_id = cc.fk_district_id
                      AND h.CreditType = cc.CreditType) AS LastUsedDate
           FROM club_credits cc
           INNER JOIN district_master d ON d.pk_district_id = cc.fk_district_id
           LEFT JOIN club_master c ON c.pk_club_id = cc.fk_club_id
           WHERE ${where}
           ORDER BY cc.created_date DESC
           LIMIT @PageSize OFFSET @Offset`,
          params,
        ),
      );
      const totalCount = Number(await conn.executeScalar(`SELECT COUNT(*) FROM club_credits cc WHERE ${where}`, params));
      return { items, totalCount };
    });
  }

  /** Tops up the newest live pack of that type (extending its expiry), or starts a new pack. */
  async addCredit(dto: AddCredit, proof: UploadedFile | undefined, userId: number): Promise<number> {
    const proofPath = proof ? await saveWithGuidName(this.config, proof, "Documents", "CreditProofs") : null;
    const toDate = dbDateTime(dto.toDate) ?? "0001-01-01 00:00:00";
    const paymentDate = dbDateTime(dto.paymentDate);
    const { creditId, currentBalance } = await this.db.session(async (conn) => {
      const currentBalance = Number(
        (await conn.executeScalar(
          `SELECT SUM(CreditCount - UsedCount) FROM club_credits
           WHERE fk_club_id = @ClubId AND fk_district_id = @DistrictId AND CreditType = @CreditType
             AND IsActive = 1 AND isdeleted = 0 AND NOW() <= ToDate`,
          { ClubId: dto.fkClubId, DistrictId: dto.fkDistrictId, CreditType: dto.creditType },
        )) ?? 0,
      );
      const existing = await conn.queryFirstOrDefault(
        `SELECT pk_credit_id AS Id, CreditCount, DATE_FORMAT(ToDate, '%Y-%m-%d %H:%i:%s') AS ToDate
         FROM club_credits
         WHERE fk_club_id = @ClubId AND fk_district_id = @DistrictId AND CreditType = @CreditType
           AND IsActive = 1 AND isdeleted = 0 AND NOW() <= ToDate
         ORDER BY ToDate DESC LIMIT 1`,
        { ClubId: dto.fkClubId, DistrictId: dto.fkDistrictId, CreditType: dto.creditType },
      );
      let creditId: number;
      if (existing) {
        const newToDate = String(existing.ToDate) > toDate ? String(existing.ToDate) : toDate;
        await conn.execute(
          `UPDATE club_credits
           SET CreditCount = CreditCount + @AddCount, ToDate = @NewToDate,
               PreviousCount = @PreviousCount,
               TransactionId = COALESCE(@TransactionId, TransactionId),
               PaymentDate = COALESCE(@PaymentDate, PaymentDate),
               ProofDocumentPath = COALESCE(@ProofPath, ProofDocumentPath),
               modified_by = @UserId, modified_date = NOW()
           WHERE pk_credit_id = @Id`,
          {
            AddCount: dto.creditCount, NewToDate: newToDate, PreviousCount: currentBalance, TransactionId: dto.transactionId, PaymentDate: paymentDate,
            ProofPath: proofPath, UserId: userId, Id: Number(existing.Id),
          },
        );
        creditId = Number(existing.Id);
      } else {
        creditId = Number(
          await conn.executeScalar(
            `INSERT INTO club_credits (fk_district_id, fk_club_id, CreditType, CreditCount, UsedCount,
                 PreviousCount, FromDate, ToDate, TransactionId, PaymentDate, ProofDocumentPath,
                 IsActive, created_by, created_date, isdeleted)
             VALUES (@DistrictId, @ClubId, @CreditType, @CreditCount, 0,
                 @PreviousCount, NOW(), @ToDate, @TransactionId, @PaymentDate, @ProofPath,
                 1, @UserId, NOW(), 0);
             SELECT LAST_INSERT_ID();`,
            {
              DistrictId: dto.fkDistrictId, ClubId: dto.fkClubId, CreditType: dto.creditType, CreditCount: dto.creditCount, PreviousCount: currentBalance,
              ToDate: toDate, TransactionId: dto.transactionId, PaymentDate: paymentDate, ProofPath: proofPath, UserId: userId,
            },
          ),
        );
      }
      await this.logOfflineEntry(conn, creditId, dto.fkDistrictId, dto.fkClubId, dto.creditType, "Added", dto.creditCount, null, null, toDate, dto.transactionId, paymentDate, proofPath, userId);
      return { creditId, currentBalance };
    });
    void this.sendAllocationEmail(dto, toDate, paymentDate, currentBalance).catch((e) => this.log.error(`Failed to send credit confirmation email: ${(e as Error).message}`));
    return creditId;
  }

  /** Tells the club's admin that credits were added. */
  private async sendAllocationEmail(dto: AddCredit, toDate: string, paymentDate: string | null, currentBalance: number) {
    const admin = await this.db.queryFirstOrDefault(
      `SELECT m.MemberName, m.EmailId
       FROM member_roles mr
       JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id
       WHERE mr.fk_role_id = 2 AND mr.fk_club_id = @ClubId AND mr.IsActive = 1 AND mr.isdeleted = 0
       LIMIT 1`,
      { ClubId: dto.fkClubId },
    );
    if (!admin || blank(admin.EmailId as string | null)) return;
    const clubName = (await this.db.executeScalar<string>("SELECT ClubName FROM club_master WHERE pk_club_id=@Id", { Id: dto.fkClubId })) ?? "Club";
    const cell = "padding:8px;border:1px solid #e2e8f0;";
    const row = (label: string, value: string, shaded: boolean, valueStyle = "") =>
      `<tr${shaded ? " style='background:#f7fafc;'" : ""}><td style='${cell}font-weight:bold;'>${label}</td><td style='${cell}${valueStyle}'>${value}</td></tr>`;
    const body = `
                        ${emailHeader()}
                            <h2 style='color: #1a365d; margin-top: 0;'>${dto.creditType} Credits Allocated</h2>
                            <p>Dear ${admin.MemberName},</p>
                            <p><strong>${dto.creditType}</strong> credits have been allocated to <strong>${clubName}</strong>.</p>
                            <table style='width:100%;border-collapse:collapse;margin:16px 0;'>
                                ${row("Credit Type", dto.creditType, true)}
                                ${row("Previous Balance", String(currentBalance), false)}
                                ${row("Credits Added", `+${dto.creditCount}`, true, "color:#38a169;font-weight:bold;")}
                                ${row("Updated Balance", String(currentBalance + dto.creditCount), false, "color:#1a365d;font-weight:bold;")}
                                ${row("Expiry Date", formatDate(toDate, "dd-MMM-yyyy"), true)}
                                ${!blank(dto.transactionId) ? row("Transaction ID", dto.transactionId!, false) : ""}
                                ${paymentDate ? row("Payment Date", formatDate(paymentDate, "dd-MMM-yyyy"), false) : ""}
                            </table>
                            <p style='color:#718096;font-size:13px;'>Credited on: ${formatDate(new Date(), "dd-MMM-yyyy hh:mm tt")}</p>
                        ${emailFooter()}`;
    await this.email.sendGenericEmail(String(admin.EmailId), `${Brand.Current.shortName} - ${dto.creditType} Credits Allocated for ${clubName}`, body);
  }

  async updateCredit(id: number, dto: UpdateCredit, proof: UploadedFile | undefined, userId: number) {
    await this.db.session(async (conn) => {
      const row = await conn.queryFirstOrDefault(
        `SELECT pk_credit_id, fk_district_id, fk_club_id, CreditType, CreditCount, UsedCount, IsActive, isdeleted,
                (NOW() > ToDate) AS IsPast
         FROM club_credits WHERE pk_credit_id = @Id`,
        { Id: id },
      );
      if (!row) throw new InvalidOperationException("Credit entry not found.");
      if (Number(row.isdeleted)) throw new InvalidOperationException("Credit entry already deleted.");
      if (!Number(row.IsActive) || Number(row.IsPast)) throw new InvalidOperationException("Cannot edit an expired or inactive credit pack.");
      if (dto.creditCount < Number(row.UsedCount)) {
        throw new InvalidOperationException(`New count (${dto.creditCount}) cannot be less than already used credits (${Number(row.UsedCount)}).`);
      }
      const proofPath = proof ? await saveWithGuidName(this.config, proof, "Documents", "CreditProofs") : null;
      const toDate = dbDateTime(dto.toDate) ?? "0001-01-01 00:00:00";
      const paymentDate = dbDateTime(dto.paymentDate);
      await conn.execute(
        `UPDATE club_credits
         SET CreditCount = @CreditCount, ToDate = @ToDate,
             TransactionId = COALESCE(@TransactionId, TransactionId),
             PaymentDate = COALESCE(@PaymentDate, PaymentDate),
             ProofDocumentPath = COALESCE(@ProofPath, ProofDocumentPath),
             modified_by = @UserId, modified_date = NOW()
         WHERE pk_credit_id = @Id`,
        { CreditCount: dto.creditCount, ToDate: toDate, TransactionId: dto.transactionId, PaymentDate: paymentDate, ProofPath: proofPath, UserId: userId, Id: id },
      );
      const before = Number(row.CreditCount);
      if (dto.creditCount !== before) {
        await this.logOfflineEntry(
          conn, id, Number(row.fk_district_id), Number(row.fk_club_id), String(row.CreditType), "Edited", dto.creditCount - before, before, dto.creditCount,
          toDate, dto.transactionId, paymentDate, proofPath, userId,
        );
      }
    });
  }

  async deleteCredit(id: number, userId: number) {
    await this.db.session(async (conn) => {
      const row = await conn.queryFirstOrDefault("SELECT UsedCount, IsActive, isdeleted, (NOW() > ToDate) AS IsPast FROM club_credits WHERE pk_credit_id = @Id", { Id: id });
      if (!row) throw new InvalidOperationException("Credit entry not found.");
      if (Number(row.isdeleted)) throw new InvalidOperationException("Credit entry already deleted.");
      if (!Number(row.IsActive) || Number(row.IsPast)) throw new InvalidOperationException("Cannot delete an expired or inactive credit pack.");
      if (Number(row.UsedCount) > 0) throw new InvalidOperationException(`Cannot delete — ${Number(row.UsedCount)} credit(s) already used from this pack.`);
      await conn.execute("UPDATE club_credits SET isdeleted = 1, modified_by = @UserId, modified_date = NOW() WHERE pk_credit_id = @Id", { UserId: userId, Id: id });
    });
  }

  /**
   * Live credits for a club. The same id also matches district packs
   * (fk_club_id = 0, fk_district_id = id), as in the C#, so district
   * callers can pass a district id here.
   */
  async getClubCreditBalance(clubId: number): Promise<CreditBalance> {
    const credits = await this.db.query(
      `SELECT CreditType, CreditCount, UsedCount, ToDate
       FROM club_credits
       WHERE (fk_club_id = @ClubId OR (fk_club_id = 0 AND fk_district_id = @ClubId))
         AND IsActive = 1 AND isdeleted = 0
         AND NOW() <= ToDate
       ORDER BY ToDate ASC`,
      { ClubId: clubId },
    );
    const r: CreditBalance = { emailCredits: 0, emailUsed: 0, emailRemaining: 0, emailExpiry: null, whatsAppCredits: 0, whatsAppUsed: 0, whatsAppRemaining: 0, whatsAppExpiry: null };
    for (const c of credits) {
      if (c.CreditType === "Email") {
        r.emailCredits += Number(c.CreditCount);
        r.emailUsed += Number(c.UsedCount);
        r.emailExpiry = c.ToDate as string;
      } else if (c.CreditType === "WhatsApp") {
        r.whatsAppCredits += Number(c.CreditCount);
        r.whatsAppUsed += Number(c.UsedCount);
        r.whatsAppExpiry = c.ToDate as string;
      }
    }
    r.emailRemaining = r.emailCredits - r.emailUsed;
    r.whatsAppRemaining = r.whatsAppCredits - r.whatsAppUsed;
    return r;
  }

  async deductCredit(clubId: number, creditType: string, count: number, conn: DbCommands = this.db) {
    const packs = await conn.query(
      `SELECT pk_credit_id AS Id, CreditCount, UsedCount
       FROM club_credits
       WHERE (fk_club_id = @ClubId OR (fk_club_id = 0 AND fk_district_id = @ClubId))
         AND CreditType = @CreditType
         AND IsActive = 1 AND isdeleted = 0
         AND NOW() <= ToDate
         AND (CreditCount - UsedCount) > 0
       ORDER BY ToDate ASC`,
      { ClubId: clubId, CreditType: creditType },
    );
    let remaining = count;
    for (const c of packs) {
      if (remaining <= 0) break;
      const deduct = Math.min(Number(c.CreditCount) - Number(c.UsedCount), remaining);
      await conn.execute("UPDATE club_credits SET UsedCount = UsedCount + @Deduct WHERE pk_credit_id = @Id", { Deduct: deduct, Id: Number(c.Id) });
      remaining -= deduct;
    }
  }

  async checkExpiringCredits(clubId: number) {
    return CreditNotificationDto.mapAll(
      await this.db.query(
        `SELECT CreditType,
                (CreditCount - UsedCount) AS RemainingCredits,
                ToDate AS ExpiryDate,
                DATEDIFF(ToDate, NOW()) AS DaysLeft
         FROM club_credits
         WHERE fk_club_id = @ClubId AND IsActive = 1 AND isdeleted = 0
           AND NOW() <= ToDate
           AND DATEDIFF(ToDate, NOW()) <= 5
           AND (CreditCount - UsedCount) > 0
         ORDER BY ToDate ASC`,
        { ClubId: clubId },
      ),
    );
  }

  async hasSufficientCredits(clubId: number, creditType: string, count: number): Promise<boolean> {
    const b = await this.getClubCreditBalance(clubId);
    return (creditType === "Email" ? b.emailRemaining : b.whatsAppRemaining) >= count;
  }

  async deductWithHistory(clubId: number, creditType: string, count: number, source: string, sourceId: number | null, sourceDetail: string | null, userId: number) {
    await this.db.session(async (conn) => {
      const before = Number(
        (await conn.executeScalar(
          `SELECT SUM(CreditCount - UsedCount) FROM club_credits
           WHERE (fk_club_id = @ClubId OR (fk_club_id = 0 AND fk_district_id = @ClubId))
             AND CreditType = @CreditType
             AND IsActive = 1 AND isdeleted = 0 AND NOW() <= ToDate`,
          { ClubId: clubId, CreditType: creditType },
        )) ?? 0,
      );
      await this.deductCredit(clubId, creditType, count, conn);
      const districtId = await conn.executeScalar<number>("SELECT fk_district_id FROM club_master WHERE pk_club_id = @Id", { Id: clubId });
      await this.insertHistory(conn, clubId, districtId ?? null, creditType, count, source, sourceId, sourceDetail, before, before - count, userId);
    });
  }

  async deductDistrictWithHistory(districtId: number, creditType: string, count: number, source: string, sourceId: number | null, sourceDetail: string | null, userId: number) {
    if (count <= 0) return;
    await this.db.session(async (conn) => {
      const before = Number(
        (await conn.executeScalar(
          `SELECT SUM(CreditCount - UsedCount) FROM club_credits
           WHERE fk_club_id = 0 AND fk_district_id = @DistrictId
             AND CreditType = @CreditType AND IsActive = 1 AND isdeleted = 0 AND NOW() <= ToDate`,
          { DistrictId: districtId, CreditType: creditType },
        )) ?? 0,
      );
      const packs = await conn.query(
        `SELECT pk_credit_id AS Id, CreditCount, UsedCount FROM club_credits
         WHERE fk_club_id = 0 AND fk_district_id = @DistrictId
           AND CreditType = @CreditType AND IsActive = 1 AND isdeleted = 0
           AND NOW() <= ToDate AND (CreditCount - UsedCount) > 0
         ORDER BY ToDate ASC`,
        { DistrictId: districtId, CreditType: creditType },
      );
      let remaining = count;
      for (const c of packs) {
        if (remaining <= 0) break;
        const deduct = Math.min(Number(c.CreditCount) - Number(c.UsedCount), remaining);
        await conn.execute("UPDATE club_credits SET UsedCount = UsedCount + @Deduct WHERE pk_credit_id = @Id", { Deduct: deduct, Id: Number(c.Id) });
        remaining -= deduct;
      }
      await this.insertHistory(conn, 0, districtId, creditType, count, source, sourceId, sourceDetail, before, before - count, userId);
    });
  }

  private insertHistory(
    conn: DbCommands, clubId: number, districtId: number | null, creditType: string, count: number, source: string, sourceId: number | null,
    sourceDetail: string | null, before: number, after: number, userId: number,
  ) {
    return conn.execute(
      `INSERT INTO club_credit_usage_history (fk_club_id, fk_district_id, CreditType, DeductedCount, Source, SourceId, SourceDetail, BalanceBefore, BalanceAfter, created_by, created_date)
       VALUES (@ClubId, @DistrictId, @CreditType, @Count, @Source, @SourceId, @SourceDetail, @BalanceBefore, @BalanceAfter, @UserId, NOW())`,
      { ClubId: clubId, DistrictId: districtId, CreditType: creditType, Count: count, Source: source, SourceId: sourceId, SourceDetail: sourceDetail, BalanceBefore: before, BalanceAfter: after, UserId: userId },
    );
  }

  async getDeductedAmount(clubId: number, creditType: string, source: string, sourceId: number): Promise<number> {
    return Number(
      (await this.db.executeScalar(
        `SELECT COALESCE(SUM(DeductedCount), 0) FROM club_credit_usage_history
         WHERE (fk_club_id = @ClubId OR fk_district_id = @ClubId)
           AND CreditType = @CreditType AND Source = @Source AND SourceId = @SourceId`,
        { ClubId: clubId, CreditType: creditType, Source: source, SourceId: sourceId },
      )) ?? 0,
    );
  }

  /** Gives used credits back, newest pack first, never below zero used. */
  async refundWithHistory(clubId: number, creditType: string, count: number, source: string, sourceId: number | null, sourceDetail: string | null, userId: number) {
    if (count <= 0) return;
    await this.db.session(async (conn) => {
      const before = Number(
        (await conn.executeScalar(
          `SELECT SUM(CreditCount - UsedCount) FROM club_credits
           WHERE (fk_club_id = @ClubId OR (fk_club_id = 0 AND fk_district_id = @ClubId))
             AND CreditType = @CreditType AND IsActive = 1 AND isdeleted = 0`,
          { ClubId: clubId, CreditType: creditType },
        )) ?? 0,
      );
      const rows = await conn.query(
        `SELECT pk_credit_id AS Id, UsedCount FROM club_credits
         WHERE (fk_club_id = @ClubId OR (fk_club_id = 0 AND fk_district_id = @ClubId))
           AND CreditType = @CreditType AND isdeleted = 0 AND UsedCount > 0
         ORDER BY pk_credit_id DESC`,
        { ClubId: clubId, CreditType: creditType },
      );
      let remaining = count;
      let refunded = 0;
      for (const r of rows) {
        if (remaining <= 0) break;
        const fromRow = Math.min(Number(r.UsedCount), remaining);
        if (fromRow <= 0) continue;
        await conn.execute("UPDATE club_credits SET UsedCount = UsedCount - @R, modified_by = @U, modified_date = NOW() WHERE pk_credit_id = @Id", { R: fromRow, U: userId, Id: Number(r.Id) });
        remaining -= fromRow;
        refunded += fromRow;
      }
      if (refunded === 0) return;
      const districtId = await conn.executeScalar<number>("SELECT fk_district_id FROM club_master WHERE pk_club_id = @Id", { Id: clubId });
      await this.insertHistory(conn, clubId, districtId ?? null, creditType, -refunded, source, sourceId, "[Refund] " + (sourceDetail ?? ""), before, before + refunded, userId);
    });
  }

  async getDistrictCreditBalance(districtId: number): Promise<CreditBalance> {
    const rows = await this.db.query(
      `SELECT CreditType, COALESCE(SUM(CreditCount),0) AS total, COALESCE(SUM(UsedCount),0) AS used
       FROM club_credits
       WHERE fk_club_id = 0 AND fk_district_id = @DistrictId
         AND IsActive = 1 AND isdeleted = 0 AND CURDATE() BETWEEN FromDate AND ToDate
       GROUP BY CreditType`,
      { DistrictId: districtId },
    );
    let eT = 0, eU = 0, wT = 0, wU = 0;
    for (const r of rows) {
      const t = String(r.CreditType ?? "").toLowerCase();
      if (t === "email") [eT, eU] = [Number(r.total), Number(r.used)];
      else if (t === "whatsapp") [wT, wU] = [Number(r.total), Number(r.used)];
    }
    return {
      emailCredits: eT, emailUsed: eU, emailRemaining: Math.max(0, eT - eU), emailExpiry: null,
      whatsAppCredits: wT, whatsAppUsed: wU, whatsAppRemaining: Math.max(0, wT - wU), whatsAppExpiry: null,
    };
  }

  async getUsageHistory(clubId: number | null, districtId: number | null, creditType: string | null, page: number, pageSize: number) {
    const conditions: string[] = [];
    if (clubId && clubId > 0) conditions.push("h.fk_club_id = @ClubId");
    if (districtId && districtId > 0) conditions.push("h.fk_district_id = @DistrictId");
    if (creditType) conditions.push("h.CreditType = @CreditType");
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    return CreditUsageHistoryDto.mapAll(
      await this.db.query(
        `SELECT h.pk_id AS Id, COALESCE(c.ClubName, '') AS ClubName, COALESCE(d.DistrictNumber, '') AS DistrictNumber,
                h.CreditType, h.DeductedCount, h.Source, h.SourceId, h.SourceDetail,
                h.BalanceBefore, h.BalanceAfter, h.created_date AS CreatedDate
         FROM club_credit_usage_history h
         LEFT JOIN club_master c ON c.pk_club_id = h.fk_club_id
         LEFT JOIN district_master d ON d.pk_district_id = h.fk_district_id
         ${where}
         ORDER BY h.created_date DESC
         LIMIT @PageSize OFFSET @Offset`,
        { ClubId: clubId ?? 0, DistrictId: districtId ?? 0, CreditType: creditType ?? "", PageSize: pageSize, Offset: (page - 1) * pageSize },
      ),
    );
  }
}
