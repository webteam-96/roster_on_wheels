import { Body, Controller, Get, Param, Patch, Post, Req, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { randomBytes } from "node:crypto";
import { AllowAnonymous, Authorize, User, ReadsRequestForm } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField, paramInt, routeInt } from "../../common/binding";
import { badRequest, forbid, notFound, ok, statusCode, unauthorized } from "../../common/results";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { Db, type DbCommands } from "../../database/db.service";
import { CreditManagementService } from "../../services/credit-management.service";
import { CLUB_BLOCKED_MESSAGE, DISTRICT_BLOCKED_MESSAGE, isClubDrillReachable, isDistrictDrillReachable } from "../../services/kill-switch.helper";
import { lowerExtension, saveWithGuidName, type UploadedFile as Upload } from "../../services/media-storage";
import { AuthService } from "../auth/auth.service";

/** Port of MassEmailMediaController.cs: hosts mass-email editor images and returns their absolute URL. */
@Controller("api/mass-email")
@Authorize()
export class MassEmailMediaController {
  constructor(private readonly config: AppConfig) {}

  @Post("image")
  @ReadsRequestForm()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 15 * 1024 * 1024 } }))
  async uploadImage(@Req() req: Request, @UploadedFile() file?: Upload) {
    if (!file || !file.size) return badRequest({ message: "No image supplied." });
    if (![".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(lowerExtension(file.originalname))) return badRequest({ message: "Only JPG, PNG, GIF or WEBP images are allowed." });
    const fileName = await saveWithGuidName(this.config, file, "uploads", "mass-email");
    // The URL of the server that stored it (X-Forwarded-* honoured), so mail clients can load it.
    const scheme = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() || req.protocol;
    const host = String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim() || req.get("host") || "";
    return ok({ url: `${scheme}://${host}${req.baseUrl ?? ""}/uploads/mass-email/${fileName}` });
  }
}

/** Port of WhatsAppInfoController.cs: recipient counts and remaining credits beside the send toggles. */
@Controller("api/whatsapp-info")
@Authorize()
export class WhatsAppInfoController {
  constructor(private readonly db: Db, private readonly credits: CreditManagementService) {}

  @Get("club/:clubId")
  async club(@Param("clubId") c: string) {
    const clubId = paramInt(c, "clubId");
    if (!(await isClubDrillReachable(this.db, clubId))) return statusCode(403, { message: CLUB_BLOCKED_MESSAGE });
    const base = `FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                  WHERE cm.fk_club_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0`;
    const wa = Number(await this.db.executeScalar(`SELECT COUNT(DISTINCT m.pk_member_master_profile_id) ${base} AND m.PrimaryMobileNumber IS NOT NULL AND m.PrimaryMobileNumber <> ''`, { Id: clubId }));
    const em = Number(await this.db.executeScalar(`SELECT COUNT(DISTINCT m.pk_member_master_profile_id) ${base} AND m.EmailId IS NOT NULL AND m.EmailId <> ''`, { Id: clubId }));
    const b = await this.credits.getClubCreditBalance(clubId);
    return ok({ recipientCount: wa, whatsAppRemaining: b.whatsAppRemaining, emailRecipientCount: em, emailRemaining: b.emailRemaining });
  }

  @Get("district/:districtId")
  async district(@Param("districtId") d: string) {
    const districtId = paramInt(d, "districtId");
    if (!(await isDistrictDrillReachable(this.db, districtId))) return statusCode(403, { message: DISTRICT_BLOCKED_MESSAGE });
    const counts = await this.db.queryFirstOrDefault(
      `SELECT COUNT(DISTINCT CASE WHEN m.PrimaryMobileNumber IS NOT NULL AND m.PrimaryMobileNumber <> '' THEN m.pk_member_master_profile_id END) AS WhatsAppCount,
              COUNT(DISTINCT CASE WHEN m.EmailId IS NOT NULL AND m.EmailId <> '' THEN m.pk_member_master_profile_id END) AS EmailCount
       FROM club_members cm
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id
       JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
       WHERE c.fk_district_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND c.isdeleted = 0 AND m.isdeleted = 0`,
      { Id: districtId },
    );
    const b = await this.credits.getDistrictCreditBalance(districtId);
    return ok({ recipientCount: Number(counts?.WhatsAppCount ?? 0), whatsAppRemaining: b.whatsAppRemaining, emailRecipientCount: Number(counts?.EmailCount ?? 0), emailRemaining: b.emailRemaining });
  }
}

const MEMBERSHIP_NOT_FOUND = { message: "Active club membership not found for that (club, member)." };

/** Port of ClubMemberHonoraryController.cs: per-club honorary flag (read: anyone signed in; write: SuperAdmin). */
@Controller("api/clubs/:clubId/members/:memberId")
@Authorize()
export class ClubMemberHonoraryController {
  constructor(private readonly db: Db) {}

  @Get("honorary-status")
  async get(@Param("clubId") c: string, @Param("memberId") m: string) {
    const [clubId, memberId] = [routeInt(c), routeInt(m)];
    const v = await this.db.executeScalar(
      "SELECT CAST(IsHonoraryMember AS UNSIGNED) FROM club_members WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId AND COALESCE(isdeleted, 0) = 0 LIMIT 1",
      { ClubId: clubId, MemberId: memberId },
    );
    if (v === null || v === undefined) return notFound(MEMBERSHIP_NOT_FOUND);
    return ok({ clubId, memberId, isHonorary: Number(v) === 1 });
  }

  @Patch("honorary-status")
  async set(@User() u: CurrentUser, @Param("clubId") c: string, @Param("memberId") m: string, @Body() body: unknown) {
    const [clubId, memberId] = [routeInt(c), routeInt(m)];
    if (!(u.findFirst("roles") ?? "").toLowerCase().includes("superadmin")) return forbid();
    if (!body || typeof body !== "object") return badRequest({ message: "Body required." });
    const isHonorary = bodyField(body, "isHonorary") === true;
    const rows = await this.db.execute(
      "UPDATE club_members SET IsHonoraryMember = @IsHon, modified_date = NOW() WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId AND COALESCE(isdeleted, 0) = 0",
      { ClubId: clubId, MemberId: memberId, IsHon: isHonorary ? 1 : 0 },
    );
    if (rows === 0) return notFound(MEMBERSHIP_NOT_FOUND);
    return ok({ clubId, memberId, isHonorary, message: isHonorary ? "Marked as Honorary." : "Unmarked Honorary." });
  }
}

const ensureSsoTable = (conn: DbCommands) => conn.execute(`
  CREATE TABLE IF NOT EXISTS web_sso_token (
      pk_id INT AUTO_INCREMENT PRIMARY KEY,
      token VARCHAR(80) NOT NULL,
      fk_member_id INT NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_date DATETIME NOT NULL,
      UNIQUE KEY uq_web_sso_token (token)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

/** Port of WebSsoController.cs: one-time (2-minute, single-use) token from the app to a web session. */
@Controller()
export class WebSsoController {
  constructor(private readonly db: Db, private readonly config: AppConfig, private readonly auth: AuthService) {}

  @Post("api/mobile/auth/web-sso-token")
  @Authorize()
  async issue(@User() u: CurrentUser) {
    const v = u.findFirst("memberId") ?? "";
    const memberId = /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0;
    if (memberId <= 0) return unauthorized();
    // Only members with a web role get a web session.
    if (!(await this.auth.buildSessionForMember(memberId))) return statusCode(403, { message: "This member has no web portal access." });
    const token = randomBytes(32).toString("hex").toUpperCase();
    await this.db.session(async (conn) => {
      await ensureSsoTable(conn);
      await conn.execute("INSERT INTO web_sso_token (token, fk_member_id, expires_at, created_date) VALUES (@Token, @Mem, DATE_ADD(NOW(), INTERVAL 2 MINUTE), NOW())", { Token: token, Mem: memberId });
    });
    const frontend = (this.config.get("FrontendUrl") ?? Brand.Current.domains.adminOrigin).replace(/\/+$/, "");
    return ok({ token, url: `${frontend}/sso?token=${token}` });
  }

  @Post("api/auth/sso-exchange")
  @AllowAnonymous()
  async exchange(@Body() body: unknown) {
    const t = bodyField(body, "token");
    const token = t === null || t === undefined ? "" : String(t);
    if (!token.trim()) return badRequest({ message: "token required" });
    const memberId = await this.db.session(async (conn) => {
      await ensureSsoTable(conn);
      // Consume atomically, on DB time only.
      const consumed = await conn.execute("UPDATE web_sso_token SET used_at = NOW() WHERE token = @T AND used_at IS NULL AND expires_at >= NOW()", { T: token });
      return consumed === 0 ? null : Number(await conn.executeScalar("SELECT fk_member_id FROM web_sso_token WHERE token = @T", { T: token }));
    });
    if (memberId === null) return unauthorized({ message: "This sign-in link is invalid, already used, or expired." });
    const session = await this.auth.buildSessionForMember(memberId);
    return session ? ok(session) : statusCode(403, { message: "This member has no web portal access." });
  }
}
