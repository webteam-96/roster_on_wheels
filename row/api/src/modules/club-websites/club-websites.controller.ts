import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { Db, type DbCommands } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, content, forbid, notFound, ok } from "../../common/results";
import { bodyField, bodyIntList, dbDateTime, paramInt, queryBool, queryInt, queryString, requireQuery } from "../../common/binding";
import { EmailService } from "../../services/email.service";
import { PleskService } from "../../services/plesk.service";
import { ClubSiteCachePurger } from "../../services/club-site-cache-purger";
import { ClubWebsiteActivationService, logWebsiteAction } from "../../services/club-website-activation.service";
import { YearTableResolver } from "../../services/year-table.resolver";
import { ProjectCountFilter, ProjectCountRules } from "../../services/project-count-rules";
import { IisAppPoolRecycler } from "../../services/iis-app-pool-recycler";
import { checkDnsPointing, resolveWebsiteUrl } from "../../services/website-reachability";
import { generatePayLinkToken } from "../../services/website-pay-link.token";
import { normalizeClientDomain, normalizeSubdomain, validateClientDomain, validateSubdomain } from "../../services/website-domain.helper";
import { seedDefaultClubMenus } from "../../services/club-website-menu.seeder";
import { Brand } from "../../brand/brand";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const str = (body: unknown, k: string) => {
  const v = bodyField(body, k);
  return v === null || v === undefined ? null : String(v);
};
const intOrNull = (body: unknown, k: string) => {
  const v = bodyField(body, k);
  return v === null || v === undefined || v === "" ? null : Math.trunc(Number(v));
};
const decOrNull = (body: unknown, k: string) => {
  const v = bodyField(body, k);
  return v === null || v === undefined || v === "" ? null : Number(v);
};
const notInPlesk = (e: unknown) => /does not exist|error 1013|not found/i.test(message(e));
const LEADERS_SQL = (designations: string) => `
    SELECT m.MemberName AS memberName, m.EmailId AS email, d.designation_name AS designation
    FROM board_of_directors b
    JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
    JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
    WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId AND b.isdeleted = 0
      AND d.designation_name IN (${designations})
      AND m.EmailId IS NOT NULL AND m.EmailId <> ''`;
const BOARD_CONTACT = (designation: string) => `
    SELECT b.fk_club_id AS clubId, MAX(m.MemberName) AS name, MAX(m.PrimaryMobileNumber) AS mobile, MAX(m.EmailId) AS email
    FROM board_of_directors b
    JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
    JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
    WHERE dm.designation_name = '${designation}' AND b.isdeleted = 0
      AND b.fk_year_id = (SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1)
    GROUP BY b.fk_club_id`;

/** The request body of Create / Update (CreateRequest / UpdateRequest). */
function websiteBody(body: unknown) {
  return {
    clubId: intOrNull(body, "clubId") ?? 0,
    subdomain: (str(body, "subdomain") ?? "").trim().toLowerCase(),
    clientDomain: (() => {
      const v = str(body, "clientDomain");
      return v && v.trim() ? v.trim().toLowerCase() : null;
    })(),
    themeId: intOrNull(body, "themeId"),
    startDate: dbDateTime(bodyField(body, "startDate")) ?? "0001-01-01 00:00:00",
    endDate: dbDateTime(bodyField(body, "endDate")) ?? "0001-01-01 00:00:00",
    reminderDays: intOrNull(body, "reminderDays"),
    isPurchased: bodyField(body, "isPurchased") === true,
    amountPaid: decOrNull(body, "amountPaid"),
    transactionId: str(body, "transactionId"),
    paymentDate: dbDateTime(bodyField(body, "paymentDate")),
    paymentMode: str(body, "paymentMode"),
    paymentProofPath: str(body, "paymentProofPath"),
    notes: str(body, "notes"),
  };
}
type WebsiteBody = ReturnType<typeof websiteBody>;

/** Shared validation of Create / Update: template, subdomain, client domain, date order. */
function validateWebsite(b: WebsiteBody): string | null {
  if (b.themeId === null || b.themeId <= 0) return "Template is required.";
  const sub = validateSubdomain(b.subdomain);
  if (sub) return sub;
  const cli = validateClientDomain(b.clientDomain);
  if (cli) return cli;
  if (b.endDate <= b.startDate) return "End date must be after start date.";
  return null;
}

/** Port of ClubWebsitesController.GetClubWebsiteStatus (an absolute route): the club dashboard's website pill. */
@Controller()
@Authorize()
export class ClubWebsiteStatusController {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  @Get("api/clubs/:clubId/website-status")
  async status(@Param("clubId") c: string) {
    const clubId = paramInt(c, "clubId");
    const row = await this.db.queryFirstOrDefault(
      `SELECT w.Subdomain AS subdomain, w.ClientDomain AS clientDomain, w.IsPurchased AS isPurchased,
              w.AmountPaid AS amountPaid, w.TransactionId AS transactionId, DATEDIFF(w.EndDate, CURDATE()) AS daysRemaining
       FROM club_websites w
       WHERE w.fk_club_id = @ClubId AND COALESCE(w.isdeleted, 0) = 0
       ORDER BY w.created_date DESC LIMIT 1`,
      { ClubId: clubId },
    );
    if (!row) return ok({ configured: false, status: "not_configured", daysRemaining: 0, visitUrl: null, isPaid: false });
    const isPaid = row.isPurchased === true || Number(row.isPurchased) === 1 || Number(row.amountPaid ?? 0) > 0 || (typeof row.transactionId === "string" && !!row.transactionId.trim());
    const daysRemaining = Number(row.daysRemaining ?? 0);
    const expired = daysRemaining < 0;
    const status = isPaid ? (expired ? "expired" : "active") : expired ? "trial_expired" : "trial";
    const parent = (await this.db.executeScalar<string>("SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteParentDomain' LIMIT 1")) ?? this.config.get("PleskSettings:ParentDomain") ?? "";
    const visitUrl = await resolveWebsiteUrl(row.clientDomain as string | null, row.subdomain as string | null, parent, (this.config.get("ClubSite:UseHttps") ?? "").toLowerCase() === "true");
    return ok({ configured: true, status, daysRemaining, visitUrl, isPaid });
  }
}

