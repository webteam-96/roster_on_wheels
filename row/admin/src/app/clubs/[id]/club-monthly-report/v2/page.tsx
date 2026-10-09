"use client";

import ProtectedRoute from "@/components/ProtectedRoute";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { ClubMonthlyReportV2View } from "./view";

// Route entrypoint — thin wrapper (see ./view for the actual UI). ClubMonthlyReportV2View
// is also imported by the Club Admin E-Governance page to render this module inline.
export default function ClubMonthlyReportV2LandingPage() {
  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Club Monthly Report"
        pageSubtitle="Year and month overview"
        activeNavHref="/club-admin-dashboard/e-governance"
      >
        <ClubMonthlyReportV2View />
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
