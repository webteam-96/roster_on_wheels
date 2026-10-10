import { Controller, Get, Param, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { queryInt, routeInt } from "../../common/binding";
import { formatDate, nowIn } from "../../common/dotnet-format";
import { file, forbid, notFound, ok } from "../../common/results";
import { Brand } from "../../brand/brand";
import { Db } from "../../database/db.service";
import { ensureClubAdmin, isSuperAdminMember } from "../../services/club-admin-access.helper";
import { ExcelJS, toBuffer, XLSX_CONTENT_TYPE } from "../../services/xlsx";

interface Filters { from?: string; to?: string; recipient?: string; title?: string; status?: string; club?: string; district?: string; waType?: string; page?: string; pageSize?: string }
const parseDay = (v: string | undefined) => { const s = (v ?? "").trim(); return s && !Number.isNaN(Date.parse(s)) ? s.slice(0, 10) : null; };
const JOINS = "FROM whatsapp_log w LEFT JOIN club_master c ON c.pk_club_id = w.fk_club_id LEFT JOIN district_master d ON d.pk_district_id = w.fk_district_id";

export function waWhere(f: Filters, scopeClub: number | null, scopeDistrict: number | null): [string, Record<string, unknown>] {
  const c: string[] = [];
  const p: Record<string, unknown> = {};
  if (scopeClub !== null && scopeClub > 0) { c.push("w.fk_club_id = @ScopeClub"); p.ScopeClub = scopeClub; }
  if (scopeDistrict !== null && scopeDistrict > 0) { c.push("w.fk_district_id = @ScopeDistrict"); p.ScopeDistrict = scopeDistrict; }
  const from = parseDay(f.from), to = parseDay(f.to);
  if (from) { c.push("w.sent_at >= @From"); p.From = from; }
  if (to) { c.push("w.sent_at < @To"); p.To = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10); }
  const t = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  if (t(f.recipient)) { c.push("(w.recipient_mobile LIKE CONCAT('%', @Recipient, '%') OR w.recipient_name LIKE CONCAT('%', @Recipient, '%'))"); p.Recipient = t(f.recipient); }
  if (t(f.title)) { c.push("w.title LIKE CONCAT('%', @Title, '%')"); p.Title = t(f.title); }
  if (t(f.status)) { c.push("w.status = @Status"); p.Status = t(f.status); }
  if (t(f.waType)) { c.push("w.whatsapp_type = @Type"); p.Type = t(f.waType); }
  if (t(f.club)) { c.push("c.ClubName LIKE CONCAT('%', @Club, '%')"); p.Club = t(f.club); }
  if (t(f.district)) { c.push("d.DistrictNumber LIKE CONCAT('%', @District, '%')"); p.District = t(f.district); }
  return [c.length ? `WHERE ${c.join(" AND ")}` : "", p];
}
const LIST_COLS = `w.pk_id AS id, w.recipient_mobile AS recipientMobile, w.recipient_name AS recipientName, w.template_name AS templateName, w.whatsapp_type AS whatsAppType,
                   w.source_id AS sourceId, w.title AS title, w.status AS status, w.interakt_message_id AS interaktMessageId, w.http_status AS httpStatus,
                   w.error_message AS errorMessage, w.sent_at AS sentAt, w.delivered_at AS deliveredAt, c.ClubName AS clubName, d.DistrictNumber AS districtNumber`;
const SUMMARY = `SELECT SUM(CASE WHEN w.sent_at >= NOW() - INTERVAL 1 DAY THEN 1 ELSE 0 END) AS last24h,
                        SUM(CASE WHEN w.sent_at >= NOW() - INTERVAL 7 DAY THEN 1 ELSE 0 END) AS last7d,
                        SUM(CASE WHEN w.sent_at >= NOW() - INTERVAL 30 DAY THEN 1 ELSE 0 END) AS last30d,
                        SUM(CASE WHEN w.status IN ('Sent','Delivered','Read') THEN 1 ELSE 0 END) AS totalSent,
                        SUM(CASE WHEN w.status IN ('Delivered','Read') THEN 1 ELSE 0 END) AS totalDelivered,
                        SUM(CASE WHEN w.status = 'Failed' THEN 1 ELSE 0 END) AS totalFailed,
                        COUNT(*) AS totalAll ${JOINS}`;

