"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink, MapPin } from "lucide-react";
import { RotaryWheel } from "@/components/icons/RotaryWheel";
import { cn } from "@/lib/utils";
import type { District } from "./data";
import { DISTRICT_LOGOS } from "./districtLogos";

/**
 * A single district card: official district logo on a quiet white well,
 * the district number as the card's figure, state chips, city line, and
 * two honest actions — a "District website" pill (or muted "No site yet"
 * when the district has none) and a disclosure that expands the club
 * websites as ledger rows INSIDE the card (CSS grid-rows height animation,
 * no popover to clip or trap).
 *
 * Finished at rest — no hover state required to read it.
 */
export function DistrictCard({
  district,
  index = 0,
}: {
  district: District;
  index?: number;
}) {
  const districtLogo = DISTRICT_LOGOS[district.number];
  const [open, setOpen] = useState(false);
  const panelId = `district-${district.number}-clubs`;
  const clubCount = district.clubs.length;

  return (
    <article
      data-animate="up"
      data-animate-duration="0.35"
      data-animate-delay={((index % 3) * 0.07).toFixed(2)}
      className="card flex h-full flex-col p-5"
    >
      {/* Header: logo well + district number & zone */}
      <div className="flex items-start gap-4">
        <div className="flex h-[72px] w-[72px] flex-shrink-0 items-center justify-center rounded-xl bg-white p-2.5 ring-1 ring-navy-950/10">
          {districtLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={districtLogo}
              alt={`District ${district.number} logo`}
              loading="lazy"
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-xs font-semibold leading-none text-navy-900">
                Rotary
              </span>
              <RotaryWheel className="h-5 w-5 flex-shrink-0 text-gold" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                District
              </span>
              <span className="figure mt-1 block text-[28px] leading-none text-navy-950">
                {district.number}
              </span>
            </h3>
            <span className="microlabel whitespace-nowrap">{district.zone}</span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {district.states.map((s) => (
              <span key={s} className="chip whitespace-nowrap px-2.5 !text-[11px]">
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* City line */}
      <p className="mb-4 mt-4 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-muted">
        <MapPin
          className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gold-deep/70"
          strokeWidth={1.75}
        />
        <span className="min-w-0 line-clamp-2">{district.cities.join(", ")}</span>
      </p>

      {/* Actions */}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-navy-950/10 pt-4">
        {district.website ? (
          <a
            href={district.website}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost group/link px-4 text-[12px]"
          >
            District website
            <ExternalLink className="h-3.5 w-3.5 transition-transform duration-300 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5" />
          </a>
        ) : (
          <span className="px-1 text-[13px] text-muted">No site yet</span>
        )}

        {clubCount > 0 ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-semibold text-navy-900 transition-colors duration-200 hover:text-gold-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark"
          >
            <span className="figure">{clubCount}</span>
            {clubCount === 1 ? "club site" : "club sites"}
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform duration-300",
                open && "rotate-180"
              )}
            />
          </button>
        ) : (
          <span className="px-1 text-[13px] text-muted">No club sites</span>
        )}
      </div>

      {/* Expanding club ledger — grid-rows height animation, inside the card */}
      {clubCount > 0 && (
        <div
          id={panelId}
          className={cn(
            "grid transition-[grid-template-rows] duration-300 ease-out-expo motion-reduce:transition-none",
            open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <ul className="mt-4 border-t border-navy-950/[0.10]">
              {district.clubs.map((club) => (
                <li key={club.id || club.name}>
                  <a
                    href={club.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    tabIndex={open ? undefined : -1}
                    className="ledger-row flex items-center justify-between gap-3 px-1 py-2.5 text-[13px] font-medium text-ink/80 transition-colors hover:text-gold-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark"
                  >
                    <span className="min-w-0 truncate">{club.name}</span>
                    <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-ink/40" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </article>
  );
}
