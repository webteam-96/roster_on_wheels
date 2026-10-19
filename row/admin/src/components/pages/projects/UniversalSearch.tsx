"use client";

import { Search } from "@/components/icons";

/**
 * The projects search box. Type a subject — "blood donation", "tree plantation"
 * — and the LISTING below narrows to projects matching it; the box itself only
 * reports how many it found.
 *
 * It used to instead offer a shortlist of states / districts / clubs / causes to
 * click, because the API could not filter projects by text. It can now (`q` on
 * project-stats/projects), so the shortlist was removed: the subjects people
 * actually search for are project titles, not filter names, and every one of
 * those dimensions already has its own pill in the browse row above. Dropping it
 * also dropped the zone-wide club fan-out it needed — one request PER DISTRICT,
 * fired on the second keystroke, which was competing with the search itself.
 *
 * Lives INSIDE the browse-pills row (one line with the other filters); the
 * result drops down as an overlay anchored to the row, so the nearest
 * positioned ancestor must be the row itself — give the row `relative`.
 */
export function UniversalSearch({
  query,
  onQueryChange,
  note,
}: {
  /** CONTROLLED. The parent owns the text because the same query drives the
   *  project listing, and "Clear all" has to be able to clear it. */
  query: string;
  onQueryChange: (query: string) => void;
  /** The result: how many projects the query matched. */
  note?: React.ReactNode;
}) {
  const q = query.trim();

  return (
    <div className="order-first w-full sm:order-none sm:w-auto sm:min-w-56 sm:flex-1">
      <label className="relative block">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search by project name, club, district, state"
          aria-label="Search projects by subject"
          className="min-h-10 w-full rounded-xl border border-navy-950/15 bg-white pl-10 pr-4 text-[13px] font-semibold text-navy-950 placeholder:font-medium placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-gold-dark"
        />
      </label>

      {q && note && (
        <div className="absolute inset-x-0 top-full z-20 mt-2 rounded-xl border border-navy-950/[0.10] bg-porcelain px-6 py-4 text-[13px] text-navy-950 shadow-soft lg:px-8">
          {note}
        </div>
      )}
    </div>
  );
}
