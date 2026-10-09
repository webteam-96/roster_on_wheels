import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { Db, type DbCommands, type Row } from "../database/db.service";
import { AppConfig } from "../config/app-config";
import { Brand } from "../brand/brand";
import { dbDateTime } from "../common/binding";
import { formatDate } from "../common/dotnet-format";
import { YearTableResolver } from "./year-table.resolver";
import { EmailService } from "./email.service";

const MODULE_KEYS: Record<string, string> = {
  "Club Service": "club_service", "Community Service": "community_service", "Vocational Service": "vocational_service",
  "International Service": "international_service", "New Generation Service": "new_generation_service", "Public Image Initiative": "public_image_initiative",
};
const SERVICE_MODULES: [string, string][] = [
  ["community service", "community_service"], ["vocational service", "vocational_service"], ["international service", "international_service"],
  ["new generation service", "new_generation_service"], ["public image initiative", "public_image_initiative"],
];
const MEETING_TYPES: Record<string, string> = { regular: "regular", fellowship: "fellowship", bod: "bod", assembly: "assembly", trust: "trust" };

interface YearWindow {
  yearId: number;
  start: string;
  end: string;
  projectsTable: string;
}

/** DistrictAwardsConfigHelper.IsEnabledAsync: a missing config row means disabled. */
export async function isDistrictAwardsEnabled(conn: DbCommands, districtId: number, yearId: number): Promise<boolean> {
  const flag = await conn.executeScalar("SELECT is_enabled FROM district_awards_config WHERE fk_district_id = @D AND fk_year_id = @Y LIMIT 1", { D: districtId, Y: yearId });
  return Number(flag) === 1;
}

/** CalculatePoints: per-unit points, with the optional bonus (min count to earn it, max count that scores). */
export function citationPoints(count: number, perUnit: number, isBonus: boolean, bonusPoints: number, minBonus: number, maxBonus: number): [number, number] {
  if (count === 0) return [0, 0];
  if (!isBonus) return [count * perUnit, 0];
  if (minBonus === 0 && maxBonus === 0) return [count * perUnit, bonusPoints];
  const capped = maxBonus > 0 && count > maxBonus ? maxBonus : count;
  return [capped * perUnit, count >= minBonus && minBonus > 0 ? bonusPoints : 0];
}

/**
 * Port of CitationAutoPointsBackgroundService.cs: counts each club's activity
 * for the district citation's auto questions (members added, newsletters,
 * meetings, projects per avenue...) and stores the points earned. Runs for one
 * club on demand, and for every district nightly when
 * CitationAutoPoints:DailyLoopEnabled is true.
 */
