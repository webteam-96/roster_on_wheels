import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { MemberService } from "./members.service";
import { Db } from "../../database/db.service";
import { AuditLogService } from "../../services/audit-log.service";
import { User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, conflict, createdAt, noContent, notFound, ok, statusCode } from "../../common/results";
import { InvalidOperationException } from "../../common/exceptions";
import { paramInt, queryInt, queryString } from "../../common/binding";
import { lowerExtension, type UploadedFile as Upload } from "../../services/media-storage";
import { flagsFor, getClubPeerMemberIds, getPrivacyFlags, shouldShowEmail, shouldShowPhone, viewerMemberId } from "../../services/member-privacy.helper";
import {
  DIRECTORY_MEMBER_LOCKED_FIELDS, MOBILE_SELF_EDIT_LOCKED_FIELDS, canCrudDirectoryMember, canPartialEditDirectoryMember, isMobileLogin,
} from "../../services/user-permission.helper";
import { stripCountryCode } from "../../services/phone-number.normalizer";
import { SaveMemberDto, type SaveMember } from "../../dtos/member.dtos";

const MAX_UPLOAD = 55 * 1024 * 1024;

/**
 * Port of MembersController.cs: api/Members. As in RIZones the controller has
 * no [Authorize]; see ROW-CHANGES.md.
 */
@Controller("api/members")
export class MembersController {
  constructor(
    private readonly members: MemberService,
    private readonly audit: AuditLogService,
    private readonly db: Db,
  ) {}

  private memberId = (u: CurrentUser) => u.intClaim("memberId") ?? 0;

  /** App users sometimes type "+44 ..." into the number: keep the national part. */
  private async stripMobileCountryCodes(user: CurrentUser, dto: SaveMember) {
    if (!isMobileLogin(user)) return;
    const hasCode = (v: string | null) => !!v && v.trimStart().startsWith("+");
    if (!hasCode(dto.primaryMobileNumber) && !hasCode(dto.secondaryMobileNumber)) return;
    const ids = [...new Set([dto.fkPrimaryCountryId ?? 0, dto.fkSecondaryCountryId ?? 0])];
    const codes = new Map(
      (await this.db.query("SELECT pk_country_id AS Id, PhoneCode FROM country_master WHERE pk_country_id IN @Ids", { Ids: ids })).map((r) => [Number(r.Id), r.PhoneCode as string | null]),
    );
    const primaryCode = codes.get(dto.fkPrimaryCountryId ?? 0) ?? null;
    const secondaryCode = codes.get(dto.fkSecondaryCountryId ?? 0) ?? primaryCode;
    dto.primaryMobileNumber = stripCountryCode(dto.primaryMobileNumber, primaryCode) ?? null;
    dto.secondaryMobileNumber = stripCountryCode(dto.secondaryMobileNumber, secondaryCode) ?? null;
  }

  /** SuperAdmin and Admins see every contact; others see what each member's privacy flags allow. */
  private async applyContactPrivacy(user: CurrentUser, rows: Record<string, unknown>[]) {
    if (!rows.length || canCrudDirectoryMember(user) || canPartialEditDirectoryMember(user)) return;
    const viewer = viewerMemberId(user);
    const peers = await getClubPeerMemberIds(this.db, viewer);
    const flags = await getPrivacyFlags(this.db, rows.map((r) => Number(r.id)));
    for (const row of rows) {
      const id = Number(row.id);
      const f = flagsFor(flags, id);
      const shares = peers.has(id);
      if (!shouldShowPhone(viewer, id, shares, f.showPhoneInMyClub, f.showPhoneInAllClubs)) row.primaryMobileNumber = null;
      if (!shouldShowEmail(viewer, id, shares, f.showEmailInMyClub, f.showEmailInAllClubs)) row.emailId = null;
    }
  }

