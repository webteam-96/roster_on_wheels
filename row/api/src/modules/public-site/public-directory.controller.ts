import { clientIp } from "../../common/http";
import { Body, Controller, Get, Logger, Param, Post, Query, Req, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { randomBytes, randomInt } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AllowAnonymous, ReadsRequestForm } from "../../auth/decorators";
import { bodyField, queryInt, queryString, requireQuery, routeInt } from "../../common/binding";
import { dotnetRound, nowIn } from "../../common/dotnet-format";
import { badRequest, notFound, ok, statusCode, unauthorized } from "../../common/results";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { Db, type DbCommands } from "../../database/db.service";
import { AdminProxyTokenSigner, verifyProxyPassword } from "../../services/admin-proxy-auth";
import {
  ALL_FIELDS, applySpouseNotApplicable, buildCompletedAndPendingHtml, buildContactText, computeCompletion, configIncludesSpouseFields, getField, getSpouseNotApplicable,
  groupKeys, isSpouseField, loadValues, maskEmail, maskMobile, resolveGroup, setSpouseNotApplicable, type FieldDef,
} from "../../services/directory-data-collection-fields";
import { EmailService, emailFooter, emailHeader } from "../../services/email.service";
import { lowerExtension, webRootPath, type UploadedFile as Upload } from "../../services/media-storage";
import { countryDialInfo, memberE164, otpChannelsFor, SmsSender, toE164, WhatsAppSender } from "../../services/messaging";
import { templateParam } from "../admin-tools/directory-config.controller";

const LOGIN_TYPE = "directory_form", LOGIN_TYPE_SESSION = "dir_form_sess", OTP_EXPIRY_MINUTES = 10, WHATSAPP_OTP_TEMPLATE = "otp";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const sqlUtc = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
const utc = (v: string) => new Date(/Z$|[+-]\d{2}:\d{2}$/.test(v) ? v : v + "Z");
const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
const pct = (filled: number, total: number) => (total > 0 ? dotnetRound((100 * filled) / total) : 0);

/** Failed admin logins per (link, mobile): 5 within a sliding 15 minutes locks the pair (in memory, per process). */
const lockouts = new Map<string, { fails: number; until: number }>();
const failsFor = (key: string) => { const e = lockouts.get(key); if (e && e.until < Date.now()) { lockouts.delete(key); return 0; } return e?.fails ?? 0; };

/** DateTime.TryParse for the form's dates: "YYYY-MM-DD..." (or any Date.parse form) → [y, m, d]. */
function parseDay(v: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v.trim());
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
}
const ymd = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
/** Birthdays and anniversaries are stored on the year-1900 placeholder (Feb 29 → Feb 28); pre-1900 years are junk. */
const placeholderDay = ([y, m, d]: [number, number, number]) => (y < 1900 ? null : ymd(1900, m, m === 2 && d === 29 ? 28 : d));

interface ConfigRow { id: number; districtId: number; yearId: number; districtNumber: string; yearLabel: string; dcJson: string; bodJson: string; memJson: string; [k: string]: unknown }

/**
 * Port of PublicDirectoryController.cs: the public District Directory data-collection form (no login):
 * a member finds themself, proves it by OTP, edits the configured fields; or a district contact logs in
 * with mobile + password and fills on members' behalf. OTP channels follow the brand OTP policy.
 */
@Controller("api/public/directory")
@AllowAnonymous()
export class PublicDirectoryController {
  private readonly log = new Logger("PublicDirectoryController");
  private readonly signer: AdminProxyTokenSigner;
  constructor(private readonly db: Db, private readonly config: AppConfig, private readonly email: EmailService, private readonly sms: SmsSender, private readonly whatsApp: WhatsAppSender) {
    this.signer = new AdminProxyTokenSigner(config.get("AdminProxyToken:SigningKey") || config.get("JwtSettings:Secret") || "");
  }

  private get apiBase() { return this.config.get("Api:BaseUrl") ?? this.config.get("BackendUrl") ?? ""; }
  private get publicBase() { return this.config.get("PublicFrontend:BaseUrl") ?? this.config.get("FrontendUrl") ?? Brand.Current.domains.adminOrigin; }

  /** A disabled link blocks every public action, not just the landing screen. */
  private async validUrl(conn: DbCommands, urlHash: string) {
    return Number(await conn.executeScalar("SELECT COUNT(*) FROM district_directory_config WHERE UrlHash = @urlHash AND isdeleted = 0 AND COALESCE(IsActive, 1) = 1", { urlHash })) > 0;
  }

