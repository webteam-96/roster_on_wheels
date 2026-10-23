"use client";

/** District Admin Dashboard: email settings and the Governor's note (N5 Communication). Off until "communication" is on. */

import ProtectedRoute from "@/components/ProtectedRoute";
import CommsSettings from "@/components/comms/CommsSettings";
import { useAuth } from "@/contexts/AuthContext";

export default function DistrictCommsSettingsPage() {
  const { selectedDistrictId } = useAuth();
  if (!selectedDistrictId) return null;
  return (
    <ProtectedRoute>
      <CommsSettings scope="districts" id={selectedDistrictId} />
    </ProtectedRoute>
  );
}
