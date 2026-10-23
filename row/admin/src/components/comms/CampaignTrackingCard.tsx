"use client";

/**
 * Delivery, opens and clicks of one mass email, per recipient (N5 Communication, from Brevo's webhook events).
 * Renders nothing while the "communication" feature is off or the email is still a draft.
 */

import { useEffect, useState } from "react";
import { useFeatureLoadedOn } from "@/components/FeatureGate";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { getCampaignTracking, type CampaignTracking, type CommsScope } from "@/services/api";
import { deliveryLabel, rate } from "@/lib/comms";
import { card } from "./ui";

export default function CampaignTrackingCard({ scope, ownerId, emailId }: { scope: CommsScope; ownerId: number; emailId: number }) {
  const on = useFeatureLoadedOn("communication");
  const [data, setData] = useState<CampaignTracking | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!on || !ownerId || !emailId) return;
    getCampaignTracking(scope, ownerId, emailId).then(setData).catch(() => setFailed(true));
  }, [on, scope, ownerId, emailId]);

  if (!on || failed || data?.status === "Draft") return null;

  const tiles: [string, string][] = data ? [
    ["Delivered", `${data.delivered} (${rate(data.delivered, data.sent)})`],
    ["Opened", `${data.opened} (${rate(data.opened, data.sent)})`],
    ["Clicked", `${data.clicked} (${rate(data.clicked, data.sent)})`],
    ["Bounced or spam", String(data.bounced + data.complaints)],
    ["Skipped", String(data.skipped)],
  ] : [];

  return (
    <div className={card}>
      <h2 className="text-base font-semibold text-slate-800">Delivery and engagement</h2>
      <p className="mt-1 text-sm text-slate-500">
        Opens are counted when the reader&apos;s mail app loads images, so the real number is usually higher.
        Skipped members unsubscribed or have an address that bounced before.
      </p>
      {!data ? (
        <div className="mt-3"><TableSkeleton rows={3} /></div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            {tiles.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 text-lg font-semibold text-slate-800">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-3 font-medium">Member</th>
                  <th className="py-2 pr-3 font-medium">Language</th>
                  <th className="py-2 pr-3 font-medium">Result</th>
                  <th className="py-2 pr-3 text-right font-medium">Opens</th>
                  <th className="py-2 text-right font-medium">Clicks</th>
                </tr>
              </thead>
              <tbody>
                {data.recipientRows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-3">
                      <span className="text-slate-800">{r.memberName ?? "-"}</span>
                      <span className="block text-xs text-slate-500">{r.email}</span>
                    </td>
                    <td className="py-2 pr-3">{r.language ?? "-"}</td>
                    <td className="py-2 pr-3" title={r.errorMessage ?? undefined}>{deliveryLabel(r.status, r.deliveryStatus, r.openCount, r.clickCount)}</td>
                    <td className="py-2 pr-3 text-right">{r.openCount}</td>
                    <td className="py-2 text-right">{r.clickCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
