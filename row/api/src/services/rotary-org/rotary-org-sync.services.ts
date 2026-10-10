import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { nowIn } from "../../common/dotnet-format";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { Db, type DbCommands } from "../../database/db.service";
import { EmailService, emailFooter, emailHeader } from "../email.service";
import { ExcelJS, fitColumns, toBuffer } from "../xlsx";
import { RotaryOrgApiClient, type RotaryOrgAddress, type RotaryOrgClubMember } from "./rotary-org-api.client";

/** "yyyy-MM-ddTHH:mm:ssZ" (UTC) → MySQL "yyyy-MM-dd HH:mm:ss" (ROW stores UTC). */
export const sqlUtc = (iso: string | null | undefined) => (iso ? iso.slice(0, 19).replace("T", " ") : null);
export const utcNowSql = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Any short weekday form ("Thu", "Thurs", any casing) → "Thursday"; blank → null (so COALESCE keeps the stored value). */
export function normalizeMeetingDay(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const t = raw.trim();
  const map: Record<string, string> = {
    mon: "Monday", monday: "Monday", tue: "Tuesday", tues: "Tuesday", tuesday: "Tuesday", wed: "Wednesday", weds: "Wednesday", wednesday: "Wednesday",
    thu: "Thursday", thur: "Thursday", thurs: "Thursday", thursday: "Thursday", fri: "Friday", friday: "Friday", sat: "Saturday", saturday: "Saturday", sun: "Sunday", sunday: "Sunday",
  };
  return map[t.toLowerCase()] ?? t;
}

/** Rotary.org meeting time is HHMM / HMM ("1930" = 19:30); otherwise "H:mm[:ss]" or a time-of-day. → "HH:mm:ss" or null. */
export function parseMeetingTime(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const t = raw.trim();
  const fmt = (h: number, m: number, s = 0) => (h < 24 && m < 60 && s < 60 ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : null);
  if (/^\d{4}$/.test(t)) return fmt(Number(t.slice(0, 2)), Number(t.slice(2)));
  if (/^\d{3}$/.test(t)) return fmt(Number(t.slice(0, 1)), Number(t.slice(1)));
  let m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (m) return fmt(Number(m[1]), Number(m[2]), Number(m[3] ?? 0));
  m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/.exec(t);
  if (m) {
    let h = Number(m[1]);
    if (m[4]) h = (h % 12) + (m[4].toLowerCase() === "pm" ? 12 : 0);
    return fmt(h, Number(m[2]), Number(m[3] ?? 0));
  }
  return null;
}

/** Meeting name + street lines (city / state / postcode have their own columns). */
export function buildMeetingAddress(a: RotaryOrgAddress | null | undefined): string | null {
  if (!a) return null;
  const parts = [a.meetingName, a.addressLine1, a.addressLine2, a.addressLine3].filter((p): p is string => !!p && !!p.trim()).map((p) => p.trim());
  return parts.length ? parts.join(", ") : null;
}

/** Port of RotaryOrgTerminatedCacheHelper.UpsertAsync: replace one club's terminated-members cache. */
export async function upsertTerminatedCache(conn: DbCommands, rotaryClubId: number, members: RotaryOrgClubMember[]) {
  await conn.execute("DELETE FROM rotary_org_terminated_cache WHERE fk_rotary_club_id = @C", { C: rotaryClubId });
  const now = utcNowSql();
  for (const m of members)
    await conn.execute(
      `INSERT INTO rotary_org_terminated_cache (fk_rotary_club_id, RotaryMemberId, LocalizedName, Prefix, FirstName, MiddleName, LastName, Suffix, AdmissionDate, TerminationDate,
         TerminationReason, MemberType, LastFetchedUtc)
       VALUES (@C, @M, @LName, @Pre, @F, @Mid, @L, @Suf, @Adm, @Term, @Reason, @Type, @Now)`,
      { C: rotaryClubId, M: m.memberId, LName: m.localizedName, Pre: m.prefix, F: m.firstName, Mid: m.middleName, L: m.lastName, Suf: m.suffix,
        Adm: sqlUtc(m.admissionDate), Term: sqlUtc(m.terminationDate), Reason: m.terminationReason, Type: m.memberType, Now: now });
}

