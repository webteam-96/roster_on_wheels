"use client";

/** Club Admin Dashboard › Member map: members who opted in (approximate area only) and the club's meeting place. */

import MemberMapView from "@/components/member-map/MemberMapView";
import { useAuth } from "@/contexts/AuthContext";

export default function ClubMemberMapPage() {
  const { selectedClubId: clubId } = useAuth();
  if (!clubId) return <p className="p-6 text-sm text-muted-foreground">Choose a club first.</p>;
  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-primary">Member map</h2>
        <p className="text-base text-muted-foreground">
          Where your members are, by area. Members choose in the app whether to appear, and only their approximate area
          is kept.
        </p>
      </div>
      <MemberMapView scope="club" id={clubId} />
    </div>
  );
}
