import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Db, type DbCommands } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { defineDto } from "../../common/dto";
import { badRequest, notFound, ok, statusCode } from "../../common/results";
import { bodyIntList, paramInt, queryBool, queryInt } from "../../common/binding";
import { DISTRICT_BLOCKED_MESSAGE, isDistrictDrillReachable } from "../../services/kill-switch.helper";
import { DcAutoGroupService } from "../../services/dc-auto-group.service";
import { saveWithGuidName, type UploadedFile as Upload } from "../../services/media-storage";

const MAX_UPLOAD = 55 * 1024 * 1024;

/** DistrictCommitteeMemberDto / DistrictCommitteeGroupDto / DistrictCommitteeSubGroupDto */
const MemberBody = defineDto({
  YearId: "int", MemberId: "int?", IsMember: { type: "bool", default: () => true }, Name: { type: "string", default: () => "" }, Mobile: "string", Email: "string",
  DistrictDesignation: "string", ClubId: "int?", ClubName: "string", DistrictRemark: "string", ProfilePhoto: "string",
});
const GroupBody = defineDto({ YearId: "int", GroupName: { type: "string", default: () => "" } });
const SubGroupBody = defineDto({ SubGroupName: { type: "string", default: () => "" } });
type MemberDto = {
  yearId: number; memberId: number | null; isMember: boolean; name: string; mobile: string | null; email: string | null; districtDesignation: string | null;
  clubId: number | null; clubName: string | null; districtRemark: string | null; profilePhoto: string | null;
};

const memberParams = (dto: MemberDto) => ({
  MemberId: dto.memberId, IsMember: dto.isMember, Name: dto.name, Mobile: dto.mobile, Email: dto.email, DistrictDesignation: dto.districtDesignation,
  ClubId: dto.clubId, ClubName: dto.memberId !== null && dto.memberId > 0 ? null : dto.clubName, DistrictRemark: dto.districtRemark, ProfilePhoto: dto.profilePhoto,
});

/** Member rows show the LIVE profile mobile and email; dcm.mobile/email are add-time copies kept for non-members. */
const liveContact = (a: string) => `
  CASE WHEN COALESCE(${a}.fk_member_id, 0) > 0 AND m.PrimaryMobileNumber IS NOT NULL AND TRIM(m.PrimaryMobileNumber) <> '' THEN m.PrimaryMobileNumber ELSE ${a}.mobile END AS mobile,
  CASE WHEN COALESCE(${a}.fk_member_id, 0) > 0 AND m.EmailId IS NOT NULL AND TRIM(m.EmailId) <> '' THEN m.EmailId ELSE ${a}.email END AS email`;
/** Member rows use the live member photo (none when the profile has none); non-members keep the photo uploaded here. */
const livePhoto = (a: string, groupKey: string) => `CASE
  WHEN COALESCE(${a}.fk_member_id, 0) > 0 AND m.ProfilePhotoPath IS NOT NULL AND m.ProfilePhotoPath <> '' THEN
       CASE WHEN m.ProfilePhotoPath LIKE '/%' OR m.ProfilePhotoPath LIKE 'http%' THEN m.ProfilePhotoPath
            ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1)) END
  WHEN COALESCE(${a}.fk_member_id, 0) > 0 THEN NULL
  WHEN ${a}.profile_photo IS NULL OR ${a}.profile_photo = '' THEN NULL
  WHEN ${a}.profile_photo LIKE '/%' THEN ${a}.profile_photo
  ELSE CONCAT('/Documents/DistrictCommittee/Group', ${groupKey}, '/', ${a}.profile_photo)
END AS profilePhoto`;
const searchClause = (a: string) => ` AND (${a}.name LIKE @Search OR ${a}.mobile LIKE @Search OR m.PrimaryMobileNumber LIKE @Search OR ${a}.email LIKE @Search OR m.EmailId LIKE @Search
  OR (CASE WHEN COALESCE(${a}.fk_member_id,0) > 0 THEN c.ClubName ELSE ${a}.club_name END) LIKE @Search)`;

/** page / pageSize clamped as the C# does (1..200, default 20). */
function paging(pageText?: string, pageSizeText?: string) {
  let page = queryInt(pageText, 1);
  let pageSize = queryInt(pageSizeText, 20);
  if (page < 1) page = 1;
  if (pageSize < 1) pageSize = 20;
  if (pageSize > 200) pageSize = 200;
  return { page, pageSize };
}

