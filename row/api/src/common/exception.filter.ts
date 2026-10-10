import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";
import { ActionResultError, EmptyResult, ObjectResult } from "./results";
import { InvalidOperationException } from "./exceptions";
import { traceIdFor, writeResult, toDotnetJson } from "./http";

/**
 * Port of the error handling in Program.cs:
 *   InvalidOperationException -> 400 { message }
 *   anything else             -> logged, 500 { message, type }
 * plus what ASP.NET does before a controller runs:
 *   no matching route -> 404, wrong method -> 405, both with no body;
 *   unreadable JSON body -> 400 ProblemDetails; body too large -> 413.
 */
@Catch()
export class DotnetExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger("Unhandled");

  catch(error: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    if (res.headersSent) return;

    if (error instanceof ActionResultError) {
      writeResult(req, res, error.result);
      return;
    }

    if (error instanceof InvalidOperationException) {
      writeResult(req, res, new ObjectResult(400, { message: error.message }));
      return;
    }

    // body-parser failures arrive as plain errors carrying status/type
    const bodyError = error as { status?: number; type?: string; message?: string };
    if (bodyError?.type === "entity.too.large") {
      writeResult(req, res, new EmptyResult(413));
      return;
    }
    if (bodyError?.type === "entity.parse.failed") {
      res
        .status(400)
        .type("application/problem+json; charset=utf-8")
        .send(
          toDotnetJson({
            type: "https://tools.ietf.org/html/rfc9110#section-15.5.1",
            title: "One or more validation errors occurred.",
            status: 400,
            errors: { $: [bodyError.message ?? "The JSON value could not be parsed."] },
            traceId: traceIdFor(req),
          }),
        );
      return;
    }

    if (error instanceof HttpException) {
      // Nest raises these for unmatched routes; ASP.NET answers those with an empty 404/405.
      const status = error.getStatus();
      writeResult(req, res, new EmptyResult(status === 404 || status === 405 ? status : status));
      return;
    }

    const err = error instanceof Error ? error : new Error(String(error));
    const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    this.log.error(`Unhandled ${req.method} ${req.path}${query} -> 500`, err.stack);
    // mysql2 errors carry a SQL state: RIZones reported those as MySqlConnector's MySqlException.
    const isDbError = typeof (error as { sqlState?: unknown }).sqlState === "string" || typeof (error as { sqlMessage?: unknown }).sqlMessage === "string";
    writeResult(req, res, new ObjectResult(500, { message: err.message, type: isDbError ? "MySqlException" : err.name || "Exception" }));
  }
}
