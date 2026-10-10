import type { DbCommands, Row } from "../../database/db.service";
import { formatNumber } from "../../common/dotnet-format";
import { UnauthorizedAccessException } from "../../common/exceptions";
import { hideRotaract, notRotaract } from "../../services/club-scope.helper";
import { GoalCore, YOUTH_DISTRICT_OWN_KEYS, roundAway } from "./goal-core";
import { isTrfCategory } from "./goal-forms";
import { GoalReports, mapLimit, reportLabel } from "./goal-reports";
import type {
  GoalCategoryFormDto, GoalClubMatrixDto, GoalClubMonthlyMatrixDto, GoalClubSummaryDto, GoalDistrictSummaryDto, GoalDistrictSummaryMatrixDto, GoalFieldWithValueDto,
  GoalMatrixColumnDto, GoalOverviewMatrixDto, GoalOverviewRowDto, GoalSummaryCategoryDto, GoalSummaryCellDto, GoalSummaryDistrictRowDto, GoalSummaryMetricDto,
} from "./goal-setting.dtos";

/** Trim a number to a clean string: whole without decimals, else up to 2. */
export const formatMonthlyNumber = (v: number | null | undefined) => (v === null || v === undefined ? null : v === Math.trunc(v) ? String(Math.trunc(v)) : formatNumber(v, "0.##"));
const formatPct = (p: number | null) => (p === null ? null : formatNumber(p, "0.##") + "%");
const isSuggestionGroup = (g: string | null | undefined) => (g ?? "").trim().toLowerCase() === "suggestions";
const isYouthCategory = (n: string | null | undefined) => (n ?? "").toLowerCase() === "youth service";

