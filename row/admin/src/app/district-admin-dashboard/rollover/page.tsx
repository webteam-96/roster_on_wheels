"use client";

/** District Admin Dashboard › Year-end Rollover: carry the district team and committees into the next Rotary year. */

import { PageHeader } from "@/components/row/AppKit";
import RolloverPanel from "@/components/rollover/RolloverPanel";
import { useAuth } from "@/contexts/AuthContext";

export default function DistrictRolloverPage() {
  const { selectedDistrictId: districtId } = useAuth();
  if (!districtId) return <p className="p-6 text-sm text-muted-foreground">Choose a district first.</p>;
  return (
    <div className="space-y-6">
      <PageHeader title="Year-end rollover" description="Carry the district team, committees, sub-groups and the members you choose into the next Rotary year. Review every change first; each run can be undone." />
      <RolloverPanel key={districtId} scope="district" scopeId={districtId} />
    </div>
  );
}
