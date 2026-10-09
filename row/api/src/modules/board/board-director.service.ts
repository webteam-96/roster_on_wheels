import { Injectable, Logger } from "@nestjs/common";
import { Db, type DbCommands } from "../../database/db.service";
import { InvalidOperationException } from "../../common/exceptions";
import { DcAutoGroupService } from "../../services/dc-auto-group.service";
import { BodSubGroupAutoService } from "../../services/bod-sub-group-auto.service";
import { BoardDirectorDto, BoardYearDto, ClubMemberSearchDto, type SaveBoardDirector } from "../../dtos/board.dtos";

const SELECT_COLUMNS = `
    bd.pk_board_director_id AS Id,
    bd.fk_club_id AS ClubId,
    bd.fk_member_master_profile_id AS MemberId,
    CASE WHEN bd.fk_member_master_profile_id IS NOT NULL THEN 1 ELSE 0 END AS IsMember,
    COALESCE(m.MemberName, bd.non_member_name, '') AS MemberName,
    bd.non_member_name AS NonMemberName,
    bd.non_member_mobile AS NonMemberMobile,
    bd.non_member_email AS NonMemberEmail,
    CASE
        WHEN bd.fk_member_master_profile_id IS NULL THEN NULL
        WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
        WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
        ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
    END AS ProfilePhotoPath,
    bd.fk_designation_id AS DesignationId,
    COALESCE(NULLIF(bd.custom_designation, ''), d.designation_name) AS DesignationName,
    bd.custom_designation AS CustomDesignation,
    bd.fk_year_id AS YearId,
    y.YearLabel
FROM board_of_directors bd
LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
INNER JOIN rotary_year_master y ON y.pk_year_id = bd.fk_year_id`;

const trimOrNull = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

type PrevBod = { ClubId: number; MemberId: number | null; DesignationId: number; YearId: number };

/** Port of BoardDirectorService.cs: a club's board for each Rotary year. */
@Injectable()
export class BoardDirectorService {
  private readonly log = new Logger("BoardDirectorService");

  constructor(
    private readonly db: Db,
    private readonly dcAutoGroups: DcAutoGroupService,
    private readonly bodSubGroups: BodSubGroupAutoService,
  ) {}

  async getByClub(clubId: number, yearId: number) {
    return BoardDirectorDto.mapAll(
      await this.db.query(
        `SELECT ${SELECT_COLUMNS}
         WHERE bd.fk_club_id = @ClubId AND bd.fk_year_id = @YearId AND bd.isdeleted = 0
           AND (bd.fk_member_master_profile_id IS NULL OR m.pk_member_master_profile_id IS NOT NULL)
         ORDER BY
             CASE bd.fk_designation_id WHEN 1 THEN 0 WHEN 2 THEN 1 ELSE 2 END,
             COALESCE(bd.sort_order, 9999),
             d.sort_order,
             bd.pk_board_director_id`,
        { ClubId: clubId, YearId: yearId },
      ),
    );
  }

