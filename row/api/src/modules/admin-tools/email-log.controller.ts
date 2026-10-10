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

interface Filters { from?: string; to?: string; recipient?: string; subject?: string; status?: string; emailType?: string }
const parseDay = (v: string | undefined) => { const s = (v ?? "").trim(); return s && !Number.isNaN(Date.parse(s)) ? s.slice(0, 10) : null; };
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** The shared filter set; scope adds the club / district restriction (its members' addresses, or the stamped id). */
export function buildWhere(f: Filters, scope: { kind: "club" | "district"; id: number } | null): [string, Record<string, unknown>] {
  const c: string[] = [];
  const p: Record<string, unknown> = {};
  if (scope) {
    const memberEmails = scope.kind === "club"
      ? `SELECT m.EmailId FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
         WHERE cm.fk_club_id = @ScopeId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0 AND m.EmailId IS NOT NULL AND m.EmailId <> ''`
      : `SELECT m.EmailId FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
         WHERE c.fk_district_id = @ScopeId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND c.isdeleted = 0 AND m.isdeleted = 0 AND m.EmailId IS NOT NULL AND m.EmailId <> ''`;
    c.push(`(${scope.kind === "club" ? "fk_club_id" : "fk_district_id"} = @ScopeId OR recipient_email IN (${memberEmails}))`);
    p.ScopeId = scope.id;
  }
  const from = parseDay(f.from), to = parseDay(f.to);
  if (from) { c.push("sent_at >= @From"); p.From = from; }
  if (to) { c.push("sent_at < @To"); p.To = nextDay(to); }
  const text = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  if (text(f.recipient)) { c.push("(recipient_email LIKE CONCAT('%', @Recipient, '%') OR cc_emails LIKE CONCAT('%', @Recipient, '%'))"); p.Recipient = text(f.recipient); }
  if (text(f.subject)) { c.push("subject LIKE CONCAT('%', @Subject, '%')"); p.Subject = text(f.subject); }
  if (text(f.status)) { c.push("status = @Status"); p.Status = text(f.status); }
  if (text(f.emailType)) { c.push("email_type = @Type"); p.Type = text(f.emailType); }
  return [c.length ? `WHERE ${c.join(" AND ")}` : "", p];
}
const LIST_COLS = `pk_id AS id, recipient_email AS recipientEmail, cc_emails AS ccEmails, subject AS subject, email_type AS emailType, status AS status,
                   brevo_message_id AS brevoMessageId, error_message AS errorMessage, sent_at AS sentAt`;
const SUMMARY = `SELECT SUM(CASE WHEN sent_at >= NOW() - INTERVAL 1 DAY THEN 1 ELSE 0 END) AS last24h,
                        SUM(CASE WHEN sent_at >= NOW() - INTERVAL 7 DAY THEN 1 ELSE 0 END) AS last7d,
                        SUM(CASE WHEN sent_at >= NOW() - INTERVAL 30 DAY THEN 1 ELSE 0 END) AS last30d,
                        SUM(CASE WHEN status = 'Sent' THEN 1 ELSE 0 END) AS totalSent,
                        SUM(CASE WHEN status = 'Failed' THEN 1 ELSE 0 END) AS totalFailed,
                        COUNT(*) AS totalAll FROM email_log`;

/** Port of EmailLogController.cs: the Brevo send log (SuperAdmin, and club / district scoped views for their admins). */
@Controller("api/email-log")
@Authorize()
export class EmailLogController {
  constructor(private readonly db: Db) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private memberId = (u: CurrentUser) => {
    const v = u.findFirst("memberId") ?? u.findFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier") ?? "";
    return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0;
  };

  private async list(where: string, p: Record<string, unknown>, page: number, pageSize: number) {
    const items = await this.db.query(`SELECT ${LIST_COLS} FROM email_log ${where} ORDER BY pk_id DESC LIMIT @PageSize OFFSET @Offset`, { ...p, PageSize: pageSize, Offset: (page - 1) * pageSize });
    const total = Number(await this.db.executeScalar(`SELECT COUNT(*) FROM email_log ${where}`, p));
    return ok({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  }

  private async exportXlsx(where: string, p: Record<string, unknown>) {
    const rows = await this.db.query(
      `SELECT sent_at AS sentAt, status AS status, recipient_email AS recipientEmail, cc_emails AS ccEmails, subject AS subject, email_type AS emailType,
              brevo_message_id AS brevoMessageId, error_message AS errorMessage
       FROM email_log ${where} ORDER BY pk_id DESC LIMIT 100000`, p);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Email Log");
    ["Sent At", "Status", "Recipient", "Cc", "Subject", "Type", "Brevo Msg Id", "Error"].forEach((h, i) => {
      const c = ws.getCell(1, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17458F" } };
    });
    let r = 2;
    for (const row of rows) {
      const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
      ws.getRow(r).values = [row.sentAt ? formatDate(String(row.sentAt), "dd-MM-yyyy HH:mm") : "", s(row.status), s(row.recipientEmail), s(row.ccEmails), s(row.subject), s(row.emailType), s(row.brevoMessageId), s(row.errorMessage)];
      if (row.status === "Sent") ws.getCell(r, 2).font = { color: { argb: "FF059669" } };
      else if (row.status === "Failed") ws.getCell(r, 2).font = { color: { argb: "FFDC2626" } };
      r++;
    }
    for (let c = 1; c <= 8; c++) {
      let w = 8;
      for (let rr = 1; rr < r; rr++) w = Math.max(w, String(ws.getCell(rr, c).value ?? "").length + 2);
      ws.getColumn(c).width = Math.min(w, 255);
    }
    return file(await toBuffer(wb), XLSX_CONTENT_TYPE, `Email_Log_${formatDate(nowIn(Brand.Current.locale.defaultTimeZone), "yyyyMMdd_HHmmss")}.xlsx`);
  }

  private static pageArgs(page?: string, pageSize?: string): [number, number] {
    let p = queryInt(page, 1), ps = queryInt(pageSize, 100);
    if (p < 1) p = 1;
    if (ps < 1 || ps > 500) ps = 100;
    return [p, ps];
  }

  private async canAccessClub(u: CurrentUser, clubId: number) {
    const m = this.memberId(u);
    if (m <= 0) return false;
    if (await isSuperAdminMember(this.db, m)) return true;
    try {
      await ensureClubAdmin(this.db, m, clubId);
      return true;
    } catch {
      return false;
    }
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
  async all(@User() u: CurrentUser, @Query() q: Filters & { page?: string; pageSize?: string }) {
    if (!this.isSuperAdmin(u)) return forbid();
    const [page, size] = EmailLogController.pageArgs(q.page, q.pageSize);
    return this.list(...buildWhere(q, null), page, size);
  }

  @Get("export")
  async exportAll(@User() u: CurrentUser, @Query() q: Filters) {
    if (!this.isSuperAdmin(u)) return forbid();
    return this.exportXlsx(...buildWhere(q, null));
  }

  @Get("summary")
  async summary(@User() u: CurrentUser) {
    if (!this.isSuperAdmin(u)) return forbid();
    return ok(await this.db.queryFirstOrDefault(SUMMARY));
  }

  @Get("club/:clubId")
  async clubList(@User() u: CurrentUser, @Param("clubId") c: string, @Query() q: Filters & { page?: string; pageSize?: string }) {
    const clubId = routeInt(c);
    const [page, size] = EmailLogController.pageArgs(q.page, q.pageSize);
    if (!(await this.canAccessClub(u, clubId))) return forbid();
    return this.list(...buildWhere(q, { kind: "club", id: clubId }), page, size);
  }

  @Get("club/:clubId/summary")
  async clubSummary(@User() u: CurrentUser, @Param("clubId") c: string) {
    const clubId = routeInt(c);
    if (!(await this.canAccessClub(u, clubId))) return forbid();
    const [where, p] = buildWhere({}, { kind: "club", id: clubId });
    return ok(await this.db.queryFirstOrDefault(`${SUMMARY} ${where}`, p));
  }

  @Get("club/:clubId/export")
  async clubExport(@User() u: CurrentUser, @Param("clubId") c: string, @Query() q: Filters) {
    const clubId = routeInt(c);
    if (!(await this.canAccessClub(u, clubId))) return forbid();
    return this.exportXlsx(...buildWhere(q, { kind: "club", id: clubId }));
  }

  @Get("district/:districtId")
  async districtList(@User() u: CurrentUser, @Param("districtId") d: string, @Query() q: Filters & { page?: string; pageSize?: string }) {
    const districtId = routeInt(d);
    const [page, size] = EmailLogController.pageArgs(q.page, q.pageSize);
    if (!(await this.canAccessDistrict(u, districtId))) return forbid();
    return this.list(...buildWhere(q, { kind: "district", id: districtId }), page, size);
  }

  @Get("district/:districtId/summary")
  async districtSummary(@User() u: CurrentUser, @Param("districtId") d: string) {
    const districtId = routeInt(d);
    if (!(await this.canAccessDistrict(u, districtId))) return forbid();
    const [where, p] = buildWhere({}, { kind: "district", id: districtId });
    return ok(await this.db.queryFirstOrDefault(`${SUMMARY} ${where}`, p));
  }

  @Get("district/:districtId/export")
  async districtExport(@User() u: CurrentUser, @Param("districtId") d: string, @Query() q: Filters) {
    const districtId = routeInt(d);
    if (!(await this.canAccessDistrict(u, districtId))) return forbid();
    return this.exportXlsx(...buildWhere(q, { kind: "district", id: districtId }));
  }

  /** Full HTML body (SuperAdmin). Declared last: ":id" must not shadow "summary" / "export". */
  @Get(":id")
  async detail(@User() u: CurrentUser, @Param("id") idText: string) {
    const id = routeInt(idText);
    if (!this.isSuperAdmin(u)) return forbid();
    const row = await this.db.queryFirstOrDefault(
      `SELECT pk_id AS id, recipient_email AS recipientEmail, cc_emails AS ccEmails, subject AS subject, body_html AS bodyHtml, email_type AS emailType,
              status AS status, brevo_message_id AS brevoMessageId, error_message AS errorMessage, sent_at AS sentAt
       FROM email_log WHERE pk_id = @Id`, { Id: id });
    return row ? ok(row) : notFound({ message: "Email not found." });
  }
}
