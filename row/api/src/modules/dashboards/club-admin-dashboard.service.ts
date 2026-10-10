import { Injectable } from "@nestjs/common";
import { Db, type DbCommands, type Row } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { UnauthorizedAccessException } from "../../common/exceptions";
import { YearTableResolver, type YearTableInfo } from "../../services/year-table.resolver";
import { CurrencyRateService } from "../../services/currency-rate.service";
import { convertCurrency, normalizeCurrency, resolveDefaultCurrency } from "../../services/currency.helper";
import { buildWebsiteUrl } from "../../services/member-scopes.helper";

const MONTH_LABELS = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const AVENUE_ORDER: [string, string][] = [
  ["club_service", "Club Service"],
  ["community_service", "Community Service"],
  ["vocational_service", "Vocational Service"],
  ["international_service", "International Service"],
  ["new_generation_service", "New Generation"],
  ["public_image_initiative", "Public Image"],
  ["pph_camp", "PPH Camp"],
];
const MEMBER_PHOTO = (alias: string) => `
    CASE
        WHEN ${alias}.ProfilePhotoPath IS NULL OR ${alias}.ProfilePhotoPath = '' THEN NULL
        WHEN ${alias}.ProfilePhotoPath LIKE '/Documents/directory/%' THEN ${alias}.ProfilePhotoPath
        ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(${alias}.ProfilePhotoPath, '/', -1))
    END`;

