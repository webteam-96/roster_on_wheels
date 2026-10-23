"use client";

/** District Admin Dashboard › Engagement: milestone settings and the district's spotlight cards (build list #26-#28). */

import { useSelectedDistrict } from "@/contexts/AuthContext";
import EngagementPanel from "@/components/engagement/EngagementPanel";

export default function DistrictEngagementPage() {
  const district = useSelectedDistrict();
  if (!district) return <p className="text-sm text-slate-500">No district selected.</p>;
  return <EngagementPanel scope="districts" scopeId={district.id} />;
}
