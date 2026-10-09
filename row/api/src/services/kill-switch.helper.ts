import type { DbCommands } from "../database/db.service";

/**
 * Port of KillSwitchHelper.cs: a district (or club) is reachable only when its
 * whole chain up to the zone is active and not deleted.
 */
export async function isDistrictDrillReachable(db: DbCommands, districtId: number): Promise<boolean> {
  const count = Number(
    await db.executeScalar(
      `SELECT COUNT(*) FROM district_master d
       JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE d.pk_district_id = @Id
         AND d.IsActive = 1 AND d.isdeleted = 0
         AND z.IsActive = 1 AND z.isdeleted = 0`,
      { Id: districtId },
    ),
  );
  return count > 0;
}

export async function isClubDrillReachable(db: DbCommands, clubId: number): Promise<boolean> {
  const count = Number(
    await db.executeScalar(
      `SELECT COUNT(*) FROM club_master c
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE c.pk_club_id = @Id
         AND c.IsActive = 1 AND c.isdeleted = 0
         AND d.IsActive = 1 AND d.isdeleted = 0
         AND z.IsActive = 1 AND z.isdeleted = 0`,
      { Id: clubId },
    ),
  );
  return count > 0;
}

export const DISTRICT_BLOCKED_MESSAGE = "This district or its zone is inactive. Reactivate it first to access this data.";
export const CLUB_BLOCKED_MESSAGE = "This club, its district, or its zone is inactive. Reactivate it first to access this data.";