  private loadConfig(conn: DbCommands, urlHash: string, extra = "") {
    return conn.queryFirstOrDefault<ConfigRow>(
      `SELECT c.pk_id AS id, c.fk_district_id AS districtId, c.fk_year_id AS yearId, d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel,
              COALESCE(c.DcFieldsJson, '[]') AS dcJson, COALESCE(c.BodFieldsJson, '[]') AS bodJson, COALESCE(c.MemberFieldsJson, '[]') AS memJson${extra}
       FROM district_directory_config c JOIN district_master d ON d.pk_district_id = c.fk_district_id JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
       WHERE c.UrlHash = @urlHash AND c.isdeleted = 0`, { urlHash });
  }

  /** Step 0: the link's district and year (no personal data); a disabled link answers { closed: true }. */
  @Get(":urlHash")
  async getConfig(@Param("urlHash") urlHash: string) {
    const cfg = await this.db.queryFirstOrDefault(
      `SELECT c.pk_id AS id, d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel, CAST(COALESCE(c.IsActive, 1) AS SIGNED) AS isActive,
              c.FirstContactName AS firstContactName, c.FirstContactMobile AS firstContactMobile, c.SecondContactName AS secondContactName, c.SecondContactMobile AS secondContactMobile
       FROM district_directory_config c JOIN district_master d ON d.pk_district_id = c.fk_district_id JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
       WHERE c.UrlHash = @urlHash AND c.isdeleted = 0`, { urlHash });
    if (!cfg) return notFound({ message: "Invalid or expired link." });
    if (Number(cfg.isActive) === 0) return ok({ closed: true, districtNumber: cfg.districtNumber, yearLabel: cfg.yearLabel });
    return ok(cfg);
  }

  /** A district contact's mobile + password → a 2-hour admin token used instead of member OTPs. */
  @Post(":urlHash/admin-login")
  async adminLogin(@Param("urlHash") urlHash: string, @Body() body: unknown) {
    const mobile = String(bodyField(body, "mobile") ?? "").trim(), password = String(bodyField(body, "password") ?? "");
    if (!mobile || !password) return badRequest({ message: "Mobile and password are required." });
    const key = `adminproxy-lockout:${urlHash}:${mobile}`;
    const fails = failsFor(key);
    if (fails >= 5) return statusCode(429, { message: "Too many failed attempts. Try again in 15 minutes." });
    const cfg = await this.db.queryFirstOrDefault(
      `SELECT c.FirstContactMobile AS firstMobile, c.FirstContactPasswordHash AS firstHash, c.SecondContactMobile AS secondMobile, c.SecondContactPasswordHash AS secondHash
       FROM district_directory_config c WHERE c.UrlHash = @urlHash AND c.isdeleted = 0`, { urlHash });
    if (!cfg) return notFound({ message: "Invalid link" });
    const [hash, slot] = cfg.firstMobile === mobile ? [cfg.firstHash as string | null, "first"] : cfg.secondMobile === mobile ? [cfg.secondHash as string | null, "second"] : [null, null];
    if (!hash || !slot || !verifyProxyPassword(password, hash)) {
      lockouts.set(key, { fails: fails + 1, until: Date.now() + 15 * 60_000 });
      return unauthorized({ message: "Invalid credentials." });
    }
    lockouts.delete(key);
    return ok({ adminToken: this.signer.issue(urlHash, mobile, slot, 2 * 3600), expiresAt: Math.floor(Date.now() / 1000) + 2 * 3600, slot });
  }

  /** Step 1: members of the link's district by name (2+ characters, 25 max). */
  @Get(":urlHash/search")
  async search(@Param("urlHash") urlHash: string, @Query("q") qQ?: string) {
    requireQuery({ q: qQ });
    const q = queryString(qQ);
    if (!q || q.trim().length < 2) return ok([]);
    const districtId = await this.db.executeScalar("SELECT fk_district_id FROM district_directory_config WHERE UrlHash = @urlHash AND isdeleted = 0 AND COALESCE(IsActive, 1) = 1", { urlHash });
    if (districtId === null || districtId === undefined) return notFound({ message: "Invalid link" });
    return ok(await this.db.query(
      `SELECT DISTINCT m.pk_member_master_profile_id AS memberId, m.MemberName AS name, c.ClubName AS clubName
       FROM member_master_profile m
       JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND (cm.isdeleted IS NULL OR cm.isdeleted = 0)
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id
       WHERE c.fk_district_id = @districtId AND (m.isdeleted IS NULL OR m.isdeleted = 0) AND m.MemberName LIKE @like
       ORDER BY m.MemberName LIMIT 25`, { districtId, like: `%${q.trim()}%` }));
  }

