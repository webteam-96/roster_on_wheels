import type { DbCommands, Row } from "../../database/db.service";
import { Brand } from "../../brand/brand";
import { formatDate, nowIn } from "../../common/dotnet-format";
import { InvalidOperationException, UnauthorizedAccessException } from "../../common/exceptions";
import { isDistrictAdminWithClubAccess } from "../../services/club-admin-access.helper";
import { ExcelJS, toBuffer } from "../../services/xlsx";
import { GoalRoles } from "./goal-roles";
import type { DistrictSideRow } from "./goal-reports";
import type {
  GoalCommentDto, GoalDistrictConversationDto, GoalDistrictMessagesDto, GoalMessageOwnerDto, GoalMessageRowDto, GoalMessageThreadDto, GoalObserverRoleDto, GoalThreadListDto,
} from "./goal-setting.dtos";

const ZC = "AllDistrictsOneCategoryOneZone";
const DA = "FewDistrictsOneCategoryOneZone";
const DISTRICT_SIDE_TIER = 1;
/** District-side messages are stored with ThreadOwnerMemberId = -districtId. */
const districtThreadKey = (districtId: number) => -districtId;
/** "now" in the zone the database stores (UTC), as DATE_FORMAT(created_date) prints it. */
const dbNow = () => formatDate(nowIn("UTC"), "yyyy-MM-dd HH:mm");
const ms = (v: unknown) => (v === null || v === undefined ? NaN : Date.parse(String(v).endsWith("Z") ? String(v) : String(v) + "Z"));
const newer = (created: unknown, lastSeen: unknown) => lastSeen === null || lastSeen === undefined || ms(created) > ms(lastSeen);

const tierRoleLabel = (t: number) => ({ 5: "SuperAdmin", 4: "RI Director", 3: "Zone Co-ordinator", 2: "District Assistant" } as Record<number, string>)[t] ?? "";
const tierLabel = (tier: number, clubThread: boolean) =>
  clubThread
    ? ({ 5: "SuperAdmin", 2: "District Admin", 1: "Club Admin" } as Record<number, string>)[tier] ?? ""
    : ({ 5: "SuperAdmin", 4: "Zonal Action Plan", 3: "Regional Co-ordinator", 2: "Assistant Co-ordinator", 1: "District Admin" } as Record<number, string>)[tier] ?? "";

const newThread = (o: Partial<GoalMessageThreadDto>): GoalMessageThreadDto => ({
  ownerMemberId: 0, ownerName: "", ownerRoleLabel: "", scope: null, isMine: false, lastMessagePreview: null, lastMessageDate: null,
  messageCount: 0, unreadCount: 0, isFormer: false, counterpartyName: null, canPost: false, notice: null, ...o,
});
const comment = (o: Partial<GoalCommentDto>): GoalCommentDto => ({
  id: 0, commentText: "", postedByMemberId: 0, postedByName: "", postedByTier: 0, createdDate: null, postedByRoleLabel: null, isMine: false,
  districtId: 0, districtNumber: null, categoryName: null, ...o,
});

// ── Messages follow the SEAT (goal_role_assignments row), not the person ──────────────────────

/** WHERE fragment for one thread (alias c; params @SeatIds, @SeatOwner). */
const seatThreadFilterSql = (hasSeats: boolean) =>
  !hasSeats
    ? "c.ThreadOwnerMemberId = @SeatOwner"
    : `(c.fk_assignment_id IN @SeatIds
         OR (c.fk_assignment_id = 0 AND c.ThreadOwnerMemberId = @SeatOwner)
         OR EXISTS (
            SELECT 1 FROM goal_role_assignments x
            JOIN goal_role_assignments s ON s.pk_id IN @SeatIds
            WHERE x.pk_id = c.fk_assignment_id AND (x.IsActive = 0 OR x.isdeleted = 1)
              AND x.RoleType = s.RoleType AND x.fk_zone_id = s.fk_zone_id AND x.fk_category_id = s.fk_category_id
              AND (s.RoleType = 'AllDistrictsOneCategoryOneZone'
                   OR (c.fk_district_id > 0 AND EXISTS (SELECT 1 FROM goal_role_assignment_districts sd
                         WHERE sd.fk_assignment_id = s.pk_id AND sd.fk_district_id = c.fk_district_id))
                   OR (c.fk_district_id = 0 AND EXISTS (SELECT 1 FROM goal_role_assignment_districts sd
                         JOIN goal_role_assignment_districts xd ON xd.fk_district_id = sd.fk_district_id
                         WHERE sd.fk_assignment_id = s.pk_id AND xd.fk_assignment_id = x.pk_id)))))`;
const seatParams = (categoryId: number, yearId: number, seatIds: number[], owner: number): Record<string, unknown> => ({ C: categoryId, Y: yearId, SeatOwner: owner, ...(seatIds.length ? { SeatIds: seatIds } : {}) });

/** The member's ACTIVE Zone Co-ordinator / District Assistant seats in a category. */
async function activeMessageSeatIds(conn: DbCommands, memberId: number, categoryId: number, zoneId: number | null = null, roleType: string | null = null, districtId: number | null = null) {
  return (await conn.query(
    `SELECT a.pk_id AS id FROM goal_role_assignments a
     WHERE a.fk_member_id=@M AND a.fk_category_id=@C AND a.IsActive=1 AND a.isdeleted=0
       AND a.RoleType IN ('AllDistrictsOneCategoryOneZone','FewDistrictsOneCategoryOneZone')
       AND (@Z IS NULL OR a.fk_zone_id=@Z) AND (@RT IS NULL OR a.RoleType=@RT)
       AND (@D IS NULL OR a.RoleType='AllDistrictsOneCategoryOneZone' OR EXISTS (
             SELECT 1 FROM goal_role_assignment_districts d WHERE d.fk_assignment_id=a.pk_id AND d.fk_district_id=@D))
     ORDER BY a.pk_id DESC`,
    { M: memberId, C: categoryId, Z: zoneId, RT: roleType, D: districtId },
  )).map((r) => Number(r.id));
}

async function seatThreadSummary(conn: DbCommands, p: Record<string, unknown>, hasSeats: boolean, extraWhere = "") {
  const where = `c.fk_category_id=@C AND c.fk_year_id=@Y AND c.isdeleted=0 ${extraWhere} AND ${seatThreadFilterSql(hasSeats)}`;
  const cnt = Number(await conn.executeScalar(`SELECT COUNT(*) FROM goal_comments c WHERE ${where}`, p));
  if (cnt === 0) return { count: 0, lastText: null, lastDate: null };
  const last = await conn.queryFirstOrDefault(`SELECT c.CommentText AS text, DATE_FORMAT(c.created_date,'%Y-%m-%d %H:%i') AS dt FROM goal_comments c WHERE ${where} ORDER BY c.created_date DESC LIMIT 1`, p);
  return { count: cnt, lastText: (last?.text as string) ?? null, lastDate: (last?.dt as string) ?? null };
}

async function threadLastSeen(conn: DbCommands, viewer: number, owner: number, categoryId: number, yearId: number) {
  return conn.executeScalar(
    `SELECT last_seen_date FROM goal_message_thread_seen
     WHERE fk_member_id=@M AND ThreadOwnerMemberId=@O AND fk_category_id=@C AND fk_year_id=@Y`,
    { M: viewer, O: owner, C: categoryId, Y: yearId },
  );
}

/** Messages of THIS conversation the viewer has not seen, ignoring their own. */
async function seatThreadUnread(conn: DbCommands, p: Record<string, unknown>, hasSeats: boolean, viewer: number, owner: number, categoryId: number, yearId: number, extraWhere = "") {
  const lastSeen = await threadLastSeen(conn, viewer, owner, categoryId, yearId);
  return Number(await conn.executeScalar(
    `SELECT COUNT(*) FROM goal_comments c
     WHERE c.fk_category_id=@C AND c.fk_year_id=@Y AND c.isdeleted=0 ${extraWhere}
       AND ${seatThreadFilterSql(hasSeats)}
       AND c.PostedByMemberId <> @Viewer
       AND (@LastSeen IS NULL OR c.created_date > @LastSeen)`,
    { ...p, Viewer: viewer, LastSeen: lastSeen ?? null },
  ));
}

async function markThreadSeen(conn: DbCommands, viewer: number, owner: number, categoryId: number, yearId: number) {
  if (viewer <= 0 || owner <= 0) return;
  await conn.execute(
    `INSERT INTO goal_message_thread_seen
         (fk_member_id, ThreadOwnerMemberId, fk_category_id, fk_year_id, last_seen_date)
     VALUES (@M, @O, @C, @Y, NOW())
     ON DUPLICATE KEY UPDATE last_seen_date = NOW()`,
    { M: viewer, O: owner, C: categoryId, Y: yearId },
  );
}

