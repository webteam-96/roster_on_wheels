"use client";

// Club Admin · Targets: the club's live target against actual for the Rotary year (feature target_dashboard).

import { useAuth } from "@/contexts/AuthContext";
import { useClubAdminCache } from "@/contexts/ClubAdminDashboardCacheContext";
import ClubTargets from "@/components/targets/ClubTargets";

export default function ClubTargetsPage() {
  const { selectedClubId } = useAuth();
  const { yearId } = useClubAdminCache();
  return <ClubTargets clubId={selectedClubId} yearId={yearId} />;
}
