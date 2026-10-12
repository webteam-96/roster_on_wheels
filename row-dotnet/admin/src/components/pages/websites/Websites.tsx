"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, SearchX, RotateCcw } from "lucide-react";
import { PageBanner } from "@/components/site/PageBanner";
import { SiteFooter } from "@/components/site/SiteFooter";
import { DistrictCard } from "./DistrictCard";
import { DISTRICTS, STATE_OPTIONS, ZONE_OPTIONS, type Club, type District } from "./data";

/* ——— Live website-directory API (optimistic, static fallback) ——— */

type ApiDistrict = {
  districtId: number | string;
  districtNumber: number | string;
  url?: string;
};

type ApiClub = {
  clubId?: number | string;
  clubName: string;
  city?: string;
  districtId: number | string;
  districtNumber?: number | string;
  url: string;
};

/** Fetch a JSON array; resolves to [] on ANY failure — never throws. */
async function fetchJson<T>(url: string): Promise<T[]> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    return Array.isArray(data) ? (data as T[]) : [];
  } catch {
    return [];
  }
}

export function Websites() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState("");
  const [zone, setZone] = useState("");

  // Live directory data — fetched optimistically; the page renders the
  // static DISTRICTS list untouched until (and unless) the API answers.
  const [liveDistricts, setLiveDistricts] = useState<ApiDistrict[]>([]);
  const [liveClubs, setLiveClubs] = useState<ApiClub[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const apiDistricts = await fetchJson<ApiDistrict>(
        "/site-data/rotary/website-directory/districts"
      );
      if (cancelled || apiDistricts.length === 0) return;
      setLiveDistricts(apiDistricts);
      const clubLists = await Promise.all(
        apiDistricts.map((d) =>
          fetchJson<ApiClub>(
            `/site-data/rotary/website-directory/clubs?districtId=${encodeURIComponent(
              String(d.districtId)
            )}`
          )
        )
      );
      if (cancelled) return;
      setLiveClubs(clubLists.flat());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isLive = liveDistricts.length > 0;

  /** Static list with live URLs/clubs merged in by district number. */
  const districts = useMemo<District[]>(() => {
    if (liveDistricts.length === 0) return DISTRICTS;
    const urlByNumber = new Map<string, string>();
    const numberById = new Map<string, string>();
    for (const d of liveDistricts) {
      const num = String(d.districtNumber);
      numberById.set(String(d.districtId), num);
      if (d.url) urlByNumber.set(num, d.url);
    }
    const clubsByNumber = new Map<string, Club[]>();
    for (const c of liveClubs) {
      const num =
        c.districtNumber != null
          ? String(c.districtNumber)
          : numberById.get(String(c.districtId));
      if (!num) continue;
      const clubs = clubsByNumber.get(num) ?? [];
      clubs.push({
        id: c.clubId != null ? String(c.clubId) : "",
        name: c.city ? `${c.clubName}, ${c.city}` : c.clubName,
        url: c.url,
      });
      clubsByNumber.set(num, clubs);
    }
    return DISTRICTS.map((d) => ({
      ...d,
      website: urlByNumber.get(d.number) ?? d.website,
      clubs: clubsByNumber.get(d.number) ?? d.clubs,
    }));
  }, [liveDistricts, liveClubs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return districts.filter((d) => {
      const matchesQuery =
        !q ||
        d.number.toLowerCase().includes(q) ||
        d.region.toLowerCase().includes(q) ||
        d.states.some((s) => s.toLowerCase().includes(q)) ||
        d.cities.some((c) => c.toLowerCase().includes(q));
      const matchesState = !state || d.states.includes(state);
      const matchesZone = !zone || d.zone === zone;
      return matchesQuery && matchesState && matchesZone;
    });
  }, [districts, query, state, zone]);

  const clubTotal = useMemo(
    () => districts.reduce((sum, d) => sum + d.clubs.length, 0),
    [districts]
  );

  const reset = () => {
    setQuery("");
    setState("");
    setZone("");
  };

  return (
    <>
      <PageBanner
        eyebrow="Directories"
        subtitle="Every district and club keeps its own front door on the web. Search the directory by district number, state or city."
        rightSlot={
          <div className="flex flex-col gap-6 border-l border-navy-950/10 pl-10">
            <div>
              <p
                data-counter={districts.length}
                className="figure text-6xl leading-none text-gold-deep"
              >
                {districts.length}
              </p>
              <p className="microlabel mt-2.5">Districts listed</p>
            </div>
            <div>
              <p className="figure text-3xl leading-none text-navy-950">{clubTotal}</p>
              <p className="microlabel mt-2">Club websites</p>
            </div>
            {isLive && (
              <p className="microlabel-gold inline-flex items-center gap-1.5">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold" />
                Directory: live
              </p>
            )}
          </div>
        }
      >
        District &amp; club <span className="text-gold">websites</span>
      </PageBanner>

      <section className="bg-paper pb-24 lg:pb-32">
        {/* Pulled-up filter console */}
        <div className="container-wide relative z-10 -mt-16">
          <div
            data-animate="up"
            data-animate-duration="0.7"
            className="console-glass p-5 lg:p-6"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
              {/* Search */}
              <div className="flex-1">
                <label
                  htmlFor="district-search"
                  className="mb-1.5 block text-xs font-medium text-muted"
                >
                  Search
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/50" />
                  <input
                    id="district-search"
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="District, state or city…"
                    className="input-modern pl-11"
                  />
                </div>
              </div>

              {/* Filter by State */}
              <div className="lg:w-52">
                <label
                  htmlFor="district-state"
                  className="mb-1.5 block text-xs font-medium text-muted"
                >
                  State
                </label>
                <select
                  id="district-state"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="select-ui"
                >
                  <option value="">All states</option>
                  {STATE_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              {/* Filter by Zone */}
              <div className="lg:w-44">
                <label
                  htmlFor="district-zone"
                  className="mb-1.5 block text-xs font-medium text-muted"
                >
                  Zone
                </label>
                <select
                  id="district-zone"
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                  className="select-ui"
                >
                  <option value="">All zones</option>
                  {ZONE_OPTIONS.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              </div>

              {/* Reset */}
              <button type="button" onClick={reset} className="btn-ghost">
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
            </div>

            {/* Result count */}
            <div className="mt-5 flex items-center gap-4 border-t border-navy-950/10 pt-4">
              <p aria-live="polite" className="text-[13px] text-muted">
                Showing <span className="figure text-ink">{filtered.length}</span> of{" "}
                <span className="figure text-ink">{districts.length}</span> districts
              </p>
              <div className="flex-1" />
              {isLive && (
                <span className="microlabel-gold inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold" />
                  Directory: live
                </span>
              )}
            </div>
          </div>
        </div>

        {/* District grid — all districts, no pagination; filtering narrows in place */}
        <div className="container-wide mt-12">
          <h2 className="sr-only">District directory</h2>
          {filtered.length > 0 ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((d, i) => (
                <DistrictCard key={d.number} district={d} index={i} />
              ))}
            </div>
          ) : (
            <div className="mx-auto flex max-w-xl flex-col items-center rounded-2xl bg-porcelain px-6 py-16 text-center ring-1 ring-navy-950/[0.08]">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white ring-1 ring-navy-950/10">
                <SearchX className="h-6 w-6 text-gold-deep" />
              </span>
              <p className="mt-5 font-display text-xl font-[450] tracking-tight text-navy-950">
                No districts match your filters
              </p>
              <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-muted">
                Try a different district number, state or city — or clear the
                filters below.
              </p>
              <button type="button" onClick={reset} className="btn-ghost mt-6">
                <RotateCcw className="h-4 w-4" />
                Reset filters
              </button>
            </div>
          )}
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
