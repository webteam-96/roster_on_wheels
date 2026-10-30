"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { NewsletterListItem } from "@/types/newsletter";
import { getDistrict, getDistrictNewsletters, deleteDistrictNewsletter, getDistrictNewsletterYears } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import Pagination from "@/components/Pagination";
import SearchBox from "@/components/SearchBox";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Search, X, Plus, Pencil, Trash2, MoreHorizontal, FolderOpen, AlertTriangle, Download, ExternalLink } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SendStatusBadges from "@/components/SendStatusBadges";

import { appLocale } from "@/lib/appFormat";
import { ListPageSkeleton } from "@/components/row/AppKit";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
const STATUS_OPTIONS = [{ value: "all", label: "All" }, { value: "Published", label: "Published" }, { value: "Expired", label: "Expired" }, { value: "Unpublished", label: "Unpublished" }];

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = { Published: "bg-green-100 text-green-700", Expired: "bg-red-100 text-red-700", Unpublished: "bg-yellow-100 text-yellow-700" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || "bg-gray-100 text-gray-700"}`}>{status}</span>;
}

function TypeBadge({ type }: { type: string }) {
  const isLink = type === "link";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${isLink ? "bg-blue-100 text-blue-700" : "bg-[#CFE2F6] text-purple-700"}`}>{isLink ? "Link" : "File"}</span>;
}

