"use client";

import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "@/components/icons";
import { Button } from "@/components/ui/button";
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
        <div className="flex items-start gap-3">
          <Button variant="outline" size="icon" aria-label="Back" onClick={() => router.push(`/districts/${districtId}/website-data`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <PageHeader
            title="WordPress connector"
            description="Show the district's events, team, news, projects, club directory and public documents on a WordPress site with the ROW Connector plugin."
          />
        </div>
        <WordPressConnectorPanel scope="districts" scopeId={districtId} />
      </div>
    </ProtectedRoute>
  );
}
