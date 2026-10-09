import { Injectable, Logger } from "@nestjs/common";
import { Db, type DbCommands } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { EmailService, emailFooter, emailHeader } from "../../services/email.service";
import { webRootPath } from "../../services/media-storage";
import { DG_EMAIL, DG_JOIN_MEMBER, DG_NAME } from "../../services/district-governor-sql";
import { DistrictCmrEmailSettingsService } from "./cmr-email-settings";
import { MonthlyReportService, type ReportPreview } from "./monthly-report.service";
import { buildPdfReport, loadPhoto } from "./cmr-documents";

type Recipient = { name: string; email: string; role: string };
const MAX_ATTACHMENT_BYTES = 13 * 1024 * 1024;

/**
 * Port of CmrSubmissionMailer.cs: when a club uploads its monthly report, the
 * PDF goes to the President, Secretary, AG, the District Governor (per the
 * district's setting) and any district CC addresses. Suppressed when the API
 * runs against a remote database from a dev machine (as in RIZones);
 * Cmr:SubmissionEmailOverride redirects all of it to one test address.
 */
@Injectable()
export class CmrSubmissionMailer {
  private readonly log = new Logger("CmrSubmissionMailer");

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly email: EmailService,
    private readonly reports: MonthlyReportService,
    private readonly settings: DistrictCmrEmailSettingsService,
  ) {}

  private isRemoteDb() {
    const m = /(?:^|;)\s*(?:server|host|data source)\s*=\s*([^;]+)/i.exec(this.config.connectionString() ?? "");
    const server = (m?.[1] ?? "").trim().toLowerCase();
    return server.length > 0 && !["localhost", "127.0.0.1", "::1"].includes(server);
  }

  async sendSubmissionEmails(clubId: number, reportId: number, requestedBy: number) {
    // RIZones suppresses whenever the DB is remote; ROW only in Development (an IIS server may use a separate DB host).
    if (this.isRemoteDb() && this.config.environment === "Development") {
      this.log.warn(`CMR submission email SUPPRESSED — local dev against a remote DB. club ${clubId}, report ${reportId}.`);
      return;
    }
    try {
      const prep = await this.db.session(async (conn) => {
        const rpt = await conn.queryFirstOrDefault("SELECT fk_year_id AS YearId, ReportMonth AS Month FROM club_monthly_reports WHERE pk_report_id = @Id AND isdeleted = 0", { Id: reportId });
        if (!rpt) return null;
        const [yearId, month] = [Number(rpt.YearId), Number(rpt.Month)];
        const districtId = Number((await conn.executeScalar("SELECT fk_district_id FROM club_master WHERE pk_club_id = @Id", { Id: clubId })) ?? 0);
        const { sendToDistrictGovernor, ccEmails } = await this.settings.resolve(conn, districtId, yearId);
        return { yearId, month, recipients: await CmrSubmissionMailer.recipients(conn, clubId, yearId, sendToDistrictGovernor, ccEmails) };
      });
      if (!prep) {
        this.log.warn(`CMR submission email: report ${reportId} not found.`);
        return;
      }
      const override = this.config.get("Cmr:SubmissionEmailOverride");
      if (!override && !prep.recipients.length) {
        this.log.warn(`CMR submission email: no recipients (DG/AG/President/Secretary) with an email for club ${clubId}, report ${reportId}.`);
        return;
      }
      const summary = await this.reports.getPreview(clubId, prep.yearId, prep.month, requestedBy);
      const items = await this.reports.getWordProjectsForMonth(clubId, prep.yearId, prep.month);
      const redirect = this.config.get("Media:RedirectBaseUrl") ?? null;
      for (const it of items) for (const ph of it.photos) await loadPhoto(webRootPath(this.config), redirect, ph);
      const mediaBase = redirect || this.config.get("Api:BaseUrl") || "";
      let pdf = await buildPdfReport(summary, items, mediaBase);
      let photosDropped = false;
      if (pdf.length > MAX_ATTACHMENT_BYTES) {
        const textOnly = await buildPdfReport(summary, items, mediaBase, false);
        this.log.warn(`CMR PDF ${pdf.length} bytes exceeded ${MAX_ATTACHMENT_BYTES} for report ${reportId}; sending text-only (${textOnly.length} bytes).`);
        pdf = textOnly;
        photosDropped = true;
      }
      const fileName = `${summary.clubName}_Monthly_Report_${summary.monthName}_${summary.yearLabel}.pdf`.replace(/ /g, "_").replace(/\//g, "-");
      const subject = `Club Monthly Report Submitted — ${summary.clubName} — ${summary.monthName} ${summary.yearLabel}`;
      const body = CmrSubmissionMailer.body(summary, prep.recipients, override ?? null, photosDropped);
      const to = override ?? prep.recipients[0].email;
      const cc = override ? [] : prep.recipients.slice(1).map((r) => r.email);
      await this.email.sendEmailWithAttachment(to, subject, body, pdf, fileName, cc);
      this.log.log(`CMR submission email sent for report ${reportId} (to=${to}${override ? " [TEST OVERRIDE]" : ""}).`);
    } catch (e) {
      this.log.error(`CMR submission email failed for club ${clubId}, report ${reportId}: ${(e as Error).message}`);
    }
  }

  private static async recipients(conn: DbCommands, clubId: number, yearId: number, sendToDg: boolean, cc: string[]): Promise<Recipient[]> {
    const out: Recipient[] = [];
    const seen = new Set<string>();
    const add = (name: unknown, email: unknown, role: string) => {
      const e = typeof email === "string" ? email.trim() : "";
      if (!e || seen.has(e.toLowerCase())) return;
      seen.add(e.toLowerCase());
      out.push({ name: typeof name === "string" && name ? name : role, email: e, role });
    };
    const bod = await conn.query(
      `SELECT m.MemberName AS Name, m.EmailId AS Email, d.designation_name AS Role
       FROM board_of_directors bod
       JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id
       JOIN designation_master d ON d.pk_designation_id = bod.fk_designation_id
       WHERE bod.fk_club_id = @ClubId AND bod.fk_year_id = @YearId AND bod.isdeleted = 0 AND d.designation_name IN ('Club President', 'Club Secretary')`,
      { ClubId: clubId, YearId: yearId },
    );
    for (const role of ["Club President", "Club Secretary"]) {
      const b = bod.find((x) => x.Role === role);
      if (b) add(b.Name, b.Email, role);
    }
    const ag = await conn.queryFirstOrDefault(
      `SELECT m.MemberName AS Name, m.EmailId AS Email FROM district_ag da
       JOIN member_master_profile m ON m.pk_member_master_profile_id = da.fk_member_id AND COALESCE(m.isdeleted,0) = 0
       WHERE da.fk_club_id = @ClubId AND da.fk_year_id = @YearId AND da.is_active = 1 AND (da.isdeleted = 0 OR da.isdeleted IS NULL)
       ORDER BY da.id DESC LIMIT 1`,
      { ClubId: clubId, YearId: yearId },
    );
    if (ag) add(ag.Name, ag.Email, "Assistant Governor");
    if (sendToDg) {
      const dg = await conn.queryFirstOrDefault(
        `SELECT ${DG_NAME} AS Name, ${DG_EMAIL} AS Email FROM district_governors g
         JOIN club_master c ON c.fk_district_id = g.fk_district_id
         ${DG_JOIN_MEMBER}
         WHERE c.pk_club_id = @ClubId AND g.fk_year_id = @YearId AND g.isdeleted = 0 LIMIT 1`,
        { ClubId: clubId, YearId: yearId },
      );
      if (dg) add(dg.Name, dg.Email, "District Governor");
    }
    for (const e of cc) add(e, e, "CC (District)");
    return out;
  }

  private static body(s: ReportPreview, recipients: Recipient[], override: string | null, photosDropped: boolean) {
    const who = recipients.length ? recipients.map((r) => `${r.name} (${r.role})`).join(", ") : "(none resolved)";
    const test = override
      ? `<p style='font-size: 13px; line-height: 1.6; background:#FFF3CD; border:1px solid #FFE69C; padding:10px; border-radius:6px;'>
                    <strong>TEST MODE:</strong> this email was redirected to ${override}. In production it would be sent to the recipients listed below.
                </p>`
      : "";
    const attachment = photosDropped
      ? `<p style='font-size: 14px; line-height: 1.8;'>The report — meetings and all service avenues — is attached as a PDF.
                    <strong>Photos were omitted to keep this email within the size limit;</strong> the full report with photos is available in the portal.</p>`
      : `<p style='font-size: 14px; line-height: 1.8;'>The full report — meetings and all service avenues with photos — is attached as a PDF.</p>`;
    return `
            ${emailHeader()}
                <p style='font-style: italic; font-size: 15px; margin-bottom: 20px;'><strong>Dear Rtn,</strong></p>
                ${test}
                <p style='font-size: 14px; line-height: 1.8;'>
                    The Club Monthly Report for <strong>${s.clubName}</strong> for <strong>${s.monthName} ${s.yearLabel}</strong> has been submitted to the District.
                </p>
                ${attachment}
                <p style='font-size: 13px; color:#666; line-height: 1.8;'>Recipients: ${who}</p>
                <p style='font-size: 13px; line-height: 1.8; font-style: italic;'>This is an autogenerated email from ${Brand.Current.productName.replace(/&/g, "&amp;")}.</p>
            ${emailFooter()}`;
  }
}
