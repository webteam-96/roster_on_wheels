import { Injectable } from "@nestjs/common";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { Db, type DbCommands } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { InvalidOperationException } from "../../common/exceptions";
import { saveWithReadableName, webRootPath, type UploadedFile } from "../../services/media-storage";
import { defineDto } from "../../common/dto";
import { ClubMemberSearchDto } from "../../dtos/board.dtos";

export const PastPresidentDto = defineDto({
  Id: "int", ClubId: "int", MemberId: "int?", NonMemberName: "string", IsMember: "bool", MemberName: { type: "string", default: () => "" },
  ProfilePhotoPath: "string", YearId: "int", YearLabel: { type: "string", default: () => "" },
});
/** CreatePastPresidentDto / UpdatePastPresidentDto (form fields). */
export const SavePastPresidentDto = defineDto({ MemberId: "int?", NonMemberName: "string", YearId: "int", RemovePhoto: "bool" });
export type SavePastPresident = { memberId: number | null; nonMemberName: string | null; yearId: number; removePhoto: boolean };

const SELECT_COLUMNS = `
    pp.pk_past_president_id AS Id,
    pp.fk_club_id AS ClubId,
    pp.fk_member_master_profile_id AS MemberId,
    pp.non_member_name AS NonMemberName,
    CASE WHEN pp.fk_member_master_profile_id IS NOT NULL THEN 1 ELSE 0 END AS IsMember,
    COALESCE(m.MemberName, pp.non_member_name, '') AS MemberName,
    CASE
        WHEN pp.fk_member_master_profile_id IS NULL THEN
            CASE
                WHEN pp.non_member_photo IS NULL OR pp.non_member_photo = '' THEN NULL
                ELSE CONCAT('/Documents/pastpresidents/Group', pp.fk_club_id, '/', SUBSTRING_INDEX(pp.non_member_photo, '/', -1))
            END
        WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
        WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
        ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
    END AS ProfilePhotoPath,
    pp.fk_year_id AS YearId,
    y.YearLabel AS YearLabel
FROM past_presidents pp
LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = pp.fk_member_master_profile_id
LEFT JOIN rotary_year_master y ON y.pk_year_id = pp.fk_year_id`;

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

