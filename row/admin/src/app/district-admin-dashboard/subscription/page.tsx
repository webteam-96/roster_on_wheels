"use client";

// District Admin Dashboard > Subscription (KIS/ROW/SUB/01 section 4.1): status, buy and renew, clubs to follow up.

import { Suspense } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useDistrictAdminCache } from "@/contexts/DistrictAdminDashboardCacheContext";
import SubscriptionPanel from "@/components/subscriptions/SubscriptionPanel";

export default function DistrictSubscriptionPage() {
  const { selectedDistrictId } = useAuth();
  const { overview } = useDistrictAdminCache();
  // Suspense: the panel reads the address (?locked=, ?checkout=).
  return <Suspense fallback={null}><SubscriptionPanel kind="district" ownerId={selectedDistrictId ?? overview?.district?.districtId ?? null} /></Suspense>;
}
