import { Resolver } from "node:dns/promises";
import { Logger } from "@nestjs/common";
import { normalizeClientDomain } from "./website-domain.helper";

const log = new Logger("WebsiteReachability");
const cache = new Map<string, { ok: boolean; at: number }>();
const TTL = 15 * 60_000;

/** Stored values may carry a scheme, a broken scheme ("https//x") or a path: reduce to a bare host; placeholders are null. */
function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  let h = raw.trim();
  const idx = h.indexOf("//");
  if (idx >= 0 && idx <= 8) h = h.slice(idx + 2);
  const slash = h.indexOf("/");
  if (slash >= 0) h = h.slice(0, slash);
  h = h.trim().replace(/^\.+|\.+$/g, "").toLowerCase();
  if (!h) return null;
  if (["na", "n/a", "none", "null", "-", "tbd", "tba"].includes(h)) return null;
  if (/[ \\@:?#"']/.test(h)) return null;
  return h;
}

/** The platform subdomain URL (trusted as live). */
export function buildSubdomainUrl(subdomain: string | null | undefined, parentDomain: string | null | undefined, useHttps: boolean): string | null {
  const sub = normalizeHost(subdomain);
  if (!sub) return null;
  const parent = normalizeHost(parentDomain);
  const host = sub.includes(".") || !parent ? sub : `${sub}.${parent}`;
  return `${useHttps ? "https" : "http"}://${host}`;
}

async function probe(url: string): Promise<boolean> {
  const go = (method: string) => fetch(url, { method, redirect: "follow", signal: AbortSignal.timeout(4000) });
  try {
    const head = await go("HEAD");
    if (head.status < 400) return true;
    if (head.status !== 405) return false;
    return (await go("GET")).status < 400; // some servers reject HEAD
  } catch {
    return false;
  }
}

async function reachable(url: string) {
  const c = cache.get(url);
  if (c && Date.now() - c.at < TTL) return c.ok;
  const ok = await probe(url);
  cache.set(url, { ok, at: Date.now() });
  return ok;
}

/**
 * Port of WebsiteReachability.ResolveAsync: the "Visit Website" URL. A custom
 * domain is used only when it responds (cached 15 min), else the subdomain.
 */
export async function resolveWebsiteUrl(clientDomain: string | null | undefined, subdomain: string | null | undefined, parentDomain: string | null | undefined, useHttps: boolean): Promise<string | null> {
  const subUrl = buildSubdomainUrl(subdomain, parentDomain, useHttps);
  const host = normalizeHost(clientDomain);
  if (host && host.includes(".")) {
    for (const scheme of ["https", "http"]) {
      const candidate = `${scheme}://${host}`;
      if (await reachable(candidate).catch(() => false)) return candidate;
    }
  }
  return subUrl;
}

/**
 * Port of DnsPointingChecker.cs: does the domain's A record, as public
 * resolvers (8.8.8.8, 1.1.1.1) see it, equal our server IP?
 */
export async function checkDnsPointing(domain: string, expectedIp: string) {
  const host = normalizeClientDomain(domain) ?? "";
  let ips: string[] = [];
  if (host) {
    try {
      const r = new Resolver({ timeout: 5000, tries: 3 });
      r.setServers(["8.8.8.8", "1.1.1.1"]);
      ips = [...new Set((await r.resolve4(host)).map((s) => s.toLowerCase()))];
    } catch (e) {
      log.warn(`DNS A lookup failed for ${host}: ${(e as Error).message}`);
    }
  }
  const expected = (expectedIp ?? "").trim().toLowerCase();
  return { domain: host || domain, expectedIp, resolvedIps: ips, pointsToServer: !!expected && ips.includes(expected) };
}
