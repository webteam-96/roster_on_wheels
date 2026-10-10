import { Injectable } from "@nestjs/common";
import { formatDate } from "../../common/dotnet-format";
import { pagedResult } from "../../common/paged";
import { Db, type DbCommands } from "../../database/db.service";
import { buildScopes } from "../../services/member-scopes.helper";
import { OcvLiveVisibility } from "../../services/ocv-live-visibility";
import { YearTableResolver, type YearTableInfo } from "../../services/year-table.resolver";

const GREETING_LOOKBACK_DAYS = 30;
const BODY_MAX_CHARS = 300;
const ALL_TYPES = ["greeting", "project", "announcement", "event", "newsletter", "document"];
const COL_NAMES = ["Type", "Id", "YearId", "ClubId", "DistrictId", "ScopeKind", "Title", "Body", "ImageUrl", "LinkUrl", "SortAt", "DeepLinkType", "Extra"];

interface Leg { cols: string[]; fromWhere: string; isAggregate?: boolean }
interface RiTarget { zones: string; districts: string; subgroups: string }

/** Every leg exposes the same column names (a derived table takes them from the first leg only). */
function select(leg: Leg) {
  if (leg.cols.length !== COL_NAMES.length) throw new Error(`Feed leg has ${leg.cols.length} columns, expected ${COL_NAMES.length}.`);
  return leg.cols.map((c, i) => `${c} AS ${COL_NAMES[i]}`).join(",\n");
}
/** Year tables carry mixed collations; normalise every string column for the UNION. */
const Str = (e: string) => `CONVERT(${e} USING utf8mb4) COLLATE utf8mb4_general_ci`;
const scopeKind = (a: string) => `CASE WHEN IFNULL(${a}.Scope, '') = 'ri' THEN 'ri' WHEN ${a}.fk_club_id > 0 THEN 'club' ELSE 'district' END`;
const mediaPath = (a: string, col: string, folder: string) => `
        CASE WHEN ${a}.${col} IS NULL OR ${a}.${col} = '' THEN NULL
             WHEN ${a}.${col} LIKE '/%' THEN ${a}.${col}
             WHEN IFNULL(${a}.Scope, '') = 'ri' THEN CONCAT('/Documents/${folder}/ri/', ${a}.${col})
             WHEN ${a}.fk_district_id IS NOT NULL AND ${a}.fk_district_id > 0 THEN CONCAT('/Documents/${folder}/Group', ${a}.fk_district_id, '/', ${a}.${col})
             ELSE CONCAT('/Documents/${folder}/Group', ${a}.fk_club_id, '/', ${a}.${col}) END`;

/** Club / district / RI arms are mutually exclusive, so no row counts twice. RI with no target = everyone. */
function scopeWhere(a: string, hasClubs: boolean, hasDistricts: boolean, ri: RiTarget, hasSubgroupColumn: boolean) {
  const arms: string[] = [];
  if (hasClubs) arms.push(`(IFNULL(${a}.Scope, '') <> 'ri' AND ${a}.fk_club_id > 0 AND ${a}.fk_club_id IN @ClubIds)`);
  if (hasDistricts) arms.push(`(IFNULL(${a}.Scope, '') <> 'ri' AND (${a}.fk_club_id = 0 OR ${a}.fk_club_id IS NULL) AND ${a}.fk_district_id IN @DistrictIds)`);
  const riArms = [`IFNULL(NULLIF(${a}.RecipientTarget, ''), 'all') = 'all'`];
  if (ri.zones) riArms.push(`(${a}.RecipientTarget = 'zones' AND ${ri.zones.replace(/\{0\}/g, a)})`);
  if (ri.districts) riArms.push(`(${a}.RecipientTarget = 'districts' AND ${ri.districts.replace(/\{0\}/g, a)})`);
  if (hasSubgroupColumn && ri.subgroups) riArms.push(`(${a}.RecipientTarget = 'subgroups' AND ${ri.subgroups.replace(/\{0\}/g, a)})`);
  arms.push(`(IFNULL(${a}.Scope, '') = 'ri' AND (${riArms.join(" OR ")}))`);
  return `(${arms.join(" OR ")})`;
}