  async reorder(clubId: number, yearId: number, orderedIds: number[], modifiedBy: number) {
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.execute(
          `UPDATE board_of_directors
           SET sort_order = @SortOrder, modified_by = @ModifiedBy, modified_date = NOW()
           WHERE pk_board_director_id = @Id AND fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0`,
          { Id: orderedIds[i], SortOrder: i, ClubId: clubId, YearId: yearId, ModifiedBy: modifiedBy },
        );
      }
    });
  }

  async getYearsByClub(clubId: number) {
    return BoardYearDto.mapAll(
      await this.db.query(
        `SELECT DISTINCT
                y.pk_year_id AS Id,
                y.YearLabel,
                y.StartDate,
                y.EndDate,
                y.IsCurrent
         FROM board_of_directors bd
         INNER JOIN rotary_year_master y ON y.pk_year_id = bd.fk_year_id
         LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
         INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
         WHERE bd.fk_club_id = @ClubId AND bd.isdeleted = 0
           AND (bd.fk_member_master_profile_id IS NULL OR m.pk_member_master_profile_id IS NOT NULL)
         ORDER BY y.StartDate DESC`,
        { ClubId: clubId },
      ),
    );
  }

  async getById(id: number) {
    return BoardDirectorDto.map(await this.db.queryFirstOrDefault(`SELECT ${SELECT_COLUMNS} WHERE bd.pk_board_director_id = @Id AND bd.isdeleted = 0`, { Id: id }));
  }

  /**
   * Shared create/update checks. Returns the normalised member / non-member
   * fields and the custom designation text.
   */
  private async validate(conn: DbCommands, dto: SaveBoardDirector, clubId: number, excludeId: number | null) {
    const memberId = dto.memberId && dto.memberId > 0 ? dto.memberId : null;
    const nonMemberName = trimOrNull(dto.nonMemberName);
    const nonMemberMobile = trimOrNull(dto.nonMemberMobile);
    const nonMemberEmail = trimOrNull(dto.nonMemberEmail);
    if ((memberId !== null) === (nonMemberName !== null)) {
      throw new InvalidOperationException("A board member must have either an existing member selected or a non-member's details, not both and not neither.");
    }
    if (memberId === null) {
      if (!nonMemberName || !nonMemberMobile || !nonMemberEmail) throw new InvalidOperationException("A non-member board member requires Name, Mobile, and Email.");
      await BoardDirectorService.ensureYearIsPast(conn, dto.yearId);
    }
    const desName = await conn.executeScalar<string>("SELECT designation_name FROM designation_master WHERE pk_designation_id = @Id AND isdeleted = 0", { Id: dto.designationId });
    if (!desName) throw new InvalidOperationException("Selected designation is invalid.");
    let customDesignation: string | null = null;
    if (desName.toLowerCase() === "other") {
      const text = trimOrNull(dto.customDesignation);
      if (!text) throw new InvalidOperationException('Please enter the designation name for the "Other" designation.');
      customDesignation = text.length > 150 ? text.slice(0, 150) : text;
    }
    if (desName === "Club President" || desName === "Club Secretary") {
      const sameRole = Number(
        await conn.executeScalar(
          `SELECT COUNT(*) FROM board_of_directors bd
           INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
           LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
           WHERE bd.fk_club_id = @ClubId AND bd.fk_year_id = @YearId
             AND d.designation_name = @DesName AND bd.isdeleted = 0
             AND (@Id IS NULL OR bd.pk_board_director_id <> @Id)
             AND (bd.fk_member_master_profile_id IS NULL OR m.pk_member_master_profile_id IS NOT NULL)`,
          { ClubId: clubId, YearId: dto.yearId, DesName: desName, Id: excludeId },
        ),
      );
      if (sameRole > 0) throw new InvalidOperationException(`Only one ${desName} is allowed per club per year.`);
      if (memberId !== null) {
        const otherRole = desName === "Club President" ? "Club Secretary" : "Club President";
        const both = Number(
          await conn.executeScalar(
            `SELECT COUNT(*) FROM board_of_directors bd
             INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
             WHERE bd.fk_club_id = @ClubId AND bd.fk_year_id = @YearId
               AND bd.fk_member_master_profile_id = @MemberId
               AND d.designation_name = @OtherRole AND bd.isdeleted = 0
               AND (@Id IS NULL OR bd.pk_board_director_id <> @Id)`,
            { ClubId: clubId, YearId: dto.yearId, MemberId: memberId, OtherRole: otherRole, Id: excludeId },
          ),
        );
        if (both > 0) throw new InvalidOperationException("Same member cannot be both Club President and Club Secretary for the same year.");
      }
    }
    return { memberId, nonMemberName, nonMemberMobile, nonMemberEmail, customDesignation };
  }

  /** Non-members can only be recorded for past Rotary years (historic boards). */
  private static async ensureYearIsPast(conn: DbCommands, yearId: number) {
    const status = await conn.executeScalar<string>(
      `SELECT CASE
           WHEN EndDate < CURDATE() THEN 'past'
           WHEN StartDate > CURDATE() THEN 'future'
           ELSE 'current'
       END
       FROM rotary_year_master
       WHERE pk_year_id = @Id AND isdeleted = 0`,
      { Id: yearId },
    );
    if (status === null || status === undefined) throw new InvalidOperationException("Selected rotary year is invalid.");
    if (status !== "past") throw new InvalidOperationException("Non-member board members can only be added for past rotary years, not the current or future year.");
  }

  async create(clubId: number, dto: SaveBoardDirector, createdBy: number): Promise<number> {
    return this.db.session(async (conn) => {
      const v = await this.validate(conn, dto, clubId, null);
      const newId = Number(
        await conn.executeScalar(
          `INSERT INTO board_of_directors
               (fk_club_id, fk_member_master_profile_id, non_member_name, non_member_mobile, non_member_email,
                fk_designation_id, custom_designation, fk_year_id, SyncSource, created_by)
           VALUES (@ClubId, @MemberId, @NonMemberName, @NonMemberMobile, @NonMemberEmail,
                @DesignationId, @CustomDesignation, @YearId, 'Manual', @CreatedBy);
           SELECT LAST_INSERT_ID();`,
          {
            ClubId: clubId, MemberId: v.memberId, NonMemberName: v.nonMemberName, NonMemberMobile: v.nonMemberMobile, NonMemberEmail: v.nonMemberEmail,
            DesignationId: dto.designationId, CustomDesignation: v.customDesignation, YearId: dto.yearId, CreatedBy: createdBy,
          },
        ),
      );
      if (v.memberId !== null) {
        try {
          await this.dcAutoGroups.onBodAddedOrUpdated(conn, clubId, v.memberId, dto.designationId, dto.yearId, createdBy);
        } catch (e) {
          this.log.error(`[DcAutoGroup hook FAILED in BOD Create] ${(e as Error).message}`);
        }
        this.bodSubGroups.fire(clubId, dto.designationId, dto.yearId);
      }
      return newId;
    });
  }

  async update(id: number, dto: SaveBoardDirector, modifiedBy: number): Promise<void> {
    await this.db.session(async (conn) => {
      const prev = (await conn.queryFirstOrDefault(
        `SELECT fk_club_id AS ClubId, fk_member_master_profile_id AS MemberId,
                fk_designation_id AS DesignationId, fk_year_id AS YearId
         FROM board_of_directors WHERE pk_board_director_id = @Id`,
        { Id: id },
      )) as PrevBod | null;
      const clubId = prev ? Number(prev.ClubId) : 0;
      const v = await this.validate(conn, dto, clubId, id);
      const updated = await conn.execute(
        `UPDATE board_of_directors
         SET fk_member_master_profile_id = @MemberId,
             non_member_name = @NonMemberName,
             non_member_mobile = @NonMemberMobile,
             non_member_email = @NonMemberEmail,
             fk_designation_id = @DesignationId,
             custom_designation = @CustomDesignation,
             fk_year_id = @YearId,
             SyncSource = 'Manual',
             modified_by = @ModifiedBy
         WHERE pk_board_director_id = @Id AND isdeleted = 0`,
        {
          Id: id, MemberId: v.memberId, NonMemberName: v.nonMemberName, NonMemberMobile: v.nonMemberMobile, NonMemberEmail: v.nonMemberEmail,
          DesignationId: dto.designationId, CustomDesignation: v.customDesignation, YearId: dto.yearId, ModifiedBy: modifiedBy,
        },
      );
      const prevMember = prev && prev.MemberId !== null ? Number(prev.MemberId) : null;
      const prevChanged =
        !!prev && clubId > 0 && prevMember !== null &&
        (prevMember !== v.memberId || Number(prev.DesignationId) !== dto.designationId || Number(prev.YearId) !== dto.yearId);
      if (updated > 0) {
        try {
          if (prevChanged) await this.dcAutoGroups.onBodRemoved(conn, clubId, prevMember!, Number(prev!.DesignationId), Number(prev!.YearId));
          if (v.memberId !== null) await this.dcAutoGroups.onBodAddedOrUpdated(conn, clubId, v.memberId, dto.designationId, dto.yearId, modifiedBy);
        } catch (e) {
          this.log.error(`[DcAutoGroup hook FAILED in BOD Update] ${(e as Error).message}`);
        }
      }
      if (prevChanged) this.bodSubGroups.fire(clubId, Number(prev!.DesignationId), Number(prev!.YearId));
      if (v.memberId !== null && clubId > 0) this.bodSubGroups.fire(clubId, dto.designationId, dto.yearId);
    });
  }

  async delete(id: number, deletedBy: number): Promise<void> {
    await this.db.session(async (conn) => {
      const row = (await conn.queryFirstOrDefault(
        `SELECT fk_club_id AS ClubId, fk_member_master_profile_id AS MemberId,
                fk_designation_id AS DesignationId, fk_year_id AS YearId
         FROM board_of_directors WHERE pk_board_director_id = @Id`,
        { Id: id },
      )) as PrevBod | null;
      await conn.executeProcedure("sp_board_director_delete", { p_Id: id, p_DeletedBy: deletedBy });
      if (row && Number(row.ClubId) > 0 && row.MemberId !== null) {
        try {
          await this.dcAutoGroups.onBodRemoved(conn, Number(row.ClubId), Number(row.MemberId), Number(row.DesignationId), Number(row.YearId));
        } catch (e) {
          this.log.error(`[DcAutoGroup hook FAILED in BOD Delete] ${(e as Error).message}`);
        }
        this.bodSubGroups.fire(Number(row.ClubId), Number(row.DesignationId), Number(row.YearId));
      }
    });
  }

  async searchClubMembers(clubId: number, search: string | null) {
    return ClubMemberSearchDto.mapAll(await this.db.callProcedure("sp_past_president_search_club_members", { p_ClubId: clubId, p_Search: search ?? "" }));
  }
}
