import { Injectable } from "@nestjs/common";
import type { DbCommands } from "../database/db.service";

/**
 * Port of DcAutoGroupService.cs (event hooks). A district keeps auto-managed
 * committee groups "Club Presidents" and "Club Secretaries" (with the year
 * appended for past years); a club's board-of-directors President / Secretary
 * is placed in the matching group whenever that board row changes.
 *
 * The RIZones start-up repairs (backfill, singular-to-plural migration,
 * collapse) fix legacy data a fresh ROW database does not have; not ported.
 */
const DESIGNATION_PRESIDENT = "Club President";
const DESIGNATION_SECRETARY = "Club Secretary";
const GROUP_PRESIDENTS = "Club Presidents";
const GROUP_SECRETARIES = "Club Secretaries";

const AUTO_GROUP = /^(Club Presidents|Club Secretaries)( \d{4}-\d{2})?$/;
const AUTO_GROUP_RESERVED = /^\s*club\s+(president|secretary)s?(\s+\d{4}([-/]\d{2,4})?)?\s*$/i;

const buildGroupName = (basePlural: string, yearLabel: string, isCurrentYear: boolean) => (isCurrentYear ? basePlural : `${basePlural} ${yearLabel}`);
const groupBase = (designation: string) => (designation === DESIGNATION_PRESIDENT ? GROUP_PRESIDENTS : designation === DESIGNATION_SECRETARY ? GROUP_SECRETARIES : "");
const basePluralOf = (groupName: string) => (groupName.toLowerCase().startsWith(GROUP_SECRETARIES.toLowerCase()) ? GROUP_SECRETARIES : GROUP_PRESIDENTS);

@Injectable()
export class DcAutoGroupService {
  /** Names reserved for the auto-managed groups (admins may not create or rename to them). */
  isAutoManagedGroup(groupName: string | null | undefined): boolean {
    if (!groupName || !groupName.trim()) return false;
    const t = groupName.trim();
    return AUTO_GROUP.test(t) || AUTO_GROUP_RESERVED.test(t);
  }

  async onBodAddedOrUpdated(conn: DbCommands, clubId: number, memberId: number, designationId: number, yearId: number, userId: number | null): Promise<void> {
    const designation = await this.resolveDesignation(conn, designationId);
    if (designation !== DESIGNATION_PRESIDENT && designation !== DESIGNATION_SECRETARY) return;
    const districtId = await this.resolveDistrict(conn, clubId);
    if (districtId === 0) return;
    const year = await this.resolveYear(conn, yearId);
    if (!year.label) return;

    const groupName = buildGroupName(groupBase(designation), year.label, year.isCurrent);
    const groupId = await this.ensureGroup(conn, districtId, yearId, groupName, userId);
    await this.upsertGroupMember(conn, groupId, memberId, designation, clubId, userId);

    // A member holds one of the two roles per club and year: leave the other group.
    const other = designation === DESIGNATION_PRESIDENT ? DESIGNATION_SECRETARY : DESIGNATION_PRESIDENT;
    await this.softDeleteMemberFromGroup(conn, districtId, yearId, buildGroupName(groupBase(other), year.label, year.isCurrent), memberId, clubId);
  }

  async onBodRemoved(conn: DbCommands, clubId: number, memberId: number, designationId: number, yearId: number): Promise<void> {
    const designation = await this.resolveDesignation(conn, designationId);
    if (designation !== DESIGNATION_PRESIDENT && designation !== DESIGNATION_SECRETARY) return;
    const districtId = await this.resolveDistrict(conn, clubId);
    if (districtId === 0) return;
    const year = await this.resolveYear(conn, yearId);
    if (!year.label) return;
    await this.softDeleteMemberFromGroup(conn, districtId, yearId, buildGroupName(groupBase(designation), year.label, year.isCurrent), memberId, clubId);
  }

  private async ensureGroup(conn: DbCommands, districtId: number, yearId: number, groupName: string, userId: number | null): Promise<number> {
    const existing = await this.findActiveRoleGroupId(conn, districtId, yearId, groupName);
    if (existing) return existing;
    try {
      const deletedId = Number(
        (await conn.executeScalar(
          `SELECT id FROM district_committee_group
           WHERE fk_district_id = @D AND fk_year_id = @Y AND group_name = @N AND isdeleted <> 0
           ORDER BY id LIMIT 1`,
          { D: districtId, Y: yearId, N: groupName },
        )) ?? 0,
      );
      if (deletedId) {
        await conn.execute(
          `UPDATE district_committee_group
           SET isdeleted = 0, is_active = 1, modified_by = @U, modified_date = NOW()
           WHERE id = @Id`,
          { Id: deletedId, U: userId },
        );
        return deletedId;
      }
      return Number(
        await conn.executeScalar(
          `INSERT INTO district_committee_group (fk_district_id, fk_year_id, group_name, sort_order, is_active, created_by, created_date, isdeleted)
           VALUES (@D, @Y, @N, 0, 1, @U, NOW(), 0);
           SELECT LAST_INSERT_ID();`,
          { D: districtId, Y: yearId, N: groupName, U: userId },
        ),
      );
    } catch (e) {
      // Two writers racing to create the same group: take the winner's row.
      if ((e as { code?: string }).code === "ER_DUP_ENTRY") {
        const winner = await this.findActiveRoleGroupId(conn, districtId, yearId, groupName);
        if (winner) return winner;
      }
      throw e;
    }
  }

