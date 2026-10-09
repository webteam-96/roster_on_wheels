import { existsSync } from "node:fs";
import { join } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";

/**
 * Port of the media handling at the end of Program.cs: uploaded files are
 * served from the web root (Media:WebRoot, else ./wwwroot) with any Origin
 * reflected, after three rescues:
 *  1. "+" in a legacy file name: when the literal-"+" file is missing but the
 *     space variant exists, serve that (files uploaded before names were cleaned).
 *  2. Gallery ".png" asked for after PngToJpgTool converted it: serve the ".jpg".
 *  3. Media:RedirectBaseUrl set: a media file not present locally is 302'd there.
 */
const MEDIA_PREFIXES = ["/documents", "/uploads", "/tempdocument"];

function localPath(webRoot: string, urlPath: string): string {
  return join(webRoot, decodeURIComponent(urlPath.replace(/^\/+/, "")));
}

export function mediaMiddleware(webRoot: string, redirectBase?: string) {
  const serve = express.static(webRoot, {
    fallthrough: true,
    setHeaders: (res) => {
      const origin = (res.req as Request).headers.origin;
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      }
    },
  });
  const redirectRoot = redirectBase?.replace(/\/+$/, "");

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let p = req.path;
    const lower = p.toLowerCase();
    const isMedia = MEDIA_PREFIXES.some((pre) => lower.startsWith(pre));

    if (isMedia && p.includes("+")) {
      try {
        if (!existsSync(localPath(webRoot, p)) && existsSync(localPath(webRoot, p.replace(/\+/g, " ")))) {
          p = p.replace(/\+/g, " ");
          req.url = encodeURI(p) + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
        }
      } catch {
        // malformed escape: leave the path alone
      }
    }

    if (lower.startsWith("/documents/gallery/") && lower.endsWith(".png")) {
      try {
        const png = localPath(webRoot, p);
        const jpgUrl = p.slice(0, -4) + ".jpg";
        if (!existsSync(png) && existsSync(localPath(webRoot, jpgUrl))) {
          p = jpgUrl;
          req.url = encodeURI(p);
        }
      } catch {
        // leave as is
      }
    }

    if (isMedia && redirectRoot) {
      try {
        if (!existsSync(localPath(webRoot, p))) {
          const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
          res.redirect(302, redirectRoot + req.path + query);
          return;
        }
      } catch {
        // fall through to static serving
      }
    }
    serve(req, res, next);
  };
}

/** UsePathBase(PathBase): requests may arrive with or without the base (e.g. "/API"). */
export function pathBaseMiddleware(pathBase: string | undefined) {
  const base = pathBase?.replace(/\/+$/, "");
  return (req: Request, _res: Response, next: NextFunction) => {
    if (base && (req.url === base || req.url.toLowerCase().startsWith(base.toLowerCase() + "/") || req.url.toLowerCase().startsWith(base.toLowerCase() + "?"))) {
      req.url = req.url.slice(base.length) || "/";
    }
    next();
  };
}
