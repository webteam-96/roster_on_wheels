"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getPublicClubDuesReport } from "@/services/api";
import { fileTimestamp, toLocalDateParts } from "@/lib/dateUtils";

import { appLocale, currencySymbol } from "@/lib/appFormat";
interface ReportClub {
  clubDuesClubId: number;
  clubName: string | null;
  isSyncedFromRotaryOrg: boolean;
  onlinePerMemberRate: number;
  offlinePerMemberRate: number;
  memberCount: number;
  paidCount: number;
  unpaidCount: number;
  amountPaid: number;
  onlineAmount: number;
  onlinePaid: number;
  offlineAmount: number;
  offlinePaid: number;
  status: string | null;
  // Latest paid payment (null when the club has paid nothing yet)
  paidOnline: boolean | null;
  offlineTransactionType: string | null;   // 1 Cash, 2 Cheque, 3 NEFT, 4 UPI, 5 Other
  offlineTransactionId: string | null;
  offlineRemark: string | null;
  offlineAccountLabel: string | null;
  paymentDate: string | null;
}

function totalPaid(c: ReportClub): number {
  return Number(c.offlinePaid || 0) + Number(c.onlinePaid || 0);
}
function offlinePending(c: ReportClub): number {
  return Math.max(0, Number(c.offlineAmount || 0) - Number(c.offlinePaid || 0));
}
function onlinePending(c: ReportClub): number {
  return Math.max(0, Number(c.onlineAmount || 0) - Number(c.onlinePaid || 0));
}

// Offline mode codes as stored in club_dues_payments.OfflineTransactionType.
const OFFLINE_MODES: Record<string, string> = { "1": "Cash", "2": "Cheque", "3": "NEFT", "4": "UPI", "5": "Other" };

interface ReportData {
  dues: { purpose: string | null; rotaryYear: string | null; districtNumber: string | null };
  clubs: ReportClub[];
}

