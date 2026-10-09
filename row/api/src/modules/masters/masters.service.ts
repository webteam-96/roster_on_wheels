import { Injectable } from "@nestjs/common";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { defineDto } from "../../common/dto";
import { pagedResult } from "../../common/paged";
import { saveWithGuidName, type UploadedFile } from "../../services/media-storage";

const str = { type: "string" as const, default: () => "" };
const scalar = (rows: Row[]) => Number(Object.values(rows[0] ?? {})[0] ?? 0);

export const FundingDto = defineDto({ Id: "int", Name: str, SortOrder: "int", IsActive: "bool" });
export const SaveFundingDto = defineDto({ Name: str, SortOrder: "int", IsActive: { type: "bool", default: () => true } });
export const PotentialMemberDto = defineDto({ Id: "int", ClubId: "int", Name: str, Email: "string", MobileNumber: "string", ReferenceDetails: "string" });
export const SavePotentialMemberDto = defineDto({ Name: str, Email: "string", MobileNumber: "string", ReferenceDetails: "string" });
export type SavePotentialMember = { name: string; email: string | null; mobileNumber: string | null; referenceDetails: string | null };
export const SystemSettingDto = defineDto({ Id: "int", SettingKey: str, SettingValue: str, Description: "string", ModifiedBy: "int?", ModifiedDate: "datetime?" });
export const UpsertSettingDto = defineDto({ SettingKey: str, SettingValue: str, Description: "string" });
export const ThemeDto = defineDto({ Id: "int", ThemeName: str, ThemeImagePath: "string", Description: "string" });
export const SaveThemeDto = defineDto({ ThemeName: str, ThemeImagePath: "string", Description: "string" });
export type SaveTheme = { themeName: string; themeImagePath: string | null; description: string | null };

const GREETING_FIELDS = {
  BirthdayGreeting: "string", IsEnableBirthdayNotification: "bool", AnniversaryGreeting: "string", IsEnableAnniversaryNotification: "bool",
  IsGreetingSendWhatsapp: "bool",
} as const;
const GREETING_EMAIL_FIELDS = {
  IsEnableBirthdayEmail: "bool", BirthdayEmailFrom: "string", BirthdayEmailSubject: "string", BirthdayEmailMessage: "string",
  IsEnableAnniversaryEmail: "bool", AnniversaryEmailFrom: "string", AnniversaryEmailSubject: "string", AnniversaryEmailMessage: "string",
} as const;
const PAUSE_FIELDS = { IsGreetingPaused: "bool", GreetingReviewedYearLabel: "string", CurrentYearLabel: "string" } as const;
export const GreetingSettingsDto = defineDto({ ...PAUSE_FIELDS, ...GREETING_FIELDS, ...GREETING_EMAIL_FIELDS });
export const UpdateGreetingSettingsDto = defineDto({ ...GREETING_FIELDS, ...GREETING_EMAIL_FIELDS });
export const DistrictGreetingSettingsDto = defineDto({ ...PAUSE_FIELDS, ...GREETING_FIELDS, IsGreetingSendEmail: "bool", IsGreetingSendPush: "bool", ...GREETING_EMAIL_FIELDS });
export const UpdateDistrictGreetingSettingsDto = defineDto({ ...GREETING_FIELDS, IsGreetingSendEmail: "bool", IsGreetingSendPush: "bool", ...GREETING_EMAIL_FIELDS });

const CURRENT_YEAR_ID = "(SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1)";
/** PascalCase parameters from a camelCase DTO object. */
const pascal = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k[0].toUpperCase() + k.slice(1), typeof v === "boolean" ? (v ? 1 : 0) : v]));

/**
 * Ports of FundingService.cs, PotentialMemberService.cs, SystemSettingService.cs,
 * ThemeService.cs and GreetingService.cs.
 */
