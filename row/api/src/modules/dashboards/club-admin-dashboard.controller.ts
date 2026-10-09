import { Controller, Get, Query } from "@nestjs/common";
import { ClubAdminDashboardService } from "./club-admin-dashboard.service";
import { Db } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { forbid, notFound, ok, statusCode } from "../../common/results";
import { UnauthorizedAccessException } from "../../common/exceptions";
import { queryInt, queryString } from "../../common/binding";

const NOT_CONFIGURED = { message: "No club admin assignment found for this user." };

/** Port of ClubAdminDashboardController.cs: api/club-admin-dashboard. Admin or SuperAdmin only. */
@Controller("api/club-admin-dashboard")
@Authorize()
export class ClubAdminDashboardController {
  constructor(
    private readonly dashboard: ClubAdminDashboardService,
    private readonly db: Db,
  ) {}

  private memberId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? u.findFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier") ?? "0", 10) || 0;
  private allowed = (u: CurrentUser) => {
    const roles = u.findFirst("roles") ?? "";
    return roles.includes("Admin") || roles.includes("SuperAdmin");
  };

  /** Shared wrapper: role check, null -> 404, access denied -> 403 with the message. */
  private async run(user: CurrentUser, work: () => Promise<unknown>) {
    if (!this.allowed(user)) return forbid();
    try {
      const r = await work();
      return r === null ? notFound(NOT_CONFIGURED) : ok(r);
    } catch (e) {
      if (e instanceof UnauthorizedAccessException) return statusCode(403, { message: e.message });
      throw e;
    }
  }

  @Get("available-years")
  availableYears(@User() u: CurrentUser, @Query("clubId") clubId?: string) {
    const c = queryInt(clubId);
    return this.run(u, () => this.dashboard.getAvailableYears(this.memberId(u), c));
  }

  @Get("overview")
  overview(@User() u: CurrentUser, @Query("yearId") yearId?: string, @Query("clubId") clubId?: string) {
    const [y, c] = [queryInt(yearId), queryInt(clubId)];
    return this.run(u, () => this.dashboard.getOverview(this.memberId(u), y, c));
  }

  @Get("foundation")
  foundation(@User() u: CurrentUser, @Query("yearId") yearId?: string, @Query("clubId") clubId?: string) {
    const [y, c] = [queryInt(yearId), queryInt(clubId)];
    return this.run(u, () => this.dashboard.getFoundation(this.memberId(u), y, c));
  }

  @Get("membership")
  membership(@User() u: CurrentUser, @Query("yearId") yearId?: string, @Query("clubId") clubId?: string) {
    const [y, c] = [queryInt(yearId), queryInt(clubId)];
    return this.run(u, () => this.dashboard.getMembership(this.memberId(u), y, c));
  }

  @Get("avenue")
  avenue(@User() u: CurrentUser, @Query("yearId") yearId?: string, @Query("clubId") clubId?: string) {
    const [y, c] = [queryInt(yearId), queryInt(clubId)];
    return this.run(u, () => this.dashboard.getAvenue(this.memberId(u), y, c));
  }

  @Get("egovernance")
  egovernance(@User() u: CurrentUser, @Query("yearId") yearId?: string, @Query("clubId") clubId?: string) {
    const [y, c] = [queryInt(yearId), queryInt(clubId)];
    return this.run(u, () => this.dashboard.getEGovernance(this.memberId(u), y, c));
  }

  @Get("communication")
  communication(@User() u: CurrentUser, @Query("yearId") yearId?: string, @Query("clubId") clubId?: string) {
    const [y, c] = [queryInt(yearId), queryInt(clubId)];
    return this.run(u, () => this.dashboard.getCommunication(this.memberId(u), y, c));
  }

  @Get("website")
  website(@User() u: CurrentUser, @Query("yearId") yearId?: string, @Query("clubId") clubId?: string) {
    const [y, c] = [queryInt(yearId), queryInt(clubId)];
    return this.run(u, () => this.dashboard.getWebsite(this.memberId(u), y, c));
  }

