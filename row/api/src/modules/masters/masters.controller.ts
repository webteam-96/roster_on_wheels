import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  MastersService, SaveFundingDto, SavePotentialMemberDto, SaveThemeDto, UpdateGreetingSettingsDto, UpsertSettingDto, type SavePotentialMember, type SaveTheme,
} from "./masters.service";
import { Db } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, notFound, ok, statusCode } from "../../common/results";
import { paramInt, queryBool, queryInt, queryString } from "../../common/binding";
import { CLUB_BLOCKED_MESSAGE, isClubDrillReachable } from "../../services/kill-switch.helper";
import { ensureWithinLimit, validateImage } from "../../services/image-tools";
import type { UploadedFile as Upload } from "../../services/media-storage";

const MAX_UPLOAD = 55 * 1024 * 1024;
const msg = (e: unknown) => (e as Error).message;

/**
 * Ports of FundingController.cs, PotentialMembersController.cs,
 * SystemSettingsController.cs, ThemesController.cs and GreetingsController.cs.
 */
@Controller("api")
@Authorize()
export class MastersController {
  constructor(
    private readonly masters: MastersService,
    private readonly db: Db,
  ) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);
  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private async blocked(clubId: number) {
    return !(await isClubDrillReachable(this.db, clubId)) ? statusCode(403, { message: CLUB_BLOCKED_MESSAGE }) : null;
  }

  // ---- funding ----

  @Get("funding")
  async getFunding() {
    return ok(await this.masters.getFunding());
  }

  @Get("funding/:id")
  async getFundingById(@Param("id") idText: string) {
    const r = await this.masters.getFundingById(paramInt(idText));
    return r ? ok(r) : notFound({ message: "Funding not found." });
  }

  @Post("funding")
  async createFunding(@Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const d = SaveFundingDto.create(body ?? {}) as { name: string; sortOrder: number; isActive: boolean };
    return ok({ id: await this.masters.createFunding(d.name, d.sortOrder, d.isActive, this.userId(user)) });
  }

  @Put("funding/:id")
  async updateFunding(@Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const d = SaveFundingDto.create(body ?? {}) as { name: string; sortOrder: number; isActive: boolean };
    await this.masters.updateFunding(paramInt(idText), d.name, d.sortOrder, d.isActive, this.userId(user));
    return ok({ message: "Funding updated successfully." });
  }

  @Delete("funding/:id")
  async deleteFunding(@Param("id") idText: string, @User() user: CurrentUser) {
    await this.masters.deleteFunding(paramInt(idText), this.userId(user));
    return ok({ message: "Funding deleted successfully." });
  }

  // ---- potential members ----

  @Get("clubs/:clubId/potential-members")
  async getPotentialMembers(@Param("clubId") clubText: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("search") search?: string) {
    const clubId = paramInt(clubText, "clubId");
    const p = queryInt(page, 1);
    const ps = queryInt(pageSize, 20);
    return (await this.blocked(clubId)) ?? ok(await this.masters.getPotentialMembers(clubId, p, ps, queryString(search)));
  }

  @Get("clubs/:clubId/potential-members/:id")
  async getPotentialMember(@Param("clubId") clubText: string, @Param("id") idText: string) {
    const clubId = paramInt(clubText, "clubId");
    const id = paramInt(idText);
    const block = await this.blocked(clubId);
    if (block) return block;
    const r = await this.masters.getPotentialMember(id);
    return r ? ok(r) : notFound({ message: "Potential member not found." });
  }

  @Post("clubs/:clubId/potential-members")
  async createPotentialMember(@Param("clubId") clubText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    return ok({ id: await this.masters.createPotentialMember(clubId, SavePotentialMemberDto.create(body ?? {}) as unknown as SavePotentialMember, this.userId(user)) });
  }

  @Put("clubs/:clubId/potential-members/:id")
  async updatePotentialMember(@Param("clubId") clubText: string, @Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    paramInt(clubText, "clubId");
    await this.masters.updatePotentialMember(paramInt(idText), SavePotentialMemberDto.create(body ?? {}) as unknown as SavePotentialMember, this.userId(user));
    return ok({ message: "Potential member updated successfully." });
  }

  @Delete("clubs/:clubId/potential-members/:id")
  async deletePotentialMember(@Param("clubId") clubText: string, @Param("id") idText: string, @User() user: CurrentUser) {
    paramInt(clubText, "clubId");
    await this.masters.deletePotentialMember(paramInt(idText), this.userId(user));
    return ok({ message: "Potential member deleted successfully." });
  }

  // ---- system settings ----

  @Get("system-settings")
  async getAllSettings(@User() user: CurrentUser) {
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can view settings." });
    try {
      return ok(await this.masters.getAllSettings());
    } catch (e) {
      return statusCode(500, { message: `Failed to get settings: ${msg(e)}` });
    }
  }

  /** Any signed-in user may read one setting (the web reads feature switches this way). */
  @Get("system-settings/:key")
  async getSetting(@Param("key") key: string) {
    try {
      return ok(await this.masters.getSetting(key));
    } catch (e) {
      return statusCode(500, { message: `Failed to get setting: ${msg(e)}` });
    }
  }

  @Post("system-settings")
  async upsertSetting(@Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can modify settings." });
    const d = UpsertSettingDto.create(body ?? {}) as { settingKey: string; settingValue: string; description: string | null };
    try {
      await this.masters.upsertSetting(d.settingKey, d.settingValue, d.description, this.userId(user));
      return ok({ message: "Setting saved successfully." });
    } catch (e) {
      return statusCode(500, { message: `Failed to save setting: ${msg(e)}` });
    }
  }

  // ---- themes ----

  @Get("themes")
  async getThemes() {
    return ok(await this.masters.getThemes());
  }

  @Post("themes/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadThemeImage(@UploadedFile() upload: Upload | undefined, @User() user: CurrentUser, @Query("strict") strict?: string) {
    const strictMode = queryBool(strict, false)!;
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can upload theme images." });
    const file = await ensureWithinLimit(upload);
    const v = validateImage(file, strictMode);
    if (!v.ok) return badRequest({ message: v.error });
    const path = await this.masters.uploadThemeImage(file!);
    return ok({ path, width: v.width, height: v.height, sizeBytes: v.sizeBytes });
  }

  @Post("themes")
  async createTheme(@Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can manage themes." });
    return ok({ id: await this.masters.createTheme(SaveThemeDto.create(body ?? {}) as unknown as SaveTheme, this.userId(user)) });
  }

  @Put("themes/:id")
  async updateTheme(@Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const id = paramInt(idText);
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can manage themes." });
    await this.masters.updateTheme(id, SaveThemeDto.create(body ?? {}) as unknown as SaveTheme, this.userId(user));
    return ok({ message: "Theme updated successfully." });
  }

  @Delete("themes/:id")
  async deleteTheme(@Param("id") idText: string, @User() user: CurrentUser) {
    const id = paramInt(idText);
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can manage themes." });
    await this.masters.deleteTheme(id, this.userId(user));
    return ok({ message: "Theme deleted successfully." });
  }

  // ---- greetings ----

  @Get("clubs/:clubId/greetings")
  async getGreetings(@Param("clubId") clubText: string) {
    const clubId = paramInt(clubText, "clubId");
    const block = await this.blocked(clubId);
    if (block) return block;
    return ok((await this.masters.getGreetingSettings(clubId)) ?? {});
  }

  @Put("clubs/:clubId/greetings")
  async updateGreetings(@Param("clubId") clubText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const clubId = paramInt(clubText, "clubId");
    await this.masters.updateGreetingSettings(clubId, UpdateGreetingSettingsDto.create(body ?? {}), this.userId(user));
    return ok({ message: "Greeting settings updated successfully." });
  }
}
