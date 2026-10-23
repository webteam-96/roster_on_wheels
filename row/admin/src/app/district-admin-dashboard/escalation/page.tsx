"use client";

/** District Admin Dashboard › Escalation alerts (B.1 #32): the district's rules and its alert log. Hidden while the
 *  "escalation" feature is off. */

import { useSelectedDistrict } from "@/contexts/AuthContext";
import EscalationPanel from "@/components/escalation/EscalationPanel";

export default function DistrictEscalationPage() {
  const district = useSelectedDistrict();
  if (!district) return <p className="text-sm text-slate-500">No district selected.</p>;
  return <EscalationPanel districtId={district.id} />;
}
