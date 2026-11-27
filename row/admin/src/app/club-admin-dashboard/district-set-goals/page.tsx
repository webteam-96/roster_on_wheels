"use client";

// District Set Goals - Club Admin (user 2026-11-17): the goals the District set for every club; the club answers.
// Two tabs (user 2026-11-19): Overview (default, the DG's design for this club) + Add Goals & Manual Entry (the club's page).

import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import ClubDsgTabs from "@/components/goal-flow/ClubDsgTabs";

export default function ClubDistrictSetGoalsPage() {
  const { selectedClubId } = useAuth();
  const sp = useSearchParams();
  const yearId = sp.get("yearId") ? Number(sp.get("yearId")) : null;
  if (!selectedClubId) return <p className="p-6 text-sm text-slate-500">Select a club.</p>;
  return <ClubDsgTabs clubId={selectedClubId} yearId={yearId} />;
}
