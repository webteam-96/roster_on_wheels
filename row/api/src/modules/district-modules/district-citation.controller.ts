import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, file, notFound, ok, statusCode } from "../../common/results";
import { bodyField, paramInt, queryInt } from "../../common/binding";
import { dotnetRound } from "../../common/dotnet-format";
import { CLUB_BLOCKED_MESSAGE, DISTRICT_BLOCKED_MESSAGE, isClubDrillReachable, isDistrictDrillReachable } from "../../services/kill-switch.helper";
import { CitationAutoPointsService, isDistrictAwardsEnabled } from "../../services/citation-auto-points.service";
import { ExcelJS, XLColor, XLSX_CONTENT_TYPE, style, styleRange, thinBorders, toBuffer } from "../../services/xlsx";

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v) || 0);
const int = (v: unknown) => Math.trunc(num(v));
const bit = (v: unknown) => (v === true || Number(v) === 1 ? 1 : 0);
/** A body property by name (any casing) as an object array. */
const objects = (body: unknown, name: string) => {
  const v = bodyField(body, name);
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
};
const f = (o: unknown, name: string) => bodyField(o, name);
const text = (o: unknown, name: string, fallback: string | null = null) => {
  const v = f(o, name);
  return v === null || v === undefined ? fallback : String(v);
};
const optInt = (o: unknown, name: string) => {
  const v = f(o, name);
  return v === null || v === undefined ? null : Math.trunc(Number(v));
};

