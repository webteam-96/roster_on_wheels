import { notRotaract } from "../../services/club-scope.helper";
import { Injectable } from "@nestjs/common";
import { Db } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { pagedResult } from "../../common/paged";
import { normalizeCurrency } from "../../services/currency.helper";
import { saveWithGuidName, type UploadedFile } from "../../services/media-storage";
import { DistrictDetailDto, DistrictListDto, DistrictMemberDto, type SaveDistrict } from "../../dtos/district.dtos";
import { ClubListDto } from "../../dtos/club.dtos";

const blankToNull = (s: string | null | undefined) => (s && s.trim() ? s : null);

const LOGO = `CASE
    WHEN d.DistrictLogoPath IS NULL OR d.DistrictLogoPath = '' THEN NULL
    WHEN d.DistrictLogoPath LIKE '/%' THEN d.DistrictLogoPath
    ELSE CONCAT('/uploads/district/', d.DistrictLogoPath)
  END AS DistrictLogoPath`;

const TOTALS = `(SELECT COUNT(*) FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.isdeleted = 0 AND COALESCE(c.ClubType,'') <> 'Rotaract Club') AS TotalClubs,
  (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
   FROM club_members cm
   JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0
   JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
   WHERE c2.fk_district_id = d.pk_district_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0) AS TotalMembers`;

const CLUB_COLUMNS = `c.pk_club_id AS Id,
  c.fk_district_id AS FkDistrictId,
  c.ClubRotaryId,
  c.ClubName,
  CASE
      WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
      WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
      ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
  END AS ClubLogoPath,
  c.MeetingDay,
  c.City,
  c.State,
  c.IsActive,
  (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0 AND COALESCE(cm.IsHonoraryMember,0) = 0) AS TotalMembers,
  (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0 AND COALESCE(cm.IsHonoraryMember,0) = 1) AS HonoraryMembers`;

const MEMBER_SEARCH = `(@Search IS NULL
     OR m.MemberName LIKE CONCAT('%', @Search, '%')
     OR m.EmailId LIKE CONCAT('%', @Search, '%')
     OR m.PrimaryMobileNumber LIKE CONCAT('%', @Search, '%')
     OR m.RotaryId LIKE CONCAT('%', @Search, '%'))`;

