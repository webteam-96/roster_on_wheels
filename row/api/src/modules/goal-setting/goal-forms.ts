import type { DbCommands, Row } from "../../database/db.service";
import { InvalidOperationException, UnauthorizedAccessException } from "../../common/exceptions";
import { formatNumber } from "../../common/dotnet-format";
import {
  GoalCore, MEMBERSHIP_IMPORT_SCOPE, MEMBERSHIP_MONTHLY_KEYS, MONTHLY_COLLECTED_TO_TARGET, QUARTER_MONTHS, ROTARY_MONTH_LABELS, YOUTH_DISTRICT_OWN_KEYS, YOUTH_IMPORT_SCOPE,
  IMPORTED_MONTHLY_FIELD_KEYS, applyTargetSplit, buildRotaryMonths, ci, isDistrictMembershipImported, isMysqlError, lastDayOfLatest,
  liveClubCount, liveDistrictClubCount, liveDistrictMemberCount, liveDistrictWomenCount, rotaryIndex, roundToWhole, spreadTarget, today, ymd,
} from "./goal-core";
import { newMonthlyField, type GoalCategoryFormDto, type GoalFieldWithValueDto, type GoalMonthlyFieldDto, type GoalMonthlyFormDto, type GoalMonthPeriodDto, type GoalMyAssignmentDto, type SaveGoalEntriesRequest, type SaveGoalMonthlyRequest, type SaveGoalTargetSplitRequest, type GoalMonthlySaveDto, type GoalTargetSplitErrorDto } from "./goal-setting.dtos";

/** The 3 Membership metrics with an "as on July 1st" baseline field. */
export const MEMBERSHIP_BASELINE_KEY: Record<string, string> = {
  new_clubs_achieved: "total_clubs",
  new_members_achieved: "total_members",
  new_women_members_achieved: "existing_women_members",
};
/** TRF (district): each fund's "Highest" shown as the reference column before the target (display only). */
export const TRF_HIGHEST_KEY: Record<string, string> = {
  annual_fund_achieved: "annual_fund_highest",
  polio_plus_achieved: "polio_plus_highest",
  endowment_achieved: "endowment_highest",
  csr_achieved: "csr_highest",
  total_giving_achieved: "total_contributions_highest",
};
/** The Foundation category is stored as "TRF" and shown as "Foundation". */
export const isTrfCategory = (name: string | null | undefined) => ci(name, "TRF") || ci(name, "Foundation");
export const monthlyMetricLabel = (f: { fieldLabel: string; groupName: string }) => (f.fieldLabel === "Achieved" ? f.groupName : f.fieldLabel);

/** Youth "Percentage Achievement" printed in a single value cell ("60%"). */
export function youthPctText(fv: GoalFieldWithValueDto): string | null {
  return YOUTH_DISTRICT_OWN_KEYS.has(fv.fieldKey) && fv.dataType === "Percentage" && fv.numericValue !== null ? formatNumber(fv.numericValue, "0.##") + "%" : null;
}

const NOT_IN_PILOT_MESSAGE = "The quarterly / month-wise target split is still being tested and is not open for this club or district yet.";

/**
 * Port of GoalSettingService.cs, layer 2: the club and district goal forms, the month-wise forms
 * and their saves, the current-month snapshot, the "Achieved as on" date and the target split.
 */
export abstract class GoalForms extends GoalCore {
  /** Defined by the roles layer. */
  abstract getMyAssignments(memberId: number): Promise<GoalMyAssignmentDto[]>;

  /**
   * GoalTargetSplitPilot: while the split is piloted only the listed clubs / districts may use it.
   * ROW: GoalSetting:SplitPilot:Enabled (default true) / :ClubIds / :DistrictIds (RIZones hard-coded its own ids).
   */
  protected splitPilotAllows(kind: "club" | "district", id: number) {
    const raw = this.config.get("GoalSetting:SplitPilot:Enabled");
    const enabled = raw === undefined ? true : raw.toLowerCase() === "true";
    if (!enabled) return true;
    return this.config.getArray(kind === "club" ? "GoalSetting:SplitPilot:ClubIds" : "GoalSetting:SplitPilot:DistrictIds").map(Number).includes(id);
  }

  // ── Club and district goal forms ──────────────────────────────────────────

  async getClubGoalForm(memberId: number, categoryId: number, yearId: number | null, requestedClubId: number | null): Promise<GoalCategoryFormDto | null> {
    return this.db.session(async (conn) => {
      const clubId = await this.resolveClubId(conn, memberId, requestedClubId);
      if (clubId === 0) return null;
      const y = await this.resolveYear(conn, yearId);
      if (y.yearId === 0) return null;
      const clubName = String((await conn.executeScalar("SELECT ClubName FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0", { Id: clubId })) ?? "");
      const categoryName = await GoalCore.categoryName(conn, categoryId);
      const fields = await this.loadFieldsWithValues(conn, categoryId, y.yearId, "Club", clubId, 0, y.isEditable);
      const lock = await this.getLock(conn, "Club", clubId, 0, categoryId, y.yearId);
      const canLock = await this.canLockClub(conn, memberId, clubId);
      return {
        categoryId, categoryName, entityType: "Club", clubId, districtId: null, entityName: clubName, yearId: y.yearId, yearLabel: y.yearLabel,
        isEditable: y.isEditable && !lock.isLocked, isLocked: lock.isLocked, lockedByName: lock.lockedByName, lockedDate: lock.lockedDate, canLock,
        achievedAsOn: await this.achievedAsOn(conn, categoryId, y.yearId, "Club", clubId, 0), fields,
      };
    });
  }

