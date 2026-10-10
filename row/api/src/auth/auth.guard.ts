import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { INTERCEPTORS_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { JwtService } from "./jwt.service";
import { CurrentUser } from "./current-user";
import { ALLOW_ANONYMOUS_KEY, AUTHORIZE_KEY, READS_REQUEST_FORM_KEY } from "./decorators";
import { BODY_PARAMS } from "./body-params";
import { ActionResultError, EmptyResult, ProblemResult, UnauthorizedResult, ValidationProblemResult } from "../common/results";

// Nest's multer interceptors are anonymous mixins; their class source is the only marker.
const isMulter = (i: unknown) => typeof i === "function" && i.toString().includes("this.multer");
const interceptors = (context: ExecutionContext) => Reflect.getMetadata(INTERCEPTORS_METADATA, context.getHandler()) as unknown[] | undefined;

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
    // ASP.NET puts [Consumes("multipart/form-data")] on actions with IFormFile parameters; it is a route constraint, so it runs before auth.
    const contentType = req.headers["content-type"];
    if (contentType && !/^multipart\/form-data\b/i.test(contentType) && !this.reflector.get<boolean>(READS_REQUEST_FORM_KEY, context.getHandler()) &&
        interceptors(context)?.some(isMulter))
      throw new ActionResultError(new EmptyResult(415));
    const header = req.headers.authorization;
    const token = header && /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, "").trim() : undefined;
    req.bearerToken = token;
    req.user = new CurrentUser(token ? this.jwt.verify(token) : null);

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_ANONYMOUS_KEY, targets) ||
        !this.reflector.getAllAndOverride<boolean>(AUTHORIZE_KEY, targets) || req.user.isAuthenticated) {
      // [FromBody] model binding runs after authorization, and only the JSON input formatter is registered.
      const param = BODY_PARAMS[`${req.method} ${String(req.route?.path ?? "").replace(/:\w+/g, ":").toLowerCase()}`];
      const empty = !Number(req.headers["content-length"] ?? 0) && !req.headers["transfer-encoding"];
      if (param !== undefined && !(param === null && empty)) {
        if (!(contentType && /^(application\/(json|[^;]*\+json)|text\/json)\b/i.test(contentType))) throw new ActionResultError(new ProblemResult(415));
        if (empty) throw new ActionResultError(new ValidationProblemResult({ "": ["A non-empty request body is required."], [param!]: [`The ${param} field is required.`] }));
      }
      return true;
    }

    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader("WWW-Authenticate", token ? 'Bearer error="invalid_token"' : "Bearer");
    throw new UnauthorizedResult();
  }
}
