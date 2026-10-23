"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useFormat } from "@/hooks/useFormat";
import { asUtc } from "@/lib/planning";
import { convertTenantTrial, searchDistrictCommitteeMembers, startPlanning, startTenantTrial, type TenantSubscription } from "@/services/api";
import MemberPicker, { type MemberOption } from "./MemberPicker";
import { errorMessage, Section } from "./PlanningParts";

/** Settings > Tenants (SuperAdmin, flag planning_mode): start a district's planning with its governor-elect, and the
 *  60-day trial (converting keeps every record; the payment itself is taken outside ROW until payments exist). */
export default function TenantPlanningCard({ districtId, subscription, onChanged, onDone, onError }: {
  districtId: number;
  subscription: TenantSubscription;
  onChanged: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const fmt = useFormat();
  const [dge, setDge] = useState<MemberOption | null>(null);
  const [busy, setBusy] = useState(false);
  const search = useCallback(async (q: string): Promise<MemberOption[]> =>
    ((await searchDistrictCommitteeMembers(districtId, q)) as { memberId: number; name: string; clubName: string }[])
      .map((m) => ({ id: m.memberId, name: m.name, hint: m.clubName })), [districtId]);

  async function run(action: () => Promise<unknown>, message: string, fallback: string) {
    setBusy(true);
    try {
      await action();
      onDone(message);
      onChanged();
    } catch (err) {
      onError(errorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  const planning = subscription.state === "planning" && !!subscription.planningYearLabel;
  return (
    <Section title="Planning and trial" hint="Planning opens next year to the governor-elect, the district team and every club's president- and secretary-elect.">
      <div className="space-y-3 text-sm">
        {planning ? (
          <p>
            Planning {subscription.planningYearLabel}. Cut-over {subscription.cutoverAt ? fmt.dateTime(asUtc(subscription.cutoverAt)) : "on 1 July"}.{" "}
            <Link className="underline" href={`/planning?districtId=${districtId}`}>Open the planning workspace</Link>
          </p>
        ) : (
          <p>
            {subscription.cutoverDoneAt
              ? `Live since the cut-over on ${fmt.date(asUtc(subscription.cutoverDoneAt), "long")}. Plan the following year after 1 July.`
              : "Not planning. Choose the governor-elect, or leave it empty to use the one Rotary International holds for next year."}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="dge">{planning ? "Replace the governor-elect" : "Governor-elect"}</Label>
            <MemberPicker id="dge" search={search} value={dge} onChange={setDge} />
          </div>
          <Button disabled={busy || (planning && !dge)} onClick={() => run(() => startPlanning(districtId, dge?.id ?? null),
            planning ? "Governor-elect replaced and emailed." : "Planning started. The governor-elect has been emailed.", "Could not start planning.")}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{planning ? "Replace" : "Start planning"}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t pt-4 text-sm">
        <span>{subscription.trialEnds ? `Trial until ${fmt.date(subscription.trialEnds.slice(0, 10), "long")}.` : "Not on a trial."}</span>
        {subscription.trialEnds ? (
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => run(() => convertTenantTrial(districtId), "Trial converted to paid. Every record is kept.", "Could not convert the trial.")}>
            Convert to paid
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => run(() => startTenantTrial(districtId), "60-day trial started.", "Could not start the trial.")}>
            Start a 60-day trial
          </Button>
        )}
      </div>
    </Section>
  );
}
