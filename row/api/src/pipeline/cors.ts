import type { NextFunction, Request, Response } from "express";
import type { BrandOptions } from "../brand/brand";

/**
 * Port of the three CORS policies in Program.cs.
 *  - Default: in Development any origin; otherwise the brand's allowed origin
 *    suffixes (RIZones: rizones45678.org, rizones4567.org and their subdomains)
 *    plus localhost / 127.0.0.1 on any port.
 *  - PublicOpen: any origin, for api/public/club, api/public/club-website, api/public/ocv-live-documents and the project share routes
 *    (club and district websites on domains that cannot be listed).
 *  - ThirdPartyCors: api/RotaryThirdParty, for the partner's domains plus localhost.
 * All policies allow any header and method, without credentials. A disallowed
 * origin simply gets no CORS headers, as ASP.NET does.
 */
function hostAllowed(origin: string, suffixes: string[]): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") return true;
  return suffixes.some((s) => host === s.toLowerCase() || host.endsWith("." + s.toLowerCase()));
}

const PUBLIC_OPEN = [/^\/api\/public\/club(\/|$)/i, /^\/api\/public\/club-website(\/|$)/i, /^\/api\/public\/ocv-live-documents(\/|$)/i, /^\/api\/public\/projects\/\d+\/share/i];
const THIRD_PARTY = /^\/api\/RotaryThirdParty(\/|$)/i;

export function corsMiddleware(brand: BrandOptions, development: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin) {
      const path = req.path;
      let allowed: "any" | "origin" | null;
      if (PUBLIC_OPEN.some((r) => r.test(path))) allowed = "any";
      else if (THIRD_PARTY.test(path)) allowed = hostAllowed(origin, brand.domains.thirdPartyOriginSuffixes) ? "origin" : null;
      else if (development) allowed = "any";
      else allowed = hostAllowed(origin, brand.domains.allowedOriginSuffixes) ? "origin" : null;

      if (allowed) {
        res.setHeader("Access-Control-Allow-Origin", allowed === "any" ? "*" : origin);
        if (allowed === "origin") res.append("Vary", "Origin");
        if (req.method === "OPTIONS" && req.headers["access-control-request-method"]) {
          res.setHeader("Access-Control-Allow-Methods", String(req.headers["access-control-request-method"]));
          const reqHeaders = req.headers["access-control-request-headers"];
          if (reqHeaders) res.setHeader("Access-Control-Allow-Headers", String(reqHeaders));
          res.status(204).end();
          return;
        }
      } else if (req.method === "OPTIONS" && req.headers["access-control-request-method"]) {
        res.status(204).end();
        return;
      }
    }
    next();
  };
}