  async saveClubGoalForm(memberId: number, categoryId: number, request: SaveGoalEntriesRequest, requestedClubId: number | null): Promise<GoalCategoryFormDto> {
    if (request.yearId <= 0) throw new InvalidOperationException("yearId required");
    const clubId = await this.db.session(async (conn) => {
      const clubId = await this.resolveClubId(conn, memberId, requestedClubId);
      if (clubId === 0) throw new UnauthorizedAccessException("No club admin assignment found.");
      const y = await this.resolveYear(conn, request.yearId);
      if (!y.isEditable) throw new InvalidOperationException("Past years are read-only and cannot be edited.");
      if ((await this.getLock(conn, "Club", clubId, 0, categoryId, request.yearId)).isLocked) throw new InvalidOperationException("This category is locked and cannot be edited.");
      await this.validateTargetsVsBaseline(conn, categoryId, request.yearId, "Club", clubId, 0, request.entries);
      await this.saveEntries(conn, categoryId, request.yearId, "Club", clubId, 0, request.entries, memberId);
      await this.snapshotCurrentMonth(conn, categoryId, request.yearId, "Club", clubId, 0, memberId);
      return clubId;
    });
    return (await this.getClubGoalForm(memberId, categoryId, request.yearId, clubId))!;
  }

  /** One category's fields for one district: the District Admin's form and the scoped oversight view. */
  protected async buildDistrictFormDto(conn: DbCommands, memberId: number, categoryId: number, districtId: number, yearId: number, yearLabel: string, yearIsEditable: boolean): Promise<GoalCategoryFormDto> {
    const districtName = String((await conn.executeScalar("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id AND isdeleted = 0", { Id: districtId })) ?? "");
    const categoryName = await GoalCore.categoryName(conn, categoryId);
    const fields = await this.loadFieldsWithValues(conn, categoryId, yearId, "District", 0, districtId, yearIsEditable);
    const lock = await this.getLock(conn, "District", 0, districtId, categoryId, yearId);
    const canLock = await this.canLockDistrict(conn, memberId, districtId);
    return {
      categoryId, categoryName, entityType: "District", clubId: null, districtId, entityName: `District ${districtName}`, yearId, yearLabel,
      isEditable: yearIsEditable && !lock.isLocked, isLocked: lock.isLocked, lockedByName: lock.lockedByName, lockedDate: lock.lockedDate, canLock,
      achievedAsOn: await this.achievedAsOn(conn, categoryId, yearId, "District", 0, districtId), fields,
    };
  }

  async getDistrictGoalForm(memberId: number, categoryId: number, yearId: number | null, requestedDistrictId: number | null): Promise<GoalCategoryFormDto | null> {
    return this.db.session(async (conn) => {
      const districtId = await this.resolveDistrictId(conn, memberId, requestedDistrictId);
      if (districtId === 0) return null;
      const y = await this.resolveYear(conn, yearId);
      if (y.yearId === 0) return null;
      return this.buildDistrictFormDto(conn, memberId, categoryId, districtId, y.yearId, y.yearLabel, y.isEditable);
    });
  }

  async saveDistrictGoalForm(memberId: number, categoryId: number, request: SaveGoalEntriesRequest, requestedDistrictId: number | null): Promise<GoalCategoryFormDto> {
    if (request.yearId <= 0) throw new InvalidOperationException("yearId required");
    const districtId = await this.db.session(async (conn) => {
      const districtId = await this.resolveDistrictId(conn, memberId, requestedDistrictId);
      if (districtId === 0) throw new UnauthorizedAccessException("No district admin assignment found.");
      const y = await this.resolveYear(conn, request.yearId);
      if (!y.isEditable) throw new InvalidOperationException("Past years are read-only and cannot be edited.");
      if ((await this.getLock(conn, "District", 0, districtId, categoryId, request.yearId)).isLocked) throw new InvalidOperationException("This category is locked and cannot be edited.");
      await this.validateTargetsVsBaseline(conn, categoryId, request.yearId, "District", 0, districtId, request.entries);
      await this.saveEntries(conn, categoryId, request.yearId, "District", 0, districtId, request.entries, memberId);
      await this.snapshotCurrentMonth(conn, categoryId, request.yearId, "District", 0, districtId, memberId);
      return districtId;
    });
    return (await this.getDistrictGoalForm(memberId, categoryId, request.yearId, districtId))!;
  }

  // ── "Achieved as on" dates ────────────────────────────────────────────────

  /** Imported months of one scope (calendar month numbers); null when the bookkeeping table is missing. */
  protected static async importedMonths(conn: DbCommands, yearId: number, scope: string): Promise<number[] | null> {
    try {
      return (await conn.query("SELECT PeriodMonth AS m FROM goal_foundation_import_months WHERE fk_year_id = @Y AND Scope = @S AND isdeleted = 0", { Y: yearId, S: scope })).map((r) => Number(r.m));
    } catch (e) {
      if (isMysqlError(e)) return null;
      throw e;
    }
  }

  /** The months a Membership import covered; empty when none / table missing. */
  protected static async membershipImportedMonths(conn: DbCommands, yearId: number) {
    return new Set((await GoalForms.importedMonths(conn, yearId, MEMBERSHIP_IMPORT_SCOPE)) ?? []);
  }

  /** TRF / Foundation: the last day of the latest month the import covers for this scope. */
  protected async foundationAsOn(conn: DbCommands, yearId: number, scope: string): Promise<string | null> {
    const { start } = await GoalCore.yearRange(conn, yearId);
    if (!start) return null;
    const months = await GoalForms.importedMonths(conn, yearId, scope);
    if (!months || !months.length) return null;
    return lastDayOfLatest(ymd(start)!, months);
  }

