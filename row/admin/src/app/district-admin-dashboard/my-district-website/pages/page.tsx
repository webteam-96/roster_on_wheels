"use client";

// District website: Pages and Layout (website builder). Card "pages" on My District Website.
import { useAuth } from "@/contexts/AuthContext";
import WebsiteBuilder from "@/components/website-builder/WebsiteBuilder";

export default function DistrictWebsitePagesPage() {
  const { selectedDistrictId } = useAuth();
  const districtId = selectedDistrictId ?? 0;

  return (
    <div className="space-y-4">
      {districtId > 0
        ? <WebsiteBuilder scope="districts" ownerId={districtId} back="/district-admin-dashboard/my-district-website" />
        : <p className="text-[14px] text-muted-foreground">Pick a district first.</p>}
    </div>
  );
}
