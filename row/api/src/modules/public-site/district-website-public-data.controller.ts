import { Controller, Get, Param, Query } from "@nestjs/common";
import { AllowAnonymous } from "../../auth/decorators";
import { queryInt, routeInt } from "../../common/binding";
import { dotnetRound } from "../../common/dotnet-format";
import { badRequest, notFound, ok } from "../../common/results";
import { Db, type DbCommands, type Row } from "../../database/db.service";

/** A live district website row on an active district and zone (the district site's kill switch). */
async function isDistrictServiceable(conn: DbCommands, districtId: number) {
  return Number(await conn.executeScalar(
    `SELECT COUNT(*) FROM district_websites w JOIN district_master d ON d.pk_district_id = w.fk_district_id JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
     WHERE w.fk_district_id = @DistrictId AND w.isdeleted = 0 AND d.isdeleted = 0 AND d.IsActive = 1 AND z.isdeleted = 0 AND z.IsActive = 1`, { DistrictId: districtId })) > 0;
}

/** Port of DistrictWebsitePublicDataController.cs: anonymous menus and citation index for the district website. */
@Controller("api/public/district")
@AllowAnonymous()
export class DistrictWebsitePublicDataController {
  constructor(private readonly db: Db) {}

  private serve<T>(districtId: number, work: (conn: DbCommands) => Promise<T>) {
    return this.db.session(async (conn) => ((await isDistrictServiceable(conn, districtId)) ? work(conn) : notFound()));
  }

  /** District menus live in the shared menu tables with fk_club_id = 0; documents are served from /uploads/menu. */
  @Get(":districtId/menus")
  menus(@Param("districtId") d: string) {
    const districtId = routeInt(d);
    const docLink = (a: string) => `CASE WHEN ${a}link_value IS NULL OR ${a}link_value = '' THEN ${a}link_value
      WHEN ${a}link_type = 'document' AND ${a}link_value NOT LIKE '/%' AND ${a}link_value NOT LIKE 'http%' THEN CONCAT('/uploads/menu/', ${a}link_value) ELSE ${a}link_value END`;
    return this.serve(districtId, async (conn) => {
      const menus = (await conn.query(
        `SELECT pk_club_website_menu_id AS id, menu_name AS menuName, link_type AS linkType, ${docLink("")} AS linkValue, content_html AS contentHtml,
                COALESCE(is_default, 0) AS isDefault, sort_order AS sortOrder
         FROM club_website_menu WHERE fk_district_id = @DistrictId AND fk_club_id = 0 AND isdeleted = 0 AND is_active = 1 ORDER BY sort_order, pk_club_website_menu_id`,
        { DistrictId: districtId })).map((m) => ({ id: Number(m.id), menuName: m.menuName ?? "", linkType: m.linkType ?? "page", linkValue: m.linkValue ?? "", contentHtml: m.contentHtml,
        isDefault: Boolean(Number(m.isDefault)), sortOrder: Number(m.sortOrder ?? 0), subMenus: [] as Row[] }));
      if (!menus.length) return ok(menus);
      const subs = await conn.query(
        `SELECT sm.pk_club_website_submenu_id AS id, sm.fk_menu_id AS menuId, sm.submenu_name AS submenuName, sm.link_type AS linkType, ${docLink("sm.")} AS linkValue, sm.sort_order AS sortOrder
         FROM club_website_submenu sm WHERE sm.fk_menu_id IN @Ids AND sm.isdeleted = 0 AND sm.is_active = 1 ORDER BY sm.sort_order, sm.pk_club_website_submenu_id`,
        { Ids: menus.map((m) => m.id) });
      for (const s of subs)
        menus.find((m) => m.id === Number(s.menuId))?.subMenus.push({ id: Number(s.id), subMenuName: s.submenuName ?? "", linkType: s.linkType ?? "page", linkValue: s.linkValue ?? "", sortOrder: Number(s.sortOrder ?? 0) });
      return ok(menus);
    });
  }

