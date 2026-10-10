import type { DbCommands } from "../database/db.service";
import { UnauthorizedAccessException } from "../common/exceptions";

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

/** ClubAdminAccessHelper.IsSuperAdminAsync: the member holds an active SuperAdmin role. */
export async function isSuperAdminMember(conn: DbCommands, memberId: number): Promise<boolean> {
  if (memberId <= 0) return false;
  const count = await conn.executeScalar(
    `SELECT COUNT(*) FROM member_roles mr
     JOIN roles r ON r.pk_role_id = mr.fk_role_id
     WHERE mr.fk_member_master_profile_id = @MemberId
       AND r.RoleName = 'SuperAdmin'
       AND mr.IsActive = 1 AND mr.isdeleted = 0`,
    { MemberId: memberId },
  );
  return Number(count ?? 0) > 0;
}

/** ClubAdminAccessHelper.IsDistrictAdminWithClubAccessAsync: an active District Admin (AllClubsAccess = 1) of the club's district. */
export async function isDistrictAdminWithClubAccess(conn: DbCommands, memberId: number, clubId: number): Promise<boolean> {
  if (memberId <= 0 || clubId <= 0) return false;
  const count = await conn.executeScalar(
    `SELECT COUNT(*) FROM member_roles mr
     JOIN club_master c ON c.pk_club_id = @ClubId AND c.isdeleted = 0
     WHERE mr.fk_member_master_profile_id = @MemberId
       AND mr.fk_role_id = 2
       AND mr.fk_district_id = c.fk_district_id
       AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
       AND mr.AllClubsAccess = 1
       AND mr.IsActive = 1 AND mr.isdeleted = 0`,
    { MemberId: memberId, ClubId: clubId },
  );
  return Number(count ?? 0) > 0;
}

/** ClubAdminAccessHelper.EnsureClubAdminAsync: a direct Club Admin of the club, or a District Admin with all-clubs access; else UnauthorizedAccessException. */
export async function ensureClubAdmin(conn: DbCommands, memberId: number, clubId: number): Promise<void> {
  const direct = Number(await conn.executeScalar(
    "SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2 AND fk_club_id = @ClubId AND IsActive = 1 AND isdeleted = 0",
    { MemberId: memberId, ClubId: clubId },
  ));
  if (direct > 0 || (await isDistrictAdminWithClubAccess(conn, memberId, clubId))) return;
  throw new UnauthorizedAccessException("You are not an active admin for this club.");
}