/** Port of DistrictModulesController.cs, part 6: the district citation (awards) setup, club points and reports, and the club's own citation screen. */
@Controller()
@Authorize()
export class DistrictCitationController {
  constructor(
    private readonly db: Db,
    private readonly autoPoints: CitationAutoPointsService,
  ) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);
  private async districtBlocked(districtId: number) {
    return !(await isDistrictDrillReachable(this.db, districtId)) ? statusCode(403, { message: DISTRICT_BLOCKED_MESSAGE }) : null;
  }

  // ---- shared lists ----

  @Get("api/district-modules/citation/activities")
  async activities() {
    return ok(await this.db.query("SELECT pk_id AS id, activity_name AS activityName, sub_type AS subType, sort_order AS sortOrder FROM district_citation_activity_master ORDER BY sort_order"));
  }

  @Get("api/district-modules/citation/meeting-types")
  meetingTypes() {
    return ok([
      { id: "regular", name: "Regular" }, { id: "fellowship", name: "Fellowship" }, { id: "bod", name: "BOD" }, { id: "assembly", name: "Assembly" }, { id: "trust", name: "Trust" },
    ]);
  }

  @Get("api/district-modules/citation/area-of-focus")
  async areaOfFocus(@Query("moduleKey") moduleKey?: string) {
    return this.db.session(async (conn) => {
      let sql = "SELECT pk_area_of_focus_id AS id, name FROM area_of_focus_master WHERE isdeleted = 0";
      if (moduleKey) {
        const moduleId = await conn.executeScalar("SELECT pk_module_id FROM module_master WHERE ModuleKey = @Key AND isdeleted = 0", { Key: moduleKey });
        if (moduleId !== null && moduleId !== undefined) sql += ` AND (fk_module_id = ${Number(moduleId)} OR fk_module_id IS NULL)`;
      }
      return ok(await conn.query(`${sql} ORDER BY name`));
    });
  }

  @Get("api/district-modules/citation/categories")
  async categories(@Query("areaOfFocusId") a?: string) {
    const aofId = queryInt(a);
    return ok(await this.db.query(`SELECT pk_category_id AS id, name FROM category_master WHERE isdeleted = 0${aofId !== null ? " AND fk_area_of_focus_id = @AofId" : ""} ORDER BY name`, { AofId: aofId }));
  }

  @Get("api/district-modules/citation/sub-categories")
  async subCategories(@Query("categoryId") c?: string) {
    const catId = queryInt(c);
    return ok(await this.db.query(`SELECT pk_sub_category_id AS id, name FROM sub_category_master WHERE isdeleted = 0${catId !== null ? " AND fk_category_id = @CatId" : ""} ORDER BY name`, { CatId: catId }));
  }

  // ---- district categories ----

  @Get("api/district-modules/:districtId/citation/categories")
  async districtCategories(@Param("districtId") d: string, @Query("yearId") y?: string) {
    const districtId = paramInt(d, "districtId");
    const yearId = queryInt(y);
    return (
      (await this.districtBlocked(districtId)) ??
      ok(
        await this.db.query(
          `SELECT c.pk_id AS id, c.fk_district_id AS districtId, c.fk_year_id AS yearId, c.category_name AS categoryName, c.sort_order AS sortOrder,
                  c.is_active AS isActive, y.YearLabel AS yearLabel
           FROM district_citation_category c LEFT JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
           WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0${yearId !== null ? " AND c.fk_year_id = @YearId" : ""}
           ORDER BY c.sort_order, c.category_name`,
          { DistrictId: districtId, YearId: yearId },
        ),
      )
    );
  }

  @Post("api/district-modules/:districtId/citation/categories")
  async createCategory(@Param("districtId") d: string, @Body() body: unknown, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    return this.db.session(async (conn) => {
      await conn.execute(
        "INSERT INTO district_citation_category (fk_district_id, fk_year_id, category_name, sort_order, created_by) VALUES (@DistrictId, @YearId, @Name, @Sort, @UserId)",
        { DistrictId: districtId, YearId: int(f(body, "yearId")), Name: text(body, "categoryName", ""), Sort: int(f(body, "sortOrder")), UserId: this.userId(u) },
      );
      return ok({ id: Number(await conn.executeScalar("SELECT LAST_INSERT_ID()")), message: "Category created." });
    });
  }

  @Put("api/district-modules/:districtId/citation/categories/:id")
  async updateCategory(@Param("districtId") d: string, @Param("id") i: string, @Body() body: unknown, @User() u: CurrentUser) {
    await this.db.execute(
      "UPDATE district_citation_category SET category_name=@Name, sort_order=@Sort, modified_by=@UserId WHERE pk_id=@Id AND fk_district_id=@DistrictId AND isdeleted=0",
      { Id: paramInt(i), DistrictId: paramInt(d, "districtId"), Name: text(body, "categoryName", ""), Sort: int(f(body, "sortOrder")), UserId: this.userId(u) },
    );
    return ok({ message: "Category updated." });
  }

  @Delete("api/district-modules/:districtId/citation/categories/:id")
  async deleteCategory(@Param("districtId") d: string, @Param("id") i: string) {
    const [districtId, id] = [paramInt(d, "districtId"), paramInt(i)];
    return this.db.session(async (conn) => {
      const auto = Number(await conn.executeScalar("SELECT COUNT(*) FROM district_citation_auto_question WHERE fk_category_id=@Id AND isdeleted=0", { Id: id }));
      const manual = Number(await conn.executeScalar("SELECT COUNT(*) FROM district_citation_manual_criteria WHERE fk_category_id=@Id AND isdeleted=0", { Id: id }));
      if (auto > 0 || manual > 0) return badRequest({ message: "Cannot delete category with existing questions." });
      await conn.execute("UPDATE district_citation_category SET isdeleted=1 WHERE pk_id=@Id AND fk_district_id=@DistrictId", { Id: id, DistrictId: districtId });
      return ok({ message: "Category deleted." });
    });
  }

  // ---- description ----

  @Get("api/district-modules/:districtId/citation/description")
  async description(@Param("districtId") d: string, @Query("yearId") y?: string) {
    const districtId = paramInt(d, "districtId");
    const yearId = queryInt(y, 0);
    const block = await this.districtBlocked(districtId);
    if (block) return block;
    const row = await this.db.queryFirstOrDefault(
      "SELECT pk_id AS id, description_html AS descriptionHtml FROM district_citation_description WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND isdeleted=0",
      { DistrictId: districtId, YearId: yearId },
    );
    return ok(row ?? { id: 0, descriptionHtml: "" });
  }

  @Post("api/district-modules/:districtId/citation/description")
  async saveDescription(@Param("districtId") d: string, @Body() body: unknown, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    const yearId = int(f(body, "yearId"));
    const html = text(body, "descriptionHtml", "");
    return this.db.session(async (conn) => {
      const existing = await conn.executeScalar("SELECT pk_id FROM district_citation_description WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND isdeleted=0", { DistrictId: districtId, YearId: yearId });
      if (existing !== null && existing !== undefined) {
        await conn.execute("UPDATE district_citation_description SET description_html=@Html, modified_by=@UserId WHERE pk_id=@Id", { Id: existing, Html: html, UserId: this.userId(u) });
      } else {
        await conn.execute("INSERT INTO district_citation_description (fk_district_id, fk_year_id, description_html, created_by) VALUES (@DistrictId, @YearId, @Html, @UserId)", {
          DistrictId: districtId, YearId: yearId, Html: html, UserId: this.userId(u),
        });
      }
      return ok({ message: "Description saved." });
    });
  }

  // ---- auto questions ----

  @Get("api/district-modules/:districtId/citation/auto-questions")
  async autoQuestions(@Param("districtId") d: string, @Query("yearId") y?: string) {
    const districtId = paramInt(d, "districtId");
    const yearId = queryInt(y);
    const block = await this.districtBlocked(districtId);
    if (block) return block;
    return this.db.session(async (conn) => {
      const questions = await conn.query(
        `SELECT q.pk_id AS id, q.fk_category_id AS categoryId, cc.category_name AS categoryName, q.fk_activity_id AS activityId, a.activity_name AS activityName,
                a.sub_type AS subType, CAST(ROUND(q.points) AS SIGNED) AS points, q.is_bonus AS isBonus, CAST(ROUND(q.bonus_points) AS SIGNED) AS bonusPoints,
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
        ? await conn.query(
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
    });
  }

  private static async insertAutoSubs(conn: DbCommands, questionId: number, body: unknown, userId: number) {
    for (const s of objects(body, "subItems")) {
      await conn.execute(
        `INSERT INTO district_citation_auto_question_sub (fk_auto_question_id, sub_item_type, sub_item_id, sub_item_name, filter_aof_id, filter_cat_id, points, is_bonus, bonus_points, min_bonus, max_bonus, created_by)
         VALUES (@QId, @Type, @SubId, @SubName, @FilterAofId, @FilterCatId, @Points, @IsBonus, @BonusPoints, @MinBonus, @MaxBonus, @UserId)`,
        {
          QId: questionId, Type: text(s, "subItemType", ""), SubId: optInt(s, "subItemId"), SubName: text(s, "subItemName"), FilterAofId: optInt(s, "filterAofId"),
          FilterCatId: optInt(s, "filterCatId"), Points: int(f(s, "points")), IsBonus: bit(f(s, "isBonus")), BonusPoints: int(f(s, "bonusPoints")),
          MinBonus: int(f(s, "minBonus")), MaxBonus: int(f(s, "maxBonus")), UserId: userId,
        },
      );
    }
  }
  private static autoParams(body: unknown) {
    return {
      CategoryId: int(f(body, "categoryId")), ActivityId: int(f(body, "activityId")), Points: int(f(body, "points")), IsBonus: bit(f(body, "isBonus")),
      BonusPoints: int(f(body, "bonusPoints")), MinBonus: int(f(body, "minBonus")), MaxBonus: int(f(body, "maxBonus")), Sort: int(f(body, "sortOrder")),
    };
  }

  @Post("api/district-modules/:districtId/citation/auto-questions")
  async createAutoQuestion(@Param("districtId") d: string, @Body() body: unknown, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    return this.db.session(async (conn) => {
      await conn.execute(
        `INSERT INTO district_citation_auto_question (fk_district_id, fk_year_id, fk_category_id, fk_activity_id, points, is_bonus, bonus_points, min_bonus, max_bonus, sort_order, created_by)
         VALUES (@DistrictId, @YearId, @CategoryId, @ActivityId, @Points, @IsBonus, @BonusPoints, @MinBonus, @MaxBonus, @Sort, @UserId)`,
        { ...DistrictCitationController.autoParams(body), DistrictId: districtId, YearId: int(f(body, "yearId")), UserId: this.userId(u) },
      );
      const id = Number(await conn.executeScalar("SELECT LAST_INSERT_ID()"));
      await DistrictCitationController.insertAutoSubs(conn, id, body, this.userId(u));
      return ok({ id, message: "Auto question created." });
    });
  }

  @Put("api/district-modules/:districtId/citation/auto-questions/:id")
  async updateAutoQuestion(@Param("districtId") d: string, @Param("id") i: string, @Body() body: unknown, @User() u: CurrentUser) {
    const [districtId, id] = [paramInt(d, "districtId"), paramInt(i)];
    return this.db.session(async (conn) => {
      await conn.execute(
        `UPDATE district_citation_auto_question SET fk_category_id=@CategoryId, fk_activity_id=@ActivityId, points=@Points, is_bonus=@IsBonus, bonus_points=@BonusPoints,
             min_bonus=@MinBonus, max_bonus=@MaxBonus, sort_order=@Sort, modified_by=@UserId
         WHERE pk_id=@Id AND fk_district_id=@DistrictId AND isdeleted=0`,
        { ...DistrictCitationController.autoParams(body), Id: id, DistrictId: districtId, UserId: this.userId(u) },
      );
      await conn.execute("UPDATE district_citation_auto_question_sub SET isdeleted=1 WHERE fk_auto_question_id=@Id", { Id: id });
      await DistrictCitationController.insertAutoSubs(conn, id, body, this.userId(u));
      return ok({ message: "Auto question updated." });
    });
  }

  @Delete("api/district-modules/:districtId/citation/auto-questions/:id")
  async deleteAutoQuestion(@Param("districtId") d: string, @Param("id") i: string) {
    const [districtId, id] = [paramInt(d, "districtId"), paramInt(i)];
    return this.db.session(async (conn) => {
      const entries = Number(await conn.executeScalar("SELECT COUNT(*) FROM district_citation_club_entry WHERE entry_type='auto' AND fk_question_id=@Id AND isdeleted=0", { Id: id }));
      if (entries > 0) return badRequest({ message: "Cannot delete: clubs have entered points." });
      await conn.execute("UPDATE district_citation_auto_question SET isdeleted=1 WHERE pk_id=@Id AND fk_district_id=@DistrictId", { Id: id, DistrictId: districtId });
      await conn.execute("UPDATE district_citation_auto_question_sub SET isdeleted=1 WHERE fk_auto_question_id=@Id", { Id: id });
      return ok({ message: "Auto question deleted." });
    });
  }

  // ---- manual criteria ----

  @Get("api/district-modules/:districtId/citation/manual-criteria")
  async manualCriteria(@Param("districtId") d: string, @Query("yearId") y?: string) {
    const districtId = paramInt(d, "districtId");
    const yearId = queryInt(y);
    const block = await this.districtBlocked(districtId);
    if (block) return block;
    return this.db.session(async (conn) => {
      const criteria = await conn.query(
        `SELECT mc.pk_id AS id, mc.fk_category_id AS categoryId, cc.category_name AS categoryName, mc.criteria_name AS criteriaName, mc.sort_order AS sortOrder,
                mc.fk_year_id AS yearId
         FROM district_citation_manual_criteria mc INNER JOIN district_citation_category cc ON cc.pk_id = mc.fk_category_id
         WHERE mc.fk_district_id=@DistrictId AND mc.isdeleted=0${yearId !== null ? " AND mc.fk_year_id=@YearId" : ""}
         ORDER BY cc.sort_order, mc.sort_order`,
        { DistrictId: districtId, YearId: yearId },
      );
      const ids = criteria.map((c) => Number(c.id));
      const subs = ids.length
        ? await conn.query(
            `SELECT sc.pk_id AS id, sc.fk_criteria_id AS criteriaId, sc.sub_criteria_title AS subCriteriaTitle, sc.answer_type AS answerType,
                    CAST(ROUND(sc.points) AS SIGNED) AS points, sc.is_bonus AS isBonus, CAST(ROUND(sc.bonus_points) AS SIGNED) AS bonusPoints,
                    sc.min_bonus AS minBonus, sc.max_bonus AS maxBonus, sc.remark, sc.sort_order AS sortOrder
             FROM district_citation_manual_sub_criteria sc WHERE sc.fk_criteria_id IN @Ids AND sc.isdeleted=0 ORDER BY sc.sort_order`,
            { Ids: ids },
          )
        : [];
      const subIds = subs.map((s) => Number(s.id));
      const options = subIds.length
        ? await conn.query(
            `SELECT pk_id AS id, fk_sub_criteria_id AS subCriteriaId, option_text AS optionText, CAST(ROUND(option_points) AS SIGNED) AS optionPoints, sort_order AS sortOrder
             FROM district_citation_manual_sub_criteria_option WHERE fk_sub_criteria_id IN @Ids AND isdeleted=0 ORDER BY sort_order`,
            { Ids: subIds },
          )
        : [];
      for (const s of subs) s.options = options.filter((o) => Number(o.subCriteriaId) === Number(s.id));
      for (const c of criteria) c.subCriteria = subs.filter((s) => Number(s.criteriaId) === Number(c.id));
      return ok(criteria);
    });
  }

  private static async insertManualSubs(conn: DbCommands, criteriaId: number, body: unknown, userId: number) {
    for (const s of objects(body, "subCriteria")) {
      const answerType = text(s, "answerType", "number");
      await conn.execute(
        `INSERT INTO district_citation_manual_sub_criteria (fk_criteria_id, sub_criteria_title, answer_type, points, is_bonus, bonus_points, min_bonus, max_bonus, remark, sort_order, created_by)
         VALUES (@CriteriaId, @Title, @AnswerType, @Points, @IsBonus, @BonusPoints, @MinBonus, @MaxBonus, @Remark, @Sort, @UserId)`,
        {
          CriteriaId: criteriaId, Title: text(s, "subCriteriaTitle"), AnswerType: answerType, Points: int(f(s, "points")), IsBonus: bit(f(s, "isBonus")),
          BonusPoints: int(f(s, "bonusPoints")), MinBonus: int(f(s, "minBonus")), MaxBonus: int(f(s, "maxBonus")), Remark: text(s, "remark"), Sort: int(f(s, "sortOrder")), UserId: userId,
        },
      );
      const subId = Number(await conn.executeScalar("SELECT LAST_INSERT_ID()"));
      if (answerType === "choose_one") {
        for (const o of objects(s, "options")) {
          await conn.execute(
            "INSERT INTO district_citation_manual_sub_criteria_option (fk_sub_criteria_id, option_text, option_points, sort_order, created_by) VALUES (@SubId, @Text, @Points, @Sort, @UserId)",
            { SubId: subId, Text: text(o, "optionText", ""), Points: int(f(o, "optionPoints")), Sort: int(f(o, "sortOrder")), UserId: userId },
          );
        }
      }
    }
  }

  @Post("api/district-modules/:districtId/citation/manual-criteria")
  async createManualCriteria(@Param("districtId") d: string, @Body() body: unknown, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    return this.db.session(async (conn) => {
      await conn.execute(
        "INSERT INTO district_citation_manual_criteria (fk_district_id, fk_year_id, fk_category_id, criteria_name, sort_order, created_by) VALUES (@DistrictId, @YearId, @CategoryId, @Name, @Sort, @UserId)",
        { DistrictId: districtId, YearId: int(f(body, "yearId")), CategoryId: int(f(body, "categoryId")), Name: text(body, "criteriaName", ""), Sort: int(f(body, "sortOrder")), UserId: this.userId(u) },
      );
      const id = Number(await conn.executeScalar("SELECT LAST_INSERT_ID()"));
      await DistrictCitationController.insertManualSubs(conn, id, body, this.userId(u));
      return ok({ id, message: "Manual criteria created." });
    });
  }

  @Put("api/district-modules/:districtId/citation/manual-criteria/:id")
  async updateManualCriteria(@Param("districtId") d: string, @Param("id") i: string, @Body() body: unknown, @User() u: CurrentUser) {
    const [districtId, id] = [paramInt(d, "districtId"), paramInt(i)];
    return this.db.session(async (conn) => {
      await conn.execute(
        "UPDATE district_citation_manual_criteria SET fk_category_id=@CategoryId, criteria_name=@Name, sort_order=@Sort, modified_by=@UserId WHERE pk_id=@Id AND fk_district_id=@DistrictId AND isdeleted=0",
        { Id: id, DistrictId: districtId, CategoryId: int(f(body, "categoryId")), Name: text(body, "criteriaName", ""), Sort: int(f(body, "sortOrder")), UserId: this.userId(u) },
      );
      const old = (await conn.query("SELECT pk_id AS id FROM district_citation_manual_sub_criteria WHERE fk_criteria_id=@Id AND isdeleted=0", { Id: id })).map((r) => Number(r.id));
      if (old.length) {
        await conn.execute("UPDATE district_citation_manual_sub_criteria SET isdeleted=1 WHERE fk_criteria_id=@Id", { Id: id });
        await conn.execute("UPDATE district_citation_manual_sub_criteria_option SET isdeleted=1 WHERE fk_sub_criteria_id IN @Ids", { Ids: old });
      }
      await DistrictCitationController.insertManualSubs(conn, id, body, this.userId(u));
      return ok({ message: "Manual criteria updated." });
    });
  }

  @Delete("api/district-modules/:districtId/citation/manual-criteria/:id")
  async deleteManualCriteria(@Param("districtId") d: string, @Param("id") i: string) {
    const [districtId, id] = [paramInt(d, "districtId"), paramInt(i)];
    return this.db.session(async (conn) => {
      const subIds = (await conn.query("SELECT pk_id AS id FROM district_citation_manual_sub_criteria WHERE fk_criteria_id=@Id AND isdeleted=0", { Id: id })).map((r) => Number(r.id));
      if (subIds.length) {
        const entries = Number(await conn.executeScalar("SELECT COUNT(*) FROM district_citation_club_entry WHERE entry_type='manual' AND fk_question_id IN @Ids AND isdeleted=0", { Ids: subIds }));
        if (entries > 0) return badRequest({ message: "Cannot delete: clubs have entered points." });
        await conn.execute("UPDATE district_citation_manual_sub_criteria SET isdeleted=1 WHERE fk_criteria_id=@Id", { Id: id });
        await conn.execute("UPDATE district_citation_manual_sub_criteria_option SET isdeleted=1 WHERE fk_sub_criteria_id IN @Ids", { Ids: subIds });
      }
      await conn.execute("UPDATE district_citation_manual_criteria SET isdeleted=1 WHERE pk_id=@Id AND fk_district_id=@DistrictId", { Id: id, DistrictId: districtId });
      return ok({ message: "Manual criteria deleted." });
    });
  }

  // ---- club points and reports ----

  @Get("api/district-modules/:districtId/citation/club-points")
  async clubPoints(@Param("districtId") d: string, @Query("yearId") y?: string) {
    const districtId = paramInt(d, "districtId");
    const yearId = queryInt(y, 0);
    const block = await this.districtBlocked(districtId);
    if (block) return block;
    return this.db.session(async (conn) => {
      const clubs = await conn.query(
        "SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId FROM club_master c WHERE c.fk_district_id=@DistrictId AND c.isdeleted=0 AND c.IsActive=1 ORDER BY c.ClubName",
        { DistrictId: districtId },
      );
      const totals = new Map(
        (
          await conn.query(
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
             ) t GROUP BY clubId`,
            { DistrictId: districtId, YearId: yearId },
          )
        ).map((r) => [Number(r.clubId), num(r.totalPoints)]),
      );
      const result = clubs.map((c) => ({ clubId: Number(c.clubId), clubName: c.clubName, clubRotaryId: c.clubRotaryId ?? null, totalPoints: dotnetRound(totals.get(Number(c.clubId)) ?? 0) }));
      // LINQ OrderByDescending is stable: ties keep club-name order.
      return ok(result.map((r, i) => ({ r, i })).sort((a, b) => b.r.totalPoints - a.r.totalPoints || a.i - b.i).map((x) => x.r));
    });
  }

  @Get("api/district-modules/:districtId/citation/club-report")
  async clubReport(@Param("districtId") d: string, @Query("yearId") y?: string) {
    const districtId = paramInt(d, "districtId");
    const yearId = queryInt(y, 0);
    const block = await this.districtBlocked(districtId);
    if (block) return block;
    const p = { DistrictId: districtId, YearId: yearId };
    const data = await this.db.session(async (conn) => {
      const clubs = await conn.query("SELECT pk_club_id AS clubId, ClubName AS clubName, ClubRotaryId AS clubRotaryId FROM club_master WHERE fk_district_id=@DistrictId AND isdeleted=0 AND IsActive=1 ORDER BY ClubName", p);
      const questions = await conn.query(
        `SELECT q.pk_id AS id, cc.category_name AS categoryName, a.activity_name AS activityName, q.points AS basePoints
         FROM district_citation_auto_question q
         INNER JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
         INNER JOIN district_citation_category cc ON cc.pk_id = q.fk_category_id
         WHERE q.fk_district_id=@DistrictId AND q.fk_year_id=@YearId AND q.isdeleted=0
         ORDER BY cc.sort_order, q.sort_order`,
        p,
      );
      const qIds = questions.map((q) => Number(q.id));
      const subs = qIds.length
        ? await conn.query(
            `SELECT pk_id AS id, fk_auto_question_id AS questionId, sub_item_type AS subItemType, sub_item_name AS subItemName
             FROM district_citation_auto_question_sub WHERE fk_auto_question_id IN @Ids AND isdeleted=0 ORDER BY sort_order`,
            { Ids: qIds },
          )
        : [];
      const manualSubs = await conn.query(
        `SELECT sc.pk_id AS id, cc.category_name AS categoryName, sc.sub_criteria_title AS title, sc.answer_type AS answerType
         FROM district_citation_manual_sub_criteria sc
         INNER JOIN district_citation_manual_criteria mc ON mc.pk_id = sc.fk_criteria_id
         INNER JOIN district_citation_category cc ON cc.pk_id = mc.fk_category_id
         WHERE mc.fk_district_id=@DistrictId AND mc.fk_year_id=@YearId AND mc.isdeleted=0 AND sc.isdeleted=0
         ORDER BY cc.sort_order, mc.sort_order, sc.sort_order`,
        p,
      );
      const entries = await conn.query(
        `SELECT fk_club_id AS clubId, entry_type AS entryType, fk_question_id AS questionId, fk_sub_question_id AS subQuestionId, answer_value AS answerValue,
                points_earned AS pointsEarned, bonus_earned AS bonusEarned
         FROM district_citation_club_entry WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND isdeleted=0`,
        p,
      );
      return { clubs, questions, subs, manualSubs, entries };
    });

    const columns = ["Club Name", "Club ID"];
    const autoKeys: { qId: number; subId: number | null }[] = [];
    for (const q of data.questions) {
      const qSubs = data.subs.filter((s) => Number(s.questionId) === Number(q.id));
      if (!qSubs.length || num(q.basePoints) > 0) {
        columns.push(String(q.activityName));
        autoKeys.push({ qId: Number(q.id), subId: null });
      }
      for (const s of qSubs) {
        columns.push(`${q.activityName} - ${s.subItemName ?? s.subItemType}`);
        autoKeys.push({ qId: Number(q.id), subId: Number(s.id) });
      }
    }
    const manualKeys = data.manualSubs.map((m) => Number(m.id));
    for (const m of data.manualSubs) columns.push(String(m.title));
    columns.push("Total Auto", "Total Manual", "Grand Total");

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Awards Report");
    ws.getCell(1, 1).value = "District Awards Report";
    ws.mergeCells(1, 1, 1, columns.length);
    style(ws.getCell(1, 1), { bold: true, size: 16, color: XLColor.White, fill: XLColor.DarkBlue, align: "center" });
    const groupRow = 3;
    const headerRow = 4;
    const autoStart = 3;
    const autoEnd = autoStart + autoKeys.length - 1;
    const manualStart = autoEnd + 1;
    const manualEnd = manualStart + manualKeys.length - 1;
    columns.forEach((name, c) => {
      const cell = ws.getCell(headerRow, c + 1);
      cell.value = name;
      const fill = c < 2 ? XLColor.DarkSlateGray : c < 2 + autoKeys.length ? XLColor.RoyalBlue : c < 2 + autoKeys.length + manualKeys.length ? XLColor.SeaGreen : XLColor.DarkOrange;
      style(cell, { bold: true, color: XLColor.White, align: "center", wrap: true, vAlign: "bottom", fill });
    });
    if (autoKeys.length) {
      ws.mergeCells(groupRow, autoStart, groupRow, autoEnd);
      ws.getCell(groupRow, autoStart).value = "AUTO POINTS";
      style(ws.getCell(groupRow, autoStart), { bold: true, color: XLColor.White, fill: XLColor.RoyalBlue, align: "center" });
    }
    if (manualKeys.length) {
      ws.mergeCells(groupRow, manualStart, groupRow, manualEnd);
      ws.getCell(groupRow, manualStart).value = "MANUAL POINTS";
      style(ws.getCell(groupRow, manualStart), { bold: true, color: XLColor.White, fill: XLColor.SeaGreen, align: "center" });
    }
    ws.getRow(groupRow).height = 25;
    let row = headerRow + 1;
    let rank = 1;
    for (const club of data.clubs) {
      const mine = data.entries.filter((e) => Number(e.clubId) === Number(club.clubId));
      ws.getCell(row, 1).value = club.clubName;
      ws.getCell(row, 2).value = club.clubRotaryId ?? "";
      let col = 3;
      let totalAuto = 0;
      for (const k of autoKeys) {
        const e = mine.find((x) => x.entryType === "auto" && Number(x.questionId) === k.qId && (k.subId === null ? x.subQuestionId === null : Number(x.subQuestionId) === k.subId));
        const pts = e ? num(e.pointsEarned) + num(e.bonusEarned) : 0;
        totalAuto += pts;
        ws.getCell(row, col).value = pts;
        style(ws.getCell(row, col), { align: "center", ...(pts > 0 ? { fill: XLColor.LightBlue } : {}) });
        col++;
      }
      let totalManual = 0;
      for (const id of manualKeys) {
        const e = mine.find((x) => x.entryType === "manual" && Number(x.questionId) === id);
        const pts = e ? num(e.pointsEarned) + num(e.bonusEarned) : 0;
        totalManual += pts;
        ws.getCell(row, col).value = pts;
        style(ws.getCell(row, col), { align: "center", ...(pts > 0 ? { fill: XLColor.LightGreen } : {}) });
        col++;
      }
      ws.getCell(row, col).value = totalAuto;
      style(ws.getCell(row, col++), { bold: true, fill: XLColor.LightSkyBlue, align: "center" });
      ws.getCell(row, col).value = totalManual;
      style(ws.getCell(row, col++), { bold: true, fill: XLColor.PaleGreen, align: "center" });
      ws.getCell(row, col).value = totalAuto + totalManual;
      style(ws.getCell(row, col), { bold: true, size: 12, fill: XLColor.Gold, align: "center" });
      if (rank % 2 === 0) styleRange(ws, row, 1, row, 2, { fill: XLColor.WhiteSmoke });
      rank++;
      row++;
    }
    thinBorders(ws, headerRow, 1, row - 1, columns.length);
    ws.getColumn(1).width = 25;
    ws.getColumn(2).width = 15;
    for (let c = 3; c <= columns.length; c++) ws.getColumn(c).width = 20;
    ws.getRow(headerRow).height = 60;
    ws.views = [{ state: "frozen", xSplit: 2, ySplit: headerRow }];
    return file(await toBuffer(wb), XLSX_CONTENT_TYPE, `citation_report_${districtId}_${yearId}.xlsx`);
  }

  @Get("api/district-modules/:districtId/citation/club-report/:clubId")
  async singleClubReport(@Param("districtId") d: string, @Param("clubId") c: string, @Query("yearId") y?: string) {
    const [districtId, clubId] = [paramInt(d, "districtId"), paramInt(c, "clubId")];
    const yearId = queryInt(y, 0);
    if (!(await isClubDrillReachable(this.db, clubId))) return statusCode(403, { message: CLUB_BLOCKED_MESSAGE });
    const p = { DistrictId: districtId, YearId: yearId, ClubId: clubId };
    const data = await this.db.session(async (conn) => {
      const club = await conn.queryFirstOrDefault("SELECT ClubName AS clubName, ClubRotaryId AS clubRotaryId FROM club_master WHERE pk_club_id=@Id AND isdeleted=0", { Id: clubId });
      if (!club) return null;
      const districtNumber = await conn.executeScalar<string>("SELECT DistrictNumber FROM district_master WHERE pk_district_id=@Id", { Id: districtId });
      const autoEntries = await conn.query(
        `SELECT e.fk_question_id AS questionId, e.fk_sub_question_id AS subQuestionId, e.answer_value AS count, e.points_earned AS pointsEarned, e.bonus_earned AS bonusEarned,
                cc.category_name AS categoryName, a.activity_name AS activityName, s.sub_item_name AS subItemName, s.sub_item_type AS subItemType
         FROM district_citation_club_entry e
         INNER JOIN district_citation_auto_question q ON q.pk_id = e.fk_question_id
         INNER JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
         INNER JOIN district_citation_category cc ON cc.pk_id = q.fk_category_id
         LEFT JOIN district_citation_auto_question_sub s ON s.pk_id = e.fk_sub_question_id AND s.isdeleted = 0
         WHERE e.fk_district_id=@DistrictId AND e.fk_year_id=@YearId AND e.fk_club_id=@ClubId AND e.entry_type='auto' AND e.isdeleted=0
           AND (e.fk_sub_question_id IS NULL OR s.pk_id IS NOT NULL)
         ORDER BY cc.sort_order, q.sort_order, s.sort_order`,
        p,
      );
      const manualEntries = await conn.query(
        `SELECT cc.category_name AS categoryName, sc.sub_criteria_title AS title, sc.answer_type AS answerType, e.answer_value AS answerValue,
                e.points_earned AS pointsEarned, e.bonus_earned AS bonusEarned
         FROM district_citation_club_entry e
         INNER JOIN district_citation_manual_sub_criteria sc ON sc.pk_id = e.fk_question_id AND sc.isdeleted = 0
         INNER JOIN district_citation_manual_criteria mc ON mc.pk_id = sc.fk_criteria_id AND mc.isdeleted = 0
         INNER JOIN district_citation_category cc ON cc.pk_id = mc.fk_category_id
         WHERE e.fk_district_id=@DistrictId AND e.fk_year_id=@YearId AND e.fk_club_id=@ClubId AND e.entry_type='manual' AND e.isdeleted=0
         ORDER BY cc.sort_order, mc.sort_order, sc.sort_order`,
        p,
      );
      const manualSubs = await conn.query(
        `SELECT sc.pk_id AS id, cc.category_name AS categoryName, sc.sub_criteria_title AS title, sc.answer_type AS answerType
         FROM district_citation_manual_sub_criteria sc
         INNER JOIN district_citation_manual_criteria mc ON mc.pk_id = sc.fk_criteria_id
         INNER JOIN district_citation_category cc ON cc.pk_id = mc.fk_category_id
         WHERE mc.fk_district_id=@DistrictId AND mc.fk_year_id=@YearId AND mc.isdeleted=0 AND sc.isdeleted=0
         ORDER BY cc.sort_order, mc.sort_order, sc.sort_order`,
        p,
      );
      return { club, districtNumber, autoEntries, manualEntries, manualSubs };
    });
    if (!data) return notFound({ message: "Club not found." });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Club Citation");
    const banner = (r: number, value: string, fill: string, size = 13) => {
      ws.mergeCells(r, 1, r, 6);
      ws.getCell(r, 1).value = value;
      style(ws.getCell(r, 1), { bold: true, size, color: XLColor.White, fill, align: "center" });
    };
    banner(1, `${data.club.clubName} - Citation Report`, XLColor.DarkBlue, 16);
    ws.mergeCells(2, 1, 2, 6);
    ws.getCell(2, 1).value = `District: ${data.districtNumber ?? ""} | Club ID: ${data.club.clubRotaryId ?? ""}`;
    style(ws.getCell(2, 1), { italic: true, align: "center" });
    let row = 4;
    banner(row++, "AUTO POINTS", XLColor.RoyalBlue);
    ["#", "Category", "Activity", "Sub Item", "Count", "Points"].forEach((h, i) => {
      ws.getCell(row, i + 1).value = h;
      style(ws.getCell(row, i + 1), { bold: true, fill: XLColor.LightSteelBlue, align: "center" });
    });
    row++;
    let totalAuto = 0;
    let idx = 1;
    for (const e of data.autoEntries) {
      ws.getCell(row, 1).value = idx++;
      ws.getCell(row, 2).value = e.categoryName;
      ws.getCell(row, 3).value = e.activityName;
      ws.getCell(row, 4).value = e.subItemName ?? "-";
      ws.getCell(row, 5).value = e.count ?? "0";
      style(ws.getCell(row, 5), { align: "center" });
      const pts = num(e.pointsEarned) + num(e.bonusEarned);
      ws.getCell(row, 6).value = pts;
      style(ws.getCell(row, 6), { align: "center", ...(pts > 0 ? { fill: XLColor.LightBlue } : {}) });
      totalAuto += pts;
      if (idx % 2 === 0) styleRange(ws, row, 1, row, 6, { fill: XLColor.AliceBlue });
      row++;
    }
    const totalLine = (label: string, value: number, fill: string, size?: number) => {
      ws.mergeCells(row, 1, row, 5);
      ws.getCell(row, 1).value = label;
      style(ws.getCell(row, 1), { bold: true, align: "right", ...(size ? { size, fill } : {}) });
      ws.getCell(row, 6).value = value;
      style(ws.getCell(row, 6), { bold: true, fill, align: "center", ...(size ? { size } : {}) });
    };
    totalLine("Total Auto Points", totalAuto, XLColor.LightSkyBlue);
    row += 2;
    banner(row++, "MANUAL POINTS", XLColor.SeaGreen);
    ["#", "Category", "Question", "Answer", "Type", "Points"].forEach((h, i) => {
      ws.getCell(row, i + 1).value = h;
      style(ws.getCell(row, i + 1), { bold: true, fill: XLColor.LightGreen, align: "center" });
    });
    row++;
    let totalManual = 0;
    idx = 1;
    for (const ms of data.manualSubs) {
      const e = data.manualEntries.find((x) => x.title === ms.title && x.categoryName === ms.categoryName);
      ws.getCell(row, 1).value = idx++;
      ws.getCell(row, 2).value = ms.categoryName;
      ws.getCell(row, 3).value = ms.title;
      ws.getCell(row, 4).value = e ? (e.answerValue ?? "0") : "0";
      style(ws.getCell(row, 4), { align: "center" });
      ws.getCell(row, 5).value = ms.answerType;
      const pts = e ? num(e.pointsEarned) + num(e.bonusEarned) : 0;
      ws.getCell(row, 6).value = pts;
      style(ws.getCell(row, 6), { align: "center", ...(pts > 0 ? { fill: XLColor.LightGreen } : {}) });
      totalManual += pts;
      if (idx % 2 === 0) styleRange(ws, row, 1, row, 6, { fill: XLColor.Honeydew });
      row++;
    }
    totalLine("Total Manual Points", totalManual, XLColor.PaleGreen);
    row += 2;
    totalLine("GRAND TOTAL", totalAuto + totalManual, XLColor.Gold, 14);
    [6, 22, 28, 20, 12, 12].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    thinBorders(ws, 5, 1, row, 6);
    return file(await toBuffer(wb), XLSX_CONTENT_TYPE, `citation_${String(data.club.clubName).replace(/ /g, "_")}_${yearId}.xlsx`);
  }

  @Get("api/district-modules/:districtId/citation/available-years")
  async availableYears(@Param("districtId") d: string) {
    const districtId = paramInt(d, "districtId");
    return (
      (await this.districtBlocked(districtId)) ??
      ok(
        await this.db.query(
          `SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
           FROM district_citation_category c INNER JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
           WHERE c.fk_district_id=@DistrictId AND c.isdeleted=0
           ORDER BY id DESC`,
          { DistrictId: districtId },
        ),
      )
    );
  }

  // ---- the club's citation screen ----

  @Get("api/clubs/:clubId/citation")
  async clubCitation(@Param("clubId") c: string, @Query("districtId") d?: string, @Query("yearId") y?: string) {
    const clubId = paramInt(c, "clubId");
    const districtId = queryInt(d, 0);
    const yearId = queryInt(y);
    if (!(await isClubDrillReachable(this.db, clubId))) return statusCode(403, { message: CLUB_BLOCKED_MESSAGE });
    return this.db.session(async (conn) => {
      const year =
        yearId !== null && yearId > 0
          ? await conn.queryFirstOrDefault("SELECT pk_year_id AS id, YearLabel, StartDate, EndDate FROM rotary_year_master WHERE pk_year_id = @Id AND isdeleted = 0 LIMIT 1", { Id: yearId })
          : await conn.queryFirstOrDefault("SELECT pk_year_id AS id, YearLabel, StartDate, EndDate FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
      if (!year) return ok({ yearId: 0, autoEntries: [], manualQuestions: [], totalAuto: 0, totalManual: 0, grandTotal: 0 });
      const p = { DistrictId: districtId, YearId: Number(year.id), ClubId: clubId };
      const desc = await conn.queryFirstOrDefault("SELECT description_html AS descriptionHtml FROM district_citation_description WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND isdeleted=0", p);
      const autoEntries = await conn.query(
        `SELECT e.pk_id AS id, e.fk_question_id AS questionId, e.fk_sub_question_id AS subQuestionId,
                CAST(ROUND(e.points_earned) AS SIGNED) AS pointsEarned, CAST(ROUND(e.bonus_earned) AS SIGNED) AS bonusEarned, e.answer_value AS answerValue,
                q.fk_category_id AS categoryId, cc.category_name AS categoryName, a.activity_name AS activityName, a.sub_type AS subType,
                CAST(ROUND(q.points) AS SIGNED) AS basePoints, q.is_bonus AS isBonus, CAST(ROUND(q.bonus_points) AS SIGNED) AS bonusPoints,
                q.min_bonus AS minBonus, q.max_bonus AS maxBonus, s.sub_item_type AS subItemType, s.sub_item_name AS subItemName, s.sub_item_id AS subItemId,
                CAST(ROUND(s.points) AS SIGNED) AS subBasePoints, s.is_bonus AS subIsBonus, CAST(ROUND(s.bonus_points) AS SIGNED) AS subBonusPoints,
                CASE
                    WHEN COALESCE(s.sub_item_name, '') <> ''
                         AND LOWER(TRIM(COALESCE(
                             CASE WHEN LOWER(s.sub_item_type) = 'area_of_focus' THEN aof_only.name
                                  WHEN LOWER(s.sub_item_type) = 'category' THEN cat_only.name
                                  WHEN LOWER(s.sub_item_type) IN ('sub_category', 'subcategory') THEN sub_only.name
                             END, ''))) <> LOWER(TRIM(s.sub_item_name))
                        THEN s.sub_item_name
                    WHEN LOWER(s.sub_item_type) = 'area_of_focus' THEN COALESCE(aof_only.name, s.sub_item_name)
                    WHEN LOWER(s.sub_item_type) = 'category' THEN CONCAT(COALESCE(aof_for_cat.name, '?'), ' → ', COALESCE(cat_only.name, s.sub_item_name))
                    WHEN LOWER(s.sub_item_type) IN ('sub_category', 'subcategory') THEN CONCAT(COALESCE(aof_for_sub.name, '?'), ' → ', COALESCE(cat_for_sub.name, '?'), ' → ', COALESCE(sub_only.name, s.sub_item_name))
                    ELSE s.sub_item_name
                END AS subItemDisplay
         FROM district_citation_club_entry e
         INNER JOIN district_citation_auto_question q ON q.pk_id = e.fk_question_id
         INNER JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
         INNER JOIN district_citation_category cc ON cc.pk_id = q.fk_category_id
         LEFT JOIN district_citation_auto_question_sub s ON s.pk_id = e.fk_sub_question_id AND s.isdeleted = 0
         LEFT JOIN area_of_focus_master aof_only ON LOWER(s.sub_item_type) = 'area_of_focus' AND aof_only.pk_area_of_focus_id = s.sub_item_id
         LEFT JOIN category_master cat_only ON LOWER(s.sub_item_type) = 'category' AND cat_only.pk_category_id = s.sub_item_id
         LEFT JOIN area_of_focus_master aof_for_cat ON LOWER(s.sub_item_type) = 'category' AND aof_for_cat.pk_area_of_focus_id = cat_only.fk_area_of_focus_id
         LEFT JOIN sub_category_master sub_only ON LOWER(s.sub_item_type) IN ('sub_category', 'subcategory') AND sub_only.pk_sub_category_id = s.sub_item_id
         LEFT JOIN category_master cat_for_sub ON LOWER(s.sub_item_type) IN ('sub_category', 'subcategory') AND cat_for_sub.pk_category_id = sub_only.fk_category_id
         LEFT JOIN area_of_focus_master aof_for_sub ON LOWER(s.sub_item_type) IN ('sub_category', 'subcategory') AND aof_for_sub.pk_area_of_focus_id = cat_for_sub.fk_area_of_focus_id
         WHERE e.fk_district_id=@DistrictId AND e.fk_year_id=@YearId AND e.fk_club_id=@ClubId AND e.entry_type='auto' AND e.isdeleted=0
           AND (e.fk_sub_question_id IS NULL OR s.pk_id IS NOT NULL)
         ORDER BY cc.sort_order, q.sort_order, s.sort_order`,
        p,
      );
      const criteria = await conn.query(
        `SELECT mc.pk_id AS criteriaId, mc.fk_category_id AS categoryId, cc.category_name AS categoryName, mc.sort_order AS sortOrder
         FROM district_citation_manual_criteria mc INNER JOIN district_citation_category cc ON cc.pk_id = mc.fk_category_id
         WHERE mc.fk_district_id=@DistrictId AND mc.fk_year_id=@YearId AND mc.isdeleted=0
         ORDER BY cc.sort_order, mc.sort_order`,
        p,
      );
      const mcIds = criteria.map((x) => Number(x.criteriaId));
      const subs: Row[] = mcIds.length
        ? await conn.query(
            `SELECT sc.pk_id AS id, sc.fk_criteria_id AS criteriaId, sc.sub_criteria_title AS title, sc.answer_type AS answerType,
                    CAST(ROUND(sc.points) AS SIGNED) AS points, sc.is_bonus AS isBonus, CAST(ROUND(sc.bonus_points) AS SIGNED) AS bonusPoints,
                    sc.min_bonus AS minBonus, sc.max_bonus AS maxBonus, sc.remark
             FROM district_citation_manual_sub_criteria sc WHERE sc.fk_criteria_id IN @Ids AND sc.isdeleted=0 ORDER BY sc.sort_order`,
            { Ids: mcIds },
          )
        : [];
      const subIds = subs.map((s) => Number(s.id));
      const options = subIds.length
        ? await conn.query(
            `SELECT pk_id AS id, fk_sub_criteria_id AS subCriteriaId, option_text AS optionText, CAST(ROUND(option_points) AS SIGNED) AS optionPoints
             FROM district_citation_manual_sub_criteria_option WHERE fk_sub_criteria_id IN @Ids AND isdeleted=0 ORDER BY sort_order`,
            { Ids: subIds },
          )
        : [];
      const manualEntries = new Map(
        (subIds.length
          ? await conn.query(
              `SELECT fk_question_id AS subCriteriaId, answer_value AS answerValue, CAST(ROUND(points_earned) AS SIGNED) AS pointsEarned,
                      CAST(ROUND(bonus_earned) AS SIGNED) AS bonusEarned
               FROM district_citation_club_entry
               WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND fk_club_id=@ClubId AND entry_type='manual' AND fk_question_id IN @Ids AND isdeleted=0`,
              { ...p, Ids: subIds },
            )
          : []
        ).map((e) => [Number(e.subCriteriaId), e]),
      );
      for (const s of subs) {
        s.options = options.filter((o) => Number(o.subCriteriaId) === Number(s.id));
        const e = manualEntries.get(Number(s.id));
        s.answerValue = e ? (e.answerValue ?? null) : null;
        s.pointsEarned = e ? int(e.pointsEarned) : 0;
        s.bonusEarned = e ? int(e.bonusEarned) : 0;
      }
      for (const m of criteria) m.subCriteria = subs.filter((s) => Number(s.criteriaId) === Number(m.criteriaId));
      const totalAuto = autoEntries.reduce((t, e) => t + int(e.pointsEarned) + int(e.bonusEarned), 0);
      const totalManual = subs.reduce((t, s) => t + int(s.pointsEarned) + int(s.bonusEarned), 0);
      return ok({
        yearId: Number(year.id), yearLabel: year.YearLabel, descriptionHtml: desc ? (desc.descriptionHtml ?? null) : null, autoEntries, manualQuestions: criteria,
        totalAuto, totalManual, grandTotal: totalAuto + totalManual,
      });
    });
  }

  @Post("api/clubs/:clubId/citation/save-manual")
  async saveManual(@Param("clubId") c: string, @Body() body: unknown, @User() u: CurrentUser) {
    const clubId = paramInt(c, "clubId");
    const entries = Array.isArray(body) ? (body as Record<string, unknown>[]) : [];
    if (!entries.length) return ok({ message: "Nothing to save." });
    return this.db.session(async (conn) => {
      const year = await conn.queryFirstOrDefault("SELECT pk_year_id AS id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
      if (!year) return badRequest({ message: "No current year." });
      const yearId = Number(year.id);
      const districtId = int(f(entries[0], "districtId"));
      if (!(await isDistrictAwardsEnabled(conn, districtId, yearId))) {
        return statusCode(403, { message: "District Awards is currently disabled by the administrator. Point entry is read-only." });
      }
      for (const e of entries) {
        const qId = int(f(e, "subCriteriaId"));
        const values = { Answer: text(e, "answerValue"), Points: num(f(e, "pointsEarned")), Bonus: num(f(e, "bonusEarned")), UserId: this.userId(u) };
        const existing = await conn.executeScalar(
          `SELECT pk_id FROM district_citation_club_entry
           WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND fk_club_id=@ClubId AND entry_type='manual' AND fk_question_id=@QId AND isdeleted=0`,
          { DistrictId: districtId, YearId: yearId, ClubId: clubId, QId: qId },
        );
        if (existing !== null && existing !== undefined) {
          await conn.execute("UPDATE district_citation_club_entry SET answer_value=@Answer, points_earned=@Points, bonus_earned=@Bonus, modified_by=@UserId, modified_date=NOW() WHERE pk_id=@Id", { ...values, Id: existing });
        } else {
          await conn.execute(
            `INSERT INTO district_citation_club_entry (fk_district_id, fk_year_id, fk_club_id, entry_type, fk_question_id, answer_value, points_earned, bonus_earned, created_by, created_date)
             VALUES (@DistrictId, @YearId, @ClubId, 'manual', @QId, @Answer, @Points, @Bonus, @UserId, NOW())`,
            { ...values, DistrictId: districtId, YearId: yearId, ClubId: clubId, QId: qId },
          );
        }
      }
      return ok({ message: "Manual entries saved." });
    });
  }

  @Post("api/clubs/:clubId/citation/refresh-auto")
  async refreshAuto(@Param("clubId") c: string, @Query("districtId") d?: string) {
    const clubId = paramInt(c, "clubId");
    await this.autoPoints.calculateForClub(queryInt(d, 0), clubId);
    return ok({ message: "Auto points refreshed." });
  }
}

