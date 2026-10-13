"use client";

// Reusable WhatsApp Log panel, scoped by `base`:
//   - "club/{id}"     → Club Admin dashboard (locked to that club, server-side)
//   - "district/{id}" → District Admin dashboard (locked to that district)
// Same filters + Export to Excel as the SuperAdmin settings page, minus the row detail dialog
// (the failure reason shows as a tooltip on the status chip instead).

import { useState, useEffect, useCallback } from "react";
import DateField from "@/components/DateField";
import {
  getScopedWhatsAppLog, getScopedWhatsAppLogSummary, exportScopedWhatsAppLog,
  type WhatsAppLogFilter, type WhatsAppLogItem,
} from "@/services/api";
import { fileTimestamp } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ErrorAlert from "@/components/ErrorAlert";
import { MessageCircle, Search, Filter, RotateCcw, Download, ArrowLeft } from "lucide-react";
import Link from "next/link";
import RotaryLoader from "@/components/RotaryLoader";

import { appLocale } from "@/lib/appFormat";
function fmtDate(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime()) || dt.getFullYear() < 2000) return "—";
  return dt.toLocaleString(appLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusBadge(status: string, error?: string | null) {
  const cls =
    status === "Read" ? "bg-emerald-600 hover:bg-emerald-700" :
    status === "Delivered" ? "bg-emerald-500 hover:bg-emerald-600" :
    status === "Sent" ? "bg-blue-500 hover:bg-blue-600" :
    status === "Failed" ? "bg-red-500 hover:bg-red-600" :
    "bg-amber-500 hover:bg-amber-600";
  return <Badge className={cls} title={error || undefined}>{status}</Badge>;
}

export default function WhatsAppLogPanel({ base, showClubFilter = false, backHref }: { base: string; showClubFilter?: boolean; backHref?: string }) {
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [items, setItems] = useState<WhatsAppLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 100;

  const [recipient, setRecipient] = useState("");
  const [title, setTitle] = useState("");
  const [club, setClub] = useState("");
  const [status, setStatus] = useState("all");
  const [waType, setWaType] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [summary, setSummary] = useState<any>(null);
  const [exporting, setExporting] = useState(false);

  const buildFilter = useCallback((): WhatsAppLogFilter => {
    const f: WhatsAppLogFilter = {};
    if (recipient.trim()) f.recipient = recipient.trim();
    if (title.trim()) f.title = title.trim();
    if (showClubFilter && club.trim()) f.club = club.trim();
    if (status !== "all") f.status = status;
    if (waType !== "all") f.waType = waType;
    if (fromDate) f.from = fromDate;
    if (toDate) f.to = toDate;
    return f;
  }, [recipient, title, club, status, waType, fromDate, toDate, showClubFilter]);

  const fetchLogs = useCallback(async (pg = 1) => {
    setLoading(true);
    try {
      const result = await getScopedWhatsAppLog(base, { ...buildFilter(), page: pg, pageSize });
      setItems(result.items || []);
      setTotal(result.total || 0);
      setPage(pg);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to load WhatsApp log.");
    } finally {
      setLoading(false);
    }
  }, [base, buildFilter]);

  useEffect(() => {
    getScopedWhatsAppLogSummary(base).then(setSummary).catch(() => {});
    fetchLogs(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const resetFilters = () => {
    setRecipient(""); setTitle(""); setClub(""); setStatus("all"); setWaType("all"); setFromDate(""); setToDate("");
    setTimeout(() => fetchLogs(1), 0);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await exportScopedWhatsAppLog(base, buildFilter());
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `WhatsApp_Log_${fileTimestamp()}.xlsx`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to export WhatsApp log.");
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize) || 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {backHref && (
          <Link href={backHref} title="Back to Reports" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 shrink-0">
            <ArrowLeft size={16} />
          </Link>
        )}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><MessageCircle className="h-6 w-6" /> WhatsApp Log</h1>
          <p className="text-sm text-slate-500">WhatsApp messages sent via Interakt for your {showClubFilter ? "district" : "club"}. &quot;Sent&quot; = accepted by Interakt; &quot;Delivered&quot;/&quot;Read&quot; come from the delivery webhook.</p>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Card><CardContent className="p-3 text-center"><div className="text-xs text-slate-500">Last 24h</div><div className="text-2xl font-bold">{summary.last24h ?? 0}</div></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><div className="text-xs text-slate-500">Last 7d</div><div className="text-2xl font-bold">{summary.last7d ?? 0}</div></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><div className="text-xs text-slate-500">Sent</div><div className="text-2xl font-bold text-blue-600">{summary.totalSent ?? 0}</div></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><div className="text-xs text-slate-500">Delivered</div><div className="text-2xl font-bold text-emerald-600">{summary.totalDelivered ?? 0}</div></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><div className="text-xs text-slate-500">Failed</div><div className="text-2xl font-bold text-red-600">{summary.totalFailed ?? 0}</div></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><div className="text-xs text-slate-500">Total</div><div className="text-2xl font-bold">{summary.totalAll ?? 0}</div></CardContent></Card>
        </div>
      )}

      <ErrorAlert open={!!errorMessage} title="WhatsApp Log" description={errorMessage ?? ""} onOk={() => setErrorMessage(null)} />

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Filter className="h-4 w-4" /> Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <div><Label className="text-xs">From</Label><DateField value={fromDate} onChange={setFromDate} /></div>
            <div><Label className="text-xs">To</Label><DateField value={toDate} onChange={setToDate} /></div>
            <div className="md:col-span-2"><Label className="text-xs">Recipient (mobile / name)</Label><Input placeholder="contains…" value={recipient} onChange={e => setRecipient(e.target.value)} /></div>
            <div className="md:col-span-2"><Label className="text-xs">Title</Label><Input placeholder="contains…" value={title} onChange={e => setTitle(e.target.value)} /></div>
            {showClubFilter && <div><Label className="text-xs">Club</Label><Input placeholder="club name…" value={club} onChange={e => setClub(e.target.value)} /></div>}
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="Sent">Sent</SelectItem>
                  <SelectItem value="Delivered">Delivered</SelectItem>
                  <SelectItem value="Read">Read</SelectItem>
                  <SelectItem value="Failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={waType} onValueChange={setWaType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="Announcement">Announcement</SelectItem>
                  <SelectItem value="UpcomingEvent">Upcoming Event</SelectItem>
                  <SelectItem value="Newsletter">Newsletter</SelectItem>
                  <SelectItem value="Project">Project</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-4 flex gap-2 mt-1 items-end">
              <Button onClick={() => fetchLogs(1)} className="flex-1 md:flex-none"><Search className="h-4 w-4 mr-1" /> Search</Button>
              <Button variant="outline" onClick={resetFilters}><RotateCcw className="h-4 w-4 mr-1" /> Reset</Button>
              <Button variant="outline" onClick={handleExport} disabled={exporting || total === 0}>
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
            <div className="p-12 text-center text-slate-500">No messages match the current filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">Sent At</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead className="w-[190px]">Recipient</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="w-[140px]">Type</TableHead>
                    {showClubFilter && <TableHead className="w-[140px]">Club</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(it => (
                    <TableRow key={it.id}>
                      <TableCell className="text-xs">{fmtDate(it.sentAt)}</TableCell>
                      <TableCell>{statusBadge(it.status, it.errorMessage)}</TableCell>
                      <TableCell className="text-xs">
                        <div className="font-medium">{it.recipientName || "—"}</div>
                        <div className="text-slate-500 break-all">{it.recipientMobile}</div>
                      </TableCell>
                      <TableCell className="text-sm">{it.title ?? "—"}</TableCell>
                      <TableCell className="text-xs text-slate-600">{it.whatsAppType ?? "—"}</TableCell>
                      {showClubFilter && <TableCell className="text-xs text-slate-600">{it.clubName ?? "—"}</TableCell>}
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
    </div>
  );
}
