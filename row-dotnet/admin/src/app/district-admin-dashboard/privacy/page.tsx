"use client";

/**
 * District Admin Dashboard › Privacy Requests: export or erase a member's data.
 * Shown when the instance sets privacy.enabled (ROW).
 */

import { useAuth } from "@/contexts/AuthContext";
import PrivacyRequestsPanel from "@/components/privacy/PrivacyRequestsPanel";

export default function DistrictPrivacyPage() {
  const { selectedDistrictId } = useAuth();
  return <PrivacyRequestsPanel districtId={selectedDistrictId ?? null} />;
}
