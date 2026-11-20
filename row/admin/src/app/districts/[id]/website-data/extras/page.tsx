"use client";

import { useParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import WebsiteExtrasEditor from "@/components/WebsiteExtrasEditor";

// District website extras from the district's Website Data.
export default function DistrictWebsiteExtrasPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <ProtectedRoute>
      <WebsiteExtrasEditor scope="districts" ownerId={Number(id)} fallbackBack={`/districts/${id}/website-data`} />
    </ProtectedRoute>
  );
}
