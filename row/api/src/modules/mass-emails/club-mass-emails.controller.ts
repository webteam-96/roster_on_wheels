import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { MassEmailService, bindCreateMassEmail, parseIdList } from "./mass-email.service";
import { Db } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, notFound, ok, statusCode } from "../../common/results";
import { paramInt, queryInt, queryString } from "../../common/binding";
import { CLUB_BLOCKED_MESSAGE, isClubDrillReachable } from "../../services/kill-switch.helper";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Port of ClubMassEmailsController.cs: api/clubs/{clubId}/mass-emails. */
@Controller("api/clubs/:clubId/mass-emails")
@Authorize()
export class ClubMassEmailsController {
  constructor(
    private readonly service: MassEmailService,
    private readonly db: Db,
  ) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);
  private async blocked(clubId: number) {
    return !(await isClubDrillReachable(this.db, clubId)) ? statusCode(403, { message: CLUB_BLOCKED_MESSAGE }) : null;
  }

  @Get()
  async getList(
    @Param("clubId") clubText: string, @Query("status") status?: string, @Query("search") search?: string,
    @Query("page") pageText?: string, @Query("pageSize") pageSizeText?: string,
  ) {
    const clubId = paramInt(clubText, "clubId");
    const page = queryInt(pageText, 1);
    const pageSize = queryInt(pageSizeText, 20);
    const block = await this.blocked(clubId);
    if (block) return block;
    const { items, totalCount } = await this.service.getList(clubId, queryString(status), queryString(search), page, pageSize);
    return ok({ items, totalCount, page, pageSize });
  }

  @Get("recipient-count")
  async getRecipientCount(
    @Param("clubId") clubText: string, @Query("recipientType") rt?: string, @Query("subgroupIds") subgroupIds?: string, @Query("memberIds") memberIds?: string,
  ) {
    const clubId = paramInt(clubText, "clubId");
    const recipientType = queryInt(rt, 0);
    const block = await this.blocked(clubId);
    if (block) return block;
    return ok(await this.service.getRecipientCount(clubId, recipientType, parseIdList(subgroupIds), parseIdList(memberIds)));
  }

  @Get(":id")
  async getDetail(@Param("clubId") clubText: string, @Param("id") idText: string) {
    const clubId = paramInt(clubText, "clubId");
    const id = paramInt(idText);
    const block = await this.blocked(clubId);
    if (block) return block;
    const detail = await this.service.getDetail(id);
    return detail ? ok(detail) : notFound({ message: "Mass email not found." });
  }

  @Post()
  async create(@Param("clubId") clubText: string, @Body() body: unknown, @User() u: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    try {
      const id = await this.service.create(clubId, bindCreateMassEmail(body), this.userId(u));
      return ok({ id, message: "Mass email created successfully." });
    } catch (e) {
      return badRequest({ message: message(e) });
    }
  }

  @Put(":id")
  async update(@Param("clubId") clubText: string, @Param("id") idText: string, @Body() body: unknown, @User() u: CurrentUser) {
    paramInt(clubText, "clubId");
    const id = paramInt(idText);
    try {
      await this.service.update(id, bindCreateMassEmail(body), this.userId(u));
      return ok({ message: "Mass email updated successfully." });
    } catch (e) {
      return badRequest({ message: message(e) });
    }
  }

  @Delete(":id")
  async delete(@Param("clubId") clubText: string, @Param("id") idText: string, @User() u: CurrentUser) {
    paramInt(clubText, "clubId");
    const id = paramInt(idText);
    try {
      await this.service.delete(id, this.userId(u));
      return ok({ message: "Mass email deleted successfully." });
    } catch (e) {
      return badRequest({ message: message(e) });
    }
  }

  @Post(":id/send")
  async send(@Param("clubId") clubText: string, @Param("id") idText: string, @User() u: CurrentUser) {
    paramInt(clubText, "clubId");
    const id = paramInt(idText);
    try {
      await this.service.send(id, this.userId(u));
      return ok({ message: "Mass email is being sent." });
    } catch (e) {
      return badRequest({ message: message(e) });
    }
  }

  @Get(":id/recipients")
  async getRecipients(@Param("clubId") clubText: string, @Param("id") idText: string) {
    const clubId = paramInt(clubText, "clubId");
    const id = paramInt(idText);
    const block = await this.blocked(clubId);
    if (block) return block;
    return ok(await this.service.getRecipients(id));
  }
}
