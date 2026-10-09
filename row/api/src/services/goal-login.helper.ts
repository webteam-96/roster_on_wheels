import type { DbCommands } from "../database/db.service";

/**
 * Port of GoalLoginHelper.cs. Goal Setting role holders (goal_role_assignments)
 * may log in to the web portal even with none of the member_roles admin roles;
 * their landing is the Goal Setting oversight dashboard.
 */

/** RoleType of the Goal Setting "RI Director" assignment: global, exempt from the club-district-zone kill-switch. */
export const RI_DIRECTOR_ROLE_TYPE = "AllCategoryAllDistrictsFewZones";

export async function hasActiveGoalRole(conn: DbCommands, memberId: number, riDirectorOnly = false): Promise<boolean> {
  if (memberId <= 0) return false;
  const count = await conn.executeScalar<number>(
    `SELECT COUNT(*) FROM goal_role_assignments
     WHERE fk_member_id = @MemberId AND IsActive = 1 AND isdeleted = 0
       AND (@RiOnly = 0 OR RoleType = @RiType)`,
    { MemberId: memberId, RiOnly: riDirectorOnly ? 1 : 0, RiType: RI_DIRECTOR_ROLE_TYPE },
  );
  return Number(count) > 0;
}
