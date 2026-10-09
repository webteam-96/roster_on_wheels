import { Injectable, Logger } from "@nestjs/common";
import { Brand } from "../brand/brand";
import { Db } from "../database/db.service";
import { CitationAutoPointsService } from "./citation-auto-points.service";

/**
 * CitationRecalcTrigger.cs: after club activity changes (members, newsletters,
 * projects...), recalculates the club's citation points in the background.
 * The citation programme belongs to the Zones 4-8 award schemes, which ROW
 * keeps behind the "modules.citation" feature; with it off these calls do nothing.
 */
@Injectable()
export class CitationRecalcTrigger {
  private readonly log = new Logger("CitationRecalcTrigger");

  constructor(
    private readonly db: Db,
    private readonly autoPoints: CitationAutoPointsService,
  ) {}

  triggerForClub(clubId: number): void {
    if (clubId <= 0 || !Brand.feature("modules.citation")) return;
    void this.recalcClub(clubId);
  }

  triggerForDistrictAllClubs(districtId: number): void {
    if (districtId <= 0 || !Brand.feature("modules.citation")) return;
    void (async () => {
      try {
        const clubIds = (await this.db.query("SELECT pk_club_id AS id FROM club_master WHERE fk_district_id = @D AND isdeleted = 0", { D: districtId })).map((r) => Number(r.id));
        for (const clubId of clubIds) await this.recalcClub(clubId);
      } catch (e) {
        this.log.warn(`District-wide citation recalc failed for district ${districtId}: ${(e as Error).message}`);
      }
    })();
  }

  private async recalcClub(clubId: number) {
    try {
      const districtId = Number((await this.db.executeScalar("SELECT fk_district_id FROM club_master WHERE pk_club_id = @ClubId AND isdeleted = 0 LIMIT 1", { ClubId: clubId })) ?? 0);
      if (districtId <= 0) return;
      await this.autoPoints.calculateForClub(districtId, clubId);
    } catch (e) {
      this.log.warn(`Citation auto-points recalc failed for club ${clubId}: ${(e as Error).message}`);
    }
  }
}
