"use client";

import { useParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import WebsiteLanguagesEditor from "@/components/WebsiteLanguagesEditor";

// District website languages from the district's Website Data (flag website_languages).
export default function DistrictWebsiteLanguagesPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <ProtectedRoute>
      <WebsiteLanguagesEditor scope="districts" ownerId={Number(id)} fallbackBack={`/districts/${id}/website-data`} />
    </ProtectedRoute>
  );
}