@Injectable()
export class CitationAutoPointsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger("CitationAutoPointsBackgroundService");
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly yearTables: YearTableResolver,
    private readonly email: EmailService,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.getBool("CitationAutoPoints:DailyLoopEnabled")) {
      this.log.log("Citation auto-points 24h loop is PAUSED (CitationAutoPoints:DailyLoopEnabled=false).");
      return;
    }
    const run = () =>
      this.calculateAll()
        .then(() => this.log.log("Citation auto points calculation completed."))
        .catch((e) => this.log.error(`Error calculating citation auto points: ${(e as Error).message}`));
    this.timers.push(setTimeout(() => {
      void run();
      this.timers.push(setInterval(() => void run(), 24 * 60 * 60 * 1000));
    }, 30_000));
  }

  onApplicationShutdown() {
    for (const t of this.timers) clearTimeout(t);
  }

  private async currentYear(conn: DbCommands): Promise<(YearWindow & { yearLabel: string }) | null> {
    const y = await conn.queryFirstOrDefault("SELECT pk_year_id AS id, StartDate, EndDate, YearLabel FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
    if (!y) return null;
    const info = await this.yearTables.resolveByYearId(conn, Number(y.id));
    if (!info) return null;
    return { yearId: Number(y.id), start: dbDateTime(y.StartDate)!, end: dbDateTime(y.EndDate)!, projectsTable: info.projectsTable, yearLabel: String(y.YearLabel ?? "") };
  }

  private static async moduleIds(conn: DbCommands) {
    const map = new Map<string, number>();
    for (const key of Object.values(MODULE_KEYS)) {
      const id = await conn.executeScalar("SELECT pk_module_id FROM module_master WHERE ModuleKey = @Key AND isdeleted = 0", { Key: key });
      if (id !== null && id !== undefined) map.set(key, Number(id));
    }
    return map;
  }

  private static async questionsFor(conn: DbCommands, districtId: number, yearId: number) {
    const questions = await conn.query(
      `SELECT q.pk_id AS id, q.fk_activity_id AS activityId, a.activity_name AS activityName, a.sub_type AS subType,
              q.points, q.is_bonus AS isBonus, q.bonus_points AS bonusPoints, q.min_bonus AS minBonus, q.max_bonus AS maxBonus
       FROM district_citation_auto_question q
       INNER JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
       WHERE q.fk_district_id = @DistrictId AND q.fk_year_id = @YearId AND q.isdeleted = 0`,
      { DistrictId: districtId, YearId: yearId },
    );
    const ids = questions.map((q) => Number(q.id));
    const subs = ids.length
      ? await conn.query(
          `SELECT pk_id AS id, fk_auto_question_id AS questionId, sub_item_type AS subItemType, sub_item_id AS subItemId, sub_item_name AS subItemName,
                  points, is_bonus AS isBonus, bonus_points AS bonusPoints, min_bonus AS minBonus, max_bonus AS maxBonus
           FROM district_citation_auto_question_sub WHERE fk_auto_question_id IN @Ids AND isdeleted = 0`,
          { Ids: ids },
        )
      : [];
    return { questions, subs };
  }

  /** Scores every auto question (and its sub-items) for one club; returns the number of entries written. */
  private async scoreClub(conn: DbCommands, districtId: number, clubId: number, y: YearWindow, questions: Row[], subs: Row[], moduleIds: Map<string, number>) {
    let entries = 0;
    for (const q of questions) {
      const qSubs = subs.filter((s) => Number(s.questionId) === Number(q.id));
      if (!qSubs.length || Number(q.points) > 0) {
        const count = await this.autoCount(conn, String(q.activityName), clubId, y, moduleIds, null);
        const [earned, bonus] = citationPoints(count, Number(q.points), Number(q.isBonus) === 1 || q.isBonus === true, Number(q.bonusPoints), Number(q.minBonus), Number(q.maxBonus));
        await CitationAutoPointsService.saveEntry(conn, districtId, y.yearId, clubId, Number(q.id), null, String(count), earned, bonus);
        entries++;
      }
      for (const sub of qSubs) {
        const count = await this.autoCount(conn, String(q.activityName), clubId, y, moduleIds, sub);
        const [earned, bonus] = citationPoints(count, Number(sub.points), Number(sub.isBonus) === 1 || sub.isBonus === true, Number(sub.bonusPoints), Number(sub.minBonus), Number(sub.maxBonus));
        await CitationAutoPointsService.saveEntry(conn, districtId, y.yearId, clubId, Number(q.id), Number(sub.id), String(count), earned, bonus);
        entries++;
      }
    }
    return entries;
  }

  async calculateAll() {
    const runStart = new Date();
    let clubCount = 0;
    let entryCount = 0;
    const result = await this.db.session(async (conn) => {
      const y = await this.currentYear(conn);
      if (!y) {
        this.log.warn("Skipping auto-points run: no current year or no year-wise projects table.");
        return null;
      }
      const districtIds = (await conn.query("SELECT DISTINCT fk_district_id AS id FROM district_citation_auto_question WHERE fk_year_id = @YearId AND isdeleted = 0", { YearId: y.yearId })).map((r) => Number(r.id));
      const moduleIds = await CitationAutoPointsService.moduleIds(conn);
      for (const districtId of districtIds) {
        const clubs = (await conn.query("SELECT pk_club_id AS id FROM club_master WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND IsActive = 1", { DistrictId: districtId })).map((r) => Number(r.id));
        const { questions, subs } = await CitationAutoPointsService.questionsFor(conn, districtId, y.yearId);
        for (const clubId of clubs) {
          clubCount++;
          entryCount += await this.scoreClub(conn, districtId, clubId, y, questions, subs, moduleIds);
        }
      }
      return { districtCount: districtIds.length, yearLabel: y.yearLabel };
    });
    if (result) await this.sendCompletionEmail(runStart, new Date(), result.districtCount, clubCount, entryCount, result.yearLabel);
  }

  private async sendCompletionEmail(start: Date, end: Date, districts: number, clubs: number, entries: number, yearLabel: string) {
    const recipients = this.config.getArray("RotaryOrgSync:ReportRecipients");
    if (!recipients.length) return;
    const ms = end.getTime() - start.getTime();
    const stamp = (d: Date, f: string) => formatDate(d.toISOString().slice(0, 19), f);
    const row = (label: string, value: string | number, first = false) =>
      `<tr><td style='padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc${first ? ";width:200px" : ""}'>${label}</td>
        <td style='padding:8px 12px;border:1px solid #e2e8f0'>${value}</td></tr>`;
    const body = `
<div style='font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.6'>
  <h2 style='color:#1e3a8a;margin:0 0 12px 0'>Auto Calculate District Awards Points</h2>
  <p style='margin:0 0 16px 0;color:#475569'>The nightly background job has completed successfully.</p>
  <table style='border-collapse:collapse;width:100%;max-width:520px;border:1px solid #e2e8f0'>
    ${row("Run started", stamp(start, "dd-MMM-yyyy hh:mm:ss tt"), true)}
    ${row("Run completed", stamp(end, "dd-MMM-yyyy hh:mm:ss tt"))}
    ${row("Duration", `${Math.floor(ms / 60000)} min ${Math.floor(ms / 1000) % 60} sec`)}
    ${row("Rotary year", yearLabel)}
    ${row("Districts processed", districts)}
    ${row("Clubs processed", clubs)}
    ${row("Entries written", entries)}
  </table>
  <p style='margin:20px 0 0 0;color:#64748b;font-size:12px'>This is an automated notification from ${Brand.Current.productName}.</p>
</div>`;
    const subject = `${Brand.Current.shortName} - Auto Calculate District awards Points - ${stamp(end, "dd-MMM-yyyy hh:mm tt")}`;
    for (const to of recipients) {
      await this.email.sendGenericEmail(to, subject, body).catch((e) => this.log.warn(`Failed to send citation auto-points email to ${to}: ${(e as Error).message}`));
    }
  }

  /** CalculateForClubAsync: recompute one club's auto points for the current year. */
  async calculateForClub(districtId: number, clubId: number) {
    await this.db.session(async (conn) => {
      const y = await this.currentYear(conn);
      if (!y) return;
      const { questions, subs } = await CitationAutoPointsService.questionsFor(conn, districtId, y.yearId);
      await this.scoreClub(conn, districtId, clubId, y, questions, subs, await CitationAutoPointsService.moduleIds(conn));
    });
  }

  /** GetAutoCount: what the activity counts, by its name. */
  private async autoCount(conn: DbCommands, activityName: string, clubId: number, y: YearWindow, moduleIds: Map<string, number>, sub: Row | null): Promise<number> {
    const act = activityName.toLowerCase();
    const count = async (sql: string, p: Record<string, unknown>) => Number((await conn.executeScalar(sql, p)) ?? 0);
    const range = { ClubId: clubId, Start: y.start, End: y.end };
    const members = (extra: string) =>
      count(
        `SELECT COUNT(*) FROM member_master_profile m
         INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
         WHERE cm.fk_club_id = @ClubId AND m.isdeleted = 0 ${extra} AND cm.JoinedDate >= @Start AND cm.JoinedDate <= @End`,
        range,
      );
    if (act.includes("club website") || act.includes("club dues")) return 0; // future
    if (act.includes("member addition") && act.includes("lady")) return members("AND m.Gender = 'Female'");
    if (act.includes("member addition") && act.includes("youth")) return members("AND m.IsYouth = 1");
    if (act.includes("member addition")) return members("");
    const byYear = { ClubId: clubId, YearId: y.yearId };
    if (act.includes("newsletter")) return count("SELECT COUNT(*) FROM newsletters WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0", byYear);
    if (act.includes("club monthly report")) {
      return count("SELECT COUNT(*) FROM club_monthly_reports WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0 AND IsUploadedToDistrict = 1", byYear);
    }
    if (act.includes("attendance")) return count("SELECT COUNT(*) FROM club_attendance WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0", byYear);
    if (act.includes("pph camp")) return count("SELECT COUNT(*) FROM pph_camps WHERE fk_club_id = @ClubId AND isdeleted = 0 AND CampDate >= @Start AND CampDate <= @End", range);
    const projects = (modId: number, extra = "", p: Record<string, unknown> = {}) =>
      count(`SELECT COUNT(*) FROM \`${y.projectsTable}\` WHERE fk_club_id = @ClubId AND fk_module_id = @ModId AND fk_year_id = @YearId ${extra} AND isdeleted = 0`, { ...byYear, ModId: modId, ...p });
    if (act.includes("club service")) {
      const modId = moduleIds.get("club_service") ?? 0;
      if (modId === 0) return 0;
      if (sub && sub.subItemType === "meeting_type") {
        const name = String(sub.subItemName ?? "");
        return projects(modId, "AND meeting_type = @Mt", { Mt: MEETING_TYPES[name.toLowerCase()] ?? name.toLowerCase() });
      }
      return projects(modId);
    }
    for (const [label, key] of SERVICE_MODULES) {
      if (!act.includes(label)) continue;
      const modId = moduleIds.get(key) ?? 0;
      if (modId === 0) return 0;
      if (sub) {
        const type = String(sub.subItemType ?? "");
        const id = sub.subItemId === null || sub.subItemId === undefined ? null : Number(sub.subItemId);
        const community = act.includes("community");
        if (type === "area_of_focus" && id !== null) return projects(modId, "AND fk_area_of_focus_id = @Id", { Id: id });
        // Outside Community Service the sub-item ids sit one level up (as in RIZones).
        if (type === "category" && id !== null) return projects(modId, community ? "AND fk_category_id = @Id" : "AND fk_area_of_focus_id = @Id", { Id: id });
        if (type === "sub_category" && id !== null) return projects(modId, community ? "AND fk_sub_category_id = @Id" : "AND fk_category_id = @Id", { Id: id });
      }
      return projects(modId);
    }
    return 0;
  }

  private static async saveEntry(conn: DbCommands, districtId: number, yearId: number, clubId: number, questionId: number, subId: number | null, count: string, points: number, bonus: number) {
    const existing = await conn.executeScalar(
      `SELECT pk_id FROM district_citation_club_entry
       WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND fk_club_id=@ClubId AND entry_type='auto' AND fk_question_id=@QId
         AND (fk_sub_question_id=@SubQId OR (@SubQId IS NULL AND fk_sub_question_id IS NULL)) AND isdeleted=0`,
      { DistrictId: districtId, YearId: yearId, ClubId: clubId, QId: questionId, SubQId: subId },
    );
    if (existing !== null && existing !== undefined) {
      await conn.execute("UPDATE district_citation_club_entry SET answer_value=@Count, points_earned=@Points, bonus_earned=@Bonus, modified_date=NOW() WHERE pk_id=@Id", {
        Id: existing, Count: count, Points: points, Bonus: bonus,
      });
    } else {
      await conn.execute(
        `INSERT INTO district_citation_club_entry (fk_district_id, fk_year_id, fk_club_id, entry_type, fk_question_id, fk_sub_question_id, answer_value, points_earned, bonus_earned, created_date)
         VALUES (@DistrictId, @YearId, @ClubId, 'auto', @QId, @SubQId, @Count, @Points, @Bonus, NOW())`,
        { DistrictId: districtId, YearId: yearId, ClubId: clubId, QId: questionId, SubQId: subId, Count: count, Points: points, Bonus: bonus },
      );
    }
  }
}
