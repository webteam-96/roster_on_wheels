import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import JSZip from "jszip";
import { Brand } from "../../brand/brand";
import { AppConfig } from "../../config/app-config";
import { Db, type DbCommands, type DbSession } from "../../database/db.service";
import { webRootPath } from "../../services/media-storage";
import {
  AUDIT_IGNORED_TABLES, ERASED_NAME, NOT_PERSONAL_COLUMN, PERSONAL_COLUMN_PATTERN, PERSONAL_DATA, type Match, type PersonalTable,
} from "./personal-data-registry";

/** Statuses as the admin's privacy screens use them (src/types/privacy.ts). */
export type RequestStatus = "pending" | "awaiting_approval" | "processing" | "completed" | "rejected" | "failed";

export interface PrivacyRequestDto {
  id: number;
  kind: "export" | "erase";
  status: RequestStatus;
  memberId: number;
  memberName: string;
  clubName: string | null;
  reason: string | null;
  requestedBy: string;
  requestedAt: string;
  approvedBy: string | null;
  completedAt: string | null;
  downloadUrl: string | null;
  downloadExpiresAt: string | null;
}

/** Thrown for a request the caller may not make or that cannot run; the controller turns it into 400/403/404. */
export class PrivacyError extends Error {
  constructor(readonly status: 400 | 403 | 404, message: string) {
    super(message);
  }
}

const EXPORT_DAYS = 7;
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const utcNow = () => new Date().toISOString().slice(0, 19).replace("T", " ");

