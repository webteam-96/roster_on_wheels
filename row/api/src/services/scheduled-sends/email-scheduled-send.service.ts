import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { formatDate, formatNumber, htmlEncode } from "../../common/dotnet-format";
import { EmailService } from "../email.service";
import { CreditManagementService } from "../credit-management.service";
import { YearTableResolver } from "../year-table.resolver";
import { RiDirectorService } from "../../modules/ri-director/ri-director.service";
import { isClubService, loadClubServiceMeeting } from "./club-service-notification";
import {
  buildAbsoluteUrl, buildMediaPath, isTransientDbBlip, nz, resolveRecipients, resolveScope, resolveSourceName, type Recipient,
} from "./scheduled-send.helpers";

const POLL_INTERVAL_MS = 10_000;
const MAX_CONCURRENCY_PER_RECORD = 8;

const esc = (s: string | null | undefined) => htmlEncode(s ?? "");
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** The branded email body; {{NAME}} is replaced per recipient. */
function shell(sourceName: string, heading: string, innerHtml: string): string {
  const b = Brand.Current;
  const logoPath = b.look.logoDarkUrl || b.look.logoUrl;
  const logo = !logoPath ? "" : /^https?:\/\//.test(logoPath) ? logoPath : `${b.domains.adminOrigin}${logoPath}`;
  const mark = logo ? `<div style='text-align:center;margin-bottom:12px'><img src='${logo}' alt='${esc(b.productName)}' style='height:77px' /></div>` : "";
  return `
<div style='font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.6;max-width:640px;margin:0 auto'>
  <div style='background:#07294d;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0'>
    ${mark}
    <div style='font-size:13px;opacity:.85'>${esc(sourceName)}</div>
    <h2 style='margin:4px 0 0 0;font-size:19px'>${esc(heading)}</h2>
  </div>
  <div style='background:#ffffff;border:1px solid #e2e8f0;border-top:0;padding:24px;border-radius:0 0 8px 8px'>
    <p style='margin:0 0 14px 0'>Dear Rtn. {{NAME}},</p>
    ${innerHtml}
    <p style='margin:24px 0 0 0;color:#94a3b8;font-size:12px'>This is an automated message from ${esc(b.productName)}. For further details, please contact your Club / District leadership.</p>
  </div>
</div>`;
}

const row = (label: string, value: string | null | undefined) =>
  !value || !value.trim() ? "" :
    `<tr><td style='padding:6px 12px;border:1px solid #e2e8f0;background:#f8fafc;width:140px;vertical-align:top'>${esc(label)}</td>` +
    `<td style='padding:6px 12px;border:1px solid #e2e8f0;vertical-align:top'>${esc(value)}</td></tr>`;

const linkButton = (url: string, text: string) =>
  !url.trim() ? "" :
    `<p style='margin:16px 0 0 0'><a href='${htmlEncode(url)}' style='background:#1e3a8a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block'>${esc(text)}</a></p>`;

const image = (url: string) =>
  !url.trim() ? "" : `<p style='margin:0 0 16px 0'><img src='${htmlEncode(url)}' alt='' style='max-width:100%;border-radius:6px'/></p>`;

export function buildEventHtml(sourceName: string, title: string, eventDate: string, details: string | null, venue: string | null, regLink: string, imageUrl: string, isReminder = false) {
  const inner =
    `<p style='margin:0 0 14px 0'>You are invited to an upcoming event organized by <strong>${esc(sourceName)}</strong>:</p>` +
    image(imageUrl) +
    "<table style='border-collapse:collapse;width:100%;border:1px solid #e2e8f0'>" +
    row("Event", title) + row("Date", eventDate) + row("Venue", venue) + row("Details", details) +
    "</table>" +
    linkButton(regLink, "Register / More details");
  return shell(sourceName, isReminder ? `Reminder: ${title}` : title, inner);
}

export function buildAnnouncementHtml(sourceName: string, title: string, description: string | null, imageUrl: string, isReminder = false) {
  const inner =
    `<p style='margin:0 0 14px 0'>An announcement from <strong>${esc(sourceName)}</strong>:</p>` +
    image(imageUrl) +
    (!description || !description.trim() ? "" : `<div style='margin:0 0 8px 0'>${esc(description)}</div>`);
  return shell(sourceName, isReminder ? `Reminder: ${title}` : title, inner);
}

