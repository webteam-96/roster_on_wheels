"use client";

import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Download } from "@/components/icons";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getEventReport } from "@/services/api";
import { fileTimestamp } from "@/lib/dateUtils";

import { appLocale } from "@/lib/appFormat";
import { formatMoney } from "@/lib/currency";
import { SkeletonRows } from "@/components/row/AppKit";
import { withBase } from "@/lib/basePath";
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
  return d.toLocaleDateString(appLocale(), {
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
    getEventReport(linkId)
      .then((res) => setData(res))
      .catch(() => setError("Failed to load report data."))
      .finally(() => setLoading(false));
  }, [linkId]);

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

  const { linkDetails, members } = data;
  const totalAmount = members.reduce((sum, m) => sum + m.amount, 0);

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
            <span>Total Amount: <strong>{formatMoney(totalAmount)}</strong></span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="max-w-7xl mx-auto px-4 py-4 flex justify-end">
        <Button
          onClick={() => downloadCSV(data)}
          type="button"
        >
          <Download className="h-4 w-4" aria-hidden />
          Download Report
        </Button>
      </div>

      {/* Table */}
      <div className="max-w-7xl mx-auto px-4 pb-8">
        <div className="bg-card rounded-lg shadow overflow-x-auto">
          <Table bare className="min-w-[640px] md:min-w-full">
            <TableHeader className="bg-muted text-[13px] text-muted-foreground">
              <TableRow>
                <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">Sr.No</TableHead>
                <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">Member Name</TableHead>
                <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">District</TableHead>
                <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">Club</TableHead>
                <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">Mobile</TableHead>
                <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">Email</TableHead>
                <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">Registration</TableHead>
                <TableHead className="px-3 py-3 text-right font-medium whitespace-nowrap">Amount</TableHead>
                <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">Payment Date</TableHead>
                <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">Source</TableHead>
                <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">Partner Name</TableHead>
                <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">T-Shirt</TableHead>
                <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">Food</TableHead>
                <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">Remark 1</TableHead>
                <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">Remark 2</TableHead>
                <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">Remark 3</TableHead>
                <TableHead className="px-3 py-3 text-left font-medium whitespace-nowrap">Designation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={17} className="px-3 py-8 text-center text-gray-500">
                    No paid members found.
                  </TableCell>
                </TableRow>
              ) : (
                members.map((m) => (
                  <TableRow key={m.srNo}>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap">{m.srNo}</TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap font-medium">{m.memberName || "-"}</TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap">{m.districtNumber || "-"}</TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap">{m.clubName || "-"}</TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap">{m.mobile || "-"}</TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap">{m.email || "-"}</TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap">{m.registrationName || "-"}</TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap text-right">{formatMoney(m.amount)}</TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap">{formatDate(m.paymentDate)}</TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap">{m.paidSource || "-"}</TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap">{m.partnerName || "-"}</TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap">{m.tshirtSize || "-"}</TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap">{m.foodPreference || "-"}</TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap">{m.remark1 || "-"}</TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap">{m.remark2 || "-"}</TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap">{m.remark3 || "-"}</TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap">{m.designationName || "-"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {members.length > 0 && (
          <div className="mt-4 text-right text-sm text-gray-600">
            Showing {members.length} paid member{members.length !== 1 ? "s" : ""} | Total: {formatMoney(totalAmount)}
          </div>
        )}
      </div>
    </div>
  );
}