  private async findActiveRoleGroupId(conn: DbCommands, districtId: number, yearId: number, groupName: string): Promise<number | null> {
    const base = basePluralOf(groupName);
    const id = await conn.executeScalar(
      `SELECT id FROM district_committee_group
       WHERE fk_district_id = @D AND fk_year_id = @Y AND isdeleted = 0
         AND (group_name = @Base OR group_name LIKE @BaseYear)
       ORDER BY (group_name = @N) DESC, id
       LIMIT 1`,
      { D: districtId, Y: yearId, Base: base, BaseYear: base + " ____-__", N: groupName },
    );
    return id === null ? null : Number(id);
  }

  private async upsertGroupMember(conn: DbCommands, groupId: number, memberId: number, designation: string, clubId: number, userId: number | null): Promise<void> {
    const existing = await conn.executeScalar(
      `SELECT id FROM district_committee_group_member
       WHERE fk_group_id = @G AND fk_member_id = @M AND fk_club_id = @C AND isdeleted = 0
       LIMIT 1`,
      { G: groupId, M: memberId, C: clubId },
    );
    const profile = await conn.queryFirstOrDefault(
      `SELECT IFNULL(MemberName, '') AS name,
              IFNULL(PrimaryMobileNumber, '') AS mobile,
              IFNULL(EmailId, '') AS email
       FROM member_master_profile WHERE pk_member_master_profile_id = @M LIMIT 1`,
      { M: memberId },
    );
    const values = { Name: profile?.name ?? "", Mobile: profile?.mobile ?? "", Email: profile?.email ?? "", Des: designation, C: clubId, U: userId };
    if (existing !== null) {
      await conn.execute(
        `UPDATE district_committee_group_member
         SET name = @Name, mobile = @Mobile, email = @Email,
             district_designation = @Des, fk_club_id = @C, is_member = 1, is_active = 1,
             modified_by = @U, modified_date = NOW(), isdeleted = 0
         WHERE id = @Id`,
        { ...values, Id: Number(existing) },
      );
    } else {
      await conn.execute(
        `INSERT INTO district_committee_group_member
             (fk_group_id, fk_member_id, is_member, name, mobile, email, district_designation, fk_club_id, sort_order, is_active, created_by, created_date, isdeleted)
         VALUES
             (@G, @M, 1, @Name, @Mobile, @Email, @Des, @C, 0, 1, @U, NOW(), 0)`,
        { ...values, G: groupId, M: memberId },
      );
    }
    // One holder per club in a group: the previous holder leaves.
    await conn.execute(
      `UPDATE district_committee_group_member
       SET isdeleted = 1, modified_date = NOW()
       WHERE fk_group_id = @G AND fk_club_id = @C AND fk_member_id <> @M AND isdeleted = 0`,
      { G: groupId, C: clubId, M: memberId },
    );
  }

  private async softDeleteMemberFromGroup(conn: DbCommands, districtId: number, yearId: number, groupName: string, memberId: number, clubId: number): Promise<void> {
    const base = basePluralOf(groupName);
    await conn.execute(
      `UPDATE district_committee_group_member m
       JOIN district_committee_group g ON g.id = m.fk_group_id
       SET m.isdeleted = 1, m.modified_date = NOW()
       WHERE g.fk_district_id = @D AND g.fk_year_id = @Y AND g.isdeleted = 0
         AND (g.group_name = @Base OR g.group_name LIKE @BaseYear)
         AND m.fk_member_id = @M AND m.fk_club_id = @C AND m.isdeleted = 0`,
      { D: districtId, Y: yearId, Base: base, BaseYear: base + " ____-__", M: memberId, C: clubId },
    );
  }

  private async resolveDesignation(conn: DbCommands, designationId: number): Promise<string> {
    return (await conn.executeScalar<string>("SELECT designation_name FROM designation_master WHERE pk_designation_id = @Id", { Id: designationId })) ?? "";
  }

  private async resolveDistrict(conn: DbCommands, clubId: number): Promise<number> {
    return Number((await conn.executeScalar("SELECT IFNULL(fk_district_id, 0) FROM club_master WHERE pk_club_id = @Id LIMIT 1", { Id: clubId })) ?? 0);
  }

  private async resolveYear(conn: DbCommands, yearId: number): Promise<{ label: string; isCurrent: boolean }> {
    const row = await conn.queryFirstOrDefault(
      "SELECT IFNULL(YearLabel, '') AS yearLabel, StartDate AS startDate, EndDate AS endDate FROM rotary_year_master WHERE pk_year_id = @Id LIMIT 1",
      { Id: yearId },
    );
    if (!row?.yearLabel) return { label: "", isCurrent: false };
    const today = new Date().toISOString().slice(0, 10); // UTC date, the instance's time
    const start = String(row.startDate).slice(0, 10);
    const end = String(row.endDate).slice(0, 10);
    return { label: row.yearLabel, isCurrent: today >= start && today <= end };
  }
}
