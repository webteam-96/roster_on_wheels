"use client";

import { useClubAdminCache } from "@/contexts/ClubAdminDashboardCacheContext";
import ClubStatusChips from "./ClubStatusChips";

/** The club's status in the dashboard top bar, read from the dashboard cache. */
export default function ClubAdminTopbarStatus() {
  const { overview, website } = useClubAdminCache();
  return <ClubStatusChips emailCredits={overview?.club?.emailCreditBalance} website={website} />;
}
