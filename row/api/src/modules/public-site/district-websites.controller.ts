import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField, paramInt, queryBool, queryInt, queryString } from "../../common/binding";
import { badRequest, forbid, notFound, ok } from "../../common/results";
import { AppConfig } from "../../config/app-config";
import { Db, type DbCommands } from "../../database/db.service";
import { PleskService } from "../../services/plesk.service";
import { normalizeSubdomain, validateClientDomain, validateSubdomain } from "../../services/website-domain.helper";
import { resolveWebsiteUrl } from "../../services/website-reachability";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const notInPlesk = (e: unknown) => /does not exist|error 1013|not found/i.test(message(e));
const str = (b: unknown, k: string) => { const v = bodyField(b, k); return v === null || v === undefined ? null : String(v); };

// The district's default protected menus (sort = index + 1); "Club Projects" gets one sub-menu per avenue.
const DEFAULT_MENUS: [string, string][] = [["Home", "home"], ["About", "about"], ["District Committee", "district-committee"], ["Club Finder", "club-finder"],
  ["Club Projects", "club-projects"], ["Club Service", "club-service"]];
const PROJECT_SUBMENUS: [string, string][] = [["Community Service", "community_service"], ["Club Service", "club_service"], ["Vocational Service", "vocational_service"],
  ["New Generation Service", "new_generation_service"], ["International Service", "international_service"], ["Public Image Initiative", "public_image_initiative"]];
const NEWSLETTER_SUBMENUS: [string, string][] = [["District Newsletter", "district-newsletter"], ["Club Newsletter", "club-newsletter"]];

const logAction = (conn: DbCommands, websiteId: number, action: string, details: string | null, userId: number) =>
  conn.execute("INSERT INTO district_website_logs (fk_district_website_id, Action, Details, PerformedBy) VALUES (@W, @A, @D, @U)", { W: websiteId, A: action, D: details, U: userId });

/** Seeds (idempotently) the default menus and their system sub-menus for a district site. */
async function seedDefaultDistrictMenus(conn: DbCommands, districtId: number, userId: number) {
  for (const [i, [name, linkValue]] of DEFAULT_MENUS.entries()) {
    const existing = await conn.executeScalar("SELECT pk_club_website_menu_id FROM club_website_menu WHERE fk_district_id = @DistrictId AND fk_club_id = 0 AND menu_name = @Name AND isdeleted = 0 LIMIT 1",
      { DistrictId: districtId, Name: name });
    let menuId: number;
    if (existing !== null && existing !== undefined) {
      menuId = Number(existing);
      await conn.execute("UPDATE club_website_menu SET is_default = 1, link_type = 'page', link_value = @LinkValue, sort_order = @Sort WHERE pk_club_website_menu_id = @Id",
        { Id: menuId, LinkValue: linkValue, Sort: i + 1 });
    } else {
      menuId = Number(await conn.executeScalar(
        `INSERT INTO club_website_menu (fk_club_id, fk_district_id, menu_name, link_type, link_value, sort_order, is_active, is_default, created_by, created_date, isdeleted)
         VALUES (0, @DistrictId, @Name, 'page', @LinkValue, @Sort, 1, 1, @UserId, NOW(), 0); SELECT LAST_INSERT_ID();`,
        { DistrictId: districtId, Name: name, LinkValue: linkValue, Sort: i + 1, UserId: userId }));
    }
    // RIZones quirk kept: no default menu has link "newsletter", so the newsletter sub-menus are never seeded.
    const subs = linkValue === "club-projects" ? PROJECT_SUBMENUS : linkValue === "newsletter" ? NEWSLETTER_SUBMENUS : null;
    if (!subs) continue;
    for (const [j, [subName, subLink]] of subs.entries()) {
      // Keyed on link_value counting deleted rows too: a rename does not duplicate, a delete is not resurrected.
      if (Number(await conn.executeScalar("SELECT COUNT(*) FROM club_website_submenu WHERE fk_menu_id = @MenuId AND link_value = @LinkValue", { MenuId: menuId, LinkValue: subLink })) > 0) continue;
      await conn.execute(
        `INSERT INTO club_website_submenu (fk_menu_id, submenu_name, link_type, link_value, sort_order, is_active, is_system_managed, created_by, isdeleted)
         VALUES (@MenuId, @Name, 'page', @LinkValue, @Sort, 1, 1, @UserId, 0)`, { MenuId: menuId, Name: subName, LinkValue: subLink, Sort: j + 1, UserId: userId });
    }
  }
}

