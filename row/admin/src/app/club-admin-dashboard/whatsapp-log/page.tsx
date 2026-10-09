"use client";

import { useAuth } from "@/contexts/AuthContext";
import WhatsAppLogPanel from "@/components/logs/WhatsAppLogPanel";

export default function ClubWhatsAppLogPage() {
  const { selectedClubId } = useAuth();
  if (!selectedClubId) return null;
  // Locked server-side to this club; no club filter (it's always this club).
  return <WhatsAppLogPanel base={`club/${selectedClubId}`} backHref="/club-admin-dashboard/e-governance?tab=reports" />;
}
