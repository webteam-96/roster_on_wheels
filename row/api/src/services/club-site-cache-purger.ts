import { Injectable, Logger } from "@nestjs/common";
import { Db } from "../database/db.service";
import { AppConfig } from "../config/app-config";

/**
 * Port of ClubSiteCachePurger.cs: after club data changes, asks the club's
 * public website (subdomain and own domain) to drop its cache via
 * POST /api/purge-cache with the shared x-purge-secret. Fire-and-forget;
 * skipped when ClubSite:PurgeSecret is not set.
 */
@Injectable()
export class ClubSiteCachePurger {
  private readonly log = new Logger("ClubSiteCachePurger");

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  private get secret() {
    return this.config.get("ClubSite:PurgeSecret");
  }

  private get useHttps() {
    return (this.config.get("ClubSite:UseHttps") ?? "").toLowerCase() !== "false";
  }

  purgeByClub(clubId: number): void {
    if (!this.secret || !this.secret.trim()) {
      this.log.warn(`ClubSite:PurgeSecret not configured — skipping purge for club ${clubId}`);
      return;
    }
    void (async () => {
      try {
        const row = await this.db.queryFirstOrDefault(
          `SELECT Subdomain AS subdomain, ClientDomain AS clientDomain
           FROM club_websites
           WHERE fk_club_id = @ClubId AND isdeleted = 0
           LIMIT 1`,
          { ClubId: clubId },
        );
        if (!row) {
          this.log.debug(`No club_websites row for club ${clubId} — nothing to purge`);
          return;
        }
        if (row.subdomain && String(row.subdomain).trim()) await this.purgeOneHost(String(row.subdomain));
        if (row.clientDomain && String(row.clientDomain).trim()) await this.purgeOneHost(String(row.clientDomain));
      } catch (e) {
        this.log.warn(`Purge-by-club failed for club ${clubId}: ${(e as Error).message}`);
      }
    })();
  }

  purgeHost(host: string): void {
    if (!this.secret || !this.secret.trim() || !host || !host.trim()) return;
    void this.purgeOneHost(host);
  }

  purgeAll(): void {
    this.log.log("PurgeAll requested — no implementation (per-host purge is the supported path).");
  }

  private async purgeOneHost(host: string): Promise<void> {
    try {
      const normalized = host.trim().toLowerCase();
      const url = `${this.useHttps ? "https" : "http"}://${normalized}/api/purge-cache?host=${encodeURIComponent(normalized)}`;
      const resp = await fetch(url, { method: "POST", headers: { "x-purge-secret": this.secret! }, signal: AbortSignal.timeout(5000) });
      this.log.debug(resp.ok ? `Purged cache for ${normalized}` : `Purge returned ${resp.status} for ${normalized}`);
    } catch (e) {
      this.log.debug(`Purge call to ${host} failed (non-blocking): ${(e as Error).message}`);
    }
  }
}