export default function DistrictNewslettersPage() {
  const params = useParams();
  const router = useRouter();
  const districtId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [districtName, setDistrictName] = useState("");
  const [newsletters, setNewsletters] = useState<NewsletterListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const pageSize = 20;
  const [years, setYears] = useState<{ id: number; yearLabel: string; isCurrent: boolean }[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NewsletterListItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const canManage = isSuperAdmin || isAdmin;

  useEffect(() => {
    async function init() {
      try {
        const [d, nlYears] = await Promise.all([getDistrict(districtId), getDistrictNewsletterYears(districtId)]);
        setDistrictName(`District ${d.districtNumber}`);
        setYears(nlYears);
        const currentYear = nlYears.find((y: any) => y.isCurrent);
        setSelectedYearId(currentYear ? currentYear.id : nlYears.length > 0 ? nlYears[0].id : null);
      } catch { setErrorMessage("Failed to initialize."); setLoading(false); }
    }
    init();
  }, [districtId]);

  const fetchNewsletters = useCallback(async () => {
    if (!selectedYearId) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await getDistrictNewsletters(districtId, selectedYearId, page, pageSize, statusFilter !== "all" ? statusFilter : undefined, search || undefined);
      setNewsletters(result.items); setTotalCount(result.totalCount);
    } catch { setNewsletters([]); setTotalCount(0); } finally { setLoading(false); }
  }, [districtId, selectedYearId, page, search, statusFilter]);

  useEffect(() => { fetchNewsletters(); }, [fetchNewsletters]);

  const handleSearch = () => { setPage(1); setSearch(searchInput); };
  const clearSearch = () => { setSearchInput(""); setSearch(""); setPage(1); };
  const totalPages = Math.ceil(totalCount / pageSize);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try { await deleteDistrictNewsletter(districtId, deleteTarget.id); setDeleteTarget(null); setSuccessMessage("Newsletter deleted successfully."); fetchNewsletters(); }
    catch { setDeleteTarget(null); setErrorMessage("Failed to delete newsletter."); }
  };

  const formatDateTime = (dateStr: string | null) => { if (!dateStr) return "-"; return new Date(dateStr).toLocaleString(appLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); };

  const filteredNewsletters = newsletters.filter((nl) => { if (!searchQuery) return true; const q = searchQuery.toLowerCase(); return (nl.title || "").toLowerCase().includes(q) || (nl.status || "").toLowerCase().includes(q); });

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild><Link href={`/districts/${districtId}/dashboard`}><ArrowLeft className="h-4 w-4" /></Link></Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">{districtName ? `${districtName} - Newsletters` : "Newsletters"}</h2>
              <p className="text-muted-foreground text-base">Manage district newsletters</p>
            </div>
          </div>
          {canManage && (
            <Button onClick={() => router.push(`/districts/${districtId}/newsletters/add`)}>
              <Plus className="mr-2 h-4 w-4" />Add Newsletter
            </Button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="w-full sm:w-48">
            <Select value={selectedYearId ? String(selectedYearId) : ""} onValueChange={(v) => { setSelectedYearId(Number(v)); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{years.map((y) => <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-44">
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger><SelectValue placeholder="Filter by status" /></SelectTrigger>
              <SelectContent>{STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search by title..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()} className="pl-9" />
              {searchInput && <button onClick={clearSearch} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="h-4 w-4 text-muted-foreground hover:text-foreground" /></button>}
            </div>
            <Button onClick={handleSearch} size="sm">Search</Button>
          </div>
        </div>

        {loading && <div className="flex items-center justify-center py-20"><ListPageSkeleton /></div>}
        {!loading && newsletters.length > 0 && <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="Search by title, date..." />}
        {!loading && newsletters.length === 0 && <div className="flex flex-col items-center justify-center py-20 text-center"><FolderOpen className="h-12 w-12 text-muted-foreground mb-4" /><h3 className="text-lg font-semibold">No newsletters found</h3></div>}

        {!loading && filteredNewsletters.length > 0 && (
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="w-12 text-primary-foreground text-base font-semibold">S.No.</TableHead>
                  <TableHead className="text-primary-foreground text-base font-semibold">Title</TableHead>
                  <TableHead className="text-primary-foreground text-base font-semibold">Publish Date & Time</TableHead>
                  <TableHead className="text-primary-foreground text-base font-semibold text-center">Type</TableHead>
                  <TableHead className="text-primary-foreground text-base font-semibold text-center">Status</TableHead>
                  <TableHead className="w-12 text-primary-foreground text-base font-semibold text-center">Download</TableHead>
                  {canManage && <TableHead className="w-12 text-primary-foreground"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredNewsletters.map((nl, index) => (
                  <TableRow key={nl.id}>
                    <TableCell className="font-medium">{(page - 1) * pageSize + index + 1}</TableCell>
                    <TableCell><p className="font-medium">{nl.title}</p></TableCell>
                    <TableCell>{formatDateTime(nl.publishDateTime)}</TableCell>
                    <TableCell className="text-center"><TypeBadge type={nl.attachmentType} /></TableCell>
                    <TableCell className="text-center"><StatusBadge status={nl.status} /><div className="mt-1 flex justify-center"><SendStatusBadges item={nl} /></div></TableCell>
                    <TableCell className="text-center">
                      {nl.attachmentType === "file" && nl.filePath ? (
                        <a href={`${API_URL}${nl.filePath}`} download target="_blank" rel="noopener noreferrer"><Button variant="ghost" size="icon" className="h-8 w-8 text-primary hover:text-primary"><Download className="h-4 w-4" /></Button></a>
                      ) : nl.attachmentType === "link" && nl.linkUrl ? (
                        <a href={nl.linkUrl} target="_blank" rel="noopener noreferrer"><Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:text-blue-700"><ExternalLink className="h-4 w-4" /></Button></a>
                      ) : "-"}
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">{nl.status !== "Expired" && (<DropdownMenuItem onClick={() => router.push(`/districts/${districtId}/newsletters/${nl.id}/edit`)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>)}<DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(nl)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem></DropdownMenuContent>
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

        <AlertModal open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)} icon={AlertTriangle} iconClassName="text-destructive" title="Delete Newsletter"
          description={<>Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.title}</span>?</>}
          confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90" onConfirm={handleDelete} cancelLabel="Cancel" onCancel={() => setDeleteTarget(null)} />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
