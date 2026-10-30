"use client";

/**
 * District Awards (V2) — standalone admin page.
 *
 * Thin wrapper: ProtectedRoute + back nav + SectionHeader, with the actual
 * 5-tab management module rendered by <DistrictAwardsModule />. The module
 * is also embedded inside /district-admin-dashboard/egovernance so the two
 * stay in lock-step.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Award } from "@/components/icons";
import ProtectedRoute from "@/components/ProtectedRoute";
import RotaryLoader from "@/components/RotaryLoader";
import SectionHeader from "@/components/dashboard/SectionHeader";
import DistrictAwardsModule from "@/components/dashboard/DistrictAwardsModule";
import { getDistrict } from "@/services/api";
import { ListPageSkeleton } from "@/components/row/AppKit";

export default function DistrictCitationV2Page() {
  const params = useParams();
  const districtId = Number(params.id);
  const [districtName, setDistrictName] = useState("");
  const [districtNumber, setDistrictNumber] = useState("");
  const [headerLoading, setHeaderLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const d = await getDistrict(districtId);
        setDistrictName(`District ${d.districtNumber}`);
        setDistrictNumber(d.districtNumber || "");
      } catch {}
      finally { setHeaderLoading(false); }
    })();
  }, [districtId]);

  if (headerLoading) {
    return <ProtectedRoute><div className="flex justify-center py-20"><ListPageSkeleton /></div></ProtectedRoute>;
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href={`/districts/${districtId}/dashboard`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
            aria-label="Back"
          >
            <ArrowLeft size={16} />
          </Link>
          <SectionHeader
            title={districtName ? `${districtName} · District Awards` : "District Awards"}
            subtitle={`Manage award criteria and view club points${districtNumber ? ` · District ${districtNumber}` : ""}`}
            icon={Award}
          />
        </div>
        <DistrictAwardsModule districtId={districtId} />
      </div>
    </ProtectedRoute>
  );
}
