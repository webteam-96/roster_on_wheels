import type { DbCommands } from "../database/db.service";

/**
 * ClubAdminAccessHelper.EnsureActiveClubAdminRoleAsync: one active Club Admin
 * row per (member, club). Reuses the newest existing row and soft-deletes any
 * duplicates, or inserts a new row.
 */
export async function ensureActiveClubAdminRole(conn: DbCommands, memberId: number, clubId: number, assignedBy: number): Promise<void> {
  const keepPk = await conn.executeScalar<number>(
    `SELECT MAX(pk_member_role_id) FROM member_roles
     WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2 AND fk_club_id = @ClubId`,
    { MemberId: memberId, ClubId: clubId },
  );
  if (keepPk === null || keepPk === undefined) {
    await conn.execute(
      `INSERT INTO member_roles
           (fk_member_master_profile_id, fk_role_id, fk_club_id, IsActive, isdeleted, AssignedBy, created_by, created_date)
       VALUES (@MemberId, 2, @ClubId, 1, 0, @By, @By, NOW())`,
      { MemberId: memberId, ClubId: clubId, By: assignedBy },
    );
    return;
  }
  await conn.execute(
    `UPDATE member_roles
     SET IsActive    = CASE WHEN pk_member_role_id = @Keep THEN 1 ELSE 0 END,
         isdeleted   = CASE WHEN pk_member_role_id = @Keep THEN 0 ELSE 1 END,
         RevokedDate = CASE WHEN pk_member_role_id = @Keep THEN NULL ELSE NOW() END,
         RevokedBy   = CASE WHEN pk_member_role_id = @Keep THEN NULL ELSE @By END,
         modified_by = @By, modified_date = NOW()
     WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2 AND fk_club_id = @ClubId`,
    { MemberId: memberId, ClubId: clubId, Keep: Number(keepPk), By: assignedBy },
  );
}
