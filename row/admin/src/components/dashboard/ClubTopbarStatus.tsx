"use client";

import { useEffect, useState } from "react";
import { getClubCreditBalance, getClubWebsiteStatus } from "@/services/api";
import ClubStatusChips, { type ClubWebsiteState } from "./ClubStatusChips";

/** The same status on club pages outside the dashboard, which have no dashboard cache. */
export default function ClubTopbarStatus({ clubId }: { clubId: number | null }) {
  const [credits, setCredits] = useState<number | null>(null);
  const [website, setWebsite] = useState<ClubWebsiteState | null>(null);

  useEffect(() => {
    if (!clubId) return;
    let live = true;
    getClubCreditBalance(clubId).then((b) => { if (live) setCredits(b?.emailRemaining ?? null); }).catch(() => {});
    getClubWebsiteStatus(clubId).then((w) => { if (live) setWebsite(w); }).catch(() => {});
    return () => { live = false; };
  }, [clubId]);

  return <ClubStatusChips emailCredits={credits} website={website} />;
}