function fmtAmt(val: number): string {
  return Number(val || 0).toLocaleString(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Grouped/localised numbers ("23,600.00") must never reach a CSV cell — the comma splits the row
// across columns in Excel. Everything numeric goes out plain so Excel reads it as a number.
function csvAmt(val: number): string {
  return (Number(val) || 0).toFixed(2);
}

// Report wording: the list API's "Fully Paid" reads as "Paid" here. Partial / No Members are the
// service's own labels and stay as they are.
function reportStatus(status: string | null): string {
  return status === "Fully Paid" ? "Paid" : status || "";
}

function paymentMode(c: ReportClub): string {
  return c.paidOnline == null ? "" : c.paidOnline ? "Online" : "Offline";
}

// Offline columns stay blank for unpaid clubs and for online payments.
function offlineCells(c: ReportClub): [string, string, string, string] {
  if (c.paidOnline !== false) return ["", "", "", ""];
  const code = String(c.offlineTransactionType ?? "");
  return [
    OFFLINE_MODES[code] || code,
    c.offlineTransactionId || "",
    c.offlineRemark || "",
    toLocalDateParts(c.paymentDate).date,
  ];
}

// Once one channel has won (paidOnline true/false), the other channel's own rate/amount/paid/
// pending are moot for this club — null tells callers to render/export blank instead of stale
// numbers. Both stay populated while paidOnline is still null (nothing paid yet).
function offlineAmountCells(c: ReportClub): [number, number, number, number] | null {
  if (c.paidOnline === true) return null;
  return [c.offlinePerMemberRate, c.offlineAmount, Number(c.offlinePaid || 0), offlinePending(c)];
}
function onlineAmountCells(c: ReportClub): [number, number, number, number] | null {
  if (c.paidOnline === false) return null;
  return [c.onlinePerMemberRate, c.onlineAmount, Number(c.onlinePaid || 0), onlinePending(c)];
}

function statusClasses(status: string | null): string {
  switch (status) {
    case "Fully Paid": return "bg-green-100 text-green-700";
    case "Partial": return "bg-amber-100 text-amber-700";
    case "Unpaid": return "bg-red-100 text-red-700";
    default: return "bg-gray-100 text-gray-600"; // No Members
  }
}

function downloadCSV(purpose: string, clubs: ReportClub[]) {
  const escapeCSV = (val: string | number | null | undefined): string => {
    if (val == null) return "";
    const str = String(val);
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  const headers = [
    "Sr.No", "Club", "Members",
    "Offline Rate", "Offline Amount", "Offline Paid", "Offline Pending",
    "Online Rate", "Online Amount", "Online Paid", "Online Pending",
    "Total Paid", "Status", "Payment Mode",
    "Offline Account", "Offline Mode", "Offline Reference No", "Offline Remark", "Offline Payment Date",
  ];
  const rows = clubs.map((c, i) => {
    const [offMode, offRef, offRemark, offDate] = offlineCells(c);
    const offAmounts = offlineAmountCells(c);
    const onAmounts = onlineAmountCells(c);
    // Every text cell goes through escapeCSV — a club name or remark holding a comma would
    // shift the row exactly the way grouped numbers used to.
    return [
      String(i + 1),
      escapeCSV(c.clubName),
      String(c.memberCount),
      offAmounts ? csvAmt(offAmounts[0]) : "",
      offAmounts ? csvAmt(offAmounts[1]) : "",
      offAmounts ? csvAmt(offAmounts[2]) : "",
      offAmounts ? csvAmt(offAmounts[3]) : "",
      onAmounts ? csvAmt(onAmounts[0]) : "",
      onAmounts ? csvAmt(onAmounts[1]) : "",
      onAmounts ? csvAmt(onAmounts[2]) : "",
      onAmounts ? csvAmt(onAmounts[3]) : "",
      csvAmt(totalPaid(c)),
      escapeCSV(reportStatus(c.status)),
      paymentMode(c),
      escapeCSV(c.paidOnline === false ? (c.offlineAccountLabel || "") : ""),
      escapeCSV(offMode),
      escapeCSV(offRef),
      escapeCSV(offRemark),
      offDate,
    ].join(",");
  });
  const csv = "﻿" + headers.join(",") + "\n" + rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const title = purpose || "Club_Dues_Report";
  link.download = `${title.replace(/[^a-zA-Z0-9 ]/g, "").trim()}_Report_${fileTimestamp()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function ClubDuesReportPage() {
  const params = useParams();
  const duesId = Number(params.duesId);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!duesId) return;
    setLoading(true);
    getPublicClubDuesReport(duesId)
      .then((res) => setData(res))
      .catch((e: any) => setError(e?.response?.data?.message || "Failed to load report data."))
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
        <p className="text-red-600 text-lg font-medium">{error || "Report not found."}</p>
      </div>
    );
  }

  const dues = data.dues || { purpose: null, rotaryYear: null, districtNumber: null };
  const clubs = data.clubs || [];
  const totalClubs = clubs.length;
  const fullyPaidClubs = clubs.filter((c) => c.status === "Fully Paid").length;
  const totalMembers = clubs.reduce((s, c) => s + (c.memberCount || 0), 0);
  const totalOfflineCollected = clubs.reduce((s, c) => s + Number(c.offlinePaid || 0), 0);
  const totalOnlineCollected = clubs.reduce((s, c) => s + Number(c.onlinePaid || 0), 0);
  const totalCollected = totalOfflineCollected + totalOnlineCollected;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#17458F] text-white">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center gap-4 mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/rotary-white-live.png" alt="Rotary" className="h-16 object-contain" />
          </div>
          <h1 className="text-2xl font-bold">{dues.purpose || "District Dues"} — Report</h1>
          {dues.rotaryYear && <p className="mt-1 text-white/80 text-sm">Rotary Year: {dues.rotaryYear}</p>}
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-white/90">
            {dues.districtNumber && <span>District: <strong>{dues.districtNumber}</strong></span>}
            <span>Clubs: <strong>{totalClubs}</strong></span>
            <span>Fully Paid Clubs: <strong>{fullyPaidClubs}</strong></span>
            <span>Total Members: <strong>{totalMembers}</strong></span>
            <span>Total Collected: <strong>{currencySymbol()}{fmtAmt(totalCollected)}</strong></span>
            <span>Collected via Offline: <strong>{currencySymbol()}{fmtAmt(totalOfflineCollected)}</strong></span>
            <span>Collected via Online: <strong>{currencySymbol()}{fmtAmt(totalOnlineCollected)}</strong></span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="max-w-7xl mx-auto px-4 py-4 flex justify-end">
        <button
          onClick={() => downloadCSV(dues.purpose || "District Dues", clubs)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#17458F] text-white rounded-md hover:bg-[#0f3470] transition-colors text-sm font-medium"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download Report
        </button>
      </div>

      {/* Table */}
      <div className="max-w-7xl mx-auto px-4 pb-8">
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-[#17458F] text-white">
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Sr.No</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Club</th>
                <th className="px-3 py-3 text-center font-medium whitespace-nowrap">Members</th>
                <th className="px-3 py-3 text-right font-medium whitespace-nowrap">Offline Rate</th>
                <th className="px-3 py-3 text-right font-medium whitespace-nowrap">Offline Amount</th>
                <th className="px-3 py-3 text-right font-medium whitespace-nowrap">Offline Paid</th>
                <th className="px-3 py-3 text-right font-medium whitespace-nowrap">Offline Pending</th>
                <th className="px-3 py-3 text-right font-medium whitespace-nowrap">Online Rate</th>
                <th className="px-3 py-3 text-right font-medium whitespace-nowrap">Online Amount</th>
                <th className="px-3 py-3 text-right font-medium whitespace-nowrap">Online Paid</th>
                <th className="px-3 py-3 text-right font-medium whitespace-nowrap">Online Pending</th>
                <th className="px-3 py-3 text-right font-medium whitespace-nowrap">Total Paid</th>
                <th className="px-3 py-3 text-center font-medium whitespace-nowrap">Status</th>
                <th className="px-3 py-3 text-center font-medium whitespace-nowrap">Payment Mode</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Offline Account</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Offline Mode</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Offline Reference No</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Offline Remark</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Offline Payment Date</th>
              </tr>
            </thead>
            <tbody>
              {clubs.length === 0 ? (
                <tr><td colSpan={19} className="px-3 py-8 text-center text-gray-500">No clubs found.</td></tr>
              ) : (
                clubs.map((c, idx) => {
                  const [offMode, offRef, offRemark, offDate] = offlineCells(c);
                  const offAmounts = offlineAmountCells(c);
                  const onAmounts = onlineAmountCells(c);
                  return (
                  <tr key={c.clubDuesClubId} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2.5 whitespace-nowrap">{idx + 1}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-medium">
                      {c.clubName || "-"}
                      {!c.isSyncedFromRotaryOrg && <span className="ml-2 text-xs rounded bg-amber-100 text-amber-700 px-1.5 py-0.5">non-sync</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-center">{c.memberCount}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-right">{offAmounts ? `${currencySymbol()}${fmtAmt(offAmounts[0])}` : "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-right">{offAmounts ? `${currencySymbol()}${fmtAmt(offAmounts[1])}` : "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-right">{offAmounts ? `${currencySymbol()}${fmtAmt(offAmounts[2])}` : "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-right">{offAmounts ? `${currencySymbol()}${fmtAmt(offAmounts[3])}` : "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-right">{onAmounts ? `${currencySymbol()}${fmtAmt(onAmounts[0])}` : "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-right">{onAmounts ? `${currencySymbol()}${fmtAmt(onAmounts[1])}` : "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-right">{onAmounts ? `${currencySymbol()}${fmtAmt(onAmounts[2])}` : "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-right">{onAmounts ? `${currencySymbol()}${fmtAmt(onAmounts[3])}` : "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-right">{currencySymbol()}{fmtAmt(totalPaid(c))}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-center">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusClasses(c.status)}`}>{reportStatus(c.status) || "-"}</span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-center">{paymentMode(c) || "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{c.paidOnline === false ? (c.offlineAccountLabel || "-") : "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{offMode || "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{offRef || "-"}</td>
                    <td className="px-3 py-2.5">{offRemark || "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{offDate || "-"}</td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {clubs.length > 0 && (
          <div className="mt-4 text-right text-sm text-gray-600">
            Showing {totalClubs} club{totalClubs !== 1 ? "s" : ""} | Fully Paid: {fullyPaidClubs} | Total Members: {totalMembers} | Total Collected: {currencySymbol()}{fmtAmt(totalCollected)}
          </div>
        )}
      </div>
    </div>
  );
}
