import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import { ClubGroupsService, SaveAttendanceDto, SaveWeblinkDto, type SaveAttendance, type SaveWeblink } from "./club-groups.service";
import { Db } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { ValidationProblemResult, badRequest, notFound, ok, statusCode } from "../../common/results";
import { InvalidOperationException, KeyNotFoundException } from "../../common/exceptions";
import { bodyField, bodyIntList, paramInt, queryInt, queryString } from "../../common/binding";
import { CLUB_BLOCKED_MESSAGE, isClubDrillReachable } from "../../services/kill-switch.helper";
import { lowerExtension, type UploadedFile } from "../../services/media-storage";

const MAX_UPLOAD = 55 * 1024 * 1024;
type Files = { logo?: UploadedFile; banner?: UploadedFile; pdf?: UploadedFile };

/** IFormFile? logo / banner / pdf from a multipart form. */
export function weblinkFiles(files: UploadedFile[] | undefined): Files {
  const pick = (name: string) => (files ?? []).find((f) => (f as UploadedFile & { fieldname?: string }).fieldname?.toLowerCase() === name);
  return { logo: pick("logo"), banner: pick("banner"), pdf: pick("pdf") };
}

/** The weblink upload checks shared by create and update; null when all pass. */
export function checkWeblinkFiles(f: Files) {
  if (f.logo) {
    if (f.logo.size > 5 * 1024 * 1024) return badRequest({ message: "Logo file size must be less than 5MB." });
    if (!(f.logo.mimetype ?? "").startsWith("image/")) return badRequest({ message: "Logo must be an image file." });
  }
  if (f.banner) {
    if (f.banner.size > 5 * 1024 * 1024) return badRequest({ message: "Banner file size must be less than 5MB." });
    if (!(f.banner.mimetype ?? "").startsWith("image/")) return badRequest({ message: "Banner must be an image file." });
  }
  if (f.pdf) {
    if (f.pdf.size > 10 * 1024 * 1024) return badRequest({ message: "PDF file size must be less than 10MB." });
    if (lowerExtension(f.pdf.originalname) !== ".pdf") return badRequest({ message: "Only .pdf files are allowed." });
  }
  return null;
}

/** [Required, StringLength] on Create/UpdateAttendanceDto. */
function validateAttendance(dto: SaveAttendance): ValidationProblemResult | null {
  const errors: Record<string, string[]> = {};
  if (!dto.eventName || !dto.eventName.trim()) errors.EventName = ["The EventName field is required."];
  else if (dto.eventName.length > 500) errors.EventName = ["Event Name must be 500 characters or less."];
  if (dto.description && dto.description.length > 10000) errors.Description = ["Description must be 10000 characters or less."];
  return Object.keys(errors).length ? new ValidationProblemResult(errors) : null;
}

