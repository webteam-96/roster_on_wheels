import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import type { Request, Response } from "express";
import { ExpressAdapter } from "@nestjs/platform-express";
import {
  ActionResult,
  ContentResult,
  EmptyResult,
  FileResult,
  ObjectResult,
  ProblemResult,
  RedirectResult,
  problemDetails,
} from "./results";

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** A JS Date as System.Text.Json writes a DateTime of kind Local/Unspecified: server-local, no offset. */
export function dotnetDateTime(d: Date): string {
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const ms = d.getMilliseconds();
  return ms ? `${base}.${pad(ms, 3).replace(/0+$/, "")}` : base;
}

/** JSON.stringify replacer: Buffers as base64 (byte[]) and Dates in the .NET form. */
export function dotnetJsonReplacer(this: unknown, key: string, value: unknown): unknown {
  const raw = (this as Record<string, unknown>)[key];
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : dotnetDateTime(raw);
  if (Buffer.isBuffer(raw)) return raw.toString("base64");
  return value;
}

export function toDotnetJson(value: unknown): string {
  return JSON.stringify(value, dotnetJsonReplacer);
}

/** W3C trace id, the form ASP.NET puts in ProblemDetails.traceId. */
export function traceIdFor(req: Request & { traceId?: string }): string {
  if (!req.traceId) req.traceId = `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-00`;
  return req.traceId;
}

/**
 * MVC picks the string formatter (text/plain) for a string value unless the
 * client asks specifically for JSON: with the default RespectBrowserAcceptHeader
 * = false, an Accept header containing a wildcard is ignored altogether.
 */
function wantsJsonForString(req: Request): boolean {
  const accept = req.headers.accept ?? "";
  if (!accept || accept.includes("*/*")) return false;
  const first = accept.split(",")[0].split(";")[0].trim().toLowerCase();
  return first === "application/json" || first.endsWith("+json");
}

/** Content-Disposition as FileContentResult writes it. */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  const needsQuotes = /[\s;,]/.test(ascii);
  return `attachment; filename=${needsQuotes ? `"${ascii}"` : ascii}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function writeResult(req: Request, res: Response, result: ActionResult): void {
  if (res.headersSent) return;

  if (result instanceof ObjectResult) {
    const { status, value } = result;
    if (value === null || value === undefined) {
      // HttpNoContentOutputFormatter: a null value on a 200 becomes 204.
      res.status(status === 200 ? 204 : status).end();
      return;
    }
    if (typeof value === "string" && !wantsJsonForString(req)) {
      res.status(status).type("text/plain; charset=utf-8").send(value);
      return;
    }
    res.status(status).type("application/json; charset=utf-8").send(toDotnetJson(value));
    return;
  }

  if (result instanceof ProblemResult) {
    res
      .status(result.status)
      .type("application/problem+json; charset=utf-8")
      .send(toDotnetJson(problemDetails(result.status, traceIdFor(req))));
    return;
  }

  if (result instanceof EmptyResult) {
    res.status(result.status).setHeader("Content-Length", "0");
    res.end();
    return;
  }

  if (result instanceof FileResult) {
    res.status(200).type(result.contentType);
    if (result.fileName) res.setHeader("Content-Disposition", contentDisposition(result.fileName));
    if (result.body instanceof Readable) {
      result.body.pipe(res);
    } else {
      res.send(Buffer.isBuffer(result.body) ? result.body : Buffer.from(result.body));
    }
    return;
  }

  if (result instanceof RedirectResult) {
    res.redirect(result.status, result.url);
    return;
  }

  if (result instanceof ContentResult) {
    res.status(result.status).type(result.contentType).send(result.content);
    return;
  }

  res.status(result.status).end();
}

/**
 * Nest's Express adapter, with reply() writing responses the way ASP.NET does:
 * an ActionResult as itself, a plain value as Ok(value) (always 200, never
 * Nest's 201 for POST), and no value as 204.
 */
export class DotnetExpressAdapter extends ExpressAdapter {
  reply(response: Response, body: unknown, _statusCode?: number): void {
    const req = response.req as Request;
    if (body instanceof ActionResult) {
      writeResult(req, response, body);
      return;
    }
    writeResult(req, response, new ObjectResult(200, body));
  }
}
