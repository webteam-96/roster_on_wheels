import { Db, type DbCommands, type Row } from "../../database/db.service";
import { Brand } from "../../brand/brand";
import { formatDate, formatNumber, nowIn } from "../../common/dotnet-format";
import { dbDateTime } from "../../common/binding";
import { InvalidOperationException, UnauthorizedAccessException } from "../../common/exceptions";
import { isSuperAdminMember } from "../../services/club-admin-access.helper";
import { AppConfig } from "../../config/app-config";
import { RoleService } from "../roles/role.service";
import type { GoalCategoryDto, GoalEntrySaveDto, GoalFieldWithValueDto, GoalLockStatusDto, GoalMonthlyFieldDto, GoalMonthPeriodDto } from "./goal-setting.dtos";

// ── Small helpers shared by every layer of the Goal Setting port ─────────────────────────────

/** Math.Round(v, n, MidpointRounding.AwayFromZero). */
export function roundAway(v: number, n = 0): number {
  const f = 10 ** n;
  const x = Math.abs(v) * f;
  // guard binary noise (2.675 * 100 = 267.49999…) the way decimal arithmetic never sees it
  const r = Math.floor(x + 0.5 + 1e-9);
  return (Math.sign(v) * r) / f;
}
/** Whole(): Goal Setting shows whole numbers only (RIZones 2026-09-29). */
export const whole = (v: number) => roundAway(v, 0);
export const wholeN = (v: number | null | undefined): number | null => (v === null || v === undefined ? null : whole(v));
export const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
export const ci = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