/** Port of DistrictWebsitesController.cs: SuperAdmin management of the (free) district websites, with optional Plesk provisioning. */
@Controller()
@Authorize()
export class DistrictWebsitesController {
  constructor(private readonly db: Db, private readonly plesk: PleskService, private readonly config: AppConfig) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private userId = (u: CurrentUser) => {
    const v = u.findFirst("memberId") ?? u.findFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier") ?? "";
    return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0;
  };
  private get parentDomain() { return this.config.get("PleskSettings:ParentDomain") ?? ""; }

  /** District dashboard pill: configured only when an Active site exists. */
  @Get("api/districts/:districtId/website-status")
  async websiteStatus(@Param("districtId") d: string) {
    const districtId = paramInt(d, "districtId");
    const row = await this.db.queryFirstOrDefault(
      "SELECT Subdomain AS subdomain, ClientDomain AS clientDomain, Status AS status FROM district_websites WHERE fk_district_id = @DistrictId AND isdeleted = 0 ORDER BY created_date DESC LIMIT 1",
      { DistrictId: districtId });
    if (!row || String(row.status ?? "").toLowerCase() !== "active") return ok({ configured: false, status: "not_configured", visitUrl: null });
    const visitUrl = await resolveWebsiteUrl(row.clientDomain, row.subdomain, this.parentDomain, (this.config.get("ClubSite:UseHttps") ?? "").toLowerCase() === "true");
    return ok({ configured: true, status: "active", visitUrl });
  }

  @Get("api/admin/district-websites")
  async list(@User() u: CurrentUser, @Query("status") s?: string, @Query("districtId") d?: string, @Query("search") q?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    const status = queryString(s), districtId = queryInt(d), search = queryString(q);
    return ok(await this.db.query(
      `SELECT w.pk_id AS id, w.fk_district_id AS districtId, d.DistrictNumber AS districtNumber, w.Subdomain AS subdomain, w.ClientDomain AS clientDomain,
              w.Status AS status, w.Notes AS notes, w.created_date AS createdDate,
              CASE WHEN d.IsActive = 1 AND d.isdeleted = 0 AND z.IsActive = 1 AND z.isdeleted = 0 THEN 1 ELSE 0 END AS chainActive
       FROM district_websites w JOIN district_master d ON d.pk_district_id = w.fk_district_id JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE w.isdeleted = 0${status ? " AND w.Status = @Status" : ""}${districtId !== null ? " AND w.fk_district_id = @DistrictId" : ""}
         ${search ? " AND (d.DistrictNumber LIKE @S OR w.Subdomain LIKE @S OR w.ClientDomain LIKE @S)" : ""}
       ORDER BY w.created_date DESC`, { Status: status, DistrictId: districtId, S: `%${search ?? ""}%` }));
  }