  @Get("payments")
  payments(@User() u: CurrentUser, @Query("yearId") yearId?: string, @Query("clubId") clubId?: string) {
    const [y, c] = [queryInt(yearId), queryInt(clubId)];
    return this.run(u, () => this.dashboard.getPayments(this.memberId(u), y, c));
  }

  @Get("dashboard-directory")
  directory(@User() u: CurrentUser, @Query("yearId") yearId?: string, @Query("clubId") clubId?: string) {
    const [y, c] = [queryInt(yearId), queryInt(clubId)];
    return this.run(u, () => this.dashboard.getDashboardDirectory(this.memberId(u), y, c));
  }

  @Get("dashboard-bod")
  bod(@User() u: CurrentUser, @Query("yearId") yearId?: string, @Query("clubId") clubId?: string) {
    const [y, c] = [queryInt(yearId), queryInt(clubId)];
    return this.run(u, () => this.dashboard.getDashboardBod(this.memberId(u), y, c));
  }

  @Get("dashboard-marketplace")
  marketplace(@User() u: CurrentUser, @Query("yearId") yearId?: string, @Query("clubId") clubId?: string) {
    const [y, c] = [queryInt(yearId), queryInt(clubId)];
    return this.run(u, () => this.dashboard.getDashboardMarketplace(this.memberId(u), y, c));
  }

  @Get("dashboard-rotary-network")
  rotaryNetwork(@User() u: CurrentUser, @Query("yearId") yearId?: string, @Query("clubId") clubId?: string) {
    const [y, c] = [queryInt(yearId), queryInt(clubId)];
    return this.run(u, () => this.dashboard.getDashboardRotaryNetwork(this.memberId(u), y, c));
  }

  @Get("service-projects-overview")
  serviceProjectsOverview(@User() u: CurrentUser, @Query("yearId") yearId?: string, @Query("clubId") clubId?: string) {
    const [y, c] = [queryInt(yearId), queryInt(clubId)];
    return this.run(u, () => this.dashboard.getServiceProjectsOverview(this.memberId(u), y, c));
  }

  @Get("service-projects-avenue")
  serviceProjectsAvenue(@User() u: CurrentUser, @Query("avenueKey") avenueKey?: string, @Query("yearId") yearId?: string, @Query("clubId") clubId?: string) {
    const [y, c] = [queryInt(yearId), queryInt(clubId)];
    return this.run(u, () => this.dashboard.getServiceProjectsAvenueDetail(this.memberId(u), queryString(avenueKey, "")!, y, c));
  }

  /**
   * Live terminated-member list from Rotary.org. It needs the Rotary.org API
   * client, which is ported with the Rotary.org sync module; until then the
   * call answers as the C# does when Rotary.org cannot be reached.
   */
  @Get("rotary-org-terminated-members")
  async rotaryOrgTerminated(@User() u: CurrentUser, @Query("clubId") clubIdText?: string) {
    if (!this.allowed(u)) return forbid();
    let clubId = queryInt(clubIdText, 0);
    if (clubId === 0) {
      clubId = Number(
        (await this.db.executeScalar(
          `SELECT fk_club_id FROM member_roles
           WHERE fk_member_master_profile_id = @MemberId AND fk_role_id IN (2, 5)
             AND IsActive = 1 AND isdeleted = 0 ORDER BY pk_member_role_id ASC LIMIT 1`,
          { MemberId: this.memberId(u) },
        )) ?? 0,
      );
    }
    if (clubId === 0) return notFound(NOT_CONFIGURED);
    const meta = await this.db.queryFirstOrDefault("SELECT ClubRotaryId AS clubRotaryId FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0 LIMIT 1", { Id: clubId });
    const rotaryId = String(meta?.clubRotaryId ?? "").trim();
    if (!/^-?\d+$/.test(rotaryId)) {
      return ok({ clubId, members: [], warning: "Club is not linked to Rotary.org (missing ClubRotaryId)." });
    }
    return statusCode(502, { message: "Rotary.org API call failed.", detail: "The Rotary.org integration is not available on this server yet." });
  }
}