async function commentsWhere(conn: DbCommands, viewer: number, p: Record<string, unknown>, where: string): Promise<GoalCommentDto[]> {
  return (await conn.query(
    `SELECT c.pk_id AS id, c.CommentText AS commentText, c.PostedByMemberId AS postedByMemberId,
            m.MemberName AS postedByName, c.PostedByTier AS postedByTier,
            c.fk_district_id AS districtId, dm.DistrictNumber AS districtNumber,
            DATE_FORMAT(c.created_date,'%Y-%m-%d %H:%i') AS createdDate
     FROM goal_comments c LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id=c.PostedByMemberId
     LEFT JOIN district_master dm ON dm.pk_district_id = c.fk_district_id
     WHERE ${where}
     ORDER BY c.created_date ASC, c.pk_id ASC`,
    p,
  )).map((r) => {
    const t = Number(r.postedByTier), did = r.districtId === null ? 0 : Number(r.districtId);
    return comment({
      id: Number(r.id), commentText: String(r.commentText), postedByMemberId: Number(r.postedByMemberId), postedByName: r.postedByName ?? "", postedByTier: t,
      postedByRoleLabel: tierRoleLabel(t), isMine: Number(r.postedByMemberId) === viewer, createdDate: r.createdDate ?? null, districtId: did, districtNumber: did > 0 ? r.districtNumber ?? null : null,
    });
  });
}
const seatThreadMessages = (conn: DbCommands, viewer: number, p: Record<string, unknown>, hasSeats: boolean, extraWhere = "") =>
  commentsWhere(conn, viewer, p, `c.fk_category_id=@C AND c.fk_year_id=@Y AND c.isdeleted=0 ${extraWhere} AND ${seatThreadFilterSql(hasSeats)}`);

async function rosterMessageCount(conn: DbCommands, owner: number, categoryId: number, yearId: number, districtId: number) {
  const seats = await activeMessageSeatIds(conn, owner, categoryId);
  return (await seatThreadSummary(conn, { ...seatParams(categoryId, yearId, seats, owner), Did: districtId }, seats.length > 0, "AND (@Did=0 OR c.fk_district_id=@Did)")).count;
}
async function rosterUnreadCount(conn: DbCommands, viewer: number, owner: number, categoryId: number, yearId: number, districtId: number) {
  const seats = await activeMessageSeatIds(conn, owner, categoryId);
  return seatThreadUnread(conn, { ...seatParams(categoryId, yearId, seats, owner), Did: districtId }, seats.length > 0, viewer, owner, categoryId, yearId, "AND (@Did=0 OR c.fk_district_id=@Did)");
}

const memberName = async (conn: DbCommands, id: number) => String((await conn.executeScalar("SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id = @Id", { Id: id })) ?? "");
const districtZoneId = async (conn: DbCommands, districtId: number) => Number((await conn.executeScalar("SELECT fk_zone_id FROM district_master WHERE pk_district_id = @Id", { Id: districtId })) ?? 0);
async function riDirectorForZone(conn: DbCommands, zoneId: number): Promise<number | null> {
  const v = await conn.executeScalar(
    `SELECT a.fk_member_id
     FROM goal_role_assignments a
     JOIN goal_role_assignment_zones z ON z.fk_assignment_id = a.pk_id
     WHERE a.RoleType = 'AllCategoryAllDistrictsFewZones' AND a.IsActive = 1 AND a.isdeleted = 0
       AND a.fk_member_id > 0 AND z.fk_zone_id = @ZoneId
     ORDER BY a.pk_id DESC LIMIT 1`,
    { ZoneId: zoneId },
  );
  return v === null || v === undefined ? null : Number(v);
}
const isRdOfZone = async (conn: DbCommands, memberId: number, zoneId: number) =>
  Number(await conn.executeScalar(
    `SELECT COUNT(*) FROM goal_role_assignments a JOIN goal_role_assignment_zones z ON z.fk_assignment_id=a.pk_id
     WHERE a.RoleType='AllCategoryAllDistrictsFewZones' AND a.IsActive=1 AND a.isdeleted=0
       AND a.fk_member_id=@M AND z.fk_zone_id=@Z`,
    { M: memberId, Z: zoneId },
  )) > 0;
const holdsSeat = async (conn: DbCommands, memberId: number, roleType: string, categoryId: number, zoneId: number) =>
  Number(await conn.executeScalar(
    "SELECT COUNT(*) FROM goal_role_assignments WHERE RoleType=@RT AND IsActive=1 AND isdeleted=0 AND fk_member_id=@M AND fk_category_id=@C AND fk_zone_id=@Z",
    { RT: roleType, M: memberId, C: categoryId, Z: zoneId },
  )) > 0;

type RiZoneMsg = { id: number; owner: number; postedBy: number; created: string; text: string; district: number };
type RiZoneBox = { ownerId: number; label: string; scope: string; isFormer: boolean; msgs: RiZoneMsg[] };
const RI_ZONE_MSG_COLUMNS = "c.pk_id AS Id, c.ThreadOwnerMemberId AS Owner, c.PostedByMemberId AS PostedBy, c.created_date AS Created, c.CommentText AS Text, c.fk_district_id AS District";
const toMsg = (r: Row): RiZoneMsg => ({ id: Number(r.Id), owner: Number(r.Owner), postedBy: Number(r.PostedBy), created: String(r.Created), text: String(r.Text ?? ""), district: Number(r.District ?? 0) });

/** ZC + DA owners of (category, zone): null filter = all; 0 = ZC only; >0 = that district's DA(s). */
async function zoneThreadOwners(conn: DbCommands, categoryId: number, zoneId: number, filterDistrictId: number | null = null) {
  const owners: { memberId: number; label: string; scope: string }[] = [];
  const zoneName = String((await conn.executeScalar("SELECT ZoneName FROM zone_master WHERE pk_zone_id=@Z", { Z: zoneId })) ?? "");
  if (filterDistrictId === null || filterDistrictId === 0)
    for (const r of await conn.query(
      `SELECT fk_member_id AS m, RoleTitle AS t FROM goal_role_assignments
       WHERE RoleType='AllDistrictsOneCategoryOneZone' AND IsActive=1 AND isdeleted=0
         AND fk_category_id=@C AND fk_zone_id=@Z AND fk_member_id>0`,
      { C: categoryId, Z: zoneId },
    )) owners.push({ memberId: Number(r.m), label: r.t ?? "Zone Co-ordinator", scope: `Zone ${zoneName}` });
  if (filterDistrictId === null || filterDistrictId > 0)
    for (const r of await conn.query(
      `SELECT a.pk_id AS id, a.fk_member_id AS m, a.RoleTitle AS t FROM goal_role_assignments a
       WHERE a.RoleType='FewDistrictsOneCategoryOneZone' AND a.IsActive=1 AND a.isdeleted=0
         AND a.fk_category_id=@C AND a.fk_zone_id=@Z AND a.fk_member_id>0`,
      { C: categoryId, Z: zoneId },
    )) {
      const drows = await conn.query(
        `SELECT d.fk_district_id AS did, dm.DistrictNumber AS dn FROM goal_role_assignment_districts d
         JOIN district_master dm ON dm.pk_district_id=d.fk_district_id WHERE d.fk_assignment_id=@A`,
        { A: Number(r.id) },
      );
      if (filterDistrictId !== null && filterDistrictId > 0 && !drows.some((x) => Number(x.did) === filterDistrictId)) continue;
      const dnums = drows.map((x) => String(x.dn));
      owners.push({ memberId: Number(r.m), label: r.t ?? "District Assistant", scope: dnums.length ? "D " + dnums.join(", ") : `Zone ${zoneName}` });
    }
  return owners;
}

/** The RI Director / SuperAdmin boxes of a zone + category: current owners plus read-only "Former …" ones. */
async function riZoneBoxes(conn: DbCommands, categoryId: number, zoneId: number, yearId: number, filterDistrictId: number | null): Promise<RiZoneBox[]> {
  const boxes: RiZoneBox[] = [];
  const covered = new Set<number>();
  for (const o of await zoneThreadOwners(conn, categoryId, zoneId, filterDistrictId)) {
    const seats = await activeMessageSeatIds(conn, o.memberId, categoryId);
    const msgs = (await conn.query(
      `SELECT ${RI_ZONE_MSG_COLUMNS} FROM goal_comments c
       WHERE c.fk_category_id=@C AND c.fk_year_id=@Y AND c.isdeleted=0 AND ${seatThreadFilterSql(seats.length > 0)}`,
      seatParams(categoryId, yearId, seats, o.memberId),
    )).map(toMsg);
    msgs.forEach((m) => covered.add(m.id));
    boxes.push({ ownerId: o.memberId, label: o.label, scope: o.scope, isFormer: false, msgs });
  }
  const rest = (await conn.query(
    `SELECT ${RI_ZONE_MSG_COLUMNS} FROM goal_comments c
     WHERE c.fk_category_id=@C AND c.fk_year_id=@Y AND c.fk_zone_id=@Z
       AND c.ThreadOwnerMemberId > 0 AND c.isdeleted=0`,
    { C: categoryId, Y: yearId, Z: zoneId },
  )).map(toMsg).filter((m) => !covered.has(m.id));
  const groups = new Map<number, RiZoneMsg[]>();
  for (const m of rest) groups.set(m.owner, [...(groups.get(m.owner) ?? []), m]);
  for (const [owner, g] of groups) {
    const own = boxes.find((b) => b.ownerId === owner);
    if (own) { own.msgs.push(...g); continue; }
    if (filterDistrictId !== null) continue;
    const last = await conn.queryFirstOrDefault(
      `SELECT RoleTitle AS t, RoleType AS rt FROM goal_role_assignments
       WHERE fk_member_id=@O AND fk_category_id=@C AND fk_zone_id=@Z
         AND RoleType IN ('AllDistrictsOneCategoryOneZone','FewDistrictsOneCategoryOneZone')
       ORDER BY pk_id DESC LIMIT 1`,
      { O: owner, C: categoryId, Z: zoneId },
    );
    const role = last?.t ?? (last?.rt === ZC ? "Zone Co-ordinator" : "District Assistant");
    boxes.push({ ownerId: owner, label: `Former ${role}`, scope: "No longer holds this seat", isFormer: true, msgs: g });
  }
  for (const b of boxes) b.msgs.sort((a, c) => ms(a.created) - ms(c.created) || a.id - c.id);
  return boxes;
}
const riBoxUnread = (box: RiZoneBox, viewer: number, lastSeen: unknown) => box.msgs.filter((m) => m.postedBy !== viewer && newer(m.created, lastSeen)).length;

