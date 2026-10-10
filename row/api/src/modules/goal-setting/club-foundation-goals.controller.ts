import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField, queryInt, routeInt } from "../../common/binding";
import { forbid, noContent, notFound, ok } from "../../common/results";
import { guarded } from "./goal-setting.controller";
import { FoundationGoalsService, type FoundationGoalSaveRequest } from "./foundation-goals.service";

const dec = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const bindSave = (b: unknown): FoundationGoalSaveRequest => {
  const s = (k: string) => { const v = bodyField(b, k); return v === null || v === undefined ? null : String(v); };
  return {
    yearId: Math.trunc(dec(bodyField(b, "yearId"))), apfGoal: dec(bodyField(b, "apfGoal")), polioPlusGoal: dec(bodyField(b, "polioPlusGoal")),
    endowmentFundGoal: dec(bodyField(b, "endowmentFundGoal")), otherGoal: dec(bodyField(b, "otherGoal")), currency: s("currency") ?? "USD", remarks: s("remarks"),
  };
};

/** Port of ClubFoundationGoalsController.cs: api/club-foundation-goals. */
@Controller("api/club-foundation-goals")
@Authorize()
export class ClubFoundationGoalsController {
  constructor(private readonly svc: FoundationGoalsService) {}

  private memberId = (u: CurrentUser) => { const v = u.findFirst("memberId") ?? u.findFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier") ?? ""; return /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0; };
  private isAuthorisedRole = (u: CurrentUser) => { const r = u.findFirst("roles") ?? ""; return r.includes("Admin") || r.includes("SuperAdmin"); };

  @Get("list")
  list(@User() u: CurrentUser, @Query("yearId") y?: string, @Query("clubId") c?: string) {
    const [yearId, clubId] = [queryInt(y), queryInt(c)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => {
      const r = await this.svc.getList(this.memberId(u), yearId, clubId);
      return r ? ok(r) : notFound({ message: "No club admin assignment found." });
    });
  }

  @Post()
  save(@User() u: CurrentUser, @Body() body: unknown, @Query("clubId") c?: string) {
    const [req, clubId] = [bindSave(body), queryInt(c)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => {
      const r = await this.svc.save(this.memberId(u), req, clubId);
      return r ? ok(r) : notFound({ message: "No club admin assignment found." });
    });
  }

  @Delete(":yearId")
  remove(@User() u: CurrentUser, @Param("yearId") y: string, @Query("clubId") c?: string) {
    const [yearId, clubId] = [routeInt(y), queryInt(c)];
    if (!this.isAuthorisedRole(u)) return forbid();
    return guarded(async () => ((await this.svc.delete(this.memberId(u), yearId, clubId)) ? noContent() : notFound({ message: "No goal to delete." })));
  }
}

/** Port of MobileClubFoundationGoalsController.cs: the same endpoints under api/mobile/club-foundation-goals. */
@Controller("api/mobile/club-foundation-goals")
@Authorize()
export class MobileClubFoundationGoalsController extends ClubFoundationGoalsController {
  // Nest injects only through a constructor declared on the class itself.
  constructor(svc: FoundationGoalsService) {
    super(svc);
  }
}
