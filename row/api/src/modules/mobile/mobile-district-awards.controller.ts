import { Controller, Get, Param, Query } from "@nestjs/common";
import { Authorize } from "../../auth/decorators";
import { paramInt, queryInt } from "../../common/binding";
import { dotnetRound } from "../../common/dotnet-format";
import { ok, statusCode } from "../../common/results";
import { Db } from "../../database/db.service";
import { isDistrictDrillReachable } from "../../services/kill-switch.helper";

const BLOCKED = { message: "This district or its zone is inactive." };

/** Port of MobileDistrictAwardsController.cs: read-only District Awards tabs for the app (writes stay on the web). */
@Controller("api/mobile")
@Authorize()
export class MobileDistrictAwardsController {
  constructor(private readonly db: Db) {}

  private async blocked(districtId: number) {
    return (await isDistrictDrillReachable(this.db, districtId)) ? null : statusCode(403, BLOCKED);
  }

  @Get("districts/:districtId/awards/categories")
  async categories(@Param("districtId") d: string, @Query("yearId") y?: string) {
    const [districtId, yearId] = [paramInt(d, "districtId"), queryInt(y)];
    return (await this.blocked(districtId)) ?? ok(await this.db.query(
      `SELECT c.pk_id AS id, c.fk_district_id AS districtId, c.fk_year_id AS yearId, c.category_name AS categoryName, c.sort_order AS sortOrder, c.is_active AS isActive,
              y.YearLabel AS yearLabel
       FROM district_citation_category c LEFT JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
       WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0${yearId !== null ? " AND c.fk_year_id = @YearId" : ""}
       ORDER BY c.sort_order, c.category_name`,
      { DistrictId: districtId, YearId: yearId },
    ));
  }

  @Get("districts/:districtId/awards/description")
  async description(@Param("districtId") d: string, @Query("yearId") y?: string) {
    const [districtId, yearId] = [paramInt(d, "districtId"), queryInt(y, 0)];
    const block = await this.blocked(districtId);
    if (block) return block;
    const row = await this.db.queryFirstOrDefault(
      "SELECT pk_id AS id, description_html AS descriptionHtml FROM district_citation_description WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND isdeleted=0",
      { DistrictId: districtId, YearId: yearId },
    );
    return ok(row ?? { id: 0, descriptionHtml: "" });
  }

