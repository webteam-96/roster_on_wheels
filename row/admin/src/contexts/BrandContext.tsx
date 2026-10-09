"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getPublicBrand } from "@/services/api";
import { Brand, DEFAULT_BRAND, isFeatureOn, mergeBrand, setActiveBrand } from "@/lib/brand";

const STORAGE_KEY = "brand_v1";

const BrandContext = createContext<Brand>(DEFAULT_BRAND);

function readCached(): Brand | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? mergeBrand(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/**
 * Renders children at once with the defaults (or this session's cached brand),
 * then swaps in the instance brand when /api/public/brand answers. Fetched once
 * per browser session. A failed fetch keeps the defaults, which are RIZones.
 */
export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [brand, setBrand] = useState<Brand>(DEFAULT_BRAND);

  useEffect(() => {
    const cached = readCached();
    if (cached) {
      setBrand(cached);
      return;
    }
    let cancelled = false;
    getPublicBrand()
      .then((data) => {
        if (cancelled) return;
        const merged = mergeBrand(data);
        setBrand(merged);
        try {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        } catch {
          // storage unavailable (private mode): fetch again next load
        }
      })
      .catch(() => {
        // endpoint absent or unreachable: keep the defaults
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setActiveBrand(brand);
  }, [brand]);

  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useBrand(): Brand {
  return useContext(BrandContext);
}

export function useFeature(key: string): boolean {
  return isFeatureOn(useBrand(), key);
}
