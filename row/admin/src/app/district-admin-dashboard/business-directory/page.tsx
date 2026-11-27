"use client";

/** District Admin Dashboard › Business directory: approve listings from any club of the district, search the directory. */

import { PageHeader } from "@/components/row/AppKit";
import BusinessDirectoryAdmin from "@/components/business-directory/BusinessDirectoryAdmin";
import { useAuth } from "@/contexts/AuthContext";

export default function DistrictBusinessDirectoryPage() {
  const { selectedDistrictId: districtId } = useAuth();
  if (!districtId) return <p className="p-6 text-sm text-muted-foreground">Choose a district first.</p>;
  return (
    <div className="space-y-6">
      <PageHeader title="Business directory" description="Members' businesses from every club, listed for the district and on the club websites once approved." />
      <BusinessDirectoryAdmin scope="district" id={districtId} />
    </div>
  );
}
