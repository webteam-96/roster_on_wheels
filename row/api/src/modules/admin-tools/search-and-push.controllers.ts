import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField, queryBool, queryInt, queryString, requireQuery } from "../../common/binding";
import { badRequest, forbid, notFound, ok, statusCode } from "../../common/results";
import { Db } from "../../database/db.service";

/** SuperAdmin by an active role-3 row (the C# IsSuperAdminAsync used by these admin tools). */
export async function isSuperAdminByRole(db: Db, u: CurrentUser) {
  const id = parseInt(u.findFirst("memberId") ?? "0", 10) || 0;
  return Number(await db.executeScalar("SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 3 AND IsActive = 1 AND isdeleted = 0", { MemberId: id })) > 0;
}
const SA_REQUIRED = { message: "SuperAdmin access required." };
const PER_TYPE_LIMIT = 100;

/** Port of GlobalSearchController.cs: SuperAdmin search over zones, districts and clubs. */
@Controller("api/admin/global-search")
@Authorize()
export class GlobalSearchController {
  constructor(private readonly db: Db) {}

  @Get()
  async search(@User() u: CurrentUser, @Query("q") q?: string) {
    requireQuery({ q });
    if (!(await isSuperAdminByRole(this.db, u))) return statusCode(403, SA_REQUIRED);
    const term = (queryString(q) ?? "").trim();
    if (term.length < 2) return ok({ zones: [], districts: [], clubs: [] });
    const p = { Like: `%${term}%`, Limit: PER_TYPE_LIMIT };
    const zones = await this.db.query(
      `SELECT z.pk_zone_id AS id, z.ZoneName AS label, CAST(NULL AS CHAR) AS subLabel, CAST(NULL AS UNSIGNED) AS districtId,
              (SELECT COUNT(*) FROM district_master d WHERE d.fk_zone_id = z.pk_zone_id AND d.IsActive = 1 AND d.isdeleted = 0) AS districtCount,
              (SELECT COUNT(*) FROM club_master c JOIN district_master d2 ON d2.pk_district_id = c.fk_district_id
                WHERE d2.fk_zone_id = z.pk_zone_id AND d2.isdeleted = 0 AND c.IsActive = 1 AND c.isdeleted = 0) AS clubCount,
              (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm
                JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0
                JOIN district_master d3 ON d3.pk_district_id = c2.fk_district_id AND d3.isdeleted = 0
                WHERE d3.fk_zone_id = z.pk_zone_id AND cm.IsActive = 1 AND cm.isdeleted = 0) AS memberCount
       FROM zone_master z WHERE z.ZoneName LIKE @Like AND z.IsActive = 1 AND z.isdeleted = 0 ORDER BY z.ZoneName LIMIT @Limit`, p);
    const latestDw = (col: string) => `(SELECT ${col} FROM district_websites dw WHERE dw.fk_district_id = d.pk_district_id AND COALESCE(dw.isdeleted, 0) = 0 ORDER BY dw.pk_id DESC LIMIT 1)`;
    const districts = await this.db.query(
      `SELECT d.pk_district_id AS id, d.DistrictNumber AS label, COALESCE(z.ZoneName, 'N/A') AS subLabel, CAST(NULL AS UNSIGNED) AS districtId,
              (SELECT COUNT(*) FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.IsActive = 1 AND c.isdeleted = 0) AS clubCount,
              (SELECT COUNT(*) FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.IsActive = 1 AND c.isdeleted = 0 AND COALESCE(c.IsSyncedFromRotaryOrg, 0) = 1) AS syncedClubCount,
              (SELECT COUNT(*) FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.IsActive = 1 AND c.isdeleted = 0 AND COALESCE(c.IsSyncedFromRotaryOrg, 0) = 0) AS nonSyncedClubCount,
              (SELECT COUNT(*) FROM club_members cm
                JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0 AND c2.IsActive = 1
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                WHERE c2.fk_district_id = d.pk_district_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND COALESCE(cm.IsHonoraryMember, 0) = 0) AS memberCount,
              ${latestDw("dw.Subdomain")} AS districtWebsiteSubdomain,
              ${latestDw("dw.ClientDomain")} AS districtWebsiteClientDomain,
              ${latestDw("CASE WHEN dw.Status = 'Active' THEN 'active' WHEN dw.Status IS NOT NULL THEN 'expired' ELSE 'none' END")} AS districtWebsiteStatus
       FROM district_master d LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0
       WHERE d.DistrictNumber LIKE @Like AND d.IsActive = 1 AND d.isdeleted = 0
       ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber LIMIT @Limit`, p);
    const clubs = await this.db.query(
      `SELECT c.pk_club_id AS id, c.ClubName AS label, d.DistrictNumber AS subLabel, c.fk_district_id AS districtId, c.ClubRotaryId AS clubRotaryId,
              COALESCE(c.IsSyncedFromRotaryOrg, 0) AS isSyncedFromRotaryOrg, COALESCE(NULLIF(c.ClubType, ''), 'Rotary Club') AS clubType,
              (SELECT cw.Subdomain FROM club_websites cw WHERE cw.fk_club_id = c.pk_club_id AND COALESCE(cw.isdeleted, 0) = 0 ORDER BY cw.pk_id DESC LIMIT 1) AS clubWebsiteSubdomain,
              (SELECT CASE WHEN cw.Status = 'Active' AND (cw.EndDate IS NULL OR cw.EndDate >= CURDATE()) THEN 'active'
                           WHEN cw.Status = 'Active' AND cw.EndDate < CURDATE() THEN 'expired'
                           WHEN cw.Status IS NOT NULL THEN 'expired' ELSE 'none' END
                 FROM club_websites cw WHERE cw.fk_club_id = c.pk_club_id AND COALESCE(cw.isdeleted, 0) = 0 ORDER BY cw.pk_id DESC LIMIT 1) AS clubWebsiteStatus,
              (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0) AS memberCount
       FROM club_master c LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
       WHERE (c.ClubName LIKE @Like OR c.ClubRotaryId LIKE @Like) AND c.IsActive = 1 AND c.isdeleted = 0
       ORDER BY c.ClubName LIMIT @Limit`, p);
    return ok({ zones, districts, clubs });
  }