/** This year's (or last year's, if not yet come round) instance of a month/day at 08:00. */
const occExpr = (col: string) => `
        CASE WHEN DATE_FORMAT(m.${col}, '%m-%d') <= DATE_FORMAT(CURDATE(), '%m-%d')
             THEN STR_TO_DATE(CONCAT(YEAR(CURDATE()),     '-', DATE_FORMAT(m.${col}, '%m-%d'), ' 08:00:00'), '%Y-%m-%d %H:%i:%s')
             ELSE STR_TO_DATE(CONCAT(YEAR(CURDATE()) - 1, '-', DATE_FORMAT(m.${col}, '%m-%d'), ' 08:00:00'), '%Y-%m-%d %H:%i:%s') END`;
const PROFILE_PHOTO = `
        CASE WHEN IFNULL(m.ProfilePhotoPath, '') = '' THEN NULL
             WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
             ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1)) END`;

const announcementLeg = (c: boolean, d: boolean, ri: RiTarget): Leg => ({
  cols: [Str("'announcement'"), "a.pk_announcement_id", "0", "a.fk_club_id", "a.fk_district_id", Str(scopeKind("a")), Str("a.Title"), Str("a.Description"),
    Str(mediaPath("a", "ImagePath", "announcement")), Str("NULL"), "a.PublishDateTime", Str("'club_announcement'"), Str("NULL")],
  fromWhere: `
            FROM announcements a
            WHERE a.isdeleted = 0
              AND a.PublishDateTime >= @From AND a.PublishDateTime <= NOW()
              AND (a.ExpiryDateTime IS NULL OR a.ExpiryDateTime >= NOW())
              AND ${scopeWhere("a", c, d, ri, true)}`,
});
const eventLeg = (c: boolean, d: boolean, ri: RiTarget): Leg => ({
  cols: [Str("'event'"), "e.pk_upcoming_event_id", "0", "e.fk_club_id", "e.fk_district_id", Str(scopeKind("e")), Str("e.Title"), Str("e.Description"),
    Str(mediaPath("e", "ImagePath", "Event")), Str("e.RegistrationLink"), "e.PublishDate", Str("'club_upcoming_event'"), Str("DATE_FORMAT(e.EventDate, '%Y-%m-%dT%H:%i:%s')")],
  fromWhere: `
            FROM upcoming_events e
            WHERE e.isdeleted = 0 AND e.PublishDate >= @From
              AND ${OcvLiveVisibility.upcomingEvents("e")}
              AND ${scopeWhere("e", c, d, ri, true)}`,
});
const newsletterLeg = (c: boolean, d: boolean, ri: RiTarget): Leg => ({
  cols: [Str("'newsletter'"), "n.pk_newsletter_id", "IFNULL(n.fk_year_id, 0)", "n.fk_club_id", "n.fk_district_id", Str(scopeKind("n")), Str("n.Title"), Str("NULL"), Str("NULL"),
    Str(`CASE WHEN n.AttachmentType = 'link' AND IFNULL(n.LinkUrl, '') <> '' THEN n.LinkUrl
                        WHEN IFNULL(n.FilePath, '') = '' THEN n.LinkUrl
                        ELSE ${mediaPath("n", "FilePath", "ebulletin")} END`),
    "n.PublishDateTime", Str("'club_newsletter'"), Str("n.AttachmentType")],
  fromWhere: `
            FROM newsletters n
            WHERE n.isdeleted = 0 AND n.PublishDateTime >= @From
              AND ${OcvLiveVisibility.newsletters("n")}
              AND ${scopeWhere("n", c, d, ri, true)}`,
});
const documentLeg = (c: boolean, d: boolean, ri: RiTarget): Leg => ({
  cols: [Str("'document'"), "d.pk_document_id", "0", "d.fk_club_id", "d.fk_district_id", Str(scopeKind("d")), Str("d.Title"), Str("d.OriginalFileName"), Str("NULL"),
    Str(mediaPath("d", "FilePath", "documentsafe")), "d.PublishDateTime", Str("'document'"), Str("d.AccessType")],
  // club_documents has no RecipientSubgroupIds column.
  fromWhere: `
            FROM club_documents d
            WHERE d.isdeleted = 0 AND d.PublishDateTime >= @From
              AND ${OcvLiveVisibility.clubDocuments("d")}
              AND ${scopeWhere("d", c, d, ri, false)}`,
});
/** Club and district scopes are separate legs so MySQL keeps using the club index. */
const projectLeg = (t: YearTableInfo, districtScoped: boolean): Leg => ({
  cols: [Str("'project'"), "p.pk_project_id", String(t.yearId), "p.fk_club_id", "p.fk_district_id", Str(districtScoped ? "'district'" : "'club'"), Str("p.title"), Str("p.description"),
    Str("NULL"), Str("NULL"), "COALESCE(p.created_date, p.project_date)", Str("CONCAT('club_project_', COALESCE(NULLIF(mm.ModuleKey, ''), 'community_service'))"), Str("mm.ModuleName")],
  fromWhere: `
            FROM \`${t.projectsTable}\` p
            LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
            WHERE ${districtScoped ? "p.fk_club_id = 0 AND p.fk_district_id IN @DistrictIds" : "p.fk_club_id IN @ClubIds"}
              AND p.isdeleted = 0 AND p.is_active = 1
              AND (COALESCE(p.approval_status, '') = '' OR p.approval_status = 'Approved')
              AND COALESCE(p.created_date, p.project_date) >= @From`,
});
const celebrants = () => {
  const leg = (col: string, flag: string, isB: number, isA: number) => `
            SELECT cm.fk_club_id AS ClubId, c.fk_district_id AS DistrictId, ${occExpr(col)} AS Occ, ${isB} AS IsB, ${isA} AS IsA,
                   ${Str("m.MemberName")} AS MemberName, ${Str(PROFILE_PHOTO)} AS Photo
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0 AND c.${flag} = 1
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id IN @ClubIds AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND m.${col} IS NOT NULL AND ${occExpr(col)} >= @GreetFrom`;
  return `${leg("BirthDate", "IsEnableBirthdayNotification", 1, 0)}\nUNION ALL\n${leg("AnniversaryDate", "IsEnableAnniversaryNotification", 0, 1)}`;
};
/** One row per (club × day), mirroring the single digest push. */
const greetingDigestLeg = (): Leg => ({
  cols: [Str("'greeting'"), "g.ClubId", "0", "g.ClubId", "g.DistrictId", Str("'club'"), "GROUP_CONCAT(DISTINCT g.MemberName ORDER BY g.MemberName SEPARATOR ', ')", Str("NULL"),
    "NULLIF(SUBSTRING_INDEX(GROUP_CONCAT(g.Photo SEPARATOR '||'), '||', 1), '')", Str("NULL"), "g.Occ", Str("'celebrations_digest'"), "CONCAT(SUM(g.IsB), '/', SUM(g.IsA))"],
  fromWhere: `FROM (\n${celebrants()}\n) g GROUP BY g.ClubId, g.DistrictId, g.Occ`,
  isAggregate: true,
});
const selfGreetingLeg = (col: string, occasion: string, flag: string): Leg => ({
  cols: [Str("'greeting'"), "m.pk_member_master_profile_id", "0", "cm.fk_club_id", "c.fk_district_id", Str("'club'"), Str("m.MemberName"), Str("NULL"), Str(PROFILE_PHOTO),
    Str("NULL"), occExpr(col), Str("'celebrations_digest'"), Str(`'self_${occasion}'`)],
  fromWhere: `
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0 AND c.${flag} = 1
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_member_master_profile_id = @MemberId
              AND cm.fk_club_id IN @ClubIds AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND m.${col} IS NOT NULL AND ${occExpr(col)} >= @GreetFrom`,
});

