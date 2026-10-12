"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getPublicEventReport } from "@/services/api";
import { fileTimestamp } from "@/lib/dateUtils";

interface ReportMember {
  srNo: number;
  memberName: string | null;
  districtNumber: string | null;
  clubName: string | null;
  mobile: string | null;
  email: string | null;
  registrationName: string | null;
  amount: number;
  paymentDate: string | null;
  paidSource: string | null;
  partnerName: string | null;
  tshirtSize: string | null;
  foodPreference: string | null;
  remark1: string | null;
  remark2: string | null;
  remark3: string | null;
  designationName: string | null;
}

interface ReportData {
  linkDetails: {
    title: string | null;
    description: string | null;
    formType: number;
    districtNumber: string | null;
    clubName: string | null;
  };
  members: ReportMember[];
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function downloadCSV(data: ReportData) {
  const headers = [
    "Sr.No",
    "Member Name",
    "District",
    "Club",
    "Mobile",
    "Email",
    "Registration Type",
    "Amount",
    "Payment Date",
    "Paid Source",
    "Partner Name",
    "T-Shirt Size",
    "Food Preference",
    "Remark 1",
    "Remark 2",
    "Remark 3",
    "Designation",
  ];

  const escapeCSV = (val: string | number | null | undefined): string => {
    if (val == null) return "";
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const rows = data.members.map((m) => [
    m.srNo,
    escapeCSV(m.memberName),
    escapeCSV(m.districtNumber),
    escapeCSV(m.clubName),
    escapeCSV(m.mobile),
    escapeCSV(m.email),
    escapeCSV(m.registrationName),
    m.amount,
    escapeCSV(formatDate(m.paymentDate)),
    escapeCSV(m.paidSource),
    escapeCSV(m.partnerName),
    escapeCSV(m.tshirtSize),
    escapeCSV(m.foodPreference),
    escapeCSV(m.remark1),
    escapeCSV(m.remark2),
    escapeCSV(m.remark3),
    escapeCSV(m.designationName),
  ]);

  const csvContent =
    "\uFEFF" + // BOM for Excel UTF-8 support
    headers.join(",") +
    "\n" +
    rows.map((r) => r.join(",")).join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const title = data.linkDetails.title || "Report";
  link.download = `${title.replace(/[^a-zA-Z0-9 ]/g, "").trim()}_Report_${fileTimestamp()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function PublicReportPage() {
  const params = useParams();
  const linkId = Number(params.linkId);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!linkId) return;
    setLoading(true);
    getPublicEventReport(linkId)
      .then((res) => setData(res))
      .catch(() => setError("Failed to load report data."))
      .finally(() => setLoading(false));
  }, [linkId]);

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

  const { linkDetails, members } = data;
  const totalAmount = members.reduce((sum, m) => sum + m.amount, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#17458F] text-white">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center gap-4 mb-4">
            <img src="/images/rotary-white-live.png" alt="Rotary" className="h-16 object-contain" />
          </div>
          <h1 className="text-2xl font-bold">{linkDetails.title}</h1>
          {linkDetails.description && (
            <p className="mt-1 text-white/80 text-sm">{linkDetails.description}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-white/90">
            {linkDetails.districtNumber && (
              <span>District: <strong>{linkDetails.districtNumber}</strong></span>
            )}
            {linkDetails.clubName && (
              <span>Club: <strong>{linkDetails.clubName}</strong></span>
            )}
            <span>Total Paid: <strong>{members.length}</strong></span>
            <span>Total Amount: <strong>Rs. {totalAmount.toLocaleString("en-IN")}</strong></span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="max-w-7xl mx-auto px-4 py-4 flex justify-end">
        <button
          onClick={() => downloadCSV(data)}
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
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Member Name</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">District</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Club</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Mobile</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Email</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Registration</th>
                <th className="px-3 py-3 text-right font-medium whitespace-nowrap">Amount</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Payment Date</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Source</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Partner Name</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">T-Shirt</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Food</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Remark 1</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Remark 2</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Remark 3</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Designation</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr>
                  <td colSpan={17} className="px-3 py-8 text-center text-gray-500">
                    No paid members found.
                  </td>
                </tr>
              ) : (
                members.map((m) => (
                  <tr key={m.srNo} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2.5 whitespace-nowrap">{m.srNo}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-medium">{m.memberName || "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{m.districtNumber || "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{m.clubName || "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{m.mobile || "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{m.email || "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{m.registrationName || "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-right">Rs. {m.amount.toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{formatDate(m.paymentDate)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{m.paidSource || "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{m.partnerName || "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{m.tshirtSize || "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{m.foodPreference || "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{m.remark1 || "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{m.remark2 || "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{m.remark3 || "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{m.designationName || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {members.length > 0 && (
          <div className="mt-4 text-right text-sm text-gray-600">
            Showing {members.length} paid member{members.length !== 1 ? "s" : ""} | Total: Rs. {totalAmount.toLocaleString("en-IN")}
          </div>
        )}
      </div>
    </div>
  );
}