/** Who may READ district-side messages (alias c, param @Viewer). */
const DISTRICT_SIDE_SCOPE_SQL = `(
    EXISTS (SELECT 1 FROM goal_role_assignments a
            WHERE a.fk_member_id = @Viewer AND a.IsActive = 1 AND a.isdeleted = 0 AND (
                 (a.RoleType = 'AllCategoryAllDistrictsFewZones'
                  AND EXISTS (SELECT 1 FROM goal_role_assignment_zones z WHERE z.fk_assignment_id = a.pk_id AND z.fk_zone_id = c.fk_zone_id))
              OR (a.RoleType = 'AllDistrictsOneCategoryOneZone' AND a.fk_zone_id = c.fk_zone_id AND a.fk_category_id = c.fk_category_id)
              OR (a.RoleType = 'FewDistrictsOneCategoryOneZone' AND a.fk_category_id = c.fk_category_id
                  AND EXISTS (SELECT 1 FROM goal_role_assignment_districts d WHERE d.fk_assignment_id = a.pk_id AND d.fk_district_id = c.fk_district_id))))
 OR EXISTS (SELECT 1 FROM member_roles r
            WHERE r.fk_member_master_profile_id = @Viewer AND r.IsActive = 1 AND r.isdeleted = 0
              AND ((r.fk_role_id = 2 AND r.fk_district_id = c.fk_district_id AND COALESCE(r.fk_club_id,0) = 0)
                   OR (r.fk_role_id = 4 AND r.fk_zone_id = c.fk_zone_id)))
 OR EXISTS (SELECT 1 FROM district_governors g
            WHERE g.fk_member_id = @Viewer AND g.fk_district_id = c.fk_district_id AND g.fk_year_id = c.fk_year_id AND COALESCE(g.isdeleted,0) = 0))`;
const districtSideFilter = (isSuper: boolean) => `c.PostedByTier = ${DISTRICT_SIDE_TIER} AND c.ThreadOwnerMemberId < 0 AND c.isdeleted = 0` + (isSuper ? "" : " AND " + DISTRICT_SIDE_SCOPE_SQL);

/** "District Governor" / "District Admin" for a member writing about this district, else null. */
async function districtSidePosterRole(conn: DbCommands, memberId: number, districtId: number, yearId: number): Promise<string | null> {
  if (memberId <= 0 || districtId <= 0) return null;
  if (Number(await conn.executeScalar(
    `SELECT COUNT(*) FROM district_governors
     WHERE fk_member_id = @M AND fk_district_id = @D AND fk_year_id = @Y AND COALESCE(isdeleted,0) = 0`,
    { M: memberId, D: districtId, Y: yearId },
  )) > 0) return "District Governor";
  if (Number(await conn.executeScalar(
    `SELECT COUNT(*) FROM member_roles
     WHERE fk_member_master_profile_id = @M AND fk_role_id = 2 AND fk_district_id = @D
       AND COALESCE(fk_club_id,0) = 0 AND IsActive = 1 AND isdeleted = 0`,
    { M: memberId, D: districtId },
  )) > 0) return "District Admin";
  return null;
}

async function districtSideRows(conn: DbCommands, viewer: number, isSuper: boolean, yearId: number, zoneId: number, categoryId: number, districtId: number): Promise<DistrictSideRow[]> {
  const rows: DistrictSideRow[] = (await conn.query(
    `SELECT c.pk_id AS Id, c.fk_category_id AS CategoryId,
            IF(cat.Name = 'TRF', 'Foundation', cat.Name) AS CategoryName, cat.SortOrder AS CategorySort,
            c.fk_district_id AS DistrictId, dm.DistrictNumber AS DistrictNumber, c.fk_zone_id AS ZoneId,
            c.fk_year_id AS YearId, c.PostedByMemberId AS PostedBy, COALESCE(m.MemberName,'') AS FromName,
            c.CommentText AS Text, c.created_date AS Created
     FROM goal_comments c
     JOIN goal_categories cat ON cat.pk_category_id = c.fk_category_id AND cat.isdeleted = 0
     LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = c.PostedByMemberId
     LEFT JOIN district_master dm ON dm.pk_district_id = c.fk_district_id
     WHERE c.fk_year_id = @Y AND ${districtSideFilter(isSuper)}
       AND (@Z = 0 OR c.fk_zone_id = @Z) AND (@Cat = 0 OR c.fk_category_id = @Cat) AND (@D = 0 OR c.fk_district_id = @D)
     ORDER BY c.created_date, c.pk_id`,
    { Viewer: viewer, Y: yearId, Z: zoneId, Cat: categoryId, D: districtId },
  )).map((r) => ({
    id: Number(r.Id), categoryId: Number(r.CategoryId), categoryName: String(r.CategoryName ?? ""), categorySort: Number(r.CategorySort ?? 0), districtId: Number(r.DistrictId ?? 0),
    districtNumber: r.DistrictNumber ?? null, zoneId: Number(r.ZoneId ?? 0), yearId: Number(r.YearId), postedBy: Number(r.PostedBy ?? 0), fromName: String(r.FromName ?? ""),
    text: String(r.Text ?? ""), created: String(r.Created), fromRole: null,
  }));
  const cache = new Map<string, string>();
  for (const r of rows) {
    const key = `${r.postedBy}:${r.districtId}:${r.yearId}`;
    if (!cache.has(key)) cache.set(key, (await districtSidePosterRole(conn, r.postedBy, r.districtId, r.yearId)) ?? "District Admin");
    r.fromRole = cache.get(key)!;
  }
  return rows;
}

/**
 * Port of GoalSettingService.cs, layer 6: goal messaging — the club / district comment threads,
 * the private RI Director ↔ Zone Co-ordinator / District Assistant conversations (which follow the
 * seat, not the person), zone threads with "Former …" boxes, unread dots, District Admin / DG
 * messages, the inbox, the roster and the messages report.
 */
export abstract class GoalMessaging extends GoalRoles {
  // ── Original comment threads (district thread clubId 0, club thread clubId > 0) ──

  private async resolveThreadTier(conn: DbCommands, memberId: number, categoryId: number, districtId: number, clubId: number): Promise<number | null> {
    if (await this.isSuperAdmin(conn, memberId)) return 5;
    if (clubId > 0) {
      const isClubAdmin = Number(await conn.executeScalar(
        `SELECT COUNT(*) FROM member_roles
         WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2
           AND fk_club_id = @ClubId AND IsActive = 1 AND isdeleted = 0`,
        { MemberId: memberId, ClubId: clubId },
      ));
      if (isClubAdmin > 0) return 1;
      return (await isDistrictAdminWithClubAccess(conn, memberId, clubId)) ? 2 : null;
    }
    const tiers: number[] = [];
    if (Number(await conn.executeScalar(
      `SELECT COUNT(*) FROM member_roles
       WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2
         AND fk_district_id = @DistrictId AND (fk_club_id IS NULL OR fk_club_id = 0)
         AND IsActive = 1 AND isdeleted = 0`,
      { MemberId: memberId, DistrictId: districtId },
    )) > 0) tiers.push(1);
    for (const a of await this.getMyAssignments(memberId)) {
      if (!a.categoryIds.includes(categoryId) || !a.districtIds.includes(districtId)) continue;
      const tier = a.roleType === DA ? 2 : a.roleType === ZC ? 3 : a.roleType === "AllCategoryAllDistrictsFewZones" ? 4 : 0;
      if (tier > 0) tiers.push(tier);
    }
    return tiers.length ? Math.max(...tiers) : null;
  }

  async getComments(memberId: number, categoryId: number, districtId: number, clubId: number, yearId: number): Promise<GoalCommentDto[]> {
    return this.db.session(async (conn) => {
      if ((await this.resolveThreadTier(conn, memberId, categoryId, districtId, clubId)) === null) throw new UnauthorizedAccessException("You do not have access to this message thread.");
      const rows = await conn.query(
        `SELECT c.pk_id AS id, c.CommentText AS commentText, c.PostedByMemberId AS postedByMemberId,
                m.MemberName AS postedByName, c.PostedByTier AS postedByTier,
                (SELECT ra.RoleTitle FROM goal_role_assignments ra
                  WHERE ra.fk_member_id = c.PostedByMemberId AND ra.IsActive = 1 AND ra.isdeleted = 0
                    AND ra.RoleTitle IS NOT NULL ORDER BY ra.pk_id DESC LIMIT 1) AS roleTitle,
                DATE_FORMAT(c.created_date, '%Y-%m-%d %H:%i') AS createdDate
         FROM goal_comments c
         LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = c.PostedByMemberId
         WHERE c.fk_district_id = @DistrictId AND c.fk_category_id = @CategoryId
           AND c.fk_club_id = @ClubId AND c.fk_year_id = @YearId AND c.isdeleted = 0
         ORDER BY c.created_date ASC`,
        { DistrictId: districtId, CategoryId: categoryId, ClubId: clubId, YearId: yearId },
      );
      return rows.map((r) => comment({
        id: Number(r.id), commentText: String(r.commentText), postedByMemberId: Number(r.postedByMemberId), postedByName: r.postedByName ?? "",
        postedByTier: Number(r.postedByTier), postedByRoleLabel: r.roleTitle ?? tierLabel(Number(r.postedByTier), clubId > 0),
        isMine: Number(r.postedByMemberId) === memberId, createdDate: r.createdDate ?? null,
      }));
    });
  }