export function parseTypes(types: string | null): Set<string> {
  if (!types || !types.trim()) return new Set(ALL_TYPES);
  return new Set(types.split(",").map((t) => t.trim().toLowerCase()).filter((t) => ALL_TYPES.includes(t)));
}
export function parseCelebrationCounts(extra: string | null): [number, number] {
  const parts = (extra ?? "").split("/");
  if (!extra || !extra.trim() || parts.length !== 2) return [0, 0];
  const p = (s: string) => (Number.isFinite(parseFloat(s)) ? Math.trunc(parseFloat(s)) : 0);
  return [p(parts[0]), p(parts[1])];
}
export const trimBody = (s: string | null | undefined) => {
  if (!s || !s.trim()) return null;
  const t = s.trim();
  return t.length <= BODY_MAX_CHARS ? t : t.slice(0, BODY_MAX_CHARS) + "…";
};
const startYear = (label: string) => { const head = label.split("-")[0]; return head.length === 4 && /^\d+$/.test(head) ? Number(head) : null; };

/**
 * Port of MobileNotificationFeedService.cs: the bell feed is recomputed from the source tables
 * (push logs are pruned after 5 days), scoped to what the member may see, one UNION ALL paged across sources.
 */
@Injectable()
export class MobileNotificationFeedService {
  constructor(private readonly db: Db, private readonly years: YearTableResolver) {}

