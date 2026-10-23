"use client";

/** District Admin Dashboard › Foundation designations: members of the district with designation X (build spec 3.12). */

import { useSelectedDistrict } from "@/contexts/AuthContext";
import FoundationDesignationsReport from "@/components/membership/FoundationDesignationsReport";

export default function DistrictFoundationDesignationsPage() {
  const district = useSelectedDistrict();
  if (!district) return <p className="text-sm text-slate-500">No district selected.</p>;
  return <FoundationDesignationsReport scope="districts" scopeId={district.id} />;
}
