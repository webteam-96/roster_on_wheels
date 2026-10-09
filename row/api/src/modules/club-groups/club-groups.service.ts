import { Injectable } from "@nestjs/common";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { Db, type DbCommands } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { defineDto, type DtoObject } from "../../common/dto";
import { InvalidOperationException, KeyNotFoundException } from "../../common/exceptions";
import { dbDateTime } from "../../common/binding";
import { ensureRotaryYear } from "../../services/year-table.resolver";
import { CitationRecalcTrigger } from "../../services/citation-recalc.trigger";
import { saveWithReadableName, webRootPath, type UploadedFile } from "../../services/media-storage";

const str = { type: "string" as const, default: () => "" };
const list = { type: "object" as const, default: () => [] };

export const SubGroupListDto = defineDto({ Id: "int", ClubId: "int", YearId: "int", YearLabel: str, GroupName: str, MemberCount: "int" });
export const SubGroupDetailDto = defineDto({ Id: "int", ClubId: "int", YearId: "int", YearLabel: str, GroupName: str, Members: list });
export const SubGroupMemberDto = defineDto({ MemberId: "int", MemberName: str, Email: "string", MobileNumber: "string", ProfilePhotoPath: "string", ClubName: "string" });

export const WeblinkListDto = defineDto({
  Id: "int", ClubId: "int", ParentId: "int?", Level: "int", Title: str, Writeup: "string", LogoPath: "string", BannerPath: "string",
  LinkType: { type: "string", default: () => "None" }, LinkUrl: "string", PdfPath: "string", YoutubeUrl: "string", ButtonText: "string",
  SortOrder: "int", IsActive: "bool", ChildCount: "int",
});
export const WeblinkTreeDto = defineDto({
  Id: "int", ParentId: "int?", Level: "int", Title: str, Writeup: "string", LogoPath: "string", BannerPath: "string",
  LinkType: { type: "string", default: () => "None" }, LinkUrl: "string", PdfPath: "string", YoutubeUrl: "string", ButtonText: "string",
  SortOrder: "int", IsActive: "bool", Children: list,
});
/** CreateWeblinkDto / UpdateWeblinkDto (form fields; Update adds IsActive, Create adds ParentId). */
export const SaveWeblinkDto = defineDto({
  ParentId: "int?", Title: str, Writeup: "string", LinkType: { type: "string", default: () => "None" }, LinkUrl: "string", YoutubeUrl: "string",
  ButtonText: "string", SortOrder: "int", IsActive: "bool",
});
export type SaveWeblink = {
  parentId: number | null; title: string; writeup: string | null; linkType: string; linkUrl: string | null; youtubeUrl: string | null;
  buttonText: string | null; sortOrder: number; isActive: boolean;
};

export const AttendanceListDto = defineDto({
  Id: "int", ClubId: "int", YearId: "int", EventName: str, EventDateTime: "datetime", MembersCount: "int", AnnsCount: "int", AnnetsCount: "int",
  VisitorsCount: "int", RotariansCount: "int", DelegatesCount: "int",
});
export const AttendanceDetailDto = defineDto({
  Id: "int", ClubId: "int", YearId: "int", EventName: str, Description: str, EventDateTime: "datetime", Members: list, Anns: list, Annets: list,
  Visitors: list, Rotarians: list, Delegates: list,
});
export const SaveAttendanceDto = defineDto({
  EventName: str, Description: str, EventDateTime: "string", MemberIds: "object", Anns: "object", Annets: "object", Visitors: "object",
  Rotarians: "object", Delegates: "object",
});
export type SaveAttendance = {
  eventName: string; description: string; eventDateTime: string | null; memberIds: unknown; anns: unknown; annets: unknown; visitors: unknown;
  rotarians: unknown; delegates: unknown;
};

const MEMBER_PHOTO = `
    CASE
        WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
        WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
        ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
    END`;
const WEBLINK_FILE = (col: string, alias = "") => `
    CASE
        WHEN ${alias}${col} IS NULL OR ${alias}${col} = '' THEN NULL
        WHEN ${alias}${col} LIKE '/%' THEN ${alias}${col}
        WHEN ${alias}Scope = 'ri' THEN CONCAT('/Documents/Weblink/ri/', ${alias}${col})
        WHEN ${alias}fk_district_id IS NOT NULL THEN CONCAT('/Documents/Weblink/Group', ${alias}fk_district_id, '/', ${alias}${col})
        ELSE CONCAT('/Documents/Weblink/Group', ${alias}fk_club_id, '/', ${alias}${col})
    END`;

