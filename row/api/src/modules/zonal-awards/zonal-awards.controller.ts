import { Body, Controller, Get, Param, Post, Query, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, file, notFound, ok, statusCode } from "../../common/results";
import { bodyField, paramInt, queryInt } from "../../common/binding";
import { DISTRICT_BLOCKED_MESSAGE, isDistrictDrillReachable } from "../../services/kill-switch.helper";
import type { UploadedFile } from "../../services/media-storage";
import { ExcelJS, XLSX_CONTENT_TYPE, style, styleRange, thinBorders, toBuffer } from "../../services/xlsx";
import { ZonalAwardsAutoCalculationService } from "./zonal-awards-auto-calc.service";

const NAVY = "FF003366";
const AUTO_FILL = "FFDBEAFE";
const MANUAL_FILL = "FFDCFCE7";
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v) || 0);
/** Foundation questions scored per unit rather than per band. */
const PER_COUNT_QSORTS = new Set([40, 42, 43, 45, 46, 48, 50, 51, 52]);
const MONTHS: [number, string][] = [[7, "Jul"], [8, "Aug"], [9, "Sep"], [10, "Oct"], [11, "Nov"], [12, "Dec"], [1, "Jan"], [2, "Feb"], [3, "Mar"], [4, "Apr"], [5, "May"], [6, "Jun"]];

/** AdjustToContents, approximately: each column as wide as its longest text. */
function autoFit(ws: ExcelJS.Worksheet, from: number, to: number) {
  for (let c = from; c <= to; c++) {
    let max = 8;
    ws.getColumn(c).eachCell({ includeEmpty: false }, (cell) => {
      max = Math.max(max, String(cell.text ?? "").length + 2);
    });
    ws.getColumn(c).width = max;
  }
}
const clampWidth = (ws: ExcelJS.Worksheet, c: number, min: number, max: number) => {
  ws.getColumn(c).width = Math.min(Math.max(ws.getColumn(c).width ?? min, min), max);
};

/** Port of the zonal-awards endpoints of DistrictModulesController.cs (the zones' district competition). */
@Controller()
@Authorize()
export class ZonalAwardsController {
  constructor(
    private readonly db: Db,
    private readonly autoCalc: ZonalAwardsAutoCalculationService,
  ) {}

