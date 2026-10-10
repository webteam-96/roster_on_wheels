import { clientIp } from "../../common/http";
import { Body, Controller, Get, HttpStatus, Logger, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { AllowAnonymous, Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField, paramInt, queryInt, queryString, routeInt } from "../../common/binding";
import { UnauthorizedAccessException } from "../../common/exceptions";
import { badRequest, forbid, notFound, ok, statusCode } from "../../common/results";
import { AppConfig } from "../../config/app-config";
import { Db } from "../../database/db.service";
import { ensureClubAdmin } from "../../services/club-admin-access.helper";
import { decryptProjectSyncToken, generateProjectSyncToken, protectCredential, unprotectCredential } from "../../services/rotary-org/project-sync-token";
import { RotaryOrgApiClient } from "../../services/rotary-org/rotary-org-api.client";
import { ClubSyncService } from "../../services/rotary-org/rotary-org-sync.services";
import { YearTableResolver, type YearTableInfo } from "../../services/year-table.resolver";

const isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
const memberIdOf = (u: CurrentUser) => { const v = u.findFirst("memberId") ?? ""; return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0; };

/** Port of RotaryOrgSyncController.cs: Rotary.org connectivity check and the background club bootstrap. */
@Controller("api/admin/rotary-org-sync")
@Authorize()
export class RotaryOrgSyncController {
  private readonly log = new Logger("RotaryOrgSyncController");
  constructor(private readonly client: RotaryOrgApiClient, private readonly sync: ClubSyncService) {}

  @Get("ping")
  async ping(@User() u: CurrentUser) {
    if (!isSuperAdmin(u)) return forbid();
    try {
      let t = Date.now();
      const token = await this.client.getToken();
      const authDurationMs = Date.now() - t;
      t = Date.now();
      const clubs = await this.client.getClubs();
      const fetchDurationMs = Date.now() - t;
      const byDistrict = new Map<number, number>();
      for (const c of clubs) byDistrict.set(c.districtId ?? 0, (byDistrict.get(c.districtId ?? 0) ?? 0) + 1);
      return ok({
        authenticated: !!token, authDurationMs, fetchDurationMs, clubCount: clubs.length, sampleClub: clubs[0] ?? null,
        topDistrictsByClubCount: [...byDistrict].map(([districtId, count]) => ({ districtId, count })).sort((a, b) => b.count - a.count).slice(0, 10),
      });
    } catch (e) {
      this.log.error(`Rotary.org ping failed: ${(e as Error).message}`);
      return statusCode(500, { message: "Ping failed — see server logs for details.", error: (e as Error).message, type: (e as Error).constructor.name });
    }
  }

  @Post("bootstrap")
  async bootstrap(@User() u: CurrentUser) {
    if (!isSuperAdmin(u)) return forbid();
    const logId = await this.sync.startBootstrap(u.findFirst("email") ?? "", u.findFirst("name") ?? "", memberIdOf(u));
    return statusCode(HttpStatus.ACCEPTED, {
      message: `Bootstrap started in the background. Check status with /api/admin/rotary-org-sync/status/{logId}. Report email will arrive when complete (~1 hour).`,
      logId, statusUrl: `/api/admin/rotary-org-sync/status/${logId}`,
    });
  }

  @Get("status/:logId")
  async status(@User() u: CurrentUser, @Param("logId") l: string) {
    const logId = routeInt(l);
    if (!isSuperAdmin(u)) return forbid();
    const s = await this.sync.status(logId);
    return s ? ok(s) : notFound({ message: `No sync log with id ${logId}` });
  }
}

/** Port of RotaryOrgProjectSyncController.cs: hand-off token for publishing a project on Rotary.org, the public confirm, and the SuperAdmin reset. */
@Controller()
export class RotaryOrgProjectSyncController {
  private readonly log = new Logger("RotaryOrgProjectSyncController");
  constructor(private readonly db: Db, private readonly config: AppConfig, private readonly yearTables: YearTableResolver) {}

  @Get("api/rotary-org-sync/token")
  @Authorize()
  async token(@User() u: CurrentUser, @Req() req: Request, @Query("projectId") p?: string, @Query("clubId") c?: string) {
    const projectId = queryInt(p, 0), clubId = queryInt(c, 0);
    if (projectId <= 0 || clubId <= 0) return badRequest({ message: "projectId and clubId are required." });
    const memberId = memberIdOf(u) > 0 ? memberIdOf(u) : null;
    const token = generateProjectSyncToken(this.config, projectId, clubId, memberId);
    await this.logEvent(null, projectId, clubId, "sync_clicked", memberId, req);
    return ok({ token });
  }

  @Post("api/public/rotary-org-sync/confirm")
  @AllowAnonymous()
  async confirm(@Body() body: unknown, @Req() req: Request) {
    const { payload, error } = decryptProjectSyncToken(this.config, String(bodyField(body, "token") ?? ""));
    if (!payload) return badRequest({ message: error ?? "Invalid token." });
    const info = await this.yearTables.findByProjectAndClub(this.db, payload.projectId, payload.clubId);
    if (!info) return notFound({ message: "Project not found." });
    const updated = await this.db.execute(`UPDATE \`${info.projectsTable}\` SET synced_to_org=1, synced_to_org_date=NOW() WHERE pk_project_id=@Pid AND fk_club_id=@Cid AND isdeleted=0`,
      { Pid: payload.projectId, Cid: payload.clubId });
    this.log.log(`RI Flow-Bot sync confirmed: project ${payload.projectId}, club ${payload.clubId}, rows ${updated}`);
    await this.logEvent(info, payload.projectId, payload.clubId, "published", payload.memberId, req);
    return ok({ ok: true, updated });
  }

  @Post("api/rotary-org-sync/reset")
  @Authorize()
  async reset(@User() u: CurrentUser, @Body() body: unknown, @Req() req: Request) {
    if (!isSuperAdmin(u)) return forbid();
    const projectId = Math.trunc(Number(bodyField(body, "projectId")) || 0), clubId = Math.trunc(Number(bodyField(body, "clubId")) || 0);
    if (projectId <= 0 || clubId <= 0) return badRequest({ message: "projectId and clubId are required." });
    const info = await this.yearTables.findByProjectAndClub(this.db, projectId, clubId);
    if (!info) return notFound({ message: "Project not found." });
    const updated = await this.db.execute(`UPDATE \`${info.projectsTable}\` SET synced_to_org=0, synced_to_org_date=NULL WHERE pk_project_id=@Pid AND fk_club_id=@Cid AND isdeleted=0`,
      { Pid: projectId, Cid: clubId });
    await this.logEvent(info, projectId, clubId, "reset", memberIdOf(u) > 0 ? memberIdOf(u) : null, req);
    this.log.log(`RI Flow-Bot sync RESET by member ${u.findFirst("memberId") ?? "?"}: project ${projectId}, club ${clubId}, rows ${updated}`);
    return ok({ ok: true, updated, message: updated > 0 ? "Sync status reset - the club can sync this project again." : "Nothing to reset for this project." });
  }

  /** Best effort: a failed log write never fails the request. */
  private async logEvent(info: YearTableInfo | null, projectId: number, clubId: number, action: string, memberId: number | null, req: Request) {
    try {
      const t = info ?? (await this.yearTables.findByProjectAndClub(this.db, projectId, clubId));
      await this.db.execute(
        `INSERT INTO rotary_org_project_sync_log (fk_project_id, fk_club_id, fk_year_id, projects_table, action, fk_member_id, client_ip)
         VALUES (@Pid, @Cid, @YearId, @Tbl, @Action, @MemberId, @Ip)`,
        { Pid: projectId, Cid: clubId, YearId: t?.yearId ?? null, Tbl: t?.projectsTable ?? null, Action: action, MemberId: memberId, Ip: clientIp(req.ip ?? req.socket.remoteAddress) });
    } catch (e) {
      this.log.warn(`Project sync log write failed: ${action} project ${projectId}, club ${clubId}: ${(e as Error).message}`);
    }
  }
}

/** Port of RotaryOrgProjectSyncLogController.cs: SuperAdmin view of which projects a club sent to Rotary.org, and each one's history. */
@Controller("api/settings/project-sync")
@Authorize()
export class RotaryOrgProjectSyncLogController {
  constructor(private readonly db: Db, private readonly yearTables: YearTableResolver) {}

  @Get("clubs")
  async searchClubs(@User() u: CurrentUser, @Query("q") qq?: string) {
    if (!isSuperAdmin(u)) return forbid();
    const q = queryString(qq) ?? "";
    const words = q.split(" ").map((w) => w.trim()).filter(Boolean);
    if (words.join("").length < 2) return ok([]);
    const p: Record<string, unknown> = { starts: `${q.trim()}%` };
    const where = words.slice(0, 6).map((w, i) => { p[`w${i}`] = `%${w}%`; return `c.ClubName LIKE @w${i}`; });
    return ok(await this.db.query(
      `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.fk_district_id AS districtId, d.DistrictNumber AS districtNumber
       FROM club_master c LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
       WHERE c.isdeleted = 0 AND ${where.join(" AND ")} ORDER BY (c.ClubName LIKE @starts) DESC, c.ClubName LIMIT 20`, p));
  }

  /** Projects that were published or ever logged, each with its status ("Published", "Published (before log)", "Reset", "Pending for publish"), newest activity first. */
  @Get("clubs/:clubId/projects")
  async clubProjects(@User() u: CurrentUser, @Param("clubId") c: string) {
    const clubId = routeInt(c);
    if (!isSuperAdmin(u)) return forbid();
    return this.db.session(async (conn) => {
      const logs = await conn.query(
        `SELECT l.projects_table AS tbl, l.fk_project_id AS projectId, CAST(SUM(l.action = 'sync_clicked') AS SIGNED) AS syncClicks,
                MAX(CASE WHEN l.action = 'sync_clicked' THEN l.created_date END) AS lastSyncClickedAt, MAX(CASE WHEN l.action = 'published' THEN l.created_date END) AS lastPublishedAt,
                MAX(CASE WHEN l.action = 'reset' THEN l.created_date END) AS lastResetAt, CAST(MAX(l.pk_id) AS SIGNED) AS lastLogId
         FROM rotary_org_project_sync_log l WHERE l.fk_club_id = @clubId AND l.projects_table IS NOT NULL GROUP BY l.projects_table, l.fk_project_id`, { clubId });
      const lastIds = logs.map((r) => Number(r.lastLogId));
      const lastAction = new Map(lastIds.length ? (await conn.query("SELECT CAST(pk_id AS SIGNED) AS id, action FROM rotary_org_project_sync_log WHERE pk_id IN @lastIds", { lastIds }))
        .map((r) => [Number(r.id), String(r.action)]) : []);
      const clicker = new Map((await conn.query(
        `SELECT l.projects_table AS tbl, l.fk_project_id AS pid, m.MemberName AS name
         FROM rotary_org_project_sync_log l
         JOIN (SELECT projects_table, fk_project_id, MAX(pk_id) AS id FROM rotary_org_project_sync_log
               WHERE fk_club_id = @clubId AND action = 'sync_clicked' AND projects_table IS NOT NULL GROUP BY projects_table, fk_project_id) x ON x.id = l.pk_id
         LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = l.fk_member_id`, { clubId })).map((r) => [`${r.tbl}|${r.pid}`, r.name as string | null]));
      const out: Record<string, unknown>[] = [];
      for (const t of await this.yearTables.getAllExistingYearTables(conn)) {
        const tableLogs = logs.filter((r) => r.tbl === t.projectsTable);
        const loggedIds = tableLogs.map((r) => Number(r.projectId));
        const projects = await conn.query(
          `SELECT p.pk_project_id AS projectId, p.title AS title, p.project_date AS projectDate, aof.name AS areaOfFocus, p.synced_to_org AS syncedToOrg, p.synced_to_org_date AS syncedToOrgDate
           FROM \`${t.projectsTable}\` p LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
           WHERE p.fk_club_id = @clubId AND p.isdeleted = 0 AND (p.synced_to_org = 1 ${loggedIds.length ? "OR p.pk_project_id IN @loggedIds" : ""})`, { clubId, loggedIds });
        for (const p of projects) {
          const log = tableLogs.find((r) => Number(r.projectId) === Number(p.projectId));
          const synced = p.syncedToOrg === true || Number(p.syncedToOrg) === 1;
          const status = synced ? (log?.lastPublishedAt ? "Published" : "Published (before log)") : log && lastAction.get(Number(log.lastLogId)) === "reset" ? "Reset" : "Pending for publish";
          const candidates = [log?.lastSyncClickedAt, log?.lastPublishedAt, log?.lastResetAt, p.syncedToOrgDate].filter((x): x is string => typeof x === "string");
          out.push({
            projectId: Number(p.projectId), yearId: t.yearId, yearLabel: t.yearLabel, title: p.title, projectDate: p.projectDate, areaOfFocus: p.areaOfFocus, status,
            syncClicks: Number(log?.syncClicks ?? 0), lastSyncClickedAt: log?.lastSyncClickedAt ?? null, lastSyncClickedBy: clicker.get(`${t.projectsTable}|${p.projectId}`) ?? null,
            publishedAt: synced ? (log?.lastPublishedAt ?? p.syncedToOrgDate ?? null) : (log?.lastPublishedAt ?? null), lastResetAt: log?.lastResetAt ?? null,
            lastActivity: candidates.length ? candidates.sort().at(-1) : null,
          });
        }
      }
      return ok(out.sort((a, b) => String(b.lastActivity ?? "").localeCompare(String(a.lastActivity ?? ""))));
    });
  }

  @Get("clubs/:clubId/projects/:projectId/history")
  async history(@User() u: CurrentUser, @Param("clubId") c: string, @Param("projectId") p: string, @Query("yearId") y?: string) {
    const clubId = routeInt(c), projectId = routeInt(p);
    if (!isSuperAdmin(u)) return forbid();
    return ok(await this.db.query(
      `SELECT l.pk_id AS id, l.action, l.created_date AS createdDate, l.fk_member_id AS memberId, m.MemberName AS memberName, l.client_ip AS clientIp
       FROM rotary_org_project_sync_log l LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = l.fk_member_id
       WHERE l.fk_club_id = @clubId AND l.fk_project_id = @projectId AND (@yearId IS NULL OR l.fk_year_id = @yearId) ORDER BY l.pk_id DESC`, { clubId, projectId, yearId: queryInt(y) }));
  }
}

/** Port of ClubRotaryOrgCredentialsController.cs + ClubRotaryOrgCredentialService.cs: a club admin's own Rotary.org login, stored encrypted. */
@Controller("api/clubs/:clubId/rotary-org-credentials")
@Authorize()
export class ClubRotaryOrgCredentialsController {
  constructor(private readonly db: Db, private readonly config: AppConfig) {}

  @Get()
  async get(@User() u: CurrentUser, @Param("clubId") c: string) {
    const clubId = paramInt(c, "clubId");
    try {
      return await this.db.session(async (conn) => {
        await ensureClubAdmin(conn, memberIdOf(u), clubId);
        const row = await conn.queryFirstOrDefault("SELECT RotaryOrgUsernameEncrypted AS u, RotaryOrgPasswordEncrypted AS p, modified_date AS m FROM club_rotary_org_credentials WHERE fk_club_id = @ClubId AND isdeleted = 0 LIMIT 1",
          { ClubId: clubId });
        const none = { hasCredentials: false, username: null, password: null, modifiedDate: null };
        if (!row) return ok(none);
        const username = unprotectCredential(this.config, row.u), password = unprotectCredential(this.config, row.p);
        return username === null || password === null ? ok(none) : ok({ hasCredentials: true, username, password, modifiedDate: row.m ?? null });
      });
    } catch (e) {
      if (e instanceof UnauthorizedAccessException) return statusCode(403, { message: e.message });
      throw e;
    }
  }

  @Put()
  async upsert(@User() u: CurrentUser, @Param("clubId") c: string, @Body() body: unknown) {
    const clubId = paramInt(c, "clubId");
    const username = String(bodyField(body, "username") ?? ""), password = String(bodyField(body, "password") ?? "");
    if (!username.trim() || !password.trim()) return badRequest({ message: "Username and password are both required." });
    try {
      await this.db.session(async (conn) => {
        await ensureClubAdmin(conn, memberIdOf(u), clubId);
        await conn.execute(
          `INSERT INTO club_rotary_org_credentials (fk_club_id, RotaryOrgUsernameEncrypted, RotaryOrgPasswordEncrypted, created_by, created_date)
           VALUES (@ClubId, @Username, @Password, @MemberId, NOW())
           ON DUPLICATE KEY UPDATE RotaryOrgUsernameEncrypted = VALUES(RotaryOrgUsernameEncrypted), RotaryOrgPasswordEncrypted = VALUES(RotaryOrgPasswordEncrypted),
             modified_by = @MemberId, modified_date = NOW(), isdeleted = 0`,
          { ClubId: clubId, Username: protectCredential(this.config, username), Password: protectCredential(this.config, password), MemberId: memberIdOf(u) });
      });
      return ok({ message: "Rotary.org credentials saved." });
    } catch (e) {
      if (e instanceof UnauthorizedAccessException) return statusCode(403, { message: e.message });
      throw e;
    }
  }
}
