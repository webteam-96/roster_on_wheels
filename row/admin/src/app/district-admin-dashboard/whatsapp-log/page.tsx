"use client";

import { useAuth } from "@/contexts/AuthContext";
import WhatsAppLogPanel from "@/components/logs/WhatsAppLogPanel";

export default function DistrictWhatsAppLogPage() {
  const { selectedDistrictId } = useAuth();
  if (!selectedDistrictId) return null;
  // Locked server-side to this district; club filter lets the DA narrow by club.
  return <WhatsAppLogPanel base={`district/${selectedDistrictId}`} showClubFilter backHref="/district-admin-dashboard/egovernance?tab=reports" />;
}
