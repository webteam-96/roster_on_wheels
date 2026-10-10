import { Body, Controller, Delete, Get, Param, Post, Put, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ModuleService } from "./modules.service";
import { Db } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, forbid, notFound, ok, statusCode } from "../../common/results";
import { paramInt, requireFile } from "../../common/binding";
import { CLUB_BLOCKED_MESSAGE, DISTRICT_BLOCKED_MESSAGE, isClubDrillReachable, isDistrictDrillReachable } from "../../services/kill-switch.helper";
import { lowerExtension, type UploadedFile as Upload } from "../../services/media-storage";
import { SaveModuleCategoryDto, SaveModuleDto, UpdateModuleComingSoonDto, type SaveModule } from "../../dtos/module.dtos";

const MAX_UPLOAD = 55 * 1024 * 1024;

/** ModuleAssignRequestDto: { moduleIds: number[] } (any casing). */
function moduleIds(body: Record<string, unknown> | null): number[] {
  const v = Object.entries(body ?? {}).find(([k]) => k.toLowerCase() === "moduleids")?.[1];
  return Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : [];
}

/**
 * Port of ModulesController.cs: route prefix api. Literal routes come before
 * ":id" routes because Express matches in order (ASP.NET prefers literals).
 */
@Controller("api")
@Authorize()
export class ModulesController {
  constructor(
    private readonly modules: ModuleService,
    private readonly db: Db,
  ) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);
  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");

  @Get("module-categories")
  async getCategories() {
    return ok(await this.modules.getCategories());
  }

  @Post("module-categories")
  async createCategory(@Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const dto = SaveModuleCategoryDto.create(body ?? {}) as { categoryName: string; sortOrder: number };
    return ok({ id: await this.modules.createCategory(dto.categoryName, dto.sortOrder, this.userId(user)) });
  }

  @Put("module-categories/:id")
  async updateCategory(@Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const dto = SaveModuleCategoryDto.create(body ?? {}) as { categoryName: string; sortOrder: number; isActive: boolean };
    await this.modules.updateCategory(paramInt(idText), dto.categoryName, dto.sortOrder, dto.isActive, this.userId(user));
    return ok({ message: "Category updated successfully." });
  }

  @Delete("module-categories/:id")
  async deleteCategory(@Param("id") idText: string, @User() user: CurrentUser) {
    await this.modules.deleteCategory(paramInt(idText), this.userId(user));
    return ok({ message: "Category deleted successfully." });
  }

  @Get("modules")
  async getModules() {
    return ok(await this.modules.getModules());
  }

  @Get("modules/coming-soon")
  async getComingSoon() {
    return ok(await this.modules.getModulesComingSoon());
  }

  @Post("modules/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadIcon(@UploadedFile() file: Upload | undefined, @User() user: CurrentUser) {
    requireFile(file);
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can upload module icons." });
    if (!file || file.size === 0) return badRequest({ message: "No file uploaded" });
    if (![".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"].includes(lowerExtension(file.originalname))) {
      return badRequest({ message: "Invalid file type. Allowed: jpg, jpeg, png, gif, webp, svg" });
    }
    if (file.size > 5 * 1024 * 1024) return badRequest({ message: "File size must be less than 5MB" });
    return ok({ path: await this.modules.uploadIcon(file) });
  }

  @Get("modules/:id")
  async getModule(@Param("id") idText: string) {
    const result = await this.modules.getModuleById(paramInt(idText));
    if (!result) return notFound({ message: "Module not found" });
    return ok(result);
  }

  @Post("modules")
  async createModule(@Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    return ok({ id: await this.modules.createModule(SaveModuleDto.create(body ?? {}) as unknown as SaveModule, this.userId(user)) });
  }

  @Put("modules/:id")
  async updateModule(@Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    await this.modules.updateModule(paramInt(idText), SaveModuleDto.create(body ?? {}) as unknown as SaveModule, this.userId(user));
    return ok({ message: "Module updated successfully." });
  }

  @Delete("modules/:id")
  async deleteModule(@Param("id") idText: string) {
    await this.modules.deleteModule(paramInt(idText));
    return ok({ message: "Module deleted successfully." });
  }

  @Get("modules/:id/usage")
  async getUsage(@Param("id") idText: string) {
    return ok(await this.modules.getModuleUsageCount(paramInt(idText)));
  }

  @Put("modules/:id/coming-soon")
  async updateComingSoon(@Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const id = paramInt(idText);
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can change Coming Soon status." });
    const dto = UpdateModuleComingSoonDto.create(body ?? {}) as { isComingSoon: boolean; comingSoonDate: string | null };
    await this.modules.updateModuleComingSoon(id, dto.isComingSoon, dto.comingSoonDate, this.userId(user));
    return ok({ message: "Coming Soon status updated." });
  }

  @Get("districts/:districtId/modules")
  async getDistrictModules(@Param("districtId") idText: string) {
    const districtId = paramInt(idText, "districtId");
    if (!(await isDistrictDrillReachable(this.db, districtId))) return statusCode(403, { message: DISTRICT_BLOCKED_MESSAGE });
    return ok(await this.modules.getDistrictModules(districtId));
  }

  @Get("districts/:districtId/modules/available")
  async getDistrictAvailable(@Param("districtId") idText: string) {
    const districtId = paramInt(idText, "districtId");
    if (!(await isDistrictDrillReachable(this.db, districtId))) return statusCode(403, { message: DISTRICT_BLOCKED_MESSAGE });
    return ok(await this.modules.getDistrictAvailableModules(districtId));
  }

  @Post("districts/:districtId/modules/assign")
  async assignDistrict(@Param("districtId") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    await this.modules.assignDistrictModules(paramInt(idText, "districtId"), moduleIds(body), this.userId(user));
    return ok({ message: "Modules assigned successfully." });
  }

  @Post("districts/:districtId/modules/unassign")
  async unassignDistrict(@Param("districtId") idText: string, @Body() body: Record<string, unknown>) {
    await this.modules.unassignDistrictModules(paramInt(idText, "districtId"), moduleIds(body));
    return ok({ message: "Modules unassigned successfully." });
  }

  @Post("clubs/modules/bulk-assign-defaults-to-empty")
  async bulkAssignClubDefaults(@User() user: CurrentUser) {
    if (!(user.findFirst("roles") ?? "").toLowerCase().includes("superadmin")) return forbid();
    const { clubsTouched, rowsInserted } = await this.modules.bulkAssignClubDefaultsToEmptyClubs(this.userId(user));
    return ok({
      clubsTouched,
      rowsInserted,
      message: clubsTouched === 0
        ? "All clubs already have at least one module — nothing to do."
        : `Assigned default modules to ${clubsTouched} club(s); inserted ${rowsInserted} row(s).`,
    });
  }

  @Get("clubs/:clubId/modules")
  async getClubModules(@Param("clubId") idText: string) {
    const clubId = paramInt(idText, "clubId");
    if (!(await isClubDrillReachable(this.db, clubId))) return statusCode(403, { message: CLUB_BLOCKED_MESSAGE });
    return ok(await this.modules.getClubModules(clubId));
  }

  @Get("clubs/:clubId/modules/available")
  async getClubAvailable(@Param("clubId") idText: string) {
    const clubId = paramInt(idText, "clubId");
    if (!(await isClubDrillReachable(this.db, clubId))) return statusCode(403, { message: CLUB_BLOCKED_MESSAGE });
    return ok(await this.modules.getClubAvailableModules(clubId));
  }

  @Post("clubs/:clubId/modules/assign")
  async assignClub(@Param("clubId") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    await this.modules.assignClubModules(paramInt(idText, "clubId"), moduleIds(body), this.userId(user));
    return ok({ message: "Modules assigned successfully." });
  }

  @Post("clubs/:clubId/modules/unassign")
  async unassignClub(@Param("clubId") idText: string, @Body() body: Record<string, unknown>) {
    await this.modules.unassignClubModules(paramInt(idText, "clubId"), moduleIds(body));
    return ok({ message: "Modules unassigned successfully." });
  }

  @Get("districts/:districtId/dashboard")
  async getDistrictDashboard(@Param("districtId") idText: string, @User() user: CurrentUser) {
    const districtId = paramInt(idText, "districtId");
    if (!(await isDistrictDrillReachable(this.db, districtId))) return statusCode(403, { message: DISTRICT_BLOCKED_MESSAGE });
    const result = await this.modules.getDistrictDashboardForMember(districtId, this.userId(user));
    if (!result) return notFound({ message: "District not found" });
    return ok(result);
  }

  @Get("clubs/:clubId/dashboard")
  async getClubDashboard(@Param("clubId") idText: string, @User() user: CurrentUser) {
    const clubId = paramInt(idText, "clubId");
    if (!(await isClubDrillReachable(this.db, clubId))) return statusCode(403, { message: CLUB_BLOCKED_MESSAGE });
    const result = await this.modules.getClubDashboardForMember(clubId, this.userId(user));
    if (!result) return notFound({ message: "Club not found" });
    return ok(result);
  }
}