  @Get("districts/:districtId/awards/auto-questions")
  async autoQuestions(@Param("districtId") d: string, @Query("yearId") y?: string) {
    const [districtId, yearId] = [paramInt(d, "districtId"), queryInt(y)];
    const block = await this.blocked(districtId);
    if (block) return block;
    const questions = await this.db.query(
      `SELECT q.pk_id AS id, q.fk_category_id AS categoryId, cc.category_name AS categoryName, q.fk_activity_id AS activityId, a.activity_name AS activityName, a.sub_type AS subType,
              CAST(ROUND(q.points) AS SIGNED) AS points, q.is_bonus AS isBonus, CAST(ROUND(q.bonus_points) AS SIGNED) AS bonusPoints,
              q.min_bonus AS minBonus, q.max_bonus AS maxBonus, q.sort_order AS sortOrder, q.fk_year_id AS yearId
       FROM district_citation_auto_question q
       INNER JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
       INNER JOIN district_citation_category cc ON cc.pk_id = q.fk_category_id
       WHERE q.fk_district_id=@DistrictId AND q.isdeleted=0${yearId !== null ? " AND q.fk_year_id=@YearId" : ""}
       ORDER BY cc.sort_order, q.sort_order`,
      { DistrictId: districtId, YearId: yearId },
    );
    const ids = questions.map((q) => Number(q.id));
    const subs = ids.length
      ? await this.db.query(
          `SELECT s.pk_id AS id, s.fk_auto_question_id AS autoQuestionId, s.sub_item_type AS subItemType, s.sub_item_id AS subItemId, s.sub_item_name AS subItemName,
                  s.filter_aof_id AS filterAofId, s.filter_cat_id AS filterCatId, CAST(ROUND(s.points) AS SIGNED) AS points, s.is_bonus AS isBonus,
                  CAST(ROUND(s.bonus_points) AS SIGNED) AS bonusPoints, s.min_bonus AS minBonus, s.max_bonus AS maxBonus,
                  COALESCE(aof_only.name, aof_for_cat.name, aof_for_sub.name, aof_by_filter.name) AS areaOfFocusName,
                  COALESCE(cat_only.name, cat_for_sub.name, cat_by_filter.name) AS categoryName, sub_only.name AS subCategoryName
           FROM district_citation_auto_question_sub s
           LEFT JOIN area_of_focus_master aof_only      ON LOWER(s.sub_item_type) = 'area_of_focus' AND aof_only.pk_area_of_focus_id = s.sub_item_id
           LEFT JOIN category_master cat_only           ON LOWER(s.sub_item_type) = 'category' AND cat_only.pk_category_id = s.sub_item_id
           LEFT JOIN area_of_focus_master aof_for_cat   ON LOWER(s.sub_item_type) = 'category' AND aof_for_cat.pk_area_of_focus_id = cat_only.fk_area_of_focus_id
           LEFT JOIN sub_category_master sub_only       ON LOWER(s.sub_item_type) IN ('sub_category','subcategory') AND sub_only.pk_sub_category_id = s.sub_item_id
           LEFT JOIN category_master cat_for_sub        ON LOWER(s.sub_item_type) IN ('sub_category','subcategory') AND cat_for_sub.pk_category_id = sub_only.fk_category_id
           LEFT JOIN area_of_focus_master aof_for_sub   ON LOWER(s.sub_item_type) IN ('sub_category','subcategory') AND aof_for_sub.pk_area_of_focus_id = cat_for_sub.fk_area_of_focus_id
           LEFT JOIN area_of_focus_master aof_by_filter ON s.filter_aof_id IS NOT NULL AND aof_by_filter.pk_area_of_focus_id = s.filter_aof_id
           LEFT JOIN category_master cat_by_filter      ON s.filter_cat_id IS NOT NULL AND cat_by_filter.pk_category_id = s.filter_cat_id
           WHERE s.fk_auto_question_id IN @Ids AND s.isdeleted = 0
           ORDER BY s.sort_order`,
          { Ids: ids },
        )
      : [];
    for (const q of questions) q.subItems = subs.filter((s) => Number(s.autoQuestionId) === Number(q.id));
    return ok(questions);
  }

