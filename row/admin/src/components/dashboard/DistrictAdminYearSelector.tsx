"use client";

/**
 * DistrictAdminYearSelector
 * --------------------------------------------------------------------------
 * Global Rotary-year picker for the District Admin Dashboard topbar. Mirrors
 * DashboardYearSelector (club) but is scoped district-wide — it lists all
 * years in rotary_year_master since district data spans every club in the
 * district (no single-club "years with data" endpoint applies).
 *
 * Source of truth = URL ?yearId=. When the user picks a year, we
 * router.replace() the URL — the cache provider reads the new value and
 * refetches every district-admin endpoint.
 */

import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChevronDown, Calendar } from "@/components/icons";
import { useAuth } from "@/contexts/AuthContext";
import { getRotaryYears } from "@/services/api";
import type { RotaryYear } from "@/types/rotaryYear";

// In-memory session pointer for the picked Rotary year. Module-scope so it
// SURVIVES client-side route changes (the topbar stays mounted) but is RESET on
// a full page reload / relogin (the module re-evaluates). This is exactly the
// behaviour the user asked for: "navigation keeps the previously selected year;
// reload/relogin shows the current year."  Deliberately NOT sessionStorage —
// that would survive a reload.
let sessionYearId: number | null = null;
let sessionYearInitialised = false;

export default function DistrictAdminYearSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isAuthenticated } = useAuth();
  const [options, setOptions] = useState<RotaryYear[]>([]);
  const [currentYearId, setCurrentYearId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated) return;
    setLoading(true);
    getRotaryYears()
      .then((data) => {
        if (cancelled) return;
        const sorted = [...(data || [])].sort((a, b) => {
          const aTs = a.startDate ? new Date(a.startDate).getTime() : 0;
          const bTs = b.startDate ? new Date(b.startDate).getTime() : 0;
          return bTs - aTs;
        });
        setOptions(sorted);
        setCurrentYearId(sorted.find((y) => y.isCurrent)?.id ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setOptions([]);
        setCurrentYearId(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  // Keep the URL ?yearId in sync with the session's selected year.
  useEffect(() => {
    if (loading) return;
    if (!currentYearId) return;
    const existing = searchParams.get("yearId");
    const existingId = existing ? parseInt(existing, 10) : null;

    // Fresh JS load (reload / relogin): force the CURRENT year, ignoring any
    // stale ?yearId still sitting in the URL, and seed the session pointer.
    if (!sessionYearInitialised) {
      sessionYearInitialised = true;
      sessionYearId = currentYearId;
      if (existingId !== currentYearId) {
        const next = new URLSearchParams(searchParams.toString());
        next.set("yearId", String(currentYearId));
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      }
      return;
    }

    // Client-side navigation after init: if the destination URL already carries
    // a year (e.g. a link that preserved it), adopt it as the selection; if it
    // has no year, restore the session's previously-picked year.
    if (existingId) {
      sessionYearId = existingId;
      return;
    }
    const target = sessionYearId ?? currentYearId;
    const next = new URLSearchParams(searchParams.toString());
    next.set("yearId", String(target));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [loading, currentYearId, searchParams, router, pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const urlYearStr = searchParams.get("yearId");
  const urlYearId = urlYearStr ? parseInt(urlYearStr, 10) : null;
  const selectedYearId = urlYearId ?? currentYearId;
  const selected = options.find((o) => o.id === selectedYearId);
  const labelText = selected?.yearLabel ?? (loading ? "…" : "Year");

  function pick(id: number) {
    setOpen(false);
    if (id === selectedYearId) return;
    // Remember the pick in-memory so it persists across page navigation
    // (but not across a full reload — see sessionYearId note above).
    sessionYearId = id;
    sessionYearInitialised = true;
    const next = new URLSearchParams(searchParams.toString());
    next.set("yearId", String(id));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  if (!loading && options.length === 0) return null;

  return (
    <div ref={popRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 h-9 px-3 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-sm font-medium text-slate-700 transition-colors"
        title="Rotary Year"
      >
        <Calendar className="h-4 w-4 text-slate-500" />
        <span>{labelText}</span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && options.length > 0 && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] bg-white border border-slate-200 rounded-md shadow-lg py-1 max-h-72 overflow-y-auto">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => pick(o.id)}
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 flex items-center justify-between gap-3 ${
                o.id === selectedYearId ? "bg-amber-50 text-amber-900 font-medium" : "text-slate-700"
              }`}
            >
              <span>{o.yearLabel}</span>
              {o.isCurrent && <span className="text-[10px] text-emerald-600 font-semibold uppercase">Current</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