  async getFeed(memberId: number, page: number, pageSize: number, days: number, types: string | null) {
    if (page < 1) page = 1;
    if (pageSize < 1) pageSize = 20;
    if (pageSize > 100) pageSize = 100;
    if (days < 1) days = 90;
    if (days > 365) days = 365;
    const empty = pagedResult([], 0, page, pageSize);
    if (memberId <= 0) return empty;
    const wanted = parseTypes(types);
    if (wanted.size === 0) return empty;

    return this.db.session(async (conn) => {
      const scopes = await buildScopes(conn, memberId, true);
      const get = (o: Record<string, unknown>, k: string) => o[k] ?? o[k[0].toUpperCase() + k.slice(1)];
      const clubNames = new Map(scopes.clubs.map((c) => [Number(get(c, "id")), String(get(c, "name") ?? "")]));
      const districtNumbers = new Map(scopes.districts.map((d) => [Number(get(d, "id")), String(get(d, "number") ?? "")]));
      const { clubIds, districtIds, zoneIds } = await this.filterActiveScope(conn, [...clubNames.keys()], [...districtNumbers.keys()]);
      if (clubIds.length === 0 && districtIds.length === 0) return empty;

      const subgroupIds = (await conn.query(
        `SELECT DISTINCT sm.fk_sub_group_id AS Id FROM sub_group_members sm
         JOIN sub_groups sg ON sg.pk_sub_group_id = sm.fk_sub_group_id AND sg.Scope = 'ri' AND sg.isdeleted = 0
         WHERE sm.fk_member_master_profile_id = @MemberId AND sm.isdeleted = 0`,
        { MemberId: memberId },
      )).map((r) => Number(r.Id));
      // The member's own module toggles (mobile Settings); default on.
      const prefs = (await conn.queryFirstOrDefault(
        `SELECT CAST(NotifyUpcomingEvents AS UNSIGNED) AS NotifyEvents, CAST(NotifyAnnouncements AS UNSIGNED) AS NotifyAnnouncements,
                CAST(NotifyNewsletters AS UNSIGNED) AS NotifyNewsletters, CAST(NotifyDocuments AS UNSIGNED) AS NotifyDocuments
         FROM member_master_profile WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 0`,
        { MemberId: memberId },
      )) ?? {};
      const on = (k: string) => prefs[k] === undefined || prefs[k] === null || Number(prefs[k]) !== 0;
      const yearTables = await this.yearTables(conn);

      const now = Date.now();
      const p: Record<string, unknown> = {
        MemberId: memberId, Take: pageSize, Skip: (page - 1) * pageSize,
        From: new Date(now - days * 86_400_000).toISOString().slice(0, 19).replace("T", " "),
        GreetFrom: new Date(now - Math.min(days, GREETING_LOOKBACK_DAYS) * 86_400_000).toISOString().slice(0, 10),
      };
      if (clubIds.length) p.ClubIds = clubIds;
      if (districtIds.length) p.DistrictIds = districtIds;
      // Recipient id columns are comma-separated text: one FIND_IN_SET term per id the member holds.
      const terms = (col: string, ids: number[], prefix: string) => {
        if (ids.length === 0) return "";
        return "(" + ids.map((id, i) => { p[`${prefix}${i}`] = id; return `FIND_IN_SET(@${prefix}${i}, REPLACE(IFNULL({0}.${col}, ''), ' ', '')) > 0`; }).join(" OR ") + ")";
      };
      const ri: RiTarget = { zones: terms("RecipientZoneIds", zoneIds, "riz"), districts: terms("RecipientDistrictIds", districtIds, "rid"), subgroups: terms("RecipientSubgroupIds", subgroupIds, "rig") };

      const hasC = clubIds.length > 0, hasD = districtIds.length > 0;
      const legs: Leg[] = [];
      if (wanted.has("announcement") && on("NotifyAnnouncements")) legs.push(announcementLeg(hasC, hasD, ri));
      if (wanted.has("event") && on("NotifyEvents")) legs.push(eventLeg(hasC, hasD, ri));
      if (wanted.has("newsletter") && on("NotifyNewsletters")) legs.push(newsletterLeg(hasC, hasD, ri));
      if (wanted.has("document") && on("NotifyDocuments")) legs.push(documentLeg(hasC, hasD, ri));
      if (wanted.has("project"))
        for (const t of yearTables) {
          if (hasC) legs.push(projectLeg(t, false));
          if (hasD) legs.push(projectLeg(t, true));
        }
      if (wanted.has("greeting") && hasC) legs.push(greetingDigestLeg(), selfGreetingLeg("BirthDate", "Birthday", "IsEnableBirthdayNotification"), selfGreetingLeg("AnniversaryDate", "Anniversary", "IsEnableAnniversaryNotification"));
      if (legs.length === 0) return empty;

      const countSql = "SELECT " + legs.map((l) => (l.isAggregate ? `(SELECT COUNT(*) FROM (SELECT 1 AS x ${l.fromWhere}) agg)` : `(SELECT COUNT(*) ${l.fromWhere})`)).join(" + ") + " AS Total";
      const pageSql = "SELECT * FROM (\n" + legs.map((l) => `SELECT ${select(l)} ${l.fromWhere}`).join("\nUNION ALL\n") + "\n) u ORDER BY u.SortAt DESC, u.Type, u.Id DESC LIMIT @Take OFFSET @Skip";
      const total = Number((await conn.queryFirstOrDefault(countSql, p))?.Total ?? 0);
      const rows = await conn.query(pageSql, p);
      const photos = await this.projectPhotos(conn, rows, yearTables);
      return pagedResult(rows.map((r) => toDto(r, clubNames, districtNumbers, photos)), total, page, pageSize);
    });
  }

