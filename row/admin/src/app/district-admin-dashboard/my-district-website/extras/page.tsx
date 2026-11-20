"use client";

import { useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import WebsiteExtrasEditor from "@/components/WebsiteExtrasEditor";

// District Admin dashboard > My District Website > Website extras.
export default function MyDistrictWebsiteExtrasPage() {
  const { selectedDistrictId } = useAuth();
  if (!selectedDistrictId) return null;
  return (
    <ProtectedRoute>
      <WebsiteExtrasEditor scope="districts" ownerId={selectedDistrictId} fallbackBack="/district-admin-dashboard/my-district-website" />
    </ProtectedRoute>
  );
}
