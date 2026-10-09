import { Injectable, Logger } from "@nestjs/common";
import { Db, type DbCommands } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { pagedResult } from "../../common/paged";
import { InvalidOperationException } from "../../common/exceptions";
import { dbDate, dbDateTime, dbTime } from "../../common/binding";
import { EmailService } from "../../services/email.service";
import { DcAutoGroupService } from "../../services/dc-auto-group.service";
import { saveWithGuidName, type UploadedFile } from "../../services/media-storage";
import { composeCogDesignation, cogClubId, cogDistrictSql, cogYearStartSql, isCog, toRotaryYearLabel } from "../../services/cog-designation.helper";
import { shouldShowEmail, shouldShowPhone, viewerSharesClub } from "../../services/member-privacy.helper";
import {
  BodEntry, ClubDetailDto, ClubListDto, ClubMemberDto, DcCommitteeEntry, DcGroupEntry, DcSubGroupEntry,
  MemberRemovalPreviewDto, OtherClubInfo, TerminatedMemberDto,
} from "../../dtos/club.dtos";

const blankToNull = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

export interface SaveClub {
  fkDistrictId: number; clubRotaryId: string; clubName: string; timezone: string | null; clubCharterDate: string | null;
  clubLogoPath: string | null; clubWebsite: string | null; meetingDay: string | null; meetingFromTime: string | null; meetingToTime: string | null;
  meetingAddress: string | null; country: string | null; state: string | null; city: string | null; pincode: string | null;
  latitude: number | null; longitude: number | null; activeFromDate: string | null; activeToDate: string | null;
  isAutomaticMeetingReminder: boolean; isFamilyLogin: boolean; isActive: boolean;
}

const LOGO_COLUMN = `CASE
    WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
    WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
    ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
  END AS ClubLogoPath`;

const MEMBER_COUNT = (honorary: 0 | 1) => `(SELECT COUNT(*) FROM club_members cm
    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
    WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
      AND cm.IsHonoraryMember = ${honorary})`;

