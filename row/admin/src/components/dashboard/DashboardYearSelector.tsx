"use client";

/**
 * DashboardYearSelector
 * --------------------------------------------------------------------------
 * Global Rotary-year picker for the Club Admin Dashboard topbar.
 *
 * Source of truth = URL search param `?yearId=N`. The picker reads it, the
 * dashboard pages read it, the cache provider reads it. When the user picks
 * a year, we router.replace() the new URL — all pages re-render, the cache
 * provider's key changes, and every tab refetches.
 *
 * Why URL param (not React context):
 *   - V2 module pages (/clubs/[id]/attendance/v2, /citation/v2, etc.) live
 *     under a DIFFERENT layout and can't share a dashboard-scoped context.
 *     URL params let them pick up the same yearId by inheriting it through
 *     the link from the dashboard.
 *   - Bookmark-able / share-able year-scoped views come for free.
 *
 * Option list = years where THIS club actually has data, per
 *   /api/club-admin-dashboard/available-years.
 * Default selection = the response's currentYearId (which is the
 *   `IsCurrent=1` row in rotary_year_master).
 */

import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChevronDown, Calendar } from "@/components/icons";
import { useAuth } from "@/contexts/AuthContext";
import { getClubAdminAvailableYears } from "@/services/api";

interface YearOption {
  id: number;
  yearLabel: string;
  isCurrent: boolean;
}

export default function DashboardYearSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { selectedClubId, isAuthenticated } = useAuth();
  const [options, setOptions] = useState<YearOption[]>([]);
  const [currentYearId, setCurrentYearId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  // Fetch the available year list for the current club.
  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated) return;
    setLoading(true);
    getClubAdminAvailableYears(selectedClubId)
      .then((data) => {
        if (cancelled) return;
        setOptions(data.years || []);
        setCurrentYearId(data.currentYearId ?? null);
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
  }, [selectedClubId, isAuthenticated]);

  // Plant the current year in the URL on first mount per session.
  //   - If ?yearId= is missing → plant currentYearId.
  //   - If ?yearId= is stale (was set last session before the Rotary year rolled
  //     over on 1 July) and the user has not explicitly picked a year this session
  //     → replace it with currentYearId so the dashboard defaults to the new year.
  //   - Once the user picks a year via the selector, sessionStorage remembers that
  //     choice so their pick sticks for the rest of the session.
  useEffect(() => {
    if (loading) return;
    if (!currentYearId) return;
    const existing = searchParams.get("yearId");
    const existingId = existing ? parseInt(existing, 10) : null;
    if (existingId === currentYearId) return;
    const userPicked =
      typeof window !== "undefined" &&
      window.sessionStorage.getItem("dashboardYearPicked") === "1";
    if (existingId && userPicked) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("yearId", String(currentYearId));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [loading, currentYearId, searchParams, router, pathname]);

  // Click-outside to close.
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
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("dashboardYearPicked", "1");
    }
    const next = new URLSearchParams(searchParams.toString());
    next.set("yearId", String(id));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  // Hide entirely if there are 0 options (e.g. fetch failed) — we don't want
  // an inert disabled chip in the topbar.
  if (!loading && options.length === 0) return null;

  return (
    <div ref={popRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-sm font-medium text-slate-700 transition-colors"
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