  private userId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);
  private isSuper = (u: CurrentUser) => (u.findFirst("roles") ?? "").split(",").some((r) => r.trim().toLowerCase() === "superadmin");

  private static goals = (conn: DbCommands, y: number) =>
    conn.query("SELECT pk_id AS id, title, max_points AS maxPoints, max_remark AS maxRemark, sort_order AS sortOrder FROM zonal_awards_goal WHERE fk_year_id=@Y AND isdeleted=0 ORDER BY sort_order", { Y: y });
  private static options = (conn: DbCommands, y: number) =>
    conn.query(
      `SELECT o.pk_id AS id, o.fk_question_id AS questionId, o.goal_requirement_label AS label, o.points_label AS pointsLabel, o.mini, o.maxi, o.points, o.atleast,
              o.subtype, o.input_type AS inputType, o.question_type_for_import AS importType, o.sort_order AS sortOrder
       FROM zonal_awards_question_option o
       JOIN zonal_awards_question q ON q.pk_id=o.fk_question_id
       JOIN zonal_awards_goal g ON g.pk_id=q.fk_goal_id
       WHERE g.fk_year_id=@Y AND o.isdeleted=0 ORDER BY o.fk_question_id, o.sort_order`,
      { Y: y },
    );

  @Get("api/zonal-awards/questions")
  async questions(@Query("yearId") y?: string) {
    const yearId = queryInt(y, 0);
    return this.db.session(async (conn) =>
      ok({
        goals: await ZonalAwardsController.goals(conn, yearId),
        questions: await conn.query(
          `SELECT q.pk_id AS id, q.fk_goal_id AS goalId, q.auto_or_manual AS autoOrManual, q.sr_no AS srNo, q.sub_title AS subTitle, q.category, q.sort_order AS sortOrder
           FROM zonal_awards_question q JOIN zonal_awards_goal g ON g.pk_id=q.fk_goal_id
           WHERE g.fk_year_id=@Y AND q.isdeleted=0 ORDER BY q.sort_order`,
          { Y: yearId },
        ),
        options: await ZonalAwardsController.options(conn, yearId),
      }),
    );
  }

  @Get("api/zonal-awards/available-years")
  async years() {
    return ok(
      await this.db.query(
        `SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS label, y.IsCurrent AS isCurrent
         FROM zonal_awards_goal g JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
         WHERE g.isdeleted = 0 ORDER BY y.pk_year_id DESC`,
      ),
    );
  }

  @Get("api/districts/:districtId/zonal-awards")
  async districtAwards(@Param("districtId") d: string, @Query("yearId") y?: string) {
    const districtId = paramInt(d, "districtId");
    const yearId = queryInt(y, 0);
    if (!(await isDistrictDrillReachable(this.db, districtId))) return statusCode(403, { message: DISTRICT_BLOCKED_MESSAGE });
    const currentYearId = await this.db.executeScalar("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent=1 LIMIT 1");
    if (currentYearId !== null && currentYearId !== undefined && yearId === Number(currentYearId)) {
      await this.autoCalc.calculateForDistrict(districtId, yearId).catch(() => undefined); // never blocks the page
    }
    return this.db.session(async (conn) => {
      const entries = await conn.query(
        `SELECT fk_option_id AS optionId, entered_counts AS enteredCounts, received_points AS receivedPoints
         FROM zonal_awards_district_entry WHERE fk_district_id=@DId AND fk_year_id=@YId AND month=0 AND isdeleted=0`,
        { DId: districtId, YId: yearId },
      );
      const enabled = await conn.executeScalar(
        `SELECT z.IsZonalAwardsEnabled FROM zone_master z JOIN district_master d ON d.fk_zone_id = z.pk_zone_id
         WHERE d.pk_district_id = @DId AND d.isdeleted = 0 AND z.isdeleted = 0`,
        { DId: districtId },
      );
      return ok({
        goals: await ZonalAwardsController.goals(conn, yearId),
        questions: await conn.query(
          `SELECT q.pk_id AS id, q.fk_goal_id AS goalId, q.auto_or_manual AS autoOrManual, COALESCE(q.question_level, 'District') AS questionLevel,
                  q.sr_no AS srNo, q.sub_title AS subTitle, q.category, q.sort_order AS sortOrder
           FROM zonal_awards_question q JOIN zonal_awards_goal g ON g.pk_id=q.fk_goal_id
           WHERE g.fk_year_id=@Y AND q.isdeleted=0 ORDER BY q.sort_order`,
          { Y: yearId },
        ),
        options: await ZonalAwardsController.options(conn, yearId),
        // Dictionary<int, entry>: a JSON object keyed by option id.
        entries: Object.fromEntries(entries.map((e) => [String(e.optionId), e])),
        yearLabel: (await conn.executeScalar<string>("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id=@Y", { Y: yearId })) ?? null,
        isCurrentYear: currentYearId !== null && currentYearId !== undefined && yearId === Number(currentYearId),
        isZonalAwardsEnabled: enabled === true || Number(enabled) === 1,
      });
    });
  }

  /** Re-sums an option's monthly rows into its year row (month 0). */
  private static async rollUp(conn: DbCommands, optionId: number, districtId: number, yearId: number, userId: number) {
    const p = { OId: optionId, DId: districtId, YId: yearId };
    const counts = num(await conn.executeScalar("SELECT COALESCE(SUM(entered_counts), 0) FROM zonal_awards_district_entry WHERE fk_option_id=@OId AND fk_district_id=@DId AND fk_year_id=@YId AND month > 0 AND isdeleted=0", p));
    const points = num(await conn.executeScalar("SELECT COALESCE(SUM(received_points), 0) FROM zonal_awards_district_entry WHERE fk_option_id=@OId AND fk_district_id=@DId AND fk_year_id=@YId AND month > 0 AND isdeleted=0", p));
    await conn.execute(
      `INSERT INTO zonal_awards_district_entry (fk_option_id, fk_district_id, fk_year_id, month, entered_counts, received_points, created_by)
       VALUES (@OId, @DId, @YId, 0, @Counts, @Pts, @UserId)
       ON DUPLICATE KEY UPDATE entered_counts=@Counts, received_points=@Pts, modified_by=@UserId`,
      { ...p, Counts: counts, Pts: points, UserId: userId },
    );
  }

  private static upsertMonth(conn: DbCommands, optionId: number, districtId: number, yearId: number, month: number, counts: number, points: number, userId: number) {
    return conn.execute(
      `INSERT INTO zonal_awards_district_entry (fk_option_id, fk_district_id, fk_year_id, month, entered_counts, received_points, created_by)
       VALUES (@OId, @DId, @YId, @Month, @Counts, @Pts, @UserId)
       ON DUPLICATE KEY UPDATE entered_counts=@Counts, received_points=@Pts, modified_by=@UserId`,
      { OId: optionId, DId: districtId, YId: yearId, Month: month, Counts: counts, Pts: points, UserId: userId },
    );
  }

  @Post("api/districts/:districtId/zonal-awards/save-manual")
  async saveManual(@Param("districtId") d: string, @Body() body: unknown, @User() u: CurrentUser, @Query("yearId") y?: string) {
    const districtId = paramInt(d, "districtId");
    const yearId = queryInt(y, 0);
    const entries = Array.isArray(body) ? (body as Record<string, unknown>[]) : [];
    return this.db.session(async (conn) => {
      const month = new Date().getUTCMonth() + 1;
      const currentYearId = await conn.executeScalar("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
      if (!this.isSuper(u) && yearId !== Number(currentYearId)) return statusCode(403, { message: "Only SuperAdmin can edit past year data." });
      if (!entries.length) return badRequest({ message: "No entries to save." });
      for (const e of entries) {
        const optionId = Math.trunc(num(bodyField(e, "optionId")));
        await ZonalAwardsController.upsertMonth(conn, optionId, districtId, yearId, month, num(bodyField(e, "enteredCounts")), num(bodyField(e, "receivedPoints")), this.userId(u));
        await ZonalAwardsController.rollUp(conn, optionId, districtId, yearId, this.userId(u));
      }
      return ok({ message: `Manual entries saved (${entries.length} options).` });
    });
  }

  /** The Foundation (goal 12) monthly import: one row per question band, one column per district number. */
  @Post("api/zonal-awards/import")
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 55 * 1024 * 1024 } }))
  async importAuto(@Body() body: unknown, @UploadedFiles() files: UploadedFile[] | undefined, @User() u: CurrentUser) {
    const upload = (files ?? []).find((f) => (f as UploadedFile & { fieldname?: string }).fieldname?.toLowerCase() === "file");
    const yearId = Math.trunc(num(bodyField(body, "yearId")));
    const month = Math.trunc(num(bodyField(body, "month")));
    if (!upload || upload.size === 0) return badRequest({ message: "No file uploaded." });
    if (month < 1 || month > 12) return badRequest({ message: "Invalid month." });
    const userId = this.userId(u);
    return this.db.session(async (conn) => {
      const opts = await conn.query(
        `SELECT q.sort_order AS qSort, q.sr_no AS srNo, q.category AS question, o.pk_id AS optionId, o.goal_requirement_label AS optionLabel, o.points_label AS pointsLabel,
                o.mini, o.maxi, o.points, o.subtype, o.input_type AS inputType, o.sort_order AS oSort
         FROM zonal_awards_question_option o
         JOIN zonal_awards_question q ON q.pk_id = o.fk_question_id
         JOIN zonal_awards_goal g ON g.pk_id = q.fk_goal_id
         WHERE g.fk_year_id = @Y AND g.sort_order = 12 AND o.isdeleted = 0 AND q.isdeleted = 0
         ORDER BY q.sort_order, o.subtype, o.sort_order`,
        { Y: yearId },
      );
      const byRowKey = new Map<string, Row[]>();
      for (const o of opts) {
        const key = `${Number(o.qSort)}-${o.subtype === null ? 0 : Number(o.subtype)}`;
        if (!byRowKey.has(key)) byRowKey.set(key, []);
        byRowKey.get(key)!.push(o);
      }
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(upload.buffer as unknown as ArrayBuffer);
      const ws = wb.worksheets[0];
      const districtNumbers = new Map(
        (
          await conn.query(
            "SELECT d.pk_district_id AS id, d.DistrictNumber AS districtNumber FROM district_master d INNER JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id WHERE d.isdeleted = 0 AND z.isdeleted = 0",
          )
        ).map((r) => [String(r.districtNumber), Number(r.id)]),
      );
      const text = (r: number, c: number) => String(ws.getRow(r).getCell(c).text ?? "").trim();
      const districtColumns = new Map<number, number>();
      for (let col = 5; col <= Math.max(ws.columnCount, 4); col++) {
        const id = districtNumbers.get(text(1, col));
        if (text(1, col) && id !== undefined) districtColumns.set(col, id);
      }
      if (!districtColumns.size) return badRequest({ message: "No matching districts found in the Excel headers." });
      let rowsProcessed = 0;
      let cellsProcessed = 0;
      for (let row = 2; row <= ws.rowCount; row++) {
        const sub = byRowKey.get(text(row, 2));
        if (!text(row, 2) || !sub) continue;
        const qSort = Number(sub[0].qSort);
        const isYesNo = String(sub[0].inputType ?? "").toLowerCase() === "yes/no" || sub.some((o) => String(o.optionLabel ?? "").toLowerCase() === "no");
        const perCount = PER_COUNT_QSORTS.has(qSort) && !isYesNo;
        rowsProcessed++;
        for (const [col, districtId] of districtColumns) {
          const cell = text(row, col);
          if (!cell) continue;
          let value = 0;
          let yes = false;
          let explicitZero = false;
          if (isYesNo) {
            const v = cell.toLowerCase();
            if (["yes", "1", "true", "y"].includes(v)) yes = true;
            else if (!["no", "0", "false", "n"].includes(v)) continue;
          } else {
            value = Number(cell.replace(/,/g, ""));
            if (!Number.isFinite(value)) continue;
            if (value === 0) explicitZero = true;
          }
          let matched: Row | null = null;
          if (isYesNo) {
            matched = yes ? (sub.find((o) => String(o.optionLabel ?? "").toLowerCase() !== "no") ?? sub[0]) : (sub.find((o) => String(o.optionLabel ?? "").toLowerCase() === "no") ?? null);
          } else {
            for (const o of sub) {
              const [mini, maxi] = [Number(o.mini), Number(o.maxi)];
              if (mini === 0 && maxi === 0) continue;
              if (value >= mini && value <= maxi && (!matched || mini >= Number(matched.mini))) matched = o;
            }
          }
          await conn.execute(
            "UPDATE zonal_awards_district_entry SET entered_counts = 0, received_points = 0, modified_by = @UserId WHERE fk_option_id IN @OIds AND fk_district_id = @DId AND fk_year_id = @YId AND month = @Month",
            { OIds: sub.map((o) => Number(o.optionId)), DId: districtId, YId: yearId, Month: month, UserId: userId },
          );
          if (matched && !explicitZero && !(isYesNo && !yes)) {
            const [counts, points] = isYesNo ? [1, num(matched.points)] : perCount ? [value, value * num(matched.points)] : [value, num(matched.points)];
            await ZonalAwardsController.upsertMonth(conn, Number(matched.optionId), districtId, yearId, month, counts, points, userId);
          }
          for (const o of sub) await ZonalAwardsController.rollUp(conn, Number(o.optionId), districtId, yearId, userId);
          cellsProcessed++;
        }
      }
      await conn.execute(
        "INSERT INTO zonal_awards_import_log (fk_year_id, month, file_name, total_districts, total_questions, uploaded_by) VALUES (@YId, @Month, @FileName, @TotalDist, @TotalQ, @UserId)",
        { YId: yearId, Month: month, FileName: upload.originalname, TotalDist: districtColumns.size, TotalQ: rowsProcessed, UserId: userId },
      );
      return ok({
        message: `Imported ${rowsProcessed} Foundation rows × ${districtColumns.size} districts (${cellsProcessed} cells).`,
        rowsProcessed, totalDistricts: districtColumns.size, cellsProcessed,
      });
    });
  }

  @Get("api/zonal-awards/sample-excel")
  async sampleExcel(@Query("yearId") y?: string) {
    const yearId = queryInt(y, 0);
    const { opts, districts } = await this.db.session(async (conn) => ({
      opts: await conn.query(
        `SELECT q.pk_id AS questionId, q.sort_order AS qSort, q.sr_no AS srNo, q.category AS question, o.pk_id AS optionId, o.goal_requirement_label AS optionLabel,
                o.points_label AS pointsLabel, o.mini, o.maxi, o.points, o.subtype, o.input_type AS inputType, o.question_type_for_import AS importType, o.sort_order AS oSort
         FROM zonal_awards_question_option o
         JOIN zonal_awards_question q ON q.pk_id = o.fk_question_id
         JOIN zonal_awards_goal g ON g.pk_id = q.fk_goal_id
         WHERE g.fk_year_id = @Y AND g.sort_order = 12 AND o.isdeleted = 0 AND q.isdeleted = 0
         ORDER BY q.sort_order, o.subtype, o.sort_order`,
        { Y: yearId },
      ),
      districts: await conn.query(
        `SELECT d.pk_district_id AS id, d.DistrictNumber FROM district_master d INNER JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
         WHERE d.isdeleted = 0 AND z.isdeleted = 0 ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber`,
      ),
    }));
    const groups = new Map<string, Row[]>();
    for (const o of opts) {
      const key = `${Number(o.questionId)}|${o.subtype === null ? 0 : Number(o.subtype)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(o);
    }
    const rows = [...groups.entries()]
      .map(([key, list]) => {
        const first = list[0];
        const qSort = Number(first.qSort);
        const subType = Number(key.split("|")[1]);
        const isYesNo = String(first.inputType ?? "").toLowerCase() === "yes/no" || list.some((o) => String(o.optionLabel ?? "").toLowerCase() === "no");
        let label: string;
        let inputLabel: string;
        if (subType === 1 || list.every((o) => !o.importType)) {
          label = String(first.question ?? "");
          inputLabel = "Count";
        } else {
          label = String(first.importType ?? first.question ?? "");
          inputLabel = isYesNo ? "Yes/No" : "Count";
        }
        if (qSort === 47 && (subType === 1 || subType === 2)) inputLabel = "Amount";
        if (qSort === 44 && subType === 1) inputLabel = "Count";
        const srNo = String(first.srNo ?? "");
        return { qSort, subType, displaySr: subType <= 1 ? srNo : `${srNo}.${String.fromCharCode(97 + subType - 1)}`, label, inputLabel, rowKey: `${qSort}-${subType}` };
      })
      .sort((a, b) => a.qSort - b.qSort || a.subType - b.subType);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Foundation Import");
    ["Sr", "RowKey", "Foundation Question", "Input Type"].forEach((h, i) => (ws.getCell(1, i + 1).value = h));
    districts.forEach((d, i) => (ws.getCell(1, 5 + i).value = String(d.DistrictNumber)));
    const lastCol = 4 + districts.length;
    styleRange(ws, 1, 1, 1, lastCol, { bold: true, fill: NAVY, color: "FFFFFFFF", align: "center" });
    rows.forEach((r, i) => {
      ws.getCell(2 + i, 1).value = r.displaySr;
      ws.getCell(2 + i, 2).value = r.rowKey;
      ws.getCell(2 + i, 3).value = r.label;
      ws.getCell(2 + i, 4).value = r.inputLabel;
    });
    autoFit(ws, 1, lastCol);
    ws.getColumn(2).hidden = true;
    ws.getColumn(3).width = Math.min(ws.getColumn(3).width ?? 50, 50);
    ws.views = [{ state: "frozen", xSplit: 4, ySplit: 1 }];
    return file(await toBuffer(wb), XLSX_CONTENT_TYPE, `zonal_awards_foundation_sample_${yearId}.xlsx`);
  }

  @Get("api/zones/:zoneId/zone-awards")
  async zoneAwards(@Param("zoneId") z: string, @Query("yearId") y?: string) {
    const zoneId = paramInt(z, "zoneId");
    const yearId = queryInt(y, 0);
    return this.db.session(async (conn) => {
      const zone = await conn.queryFirstOrDefault("SELECT pk_zone_id AS id, ZoneName FROM zone_master WHERE pk_zone_id = @Z AND isdeleted = 0", { Z: zoneId });
      if (!zone) return notFound({ message: "Zone not found." });
      const questions = await conn.query(
        `SELECT q.pk_id AS id, q.sr_no AS srNo, q.category, q.question_level AS level
         FROM zonal_awards_question q JOIN zonal_awards_goal g ON g.pk_id = q.fk_goal_id
         WHERE g.fk_year_id = @Y AND q.question_level = 'Zone' AND q.isdeleted = 0 ORDER BY q.sort_order`,
        { Y: yearId },
      );
      const qIds = questions.map((q) => Number(q.id));
      const options = qIds.length
        ? await conn.query(
            `SELECT pk_id AS id, fk_question_id AS questionId, goal_requirement_label AS label, points_label AS pointsLabel, points, sort_order AS sortOrder
             FROM zonal_awards_question_option WHERE fk_question_id IN @Ids AND isdeleted = 0 ORDER BY fk_question_id, sort_order`,
            { Ids: qIds },
          )
        : [];
      const districts = await conn.query("SELECT pk_district_id AS id, DistrictNumber FROM district_master WHERE fk_zone_id = @Z AND isdeleted = 0 ORDER BY CAST(DistrictNumber AS UNSIGNED), DistrictNumber", { Z: zoneId });
      const districtIds = districts.map((d) => Number(d.id));
      const optIds = options.map((o) => Number(o.id));
      const selections =
        districtIds.length && optIds.length
          ? await conn.query(
              `SELECT fk_option_id AS optionId, fk_district_id AS districtId, entered_counts AS enteredCounts, received_points AS receivedPoints
               FROM zonal_awards_district_entry
               WHERE fk_option_id IN @Opts AND fk_district_id IN @Districts AND fk_year_id = @Y AND month = 0 AND isdeleted = 0 AND entered_counts > 0`,
              { Opts: optIds, Districts: districtIds, Y: yearId },
            )
          : [];
      const totals = new Map(districtIds.map((id) => [id, 0]));
      for (const s of selections) totals.set(Number(s.districtId), (totals.get(Number(s.districtId)) ?? 0) + num(s.receivedPoints));
      return ok({ zone, questions, options, districts, selections, districtTotals: [...totals.entries()].map(([districtId, totalPoints]) => ({ districtId, totalPoints })) });
    });
  }

  @Post("api/zones/:zoneId/zone-awards/save")
  async saveZoneAwards(@Param("zoneId") z: string, @Body() body: unknown, @User() u: CurrentUser, @Query("yearId") y?: string) {
    const zoneId = paramInt(z, "zoneId");
    const yearId = queryInt(y, 0);
    if (!Array.isArray(body)) return badRequest({ message: "No entries supplied." });
    if (!this.isSuper(u)) return statusCode(403, { message: "Only SuperAdmin can edit zone awards." });
    return this.db.session(async (conn) => {
      if ((await conn.executeScalar("SELECT pk_zone_id FROM zone_master WHERE pk_zone_id = @Z AND isdeleted = 0", { Z: zoneId })) === null) return notFound({ message: "Zone not found." });
      const zoneDistricts = (await conn.query("SELECT pk_district_id AS id FROM district_master WHERE fk_zone_id = @Z AND isdeleted = 0", { Z: zoneId })).map((r) => Number(r.id));
      const valid = new Map(
        (
          await conn.query(
            `SELECT o.pk_id AS id, o.points FROM zonal_awards_question_option o
             JOIN zonal_awards_question q ON q.pk_id = o.fk_question_id JOIN zonal_awards_goal g ON g.pk_id = q.fk_goal_id
             WHERE g.fk_year_id = @Y AND q.question_level = 'Zone' AND o.isdeleted = 0`,
            { Y: yearId },
          )
        ).map((o) => [Number(o.id), num(o.points)]),
      );
      let updated = 0;
      for (const e of body as Record<string, unknown>[]) {
        const optionId = Math.trunc(num(bodyField(e, "optionId")));
        const dRaw = bodyField(e, "districtId");
        const districtId = dRaw === null || dRaw === undefined ? null : Math.trunc(Number(dRaw));
        if (!valid.has(optionId)) continue;
        if (zoneDistricts.length) {
          await conn.execute(
            "UPDATE zonal_awards_district_entry SET entered_counts = 0, received_points = 0, modified_by = @UserId WHERE fk_option_id = @OId AND fk_district_id IN @Districts AND fk_year_id = @YId AND month = 0",
            { OId: optionId, Districts: zoneDistricts, YId: yearId, UserId: this.userId(u) },
          );
        }
        if (districtId !== null && zoneDistricts.includes(districtId)) {
          await conn.execute(
            `INSERT INTO zonal_awards_district_entry (fk_option_id, fk_district_id, fk_year_id, month, entered_counts, received_points, created_by)
             VALUES (@OId, @DId, @YId, 0, 1, @Pts, @UserId)
             ON DUPLICATE KEY UPDATE entered_counts = 1, received_points = @Pts, modified_by = @UserId`,
            { OId: optionId, DId: districtId, YId: yearId, Pts: valid.get(optionId), UserId: this.userId(u) },
          );
        }
        updated++;
      }
      return ok({ message: `Zone awards saved (${updated} options).`, updated });
    });
  }

  @Get("api/zonal-awards/export-structure/excel")
  async exportStructure(@Query("yearId") y?: string) {
    const yearId = queryInt(y, 0);
    const data = await this.db.session(async (conn) => ({
      yearLabel: (await conn.executeScalar<string>("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @Y", { Y: yearId })) ?? `Year ${yearId}`,
      goals: await ZonalAwardsController.goals(conn, yearId),
      questions: await conn.query(
        `SELECT q.pk_id AS id, q.fk_goal_id AS goalId, q.sr_no AS srNo, q.sub_title AS subTitle, q.category, q.auto_or_manual AS autoOrManual, q.sort_order AS sortOrder
         FROM zonal_awards_question q JOIN zonal_awards_goal g ON g.pk_id = q.fk_goal_id WHERE g.fk_year_id = @Y AND q.isdeleted = 0 ORDER BY q.sort_order`,
        { Y: yearId },
      ),
      options: await ZonalAwardsController.options(conn, yearId),
    }));
    const headers = ["Goal", "Sr", "Question", "Type", "Subtype", "Option / Criteria", "Points Label"];
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Zonal Awards Structure");
    ws.mergeCells(1, 1, 1, 7);
    ws.getCell(1, 1).value = `Zonal Awards — Questions & Criteria — ${data.yearLabel}`;
    style(ws.getCell(1, 1), { bold: true, size: 14, fill: NAVY, color: "FFFFFFFF", align: "center" });
    ws.getRow(1).height = 22;
    headers.forEach((h, i) => (ws.getCell(3, i + 1).value = h));
    styleRange(ws, 3, 1, 3, headers.length, { bold: true, fill: NAVY, color: "FFFFFFFF", align: "center" });
    let row = 4;
    for (const g of data.goals) {
      ws.mergeCells(row, 1, row, headers.length);
      ws.getCell(row, 1).value = g.maxPoints !== null && g.maxPoints !== undefined ? `${g.title}   (Max ${Math.trunc(Number(g.maxPoints))} points)` : String(g.title);
      style(ws.getCell(row, 1), { bold: true, size: 12, fill: "FFD9E8F5" });
      row++;
      const qs = data.questions.filter((q) => Number(q.goalId) === Number(g.id)).sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
      for (const q of qs) {
        const qOpts = data.options
          .filter((o) => Number(o.questionId) === Number(q.id))
          .sort((a, b) => (a.subtype === null ? 0 : Number(a.subtype)) - (b.subtype === null ? 0 : Number(b.subtype)) || Number(a.sortOrder) - Number(b.sortOrder));
        const firstRow = row;
        for (let i = 0; i < Math.max(qOpts.length, 1); i++) {
          ws.getCell(row, 1).value = "";
          ws.getCell(row, 2).value = i === 0 ? (q.srNo ?? "") : "";
          ws.getCell(row, 3).value = i === 0 ? q.category : "";
          ws.getCell(row, 4).value = i === 0 ? q.autoOrManual : "";
          if (qOpts.length) {
            const o = qOpts[i];
            ws.getCell(row, 5).value = o.subtype === null ? "" : String(Math.trunc(Number(o.subtype)));
            ws.getCell(row, 6).value = o.label ?? "";
            ws.getCell(row, 7).value = o.pointsLabel ?? "";
          }
          row++;
        }
        style(ws.getCell(firstRow, 4), { fill: q.autoOrManual === "Auto" ? AUTO_FILL : MANUAL_FILL, bold: true, align: "center" });
      }
    }
    thinBorders(ws, 3, 1, row - 1, headers.length);
    styleRange(ws, 3, 1, row - 1, headers.length, { vAlign: "middle", wrap: true });
    autoFit(ws, 1, headers.length);
    clampWidth(ws, 3, 30, 50);
    clampWidth(ws, 6, 30, 50);
    clampWidth(ws, 7, 15, 30);
    ws.views = [{ state: "frozen", ySplit: 3 }];
    return file(await toBuffer(wb), XLSX_CONTENT_TYPE, `zonal_awards_structure_${yearId}.xlsx`);
  }

  @Get("api/zonal-awards/import-logs")
  async importLogs(@Query("yearId") y?: string) {
    return ok(
      await this.db.query(
        `SELECT pk_id AS id, month, file_name AS fileName, total_districts AS totalDistricts, total_questions AS totalQuestions, uploaded_date AS uploadedDate
         FROM zonal_awards_import_log WHERE fk_year_id=@Y ORDER BY uploaded_date DESC`,
        { Y: queryInt(y, 0) },
      ),
    );
  }

  @Get("api/zonal-awards/report/yearly")
  async yearly(@Query("yearId") y?: string) {
    const yearId = queryInt(y, 0);
    return this.db.session(async (conn) =>
      ok({
        districts: await conn.query(
          `SELECT DISTINCT d.pk_district_id AS districtId, d.DistrictNumber AS districtNumber
           FROM zonal_awards_district_entry e JOIN district_master d ON d.pk_district_id=e.fk_district_id
           WHERE e.fk_year_id=@Y AND e.month=0 AND e.isdeleted=0 AND d.isdeleted=0
           ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber`,
          { Y: yearId },
        ),
        questions: await conn.query(
          `SELECT q.pk_id AS questionId, q.sr_no AS srNo, q.category, q.auto_or_manual AS autoOrManual, g.title AS goalTitle
           FROM zonal_awards_question q JOIN zonal_awards_goal g ON g.pk_id=q.fk_goal_id
           WHERE g.fk_year_id=@Y AND q.isdeleted=0 ORDER BY q.sort_order`,
          { Y: yearId },
        ),
        districtTotals: await conn.query(
          `SELECT e.fk_district_id AS districtId, SUM(e.received_points) AS totalPoints
           FROM zonal_awards_district_entry e WHERE e.fk_year_id=@Y AND e.month=0 AND e.isdeleted=0
           GROUP BY e.fk_district_id ORDER BY totalPoints DESC`,
          { Y: yearId },
        ),
      }),
    );
  }

  @Get("api/zonal-awards/report/monthly")
  async monthly(@Query("yearId") y?: string, @Query("districtId") d?: string) {
    return ok(
      await this.db.query(
        `SELECT e.fk_option_id AS optionId, e.month, e.entered_counts AS enteredCounts, e.received_points AS receivedPoints,
                o.goal_requirement_label AS optionLabel, q.sr_no AS srNo, q.category AS question, q.auto_or_manual AS autoOrManual
         FROM zonal_awards_district_entry e
         JOIN zonal_awards_question_option o ON o.pk_id=e.fk_option_id
         JOIN zonal_awards_question q ON q.pk_id=o.fk_question_id
         WHERE e.fk_district_id=@DId AND e.fk_year_id=@YId AND e.month>0 AND e.isdeleted=0
         ORDER BY q.sort_order, o.sort_order, e.month`,
        { DId: queryInt(d, 0), YId: queryInt(y, 0) },
      ),
    );
  }

  @Get("api/zonal-awards/report/yearly/excel")
  async yearlyExcel(@Query("yearId") y?: string) {
    const yearId = queryInt(y, 0);
    const data = await this.db.session(async (conn) => ({
      goals: await conn.query("SELECT pk_id AS id, title, sort_order FROM zonal_awards_goal WHERE fk_year_id=@Y AND isdeleted=0 ORDER BY sort_order", { Y: yearId }),
      questions: await conn.query(
        `SELECT q.pk_id AS id, q.fk_goal_id AS goalId, q.sr_no AS srNo, q.category, q.auto_or_manual AS autoOrManual
         FROM zonal_awards_question q JOIN zonal_awards_goal g ON g.pk_id=q.fk_goal_id WHERE g.fk_year_id=@Y AND q.isdeleted=0 ORDER BY q.sort_order`,
        { Y: yearId },
      ),
      districts: await conn.query(
        `SELECT DISTINCT d.pk_district_id AS id, d.DistrictNumber FROM zonal_awards_district_entry e JOIN district_master d ON d.pk_district_id=e.fk_district_id
         WHERE e.fk_year_id=@Y AND e.month=0 AND e.isdeleted=0 AND d.isdeleted=0 ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber`,
        { Y: yearId },
      ),
      entries: await conn.query(
        `SELECT e.fk_district_id AS districtId, o.fk_question_id AS questionId, SUM(e.received_points) AS totalPoints
         FROM zonal_awards_district_entry e JOIN zonal_awards_question_option o ON o.pk_id=e.fk_option_id
         WHERE e.fk_year_id=@Y AND e.month=0 AND e.isdeleted=0 GROUP BY e.fk_district_id, o.fk_question_id`,
        { Y: yearId },
      ),
    }));
    const points = new Map(data.entries.map((e) => [`${e.districtId}_${e.questionId}`, num(e.totalPoints)]));
    const goalNames = new Map(data.goals.map((g) => [Number(g.id), String(g.title)]));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Yearly Report");
    ["Goal", "Sr No", "Question", "Type"].forEach((h, i) => (ws.getCell(1, i + 1).value = h));
    data.districts.forEach((d, i) => (ws.getCell(1, 5 + i).value = String(d.DistrictNumber)));
    styleRange(ws, 1, 1, 1, 4 + data.districts.length, { bold: true, fill: NAVY, color: "FFFFFFFF" });
    let row = 2;
    for (const q of data.questions) {
      ws.getCell(row, 1).value = goalNames.get(Number(q.goalId)) ?? "";
      ws.getCell(row, 2).value = q.srNo ?? "";
      ws.getCell(row, 3).value = q.category;
      ws.getCell(row, 4).value = q.autoOrManual;
      data.districts.forEach((d, i) => (ws.getCell(row, 5 + i).value = points.get(`${d.id}_${q.id}`) ?? 0));
      row++;
    }
    ws.getCell(row, 1).value = "TOTAL";
    styleRange(ws, row, 1, row, 4, { bold: true, fill: "FFFFD700" });
    data.districts.forEach((d, i) => {
      ws.getCell(row, 5 + i).value = data.questions.reduce((t, q) => t + (points.get(`${d.id}_${q.id}`) ?? 0), 0);
      style(ws.getCell(row, 5 + i), { bold: true, fill: "FFFFD700" });
    });
    autoFit(ws, 1, 4 + data.districts.length);
    ws.views = [{ state: "frozen", xSplit: 4, ySplit: 1 }];
    return file(await toBuffer(wb), XLSX_CONTENT_TYPE, `zonal_awards_yearly_${yearId}.xlsx`);
  }

  @Get("api/zonal-awards/report/monthly/excel")
  async monthlyExcel(@Query("yearId") y?: string) {
    const yearId = queryInt(y, 0);
    const data = await this.db.session(async (conn) => ({
      startDate: await conn.executeScalar<string>("SELECT StartDate FROM rotary_year_master WHERE pk_year_id = @Y", { Y: yearId }),
      goals: await conn.query("SELECT pk_id AS id, title FROM zonal_awards_goal WHERE fk_year_id=@Y AND isdeleted=0 ORDER BY sort_order", { Y: yearId }),
      questions: await conn.query(
        `SELECT q.pk_id AS id, q.fk_goal_id AS goalId, q.sr_no AS srNo, q.category, q.auto_or_manual AS autoOrManual, q.sort_order AS sortOrder
         FROM zonal_awards_question q JOIN zonal_awards_goal g ON g.pk_id = q.fk_goal_id WHERE g.fk_year_id = @Y AND q.isdeleted = 0 ORDER BY q.sort_order`,
        { Y: yearId },
      ),
      options: await conn.query(
        `SELECT o.pk_id AS id, o.fk_question_id AS questionId, COALESCE(o.subtype,0) AS subtype, o.question_type_for_import AS importType, o.sort_order AS sortOrder
         FROM zonal_awards_question_option o JOIN zonal_awards_question q ON q.pk_id = o.fk_question_id JOIN zonal_awards_goal g ON g.pk_id = q.fk_goal_id
         WHERE g.fk_year_id = @Y AND o.isdeleted = 0 ORDER BY o.fk_question_id, COALESCE(o.subtype,0), o.sort_order`,
        { Y: yearId },
      ),
      districts: await conn.query(
        `SELECT DISTINCT d.pk_district_id AS id, d.DistrictNumber AS districtNumber FROM zonal_awards_district_entry e JOIN district_master d ON d.pk_district_id = e.fk_district_id
         WHERE e.fk_year_id = @Y AND e.month > 0 AND e.received_points > 0 AND e.isdeleted = 0 AND d.isdeleted = 0 ORDER BY CAST(d.DistrictNumber AS UNSIGNED)`,
        { Y: yearId },
      ),
      entries: await conn.query(
        `SELECT e.fk_district_id AS districtId, o.fk_question_id AS questionId, COALESCE(o.subtype,0) AS subtype, e.month, SUM(e.received_points) AS pts
         FROM zonal_awards_district_entry e JOIN zonal_awards_question_option o ON o.pk_id = e.fk_option_id
         JOIN zonal_awards_question q ON q.pk_id = o.fk_question_id JOIN zonal_awards_goal g ON g.pk_id = q.fk_goal_id AND g.fk_year_id = @Y
         WHERE e.fk_year_id = @Y AND e.isdeleted = 0 AND e.month > 0
         GROUP BY e.fk_district_id, o.fk_question_id, COALESCE(o.subtype,0), e.month`,
        { Y: yearId },
      ),
    }));
    const now = new Date();
    const startYear = data.startDate ? Number(String(data.startDate).slice(0, 4)) : now.getUTCFullYear();
    const goalNames = new Map(data.goals.map((g) => [Number(g.id), String(g.title)]));
    const pts = new Map(data.entries.map((e) => [`${Number(e.districtId)}_${Number(e.questionId)}_${Number(e.subtype)}_${Number(e.month)}`, num(e.pts)]));
    const rows: { sr: string; goal: string; question: string; type: string; qId: number; subtype: number }[] = [];
    for (const q of data.questions) {
      const subtypes = [...new Set(data.options.filter((o) => Number(o.questionId) === Number(q.id)).map((o) => Number(o.subtype)))].sort((a, b) => a - b);
      const base = { sr: String(q.srNo ?? ""), goal: goalNames.get(Number(q.goalId)) ?? "", type: String(q.autoOrManual), qId: Number(q.id) };
      if (subtypes.length <= 1) rows.push({ ...base, question: String(q.category), subtype: subtypes[0] ?? 0 });
      else {
        for (const st of subtypes) {
          const imp = data.options.find((o) => Number(o.questionId) === Number(q.id) && Number(o.subtype) === st)?.importType;
          rows.push({ ...base, question: imp && String(imp).trim() ? String(imp) : String(q.category), subtype: st });
        }
      }
    }
    const nowKey = now.getUTCFullYear() * 12 + now.getUTCMonth();
    let sheets = MONTHS.map(([m, abbr]) => ({ m, year: m >= 7 ? startYear : startYear + 1, abbr })).filter((s) => s.year * 12 + (s.m - 1) <= nowKey);
    if (!sheets.length) sheets = MONTHS.map(([m, abbr]) => ({ m, year: m >= 7 ? startYear : startYear + 1, abbr }));
    const wb = new ExcelJS.Workbook();
    const cols = 4 + data.districts.length;
    for (const s of sheets) {
      const ws = wb.addWorksheet(`${s.abbr}_${s.year}`);
      ["Sr", "Goal", "Question", "Type"].forEach((h, i) => (ws.getCell(1, i + 1).value = h));
      data.districts.forEach((d, i) => (ws.getCell(1, 5 + i).value = String(d.districtNumber)));
      styleRange(ws, 1, 1, 1, cols, { bold: true, fill: NAVY, color: "FFFFFFFF", align: "center" });
      let r = 2;
      for (const row of rows) {
        ws.getCell(r, 1).value = row.sr;
        ws.getCell(r, 2).value = row.goal;
        ws.getCell(r, 3).value = row.question;
        ws.getCell(r, 4).value = row.type;
        style(ws.getCell(r, 4), { align: "center", fill: row.type === "Auto" ? AUTO_FILL : MANUAL_FILL });
        data.districts.forEach((d, i) => (ws.getCell(r, 5 + i).value = pts.get(`${Number(d.id)}_${row.qId}_${row.subtype}_${s.m}`) ?? 0));
        r++;
      }
      thinBorders(ws, 1, 1, r - 1, cols);
      clampWidth(ws, 2, 14, 22);
      clampWidth(ws, 3, 30, 50);
      ws.views = [{ state: "frozen", xSplit: 4, ySplit: 1 }];
    }
    return file(await toBuffer(wb), XLSX_CONTENT_TYPE, `zonal_awards_monthly_${yearId}.xlsx`);
  }
}