  private async otpTargets(conn: DbCommands, memberId: number) {
    const m = await conn.queryFirstOrDefault(
      "SELECT MemberName AS name, PrimaryMobileNumber AS mobile, EmailId AS email, fk_primary_country_id AS countryId FROM member_master_profile WHERE pk_member_master_profile_id = @id AND (isdeleted IS NULL OR isdeleted = 0)",
      { id: memberId });
    if (!m) return null;
    const countryId = m.countryId === null ? null : Number(m.countryId);
    const { dialCode, iso } = await countryDialInfo(conn, countryId);
    return { name: String(m.name ?? ""), mobile: m.mobile as string | null, email: m.email as string | null, countryId, channels: otpChannelsFor(iso), e164: toE164(m.mobile, dialCode) };
  }

  /** Step 2: masked contacts, and the channel the OTP will use (the first policy channel this member can receive). */
  @Get(":urlHash/member/:memberId/masked")
  async masked(@Param("urlHash") urlHash: string, @Param("memberId") mid: string) {
    const memberId = routeInt(mid);
    return this.db.session(async (conn) => {
      if (!(await this.validUrl(conn, urlHash))) return notFound();
      const t = await this.otpTargets(conn, memberId);
      if (!t) return notFound();
      const otpChannel = t.channels.find((c) => (c === "email" ? !blank(t.email) : !!t.e164)) ?? t.channels[0] ?? "email";
      return ok({ name: t.name, maskedMobile: maskMobile(t.mobile), maskedEmail: maskEmail(t.email), hasMobile: !blank(t.mobile), hasEmail: !blank(t.email), otpChannel });
    });
  }

