"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnnouncementListItem } from "@/types/announcement";
import { getDistrict, getDistrictAnnouncements, deleteDistrictAnnouncement } from "@/services/api";
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
import { ArrowLeft, Search, X, Plus, Pencil, Trash2, MoreHorizontal, FolderOpen, AlertTriangle } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";
import SendStatusBadges from "@/components/SendStatusBadges";

const STATUS_OPTIONS = [
  { value: "Published", label: "Published" },
  { value: "Unpublished", label: "Unpublished" },
  { value: "Expired", label: "Expired" },
  { value: "all", label: "All" },
];

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = { Published: "bg-green-100 text-green-700", Expired: "bg-red-100 text-red-700", Unpublished: "bg-yellow-100 text-yellow-700" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || "bg-gray-100 text-gray-700"}`}>{status}</span>;
}

function BannerBadge({ value }: { value: boolean }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${value ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"}`}>{value ? "Yes" : "No"}</span>;
}

export default function DistrictAnnouncementsPage() {
  const params = useParams();
  const router = useRouter();
  const districtId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [districtName, setDistrictName] = useState("");
  const [announcements, setAnnouncements] = useState<AnnouncementListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("Published");
  const pageSize = 20;
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AnnouncementListItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const canManage = isSuperAdmin || isAdmin;

  useEffect(() => {
    async function init() {
      try { const d = await getDistrict(districtId); setDistrictName(`District ${d.districtNumber}`); } catch { setErrorMessage("Failed to initialize."); setLoading(false); }
    }
    init();
  }, [districtId]);

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getDistrictAnnouncements(districtId, page, pageSize, statusFilter !== "all" ? statusFilter : undefined, search || undefined);
      setAnnouncements(result.items); setTotalCount(result.totalCount);
    } catch { setAnnouncements([]); setTotalCount(0); } finally { setLoading(false); }
  }, [districtId, page, search, statusFilter]);

  useEffect(() => { fetchAnnouncements(); }, [fetchAnnouncements]);

  const handleSearch = () => { setPage(1); setSearch(searchInput); };
  const clearSearch = () => { setSearchInput(""); setSearch(""); setPage(1); };
  const totalPages = Math.ceil(totalCount / pageSize);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try { await deleteDistrictAnnouncement(districtId, deleteTarget.id); setDeleteTarget(null); setSuccessMessage("Announcement deleted successfully."); fetchAnnouncements(); }
    catch { setDeleteTarget(null); setErrorMessage("Failed to delete announcement."); }
  };

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const filteredAnnouncements = announcements.filter((ann) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return ann.title?.toLowerCase().includes(q) || ann.status?.toLowerCase().includes(q);
  });

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild><Link href={`/districts/${districtId}/dashboard`}><ArrowLeft className="h-4 w-4" /></Link></Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">{districtName ? `${districtName} - Announcements` : "Announcements"}</h2>
              <p className="text-muted-foreground text-base">Manage district announcements</p>
            </div>
          </div>
          {canManage && (
            <Button onClick={() => router.push(`/districts/${districtId}/announcements/add`)}>
              <Plus className="mr-2 h-4 w-4" />Add Announcement
            </Button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
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

        {!loading && announcements.length > 0 && <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="Quick filter by title, status..." className="max-w-md" />}
        {loading && <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>}
        {!loading && announcements.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center"><FolderOpen className="h-12 w-12 text-muted-foreground mb-4" /><h3 className="text-lg font-semibold">No announcements found</h3></div>
        )}

        {!loading && filteredAnnouncements.length > 0 && (
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="w-12 text-primary-foreground text-base font-semibold">S.No.</TableHead>
                  <TableHead className="text-primary-foreground text-base font-semibold">Title</TableHead>
                  <TableHead className="text-primary-foreground text-base font-semibold">Publish Date & Time</TableHead>
                  <TableHead className="text-primary-foreground text-base font-semibold">Expiry Date & Time</TableHead>
                  <TableHead className="text-primary-foreground text-base font-semibold text-center">Banner</TableHead>
                  <TableHead className="text-primary-foreground text-base font-semibold text-center">Status</TableHead>
                  {canManage && <TableHead className="w-12 text-primary-foreground"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAnnouncements.map((ann, index) => (
                  <TableRow key={ann.id}>
                    <TableCell className="font-medium">{(page - 1) * pageSize + index + 1}</TableCell>
                    <TableCell><div className="flex items-center gap-2">{ann.imagePath && <img src={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}${ann.imagePath}`} alt="" className="h-10 w-10 rounded object-cover" />}<p className="font-medium">{ann.title}</p></div></TableCell>
                    <TableCell>{formatDateTime(ann.publishDateTime)}</TableCell>
                    <TableCell>{formatDateTime(ann.expiryDateTime)}</TableCell>
                    <TableCell className="text-center"><BannerBadge value={ann.isDisplayOnBanner} /></TableCell>
                    <TableCell className="text-center"><StatusBadge status={ann.status} /><SendStatusBadges item={ann} /></TableCell>
                    {canManage && (
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {ann.status !== "Expired" && (
                              <DropdownMenuItem onClick={() => router.push(`/districts/${districtId}/announcements/${ann.id}/edit`)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                            )}
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(ann)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
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

        <AlertModal open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)} icon={AlertTriangle} iconClassName="text-destructive" title="Delete Announcement"
          description={<>Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.title}</span>?</>}
          confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90" onConfirm={handleDelete} cancelLabel="Cancel" onCancel={() => setDeleteTarget(null)} />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