/**
 * Port of ClubCacheRefreshService + ClubCacheRefreshBackgroundService: the Rotary.org /clubs cache, refreshed daily
 * at 08:00 in the brand time zone (RIZones: India time) and seeded at start-up when empty. A 0-club response never
 * wipes the cache. The scheduler only runs when Rotary.org credentials are configured.
 */
@Injectable()
export class ClubCacheRefreshService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger("ClubCacheRefresh");
  private timer: NodeJS.Timeout | null = null;
  constructor(private readonly db: Db, private readonly api: RotaryOrgApiClient, private readonly config: AppConfig) {}

  /** The next 08:00 in the brand time zone, as "yyyy-MM-ddTHH:mm:ssZ". */
  static nextScheduledRunUtc(from = new Date()): string {
    const tz = Brand.Current.locale.defaultTimeZone;
    const wall = nowIn(tz, from);
    const [, H, M, S] = /T(\d{2}):(\d{2}):(\d{2})/.exec(wall)!.map(Number);
    let secs = 8 * 3600 - (H * 3600 + M * 60 + S);
    if (secs <= 0) secs += 24 * 3600;
    return new Date(from.getTime() - from.getMilliseconds() + secs * 1000).toISOString().slice(0, 19) + "Z";
  }

  async refresh(): Promise<{ upserted: number; deleted: number; skippedEmpty: boolean }> {
    const started = Date.now();
    const clubs = await this.api.getClubs();
    if (!clubs.length) {
      this.log.warn("[ClubCacheRefresh] /clubs returned 0 clubs — skipping refresh so the cache is not wiped.");
      return { upserted: 0, deleted: 0, skippedEmpty: true };
    }
    const now = utcNowSql();
    return this.db.session(async (conn) => {
      for (const c of clubs)
        await conn.execute(
          `INSERT INTO rotary_org_clubs_cache (RotaryClubId, ClubName, ClubType, DistrictNumber, Country, NumberOfActiveMembers, LastFetchedUtc)
           VALUES (@RcId, @Name, @Type, @District, @Country, @MemberCount, @Now)
           ON DUPLICATE KEY UPDATE ClubName = VALUES(ClubName), ClubType = VALUES(ClubType), DistrictNumber = VALUES(DistrictNumber), Country = VALUES(Country),
             NumberOfActiveMembers = VALUES(NumberOfActiveMembers), LastFetchedUtc = VALUES(LastFetchedUtc)`,
          // ROW: a club with no country is stored with none (RIZones assumed India).
          { RcId: c.clubId, Name: c.clubName, Type: c.clubType, District: c.districtId === null ? "" : String(c.districtId), Country: c.clubCountry, MemberCount: c.memberCount, Now: now });
      // The cache is exactly the current /clubs set.
      const deleted = await conn.execute("DELETE FROM rotary_org_clubs_cache WHERE LastFetchedUtc < @Now", { Now: now });
      this.log.log(`[ClubCacheRefresh] ${clubs.length} clubs upserted, ${deleted} stale removed in ${Date.now() - started}ms`);
      return { upserted: clubs.length, deleted, skippedEmpty: false };
    });
  }

  lastRefreshUtc() {
    return this.db.executeScalar<string>("SELECT MAX(LastFetchedUtc) FROM rotary_org_clubs_cache");
  }

  onApplicationBootstrap() {
    if (!this.config.backgroundJobsEnabled) return;
    if (!(this.config.get("RotaryOrgApi:Username") ?? "").trim()) {
      this.log.log("Rotary.org club cache refresh is off (RotaryOrgApi credentials not configured).");
      return;
    }
    this.timer = setTimeout(async () => {
      try {
        if (!(await this.lastRefreshUtc())) {
          this.log.log("[ClubCacheRefresh] cache empty on startup — refreshing now.");
          await this.refresh();
        }
      } catch (e) {
        this.log.error(`[ClubCacheRefresh] startup seed check failed: ${(e as Error).message}`);
      }
      this.schedule();
    }, 60_000);
  }

  private schedule() {
    const wait = Math.max(0, Date.parse(ClubCacheRefreshService.nextScheduledRunUtc()) - Date.now());
    this.timer = setTimeout(async () => {
      try {
        const r = await this.refresh();
        if (r.skippedEmpty) this.log.warn("[ClubCacheRefresh] 08:00 run skipped (0 clubs from Rotary.org) — cache preserved.");
        else this.log.log(`[ClubCacheRefresh] 08:00 run OK — ${r.upserted} upserted, ${r.deleted} stale removed.`);
      } catch (e) {
        this.log.error(`[ClubCacheRefresh] 08:00 run failed (next attempt tomorrow): ${(e as Error).message}`);
      }
      // Step past 08:00 so the next run is tomorrow, never a same-day double run.
      this.timer = setTimeout(() => this.schedule(), 120_000);
    }, wait);
  }

  onApplicationShutdown() {
    if (this.timer) clearTimeout(this.timer);
  }
}