/** Port of ClubService.cs. */
@Injectable()
export class ClubService {
  private readonly log = new Logger("ClubService");

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly email: EmailService,
    private readonly dcAutoGroups: DcAutoGroupService,
  ) {}

  async getAll(page: number, pageSize: number, search: string | null, districtId: number | null, city: string | null, meetingDay: string | null, isActive: number | null, zoneId: number | null) {
    const where = `c.isdeleted = 0
        AND (@Search IS NULL
             OR c.ClubName    LIKE CONCAT('%', @Search, '%')
             OR c.ClubRotaryId LIKE CONCAT('%', @Search, '%')
             OR c.City        LIKE CONCAT('%', @Search, '%')
             OR c.State       LIKE CONCAT('%', @Search, '%'))
        AND (@DistrictId IS NULL OR c.fk_district_id = @DistrictId)
        AND (@City IS NULL OR c.City = @City)
        AND (@MeetingDay IS NULL OR c.MeetingDay = @MeetingDay)
        AND (@IsActive IS NULL OR c.IsActive = @IsActive)
        AND (@ZoneId IS NULL OR d.fk_zone_id = @ZoneId)`;
    const params = {
      Search: search && search.trim() ? search : null, DistrictId: districtId, City: city && city.trim() ? city : null,
      MeetingDay: meetingDay && meetingDay.trim() ? meetingDay : null, IsActive: isActive, ZoneId: zoneId,
      PageSize: pageSize, Offset: (page - 1) * pageSize,
    };
    return this.db.session(async (conn) => {
      const totalCount = Number(await conn.executeScalar(`SELECT COUNT(*) FROM club_master c JOIN district_master d ON d.pk_district_id = c.fk_district_id WHERE ${where}`, params));
      const items = ClubListDto.mapAll(
        await conn.query(
          `SELECT c.pk_club_id AS Id, c.fk_district_id AS FkDistrictId,
                  d.DistrictNumber AS DistrictNumber,
                  c.ClubRotaryId AS ClubRotaryId, c.ClubName AS ClubName,
                  ${LOGO_COLUMN},
                  c.MeetingDay AS MeetingDay,
                  c.MeetingFromTime AS MeetingFromTime,
                  c.MeetingToTime AS MeetingToTime,
                  c.City AS City, c.State AS State,
                  c.IsActive AS IsActive,
                  c.created_date AS CreatedDate,
                  COALESCE(c.IsSyncedFromRotaryOrg, 0) AS IsSyncedFromRotaryOrg,
                  cw.Subdomain      AS WebsiteSubdomain,
                  cw.ClientDomain   AS WebsiteClientDomain,
                  cw.EndDate        AS WebsiteEndDate,
                  cw.Status         AS WebsiteStatus,
                  ${MEMBER_COUNT(0)} AS TotalMembers,
                  ${MEMBER_COUNT(1)} AS HonoraryMembers
           FROM club_master c
           JOIN district_master d ON d.pk_district_id = c.fk_district_id
           LEFT JOIN club_websites cw
               ON cw.fk_club_id = c.pk_club_id
              AND cw.isdeleted = 0
              AND cw.pk_id = (
                  SELECT MAX(cw2.pk_id) FROM club_websites cw2
                  WHERE cw2.fk_club_id = c.pk_club_id AND cw2.isdeleted = 0
              )
           WHERE ${where}
           ORDER BY c.ClubName
           LIMIT @PageSize OFFSET @Offset`,
          params,
        ),
      );
      return pagedResult(items, totalCount, page, pageSize);
    });
  }

  async getById(id: number) {
    return ClubDetailDto.map(
      await this.db.queryFirstOrDefault(
        `SELECT c.pk_club_id AS Id, c.fk_district_id AS FkDistrictId,
                d.DistrictNumber AS DistrictNumber, d.Country AS DistrictCountry, d.DefaultCurrency AS DistrictDefaultCurrency,
                c.ClubRotaryId AS ClubRotaryId, c.ClubName AS ClubName,
                c.Timezone AS Timezone, c.ClubCharterDate AS ClubCharterDate,
                ${LOGO_COLUMN}, c.ClubWebsite AS ClubWebsite,
                c.MeetingDay AS MeetingDay, c.MeetingFromTime AS MeetingFromTime,
                c.MeetingToTime AS MeetingToTime, c.MeetingAddress AS MeetingAddress,
                c.Country AS Country, c.State AS State, c.City AS City, c.Pincode AS Pincode,
                c.Latitude AS Latitude, c.Longitude AS Longitude,
                c.ActiveFromDate AS ActiveFromDate, c.ActiveToDate AS ActiveToDate,
                c.IsAutomaticMeetingReminder AS IsAutomaticMeetingReminder,
                c.IsFamilyLogin AS IsFamilyLogin, c.IsActive AS IsActive,
                c.created_by AS CreatedBy, c.created_date AS CreatedDate,
                c.modified_by AS ModifiedBy, c.modified_date AS ModifiedDate,
                ${MEMBER_COUNT(0)} AS TotalMembers,
                ${MEMBER_COUNT(1)} AS HonoraryMembers
         FROM club_master c
         JOIN district_master d ON d.pk_district_id = c.fk_district_id
         WHERE c.pk_club_id = @Id AND c.isdeleted = 0`,
        { Id: id },
      ),
    );
  }

  private values(dto: SaveClub) {
    return {
      FkDistrictId: dto.fkDistrictId,
      ClubRotaryId: dto.clubRotaryId.trim(),
      ClubName: dto.clubName.trim(),
      Timezone: blankToNull(dto.timezone) ?? Brand.Current.locale.defaultTimeZone,
      ClubCharterDate: dbDate(dto.clubCharterDate),
      ClubLogoPath: dto.clubLogoPath,
      ClubWebsite: dto.clubWebsite,
      MeetingDay: dto.meetingDay,
      MeetingFromTime: dbTime(dto.meetingFromTime),
      MeetingToTime: dbTime(dto.meetingToTime),
      MeetingAddress: dto.meetingAddress,
      Country: blankToNull(dto.country),
      State: dto.state,
      City: dto.city,
      Pincode: dto.pincode,
      Latitude: dto.latitude,
      Longitude: dto.longitude,
      ActiveFromDate: dbDateTime(dto.activeFromDate),
      ActiveToDate: dbDateTime(dto.activeToDate),
      IsAutomaticMeetingReminder: dto.isAutomaticMeetingReminder ? 1 : 0,
      IsFamilyLogin: dto.isFamilyLogin ? 1 : 0,
      IsActive: dto.isActive ? 1 : 0,
    };
  }

  private async checkDuplicate(conn: DbCommands, dto: SaveClub, excludeId: number | null) {
    const dup = (await conn.callProcedure("sp_club_check_duplicate", { p_ClubName: dto.clubName.trim(), p_ClubRotaryId: dto.clubRotaryId.trim(), p_ExcludeId: excludeId }))[0];
    if (!dup) throw new InvalidOperationException("Sequence contains no elements");
    if (Number(dup.NameDuplicate) > 0) throw new Error("A club with this name already exists.");
    if (Number(dup.RotaryIdDuplicate) > 0) throw new Error("A club with this Rotary ID already exists.");
  }

  async create(dto: SaveClub, createdBy: number): Promise<number> {
    return this.db.session(async (conn) => {
      await this.checkDuplicate(conn, dto, null);
      const clubId = Number(
        await conn.executeScalar(
          `INSERT INTO club_master (
               fk_district_id, ClubRotaryId, ClubName, Timezone, ClubCharterDate,
               ClubLogoPath, ClubWebsite, MeetingDay, MeetingFromTime, MeetingToTime,
               MeetingAddress, Country, State, City, Pincode,
               Latitude, Longitude,
               ActiveFromDate, ActiveToDate, IsAutomaticMeetingReminder, IsFamilyLogin,
               IsActive, created_by, created_date
           ) VALUES (
               @FkDistrictId, @ClubRotaryId, @ClubName, @Timezone, @ClubCharterDate,
               @ClubLogoPath, @ClubWebsite, @MeetingDay, @MeetingFromTime, @MeetingToTime,
               @MeetingAddress, @Country, @State, @City, @Pincode,
               @Latitude, @Longitude,
               @ActiveFromDate, @ActiveToDate, @IsAutomaticMeetingReminder, @IsFamilyLogin,
               @IsActive, @CreatedBy, NOW()
           );
           SELECT LAST_INSERT_ID();`,
          { ...this.values(dto), CreatedBy: createdBy },
        ),
      );
      await conn.executeProcedure("sp_club_modules_assign_defaults", { p_ClubId: clubId, p_AssignedBy: createdBy });
      return clubId;
    });
  }

  async update(id: number, dto: SaveClub, modifiedBy: number): Promise<void> {
    await this.db.session(async (conn) => {
      await this.checkDuplicate(conn, dto, id);
      const previousDistrictId = await conn.executeScalar<number>("SELECT fk_district_id FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0", { Id: id });
      await conn.execute(
        `UPDATE club_master SET
             fk_district_id = @FkDistrictId, ClubRotaryId = @ClubRotaryId, ClubName = @ClubName, Timezone = @Timezone,
             ClubCharterDate = @ClubCharterDate, ClubLogoPath = @ClubLogoPath, ClubWebsite = @ClubWebsite,
             MeetingDay = @MeetingDay, MeetingFromTime = @MeetingFromTime, MeetingToTime = @MeetingToTime,
             MeetingAddress = @MeetingAddress, Country = @Country, State = @State, City = @City, Pincode = @Pincode,
             Latitude = @Latitude, Longitude = @Longitude, ActiveFromDate = @ActiveFromDate, ActiveToDate = @ActiveToDate,
             IsAutomaticMeetingReminder = @IsAutomaticMeetingReminder, IsFamilyLogin = @IsFamilyLogin, IsActive = @IsActive,
             modified_by = @ModifiedBy, modified_date = NOW()
         WHERE pk_club_id = @Id AND isdeleted = 0`,
        { ...this.values(dto), Id: id, ModifiedBy: modifiedBy },
      );

      // Moved to another district: its President / Secretary leave the old district's
      // auto groups and join the new district's.
      if (previousDistrictId !== null && Number(previousDistrictId) !== dto.fkDistrictId) {
        try {
          await conn.execute(
            `UPDATE district_committee_group_member m
             JOIN district_committee_group g ON g.id = m.fk_group_id
             SET m.isdeleted = 1, m.modified_by = @By, m.modified_date = NOW()
             WHERE m.fk_club_id = @Id AND m.isdeleted = 0 AND g.fk_district_id <> @NewDistrictId
               AND g.isdeleted = 0
               AND (g.group_name = 'Club Presidents' OR g.group_name LIKE 'Club Presidents ____-__'
                 OR g.group_name = 'Club Secretaries' OR g.group_name LIKE 'Club Secretaries ____-__')`,
            { Id: id, By: modifiedBy, NewDistrictId: dto.fkDistrictId },
          );
          const holders = await conn.query(
            `SELECT b.fk_member_master_profile_id AS memberId, b.fk_designation_id AS designationId, b.fk_year_id AS yearId
             FROM board_of_directors b
             JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
             WHERE b.fk_club_id = @Id AND b.isdeleted = 0 AND b.fk_member_master_profile_id IS NOT NULL
               AND d.designation_name IN ('Club President', 'Club Secretary')`,
            { Id: id },
          );
          for (const h of holders) {
            await this.dcAutoGroups.onBodAddedOrUpdated(conn, id, Number(h.memberId), Number(h.designationId), Number(h.yearId), modifiedBy);
          }
        } catch (e) {
          this.log.error(`DC CP/CS move failed for club ${id} (district ${previousDistrictId} -> ${dto.fkDistrictId}): ${(e as Error).message}`);
        }
      }
      await conn.executeProcedure("sp_club_modules_assign_defaults", { p_ClubId: id, p_AssignedBy: modifiedBy });
    });
  }

  async delete(id: number, deletedBy: number): Promise<void> {
    await this.db.session(async (conn) => {
      await conn.executeProcedure("sp_club_soft_delete", { p_Id: id, p_DeletedBy: deletedBy });
      await conn.execute(
        `UPDATE district_committee_group_member m
         JOIN district_committee_group g ON g.id = m.fk_group_id
         SET m.isdeleted = 1, m.modified_by = @By, m.modified_date = NOW()
         WHERE m.fk_club_id = @Id AND m.isdeleted = 0 AND g.isdeleted = 0
           AND (g.group_name = 'Club Presidents' OR g.group_name LIKE 'Club Presidents ____-__'
             OR g.group_name = 'Club Secretaries' OR g.group_name LIKE 'Club Secretaries ____-__')`,
        { Id: id, By: deletedBy },
      );
      await conn.execute("DELETE FROM club_modules WHERE fk_club_id = @Id", { Id: id });
    });
  }

  async getMembers(
    clubId: number, page: number, pageSize: number, search: string | null, year: number | null,
    email: string | null, rotaryId: string | null, districtNumber: string | null, designation: string | null,
    classification: string | null, familyMemberName: string | null, viewerId: number | null,
  ) {
    const cog = cogClubId();
    const yearStart = cogYearStartSql("cm");
    const filters = `cm.fk_club_id = @ClubId
        AND cm.IsActive = 1
        AND cm.isdeleted = 0
        AND m.isdeleted = 0
        AND (@Search IS NULL
             OR m.MemberName LIKE CONCAT('%', @Search, '%')
             OR m.PrimaryMobileNumber LIKE CONCAT('%', @Search, '%'))
        AND (@Email IS NULL OR m.EmailId LIKE CONCAT('%', @Email, '%'))
        AND (@RotaryId IS NULL OR m.RotaryId LIKE CONCAT('%', @RotaryId, '%'))
        AND (@DistrictNumber IS NULL
             OR d.DistrictNumber LIKE CONCAT('%', @DistrictNumber, '%')
             OR cm.Designation LIKE CONCAT(@DistrictNumber, ' %'))
        AND (@Designation IS NULL OR cm.Designation LIKE CONCAT('%', @Designation, '%'))
        AND (@Classification IS NULL OR cm.ClassificationProfession LIKE CONCAT('%', @Classification, '%'))
        AND (@FamilyMemberName IS NULL OR EXISTS (
                 SELECT 1 FROM member_family_details fd
                 WHERE fd.fk_member_master_profile_id = m.pk_member_master_profile_id
                   AND fd.isdeleted = 0
                   AND fd.Name LIKE CONCAT('%', @FamilyMemberName, '%')
             ))
        AND (@Year IS NULL OR @ClubId <> @CogClubId
             OR ${yearStart} = CAST(@Year AS CHAR))`;
    const params = {
      ClubId: clubId, CogClubId: cog, Search: blankToNull(search), Year: year, Email: blankToNull(email), RotaryId: blankToNull(rotaryId),
      DistrictNumber: blankToNull(districtNumber), Designation: blankToNull(designation), Classification: blankToNull(classification),
      FamilyMemberName: blankToNull(familyMemberName), PageSize: pageSize, Offset: (page - 1) * pageSize,
    };
    return this.db.session(async (conn) => {
      const sharesClub = await viewerSharesClub(conn, viewerId, clubId);
      const totalCount = Number(
        await conn.executeScalar(
          `SELECT COUNT(DISTINCT m.pk_member_master_profile_id)
           FROM member_master_profile m
           JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
           LEFT JOIN club_master c ON c.pk_club_id = cm.fk_club_id
           LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
           WHERE ${filters}`,
          params,
        ),
      );
      const rows = await conn.query(
        `SELECT
             m.pk_member_master_profile_id AS Id,
             m.MemberName,
             CASE
                 WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                 WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                 ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
             END AS ProfilePhotoPath,
             m.EmailId, m.PrimaryMobileNumber,
             m.ShowPhoneInMyClub, m.ShowPhoneInAllClubs, m.ShowEmailInMyClub, m.ShowEmailInAllClubs,
             m.RotaryId, cm.JoinedDate,
             cm.pk_club_member_id AS ClubMemberId,
             cm.IsActive AS MembershipActive,
             cm.IsHonoraryMember AS IsHonorary,
             GROUP_CONCAT(DISTINCT
                 CASE
                     WHEN r.RoleName = 'Admin' AND mr.fk_district_id > 0 AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0) THEN 'District Admin'
                     WHEN r.RoleName = 'Admin' AND mr.fk_club_id > 0 THEN 'Club Admin'
                     ELSE r.RoleName
                 END
                 ORDER BY 1 SEPARATOR ',') AS RoleNames,
             MAX(CASE WHEN r.RoleName = 'Admin' AND mr.fk_club_id = @ClubId AND mr.IsActive = 1 THEN 1 ELSE 0 END) AS HasAdminRole,
             MAX(CASE WHEN @ClubId = @CogClubId THEN cm.Designation END) AS Designation,
             MAX(CASE WHEN @ClubId = @CogClubId THEN ${cogDistrictSql("cm")} END) AS CogDistrictNumber,
             MAX(CASE WHEN @ClubId = @CogClubId THEN ${yearStart} END) AS CogYearStart
         FROM member_master_profile m
         JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
         LEFT JOIN club_master c ON c.pk_club_id = cm.fk_club_id
         LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
         LEFT JOIN member_roles mr
             ON mr.fk_member_master_profile_id = m.pk_member_master_profile_id
             AND mr.IsActive = 1
             AND mr.isdeleted = 0
             AND (
                 (mr.fk_role_id = 2 AND mr.fk_club_id = @ClubId)
                 OR (mr.fk_role_id = 2 AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
                     AND mr.fk_district_id = (SELECT fk_district_id FROM club_master WHERE pk_club_id = @ClubId))
                 OR mr.fk_role_id != 2
             )
         LEFT JOIN roles r ON r.pk_role_id = mr.fk_role_id
         WHERE ${filters}
         GROUP BY m.pk_member_master_profile_id, m.MemberName, m.ProfilePhotoPath,
                  m.EmailId, m.PrimaryMobileNumber, m.RotaryId,
                  m.ShowPhoneInMyClub, m.ShowPhoneInAllClubs,
                  m.ShowEmailInMyClub, m.ShowEmailInAllClubs,
                  cm.JoinedDate, cm.pk_club_member_id, cm.IsActive, cm.IsHonoraryMember
         ORDER BY
             CASE
                 WHEN @ClubId = @CogClubId THEN 0
                 WHEN MAX(CASE WHEN r.RoleName = 'Admin' THEN 1 ELSE 0 END) = 1 THEN 0
                 WHEN m.PrimaryMobileNumber IS NULL OR m.PrimaryMobileNumber = '' THEN 1
                 ELSE 2
             END,
             CASE WHEN @ClubId = @CogClubId
                  THEN COALESCE(-CAST(MAX(${yearStart}) AS SIGNED), 999999)
                  ELSE 0
             END,
             m.MemberName
         LIMIT @PageSize OFFSET @Offset`,
        params,
      );
      const items = rows.map((row) => {
        const rowMemberId = Number(row.Id);
        const showPhone = shouldShowPhone(viewerId, rowMemberId, sharesClub, row.ShowPhoneInMyClub, row.ShowPhoneInAllClubs);
        const showEmail = shouldShowEmail(viewerId, rowMemberId, sharesClub, row.ShowEmailInMyClub, row.ShowEmailInAllClubs);
        return ClubMemberDto.create({
          Id: rowMemberId,
          MemberName: row.MemberName ?? "",
          ProfilePhotoPath: row.ProfilePhotoPath,
          EmailId: showEmail ? row.EmailId : null,
          PrimaryMobileNumber: showPhone ? row.PrimaryMobileNumber : null,
          RotaryId: row.RotaryId,
          JoinedDate: isCog(clubId) ? null : row.JoinedDate,
          ClubMemberId: Number(row.ClubMemberId),
          MembershipActive: row.MembershipActive === true || Number(row.MembershipActive) === 1,
          IsHonorary: row.IsHonorary !== null && (row.IsHonorary === true || Number(row.IsHonorary) === 1),
          Roles: row.RoleNames ? String(row.RoleNames).split(",") : [],
          HasAdminRole: Number(row.HasAdminRole ?? 0) === 1,
          Designation: row.Designation ?? null,
          CogDistrictNumber: row.CogDistrictNumber ?? null,
          CogYear: toRotaryYearLabel(row.CogYearStart ?? null),
        });
      });
      const honoraryCount = Number(
        await conn.executeScalar(
          `SELECT COUNT(*)
           FROM club_members cm
           JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
           WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
             AND COALESCE(cm.IsHonoraryMember, 0) = 1`,
          { ClubId: clubId },
        ),
      );
      const activeRoster = Number(
        await conn.executeScalar(
          `SELECT COUNT(*)
           FROM club_members cm
           JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
           WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0`,
          { ClubId: clubId },
        ),
      );
      return pagedResult(items, totalCount, page, pageSize, { honoraryCount, memberCount: activeRoster - honoraryCount });
    });
  }

  async getMemberDesignationYears(clubId: number): Promise<number[]> {
    const y = cogYearStartSql("cm");
    const rows = await this.db.query(
      `SELECT DISTINCT CAST(${y} AS SIGNED) AS Year
       FROM club_members cm
       WHERE cm.fk_club_id = @ClubId
         AND cm.IsActive = 1
         AND cm.isdeleted = 0
         AND cm.Designation IS NOT NULL
         AND ${y} IS NOT NULL
       ORDER BY Year DESC`,
      { ClubId: clubId },
    );
    return rows.map((r) => Number(r.Year));
  }

  async getCogDesignation(clubId: number, memberId: number): Promise<{ districtNumber: string | null; yearLabel: string | null }> {
    const row = await this.db.queryFirstOrDefault(
      `SELECT ${cogDistrictSql("cm")} AS DistrictNumber,
              ${cogYearStartSql("cm")} AS YearStart
       FROM club_members cm
       WHERE cm.fk_club_id = @ClubId
         AND cm.fk_member_master_profile_id = @MemberId
         AND COALESCE(cm.isdeleted, 0) = 0
       LIMIT 1`,
      { ClubId: clubId, MemberId: memberId },
    );
    if (!row) return { districtNumber: null, yearLabel: null };
    return { districtNumber: row.DistrictNumber ?? null, yearLabel: toRotaryYearLabel(row.YearStart ?? null) };
  }

  async updateCogDesignation(clubId: number, memberId: number, districtNumber: string, yearLabel: string, modifiedBy: number): Promise<boolean> {
    const rows = await this.db.execute(
      `UPDATE club_members
       SET Designation = @Designation, modified_by = @ModifiedBy, modified_date = NOW()
       WHERE fk_club_id = @ClubId
         AND fk_member_master_profile_id = @MemberId
         AND COALESCE(isdeleted, 0) = 0`,
      { ClubId: clubId, MemberId: memberId, Designation: composeCogDesignation(districtNumber, yearLabel), ModifiedBy: modifiedBy },
    );
    return rows > 0;
  }

  async addMember(clubId: number, memberId: number, joinedDate: string | null, createdBy: number): Promise<number> {
    const clubMemberId = await this.db.transaction(async (tx) => {
      const existing = await tx.queryFirstOrDefault(
        `SELECT pk_club_member_id AS pk_id, isdeleted
         FROM club_members
         WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId
         ORDER BY pk_club_member_id DESC LIMIT 1`,
        { ClubId: clubId, MemberId: memberId },
      );
      let id: number;
      const joined = dbDateTime(joinedDate);
      if (!existing || Number(existing.pk_id) === 0) {
        id = Number(
          await tx.executeScalar(
            `INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, JoinedDate, IsActive, created_by, created_date, isdeleted)
             VALUES (@ClubId, @MemberId, @JoinedDate, 1, @CreatedBy, NOW(), 0);
             SELECT LAST_INSERT_ID();`,
            { ClubId: clubId, MemberId: memberId, JoinedDate: joined, CreatedBy: createdBy },
          ),
        );
      } else if (Number(existing.isdeleted) === 0) {
        throw new InvalidOperationException("Member is already in this club.");
      } else {
        await tx.execute(
          `UPDATE club_members
           SET isdeleted = 0, IsActive = 1, JoinedDate = @JoinedDate,
               deleted_by = NULL, deleted_date = NULL,
               modified_by = @CreatedBy, modified_date = NOW()
           WHERE pk_club_member_id = @Id`,
          { Id: Number(existing.pk_id), JoinedDate: joined, CreatedBy: createdBy },
        );
        id = Number(existing.pk_id);
      }
      // A returning member comes back with their profile, addresses and last family set.
      await tx.execute(
        `UPDATE member_master_profile
         SET isdeleted = 0, deleted_by = NULL, deleted_date = NULL,
             modified_by = @CreatedBy, modified_date = NOW()
         WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 1`,
        { MemberId: memberId, CreatedBy: createdBy },
      );
      await tx.execute(
        `UPDATE member_address_details SET isdeleted = 0, modified_date = NOW()
         WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 1`,
        { MemberId: memberId },
      );
      await tx.execute(
        `UPDATE member_family_details f
         JOIN (SELECT MAX(modified_date) AS last_del FROM member_family_details
               WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 1) b
           ON f.modified_date = b.last_del
         SET f.isdeleted = 0, f.modified_date = NOW()
         WHERE f.fk_member_master_profile_id = @MemberId AND f.isdeleted = 1
           AND NOT EXISTS (SELECT 1 FROM (SELECT fk_member_master_profile_id FROM member_family_details
                           WHERE fk_member_master_profile_id = @MemberId AND COALESCE(isdeleted, 0) = 0) live)`,
        { MemberId: memberId },
      );
      return id;
    });
    void this.sendClubMembershipEmail(clubId, memberId, false);
    return clubMemberId;
  }

  async removeMember(clubId: number, memberId: number, deletedBy: number, terminationReason: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      const otherActiveClubs = Number(
        await tx.executeScalar(
          `SELECT COUNT(*) FROM club_members
           WHERE fk_member_master_profile_id = @MemberId
             AND fk_club_id <> @ClubId
             AND isdeleted = 0`,
          { MemberId: memberId, ClubId: clubId },
        ),
      );
      const isLastClub = otherActiveClubs === 0;
      const reason = terminationReason && terminationReason.trim() ? terminationReason.trim() : "Removed by club admin";
      const p = { ClubId: clubId, MemberId: memberId, DeletedBy: deletedBy };

      await tx.execute(
        `UPDATE club_members
         SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW(),
             TerminationDate = CURDATE(), TerminationReason = @Reason
         WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId AND isdeleted = 0`,
        { ...p, Reason: reason },
      );
      // Everything tied to this club goes.
      for (const sql of [
        `UPDATE member_roles SET isdeleted = 1, IsActive = 0, RevokedDate = NOW(), RevokedBy = @DeletedBy, modified_by = @DeletedBy, modified_date = NOW()
         WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId AND isdeleted = 0`,
        `UPDATE board_of_directors SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW()
         WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId AND isdeleted = 0`,
        `UPDATE district_committee_member SET isdeleted = 1, modified_by = @DeletedBy, modified_date = NOW()
         WHERE fk_club_id = @ClubId AND fk_member_id = @MemberId AND isdeleted = 0`,
        `UPDATE district_committee_group_member SET isdeleted = 1, modified_by = @DeletedBy, modified_date = NOW()
         WHERE fk_club_id = @ClubId AND fk_member_id = @MemberId AND isdeleted = 0`,
        `UPDATE district_committee_sub_group_member SET isdeleted = 1, modified_by = @DeletedBy, modified_date = NOW()
         WHERE fk_club_id = @ClubId AND fk_member_id = @MemberId AND isdeleted = 0`,
        `UPDATE district_ag SET isdeleted = 1, is_active = 0, modified_by = @DeletedBy, modified_date = NOW()
         WHERE fk_club_id = @ClubId AND fk_member_id = @MemberId AND isdeleted = 0`,
        `UPDATE district_club_moderator SET isdeleted = 1, is_active = 0, modified_by = @DeletedBy, modified_date = NOW()
         WHERE fk_club_id = @ClubId AND fk_member_id = @MemberId AND isdeleted = 0`,
      ]) {
        await tx.execute(sql, p);
      }
      // Last club: every role (except SuperAdmin) and appointment goes, the mobile moves to
      // the secondary slot, and addresses and family are hidden.
      if (isLastClub) {
        for (const sql of [
          `UPDATE member_roles SET isdeleted = 1, IsActive = 0, RevokedDate = NOW(), RevokedBy = @DeletedBy, modified_by = @DeletedBy, modified_date = NOW()
           WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 0 AND fk_role_id <> 3`,
          `UPDATE board_of_directors SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW()
           WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 0`,
          `UPDATE district_committee_member SET isdeleted = 1, modified_by = @DeletedBy, modified_date = NOW()
           WHERE fk_member_id = @MemberId AND isdeleted = 0`,
          `UPDATE district_committee_group_member SET isdeleted = 1, modified_by = @DeletedBy, modified_date = NOW()
           WHERE fk_member_id = @MemberId AND isdeleted = 0`,
          `UPDATE district_committee_sub_group_member SET isdeleted = 1, modified_by = @DeletedBy, modified_date = NOW()
           WHERE fk_member_id = @MemberId AND isdeleted = 0`,
          `UPDATE district_ag SET isdeleted = 1, is_active = 0, modified_by = @DeletedBy, modified_date = NOW()
           WHERE fk_member_id = @MemberId AND isdeleted = 0`,
          `UPDATE district_club_moderator SET isdeleted = 1, is_active = 0, modified_by = @DeletedBy, modified_date = NOW()
           WHERE fk_member_id = @MemberId AND isdeleted = 0`,
          `UPDATE member_master_profile
           SET SecondaryMobileNumber = CASE WHEN SecondaryMobileNumber IS NULL OR SecondaryMobileNumber = ''
                                            THEN PrimaryMobileNumber ELSE SecondaryMobileNumber END,
               PrimaryMobileNumber = NULL,
               modified_by = @DeletedBy, modified_date = NOW()
           WHERE pk_member_master_profile_id = @MemberId
             AND PrimaryMobileNumber IS NOT NULL`,
          `UPDATE member_address_details SET isdeleted = 1, modified_date = NOW()
           WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 0`,
          `UPDATE member_family_details SET isdeleted = 1, modified_date = NOW()
           WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 0`,
        ]) {
          await tx.execute(sql, p);
        }
      }
    });
    void this.sendClubMembershipEmail(clubId, memberId, true);
  }

  async getMemberRemovalPreview(clubId: number, memberId: number) {
    return this.db.session(async (conn) => {
      const member = await conn.queryFirstOrDefault(
        `SELECT pk_member_master_profile_id AS Id, MemberName, EmailId
         FROM member_master_profile
         WHERE pk_member_master_profile_id = @Id AND isdeleted = 0`,
        { Id: memberId },
      );
      if (!member) return null;
      const clubName = (await conn.executeScalar<string>("SELECT ClubName FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0", { Id: clubId })) ?? "";
      const p = { MemberId: memberId, ClubId: clubId };
      const otherClubs = OtherClubInfo.mapAll(
        await conn.query(
          `SELECT cm.pk_club_id AS ClubId, cm.ClubName
           FROM club_members m
           JOIN club_master cm ON cm.pk_club_id = m.fk_club_id AND cm.isdeleted = 0
           WHERE m.fk_member_master_profile_id = @MemberId
             AND m.fk_club_id <> @ClubId
             AND m.IsActive = 1
             AND m.isdeleted = 0
           ORDER BY cm.ClubName`,
          p,
        ),
      );
      const rolesInThisClub = (
        await conn.query(
          `SELECT DISTINCT r.RoleName
           FROM member_roles mr
           JOIN roles r ON r.pk_role_id = mr.fk_role_id
           WHERE mr.fk_member_master_profile_id = @MemberId
             AND mr.fk_club_id = @ClubId
             AND mr.isdeleted = 0
           ORDER BY r.RoleName`,
          p,
        )
      ).map((r) => r.RoleName as string);
      const allRoles = (
        await conn.query(
          `SELECT DISTINCT r.RoleName
           FROM member_roles mr
           JOIN roles r ON r.pk_role_id = mr.fk_role_id
           WHERE mr.fk_member_master_profile_id = @MemberId
             AND mr.isdeleted = 0
           ORDER BY r.RoleName`,
          p,
        )
      ).map((r) => r.RoleName as string);
      const bodEntries = BodEntry.mapAll(
        await conn.query(
          `SELECT d.designation_name AS DesignationName,
                  y.YearLabel AS YearLabel
           FROM board_of_directors bod
           JOIN designation_master d ON d.pk_designation_id = bod.fk_designation_id
           JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id
           WHERE bod.fk_club_id = @ClubId
             AND bod.fk_member_master_profile_id = @MemberId
             AND bod.isdeleted = 0
           ORDER BY y.YearLabel DESC, d.pk_designation_id`,
          p,
        ),
      );
      const dcCommittee = DcCommitteeEntry.mapAll(
        await conn.query(
          `SELECT IFNULL(dcm.district_designation, '') AS Designation,
                  IFNULL(y.YearLabel, '') AS YearLabel,
                  IFNULL(d.DistrictNumber, '') AS DistrictNumber
           FROM district_committee_member dcm
           LEFT JOIN rotary_year_master y ON y.pk_year_id = dcm.fk_year_id
           LEFT JOIN district_master d ON d.pk_district_id = dcm.fk_district_id
           WHERE dcm.fk_club_id = @ClubId
             AND dcm.fk_member_id = @MemberId
             AND dcm.isdeleted = 0
           ORDER BY dcm.fk_year_id DESC`,
          p,
        ),
      );
      const dcGroups = DcGroupEntry.mapAll(
        await conn.query(
          `SELECT g.group_name AS GroupName,
                  IFNULL(d.DistrictNumber, '') AS DistrictNumber
           FROM district_committee_group_member gm
           JOIN district_committee_group g ON g.id = gm.fk_group_id
           LEFT JOIN district_master d ON d.pk_district_id = g.fk_district_id
           WHERE gm.fk_club_id = @ClubId
             AND gm.fk_member_id = @MemberId
             AND gm.isdeleted = 0
           ORDER BY g.group_name`,
          p,
        ),
      );
      const subGroups = DcSubGroupEntry.mapAll(
        await conn.query(
          `SELECT sg.sub_group_name AS SubGroupName,
                  IFNULL(d.DistrictNumber, '') AS DistrictNumber
           FROM district_committee_sub_group_member sgm
           JOIN district_committee_sub_group sg ON sg.id = sgm.fk_sub_group_id
           LEFT JOIN district_committee_group g ON g.id = sg.fk_group_id
           LEFT JOIN district_master d ON d.pk_district_id = g.fk_district_id
           WHERE sgm.fk_club_id = @ClubId
             AND sgm.fk_member_id = @MemberId
             AND sgm.isdeleted = 0
           ORDER BY sg.sub_group_name`,
          p,
        ),
      );
      return MemberRemovalPreviewDto.create({
        MemberId: memberId,
        MemberName: member.MemberName ?? "",
        EmailId: member.EmailId,
        ClubId: clubId,
        ClubName: clubName,
        IsLastClub: otherClubs.length === 0,
        OtherClubs: otherClubs,
        RolesInThisClub: rolesInThisClub,
        AllRoleNames: allRoles,
        BodEntries: bodEntries,
        DcCommitteeMemberships: dcCommittee,
        DcGroupMemberships: dcGroups,
        SubGroupMemberships: subGroups,
      });
    });
  }

  /** Welcome / removal email to the member, copying the club's current President and Secretary. Never throws. */
  private async sendClubMembershipEmail(clubId: number, memberId: number, isRemove: boolean): Promise<void> {
    try {
      await this.db.session(async (conn) => {
        const member = await conn.queryFirstOrDefault("SELECT MemberName, EmailId FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0", { Id: memberId });
        if (!member?.EmailId || !String(member.EmailId).trim()) return;
        const club = await conn.queryFirstOrDefault(
          `SELECT c.ClubName AS clubName, d.DistrictNumber AS districtNumber, z.ZoneName AS zoneName
           FROM club_master c
           LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
           LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
           WHERE c.pk_club_id = @Id AND c.isdeleted = 0`,
          { Id: clubId },
        );
        const clubName: string = club?.clubName ?? "Rotary Club";
        const ccRows = await conn.query(
          `SELECT DISTINCT m.EmailId
           FROM board_of_directors bod
           JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id AND y.IsCurrent = 1
           JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id
           WHERE bod.fk_club_id = @ClubId AND bod.fk_designation_id IN (1, 4) AND bod.isdeleted = 0
             AND m.EmailId IS NOT NULL AND m.EmailId <> ''`,
          { ClubId: clubId },
        );
        const seen = new Set<string>();
        const ccList = ccRows.map((r) => String(r.EmailId)).filter((e) => e.trim() && !seen.has(e.toLowerCase()) && !!seen.add(e.toLowerCase()));
        if (isRemove) {
          const parts = [clubName];
          if (club?.districtNumber) parts.push(`District ${club.districtNumber}`);
          if (club?.zoneName) parts.push(`Zone ${club.zoneName}`);
          await this.email.sendRoleOrMembershipRemovedEmail(member.EmailId, member.MemberName, `membership of ${clubName}`, parts.join(" — "), ccList);
        } else {
          await this.email.sendNewMemberWelcomeEmail(member.EmailId, member.MemberName, clubName, club?.districtNumber ?? null, club?.zoneName ?? null, ccList);
        }
      });
    } catch (e) {
      this.log.error(`Failed to send club membership email (isRemove=${isRemove}) for member ${memberId} club ${clubId}: ${(e as Error).message}`);
    }
  }

  async getLogos(clubId: number): Promise<{ clubLogo: string | null; rotaryLogo: string | null }> {
    const row = await this.db.queryFirstOrDefault("SELECT ClubLogoPath, RotaryLogoPath FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0", { Id: clubId });
    return { clubLogo: row?.ClubLogoPath ?? null, rotaryLogo: row?.RotaryLogoPath ?? null };
  }

  async setLogos(clubId: number, clubLogoPath: string | null, rotaryLogoPath: string | null, modifiedBy: number): Promise<void> {
    const sets: string[] = [];
    const p: Record<string, unknown> = { Id: clubId, UserId: modifiedBy };
    if (clubLogoPath !== null) {
      sets.push("ClubLogoPath = @ClubLogoPath");
      p.ClubLogoPath = clubLogoPath;
    }
    if (rotaryLogoPath !== null) {
      sets.push("RotaryLogoPath = @RotaryLogoPath");
      p.RotaryLogoPath = rotaryLogoPath;
    }
    if (!sets.length) return;
    sets.push("modified_by = @UserId", "modified_date = NOW()");
    await this.db.execute(`UPDATE club_master SET ${sets.join(", ")} WHERE pk_club_id = @Id`, p);
  }

  uploadLogo(file: UploadedFile) {
    return saveWithGuidName(this.config, file, "uploads", "club");
  }

  async uploadClubLogoToGroup(file: UploadedFile) {
    const name = await saveWithGuidName(this.config, file, "Documents", "group");
    return this.renamePrefixed(name, "club_logo_", "Documents", "group");
  }

  async uploadRotaryLogoToGroup(clubId: number, file: UploadedFile) {
    const name = await saveWithGuidName(this.config, file, "Documents", "WebsiteData", `Group${clubId}`, "LOGO");
    return this.renamePrefixed(name, "UpperLogo_", "Documents", "WebsiteData", `Group${clubId}`, "LOGO");
  }

  /** The C# names these "<prefix><guid without dashes><ext>". */
  private async renamePrefixed(name: string, prefix: string, ...folder: string[]): Promise<string> {
    const { rename } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { webRootPath } = await import("../../services/media-storage");
    const dir = join(webRootPath(this.config), ...folder);
    const target = prefix + name.replace(/-/g, "");
    await rename(join(dir, name), join(dir, target));
    return target;
  }

  async getTerminatedMembers(clubId: number, page: number, pageSize: number, search: string | null) {
    const sets = await this.db.callProcedureMultiple("sp_club_terminated_members", {
      p_ClubId: clubId, p_Search: search && search.trim() ? search : null, p_PageSize: pageSize, p_Offset: (page - 1) * pageSize,
    });
    const items = TerminatedMemberDto.mapAll(sets[0] ?? []);
    const totalCount = Number(Object.values((sets[1] ?? [])[0] ?? {})[0] ?? 0);
    return pagedResult(items, totalCount, page, pageSize);
  }
}
