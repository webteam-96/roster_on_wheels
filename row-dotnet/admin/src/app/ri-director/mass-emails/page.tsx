"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getRiDirectorMassEmails, deleteRiDirectorMassEmail, sendRiDirectorMassEmail, getRiDirectorCreditBalance } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import Pagination from "@/components/Pagination";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Search, X, Plus, Pencil, Trash2, MoreHorizontal, FolderOpen, AlertTriangle, Send, Eye, RotateCw } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "Draft", label: "Draft" },
  { value: "Sending", label: "Sending" },
  { value: "Sent", label: "Sent" },
  { value: "Partial", label: "Partial" },
  { value: "Failed", label: "Failed" },
];

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Draft: "bg-gray-100 text-gray-700",
    Sending: "bg-blue-100 text-blue-700",
    Sent: "bg-green-100 text-green-700",
    Partial: "bg-amber-100 text-amber-700",
    Failed: "bg-red-100 text-red-700",
  };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || "bg-gray-100 text-gray-700"}`}>{status}</span>;
}

interface MassEmailItem {
  id: number;
  subject: string;
  status: string;
  recipientType: number;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  sentDate: string | null;
  createdDate: string | null;
}

export default function RiDirectorMassEmailsPage() {
  const router = useRouter();
  const { isSuperAdmin, isRIDirector } = useAuth();
  const canManage = isSuperAdmin || isRIDirector;

  const [items, setItems] = useState<MassEmailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const pageSize = 20;
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MassEmailItem | null>(null);
  const [sendTarget, setSendTarget] = useState<MassEmailItem | null>(null);
  const [sendBalance, setSendBalance] = useState<number | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getRiDirectorMassEmails(page, pageSize, statusFilter !== "all" ? statusFilter : undefined, search || undefined);
      setItems(r.items); setTotalCount(r.totalCount);
    } catch { setItems([]); setTotalCount(0); }
    finally { setLoading(false); }
  }, [page, search, statusFilter]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try { await deleteRiDirectorMassEmail(deleteTarget.id); setDeleteTarget(null); setSuccessMessage("Mass email deleted."); fetchItems(); }
    catch { setDeleteTarget(null); setErrorMessage("Failed to delete."); }
  };

  const openSendConfirm = async (item: MassEmailItem) => {
    setSendTarget(item);
    try {
      const b = await getRiDirectorCreditBalance();
      setSendBalance(b.emailBalance);
    } catch { setSendBalance(null); }
  };

  const handleSend = async () => {
    if (!sendTarget) return;
    if (sendBalance !== null && sendTarget.totalRecipients > sendBalance) {
      setSendTarget(null);
      setSendBalance(null);
      setErrorMessage(`Insufficient Email credits. Required: ${sendTarget.totalRecipients}, Available: ${sendBalance}.`);
      return;
    }
    try {
      await sendRiDirectorMassEmail(sendTarget.id);
      setSendTarget(null); setSendBalance(null);
      setSuccessMessage("Mass email is being sent.");
      fetchItems();
    } catch (e: any) { setSendTarget(null); setSendBalance(null); setErrorMessage(e?.response?.data?.message || "Failed to send."); }
  };

  const totalPages = Math.ceil(totalCount / pageSize);
  const formatDateTime = (s: string | null) => s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild><Link href="/ri-director"><ArrowLeft className="h-4 w-4" /></Link></Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">RI Director - Mass Emails</h2>
              <p className="text-muted-foreground text-base">Send emails to members nationwide</p>
            </div>
          </div>
          {canManage && <Button onClick={() => router.push("/ri-director/mass-emails/compose")}><Plus className="mr-2 h-4 w-4" />Compose</Button>}
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="w-full sm:w-44">
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUS_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search by subject..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (setPage(1), setSearch(searchInput))} className="pl-9" />
              {searchInput && <button onClick={() => { setSearchInput(""); setSearch(""); setPage(1); }} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="h-4 w-4" /></button>}
            </div>
            <Button size="sm" onClick={() => { setPage(1); setSearch(searchInput); }}>Search</Button>
          </div>
        </div>

        {loading && <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>}
        {!loading && items.length === 0 && <div className="flex flex-col items-center justify-center py-20 text-center"><FolderOpen className="h-12 w-12 text-muted-foreground mb-4" /><h3 className="text-lg font-semibold">No mass emails</h3></div>}
        {!loading && items.length > 0 && (
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="w-12 text-primary-foreground font-semibold">S.No.</TableHead>
                  <TableHead className="text-primary-foreground font-semibold">Subject</TableHead>
                  <TableHead className="text-primary-foreground font-semibold text-center">Recipients</TableHead>
                  <TableHead className="text-primary-foreground font-semibold text-center">Sent</TableHead>
                  <TableHead className="text-primary-foreground font-semibold text-center">Failed</TableHead>
                  <TableHead className="text-primary-foreground font-semibold text-center">Status</TableHead>
                  <TableHead className="text-primary-foreground font-semibold">Sent Date</TableHead>
                  {canManage && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((e, i) => (
                  <TableRow key={e.id}>
                    <TableCell>{(page - 1) * pageSize + i + 1}</TableCell>
                    <TableCell className="font-medium">{e.subject}</TableCell>
                    <TableCell className="text-center">{e.totalRecipients}</TableCell>
                    <TableCell className="text-center text-green-700">{e.sentCount}</TableCell>
                    <TableCell className="text-center text-red-700">{e.failedCount}</TableCell>
                    <TableCell className="text-center"><StatusBadge status={e.status} /></TableCell>
                    <TableCell>{formatDateTime(e.sentDate)}</TableCell>
                    {canManage && (
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => router.push(`/ri-director/mass-emails/${e.id}`)}><Eye className="mr-2 h-4 w-4" />View</DropdownMenuItem>
                            {e.status === "Draft" && <>
                              <DropdownMenuItem onClick={() => router.push(`/ri-director/mass-emails/${e.id}/edit`)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openSendConfirm(e)}><Send className="mr-2 h-4 w-4" />Send Now</DropdownMenuItem>
                            </>}
                            {(e.status === "Failed" || e.status === "Partial" || e.status === "Sending") && (
                              <DropdownMenuItem onClick={() => openSendConfirm(e)}><RotateCw className="mr-2 h-4 w-4" />Resume / Retry</DropdownMenuItem>
                            )}
                            {(e.status === "Draft" || e.status === "Failed") && <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(e)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        )}
        {!loading && totalPages > 1 && <Pagination page={page} totalPages={totalPages} totalCount={totalCount} pageSize={pageSize} onPageChange={setPage} />}

        <AlertModal open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)} icon={AlertTriangle} iconClassName="text-destructive" title="Delete Mass Email" description={<>Delete <span className="font-semibold">{deleteTarget?.subject}</span>?</>} confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90" onConfirm={handleDelete} cancelLabel="Cancel" onCancel={() => setDeleteTarget(null)} />
        <AlertModal
          open={!!sendTarget}
          onOpenChange={(o) => { if (!o) { setSendTarget(null); setSendBalance(null); } }}
          icon={Send}
          iconClassName={sendBalance !== null && sendTarget && sendTarget.totalRecipients > sendBalance ? "text-destructive" : "text-primary"}
          title="Send Mass Email"
          description={
            <div className="space-y-2">
              <p>Send to <span className="font-semibold">{sendTarget?.totalRecipients}</span> recipient(s)?</p>
              <div className="text-sm border-t pt-2 space-y-1">
                <div>Required Email credits: <span className="font-semibold">{sendTarget?.totalRecipients ?? 0}</span></div>
                <div>Available balance: <span className={`font-semibold ${sendBalance !== null && sendTarget && sendTarget.totalRecipients > sendBalance ? "text-destructive" : "text-green-700"}`}>{sendBalance === null ? "..." : sendBalance}</span></div>
                {sendBalance !== null && sendTarget && sendTarget.totalRecipients > sendBalance && (
                  <div className="text-destructive font-medium mt-1">⚠️ Insufficient credits. Send blocked.</div>
                )}
              </div>
            </div>
          }
          confirmLabel="Send"
          confirmClassName={sendBalance !== null && sendTarget && sendTarget.totalRecipients > sendBalance ? "bg-muted text-muted-foreground cursor-not-allowed" : ""}
          onConfirm={handleSend}
          cancelLabel="Cancel"
          onCancel={() => { setSendTarget(null); setSendBalance(null); }}
        />
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
