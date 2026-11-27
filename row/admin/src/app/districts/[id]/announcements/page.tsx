"use client";
import { ClearButton } from "@/components/ui/text-buttons";

import PublishStatusBadge from "@/components/PublishStatusBadge";
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
import { Search, X, Plus, Pencil, Trash2, MoreHorizontal, FolderOpen, AlertTriangle } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";
import SendStatusBadges from "@/components/SendStatusBadges";

import { appLocale } from "@/lib/appFormat";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
const STATUS_OPTIONS = [
  { value: "Published", label: "Published" },
  { value: "Unpublished", label: "Unpublished" },
  { value: "Expired", label: "Expired" },
  { value: "all", label: "All" },
];


function BannerBadge({ value }: { value: boolean }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${value ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"}`}>{value ? "Yes" : "No"}</span>;
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
    return new Date(dateStr).toLocaleString(appLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const filteredAnnouncements = announcements.filter((ann) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return ann.title?.toLowerCase().includes(q) || ann.status?.toLowerCase().includes(q);
  });

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <PageHeader
          title={districtName ? `${districtName} - Announcements` : "Announcements"}
          description="Manage district announcements"
          back={`/districts/${districtId}/dashboard`}
          actions={canManage && (
            <Button onClick={() => router.push(`/districts/${districtId}/announcements/add`)}>
              <Plus className="mr-2 h-4 w-4" />Add Announcement
            </Button>
          )}
        />

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
              {searchInput && <ClearButton onClick={clearSearch} aria-label="Clear search" />}
            </div>
            <Button onClick={handleSearch} size="sm">Search</Button>
          </div>
        </div>

        {!loading && announcements.length > 0 && <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="Quick filter by title, status..." className="max-w-md" />}
        {loading && <div className="flex items-center justify-center py-20"><ListPageSkeleton /></div>}
        {!loading && announcements.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center"><FolderOpen className="h-12 w-12 text-muted-foreground mb-4" /><h3 className="row-h2">No announcements found</h3></div>
        )}

        {!loading && filteredAnnouncements.length > 0 && (
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">S.No.</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Publish Date & Time</TableHead>
                  <TableHead>Expiry Date & Time</TableHead>
                  <TableHead className="text-center">Banner</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  {canManage && <TableHead className="w-12"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAnnouncements.map((ann, index) => (
                  <TableRow key={ann.id}>
                    <TableCell className="font-medium">{(page - 1) * pageSize + index + 1}</TableCell>
                    <TableCell><div className="flex flex-wrap items-center gap-2">{ann.imagePath && <img src={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}${ann.imagePath}`} alt="" className="h-10 w-10 rounded object-cover" />}<p className="font-medium">{ann.title}</p></div></TableCell>
                    <TableCell>{formatDateTime(ann.publishDateTime)}</TableCell>
                    <TableCell>{formatDateTime(ann.expiryDateTime)}</TableCell>
                    <TableCell className="text-center"><BannerBadge value={ann.isDisplayOnBanner} /></TableCell>
                    <TableCell className="text-center"><PublishStatusBadge status={ann.status} /><SendStatusBadges item={ann} /></TableCell>
                    {canManage && (
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button aria-label="More actions" variant="ghost" size="icon" className="row-btn-sm"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
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
