"use client";

import { useState, useEffect, useCallback } from "react";
import DateField from "@/components/DateField";
import {
  getWhatsAppLog, getWhatsAppLogDetail, getWhatsAppLogSummary, exportWhatsAppLog,
  type WhatsAppLogFilter, type WhatsAppLogItem, type WhatsAppLogDetail,
} from "@/services/api";
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
import { ArrowLeft, MessageCircle, Search, Filter, RotateCcw, Eye, Download } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

function formatDate(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime()) || dt.getFullYear() < 2000) return "—";
  return dt.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusBadge(status: string) {
  const cls =
    status === "Read" ? "bg-emerald-600 hover:bg-emerald-700" :
    status === "Delivered" ? "bg-emerald-500 hover:bg-emerald-600" :
    status === "Sent" ? "bg-blue-500 hover:bg-blue-600" :
    status === "Failed" ? "bg-red-500 hover:bg-red-600" :
    "bg-amber-500 hover:bg-amber-600";
  return <Badge className={cls}>{status}</Badge>;
}

function typeBadge(type: string | null) {
  if (!type) return <span className="text-slate-400">—</span>;
  const palette: Record<string, string> = {
    "Announcement":            "bg-violet-100 text-violet-700 border-violet-200",
    "AnnouncementReminder":    "bg-violet-50  text-violet-600 border-violet-200",
    "UpcomingEvent":           "bg-teal-100   text-teal-700   border-teal-200",
    "UpcomingEventReminder":   "bg-teal-50    text-teal-600   border-teal-200",
    "Newsletter":              "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200",
    "Project":                 "bg-lime-100   text-lime-700   border-lime-200",
  };
  const cls = palette[type] ?? "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium whitespace-nowrap ${cls}`}>
      {type}
    </span>
  );
}

