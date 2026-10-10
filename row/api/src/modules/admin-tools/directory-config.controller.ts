import { Body, Controller, Delete, Get, Logger, Param, Post, Put, Query } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField, queryInt, queryString, routeInt } from "../../common/binding";
import { badRequest, conflict, file, forbid, notFound, ok } from "../../common/results";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { Db, type DbCommands } from "../../database/db.service";
import { hashProxyPassword } from "../../services/admin-proxy-auth";
import {
  ALL_FIELDS, applySpouseNotApplicable, buildCompletedAndPendingHtml, buildContactText, computeCompletion, configIncludesSpouseFields, deserializeKeys,
  getSpouseNotApplicableMap, groupKeys, loadValues, resolveGroup, serializeKeys,
} from "../../services/directory-data-collection-fields";
import { EmailService, emailFooter, emailHeader } from "../../services/email.service";
import { memberE164, WhatsAppSender } from "../../services/messaging";
import { ExcelJS, toBuffer, XLSX_CONTENT_TYPE } from "../../services/xlsx";
import { mapLimit } from "../goal-setting/goal-reports";

interface ConfigRecord {
  id: number; districtId: number; districtNumber: string; yearId: number; yearLabel: string; urlHash: string; dcFieldsJson: string; bodFieldsJson: string; memberFieldsJson: string;
  firstContactName: string | null; firstContactMobile: string | null; secondContactName: string | null; secondContactMobile: string | null; sendEmail: number; sendWhatsapp: number;
}
interface DistrictMember { memberId: number; name: string; mobile: string | null; email: string | null; clubName: string | null }
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const strList = (b: unknown, k: string) => { const v = bodyField(b, k); return Array.isArray(v) ? v.map(String) : []; };
const str = (b: unknown, k: string) => { const v = bodyField(b, k); return v === null || v === undefined ? null : String(v); };
const flag = (b: unknown, k: string) => bodyField(b, k) !== false;
/** Meta rejects blank template params or ones with tabs / newlines / runs of spaces. */
export const templateParam = (v: string) => { const s = (v ?? "").replace(/\s+/g, " ").trim(); return s || "-"; };

/** Port of DirectoryDataCollectionController.cs: district directory data-collection links (SuperAdmin). */
@Controller("api/admin/directory-config")
@Authorize()
export class DirectoryConfigController {
  private readonly log = new Logger("DirectoryConfigController");
  constructor(private readonly db: Db, private readonly config: AppConfig, private readonly email: EmailService, private readonly whatsApp: WhatsAppSender) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private userId = (u: CurrentUser) => {
    const v = u.findFirst("memberId") ?? u.findFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier") ?? "";
    return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0;
  };
  private get apiBase() { return this.config.get("Api:BaseUrl") ?? this.config.get("BackendUrl") ?? ""; }
  private get publicBase() { return this.config.get("PublicFrontend:BaseUrl") ?? this.config.get("FrontendUrl") ?? Brand.Current.domains.adminOrigin; }
  private publicUrl = (hash: string) => `${this.publicBase.replace(/\/+$/, "")}/public/directory-data-collection?ID=${hash}`;

  @Get("member-fields")
  memberFields(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    const sections: { section: string; fields: { key: string; label: string; type: string }[] }[] = [];
    for (const f of ALL_FIELDS) {
      let s = sections.find((x) => x.section === f.section);
      if (!s) sections.push((s = { section: f.section, fields: [] }));
      s.fields.push({ key: f.key, label: f.label, type: f.type });
    }
    return ok(sections);
  }