  async postComment(memberId: number, categoryId: number, districtId: number, clubId: number, yearId: number, commentText: string): Promise<GoalCommentDto> {
    if (!commentText || !commentText.trim()) throw new InvalidOperationException("Message text is required.");
    return this.db.session(async (conn) => {
      const tier = await this.resolveThreadTier(conn, memberId, categoryId, districtId, clubId);
      if (tier === null) throw new UnauthorizedAccessException("You do not have access to message on this thread.");
      const trimmed = commentText.trim();
      const id = Number(await conn.executeScalar(
        `INSERT INTO goal_comments (fk_category_id, fk_district_id, fk_club_id, fk_year_id, CommentText, PostedByMemberId, PostedByTier, created_date, isdeleted)
         VALUES (@CategoryId, @DistrictId, @ClubId, @YearId, @CommentText, @MemberId, @Tier, NOW(), 0);
         SELECT LAST_INSERT_ID();`,
        { CategoryId: categoryId, DistrictId: districtId, ClubId: clubId, YearId: yearId, CommentText: trimmed, MemberId: memberId, Tier: tier },
      ));
      const roleTitle = await conn.executeScalar(
        `SELECT RoleTitle FROM goal_role_assignments
         WHERE fk_member_id = @Id AND IsActive = 1 AND isdeleted = 0 AND RoleTitle IS NOT NULL
         ORDER BY pk_id DESC LIMIT 1`,
        { Id: memberId },
      );
      return comment({ id, commentText: trimmed, postedByMemberId: memberId, postedByName: await memberName(conn, memberId), postedByTier: tier, postedByRoleLabel: (roleTitle as string) ?? tierLabel(tier, clubId > 0), isMine: true, createdDate: dbNow() });
    });
  }

  // ── Pairwise threads per (category, district) ─────────────────────────────

  private async viewerMessagingRole(conn: DbCommands, memberId: number, categoryId: number, districtId: number, zoneId: number) {
    if (await this.isSuperAdmin(conn, memberId)) return "SuperAdmin";
    if (await isRdOfZone(conn, memberId, zoneId)) return "RIDirector";
    if (await holdsSeat(conn, memberId, ZC, categoryId, zoneId)) return "ZoneCoordinator";
    const isDa = Number(await conn.executeScalar(
      `SELECT COUNT(*) FROM goal_role_assignments a
       JOIN goal_role_assignment_districts d ON d.fk_assignment_id = a.pk_id
       WHERE a.RoleType = 'FewDistrictsOneCategoryOneZone' AND a.IsActive = 1 AND a.isdeleted = 0
         AND a.fk_member_id = @M AND a.fk_category_id = @C AND d.fk_district_id = @D`,
      { M: memberId, C: categoryId, D: districtId },
    ));
    return isDa > 0 ? "DistrictAssistant" : "None";
  }

  async getGoalThreadList(memberId: number, categoryId: number, districtId: number, yearId: number): Promise<GoalThreadListDto> {
    return this.db.session(async (conn) => {
      const zoneId = await districtZoneId(conn, districtId);
      const role = await this.viewerMessagingRole(conn, memberId, categoryId, districtId, zoneId);
      const result: GoalThreadListDto = { viewerRole: role, threads: [], ownerDistricts: [], canObservePost: false };
      if (role === "None" || zoneId === 0) return result;
      const riId = await riDirectorForZone(conn, zoneId);
      const riName = riId !== null ? await memberName(conn, riId) : null;
      const build = async (ownerId: number, label: string) => {
        const seats = await activeMessageSeatIds(conn, ownerId, categoryId, zoneId, label === "Zone Co-ordinator" ? ZC : DA, districtId);
        const p = { ...seatParams(categoryId, yearId, seats, ownerId), D: districtId };
        const s = await seatThreadSummary(conn, p, seats.length > 0, "AND c.fk_district_id=@D AND c.fk_club_id=0");
        const unread = await seatThreadUnread(conn, p, seats.length > 0, memberId, ownerId, categoryId, yearId, "AND c.fk_district_id=@D AND c.fk_club_id=0");
        return newThread({ ownerMemberId: ownerId, ownerName: await memberName(conn, ownerId), ownerRoleLabel: label, isMine: ownerId === memberId, messageCount: s.count, unreadCount: unread, lastMessagePreview: s.lastText, lastMessageDate: s.lastDate });
      };
      if (role === "RIDirector" || role === "SuperAdmin") {
        const owners: { id: number; label: string }[] = [];
        for (const r of await conn.query(
          `SELECT fk_member_id AS m FROM goal_role_assignments
           WHERE RoleType = 'AllDistrictsOneCategoryOneZone' AND IsActive = 1 AND isdeleted = 0
             AND fk_category_id = @Cid AND fk_zone_id = @Zid AND fk_member_id > 0`,
          { Cid: categoryId, Zid: zoneId },
        )) owners.push({ id: Number(r.m), label: "Zone Co-ordinator" });
        for (const r of await conn.query(
          `SELECT a.fk_member_id AS m FROM goal_role_assignments a
           JOIN goal_role_assignment_districts d ON d.fk_assignment_id = a.pk_id
           WHERE a.RoleType = 'FewDistrictsOneCategoryOneZone' AND a.IsActive = 1 AND a.isdeleted = 0
             AND a.fk_category_id = @Cid AND d.fk_district_id = @Did AND a.fk_member_id > 0`,
          { Cid: categoryId, Did: districtId },
        )) owners.push({ id: Number(r.m), label: "District Assistant" });
        const seen = new Set<number>();
        for (const o of owners) {
          if (seen.has(o.id)) continue;
          seen.add(o.id);
          result.threads.push({ ...(await build(o.id, o.label)), canPost: false });
        }
      } else {
        const t = await build(memberId, role === "ZoneCoordinator" ? "Zone Co-ordinator" : "District Assistant");
        t.counterpartyName = riName;
        t.canPost = riId !== null;
        t.notice = riId === null ? "No RI Director is assigned over your zone yet — messaging opens once one is assigned." : null;
        result.threads.push(t);
      }
      return result;
    });
  }

  async getGoalThreadMessages(memberId: number, categoryId: number, districtId: number, yearId: number, ownerMemberId: number): Promise<GoalCommentDto[]> {
    return this.db.session(async (conn) => {
      const zoneId = await districtZoneId(conn, districtId);
      const role = await this.viewerMessagingRole(conn, memberId, categoryId, districtId, zoneId);
      const allowed = role === "SuperAdmin" || role === "RIDirector" ? true : role === "ZoneCoordinator" || role === "DistrictAssistant" ? ownerMemberId === memberId : false;
      if (!allowed) throw new UnauthorizedAccessException("You do not have access to this message thread.");
      const seats = await activeMessageSeatIds(conn, ownerMemberId, categoryId, zoneId, null, districtId);
      await markThreadSeen(conn, memberId, ownerMemberId, categoryId, yearId);
      return seatThreadMessages(conn, memberId, { ...seatParams(categoryId, yearId, seats, ownerMemberId), D: districtId }, seats.length > 0, "AND c.fk_district_id=@D AND c.fk_club_id=0");
    });
  }

  /** Only a Zone Co-ordinator / District Assistant posts, always up to the zone's RI Director. */
  async postGoalThreadMessage(memberId: number, categoryId: number, districtId: number, yearId: number, _ownerMemberId: number, text: string): Promise<GoalCommentDto> {
    if (!text || !text.trim()) throw new InvalidOperationException("Message text is required.");
    return this.db.session(async (conn) => {
      const zoneId = await districtZoneId(conn, districtId);
      const role = await this.viewerMessagingRole(conn, memberId, categoryId, districtId, zoneId);
      if (role === "SuperAdmin" || role === "RIDirector") throw new UnauthorizedAccessException("Read-only: RI Director / SuperAdmin cannot post messages.");
      const tier = role === "ZoneCoordinator" ? 3 : role === "DistrictAssistant" ? 2 : 0;
      if (!tier) throw new UnauthorizedAccessException("You cannot message on this thread.");
      if ((await riDirectorForZone(conn, zoneId)) === null) throw new InvalidOperationException("No RI Director is assigned over your zone yet — you cannot send a message.");
      const seatId = (await activeMessageSeatIds(conn, memberId, categoryId, zoneId, tier === 3 ? ZC : DA, districtId))[0] ?? 0;
      const trimmed = text.trim();
      const id = Number(await conn.executeScalar(
        `INSERT INTO goal_comments (fk_category_id, fk_district_id, fk_club_id, fk_year_id, ThreadOwnerMemberId, fk_assignment_id, fk_zone_id, CommentText, PostedByMemberId, PostedByTier, created_date, isdeleted)
         VALUES (@C, @D, 0, @Y, @O, @Seat, @Z, @Text, @M, @Tier, NOW(), 0); SELECT LAST_INSERT_ID();`,
        { C: categoryId, D: districtId, Y: yearId, O: memberId, Seat: seatId, Z: zoneId, Text: trimmed, M: memberId, Tier: tier },
      ));
      return comment({ id, commentText: trimmed, postedByMemberId: memberId, postedByName: await memberName(conn, memberId), postedByTier: tier, postedByRoleLabel: tierRoleLabel(tier), isMine: true, createdDate: dbNow() });
    });
  }

  // ── Observer ("view as"): SuperAdmins with goal_oversight_access.IsEnabled ──

  private static async hasGoalOversightAccess(conn: DbCommands, memberId: number) {
    if (memberId <= 0) return false;
    return Number(await conn.executeScalar("SELECT IsEnabled FROM goal_oversight_access WHERE fk_member_id = @Id", { Id: memberId })) === 1;
  }

