"use client";

// District Admin · Targets: live target against actual per club and for the district (feature target_dashboard).

import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import TargetDashboard from "@/components/targets/TargetDashboard";
import { DistrictTargetProposals } from "@/components/targets/TargetProposals";

export default function DistrictTargetsPage() {
  const { selectedDistrictId } = useAuth();
  const yearId = Number(useSearchParams()?.get("yearId")) || null;
  return (
    <>
      <TargetDashboard districtId={selectedDistrictId} yearId={yearId} clubPageHref={(id) => `/district-admin-dashboard/clubs/${id}`} />
      <DistrictTargetProposals districtId={selectedDistrictId} yearId={yearId} />
    </>
  );
}
