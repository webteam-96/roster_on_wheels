// Server-side aggregation for the District Governors page.
//
// The admin API only exposes DGs per-club: GET /api/public/club/{clubId}/district-governor
// (returns the DG for that club's DISTRICT). To list every district we pick one
// serviceable club per district from the website-directory feed, then fan out the
// per-club lookups here on the server (Promise.all + 5-min data cache) so the
// client makes ONE request. Any upstream failure degrades to an empty list — the
// page then keeps its bundled roster, so it never blanks out.

import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.PROJECTS_API_BASE ?? process.env.NEXT_PUBLIC_API_ORIGIN ?? "";

type ClubWebsite = {
  clubId: number;
  districtId: number;
  districtNumber?: string | number;
};
type DistrictWebsite = { districtId: number; districtNumber: string | number };

// Mirrors DistrictGovernorDto (camelCase per the API's JSON policy). Only the
// fields the roster needs; all optional so a partial row degrades gracefully.
type DistrictGovernorDto = {
  memberName?: string | null;
  mobileNumber?: string | null;
  email?: string | null;
  profilePhoto?: string | null;
  yearLabel?: string | null;
};

export type RosterGovernor = {
  districtNumber: string;
  name: string;
  phone: string;
  email: string;
  photo: string;
};

/** GET a public endpoint, parse JSON; null on any HTTP/network failure. Never throws. */
async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}/api/public/${path}`, {
      next: { revalidate: 300 },
      // An unreachable upstream must fail fast, not hang the aggregation.
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** One serviceable club per district — the clubId the DG lookup needs. */
async function representativeClubs(): Promise<ClubWebsite[]> {
  // Fast path: the whole club feed in one call, grouped to first-per-district.
  const all = await getJson<ClubWebsite[]>("website-directory/clubs");
  if (Array.isArray(all) && all.length > 0) return all;

  // Fallback: district list, then that district's clubs (first each).
  const districts = (await getJson<DistrictWebsite[]>("website-directory/districts")) ?? [];
  const perDistrict = await Promise.all(
    districts.map(async (d): Promise<ClubWebsite | null> => {
      const clubs = await getJson<ClubWebsite[]>(
        `website-directory/clubs?districtId=${encodeURIComponent(String(d.districtId))}`
      );
      const first = clubs?.[0];
      if (!first) return null;
      return { ...first, districtNumber: first.districtNumber ?? d.districtNumber };
    })
  );
  return perDistrict.filter((c): c is ClubWebsite => c !== null);
}

export async function GET(req: NextRequest) {
  const yearId = req.nextUrl.searchParams.get("yearId");
  const yq = yearId ? `?yearId=${encodeURIComponent(yearId)}` : "";

  const clubs = await representativeClubs();
  if (clubs.length === 0) return NextResponse.json([] as RosterGovernor[]);

  // One representative club per district (all clubs in a district share the DG).
  const repByDistrict = new Map<string, ClubWebsite>();
  for (const c of clubs) {
    const num = String(c.districtNumber ?? "").trim();
    if (num && !repByDistrict.has(num)) repByDistrict.set(num, c);
  }

  const rows = await Promise.all(
    Array.from(repByDistrict.values()).map(async (c) => {
      const dto = await getJson<DistrictGovernorDto>(`club/${c.clubId}/district-governor${yq}`);
      const name = dto?.memberName?.trim();
      if (!name) return null;
      return {
        districtNumber: String(c.districtNumber),
        name,
        phone: dto?.mobileNumber?.trim() ?? "",
        email: dto?.email?.trim() ?? "",
        photo: dto?.profilePhoto?.trim() ?? "",
      } satisfies RosterGovernor;
    })
  );

  const roster = rows
    .filter((r): r is RosterGovernor => r !== null)
    .sort((a, b) => a.districtNumber.localeCompare(b.districtNumber));

  return NextResponse.json(roster);
}
