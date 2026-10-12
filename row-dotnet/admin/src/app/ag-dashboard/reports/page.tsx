"use client";

/**
 * AG Dashboard · Reports
 * --------------------------------------------------------------------------
 * A replica of the District Admin report, scoped to this AG.
 *
 * Reuses DistrictReportContent rather than forking it, so the two never drift.
 * The scoping is done with two props:
 *   agMemberId  → every request carries it; the backend narrows the whole report
 *                 (and the club dropdown) to the AG's clubs for that year.
 *   initialYearId → the AG's global topbar year, so only that year downloads.
 *
 * District Admin / Club Admin pass neither, so their reports are unchanged.
 */

import { Suspense } from "react";
import RotaryLoader from "@/components/RotaryLoader";
import DistrictReportContent from "@/components/dashboard/DistrictReportContent";
import { useAuth } from "@/contexts/AuthContext";
import { useAgYearId } from "@/hooks/useAgYearId";

function AgReportsInner() {
  const { user, selectedDistrictId } = useAuth();
  const yearId = useAgYearId();
  const agMemberId = user?.memberId ?? 0;

  if (!selectedDistrictId || selectedDistrictId <= 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        No district selected for your AG assignment yet.
      </div>
    );
  }
  if (!agMemberId) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Could not identify your member record.
      </div>
    );
  }

  return (
    <DistrictReportContent
      districtId={selectedDistrictId}
      initialYearId={yearId ?? undefined}
      agMemberId={agMemberId}
      // Names the downloads after the AG rather than the district — the files hold
      // their clubs only, so "District_5656_..." would misdescribe them.
      agName={user?.name ?? undefined}
    />
  );
}

export default function AgReportsPage() {
  // DistrictReportContent reads useSearchParams() internally.
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <RotaryLoader size="lg" label="Loading reports…" />
        </div>
      }
    >
      <AgReportsInner />
    </Suspense>
  );
}
