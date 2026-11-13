"use client";

/**
 * The current Rotary year's id.
 *
 * Needed by pages whose data carries no year of its own (announcements,
 * documents, upcoming events, club website…). Editing those requires
 * CURRENT-year admin rights, which is the rule AdminYearGuard.ClubYearlessAsync
 * applies on the server — so the page needs to know which year that is.
 *
 * Returns `undefined` while loading and if the call fails. Callers pass that
 * straight to canEditYearless, which treats an unknown year as "not editable"
 * for button-hiding purposes — the server is the real check either way, so a
 * momentarily hidden button is safer than a momentarily offered one.
 */

import { useEffect, useState } from "react";
import { getRotaryYears } from "@/services/api";

let cached: number | undefined;

export function useCurrentRotaryYear(): number | undefined {
  const [yearId, setYearId] = useState<number | undefined>(cached);

  useEffect(() => {
    if (cached !== undefined) return;
    let cancelled = false;
    getRotaryYears()
      .then((years) => {
        const current = years.find((y) => y.isCurrent);
        if (!current || cancelled) return;
        cached = current.id;          // module-level: every page asks the same question
        setYearId(current.id);
      })
      .catch(() => {/* leave undefined — the server still enforces */});
    return () => { cancelled = true; };
  }, []);

  return yearId;
}
