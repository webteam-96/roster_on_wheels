"use client";

import { useSearchParams } from "next/navigation";
import RotaryLoader from "@/components/RotaryLoader";
import { useClubAdminCache } from "@/contexts/ClubAdminDashboardCacheContext";
import FoundationGoalsCard from "@/components/dashboard/FoundationGoalsCard";
import { TrfV2View } from "@/app/clubs/[id]/trf/v2/view";

export default function ClubAdminFoundationPage() {
  const { foundation, overview, status } = useClubAdminCache();
  const searchParams = useSearchParams();
  const globalYearId = searchParams?.get("yearId") ? Number(searchParams.get("yearId")) : null;

  if (status === "loading" && !foundation) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" label="Loading foundation data…" />
      </div>
    );
  }
  if (status === "error" && !foundation) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Failed to load foundation.</div>;
  }
  if (!foundation) return null;
  const clubId = foundation.club.clubId ?? overview?.club.clubId ?? null;

  return (
    <div className="space-y-6">
      {/* Set Foundation Collection Goals (live editor, USD). */}
      <FoundationGoalsCard />

      {/* TRF contributions — list / add / edit / delete, embedded (same as /clubs/[id]/trf/v2).
          Add/Edit reuse the shared v2 form; returnTo routes back here after save. */}
      {clubId != null && <TrfV2View clubId={clubId} embedded yearId={globalYearId} />}
    </div>
  );
}