  /** Rotary-year index of the latest Foundation month imported; -1 none, null table missing (no cap). */
  protected static async foundationImportedThroughIndex(conn: DbCommands, yearId: number, scope: string, startMonth: number): Promise<number | null> {
    const months = await GoalForms.importedMonths(conn, yearId, scope);
    if (months === null) return null;
    return months.length ? Math.max(...months.map((pm) => rotaryIndex(pm, startMonth))) : -1;
  }

  /** Record the DATA month an import covered (never the upload date); never fails the import. */
  protected static async recordFoundationImportMonth(conn: DbCommands, yearId: number, scope: string, month: number, memberId: number) {
    if (month < 1 || month > 12) return;
    try {
      await conn.execute(
        `INSERT INTO goal_foundation_import_months (fk_year_id, Scope, PeriodMonth, created_by, created_date)
         VALUES (@Y, @S, @M, @U, NOW())
         ON DUPLICATE KEY UPDATE isdeleted = 0, modified_by = @U, modified_date = NOW()`,
        { Y: yearId, S: scope, M: month, U: memberId },
      );
    } catch (e) {
      if (!isMysqlError(e)) throw e;
    }
  }

  protected async achievedAsOn(conn: DbCommands, categoryId: number, yearId: number, entityType: string, clubId: number, districtId: number): Promise<string | null> {
    const categoryName = await GoalCore.categoryName(conn, categoryId);
    if (isTrfCategory(categoryName)) return this.foundationAsOn(conn, yearId, entityType);
    const { start, end } = await GoalCore.yearRange(conn, yearId);
    if (!start) return null;
    if (isDistrictMembershipImported(entityType, start) && ci(categoryName, "Membership")) return this.foundationAsOn(conn, yearId, MEMBERSHIP_IMPORT_SCOPE);
    if (isDistrictMembershipImported(entityType, start) && ci(categoryName, "Youth Service")) return this.foundationAsOn(conn, yearId, YOUTH_IMPORT_SCOPE);
    let months = (await conn.query(
      `SELECT DISTINCT m.PeriodMonth AS pm
       FROM goal_entries_monthly m
       JOIN goal_fields f ON f.pk_field_id = m.fk_field_id AND f.fk_category_id = @Cat AND f.isdeleted = 0
       WHERE m.fk_year_id = @Y AND m.EntityType = @E AND m.fk_club_id = @C AND m.fk_district_id = @D
         AND m.isdeleted = 0 AND m.NumericValue IS NOT NULL`,
      { Cat: categoryId, Y: yearId, E: entityType, C: clubId, D: districtId },
    )).map((r) => Number(r.pm));
    // the running month's auto-snapshot is not a completed month
    const t = today();
    const tIso = `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
    if (end && tIso >= start.slice(0, 10) && tIso <= end.slice(0, 10)) months = months.filter((m) => m !== t.m);
    if (!months.length) return null;
    return lastDayOfLatest(ymd(start)!, months);
  }

  // ── Month-wise form ───────────────────────────────────────────────────────

  protected async buildMonthlyForm(conn: DbCommands, categoryId: number, yearId: number, entityType: string, clubId: number, districtId: number, entityName: string, canEdit: boolean): Promise<GoalMonthlyFormDto | null> {
    const yr = await conn.queryFirstOrDefault("SELECT YearLabel AS label, StartDate AS s FROM rotary_year_master WHERE pk_year_id = @Y AND isdeleted = 0", { Y: yearId });
    if (!yr || !yr.s) return null;
    const start = ymd(yr.s)!;
    const startIso = String(yr.s).slice(0, 10);
    const months = buildRotaryMonths(yr.s);
    const categoryName = await GoalCore.categoryName(conn, categoryId);
    if (isTrfCategory(categoryName)) {
      const lastIdx = await GoalForms.foundationImportedThroughIndex(conn, yearId, entityType, start.m);
      if (lastIdx !== null) for (const mo of months) if (rotaryIndex(mo.month, start.m) > lastIdx) mo.isAvailable = false;
    }
    const membershipImported = isDistrictMembershipImported(entityType, startIso) && ci(categoryName, "Membership");
    if (membershipImported) {
      const imported = await GoalForms.membershipImportedMonths(conn, yearId);
      for (const mo of months) if (!imported.has(mo.month)) mo.isAvailable = false;
    }

    const form = (fields: GoalMonthlyFieldDto[]): GoalMonthlyFormDto => ({
      categoryId, categoryName, entityType, clubId: entityType === "Club" ? clubId : null, districtId: entityType === "District" ? districtId : null,
      entityName, yearId, yearLabel: String(yr.label), isEditable: canEdit, months, fields,
    });

    const fieldRows = await conn.query(
      `SELECT f.pk_field_id AS fieldId, f.GroupName AS groupName, f.FieldKey AS fieldKey,
              f.FieldLabel AS fieldLabel, f.DataType AS dataType, f.Unit AS unit
       FROM goal_fields f
       WHERE f.fk_category_id = @Cat AND f.isdeleted = 0 AND f.IsActive = 1 AND f.IsHidden = 0
         AND (f.AppliesTo = 'Both' OR f.AppliesTo = @Entity)
         AND f.FieldKey IN @Keys
       ORDER BY f.SortOrder, f.pk_field_id`,
      { Cat: categoryId, Entity: entityType, Keys: Object.keys(MONTHLY_COLLECTED_TO_TARGET) },
    );
    let fields: GoalMonthlyFieldDto[] = [];
    if (!fieldRows.length) return form(fields);

    const monthlyByField = new Map<number, Map<number, number | null>>();
    const monthTargetByField = new Map<number, Map<number, number | null>>();
    for (const m of await conn.query(
      `SELECT fk_field_id AS fieldId, PeriodMonth AS month, NumericValue AS val, TargetValue AS tgt
       FROM goal_entries_monthly
       WHERE fk_year_id = @Y AND EntityType = @E AND fk_club_id = @C AND fk_district_id = @D
         AND isdeleted = 0 AND fk_field_id IN @Ids`,
      { Y: yearId, E: entityType, C: clubId, D: districtId, Ids: fieldRows.map((r) => Number(r.fieldId)) },
    )) {
      const fid = Number(m.fieldId), mon = Number(m.month);
      if (!monthlyByField.has(fid)) monthlyByField.set(fid, new Map());
      monthlyByField.get(fid)!.set(mon, m.val === null ? null : Number(m.val));
      if (!monthTargetByField.has(fid)) monthTargetByField.set(fid, new Map());
      monthTargetByField.get(fid)!.set(mon, m.tgt === null ? null : Number(m.tgt));
    }

    const targetKeys = [...new Set(fieldRows.map((r) => MONTHLY_COLLECTED_TO_TARGET[r.fieldKey]).filter((k) => !!k))];
    const targetByKey = new Map<string, number | null>();
    if (targetKeys.length)
      for (const t of await conn.query(
        `SELECT f.FieldKey AS fieldKey, e.NumericValue AS val
         FROM goal_fields f
         LEFT JOIN goal_entries e ON e.fk_field_id = f.pk_field_id AND e.fk_year_id = @Y
              AND e.EntityType = @E AND e.fk_club_id = @C AND e.fk_district_id = @D AND e.isdeleted = 0
         WHERE f.fk_category_id = @Cat AND f.isdeleted = 0 AND f.FieldKey IN @Keys`,
        { Cat: categoryId, Y: yearId, E: entityType, C: clubId, D: districtId, Keys: targetKeys },
      )) targetByKey.set(String(t.fieldKey), t.val === null ? null : Number(t.val));

    for (const r of fieldRows) {
      const fid = Number(r.fieldId);
      const map = monthlyByField.get(fid);
      const monthly: Record<number, number | null> = {};
      let total = 0;
      for (const mo of months) {
        const v = map?.has(mo.month) ? map.get(mo.month)! : null;
        monthly[mo.month] = v;
        total += v ?? 0;
      }
      fields.push(newMonthlyField({
        fieldId: fid, groupName: String(r.groupName), fieldKey: String(r.fieldKey), fieldLabel: String(r.fieldLabel), dataType: String(r.dataType),
        unit: typeof r.unit === "string" ? r.unit : null, annualTarget: targetByKey.get(MONTHLY_COLLECTED_TO_TARGET[r.fieldKey]) ?? null, monthly, total,
      }));
    }

    if (membershipImported) await this.applyImportedMembership(conn, fields, months, yearId, districtId);
    else await GoalForms.applyMembershipDateBuckets(conn, fields, months, entityType, clubId, districtId, startIso);

    // after the buckets: they replace Monthly and set the Baseline
    for (const fld of fields) {
      applyTargetSplit(fld, months, monthTargetByField.get(fld.fieldId));
      roundToWhole(fld);
      if (Object.values(fld.monthlyTargets).some((v) => v !== null)) {
        let run = fld.baseline ?? 0;
        for (const mo of months) {
          run += fld.monthlyTargets[mo.month] ?? 0;
          fld.monthlyTargetsRunning[mo.month] = run;
        }
      }
    }

    // Every OTHER field of the category, listed with its value and empty month cells.
    const annualOnly = await this.loadFieldsWithValues(conn, categoryId, yearId, entityType, clubId, districtId, true);
    const haveKeys = new Set(fields.map((f) => f.fieldKey));
    for (const f of fields) {
      const paired = MONTHLY_COLLECTED_TO_TARGET[f.fieldKey];
      if (paired) haveKeys.add(paired);
      if (MEMBERSHIP_BASELINE_KEY[f.fieldKey]) haveKeys.add(MEMBERSHIP_BASELINE_KEY[f.fieldKey]);
      if (TRF_HIGHEST_KEY[f.fieldKey]) haveKeys.add(TRF_HIGHEST_KEY[f.fieldKey]);
    }
    if (isTrfCategory(categoryName)) {
      haveKeys.add("total_contributions_highest");
      haveKeys.add("total_contributions_target");
    }
    const isDerived = (key: string) => /_achieved$/i.test(key) || /_pct$/i.test(key) || /_percentage_achievement$/i.test(key) || key === "percentage_increase";
    const extras: GoalMonthlyFieldDto[] = [];
    const suggestionTexts: string[] = [];
    let suggestionRow: GoalMonthlyFieldDto | null = null;
    for (const fv of annualOnly) {
      if (haveKeys.has(fv.fieldKey) || (isDerived(fv.fieldKey) && !YOUTH_DISTRICT_OWN_KEYS.has(fv.fieldKey))) continue;
      const blank: Record<number, number | null> = {};
      for (const mo of months) blank[mo.month] = null;
      if (ci(fv.groupName, "Suggestions")) {
        if (fv.textValue && fv.textValue.trim()) suggestionTexts.push(fv.textValue.trim());
        if (!suggestionRow) {
          suggestionRow = newMonthlyField({ fieldId: fv.fieldId, groupName: fv.groupName, fieldKey: "suggestions", fieldLabel: "Suggestions", dataType: "Text", monthly: blank, monthlyTracked: false });
          extras.push(suggestionRow);
        }
        continue;
      }
      extras.push(newMonthlyField({
        fieldId: fv.fieldId, groupName: fv.groupName, fieldKey: fv.fieldKey, fieldLabel: fv.fieldLabel, dataType: fv.dataType, unit: fv.unit,
        annualTarget: fv.dataType === "Boolean" || fv.dataType === "Text" ? null : fv.numericValue, monthly: blank, monthlyTracked: false,
        displayText: fv.dataType === "Boolean" ? (fv.boolValue === null ? null : fv.boolValue ? "Yes" : "No") : fv.dataType === "Text" ? fv.textValue : youthPctText(fv),
      }));
    }
    if (suggestionRow && suggestionTexts.length) suggestionRow.displayText = suggestionTexts.map((s, i) => `${i + 1}) ${s}`).join("\n");
    const order = new Map(annualOnly.map((fv, i) => [fv.fieldKey, i]));
    fields = [...fields, ...extras].map((f, i) => ({ f, i })).sort((a, b) => (order.get(a.f.fieldKey) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.f.fieldKey) ?? Number.MAX_SAFE_INTEGER) || a.i - b.i).map((x) => x.f);
    return form(fields);
  }

  /** District Membership from the Rotary.org import: baseline = stored July-1st figure, imported months only. */
  private async applyImportedMembership(conn: DbCommands, fields: GoalMonthlyFieldDto[], months: GoalMonthPeriodDto[], yearId: number, districtId: number) {
    if (!fields.some((f) => MEMBERSHIP_MONTHLY_KEYS.has(f.fieldKey))) return;
    const baselines = new Map<string, number | null>();
    for (const x of await conn.query(
      `SELECT f.FieldKey AS k, e.NumericValue AS v
       FROM goal_fields f
       JOIN goal_entries e ON e.fk_field_id = f.pk_field_id AND e.fk_year_id = @Y AND e.EntityType = 'District'
                          AND e.fk_club_id = 0 AND e.fk_district_id = @D AND e.isdeleted = 0
       WHERE f.isdeleted = 0 AND f.FieldKey IN @Keys`,
      { Y: yearId, D: districtId, Keys: Object.values(MEMBERSHIP_BASELINE_KEY) },
    )) if (!baselines.has(String(x.k))) baselines.set(String(x.k), x.v === null ? null : Number(x.v));
    for (const f of fields.filter((x) => MEMBERSHIP_MONTHLY_KEYS.has(x.fieldKey))) {
      const bk = MEMBERSHIP_BASELINE_KEY[f.fieldKey];
      f.baseline = bk && baselines.has(bk) ? baselines.get(bk)! : null;
      const monthly: Record<number, number | null> = {};
      let total = 0;
      for (const mo of months) {
        const v = mo.isAvailable && f.monthly[mo.month] !== undefined ? f.monthly[mo.month] : null;
        monthly[mo.month] = v;
        total += v ?? 0;
      }
      f.monthly = monthly;
      f.total = total;
    }
  }

  /** Membership month-wise from charter / join dates: baseline before July 1, each month = additions. */
  private static async applyMembershipDateBuckets(conn: DbCommands, fields: GoalMonthlyFieldDto[], months: GoalMonthPeriodDto[], entityType: string, clubId: number, districtId: number, yearStart: string) {
    if (!fields.some((f) => MEMBERSHIP_MONTHLY_KEYS.has(f.fieldKey))) return;
    // yearStart.AddYears(1).AddDays(-1)
    const s = ymd(yearStart)!;
    const yearEnd = new Date(Date.UTC(s.y + 1, s.m - 1, s.d - 1)).toISOString().slice(0, 10) + " 00:00:00";
    const apply = (key: string, baseline: number, buckets: Map<string, number>) => {
      const f = fields.find((x) => x.fieldKey === key);
      if (!f) return;
      f.baseline = baseline;
      const monthly: Record<number, number | null> = {};
      let total = 0;
      for (const mo of months) {
        if (!mo.isAvailable) { monthly[mo.month] = null; continue; }
        const cnt = buckets.get(`${mo.calendarYear}-${mo.month}`) ?? 0;
        monthly[mo.month] = cnt;
        total += cnt;
      }
      f.monthly = monthly;
      f.total = total;
    };
    const has = (k: string) => fields.some((f) => f.fieldKey === k);
    const p = { S: yearStart, E: yearEnd };
    if (entityType === "District") {
      if (has("new_clubs_achieved"))
        apply("new_clubs_achieved", await liveDistrictClubCount(conn, districtId, yearStart), await monthBuckets(conn,
          `SELECT YEAR(ClubCharterDate) AS y, MONTH(ClubCharterDate) AS mo, COUNT(*) AS cnt
           FROM club_master
           WHERE fk_district_id = @Id AND IsActive = 1 AND isdeleted = 0
             AND ClubCharterDate IS NOT NULL AND ClubCharterDate >= @S AND ClubCharterDate <= @E
           GROUP BY YEAR(ClubCharterDate), MONTH(ClubCharterDate)`, { Id: districtId, ...p }));
      if (has("new_members_achieved"))
        apply("new_members_achieved", await liveDistrictMemberCount(conn, districtId, yearStart), await monthBuckets(conn, districtJoinsSql(false), { Id: districtId, ...p }));
      if (has("new_women_members_achieved"))
        apply("new_women_members_achieved", await liveDistrictWomenCount(conn, districtId, yearStart), await monthBuckets(conn, districtJoinsSql(true), { Id: districtId, ...p }));
    } else if (entityType === "Club") {
      if (has("new_members_achieved"))
        apply("new_members_achieved", await liveClubCount(conn, clubId, yearStart, false), await monthBuckets(conn, clubJoinsSql(false), { Id: clubId, ...p }));
      if (has("new_women_members_achieved"))
        apply("new_women_members_achieved", await liveClubCount(conn, clubId, yearStart, true), await monthBuckets(conn, clubJoinsSql(true), { Id: clubId, ...p }));
    }
  }

  // ── Month-wise saves ──────────────────────────────────────────────────────

  /** Upsert one month's collected values; admins only the current month and never the imported Foundation fields. */
  protected async saveMonthlyCore(conn: DbCommands, categoryId: number, yearId: number, entityType: string, clubId: number, districtId: number, month: number, entries: GoalMonthlySaveDto[], memberId: number, restrictToCurrentMonth = false) {
    const yr = await conn.queryFirstOrDefault("SELECT StartDate AS s FROM rotary_year_master WHERE pk_year_id = @Y AND isdeleted = 0", { Y: yearId });
    if (!yr || !yr.s) throw new InvalidOperationException("Invalid year.");
    const months = buildRotaryMonths(yr.s);
    const period = months.find((m) => m.month === month);
    if (!period) throw new InvalidOperationException("That month is not part of this Rotary year.");
    if (!period.isAvailable) throw new InvalidOperationException("That month hasn't started yet.");
    if (restrictToCurrentMonth) {
      const t = today();
      const current = months.find((m) => m.month === t.m && m.calendarYear === t.y);
      if (!current || current.month !== month) throw new InvalidOperationException("You can only edit the current month.");
    }
    const keys = Object.keys(MONTHLY_COLLECTED_TO_TARGET).filter((k) => !restrictToCurrentMonth || !IMPORTED_MONTHLY_FIELD_KEYS.has(k));
    const valid = new Set((await conn.query("SELECT f.pk_field_id AS id FROM goal_fields f WHERE f.fk_category_id = @Cat AND f.isdeleted = 0 AND f.FieldKey IN @Keys", { Cat: categoryId, Keys: keys })).map((r) => Number(r.id)));
    for (const e of entries) {
      if (!valid.has(e.fieldId)) continue;
      await conn.execute(
        `INSERT INTO goal_entries_monthly
             (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, PeriodMonth, NumericValue, created_by, created_date, isdeleted)
         VALUES (@F, @Y, @E, @C, @D, @M, @V, @By, NOW(), 0)
         ON DUPLICATE KEY UPDATE NumericValue = @V, modified_by = @By, modified_date = NOW(), isdeleted = 0`,
        { F: e.fieldId, Y: yearId, E: entityType, C: clubId, D: districtId, M: month, V: e.numericValue, By: memberId },
      );
    }
  }

  /** On an annual save inside the current Rotary year, stamp the live values into the current month. */
  protected async snapshotCurrentMonth(conn: DbCommands, categoryId: number, yearId: number, entityType: string, clubId: number, districtId: number, memberId: number) {
    const { start, end } = await GoalCore.yearRange(conn, yearId);
    if (!start || !end) return;
    const t = today();
    const tIso = `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
    if (tIso < start.slice(0, 10) || tIso > end.slice(0, 10)) return;
    for (const f of await this.loadFieldsWithValues(conn, categoryId, yearId, entityType, clubId, districtId, true)) {
      if (!(f.fieldKey in MONTHLY_COLLECTED_TO_TARGET)) continue;
      await conn.execute(
        `INSERT INTO goal_entries_monthly
             (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, PeriodMonth, NumericValue, created_by, created_date, isdeleted)
         VALUES (@F, @Y, @E, @C, @D, @M, @V, @By, NOW(), 0)
         ON DUPLICATE KEY UPDATE NumericValue = @V, modified_by = @By, modified_date = NOW(), isdeleted = 0`,
        { F: f.fieldId, Y: yearId, E: entityType, C: clubId, D: districtId, M: t.m, V: f.numericValue, By: memberId },
      );
    }
  }

  async getDistrictMonthlyGoalForm(memberId: number, categoryId: number, yearId: number | null, requestedDistrictId: number | null, readOnly = false): Promise<GoalMonthlyFormDto | null> {
    return this.db.session(async (conn) => {
      if (await GoalCore.isAnnualOnlyCategoryId(conn, categoryId)) return null;
      const districtId = await this.resolveDistrictId(conn, memberId, requestedDistrictId);
      if (districtId === 0) return null;
      const y = await this.resolveYear(conn, yearId);
      if (y.yearId === 0) return null;
      const name = String((await conn.executeScalar("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", { Id: districtId })) ?? "");
      return this.buildMonthlyForm(conn, categoryId, y.yearId, "District", 0, districtId, name, !readOnly);
    });
  }

  /** Read-only month-wise of any district in the caller's goal scope (not district-admin gated). */
  async getDistrictMonthlyGoalFormScoped(memberId: number, categoryId: number, yearId: number | null, districtId: number): Promise<GoalMonthlyFormDto | null> {
    if (districtId <= 0) return null;
    return this.db.session(async (conn) => {
      if (await GoalCore.isAnnualOnlyCategoryId(conn, categoryId)) return null;
      await this.assertDistrictInGoalScope(conn, memberId, districtId);
      const y = await this.resolveYear(conn, yearId);
      if (y.yearId === 0) return null;
      const name = String((await conn.executeScalar("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", { Id: districtId })) ?? "");
      return this.buildMonthlyForm(conn, categoryId, y.yearId, "District", 0, districtId, name, false);
    });
  }

  /** SuperAdmin, or a district in one of the caller's goal-role assignments. */
  protected async assertDistrictInGoalScope(conn: DbCommands, memberId: number, districtId: number) {
    if (await this.isSuperAdmin(conn, memberId)) return;
    const allowed = new Set((await this.getMyAssignments(memberId)).flatMap((a) => a.districtIds));
    if (!allowed.has(districtId)) throw new UnauthorizedAccessException("This district is outside your goal-setting scope.");
  }

  async saveDistrictMonthlyGoals(memberId: number, categoryId: number, request: SaveGoalMonthlyRequest, requestedDistrictId: number | null): Promise<GoalMonthlyFormDto> {
    if (request.yearId <= 0) throw new InvalidOperationException("yearId required");
    const districtId = await this.db.session(async (conn) => {
      if (await GoalCore.isAnnualOnlyCategoryId(conn, categoryId)) throw new InvalidOperationException("This category is annual only - it has no month-wise entry.");
      const districtId = await this.resolveDistrictId(conn, memberId, requestedDistrictId);
      if (districtId === 0) throw new UnauthorizedAccessException("No district admin assignment found.");
      const sa = await this.isSuperAdmin(conn, memberId);
      await this.saveMonthlyCore(conn, categoryId, request.yearId, "District", 0, districtId, request.month, request.entries, memberId, !sa);
      return districtId;
    });
    return (await this.getDistrictMonthlyGoalForm(memberId, categoryId, request.yearId, districtId))!;
  }

  async getClubMonthlyGoalForm(memberId: number, categoryId: number, yearId: number | null, requestedClubId: number | null, readOnly = false): Promise<GoalMonthlyFormDto | null> {
    return this.db.session(async (conn) => {
      if (await GoalCore.isAnnualOnlyCategoryId(conn, categoryId)) return null;
      const clubId = await this.resolveClubId(conn, memberId, requestedClubId);
      if (clubId === 0) return null;
      const y = await this.resolveYear(conn, yearId);
      if (y.yearId === 0) return null;
      const name = String((await conn.executeScalar("SELECT ClubName FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0", { Id: clubId })) ?? "");
      return this.buildMonthlyForm(conn, categoryId, y.yearId, "Club", clubId, 0, name, !readOnly);
    });
  }

  async saveClubMonthlyGoals(memberId: number, categoryId: number, request: SaveGoalMonthlyRequest, requestedClubId: number | null): Promise<GoalMonthlyFormDto> {
    if (request.yearId <= 0) throw new InvalidOperationException("yearId required");
    const clubId = await this.db.session(async (conn) => {
      if (await GoalCore.isAnnualOnlyCategoryId(conn, categoryId)) throw new InvalidOperationException("This category is annual only - it has no month-wise entry.");
      const clubId = await this.resolveClubId(conn, memberId, requestedClubId);
      if (clubId === 0) throw new UnauthorizedAccessException("No club admin assignment found.");
      const sa = await this.isSuperAdmin(conn, memberId);
      await this.saveMonthlyCore(conn, categoryId, request.yearId, "Club", clubId, 0, request.month, request.entries, memberId, !sa);
      return clubId;
    });
    return (await this.getClubMonthlyGoalForm(memberId, categoryId, request.yearId, clubId))!;
  }

  // ── Target split (the yearly target spread over months / quarters; it must add up exactly) ──

  private static async saveTargetSplitCore(conn: DbCommands, yearId: number, entityType: string, clubId: number, districtId: number, req: SaveGoalTargetSplitRequest, memberId: number, form: GoalMonthlyFormDto) {
    const byQuarter = ci(req.period, "quarter");
    const byField = new Map(form.fields.filter((f) => f.monthlyTracked).map((f) => [f.fieldId, f]));
    const monthOrder = form.months.map((m) => m.month);
    const toWrite = new Map<number, Map<number, number | null>>();
    const errors: GoalTargetSplitErrorDto[] = [];
    const negatives: string[] = [];
    const val = (o: Record<number, number | null> | undefined, k: number) => (o && o[k] !== undefined && o[k] !== null ? Number(o[k]) : null);

    for (const incoming of req.fields ?? []) {
      const fld = byField.get(incoming.fieldId);
      if (!fld) continue;
      const months = new Map<number, number | null>();
      if (byQuarter)
        for (let q = 1; q <= 4; q++) {
          const qv = val(incoming.values, q);
          const spread = spreadTarget(qv ?? 0, QUARTER_MONTHS[q - 1].length);
          QUARTER_MONTHS[q - 1].forEach((m, i) => months.set(m, qv !== null ? spread[i] : null));
        }
      else for (const m of monthOrder) months.set(m, val(incoming.values, m));

      const negative = [...months.entries()].filter(([, v]) => v !== null && v < 0).map(([k]) => k);
      if (negative.length) negatives.push(`${monthlyMetricLabel(fld)}: ${negative.map((m) => ROTARY_MONTH_LABELS[m - 1]).join(", ")}`);
      if (fld.splitBase !== null) {
        const entered = [...months.values()].reduce<number>((s, v) => s + (v ?? 0), 0);
        if (entered !== fld.splitBase)
          errors.push({ fieldId: fld.fieldId, fieldLabel: fld.fieldLabel, annualTarget: fld.splitBase, entered, difference: entered - fld.splitBase });
      }
      toWrite.set(incoming.fieldId, months);
    }
    if (negatives.length) throw new InvalidOperationException("A quarterly or month-wise target cannot be negative (0 is allowed). " + negatives.join(" | "));
    if (errors.length) {
      const f = (n: number) => formatNumber(n, "0.##");
      const lines = errors.map((e) => `${e.fieldLabel}: yearly target ${f(e.annualTarget)}, entered ${f(e.entered)} (${e.difference > 0 ? `${f(e.difference)} too much` : `${f(-e.difference)} short`})`);
      throw new InvalidOperationException("The split must add up to the yearly target exactly. " + lines.join(" | "));
    }
    for (const [fieldId, months] of toWrite)
      for (const [month, v] of months)
        await conn.execute(
          `INSERT INTO goal_entries_monthly
               (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, PeriodMonth,
                TargetValue, created_by, created_date, isdeleted)
           VALUES (@F, @Y, @E, @C, @D, @M, @T, @By, NOW(), 0)
           ON DUPLICATE KEY UPDATE TargetValue = VALUES(TargetValue),
               modified_by = @By, modified_date = NOW(), isdeleted = 0`,
          { F: fieldId, Y: yearId, E: entityType, C: clubId, D: districtId, M: month, T: v, By: memberId },
        );
  }

  async saveDistrictTargetSplit(memberId: number, categoryId: number, req: SaveGoalTargetSplitRequest, requestedDistrictId: number | null): Promise<GoalMonthlyFormDto> {
    if (req.yearId <= 0) throw new InvalidOperationException("yearId required");
    const { districtId, yearId } = await this.db.session(async (conn) => {
      if (await GoalCore.isAnnualOnlyCategoryId(conn, categoryId)) throw new InvalidOperationException("This category is annual only - it has no quarterly or month-wise target.");
      const districtId = await this.resolveDistrictId(conn, memberId, requestedDistrictId);
      if (districtId === 0) throw new UnauthorizedAccessException("No district admin assignment found.");
      if (!this.splitPilotAllows("district", districtId)) throw new InvalidOperationException(NOT_IN_PILOT_MESSAGE);
      const y = await this.resolveYear(conn, req.yearId);
      if (!y.isEditable) throw new InvalidOperationException("Past years are read-only and cannot be edited.");
      if ((await this.getLock(conn, "District", 0, districtId, categoryId, y.yearId)).isLocked) throw new InvalidOperationException("This category is locked and cannot be edited.");
      return { districtId, yearId: y.yearId };
    });
    const form = await this.getDistrictMonthlyGoalForm(memberId, categoryId, yearId, districtId);
    if (!form) throw new InvalidOperationException("No month-wise metrics for this category.");
    await this.db.session((conn) => GoalForms.saveTargetSplitCore(conn, yearId, "District", 0, districtId, req, memberId, form));
    return (await this.getDistrictMonthlyGoalForm(memberId, categoryId, yearId, districtId))!;
  }

  async saveClubTargetSplit(memberId: number, categoryId: number, req: SaveGoalTargetSplitRequest, requestedClubId: number | null): Promise<GoalMonthlyFormDto> {
    if (req.yearId <= 0) throw new InvalidOperationException("yearId required");
    const { clubId, yearId } = await this.db.session(async (conn) => {
      if (await GoalCore.isAnnualOnlyCategoryId(conn, categoryId)) throw new InvalidOperationException("This category is annual only - it has no quarterly or month-wise target.");
      const clubId = await this.resolveClubId(conn, memberId, requestedClubId);
      if (clubId === 0) throw new UnauthorizedAccessException("No club admin assignment found.");
      if (!this.splitPilotAllows("club", clubId)) throw new InvalidOperationException(NOT_IN_PILOT_MESSAGE);
      const y = await this.resolveYear(conn, req.yearId);
      if (!y.isEditable) throw new InvalidOperationException("Past years are read-only and cannot be edited.");
      if ((await this.getLock(conn, "Club", clubId, 0, categoryId, y.yearId)).isLocked) throw new InvalidOperationException("This category is locked and cannot be edited.");
      return { clubId, yearId: y.yearId };
    });
    const form = await this.getClubMonthlyGoalForm(memberId, categoryId, yearId, clubId);
    if (!form) throw new InvalidOperationException("No month-wise metrics for this category.");
    await this.db.session((conn) => GoalForms.saveTargetSplitCore(conn, yearId, "Club", clubId, 0, req, memberId, form));
    return (await this.getClubMonthlyGoalForm(memberId, categoryId, yearId, clubId))!;
  }
}

