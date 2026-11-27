import { useEffect, useRef } from "react";
import { ProjectCard, fmt, type CardData, type SampleProject } from "@/components/pages/projects/shared";
import { withBase } from "@/lib/basePath";

export const PAGE_SIZE = 50;

/* Search pacing. Both exist because one project search costs the API a scan across
   ~27 year tables — seconds, not milliseconds — so the goal is to send ONE query
   per thing the user actually meant, never one per keystroke.
   ponytail: fixed numbers, tuned against the measured timings in the search effect
   below. If the listing ever gets a real index (FULLTEXT on title, or a search
   table), both can come down. */
export const SEARCH_DEBOUNCE_MS = 500;
export const SEARCH_MIN_CHARS = 3;

/** 0 = the title IS the query, 1 = it contains the query as a phrase, 2 = the rest. */
export function searchRank(query: string, title: string) {
  const q = query.trim().toLowerCase();
  const t = title.trim().toLowerCase();
  return t === q ? 0 : t.includes(q) ? 1 : 2;
}

/** The four browsable dimensions, plus "" for "no card grid open". */
export type BrowseTab = "" | "areas" | "states" | "districts" | "clubs";

/**
 * One browse dimension as a BUTTON — a pill that fills navy when its panel is
 * open, with the reachable-count as a small badge. The count is deliberately
 * quiet: it says how many choices are behind the name, which is menu
 * information, not an achievement.
 */
export function BrowseLink({
  label,
  count,
  active,
  onClick,
  dot,
}: {
  label: string;
  /** null = the list this counts hasn't answered yet. Rendered as a pulse, because
   *  "0" is a claim, and one the page kept making through every slow or failed
   *  zone-wide query. */
  count: number | null;
  active: boolean;
  onClick: () => void;
  /** Cause colour, shown only once a cause is actually chosen. */
  dot?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={active}
      onClick={onClick}
      className={
        "inline-flex min-h-10 w-full items-center justify-center gap-2.5 rounded-xl px-4 py-2 text-[14px] font-semibold tracking-[-0.005em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark focus-visible:ring-offset-2 focus-visible:ring-offset-paper sm:w-auto sm:justify-start " +
        (active
          ? "bg-navy-950 text-cream shadow-soft"
          : "bg-card text-navy-950 ring-1 ring-navy-950/[0.12] hover:ring-gold-dark")
      }
    >
      {dot && (
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
          style={{ background: dot }}
        />
      )}
      <span>{label}</span>
      <span
        className={
          "figure rounded-full px-1.5 py-0.5 text-[11px] transition-colors " +
          (active ? "bg-cream/15 text-cream" : "bg-navy-950/[0.06] text-navy-950/70")
        }
      >
        {count === null ? (
          <span className="inline-block h-2 w-4 animate-pulse rounded-full bg-current/40 align-middle" />
        ) : (
          fmt(count)
        )}
      </span>
    </button>
  );
}

/* ——— Derivation helpers ——— */

/** Unique non-empty values of a field with occurrence counts, sorted A→Z. */
export function countBy(
  list: SampleProject[],
  pick: (p: SampleProject) => string | null
): { value: string; count: number }[] {
  const map = new Map<string, number>();
  for (const p of list) {
    const v = (pick(p) ?? "").trim();
    if (!v) continue;
    map.set(v, (map.get(v) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

/* ——— Shared listing header (gold rule + H2) ——— */

export function ListingHead() {
  return (
    <div className="mt-16 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div data-animate="rule" className="rule-gold" />
        <h2
          data-animate="up"
          data-animate-duration="0.7"
          className="mt-4 font-display text-heading font-[450] tracking-[-0.02em] text-navy-950"
        >
          Find projects, your way
        </h2>
      </div>
    </div>
  );
}

/* ——— FEATURE+GRID listing ——— */

export function CardGrid({ cards }: { cards: CardData[] }) {
  return (
    <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <ProjectCard key={c.key} p={c} />
      ))}
    </div>
  );
}

/* ——— Freshness probe ———
   Asks the server "has the current rotary year moved since the cached snapshot?" once
   per visit, AFTER paint, and again whenever the tab is brought back to the front.

   It costs one ~0.3s request because it only ever looks at the current year: the
   zone-wide equivalent unions every year-partitioned table and takes 8-10 SECONDS. The
   all-years figures are derived from this one number by arithmetic on the server
   (see allYearsSummary in src/lib/projectStatsServer.ts), so nothing else is queried.

   Nobody waits on it — the page is already fully rendered from the snapshot when this
   fires. If nothing changed, and that is the normal case, it does nothing at all: no
   refetch, no re-render, no flicker. */
export const PROBE_THROTTLE_MS = 60_000;

export function useFreshnessProbe(onChanged: () => void) {
  // Held in a ref so a new closure each render can't re-arm the listeners.
  const cb = useRef(onChanged);
  cb.current = onChanged;

  useEffect(() => {
    let cancelled = false;
    let lastRun = 0;

    const probe = () => {
      const now = Date.now();
      if (now - lastRun < PROBE_THROTTLE_MS) return;
      lastRun = now;
      fetch(withBase("/site-data/projects-freshness"), { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && d?.changed) cb.current();
        })
        .catch(() => {
          /* offline or a blip — the page keeps showing cached truth */
        });
    };

    probe();
    // A tab left open for hours catches up the moment someone looks at it again —
    // native visibility events, so there is no polling timer running in the background.
    const onWake = () => {
      if (document.visibilityState === "visible") probe();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, []);
}
