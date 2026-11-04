// Called by RotaryApi whenever admin saves a change that affects what the
// public club website renders (theme, banners, projects, BOD, events, etc.).
// Clears the in-memory tenant cache for the affected host AND invalidates
// Next.js's fetch cache by tag — so the very next page request shows fresh data.
//
// Protected by a shared secret to keep random callers from spamming cache busts.

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { purgeTenantCache } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const expected = process.env.PURGE_CACHE_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "Purge endpoint not configured (PURGE_CACHE_SECRET missing)." },
      { status: 500 }
    );
  }

  const provided = req.headers.get("x-purge-secret");
  if (provided !== expected) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const host = (searchParams.get("host") || "").toLowerCase().split(":")[0].trim();

  if (!host) {
    // No host → purge everything (used by admin "Clear all caches" panic button)
    purgeTenantCache();
    revalidateTag("club-data");
    return NextResponse.json({ purged: "all" });
  }

  purgeTenantCache(host);
  // Tag matches the one we set in lib/api.ts so all page-data fetches keyed
  // to this host are invalidated in Next.js's data cache.
  revalidateTag(`host:${host}`);
  revalidateTag("club-data");

  return NextResponse.json({ purged: host });
}
