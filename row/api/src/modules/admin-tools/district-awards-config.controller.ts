import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField, queryInt, routeInt } from "../../common/binding";
import { formatDate, nowIn } from "../../common/dotnet-format";
import { badRequest, ok, statusCode } from "../../common/results";
import { Brand } from "../../brand/brand";
import { Db, type DbCommands } from "../../database/db.service";
import { isDistrictAwardsEnabled } from "../../services/citation-auto-points.service";
import { DG_EMAIL, DG_JOIN_MEMBER } from "../../services/district-governor-sql";
import { EmailService, emailFooter, emailHeader } from "../../services/email.service";
import { ExcelJS, toBuffer } from "../../services/xlsx";

const REQUIRED = { message: "districtId and yearId are required." };
const now = () => nowIn(Brand.Current.locale.defaultTimeZone);

/** Port of DistrictAwardsConfigController.cs: District Awards on/off, and SuperAdmin clear / restore of club points. */
@Controller()
@Authorize()
export class DistrictAwardsConfigController {
  constructor(private readonly db: Db, private readonly email: EmailService) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private userId = (u: CurrentUser) => { const v = u.findFirst("memberId") ?? ""; return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0; };

  @Get("api/districts/:districtId/awards-config")
  async get(@Param("districtId") d: string, @Query("yearId") y?: string) {
    const [districtId, yearId] = [routeInt(d), queryInt(y, 0)];
    if (districtId <= 0 || yearId <= 0) return badRequest(REQUIRED);
    return ok({ isEnabled: await isDistrictAwardsEnabled(this.db, districtId, yearId) });
  }

  @Put("api/districts/:districtId/awards-config")
  async set(@User() u: CurrentUser, @Param("districtId") d: string, @Body() body: unknown) {
    const districtId = routeInt(d);
    if (!this.isSuperAdmin(u)) return statusCode(403, { message: "Only SuperAdmin can enable/disable District Awards." });
    const yearId = Math.trunc(Number(bodyField(body, "yearId")) || 0);
    const isEnabled = bodyField(body, "isEnabled") === true;
    if (districtId <= 0 || yearId <= 0) return badRequest(REQUIRED);
    await this.db.execute(
      `INSERT INTO district_awards_config (fk_district_id, fk_year_id, is_enabled, modified_by, modified_date, created_date)
       VALUES (@D, @Y, @E, @U, NOW(), NOW())
       ON DUPLICATE KEY UPDATE is_enabled = @E, modified_by = @U, modified_date = NOW()`,
      { D: districtId, Y: yearId, E: isEnabled ? 1 : 0, U: this.userId(u) },
    );
    return ok({ message: isEnabled ? "District Awards enabled." : "District Awards disabled.", isEnabled });
  }

  @Get("api/districts/:districtId/awards-clear-status")
  async clearStatus(@User() u: CurrentUser, @Param("districtId") d: string, @Query("yearId") y?: string) {
    const [districtId, yearId] = [routeInt(d), queryInt(y, 0)];
    const empty = { liveEntryCount: 0, liveClubCount: 0, canClear: false, canRestore: false, lastClearedDate: null, lastClearedCount: 0 };
    if (!this.isSuperAdmin(u)) return ok({ ...empty, isSuperAdmin: false });
    if (districtId <= 0 || yearId <= 0) return badRequest(REQUIRED);
    const p = { D: districtId, Y: yearId };
    const live = Number(await this.db.executeScalar("SELECT COUNT(*) FROM district_citation_club_entry WHERE fk_district_id=@D AND fk_year_id=@Y AND isdeleted=0", p));
    const liveClubs = Number(await this.db.executeScalar("SELECT COUNT(DISTINCT fk_club_id) FROM district_citation_club_entry WHERE fk_district_id=@D AND fk_year_id=@Y AND isdeleted=0", p));
    const batch = await this.db.queryFirstOrDefault(
      `SELECT batch_id AS batchId, DATE_FORMAT(MAX(cleared_date),'%Y-%m-%d %H:%i') AS clearedDate, COUNT(*) AS cnt
       FROM district_citation_club_entry_backup WHERE fk_district_id=@D AND fk_year_id=@Y AND restored=0
       GROUP BY batch_id ORDER BY MAX(cleared_date) DESC LIMIT 1`, p);
    return ok({
      liveEntryCount: live, liveClubCount: liveClubs, canClear: live > 0, canRestore: !!batch,
      lastClearedDate: batch?.clearedDate ?? null, lastClearedCount: batch ? Number(batch.cnt) : 0, isSuperAdmin: true,
    });
  }

