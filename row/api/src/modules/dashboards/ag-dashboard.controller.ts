import { Controller, Get, Param, Query } from "@nestjs/common";
import { AgDashboardService } from "./ag-dashboard.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { forbid, notFound, ok, statusCode } from "../../common/results";
import { UnauthorizedAccessException } from "../../common/exceptions";
import { queryInt } from "../../common/binding";

/** Port of AgDashboardController.cs: api/ag-dashboard (AG or SuperAdmin). */
@Controller("api/ag-dashboard")
@Authorize()
export class AgDashboardController {
  constructor(protected readonly ag: AgDashboardService) {}

  protected memberId = (u: CurrentUser) =>
    parseInt(u.findFirst("memberId") ?? u.findFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier") ?? "0", 10) || 0;
  protected allowed = (u: CurrentUser) => {
    const roles = u.findFirst("roles") ?? "";
    return roles.includes("AG") || roles.includes("SuperAdmin");
  };

  protected async run(u: CurrentUser, work: () => Promise<unknown>) {
    if (!this.allowed(u)) return forbid();
    try {
      return ok(await work());
    } catch (e) {
      if (e instanceof UnauthorizedAccessException) return statusCode(403, { message: e.message });
      throw e;
    }
  }

  @Get("available-years")
  availableYears(@User() u: CurrentUser, @Query("districtId") d?: string) {
    const districtId = queryInt(d);
    return this.run(u, () => this.ag.getAvailableYears(this.memberId(u), districtId));
  }

  @Get("clubs")
  clubs(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string, @Query("districtId") d?: string) {
    const [yearId, clubId, districtId] = [queryInt(y), queryInt(c), queryInt(d)];
    return this.run(u, () => this.ag.getClubs(this.memberId(u), yearId, clubId, districtId));
  }

  /** {clubId:int}: a non-numeric id does not match the route. */
  @Get("clubs/:clubId")
  async clubDetail(@Param("clubId") c: string, @User() u: CurrentUser, @Query("yearId") y?: string) {
    if (!/^-?\d+$/.test(c)) return notFound();
    const yearId = queryInt(y);
    if (!this.allowed(u)) return forbid();
    const r = await this.ag.getClubDetail(this.memberId(u), Number(c), yearId);
    return r ? ok(r) : notFound({ message: "Club not in your AG group for this year." });
  }

  @Get("membership")
  membership(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string, @Query("districtId") d?: string) {
    const [yearId, clubId, districtId] = [queryInt(y), queryInt(c), queryInt(d)];
    return this.run(u, () => this.ag.getMembership(this.memberId(u), yearId, clubId, districtId));
  }

  @Get("trf")
  trf(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string, @Query("districtId") d?: string) {
    const [yearId, clubId, districtId] = [queryInt(y), queryInt(c), queryInt(d)];
    return this.run(u, () => this.ag.getTrf(this.memberId(u), yearId, clubId, districtId));
  }

  @Get("excellence")
  excellence(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string, @Query("districtId") d?: string) {
    const [yearId, clubId, districtId] = [queryInt(y), queryInt(c), queryInt(d)];
    return this.run(u, () => this.ag.getExcellence(this.memberId(u), yearId, clubId, districtId));
  }

  @Get("youth")
  youth(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string, @Query("districtId") d?: string) {
    const [yearId, clubId, districtId] = [queryInt(y), queryInt(c), queryInt(d)];
    return this.run(u, () => this.ag.getYouth(this.memberId(u), yearId, clubId, districtId));
  }

  @Get("projects/:projectId")
  async projectDetail(@Param("projectId") p: string, @User() u: CurrentUser, @Query("yearId") y?: string, @Query("districtId") d?: string) {
    if (!/^-?\d+$/.test(p)) return notFound();
    const [yearId, districtId] = [queryInt(y), queryInt(d)];
    if (!this.allowed(u)) return forbid();
    const r = await this.ag.getProjectDetail(this.memberId(u), Number(p), yearId, districtId);
    return r ? ok(r) : notFound({ message: "Project not found in your AG group for this year." });
  }

  @Get("projects")
  projects(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string, @Query("districtId") d?: string) {
    const [yearId, clubId, districtId] = [queryInt(y), queryInt(c), queryInt(d)];
    return this.run(u, () => this.ag.getProjects(this.memberId(u), yearId, clubId, districtId));
  }

  @Get("district")
  district(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string, @Query("districtId") d?: string) {
    const [yearId, clubId, districtId] = [queryInt(y), queryInt(c), queryInt(d)];
    return this.run(u, () => this.ag.getDistrict(this.memberId(u), yearId, clubId, districtId));
  }
}

/** Port of MobileAgDashboardController.cs: identical routes under api/mobile/ag-dashboard. */
@Controller("api/mobile/ag-dashboard")
@Authorize()
export class MobileAgDashboardController extends AgDashboardController {}
