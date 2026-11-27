"use client";

/**
 * One donation campaign for its managers: progress, analytics (by day, top donors), the donor list with receipt
 * letters, the Excel export and the QR code of the public giving page.
 */

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { PageHeader } from "@/components/row/AppKit";
import { useEffect, useState } from "react";
import { Copy, Download, ExternalLink, FileText } from "@/components/icons";
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
    <div className="space-y-6">
      {!report || !c ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-8 w-1/2" />
          <div className="grid gap-4 sm:grid-cols-4"><KpiTileSkeleton /><KpiTileSkeleton /><KpiTileSkeleton /><KpiTileSkeleton /></div>
          <TableSkeleton rows={5} />
        </div>
      ) : (
        <>
          <PageHeader
            title={c.title}
            back={basePath}
            backLabel="All campaigns"
            description={<><p> {campaignStatus(c)} {c.startDate || c.endDate ? `, ${[c.startDate && fmt.date(c.startDate), c.endDate && fmt.date(c.endDate)].filter(Boolean).join(" to ")}` : ""} </p> {c.description && <p className="whitespace-pre-line pt-1">{c.description}</p>}</>}
            actions={
              <>
<Button variant="outline" disabled={report.count === 0}
              onClick={() => run(() => downloadDonorList(scope, scopeId, c.id), "Could not export the donor list.")}>
              <Download className="h-4 w-4" /> Donor list (Excel)
            </Button>
              </>
            }
          />

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
                <h3 className="row-h2">Giving by day</h3>
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
                    <h3 className="row-h2 pt-3">Top donors</h3>
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
                <h3 className="row-h2">Giving page</h3>
                {qr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr} alt={`QR code for the giving page of ${c.title}`} className="h-44 w-44 border" />
                ) : (
                  <Skeleton className="h-44 w-44" />
                )}
                {c.givingUrl && (
                  <div className="flex flex-wrap gap-2">
                    {qr && (
                      <Button asChild variant="outline" size="sm">
                        <a href={qr} download={`donate-campaign-${c.id}.png`}><Download className="h-4 w-4" /> QR code</a>
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => copyLink(c.givingUrl!)}>
                      <Copy className="h-4 w-4" /> {copied ? "Copied" : "Copy link"}
                    </Button>
                    <Button asChild variant="outline" size="sm">
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
                <Table className="w-full min-w-[760px] text-sm">
                  <TableHeader>
                    <TableRow className="border-b">
                      <TableHead className="p-3">Date</TableHead>
                      <TableHead className="p-3">Donor</TableHead>
                      <TableHead className="p-3 text-right">Amount</TableHead>
                      <TableHead className="p-3">Status</TableHead>
                      <TableHead className="p-3">Message</TableHead>
                      <TableHead className="p-3"><span className="sr-only">Receipt</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.donations.map((d) => (
                      <TableRow key={d.id} className="border-b last:border-0">
                        <TableCell className="p-3">{fmt.dateTime(d.paidDate ?? d.createdDate)}</TableCell>
                        <TableCell className="p-3">
                          <span className="block">{d.donorName}{d.isAnonymous ? " (anonymous on the page)" : ""}</span>
                          <span className="block text-xs text-muted-foreground">{d.donorEmail}</span>
                        </TableCell>
                        <TableCell className="p-3 text-right tabular-nums">{fmt.money(d.amount, d.currency)}</TableCell>
                        <TableCell className="p-3">{d.status === "paid" ? "Paid" : "Not completed"}</TableCell>
                        <TableCell className="max-w-xs p-3 text-muted-foreground">{d.message}</TableCell>
                        <TableCell className="p-3 text-right">
                          {d.status === "paid" && (
                            <Button variant="ghost" size="sm"
                              onClick={() => run(() => downloadDonationReceipt(scope, scopeId, c.id, d.id, d.merchantOrderId), "Could not create the receipt.")}>
                              <FileText className="h-4 w-4" /> Receipt
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}
