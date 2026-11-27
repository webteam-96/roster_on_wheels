"use client";

import { useEffect, useState } from "react";
import { type SampleProject } from "@/components/pages/projects/shared";
import { getOverview, statsAvailable, type Overview } from "@/lib/projectStats";
import { SampleHub } from "./SampleHub";
import { LiveHub } from "./LiveHub";

/* ——— Entry point: probe the live stats API once, then pick the experience.
       While probing (and when the probe fails) the bundled sample renders,
       so there is never a flash of empty UI. ——— */

/** Last overview the stats API returned, kept in localStorage so a repeat
 *  visitor goes STRAIGHT to the live hub instead of watching the bundled
 *  fallback while a cold probe takes seconds — the probe refreshes it in the
 *  background. */
const OVERVIEW_CACHE_KEY = "rotary-project-stats-overview-v1";

export function ProjectsHub({
  projects,
  initialArea,
  initialOverview = null,
}: {
  projects: SampleProject[];
  initialArea?: string;
  /** The server's cached overview, rendered into the HTML by app/(site)/projects/page.tsx.
   *  When present the live hub is what paints FIRST — no probe, no sample-hub swap. Null
   *  means the snapshot was cold, and the client-probe path below still covers it. */
  initialOverview?: Overview | null;
}) {
  const [overview, setOverview] = useState<Overview | null>(initialOverview);
  const [live, setLive] = useState<boolean | null>(initialOverview ? true : null);

  useEffect(() => {
    // Read the cache here, not in the state initializer — the server render
    // has no localStorage, and diverging on hydration would be a mismatch.
    // Skipped entirely when the server already handed us an overview: this
    // per-browser copy is older and narrower than the shared snapshot, and
    // letting it overwrite the SSR value would be a step backwards.
    if (!initialOverview) {
      try {
        const cached = window.localStorage.getItem(OVERVIEW_CACHE_KEY);
        if (cached) {
          setOverview(JSON.parse(cached) as Overview);
          setLive(true);
        }
      } catch {
        /* corrupt/blocked storage — fall through to the probe */
      }
    }

    let cancelled = false;
    statsAvailable()
      .then((ok) => (ok ? getOverview() : null))
      .then((ov) => {
        if (cancelled) return;
        if (ov) {
          setOverview(ov);
          setLive(true);
          try {
            window.localStorage.setItem(OVERVIEW_CACHE_KEY, JSON.stringify(ov));
          } catch {
            /* private mode / quota — cache is best-effort */
          }
        } else {
          // Probe failed. Only fall back if there's no cached truth to stand
          // on — flipping a working live hub back to the sample would discard
          // the user's filters for a transient error.
          setLive((prev) => prev ?? false);
        }
      });
    return () => {
      cancelled = true;
    };
    // Mount-only. initialOverview is read here but must NOT be a dep: a fresh object
    // arrives from the server on every navigation, which would re-arm this each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (live && overview) return <LiveHub overview={overview} initialArea={initialArea} />;
  return <SampleHub projects={projects} initialArea={initialArea} />;
}
