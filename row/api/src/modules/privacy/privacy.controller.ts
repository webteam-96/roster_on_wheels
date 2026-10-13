import { Body, Controller, Get, Module, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { AllowAnonymous, Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { bodyField, paramInt, queryInt, queryString } from "../../common/binding";
import { clientIp } from "../../common/http";
import { badRequest, file, notFound, ok, statusCode, type ActionResult } from "../../common/results";
import { Db } from "../../database/db.service";
import { PrivacyError, PrivacyService } from "./privacy.service";
import { PrivacyRetentionService } from "./privacy-retention.service";

const NOT_ENABLED = { message: "Privacy features are not enabled on this instance." };

/**
 * Member privacy (master plan WS7): consent, export, erasure, the registry audit. ROW-only: every route
 * answers 404 unless the brand flag privacy.enabled is on. Shapes follow the admin's
 * src/services/api.ts and src/types/privacy.ts.
 */
@Controller("api/privacy")
@Authorize()
export class PrivacyController {
  constructor(private readonly svc: PrivacyService) {}

  private caller(u: CurrentUser) {
    return { id: u.memberId, superAdmin: u.hasRole("SuperAdmin") };
  }

  private async guarded(work: () => Promise<unknown>): Promise<ActionResult> {
    if (!this.svc.enabled) return notFound(NOT_ENABLED);
    try {
      return ok(await work());
    } catch (e) {
      if (e instanceof PrivacyError) {
        return e.status === 400 ? badRequest({ message: e.message }) : e.status === 404 ? notFound({ message: e.message }) : statusCode(403, { message: e.message });
      }
      throw e;
    }
  }

  @Get("consent")
  consent(@User() u: CurrentUser) {
    return this.guarded(() => this.svc.consentStatus(u.memberId));
  }

  @Post("consent")
  accept(@User() u: CurrentUser, @Body() body: unknown, @Req() req: Request) {
    const version = String(bodyField(body, "policyVersion") ?? "");
    const language = String(bodyField(body, "language") ?? "en");
    const channel = bodyField(body, "channel") === "app" ? "app" : "web";
    return this.guarded(async () => {
      await this.svc.acceptConsent(u.memberId, version, language, clientIp(req.ip), channel);
      return { accepted: true };
    });
  }

  @Post("consent/withdraw")
  withdraw(@User() u: CurrentUser) {
    return this.guarded(async () => {
      await this.svc.withdrawConsent(u.memberId);
      return { withdrawn: true };
    });
  }

  @Get("requests")
  requests(@User() u: CurrentUser, @Query("districtId") d?: string) {
    const districtId = queryInt(d, 0);
    if (districtId <= 0) return badRequest({ message: "districtId is required." });
    return this.guarded(() => this.svc.listRequests(this.caller(u), districtId));
  }

  @Post("members/:memberId/export")
  exportMember(@User() u: CurrentUser, @Param("memberId") m: string) {
    const memberId = paramInt(m, "memberId");
    return this.guarded(() => this.svc.requestExport(this.caller(u), memberId));
  }

  @Post("members/:memberId/erase")
  eraseMember(@User() u: CurrentUser, @Param("memberId") m: string, @Body() body: unknown) {
    const memberId = paramInt(m, "memberId");
    const reason = String(bodyField(body, "reason") ?? "");
    return this.guarded(() => this.svc.requestErasure(this.caller(u), memberId, reason));
  }

  @Post("requests/:requestId/approve")
  approve(@User() u: CurrentUser, @Param("requestId") r: string) {
    const requestId = paramInt(r, "requestId");
    return this.guarded(() => this.svc.approve(this.caller(u), requestId));
  }

  @Post("requests/:requestId/reject")
  reject(@User() u: CurrentUser, @Param("requestId") r: string) {
    const requestId = paramInt(r, "requestId");
    return this.guarded(() => this.svc.reject(this.caller(u), requestId));
  }

  /** WS7-01 audit: personal-looking columns on tables missing from the registry (SuperAdmin). */
  @Get("registry/unlisted")
  unlisted(@User() u: CurrentUser) {
    if (!u.hasRole("SuperAdmin")) return Promise.resolve(statusCode(403, { message: "SuperAdmin only." }));
    return this.guarded(() => this.svc.unlistedColumns());
  }

  /** The ZIP behind an export's signed link (opened from a plain link, so no bearer token). */
  @Get("exports/:guid")
  @AllowAnonymous()
  async download(@Param("guid") guid: string, @Query("expires") expires?: string, @Query("sig") sig?: string): Promise<ActionResult> {
    if (!this.svc.enabled) return notFound(NOT_ENABLED);
    try {
      const body = await this.svc.exportFile(guid, queryString(expires) ?? "", queryString(sig) ?? "");
      return file(body, "application/zip", `member-data-${guid.slice(0, 8)}.zip`);
    } catch (e) {
      if (e instanceof PrivacyError) return notFound({ message: e.message });
      throw e;
    }
  }
}

/** The signed-in member's interface language, so it follows them to other browsers and the app (WS2-03). */
@Controller("api/members")
@Authorize()
export class MemberLanguageController {
  constructor(private readonly db: Db) {}

  @Put("me/language")
  async setLanguage(@User() u: CurrentUser, @Body() body: unknown): Promise<ActionResult> {
    const language = String(bodyField(body, "language") ?? "").trim();
    if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(language)) return badRequest({ message: "language must be a language code such as \"en\" or \"pt-BR\"." });
    if (u.memberId <= 0) return statusCode(403, { message: "Not signed in as a member." });
    await this.db.execute(
      "UPDATE member_master_profile SET PrimaryLanguage = @Lang WHERE pk_member_master_profile_id = @Id",
      { Lang: language, Id: u.memberId },
    );
    return ok({ language });
  }
}

@Module({ controllers: [PrivacyController, MemberLanguageController], providers: [PrivacyService, PrivacyRetentionService], exports: [PrivacyService] })
export class PrivacyModule {}
