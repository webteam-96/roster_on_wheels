"use client";

/**
 * TRF Contributions v2 — standalone route.
 * Thin wrapper: the actual UI lives in ./view (TrfV2View), which the Club Admin
 * Foundation page also embeds. This route wraps it in the club-admin shell.
 */

import ProtectedRoute from "@/components/ProtectedRoute";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { TrfV2View } from "./view";

export default function TrfV2Page() {
  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="TRF"
        pageSubtitle="Rotary Foundation contributions"
        activeNavHref="/club-admin-dashboard/foundation"
      >
        <TrfV2View />
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