  @Get()
  async list(@User() u: CurrentUser, @Query("districtId") d?: string, @Query("yearId") y?: string) {
    if (!this.isSuperAdmin(u)) return forbid();
    const rows = await this.db.query(
      `SELECT c.pk_id AS Id, c.fk_district_id AS DistrictId, d.DistrictNumber, c.fk_year_id AS YearId, y.YearLabel, c.UrlHash,
              c.FirstContactName, c.FirstContactMobile, c.SecondContactName, c.SecondContactMobile,
              CAST(COALESCE(c.SendEmail, 1) AS SIGNED) AS SendEmail, CAST(COALESCE(c.SendWhatsapp, 1) AS SIGNED) AS SendWhatsapp,
              CAST(COALESCE(c.IsActive, 1) AS SIGNED) AS IsActive, c.created_date AS CreatedDate, c.modified_date AS ModifiedDate
       FROM district_directory_config c JOIN district_master d ON d.pk_district_id = c.fk_district_id JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
       WHERE c.isdeleted = 0 AND (@districtId IS NULL OR c.fk_district_id = @districtId) AND (@yearId IS NULL OR c.fk_year_id = @yearId)
       ORDER BY y.YearLabel DESC, CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber`,
      { districtId: queryInt(d), yearId: queryInt(y) });
    // A record serialises with camelCase property names.
    return ok(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k[0].toLowerCase() + k.slice(1), v]))));
  }

  @Get(":id")
  async byId(@User() u: CurrentUser, @Param("id") idText: string) {
    const id = routeInt(idText);
    if (!this.isSuperAdmin(u)) return forbid();
    const row = await this.db.queryFirstOrDefault(
      `SELECT c.pk_id AS id, c.fk_district_id AS districtId, d.DistrictNumber AS districtNumber, c.fk_year_id AS yearId, y.YearLabel AS yearLabel, c.UrlHash AS urlHash,
              c.FirstContactName AS firstContactName, c.FirstContactMobile AS firstContactMobile,
              (c.FirstContactPasswordHash IS NOT NULL AND c.FirstContactPasswordHash <> '') AS isFirstContactPasswordSet,
              c.SecondContactName AS secondContactName, c.SecondContactMobile AS secondContactMobile,
              (c.SecondContactPasswordHash IS NOT NULL AND c.SecondContactPasswordHash <> '') AS isSecondContactPasswordSet,
              c.DcFieldsJson AS dcFieldsJson, c.BodFieldsJson AS bodFieldsJson, c.MemberFieldsJson AS memberFieldsJson,
              COALESCE(c.SendEmail, 1) AS sendEmail, COALESCE(c.SendWhatsapp, 1) AS sendWhatsapp, c.created_date AS createdDate, c.modified_date AS modifiedDate
       FROM district_directory_config c JOIN district_master d ON d.pk_district_id = c.fk_district_id JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
       WHERE c.pk_id = @id AND c.isdeleted = 0`, { id });
    if (!row) return notFound();
    row.dcFields = deserializeKeys(row.dcFieldsJson as string | null);
    row.bodFields = deserializeKeys(row.bodFieldsJson as string | null);
    row.memberFields = deserializeKeys(row.memberFieldsJson as string | null);
    return ok(row);
  }

  private upsertParams(body: unknown) {
    const pw = (k: string) => { const v = str(body, k); return v ? hashProxyPassword(v) : null; };
    return {
      FirstContactName: str(body, "firstContactName"), FirstContactMobile: str(body, "firstContactMobile"), FirstHash: pw("firstContactPassword"),
      SecondContactName: str(body, "secondContactName"), SecondContactMobile: str(body, "secondContactMobile"), SecondHash: pw("secondContactPassword"),
      Dc: serializeKeys(strList(body, "dcFields")), Bod: serializeKeys(strList(body, "bodFields")), Mem: serializeKeys(strList(body, "memberFields")),
      SendEmail: flag(body, "sendEmail") ? 1 : 0, SendWhatsapp: flag(body, "sendWhatsapp") ? 1 : 0,
    };
  }

  @Post()
  async create(@User() u: CurrentUser, @Body() body: unknown) {
    if (!this.isSuperAdmin(u)) return forbid();
    const districtId = Math.trunc(Number(bodyField(body, "districtId")) || 0), yearId = Math.trunc(Number(bodyField(body, "yearId")) || 0);
    if (districtId <= 0 || yearId <= 0) return badRequest({ message: "DistrictId and YearId are required" });
    if (!str(body, "firstContactName")?.trim() || !str(body, "firstContactMobile")?.trim()) return badRequest({ message: "First Contact Name and First Contact Mobile are required." });
    const dup = Number(await this.db.executeScalar("SELECT COUNT(*) FROM district_directory_config WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId AND isdeleted = 0", { DistrictId: districtId, YearId: yearId }));
    if (dup > 0) return conflict({ message: "A config already exists for this district + year. Edit it instead." });
    const urlHash = randomBytes(24).toString("hex");
    const id = await this.db.session(async (conn) => Number(await conn.executeScalar(
      `INSERT INTO district_directory_config
          (fk_district_id, fk_year_id, UrlHash, FirstContactName, FirstContactMobile, FirstContactPasswordHash,
           SecondContactName, SecondContactMobile, SecondContactPasswordHash, DcFieldsJson, BodFieldsJson, MemberFieldsJson, SendEmail, SendWhatsapp, created_by)
       VALUES (@DistrictId, @YearId, @UrlHash, @FirstContactName, @FirstContactMobile, @FirstHash, @SecondContactName, @SecondContactMobile, @SecondHash,
               @Dc, @Bod, @Mem, @SendEmail, @SendWhatsapp, @UserId);
       SELECT LAST_INSERT_ID();`,
      { ...this.upsertParams(body), DistrictId: districtId, YearId: yearId, UrlHash: urlHash, UserId: this.userId(u) })));
    return ok({ id, urlHash });
  }

  /** A blank password keeps the stored hash. */
  @Put(":id")
  async update(@User() u: CurrentUser, @Param("id") idText: string, @Body() body: unknown) {
    const id = routeInt(idText);
    if (!this.isSuperAdmin(u)) return forbid();
    if (!str(body, "firstContactName")?.trim() || !str(body, "firstContactMobile")?.trim()) return badRequest({ message: "First Contact Name and First Contact Mobile are required." });
    if (Number(await this.db.executeScalar("SELECT COUNT(*) FROM district_directory_config WHERE pk_id = @id AND isdeleted = 0", { id })) === 0) return notFound();
    await this.db.execute(
      `UPDATE district_directory_config SET FirstContactName = @FirstContactName, FirstContactMobile = @FirstContactMobile,
           FirstContactPasswordHash = COALESCE(@FirstHash, FirstContactPasswordHash), SecondContactName = @SecondContactName, SecondContactMobile = @SecondContactMobile,
           SecondContactPasswordHash = COALESCE(@SecondHash, SecondContactPasswordHash), DcFieldsJson = @Dc, BodFieldsJson = @Bod, MemberFieldsJson = @Mem,
           SendEmail = @SendEmail, SendWhatsapp = @SendWhatsapp, modified_by = @UserId
       WHERE pk_id = @id`,
      { ...this.upsertParams(body), id, UserId: this.userId(u) });
    return ok({ id });
  }

  /** A live link cannot be deleted: close it first. */
  @Delete(":id")
  async remove(@User() u: CurrentUser, @Param("id") idText: string) {
    const id = routeInt(idText);
    if (!this.isSuperAdmin(u)) return forbid();
    const active = await this.db.executeScalar("SELECT COALESCE(IsActive, 1) FROM district_directory_config WHERE pk_id = @id AND isdeleted = 0", { id });
    if (active === null || active === undefined) return notFound();
    if (Number(active) === 1) return conflict({ message: "Close (disable) the link before deleting it." });
    const n = await this.db.execute("UPDATE district_directory_config SET isdeleted = 1, modified_by = @u WHERE pk_id = @id AND isdeleted = 0", { id, u: this.userId(u) });
    return n === 0 ? notFound() : ok({ id, deleted: true });
  }

  @Put(":id/toggle-active")
  async toggle(@User() u: CurrentUser, @Param("id") idText: string) {
    const id = routeInt(idText);
    if (!this.isSuperAdmin(u)) return forbid();
    const n = await this.db.execute("UPDATE district_directory_config SET IsActive = IF(COALESCE(IsActive, 1) = 1, 0, 1), modified_by = @u WHERE pk_id = @id AND isdeleted = 0", { id, u: this.userId(u) });
    if (n === 0) return notFound();
    const isActive = Number(await this.db.executeScalar("SELECT COALESCE(IsActive, 1) FROM district_directory_config WHERE pk_id = @id", { id }));
    return ok({ id, isActive, message: isActive === 1 ? "Link enabled." : 'Link disabled — the public form now shows "Link is closed".' });
  }

  /** Queues email / WhatsApp reminders to every member below 100% for their group; returns at once. */
  @Post(":id/send-reminders")
  async sendReminders(@User() u: CurrentUser, @Param("id") idText: string, @Query("channel") ch?: string) {
    const id = routeInt(idText);
    if (!this.isSuperAdmin(u)) return forbid();
    const channel = queryString(ch, "both")!;
    if (!["email", "whatsapp", "both"].includes(channel)) return badRequest({ message: "channel must be email|whatsapp|both" });
    const cfg = await this.loadConfig(this.db, id);
    if (!cfg) return notFound();
    void this.remindersInBackground(cfg, channel);
    return ok({ message: "Reminders queued. They will be sent in background." });
  }

  private async remindersInBackground(cfg: ConfigRecord, channel: string) {
    const c = { emailOk: 0, emailFail: 0, waOk: 0, waFail: 0, complete: 0, noFields: 0, processed: 0 };
    try {
      const members = await this.districtMembers(this.db, cfg.districtId);
      const url = this.publicUrl(cfg.urlHash);
      const spouseNa = await getSpouseNotApplicableMap(this.db, cfg.id);
      this.log.log(`REMINDER BATCH START — config=${cfg.id} district=${cfg.districtNumber} year=${cfg.yearLabel} channel=${channel} members=${members.length}`);
      const contact = buildContactText(cfg.firstContactName, cfg.firstContactMobile, cfg.secondContactName, cfg.secondContactMobile);
      for (const m of members) {
        try {
          const group = await resolveGroup(this.db, m.memberId, cfg.districtId, cfg.yearId);
          const raw = groupKeys(group, cfg.dcFieldsJson, cfg.bodFieldsJson, cfg.memberFieldsJson);
          if (raw.length === 0) { c.noFields++; continue; }
          const keys = applySpouseNotApplicable(raw, spouseNa.get(m.memberId) === true);
          const values = await loadValues(this.db, m.memberId, keys);
          const { filled, total, pendingLabels } = computeCompletion(values, keys);
          if (filled >= total) { c.complete++; continue; }
          c.processed++;
          if ((channel === "email" || channel === "both") && cfg.sendEmail !== 0 && m.email && m.email.trim()) {
            const html = reminderHtml(m.name, cfg.yearLabel, cfg.districtNumber, filled, total, buildCompletedAndPendingHtml(keys, values, this.apiBase), url, contact);
            try {
              await this.email.send(m.email, `District Directory ${cfg.yearLabel} — Data Collection Reminder`, html, { throwOnFailure: true });
              c.emailOk++;
            } catch (e) {
              c.emailFail++;
              this.log.warn(`[EMAIL] ${m.name} → ${m.email} FAILED: ${(e as Error).message}`);
            }
          }
          if ((channel === "whatsapp" || channel === "both") && cfg.sendWhatsapp !== 0 && m.mobile && m.mobile.trim()) {
            const pendingList = pendingLabels.map((p, i) => `${i + 1}) ${p}`).join("\n");
            const e164 = await memberE164(this.db, m.memberId, m.mobile);
            const sent = e164 !== null && await this.whatsApp.sendTemplate(e164, "district_directory_form_incomplete_final", Brand.Current.locale.defaultLanguage,
              [m.name ?? "", cfg.yearLabel, cfg.districtNumber, String(pendingLabels.length), String(total), pendingList, url, contact].map(templateParam)).catch(() => false);
            if (sent) c.waOk++;
            else { c.waFail++; this.log.warn(`[WHATSAPP] ${m.name} → ${m.mobile} not sent`); }
          }
        } catch (e) {
          this.log.warn(`Reminder failed for member ${m.memberId}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.log.error(`Reminder batch failed for config ${cfg.id}: ${(e as Error).message}`);
    } finally {
      this.log.log(`REMINDER BATCH DONE — config=${cfg.id} processed=${c.processed} skippedComplete=${c.complete} skippedNoFields=${c.noFields} | email ok=${c.emailOk} fail=${c.emailFail} | whatsapp ok=${c.waOk} fail=${c.waFail}`);
    }
  }

  /** Per-member completion for one member (shared by the report and the Excel). */
  private async completion(conn: DbCommands, cfg: ConfigRecord, m: DistrictMember, spouseNa: Map<number, boolean>) {
    const group = await resolveGroup(conn, m.memberId, cfg.districtId, cfg.yearId);
    const raw = groupKeys(group, cfg.dcFieldsJson, cfg.bodFieldsJson, cfg.memberFieldsJson);
    if (raw.length === 0) return null;
    const memberNa = spouseNa.get(m.memberId) === true;
    const keys = applySpouseNotApplicable(raw, memberNa);
    const values = await loadValues(conn, m.memberId, keys);
    const { filled, total, pendingLabels } = computeCompletion(values, keys);
    return { group, filled, total, pct: total > 0 ? Math.round((100 * filled) / total) : 0, pending: pendingLabels, memberNa, hadSpouse: configIncludesSpouseFields(raw) };
  }

  @Get(":id/report")
  async report(@User() u: CurrentUser, @Param("id") idText: string) {
    const id = routeInt(idText);
    if (!this.isSuperAdmin(u)) return forbid();
    const cfg = await this.loadConfig(this.db, id);
    if (!cfg) return notFound();
    const members = await this.districtMembers(this.db, cfg.districtId);
    const spouseNa = await getSpouseNotApplicableMap(this.db, cfg.id);
    const buckets: Record<"dc" | "bod" | "member", { rows: object[]; filled: number; total: number }> = { dc: { rows: [], filled: 0, total: 0 }, bod: { rows: [], filled: 0, total: 0 }, member: { rows: [], filled: 0, total: 0 } };
    for (const m of members) {
      const r = await this.completion(this.db, cfg, m, spouseNa);
      if (!r) continue;
      const b = buckets[r.group === "DC" ? "dc" : r.group === "BOD" ? "bod" : "member"];
      b.rows.push({ memberId: m.memberId, name: m.name, mobile: m.mobile, email: m.email, clubName: m.clubName, filled: r.filled, total: r.total, percent: r.pct,
        pendingFields: r.pending, spouseApplicable: !r.memberNa, spouseInConfig: r.hadSpouse });
      b.filled += r.filled;
      b.total += r.total;
    }
    const pct = (f: number, t: number) => (t > 0 ? Math.round((100 * f) / t) : 0);
    const sum = (b: { rows: object[]; filled: number; total: number }) => ({ count: b.rows.length, filled: b.filled, total: b.total, percent: pct(b.filled, b.total) });
    return ok({
      config: { id: cfg.id, districtNumber: cfg.districtNumber, yearLabel: cfg.yearLabel, urlHash: cfg.urlHash },
      summary: { dc: sum(buckets.dc), bod: sum(buckets.bod), member: sum(buckets.member) },
      dc: buckets.dc.rows, bod: buckets.bod.rows, member: buckets.member.rows,
    });
  }

  /** Three sheets (DC, BOD, Members); the per-member lookups run 12 at a time, kept in member order. */
  @Get(":id/report/excel")
  async reportExcel(@User() u: CurrentUser, @Param("id") idText: string) {
    const id = routeInt(idText);
    if (!this.isSuperAdmin(u)) return forbid();
    const cfg = await this.loadConfig(this.db, id);
    if (!cfg) return notFound();
    const members = await this.districtMembers(this.db, cfg.districtId);
    const spouseNa = await getSpouseNotApplicableMap(this.db, cfg.id);
    const results = await mapLimit(members, 12, (m) => this.completion(this.db, cfg, m, spouseNa).then((r) => ({ m, r })));
    const sheets: Record<string, (string | number)[][]> = { DC: [], BOD: [], Member: [] };
    for (const { m, r } of results) {
      if (!r) continue;
      sheets[r.group === "DC" ? "DC" : r.group === "BOD" ? "BOD" : "Member"].push([m.name, m.mobile ?? "", m.email ?? "", m.clubName ?? "", `${r.filled} / ${r.total}`, `${r.pct}%`,
        !r.hadSpouse ? "—" : r.memberNa ? "No" : "Yes", r.pending.join(", ")]);
    }
    const wb = new ExcelJS.Workbook();
    const add = (title: string, rows: (string | number)[][]) => {
      const ws = wb.addWorksheet(title);
      ws.getCell(1, 1).value = `District ${cfg.districtNumber} — ${cfg.yearLabel} — ${title}`;
      ws.mergeCells(1, 1, 1, 9);
      ws.getCell(1, 1).font = { bold: true, size: 14 };
      ws.getCell(1, 1).alignment = { horizontal: "center" };
      ["Sr", "Name", "Mobile", "Email", "Club", "Filled / Total", "%", "Spouse Applicable", "Pending Fields"].forEach((h, i) => {
        const c = ws.getCell(3, i + 1);
        c.value = h;
        c.font = { bold: true };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD3D3D3" } };
        c.border = { bottom: { style: "thin" } };
      });
      rows.forEach((x, i) => (ws.getRow(4 + i).values = [i + 1, ...x]));
      for (let c = 1; c <= 8; c++) {
        let w = 8;
        for (let r = 3; r < 4 + rows.length; r++) w = Math.max(w, String(ws.getCell(r, c).value ?? "").length + 2);
        ws.getColumn(c).width = w;
      }
      ws.getColumn(9).width = 60;
    };
    add("DC (District Committee)", sheets.DC);
    add("BOD (Pres+Sec)", sheets.BOD);
    add("Members", sheets.Member);
    return file(await toBuffer(wb), XLSX_CONTENT_TYPE, `DistrictDirectory_${cfg.districtNumber}_${cfg.yearLabel}.xlsx`.replace(/\//g, "-"));
  }

  @Get(":id/public-url")
  async publicUrlOf(@User() u: CurrentUser, @Param("id") idText: string) {
    const id = routeInt(idText);
    if (!this.isSuperAdmin(u)) return forbid();
    const hash = await this.db.executeScalar<string>("SELECT UrlHash FROM district_directory_config WHERE pk_id = @id AND isdeleted = 0", { id });
    return hash ? ok({ url: this.publicUrl(hash) }) : notFound();
  }

  private async loadConfig(conn: DbCommands, id: number): Promise<ConfigRecord | null> {
    const r = await conn.queryFirstOrDefault(
      `SELECT c.pk_id AS id, c.fk_district_id AS districtId, d.DistrictNumber AS districtNumber, c.fk_year_id AS yearId, y.YearLabel AS yearLabel, c.UrlHash AS urlHash,
              COALESCE(c.DcFieldsJson, '[]') AS dcFieldsJson, COALESCE(c.BodFieldsJson, '[]') AS bodFieldsJson, COALESCE(c.MemberFieldsJson, '[]') AS memberFieldsJson,
              c.FirstContactName AS firstContactName, c.FirstContactMobile AS firstContactMobile, c.SecondContactName AS secondContactName, c.SecondContactMobile AS secondContactMobile,
              CAST(COALESCE(c.SendEmail, 1) AS SIGNED) AS sendEmail, CAST(COALESCE(c.SendWhatsapp, 1) AS SIGNED) AS sendWhatsapp
       FROM district_directory_config c JOIN district_master d ON d.pk_district_id = c.fk_district_id JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
       WHERE c.pk_id = @id AND c.isdeleted = 0`, { id });
    if (!r) return null;
    return { ...(r as unknown as ConfigRecord), id: Number(r.id), districtId: Number(r.districtId), yearId: Number(r.yearId), sendEmail: Number(r.sendEmail), sendWhatsapp: Number(r.sendWhatsapp),
      districtNumber: String(r.districtNumber ?? ""), yearLabel: String(r.yearLabel ?? "") };
  }

  private async districtMembers(conn: DbCommands, districtId: number): Promise<DistrictMember[]> {
    return (await conn.query(
      `SELECT DISTINCT m.pk_member_master_profile_id AS MemberId, m.MemberName AS Name, m.PrimaryMobileNumber AS Mobile, m.EmailId AS Email, c.ClubName AS ClubName
       FROM member_master_profile m
       JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND (cm.isdeleted IS NULL OR cm.isdeleted = 0) AND cm.IsActive = 1
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id
       WHERE c.fk_district_id = @districtId AND (m.isdeleted IS NULL OR m.isdeleted = 0)
       ORDER BY m.MemberName`, { districtId })).map((r) => ({
      memberId: Number(r.MemberId), name: String(r.Name ?? ""), mobile: (r.Mobile as string | null) ?? null, email: (r.Email as string | null) ?? null, clubName: (r.ClubName as string | null) ?? null,
    }));
  }
}

function reminderHtml(name: string | null, yearLabel: string, districtNumber: string, filled: number, total: number, detailedHtml: string, url: string, contactText: string) {
  const pct = total > 0 ? Math.round((100 * filled) / total) : 0;
  return `${emailHeader()}
<h2 style="color:#1a365d;margin-top:0;">District Directory — Data Collection Reminder</h2>
<p>Hello ${esc(name ?? "")},</p>
<p>Your Data Collection Form for the <b>District Directory ${yearLabel} (District ${districtNumber})</b> is currently incomplete.</p>
<p>Status: <b>${filled} of ${total} fields completed — ${pct}%</b>.</p>
${detailedHtml}
<p style="margin-top:20px;">Please complete the remaining details using the link below:</p>
<p><a href="${url}" style="color:#2563eb;">${url}</a></p>
<p>If you require any assistance, please contact <b>${esc(contactText)}</b>.</p>
<p style="color:#64748b;font-size:13px;margin-top:20px;">This message is sent for record completion purposes.</p>
<p>Regards,<br/><b>District Team</b></p>
${emailFooter()}`;
}