  async isGoalObserver(callerMemberId: number) {
    if (callerMemberId <= 0) return false;
    return this.db.session((conn) => GoalMessaging.hasGoalOversightAccess(conn, callerMemberId));
  }

  async getObserverRoleList(callerMemberId: number): Promise<GoalObserverRoleDto[]> {
    if (!(await this.isGoalObserver(callerMemberId))) return [];
    const map = (r: Row): GoalObserverRoleDto => ({ memberId: Number(r.MemberId), memberName: r.MemberName ?? "", roleType: String(r.RoleType), roleLabel: String(r.RoleLabel), zoneNames: r.ZoneNames ?? "", categoryName: r.CategoryName ?? null });
    return this.db.session(async (conn) => [
      ...(await conn.query(
        `SELECT a.fk_member_id AS MemberId,
                COALESCE(m.MemberName, '') AS MemberName,
                'AllCategoryAllDistrictsFewZones' AS RoleType,
                'RI Director' AS RoleLabel,
                COALESCE(GROUP_CONCAT(DISTINCT z.ZoneName ORDER BY z.ZoneName SEPARATOR ', '), '') AS ZoneNames,
                NULL AS CategoryName
         FROM goal_role_assignments a
         JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_id AND m.isdeleted = 0
         LEFT JOIN goal_role_assignment_zones az ON az.fk_assignment_id = a.pk_id
         LEFT JOIN zone_master z ON z.pk_zone_id = az.fk_zone_id
         WHERE a.RoleType = 'AllCategoryAllDistrictsFewZones' AND a.IsActive = 1 AND a.isdeleted = 0 AND a.fk_member_id > 0
         GROUP BY a.fk_member_id, m.MemberName
         ORDER BY m.MemberName`,
      )).map(map),
      ...(await conn.query(
        `SELECT a.fk_member_id AS MemberId,
                COALESCE(m.MemberName, '') AS MemberName,
                'AllDistrictsOneCategoryOneZone' AS RoleType,
                'Zone Co-ordinator' AS RoleLabel,
                COALESCE(z.ZoneName, '') AS ZoneNames,
                IF(c.Name = 'TRF', 'Foundation', c.Name) AS CategoryName
         FROM goal_role_assignments a
         JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_id AND m.isdeleted = 0
         LEFT JOIN zone_master z ON z.pk_zone_id = a.fk_zone_id
         LEFT JOIN goal_categories c ON c.pk_category_id = a.fk_category_id
         WHERE a.RoleType = 'AllDistrictsOneCategoryOneZone' AND a.IsActive = 1 AND a.isdeleted = 0 AND a.fk_member_id > 0
         ORDER BY m.MemberName`,
      )).map(map),
      ...(await conn.query(
        `SELECT a.fk_member_id AS MemberId,
                COALESCE(m.MemberName, '') AS MemberName,
                'FewDistrictsOneCategoryOneZone' AS RoleType,
                'District Assistant' AS RoleLabel,
                TRIM(BOTH ' ' FROM CONCAT_WS(' · ',
                     COALESCE(z.ZoneName, ''),
                     (SELECT GROUP_CONCAT(DISTINCT CONCAT('D', dm.DistrictNumber) ORDER BY dm.DistrictNumber SEPARATOR ', ')
                        FROM goal_role_assignment_districts ad
                        JOIN district_master dm ON dm.pk_district_id = ad.fk_district_id
                       WHERE ad.fk_assignment_id = a.pk_id))) AS ZoneNames,
                IF(c.Name = 'TRF', 'Foundation', c.Name) AS CategoryName
         FROM goal_role_assignments a
         JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_id AND m.isdeleted = 0
         LEFT JOIN zone_master z ON z.pk_zone_id = a.fk_zone_id
         LEFT JOIN goal_categories c ON c.pk_category_id = a.fk_category_id
         WHERE a.RoleType = 'FewDistrictsOneCategoryOneZone' AND a.IsActive = 1 AND a.isdeleted = 0 AND a.fk_member_id > 0
         ORDER BY m.MemberName`,
      )).map(map),
    ]);
  }

  // ── Zone threads (RI Director dashboard: one box per ZC / DA of the zone) ──

  /** Red dot for the zone: unread district-side messages, or an unread box the viewer can open. */
  async hasUnreadZoneMessages(memberId: number, zoneId: number, yearId: number): Promise<boolean> {
    if (zoneId <= 0) return false;
    return this.db.session(async (conn) => {
      const isSuper = await this.isSuperAdmin(conn, memberId);
      if (Number(await conn.executeScalar(
        `SELECT COUNT(*) FROM goal_comments c
         LEFT JOIN goal_message_thread_seen s
                ON s.fk_member_id = @Viewer AND s.ThreadOwnerMemberId = c.ThreadOwnerMemberId
               AND s.fk_category_id = c.fk_category_id AND s.fk_year_id = c.fk_year_id
         WHERE c.fk_zone_id = @Z AND c.fk_year_id = @Y AND ${districtSideFilter(isSuper)}
           AND c.PostedByMemberId <> @Viewer
           AND (s.last_seen_date IS NULL OR c.created_date > s.last_seen_date)`,
        { Viewer: memberId, Z: zoneId, Y: yearId },
      )) > 0) return true;
      if (isSuper || (await isRdOfZone(conn, memberId, zoneId))) {
        const cats = (await conn.query("SELECT DISTINCT fk_category_id AS id FROM goal_comments WHERE fk_zone_id=@Z AND fk_year_id=@Y AND ThreadOwnerMemberId>0 AND isdeleted=0", { Z: zoneId, Y: yearId })).map((r) => Number(r.id));
        for (const cat of cats)
          for (const box of await riZoneBoxes(conn, cat, zoneId, yearId, null))
            if (box.msgs.length && riBoxUnread(box, memberId, await threadLastSeen(conn, memberId, box.ownerId, cat, yearId)) > 0) return true;
        return false;
      }
      const myCategories = (await conn.query(
        `SELECT DISTINCT fk_category_id AS id FROM goal_role_assignments
         WHERE fk_member_id=@M AND fk_zone_id=@Z AND IsActive=1 AND isdeleted=0
           AND RoleType IN ('AllDistrictsOneCategoryOneZone','FewDistrictsOneCategoryOneZone')
           AND fk_category_id IS NOT NULL`,
        { M: memberId, Z: zoneId },
      )).map((r) => Number(r.id));
      if (!myCategories.length) return false;
      return Number(await conn.executeScalar(
        `SELECT COUNT(*) FROM goal_comments c
         LEFT JOIN goal_message_thread_seen s
                ON s.fk_member_id = @M AND s.ThreadOwnerMemberId = c.ThreadOwnerMemberId
               AND s.fk_category_id = c.fk_category_id AND s.fk_year_id = c.fk_year_id
         WHERE c.fk_zone_id=@Z AND c.fk_year_id=@Y AND c.isdeleted=0
           AND c.ThreadOwnerMemberId=@M AND c.fk_category_id IN @Cats
           AND c.PostedByMemberId <> @M
           AND (s.last_seen_date IS NULL OR c.created_date > s.last_seen_date)`,
        { Z: zoneId, Y: yearId, M: memberId, Cats: myCategories },
      )) > 0;
    });
  }

  async markZoneMessagesSeen(memberId: number, zoneId: number, yearId: number) {
    if (zoneId <= 0) return;
    await this.db.execute(
      `INSERT INTO goal_message_seen (fk_member_id, fk_zone_id, fk_year_id, last_seen_date)
       VALUES (@M,@Z,@Y,NOW()) ON DUPLICATE KEY UPDATE last_seen_date=NOW()`,
      { M: memberId, Z: zoneId, Y: yearId },
    );
  }