  @Get()
  async getAll(
    @User() user: CurrentUser, @Query("page") page?: string, @Query("pageSize") pageSize?: string,
    @Query("search") search?: string, @Query("bloodGroup") bloodGroup?: string, @Query("gender") gender?: string,
  ) {
    const result = await this.members.getAll(queryInt(page, 1), queryInt(pageSize, 10), queryString(search), queryString(bloodGroup), queryString(gender));
    await this.applyContactPrivacy(user, result.items);
    return ok(result);
  }

  @Get(":id")
  async getById(@Param("id") idText: string, @User() user: CurrentUser, @Query("clubId") clubId?: string) {
    const member = await this.members.getById(paramInt(idText), queryInt(clubId));
    if (!member) return notFound({ message: "Member not found" });
    await this.applyContactPrivacy(user, [member]);
    return ok(member);
  }

  @Get(":id/device-token")
  async getDeviceToken(@Param("id") idText: string) {
    const id = paramInt(idText);
    return this.db.session(async (conn) => {
      if (!Number(await conn.executeScalar("SELECT COUNT(*) FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND IFNULL(isdeleted, 0) = 0", { Id: id }))) {
        return notFound({ message: "Member not found" });
      }
      const token = await conn.executeScalar<string>("SELECT LastDeviceToken FROM member_master_profile WHERE pk_member_master_profile_id = @Id", { Id: id });
      return ok({ memberId: id, deviceToken: token });
    });
  }

  @Post(":id/device-token")
  async setDeviceToken(@Param("id") idText: string, @Body() body: Record<string, unknown> | null) {
    const id = paramInt(idText);
    const token = Object.entries(body ?? {}).find(([k]) => k.toLowerCase() === "devicetoken")?.[1];
    return this.db.session(async (conn) => {
      if (!Number(await conn.executeScalar("SELECT COUNT(*) FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND IFNULL(isdeleted, 0) = 0", { Id: id }))) {
        return notFound({ message: "Member not found" });
      }
      await conn.execute(
        `UPDATE member_master_profile
         SET LastDeviceToken = COALESCE(NULLIF(TRIM(@Token), ''), LastDeviceToken)
         WHERE pk_member_master_profile_id = @Id`,
        { Id: id, Token: typeof token === "string" ? token : null },
      );
      const stored = await conn.executeScalar<string>("SELECT LastDeviceToken FROM member_master_profile WHERE pk_member_master_profile_id = @Id", { Id: id });
      return ok({ memberId: id, deviceToken: stored });
    });
  }

  @Post()
  async create(@Body() body: Record<string, unknown>, @User() user: CurrentUser, @Req() req: Request) {
    if (!canCrudDirectoryMember(user)) return statusCode(403, { message: "Only SuperAdmin can add members to the directory." });
    const dto = SaveMemberDto.create(body ?? {}) as unknown as SaveMember;
    await this.stripMobileCountryCodes(user, dto);
    try {
      const id = await this.members.create(dto);
      await this.audit.log(this.memberId(user), "CREATE", "member", id, dto.memberName, body, req);
      return createdAt(`/api/Members/${id}`, { id });
    } catch (e) {
      if (e instanceof InvalidOperationException) return conflict({ message: e.message });
      throw e;
    }
  }