  /** Districts sync created without a zone, for the "assign zone" popup. */
  @Get("no-zone-districts")
  async noZoneDistricts(@User() u: CurrentUser) {
    if (!(await isSuperAdminByRole(this.db, u))) return statusCode(403, SA_REQUIRED);
    const districts = await this.db.query(
      `SELECT d.pk_district_id AS id, d.DistrictNumber AS districtNumber, d.Country AS country FROM district_master d
       WHERE (d.fk_zone_id IS NULL OR d.fk_zone_id = 0) AND d.isdeleted = 0 ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber`);
    return ok({ count: districts.length, districts });
  }
}

const PUSH_TABLES: Record<string, { log: string; reminderLog?: string; fk: string; entity: string; pk: string }> = {
  announcement: { log: "announcement_push_log", reminderLog: "announcement_reminder_push_log", fk: "fk_announcement_id", entity: "announcements", pk: "pk_announcement_id" },
  event: { log: "event_push_log", reminderLog: "event_reminder_push_log", fk: "fk_upcoming_event_id", entity: "upcoming_events", pk: "pk_upcoming_event_id" },
  document: { log: "document_push_log", fk: "fk_document_id", entity: "club_documents", pk: "pk_document_id" },
};
const sortKey = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Port of PushLogsController.cs: SuperAdmin push-log viewer and "send now" for stuck items. */
@Controller("api/admin/push-logs")
@Authorize()
export class PushLogsController {
  constructor(private readonly db: Db) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");

  @Get("recent")
  async recent(@User() u: CurrentUser, @Query("type") type?: string, @Query("from") from?: string, @Query("to") to?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    const dt = (v: string | undefined, days: number) => {
      const t = v && !Number.isNaN(Date.parse(v)) ? new Date(v) : new Date(Date.now() + days * 86_400_000);
      return t.toISOString().slice(0, 19).replace("T", " ");
    };
    const p = { F: dt(from, -5), T: dt(to, 1) };
    const t = queryString(type);
    const rows: Record<string, unknown>[] = [];
    const agg = (kind: string, table: string, cfg: (typeof PUSH_TABLES)[string], reminder: boolean) => `
      SELECT '${kind}' AS type, ${reminder ? 1 : 0} AS isReminder, x.${cfg.pk} AS entityId, x.Title AS title, x.fk_club_id AS clubId, x.fk_district_id AS districtId,
             MIN(l.SentAt) AS pushedAt, SUM(CASE WHEN l.Status = 'Sent' THEN 1 ELSE 0 END) AS totalSent,
             SUM(CASE WHEN l.Status = 'Failed' THEN 1 ELSE 0 END) AS totalFailed, COUNT(*) AS totalRecipients${reminder ? ", l.fk_reminder_id AS reminderId" : ""}
      FROM ${table} l JOIN ${cfg.entity} x ON x.${cfg.pk} = l.${cfg.fk}
      WHERE l.created_date BETWEEN @F AND @T
      GROUP BY x.${cfg.pk}, x.Title, x.fk_club_id, x.fk_district_id${reminder ? ", l.fk_reminder_id" : ""}`;
    for (const kind of ["announcement", "event", "document"]) {
      if (t !== null && t !== kind && t !== "all") continue;
      const cfg = PUSH_TABLES[kind];
      rows.push(...(await this.db.query(agg(kind, cfg.log, cfg, false), p)));
      if (cfg.reminderLog) rows.push(...(await this.db.query(agg(kind, cfg.reminderLog, cfg, true), p)));
    }
    // OrderByDescending is stable; nulls (no SentAt) sort last.
    return ok(rows.map((r, i) => [r, i] as const).sort(([a, ia], [b, ib]) => (sortKey(a.pushedAt) < sortKey(b.pushedAt) ? 1 : sortKey(a.pushedAt) > sortKey(b.pushedAt) ? -1 : ia - ib)).map(([r]) => r));
  }

