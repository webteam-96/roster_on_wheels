import type { DbCommands } from "../../database/db.service";
import { Brand } from "../../brand/brand";
import { formatDate, nowIn } from "../../common/dotnet-format";
import { InvalidOperationException, UnauthorizedAccessException } from "../../common/exceptions";
import { ExcelJS, toBuffer } from "../../services/xlsx";
import { DISTRICT_ASSISTANT, RI_DIRECTOR, ZONE_COORDINATOR } from "./goal-core";
import { GoalMatrices } from "./goal-matrices";
import type {
  AddGoalRoleHolderRequest, ChangeGoalRoleAssignmentRequest, CreateGoalDesignationRequest, CreateGoalRoleAssignmentRequest, GoalBulkLockRequest, GoalBulkLockResultDto,
  GoalCategoryFormDto, GoalDesignationDto, GoalDistrictSummaryDto, GoalMyAssignmentDto, GoalRoleAssignmentDto, GoalZoneMemberDto,
} from "./goal-setting.dtos";

const VALID_ROLE_TYPES = new Set([DISTRICT_ASSISTANT, ZONE_COORDINATOR, RI_DIRECTOR]);
const blankToNull = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
/** 1 = RI Director, 2 = Zone Co-ordinator, anything else = District Assistant. */
const roleTypeFromRank = (rank: number) => (rank === 1 ? RI_DIRECTOR : rank === 2 ? ZONE_COORDINATOR : DISTRICT_ASSISTANT);
const ids = (rows: { id?: unknown }[]) => rows.map((r) => Number(r.id));

/**
 * Port of GoalSettingService.cs, layer 5: the SuperAdmin-managed goal-oversight roles (RI Director /
 * Zone Co-ordinator / District Assistant), the leadership designations, what the caller holds, the
 * scoped district views and the bulk lock.
 */
export abstract class GoalRoles extends GoalMatrices {
  async getRoleAssignments(): Promise<GoalRoleAssignmentDto[]> {
    return this.db.session(async (conn) => {
      const rows = await conn.query(
        `SELECT a.pk_id AS id, a.fk_member_id AS memberId,
                COALESCE(NULLIF(m.MemberName, ''), a.MemberNameText) AS memberName,
                a.RoleType AS roleType, a.AssignmentName AS assignmentName,
                a.RoleTitle AS roleTitle, a.Avenue AS avenue,
                a.fk_category_id AS categoryId, IF(c.Name = 'TRF', 'Foundation', c.Name) AS categoryName,
                a.fk_zone_id AS zoneId, z.ZoneName AS zoneName,
                a.HomeDistrictId AS homeDistrictId, hd.DistrictNumber AS homeDistrictNumber,
                a.DgYear AS dgYear, a.SupportingText AS supportingText,
                a.IsActive AS isActive, DATE_FORMAT(a.AssignedDate, '%Y-%m-%d') AS assignedDate,
                DATE_FORMAT(a.RoleEmailSentDate, '%Y-%m-%d %H:%i') AS roleEmailSentDate
         FROM goal_role_assignments a
         LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_id
         LEFT JOIN goal_categories c ON c.pk_category_id = a.fk_category_id
         LEFT JOIN zone_master z ON z.pk_zone_id = a.fk_zone_id
         LEFT JOIN district_master hd ON hd.pk_district_id = a.HomeDistrictId
         WHERE a.isdeleted = 0
         ORDER BY a.IsActive DESC, a.AssignedDate DESC`,
      );
      const list: GoalRoleAssignmentDto[] = rows.map((r) => ({
        id: Number(r.id), memberId: Number(r.memberId ?? 0), memberName: r.memberName ?? "", roleType: String(r.roleType), assignmentName: String(r.assignmentName),
        categoryId: r.categoryId === null ? null : Number(r.categoryId), categoryName: r.categoryName ?? null,
        zoneId: r.zoneId === null ? null : Number(r.zoneId), zoneName: r.zoneName ?? null,
        districtIds: [], districtNumbers: [], zoneIds: [], zoneNames: [],
        isActive: Boolean(Number(r.isActive)), assignedDate: r.assignedDate ?? null, roleEmailSentDate: r.roleEmailSentDate ?? null,
        roleTitle: r.roleTitle ?? null, avenue: r.avenue ?? null, homeDistrictId: r.homeDistrictId === null ? null : Number(r.homeDistrictId),
        homeDistrictNumber: r.homeDistrictNumber ?? null, dgYear: r.dgYear ?? null, supportingText: r.supportingText ?? null,
      }));
      if (!list.length) return list;
      const byId = new Map(list.map((a) => [a.id, a]));
      const all = list.map((a) => a.id);
      for (const dr of await conn.query(
        `SELECT d.fk_assignment_id AS assignmentId, dm.DistrictNumber AS districtNumber
         FROM goal_role_assignment_districts d
         JOIN district_master dm ON dm.pk_district_id = d.fk_district_id
         WHERE d.fk_assignment_id IN @Ids`,
        { Ids: all },
      )) byId.get(Number(dr.assignmentId))?.districtNumbers.push(String(dr.districtNumber));
      for (const zr of await conn.query(
        `SELECT z.fk_assignment_id AS assignmentId, zm.pk_zone_id AS zoneId, zm.ZoneName AS zoneName
         FROM goal_role_assignment_zones z
         JOIN zone_master zm ON zm.pk_zone_id = z.fk_zone_id
         WHERE z.fk_assignment_id IN @Ids`,
        { Ids: all },
      )) {
        const a = byId.get(Number(zr.assignmentId));
        if (a) { a.zoneIds.push(Number(zr.zoneId)); a.zoneNames.push(String(zr.zoneName)); }
      }
      return list;
    });
  }

