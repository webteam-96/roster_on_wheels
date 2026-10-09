"use client";

/**
 * District PPH Camp V2 — Attendance.
 *
 * Same attendee CRUD as v1 (renders the shared PphAttendeesManager, so add /
 * edit / delete of attendees and readings are identical), but with the V2 chrome
 * — DistrictAdminShell + the static E-Governance KPI cards + tab bar — and a
 * Back button that honours ?returnTo (falls back to the v2 camp listing).
 */

import { useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import DistrictAdminShell from "@/components/v2/DistrictAdminShell";
import DistrictEgovernanceTabBar from "@/components/dashboard/DistrictEgovernanceTabBar";
import DistrictEgovernanceKpis from "@/components/dashboard/DistrictEgovernanceKpis";
import PphAttendeesManager from "@/components/pph/PphAttendeesManager";
import { useAuth } from "@/contexts/AuthContext";

export default function DistrictPphAttendanceV2Page() {
  const params = useParams();
  const searchParams = useSearchParams();
  const districtId = Number(params.id);
  const campId = Number(params.campId);
  const { selectedDistrictId, selectScope } = useAuth();

  // Keep the shell scope-picker in sync with the URL district.
  useEffect(() => {
    if (Number.isFinite(districtId) && districtId > 0 && districtId !== selectedDistrictId) {
      selectScope({ districtId });
    }
  }, [districtId, selectedDistrictId, selectScope]);

  // Back → ?returnTo when present, else the v2 camp listing.
  const returnTo = searchParams.get("returnTo");
  const backHref = returnTo
    ? decodeURIComponent(returnTo)
    : `/districts/${districtId}/pph-camps/v2`;

  return (
    <ProtectedRoute>
      <DistrictAdminShell pageTitle="PPH Camp Attendance" activeNavHref="/district-admin-dashboard/egovernance">
        <div className="space-y-4">
          <DistrictEgovernanceKpis districtId={districtId} />
          <DistrictEgovernanceTabBar />
          <PphAttendeesManager scope="district" scopeId={districtId} campId={campId} backHref={backHref} variant="v2" />
        </div>
      </DistrictAdminShell>
    </ProtectedRoute>
  );
}
