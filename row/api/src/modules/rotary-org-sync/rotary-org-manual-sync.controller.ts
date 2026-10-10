import { Body, Controller, Delete, Get, Logger, Param, Post, Put, Query } from "@nestjs/common";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField, dbDateTime, queryInt, queryString, routeInt } from "../../common/binding";
import { nowIn } from "../../common/dotnet-format";
import { badRequest, conflict, file, forbid, notFound, ok, statusCode } from "../../common/results";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { Db, type DbCommands } from "../../database/db.service";
import { cogClubId } from "../../services/cog-designation.helper";
import { RotaryOrgApiClient, profileContacts, type RotaryOrgClubMember, type RotaryOrgIndividualProfile } from "../../services/rotary-org/rotary-org-api.client";
import { buildMeetingAddress, ClubCacheRefreshService, normalizeMeetingDay, sqlUtc } from "../../services/rotary-org/rotary-org-sync.services";
import { ExcelJS, fitColumns, toBuffer, XLSX_CONTENT_TYPE } from "../../services/xlsx";
import { ClubService } from "../clubs/clubs.service";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const str = (b: unknown, k: string) => { const v = bodyField(b, k); return v === null || v === undefined ? null : String(v); };
const int = (b: unknown, k: string) => { const n = Number(bodyField(b, k)); return Number.isFinite(n) ? Math.trunc(n) : 0; };
/** C# DateTime.SpecifyKind(…, Utc): cache times are stored UTC, so they go out with a "Z". */
const utcZ = (v: unknown) => (typeof v === "string" ? (/Z$/.test(v) ? v : `${v}Z`) : v ?? null);
const today = () => nowIn(Brand.Current.locale.defaultTimeZone).slice(0, 10);

/** Rotary.org sends DOB as US "MM/dd/yyyy"; anything else is read as an invariant date. → "yyyy-MM-dd" or null. */
export function parseRotaryDob(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const t = raw.trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const d = Date.parse(t);
  return Number.isNaN(d) ? null : new Date(d).toISOString().slice(0, 10);
}

/** 18–40 years old on the brand's today (or Rotary.org's youth flag). */
export function isYouthAge(dob: string | null, flag: boolean | null, todayIso: string): number {
  if (flag === true) return 1;
  if (!dob) return 0;
  const [y, m, d] = dob.split("-").map(Number), [ty, tm, td] = todayIso.split("-").map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age--;
  return age >= 18 && age <= 40 ? 1 : 0;
}

/**
 * Port of RotaryOrgManualSyncController.cs: SuperAdmin compares clubs and members with Rotary.org and adds / edits /
 * deletes them one by one (soft deletes), reviews sync exceptions, and starts the member-sweep worker.
 * JSON keys keep their RIZones names (indiaClubs, onlyIndia, rotaryIndia …) for the existing admin screens.
 */
@Controller("api/admin/rotary-org-manual-sync")
@Authorize()
export class RotaryOrgManualSyncController {
  private readonly log = new Logger("RotaryOrgManualSyncController");
  constructor(private readonly db: Db, private readonly api: RotaryOrgApiClient, private readonly config: AppConfig, private readonly clubs: ClubService,
              private readonly cacheRefresh: ClubCacheRefreshService) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private userId = (u: CurrentUser) => { const v = u.findFirst("memberId") ?? ""; return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0; };
  /** Exempt districts (never counted as sync / non-sync) and the placeholder catch-all zone. */
  private get scope() { return { Exempt: Brand.Current.scope.exemptDistricts, Zone0: this.config.get("RotaryOrgSync:PlaceholderZoneName") ?? "Zone 0" }; }

  /** Frees a reused number from SOFT-DELETED profiles (Primary → Secondary when empty) so it does not trip UNIQUE(PrimaryMobileNumber). */
  private static releaseSoftDeletedMobile(conn: DbCommands, mobile: string | null | undefined, excludeId = 0) {
    if (!mobile || !mobile.trim()) return Promise.resolve(0);
    return conn.execute(
      `UPDATE member_master_profile
       SET SecondaryMobileNumber = CASE WHEN SecondaryMobileNumber IS NULL OR SecondaryMobileNumber = '' THEN PrimaryMobileNumber ELSE SecondaryMobileNumber END,
           PrimaryMobileNumber = NULL, modified_date = NOW()
       WHERE TRIM(PrimaryMobileNumber) = TRIM(@Mobile) AND isdeleted = 1 AND pk_member_master_profile_id <> @ExcludeId`, { Mobile: mobile.trim(), ExcludeId: excludeId });
  }

  // ──────────────────────────────── Club sync ────────────────────────────────

  /** A district's clubs side by side with the Rotary.org cache (matched by ClubRotaryId). */
  @Get("clubs/compare")
  async compareClubs(@User() u: CurrentUser, @Query("districtId") d?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    const districtId = queryInt(d, 0);
    if (districtId <= 0) return badRequest({ message: "districtId required" });
    return this.db.session(async (conn) => {
      const districtNumber = await conn.executeScalar<string>("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id AND isdeleted = 0", { Id: districtId });
      if (!districtNumber) return notFound({ message: "District not found" });
      const indiaClubs = await conn.query(
        `SELECT cm.pk_club_id AS clubId, cm.ClubRotaryId AS clubRotaryId, cm.ClubName AS clubName, cm.MeetingAddress AS meetingAddress, cm.MeetingDay AS meetingDay,
                IFNULL(cm.MeetingFromTime, '') AS meetingTime, cm.City AS city, cm.State AS state, cm.ClubCharterDate AS charterDate, cm.IsSyncedFromRotaryOrg AS isSynced,
                (SELECT COUNT(DISTINCT clm.fk_member_master_profile_id) FROM club_members clm
                 JOIN member_master_profile m ON m.pk_member_master_profile_id = clm.fk_member_master_profile_id
                 WHERE clm.fk_club_id = cm.pk_club_id AND clm.IsActive = 1 AND clm.isdeleted = 0 AND m.isdeleted = 0) AS memberCount
         FROM club_master cm WHERE cm.fk_district_id = @D AND cm.isdeleted = 0 ORDER BY cm.ClubName`, { D: districtId });
      const orgRows = await conn.query(
        `SELECT RotaryClubId AS rotaryClubId, ClubName AS clubName, ClubType AS clubType, CharterDate AS charterDate, NumberOfActiveMembers AS memberCount,
                AddressLine1 AS meetingAddress, City AS city, State AS state, Latitude AS latitude, Longitude AS longitude, Website AS website, Email AS email, LastFetchedUtc AS lastFetchedUtc
         FROM rotary_org_clubs_cache WHERE DistrictNumber = @D ORDER BY ClubName`, { D: districtNumber });
      const orgClubs = orgRows.map((r) => ({
        rotaryClubId: Number(r.rotaryClubId), clubName: r.clubName ?? "", clubType: r.clubType ?? "Rotary Club", charterDate: r.charterDate, memberCount: r.memberCount ?? 0,
        meetingAddress: r.meetingAddress ?? "", city: r.city ?? "", state: r.state ?? "", latitude: r.latitude, longitude: r.longitude, website: r.website, email: r.email,
      }));
      const localIds = new Set(indiaClubs.filter((c) => c.clubRotaryId && String(c.clubRotaryId).trim()).map((c) => String(c.clubRotaryId).trim().toLowerCase()));
      const orgIds = new Set(orgClubs.map((c) => String(c.rotaryClubId)));
      return ok({
        districtNumber, indiaClubs, orgClubs, lastFetchedUtc: orgRows.length ? utcZ(orgRows[0].lastFetchedUtc) : null, nextRefreshUtc: ClubCacheRefreshService.nextScheduledRunUtc(),
        counts: {
          rotaryIndia: indiaClubs.length, rotaryOrg: orgClubs.length, matched: [...localIds].filter((id) => orgIds.has(id)).length,
          onlyIndia: indiaClubs.filter((c) => !c.clubRotaryId || !String(c.clubRotaryId).trim() || !orgIds.has(String(c.clubRotaryId).trim().toLowerCase())).length,
          onlyOrg: orgClubs.filter((c) => !localIds.has(String(c.rotaryClubId))).length,
        },
      });
    });
  }

