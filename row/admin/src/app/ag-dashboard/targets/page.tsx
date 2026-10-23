"use client";

// AG dashboard · Targets: live target against actual for this Assistant Governor's clubs (feature target_dashboard).
// The API limits the district view to the clubs assigned to the AG for the selected Rotary year.

import { useSelectedDistrict } from "@/contexts/AuthContext";
import { useAgYearId } from "@/hooks/useAgYearId";
import TargetDashboard from "@/components/targets/TargetDashboard";

export default function AgTargetsPage() {
  const district = useSelectedDistrict();
  const yearId = useAgYearId();
  return <TargetDashboard districtId={district?.id ?? null} yearId={yearId} clubPageHref={(id) => `/ag-dashboard/clubs/${id}`} />;
}