/** Port of PastPresidentService.cs: one past president per club and past Rotary year. */
@Injectable()
export class PastPresidentService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  async getByClub(clubId: number) {
    return PastPresidentDto.mapAll(await this.db.query(`SELECT ${SELECT_COLUMNS} WHERE pp.fk_club_id = @ClubId AND pp.isdeleted = 0 ORDER BY y.StartDate DESC`, { ClubId: clubId }));
  }

  async getById(id: number) {
    return PastPresidentDto.map(await this.db.queryFirstOrDefault(`SELECT ${SELECT_COLUMNS} WHERE pp.pk_past_president_id = @Id AND pp.isdeleted = 0`, { Id: id }));
  }

  private static normalize(dto: SavePastPresident) {
    const memberId = dto.memberId && dto.memberId > 0 ? dto.memberId : null;
    const nonMemberName = dto.nonMemberName && dto.nonMemberName.trim() ? dto.nonMemberName.trim() : null;
    if ((memberId !== null) === (nonMemberName !== null)) {
      throw new InvalidOperationException("Past President must have either a member selected or a non-member name, not both and not neither.");
    }
    return { memberId, nonMemberName };
  }

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
    if (status !== "past") throw new InvalidOperationException("Past Presidents can only be added for past rotary years, not the current or future year.");
  }

  private photoDir(clubId: number) {
    return join(webRootPath(this.config), "Documents", "pastpresidents", `Group${clubId}`);
  }

  /** Stored as pp_<safe name>_<8 hex><ddMMyyyyhhmmsstt><ext>. */
  private savePhoto(clubId: number, file: UploadedFile): Promise<string> {
    return saveWithReadableName(this.config, file, "pp_", "Documents", "pastpresidents", `Group${clubId}`);
  }

  private async deletePhoto(clubId: number, stored: string | null) {
    if (!stored) return;
    const fileName = basename(stored.replace(/\\/g, "/"));
    if (!fileName) return;
    const full = join(this.photoDir(clubId), fileName);
    if (existsSync(full)) await unlink(full);
  }

  async create(clubId: number, dto: SavePastPresident, photo: UploadedFile | undefined, createdBy: number): Promise<number> {
    const { memberId, nonMemberName } = PastPresidentService.normalize(dto);
    let nonMemberPhoto: string | null = null;
    if (memberId === null && photo && photo.size > 0) {
      if (!ALLOWED_EXT.includes(extname(photo.originalname).toLowerCase()) || !(photo.mimetype ?? "").toLowerCase().startsWith("image/")) {
        throw new InvalidOperationException("Profile photo must be an image (JPG, PNG, WEBP or GIF).");
      }
      if (photo.size > MAX_PHOTO_BYTES) throw new InvalidOperationException("Profile photo must be 2 MB or smaller.");
      nonMemberPhoto = await this.savePhoto(clubId, photo);
    }
    return this.db.session(async (conn) => {
      await PastPresidentService.ensureYearIsPast(conn, dto.yearId);
      const existing = await conn.queryFirstOrDefault(
        `SELECT pp.pk_past_president_id AS id,
                pp.isdeleted AS isdeleted,
                (CASE WHEN pp.fk_member_master_profile_id IS NOT NULL
                           AND m.pk_member_master_profile_id IS NOT NULL THEN 1 ELSE 0 END) AS memberExists,
                (CASE WHEN pp.non_member_name IS NOT NULL AND TRIM(pp.non_member_name) <> '' THEN 1 ELSE 0 END) AS hasNonMemberName
         FROM past_presidents pp
         LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = pp.fk_member_master_profile_id
         WHERE pp.fk_club_id = @ClubId AND pp.fk_year_id = @YearId
         LIMIT 1`,
        { ClubId: clubId, YearId: dto.yearId },
      );
      if (existing) {
        const visible = Number(existing.isdeleted ?? 0) === 0 && (Number(existing.memberExists ?? 0) === 1 || Number(existing.hasNonMemberName ?? 0) === 1);
        if (visible) throw new InvalidOperationException("A Past President already exists for this club and year. Only one is allowed per year.");
        // A deleted (or orphaned) row for the same year is reused.
        await conn.execute(
          `UPDATE past_presidents
           SET fk_member_master_profile_id = @MemberId, non_member_name = @NonMemberName, non_member_photo = @NonMemberPhoto,
               isdeleted = 0, deleted_by = NULL, deleted_date = NULL, modified_by = @CreatedBy
           WHERE pk_past_president_id = @Id`,
          { Id: Number(existing.id), MemberId: memberId, NonMemberName: nonMemberName, NonMemberPhoto: nonMemberPhoto, CreatedBy: createdBy },
        );
        return Number(existing.id);
      }
      return Number(
        await conn.executeScalar(
          `INSERT INTO past_presidents (fk_club_id, fk_member_master_profile_id, non_member_name, non_member_photo, fk_year_id, created_by)
           VALUES (@ClubId, @MemberId, @NonMemberName, @NonMemberPhoto, @YearId, @CreatedBy);
           SELECT LAST_INSERT_ID();`,
          { ClubId: clubId, MemberId: memberId, NonMemberName: nonMemberName, NonMemberPhoto: nonMemberPhoto, YearId: dto.yearId, CreatedBy: createdBy },
        ),
      );
    });
  }

  async update(id: number, dto: SavePastPresident, photo: UploadedFile | undefined, modifiedBy: number): Promise<void> {
    const { memberId, nonMemberName } = PastPresidentService.normalize(dto);
    await this.db.session(async (conn) => {
      await PastPresidentService.ensureYearIsPast(conn, dto.yearId);
      const row = await conn.queryFirstOrDefault(
        `SELECT fk_club_id AS clubId, fk_member_master_profile_id AS existingMemberId, non_member_photo AS existingNonMemberPhoto
         FROM past_presidents WHERE pk_past_president_id = @Id`,
        { Id: id },
      );
      if (!row) throw new InvalidOperationException("Past President record not found.");
      const clubId = Number(row.clubId);
      const existingMemberId = row.existingMemberId === null ? null : Number(row.existingMemberId);
      const existingPhoto = typeof row.existingNonMemberPhoto === "string" ? row.existingNonMemberPhoto : null;
      if (existingMemberId !== null && existingMemberId > 0 && memberId === null) {
        throw new InvalidOperationException("Cannot convert a Member entry back to a Non-Member entry. Delete and recreate if needed.");
      }
      const conflict = await conn.executeScalar<number>(
        `SELECT pp.pk_past_president_id FROM past_presidents pp
         LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = pp.fk_member_master_profile_id
         WHERE pp.fk_club_id = @ClubId AND pp.fk_year_id = @YearId
           AND pp.pk_past_president_id <> @Id AND pp.isdeleted = 0
           AND (
                 (pp.fk_member_master_profile_id IS NOT NULL AND m.pk_member_master_profile_id IS NOT NULL)
              OR (pp.non_member_name IS NOT NULL AND TRIM(pp.non_member_name) <> '')
           )
         LIMIT 1`,
        { ClubId: clubId, YearId: dto.yearId, Id: id },
      );
      if (conflict !== null && conflict !== undefined) throw new InvalidOperationException("A Past President already exists for this club and year. Only one is allowed per year.");

      let finalPhoto = existingPhoto;
      if (memberId !== null) {
        await this.deletePhoto(clubId, existingPhoto);
        finalPhoto = null;
      } else if (photo && photo.size > 0) {
        await this.deletePhoto(clubId, existingPhoto);
        finalPhoto = await this.savePhoto(clubId, photo);
      } else if (dto.removePhoto) {
        await this.deletePhoto(clubId, existingPhoto);
        finalPhoto = null;
      }
      await conn.execute(
        `UPDATE past_presidents
         SET fk_member_master_profile_id = @MemberId, non_member_name = @NonMemberName, non_member_photo = @NonMemberPhoto,
             fk_year_id = @YearId, modified_by = @ModifiedBy
         WHERE pk_past_president_id = @Id AND isdeleted = 0`,
        { Id: id, MemberId: memberId, NonMemberName: nonMemberName, NonMemberPhoto: finalPhoto, YearId: dto.yearId, ModifiedBy: modifiedBy },
      );
    });
  }

  async delete(id: number, deletedBy: number) {
    await this.db.execute(
      "UPDATE past_presidents SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW() WHERE pk_past_president_id = @Id",
      { Id: id, DeletedBy: deletedBy },
    );
  }

  async searchClubMembers(clubId: number, search: string | null) {
    return ClubMemberSearchDto.mapAll(
      await this.db.query(
        `SELECT
             m.pk_member_master_profile_id AS Id,
             m.MemberName,
             CASE
                 WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                 WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                 ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
             END AS ProfilePhotoPath
         FROM club_members cm
         INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
         WHERE cm.fk_club_id = @ClubId
           AND cm.IsActive = 1
           AND cm.isdeleted = 0
           AND m.isdeleted = 0
           AND (@Search = '' OR m.MemberName LIKE CONCAT('%', @Search, '%'))
         ORDER BY m.MemberName
         LIMIT 20`,
        { ClubId: clubId, Search: search ?? "" },
      ),
    );
  }
}
