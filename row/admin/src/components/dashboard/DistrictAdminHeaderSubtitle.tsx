"use client";

/**
 * DistrictAdminHeaderSubtitle
 * --------------------------------------------------------------------------
 * Small reactive subtitle rendered in the DashboardShell top header for the
 * District Admin dashboard. Shows "RY YYYY-YY · District X · DG: <name>" —
 * the district number comes from the AuthContext selected district, the year
 * label comes from the URL ?yearId= (falls back to the IsCurrent year), and
 * the District Governor is resolved year-wise from /api/district-governors.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSelectedDistrict, useAuth } from "@/contexts/AuthContext";
import { getRotaryYears, getDistrictGovernors } from "@/services/api";
import type { RotaryYear } from "@/types/rotaryYear";

export default function DistrictAdminHeaderSubtitle() {
  const selectedDistrict = useSelectedDistrict();
  const { selectedDistrictId } = useAuth();
  const searchParams = useSearchParams();
  const [years, setYears] = useState<RotaryYear[]>([]);
  const [governor, setGovernor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getRotaryYears()
      .then((data) => { if (!cancelled) setYears(data || []); })
      .catch(() => { /* leave empty */ });
    return () => { cancelled = true; };
  }, []);

  const urlYearStr = searchParams.get("yearId");
  const urlYearId = urlYearStr ? parseInt(urlYearStr, 10) : null;
  const match = urlYearId ? years.find((y) => y.id === urlYearId) : null;
  const current = years.find((y) => y.isCurrent);
  const yearLabel = match?.yearLabel || current?.yearLabel || "—";
  const districtLabel = selectedDistrict?.number ?? "—";
  const resolvedYearId = match?.id ?? current?.id ?? null;

  // District Governor for THIS district + the selected Rotary year (year-wise).
  useEffect(() => {
    let cancelled = false;
    if (!selectedDistrictId || !resolvedYearId) { setGovernor(null); return; }
    getDistrictGovernors(selectedDistrictId, resolvedYearId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((list: any) => {
        if (cancelled) return;
        const dg = Array.isArray(list) ? list[0] : null;
        const name = dg ? (dg.memberName ?? dg.name ?? dg.governorName ?? dg.fullName ?? null) : null;
        setGovernor(typeof name === "string" && name.trim() ? name.trim() : null);
      })
      .catch(() => { if (!cancelled) setGovernor(null); });
    return () => { cancelled = true; };
  }, [selectedDistrictId, resolvedYearId]);

  // Order: Rotary Year first, then District number, then the DG (year-wise) as a highlighted
  // gold chip so the District Governor's name stands out in the header.
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap align-middle">
      <span>RY {yearLabel} · District {districtLabel}</span>
      {governor && (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#F7A81B] px-2 py-0.5 text-[11px] font-bold leading-none text-[#1e3a5f] shadow-sm">
          DG: {governor}
        </span>
      )}
    </span>
  );
}
