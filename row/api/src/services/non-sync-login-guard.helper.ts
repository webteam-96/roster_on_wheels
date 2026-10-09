import type { DbCommands } from "../database/db.service";
import { Brand } from "../brand/brand";
import { UnauthorizedAccessException } from "../common/exceptions";

/**
 * Port of NonSyncLoginGuardHelper.cs: the mobile app is for members with a live
 * club membership, members of an exempt district (Brand.scope.exemptDistricts;
 * none for ROW), or holders of a global role.
 */
export const NON_SYNC_DENIED_MESSAGE = "Your club is no longer active. Please contact your district administrator.";

export async function isMobileLoginAllowed(conn: DbCommands, memberId: number): Promise<boolean> {
  const r = await conn.queryFirst(
    `SELECT
       (SELECT COUNT(*) FROM club_members cm
          WHERE cm.fk_member_master_profile_id = @Id
            AND cm.isdeleted = 0 AND IFNULL(cm.IsActive, 1) = 1) AS activeClubs,
       (SELECT COUNT(*) FROM club_members cm
          JOIN club_master c   ON c.pk_club_id = cm.fk_club_id
          JOIN district_master d ON d.pk_district_id = c.fk_district_id
          WHERE cm.fk_member_master_profile_id = @Id
            AND d.DistrictNumber IN @Exempt) AS exemptClubs,
       (SELECT COUNT(*) FROM member_roles mr
          JOIN roles r ON r.pk_role_id = mr.fk_role_id
          WHERE mr.fk_member_master_profile_id = @Id
            AND mr.IsActive = 1 AND mr.isdeleted = 0
            AND r.RoleName IN ('SuperAdmin','ZonalCoordinator','RIDirector')) AS globalRoles`,
    { Id: memberId, Exempt: Brand.Current.scope.exemptDistricts },
  );
  return Number(r.activeClubs) > 0 || Number(r.exemptClubs) > 0 || Number(r.globalRoles) > 0;
}

export async function ensureMobileLoginAllowed(conn: DbCommands, memberId: number): Promise<void> {
  if (!(await isMobileLoginAllowed(conn, memberId))) throw new UnauthorizedAccessException(NON_SYNC_DENIED_MESSAGE);
}
