"use client";

/** Club Admin Dashboard › Member map: members who opted in (approximate area only) and the club's meeting place. */

import { PageHeader } from "@/components/row/AppKit";
import MemberMapView from "@/components/member-map/MemberMapView";
import { useAuth } from "@/contexts/AuthContext";

export default function ClubMemberMapPage() {
  const { selectedClubId: clubId } = useAuth();
  if (!clubId) return <p className="p-6 text-sm text-muted-foreground">Choose a club first.</p>;
  return (
    <div className="space-y-6">
      <PageHeader title="Member map" description="Where your members are, by area. Members choose in the app whether to appear, and only their approximate area is kept." />
      <MemberMapView scope="club" id={clubId} />
    </div>
  );
}
