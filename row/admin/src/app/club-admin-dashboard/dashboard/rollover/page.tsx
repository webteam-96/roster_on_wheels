"use client";

/** Club Admin Dashboard › Year-end Rollover: carry committees and officers into the next Rotary year. */

import RolloverPanel from "@/components/rollover/RolloverPanel";
import { useAuth } from "@/contexts/AuthContext";

export default function ClubRolloverPage() {
  const { selectedClubId: clubId } = useAuth();
  if (!clubId) return <p className="p-6 text-sm text-muted-foreground">Choose a club first.</p>;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-primary">Year-end rollover</h2>
        <p className="text-base text-muted-foreground">
          Carry committees and their members into the next Rotary year, and put the outgoing president in as Immediate
          Past President. Review every change first; each run can be undone.
        </p>
      </div>
      <RolloverPanel key={clubId} scope="club" scopeId={clubId} />
    </div>
  );
}
