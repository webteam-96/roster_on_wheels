// Tenant resolution: maps an incoming Host header to a club identity.
// Two host shapes are supported:
//   1. Subdomain on the root domain   →  club.example.org
//   2. Third-party domain configured on the club  →  rotarymumbai.org
// Both go through the same backend lookup.

import "server-only";

const API_BASE = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export type SiteStatus = "active" | "trial" | "trial_expired" | "expired" | "not_found";

export interface TenantContext {
  clubId: number;
  clubName: string;
  subdomain: string | null;
  clientDomain: string | null;
  themeId: number;
  themeKey: string;
  status: SiteStatus;
  trialEndsAt: string | null;   // ISO date — null if not on trial
  paidUntil: string | null;     // ISO date — null if not paid
  daysRemaining: number;        // days until trial/paid expiry (negative = expired)
}

// In-memory LRU cache, keyed by Host. TTL effectively disabled so admin changes
// reflect immediately. Kept as a no-op shell to preserve API and purge endpoint.
type CacheEntry = { value: TenantContext | null; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 0; // No caching — every request fetches fresh tenant data
const MAX_ENTRIES = 5000;

function setCache(host: string, value: TenantContext | null) {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(host, { value, expiresAt: Date.now() + TTL_MS });
}

function getCache(host: string): { value: TenantContext | null } | null {
  const entry = cache.get(host);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(host);
    return null;
  }
  return { value: entry.value };
}

export function purgeTenantCache(host?: string) {
  if (host) cache.delete(host.toLowerCase());
  else cache.clear();
}

export async function resolveTenant(rawHost: string): Promise<TenantContext | null> {
  const host = rawHost.toLowerCase().split(":")[0]; // drop port
  if (!host) return null;

  const cached = getCache(host);
  if (cached) return cached.value;

  try {
    // Host goes as ?host=... — IIS rejects dotted hosts in path segments (treats .org as extension).
    const url = `${API_BASE}/api/public/club-website/by-host?host=${encodeURIComponent(host)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      // Server-side fetch — no cookies, no auth. Short timeout via AbortController.
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (res.status === 404) {
      setCache(host, null);
      return null;
    }
    if (!res.ok) {
      // Soft-fail: do not cache transient errors so retries can recover quickly.
      return null;
    }
    const data = (await res.json()) as TenantContext;
    setCache(host, data);
    return data;
  } catch {
    return null;
  }
}
