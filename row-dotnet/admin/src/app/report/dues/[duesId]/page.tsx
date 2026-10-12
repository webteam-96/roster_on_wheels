"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getPublicMembershipDuesReport, exportPublicMembershipDuesReport } from "@/services/api";
import { fileTimestamp } from "@/lib/dateUtils";

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
  members: ReportMember[];
}

function fmtAmt(val: number): string {
  return val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Renders the 5 columns (Amt, Settled, Mode, Date, Status) of a fee-type
// block as N/A — used when that fee type is moot because the member fully
// paid via the other path (Annual vs Semi1+Semi2).
function NaCells() {
  return (
    <>
      <td className="px-3 py-2.5 whitespace-nowrap text-right text-gray-400">N/A</td>
      <td className="px-3 py-2.5 whitespace-nowrap text-right text-gray-400">N/A</td>
      <td className="px-3 py-2.5 whitespace-nowrap text-gray-400">N/A</td>
      <td className="px-3 py-2.5 whitespace-nowrap text-gray-400">N/A</td>
      <td className="px-3 py-2.5 whitespace-nowrap text-center text-gray-400">N/A</td>
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
  const blob = await exportPublicMembershipDuesReport(duesId);
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
    getPublicMembershipDuesReport(duesId)
      .then((res) => setData(res))
      .catch(() => setError("Failed to load report data."))
      .finally(() => setLoading(false));
  }, [duesId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#17458F] mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading report...</p>
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
      <div className="bg-[#17458F] text-white">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center gap-4 mb-4">
            <img src="/images/rotary-white-live.png" alt="Rotary" className="h-16 object-contain" />
          </div>
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
            <span>Total Collected: <strong>Rs. {fmtAmt(totalCollected)}</strong></span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col items-end gap-2">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#17458F] text-white rounded-md hover:bg-[#0f3470] transition-colors text-sm font-medium disabled:opacity-60"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {downloading ? "Downloading..." : "Download Report"}
        </button>
        {downloadError && <p className="text-sm text-red-600">{downloadError}</p>}
      </div>

      {/* Table */}
      <div className="max-w-7xl mx-auto px-4 pb-8">
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-[#17458F] text-white">
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Sr.No</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Member Name</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Category</th>
                {data.isFees1 && (
                  <>
                    <th className="px-3 py-3 text-right font-medium whitespace-nowrap">{fees1Label} Amt</th>
                    <th className="px-3 py-3 text-right font-medium whitespace-nowrap">{fees1Label} Settled</th>
                    <th className="px-3 py-3 text-left font-medium whitespace-nowrap">{fees1Label} Mode</th>
                    <th className="px-3 py-3 text-left font-medium whitespace-nowrap">{fees1Label} Date</th>
                    <th className="px-3 py-3 text-center font-medium whitespace-nowrap">{fees1Label} Status</th>
                  </>
                )}
                {data.isFees2 && (
                  <>
                    <th className="px-3 py-3 text-right font-medium whitespace-nowrap">{fees2Label} Amt</th>
                    <th className="px-3 py-3 text-right font-medium whitespace-nowrap">{fees2Label} Settled</th>
                    <th className="px-3 py-3 text-left font-medium whitespace-nowrap">{fees2Label} Mode</th>
                    <th className="px-3 py-3 text-left font-medium whitespace-nowrap">{fees2Label} Date</th>
                    <th className="px-3 py-3 text-center font-medium whitespace-nowrap">{fees2Label} Status</th>
                  </>
                )}
                {data.isFees3 && (
                  <>
                    <th className="px-3 py-3 text-right font-medium whitespace-nowrap">{fees3Label} Amt</th>
                    <th className="px-3 py-3 text-right font-medium whitespace-nowrap">{fees3Label} Settled</th>
                    <th className="px-3 py-3 text-left font-medium whitespace-nowrap">{fees3Label} Mode</th>
                    <th className="px-3 py-3 text-left font-medium whitespace-nowrap">{fees3Label} Date</th>
                    <th className="px-3 py-3 text-center font-medium whitespace-nowrap">{fees3Label} Status</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr>
                  <td colSpan={20} className="px-3 py-8 text-center text-gray-500">
                    No members found.
                  </td>
                </tr>
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
                    <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2.5 whitespace-nowrap">{idx + 1}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap font-medium">{m.memberName || "-"}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{m.categoryType || "-"}</td>
                      {data.isFees1 && (
                        blankAnnual ? <NaCells /> : (
                        <>
                          <td className="px-3 py-2.5 whitespace-nowrap text-right">Rs. {fmtAmt(m.annualAmount)}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-right">{m.annualSettled != null ? `Rs. ${fmtAmt(m.annualSettled)}` : "-"}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{m.annualPaymentMode || "-"}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{fmtDate(m.annualPaymentDate) || "-"}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-center">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${m.annualPaid > 0 && annualBal <= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                              {m.annualPaid > 0 && annualBal <= 0 ? "Paid" : "Unpaid"}
                            </span>
                          </td>
                        </>
                        )
                      )}
                      {data.isFees2 && (
                        blankSemis ? <NaCells /> : (
                        <>
                          <td className="px-3 py-2.5 whitespace-nowrap text-right">Rs. {fmtAmt(m.semi1Amount)}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-right">{m.semi1Settled != null ? `Rs. ${fmtAmt(m.semi1Settled)}` : "-"}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{m.semi1PaymentMode || "-"}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{fmtDate(m.semi1PaymentDate) || "-"}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-center">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${m.semi1Paid > 0 && semi1Bal <= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                              {m.semi1Paid > 0 && semi1Bal <= 0 ? "Paid" : "Unpaid"}
                            </span>
                          </td>
                        </>
                        )
                      )}
                      {data.isFees3 && (
                        blankSemis ? <NaCells /> : (
                        <>
                          <td className="px-3 py-2.5 whitespace-nowrap text-right">Rs. {fmtAmt(m.semi2Amount)}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-right">{m.semi2Settled != null ? `Rs. ${fmtAmt(m.semi2Settled)}` : "-"}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{m.semi2PaymentMode || "-"}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{fmtDate(m.semi2PaymentDate) || "-"}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-center">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${m.semi2Paid > 0 && semi2Bal <= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                              {m.semi2Paid > 0 && semi2Bal <= 0 ? "Paid" : "Unpaid"}
                            </span>
                          </td>
                        </>
                        )
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {members.length > 0 && (
          <div className="mt-4 text-right text-sm text-gray-600">
            Showing {members.length} member{members.length !== 1 ? "s" : ""} | Fully Paid: {totalPaid} | Total Collected: Rs. {fmtAmt(totalCollected)}
          </div>
        )}
      </div>
    </div>
  );
}
