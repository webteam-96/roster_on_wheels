"use client";

import { useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import WebsiteLanguagesEditor from "@/components/WebsiteLanguagesEditor";

// District Admin dashboard > My District Website > Languages (flag website_languages).
export default function MyDistrictWebsiteLanguagesPage() {
  const { selectedDistrictId } = useAuth();
  if (!selectedDistrictId) return null;
  return (
    <ProtectedRoute>
      <WebsiteLanguagesEditor scope="districts" ownerId={selectedDistrictId} fallbackBack="/district-admin-dashboard/my-district-website" />
    </ProtectedRoute>
  );
}
