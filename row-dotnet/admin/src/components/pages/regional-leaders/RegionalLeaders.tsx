"use client";

import { useState } from "react";
import { PageBanner } from "@/components/site/PageBanner";
import { SiteFooter } from "@/components/site/SiteFooter";
import { cn } from "@/lib/utils";
import { RoleSection } from "./RoleSection";
import { ZONES, SECTIONS_BY_ZONE, type Zone } from "./data";

/** Display casing normalized at render time — the data keys stay verbatim. */
const zoneLabel = (zone: Zone) => zone.charAt(0).toUpperCase() + zone.slice(1);

export function RegionalLeaders() {
  const [activeZone, setActiveZone] = useState<Zone>("Zone 4");
  const sections = SECTIONS_BY_ZONE[activeZone];

  return (
    <>
      {/* Standard split-serif banner — no counts. */}
      <PageBanner
        eyebrow="ROW"
        subtitle="The coordinators, advisors and plan leads guiding Rotary's Action Plan — with a direct line to every one of them."
      >
        Regional <span className="text-gold">Leaders</span>
      </PageBanner>

      {/* Sticky zone control — azure pill tabs */}
      <div className="sticky top-[60px] z-30 border-b border-navy-950/10 bg-paper/90 backdrop-blur-md">
        <div className="container-rotary">
          <div
            role="tablist"
            aria-label="Rotary zones"
            className="scrollbar-none flex gap-2 overflow-x-auto py-3"
          >
            {ZONES.map((zone) => {
              const active = zone === activeZone;
              return (
                <button
                  key={zone}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveZone(zone)}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-full px-5 py-2 text-[13.5px] font-semibold transition-all duration-200",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark",
                    active
                      ? "bg-gold text-navy-950 shadow-glow-gold-sm"
                      : "text-muted ring-1 ring-navy-950/15 hover:text-navy-950 hover:ring-navy-950/35"
                  )}
                >
                  {zoneLabel(zone)}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Role-group directory for the active zone */}
      <section className="bg-paper pb-24 pt-10 lg:pb-32 lg:pt-14">
        <div className="container-rotary">
          <p
            data-animate="up"
            data-animate-duration="0.7"
            className="microlabel"
            aria-live="polite"
          >
            {zoneLabel(activeZone)} directory
          </p>

          {/* Zone switch: keyed remount + CSS fade. Reliable content swap —
              AnimatePresence mode="wait" could stall mid-exit and strand the
              previous zone's roster on screen. */}
          <div
            key={activeZone}
            className="mt-10 animate-fade-up space-y-12 lg:mt-12 lg:space-y-14"
          >
            {sections.map((section) => (
              <RoleSection key={section.id} section={section} />
            ))}
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
