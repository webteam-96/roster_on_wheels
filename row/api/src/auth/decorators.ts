import { SetMetadata, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { CurrentUser } from "./current-user";

export const AUTHORIZE_KEY = "row:authorize";
export const ALLOW_ANONYMOUS_KEY = "row:allowAnonymous";
export const READS_REQUEST_FORM_KEY = "row:readsRequestForm";

/** [Authorize] on a controller or action: a valid token is required. */
export const Authorize = () => SetMetadata(AUTHORIZE_KEY, true);

/** [AllowAnonymous]: overrides [Authorize] wherever it appears, as in ASP.NET. */
export const AllowAnonymous = () => SetMetadata(ALLOW_ANONYMOUS_KEY, true);

/** An upload the .NET action read from Request.Form (no IFormFile parameter), so ASP.NET adds no multipart Consumes constraint. */
export const ReadsRequestForm = () => SetMetadata(READS_REQUEST_FORM_KEY, true);

/** The ControllerBase.User of the request. Set on every request, signed in or not. */
export const User = createParamDecorator((_: unknown, ctx: ExecutionContext): CurrentUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: CurrentUser }>();
  return req.user ?? new CurrentUser(null);
});