  @Get("districts/:districtId/awards/manual-questions")
  async manualQuestions(@Param("districtId") d: string, @Query("yearId") y?: string) {
    const [districtId, yearId] = [paramInt(d, "districtId"), queryInt(y)];
    const block = await this.blocked(districtId);
    if (block) return block;
    const criteria = await this.db.query(
      `SELECT mc.pk_id AS id, mc.fk_category_id AS categoryId, cc.category_name AS categoryName, mc.criteria_name AS criteriaName, mc.sort_order AS sortOrder, mc.fk_year_id AS yearId
       FROM district_citation_manual_criteria mc
       INNER JOIN district_citation_category cc ON cc.pk_id = mc.fk_category_id
       WHERE mc.fk_district_id=@DistrictId AND mc.isdeleted=0${yearId !== null ? " AND mc.fk_year_id=@YearId" : ""}
       ORDER BY cc.sort_order, mc.sort_order`,
      { DistrictId: districtId, YearId: yearId },
    );
    const ids = criteria.map((c) => Number(c.id));
    if (ids.length === 0) {
      for (const c of criteria) c.subCriteria = [];
      return ok(criteria);
    }
    const subs = await this.db.query(
      `SELECT sc.pk_id AS id, sc.fk_criteria_id AS criteriaId, sc.sub_criteria_title AS subCriteriaTitle, sc.answer_type AS answerType,
              CAST(ROUND(sc.points) AS SIGNED) AS points, sc.is_bonus AS isBonus, CAST(ROUND(sc.bonus_points) AS SIGNED) AS bonusPoints,
              sc.min_bonus AS minBonus, sc.max_bonus AS maxBonus, sc.remark, sc.sort_order AS sortOrder
       FROM district_citation_manual_sub_criteria sc WHERE sc.fk_criteria_id IN @Ids AND sc.isdeleted=0 ORDER BY sc.sort_order`,
      { Ids: ids },
    );
    const subIds = subs.map((s) => Number(s.id));
    const options = subIds.length
      ? await this.db.query(
          `SELECT pk_id AS id, fk_sub_criteria_id AS subCriteriaId, option_text AS optionText, CAST(ROUND(option_points) AS SIGNED) AS optionPoints, sort_order AS sortOrder
           FROM district_citation_manual_sub_criteria_option WHERE fk_sub_criteria_id IN @Ids AND isdeleted=0 ORDER BY sort_order`,
          { Ids: subIds },
        )
      : [];
    for (const s of subs) s.options = options.filter((o) => Number(o.subCriteriaId) === Number(s.id));
    for (const c of criteria) c.subCriteria = subs.filter((s) => Number(s.criteriaId) === Number(c.id));
    return ok(criteria);
  }

  @Get("districts/:districtId/awards/club-points")
  async clubPoints(@Param("districtId") d: string, @Query("yearId") y?: string) {
    const [districtId, yearId] = [paramInt(d, "districtId"), queryInt(y, 0)];
    const block = await this.blocked(districtId);
    if (block) return block;
    const clubs = await this.db.query("SELECT pk_club_id AS clubId, ClubName AS clubName, ClubCode AS clubRotaryId FROM club_master WHERE fk_district_id=@DistrictId AND isdeleted=0 ORDER BY ClubName", { DistrictId: districtId });
    // Auto entries for live auto questions plus manual entries for live manual sub-criteria of this year.
    const totals = new Map((await this.db.query(
      `SELECT clubId, SUM(score) AS totalPoints FROM (
           SELECT e.fk_club_id AS clubId, (e.points_earned + e.bonus_earned) AS score
           FROM district_citation_club_entry e
           INNER JOIN district_citation_auto_question q ON q.pk_id = e.fk_question_id AND q.fk_district_id = @DistrictId AND q.fk_year_id = @YearId AND q.isdeleted = 0
           WHERE e.fk_district_id=@DistrictId AND e.fk_year_id=@YearId AND e.entry_type='auto' AND e.isdeleted=0
           UNION ALL
           SELECT e.fk_club_id AS clubId, (e.points_earned + e.bonus_earned) AS score
           FROM district_citation_club_entry e
           INNER JOIN district_citation_manual_sub_criteria sc ON sc.pk_id = e.fk_question_id AND sc.isdeleted = 0
           INNER JOIN district_citation_manual_criteria mc ON mc.pk_id = sc.fk_criteria_id AND mc.fk_district_id = @DistrictId AND mc.fk_year_id = @YearId AND mc.isdeleted = 0
           WHERE e.fk_district_id=@DistrictId AND e.fk_year_id=@YearId AND e.entry_type='manual' AND e.isdeleted=0
       ) t
       GROUP BY clubId`,
      { DistrictId: districtId, YearId: yearId },
    )).map((e) => [Number(e.clubId), Number(e.totalPoints) || 0]));
    const rows = clubs.map((c) => ({ clubId: Number(c.clubId), clubName: String(c.clubName ?? ""), clubRotaryId: c.clubRotaryId ?? null, totalPoints: dotnetRound(totals.get(Number(c.clubId)) ?? 0, 0) }));
    // OrderByDescending is a stable sort, as Array.prototype.sort is.
    return ok(rows.sort((a, b) => b.totalPoints - a.totalPoints));
  }
}
