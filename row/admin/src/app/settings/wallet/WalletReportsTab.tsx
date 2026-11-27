"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

/**
 * SuperAdmin › Wallet › Reports.
 * --------------------------------------------------------------------------
 * Purchase-history reports (Club Website / Email credits): who bought what,
 * for how much, whether/when it settled, which account it settled to, and who to contact
 * (current-year President + Secretary for the club at the time of purchase).
 *
 * Requires at least one narrowing filter (date range or district) before loading — mirrors the
 * "Check balance" popup's rule elsewhere in this module, avoiding an accidental full-table dump.
 * Defaults to the last 90 days on first load.
 */

import { Card } from "@/components/ui/card";
import { useCallback, useEffect, useState } from "react";
import DateField from "@/components/DateField";
import { Download, Loader2, Search } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import { exportToCSV } from "@/utils/csvExport";
import {
  getDistricts,
  getWalletClubWebsiteReport,
  getWalletEmailReport,
  getWalletDistrictEmailReport,
  type WalletReportRow,
} from "@/services/api";

import { appLocale, currencySymbol, todayLocal } from "@/lib/appFormat";
type ReportKey = "club-website" | "email" | "district-email";

const REPORT_OPTIONS: { key: ReportKey; label: string }[] = [
  { key: "club-website", label: "Club Website Purchases" },
  { key: "email", label: "Email Credit Purchases (Club)" },
  { key: "district-email", label: "Email Credit Purchases (District)" },
];

const FETCHERS: Record<ReportKey, typeof getWalletClubWebsiteReport> = {
  "club-website": getWalletClubWebsiteReport,
  email: getWalletEmailReport,
  "district-email": getWalletDistrictEmailReport,
};

