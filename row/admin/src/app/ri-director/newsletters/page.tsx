"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getRiDirectorNewsletters, deleteRiDirectorNewsletter } from "@/services/api";
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
import { ArrowLeft, Search, X, Plus, Pencil, Trash2, MoreHorizontal, FolderOpen, AlertTriangle, ExternalLink } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

import { appLocale } from "@/lib/appFormat";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
const STATUS_OPTIONS = [{ value: "all", label: "All" }, { value: "Published", label: "Published" }, { value: "Expired", label: "Expired" }, { value: "Unpublished", label: "Unpublished" }];

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = { Published: "bg-green-100 text-green-700", Expired: "bg-red-100 text-red-700", Unpublished: "bg-yellow-100 text-yellow-700" };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${colors[status] || "bg-gray-100 text-gray-700"}`}>{status}</span>;
}

interface Item { id: number; title: string; publishDateTime: string; expiryDateTime: string; attachmentType: string; linkUrl: string | null; filePath: string | null; status: string; }

export default function Page() {
  const router = useRouter();
  const { isSuperAdmin, isRIDirector } = useAuth();
  const canManage = isSuperAdmin || isRIDirector;
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const pageSize = 20;
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getRiDirectorNewsletters(page, pageSize, statusFilter !== "all" ? statusFilter : undefined, search || undefined);
      setItems(r.items); setTotalCount(r.totalCount);
    } catch { setItems([]); setTotalCount(0); }
    finally { setLoading(false); }
  }, [page, search, statusFilter]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try { await deleteRiDirectorNewsletter(deleteTarget.id); setDeleteTarget(null); setSuccessMessage("Deleted."); fetchItems(); }
    catch { setDeleteTarget(null); setErrorMessage("Failed to delete."); }
  };

  const totalPages = Math.ceil(totalCount / pageSize);
  const fmt = (s: string | null) => s ? new Date(s).toLocaleString(appLocale(), { day: "2-digit", month: "short", year: "numeric" }) : "-";

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild><Link href="/ri-director"><ArrowLeft className="h-4 w-4" /></Link></Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">RI Director - Newsletters</h2>
              <p className="text-muted-foreground">Share newsletters nationwide</p>
            </div>
          </div>
          {canManage && <Button onClick={() => router.push("/ri-director/newsletters/add")}><Plus className="mr-2 h-4 w-4" />Add Newsletter</Button>}
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
              <Input placeholder="Search..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (setPage(1), setSearch(searchInput))} className="pl-9" />
              {searchInput && <button onClick={() => { setSearchInput(""); setSearch(""); setPage(1); }} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="h-4 w-4" /></button>}
            </div>
            <Button size="sm" onClick={() => { setPage(1); setSearch(searchInput); }}>Search</Button>
          </div>
        </div>

        {loading && <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>}
        {!loading && items.length === 0 && <div className="flex flex-col items-center justify-center py-20 text-center"><FolderOpen className="h-12 w-12 text-muted-foreground mb-4" /><h3 className="text-lg font-semibold">No newsletters</h3></div>}
        {!loading && items.length > 0 && (
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="w-12 text-primary-foreground font-semibold">#</TableHead>
                  <TableHead className="text-primary-foreground font-semibold">Title</TableHead>
                  <TableHead className="text-primary-foreground font-semibold">Attachment</TableHead>
                  <TableHead className="text-primary-foreground font-semibold">Publish</TableHead>
                  <TableHead className="text-primary-foreground font-semibold text-center">Status</TableHead>
                  {canManage && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((n, i) => {
                  const url = n.attachmentType === "link" ? n.linkUrl : (n.filePath ? `${API_URL}${n.filePath}` : null);
                  return (
                    <TableRow key={n.id}>
                      <TableCell>{(page - 1) * pageSize + i + 1}</TableCell>
                      <TableCell className="font-medium">{n.title}</TableCell>
                      <TableCell>{url ? <a href={url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm">{n.attachmentType} <ExternalLink className="h-3 w-3" /></a> : n.attachmentType}</TableCell>
                      <TableCell>{fmt(n.publishDateTime)}</TableCell>
                      <TableCell className="text-center"><StatusBadge status={n.status} /></TableCell>
                      {canManage && (
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => router.push(`/ri-director/newsletters/${n.id}/edit`)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(n)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent></Card>
        )}
        {!loading && totalPages > 1 && <Pagination page={page} totalPages={totalPages} totalCount={totalCount} pageSize={pageSize} onPageChange={setPage} />}

        <AlertModal open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)} icon={AlertTriangle} iconClassName="text-destructive" title="Delete Newsletter" description={<>Delete <span className="font-semibold">{deleteTarget?.title}</span>?</>} confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90" onConfirm={handleDelete} cancelLabel="Cancel" onCancel={() => setDeleteTarget(null)} />
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
