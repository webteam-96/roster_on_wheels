"use client";

// District Set Goals - District Admin (user 2026-11-17): goals for all clubs on the District Awards questions,
// clubs ranking, and the questions. Super Admin only until tested (menu item superAdminOnly).

import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import DistrictSetGoalsPanel from "@/components/goal-flow/DistrictSetGoalsPanel";

export default function DistrictSetGoalsPage() {
  const { selectedDistrictId } = useAuth();
  const sp = useSearchParams();
  const yearId = sp.get("yearId") ? Number(sp.get("yearId")) : null;
  if (!selectedDistrictId) return <p className="p-6 text-sm text-slate-500">Select a district.</p>;
  return <DistrictSetGoalsPanel districtId={selectedDistrictId} yearId={yearId} />;
}