function buildNewsletterHtml(sourceName: string, title: string, link: string) {
  const inner =
    `<p style='margin:0 0 14px 0'><strong>${esc(sourceName)}</strong> has published a new newsletter:</p>` +
    `<p style='margin:0 0 8px 0;font-size:16px'><strong>${esc(title)}</strong></p>` +
    linkButton(link, "View / Download newsletter");
  return shell(sourceName, `Newsletter: ${title}`, inner);
}

function buildProjectHtml(sourceName: string, title: string, projectDate: string, areaOfFocus: string | null, cost: string, beneficiaries: string, manHours: string, publicLink: string) {
  const inner =
    `<p style='margin:0 0 14px 0'>A project update from <strong>${esc(sourceName)}</strong>:</p>` +
    "<table style='border-collapse:collapse;width:100%;border:1px solid #e2e8f0'>" +
    row("Project", title) + row("Date", projectDate) + row("Area of Focus", areaOfFocus) +
    row("Project Cost", cost) + row("Direct Beneficiaries", beneficiaries) + row("Man Hours", manHours) +
    "</table>" +
    linkButton(publicLink, "View project");
  return shell(sourceName, `Project: ${title}`, inner);
}

/** A Club Service meeting: only the fields of the Club Service form, plus the primary photo. */
function buildClubServiceHtml(sourceName: string, title: string, meetingDate: string, meetingType: string | null, description: string | null,
  attendance: string | null, agendaUrl: string, minutesUrl: string, photoUrl: string, publicLink: string) {
  const docLink = (label: string, url: string) =>
    !url.trim() ? "" :
      `<tr><td style='padding:6px 12px;border:1px solid #e2e8f0;background:#f8fafc;width:140px;vertical-align:top'>${esc(label)}</td>` +
      `<td style='padding:6px 12px;border:1px solid #e2e8f0;vertical-align:top'><a href='${htmlEncode(url)}' style='color:#1e3a8a'>Download</a></td></tr>`;
  const descRow = !description || !description.trim() ? "" :
    `<tr><td style='padding:6px 12px;border:1px solid #e2e8f0;background:#f8fafc;width:140px;vertical-align:top'>Description</td>` +
    `<td style='padding:6px 12px;border:1px solid #e2e8f0;vertical-align:top;white-space:pre-line'>${esc(description)}</td></tr>`;
  const inner =
    `<p style='margin:0 0 14px 0'>A club meeting from <strong>${esc(sourceName)}</strong>:</p>` +
    image(photoUrl) +
    "<table style='border-collapse:collapse;width:100%;border:1px solid #e2e8f0'>" +
    row("Meeting", title) + row("Date", meetingDate) + row("Meeting Type", meetingType) +
    descRow + row("Attendance", attendance) +
    docLink("Agenda", agendaUrl) + docLink("Minutes of Meeting", minutesUrl) +
    "</table>" +
    linkButton(publicLink, "View Club Service");
  return shell(sourceName, `Club Service: ${title}`, inner);
}

/** The per-recipient greeting. */
export const personalizeGreeting = (html: string, memberName: string) => html.replace(/\{\{NAME\}\}/g, htmlEncode(!memberName.trim() ? "Rotarian" : memberName));

/**
 * Port of EmailScheduledSendBackgroundService.cs: every 10 seconds, emails the
 * announcements, events, newsletters, projects and reminders flagged "send email"
 * whose publish time has passed, to the club / district / RI recipients, then
 * marks them sent and deducts the Email credits.
 */
