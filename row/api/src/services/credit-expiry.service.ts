import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { Db, type Row } from "../database/db.service";
import { AppConfig } from "../config/app-config";
import { formatDate } from "../common/dotnet-format";
import { EmailService, emailFooter, emailHeader } from "./email.service";

/**
 * Port of CreditExpiryBackgroundService.cs: on start-up and then every 24 hours,
 * deactivates credits past their ToDate and emails the club admin once per credit
 * that expires within 5 days with some left.
 */
@Injectable()
export class CreditExpiryService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger("CreditExpiryBackgroundService");
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly email: EmailService,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.backgroundJobsEnabled) return;
    const run = () => this.processExpiry().catch((e) => this.log.error(`Error in credit expiry background job: ${(e as Error).message}`));
    void run();
    this.timer = setInterval(() => void run(), 24 * 60 * 60 * 1000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async processExpiry() {
    await this.db.session(async (conn) => {
      const expiredCount = await conn.execute("UPDATE club_credits SET IsActive = 0, modified_date = NOW() WHERE IsActive = 1 AND NOW() > ToDate AND isdeleted = 0");
      if (expiredCount > 0) this.log.log(`Marked ${expiredCount} credit records as expired`);

      const expiring = await conn.query(`
        SELECT cc.pk_credit_id, cc.fk_club_id, cc.CreditType,
               (cc.CreditCount - cc.UsedCount) AS Remaining,
               cc.ToDate,
               DATEDIFF(cc.ToDate, NOW()) AS DaysLeft,
               c.ClubName
        FROM club_credits cc
        JOIN club_master c ON c.pk_club_id = cc.fk_club_id
        WHERE cc.IsActive = 1 AND cc.isdeleted = 0
          AND DATEDIFF(cc.ToDate, NOW()) <= 5
          AND DATEDIFF(cc.ToDate, NOW()) >= 0
          AND (cc.CreditCount - cc.UsedCount) > 0
          AND cc.pk_credit_id NOT IN (
              SELECT CAST(SourceDetail AS UNSIGNED) FROM club_credit_usage_history
              WHERE Source = 'ExpiryWarning' AND fk_club_id = cc.fk_club_id
          )`);

      for (const credit of expiring as Row[]) {
        try {
          const clubId = Number(credit.fk_club_id);
          const creditType = String(credit.CreditType);
          const remaining = Number(credit.Remaining);
          const daysLeft = Number(credit.DaysLeft);
          const clubName = String(credit.ClubName);
          const admin = await conn.queryFirstOrDefault(
            `SELECT m.MemberName, m.EmailId
             FROM member_roles mr
             JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id
             WHERE mr.fk_role_id = 2 AND mr.fk_club_id = @ClubId AND mr.IsActive = 1 AND mr.isdeleted = 0
             LIMIT 1`,
            { ClubId: clubId },
          );
          const to = admin?.EmailId as string | null | undefined;
          if (!admin || !to || !to.trim()) continue;

          const subject = `⚠️ ${creditType} Credits Expiring Soon - ${clubName}`;
          const body = `
                        ${emailHeader()}
                            <h2 style='color: #d69e2e; margin-top: 0;'>⚠️ ${creditType} Credits Expiring Soon</h2>
                            <p>Dear ${String(admin.MemberName)},</p>
                            <p>Your <strong>${creditType}</strong> credits for <strong>${clubName}</strong> are expiring soon.</p>
                            <div style='background-color: #fffff0; border: 1px solid #f6e05e; border-radius: 8px; padding: 16px; margin: 16px 0;'>
                                <table style='width:100%;border-collapse:collapse;'>
                                    <tr><td style='padding:6px 0;font-weight:bold;'>Credit Type:</td><td>${creditType}</td></tr>
                                    <tr><td style='padding:6px 0;font-weight:bold;'>Remaining Credits:</td><td style='color:#e53e3e;font-weight:bold;'>${remaining}</td></tr>
                                    <tr><td style='padding:6px 0;font-weight:bold;'>Expiry Date:</td><td style='color:#e53e3e;font-weight:bold;'>${formatDate(String(credit.ToDate), "dd-MMM-yyyy")}</td></tr>
                                    <tr><td style='padding:6px 0;font-weight:bold;'>Days Left:</td><td style='color:#e53e3e;font-weight:bold;'>${daysLeft} day${daysLeft !== 1 ? "s" : ""}</td></tr>
                                </table>
                            </div>
                            <p>Please contact your administrator to renew your credits before they expire.</p>
                        ${emailFooter()}`;
          await this.email.sendGenericEmail(to, subject, body);

          // Recorded so the warning goes out once per credit.
          await conn.execute(
            `INSERT INTO club_credit_usage_history (fk_club_id, fk_district_id, CreditType, DeductedCount, Source, SourceId, SourceDetail, BalanceBefore, BalanceAfter, created_by, created_date)
             VALUES (@ClubId, NULL, @CreditType, 0, 'ExpiryWarning', @CreditId, @CreditIdStr, @Remaining, @Remaining, 0, NOW())`,
            { ClubId: clubId, CreditType: creditType, CreditId: Number(credit.pk_credit_id), CreditIdStr: String(credit.pk_credit_id), Remaining: remaining },
          );
          this.log.log(`Sent ${creditType} expiry warning to ${to} for club ${clubName} (${daysLeft} days left)`);
        } catch (e) {
          this.log.error(`Failed to send expiry warning for credit ${String(credit.pk_credit_id)}: ${(e as Error).message}`);
        }
      }
    });
  }
}