/** Count per (calendar year, month) as "y-m" -> count. */
async function monthBuckets(conn: DbCommands, sql: string, p: Record<string, unknown>) {
  const map = new Map<string, number>();
  for (const r of (await conn.query(sql, p)) as Row[]) map.set(`${Number(r.y)}-${Number(r.mo)}`, Number(r.cnt));
  return map;
}
const districtJoinsSql = (women: boolean) => `SELECT YEAR(cm.JoinedDate) AS y, MONTH(cm.JoinedDate) AS mo, COUNT(DISTINCT m.pk_member_master_profile_id) AS cnt
       FROM club_members cm
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id
       JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
       WHERE c.fk_district_id = @Id
         AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
         AND c.IsActive = 1 AND c.isdeleted = 0 AND c.IsSyncedFromRotaryOrg = 1
         AND m.isdeleted = 0${women ? " AND m.Gender = 'Female'" : ""}
         AND cm.JoinedDate IS NOT NULL AND cm.JoinedDate >= @S AND cm.JoinedDate <= @E
       GROUP BY YEAR(cm.JoinedDate), MONTH(cm.JoinedDate)`;
const clubJoinsSql = (women: boolean) => `SELECT YEAR(cm.JoinedDate) AS y, MONTH(cm.JoinedDate) AS mo, COUNT(DISTINCT m.pk_member_master_profile_id) AS cnt
       FROM club_members cm
       JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
       WHERE cm.fk_club_id = @Id
         AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
         AND m.isdeleted = 0${women ? " AND m.Gender = 'Female'" : ""}
         AND cm.JoinedDate IS NOT NULL AND cm.JoinedDate >= @S AND cm.JoinedDate <= @E
       GROUP BY YEAR(cm.JoinedDate), MONTH(cm.JoinedDate)`;
