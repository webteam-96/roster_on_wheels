"use client";

/**
 * Club PPH Camp V2 — Attendance.
 *
 * Same attendee CRUD as v1 (renders the shared PphAttendeesManager, so add /
 * edit / delete of attendees and readings are identical), but with the V2 chrome
 * — ClubAdminShell — so it matches the rest of the V2 camp module instead of
 * dropping the user onto the bare v1 design. The Back button honours ?returnTo
 * (falls back to the v2 camp listing).
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 */

import { useParams, useSearchParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import PphAttendeesManager from "@/components/pph/PphAttendeesManager";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

export default function ClubPphAttendanceV2Page() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const campId = Number(params.campId);

  // Back → ?returnTo when present, else the v2 camp listing.
  const returnTo = searchParams.get("returnTo");
  const backHref = returnTo
    ? decodeURIComponent(returnTo)
    : `/clubs/${clubId}/pph-camps/v2`;

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="PPH Camp Attendance"
        pageSubtitle="Polio Plus Heart camps"
        activeNavHref="/club-admin-dashboard/foundation"
      >
        <PphAttendeesManager scope="club" scopeId={clubId} campId={campId} backHref={backHref} variant="v2" />
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