@Injectable()
export class MastersService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  // ---- funding ----
  async getFunding() {
    return FundingDto.mapAll(await this.db.callProcedure("sp_funding_get_all"));
  }
  async getFundingById(id: number) {
    return FundingDto.map((await this.db.callProcedure("sp_funding_get_by_id", { p_Id: id }))[0] ?? null);
  }
  async createFunding(name: string, sortOrder: number, isActive: boolean, by: number) {
    return scalar(await this.db.callProcedure("sp_funding_create", { p_Name: name, p_SortOrder: sortOrder, p_IsActive: isActive, p_CreatedBy: by }));
  }
  async updateFunding(id: number, name: string, sortOrder: number, isActive: boolean, by: number) {
    await this.db.executeProcedure("sp_funding_update", { p_Id: id, p_Name: name, p_SortOrder: sortOrder, p_IsActive: isActive, p_ModifiedBy: by });
  }
  async deleteFunding(id: number, by: number) {
    await this.db.executeProcedure("sp_funding_delete", { p_Id: id, p_DeletedBy: by });
  }

  // ---- potential members ----
  async getPotentialMembers(clubId: number, page: number, pageSize: number, search: string | null) {
    const sets = await this.db.callProcedureMultiple("sp_potential_member_get_by_club", {
      p_ClubId: clubId, p_Search: search && search.trim() ? search : null, p_PageSize: pageSize, p_Offset: (page - 1) * pageSize,
    });
    return pagedResult(PotentialMemberDto.mapAll(sets[0] ?? []), scalar(sets[1] ?? []), page, pageSize);
  }
  async getPotentialMember(id: number) {
    return PotentialMemberDto.map((await this.db.callProcedure("sp_potential_member_get_by_id", { p_Id: id }))[0] ?? null);
  }
  async createPotentialMember(clubId: number, dto: SavePotentialMember, by: number) {
    return Number(
      await this.db.executeScalar(
        `INSERT INTO potential_members
             (fk_club_id, name, email, mobile_number, reference_details,
              created_by, fk_member_master_profile_id_as_referrer)
         VALUES (@ClubId, @Name, @Email, @MobileNumber, @ReferenceDetails,
                 @CreatedBy, @CreatedBy);
         SELECT LAST_INSERT_ID();`,
        { ClubId: clubId, Name: dto.name, Email: dto.email, MobileNumber: dto.mobileNumber, ReferenceDetails: dto.referenceDetails, CreatedBy: by },
      ),
    );
  }
  async updatePotentialMember(id: number, dto: SavePotentialMember, by: number) {
    await this.db.executeProcedure("sp_potential_member_update", {
      p_Id: id, p_Name: dto.name, p_Email: dto.email, p_MobileNumber: dto.mobileNumber, p_ReferenceDetails: dto.referenceDetails, p_ModifiedBy: by,
    });
  }
  async deletePotentialMember(id: number, by: number) {
    await this.db.executeProcedure("sp_potential_member_delete", { p_Id: id, p_DeletedBy: by });
  }

  // ---- system settings ----
  async getSetting(key: string) {
    return SystemSettingDto.map((await this.db.callProcedure("sp_setting_get_by_key", { p_Key: key }))[0] ?? null);
  }
  async upsertSetting(key: string, value: string, description: string | null, by: number) {
    await this.db.executeProcedure("sp_setting_upsert", { p_Key: key, p_Value: value, p_Description: description, p_ModifiedBy: by });
  }
  async getAllSettings() {
    return SystemSettingDto.mapAll(await this.db.callProcedure("sp_setting_get_all"));
  }

  // ---- themes ----
  async getThemes() {
    return ThemeDto.mapAll(
      await this.db.query(
        `SELECT pk_theme_id       AS Id,
                theme_name        AS ThemeName,
                CASE
                    WHEN theme_image_path IS NULL OR theme_image_path = '' THEN NULL
                    WHEN theme_image_path LIKE '/%' THEN theme_image_path
                    ELSE CONCAT('/uploads/theme/', theme_image_path)
                END               AS ThemeImagePath,
                description       AS Description
         FROM theme_master
         WHERE isdeleted = 0 OR isdeleted IS NULL
         ORDER BY pk_theme_id`,
      ),
    );
  }
  async createTheme(dto: SaveTheme, by: number) {
    return Number(
      await this.db.executeScalar(
        `INSERT INTO theme_master (theme_name, theme_image_path, description, created_by, created_date)
         VALUES (@ThemeName, @ThemeImagePath, @Description, @CreatedBy, NOW());
         SELECT LAST_INSERT_ID();`,
        { ThemeName: dto.themeName.trim(), ThemeImagePath: dto.themeImagePath, Description: dto.description && dto.description.trim() ? dto.description.trim() : null, CreatedBy: by },
      ),
    );
  }
  async updateTheme(id: number, dto: SaveTheme, by: number) {
    await this.db.execute(
      `UPDATE theme_master
       SET theme_name = @ThemeName, theme_image_path = @ThemeImagePath, description = @Description,
           modified_by = @ModifiedBy, modified_date = NOW()
       WHERE pk_theme_id = @Id AND (isdeleted = 0 OR isdeleted IS NULL)`,
      { Id: id, ThemeName: dto.themeName.trim(), ThemeImagePath: dto.themeImagePath, Description: dto.description && dto.description.trim() ? dto.description.trim() : null, ModifiedBy: by },
    );
  }
  async deleteTheme(id: number, by: number) {
    await this.db.execute("UPDATE theme_master SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW() WHERE pk_theme_id = @Id", { Id: id, DeletedBy: by });
  }
  uploadThemeImage(file: UploadedFile) {
    return saveWithGuidName(this.config, file, "uploads", "theme");
  }

  // ---- greetings ----

  /**
   * Greetings stay paused each new Rotary year until an admin reviews (saves)
   * them: paused when there is greeting text and it was last reviewed in
   * another year.
   */
  private static async pauseInfo(conn: DbCommands, table: "club_master" | "district_master", pk: string, id: number) {
    try {
      const row = await conn.queryFirstOrDefault(
        `SELECT (y.pk_year_id IS NOT NULL
                 AND COALESCE(t.GreetingReviewedYearId, 0) <> y.pk_year_id
                 AND (NULLIF(TRIM(t.BirthdayGreeting), '') IS NOT NULL OR NULLIF(TRIM(t.AnniversaryGreeting), '') IS NOT NULL
                      OR NULLIF(TRIM(t.BirthdayEmailMessage), '') IS NOT NULL OR NULLIF(TRIM(t.AnniversaryEmailMessage), '') IS NOT NULL)) AS IsPaused,
                ry.YearLabel AS ReviewedLabel, y.YearLabel AS CurrentLabel
         FROM \`${table}\` t
         LEFT JOIN (SELECT pk_year_id, YearLabel FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1) y ON 1 = 1
         LEFT JOIN rotary_year_master ry ON ry.pk_year_id = t.GreetingReviewedYearId
         WHERE t.\`${pk}\` = @Id
         LIMIT 1`,
        { Id: id },
      );
      if (!row) return { isGreetingPaused: false, greetingReviewedYearLabel: null, currentYearLabel: null };
      return { isGreetingPaused: Number(row.IsPaused ?? 0) !== 0, greetingReviewedYearLabel: row.ReviewedLabel ?? null, currentYearLabel: row.CurrentLabel ?? null };
    } catch {
      return { isGreetingPaused: false, greetingReviewedYearLabel: null, currentYearLabel: null };
    }
  }

  async getGreetingSettings(clubId: number) {
    return this.db.session(async (conn) => {
      const dto = GreetingSettingsDto.map((await conn.callProcedure("sp_greeting_get_settings", { p_ClubId: clubId }))[0] ?? null);
      if (dto) Object.assign(dto, await MastersService.pauseInfo(conn, "club_master", "pk_club_id", clubId));
      return dto;
    });
  }

  async updateGreetingSettings(clubId: number, dto: Record<string, unknown>, by: number) {
    await this.db.execute(
      `UPDATE club_master SET
           BirthdayGreeting = @BirthdayGreeting,
           IsEnableBirthdayNotification = @IsEnableBirthdayNotification,
           AnniversaryGreeting = @AnniversaryGreeting,
           IsEnableAnniversaryNotification = @IsEnableAnniversaryNotification,
           IsGreetingSendWhatsapp = @IsGreetingSendWhatsapp,
           IsEnableBirthdayEmail = @IsEnableBirthdayEmail,
           BirthdayEmailFrom = @BirthdayEmailFrom,
           BirthdayEmailSubject = @BirthdayEmailSubject,
           BirthdayEmailMessage = @BirthdayEmailMessage,
           IsEnableAnniversaryEmail = @IsEnableAnniversaryEmail,
           AnniversaryEmailFrom = @AnniversaryEmailFrom,
           AnniversaryEmailSubject = @AnniversaryEmailSubject,
           AnniversaryEmailMessage = @AnniversaryEmailMessage,
           GreetingReviewedYearId = ${CURRENT_YEAR_ID},
           modified_by = @ModifiedBy
       WHERE pk_club_id = @ClubId`,
      { ...pascal(dto), ClubId: clubId, ModifiedBy: by },
    );
  }

  async getDistrictGreetingSettings(districtId: number) {
    return this.db.session(async (conn) => {
      const dto = DistrictGreetingSettingsDto.map(
        await conn.queryFirstOrDefault(
          `SELECT BirthdayGreeting, IsEnableBirthdayNotification, AnniversaryGreeting, IsEnableAnniversaryNotification,
                  IsGreetingSendWhatsapp, IsGreetingSendEmail, IsGreetingSendPush,
                  IsEnableBirthdayEmail, BirthdayEmailFrom, BirthdayEmailSubject, BirthdayEmailMessage,
                  IsEnableAnniversaryEmail, AnniversaryEmailFrom, AnniversaryEmailSubject, AnniversaryEmailMessage
           FROM district_master
           WHERE pk_district_id = @DistrictId`,
          { DistrictId: districtId },
        ),
      );
      if (dto) Object.assign(dto, await MastersService.pauseInfo(conn, "district_master", "pk_district_id", districtId));
      return dto;
    });
  }

  async updateDistrictGreetingSettings(districtId: number, dto: Record<string, unknown>, by: number) {
    await this.db.execute(
      `UPDATE district_master SET
           BirthdayGreeting = @BirthdayGreeting, IsEnableBirthdayNotification = @IsEnableBirthdayNotification,
           AnniversaryGreeting = @AnniversaryGreeting, IsEnableAnniversaryNotification = @IsEnableAnniversaryNotification,
           IsGreetingSendWhatsapp = @IsGreetingSendWhatsapp, IsGreetingSendEmail = @IsGreetingSendEmail,
           IsGreetingSendPush = @IsGreetingSendPush,
           IsEnableBirthdayEmail = @IsEnableBirthdayEmail, BirthdayEmailFrom = @BirthdayEmailFrom,
           BirthdayEmailSubject = @BirthdayEmailSubject, BirthdayEmailMessage = @BirthdayEmailMessage,
           IsEnableAnniversaryEmail = @IsEnableAnniversaryEmail, AnniversaryEmailFrom = @AnniversaryEmailFrom,
           AnniversaryEmailSubject = @AnniversaryEmailSubject, AnniversaryEmailMessage = @AnniversaryEmailMessage,
           GreetingReviewedYearId = ${CURRENT_YEAR_ID},
           modified_by = @ModifiedBy
       WHERE pk_district_id = @DistrictId`,
      { ...pascal(dto), DistrictId: districtId, ModifiedBy: by },
    );
  }
}
