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

import { useParams, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
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
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/districts/${districtId}/dashboard`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">District Report</h2>
            <p className="text-muted-foreground text-base">Consolidated report across all clubs</p>
          </div>
        </div>

        <DistrictReportContent districtId={districtId} initialYearId={urlYearId} />
      </div>
    </ProtectedRoute>
  );
}
