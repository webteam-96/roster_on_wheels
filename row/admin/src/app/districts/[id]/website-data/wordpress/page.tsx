"use client";

import { useParams, useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import { PageHeader } from "@/components/row/AppKit";
import WordPressConnectorPanel from "@/components/website/WordPressConnectorPanel";

export default function DistrictWordPressConnectorPage() {
  const params = useParams();
  const router = useRouter();
  const districtId = Number(params.id);

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <PageHeader
          title="WordPress connector"
          description="Show the district's events, team, news, projects, club directory and public documents on a WordPress site with the ROW Connector plugin."
          back={() => router.push(`/districts/${districtId}/website-data`)}
        />
        <WordPressConnectorPanel scope="districts" scopeId={districtId} />
      </div>
    </ProtectedRoute>
  );
}
