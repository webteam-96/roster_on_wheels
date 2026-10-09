import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { DistrictService } from "./districts.service";
import { Db } from "../../database/db.service";
import { AuditLogService } from "../../services/audit-log.service";
import { isDistrictDrillReachable } from "../../services/kill-switch.helper";
import { lowerExtension, type UploadedFile as Upload } from "../../services/media-storage";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, conflict, createdAt, noContent, notFound, ok, statusCode } from "../../common/results";
import { paramInt, queryBool, queryInt, queryString } from "../../common/binding";
import { SaveDistrictDto, UpdateDistrictCurrencyDto, type SaveDistrict } from "../../dtos/district.dtos";

const MAX_UPLOAD = 55 * 1024 * 1024;

/** Port of DistrictsController.cs: api/Districts. */
@Controller("api/districts")
@Authorize()
export class DistrictsController {
  constructor(
    private readonly districts: DistrictService,
    private readonly audit: AuditLogService,
    private readonly db: Db,
  ) {}

  private isSuperAdmin = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private memberId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);

  @Get()
  async getAll(
    @Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("search") search?: string,
    @Query("isActive") isActive?: string, @Query("zoneId") zoneId?: string, @Query("hasClubs") hasClubs?: string,
    @Query("hasMembers") hasMembers?: string, @Query("hasSyncClubs") hasSyncClubs?: string,
  ) {
    return ok(
      await this.districts.getAll(queryInt(page, 1), queryInt(pageSize, 12), queryString(search), queryInt(isActive), queryInt(zoneId),
        queryBool(hasClubs), queryBool(hasMembers), queryBool(hasSyncClubs)),
    );
  }

  @Get(":id")
  async getById(@Param("id") idText: string) {
    const district = await this.districts.getById(paramInt(idText));
    if (!district) return notFound({ message: "District not found" });
    return ok(district);
  }

  @Get(":id/clubs")
  async getClubs(@Param("id") idText: string, @Query("hasMembers") hasMembers?: string) {
    const id = paramInt(idText);
    if (!(await this.districts.getById(id))) return notFound({ message: "District not found" });
    if (!(await isDistrictDrillReachable(this.db, id))) {
      return statusCode(403, { message: "This district or its zone is inactive. Reactivate it first to access its clubs." });
    }
    return ok(await this.districts.getClubs(id, queryBool(hasMembers)));
  }

  @Get(":id/members")
  async getMembers(@Param("id") idText: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("search") search?: string) {
    const id = paramInt(idText);
    if (!(await this.districts.getById(id))) return notFound({ message: "District not found" });
    if (!(await isDistrictDrillReachable(this.db, id))) {
      return statusCode(403, { message: "This district or its zone is inactive. Reactivate it first to access its members." });
    }
    return ok(await this.districts.getMembers(id, queryInt(page, 1), queryInt(pageSize, 20), queryString(search)));
  }

  @Post()
  async create(@Body() body: Record<string, unknown>, @User() user: CurrentUser, @Req() req: Request) {
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can create districts." });
    const dto = SaveDistrictDto.create(body ?? {}) as unknown as SaveDistrict;
    try {
      const id = await this.districts.create(dto, this.memberId(user));
      await this.audit.log(this.memberId(user), "CREATE", "district", id, dto.districtNumber, body, req);
      return createdAt(`/api/Districts/${id}`, { id });
    } catch (e) {
      return conflict({ message: (e as Error).message });
    }
  }

  @Put(":id")
  async update(@Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser, @Req() req: Request) {
    const id = paramInt(idText);
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can update districts." });
    const dto = SaveDistrictDto.create(body ?? {}) as unknown as SaveDistrict;
    if (!(await this.districts.getById(id))) return notFound({ message: "District not found" });
    try {
      await this.districts.update(id, dto, this.memberId(user));
      await this.audit.log(this.memberId(user), "UPDATE", "district", id, dto.districtNumber, body, req);
      return noContent();
    } catch (e) {
      return conflict({ message: (e as Error).message });
    }
  }

  @Put(":id/default-currency")
  async updateDefaultCurrency(@Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser, @Req() req: Request) {
    const id = paramInt(idText);
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can update district currency." });
    const existing = await this.districts.getById(id);
    if (!existing) return notFound({ message: "District not found" });
    const dto = UpdateDistrictCurrencyDto.create(body ?? {}) as { defaultCurrency: string | null };
    await this.districts.updateDefaultCurrency(id, dto.defaultCurrency, this.memberId(user));
    await this.audit.log(this.memberId(user), "UPDATE", "district_currency", id, existing.districtNumber as string, body, req);
    return noContent();
  }

  @Delete(":id")
  async remove(@Param("id") idText: string, @User() user: CurrentUser, @Req() req: Request) {
    const id = paramInt(idText);
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can delete districts." });
    const existing = await this.districts.getById(id);
    if (!existing) return notFound({ message: "District not found" });
    await this.districts.delete(id, this.memberId(user));
    await this.audit.log(this.memberId(user), "DELETE", "district", id, existing.districtNumber as string, null, req);
    return noContent();
  }

  @Post("upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async upload(@UploadedFile() file: Upload | undefined, @User() user: CurrentUser) {
    if (!this.isSuperAdmin(user)) return statusCode(403, { message: "Only SuperAdmin can upload district logos." });
    if (!file || file.size === 0) return badRequest({ message: "No file uploaded" });
    if (![".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(lowerExtension(file.originalname))) {
      return badRequest({ message: "Invalid file type. Allowed: jpg, jpeg, png, gif, webp" });
    }
    if (file.size > 5 * 1024 * 1024) return badRequest({ message: "File size must be less than 5MB" });
    return ok({ path: await this.districts.uploadLogo(file) });
  }
}
