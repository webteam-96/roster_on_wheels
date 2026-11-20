"use client";

/** District Admin Dashboard › Business directory: approve listings from any club of the district, search the directory. */

import BusinessDirectoryAdmin from "@/components/business-directory/BusinessDirectoryAdmin";
import { useAuth } from "@/contexts/AuthContext";

export default function DistrictBusinessDirectoryPage() {
  const { selectedDistrictId: districtId } = useAuth();
  if (!districtId) return <p className="p-6 text-sm text-muted-foreground">Choose a district first.</p>;
  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-primary">Business directory</h2>
        <p className="text-base text-muted-foreground">
          Members' businesses from every club, listed for the district and on the club websites once approved.
        </p>
      </div>
      <BusinessDirectoryAdmin scope="district" id={districtId} />
    </div>
  );
}