/** Ports of SubGroupsController.cs, WeblinksController.cs and AttendanceController.cs (club scope). */
@Controller("api/clubs/:clubId")
@Authorize()
export class ClubGroupsController {
  constructor(
    private readonly groups: ClubGroupsService,
    private readonly db: Db,
  ) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);
  private async blocked(clubId: number) {
    return !(await isClubDrillReachable(this.db, clubId)) ? statusCode(403, { message: CLUB_BLOCKED_MESSAGE }) : null;
  }

  // ---- sub-groups ----

  @Get("sub-groups")
  async getSubGroups(@Param("clubId") clubText: string, @Query("yearId") yearId?: string) {
    const clubId = paramInt(clubText, "clubId");
    const y = queryInt(yearId, 0);
    return (await this.blocked(clubId)) ?? ok(await this.groups.getSubGroups(clubId, y));
  }

  @Get("sub-groups/club-members")
  async getSubGroupMembers(@Param("clubId") clubText: string) {
    const clubId = paramInt(clubText, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.groups.getSubGroupClubMembers(clubId));
  }

  @Get("sub-groups/available-years")
  async getSubGroupYears(@Param("clubId") clubText: string) {
    const clubId = paramInt(clubText, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.groups.getSubGroupYears(clubId, null));
  }

  @Get("sub-groups/:subGroupId")
  async getSubGroup(@Param("clubId") clubText: string, @Param("subGroupId") idText: string) {
    const clubId = paramInt(clubText, "clubId");
    const id = paramInt(idText, "subGroupId");
    const block = await this.blocked(clubId);
    if (block) return block;
    try {
      return ok(await this.groups.getSubGroupDetail(id));
    } catch (e) {
      if (e instanceof KeyNotFoundException) return notFound({ message: e.message });
      throw e;
    }
  }

  @Post("sub-groups")
  async createSubGroup(@Param("clubId") clubText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    const yearId = Math.trunc(Number(bodyField(body, "yearId") ?? 0)) || 0;
    return ok(await this.groups.createSubGroup(clubId, yearId, String(bodyField(body, "groupName") ?? ""), bodyIntList(body, "memberIds"), this.userId(user)));
  }

  @Put("sub-groups/:subGroupId")
  async updateSubGroup(@Param("clubId") clubText: string, @Param("subGroupId") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    paramInt(clubText, "clubId");
    const yearId = Math.trunc(Number(bodyField(body, "yearId") ?? 0)) || 0;
    return ok(await this.groups.updateSubGroup(paramInt(idText, "subGroupId"), yearId, String(bodyField(body, "groupName") ?? ""), bodyIntList(body, "memberIds"), this.userId(user)));
  }

  @Delete("sub-groups/:subGroupId")
  async deleteSubGroup(@Param("clubId") clubText: string, @Param("subGroupId") idText: string, @User() user: CurrentUser) {
    paramInt(clubText, "clubId");
    await this.groups.deleteSubGroup(paramInt(idText, "subGroupId"), this.userId(user));
    return ok({ message: "Sub group deleted successfully." });
  }

  // ---- weblinks ----

  @Get("weblinks")
  async getWeblinks(@Param("clubId") clubText: string, @Query("parentId") parentId?: string) {
    const clubId = paramInt(clubText, "clubId");
    const p = queryInt(parentId);
    return (await this.blocked(clubId)) ?? ok(await this.groups.getWeblinks(clubId, p));
  }

  @Get("weblinks/tree")
  async getWeblinkTree(@Param("clubId") clubText: string) {
    const clubId = paramInt(clubText, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.groups.getWeblinkTree(clubId));
  }

  @Post("weblinks")
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_UPLOAD } }))
  async createWeblink(@Param("clubId") clubText: string, @Body() body: Record<string, unknown>, @UploadedFiles() files: UploadedFile[] | undefined, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    const f = weblinkFiles(files);
    const bad = checkWeblinkFiles(f);
    if (bad) return bad;
    try {
      return ok(await this.groups.createWeblink(clubId, SaveWeblinkDto.create(body ?? {}) as unknown as SaveWeblink, f, this.userId(user)));
    } catch (e) {
      if (e instanceof KeyNotFoundException) return notFound({ message: e.message });
      if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
      throw e;
    }
  }

  @Put("weblinks/:weblinkId")
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_UPLOAD } }))
  async updateWeblink(
    @Param("clubId") clubText: string, @Param("weblinkId") idText: string, @Body() body: Record<string, unknown>,
    @UploadedFiles() files: UploadedFile[] | undefined, @User() user: CurrentUser,
  ) {
    const clubId = paramInt(clubText, "clubId");
    const id = paramInt(idText, "weblinkId");
    const f = weblinkFiles(files);
    const bad = checkWeblinkFiles(f);
    if (bad) return bad;
    try {
      return ok(await this.groups.updateWeblink(clubId, id, SaveWeblinkDto.create(body ?? {}) as unknown as SaveWeblink, f, this.userId(user)));
    } catch (e) {
      if (e instanceof KeyNotFoundException) return notFound({ message: e.message });
      if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
      throw e;
    }
  }

  @Delete("weblinks/:weblinkId")
  async deleteWeblink(@Param("clubId") clubText: string, @Param("weblinkId") idText: string, @User() user: CurrentUser) {
    paramInt(clubText, "clubId");
    await this.groups.deleteWeblink(paramInt(idText, "weblinkId"), this.userId(user));
    return ok({ message: "Weblink deleted successfully." });
  }

  @Put("weblinks/:weblinkId/toggle-active")
  async toggleWeblink(@Param("clubId") clubText: string, @Param("weblinkId") idText: string, @User() user: CurrentUser) {
    paramInt(clubText, "clubId");
    await this.groups.toggleWeblinkActive(paramInt(idText, "weblinkId"), this.userId(user));
    return ok({ message: "Weblink status toggled successfully." });
  }

  // ---- attendance ----

  @Get("attendance")
  async getAttendance(
    @Param("clubId") clubText: string, @Query("yearId") yearId?: string, @Query("search") search?: string,
    @Query("page") page?: string, @Query("pageSize") pageSize?: string,
  ) {
    const clubId = paramInt(clubText, "clubId");
    const y = queryInt(yearId, 0);
    const p = queryInt(page, 1);
    const ps = queryInt(pageSize, 10);
    return (await this.blocked(clubId)) ?? ok(await this.groups.getAttendance(clubId, y, queryString(search, "")!, p, ps));
  }

  @Get("attendance/years")
  async getAttendanceYears(@Param("clubId") clubText: string) {
    const clubId = paramInt(clubText, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.groups.getAttendanceYears(clubId));
  }

  @Get("attendance/members")
  async getAttendanceMembers(@Param("clubId") clubText: string) {
    const clubId = paramInt(clubText, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.groups.getAttendanceMembers(clubId));
  }

  @Get("attendance/:id")
  async getAttendanceById(@Param("clubId") clubText: string, @Param("id") idText: string) {
    const clubId = paramInt(clubText, "clubId");
    const id = paramInt(idText);
    const block = await this.blocked(clubId);
    if (block) return block;
    const r = await this.groups.getAttendanceById(id);
    return r ? ok(r) : notFound({ message: "Attendance record not found." });
  }

  @Post("attendance")
  async createAttendance(@Param("clubId") clubText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    const dto = SaveAttendanceDto.create(body ?? {}) as unknown as SaveAttendance;
    const invalid = validateAttendance(dto);
    if (invalid) return invalid;
    return ok({ id: await this.groups.createAttendance(clubId, dto, this.userId(user)) });
  }

  @Put("attendance/:id")
  async updateAttendance(@Param("clubId") clubText: string, @Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    paramInt(clubText, "clubId");
    const id = paramInt(idText);
    const dto = SaveAttendanceDto.create(body ?? {}) as unknown as SaveAttendance;
    const invalid = validateAttendance(dto);
    if (invalid) return invalid;
    await this.groups.updateAttendance(id, dto, this.userId(user));
    return ok({ message: "Attendance updated successfully." });
  }

  @Delete("attendance/:id")
  async deleteAttendance(@Param("clubId") clubText: string, @Param("id") idText: string, @User() user: CurrentUser) {
    paramInt(clubText, "clubId");
    await this.groups.deleteAttendance(paramInt(idText), this.userId(user));
    return ok({ message: "Attendance deleted successfully." });
  }
}
