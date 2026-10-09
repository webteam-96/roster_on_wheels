"use client";

import { useSearchParams } from "next/navigation";

/**
 * The AG dashboard's global Rotary year, read from `?yearId=` — the same source
 * AgYearSelector writes to. Every AG page filters on this so a year change in the
 * topbar refetches the whole dashboard.
 *
 * Returns null until the selector has planted the year on first mount; pages pass
 * that straight through to the API, which falls back to the current year — so a
 * first paint before the param lands still shows the right data rather than nothing.
 */
export function useAgYearId(): number | null {
  const searchParams = useSearchParams();
  const raw = searchParams.get("yearId");
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
