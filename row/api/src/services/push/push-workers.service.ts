import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { formatDate, msUntilNextHour } from "../../common/dotnet-format";
import { YearTableResolver } from "../year-table.resolver";
import { FirebasePushService } from "./firebase-push.service";
import { reminderTitle, resolveClubDistrictTokens, resolveSourceName, sendLogCleanup, sourceTitle, trimText } from "./push-dispatcher";

const nullableId = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/**
 * Port of the Push/*BackgroundService.cs workers. Every 60 seconds each poller
 * picks up to 5 published items not yet pushed (announcements, upcoming events,
 * documents, newsletters, projects, and the announcement / event reminders),
 * marks them sent first (so a second cycle cannot pick them up) and pushes them
 * to the club's or district's members. While Firebase is not configured nothing
 * is marked, so items wait for it. PushLogCleanup deletes push-log rows older
 * than 5 days at 04:00 brand time.
 */
@Injectable()
export class PushWorkersService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly push: FirebasePushService,
    private readonly yearTables: YearTableResolver,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.backgroundJobsEnabled) return;
    const poll = (name: string, work: () => Promise<void>) => {
      const log = new Logger(name);
      log.log(`${name} started.`);
      const run = async () => {
        try {
          await work();
        } catch (e) {
          log.error(`Error in ${name} loop: ${(e as Error).message}`);
        }
        this.timers.push(setTimeout(() => void run(), 60_000));
      };
      void run();
    };
    poll("AnnouncementPushBackgroundService", () => this.announcements());
    poll("EventPushBackgroundService", () => this.events());
    poll("DocumentPushBackgroundService", () => this.documents());
    poll("NewsletterPushBackgroundService", () => this.newsletters());
    poll("ProjectPushBackgroundService", () => this.projects());
    poll("ReminderPushBackgroundService", async () => {
      await this.announcementReminders();
      await this.eventReminders();
    });
    const scheduleCleanup = () => this.timers.push(setTimeout(() => void this.cleanupLogs().finally(scheduleCleanup), msUntilNextHour(Brand.Current.locale.defaultTimeZone, 4)));
    scheduleCleanup();
  }

  onApplicationShutdown() {
    this.timers.forEach((t) => clearTimeout(t));
  }

  /** Runs `send` for each due row once the row is claimed by `markSql` (no-op while Firebase is unavailable). */
  private async claimAndSend(conn: DbCommands, log: Logger, due: Row[], what: string, markSql: (r: Row) => [string, Record<string, unknown>], send: (r: Row) => Promise<void>) {
    if (due.length === 0) return;
    if (!this.push.isAvailable) {
      if (what) log.warn(`Firebase not available — skipping ${due.length} due ${what}`);
      return;
    }
    for (const r of due) {
      const [sql, params] = markSql(r);
      if ((await conn.execute(sql, params)) === 0) continue;
      try {
        await send(r);
      } catch (e) {
        log.error(`Failed ${what || "reminder"} push ${String(r.Id ?? r.ReminderId)}: ${(e as Error).message}`);
      }
    }
  }

  async announcements() {
    const log = new Logger("AnnouncementPushBackgroundService");
    await this.db.session(async (conn) => {
      const due = await conn.query(`
        SELECT pk_announcement_id AS Id, fk_club_id AS ClubId, fk_district_id AS DistrictId,
               Title, Description
        FROM announcements
        WHERE isdeleted = 0
          AND IFNULL(PushNotificationSent, 0) = 0
          AND PublishDateTime <= NOW()
          AND (ExpiryDateTime IS NULL OR ExpiryDateTime > NOW())
          AND IFNULL(Scope, '') <> 'ri'
        ORDER BY PublishDateTime
        LIMIT 5`);
      await this.claimAndSend(conn, log, due, "announcement(s) this cycle",
        (r) => [`UPDATE announcements SET PushNotificationSent = 1, PushNotificationSentAt = NOW()
                 WHERE pk_announcement_id = @Id AND IFNULL(PushNotificationSent, 0) = 0`, { Id: r.Id }],
        async (r) => {
          const id = Number(r.Id), clubId = Number(r.ClubId), districtId = nullableId(r.DistrictId);
          const tokens = await resolveClubDistrictTokens(conn, clubId, districtId);
          if (tokens.size === 0) {
            log.log(`Announcement ${id}: no FCM tokens to send to`);
            return;
          }
          const source = await resolveSourceName(conn, clubId, districtId);
          const { sent, failed } = await sendLogCleanup(conn, this.push, tokens, sourceTitle("Announcement", source),
            announcementBody(String(r.Title ?? ""), String(r.Description ?? "")),
            { type: "club_announcement", clubId: String(clubId), announcementId: String(id) },
            "announcement_push_log", [["fk_announcement_id", id]]);
          log.log(`Announcement ${id} push: sent=${sent} failed=${failed} totalTokens=${tokens.size}`);
        });
    });
  }

  async events() {
    const log = new Logger("EventPushBackgroundService");
    await this.db.session(async (conn) => {
      // Same-day events still notify after their listed time has passed; past dates do not.
      const due = await conn.query(`
        SELECT pk_upcoming_event_id AS Id, fk_club_id AS ClubId, fk_district_id AS DistrictId,
               Title, Description, EventDate
        FROM upcoming_events
        WHERE isdeleted = 0
          AND IFNULL(PushNotificationSent, 0) = 0
          AND PublishDate <= NOW()
          AND EventDate >= CURDATE()
          AND IFNULL(Scope, '') <> 'ri'
        ORDER BY PublishDate
        LIMIT 5`);
      await this.claimAndSend(conn, log, due, "event(s)",
        (r) => [`UPDATE upcoming_events SET PushNotificationSent = 1, PushNotificationSentAt = NOW()
                 WHERE pk_upcoming_event_id = @Id AND IFNULL(PushNotificationSent, 0) = 0`, { Id: r.Id }],
        (r) => this.sendForEvent(conn, Number(r.Id), Number(r.ClubId), nullableId(r.DistrictId), String(r.Title ?? ""), String(r.Description ?? ""), r.EventDate as string | null, null));
    });
  }

  /** EventPushBackgroundService.SendForEventAsync, shared with the event reminders. */
  private async sendForEvent(conn: DbCommands, eventId: number, clubId: number, districtId: number | null, title: string, description: string, eventDate: string | null, reminderId: number | null) {
    const tokens = await resolveClubDistrictTokens(conn, clubId, districtId);
    if (tokens.size === 0) return;
    const source = await resolveSourceName(conn, clubId, districtId);
    const pushTitle = reminderId !== null ? reminderTitle(source) : sourceTitle("Event", source);
    const pushBody = (!title.trim() ? trimText(description, 180) : title) + (eventDate ? ` · ${formatDate(eventDate, "dd MMM yyyy")}` : "");
    const data = { type: "club_upcoming_event", clubId: String(clubId), eventId: String(eventId) };
    if (reminderId !== null)
      await sendLogCleanup(conn, this.push, tokens, pushTitle, pushBody, data, "event_reminder_push_log", [["fk_reminder_id", reminderId], ["fk_upcoming_event_id", eventId]]);
    else
      await sendLogCleanup(conn, this.push, tokens, pushTitle, pushBody, data, "event_push_log", [["fk_upcoming_event_id", eventId]]);
  }

  async documents() {
    const log = new Logger("DocumentPushBackgroundService");
    await this.db.session(async (conn) => {
      const due = await conn.query(`
        SELECT pk_document_id AS Id, fk_club_id AS ClubId, fk_district_id AS DistrictId, Title
        FROM club_documents
        WHERE isdeleted = 0
          AND IFNULL(PushNotificationSent, 0) = 0
          AND PublishDateTime <= NOW()
          AND (ExpiryDateTime IS NULL OR ExpiryDateTime > NOW())
          AND IFNULL(Scope, '') <> 'ri'
          AND IFNULL(Status, 'Unpublished') = 'Published'
        ORDER BY PublishDateTime
        LIMIT 5`);
      await this.claimAndSend(conn, log, due, "document(s)",
        (r) => [`UPDATE club_documents
                 SET PushNotificationSent = 1, PushNotificationSentAt = NOW()
                 WHERE pk_document_id = @Id AND IFNULL(PushNotificationSent, 0) = 0`, { Id: r.Id }],
        async (r) => {
          const id = Number(r.Id), clubId = Number(r.ClubId), districtId = nullableId(r.DistrictId);
          // Unlike the other pushes, documents still skip members whose last app action was a logout.
          const tokens = await resolveClubDistrictTokens(conn, clubId, districtId,
            "\n      AND (m.LastMobileLogout IS NULL OR m.LastMobileVisit IS NULL OR m.LastMobileVisit > m.LastMobileLogout)");
          if (tokens.size === 0) return;
          await sendLogCleanup(conn, this.push, tokens, String(r.Title ?? ""), "New document published",
            { type: "document", documentId: String(id), scope: districtId !== null ? "district" : "club", scopeId: String(districtId ?? clubId), isReminder: "false" },
            "document_push_log", [["fk_document_id", id]]);
        });
    });
  }

  async newsletters() {
    const log = new Logger("NewsletterPushBackgroundService");
    await this.db.session(async (conn) => {
      const due = await conn.query(`
        SELECT pk_newsletter_id AS Id, fk_club_id AS ClubId, fk_district_id AS DistrictId, Title
        FROM newsletters
        WHERE isdeleted = 0
          AND IFNULL(PushNotificationSent, 0) = 0
          AND PublishDateTime <= NOW()
          AND IFNULL(Scope, '') <> 'ri'
        ORDER BY PublishDateTime
        LIMIT 5`);
      await this.claimAndSend(conn, log, due, "newsletter(s)",
        (r) => [`UPDATE newsletters SET PushNotificationSent = 1, PushNotificationSentAt = NOW()
                 WHERE pk_newsletter_id = @Id AND IFNULL(PushNotificationSent, 0) = 0`, { Id: r.Id }],
        async (r) => {
          const id = Number(r.Id), clubId = Number(r.ClubId), districtId = nullableId(r.DistrictId);
          const tokens = await resolveClubDistrictTokens(conn, clubId, districtId);
          if (tokens.size === 0) {
            log.log(`Newsletter ${id}: no FCM tokens`);
            return;
          }
          const source = await resolveSourceName(conn, clubId, districtId);
          const title = String(r.Title ?? "");
          const { sent, failed } = await sendLogCleanup(conn, this.push, tokens, sourceTitle("Newsletter", source),
            !title.trim() ? "A new newsletter has been published." : title,
            { type: "club_newsletter", clubId: String(clubId), newsletterId: String(id) },
            "newsletter_push_log", [["fk_newsletter_id", id]]);
          log.log(`Newsletter ${id} push: sent=${sent} failed=${failed} totalTokens=${tokens.size}`);
        });
    });
  }

  async projects() {
    const log = new Logger("ProjectPushBackgroundService");
    await this.db.session(async (conn) => {
      const tables = await this.yearTables.getAllExistingYearTables(conn);
      if (tables.length === 0) return;
      // Year tables can differ in collation, so the UNION normalises its string columns. No approval gate (push on creation).
      const legs = tables.map((t) =>
        `SELECT p.pk_project_id AS Id, p.fk_club_id AS ClubId, p.fk_district_id AS DistrictId,
                CONVERT(p.title USING utf8mb4) COLLATE utf8mb4_general_ci AS Title,
                CONVERT(COALESCE(md.ModuleKey, '') USING utf8mb4) COLLATE utf8mb4_general_ci AS ModuleKey,
                CONVERT(COALESCE(md.ModuleName, '') USING utf8mb4) COLLATE utf8mb4_general_ci AS ModuleName,
                ${t.yearId} AS YearId,
                CONVERT('${t.projectsTable}' USING utf8mb4) COLLATE utf8mb4_general_ci AS YearTable
         FROM \`${t.projectsTable}\` p
         LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
         WHERE IFNULL(p.PushNotificationSent, 0) = 0 AND p.isdeleted = 0`).join(" UNION ALL ");
      const due = await conn.query(`SELECT * FROM (${legs}) u LIMIT 5`);
      await this.claimAndSend(conn, log, due, "project(s)",
        // The claim is made on the project's own year table.
        (r) => [`UPDATE \`${String(r.YearTable)}\` SET PushNotificationSent = 1, PushNotificationSentAt = NOW() WHERE pk_project_id = @Id AND IFNULL(PushNotificationSent, 0) = 0`, { Id: r.Id }],
        async (r) => {
          const id = Number(r.Id), yearId = Number(r.YearId), clubId = Number(r.ClubId), districtId = nullableId(r.DistrictId);
          const tokens = await resolveClubDistrictTokens(conn, clubId, districtId);
          if (tokens.size === 0) {
            log.log(`Project ${id}: no FCM tokens`);
            return;
          }
          const source = await resolveSourceName(conn, clubId, districtId);
          const moduleName = String(r.ModuleName ?? ""), moduleKey = String(r.ModuleKey ?? ""), title = String(r.Title ?? "");
          // The title names the project type (module), e.g. "New Community Service · <club>".
          const { sent, failed } = await sendLogCleanup(conn, this.push, tokens, sourceTitle(!moduleName.trim() ? "Project" : moduleName, source),
            !title.trim() ? "A new project has been added." : title,
            { type: `club_project_${!moduleKey.trim() ? "community_service" : moduleKey}`, clubId: String(clubId), projectId: String(id), yearId: String(yearId) },
            "project_push_log", [["fk_project_id", id], ["fk_year_id", yearId]]);
          log.log(`Project ${id} push: sent=${sent} failed=${failed} totalTokens=${tokens.size}`);
        });
    });
  }

  async announcementReminders() {
    const log = new Logger("ReminderPushBackgroundService");
    await this.db.session(async (conn) => {
      const due = await conn.query(`
        SELECT r.pk_reminder_id AS ReminderId, r.fk_announcement_id AS AnnouncementId, r.ReminderDateTime,
               a.fk_club_id AS ClubId, a.fk_district_id AS DistrictId, a.Title, a.Description
        FROM announcement_reminders r
        JOIN announcements a ON a.pk_announcement_id = r.fk_announcement_id
                              AND a.isdeleted = 0
                              AND IFNULL(a.Scope, '') <> 'ri'
        WHERE r.IsActive = 1
          AND r.PushSentAt IS NULL
          AND r.ReminderDateTime <= NOW()
          AND r.ReminderDateTime > DATE_SUB(NOW(), INTERVAL 24 HOUR)
        ORDER BY r.ReminderDateTime
        LIMIT 5`);
      await this.claimAndSend(conn, log, due, "",
        (r) => [`UPDATE announcement_reminders SET PushSentAt = NOW()
                 WHERE pk_reminder_id = @Id AND PushSentAt IS NULL`, { Id: r.ReminderId }],
        async (r) => {
          const reminderId = Number(r.ReminderId), announcementId = Number(r.AnnouncementId), clubId = Number(r.ClubId), districtId = nullableId(r.DistrictId);
          const tokens = await resolveClubDistrictTokens(conn, clubId, districtId);
          if (tokens.size === 0) return;
          const source = await resolveSourceName(conn, clubId, districtId);
          await sendLogCleanup(conn, this.push, tokens, reminderTitle(source), announcementBody(String(r.Title ?? ""), String(r.Description ?? "")),
            { type: "club_announcement", clubId: String(clubId), announcementId: String(announcementId) },
            "announcement_reminder_push_log", [["fk_reminder_id", reminderId], ["fk_announcement_id", announcementId]]);
        });
    });
  }

  async eventReminders() {
    const log = new Logger("ReminderPushBackgroundService");
    await this.db.session(async (conn) => {
      const due = await conn.query(`
        SELECT r.pk_reminder_id AS ReminderId, r.fk_upcoming_event_id AS EventId, r.ReminderDateTime,
               e.fk_club_id AS ClubId, e.fk_district_id AS DistrictId, e.Title, e.Description, e.EventDate
        FROM upcoming_event_reminders r
        JOIN upcoming_events e ON e.pk_upcoming_event_id = r.fk_upcoming_event_id
                              AND e.isdeleted = 0
                              AND IFNULL(e.Scope, '') <> 'ri'
        WHERE r.IsActive = 1
          AND r.PushSentAt IS NULL
          AND r.ReminderDateTime <= NOW()
          AND r.ReminderDateTime > DATE_SUB(NOW(), INTERVAL 24 HOUR)
        ORDER BY r.ReminderDateTime
        LIMIT 5`);
      await this.claimAndSend(conn, log, due, "",
        (r) => [`UPDATE upcoming_event_reminders SET PushSentAt = NOW()
                 WHERE pk_reminder_id = @Id AND PushSentAt IS NULL`, { Id: r.ReminderId }],
        (r) => this.sendForEvent(conn, Number(r.EventId), Number(r.ClubId), nullableId(r.DistrictId), String(r.Title ?? ""), String(r.Description ?? ""), r.EventDate as string | null, Number(r.ReminderId)));
    });
  }

  async cleanupLogs() {
    const log = new Logger("PushLogCleanupBackgroundService");
    try {
      let total = 0;
      for (const table of ["announcement_push_log", "announcement_reminder_push_log", "event_push_log", "event_reminder_push_log", "document_push_log"]) {
        const deleted = await this.db.execute(`DELETE FROM ${table} WHERE created_date < DATE_SUB(NOW(), INTERVAL 5 DAY)`);
        total += deleted;
        log.log(`[PushLogCleanup] ${table}: deleted ${deleted} rows older than 5 days`);
      }
      log.log(`[PushLogCleanup] total rows deleted across all tables: ${total}`);
    } catch (e) {
      log.error(`[PushLogCleanup] cleanup FAILED: ${(e as Error).message}`);
    }
  }
}

/** The announcement push body: the headline, plus the description trimmed to 160 characters. */
export function announcementBody(headline: string, description: string) {
  return !description.trim() ? headline : `${headline} — ${trimText(description, 160)}`;
}
