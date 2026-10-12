"use client";

import { useAuth } from "@/contexts/AuthContext";
import EmailLogPanel from "@/components/logs/EmailLogPanel";

export default function ClubEmailLogPage() {
  const { selectedClubId } = useAuth();
  if (!selectedClubId) return null;
  return <EmailLogPanel base={`club/${selectedClubId}`} backHref="/club-admin-dashboard/e-governance?tab=reports" />;
}
