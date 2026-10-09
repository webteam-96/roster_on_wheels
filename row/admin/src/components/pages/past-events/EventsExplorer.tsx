"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { EventCard, FlagshipCard } from "./EventCard";
import { EVENTS, eventSlug, type EventItem } from "./data";

const YEARS = Array.from(new Set(EVENTS.map((e) => e.badge.year)));
const ZONES = ["Zone 4", "Zone 5", "Zone 6", "Zone 7"];
/** The flagship slot — TEJAS carries the strongest photography of the set. */
const FLAGSHIP_SLUG = "tejas";

export function EventsExplorer() {
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [zone, setZone] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EVENTS.filter((e) => {
      const mq = !q || e.title.toLowerCase().includes(q) || e.venue.toLowerCase().includes(q);
      const my = !year || e.badge.year === year;
      // Match against the event's real zone list (e.g. "Zone 4" -> 4).
      const zoneNum = parseInt(zone.replace(/\D/g, ""), 10);
      const mz = !zone || e.zones.includes(zoneNum);
      return mq && my && mz;
    });
  }, [query, year, zone]);

  const isFiltering = Boolean(query.trim() || year || zone);
  const flagship = !isFiltering
    ? filtered.find((e) => eventSlug(e) === FLAGSHIP_SLUG)
    : undefined;

  // Year groups in archive order (EVENTS is newest-first).
  const groups = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    for (const e of filtered) {
      if (e === flagship) continue;
      const list = map.get(e.badge.year) ?? [];
      list.push(e);
      map.set(e.badge.year, list);
    }
    return Array.from(map.entries());
  }, [filtered, flagship]);

  const clear = () => {
    setQuery("");
    setYear("");
    setZone("");
  };

  return (
    <section className="bg-paper pb-20 lg:pb-24">
      {/* Pulled-up console — floats over the banner seam */}
      <div className="container-rotary relative z-10 -mt-12 lg:-mt-16">
        <div className="console-glass p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="lg:w-48">
              <label
                htmlFor="events-filter-year"
                className="mb-1.5 block text-xs font-medium text-muted"
              >
                Year
              </label>
              <select
                id="events-filter-year"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="select-ui"
              >
                <option value="">All years</option>
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:w-48">
              <label
                htmlFor="events-filter-zone"
                className="mb-1.5 block text-xs font-medium text-muted"
              >
                Zone
              </label>
              <select
                id="events-filter-zone"
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                className="select-ui"
              >
                <option value="">All zones</option>
                {ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1">
              <label
                htmlFor="events-search"
                className="mb-1.5 block text-xs font-medium text-muted"
              >
                Search
              </label>
              <div className="relative">
                <input
                  id="events-search"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search events or venues…"
                  className="input-modern pr-11"
                />
                <Search className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/50" />
              </div>
            </div>

            <p className="pb-2.5 text-[13px] text-muted lg:pl-2" aria-live="polite">
              <span className="figure text-navy-950">{filtered.length}</span>{" "}
              {filtered.length === 1 ? "event" : "events"}
            </p>
          </div>
        </div>
      </div>

      {/* Flagship feature — full 12-col span */}
      {flagship && (
        <div className="container-rotary mt-12">
          <FlagshipCard event={flagship} />
        </div>
      )}

      {/* Archive, grouped by year under sticky serif headers */}
      <div className="container-rotary">
        {filtered.length > 0 ? (
          groups.map(([groupYear, items]) => (
            <div key={groupYear} className="mt-12 first:mt-12">
              <div className="sticky top-[60px] z-20 -mx-4 bg-paper/85 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
                <div className="flex items-baseline gap-4">
                  <h2 className="font-display text-heading font-[450] leading-none tracking-[-0.02em] text-navy-950">
                    {groupYear}
                  </h2>
                  <p className="text-[12px] text-muted">
                    <span className="figure">{items.length}</span>{" "}
                    {items.length === 1 ? "event" : "events"}
                  </p>
                  <span className="h-px flex-1 self-center bg-navy-950/10" aria-hidden />
                </div>
              </div>
              <div
                data-animate-stagger="left"
                className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
              >
                {items.map((e) => (
                  <EventCard key={e.title} event={e} />
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="mx-auto mt-14 max-w-xl rounded-2xl bg-porcelain px-6 py-14 text-center">
            <p className="font-display text-heading font-[450] tracking-[-0.02em] text-navy-950">
              No events match
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Try a different year or zone, or clear the search to see every event in the archive.
            </p>
            <button type="button" onClick={clear} className="btn-ghost mt-7">
              Clear filters
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