  /** Each citation category with this district's clubs ranked by points (auto + manual entries, via the question → category link). */
  @Get(":districtId/citation/performance")
  performance(@Param("districtId") d: string, @Query("yearId") y?: string) {
    const districtId = routeInt(d);
    const yearId = queryInt(y, 0);
    if (yearId <= 0) return badRequest({ message: "yearId is required." });
    return this.serve(districtId, async (conn) => {
      const p = { D: districtId, Y: yearId };
      const districtNumber = await conn.executeScalar<string>("SELECT DistrictNumber FROM district_master WHERE pk_district_id=@D", p);
      const yearLabel = await conn.executeScalar<string>("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id=@Y", p);
      const categories = await conn.query(
        "SELECT pk_id AS categoryId, category_name AS categoryName, sort_order AS sortOrder FROM district_citation_category WHERE fk_district_id=@D AND fk_year_id=@Y AND isdeleted=0 ORDER BY sort_order, pk_id", p);
      const clubs = new Map((await conn.query("SELECT pk_club_id AS clubId, ClubName AS clubName, ClubRotaryId AS clubRotaryId FROM club_master WHERE fk_district_id=@D AND isdeleted=0", p))
        .map((c) => [Number(c.clubId), c]));
      const entries = await conn.query(
        `SELECT clubId, categoryId, SUM(score) AS points FROM (
             SELECT e.fk_club_id AS clubId, q.fk_category_id AS categoryId, (e.points_earned + e.bonus_earned) AS score
             FROM district_citation_club_entry e
             JOIN district_citation_auto_question q ON q.pk_id = e.fk_question_id AND q.fk_district_id=@D AND q.fk_year_id=@Y AND q.isdeleted=0
             WHERE e.fk_district_id=@D AND e.fk_year_id=@Y AND e.entry_type='auto' AND e.isdeleted=0
             UNION ALL
             SELECT e.fk_club_id, mc.fk_category_id, (e.points_earned + e.bonus_earned)
             FROM district_citation_club_entry e
             JOIN district_citation_manual_sub_criteria sc ON sc.pk_id = e.fk_question_id AND sc.isdeleted=0
             JOIN district_citation_manual_criteria mc ON mc.pk_id = sc.fk_criteria_id AND mc.fk_district_id=@D AND mc.fk_year_id=@Y AND mc.isdeleted=0
             WHERE e.fk_district_id=@D AND e.fk_year_id=@Y AND e.entry_type='manual' AND e.isdeleted=0
         ) t GROUP BY clubId, categoryId`, p);
      return ok({
        districtId, districtNumber, yearId, yearLabel,
        categories: categories.map((cat) => ({
          categoryId: Number(cat.categoryId), categoryName: cat.categoryName, sortOrder: Number(cat.sortOrder ?? 0),
          clubs: entries.filter((e) => e.categoryId !== null && Number(e.categoryId) === Number(cat.categoryId) && Number(e.points) > 0 && clubs.has(Number(e.clubId)))
            .map((e) => { const c = clubs.get(Number(e.clubId))!; return { clubId: Number(e.clubId), clubName: c.clubName as string | null, clubRotaryId: c.clubRotaryId, points: dotnetRound(Number(e.points)) }; })
            .sort((a, b) => b.points - a.points || (a.clubName ?? "").localeCompare(b.clubName ?? "")),
        })),
      });
    });
  }

  /** Years that have citation categories, for the district site's year picker. */
  @Get(":districtId/citation/years")
  citationYears(@Param("districtId") d: string) {
    const districtId = routeInt(d);
    return this.serve(districtId, async (conn) => ok(await conn.query(
      `SELECT y.pk_year_id AS id, y.YearLabel AS label FROM rotary_year_master y
       WHERE y.pk_year_id IN (SELECT DISTINCT fk_year_id FROM district_citation_category WHERE fk_district_id=@D AND isdeleted=0) ORDER BY y.StartDate DESC`, { D: districtId })));
  }
}
