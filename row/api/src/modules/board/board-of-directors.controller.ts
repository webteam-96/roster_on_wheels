import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { DesignationService } from "./designation.service";
import { BoardDirectorService } from "./board-director.service";
import { Db } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, notFound, ok, statusCode } from "../../common/results";
import { InvalidOperationException } from "../../common/exceptions";
import { paramInt, queryInt, queryString } from "../../common/binding";
import { CLUB_BLOCKED_MESSAGE, isClubDrillReachable } from "../../services/kill-switch.helper";
import { ClubSiteCachePurger } from "../../services/club-site-cache-purger";
import { ReorderDesignationsDto, SaveBoardDirectorDto, SaveDesignationDto, type SaveBoardDirector } from "../../dtos/board.dtos";

/** A List<int> body field, any key casing. */
function intList(body: Record<string, unknown> | null, key: string): number[] {
  const v = Object.entries(body ?? {}).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
  return Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : [];
}

/**
 * Port of BoardOfDirectorsController.cs: designations and club boards.
 * Literal routes are declared before ":id" routes.
 */
@Controller()
@Authorize()
export class BoardOfDirectorsController {
  constructor(
    private readonly designations: DesignationService,
    private readonly board: BoardDirectorService,
    private readonly db: Db,
    private readonly purger: ClubSiteCachePurger,
  ) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);

  private async blocked(clubId: number) {
    return !(await isClubDrillReachable(this.db, clubId)) ? statusCode(403, { message: CLUB_BLOCKED_MESSAGE }) : null;
  }

  @Get("api/designations")
  async getDesignations() {
    return ok(await this.designations.getAll());
  }

  @Post("api/designations")
  async createDesignation(@Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const dto = SaveDesignationDto.create(body ?? {}) as { designationName: string; sortOrder: number };
    return ok({ id: await this.designations.create(dto.designationName, dto.sortOrder, this.userId(user)) });
  }

  @Put("api/designations/reorder")
  async reorderDesignations(@Body() body: Record<string, unknown>) {
    const dto = ReorderDesignationsDto.create(body ?? {}) as { id1: number; id2: number };
    await this.designations.swapOrder(dto.id1, dto.id2);
    return ok({ message: "Order updated successfully." });
  }

  @Put("api/designations/reorder-all")
  async reorderDesignationsAll(@Body() body: Record<string, unknown>) {
    await this.designations.reorderAll(intList(body, "orderedIds"));
    return ok({ message: "Designations reordered successfully." });
  }

  @Put("api/designations/:id")
  async updateDesignation(@Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const dto = SaveDesignationDto.create(body ?? {}) as { designationName: string; sortOrder: number };
    await this.designations.update(paramInt(idText), dto.designationName, dto.sortOrder, this.userId(user));
    return ok({ message: "Designation updated successfully." });
  }

  @Delete("api/designations/:id")
  async deleteDesignation(@Param("id") idText: string, @User() user: CurrentUser) {
    try {
      await this.designations.delete(paramInt(idText), this.userId(user));
      return ok({ message: "Designation deleted successfully." });
    } catch (e) {
      if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
      throw e;
    }
  }

  @Get("api/clubs/:clubId/board-of-directors")
  async getByClub(@Param("clubId") clubText: string, @Query("yearId") yearId?: string) {
    const clubId = paramInt(clubText, "clubId");
    const year = queryInt(yearId, 0);
    return (await this.blocked(clubId)) ?? ok(await this.board.getByClub(clubId, year));
  }

  @Get("api/clubs/:clubId/board-of-directors/years")
  async getYears(@Param("clubId") clubText: string) {
    const clubId = paramInt(clubText, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.board.getYearsByClub(clubId));
  }

  @Get("api/clubs/:clubId/board-of-directors/search-members")
  async searchMembers(@Param("clubId") clubText: string, @Query("search") search?: string) {
    const clubId = paramInt(clubText, "clubId");
    return (await this.blocked(clubId)) ?? ok(await this.board.searchClubMembers(clubId, queryString(search)));
  }

  @Put("api/clubs/:clubId/board-of-directors/reorder")
  async reorder(@Param("clubId") clubText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    const block = await this.blocked(clubId);
    if (block) return block;
    const orderedIds = intList(body, "orderedIds");
    if (!orderedIds.length) return badRequest({ message: "OrderedIds is required." });
    const yearId = Number(Object.entries(body ?? {}).find(([k]) => k.toLowerCase() === "yearid")?.[1] ?? 0) || 0;
    await this.board.reorder(clubId, yearId, orderedIds, this.userId(user));
    this.purger.purgeByClub(clubId);
    return ok({ message: "Order updated successfully." });
  }

  @Get("api/clubs/:clubId/board-of-directors/:id")
  async getById(@Param("clubId") clubText: string, @Param("id") idText: string) {
    const clubId = paramInt(clubText, "clubId");
    const id = paramInt(idText);
    const block = await this.blocked(clubId);
    if (block) return block;
    const result = await this.board.getById(id);
    return result ? ok(result) : notFound({ message: "Board director record not found" });
  }

  @Post("api/clubs/:clubId/board-of-directors")
  async create(@Param("clubId") clubText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    try {
      const id = await this.board.create(clubId, SaveBoardDirectorDto.create(body ?? {}) as unknown as SaveBoardDirector, this.userId(user));
      this.purger.purgeByClub(clubId);
      return ok({ id });
    } catch (e) {
      if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
      throw e;
    }
  }

  @Put("api/clubs/:clubId/board-of-directors/:id")
  async update(@Param("clubId") clubText: string, @Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    const id = paramInt(idText);
    try {
      await this.board.update(id, SaveBoardDirectorDto.create(body ?? {}) as unknown as SaveBoardDirector, this.userId(user));
      this.purger.purgeByClub(clubId);
      return ok({ message: "Board director updated successfully." });
    } catch (e) {
      if (e instanceof InvalidOperationException) return badRequest({ message: e.message });
      throw e;
    }
  }

  @Delete("api/clubs/:clubId/board-of-directors/:id")
  async remove(@Param("clubId") clubText: string, @Param("id") idText: string, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    await this.board.delete(paramInt(idText), this.userId(user));
    this.purger.purgeByClub(clubId);
    return ok({ message: "Board director deleted successfully." });
  }
}