interface ClubChange { clubRotaryId: string; clubName: string; districtNumber: string; charterDate: string | null; meetingDay: string }

/**
 * Port of ClubSyncService.cs: the background bootstrap that pulls every Rotary.org club, updates only Rotary.org-owned
 * columns of matching clubs (by ClubRotaryId), inserts new ones, flags vanished synced clubs (never deletes), logs
 * progress to rotary_org_sync_log, and emails a report workbook.
 */
@Injectable()
export class ClubSyncService {
  private readonly log = new Logger("ClubSyncService");
  constructor(private readonly db: Db, private readonly api: RotaryOrgApiClient, private readonly email: EmailService, private readonly config: AppConfig) {}

  async startBootstrap(byEmail: string, byName: string, byMemberId: number): Promise<number> {
    const logId = Number(await this.db.executeScalar(
      "INSERT INTO rotary_org_sync_log (SyncType, StartedAtUtc, Status, TriggeredBy) VALUES ('Bootstrap', UTC_TIMESTAMP(), 'Running', @By); SELECT LAST_INSERT_ID();", { By: byMemberId }));
    void this.runBootstrap(logId, byEmail, byName);
    return logId;
  }

  async status(logId: number) {
    const r = await this.db.queryFirstOrDefault(
      `SELECT pk_id AS logId, SyncType AS syncType, Status AS status, StartedAtUtc AS startedAtUtc, FinishedAtUtc AS finishedAtUtc, TotalFetched AS totalFetched,
              InsertedCount AS insertedCount, UpdatedCount AS updatedCount, DisabledCount AS disabledCount, SkippedDistrictMissing AS skippedDistrictMissing,
              ErrorCount AS errorCount, ErrorDetail AS errorDetail
       FROM rotary_org_sync_log WHERE pk_id = @Id AND isdeleted = 0`, { Id: logId });
    if (!r) return null;
    const start = Date.parse(String(r.startedAtUtc).replace(/Z?$/, "Z")), end = r.finishedAtUtc ? Date.parse(String(r.finishedAtUtc).replace(/Z?$/, "Z")) : NaN;
    return { ...r, durationSeconds: Number.isNaN(end) ? null : Math.trunc((end - start) / 1000) };
  }

