"use client";

/** Club Admin Dashboard: email settings (N5 Communication). Off until Settings > Features turns on "communication". */

import ProtectedRoute from "@/components/ProtectedRoute";
import CommsSettings from "@/components/comms/CommsSettings";
import { useAuth } from "@/contexts/AuthContext";

export default function ClubCommsSettingsPage() {
  const { selectedClubId } = useAuth();
  if (!selectedClubId) return null;
  return (
    <ProtectedRoute>
      <CommsSettings scope="clubs" id={selectedClubId} />
    </ProtectedRoute>
  );
}
