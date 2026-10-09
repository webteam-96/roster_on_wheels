import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { TaxonomyService } from "./taxonomy.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, notFound, ok } from "../../common/results";
import { bodyField, bodyIntList, paramInt, queryBool, queryInt } from "../../common/binding";
import { ensureWithinLimit, validateImage } from "../../services/image-tools";
import type { UploadedFile as Upload } from "../../services/media-storage";
import { SaveAreaOfFocusDto, SaveCategoryDto, SaveSubCategoryDto } from "../../dtos/content.dtos";

const MAX_UPLOAD = 55 * 1024 * 1024;
type Level = { name: string; sortOrder: number; isActive: boolean };

/** Ports of AreaOfFocusController.cs, CategoriesController.cs and SubCategoriesController.cs. */
@Controller("api")
@Authorize()
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);

  private async reorder(table: Parameters<TaxonomyService["reorder"]>[0], parentKey: string, body: unknown) {
    const ids = bodyIntList(body, "orderedIds");
    if (!ids.length) return badRequest({ message: "OrderedIds is required." });
    await this.taxonomy.reorder(table, Math.trunc(Number(bodyField(body, parentKey) ?? 0)) || 0, ids);
    return ok({ message: "Order saved." });
  }

  // ---- area of focus ----

  @Get("area-of-focus")
  async getAreas(@Query("moduleId") moduleId?: string) {
    return ok(await this.taxonomy.getAreasOfFocus(queryInt(moduleId)));
  }

  @Put("area-of-focus/reorder")
  reorderAreas(@Body() body: unknown) {
    return this.reorder("area_of_focus_master", "moduleId", body);
  }

  @Post("area-of-focus/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadAreaImage(@UploadedFile() upload: Upload | undefined, @Query("strict") strict?: string) {
    const file = await ensureWithinLimit(upload);
    const v = validateImage(file, queryBool(strict, false)!);
    if (!v.ok) return badRequest({ message: v.error });
    const path = await this.taxonomy.uploadAreaOfFocusImage(file!);
    return ok({ path, width: v.width, height: v.height, sizeBytes: v.sizeBytes });
  }

  @Get("area-of-focus/:id")
  async getArea(@Param("id") idText: string) {
    const r = await this.taxonomy.getAreaOfFocus(paramInt(idText));
    return r ? ok(r) : notFound({ message: "Area of focus not found." });
  }

  @Post("area-of-focus")
  async createArea(@Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const dto = SaveAreaOfFocusDto.create(body ?? {}) as unknown as Level & { moduleId: number; imagePath: string | null };
    return ok({ id: await this.taxonomy.createAreaOfFocus(dto, this.userId(user)) });
  }

  @Put("area-of-focus/:id")
  async updateArea(@Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const dto = SaveAreaOfFocusDto.create(body ?? {}) as unknown as Level & { moduleId: number; imagePath: string | null };
    await this.taxonomy.updateAreaOfFocus(paramInt(idText), dto, this.userId(user));
    return ok({ message: "Area of focus updated successfully." });
  }

  @Delete("area-of-focus/:id")
  async deleteArea(@Param("id") idText: string, @User() user: CurrentUser) {
    await this.taxonomy.deleteAreaOfFocus(paramInt(idText), this.userId(user));
    return ok({ message: "Area of focus deleted successfully." });
  }

  // ---- categories ----

  @Get("categories")
  async getCategories(@Query("areaOfFocusId") areaOfFocusId?: string) {
    return ok(await this.taxonomy.getCategories(queryInt(areaOfFocusId, 0)));
  }

  @Put("categories/reorder")
  reorderCategories(@Body() body: unknown) {
    return this.reorder("category_master", "areaOfFocusId", body);
  }

  @Get("categories/:id")
  async getCategory(@Param("id") idText: string) {
    const r = await this.taxonomy.getCategory(paramInt(idText));
    return r ? ok(r) : notFound({ message: "Category not found." });
  }

  @Post("categories")
  async createCategory(@Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    return ok({ id: await this.taxonomy.createCategory(SaveCategoryDto.create(body ?? {}) as unknown as Level & { areaOfFocusId: number }, this.userId(user)) });
  }

  @Put("categories/:id")
  async updateCategory(@Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    await this.taxonomy.updateCategory(paramInt(idText), SaveCategoryDto.create(body ?? {}) as unknown as Level & { areaOfFocusId: number }, this.userId(user));
    return ok({ message: "Category updated successfully." });
  }

  @Delete("categories/:id")
  async deleteCategory(@Param("id") idText: string, @User() user: CurrentUser) {
    await this.taxonomy.deleteCategory(paramInt(idText), this.userId(user));
    return ok({ message: "Category deleted successfully." });
  }

  // ---- sub-categories ----

  @Get("sub-categories")
  async getSubCategories(@Query("categoryId") categoryId?: string) {
    return ok(await this.taxonomy.getSubCategories(queryInt(categoryId, 0)));
  }

  @Put("sub-categories/reorder")
  reorderSubCategories(@Body() body: unknown) {
    return this.reorder("sub_category_master", "categoryId", body);
  }

  @Get("sub-categories/:id")
  async getSubCategory(@Param("id") idText: string) {
    const r = await this.taxonomy.getSubCategory(paramInt(idText));
    return r ? ok(r) : notFound({ message: "Sub category not found." });
  }

  @Post("sub-categories")
  async createSubCategory(@Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    return ok({ id: await this.taxonomy.createSubCategory(SaveSubCategoryDto.create(body ?? {}) as unknown as Level & { categoryId: number }, this.userId(user)) });
  }

  @Put("sub-categories/:id")
  async updateSubCategory(@Param("id") idText: string, @Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    await this.taxonomy.updateSubCategory(paramInt(idText), SaveSubCategoryDto.create(body ?? {}) as unknown as Level & { categoryId: number }, this.userId(user));
    return ok({ message: "Sub category updated successfully." });
  }

  @Delete("sub-categories/:id")
  async deleteSubCategory(@Param("id") idText: string, @User() user: CurrentUser) {
    await this.taxonomy.deleteSubCategory(paramInt(idText), this.userId(user));
    return ok({ message: "Sub category deleted successfully." });
  }
}
