import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { JwtService } from "./jwt.service";
import { CurrentUser } from "./current-user";
import { ALLOW_ANONYMOUS_KEY, AUTHORIZE_KEY } from "./decorators";
import { UnauthorizedResult } from "../common/results";

/**
 * Authentication runs on every request (a valid bearer token populates the user
 * even on anonymous endpoints, as UseAuthentication does); authorization applies
 * only where @Authorize() is set and @AllowAnonymous() is not. A refused request
 * gets 401 with an empty body and "WWW-Authenticate: Bearer", as JwtBearer sends.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: CurrentUser; bearerToken?: string }>();
    const header = req.headers.authorization;
    const token = header && /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, "").trim() : undefined;
    req.bearerToken = token;
    req.user = new CurrentUser(token ? this.jwt.verify(token) : null);

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_ANONYMOUS_KEY, targets)) return true;
    if (!this.reflector.getAllAndOverride<boolean>(AUTHORIZE_KEY, targets)) return true;
    if (req.user.isAuthenticated) return true;

    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader("WWW-Authenticate", token ? 'Bearer error="invalid_token"' : "Bearer");
    throw new UnauthorizedResult();
  }
}
