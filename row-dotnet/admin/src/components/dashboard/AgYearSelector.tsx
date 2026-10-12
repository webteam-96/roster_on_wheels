"use client";

/**
 * AgYearSelector
 * --------------------------------------------------------------------------
 * Global Rotary-year picker for the AG Dashboard topbar. Mirrors
 * DashboardYearSelector (club) in behaviour — source of truth is the URL
 * `?yearId=`, so every AG page reads the same value and refetches on change.
 *
 * Option list = the years this member actually holds an AG assignment for, per
 *   /api/ag-dashboard/available-years. Not "years with data", not the district's
 *   years — an AG appointed for one year only ever sees that year.
 *
 * One year   -> rendered DISABLED: it still shows which year you're viewing, but
 *               there is nothing to switch to.
 * Two+ years -> normal picker.
 *
 * Refetches on selectedDistrictId so a multi-district AG switching district
 * gets that district's year list.
 */

import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChevronDown, Calendar } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getAgAvailableYears } from "@/services/api";

interface YearOption {
  id: number;
  yearLabel: string;
  isCurrent: boolean;
}

export default function AgYearSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { selectedDistrictId, isAuthenticated } = useAuth();
  const [options, setOptions] = useState<YearOption[]>([]);
  const [currentYearId, setCurrentYearId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated) return;
    setLoading(true);
    getAgAvailableYears(selectedDistrictId)
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
  }, [selectedDistrictId, isAuthenticated]);

  // Plant the current year in the URL on first mount per session; leave an
  // explicit user pick alone (same rule as the club selector).
  useEffect(() => {
    if (loading) return;
    if (!currentYearId) return;
    const existing = searchParams.get("yearId");
    const existingId = existing ? parseInt(existing, 10) : null;
    if (existingId === currentYearId) return;
    const userPicked =
      typeof window !== "undefined" &&
      window.sessionStorage.getItem("agDashboardYearPicked") === "1";
    if (existingId && userPicked) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("yearId", String(currentYearId));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [loading, currentYearId, searchParams, router, pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
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
      window.sessionStorage.setItem("agDashboardYearPicked", "1");
    }
    const next = new URLSearchParams(searchParams.toString());
    next.set("yearId", String(id));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  if (!loading && options.length === 0) return null;

  // An AG assigned for a single year has nothing to switch to — show the year so they
  // know what they're looking at, but make it inert rather than opening a 1-item menu.
  const locked = options.length <= 1;

  return (
    <div ref={popRef} className="relative">
      <button
        type="button"
        disabled={locked}
        onClick={() => { if (!locked) setOpen((o) => !o); }}
        className={`inline-flex items-center gap-2 h-9 px-3 rounded-md border border-slate-200 text-sm font-medium transition-colors ${
          locked
            ? "bg-slate-50 text-slate-500 cursor-default"
            : "bg-white hover:bg-slate-50 text-slate-700"
        }`}
        title={locked ? `Rotary Year ${labelText}` : "Rotary Year"}
      >
        <Calendar className="h-4 w-4 text-slate-400" />
        <span>{labelText}</span>
        {!locked && (
          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        )}
      </button>
      {open && !locked && (
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