  @Get("api/admin/district-websites/available-districts")
  async availableDistricts(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.db.query(
      `SELECT d.pk_district_id AS id, d.DistrictNumber AS districtNumber FROM district_master d
       WHERE d.isdeleted = 0 AND NOT EXISTS (SELECT 1 FROM district_websites w WHERE w.fk_district_id = d.pk_district_id AND w.isdeleted = 0)
       ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber`));
  }

  @Get("api/admin/district-websites/plesk/test-connection")
  async testConnection(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    if (!this.plesk.isConfigured) return badRequest({ message: "Plesk is not configured." });
    try {
      await this.plesk.testConnection();
      return ok({ success: true, message: "Plesk connection OK." });
    } catch (e) {
      return badRequest({ message: `Plesk test failed: ${message(e)}` });
    }
  }

  @Get("api/admin/district-websites/plesk/list-subdomains")
  async listSubdomains(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    if (!this.plesk.isConfigured) return badRequest({ message: "Plesk not configured." });
    try {
      const list = await this.plesk.listAllSubdomains();
      return ok({ count: list.length, subdomains: list.map((x) => ({ name: x.name, id: x.id })) });
    } catch (e) {
      return badRequest({ message: `List failed: ${message(e)}` });
    }
  }

  @Get("api/admin/district-websites/:id/logs")
  async logs(@User() u: CurrentUser, @Param("id") i: string) {
    const id = paramInt(i);
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.db.query(
      `SELECT l.pk_id AS id, l.Action AS action, l.Details AS details, l.PerformedBy AS performedBy, m.MemberName AS performedByName, l.PerformedDate AS performedDate
       FROM district_website_logs l LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = l.PerformedBy
       WHERE l.fk_district_website_id = @Id ORDER BY l.PerformedDate DESC`, { Id: id }));
  }

  /** The subdomain / third-party domain are stored as typed (lower-cased); only presence / length are checked. */
  @Post("api/admin/district-websites")
  async create(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const districtId = Math.trunc(Number(bodyField(body, "districtId")) || 0);
    if (districtId <= 0) return badRequest({ message: "districtId is required." });
    const subdomain = (str(body, "subdomain") ?? "").trim().toLowerCase();
    const subErr = validateSubdomain(subdomain);
    if (subErr) return badRequest({ message: subErr });
    const rawClient = str(body, "clientDomain");
    const clientDomain = rawClient && rawClient.trim() ? rawClient.trim().toLowerCase() : null;
    const cliErr = validateClientDomain(clientDomain);
    if (cliErr) return badRequest({ message: cliErr });
    const userId = this.userId(u);
    return this.db.session(async (conn) => {
      if (Number(await conn.executeScalar("SELECT COUNT(*) FROM district_websites WHERE Subdomain = @S AND isdeleted = 0", { S: subdomain })) > 0)
        return badRequest({ message: "Subdomain already in use in portal." });
      const has = await conn.queryFirstOrDefault("SELECT pk_id AS id, Subdomain AS subdomain FROM district_websites WHERE fk_district_id = @D AND isdeleted = 0 LIMIT 1", { D: districtId });
      if (has) return badRequest({ message: `This district already has an active website record (${has.subdomain}). Delete it first before adding a new one.` });
      const id = Number(await conn.executeScalar(
        `INSERT INTO district_websites (fk_district_id, Subdomain, ClientDomain, Status, Notes, created_by) VALUES (@DistrictId, @Subdomain, @ClientDomain, 'Inactive', @Notes, @UserId);
         SELECT LAST_INSERT_ID();`, { DistrictId: districtId, Subdomain: subdomain, ClientDomain: clientDomain, Notes: str(body, "notes"), UserId: userId }));
      await logAction(conn, id, "Created", `District website record created for subdomain ${subdomain}`, userId);
      await seedDefaultDistrictMenus(conn, districtId, userId);
      return ok({ success: true, id });
    });
  }

  /** Once activated the subdomain label is frozen (Plesk holds a vhost for it); domain and notes stay editable. */
  @Put("api/admin/district-websites/:id")
  async update(@User() u: CurrentUser, @Param("id") i: string, @Body() body: unknown) {
    const id = paramInt(i);
    if (!this.isSuperAdmin(u)) return forbid();
    const subdomain = (str(body, "subdomain") ?? "").trim().toLowerCase();
    const subErr = validateSubdomain(subdomain);
    if (subErr) return badRequest({ message: subErr });
    const rawClient = str(body, "clientDomain");
    const clientDomain = rawClient && rawClient.trim() ? rawClient.trim().toLowerCase() : null;
    const cliErr = validateClientDomain(clientDomain);
    if (cliErr) return badRequest({ message: cliErr });
    const userId = this.userId(u);
    return this.db.session(async (conn) => {
      const existing = await conn.queryFirstOrDefault("SELECT Status AS status, Subdomain AS subdomain FROM district_websites WHERE pk_id = @Id AND isdeleted = 0", { Id: id });
      if (!existing) return notFound({ message: "Record not found." });
      const activated = String(existing.status ?? "").toLowerCase() !== "inactive";
      if (activated && normalizeSubdomain(existing.subdomain).toLowerCase() !== normalizeSubdomain(subdomain).toLowerCase())
        return badRequest({ message: `Subdomain cannot be changed once the website has been activated (current status: ${existing.status}). To rename: Deactivate → Delete → Add new record with a different subdomain.` });
      const toStore = activated ? String(existing.subdomain) : subdomain;
      if (Number(await conn.executeScalar("SELECT COUNT(*) FROM district_websites WHERE Subdomain = @S AND pk_id <> @Id AND isdeleted = 0", { S: toStore, Id: id })) > 0)
        return badRequest({ message: "Subdomain already used by another record." });
      const n = await conn.execute("UPDATE district_websites SET Subdomain = @Subdomain, ClientDomain = @ClientDomain, Notes = @Notes, modified_by = @UserId WHERE pk_id = @Id AND isdeleted = 0",
        { Subdomain: toStore, ClientDomain: clientDomain, Notes: str(body, "notes"), UserId: userId, Id: id });
      if (n === 0) return notFound({ message: "Record not found." });
      await logAction(conn, id, "Updated", "Website details updated", userId);
      return ok({ success: true });
    });
  }

  /** Removes the Plesk subdomain first (a Plesk failure keeps the record), then soft-deletes and frees the subdomain. */
  @Delete("api/admin/district-websites/:id")
  async remove(@User() u: CurrentUser, @Param("id") i: string, @Query("skipPlesk") sp?: string) {
    const id = paramInt(i);
    if (!this.isSuperAdmin(u)) return forbid();
    const skipPlesk = queryBool(sp, false) ?? false;
    const userId = this.userId(u);
    return this.db.session(async (conn) => {
      const w = await conn.queryFirstOrDefault("SELECT pk_id AS id, Subdomain AS subdomain, Status AS status FROM district_websites WHERE pk_id = @Id AND isdeleted = 0", { Id: id });
      if (!w) return notFound({ message: "Record not found." });
      let pleskResult: string | null = null;
      if (!skipPlesk && this.plesk.isConfigured) {
        const label = normalizeSubdomain(w.subdomain);
        const fullSub = `${label}.${this.parentDomain.toLowerCase()}`;
        try {
          if (!(await this.plesk.subdomainExists(label))) {
            pleskResult = "Not in Plesk — nothing to delete";
            await logAction(conn, id, "PleskSubdomainAlreadyGone", `${fullSub} not found in Plesk`, userId);
          } else {
            await this.plesk.deleteSubdomain(label);
            pleskResult = "Plesk subdomain deleted";
            await logAction(conn, id, "PleskSubdomainDeleted", fullSub, userId);
          }
        } catch (e) {
          if (!notInPlesk(e)) {
            await logAction(conn, id, "PleskSubdomainDeleteFailed", message(e), userId);
            return badRequest({ message: `Plesk delete failed — portal record preserved. Click Delete again to retry, or use 'Force Clean Subdomain' from Plesk Tools. Error: ${message(e)}`, pleskFailed: true });
          }
          pleskResult = "Not in Plesk — nothing to delete";
          await logAction(conn, id, "PleskSubdomainAlreadyGone", message(e), userId);
        }
      } else if (skipPlesk) await logAction(conn, id, "PleskDeleteSkippedManual", "Admin chose DB-only delete", userId);
      await conn.execute("UPDATE district_websites SET isdeleted = 1, Subdomain = CONCAT(Subdomain, '__del_', UNIX_TIMESTAMP(), '_', pk_id), modified_by = @U WHERE pk_id = @Id AND isdeleted = 0",
        { Id: id, U: userId });
      await logAction(conn, id, "Deleted", "Record soft-deleted (subdomain freed for re-use)", userId);
      return ok({ success: true, pleskResult });
    });
  }

  @Post("api/admin/district-websites/:id/activate")
  async activate(@User() u: CurrentUser, @Param("id") i: string, @Query("skipPlesk") sp?: string) {
    const id = paramInt(i);
    if (!this.isSuperAdmin(u)) return forbid();
    return this.performActivation(id, queryBool(sp, false) ?? false, "Activated", this.userId(u));
  }

  @Post("api/admin/district-websites/:id/retry-activation")
  async retryActivation(@User() u: CurrentUser, @Param("id") i: string) {
    const id = paramInt(i);
    if (!this.isSuperAdmin(u)) return forbid();
    return this.performActivation(id, false, "RetryActivation", this.userId(u));
  }

  @Post("api/admin/district-websites/:id/retry-ssl")
  async retrySsl(@User() u: CurrentUser, @Param("id") i: string) {
    const id = paramInt(i);
    if (!this.isSuperAdmin(u)) return forbid();
    if (!this.plesk.isConfigured) return badRequest({ message: "Plesk not configured." });
    const cert = this.plesk.WildcardCertName;
    if (!cert || !cert.trim()) return badRequest({ message: "WildcardCertName is not configured in appsettings." });
    const row = await this.db.queryFirstOrDefault("SELECT Subdomain AS subdomain, Status AS status FROM district_websites WHERE pk_id = @Id AND isdeleted = 0", { Id: id });
    if (!row) return notFound({ message: "Website record not found." });
    const subdomain = String(row.subdomain ?? "").trim().toLowerCase();
    if (!subdomain) return badRequest({ message: "Subdomain is empty." });
    const label = normalizeSubdomain(subdomain);
    const userId = this.userId(u);
    try {
      if (!(await this.plesk.subdomainExists(label))) return badRequest({ message: `Subdomain '${label}.${this.parentDomain}' does not exist in Plesk. Activate it first.` });
      await this.plesk.assignCertificate(label, cert);
      const actual = await this.plesk.getSubdomainCert(label);
      await logAction(this.db, id, "PleskCertRetried", cert, userId);
      return ok({ success: true, message: `Cert '${cert}' assigned. Verify: Plesk → ${label}.${this.parentDomain} → Hosting Settings → Certificate.`, certificateName: actual });
    } catch (e) {
      await logAction(this.db, id, "PleskCertRetryFailed", message(e), userId);
      return badRequest({ message: `Cert assignment failed: ${message(e)}` });
    }
  }

  @Post("api/admin/district-websites/plesk/force-delete-subdomain")
  async forceDelete(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const raw = str(body, "label");
    if (!raw || !raw.trim()) return badRequest({ message: "label required" });
    if (!this.plesk.isConfigured) return badRequest({ message: "Plesk not configured." });
    let label = raw.trim().toLowerCase();
    const suffix = "." + this.parentDomain.toLowerCase();
    if (label.endsWith(suffix)) label = label.slice(0, -suffix.length);
    try {
      if (!(await this.plesk.subdomainExists(label))) return ok({ success: true, message: `Subdomain '${label}.${this.parentDomain}' does not exist in Plesk — nothing to delete.` });
      await this.plesk.deleteSubdomain(label);
      return ok({ success: true, message: `Deleted '${label}.${this.parentDomain}' from Plesk.` });
    } catch (e) {
      return badRequest({ message: `Force-delete failed: ${message(e)}` });
    }
  }

  @Post("api/admin/district-websites/:id/deactivate")
  async deactivate(@User() u: CurrentUser, @Param("id") i: string) {
    const id = paramInt(i);
    if (!this.isSuperAdmin(u)) return forbid();
    const userId = this.userId(u);
    const n = await this.db.execute("UPDATE district_websites SET Status = 'Inactive', modified_by = @U WHERE pk_id = @Id AND isdeleted = 0", { Id: id, U: userId });
    if (n === 0) return notFound({ message: "Record not found." });
    await logAction(this.db, id, "Deactivated", "Status changed to Inactive", userId);
    return ok({ success: true });
  }

  /** Provisions the Plesk subdomain (reused when present), alias and wildcard cert, then marks the site Active. */
  private performActivation(id: number, skipPlesk: boolean, action: string, userId: number) {
    return this.db.session(async (conn) => {
      const w = await conn.queryFirstOrDefault(
        `SELECT w.pk_id AS id, w.fk_district_id AS districtId, d.DistrictNumber AS districtNumber, w.Subdomain AS subdomain, w.ClientDomain AS clientDomain, w.Status AS status
         FROM district_websites w JOIN district_master d ON d.pk_district_id = w.fk_district_id WHERE w.pk_id = @Id AND w.isdeleted = 0`, { Id: id });
      if (!w) return notFound({ message: "Record not found." });
      // Always the bare first label, so a stored FQDN does not get the parent domain twice.
      const label = normalizeSubdomain(w.subdomain);
      const parent = this.parentDomain;
      const fullSub = `${label}.${parent.toLowerCase()}`;
      if (!skipPlesk && this.plesk.isConfigured && !label.trim())
        return badRequest({ message: "This website has no valid subdomain to provision. Edit the record, set a subdomain, then activate." });
      const steps: string[] = [];
      let pleskError: string | null = null;
      if (!skipPlesk && this.plesk.isConfigured) {
        const docroot = this.plesk.districtSharedDocroot;
        try {
          if (await this.plesk.subdomainExists(label)) {
            steps.push(`Subdomain already existed (${label}.${parent}) — reusing`);
            await logAction(conn, id, "PleskSubdomainReused", `${label}.${parent} already existed`, userId);
            if (docroot && docroot.trim()) {
              try {
                await this.plesk.setSubdomainDocroot(label, docroot);
              } catch (e) {
                await logAction(conn, id, "PleskDocrootRebindFailed", message(e), userId);
              }
            }
          } else {
            await this.plesk.createSubdomain(label, docroot);
            steps.push(`Subdomain created (${label}.${parent})`);
            await logAction(conn, id, "PleskSubdomainCreated", `${label}.${parent}`, userId);
          }
          if (w.clientDomain && String(w.clientDomain).trim()) {
            try {
              await this.plesk.addDomainAlias(fullSub, String(w.clientDomain));
              steps.push(`Alias added (${w.clientDomain})`);
              await logAction(conn, id, "PleskAliasAdded", String(w.clientDomain), userId);
            } catch (e) {
              await logAction(conn, id, "PleskAliasFailed", message(e), userId);
              pleskError = `Alias failed: ${message(e)}`;
            }
          }
          const cert = this.plesk.WildcardCertName;
          if (cert && cert.trim()) {
            try {
              await this.plesk.assignCertificate(label, cert);
              steps.push(`Wildcard cert assigned (${cert})`);
              await logAction(conn, id, "PleskCertAssigned", cert, userId);
            } catch (e) {
              await logAction(conn, id, "PleskCertFailed", message(e), userId);
            }
          } else await logAction(conn, id, "PleskCertSkipped", "WildcardCertName not configured", userId);
        } catch (e) {
          await logAction(conn, id, "PleskActivationFailed", message(e), userId);
          await conn.execute("UPDATE district_websites SET Status = 'ActivationFailed', modified_by = @U WHERE pk_id = @Id", { Id: id, U: userId });
          return badRequest({ message: `Plesk activation failed: ${message(e)}`, pleskStepsDone: steps });
        }
      } else if (!skipPlesk) await logAction(conn, id, "PleskSkippedNotConfigured", "Plesk not configured — skipped provisioning", userId);
      else await logAction(conn, id, "PleskSkippedManualOverride", "Admin chose manual activation", userId);
      await conn.execute("UPDATE district_websites SET Status = 'Active', modified_by = @U WHERE pk_id = @Id", { Id: id, U: userId });
      await logAction(conn, id, action, "Status set to Active", userId);
      return ok({ success: true, pleskStepsDone: steps, pleskError, skipPlesk });
    });
  }
}
