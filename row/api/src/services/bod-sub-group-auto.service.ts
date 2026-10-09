import { Injectable, Logger } from "@nestjs/common";
import { Db, type DbCommands } from "../database/db.service";

/**
 * Port of BodSubGroupAutoService.cs: one sub-group per board designation and
 * Rotary year, at club scope and at district scope, whose members mirror the
 * board_of_directors rows. The current year's group is named after the
 * designation alone; other years add the year label.
 */
@Injectable()
export class BodSubGroupAutoService {
  private readonly log = new Logger("BodSubGroupAutoService");

  constructor(private readonly db: Db) {}

  isAutoBodSubGroup(groupName: string | null | undefined): boolean {
    return !!groupName && !!groupName.trim();
  }

  /** Fire-and-forget hook after a board change (BoardDirectorService.FireBodSubGroupHook). */
  fire(clubId: number, designationId: number, yearId: number): void {
    void this.onBodChanged(clubId, designationId, yearId).catch(() => {});
  }

  async onBodChanged(clubId: number, designationId: number, yearId: number): Promise<void> {
    try {
      await this.db.session(async (conn) => {
        const districtId = await conn.executeScalar<number>("SELECT fk_district_id FROM club_master WHERE pk_club_id = @C AND isdeleted = 0", { C: clubId });
        await this.syncOneScope(conn, clubId, null, designationId, yearId);
        if (districtId !== null && districtId !== undefined) await this.syncOneScope(conn, null, Number(districtId), designationId, yearId);
      });
    } catch (e) {
      this.log.warn(`BodSubGroupAuto.OnBodChangedAsync failed for club=${clubId} designation=${designationId} year=${yearId}: ${(e as Error).message}`);
    }
  }

  async rebuildAll(): Promise<{ created: number; updated: number; deleted: number }> {
    return this.db.session(async (conn) => {
      const bodCombos = await conn.query(
        `SELECT DISTINCT b.fk_club_id AS clubId, b.fk_year_id AS yearId, b.fk_designation_id AS designationId
         FROM board_of_directors b
         JOIN club_master c ON c.pk_club_id = b.fk_club_id AND c.isdeleted = 0
         WHERE b.isdeleted = 0`,
      );
      const districtCombos = await conn.query(
        `SELECT DISTINCT c.fk_district_id AS districtId, b.fk_year_id AS yearId, b.fk_designation_id AS designationId
         FROM board_of_directors b
         JOIN club_master c ON c.pk_club_id = b.fk_club_id AND c.isdeleted = 0
         WHERE b.isdeleted = 0`,
      );
      const total = { created: 0, updated: 0, deleted: 0 };
      const add = (s: typeof total) => {
        total.created += s.created;
        total.updated += s.updated;
        total.deleted += s.deleted;
      };
      for (const r of bodCombos) add(await this.syncOneScope(conn, Number(r.clubId), null, Number(r.designationId), Number(r.yearId)));
      for (const r of districtCombos) add(await this.syncOneScope(conn, null, Number(r.districtId), Number(r.designationId), Number(r.yearId)));
      return total;
    });
  }

  private async syncOneScope(conn: DbCommands, scopeClubId: number | null, scopeDistrictId: number | null, designationId: number, yearId: number) {
    const none = { created: 0, updated: 0, deleted: 0 };
    const designationName = await conn.executeScalar<string>("SELECT designation_name FROM designation_master WHERE pk_designation_id = @Id AND isdeleted = 0", { Id: designationId });
    if (!designationName || !designationName.trim()) return none;
    const year = await conn.queryFirstOrDefault(
      `SELECT IFNULL(YearLabel, '') AS yearLabel,
              (CURDATE() BETWEEN DATE(StartDate) AND DATE(EndDate)) AS isCurrent
       FROM rotary_year_master WHERE pk_year_id = @Id LIMIT 1`,
      { Id: yearId },
    );
    if (!year || !year.yearLabel) return none;
    const groupName = Number(year.isCurrent) === 1 ? designationName : `${designationName} ${year.yearLabel}`;
    const clubFilter = scopeClubId ?? 0;

    let groupId = await conn.executeScalar<number>(
      `SELECT pk_sub_group_id FROM sub_groups
       WHERE fk_club_id = @C
         AND ((@D IS NULL AND fk_district_id IS NULL) OR fk_district_id = @D)
         AND fk_year_id = @Y AND GroupName = @N AND isdeleted = 0
       LIMIT 1`,
      { C: clubFilter, D: scopeDistrictId, Y: yearId, N: groupName },
    );
    let wasCreated = false;
    if (groupId === null || groupId === undefined) {
      groupId = Number(
        await conn.executeScalar(
          `INSERT INTO sub_groups (fk_club_id, fk_district_id, fk_year_id, GroupName, created_date, isdeleted)
           VALUES (@C, @D, @Y, @N, NOW(), 0);
           SELECT LAST_INSERT_ID();`,
          { C: clubFilter, D: scopeDistrictId, Y: yearId, N: groupName },
        ),
      );
      wasCreated = true;
    }
    const bodRows = scopeClubId !== null
      ? await conn.query(
          `SELECT DISTINCT b.fk_member_master_profile_id AS id
           FROM board_of_directors b
           JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
           WHERE b.fk_club_id = @C AND b.fk_year_id = @Y AND b.fk_designation_id = @D AND b.isdeleted = 0`,
          { C: scopeClubId, Y: yearId, D: designationId },
        )
      : await conn.query(
          `SELECT DISTINCT b.fk_member_master_profile_id AS id
           FROM board_of_directors b
           JOIN club_master c ON c.pk_club_id = b.fk_club_id AND c.isdeleted = 0
           JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
           WHERE c.fk_district_id = @D AND b.fk_year_id = @Y AND b.fk_designation_id = @Des AND b.isdeleted = 0`,
          { D: scopeDistrictId, Y: yearId, Des: designationId },
        );
    const bodIds = new Set(bodRows.map((r) => Number(r.id)));
    const existing = await conn.query(
      `SELECT pk_sub_group_member_id AS pk_id, fk_member_master_profile_id AS memberId
       FROM sub_group_members
       WHERE fk_sub_group_id = @G AND isdeleted = 0`,
      { G: groupId },
    );
    const existingIds = new Set(existing.map((r) => Number(r.memberId)));
    let added = 0;
    let removed = 0;
    for (const memberId of bodIds) {
      if (existingIds.has(memberId)) continue;
      const softId = await conn.executeScalar<number>(
        `SELECT MAX(pk_sub_group_member_id) FROM sub_group_members
         WHERE fk_sub_group_id = @G AND fk_member_master_profile_id = @M AND isdeleted = 1`,
        { G: groupId, M: memberId },
      );
      if (softId !== null && softId !== undefined) {
        await conn.execute("UPDATE sub_group_members SET isdeleted = 0 WHERE pk_sub_group_member_id = @Id", { Id: Number(softId) });
      } else {
        await conn.execute(
          `INSERT INTO sub_group_members (fk_sub_group_id, fk_member_master_profile_id, created_date, isdeleted)
           VALUES (@G, @M, NOW(), 0)`,
          { G: groupId, M: memberId },
        );
      }
      added++;
    }
    for (const r of existing) {
      if (bodIds.has(Number(r.memberId))) continue;
      await conn.execute("UPDATE sub_group_members SET isdeleted = 1 WHERE pk_sub_group_member_id = @Id", { Id: Number(r.pk_id) });
      removed++;
    }
    return { created: wasCreated ? 1 : 0, updated: (added > 0 || removed > 0) && !wasCreated ? 1 : 0, deleted: removed };
  }
}
