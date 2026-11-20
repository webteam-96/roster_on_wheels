"use client";

/** District Admin Dashboard › Year-end Rollover: carry the district team and committees into the next Rotary year. */

import RolloverPanel from "@/components/rollover/RolloverPanel";
import { useAuth } from "@/contexts/AuthContext";

export default function DistrictRolloverPage() {
  const { selectedDistrictId: districtId } = useAuth();
  if (!districtId) return <p className="p-6 text-sm text-muted-foreground">Choose a district first.</p>;
  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-primary">Year-end rollover</h2>
        <p className="text-base text-muted-foreground">
          Carry the district team, committees, sub-groups and the members you choose into the next Rotary year. Review
          every change first; each run can be undone.
        </p>
      </div>
      <RolloverPanel key={districtId} scope="district" scopeId={districtId} />
    </div>
  );
}
