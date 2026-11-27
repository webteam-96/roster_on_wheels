"use client";

/** Club Admin Dashboard › Business directory: approve the club's members' listings, search the district's. */

import { PageHeader } from "@/components/row/AppKit";
import BusinessDirectoryAdmin from "@/components/business-directory/BusinessDirectoryAdmin";
import { useAuth } from "@/contexts/AuthContext";

export default function ClubBusinessDirectoryPage() {
  const { selectedClubId: clubId } = useAuth();
  if (!clubId) return <p className="p-6 text-sm text-muted-foreground">Choose a club first.</p>;
  return (
    <div className="space-y-6">
      <PageHeader title="Business directory" description="Your members' businesses, listed for everyone in the district and on the club websites once you approve them." />
      <BusinessDirectoryAdmin scope="club" id={clubId} />
    </div>
  );
}
