import type { Readable } from "node:stream";

/**
 * Port of ASP.NET's IActionResult helpers, so a ported action reads like the C#:
 *
 *   if (club == null) return NotFound(new { message = "Club not found" });   // C#
 *   if (!club) return notFound({ message: "Club not found" });               // TS
 *
 * A handler may also return a plain value, which is Ok(value).
 *
 * [ApiController] rules reproduced: a bare NotFound(), BadRequest(),
 * Unauthorized(), Conflict() ... answers with an RFC 9110 ProblemDetails body;
 * Ok(null) answers 204; Forbid() answers 403 with no body.
 */
export abstract class ActionResult {
  abstract readonly status: number;
}

export class ObjectResult extends ActionResult {
  constructor(
    readonly status: number,
    readonly value: unknown,
  ) {
    super();
  }
}

/** Status with an [ApiController] ProblemDetails body (no explicit value given). */
export class ProblemResult extends ActionResult {
  constructor(readonly status: number) {
    super();
  }
}

/** [ApiController] model-validation failure: 400 with an "errors" map. */
export class ValidationProblemResult extends ActionResult {
  readonly status = 400;
  constructor(readonly errors: Record<string, string[]>) {
    super();
  }
}

/** CreatedAtAction / CreatedAtRoute: 201 with a Location header. */
export class CreatedResult extends ActionResult {
  readonly status = 201;
  constructor(
    readonly location: string,
    readonly value: unknown,
  ) {
    super();
  }
}

export class EmptyResult extends ActionResult {
  constructor(readonly status: number) {
    super();
  }
}

export class FileResult extends ActionResult {
  readonly status = 200;
  constructor(
    readonly body: Buffer | Readable | string,
    readonly contentType: string,
    readonly fileName?: string,
    /** Inline (no download name) unless a file name is given, as File(bytes, type) does. */
  ) {
    super();
  }
}

export class RedirectResult extends ActionResult {
  constructor(
    readonly url: string,
    readonly permanent = false,
  ) {
    super();
  }
  get status() {
    return this.permanent ? 301 : 302;
  }
}

export class ContentResult extends ActionResult {
  constructor(
    readonly content: string,
    readonly contentType = "text/plain; charset=utf-8",
    readonly status = 200,
  ) {
    super();
  }
}

/** Thrown (e.g. by the auth guard) to end a request with an ActionResult. */
export class ActionResultError extends Error {
  constructor(readonly result: ActionResult) {
    super(`ActionResult ${result.status}`);
  }
}

/** 401 from authentication (JwtBearer challenge): empty body. */
export class UnauthorizedResult extends ActionResultError {
  constructor() {
    super(new EmptyResult(401));
  }
}

const withValue = (status: number, args: unknown[]) => (args.length ? new ObjectResult(status, args[0]) : new ProblemResult(status));

export const ok = (...value: unknown[]): ActionResult => (value.length ? new ObjectResult(200, value[0]) : new EmptyResult(200));
export const created = (value?: unknown): ActionResult => new ObjectResult(201, value);
/** CreatedAtAction(nameof(Get), new { id }, value): Location is the "get" route of the new resource. */
export const createdAt = (location: string, value: unknown): ActionResult => new CreatedResult(location, value);
export const accepted = (value?: unknown): ActionResult => new ObjectResult(202, value);
export const noContent = (): ActionResult => new EmptyResult(204);
export const badRequest = (...value: unknown[]): ActionResult => withValue(400, value);
export const unauthorized = (...value: unknown[]): ActionResult => withValue(401, value);
export const notFound = (...value: unknown[]): ActionResult => withValue(404, value);
export const conflict = (...value: unknown[]): ActionResult => withValue(409, value);
export const unprocessableEntity = (...value: unknown[]): ActionResult => withValue(422, value);
/** Forbid(): the auth handler's 403, no body. */
export const forbid = (): ActionResult => new EmptyResult(403);
/** StatusCode(code) / StatusCode(code, value) */
export const statusCode = (status: number, ...value: unknown[]): ActionResult =>
  value.length ? new ObjectResult(status, value[0]) : new EmptyResult(status);
/** File(bytes, contentType, fileDownloadName?) */
export const file = (body: Buffer | Readable | string, contentType: string, fileName?: string): ActionResult =>
  new FileResult(body, contentType, fileName);
/** Redirect(url) / RedirectPermanent(url) */
export const redirect = (url: string, permanent = false): ActionResult => new RedirectResult(url, permanent);
/** Content(text, contentType) */
export const content = (text: string, contentType?: string): ActionResult => new ContentResult(text, contentType);

const PROBLEM_TYPES: Record<number, [string, string]> = {
  400: ["https://tools.ietf.org/html/rfc9110#section-15.5.1", "Bad Request"],
  401: ["https://tools.ietf.org/html/rfc9110#section-15.5.2", "Unauthorized"],
  403: ["https://tools.ietf.org/html/rfc9110#section-15.5.4", "Forbidden"],
  404: ["https://tools.ietf.org/html/rfc9110#section-15.5.5", "Not Found"],
  405: ["https://tools.ietf.org/html/rfc9110#section-15.5.6", "Method Not Allowed"],
  406: ["https://tools.ietf.org/html/rfc9110#section-15.5.7", "Not Acceptable"],
  409: ["https://tools.ietf.org/html/rfc9110#section-15.5.10", "Conflict"],
  415: ["https://tools.ietf.org/html/rfc9110#section-15.5.16", "Unsupported Media Type"],
  422: ["https://tools.ietf.org/html/rfc9110#section-15.5.21", "Unprocessable Entity"],
  500: ["https://tools.ietf.org/html/rfc9110#section-15.6.1", "An error occurred while processing your request."],
};

/** The ProblemDetails body [ApiController] writes for a client error. */
export function problemDetails(status: number, traceId: string, extra?: Record<string, unknown>) {
  const [type, title] = PROBLEM_TYPES[status] ?? ["about:blank", "Error"];
  return { type, title, status, ...extra, traceId };
}