  /** Manual refresh; a 0-club answer leaves the cache untouched. */
  @Post("clubs/refresh-cache")
  async refreshClubsCache(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    try {
      const r = await this.cacheRefresh.refresh();
      if (r.skippedEmpty) return ok({ message: "Rotary.org returned no clubs — cache left unchanged (nothing deleted). Please try again shortly.", lastFetchedUtc: null });
      return ok({ message: `Cache refreshed: ${r.upserted} clubs from /clubs`, lastFetchedUtc: new Date().toISOString().replace(/\.\d+Z$/, "Z"), nextRefreshUtc: ClubCacheRefreshService.nextScheduledRunUtc() });
    } catch (e) {
      return statusCode(502, { message: `Rotary.org API error: ${message(e)}` });
    }
  }

  /** Landing counts (exempt districts and the placeholder zone excluded) with a per-country breakdown (brand countries + "Other Zones"). */
  @Get("summary")
  async summary(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const p = this.scope;
    const where = "d.DistrictNumber NOT IN @Exempt AND (z.ZoneName IS NULL OR z.ZoneName <> @Zone0)";
    return this.db.session(async (conn) => {
      const count = async (synced: boolean) => Number(await conn.executeScalar(
        `SELECT COUNT(*) FROM club_master c JOIN district_master d ON d.pk_district_id = c.fk_district_id LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
         WHERE ${synced ? "c.IsSyncedFromRotaryOrg = 1" : "(c.IsSyncedFromRotaryOrg = 0 OR c.IsSyncedFromRotaryOrg IS NULL)"} AND c.isdeleted = 0 AND ${where}`, p));
      const syncClubs = await count(true), nonSyncClubs = await count(false);
      const totalMembers = Number(await conn.executeScalar(
        `SELECT COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm
         JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
         JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.DistrictNumber NOT IN @Exempt
         LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
         JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
         WHERE cm.IsActive = 1 AND cm.isdeleted = 0 AND (z.ZoneName IS NULL OR z.ZoneName <> @Zone0)`, p));
      const countries = Brand.Current.scope.countries;
      const rows = await conn.query(
        `SELECT LOWER(TRIM(COALESCE(c.Country, ''))) AS country, CAST(SUM(c.IsSyncedFromRotaryOrg = 1) AS SIGNED) AS syncClubs,
                CAST(SUM(c.IsSyncedFromRotaryOrg = 0 OR c.IsSyncedFromRotaryOrg IS NULL) AS SIGNED) AS nonSyncClubs
         FROM club_master c JOIN district_master d ON d.pk_district_id = c.fk_district_id LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
         WHERE c.isdeleted = 0 AND ${where} GROUP BY LOWER(TRIM(COALESCE(c.Country, '')))`, p);
      const named = new Set(countries.map((c) => c.toLowerCase()));
      const tally = (pred: (country: string) => boolean) => rows.filter((r) => pred(String(r.country))).reduce((a, r) => ({ s: a.s + Number(r.syncClubs ?? 0), n: a.n + Number(r.nonSyncClubs ?? 0) }), { s: 0, n: 0 });
      const countryBreakdown = [...countries.map((name) => ({ name, t: tally((c) => c === name.toLowerCase()) })), { name: "Other Zones", t: tally((c) => !named.has(c)) }]
        .map(({ name, t }) => ({ country: name, syncClubs: t.s, nonSyncClubs: t.n }));
      return ok({ syncClubs, nonSyncClubs, totalMembers, countryBreakdown });
    });
  }

