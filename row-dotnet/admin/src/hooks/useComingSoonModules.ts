"use client";

import { useEffect, useState } from "react";
import { getModulesComingSoon } from "@/services/api";

const CACHE_KEY = "modules_coming_soon";
const CACHE_TTL_MS = 30 * 1000; // refresh every 30 seconds so SA toggles propagate quickly

interface CachedComingSoon {
  fetchedAt: number;
  byKey: Record<string, { isComingSoon: boolean; comingSoonDate: string | null }>;
}

function readCache(): CachedComingSoon | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.fetchedAt !== "number" || !parsed.byKey) return null;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed as CachedComingSoon;
  } catch {
    return null;
  }
}

function writeCache(byKey: CachedComingSoon["byKey"]) {
  if (typeof window === "undefined") return;
  try {
    const payload: CachedComingSoon = { fetchedAt: Date.now(), byKey };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota errors
  }
}

export interface ComingSoonState {
  loading: boolean;
  byKey: Record<string, { isComingSoon: boolean; comingSoonDate: string | null }>;
  /** True only when we have a definitive answer (cache hit OR fetch resolved). */
  isReady: boolean;
}

/**
 * Fetches the module-level Coming Soon list (shared API used by web + mobile)
 * and caches it in localStorage for 30 seconds so the sidebar doesn't refetch
 * on every navigation while still letting SuperAdmin Coming Soon toggles
 * propagate quickly. SuperAdmin bypass is the caller's responsibility — this
 * hook only reports raw module status.
 */
export function useComingSoonModules(): ComingSoonState {
  const cached = readCache();
  const [byKey, setByKey] = useState<ComingSoonState["byKey"]>(cached?.byKey ?? {});
  const [loading, setLoading] = useState(!cached);
  const [isReady, setIsReady] = useState(!!cached);

  useEffect(() => {
    if (cached) return; // already have fresh data
    let cancelled = false;
    setLoading(true);
    getModulesComingSoon()
      .then((list) => {
        if (cancelled) return;
        const next: ComingSoonState["byKey"] = {};
        for (const m of list ?? []) {
          if (!m?.moduleKey) continue;
          next[m.moduleKey] = {
            isComingSoon: !!m.isComingSoon,
            comingSoonDate: m.comingSoonDate ?? null,
          };
        }
        setByKey(next);
        writeCache(next);
      })
      .catch(() => {
        // Network failure — fall back to "nothing is coming soon" so sidebar
        // stays visible. Better to show too much than hide everything.
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setIsReady(true);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { loading, byKey, isReady };
}
