"use client";

/**
 * One donation campaign for its managers: progress, analytics (by day, top donors), the donor list with receipt
 * letters, the Excel export and the QR code of the public giving page.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Download, ExternalLink, FileText } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import ErrorAlert from "@/components/ErrorAlert";
import { KpiTileSkeleton, Skeleton, TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { ProgressBar, campaignStatus } from "@/components/donations/DonationCampaigns";
import { useFormat } from "@/hooks/useFormat";
import { downloadDonationReceipt, downloadDonorList, getDonationQrUrl, getDonationReport } from "@/services/api";
import type { DonationReport, DonationScope } from "@/types/donations";

type Props = { scope: DonationScope; scopeId: number; campaignId: number; basePath: string };

export default function CampaignDetail({ scope, scopeId, campaignId, basePath }: Props) {
  const fmt = useFormat();
  const [report, setReport] = useState<DonationReport | null>(null);
  const [missing, setMissing] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setReport(null);
    getDonationReport(scope, scopeId, campaignId)
      .then(setReport)
      .catch((err) => (err?.response?.status === 404 ? setMissing(true) : setError(err?.response?.data?.message || "Could not load the campaign.")));
    let url: string | null = null;
    getDonationQrUrl(scope, scopeId, campaignId).then((u) => { url = u; setQr(u); }).catch(() => setQr(null));
    return () => { if (url) window.URL.revokeObjectURL(url); };
  }, [scope, scopeId, campaignId]);

  const run = async (fn: () => Promise<void>, failure: string) => {
    try { await fn(); } catch (err: any) { setError(err?.response?.data?.message || failure); }
  };

  const copyLink = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  if (missing) return <p className="p-6 text-sm text-muted-foreground">This campaign does not exist or was deleted.</p>;

  const c = report?.campaign;
  const maxDay = Math.max(1, ...(report?.daily.map((d) => d.amount) ?? [1]));

  return (
    <div className="space-y-6 p-6">
      <Link href={basePath} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" /> All campaigns
      </Link>

      {!report || !c ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-8 w-1/2" />
          <div className="grid gap-4 sm:grid-cols-4"><KpiTileSkeleton /><KpiTileSkeleton /><KpiTileSkeleton /><KpiTileSkeleton /></div>
          <TableSkeleton rows={5} />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl space-y-1">
              <h2 className="text-2xl font-bold tracking-tight text-primary">{c.title}</h2>
              <p className="text-sm text-muted-foreground">
                {campaignStatus(c)}
                {c.startDate || c.endDate ? `, ${[c.startDate && fmt.date(c.startDate), c.endDate && fmt.date(c.endDate)].filter(Boolean).join(" to ")}` : ""}
              </p>
              {c.description && <p className="whitespace-pre-line pt-1 text-base">{c.description}</p>}
            </div>
            <Button variant="outline" className="gap-1.5" disabled={report.count === 0}
              onClick={() => run(() => downloadDonorList(scope, scopeId, c.id), "Could not export the donor list.")}>
              <Download className="h-4 w-4" /> Donor list (Excel)
            </Button>
          </div>

          <Card>
            <CardContent className="space-y-2 p-5">
              <p className="text-lg font-semibold tabular-nums">
                {fmt.money(report.total, c.currency)}
                {c.goalAmount > 0 && <span className="font-normal text-muted-foreground"> raised of {fmt.money(c.goalAmount, c.currency)} ({fmt.number(c.progress.percent)}%)</span>}
              </p>
              {c.goalAmount > 0 && <ProgressBar percent={c.progress.percent} />}
            </CardContent>
          </Card>

          <dl className="grid gap-4 sm:grid-cols-4">
            {[
              ["Donations", fmt.number(report.count)],
              ["Average gift", fmt.money(report.average, c.currency)],
              ["Unfinished checkouts", fmt.number(report.pending)],
              ["Days with gifts", fmt.number(report.daily.length)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-sm border bg-card p-4">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-xl font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardContent className="space-y-3 p-5">
                <h3 className="text-base font-semibold">Giving by day</h3>
                {report.daily.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No gifts yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {report.daily.map((d) => (
                      <li key={d.date} className="grid grid-cols-[6.5rem_1fr_7rem] items-center gap-3 text-sm">
                        <span>{fmt.date(d.date)}</span>
                        <span className="h-3 rounded-sm bg-primary/80" style={{ width: `${(d.amount / maxDay) * 100}%` }} aria-hidden="true" />
                        <span className="text-right tabular-nums">{fmt.money(d.amount, c.currency)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {report.topDonors.length > 0 && (
                  <>
                    <h3 className="pt-3 text-base font-semibold">Top donors</h3>
                    <ol className="space-y-1 text-sm">
                      {report.topDonors.map((t, i) => (
                        <li key={i} className="flex justify-between gap-3">
                          <span>{t.name}{t.gifts > 1 ? ` (${t.gifts} gifts)` : ""}</span>
                          <span className="tabular-nums">{fmt.money(t.total, c.currency)}</span>
                        </li>
                      ))}
                    </ol>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-3 p-5">
                <h3 className="text-base font-semibold">Giving page</h3>
                {qr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr} alt={`QR code for the giving page of ${c.title}`} className="h-44 w-44 border" />
                ) : (
                  <Skeleton className="h-44 w-44" />
                )}
                {c.givingUrl && (
                  <div className="flex flex-wrap gap-2">
                    {qr && (
                      <Button asChild variant="outline" size="sm" className="gap-1.5">
                        <a href={qr} download={`donate-campaign-${c.id}.png`}><Download className="h-4 w-4" /> QR code</a>
                      </Button>
                    )}
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => copyLink(c.givingUrl!)}>
                      <Copy className="h-4 w-4" /> {copied ? "Copied" : "Copy link"}
                    </Button>
                    <Button asChild variant="outline" size="sm" className="gap-1.5">
                      <a href={c.givingUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /> Open</a>
                    </Button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Card payments go live once the payment provider is connected. Until then the giving page shows that online
                  giving is not available.
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="overflow-x-auto p-0">
              {report.donations.length === 0 ? (
                <p className="p-5 text-sm text-muted-foreground">No donations yet. Share the giving page or its QR code.</p>
              ) : (
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                    <tr className="border-b text-left">
                      <th className="p-3 font-medium">Date</th>
                      <th className="p-3 font-medium">Donor</th>
                      <th className="p-3 text-right font-medium">Amount</th>
                      <th className="p-3 font-medium">Status</th>
                      <th className="p-3 font-medium">Message</th>
                      <th className="p-3"><span className="sr-only">Receipt</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.donations.map((d) => (
                      <tr key={d.id} className="border-b last:border-0">
                        <td className="p-3">{fmt.dateTime(d.paidDate ?? d.createdDate)}</td>
                        <td className="p-3">
                          <span className="block">{d.donorName}{d.isAnonymous ? " (anonymous on the page)" : ""}</span>
                          <span className="block text-xs text-muted-foreground">{d.donorEmail}</span>
                        </td>
                        <td className="p-3 text-right tabular-nums">{fmt.money(d.amount, d.currency)}</td>
                        <td className="p-3">{d.status === "paid" ? "Paid" : "Not completed"}</td>
                        <td className="max-w-xs p-3 text-muted-foreground">{d.message}</td>
                        <td className="p-3 text-right">
                          {d.status === "paid" && (
                            <Button variant="ghost" size="sm" className="gap-1.5"
                              onClick={() => run(() => downloadDonationReceipt(scope, scopeId, c.id, d.id, d.merchantOrderId), "Could not create the receipt.")}>
                              <FileText className="h-4 w-4" /> Receipt
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}
