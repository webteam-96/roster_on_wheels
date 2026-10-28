"use client";

// Settings > Booth sign-ups (build spec 3.1): governors-elect who signed up at /public/booth. "Mark paid" is the
// payment stub until Stripe: it creates the district tenant in planning with Club Basic for every club and starts
// planning with the governor-elect.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft } from "@/components/icons";
import { getBoothSignups, provisionBoothSignup, rejectBoothSignup, type BoothSignup } from "@/services/api";
import { useFormat } from "@/hooks/useFormat";

const STATUS: Record<BoothSignup["status"], string> = { awaiting_payment: "Waiting for payment", provisioned: "Set up", rejected: "Rejected" };

export default function BoothSignupsPage() {
  const { isSuperAdmin } = useAuth();
  const fmt = useFormat();
  const [rows, setRows] = useState<BoothSignup[] | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getBoothSignups().then(setRows).catch((e) => { setError(e?.response?.data?.message || "Could not load sign-ups."); setRows([]); });
  }, []);
  useEffect(() => { if (isSuperAdmin) load(); }, [isSuperAdmin, load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); load(); } catch (e: any) { setError(e?.response?.data?.message || "That did not work."); } finally { setBusy(false); }
  };

  if (!isSuperAdmin) {
    return <ProtectedRoute><p className="py-20 text-center">Only Super Admin can manage booth sign-ups.</p></ProtectedRoute>;
  }
  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild aria-label="Back to settings"><Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Booth sign-ups</h2>
            <p className="text-base text-muted-foreground">
              Governors-elect who signed up at <Link className="underline" href="/public/booth">/public/booth</Link>. Mark a sign-up paid once the payment is taken.
            </p>
          </div>
        </div>
        {rows === null ? <TableSkeleton rows={4} /> : rows.length === 0 ? <p className="text-muted-foreground">No sign-ups yet.</p> : (
          <ul className="divide-y rounded-lg border">
            {rows.map((r) => (
              <li key={r.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span><strong>District {r.districtNumber}</strong>: {r.editionCode}{r.memberBand && `, ${r.memberBand}`}</span>
                  <span className="text-sm text-muted-foreground">{STATUS[r.status]} · {fmt.date(r.createdAt)}</span>
                </div>
                <p className="text-sm">{r.contactName} · {r.contactEmail}</p>
                {r.resultNote && <p className="text-sm text-muted-foreground">{r.resultNote}</p>}
                {r.status === "awaiting_payment" && (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input aria-label="Payment reference" maxLength={200} placeholder="Payment reference (optional)"
                      value={notes[r.id] ?? ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                    <Button disabled={busy} onClick={() => act(() => provisionBoothSignup(r.id, notes[r.id] ?? ""))}>Mark paid and set up</Button>
                    <Button variant="outline" disabled={busy} onClick={() => act(() => rejectBoothSignup(r.id))}>Reject</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
      </div>
    </ProtectedRoute>
  );
}