  /** Clubs/districts whose whole club→district→zone chain is active, with their zones. */
  private async filterActiveScope(conn: DbCommands, clubIds: number[], districtIds: number[]) {
    const clubs: number[] = [];
    const districts = new Set<number>(), zones = new Set<number>();
    if (clubIds.length)
      for (const r of await conn.query(
        `SELECT c.pk_club_id AS ClubId, d.pk_district_id AS DistrictId, d.fk_zone_id AS ZoneId FROM club_master c
         JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
         JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1
         WHERE c.pk_club_id IN @Ids AND c.isdeleted = 0 AND c.IsActive = 1`, { Ids: clubIds })) {
        clubs.push(Number(r.ClubId)); districts.add(Number(r.DistrictId)); zones.add(Number(r.ZoneId));
      }
    if (districtIds.length)
      for (const r of await conn.query(
        `SELECT d.pk_district_id AS DistrictId, d.fk_zone_id AS ZoneId FROM district_master d
         JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1
         WHERE d.pk_district_id IN @Ids AND d.isdeleted = 0 AND d.IsActive = 1`, { Ids: districtIds })) {
        districts.add(Number(r.DistrictId)); zones.add(Number(r.ZoneId));
      }
    return { clubIds: [...new Set(clubs)], districtIds: [...districts], zoneIds: [...zones] };
  }

  /** Current and previous Rotary year only (a project older than that is not a notification). */
  private async yearTables(conn: DbCommands): Promise<YearTableInfo[]> {
    const all = await this.years.getAllExistingYearTables(conn);
    if (all.length === 0) return all;
    const currentYearId = await conn.executeScalar("SELECT pk_year_id FROM rotary_year_master WHERE isdeleted = 0 AND IsCurrent = 1 LIMIT 1");
    const thisYear = new Date().getFullYear();
    let current = currentYearId !== null && currentYearId !== undefined ? all.find((t) => t.yearId === Number(currentYearId)) : undefined;
    current ??= [...all].reverse().find((t) => { const y = startYear(t.yearLabel); return y !== null && y <= thisYear; });
    if (!current) return [];
    const result = [current];
    const cur = startYear(current.yearLabel);
    if (cur !== null) {
      const prev = all.find((t) => startYear(t.yearLabel) === cur - 1);
      if (prev) result.push(prev);
    }
    return result;
  }

  /** Primary photo for the project rows on this page only, one query per year table. */
  private async projectPhotos(conn: DbCommands, rows: Record<string, unknown>[], yearTables: YearTableInfo[]) {
    const map = new Map<string, string>();
    const projects = rows.filter((r) => r.Type === "project");
    for (const t of yearTables) {
      const ids = [...new Set(projects.filter((r) => Number(r.YearId) === t.yearId).map((r) => Number(r.Id)))];
      if (ids.length === 0) continue;
      const suffix = t.yearLabel.replace(/-/g, "_");
      for (const r of await conn.query(
        `SELECT ph.fk_project_id AS ProjectId,
                CONCAT('/Documents/gallery/Group', p.fk_club_id, '/', CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk) ELSE CONCAT('${suffix}/Album', p.pk_project_id) END, '/', ph.image_path) AS Url
         FROM \`${t.photosTable}\` ph JOIN \`${t.projectsTable}\` p ON p.pk_project_id = ph.fk_project_id
         WHERE ph.fk_project_id IN @Ids
         ORDER BY ph.fk_project_id, ph.is_primary DESC, ph.sort_order, ph.pk_photo_id`, { Ids: ids })) {
        const key = `${t.yearId}:${Number(r.ProjectId)}`;
        if (!map.has(key)) map.set(key, String(r.Url));
      }
    }
    return map;
  }
}

