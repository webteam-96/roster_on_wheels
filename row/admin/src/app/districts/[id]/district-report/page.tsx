"use client";

/**
 * District Report (standalone page). All the content — Summary cards,
 * per-section Excel exports, Photos hyperlink column on service-module
 * tables — lives inside <DistrictReportContent />. The same component is
 * also embedded in /district-admin-dashboard/egovernance Reports sub-tab.
 *
 * Only the wrapping ProtectedRoute, header strip (back arrow + title), and
 * URL ?yearId= forwarding stay here.
 */

import { PageHeader } from "@/components/row/AppKit";
import { useParams, useSearchParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import DistrictReportContent from "@/components/dashboard/DistrictReportContent";

export default function DistrictReportPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const districtId = Number(params.id);
  const urlYearIdRaw = searchParams.get("yearId");
  const urlYearId = urlYearIdRaw ? Number(urlYearIdRaw) : undefined;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <PageHeader title="District Report" description="Consolidated report across all clubs" back={`/districts/${districtId}/dashboard`} />

        <DistrictReportContent districtId={districtId} initialYearId={urlYearId} />
      </div>
    </ProtectedRoute>
  );
}
