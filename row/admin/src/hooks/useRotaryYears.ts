"use client";

/**
 * Every Rotary year, with its start and end dates.
 *
 * Needed wherever a record's year is implied by a DATE rather than stored as an
 * id — newsletters are filed into the year their publish date falls in, and the
 * server resolves it exactly this way (AdminYearGuard.ClubYearForDateAsync). The
 * client has to agree, or the buttons and the server will disagree.
 *
 * The list is fetched once per page load and shared: every caller asks the same
 * question, and the years do not change while someone is on a screen.
 */

import { useEffect, useState } from "react";
import { getRotaryYears } from "@/services/api";
import type { RotaryYear } from "@/types/rotaryYear";

let cached: RotaryYear[] | null = null;
let inflight: Promise<RotaryYear[]> | null = null;

export function useRotaryYears(): { years: RotaryYear[]; currentYearId: number | undefined } {
  const [years, setYears] = useState<RotaryYear[]>(cached ?? []);

  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    // One request even when several sections mount at once.
    inflight ??= getRotaryYears().then((y) => { cached = y; return y; });
    inflight
      .then((y) => { if (!cancelled) setYears(y); })
      .catch(() => { inflight = null; /* leave empty — the server still enforces */ });
    return () => { cancelled = true; };
  }, []);

  return { years, currentYearId: years.find((y) => y.isCurrent)?.id };
}
