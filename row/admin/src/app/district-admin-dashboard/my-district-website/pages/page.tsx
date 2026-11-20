"use client";

// District website: Pages and Layout (website builder). Card "pages" on My District Website.
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "@/components/icons";
import WebsiteBuilder from "@/components/website-builder/WebsiteBuilder";

export default function DistrictWebsitePagesPage() {
  const { selectedDistrictId } = useAuth();
  const districtId = selectedDistrictId ?? 0;

  return (
    <div className="space-y-4">
      <Button variant="outline" size="sm" asChild>
        <Link href="/district-admin-dashboard/my-district-website"><ArrowLeft className="h-4 w-4" /> My district website</Link>
      </Button>
      {districtId > 0
        ? <WebsiteBuilder scope="districts" ownerId={districtId} />
        : <p className="text-[14px] text-[#64748B]">Pick a district first.</p>}
    </div>
  );
}
