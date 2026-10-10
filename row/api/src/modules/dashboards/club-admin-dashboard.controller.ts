import { Controller, Get, Query } from "@nestjs/common";
import { ClubAdminDashboardService } from "./club-admin-dashboard.service";
import { Db } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { forbid, notFound, ok, statusCode } from "../../common/results";
import { UnauthorizedAccessException } from "../../common/exceptions";
import { queryInt, queryString, requireQuery } from "../../common/binding";
import { RotaryOrgApiClient } from "../../services/rotary-org/rotary-org-api.client";
import { upsertTerminatedCache } from "../../services/rotary-org/rotary-org-sync.services";
import { HttpRequestException } from "../../common/exceptions";

const NOT_CONFIGURED = { message: "No club admin assignment found for this user." };

/** The routes the web and mobile club-admin dashboards share (Admin or SuperAdmin only). */
abstract class ClubAdminDashboardRoutes {
  protected abstract readonly notConfigured: { message: string };
  constructor(
    protected readonly dashboard: ClubAdminDashboardService,
    protected readonly db: Db,
  ) {}

  protected memberId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? u.findFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier") ?? "0", 10) || 0;
  protected allowed = (u: CurrentUser) => {
    const roles = u.findFirst("roles") ?? "";
    return roles.includes("Admin") || roles.includes("SuperAdmin");
  };

  /** Shared wrapper: role check, null -> 404, access denied -> 403 with the message. */
  private async run(user: CurrentUser, work: () => Promise<unknown>) {
    if (!this.allowed(user)) return forbid();
    try {
      const r = await work();
      return r === null ? notFound(this.notConfigured) : ok(r);
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
    requireQuery({ avenueKey });
    const [y, c] = [queryInt(yearId), queryInt(clubId)];
    return this.run(u, () => this.dashboard.getServiceProjectsAvenueDetail(this.memberId(u), queryString(avenueKey, "")!, y, c));
  }
}

/** Port of ClubAdminDashboardController.cs: api/club-admin-dashboard. */
@Controller("api/club-admin-dashboard")
@Authorize()
export class ClubAdminDashboardController extends ClubAdminDashboardRoutes {
  protected readonly notConfigured = NOT_CONFIGURED;

  constructor(dashboard: ClubAdminDashboardService, db: Db, private readonly rotaryOrg: RotaryOrgApiClient) {
    super(dashboard, db);
  }

  /** Live terminated members from Rotary.org (display only), written through to the cache; contacts from our own profiles by Rotary ID. */
  @Get("rotary-org-terminated-members")
  async rotaryOrgTerminated(@User() u: CurrentUser, @Query("clubId") clubIdText?: string) {
    if (!this.allowed(u)) return forbid();
    try {
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
      const meta = await this.db.queryFirstOrDefault("SELECT ClubRotaryId AS clubRotaryId, ClubType AS clubType, ClubName AS clubName FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0 LIMIT 1", { Id: clubId });
      const rotaryId = String(meta?.clubRotaryId ?? "").trim();
      if (!/^-?\d+$/.test(rotaryId)) {
        return ok({ clubId, members: [], warning: "Club is not linked to Rotary.org (missing ClubRotaryId)." });
      }
      const rotaryOrgClubId = parseInt(rotaryId, 10);
      const clubType = meta?.clubType && String(meta.clubType).trim() ? String(meta.clubType) : "Rotary Club";
      const list = await this.rotaryOrg.getClubTerminatedMembers(clubType, rotaryOrgClubId);
      // Write-through cache for the district Rotary Network view; a cache failure never fails the live answer.
      await this.db.session((conn) => upsertTerminatedCache(conn, rotaryOrgClubId, list)).catch(() => undefined);
      const ids = [...new Set(list.map((m) => String(m.memberId)))];
      const contacts = new Map(ids.length
        ? (await this.db.query("SELECT RotaryId AS rotaryId, PrimaryMobileNumber AS mobile, EmailId AS email FROM member_master_profile WHERE isdeleted = 0 AND RotaryId IN @RotaryIds", { RotaryIds: ids }))
            .map((r) => [String(r.rotaryId), r])
        : []);
      const members = list.map((m) => {
        const c = contacts.get(String(m.memberId));
        return {
          id: m.memberId % 2147483647, memberId: String(m.memberId), memberType: m.memberType ?? "", firstName: m.firstName ?? "", middleName: m.middleName ?? "",
          lastName: m.lastName ?? "", admissionDate: m.admissionDate, terminationDate: m.terminationDate, terminationReason: m.terminationReason ?? "",
          mobile: c?.mobile ?? null, email: c?.email ?? null,
        };
      });
      return ok({ clubId, clubName: meta?.clubName ?? "", rotaryOrgClubId, clubType, members, totalCount: members.length });
    } catch (e) {
      if (e instanceof UnauthorizedAccessException) return statusCode(403, { message: e.message });
      if (e instanceof HttpRequestException) return statusCode(502, { message: "Rotary.org API call failed.", detail: e.message });
      throw e;
    }
  }
}

/** Port of MobileClubAdminDashboardController.cs: the same routes without the Rotary.org terminated list. */
@Controller("api/mobile/club-admin-dashboard")
@Authorize()
export class MobileClubAdminDashboardController extends ClubAdminDashboardRoutes {
  protected readonly notConfigured = { message: "No club admin assignment found." };
  // An explicit constructor: the abstract base has no decorator, so Nest has no parameter metadata to inherit.
  constructor(dashboard: ClubAdminDashboardService, db: Db) {
    super(dashboard, db);
  }
}
