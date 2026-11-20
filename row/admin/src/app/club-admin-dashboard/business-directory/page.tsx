"use client";

/** Club Admin Dashboard › Business directory: approve the club's members' listings, search the district's. */

import BusinessDirectoryAdmin from "@/components/business-directory/BusinessDirectoryAdmin";
import { useAuth } from "@/contexts/AuthContext";

export default function ClubBusinessDirectoryPage() {
  const { selectedClubId: clubId } = useAuth();
  if (!clubId) return <p className="p-6 text-sm text-muted-foreground">Choose a club first.</p>;
  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-primary">Business directory</h2>
        <p className="text-base text-muted-foreground">
          Your members' businesses, listed for everyone in the district and on the club websites once you approve them.
        </p>
      </div>
      <BusinessDirectoryAdmin scope="club" id={clubId} />
    </div>
  );
}
