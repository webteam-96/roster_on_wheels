import { Injectable } from "@nestjs/common";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { dbDateTime } from "../../common/binding";
import type { DtoObject } from "../../common/dto";
import { saveWithGuidName, type UploadedFile } from "../../services/media-storage";
import {
  AssignedModuleDto, AvailableModuleDto, ClubDashboardDto, DashboardCategoryGroupDto, DashboardModuleDto, DistrictDashboardDto,
  ModuleCategoryDto, ModuleComingSoonDto, ModuleDto, ModuleUsageCountDto, type SaveModule,
} from "../../dtos/module.dtos";

const MODULE_COLUMNS = `
    pk_module_id           AS Id,
    ModuleName             AS ModuleName,
    ModuleKey              AS ModuleKey,
    fk_category_id         AS CategoryId,
    (SELECT CategoryName FROM module_categories c WHERE c.pk_category_id = m.fk_category_id) AS CategoryName,
    ModuleLevel            AS ModuleLevel,
    IconClass              AS IconClass,
    IconPath               AS IconPath,
    Description            AS Description,
    RouteUrl               AS RouteUrl,
    IsDefaultForDistrict   AS IsDefaultForDistrict,
    IsDefaultForClub       AS IsDefaultForClub,
    IsDefaultForMember     AS IsDefaultForMember,
    SortOrder              AS SortOrder,
    IsActive               AS IsActive`;

const scalar = (rows: Row[]) => Number(Object.values(rows[0] ?? {})[0] ?? 0);

/** Enabled modules grouped by category, categories and modules in their sort order. */
function groupForDashboard(modules: DtoObject[]): DtoObject[] {
  const groups = new Map<string, { categoryId: number; categoryName: string; sortOrder: number; items: DtoObject[] }>();
  for (const m of modules.filter((x) => x.isEnabled)) {
    const key = `${m.categoryId}|${m.categoryName}|${m.categorySortOrder}`;
    if (!groups.has(key)) groups.set(key, { categoryId: m.categoryId as number, categoryName: m.categoryName as string, sortOrder: m.categorySortOrder as number, items: [] });
    groups.get(key)!.items.push(m);
  }
  return [...groups.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder) // stable, like LINQ OrderBy
    .map((g) =>
      DashboardCategoryGroupDto.create({
        CategoryId: g.categoryId,
        CategoryName: g.categoryName,
        SortOrder: g.sortOrder,
        Modules: [...g.items]
          .sort((a, b) => (a.moduleSortOrder as number) - (b.moduleSortOrder as number))
          .map((m) => DashboardModuleDto.create({ ModuleId: m.moduleId, ModuleName: m.moduleName, ModuleKey: m.moduleKey, IconClass: m.iconClass, IconPath: m.iconPath, RouteUrl: m.routeUrl, Description: m.description })),
      }),
    );
}

