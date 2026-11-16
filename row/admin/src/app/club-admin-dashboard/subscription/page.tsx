"use client";

// Club Admin Dashboard > Subscription (KIS/ROW/SUB/01 section 4.3): status, buy and renew.

import { Suspense } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useClubAdminCache } from "@/contexts/ClubAdminDashboardCacheContext";
import SubscriptionPanel from "@/components/subscriptions/SubscriptionPanel";

export default function ClubSubscriptionPage() {
  const { selectedClubId } = useAuth();
  const { overview } = useClubAdminCache();
  // Suspense: the panel reads the address (?locked=, ?checkout=).
  return <Suspense fallback={null}><SubscriptionPanel kind="club" ownerId={selectedClubId ?? overview?.club?.clubId ?? null} /></Suspense>;
}
