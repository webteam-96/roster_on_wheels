// GET-only proxy to the Rotary admin API's public endpoints.
// NOTE: this deliberately does NOT live under /api. In production the site is served by IIS with
// the .NET backend mounted as a child application at /API, and IIS paths are case-insensitive —
// so ANY /api/* request is captured by the backend and never reaches Next.js (it 404s). Keep
// every Next.js route handler under /site-data/*.
//
// Client components call /site-data/rotary/<path>?<qs> (same-origin, so no browser
// CORS) and this route forwards to `${PROJECTS_API_BASE}/api/public/<path>?<qs>`.
//
// Two layers of caching sit in front of that forward:
//
//   1. The project-stats SNAPSHOT (src/lib/projectStatsServer.ts) answers the handful of
//      unfiltered zone-wide shapes the Projects page asks for on every visit. Those are
//      the 8-10 second queries, and they now cost ~1ms. See serveFromSnapshot below.
//   2. Everything else — every filtered combination — forwards upstream with the Next
//      data cache in front of it, plus a Cache-Control header so repeat hits are shared
//      across users instead of being paid per browser.

import { NextRequest, NextResponse } from "next/server";
import {
  allYearsSummary,
  driftedOverview,
  getSnapshot,
  yearSummary,
} from "@/lib/projectStatsServer";

const API_BASE = process.env.PROJECTS_API_BASE ?? "https://rizones45678.org/API";

// Only these public path prefixes may be proxied — everything else 404s.
const ALLOWED_PREFIXES = [
  "project-stats",
  "projects",
  "club", // GET /club/{clubId}/district-governor?yearId= (per-club DG lookup)
  "clubs",
  "website-directory",
  "district-governors",
];

/** The listing page size the Projects hub asks for (ProjectsHub PAGE_SIZE). Only this
 *  exact page-1 request can be answered from the snapshot. */
const CACHED_PAGE_SIZE = "50";

/** True when the query string carries nothing beyond the named keys — the guard that
 *  keeps a FILTERED request from being answered with zone-wide numbers. */
function only(sp: URLSearchParams, ...allowed: string[]): boolean {
  for (const key of sp.keys()) if (!allowed.includes(key)) return false;
  return true;
}

/**
 * Answer the unfiltered zone-wide shapes from the snapshot. Returns undefined for
 * anything else — a filtered request must go upstream, because the snapshot only ever
 * describes the whole zone.
 */
async function serveFromSnapshot(
  segments: string[],
  sp: URLSearchParams
): Promise<unknown | undefined> {
  if (segments[0] !== "project-stats" || segments.length !== 2) return undefined;

  const snap = await getSnapshot();
  if (!snap) return undefined; // cold cache — this request goes upstream, the build runs behind it

  switch (segments[1]) {
    case "overview":
      return only(sp) ? driftedOverview(snap) : undefined;
    case "states":
      return only(sp) ? snap.states : undefined;
    case "districts":
      return only(sp) ? snap.districts : undefined;
    case "areas":
      return only(sp) ? snap.areas : undefined;
    case "summary": {
      if (only(sp)) return allYearsSummary(snap);
      // A year on its own is still a cacheable slice: the live one for the current
      // year, a frozen one for any past year.
      if (only(sp, "yearId") && sp.has("yearId")) {
        const yearId = Number(sp.get("yearId"));
        if (!Number.isFinite(yearId)) return undefined;
        return (await yearSummary(snap, yearId)) ?? undefined;
      }
      return undefined;
    }
    case "projects":
      return only(sp, "page", "pageSize") &&
        (sp.get("page") ?? "1") === "1" &&
        (sp.get("pageSize") ?? CACHED_PAGE_SIZE) === CACHED_PAGE_SIZE
        ? snap.projectsPage1
        : undefined;
    default:
      return undefined;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const segments = params.path ?? [];
  if (segments.length === 0 || !ALLOWED_PREFIXES.includes(segments[0])) {
    return NextResponse.json({ message: "Not found." }, { status: 404 });
  }

  const sp = req.nextUrl.searchParams;

  const cached = await serveFromSnapshot(segments, sp);
  if (cached !== undefined) {
    return NextResponse.json(cached, {
      headers: {
        // No browser caching, deliberately: this is already a ~1ms read from the local
        // snapshot, so a browser copy saves almost nothing — and any TTL here would let
        // a stale copy survive the freshness probe that just corrected the snapshot.
        "cache-control": "no-store",
        "x-stats-cache": "hit",
      },
    });
  }

  // Re-encode each decoded segment (state names may contain spaces etc.).
  const path = segments.map(encodeURIComponent).join("/");
  const target = `${API_BASE}/api/public/${path}${req.nextUrl.search}`;

  try {
    const res = await fetch(target, { next: { revalidate: 300 } });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
        // Filtered combinations are expensive too — let the browser and any proxy
        // reuse them, and keep serving the old copy while a new one is fetched.
        // Never cache a failure: an upstream blip would otherwise stick for 5 minutes.
        "cache-control": res.ok
          ? "public, max-age=300, stale-while-revalidate=86400"
          : "no-store",
        "x-stats-cache": "miss",
      },
    });
  } catch {
    return NextResponse.json(
      { message: "Upstream API unreachable." },
      { status: 502 }
    );
  }
}