  private async runBootstrap(logId: number, toEmail: string, toName: string) {
    const r = { total: 0, ins: 0, upd: 0, dis: 0, skip: 0, err: 0, inserted: [] as ClubChange[], updated: [] as ClubChange[], disabled: [] as ClubChange[],
      skipped: [] as { clubRotaryId: string; clubName: string; districtId: number; reason: string }[] };
    try {
      this.log.log(`🔑 [RI.org sync #${logId}] bootstrap START`);
      const clubs = await this.api.getClubs();
      r.total = clubs.length;
      await this.db.session(async (conn) => {
        const districts = new Map((await conn.query("SELECT pk_district_id AS id, DistrictNumber AS num FROM district_master WHERE isdeleted = 0"))
          .map((d) => [String(d.num ?? "").toLowerCase(), Number(d.id)]));
        const existing = new Map((await conn.query("SELECT pk_club_id AS id, ClubRotaryId AS rid, ClubName AS name, fk_district_id AS districtId, ClubCharterDate AS charter FROM club_master WHERE isdeleted = 0"))
          .map((c) => [String(c.rid ?? "").toLowerCase(), c]));
        const progress = () => conn.execute(
          "UPDATE rotary_org_sync_log SET TotalFetched = @Total, InsertedCount = @Ins, UpdatedCount = @Upd, SkippedDistrictMissing = @Skip, ErrorCount = @Err WHERE pk_id = @Id",
          { Id: logId, Total: r.total, Ins: r.ins, Upd: r.upd, Skip: r.skip, Err: r.err });
        let idx = 0;
        for (const club of clubs) {
          idx++;
          try {
            const districtPk = districts.get(club.districtId === null ? "" : String(club.districtId).toLowerCase());
            if (districtPk === undefined) {
              r.skip++;
              r.skipped.push({ clubRotaryId: String(club.clubId), clubName: club.clubName ?? "", districtId: club.districtId ?? 0, reason: `District ${club.districtId ?? ""} not in local district_master` });
              continue;
            }
            const detail = await this.api.getClubDetail(club.clubType ?? "Rotary Club", club.clubId);
            if (!detail) {
              r.err++;
              this.log.warn(`🔑 [RI.org sync #${logId}] detail 404 for ClubId=${club.clubId}`);
              continue;
            }
            // Only the "Meeting Location" address; none → meeting columns keep their values (COALESCE).
            const addr = detail.addresses?.find((a) => (a.addressType ?? "").toLowerCase() === "meeting location") ?? null;
            const p = {
              DistrictPk: districtPk, ClubName: detail.clubName ?? club.clubName, CharterDate: sqlUtc(detail.charterDate), Country: addr?.country ?? null, State: addr?.state ?? null,
              City: addr?.city ?? null, PinCode: addr?.postalCode ?? null, MeetingAddress: buildMeetingAddress(addr), MeetingDay: normalizeMeetingDay(addr?.meetingDay),
              MeetingFromTime: parseMeetingTime(addr?.meetingTime),
            };
            const change = { clubRotaryId: String(club.clubId), clubName: detail.clubName ?? "", districtNumber: club.districtId === null ? "" : String(club.districtId), charterDate: detail.charterDate,
              meetingDay: addr?.meetingDay ?? "" };
            const row = existing.get(String(club.clubId).toLowerCase());
            if (row) {
              await conn.execute(
                `UPDATE club_master SET fk_district_id = @DistrictPk, ClubName = @ClubName, ClubCharterDate = @CharterDate, Country = @Country, State = @State, City = @City,
                     Pincode = @PinCode, MeetingAddress = COALESCE(@MeetingAddress, MeetingAddress), MeetingDay = COALESCE(@MeetingDay, MeetingDay),
                     MeetingFromTime = @MeetingFromTime, IsSyncedFromRotaryOrg = 1, LastSyncedFromRotaryOrg = NOW(), ROW_as_vendor_selected = 1, modified_date = NOW()
                 WHERE pk_club_id = @Id`, { ...p, Id: row.id });
              r.upd++;
              r.updated.push(change);
            } else {
              // New club: active from the charter date for 70 years; time zone = the brand's (RIZones: India).
              const activeTo = detail.charterDate ? `${Number(detail.charterDate.slice(0, 4)) + 70}${detail.charterDate.slice(4, 10)} ${detail.charterDate.slice(11, 19)}` : null;
              await conn.execute(
                `INSERT INTO club_master (fk_district_id, ClubRotaryId, ClubName, Timezone, ClubCharterDate, MeetingDay, MeetingFromTime, MeetingAddress, Country, State, City, Pincode,
                     ActiveFromDate, ActiveToDate, IsAutomaticMeetingReminder, IsFamilyLogin, IsActive, IsSyncedFromRotaryOrg, LastSyncedFromRotaryOrg, ROW_as_vendor_selected, created_date, isdeleted)
                 VALUES (@DistrictPk, @ClubRotaryId, @ClubName, @Tz, @CharterDate, @MeetingDay, @MeetingFromTime, @MeetingAddress, @Country, @State, @City, @PinCode,
                     @CharterDate, @ActiveTo, 1, 0, 1, 1, NOW(), 1, NOW(), 0)`,
                { ...p, ClubRotaryId: String(club.clubId), Tz: Brand.Current.locale.defaultTimeZone, ActiveTo: activeTo });
              r.ins++;
              r.inserted.push(change);
            }
            if (idx % 100 === 0) {
              await progress();
              this.log.log(`🔑 [RI.org sync #${logId}] progress ${idx}/${clubs.length} — ins=${r.ins} upd=${r.upd} skip=${r.skip} err=${r.err}`);
            }
            // gentle on the Rotary.org API
            await new Promise((res) => setTimeout(res, 100));
          } catch (e) {
            r.err++;
            this.log.error(`🔑 [RI.org sync #${logId}] error on ClubId=${club.clubId}: ${(e as Error).message}`);
          }
        }
        // Clubs synced before but gone from Rotary.org are flagged, never deleted; local-only clubs are untouched.
        const live = new Set(clubs.map((c) => String(c.clubId).toLowerCase()));
        for (const [rid, row] of existing) {
          if (live.has(rid)) continue;
          if (Number(await conn.executeScalar("SELECT IFNULL(IsSyncedFromRotaryOrg, 0) FROM club_master WHERE pk_club_id = @Id", { Id: row.id })) !== 1) continue;
          await conn.execute("UPDATE club_master SET IsSyncedFromRotaryOrg = 0, ROW_as_vendor_selected = 0, modified_date = NOW() WHERE pk_club_id = @Id", { Id: row.id });
          r.dis++;
          r.disabled.push({ clubRotaryId: String(row.rid ?? ""), clubName: String(row.name ?? ""), districtNumber: "", charterDate: row.charter ? String(row.charter) : null, meetingDay: "" });
        }
        await conn.execute(
          `UPDATE rotary_org_sync_log SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Completed', TotalFetched = @Total, InsertedCount = @Ins, UpdatedCount = @Upd,
               DisabledCount = @Dis, SkippedDistrictMissing = @Skip, ErrorCount = @Err WHERE pk_id = @Id`,
          { Id: logId, Total: r.total, Ins: r.ins, Upd: r.upd, Dis: r.dis, Skip: r.skip, Err: r.err });
      });
      this.log.log(`🔑 [RI.org sync #${logId}] DONE — ins=${r.ins} upd=${r.upd} dis=${r.dis} skip=${r.skip} err=${r.err}`);
      await this.sendReport(logId, toEmail, toName, r);
    } catch (e) {
      this.log.error(`🔑 [RI.org sync #${logId}] FAILED: ${(e as Error).message}`);
      await this.db.execute("UPDATE rotary_org_sync_log SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Failed', ErrorDetail = @Err WHERE pk_id = @Id",
        { Id: logId, Err: `${(e as Error).message}\n${(e as Error).stack ?? ""}` }).catch(() => undefined);
    }
  }

