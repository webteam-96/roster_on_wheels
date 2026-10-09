"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { fmt } from "@/components/pages/projects/shared";

const COLLAPSED_LIMIT = 12;

export type ChoiceItem = {
  /** Stable value handed back to onPick (state name / district id / club id). */
  value: string;
  label: string;
  /** Projects behind this choice, under the filters already applied. */
  count: number;
  active?: boolean;
};

/**
 * Compact browse list for the long geography dimensions (states, districts,
 * clubs) — the ChoiceCard grid reads well for 7 causes but is one card per row
 * on phones, so 35 states or 100+ clubs meant screens of scrolling.
 *
 * Dense pill-chips, the top 12 shown with a "Show all N" expander. Hunting a
 * specific place is the universal search box's job, so there is no per-list
 * input. The active choice stays visible even when collapsed.
 *
 * Order: busiest-first by default; `keepOrder` respects the caller's order
 * (districts come pre-sorted by RID number).
 *
 * `collapsible` (sections auto-opened by a selection, not by tapping their
 * tab): on PHONES the whole list folds behind its heading — tap to expand —
 * so picking a filter doesn't dump three long lists onto the screen. Desktop
 * always shows the list; the toggle is mobile-only.
 */
export function ChoiceBrowser({
  heading,
  items,
  onPick,
  collapsible = false,
  keepOrder = false,
}: {
  heading: string;
  items: ChoiceItem[];
  onPick: (value: string, active: boolean) => void;
  collapsible?: boolean;
  keepOrder?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(!collapsible); // mobile fold state
  const folded = collapsible && !open; // mobile-only; sm: classes override

  const sorted = keepOrder ? items : [...items].sort((a, b) => b.count - a.count);

  // Collapsed shows the top slice plus the active choice so the current
  // filter never disappears.
  let shown = sorted;
  if (!expanded && sorted.length > COLLAPSED_LIMIT) {
    shown = sorted.slice(0, COLLAPSED_LIMIT);
    const active = sorted.find((i) => i.active);
    if (active && !shown.includes(active)) shown = [active, ...shown];
  }
  const hiddenCount = sorted.length - shown.length;

  return (
    <div className="mt-12 first:mt-0">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-navy-950/10 pb-4">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex flex-1 items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark sm:pointer-events-none sm:flex-none"
          >
            <span className="eyebrow">{heading}</span>
            <span className="inline-flex items-center gap-1.5 sm:hidden">
              <span className="figure text-[12px] text-ink/45">{fmt(items.length)}</span>
              <ChevronDown
                aria-hidden
                className={
                  "h-4 w-4 text-ink/50 transition-transform duration-200 " +
                  (open ? "rotate-180" : "")
                }
              />
            </span>
          </button>
        ) : (
          <p className="eyebrow">{heading}</p>
        )}
      </div>

      <div className={"mt-5 flex-wrap gap-2 " + (folded ? "hidden sm:flex" : "flex")}>
        {shown.map((i) => (
          <button
            key={i.value}
            type="button"
            aria-pressed={i.active}
            onClick={() => onPick(i.value, Boolean(i.active))}
            className={
              "inline-flex min-h-9 items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark focus-visible:ring-offset-2 focus-visible:ring-offset-porcelain " +
              (i.active
                ? "bg-navy-950 text-cream ring-1 ring-navy-950"
                : "bg-white text-navy-950 ring-1 ring-navy-950/[0.12] hover:ring-gold-dark")
            }
          >
            <span className="max-w-[16rem] truncate">{i.label}</span>
            <span
              className={
                "figure text-[11px] " + (i.active ? "text-cream/70" : "text-ink/45")
              }
            >
              {fmt(i.count)}
            </span>
          </button>
        ))}

        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-flex min-h-9 items-center rounded-full px-3.5 py-1.5 text-[13px] font-semibold text-gold-deep ring-1 ring-dashed ring-gold-deep/50 transition-colors hover:bg-gold/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark"
          >
            Show all {fmt(sorted.length)}
          </button>
        )}
      </div>
    </div>
  );
}