  @Get("clubs/sync-districts")
  async syncDistricts(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.db.query(
      `SELECT d.pk_district_id AS id, d.DistrictNumber AS districtNumber, z.ZoneName AS zoneName
       FROM district_master d LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id JOIN club_master c ON c.fk_district_id = d.pk_district_id AND c.isdeleted = 0
       WHERE d.isdeleted = 0 AND d.DistrictNumber NOT IN @Exempt AND (z.ZoneName IS NULL OR z.ZoneName <> @Zone0)
       GROUP BY d.pk_district_id, d.DistrictNumber, z.ZoneName ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber`, this.scope));
  }

  /** Excel: per-district summary (with totals), then the sync and non-sync club lists. */
  @Get("clubs/sync-report")
  async syncReport(@User() u: CurrentUser, @Query("districtId") d?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    const p = { ...this.scope, DistrictId: queryInt(d) };
    return this.db.session(async (conn) => {
      const summary = await conn.query(
        `SELECT z.ZoneName AS zoneName, d.DistrictNumber AS districtNumber, CAST(SUM(c.IsSyncedFromRotaryOrg = 1) AS SIGNED) AS syncClubs,
                CAST(SUM(c.IsSyncedFromRotaryOrg = 0 OR c.IsSyncedFromRotaryOrg IS NULL) AS SIGNED) AS nonSyncClubs,
                (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0
                 JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                 WHERE c2.fk_district_id = d.pk_district_id AND cm.IsActive = 1 AND cm.isdeleted = 0) AS memberCount
         FROM district_master d LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id LEFT JOIN club_master c ON c.fk_district_id = d.pk_district_id AND c.isdeleted = 0
         WHERE d.isdeleted = 0 AND d.DistrictNumber NOT IN @Exempt AND (z.ZoneName IS NULL OR z.ZoneName <> @Zone0) AND (@DistrictId IS NULL OR d.pk_district_id = @DistrictId)
         GROUP BY d.pk_district_id, z.ZoneName, d.DistrictNumber HAVING (syncClubs + nonSyncClubs) > 0
         ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber`, p);
      const clubList = (cond: string) => conn.query(
        `SELECT z.ZoneName AS zoneName, d.DistrictNumber AS districtNumber, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId, c.City AS city, c.State AS state,
                (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm
                 JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                 WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0) AS memberCount
         FROM club_master c JOIN district_master d ON d.pk_district_id = c.fk_district_id LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
         WHERE c.isdeleted = 0 AND d.DistrictNumber NOT IN @Exempt AND (z.ZoneName IS NULL OR z.ZoneName <> @Zone0) AND (@DistrictId IS NULL OR d.pk_district_id = @DistrictId) AND ${cond}
         ORDER BY c.ClubName`, p);
      const syncList = await clubList("c.IsSyncedFromRotaryOrg = 1"), nonSyncList = await clubList("(c.IsSyncedFromRotaryOrg = 0 OR c.IsSyncedFromRotaryOrg IS NULL)");
      const wb = new ExcelJS.Workbook();
      const styleSheet = (ws: ExcelJS.Worksheet, colCount: number, lastDataRow: number, numberCols: number[], totalRow: number | null) => {
        const lastRow = totalRow ?? lastDataRow;
        for (let c = 1; c <= colCount; c++) {
          const h = ws.getCell(1, c);
          h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
          h.font = { bold: true, color: { argb: "FFFFFFFF" } };
          h.alignment = { horizontal: "center", vertical: "middle" };
        }
        ws.getRow(1).height = 22;
        for (let r = 1; r <= lastRow; r++)
          for (let c = 1; c <= colCount; c++) {
            const cell = ws.getCell(r, c);
            const inner = { style: "thin" as const, color: { argb: "FFD9E1F2" } }, outer = { style: "thin" as const, color: { argb: "FF8EAADB" } };
            cell.border = { top: r === 1 ? outer : inner, bottom: r === lastRow ? outer : inner, left: c === 1 ? outer : inner, right: c === colCount ? outer : inner };
            cell.alignment = { ...cell.alignment, vertical: "middle" };
            if (r >= 2 && r <= lastDataRow && r % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF1FB" } };
            if (r >= 2 && r <= lastDataRow && numberCols.includes(c)) cell.alignment = { ...cell.alignment, horizontal: "right" };
          }
        if (totalRow !== null)
          for (let c = 1; c <= colCount; c++) {
            const cell = ws.getCell(totalRow, c);
            cell.font = { bold: true };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCFE0F4" } };
            cell.border = { ...cell.border, top: { style: "medium", color: { argb: "FF1F4E79" } } };
          }
        ws.views = [{ state: "frozen", ySplit: 1 }];
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, lastDataRow), column: colCount } };
        fitColumns(ws);
      };
      const ws1 = wb.addWorksheet("Summary");
      ws1.addRow(["District Number", "Zone Name", "Sync Club Count", "Non-Sync Club Count", "Member Count"]);
      for (const s of summary) ws1.addRow([s.districtNumber ?? "", s.zoneName ?? "", Number(s.syncClubs), Number(s.nonSyncClubs), Number(s.memberCount)]);
      const total = ws1.addRow(["TOTAL", "", summary.reduce((a, s) => a + Number(s.syncClubs), 0), summary.reduce((a, s) => a + Number(s.nonSyncClubs), 0),
        summary.reduce((a, s) => a + Number(s.memberCount), 0)]);
      styleSheet(ws1, 5, total.number - 1, [3, 4, 5], total.number);
      for (const [name, list] of [["Sync Clubs", syncList], ["Non-Sync Clubs", nonSyncList]] as const) {
        const ws = wb.addWorksheet(name);
        ws.addRow(["District Number", "Zone Name", "Club Name", "Club Rotary ID", "City", "State", "Member Count"]);
        for (const c of list) ws.addRow([c.districtNumber ?? "", c.zoneName ?? "", c.clubName ?? "", c.clubRotaryId ?? "", c.city ?? "", c.state ?? "", Number(c.memberCount)]);
        styleSheet(ws, 7, list.length + 1, [7], null);
      }
      return file(await toBuffer(wb), XLSX_CONTENT_TYPE, "RotaryOrg_ClubSync_Report.xlsx");
    });
  }

  /** Adds a club from Rotary.org (meeting columns from its "Meeting Location" only), default modules, then its members. */
  @Post("clubs")
  async addClub(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const rotaryClubId = int(body, "rotaryClubId"), districtId = int(body, "districtId");
    if (rotaryClubId <= 0 || districtId <= 0) return badRequest({ message: "rotaryClubId and districtId required" });
    return this.db.session(async (conn) => {
      if (!(await conn.executeScalar<string>("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id AND isdeleted = 0", { Id: districtId })))
        return notFound({ message: "District not found" });
      const existingId = await conn.executeScalar("SELECT pk_club_id FROM club_master WHERE ClubRotaryId = @Rid AND isdeleted = 0 LIMIT 1", { Rid: String(rotaryClubId) });
      if (existingId !== null && existingId !== undefined) return conflict({ message: `Club already exists in ${Brand.Current.productName}`, clubId: Number(existingId) });
      let detail;
      try {
        detail = await this.api.getClubDetail("Rotary Club", rotaryClubId);
      } catch (e) {
        // A stale cache row for a club Rotary.org no longer has.
        if (/Records do not exist|: 400/i.test(message(e)))
          return notFound({ message: `Club ${rotaryClubId} is no longer on Rotary.org (likely terminated) — it's a stale cache entry. Click "Refresh from Rotary.org" to remove it from the list.` });
        return statusCode(502, { message: `Rotary.org API error: ${message(e)}` });
      }
      if (!detail) return notFound({ message: `Club ${rotaryClubId} is no longer on Rotary.org — refresh the cache to remove it.` });
      const meet = detail.addresses?.find((a) => (a.addressType ?? "").toLowerCase() === "meeting location") ?? null;
      const newClubId = Number(await conn.executeScalar(
        `INSERT INTO club_master (ClubRotaryId, ClubName, fk_district_id, MeetingAddress, MeetingDay, City, State, ClubCharterDate, IsActive, IsSyncedFromRotaryOrg, created_date, isdeleted)
         VALUES (@Rid, @Name, @DistrictId, @Addr, @Day, @City, @State, @Charter, 1, 1, NOW(), 0); SELECT LAST_INSERT_ID();`,
        { Rid: String(rotaryClubId), Name: detail.clubName ?? "", DistrictId: districtId, Addr: buildMeetingAddress(meet) ?? "", Day: normalizeMeetingDay(meet?.meetingDay),
          City: meet?.city ?? null, State: meet?.state ?? null, Charter: sqlUtc(detail.charterDate) }));
      await conn.execute(
        `INSERT IGNORE INTO club_modules (fk_club_id, fk_module_id, IsEnabled, AssignedBy, AssignedDate)
         SELECT @C, pk_module_id, 1, @U, NOW() FROM module_master WHERE IsDefaultForClub = 1 AND ModuleLevel IN ('Club','Both') AND IsActive = 1 AND isdeleted = 0`,
        { C: newClubId, U: this.userId(u) });
      let membersAdded = 0, memberErrors = 0;
      try {
        for (const m of await this.api.getClubMembers("Rotary Club", rotaryClubId)) {
          try {
            if (await this.addMemberFromOrg(conn, newClubId, m)) membersAdded++;
          } catch (e) {
            memberErrors++;
            this.log.warn(`Auto-sync member ${m.memberId} for new club ${newClubId} failed: ${message(e)}`);
          }
        }
      } catch (e) {
        this.log.warn(`Auto-sync members failed for new club ${newClubId}: ${message(e)}`);
      }
      return ok({ clubId: newClubId, message: "Club added.", membersAdded, memberErrors });
    });
  }

  @Put("clubs/:clubId")
  async updateClub(@User() u: CurrentUser, @Param("clubId") c: string, @Body() body: unknown) {
    const clubId = routeInt(c);
    if (!this.isSuperAdmin(u)) return forbid();
    if ((await this.db.executeScalar("SELECT pk_club_id FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0", { Id: clubId })) == null) return notFound({ message: "Club not found" });
    await this.db.execute(
      `UPDATE club_master SET ClubName = COALESCE(@Name, ClubName), MeetingAddress = COALESCE(@Addr, MeetingAddress), MeetingDay = COALESCE(@Day, MeetingDay),
           City = COALESCE(@City, City), State = COALESCE(@State, State), ClubCharterDate = COALESCE(@Charter, ClubCharterDate), modified_by = @UserId, modified_date = NOW()
       WHERE pk_club_id = @Id`,
      { Id: clubId, Name: str(body, "clubName"), Addr: str(body, "meetingAddress"), Day: str(body, "meetingDay"), City: str(body, "city"), State: str(body, "state"),
        Charter: dbDateTime(bodyField(body, "charterDate")), UserId: this.userId(u) });
    return ok({ message: "Club updated." });
  }

  /** Soft-deletes the club with its memberships, roles, board, auto DC group rows and modules, in one transaction. */
  @Delete("clubs/:clubId")
  async deleteClub(@User() u: CurrentUser, @Param("clubId") c: string) {
    const clubId = routeInt(c);
    if (!this.isSuperAdmin(u)) return forbid();
    const p = { Id: clubId, U: this.userId(u) };
    try {
      await this.db.transaction(async (tx) => {
        await tx.execute("UPDATE club_master SET isdeleted = 1, deleted_by = @U, deleted_date = NOW() WHERE pk_club_id = @Id", p);
        await tx.execute("UPDATE club_members SET isdeleted = 1, deleted_by = @U, deleted_date = NOW() WHERE fk_club_id = @Id AND isdeleted = 0", p);
        await tx.execute("UPDATE member_roles SET isdeleted = 1, IsActive = 0, RevokedDate = NOW(), modified_date = NOW() WHERE fk_club_id = @Id AND isdeleted = 0", p);
        await tx.execute("UPDATE board_of_directors SET isdeleted = 1, deleted_by = @U, deleted_date = NOW() WHERE fk_club_id = @Id AND isdeleted = 0", p);
        await tx.execute(
          `UPDATE district_committee_group_member m JOIN district_committee_group g ON g.id = m.fk_group_id
           SET m.isdeleted = 1, m.modified_date = NOW()
           WHERE m.fk_club_id = @Id AND m.isdeleted = 0 AND g.isdeleted = 0
             AND (g.group_name = 'Club Presidents' OR g.group_name LIKE 'Club Presidents ____-__' OR g.group_name = 'Club Secretaries' OR g.group_name LIKE 'Club Secretaries ____-__')`, p);
        await tx.execute("DELETE FROM club_modules WHERE fk_club_id = @Id", p);
      });
      return ok({ message: "Club deleted (soft)." });
    } catch (e) {
      this.log.error(`Failed to delete club ${clubId}: ${message(e)}`);
      return statusCode(500, { message: message(e) });
    }
  }

  @Get("clubs/org-detail/:rotaryClubId")
  async clubOrgDetail(@User() u: CurrentUser, @Param("rotaryClubId") r: string) {
    const rotaryClubId = routeInt(r);
    if (!this.isSuperAdmin(u)) return forbid();
    try {
      const detail = await this.api.getClubDetail("Rotary Club", rotaryClubId);
      return detail ? ok(detail) : notFound({ message: "Not found on Rotary.org" });
    } catch (e) {
      return statusCode(502, { message: message(e) });
    }
  }

  @Get("clubs/india-detail/:clubId")
  async clubLocalDetail(@User() u: CurrentUser, @Param("clubId") c: string) {
    const clubId = routeInt(c);
    if (!this.isSuperAdmin(u)) return forbid();
    const club = await this.db.queryFirstOrDefault(
      `SELECT pk_club_id AS clubId, ClubRotaryId AS clubRotaryId, ClubName AS clubName, MeetingAddress AS meetingAddress, MeetingDay AS meetingDay,
              IFNULL(MeetingFromTime, '') AS meetingTime, City AS city, State AS state, ClubCharterDate AS charterDate, IsActive AS isActive, IsSyncedFromRotaryOrg AS isSynced,
              created_date AS createdDate
       FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0`, { Id: clubId });
    return club ? ok(club) : notFound();
  }

  /**
   * Adds (or re-activates) one Rotary.org member in a club: profile from /individuals when available, a soft-deleted
   * match (Rotary ID / email / mobile) is revived, the membership row is inserted / revived / refreshed, and the default
   * Member role is given. False when the member is already in the club.
   */
  private async addMemberFromOrg(conn: DbCommands, clubId: number, api: RotaryOrgClubMember): Promise<boolean> {
    const rid = String(api.memberId);
    if (Number(await conn.executeScalar(
      `SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
       WHERE cm.fk_club_id = @C AND m.RotaryId = @R AND cm.isdeleted = 0 AND m.isdeleted = 0`, { C: clubId, R: rid })) > 0) return false;
    let profile: RotaryOrgIndividualProfile | null = null;
    try {
      profile = await this.api.getIndividualProfile(api.memberId);
    } catch {
      profile = null;
    }
    const ind = profile?.individual ?? null;
    const name = ind?.localizedName && ind.localizedName.trim() ? ind.localizedName.trim()
      : [api.prefix, api.firstName, api.middleName, api.lastName, api.suffix].filter((x): x is string => !!x && !!x.trim()).map((x) => x.trim()).join(" ");
    const { email, phone } = profileContacts(profile);
    const dob = parseRotaryDob(ind?.dateOfBirth);
    const gender = ind?.gender && ind.gender.trim() ? ind.gender : ind?.genderDescription ?? null;
    const isYouth = isYouthAge(dob, ind?.youthFlag ?? null, today());
    const existing = await conn.executeScalar(
      `SELECT pk_member_master_profile_id FROM member_master_profile
       WHERE isdeleted = 1 AND (RotaryId = @Rid OR (@Email IS NOT NULL AND @Email <> '' AND EmailId = @Email) OR (@Phone IS NOT NULL AND @Phone <> '' AND PrimaryMobileNumber = @Phone))
       ORDER BY pk_member_master_profile_id DESC LIMIT 1`, { Rid: rid, Email: email ?? "", Phone: phone ?? "" });
    let memberId: number;
    const p = { Rid: rid, Name: name, Email: email, Phone: phone, Dob: dob, Gender: gender, Lang: ind?.primaryLanguage ?? null, IsYouth: isYouth };
    if (existing !== null && existing !== undefined && Number(existing) > 0) {
      memberId = Number(existing);
      await RotaryOrgManualSyncController.releaseSoftDeletedMobile(conn, phone, memberId);
      await conn.execute(
        `UPDATE member_master_profile SET isdeleted = 0, deleted_by = NULL, deleted_date = NULL, RotaryId = @Rid, MemberName = @Name, EmailId = COALESCE(@Email, EmailId),
             PrimaryMobileNumber = COALESCE(@Phone, PrimaryMobileNumber), BirthDate = COALESCE(@Dob, BirthDate), Gender = COALESCE(@Gender, Gender),
             PrimaryLanguage = COALESCE(@Lang, PrimaryLanguage), IsYouth = @IsYouth, modified_date = NOW()
         WHERE pk_member_master_profile_id = @Id`, { ...p, Id: memberId });
    } else {
      await RotaryOrgManualSyncController.releaseSoftDeletedMobile(conn, phone, 0);
      memberId = Number(await conn.executeScalar(
        `INSERT INTO member_master_profile (MemberName, RotaryId, EmailId, PrimaryMobileNumber, BirthDate, Gender, PrimaryLanguage, IsYouth, IsPersonalDetailsVisible, created_date, isdeleted)
         VALUES (@Name, @Rid, @Email, @Phone, @Dob, @Gender, @Lang, @IsYouth, 1, NOW(), 0); SELECT LAST_INSERT_ID();`, p));
    }
    const isHon = (api.memberType ?? "").toLowerCase() === "honorary member" ? 1 : 0;
    const cm = await conn.queryFirstOrDefault("SELECT pk_club_member_id AS id, isdeleted FROM club_members WHERE fk_club_id = @C AND fk_member_master_profile_id = @M ORDER BY pk_club_member_id DESC LIMIT 1",
      { C: clubId, M: memberId });
    const joined = sqlUtc(api.admissionDate) ?? today();
    if (!cm)
      await conn.execute("INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, JoinedDate, IsActive, IsHonoraryMember, created_date, isdeleted) VALUES (@C, @M, @J, 1, @IsHon, NOW(), 0)",
        { C: clubId, M: memberId, J: joined, IsHon: isHon });
    else if (Number(cm.isdeleted) === 1)
      await conn.execute(
        `UPDATE club_members SET isdeleted = 0, IsActive = 1, JoinedDate = @J, IsHonoraryMember = @IsHon, TerminationDate = NULL, TerminationReason = NULL,
             deleted_by = NULL, deleted_date = NULL, modified_date = NOW() WHERE pk_club_member_id = @Id`, { Id: cm.id, J: joined, IsHon: isHon });
    // An active row only gets its honorary flag refreshed and a missing joining date filled.
    else await conn.execute("UPDATE club_members SET IsHonoraryMember = @IsHon, JoinedDate = COALESCE(JoinedDate, @J), modified_date = NOW() WHERE pk_club_member_id = @Id",
      { Id: cm.id, IsHon: isHon, J: joined });
    await conn.execute(
      `INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, AssignedBy, IsActive, isdeleted, AssignedDate)
       SELECT @M, 1, @M, 1, 0, NOW() FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM member_roles WHERE fk_member_master_profile_id = @M AND fk_role_id = 1 AND IsActive = 1 AND isdeleted = 0)`, { M: memberId });
    return true;
  }

  // ─────────────────────────────── Member sync ───────────────────────────────

  @Get("members/compare")
  async compareMembers(@User() u: CurrentUser, @Query("clubId") c?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    const clubId = queryInt(c, 0);
    if (clubId <= 0) return badRequest({ message: "clubId required" });
    return this.db.session(async (conn) => {
      const club = await conn.queryFirstOrDefault("SELECT IFNULL(ClubRotaryId, '') AS rid, ClubName AS name FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0", { Id: clubId });
      if (!club || !club.name) return notFound({ message: "Club not found" });
      if (!/^\s*-?\d+\s*$/.test(String(club.rid ?? ""))) return badRequest({ message: "This club has no Rotary.org ID — cannot sync." });
      const rotaryClubId = parseInt(String(club.rid), 10);
      const latest = (types: string) => `(SELECT fk_member_master_profile_id, MAX(pk_member_address_details_id) AS pk_id FROM member_address_details
          WHERE AddressType IN (${types}) AND isdeleted = 0 GROUP BY fk_member_master_profile_id)`;
      const indiaMembers = await conn.query(
        `SELECT m.pk_member_master_profile_id AS memberId, m.RotaryId AS rotaryId, m.MemberName AS memberName, m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
                m.SecondaryMobileNumber AS secondaryMobile, m.BirthDate AS birthDate, m.Gender AS gender, m.PrimaryLanguage AS language, m.IsYouth AS isYouth, cm.JoinedDate AS joinedDate,
                resAddr.Address AS resAddress, resAddr.City AS resCity, resAddr.State AS resState, resAddr.PinCode AS resPinCode,
                busAddr.Address AS busAddress, busAddr.City AS busCity, busAddr.State AS busState, busAddr.PinCode AS busPinCode
         FROM club_members cm
         JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
         LEFT JOIN ${latest("'Residence','Residential'")} latest_res ON latest_res.fk_member_master_profile_id = m.pk_member_master_profile_id
         LEFT JOIN member_address_details resAddr ON resAddr.pk_member_address_details_id = latest_res.pk_id
         LEFT JOIN ${latest("'Business'")} latest_bus ON latest_bus.fk_member_master_profile_id = m.pk_member_master_profile_id
         LEFT JOIN member_address_details busAddr ON busAddr.pk_member_address_details_id = latest_bus.pk_id
         WHERE cm.fk_club_id = @C AND cm.isdeleted = 0 AND m.isdeleted = 0 ORDER BY m.MemberName`, { C: clubId });
      const orgRows = await conn.query(
        `SELECT RotaryMemberId AS rotaryMemberId,
                IFNULL(LocalizedName, TRIM(CONCAT_WS(' ', NULLIF(Prefix,''), NULLIF(FirstName,''), NULLIF(MiddleName,''), NULLIF(LastName,''), NULLIF(Suffix,'')))) AS memberName,
                AdmissionDate AS admissionDate, TerminationDate AS terminationDate, BirthYear AS birthYear, MemberType AS memberType, Email AS email, Mobile AS mobile,
                DateOfBirth AS dateOfBirth, Gender AS gender, PrimaryLanguage AS language, AddressLine AS address, City AS city, State AS state, Country AS country,
                PostalCode AS postalCode, LastFetchedUtc AS lastFetchedUtc
         FROM rotary_org_club_members_cache WHERE fk_rotary_club_id = @C ORDER BY memberName`, { C: rotaryClubId });
      const orgMembers = orgRows.map((r) => ({
        rotaryMemberId: Number(r.rotaryMemberId), memberName: r.memberName ?? "", admissionDate: r.admissionDate, terminationDate: r.terminationDate, birthYear: r.birthYear,
        memberType: r.memberType, email: r.email, mobile: r.mobile, dateOfBirth: r.dateOfBirth, gender: r.gender, language: r.language, address: r.address, city: r.city,
        state: r.state, country: r.country, postalCode: r.postalCode,
      }));
      const localIds = new Set(indiaMembers.filter((m) => m.rotaryId && String(m.rotaryId).trim()).map((m) => String(m.rotaryId).trim().toLowerCase()));
      const orgIds = new Set(orgMembers.map((m) => String(m.rotaryMemberId)));
      return ok({
        clubId, clubName: club.name, rotaryClubId, indiaMembers, orgMembers, lastFetchedUtc: orgRows.length ? utcZ(orgRows[0].lastFetchedUtc) : null,
        counts: {
          rotaryIndia: indiaMembers.length, rotaryOrg: orgMembers.length, matched: [...localIds].filter((id) => orgIds.has(id)).length,
          onlyIndia: indiaMembers.filter((m) => !m.rotaryId || !String(m.rotaryId).trim() || !orgIds.has(String(m.rotaryId).trim().toLowerCase())).length,
          onlyOrg: orgMembers.filter((m) => !localIds.has(String(m.rotaryMemberId))).length,
        },
      });
    });
  }

  /** Active + honorary members (deduped), each with its profile fetched 6 at a time (one retry); the club's cache replaced in one transaction. */
  @Post("members/refresh-cache")
  async refreshMembersCache(@User() u: CurrentUser, @Query("clubId") c?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    const clubId = queryInt(c, 0);
    if (clubId <= 0) return badRequest({ message: "clubId required" });
    const rid = await this.db.executeScalar<string>("SELECT ClubRotaryId FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0", { Id: clubId });
    if (!rid || !/^\s*-?\d+\s*$/.test(rid)) return badRequest({ message: "Club has no Rotary.org ID" });
    const rotaryClubId = parseInt(rid, 10);
    let list: RotaryOrgClubMember[];
    try {
      const active = await this.api.getClubMembers("Rotary Club", rotaryClubId);
      const honorary = await this.api.getClubHonoraryMembers("Rotary Club", rotaryClubId);
      const seen = new Set(active.map((a) => a.memberId));
      list = [...active, ...honorary.filter((h) => !seen.has(h.memberId) && seen.add(h.memberId))];
    } catch (e) {
      return statusCode(502, { message: `Rotary.org API error: ${message(e)}` });
    }
    const profiles: (RotaryOrgIndividualProfile | null)[] = new Array(list.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const idx = next++;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            profiles[idx] = await this.api.getIndividualProfile(list[idx].memberId);
            break;
          } catch {
            if (attempt === 1) await new Promise((r) => setTimeout(r, 1500));
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, list.length) }, worker));
    const fetched = profiles.filter((p) => p !== null).length;
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    await this.db.transaction(async (tx) => {
      await tx.execute("DELETE FROM rotary_org_club_members_cache WHERE fk_rotary_club_id = @C", { C: rotaryClubId });
      for (const [i, m] of list.entries()) {
        const p = profiles[i], ind = p?.individual ?? null;
        const { email, phone, address } = profileContacts(p);
        await tx.execute(
          `INSERT INTO rotary_org_club_members_cache (fk_rotary_club_id, RotaryMemberId, LocalizedName, Prefix, FirstName, MiddleName, LastName, Suffix, AdmissionDate, TerminationDate,
             BirthYear, MemberType, Email, Mobile, DateOfBirth, Gender, PrimaryLanguage, AddressLine, City, State, Country, PostalCode, LastFetchedUtc)
           VALUES (@C, @M, @LName, @Pre, @F, @Mid, @L, @Suf, @Adm, @Term, @By, @Type, @Email, @Mobile, @Dob, @Gender, @Lang, @Addr, @City, @State, @Country, @Postal, @Now)`,
          { C: rotaryClubId, M: m.memberId, LName: m.localizedName, Pre: m.prefix, F: m.firstName, Mid: m.middleName, L: m.lastName, Suf: m.suffix, Adm: sqlUtc(m.admissionDate),
            Term: sqlUtc(m.terminationDate), By: m.birthYear, Type: m.memberType, Email: email, Mobile: phone, Dob: ind?.dateOfBirth ?? null,
            Gender: ind?.gender && ind.gender.trim() ? ind.gender : ind?.genderDescription ?? null, Lang: ind?.primaryLanguage ?? null,
            Addr: address ? [address.addressLine1, address.addressLine2, address.addressLine3].filter((x) => x && x.trim()).join(", ") : null, City: address?.city ?? null,
            State: address?.state ?? null, Country: address?.country ?? null, Postal: address?.postalCode ?? null, Now: now });
      }
    });
    return ok({ message: `Members cache refreshed: ${list.length} members (${fetched} with full profile, ${list.length - fetched} profile fetch failed)`,
      lastFetchedUtc: `${now.replace(" ", "T")}Z`, profileFetched: fetched, profileFailed: list.length - fetched });
  }

  @Post("members")
  async addMember(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const rotaryMemberId = int(body, "rotaryMemberId"), clubId = int(body, "clubId");
    if (rotaryMemberId <= 0 || clubId <= 0) return badRequest({ message: "rotaryMemberId and clubId required" });
    return this.db.session(async (conn) => {
      const club = await conn.queryFirstOrDefault("SELECT IFNULL(ClubRotaryId, '') AS rid, ClubName AS name FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0", { Id: clubId });
      if (!club || !club.name) return notFound({ message: "Club not found" });
      if (!/^\s*-?\d+\s*$/.test(String(club.rid ?? ""))) return badRequest({ message: "Club has no Rotary.org ID" });
      const match = (await this.api.getClubMembers("Rotary Club", parseInt(String(club.rid), 10))).find((m) => m.memberId === rotaryMemberId);
      if (!match) return notFound({ message: "Member not found in this club on Rotary.org" });
      return (await this.addMemberFromOrg(conn, clubId, match)) ? ok({ message: "Member added." }) : conflict({ message: "Member already in this club" });
    });
  }

  @Put("members/:memberId")
  async updateMember(@User() u: CurrentUser, @Param("memberId") m: string, @Body() body: unknown) {
    const memberId = routeInt(m);
    if (!this.isSuperAdmin(u)) return forbid();
    return this.db.session(async (conn) => {
      if ((await conn.executeScalar("SELECT pk_member_master_profile_id FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", { Id: memberId })) == null)
        return notFound({ message: "Member not found" });
      await RotaryOrgManualSyncController.releaseSoftDeletedMobile(conn, str(body, "mobile"), memberId);
      await conn.execute(
        `UPDATE member_master_profile SET MemberName = COALESCE(@Name, MemberName), RotaryId = COALESCE(@Rid, RotaryId), EmailId = COALESCE(@Email, EmailId),
             PrimaryMobileNumber = COALESCE(@Mobile, PrimaryMobileNumber), SecondaryMobileNumber = COALESCE(@SecMobile, SecondaryMobileNumber), BirthDate = COALESCE(@Dob, BirthDate),
             Gender = COALESCE(@Gender, Gender), PrimaryLanguage = COALESCE(@Lang, PrimaryLanguage), modified_by = @U, modified_date = NOW()
         WHERE pk_member_master_profile_id = @Id`,
        { Id: memberId, Name: str(body, "memberName"), Rid: str(body, "rotaryId"), Email: str(body, "email"), Mobile: str(body, "mobile"), SecMobile: str(body, "secondaryMobile"),
          Dob: dbDateTime(bodyField(body, "birthDate")), Gender: str(body, "gender"), Lang: str(body, "primaryLanguage"), U: this.userId(u) });
      await this.upsertAddress(conn, memberId, "Residential", str(body, "resAddress"), str(body, "resCity"), str(body, "resState"), str(body, "resPinCode"));
      await this.upsertAddress(conn, memberId, "Business", str(body, "busAddress"), str(body, "busCity"), str(body, "busState"), str(body, "busPinCode"));
      return ok({ message: "Member updated." });
    });
  }

  /** Skipped when all four are blank, so a partial save never blanks an address. */
  private async upsertAddress(conn: DbCommands, memberId: number, type: string, address: string | null, city: string | null, state: string | null, pinCode: string | null) {
    if ([address, city, state, pinCode].every((x) => !x || !x.trim())) return;
    const id = await conn.executeScalar("SELECT MAX(pk_member_address_details_id) FROM member_address_details WHERE fk_member_master_profile_id = @M AND AddressType = @T AND isdeleted = 0",
      { M: memberId, T: type });
    if (id !== null && id !== undefined)
      await conn.execute(
        "UPDATE member_address_details SET Address = COALESCE(@Addr, Address), City = COALESCE(@City, City), State = COALESCE(@State, State), PinCode = COALESCE(@Pin, PinCode), modified_date = NOW() WHERE pk_member_address_details_id = @Id",
        { Id: id, Addr: address, City: city, State: state, Pin: pinCode });
    else {
      // ROW: a new address takes the member's own country (RIZones used country id 1).
      const country = Number((await conn.executeScalar("SELECT fk_primary_country_id FROM member_master_profile WHERE pk_member_master_profile_id = @M", { M: memberId })) ?? 0) || 1;
      await conn.execute(
        `INSERT INTO member_address_details (fk_member_master_profile_id, AddressType, fk_country_id, Address, City, State, PinCode, created_date, isdeleted)
         VALUES (@M, @T, @Country, @Addr, @City, @State, @Pin, NOW(), 0)`, { M: memberId, T: type, Country: country, Addr: address, City: city, State: state, Pin: pinCode });
    }
  }

  /** The same removal as the club dashboard's "Remove member" (club-scoped; the last club also frees the mobile). */
  @Delete("members/:memberId/from-club/:clubId")
  async deleteMemberFromClub(@User() u: CurrentUser, @Param("memberId") m: string, @Param("clubId") c: string) {
    const memberId = routeInt(m), clubId = routeInt(c);
    if (!this.isSuperAdmin(u)) return forbid();
    try {
      await this.clubs.removeMember(clubId, memberId, this.userId(u), null);
      return ok({ message: "Member removed from club." });
    } catch (e) {
      this.log.error(`Delete member ${memberId} from club ${clubId} failed: ${message(e)}`);
      return statusCode(500, { message: message(e) });
    }
  }

  @Get("members/org-detail/:rotaryMemberId")
  async memberOrgDetail(@User() u: CurrentUser, @Param("rotaryMemberId") r: string) {
    if (!/^-?\d+$/.test(r ?? "")) return notFound();
    if (!this.isSuperAdmin(u)) return forbid();
    try {
      const profile = await this.api.getIndividualProfile(Number(r));
      return profile ? ok(profile) : notFound({ message: "Not found on Rotary.org" });
    } catch (e) {
      return statusCode(502, { message: message(e) });
    }
  }

  @Get("members/india-detail/:memberId")
  async memberLocalDetail(@User() u: CurrentUser, @Param("memberId") m: string) {
    const memberId = routeInt(m);
    if (!this.isSuperAdmin(u)) return forbid();
    return this.db.session(async (conn) => {
      const profile = await conn.queryFirstOrDefault(
        `SELECT m.pk_member_master_profile_id AS memberId, m.RotaryId AS rotaryId, m.MemberName AS memberName, m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
                m.SecondaryMobileNumber AS secondaryMobile, m.BirthDate AS birthDate, m.Gender AS gender, m.PrimaryLanguage AS language, m.IsYouth AS isYouth, m.created_date AS createdDate
         FROM member_master_profile m WHERE m.pk_member_master_profile_id = @Id AND m.isdeleted = 0`, { Id: memberId });
      if (!profile) return notFound();
      const addresses = await conn.query(
        `SELECT pk_member_address_details_id AS id, AddressType AS addressType, Address AS address, City AS city, State AS state, PinCode AS pinCode, fk_country_id AS countryId
         FROM member_address_details WHERE fk_member_master_profile_id = @Id AND isdeleted = 0`, { Id: memberId });
      return ok({ profile, addresses });
    });
  }

  // ────────────────────────────── Sync exceptions ──────────────────────────────

  @Get("sync-exceptions")
  async syncExceptions(@User() u: CurrentUser, @Query("type") t?: string, @Query("resolved") r?: string, @Query("inserted") ins?: string, @Query("page") pq?: string,
                       @Query("pageSize") sq?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    let page = queryInt(pq, 1), pageSize = queryInt(sq, 50);
    if (page < 1) page = 1;
    if (pageSize < 1 || pageSize > 200) pageSize = 50;
    const type = queryString(t), resolved = queryInt(r), inserted = queryInt(ins);
    const where: string[] = [];
    const p: Record<string, unknown> = { Limit: pageSize, Offset: (page - 1) * pageSize };
    if (type && type.trim()) { where.push("e.exception_type = @Type"); p.Type = type.trim(); }
    if (resolved !== null) { where.push("e.is_resolved = @Resolved"); p.Resolved = resolved === 0 ? 0 : 1; }
    // inserted = 0: the rows whose member did NOT land (the ones to review).
    if (inserted !== null) { where.push("COALESCE(e.inserted, 0) = @Inserted"); p.Inserted = inserted === 0 ? 0 : 1; }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return this.db.session(async (conn) => {
      const items = await conn.query(
        `SELECT e.pk_id AS id, e.exception_type AS exceptionType, e.rotary_id AS rotaryId, e.rotary_org_name AS rotaryOrgName, e.field_name AS fieldName, e.conflict_value AS conflictValue,
                e.conflict_with_member_pk AS conflictMemberId, e.conflict_with_member_name AS conflictMemberName, e.admin_message AS adminMessage, e.error_message AS errorMessage,
                e.fk_club_id AS clubId, c.ClubRotaryId AS clubRotaryId, c.ClubName AS clubName, e.fk_member_master_profile_id AS memberId, COALESCE(e.inserted, 0) AS inserted,
                e.is_resolved AS isResolved, e.resolved_by AS resolvedBy, e.resolved_date AS resolvedDate, e.resolution_notes AS resolutionNotes, e.created_date AS createdDate
         FROM sync_exception_log e LEFT JOIN club_master c ON c.pk_club_id = e.fk_club_id ${whereSql} ORDER BY e.created_date DESC LIMIT @Limit OFFSET @Offset`, p);
      const totalCount = Number(await conn.executeScalar(`SELECT COUNT(*) FROM sync_exception_log e ${whereSql}`, p));
      const summary = await conn.query(
        `SELECT exception_type AS type, SUM(CASE WHEN is_resolved = 0 THEN 1 ELSE 0 END) AS unresolved, SUM(CASE WHEN is_resolved = 1 THEN 1 ELSE 0 END) AS resolved, COUNT(*) AS total
         FROM sync_exception_log GROUP BY exception_type ORDER BY exception_type`);
      return ok({ items, totalCount, page, pageSize, summary });
    });
  }

  @Post("sync-exceptions/:id/resolve")
  async resolveException(@User() u: CurrentUser, @Param("id") i: string, @Body() body: unknown) {
    if (!/^-?\d+$/.test(i ?? "")) return notFound();
    if (!this.isSuperAdmin(u)) return forbid();
    const n = await this.db.execute("UPDATE sync_exception_log SET is_resolved = 1, resolved_by = @By, resolved_date = NOW(), resolution_notes = @Notes WHERE pk_id = @Id AND is_resolved = 0",
      { Id: Number(i), By: this.userId(u), Notes: str(body, "notes") });
    return n === 0 ? notFound({ message: "Exception not found or already resolved." }) : ok({ message: "Resolved." });
  }

  // ────────────────────────────── Member match ──────────────────────────────

  /** A district's sync clubs with their local member count (the Rotary.org count is loaded per club). */
  @Get("members/district-clubs")
  async districtClubs(@User() u: CurrentUser, @Query("districtId") d?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    const items = await this.db.query(
      `SELECT c.pk_club_id AS clubId, c.ClubRotaryId AS clubRotaryId, IFNULL(c.ClubName, '') AS clubName, IFNULL(NULLIF(c.ClubType,''),'Rotary Club') AS clubType,
              (SELECT COUNT(*) FROM club_members cm WHERE cm.fk_club_id = c.pk_club_id AND cm.isdeleted = 0) AS localCount
       FROM club_master c
       WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND IFNULL(c.IsSyncedFromRotaryOrg,0) = 1 AND c.ClubRotaryId IS NOT NULL AND c.ClubRotaryId <> ''
       ORDER BY c.ClubName`, { D: queryInt(d, 0) });
    return ok({ items });
  }

  private async liveOrgMembers(rid: number) {
    // "Rotary Club", exactly what the member-sweep worker fetches, so the numbers reconcile.
    const active = await this.api.getClubMembers("Rotary Club", rid);
    const honorary = await this.api.getClubHonoraryMembers("Rotary Club", rid);
    const ids = new Set(active.map((m) => m.memberId));
    return { active, honoraryOnly: honorary.filter((h) => !ids.has(h.memberId)) };
  }

  /** Live Rotary.org count = Active + Honorary (deduped), not the /clubs list number. */
  @Get("members/club-org-count")
  async clubOrgCount(@User() u: CurrentUser, @Query("clubId") c?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    const clubId = queryInt(c, 0);
    const club = await this.db.queryFirstOrDefault("SELECT ClubRotaryId AS rid FROM club_master WHERE pk_club_id=@C LIMIT 1", { C: clubId });
    if (!club) return notFound({ message: "Club not found." });
    const rid = /^\s*-?\d+\s*$/.test(String(club.rid ?? "")) ? parseInt(String(club.rid), 10) : 0;
    if (rid <= 0) return ok({ orgActive: 0, orgHonorary: 0, orgTotal: 0, error: "Club has no Rotary.org id." });
    try {
      const { active, honoraryOnly } = await this.liveOrgMembers(rid);
      return ok({ orgActive: active.length, orgHonorary: honoraryOnly.length, orgTotal: active.length + honoraryOnly.length });
    } catch (e) {
      this.log.warn(`club-org-count failed for club ${clubId}: ${message(e)}`);
      return ok({ orgActive: 0, orgHonorary: 0, orgTotal: 0, error: message(e) });
    }
  }

  /** Who differs: ADD (only on Rotary.org), REMOVE (Rotary ID gone from Rotary.org), and NO-ROTARY-ID (removed unless honorary or in the COG club). */
  @Get("members/club-diff")
  async clubDiff(@User() u: CurrentUser, @Query("clubId") c?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    const clubId = queryInt(c, 0);
    return this.db.session(async (conn) => {
      const club = await conn.queryFirstOrDefault("SELECT ClubName AS clubName, ClubRotaryId AS clubRotaryId FROM club_master WHERE pk_club_id=@C AND isdeleted=0 LIMIT 1", { C: clubId });
      if (!club) return notFound({ message: "Club not found." });
      const rid = /^\s*-?\d+\s*$/.test(String(club.clubRotaryId ?? "")) ? parseInt(String(club.clubRotaryId), 10) : 0;
      if (rid <= 0) return ok({ clubId, error: "Club has no Rotary.org id." });
      const local = await conn.query(
        `SELECT m.pk_member_master_profile_id AS memberId, m.RotaryId AS rotaryId, m.MemberName AS memberName, COALESCE(cm.IsHonoraryMember,0) AS honorary,
                (SELECT COUNT(*) FROM club_members x WHERE x.fk_member_master_profile_id=m.pk_member_master_profile_id AND x.fk_club_id=@Cog AND x.isdeleted=0) AS inCog
         FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
         WHERE cm.fk_club_id = @ClubId AND cm.isdeleted = 0 AND m.isdeleted = 0`, { ClubId: clubId, Cog: cogClubId() });
      let org: { id: number; name: string; honorary: boolean }[];
      try {
        const { active, honoraryOnly } = await this.liveOrgMembers(rid);
        const nm = (m: RotaryOrgClubMember) => [m.firstName, m.middleName, m.lastName].filter((x) => x && x.trim()).join(" ").trim();
        org = [...active.map((m) => ({ id: m.memberId, name: nm(m), honorary: false })), ...honoraryOnly.map((m) => ({ id: m.memberId, name: nm(m), honorary: true }))];
      } catch (e) {
        return ok({ clubId, error: message(e) });
      }
      const localRids = new Set(local.filter((r) => r.rotaryId && String(r.rotaryId).trim()).map((r) => String(r.rotaryId).trim().toLowerCase()));
      const orgIds = new Set(org.map((o) => String(o.id)));
      return ok({
        clubId, clubName: club.clubName, clubRotaryId: club.clubRotaryId, localCount: local.length, orgCount: org.length,
        toAdd: org.filter((o) => !localRids.has(String(o.id))).map((o) => ({ rotaryId: String(o.id), name: o.name, isHonorary: o.honorary })),
        toRemove: local.filter((r) => r.rotaryId && String(r.rotaryId).trim() && !orgIds.has(String(r.rotaryId).trim().toLowerCase()))
          .map((r) => ({ memberId: Number(r.memberId), rotaryId: r.rotaryId, name: r.memberName ?? "" })),
        noRotaryId: local.filter((r) => !r.rotaryId || !String(r.rotaryId).trim()).map((r) => {
          const hon = Number(r.honorary) === 1, cog = Number(r.inCog) > 0, keep = hon || cog;
          return { memberId: Number(r.memberId), name: r.memberName ?? "", honorary: hon, inCog: cog, willSoftDelete: !keep, keepReason: keep ? (hon ? "Honorary" : "COG member") : null };
        }),
      });
    });
  }

  /** Soft-deletes no-Rotary-ID members from a club; each one is re-checked server side (no Rotary ID, not honorary, not in the COG club). */
  @Post("members/soft-delete-club-links")
  async softDeleteClubLinks(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const clubId = int(body, "clubId");
    const raw = bodyField(body, "memberIds");
    const ids = Array.isArray(raw) ? raw.map(Number).filter((x) => Number.isInteger(x)) : [];
    if (clubId <= 0 || !ids.length) return badRequest({ message: "clubId and memberIds are required." });
    const eligible = (await this.db.query(
      `SELECT cm.fk_member_master_profile_id AS id FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
       WHERE cm.fk_club_id = @ClubId AND cm.isdeleted = 0 AND m.isdeleted = 0 AND cm.fk_member_master_profile_id IN @Ids AND (m.RotaryId IS NULL OR TRIM(m.RotaryId) = '')
         AND COALESCE(cm.IsHonoraryMember,0) = 0
         AND cm.fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM club_members WHERE fk_club_id = @Cog AND isdeleted = 0)`,
      { ClubId: clubId, Ids: ids, Cog: cogClubId() })).map((r) => Number(r.id));
    if (!eligible.length) return ok({ softDeleted: 0, message: "No eligible members to soft-delete." });
    const p = { ClubId: clubId, Ids: eligible, Reason: "Removed: no Rotary ID (member-match cleanup)" };
    await this.db.transaction(async (tx) => {
      await tx.execute("UPDATE club_members SET isdeleted=1, deleted_date=NOW(), TerminationDate=CURDATE(), TerminationReason=@Reason WHERE fk_club_id=@ClubId AND fk_member_master_profile_id IN @Ids AND isdeleted=0", p);
      await tx.execute("UPDATE member_roles SET isdeleted=1, IsActive=0, RevokedDate=NOW(), modified_date=NOW() WHERE fk_club_id=@ClubId AND fk_member_master_profile_id IN @Ids AND isdeleted=0", p);
      await tx.execute("UPDATE board_of_directors SET isdeleted=1, deleted_date=NOW() WHERE fk_club_id=@ClubId AND fk_member_master_profile_id IN @Ids AND isdeleted=0", p);
      for (const t of ["district_committee_member", "district_committee_group_member", "district_committee_sub_group_member"])
        await tx.execute(`UPDATE ${t} SET isdeleted=1, modified_date=NOW() WHERE fk_club_id=@ClubId AND fk_member_id IN @Ids AND isdeleted=0`, p);
      for (const t of ["district_ag", "district_club_moderator"])
        await tx.execute(`UPDATE ${t} SET isdeleted=1, is_active=0, modified_date=NOW() WHERE fk_club_id=@ClubId AND fk_member_id IN @Ids AND isdeleted=0`, p);
    });
    this.log.log(`Member-match cleanup: soft-deleted ${eligible.length} no-Rotary-ID members from club ${clubId}`);
    return ok({ softDeleted: eligible.length, message: `${eligible.length} no-Rotary-ID member(s) soft-deleted from the club.` });
  }

  @Post("members/sweep-club")
  async sweepClub(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const clubId = int(body, "clubId");
    if (clubId <= 0) return badRequest({ message: "clubId required." });
    const rid = await this.db.executeScalar<string>("SELECT ClubRotaryId FROM club_master WHERE pk_club_id=@C AND isdeleted=0 LIMIT 1", { C: clubId });
    if (!rid || !rid.trim()) return notFound({ message: "Club not found or has no Rotary.org id." });
    return this.launchSweep(rid.trim());
  }

  @Post("members/sweep-district")
  async sweepDistrict(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const districtId = int(body, "districtId");
    if (districtId <= 0) return badRequest({ message: "districtId required." });
    const rids = (await this.db.query(
      "SELECT ClubRotaryId AS rid FROM club_master WHERE fk_district_id=@D AND isdeleted=0 AND IFNULL(IsSyncedFromRotaryOrg,0)=1 AND ClubRotaryId IS NOT NULL AND ClubRotaryId <> ''",
      { D: districtId })).map((r) => String(r.rid ?? "").trim()).filter(Boolean);
    if (!rids.length) return notFound({ message: "No sync clubs in this district." });
    return this.launchSweep(rids.join(","));
  }

  /** Reconciles only the district's clubs whose member count differs (the worker decides which). */
  @Post("members/reconcile-district")
  async reconcileDistrict(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const districtId = int(body, "districtId");
    if (districtId <= 0) return badRequest({ message: "districtId required." });
    const num = await this.db.executeScalar<string>("SELECT DistrictNumber FROM district_master WHERE pk_district_id=@D AND isdeleted=0 LIMIT 1", { D: districtId });
    if (!num || !num.trim()) return notFound({ message: "District not found." });
    return this.launchWorker(["--member-count-reconcile", "--districts", num.trim()],
      "Member reconcile started for this district. Only clubs whose member count differs are swept (missing members added, departed removed; profiles kept). It emails a report when done — refresh the counts in a minute.");
  }

  /** The member sweep only processes synced clubs, so the flag flips first. */
  @Post("clubs/mark-synced")
  async markSynced(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const clubId = int(body, "clubId");
    if (clubId <= 0) return badRequest({ message: "clubId required." });
    const rid = await this.db.executeScalar<string>("SELECT ClubRotaryId FROM club_master WHERE pk_club_id=@C AND isdeleted=0 LIMIT 1", { C: clubId });
    if (!rid || !rid.trim()) return notFound({ message: "Club not found or has no Rotary.org id." });
    await this.db.execute("UPDATE club_master SET IsSyncedFromRotaryOrg=1, modified_date=NOW() WHERE pk_club_id=@C AND isdeleted=0", { C: clubId });
    return this.launchSweep(rid.trim());
  }

  private launchSweep(clubRotaryIdsCsv: string) {
    return this.launchWorker(["--member-sweep", "--club-id", clubRotaryIdsCsv],
      "Member sync started in the background. It writes to the sync log and emails a report when done. Refresh the counts in a minute.", { clubRotaryIds: clubRotaryIdsCsv });
  }

  /** Starts the Rotary.org sync worker (RotaryOrgSync:WorkerExePath) detached; it logs to rotary_org_sync_log and emails its report. */
  private launchWorker(args: string[], startedMessage: string, extra: unknown = null) {
    const exe = this.config.get("RotaryOrgSync:WorkerExePath");
    if (!exe || !exe.trim() || !existsSync(exe)) {
      this.log.error(`Worker launch requested but RotaryOrgSync:WorkerExePath is missing/invalid: '${exe ?? ""}'`);
      return statusCode(500, { message: "Worker executable is not configured on the server (RotaryOrgSync:WorkerExePath). Run it from the server console instead." });
    }
    try {
      const child = spawn(exe, args, { cwd: dirname(exe), detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
      this.log.log(`Launched worker (pid ${child.pid}): ${args.join(" ")}`);
      return ok({ started: true, pid: child.pid ?? null, message: startedMessage, extra });
    } catch (e) {
      this.log.error(`Failed to launch worker: ${args.join(" ")}: ${message(e)}`);
      return statusCode(500, { message: `Failed to launch the sync worker: ${message(e)}` });
    }
  }
}
