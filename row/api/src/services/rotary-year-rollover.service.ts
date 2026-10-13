import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { Db } from "../database/db.service";
import { AppConfig } from "../config/app-config";
import { Brand } from "../brand/brand";
import { nowIn } from "../common/dotnet-format";
import { ensureYearTablesExist } from "./year-table.resolver";

/** The Rotary year (July to June) a wall-clock date ("yyyy-MM-dd...") falls in. */
export function rotaryYearOf(date: string) {
  const [y, m] = date.slice(0, 7).split("-").map(Number);
  const start = m >= 7 ? y : y - 1;
  return { label: `${start}-${String((start + 1) % 100).padStart(2, "0")}`, startDate: `${start}-07-01`, endDate: `${start + 1}-06-30` };
}

/**
 * Port of RotaryYearRolloverBackgroundService.cs: every 6 hours, makes sure the
 * calendar's Rotary year exists in rotary_year_master and is the one flagged
 * IsCurrent, so the flip on 1 July happens without a restart. The first pass
 * also stands in for DatabaseInitializer.UpdateRotaryYearCurrentFlagAsync, which
 * ran on every start-up. "Today" is the brand's time zone (RIZones used the
 * server's IST clock).
 */
@Injectable()
export class RotaryYearRolloverService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger("RotaryYearRolloverBackgroundService");
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap() {
    const run = () => this.reconcile().catch((e) => this.log.error(`Rotary year rollover reconcile failed: ${(e as Error).message}`));
    void run();
    if (this.config.backgroundJobsEnabled) this.timer = setInterval(() => void run(), 6 * 60 * 60 * 1000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async reconcile() {
    const { label, startDate, endDate } = rotaryYearOf(nowIn(Brand.Current.locale.defaultTimeZone));
    await this.db.session(async (conn) => {
      await conn.execute(
        `INSERT IGNORE INTO rotary_year_master (YearLabel, StartDate, EndDate, IsCurrent)
         VALUES (@Label, @Start, @End, 1)`,
        { Label: label, Start: startDate, End: endDate },
      );
      // ROW: projects live in one table per Rotary year, otherwise created on the year's first save.
      // Create the current year's tables here so a new database can list projects before anyone adds one.
      await ensureYearTablesExist(conn, label);
      const alreadyCurrent = await conn.executeScalar<string>("SELECT YearLabel FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
      if (alreadyCurrent === label) return;
      await conn.execute("UPDATE rotary_year_master SET IsCurrent = 0 WHERE IsCurrent = 1");
      await conn.execute("UPDATE rotary_year_master SET IsCurrent = 1 WHERE YearLabel = @Label", { Label: label });
      this.log.log(`Rotary year IsCurrent flipped from '${alreadyCurrent ?? "(none)"}' to '${label}'`);
    });
  }
}
