import { SetMetadata, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { CurrentUser } from "./current-user";

export const AUTHORIZE_KEY = "row:authorize";
export const ALLOW_ANONYMOUS_KEY = "row:allowAnonymous";

/** [Authorize] on a controller or action: a valid token is required. */
export const Authorize = () => SetMetadata(AUTHORIZE_KEY, true);

/** [AllowAnonymous]: overrides [Authorize] wherever it appears, as in ASP.NET. */
export const AllowAnonymous = () => SetMetadata(ALLOW_ANONYMOUS_KEY, true);

/** The ControllerBase.User of the request. Set on every request, signed in or not. */
export const User = createParamDecorator((_: unknown, ctx: ExecutionContext): CurrentUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: CurrentUser }>();
  return req.user ?? new CurrentUser(null);
});
