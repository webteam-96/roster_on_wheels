import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { Db, type Row } from "../database/db.service";
import { AppConfig } from "../config/app-config";
import { Brand } from "../brand/brand";
import { formatDate } from "../common/dotnet-format";
import { EmailService } from "./email.service";
import { WhatsAppSender, memberE164 } from "./messaging";

/** Days before EndDate that trigger a reminder: trial sites (no payment recorded) and paid sites. */
const TRIAL_MILESTONES = [3, 1];
const PAID_MILESTONES = [30, 15, 7, 1];

/** The milestone marker due today ("Milestone:P-15"), or null when today is not a milestone. */
export function reminderMarker(daysLeft: number, isPaid: boolean, reminderDays: number | null): string | null {
  const milestones = [...(isPaid ? PAID_MILESTONES : TRIAL_MILESTONES)];
  // The club's own reminder lead time (chosen at purchase) is honoured on top of the fixed ones.
  if (reminderDays !== null && reminderDays > 0 && !milestones.includes(reminderDays)) milestones.push(reminderDays);
  return milestones.includes(daysLeft) ? `Milestone:${isPaid ? "P" : "T"}-${daysLeft}` : null;
}

/**
 * Port of ClubWebsiteReminderBackgroundService.cs: 2 minutes after start-up and
 * then every 6 hours, marks Active sites past their EndDate as Expired and sends
 * the expiry reminders (email, and WhatsApp when a template is configured) to the
 * club president, secretary and treasurer. Each milestone is logged in
 * club_website_logs, so a re-run within 2 days does not send it again.
 *
 * ROW: the one-click renewal link is left out until Payments is ported (there is
 * no /pay page yet), so the email asks the club to contact the admin team, and the
 * WhatsApp reminder (whose template carries the link) is not sent.
 */
