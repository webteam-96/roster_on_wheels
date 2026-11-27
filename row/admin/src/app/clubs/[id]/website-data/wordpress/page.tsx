"use client";

import { useParams, useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import { PageHeader } from "@/components/row/AppKit";
import WordPressConnectorPanel from "@/components/website/WordPressConnectorPanel";

export default function ClubWordPressConnectorPage() {
  const params = useParams();
  const router = useRouter();
  const clubId = Number(params.id);

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <PageHeader
          title="WordPress connector"
          description="Show this club's events, officers, news, projects, directory and public documents on a WordPress site with the ROW Connector plugin."
          back={() => router.push(`/clubs/${clubId}/website-data`)}
        />
        <WordPressConnectorPanel scope="clubs" scopeId={clubId} />
      </div>
    </ProtectedRoute>
  );
}
