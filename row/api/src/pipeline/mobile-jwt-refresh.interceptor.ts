import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import type { Request, Response } from "express";
import { type Observable, from, switchMap, tap } from "rxjs";
import { Db } from "../database/db.service";
import { JwtService } from "../auth/jwt.service";
import type { CurrentUser } from "../auth/current-user";
import { ActionResultError, ContentResult } from "../common/results";

const MOBILE_JWT_DAYS = 90; // token lifetime
const REFRESH_IF_OLDER_THAN_DAYS = 1; // top up once the token is older than this

/**
 * Port of MobileJwtRefreshMiddleware.cs, for mobile tokens (loginType=mobile):
 *  - before: 401 + "X-Force-Relogin: 1" when member_master_profile.mobile_force_relogin_at
 *    is later than the token's "iat". RIZones tokens carry no "iat", so this
 *    check never fires there either; reproduced as-is.
 *  - after: when the token is more than a day old, a fresh 90-day token with the
 *    same claims in "X-Refreshed-Token" (+ "X-Refreshed-Token-Expires-At").
 */
@Injectable()
export class MobileJwtRefreshInterceptor implements NestInterceptor {
  constructor(
    private readonly db: Db,
    private readonly jwt: JwtService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: CurrentUser; bearerToken?: string }>();
    const res = context.switchToHttp().getResponse<Response>();
    const user = req.user;
    const token = req.bearerToken;
    if (!user?.isAuthenticated || user.findFirst("loginType") !== "mobile" || !token) return next.handle();

    return from(this.shouldForceRelogin(user, token)).pipe(
      switchMap((force) => {
        if (force) {
          res.setHeader("X-Force-Relogin", "1");
          throw new ActionResultError(new ContentResult("Mobile session invalidated. Please log in again.", "text/plain", 401));
        }
        return next.handle();
      }),
      tap(() => this.refresh(token, res)),
    );
  }

  private refresh(token: string, res: Response): void {
    try {
      const claims = this.jwt.read(token);
      if (!claims?.exp) return;
      const remainingDays = (Number(claims.exp) * 1000 - Date.now()) / 86_400_000;
      if (remainingDays >= MOBILE_JWT_DAYS - REFRESH_IF_OLDER_THAN_DAYS) return;
      const kept = Object.fromEntries(Object.entries(claims).filter(([k]) => !["exp", "nbf", "iat", "iss", "aud"].includes(k)));
      const expires = new Date(Math.floor((Date.now() + MOBILE_JWT_DAYS * 86_400_000) / 1000) * 1000);
      res.setHeader("X-Refreshed-Token", this.jwt.sign(kept, expires));
      // ValidTo.ToString("o") of a UTC DateTime: "2026-12-31T10:00:00.0000000Z"
      res.setHeader("X-Refreshed-Token-Expires-At", expires.toISOString().replace(/\.\d{3}Z$/, ".0000000Z"));
    } catch {
      // never break the response
    }
  }

  private async shouldForceRelogin(user: CurrentUser, token: string): Promise<boolean> {
    try {
      const memberId = user.intClaim("memberId");
      if (!memberId || memberId <= 0) return false;
      const iat = Number(this.jwt.read(token)?.iat);
      if (!Number.isFinite(iat)) return false;
      const forceAt = await this.db.executeScalar<string>(
        "SELECT mobile_force_relogin_at FROM member_master_profile WHERE pk_member_master_profile_id = @Id",
        { Id: memberId },
      );
      if (!forceAt) return false;
      return new Date(forceAt).getTime() > iat * 1000;
    } catch {
      return false;
    }
  }
}