/** Read-only display of a goal field: Yes/No, "12%", numbers without trailing zeros, else text. */
function formatGoalValue(f: GoalFieldWithValueDto): string | null {
  if (f.boolValue !== null) return f.boolValue ? "Yes" : "No";
  if (f.numericValue !== null) {
    const s = formatMonthlyNumber(f.numericValue)!;
    return f.dataType.toLowerCase() === "percentage" ? s + "%" : s;
  }
  return f.textValue && f.textValue.trim() ? f.textValue : null;
}
/** Overview cell value; null when unset. Currency carries its unit (default "$"). */
function formatFieldValue(f: GoalFieldWithValueDto | null | undefined): string | null {
  if (!f) return null;
  if (f.dataType === "Boolean") return f.boolValue === null ? null : f.boolValue ? "Yes" : "No";
  if (f.dataType === "Text") return f.textValue && f.textValue.trim() ? f.textValue : null;
  if (f.numericValue === null) return null;
  const v = f.numericValue;
  const n = v === Math.floor(v) ? String(Math.trunc(v)) : formatNumber(v, "0.##");
  if (f.dataType === "Currency") return (f.unit ?? "$") + n;
  if (f.dataType === "Percentage") return n + "%";
  return n;
}
const stripRoleSuffix = (k: string) => (/_target$/i.test(k) ? k.slice(0, -7) : /_achieved$/i.test(k) ? k.slice(0, -9) : k);
const isTargetField = (f: GoalFieldWithValueDto) => /_target$/i.test(f.fieldKey) || f.fieldRole === "Target";
function rowLabel(groupName: string, target?: GoalFieldWithValueDto | null, achieved?: GoalFieldWithValueDto | null, reference?: GoalFieldWithValueDto | null) {
  const raw = target?.fieldLabel ?? achieved?.fieldLabel ?? reference?.fieldLabel ?? groupName;
  const stripped = raw.replace(/achieved/gi, "").replace(/target/gi, "").replace(/^[ \-–:]+|[ \-–:]+$/g, "");
  return stripped || groupName;
}
function ragBandOf(metricKey: string | null, label: string | null) {
  const k = (metricKey ?? "").trim().toLowerCase(), l = (label ?? "").trim().toLowerCase();
  if (k === "rag_red" || l === "red") return "Red";
  if (k === "rag_amber" || l === "amber") return "Amber";
  if (k === "rag_green" || l === "green") return "Green";
  if (k === "rag_super_green" || l === "super green") return "SuperGreen";
  return null;
}
/** Pull a number out of a formatted cell ("12%", "1,200", "—"). */
function parseGoalNum(s: string | null | undefined): number | null {
  if (!s || !s.trim()) return null;
  const cleaned = [...s].filter((ch) => /[0-9.\-]/.test(ch)).join("");
  if (!cleaned || !/^-?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  return Number(cleaned);
}
/** % for the district overview: Membership = progress on the planned increase; others achieved ÷ target. */
function summaryPct(baseline: number | null, target: number | null, achieved: number | null, decimals = 0): number | null {
  if (target === null || target <= 0) return null;
  const ach = achieved ?? 0;
  if (baseline !== null) {
    const planned = target - baseline;
    if (planned <= 0) return null;
    return Math.max(0, Math.min(100, roundAway(((ach - baseline) / planned) * 100, 0)));
  }
  return Math.max(0, Math.min(100, roundAway((ach / target) * 100, decimals)));
}

type Group = { groupName: string; baselineLabel: string; ref: GoalOverviewRowDto | null; val: GoalOverviewRowDto | null; ach: GoalOverviewRowDto | null; rag: string | null; single: boolean; combine: GoalOverviewRowDto[] | null };
const isPercentMetric = (g: Group) => g.single && g.combine === null && (g.baselineLabel.includes("%") || g.baselineLabel.toLowerCase().includes("percentage"));

const CLUB_LIST_SQL = `
  SELECT c.pk_club_id AS clubId, c.ClubName AS clubName,
         (SELECT COUNT(*) FROM goal_entries e
           JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0
          WHERE f.fk_category_id = @CategoryId AND e.fk_year_id = @YearId
            AND e.EntityType = 'Club' AND e.fk_club_id = c.pk_club_id AND e.isdeleted = 0) AS entryCount,
         (SELECT DATE_FORMAT(MAX(COALESCE(e.modified_date, e.created_date)), '%Y-%m-%d %H:%i')
            FROM goal_entries e JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0
           WHERE f.fk_category_id = @CategoryId AND e.fk_year_id = @YearId
             AND e.EntityType = 'Club' AND e.fk_club_id = c.pk_club_id AND e.isdeleted = 0) AS lastUpdatedDate,
         (SELECT l.IsLocked FROM goal_locks l
           WHERE l.EntityType = 'Club' AND l.fk_club_id = c.pk_club_id AND l.fk_district_id = 0
             AND l.fk_category_id = @CategoryId AND l.fk_year_id = @YearId) AS isLocked
  FROM club_master c
  WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND c.IsActive = 1
  ORDER BY c.ClubName`;
const clubSummary = (r: Row): GoalClubSummaryDto => ({
  clubId: Number(r.clubId), clubName: String(r.clubName), hasAnyGoalSet: Number(r.entryCount ?? 0) > 0,
  lastUpdatedDate: r.lastUpdatedDate ?? null, lastUpdatedBy: null, isLocked: r.isLocked !== null && r.isLocked !== undefined && Boolean(Number(r.isLocked)),
});

/**
 * Port of GoalSettingService.cs, layer 4: club lists and club matrices for a district, the zone's
 * district list, the overview matrix and the oversight summary matrix.
 */
export abstract class GoalMatrices extends GoalReports {
  /** A District Assistant's category check on the oversight screens. */
  private async assertOversightCategory(conn: DbCommands, memberId: number, categoryId: number) {
    const only = await this.oversightCategoryFilter(conn, memberId);
    if (only !== null && !only.has(categoryId)) throw new UnauthorizedAccessException("This goal category is outside your assignment.");
  }

  async getScopedDistrictClubsGoalList(memberId: number, categoryId: number, yearId: number, districtId: number): Promise<GoalClubSummaryDto[]> {
    return this.db.session(async (conn) => {
      if (!(await this.canAccessDistrictReport(conn, memberId, districtId))) throw new UnauthorizedAccessException("You are not authorised to view this district's clubs.");
      await this.assertOversightCategory(conn, memberId, categoryId);
      return (await conn.query(CLUB_LIST_SQL, { CategoryId: categoryId, YearId: yearId, DistrictId: districtId })).map(clubSummary);
    });
  }

  async getScopedClubGoalForm(memberId: number, categoryId: number, yearId: number, clubId: number): Promise<GoalCategoryFormDto | null> {
    return this.db.session(async (conn) => {
      if (!(await this.canAccessClubReport(conn, memberId, clubId))) throw new UnauthorizedAccessException("You are not authorised to view this club's goals.");
      await this.assertOversightCategory(conn, memberId, categoryId);
      const y = await this.resolveYear(conn, yearId);
      if (y.yearId === 0) return null;
      const clubName = String((await conn.executeScalar("SELECT ClubName FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0", { Id: clubId })) ?? "");
      const categoryName = await GoalCore.categoryName(conn, categoryId);
      const fields = await this.loadFieldsWithValues(conn, categoryId, y.yearId, "Club", clubId, 0, y.isEditable);
      const lock = await this.getLock(conn, "Club", clubId, 0, categoryId, y.yearId);
      return {
        categoryId, categoryName, entityType: "Club", clubId, districtId: null, entityName: clubName, yearId: y.yearId, yearLabel: y.yearLabel,
        isEditable: false, isLocked: lock.isLocked, lockedByName: lock.lockedByName, lockedDate: lock.lockedDate, canLock: false,
        achievedAsOn: await this.achievedAsOn(conn, categoryId, y.yearId, "Club", clubId, 0), fields,
      };
    });
  }

  async getDistrictClubsGoalList(memberId: number, categoryId: number, yearId: number, requestedDistrictId: number | null): Promise<GoalClubSummaryDto[]> {
    return this.db.session(async (conn) => {
      const districtId = await this.resolveDistrictId(conn, memberId, requestedDistrictId);
      if (districtId === 0) return [];
      return (await conn.query(CLUB_LIST_SQL, { CategoryId: categoryId, YearId: yearId, DistrictId: districtId })).map(clubSummary);
    });
  }

  /** District Admin "View club goals": clubs = rows, one category's fields = columns, plus each club's RAG band. */
  async getDistrictClubsGoalMatrix(memberId: number, categoryId: number, yearId: number | null, requestedDistrictId: number | null): Promise<GoalClubMatrixDto> {
    return this.db.session(async (conn) => {
      const districtId = await this.resolveDistrictId(conn, memberId, requestedDistrictId);
      return this.buildDistrictClubsGoalMatrixCore(conn, categoryId, districtId, yearId, hideRotaract(await this.isSuperAdmin(conn, memberId)));
    });
  }

  async getScopedDistrictClubsGoalMatrix(memberId: number, categoryId: number, yearId: number | null, districtId: number): Promise<GoalClubMatrixDto> {
    return this.db.session(async (conn) => {
      if (!(await this.canAccessDistrictReport(conn, memberId, districtId))) throw new UnauthorizedAccessException("This district is outside your goal-setting scope.");
      return this.buildDistrictClubsGoalMatrixCore(conn, categoryId, districtId, yearId);
    });
  }

  private static districtClubs(conn: DbCommands, districtId: number, excludeRotaract: boolean) {
    return conn.query(
      `SELECT pk_club_id AS Id, ClubName AS Name FROM club_master
       WHERE fk_district_id = @D AND isdeleted = 0 AND IsActive = 1` + (excludeRotaract ? " AND " + notRotaract("") : "") + " ORDER BY ClubName",
      { D: districtId },
    );
  }

  private async buildDistrictClubsGoalMatrixCore(conn: DbCommands, categoryId: number, districtId: number, yearId: number | null, excludeRotaract = false): Promise<GoalClubMatrixDto> {
    const result: GoalClubMatrixDto = { categoryId, categoryName: "", yearId: 0, yearLabel: "", columns: [], clubs: [] };
    if (districtId === 0) return result;
    const y = await this.resolveYear(conn, yearId);
    if (y.yearId === 0) return result;
    result.yearId = y.yearId;
    result.yearLabel = y.yearLabel;
    result.categoryName = await GoalCore.categoryName(conn, categoryId);
    let columnsSet = false;
    for (const club of await GoalMatrices.districtClubs(conn, districtId, excludeRotaract)) {
      const fields = await this.loadFieldsWithValues(conn, categoryId, y.yearId, "Club", Number(club.Id), 0, y.isEditable);
      if (!columnsSet) {
        const cols: GoalMatrixColumnDto[] = [];
        for (const f of fields) {
          if (isSuggestionGroup(f.groupName)) {
            if (!cols.some((c) => c.fieldKey === "suggestions")) cols.push({ fieldKey: "suggestions", fieldLabel: "Suggestions", groupName: f.groupName, dataType: "Text", unit: null });
            continue;
          }
          cols.push({ fieldKey: f.fieldKey, fieldLabel: f.fieldLabel, groupName: f.groupName, dataType: f.dataType, unit: f.unit });
        }
        result.columns = cols;
        columnsSet = true;
      }
      const mc = Number((await conn.executeScalar(
        `SELECT COUNT(DISTINCT m.pk_member_master_profile_id)
         FROM club_master c
         JOIN club_members cm ON cm.fk_club_id = c.pk_club_id
              AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
         JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
              AND m.isdeleted = 0
         WHERE c.pk_club_id = @Id AND c.IsActive = 1 AND c.isdeleted = 0 AND c.IsSyncedFromRotaryOrg = 1`,
        { Id: Number(club.Id) },
      )) ?? 0);
      const band = mc >= 51 ? "SuperGreen" : mc >= 41 ? "Green" : mc >= 26 ? "Amber" : mc >= 10 ? "Red" : "None";
      const values: Record<string, string | null> = {};
      const suggestions: string[] = [];
      for (const f of fields) {
        if (isSuggestionGroup(f.groupName)) { if (f.textValue && f.textValue.trim()) suggestions.push(f.textValue.trim()); continue; }
        values[f.fieldKey] = formatGoalValue(f);
      }
      if (fields.some((f) => isSuggestionGroup(f.groupName))) values.suggestions = suggestions.length ? suggestions.map((t, i) => `${i + 1}) ${t}`).join("; ") : null;
      result.clubs.push({ clubId: Number(club.Id), clubName: String(club.Name), rag: band, memberCount: mc, values });
    }
    return result;
  }

  /** Clubs = rows, months = columns for one category (built in parallel; order kept). */
  async getDistrictClubsMonthlyMatrix(memberId: number, categoryId: number, yearId: number | null, requestedDistrictId: number | null): Promise<GoalClubMonthlyMatrixDto> {
    const { districtId, exclude } = await this.db.session(async (conn) => ({
      districtId: await this.resolveDistrictId(conn, memberId, requestedDistrictId),
      exclude: hideRotaract(await this.isSuperAdmin(conn, memberId)),
    }));
    return this.buildDistrictClubsMonthlyMatrixCore(categoryId, districtId, yearId, exclude);
  }

  async getScopedDistrictClubsMonthlyMatrix(memberId: number, categoryId: number, yearId: number | null, districtId: number): Promise<GoalClubMonthlyMatrixDto> {
    await this.db.session(async (conn) => {
      if (!(await this.canAccessDistrictReport(conn, memberId, districtId))) throw new UnauthorizedAccessException("This district is outside your goal-setting scope.");
    });
    return this.buildDistrictClubsMonthlyMatrixCore(categoryId, districtId, yearId);
  }

  private async buildDistrictClubsMonthlyMatrixCore(categoryId: number, districtId: number, yearId: number | null, excludeRotaract = false): Promise<GoalClubMonthlyMatrixDto> {
    const result: GoalClubMonthlyMatrixDto = { categoryId, categoryName: "", yearId: 0, yearLabel: "", months: [], fields: [], clubs: [] };
    if (districtId === 0) return result;
    const prep = await this.db.session(async (conn) => {
      if (await GoalCore.isAnnualOnlyCategoryId(conn, categoryId)) return null;
      const y = await this.resolveYear(conn, yearId);
      if (y.yearId === 0) return null;
      return { y, categoryName: await GoalCore.categoryName(conn, categoryId), clubs: await GoalMatrices.districtClubs(conn, districtId, excludeRotaract) };
    });
    if (!prep) return result;
    result.yearId = prep.y.yearId;
    result.yearLabel = prep.y.yearLabel;
    result.categoryName = prep.categoryName;
    const forms = await mapLimit(prep.clubs, 12, (club) => this.db.session((c2) => this.buildMonthlyForm(c2, categoryId, prep.y.yearId, "Club", Number(club.Id), 0, String(club.Name), prep.y.isEditable)));
    let metaSet = false;
    forms.forEach((form, i) => {
      if (!form) return;
      if (!metaSet) {
        result.months = form.months;
        result.fields = form.fields.map((f) => ({ fieldKey: f.fieldKey, groupName: f.groupName, fieldLabel: f.fieldLabel, unit: f.unit }));
        metaSet = true;
      }
      const row = { clubId: Number(prep.clubs[i].Id), clubName: String(prep.clubs[i].Name), values: {} as Record<string, Record<number, string | null>>, totals: {} as Record<string, string | null> };
      for (const f of form.fields) {
        const map: Record<number, string | null> = {};
        for (const [k, v] of Object.entries(f.monthly)) map[+k] = formatMonthlyNumber(v);
        row.values[f.fieldKey] = map;
        row.totals[f.fieldKey] = formatMonthlyNumber(f.total);
      }
      result.clubs.push(row);
    });
    return result;
  }

  /** The Zonal Coordinator's zone (SuperAdmin may borrow any). */
  private async resolveZoneIdForCoordinator(conn: DbCommands, memberId: number, requestedZoneId: number | null): Promise<number> {
    if (memberId <= 0) return 0;
    const sa = await this.isSuperAdmin(conn, memberId);
    if (requestedZoneId !== null && requestedZoneId > 0) {
      if (sa) return requestedZoneId;
      const isZc = Number(await conn.executeScalar(
        `SELECT COUNT(*) FROM member_roles
         WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 4
           AND fk_zone_id = @ZoneId AND IsActive = 1 AND isdeleted = 0`,
        { MemberId: memberId, ZoneId: requestedZoneId },
      ));
      if (isZc > 0) return requestedZoneId;
      throw new UnauthorizedAccessException("You are not the Zonal Coordinator for this zone.");
    }
    return Number(await conn.executeScalar(
      `SELECT fk_zone_id FROM member_roles
       WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 4
         AND fk_zone_id IS NOT NULL AND fk_zone_id > 0 AND IsActive = 1 AND isdeleted = 0
       ORDER BY pk_member_role_id DESC LIMIT 1`,
      { MemberId: memberId },
    ) ?? 0);
  }

  async getZoneDistrictsGoalList(memberId: number, categoryId: number, yearId: number, requestedZoneId: number | null): Promise<GoalDistrictSummaryDto[]> {
    return this.db.session(async (conn) => {
      const zoneId = await this.resolveZoneIdForCoordinator(conn, memberId, requestedZoneId);
      if (zoneId === 0) return [];
      const rows = await conn.query(
        `SELECT d.pk_district_id AS districtId, d.DistrictNumber AS districtNumber, d.fk_zone_id AS zoneId, z.ZoneName AS zoneName,
                (SELECT COUNT(*) FROM goal_entries e
                  JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0
                 WHERE f.fk_category_id = @CategoryId AND e.fk_year_id = @YearId
                   AND e.EntityType = 'District' AND e.fk_district_id = d.pk_district_id AND e.isdeleted = 0) AS entryCount,
                (SELECT DATE_FORMAT(MAX(COALESCE(e.modified_date, e.created_date)), '%Y-%m-%d %H:%i')
                   FROM goal_entries e JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0
                  WHERE f.fk_category_id = @CategoryId AND e.fk_year_id = @YearId
                    AND e.EntityType = 'District' AND e.fk_district_id = d.pk_district_id AND e.isdeleted = 0) AS lastUpdatedDate,
                (SELECT l.IsLocked FROM goal_locks l
                  WHERE l.EntityType = 'District' AND l.fk_district_id = d.pk_district_id AND l.fk_club_id = 0
                    AND l.fk_category_id = @CategoryId AND l.fk_year_id = @YearId) AS isLocked
         FROM district_master d
         LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
         WHERE d.isdeleted = 0 AND d.IsActive = 1 AND d.fk_zone_id = @ZoneId
         ORDER BY d.DistrictNumber`,
        { CategoryId: categoryId, YearId: yearId, ZoneId: zoneId },
      );
      return rows.map((r) => ({
        districtId: Number(r.districtId), districtNumber: String(r.districtNumber), zoneId: r.zoneId === null ? 0 : Number(r.zoneId), zoneName: r.zoneName ?? null,
        hasAnyGoalSet: Number(r.entryCount ?? 0) > 0, lastUpdatedDate: r.lastUpdatedDate ?? null, isLocked: r.isLocked !== null && r.isLocked !== undefined && Boolean(Number(r.isLocked)),
      }));
    });
  }

  /** The overview matrix for a zone a goal-oversight role covers (a District Assistant sees only their districts). */
  async getScopedOverviewMatrix(memberId: number, zoneId: number, categoryId: number, yearId: number | null): Promise<GoalOverviewMatrixDto | null> {
    if (zoneId <= 0) return null;
    const allowed = await this.db.session(async (conn): Promise<Set<number> | null> => {
      if (await this.isSuperAdmin(conn, memberId)) return null;
      const assigns = await this.getMyAssignments(memberId);
      const riOrZc = assigns.some((a) => (a.roleType === "AllCategoryAllDistrictsFewZones" && a.zoneIds.includes(zoneId)) || (a.roleType === "AllDistrictsOneCategoryOneZone" && a.zoneIds.includes(zoneId) && a.categoryIds.includes(categoryId)));
      if (riOrZc) return null;
      const da = [...new Set(assigns.filter((a) => a.roleType === "FewDistrictsOneCategoryOneZone" && a.categoryIds.includes(categoryId)).flatMap((a) => a.districtIds))];
      if (!da.length) throw new UnauthorizedAccessException("You do not oversee this zone / category.");
      const zoneDistricts = new Set((await conn.query("SELECT pk_district_id AS id FROM district_master WHERE fk_zone_id=@Z AND isdeleted=0 AND IsActive=1", { Z: zoneId })).map((r) => Number(r.id)));
      const set = new Set(da.filter((d) => zoneDistricts.has(d)));
      if (!set.size) throw new UnauthorizedAccessException("You do not oversee any district in this zone / category.");
      return set;
    });
    const matrix = await this.getOverviewMatrix(zoneId, categoryId, yearId);
    if (!matrix) return null;
    if (allowed) {
      matrix.districts = matrix.districts.filter((d) => allowed.has(d.districtId));
      for (const row of matrix.rows) row.cells = row.cells.filter((c) => allowed.has(c.districtId));
    }
    return matrix;
  }

  /** Districts = rows, a compact Target / Achieved / % block per category the caller oversees, plus totals. */
  async getScopedDistrictSummaryMatrix(memberId: number, zoneId: number, yearId: number | null): Promise<GoalDistrictSummaryMatrixDto> {
    const result: GoalDistrictSummaryMatrixDto = { zoneId, zoneName: "", yearId: 0, yearLabel: "", categories: [], districts: [] };
    const cats = await this.getOversightCategories(memberId);
    const order: GoalSummaryDistrictRowDto[] = [];
    const byId = new Map<number, GoalSummaryDistrictRowDto>();
    type Acc = { base: number; tgt: number; ach: number; any: boolean; hasBase: boolean };
    const totals = new Map<number, Acc[]>();

    for (const cat of cats) {
      let m: GoalOverviewMatrixDto | null;
      try {
        m = await this.getScopedOverviewMatrix(memberId, zoneId, cat.id, yearId);
      } catch (e) {
        if (e instanceof UnauthorizedAccessException) continue;
        throw e;
      }
      if (!m || !m.districts.length || !m.rows.length) continue;
      if (!result.zoneName) { result.zoneName = m.zoneName; result.yearId = m.yearId; result.yearLabel = m.yearLabel; }

      const byGroup: { name: string; rows: GoalOverviewRowDto[] }[] = [];
      const seen = new Map<string, number>();
      for (const r of m.rows) {
        const gname = r.groupName.trim() ? r.groupName : r.label;
        const k = gname.toLowerCase();
        if (!seen.has(k)) { seen.set(k, byGroup.length); byGroup.push({ name: gname, rows: [] }); }
        byGroup[seen.get(k)!].rows.push(r);
      }
      const groups: Group[] = [];
      const perFieldColumns = ["public image", "youth service"].includes(m.categoryName.toLowerCase());
      const trfRatioPct = isTrfCategory(m.categoryName);
      for (const { name: gname, rows: grows } of byGroup) {
        const targetRow = grows.find((x) => x.hasTarget) ?? null;
        const achievedRow = grows.find((x) => x.hasAchieved) ?? null;
        if (!perFieldColumns && (targetRow || achievedRow)) {
          const refRow = grows.find((x) => x.hasReference && !x.hasTarget && !x.hasAchieved) ?? null;
          groups.push({ groupName: gname, baselineLabel: refRow?.referenceLabel && refRow.referenceLabel.trim() ? reportLabel(refRow.referenceLabel) : "As on July 1st", ref: refRow, val: targetRow, ach: achievedRow, rag: null, single: false, combine: null });
        } else if (gname.toLowerCase() === "suggestions") {
          if (grows.length === 1) groups.push({ groupName: gname, baselineLabel: "Suggestions", ref: grows[0], val: null, ach: null, rag: null, single: true, combine: null });
          else groups.push({ groupName: gname, baselineLabel: "Suggestions", ref: null, val: null, ach: null, rag: null, single: true, combine: [...grows] });
        } else {
          for (const r of grows) {
            if (isYouthCategory(m.categoryName) && r.dataType === "Percentage") continue;
            groups.push({ groupName: gname, baselineLabel: reportLabel(r.label), ref: r, val: r, ach: r, rag: ragBandOf(r.metricKey, r.label), single: true, combine: null });
          }
        }
      }
      const notSummable = (g: Group) => g.combine !== null || isSuggestionGroup(g.groupName) || isPercentMetric(g);
      const catDto: GoalSummaryCategoryDto = {
        categoryId: cat.id, name: m.categoryName, totals: [],
        metrics: groups.map((g): GoalSummaryMetricDto => ({ groupName: g.groupName, baselineLabel: g.baselineLabel, ragBand: g.rag, singleValue: g.single, hasBaseline: !g.single && g.ref !== null, notSummable: notSummable(g) })),
      };
      result.categories.push(catDto);
      const acc: Acc[] = groups.map(() => ({ base: 0, tgt: 0, ach: 0, any: false, hasBase: false }));
      for (const d of m.districts) {
        let row = byId.get(d.districtId);
        if (!row) { row = { districtId: d.districtId, districtNumber: d.districtNumber, cells: {} }; byId.set(d.districtId, row); order.push(row); }
        const cells: GoalSummaryCellDto[] = [];
        groups.forEach((g, i) => {
          const cellOf = (r: GoalOverviewRowDto | null) => r?.cells.find((c) => c.districtId === d.districtId);
          if (g.single) {
            let oneStr: string | null;
            if (g.combine) {
              const entries = g.combine.map((rw) => cellOf(rw)).map((c) => c?.target ?? c?.total ?? c?.achieved ?? null).filter((s): s is string => !!s && !!s.trim()).map((s) => s.trim());
              oneStr = entries.length ? entries.map((s, n) => `${n + 1}) ${s}`).join("\n") : null;
            } else {
              const one = cellOf(g.ref);
              oneStr = one?.total ?? one?.achieved ?? one?.target ?? null;
            }
            cells.push({ asOnJul1: null, target: null, achieved: null, pct: null, value: oneStr });
            if (notSummable(g)) return;
            const rn = parseGoalNum(oneStr);
            if (rn !== null) { acc[i].base += rn; acc[i].any = true; acc[i].hasBase = true; }
            return;
          }
          const refCell = cellOf(g.ref), valCell = cellOf(g.val), achCell = cellOf(g.ach);
          const baseStr = refCell?.total ?? valCell?.total ?? null;
          const tgtStr = valCell?.target ?? null;
          const achStr = achCell?.achieved ?? valCell?.achieved ?? null;
          const [bn, tn, an] = [parseGoalNum(baseStr), parseGoalNum(tgtStr), parseGoalNum(achStr)];
          cells.push({ asOnJul1: baseStr, target: tgtStr, achieved: achStr, pct: formatPct(summaryPct(trfRatioPct ? null : bn, tn, an, trfRatioPct ? 2 : 0)), value: null });
          if (bn !== null) { acc[i].base += bn; acc[i].any = true; acc[i].hasBase = true; }
          if (tn !== null) { acc[i].tgt += tn; acc[i].any = true; }
          if (an !== null) { acc[i].ach += an; acc[i].any = true; }
        });
        row.cells[cat.id] = cells;
      }
      totals.set(cat.id, acc);
    }

    result.districts = order.sort((a, b) => a.districtNumber.toLowerCase().localeCompare(b.districtNumber.toLowerCase()));
    for (const c of result.categories) {
      const acc = totals.get(c.categoryId);
      if (!acc) continue;
      const trf = isTrfCategory(c.name);
      acc.forEach((a, i) => {
        if (i < c.metrics.length && c.metrics[i].singleValue) {
          c.totals.push({ asOnJul1: null, target: null, achieved: null, pct: null, value: !c.metrics[i].notSummable && a.hasBase ? formatMonthlyNumber(a.base) : null });
          return;
        }
        c.totals.push({
          asOnJul1: a.hasBase ? formatMonthlyNumber(a.base) : null, target: formatMonthlyNumber(a.tgt), achieved: formatMonthlyNumber(a.ach),
          pct: formatPct(summaryPct(a.hasBase && !trf ? a.base : null, a.tgt, a.ach, trf ? 2 : 0)), value: null,
        });
      });
    }
    return result;
  }

  /** SuperAdmin Overview: one zone × one category × one year — rows = metrics, columns = districts. */
  async getOverviewMatrix(zoneId: number, categoryId: number, yearId: number | null): Promise<GoalOverviewMatrixDto | null> {
    if (zoneId <= 0) return null;
    return this.db.session(async (conn) => {
      const zoneName = await conn.executeScalar("SELECT ZoneName FROM zone_master WHERE pk_zone_id = @Id", { Id: zoneId });
      if (zoneName === null || zoneName === undefined) return null;
      const y = await this.resolveYear(conn, yearId);
      if (y.yearId === 0) return null;
      const categoryName = await GoalCore.categoryName(conn, categoryId);
      const districts = (await conn.query(
        `SELECT pk_district_id AS id, DistrictNumber AS number
         FROM district_master
         WHERE fk_zone_id = @Z AND isdeleted = 0 AND IsActive = 1
         ORDER BY DistrictNumber`,
        { Z: zoneId },
      )).map((r) => ({ districtId: Number(r.id), districtNumber: String(r.number) }));
      const result: GoalOverviewMatrixDto = { zoneId, zoneName: String(zoneName), categoryId, categoryName, yearId: y.yearId, yearLabel: y.yearLabel, districts, rows: [] };
      const template = await this.loadFieldsWithValues(conn, categoryId, y.yearId, "District", 0, 0, false);
      if (!template.length) return result;
      const perDistrict = new Map<number, Map<number, GoalFieldWithValueDto>>();
      for (const d of districts) perDistrict.set(d.districtId, new Map((await this.loadFieldsWithValues(conn, categoryId, y.yearId, "District", 0, d.districtId, y.isEditable)).map((f) => [f.fieldId, f])));

      type Slot = { target: GoalFieldWithValueDto | null; achieved: GoalFieldWithValueDto | null; reference: GoalFieldWithValueDto | null };
      const rowOrder: { groupName: string; baseKey: string }[] = [];
      const rowFields = new Map<string, Slot>();
      const suggestionFields: GoalFieldWithValueDto[] = [];
      for (const f of template) {
        if (!YOUTH_DISTRICT_OWN_KEYS.has(f.fieldKey) && (/_pct$/i.test(f.fieldKey) || /_percentage_achievement$/i.test(f.fieldKey) || f.fieldKey === "percentage_increase")) continue;
        const baseKey = isSuggestionGroup(f.groupName) ? "suggestions" : stripRoleSuffix(f.fieldKey);
        const key = `${f.groupName}\u0000${baseKey}`;
        if (!rowFields.has(key)) { rowFields.set(key, { target: null, achieved: null, reference: null }); rowOrder.push({ groupName: f.groupName, baseKey }); }
        if (isSuggestionGroup(f.groupName)) { suggestionFields.push(f); continue; }
        const cur = rowFields.get(key)!;
        if (isTargetField(f)) cur.target ??= f;
        else if (/_achieved$/i.test(f.fieldKey)) cur.achieved ??= f;
        else cur.reference ??= f;
      }
      for (const { groupName, baseKey } of rowOrder) {
        if (baseKey === "suggestions" && suggestionFields.length) {
          result.rows.push({
            metricKey: "suggestions", groupName, label: "Suggestions", referenceLabel: null, dataType: "Text", unit: null, hasReference: true, hasTarget: false, hasAchieved: false,
            cells: districts.map((d) => {
              const by = perDistrict.get(d.districtId)!;
              const entries = suggestionFields.map((f) => by.get(f.fieldId)?.textValue ?? null).filter((t): t is string => !!t && !!t.trim()).map((t) => t.trim());
              return { districtId: d.districtId, total: entries.length ? entries.map((t, i) => `${i + 1}) ${t}`).join("\n") : null, target: null, achieved: null };
            }),
          });
          continue;
        }
        const { target: tt, achieved: ta, reference: tr } = rowFields.get(`${groupName}\u0000${baseKey}`)!;
        const sample = (tt ?? ta ?? tr)!;
        result.rows.push({
          metricKey: baseKey, groupName, label: YOUTH_DISTRICT_OWN_KEYS.has(sample.fieldKey) ? sample.fieldLabel : rowLabel(groupName, tt, ta, tr),
          referenceLabel: tr?.fieldLabel ?? null, dataType: sample.dataType, unit: sample.unit, hasReference: tr !== null, hasTarget: tt !== null, hasAchieved: ta !== null,
          cells: districts.map((d) => {
            const by = perDistrict.get(d.districtId)!;
            return { districtId: d.districtId, total: formatFieldValue(tr ? by.get(tr.fieldId) : null), target: formatFieldValue(tt ? by.get(tt.fieldId) : null), achieved: formatFieldValue(ta ? by.get(ta.fieldId) : null) };
          }),
        });
      }
      return result;
    });
  }
}
