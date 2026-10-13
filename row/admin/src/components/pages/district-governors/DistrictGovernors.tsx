"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { PageBanner } from "@/components/site/PageBanner";
import { SiteFooter } from "@/components/site/SiteFooter";
import { DISTRICTS } from "@/components/pages/websites/data";
import { getGovernors, governorPhotoUrl } from "@/lib/districtGovernors";
import { DGCard } from "./DGCard";
import { DEFAULT_YEAR, GOVERNORS, type Governor } from "./data";

const ARCHIVE_URL = "https://club.example.org/";

/** District number → zone, reusing the frozen website-directory data. */
const ZONE_BY_DISTRICT: Record<string, string> = Object.fromEntries(
  DISTRICTS.map((d) => [d.number, d.zone])
);

export function DistrictGovernors() {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"district" | "name">("district");

  /* ——— Live roster (per-club DG endpoint, assembled by /api/district-governors) ———
     Overlaid onto the verified bundled roster by district number so live values
     win where present and no district ever goes missing. Stays on the bundled
     roster when the API is unreachable. */
  const [roster, setRoster] = useState<Governor[]>(GOVERNORS);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    let alive = true;
    getGovernors().then((rows) => {
      if (!alive || rows.length === 0) return;
      const byDistrict = new Map(rows.map((r) => [r.districtNumber, r]));
      const merged: Governor[] = GOVERNORS.map((g) => {
        const r = byDistrict.get(g.district);
        if (!r) return g;
        return {
          ...g,
          name: r.name?.trim() || g.name,
          mobile: r.phone?.trim() || g.mobile,
          email: r.email?.trim() || g.email,
          photo: governorPhotoUrl(r.photo) ?? g.photo,
        };
      });
      // Any live districts not in the bundled roster get appended.
      const known = new Set(GOVERNORS.map((g) => g.district));
      for (const r of rows) {
        if (known.has(r.districtNumber)) continue;
        merged.push({
          name: r.name?.trim() || "—",
          district: r.districtNumber,
          mobile: r.phone?.trim() || "",
          email: r.email?.trim() || "",
          photo: governorPhotoUrl(r.photo) ?? "",
        });
      }
      setRoster(merged);
      setIsLive(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = roster.filter(
      (g) =>
        !q ||
        g.name.toLowerCase().includes(q) ||
        g.district.includes(q) ||
        g.email.toLowerCase().includes(q)
    );
    return [...list].sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : a.district.localeCompare(b.district)
    );
  }, [roster, query, sort]);

  /* ——— Grouped by zone (unknown districts last) ——— */
  const groups = useMemo(() => {
    const map = new Map<string, Governor[]>();
    for (const g of filtered) {
      const zone = ZONE_BY_DISTRICT[g.district] ?? "Other districts";
      if (!map.has(zone)) map.set(zone, []);
      map.get(zone)!.push(g);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      const az = a.startsWith("Zone");
      const bz = b.startsWith("Zone");
      if (az !== bz) return az ? -1 : 1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  return (
    <>
      {/* Standard split-serif banner — stat stack right slot, same as /websites */}
      <PageBanner
        eyebrow="Leadership Directory"
        subtitle={
          <>
            Meet the District Governors leading Rotary across the zones &mdash;
            direct phone and email contacts for all{" "}
            <span className="figure">{roster.length}</span> districts.
          </>
        }
        rightSlot={
          <div className="flex flex-col gap-6 border-l border-navy-950/10 pl-10">
            <div>
              <p
                data-counter={roster.length}
                className="figure text-6xl leading-none text-gold-deep"
              >
                {roster.length}
              </p>
              <p className="microlabel mt-2.5">Districts</p>
            </div>
            <div>
              <p className="figure text-3xl leading-none text-navy-950">{DEFAULT_YEAR}</p>
              <p className="microlabel mt-2">Rotary year</p>
            </div>
            {isLive && (
              <p className="microlabel-gold inline-flex items-center gap-1.5">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold" />
                Roster: live
              </p>
            )}
          </div>
        }
      >
        District <span className="text-gold">Governors</span>
      </PageBanner>

      {/* Pulled-up filter console */}
      <div className="container-rotary relative z-20 -mt-10 lg:-mt-16">
        <div className="console-glass flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative w-full flex-1">
            <label htmlFor="dg-search" className="sr-only">
              Search district governors
            </label>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
            <input
              id="dg-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, district or email..."
              className="input-modern pl-11"
            />
          </div>
          <div className="sm:w-44">
            <label htmlFor="dg-sort" className="sr-only">
              Sort by
            </label>
            <select
              id="dg-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as "district" | "name")}
              className="select-ui"
            >
              <option value="district">By district number</option>
              <option value="name">By name</option>
            </select>
          </div>
        </div>
      </div>

      {/* Roster — ledger lists under sticky zone headers */}
      <section className="bg-paper pb-24 pt-10 lg:pb-32 lg:pt-12">
        <div className="container-rotary">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <p className="microlabel">
              Rotary year <span className="figure">{DEFAULT_YEAR}</span> · Showing{" "}
              <span className="figure text-gold-deep">{filtered.length}</span> of{" "}
              <span className="figure">{roster.length}</span> governors
            </p>
            <a
              href={ARCHIVE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-sm text-[13px] font-medium text-muted transition-colors duration-200 hover:text-navy-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark"
            >
              Archive on example.org
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>

          {filtered.length > 0 ? (
            <div className="mt-6">
              {groups.map(([zone, rows]) => (
                <section key={zone} aria-label={zone}>
                  <h2 className="sticky top-[60px] z-10 border-b border-navy-950/15 bg-paper/90 py-3 pl-2 font-display text-xl font-[560] tracking-[-0.01em] text-navy-950 backdrop-blur-sm sm:pl-3">
                    {zone}
                    <span className="figure ml-3 align-middle text-[13px] font-semibold text-muted">
                      {rows.length}
                    </span>
                  </h2>
                  <div>
                    {rows.map((g) => (
                      <DGCard key={g.district + g.name} dg={g} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            /* Absent state — quiet porcelain panel, no dead chrome */
            <div className="mx-auto mt-10 max-w-xl rounded-2xl bg-porcelain px-6 py-14 text-center">
              <p className="font-display text-xl font-[450] tracking-[-0.01em] text-navy-950">
                No governors found
              </p>
              <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-muted">
                Try a different name, district number or email — or clear the search.
              </p>
              <button type="button" onClick={() => setQuery("")} className="btn-outline mt-6">
                Clear search
              </button>
            </div>
          )}

          {filtered.length > 0 && isLive && (
            <p className="microlabel mt-12 text-center">
              <span className="microlabel-gold inline-flex items-center gap-1.5">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold" />
                Live from the Rotary zones database
              </span>
            </p>
          )}
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