  /** Step 3: a 6-digit OTP (10 minutes) on the policy channels; the requested channel is ignored, as in RIZones. */
  @Post(":urlHash/send-otp")
  async sendOtp(@Param("urlHash") urlHash: string, @Body() body: unknown) {
    const memberId = Math.trunc(Number(bodyField(body, "memberId")) || 0);
    return this.db.session(async (conn) => {
      if (!(await this.validUrl(conn, urlHash))) return notFound();
      const t = await this.otpTargets(conn, memberId);
      if (!t) return notFound({ message: "Member not found" });
      const otp = String(randomInt(100000, 1000000));
      let sentEmail = false, sentSms = false, sentWhatsApp = false;
      if (t.channels.includes("email") && !blank(t.email)) sentEmail = await this.sendOtpEmail(t.email!, t.name, otp);
      if (t.channels.includes("whatsapp") && t.e164) sentWhatsApp = await this.whatsApp.sendTemplate(t.e164, WHATSAPP_OTP_TEMPLATE, Brand.Current.locale.defaultLanguage, [otp], otp).catch(() => false);
      if (t.channels.includes("sms") && t.e164 && !sentEmail && !sentWhatsApp)
        sentSms = await this.sms.send(t.e164, `${otp} is your ${Brand.Current.shortName} District Directory code. It expires in ${OTP_EXPIRY_MINUTES} minutes.`).catch(() => false);
      if (!sentEmail && !sentSms && !sentWhatsApp) return statusCode(500, { message: "Could not send OTP via email or SMS. Please try again." });
      await conn.execute(
        `INSERT INTO mobile_login_otp (fk_member_master_profile_id, login_type, identifier, country_id, otp_code, expires_at, sent_email, sent_sms, sent_whatsapp)
         VALUES (@MemberId, @LoginType, @Identifier, @CountryId, @Otp, @ExpiresAt, @SentEmail, @SentSms, @SentWhatsApp)`,
        { MemberId: memberId, LoginType: LOGIN_TYPE, Identifier: `directory:${urlHash}:${memberId}`, CountryId: t.countryId, Otp: otp,
          ExpiresAt: sqlUtc(new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000)), SentEmail: sentEmail, SentSms: sentSms, SentWhatsApp: sentWhatsApp });
      return ok({ sentEmail, sentSms, sentWhatsApp, expiresInSec: OTP_EXPIRY_MINUTES * 60 });
    });
  }

  private async sendOtpEmail(to: string, name: string, otp: string) {
    try {
      await this.email.send(to, "District Directory — Data Collection OTP", `${emailHeader()}
<h2 style='color:#1a365d;margin-top:0;'>District Directory — Data Collection OTP</h2>
<p>Dear ${esc(name)},</p>
<p>Your one-time password (OTP) to access the District Directory data collection form is:</p>
<div style='background-color:#f7fafc;border:2px solid #3182ce;border-radius:8px;padding:20px;margin:16px 0;text-align:center;'>
  <p style='font-size:32px;font-weight:bold;color:#1a365d;letter-spacing:8px;margin:0;'>${otp}</p>
</div>
<p style='color:#e53e3e;'><strong>This OTP is valid for ${OTP_EXPIRY_MINUTES} minutes.</strong></p>
<p>If you did not request this OTP, please ignore this email.</p>
${emailFooter()}`, { throwOnFailure: true });
      return true;
    } catch (e) {
      this.log.warn(`[OTP-EMAIL] ${name} → ${to} FAILED: ${(e as Error).message}`);
      return false;
    }
  }

  /** The member's form: allowed fields in canonical order with current values, the spouse flag and completion. */
  private async formPayload(conn: DbCommands, cfg: ConfigRow, memberId: number) {
    const group = await resolveGroup(conn, memberId, Number(cfg.districtId), Number(cfg.yearId));
    const keys = groupKeys(group, cfg.dcJson, cfg.bodJson, cfg.memJson);
    const values = await loadValues(conn, memberId, keys);
    const spouseNotApplicable = await getSpouseNotApplicable(conn, Number(cfg.id), memberId);
    const { filled, total, pendingLabels } = computeCompletion(values, applySpouseNotApplicable(keys, spouseNotApplicable));
    const fields = keys.map(getField).filter((f): f is FieldDef => f !== null).sort((a, b) => ALL_FIELDS.indexOf(a) - ALL_FIELDS.indexOf(b))
      .map((f) => ({ key: f.key, label: f.label, section: f.section, type: f.type, value: values.get(f.key) ?? null }));
    return { memberId, group, yearLabel: cfg.yearLabel, districtNumber: cfg.districtNumber, fields, spouseNotApplicable, hasSpouseFields: configIncludesSpouseFields(keys),
      completion: { filled, total, percent: pct(filled, total), pending: pendingLabels } };
  }

  /** Step 4: check the OTP (5 tries, 10 minutes) and open a 60-minute form session. */
  @Post(":urlHash/verify-otp")
  async verifyOtp(@Param("urlHash") urlHash: string, @Body() body: unknown) {
    const memberId = Math.trunc(Number(bodyField(body, "memberId")) || 0), otp = String(bodyField(body, "otp") ?? "");
    return this.db.session(async (conn) => {
      const cfg = await this.loadConfig(conn, urlHash);
      if (!cfg) return notFound({ message: "Invalid link" });
      const row = await conn.queryFirstOrDefault(
        `SELECT pk_otp_id AS id, otp_code, attempts, max_attempts, expires_at FROM mobile_login_otp
         WHERE identifier = @Identifier AND login_type = @LoginType AND is_used = 0 ORDER BY pk_otp_id DESC LIMIT 1`, { Identifier: `directory:${urlHash}:${memberId}`, LoginType: LOGIN_TYPE });
      if (!row) return badRequest({ message: "Please request an OTP first." });
      const use = () => conn.execute("UPDATE mobile_login_otp SET is_used = 1 WHERE pk_otp_id = @id", { id: row.id });
      if (Date.now() > utc(String(row.expires_at)).getTime()) { await use(); return badRequest({ message: "OTP expired. Please request a new one." }); }
      if (Number(row.attempts) >= Number(row.max_attempts)) { await use(); return badRequest({ message: "Too many attempts. Please request a new OTP." }); }
      if (String(row.otp_code) !== otp) {
        await conn.execute("UPDATE mobile_login_otp SET attempts = attempts + 1 WHERE pk_otp_id = @id", { id: row.id });
        return badRequest({ message: "Invalid OTP." });
      }
      await use();
      // The session token lives inside the identifier (otp_code is too short to hold it).
      const sessionToken = randomBytes(32).toString("hex");
      await conn.execute(
        `INSERT INTO mobile_login_otp (fk_member_master_profile_id, login_type, identifier, country_id, otp_code, expires_at, sent_email, sent_sms, is_used)
         VALUES (@MemberId, @LoginType, @Identifier, NULL, 'S', @Exp, 0, 0, 0)`,
        { MemberId: memberId, LoginType: LOGIN_TYPE_SESSION, Identifier: `dsess:${memberId}:${sessionToken}`, Exp: sqlUtc(new Date(Date.now() + 60 * 60_000)) });
      return ok({ sessionToken, ...(await this.formPayload(conn, cfg, memberId)) });
    });
  }

  /** The admin-contact path: the same form for any member, without an OTP. */
  @Post(":urlHash/admin-load-fields")
  async adminLoadFields(@Param("urlHash") urlHash: string, @Body() body: unknown) {
    const p = this.signer.validate(String(bodyField(body, "adminToken") ?? ""));
    if (!p || p.urlHash !== urlHash) return unauthorized({ message: "Admin session expired. Please log in again." });
    const memberId = Math.trunc(Number(bodyField(body, "memberId")) || 0);
    return this.db.session(async (conn) => {
      const cfg = await this.loadConfig(conn, urlHash);
      if (!cfg) return notFound({ message: "Invalid link" });
      return ok(await this.formPayload(conn, cfg, memberId));
    });
  }

  private async sessionValid(conn: DbCommands, memberId: number, token: string | null) {
    const s = await conn.queryFirstOrDefault("SELECT pk_otp_id AS id, expires_at FROM mobile_login_otp WHERE identifier = @Identifier AND login_type = @LoginType AND is_used = 0 ORDER BY pk_otp_id DESC LIMIT 1",
      { Identifier: `dsess:${memberId}:${token ?? ""}`, LoginType: LOGIN_TYPE_SESSION });
    return !!s && Date.now() <= utc(String(s.expires_at)).getTime();
  }

  /** A profile or spouse photo (jpg / png / webp, ≤ 5 MB) under /Documents/directory; returns its path for the form. */
  @Post(":urlHash/upload-photo")
  @ReadsRequestForm()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 6 * 1024 * 1024 } }))
  async uploadPhoto(@Param("urlHash") urlHash: string, @Query("memberId") mq: string | undefined, @Query("sessionToken") st: string | undefined, @Query("kind") k: string | undefined,
                    @Query("adminToken") at: string | undefined, @UploadedFile() f?: Upload) {
    const memberId = queryInt(mq, 0), kind = queryString(k);
    if (kind !== "profile" && kind !== "spouse") return badRequest({ message: "kind must be 'profile' or 'spouse'" });
    if (!f || f.size === 0) return badRequest({ message: "No file uploaded" });
    const ext = lowerExtension(f.originalname);
    if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return badRequest({ message: "Invalid file type. Allowed: jpg, jpeg, png, webp" });
    if (f.size > 5 * 1024 * 1024) return badRequest({ message: "File size must be less than 5 MB" });
    const admin = this.signer.validate(queryString(at));
    if (!(admin && admin.urlHash === urlHash) && !(await this.sessionValid(this.db, memberId, queryString(st)))) return unauthorized({ message: "Session expired. Please request OTP again." });
    // ddMMyyyyhhmmssfffffff + tt (brand clock; the 7-digit fraction is milliseconds padded).
    const n = nowIn(Brand.Current.locale.defaultTimeZone), h = Number(n.slice(11, 13));
    const stamp = `${n.slice(8, 10)}${n.slice(5, 7)}${n.slice(0, 4)}${String(h % 12 || 12).padStart(2, "0")}${n.slice(14, 16)}${n.slice(17, 19)}${String(Date.now() % 1000).padStart(3, "0")}0000${h < 12 ? "AM" : "PM"}`;
    const fileName = `${kind === "profile" ? "MEMBER" : "SPOUSE"}${memberId}_${stamp}${ext}`;
    const dir = join(webRootPath(this.config), "Documents", "directory");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, fileName), f.buffer);
    this.log.log(`[PHOTO UPLOAD] member=${memberId} kind=${kind} file=${fileName}`);
    return ok({ path: `/Documents/directory/${fileName}` });
  }

  /** Step 5: save the allowed fields (blank clears), record the submission, and confirm by email / WhatsApp in the background. */
  @Post(":urlHash/submit")
  async submit(@Param("urlHash") urlHash: string, @Body() body: unknown, @Req() req: Request) {
    const memberId = Math.trunc(Number(bodyField(body, "memberId")) || 0);
    const spouseNa = bodyField(body, "spouseNotApplicable") === true;
    const rawFields = bodyField(body, "fields");
    const submitted: Record<string, string | null> = {};
    if (rawFields && typeof rawFields === "object" && !Array.isArray(rawFields))
      for (const [k, v] of Object.entries(rawFields)) submitted[k] = v === null || v === undefined ? null : String(v);
    return this.db.session(async (conn) => {
      const cfg = await this.loadConfig(conn, urlHash, `, c.FirstContactName AS firstContactName, c.FirstContactMobile AS firstContactMobile, c.SecondContactName AS secondContactName,
        c.SecondContactMobile AS secondContactMobile, COALESCE(c.SendEmail, 1) AS sendEmail, COALESCE(c.SendWhatsapp, 1) AS sendWhatsapp`);
      if (!cfg) return notFound({ message: "Invalid link" });
      const admin = this.signer.validate(String(bodyField(body, "adminToken") ?? ""));
      const isAdmin = !!admin && admin.urlHash === urlHash;
      if (!isAdmin && !(await this.sessionValid(conn, memberId, String(bodyField(body, "sessionToken") ?? "")))) return unauthorized({ message: "Session expired. Please request OTP again." });
      const group = await resolveGroup(conn, memberId, Number(cfg.districtId), Number(cfg.yearId));
      const allowed = groupKeys(group, cfg.dcJson, cfg.bodJson, cfg.memJson);
      // Only the configured keys are applied; anything else is ignored.
      let safe = Object.fromEntries(Object.entries(submitted).filter(([k]) => allowed.includes(k)));
      for (const [k, v] of Object.entries(safe)) {
        const f = getField(k);
        if (!f || f.type !== "address-bulk" || blank(v)) continue;
        try {
          const el = JSON.parse(v!) as Record<string, unknown>;
          const get = (n: string) => (el[n] === null || el[n] === undefined ? null : String(el[n]));
          const any = ["Address", "City", "State", "PinCode", "PhoneNumber", "BusinessEmailId", "Designation"].some((n) => !blank(get(n)));
          const core = ["Address", "City", "State", "PinCode"].every((n) => !blank(get(n)));
          if (any && !core) return badRequest({ message: `${f.label}: please fill Address, City, State and PinCode — or clear all fields.` });
        } catch {
          // malformed JSON: skipped on save
        }
      }
      // "No spouse": spouse fields are left untouched (not cleared), so unticking later restores them.
      if (spouseNa) safe = Object.fromEntries(Object.entries(safe).filter(([k]) => { const f = getField(k); return !!f && !isSpouseField(f); }));
      await this.applyFieldUpdates(conn, memberId, safe);
      await setSpouseNotApplicable(conn, Number(cfg.id), memberId, spouseNa);
      // No spouse means no wedding anniversary anywhere.
      if (spouseNa && allowed.includes("anniversaryDate"))
        await conn.execute("UPDATE member_master_profile SET AnniversaryDate = NULL, modified_date = NOW() WHERE pk_member_master_profile_id = @id", { id: memberId });
      const latest = await loadValues(conn, memberId, allowed);
      const effective = applySpouseNotApplicable(allowed, spouseNa);
      const { filled, total, pendingLabels } = computeCompletion(latest, effective);
      await conn.execute(
        `INSERT INTO district_directory_submission_log (fk_config_id, fk_member_id, GroupType, FieldsSubmittedJson, CompletedCount, TotalCount, IpAddress, UserAgent, FilledByAdminMobile)
         VALUES (@ConfigId, @MemberId, @Group, @Json, @Filled, @Total, @Ip, @Ua, @AdminMobile)`,
        { ConfigId: Number(cfg.id), MemberId: memberId, Group: group, Json: JSON.stringify(Object.keys(safe)), Filled: filled, Total: total, Ip: clientIp(req.ip ?? req.socket.remoteAddress) ?? "",
          Ua: req.get("user-agent") ?? "", AdminMobile: isAdmin ? admin!.mobile : null });
      const info = await conn.queryFirstOrDefault("SELECT MemberName AS name, PrimaryMobileNumber AS mobile, EmailId AS email FROM member_master_profile WHERE pk_member_master_profile_id = @id", { id: memberId });
      const sendEmail = Number(cfg.sendEmail) !== 0, sendWhatsapp = Number(cfg.sendWhatsapp) !== 0;
      // The member's link is always the plain public URL (never the admin login flow).
      void this.confirm({
        memberId, name: String(info?.name ?? ""), mobile: info?.mobile ?? null, email: info?.email ?? null, yearLabel: cfg.yearLabel, districtNumber: cfg.districtNumber, filled, total,
        pending: pendingLabels, group, keys: effective, values: latest, url: `${this.publicBase.replace(/\/+$/, "")}/public/directory-data-collection?ID=${urlHash}`,
        contact: buildContactText(cfg.firstContactName as string | null, cfg.firstContactMobile as string | null, cfg.secondContactName as string | null, cfg.secondContactMobile as string | null),
        sendEmail, sendWhatsapp,
      });
      const channels = [sendEmail ? "email" : null, sendWhatsapp ? "WhatsApp" : null].filter(Boolean);
      return ok({
        saved: Object.keys(safe).length, completion: { filled, total, percent: pct(filled, total), pending: pendingLabels },
        message: channels.length ? `Your details have been saved. A confirmation is being sent to your ${channels.join(" and ")}.` : "Your details have been saved.",
      });
    });
  }

  /** Writes profile columns, the latest Spouse row, and address rows (bulk first, then single columns), clearing on blank. */
  private async applyFieldUpdates(conn: DbCommands, memberId: number, fields: Record<string, string | null>) {
    const defs = Object.keys(fields).map(getField).filter((f): f is FieldDef => f !== null);
    for (const f of defs.filter((x) => x.storage === "profile" && x.column)) {
      const raw = fields[f.key];
      let value: string | null;
      if (blank(raw)) value = null;
      else if (f.type === "date") {
        const d = parseDay(raw!);
        if (!d) continue; // unparseable: left as it is
        if (f.column === "BirthDate" || f.column === "AnniversaryDate") {
          value = placeholderDay(d);
          if (value === null) continue;
        } else value = ymd(...d);
      } else value = raw;
      try {
        await conn.execute(`UPDATE member_master_profile SET \`${f.column}\` = @v, modified_date = NOW() WHERE pk_member_master_profile_id = @id`, { v: value, id: memberId });
      } catch (e) {
        // a NOT NULL column (e.g. the name) cannot be cleared: skipped, the rest still saves
        this.log.warn(`Directory submit: could not set profile column ${f.column} for member ${memberId}: ${(e as Error).message}`);
      }
    }
    const family = defs.filter((x) => x.storage === "family" && x.column);
    if (family.length) {
      const existing = await conn.executeScalar(
        `SELECT pk_member_family_details_id FROM member_family_details WHERE fk_member_master_profile_id = @id AND Relation = 'Spouse' AND (isdeleted IS NULL OR isdeleted = 0)
         ORDER BY COALESCE(modified_date, created_date) DESC, pk_member_family_details_id DESC LIMIT 1`, { id: memberId });
      const p: Record<string, unknown> = { memberId };
      for (const f of family) {
        const v = fields[f.key];
        if (f.type === "date") {
          const d = !blank(v) ? parseDay(v!) : null;
          p[f.column!] = d === null ? null : f.column === "BirthDate" || f.column === "AnniversaryDate" ? placeholderDay(d) : ymd(...d);
        } else p[f.column!] = !v ? null : v;
      }
      const emptyName = () => { if (p.Name === null || p.Name === undefined || blank(p.Name)) p.Name = ""; };
      if (existing === null || existing === undefined) {
        // No spouse row yet: insert only when something was entered (Name is NOT NULL).
        if (Object.entries(p).some(([k, v]) => k !== "memberId" && !blank(v))) {
          emptyName();
          const cols = family.map((f) => f.column!);
          if (!cols.includes("Name")) cols.push("Name");
          await conn.execute(`INSERT INTO member_family_details (fk_member_master_profile_id, Relation, ${cols.map((c) => `\`${c}\``).join(",")}) VALUES (@memberId, 'Spouse', ${cols.map((c) => `@${c}`).join(",")})`, p);
        }
      } else {
        p.id = existing;
        if (family.some((f) => f.column === "Name")) emptyName();
        await conn.execute(`UPDATE member_family_details SET ${family.map((f) => `\`${f.column}\` = @${f.column}`).join(",")}, modified_date = NOW() WHERE pk_member_family_details_id = @id`, p);
      }
    }
    const address = defs.filter((x) => x.storage === "address").sort((a, b) => (a.type === "address-bulk" ? 0 : 1) - (b.type === "address-bulk" ? 0 : 1));
    for (const f of address) {
      const raw = fields[f.key];
      const existing = await conn.executeScalar(
        "SELECT pk_member_address_details_id FROM member_address_details WHERE fk_member_master_profile_id = @id AND AddressType = @t AND (isdeleted IS NULL OR isdeleted = 0) LIMIT 1",
        { id: memberId, t: f.addressType });
      if (f.type === "address-bulk") {
        const v: Record<string, string | null> = { Address: null, City: null, State: null, PinCode: null, PhoneNumber: null, BusinessEmailId: null, Designation: null };
        let countryId: number | null = null;
        if (!blank(raw)) {
          try {
            const el = JSON.parse(raw!) as Record<string, unknown>;
            for (const k of Object.keys(v)) v[k] = el[k] === null || el[k] === undefined ? null : String(el[k]);
            const c = el.CountryId;
            if (typeof c === "number" && Number.isInteger(c)) countryId = c;
            else if (typeof c === "string" && /^\s*-?\d+\s*$/.test(c)) countryId = parseInt(c, 10);
          } catch {
            continue; // malformed JSON: the row is left as it is
          }
        }
        const isBiz = f.addressType === "Business";
        if (isBiz) await this.updateDesignationClassification(conn, memberId, "Designation", v.Designation);
        if (!["Address", "City", "State", "PinCode", "PhoneNumber", "BusinessEmailId"].some((k) => !blank(v[k]))) {
          // Cleared: the address row is soft-deleted.
          if (existing !== null && existing !== undefined)
            await conn.execute("UPDATE member_address_details SET isdeleted = 1, modified_date = NOW() WHERE pk_member_address_details_id = @existingId", { existingId: existing });
          continue;
        }
        // ROW: an address without a country takes the member's own country (RIZones used country id 1).
        countryId ??= Number((await conn.executeScalar("SELECT fk_primary_country_id FROM member_master_profile WHERE pk_member_master_profile_id = @id", { id: memberId })) ?? 0) || 1;
        const prms = { id: memberId, t: f.addressType, address: v.Address, city: v.City, state: v.State, pinCode: v.PinCode, phoneNumber: v.PhoneNumber, countryId, businessEmail: v.BusinessEmailId, existingId: existing };
        if (existing === null || existing === undefined)
          await conn.execute(isBiz
            ? `INSERT INTO member_address_details (fk_member_master_profile_id, AddressType, fk_country_id, PhoneNumber, Address, State, City, PinCode, BusinessEmailId)
               VALUES (@id, @t, @countryId, @phoneNumber, @address, @state, @city, @pinCode, @businessEmail)`
            : `INSERT INTO member_address_details (fk_member_master_profile_id, AddressType, fk_country_id, PhoneNumber, Address, State, City, PinCode)
               VALUES (@id, @t, @countryId, @phoneNumber, @address, @state, @city, @pinCode)`, prms);
        else
          await conn.execute(`UPDATE member_address_details SET fk_country_id = @countryId, PhoneNumber = NULLIF(@phoneNumber,''), Address = NULLIF(@address,''), State = NULLIF(@state,''),
                                     City = NULLIF(@city,''), PinCode = NULLIF(@pinCode,'')${isBiz ? ", BusinessEmailId = NULLIF(@businessEmail,'')" : ""}, modified_date = NOW()
                              WHERE pk_member_address_details_id = @existingId`, prms);
      } else if (f.type === "address-single" && f.column) {
        // Designation / classification live on club_members (every active membership); blank clears.
        if (f.column.toLowerCase() === "designation") { await this.updateDesignationClassification(conn, memberId, "Designation", raw); continue; }
        if (f.column.toLowerCase() === "classificationprofession") { await this.updateDesignationClassification(conn, memberId, "ClassificationProfession", raw); continue; }
        const val = blank(raw) ? null : raw;
        if (existing !== null && existing !== undefined)
          await conn.execute(`UPDATE member_address_details SET \`${f.column}\` = @v, modified_date = NOW() WHERE pk_member_address_details_id = @existingId`, { v: val, existingId: existing });
        else if (val !== null)
          await conn.execute(`INSERT INTO member_address_details (fk_member_master_profile_id, AddressType, \`${f.column}\`) VALUES (@id, @t, @v)`, { id: memberId, t: f.addressType, v: val });
      }
    }
  }

  private updateDesignationClassification(conn: DbCommands, memberId: number, column: "Designation" | "ClassificationProfession", value: string | null | undefined) {
    return conn.execute(`UPDATE club_members SET ${column} = @V, modified_date = NOW() WHERE fk_member_master_profile_id = @M AND COALESCE(isdeleted, 0) = 0`,
      { V: blank(value) ? null : String(value).trim(), M: memberId });
  }

  /** Email with the completed / pending breakdown; WhatsApp only while fields are pending (the one approved template says "incomplete"). */
  private async confirm(p: { memberId: number; name: string; mobile: string | null; email: string | null; yearLabel: string; districtNumber: string; filled: number; total: number; pending: string[];
    group: string; keys: string[]; values: Map<string, string | null>; url: string; contact: string; sendEmail: boolean; sendWhatsapp: boolean }) {
    try {
      if (p.sendEmail && !blank(p.email)) {
        const html = `${emailHeader()}
<h2 style="color:#1a365d;margin-top:0;">District Directory — Submission Received</h2>
<p>Hello ${esc(p.name)},</p>
<p>Thank you for submitting your data for the <b>District Directory ${p.yearLabel} (District ${p.districtNumber})</b>.</p>
<p>Status: <b>${p.filled} of ${p.total} fields completed — ${pct(p.filled, p.total)}%</b>.</p>
${buildCompletedAndPendingHtml(p.keys, p.values, this.apiBase)}
<p style="margin-top:20px;">If you require any assistance, please contact <b>${esc(p.contact)}</b>.</p>
<p style="color:#64748b;font-size:13px;margin-top:20px;">Regards,<br/><b>District Team</b></p>
${emailFooter()}`;
        await this.email.send(p.email!, `District Directory ${p.yearLabel} — Submission Received`, html, { throwOnFailure: true })
          .catch((e: Error) => this.log.warn(`[SUBMIT-EMAIL] ${p.name} → ${p.email} FAILED: ${e.message}`));
      }
      if (p.sendWhatsapp && p.pending.length > 0 && !blank(p.mobile)) {
        const e164 = await memberE164(this.db, p.memberId, p.mobile);
        const sent = e164 !== null && await this.whatsApp.sendTemplate(e164, "district_directory_form_incomplete_final", Brand.Current.locale.defaultLanguage,
          [p.name, p.yearLabel, p.districtNumber, String(p.pending.length), String(p.total), p.pending.map((x, i) => `${i + 1}) ${x}`).join("\n"), p.url, p.contact].map(templateParam)).catch(() => false);
        if (!sent) this.log.warn(`[SUBMIT-WA] ${p.name} → ${p.mobile} not sent`);
      }
    } catch (e) {
      this.log.error(`Submit confirmation failed: ${(e as Error).message}`);
    }
  }
}
