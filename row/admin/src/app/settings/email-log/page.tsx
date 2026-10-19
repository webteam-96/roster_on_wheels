"use client";

import { useState, useEffect, useCallback } from "react";
import DateField from "@/components/DateField";
import { getEmailLog, getEmailLogDetail, getEmailLogSummary, exportEmailLog, type EmailLogFilter, type EmailLogItem, type EmailLogDetail } from "@/services/api";
import { fileTimestamp } from "@/lib/dateUtils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Mail, Search, Filter, RotateCcw, Eye, Download } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

import { appLocale } from "@/lib/appFormat";
function formatDate(d: string | null) {
  if (!d) return "–";
  const dt = new Date(d);
  if (isNaN(dt.getTime()) || dt.getFullYear() < 2000) return "–";
  return dt.toLocaleString(appLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusBadge(status: string) {
  const cls =
    status === "Sent" ? "bg-emerald-500 hover:bg-emerald-600" :
    status === "Failed" ? "bg-red-500 hover:bg-red-600" :
    "bg-amber-500 hover:bg-amber-600";
  return <Badge className={cls}>{status}</Badge>;
}

function typeBadge(type: string | null) {
  if (!type) return <span className="text-slate-400">, </span>;
  const palette: Record<string, string> = {
    "OTP":                        "bg-blue-100   text-blue-700   border-blue-200",
    "Data Collection":            "bg-cyan-100   text-cyan-700   border-cyan-200",
    "Mass Email":                 "bg-violet-100 text-violet-700 border-violet-200",
    "Citation":                   "bg-orange-100 text-orange-700 border-orange-200",
    "Monthly Report":             "bg-teal-100   text-teal-700   border-teal-200",
    "Newsletter":                 "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200",
    "Beneficiary":                "bg-lime-100   text-lime-700   border-lime-200",
    "KYC":                        "bg-rose-100   text-rose-700   border-rose-200",
    "Club Website":               "bg-indigo-100 text-indigo-700 border-indigo-200",
    "Password Reset":             "bg-amber-100  text-amber-700  border-amber-200",
    "Password Changed":           "bg-amber-100  text-amber-700  border-amber-200",
    "SuperAdmin":                 "bg-red-100    text-red-700    border-red-200",
    "Zonal Coordinator":          "bg-sky-100    text-sky-700    border-sky-200",
    "Club Admin Assignment":      "bg-emerald-100 text-emerald-700 border-emerald-200",
    "Login Credentials":          "bg-emerald-100 text-emerald-700 border-emerald-200",
    "Welcome":                    "bg-green-100  text-green-700  border-green-200",
    "Role / Membership Removed":  "bg-slate-200  text-slate-700  border-slate-300",
    "Club Leadership":            "bg-purple-100 text-purple-700 border-purple-200",
    "Reminder":                   "bg-yellow-100 text-yellow-700 border-yellow-200",
    "Attachment":                 "bg-stone-100  text-stone-700  border-stone-200",
    "Other":                      "bg-slate-100  text-slate-600  border-slate-200",
  };
  const cls = palette[type] ?? "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium whitespace-nowrap ${cls}`}>
      {type}
    </span>
  );
}

export default function EmailLogPage() {
  const { isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [items, setItems] = useState<EmailLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 100;

  // Filters
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Summary tiles
  const [summary, setSummary] = useState<any>(null);

  // Detail dialog
  const [detail, setDetail] = useState<EmailLogDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const fetchLogs = useCallback(async (pg: number = 1) => {
    setLoading(true);
    try {
      const filter: EmailLogFilter = { page: pg, pageSize };
      if (recipient.trim()) filter.recipient = recipient.trim();
      if (subject.trim()) filter.subject = subject.trim();
      if (status && status !== "all") filter.status = status;
      if (fromDate) filter.from = fromDate;
      if (toDate) filter.to = toDate;
      const result = await getEmailLog(filter);
      setItems(result.items || []);
      setTotal(result.total || 0);
      setPage(pg);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load email log.");
    } finally {
      setLoading(false);
    }
  }, [recipient, subject, status, fromDate, toDate]);

  const fetchSummary = useCallback(async () => {
    try {
      const s = await getEmailLogSummary();
      setSummary(s);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchLogs(1); fetchSummary(); }, []); // eslint-disable-line

  const openDetail = async (id: number) => {
    try {
      const d = await getEmailLogDetail(id);
      setDetail(d);
      setDetailOpen(true);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to load email body.");
    }
  };

  const resetFilters = () => {
    setRecipient(""); setSubject(""); setStatus("all"); setFromDate(""); setToDate("");
    setTimeout(() => fetchLogs(1), 0);
  };

  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      const filter: Omit<EmailLogFilter, "page" | "pageSize"> = {};
      if (recipient.trim()) filter.recipient = recipient.trim();
      if (subject.trim()) filter.subject = subject.trim();
      if (status && status !== "all") filter.status = status;
      if (fromDate) filter.from = fromDate;
      if (toDate) filter.to = toDate;
      const blob = await exportEmailLog(filter);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Email_Log_${fileTimestamp()}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to export email log.");
    } finally {
      setExporting(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute requireSuperAdmin>
        <div />
      </ProtectedRoute>
    );
  }

  const totalPages = Math.ceil(total / pageSize) || 1;

  return (
    <ProtectedRoute requireSuperAdmin>
      <div className="p-6 max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Mail className="h-6 w-6" /> Email Log</h1>
            <p className="text-sm text-slate-500">Every email sent via Brevo. Click a row to view the full HTML body.</p>
          </div>
          <Link href="/settings"><Button variant="outline"><ArrowLeft className="h-4 w-4 mr-1" /> Back to Settings</Button></Link>
        </div>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Card><CardContent className="p-3 text-center"><div className="text-xs text-slate-500">Last 24h</div><div className="text-2xl font-bold">{summary.last24h ?? 0}</div></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><div className="text-xs text-slate-500">Last 7d</div><div className="text-2xl font-bold">{summary.last7d ?? 0}</div></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><div className="text-xs text-slate-500">Last 30d</div><div className="text-2xl font-bold">{summary.last30d ?? 0}</div></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><div className="text-xs text-slate-500">Sent (all)</div><div className="text-2xl font-bold text-emerald-600">{summary.totalSent ?? 0}</div></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><div className="text-xs text-slate-500">Failed (all)</div><div className="text-2xl font-bold text-red-600">{summary.totalFailed ?? 0}</div></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><div className="text-xs text-slate-500">Total</div><div className="text-2xl font-bold">{summary.totalAll ?? 0}</div></CardContent></Card>
          </div>
        )}

        <ErrorAlert open={!!errorMessage} title="Email Log" description={errorMessage ?? ""} onOk={() => setErrorMessage(null)} />

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Filter className="h-4 w-4" /> Filters</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
              <div><Label className="text-xs">From</Label><DateField value={fromDate} onChange={setFromDate} /></div>
              <div><Label className="text-xs">To</Label><DateField value={toDate} onChange={setToDate} /></div>
              <div className="md:col-span-2"><Label className="text-xs">Recipient email (To, Cc)</Label><Input placeholder="contains…" value={recipient} onChange={e => setRecipient(e.target.value)} /></div>
              <div className="md:col-span-2"><Label className="text-xs">Subject</Label><Input placeholder="contains…" value={subject} onChange={e => setSubject(e.target.value)} /></div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="Sent">Sent</SelectItem>
                    <SelectItem value="Failed">Failed</SelectItem>
                    <SelectItem value="Pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-5 flex gap-2 mt-1">
                <Button onClick={() => fetchLogs(1)} className="flex-1 md:flex-none"><Search className="h-4 w-4 mr-1" /> Search</Button>
                <Button variant="outline" onClick={resetFilters}><RotateCcw className="h-4 w-4 mr-1" /> Reset</Button>
                <Button variant="outline" onClick={handleExport} disabled={exporting || total === 0} title="Export the current filtered rows to Excel">
                  <Download className="h-4 w-4 mr-1" /> {exporting ? "Exporting…" : "Export to Excel"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-12 flex justify-center"><RotaryLoader /></div>
            ) : items.length === 0 ? (
              <div className="p-12 text-center text-slate-500">No emails match the current filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[180px]">Sent At</TableHead>
                      <TableHead className="w-[100px]">Status</TableHead>
                      <TableHead className="w-[260px]">Recipient</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead className="w-[180px]">Type</TableHead>
                      <TableHead className="w-[80px] text-right">View</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map(it => (
                      <TableRow key={it.id} className="cursor-pointer hover:bg-slate-50" onClick={() => openDetail(it.id)}>
                        <TableCell className="text-xs">{formatDate(it.sentAt)}</TableCell>
                        <TableCell>{statusBadge(it.status)}</TableCell>
                        <TableCell className="text-xs break-all">{it.recipientEmail}</TableCell>
                        <TableCell className="text-sm">{it.subject ?? "–"}</TableCell>
                        <TableCell>{typeBadge(it.emailType)}</TableCell>
                        <TableCell className="text-right"><Button size="sm" variant="ghost"><Eye className="h-4 w-4" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {total > pageSize && (
              <div className="p-3 flex items-center justify-between text-xs border-t">
                <div>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => fetchLogs(page - 1)}>Prev</Button>
                  <span>Page {page} / {totalPages}</span>
                  <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => fetchLogs(page + 1)}>Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="text-base">{detail?.subject ?? "Email"}</DialogTitle>
            </DialogHeader>
            {detail && (
              <div className="flex flex-col overflow-hidden">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs py-3 border-b">
                  <div><span className="text-slate-500">To: </span><span className="break-all">{detail.recipientEmail}</span></div>
                  {detail.ccEmails && <div><span className="text-slate-500">Cc: </span><span className="break-all">{detail.ccEmails}</span></div>}
                  <div><span className="text-slate-500">Sent: </span>{formatDate(detail.sentAt)}</div>
                  <div><span className="text-slate-500">Status: </span>{statusBadge(detail.status)}</div>
                  {detail.brevoMessageId && <div className="md:col-span-2"><span className="text-slate-500">Brevo ID: </span><span className="break-all">{detail.brevoMessageId}</span></div>}
                  {detail.errorMessage && <div className="md:col-span-4 text-red-600"><span className="text-slate-500">Error: </span>{detail.errorMessage}</div>}
                </div>
                <div className="flex-1 overflow-auto bg-slate-50 rounded mt-2">
                  <iframe
                    sandbox=""
                    srcDoc={detail.bodyHtml ?? "<em>No body</em>"}
                    className="w-full h-[60vh] bg-white"
                    title="Email body"
                  />
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ProtectedRoute>
  );
}
