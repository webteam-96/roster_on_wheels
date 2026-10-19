"use client";

/**
 * V2 — Mass Email listing under the District Admin dashboard shell.
 * ---------------------------------------------------------------------------
 * Additive port of the V1 listing
 *   (src/app/districts/[id]/mass-emails/page.tsx)
 * with V2 conventions:
 *   - districtId from useAuth().selectedDistrictId (no /districts/[id] param).
 *   - Back honours ?returnTo=; falls back to the quick-links landing.
 *   - Compose / View / Edit carry returnTo = THIS listing URL (with its live
 *     status/search/page filters) so Save/Cancel/Back/Send land back here with
 *     the same filters applied.
 *   - ?yearId= (top-bar year) is forwarded through every navigation even
 *     though mass emails are NOT year-scoped.
 *   - Design palette: navy #17458f, gold #F7A81B, slate borders/text,
 *     rounded-2xl white cards, navy table header w/ gold underline.
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getDistrictMassEmailList, deleteDistrictMassEmail, sendDistrictMassEmail, getDistrict,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import SearchBox from "@/components/SearchBox";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
  ArrowLeft, Plus, MoreHorizontal, Eye, Pencil, Trash2, Send, Mail, AlertTriangle,
} from "@/components/icons";

import { appLocale } from "@/lib/appFormat";
const BASE = "/district-admin-dashboard/quick-links/mass-email";

function withSearch(base: string, extra: Record<string, string | null | undefined>) {
  const p = new URLSearchParams();
  Object.entries(extra).forEach(([k, v]) => { if (v) p.set(k, v); });
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

interface MassEmailItem {
  id: number; subject: string; status: string; recipientType: number;
  totalRecipients: number; sentCount: number; failedCount: number;
  sentDate: string | null; createdDate: string;
}

export default function DistrictAdminMassEmailListPage() {
  const { selectedDistrictId, isSuperAdmin, isAdmin } = useAuth();
  const districtId = selectedDistrictId ?? 0;
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const yearId = searchParams.get("yearId");

  const [districtNumber, setDistrictNumber] = useState("");
  const [items, setItems] = useState<MassEmailItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(searchParams.get("page") ? Number(searchParams.get("page")) : 1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [sendId, setSendId] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const pageSize = 20;
  const canManage = isSuperAdmin || isAdmin;

  // Current listing URL (with live filters) — passed to child pages as
  // returnTo so Save/Cancel/Back/Send return here with the same filters.
  const selfReturn = withSearch(BASE, {
    status: statusFilter || null,
    search: searchQuery || null,
    page: page > 1 ? String(page) : null,
    yearId,
  });

  const goBack = () => router.push(withSearch(returnTo || "/district-admin-dashboard/quick-links", { yearId }));

  useEffect(() => {
    if (!districtId) return;
    getDistrict(districtId).then((d) => setDistrictNumber(d.districtNumber)).catch(() => {});
  }, [districtId]);

  const fetchList = useCallback(async () => {
    if (!districtId) { setLoading(false); return; }
    setLoading(true);
    try {
      const p: Record<string, any> = { page, pageSize };
      if (statusFilter) p.status = statusFilter;
      if (searchQuery) p.search = searchQuery;
      const res = await getDistrictMassEmailList(districtId, p);
      setItems(res.items); setTotalCount(res.totalCount);
    } catch { setErrorMessage("Failed to load mass emails."); }
    setLoading(false);
  }, [districtId, page, statusFilter, searchQuery]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleDelete = async () => {
    if (!deleteId) return; setProcessing(true);
    try { await deleteDistrictMassEmail(districtId, deleteId); setSuccessMessage("Email deleted successfully."); setDeleteId(null); fetchList(); }
    catch (err: any) { setErrorMessage(err?.response?.data?.message || "Failed to delete."); setDeleteId(null); }
    setProcessing(false);
  };

  const handleSend = async () => {
    if (!sendId) return; setProcessing(true);
    try { await sendDistrictMassEmail(districtId, sendId); setSuccessMessage("Email is being sent."); setSendId(null); fetchList(); }
    catch (err: any) { setErrorMessage(err?.response?.data?.message || "Failed to send."); setSendId(null); }
    setProcessing(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Draft": return <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">Draft</Badge>;
      case "Sending": return <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">Sending</Badge>;
      case "Sent": return <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Sent</Badge>;
      case "Failed": return <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">Failed</Badge>;
      default: return <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">{status}</Badge>;
    }
  };

  const getRecipientTypeLabel = (type: number) => {
    switch (type) { case 1: return "All Members"; case 2: return "Clubs"; case 3: return "Subgroups"; default: return "–"; }
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  if (!districtId) return null;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={goBack}
              className="border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-azure/10 text-ink">
                <Mail size={20} />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-ink">
                  {districtNumber ? `District ${districtNumber} · Mass Email` : "Mass Email"}
                </h2>
                <p className="text-slate-500 text-sm mt-0.5">Send bulk emails to district members</p>
              </div>
            </div>
          </div>
          {canManage && (
            <Button
              onClick={() => router.push(withSearch(`${BASE}/compose`, { returnTo: selfReturn, yearId }))}
              className="bg-azure hover:bg-mint-ink text-white"
            >
              <Plus className="mr-2 h-4 w-4" />New Email
            </Button>
          )}
        </div>

        {/* Filters */}
        <div className="rounded-2xl border border-slate-200 shadow-sm bg-white p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              value={statusFilter || "all"}
              onValueChange={(v) => { setStatusFilter(v === "all" ? "" : v); setPage(1); }}
            >
              <SelectTrigger className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="Draft">Draft</SelectItem>
                <SelectItem value="Sending">Sending</SelectItem>
                <SelectItem value="Sent">Sent</SelectItem>
                <SelectItem value="Failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <SearchBox value={searchQuery} onChange={(v) => { setSearchQuery(v); setPage(1); }} placeholder="Search by subject..." />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>
        ) : (
          <div className="rounded-2xl border border-slate-200 shadow-sm overflow-hidden bg-white">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:opacity-100 border-b-2 border-marigold" style={{ backgroundColor: "#17458f" }}>
                    <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Subject</TableHead>
                    <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Status</TableHead>
                    <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Recipients</TableHead>
                    <TableHead className="text-white text-xs font-semibold uppercase tracking-wide text-center">Sent</TableHead>
                    <TableHead className="text-white text-xs font-semibold uppercase tracking-wide text-center">Failed</TableHead>
                    <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Created</TableHead>
                    {canManage && <TableHead className="text-white text-xs font-semibold uppercase tracking-wide text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={canManage ? 7 : 6} className="text-center text-slate-500 py-10">No mass emails found.</TableCell>
                    </TableRow>
                  ) : items.map((item) => (
                    <TableRow key={item.id} className="hover:bg-slate-50/70 transition-colors border-slate-100">
                      <TableCell className="font-semibold text-slate-800 max-w-[250px] truncate">{item.subject}</TableCell>
                      <TableCell>{getStatusBadge(item.status)}</TableCell>
                      <TableCell className="text-sm text-slate-700">{item.totalRecipients} <span className="text-slate-400">({getRecipientTypeLabel(item.recipientType)})</span></TableCell>
                      <TableCell className="text-center text-sm">{item.status !== "Draft" ? <span className="text-emerald-600 font-medium">{item.sentCount}</span> : <span className="text-slate-400">, </span>}</TableCell>
                      <TableCell className="text-center text-sm">{item.status !== "Draft" ? (item.failedCount > 0 ? <span className="text-red-600 font-medium">{item.failedCount}</span> : <span className="text-slate-500">0</span>) : <span className="text-slate-400">, </span>}</TableCell>
                      <TableCell className="text-sm text-slate-600">{new Date(item.createdDate).toLocaleDateString(appLocale())}</TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-slate-800 hover:bg-slate-100">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => router.push(withSearch(`${BASE}/${item.id}`, { returnTo: selfReturn, yearId }))}>
                                <Eye className="mr-2 h-4 w-4" /> View
                              </DropdownMenuItem>
                              {item.status === "Draft" && (
                                <>
                                  <DropdownMenuItem onClick={() => router.push(withSearch(`${BASE}/compose`, { editId: String(item.id), returnTo: selfReturn, yearId }))}>
                                    <Pencil className="mr-2 h-4 w-4" /> Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setSendId(item.id)}>
                                    <Send className="mr-2 h-4 w-4" /> Send
                                  </DropdownMenuItem>
                                  <DropdownMenuItem className="text-red-600 focus:text-red-700" onClick={() => setDeleteId(item.id)}>
                                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
                <p className="text-sm text-slate-500">
                  Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, totalCount)} of {totalCount}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="border-slate-200" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>Previous</Button>
                  <Button variant="outline" size="sm" className="border-slate-200" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>Next</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <AlertModal
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        icon={AlertTriangle}
        iconClassName="text-red-500"
        title="Delete Email"
        description="Are you sure you want to delete this draft email? This action cannot be undone."
        confirmLabel={processing ? "Deleting..." : "Delete"}
        confirmClassName="bg-red-600 text-white hover:bg-red-700"
        cancelLabel="Cancel"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
      <AlertModal
        open={!!sendId}
        onOpenChange={(o) => !o && setSendId(null)}
        icon={Send}
        iconClassName="text-ink"
        title="Send Email"
        description="Send this email to all recipients now?"
        confirmLabel={processing ? "Sending..." : "Send"}
        cancelLabel="Cancel"
        onConfirm={handleSend}
        onCancel={() => setSendId(null)}
      />
      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </ProtectedRoute>
  );
}