/** Port of ModuleService.cs: the module catalogue and per-district / per-club switches. */
@Injectable()
export class ModuleService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  async getCategories() {
    return ModuleCategoryDto.mapAll(await this.db.callProcedure("sp_module_category_get_all"));
  }

  async createCategory(categoryName: string, sortOrder: number, createdBy: number): Promise<number> {
    return scalar(await this.db.callProcedure("sp_module_category_create", { p_CategoryName: categoryName.trim(), p_SortOrder: sortOrder, p_CreatedBy: createdBy }));
  }

  async updateCategory(id: number, categoryName: string, sortOrder: number, isActive: boolean, modifiedBy: number) {
    await this.db.executeProcedure("sp_module_category_update", { p_Id: id, p_CategoryName: categoryName.trim(), p_SortOrder: sortOrder, p_IsActive: isActive ? 1 : 0, p_ModifiedBy: modifiedBy });
  }

  async deleteCategory(id: number, deletedBy: number) {
    await this.db.executeProcedure("sp_module_category_delete", { p_Id: id, p_DeletedBy: deletedBy });
  }

  async getModules() {
    return ModuleDto.mapAll(await this.db.query(`SELECT ${MODULE_COLUMNS} FROM module_master m WHERE isdeleted = 0 ORDER BY SortOrder, ModuleName`));
  }

  async getModuleById(id: number) {
    return ModuleDto.map(await this.db.queryFirstOrDefault(`SELECT ${MODULE_COLUMNS} FROM module_master m WHERE pk_module_id = @Id AND isdeleted = 0`, { Id: id }));
  }

  private static moduleValues(dto: SaveModule) {
    return {
      ModuleName: dto.moduleName.trim(), ModuleKey: dto.moduleKey.trim(), CategoryId: dto.categoryId, ModuleLevel: dto.moduleLevel,
      IconClass: dto.iconClass, IconPath: dto.iconPath, Description: dto.description, RouteUrl: dto.routeUrl,
      IsDefaultForDistrict: dto.isDefaultForDistrict ? 1 : 0, IsDefaultForClub: dto.isDefaultForClub ? 1 : 0,
      IsDefaultForMember: dto.isDefaultForMember ? 1 : 0, SortOrder: dto.sortOrder,
    };
  }

  async createModule(dto: SaveModule, createdBy: number): Promise<number> {
    return this.db.session(async (conn) => {
      const moduleId = Number(
        await conn.executeScalar(
          `INSERT INTO module_master
               (ModuleName, ModuleKey, fk_category_id, ModuleLevel, IconClass, IconPath, Description, RouteUrl,
                IsDefaultForDistrict, IsDefaultForClub, IsDefaultForMember, SortOrder, IsActive, created_by, created_date)
           VALUES
               (@ModuleName, @ModuleKey, @CategoryId, @ModuleLevel, @IconClass, @IconPath, @Description, @RouteUrl,
                @IsDefaultForDistrict, @IsDefaultForClub, @IsDefaultForMember, @SortOrder, 1, @CreatedBy, NOW());
           SELECT LAST_INSERT_ID();`,
          { ...ModuleService.moduleValues(dto), CreatedBy: createdBy },
        ),
      );
      if (dto.assignToAll) await ModuleService.propagateByLevel(conn, moduleId, dto.moduleLevel, createdBy);
      return moduleId;
    });
  }

  /** "Assign to all": every district and/or club (by the module's level) gets the module, enabled. */
  private static async propagateByLevel(conn: DbCommands, moduleId: number, moduleLevel: string | null, assignedBy: number) {
    const level = (moduleLevel ?? "Both").trim();
    if (level === "District" || level === "Both") {
      await conn.execute(
        `INSERT IGNORE INTO district_modules (fk_district_id, fk_module_id, IsEnabled, AssignedBy)
         SELECT d.pk_district_id, @ModuleId, 1, @AssignedBy
         FROM district_master d
         WHERE d.isdeleted = 0`,
        { ModuleId: moduleId, AssignedBy: assignedBy },
      );
    }
    if (level === "Club" || level === "Both") {
      await conn.execute(
        `INSERT IGNORE INTO club_modules (fk_club_id, fk_module_id, IsEnabled, AssignedBy)
         SELECT c.pk_club_id, @ModuleId, 1, @AssignedBy
         FROM club_master c
         WHERE c.isdeleted = 0`,
        { ModuleId: moduleId, AssignedBy: assignedBy },
      );
    }
  }

  async updateModule(id: number, dto: SaveModule, modifiedBy: number) {
    await this.db.session(async (conn) => {
      await conn.execute(
        `UPDATE module_master SET
             ModuleName = @ModuleName, ModuleKey = @ModuleKey, fk_category_id = @CategoryId, ModuleLevel = @ModuleLevel,
             IconClass = @IconClass, IconPath = @IconPath, Description = @Description, RouteUrl = @RouteUrl,
             IsDefaultForDistrict = @IsDefaultForDistrict, IsDefaultForClub = @IsDefaultForClub, IsDefaultForMember = @IsDefaultForMember,
             SortOrder = @SortOrder, IsActive = @IsActive, modified_by = @ModifiedBy, modified_date = NOW()
         WHERE pk_module_id = @Id AND isdeleted = 0`,
        { ...ModuleService.moduleValues(dto), IsActive: dto.isActive ? 1 : 0, Id: id, ModifiedBy: modifiedBy },
      );
      if (dto.assignToAll) await ModuleService.propagateByLevel(conn, id, dto.moduleLevel, modifiedBy);
    });
  }

  async deleteModule(id: number) {
    await this.db.session(async (conn) => {
      await conn.execute("DELETE FROM district_modules WHERE fk_module_id = @Id", { Id: id });
      await conn.execute("DELETE FROM club_modules WHERE fk_module_id = @Id", { Id: id });
      await conn.executeProcedure("sp_module_delete", { p_Id: id });
    });
  }

  async getModuleUsageCount(moduleId: number) {
    const row = (await this.db.callProcedure("sp_module_get_usage_count", { p_ModuleId: moduleId }))[0];
    if (!row) throw new Error("Sequence contains no elements");
    return ModuleUsageCountDto.map(row);
  }

  private async queryDistrictModules(conn: DbCommands, districtId: number) {
    return AssignedModuleDto.mapAll(
      await conn.query(
        `SELECT dm.pk_district_module_id AS Id, dm.fk_module_id AS ModuleId,
                m.ModuleName, m.ModuleKey, m.IconClass, m.IconPath, m.Description, m.RouteUrl,
                m.fk_category_id AS CategoryId, c.CategoryName,
                c.SortOrder AS CategorySortOrder, m.SortOrder AS ModuleSortOrder,
                dm.IsEnabled
         FROM district_modules dm
         JOIN module_master m ON m.pk_module_id = dm.fk_module_id AND m.isdeleted = 0 AND m.IsActive = 1
         JOIN module_categories c ON c.pk_category_id = m.fk_category_id AND c.isdeleted = 0
         WHERE dm.fk_district_id = @DistrictId
         ORDER BY c.SortOrder, m.SortOrder`,
        { DistrictId: districtId },
      ),
    );
  }

  private async queryClubModules(conn: DbCommands, clubId: number) {
    return AssignedModuleDto.mapAll(
      await conn.query(
        `SELECT cm.pk_club_module_id AS Id, cm.fk_module_id AS ModuleId,
                m.ModuleName, m.ModuleKey, m.IconClass, m.IconPath, m.Description, m.RouteUrl,
                m.fk_category_id AS CategoryId, c.CategoryName,
                c.SortOrder AS CategorySortOrder, m.SortOrder AS ModuleSortOrder,
                cm.IsEnabled
         FROM club_modules cm
         JOIN module_master m ON m.pk_module_id = cm.fk_module_id AND m.isdeleted = 0 AND m.IsActive = 1
         JOIN module_categories c ON c.pk_category_id = m.fk_category_id AND c.isdeleted = 0
         WHERE cm.fk_club_id = @ClubId
         ORDER BY c.SortOrder, m.SortOrder`,
        { ClubId: clubId },
      ),
    );
  }

  getDistrictModules(districtId: number) {
    return this.queryDistrictModules(this.db, districtId);
  }

  async getDistrictAvailableModules(districtId: number) {
    return AvailableModuleDto.mapAll(await this.db.callProcedure("sp_district_modules_get_available", { p_DistrictId: districtId }));
  }

  async assignDistrictModules(districtId: number, moduleIds: number[], assignedBy: number) {
    for (const moduleId of moduleIds) await this.db.executeProcedure("sp_district_modules_assign", { p_DistrictId: districtId, p_ModuleId: moduleId, p_AssignedBy: assignedBy });
  }

  async unassignDistrictModules(districtId: number, moduleIds: number[]) {
    for (const moduleId of moduleIds) await this.db.executeProcedure("sp_district_modules_unassign", { p_DistrictId: districtId, p_ModuleId: moduleId });
  }

  getClubModules(clubId: number) {
    return this.queryClubModules(this.db, clubId);
  }

  async getClubAvailableModules(clubId: number) {
    return AvailableModuleDto.mapAll(await this.db.callProcedure("sp_club_modules_get_available", { p_ClubId: clubId }));
  }

  async assignClubModules(clubId: number, moduleIds: number[], assignedBy: number) {
    for (const moduleId of moduleIds) await this.db.executeProcedure("sp_club_modules_assign", { p_ClubId: clubId, p_ModuleId: moduleId, p_AssignedBy: assignedBy });
  }

  async unassignClubModules(clubId: number, moduleIds: number[]) {
    for (const moduleId of moduleIds) await this.db.executeProcedure("sp_club_modules_unassign", { p_ClubId: clubId, p_ModuleId: moduleId });
  }

  /** Clubs with no module rows at all get the club defaults. */
  async bulkAssignClubDefaultsToEmptyClubs(assignedBy: number): Promise<{ clubsTouched: number; rowsInserted: number }> {
    return this.db.session(async (conn) => {
      const clubsTouched = Number(
        await conn.executeScalar(
          `SELECT COUNT(*) FROM club_master c
           WHERE c.isdeleted = 0
             AND NOT EXISTS (SELECT 1 FROM club_modules cm WHERE cm.fk_club_id = c.pk_club_id)`,
        ),
      );
      if (clubsTouched === 0) return { clubsTouched: 0, rowsInserted: 0 };
      const rowsInserted = await conn.execute(
        `INSERT IGNORE INTO club_modules (fk_club_id, fk_module_id, IsEnabled, AssignedBy)
         SELECT c.pk_club_id, m.pk_module_id, 1, @AssignedBy
         FROM club_master c
         CROSS JOIN module_master m
         WHERE c.isdeleted = 0
           AND m.IsDefaultForClub = 1
           AND m.ModuleLevel IN ('Club', 'Both')
           AND m.IsActive = 1
           AND m.isdeleted = 0
           AND NOT EXISTS (SELECT 1 FROM club_modules cm WHERE cm.fk_club_id = c.pk_club_id)`,
        { AssignedBy: assignedBy },
      );
      return { clubsTouched, rowsInserted };
    });
  }

  private async memberDefaultKeys(conn: DbCommands): Promise<Set<string>> {
    const rows = await conn.query("SELECT ModuleKey FROM module_master WHERE IsDefaultForMember = 1 AND IsActive = 1 AND isdeleted = 0");
    return new Set(rows.map((r) => String(r.ModuleKey).toLowerCase()));
  }

  /** The district dashboard: all enabled modules for its admins (and SuperAdmin), member defaults for everyone else. */
  async getDistrictDashboardForMember(districtId: number, memberId: number) {
    return this.db.session(async (conn) => {
      const district = (await conn.callProcedure("sp_district_dashboard_get", { p_DistrictId: districtId }))[0];
      if (!district) return null;
      const isAdmin =
        Number(
          await conn.executeScalar(
            `SELECT COUNT(*) FROM member_roles mr
             JOIN roles r ON r.pk_role_id = mr.fk_role_id
             WHERE mr.fk_member_master_profile_id = @MemberId
               AND r.RoleName IN ('Admin','SuperAdmin')
               AND mr.IsActive = 1 AND mr.isdeleted = 0
               AND (r.RoleName = 'SuperAdmin' OR mr.fk_district_id = @DistrictId)`,
            { MemberId: memberId, DistrictId: districtId },
          ),
        ) > 0;
      let modules = await this.queryDistrictModules(conn, districtId);
      if (!isAdmin) {
        const keys = await this.memberDefaultKeys(conn);
        modules = modules.filter((m) => keys.has(String(m.moduleKey).toLowerCase()));
      }
      const zonalAwardsEnabled = await conn.executeScalar(
        `SELECT z.IsZonalAwardsEnabled FROM zone_master z
         JOIN district_master d ON d.fk_zone_id = z.pk_zone_id
         WHERE d.pk_district_id = @DistrictId AND d.isdeleted = 0 AND z.isdeleted = 0`,
        { DistrictId: districtId },
      );
      const zonalOn = zonalAwardsEnabled === true || Number(zonalAwardsEnabled) === 1;
      modules = modules.filter((m) => m.moduleKey !== "zonal_awards" || zonalOn);
      return DistrictDashboardDto.create({
        DistrictId: Number(district.Id),
        DistrictNumber: district.DistrictNumber,
        DistrictLogoPath: district.DistrictLogoPath ?? null,
        ModuleGroups: groupForDashboard(modules),
      });
    });
  }

  async getClubDashboardForMember(clubId: number, memberId: number) {
    return this.db.session(async (conn) => {
      const club = (await conn.callProcedure("sp_club_dashboard_get", { p_ClubId: clubId }))[0];
      if (!club) return null;
      const isAdmin =
        Number(
          await conn.executeScalar(
            `SELECT COUNT(*) FROM member_roles mr
             JOIN roles r ON r.pk_role_id = mr.fk_role_id
             WHERE mr.fk_member_master_profile_id = @MemberId
               AND r.RoleName IN ('Admin','SuperAdmin')
               AND mr.IsActive = 1 AND mr.isdeleted = 0
               AND (r.RoleName = 'SuperAdmin' OR mr.fk_club_id = @ClubId)`,
            { MemberId: memberId, ClubId: clubId },
          ),
        ) > 0;
      let modules = await this.queryClubModules(conn, clubId);
      if (!isAdmin) {
        const keys = await this.memberDefaultKeys(conn);
        modules = modules.filter((m) => keys.has(String(m.moduleKey).toLowerCase()));
      }
      return ClubDashboardDto.create({
        ClubId: Number(club.Id),
        ClubName: club.ClubName,
        ClubLogoPath: club.ClubLogoPath ?? null,
        DistrictNumber: club.DistrictNumber,
        ModuleGroups: groupForDashboard(modules),
      });
    });
  }

  async uploadIcon(file: UploadedFile): Promise<string> {
    return `/uploads/module/${await saveWithGuidName(this.config, file, "uploads", "module")}`;
  }

  async getModulesComingSoon() {
    return ModuleComingSoonDto.mapAll(
      await this.db.query(
        `SELECT pk_module_id AS ModuleId, ModuleKey, ModuleName,
                IFNULL(IsComingSoon, 0) AS IsComingSoon, ComingSoonDate
         FROM module_master
         WHERE isdeleted = 0
         ORDER BY SortOrder, ModuleName`,
      ),
    );
  }

  async updateModuleComingSoon(moduleId: number, isComingSoon: boolean, comingSoonDate: string | null, modifiedBy: number) {
    await this.db.execute(
      `UPDATE module_master
       SET IsComingSoon = @IsComingSoon, ComingSoonDate = @ComingSoonDate, modified_by = @ModifiedBy, modified_date = NOW()
       WHERE pk_module_id = @Id AND isdeleted = 0`,
      { Id: moduleId, IsComingSoon: isComingSoon ? 1 : 0, ComingSoonDate: isComingSoon ? dbDateTime(comingSoonDate) : null, ModifiedBy: modifiedBy },
    );
  }
}
