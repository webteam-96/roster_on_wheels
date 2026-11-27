"use client";

import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Download } from "@/components/icons";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getMembershipDuesReport, exportMembershipDuesReport } from "@/services/api";
import { fileTimestamp } from "@/lib/dateUtils";

import { formatMoney } from "@/lib/currency";
import { SkeletonRows } from "@/components/row/AppKit";
import { withBase } from "@/lib/basePath";
interface ReportMember {
  memberName: string | null;
  categoryType: string | null;
  annualAmount: number;
  annualPaid: number;
  annualSettled: number | null;
  annualPaymentMode: string | null;
  annualPaymentDate: string | null;
  semi1Amount: number;
  semi1Paid: number;
  semi1Settled: number | null;
  semi1PaymentMode: string | null;
  semi1PaymentDate: string | null;
  semi2Amount: number;
  semi2Paid: number;
  semi2Settled: number | null;
  semi2PaymentMode: string | null;
  semi2PaymentDate: string | null;
}

interface ReportData {
  purpose: string | null;
  rotaryYear: string | null;
  districtNumber: string | null;
  clubName: string | null;
  isFees1: boolean;
  isFees2: boolean;
  isFees3: boolean;
  fees1Text: string | null;
  fees2Text: string | null;
  fees3Text: string | null;
  currency?: string | null; // ISO code of the dues (null = instance default)
  members: ReportMember[];
}

function fmtAmt(val: number, currency?: string | null): string {
  return formatMoney(val, currency);
}

// Renders the 5 columns (Amt, Settled, Mode, Date, Status) of a fee-type
// block as N/A — used when that fee type is moot because the member fully
// paid via the other path (Annual vs Semi1+Semi2).
function NaCells() {
  return (
    <>
      <TableCell className="px-3 py-2.5 whitespace-nowrap text-right text-gray-400">N/A</TableCell>
      <TableCell className="px-3 py-2.5 whitespace-nowrap text-right text-gray-400">N/A</TableCell>
      <TableCell className="px-3 py-2.5 whitespace-nowrap text-gray-400">N/A</TableCell>
      <TableCell className="px-3 py-2.5 whitespace-nowrap text-gray-400">N/A</TableCell>
      <TableCell className="px-3 py-2.5 whitespace-nowrap text-center text-gray-400">N/A</TableCell>
    </>
  );
}