@Injectable()
export class ClubWebsiteReminderService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger("ClubWebsiteReminderBackgroundService");
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly email: EmailService,
    private readonly whatsApp: WhatsAppSender,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.backgroundJobsEnabled) return;
    this.log.log("ClubWebsiteReminder background service started.");
    const run = () => this.runDaily().catch((e) => this.log.error(`Error in ClubWebsiteReminder background service: ${(e as Error).message}`));
    this.timers.push(setTimeout(() => {
      void run();
      this.timers.push(setInterval(() => void run(), 6 * 60 * 60 * 1000));
    }, 2 * 60 * 1000));
  }

  onApplicationShutdown() {
    this.timers.forEach((t) => clearTimeout(t));
  }

  async runDaily() {
    await this.db.session(async (conn) => {
      // 1. Auto-expire Active sites past their EndDate; the EXISTS guard skips websites whose club row is gone.
      const expired = await conn.query(`
        SELECT pk_id FROM club_websites w
        WHERE Status = 'Active' AND EndDate < CURDATE() AND isdeleted = 0
          AND EXISTS (SELECT 1 FROM club_master c WHERE c.pk_club_id = w.fk_club_id)`);
      for (const { pk_id: id } of expired) {
        try {
          await conn.execute("UPDATE club_websites SET Status = 'Expired' WHERE pk_id = @Id", { Id: id });
          await conn.execute(
            `INSERT INTO club_website_logs (fk_website_id, Action, Details, PerformedBy)
             VALUES (@Id, 'AutoExpired', 'End date passed — status auto-updated', 0)`,
            { Id: id },
          );
        } catch (e) {
          if (!/foreign key/i.test((e as Error).message)) throw e;
          this.log.warn(`Skipped expiry for club_website id=${String(id)} due to orphaned fk_club_id.`);
        }
      }

      // 2. Active sites in an active club, district and zone that reach a milestone today.
      const candidates = await conn.query(`
        SELECT w.pk_id        AS id,
               w.fk_club_id   AS clubId,
               c.ClubName     AS clubName,
               w.Subdomain    AS subdomain,
               w.ClientDomain AS clientDomain,
               w.EndDate      AS endDate,
               DATEDIFF(w.EndDate, CURDATE()) AS daysLeft,
               w.AmountPaid   AS amountPaid,
               w.TransactionId AS transactionId,
               w.ReminderDays AS reminderDays
        FROM club_websites w
        JOIN club_master c    ON c.pk_club_id      = w.fk_club_id
        JOIN district_master d ON d.pk_district_id = c.fk_district_id
        JOIN zone_master z    ON z.pk_zone_id      = d.fk_zone_id
        WHERE w.Status = 'Active' AND w.isdeleted = 0
          AND DATEDIFF(w.EndDate, CURDATE()) >= 0
          AND c.isdeleted = 0 AND c.IsActive = 1
          AND d.isdeleted = 0 AND d.IsActive = 1
          AND z.isdeleted = 0 AND z.IsActive = 1`);
      if (candidates.length === 0) return;

      const currentYearId = await conn.executeScalar<number>("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
      if (currentYearId === null || currentYearId === undefined) {
        this.log.warn("No current rotary year set — skipping website reminders.");
        return;
      }
      const waTemplate = this.config.get("WhatsApp:ClubWebsiteReminderTemplate");
      const parentDomain = (await conn.executeScalar<string>("SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteParentDomain' LIMIT 1"))
        ?? this.config.get("PleskSettings:ParentDomain") ?? Brand.Current.domains.clubSiteParent;
      const payLink: string | null = null;

      for (const w of candidates as Row[]) {
        const daysLeft = Number(w.daysLeft ?? 0);
        const isPaid = Number(w.amountPaid ?? 0) > 0 || !!String(w.transactionId ?? "").trim();
        const marker = reminderMarker(daysLeft, isPaid, w.reminderDays === null || w.reminderDays === undefined ? null : Number(w.reminderDays));
        if (!marker) continue;

        const already = Number(await conn.executeScalar(
          `SELECT COUNT(*) FROM club_website_logs
           WHERE fk_website_id = @Id
             AND Action = 'ReminderSent'
             AND Details LIKE @Pattern
             AND PerformedDate > DATE_SUB(NOW(), INTERVAL 2 DAY)`,
          { Id: w.id, Pattern: `%${marker}%` },
        ));
        if (already > 0) continue;

        const leaders = await conn.query(
          `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName, m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
                  d.designation_name AS designation
           FROM board_of_directors b
           JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
           JOIN designation_master d   ON d.pk_designation_id = b.fk_designation_id
           WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId AND b.isdeleted = 0
             AND d.designation_name IN ('Club President', 'Club Secretary', 'Club Treasurer')
             AND ((m.EmailId IS NOT NULL AND m.EmailId <> '') OR (m.PrimaryMobileNumber IS NOT NULL AND m.PrimaryMobileNumber <> ''))`,
          { ClubId: w.clubId, YearId: currentYearId },
        );

        const subdomain = String(w.subdomain ?? "");
        const clientDomain = String(w.clientDomain ?? "");
        const websiteUrl = clientDomain.trim() ? clientDomain : subdomain.trim() ? `${subdomain}.${parentDomain}` : String(w.clubName);
        const endDate = String(w.endDate);
        const dueDate = formatDate(endDate, "dd MMM yyyy");

        let sent = 0, failed = 0;
        for (const l of leaders) {
          const lemail = l.email as string | null;
          const lmobile = l.mobile as string | null;
          const lname = String(l.memberName ?? "");
          const ldesig = String(l.designation ?? "");
          if (lemail && lemail.trim()) {
            try {
              await this.email.sendClubWebsiteReminderEmail(lemail, lname, String(w.clubName), ldesig, subdomain, endDate, daysLeft, payLink);
              sent++;
            } catch (e) {
              failed++;
              this.log.error(`Website reminder email failed for ${lemail}: ${(e as Error).message}`);
            }
          }
          // WhatsApp renewal template: [name, websiteUrl, dueDate, payLink].
          if (lmobile && lmobile.trim() && waTemplate && waTemplate.trim() && payLink) {
            try {
              const e164 = await memberE164(conn, Number(l.memberId), lmobile);
              const ok = e164 !== null && await this.whatsApp.sendTemplate(e164, waTemplate, Brand.Current.locale.defaultLanguage, [lname, websiteUrl, dueDate, payLink]);
              if (ok) sent++; else failed++;
            } catch (e) {
              failed++;
              this.log.warn(`Website reminder WhatsApp failed for ${lmobile}: ${(e as Error).message}`);
            }
          }
        }

        await conn.execute("UPDATE club_websites SET LastReminderSent = NOW() WHERE pk_id = @Id", { Id: w.id });
        await conn.execute(
          `INSERT INTO club_website_logs (fk_website_id, Action, Details, PerformedBy)
           VALUES (@Id, 'ReminderSent', @Details, 0)`,
          { Id: w.id, Details: `${marker} — ${isPaid ? "Paid" : "Trial"} site, ${daysLeft} day(s) left. Sent: ${sent}, Failed: ${failed}` },
        );
      }
    });
  }
}