  async getGoalZoneThreadList(memberId: number, categoryId: number, zoneId: number, yearId: number, actingAs: string | null = null, filterDistrictId: number | null = null): Promise<GoalThreadListDto> {
    return this.db.session(async (conn) => {
      const isSuper = await this.isSuperAdmin(conn, memberId);
      const isRd = await isRdOfZone(conn, memberId, zoneId);
      const isZc = await holdsSeat(conn, memberId, ZC, categoryId, zoneId);
      const isDa = await holdsSeat(conn, memberId, DA, categoryId, zoneId);
      const role =
        actingAs === "district-assistant" && isDa ? "DistrictAssistant"
        : actingAs === "zone-coordinator" && isZc ? "ZoneCoordinator"
        : actingAs === "ri-director" && (isRd || isSuper) ? "RIDirector"
        : isSuper ? "SuperAdmin" : isRd ? "RIDirector" : isZc ? "ZoneCoordinator" : isDa ? "DistrictAssistant" : "None";
      const result: GoalThreadListDto = { viewerRole: role, threads: [], ownerDistricts: [], canObservePost: false };
      if (isSuper) result.canObservePost = await GoalMessaging.hasGoalOversightAccess(conn, memberId);
      if (role === "None") return result;
      const riId = await riDirectorForZone(conn, zoneId);
      const riName = riId !== null ? await memberName(conn, riId) : null;
      if (role === "RIDirector" || role === "SuperAdmin") {
        for (const box of await riZoneBoxes(conn, categoryId, zoneId, yearId, filterDistrictId)) {
          if (!box.msgs.length && !(result.canObservePost && !box.isFormer)) continue;
          const last = box.msgs[box.msgs.length - 1];
          result.threads.push(newThread({
            ownerMemberId: box.ownerId, ownerName: await memberName(conn, box.ownerId), ownerRoleLabel: box.label, scope: box.scope, isMine: box.ownerId === memberId, isFormer: box.isFormer,
            messageCount: box.msgs.length, unreadCount: riBoxUnread(box, memberId, await threadLastSeen(conn, memberId, box.ownerId, categoryId, yearId)),
            lastMessagePreview: last?.text ?? null, lastMessageDate: last ? formatDate(last.created, "yyyy-MM-dd HH:mm") : null, canPost: false,
          }));
        }
      } else {
        const seats = await activeMessageSeatIds(conn, memberId, categoryId);
        const s = await seatThreadSummary(conn, seatParams(categoryId, yearId, seats, memberId), seats.length > 0);
        const unread = await seatThreadUnread(conn, seatParams(categoryId, yearId, seats, memberId), seats.length > 0, memberId, memberId, categoryId, yearId);
        result.threads.push(newThread({
          ownerMemberId: memberId, ownerName: await memberName(conn, memberId), ownerRoleLabel: role === "ZoneCoordinator" ? "Zone Co-ordinator" : "District Assistant", scope: "", isMine: true,
          messageCount: s.count, unreadCount: unread, lastMessagePreview: s.lastText, lastMessageDate: s.lastDate, canPost: riId !== null, counterpartyName: riName,
          notice: riId === null ? "No RI Director is assigned over your zone yet — messaging opens once one is assigned." : null,
        }));
        if (role === "DistrictAssistant")
          result.ownerDistricts = (await conn.query(
            `SELECT DISTINCT dm.pk_district_id AS Id, dm.DistrictNumber AS Number
             FROM goal_role_assignments a
             JOIN goal_role_assignment_districts d ON d.fk_assignment_id = a.pk_id
             JOIN district_master dm ON dm.pk_district_id = d.fk_district_id AND dm.isdeleted = 0
             WHERE a.RoleType='FewDistrictsOneCategoryOneZone' AND a.IsActive=1 AND a.isdeleted=0
               AND a.fk_member_id=@M AND a.fk_category_id=@C AND a.fk_zone_id=@Z
             ORDER BY dm.DistrictNumber`,
            { M: memberId, C: categoryId, Z: zoneId },
          )).map((r) => ({ id: Number(r.Id), number: String(r.Number) }));
      }
      return result;
    });
  }

  async getGoalOwnerThreadMessages(memberId: number, categoryId: number, yearId: number, ownerMemberId: number, zoneId: number | null = null): Promise<GoalCommentDto[]> {
    return this.db.session(async (conn) => {
      if (memberId !== ownerMemberId) {
        let z = zoneId ?? 0;
        if (z <= 0) z = Number((await conn.executeScalar(
          `SELECT fk_zone_id FROM goal_role_assignments
           WHERE fk_member_id=@O AND IsActive=1 AND isdeleted=0 AND fk_category_id=@C
             AND RoleType IN ('AllDistrictsOneCategoryOneZone','FewDistrictsOneCategoryOneZone')
           ORDER BY pk_id DESC LIMIT 1`,
          { O: ownerMemberId, C: categoryId },
        )) ?? 0);
        if (z <= 0) z = Number((await conn.executeScalar(
          `SELECT fk_zone_id FROM goal_comments
           WHERE ThreadOwnerMemberId=@O AND fk_category_id=@C AND fk_year_id=@Y AND isdeleted=0 AND fk_zone_id > 0
           ORDER BY created_date DESC LIMIT 1`,
          { O: ownerMemberId, C: categoryId, Y: yearId },
        )) ?? 0);
        if (z > 0 && ((await this.isSuperAdmin(conn, memberId)) || (await isRdOfZone(conn, memberId, z)))) {
          const msgIds = [...new Set((await riZoneBoxes(conn, categoryId, z, yearId, null)).filter((b) => b.ownerId === ownerMemberId).flatMap((b) => b.msgs).map((m) => m.id))];
          await markThreadSeen(conn, memberId, ownerMemberId, categoryId, yearId);
          if (!msgIds.length) return [];
          return commentsWhere(conn, memberId, { Ids: msgIds }, "c.pk_id IN @Ids AND c.isdeleted=0");
        }
      }
      if (!(await this.canAccessOwnerThread(conn, memberId, categoryId, ownerMemberId))) throw new UnauthorizedAccessException("You do not have access to this message thread.");
      const seats = await activeMessageSeatIds(conn, ownerMemberId, categoryId);
      await markThreadSeen(conn, memberId, ownerMemberId, categoryId, yearId);
      return seatThreadMessages(conn, memberId, seatParams(categoryId, yearId, seats, ownerMemberId), seats.length > 0);
    });
  }

  private async canAccessOwnerThread(conn: DbCommands, memberId: number, categoryId: number, ownerMemberId: number) {
    if (memberId === ownerMemberId) return true;
    if (await this.isSuperAdmin(conn, memberId)) return true;
    const ozone = Number((await conn.executeScalar(
      `SELECT fk_zone_id FROM goal_role_assignments
       WHERE fk_member_id=@O AND IsActive=1 AND isdeleted=0 AND fk_category_id=@C
         AND RoleType IN ('AllDistrictsOneCategoryOneZone','FewDistrictsOneCategoryOneZone')
       ORDER BY pk_id DESC LIMIT 1`,
      { O: ownerMemberId, C: categoryId },
    )) ?? 0);
    return ozone !== 0 && (await isRdOfZone(conn, memberId, ozone));
  }

  /** A ZC / DA posts in their own box (a DA may tag one of their districts). RI / SuperAdmin are read-only. */
  async postGoalOwnerThreadMessage(memberId: number, categoryId: number, yearId: number, ownerMemberId: number, text: string, districtId = 0): Promise<GoalCommentDto> {
    if (!text || !text.trim()) throw new InvalidOperationException("Message text is required.");
    return this.db.session(async (conn) => {
      const isSuper = await this.isSuperAdmin(conn, memberId);
      if (memberId !== ownerMemberId) throw new UnauthorizedAccessException("Read-only: RI Director / SuperAdmin cannot post messages.");
      const seat = await conn.queryFirstOrDefault(
        `SELECT pk_id AS id, RoleType AS rt, fk_zone_id AS zone FROM goal_role_assignments
         WHERE fk_member_id=@O AND IsActive=1 AND isdeleted=0 AND fk_category_id=@C
           AND RoleType IN ('AllDistrictsOneCategoryOneZone','FewDistrictsOneCategoryOneZone')
         ORDER BY pk_id DESC LIMIT 1`,
        { O: ownerMemberId, C: categoryId },
      );
      if (!seat) throw new InvalidOperationException("You have no active Zone Co-ordinator / District Assistant role for this category — the message cannot be sent.");
      const seatZone = seat.zone === null ? 0 : Number(seat.zone);
      const ri = seatZone > 0 ? await riDirectorForZone(conn, seatZone) : null;
      if (ri === null && !isSuper) throw new InvalidOperationException("No RI Director is assigned over your zone yet — you cannot send a message.");
      const tier = seat.rt === ZC ? 3 : 2;
      let tagged = 0;
      if (tier === 2 && districtId > 0) {
        const covers = Number(await conn.executeScalar(
          `SELECT COUNT(*) FROM goal_role_assignments a
           JOIN goal_role_assignment_districts d ON d.fk_assignment_id = a.pk_id
           WHERE a.RoleType='FewDistrictsOneCategoryOneZone' AND a.IsActive=1 AND a.isdeleted=0
             AND a.fk_member_id=@M AND a.fk_category_id=@C AND d.fk_district_id=@D`,
          { M: ownerMemberId, C: categoryId, D: districtId },
        ));
        if (covers > 0) tagged = districtId;
      }
      const trimmed = text.trim();
      const id = Number(await conn.executeScalar(
        `INSERT INTO goal_comments (fk_category_id, fk_district_id, fk_club_id, fk_year_id, ThreadOwnerMemberId, fk_assignment_id, fk_zone_id, CommentText, PostedByMemberId, PostedByTier, created_date, isdeleted)
         VALUES (@C, @D, 0, @Y, @O, @Seat, @Z, @Text, @M, @Tier, NOW(), 0); SELECT LAST_INSERT_ID();`,
        { C: categoryId, D: tagged, Y: yearId, O: ownerMemberId, Seat: Number(seat.id), Z: seatZone, Text: trimmed, M: memberId, Tier: tier },
      ));
      const dnum = tagged > 0 ? ((await conn.executeScalar("SELECT DistrictNumber FROM district_master WHERE pk_district_id=@D", { D: tagged })) as string | null) : null;
      return comment({ id, commentText: trimmed, postedByMemberId: memberId, postedByName: await memberName(conn, memberId), postedByTier: tier, postedByRoleLabel: tierRoleLabel(tier), isMine: true, createdDate: dbNow(), districtId: tagged, districtNumber: dnum ?? null });
    });
  }

  // ── District-side messages (District Admin / District Governor → the oversight chain; read-only above) ──

  protected districtSideReportRows(conn: DbCommands, memberId: number, yearId: number, zoneId: number, categoryId: number, districtId: number): Promise<DistrictSideRow[]> {
    return this.isSuperAdmin(conn, memberId).then((sa) => districtSideRows(conn, memberId, sa, yearId, zoneId, categoryId, districtId));
  }