const inr = (n: number | null) => (n == null ? "–" : `${currencySymbol()}${Number(n).toLocaleString(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" }) : "–");
const fmtDateTime = (s?: string | null) => (s ? new Date(s).toLocaleString(appLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–");

function todayMinus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function WalletReportsTab() {
  const [reportKey, setReportKey] = useState<ReportKey>("club-website");
  const [dateFrom, setDateFrom] = useState(todayMinus(90));
  const [dateTo, setDateTo] = useState("");
  const [districts, setDistricts] = useState<{ id: number; districtNumber: string }[]>([]);
  const [districtId, setDistrictId] = useState<string>("");
  const [search, setSearch] = useState("");

  const [rows, setRows] = useState<WalletReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await getDistricts(1, 9999, undefined, 1);
        setDistricts(((res as any).items || []).sort((a: any, b: any) => String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true })));
      } catch { /* non-critical: district filter just stays empty */ }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await FETCHERS[reportKey]({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        districtId: districtId ? Number(districtId) : undefined,
        search: search.trim() || undefined,
      });
      setRows(data || []);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setErrorMessage(err?.response?.data?.message || "Failed to load the report.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [reportKey, dateFrom, dateTo, districtId, search]);

  useEffect(() => { load(); }, [reportKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const showCredits = reportKey !== "club-website";
  const isDistrict = reportKey.startsWith("district-");
  const entityLabel = isDistrict ? "District" : "Club";
  const reportLabel = REPORT_OPTIONS.find((r) => r.key === reportKey)?.label || "Report";

  const handleExport = () => {
    exportToCSV(rows.map((r, i) => ({ srNo: i + 1, ...r })), `${reportKey}-purchases-${todayLocal()}`, [
      { key: "srNo", label: "Sr No" },
      ...(isDistrict ? [] : [{ key: "districtNumber", label: "District No" }]),
      { key: "clubName", label: entityLabel },
      { key: "purchaseDate", label: "Purchase Date" },
      { key: "purchaseAmount", label: "Amount", numeric: true },
      ...(showCredits ? [{ key: "creditsPurchased", label: "Credits Purchased", numeric: true }] : []),
      { key: "settlementAmount", label: "Settlement Amount", numeric: true },
      { key: "settlementDate", label: "Settlement Date" },
      { key: "razorpayTransactionId", label: "Transaction ID" },
      { key: "presidentName", label: isDistrict ? "District Governor" : "President" },
      { key: "presidentMobile", label: isDistrict ? "District Governor Mobile" : "President Mobile" },
      { key: "presidentEmail", label: isDistrict ? "District Governor Email" : "President Email" },
      ...(isDistrict ? [] : [
        { key: "secretaryName", label: "Secretary" },
        { key: "secretaryMobile", label: "Secretary Mobile" },
        { key: "secretaryEmail", label: "Secretary Email" },
      ]),
      { key: "settlesInAccount", label: "Settles In" },
      { key: "startDate", label: "Start Date" },
      { key: "endDate", label: "End Date" },
    ], { title: reportLabel, subtitle: `${dateFrom || "…"} to ${dateTo || "today"}` });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Label className="text-xs">Report</Label>
          <Select value={reportKey} onValueChange={(v) => setReportKey(v as ReportKey)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {REPORT_OPTIONS.map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">From</Label>
          <DateField value={dateFrom} onChange={setDateFrom} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <DateField value={dateTo} onChange={setDateTo} className="w-40" />
        </div>
        <div className="w-48">
          <Label className="text-xs">District</Label>
          <Select value={districtId || "all"} onValueChange={(v) => setDistrictId(v === "all" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="All districts" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All districts</SelectItem>
              {districts.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-56">
          <Label className="text-xs">{entityLabel} name</Label>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${entityLabel.toLowerCase()}…`} className="pl-7" />
          </div>
        </div>
        <Button onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
          Load
        </Button>
        <Button variant="outline" onClick={handleExport} disabled={rows.length === 0}>
          <Download className="h-4 w-4 mr-1.5" /> Download Report
        </Button>
      </div>

      <ErrorAlert
        open={!!errorMessage}
        title="Could not load report"
        description={errorMessage || ""}
        onOk={() => setErrorMessage(null)}
      />

      {loading ? (
        <RotaryLoader />
      ) : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground py-10 text-center">No purchases found for these filters.</div>
      ) : (
        <Card className="overflow-x-auto">
          <Table className="w-full min-w-[640px] md:min-w-full text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="px-3 text-left whitespace-nowrap">Sr No</TableHead>
                {!isDistrict && <TableHead className="px-3 text-left whitespace-nowrap">District No</TableHead>}
                <TableHead className="px-3 text-left whitespace-nowrap">{entityLabel}</TableHead>
                <TableHead className="px-3 text-left whitespace-nowrap">Purchase Date</TableHead>
                <TableHead className="px-3 text-right whitespace-nowrap">Amount</TableHead>
                {showCredits && <TableHead className="px-3 text-right whitespace-nowrap">Credits</TableHead>}
                <TableHead className="px-3 text-right whitespace-nowrap">Settlement Amt</TableHead>
                <TableHead className="px-3 text-left whitespace-nowrap">Settlement Date</TableHead>
                <TableHead className="px-3 text-left whitespace-nowrap">Transaction ID</TableHead>
                <TableHead className="px-3 text-left whitespace-nowrap">{isDistrict ? "District Governor" : "President"}</TableHead>
                {!isDistrict && <TableHead className="px-3 text-left whitespace-nowrap">Secretary</TableHead>}
                <TableHead className="px-3 text-left whitespace-nowrap">Settles In</TableHead>
                <TableHead className="px-3 text-left whitespace-nowrap">Start</TableHead>
                <TableHead className="px-3 text-left whitespace-nowrap">End</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <TableRow key={i} className="hover:bg-blue-50/40">
                  <TableCell className="px-3 py-2 text-slate-600 whitespace-nowrap">{i + 1}</TableCell>
                  {!isDistrict && <TableCell className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.districtNumber || "–"}</TableCell>}
                  <TableCell className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">{r.clubName}</TableCell>
                  <TableCell className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmtDate(r.purchaseDate)}</TableCell>
                  <TableCell className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">{inr(r.purchaseAmount)}</TableCell>
                  {showCredits && <TableCell className="px-3 py-2 text-right text-slate-600">{r.creditsPurchased ?? "–"}</TableCell>}
                  <TableCell className="px-3 py-2 text-right text-slate-600 whitespace-nowrap">{inr(r.settlementAmount)}</TableCell>
                  <TableCell className="px-3 py-2 text-slate-600 whitespace-nowrap">
                    {r.settlementDate ? fmtDateTime(r.settlementDate) : <span className="text-amber-600">Pending</span>}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-slate-500 whitespace-nowrap font-mono text-xs">{r.razorpayTransactionId || "–"}</TableCell>
                  <TableCell className="px-3 py-2 text-slate-600 whitespace-nowrap">
                    <div>{r.presidentName || "–"}</div>
                    {(r.presidentMobile || r.presidentEmail) && (
                      <div className="text-xs text-slate-400">{[r.presidentMobile, r.presidentEmail].filter(Boolean).join(" · ")}</div>
                    )}
                  </TableCell>
                  {!isDistrict && (
                    <TableCell className="px-3 py-2 text-slate-600 whitespace-nowrap">
                      <div>{r.secretaryName || "–"}</div>
                      {(r.secretaryMobile || r.secretaryEmail) && (
                        <div className="text-xs text-slate-400">{[r.secretaryMobile, r.secretaryEmail].filter(Boolean).join(" · ")}</div>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.settlesInAccount}</TableCell>
                  <TableCell className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmtDate(r.startDate)}</TableCell>
                  <TableCell className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmtDate(r.endDate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
