// Freshness probe + manual refresh for the Projects page snapshot.
// Under /site-data/* deliberately — IIS captures /api/* for the .NET backend, so a
// route handler there would never be reachable in production.
//
// GET  — the per-visit probe the Projects page fires after paint. Re-reads the CURRENT
//        rotary year only (~0.3s) and swaps it into the shared snapshot if it moved.
//        Cheap enough to run on every visit; the all-years figures follow by arithmetic
//        instead of an 8-second zone-wide query. Answers { changed }.
//
// POST — full rebuild, secret-guarded. For after a bulk import, or a nightly scheduled
//        hit that refreshes the frozen year slices and the distinct-count metrics:
//          curl -X POST -H "x-purge-secret: <secret>" https://<host>/site-data/projects-freshness
//
// The GET is deliberately unauthenticated: it reads the same public numbers the page
// already shows, and it can only ever replace cached data with the API's own answer.

import { NextRequest, NextResponse } from "next/server";
import { probeCurrentYear, rebuild } from "@/lib/projectStatsServer";

export const dynamic = "force-dynamic";

export async function GET() {
  const { changed, current } = await probeCurrentYear();
  return NextResponse.json(
    { changed, current },
    { headers: { "cache-control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  const expected = process.env.PURGE_CACHE_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "Refresh endpoint not configured (PURGE_CACHE_SECRET missing)." },
      { status: 500 }
    );
  }
  if (req.headers.get("x-purge-secret") !== expected) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const snap = await rebuild();
  return NextResponse.json(
    { rebuilt: snap !== null, builtAt: snap?.builtAt ?? null },
    { headers: { "cache-control": "no-store" } }
  );
}
