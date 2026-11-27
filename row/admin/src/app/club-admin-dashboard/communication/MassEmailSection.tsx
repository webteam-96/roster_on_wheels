"use client";

/**
 * Club Admin · Communication → Mass Email (V2, inside the club-admin shell).
 * Rendered inline as a tab of the Communication page. Compose / Edit / View route
 * to the sibling pages under /club-admin-dashboard/communication/mass-email/*.
 */

import { Card } from "@/components/ui/card";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getMassEmailList, deleteMassEmail, sendMassEmail } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { clubYearRights, canEditYearless, isCurrentYearSelected, heldYearLabels } from "@/lib/adminYears";
import { useSearchParams } from "next/navigation";
import { useClubAdminCache } from "@/contexts/ClubAdminDashboardCacheContext";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import SearchBox from "@/components/SearchBox";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import RotaryLoader from "@/components/RotaryLoader";
import { Plus, MoreHorizontal, Eye, Pencil, Trash2, Send, Mail, AlertTriangle } from "@/components/icons";

import { appLocale } from "@/lib/appFormat";
import Pagination from "@/components/Pagination";
const BASE = "/club-admin-dashboard/communication/mass-email";
const RETURN_TO = "/club-admin-dashboard/communication?tab=massemail";

interface MassEmailItem {
  id: number; subject: string; status: string; recipientType: number;
  totalRecipients: number; sentCount: number; failedCount: number;
  sentDate: string | null; createdDate: string;
}

