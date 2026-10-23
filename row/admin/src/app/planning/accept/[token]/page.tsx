"use client";

/**
 * Accept a planning invitation (build spec 3.1, flagged module "planning_mode"). Public: the link from the
 * invitation email. Accepting needs a click, so mail scanners that open links do not accept for the member.
 */

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { acceptPlanningInvite } from "@/services/api";
import { ROLE_NAMES, type AcceptedInvite } from "@/types/planning";

export default function AcceptPlanningInvitePage() {
  const { token } = useParams<{ token: string }>();
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<AcceptedInvite | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      setRole(await acceptPlanningInvite(token));
    } catch (err) {
      const status = (err as { response?: { status?: number; data?: { message?: string } } })?.response;
      setError(status?.status === 404 && !status.data?.message
        ? "This invitation is not available."
        : status?.data?.message || "Could not accept the invitation. Try again in a minute.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg py-10">
      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-xl font-bold tracking-tight text-primary">Plan next year</h2>
          {role ? (
            <>
              <p className="text-sm">
                You are {ROLE_NAMES[role.role].toLowerCase()} of {role.clubName ?? `District ${role.districtNumber}`} for {role.yearLabel}.
                Sign in to open the planning workspace. If you have no password yet, use Forgot password on the sign-in page.
              </p>
              <Button asChild><Link href="/login">Sign in</Link></Button>
            </>
          ) : (
            <>
              <p className="text-sm">Your governor-elect invited you to plan your club&apos;s next Rotary year.</p>
              {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
              <Button onClick={accept} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Accept the invitation</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
