"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useFeatureLoadedOn } from "@/components/FeatureGate";
import { useFormat } from "@/hooks/useFormat";
import { asUtc } from "@/lib/planning";
import { getPlanningState } from "@/services/api";
import type { PlanningState } from "@/types/planning";

/**
 * Planning banner (build spec 3.1 / 3.16, flag planning_mode): on a district's or club's dashboard while the district
 * plans next year. It switches the dashboard's year to the planning year (the dashboards read ?yearId) and links to
 * the planning workspace.
 */
export default function PlanningBanner({ districtId, clubId }: { districtId?: number | null; clubId?: number | null }) {
  const on = useFeatureLoadedOn("planning_mode");
  const fmt = useFormat();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [s, setS] = useState<PlanningState | null>(null);

  useEffect(() => {
    if (!on || (!districtId && !clubId)) { setS(null); return; }
    let cancelled = false;
    getPlanningState(districtId ? { districtId } : { clubId: clubId ?? undefined })
      .then((r) => { if (!cancelled) setS(r); })
      .catch(() => { if (!cancelled) setS(null); });
    return () => { cancelled = true; };
  }, [on, districtId, clubId]);

  if (!s || s.state !== "planning" || !s.planningYearId) return null;
  const onPlanningYear = searchParams.get("yearId") === String(s.planningYearId);

  function workOnPlanningYear() {
    // the club year picker keeps a year the user picked this session
    try { window.sessionStorage.setItem("dashboardYearPicked", "1"); } catch { /* storage blocked: the pick lasts until reload */ }
    const next = new URLSearchParams(searchParams.toString());
    next.set("yearId", String(s!.planningYearId));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted px-4 py-3 text-sm">
      <p>
        <span className="font-semibold">Planning {s.planningYearLabel}.</span>{" "}
        {s.readOnlyYearLabel ? `${s.readOnlyYearLabel} is read-only for this district until the cut-over` : "The current year is read-only until the cut-over"}
        {s.cutoverAt ? ` on ${fmt.date(asUtc(s.cutoverAt), "long")}.` : "."}
      </p>
      <div className="flex flex-wrap gap-2">
        {!onPlanningYear && (
          <Button size="sm" variant="outline" onClick={workOnPlanningYear}>Work on {s.planningYearLabel}</Button>
        )}
        <Button size="sm" asChild>
          <Link href={districtId ? `/planning?districtId=${s.districtId}` : "/planning"}>Planning workspace</Link>
        </Button>
      </div>
    </div>
  );
}
