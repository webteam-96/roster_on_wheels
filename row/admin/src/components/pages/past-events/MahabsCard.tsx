"use client";

import { useState } from "react";
import { ChevronDown } from "@/components/icons";
import { cn } from "@/lib/utils";
import { EventButton } from "./parts";
import type { MahabsDay, MahabsLink } from "./data";

function AccordionRow({ day, links }: MahabsDay) {
  const [open, setOpen] = useState(false);
  const slug = day.toLowerCase().replace(/\s+/g, "-");
  const panelId = `mahabs-panel-${slug}`;
  const buttonId = `mahabs-button-${slug}`;
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        id={buttonId}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-5 py-3.5 text-left text-[14px] font-semibold text-navy-950 transition-colors hover:bg-porcelain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold-dark"
      >
        {day}
        <span className="flex items-center gap-3">
          <span className="text-[12px] font-medium text-muted">
            <span className="figure">{links.length}</span> recordings
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 flex-shrink-0 text-muted transition-transform duration-300",
              open && "rotate-180 text-gold-deep"
            )}
          />
        </span>
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        aria-hidden={!open}
        className={cn(
          "grid transition-all duration-300 ease-out",
          open ? "visible grid-rows-[1fr]" : "invisible grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t border-navy-950/10 px-5 pb-1.5">
            {links.map((l, i) => (
              <EventButton key={i} label={l.label} url={l.url} kind="video" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** MAHABS body — per-day accordions of recording rows plus the TRF sessions. */
export function MahabsAccordion({ days, trf }: { days: MahabsDay[]; trf: MahabsLink[] }) {
  return (
    <div>
      <div className="space-y-3">
        {days.map((d) => (
          <AccordionRow key={d.day} {...d} />
        ))}
      </div>
      <div className="mt-8">
        <p className="microlabel">TRF Sessions</p>
        <div className="mt-3 border-t border-navy-950/10">
          {trf.map((t, i) => (
            <EventButton key={i} label={t.label} url={t.url} kind="video" />
          ))}
        </div>
      </div>
    </div>
  );
}