  /** The Role Assign listing as Excel: one row per active holder, honouring the zone filter. */
  async buildRoleAssignmentsExcel(zoneId: number | null): Promise<Buffer> {
    let rows = (await this.getRoleAssignments()).filter((a) => a.isActive);
    if (zoneId !== null && zoneId > 0) rows = rows.filter((a) => (a.roleType === RI_DIRECTOR ? a.zoneIds.includes(zoneId) : a.zoneId === zoneId));
    return this.db.session(async (conn) => {
      const zoneName = zoneId !== null && zoneId > 0 ? await conn.executeScalar("SELECT ZoneName FROM zone_master WHERE pk_zone_id = @Z", { Z: zoneId }) : null;
      const contacts = new Map<number, { email: string; mobile: string; club: string; district: string }>();
      const memberIds = [...new Set(rows.map((a) => a.memberId).filter((id) => id > 0))];
      if (memberIds.length)
        for (const cr of await conn.query(
          `SELECT m.pk_member_master_profile_id AS id,
                  COALESCE(m.EmailId, '') AS email,
                  COALESCE(m.PrimaryMobileNumber, '') AS mobile,
                  COALESCE(GROUP_CONCAT(DISTINCT c.ClubName ORDER BY c.ClubName SEPARATOR ', '), '') AS clubName,
                  COALESCE(GROUP_CONCAT(DISTINCT d.DistrictNumber ORDER BY d.DistrictNumber SEPARATOR ', '), '') AS districtNumber
           FROM member_master_profile m
           LEFT JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                AND cm.IsActive = 1 AND COALESCE(cm.isdeleted, 0) = 0
           LEFT JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND COALESCE(c.isdeleted, 0) = 0
           LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id AND COALESCE(d.isdeleted, 0) = 0
           WHERE m.pk_member_master_profile_id IN @Ids
           GROUP BY m.pk_member_master_profile_id, m.EmailId, m.PrimaryMobileNumber`,
          { Ids: memberIds },
        )) contacts.set(Number(cr.id), { email: String(cr.email), mobile: String(cr.mobile), club: String(cr.clubName), district: String(cr.districtNumber) });

      const roleLabel = (a: GoalRoleAssignmentDto) => (a.roleType === RI_DIRECTOR ? "RI Director" : a.roleTitle && a.roleTitle.trim() ? a.roleTitle : a.roleType === ZONE_COORDINATOR ? "Zone Co-ordinator" : "District Assistant");
      const roleOrder = (a: GoalRoleAssignmentDto) => (a.roleType === RI_DIRECTOR ? 0 : a.roleType === ZONE_COORDINATOR ? 1 : 2);
      const zoneCell = (a: GoalRoleAssignmentDto) => (a.roleType === RI_DIRECTOR ? (a.zoneNames.length ? a.zoneNames.join(", ") : "-") : a.zoneName ?? "-");
      const districtsCell = (a: GoalRoleAssignmentDto) => (a.roleType === RI_DIRECTOR ? "All districts of the zone(s)" : a.roleType === ZONE_COORDINATOR ? "All districts of the zone" : a.districtNumbers.length ? a.districtNumbers.join(", ") : "-");
      const cmp = (x: string, y: string) => x.toLowerCase().localeCompare(y.toLowerCase());
      const ordered = [...rows].sort((a, b) => cmp(zoneCell(a), zoneCell(b)) || roleOrder(a) - roleOrder(b) || cmp(a.avenue ?? a.categoryName ?? "", b.avenue ?? b.categoryName ?? "") || cmp(a.memberName, b.memberName));

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Role Assignments");
      [7, 22, 20, 20, 26, 30, 34, 12, 18, 32].forEach((w, i) => (ws.getColumn(i + 1).width = w));
      const navy = "FF1A365D", border = { style: "thin" as const, color: { argb: "FFCBD5E1" } };
      ws.mergeCells(1, 1, 1, 10);
      ws.getCell(1, 1).value = "Goal Setting - Role Assignments";
      ws.getCell(1, 1).font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
      ws.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
      ws.getCell(1, 1).alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(1).height = 32;
      ws.mergeCells(2, 1, 2, 10);
      ws.getCell(2, 1).value = `${zoneName ?? "All zones"}   ·   ${ordered.length} role holder(s)   ·   Generated ${formatDate(nowIn(Brand.Current.locale.defaultTimeZone), "dd MMM yyyy, hh:mm tt")}`;
      ws.getCell(2, 1).font = { size: 10, color: { argb: "FF475569" } };
      ws.getCell(2, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2F7" } };
      ws.getCell(2, 1).alignment = { horizontal: "center" };
      const headerRow = 4;
      ["Sr No", "Role", "Avenue / Category", "Zone", "Assigned Districts", "Member Name", "Club", "District", "Mobile Number", "Email Id"].forEach((h, i) => {
        const c = ws.getCell(headerRow, i + 1);
        c.value = h;
        c.font = { bold: true, color: { argb: "FF1E293B" } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
        c.alignment = { horizontal: "center", vertical: "middle" };
      });
      let r = headerRow + 1;
      ordered.forEach((a, i) => {
        const ct = contacts.get(a.memberId) ?? { email: "", mobile: "", club: "", district: "" };
        const dash = (s: string) => (s && s.trim() ? s : "-");
        ws.getRow(r).values = [i + 1, roleLabel(a), a.roleType === RI_DIRECTOR ? "All avenues" : a.avenue ?? a.categoryName ?? "-", zoneCell(a), districtsCell(a), a.memberName, dash(ct.club), dash(ct.district), dash(ct.mobile), dash(ct.email)];
        ws.getCell(r, 9).alignment = { horizontal: "left" };
        r++;
      });
      if (!ordered.length) ws.getCell(r, 1).value = "No active role assignments for this filter.";
      else {
        for (let rr = headerRow; rr < r; rr++) for (let c = 1; c <= 10; c++) ws.getCell(rr, c).border = { top: border, bottom: border, left: border, right: border };
        ws.views = [{ state: "frozen", ySplit: headerRow }];
      }
      return toBuffer(wb);
    });
  }

  async createRoleAssignment(assignedByMemberId: number, req: CreateGoalRoleAssignmentRequest): Promise<GoalRoleAssignmentDto> {
    if (!VALID_ROLE_TYPES.has(req.roleType)) throw new InvalidOperationException("Unknown role type.");
    if (!req.assignmentName || !req.assignmentName.trim()) throw new InvalidOperationException("Assignment name is required.");
    const hasFreeTextName = !!req.memberNameText && !!req.memberNameText.trim();
    if (req.memberId <= 0 && !hasFreeTextName) throw new InvalidOperationException("Select a member, or type a name.");
    const oneCatOneZone = req.roleType === DISTRICT_ASSISTANT || req.roleType === ZONE_COORDINATOR;
    if (oneCatOneZone) {
      if (!(req.categoryId !== null && req.categoryId > 0)) throw new InvalidOperationException("Category is required for this role type.");
      if (!(req.zoneId !== null && req.zoneId > 0)) throw new InvalidOperationException("Zone is required for this role type.");
    }
    if (req.roleType === DISTRICT_ASSISTANT && (!req.districtIds || !req.districtIds.length)) throw new InvalidOperationException("At least one district is required for this role type.");
    if (req.roleType === RI_DIRECTOR && (!req.zoneIds || !req.zoneIds.length)) throw new InvalidOperationException("At least one zone is required for this role type.");

    const assignmentId = await this.db.session(async (conn) => {
      // Hierarchy: RI Director → Zone Co-ordinator → District Assistant; a lower role needs the one above.
      if (req.roleType === ZONE_COORDINATOR) {
        const hasDirector = Number(await conn.executeScalar(
          `SELECT COUNT(*) FROM goal_role_assignments a
           JOIN goal_role_assignment_zones z ON z.fk_assignment_id = a.pk_id
           WHERE a.RoleType = 'AllCategoryAllDistrictsFewZones' AND a.IsActive = 1 AND a.isdeleted = 0
             AND z.fk_zone_id = @ZoneId`,
          { ZoneId: req.zoneId },
        ));
        if (hasDirector === 0) throw new InvalidOperationException("Assign an RI Director for this zone first — a Zone Co-ordinator sits under a director.");
      } else if (req.roleType === DISTRICT_ASSISTANT) {
        const hasCoordinator = Number(await conn.executeScalar(
          `SELECT COUNT(*) FROM goal_role_assignments a
           WHERE a.RoleType = 'AllDistrictsOneCategoryOneZone' AND a.IsActive = 1 AND a.isdeleted = 0
             AND a.fk_zone_id = @ZoneId AND a.fk_category_id = @CategoryId`,
          { ZoneId: req.zoneId, CategoryId: req.categoryId },
        ));
        if (hasCoordinator === 0) throw new InvalidOperationException("Assign a Zone Co-ordinator for this zone & avenue first — a District Assistant sits under a co-ordinator.");
      }
      return conn.transaction(async (tx) => {
        const id = Number(await tx.executeScalar(
          `INSERT INTO goal_role_assignments
               (fk_member_id, MemberNameText, RoleType, AssignmentName, RoleTitle, Avenue,
                fk_category_id, fk_zone_id, HomeDistrictId, DgYear, SupportingText,
                IsActive, AssignedBy, AssignedDate, isdeleted)
           VALUES (@MemberId, @MemberNameText, @RoleType, @AssignmentName, @RoleTitle, @Avenue,
                   @CategoryId, @ZoneId, @HomeDistrictId, @DgYear, @SupportingText,
                   1, @AssignedBy, NOW(), 0);
           SELECT LAST_INSERT_ID();`,
          {
            MemberId: req.memberId, MemberNameText: hasFreeTextName ? req.memberNameText!.trim() : null, RoleType: req.roleType, AssignmentName: req.assignmentName,
            RoleTitle: blankToNull(req.roleTitle), Avenue: blankToNull(req.avenue), CategoryId: oneCatOneZone ? req.categoryId : null, ZoneId: oneCatOneZone ? req.zoneId : null,
            HomeDistrictId: req.homeDistrictId !== null && req.homeDistrictId > 0 ? req.homeDistrictId : null, DgYear: blankToNull(req.dgYear),
            SupportingText: blankToNull(req.supportingText), AssignedBy: assignedByMemberId,
          },
        ));
        if (req.roleType === DISTRICT_ASSISTANT && req.districtIds)
          for (const d of [...new Set(req.districtIds)]) await tx.execute("INSERT INTO goal_role_assignment_districts (fk_assignment_id, fk_district_id) VALUES (@AssignmentId, @DistrictId)", { AssignmentId: id, DistrictId: d });
        if (req.roleType === RI_DIRECTOR && req.zoneIds)
          for (const z of [...new Set(req.zoneIds)]) await tx.execute("INSERT INTO goal_role_assignment_zones (fk_assignment_id, fk_zone_id) VALUES (@AssignmentId, @ZoneId)", { AssignmentId: id, ZoneId: z });
        return id;
      });
    });
    // a login now, but no email: the SuperAdmin sends the role emails in one go
    if (req.memberId > 0) await this.roleService.ensureLoginAndNotify(req.memberId, assignedByMemberId, false).catch(() => undefined);
    return (await this.getRoleAssignments()).find((a) => a.id === assignmentId)!;
  }

  private static async searchMembers(conn: DbCommands, sql: string, p: Record<string, unknown>): Promise<GoalZoneMemberDto[]> {
    return (await conn.query(sql, p)).map((r) => ({
      id: Number(r.id), memberName: r.memberName ?? "", emailId: r.emailId ?? "", primaryMobileNumber: r.primaryMobileNumber ?? "", clubName: r.clubName ?? null, districtNumber: r.districtNumber ?? null,
    }));
  }

  /** Global member search for the assign form (2+ characters, no zone filter). */
  async searchMembersGlobal(search: string | null): Promise<GoalZoneMemberDto[]> {
    const term = (search ?? "").trim();
    if (term.length < 2) return [];
    return this.db.session((conn) => GoalRoles.searchMembers(conn,
      `SELECT m.pk_member_master_profile_id AS id, m.MemberName AS memberName,
              m.EmailId AS emailId, m.PrimaryMobileNumber AS primaryMobileNumber,
              GROUP_CONCAT(DISTINCT c.ClubName ORDER BY c.ClubName SEPARATOR ', ') AS clubName,
              GROUP_CONCAT(DISTINCT d.DistrictNumber ORDER BY d.DistrictNumber SEPARATOR ', ') AS districtNumber
       FROM member_master_profile m
       LEFT JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
            AND cm.IsActive = 1 AND COALESCE(cm.isdeleted, 0) = 0
       LEFT JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND COALESCE(c.isdeleted, 0) = 0
       LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id AND COALESCE(d.isdeleted, 0) = 0
       WHERE COALESCE(m.isdeleted, 0) = 0
         AND (m.MemberName LIKE @Like OR m.EmailId LIKE @Like OR m.PrimaryMobileNumber LIKE @Like)
       GROUP BY m.pk_member_master_profile_id, m.MemberName, m.EmailId, m.PrimaryMobileNumber
       ORDER BY m.MemberName
       LIMIT 40`, { Like: `%${term}%` }));
  }

  /** Members whose active club is in one of the zones (empty term = the zone's members, capped). */
  async searchZoneMembers(zoneIds: number[], search: string | null): Promise<GoalZoneMemberDto[]> {
    if (!zoneIds || !zoneIds.length) return [];
    const term = (search ?? "").trim();
    return this.db.session((conn) => GoalRoles.searchMembers(conn,
      `SELECT m.pk_member_master_profile_id AS id, m.MemberName AS memberName,
              m.EmailId AS emailId, m.PrimaryMobileNumber AS primaryMobileNumber,
              GROUP_CONCAT(DISTINCT c.ClubName ORDER BY c.ClubName SEPARATOR ', ') AS clubName,
              GROUP_CONCAT(DISTINCT d.DistrictNumber ORDER BY d.DistrictNumber SEPARATOR ', ') AS districtNumber
       FROM member_master_profile m
       JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
            AND cm.IsActive = 1 AND COALESCE(cm.isdeleted, 0) = 0
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND COALESCE(c.isdeleted, 0) = 0
       JOIN district_master d ON d.pk_district_id = c.fk_district_id AND COALESCE(d.isdeleted, 0) = 0
       WHERE d.fk_zone_id IN @ZoneIds AND COALESCE(m.isdeleted, 0) = 0
         AND (@Term = '' OR m.MemberName LIKE @Like OR m.EmailId LIKE @Like OR m.PrimaryMobileNumber LIKE @Like)
       GROUP BY m.pk_member_master_profile_id, m.MemberName, m.EmailId, m.PrimaryMobileNumber
       ORDER BY m.MemberName
       LIMIT 40`, { ZoneIds: zoneIds, Term: term, Like: `%${term}%` }));
  }

  /** "+" beside a name: another holder with exactly the same scope. Silent (login, no email). */
  async addRoleAssignmentHolder(assignmentId: number, req: AddGoalRoleHolderRequest, addedByMemberId: number): Promise<number> {
    if (req.memberId <= 0 && !(req.memberNameText && req.memberNameText.trim())) throw new InvalidOperationException("Select a member, or type a name.");
    const newId = await this.db.session(async (conn) => {
      const src = await conn.queryFirstOrDefault(
        `SELECT RoleType AS roleType, AssignmentName AS assignmentName, RoleTitle AS roleTitle,
                Avenue AS avenue, fk_category_id AS categoryId, fk_zone_id AS zoneId,
                HomeDistrictId AS homeDistrictId, DgYear AS dgYear, SupportingText AS supportingText
         FROM goal_role_assignments
         WHERE pk_id = @Id AND IsActive = 1 AND isdeleted = 0`,
        { Id: assignmentId },
      );
      if (!src) throw new InvalidOperationException("Assignment not found or already revoked.");
      const categoryId = src.categoryId === null ? null : Number(src.categoryId);
      const zoneId = src.zoneId === null ? null : Number(src.zoneId);
      if (req.memberId > 0) {
        const already = Number(await conn.executeScalar(
          `SELECT COUNT(*) FROM goal_role_assignments
           WHERE IsActive = 1 AND isdeleted = 0 AND fk_member_id = @M AND RoleType = @RoleType
             AND (fk_zone_id <=> @ZoneId) AND (fk_category_id <=> @CategoryId)`,
          { M: req.memberId, RoleType: src.roleType, ZoneId: zoneId, CategoryId: categoryId },
        ));
        if (already > 0) throw new InvalidOperationException("That member already holds this role here.");
      }
      const hasFreeText = !!req.memberNameText && !!req.memberNameText.trim();
      return conn.transaction(async (tx) => {
        const id = Number(await tx.executeScalar(
          `INSERT INTO goal_role_assignments
               (fk_member_id, MemberNameText, RoleType, AssignmentName, RoleTitle, Avenue,
                fk_category_id, fk_zone_id, HomeDistrictId, DgYear, SupportingText,
                IsActive, AssignedBy, AssignedDate, isdeleted)
           VALUES (@MemberId, @NameText, @RoleType, @AssignmentName, @RoleTitle, @Avenue,
                   @CategoryId, @ZoneId, @HomeDistrictId, @DgYear, @SupportingText,
                   1, @By, NOW(), 0);
           SELECT LAST_INSERT_ID();`,
          {
            MemberId: req.memberId, NameText: hasFreeText ? req.memberNameText!.trim() : null, RoleType: src.roleType, AssignmentName: src.assignmentName,
            RoleTitle: src.roleTitle ?? null, Avenue: src.avenue ?? null, CategoryId: categoryId, ZoneId: zoneId,
            HomeDistrictId: src.homeDistrictId === null ? null : Number(src.homeDistrictId), DgYear: src.dgYear ?? null, SupportingText: src.supportingText ?? null, By: addedByMemberId,
          },
        ));
        await tx.execute(
          `INSERT INTO goal_role_assignment_zones (fk_assignment_id, fk_zone_id)
           SELECT @NewId, fk_zone_id FROM goal_role_assignment_zones WHERE fk_assignment_id = @SrcId`,
          { NewId: id, SrcId: assignmentId },
        );
        await tx.execute(
          `INSERT INTO goal_role_assignment_districts (fk_assignment_id, fk_district_id)
           SELECT @NewId, fk_district_id FROM goal_role_assignment_districts WHERE fk_assignment_id = @SrcId`,
          { NewId: id, SrcId: assignmentId },
        );
        return id;
      });
    });
    if (req.memberId > 0) await this.roleService.ensureLoginAndNotify(req.memberId, addedByMemberId, false).catch(() => undefined);
    return newId;
  }

  /**
   * Revoke (silently) and cascade down for zones / avenues nobody else covers: an RI Director takes
   * the Zone Co-ordinators + District Assistants of zones they covered alone; a Zone Co-ordinator the
   * District Assistants of their zone + avenue when no other co-ordinator holds it.
   */
  async revokeRoleAssignment(assignmentId: number, revokedByMemberId: number): Promise<void> {
    await this.db.session(async (conn) => {
      const main = await conn.queryFirstOrDefault("SELECT RoleType AS roleType, fk_zone_id AS zoneId, fk_category_id AS categoryId FROM goal_role_assignments WHERE pk_id = @Id AND isdeleted = 0", { Id: assignmentId });
      if (!main) return;
      const all = [assignmentId];
      if (main.roleType === RI_DIRECTOR) {
        const zones = (await conn.query("SELECT fk_zone_id AS id FROM goal_role_assignment_zones WHERE fk_assignment_id = @Id", { Id: assignmentId })).map((r) => Number(r.id));
        const orphan: number[] = [];
        for (const z of zones) {
          const others = Number(await conn.executeScalar(
            `SELECT COUNT(*)
             FROM goal_role_assignments a
             JOIN goal_role_assignment_zones az ON az.fk_assignment_id = a.pk_id
             WHERE a.RoleType = 'AllCategoryAllDistrictsFewZones' AND a.IsActive = 1 AND a.isdeleted = 0
               AND a.pk_id <> @Id AND az.fk_zone_id = @Z`,
            { Id: assignmentId, Z: z },
          ));
          if (others === 0) orphan.push(z);
        }
        if (orphan.length)
          all.push(...ids(await conn.query(
            `SELECT pk_id AS id FROM goal_role_assignments
             WHERE IsActive = 1 AND isdeleted = 0
               AND RoleType IN ('AllDistrictsOneCategoryOneZone','FewDistrictsOneCategoryOneZone')
               AND fk_zone_id IN @ZoneIds`,
            { ZoneIds: orphan },
          )));
      } else if (main.roleType === ZONE_COORDINATOR && main.zoneId !== null && main.categoryId !== null) {
        const others = Number(await conn.executeScalar(
          `SELECT COUNT(*) FROM goal_role_assignments
           WHERE RoleType = 'AllDistrictsOneCategoryOneZone' AND IsActive = 1 AND isdeleted = 0
             AND pk_id <> @Id AND fk_zone_id = @Zid AND fk_category_id = @Cid`,
          { Id: assignmentId, Zid: main.zoneId, Cid: main.categoryId },
        ));
        if (others === 0)
          all.push(...ids(await conn.query(
            `SELECT pk_id AS id FROM goal_role_assignments
             WHERE IsActive = 1 AND isdeleted = 0 AND RoleType = 'FewDistrictsOneCategoryOneZone'
               AND fk_zone_id = @Zid AND fk_category_id = @Cid`,
            { Zid: main.zoneId, Cid: main.categoryId },
          )));
      }
      await conn.execute(
        `UPDATE goal_role_assignments SET IsActive = 0, RevokedBy = @RevokedBy, RevokedDate = NOW()
         WHERE pk_id IN @Ids AND isdeleted = 0`,
        { Ids: [...new Set(all)], RevokedBy: revokedByMemberId },
      );
    });
  }

  /** Replace the holder (and the RI Director's zones / District Assistant's districts) without revoking. */
  async changeRoleAssignment(assignmentId: number, req: ChangeGoalRoleAssignmentRequest, changedByMemberId: number): Promise<void> {
    if (req.memberId <= 0 && !(req.memberNameText && req.memberNameText.trim())) throw new InvalidOperationException("Select a member, or type a name.");
    await this.db.session(async (conn) => {
      const a = await conn.queryFirstOrDefault("SELECT RoleType FROM goal_role_assignments WHERE pk_id = @Id AND IsActive = 1 AND isdeleted = 0", { Id: assignmentId });
      if (!a) throw new InvalidOperationException("Assignment not found or already revoked.");
      const roleType = String(a.RoleType);
      await conn.transaction(async (tx) => {
        const hasFreeText = !!req.memberNameText && !!req.memberNameText.trim();
        await tx.execute(
          `UPDATE goal_role_assignments
           SET fk_member_id = @MemberId, MemberNameText = @NameText, AssignedBy = @By, AssignedDate = NOW()
           WHERE pk_id = @Id`,
          { MemberId: req.memberId, NameText: hasFreeText ? req.memberNameText!.trim() : null, By: changedByMemberId, Id: assignmentId },
        );
        if (roleType === RI_DIRECTOR && req.zoneIds) {
          const newZones = [...new Set(req.zoneIds)];
          if (!newZones.length) throw new InvalidOperationException("At least one zone is required for an RI Director.");
          const oldZones = (await tx.query("SELECT fk_zone_id AS id FROM goal_role_assignment_zones WHERE fk_assignment_id = @Id", { Id: assignmentId })).map((r) => Number(r.id));
          const removed = oldZones.filter((z) => !newZones.includes(z));
          const added = newZones.filter((z) => !oldZones.includes(z));
          for (const z of removed) await tx.execute("DELETE FROM goal_role_assignment_zones WHERE fk_assignment_id = @Id AND fk_zone_id = @Z", { Id: assignmentId, Z: z });
          for (const z of added) await tx.execute("INSERT INTO goal_role_assignment_zones (fk_assignment_id, fk_zone_id) VALUES (@Id, @Z)", { Id: assignmentId, Z: z });
          if (removed.length)
            await tx.execute(
              `UPDATE goal_role_assignments SET IsActive = 0, RevokedBy = @By, RevokedDate = NOW()
               WHERE IsActive = 1 AND isdeleted = 0
                 AND RoleType IN ('AllDistrictsOneCategoryOneZone','FewDistrictsOneCategoryOneZone')
                 AND fk_zone_id IN @Removed`,
              { By: changedByMemberId, Removed: removed },
            );
        } else if (roleType === ZONE_COORDINATOR && req.zoneId !== null && req.zoneId > 0) {
          await tx.execute("UPDATE goal_role_assignments SET fk_zone_id = @Z, AssignedBy = @By, AssignedDate = NOW() WHERE pk_id = @Id", { Z: req.zoneId, By: changedByMemberId, Id: assignmentId });
        }
        if (roleType === DISTRICT_ASSISTANT && req.districtIds) {
          if (!req.districtIds.length) throw new InvalidOperationException("At least one district is required for a District Assistant.");
          await tx.execute("DELETE FROM goal_role_assignment_districts WHERE fk_assignment_id = @Id", { Id: assignmentId });
          for (const d of [...new Set(req.districtIds)]) await tx.execute("INSERT INTO goal_role_assignment_districts (fk_assignment_id, fk_district_id) VALUES (@Id, @D)", { Id: assignmentId, D: d });
        }
      });
    });
    if (req.memberId > 0) await this.roleService.ensureLoginAndNotify(req.memberId, changedByMemberId, false).catch(() => undefined);
  }

  /** The login email to the ONE holder of this assignment (their highest goal role decides the wording). */
  async sendCredentialsEmail(assignmentId: number, requestedByMemberId: number): Promise<number> {
    return this.db.session(async (conn) => {
      const row = await conn.queryFirstOrDefault(
        `SELECT a.fk_member_id AS memberId,
                (SELECT MIN(CASE x.RoleType
                              WHEN 'AllCategoryAllDistrictsFewZones' THEN 1
                              WHEN 'AllDistrictsOneCategoryOneZone'  THEN 2
                              ELSE 3 END)
                   FROM goal_role_assignments x
                  WHERE x.fk_member_id = a.fk_member_id AND x.IsActive = 1 AND x.isdeleted = 0) AS roleRank
         FROM goal_role_assignments a
         JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_id
              AND m.isdeleted = 0 AND m.EmailId IS NOT NULL AND m.EmailId <> ''
         WHERE a.pk_id = @Id AND a.IsActive = 1 AND a.isdeleted = 0 AND a.fk_member_id > 0`,
        { Id: assignmentId },
      );
      if (!row) return 0;
      await this.roleService.sendGoalRoleCredentialsEmail(Number(row.memberId), roleTypeFromRank(Number(row.roleRank)), requestedByMemberId);
      await conn.execute("UPDATE goal_role_assignments SET RoleEmailSentDate = NOW() WHERE pk_id = @Id", { Id: assignmentId });
      return 1;
    });
  }

  /** Zones already held by an active RI Director (the assignment being edited excluded). */
  async getAssignedDirectorZoneIds(excludeAssignmentId: number | null): Promise<number[]> {
    return (await this.db.query(
      `SELECT DISTINCT z.fk_zone_id AS id
       FROM goal_role_assignment_zones z
       JOIN goal_role_assignments a ON a.pk_id = z.fk_assignment_id
       WHERE a.RoleType = 'AllCategoryAllDistrictsFewZones' AND a.IsActive = 1 AND a.isdeleted = 0
         AND (@Exclude IS NULL OR a.pk_id <> @Exclude)`,
      { Exclude: excludeAssignmentId },
    )).map((r) => Number(r.id));
  }

  /** The role email to every active holder (one per member, highest role), optionally one zone. Best-effort. */
  async sendAllRoleAssignmentEmails(requestedByMemberId: number, zoneId: number | null = null): Promise<number> {
    return this.db.session(async (conn) => {
      const rows = await conn.query(
        `SELECT a.fk_member_id AS memberId,
                MIN(CASE a.RoleType
                      WHEN 'AllCategoryAllDistrictsFewZones' THEN 1
                      WHEN 'AllDistrictsOneCategoryOneZone'  THEN 2
                      ELSE 3 END) AS roleRank
         FROM goal_role_assignments a
         JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_id
              AND m.isdeleted = 0 AND m.EmailId IS NOT NULL AND m.EmailId <> ''
         LEFT JOIN goal_role_assignment_zones z ON z.fk_assignment_id = a.pk_id
         WHERE a.IsActive = 1 AND a.isdeleted = 0 AND a.fk_member_id > 0
           AND (@ZoneId IS NULL OR z.fk_zone_id = @ZoneId OR a.fk_zone_id = @ZoneId)
         GROUP BY a.fk_member_id`,
        { ZoneId: zoneId },
      );
      let sent = 0;
      for (const r of rows) {
        try {
          await this.roleService.sendGoalRoleCredentialsEmail(Number(r.memberId), roleTypeFromRank(Number(r.roleRank)), requestedByMemberId);
          sent++;
          await conn.execute(
            `UPDATE goal_role_assignments a
             LEFT JOIN goal_role_assignment_zones z ON z.fk_assignment_id = a.pk_id
             SET a.RoleEmailSentDate = NOW()
             WHERE a.fk_member_id = @M AND a.IsActive = 1 AND a.isdeleted = 0
               AND (@ZoneId IS NULL OR z.fk_zone_id = @ZoneId OR a.fk_zone_id = @ZoneId)`,
            { M: Number(r.memberId), ZoneId: zoneId },
          );
        } catch {
          /* best-effort; keep sending to the rest */
        }
      }
      return sent;
    });
  }

  // ── Leadership designations ───────────────────────────────────────────────

  async getDesignations(): Promise<GoalDesignationDto[]> {
    return (await this.db.query(
      `SELECT d.pk_id AS id, d.Title AS title, d.Avenue AS avenue, d.RoleType AS roleType,
              d.DefaultCategoryName AS defaultCategoryName, c.pk_category_id AS defaultCategoryId,
              d.SortOrder AS sortOrder
       FROM goal_leadership_designations d
       LEFT JOIN goal_categories c ON c.Name = d.DefaultCategoryName AND c.isdeleted = 0
       WHERE d.isdeleted = 0 AND d.IsActive = 1
       ORDER BY d.SortOrder, d.Title`,
    )).map((r) => ({
      id: Number(r.id), title: String(r.title), avenue: String(r.avenue), roleType: String(r.roleType), defaultCategoryName: r.defaultCategoryName ?? null,
      defaultCategoryId: r.defaultCategoryId === null ? null : Number(r.defaultCategoryId), sortOrder: Number(r.sortOrder),
    }));
  }

  /** Idempotent by Title: an existing (even inactive) row is refreshed and re-activated. */
  async addDesignation(req: CreateGoalDesignationRequest): Promise<GoalDesignationDto> {
    if (!req.title || !req.title.trim()) throw new InvalidOperationException("Title is required.");
    if (!req.avenue || !req.avenue.trim()) throw new InvalidOperationException("Avenue is required.");
    if (!VALID_ROLE_TYPES.has(req.roleType)) throw new InvalidOperationException("Pick a valid role type.");
    await this.db.execute(
      `INSERT INTO goal_leadership_designations (Title, Avenue, RoleType, DefaultCategoryName, SortOrder, IsActive, isdeleted)
       VALUES (@Title, @Avenue, @RoleType, @Category, 900, 1, 0)
       ON DUPLICATE KEY UPDATE
           Avenue = VALUES(Avenue), RoleType = VALUES(RoleType),
           DefaultCategoryName = VALUES(DefaultCategoryName), IsActive = 1, isdeleted = 0`,
      { Title: req.title.trim(), Avenue: req.avenue.trim(), RoleType: req.roleType, Category: blankToNull(req.defaultCategoryName) },
    );
    return (await this.getDesignations()).find((d) => d.title.toLowerCase() === req.title.trim().toLowerCase())!;
  }

  // ── What the caller holds, and the scoped views it unlocks ────────────────

  async getMyAssignments(memberId: number): Promise<GoalMyAssignmentDto[]> {
    return this.db.session(async (conn) => {
      const rows = await this.getActiveAssignmentRows(conn, memberId);
      const allCategoryIds = (await conn.query("SELECT pk_category_id AS id FROM goal_categories WHERE isdeleted = 0")).map((r) => Number(r.id));
      const result: GoalMyAssignmentDto[] = [];
      for (const r of rows) {
        const assignmentId = Number(r.id);
        const roleType = String(r.roleType);
        const dto: GoalMyAssignmentDto = { assignmentId, roleType, assignmentName: String(r.assignmentName), categoryIds: [], districtIds: [], zoneIds: [], canBulkLock: roleType === RI_DIRECTOR };
        if (roleType === RI_DIRECTOR) {
          dto.categoryIds = allCategoryIds;
          dto.zoneIds = (await conn.query("SELECT fk_zone_id AS id FROM goal_role_assignment_zones WHERE fk_assignment_id = @Id", { Id: assignmentId })).map((x) => Number(x.id));
          if (dto.zoneIds.length) dto.districtIds = (await conn.query("SELECT pk_district_id AS id FROM district_master WHERE fk_zone_id IN @ZoneIds AND isdeleted = 0 AND IsActive = 1", { ZoneIds: dto.zoneIds })).map((x) => Number(x.id));
        } else {
          if (r.categoryId !== null) dto.categoryIds = [Number(r.categoryId)];
          // a Zone Co-ordinator's category is a label: the zone is their boundary, so every category
          if (roleType === ZONE_COORDINATOR) dto.categoryIds = allCategoryIds;
          const zoneId = r.zoneId === null ? null : Number(r.zoneId);
          if (zoneId !== null) dto.zoneIds = [zoneId];
          if (roleType === ZONE_COORDINATOR && zoneId !== null)
            dto.districtIds = (await conn.query("SELECT pk_district_id AS id FROM district_master WHERE fk_zone_id = @ZoneId AND isdeleted = 0 AND IsActive = 1", { ZoneId: zoneId })).map((x) => Number(x.id));
          else if (roleType === DISTRICT_ASSISTANT)
            dto.districtIds = (await conn.query("SELECT fk_district_id AS id FROM goal_role_assignment_districts WHERE fk_assignment_id = @Id", { Id: assignmentId })).map((x) => Number(x.id));
        }
        result.push(dto);
      }
      return result;
    });
  }

  /** Districts the member may view for a category across all assignments; null = SuperAdmin (unrestricted). */
  private async resolveScopedDistrictIds(conn: DbCommands, memberId: number, categoryId: number): Promise<Set<number> | null> {
    if (await this.isSuperAdmin(conn, memberId)) return null;
    const out = new Set<number>();
    for (const a of await this.getMyAssignments(memberId)) if (a.categoryIds.includes(categoryId)) a.districtIds.forEach((d) => out.add(d));
    return out;
  }

  async getScopedDistrictsGoalList(memberId: number, categoryId: number, yearId: number): Promise<GoalDistrictSummaryDto[]> {
    return this.db.session(async (conn) => {
      const scoped = await this.resolveScopedDistrictIds(conn, memberId, categoryId);
      if (scoped !== null && scoped.size === 0) throw new UnauthorizedAccessException("You have no goal-setting oversight access for this category.");
      const rows = await conn.query(
        `SELECT d.pk_district_id AS districtId, d.DistrictNumber AS districtNumber, d.fk_zone_id AS zoneId, z.ZoneName AS zoneName,
                (SELECT COUNT(*) FROM goal_entries e
                  JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0
                 WHERE f.fk_category_id = @CategoryId AND e.fk_year_id = @YearId
                   AND e.EntityType = 'District' AND e.fk_district_id = d.pk_district_id AND e.isdeleted = 0) AS entryCount,
                (SELECT DATE_FORMAT(MAX(COALESCE(e.modified_date, e.created_date)), '%Y-%m-%d %H:%i')
                   FROM goal_entries e JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0
                  WHERE f.fk_category_id = @CategoryId AND e.fk_year_id = @YearId
                    AND e.EntityType = 'District' AND e.fk_district_id = d.pk_district_id AND e.isdeleted = 0) AS lastUpdatedDate,
                (SELECT l.IsLocked FROM goal_locks l
                  WHERE l.EntityType = 'District' AND l.fk_district_id = d.pk_district_id AND l.fk_club_id = 0
                    AND l.fk_category_id = @CategoryId AND l.fk_year_id = @YearId) AS isLocked
         FROM district_master d
         LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
         WHERE d.isdeleted = 0 AND d.IsActive = 1
           AND (@Unrestricted = 1 OR d.pk_district_id IN @DistrictIds)
         ORDER BY d.DistrictNumber`,
        { CategoryId: categoryId, YearId: yearId, Unrestricted: scoped === null ? 1 : 0, DistrictIds: [...(scoped ?? [])] },
      );
      return rows.map((r) => ({
        districtId: Number(r.districtId), districtNumber: String(r.districtNumber), zoneId: r.zoneId === null ? 0 : Number(r.zoneId), zoneName: r.zoneName ?? null,
        hasAnyGoalSet: Number(r.entryCount ?? 0) > 0, lastUpdatedDate: r.lastUpdatedDate ?? null, isLocked: r.isLocked !== null && r.isLocked !== undefined && Boolean(Number(r.isLocked)),
      }));
    });
  }

  async getScopedDistrictGoalForm(memberId: number, categoryId: number, yearId: number, districtId: number): Promise<GoalCategoryFormDto> {
    return this.db.session(async (conn) => {
      const scoped = await this.resolveScopedDistrictIds(conn, memberId, categoryId);
      if (scoped !== null && !scoped.has(districtId)) throw new UnauthorizedAccessException("You are not authorised to view this district's goals.");
      const y = await this.resolveYear(conn, yearId);
      if (y.yearId === 0) throw new InvalidOperationException("No active Rotary year found.");
      return this.buildDistrictFormDto(conn, memberId, categoryId, districtId, y.yearId, y.yearLabel, y.isEditable);
    });
  }

  /** Bulk lock / unlock DISTRICT goals: SuperAdmin, or an RI Director within their zones. */
  async bulkLockDistricts(memberId: number, req: GoalBulkLockRequest): Promise<GoalBulkLockResultDto> {
    if (req.yearId <= 0) throw new InvalidOperationException("yearId required");
    return this.db.session(async (conn) => {
      let allowed: number[];
      if (await this.isSuperAdmin(conn, memberId)) allowed = (await conn.query("SELECT pk_zone_id AS id FROM zone_master WHERE isdeleted = 0")).map((r) => Number(r.id));
      else {
        const bulk = (await this.getMyAssignments(memberId)).find((a) => a.canBulkLock);
        if (!bulk) throw new UnauthorizedAccessException("You are not authorised to bulk lock/unlock goals.");
        allowed = bulk.zoneIds;
      }
      const zoneIds = req.zoneIds && req.zoneIds.length ? req.zoneIds.filter((z) => allowed.includes(z)) : allowed;
      if (!zoneIds.length) throw new InvalidOperationException("No zones in scope.");
      const categoryIds = req.categoryIds && req.categoryIds.length ? req.categoryIds : (await conn.query("SELECT pk_category_id AS id FROM goal_categories WHERE isdeleted = 0")).map((r) => Number(r.id));
      const districtIds = (await conn.query("SELECT pk_district_id AS id FROM district_master WHERE fk_zone_id IN @ZoneIds AND isdeleted = 0 AND IsActive = 1", { ZoneIds: zoneIds })).map((r) => Number(r.id));
      let affected = 0;
      for (const d of districtIds)
        for (const c of categoryIds) {
          await this.setLock(conn, "District", 0, d, c, req.yearId, req.locked, memberId);
          affected++;
        }
      return { affectedCount: affected };
    });
  }
}
