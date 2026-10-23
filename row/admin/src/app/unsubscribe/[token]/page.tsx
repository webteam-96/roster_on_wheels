"use client";

/**
 * Public unsubscribe page (N5 Communication). Opened from the link at the bottom of every mass email; the signed token
 * in the URL names the member, so no login is needed. Nothing changes until the member presses a button (mail
 * scanners that open links must not unsubscribe anyone).
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { getUnsubscribe, setUnsubscribe, type UnsubscribeInfo } from "@/services/api";

export default function UnsubscribePage() {
  const token = String(useParams().token ?? "");
  const [info, setInfo] = useState<UnsubscribeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    getUnsubscribe(token).then(setInfo).catch(() => setError("This link is not valid. Use the link in your most recent email."));
  }, [token]);

  const change = async (subscribe: boolean) => {
    setBusy(true);
    try {
      setInfo(await setUnsubscribe(token, subscribe));
      setDone(subscribe ? "You will receive club and district emails again." : "You are unsubscribed. Club and district mass emails will stop.");
    } catch {
      setError("That did not work. Please try again in a minute.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-background p-6">
        <h1 className="text-xl font-semibold text-slate-800">Email preferences</h1>
        {error ? (
          <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>
        ) : !info ? (
          <div className="mt-4 space-y-3" aria-busy="true">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-9 w-40" />
          </div>
        ) : (
          <>
            <p className="mt-3 text-sm text-slate-600">
              {info.subscribed
                ? <>Mass emails from your club and district go to <strong>{info.maskedEmail}</strong>.</>
                : <>Mass emails from your club and district no longer go to <strong>{info.maskedEmail}</strong>.</>}
            </p>
            {done && <p role="status" className="mt-3 text-sm text-emerald-700">{done}</p>}
            <button type="button" disabled={busy} onClick={() => change(!info.subscribed)}
              className="mt-5 rounded-lg bg-azure px-4 py-2 text-sm font-semibold text-cream hover:bg-mint-ink disabled:opacity-60">
              {info.subscribed ? "Unsubscribe" : "Subscribe again"}
            </button>
            <p className="mt-4 text-xs text-slate-500">
              Messages you need as a member, such as password resets and receipts, still arrive.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