/** Tables created by the privacy work (master plan Appendix B.13 to B.15), on first use. */
async function ensureTables(conn: DbCommands): Promise<void> {
  await conn.execute(`CREATE TABLE IF NOT EXISTS privacy_requests (
      pk_request_id INT AUTO_INCREMENT PRIMARY KEY,
      request_type VARCHAR(10) NOT NULL,
      fk_member_id INT NOT NULL,
      fk_district_id INT NULL,
      requested_by INT NOT NULL,
      approved_by INT NULL,
      reason VARCHAR(500) NULL,
      status VARCHAR(20) NOT NULL,
      export_guid CHAR(36) NULL,
      export_expires_at DATETIME NULL,
      requested_at DATETIME NOT NULL,
      completed_at DATETIME NULL,
      error VARCHAR(500) NULL,
      KEY ix_privreq_district (fk_district_id, requested_at),
      KEY ix_privreq_member (fk_member_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await conn.execute(`CREATE TABLE IF NOT EXISTS member_erasure_tombstone (
      rotary_id_hash CHAR(64) NOT NULL PRIMARY KEY,
      fk_club_id INT NULL,
      erased_at_utc DATETIME NOT NULL,
      erased_by INT NOT NULL,
      reason VARCHAR(500) NULL,
      KEY ix_tomb_club (fk_club_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await conn.execute(`CREATE TABLE IF NOT EXISTS member_consents (
      pk_consent_id INT AUTO_INCREMENT PRIMARY KEY,
      fk_member_id INT NOT NULL,
      policy_version VARCHAR(20) NOT NULL,
      accepted_at_utc DATETIME NOT NULL,
      withdrawn_at_utc DATETIME NULL,
      language VARCHAR(10) NOT NULL,
      ip_address VARCHAR(45) NULL,
      channel VARCHAR(10) NOT NULL,
      KEY ix_consent_member (fk_member_id, policy_version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

interface MemberFacts {
  id: number;
  name: string;
  rotaryId: string | null;
  emails: string[];
  mobiles: string[];
  clubId: number | null;
  clubName: string | null;
  districtIds: number[];
  photoPaths: string[];
}

/**
 * Member privacy (master plan WS7): consent at first sign-in after a policy change, data export, erasure
 * that the Rotary.org sync honours (tombstone), the registry audit and log retention. Everything is
 * behind the brand flag privacy.enabled.
 */
@Injectable()
export class PrivacyService implements OnModuleInit {
  private readonly log = new Logger("PrivacyService");
  private tablesReady = false;

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  /** The consent filter in the email and push senders reads member_consents, so it must exist from start-up. */
  async onModuleInit() {
    if (!this.enabled) return;
    await this.db.session((conn) => this.ready(conn)).catch((e) => this.log.warn(`privacy tables not ensured: ${(e as Error).message}`));
  }

  get enabled(): boolean {
    return Brand.feature("privacy.enabled");
  }

  private async ready(conn: DbCommands): Promise<void> {
    if (this.tablesReady) return;
    await ensureTables(conn);
    this.tablesReady = true;
  }

  // ── Consent (WS7-05) ──────────────────────────────────────────────────────────────────────

  async consentStatus(memberId: number) {
    const policyVersion = Brand.Current.legal.policyVersion ?? "";
    return this.db.session(async (conn) => {
      await this.ready(conn);
      const acceptedVersion = await conn.executeScalar<string>(
        `SELECT policy_version FROM member_consents
         WHERE fk_member_id = @Id AND withdrawn_at_utc IS NULL ORDER BY accepted_at_utc DESC, pk_consent_id DESC LIMIT 1`,
        { Id: memberId },
      );
      return {
        required: this.enabled && policyVersion !== "" && acceptedVersion !== policyVersion,
        policyVersion,
        acceptedVersion: acceptedVersion ?? null,
      };
    });
  }

  async acceptConsent(memberId: number, policyVersion: string, language: string, ip: string | null, channel: "web" | "app") {
    const current = Brand.Current.legal.policyVersion ?? "";
    if (!current || policyVersion !== current) throw new PrivacyError(400, "The policy version is not the current one.");
    await this.db.session(async (conn) => {
      await this.ready(conn);
      await conn.execute(
        `INSERT INTO member_consents (fk_member_id, policy_version, accepted_at_utc, language, ip_address, channel)
         VALUES (@Id, @Version, @Now, @Lang, @Ip, @Channel)`,
        { Id: memberId, Version: policyVersion, Now: utcNow(), Lang: language.slice(0, 10) || "en", Ip: ip, Channel: channel },
      );
    });
  }

  async withdrawConsent(memberId: number) {
    await this.db.session(async (conn) => {
      await this.ready(conn);
      await conn.execute(
        "UPDATE member_consents SET withdrawn_at_utc = @Now WHERE fk_member_id = @Id AND withdrawn_at_utc IS NULL",
        { Id: memberId, Now: utcNow() },
      );
    });
  }

  /** True when the member accepted the current policy (marketing-type messages need it; transactional ones do not). */
  async hasConsent(conn: DbCommands, memberId: number): Promise<boolean> {
    if (!this.enabled) return true;
    await this.ready(conn);
    const version = Brand.Current.legal.policyVersion ?? "";
    const n = await conn.executeScalar<number>(
      `SELECT COUNT(*) FROM member_consents WHERE fk_member_id = @Id AND withdrawn_at_utc IS NULL
         AND (@Version = '' OR policy_version = @Version)`,
      { Id: memberId, Version: version },
    );
    return Number(n) > 0;
  }

  // ── Who may act on whom ───────────────────────────────────────────────────────────────────

  private async facts(conn: DbCommands, memberId: number): Promise<MemberFacts> {
    const p = await conn.queryFirstOrDefault<Record<string, unknown>>(
      `SELECT * FROM member_master_profile WHERE pk_member_master_profile_id = @Id`, { Id: memberId },
    );
    if (!p) throw new PrivacyError(404, "Member not found.");
    const clubs = await conn.query<{ clubId: number; clubName: string; districtId: number | null }>(
      `SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.fk_district_id AS districtId
       FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
       WHERE cm.fk_member_master_profile_id = @Id AND cm.isdeleted = 0
       ORDER BY cm.IsActive DESC, cm.pk_club_member_id`, { Id: memberId },
    );
    const family = await conn.query<{ PhotoPath: string | null; EmailId: string | null; PhoneNumber: string | null }>(
      "SELECT PhotoPath, EmailId, PhoneNumber FROM member_family_details WHERE fk_member_master_profile_id = @Id", { Id: memberId },
    ).catch(() => []);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const emails = [p.EmailId, p.SecondaryEmailId].map(str).filter((v): v is string => !!v);
    const mobiles = [p.PrimaryMobileNumber, p.SecondaryMobileNumber].map(str).filter((v): v is string => !!v);
    return {
      id: memberId,
      name: str(p.MemberName) ?? "",
      rotaryId: str(p.RotaryId),
      emails,
      mobiles,
      clubId: clubs[0]?.clubId ?? null,
      clubName: clubs[0]?.clubName ?? null,
      districtIds: [...new Set(clubs.map((c) => Number(c.districtId)).filter((d) => d > 0))],
      photoPaths: [p.ProfilePhotoPath, p.FamilyPhotoPath, ...family.map((f) => f.PhotoPath)].map(str).filter((v): v is string => !!v),
    };
  }

  private async isDistrictAdmin(conn: DbCommands, userId: number, districtIds: number[]): Promise<boolean> {
    if (!districtIds.length || userId <= 0) return false;
    const n = await conn.executeScalar<number>(
      `SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @User AND fk_role_id = 2
         AND fk_district_id IN @Districts AND (fk_club_id IS NULL OR fk_club_id = 0) AND IsActive = 1 AND isdeleted = 0`,
      { User: userId, Districts: districtIds },
    );
    return Number(n) > 0;
  }

  // ── Requests ──────────────────────────────────────────────────────────────────────────────

  private requestSql(where: string) {
    return `SELECT r.pk_request_id AS id, r.request_type AS kind, r.status, r.fk_member_id AS memberId, r.reason,
                   r.requested_at AS requestedAt, r.completed_at AS completedAt, r.export_guid AS exportGuid,
                   r.export_expires_at AS exportExpiresAt, r.requested_by AS requestedById,
                   m.MemberName AS memberName, rb.MemberName AS requestedBy, ab.MemberName AS approvedBy,
                   (SELECT c.ClubName FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                     WHERE cm.fk_member_master_profile_id = r.fk_member_id ORDER BY cm.IsActive DESC, cm.pk_club_member_id LIMIT 1) AS clubName
            FROM privacy_requests r
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = r.fk_member_id
            LEFT JOIN member_master_profile rb ON rb.pk_member_master_profile_id = r.requested_by
            LEFT JOIN member_master_profile ab ON ab.pk_member_master_profile_id = r.approved_by
            WHERE ${where}`;
  }

  private toDto(r: Record<string, unknown>): PrivacyRequestDto {
    const date = (v: unknown) => (v == null ? null : typeof v === "string" ? v : iso(v as Date));
    const expires = date(r.exportExpiresAt);
    const guid = typeof r.exportGuid === "string" ? r.exportGuid : null;
    const live = r.status === "completed" && guid && expires && Date.parse(expires) > Date.now();
    return {
      id: Number(r.id),
      kind: r.kind === "erase" ? "erase" : "export",
      status: String(r.status) as RequestStatus,
      memberId: Number(r.memberId),
      memberName: String(r.memberName ?? ""),
      clubName: (r.clubName as string) ?? null,
      reason: (r.reason as string) ?? null,
      requestedBy: String(r.requestedBy ?? ""),
      requestedAt: date(r.requestedAt) ?? "",
      approvedBy: (r.approvedBy as string) ?? null,
      completedAt: date(r.completedAt),
      downloadUrl: live ? this.signedDownloadUrl(guid, Date.parse(expires)) : null,
      downloadExpiresAt: live ? expires : null,
    };
  }

  private async loadRequest(conn: DbCommands, id: number): Promise<PrivacyRequestDto> {
    const r = await conn.queryFirstOrDefault<Record<string, unknown>>(this.requestSql("r.pk_request_id = @Id"), { Id: id });
    if (!r) throw new PrivacyError(404, "Request not found.");
    return this.toDto(r);
  }

  async listRequests(user: { id: number; superAdmin: boolean }, districtId: number): Promise<PrivacyRequestDto[]> {
    return this.db.session(async (conn) => {
      await this.ready(conn);
      if (!user.superAdmin && !(await this.isDistrictAdmin(conn, user.id, [districtId]))) throw new PrivacyError(403, "Only the district's admins can see its privacy requests.");
      const rows = await conn.query<Record<string, unknown>>(
        this.requestSql("r.fk_district_id = @District") + " ORDER BY r.requested_at DESC, r.pk_request_id DESC LIMIT 500",
        { District: districtId },
      );
      return rows.map((r) => this.toDto(r));
    });
  }

  private async insertRequest(conn: DbCommands, kind: "export" | "erase", m: MemberFacts, by: number, status: RequestStatus, reason: string | null) {
    const id = await conn.executeScalar<number>(
      `INSERT INTO privacy_requests (request_type, fk_member_id, fk_district_id, requested_by, reason, status, requested_at)
       VALUES (@Kind, @Member, @District, @By, @Reason, @Status, @Now); SELECT LAST_INSERT_ID();`,
      { Kind: kind, Member: m.id, District: m.districtIds[0] ?? null, By: by, Reason: reason, Status: status, Now: utcNow() },
    );
    return Number(id);
  }

  private async audit(conn: DbCommands, byId: number, action: string, memberId: number, details: string) {
    await conn.execute(
      `INSERT INTO audit_log (fk_member_master_profile_id, action, entity_type, entity_id, details, created_date)
       VALUES (@By, @Action, 'privacy', @Member, @Details, @Now)`,
      { By: byId, Action: action, Member: memberId, Details: details.slice(0, 2000), Now: utcNow() },
    ).catch((e) => this.log.warn(`audit row not written: ${(e as Error).message}`));
  }

  // ── Export (WS7-02) ──────────────────────────────────────────────────────────────────────

  async requestExport(user: { id: number; superAdmin: boolean }, memberId: number): Promise<PrivacyRequestDto> {
    return this.db.session(async (conn) => {
      await this.ready(conn);
      const m = await this.facts(conn, memberId);
      const allowed = user.superAdmin || user.id === memberId || (await this.isDistrictAdmin(conn, user.id, m.districtIds));
      if (!allowed) throw new PrivacyError(403, "Only the member, their District Admin or a SuperAdmin can export this member's data.");
      const id = await this.insertRequest(conn, "export", m, user.id, "processing", null);
      try {
        const guid = randomUUID();
        await this.writeExport(conn, m, guid);
        const expires = new Date(Date.now() + EXPORT_DAYS * 86400_000);
        await conn.execute(
          `UPDATE privacy_requests SET status = 'completed', export_guid = @Guid, export_expires_at = @Expires, completed_at = @Now
           WHERE pk_request_id = @Id`,
          { Id: id, Guid: guid, Expires: iso(expires).slice(0, 19).replace("T", " "), Now: utcNow() },
        );
        await this.audit(conn, user.id, "PRIVACY_EXPORT", memberId, `request ${id}`);
      } catch (e) {
        this.log.error(`export ${id} failed: ${(e as Error).message}`);
        await conn.execute("UPDATE privacy_requests SET status = 'failed', error = @Err WHERE pk_request_id = @Id", { Id: id, Err: (e as Error).message.slice(0, 500) });
      }
      return this.loadRequest(conn, id);
    });
  }

  private exportRoot(): string {
    return this.config.get("Privacy:ExportRoot") || join(process.cwd(), "App_Data", "privacy-exports");
  }

  private async writeExport(conn: DbCommands, m: MemberFacts, guid: string) {
    const schema = await this.schema(conn);
    const zip = new JSZip();
    const readme: string[] = [
      `${Brand.Current.productName}: data held about member ${m.id}`,
      `Created ${iso(new Date())} (UTC). One JSON and one CSV file per table that holds rows about this member.`,
      "",
    ];
    for (const entry of PERSONAL_DATA) {
      if (entry.export === false) continue;
      const where = this.whereFor(entry, schema, m);
      if (!where) continue;
      const rows = await conn.query<Record<string, unknown>>(`SELECT * FROM \`${entry.table}\` WHERE ${where.sql}`, where.params);
      if (!rows.length) continue;
      const clean = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !/password|token|otp/i.test(k))));
      const name = `${entry.table}${entry.match.by === "memberId" ? "" : `.by-${entry.match.by}`}`;
      zip.file(`${name}.json`, JSON.stringify(clean, null, 2));
      zip.file(`${name}.csv`, toCsv(clean));
      readme.push(`${name}: ${rows.length} row(s)`);
    }
    zip.file("README.txt", readme.join("\n"));
    const dir = this.exportRoot();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${guid}.zip`), await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  }

  private signingKey(): Buffer {
    const raw = this.config.get("Privacy:LinkKey") || this.config.get("JwtSettings:Secret");
    if (!raw) throw new PrivacyError(400, "Privacy:LinkKey or JwtSettings:Secret must be configured.");
    return createHash("sha256").update(raw).digest();
  }

  private signature(guid: string, expiresMs: number): string {
    return createHmac("sha256", this.signingKey()).update(`${guid}.${expiresMs}`).digest("hex");
  }

  /** The admin opens the file with a plain link, so the link itself carries an expiring signature. */
  private signedDownloadUrl(guid: string, expiresMs: number): string {
    const base = (this.config.get("BackendUrl") || Brand.Current.domains.apiBase || "").replace(/\/$/, "");
    return `${base}/api/privacy/exports/${guid}?expires=${expiresMs}&sig=${this.signature(guid, expiresMs)}`;
  }

  async exportFile(guid: string, expires: string, sig: string): Promise<Buffer> {
    const expiresMs = Number(expires);
    if (!/^[0-9a-f-]{36}$/.test(guid) || !Number.isFinite(expiresMs) || expiresMs < Date.now()) throw new PrivacyError(404, "The download link has expired.");
    const expected = Buffer.from(this.signature(guid, expiresMs), "hex");
    const given = Buffer.from(/^[0-9a-f]{64}$/.test(sig) ? sig : "", "hex");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new PrivacyError(404, "The download link is not valid.");
    const path = join(this.exportRoot(), `${guid}.zip`);
    if (!existsSync(path)) throw new PrivacyError(404, "The export is no longer available.");
    await this.db.session((conn) => conn.execute(
      `INSERT INTO audit_log (action, entity_type, details, created_date) VALUES ('PRIVACY_DOWNLOAD', 'privacy', @Guid, @Now)`,
      { Guid: guid, Now: utcNow() },
    )).catch(() => undefined);
    return readFile(path);
  }

  // ── Erasure (WS7-03) ─────────────────────────────────────────────────────────────────────

  async requestErasure(user: { id: number; superAdmin: boolean }, memberId: number, reason: string): Promise<PrivacyRequestDto> {
    if (!reason.trim()) throw new PrivacyError(400, "A reason is required.");
    return this.db.session(async (conn) => {
      await this.ready(conn);
      const m = await this.facts(conn, memberId);
      if (!user.superAdmin && !(await this.isDistrictAdmin(conn, user.id, m.districtIds))) throw new PrivacyError(403, "Only the member's District Admin or a SuperAdmin can erase a member.");
      // A District Admin's request waits for a second District Admin (or a SuperAdmin) to approve it.
      const id = await this.insertRequest(conn, "erase", m, user.id, user.superAdmin ? "processing" : "awaiting_approval", reason.trim().slice(0, 500));
      if (user.superAdmin) await this.runErasure(conn, id, m, user.id, reason.trim());
      return this.loadRequest(conn, id);
    });
  }

  async approve(user: { id: number; superAdmin: boolean }, requestId: number): Promise<PrivacyRequestDto> {
    return this.db.session(async (conn) => {
      await this.ready(conn);
      const r = await conn.queryFirstOrDefault<{ type: string; status: string; memberId: number; by: number; reason: string | null; district: number | null }>(
        `SELECT request_type AS type, status, fk_member_id AS memberId, requested_by AS \`by\`, reason, fk_district_id AS district
         FROM privacy_requests WHERE pk_request_id = @Id`, { Id: requestId },
      );
      if (!r) throw new PrivacyError(404, "Request not found.");
      if (r.type !== "erase" || r.status !== "awaiting_approval") throw new PrivacyError(400, "Only an erasure waiting for approval can be approved.");
      if (Number(r.by) === user.id && !user.superAdmin) throw new PrivacyError(403, "A second District Admin must approve this erasure.");
      if (!user.superAdmin && !(await this.isDistrictAdmin(conn, user.id, r.district ? [Number(r.district)] : []))) throw new PrivacyError(403, "Only the district's admins can approve this erasure.");
      await conn.execute("UPDATE privacy_requests SET approved_by = @By, status = 'processing' WHERE pk_request_id = @Id", { Id: requestId, By: user.id });
      const m = await this.facts(conn, Number(r.memberId));
      await this.runErasure(conn, requestId, m, user.id, r.reason ?? "");
      return this.loadRequest(conn, requestId);
    });
  }

  async reject(user: { id: number; superAdmin: boolean }, requestId: number): Promise<PrivacyRequestDto> {
    return this.db.session(async (conn) => {
      await this.ready(conn);
      const r = await conn.queryFirstOrDefault<{ status: string; district: number | null }>(
        "SELECT status, fk_district_id AS district FROM privacy_requests WHERE pk_request_id = @Id", { Id: requestId },
      );
      if (!r) throw new PrivacyError(404, "Request not found.");
      if (r.status !== "awaiting_approval" && r.status !== "pending") throw new PrivacyError(400, "Only a waiting request can be rejected.");
      if (!user.superAdmin && !(await this.isDistrictAdmin(conn, user.id, r.district ? [Number(r.district)] : []))) throw new PrivacyError(403, "Only the district's admins can reject this request.");
      await conn.execute("UPDATE privacy_requests SET status = 'rejected', approved_by = @By, completed_at = @Now WHERE pk_request_id = @Id", { Id: requestId, By: user.id, Now: utcNow() });
      return this.loadRequest(conn, requestId);
    });
  }

  private tombstoneSalt(): string {
    const salt = this.config.get("Brand:Privacy:TombstoneSalt") || this.config.get("JwtSettings:Secret");
    if (!salt) throw new PrivacyError(400, "Brand:Privacy:TombstoneSalt must be configured.");
    return salt;
  }

  /** SHA-256(instance salt + Rotary id): what the sync compares against so an erased member is not recreated. */
  rotaryIdHash(rotaryId: string): string {
    return createHash("sha256").update(this.tombstoneSalt() + rotaryId.trim()).digest("hex");
  }

  private async runErasure(conn: DbSession, requestId: number, m: MemberFacts, byId: number, reason: string) {
    try {
      const schema = await this.schema(conn);
      const touched: string[] = [];
      await conn.transaction(async (tx) => {
        for (const entry of PERSONAL_DATA) {
          if (entry.onErase.action === "keep") continue;
          const where = this.whereFor(entry, schema, m);
          if (!where) continue;
          let n = 0;
          if (entry.onErase.action === "deleteRows") {
            n = await tx.execute(`DELETE FROM \`${entry.table}\` WHERE ${where.sql}`, where.params);
          } else {
            const cols = schema.get(entry.table)!;
            const sets = Object.entries(entry.onErase.set).filter(([c]) => cols.has(c.toLowerCase()));
            if (!sets.length) continue;
            const params: Record<string, unknown> = { ...where.params };
            const assignments = sets.map(([c, v], i) => {
              params[`V${i}`] = v;
              return `\`${c}\` = @V${i}`;
            });
            n = await tx.execute(`UPDATE \`${entry.table}\` SET ${assignments.join(", ")} WHERE ${where.sql}`, params);
          }
          if (n > 0) touched.push(`${entry.table}:${n}`);
        }
        if (m.rotaryId) {
          await tx.execute(
            `INSERT INTO member_erasure_tombstone (rotary_id_hash, fk_club_id, erased_at_utc, erased_by, reason)
             VALUES (@Hash, @Club, @Now, @By, @Reason)
             ON DUPLICATE KEY UPDATE erased_at_utc = VALUES(erased_at_utc), erased_by = VALUES(erased_by)`,
            { Hash: this.rotaryIdHash(m.rotaryId), Club: m.clubId, Now: utcNow(), By: byId, Reason: reason.slice(0, 500) },
          );
        }
        await tx.execute("UPDATE privacy_requests SET status = 'completed', completed_at = @Now WHERE pk_request_id = @Id", { Id: requestId, Now: utcNow() });
      });
      await this.deletePhotos(m.photoPaths);
      await this.audit(conn, byId, "PRIVACY_ERASE", m.id, `request ${requestId}; ${touched.join(", ")}`);
      this.log.log(`member ${m.id} erased (request ${requestId}): ${touched.join(", ")}`);
    } catch (e) {
      this.log.error(`erasure ${requestId} failed: ${(e as Error).message}`);
      await conn.execute("UPDATE privacy_requests SET status = 'failed', error = @Err WHERE pk_request_id = @Id", { Id: requestId, Err: (e as Error).message.slice(0, 500) });
    }
  }

  /** Profile and family photos, only inside the media root. */
  private async deletePhotos(paths: string[]) {
    const root = resolve(webRootPath(this.config));
    for (const p of paths) {
      const rel = p.replace(/^https?:\/\/[^/]+/i, "").replace(/^\/+/, "").replace(/^api\//i, "");
      const full = resolve(root, rel);
      if (!full.startsWith(root + sep)) continue;
      await rm(full, { force: true }).catch(() => undefined);
    }
  }

  // ── Registry plumbing ────────────────────────────────────────────────────────────────────

  /** Lower-cased column names of every table in the database. */
  private async schema(conn: DbCommands): Promise<Map<string, Set<string>>> {
    const rows = await conn.query<{ t: string; c: string }>(
      "SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()",
    );
    const map = new Map<string, Set<string>>();
    for (const r of rows) {
      const t = String(r.t);
      if (!map.has(t)) map.set(t, new Set());
      map.get(t)!.add(String(r.c).toLowerCase());
    }
    return map;
  }

  private whereFor(entry: PersonalTable, schema: Map<string, Set<string>>, m: MemberFacts): { sql: string; params: Record<string, unknown> } | null {
    const cols = schema.get(entry.table);
    if (!cols || !cols.has(entry.match.column.toLowerCase())) return null;
    const col = `\`${entry.match.column}\``;
    const values = valuesFor(entry.match, m);
    if (!values.length) return null;
    return values.length === 1 ? { sql: `${col} = @M0`, params: { M0: values[0] } } : { sql: `${col} IN @Ms`, params: { Ms: values } };
  }

  /** WS7-01 audit: personal-looking columns on tables the registry does not list. */
  async unlistedColumns(): Promise<{ table: string; columns: string[] }[]> {
    return this.db.session(async (conn) => {
      const schema = await this.schema(conn);
      const listed = new Set(PERSONAL_DATA.map((e) => e.table));
      const ignored = new Set(AUDIT_IGNORED_TABLES);
      const out: { table: string; columns: string[] }[] = [];
      for (const [table, cols] of schema) {
        if (listed.has(table) || ignored.has(table) || /^(bak_|tmp_|_tmp|temp$)/i.test(table) || /_20\d\d_\d\d$/.test(table)) continue;
        const hits = [...cols].filter((c) => PERSONAL_COLUMN_PATTERN.test(c) && !NOT_PERSONAL_COLUMN.test(c));
        if (hits.length) out.push({ table, columns: hits });
      }
      return out.sort((a, b) => a.table.localeCompare(b.table));
    });
  }

  // ── Retention (WS7-07) ───────────────────────────────────────────────────────────────────

  /** Deletes or blanks old rows by Brand:Privacy:RetentionDays. Returns what it did, for the log. */
  async applyRetention(): Promise<string[]> {
    const days = Brand.Current.privacy.retentionDays ?? {};
    const done: string[] = [];
    await this.db.session(async (conn) => {
      const schema = await this.schema(conn);
      const has = (t: string, c: string) => schema.get(t)?.has(c.toLowerCase()) ?? false;
      const run = async (label: string, table: string, dateCol: string, sql: string, d: number | undefined) => {
        if (!d || d <= 0 || !has(table, dateCol)) return;
        const n = await conn.execute(sql, { Cutoff: new Date(Date.now() - d * 86400_000).toISOString().slice(0, 19).replace("T", " ") });
        if (n > 0) done.push(`${label}: ${n}`);
      };
      await run("email_log bodies", "email_log", "sent_at", "UPDATE email_log SET body_html = NULL WHERE sent_at < @Cutoff AND body_html IS NOT NULL", days.email_log_body);
      await run("whatsapp_log", "whatsapp_log", "sent_at", "DELETE FROM whatsapp_log WHERE sent_at < @Cutoff", days.whatsapp_log);
      for (const t of ["announcement_push_log", "announcement_reminder_push_log", "event_push_log", "event_reminder_push_log", "document_push_log", "newsletter_push_log", "project_push_log"]) {
        await run(t, t, "created_date", `DELETE FROM \`${t}\` WHERE created_date < @Cutoff`, days.push_log);
      }
      await run("login_audit_logs", "login_audit_logs", "login_time", "DELETE FROM login_audit_logs WHERE login_time < @Cutoff", days.login_audit);
      for (const t of ["mobile_login_otp", "event_payment_otp", "password_reset_tokens", "web_sso_token"]) {
        await run(t, t, "created_date", `DELETE FROM \`${t}\` WHERE created_date < @Cutoff`, days.otp);
      }
      await run("assistant_turns", "assistant_turns", "created_date", "DELETE FROM assistant_turns WHERE created_date < @Cutoff", days.assistant_turns);
    });
    // Export files: delete after their link expired.
    const exportDays = days.export_files ?? EXPORT_DAYS;
    const dir = this.exportRoot();
    if (existsSync(dir)) {
      const { readdir, stat } = await import("node:fs/promises");
      let n = 0;
      for (const f of await readdir(dir)) {
        const s = await stat(join(dir, f)).catch(() => null);
        if (s && Date.now() - s.mtimeMs > exportDays * 86400_000) {
          await rm(join(dir, f), { force: true });
          n++;
        }
      }
      if (n) done.push(`export files: ${n}`);
    }
    return done;
  }
}

function valuesFor(match: Match, m: MemberFacts): string[] | number[] {
  switch (match.by) {
    case "memberId":
      return [m.id];
    case "email":
      return m.emails;
    case "mobile":
      return mobileVariants(m.mobiles);
    case "rotaryId":
      return m.rotaryId ? [m.rotaryId] : [];
  }
}

/** A number as stored, plus the digits-only form (logs keep "+44 7700 900123" and "447700900123" alike). */
function mobileVariants(mobiles: string[]): string[] {
  const out = new Set<string>();
  for (const v of mobiles) {
    out.add(v);
    const digits = v.replace(/\D/g, "");
    if (digits.length >= 6) {
      out.add(digits);
      out.add(`+${digits}`);
    }
  }
  return [...out];
}

function toCsv(rows: Record<string, unknown>[]): string {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    if (v == null) return "";
    const s = v instanceof Date ? iso(v) : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
}

export { ERASED_NAME };