function sourceName(r: Record<string, unknown>, clubNames: Map<number, string>, districtNumbers: Map<number, string>) {
  const clubId = r.ClubId === null || r.ClubId === undefined ? null : Number(r.ClubId);
  const districtId = r.DistrictId === null || r.DistrictId === undefined ? null : Number(r.DistrictId);
  if (r.ScopeKind === "ri") return "Rotary International";
  if (r.ScopeKind === "district" && districtId !== null && districtNumbers.has(districtId)) return `District ${districtNumbers.get(districtId)}`;
  if (clubId !== null && clubNames.has(clubId)) return clubNames.get(clubId)!;
  if (districtId !== null && districtNumbers.has(districtId)) return `District ${districtNumbers.get(districtId)}`;
  return "Rotary";
}

export function toDto(r: Record<string, unknown>, clubNames: Map<number, string>, districtNumbers: Map<number, string>, photos: Map<string, string>) {
  const type = String(r.Type ?? "");
  const id = Number(r.Id);
  const clubId = Number(r.ClubId) > 0 ? Number(r.ClubId) : null;
  const districtId = Number(r.DistrictId) > 0 ? Number(r.DistrictId) : null;
  const scope = String(r.ScopeKind ?? "");
  const extra = r.Extra === null || r.Extra === undefined ? null : String(r.Extra);
  const dto = {
    type, id, title: String(r.Title ?? ""), body: trimBody(r.Body as string | null), imageUrl: (r.ImageUrl as string | null) ?? null, dateTime: r.SortAt, scope, clubId, districtId,
    sourceName: sourceName(r, clubNames, districtNumbers), linkUrl: (r.LinkUrl as string | null) ?? null,
    deepLink: {
      type: String(r.DeepLinkType ?? ""), clubId, districtId, entityId: id as number | null, yearId: type === "project" ? Number(r.YearId) : null,
      scope: type === "document" ? scope : null, scopeId: type === "document" ? (scope === "district" ? (r.DistrictId as number | null) : (r.ClubId as number | null)) : null,
    },
  };
  switch (type) {
    case "greeting": {
      const names = String(r.Title ?? "");
      if (extra && extra.toLowerCase().startsWith("self_")) {
        dto.title = extra.toLowerCase().endsWith("birthday") ? "Happy Birthday!" : "Happy Anniversary!";
        dto.body = `Warm wishes from ${dto.sourceName}.`;
        dto.deepLink.entityId = id;
        break;
      }
      const [b, a] = parseCelebrationCounts(extra);
      if (b + a === 1) {
        dto.title = `${names}'s ${b === 1 ? "Birthday" : "Anniversary"}`;
        dto.body = `${names} · ${dto.sourceName}`;
      } else {
        const parts: string[] = [];
        if (b > 0) parts.push(`${b} birthday${b === 1 ? "" : "s"}`);
        if (a > 0) parts.push(`${a} anniversar${a === 1 ? "y" : "ies"}`);
        dto.title = parts.join(" and ") + " to celebrate";
        dto.body = trimBody(names);
      }
      // The digest has no entity; the app opens the club calendar for the date.
      dto.deepLink.entityId = null;
      break;
    }
    case "project":
      if (extra && extra.trim()) dto.body = !dto.body ? extra : `${extra} · ${dto.body}`;
      if (clubId !== null && photos.has(`${Number(r.YearId)}:${id}`)) dto.imageUrl = photos.get(`${Number(r.YearId)}:${id}`)!;
      break;
    case "event":
      if (extra && extra.trim() && !Number.isNaN(Date.parse(extra))) {
        const when = formatDate(extra, "dd MMM yyyy, h:mm tt");
        dto.body = !dto.body ? when : `${when} · ${dto.body}`;
      }
      break;
    case "newsletter":
      dto.body ??= "A new newsletter has been published.";
      break;
    case "document":
      dto.body ??= "A new document has been published.";
      break;
  }
  return dto;
}