  /** Snapshot to the backup table, email the Excel to the DG and District Admins, then soft-delete the live entries. */
  @Post("api/districts/:districtId/awards-clear")
  async clearAll(@User() u: CurrentUser, @Param("districtId") d: string, @Query("yearId") y?: string) {
    const [districtId, yearId] = [routeInt(d), queryInt(y, 0)];
    if (!this.isSuperAdmin(u)) return statusCode(403, { message: "Only SuperAdmin can clear club points." });
    if (districtId <= 0 || yearId <= 0) return badRequest(REQUIRED);
    const p = { D: districtId, Y: yearId, U: this.userId(u) };
    const liveCount = Number(await this.db.executeScalar("SELECT COUNT(*) FROM district_citation_club_entry WHERE fk_district_id=@D AND fk_year_id=@Y AND isdeleted=0", p));
    if (liveCount === 0) return badRequest({ message: "There are no club points to clear for this district and year." });
    const [districtNumber, yearLabel] = await this.labels(districtId, yearId);
    const batchId = `${districtId}-${yearId}-${formatDate(now(), "yyyyMMddHHmmss")}`;
    // The Excel records exactly what is being cleared, built before the delete.
    const excel = await this.clearedEntriesExcel(districtId, yearId, districtNumber, yearLabel);
    await this.db.session((conn) => conn.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO district_citation_club_entry_backup
            (batch_id, fk_district_id, fk_year_id, fk_club_id, entry_type, fk_question_id, fk_sub_question_id,
             answer_value, points_earned, bonus_earned, orig_created_by, orig_created_date, cleared_by, cleared_date, restored)
         SELECT @B, fk_district_id, fk_year_id, fk_club_id, entry_type, fk_question_id, fk_sub_question_id,
             answer_value, points_earned, bonus_earned, created_by, created_date, @U, NOW(), 0
         FROM district_citation_club_entry WHERE fk_district_id=@D AND fk_year_id=@Y AND isdeleted=0`, { ...p, B: batchId });
      await tx.execute("UPDATE district_citation_club_entry SET isdeleted=1, modified_by=@U, modified_date=NOW() WHERE fk_district_id=@D AND fk_year_id=@Y AND isdeleted=0", p);
    }));
    const recipients = await this.recipients(this.db, districtId, yearId);
    const emailedTo: string[] = [];
    if (recipients.length > 0) {
      const body = emailHeader() +
        "<h2 style='color:#1a365d;margin-top:0;'>District Awards — Club Points Cleared</h2>" +
        "<p>Dear Sir/Madam,</p>" +
        `<p>The District Awards club points for <strong>District ${districtNumber}</strong>, Rotary Year <strong>${yearLabel}</strong> ` +
        `were cleared by a SuperAdmin on <strong>${formatDate(now(), "dd MMM yyyy, hh:mm tt")}</strong>.</p>` +
        "<div style='background-color:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;'>" +
        `<p style='margin:0;'><strong>${liveCount}</strong> point entr${liveCount === 1 ? "y was" : "ies were"} cleared.</p>` +
        "<p style='margin:8px 0 0;'>The full detail (club name, category, question / criteria, answer and points) is attached as an Excel file for your records.</p>" +
        "</div>" +
        `<p>This can be <strong>restored on request</strong>. If this was not expected, please contact the ${Brand.Current.productName} admin team.</p>` +
        emailFooter();
      try {
        await this.email.sendEmailWithAttachment(recipients[0], `District ${districtNumber} — Award club points cleared (RY ${yearLabel})`, body, excel,
          `District-${districtNumber}-Awards-Cleared-${formatDate(now(), "yyyyMMdd_HHmmss")}.xlsx`, recipients.slice(1));
        emailedTo.push(...recipients);
      } catch {
        // The clear and backup are committed; email trouble does not fail the request.
      }
    }
    return ok({
      message: `Cleared ${liveCount} club entr${liveCount === 1 ? "y" : "ies"} for District ${districtNumber} (RY ${yearLabel}). A backup was taken and can be restored.`,
      clearedCount: liveCount, emailedTo, batchId,
    });
  }

  /** Restores the latest not-yet-restored batch (entries added since the clear are soft-deleted first). */
  @Post("api/districts/:districtId/awards-restore")
  async restoreAll(@User() u: CurrentUser, @Param("districtId") d: string, @Query("yearId") y?: string) {
    const [districtId, yearId] = [routeInt(d), queryInt(y, 0)];
    if (!this.isSuperAdmin(u)) return statusCode(403, { message: "Only SuperAdmin can restore club points." });
    if (districtId <= 0 || yearId <= 0) return badRequest(REQUIRED);
    const p = { D: districtId, Y: yearId, U: this.userId(u) };
    const batchId = await this.db.executeScalar<string>(
      "SELECT batch_id FROM district_citation_club_entry_backup WHERE fk_district_id=@D AND fk_year_id=@Y AND restored=0 ORDER BY cleared_date DESC LIMIT 1", p);
    if (!batchId) return badRequest({ message: "There is no cleared backup to restore for this district and year." });
    const restored = await this.db.session((conn) => conn.transaction(async (tx) => {
      await tx.execute("UPDATE district_citation_club_entry SET isdeleted=1, modified_by=@U, modified_date=NOW() WHERE fk_district_id=@D AND fk_year_id=@Y AND isdeleted=0", p);
      const n = await tx.execute(
        `INSERT INTO district_citation_club_entry
            (fk_district_id, fk_year_id, fk_club_id, entry_type, fk_question_id, fk_sub_question_id,
             answer_value, points_earned, bonus_earned, created_by, created_date, modified_by, modified_date, isdeleted)
         SELECT fk_district_id, fk_year_id, fk_club_id, entry_type, fk_question_id, fk_sub_question_id,
             answer_value, points_earned, bonus_earned, orig_created_by, orig_created_date, @U, NOW(), 0
         FROM district_citation_club_entry_backup WHERE batch_id=@B`, { ...p, B: batchId });
      await tx.execute("UPDATE district_citation_club_entry_backup SET restored=1, restored_date=NOW() WHERE batch_id=@B", { B: batchId });
      return n;
    }));
    return ok({ message: `Restored ${restored} club entr${restored === 1 ? "y" : "ies"}.`, restoredCount: restored });
  }

  private async labels(districtId: number, yearId: number): Promise<[string, string]> {
    const dn = await this.db.executeScalar<string>("SELECT DistrictNumber FROM district_master WHERE pk_district_id=@D", { D: districtId });
    const yl = await this.db.executeScalar<string>("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id=@Y", { Y: yearId });
    return [dn ?? String(districtId), yl ?? String(yearId)];
  }

  /** The DG (member profile or the DG row itself) plus every active District Admin, de-duplicated. */
  private async recipients(conn: DbCommands, districtId: number, yearId: number) {
    const emails: string[] = [];
    const dg = await conn.executeScalar<string>(
      `SELECT ${DG_EMAIL} FROM district_governors g ${DG_JOIN_MEMBER}
       WHERE g.fk_district_id=@D AND g.fk_year_id=@Y AND g.isdeleted=0 AND ${DG_EMAIL} IS NOT NULL AND TRIM(${DG_EMAIL}) <> '' LIMIT 1`, { D: districtId, Y: yearId });
    if (dg && dg.trim()) emails.push(dg.trim());
    for (const r of await conn.query(
      `SELECT DISTINCT m.EmailId AS e FROM member_roles r
       JOIN member_master_profile m ON m.pk_member_master_profile_id = r.fk_member_master_profile_id AND COALESCE(m.isdeleted,0)=0
       WHERE r.fk_role_id=2 AND r.fk_district_id=@D AND (r.fk_club_id IS NULL OR r.fk_club_id=0) AND r.IsActive=1 AND r.isdeleted=0
         AND m.EmailId IS NOT NULL AND TRIM(m.EmailId) <> ''`, { D: districtId })) {
      const e = String(r.e ?? "").trim();
      if (e) emails.push(e);
    }
    return emails.filter((e, i) => emails.findIndex((x) => x.toLowerCase() === e.toLowerCase()) === i);
  }

  private async clearedEntriesExcel(districtId: number, yearId: number, districtNumber: string, yearLabel: string) {
    const rows = await this.db.query(
      `SELECT cm.ClubName AS clubName, e.entry_type AS entryType, COALESCE(acat.category_name, mcat.category_name) AS category,
              COALESCE(aact.activity_name, mc.criteria_name) AS question, COALESCE(asub.sub_item_name, msc.sub_criteria_title) AS subItem,
              e.answer_value AS answerValue, e.points_earned AS points, e.bonus_earned AS bonus
       FROM district_citation_club_entry e
       JOIN club_master cm ON cm.pk_club_id = e.fk_club_id
       LEFT JOIN district_citation_auto_question aq ON e.entry_type='auto' AND aq.pk_id = e.fk_question_id
       LEFT JOIN district_citation_category acat ON acat.pk_id = aq.fk_category_id
       LEFT JOIN district_citation_activity_master aact ON aact.pk_id = aq.fk_activity_id
       LEFT JOIN district_citation_auto_question_sub asub ON asub.pk_id = e.fk_sub_question_id
       LEFT JOIN district_citation_manual_sub_criteria msc ON e.entry_type='manual' AND msc.pk_id = e.fk_question_id
       LEFT JOIN district_citation_manual_criteria mc ON mc.pk_id = msc.fk_criteria_id
       LEFT JOIN district_citation_category mcat ON mcat.pk_id = mc.fk_category_id
       WHERE e.fk_district_id=@D AND e.fk_year_id=@Y AND e.isdeleted=0
       ORDER BY cm.ClubName, e.entry_type, category, question`, { D: districtId, Y: yearId });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Cleared Points");
    const t = ws.getCell(1, 1);
    t.value = `District ${districtNumber} — Award Club Points Cleared · RY ${yearLabel} · ${formatDate(now(), "dd MMM yyyy, hh:mm tt")}`;
    ws.mergeCells(1, 1, 1, 8);
    t.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
    t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    ["Club", "Type", "Category", "Question / Criteria", "Sub Item", "Answer", "Points", "Bonus"].forEach((h, i) => {
      const c = ws.getCell(3, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF274B73" } };
    });
    let r = 4;
    for (const row of rows)
      ws.getRow(r++).values = [String(row.clubName ?? ""), String(row.entryType ?? "").toUpperCase() === "AUTO" ? "Auto" : "Manual", String(row.category ?? ""),
        String(row.question ?? ""), String(row.subItem ?? ""), String(row.answerValue ?? ""), Number(row.points ?? 0), Number(row.bonus ?? 0)];
    for (let c = 1; c <= 8; c++) {
      let w = 8;
      for (let rr = 3; rr < r; rr++) w = Math.max(w, String(ws.getCell(rr, c).value ?? "").length + 2);
      ws.getColumn(c).width = w;
    }
    ws.views = [{ state: "frozen", ySplit: 3 }];
    return toBuffer(wb);
  }
}
