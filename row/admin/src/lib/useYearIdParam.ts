"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getCurrentRotaryYear } from "@/services/api";

// The ?yearId= of a year-table record page. A bookmarked link without it opens the current Rotary year (what the
// list page shows first). 0 while the current year is being looked up.
export function useYearIdParam(): number {
  const urlYearId = Number(useSearchParams().get("yearId")) || 0;
  const [currentId, setCurrentId] = useState(0);
  useEffect(() => {
    if (!urlYearId) getCurrentRotaryYear().then((y) => setCurrentId(y.id)).catch(() => {});
  }, [urlYearId]);
  return urlYearId || currentId;
}