  @Get("recipients")
  async recipients(@User() u: CurrentUser, @Query("type") type?: string, @Query("entityId") e?: string, @Query("isReminder") r?: string, @Query("reminderId") rid?: string) {
    requireQuery({ type });
    if (!this.isSuperAdmin(u)) return forbid();
    const cfg = PUSH_TABLES[queryString(type) ?? ""];
    const isReminder = queryBool(r, false)!;
    const table = cfg ? (isReminder ? cfg.reminderLog : cfg.log) : undefined;
    if (!cfg || !table) return badRequest({ message: "Invalid type" });
    const reminderId = queryInt(rid);
    return ok(await this.db.query(
      `SELECT m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email, l.FcmToken AS fcmToken, l.Status AS status,
              l.FirebaseMessageId AS firebaseMessageId, l.ErrorMessage AS errorMessage, l.SentAt AS sentAt, l.created_date AS createdDate
       FROM ${table} l JOIN member_master_profile m ON m.pk_member_master_profile_id = l.fk_member_master_profile_id
       WHERE l.${cfg.fk} = @Eid${isReminder && reminderId !== null ? " AND l.fk_reminder_id = @Rid" : ""}
       ORDER BY l.created_date DESC`,
      { Eid: queryInt(e, 0), Rid: reminderId },
    ));
  }

  /** Publish time passed but the push flag never set. */
  @Get("stuck")
  async stuck(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const rows = [
      ...(await this.db.query(`SELECT 'announcement' AS type, pk_announcement_id AS entityId, Title AS title, fk_club_id AS clubId, fk_district_id AS districtId, PublishDateTime AS publishDate
        FROM announcements WHERE isdeleted = 0 AND IFNULL(PushNotificationSent, 0) = 0 AND PublishDateTime <= NOW() AND (ExpiryDateTime IS NULL OR ExpiryDateTime > NOW()) AND IFNULL(Scope, '') <> 'ri'`)),
      ...(await this.db.query(`SELECT 'event' AS type, pk_upcoming_event_id AS entityId, Title AS title, fk_club_id AS clubId, fk_district_id AS districtId, PublishDate AS publishDate
        FROM upcoming_events WHERE isdeleted = 0 AND IFNULL(PushNotificationSent, 0) = 0 AND PublishDate <= NOW() AND EventDate > NOW() AND IFNULL(Scope, '') <> 'ri'`)),
      ...(await this.db.query(`SELECT 'document' AS type, pk_document_id AS entityId, Title AS title, fk_club_id AS clubId, fk_district_id AS districtId, PublishDateTime AS publishDate
        FROM club_documents WHERE isdeleted = 0 AND IFNULL(PushNotificationSent, 0) = 0 AND PublishDateTime <= NOW() AND (ExpiryDateTime IS NULL OR ExpiryDateTime > NOW())
          AND IFNULL(Scope, '') <> 'ri' AND IFNULL(Status, 'Unpublished') = 'Published'`)),
    ];
    return ok(rows.map((r, i) => [r, i] as const).sort(([a, ia], [b, ib]) => (sortKey(a.publishDate) < sortKey(b.publishDate) ? -1 : sortKey(a.publishDate) > sortKey(b.publishDate) ? 1 : ia - ib)).map(([r]) => r));
  }

  /** Clears the sent flag so the push worker picks the item up on its next cycle. */
  @Post("send-now")
  async sendNow(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const type = String(bodyField(body, "type") ?? "");
    const entityId = Math.trunc(Number(bodyField(body, "entityId")) || 0);
    if (!type.trim() || entityId <= 0) return badRequest({ message: "type + entityId required" });
    const cfg = PUSH_TABLES[type];
    const affected = cfg
      ? await this.db.execute(`UPDATE ${cfg.entity} SET PushNotificationSent = 0, PushNotificationSentAt = NULL WHERE ${cfg.pk} = @Id AND isdeleted = 0`, { Id: entityId })
      : 0;
    if (affected === 0) return notFound({ message: "Entity not found or already deleted" });
    return ok({ message: "Queued. Push will fire within ~60 seconds.", entityId, type });
  }
}
