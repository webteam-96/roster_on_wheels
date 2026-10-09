import { Injectable } from "@nestjs/common";
import { Db, type Row } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { saveWithGuidName, type UploadedFile } from "../../services/media-storage";
import { AreaOfFocusDto, CategoryDto, SubCategoryDto } from "../../dtos/content.dtos";

const scalar = (rows: Row[]) => Number(Object.values(rows[0] ?? {})[0] ?? 0);

type Level = { name: string; sortOrder: number; isActive: boolean };

/**
 * Ports of AreaOfFocusService.cs, CategoryService.cs and SubCategoryService.cs:
 * the project taxonomy (area of focus > category > sub-category), all through
 * stored procedures.
 */
@Injectable()
export class TaxonomyService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  async getAreasOfFocus(moduleId: number | null) {
    return AreaOfFocusDto.mapAll(await this.db.callProcedure("sp_area_of_focus_get_all", { p_ModuleId: moduleId }));
  }

  async getAreaOfFocus(id: number) {
    return AreaOfFocusDto.map((await this.db.callProcedure("sp_area_of_focus_get_by_id", { p_Id: id }))[0] ?? null);
  }

  async createAreaOfFocus(dto: Level & { moduleId: number; imagePath: string | null }, by: number) {
    return scalar(
      await this.db.callProcedure("sp_area_of_focus_create", {
        p_ModuleId: dto.moduleId, p_Name: dto.name, p_ImagePath: dto.imagePath, p_SortOrder: dto.sortOrder, p_IsActive: dto.isActive, p_CreatedBy: by,
      }),
    );
  }

  async updateAreaOfFocus(id: number, dto: Level & { moduleId: number; imagePath: string | null }, by: number) {
    await this.db.executeProcedure("sp_area_of_focus_update", {
      p_Id: id, p_ModuleId: dto.moduleId, p_Name: dto.name, p_ImagePath: dto.imagePath, p_SortOrder: dto.sortOrder, p_IsActive: dto.isActive, p_ModifiedBy: by,
    });
  }

  async deleteAreaOfFocus(id: number, by: number) {
    await this.db.executeProcedure("sp_area_of_focus_delete", { p_Id: id, p_DeletedBy: by });
  }

  /** Returns the stored file name (the C# returns the name, not a path). */
  uploadAreaOfFocusImage(file: UploadedFile) {
    return saveWithGuidName(this.config, file, "uploads", "area-of-focus");
  }

  async getCategories(areaOfFocusId: number) {
    return CategoryDto.mapAll(await this.db.callProcedure("sp_category_get_by_area_of_focus", { p_AreaOfFocusId: areaOfFocusId }));
  }

  async getCategory(id: number) {
    return CategoryDto.map((await this.db.callProcedure("sp_category_get_by_id", { p_Id: id }))[0] ?? null);
  }

  async createCategory(dto: Level & { areaOfFocusId: number }, by: number) {
    return scalar(
      await this.db.callProcedure("sp_category_create", { p_AreaOfFocusId: dto.areaOfFocusId, p_Name: dto.name, p_SortOrder: dto.sortOrder, p_IsActive: dto.isActive, p_CreatedBy: by }),
    );
  }

  async updateCategory(id: number, dto: Level & { areaOfFocusId: number }, by: number) {
    await this.db.executeProcedure("sp_category_update", {
      p_Id: id, p_AreaOfFocusId: dto.areaOfFocusId, p_Name: dto.name, p_SortOrder: dto.sortOrder, p_IsActive: dto.isActive, p_ModifiedBy: by,
    });
  }

  async deleteCategory(id: number, by: number) {
    await this.db.executeProcedure("sp_category_delete", { p_Id: id, p_DeletedBy: by });
  }

  async getSubCategories(categoryId: number) {
    return SubCategoryDto.mapAll(await this.db.callProcedure("sp_sub_category_get_by_category", { p_CategoryId: categoryId }));
  }

  async getSubCategory(id: number) {
    return SubCategoryDto.map((await this.db.callProcedure("sp_sub_category_get_by_id", { p_Id: id }))[0] ?? null);
  }

  async createSubCategory(dto: Level & { categoryId: number }, by: number) {
    return scalar(
      await this.db.callProcedure("sp_sub_category_create", { p_CategoryId: dto.categoryId, p_Name: dto.name, p_SortOrder: dto.sortOrder, p_IsActive: dto.isActive, p_CreatedBy: by }),
    );
  }

  async updateSubCategory(id: number, dto: Level & { categoryId: number }, by: number) {
    await this.db.executeProcedure("sp_sub_category_update", {
      p_Id: id, p_CategoryId: dto.categoryId, p_Name: dto.name, p_SortOrder: dto.sortOrder, p_IsActive: dto.isActive, p_ModifiedBy: by,
    });
  }

  async deleteSubCategory(id: number, by: number) {
    await this.db.executeProcedure("sp_sub_category_delete", { p_Id: id, p_DeletedBy: by });
  }

  /** Saves a drag-and-drop order (0-based) within one parent. */
  async reorder(table: "area_of_focus_master" | "category_master" | "sub_category_master", parentId: number, orderedIds: number[]) {
    const [pk, fk] = {
      area_of_focus_master: ["pk_area_of_focus_id", "fk_module_id"],
      category_master: ["pk_category_id", "fk_area_of_focus_id"],
      sub_category_master: ["pk_sub_category_id", "fk_category_id"],
    }[table];
    await this.db.session(async (conn) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await conn.execute(`UPDATE ${table} SET sort_order=@S WHERE ${pk}=@Id AND ${fk}=@P`, { S: i, Id: orderedIds[i], P: parentId });
      }
    });
  }
}