/** UrlValidator.cs: http(s) URLs ending in a known top-level domain. */
const WEB_URL =
  /^https?:\/\/(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:com|net|org|edu|gov|mil|int|info|biz|name|pro|online|site|store|tech|cloud|page|club|live|news|blog|asia|app|dev|xyz|mobi|io|ai|me|tv|us|uk|au|ca|sg|ae|np|lk|bd|pk|eu|be|ly|gl|cc|ws|gg|fm|to|sh|im|in|co)(?::\d{1,5})?(?:\/\S*)?$/i;
export const isValidWebUrl = (url: string | null | undefined) => !!url && !!url.trim() && WEB_URL.test(url.trim());
export function validateWeblinkUrls(linkType: string | null, linkUrl: string | null, youtubeUrl: string | null) {
  if ((linkType ?? "").toLowerCase() === "url") {
    if (!linkUrl || !linkUrl.trim()) throw new InvalidOperationException("Link URL is required.");
    if (!isValidWebUrl(linkUrl)) throw new InvalidOperationException("Enter a valid URL with http:// or https:// and a real domain ending such as .com or .in (e.g. https://example.com).");
  }
  if (youtubeUrl && youtubeUrl.trim() && !isValidWebUrl(youtubeUrl)) {
    throw new InvalidOperationException("Enter a valid YouTube URL starting with http:// or https:// (e.g. https://youtube.com/watch?v=...).");
  }
}

const objects = (raw: unknown) => (Array.isArray(raw) ? (raw as Record<string, unknown>[]).filter((x) => x && typeof x === "object") : []);
/** A body property of a list item, any casing. */
const field = (o: Record<string, unknown>, name: string) => {
  const v = Object.entries(o).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
  return v === undefined || v === null ? null : String(v);
};

