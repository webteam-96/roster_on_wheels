"use client";

import { useEffect, useState } from "react";
import { getEventTimeZone } from "@/services/api";

// One request per club / district per page load; zones change rarely.
const cache = new Map<string, Promise<string>>();

/**
 * The zone a club's or district's events are in, for fmt.eventDateTime. null until loaded (eventDateTime then uses
 * the instance zone) or when the lookup fails.
 */
export function useEventZone(scope: { clubId: number } | { districtId: number }): string | null {
  const isClub = "clubId" in scope;
  const id = isClub ? scope.clubId : scope.districtId;
  const key = `${isClub ? "c" : "d"}${id}`;
  const [zone, setZone] = useState<string | null>(null);
  useEffect(() => {
    if (!(id > 0)) return;
    let live = true;
    let p = cache.get(key);
    if (!p) {
      p = getEventTimeZone(isClub ? { clubId: id } : { districtId: id });
      cache.set(key, p);
      p.catch(() => cache.delete(key));
    }
    p.then((z) => live && setZone(z)).catch(() => {});
    return () => {
      live = false;
    };
  }, [key, id, isClub]);
  return zone;
}
