"use client";

import { useAuth } from "@/contexts/AuthContext";
import EmailLogPanel from "@/components/logs/EmailLogPanel";

export default function DistrictEmailLogPage() {
  const { selectedDistrictId } = useAuth();
  if (!selectedDistrictId) return null;
  return <EmailLogPanel base={`district/${selectedDistrictId}`} backHref="/district-admin-dashboard/egovernance?tab=reports" />;
}
