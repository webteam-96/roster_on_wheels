import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { ClubService, type SaveClub } from "./clubs.service";
import { Db } from "../../database/db.service";
import { AuditLogService } from "../../services/audit-log.service";
import { isClubDrillReachable } from "../../services/kill-switch.helper";
import { isCog } from "../../services/cog-designation.helper";
import { viewerMemberId } from "../../services/member-privacy.helper";
import { lowerExtension, type UploadedFile as Upload } from "../../services/media-storage";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, conflict, createdAt, noContent, notFound, ok, statusCode } from "../../common/results";
import { paramInt, queryInt, queryString, routeInt, requireFile } from "../../common/binding";
import { AddClubMemberDto, SaveClubDto, UpdateCogDesignationDto } from "../../dtos/club.dtos";

const MAX_UPLOAD = 55 * 1024 * 1024;
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
const INACTIVE_MEMBERS = "This club, its district, or its zone is inactive. Reactivate it first to access members.";

/** Port of ClubsController.cs: api/Clubs. */
@Controller("api/clubs")
@Authorize()
export class ClubsController {
  constructor(
    private readonly clubs: ClubService,
    private readonly audit: AuditLogService,
    private readonly db: Db,
  ) {}

  private roles = (u: CurrentUser) => u.findFirst("roles") ?? "";
  private isSuperAdmin = (u: CurrentUser) => this.roles(u).includes("SuperAdmin");
  /** Substring test as in the C#: "SuperAdmin" also contains "Admin". */
  private isSuperAdminOrAdmin = (u: CurrentUser) => this.roles(u).includes("SuperAdmin") || this.roles(u).includes("Admin");
  private memberId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);

  @Get()
  async getAll(
    @Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("search") search?: string, @Query("districtId") districtId?: string,
    @Query("city") city?: string, @Query("meetingDay") meetingDay?: string, @Query("isActive") isActive?: string, @Query("zoneId") zoneId?: string,
  ) {
    return ok(
      await this.clubs.getAll(queryInt(page, 1), queryInt(pageSize, 12), queryString(search), queryInt(districtId), queryString(city), queryString(meetingDay),
        queryInt(isActive), queryInt(zoneId)),
    );
  }

  @Get(":id")
  async getById(@Param("id") idText: string) {
    const club = await this.clubs.getById(paramInt(idText));
    if (!club) return notFound({ message: "Club not found" });
    return ok(club);
  }

  @Get(":id/members")
  async getMembers(
    @Param("id") idText: string, @User() user: CurrentUser,
    @Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("search") search?: string, @Query("year") year?: string,
    @Query("email") email?: string, @Query("rotaryId") rotaryId?: string, @Query("districtNumber") districtNumber?: string,
    @Query("designation") designation?: string, @Query("classification") classification?: string, @Query("familyMemberName") familyMemberName?: string,
  ) {
    const id = paramInt(idText);
    if (!(await this.clubs.getById(id))) return notFound({ message: "Club not found" });
    if (!(await isClubDrillReachable(this.db, id))) return statusCode(403, { message: INACTIVE_MEMBERS });
    return ok(
      await this.clubs.getMembers(id, queryInt(page, 1), queryInt(pageSize, 20), queryString(search), queryInt(year), queryString(email), queryString(rotaryId),
        queryString(districtNumber), queryString(designation), queryString(classification), queryString(familyMemberName), viewerMemberId(user)),
    );
  }

  @Get(":id/members/years")
  async getMemberYears(@Param("id") idText: string) {
    const id = paramInt(idText);
    if (!(await this.clubs.getById(id))) return notFound({ message: "Club not found" });
    if (!(await isClubDrillReachable(this.db, id))) return statusCode(403, { message: INACTIVE_MEMBERS });
    return ok(await this.clubs.getMemberDesignationYears(id));
  }

  @Get(":id/members/:memberId/cog-designation")
  async getCogDesignation(@Param("id") idText: string, @Param("memberId") memberIdText: string) {
    const id = paramInt(idText);
    const memberId = paramInt(memberIdText, "memberId");
    if (!isCog(id)) return ok({ districtNumber: null, yearLabel: null });
    return ok(await this.clubs.getCogDesignation(id, memberId));
  }

  @Put(":id/members/:memberId/cog-designation")
  async updateCogDesignation(@Param("id") idText: string, @Param("memberId") memberIdText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser, @Req() req: Request) {
    const id = paramInt(idText);
    const memberId = paramInt(memberIdText, "memberId");
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can change the COG district and year." });
    if (!isCog(id)) return badRequest({ message: "District/year is only maintained for the COG club." });
    const dto = UpdateCogDesignationDto.create(body ?? {}) as { districtNumber: string | null; yearLabel: string | null };
    const districtNumber = (dto.districtNumber ?? "").trim();
    const yearLabel = (dto.yearLabel ?? "").trim();
    if (!/^\d{3,5}$/.test(districtNumber)) return badRequest({ message: "District number must be 3-5 digits." });
    if (!/^\d{4}-\d{2}$/.test(yearLabel)) return badRequest({ message: "Year must be a Rotary year label such as 2025-26." });
    if (!(await this.clubs.updateCogDesignation(id, memberId, districtNumber, yearLabel, this.memberId(user)))) {
      return notFound({ message: "This member has no COG membership row." });
    }
    await this.audit.log(this.memberId(user), "UPDATE", "club_member_cog_designation", memberId, `${districtNumber} / ${yearLabel}`, { clubId: id, memberId, districtNumber, yearLabel }, req);
    return ok({ districtNumber, yearLabel });
  }

  @Get(":id/terminated-members")
  async getTerminatedMembers(@Param("id") idText: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("search") search?: string) {
    return ok(await this.clubs.getTerminatedMembers(paramInt(idText), queryInt(page, 1), queryInt(pageSize, 20), queryString(search)));
  }

  @Post()
  async create(@Body() body: Record<string, unknown>, @User() user: CurrentUser, @Req() req: Request) {
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can create clubs." });
    const dto = SaveClubDto.create(body ?? {}) as unknown as SaveClub;
    try {
      const id = await this.clubs.create(dto, this.memberId(user));
      await this.audit.log(this.memberId(user), "CREATE", "club", id, dto.clubName, body, req);
      return createdAt(`/api/Clubs/${id}`, { id });
    } catch (e) {
      return conflict({ message: (e as Error).message });
    }
  }

  @Put(":id")
  async update(@Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser, @Req() req: Request) {
    const id = paramInt(idText);
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can update clubs." });
    const dto = SaveClubDto.create(body ?? {}) as unknown as SaveClub;
    if (!(await this.clubs.getById(id))) return notFound({ message: "Club not found" });
    try {
      await this.clubs.update(id, dto, this.memberId(user));
      await this.audit.log(this.memberId(user), "UPDATE", "club", id, dto.clubName, body, req);
      return noContent();
    } catch (e) {
      return conflict({ message: (e as Error).message });
    }
  }

  @Delete(":id")
  async remove(@Param("id") idText: string, @User() user: CurrentUser, @Req() req: Request) {
    const id = paramInt(idText);
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can delete clubs." });
    const existing = await this.clubs.getById(id);
    if (!existing) return notFound({ message: "Club not found" });
    await this.clubs.delete(id, this.memberId(user));
    await this.audit.log(this.memberId(user), "DELETE", "club", id, existing.clubName as string, null, req);
    return noContent();
  }

  @Post(":id/members")
  async addMember(@Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const id = paramInt(idText);
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can add members to clubs." });
    if (!(await this.clubs.getById(id))) return notFound({ message: "Club not found" });
    const dto = AddClubMemberDto.create(body ?? {}) as { memberId: number; joinedDate: string | null };
    try {
      return ok({ id: await this.clubs.addMember(id, dto.memberId, dto.joinedDate, this.memberId(user)) });
    } catch (e) {
      return conflict({ message: (e as Error).message });
    }
  }

  @Delete(":id/members/:memberId")
  async removeMember(@Param("id") idText: string, @Param("memberId") memberIdText: string, @User() user: CurrentUser, @Query("reason") reason?: string) {
    const id = paramInt(idText);
    const memberId = paramInt(memberIdText, "memberId");
    if (!this.isSuperAdminOrAdmin(user)) return statusCode(403, { message: "Only SuperAdmin or Club Admin can remove members from clubs." });
    if (!(await this.clubs.getById(id))) return notFound({ message: "Club not found" });
    await this.clubs.removeMember(id, memberId, this.memberId(user), queryString(reason));
    return noContent();
  }

  @Get(":id/members/:memberId/removal-preview")
  async getRemovalPreview(@Param("id") idText: string, @Param("memberId") memberIdText: string, @User() user: CurrentUser) {
    const id = paramInt(idText);
    const memberId = paramInt(memberIdText, "memberId");
    if (!this.isSuperAdminOrAdmin(user)) return statusCode(403, { message: "Only SuperAdmin or Club Admin can preview member removal." });
    const preview = await this.clubs.getMemberRemovalPreview(id, memberId);
    if (!preview) return notFound({ message: "Member or club not found." });
    return ok(preview);
  }

  @Post("upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async upload(@UploadedFile() file: Upload | undefined, @User() user: CurrentUser) {
    requireFile(file);
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can upload club logos." });
    if (!file || file.size === 0) return badRequest({ message: "No file uploaded" });
    if (!IMAGE_EXTENSIONS.includes(lowerExtension(file.originalname))) return badRequest({ message: "Invalid file type. Allowed: jpg, jpeg, png, gif, webp" });
    if (file.size > 5 * 1024 * 1024) return badRequest({ message: "File size must be less than 5MB" });
    return ok({ path: await this.clubs.uploadLogo(file) });
  }

  @Get(":id/logos")
  async getLogos(@Param("id") idText: string) {
    const id = routeInt(idText);
    const { clubLogo, rotaryLogo } = await this.clubs.getLogos(id);
    return ok({ clubLogoUrl: buildClubLogoUrl(clubLogo), rotaryLogoUrl: buildRotaryLogoUrl(id, rotaryLogo) });
  }

  @Put(":id/logos")
  async setLogos(@Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const id = routeInt(idText);
    if (!this.isSuperAdminOrAdmin(user)) return statusCode(403, { message: "Access denied." });
    const lower = new Map(Object.entries(body ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    await this.clubs.setLogos(id, (lower.get("clublogopath") as string | undefined) ?? null, (lower.get("rotarylogopath") as string | undefined) ?? null, this.memberId(user));
    return ok({ message: "Logos saved." });
  }

  @Post(":id/upload-club-logo")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadClubLogo(@Param("id") idText: string, @UploadedFile() file: Upload | undefined, @User() user: CurrentUser) {
    requireFile(file);
    routeInt(idText);
    if (!this.isSuperAdminOrAdmin(user)) return statusCode(403, { message: "Access denied." });
    const err = validateImage(file);
    if (err) return badRequest({ message: err });
    return ok({ path: await this.clubs.uploadClubLogoToGroup(file!) });
  }

  @Post(":id/upload-rotary-logo")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadRotaryLogo(@Param("id") idText: string, @UploadedFile() file: Upload | undefined, @User() user: CurrentUser) {
    requireFile(file);
    const id = routeInt(idText);
    if (!this.isSuperAdminOrAdmin(user)) return statusCode(403, { message: "Access denied." });
    const err = validateImage(file);
    if (err) return badRequest({ message: err });
    return ok({ path: await this.clubs.uploadRotaryLogoToGroup(id, file!) });
  }
}

function validateImage(file: Upload | undefined): string | null {
  if (!file || file.size === 0) return "No file uploaded";
  if (!IMAGE_EXTENSIONS.includes(lowerExtension(file.originalname))) return "Invalid file type. Allowed: jpg, jpeg, png, gif, webp";
  if (file.size > 5 * 1024 * 1024) return "File size must be less than 5 MB";
  return null;
}

function buildClubLogoUrl(stored: string | null): string | null {
  if (!stored || !stored.trim()) return null;
  if (/^http/i.test(stored) || stored.startsWith("/")) return stored;
  return "/Documents/group/" + stored;
}

function buildRotaryLogoUrl(clubId: number, stored: string | null): string | null {
  if (!stored || !stored.trim()) return null;
  if (/^http/i.test(stored) || stored.startsWith("/")) return stored;
  return `/Documents/WebsiteData/Group${clubId}/LOGO/` + stored;
}