/** Port of DistrictService.cs. */
@Injectable()
export class DistrictService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  async getAll(page: number, pageSize: number, search: string | null, isActive: number | null, zoneId: number | null, hasClubs: boolean | null, hasMembers: boolean | null, hasSyncClubs: boolean | null) {
    let hasClubsClause = "";
    if (hasSyncClubs === true) {
      hasClubsClause = " AND EXISTS (SELECT 1 FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.isdeleted = 0 AND IFNULL(c.IsSyncedFromRotaryOrg,0) = 1)";
    } else if (hasMembers === true) {
      hasClubsClause = ` AND EXISTS (
          SELECT 1 FROM club_master c
          WHERE c.fk_district_id = d.pk_district_id AND c.isdeleted = 0
            AND EXISTS (SELECT 1 FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0)
      )`;
    } else if (hasClubs === true) {
      hasClubsClause = " AND EXISTS (SELECT 1 FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.isdeleted = 0)";
    }
    const where = `WHERE d.isdeleted = 0
        AND (@Search IS NULL OR d.DistrictNumber LIKE CONCAT('%', @Search, '%'))
        AND (@IsActive IS NULL OR d.IsActive = @IsActive)
        AND (@ZoneId IS NULL OR d.fk_zone_id = @ZoneId)${hasClubsClause}`;
    const params = { Search: blankToNull(search), IsActive: isActive, ZoneId: zoneId, PageSize: pageSize, Offset: (page - 1) * pageSize };
    return this.db.session(async (conn) => {
      const totalCount = Number(await conn.executeScalar(`SELECT COUNT(*) FROM district_master d ${where}`, params));
      const items = DistrictListDto.mapAll(
        await conn.query(
          `SELECT d.pk_district_id AS Id, d.DistrictNumber, ${LOGO}, d.IsActive, d.created_date AS CreatedDate,
                  d.fk_zone_id AS FkZoneId, z.ZoneName, d.Country, d.DefaultCurrency, ${TOTALS}
           FROM district_master d
           LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0
           ${where}
           ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber
           LIMIT @PageSize OFFSET @Offset`,
          params,
        ),
      );
      return pagedResult(items, totalCount, page, pageSize);
    });
  }

  async getById(id: number) {
    return DistrictDetailDto.map(
      await this.db.queryFirstOrDefault(
        `SELECT d.pk_district_id AS Id, d.DistrictNumber, ${LOGO}, d.IsActive,
                d.created_by AS CreatedBy, d.created_date AS CreatedDate, d.modified_by AS ModifiedBy, d.modified_date AS ModifiedDate,
                d.fk_zone_id AS FkZoneId, z.ZoneName, d.Country, d.DefaultCurrency, ${TOTALS}
         FROM district_master d
         LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0
         WHERE d.pk_district_id = @Id AND d.isdeleted = 0`,
        { Id: id },
      ),
    );
  }

  private values(dto: SaveDistrict) {
    return {
      DistrictNumber: dto.districtNumber.trim(),
      DistrictLogoPath: dto.districtLogoPath,
      IsActive: dto.isActive ? 1 : 0,
      FkZoneId: dto.fkZoneId && dto.fkZoneId !== 0 ? dto.fkZoneId : null,
      Country: blankToNull(dto.country)?.trim() ?? null,
      DefaultCurrency: normalizeCurrency(dto.defaultCurrency),
    };
  }

  async create(dto: SaveDistrict, createdBy: number): Promise<number> {
    return this.db.session(async (conn) => {
      const districtId = Number(
        await conn.executeScalar(
          `INSERT INTO district_master
               (DistrictNumber, DistrictLogoPath, IsActive, fk_zone_id, Country, DefaultCurrency, created_by, created_date, isdeleted)
           VALUES
               (@DistrictNumber, @DistrictLogoPath, @IsActive, @FkZoneId, @Country, @DefaultCurrency, @CreatedBy, NOW(), 0);
           SELECT LAST_INSERT_ID();`,
          { ...this.values(dto), CreatedBy: createdBy },
        ),
      );
      await conn.executeProcedure("sp_district_modules_assign_defaults", { p_DistrictId: districtId, p_AssignedBy: createdBy });
      return districtId;
    });
  }

  async update(id: number, dto: SaveDistrict, modifiedBy: number): Promise<void> {
    await this.db.session(async (conn) => {
      await conn.execute(
        `UPDATE district_master SET
             DistrictNumber = @DistrictNumber,
             DistrictLogoPath = @DistrictLogoPath,
             IsActive = @IsActive,
             fk_zone_id = @FkZoneId,
             Country = @Country,
             DefaultCurrency = @DefaultCurrency,
             modified_by = @ModifiedBy,
             modified_date = NOW()
         WHERE pk_district_id = @Id AND isdeleted = 0`,
        { ...this.values(dto), Id: id, ModifiedBy: modifiedBy },
      );
      await conn.executeProcedure("sp_district_modules_assign_defaults", { p_DistrictId: id, p_AssignedBy: modifiedBy });
    });
  }

  async updateDefaultCurrency(id: number, defaultCurrency: string | null, modifiedBy: number): Promise<void> {
    await this.db.execute(
      `UPDATE district_master
       SET DefaultCurrency = @DefaultCurrency, modified_by = @ModifiedBy, modified_date = NOW()
       WHERE pk_district_id = @Id AND isdeleted = 0`,
      { Id: id, DefaultCurrency: normalizeCurrency(defaultCurrency), ModifiedBy: modifiedBy },
    );
  }

  async delete(id: number, deletedBy: number): Promise<void> {
    await this.db.executeProcedure("sp_district_soft_delete", { p_Id: id, p_DeletedBy: deletedBy });
  }

  async getClubs(districtId: number, hasMembers: boolean | null) {
    const onlyWithMembers = hasMembers === true
      ? "AND EXISTS (SELECT 1 FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0)"
      : "";
    return ClubListDto.mapAll(
      await this.db.query(
        `SELECT ${CLUB_COLUMNS}
         FROM club_master c
         WHERE c.fk_district_id = @DistrictId
           AND c.isdeleted = 0
           ${onlyWithMembers}
           AND ${notRotaract("c")}
         ORDER BY c.ClubName`,
        { DistrictId: districtId },
      ),
    );
  }

  async getMembers(districtId: number, page: number, pageSize: number, search: string | null) {
    const params = { DistrictId: districtId, Search: blankToNull(search), PageSize: pageSize, Offset: (page - 1) * pageSize };
    const countSql = `SELECT COUNT(*)
      FROM member_master_profile m
      JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
      JOIN club_master c ON c.pk_club_id = cm.fk_club_id
      WHERE c.fk_district_id = @DistrictId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
        AND ${MEMBER_SEARCH}`;
    return this.db.session(async (conn) => {
      const totalCount = Number(await conn.executeScalar(countSql, params));
      const honoraryCount = Number(await conn.executeScalar(countSql + " AND COALESCE(cm.IsHonoraryMember, 0) = 1", params));
      const rows = await conn.query(
        `SELECT m.pk_member_master_profile_id AS Id, m.MemberName,
                CASE
                    WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                    WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                    ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                END AS ProfilePhotoPath,
                m.EmailId, m.PrimaryMobileNumber, m.RotaryId, cm.JoinedDate,
                c.ClubName,
                GROUP_CONCAT(DISTINCT
                  CASE
                    WHEN r.RoleName = 'Admin' AND mr.fk_district_id > 0 AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0) THEN 'District Admin'
                    WHEN r.RoleName = 'Admin' AND mr.fk_club_id > 0 THEN 'Club Admin'
                    WHEN r.RoleName = 'Admin' AND (mr.fk_district_id IS NULL OR mr.fk_district_id = 0) AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0) THEN 'Admin'
                    ELSE r.RoleName
                  END ORDER BY r.RoleName SEPARATOR ',') AS RoleNames,
                MAX(CASE WHEN mr.fk_role_id = 2 AND mr.fk_district_id = @DistrictId AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0) AND mr.IsActive = 1 AND mr.isdeleted = 0 THEN 1 ELSE 0 END) AS HasDistrictAdminRole,
                MAX(CASE WHEN mr.fk_role_id = 2 AND mr.fk_district_id = @DistrictId AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0) AND mr.AllClubsAccess = 1 AND mr.IsActive = 1 AND mr.isdeleted = 0 THEN 1 ELSE 0 END) AS AllClubsAccess,
                MAX(CASE WHEN mr.fk_role_id = 2 AND mr.fk_club_id > 0 AND mr.IsActive = 1 AND mr.isdeleted = 0 THEN 1 ELSE 0 END) AS HasClubAdminRole,
                MAX(CASE WHEN r.RoleName = 'SuperAdmin' AND mr.IsActive = 1 AND mr.isdeleted = 0 THEN 1 ELSE 0 END) AS IsSuperAdmin
         FROM member_master_profile m
         JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
         JOIN club_master c ON c.pk_club_id = cm.fk_club_id
         LEFT JOIN member_roles mr ON mr.fk_member_master_profile_id = m.pk_member_master_profile_id
             AND mr.IsActive = 1 AND mr.isdeleted = 0
             AND (
                 (mr.fk_role_id = 2 AND mr.fk_club_id = c.pk_club_id)
                 OR (mr.fk_role_id = 2 AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0) AND mr.fk_district_id = c.fk_district_id)
                 OR mr.fk_role_id != 2
             )
         LEFT JOIN roles r ON r.pk_role_id = mr.fk_role_id
         WHERE c.fk_district_id = @DistrictId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
           AND ${MEMBER_SEARCH}
         GROUP BY m.pk_member_master_profile_id, m.MemberName, m.ProfilePhotoPath,
                  m.EmailId, m.PrimaryMobileNumber, m.RotaryId, cm.JoinedDate, c.ClubName
         ORDER BY
             CASE
                 WHEN MAX(CASE WHEN mr.fk_role_id = 2 AND mr.fk_district_id = @DistrictId AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0) AND mr.IsActive = 1 AND mr.isdeleted = 0 THEN 1 ELSE 0 END) = 1 THEN 0
                 WHEN MAX(CASE WHEN mr.fk_role_id = 2 AND mr.fk_club_id > 0 AND mr.IsActive = 1 AND mr.isdeleted = 0 THEN 1 ELSE 0 END) = 1 THEN 1
                 WHEN m.PrimaryMobileNumber IS NULL OR m.PrimaryMobileNumber = '' THEN 2
                 ELSE 3
             END,
             m.MemberName
         LIMIT @PageSize OFFSET @Offset`,
        params,
      );
      const items = rows.map((row) =>
        DistrictMemberDto.create({
          Id: row.Id,
          MemberName: row.MemberName ?? "",
          ProfilePhotoPath: row.ProfilePhotoPath,
          EmailId: row.EmailId ?? "",
          PrimaryMobileNumber: row.PrimaryMobileNumber ?? "",
          RotaryId: row.RotaryId ?? "",
          JoinedDate: row.JoinedDate,
          ClubName: row.ClubName ?? "",
          ClubNames: row.ClubName ?? "",
          RoleNames: row.RoleNames,
          HasDistrictAdminRole: Number(row.HasDistrictAdminRole ?? 0) === 1,
          AllClubsAccess: Number(row.AllClubsAccess ?? 0) === 1,
          HasClubAdminRole: Number(row.HasClubAdminRole ?? 0) === 1,
          IsSuperAdmin: Number(row.IsSuperAdmin ?? 0) === 1,
          Roles: row.RoleNames ? String(row.RoleNames).split(",") : [],
        }),
      );
      return pagedResult(items, totalCount, page, pageSize, { honoraryCount, memberCount: totalCount - honoraryCount });
    });
  }

  uploadLogo(file: UploadedFile): Promise<string> {
    return saveWithGuidName(this.config, file, "uploads", "district");
  }
}