export default function MassEmailSection({ clubId }: { clubId: number }) {
  const { isSuperAdmin, isAdmin, user } = useAuth();
  const router = useRouter();
  // Mass emails carry NO Rotary year — sending one is a current-year action.
  const { years, currentYearId } = useRotaryYears();
  const yearRights = useMemo(() => clubYearRights(user?.scopedRoles, clubId), [user?.scopedRoles, clubId]);
  const isClubAdmin = isSuperAdmin || isAdmin;
  // ⚠️ AND the picker: this data has no Rotary year, so the year-less rule alone
  // kept Add and Edit on screen while a past year was selected, which reads as
  // the year rule having failed. The list is not year-filtered — nothing else
  // on the screen changes, only the buttons.
  // Both hooks are called unconditionally: folding them into the || would skip
  // one whenever the URL carries a year, which React counts as a hook-order
  // change and crashes on.
  const yearParams = useSearchParams();
  const yearCache = useClubAdminCache();
  const selectedYearId = Number(yearParams?.get("yearId") ?? "") || yearCache.yearId || 0;
  // The badge on these screens names the CURRENT year, not the member's own
  // years — those do not help here, because only a current-year admin can
  // ever change this data.
  const currentYearLabel = years.find((y) => y.isCurrent)?.yearLabel ?? "";
  const canManage = isClubAdmin
    && canEditYearless(yearRights, currentYearId, isSuperAdmin)
    && isCurrentYearSelected(selectedYearId, currentYearId, yearRights);
  const editableYears = heldYearLabels(yearRights, years.map((y) => ({ id: y.id, label: y.yearLabel })));

  const [items, setItems] = useState<MassEmailItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [sendId, setSendId] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const pageSize = 20;

  const go = (path: string) => router.push(`${path}?returnTo=${encodeURIComponent(RETURN_TO)}`);

  const fetchList = useCallback(async () => {
    if (!clubId) { setLoading(false); return; }
    setLoading(true);
    try {
      const p: Record<string, any> = { page, pageSize };
      if (statusFilter) p.status = statusFilter;
      if (searchQuery) p.search = searchQuery;
      const res = await getMassEmailList(clubId, p);
      setItems(res.items); setTotalCount(res.totalCount);
    } catch { setErrorMessage("Failed to load mass emails."); }
    setLoading(false);
  }, [clubId, page, statusFilter, searchQuery]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleDelete = async () => {
    if (!deleteId) return; setProcessing(true);
    try { await deleteMassEmail(clubId, deleteId); setSuccessMessage("Email deleted successfully."); setDeleteId(null); fetchList(); }
    catch (err: any) { setErrorMessage(err?.response?.data?.message || "Failed to delete."); setDeleteId(null); }
    setProcessing(false);
  };
  const handleSend = async () => {
    if (!sendId) return; setProcessing(true);
    try { await sendMassEmail(clubId, sendId); setSuccessMessage("Email is being sent."); setSendId(null); fetchList(); }
    catch (err: any) { setErrorMessage(err?.response?.data?.message || "Failed to send."); setSendId(null); }
    setProcessing(false);
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      Draft: "border-slate-200 bg-slate-50 text-slate-600",
      Sending: "border-blue-200 bg-blue-50 text-blue-700",
      Sent: "border-emerald-200 bg-emerald-50 text-emerald-700",
      Failed: "border-red-200 bg-red-50 text-red-700",
    };
    return <Badge variant="outline" className={map[status] || map.Draft}>{status}</Badge>;
  };
  const recipientLabel = (t: number) => (t === 1 ? "All Members" : t === 2 ? "Subgroup" : t === 3 ? "Selected" : "–");
  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="space-y-4">
      {!canManage && (
        <ViewOnlyBadge currentYearOnly={currentYearLabel} className="mb-3" />
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-slate-700">
          <Mail className="h-4 w-4" /><span className="text-sm font-semibold">Mass Email: send bulk emails to club members</span>
        </div>
        {canManage && (
          <Button onClick={() => go(`${BASE}/compose`)}>
            <Plus className="mr-2 h-4 w-4" />New Email
          </Button>
        )}
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select value={statusFilter || "all"} onValueChange={(v) => { setStatusFilter(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger><SelectValue placeholder="All Statuses" /></SelectTrigger>
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
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-16"><RotaryLoader size="lg" /></div>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:opacity-100 border-b-2 border-marigold" style={{ backgroundColor: "#17458f" }}>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead className="text-center">Sent</TableHead>
                  <TableHead className="text-center">Failed</TableHead>
                  <TableHead>Created</TableHead>
                  {canManage && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow><TableCell colSpan={canManage ? 7 : 6} className="text-center text-slate-500 py-10">No mass emails found.</TableCell></TableRow>
                ) : items.map((item) => (
                  <TableRow key={item.id} className="hover:bg-slate-50/70 transition-colors border-slate-100">
                    <TableCell className="font-semibold text-slate-800 max-w-[250px] truncate">{item.subject}</TableCell>
                    <TableCell>{statusBadge(item.status)}</TableCell>
                    <TableCell className="text-sm text-slate-700">{item.totalRecipients} <span className="text-slate-400">({recipientLabel(item.recipientType)})</span></TableCell>
                    <TableCell className="text-center text-sm">{item.status !== "Draft" ? <span className="text-emerald-600 font-medium">{item.sentCount}</span> : <span className="text-slate-400">–</span>}</TableCell>
                    <TableCell className="text-center text-sm">{item.status !== "Draft" ? (item.failedCount > 0 ? <span className="text-red-600 font-medium">{item.failedCount}</span> : <span className="text-slate-500">0</span>) : <span className="text-slate-400">–</span>}</TableCell>
                    <TableCell className="text-sm text-slate-600">{new Date(item.createdDate).toLocaleDateString(appLocale())}</TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="row-btn-sm"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => go(`${BASE}/${item.id}`)}><Eye className="mr-2 h-4 w-4" /> View</DropdownMenuItem>
                            {item.status === "Draft" && (
                              <>
                                <DropdownMenuItem onClick={() => router.push(`${BASE}/compose?editId=${item.id}&returnTo=${encodeURIComponent(RETURN_TO)}`)}><Pencil className="mr-2 h-4 w-4" /> Edit</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setSendId(item.id)}><Send className="mr-2 h-4 w-4" /> Send</DropdownMenuItem>
                                <DropdownMenuItem className="text-red-600 focus:text-red-700" onClick={() => setDeleteId(item.id)}><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
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
            <div className="px-4 py-3 border-t border-slate-100"><Pagination page={page} totalPages={totalPages} totalCount={totalCount} pageSize={pageSize} onPageChange={setPage} /></div>
          )}
        </Card>
      )}

      <AlertModal open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)} icon={AlertTriangle} iconClassName="text-red-500"
        title="Delete Email" description="Delete this draft email? This cannot be undone."
        confirmLabel={processing ? "Deleting..." : "Delete"} confirmClassName="bg-red-600 text-white hover:bg-red-700"
        cancelLabel="Cancel" onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />
      <AlertModal open={!!sendId} onOpenChange={(o) => !o && setSendId(null)} icon={Send} iconClassName="text-ink"
        title="Send Email" description="Send this email to all recipients now?"
        confirmLabel={processing ? "Sending..." : "Send"} cancelLabel="Cancel" onConfirm={handleSend} onCancel={() => setSendId(null)} />
      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </div>
  );
}
