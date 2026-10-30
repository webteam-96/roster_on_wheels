"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { getDistrictMassEmailList, deleteDistrictMassEmail, sendDistrictMassEmail, getDistrict } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import SearchBox from "@/components/SearchBox";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, MoreHorizontal, Eye, Pencil, Trash2, Send, MailPlus, AlertTriangle } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

import { appLocale } from "@/lib/appFormat";
interface MassEmailItem {
  id: number; subject: string; status: string; recipientType: number;
  totalRecipients: number; sentCount: number; failedCount: number;
  sentDate: string | null; createdDate: string;
}

export default function DistrictMassEmailsPage() {
  const params = useParams();
  const router = useRouter();
  const districtId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [districtName, setDistrictName] = useState("");
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
  const canManage = isSuperAdmin || isAdmin;

  useEffect(() => { async function f() { try { const d = await getDistrict(districtId); setDistrictName(`District ${d.districtNumber}`); } catch {} } f(); }, [districtId]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const p: Record<string, any> = { page, pageSize };
      if (statusFilter) p.status = statusFilter;
      if (searchQuery) p.search = searchQuery;
      const res = await getDistrictMassEmailList(districtId, p);
      setItems(res.items); setTotalCount(res.totalCount);
    } catch {}
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
    switch (status) { case "Draft": return <Badge variant="secondary">Draft</Badge>; case "Sending": return <Badge className="bg-blue-500 hover:bg-blue-600">Sending</Badge>; case "Sent": return <Badge className="bg-green-500 hover:bg-green-600">Sent</Badge>; case "Failed": return <Badge variant="destructive">Failed</Badge>; default: return <Badge variant="secondary">{status}</Badge>; }
  };

  const getRecipientTypeLabel = (type: number) => { switch (type) { case 1: return "All Members"; case 2: return "Subgroup"; case 3: return "Selected"; default: return "Unknown"; } };
  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild><Link href={`/districts/${districtId}/dashboard`}><ArrowLeft className="h-4 w-4" /></Link></Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">{districtName ? `${districtName} - Mass Emails` : "Mass Emails"}</h2>
              <p className="text-muted-foreground text-base">Send bulk emails to district members</p>
            </div>
          </div>
          {canManage && <Button onClick={() => router.push(`/districts/${districtId}/mass-emails/compose`)}><MailPlus className="h-4 w-4 mr-2" />Compose Email</Button>}
        </div>

        <Card><CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger><SelectValue placeholder="All Statuses" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Statuses</SelectItem><SelectItem value="Draft">Draft</SelectItem><SelectItem value="Sending">Sending</SelectItem><SelectItem value="Sent">Sent</SelectItem><SelectItem value="Failed">Failed</SelectItem></SelectContent>
            </Select>
            <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="Search by subject..." />
          </div>
        </CardContent></Card>

        {loading ? <RotaryLoader /> : (
          <Card><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Subject</TableHead><TableHead>Status</TableHead><TableHead>Recipients</TableHead><TableHead>Sent</TableHead><TableHead>Failed</TableHead><TableHead>Not Delivered</TableHead><TableHead>Date</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow></TableHeader>
              <TableBody>
                {items.length === 0 ? <TableRow><TableCell colSpan={canManage ? 8 : 7} className="text-center text-muted-foreground py-8">No mass emails found.</TableCell></TableRow> :
                  items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium max-w-[250px] truncate">{item.subject}</TableCell>
                      <TableCell>{getStatusBadge(item.status)}</TableCell>
                      <TableCell><span className="text-sm">{item.totalRecipients} ({getRecipientTypeLabel(item.recipientType)})</span></TableCell>
                      <TableCell className="text-center">{item.status !== "Draft" ? <span className="text-green-600 font-medium">{item.sentCount}</span> : "–"}</TableCell>
                      <TableCell className="text-center">{item.status !== "Draft" ? (item.failedCount > 0 ? <span className="text-red-600 font-medium">{item.failedCount}</span> : "0") : "–"}</TableCell>
                      <TableCell className="text-center">{item.status !== "Draft" ? <span className="text-orange-600 font-medium">{Math.max(0, item.totalRecipients - item.sentCount - item.failedCount)}</span> : "–"}</TableCell>
                      <TableCell className="text-sm">{item.sentDate ? new Date(item.sentDate).toLocaleDateString(appLocale()) : new Date(item.createdDate).toLocaleDateString(appLocale())}</TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => router.push(`/districts/${districtId}/mass-emails/${item.id}`)}><Eye className="mr-2 h-4 w-4" /> View</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => router.push(`/districts/${districtId}/mass-emails/compose?editId=${item.id}`)}><Pencil className="mr-2 h-4 w-4" /> Edit & Resend</DropdownMenuItem>
                              {item.status === "Draft" && <>
                                <DropdownMenuItem onClick={() => setSendId(item.id)}><Send className="mr-2 h-4 w-4" /> Send</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setDeleteId(item.id)} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
                              </>}
                              {item.status === "Failed" && <DropdownMenuItem onClick={() => setSendId(item.id)}><Send className="mr-2 h-4 w-4" /> Retry</DropdownMenuItem>}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                }
              </TableBody>
            </Table>
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, totalCount)} of {totalCount}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page <= 1}>Previous</Button>
                  <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}>Next</Button>
                </div>
              </div>
            )}
          </CardContent></Card>
        )}
      </div>

      <AlertModal open={!!deleteId} icon={AlertTriangle} iconClassName="text-destructive" title="Delete Email" description="Are you sure you want to delete this draft email?" confirmLabel={processing ? "Deleting..." : "Delete"} cancelLabel="Cancel" onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />
      <AlertModal open={!!sendId} icon={Send} iconClassName="text-primary" title="Send Email" description="Are you sure you want to send this email to all recipients?" confirmLabel={processing ? "Sending..." : "Send"} cancelLabel="Cancel" onConfirm={handleSend} onCancel={() => setSendId(null)} />
      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </ProtectedRoute>
  );
}
