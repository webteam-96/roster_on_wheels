import { Body, Controller, Get, Logger, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { MobileAuthService, type RequestOtp, type VerifyOtp } from "./mobile-auth.service";
import { Db } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, notFound, ok, statusCode, unauthorized } from "../../common/results";
import { ArgumentException, InvalidOperationException, KeyNotFoundException, UnauthorizedAccessException } from "../../common/exceptions";
import { MobileRequestOtpDto, MobileVerifyOtpDto } from "../../dtos/mobile-auth.dtos";
import { NON_SYNC_DENIED_MESSAGE, isMobileLoginAllowed } from "../../services/non-sync-login-guard.helper";

/** Port of MobileAuthController.cs (routes on the actions). */
@Controller()
export class MobileAuthController {
  private readonly log = new Logger("MobileAuthController");

  constructor(
    private readonly mobileAuth: MobileAuthService,
    private readonly db: Db,
  ) {}

  @Post("api/mobile/auth/request-otp")
  async requestOtp(@Body() body: Record<string, unknown>) {
    try {
      return ok(await this.mobileAuth.requestOtp(MobileRequestOtpDto.create(body ?? {}) as unknown as RequestOtp));
    } catch (e) {
      if (e instanceof ArgumentException || e instanceof InvalidOperationException) return badRequest({ message: e.message });
      if (e instanceof KeyNotFoundException) return notFound({ message: e.message });
      if (e instanceof UnauthorizedAccessException) return statusCode(403, { message: e.message });
      this.log.error(`Mobile request-otp failed: ${(e as Error).message}`);
      return statusCode(500, { message: "Failed to request OTP." });
    }
  }

  @Post("api/mobile/auth/verify-otp")
  async verifyOtp(@Body() body: Record<string, unknown>) {
    try {
      return ok(await this.mobileAuth.verifyOtp(MobileVerifyOtpDto.create(body ?? {}) as unknown as VerifyOtp));
    } catch (e) {
      if (e instanceof ArgumentException || e instanceof InvalidOperationException) return badRequest({ message: e.message });
      if (e instanceof UnauthorizedAccessException) return statusCode(403, { message: e.message });
      this.log.error(`Mobile verify-otp failed: ${(e as Error).message}`);
      return statusCode(500, { message: "Failed to verify OTP." });
    }
  }

  @Post("api/mobile/auth/logout")
  @Authorize()
  async logout(@Body() body: Record<string, unknown>, @User() user: CurrentUser) {
    const memberId = user.intClaim("memberId") ?? 0;
    if (memberId === 0) return unauthorized();
    try {
      const imei = Object.entries(body ?? {}).find(([k]) => k.toLowerCase() === "imei")?.[1];
      await this.mobileAuth.logout(memberId, typeof imei === "string" ? imei : null);
      return ok({ message: "Logged out" });
    } catch (e) {
      this.log.error(`Mobile logout failed: ${(e as Error).message}`);
      return statusCode(500, { message: "Logout failed." });
    }
  }

  @Get("api/auth/my-context")
  @Authorize()
  async getMyContext(@User() user: CurrentUser, @Res({ passthrough: true }) res: Response) {
    const memberId = user.intClaim("memberId") ?? 0;
    if (memberId === 0) return unauthorized();
    if (user.findFirst("loginType") === "mobile") {
      try {
        if (!(await isMobileLoginAllowed(this.db, memberId))) {
          this.log.log(`[MOBILE ACCESS] member=${memberId} has no live club membership - forcing re-login.`);
          res.setHeader("X-Force-Relogin", "1");
          return unauthorized({ message: NON_SYNC_DENIED_MESSAGE });
        }
      } catch (e) {
        this.log.warn(`Mobile access check failed for member=${memberId}; allowing through. ${(e as Error).message}`);
      }
    }
    const familyMemberId = user.intClaim("familyMemberId");
    try {
      return ok(await this.mobileAuth.getMyContext(memberId, familyMemberId));
    } catch (e) {
      if (e instanceof KeyNotFoundException) return notFound({ message: e.message });
      this.log.error(`Get my-context failed: ${(e as Error).message}`);
      return statusCode(500, { message: "Failed to load context." });
    }
  }
}