export default function WhatsAppLogPage() {
  const { isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [items, setItems] = useState<WhatsAppLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 100;

  // Filters
  const [recipient, setRecipient] = useState("");
  const [title, setTitle] = useState("");
  const [club, setClub] = useState("");
  const [district, setDistrict] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [waType, setWaType] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [summary, setSummary] = useState<any>(null);

  const [detail, setDetail] = useState<WhatsAppLogDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const fetchLogs = useCallback(async (pg: number = 1) => {
    setLoading(true);
    try {
      const filter: WhatsAppLogFilter = { page: pg, pageSize };
      if (recipient.trim()) filter.recipient = recipient.trim();
      if (title.trim()) filter.title = title.trim();
      if (club.trim()) filter.club = club.trim();
      if (district.trim()) filter.district = district.trim();
      if (status && status !== "all") filter.status = status;
      if (waType && waType !== "all") filter.waType = waType;
      if (fromDate) filter.from = fromDate;
      if (toDate) filter.to = toDate;
      const result = await getWhatsAppLog(filter);
      setItems(result.items || []);
      setTotal(result.total || 0);
      setPage(pg);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load WhatsApp log.");
    } finally {
      setLoading(false);
    }
  }, [recipient, title, club, district, status, waType, fromDate, toDate]);

  const fetchSummary = useCallback(async () => {
    try {
      const s = await getWhatsAppLogSummary();
      setSummary(s);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchLogs(1); fetchSummary(); }, []); // eslint-disable-line

  const openDetail = async (id: number) => {
    try {
      const d = await getWhatsAppLogDetail(id);
      setDetail(d);
      setDetailOpen(true);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to load message detail.");
    }
  };

  const resetFilters = () => {
    setRecipient(""); setTitle(""); setClub(""); setDistrict(""); setStatus("all"); setWaType("all"); setFromDate(""); setToDate("");
    setTimeout(() => fetchLogs(1), 0);
  };

  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      // Export exactly what the current filters match (all rows, not just this page).
      const filter: Omit<WhatsAppLogFilter, "page" | "pageSize"> = {};
      if (recipient.trim()) filter.recipient = recipient.trim();
      if (title.trim()) filter.title = title.trim();
      if (club.trim()) filter.club = club.trim();
      if (district.trim()) filter.district = district.trim();
      if (status && status !== "all") filter.status = status;
      if (waType && waType !== "all") filter.waType = waType;
      if (fromDate) filter.from = fromDate;
      if (toDate) filter.to = toDate;
      const blob = await exportWhatsAppLog(filter);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `WhatsApp_Log_${fileTimestamp()}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to export WhatsApp log.");
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
            <h1 className="text-2xl font-bold flex items-center gap-2"><MessageCircle className="h-6 w-6" /> WhatsApp Log</h1>
            <p className="text-sm text-slate-500">Every WhatsApp message sent via Interakt. &quot;Sent&quot; = accepted by Interakt; &quot;Delivered&quot;/&quot;Read&quot; come from the delivery webhook.</p>
          </div>
          <Link href="/settings"><Button variant="outline"><ArrowLeft className="h-4 w-4 mr-1" /> Back to Settings</Button></Link>
        </div>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
            <Card><CardContent className="p-3 text-center"><div className="text-xs text-slate-500">Last 24h</div><div className="text-2xl font-bold">{summary.last24h ?? 0}</div></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><div className="text-xs text-slate-500">Last 7d</div><div className="text-2xl font-bold">{summary.last7d ?? 0}</div></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><div className="text-xs text-slate-500">Last 30d</div><div className="text-2xl font-bold">{summary.last30d ?? 0}</div></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><div className="text-xs text-slate-500">Sent (all)</div><div className="text-2xl font-bold text-blue-600">{summary.totalSent ?? 0}</div></CardContent></Card>
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
              <div><Label className="text-xs">Club</Label><Input placeholder="club name…" value={club} onChange={e => setClub(e.target.value)} /></div>
              <div><Label className="text-xs">District</Label><Input placeholder="district no…" value={district} onChange={e => setDistrict(e.target.value)} /></div>
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
                    <SelectItem value="AnnouncementReminder">Announcement Reminder</SelectItem>
                    <SelectItem value="UpcomingEvent">Upcoming Event</SelectItem>
                    <SelectItem value="UpcomingEventReminder">Event Reminder</SelectItem>
                    <SelectItem value="Newsletter">Newsletter</SelectItem>
                    <SelectItem value="Project">Project</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-4 flex gap-2 mt-1 items-end">
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
                      <TableHead className="w-[150px]">Type</TableHead>
                      <TableHead className="w-[150px]">Club / District</TableHead>
                      <TableHead className="w-[70px] text-right">View</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map(it => (
                      <TableRow key={it.id} className="cursor-pointer hover:bg-slate-50" onClick={() => openDetail(it.id)}>
                        <TableCell className="text-xs">{formatDate(it.sentAt)}</TableCell>
                        <TableCell>{statusBadge(it.status)}</TableCell>
                        <TableCell className="text-xs">
                          <div className="font-medium">{it.recipientName || "—"}</div>
                          <div className="text-slate-500 break-all">{it.recipientMobile}</div>
                        </TableCell>
                        <TableCell className="text-sm">{it.title ?? "—"}</TableCell>
                        <TableCell>{typeBadge(it.whatsAppType)}</TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {it.clubName || (it.districtNumber ? `District ${it.districtNumber}` : "—")}
                        </TableCell>
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
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="text-base">{detail?.title ?? "WhatsApp Message"}</DialogTitle>
            </DialogHeader>
            {detail && (
              <div className="flex flex-col overflow-hidden">
                <div className="grid grid-cols-2 gap-2 text-xs py-3 border-b">
                  <div><span className="text-slate-500">To: </span><span className="font-medium">{detail.recipientName || "—"}</span> <span className="break-all">({detail.recipientMobile})</span></div>
                  <div><span className="text-slate-500">Status: </span>{statusBadge(detail.status)}</div>
                  <div><span className="text-slate-500">Sent: </span>{formatDate(detail.sentAt)}</div>
                  <div><span className="text-slate-500">Delivered: </span>{formatDate(detail.deliveredAt)}</div>
                  <div><span className="text-slate-500">Type: </span>{detail.whatsAppType ?? "—"}</div>
                  <div><span className="text-slate-500">Template: </span>{detail.templateName ?? "—"}</div>
                  <div><span className="text-slate-500">Club: </span>{detail.clubName ?? "—"}</div>
                  <div><span className="text-slate-500">District: </span>{detail.districtNumber ? `District ${detail.districtNumber}` : "—"}</div>
                  {detail.interaktMessageId && <div className="col-span-2"><span className="text-slate-500">Interakt ID: </span><span className="break-all">{detail.interaktMessageId}</span></div>}
                  {detail.httpStatus != null && <div><span className="text-slate-500">HTTP: </span>{detail.httpStatus}</div>}
                  {detail.errorMessage && <div className="col-span-2 text-red-600"><span className="text-slate-500">Error: </span>{detail.errorMessage}</div>}
                </div>
                <div className="flex-1 overflow-auto bg-slate-50 rounded mt-2 p-3 text-sm whitespace-pre-wrap">
                  {detail.bodyPreview || <em className="text-slate-400">No message preview</em>}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ProtectedRoute>
  );
}