  async getDistrictMessages(memberId: number, categoryId: number, districtId: number, yearId: number): Promise<GoalDistrictMessagesDto> {
    return this.db.session(async (conn) => {
      const isSuper = await this.isSuperAdmin(conn, memberId);
      const posterRole = await districtSidePosterRole(conn, memberId, districtId, yearId);
      const rows = await districtSideRows(conn, memberId, isSuper, yearId, 0, categoryId, districtId);
      if (!isSuper && posterRole === null && !rows.length && !(await GoalMessaging.canReadDistrictSide(conn, memberId, categoryId, districtId, yearId)))
        throw new UnauthorizedAccessException("You cannot view this district's messages.");
      if (posterRole === null && districtId > 0 && memberId > 0)
        await conn.execute(
          `INSERT INTO goal_message_thread_seen (fk_member_id, ThreadOwnerMemberId, fk_category_id, fk_year_id, last_seen_date)
           VALUES (@M, @O, @C, @Y, NOW())
           ON DUPLICATE KEY UPDATE last_seen_date = NOW()`,
          { M: memberId, O: districtThreadKey(districtId), C: categoryId, Y: yearId },
        );
      const dnum = (await conn.executeScalar("SELECT DistrictNumber FROM district_master WHERE pk_district_id=@D", { D: districtId })) as string | null;
      const catName = String((await conn.executeScalar("SELECT IF(Name = 'TRF', 'Foundation', Name) FROM goal_categories WHERE pk_category_id=@C", { C: categoryId })) ?? "");
      const zoneId = await districtZoneId(conn, districtId);
      const notice = posterRole !== null && (await riDirectorForZone(conn, zoneId)) === null ? "No RI Director is assigned over your zone yet - your message will still reach the District Assistant and Zone Co-ordinator." : null;
      return {
        districtId, districtNumber: dnum ?? null, categoryId, categoryName: catName, canPost: posterRole !== null, posterRole, notice,
        messages: rows.map((r) => comment({ id: r.id, commentText: r.text, postedByMemberId: r.postedBy, postedByName: r.fromName, postedByTier: DISTRICT_SIDE_TIER, postedByRoleLabel: r.fromRole, isMine: r.postedBy === memberId, createdDate: formatDate(r.created, "yyyy-MM-dd HH:mm"), districtId: r.districtId, districtNumber: r.districtNumber, categoryName: r.categoryName })),
      };
    });
  }

  /** The scope rule evaluated against a virtual row (a conversation with no messages yet). */
  private static async canReadDistrictSide(conn: DbCommands, viewer: number, categoryId: number, districtId: number, yearId: number) {
    const zoneId = await districtZoneId(conn, districtId);
    return Number(await conn.executeScalar(
      `SELECT COUNT(*) FROM (SELECT @Cat AS fk_category_id, @D AS fk_district_id, @Z AS fk_zone_id, @Y AS fk_year_id) c
       WHERE ${DISTRICT_SIDE_SCOPE_SQL}`,
      { Viewer: viewer, Cat: categoryId, D: districtId, Z: zoneId, Y: yearId },
    )) > 0;
  }

  async postDistrictMessage(memberId: number, categoryId: number, districtId: number, yearId: number, text: string): Promise<GoalCommentDto> {
    if (!text || !text.trim()) throw new InvalidOperationException("Message cannot be empty.");
    if (text.trim().length > 4000) throw new InvalidOperationException("Message is too long (max 4000 characters).");
    return this.db.session(async (conn) => {
      const role = await districtSidePosterRole(conn, memberId, districtId, yearId);
      if (role === null) throw new UnauthorizedAccessException("Only this district's District Admin or District Governor can send a message here.");
      if (Number(await conn.executeScalar("SELECT COUNT(*) FROM goal_categories WHERE pk_category_id=@C AND isdeleted=0", { C: categoryId })) === 0) throw new InvalidOperationException("Unknown category.");
      const zoneId = await districtZoneId(conn, districtId);
      const trimmed = text.trim();
      const id = Number(await conn.executeScalar(
        `INSERT INTO goal_comments (fk_category_id, fk_district_id, fk_club_id, fk_year_id, ThreadOwnerMemberId, fk_assignment_id, fk_zone_id, CommentText, PostedByMemberId, PostedByTier, created_date, isdeleted)
         VALUES (@C, @D, 0, @Y, @O, 0, @Z, @Text, @M, @Tier, NOW(), 0); SELECT LAST_INSERT_ID();`,
        { C: categoryId, D: districtId, Y: yearId, O: districtThreadKey(districtId), Z: zoneId, Text: trimmed, M: memberId, Tier: DISTRICT_SIDE_TIER },
      ));
      return comment({
        id, commentText: trimmed, postedByMemberId: memberId, postedByName: await memberName(conn, memberId), postedByTier: DISTRICT_SIDE_TIER, postedByRoleLabel: role, isMine: true,
        createdDate: dbNow(), districtId, districtNumber: ((await conn.executeScalar("SELECT DistrictNumber FROM district_master WHERE pk_district_id=@D", { D: districtId })) as string | null) ?? null,
      });
    });
  }