  /** To the triggering user plus RotaryOrgSync:ReportRecipients (first = To, the rest CC). */
  private async sendReport(logId: number, byEmail: string, byName: string,
    r: { total: number; ins: number; upd: number; dis: number; skip: number; err: number; inserted: ClubChange[]; updated: ClubChange[]; disabled: ClubChange[];
      skipped: { clubRotaryId: string; clubName: string; districtId: number; reason: string }[] }) {
    try {
      const all = this.config.getArray("RotaryOrgSync:ReportRecipients").map((e) => e.trim()).filter(Boolean);
      if (byEmail.trim() && !all.some((e) => e.toLowerCase() === byEmail.toLowerCase())) all.unshift(byEmail);
      if (!all.length) {
        this.log.warn(`🔑 [RI.org sync #${logId}] no report recipients configured — skipping email`);
        return;
      }
      const wb = new ExcelJS.Workbook();
      const sum = wb.addWorksheet("Summary");
      sum.getCell(1, 1).value = "Rotary.org Bootstrap Sync Report";
      sum.mergeCells(1, 1, 1, 2);
      sum.getCell(1, 1).font = { bold: true, size: 14 };
      [["Log ID", logId], ["Total fetched", r.total], ["New clubs", r.ins], ["Updated clubs", r.upd], ["Disabled clubs", r.dis], ["Skipped (district missing)", r.skip], ["Errors", r.err]]
        .forEach(([k, v], i) => { sum.getCell(3 + i, 1).value = k; sum.getCell(3 + i, 2).value = v; });
      fitColumns(sum);
      const sheet = (name: string, headers: string[], rows: (string | number)[][]) => {
        const ws = wb.addWorksheet(name);
        ws.addRow(headers);
        headers.forEach((_, i) => { const c = ws.getCell(1, i + 1); c.font = { bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD3D3D3" } }; });
        rows.forEach((x) => ws.addRow(x));
        fitColumns(ws);
      };
      const changes = (list: ClubChange[]) => list.map((c) => [c.clubRotaryId, c.clubName, c.districtNumber, c.charterDate ? c.charterDate.slice(0, 10) : "", c.meetingDay]);
      const cols = ["ClubRotaryId", "ClubName", "DistrictNumber", "CharterDate", "MeetingDay"];
      sheet("New Clubs", cols, changes(r.inserted));
      sheet("Updated Clubs", cols, changes(r.updated));
      sheet("Disabled Clubs", cols, changes(r.disabled));
      sheet("Skipped (no district)", ["ClubRotaryId", "ClubName", "RotaryOrgDistrictId", "Reason"], r.skipped.map((x) => [x.clubRotaryId, x.clubName, x.districtId, x.reason]));
      const now = nowIn(Brand.Current.locale.defaultTimeZone);
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const row = (label: string, value: number, color = "") => `<tr><td style='padding:4px 12px;'>${label}</td><td style='padding:4px 12px;${color}'><b>${value}</b></td></tr>`;
      const body = `${emailHeader()}
<h2 style='color:#1a365d;margin-top:0;'>Rotary.org Sync Complete</h2>
<p>Dear ${esc(byName.trim() ? byName : "Admin")},</p>
<p>The Rotary.org bootstrap sync has finished. Summary:</p>
<table style='border-collapse:collapse; margin:12px 0;'>
  ${row("Total fetched", r.total)}${row("New clubs added", r.ins, "color:#16a34a;")}${row("Existing clubs updated", r.upd, "color:#2563eb;")}
  ${row("Clubs disabled (no longer on Rotary.org)", r.dis, "color:#dc2626;")}${row("Skipped (district missing locally)", r.skip, "color:#64748b;")}${row("Errors", r.err, "color:#dc2626;")}
</table>
<p>Full details are in the attached Excel (5 sheets: Summary, New, Updated, Disabled, Skipped).</p>
<p style='color:#64748b;font-size:13px;'>Sync log id: ${logId}. Clubs marked disabled are NOT deleted — they remain in your database with <code>IsSyncedFromRotaryOrg=0</code> and <code>ROW_as_vendor_selected=0</code>.</p>
<p>Regards,<br/><strong>Team ${esc(Brand.Current.productName)}</strong></p>
${emailFooter()}`;
      await this.email.sendEmailWithAttachment(all[0], `Rotary.org Sync Report — ${now.slice(8, 10)} ${months[Number(now.slice(5, 7)) - 1]} ${now.slice(0, 4)}`, body,
        await toBuffer(wb), `RotaryOrg_Sync_Report_${now.slice(0, 10).replace(/-/g, "")}_${now.slice(11, 19).replace(/:/g, "")}.xlsx`, all.slice(1));
      this.log.log(`🔑 [RI.org sync #${logId}] report email sent — to=${all[0]} cc=${all.length - 1}`);
    } catch (e) {
      this.log.error(`🔑 [RI.org sync #${logId}] report email FAILED: ${(e as Error).message}`);
    }
  }
}

/**
 * Port of DistrictRotaryRefreshJobRunner.cs: refresh the terminated-members cache for every Rotary.org-linked club of a
 * district in the background; one running job per district; progress in district_rotary_refresh_jobs.
 */
@Injectable()
export class DistrictRotaryRefreshJobRunner {
  private starting: Promise<unknown> = Promise.resolve();
  constructor(private readonly db: Db, private readonly api: RotaryOrgApiClient) {}

  /** Serialised like the C# SemaphoreSlim(1): an already-running job for the district is returned instead. */
  start(districtId: number, startedBy: number | null) {
    const run = this.starting.then(() => this.startLocked(districtId, startedBy));
    this.starting = run.catch(() => undefined);
    return run;
  }

  private async startLocked(districtId: number, startedBy: number | null) {
    const existing = await this.db.queryFirstOrDefault("SELECT * FROM district_rotary_refresh_jobs WHERE fk_district_id = @D AND Status = 'Running' ORDER BY pk_id DESC LIMIT 1", { D: districtId });
    if (existing) return toJobDto(existing);
    const now = utcNowSql();
    const jobId = Number(await this.db.executeScalar(
      `INSERT INTO district_rotary_refresh_jobs (fk_district_id, Status, TotalLinkedClubs, ClubsDone, StartedByMemberId, StartedUtc, UpdatedUtc)
       VALUES (@DistrictId, 'Running', 0, 0, @StartedBy, @Now, @Now); SELECT LAST_INSERT_ID();`, { DistrictId: districtId, StartedBy: startedBy, Now: now }));
    void this.run(jobId, districtId);
    const iso = now.replace(" ", "T") + "Z";
    return { jobId, districtId, status: "Running", totalLinkedClubs: 0, clubsDone: 0, startedUtc: iso, updatedUtc: iso, finishedUtc: null, warning: null };
  }

  private async run(jobId: number, districtId: number) {
    await this.db.session(async (conn) => {
      try {
        const clubs = await conn.query(
          `SELECT pk_club_id AS clubId, ClubName AS clubName, ClubRotaryId AS clubRotaryId, ClubType AS clubType FROM club_master
           WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND IsActive = 1 AND ClubRotaryId IS NOT NULL AND ClubRotaryId <> '' AND ClubRotaryId REGEXP '^[0-9]+$'
           ORDER BY pk_club_id`, { DistrictId: districtId });
        await conn.execute("UPDATE district_rotary_refresh_jobs SET TotalLinkedClubs = @Total, UpdatedUtc = @Now WHERE pk_id = @JobId", { Total: clubs.length, Now: utcNowSql(), JobId: jobId });
        const failed: string[] = [];
        let done = 0;
        for (const c of clubs) {
          try {
            const rid = Number(c.clubRotaryId);
            const type = c.clubType && String(c.clubType).trim() ? String(c.clubType) : "Rotary Club";
            await upsertTerminatedCache(conn, rid, await this.api.getClubTerminatedMembers(type, rid));
          } catch {
            failed.push(String(c.clubName ?? ""));
          }
          done++;
          await conn.execute("UPDATE district_rotary_refresh_jobs SET ClubsDone = @Done, UpdatedUtc = @Now WHERE pk_id = @JobId", { Done: done, Now: utcNowSql(), JobId: jobId });
        }
        const warning = !failed.length ? null : failed.length === 1 ? `Couldn't refresh 1 club: ${failed[0]}. The rest completed — try that one again later.`
          : `Couldn't refresh ${failed.length} clubs: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? ", …" : ""}. The rest completed — try those again later.`;
        await conn.execute("UPDATE district_rotary_refresh_jobs SET Status = 'Done', Warning = @Warning, FinishedUtc = @Now, UpdatedUtc = @Now WHERE pk_id = @JobId", { Warning: warning, Now: utcNowSql(), JobId: jobId });
      } catch {
        await conn.execute("UPDATE district_rotary_refresh_jobs SET Status = 'Failed', Warning = @Warning, FinishedUtc = @Now, UpdatedUtc = @Now WHERE pk_id = @JobId",
          { Warning: "The refresh stopped unexpectedly partway through. Try starting it again.", Now: utcNowSql(), JobId: jobId }).catch(() => undefined);
      }
    });
  }
}

export const toJobDto = (r: Record<string, unknown>) => ({
  jobId: Number(r.pk_id), districtId: Number(r.fk_district_id), status: r.Status, totalLinkedClubs: Number(r.TotalLinkedClubs ?? 0), clubsDone: Number(r.ClubsDone ?? 0),
  startedUtc: r.StartedUtc, updatedUtc: r.UpdatedUtc, finishedUtc: r.FinishedUtc ?? null, warning: r.Warning ?? null,
});
