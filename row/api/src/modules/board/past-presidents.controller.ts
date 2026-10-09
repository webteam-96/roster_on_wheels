import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import { PastPresidentService, SavePastPresidentDto, type SavePastPresident } from "./past-president.service";
import { Db } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { notFound, ok, statusCode } from "../../common/results";
import { paramInt, queryString } from "../../common/binding";
import { CLUB_BLOCKED_MESSAGE, isClubDrillReachable } from "../../services/kill-switch.helper";
import type { UploadedFile } from "../../services/media-storage";

const MAX_UPLOAD = 55 * 1024 * 1024;
/** IFormFile? photo: the form file named "photo" (any casing). */
const photoOf = (files: UploadedFile[] | undefined) => (files ?? []).find((f) => (f as UploadedFile & { fieldname?: string }).fieldname?.toLowerCase() === "photo");

/** Port of PastPresidentsController.cs: api/clubs/{clubId}/past-presidents. Create/update take a multipart form. */
@Controller("api/clubs/:clubId/past-presidents")
@Authorize()
export class PastPresidentsController {
  constructor(
    private readonly pastPresidents: PastPresidentService,
    private readonly db: Db,
  ) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);

  private async blocked(clubId: number) {
    return !(await isClubDrillReachable(this.db, clubId)) ? statusCode(403, { message: CLUB_BLOCKED_MESSAGE }) : null;
  }

  @Get()
  async getByClub(@Param("clubId") clubText: string) {
    const clubId = paramInt(clubText, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.pastPresidents.getByClub(clubId));
  }

  @Get("search-members")
  async searchMembers(@Param("clubId") clubText: string, @Query("search") search?: string) {
    const clubId = paramInt(clubText, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.pastPresidents.searchClubMembers(clubId, queryString(search)));
  }

  @Get(":id")
  async getById(@Param("clubId") clubText: string, @Param("id") idText: string) {
    const clubId = paramInt(clubText, "clubId");
    const id = paramInt(idText);
    const block = await this.blocked(clubId);
    if (block) return block;
    const result = await this.pastPresidents.getById(id);
    return result ? ok(result) : notFound({ message: "Past president record not found" });
  }

  @Post()
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_UPLOAD } }))
  async create(@Param("clubId") clubText: string, @Body() body: Record<string, unknown>, @UploadedFiles() files: UploadedFile[] | undefined, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    const dto = SavePastPresidentDto.create(body ?? {}) as unknown as SavePastPresident;
    return ok({ id: await this.pastPresidents.create(clubId, dto, photoOf(files), this.userId(user)) });
  }

  @Put(":id")
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_UPLOAD } }))
  async update(
    @Param("clubId") clubText: string, @Param("id") idText: string, @Body() body: Record<string, unknown>,
    @UploadedFiles() files: UploadedFile[] | undefined, @User() user: CurrentUser,
  ) {
    paramInt(clubText, "clubId");
    const dto = SavePastPresidentDto.create(body ?? {}) as unknown as SavePastPresident;
    await this.pastPresidents.update(paramInt(idText), dto, photoOf(files), this.userId(user));
    return ok({ message: "Past president updated successfully." });
  }

  @Delete(":id")
  async remove(@Param("clubId") clubText: string, @Param("id") idText: string, @User() user: CurrentUser) {
    paramInt(clubText, "clubId");
    await this.pastPresidents.delete(paramInt(idText), this.userId(user));
    return ok({ message: "Past president deleted successfully." });
  }
}
