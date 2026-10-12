"use client";

import { useParams, useSearchParams } from "next/navigation";
import PphAttendeesManager from "@/components/pph/PphAttendeesManager";

export default function ClubPphAttendancePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const campId = Number(params.campId);
  // ?returnTo= (e.g. the e-Gov PPH Camp tab) drives the Back button; falls back to the camp list.
  const returnTo = searchParams.get("returnTo");
  return (
    <PphAttendeesManager
      scope="club"
      scopeId={clubId}
      campId={campId}
      backHref={returnTo ? decodeURIComponent(returnTo) : undefined}
    />
  );
}
