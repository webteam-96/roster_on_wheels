import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { DistrictAdminDashboardService } from "./district-admin-dashboard.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, forbid, notFound, ok, statusCode } from "../../common/results";
import { ArgumentException, UnauthorizedAccessException } from "../../common/exceptions";
import { bodyField, queryInt, queryString } from "../../common/binding";

const NOT_CONFIGURED = { message: "No district admin assignment found for this user." };
const memberIdOf = (u: CurrentUser) =>
  parseInt(u.findFirst("memberId") ?? u.findFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier") ?? "0", 10) || 0;
const n = (body: unknown, name: string) => Number(bodyField(body, name) ?? 0) || 0;

/** Role check, null -> 404 (when asked), access denied -> 403 with the message, ArgumentException -> 400. */
async function run(allowed: boolean, work: () => Promise<unknown>, nullIsNotFound = true) {
  if (!allowed) return forbid();
  try {
    const r = await work();
    return r === null && nullIsNotFound ? notFound(NOT_CONFIGURED) : ok(r);
  } catch (e) {
    if (e instanceof UnauthorizedAccessException) return statusCode(403, { message: e.message });
    if (e instanceof ArgumentException) return badRequest({ message: e.message });
    throw e;
  }
}

/** Port of DistrictAdminDashboardController.cs: api/district-admin-dashboard. Admin or SuperAdmin only. */
@Controller("api/district-admin-dashboard")
@Authorize()
export class DistrictAdminDashboardController {
  constructor(private readonly dashboard: DistrictAdminDashboardService) {}

  private allowed = (u: CurrentUser) => {
    const roles = u.findFirst("roles") ?? "";
    return roles.includes("Admin") || roles.includes("SuperAdmin");
  };

  @Get("overview")
  overview(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [yearId, districtId] = [queryInt(y), queryInt(d)];
    return run(this.allowed(u), () => this.dashboard.getOverview(memberIdOf(u), yearId, districtId));
  }

  @Get("membership")
  membership(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [yearId, districtId] = [queryInt(y), queryInt(d)];
    return run(this.allowed(u), () => this.dashboard.getMembership(memberIdOf(u), yearId, districtId));
  }

  @Get("foundation")
  foundation(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [yearId, districtId] = [queryInt(y), queryInt(d)];
    return run(this.allowed(u), () => this.dashboard.getFoundation(memberIdOf(u), yearId, districtId));
  }

  @Get("communication")
  communication(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [yearId, districtId] = [queryInt(y), queryInt(d)];
    return run(this.allowed(u), () => this.dashboard.getCommunication(memberIdOf(u), yearId, districtId));
  }

  @Get("egovernance")
  egovernance(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [yearId, districtId] = [queryInt(y), queryInt(d)];
    return run(this.allowed(u), () => this.dashboard.getEGovernance(memberIdOf(u), yearId, districtId));
  }

  @Get("egovernance/per-club")
  egovernancePerClub(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [yearId, districtId] = [queryInt(y), queryInt(d)];
    return run(this.allowed(u), () => this.dashboard.getEGovernancePerClubGrid(memberIdOf(u), yearId, districtId));
  }

  @Get("members")
  members(
    @User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string, @Query("page") page?: string,
    @Query("pageSize") pageSize?: string, @Query("search") search?: string,
  ) {
    const [yearId, districtId, p, ps] = [queryInt(y), queryInt(d), queryInt(page, 1), queryInt(pageSize, 20)];
    return run(this.allowed(u), () => this.dashboard.getMembershipDirectory(memberIdOf(u), yearId, p, ps, queryString(search), districtId));
  }

  @Get("rotary-network")
  rotaryNetwork(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string, @Query("search") search?: string, @Query("clubId") c?: string) {
    const [yearId, districtId, clubId] = [queryInt(y), queryInt(d), queryInt(c)];
    return run(this.allowed(u), () => this.dashboard.getRotaryNetwork(memberIdOf(u), yearId, queryString(search), clubId, districtId));
  }

  @Get("rotary-network/live-terminated")
  liveTerminated(@User() u: CurrentUser, @Query("districtId") d?: string, @Query("clubId") c?: string) {
    const [districtId, clubId] = [queryInt(d), queryInt(c)];
    return run(this.allowed(u), () => this.dashboard.getLiveTerminated(memberIdOf(u), districtId, clubId), false);
  }

  /** Starting a Rotary.org cache refresh needs the Rotary.org client (sync module); until then it reports a failed job. */
  @Post("rotary-network/refresh-terminated-cache/start")
  async startRefresh(@User() u: CurrentUser, @Query("districtId") d?: string) {
    const requested = queryInt(d);
    if (!this.allowed(u)) return forbid();
    const districtId = await this.dashboard.resolveDistrictIdForMember(memberIdOf(u), requested);
    if (districtId === 0) return notFound(NOT_CONFIGURED);
    const now = new Date().toISOString().slice(0, 19) + "Z";
    return ok({
      jobId: 0, districtId, status: "Failed", totalLinkedClubs: 0, clubsDone: 0, startedUtc: now, updatedUtc: now, finishedUtc: now,
      warning: "The Rotary.org integration is not available on this server yet.",
    });
  }

  @Get("rotary-network/refresh-terminated-cache/status")
  async refreshStatus(@User() u: CurrentUser, @Query("districtId") d?: string) {
    const requested = queryInt(d);
    if (!this.allowed(u)) return forbid();
    const districtId = await this.dashboard.resolveDistrictIdForMember(memberIdOf(u), requested);
    if (districtId === 0) return notFound(NOT_CONFIGURED);
    return ok(
      (await this.dashboard.getRefreshJobStatus(districtId)) ?? {
        jobId: 0, districtId, status: "NeverRun", totalLinkedClubs: 0, clubsDone: 0, startedUtc: "0001-01-01T00:00:00", updatedUtc: "0001-01-01T00:00:00",
        finishedUtc: null, warning: null,
      },
    );
  }

  @Get("membership-goal")
  getMembershipGoal(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [yearId, districtId] = [queryInt(y), queryInt(d)];
    return run(this.allowed(u), () => this.dashboard.getMembershipGoal(memberIdOf(u), yearId, districtId), false);
  }

  @Post("membership-goal")
  upsertMembershipGoal(@User() u: CurrentUser, @Body() body: unknown) {
    return run(
      this.allowed(u),
      () =>
        this.dashboard.upsertMembershipGoal(memberIdOf(u), {
          fkDistrictId: n(body, "fkDistrictId"), fkYearId: n(body, "fkYearId"), targetTotal: n(body, "targetTotal"),
          targetNewMembers: n(body, "targetNewMembers"), targetRetentionPercent: n(body, "targetRetentionPercent"),
        }),
      false,
    );
  }

  @Get("foundation-goal")
  getFoundationGoal(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [yearId, districtId] = [queryInt(y), queryInt(d)];
    return run(this.allowed(u), () => this.dashboard.getFoundationGoal(memberIdOf(u), yearId, districtId), false);
  }

  @Post("foundation-goal")
  upsertFoundationGoal(@User() u: CurrentUser, @Body() body: unknown) {
    return run(
      this.allowed(u),
      () =>
        this.dashboard.upsertFoundationGoal(memberIdOf(u), {
          fkDistrictId: n(body, "fkDistrictId"), fkYearId: n(body, "fkYearId"), targetAnnualFundUsd: n(body, "targetAnnualFundUsd"),
          targetPolioFundUsd: n(body, "targetPolioFundUsd"), targetEndowmentFundUsd: n(body, "targetEndowmentFundUsd"),
          targetOtherFundUsd: n(body, "targetOtherFundUsd"),
        }),
      false,
    );
  }

  @Get("project-targets")
  getProjectTargets(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    const [yearId, districtId] = [queryInt(y), queryInt(d)];
    return run(this.allowed(u), () => this.dashboard.getProjectTargets(memberIdOf(u), yearId, districtId), false);
  }

  @Post("project-targets")
  upsertProjectTargets(@User() u: CurrentUser, @Body() body: unknown) {
    const raw = bodyField(body, "targets");
    const targets = Array.isArray(raw) ? raw.map((t) => ({ fkModuleId: n(t, "fkModuleId"), targetCount: n(t, "targetCount") })) : [];
    return run(this.allowed(u), () => this.dashboard.upsertProjectTargets(memberIdOf(u), n(body, "districtId"), n(body, "yearId"), targets), false);
  }
}

/** Port of DistrictAdminClubGoalsController (same .cs file): per-club award status and MyRotary tracking. Admin, SuperAdmin or AG. */
@Controller("api")
@Authorize()
export class DistrictAdminClubGoalsController {
  constructor(private readonly dashboard: DistrictAdminDashboardService) {}

  private allowed = (u: CurrentUser) => {
    const roles = u.findFirst("roles") ?? "";
    return roles.includes("Admin") || roles.includes("SuperAdmin") || roles.includes("AG");
  };

  private static camelBody(body: unknown): Record<string, unknown> {
    return Object.fromEntries(Object.entries((body ?? {}) as Record<string, unknown>).map(([k, v]) => [k[0].toLowerCase() + k.slice(1), v]));
  }

  @Get("club-award-status")
  getAwardStatus(@User() u: CurrentUser, @Query("clubId") c?: string, @Query("yearId") y?: string) {
    const [clubId, yearId] = [queryInt(c, 0), queryInt(y)];
    return run(this.allowed(u), () => this.dashboard.getClubAwardStatus(clubId, yearId), false);
  }

  @Post("club-award-status")
  upsertAwardStatus(@User() u: CurrentUser, @Body() body: unknown) {
    return run(this.allowed(u), () => this.dashboard.upsertClubAwardStatus(memberIdOf(u), DistrictAdminClubGoalsController.camelBody(body)), false);
  }

  @Get("club-myrotary")
  getMyRotary(@User() u: CurrentUser, @Query("clubId") c?: string, @Query("yearId") y?: string) {
    const [clubId, yearId] = [queryInt(c, 0), queryInt(y)];
    return run(this.allowed(u), () => this.dashboard.getClubMyRotary(clubId, yearId), false);
  }

  @Post("club-myrotary")
  upsertMyRotary(@User() u: CurrentUser, @Body() body: unknown) {
    return run(this.allowed(u), () => this.dashboard.upsertClubMyRotary(memberIdOf(u), DistrictAdminClubGoalsController.camelBody(body)), false);
  }
}
