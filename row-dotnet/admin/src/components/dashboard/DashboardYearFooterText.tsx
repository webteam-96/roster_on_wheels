"use client";

/**
 * DashboardYearFooterText
 * --------------------------------------------------------------------------
 * Renders the dashboard footer's "Rotary Year YYYY-YY" label, dynamically
 * derived from the global ?yearId= URL search param. Used by all dashboards
 * (Club Admin, District Admin, AG) so the footer stays in sync with the
 * topbar's DashboardYearSelector instead of showing a hardcoded year.
 *
 * Source of truth = URL ?yearId=. Falls back to the IsCurrent year while the
 * year list is loading or if the URL param is missing.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getRotaryYears } from "@/services/api";
import type { RotaryYear } from "@/types/rotaryYear";

export default function DashboardYearFooterText() {
  const searchParams = useSearchParams();
  const [years, setYears] = useState<RotaryYear[]>([]);

  useEffect(() => {
    let cancelled = false;
    getRotaryYears()
      .then((data) => { if (!cancelled) setYears(data || []); })
      .catch(() => { /* leave empty — footer will fall back to placeholder */ });
    return () => { cancelled = true; };
  }, []);

  const urlYearStr = searchParams.get("yearId");
  const urlYearId = urlYearStr ? parseInt(urlYearStr, 10) : null;
  const match = urlYearId ? years.find((y) => y.id === urlYearId) : null;
  const current = years.find((y) => y.isCurrent);
  const label = match?.yearLabel || current?.yearLabel || "—";

  return <>Rotary Year {label}</>;
}
