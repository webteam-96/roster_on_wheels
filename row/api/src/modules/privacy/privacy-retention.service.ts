import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { AppConfig } from "../../config/app-config";
import { PrivacyService } from "./privacy.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 10 * 60 * 1000;

/**
 * Log retention (master plan WS7-07): once a day, deletes or blanks rows older than
 * Brand:Privacy:RetentionDays (email bodies, WhatsApp and push logs, sign-in audit, one-time codes,
 * export files). Runs only with BackgroundJobs:Enabled and the privacy.enabled flag.
 */
@Injectable()
export class PrivacyRetentionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger("PrivacyRetentionBackgroundService");
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly privacy: PrivacyService,
    private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.backgroundJobsEnabled) return;
    const run = () => {
      if (!this.privacy.enabled) return;
      this.privacy
        .applyRetention()
        .then((done) => this.log.log(done.length ? `retention applied: ${done.join("; ")}` : "retention: nothing to remove"))
        .catch((e) => this.log.error(`retention failed: ${(e as Error).message}`));
    };
    this.timers.push(setTimeout(run, FIRST_RUN_DELAY_MS));
    this.timers.push(setInterval(run, DAY_MS));
  }

  onApplicationShutdown() {
    for (const t of this.timers) clearTimeout(t);
  }
}
