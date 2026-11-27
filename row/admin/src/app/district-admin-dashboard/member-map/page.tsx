"use client";

/** District Admin Dashboard › Member map: members of every club who opted in (approximate area only) and the clubs' meeting places. */

import { PageHeader } from "@/components/row/AppKit";
import MemberMapView from "@/components/member-map/MemberMapView";
import { useAuth } from "@/contexts/AuthContext";

export default function DistrictMemberMapPage() {
  const { selectedDistrictId: districtId } = useAuth();
  if (!districtId) return <p className="p-6 text-sm text-muted-foreground">Choose a district first.</p>;
  return (
    <div className="space-y-6">
      <PageHeader title="Member map" description="Members across the district by area, and where each club meets. Members choose in the app whether to appear, and only their approximate area is kept." />
      <MemberMapView scope="district" id={districtId} />
    </div>
  );
}
