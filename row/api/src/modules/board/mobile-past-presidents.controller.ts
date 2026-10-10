import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import { PastPresidentService, SavePastPresidentDto, type SavePastPresident } from "./past-president.service";
import { Db } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, notFound, ok, statusCode } from "../../common/results";
import { InvalidOperationException } from "../../common/exceptions";
import { paramInt, queryInt, queryString } from "../../common/binding";
import { CLUB_BLOCKED_MESSAGE, isClubDrillReachable } from "../../services/kill-switch.helper";
import type { UploadedFile } from "../../services/media-storage";

const MAX_UPLOAD = 55 * 1024 * 1024;
const DENIED = statusCode(403, { message: "Access denied." });
const photoOf = (files: UploadedFile[] | undefined) => (files ?? []).find((f) => (f as UploadedFile & { fieldname?: string }).fieldname?.toLowerCase() === "photo");

/**
 * Port of MobileClubAdminPastPresidentsController.cs. SuperAdmin acts on any club (?clubId=);
 * a Club Admin is pinned to the clubId in their token whatever the query says.
 */
@Controller("api/mobile/club-admin/past-presidents")
@Authorize()
export class MobileClubAdminPastPresidentsController {
  constructor(private readonly pastPresidents: PastPresidentService, private readonly db: Db) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);
  private roles = (u: CurrentUser) => u.findFirst("roles") ?? "";
  private allowed = (u: CurrentUser) => this.roles(u).includes("SuperAdmin") || this.roles(u).includes("Admin");
  private isSuperAdmin = (u: CurrentUser) => this.roles(u).includes("SuperAdmin");
  private scopedClubId(u: CurrentUser): number | null {
    if (this.isSuperAdmin(u)) return null;
    const v = u.findFirst("clubId");
    return v && /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : null;
  }
  private resolveClubId = (u: CurrentUser, requested: number | null) => this.scopedClubId(u) ?? requested;
  private async canTouch(u: CurrentUser, id: number) {
    if (this.isSuperAdmin(u)) return true;
    const scoped = this.scopedClubId(u);
    if (scoped === null) return false;
    const row = await this.pastPresidents.getById(id);
    return !!row && Number(row.clubId) === scoped;
  }

  @Get("search-members")
  async searchMembers(@User() u: CurrentUser, @Query("clubId") c?: string, @Query("search") s?: string) {
    if (!this.allowed(u)) return DENIED;
    const cid = this.resolveClubId(u, queryInt(c));
    if (cid === null) return badRequest({ message: "clubId is required." });
    if (!(await isClubDrillReachable(this.db, cid))) return statusCode(403, { message: CLUB_BLOCKED_MESSAGE });
    return ok(await this.pastPresidents.searchClubMembers(cid, queryString(s)));
  }

  /** Past Rotary years only (EndDate before today) — the years a past president can be recorded for. */
  @Get("years")
  async pastYears(@User() u: CurrentUser) {
    if (!this.allowed(u)) return DENIED;
    return ok(await this.db.query("SELECT pk_year_id AS Id, YearLabel, StartDate, EndDate FROM rotary_year_master WHERE isdeleted = 0 AND EndDate < CURDATE() ORDER BY StartDate DESC"));
  }

  @Get()
  async byClub(@User() u: CurrentUser, @Query("clubId") c?: string) {
    if (!this.allowed(u)) return DENIED;
    const cid = this.resolveClubId(u, queryInt(c));
    if (cid === null) return badRequest({ message: "clubId is required." });
    if (!(await isClubDrillReachable(this.db, cid))) return statusCode(403, { message: CLUB_BLOCKED_MESSAGE });
    return ok(await this.pastPresidents.getByClub(cid));
  }

  @Get(":id")
  async byId(@User() u: CurrentUser, @Param("id") idText: string) {
    const id = paramInt(idText);
    if (!this.allowed(u)) return DENIED;
    if (!(await this.canTouch(u, id))) return statusCode(403, { message: "Access denied for this record." });
    const r = await this.pastPresidents.getById(id);
    return r ? ok(r) : notFound({ message: "Past president record not found" });
  }

  @Post()
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_UPLOAD } }))
  async create(@User() u: CurrentUser, @Query("clubId") c: string | undefined, @Body() body: Record<string, unknown>, @UploadedFiles() files: UploadedFile[] | undefined) {
    if (!this.allowed(u)) return DENIED;
    const cid = this.resolveClubId(u, queryInt(c));
    if (cid === null) return badRequest({ message: "clubId is required." });
    const dto = SavePastPresidentDto.create(body ?? {}) as unknown as SavePastPresident;
    try {
      return ok({ id: await this.pastPresidents.create(cid, dto, photoOf(files), this.userId(u)) });
    } catch (e) {
      if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
      throw e;
    }
  }

  @Put(":id")
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_UPLOAD } }))
  async update(@User() u: CurrentUser, @Param("id") idText: string, @Body() body: Record<string, unknown>, @UploadedFiles() files: UploadedFile[] | undefined) {
    const id = paramInt(idText);
    if (!this.allowed(u)) return DENIED;
    if (!(await this.canTouch(u, id))) return statusCode(403, { message: "Access denied for this record." });
    const dto = SavePastPresidentDto.create(body ?? {}) as unknown as SavePastPresident;
    try {
      await this.pastPresidents.update(id, dto, photoOf(files), this.userId(u));
      return ok({ message: "Past president updated successfully." });
    } catch (e) {
      if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
      throw e;
    }
  }

  @Delete(":id")
  async remove(@User() u: CurrentUser, @Param("id") idText: string) {
    const id = paramInt(idText);
    if (!this.allowed(u)) return DENIED;
    if (!(await this.canTouch(u, id))) return statusCode(403, { message: "Access denied for this record." });
    await this.pastPresidents.delete(id, this.userId(u));
    return ok({ message: "Past president deleted successfully." });
  }
}
