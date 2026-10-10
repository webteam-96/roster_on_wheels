import { clientIp } from "../../common/http";
import { Body, Controller, Get, Headers, Ip, Post, Query } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, forbid, ok, unauthorized } from "../../common/results";
import { ArgumentException, InvalidOperationException, UnauthorizedAccessException } from "../../common/exceptions";
import { queryDate, queryInt } from "../../common/binding";
import { ChangePasswordRequestDto, ForgotPasswordRequestDto, LoginRequestDto, ResetPasswordRequestDto } from "../../dtos/auth.dtos";

/** Port of AuthController.cs: route api/Auth. */
@Controller("api/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  async login(@Body() body: unknown, @Ip() ip: string, @Headers("user-agent") userAgent?: string) {
    const r = LoginRequestDto.create(body as Record<string, unknown>) as { email: string | null; countryCode: string | null; mobileNumber: string | null; password: string };
    try {
      return ok(await this.auth.login(r, clientIp(ip), userAgent ?? ""));
    } catch (e) {
      if (e instanceof UnauthorizedAccessException) return unauthorized({ message: e.message });
      if (e instanceof ArgumentException) return badRequest({ message: e.message });
      throw e;
    }
  }

  @Post("forgot-password")
  async forgotPassword(@Body() body: unknown) {
    const r = ForgotPasswordRequestDto.create(body as Record<string, unknown>) as { email: string | null; countryCode: string | null; mobileNumber: string | null };
    try {
      return ok(await this.auth.forgotPassword(r));
    } catch (e) {
      if (e instanceof ArgumentException) return badRequest({ message: e.message });
      throw e;
    }
  }

  @Post("reset-password")
  async resetPassword(@Body() body: unknown) {
    const r = ResetPasswordRequestDto.create(body as Record<string, unknown>) as { token: string; newPassword: string; confirmPassword: string };
    try {
      return ok(await this.auth.resetPassword(r));
    } catch (e) {
      if (e instanceof ArgumentException) return badRequest({ message: e.message });
      throw e;
    }
  }

  @Authorize()
  @Post("change-password")
  async changePassword(@Body() body: unknown, @User() user: CurrentUser) {
    const r = ChangePasswordRequestDto.create(body as Record<string, unknown>) as { currentPassword: string; newPassword: string; confirmPassword: string };
    try {
      const memberId = parseInt(user.findFirst("memberId") ?? "0", 10);
      if (memberId === 0) return unauthorized({ message: "Invalid token." });
      return ok(await this.auth.changePassword(memberId, r));
    } catch (e) {
      if (e instanceof UnauthorizedAccessException) return unauthorized({ message: e.message });
      if (e instanceof ArgumentException || e instanceof InvalidOperationException) return badRequest({ message: e.message });
      throw e;
    }
  }

  @Authorize()
  @Post("logout")
  logout() {
    // Tokens are stateless; the client discards its token.
    return ok({ message: "Logged out successfully." });
  }

  @Authorize()
  @Get("login-logs")
  async loginLogs(
    @User() user: CurrentUser,
    @Query("search") search?: string,
    @Query("status") status?: string,
    @Query("fromDate") fromDate?: string,
    @Query("toDate") toDate?: string,
    @Query("page") pageText?: string,
    @Query("pageSize") pageSizeText?: string,
  ) {
    // Substring test on the comma-joined claim, as the C# does.
    if (!(user.findFirst("roles") ?? "").includes("SuperAdmin")) return forbid();
    const page = queryInt(pageText, 1);
    const pageSize = queryInt(pageSizeText, 20);
    const { items, totalCount } = await this.auth.getLoginLogs(search ?? "", status ?? "", queryDate(fromDate), queryDate(toDate), page, pageSize);
    return ok({ items, totalCount, page, pageSize });
  }
}