/** A DATE/DATETIME value from the db as calendar parts (no zone shift). */
export function ymd(v: unknown): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** start.AddMonths(i) for a first-of-month (or any) date, as calendar parts. */
export function addMonths(p: { y: number; m: number; d: number }, i: number) {
  const t = p.y * 12 + (p.m - 1) + i;
  const y = Math.floor(t / 12), m = (t % 12) + 1;
  return { y, m, d: Math.min(p.d, daysInMonth(y, m)) };
}
const pad2 = (n: number) => String(n).padStart(2, "0");
export const isoDate = (p: { y: number; m: number; d: number }) => `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
/** DateTime.Today in the brand's time zone (RIZones used the server's IST clock). */
export const today = () => ymd(nowIn(Brand.Current.locale.defaultTimeZone))!;
export const todayIso = () => isoDate(today());

/** catch (MySqlException): any error raised by the MySQL server (e.g. a table not created yet). */
export const isMysqlError = (e: unknown) => !!e && typeof e === "object" && "sqlMessage" in e;

/** decimal.ToString("N0") as RIZones prints counts in messages. */
export const n0 = (v: number) => formatNumber(v, "N0");

export const RI_DIRECTOR = "AllCategoryAllDistrictsFewZones";
export const ZONE_COORDINATOR = "AllDistrictsOneCategoryOneZone";
export const DISTRICT_ASSISTANT = "FewDistrictsOneCategoryOneZone";

/** Rotary year runs July→June: quarters Jul-Sep, Oct-Dec, Jan-Mar, Apr-Jun. */
export const quarterOfMonth = (m: number) => (m >= 7 && m <= 9 ? 1 : m >= 10 ? 2 : m <= 3 ? 3 : 4);
export const QUARTER_MONTHS = [[7, 8, 9], [10, 11, 12], [1, 2, 3], [4, 5, 6]];
export const ROTARY_MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Spread a total over N slots, the last slot absorbing the remainder so the sum is exact. */
export function spreadTarget(total: number, slots: number): number[] {
  const out: number[] = [];
  if (slots <= 0) return out;
  const each = Math.trunc(total / slots);
  let used = 0;
  for (let i = 0; i < slots - 1; i++) { out.push(each); used += each; }
  out.push(total - used);
  return out;
}

/** Fields the forms never take from a save: imported or system-filled figures (RIZones SystemFilledFieldKeys). */
export const SYSTEM_FILLED_FIELD_KEYS = new Set([
  "total_clubs", "new_clubs_achieved", "total_members", "new_members_achieved",
  "existing_women_members", "new_women_members_achieved",
  "rag_red", "rag_amber", "rag_green", "rag_super_green",
  "aks_achieved", "endowment_achieved", "bequest_achieved", "directed_gift_achieved",
  "polio_plus_achieved", "annual_fund_achieved", "phf_achieved", "phsm_achieved",
  "major_donors_achieved", "csr_achieved", "total_giving_achieved", "total_giving_pct",
  "club_af_per_capita", "club_annual_fund_ytd", "club_polioplus_ytd",
  "club_other_funds_ytd", "club_endowment_ytd", "club_total_ytd",
  "rotaract_clubs_achieved", "interact_clubs_achieved",
]);
/** Locked on the DISTRICT form only (from the Rotary.org Rotaract / Interact files). */
export const DISTRICT_SYSTEM_FILLED_FIELD_KEYS = new Set(["rotaract_existing_clubs", "interact_existing_clubs", "rotaract_existing_members", "rotaract_members_achieved"]);
/** Month-wise Foundation figures come from the imports only. */
export const IMPORTED_MONTHLY_FIELD_KEYS = new Set([
  "annual_fund_achieved", "polio_plus_achieved", "endowment_achieved", "csr_achieved",
  "club_af_per_capita", "club_annual_fund_ytd", "club_polioplus_ytd", "club_other_funds_ytd", "club_endowment_ytd",
]);

/** Collected (month-wise) field → its paired annual target field ("" = no separate target). */
export const MONTHLY_COLLECTED_TO_TARGET: Record<string, string> = {
  new_members_achieved: "new_members", new_women_members_achieved: "new_women_members", new_clubs_achieved: "new_clubs",
  annual_fund_achieved: "annual_fund_target", polio_plus_achieved: "polio_plus_target", endowment_achieved: "endowment_target", csr_achieved: "csr_target",
  club_af_per_capita: "club_af_per_capita_target", club_annual_fund_ytd: "club_annual_fund_ytd_target", club_polioplus_ytd: "club_polioplus_ytd_target",
  club_other_funds_ytd: "club_other_funds_ytd_target", club_endowment_ytd: "club_endowment_ytd_target",
  rotaract_new_clubs_target: "", rotaract_new_members_target: "", interact_new_clubs_target: "", rcc_new_clubs_target: "",
  district_polio_awareness_programme: "", inter_district_pi_programme: "", bulletin_newsletter: "", mega_pi_activities: "",
  adoption_garden_park_road: "", display_items: "", press_media_coverage: "", public_rally: "",
};
/** Youth Service (district) achieved / % fields that sit in no metric block of their own. */
export const YOUTH_DISTRICT_OWN_KEYS = new Set([
  "rotaract_clubs_achieved", "rotaract_clubs_pct", "rotaract_members_achieved", "rotaract_members_pct",
  "interact_clubs_achieved", "interact_clubs_pct", "rcc_clubs_achieved", "rcc_clubs_pct",
]);
/** The 3 Membership monthly metrics auto-derived from charter / join dates. */
export const MEMBERSHIP_MONTHLY_KEYS = new Set(["new_clubs_achieved", "new_members_achieved", "new_women_members_achieved"]);

/** Youth Service and Public Image are ANNUAL ONLY: no month-wise surface. */
const ANNUAL_ONLY_CATEGORIES = new Set(["youth service", "public image"]);
export const isAnnualOnlyCategory = (name: string | null | undefined) => !!name && !!name.trim() && ANNUAL_ONLY_CATEGORIES.has(name.toLowerCase());

/** District Membership from the Rotary.org Excel from Rotary year 2026-27 (RIZones 2026-10-08). */
export const MEMBERSHIP_IMPORT_FROM_YEAR_START = "2026-07-01";
export const MEMBERSHIP_IMPORT_SCOPE = "Membership";
export const YOUTH_IMPORT_SCOPE = "Youth";
export const isDistrictMembershipImported = (entityType: string, yearStart: string | null) =>
  entityType === "District" && !!yearStart && yearStart.slice(0, 10) >= MEMBERSHIP_IMPORT_FROM_YEAR_START;

const CURRENT_YEAR_TARGET_LABEL = "Target for the Current year";

/** EvaluateSimpleExpression: "a / b", "a * literal" or "a + b [+ c]" against sibling FieldKeys. */
export function evaluateSimpleExpression(expr: string, values: Map<string, number>): number {
  const resolve = (token: string) => {
    const t = token.trim();
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return Number(t);
    return values.get(t) ?? 0;
  };
  if (expr.includes("/")) {
    const parts = expr.split("/");
    const denom = resolve(parts[1]);
    return denom === 0 ? 0 : roundAway(resolve(parts[0]) / denom, 0);
  }
  if (expr.includes("*")) {
    const parts = expr.split("*");
    return resolve(parts[0]) * resolve(parts[1]);
  }
  if (expr.includes("+")) return expr.split("+").reduce((s, t) => s + resolve(t), 0);
  return resolve(expr);
}

/** The lowest legal value of a current-year target: its group's "as on July 1st" figure. */
export function targetFloor(fields: GoalFieldWithValueDto[], target: GoalFieldWithValueDto): { floor: number; from: string | null } {
  if (target.fieldRole !== "Target" || !ci(target.fieldLabel.trim(), CURRENT_YEAR_TARGET_LABEL)) return { floor: 0, from: null };
  let floor = 0;
  let from: string | null = null;
  for (const f of fields)
    if (f.groupName === target.groupName && f.fieldRole === "Reference" && f.fieldLabel.toLowerCase().includes("as on july 1st") && f.numericValue !== null && f.numericValue > 0 && f.numericValue > floor) {
      floor = f.numericValue;
      from = ci(f.fieldLabel.trim(), "Achieved") ? "already achieved this year" : "as on July 1st";
    }
  return { floor, from };
}
export function applyTargetFloors(fields: GoalFieldWithValueDto[]) {
  for (const f of fields) {
    const { floor } = targetFloor(fields, f);
    f.minValue = floor > 0 ? floor : null;
  }
}

/** Every figure a month-wise surface prints, rounded to whole numbers in one pass. */
export function roundToWhole(f: GoalMonthlyFieldDto) {
  for (const k of Object.keys(f.monthly)) f.monthly[+k] = wholeN(f.monthly[+k]);
  for (const k of Object.keys(f.monthlyTargets)) f.monthlyTargets[+k] = wholeN(f.monthlyTargets[+k]);
  for (const k of Object.keys(f.quarterlyTargets)) f.quarterlyTargets[+k] = wholeN(f.quarterlyTargets[+k]);
  for (const k of Object.keys(f.quarterlyAchieved)) f.quarterlyAchieved[+k] = wholeN(f.quarterlyAchieved[+k]);
  f.annualTarget = wholeN(f.annualTarget);
  f.baseline = wholeN(f.baseline);
  f.splitBase = wholeN(f.splitBase);
  f.total = whole(f.total);
  f.targetTotal = whole(f.targetTotal);
}

/** Fill MonthlyTargets / QuarterlyTargets: saved split, else an even suggestion of the growth. */
export function applyTargetSplit(dto: GoalMonthlyFieldDto, months: GoalMonthPeriodDto[], saved: Map<number, number | null> | undefined) {
  const order = months.map((m) => m.month);
  const anySaved = !!saved && [...saved.values()].some((v) => v !== null);
  dto.splitBase = dto.annualTarget !== null ? (dto.baseline !== null ? dto.annualTarget - dto.baseline : dto.annualTarget) : null;
  if (!anySaved && dto.splitBase !== null && dto.splitBase > 0 && order.length > 0) {
    const spread = spreadTarget(dto.splitBase, order.length);
    order.forEach((m, i) => (dto.monthlyTargets[m] = spread[i]));
    dto.targetsAreSuggested = true;
  } else {
    for (const m of order) dto.monthlyTargets[m] = saved?.has(m) ? saved.get(m)! : null;
  }
  dto.targetTotal = Object.values(dto.monthlyTargets).reduce<number>((s, v) => s + (v ?? 0), 0);
  for (let q = 1; q <= 4; q++) {
    let qt: number | null = null, qa: number | null = null;
    for (const m of QUARTER_MONTHS[q - 1]) {
      const t = dto.monthlyTargets[m];
      if (t !== null && t !== undefined) qt = (qt ?? 0) + t;
      const a = dto.monthly[m];
      if (a !== null && a !== undefined) qa = (qa ?? 0) + a;
    }
    dto.quarterlyTargets[q] = qt;
    dto.quarterlyAchieved[q] = qa;
  }
}

/** 12 Rotary-year months from the year start (Jul→Jun); IsAvailable = the month has started. */
export function buildRotaryMonths(startDate: unknown): GoalMonthPeriodDto[] {
  const start = ymd(startDate)!;
  const t = today();
  const todayKey = t.y * 12 + t.m;
  return Array.from({ length: 12 }, (_, i) => {
    const dt = addMonths({ ...start, d: 1 }, i);
    return { month: dt.m, label: ROTARY_MONTH_LABELS[dt.m - 1], calendarYear: dt.y, isAvailable: dt.y * 12 + dt.m <= todayKey };
  });
}

/** Rotary-year index of a calendar month (0 = the start month … 11). */
export const rotaryIndex = (month: number, startMonth: number) => (month - startMonth + 12) % 12;

/** "d MMM yyyy" of the last day of the latest of `months` in Rotary order. */
export function lastDayOfLatest(start: { y: number; m: number; d: number }, months: Iterable<number>): string | null {
  let bestIdx = -1;
  for (const pm of months) bestIdx = Math.max(bestIdx, rotaryIndex(pm, start.m));
  if (bestIdx < 0) return null;
  const best = addMonths(start, bestIdx);
  return formatDate(isoDate({ y: best.y, m: best.m, d: daysInMonth(best.y, best.m) }), "d MMM yyyy");
}

/**
 * Port of GoalSettingService.cs, layer 1 of the chain (core -> forms -> monthly -> matrices ->
 * roles -> messaging -> reports -> imports -> GoalSettingService): who may see what, the
 * field + value loading with its live counts and derived percentages, saving entries with the
 * computed fields, locks, and the target floor.
 */
export abstract class GoalCore {
  constructor(
    protected readonly db: Db,
    protected readonly roleService: RoleService,
    protected readonly config: AppConfig,
  ) {}

  protected isSuperAdmin = (conn: DbCommands, memberId: number) => isSuperAdminMember(conn, memberId);

  /** The categories a District Assistant may see on their OWN goal screens; null = no filter. */
  protected async daCategoryFilter(conn: DbCommands, memberId: number): Promise<Set<number> | null> {
    if (memberId <= 0) return null;
    if (await this.isSuperAdmin(conn, memberId)) return null;
    const isEntityAdmin = Number(await conn.executeScalar(
      `SELECT COUNT(*) FROM member_roles
       WHERE fk_member_master_profile_id = @M AND fk_role_id = 2 AND IsActive = 1 AND isdeleted = 0`,
      { M: memberId },
    ));
    if (isEntityAdmin > 0) return null;
    return this.categoryFilterFromAssignments(conn, memberId);
  }

  /** The same rule on the goal-oversight screens: a District Assistant sees only their category even when also an Admin. */
  protected async oversightCategoryFilter(conn: DbCommands, memberId: number): Promise<Set<number> | null> {
    if (memberId <= 0) return null;
    if (await this.isSuperAdmin(conn, memberId)) return null;
    return this.categoryFilterFromAssignments(conn, memberId);
  }

  private async categoryFilterFromAssignments(conn: DbCommands, memberId: number) {
    const cats = new Set<number>();
    for (const r of await this.getActiveAssignmentRows(conn, memberId)) {
      if (r.roleType === RI_DIRECTOR || r.roleType === ZONE_COORDINATOR) return null;
      if (r.roleType === DISTRICT_ASSISTANT && r.categoryId !== null) cats.add(Number(r.categoryId));
    }
    return cats.size ? cats : null;
  }

  /** Raw active goal-role assignment rows of one member. */
  protected getActiveAssignmentRows(conn: DbCommands, memberId: number): Promise<Row[]> {
    return conn.query(
      `SELECT pk_id AS id, RoleType AS roleType, AssignmentName AS assignmentName, fk_category_id AS categoryId, fk_zone_id AS zoneId
       FROM goal_role_assignments
       WHERE fk_member_id = @MemberId AND IsActive = 1 AND isdeleted = 0`,
      { MemberId: memberId },
    );
  }

  async getCategoriesFor(callerMemberId: number): Promise<GoalCategoryDto[]> {
    const all = await this.getCategories();
    const only = await this.db.session((conn) => this.daCategoryFilter(conn, callerMemberId));
    return only === null ? all : all.filter((c) => only.has(c.id));
  }

  async getOversightCategories(callerMemberId: number): Promise<GoalCategoryDto[]> {
    const all = await this.getCategories();
    const only = await this.db.session((conn) => this.oversightCategoryFilter(conn, callerMemberId));
    return only === null ? all : all.filter((c) => only.has(c.id));
  }

  async getCategories(): Promise<GoalCategoryDto[]> {
    const rows = await this.db.query("SELECT pk_category_id AS id, IF(Name = 'TRF', 'Foundation', Name) AS name, SortOrder AS sortOrder FROM goal_categories WHERE isdeleted = 0 ORDER BY SortOrder");
    return rows.map((r) => ({ id: Number(r.id), name: String(r.name), sortOrder: Number(r.sortOrder), hasMonthWise: !isAnnualOnlyCategory(String(r.name)) }));
  }

  /** The club a member acts on: requested (own admin/moderator, district admin, SuperAdmin) else their own. */
  protected async resolveClubId(conn: DbCommands, memberId: number, requestedClubId: number | null): Promise<number> {
    if (memberId <= 0) return 0;
    if (requestedClubId !== null && requestedClubId > 0) {
      const isSelfAdmin = Number(await conn.executeScalar(
        `SELECT COUNT(*) FROM member_roles
         WHERE fk_member_master_profile_id = @MemberId AND fk_role_id IN (2, 5)
           AND fk_club_id = @ClubId AND IsActive = 1 AND isdeleted = 0`,
        { MemberId: memberId, ClubId: requestedClubId },
      ));
      if (isSelfAdmin > 0) return requestedClubId;
      const isDistrictAdminForClub = Number(await conn.executeScalar(
        `SELECT COUNT(*) FROM member_roles mr
         JOIN club_master c ON c.pk_club_id = @ClubId AND c.isdeleted = 0
         WHERE mr.fk_member_master_profile_id = @MemberId AND mr.fk_role_id = 2
           AND mr.fk_district_id = c.fk_district_id
           AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
           AND mr.IsActive = 1 AND mr.isdeleted = 0`,
        { MemberId: memberId, ClubId: requestedClubId },
      ));
      if (isDistrictAdminForClub > 0) return requestedClubId;
      if (await this.isSuperAdmin(conn, memberId)) return requestedClubId;
      throw new UnauthorizedAccessException("You are not authorised for this club's goals.");
    }
    for (const role of [2, 5]) {
      const clubId = Number(await conn.executeScalar(
        `SELECT fk_club_id FROM member_roles
         WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = ${role}
           AND fk_club_id IS NOT NULL AND fk_club_id > 0 AND IsActive = 1 AND isdeleted = 0
         ORDER BY pk_member_role_id DESC LIMIT 1`,
        { MemberId: memberId },
      ) ?? 0);
      if (clubId > 0) return clubId;
    }
    return 0;
  }

  /** The district a member acts on: SuperAdmin any; District Admin; Zonal Coordinator of its zone; else their own. */
  protected async resolveDistrictId(conn: DbCommands, memberId: number, requestedDistrictId: number | null): Promise<number> {
    if (memberId <= 0) return 0;
    const requested = requestedDistrictId !== null && requestedDistrictId > 0 ? requestedDistrictId : null;
    if (requested !== null) {
      if (await this.isSuperAdmin(conn, memberId)) return requested;
      const isDistrictAdmin = Number(await conn.executeScalar(
        `SELECT COUNT(*) FROM member_roles
         WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2
           AND fk_district_id = @DistrictId
           AND (fk_club_id IS NULL OR fk_club_id = 0)
           AND IsActive = 1 AND isdeleted = 0`,
        { MemberId: memberId, DistrictId: requested },
      ));
      if (isDistrictAdmin > 0) return requested;
      const isZonalCoord = Number(await conn.executeScalar(
        `SELECT COUNT(*) FROM member_roles mr
         JOIN district_master d ON d.pk_district_id = @DistrictId AND d.isdeleted = 0
         WHERE mr.fk_member_master_profile_id = @MemberId AND mr.fk_role_id = 4
           AND mr.fk_zone_id = d.fk_zone_id
           AND mr.IsActive = 1 AND mr.isdeleted = 0`,
        { MemberId: memberId, DistrictId: requested },
      ));
      if (isZonalCoord > 0) return requested;
      throw new UnauthorizedAccessException("You are not an active admin for this district.");
    }
    return Number(await conn.executeScalar(
      `SELECT fk_district_id FROM member_roles
       WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2
         AND fk_district_id IS NOT NULL AND fk_district_id > 0
         AND (fk_club_id IS NULL OR fk_club_id = 0)
         AND IsActive = 1 AND isdeleted = 0
       ORDER BY pk_member_role_id DESC LIMIT 1`,
      { MemberId: memberId },
    ) ?? 0);
  }

  /** The requested year, else the current one; editable while it has not ended. */
  protected async resolveYear(conn: DbCommands, yearId: number | null): Promise<{ yearId: number; yearLabel: string; isEditable: boolean }> {
    const row = yearId !== null && yearId > 0
      ? await conn.queryFirstOrDefault("SELECT pk_year_id AS id, YearLabel AS label, (EndDate >= CURDATE()) AS editable FROM rotary_year_master WHERE pk_year_id = @Id AND isdeleted = 0", { Id: yearId })
      : await conn.queryFirstOrDefault("SELECT pk_year_id AS id, YearLabel AS label, (EndDate >= CURDATE()) AS editable FROM rotary_year_master WHERE isdeleted = 0 AND IsCurrent = 1 ORDER BY pk_year_id DESC LIMIT 1");
    if (!row) return { yearId: 0, yearLabel: "", isEditable: false };
    return { yearId: Number(row.id), yearLabel: String(row.label), isEditable: Boolean(Number(row.editable ?? 0)) };
  }

  protected static async yearRange(conn: DbCommands, yearId: number): Promise<{ start: string | null; end: string | null }> {
    const yr = await conn.queryFirstOrDefault("SELECT StartDate AS s, EndDate AS e FROM rotary_year_master WHERE pk_year_id = @Y AND isdeleted = 0", { Y: yearId });
    return { start: yr?.s ? dbDateTime(yr.s) : null, end: yr?.e ? dbDateTime(yr.e) : null };
  }

  protected static async categoryName(conn: DbCommands, categoryId: number): Promise<string> {
    return String((await conn.executeScalar("SELECT IF(Name = 'TRF', 'Foundation', Name) FROM goal_categories WHERE pk_category_id = @Id AND isdeleted = 0", { Id: categoryId })) ?? "");
  }

  protected static async isAnnualOnlyCategoryId(conn: DbCommands, categoryId: number) {
    return categoryId > 0 && isAnnualOnlyCategory(await GoalCore.categoryName(conn, categoryId));
  }

  /** Every field of the category with its value for one entity + year, live counts and derived figures applied. */
  protected async loadFieldsWithValues(conn: DbCommands, categoryId: number, yearId: number, entityType: string, clubId: number, districtId: number, autoFillLive = false): Promise<GoalFieldWithValueDto[]> {
    const rows = await conn.query(
      `SELECT f.pk_field_id AS fieldId, f.GroupName AS groupName, f.FieldKey AS fieldKey,
              f.FieldLabel AS fieldLabel, f.DataType AS dataType, f.Unit AS unit, f.FieldRole AS fieldRole,
              e.NumericValue AS numericValue, e.TextValue AS textValue, e.BoolValue AS boolValue
       FROM goal_fields f
       LEFT JOIN goal_entries e
              ON e.fk_field_id = f.pk_field_id AND e.fk_year_id = @YearId AND e.EntityType = @EntityType
             AND e.fk_club_id = @ClubId AND e.fk_district_id = @DistrictId AND e.isdeleted = 0
       WHERE f.fk_category_id = @CategoryId AND f.isdeleted = 0 AND f.IsActive = 1 AND f.IsHidden = 0
         AND (f.AppliesTo = 'Both' OR f.AppliesTo = @EntityType)
       ORDER BY f.SortOrder, f.pk_field_id`,
      { CategoryId: categoryId, YearId: yearId, EntityType: entityType, ClubId: clubId, DistrictId: districtId },
    );
    const list: GoalFieldWithValueDto[] = rows.map((r) => ({
      fieldId: Number(r.fieldId), groupName: String(r.groupName), fieldKey: String(r.fieldKey), fieldLabel: String(r.fieldLabel),
      dataType: String(r.dataType), unit: typeof r.unit === "string" ? r.unit : null, fieldRole: String(r.fieldRole),
      numericValue: r.numericValue === null || r.numericValue === undefined ? null : whole(Number(r.numericValue)),
      textValue: typeof r.textValue === "string" ? r.textValue : null,
      boolValue: r.boolValue === null || r.boolValue === undefined ? null : Boolean(Number(r.boolValue)),
      minValue: null,
    }));
    const get = (k: string) => list.find((f) => f.fieldKey === k);
    const v = (k: string) => get(k)?.numericValue ?? 0;

    const hasMembership = list.some((f) => ["total_clubs", "total_members", "existing_women_members", "new_clubs_achieved", "new_members_achieved", "new_women_members_achieved", "women_members_percent", "avg_members_per_club"].includes(f.fieldKey));
    if (autoFillLive || hasMembership) {
      let liveClubs: number | null = null, liveMembers: number | null = null, liveWomen: number | null = null;
      let newClubs: number | null = null, newWomen: number | null = null, newMembers: number | null = null;
      let rag: { red: number; amber: number; green: number; superGreen: number } | null = null;
      const { start, end } = await GoalCore.yearRange(conn, yearId);
      if (hasMembership && entityType === "District" && !isDistrictMembershipImported(entityType, start)) {
        liveClubs = await liveDistrictClubCount(conn, districtId, start);
        liveMembers = await liveDistrictMemberCount(conn, districtId, start);
        liveWomen = await liveDistrictWomenCount(conn, districtId, start);
        if (start && end) {
          newClubs = await achievedNewClubsDistrict(conn, districtId, start, end);
          newWomen = await achievedNewDistrict(conn, districtId, start, end, true);
          newMembers = await achievedNewDistrict(conn, districtId, start, end, false);
        }
      } else if (hasMembership && entityType === "Club") {
        liveMembers = await liveClubCount(conn, clubId, start, false);
        liveWomen = await liveClubCount(conn, clubId, start, true);
        if (start && end) {
          newWomen = await achievedNewClub(conn, clubId, start, end, true);
          newMembers = await achievedNewClub(conn, clubId, start, end, false);
        }
      }
      if (autoFillLive && entityType === "District") rag = await liveDistrictRagCounts(conn, districtId);
      for (const f of list) {
        if (f.fieldKey === "total_clubs" && liveClubs !== null) f.numericValue = liveClubs;
        else if (f.fieldKey === "total_members" && liveMembers !== null) f.numericValue = liveMembers;
        else if (f.fieldKey === "existing_women_members" && liveWomen !== null) f.numericValue = liveWomen;
        else if (f.fieldKey === "women_members_percent" && liveMembers !== null && liveMembers > 0 && liveWomen !== null) f.numericValue = roundAway((liveWomen / liveMembers) * 100, 0);
        else if (f.fieldKey === "avg_members_per_club" && liveClubs !== null && liveClubs > 0 && liveMembers !== null) f.numericValue = roundAway(liveMembers / liveClubs, 0);
        else if (f.fieldKey === "rag_red" && rag) f.numericValue = rag.red;
        else if (f.fieldKey === "rag_amber" && rag) f.numericValue = rag.amber;
        else if (f.fieldKey === "rag_green" && rag) f.numericValue = rag.green;
        else if (f.fieldKey === "rag_super_green" && rag) f.numericValue = rag.superGreen;
        // Achieved = the July-1st baseline + what was gained this year
        else if (f.fieldKey === "new_clubs_achieved" && newClubs !== null) f.numericValue = (liveClubs ?? 0) + newClubs;
        else if (f.fieldKey === "new_members_achieved" && newMembers !== null) f.numericValue = (liveMembers ?? 0) + newMembers;
        else if (f.fieldKey === "new_women_members_achieved" && newWomen !== null) f.numericValue = (liveWomen ?? 0) + newWomen;
      }
    }

    // TRF (district) Total Giving: Achieved = the four funds, % = that ÷ the current-year target (always worked out).
    const tgAchieved = get("total_giving_achieved");
    if (tgAchieved) tgAchieved.numericValue = v("annual_fund_achieved") + v("polio_plus_achieved") + v("endowment_achieved") + v("csr_achieved");
    const tgPct = get("total_giving_pct");
    if (tgPct) {
      const tgt = v("total_contributions_target");
      tgPct.numericValue = tgt > 0 ? roundAway(Math.max(0, Math.min(100, ((tgAchieved?.numericValue ?? 0) / tgt) * 100)), 2) : 0;
    }
    // TRF (club) Total: filled only while the box is empty, so a typed figure is never overwritten.
    const clubTotal = get("club_total_ytd");
    if (clubTotal && clubTotal.numericValue === null)
      clubTotal.numericValue = v("club_af_per_capita") + v("club_annual_fund_ytd") + v("club_polioplus_ytd") + v("club_other_funds_ytd") + v("club_endowment_ytd");
    const clubTotalPct = get("club_total_pct");
    if (clubTotalPct && clubTotalPct.numericValue === null) {
      const tgt = v("club_total_target");
      clubTotalPct.numericValue = tgt > 0 ? roundAway(Math.max(0, Math.min(100, ((clubTotal?.numericValue ?? 0) / tgt) * 100)), 2) : 0;
    }

    // Percentage Achievement per group: (Pct, Target, Achieved, Baseline).
    const pctMap: [string, string, string, string][] = [
      ["clubs_percentage_achievement", "new_clubs", "new_clubs_achieved", "total_clubs"],
      ["percentage_increase", "new_members", "new_members_achieved", "total_members"],
      ["women_percentage_achievement", "new_women_members", "new_women_members_achieved", "existing_women_members"],
      ["annual_fund_pct", "annual_fund_target", "annual_fund_achieved", ""],
      ["polio_plus_pct", "polio_plus_target", "polio_plus_achieved", ""],
      ["endowment_pct", "endowment_target", "endowment_achieved", ""],
      ["csr_pct", "csr_target", "csr_achieved", ""],
      ["club_af_per_capita_pct", "club_af_per_capita_target", "club_af_per_capita", ""],
      ["club_annual_fund_ytd_pct", "club_annual_fund_ytd_target", "club_annual_fund_ytd", ""],
      ["club_polioplus_ytd_pct", "club_polioplus_ytd_target", "club_polioplus_ytd", ""],
      ["club_other_funds_ytd_pct", "club_other_funds_ytd_target", "club_other_funds_ytd", ""],
      ["club_endowment_ytd_pct", "club_endowment_ytd_target", "club_endowment_ytd", ""],
    ];
    for (const [pctKey, tgtKey, achKey, baseKey] of pctMap) {
      const pctField = get(pctKey);
      if (!pctField) continue;
      const [tgt, ach] = [v(tgtKey), v(achKey)];
      if (!baseKey) pctField.numericValue = tgt > 0 ? roundAway((ach / tgt) * 100, 2) : 0;
      else {
        // Achieved includes the July-1st baseline: measure the planned NEW additions only
        const base = v(baseKey);
        const gained = ach - base, planned = tgt - base;
        const pct = planned > 0 ? (gained / planned) * 100 : tgt > 0 && ach >= tgt ? 100 : 0;
        pctField.numericValue = roundAway(Math.max(0, Math.min(100, pct)), 0);
      }
    }
    // Youth Service (district): % = (Achieved − Existing as on July 1st) ÷ Proposed New × 100.
    const youthPct: [string, string, string, string][] = [
      ["rotaract_clubs_pct", "rotaract_clubs_achieved", "rotaract_existing_clubs", "rotaract_new_clubs_target"],
      ["rotaract_members_pct", "rotaract_members_achieved", "rotaract_existing_members", "rotaract_new_members_target"],
      ["interact_clubs_pct", "interact_clubs_achieved", "interact_existing_clubs", "interact_new_clubs_target"],
      ["rcc_clubs_pct", "rcc_clubs_achieved", "rcc_existing_clubs", "rcc_new_clubs_target"],
    ];
    for (const [pctKey, achKey, existKey, planKey] of youthPct) {
      const pctField = get(pctKey);
      if (!pctField) continue;
      const planned = v(planKey);
      pctField.numericValue = planned > 0 ? roundAway(Math.max(0, Math.min(100, ((v(achKey) - v(existKey)) / planned) * 100)), 0) : 0;
    }
    // Membership Summary: what has actually been added since July 1st.
    if (list.some((f) => ["total_new_clubs", "total_membership_net_growth", "new_club_members_computed"].includes(f.fieldKey))) {
      const set = (k: string, val: number) => { const f = get(k); if (f) f.numericValue = val; };
      set("total_new_clubs", Math.max(0, v("new_clubs_achieved") - v("total_clubs")));
      set("total_membership_net_growth", Math.max(0, v("new_members_achieved") - v("total_members")));
      set("new_club_members_computed", Math.max(0, v("new_women_members_achieved") - v("existing_women_members")));
    }
    applyTargetFloors(list);
    return list;
  }

  /** Upsert the entries (never computed or system-filled ones), then recompute the computed fields. */
  protected async saveEntries(conn: DbCommands, categoryId: number, yearId: number, entityType: string, clubId: number, districtId: number, entries: GoalEntrySaveDto[], memberId: number) {
    const defs = new Map<number, Row>();
    for (const f of await conn.query(
      `SELECT pk_field_id AS id, DataType AS dataType, FieldRole AS role, FieldKey AS fieldKey,
              ComputeExpression AS compute, AppliesTo AS appliesTo
       FROM goal_fields WHERE fk_category_id = @CategoryId AND isdeleted = 0`,
      { CategoryId: categoryId },
    )) defs.set(Number(f.id), f);

    for (const entry of entries) {
      const def = defs.get(entry.fieldId);
      if (!def) continue;
      if (def.role === "Computed") continue;
      if (SYSTEM_FILLED_FIELD_KEYS.has(def.fieldKey)) continue;
      if (entityType === "District" && DISTRICT_SYSTEM_FILLED_FIELD_KEYS.has(def.fieldKey)) continue;
      await conn.execute(
        `INSERT INTO goal_entries (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id,
                                   NumericValue, TextValue, BoolValue, created_by, created_date, isdeleted)
         VALUES (@FieldId, @YearId, @EntityType, @ClubId, @DistrictId,
                 @NumericValue, @TextValue, @BoolValue, @MemberId, NOW(), 0)
         ON DUPLICATE KEY UPDATE
             NumericValue = @NumericValue, TextValue = @TextValue, BoolValue = @BoolValue,
             modified_by = @MemberId, modified_date = NOW()`,
        {
          FieldId: entry.fieldId, YearId: yearId, EntityType: entityType, ClubId: clubId, DistrictId: districtId,
          NumericValue: entry.numericValue, TextValue: entry.textValue, BoolValue: entry.boolValue === null ? null : entry.boolValue ? 1 : 0, MemberId: memberId,
        },
      );
    }

    const current = new Map<string, number>();
    for (const r of await conn.query(
      `SELECT f.FieldKey AS fieldKey, e.NumericValue AS val
       FROM goal_fields f
       LEFT JOIN goal_entries e ON e.fk_field_id = f.pk_field_id AND e.fk_year_id = @YearId
           AND e.EntityType = @EntityType AND e.fk_club_id = @ClubId AND e.fk_district_id = @DistrictId AND e.isdeleted = 0
       WHERE f.fk_category_id = @CategoryId AND f.isdeleted = 0`,
      { CategoryId: categoryId, YearId: yearId, EntityType: entityType, ClubId: clubId, DistrictId: districtId },
    )) current.set(String(r.fieldKey), r.val === null ? 0 : Number(r.val));

    for (const f of defs.values()) {
      if (f.role !== "Computed" || f.compute === null || !(f.appliesTo === "Both" || f.appliesTo === entityType)) continue;
      await conn.execute(
        `INSERT INTO goal_entries (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id,
                                   NumericValue, created_by, created_date, isdeleted)
         VALUES (@FieldId, @YearId, @EntityType, @ClubId, @DistrictId, @Value, @MemberId, NOW(), 0)
         ON DUPLICATE KEY UPDATE NumericValue = @Value, modified_by = @MemberId, modified_date = NOW()`,
        { FieldId: Number(f.id), YearId: yearId, EntityType: entityType, ClubId: clubId, DistrictId: districtId, Value: evaluateSimpleExpression(String(f.compute), current), MemberId: memberId },
      );
    }
  }

  /** A current-year target may not go below its group's July-1st figure; blank stays allowed. */
  protected async validateTargetsVsBaseline(conn: DbCommands, categoryId: number, yearId: number, entityType: string, clubId: number, districtId: number, entries: GoalEntrySaveDto[]) {
    if (!entries || !entries.length) return;
    const fields = await this.loadFieldsWithValues(conn, categoryId, yearId, entityType, clubId, districtId, true);
    for (const target of fields) {
      const entry = entries.find((e) => e.fieldId === target.fieldId);
      if (!entry || entry.numericValue === null || entry.numericValue === undefined) continue;
      const { floor, from } = targetFloor(fields, target);
      if (floor <= 0) continue;
      if (entry.numericValue < floor)
        throw new InvalidOperationException(`${target.groupName}: "${CURRENT_YEAR_TARGET_LABEL}" (${n0(entry.numericValue)}) cannot be less than the ${n0(floor)} ${from}.`);
    }
  }

  // ── Locking ─────────────────────────────────────────────────────────────
  protected async getLock(conn: DbCommands, entityType: string, clubId: number, districtId: number, categoryId: number, yearId: number): Promise<GoalLockStatusDto> {
    const row = await conn.queryFirstOrDefault(
      `SELECT l.IsLocked AS isLocked, m.MemberName AS lockedByName,
              DATE_FORMAT(l.LockedDate, '%Y-%m-%d %H:%i') AS lockedDate
       FROM goal_locks l
       LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = l.LockedBy
       WHERE l.EntityType = @EntityType AND l.fk_club_id = @ClubId AND l.fk_district_id = @DistrictId
         AND l.fk_category_id = @CategoryId AND l.fk_year_id = @YearId`,
      { EntityType: entityType, ClubId: clubId, DistrictId: districtId, CategoryId: categoryId, YearId: yearId },
    );
    if (!row) return { isLocked: false, lockedByName: null, lockedDate: null };
    const isLocked = Boolean(Number(row.isLocked));
    return { isLocked, lockedByName: isLocked ? row.lockedByName ?? null : null, lockedDate: isLocked ? row.lockedDate ?? null : null };
  }

  protected async setLock(conn: DbCommands, entityType: string, clubId: number, districtId: number, categoryId: number, yearId: number, locked: boolean, memberId: number) {
    const p = { EntityType: entityType, ClubId: clubId, DistrictId: districtId, CategoryId: categoryId, YearId: yearId, MemberId: memberId };
    await conn.execute(
      locked
        ? `INSERT INTO goal_locks (EntityType, fk_club_id, fk_district_id, fk_category_id, fk_year_id, IsLocked, LockedBy, LockedDate)
           VALUES (@EntityType, @ClubId, @DistrictId, @CategoryId, @YearId, 1, @MemberId, NOW())
           ON DUPLICATE KEY UPDATE IsLocked = 1, LockedBy = @MemberId, LockedDate = NOW(), UnlockedBy = NULL, UnlockedDate = NULL`
        : `INSERT INTO goal_locks (EntityType, fk_club_id, fk_district_id, fk_category_id, fk_year_id, IsLocked, UnlockedBy, UnlockedDate)
           VALUES (@EntityType, @ClubId, @DistrictId, @CategoryId, @YearId, 0, @MemberId, NOW())
           ON DUPLICATE KEY UPDATE IsLocked = 0, UnlockedBy = @MemberId, UnlockedDate = NOW()`,
      p,
    );
  }

  /** Club goals: a District Admin of the club's district, or SuperAdmin. */
  protected async canLockClub(conn: DbCommands, memberId: number, clubId: number) {
    if (await this.isSuperAdmin(conn, memberId)) return true;
    return Number(await conn.executeScalar(
      `SELECT COUNT(*) FROM member_roles mr
       JOIN club_master c ON c.pk_club_id = @ClubId AND c.isdeleted = 0
       WHERE mr.fk_member_master_profile_id = @MemberId AND mr.fk_role_id = 2
         AND mr.fk_district_id = c.fk_district_id
         AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
         AND mr.IsActive = 1 AND mr.isdeleted = 0`,
      { MemberId: memberId, ClubId: clubId },
    )) > 0;
  }

  /** District goals: SuperAdmin, or the Zonal Coordinator (role 4) of the district's zone. */
  protected async canLockDistrict(conn: DbCommands, memberId: number, districtId: number) {
    if (await this.isSuperAdmin(conn, memberId)) return true;
    return Number(await conn.executeScalar(
      `SELECT COUNT(*) FROM member_roles mr
       JOIN district_master d ON d.pk_district_id = @DistrictId AND d.isdeleted = 0
       WHERE mr.fk_member_master_profile_id = @MemberId AND mr.fk_role_id = 4
         AND mr.fk_zone_id = d.fk_zone_id
         AND mr.IsActive = 1 AND mr.isdeleted = 0`,
      { MemberId: memberId, DistrictId: districtId },
    )) > 0;
  }

  async setClubLock(memberId: number, categoryId: number, yearId: number, clubId: number, locked: boolean): Promise<GoalLockStatusDto> {
    return this.db.session(async (conn) => {
      if (!(await this.canLockClub(conn, memberId, clubId))) throw new UnauthorizedAccessException("You are not authorised to lock/unlock this club's goals.");
      await this.setLock(conn, "Club", clubId, 0, categoryId, yearId, locked, memberId);
      return this.getLock(conn, "Club", clubId, 0, categoryId, yearId);
    });
  }

  async setDistrictLock(memberId: number, categoryId: number, yearId: number, districtId: number, locked: boolean): Promise<GoalLockStatusDto> {
    return this.db.session(async (conn) => {
      if (!(await this.canLockDistrict(conn, memberId, districtId))) throw new UnauthorizedAccessException("You are not authorised to lock/unlock this district's goals.");
      await this.setLock(conn, "District", 0, districtId, categoryId, yearId, locked, memberId);
      return this.getLock(conn, "District", 0, districtId, categoryId, yearId);
    });
  }
}

// ── Live counts (honorary members never count; district member counts = synced clubs) ────────

async function scalarInt(conn: DbCommands, sql: string, p: Record<string, unknown>) {
  return Number((await conn.executeScalar(sql, p)) ?? 0);
}

/** Clubs chartered before the year start (synced and non-synced, to match Rotary.org); NULL charter = existing. */
export function liveDistrictClubCount(conn: DbCommands, districtId: number, asOf: string | null) {
  if (districtId <= 0) return Promise.resolve(0);
  return scalarInt(conn,
    `SELECT COUNT(*) FROM club_master
     WHERE fk_district_id = @Id AND IsActive = 1 AND isdeleted = 0
       AND (@AsOf IS NULL OR ClubCharterDate IS NULL OR ClubCharterDate < @AsOf)`,
    { Id: districtId, AsOf: asOf });
}

const DISTRICT_MEMBERS_FROM = `FROM club_members cm
       JOIN club_master c ON c.pk_club_id = cm.fk_club_id
       JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
       WHERE c.fk_district_id = @Id
         AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
         AND c.IsActive = 1 AND c.isdeleted = 0
         AND c.IsSyncedFromRotaryOrg = 1
         AND m.isdeleted = 0`;
const CLUB_MEMBERS_FROM = `FROM club_members cm
       JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
       WHERE cm.fk_club_id = @Id
         AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
         AND m.isdeleted = 0`;

/** Members who joined before the year start (NULL joined = existing). */
export function liveDistrictMemberCount(conn: DbCommands, districtId: number, asOf: string | null) {
  if (districtId <= 0) return Promise.resolve(0);
  return scalarInt(conn, `SELECT COUNT(DISTINCT m.pk_member_master_profile_id) ${DISTRICT_MEMBERS_FROM}
       AND (@AsOf IS NULL OR cm.JoinedDate IS NULL OR cm.JoinedDate < @AsOf)`, { Id: districtId, AsOf: asOf });
}
export function liveDistrictWomenCount(conn: DbCommands, districtId: number, asOf: string | null) {
  if (districtId <= 0) return Promise.resolve(0);
  return scalarInt(conn, `SELECT COUNT(DISTINCT m.pk_member_master_profile_id) ${DISTRICT_MEMBERS_FROM} AND m.Gender = 'Female'
       AND (@AsOf IS NULL OR cm.JoinedDate IS NULL OR cm.JoinedDate < @AsOf)`, { Id: districtId, AsOf: asOf });
}
export function liveClubCount(conn: DbCommands, clubId: number, asOf: string | null, womenOnly: boolean) {
  if (clubId <= 0) return Promise.resolve(0);
  return scalarInt(conn, `SELECT COUNT(DISTINCT m.pk_member_master_profile_id) ${CLUB_MEMBERS_FROM}${womenOnly ? " AND m.Gender = 'Female'" : ""}
       AND (@AsOf IS NULL OR cm.JoinedDate IS NULL OR cm.JoinedDate < @AsOf)`, { Id: clubId, AsOf: asOf });
}
/** New clubs chartered within the year (synced and non-synced). */
export function achievedNewClubsDistrict(conn: DbCommands, districtId: number, start: string, end: string) {
  if (districtId <= 0) return Promise.resolve(0);
  return scalarInt(conn,
    `SELECT COUNT(*) FROM club_master
     WHERE fk_district_id = @Id AND IsActive = 1 AND isdeleted = 0
       AND ClubCharterDate IS NOT NULL
       AND ClubCharterDate >= @S AND ClubCharterDate <= @E`,
    { Id: districtId, S: start, E: end });
}
/** Members (or women) who joined within the year. */
export function achievedNewDistrict(conn: DbCommands, districtId: number, start: string, end: string, womenOnly: boolean) {
  if (districtId <= 0) return Promise.resolve(0);
  return scalarInt(conn, `SELECT COUNT(DISTINCT m.pk_member_master_profile_id) ${DISTRICT_MEMBERS_FROM}${womenOnly ? " AND m.Gender = 'Female'" : ""}
       AND cm.JoinedDate IS NOT NULL
       AND cm.JoinedDate >= @S AND cm.JoinedDate <= @E`, { Id: districtId, S: start, E: end });
}
export function achievedNewClub(conn: DbCommands, clubId: number, start: string, end: string, womenOnly: boolean) {
  if (clubId <= 0) return Promise.resolve(0);
  return scalarInt(conn, `SELECT COUNT(DISTINCT m.pk_member_master_profile_id) ${CLUB_MEMBERS_FROM}${womenOnly ? " AND m.Gender = 'Female'" : ""}
       AND cm.JoinedDate IS NOT NULL
       AND cm.JoinedDate >= @S AND cm.JoinedDate <= @E`, { Id: clubId, S: start, E: end });
}

/** RAG "Healthy Clubs": Red 10-25, Amber 26-40, Green 41+ (Super Green 51+ kept for the retired field). */
export async function liveDistrictRagCounts(conn: DbCommands, districtId: number) {
  if (districtId <= 0) return { red: 0, amber: 0, green: 0, superGreen: 0 };
  const row = await conn.queryFirstOrDefault(
    `SELECT
         COALESCE(SUM(mc BETWEEN 10 AND 25), 0) AS Red,
         COALESCE(SUM(mc BETWEEN 26 AND 40), 0) AS Amber,
         COALESCE(SUM(mc >= 41), 0)             AS Green,
         COALESCE(SUM(mc >= 51), 0)             AS SuperGreen
     FROM (
         SELECT COUNT(DISTINCT m.pk_member_master_profile_id) AS mc
         FROM club_master c
         JOIN club_members cm ON cm.fk_club_id = c.pk_club_id
              AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
         JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
              AND m.isdeleted = 0
         WHERE c.fk_district_id = @Id AND c.IsActive = 1 AND c.isdeleted = 0
               AND c.IsSyncedFromRotaryOrg = 1
         GROUP BY c.pk_club_id
     ) t`,
    { Id: districtId },
  );
  if (!row) return { red: 0, amber: 0, green: 0, superGreen: 0 };
  return { red: Number(row.Red), amber: Number(row.Amber), green: Number(row.Green), superGreen: Number(row.SuperGreen) };
}