/**
 * Port of WhatsAppLogController.cs: per-recipient WhatsApp delivery report (SuperAdmin, and club / district views).
 * Not ported: POST backfill (imported RIZones' old provider log files from a server path).
 */
@Controller("api/whatsapp-log")
@Authorize()
export class WhatsAppLogController {
  constructor(private readonly db: Db) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private memberId = (u: CurrentUser) => {
    const v = u.findFirst("memberId") ?? u.findFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier") ?? "";
    return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0;
  };
  private static page(q: Filters): [number, number] {
    let p = queryInt(q.page, 1), ps = queryInt(q.pageSize, 100);
    if (p < 1) p = 1;
    if (ps < 1 || ps > 500) ps = 100;
    return [p, ps];
  }

  private async list([where, p]: [string, Record<string, unknown>], page: number, pageSize: number) {
    const items = await this.db.query(`SELECT ${LIST_COLS} ${JOINS} ${where} ORDER BY w.pk_id DESC LIMIT @PageSize OFFSET @Offset`, { ...p, PageSize: pageSize, Offset: (page - 1) * pageSize });
    const total = Number(await this.db.executeScalar(`SELECT COUNT(*) ${JOINS} ${where}`, p));
    return ok({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  }

  private async exportXlsx([where, p]: [string, Record<string, unknown>]) {
    const rows = await this.db.query(
      `SELECT w.sent_at AS sentAt, w.status AS status, w.recipient_name AS recipientName, w.recipient_mobile AS recipientMobile, w.title AS title, w.whatsapp_type AS whatsAppType,
              c.ClubName AS clubName, d.DistrictNumber AS districtNumber, w.template_name AS templateName, w.interakt_message_id AS interaktMessageId,
              w.http_status AS httpStatus, w.error_message AS errorMessage, w.delivered_at AS deliveredAt
       ${JOINS} ${where} ORDER BY w.pk_id DESC LIMIT 100000`, p);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("WhatsApp Log");
    const headers = ["Sent At", "Status", "Recipient Name", "Mobile", "Title", "Type", "Club", "District", "Template", "Provider Msg Id", "HTTP", "Error", "Delivered At"];
    headers.forEach((h, i) => {
      const c = ws.getCell(1, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17458F" } };
    });
    const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
    const dt = (v: unknown) => (v ? formatDate(String(v), "dd-MM-yyyy HH:mm") : "");
    let r = 2;
    for (const row of rows) {
      ws.getRow(r).values = [dt(row.sentAt), s(row.status), s(row.recipientName), s(row.recipientMobile), s(row.title), s(row.whatsAppType), s(row.clubName),
        row.districtNumber !== null && row.districtNumber !== undefined ? `District ${row.districtNumber}` : "", s(row.templateName), s(row.interaktMessageId),
        row.httpStatus !== null && row.httpStatus !== undefined ? Number(row.httpStatus) : null, s(row.errorMessage), dt(row.deliveredAt)];
      if (row.status === "Delivered" || row.status === "Read") ws.getCell(r, 2).font = { color: { argb: "FF059669" } };
      else if (row.status === "Failed") ws.getCell(r, 2).font = { color: { argb: "FFDC2626" } };
      r++;
    }
    headers.forEach((_, i) => {
      let w = 8;
      for (let rr = 1; rr < r; rr++) w = Math.max(w, String(ws.getCell(rr, i + 1).value ?? "").length + 2);
      ws.getColumn(i + 1).width = Math.min(w, 255);
    });
    return file(await toBuffer(wb), XLSX_CONTENT_TYPE, `WhatsApp_Log_${formatDate(nowIn(Brand.Current.locale.defaultTimeZone), "yyyyMMdd_HHmmss")}.xlsx`);
  }

  private async canAccessClub(u: CurrentUser, clubId: number) {
    const m = this.memberId(u);
    if (m <= 0) return false;
    if (await isSuperAdminMember(this.db, m)) return true;
    try { await ensureClubAdmin(this.db, m, clubId); return true; } catch { return false; }
  }
  private async canAccessDistrict(u: CurrentUser, districtId: number) {
    const m = this.memberId(u);
    if (m <= 0) return false;
    if (await isSuperAdminMember(this.db, m)) return true;
    return Number(await this.db.executeScalar(
      "SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @M AND fk_role_id = 2 AND fk_district_id = @D AND (fk_club_id IS NULL OR fk_club_id = 0) AND IsActive = 1 AND isdeleted = 0",
      { M: m, D: districtId })) > 0;
  }

  @Get()
  async all(@User() u: CurrentUser, @Query() q: Filters) {
    if (!this.isSuperAdmin(u)) return forbid();
    return this.list(waWhere(q, null, null), ...WhatsAppLogController.page(q));
  }

  @Get("export")
  async exportAll(@User() u: CurrentUser, @Query() q: Filters) {
    if (!this.isSuperAdmin(u)) return forbid();
    return this.exportXlsx(waWhere(q, null, null));
  }

  @Get("summary")
  async summary(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.db.queryFirstOrDefault(SUMMARY));
  }

  @Get("club/:clubId")
  async clubList(@User() u: CurrentUser, @Param("clubId") c: string, @Query() q: Filters) {
    const clubId = routeInt(c);
    if (!(await this.canAccessClub(u, clubId))) return forbid();
    return this.list(waWhere({ ...q, club: undefined, district: undefined }, clubId, null), ...WhatsAppLogController.page(q));
  }

  @Get("club/:clubId/summary")
  async clubSummary(@User() u: CurrentUser, @Param("clubId") c: string) {
    const clubId = routeInt(c);
    if (!(await this.canAccessClub(u, clubId))) return forbid();
    const [where, p] = waWhere({}, clubId, null);
    return ok(await this.db.queryFirstOrDefault(`${SUMMARY} ${where}`, p));
  }

  @Get("club/:clubId/export")
  async clubExport(@User() u: CurrentUser, @Param("clubId") c: string, @Query() q: Filters) {
    const clubId = routeInt(c);
    if (!(await this.canAccessClub(u, clubId))) return forbid();
    return this.exportXlsx(waWhere({ ...q, club: undefined, district: undefined }, clubId, null));
  }

  @Get("district/:districtId")
  async districtList(@User() u: CurrentUser, @Param("districtId") d: string, @Query() q: Filters) {
    const districtId = routeInt(d);
    if (!(await this.canAccessDistrict(u, districtId))) return forbid();
    return this.list(waWhere({ ...q, district: undefined }, null, districtId), ...WhatsAppLogController.page(q));
  }

  @Get("district/:districtId/summary")
  async districtSummary(@User() u: CurrentUser, @Param("districtId") d: string) {
    const districtId = routeInt(d);
    if (!(await this.canAccessDistrict(u, districtId))) return forbid();
    const [where, p] = waWhere({}, null, districtId);
    return ok(await this.db.queryFirstOrDefault(`${SUMMARY} ${where}`, p));
  }

  @Get("district/:districtId/export")
  async districtExport(@User() u: CurrentUser, @Param("districtId") d: string, @Query() q: Filters) {
    const districtId = routeInt(d);
    if (!(await this.canAccessDistrict(u, districtId))) return forbid();
    return this.exportXlsx(waWhere({ ...q, district: undefined }, null, districtId));
  }

  @Get(":id")
  async detail(@User() u: CurrentUser, @Param("id") idText: string) {
    const id = routeInt(idText);
    if (!this.isSuperAdmin(u)) return forbid();
    const row = await this.db.queryFirstOrDefault(`SELECT ${LIST_COLS}, w.body_preview AS bodyPreview ${JOINS} WHERE w.pk_id = @Id`, { Id: id });
    return row ? ok(row) : notFound({ message: "WhatsApp log entry not found." });
  }
}