  @Put(":id")
  async update(@Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser, @Req() req: Request) {
    const id = paramInt(idText);
    const currentMemberId = this.memberId(user);
    const isSelf = id === currentMemberId;
    const isSA = canCrudDirectoryMember(user);
    const isAdminPartial = canPartialEditDirectoryMember(user);
    if (!isSA && !isSelf && !isAdminPartial) return statusCode(403, { message: "You do not have permission to edit directory members." });

    const existing = await this.members.getById(id);
    if (!existing) return notFound({ message: "Member not found" });
    const dto = SaveMemberDto.create(body ?? {}) as unknown as SaveMember;
    await this.stripMobileCountryCodes(user, dto);
    const ex = existing as Record<string, unknown>;
    const d = dto as unknown as Record<string, unknown>;

    // An Admin editing someone else cannot change the locked fields.
    if (isAdminPartial && !isSA && !isSelf) {
      for (const field of DIRECTORY_MEMBER_LOCKED_FIELDS) {
        if (field === "primaryLanguage") {
          if (ex.primaryLanguage) d.primaryLanguage = ex.primaryLanguage;
        } else {
          d[field] = ex[field];
        }
      }
    }

    const dupMessage = async (column: "PrimaryMobileNumber" | "EmailId", value: string, what: string) => {
      const other = await this.db.queryFirstOrDefault(
        `SELECT m.pk_member_master_profile_id AS Id, m.MemberName, c.ClubName
         FROM member_master_profile m
         INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                                   AND cm.IsActive = 1 AND cm.isdeleted = 0
         LEFT JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
         WHERE m.${column} = @Value AND m.isdeleted = 0
           AND m.pk_member_master_profile_id <> @SelfId
         LIMIT 1`,
        { Value: value, SelfId: id },
      );
      return other ? `This ${what} is already used by ${other.MemberName}${other.ClubName ? ` in ${other.ClubName}` : ""}. Please use a different ${what}.` : null;
    };
    const mobileChanged = !!dto.primaryMobileNumber && dto.primaryMobileNumber.trim() !== "" && dto.primaryMobileNumber !== ex.primaryMobileNumber;
    if (mobileChanged) {
      const msg = await dupMessage("PrimaryMobileNumber", dto.primaryMobileNumber!, "mobile number");
      if (msg) return conflict({ message: msg });
    }
    if (dto.emailId && dto.emailId.trim() && dto.emailId.toLowerCase() !== String(ex.emailId ?? "").toLowerCase()) {
      const msg = await dupMessage("EmailId", dto.emailId, "email");
      if (msg) return conflict({ message: msg });
    }
    if (mobileChanged) {
      // A changed login number signs the member out of the app.
      await this.db.execute("UPDATE member_master_profile SET mobile_force_relogin_at = UTC_TIMESTAMP() WHERE pk_member_master_profile_id = @Id", { Id: id });
    }

    if (isSelf && isMobileLogin(user)) {
      for (const field of MOBILE_SELF_EDIT_LOCKED_FIELDS) d[field] = ex[field];
    }

    try {
      await this.members.update(id, dto);
      await this.audit.log(this.memberId(user), "UPDATE", "member", id, dto.memberName, body, req);
      return noContent();
    } catch (e) {
      if (e instanceof InvalidOperationException) return conflict({ message: e.message });
      throw e;
    }
  }

  @Delete(":id")
  async remove(@Param("id") idText: string, @User() user: CurrentUser, @Req() req: Request) {
    const id = paramInt(idText);
    if (!canCrudDirectoryMember(user)) return statusCode(403, { message: "Only SuperAdmin can delete directory members." });
    const existing = await this.members.getById(id);
    if (!existing) return notFound({ message: "Member not found" });
    await this.members.delete(id);
    await this.audit.log(this.memberId(user), "DELETE", "member", id, existing.memberName as string, null, req);
    return noContent();
  }

  @Post("upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async upload(@UploadedFile() file: Upload | undefined, @Query("type") typeText?: string) {
    const type = (typeText ?? "profile").toLowerCase();
    if (!file || file.size === 0) return badRequest({ message: "No file uploaded" });
    if (!["profile", "family", "familymember"].includes(type)) return badRequest({ message: "Invalid upload type. Use: profile, family, or familymember" });
    if (![".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(lowerExtension(file.originalname))) return badRequest({ message: "Invalid file type. Allowed: jpg, jpeg, png, gif, webp" });
    if (file.size > 5 * 1024 * 1024) return badRequest({ message: "File size must be less than 5MB" });
    return ok({ path: await this.members.uploadPhoto(file, type) });
  }
}