export const int = (v: unknown) => (v === null || v === undefined ? 0 : Math.trunc(Number(v)) || 0);
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v) || 0);
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown) => v === true || Number(v) === 1;
/** DateTime?.ToString("yyyy-MM-dd") of a value read from the database. */
export const ymd = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v).slice(0, 10));
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;
/** DateTime.AddMonths on a "yyyy-MM-dd" value. */
export function addMonths(date: string, months: number): string {
  const [y, m] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-${date.slice(8, 10)}`;
}
const has = (text: string, ...needles: string[]) => !!text && needles.some((n) => text.toLowerCase().includes(n));

interface Identity {
  memberId: number;
  name: string;
  clubId: number;
  clubName: string;
  districtNumber: string;
  yearLabel: string;
  rotaryOrgSyncEnabled: boolean;
  clubWebsiteActive: boolean;
  clubWebsiteExpiry: string | null;
  emailCreditBalance: number;
  whatsAppCreditBalance: number;
}
interface Ctx {
  conn: DbCommands;
  clubId: number;
  yearId: number;
  identity: Identity;
}
interface YearOption {
  id: number;
  yearLabel: string;
  isCurrent: boolean;
}

/**
 * Port of ClubAdminDashboardService.cs: the Club Admin dashboard tabs. Every
 * call resolves the club (the requested one, which must be administered by the
 * member or overridable by a SuperAdmin / District Admin with all-clubs access,
 * else the member's first club-admin club) and the year (requested, else the
 * current Rotary year).
 */
type OngoingRow = { id: number; sr: number; date: string; parentProjectId: number | null };

/**
 * An entry whose ongoing parent is from an EARLIER year has no parent in the list, so the screen
 * dropped it while the Projects tile counted it. The earliest such entry per old parent becomes a
 * top row and later ones nest under it; top rows are then numbered newest first.
 */
export function regroupOngoing<T extends OngoingRow>(ongoing: T[]): T[] {
  const isChild = (o: T) => (o.parentProjectId ?? 0) > 0;
  const parentIds = new Set(ongoing.filter((o) => !isChild(o)).map((o) => o.id));
  const groups = new Map<number, T[]>();
  for (const o of ongoing) if (isChild(o) && !parentIds.has(o.parentProjectId!)) groups.set(o.parentProjectId!, [...(groups.get(o.parentProjectId!) ?? []), o]);
  for (const grp of groups.values()) {
    const ordered = [...grp].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
    ordered[0].parentProjectId = null;
    for (const c of ordered.slice(1)) c.parentProjectId = ordered[0].id;
  }
  const tops = ongoing.filter((o) => !isChild(o)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  tops.forEach((o, i) => (o.sr = i + 1));
  return [...tops, ...ongoing.filter(isChild)];
}

@Injectable()
export class ClubAdminDashboardService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly yearTables: YearTableResolver,
    private readonly fx: CurrencyRateService,
  ) {}

  // ---- shared resolution ----

  /** ClubAdminAccessHelper.CanOverrideClubAdminAsync: SuperAdmin, or District Admin with AllClubsAccess for the club's district. */
  static async canOverrideClubAdmin(conn: DbCommands, memberId: number, clubId: number): Promise<boolean> {
    if (memberId <= 0) return false;
    const sa = Number(
      await conn.executeScalar(
        `SELECT COUNT(*) FROM member_roles mr
         JOIN roles r ON r.pk_role_id = mr.fk_role_id
         WHERE mr.fk_member_master_profile_id = @MemberId
           AND r.RoleName = 'SuperAdmin'
           AND mr.IsActive = 1 AND mr.isdeleted = 0`,
        { MemberId: memberId },
      ),
    );
    if (sa > 0) return true;
    if (clubId <= 0) return false;
    return (
      Number(
        await conn.executeScalar(
          `SELECT COUNT(*) FROM member_roles mr
           JOIN club_master c ON c.pk_club_id = @ClubId AND c.isdeleted = 0
           WHERE mr.fk_member_master_profile_id = @MemberId
             AND mr.fk_role_id = 2
             AND mr.fk_district_id = c.fk_district_id
             AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
             AND mr.AllClubsAccess = 1
             AND mr.IsActive = 1 AND mr.isdeleted = 0`,
          { MemberId: memberId, ClubId: clubId },
        ),
      ) > 0
    );
  }

  private static async resolveClubId(conn: DbCommands, memberId: number, requested: number | null): Promise<number> {
    if (memberId <= 0) return 0;
    if (requested && requested > 0) {
      const isAdmin = Number(
        await conn.executeScalar(
          `SELECT COUNT(*) FROM member_roles
           WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2 AND fk_club_id = @ClubId
             AND IsActive = 1 AND isdeleted = 0`,
          { MemberId: memberId, ClubId: requested },
        ),
      );
      if (isAdmin === 0 && !(await ClubAdminDashboardService.canOverrideClubAdmin(conn, memberId, requested))) {
        throw new UnauthorizedAccessException("You are not an active admin for this club.");
      }
      return requested;
    }
    return int(
      await conn.executeScalar(
        `SELECT fk_club_id FROM member_roles
         WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2
           AND fk_club_id IS NOT NULL AND fk_club_id > 0
           AND IsActive = 1 AND isdeleted = 0
         ORDER BY pk_member_role_id ASC
         LIMIT 1`,
        { MemberId: memberId },
      ),
    );
  }

  static async resolveYearId(conn: DbCommands, yearId: number | null): Promise<number> {
    if (yearId && yearId > 0) return yearId;
    return int(await conn.executeScalar("SELECT pk_year_id FROM rotary_year_master WHERE isdeleted = 0 AND IsCurrent = 1 LIMIT 1"));
  }

  private static async identity(conn: DbCommands, memberId: number, clubId: number, yearId: number): Promise<Identity | null> {
    if (clubId === 0) return null;
    const info = await conn.queryFirstOrDefault(
      `SELECT c.ClubName AS clubName, COALESCE(d.DistrictNumber,'') AS districtNumber,
              m.MemberName AS memberName,
              COALESCE(c.IsSyncedFromRotaryOrg, 0) AS isRotaryOrgSyncEnabled
       FROM club_master c
       LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
       LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = @MemberId
       WHERE c.pk_club_id = @ClubId AND c.isdeleted = 0 LIMIT 1`,
      { ClubId: clubId, MemberId: memberId },
    );
    if (!info) return null;
    const yearLabel = (await conn.executeScalar<string>("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @YearId LIMIT 1", { YearId: yearId })) ?? "";
    const ws = await conn.queryFirstOrDefault(
      `SELECT EndDate AS endDate, Status AS status,
              (EndDate IS NULL OR DATE(EndDate) >= CURDATE()) AS notExpired
       FROM club_websites
       WHERE fk_club_id = @ClubId AND isdeleted = 0
       ORDER BY pk_id DESC LIMIT 1`,
      { ClubId: clubId },
    );
    const credits = await conn.queryFirstOrDefault(
      `SELECT COALESCE(SUM(CASE WHEN CreditType = 'Email' THEN CreditCount - UsedCount END), 0) AS email,
              COALESCE(SUM(CASE WHEN CreditType = 'WhatsApp' THEN CreditCount - UsedCount END), 0) AS whatsApp
       FROM club_credits
       WHERE fk_club_id = @ClubId AND IsActive = 1 AND isdeleted = 0 AND NOW() <= ToDate`,
      { ClubId: clubId },
    );
    return {
      memberId,
      name: str(info.memberName) ?? "",
      clubId,
      clubName: str(info.clubName) ?? "",
      districtNumber: str(info.districtNumber) ?? "",
      yearLabel,
      rotaryOrgSyncEnabled: bool(info.isRotaryOrgSyncEnabled),
      clubWebsiteActive: !!ws && String(ws.status ?? "").toLowerCase() === "active" && bool(ws.notExpired),
      clubWebsiteExpiry: (ws?.endDate as string | null) ?? null,
      emailCreditBalance: int(credits?.email),
      whatsAppCreditBalance: int(credits?.whatsApp),
    };
  }

  /** The club and year for a tab, or null when the member administers no club (the controller's 404). */
  private async context<T>(memberId: number, yearId: number | null, clubId: number | null, work: (ctx: Ctx) => Promise<T>): Promise<T | null> {
    return this.db.session(async (conn) => {
      const resolvedClub = await ClubAdminDashboardService.resolveClubId(conn, memberId, clubId);
      if (resolvedClub === 0) return null;
      const resolvedYear = await ClubAdminDashboardService.resolveYearId(conn, yearId);
      const identity = await ClubAdminDashboardService.identity(conn, memberId, resolvedClub, resolvedYear);
      if (!identity) return null;
      return work({ conn, clubId: resolvedClub, yearId: resolvedYear, identity });
    });
  }

  /** Start and end ("yyyy-MM-dd") of a Rotary year. */
  static async yearRange(conn: DbCommands, yearId: number): Promise<{ start: string | null; end: string | null }> {
    if (yearId <= 0) return { start: null, end: null };
    const row = await conn.queryFirstOrDefault(
      "SELECT DATE_FORMAT(StartDate, '%Y-%m-%d') AS s, DATE_FORMAT(EndDate, '%Y-%m-%d') AS e FROM rotary_year_master WHERE pk_year_id = @Id LIMIT 1",
      { Id: yearId },
    );
    return { start: (row?.s as string | null) ?? null, end: (row?.e as string | null) ?? null };
  }

  private async targetTables(conn: DbCommands, yearId: number): Promise<YearTableInfo[]> {
    if (yearId > 0) {
      const t = await this.yearTables.resolveByYearId(conn, yearId);
      return t ? [t] : [];
    }
    return this.yearTables.getAllExistingYearTables(conn);
  }

  private static async clubCurrency(conn: DbCommands, clubId: number) {
    const row = await conn.queryFirstOrDefault(
      `SELECT d.DefaultCurrency AS DefaultCurrency
       FROM club_master c
       JOIN district_master d ON d.pk_district_id = c.fk_district_id
       WHERE c.pk_club_id = @ClubId
       LIMIT 1`,
      { ClubId: clubId },
    );
    return resolveDefaultCurrency((row?.DefaultCurrency as string | null) ?? null);
  }

  private static async avgAttendance(conn: DbCommands, clubId: number, yearId: number): Promise<number> {
    const rows = await conn.query(
      `SELECT
           (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
             WHERE cm.fk_club_id = a.fk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0) AS total,
           (SELECT COUNT(*) FROM club_attendance_members am WHERE am.fk_attendance_id = a.pk_attendance_id) AS present
       FROM club_attendance a
       WHERE a.fk_club_id = @ClubId AND a.isdeleted = 0
         AND (@YearId = 0 OR a.fk_year_id = @YearId)`,
      { ClubId: clubId, YearId: yearId },
    );
    const list = rows.filter((r) => int(r.total) > 0);
    if (!list.length) return 0;
    return round(list.reduce((s, r) => s + (int(r.present) / int(r.total)) * 100, 0) / list.length, 1);
  }

  private static async genderCounts(conn: DbCommands, clubId: number, extra: string, params: Record<string, unknown>) {
    const r = await conn.queryFirstOrDefault(
      `SELECT
           SUM(CASE WHEN m.Gender = 'Male' THEN 1 ELSE 0 END) AS male,
           SUM(CASE WHEN m.Gender = 'Female' THEN 1 ELSE 0 END) AS female,
           SUM(CASE WHEN cm.IsHonoraryMember = 1 THEN 1 ELSE 0 END) AS honorary,
           COUNT(*) AS total
       FROM club_members cm
       JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
       WHERE cm.fk_club_id = @ClubId ${extra}`,
      { ClubId: clubId, ...params },
    );
    return { male: int(r?.male), female: int(r?.female), honorary: int(r?.honorary), total: int(r?.total) };
  }

  /** Joiners per month for the first nine months of the Rotary year. */
  private static async growth(conn: DbCommands, clubId: number, start: string) {
    const points = [];
    for (let i = 0; i < 9; i++) {
      const ms = addMonths(start, i);
      const g = await ClubAdminDashboardService.genderCounts(conn, clubId, "AND cm.isdeleted = 0 AND cm.JoinedDate >= @Start AND cm.JoinedDate < @End", { Start: ms, End: addMonths(ms, 1) });
      points.push({ month: `${MONTH_LABELS[i]} ${ms.slice(0, 4)}`, male: g.male, female: g.female, honorary: g.honorary });
    }
    return points;
  }

  private static async joinedAndTerminated(conn: DbCommands, clubId: number, start: string | null, end: string | null) {
    if (!start) return { newMembers: 0, terminated: 0 };
    const p = { ClubId: clubId, Start: start, End: end };
    return {
      newMembers: int(await conn.executeScalar("SELECT COUNT(*) FROM club_members WHERE fk_club_id = @ClubId AND isdeleted = 0 AND JoinedDate >= @Start AND JoinedDate <= @End", p)),
      terminated: int(await conn.executeScalar("SELECT COUNT(*) FROM club_members WHERE fk_club_id = @ClubId AND isdeleted = 1 AND deleted_date >= @Start AND deleted_date <= @End", p)),
    };
  }

  private static async majorDonors(conn: DbCommands, clubId: number, yearId: number) {
    return int(
      await conn.executeScalar(
        `SELECT COUNT(*) FROM (
             SELECT DonorName, SUM(AmountUSD) AS total
             FROM trf_contributions
             WHERE fk_club_id = @ClubId AND isdeleted = 0
               AND (@YearId = 0 OR fk_year_id = @YearId)
             GROUP BY DonorName
             HAVING SUM(AmountUSD) >= 1000
         ) major`,
        { ClubId: clubId, YearId: yearId },
      ),
    );
  }

  // ---- tabs ----

  async getOverview(memberId: number, yearId: number | null, clubId: number | null) {
    return this.context(memberId, yearId, clubId, async ({ conn, clubId, yearId, identity }) => {
      const { start, end } = await ClubAdminDashboardService.yearRange(conn, yearId);
      const stats = await ClubAdminDashboardService.genderCounts(conn, clubId, "AND cm.IsActive = 1 AND cm.isdeleted = 0", {});
      const { newMembers, terminated } = await ClubAdminDashboardService.joinedAndTerminated(conn, clubId, start, end);
      const trf = await conn.queryFirstOrDefault(
        `SELECT
             COALESCE(SUM(AmountUSD), 0) AS totalUsd,
             COALESCE(SUM(CASE WHEN LOWER(COALESCE(f.FundName, t.OtherFundName, '')) LIKE '%annual%' THEN AmountUSD ELSE 0 END), 0) AS annualUsd,
             COALESCE(SUM(CASE WHEN LOWER(COALESCE(f.FundName, t.OtherFundName, '')) LIKE '%polio%' THEN AmountUSD ELSE 0 END), 0) AS polioUsd,
             COALESCE(SUM(CASE WHEN LOWER(COALESCE(f.FundName, t.OtherFundName, '')) LIKE '%endowment%' THEN AmountUSD ELSE 0 END), 0) AS endowmentUsd
         FROM trf_contributions t
         LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
         WHERE t.fk_club_id = @ClubId AND t.isdeleted = 0
           AND (@YearId = 0 OR t.fk_year_id = @YearId)`,
        { ClubId: clubId, YearId: yearId },
      );
      const phfContributors = int(
        await conn.executeScalar(
          `SELECT COUNT(DISTINCT DonorName) FROM trf_contributions
           WHERE fk_club_id = @ClubId AND isdeleted = 0 AND (@YearId = 0 OR fk_year_id = @YearId) AND AmountUSD > 0`,
          { ClubId: clubId, YearId: yearId },
        ),
      );
      let totalProjects = 0;
      const avenueCounts = new Map<string, number>();
      for (const t of await this.targetTables(conn, yearId)) {
        const rows = await conn.query(
          `SELECT COALESCE(md.ModuleName, 'Other') AS moduleName, COUNT(*) AS cnt
           FROM \`${t.projectsTable}\` p
           LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
           WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0
             AND md.ModuleKey IN ('community_service','vocational_service','international_service','new_generation_service')
           GROUP BY COALESCE(md.ModuleName, 'Other')`,
          { ClubId: clubId },
        );
        for (const r of rows) {
          totalProjects += int(r.cnt);
          const key = str(r.moduleName) ?? "Other";
          avenueCounts.set(key, (avenueCounts.get(key) ?? 0) + int(r.cnt));
        }
      }
      const citation = num(
        await conn.executeScalar(
          `SELECT COALESCE(SUM(points_earned), 0) + COALESCE(SUM(bonus_earned), 0)
           FROM district_citation_club_entry
           WHERE fk_club_id = @ClubId AND isdeleted = 0 AND (@YearId = 0 OR fk_year_id = @YearId)`,
          { ClubId: clubId, YearId: yearId },
        ),
      );
      let citationChecklist: { criterion: string; earned: number; maxPoints: number }[] = [];
      try {
        // RIZones joins c.pk_category_id, which the category table does not have; the C# swallows the error the same way.
        citationChecklist = (
          await conn.query(
            `SELECT COALESCE(c.category_name, 'Other') AS cat,
                    COALESCE(SUM(e.points_earned), 0) + COALESCE(SUM(e.bonus_earned), 0) AS earned
             FROM district_citation_club_entry e
             LEFT JOIN district_citation_question q ON q.pk_question_id = e.fk_question_id
             LEFT JOIN district_citation_category c ON c.pk_category_id = q.fk_category_id
             WHERE e.fk_club_id = @ClubId AND e.isdeleted = 0 AND (@YearId = 0 OR e.fk_year_id = @YearId)
             GROUP BY COALESCE(c.category_name, 'Other')`,
            { ClubId: clubId, YearId: yearId },
          )
        ).map((r) => ({ criterion: String(r.cat), earned: num(r.earned), maxPoints: 0 }));
      } catch {
        citationChecklist = [];
      }
      const upcoming = (
        await conn.query(
          `SELECT Title AS title, EventDate AS eventDate, EventVenue AS location
           FROM upcoming_events
           WHERE fk_club_id = @ClubId AND isdeleted = 0 AND EventDate >= CURDATE()
           ORDER BY EventDate ASC LIMIT 8`,
          { ClubId: clubId },
        )
      ).map((r) => ({ title: str(r.title) ?? "", type: "Event", date: ymd(r.eventDate), location: str(r.location) }));
      return {
        club: identity,
        totalMembers: stats.total - stats.honorary,
        activeMembers: stats.total - stats.honorary,
        maleMembers: stats.male,
        femaleMembers: stats.female,
        honoraryMembers: stats.honorary,
        newMembersThisYear: newMembers,
        terminatedThisYear: terminated,
        avgAttendance: await ClubAdminDashboardService.avgAttendance(conn, clubId, yearId),
        trfRaisedInr: num(trf?.totalUsd),
        trfGoalInr: 0,
        serviceProjects: totalProjects,
        serviceGoal: 20,
        districtCitationScore: citation,
        trfAnnualFund: num(trf?.annualUsd),
        trfPolioFund: num(trf?.polioUsd),
        trfEndowment: num(trf?.endowmentUsd),
        trfMajorDonors: await ClubAdminDashboardService.majorDonors(conn, clubId, yearId),
        phfContributors,
        avenues: [...avenueCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([avenue, completed]) => ({ avenue, completed })),
        citationChecklist,
        memberGrowth: start ? await ClubAdminDashboardService.growth(conn, clubId, start) : [],
        upcomingEvents: upcoming,
      };
    });
  }

  async getFoundation(memberId: number, yearId: number | null, clubId: number | null) {
    return this.context(memberId, yearId, clubId, async ({ conn, clubId, yearId, identity }) => {
      const rows = await conn.query(
        `SELECT COALESCE(f.FundName, t.OtherFundName, 'Other') AS fundName,
                COALESCE(SUM(t.AmountUSD), 0) AS totalUsd,
                COUNT(DISTINCT t.DonorName) AS donorCount
         FROM trf_contributions t
         LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
         WHERE t.fk_club_id = @ClubId AND t.isdeleted = 0
           AND (@YearId = 0 OR t.fk_year_id = @YearId)
         GROUP BY COALESCE(f.FundName, t.OtherFundName, 'Other')`,
        { ClubId: clubId, YearId: yearId },
      );
      let total = 0, annual = 0, polio = 0, endowment = 0, others = 0;
      const metrics = rows.map((r) => {
        const name = str(r.fundName) ?? "Other";
        const value = num(r.totalUsd);
        total += value;
        const lower = name.toLowerCase();
        if (lower.includes("annual")) annual += value;
        else if (lower.includes("polio")) polio += value;
        else if (lower.includes("endowment")) endowment += value;
        else others += value;
        return { id: name.toLowerCase().replace(/ /g, "_"), name, value, unit: "USD" };
      });
      return {
        club: identity, metrics, totalCollectedInr: total, annualFundInr: annual, polioFundInr: polio, endowmentInr: endowment, othersInr: others,
        majorDonors: await ClubAdminDashboardService.majorDonors(conn, clubId, yearId),
      };
    });
  }

  private static memberRow(r: Row) {
    return { memberId: int(r.memberId), name: str(r.name) ?? "", email: str(r.email), mobile: str(r.mobile), gender: str(r.gender), rotaryId: str(r.rotaryId), joinedDate: str(r.joinedDate) };
  }

  async getMembership(memberId: number, yearId: number | null, clubId: number | null) {
    return this.context(memberId, yearId, clubId, async ({ conn, clubId, yearId, identity }) => {
      // Admins first, then members without a mobile, then the rest.
      const members = (
        await conn.query(
          `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS name,
                  m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
                  m.Gender AS gender, m.RotaryId AS rotaryId,
                  DATE_FORMAT(cm.JoinedDate, '%Y-%m-%d') AS joinedDate
           FROM club_members cm
           JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
           LEFT JOIN member_roles mr ON mr.fk_member_master_profile_id = m.pk_member_master_profile_id
               AND mr.IsActive = 1 AND mr.isdeleted = 0
               AND ((mr.fk_role_id = 2 AND mr.fk_club_id = @ClubId)
                 OR (mr.fk_role_id = 2 AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
                     AND mr.fk_district_id = (SELECT fk_district_id FROM club_master WHERE pk_club_id = @ClubId)))
           WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
           GROUP BY m.pk_member_master_profile_id, m.MemberName, m.EmailId, m.PrimaryMobileNumber,
                    m.Gender, m.RotaryId, cm.JoinedDate
           ORDER BY
               CASE
                   WHEN MAX(CASE WHEN mr.fk_role_id = 2 THEN 1 ELSE 0 END) = 1 THEN 0
                   WHEN m.PrimaryMobileNumber IS NULL OR m.PrimaryMobileNumber = '' THEN 1
                   ELSE 2
               END,
               m.MemberName`,
          { ClubId: clubId },
        )
      ).map(ClubAdminDashboardService.memberRow);
      const stats = await ClubAdminDashboardService.genderCounts(conn, clubId, "AND cm.IsActive = 1 AND cm.isdeleted = 0", {});
      const { start, end } = await ClubAdminDashboardService.yearRange(conn, yearId);
      const { newMembers, terminated } = await ClubAdminDashboardService.joinedAndTerminated(conn, clubId, start, end);
      const recent = start
        ? (
            await conn.query(
              `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS name,
                      m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
                      m.Gender AS gender, m.RotaryId AS rotaryId,
                      DATE_FORMAT(cm.JoinedDate, '%Y-%m-%d') AS joinedDate
               FROM club_members cm
               JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
               WHERE cm.fk_club_id = @ClubId AND cm.isdeleted = 0
                 AND cm.JoinedDate >= @Start AND cm.JoinedDate <= @End
               ORDER BY cm.JoinedDate DESC LIMIT 10`,
              { ClubId: clubId, Start: start, End: end },
            )
          ).map(ClubAdminDashboardService.memberRow)
        : [];
      return {
        club: identity,
        totalMembers: members.length - stats.honorary,
        maleMembers: stats.male,
        femaleMembers: stats.female,
        honoraryMembers: stats.honorary,
        newMembersThisYear: newMembers,
        terminatedThisYear: terminated,
        members,
        recentJoiners: recent,
        monthlyTrend: start ? await ClubAdminDashboardService.growth(conn, clubId, start) : [],
      };
    });
  }

  async getAvenue(memberId: number, yearId: number | null, clubId: number | null) {
    return this.context(memberId, yearId, clubId, async ({ conn, clubId, yearId, identity }) => {
      const avenueCounts = new Map<string, number>();
      const projects = [];
      let totalCost = 0;
      let totalBenef = 0;
      const targetCurrency = await ClubAdminDashboardService.clubCurrency(conn, clubId);
      const rates = await this.fx.getRates();
      for (const t of await this.targetTables(conn, yearId)) {
        const rows = await conn.query(
          `SELECT p.title, COALESCE(md.ModuleName, 'Other') AS avenue,
                  COALESCE(aof.name, '') AS category,
                  p.project_date AS projectDate,
                  COALESCE(p.project_cost, 0) AS cost,
                  p.Currency AS currency,
                  COALESCE(p.direct_beneficiaries, 0) AS beneficiaries,
                  COALESCE(f.name, 'Self Funded') AS funding,
                  COALESCE(p.approval_status, '') AS approvalStatus
           FROM \`${t.projectsTable}\` p
           LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
           LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
           LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
           WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0
           ORDER BY p.project_date DESC`,
          { ClubId: clubId },
        );
        for (const r of rows) {
          const avenue = str(r.avenue) ?? "Other";
          avenueCounts.set(avenue, (avenueCounts.get(avenue) ?? 0) + 1);
          const cost = num(r.cost);
          const currency = normalizeCurrency(str(r.currency));
          const benef = int(r.beneficiaries);
          totalCost += convertCurrency(cost, currency, targetCurrency, rates);
          totalBenef += benef;
          projects.push({
            title: str(r.title) ?? "", avenue, category: str(r.category), date: ymd(r.projectDate), cost, currency, beneficiaries: benef,
            funding: str(r.funding), approvalStatus: str(r.approvalStatus) ?? "",
          });
        }
      }
      return {
        club: identity,
        avenues: [...avenueCounts.entries()].sort((a, b) => b[1] - a[1]).map(([avenue, completed]) => ({ avenue, completed })),
        projects,
        totalProjects: projects.length,
        totalCost,
        targetCurrency,
        totalBeneficiaries: totalBenef,
      };
    });
  }

  async getEGovernance(memberId: number, yearId: number | null, clubId: number | null) {
    return this.context(memberId, yearId, clubId, async ({ conn, clubId, yearId, identity }) => {
      const cmr = (
        await conn.query(
          `SELECT ReportMonth, IsUploadedToDistrict AS submitted, DATE_FORMAT(created_date, '%Y-%m-%d') AS submittedDate
           FROM club_monthly_reports
           WHERE fk_club_id = @ClubId AND isdeleted = 0 AND (@YearId = 0 OR fk_year_id = @YearId)
           ORDER BY ReportMonth DESC`,
          { ClubId: clubId, YearId: yearId },
        )
      ).map((r) => ({ reportMonth: r.ReportMonth === null || r.ReportMonth === undefined ? "" : String(r.ReportMonth), isSubmitted: bool(r.submitted), submittedDate: str(r.submittedDate) }));
      const meetings = (
        await conn.query(
          `SELECT a.EventDateTime AS meetingDate, a.EventName AS topic,
                  (SELECT COUNT(*) FROM club_attendance_members am WHERE am.fk_attendance_id = a.pk_attendance_id) AS present,
                  (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                    WHERE cm.fk_club_id = a.fk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0) AS total
           FROM club_attendance a
           WHERE a.fk_club_id = @ClubId AND a.isdeleted = 0 AND (@YearId = 0 OR a.fk_year_id = @YearId)
           ORDER BY a.EventDateTime DESC LIMIT 20`,
          { ClubId: clubId, YearId: yearId },
        )
      ).map((r) => {
        const present = int(r.present);
        const total = int(r.total);
        return { date: ymd(r.meetingDate) ?? "", topic: str(r.topic), present, total, pct: total > 0 ? round((present / total) * 100, 1) : 0 };
      });
      const submitted = cmr.filter((c) => c.isSubmitted).length;
      return {
        club: identity,
        clubMonthlyReports: cmr,
        recentMeetings: meetings,
        cmrSubmitted: submitted,
        cmrPending: cmr.length - submitted,
        avgAttendance: await ClubAdminDashboardService.avgAttendance(conn, clubId, yearId),
        meetingsHeld: meetings.length,
      };
    });
  }

  async getCommunication(memberId: number, yearId: number | null, clubId: number | null) {
    return this.context(memberId, yearId, clubId, async ({ conn, clubId, yearId, identity }) => {
      const { start, end } = await ClubAdminDashboardService.yearRange(conn, yearId);
      const p = { ClubId: clubId, YStart: start, YEnd: end };
      const inYear = (col: string) => `(@YStart IS NULL OR ${col} BETWEEN @YStart AND @YEnd)`;
      const announcements = await conn.query(
        `SELECT Title AS title, PublishDateTime AS publishDate,
                CASE WHEN ImagePath IS NULL OR ImagePath = '' THEN NULL
                     WHEN ImagePath LIKE '/%' THEN ImagePath
                     ELSE CONCAT('/Documents/announcement/Group', fk_club_id, '/', ImagePath) END AS imagePath,
                Description AS description
         FROM announcements
         WHERE fk_club_id = @ClubId AND isdeleted = 0 AND ${inYear("PublishDateTime")}
         ORDER BY PublishDateTime DESC LIMIT 15`,
        p,
      );
      const announcementCount = int(await conn.executeScalar(`SELECT COUNT(*) FROM announcements WHERE fk_club_id = @ClubId AND isdeleted = 0 AND ${inYear("PublishDateTime")}`, p));
      const newsletters = await conn.query(
        `SELECT Title AS title, PublishDateTime AS publishDate FROM newsletters
         WHERE fk_club_id = @ClubId AND COALESCE(isdeleted, 0) = 0 AND ${inYear("PublishDateTime")}
         ORDER BY PublishDateTime DESC LIMIT 15`,
        p,
      );
      const newsletterCount = int(await conn.executeScalar(`SELECT COUNT(*) FROM newsletters WHERE fk_club_id = @ClubId AND COALESCE(isdeleted, 0) = 0 AND ${inYear("PublishDateTime")}`, p));
      const eventWhere = `fk_club_id = @ClubId AND isdeleted = 0
           AND ((@YStart IS NULL AND EventDate >= CURDATE()) OR (@YStart IS NOT NULL AND EventDate BETWEEN @YStart AND @YEnd))`;
      const events = await conn.query(`SELECT Title AS title, EventDate AS publishDate, EventVenue AS description FROM upcoming_events WHERE ${eventWhere} ORDER BY EventDate ASC LIMIT 15`, p);
      const eventCount = int(await conn.executeScalar(`SELECT COUNT(*) FROM upcoming_events WHERE ${eventWhere}`, p));
      let documents: Row[] = [];
      let documentCount = 0;
      try {
        // RIZones reads a "documents" table that does not exist (the table is club_documents); the error is swallowed there too.
        documents = await conn.query(
          `SELECT Title AS title, PublishDateTime AS publishDate FROM documents
           WHERE fk_club_id = @ClubId AND isdeleted = 0 AND ${inYear("PublishDateTime")}
           ORDER BY PublishDateTime DESC LIMIT 15`,
          p,
        );
        documentCount = int(await conn.executeScalar(`SELECT COUNT(*) FROM documents WHERE fk_club_id = @ClubId AND isdeleted = 0 AND ${inYear("PublishDateTime")}`, p));
      } catch {
        documents = [];
      }
      const greetings = async (col: string, kind: string) =>
        (
          await conn.query(
            `SELECT m.MemberName AS Name, m.PrimaryMobileNumber AS Mobile, m.${col} AS Date, '${kind}' AS Kind, DAY(m.${col}) AS Day
             FROM club_members cm
             JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
             WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
               AND m.${col} IS NOT NULL AND MONTH(m.${col}) = MONTH(CURDATE())
             ORDER BY DAY(m.${col}), m.MemberName`,
            { ClubId: clubId },
          )
        ).map((r) => ({ name: str(r.Name) ?? "", mobile: str(r.Mobile), date: str(r.Date), kind, day: int(r.Day) }));
      const birthdays = await greetings("BirthDate", "birthday");
      const anniversaries = await greetings("AnniversaryDate", "anniversary");
      const today = new Date().getUTCDate();
      const item = (r: Row, kind: string) => ({
        kind,
        title: str(r.title) ?? "",
        publishDate: ymd(r.publishDate),
        imagePath: kind === "announcement" ? str(r.imagePath) : null,
        description: kind !== "newsletter" ? str(r.description) : null,
      });
      return {
        club: identity,
        announcementCount,
        newsletterCount,
        upcomingEventCount: eventCount,
        documentCount,
        greetingsTodayCount: birthdays.filter((b) => b.day === today).length + anniversaries.filter((a) => a.day === today).length,
        announcements: announcements.map((r) => item(r, "announcement")),
        newsletters: newsletters.map((r) => item(r, "newsletter")),
        upcomingEvents: events.map((r) => item(r, "event")),
        documents: documents.map((r) => item(r, "document")),
        birthdaysThisMonth: birthdays,
        anniversariesThisMonth: anniversaries,
      };
    });
  }

  async getWebsite(memberId: number, yearId: number | null, clubId: number | null) {
    return this.context(memberId, yearId, clubId, async ({ conn, clubId, yearId, identity }) => {
      const blank = {
        club: identity, configured: false, subdomain: "", thirdPartyDomain: null, visitUrl: null, status: "not_configured", activatedDate: null,
        expiryDate: null, menuCount: 0, bannerCount: 0, eventCount: 0, announcementCount: 0, killSwitchOn: false,
      };
      const ws = await conn.queryFirstOrDefault(
        `SELECT Subdomain, ClientDomain, EndDate AS endDate, AmountPaid AS amountPaid, TransactionId AS transactionId,
                IsPurchased AS isPurchased, Status AS rawStatus, created_date AS createdDate,
                (EndDate IS NOT NULL AND DATE(EndDate) < CURDATE()) AS isExpired
         FROM club_websites
         WHERE fk_club_id = @ClubId AND COALESCE(isdeleted, 0) = 0
         ORDER BY pk_id DESC LIMIT 1`,
        { ClubId: clubId },
      );
      if (!ws) return blank;
      const isPaid = bool(ws.isPurchased) || num(ws.amountPaid) > 0 || !!(ws.transactionId && String(ws.transactionId).trim());
      const rawStatus = String(ws.rawStatus ?? "").trim();
      const isActive = rawStatus.toLowerCase() === "active";
      let status: string;
      if (!isActive && rawStatus.length > 0) status = rawStatus.toLowerCase();
      else if (!isActive) status = "inactive";
      else if (ws.endDate === null) status = "trial";
      else if (bool(ws.isExpired)) status = isPaid ? "expired" : "trial_expired";
      else status = isPaid ? "active" : "trial";
      const { start, end } = await ClubAdminDashboardService.yearRange(conn, yearId);
      const p = { ClubId: clubId, YearId: yearId, YStart: start, YEnd: end };
      let parentDomain = await conn.executeScalar<string>("SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteParentDomain' LIMIT 1");
      if (!parentDomain || !parentDomain.trim()) parentDomain = Brand.Current.domains.clubSiteParent;
      const url = buildWebsiteUrl(str(ws.ClientDomain), str(ws.Subdomain), parentDomain);
      return {
        ...blank,
        configured: true,
        subdomain: str(ws.Subdomain) ?? "",
        thirdPartyDomain: url,
        visitUrl: url,
        status,
        activatedDate: ymd(ws.createdDate),
        expiryDate: ymd(ws.endDate),
        menuCount: int(await conn.executeScalar("SELECT COUNT(*) FROM club_website_menu WHERE fk_club_id = @ClubId AND isdeleted = 0", p)),
        bannerCount: int(await conn.executeScalar("SELECT COUNT(*) FROM club_website_banner WHERE fk_club_id = @ClubId AND isdeleted = 0 AND (@YearId = 0 OR fk_year_id = @YearId)", p)),
        eventCount: int(await conn.executeScalar("SELECT COUNT(*) FROM upcoming_events WHERE fk_club_id = @ClubId AND isdeleted = 0 AND (@YStart IS NULL OR EventDate BETWEEN @YStart AND @YEnd)", p)),
        announcementCount: int(await conn.executeScalar("SELECT COUNT(*) FROM announcements WHERE fk_club_id = @ClubId AND isdeleted = 0 AND (@YStart IS NULL OR PublishDateTime BETWEEN @YStart AND @YEnd)", p)),
      };
    });
  }

  /** Dues for the year: a member is paid when payments (net of the online surcharge) cover the per-member due. */
  async getPayments(memberId: number, yearId: number | null, clubId: number | null) {
    return this.context(memberId, yearId, clubId, async ({ conn, clubId, identity }) => {
      const empty = { club: identity, totalDue: 0, totalCollected: 0, paidCount: 0, unpaidCount: 0, partialCount: 0, honoraryCount: 0, members: [] as unknown[] };
      const dues = await conn.queryFirstOrDefault(
        `SELECT pk_membership_dues_id AS id, OnlineSurchargePercent,
                IsFees1, IsFees2, IsFees3, DefaultAnnualAmount, DefaultSemi1Amount, DefaultSemi2Amount
         FROM membership_dues
         WHERE fk_club_id = @ClubId AND RotaryYear = @YearLabel AND IsActive = 1 AND isdeleted = 0
         ORDER BY pk_membership_dues_id DESC LIMIT 1`,
        { ClubId: clubId, YearLabel: identity.yearLabel },
      );
      if (!dues) return empty;
      const surcharge = num(dues.OnlineSurchargePercent);
      const annual = num(dues.DefaultAnnualAmount);
      const perMemberDue = bool(dues.IsFees1) && annual > 0
        ? annual
        : (bool(dues.IsFees2) ? num(dues.DefaultSemi1Amount) : 0) + (bool(dues.IsFees3) ? num(dues.DefaultSemi2Amount) : 0);
      const rows = await conn.query(
        `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                COALESCE((SELECT SUM(CASE WHEN p.IsOnline = 1 THEN ROUND(p.Amount / (1 + @SurchargePercent / 100), 2) ELSE p.Amount END)
                          FROM membership_dues_payments p
                          WHERE p.fk_member_profile_id = m.pk_member_master_profile_id
                            AND p.fk_membership_dues_id = @DuesId AND p.IsPaid = 1), 0) AS paid
         FROM club_members cm
         JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
         WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
           AND COALESCE(cm.IsHonoraryMember, 0) = 0
         ORDER BY m.MemberName`,
        { ClubId: clubId, DuesId: int(dues.id), SurchargePercent: surcharge },
      );
      const honoraryCount = int(
        await conn.executeScalar(
          "SELECT COUNT(*) FROM club_members WHERE fk_club_id = @ClubId AND IsActive = 1 AND isdeleted = 0 AND COALESCE(IsHonoraryMember, 0) = 1",
          { ClubId: clubId },
        ),
      );
      let totalDue = 0, paidCount = 0, unpaidCount = 0, partialCount = 0;
      const members = rows.map((r) => {
        const paid = num(r.paid);
        totalDue += Math.round(perMemberDue);
        let status: string;
        if (perMemberDue === 0) status = "no_dues";
        else if (paid >= perMemberDue - 0.01) (status = "paid"), paidCount++;
        else if (paid > 0) (status = "partial"), partialCount++;
        else (status = "unpaid"), unpaidCount++;
        return { memberId: int(r.memberId), memberName: str(r.memberName) ?? "", amountDue: perMemberDue, amountPaid: paid, status };
      });
      return { ...empty, totalDue, totalCollected: Math.round(perMemberDue) * paidCount, paidCount, unpaidCount, partialCount, honoraryCount, members };
    });
  }

  async getDashboardDirectory(memberId: number, yearId: number | null, clubId: number | null) {
    return this.context(memberId, yearId, clubId, async ({ conn, clubId, yearId, identity }) => {
      const rows = await conn.query(
        `SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS name, m.EmailId AS email,
                m.PrimaryMobileNumber AS mobile, m.Gender AS gender, m.RotaryId AS rotaryId,
                ${MEMBER_PHOTO("m")} AS photoPath,
                COALESCE(cm.IsHonoraryMember, 0) AS isHonorary,
                DATE_FORMAT(cm.JoinedDate, '%Y-%m-%d') AS joinedDate,
                (SELECT dg.designation_name
                   FROM board_of_directors bod
                   JOIN designation_master dg ON dg.pk_designation_id = bod.fk_designation_id
                  WHERE bod.fk_member_master_profile_id = m.pk_member_master_profile_id
                    AND bod.fk_club_id = @ClubId AND bod.isdeleted = 0
                    AND (@YearId = 0 OR bod.fk_year_id = @YearId)
                  ORDER BY dg.sort_order LIMIT 1) AS designation,
                (SELECT COUNT(*) FROM member_roles mr
                  WHERE mr.fk_member_master_profile_id = m.pk_member_master_profile_id
                    AND mr.fk_role_id = 2 AND mr.fk_club_id = @ClubId
                    AND mr.IsActive = 1 AND mr.isdeleted = 0) AS adminFlag,
                (SELECT COUNT(*) FROM member_roles mr
                  WHERE mr.fk_member_master_profile_id = m.pk_member_master_profile_id
                    AND mr.fk_role_id = 2
                    AND mr.fk_district_id = (SELECT fk_district_id FROM club_master WHERE pk_club_id = @ClubId)
                    AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
                    AND mr.IsActive = 1 AND mr.isdeleted = 0) AS districtAdminFlag
         FROM club_members cm
         JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
         WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
         ORDER BY m.MemberName`,
        { ClubId: clubId, YearId: yearId },
      );
      let honorary = 0, clubAdmins = 0, male = 0, female = 0;
      const members = rows.map((r) => {
        const isHonorary = bool(r.isHonorary);
        const isClubAdmin = int(r.adminFlag) > 0;
        const gender = String(r.gender ?? "").toLowerCase();
        if (isHonorary) honorary++;
        if (isClubAdmin) clubAdmins++;
        if (gender === "male") male++;
        else if (gender === "female") female++;
        return {
          memberId: int(r.memberId), name: str(r.name) ?? "", email: str(r.email), mobile: str(r.mobile), gender: str(r.gender), rotaryId: str(r.rotaryId),
          photoPath: str(r.photoPath), designation: str(r.designation), isHonorary, isClubAdmin, isDistrictAdmin: int(r.districtAdminFlag) > 0,
          joinedDate: str(r.joinedDate),
        };
      });
      return {
        club: identity, totalMembers: members.length - honorary, fullMembers: members.length - honorary, honoraryMembers: honorary,
        clubAdminsCount: clubAdmins, maleMembers: male, femaleMembers: female, members,
      };
    });
  }

  async getDashboardBod(memberId: number, yearId: number | null, clubId: number | null) {
    return this.context(memberId, yearId, clubId, async ({ conn, clubId, yearId, identity }) => {
      const years: YearOption[] = (
        await conn.query(
          `SELECT y.pk_year_id AS id, y.YearLabel AS yearLabel, COALESCE(y.IsCurrent, 0) AS isCurrent
           FROM rotary_year_master y
           WHERE EXISTS (SELECT 1 FROM board_of_directors b WHERE b.fk_club_id = @ClubId AND b.fk_year_id = y.pk_year_id AND b.isdeleted = 0)
           ORDER BY y.pk_year_id DESC`,
          { ClubId: clubId },
        )
      ).map((y) => ({ id: int(y.id), yearLabel: str(y.yearLabel) ?? "", isCurrent: bool(y.isCurrent) }));
      let selected = yearId;
      if (selected <= 0 || !years.some((o) => o.id === selected)) selected = years[0]?.id ?? 0;
      const directors = (
        await conn.query(
          `SELECT b.pk_board_director_id AS id, b.fk_designation_id AS designationId, d.designation_name AS designation, d.sort_order AS sortOrder,
                  m.pk_member_master_profile_id AS memberId,
                  CASE WHEN b.fk_member_master_profile_id IS NOT NULL THEN 1 ELSE 0 END AS isMember,
                  COALESCE(m.MemberName, b.non_member_name, '') AS name,
                  COALESCE(m.EmailId, b.non_member_email) AS email,
                  COALESCE(m.PrimaryMobileNumber, b.non_member_mobile) AS mobile,
                  CASE WHEN b.fk_member_master_profile_id IS NULL THEN NULL ELSE ${MEMBER_PHOTO("m")} END AS photoPath
           FROM board_of_directors b
           LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
           LEFT JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
           WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId AND b.isdeleted = 0
             AND (b.fk_member_master_profile_id IS NULL OR m.pk_member_master_profile_id IS NOT NULL)
           ORDER BY CASE b.fk_designation_id WHEN 1 THEN 0 WHEN 2 THEN 1 ELSE 2 END, d.sort_order, d.designation_name`,
          { ClubId: clubId, YearId: selected },
        )
      ).map((r, i) => ({
        id: int(r.id), sr: i + 1, name: str(r.name) ?? "", designation: str(r.designation) ?? "",
        designationSortOrder: r.sortOrder === null ? null : int(r.sortOrder), mobile: str(r.mobile), email: str(r.email), photoPath: str(r.photoPath),
        designationId: r.designationId === null ? null : int(r.designationId), memberId: int(r.memberId), isMember: bool(r.isMember),
      }));
      return {
        club: identity,
        boardMembers: directors.length,
        executiveRoles: directors.filter((d) => has(d.designation, "president", "vice president", "secretary", "treasurer", "sergeant")).length,
        serviceChairs: directors.filter((d) => has(d.designation, "club service", "community service", "vocational service", "international service", "new generation")).length,
        growthOutreach: directors.filter((d) => has(d.designation, "membership", "public image", "youth")).length,
        selectedYearLabel: years.find((o) => o.id === selected)?.yearLabel ?? "",
        selectedYearId: selected > 0 ? selected : null,
        availableYears: years,
        directors,
      };
    });
  }

  /** The marketplace card. Its name, address and support contact come from configuration (Marketplace:*) and the brand. */
  async getDashboardMarketplace(memberId: number, yearId: number | null, clubId: number | null) {
    return this.context(memberId, yearId, clubId, async ({ conn, clubId, identity }) => {
      const listingsCount = int(
        await conn.executeScalar(
          `SELECT (SELECT COUNT(*) FROM upcoming_events WHERE fk_club_id = @ClubId AND isdeleted = 0 AND EventDate >= CURDATE())
                + (SELECT COUNT(*) FROM announcements WHERE fk_club_id = @ClubId AND isdeleted = 0)`,
          { ClubId: clubId },
        ),
      );
      const listings = (
        await conn.query(
          `SELECT Title AS title, EventDate AS date FROM upcoming_events
           WHERE fk_club_id = @ClubId AND isdeleted = 0 AND EventDate >= CURDATE()
           ORDER BY EventDate ASC LIMIT 8`,
          { ClubId: clubId },
        )
      ).map((u) => ({ title: str(u.title) ?? "", kind: "event", date: ymd(u.date), status: "Active" }));
      const rotaryId = (await conn.executeScalar<string>("SELECT ClubRotaryId FROM club_master WHERE pk_club_id = @ClubId AND isdeleted = 0", { ClubId: clubId })) ?? "";
      const subscription = identity.clubWebsiteActive ? "Active" : "Inactive";
      const marketplaceId = rotaryId ? "#" + rotaryId : "—";
      const launchUrl = this.config.get("Marketplace:Url") ?? "";
      return {
        club: identity,
        subscription,
        clubListingsCount: listingsCount,
        memberId: marketplaceId,
        platform: this.config.get("Marketplace:Name") ?? Brand.Current.productName,
        platformUrl: launchUrl.replace(/^https?:\/\//, "").replace(/\/+$/, ""),
        launchUrl,
        listings,
        account: {
          clubName: identity.clubName, marketplaceId, districtNumber: identity.districtNumber, subscription,
          contactSupport: this.config.get("Marketplace:SupportEmail") ?? (Brand.Current.support.email || null),
        },
      };
    });
  }

  private static networkRow(fullName: string, memberType: string, rotaryId: string | null, admissionDate: string | null, terminationDate: string | null,
    terminationReason: string, id: number, status: string, mobile: string | null, email: string | null, notes: string | null = null) {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    return {
      id, memberId: rotaryId ?? "", memberType, firstName: parts[0] ?? "", middleName: parts.length > 2 ? parts.slice(1, -1).join(" ") : "",
      lastName: parts.length > 1 ? parts[parts.length - 1] : "", admissionDate, terminationDate, terminationReason, status, mobile, email, notes,
    };
  }

  async getDashboardRotaryNetwork(memberId: number, yearId: number | null, clubId: number | null) {
    return this.context(memberId, yearId, clubId, async ({ conn, clubId, yearId, identity }) => {
      const terminated = (
        await conn.query(
          `SELECT cm.pk_club_member_id AS id, m.pk_member_master_profile_id AS memberId, m.RotaryId AS rotaryId,
                  CASE WHEN COALESCE(cm.IsHonoraryMember, 0) = 1 THEN 'Honorary' ELSE '' END AS memberType,
                  m.MemberName AS fullName,
                  DATE_FORMAT(cm.JoinedDate, '%Y-%m-%d') AS admissionDate,
                  DATE_FORMAT(cm.TerminationDate, '%Y-%m-%d') AS terminationDate,
                  COALESCE(cm.TerminationReason, '') AS terminationReason,
                  m.PrimaryMobileNumber AS mobile, m.EmailId AS email
           FROM club_members cm
           JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
           WHERE cm.fk_club_id = @ClubId
             AND (cm.IsActive = 0 OR cm.isdeleted = 1)
             AND cm.TerminationDate IS NOT NULL
             AND cm.TerminationReason IS NOT NULL AND cm.TerminationReason <> ''
           ORDER BY cm.TerminationDate DESC, m.MemberName`,
          { ClubId: clubId },
        )
      ).map((r) =>
        ClubAdminDashboardService.networkRow(str(r.fullName) ?? "", str(r.memberType) ?? "Active", str(r.rotaryId), str(r.admissionDate), str(r.terminationDate),
          str(r.terminationReason) ?? "", int(r.id), "Terminated", str(r.mobile), str(r.email)),
      );
      let potential: ReturnType<typeof ClubAdminDashboardService.networkRow>[] = [];
      try {
        potential = (
          await conn.query(
            `SELECT pk_potential_member_id AS id, name AS fullName, email, mobile_number AS mobile, reference_details AS referenceDetails,
                    DATE_FORMAT(created_date, '%Y-%m-%d') AS admissionDate
             FROM potential_members
             WHERE fk_club_id = @ClubId AND COALESCE(isdeleted, 0) = 0
             ORDER BY pk_potential_member_id DESC`,
            { ClubId: clubId },
          )
        ).map((r) =>
          ClubAdminDashboardService.networkRow(str(r.fullName) ?? "", "Potential", null, str(r.admissionDate), null, "", int(r.id), "Potential",
            str(r.mobile), str(r.email), str(r.referenceDetails)),
        );
      } catch {
        potential = [];
      }
      const { start, end } = await ClubAdminDashboardService.yearRange(conn, yearId);
      const thisRy = start && end ? terminated.filter((t) => t.terminationDate && t.terminationDate >= start && t.terminationDate <= end).length : 0;
      const nowMember = int(
        await conn.executeScalar(
          `SELECT COUNT(*) FROM club_members
           WHERE fk_club_id = @ClubId AND IsActive = 1 AND isdeleted = 0
             AND fk_member_master_profile_id IN (
                 SELECT fk_member_master_profile_id FROM club_members WHERE fk_club_id = @ClubId AND (IsActive = 0 OR isdeleted = 1))`,
          { ClubId: clubId },
        ),
      );
      return {
        club: identity,
        totalTerminated: terminated.length,
        thisRotaryYear: thisRy,
        nowMember,
        lackOfParticipation: terminated.filter((t) => t.terminationReason && t.terminationReason.toLowerCase().includes("participat")).length,
        terminatedMembers: terminated,
        potentialMembers: potential,
      };
    });
  }

  // ---- service projects ----

  private async clubProjectYears(conn: DbCommands, clubId: number): Promise<YearOption[]> {
    const options: YearOption[] = [];
    for (const t of await this.yearTables.getAllExistingYearTables(conn)) {
      const exists = int(await conn.executeScalar(`SELECT EXISTS(SELECT 1 FROM \`${t.projectsTable}\` WHERE fk_club_id = @ClubId AND isdeleted = 0 LIMIT 1)`, { ClubId: clubId }));
      if (exists !== 1) continue;
      const y = await conn.queryFirstOrDefault("SELECT pk_year_id AS id, YearLabel AS label, COALESCE(IsCurrent,0) AS isCurrent FROM rotary_year_master WHERE pk_year_id = @Id", { Id: t.yearId });
      if (y) options.push({ id: int(y.id), yearLabel: str(y.label) ?? "", isCurrent: bool(y.isCurrent) });
    }
    return options.sort((a, b) => b.id - a.id);
  }

  private static selectedYear(years: YearOption[], requested: number): [number, string] {
    if (requested > 0) {
      const match = years.find((y) => y.id === requested);
      return match ? [match.id, match.yearLabel] : [requested, ""];
    }
    const current = years.find((y) => y.isCurrent) ?? years[0];
    return current ? [current.id, current.yearLabel] : [0, ""];
  }

  private static editUrl(clubId: number, avenueKey: string, projectId: number) {
    const slug: Record<string, string> = {
      club_service: "club-service", community_service: "community-service", vocational_service: "vocational-service",
      international_service: "international-service", new_generation_service: "new-generation-service",
      public_image_initiative: "public-image-initiative", pph_camp: "pph-camps",
    };
    return `/clubs/${clubId}/${slug[avenueKey] ?? "projects"}/${projectId}/edit`;
  }

  async getServiceProjectsOverview(memberId: number, yearId: number | null, clubId: number | null) {
    return this.context(memberId, yearId, clubId, async ({ conn, clubId, yearId, identity }) => {
      const years = await this.clubProjectYears(conn, clubId);
      const [selectedId, selectedLabel] = ClubAdminDashboardService.selectedYear(years, yearId);
      const byAvenue = new Map(AVENUE_ORDER.map(([key, name]) => [key, { avenueKey: key, avenueName: name, projects: 0, beneficiaries: 0, cost: 0, manHours: 0 }]));
      const kpis = { totalProjects: 0, totalBeneficiaries: 0, totalCost: 0, totalManHours: 0, meetingsHeld: 0 };
      const pendingItems: unknown[] = [];
      const targetCurrency = await ClubAdminDashboardService.clubCurrency(conn, clubId);
      const rates = await this.fx.getRates();
      for (const t of await this.targetTables(conn, selectedId)) {
        const rows = await conn.query(
          `SELECT mm.ModuleKey AS moduleKey, p.pk_project_id AS projectId, COALESCE(p.title, '') AS title,
                  COALESCE(p.project_cost, 0) AS cost, p.Currency AS currency,
                  COALESCE(p.direct_beneficiaries, 0) AS beneficiaries, COALESCE(p.man_hours, 0) AS manHours,
                  COALESCE(p.approval_status, '') AS approvalStatus
           FROM \`${t.projectsTable}\` p
           JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
           WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0`,
          { ClubId: clubId },
        );
        for (const r of rows) {
          const key = str(r.moduleKey) ?? "";
          const row = byAvenue.get(key);
          if (!row) continue;
          const cost = convertCurrency(num(r.cost), str(r.currency), targetCurrency, rates);
          const benef = int(r.beneficiaries);
          const hours = int(r.manHours);
          row.projects++;
          if (key === "club_service") kpis.meetingsHeld++;
          else {
            row.beneficiaries += benef;
            row.cost += cost;
            row.manHours += hours;
            kpis.totalProjects++;
            kpis.totalBeneficiaries += benef;
            kpis.totalCost += cost;
            kpis.totalManHours += hours;
          }
          const status = String(r.approvalStatus ?? "").trim().toLowerCase();
          if ((status === "pending" || status === "rejected" || status === "draft") && pendingItems.length < 8) {
            pendingItems.push({
              projectId: int(r.projectId), title: str(r.title) ?? "", avenueKey: key, avenueLabel: row.avenueName,
              fixUrl: ClubAdminDashboardService.editUrl(identity.clubId, key, int(r.projectId)), approvalStatus: status,
            });
          }
        }
      }
      const { start, end } = await ClubAdminDashboardService.yearRange(conn, selectedId);
      const camps = await conn.query(
        `SELECT c.pk_camp_id AS id, COUNT(a.pk_attendance_id) AS attendance
         FROM pph_camps c
         LEFT JOIN pph_camp_attendance a ON a.fk_camp_id = c.pk_camp_id AND COALESCE(a.isdeleted, 0) = 0
         WHERE c.fk_club_id = @ClubId AND COALESCE(c.isdeleted, 0) = 0
           ${start && end ? "AND c.CampDate BETWEEN @YearStart AND @YearEnd" : ""}
         GROUP BY c.pk_camp_id`,
        { ClubId: clubId, YearStart: start, YearEnd: end },
      );
      const pph = byAvenue.get("pph_camp")!;
      for (const c of camps) {
        pph.projects++;
        pph.beneficiaries += int(c.attendance);
        kpis.totalProjects++;
        kpis.totalBeneficiaries += int(c.attendance);
      }
      return {
        club: identity,
        selectedYearId: selectedId > 0 ? selectedId : null,
        selectedYearLabel: selectedLabel || identity.yearLabel,
        availableYears: years,
        kpis,
        targetCurrency,
        avenues: AVENUE_ORDER.map(([key]) => byAvenue.get(key)),
        pendingItems,
      };
    });
  }

  async getServiceProjectsAvenueDetail(memberId: number, avenueKeyIn: string, yearId: number | null, clubId: number | null) {
    return this.context(memberId, yearId, clubId, async ({ conn, clubId, yearId, identity }) => {
      const avenueKey = avenueKeyIn || "community_service";
      const meta = AVENUE_ORDER.find(([k]) => k === avenueKey) ?? ["unknown", "Unknown"];
      const years = await this.clubProjectYears(conn, clubId);
      const [selectedId, selectedLabel] = ClubAdminDashboardService.selectedYear(years, yearId);
      const response = {
        club: identity,
        avenueKey: meta[0],
        avenueName: meta[1],
        selectedYearId: selectedId > 0 ? selectedId : null,
        selectedYearLabel: selectedLabel || identity.yearLabel,
        availableYears: years,
        kpis: { projects: null, beneficiaries: null, amountSpent: null, manHours: null, meetingsHeld: null, avgAttendancePercent: null, avgAttendanceStayedPercent: null, membersOnRoll: null } as Record<string, number | null>,
        targetCurrency: Brand.Current.locale.defaultCurrency.toUpperCase(),
        meetings: [] as unknown[],
        oneTimeProjects: [] as unknown[],
        ongoingProjects: [] as unknown[],
        pendingApprovals: [] as unknown[],
      };
      if (avenueKey === "pph_camp") {
        await this.loadPphCamps(conn, clubId, selectedId, response);
        return response;
      }
      const tables = await this.targetTables(conn, selectedId);
      if (!tables.length) return response;
      if (avenueKey === "club_service") await this.loadClubServiceMeetings(conn, clubId, tables, response);
      else await this.loadAvenueProjects(conn, clubId, tables, avenueKey, meta[1], response);
      return response;
    });
  }

  private async loadClubServiceMeetings(conn: DbCommands, clubId: number, tables: YearTableInfo[], response: { meetings: unknown[]; kpis: Record<string, number | null> }) {
    const meetings: { id: number; sr: number; date: string; meetingType: string; title: string; attendance: number; membersOnRoll: number; attendanceBase: string; yearId: number; attendancePercent: number }[] = [];
    for (const t of tables) {
      const rows = await conn.query(
        `SELECT p.pk_project_id AS id, p.project_date AS projectDate, COALESCE(p.title, '') AS title,
                COALESCE(p.meeting_type, '') AS meetingType, COALESCE(p.attendance, 0) AS attendance,
                COALESCE(p.attendance_percentage, 0) AS attendancePct, COALESCE(p.fk_year_id, 0) AS yearId
         FROM \`${t.projectsTable}\` p
         JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
         WHERE p.fk_club_id = @ClubId AND mm.ModuleKey = 'club_service' AND p.isdeleted = 0
         ORDER BY p.project_date DESC`,
        { ClubId: clubId },
      );
      let i = 0;
      for (const r of rows) {
        meetings.push({
          id: int(r.id), sr: ++i, date: ymd(r.projectDate) ?? "", meetingType: str(r.meetingType) ?? "", title: str(r.title) ?? "",
          attendance: int(r.attendance), membersOnRoll: 0, attendanceBase: "Total Members", yearId: int(r.yearId), attendancePercent: num(r.attendancePct),
        });
      }
    }
    const membersOnRoll = int(
      await conn.executeScalar(
        `SELECT COUNT(*) FROM club_members cm
         INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
         WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0 AND m.isdeleted = 0`,
        { ClubId: clubId },
      ),
    );
    // BOD meetings are measured against the board of that year, other meetings against the roll.
    const bodYears = [...new Set(meetings.filter((m) => m.meetingType.toLowerCase() === "bod" && m.yearId > 0).map((m) => m.yearId))];
    const bodCounts = new Map<number, number>();
    if (bodYears.length) {
      for (const b of await conn.query(
        `SELECT bd.fk_year_id AS yearId, COUNT(*) AS cnt
         FROM board_of_directors bd
         LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
         WHERE bd.fk_club_id = @ClubId AND bd.fk_year_id IN @YearIds AND bd.isdeleted = 0
           AND (bd.fk_member_master_profile_id IS NULL OR m.pk_member_master_profile_id IS NOT NULL)
         GROUP BY bd.fk_year_id`,
        { ClubId: clubId, YearIds: bodYears },
      )) bodCounts.set(int(b.yearId), int(b.cnt));
    }
    let sumPct = 0;
    let withPct = 0;
    for (const m of meetings) {
      const isBod = m.meetingType.toLowerCase() === "bod";
      const bc = bodCounts.get(m.yearId) ?? 0;
      m.membersOnRoll = isBod && bc > 0 ? bc : membersOnRoll;
      m.attendanceBase = isBod && m.membersOnRoll !== membersOnRoll ? "BOD Members" : "Total Members";
      if (m.membersOnRoll > 0 && m.attendance > 0) m.attendancePercent = round((m.attendance / m.membersOnRoll) * 100, 2);
      if (m.attendancePercent > 0) {
        sumPct += m.attendancePercent;
        withPct++;
      }
    }
    response.meetings = meetings;
    const avg = withPct > 0 ? Math.round(sumPct / withPct) : 0;
    Object.assign(response.kpis, { meetingsHeld: meetings.length, avgAttendancePercent: avg, avgAttendanceStayedPercent: avg, membersOnRoll });
  }

  private async loadAvenueProjects(
    conn: DbCommands, clubId: number, tables: YearTableInfo[], avenueKey: string, avenueName: string,
    response: { oneTimeProjects: unknown[]; ongoingProjects: unknown[]; pendingApprovals: unknown[]; targetCurrency: string; kpis: Record<string, number | null> },
  ) {
    const oneTime: unknown[] = [];
    const ongoing: unknown[] = [];
    const pending: unknown[] = [];
    let totalProjects = 0, totalBenef = 0, totalHours = 0, totalSpent = 0;
    const targetCurrency = await ClubAdminDashboardService.clubCurrency(conn, clubId);
    const rates = await this.fx.getRates();
    const typeLabel: Record<string, string> = { one_time: "One-time", recurring: "Recurring", annual: "Annual", ongoing: "Ongoing", ongoing_repeat: "Ongoing" };
    for (const t of tables) {
      const rows = await conn.query(
        `SELECT p.pk_project_id AS id, p.project_date AS projectDate, COALESCE(p.title, '') AS title,
                COALESCE(p.project_type, 'one_time') AS projectType, COALESCE(p.project_cost, 0) AS cost, p.Currency AS currency,
                COALESCE(p.direct_beneficiaries, 0) AS beneficiaries, COALESCE(p.man_hours, 0) AS manHours,
                COALESCE(p.approval_status, '') AS approvalStatus, COALESCE(p.synced_to_org, 0) AS syncedToOrg,
                COALESCE(p.is_joint_project, 0) AS isJoint, p.co_host_name AS coHostName,
                p.parent_project_id AS parentId, p.ongoing_group_title AS ongoingTitle,
                cr.MemberName AS creatorName, cr.PrimaryMobileNumber AS creatorMobile, cr.EmailId AS creatorEmail
         FROM \`${t.projectsTable}\` p
         JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
         LEFT JOIN member_master_profile cr ON cr.pk_member_master_profile_id = p.created_by
         WHERE p.fk_club_id = @ClubId AND mm.ModuleKey = @AvenueKey AND p.isdeleted = 0
         ORDER BY COALESCE(p.parent_project_id, 0), p.project_date DESC, p.pk_project_id DESC`,
        { ClubId: clubId, AvenueKey: avenueKey },
      );
      let srOne = 0;
      let srOng = 0;
      for (const r of rows) {
        const projType = String(r.projectType ?? "one_time").trim().toLowerCase();
        const currency = normalizeCurrency(str(r.currency));
        const row = {
          id: int(r.id), sr: 0, date: ymd(r.projectDate) ?? "", title: str(r.title) ?? "", type: typeLabel[projType] ?? projType, cost: num(r.cost), currency,
          directBeneficiaries: int(r.beneficiaries), manHours: int(r.manHours), beneficiary: null, beneficiaries2: null, approvalStatus: str(r.approvalStatus) ?? "",
          campImageUrl: null, isActive: null, syncedToOrg: bool(r.syncedToOrg), isJointProject: bool(r.isJoint), coHostName: str(r.coHostName),
          parentProjectId: r.parentId === null ? null : int(r.parentId), ongoingGroupTitle: str(r.ongoingTitle),
        };
        const isOngoing = projType === "ongoing" || projType === "ongoing_repeat";
        const isChild = (row.parentProjectId ?? 0) > 0;
        if (isChild) {
          if (!isOngoing) continue;
          ongoing.push(row); // children keep Sr 0; the page nests them under their parent
        } else if (isOngoing) {
          row.sr = ++srOng;
          ongoing.push(row);
        } else {
          row.sr = ++srOne;
          oneTime.push(row);
        }
        totalProjects++;
        totalBenef += row.directBeneficiaries;
        totalSpent += convertCurrency(row.cost, currency, targetCurrency, rates);
        totalHours += row.manHours;
        const status = row.approvalStatus.trim().toLowerCase();
        if ((status === "pending" || status === "rejected" || status === "draft") && pending.length < 3) {
          pending.push({
            projectId: row.id, creatorName: str(r.creatorName) ?? "Member", projectTitle: row.title, avenueLabel: avenueName,
            mobile: str(r.creatorMobile), email: str(r.creatorEmail), approvalStatus: status,
          });
        }
      }
    }
    response.oneTimeProjects = oneTime;
    response.ongoingProjects = regroupOngoing(ongoing as OngoingRow[]);
    response.pendingApprovals = pending;
    response.targetCurrency = targetCurrency;
    Object.assign(response.kpis, { projects: totalProjects, beneficiaries: totalBenef, amountSpent: totalSpent, manHours: totalHours });
  }

  private async loadPphCamps(conn: DbCommands, clubId: number, yearId: number, response: { oneTimeProjects: unknown[]; kpis: Record<string, number | null> }) {
    const { start, end } = await ClubAdminDashboardService.yearRange(conn, yearId);
    const rows = await conn.query(
      `SELECT c.pk_camp_id AS id, c.CampDate AS campDate, COALESCE(c.Title, '') AS title,
              COUNT(a.pk_attendance_id) AS attendance, COALESCE(c.IsActive, 1) AS isActive,
              CASE
                  WHEN c.CampLogoPath IS NULL OR c.CampLogoPath = '' THEN NULL
                  WHEN c.CampLogoPath LIKE '/%' THEN c.CampLogoPath
                  ELSE CONCAT('/Documents/Campmaster/Group', c.fk_club_id, '/', c.CampLogoPath)
              END AS campImageUrl
       FROM pph_camps c
       LEFT JOIN pph_camp_attendance a ON a.fk_camp_id = c.pk_camp_id AND COALESCE(a.isdeleted, 0) = 0
       WHERE c.fk_club_id = @ClubId AND COALESCE(c.isdeleted, 0) = 0
         ${start && end ? "AND c.CampDate BETWEEN @YearStart AND @YearEnd" : ""}
       GROUP BY c.pk_camp_id, c.CampDate, c.Title, c.IsActive, c.CampLogoPath, c.fk_club_id
       ORDER BY c.CampDate DESC, c.pk_camp_id DESC`,
      { ClubId: clubId, YearStart: start, YearEnd: end },
    );
    let totalBenef = 0;
    const items = rows.map((r, i) => {
      totalBenef += int(r.attendance);
      return {
        id: int(r.id), sr: i + 1, date: ymd(r.campDate) ?? "", title: str(r.title) ?? "", type: "", cost: 0, currency: Brand.Current.locale.defaultCurrency.toUpperCase(),
        directBeneficiaries: int(r.attendance), manHours: 0, beneficiary: null, beneficiaries2: null, approvalStatus: "", campImageUrl: str(r.campImageUrl),
        isActive: int(r.isActive) === 1, syncedToOrg: false, isJointProject: false, coHostName: null, parentProjectId: null, ongoingGroupTitle: null,
      };
    });
    response.oneTimeProjects = items;
    Object.assign(response.kpis, { projects: items.length, beneficiaries: totalBenef, amountSpent: 0, manHours: 0 });
  }

  /** Years in which the club has any data, plus the current year. */
  async getAvailableYears(memberId: number, clubId: number | null) {
    return this.db.session(async (conn) => {
      const resolvedClub = await ClubAdminDashboardService.resolveClubId(conn, memberId, clubId);
      if (resolvedClub === 0) return null;
      const currentYearId = int(await conn.executeScalar("SELECT pk_year_id FROM rotary_year_master WHERE isdeleted = 0 AND IsCurrent = 1 LIMIT 1"));
      const currentYearLabel = currentYearId > 0 ? ((await conn.executeScalar<string>("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @Id LIMIT 1", { Id: currentYearId })) ?? "") : "";
      const ids = new Set<number>();
      if (currentYearId > 0) ids.add(currentYearId);
      const tryAdd = async (sql: string) => {
        try {
          for (const r of await conn.query(sql, { ClubId: resolvedClub })) {
            const id = int(Object.values(r)[0]);
            if (id > 0) ids.add(id);
          }
        } catch {
          // a missing table is ignored, as in the C#
        }
      };
      await tryAdd("SELECT DISTINCT fk_year_id FROM board_of_directors WHERE fk_club_id = @ClubId AND isdeleted = 0");
      await tryAdd("SELECT DISTINCT fk_year_id FROM club_attendance WHERE fk_club_id = @ClubId AND isdeleted = 0");
      await tryAdd("SELECT DISTINCT fk_year_id FROM trf_contributions WHERE fk_club_id = @ClubId AND isdeleted = 0");
      await tryAdd("SELECT DISTINCT fk_year_id FROM club_monthly_reports WHERE fk_club_id = @ClubId AND isdeleted = 0");
      await tryAdd(
        `SELECT DISTINCT y.pk_year_id FROM membership_dues md
         JOIN rotary_year_master y ON y.YearLabel = md.RotaryYear AND y.isdeleted = 0
         WHERE md.fk_club_id = @ClubId AND md.isdeleted = 0`,
      );
      try {
        for (const t of await this.yearTables.getAllExistingYearTables(conn)) {
          const exists = int(await conn.executeScalar(`SELECT EXISTS(SELECT 1 FROM \`${t.projectsTable}\` WHERE fk_club_id = @ClubId AND isdeleted = 0 LIMIT 1)`, { ClubId: resolvedClub }));
          if (exists === 1) ids.add(t.yearId);
        }
      } catch {
        // resolver unavailable: ignored, as in the C#
      }
      const years = ids.size
        ? (
            await conn.query(
              "SELECT pk_year_id AS Id, YearLabel AS Label, IsCurrent FROM rotary_year_master WHERE pk_year_id IN @Ids AND isdeleted = 0 ORDER BY StartDate DESC",
              { Ids: [...ids] },
            )
          ).map((y) => ({ id: int(y.Id), yearLabel: str(y.Label) ?? "", isCurrent: bool(y.IsCurrent) }))
        : [];
      return { clubId: resolvedClub, currentYearId: currentYearId > 0 ? currentYearId : null, currentYearLabel, years };
    });
  }
}