/**
 * Port of ClubWebsitesController.cs: api/admin/club-websites (SuperAdmin) — website
 * records, Plesk provisioning, trials, reminders. The per-club pricing / gateway
 * endpoints (Razorpay Route + GST in RIZones) are ported with the ROW payments work.
 */
@Controller("api/admin/club-websites")
@Authorize()
export class ClubWebsitesController {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly email: EmailService,
    private readonly plesk: PleskService,
    private readonly purger: ClubSiteCachePurger,
    private readonly activation: ClubWebsiteActivationService,
    private readonly years: YearTableResolver,
    private readonly countRules: ProjectCountRules,
    private readonly recycler: IisAppPoolRecycler,
  ) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? u.findFirst("nameid") ?? "0", 10) || 0;
  private get parentDomain() {
    return this.config.get("PleskSettings:ParentDomain") ?? "";
  }
  /** Accepts a label or the full FQDN under the Plesk parent; returns the label. */
  private toLabel(raw: string) {
    let label = raw.trim().toLowerCase();
    const suffix = "." + this.parentDomain.toLowerCase();
    if (label.endsWith(suffix)) label = label.slice(0, -suffix.length);
    return label;
  }
  private currentYearId(conn: DbCommands = this.db) {
    return conn.executeScalar<number>("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
  }

  @Get()
  async list(@Query("status") status: string | undefined, @Query("districtId") d: string | undefined, @Query("search") search: string | undefined, @User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const districtId = queryInt(d, null);
    return this.db.session(async (conn) => {
      // auto-expire (EXISTS guards orphaned rows, which the FK would otherwise reject)
      await conn.execute(
        `UPDATE club_websites w SET Status = 'Expired'
         WHERE Status = 'Active' AND EndDate < CURDATE() AND COALESCE(w.isdeleted, 0) = 0
           AND EXISTS (SELECT 1 FROM club_master c WHERE c.pk_club_id = w.fk_club_id)`,
      );
      const cur = await conn.queryFirstOrDefault("SELECT pk_year_id AS Id, YearLabel FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
      const curYearId = cur ? Number(cur.Id) : 0;
      const curProjects = cur ? this.years.getProjectsTableName(String(cur.YearLabel)) : "";
      const filter = await this.countRules.getFilter(conn);
      const projectCount = curProjects
        ? `(SELECT COUNT(*) FROM \`${curProjects}\` p
             JOIN module_master mm ON mm.pk_module_id = p.fk_module_id AND mm.ModuleKey IN (${ProjectCountFilter.ProjectModuleKeys})
             WHERE p.fk_club_id = c.pk_club_id AND ${filter.countsAsProject(curProjects)})`
        : "0";
      let sql = `
        SELECT w.pk_id AS id, w.fk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId, d.DistrictNumber AS districtNumber,
               w.Subdomain AS subdomain, w.ClientDomain AS clientDomain, w.ClientDomainProvisioned AS clientDomainProvisioned,
               w.ClientDomainVerifiedDate AS clientDomainVerifiedDate, w.fk_theme_id AS themeId, t.theme_name AS themeName,
               w.StartDate AS startDate, w.EndDate AS endDate, w.Status AS status, w.IsPurchased AS isPurchased,
               w.ReminderDays AS reminderDays, w.AmountPaid AS amountPaid, w.TransactionId AS transactionId, w.PaymentDate AS paymentDate,
               w.PaymentMode AS paymentMode, w.PaymentProofPath AS paymentProofPath, w.LastReminderSent AS lastReminderSent, w.Notes AS notes,
               DATEDIFF(w.EndDate, CURDATE()) AS daysLeft, w.created_date AS createdDate,
               pres.name AS presidentName, pres.mobile AS presidentMobile, pres.email AS presidentEmail,
               sec.name AS secretaryName, sec.mobile AS secretaryMobile, sec.email AS secretaryEmail,
               (SELECT COUNT(*) FROM club_website_banner bn
                 WHERE bn.fk_club_id = c.pk_club_id AND bn.fk_year_id = @CurYearId AND bn.is_active = 1 AND COALESCE(bn.isdeleted, 0) = 0) AS bannerCount,
               (SELECT COUNT(*) FROM club_website_advertisement ad
                 WHERE ad.fk_club_id = c.pk_club_id AND ad.fk_year_id = @CurYearId AND ad.is_active = 1 AND COALESCE(ad.isdeleted, 0) = 0) AS advertisementCount,
               ${projectCount} AS projectCount,
               CASE WHEN c.IsActive = 1 AND c.isdeleted = 0 AND d.IsActive = 1 AND d.isdeleted = 0 AND z.IsActive = 1 AND z.isdeleted = 0
                    THEN 1 ELSE 0 END AS chainActive
        FROM club_websites w
        JOIN club_master c ON c.pk_club_id = w.fk_club_id
        LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
        LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
        LEFT JOIN theme_master t ON t.pk_theme_id = w.fk_theme_id
        LEFT JOIN (${BOARD_CONTACT("Club President")}) pres ON pres.clubId = w.fk_club_id
        LEFT JOIN (${BOARD_CONTACT("Club Secretary")}) sec ON sec.clubId = w.fk_club_id
        WHERE COALESCE(w.isdeleted, 0) = 0`;
      const p: Record<string, unknown> = { CurYearId: curYearId };
      if (status) {
        sql += " AND w.Status = @Status";
        p.Status = status;
      }
      if (districtId !== null) {
        sql += " AND c.fk_district_id = @DistrictId";
        p.DistrictId = districtId;
      }
      if (search) {
        sql += " AND (c.ClubName LIKE @S OR w.Subdomain LIKE @S OR w.ClientDomain LIKE @S)";
        p.S = `%${search}%`;
      }
      sql += " ORDER BY (w.Status='Active' AND DATEDIFF(w.EndDate, CURDATE()) <= 30) DESC, w.EndDate ASC";
      return ok(await conn.query(sql, p));
    });
  }

  @Get("available-clubs")
  async availableClubs(@Query("districtId") d: string | undefined, @User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const districtId = queryInt(d, 0);
    if (districtId <= 0) return badRequest({ message: "districtId required" });
    return ok(
      await this.db.query(
        `SELECT c.pk_club_id AS id, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId
         FROM club_master c
         WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1
           AND NOT EXISTS (SELECT 1 FROM club_websites w WHERE w.fk_club_id = c.pk_club_id AND COALESCE(w.isdeleted, 0) = 0)
         ORDER BY c.ClubName`,
        { D: districtId },
      ),
    );
  }

  @Get("club-history")
  async clubHistory(@Query("clubId") c: string | undefined, @User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(
      await this.db.query(
        `SELECT w.pk_id AS id, w.Subdomain AS subdomain, w.StartDate AS startDate, w.EndDate AS endDate, w.Status AS status, w.AmountPaid AS amountPaid
         FROM club_websites w WHERE w.fk_club_id = @ClubId AND COALESCE(w.isdeleted, 0) = 0 ORDER BY w.StartDate DESC`,
        { ClubId: queryInt(c, 0) },
      ),
    );
  }

  @Get("settings")
  async settings(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const days = await this.db.executeScalar<string>("SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteDefaultReminderDays'");
    const parent = await this.db.executeScalar<string>("SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteParentDomain'");
    const n = /^-?\d+$/.test((days ?? "").trim()) ? Number(days) : 15;
    // RIZones fell back to its own club-site domain; ROW falls back to the brand's.
    return ok({ defaultReminderDays: n, parentDomain: parent ?? Brand.Current.domains.clubSiteSuffixes[0] ?? this.parentDomain, serverIp: this.plesk.ServerIp });
  }

  @Post("check-domain-pointing")
  async checkDomainPointing(@Body() body: unknown, @User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const domain = str(body, "domain");
    if (!domain || !domain.trim()) return badRequest({ message: "Domain is required." });
    const r = await checkDnsPointing(domain, this.plesk.ServerIp);
    return ok({ pointsToServer: r.pointsToServer, resolvedIps: r.resolvedIps, expectedIp: r.expectedIp });
  }

  @Get("domain-plesk-status")
  async domainPleskStatus(@Query("domain") domain: string | undefined, @User() u: CurrentUser) {
    requireQuery({ domain });
    if (!this.isSuperAdmin(u)) return forbid();
    if (!domain || !domain.trim()) return badRequest({ message: "domain is required." });
    if (!this.plesk.isConfigured) return ok({ existsInPlesk: false, pleskConfigured: false });
    try {
      return ok({ existsInPlesk: await this.plesk.domainAliasExists(domain), pleskConfigured: true });
    } catch (e) {
      return ok({ existsInPlesk: false, pleskConfigured: true, error: message(e) });
    }
  }

  @Put("settings")
  async updateSettings(@Body() body: unknown, @User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const days = intOrNull(body, "defaultReminderDays") ?? 0;
    if (days < 1 || days > 180) return badRequest({ message: "Default reminder days must be between 1 and 180." });
    const rawParent = str(body, "parentDomain");
    const parent = normalizeClientDomain(rawParent);
    if (rawParent && rawParent.trim()) {
      const err = validateClientDomain(parent, "Parent Domain");
      if (err) return badRequest({ message: err });
    }
    const userId = this.userId(u);
    const upsert = (k: string, v: string | null) =>
      this.db.execute(
        `INSERT INTO system_settings (SettingKey, SettingValue, modified_by) VALUES (@K, @V, @U)
         ON DUPLICATE KEY UPDATE SettingValue = @V, modified_by = @U, modified_date = NOW()`,
        { K: k, V: v, U: userId },
      );
    await upsert("ClubWebsiteDefaultReminderDays", String(days));
    if (rawParent && rawParent.trim()) await upsert("ClubWebsiteParentDomain", parent);
    return ok({ success: true });
  }

  @Post()
  async create(@Body() body: unknown, @User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const b = websiteBody(body);
    if (b.clubId <= 0) return badRequest({ message: "clubId is required." });
    const err = validateWebsite(b);
    if (err) return badRequest({ message: err });
    const userId = this.userId(u);
    return this.db.session(async (conn) => {
      if (!Number(await conn.executeScalar("SELECT COUNT(*) FROM theme_master WHERE pk_theme_id = @Id AND isdeleted = 0", { Id: b.themeId }))) return badRequest({ message: "Selected template does not exist." });
      if (Number(await conn.executeScalar("SELECT COUNT(*) FROM club_websites WHERE Subdomain = @S AND COALESCE(isdeleted, 0) = 0", { S: b.subdomain }))) return badRequest({ message: "Subdomain already in use in portal." });
      const has = await conn.queryFirstOrDefault("SELECT pk_id AS id, Subdomain AS subdomain FROM club_websites WHERE fk_club_id = @C AND COALESCE(isdeleted, 0) = 0 LIMIT 1", { C: b.clubId });
      if (has) return badRequest({ message: `This club already has an active website record (${has.subdomain}). Delete it first before adding a new one.` });
      await conn.execute(
        `INSERT INTO club_websites (fk_club_id, Subdomain, ClientDomain, fk_theme_id, StartDate, EndDate, Status, IsPurchased, ReminderDays, AmountPaid,
             TransactionId, PaymentDate, PaymentMode, PaymentProofPath, Notes, created_by)
         VALUES (@ClubId, @Subdomain, @ClientDomain, @ThemeId, @StartDate, @EndDate, 'Inactive', @IsPurchased, @ReminderDays, @AmountPaid,
             @TransactionId, @PaymentDate, @PaymentMode, @PaymentProofPath, @Notes, @UserId)`,
        {
          ClubId: b.clubId, Subdomain: b.subdomain, ClientDomain: b.clientDomain, ThemeId: b.themeId, StartDate: b.startDate, EndDate: b.endDate, IsPurchased: b.isPurchased ? 1 : 0,
          ReminderDays: b.reminderDays, AmountPaid: b.amountPaid, TransactionId: b.transactionId, PaymentDate: b.paymentDate, PaymentMode: b.paymentMode,
          PaymentProofPath: b.paymentProofPath, Notes: b.notes, UserId: userId,
        },
      );
      const id = Number(await conn.executeScalar("SELECT LAST_INSERT_ID()"));
      await logWebsiteAction(conn, id, "Created", `Website record created for subdomain ${b.subdomain}`, userId);
      await seedDefaultClubMenus(conn, b.clubId, userId);
      this.purger.purgeByClub(b.clubId);
      return ok({ success: true, id });
    });
  }

  @Put(":id")
  async update(@Param("id") i: string, @Body() body: unknown, @User() u: CurrentUser) {
    const id = paramInt(i, "id");
    if (!this.isSuperAdmin(u)) return forbid();
    const b = websiteBody(body);
    const err = validateWebsite(b);
    if (err) return badRequest({ message: err });
    const userId = this.userId(u);
    return this.db.session(async (conn) => {
      if (!Number(await conn.executeScalar("SELECT COUNT(*) FROM theme_master WHERE pk_theme_id = @Id AND isdeleted = 0", { Id: b.themeId }))) return badRequest({ message: "Selected template does not exist." });
      const existing = await conn.queryFirstOrDefault(
        "SELECT Status AS status, Subdomain AS subdomain, ClientDomain AS clientDomain, ClientDomainProvisioned AS clientDomainProvisioned FROM club_websites WHERE pk_id = @Id AND COALESCE(isdeleted, 0) = 0",
        { Id: id },
      );
      if (!existing) return notFound({ message: "Record not found." });
      const status = String(existing.status ?? "");
      const isActivated = status.toLowerCase() !== "inactive";
      // label-to-label: only a genuine label change on an activated site is a rename
      if (isActivated && normalizeSubdomain(existing.subdomain as string | null).toLowerCase() !== normalizeSubdomain(b.subdomain).toLowerCase()) {
        return badRequest({
          message: `Subdomain cannot be changed once the website has been activated (current status: ${status}). To rename: Deactivate → Delete → Add new record with a different subdomain.`,
        });
      }
      const subdomainToStore = isActivated ? String(existing.subdomain) : b.subdomain;
      if (Number(await conn.executeScalar("SELECT COUNT(*) FROM club_websites WHERE Subdomain = @S AND pk_id <> @Id AND COALESCE(isdeleted, 0) = 0", { S: subdomainToStore, Id: id }))) {
        return badRequest({ message: "Subdomain already used by another record." });
      }
      const updated = await conn.execute(
        `UPDATE club_websites SET Subdomain = @Subdomain, ClientDomain = @ClientDomain, fk_theme_id = @ThemeId, StartDate = @StartDate, EndDate = @EndDate,
             IsPurchased = @IsPurchased, ReminderDays = @ReminderDays, AmountPaid = @AmountPaid, TransactionId = @TransactionId,
             PaymentDate = @PaymentDate, PaymentMode = @PaymentMode, PaymentProofPath = @PaymentProofPath, Notes = @Notes, modified_by = @UserId
         WHERE pk_id = @Id AND COALESCE(isdeleted, 0) = 0`,
        {
          Subdomain: subdomainToStore, ClientDomain: b.clientDomain, ThemeId: b.themeId, StartDate: b.startDate, EndDate: b.endDate, IsPurchased: b.isPurchased ? 1 : 0,
          ReminderDays: b.reminderDays, AmountPaid: b.amountPaid, TransactionId: b.transactionId, PaymentDate: b.paymentDate, PaymentMode: b.paymentMode,
          PaymentProofPath: b.paymentProofPath, Notes: b.notes, UserId: userId, Id: id,
        },
      );
      if (!updated) return notFound({ message: "Record not found." });
      await logWebsiteAction(conn, id, "Updated", "Website details updated", userId);
      // A date extension on an Expired site re-enables it (Inactive still needs Activate).
      if (status.toLowerCase() === "expired" && Number(await conn.executeScalar("SELECT DATE(@E) >= CURDATE()", { E: b.endDate })) === 1) {
        await conn.execute("UPDATE club_websites SET Status = 'Active', modified_by = @U WHERE pk_id = @Id AND COALESCE(isdeleted, 0) = 0", { Id: id, U: userId });
        await logWebsiteAction(conn, id, "Reactivated", `End date extended to ${b.endDate.slice(0, 10)} — status Expired → Active`, userId);
      }
      let domainProvisionSteps: string | null = null;
      let domainProvisionError: string | null = null;
      const oldDomain = String(existing.clientDomain ?? "").trim();
      const changed = oldDomain.toLowerCase() !== (b.clientDomain ?? "").toLowerCase();
      const provisioned = Number(existing.clientDomainProvisioned ?? 0) === 1 || existing.clientDomainProvisioned === true;
      if (b.clientDomain && (changed || !provisioned)) {
        if (changed) await conn.execute("UPDATE club_websites SET ClientDomainVerifiedDate = NULL, ClientDomainProvisioned = 0 WHERE pk_id = @Id", { Id: id });
        const dns = await checkDnsPointing(b.clientDomain, this.plesk.ServerIp);
        if (dns.pointsToServer) await conn.execute("UPDATE club_websites SET ClientDomainVerifiedDate = NOW() WHERE pk_id = @Id", { Id: id });
        if (this.plesk.isConfigured && status.toLowerCase() === "active") {
          if (!dns.pointsToServer) {
            domainProvisionError = `Domain does not point to the server yet (found: ${dns.resolvedIps.length ? dns.resolvedIps.join(", ") : "no A record"}). Add an A record to ${this.plesk.ServerIp}, then edit again.`;
          } else {
            const pr = await this.provisionClientDomain(conn, id, normalizeSubdomain(subdomainToStore), b.clientDomain, userId);
            domainProvisionSteps = pr.ok ? pr.steps.join("; ") : null;
            domainProvisionError = pr.ok ? null : pr.error;
          }
        }
      }
      this.purger.purgeHost(b.subdomain);
      if (b.clientDomain) this.purger.purgeHost(b.clientDomain);
      return ok({ success: true, domainProvisionSteps, domainProvisionError });
    });
  }

  /** The third-party domain as a site alias (+ best-effort Let's Encrypt), idempotent; never throws. */
  private async provisionClientDomain(conn: DbCommands, id: number, label: string, clientDomain: string, userId: number) {
    const steps: string[] = [];
    if (!this.plesk.isConfigured) return { ok: false, error: "Plesk is not configured.", steps };
    if (!label.trim()) return { ok: false, error: "Club subdomain label is empty — cannot attach the domain alias.", steps };
    try {
      if (await this.plesk.domainAliasExists(clientDomain)) {
        steps.push(`Domain already an application on the server (${clientDomain}) — reusing`);
        await logWebsiteAction(conn, id, "PleskAliasAlreadyExists", clientDomain, userId);
      } else {
        await this.plesk.addDomainAlias(`${label}.${this.parentDomain.toLowerCase()}`, clientDomain);
        steps.push(`Application added on the server (${clientDomain})`);
        await logWebsiteAction(conn, id, "PleskAliasAdded", clientDomain, userId);
      }
      const le = await this.plesk.tryProvisionLetsEncryptForDomain(clientDomain);
      steps.push(le ? "SSL (Let's Encrypt) issued" : "SSL (Let's Encrypt) not issued yet — retry later");
      await logWebsiteAction(conn, id, le ? "PleskDomainLetsEncrypt" : "PleskDomainLetsEncryptFailed", clientDomain, userId);
      await conn.execute("UPDATE club_websites SET ClientDomainProvisioned = 1, ClientDomainVerifiedDate = NOW(), modified_by = @U WHERE pk_id = @Id", { Id: id, U: userId });
      return { ok: true, error: null, steps };
    } catch (e) {
      await logWebsiteAction(conn, id, "PleskAliasFailed", message(e), userId);
      return { ok: false, error: `Adding the domain application failed: ${message(e)}`, steps };
    }
  }

  @Delete(":id")
  async remove(@Param("id") i: string, @Query("skipPlesk") sp: string | undefined, @User() u: CurrentUser) {
    const id = paramInt(i, "id");
    const skipPlesk = queryBool(sp, false) ?? false;
    if (!this.isSuperAdmin(u)) return forbid();
    const userId = this.userId(u);
    return this.db.session(async (conn) => {
      const website = await conn.queryFirstOrDefault("SELECT pk_id AS id, Subdomain AS subdomain, Status AS status FROM club_websites WHERE pk_id = @Id AND COALESCE(isdeleted, 0) = 0", { Id: id });
      if (!website) return notFound({ message: "Record not found." });
      // Plesk first: the DB row is deleted only when Plesk succeeds, so a failure can be retried.
      let pleskResult: string | null = null;
      if (!skipPlesk && this.plesk.isConfigured) {
        const label = normalizeSubdomain(String(website.subdomain));
        const fullSub = `${label}.${this.parentDomain.toLowerCase()}`;
        try {
          if (!(await this.plesk.subdomainExists(label))) {
            pleskResult = "Not in Plesk — nothing to delete";
            await logWebsiteAction(conn, id, "PleskSubdomainAlreadyGone", `${fullSub} not found in Plesk`, userId);
          } else {
            await this.plesk.deleteSubdomain(label);
            pleskResult = "Plesk subdomain deleted";
            await logWebsiteAction(conn, id, "PleskSubdomainDeleted", fullSub, userId);
          }
        } catch (e) {
          if (notInPlesk(e)) {
            pleskResult = "Not in Plesk — nothing to delete";
            await logWebsiteAction(conn, id, "PleskSubdomainAlreadyGone", message(e), userId);
          } else {
            await logWebsiteAction(conn, id, "PleskSubdomainDeleteFailed", message(e), userId);
            return badRequest({
              message: `Plesk delete failed — portal record preserved. Click Delete again to retry, or use 'Force Clean Plesk' button if the subdomain still exists in Plesk. Error: ${message(e)}`,
              pleskFailed: true,
            });
          }
        }
      } else if (skipPlesk) {
        await logWebsiteAction(conn, id, "PleskDeleteSkippedManual", "Admin chose DB-only delete", userId);
      }
      await conn.execute(
        `UPDATE club_websites SET isdeleted = 1, Subdomain = CONCAT(Subdomain, '__del_', UNIX_TIMESTAMP(), '_', pk_id), modified_by = @U
         WHERE pk_id = @Id AND COALESCE(isdeleted, 0) = 0`,
        { Id: id, U: userId },
      );
      await logWebsiteAction(conn, id, "Deleted", "Record soft-deleted (subdomain freed for re-use)", userId);
      const clubId = Number((await conn.executeScalar("SELECT fk_club_id FROM club_websites WHERE pk_id = @Id", { Id: id })) ?? 0);
      await conn.execute(
        `UPDATE club_website_submenu SET isdeleted = 1, is_active = 0, modified_date = NOW()
         WHERE fk_menu_id IN (SELECT pk_club_website_menu_id FROM club_website_menu WHERE fk_club_id = @ClubId AND isdeleted = 0)`,
        { ClubId: clubId },
      );
      await conn.execute("UPDATE club_website_menu SET isdeleted = 1, is_active = 0, modified_date = NOW() WHERE fk_club_id = @ClubId AND isdeleted = 0", { ClubId: clubId });
      return ok({ success: true, pleskResult });
    });
  }

  private async performActivation(id: number, skipPlesk: boolean, logAction: string, u: CurrentUser) {
    return this.db.session(async (conn) => {
      const r = await this.activation.activate(conn, id, this.userId(u), skipPlesk, logAction);
      if (r.notFound) return notFound({ message: "Record not found." });
      if (r.noSubdomain) return badRequest({ message: "This website has no valid subdomain to provision. Edit the record, set a subdomain, then activate." });
      if (r.activationFailed) return badRequest({ message: `Plesk activation failed: ${r.pleskError}`, pleskStepsDone: r.pleskStepsDone });
      return ok({ success: true, pleskStepsDone: r.pleskStepsDone, pleskError: r.pleskError, emailsSent: r.emailsSent, emailsTotal: r.emailsTotal, skipPlesk: r.skipPlesk });
    });
  }

  @Post("bulk-start-trial")
  async bulkStartTrial(@Body() body: unknown, @User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const ids = bodyIntList(body, "ids");
    const days = intOrNull(body, "days") ?? 0;
    if (!ids.length) return badRequest({ message: "Select at least one club." });
    if (days <= 0 || days > 3650) return badRequest({ message: "Trial period must be between 1 and 3650 days." });
    const userId = this.userId(u);
    return this.db.session(async (conn) => {
      const yearId = await this.currentYearId(conn);
      let [updated, skippedPurchased, notFoundCount, emailsSent, emailsTotal] = [0, 0, 0, 0, 0];
      const skippedNames: string[] = [];
      const cc = Brand.Current.support.internalCc.length ? Brand.Current.support.internalCc.join(",") : null;
      for (const id of [...new Set(ids)]) {
        const row = await conn.queryFirstOrDefault(
          `SELECT w.pk_id AS id, w.fk_club_id AS clubId, c.ClubName AS clubName, w.Subdomain AS subdomain, w.ClientDomain AS clientDomain,
                  w.IsPurchased AS isPurchased, w.AmountPaid AS amountPaid, w.TransactionId AS transactionId
           FROM club_websites w JOIN club_master c ON c.pk_club_id = w.fk_club_id
           WHERE w.pk_id = @Id AND COALESCE(w.isdeleted, 0) = 0`,
          { Id: id },
        );
        if (!row) {
          notFoundCount++;
          continue;
        }
        const purchased = row.isPurchased === true || Number(row.isPurchased) === 1 || Number(row.amountPaid ?? 0) > 0 || (typeof row.transactionId === "string" && !!row.transactionId.trim());
        if (purchased) {
          skippedPurchased++;
          skippedNames.push(String(row.clubName));
          continue;
        }
        const dates = await conn.queryFirstOrDefault("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS S, DATE_FORMAT(CURDATE() + INTERVAL @Days DAY, '%Y-%m-%d') AS E", { Days: days });
        const [start, end] = [String(dates!.S), String(dates!.E)];
        await conn.execute(
          `UPDATE club_websites SET StartDate = @S, EndDate = @E, Status = 'Active', IsPurchased = 0, AmountPaid = NULL, TransactionId = NULL,
               PaymentDate = NULL, PaymentMode = NULL, modified_by = @U, modified_date = NOW()
           WHERE pk_id = @Id AND COALESCE(isdeleted, 0) = 0`,
          { Id: id, S: start, E: end, U: userId },
        );
        await logWebsiteAction(conn, Number(row.id), "TrialStarted", `Trial set to ${days} day(s). End: ${end}`, userId);
        updated++;
        if (yearId !== null && yearId !== undefined) {
          const leaders = await conn.query(LEADERS_SQL("'Club President', 'Club Secretary'"), { ClubId: row.clubId, YearId: yearId });
          emailsTotal += leaders.length;
          for (const l of leaders) {
            try {
              // the activation email already says "active from S to E", which is what a trial start means
              await this.email.sendClubWebsiteActivationEmail(String(l.email), String(l.memberName ?? ""), String(row.clubName), String(l.designation), String(row.subdomain), (row.clientDomain as string | null) ?? null, start, end, cc);
              emailsSent++;
            } catch {
              // logged by the email service
            }
          }
          await logWebsiteAction(conn, Number(row.id), "TrialEmailSent", `Sent to ${leaders.length} leader(s)`, userId);
        }
      }
      return ok({ success: true, updated, skippedPurchased, skippedPurchasedNames: skippedNames, notFound: notFoundCount, emailsSent, emailsTotal });
    });
  }

  @Post("recycle-all-pools")
  async recycleAllPools(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.recycler.recycleAllClubWebsitePools());
  }

  @Get("plesk/diagnostic-subdomain")
  async pleskDiagnosticSubdomain(@Query("label") label: string | undefined, @User() u: CurrentUser) {
    requireQuery({ label });
    if (!this.isSuperAdmin(u)) return forbid();
    if (!this.plesk.isConfigured) return badRequest({ message: "Plesk not configured." });
    if (!label || !label.trim()) return badRequest({ message: "label query param required" });
    try {
      return content(await this.plesk.diagnosticSubdomain(this.toLabel(label)), "text/plain");
    } catch (e) {
      return badRequest({ message: message(e) });
    }
  }

  @Get("plesk/diagnostic")
  async pleskDiagnostic(@Query("type") t: string | undefined, @User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    if (!this.plesk.isConfigured) return badRequest({ message: "Plesk not configured." });
    const type = queryString(t) ?? "list-subdomains";
    try {
      const r = await this.plesk.diagnosticRaw(type);
      return ok({ type, request: r.request, response: r.response });
    } catch (e) {
      return badRequest({ message: message(e) });
    }
  }

  @Get("plesk/list-subdomains")
  async pleskListSubdomains(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    if (!this.plesk.isConfigured) return badRequest({ message: "Plesk is not configured." });
    try {
      const list = await this.plesk.listAllSubdomains();
      return ok({ count: list.length, subdomains: list });
    } catch (e) {
      return badRequest({ message: `List failed: ${message(e)}` });
    }
  }

  @Post("plesk/force-delete-subdomain")
  async pleskForceDelete(@Body() body: unknown, @User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const raw = str(body, "label") ?? "";
    if (!raw.trim()) return badRequest({ message: "label required" });
    if (!this.plesk.isConfigured) return badRequest({ message: "Plesk not configured." });
    const label = this.toLabel(raw);
    try {
      if (!(await this.plesk.subdomainExists(label))) return ok({ success: true, message: `Subdomain '${label}.${this.parentDomain}' does not exist in Plesk — nothing to delete.` });
      await this.plesk.deleteSubdomain(label);
      return ok({ success: true, message: `Deleted '${label}.${this.parentDomain}' from Plesk.` });
    } catch (e) {
      return badRequest({ message: `Force-delete failed: ${message(e)}` });
    }
  }

  @Get("plesk/test-connection")
  async pleskTestConnection(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    if (!this.plesk.isConfigured) return badRequest({ message: "Plesk is not configured. Set PleskSettings.ApiKey in appsettings.json." });
    try {
      await this.plesk.testConnection();
      return ok({ success: true, message: "Plesk connection OK." });
    } catch (e) {
      return badRequest({ message: `Plesk test failed: ${message(e)}` });
    }
  }

  @Get(":id/logs")
  async logs(@Param("id") i: string, @User() u: CurrentUser) {
    const id = paramInt(i, "id");
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(
      await this.db.query(
        `SELECT l.pk_id AS id, l.Action AS action, l.Details AS details, l.PerformedBy AS performedBy, m.MemberName AS performedByName, l.PerformedDate AS performedDate
         FROM club_website_logs l
         LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = l.PerformedBy
         WHERE l.fk_website_id = @Id
         ORDER BY l.PerformedDate DESC`,
        { Id: id },
      ),
    );
  }

  @Post(":id/activate")
  async activate(@Param("id") i: string, @Query("skipPlesk") sp: string | undefined, @User() u: CurrentUser) {
    const id = paramInt(i, "id");
    const skipPlesk = queryBool(sp, false) ?? false;
    if (!this.isSuperAdmin(u)) return forbid();
    return this.performActivation(id, skipPlesk, "Activated", u);
  }

  @Post(":id/retry-activation")
  async retryActivation(@Param("id") i: string, @User() u: CurrentUser) {
    const id = paramInt(i, "id");
    if (!this.isSuperAdmin(u)) return forbid();
    return this.performActivation(id, false, "RetryActivation", u);
  }

  @Post(":id/retry-ssl")
  async retrySsl(@Param("id") i: string, @User() u: CurrentUser) {
    const id = paramInt(i, "id");
    if (!this.isSuperAdmin(u)) return forbid();
    if (!this.plesk.isConfigured) return badRequest({ message: "Plesk not configured." });
    if (!this.plesk.WildcardCertName) return badRequest({ message: "WildcardCertName is not configured in appsettings." });
    const row = await this.db.queryFirstOrDefault("SELECT Subdomain AS subdomain, Status AS status FROM club_websites WHERE pk_id = @Id AND COALESCE(isdeleted, 0) = 0", { Id: id });
    if (!row) return notFound({ message: "Website record not found." });
    const subdomain = String(row.subdomain ?? "").trim().toLowerCase();
    if (!subdomain) return badRequest({ message: "Subdomain is empty." });
    const label = normalizeSubdomain(subdomain);
    const userId = this.userId(u);
    try {
      if (!(await this.plesk.subdomainExists(label))) return badRequest({ message: `Subdomain '${label}.${this.parentDomain}' does not exist in Plesk. Activate it first.` });
      await this.plesk.assignCertificate(label, this.plesk.WildcardCertName);
      const actual = await this.plesk.getSubdomainCert(label);
      await logWebsiteAction(this.db, id, "PleskCertRetried", this.plesk.WildcardCertName, userId);
      return ok({
        success: true,
        message: `Cert '${this.plesk.WildcardCertName}' assigned. Verify: Plesk → ${label}.${this.parentDomain} → Hosting Settings → Certificate.`,
        certificateName: actual,
      });
    } catch (e) {
      await logWebsiteAction(this.db, id, "PleskCertRetryFailed", message(e), userId);
      return badRequest({ message: `Cert assignment failed: ${message(e)}` });
    }
  }

  @Post(":id/deactivate")
  async deactivate(@Param("id") i: string, @User() u: CurrentUser) {
    const id = paramInt(i, "id");
    if (!this.isSuperAdmin(u)) return forbid();
    const userId = this.userId(u);
    const clubId = await this.db.executeScalar<number>("SELECT fk_club_id FROM club_websites WHERE pk_id = @Id AND COALESCE(isdeleted, 0) = 0", { Id: id });
    const updated = await this.db.execute("UPDATE club_websites SET Status = 'Inactive', modified_by = @U WHERE pk_id = @Id AND COALESCE(isdeleted, 0) = 0", { Id: id, U: userId });
    if (!updated) return notFound({ message: "Record not found." });
    await logWebsiteAction(this.db, id, "Deactivated", "Status changed to Inactive", userId);
    if (clubId !== null && clubId !== undefined) this.purger.purgeByClub(Number(clubId));
    return ok({ success: true });
  }

  @Post(":id/send-reminder")
  async sendReminder(@Param("id") i: string, @User() u: CurrentUser) {
    const id = paramInt(i, "id");
    if (!this.isSuperAdmin(u)) return forbid();
    const userId = this.userId(u);
    return this.db.session(async (conn) => {
      const website = await conn.queryFirstOrDefault(
        `SELECT w.pk_id AS id, w.fk_club_id AS clubId, c.ClubName AS clubName, w.Subdomain AS subdomain, w.EndDate AS endDate,
                DATEDIFF(w.EndDate, CURDATE()) AS daysLeft
         FROM club_websites w JOIN club_master c ON c.pk_club_id = w.fk_club_id
         WHERE w.pk_id = @Id AND COALESCE(w.isdeleted, 0) = 0`,
        { Id: id },
      );
      if (!website) return notFound({ message: "Record not found." });
      const yearId = await this.currentYearId(conn);
      if (yearId === null || yearId === undefined) return badRequest({ message: "No current rotary year set." });
      const leaders = await conn.query(LEADERS_SQL("'Club President', 'Club Secretary', 'Club Treasurer'"), { ClubId: website.clubId, YearId: yearId });
      if (!leaders.length) return badRequest({ message: "No President/Secretary with email found for this club+year." });
      const frontend = (this.config.get("FrontendUrl") ?? "").replace(/\/+$/, "");
      const payLink = `${frontend}/pay/club-website/${generatePayLinkToken(this.config, Number(website.clubId), Number(yearId))}`;
      let [sent, failed] = [0, 0];
      for (const l of leaders) {
        try {
          await this.email.sendClubWebsiteReminderEmail(String(l.email), String(l.memberName ?? ""), String(website.clubName), String(l.designation), String(website.subdomain), String(website.endDate), Number(website.daysLeft), payLink);
          sent++;
        } catch {
          failed++;
        }
      }
      await conn.execute("UPDATE club_websites SET LastReminderSent = NOW() WHERE pk_id = @Id", { Id: id });
      await logWebsiteAction(conn, id, "ReminderSent", `Manual reminder — sent: ${sent}, failed: ${failed}`, userId);
      return ok({ success: true, sent, failed });
    });
  }
}