/** Ports of SubGroupService.cs, WeblinkService.cs and AttendanceService.cs. */
@Injectable()
export class ClubGroupsService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly citation: CitationRecalcTrigger,
  ) {}

  // ---- sub-groups ----

  async getSubGroups(clubId: number, yearId: number, districtId: number | null = null) {
    const where = districtId !== null ? "sg.fk_district_id = @EntityId" : "sg.fk_club_id = @EntityId";
    return SubGroupListDto.mapAll(
      await this.db.query(
        `SELECT sg.pk_sub_group_id AS Id, sg.fk_club_id AS ClubId, sg.fk_year_id AS YearId,
                y.YearLabel, sg.GroupName,
                COUNT(sgm.pk_sub_group_member_id) AS MemberCount
         FROM sub_groups sg
         INNER JOIN rotary_year_master y ON y.pk_year_id = sg.fk_year_id
         LEFT JOIN sub_group_members sgm ON sgm.fk_sub_group_id = sg.pk_sub_group_id AND sgm.isdeleted = 0
         WHERE ${where} AND sg.fk_year_id = @YearId AND sg.isdeleted = 0
         GROUP BY sg.pk_sub_group_id, sg.fk_club_id, sg.fk_year_id, y.YearLabel, sg.GroupName
         ORDER BY sg.GroupName`,
        { EntityId: districtId ?? clubId, YearId: yearId },
      ),
    );
  }

  async getSubGroupDetail(subGroupId: number) {
    return this.db.session(async (conn) => {
      const group = SubGroupDetailDto.map(
        await conn.queryFirstOrDefault(
          `SELECT sg.pk_sub_group_id AS Id, sg.fk_club_id AS ClubId, sg.fk_year_id AS YearId,
                  y.YearLabel, sg.GroupName
           FROM sub_groups sg
           INNER JOIN rotary_year_master y ON y.pk_year_id = sg.fk_year_id
           WHERE sg.pk_sub_group_id = @SubGroupId AND sg.isdeleted = 0`,
          { SubGroupId: subGroupId },
        ),
      );
      if (!group) throw new KeyNotFoundException("Sub group not found.");
      group.members = SubGroupMemberDto.mapAll(
        await conn.query(
          `SELECT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId AS Email,
                  m.PrimaryMobileNumber AS MobileNumber, ${MEMBER_PHOTO} AS ProfilePhotoPath
           FROM sub_group_members sgm
           INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = sgm.fk_member_master_profile_id
           WHERE sgm.fk_sub_group_id = @SubGroupId AND sgm.isdeleted = 0 AND m.isdeleted = 0
           ORDER BY m.MemberName`,
          { SubGroupId: subGroupId },
        ),
      );
      return group;
    });
  }

  async createSubGroup(clubId: number, yearId: number, groupName: string, memberIds: number[], userId: number, districtId: number | null = null) {
    return this.db.session(async (conn) => {
      const groupId = Number(
        await conn.executeScalar(
          `INSERT INTO sub_groups (fk_club_id, fk_district_id, fk_year_id, GroupName, created_by, created_date)
           VALUES (@ClubId, @DistrictId, @YearId, @GroupName, @UserId, NOW());
           SELECT LAST_INSERT_ID();`,
          { ClubId: districtId !== null ? 0 : clubId, DistrictId: districtId, YearId: yearId, GroupName: groupName, UserId: userId },
        ),
      );
      for (const memberId of memberIds) {
        await conn.execute(
          `INSERT INTO sub_group_members (fk_sub_group_id, fk_member_master_profile_id, created_by, created_date)
           VALUES (@GroupId, @MemberId, @UserId, NOW())`,
          { GroupId: groupId, MemberId: memberId, UserId: userId },
        );
      }
      const yearLabel = (await conn.executeScalar<string>("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @YearId", { YearId: yearId })) ?? "";
      return SubGroupListDto.create({
        Id: groupId, ClubId: districtId !== null ? 0 : clubId, YearId: yearId, YearLabel: yearLabel, GroupName: groupName, MemberCount: memberIds.length,
      });
    });
  }

  /** Renames the group, optionally moves it to another year, and replaces its members. */
  async updateSubGroup(subGroupId: number, yearId: number, groupName: string, memberIds: number[], userId: number) {
    return this.db.session(async (conn) => {
      await conn.execute(
        `UPDATE sub_groups SET GroupName = @GroupName,
           fk_year_id = COALESCE(@YearId, fk_year_id),
           modified_by = @UserId, modified_date = NOW()
         WHERE pk_sub_group_id = @SubGroupId AND isdeleted = 0`,
        { GroupName: groupName, YearId: yearId > 0 ? yearId : null, UserId: userId, SubGroupId: subGroupId },
      );
      await conn.execute("UPDATE sub_group_members SET isdeleted = 1 WHERE fk_sub_group_id = @SubGroupId AND isdeleted = 0", { SubGroupId: subGroupId });
      for (const memberId of memberIds) {
        await conn.execute(
          `INSERT INTO sub_group_members (fk_sub_group_id, fk_member_master_profile_id, created_by, created_date)
           VALUES (@SubGroupId, @MemberId, @UserId, NOW())`,
          { SubGroupId: subGroupId, MemberId: memberId, UserId: userId },
        );
      }
      const row = await conn.queryFirstOrDefault(
        `SELECT sg.pk_sub_group_id AS Id, sg.fk_club_id AS ClubId, sg.fk_year_id AS YearId,
                y.YearLabel, sg.GroupName,
                COUNT(sgm.pk_sub_group_member_id) AS MemberCount
         FROM sub_groups sg
         INNER JOIN rotary_year_master y ON y.pk_year_id = sg.fk_year_id
         LEFT JOIN sub_group_members sgm ON sgm.fk_sub_group_id = sg.pk_sub_group_id AND sgm.isdeleted = 0
         WHERE sg.pk_sub_group_id = @SubGroupId AND sg.isdeleted = 0
         GROUP BY sg.pk_sub_group_id, sg.fk_club_id, sg.fk_year_id, y.YearLabel, sg.GroupName`,
        { SubGroupId: subGroupId },
      );
      if (!row) throw new InvalidOperationException("Sequence contains no elements");
      return SubGroupListDto.map(row);
    });
  }

  async deleteSubGroup(subGroupId: number, userId: number) {
    await this.db.session(async (conn) => {
      await conn.execute("UPDATE sub_groups SET isdeleted = 1, deleted_by = @UserId, deleted_date = NOW() WHERE pk_sub_group_id = @SubGroupId", { SubGroupId: subGroupId, UserId: userId });
      await conn.execute("UPDATE sub_group_members SET isdeleted = 1 WHERE fk_sub_group_id = @SubGroupId", { SubGroupId: subGroupId });
    });
  }

  async getSubGroupClubMembers(clubId: number) {
    return SubGroupMemberDto.mapAll(
      await this.db.query(
        `SELECT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId AS Email,
                m.PrimaryMobileNumber AS MobileNumber, ${MEMBER_PHOTO} AS ProfilePhotoPath
         FROM member_master_profile m
         INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
         WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
         ORDER BY m.MemberName`,
        { ClubId: clubId },
      ),
    );
  }

  async getSubGroupDistrictMembers(districtId: number) {
    return SubGroupMemberDto.mapAll(
      await this.db.query(
        `SELECT DISTINCT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId AS Email,
                m.PrimaryMobileNumber AS MobileNumber, ${MEMBER_PHOTO} AS ProfilePhotoPath,
                c.ClubName
         FROM member_master_profile m
         INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
         INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id
         WHERE c.fk_district_id = @DistrictId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
         ORDER BY c.ClubName, m.MemberName`,
        { DistrictId: districtId },
      ),
    );
  }

  async getSubGroupYears(clubId: number | null, districtId: number | null) {
    let sql = `SELECT DISTINCT ry.pk_year_id AS id, ry.YearLabel AS yearLabel
               FROM sub_groups sg
               INNER JOIN rotary_year_master ry ON ry.pk_year_id = sg.fk_year_id
               WHERE sg.isdeleted = 0`;
    if (clubId && clubId > 0) sql += " AND sg.fk_club_id = @ClubId";
    else if (districtId && districtId > 0) sql += " AND sg.fk_district_id = @DistrictId";
    return this.db.query(sql + " ORDER BY ry.YearLabel DESC", { ClubId: clubId, DistrictId: districtId });
  }

  // ---- weblinks ----

  private static weblinkColumns(alias: string) {
    return `${WEBLINK_FILE("LogoPath", alias)} AS LogoPath,
            ${WEBLINK_FILE("BannerPath", alias)} AS BannerPath,
            ${alias}LinkType, ${alias}LinkUrl,
            ${WEBLINK_FILE("PdfPath", alias)} AS PdfPath,
            ${alias}YoutubeUrl, ${alias}ButtonText,
            ${alias}SortOrder, ${alias}IsActive`;
  }

  async getWeblinks(clubId: number, parentId: number | null, districtId: number | null = null) {
    const owner = districtId !== null ? "w.fk_district_id = @OwnerId" : "w.fk_club_id = @OwnerId";
    const parent = parentId === null ? "w.fk_parent_id IS NULL" : "w.fk_parent_id = @ParentId";
    return WeblinkListDto.mapAll(
      await this.db.query(
        `SELECT w.pk_weblink_id AS Id, w.fk_club_id AS ClubId, w.fk_parent_id AS ParentId,
                w.Level, w.Title, w.Writeup,
                ${ClubGroupsService.weblinkColumns("w.")},
                (SELECT COUNT(*) FROM weblinks c WHERE c.fk_parent_id = w.pk_weblink_id AND c.isdeleted = 0) AS ChildCount
         FROM weblinks w
         WHERE ${owner} AND ${parent} AND w.isdeleted = 0
         ORDER BY w.SortOrder, w.pk_weblink_id`,
        { OwnerId: districtId ?? clubId, ParentId: parentId },
      ),
    );
  }

  /** Active weblinks as a tree; a child whose parent is missing or inactive becomes a root. */
  async getWeblinkTree(clubId: number, districtId: number | null = null) {
    const owner = districtId !== null ? "fk_district_id = @OwnerId" : "fk_club_id = @OwnerId";
    const all = WeblinkTreeDto.mapAll(
      await this.db.query(
        `SELECT pk_weblink_id AS Id, fk_parent_id AS ParentId, Level, Title, Writeup,
                ${ClubGroupsService.weblinkColumns("")}
         FROM weblinks
         WHERE ${owner} AND isdeleted = 0 AND IsActive = 1
         ORDER BY SortOrder, pk_weblink_id`,
        { OwnerId: districtId ?? clubId },
      ),
    );
    for (const w of all) w.children = all.filter((c) => c.parentId === w.id);
    const ids = new Set(all.map((w) => w.id));
    return all.filter((w) => w.parentId === null || w.parentId === 0 || !ids.has(w.parentId));
  }

  private saveWeblinkFile(ownerId: number, file: UploadedFile, prefix: string) {
    return saveWithReadableName(this.config, file, `${prefix}_`, "Documents", "Weblink", `Group${ownerId}`);
  }

  private async deleteWebFile(relativePath: string | null) {
    if (!relativePath) return;
    const full = join(webRootPath(this.config), ...relativePath.replace(/^\/+/, "").split("/"));
    if (existsSync(full)) await unlink(full);
  }

  private static fullPath(ownerId: number, name: string | null) {
    return !name ? null : name.startsWith("/") ? name : `/Documents/Weblink/Group${ownerId}/${name}`;
  }

  async createWeblink(
    clubId: number, dto: SaveWeblink, files: { logo?: UploadedFile; banner?: UploadedFile; pdf?: UploadedFile }, userId: number, districtId: number | null = null,
  ) {
    validateWeblinkUrls(dto.linkType, dto.linkUrl, dto.youtubeUrl);
    return this.db.session(async (conn) => {
      let level = 1;
      if (dto.parentId !== null) {
        const parentLevel = await conn.executeScalar<number>("SELECT Level FROM weblinks WHERE pk_weblink_id = @ParentId AND isdeleted = 0", { ParentId: dto.parentId });
        if (parentLevel === null || parentLevel === undefined) throw new KeyNotFoundException("Parent weblink not found.");
        level = Number(parentLevel) + 1;
        if (level > 3) throw new InvalidOperationException("Maximum nesting level is 3.");
      }
      const ownerId = districtId ?? clubId;
      const logoPath = files.logo ? await this.saveWeblinkFile(ownerId, files.logo, "logo") : null;
      const bannerPath = files.banner && level === 1 ? await this.saveWeblinkFile(ownerId, files.banner, "banner") : null;
      const pdfPath = files.pdf && dto.linkType === "PDF" ? await this.saveWeblinkFile(ownerId, files.pdf, "pdf") : null;
      const id = Number(
        await conn.executeScalar(
          `INSERT INTO weblinks (fk_club_id, fk_district_id, fk_parent_id, Level, Title, Writeup, LogoPath, BannerPath,
                  LinkType, LinkUrl, PdfPath, YoutubeUrl, ButtonText, SortOrder, IsActive,
                  created_by, created_date, isdeleted)
           VALUES (@ClubId, @DistrictId, @ParentId, @Level, @Title, @Writeup, @LogoPath, @BannerPath,
                  @LinkType, @LinkUrl, @PdfPath, @YoutubeUrl, @ButtonText, @SortOrder, 1,
                  @UserId, NOW(), 0);
           SELECT LAST_INSERT_ID();`,
          {
            ClubId: districtId !== null ? 0 : clubId, DistrictId: districtId, ParentId: dto.parentId, Level: level, Title: dto.title, Writeup: dto.writeup,
            LogoPath: logoPath, BannerPath: bannerPath, LinkType: dto.linkType, LinkUrl: dto.linkUrl, PdfPath: pdfPath, YoutubeUrl: dto.youtubeUrl,
            ButtonText: dto.buttonText, SortOrder: dto.sortOrder, UserId: userId,
          },
        ),
      );
      return WeblinkListDto.create({
        Id: id, ClubId: districtId !== null ? 0 : clubId, ParentId: dto.parentId, Level: level, Title: dto.title, Writeup: dto.writeup,
        LogoPath: ClubGroupsService.fullPath(ownerId, logoPath), BannerPath: ClubGroupsService.fullPath(ownerId, bannerPath), LinkType: dto.linkType,
        LinkUrl: dto.linkUrl, PdfPath: ClubGroupsService.fullPath(ownerId, pdfPath), YoutubeUrl: dto.youtubeUrl, ButtonText: dto.buttonText,
        SortOrder: dto.sortOrder, IsActive: true, ChildCount: 0,
      });
    });
  }

  async updateWeblink(
    clubId: number, weblinkId: number, dto: SaveWeblink, files: { logo?: UploadedFile; banner?: UploadedFile; pdf?: UploadedFile }, userId: number,
    districtId: number | null = null,
  ) {
    validateWeblinkUrls(dto.linkType, dto.linkUrl, dto.youtubeUrl);
    const owner = districtId !== null ? "fk_district_id = @OwnerId" : "fk_club_id = @OwnerId";
    return this.db.session(async (conn) => {
      const existing = await conn.queryFirstOrDefault(
        `SELECT pk_weblink_id, fk_club_id, fk_parent_id, Level,
                LogoPath AS LogoPathRaw, BannerPath AS BannerPathRaw, PdfPath AS PdfPathRaw,
                ${WEBLINK_FILE("LogoPath")} AS LogoPathFull,
                ${WEBLINK_FILE("BannerPath")} AS BannerPathFull,
                ${WEBLINK_FILE("PdfPath")} AS PdfPathFull
         FROM weblinks WHERE pk_weblink_id = @Id AND ${owner} AND isdeleted = 0`,
        { Id: weblinkId, OwnerId: districtId ?? clubId },
      );
      if (!existing) throw new KeyNotFoundException("Weblink not found.");
      let logoPath = existing.LogoPathRaw as string | null;
      let bannerPath = existing.BannerPathRaw as string | null;
      let pdfPath = existing.PdfPathRaw as string | null;
      const level = Number(existing.Level);
      const ownerId = districtId ?? clubId;
      if (files.logo) {
        await this.deleteWebFile(existing.LogoPathFull as string | null);
        logoPath = await this.saveWeblinkFile(ownerId, files.logo, "logo");
      }
      if (files.banner && level === 1) {
        await this.deleteWebFile(existing.BannerPathFull as string | null);
        bannerPath = await this.saveWeblinkFile(ownerId, files.banner, "banner");
      }
      if (files.pdf && dto.linkType === "PDF") {
        await this.deleteWebFile(existing.PdfPathFull as string | null);
        pdfPath = await this.saveWeblinkFile(ownerId, files.pdf, "pdf");
      }
      if (dto.linkType !== "PDF" && pdfPath !== null) {
        await this.deleteWebFile(existing.PdfPathFull as string | null);
        pdfPath = null;
      }
      await conn.execute(
        `UPDATE weblinks
         SET Title = @Title, Writeup = @Writeup, LogoPath = @LogoPath, BannerPath = @BannerPath,
             LinkType = @LinkType, LinkUrl = @LinkUrl, PdfPath = @PdfPath, YoutubeUrl = @YoutubeUrl,
             ButtonText = @ButtonText, SortOrder = @SortOrder, IsActive = @IsActive,
             modified_by = @UserId, modified_date = NOW()
         WHERE pk_weblink_id = @Id AND isdeleted = 0`,
        {
          Id: weblinkId, Title: dto.title, Writeup: dto.writeup, LogoPath: logoPath, BannerPath: bannerPath, LinkType: dto.linkType, LinkUrl: dto.linkUrl,
          PdfPath: pdfPath, YoutubeUrl: dto.youtubeUrl, ButtonText: dto.buttonText, SortOrder: dto.sortOrder, IsActive: dto.isActive ? 1 : 0, UserId: userId,
        },
      );
      const childCount = Number(await conn.executeScalar("SELECT COUNT(*) FROM weblinks WHERE fk_parent_id = @Id AND isdeleted = 0", { Id: weblinkId }));
      return WeblinkListDto.create({
        Id: weblinkId, ClubId: districtId !== null ? 0 : clubId, ParentId: existing.fk_parent_id ?? null, Level: level, Title: dto.title, Writeup: dto.writeup,
        LogoPath: ClubGroupsService.fullPath(ownerId, logoPath), BannerPath: ClubGroupsService.fullPath(ownerId, bannerPath), LinkType: dto.linkType,
        LinkUrl: dto.linkUrl, PdfPath: ClubGroupsService.fullPath(ownerId, pdfPath), YoutubeUrl: dto.youtubeUrl, ButtonText: dto.buttonText,
        SortOrder: dto.sortOrder, IsActive: dto.isActive, ChildCount: childCount,
      });
    });
  }

  /** Deletes the weblink with its children and grandchildren. */
  async deleteWeblink(weblinkId: number, userId: number) {
    await this.db.session(async (conn) => {
      const childIds = (await conn.query("SELECT pk_weblink_id AS id FROM weblinks WHERE fk_parent_id = @Id AND isdeleted = 0", { Id: weblinkId })).map((r) => Number(r.id));
      if (childIds.length) {
        await conn.execute(
          "UPDATE weblinks SET isdeleted = 1, deleted_by = @UserId, deleted_date = NOW() WHERE fk_parent_id IN @ChildIds AND isdeleted = 0",
          { ChildIds: childIds, UserId: userId },
        );
      }
      await conn.execute(
        "UPDATE weblinks SET isdeleted = 1, deleted_by = @UserId, deleted_date = NOW() WHERE (pk_weblink_id = @Id OR fk_parent_id = @Id) AND isdeleted = 0",
        { Id: weblinkId, UserId: userId },
      );
    });
  }

  async toggleWeblinkActive(weblinkId: number, userId: number) {
    await this.db.execute("UPDATE weblinks SET IsActive = NOT IsActive, modified_by = @UserId, modified_date = NOW() WHERE pk_weblink_id = @Id AND isdeleted = 0", { Id: weblinkId, UserId: userId });
  }

  // ---- attendance ----

  async getAttendance(clubId: number, yearId: number, search: string, page: number, pageSize: number) {
    const params = { ClubId: clubId, YearId: yearId, Search: `%${search ?? ""}%`, PageSize: pageSize, Offset: (page - 1) * pageSize };
    const [rows, count] = await this.db.queryMultiple(
      `SELECT
           a.pk_attendance_id AS Id,
           a.fk_club_id AS ClubId,
           a.fk_year_id AS YearId,
           a.EventName,
           a.EventDateTime,
           (SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) AS MembersCount,
           (SELECT COUNT(*) FROM club_attendance_anns n WHERE n.fk_attendance_id = a.pk_attendance_id) AS AnnsCount,
           (SELECT COUNT(*) FROM club_attendance_annets t WHERE t.fk_attendance_id = a.pk_attendance_id) AS AnnetsCount,
           (SELECT COUNT(*) FROM club_attendance_visitors v WHERE v.fk_attendance_id = a.pk_attendance_id) AS VisitorsCount,
           (SELECT COUNT(*) FROM club_attendance_rotarians r WHERE r.fk_attendance_id = a.pk_attendance_id) AS RotariansCount,
           (SELECT COUNT(*) FROM club_attendance_delegates d WHERE d.fk_attendance_id = a.pk_attendance_id) AS DelegatesCount
       FROM club_attendance a
       WHERE a.fk_club_id = @ClubId
         AND a.isdeleted = 0
         AND (@YearId = 0 OR a.fk_year_id = @YearId)
         AND (@Search = '%%' OR a.EventName LIKE @Search)
       ORDER BY a.EventDateTime DESC
       LIMIT @PageSize OFFSET @Offset;
       SELECT COUNT(*)
       FROM club_attendance a
       WHERE a.fk_club_id = @ClubId
         AND a.isdeleted = 0
         AND (@YearId = 0 OR a.fk_year_id = @YearId)
         AND (@Search = '%%' OR a.EventName LIKE @Search);`,
      params,
    );
    return { items: AttendanceListDto.mapAll(rows), totalCount: Number(Object.values(count[0] ?? {})[0] ?? 0) };
  }

  async getAttendanceById(id: number) {
    return this.db.session(async (conn) => {
      const detail = AttendanceDetailDto.map(
        await conn.queryFirstOrDefault(
          `SELECT pk_attendance_id AS Id, fk_club_id AS ClubId, fk_year_id AS YearId, EventName, Description, EventDateTime
           FROM club_attendance
           WHERE pk_attendance_id = @Id AND isdeleted = 0`,
          { Id: id },
        ),
      );
      if (!detail) return null;
      const rows = (sql: string) => conn.query(sql, { Id: id }).then((r) => r.map((x) => camel(x)));
      detail.members = await rows(
        `SELECT am.pk_id AS Id, am.fk_member_id AS MemberId, m.MemberName
         FROM club_attendance_members am
         INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = am.fk_member_id
         WHERE am.fk_attendance_id = @Id`,
      );
      detail.anns = await rows("SELECT pk_id AS Id, AnnName FROM club_attendance_anns WHERE fk_attendance_id = @Id");
      detail.annets = await rows("SELECT pk_id AS Id, AnnetName FROM club_attendance_annets WHERE fk_attendance_id = @Id");
      detail.visitors = await rows("SELECT pk_id AS Id, VisitorName, InvitedBy FROM club_attendance_visitors WHERE fk_attendance_id = @Id");
      detail.rotarians = await rows("SELECT pk_id AS Id, RotarianName, ClubName FROM club_attendance_rotarians WHERE fk_attendance_id = @Id");
      detail.delegates = await rows("SELECT pk_id AS Id, RotarianName, DistrictDesignation, ClubName FROM club_attendance_delegates WHERE fk_attendance_id = @Id");
      return detail;
    });
  }

  private static async insertAttendanceRows(conn: DbCommands, attendanceId: number, dto: SaveAttendance) {
    const ids = Array.isArray(dto.memberIds) ? dto.memberIds.map(Number).filter(Number.isFinite) : [];
    for (const memberId of ids) {
      await conn.execute("INSERT INTO club_attendance_members (fk_attendance_id, fk_member_id) VALUES (@AttendanceId, @MemberId)", { AttendanceId: attendanceId, MemberId: memberId });
    }
    for (const a of objects(dto.anns)) {
      await conn.execute("INSERT INTO club_attendance_anns (fk_attendance_id, AnnName) VALUES (@AttendanceId, @AnnName)", { AttendanceId: attendanceId, AnnName: field(a, "AnnName") ?? "" });
    }
    for (const a of objects(dto.annets)) {
      await conn.execute("INSERT INTO club_attendance_annets (fk_attendance_id, AnnetName) VALUES (@AttendanceId, @AnnetName)", { AttendanceId: attendanceId, AnnetName: field(a, "AnnetName") ?? "" });
    }
    for (const v of objects(dto.visitors)) {
      await conn.execute(
        "INSERT INTO club_attendance_visitors (fk_attendance_id, VisitorName, InvitedBy) VALUES (@AttendanceId, @VisitorName, @InvitedBy)",
        { AttendanceId: attendanceId, VisitorName: field(v, "VisitorName") ?? "", InvitedBy: field(v, "InvitedBy") },
      );
    }
    for (const r of objects(dto.rotarians)) {
      await conn.execute(
        "INSERT INTO club_attendance_rotarians (fk_attendance_id, RotarianName, ClubName) VALUES (@AttendanceId, @RotarianName, @ClubName)",
        { AttendanceId: attendanceId, RotarianName: field(r, "RotarianName") ?? "", ClubName: field(r, "ClubName") },
      );
    }
    for (const d of objects(dto.delegates)) {
      await conn.execute(
        "INSERT INTO club_attendance_delegates (fk_attendance_id, RotarianName, DistrictDesignation, ClubName) VALUES (@AttendanceId, @RotarianName, @DistrictDesignation, @ClubName)",
        { AttendanceId: attendanceId, RotarianName: field(d, "RotarianName") ?? "", DistrictDesignation: field(d, "DistrictDesignation"), ClubName: field(d, "ClubName") },
      );
    }
  }

  async createAttendance(clubId: number, dto: SaveAttendance, createdBy: number): Promise<number> {
    const eventDateTime = dbDateTime(dto.eventDateTime) ?? "0001-01-01 00:00:00";
    const id = await this.db.session(async (conn) => {
      const yearId = await ensureRotaryYear(conn, eventDateTime);
      return conn.transaction(async (tx) => {
        const attendanceId = Number(
          await tx.executeScalar(
            `INSERT INTO club_attendance (fk_club_id, fk_year_id, EventName, Description, EventDateTime, created_by, created_date)
             VALUES (@ClubId, @YearId, @EventName, @Description, @EventDateTime, @CreatedBy, NOW());
             SELECT LAST_INSERT_ID();`,
            { ClubId: clubId, YearId: yearId, EventName: dto.eventName, Description: dto.description, EventDateTime: eventDateTime, CreatedBy: createdBy },
          ),
        );
        await ClubGroupsService.insertAttendanceRows(tx, attendanceId, dto);
        return attendanceId;
      });
    });
    this.citation.triggerForClub(clubId);
    return id;
  }

  async updateAttendance(id: number, dto: SaveAttendance, modifiedBy: number) {
    await this.db.transaction(async (tx) => {
      await tx.execute(
        `UPDATE club_attendance SET
             EventName = @EventName, Description = @Description, EventDateTime = @EventDateTime,
             modified_by = @ModifiedBy, modified_date = NOW()
         WHERE pk_attendance_id = @Id AND isdeleted = 0`,
        { Id: id, EventName: dto.eventName, Description: dto.description, EventDateTime: dbDateTime(dto.eventDateTime) ?? "0001-01-01 00:00:00", ModifiedBy: modifiedBy },
      );
      for (const t of ["members", "anns", "annets", "visitors", "rotarians", "delegates"]) {
        await tx.execute(`DELETE FROM club_attendance_${t} WHERE fk_attendance_id = @Id`, { Id: id });
      }
      await ClubGroupsService.insertAttendanceRows(tx, id, dto);
    });
  }

  async deleteAttendance(id: number, deletedBy: number) {
    const clubFk = Number((await this.db.executeScalar("SELECT fk_club_id FROM club_attendance WHERE pk_attendance_id = @Id", { Id: id })) ?? 0);
    await this.db.execute("UPDATE club_attendance SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW() WHERE pk_attendance_id = @Id", { Id: id, DeletedBy: deletedBy });
    if (clubFk > 0) this.citation.triggerForClub(clubFk);
  }

  async getAttendanceYears(clubId: number) {
    return this.db.query(
      `SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
       FROM rotary_year_master y
       INNER JOIN club_attendance a ON a.fk_year_id = y.pk_year_id
       WHERE a.fk_club_id = @ClubId
         AND a.isdeleted = 0
       UNION
       SELECT y2.pk_year_id AS id, y2.YearLabel AS yearLabel, y2.IsCurrent AS isCurrent
       FROM rotary_year_master y2
       WHERE y2.IsCurrent = 1
       ORDER BY id DESC`,
      { ClubId: clubId },
    );
  }

  /** Active, non-honorary members (attendance is taken for regular members). */
  async getAttendanceMembers(clubId: number) {
    return (
      await this.db.query(
        `SELECT m.pk_member_master_profile_id AS Id, m.MemberName
         FROM member_master_profile m
         INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
         WHERE cm.fk_club_id = @ClubId
           AND m.isdeleted = 0
           AND cm.isdeleted = 0
           AND cm.IsActive = 1
           AND cm.IsHonoraryMember = 0
         ORDER BY m.MemberName`,
        { ClubId: clubId },
      )
    ).map((r) => ({ id: Number(r.Id), memberName: (r.MemberName as string | null) ?? "" }));
  }
}

/** A row with PascalCase aliases -> camelCase keys (System.Text.Json web defaults). */
function camel(row: Record<string, unknown>): DtoObject {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k[0].toLowerCase() + k.slice(1), v]));
}