function fmtDate(val: string | null | undefined): string {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}-${mm}-${yy} ${hh}:${mi}`;
}

// Downloads the same styled XLSX (title strip, Settled/Mode/Date columns,
// green/red Status highlighting) that the SuperAdmin/Club Admin "Download
// Report" export produces, instead of building a plain CSV client-side.
async function downloadXlsx(duesId: number, purpose: string | null) {
  const blob = await exportMembershipDuesReport(duesId);
  const url = URL.createObjectURL(new Blob([blob]));
  const link = document.createElement("a");
  link.href = url;
  const title = purpose || "Membership_Dues_Report";
  link.download = `${title.replace(/[^a-zA-Z0-9 ]/g, "").trim()}_Report_${fileTimestamp()}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function PublicDuesReportPage() {
  const params = useParams();
  const duesId = Number(params.duesId);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError("");
    try {
      await downloadXlsx(duesId, data?.purpose ?? null);
    } catch {
      setDownloadError("Failed to download report.");
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    if (!duesId) return;
    setLoading(true);
    getMembershipDuesReport(duesId)
      .then((res) => setData(res))
      .catch(() => setError("Failed to load report data."))
      .finally(() => setLoading(false));
  }, [duesId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-azure mx-auto"></div>
          <SkeletonRows />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-red-600 text-lg font-medium">{error || "Report not found."}</p>
        </div>
      </div>
    );
  }

  const { members } = data;
  const fees1Label = data.fees1Text || "Annual";
  const fees2Label = data.fees2Text || "Semi-Annual 1";
  const fees3Label = data.fees3Text || "Semi-Annual 2";
  // Every amount in the dues currency (RIZones 2026-11-09, ROW form: a real currency code).
  const money = (v: number) => fmtAmt(v, data.currency);

  const totalPaid = members.filter((m) => {
    if (data.isFees1 && m.annualAmount - m.annualPaid > 0) return false;
    if (data.isFees2 && m.semi1Amount - m.semi1Paid > 0) return false;
    if (data.isFees3 && m.semi2Amount - m.semi2Paid > 0) return false;
    return true;
  }).length;

  // Collected = each member's own due amount, summed only for members who have
  // fully settled that fee — NOT a sum of actual payments. Actual payments
  // would also pull in partial-payment amounts, understating/misrepresenting
  // "how much has been collected" relative to what's actually owed.
  const totalCollected =
    (data.isFees1 ? members.reduce((s, m) => s + (m.annualAmount - m.annualPaid <= 0 ? m.annualAmount : 0), 0) : 0) +
    (data.isFees2 ? members.reduce((s, m) => s + (m.semi1Amount - m.semi1Paid <= 0 ? m.semi1Amount : 0), 0) : 0) +
    (data.isFees3 ? members.reduce((s, m) => s + (m.semi2Amount - m.semi2Paid <= 0 ? m.semi2Amount : 0), 0) : 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      {/* Logo on a light bar: the transparent mark, never a white plate on blue. */}
      <div className="border-b border-[color:var(--row-line)] bg-card">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <img src={withBase("/brand/row-logo.png")} alt="Roster On Wheels" className="h-12 object-contain" />
        </div>
      </div>
      <div className="bg-azure text-white">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold">{data.purpose}</h1>
          {data.rotaryYear && (
            <p className="mt-1 text-white/80 text-sm">Rotary Year: {data.rotaryYear}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-white/90">
            {data.districtNumber && (
              <span>District: <strong>{data.districtNumber}</strong></span>
            )}
            {data.clubName && (
              <span>Club: <strong>{data.clubName}</strong></span>
            )}
            <span>Total Members: <strong>{members.length}</strong></span>
            <span>Fully Paid: <strong>{totalPaid}</strong></span>
            <span>Total Collected: <strong>{money(totalCollected)}</strong></span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col items-end gap-2">
        <Button
          onClick={handleDownload}
          disabled={downloading}
          type="button"
        >
          <Download className="h-4 w-4" aria-hidden />
          {downloading ? "Downloading..." : "Download Report"}
        </Button>
        {downloadError && <p className="text-sm text-red-600">{downloadError}</p>}
      </div>

      {/* Table */}
      <div className="max-w-7xl mx-auto px-4 pb-8">
        <div className="bg-card rounded-lg shadow overflow-x-auto">
          <Table bare className="min-w-[640px] md:min-w-full">
            <TableHeader className="bg-muted text-[13px] text-muted-foreground">
              <TableRow>
                <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">Sr.No</TableHead>
                <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">Member Name</TableHead>
                <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">Category</TableHead>
                {data.isFees1 && (
                  <>
                    <TableHead className="px-3 py-3 text-right font-medium whitespace-nowrap">{fees1Label} Amt</TableHead>
                    <TableHead className="px-3 py-3 text-right font-medium whitespace-nowrap">{fees1Label} Settled</TableHead>
                    <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">{fees1Label} Mode</TableHead>
                    <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">{fees1Label} Date</TableHead>
                    <TableHead className="px-3 py-3 text-center font-medium whitespace-nowrap">{fees1Label} Status</TableHead>
                  </>
                )}
                {data.isFees2 && (
                  <>
                    <TableHead className="px-3 py-3 text-right font-medium whitespace-nowrap">{fees2Label} Amt</TableHead>
                    <TableHead className="px-3 py-3 text-right font-medium whitespace-nowrap">{fees2Label} Settled</TableHead>
                    <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">{fees2Label} Mode</TableHead>
                    <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">{fees2Label} Date</TableHead>
                    <TableHead className="px-3 py-3 text-center font-medium whitespace-nowrap">{fees2Label} Status</TableHead>
                  </>
                )}
                {data.isFees3 && (
                  <>
                    <TableHead className="px-3 py-3 text-right font-medium whitespace-nowrap">{fees3Label} Amt</TableHead>
                    <TableHead className="px-3 py-3 text-right font-medium whitespace-nowrap">{fees3Label} Settled</TableHead>
                    <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">{fees3Label} Mode</TableHead>
                    <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">{fees3Label} Date</TableHead>
                    <TableHead className="px-3 py-3 text-center font-medium whitespace-nowrap">{fees3Label} Status</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={20} className="px-3 py-8 text-center text-gray-500">
                    No members found.
                  </TableCell>
                </TableRow>
              ) : (
                members.map((m, idx) => {
                  const annualBal = m.annualAmount - m.annualPaid;
                  const semi1Bal = m.semi1Amount - m.semi1Paid;
                  const semi2Bal = m.semi2Amount - m.semi2Paid;
                  // Annual and Semi1+Semi2 are alternate payment paths for the
                  // same yearly due. Once one path is fully paid, the other is
                  // moot and shown as N/A (Semi2 still shows normally when only
                  // Semi1 is paid, since it's a separate outstanding installment).
                  const isAnnualPaid = data.isFees1 && m.annualPaid > 0 && annualBal <= 0;
                  const isSemi1Paid = data.isFees2 && m.semi1Paid > 0 && semi1Bal <= 0;
                  const blankAnnual = isSemi1Paid && !isAnnualPaid;
                  const blankSemis = isAnnualPaid;
                  return (
                    <TableRow key={idx}>
                      <TableCell className="px-3 py-2.5 whitespace-nowrap">{idx + 1}</TableCell>
                      <TableCell className="px-3 py-2.5 whitespace-nowrap font-medium">{m.memberName || "-"}</TableCell>
                      <TableCell className="px-3 py-2.5 whitespace-nowrap">{m.categoryType || "-"}</TableCell>
                      {data.isFees1 && (
                        blankAnnual ? <NaCells /> : (
                        <>
                          <TableCell className="px-3 py-2.5 whitespace-nowrap text-right">{money(m.annualAmount)}</TableCell>
                          <TableCell className="px-3 py-2.5 whitespace-nowrap text-right">{m.annualSettled != null ? money(m.annualSettled) : "-"}</TableCell>
                          <TableCell className="px-3 py-2.5 whitespace-nowrap">{m.annualPaymentMode || "-"}</TableCell>
                          <TableCell className="px-3 py-2.5 whitespace-nowrap">{fmtDate(m.annualPaymentDate) || "-"}</TableCell>
                          <TableCell className="px-3 py-2.5 whitespace-nowrap text-center">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${m.annualPaid > 0 && annualBal <= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                              {m.annualPaid > 0 && annualBal <= 0 ? "Paid" : "Unpaid"}
                            </span>
                          </TableCell>
                        </>
                        )
                      )}
                      {data.isFees2 && (
                        blankSemis ? <NaCells /> : (
                        <>
                          <TableCell className="px-3 py-2.5 whitespace-nowrap text-right">{money(m.semi1Amount)}</TableCell>
                          <TableCell className="px-3 py-2.5 whitespace-nowrap text-right">{m.semi1Settled != null ? money(m.semi1Settled) : "-"}</TableCell>
                          <TableCell className="px-3 py-2.5 whitespace-nowrap">{m.semi1PaymentMode || "-"}</TableCell>
                          <TableCell className="px-3 py-2.5 whitespace-nowrap">{fmtDate(m.semi1PaymentDate) || "-"}</TableCell>
                          <TableCell className="px-3 py-2.5 whitespace-nowrap text-center">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${m.semi1Paid > 0 && semi1Bal <= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                              {m.semi1Paid > 0 && semi1Bal <= 0 ? "Paid" : "Unpaid"}
                            </span>
                          </TableCell>
                        </>
                        )
                      )}
                      {data.isFees3 && (
                        blankSemis ? <NaCells /> : (
                        <>
                          <TableCell className="px-3 py-2.5 whitespace-nowrap text-right">{money(m.semi2Amount)}</TableCell>
                          <TableCell className="px-3 py-2.5 whitespace-nowrap text-right">{m.semi2Settled != null ? money(m.semi2Settled) : "-"}</TableCell>
                          <TableCell className="px-3 py-2.5 whitespace-nowrap">{m.semi2PaymentMode || "-"}</TableCell>
                          <TableCell className="px-3 py-2.5 whitespace-nowrap">{fmtDate(m.semi2PaymentDate) || "-"}</TableCell>
                          <TableCell className="px-3 py-2.5 whitespace-nowrap text-center">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${m.semi2Paid > 0 && semi2Bal <= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                              {m.semi2Paid > 0 && semi2Bal <= 0 ? "Paid" : "Unpaid"}
                            </span>
                          </TableCell>
                        </>
                        )
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {members.length > 0 && (
          <div className="mt-4 text-right text-sm text-gray-600">
            Showing {members.length} member{members.length !== 1 ? "s" : ""} | Fully Paid: {totalPaid} | Total Collected: {money(totalCollected)}
          </div>
        )}
      </div>
    </div>
  );
}
