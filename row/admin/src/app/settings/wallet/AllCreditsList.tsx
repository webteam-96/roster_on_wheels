"use client";

/**
 * Settings › Wallet — combined email credit list.
 * Offline = given by Super Admin (Offline button); Online = bought by the club/district itself.
 * Both show here, one row per entry, so a club that got 500 from Super Admin and also bought
 * 1000 online shows both rows.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import DateField from "@/components/DateField";
import { Download, Loader2, Search } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import { exportToCSV } from "@/utils/csvExport";
import {
  getDistricts,
  getDistrictClubs,
  getWalletCreditEntries,
  type WalletCreditEntryRow,
} from "@/services/api";

import { appLocale, currencySymbol } from "@/lib/appFormat";
const PAGE_SIZE = 50;
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const inr = (n: number | null) => (n == null ? "–" : `${currencySymbol()}${Number(n).toLocaleString(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" }) : "–");
const fmtDateTime = (s?: string | null) => (s ? new Date(s).toLocaleString(appLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–");

function creditsText(r: WalletCreditEntryRow): string {
  if (r.credits == null) return "Not recorded";
  if (r.entryType === "Edited") return `${r.credits > 0 ? "+" : ""}${r.credits} (${r.countBefore} → ${r.countAfter})`;
  return String(r.credits);
}

const statusClass: Record<string, string> = {
  Active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Expired: "bg-slate-100 text-slate-600 border-slate-200",
  Deleted: "bg-red-50 text-red-700 border-red-200",
};

export default function AllCreditsList({ refreshKey = 0 }: { refreshKey?: number }) {
  const [districts, setDistricts] = useState<{ id: number; districtNumber: string }[]>([]);
  const [clubs, setClubs] = useState<{ id: number; clubName: string }[]>([]);
  const [districtId, setDistrictId] = useState("");
  const [clubId, setClubId] = useState("");
  const [source, setSource] = useState("");
  const [creditType, setCreditType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  const [rows, setRows] = useState<WalletCreditEntryRow[]>([]);
  const [page, setPage] = useState(1);
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

  useEffect(() => {
    setClubId("");
    setClubs([]);
    if (!districtId) return;
    (async () => {
      try {
        const res = await getDistrictClubs(Number(districtId));
        setClubs(res.map((c: any) => ({ id: c.id, clubName: c.clubName })));
      } catch { /* non-critical */ }
    })();
  }, [districtId]);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await getWalletCreditEntries({
        districtId: districtId ? Number(districtId) : undefined,
        clubId: districtId && clubId !== "" ? Number(clubId) : undefined,
        source: source || undefined,
        creditType: creditType || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        search: search.trim() || undefined,
      });
      setRows(data || []);
      setPage(1);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setErrorMessage(err?.response?.data?.message || "Failed to load credits.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [districtId, clubId, source, creditType, dateFrom, dateTo, search]);

  // Dropdown filters apply at once; dates and search apply on "Load".
  useEffect(() => { load(); }, [districtId, clubId, source, creditType, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    const sum = (src: string, type: string) =>
      rows.filter((r) => r.source === src && r.creditType === type).reduce((a, r) => a + (r.credits ?? 0), 0);
    return {
      offlineEmail: sum("Offline", "Email"),
      onlineEmail: sum("Online", "Email"),
      onlineAmount: rows.filter((r) => r.source === "Online").reduce((a, r) => a + (r.amount ?? 0), 0),
    };
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleExport = () => {
    exportToCSV(rows.map((r, i) => ({
      srNo: i + 1,
      entryDate: fmtDateTime(r.entryDate),
      source: r.source,
      entryType: r.entryType,
      districtNumber: r.districtNumber || "",
      clubName: r.clubName || "",
      creditType: r.creditType,
      credits: creditsText(r),
      amount: r.amount ?? "",
      transactionId: r.transactionId || "",
      paymentDate: r.paymentDate ? fmtDate(r.paymentDate) : "",
      expiryDate: r.expiryDate ? fmtDate(r.expiryDate) : "",
      packStatus: r.packStatus || "",
      byName: r.byName || "",
      note: r.note || "",
    })), "wallet-credits", [
      { key: "srNo", label: "Sr No" },
      { key: "entryDate", label: "Date" },
      { key: "source", label: "Source" },
      { key: "entryType", label: "Entry" },
      { key: "districtNumber", label: "District No" },
      { key: "clubName", label: "Club" },
      { key: "creditType", label: "Type" },
      { key: "credits", label: "Credits" },
      { key: "amount", label: "Amount Paid" },
      { key: "transactionId", label: "Transaction ID" },
      { key: "paymentDate", label: "Payment Date" },
      { key: "expiryDate", label: "Expiry" },
      { key: "packStatus", label: "Status" },
      { key: "byName", label: "By" },
      { key: "note", label: "Note" },
    ], { title: "Email Credits | Offline + Online" });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-36">
          <Label className="text-xs">Source</Label>
          <Select value={source || "all"} onValueChange={(v) => setSource(v === "all" ? "" : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Offline + Online</SelectItem>
              <SelectItem value="Offline">Offline</SelectItem>
              <SelectItem value="Online">Online</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-36">
          <Label className="text-xs">Type</Label>
          <Select value={creditType || "all"} onValueChange={(v) => setCreditType(v === "all" ? "" : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="Email">Email</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
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
          <Label className="text-xs">Club</Label>
          <Select value={clubId === "" ? "all" : clubId} onValueChange={(v) => setClubId(v === "all" ? "" : v)} disabled={!districtId}>
            <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">District + all clubs</SelectItem>
              <SelectItem value="0">District level only</SelectItem>
              {clubs.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.clubName}</SelectItem>)}
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
        <div className="w-56">
          <Label className="text-xs">Search</Label>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") load(); }}
              placeholder="Club, district or txn id…" className="pl-7" />
          </div>
        </div>
        <Button onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
          Load
        </Button>
        <Button variant="outline" onClick={handleExport} disabled={rows.length === 0}>
          <Download className="h-4 w-4 mr-1.5" /> Download
        </Button>
      </div>

      {!loading && rows.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-md border bg-amber-50 border-amber-200 px-2.5 py-1 text-amber-800">
            Offline: Email <b>{totals.offlineEmail.toLocaleString(appLocale())}</b>
          </span>
          <span className="rounded-md border bg-blue-50 border-blue-200 px-2.5 py-1 text-blue-800">
            Online: Email <b>{totals.onlineEmail.toLocaleString(appLocale())}</b> · Paid <b>{inr(totals.onlineAmount)}</b>
          </span>
          <span className="rounded-md border px-2.5 py-1 text-muted-foreground">{rows.length} entries</span>
        </div>
      )}

      <ErrorAlert
        open={!!errorMessage}
        title="Could not load credits"
        description={errorMessage || ""}
        onOk={() => setErrorMessage(null)}
      />

      {loading ? (
        <RotaryLoader />
      ) : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground py-10 text-center">No credit entries found for these filters.</div>
      ) : (
        <>
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full min-w-[640px] md:min-w-full text-sm">
              <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                <tr>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">Sr No</th>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">Date</th>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">Source</th>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">District</th>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">Club</th>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">Type</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">Credits</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">Amount Paid</th>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">Transaction ID</th>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">Expiry</th>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">Status</th>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageRows.map((r, i) => (
                  <tr key={`${r.source}-${(page - 1) * PAGE_SIZE + i}`} className="hover:bg-blue-50/40 align-top">
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{(page - 1) * PAGE_SIZE + i + 1}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmtDateTime(r.entryDate)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Badge variant="outline" className={r.source === "Offline" ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-blue-50 text-blue-800 border-blue-200"}>
                        {r.source}
                      </Badge>
                      {r.entryType !== "Added" && r.entryType !== "Purchased" && (
                        <div className="text-[11px] text-slate-400 mt-0.5">{r.entryType}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.districtNumber || "–"}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {r.clubName || "–"}
                      {r.note && <div className="text-[11px] font-normal text-amber-700 max-w-xs">{r.note}</div>}
                    </td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.creditType}</td>
                    <td className={`px-3 py-2 text-right whitespace-nowrap ${r.credits == null ? "text-slate-400 italic" : "text-slate-800 font-medium"}`}>{creditsText(r)}</td>
                    <td className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">{inr(r.amount)}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap font-mono text-xs">
                      {r.transactionId || "–"}
                      {r.proofDocumentPath && (
                        <div>
                          <a href={`${API_BASE}${r.proofDocumentPath}`} target="_blank" rel="noopener noreferrer" className="font-sans text-primary underline">Proof</a>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmtDate(r.expiryDate)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.packStatus ? <Badge variant="outline" className={statusClass[r.packStatus] || ""}>{r.packStatus}</Badge> : "–"}
                    </td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.byName || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