  async getDistrictMessageInbox(memberId: number, zoneId: number, yearId: number, categoryId: number, districtId: number): Promise<GoalDistrictConversationDto[]> {
    return this.db.session(async (conn) => {
      const rows = await districtSideRows(conn, memberId, await this.isSuperAdmin(conn, memberId), yearId, zoneId, categoryId, districtId);
      const groups = new Map<string, DistrictSideRow[]>();
      for (const r of rows) groups.set(`${r.districtId}:${r.categoryId}`, [...(groups.get(`${r.districtId}:${r.categoryId}`) ?? []), r]);
      const result: GoalDistrictConversationDto[] = [];
      for (const g of groups.values()) {
        const last = [...g].sort((a, b) => ms(a.created) - ms(b.created) || a.id - b.id).pop()!;
        const seen = await conn.executeScalar(
          `SELECT last_seen_date FROM goal_message_thread_seen
           WHERE fk_member_id = @M AND ThreadOwnerMemberId = @O AND fk_category_id = @C AND fk_year_id = @Y`,
          { M: memberId, O: districtThreadKey(last.districtId), C: last.categoryId, Y: yearId },
        );
        result.push({
          districtId: last.districtId, districtNumber: last.districtNumber, categoryId: last.categoryId, categoryName: last.categoryName, messageCount: g.length,
          unreadCount: g.filter((r) => r.postedBy !== memberId && newer(r.created, seen)).length, lastFrom: last.fromName, lastFromRole: last.fromRole,
          lastPreview: last.text, lastDate: formatDate(last.created, "yyyy-MM-dd HH:mm"),
        });
      }
      return result.sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? ""));
    });
  }

  // ── Zone message list, roster and report (RI Director / ZC / SuperAdmin) ──

  private async assertZoneMessages(conn: DbCommands, memberId: number, zoneId: number) {
    if (!(await this.isSuperAdmin(conn, memberId)) && !(await this.canAccessZoneReport(conn, memberId, zoneId))) throw new UnauthorizedAccessException("You are not authorised to view this zone's messages.");
  }

  async getGoalMessagesList(memberId: number, zoneId: number, yearId: number, categoryId: number, districtId: number): Promise<GoalMessageRowDto[]> {
    if (zoneId <= 0) return [];
    return this.db.session(async (conn) => {
      await this.assertZoneMessages(conn, memberId, zoneId);
      return (await conn.query(
        `SELECT c.pk_id AS id, c.fk_category_id AS catId, IF(cat.Name = 'TRF', 'Foundation', cat.Name) AS catName,
                c.fk_district_id AS did, dm.DistrictNumber AS dnum,
                c.PostedByTier AS tier, COALESCE(m.MemberName,'') AS fromName,
                c.CommentText AS msg, DATE_FORMAT(c.created_date,'%Y-%m-%d %H:%i') AS dt
         FROM goal_comments c
         JOIN goal_categories cat ON cat.pk_category_id = c.fk_category_id AND cat.isdeleted = 0
         LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = c.PostedByMemberId
         LEFT JOIN district_master dm ON dm.pk_district_id = c.fk_district_id
         WHERE c.fk_year_id=@Y AND c.isdeleted=0 AND c.fk_zone_id=@Z AND c.ThreadOwnerMemberId>0
           AND (@Cat=0 OR c.fk_category_id=@Cat)
           AND (@Did=0 OR c.fk_district_id=@Did)
         ORDER BY c.created_date DESC`,
        { Y: yearId, Z: zoneId, Cat: categoryId, Did: districtId },
      )).map((r) => {
        const did = r.did === null ? 0 : Number(r.did), tier = Number(r.tier);
        return { id: Number(r.id), categoryId: Number(r.catId), categoryName: String(r.catName), districtId: did, districtNumber: did > 0 ? r.dnum ?? null : null, fromName: String(r.fromName), roleLabel: tierRoleLabel(tier), postedByTier: tier, message: String(r.msg), createdDate: r.dt ?? null };
      });
    });
  }

  /** ZC / DA of the zone who have messaged (counts + unread), plus read-only "Former …" rows. */
  async getGoalMessageRoster(memberId: number, zoneId: number, yearId: number, categoryId: number, districtId: number): Promise<GoalMessageOwnerDto[]> {
    if (zoneId <= 0) return [];
    return this.db.session(async (conn) => {
      await this.assertZoneMessages(conn, memberId, zoneId);
      const result: GoalMessageOwnerDto[] = [];
      for (const r of await conn.query(
        `SELECT a.fk_member_id AS mid, a.fk_category_id AS catId, COALESCE(m.MemberName,'') AS name, IF(cat.Name = 'TRF', 'Foundation', cat.Name) AS catName
         FROM goal_role_assignments a
         JOIN member_master_profile m ON m.pk_member_master_profile_id=a.fk_member_id AND m.isdeleted=0
         JOIN goal_categories cat ON cat.pk_category_id=a.fk_category_id AND cat.isdeleted=0
         WHERE a.RoleType='AllDistrictsOneCategoryOneZone' AND a.IsActive=1 AND a.isdeleted=0
           AND a.fk_zone_id=@Z AND a.fk_member_id>0 AND (@Cat=0 OR a.fk_category_id=@Cat)
         GROUP BY a.fk_member_id, a.fk_category_id, m.MemberName, cat.Name, cat.SortOrder
         ORDER BY cat.SortOrder, m.MemberName`,
        { Z: zoneId, Cat: categoryId },
      )) {
        const [mid, cid] = [Number(r.mid), Number(r.catId)];
        const cnt = await rosterMessageCount(conn, mid, cid, yearId, districtId);
        if (cnt === 0) continue;
        result.push({ memberId: mid, categoryId: cid, name: String(r.name), roleLabel: "Zone Co-ordinator", categoryName: String(r.catName), districts: null, isFormer: false, messageCount: cnt, unreadCount: await rosterUnreadCount(conn, memberId, mid, cid, yearId, districtId) });
      }
      for (const r of await conn.query(
        `SELECT a.fk_member_id AS mid, a.fk_category_id AS catId, COALESCE(m.MemberName,'') AS name, IF(cat.Name = 'TRF', 'Foundation', cat.Name) AS catName,
                GROUP_CONCAT(DISTINCT dm.DistrictNumber ORDER BY dm.DistrictNumber SEPARATOR ', ') AS districts
         FROM goal_role_assignments a
         JOIN member_master_profile m ON m.pk_member_master_profile_id=a.fk_member_id AND m.isdeleted=0
         JOIN goal_categories cat ON cat.pk_category_id=a.fk_category_id AND cat.isdeleted=0
         JOIN goal_role_assignment_districts d ON d.fk_assignment_id=a.pk_id
         JOIN district_master dm ON dm.pk_district_id=d.fk_district_id AND dm.isdeleted=0
         WHERE a.RoleType='FewDistrictsOneCategoryOneZone' AND a.IsActive=1 AND a.isdeleted=0
           AND a.fk_zone_id=@Z AND a.fk_member_id>0 AND (@Cat=0 OR a.fk_category_id=@Cat)
           AND (@Did=0 OR d.fk_district_id=@Did)
         GROUP BY a.fk_member_id, a.fk_category_id, m.MemberName, cat.Name, cat.SortOrder
         ORDER BY cat.SortOrder, m.MemberName`,
        { Z: zoneId, Cat: categoryId, Did: districtId },
      )) {
        const [mid, cid] = [Number(r.mid), Number(r.catId)];
        const cnt = await rosterMessageCount(conn, mid, cid, yearId, districtId);
        if (cnt === 0) continue;
        result.push({ memberId: mid, categoryId: cid, name: String(r.name), roleLabel: "District Assistant", categoryName: String(r.catName), districts: r.districts ?? null, isFormer: false, messageCount: cnt, unreadCount: await rosterUnreadCount(conn, memberId, mid, cid, yearId, districtId) });
      }
      if ((await this.isSuperAdmin(conn, memberId)) || (await isRdOfZone(conn, memberId, zoneId))) {
        const catIds = categoryId > 0 ? [categoryId] : (await conn.query(
          `SELECT DISTINCT c.fk_category_id AS id FROM goal_comments c
           JOIN goal_categories cat ON cat.pk_category_id=c.fk_category_id AND cat.isdeleted=0
           WHERE c.fk_zone_id=@Z AND c.fk_year_id=@Y AND c.ThreadOwnerMemberId>0 AND c.isdeleted=0`,
          { Z: zoneId, Y: yearId },
        )).map((r) => Number(r.id));
        for (const cid of catIds) {
          const catName = String((await conn.executeScalar("SELECT IF(Name = 'TRF', 'Foundation', Name) FROM goal_categories WHERE pk_category_id=@C", { C: cid })) ?? "");
          const boxes = await riZoneBoxes(conn, cid, zoneId, yearId, null);
          for (const row of result.filter((x) => x.categoryId === cid && !x.isFormer)) {
            const seenIds = new Set<number>();
            const own = boxes.filter((b) => b.ownerId === row.memberId && !b.isFormer).flatMap((b) => b.msgs).filter((m) => !seenIds.has(m.id) && seenIds.add(m.id)).filter((m) => districtId <= 0 || m.district === districtId);
            if (!own.length) continue;
            const seen = await threadLastSeen(conn, memberId, row.memberId, cid, yearId);
            row.messageCount = own.length;
            row.unreadCount = own.filter((m) => m.postedBy !== memberId && newer(m.created, seen)).length;
          }
          for (const box of boxes.filter((b) => b.isFormer)) {
            if (result.some((x) => x.memberId === box.ownerId && x.categoryId === cid)) continue;
            const msgs = districtId > 0 ? box.msgs.filter((m) => m.district === districtId) : box.msgs;
            if (!msgs.length) continue;
            const lastSeen = await threadLastSeen(conn, memberId, box.ownerId, cid, yearId);
            result.push({ memberId: box.ownerId, categoryId: cid, name: await memberName(conn, box.ownerId), roleLabel: box.label, categoryName: catName, districts: null, isFormer: true, messageCount: msgs.length, unreadCount: msgs.filter((m) => m.postedBy !== memberId && newer(m.created, lastSeen)).length });
          }
        }
      }
      return result;
    });
  }

  /** Every goal message of a zone (ZC / DA conversations + District Admin / DG messages) as Excel. */
  async buildGoalMessagesReportExcel(memberId: number, zoneId: number, yearId: number, categoryId: number, districtId: number): Promise<Buffer | null> {
    if (zoneId <= 0) return null;
    return this.db.session(async (conn) => {
      await this.assertZoneMessages(conn, memberId, zoneId);
      const rows = await conn.query(
        `SELECT IF(cat.Name = 'TRF', 'Foundation', cat.Name) AS catName, cat.SortOrder AS catSort,
                c.fk_district_id AS did, dm.DistrictNumber AS dnum,
                c.PostedByTier AS tier, COALESCE(m.MemberName,'') AS fromName,
                c.CommentText AS msg, DATE_FORMAT(c.created_date,'%d %b %Y, %h:%i %p') AS dt, c.created_date AS raw
         FROM goal_comments c
         JOIN goal_categories cat ON cat.pk_category_id = c.fk_category_id AND cat.isdeleted = 0
         LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = c.PostedByMemberId
         LEFT JOIN district_master dm ON dm.pk_district_id = c.fk_district_id
         WHERE c.fk_year_id=@Y AND c.isdeleted=0 AND c.fk_zone_id=@Z AND c.ThreadOwnerMemberId>0
           AND (@Cat=0 OR c.fk_category_id=@Cat)
           AND (@Did=0 OR c.fk_district_id=@Did)
         ORDER BY cat.SortOrder, c.created_date`,
        { Y: yearId, Z: zoneId, Cat: categoryId, Did: districtId },
      );
      const yearLabel = String((await conn.executeScalar("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id=@Y", { Y: yearId })) ?? "");
      const zoneName = String((await conn.executeScalar("SELECT ZoneName FROM zone_master WHERE pk_zone_id=@Z", { Z: zoneId })) ?? `Zone ${zoneId}`);
      const all = rows.map((x) => ({ sort: Number(x.catSort), cat: String(x.catName), did: x.did === null ? 0 : Number(x.did), dnum: x.dnum as string | null, role: tierRoleLabel(Number(x.tier)), from: String(x.fromName), msg: String(x.msg), dt: String(x.dt ?? ""), raw: String(x.raw) }));
      for (const d of await this.districtSideReportRows(conn, memberId, yearId, zoneId, categoryId, districtId))
        all.push({ sort: d.categorySort, cat: d.categoryName, did: d.districtId, dnum: d.districtNumber, role: d.fromRole ?? "District Admin", from: d.fromName, msg: d.text, dt: formatDate(d.created, "dd MMM yyyy, hh:mm tt"), raw: d.created });
      all.sort((a, b) => a.sort - b.sort || ms(a.raw) - ms(b.raw));

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Messages");
      [6, 18, 16, 20, 28, 70, 22].forEach((w, i) => (ws.getColumn(i + 1).width = w));
      ws.mergeCells(1, 1, 1, 7);
      ws.getCell(1, 1).value = "Goal Messages Report";
      ws.getCell(1, 1).font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
      ws.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A365D" } };
      ws.getCell(1, 1).alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(1).height = 32;
      ws.mergeCells(2, 1, 2, 7);
      ws.getCell(2, 1).value = `${zoneName}   ·   Rotary Year ${yearLabel}   ·   Generated ${formatDate(nowIn(Brand.Current.locale.defaultTimeZone), "dd MMM yyyy, hh:mm tt")}`;
      ws.getCell(2, 1).font = { size: 10, color: { argb: "FF475569" } };
      ws.getCell(2, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2F7" } };
      ws.getCell(2, 1).alignment = { horizontal: "center" };
      let r = 4;
      ["Sr No", "Category", "District", "Role", "From", "Message", "Date & Time"].forEach((h, i) => {
        const c = ws.getCell(r, i + 1);
        c.value = h;
        c.font = { bold: true, color: { argb: "FF1E293B" } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
        c.alignment = { horizontal: "center", vertical: "middle" };
      });
      r++;
      all.forEach((row, i) => {
        ws.getRow(r).values = [i + 1, row.cat, row.did > 0 ? row.dnum ?? String(row.did) : "All districts", row.role, row.from, row.msg, row.dt];
        ws.getCell(r, 6).alignment = { wrapText: true };
        r++;
      });
      if (!all.length) ws.getCell(r, 1).value = "No messages for this filter.";
      return toBuffer(wb);
    });
  }
}