/** Port of DistrictModulesController.cs, part 5: the district committee (members, groups, sub-groups and their members). */
@Controller("api/districts/:districtId/committee")
@Authorize()
export class DistrictCommitteeController {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly dcAutoGroups: DcAutoGroupService,
  ) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);
  private async blocked(districtId: number) {
    return !(await isDistrictDrillReachable(this.db, districtId)) ? statusCode(403, { message: DISTRICT_BLOCKED_MESSAGE }) : null;
  }
  /** RejectIfAutoManagedGroupByIdAsync: the CP/CS groups are maintained from the Board of Directors. */
  private async rejectAutoGroupById(conn: DbCommands, groupId: number) {
    const name = await conn.executeScalar<string>("SELECT group_name FROM district_committee_group WHERE id = @Id LIMIT 1", { Id: groupId });
    return this.dcAutoGroups.isAutoManagedGroup(name)
      ? badRequest({ message: "This group is auto-managed by BOD (Club President / Club Secretary) and cannot be edited directly. Make changes via Board of Directors instead." })
      : null;
  }
  private rejectAutoGroupByName(name: string | null) {
    return this.dcAutoGroups.isAutoManagedGroup(name)
      ? badRequest({ message: "Group names matching 'Club President' or 'Club Secretary' (any variation) are reserved for auto-managed BOD groups." })
      : null;
  }
  private static nextSort(conn: DbCommands, table: string, where: string, params: Record<string, unknown>) {
    return conn.executeScalar(`SELECT COALESCE(MAX(sort_order),-1)+1 FROM ${table} WHERE ${where} AND isdeleted=0`, params).then(Number);
  }
  private async reorder(table: string, owner: string, ownerId: number, body: unknown) {
    const ids = bodyIntList(body, "orderedIds");
    for (let i = 0; i < ids.length; i++) await this.db.execute(`UPDATE ${table} SET sort_order=@S WHERE id=@Id AND ${owner}=@O`, { S: i, Id: ids[i], O: ownerId });
    return ok({ message: "Order saved." });
  }
  /** add-as-non-member: copy a removed (non-sync club) row back as a non-member entry. */
  private async addAsNonMember(
    table: string, owner: string, ownerId: number, id: number, userId: number, notFoundMessage: string, extraCols = "", extraValues = "", extraParams: Record<string, unknown> = {},
  ) {
    return this.db.session(async (conn) => {
      const src = await conn.queryFirstOrDefault(
        `SELECT fk_member_id AS memberId, name, mobile, email, district_designation AS designation, district_remark AS remark, profile_photo AS photo
                ${extraCols ? ", fk_year_id AS yearId" : ""}
         FROM ${table} WHERE id=@Id AND ${owner}=@Owner LIMIT 1`,
        { Id: id, Owner: ownerId },
      );
      if (!src) return notFound({ message: notFoundMessage });
      const nextSort = await DistrictCommitteeController.nextSort(conn, table, extraCols ? `${owner}=@Owner AND fk_year_id=@YearId` : `${owner}=@Owner`, { Owner: ownerId, YearId: src.yearId ?? null });
      await conn.execute(
        `INSERT INTO ${table} (${owner}${extraCols}, fk_member_id, is_member, name, mobile, email, district_designation, fk_club_id, club_name, district_remark, profile_photo, sort_order, created_by)
         VALUES (@Owner${extraValues}, @MemberId, 0, @Name, @Mobile, @Email, @Designation, NULL, NULL, @Remark, @Photo, @SortOrder, @UserId)`,
        {
          Owner: ownerId, YearId: src.yearId ?? null, MemberId: src.memberId, Name: src.name, Mobile: src.mobile, Email: src.email, Designation: src.designation,
          Remark: src.remark, Photo: src.photo, SortOrder: nextSort, UserId: userId, ...extraParams,
        },
      );
      return ok({ id: Number(await conn.executeScalar("SELECT LAST_INSERT_ID()")), message: "Added as non-member." });
    });
  }
  /** The removed rows of clubs not synced from Rotary.org (those can be re-added as non-members). */
  private nonSyncRemoved(table: string, alias: string, where: string, params: Record<string, unknown>, extra = "") {
    return this.db.query(
      `SELECT ${alias}.id, ${alias}.fk_member_id AS memberId, ${alias}.is_member AS isMember, ${alias}.name, ${alias}.mobile, ${alias}.email,
              ${alias}.district_designation AS districtDesignation, ${alias}.fk_club_id AS clubId, c.ClubName AS clubName,
              ${alias}.district_remark AS districtRemark, ${alias}.profile_photo AS profilePhoto${extra}
       FROM ${table} ${alias}
       LEFT JOIN club_master c ON c.pk_club_id = ${alias}.fk_club_id
       WHERE ${where} AND ${alias}.isdeleted = 1 AND ${alias}.fk_club_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM club_master cc WHERE cc.pk_club_id = ${alias}.fk_club_id AND cc.isdeleted = 0 AND IFNULL(cc.IsSyncedFromRotaryOrg,0) = 0)
       ORDER BY ${alias}.name`,
      params,
    );
  }

  @Get("search-members")
  async searchMembers(@Param("districtId") d: string, @Query("search") search?: string) {
    const districtId = paramInt(d, "districtId");
    const block = await this.blocked(districtId);
    if (block) return block;
    if (!search || !search.trim() || search.length < 2) return ok([]);
    return ok(
      await this.db.query(
        `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS name, m.PrimaryMobileNumber AS mobile, m.EmailId AS email,
                CASE WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                     WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                     ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1)) END AS profilePhoto,
                cm.fk_club_id AS clubId, c.ClubName AS clubName
         FROM member_master_profile m
         INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
         INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id
         WHERE c.fk_district_id = @DistrictId AND m.isdeleted = 0
           AND (m.MemberName LIKE @Search OR m.PrimaryMobileNumber LIKE @Search OR m.EmailId LIKE @Search)
         ORDER BY m.MemberName
         LIMIT 20`,
        { DistrictId: districtId, Search: `%${search}%` },
      ),
    );
  }

  /** Member photos go to the directory folder; others under the club's (or district's) committee folder. */
  @Post("upload-photo")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  async uploadPhoto(@Param("districtId") d: string, @UploadedFile() file: Upload | undefined, @Query("isMember") isMember?: string, @Query("clubId") c?: string) {
    const districtId = paramInt(d, "districtId");
    const member = queryBool(isMember, false)!;
    const clubId = queryInt(c);
    if (!file || file.size === 0) return badRequest({ message: "No file uploaded" });
    const rel = member ? ["Documents", "directory"] : ["Documents", "DistrictCommittee", `Group${clubId !== null && clubId > 0 ? clubId : districtId}`];
    const name = await saveWithGuidName(this.config, file, ...rel);
    return ok({ path: `/${rel.join("/")}/${name}` });
  }

  // ---- level-1 committee members ----

  @Get("members")
  async members(
    @Param("districtId") d: string, @Query("yearId") y?: string, @Query("page") p?: string, @Query("pageSize") ps?: string, @Query("search") search?: string,
  ) {
    const districtId = paramInt(d, "districtId");
    const yearId = queryInt(y);
    const { page, pageSize } = paging(p, ps);
    const block = await this.blocked(districtId);
    if (block) return block;
    let where = "WHERE dcm.fk_district_id = @DistrictId AND dcm.isdeleted = 0";
    if (yearId !== null) where += " AND dcm.fk_year_id = @YearId";
    if (search && search.trim()) where += searchClause("dcm");
    const params = { DistrictId: districtId, YearId: yearId, Search: search && search.trim() ? `%${search.trim()}%` : null, PageSize: pageSize, Offset: (page - 1) * pageSize };
    const joins = `LEFT JOIN club_master c ON c.pk_club_id = dcm.fk_club_id
                   LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = dcm.fk_member_id AND m.isdeleted = 0`;
    return this.db.session(async (conn) => {
      const totalCount = Number(await conn.executeScalar(`SELECT COUNT(DISTINCT dcm.id) FROM district_committee_member dcm ${joins} ${where}`, params));
      const items = await conn.query(
        `SELECT dcm.id, dcm.fk_district_id AS districtId, dcm.fk_year_id AS yearId, dcm.fk_member_id AS memberId, dcm.is_member AS isMember, dcm.name,
                ${liveContact("dcm")}, dcm.district_designation AS districtDesignation, dcm.fk_club_id AS clubId,
                CASE WHEN COALESCE(dcm.fk_member_id,0) > 0 THEN c.ClubName ELSE dcm.club_name END AS clubName, dcm.district_remark AS districtRemark,
                ${livePhoto("dcm", "COALESCE(dcm.fk_club_id, dcm.fk_district_id)")}, dcm.sort_order AS sortOrder, dcm.is_active AS isActive, y.YearLabel AS yearLabel
         FROM district_committee_member dcm ${joins}
         LEFT JOIN rotary_year_master y ON y.pk_year_id = dcm.fk_year_id
         ${where}
         ORDER BY dcm.sort_order
         LIMIT @PageSize OFFSET @Offset`,
        params,
      );
      return ok({ items, totalCount, page, pageSize, totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize) });
    });
  }

  @Get("members/available-years")
  async memberYears(@Param("districtId") d: string) {
    const districtId = paramInt(d, "districtId");
    return (
      (await this.blocked(districtId)) ??
      ok(
        await this.db.query(
          `SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
           FROM district_committee_member dcm INNER JOIN rotary_year_master y ON y.pk_year_id = dcm.fk_year_id
           WHERE dcm.fk_district_id = @DistrictId AND dcm.isdeleted = 0
           ORDER BY y.pk_year_id DESC`,
          { DistrictId: districtId },
        ),
      )
    );
  }

  @Get("members/non-sync-removed")
  async membersNonSyncRemoved(@Param("districtId") d: string, @Query("yearId") y?: string) {
    const districtId = paramInt(d, "districtId");
    const yearId = queryInt(y);
    const where = `dcm.fk_district_id = @DistrictId${yearId !== null ? " AND dcm.fk_year_id = @YearId" : ""}`;
    return ok({ items: await this.nonSyncRemoved("district_committee_member", "dcm", where, { DistrictId: districtId, YearId: yearId }, ", dcm.fk_year_id AS yearId") });
  }

  @Put("members/reorder")
  reorderMembers(@Param("districtId") d: string, @Body() body: unknown) {
    return this.reorder("district_committee_member", "fk_district_id", paramInt(d, "districtId"), body);
  }

  @Post("members")
  async createMember(@Param("districtId") d: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    const dto = MemberBody.create(body ?? {}) as unknown as MemberDto;
    return this.db.session(async (conn) => {
      const sort = await DistrictCommitteeController.nextSort(conn, "district_committee_member", "fk_district_id=@DistrictId AND fk_year_id=@YearId", { DistrictId: districtId, YearId: dto.yearId });
      await conn.execute(
        `INSERT INTO district_committee_member (fk_district_id, fk_year_id, fk_member_id, is_member, name, mobile, email,
             district_designation, fk_club_id, club_name, district_remark, profile_photo, sort_order, created_by)
         VALUES (@DistrictId, @YearId, @MemberId, @IsMember, @Name, @Mobile, @Email, @DistrictDesignation, @ClubId, @ClubName, @DistrictRemark, @ProfilePhoto, @SortOrder, @UserId)`,
        { ...memberParams(dto), DistrictId: districtId, YearId: dto.yearId, SortOrder: sort, UserId: this.userId(u) },
      );
      return ok({ id: Number(await conn.executeScalar("SELECT LAST_INSERT_ID()")), message: "Committee member added." });
    });
  }

  @Post("members/:id/add-as-non-member")
  addMemberAsNonMember(@Param("districtId") d: string, @Param("id") i: string, @User() u: CurrentUser) {
    return this.addAsNonMember(
      "district_committee_member", "fk_district_id", paramInt(d, "districtId"), paramInt(i), this.userId(u), "Committee member not found.", ", fk_year_id", ", @YearId",
    );
  }

  @Put("members/:id")
  async updateMember(@Param("districtId") d: string, @Param("id") i: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    const dto = MemberBody.create(body ?? {}) as unknown as MemberDto;
    await this.db.execute(
      `UPDATE district_committee_member SET fk_year_id=@YearId, fk_member_id=@MemberId, is_member=@IsMember, name=@Name, mobile=@Mobile, email=@Email,
           district_designation=@DistrictDesignation, fk_club_id=@ClubId, club_name=@ClubName, district_remark=@DistrictRemark, profile_photo=@ProfilePhoto, modified_by=@UserId
       WHERE id=@Id AND fk_district_id=@DistrictId AND isdeleted=0`,
      { ...memberParams(dto), Id: paramInt(i), DistrictId: paramInt(d, "districtId"), YearId: dto.yearId, UserId: this.userId(u) },
    );
    return ok({ message: "Committee member updated." });
  }

  @Delete("members/:id")
  async deleteMember(@Param("districtId") d: string, @Param("id") i: string) {
    await this.db.execute("UPDATE district_committee_member SET isdeleted=1 WHERE id=@Id AND fk_district_id=@DistrictId", { Id: paramInt(i), DistrictId: paramInt(d, "districtId") });
    return ok({ message: "Committee member deleted." });
  }

  // ---- groups ----

  @Get("groups")
  async groups(
    @Param("districtId") d: string, @Query("yearId") y?: string, @Query("page") p?: string, @Query("pageSize") ps?: string, @Query("search") search?: string,
  ) {
    const districtId = paramInt(d, "districtId");
    const yearId = queryInt(y);
    const { page, pageSize } = paging(p, ps);
    const block = await this.blocked(districtId);
    if (block) return block;
    let where = "WHERE g.fk_district_id = @DistrictId AND g.isdeleted = 0";
    if (yearId !== null) where += " AND g.fk_year_id = @YearId";
    if (search && search.trim()) where += " AND g.group_name LIKE @Search";
    const params = { DistrictId: districtId, YearId: yearId, Search: search && search.trim() ? `%${search.trim()}%` : null, PageSize: pageSize, Offset: (page - 1) * pageSize };
    return this.db.session(async (conn) => {
      const totalCount = Number(await conn.executeScalar(`SELECT COUNT(*) FROM district_committee_group g ${where}`, params));
      const items = await conn.query(
        `SELECT g.id, g.fk_district_id AS districtId, g.fk_year_id AS yearId, g.group_name AS groupName, g.sort_order AS sortOrder, g.is_active AS isActive,
                y.YearLabel AS yearLabel,
                (SELECT COUNT(*) FROM district_committee_group_member gm WHERE gm.fk_group_id = g.id AND gm.isdeleted = 0) AS memberCount,
                (SELECT COUNT(*) FROM district_committee_sub_group sg WHERE sg.fk_group_id = g.id AND sg.isdeleted = 0) AS subGroupCount
         FROM district_committee_group g
         LEFT JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
         ${where}
         ORDER BY g.sort_order, g.group_name
         LIMIT @PageSize OFFSET @Offset`,
        params,
      );
      return ok({ items, totalCount, page, pageSize, totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize) });
    });
  }

  @Get("groups/available-years")
  async groupYears(@Param("districtId") d: string) {
    const districtId = paramInt(d, "districtId");
    return (
      (await this.blocked(districtId)) ??
      ok(
        await this.db.query(
          `SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
           FROM district_committee_group g INNER JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
           WHERE g.fk_district_id = @DistrictId AND g.isdeleted = 0
           ORDER BY y.pk_year_id DESC`,
          { DistrictId: districtId },
        ),
      )
    );
  }

  @Put("groups/reorder")
  reorderGroups(@Param("districtId") d: string, @Body() body: unknown) {
    return this.reorder("district_committee_group", "fk_district_id", paramInt(d, "districtId"), body);
  }

  @Get("groups/:groupId")
  async group(@Param("districtId") d: string, @Param("groupId") g: string) {
    const [districtId, groupId] = [paramInt(d, "districtId"), paramInt(g, "groupId")];
    const block = await this.blocked(districtId);
    if (block) return block;
    const group = await this.db.queryFirstOrDefault(
      `SELECT g.id, g.fk_district_id AS districtId, g.fk_year_id AS yearId, g.group_name AS groupName, g.is_active AS isActive, y.YearLabel AS yearLabel
       FROM district_committee_group g LEFT JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
       WHERE g.id = @GroupId AND g.fk_district_id = @DistrictId AND g.isdeleted = 0`,
      { GroupId: groupId, DistrictId: districtId },
    );
    return group ? ok(group) : notFound({ message: "Group not found." });
  }

  @Post("groups")
  async createGroup(@Param("districtId") d: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    const dto = GroupBody.create(body ?? {}) as { yearId: number; groupName: string };
    const reject = this.rejectAutoGroupByName(dto.groupName);
    if (reject) return reject;
    return this.db.session(async (conn) => {
      const sort = await DistrictCommitteeController.nextSort(conn, "district_committee_group", "fk_district_id=@DistrictId AND fk_year_id=@YearId", { DistrictId: districtId, YearId: dto.yearId });
      await conn.execute(
        "INSERT INTO district_committee_group (fk_district_id, fk_year_id, group_name, sort_order, created_by) VALUES (@DistrictId, @YearId, @GroupName, @SortOrder, @UserId)",
        { DistrictId: districtId, YearId: dto.yearId, GroupName: dto.groupName, SortOrder: sort, UserId: this.userId(u) },
      );
      return ok({ id: Number(await conn.executeScalar("SELECT LAST_INSERT_ID()")), message: "Group created." });
    });
  }

  @Put("groups/:id")
  async updateGroup(@Param("districtId") d: string, @Param("id") i: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    const [districtId, id] = [paramInt(d, "districtId"), paramInt(i)];
    const dto = GroupBody.create(body ?? {}) as { yearId: number; groupName: string };
    return this.db.session(async (conn) => {
      const reject = (await this.rejectAutoGroupById(conn, id)) ?? this.rejectAutoGroupByName(dto.groupName);
      if (reject) return reject;
      await conn.execute(
        `UPDATE district_committee_group SET group_name=@GroupName, fk_year_id = IF(@YearId > 0, @YearId, fk_year_id), modified_by=@UserId
         WHERE id=@Id AND fk_district_id=@DistrictId AND isdeleted=0`,
        { Id: id, DistrictId: districtId, GroupName: dto.groupName, YearId: dto.yearId, UserId: this.userId(u) },
      );
      return ok({ message: "Group updated." });
    });
  }

  @Delete("groups/:id")
  async deleteGroup(@Param("districtId") d: string, @Param("id") i: string) {
    const [districtId, id] = [paramInt(d, "districtId"), paramInt(i)];
    return this.db.session(async (conn) => {
      const reject = await this.rejectAutoGroupById(conn, id);
      if (reject) return reject;
      await conn.execute("UPDATE district_committee_group SET isdeleted=1 WHERE id=@Id AND fk_district_id=@DistrictId", { Id: id, DistrictId: districtId });
      await conn.execute("UPDATE district_committee_group_member SET isdeleted=1 WHERE fk_group_id=@Id", { Id: id });
      const subGroupIds = (await conn.query("SELECT id FROM district_committee_sub_group WHERE fk_group_id=@Id AND isdeleted=0", { Id: id })).map((r) => Number(r.id));
      if (subGroupIds.length) {
        await conn.execute("UPDATE district_committee_sub_group SET isdeleted=1 WHERE fk_group_id=@Id", { Id: id });
        await conn.execute("UPDATE district_committee_sub_group_member SET isdeleted=1 WHERE fk_sub_group_id IN @Ids", { Ids: subGroupIds });
      }
      return ok({ message: "Group deleted." });
    });
  }

  // ---- group members ----

  @Get("groups/:groupId/members/non-sync-removed")
  async groupNonSyncRemoved(@Param("districtId") d: string, @Param("groupId") g: string) {
    paramInt(d, "districtId");
    return ok({ items: await this.nonSyncRemoved("district_committee_group_member", "gm", "gm.fk_group_id = @GroupId", { GroupId: paramInt(g, "groupId") }) });
  }

  @Put("groups/:groupId/members/reorder")
  reorderGroupMembers(@Param("districtId") d: string, @Param("groupId") g: string, @Body() body: unknown) {
    paramInt(d, "districtId");
    return this.reorder("district_committee_group_member", "fk_group_id", paramInt(g, "groupId"), body);
  }

  @Get("groups/:groupId/members")
  async groupMembers(
    @Param("districtId") d: string, @Param("groupId") g: string, @Query("page") p?: string, @Query("pageSize") ps?: string, @Query("search") search?: string,
  ) {
    const [districtId, groupId] = [paramInt(d, "districtId"), paramInt(g, "groupId")];
    const { page, pageSize } = paging(p, ps);
    const block = await this.blocked(districtId);
    if (block) return block;
    let where = "WHERE gm.fk_group_id = @GroupId AND gm.isdeleted = 0";
    if (search && search.trim()) where += searchClause("gm");
    const params = { GroupId: groupId, Search: search && search.trim() ? `%${search.trim()}%` : null, PageSize: pageSize, Offset: (page - 1) * pageSize };
    const joins = `LEFT JOIN club_master c ON c.pk_club_id = gm.fk_club_id
                   LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = gm.fk_member_id AND m.isdeleted = 0`;
    return this.db.session(async (conn) => {
      const totalCount = Number(await conn.executeScalar(`SELECT COUNT(DISTINCT gm.id) FROM district_committee_group_member gm ${joins} ${where}`, params));
      const items = await conn.query(
        `SELECT gm.id, gm.fk_group_id AS groupId, gm.fk_member_id AS memberId, gm.is_member AS isMember, gm.name, ${liveContact("gm")},
                gm.district_designation AS districtDesignation, gm.fk_club_id AS clubId,
                CASE WHEN COALESCE(gm.fk_member_id,0) > 0 THEN c.ClubName ELSE gm.club_name END AS clubName, gm.district_remark AS districtRemark,
                ${livePhoto("gm", "COALESCE(gm.fk_club_id, 0)")}, gm.sort_order AS sortOrder, gm.is_active AS isActive,
                cls.ClassificationProfession AS classification, sp.Name AS spouseName, sp.BirthDate AS spouseDob,
                CASE WHEN sp.PhotoPath IS NULL OR sp.PhotoPath = '' THEN NULL WHEN sp.PhotoPath LIKE '/%' THEN sp.PhotoPath WHEN sp.PhotoPath LIKE 'http%' THEN sp.PhotoPath
                     ELSE CONCAT('/Documents/FaimilyMembersPhoto/', SUBSTRING_INDEX(sp.PhotoPath, '/', -1)) END AS spousePhoto,
                cty.PhoneCode AS mobileCountryCode, cty.pk_country_id AS mobileCountryId, cty.CountryName AS mobileCountryName
         FROM district_committee_group_member gm ${joins}
         LEFT JOIN country_master cty ON cty.pk_country_id = m.fk_primary_country_id
         LEFT JOIN (SELECT cm.fk_member_master_profile_id, cm.ClassificationProfession
                    FROM club_members cm
                    JOIN (SELECT fk_member_master_profile_id, MIN(pk_club_member_id) AS pk_id FROM club_members
                          WHERE COALESCE(isdeleted,0) = 0 AND IsActive = 1 AND ClassificationProfession IS NOT NULL AND ClassificationProfession <> ''
                          GROUP BY fk_member_master_profile_id) pick ON pick.pk_id = cm.pk_club_member_id
                   ) cls ON cls.fk_member_master_profile_id = gm.fk_member_id
         LEFT JOIN (SELECT f.fk_member_master_profile_id, f.Name, f.BirthDate, f.PhotoPath
                    FROM member_family_details f
                    JOIN (SELECT pk_member_family_details_id AS pk_id,
                                 ROW_NUMBER() OVER (PARTITION BY fk_member_master_profile_id ORDER BY COALESCE(modified_date, created_date) DESC, pk_member_family_details_id DESC) AS rn
                          FROM member_family_details
                          WHERE LOWER(TRIM(Relation)) = 'spouse' AND COALESCE(isdeleted,0) = 0) pick ON pick.pk_id = f.pk_member_family_details_id AND pick.rn = 1
                   ) sp ON sp.fk_member_master_profile_id = gm.fk_member_id
         ${where}
         ORDER BY gm.sort_order
         LIMIT @PageSize OFFSET @Offset`,
        params,
      );
      // Spouse details are family data: hidden when the brand has family details off.
      if (!Brand.feature("member.familyDetails")) for (const r of items) r.spouseName = r.spouseDob = r.spousePhoto = null;
      return ok({ items, totalCount, page, pageSize, totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize) });
    });
  }

  @Post("groups/:groupId/members")
  async createGroupMember(@Param("districtId") d: string, @Param("groupId") g: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    const groupId = paramInt(g, "groupId");
    const dto = MemberBody.create(body ?? {}) as unknown as MemberDto;
    return this.db.session(async (conn) => {
      const reject = await this.rejectAutoGroupById(conn, groupId);
      if (reject) return reject;
      const sort = await DistrictCommitteeController.nextSort(conn, "district_committee_group_member", "fk_group_id=@GroupId", { GroupId: groupId });
      await conn.execute(
        `INSERT INTO district_committee_group_member (fk_group_id, fk_member_id, is_member, name, mobile, email,
             district_designation, fk_club_id, club_name, district_remark, profile_photo, sort_order, created_by)
         VALUES (@GroupId, @MemberId, @IsMember, @Name, @Mobile, @Email, @DistrictDesignation, @ClubId, @ClubName, @DistrictRemark, @ProfilePhoto, @SortOrder, @UserId)`,
        { ...memberParams(dto), GroupId: groupId, SortOrder: sort, UserId: this.userId(u) },
      );
      return ok({ id: Number(await conn.executeScalar("SELECT LAST_INSERT_ID()")), message: "Member added to group." });
    });
  }

  @Post("groups/:groupId/members/:id/add-as-non-member")
  async addGroupMemberAsNonMember(@Param("districtId") d: string, @Param("groupId") g: string, @Param("id") i: string, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    const groupId = paramInt(g, "groupId");
    const reject = await this.rejectAutoGroupById(this.db, groupId);
    if (reject) return reject;
    return this.addAsNonMember("district_committee_group_member", "fk_group_id", groupId, paramInt(i), this.userId(u), "Group member not found.");
  }

  @Put("groups/:groupId/members/:id")
  async updateGroupMember(@Param("districtId") d: string, @Param("groupId") g: string, @Param("id") i: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    const [groupId, id] = [paramInt(g, "groupId"), paramInt(i)];
    const dto = MemberBody.create(body ?? {}) as unknown as MemberDto;
    return this.db.session(async (conn) => {
      const reject = await this.rejectAutoGroupById(conn, groupId);
      if (reject) return reject;
      await conn.execute(
        `UPDATE district_committee_group_member SET fk_member_id=@MemberId, is_member=@IsMember, name=@Name, mobile=@Mobile, email=@Email,
             district_designation=@DistrictDesignation, fk_club_id=@ClubId, club_name=@ClubName, district_remark=@DistrictRemark, profile_photo=@ProfilePhoto, modified_by=@UserId
         WHERE id=@Id AND fk_group_id=@GroupId AND isdeleted=0`,
        { ...memberParams(dto), Id: id, GroupId: groupId, UserId: this.userId(u) },
      );
      return ok({ message: "Group member updated." });
    });
  }

  @Delete("groups/:groupId/members/:id")
  async deleteGroupMember(@Param("districtId") d: string, @Param("groupId") g: string, @Param("id") i: string) {
    paramInt(d, "districtId");
    const [groupId, id] = [paramInt(g, "groupId"), paramInt(i)];
    return this.db.session(async (conn) => {
      const reject = await this.rejectAutoGroupById(conn, groupId);
      if (reject) return reject;
      await conn.execute("UPDATE district_committee_group_member SET isdeleted=1 WHERE id=@Id AND fk_group_id=@GroupId", { Id: id, GroupId: groupId });
      return ok({ message: "Group member deleted." });
    });
  }

  // ---- sub-groups ----

  @Get("groups/:groupId/sub-groups")
  async subGroups(@Param("districtId") d: string, @Param("groupId") g: string) {
    const [districtId, groupId] = [paramInt(d, "districtId"), paramInt(g, "groupId")];
    return (
      (await this.blocked(districtId)) ??
      ok(
        await this.db.query(
          `SELECT sg.id, sg.fk_group_id AS groupId, sg.sub_group_name AS subGroupName, sg.sort_order AS sortOrder, sg.is_active AS isActive,
                  (SELECT COUNT(*) FROM district_committee_sub_group_member sgm WHERE sgm.fk_sub_group_id = sg.id AND sgm.isdeleted = 0) AS memberCount
           FROM district_committee_sub_group sg
           WHERE sg.fk_group_id = @GroupId AND sg.isdeleted = 0
           ORDER BY sg.sort_order, sg.sub_group_name`,
          { GroupId: groupId },
        ),
      )
    );
  }

  @Put("groups/:groupId/sub-groups/reorder")
  reorderSubGroups(@Param("districtId") d: string, @Param("groupId") g: string, @Body() body: unknown) {
    paramInt(d, "districtId");
    return this.reorder("district_committee_sub_group", "fk_group_id", paramInt(g, "groupId"), body);
  }

  @Post("groups/:groupId/sub-groups")
  async createSubGroup(@Param("districtId") d: string, @Param("groupId") g: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    const groupId = paramInt(g, "groupId");
    const dto = SubGroupBody.create(body ?? {}) as { subGroupName: string };
    return this.db.session(async (conn) => {
      const sort = await DistrictCommitteeController.nextSort(conn, "district_committee_sub_group", "fk_group_id=@GroupId", { GroupId: groupId });
      await conn.execute("INSERT INTO district_committee_sub_group (fk_group_id, sub_group_name, sort_order, created_by) VALUES (@GroupId, @SubGroupName, @SortOrder, @UserId)", {
        GroupId: groupId, SubGroupName: dto.subGroupName, SortOrder: sort, UserId: this.userId(u),
      });
      return ok({ id: Number(await conn.executeScalar("SELECT LAST_INSERT_ID()")), message: "Sub group created." });
    });
  }

  @Put("groups/:groupId/sub-groups/:id")
  async updateSubGroup(@Param("districtId") d: string, @Param("groupId") g: string, @Param("id") i: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    const dto = SubGroupBody.create(body ?? {}) as { subGroupName: string };
    await this.db.execute("UPDATE district_committee_sub_group SET sub_group_name=@SubGroupName, modified_by=@UserId WHERE id=@Id AND fk_group_id=@GroupId AND isdeleted=0", {
      Id: paramInt(i), GroupId: paramInt(g, "groupId"), SubGroupName: dto.subGroupName, UserId: this.userId(u),
    });
    return ok({ message: "Sub group updated." });
  }

  @Delete("groups/:groupId/sub-groups/:id")
  async deleteSubGroup(@Param("districtId") d: string, @Param("groupId") g: string, @Param("id") i: string) {
    paramInt(d, "districtId");
    const id = paramInt(i);
    await this.db.execute("UPDATE district_committee_sub_group SET isdeleted=1 WHERE id=@Id AND fk_group_id=@GroupId", { Id: id, GroupId: paramInt(g, "groupId") });
    await this.db.execute("UPDATE district_committee_sub_group_member SET isdeleted=1 WHERE fk_sub_group_id=@Id", { Id: id });
    return ok({ message: "Sub group deleted." });
  }

  // ---- sub-group members ----

  @Get("sub-groups/:subGroupId/members/non-sync-removed")
  async subGroupNonSyncRemoved(@Param("districtId") d: string, @Param("subGroupId") s: string) {
    paramInt(d, "districtId");
    return ok({ items: await this.nonSyncRemoved("district_committee_sub_group_member", "sgm", "sgm.fk_sub_group_id = @SubGroupId", { SubGroupId: paramInt(s, "subGroupId") }) });
  }

  @Put("sub-groups/:subGroupId/members/reorder")
  reorderSubGroupMembers(@Param("districtId") d: string, @Param("subGroupId") s: string, @Body() body: unknown) {
    paramInt(d, "districtId");
    return this.reorder("district_committee_sub_group_member", "fk_sub_group_id", paramInt(s, "subGroupId"), body);
  }

  @Get("sub-groups/:subGroupId/members")
  async subGroupMembers(@Param("districtId") d: string, @Param("subGroupId") s: string) {
    const [districtId, subGroupId] = [paramInt(d, "districtId"), paramInt(s, "subGroupId")];
    return (
      (await this.blocked(districtId)) ??
      ok(
        await this.db.query(
          `SELECT sgm.id, sgm.fk_sub_group_id AS subGroupId, sgm.fk_member_id AS memberId, sgm.is_member AS isMember, sgm.name, ${liveContact("sgm")},
                  sgm.district_designation AS districtDesignation, sgm.fk_club_id AS clubId,
                  CASE WHEN COALESCE(sgm.fk_member_id,0) > 0 THEN c.ClubName ELSE sgm.club_name END AS clubName, sgm.district_remark AS districtRemark,
                  CASE WHEN COALESCE(sgm.fk_member_id, 0) > 0 THEN
                            CASE WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                                 WHEN m.ProfilePhotoPath LIKE '/%' OR m.ProfilePhotoPath LIKE 'http%' THEN m.ProfilePhotoPath
                                 ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1)) END
                       ELSE sgm.profile_photo END AS profilePhoto,
                  sgm.sort_order AS sortOrder, sgm.is_active AS isActive
           FROM district_committee_sub_group_member sgm
           LEFT JOIN club_master c ON c.pk_club_id = sgm.fk_club_id
           LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = sgm.fk_member_id AND m.isdeleted = 0
           WHERE sgm.fk_sub_group_id = @SubGroupId AND sgm.isdeleted = 0
           ORDER BY sgm.sort_order, sgm.name`,
          { SubGroupId: subGroupId },
        ),
      )
    );
  }

  @Post("sub-groups/:subGroupId/members")
  async createSubGroupMember(@Param("districtId") d: string, @Param("subGroupId") s: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    const subGroupId = paramInt(s, "subGroupId");
    const dto = MemberBody.create(body ?? {}) as unknown as MemberDto;
    return this.db.session(async (conn) => {
      const sort = await DistrictCommitteeController.nextSort(conn, "district_committee_sub_group_member", "fk_sub_group_id=@SubGroupId", { SubGroupId: subGroupId });
      await conn.execute(
        `INSERT INTO district_committee_sub_group_member (fk_sub_group_id, fk_member_id, is_member, name, mobile, email,
             district_designation, fk_club_id, club_name, district_remark, profile_photo, sort_order, created_by)
         VALUES (@SubGroupId, @MemberId, @IsMember, @Name, @Mobile, @Email, @DistrictDesignation, @ClubId, @ClubName, @DistrictRemark, @ProfilePhoto, @SortOrder, @UserId)`,
        { ...memberParams(dto), SubGroupId: subGroupId, SortOrder: sort, UserId: this.userId(u) },
      );
      return ok({ id: Number(await conn.executeScalar("SELECT LAST_INSERT_ID()")), message: "Member added to sub group." });
    });
  }

  /** RIZones never passes @SortOrder here (the insert fails); ROW passes the next sort order. */
  @Post("sub-groups/:subGroupId/members/:id/add-as-non-member")
  addSubGroupMemberAsNonMember(@Param("districtId") d: string, @Param("subGroupId") s: string, @Param("id") i: string, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    return this.addAsNonMember("district_committee_sub_group_member", "fk_sub_group_id", paramInt(s, "subGroupId"), paramInt(i), this.userId(u), "Sub-group member not found.");
  }

  @Put("sub-groups/:subGroupId/members/:id")
  async updateSubGroupMember(@Param("districtId") d: string, @Param("subGroupId") s: string, @Param("id") i: string, @Body() body: Record<string, unknown>, @User() u: CurrentUser) {
    paramInt(d, "districtId");
    const dto = MemberBody.create(body ?? {}) as unknown as MemberDto;
    await this.db.execute(
      `UPDATE district_committee_sub_group_member SET fk_member_id=@MemberId, is_member=@IsMember, name=@Name, mobile=@Mobile, email=@Email,
           district_designation=@DistrictDesignation, fk_club_id=@ClubId, club_name=@ClubName, district_remark=@DistrictRemark, profile_photo=@ProfilePhoto, modified_by=@UserId
       WHERE id=@Id AND fk_sub_group_id=@SubGroupId AND isdeleted=0`,
      { ...memberParams(dto), Id: paramInt(i), SubGroupId: paramInt(s, "subGroupId"), UserId: this.userId(u) },
    );
    return ok({ message: "Sub group member updated." });
  }

  @Delete("sub-groups/:subGroupId/members/:id")
  async deleteSubGroupMember(@Param("districtId") d: string, @Param("subGroupId") s: string, @Param("id") i: string) {
    paramInt(d, "districtId");
    await this.db.execute("UPDATE district_committee_sub_group_member SET isdeleted=1 WHERE id=@Id AND fk_sub_group_id=@SubGroupId", { Id: paramInt(i), SubGroupId: paramInt(s, "subGroupId") });
    return ok({ message: "Sub group member deleted." });
  }
}