@Injectable()
export class EmailScheduledSendService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger("EmailScheduledSendBackgroundService");
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly email: EmailService,
    private readonly credits: CreditManagementService,
    private readonly riDirector: RiDirectorService,
    private readonly yearTables: YearTableResolver,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.backgroundJobsEnabled) return;
    this.log.log("EmailScheduledSendBackgroundService started");
    const tick = async () => {
      try {
        await this.announcements();
        await this.upcomingEvents();
        await this.newsletters();
        await this.projects();
        await this.upcomingEventReminders();
        await this.announcementReminders();
      } catch (e) {
        if (isTransientDbBlip(e)) this.log.warn(`Email tick — transient DB connection blip, retrying next tick: ${(e as Error).message}`);
        else this.log.error(`EmailScheduledSend tick failed: ${(e as Error).message}`);
      }
      if (!this.stopped) this.timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };
    void tick();
  }

  onApplicationShutdown() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private get backendUrl() {
    return this.config.get("BackendUrl");
  }

  private recipients(conn: DbCommands, scope: string, rec: Row) {
    return resolveRecipients(conn, "EmailId", scope, Number(rec.ClubId ?? 0), nz(rec.DistrictId) === null ? null : Number(rec.DistrictId),
      str(rec.RecipientTarget), str(rec.RecipientZoneIds), str(rec.RecipientDistrictIds), str(rec.RecipientSubgroupIds));
  }

  async announcements() {
    await this.db.session(async (conn) => {
      const pending = await conn.query(`
        SELECT pk_announcement_id AS Id, fk_club_id AS ClubId, fk_district_id AS DistrictId,
               COALESCE(Scope, IF(fk_district_id IS NOT NULL, 'district', 'club')) AS Scope,
               Title, Description, ImagePath,
               RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds
        FROM announcements
        WHERE IsSendEmail = 1 AND EmailSentDate IS NULL AND isdeleted = 0
          AND PublishDateTime <= NOW()
        LIMIT 20`);
      for (const rec of pending) {
        const id = Number(rec.Id);
        const scope = resolveScope(rec.ClubId, rec.DistrictId, rec.Scope);
        const sourceName = await resolveSourceName(conn, scope, nz(rec.ClubId), nz(rec.DistrictId));
        const recipients = await this.recipients(conn, scope, rec);
        this.log.log(`Email Announcement ${id} scope=${scope} recipients=${recipients.length}`);
        const imgUrl = buildAbsoluteUrl(this.backendUrl, buildMediaPath("announcement", scope, nz(rec.ClubId), nz(rec.DistrictId), str(rec.ImagePath)));
        const title = String(rec.Title ?? "");
        await this.sendBatch(recipients, `Announcement from ${sourceName}: ${title}`, buildAnnouncementHtml(sourceName, title, str(rec.Description), imgUrl), async (sent, failed) => {
          await this.markSent("announcements", "pk_announcement_id", id, sent, failed);
          await this.deductAfterSend(scope, rec.ClubId, rec.DistrictId, sent, "Announcement", id, title);
        }, nz(rec.ClubId), nz(rec.DistrictId));
      }
    });
  }

  async upcomingEvents() {
    await this.db.session(async (conn) => {
      const pending = await conn.query(`
        SELECT pk_upcoming_event_id AS Id, fk_club_id AS ClubId, fk_district_id AS DistrictId,
               COALESCE(Scope, IF(fk_district_id IS NOT NULL, 'district', 'club')) AS Scope,
               Title, Description, ImagePath, EventDate, EventVenue, RegistrationLink,
               RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds
        FROM upcoming_events
        WHERE IsSendEmail = 1 AND EmailSentDate IS NULL AND isdeleted = 0
          AND PublishDate <= NOW()
        LIMIT 20`);
      for (const rec of pending) await this.sendEvent(conn, rec, false);
    });
  }

  /** An event, or (isReminder) one of its reminders: same body, "Reminder" heading and subject. */
  private async sendEvent(conn: DbCommands, rec: Row, isReminder: boolean) {
    const id = Number(rec.Id);
    const scope = resolveScope(rec.ClubId, rec.DistrictId, rec.Scope);
    const sourceName = await resolveSourceName(conn, scope, nz(rec.ClubId), nz(rec.DistrictId));
    const recipients = await this.recipients(conn, scope, rec);
    if (!isReminder) this.log.log(`Email UpcomingEvent ${id} scope=${scope} recipients=${recipients.length}`);
    const imgUrl = buildAbsoluteUrl(this.backendUrl, buildMediaPath("Event", scope, nz(rec.ClubId), nz(rec.DistrictId), str(rec.ImagePath)));
    const link = str(rec.RegistrationLink)?.trim() ? String(rec.RegistrationLink) : "";
    const eventDate = rec.EventDate !== null && rec.EventDate !== undefined ? formatDate(String(rec.EventDate), "dd MMM yyyy, hh:mm tt") : "-";
    const title = String(rec.Title ?? "");
    const subject = isReminder ? `Reminder — Upcoming Event from ${sourceName}: ${title}` : `Upcoming Event from ${sourceName}: ${title}`;
    await this.sendBatch(recipients, subject, buildEventHtml(sourceName, title, eventDate, str(rec.Description), str(rec.EventVenue), link, imgUrl, isReminder), async (sent, failed) => {
      if (isReminder) {
        await this.markSent("upcoming_event_reminders", "pk_reminder_id", id, sent, failed);
        await this.deductAfterSend(scope, rec.ClubId, rec.DistrictId, sent, "UpcomingEventReminder", id, `Reminder for ${title}`);
      } else {
        await this.markSent("upcoming_events", "pk_upcoming_event_id", id, sent, failed);
        await this.deductAfterSend(scope, rec.ClubId, rec.DistrictId, sent, "UpcomingEvent", id, title);
      }
    }, nz(rec.ClubId), nz(rec.DistrictId));
  }

  async newsletters() {
    await this.db.session(async (conn) => {
      const pending = await conn.query(`
        SELECT pk_newsletter_id AS Id, fk_club_id AS ClubId, fk_district_id AS DistrictId,
               COALESCE(Scope, IF(fk_district_id IS NOT NULL, 'district', 'club')) AS Scope,
               Title, AttachmentType, LinkUrl, FilePath,
               RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds
        FROM newsletters
        WHERE IsSendEmail = 1 AND EmailSentDate IS NULL AND isdeleted = 0
          AND PublishDateTime <= NOW()
        LIMIT 20`);
      for (const rec of pending) {
        const id = Number(rec.Id);
        const scope = resolveScope(rec.ClubId, rec.DistrictId, rec.Scope);
        const sourceName = await resolveSourceName(conn, scope, nz(rec.ClubId), nz(rec.DistrictId));
        const recipients = await this.recipients(conn, scope, rec);
        this.log.log(`Email Newsletter ${id} scope=${scope} recipients=${recipients.length}`);
        const link = str(rec.AttachmentType) === "link"
          ? str(rec.LinkUrl) ?? ""
          : buildAbsoluteUrl(this.backendUrl, buildMediaPath("ebulletin", scope, nz(rec.ClubId), nz(rec.DistrictId), str(rec.FilePath)));
        const title = String(rec.Title ?? "");
        await this.sendBatch(recipients, `Newsletter from ${sourceName}: ${title}`, buildNewsletterHtml(sourceName, title, link), async (sent, failed) => {
          await this.markSent("newsletters", "pk_newsletter_id", id, sent, failed);
          await this.deductAfterSend(scope, rec.ClubId, rec.DistrictId, sent, "Newsletter", id, title);
        }, nz(rec.ClubId), nz(rec.DistrictId));
      }
    });
  }

  async projects() {
    await this.db.session(async (conn) => {
      const tables = await this.yearTables.getAllExistingYearTables(conn);
      if (tables.length === 0) return;
      // Year tables can differ in collation, so the UNION normalises its string columns.
      const legs = tables.map((t) =>
        `SELECT p.pk_project_id AS Id, p.fk_club_id AS ClubId, p.fk_district_id AS DistrictId, p.fk_year_id AS YearId,
                CONVERT(p.title USING utf8mb4) COLLATE utf8mb4_general_ci AS Title,
                p.project_date AS ProjectDate,
                p.project_cost AS ProjectCost, p.direct_beneficiaries AS DirectBeneficiaries, p.man_hours AS ManHours,
                CONVERT(af.name USING utf8mb4) COLLATE utf8mb4_general_ci AS AreaOfFocus,
                CONVERT(COALESCE(mm.ModuleKey, '') USING utf8mb4) COLLATE utf8mb4_general_ci AS ModuleKey,
                CONVERT('${t.projectsTable}' USING utf8mb4) COLLATE utf8mb4_general_ci AS YearTable,
                CONVERT('${t.photosTable}' USING utf8mb4) COLLATE utf8mb4_general_ci AS PhotosTable,
                CONVERT('${t.yearLabel}' USING utf8mb4) COLLATE utf8mb4_general_ci AS YearLabel
         FROM \`${t.projectsTable}\` p
         LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
         LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
         WHERE p.send_email = 1 AND p.EmailSentDate IS NULL AND p.isdeleted = 0
           AND (p.approval_status IS NULL OR p.approval_status = 'approved')`).join(" UNION ALL ");
      const pending = await conn.query(`SELECT * FROM (${legs}) u LIMIT 20`);
      const frontendUrl = this.config.get("FrontendUrl") ?? "http://localhost:3000";

      for (const rec of pending) {
        const id = Number(rec.Id);
        const yearTable = String(rec.YearTable);
        const scope = rec.DistrictId !== null && rec.DistrictId !== undefined ? "district" : "club";
        const sourceName = await resolveSourceName(conn, scope, nz(rec.ClubId), nz(rec.DistrictId));
        const recipients = await resolveRecipients(conn, "EmailId", scope, Number(rec.ClubId ?? 0), nz(rec.DistrictId) === null ? null : Number(rec.DistrictId), null, null, null, null);
        this.log.log(`Email Project ${id} scope=${scope} recipients=${recipients.length}`);
        // pk_project_id is unique only within a year table, so the public link carries the year.
        const publicLink = `${frontendUrl}/public/project/${id}?year=${Number(rec.YearId)}`;
        const projectDate = rec.ProjectDate !== null && rec.ProjectDate !== undefined ? formatDate(String(rec.ProjectDate), "dd MMM yyyy") : "-";
        const title = String(rec.Title ?? "");
        const finish = async (sent: number, failed: number) => {
          await this.markSent(yearTable, "pk_project_id", id, sent, failed);
          await this.deductAfterSend(scope, rec.ClubId, rec.DistrictId, sent, "Project", id, title);
        };

        if (scope === "club" && isClubService(str(rec.ModuleKey))) {
          const m = await loadClubServiceMeeting(conn, yearTable, String(rec.PhotosTable), String(rec.YearLabel), id);
          const html = buildClubServiceHtml(sourceName, title, projectDate, m?.meetingType ?? null, m?.description ?? null, m?.attendance ?? null,
            buildAbsoluteUrl(this.backendUrl, m?.agendaDocument), buildAbsoluteUrl(this.backendUrl, m?.minutesDocument),
            buildAbsoluteUrl(this.backendUrl, m?.primaryPhotoPath), publicLink);
          await this.sendBatch(recipients, `Club Service from ${sourceName}: ${title}`, html, finish, nz(rec.ClubId), nz(rec.DistrictId));
          continue;
        }

        const cost = rec.ProjectCost !== null && rec.ProjectCost !== undefined ? formatNumber(Number(rec.ProjectCost), "N0") : "-";
        const ben = rec.DirectBeneficiaries !== null && rec.DirectBeneficiaries !== undefined ? String(rec.DirectBeneficiaries) : "-";
        const mh = rec.ManHours !== null && rec.ManHours !== undefined ? String(rec.ManHours) : "-";
        await this.sendBatch(recipients, `Project from ${sourceName}: ${title}`,
          buildProjectHtml(sourceName, title, projectDate, str(rec.AreaOfFocus), cost, ben, mh, publicLink), finish, nz(rec.ClubId), nz(rec.DistrictId));
      }
    });
  }

  async upcomingEventReminders() {
    await this.db.session(async (conn) => {
      const pending = await conn.query(`
        SELECT r.pk_reminder_id AS Id, r.fk_upcoming_event_id AS EventId,
               e.fk_club_id AS ClubId, e.fk_district_id AS DistrictId, e.Scope,
               e.Title, e.Description, e.ImagePath, e.EventDate, e.EventVenue, e.RegistrationLink,
               e.RecipientTarget, e.RecipientZoneIds, e.RecipientDistrictIds, e.RecipientSubgroupIds
        FROM upcoming_event_reminders r
        JOIN upcoming_events e ON e.pk_upcoming_event_id = r.fk_upcoming_event_id
        WHERE r.IsActive = 1 AND r.EmailSentDate IS NULL
          AND r.ReminderDateTime <= NOW()
          AND e.IsSendEmail = 1 AND e.isdeleted = 0
          AND e.EmailSentDate IS NOT NULL
        LIMIT 20`);
      for (const rec of pending) await this.sendEvent(conn, rec, true);
    });
  }

  async announcementReminders() {
    await this.db.session(async (conn) => {
      const pending = await conn.query(`
        SELECT r.pk_reminder_id AS Id, r.fk_announcement_id AS AnnId,
               a.fk_club_id AS ClubId, a.fk_district_id AS DistrictId, a.Scope,
               a.Title, a.Description, a.ImagePath,
               a.RecipientTarget, a.RecipientZoneIds, a.RecipientDistrictIds, a.RecipientSubgroupIds
        FROM announcement_reminders r
        JOIN announcements a ON a.pk_announcement_id = r.fk_announcement_id
        WHERE r.IsActive = 1 AND r.EmailSentDate IS NULL
          AND r.ReminderDateTime <= NOW()
          AND a.IsSendEmail = 1 AND a.isdeleted = 0
          AND a.EmailSentDate IS NOT NULL
        LIMIT 20`);
      for (const rec of pending) {
        const reminderId = Number(rec.Id);
        const scope = resolveScope(rec.ClubId, rec.DistrictId, rec.Scope);
        const sourceName = await resolveSourceName(conn, scope, nz(rec.ClubId), nz(rec.DistrictId));
        const recipients = await this.recipients(conn, scope, rec);
        const imgUrl = buildAbsoluteUrl(this.backendUrl, buildMediaPath("announcement", scope, nz(rec.ClubId), nz(rec.DistrictId), str(rec.ImagePath)));
        const title = String(rec.Title ?? "");
        await this.sendBatch(recipients, `Reminder — Announcement from ${sourceName}: ${title}`, buildAnnouncementHtml(sourceName, title, str(rec.Description), imgUrl, true), async (sent, failed) => {
          await this.markSent("announcement_reminders", "pk_reminder_id", reminderId, sent, failed);
          await this.deductAfterSend(scope, rec.ClubId, rec.DistrictId, sent, "AnnouncementReminder", reminderId, `Reminder for ${title}`);
        }, nz(rec.ClubId), nz(rec.DistrictId));
      }
    });
  }

  /** Emails every recipient (8 at a time), then reports the counts; zero recipients still completes, so the row is marked. */
  private async sendBatch(recipients: Recipient[], subject: string, html: string, onComplete: (sent: number, failed: number) => Promise<void>, clubId: number | null, districtId: number | null) {
    if (recipients.length === 0) {
      this.log.warn(`Email send skipped: zero recipients for '${subject}'`);
      await onComplete(0, 0);
      return;
    }
    let sent = 0, failed = 0, next = 0;
    const worker = async () => {
      while (next < recipients.length) {
        const r = recipients[next++];
        try {
          await this.email.sendScopedEmail(r.contact, subject, personalizeGreeting(html, r.memberName), clubId, districtId);
          sent++;
        } catch (e) {
          this.log.warn(`Email send failed to ${r.contact}: ${(e as Error).message}`);
          failed++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY_PER_RECORD, recipients.length) }, worker));
    await onComplete(sent, failed);
  }

  private async deductAfterSend(scope: string, clubId: unknown, districtId: unknown, sent: number, source: string, sourceId: number, title: string) {
    if (sent <= 0) return;
    try {
      if (scope === "ri") {
        await this.riDirector.deductCreditWithHistory("Email", sent, source, sourceId, `Email sent for ${title}`, 0);
        return;
      }
      const entityId = districtId !== null && districtId !== undefined ? Number(districtId) : clubId !== null && clubId !== undefined ? Number(clubId) : 0;
      if (entityId <= 0) return;
      await this.credits.deductWithHistory(entityId, "Email", sent, source, sourceId, `Email sent for ${title}`, 0);
    } catch (e) {
      this.log.error(`Failed to deduct ${sent} Email credits for ${source} ${sourceId}: ${(e as Error).message}`);
    }
  }

  private async markSent(table: string, pk: string, id: number, sent: number, failed: number) {
    try {
      await this.db.execute(`UPDATE ${table} SET EmailSentDate = NOW(), EmailSentCount = @S, EmailFailedCount = @F WHERE ${pk} = @Id`, { S: sent, F: failed, Id: id });
    } catch (e) {
      this.log.error(`Failed to mark Email sent for ${table} ${id}: ${(e as Error).message}`);
    }
  }
}
